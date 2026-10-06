/**
 * M3.1b scallop finishing (3D-07): the cusp holds within ±10 % of the target over the whole test
 * surface, measured independently (material left along the surface normal under the balls the
 * cutting moves sweep, `tests/cusp.ts`), plus the M2.2 tolerances (gouge <= 0.005 mm by the
 * independent checker, stock to leave ±0.01 mm), the spacing maths, refusals, start shapes,
 * order, goldens and the export block.
 */
import { describe, expect, it } from 'vitest'
import { checkGouge, distanceToMesh } from '@/cam/3d/check'
import { centreRegion } from '@/cam/3d/region'
import { cuspSpacing, flatCusp, scallopFinish } from '@/cam/3d/scallop'
import { makeEntity, opInputHash, opState } from '@/cam/doc'
import { polyline, pt } from '@/cam/geom'
import { buildMesh } from '@/cam/mesh/build'
import { parseStl } from '@/cam/mesh/read'
import { meshBounds } from '@/cam/mesh/types'
import { isFlatLayer } from '@/cam/toolpath'
import type { Finish3dOp } from '@/cam/types'
import { defaultAppData, PLACEHOLDER_MACHINE } from '@/core/defaults'
import { runJob } from '@/core/pipeline'
import type { Job } from '@/core/types'
import { crossRidges, type CrossRidge, SweptBalls } from './cusp'
import { addSurface, BALL, BULL, clPoints, expectGolden3d, FLAT, finishSetup, surfaceMesh, THOROUGH } from './finish3d-setup'
import { relief, stlBinary } from './mesh-fixtures'
import { bumps, SURFACES } from './surfaces'

const machine = PLACEHOLDER_MACHINE
const STEP = 1.2
const H0 = flatCusp(3, STEP)

addSurface('bumps', buildMesh(parseStl(stlBinary(relief(150, 100, 300, 200, bumps))), { gapTol: 0 }).mesh, bumps)

type Pass = { level: number; pts: { x: number; y: number }[] }

/** Points every 0.2 mm along the passes the generator marks as crease or repair passes (no level). */
function creasePoints(passes: Pass[]) {
  const out: { x: number; y: number }[] = []
  for (const p of passes.filter((q) => Number.isNaN(q.level)))
    for (let i = 1; i < p.pts.length; i++) {
      const A = p.pts[i - 1]
      const B = p.pts[i]
      const n = Math.max(1, Math.ceil(Math.hypot(B.x - A.x, B.y - A.y) / 0.2))
      for (let k = 0; k <= n; k++) out.push({ x: A.x + ((B.x - A.x) * k) / n, y: A.y + ((B.y - A.y) * k) / n })
    }
  return out
}

/** Points where a pass turns by more than 60° within a millimetre either way (corners, loop ends). */
function sharpPoints(passes: Pass[]) {
  const out: { x: number; y: number }[] = []
  for (const p of passes) {
    const s: { x: number; y: number }[] = []
    for (let i = 1; i < p.pts.length; i++) {
      const A = p.pts[i - 1]
      const B = p.pts[i]
      const n = Math.max(1, Math.ceil(Math.hypot(B.x - A.x, B.y - A.y) / 0.25))
      for (let k = i === 1 ? 0 : 1; k <= n; k++) s.push({ x: A.x + ((B.x - A.x) * k) / n, y: A.y + ((B.y - A.y) * k) / n })
    }
    for (let i = 4; i + 4 < s.length; i++) {
      const a = Math.atan2(s[i].y - s[i - 4].y, s[i].x - s[i - 4].x)
      const b = Math.atan2(s[i + 4].y - s[i].y, s[i + 4].x - s[i].x)
      let d = Math.abs(b - a)
      if (d > Math.PI) d = 2 * Math.PI - d
      if (d > Math.PI / 3) out.push(s[i])
    }
  }
  return out
}

/** Points of the innermost loops: closed passes narrower than 1.5 spacings (where the passes close in). */
function thinLoopPoints(passes: Pass[]) {
  const out: { x: number; y: number }[] = []
  for (const p of passes) {
    const pts = p.pts
    if (pts.length < 3 || Math.hypot(pts[0].x - pts.at(-1)!.x, pts[0].y - pts.at(-1)!.y) > 1e-6) continue
    let area = 0
    let per = 0
    for (let i = 1; i < pts.length; i++) {
      area += (pts[i].x - pts[i - 1].x) * (pts[i].y + pts[i - 1].y)
      per += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    }
    // width of a thin loop: about twice its area over its length round
    if ((2 * Math.abs(area / 2)) / (per / 2) < 1.5 * STEP) out.push(...pts)
  }
  return out
}

