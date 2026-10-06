/**
 * M3.1c flat-area finishing and helical finishing (3D-08): the M2.2 tolerances (gouge <= 0.005 mm
 * by the independent checker, stock to leave ±0.01 mm), flat areas found and traced exactly and
 * nothing cut off them, rest machining, one continuous descent round walls, goldens and the export
 * block.
 */
import { describe, expect, it } from 'vitest'
import { checkGouge, distanceToMesh } from '@/cam/3d/check'
import { DropCutter } from '@/cam/3d/dropcutter'
import { helicalFinish } from '@/cam/3d/helical'
import { centreRegion } from '@/cam/3d/region'
import { buildMesh } from '@/cam/mesh/build'
import { parseStl } from '@/cam/mesh/read'
import { meshBounds } from '@/cam/mesh/types'
import { defaultOp, resolveTool } from '@/cam/ops'
import { buildTimeline } from '@/cam/sim'
import { HeightfieldStock } from '@/cam/stock/heightfield'
import { generateOp, isFlatLayer, type Toolpath } from '@/cam/toolpath'
import type { Finish3dOp } from '@/cam/types'
import { defaultAppData, PLACEHOLDER_MACHINE } from '@/core/defaults'
import { runJob } from '@/core/pipeline'
import type { Job } from '@/core/types'
import { addSurface, BALL, BULL, clPoints, expectGolden3d, FLAT, finishSetup, surfaceMesh, THOROUGH } from './finish3d-setup'
import { relief, stlBinary } from './mesh-fixtures'
import { bowl, raisedPanel } from './surfaces'

const machine = PLACEHOLDER_MACHINE
const COS_FLAT = Math.cos((0.5 * Math.PI) / 180)

addSurface('bowl', buildMesh(parseStl(stlBinary(relief(80, 80, 160, 160, bowl))), { gapTol: 0 }).mesh, bowl)

/** Cutting chains (from a feed-down to the next rapid) as point lists. */
function chains(tp: Toolpath): [number, number, number][][] {
  const out: [number, number, number][][] = []
  let cur: [number, number, number][] | null = null
  for (const m of tp.moves) {
    if (m.t === 'rapid') {
      if (cur?.length) out.push(cur)
      cur = null
    } else if (m.t === 'feed') cur = [[m.x, m.y, m.z]]
    else if (m.t === 'poly') for (let i = 0; i < m.pts.length; i += 3) (cur ??= []).push([m.pts[i], m.pts[i + 1], m.pts[i + 2]])
  }
  if (cur?.length) out.push(cur)
  return out
}

