/**
 * M2.3a 2D rest machining: a smaller tool cuts only what earlier operations left in a pocket.
 * Checked against the swept-area boolean and, independently, against the simulator's stock:
 * every rest piece cuts material that was still there, and earlier operation + rest leave the
 * same material as the small tool would alone. Also minimum length, depth passes, associativity,
 * woodWOP output and golden digests.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeEntity, newPart, opInputHash, opState } from '@/cam/doc'
import { circle, type Contour, polyline, pt, rect } from '@/cam/geom'
import { clipPolys, offset, polyArea, polyOverlap, sweptPolys } from '@/cam/kernel'
import { defaultOp, fromTemplate, toTemplate } from '@/cam/ops'
import { buildTimeline } from '@/cam/sim'
import { HeightfieldStock } from '@/cam/stock/heightfield'
import { generatePart, simpleMoves, type Toolpath } from '@/cam/toolpath'
import type { CamPart, PocketOp } from '@/cam/types'
import { contourPolys, PolySet, radiusAt, restPieces, sweptAt } from '@/cam/adaptive/rest'
import { cutterOfTool } from '@/cam/3d/cutter'
import { defaultAppData, PLACEHOLDER_MACHINE } from '@/core/defaults'
import { writeSheetMpr } from '@/core/mpr/writer'
import { runJob } from '@/core/pipeline'
import type { Job } from '@/core/types'
import { digest } from './cam-digest'

const machine = PLACEHOLDER_MACHINE
const BIG = 't101' // 12 mm (placeholder)
const SMALL = 't103' // 6 mm (placeholder)

const SHAPES: Record<string, () => Contour> = {
  // sharp corners: the 12 mm tool leaves material in all four
  corners: () => rect(50, 40, 100, 60),
  // two rooms joined by a 10 mm neck the 12 mm tool cannot enter
  neck: () =>
    polyline(
      [
        [20, 20], [70, 20], [70, 70], [100, 70], [100, 20], [150, 20], [150, 90], [100, 90], [100, 80], [70, 80], [70, 90], [20, 90],
      ].map(([x, y]) => pt(x, y)),
      true,
    ),
}

function setup(shape: string, src: Partial<PocketOp> = {}, rest: Partial<PocketOp> = {}, restOpt: PocketOp['rest'] = { from: [], minLength: 0 }) {
  const part: CamPart = { ...newPart({ name: shape, length: 200, width: 150, thickness: 19, materialId: 'mat-mdf18' }) }
  const e = makeEntity({ t: 'contour', c: SHAPES[shape]() }, 'machining')
  part.entities = [...part.entities, e]
  const a = { ...(defaultOp('pocket', [e.id]) as PocketOp), name: 'Clear', toolId: BIG, ...src }
  const b = { ...(defaultOp('pocket', [e.id]) as PocketOp), name: 'Rest', toolId: SMALL, rest: restOpt, ...rest }
  part.ops = [a, b]
  const [ta, tb] = generatePart(part, machine)
  return { part, e, a, b, ta, tb }
}

/** The small tool's pocket alone (no rest), for comparison. */
function alone(shape: string, patch: Partial<PocketOp> = {}) {
  const { part, b } = setup(shape, {}, patch)
  part.ops = [{ ...b, rest: undefined }]
  return generatePart(part, machine)[0]
}

const carve = (stock: HeightfieldStock, tps: Toolpath[]) => {
  for (const s of buildTimeline(tps).segs) if (s.kind !== 'rapid') stock.carve(s.a, s.b, s.cutter)
}

/** Cutting chains of a toolpath: each run of feed and arc moves between rapids, as tip points. */
function chains(tp: Toolpath) {
  const tl = buildTimeline([tp])
  const out: { a: { x: number; y: number; z: number }; b: { x: number; y: number; z: number } }[][] = []
  let cur: (typeof out)[number] = []
  for (const s of tl.segs) {
    if (s.kind === 'rapid') {
      if (cur.length) out.push(cur)
      cur = []
    } else cur.push(s)
  }
  if (cur.length) out.push(cur)
  return out
}