/** Scallop passes on a surface (generator called directly so the passes come with their levels). */
function scallopOn(name: string, starts: { pts: { x: number; y: number }[]; closed: boolean }[] = [], patch: Partial<Finish3dOp> = {}) {
  const { part, op } = finishSetup(name, 'scallop', { stepover: STEP, ...patch })
  const mesh = surfaceMesh(name)
  const region = centreRegion(part, op.geometry, op.surface, 3, meshBounds(mesh))
  const t0 = performance.now()
  const r = scallopFinish(op, mesh, { kind: 'torus', R: 3, rc: 3 }, region, op.levels, starts)
  return { r, mesh, ms: performance.now() - t0 }
}

/** Every ridge, and the regular ones: between two passes one whole level apart, away from creases, sharp turns and the innermost loops. */
function measure(name: string, starts: { pts: { x: number; y: number }[]; closed: boolean }[] = []) {
  const { r, mesh, ms } = scallopOn(name, starts)
  const ridges = crossRidges(new SweptBalls(r.moves, 3), mesh, r.passes, { every: 4, reach: 6, step: 0.01, touch: 0.15 * H0 })
  const near = [...creasePoints(r.passes), ...sharpPoints(r.passes), ...thinLoopPoints(r.passes)]
  // bins for the nearness test
  const bins = new Map<string, { x: number; y: number }[]>()
  for (const q of near) {
    const k = `${Math.floor(q.x / 2)},${Math.floor(q.y / 2)}`
    let b = bins.get(k)
    if (!b) bins.set(k, (b = []))
    b.push(q)
  }
  const isNear = (q: CrossRidge) => {
    for (let j = Math.floor(q.y / 2) - 1; j <= Math.floor(q.y / 2) + 1; j++)
      for (let i = Math.floor(q.x / 2) - 1; i <= Math.floor(q.x / 2) + 1; i++) for (const c of bins.get(`${i},${j}`) ?? []) if (Math.hypot(c.x - q.x, c.y - q.y) < 1.5 * STEP) return true
    return false
  }
  const regular = ridges.filter((q) => Number.isInteger(q.a) && Number.isInteger(q.b) && Math.abs(q.a - q.b) === 1 && !isNear(q))
  const ratios = (xs: CrossRidge[]) => xs.map((q) => q.h / H0).sort((a, b) => a - b)
  return { r, all: ratios(ridges), regular: ratios(regular), ms }
}

const pct = (xs: number[]) => ((100 * xs.filter((v) => Math.abs(v - 1) <= 0.1).length) / Math.max(1, xs.length)).toFixed(1)

describe('M3.1b scallop: the cusp holds within ±10 % over the whole test surface (independent measurement)', () => {
  for (const [name, label, starts] of [
    ['bumps', 'hill and hollow, from the boundary', []],
    ['sine', 'sine relief, from the boundary', []],
    ['bumps', 'hill and hollow, from a start line along one edge', [{ pts: [pt(0, -5), pt(0, 105)], closed: false }]],
  ] as [string, string, { pts: { x: number; y: number }[]; closed: boolean }[]][]) {
    it(`${label}: no ridge anywhere over +10 %; between whole levels within ±10 %`, () => {
      const { r, all, regular, ms } = measure(name, starts)
      expect(r.warnings).toEqual([])
      process.stdout.write(
        `  [scallop] ${name} ${starts.length ? 'start line' : 'boundary'}: target ${H0.toFixed(4)} mm, ${r.passes.length} passes, ${(ms / 1000).toFixed(1)} s; ` +
          `all ${all.length} ridges ${all[0].toFixed(3)}-${all.at(-1)!.toFixed(3)} (${pct(all)} % within ±10 %); ` +
          `between whole levels away from creases, turns and innermost loops ${regular.length}: ${regular[0].toFixed(3)}-${regular.at(-1)!.toFixed(3)}, median ${regular[regular.length >> 1].toFixed(3)} (${pct(regular)} %)\n`,
      )
      expect(all.length).toBeGreaterThan(5000)
      // upper bound everywhere: no ridge higher than the target + 10 %
      expect(all.at(-1)!).toBeLessThanOrEqual(1.1)
      // the passes one level apart hold the cusp; by creases, corners, loop ends and the innermost
      // loops the passes come closer (lower ridges, never higher)
      expect(regular.length).toBeGreaterThan(0.7 * all.length)
      expect(regular[0]).toBeGreaterThanOrEqual(0.9)
      expect(regular.at(-1)!).toBeLessThanOrEqual(1.1)
      expect(Math.abs(regular[regular.length >> 1] - 1)).toBeLessThan(0.02)
    }, 240_000)
  }

  it('the spacing maths: on a sphere (convex and concave, ball 3 mm) the cusp of the spacing found is the target within 1 %', () => {
    expect(flatCusp(3, 1.2)).toBeCloseTo(3 - Math.sqrt(9 - 0.36), 12)
    expect(cuspSpacing(3, flatCusp(3, 1.2), 1.2, 0)).toBeCloseTo(1.2, 9)
    for (const rho of [15, 20, 40, 100])
      for (const convex of [true, false]) {
        const R = 3
        const h = flatCusp(R, 1.2)
        // tool-centre sphere: radius rho + R round a hill, rho - R inside a bowl
        const rc = convex ? rho + R : rho - R
        const d0 = 1.2
        const s0 = (convex ? 1 : -1) * (rc - Math.sqrt(rc * rc - (d0 * d0) / 4))
        const d = cuspSpacing(R, h, d0, s0)
        // exact cusp of two balls d apart on that sphere
        const m = Math.sqrt(rc * rc - (d * d) / 4)
        const w = Math.sqrt(R * R - (d * d) / 4)
        const cusp = convex ? m - w - rho : rho - (m + w)
        expect(cusp / h, `rho ${rho} ${convex ? 'hill' : 'bowl'}`).toBeGreaterThan(0.99)
        expect(cusp / h).toBeLessThan(1.01)
        // and the hill needs wider passes than the flat, the bowl closer ones
        expect(convex ? d > 1.2 : d < 1.2).toBe(true)
      }
  })
})