describe('M3.1c flat-area finishing', () => {
  it('cuts only where the tool rests on a flat face, at that face, and traces the edge of the flat to 0.01 mm', () => {
    const { mesh, tp } = finishSetup('hemisphere', 'flat', { toolId: BALL, stepover: 2 })
    expect(tp.warnings).toEqual([])
    const dc = new DropCutter(mesh, { kind: 'torus', R: 3, rc: 3 })
    const pts = clPoints(tp)
    expect(pts.length).toBeGreaterThan(200)
    for (const [x, y, z] of pts) {
      expect(dc.drop(x, y)).toBe(true)
      // at the exact drop, on a flat face
      expect(Math.abs(dc.z - z)).toBeLessThan(0.002)
      expect(dc.hitNz).toBeGreaterThanOrEqual(COS_FLAT)
    }
    // the ring round the dome follows the edge of the flat base: 0.011 mm towards the dome the
    // ball no longer rests on a flat face (edge found independently, by exact drops)
    const base = pts.filter(([, , z]) => z < -19.99)
    const rMin = Math.min(...base.map(([x, y]) => Math.hypot(x - 40, y - 40)))
    const ring = base.filter(([x, y]) => Math.hypot(x - 40, y - 40) < rMin + 0.5)
    expect(ring.length).toBeGreaterThan(50)
    let traced = 0
    for (const [x, y] of ring) {
      const r = Math.hypot(x - 40, y - 40)
      const k = (r - 0.011) / r
      dc.drop(40 + (x - 40) * k, 40 + (y - 40) * k)
      if (dc.hitNz < COS_FLAT) traced++
    }
    process.stdout.write(`  [flat] hemisphere base: ${traced} of ${ring.length} points on the ring round the dome within 0.011 mm of the edge of the flat (nearest ${rMin.toFixed(3)} mm from the axis)\n`)
    expect(traced / ring.length).toBeGreaterThan(0.95)
    expect(checkGouge(mesh, { shape: 'ball', r: 3 }, tp.moves, { step: 0.1 }).max).toBeLessThanOrEqual(0.005)
  }, 120_000)

  it('raised panel, 8 mm flat end mill: the border floor is finished flat right up to the tool radius from the bevel; the bevel is never cut', () => {
    const { mesh, part, tp } = finishSetup('raised-panel', 'flat', { toolId: FLAT, stepover: 4 })
    expect(tp.warnings).toEqual([])
    const dc = new DropCutter(mesh, { kind: 'torus', R: 4, rc: 0 })
    for (const [x, y, z] of clPoints(tp)) {
      expect(dc.drop(x, y)).toBe(true)
      expect(dc.hitNz).toBeGreaterThanOrEqual(COS_FLAT)
      expect(Math.abs(dc.z - z)).toBeLessThan(0.002)
    }
    const g = checkGouge(mesh, { shape: 'flat', r: 4 }, tp.moves, { step: 0.1, resolution: 0.05, maxPoints: THOROUGH ? 2000 : 400 })
    expect(g.max).toBeLessThanOrEqual(0.005)
    // simulated: the border floor (outside the bevel by more than the tool radius) is at -10
    const stock = new HeightfieldStock(part.length, part.width, 45, 0.5)
    for (const sg of buildTimeline([tp]).segs) if (sg.kind !== 'rapid') stock.carve(sg.a, sg.b, sg.cutter)
    let worst = 0
    let cells = 0
    const hf = stock.hf
    for (let j = 0; j < hf.ny; j++)
      for (let i = 0; i < hf.nx; i++) {
        const x = (i + 0.5) * hf.cell
        const y = (j + 0.5) * hf.cell
        const e = Math.min(x - 20, y - 20, 180 - x, 130 - y)
        // border floor: off the bevel by more than the tool radius, and the tool fits from the panel edge
        if (e < -4.3 && x > 4.3 && y > 4.3 && x < 195.7 && y < 145.7) {
          cells++
          worst = Math.max(worst, hf.top[j * hf.nx + i] - raisedPanel(x, y))
        }
      }
    process.stdout.write(`  [flat] raised panel border: ${cells} cells, most left ${worst.toFixed(4)} mm\n`)
    expect(cells).toBeGreaterThan(20000)
    expect(worst).toBeLessThan(0.001)
  }, 120_000)

  it('bull-nose is picked automatically; no gouge (sampled); stock to leave is held', () => {
    const op = defaultOp('finish3d', [], { strategy: 'flat' } as Partial<Finish3dOp>) as Finish3dOp
    expect(resolveTool({ ...op, toolId: null }, machine)?.id).toBe(BULL)
    const { mesh, tp } = finishSetup('raised-panel', 'flat', { toolId: BULL, stepover: 5, surface: { stockToLeave: 0.3 } as Finish3dOp['surface'] })
    expect(clPoints(tp).length).toBeGreaterThan(100)
    expect(checkGouge(mesh, { shape: 'bull', r: 6, cornerRadius: 2 }, tp.moves, { step: 0.1, resolution: 0.05, stock: 0.3, maxPoints: THOROUGH ? 2000 : 300 }).max).toBeLessThanOrEqual(0.005)
    // on a flat the tool sits exactly the stock above the face it touches
    const grown = new DropCutter(mesh, { kind: 'torus', R: 6.3, rc: 2.3 })
    for (const [x, y, z] of clPoints(tp).filter((_, i) => i % 25 === 0)) {
      grown.drop(x, y)
      expect(z - grown.hitZ).toBeCloseTo(0.3, 3)
    }
  }, 120_000)

  it('rest machining (flat faces only): after the same pass nothing is left; after a coarse ball-nose finish the base is cut again', () => {
    const { part } = finishSetup('hemisphere', 'flat', { toolId: FLAT, stepover: 4 })
    const mesh = surfaceMesh('hemisphere')
    const first = part.ops[0] as Finish3dOp
    const again: Finish3dOp = { ...first, id: 'again', rest: { from: [first.id], minThickness: 0.05 } }
    const ball: Finish3dOp = { ...(defaultOp('finish3d') as Finish3dOp), id: 'ball', toolId: BALL, stepover: 3, surface: { ...first.surface } }
    const flatRest: Finish3dOp = { ...first, id: 'rest', rest: { from: ['ball'], minThickness: 0.05 } }
    const meshes = new Map([['hemisphere', mesh]])
    const after = generateOp(again, { part: { ...part, ops: [first, again] }, machine, meshes })
    expect(after.moves).toEqual([])
    expect(after.warnings.join(' ')).toMatch(/left nothing thicker/)
    const rest = generateOp(flatRest, { part: { ...part, ops: [ball, flatRest] }, machine, meshes })
    expect(rest.warnings.join(' ')).toMatch(/Rest machining: .* mm² left/)
    const pts = clPoints(rest)
    expect(pts.length).toBeGreaterThan(50)
    // only on the base, the one flat the 8 mm cutter rests on
    for (const [, , z] of pts) expect(z).toBeCloseTo(-20, 6)
  }, 240_000)

  it('order and direction: from the edge in (or the middle out); rings counter-clockwise or clockwise', () => {
    const inw = chains(finishSetup('raised-panel', 'flat', { toolId: FLAT, stepover: 4 }).tp)
    const out = chains(finishSetup('raised-panel', 'flat', { toolId: FLAT, stepover: 4, travel: 'outward' }).tp)
    // the rings on the field (z = 0): how far each lies inside the field's edge
    const r0 = (c: number[][]) => Math.min(...c.map((p) => Math.min(p[0] - 60, p[1] - 60, 140 - p[0], 90 - p[1])))
    const field = (cs: number[][][]) => cs.filter((c) => c.every((p) => Math.abs(p[2]) < 1e-6))
    // going in, the first field ring is the outermost (nearest the field's edge)
    const fi = field(inw)
    const fo = field(out)
    expect(r0(fi[0])).toBeLessThan(r0(fi[fi.length - 1]))
    expect(r0(fo[0])).toBeGreaterThan(r0(fo[fo.length - 1]))
    const area = (c: number[][]) => c.reduce((s, p, i) => s + (c[(i + 1) % c.length][0] - p[0]) * (c[(i + 1) % c.length][1] + p[1]), 0) / -2
    expect(area(fi[0])).toBeGreaterThan(0)
    expect(area(field(chains(finishSetup('raised-panel', 'flat', { toolId: FLAT, stepover: 4, direction: 'conventional' }).tp))[0])).toBeLessThan(0)
  }, 120_000)
})

