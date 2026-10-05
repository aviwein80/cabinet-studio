/**
 * M2.3b adaptive clearing in 2D pockets. The width of cut of every move is measured by the
 * independent checker (exact Clipper2 booleans of the swept discs, not the planner's raster):
 * never more than the target + 10 %, and no full-width moves outside flagged trochoidal sections.
 * Also: wall clearance, what is left (against the simulated stock of a normal pocket), depth
 * passes, adaptive feed, the export checker, background calculation and golden digests.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkEngagement } from '@/cam/adaptive/check'
import { contourPolys } from '@/cam/adaptive/rest'
import { makeEntity, newPart } from '@/cam/doc'
import { circle, type Contour, polyline, pt, rect } from '@/cam/geom'
import { segSegDist2 } from '@/cam/adaptive/walls'
import { defaultOp } from '@/cam/ops'
import { buildTimeline } from '@/cam/sim'
import { HeightfieldStock } from '@/cam/stock/heightfield'
import { generatePart, inBackground, type Toolpath } from '@/cam/toolpath'
import type { CamPart, PocketOp } from '@/cam/types'
import { defaultAppData, PLACEHOLDER_MACHINE } from '@/core/defaults'
import { runJob } from '@/core/pipeline'
import type { Job } from '@/core/types'
import { digest } from './cam-digest'

const machine = PLACEHOLDER_MACHINE
const SMALL = 't103' // 6 mm (placeholder)
const r = 3

const SHAPES: Record<string, () => Contour[]> = {
  square: () => [rect(20, 20, 60, 40)],
  island: () => [rect(20, 20, 90, 60), circle(pt(65, 50), 10)],
  // two rooms joined by an 8 mm slot: too narrow for passes at this width of cut
  slot: () => [polyline([[20, 20], [50, 20], [50, 46], [100, 46], [100, 20], [130, 20], [130, 80], [100, 80], [100, 54], [50, 54], [50, 80], [20, 80]].map(([x, y]) => pt(x, y)), true)],
}

function setup(shape: string, patch: Partial<PocketOp> = {}) {
  const part: CamPart = newPart({ name: shape, length: 150, width: 100, thickness: 19, materialId: 'mat-mdf18' })
  const es = SHAPES[shape]().map((c) => makeEntity({ t: 'contour', c }, 'machining'))
  part.entities = [...part.entities, ...es]
  const op: PocketOp = { ...(defaultOp('pocket', es.map((e) => e.id)) as PocketOp), toolId: SMALL, pattern: 'adaptive', ...patch }
  part.ops = [op]
  const [tp] = generatePart(part, machine)
  return { part, op, tp, region: SHAPES[shape]() }
}

/** Every cutting move keeps the tool at least its radius from the pocket's edges. */
function wallClearance(tp: Toolpath, region: Contour[]) {
  const edges = contourPolys(region).flatMap((poly) => poly.map((a, i) => [a, poly[(i + 1) % poly.length]] as const))
  let worst = Infinity
  let at: { x: number; y: number } | null = null
  for (const m of tp.moves) {
    if (m.t === 'poly' || m.t === 'drill') continue
    if (at && m.t === 'feed' && m.z < 0)
      for (const [a, b] of edges) worst = Math.min(worst, Math.sqrt(segSegDist2(at.x, at.y, m.x, m.y, a.x, a.y, b.x, b.y)))
    at = m
  }
  return worst
}

const cases: [string, Partial<PocketOp>, number][] = [
  ['square', {}, 0.9],
  ['island', {}, 0.9],
  ['slot', {}, 0.9],
  ['square', { direction: 'conventional' }, 0.9],
  ['square', { adaptive: { width: 0, angle: 60, smoothing: 1, lift: 0.5, feedBoost: 1 } }, r * (1 - Math.cos(Math.PI / 3))],
]