describe('M3.1b no gouges, stock to leave, refusals', () => {
  for (const name of Object.keys(SURFACES)) {
    it(`${name}, 6 mm ball-nose: deepest gouge <= 0.005 mm (exact check)`, () => {
      const { mesh, tp } = finishSetup(name, 'scallop', { stepover: 1.5 })
      expect(tp.warnings).toEqual([])
      expect(clPoints(tp).length).toBeGreaterThan(100)
      const g = checkGouge(mesh, { shape: 'ball', r: 3 }, tp.moves, { step: 0.1 })
      expect(g.max).toBeLessThanOrEqual(0.005)
      expect(g.minClearance).toBeLessThan(0.001)
    }, 180_000)
  }

  it('bull-nose: spaced for its corner radius (said so), no gouge (sampled check)', () => {
    const { mesh, tp } = finishSetup('sine', 'scallop', { toolId: BULL, stepover: 2 })
    expect(tp.warnings.join(' ')).toMatch(/corner radius/)
    expect(clPoints(tp).length).toBeGreaterThan(100)
    const g = checkGouge(mesh, { shape: 'bull', r: 6, cornerRadius: 2 }, tp.moves, { step: 0.1, resolution: 0.05, maxPoints: THOROUGH ? 1500 : 250 })
    expect(g.max).toBeLessThanOrEqual(0.005)
  }, 120_000)

  it('stock to leave 0.5 mm: CL points 0.5 ± 0.01 mm off the surface, and no move comes closer', () => {
    const { mesh, tp } = finishSetup('sine', 'scallop', { stepover: 1.5, surface: { stockToLeave: 0.5 } as Finish3dOp['surface'] })
    const pts = clPoints(tp)
    for (let i = 0; i < pts.length; i += Math.max(1, Math.floor(pts.length / 300))) {
      const [x, y, z] = pts[i]
      expect(distanceToMesh(mesh, x, y, z + 3) - 3).toBeCloseTo(0.5, 2)
    }
    expect(checkGouge(mesh, { shape: 'ball', r: 3 }, tp.moves, { stock: 0.5, step: 0.1 }).max).toBeLessThanOrEqual(0.005)
  }, 120_000)

  it('a flat end mill, a V cutter or a step-over as wide as the rounded end are refused with a clear message', () => {
    for (const [patch, msg] of [
      [{ toolId: FLAT }, /ball-nose or bull-nose/],
      [{ toolId: 't104' }, /ball-nose or bull-nose/],
      [{ stepover: 6 }, /must be less than/],
    ] as [Partial<Finish3dOp>, RegExp][]) {
      const { tp } = finishSetup('sine', 'scallop', patch)
      expect(tp.moves).toEqual([])
      expect(tp.warnings.join(' ')).toMatch(msg)
    }
  })
})