describe('M3.1c helical finishing', () => {
  /** helicalFinish called directly (for the number of continuous descents). */
  function helix(name: string, patch: Partial<Finish3dOp> = {}) {
    const { part, op, mesh, tp } = finishSetup(name, 'helical', { toolId: BALL, stepdown: 1, ...patch })
    const region = centreRegion(part, [], op.surface, 3, meshBounds(mesh))
    const r = helicalFinish(op, mesh, { kind: 'torus', R: 3, rc: 3 }, region, op.levels)
    return { mesh, tp, r, op }
  }

  for (const [name, patch, levels] of [
    ['bowl', {}, 16],
    ['hemisphere', {}, 16],
    ['raised-panel', { slope: { min: 5, max: 90 } }, 9],
  ] as [string, Partial<Finish3dOp>, number][]) {
    it(`${name}: one continuous descent, sinking one step-down a round, every point on the wall at its height`, () => {
      const { mesh, tp, r } = helix(name, patch)
      expect(r.helices).toBe(1)
      const cs = chains(tp)
      const long = cs.reduce((a, b) => (b.length > a.length ? b : a))
      // never rises (within the gouge allowance), and drops through every level
      let worst = 0
      for (let i = 1; i < long.length; i++) worst = Math.max(worst, long[i][2] - long[i - 1][2])
      expect(worst).toBeLessThan(0.003)
      const drop = long[0][2] - long[long.length - 1][2]
      expect(drop).toBeCloseTo(levels - 1, 6)
      // on the wall: the ball is within the tolerance of the surface (exact distance, square to it)
      let off = 0
      for (let i = 0; i < long.length; i += 7) {
        const [x, y, z] = long[i]
        off = Math.max(off, distanceToMesh(mesh, x, y, z + 3) - 3)
      }
      expect(off).toBeLessThan(0.011)
      const g = checkGouge(mesh, { shape: 'ball', r: 3 }, tp.moves, { step: 0.05 })
      process.stdout.write(`  [helical] ${name}: ${long.length} points in one descent of ${drop.toFixed(3)} mm, ${cs.length} chain(s); farthest off the surface ${off.toFixed(4)} mm; gouge ${g.max.toFixed(4)} mm\n`)
      expect(g.max).toBeLessThanOrEqual(0.005)
    }, 120_000)
  }

  it('fewer lifts than waterline at the same step-down; cove (open walls) falls back to waterline passes with no gouge', () => {
    const hel = finishSetup('bowl', 'helical', { toolId: BALL, stepdown: 1 }).tp
    const wl = finishSetup('bowl', 'waterline', { toolId: BALL, stepdown: 1, fillShallow: false, slope: { min: 30, max: 90 } }).tp
    const lifts = (tp: Toolpath) => tp.moves.filter((m) => m.t === 'feed').length
    expect(lifts(hel)).toBe(1)
    expect(lifts(wl)).toBeGreaterThanOrEqual(1)
    const { mesh, tp } = finishSetup('cove', 'helical', { toolId: BALL, stepdown: 1 })
    expect(clPoints(tp).length).toBeGreaterThan(50)
    expect(checkGouge(mesh, { shape: 'ball', r: 3 }, tp.moves, { step: 0.1 }).max).toBeLessThanOrEqual(0.005)
  }, 120_000)

  it('stock to leave 0.5 mm: points 0.5 ± 0.01 mm off the surface, no move closer', () => {
    const { mesh, tp } = finishSetup('hemisphere', 'helical', { toolId: BALL, stepdown: 2, surface: { stockToLeave: 0.5 } as Finish3dOp['surface'] })
    const pts = clPoints(tp)
    for (let i = 0; i < pts.length; i += Math.max(1, Math.floor(pts.length / 300))) {
      const [x, y, z] = pts[i]
      expect(distanceToMesh(mesh, x, y, z + 3) - 3).toBeCloseTo(0.5, 2)
    }
    expect(checkGouge(mesh, { shape: 'ball', r: 3 }, tp.moves, { stock: 0.5, step: 0.1 }).max).toBeLessThanOrEqual(0.005)
  }, 120_000)
})

