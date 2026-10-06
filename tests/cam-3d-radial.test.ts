/**
 * M3.1a radial and spiral finishing (3D-05) on the analytic test surfaces: the M2.2 tolerances
 * (gouge <= 0.005 mm by the independent checker, stock to leave ±0.01 mm), the pass layout
 * (largest gap, spiral pitch), boundaries, inner radius, travel and direction, goldens and the
 * export block.
 */
import { describe, expect, it } from 'vitest'
import { checkGouge, distanceToMesh } from '@/cam/3d/check'
import { DropCutter } from '@/cam/3d/dropcutter'
import { radialLayout, spiralPoints } from '@/cam/3d/radial'
import { partCollisions } from '@/cam/collision/collision'
import { makeEntity, newPart, opInputHash, opState } from '@/cam/doc'
import { circle, pt } from '@/cam/geom'
import { DEFAULT_PLACEMENT } from '@/cam/mesh/place'
import { meshBounds } from '@/cam/mesh/types'
import { defaultOp } from '@/cam/ops'
import { buildTimeline } from '@/cam/sim'
import { HeightfieldStock } from '@/cam/stock/heightfield'
import { isFlatLayer, type Toolpath } from '@/cam/toolpath'
import type { CamPart, Finish3dOp } from '@/cam/types'
import { runTask } from '@/cam/worker/tasks'
import { newOpDefaults, opUnconfirmed } from '@/core/confirm'
import { defaultAppData, PLACEHOLDER_MACHINE } from '@/core/defaults'
import { runJob } from '@/core/pipeline'
import type { Job } from '@/core/types'
import { BALL, BULL, clPoints, expectGolden3d, FLAT, finishSetup, THOROUGH } from './finish3d-setup'
import { relief, stlBinary } from './mesh-fixtures'
import { hemisphere, SURFACES } from './surfaces'

const machine = PLACEHOLDER_MACHINE
const ring = (x: number, y: number, r: number) => makeEntity({ t: 'contour', c: circle(pt(x, y), r) }, 'outline')

/** Cutting chains (poly runs from a feed-down to the next rapid) as point lists. */
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

describe('M3.1a radial and spiral: no gouges on the analytic surfaces (independent check)', () => {
  for (const strategy of ['radial', 'spiral'] as const)
    for (const name of Object.keys(SURFACES)) {
      it(`${strategy} on ${name}, 6 mm ball-nose: deepest gouge <= 0.005 mm (exact check)`, () => {
        const { mesh, tp } = finishSetup(name, strategy, { stepover: 2 })
        expect(tp.warnings).toEqual([])
        expect(clPoints(tp).length).toBeGreaterThan(100)
        const g = checkGouge(mesh, { shape: 'ball', r: 3 }, tp.moves, { step: 0.1 })
        expect(g.exact).toBe(true)
        expect(g.max).toBeLessThanOrEqual(0.005)
        // the tool really rides the surface
        expect(g.minClearance).toBeLessThan(0.001)
      }, 120_000)
    }

  for (const [strategy, name, toolId, shape, r, cr] of [
    ['radial', 'sine', BULL, 'bull', 6, 2],
    ['spiral', 'raised-panel', BULL, 'bull', 6, 2],
    ['radial', 'cove', FLAT, 'flat', 4, 0],
    ['spiral', 'sine', FLAT, 'flat', 4, 0],
  ] as const) {
    it(`${strategy} on ${name}, ${shape}: deepest gouge <= 0.005 mm (sampled check)`, () => {
      const { mesh, tp } = finishSetup(name, strategy, { toolId, stepover: 4 })
      expect(clPoints(tp).length).toBeGreaterThan(50)
      const g = checkGouge(mesh, { shape, r, cornerRadius: cr }, tp.moves, { step: 0.1, resolution: 0.05, maxPoints: THOROUGH ? 1500 : 250 })
      expect(g.max).toBeLessThanOrEqual(0.005)
    }, 120_000)
  }
})

