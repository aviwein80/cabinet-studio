/**
 * M2.6c: hand-drawn toolpaths (NEW-09) and toolpath edits (NEW-11), including edits that survive
 * regeneration or are flagged.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeEntity, newPart } from '../src/cam/doc'
import { polyline, pt, rect } from '../src/cam/geom'
import { writePartMpr } from '../src/cam/mpr'
import { readMpr } from '../src/cam/mprRead'
import { defaultOp } from '../src/cam/ops'
import { anchorOf, appendStep, arcThrough, locate, movesHash, reanchor, reverseMoves, slowCorners, undoStep } from '../src/cam/more25d/edits'
import { buildTimeline, carve, createHeightfield } from '../src/cam/sim'
import { generateOp, generatePart, type SimpleMove, simpleMoves, type Toolpath } from '../src/cam/toolpath'
import type { CamOp, CamPart, ManualOp, PocketOp, ProfileOp, ToolpathEdits } from '../src/cam/types'
import { defaultAppData, PLACEHOLDER_MACHINE } from '../src/core/defaults'
import { runJob } from '../src/core/pipeline'
import type { Job } from '../src/core/types'
import { digest } from './cam-digest'
import { editParts, manualParts } from './cam-reference-25d'

const machine = PLACEHOLDER_MACHINE
const moves = (tp: Toolpath) => [...simpleMoves(tp.moves)]

function panel(size: [number, number, number] = [300, 200, 19]) {
  const part = newPart({ name: 'P', length: size[0], width: size[1], thickness: size[2], entities: [] })
  const outline = makeEntity({ t: 'contour', c: rect(0, 0, size[0], size[1]) }, 'outline')
  part.entities = [outline]
  part.outlineId = outline.id
  return part
}

const errors = (part: CamPart, features: Record<string, boolean> = { camMprOutput: true, cam25dMprOutput: true }) => {
  part.materialId = 'mat-mdf18'
  const data = defaultAppData()
  const j: Job = { id: 'j', number: 'J30', name: 'Edits', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [part] }
  data.jobs = [j]
  data.settings.features = { ...data.settings.features, ...features }
  return runJob(j, data).issues.filter((i) => i.severity === 'error' && i.code !== 'THICKNESS')
}

describe('hand-drawn toolpaths', () => {
  it('builds a path pick by pick (feed lines, an arc through a point, a rapid) with undo last', () => {
    let op = defaultOp('manual', [], { toolId: 't103' } as Partial<CamOp>) as ManualOp
    const step = (k: 'feed' | 'rapid' | 'arc', x: number, y: number, z: number, through?: { x: number; y: number }) => {
      const r = appendStep(op, k, pt(x, y), z, through)
      if ('error' in r) throw new Error(r.error)
      op = r
    }
    step('feed', 50, 50, -3) // the first pick is the start
    expect(op.start).toEqual({ x: 50, y: 50, z: -3 })
    step('feed', 150, 50, -3)
    step('arc', 150, 150, -3, pt(200, 100))
    step('rapid', 150, 150, 5)
    step('feed', 100, 150, -3)
    expect(op.steps.map((s) => s.k)).toEqual(['feed', 'arc', 'rapid', 'feed'])
    const a = op.steps[1] as Extract<ManualOp['steps'][number], { k: 'arc' }>
    expect(a.cx).toBeCloseTo(150, 9)
    expect(a.cy).toBeCloseTo(100, 9)
    expect(a.ccw).toBe(true)
    op = undoStep(op)
    expect(op.steps.map((s) => s.k)).toEqual(['feed', 'arc', 'rapid'])
    expect('error' in appendStep(op, 'arc', pt(0, 150), -3, pt(75, 150))).toBe(true)
    expect(arcThrough(pt(0, 0), pt(1, 1), pt(2, 2))).toBeNull()
  })

  it('moves follow the picks; runs at one depth become contour passes; a plunge at the start is woodWOP’s own approach', () => {
    const [p] = manualParts().filter((x) => x.id === 'man02')
    const [tp] = generatePart(p, machine)
    const m = moves(tp)
    expect(m.filter((q) => q.t === 'arc')).toHaveLength(1)
    expect(tp.intents.map((it) => it.k === 'contour' && it.passes[0].depth)).toEqual([2, 4])
    expect(tp.intents[0].k === 'contour' && tp.intents[0].segs.map((s) => s.k)).toEqual(['L', 'A', 'L'])
    expect(tp.noOutput).toBeUndefined()
    expect(errors(p).map((i) => i.code)).toEqual([])
    expect(errors(p, { camMprOutput: true }).map((i) => i.code)).toEqual(['CAM_25D_OUTPUT_OFF'])
  })

  it('a path that changes depth while it cuts is simulated but refused for output', () => {
    const [p] = manualParts().filter((x) => x.id === 'man03')
    const [tp] = generatePart(p, machine)
    expect(tp.intents).toEqual([])
    expect(tp.noOutput).toMatch(/changes depth while it cuts/)
    expect(errors(p).map((i) => i.code)).toEqual(['CAM_NO_OUTPUT'])
  })
})

describe('toolpath edits', () => {
  const profile = (edits?: ToolpathEdits, extra: Partial<ProfileOp> = {}) => {
    const part = panel()
    const op = defaultOp('profile', [part.outlineId!], { edits, ...extra, levels: { safeZ: 20, rapidZ: 3, depth: 6, through: false, stockZ: 0, passDepth: 0, ...extra.levels } } as Partial<CamOp>) as ProfileOp
    part.ops = [op]
    return { part, op }
  }

  it('slow down in corners: each band within the distance gets its share of the feed; times go up', () => {
    const plain = generatePart(profile().part, machine)[0]
    const { part } = profile({ corners: { angle: 45, distance: 10, steps: 2, percent: 50 } })
    const [tp] = generatePart(part, machine)
    expect(tp.warnings.join(' ')).toMatch(/at 4 corner/)
    expect(tp.stats.minutes).toBeGreaterThan(plain.stats.minutes)
    // the outline's corners are rolled (6 mm arcs round the panel corners): each counts as a corner
    // at its middle, and the bands reach 5 and 10 mm either side of it
    const ks: number[] = []
    for (const m of moves(tp)) if ((m.t === 'feed' || m.t === 'arc') && m.f === 'cut') ks.push(m.k ?? 1)
    expect(new Set(ks.map((k) => Math.round(k * 1000) / 1000))).toEqual(new Set([1, 0.75, 0.5]))
  })

  it('slowCorners on a square: exact bands and lengths', () => {
    const sq: SimpleMove[] = [
      { t: 'rapid', x: 0, y: 0, z: 5 },
      { t: 'feed', x: 0, y: 0, z: -1, f: 'plunge' },
      { t: 'feed', x: 100, y: 0, z: -1, f: 'cut' },
      { t: 'feed', x: 100, y: 100, z: -1, f: 'cut' },
    ]
    const r = slowCorners(sq, { angle: 45, distance: 10, steps: 2, percent: 40 })
    expect(r.corners).toBe(1)
    const cut = r.moves.filter((m): m is Extract<SimpleMove, { t: 'feed' }> => m.t === 'feed' && m.f === 'cut')
    expect(cut.map((m) => [m.x, m.y, m.k ?? 1])).toEqual([
      [90, 0, 1],
      [95, 0, 0.7],
      [100, 0, 0.4],
      [100, 5, 0.4],
      [100, 10, 0.7],
      [100, 100, 1],
    ])
  })

  it('edit the feed on a stretch and the height of a point; heights edited point by point are refused for output', () => {
    const { part, op } = profile()
    const unedited = moves(generateOp(op, { part, machine }))
    const base = movesHash(unedited)
    const zEdit = { at: anchorOf(unedited, 6), z: unedited[6].z + 1 }
    const edits: ToolpathEdits = { base, feeds: [{ from: anchorOf(unedited, 4), to: anchorOf(unedited, 5), percent: 70 }], z: [zEdit] }
    const edited = { ...op, edits }
    const [tp] = generatePart({ ...part, ops: [edited] }, machine)
    const m = moves(tp)
    expect(m[6].z).toBeCloseTo(unedited[6].z + 1, 9)
    expect((m[4] as { k?: number }).k).toBe(0.7)
    expect((m[5] as { k?: number }).k).toBe(0.7)
    expect(tp.edited).toEqual({ base, applied: 2, moved: 0, lost: 0, reversed: false })
    expect(tp.noOutput).toMatch(/edited point by point/)
    expect(errors({ ...part, ops: [edited] }).map((i) => i.code)).toEqual(['CAM_NO_OUTPUT'])
    // a feed edit alone is written (with a note that woodWOP keeps one feed)
    const feedOnly = { ...op, edits: { base, feeds: edits.feeds } }
    const [tf] = generatePart({ ...part, ops: [feedOnly] }, machine)
    expect(tf.noOutput).toBeUndefined()
    expect(tf.warnings.join(' ')).toMatch(/not written to woodWOP/)
  })

  it('edits survive regeneration: unchanged toolpath applies them as made; a changed one moves them to the same point, or flags them', () => {
    const { part, op } = profile()
    const unedited = moves(generateOp(op, { part, machine }))
    const base = movesHash(unedited)
    // a point of the last pass: the end of the first side at -6
    const i = unedited.findIndex((q) => q.t === 'feed' && q.f === 'cut' && q.z === -6)
    const edits: ToolpathEdits = { base, z: [{ at: anchorOf(unedited, i), z: -5.5 }] }
    // 1) something that does not change the moves (the feed): applied as made
    const a = generatePart({ ...part, ops: [{ ...op, edits, feeds: { feed: 4000 } }] }, machine)[0]
    expect(a.edited).toMatchObject({ applied: 1, moved: 0, lost: 0 })
    // 2) two passes: the moves change, the point at -6 is still there (last pass): moved to it
    const two = { ...op, edits, levels: { ...op.levels, passDepth: 3 } }
    const b = generatePart({ ...part, ops: [two] }, machine)[0]
    expect(b.edited).toMatchObject({ applied: 0, moved: 1, lost: 0 })
    const j = locate(moves(generateOp({ ...two, edits: undefined }, { part, machine })), edits.z![0].at, false)!
    expect(moves(b)[j].z).toBe(-5.5)
    expect(j).not.toBe(i)
    // 3) a different depth: no move ends there any more: flagged, and the export refuses it
    const deeper = { ...op, edits, levels: { ...op.levels, depth: 8 } }
    const c = generatePart({ ...part, ops: [deeper] }, machine)[0]
    expect(c.edited).toMatchObject({ lost: 1 })
    expect(c.warnings.join(' ')).toMatch(/no longer match/)
    const errs = errors({ ...part, ops: [deeper] })
    expect(errs.map((x) => x.code)).toEqual(['CAM_NO_OUTPUT'])
    expect(errs[0].message).toMatch(/keep or clear them/)
    // "Keep on the new toolpath": moved edits get their new anchors (then apply as made); lost ones are cleared
    const kept = reanchor(edits, moves(generateOp({ ...two, edits: undefined }, { part, machine })))
    expect(kept.dropped).toBe(0)
    expect(generatePart({ ...part, ops: [{ ...two, edits: kept.edits }] }, machine)[0].edited).toMatchObject({ applied: 1, moved: 0, lost: 0 })
    const cleared = reanchor(edits, moves(generateOp({ ...deeper, edits: undefined }, { part, machine })))
    expect(cleared.dropped).toBe(1)
    expect(cleared.edits).toEqual({})
    expect(generatePart({ ...part, ops: [{ ...deeper, edits: cleared.edits }] }, machine)[0].noOutput).toBeUndefined()
  })

  it('rapid height: moves between cuts at the new height; written toolpath unchanged otherwise', () => {
    const part = panel([400, 200, 19])
    const l1 = makeEntity({ t: 'contour', c: polyline([pt(20, 50), pt(380, 50)], false) }, 'machining')
    const l2 = makeEntity({ t: 'contour', c: polyline([pt(20, 150), pt(380, 150)], false) }, 'machining')
    part.entities.push(l1, l2)
    const op = defaultOp('engrave', [l1.id, l2.id], { edits: { rapidHeight: 8 } } as Partial<CamOp>)
    part.ops = [op]
    const [tp] = generatePart(part, machine)
    const rz = new Set(moves(tp).filter((q) => q.t === 'rapid').map((q) => q.z))
    expect(rz.has(20)).toBe(false)
    expect(rz.has(8)).toBe(true)
    expect(tp.noOutput).toBeUndefined()
    // an edited Stage 1 operation is written only behind the newer-operations switch
    expect(errors(part, { camMprOutput: true }).map((i) => i.code)).toEqual(['CAM_25D_OUTPUT_OFF'])
    expect(errors(part).map((i) => i.code)).toEqual([])
  })

  it('reverse: the same material is cut (simulated cell for cell), each cut the other way, the native contours reversed too', () => {
    const [p] = editParts().filter((x) => x.id === 'edit02')
    const op = p.ops[0]
    const plain = generateOp({ ...op, edits: undefined }, { part: p, machine })
    const rev = generateOp({ ...op, edits: { reverse: true } }, { part: p, machine })
    const hf = (tp: Toolpath) => {
      const h = createHeightfield(p.length, p.width, p.thickness, 0.5)
      const tl = buildTimeline([tp])
      carve(h, tl, 0, tl.total)
      return h.top
    }
    expect(hf(rev)).toEqual(hf(plain))
    // first cut of the reversed path is the last cut of the plain one, run the other way
    const cutsOf = (tp: Toolpath) => moves(tp).filter((q) => q.t === 'feed' && q.f === 'cut')
    expect(cutsOf(rev)[0]).toMatchObject({ x: 380, y: 150 })
    expect(rev.intents.map((it) => it.k === 'contour' && it.segs[0].a)).toEqual([pt(20, 150), pt(380, 50)])
    expect(rev.edited?.reversed).toBe(true)
  })

  it('reverse is refused when the new starts would plunge deeper than the tool may', () => {
    const { part, op } = profile({ reverse: true })
    const m = { ...machine, tools: machine.tools.map((t) => (t.id === 't101' ? { ...t, centreCutting: false } : t)) }
    const [tp] = generatePart({ ...part, ops: [op] }, m)
    expect(tp.warnings.join(' ')).toMatch(/Not reversed/)
    expect(tp.edited?.reversed).toBe(false)
    const r = reverseMoves(
      [
        { t: 'rapid', x: 0, y: 0, z: 3 },
        { t: 'feed', x: 0, y: 0, z: -2, f: 'plunge' },
        { t: 'feed', x: 10, y: 0, z: -2, f: 'cut' },
        { t: 'rapid', x: 10, y: 0, z: 3 },
      ],
      { safeZ: 20, rapidZ: 3 },
    )
    expect(r.plunges).toEqual([2])
    expect(r.moves.filter((q) => q.t !== 'rapid').map((q) => [q.x, q.z])).toEqual([
      [10, -2],
      [0, -2],
      [0, 3],
    ])
  })

  it('pocket start points: each depth starts at the point of its first pass nearest the start', () => {
    const part = panel([400, 300, 19])
    const pk = makeEntity({ t: 'contour', c: rect(100, 80, 200, 140) }, 'machining')
    part.entities.push(pk)
    const mk = (starts?: { x: number; y: number }[], pattern: PocketOp['pattern'] = 'offset') => defaultOp('pocket', [pk.id], { toolId: 't102', pattern, entry: 'plunge', levels: { safeZ: 20, rapidZ: 3, depth: 8, through: false, stockZ: 0, passDepth: 4 }, edits: starts ? { starts } : undefined } as Partial<CamOp>)
    const plunges = (op: CamOp) => moves(generatePart({ ...part, ops: [op] }, machine)[0]).filter((q) => q.t === 'feed' && q.f === 'plunge')
    const s = { x: 300, y: 220 }
    for (const pl of plunges(mk([s]))) {
      // the innermost ring spans x 104..296 less the passes; its nearest point to (300, 220) is its top-right corner region
      expect(pl.x).toBeGreaterThan(150)
      expect(pl.y).toBeGreaterThan(130)
    }
    const zz = plunges(mk([s], 'zigzag'))
    const zz0 = plunges(mk(undefined, 'zigzag'))
    expect(Math.hypot(zz[0].x - s.x, zz[0].y - s.y)).toBeLessThan(Math.hypot(zz0[0].x - s.x, zz0[0].y - s.y))
  })
})

describe('goldens: 3 reference parts per operation', () => {
  const DIR = path.join(import.meta.dirname, 'golden', 'cam25d')
  const UPDATE = process.env.UPDATE_GOLDEN === '1'
  const check = (f: string, text: string) => {
    if (UPDATE) {
      fs.mkdirSync(path.dirname(f), { recursive: true })
      fs.writeFileSync(f, text, f.endsWith('.json') ? 'utf8' : 'latin1')
    }
    expect(fs.existsSync(f), `${f} missing; run UPDATE_GOLDEN=1 once to create it`).toBe(true)
    expect(text).toBe(fs.readFileSync(f, f.endsWith('.json') ? 'utf8' : 'latin1'))
  }
  for (const p of [...manualParts(), ...editParts()]) {
    it(`${p.id} ${p.name}`, () => {
      const paths = generatePart(p, machine)
      check(path.join(DIR, p.id, 'toolpaths.json'), JSON.stringify(paths.map((tp) => ({ ...digest(tp), ...(tp.edited ? { edited: tp.edited } : {}), ...(tp.noOutput ? { noOutput: tp.noOutput } : {}) })), null, 1) + '\n')
      const mpr = writePartMpr(p, paths.filter((tp) => !tp.noOutput), machine, 'REF')
      expect(readMpr(mpr).errors).toEqual([])
      check(path.join(DIR, p.id, 'part.mpr'), mpr)
    })
  }
})