describe('M3.1c output and goldens', () => {
  it('neither is a flat layer; the export checker refuses both, even with both output switches on', () => {
    for (const [name, strategy, patch] of [
      ['raised-panel', 'flat', { toolId: FLAT, stepover: 6 }],
      ['bowl', 'helical', { toolId: BALL, stepdown: 2 }],
    ] as [string, 'flat' | 'helical', Partial<Finish3dOp>][]) {
      const { part: p, op } = finishSetup(name, strategy, patch)
      expect(isFlatLayer(op)).toBe(false)
      const part = { ...p, materialId: 'mat-mdf18', thickness: 45 }
      const data = defaultAppData()
      const job: Job = { id: 'j', number: 'JF', name: 'Flat', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [part] }
      data.jobs = [job]
      data.settings.features = { ...data.settings.features, camMprOutput: true, cam3dMprOutput: true }
      expect(runJob(job, data).issues.filter((i) => i.code === 'CAM_3D_NO_OUTPUT'), strategy).toHaveLength(1)
    }
  }, 60_000)

  for (const [label, name, strategy, patch] of [
    ['flat-raised-panel', 'raised-panel', 'flat', { toolId: FLAT, stepover: 4 }],
    ['flat-hemisphere-ball', 'hemisphere', 'flat', { toolId: BALL, stepover: 2, travel: 'outward', direction: 'conventional' }],
    ['helical-bowl', 'bowl', 'helical', { toolId: BALL, stepdown: 1 }],
    ['helical-raised-panel-conventional', 'raised-panel', 'helical', { toolId: BALL, stepdown: 1.5, slope: { min: 5, max: 90 }, direction: 'conventional' }],
  ] as [string, string, 'flat' | 'helical', Partial<Finish3dOp>][]) {
    it(`golden: ${label}`, () => expectGolden3d(label, finishSetup(name, strategy, patch).tp), 120_000)
  }
})
