/**
 * Independent gouge check for rotary toolpaths (M3.3): how far the tool goes inside the model
 * (grown by the stock to leave) anywhere along the cutting moves, the tool standing square to the
 * axis and pointing at it. It shares no code with the rotary drop-cutter that made the path:
 *
 * - Ball-nose: exact. The ball's centre (in the part's frame) must stay at least its radius
 *   (+ stock) from the mesh; the distance comes from the mesh-distance grid.
 * - Flat, bull-nose and V: sampled. Points on the facets (corners, edges and an even grid inside,
 *   `resolution` apart) are turned into the tool's frame and compared with the cutter's underside
 *   from the simulator's `cutterZ` (the cutter grown by the stock, as in the 3-axis check).
 *
 * Moves are checked every `step` mm (on the machine's axes: along, round at the tip's radius, in).
 */
import { TriGrid } from '../mesh/distance'
import { type Mesh, triCount } from '../mesh/types'
import { type Cutter, cutterZ } from '../sim'
import { simpleMoves } from '../moves'
import type { Move } from '../toolpath'
import type { RotarySetup, WrappedPlane } from '../types'
import type { CheckTool, GougeReport } from '../3d/check'
import { axisFrame, fromCyl, planeToCyl } from './frame'

/** Tool positions (along, angle, tip's distance from the axis) along the cutting moves, at most `step` apart. */
export function* rotaryPositions(plane: WrappedPlane, moves: Move[], step: number): Generator<[number, number, number]> {
  let prev: { u: number; theta: number; rho: number } | null = null
  for (const m of simpleMoves(moves)) {
    if (m.t === 'drill' || m.t === 'arc') {
      prev = null
      continue
    }
    const c = planeToCyl(plane, m.x, m.y, m.z)
    if (m.t === 'rapid') {
      prev = c
      continue
    }
    if (prev) {
      const len = Math.max(Math.abs(c.u - prev.u), Math.abs(c.theta - prev.theta) * Math.max(prev.rho, c.rho), Math.abs(c.rho - prev.rho))
      const n = Math.max(1, Math.ceil(len / step))
      for (let i = 1; i <= n; i++) {
        const k = i / n
        yield [prev.u + (c.u - prev.u) * k, prev.theta + (c.theta - prev.theta) * k, prev.rho + (c.rho - prev.rho) * k]
      }
    } else yield [c.u, c.theta, c.rho]
    prev = c
  }
}

export function checkRotaryGouge(mesh: Mesh, setup: RotarySetup, plane: WrappedPlane, tool: CheckTool, moves: Move[], opt: { stock?: number; step?: number; resolution?: number; maxPoints?: number } = {}): GougeReport {
  const stock = Math.max(0, opt.stock ?? 0)
  const step = opt.step ?? 0.05
  const rep: GougeReport = { max: -Infinity, at: null, minClearance: Infinity, points: 0, exact: tool.shape === 'ball', resolution: 0 }
  const f = axisFrame(setup.axis)
  if (tool.shape === 'ball') {
    const grid = new TriGrid(mesh)
    const stamp = new Int32Array(triCount(mesh))
    let mark = 0
    const R = tool.r + stock
    for (const [u, th, rho] of rotaryPositions(plane, moves, step)) {
      rep.points++
      // the ball's centre: its radius out from the tip along the tool's axis
      const c = fromCyl(setup, u, th, rho + tool.r)
      const d = grid.nearest(c[0], c[1], c[2], stamp, ++mark, R + 1)
      const g = R - d
      if (g > rep.max) {
        rep.max = g
        rep.at = [u, th, rho]
      }
      rep.minClearance = Math.min(rep.minClearance, d - R)
    }
    return rep
  }
  const res = opt.resolution ?? Math.min(0.05, tool.r / 20)
  rep.resolution = res
  const c: Cutter =
    tool.shape === 'v'
      ? { r: tool.r, shape: 'v', angle: tool.angle ?? 90 }
      : { r: tool.r + stock, shape: 'bull', angle: 0, cornerRadius: (tool.shape === 'flat' ? 0 : (tool.cornerRadius ?? 0)) + stock }
  const lower = tool.shape === 'v' ? 0 : stock
  // sample points on every facet, in the frame round the axis, bucketed along the axis
  const p = mesh.positions
  const ix = mesh.indices
  const cx = setup.centre.x
  const cy = setup.centre.y
  const cz = setup.centre.z
  const pu: number[] = []
  const p0: number[] = []
  const p1: number[] = []
  for (let t = 0; t < triCount(mesh); t++) {
    const v = [0, 1, 2].map((k) => ix[t * 3 + k] * 3)
    const A = [p[v[0]], p[v[0] + 1], p[v[0] + 2]]
    const B = [p[v[1]], p[v[1] + 1], p[v[1] + 2]]
    const C = [p[v[2]], p[v[2] + 1], p[v[2] + 2]]
    const span = Math.max(Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]), Math.hypot(C[0] - A[0], C[1] - A[1], C[2] - A[2]), Math.hypot(C[0] - B[0], C[1] - B[1], C[2] - B[2]))
    const n = Math.max(1, Math.ceil(span / res))
    for (let a = 0; a <= n; a++)
      for (let b = 0; a + b <= n; b++) {
        const s = a / n
        const w = b / n
        const x = A[0] + (B[0] - A[0]) * s + (C[0] - A[0]) * w
        const y = A[1] + (B[1] - A[1]) * s + (C[1] - A[1]) * w
        const z = A[2] + (B[2] - A[2]) * s + (C[2] - A[2]) * w
        const d = [x - cx, y - cy, z - cz]
        pu.push(x * f.a[0] + y * f.a[1] + z * f.a[2])
        p0.push(d[0] * f.e0[0] + d[1] * f.e0[1] + d[2] * f.e0[2])
        p1.push(d[0] * f.e1[0] + d[1] * f.e1[1] + d[2] * f.e1[2])
      }
  }
  const cell = Math.max(c.r, 1)
  let umin = Infinity
  let umax = -Infinity
  for (const u of pu) {
    umin = Math.min(umin, u)
    umax = Math.max(umax, u)
  }
  const nb = Number.isFinite(umin) ? Math.max(1, Math.ceil((umax - umin) / cell) + 1) : 1
  const buckets: number[][] = Array.from({ length: nb }, () => [])
  pu.forEach((u, i) => buckets[Math.min(nb - 1, Math.floor((u - umin) / cell))].push(i))
  const all = [...rotaryPositions(plane, moves, step)]
  const stride = opt.maxPoints ? Math.max(1, Math.ceil(all.length / opt.maxPoints)) : 1
  for (let q = 0; q < all.length; q += stride) {
    const [u, th, rho] = all[q]
    rep.points++
    const ct = Math.cos(th)
    const st = Math.sin(th)
    const tip = rho - lower
    for (let b = Math.max(0, Math.floor((u - c.r - umin) / cell)); b <= Math.min(nb - 1, Math.floor((u + c.r - umin) / cell)); b++)
      for (const i of buckets[b]) {
        const du = pu[i] - u
        if (Math.abs(du) > c.r) continue
        const Y = -p0[i] * st + p1[i] * ct
        if (Math.abs(Y) > c.r) continue
        const d = Math.hypot(du, Y)
        if (d > c.r) continue
        const Z = p0[i] * ct + p1[i] * st
        const g = Z - cutterZ(c, tip, d)
        if (g > rep.max) {
          rep.max = g
          rep.at = [u, th, rho]
        }
        rep.minClearance = Math.min(rep.minClearance, -g)
      }
  }
  return rep
}