describe('M2.3b adaptive clearing: width of cut held, measured independently', () => {
  for (const [shape, patch, target] of cases) {
    const label = `${shape}${patch.direction ? ` (${patch.direction})` : ''}${patch.adaptive?.angle ? ` (${patch.adaptive.angle}° engagement)` : ''}`
    it(`${label}: every move <= target + 10 %, no full-width move outside flagged trochoidal loops, tool clear of the walls`, () => {
      const { tp, region } = setup(shape, patch)
      const rep = checkEngagement(tp, r, contourPolys(region), -6)
      const flagged = rep.moves.filter((m) => m.flagged).length
      process.stdout.write(`  [adaptive] ${label}: target ${target.toFixed(3)} mm, ${rep.moves.length} moves checked, widest ${rep.max.toFixed(3)} mm (${((rep.max / target) * 100).toFixed(1)} %), trochoidal moves ${flagged} (widest ${rep.maxFlagged.toFixed(3)}), full-width outside ${rep.fullOutside}\n`)
      expect(rep.moves.length).toBeGreaterThan(200)
      expect(rep.max).toBeLessThanOrEqual(target * 1.1)
      expect(rep.maxFlagged).toBeLessThanOrEqual(target * 1.1)
      expect(rep.fullOutside).toBe(0)
      // the planner aims a little under the target: the cut is steady, not light
      const ws = rep.moves.filter((m) => !m.flagged).map((m) => m.width).sort((a, b) => a - b)
      expect(ws[Math.floor(ws.length / 2)]).toBeGreaterThan(target * 0.8)
      expect(wallClearance(tp, region)).toBeGreaterThanOrEqual(r - 1e-6)
      expect(tp.warnings.join(' ')).not.toMatch(/could not reach/)
      if (shape === 'slot') expect(tp.sections?.length).toBeGreaterThan(0)
      else expect(tp.sections ?? []).toHaveLength(0)
    }, 120_000)
  }

  it('the checker itself: a side cut measures its width, a slot measures full width', () => {
    const material = [[pt(0, 0), pt(100, 0), pt(100, 20), pt(0, 20)]]
    const side: Toolpath = { opId: 'x', kind: 'pocket', name: 'x', tool: null, feeds: { rpm: 1, feed: 1, plunge: 1 }, intents: [], warnings: [], stats: { cut: 0, rapid: 0, minutes: 0 }, moves: [{ t: 'rapid', x: 10, y: -3 + 1.2, z: -6 }, ...Array.from({ length: 40 }, (_, i) => ({ t: 'feed' as const, x: 11 + i, y: -3 + 1.2, z: -6, f: 'cut' as const }))] }
    const a = checkEngagement(side, 3, material, -6)
    for (const m of a.moves.slice(5)) expect(m.width).toBeCloseTo(1.2, 3)
    expect(a.fullOutside).toBe(0)
    const slot: Toolpath = { ...side, moves: [{ t: 'rapid', x: 10, y: 10, z: -6 }, ...Array.from({ length: 20 }, (_, i) => ({ t: 'feed' as const, x: 11 + i, y: 10, z: -6, f: 'cut' as const }))] }
    const b = checkEngagement(slot, 3, material, -6)
    for (const m of b.moves.slice(3)) {
      expect(m.width).toBeCloseTo(6, 3)
      expect(m.full).toBe(true)
    }
    expect(b.fullOutside).toBe(b.moves.length)
  })
})