describe('M2.3a rest machining cuts only what the earlier tool left', () => {
  for (const shape of Object.keys(SHAPES)) {
    it(`${shape}: every rest piece cuts material still there (simulated stock), and together they leave what the small tool alone leaves`, () => {
      const { ta, tb } = setup(shape)
      expect(tb.moves.length).toBeGreaterThan(5)
      const cell = 0.25
      const stock = new HeightfieldStock(200, 150, 19, cell)
      carve(stock, [ta])
      // each piece, before it is cut, finds material inside the tool (shrunk by a cell) above its depth
      let pieces = 0
      for (const ch of chains(tb)) {
        let found = false
        for (const s of ch)
          for (let k = 0; k <= 8 && !found; k++) {
            const x = s.a.x + ((s.b.x - s.a.x) * k) / 8
            const y = s.a.y + ((s.b.y - s.a.y) * k) / 8
            const z = s.a.z + ((s.b.z - s.a.z) * k) / 8
            if (z < -0.01 && stock.maxInDisc(x, y, 3 - 2 * cell) > z + 0.05) found = true
          }
        expect(found, `piece ${pieces} cuts nothing`).toBe(true)
        for (const s of ch) stock.carve(s.a, s.b, buildTimeline([tb]).ops[0].cutter)
        pieces++
      }
      expect(pieces).toBeGreaterThanOrEqual(shape === 'corners' ? 4 : 2)
      // same stock as the small tool's own pocket (cell for cell, within a cell's carving noise)
      const ref = new HeightfieldStock(200, 150, 19, cell)
      carve(ref, [alone(shape)])
      let diff = 0
      let inside = 0
      for (let i = 0; i < ref.hf.top.length; i++) {
        if (ref.hf.top[i] < -0.01) inside++
        if (Math.abs(ref.hf.top[i] - stock.hf.top[i]) > 0.05) diff++
      }
      process.stdout.write(`  [rest] ${shape}: ${pieces} pieces, ${Math.round(tb.stats.cut)} mm of cutting (small tool alone ${Math.round(alone(shape).stats.cut)} mm); ${diff} of ${inside} cells differ from the small tool alone\n`)
      expect(inside).toBeGreaterThan(1000)
      expect(diff / inside, `${diff} of ${inside} cells differ`).toBeLessThan(0.002)
      // and the rest pass is much shorter than the full pocket
      expect(tb.stats.cut).toBeLessThan(alone(shape).stats.cut / 3)
    }, 60_000)
  }

  it('against the swept-area boolean: each piece reaches the rest region, the rest region is covered', () => {
    const { ta, tb, e } = setup('corners')
    const z = -6
    const swept = sweptAt([{ moves: [...simpleMoves(ta.moves)], cutter: (cutterOfTool(ta.tool) as { cutter: never }).cutter }], z + 1e-6)
    const rest = clipPolys('subtract', contourPolys([e.g.t === 'contour' ? e.g.c : rect(0, 0, 1, 1)]), swept)
    const reach = contourPolys(offset(offset([e.g.t === 'contour' ? e.g.c : rect(0, 0, 1, 1)], -3), 3))
    const target = clipPolys('intersect', rest, reach)
    const caps: { x: number; y: number }[][] = []
    for (const ch of chains(tb)) {
      const cap = sweptPolys([ch.flatMap((s) => [{ x: s.a.x, y: s.a.y }, { x: s.b.x, y: s.b.y }])], 3)
      expect(polyOverlap(cap, target)).toBeGreaterThan(0.05)
      caps.push(...cap)
    }
    const left = clipPolys('subtract', target, caps)
    const leftArea = left.reduce((n, p) => n + Math.abs(polyArea(p)), 0)
    // what remains uncovered is only the hair-thin edge where the rest region meets the small tool's reach
    process.stdout.write(`  [rest] boolean check: rest region ${target.reduce((n, p) => n + Math.abs(polyArea(p)), 0).toFixed(3)} mm², left uncovered ${leftArea.toFixed(5)} mm²\n`)
    expect(leftArea).toBeLessThan(0.01)
  })

  it('a wall left by the earlier pocket is cut all the way round', () => {
    const { tb } = setup('corners', { stockXY: 0.5 })
    const contours = tb.intents.filter((i) => i.k === 'contour')
    // the whole outer pass is kept (it cuts the 0.5 mm wall everywhere)
    expect(contours.some((c) => c.k === 'contour' && c.closed)).toBe(true)
  })

  it('minimum length: pieces that cut less are skipped, with a clear warning when nothing is left', () => {
    const none = setup('corners', {}, {}, { from: [], minLength: 50 }).tb
    expect(none.moves.filter((m) => m.t !== 'rapid')).toHaveLength(0)
    expect(none.warnings.join(' ')).toMatch(/left nothing T103 can reach in pieces longer than the minimum length/)
    const some = setup('corners', {}, {}, { from: [], minLength: 2 }).tb
    expect(some.intents.length).toBe(4)
    const all = setup('neck', {}, {}, { from: [], minLength: 0 }).tb
    const long = setup('neck', {}, {}, { from: [], minLength: 15 }).tb
    expect(long.intents.length).toBeLessThan(all.intents.length)
    expect(long.intents.length).toBeGreaterThan(0)
  })

  it('depth passes: each level cuts what was left at that level; nothing above the earlier tool is cut twice', () => {
    const { ta, tb } = setup('corners', { levels: { ...defaultOp('pocket').levels, depth: 12, passDepth: 6 } }, { levels: { ...defaultOp('pocket').levels, depth: 12, passDepth: 6 } })
    const depths = tb.intents.flatMap((i) => (i.k === 'contour' ? i.passes.map((p) => p.depth) : []))
    expect(new Set(depths)).toEqual(new Set([6, 12]))
    expect(ta.warnings).toEqual([])
    // the earlier pocket only went to 6 mm: the rest pocket cuts the whole floor below it
    const deeper = setup('corners', {}, { levels: { ...defaultOp('pocket').levels, depth: 9, passDepth: 0 } }).tb
    expect(deeper.stats.cut).toBeGreaterThan(alone('corners').stats.cut * 0.8)
  })

  it('with no earlier operation there is nothing to follow', () => {
    const { part, b } = setup('corners')
    part.ops = [b]
    const tp = generatePart(part, machine)[0]
    expect(tp.moves).toEqual([])
    expect(tp.warnings[0]).toMatch(/no earlier milling operation/)
  })
})