describe('M3.1a stock to leave and pass layout', () => {
  it('stock to leave 0.5 mm: every CL point is 0.5 ± 0.01 mm off the surface, and no move comes closer', () => {
    for (const strategy of ['radial', 'spiral'] as const)
      for (const name of ['sine', 'hemisphere']) {
        const { mesh, tp } = finishSetup(name, strategy, { surface: { stockToLeave: 0.5 } as Finish3dOp['surface'], stepover: 3 })
        const pts = clPoints(tp)
        expect(pts.length).toBeGreaterThan(100)
        for (let i = 0; i < pts.length; i += Math.max(1, Math.floor(pts.length / 300))) {
          const [x, y, z] = pts[i]
          expect(distanceToMesh(mesh, x, y, z + 3) - 3).toBeCloseTo(0.5, 2)
        }
        const g = checkGouge(mesh, { shape: 'ball', r: 3 }, tp.moves, { stock: 0.5, step: 0.1 })
        expect(g.max, `${strategy} ${name}`).toBeLessThanOrEqual(0.005)
      }
  }, 180_000)

  it('radial layout: at every radius the widest gap between neighbouring passes is at most the step-over', () => {
    for (const [rMax, step, inner] of [
      [56.57, 2, 0],
      [100, 0.6, 0],
      [30, 1.5, 5],
      [3, 2, 0],
    ]) {
      const lay = radialLayout(rMax, step, inner)
      expect(lay.n % 8).toBe(0)
      expect(lay.gap).toBeLessThanOrEqual(step + 1e-9)
      // passes are never doubled needlessly: halving the count would leave too wide a gap
      if (lay.n > 8) expect((2 * Math.PI * rMax) / (lay.n - 8)).toBeGreaterThan(step - 1e-9)
      let worst = 0
      for (let r = Math.max(inner, 0.05); r <= rMax; r += rMax / 400) {
        const on: number[] = []
        for (let k = 0; k < lay.n; k++) if (lay.start(k) <= r + 1e-9) on.push(k)
        let gap = 0
        for (let i = 0; i < on.length; i++) gap = Math.max(gap, (((on[(i + 1) % on.length] - on[i] + lay.n) % lay.n || lay.n) * 2 * Math.PI * r) / lay.n)
        worst = Math.max(worst, gap / step)
      }
      expect(worst, `rMax ${rMax} step ${step}`).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  it('radial passes lie on their rays from the centre, start where the layout says, and reach the edge of the model', () => {
    const { tp } = finishSetup('hemisphere', 'radial', { stepover: 2, pattern: 'oneway', travel: 'outward' })
    const c = { x: 40, y: 40 } // middle of the 80 x 80 model
    const lay = radialLayout(Math.hypot(40, 40), 2, 0)
    const cs = chains(tp)
    expect(cs.length).toBe(lay.n)
    let far = 0
    cs.forEach((ch, k) => {
      const a = (2 * Math.PI * k) / lay.n
      const r0 = Math.hypot(ch[0][0] - c.x, ch[0][1] - c.y)
      expect(r0).toBeGreaterThanOrEqual(lay.start(k) - 1e-6)
      expect(r0).toBeLessThan(lay.start(k) + 0.01)
      let prev = -1
      for (const [x, y] of ch) {
        // perpendicular distance from the ray, and moving outward
        expect(Math.abs(-(x - c.x) * Math.sin(a) + (y - c.y) * Math.cos(a))).toBeLessThan(1e-6)
        const r = Math.hypot(x - c.x, y - c.y)
        expect(r).toBeGreaterThan(prev - 1e-9)
        prev = r
      }
      far = Math.max(far, prev)
    })
    expect(far).toBeGreaterThan(Math.hypot(40, 40) - 0.01)
  }, 60_000)

  it('spiral: every point is on the spiral, turns exactly the step-over apart, out to the edge of the boundary', () => {
    const pitch = 1.5
    const { tp } = finishSetup('sine', 'spiral', { stepover: pitch, innerRadius: 2 }, [ring(75, 50, 30)])
    const pts = clPoints(tp)
    expect(pts.length).toBeGreaterThan(500)
    let worst = 0
    let far = 0
    for (const [x, y] of pts) {
      const r = Math.hypot(x - 75, y - 50)
      expect(r).toBeGreaterThanOrEqual(2 - 1e-6)
      far = Math.max(far, r)
      const th = Math.atan2(y - 50, x - 75)
      const k = (r - 2 - (pitch * ((th + 2 * Math.PI) % (2 * Math.PI))) / (2 * Math.PI)) / pitch
      worst = Math.max(worst, Math.abs(k - Math.round(k)) * pitch)
    }
    // (within the 0.0005 mm the plan spiral is divided to, plus rounding)
    expect(worst).toBeLessThan(0.001)
    expect(far).toBeGreaterThan(30 - 0.01)
    expect(far).toBeLessThanOrEqual(30 + 0.01)
    // the plan points themselves: on the curve, and the true curve between two of them never
    // more than 0.0005 mm from the straight piece joining them
    const b = 2 / (2 * Math.PI)
    const sp = spiralPoints({ x: 0, y: 0 }, 0, 20, 2, 0, true)
    let th = 0
    let dev = 0
    for (let i = 1; i < sp.length; i++) {
      let a = Math.atan2(sp[i].y, sp[i].x)
      while (a < th - 1e-9) a += 2 * Math.PI
      const r = Math.hypot(sp[i].x, sp[i].y)
      expect(Math.abs(r - b * a)).toBeLessThan(1e-9)
      const A = sp[i - 1]
      const B = sp[i]
      const L2 = (B.x - A.x) ** 2 + (B.y - A.y) ** 2
      for (let k = 1; k < 8; k++) {
        const t = th + ((a - th) * k) / 8
        const p = { x: b * t * Math.cos(t), y: b * t * Math.sin(t) }
        const f = Math.max(0, Math.min(1, ((p.x - A.x) * (B.x - A.x) + (p.y - A.y) * (B.y - A.y)) / L2))
        dev = Math.max(dev, Math.hypot(A.x + (B.x - A.x) * f - p.x, A.y + (B.y - A.y) * f - p.y))
      }
      th = a
    }
    expect(dev).toBeLessThan(0.00051)
  }, 60_000)

  it('boundaries: centre, contained and touching clip both strategies to the right circle', () => {
    for (const strategy of ['radial', 'spiral'] as const)
      for (const [mode, limit] of [
        ['centre', 30],
        ['contained', 27],
        ['touching', 33],
      ] as const) {
        const { tp } = finishSetup('sine', strategy, { surface: { boundaryMode: mode } as Finish3dOp['surface'], stepover: 1.5 }, [ring(75, 50, 30)])
        const rs = clPoints(tp).map(([x, y]) => Math.hypot(x - 75, y - 50))
        expect(Math.max(...rs), `${strategy} ${mode}`).toBeLessThanOrEqual(limit + 0.01)
        expect(Math.max(...rs), `${strategy} ${mode}`).toBeGreaterThan(limit - 0.5)
      }
  }, 120_000)

  it('travel and turn: outward starts at the centre, inward at the edge; climb turns counter-clockwise; zig-zag radial runs out and back', () => {
    const out = chains(finishSetup('sine', 'spiral', { stepover: 2 }, [ring(75, 50, 20)]).tp)
    const inw = chains(finishSetup('sine', 'spiral', { stepover: 2, travel: 'inward' }, [ring(75, 50, 20)]).tp)
    const rad = (p: number[]) => Math.hypot(p[0] - 75, p[1] - 50)
    expect(rad(out[0][0])).toBeLessThan(0.01)
    expect(rad(inw[0][0])).toBeGreaterThan(18)
    const turn = (ch: number[][]) => {
      let s = 0
      for (let i = 1; i < Math.min(ch.length, 200); i++) s += (ch[i - 1][0] - 75) * (ch[i][1] - 50) - (ch[i - 1][1] - 50) * (ch[i][0] - 75)
      return Math.sign(s)
    }
    expect(turn(out[0])).toBe(1)
    expect(turn(chains(finishSetup('sine', 'spiral', { stepover: 2, direction: 'conventional' }, [ring(75, 50, 20)]).tp)[0])).toBe(-1)
    // zig-zag radial: few lifts, passes alternate out and in
    const zz = finishSetup('hemisphere', 'radial', { stepover: 4 }).tp
    const ow = finishSetup('hemisphere', 'radial', { stepover: 4, pattern: 'oneway' }).tp
    expect(zz.moves.filter((m) => m.t === 'rapid').length).toBeLessThan(ow.moves.filter((m) => m.t === 'rapid').length)
  }, 120_000)

  it('inner radius: nothing is cut nearer the centre; the centre can be set', () => {
    const { tp } = finishSetup('hemisphere', 'radial', { stepover: 2, innerRadius: 8, centre: { x: 30, y: 45 } })
    for (const [x, y] of clPoints(tp)) expect(Math.hypot(x - 30, y - 45)).toBeGreaterThan(8 - 1e-6)
    const sp = finishSetup('hemisphere', 'spiral', { stepover: 2, innerRadius: 8, centre: { x: 30, y: 45 } }).tp
    for (const [x, y] of clPoints(sp)) expect(Math.hypot(x - 30, y - 45)).toBeGreaterThan(8 - 1e-6)
  }, 60_000)
})

describe('M3.1a associativity, output and goldens', () => {
  it('changing the centre, inner radius or travel marks the op stale; neither strategy is a flat layer', () => {
    const { part, op } = finishSetup('cove', 'radial')
    const tool = machine.tools.find((t) => t.id === BALL)!
    const built = { ...op, builtHash: opInputHash(op, part, tool, machine) }
    expect(opState(built, part, tool, machine)).toBe('current')
    expect(opState({ ...built, centre: { x: 1, y: 2 } }, part, tool, machine)).toBe('stale')
    expect(opState({ ...built, innerRadius: 3 }, part, tool, machine)).toBe('stale')
    expect(opState({ ...built, travel: 'inward' }, part, tool, machine)).toBe('stale')
    expect(isFlatLayer(op)).toBe(false)
    expect(isFlatLayer({ ...op, strategy: 'spiral' })).toBe(false)
  })

  it('the export checker refuses radial and spiral finishing for woodWOP, even with both output switches on', () => {
    for (const strategy of ['radial', 'spiral'] as const) {
      const { part: p } = finishSetup('sine', strategy, { stepover: 4 })
      const part = { ...p, materialId: 'mat-mdf18', thickness: 19 }
      const data = defaultAppData()
      const job: Job = { id: 'j', number: 'JR', name: 'Radial', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [part] }
      data.jobs = [job]
      data.settings.features = { ...data.settings.features, camMprOutput: true, cam3dMprOutput: true }
      const e = runJob(job, data).issues.filter((i) => i.code === 'CAM_3D_NO_OUTPUT')
      expect(e, strategy).toHaveLength(1)
      expect(e[0].severity).toBe('error')
    }
  })

  it('a new radial or spiral operation uses the shop step-over, shown with a Configure badge until confirmed', () => {
    for (const strategy of ['radial', 'spiral'] as const) {
      const op = { ...defaultOp('finish3d', [], { strategy } as Partial<Finish3dOp>), ...newOpDefaults('finish3d', machine, { strategy } as Partial<Finish3dOp>) } as Finish3dOp
      expect(op.strategy).toBe(strategy)
      const keys = opUnconfirmed(op, { id: 'p' }, machine, null).map((u) => u.target.kind === 'op' && u.target.key)
      expect(keys).toContain('finishStepover')
      expect(opUnconfirmed({ ...op, confirmed: ['finishStepover'] }, { id: 'p' }, machine, null).map((u) => u.target.kind === 'op' && u.target.key)).not.toContain('finishStepover')
    }
  })

  it('import to simulated stock: an STL dome, radial and spiral in the compute worker, simulated with no gouge and no collision; export blocked', async () => {
    const imp = await runTask('mesh.import', { bytes: stlBinary(relief(80, 80, 160, 160, hemisphere)), name: 'dome.stl', units: 'mm', up: '+z' })
    const b = meshBounds(imp.mesh)
    const part: CamPart = {
      ...newPart({ name: 'Dome', length: 80, width: 80, thickness: 30, materialId: 'mat-mdf18' }),
      models: [{ id: 'm', name: 'Dome', kind: 'mesh', blob: 'dome', source: 'dome.stl', units: 'mm', place: { ...DEFAULT_PLACEMENT, at: [b.min[0], b.min[1], b.max[2]] }, layer: 'models', visible: true, triangles: imp.mesh.indices.length / 3, size: [80, 80, 20] }],
    }
    const base = defaultOp('finish3d') as Finish3dOp
    part.ops = (['radial', 'spiral'] as const).map((strategy) => ({ ...base, id: strategy, name: strategy, strategy, toolId: BALL, stepover: 1.5, surface: { ...base.surface, modelId: 'm' } }))
    const tps = await runTask('cam.generate', { part, machine, opIds: part.ops.map((o) => o.id), meshes: { dome: imp.mesh } })
    for (const tp of tps) {
      expect(tp.warnings).toEqual([])
      const stock = new HeightfieldStock(80, 80, 30, 0.5)
      for (const sg of buildTimeline([tp]).segs) if (sg.kind !== 'rapid') stock.carve(sg.a, sg.b, sg.cutter)
      const hf = stock.hf
      // the model's own height (a needle dropped on the mesh): near the dome's upright rim the
      // facets of the STL differ from the formula by far more than the tolerance
      const needle = new DropCutter(imp.mesh, { kind: 'torus', R: 1e-4, rc: 0 })
      const surf = (x: number, y: number) => (needle.drop(x, y) ? needle.z : hemisphere(x, y))
      let gouge = 0
      let left = 0
      for (let j = 0; j < hf.ny; j++)
        for (let i = 0; i < hf.nx; i++) {
          const x = (i + 0.5) * hf.cell
          const y = (j + 0.5) * hf.cell
          const d = surf(x, y) - hf.top[j * hf.nx + i]
          gouge = Math.max(gouge, d)
          // flat to medium slopes (under 45°) are finished to a scallop well under 0.5 mm
          const r = Math.hypot(x - 40, y - 40)
          if ((r < 13 || r > 24) && x > 4 && y > 4 && x < 76 && y < 76) left = Math.max(left, -d)
        }
      process.stdout.write(`  [radial] ${tp.name}: simulated deepest below the model ${gouge.toFixed(4)} mm, most left on slopes under 45° ${left.toFixed(3)} mm, ${tp.moves.length} moves\n`)
      expect(gouge, tp.name).toBeLessThanOrEqual(0.005)
      expect(left, tp.name).toBeLessThan(0.5)
      expect(partCollisions(part, [tp], machine).found, tp.name).toEqual([])
    }
    const data = defaultAppData()
    const job: Job = { id: 'j', number: 'JR2', name: 'Dome', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [part] }
    data.jobs = [job]
    data.settings.features = { ...data.settings.features, camMprOutput: true, cam3dMprOutput: true }
    const e = runJob(job, data).issues.filter((i) => i.code === 'CAM_3D_NO_OUTPUT')
    expect(e).toHaveLength(1)
  }, 120_000)

  for (const [label, name, strategy, patch] of [
    ['radial-hemisphere', 'hemisphere', 'radial', { stepover: 2 }],
    ['radial-raised-panel-oneway', 'raised-panel', 'radial', { stepover: 3, pattern: 'oneway', innerRadius: 5, angle: 15 }],
    ['spiral-hemisphere', 'hemisphere', 'spiral', { stepover: 2 }],
    ['spiral-sine-bull-stock', 'sine', 'spiral', { stepover: 3, toolId: BULL, travel: 'inward', direction: 'conventional', surface: { stockToLeave: 0.25 } }],
  ] as [string, string, 'radial' | 'spiral', Partial<Finish3dOp>][]) {
    it(`golden: ${label}`, () => expectGolden3d(label, finishSetup(name, strategy, patch).tp), 60_000)
  }
})