describe('M3.1b start shapes, order, associativity, output, goldens', () => {
  it('passes start from picked shapes and work away from them; a missing start shape is reported', () => {
    const line = makeEntity({ t: 'contour', c: polyline([pt(75, 0), pt(75, 100)], false) }, 'outline')
    const { part, op } = finishSetup('sine', 'scallop', { stepover: 2 })
    part.entities = [...part.entities, line]
    const withStart = { ...op, startFrom: [line.id] }
    const mesh = surfaceMesh('sine')
    const region = centreRegion(part, [], op.surface, 3, meshBounds(mesh))
    const r = scallopFinish(withStart, mesh, { kind: 'torus', R: 3, rc: 3 }, region, op.levels, [{ pts: [pt(75, 0), pt(75, 100)], closed: false }])
    // the first pass is the start line itself, the next ones either side of it
    expect(r.passes[0].level).toBe(0)
    expect(r.passes[0].pts.every((q) => Math.abs(q.x - 75) < 1e-9)).toBe(true)
    const lv1 = r.passes.filter((p) => p.level === 1)
    expect(lv1.length).toBe(2)
    for (const p of lv1) expect(Math.abs(Math.abs(p.pts[p.pts.length >> 1].x - 75) - 2)).toBeLessThan(0.3)
    // through the generator: same start, and a missing one is said
    const tp = finishSetup('sine', 'scallop', { stepover: 2 }).tp
    expect(tp.warnings).toEqual([])
    const tool = machine.tools.find((t) => t.id === BALL)!
    const built = { ...withStart, builtHash: opInputHash(withStart, part, tool, machine) }
    expect(opState(built, part, tool, machine)).toBe('current')
    const moved = { ...part, entities: part.entities.map((e) => (e.id === line.id ? { ...e, g: { t: 'contour' as const, c: polyline([pt(70, 0), pt(70, 100)], false) } } : e)) }
    expect(opState(built, moved, tool, machine)).toBe('stale')
    const { tp: missing } = finishSetup('sine', 'scallop', { stepover: 2, startFrom: ['gone'] })
    expect(missing.warnings.join(' ')).toMatch(/start shape\(s\) are missing/)
    expect(isFlatLayer(withStart)).toBe(false)
  }, 120_000)

  it('order: in from the boundary first, or from the middle out; loops counter-clockwise (climb) or clockwise', () => {
    const inw = scallopOn('sine', [], { stepover: 3 }).r
    const out = scallopOn('sine', [], { stepover: 3, travel: 'outward' }).r
    const lv = (r: typeof inw) => r.passes.filter((p) => Number.isFinite(p.level)).map((p) => p.level)
    const a = lv(inw)
    const b = lv(out)
    expect(a[0]).toBe(0)
    expect([...a].sort((x, y) => x - y)).toEqual(a)
    expect([...b].sort((x, y) => y - x)).toEqual(b)
    const area = (pts: { x: number; y: number }[]) => pts.reduce((s, p, i) => s + (pts[(i + 1) % pts.length].x - p.x) * (pts[(i + 1) % pts.length].y + p.y), 0) / -2
    expect(area(inw.passes[0].pts)).toBeGreaterThan(0)
    expect(area(scallopOn('sine', [], { stepover: 3, direction: 'conventional' }).r.passes[0].pts)).toBeLessThan(0)
  }, 120_000)

  it('the export checker refuses scallop finishing for woodWOP, even with both output switches on', () => {
    const { part: p } = finishSetup('sine', 'scallop', { stepover: 3 })
    const part = { ...p, materialId: 'mat-mdf18', thickness: 19 }
    const data = defaultAppData()
    const job: Job = { id: 'j', number: 'JS', name: 'Scallop', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [part] }
    data.jobs = [job]
    data.settings.features = { ...data.settings.features, camMprOutput: true, cam3dMprOutput: true }
    const e = runJob(job, data).issues.filter((i) => i.code === 'CAM_3D_NO_OUTPUT')
    expect(e).toHaveLength(1)
  })

  for (const [label, name, patch] of [
    ['scallop-sine', 'sine', { stepover: 2 }],
    ['scallop-bumps-outward', 'bumps', { stepover: 2.5, travel: 'outward', direction: 'conventional' }],
    ['scallop-raised-panel-bull', 'raised-panel', { stepover: 2, toolId: BULL, surface: { stockToLeave: 0.2 } }],
  ] as [string, string, Partial<Finish3dOp>][]) {
    it(`golden: ${label}`, () => expectGolden3d(label, finishSetup(name, 'scallop', patch).tp), 120_000)
  }
})