describe('M2.3a rest machining: building blocks', () => {
  it('tool width at a height: flat, ball, bull-nose and V', () => {
    expect(radiusAt({ kind: 'torus', R: 4, rc: 0 }, 0)).toBe(4)
    expect(radiusAt({ kind: 'torus', R: 3, rc: 3 }, 0)).toBe(0)
    expect(radiusAt({ kind: 'torus', R: 3, rc: 3 }, 1)).toBeCloseTo(Math.sqrt(9 - 4), 12)
    expect(radiusAt({ kind: 'torus', R: 3, rc: 3 }, 5)).toBe(3)
    expect(radiusAt({ kind: 'torus', R: 6, rc: 2 }, 0)).toBe(4)
    expect(radiusAt({ kind: 'torus', R: 6, rc: 2 }, 1)).toBeCloseTo(4 + Math.sqrt(3), 12)
    expect(radiusAt({ kind: 'v', R: 6, k: 1 }, 2)).toBe(2)
    expect(radiusAt({ kind: 'v', R: 6, k: 1 }, 9)).toBe(6)
    expect(radiusAt({ kind: 'torus', R: 4, rc: 0 }, -0.1)).toBe(0)
  })

  it('swept area: a ball-nose 2 mm below a level sweeps its width there; above the level nothing', () => {
    const moves = [
      { t: 'rapid' as const, x: 0, y: 0, z: 5 },
      { t: 'feed' as const, x: 0, y: 0, z: -3, f: 'plunge' as const },
      { t: 'feed' as const, x: 50, y: 0, z: -3, f: 'cut' as const },
    ]
    const ball = { kind: 'torus' as const, R: 3, rc: 3 }
    const at = (z: number) => sweptAt([{ moves, cutter: ball }], z).reduce((n, p) => n + Math.abs(polyArea(p)), 0)
    const w = Math.sqrt(9 - 1) // width at 2 mm above the tip
    expect(at(-1)).toBeCloseTo(50 * 2 * w + Math.PI * w * w, 1)
    expect(at(-3.5)).toBe(0)
    // a ramp only counts where it is below the level
    const ramp = [{ t: 'rapid' as const, x: 0, y: 0, z: 0 }, { t: 'feed' as const, x: 40, y: 0, z: -4, f: 'cut' as const }]
    const flat = { kind: 'torus' as const, R: 2, rc: 0 }
    const a = sweptAt([{ moves: ramp, cutter: flat }], -2).reduce((n, p) => n + Math.abs(polyArea(p)), 0)
    expect(a).toBeCloseTo(20 * 4 + Math.PI * 4, 1)
  })

  it('pieces of a closed pass: a run across its seam stays one piece; the cut length is measured', () => {
    const ring = circle(pt(0, 0), 10) // starts at (10, 0)
    const zone = new PolySet([[pt(5, -5), pt(15, -5), pt(15, 5), pt(5, 5)]])
    const touch = new PolySet([[pt(8, -2), pt(15, -2), pt(15, 2), pt(8, 2)]])
    const ps = restPieces(ring, zone, touch, 0)
    expect(ps).toHaveLength(1)
    expect(ps[0].d0).toBeLessThan(0)
    expect(ps[0].d1).toBeGreaterThan(0)
    // the arc inside |y| <= 5 on r = 10: 2 * 10 * asin(0.5)
    expect(ps[0].d1 - ps[0].d0).toBeCloseTo(20 * Math.asin(0.5), 2)
    expect(ps[0].cutLength).toBeCloseTo(20 * Math.asin(0.2), 1)
    expect(ps[0].startsInMaterial).toBe(false)
    expect(restPieces(ring, zone, touch, 5)).toHaveLength(0)
  })

  it('a recipe made from a rest pocket follows every earlier operation in the new part', () => {
    const { b } = setup('corners', {}, {}, { from: ['abc'], minLength: 3 })
    const t = toTemplate(b)
    expect((fromTemplate(t, []) as PocketOp).rest).toEqual({ from: [], minLength: 3 })
  })
})