describe('M2.3b adaptive clearing: what it leaves, depths, feed, output', () => {
  it('clears what a normal pocket clears (simulated stock), only tiny scraps differ', () => {
    for (const shape of ['square', 'island']) {
      const { part, op, tp } = setup(shape)
      const ref = generatePart({ ...part, ops: [{ ...op, pattern: 'offset' }] }, machine)[0]
      const cell = 0.25
      const a = new HeightfieldStock(150, 100, 19, cell)
      const b = new HeightfieldStock(150, 100, 19, cell)
      for (const s of buildTimeline([tp]).segs) if (s.kind !== 'rapid') a.carve(s.a, s.b, s.cutter)
      for (const s of buildTimeline([ref]).segs) if (s.kind !== 'rapid') b.carve(s.a, s.b, s.cutter)
      let cut = 0
      let more = 0
      let less = 0
      for (let i = 0; i < a.hf.top.length; i++) {
        if (b.hf.top[i] < -0.01) cut++
        if (a.hf.top[i] > b.hf.top[i] + 0.05) more++
        if (a.hf.top[i] < b.hf.top[i] - 0.05) less++
      }
      process.stdout.write(`  [adaptive] ${shape}: ${more} of ${cut} cells left that the follow-shape pocket cuts, ${less} cut that it leaves\n`)
      // never cuts anything the normal pocket does not (no wall or island touched)
      expect(less).toBe(0)
      expect(more / cut).toBeLessThan(0.005)
    }
  }, 120_000)

  it('depth passes repeat the level plan with a helix entry at each depth', () => {
    const { tp } = setup('square', { levels: { ...defaultOp('pocket').levels, depth: 12, passDepth: 6 } })
    const zs = new Set(tp.moves.filter((m) => m.t === 'feed' && m.f === 'cut').map((m) => (m as { z: number }).z))
    expect([...zs].sort((a, b) => a - b)).toEqual([-12, -6])
    const at = (z: number) => tp.moves.filter((m) => m.t === 'feed' && m.f === 'cut' && m.z === z).map((m) => `${(m as { x: number }).x.toFixed(4)},${(m as { y: number }).y.toFixed(4)}`)
    expect(at(-12)).toEqual(at(-6))
    expect(tp.moves.filter((m) => m.t === 'arc' && m.f === 'plunge').length).toBeGreaterThanOrEqual(4)
  }, 60_000)

  it('adaptive feed: lighter moves and moves back speed up, never past the limit; off by default', () => {
    const plain = setup('square').tp
    expect(plain.moves.some((m) => m.t === 'feed' && m.k)).toBe(false)
    const fast = setup('square', { adaptive: { width: 0.15, smoothing: 1, lift: 0.5, feedBoost: 1.5 } }).tp
    const ks = fast.moves.flatMap((m) => (m.t === 'feed' && m.k ? [m.k] : []))
    expect(ks.length).toBeGreaterThan(50)
    expect(Math.max(...ks)).toBeLessThanOrEqual(1.5)
    expect(Math.min(...ks)).toBeGreaterThan(1)
    expect(fast.stats.minutes).toBeLessThan(plain.stats.minutes)
    expect(fast.stats.cut).toBe(plain.stats.cut)
  }, 60_000)

  it('the same input gives the same toolpath', () => {
    expect(JSON.stringify(setup('square').tp.moves)).toBe(JSON.stringify(setup('square').tp.moves))
  }, 60_000)

  it('woodWOP: blocked by the export checker (CAM_ADAPTIVE_NO_OUTPUT); export does not wait for it', () => {
    const { part } = setup('square')
    expect(inBackground(part.ops[0], part)).toBe(true)
    const data = defaultAppData()
    const job: Job = { id: 'j', number: 'JA', name: 'Adaptive', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [part] }
    data.jobs = [job]
    data.settings.features = { ...data.settings.features, camMprOutput: true } as typeof data.settings.features
    const t0 = performance.now()
    const out = runJob(job, data)
    expect(performance.now() - t0).toBeLessThan(2000)
    const e = out.issues.filter((i) => i.code === 'CAM_ADAPTIVE_NO_OUTPUT')
    expect(e).toHaveLength(1)
    expect(e[0].severity).toBe('error')
    expect(out.programs.flatMap((p) => p.ops).filter((o) => o.kind === 'cam' && o.opId === part.ops[0].id)).toHaveLength(0)
  })

  it('rest machining after adaptive clearing is calculated in the background too', () => {
    const { part, op } = setup('square')
    const rest = { ...(defaultOp('pocket', op.geometry) as PocketOp), toolId: 't102', rest: { from: [], minLength: 0 } }
    const p2 = { ...part, ops: [op, rest] }
    expect(inBackground(rest, p2)).toBe(true)
    expect(inBackground({ ...op, pattern: 'offset' }, p2)).toBe(false)
  })

  const DIR = path.join(import.meta.dirname, 'golden', 'cam2')
  const UPDATE = process.env.UPDATE_GOLDEN === '1'
  for (const shape of ['square', 'slot']) {
    it(`golden: adaptive-${shape}`, () => {
      const dig = JSON.stringify(digest(setup(shape).tp), null, 1) + '\n'
      const f = path.join(DIR, `adaptive-${shape}`, 'toolpath.json')
      if (UPDATE) {
        fs.mkdirSync(path.dirname(f), { recursive: true })
        fs.writeFileSync(f, dig)
      }
      expect(fs.existsSync(f), `${f} missing; run UPDATE_GOLDEN=1 once to create it`).toBe(true)
      expect(dig).toBe(fs.readFileSync(f, 'utf8'))
    }, 60_000)
  }
})