describe('M2.3a rest machining: associativity, woodWOP output and goldens', () => {
  it('changing an earlier operation (tool, shape, order) or its tool marks the rest pocket stale', () => {
    const { part, a, b } = setup('corners')
    const tool = machine.tools.find((t) => t.id === SMALL)!
    const built = { ...b, builtHash: opInputHash(b, part, tool, machine) }
    const with_ = (ops: CamPart['ops'], p: Partial<CamPart> = {}) => ({ ...part, ...p, ops: ops.map((o) => (o.id === b.id ? built : o)) })
    expect(opState(built, with_(part.ops), tool, machine)).toBe('current')
    expect(opState(built, with_([{ ...a, toolId: 't102' }, b]), tool, machine)).toBe('stale')
    expect(opState(built, with_([{ ...a, stepover: 0.3 }, b]), tool, machine)).toBe('stale')
    const extra = { ...(defaultOp('profile', [part.outlineId!]) as PocketOp), id: 'x' } as unknown as CamPart['ops'][number]
    expect(opState(built, with_([extra, a, b]), tool, machine)).toBe('stale')
    const resized = { ...machine, tools: machine.tools.map((t) => (t.id === BIG ? { ...t, diameter: 10 } : t)) }
    expect(opState(built, with_(part.ops), tool, resized)).toBe('stale')
    // an operation after the rest pocket does not matter
    expect(opState(built, with_([a, b, extra]), tool, machine)).toBe('current')
  })

  it('woodWOP: each rest piece is one contour-milling pass at its depth, and the export checker passes', () => {
    const { part } = setup('corners')
    const data = defaultAppData()
    const job: Job = { id: 'j', number: 'JR', name: 'Rest', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [part] }
    data.jobs = [job]
    data.settings.features = { ...data.settings.features, camMprOutput: true } as typeof data.settings.features
    const out = runJob(job, data)
    expect(out.issues.filter((i) => i.severity === 'error' && i.code !== 'THICKNESS').map((i) => i.code)).toEqual([])
    const rest = out.programs.flatMap((p) => p.ops).filter((o) => o.kind === 'cam' && o.intent.k === 'contour' && o.intent.label.endsWith('rest'))
    expect(rest).toHaveLength(4)
    const mpr = writeSheetMpr(out.programs[0], { job, machine: data.machine, mprNumber: 1, mprCount: 1 })
    expect(mpr.split('<105 ').length - 1).toBeGreaterThanOrEqual(4)
  })

  const DIR = path.join(import.meta.dirname, 'golden', 'cam2')
  const UPDATE = process.env.UPDATE_GOLDEN === '1'
  for (const [label, shape, src] of [
    ['rest-corners', 'corners', {}],
    ['rest-neck', 'neck', {}],
    ['rest-wall', 'corners', { stockXY: 0.5 }],
  ] as [string, string, Partial<PocketOp>][]) {
    it(`golden: ${label}`, () => {
      const dig = JSON.stringify(digest(setup(shape, src).tb), null, 1) + '\n'
      const f = path.join(DIR, label, 'toolpath.json')
      if (UPDATE) {
        fs.mkdirSync(path.dirname(f), { recursive: true })
        fs.writeFileSync(f, dig)
      }
      expect(fs.existsSync(f), `${f} missing; run UPDATE_GOLDEN=1 once to create it`).toBe(true)
      expect(dig).toBe(fs.readFileSync(f, 'utf8'))
    })
  }
})
