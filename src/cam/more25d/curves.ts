/**
 * Curve cuts (2D-15): the surface between two curves, a tool tip following a 3D curve, and a 2D
 * path turned into a Z-wave. Pure geometry: each returns 3D chains of tool-tip points.
 *
 * Between two curves, the surface is the ruled surface joining the curves point for point (each
 * resampled by length). Passes run from one curve to the other; every point is an exact
 * drop-cutter position on that surface (`DropCutter`), and the straight moves between points are
 * refined until they stay within tolerance of the true tool-centre surface, as in 3D finishing.
 */
import type { P } from '../geom'
import { cutChains, type Pt, refineAlong } from '../3d/chain'
import type { Cutter3D } from '../3d/cutter'
import { DropCutter } from '../3d/dropcutter'
import { ruled, type V3 } from '../mesh/surface'

export type Chain3 = V3[]

const r3 = (n: number) => Math.round(n * 1000) / 1000

/** Length of a 3D polyline. */
export function length3(pts: V3[]): number {
  let L = 0
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2])
  return L
}

/** `n` points evenly spread by length along a 3D polyline (first and last kept). */
export function resample3(pts: V3[], n: number): V3[] {
  const L: number[] = [0]
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]))
  const total = L[L.length - 1]
  const out: V3[] = []
  let k = 1
  for (let i = 0; i < n; i++) {
    const s = (total * i) / (n - 1)
    while (k < pts.length - 1 && L[k] < s) k++
    const seg = L[k] - L[k - 1]
    const t = seg > 0 ? Math.min(1, Math.max(0, (s - L[k - 1]) / seg)) : 0
    const a = pts[k - 1]
    const b = pts[k]
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t])
  }
  return out
}

/** Catmull-Rom curve through 3D points (closed: back to the first), sampled until chords are within `tol`. */
export function smooth3(pts: V3[], closed: boolean, tol = 0.01): V3[] {
  if (pts.length < 3) return pts.map((p) => [...p] as V3)
  const P = closed ? [pts[pts.length - 1], ...pts, pts[0], pts[1]] : [pts[0], ...pts, pts[pts.length - 1]]
  const out: V3[] = [[...P[1]] as V3]
  for (let i = 1; i + 2 < P.length; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]]
    const span = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2])
    // enough pieces that the chord error of a curve bending through this span stays under tol
    const n = Math.max(2, Math.min(256, Math.ceil(span / Math.max(0.05, Math.sqrt(8 * Math.max(span, 1) * tol)))))
    for (let k = 1; k <= n; k++) {
      const t = k / n
      const t2 = t * t
      const t3 = t2 * t
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), f(p0[2], p1[2], p2[2], p3[2])])
    }
  }
  return out
}

/** Signed area of a closed polyline in plan (counter-clockwise positive). */
function planArea(pts: V3[]): number {
  let a = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]
  return a / 2
}

/**
 * Line the two curves up: open curves run the same way (the one that gives the shorter rungs),
 * closed curves both counter-clockwise in plan and the second starting nearest the first's start.
 * Closed curves come back closed (first point repeated at the end).
 */
export function alignCurves(a0: V3[], b0: V3[], closed: boolean): [V3[], V3[]] {
  let a = a0.map((p) => [...p] as V3)
  let b = b0.map((p) => [...p] as V3)
  const d = (p: V3, q: V3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
  if (!closed) {
    if (d(a[0], b[b.length - 1]) + d(a[a.length - 1], b[0]) < d(a[0], b[0]) + d(a[a.length - 1], b[b.length - 1])) b.reverse()
    return [a, b]
  }
  const open = (c: V3[]) => (d(c[0], c[c.length - 1]) < 1e-9 ? c.slice(0, -1) : c)
  a = open(a)
  b = open(b)
  if (planArea(a) < 0) a.reverse()
  if (planArea(b) < 0) b.reverse()
  let k = 0
  for (let i = 1; i < b.length; i++) if (d(a[0], b[i]) < d(a[0], b[k])) k = i
  b = [...b.slice(k), ...b.slice(0, k)]
  return [
    [...a, a[0]],
    [...b, b[0]],
  ]
}

export interface BetweenResult {
  chains: Chain3[]
  warnings: string[]
  /** Passes planned. */
  passes: number
}

/**
 * Finish the ruled surface between curves `a` and `b` with passes from `a` to `b` no more than
 * `stepover` apart (measured on the surface), each a drop-cutter chain on that surface.
 */
export function betweenCurves(a0: V3[], b0: V3[], closed: boolean, cutter: Cutter3D, o: { stepover: number; zigzag: boolean; tol: number }): BetweenResult {
  const warnings: string[] = []
  if (a0.length < 2 || b0.length < 2) return { chains: [], warnings: ['Pick two curves (open or closed shapes, or 3D polylines).'], passes: 0 }
  const [a, b] = alignCurves(a0, b0, closed)
  const step0 = Math.min(0.5, Math.max(0.05, cutter.R / 3))
  const n = Math.max(2, Math.min(4000, Math.ceil(Math.max(length3(a), length3(b)) / step0) + 1))
  const A = resample3(a, n)
  const B = resample3(b, n)
  const mesh = ruled(A, B, { n })
  const dc = new DropCutter(mesh, cutter)
  let gap = 0
  for (let i = 0; i < n; i++) gap = Math.max(gap, Math.hypot(A[i][0] - B[i][0], A[i][1] - B[i][1], A[i][2] - B[i][2]))
  const passes = Math.max(1, Math.ceil(gap / Math.max(0.01, o.stepover) - 1e-9))
  const tol = Math.max(0.001, o.tol)
  const gougeTol = Math.min(tol, 0.002)
  const chains: Chain3[] = []
  let off = false
  for (let k = 0; k <= passes; k++) {
    const t = k / passes
    // the pass in plan: the rung points at t, as a polyline parametrised by its length
    const plan: P[] = A.map((p, i) => ({ x: p[0] + (B[i][0] - p[0]) * t, y: p[1] + (B[i][1] - p[1]) * t }))
    const L: number[] = [0]
    for (let i = 1; i < plan.length; i++) L.push(L[i - 1] + Math.hypot(plan[i].x - plan[i - 1].x, plan[i].y - plan[i - 1].y))
    const total = L[L.length - 1]
    if (total < 1e-9) continue
    let seg = 1
    const at = (s: number): Pt => {
      while (seg > 1 && L[seg - 1] > s) seg--
      while (seg < plan.length - 1 && L[seg] < s) seg++
      const l = L[seg] - L[seg - 1]
      const f = l > 0 ? Math.min(1, Math.max(0, (s - L[seg - 1]) / l)) : 0
      const x = plan[seg - 1].x + (plan[seg].x - plan[seg - 1].x) * f
      const y = plan[seg - 1].y + (plan[seg].y - plan[seg - 1].y) * f
      const ok = dc.drop(x, y)
      if (!ok) off = true
      return { x, y, z: ok ? dc.z : NaN, ok, cut: ok, prot: false }
    }
    const pts = refineAlong(at, 0, total, step0, tol, gougeTol)
    for (const c of cutChains(pts)) {
      const ch: Chain3 = c.map((p) => [p.x, p.y, p.z])
      chains.push(o.zigzag && k % 2 === 1 ? ch.reverse() : ch)
    }
  }
  if (off) warnings.push('Parts of some passes fall off the surface between the curves and are left out.')
  warnings.push(`${passes + 1} passes between the curves, at most ${r3(gap / passes)} mm apart.`)
  return { chains, warnings, passes: passes + 1 }
}

/**
 * Depth of a Z-wave at distance `s` along the path: from `min` at s = 0 down to `max` at half a
 * wave and back up at a whole one.
 */
export function waveDepth(s: number, w: { min: number; max: number; length: number; shape: 'sine' | 'triangle' }): number {
  const L = Math.max(1e-6, w.length)
  const ph = (((s / L) % 1) + 1) % 1
  const k = w.shape === 'triangle' ? 1 - Math.abs(1 - 2 * ph) : (1 - Math.cos(2 * Math.PI * ph)) / 2
  return w.min + (w.max - w.min) * k
}

/**
 * A 2D path (points, closed or open) as a Z-wave: tool-tip points at most `max(0.05, length/32)` mm
 * apart (finer where the chord error would pass `tol`), z = -depth. A closed path gets a whole
 * number of waves (the length is adjusted to the nearest) so it joins up.
 */
export function zWave(pts: P[], closed: boolean, w: { min: number; max: number; length: number; shape: 'sine' | 'triangle' }, tol = 0.01): { chain: Chain3; length: number } {
  const path = closed && pts.length ? [...pts, pts[0]] : pts
  const L: number[] = [0]
  for (let i = 1; i < path.length; i++) L.push(L[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y))
  const total = L[L.length - 1]
  if (total < 1e-9) return { chain: [], length: w.length }
  const length = closed ? total / Math.max(1, Math.round(total / Math.max(1e-6, w.length))) : w.length
  const ww = { ...w, length }
  // chord error of a sine of amplitude a and wavelength l at spacing h: about a (pi h / l)^2 / 2
  const amp = Math.abs(w.max - w.min) / 2
  const h = Math.max(0.05, Math.min(length / 32, amp > 0 ? (length / Math.PI) * Math.sqrt((2 * tol) / amp) : length / 32))
  const out: Chain3 = []
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]
    const b = path[i + 1]
    const seg = L[i + 1] - L[i]
    const n = Math.max(1, Math.ceil(seg / h))
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const s = L[i] + (seg * k) / n
      out.push([a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n, -waveDepth(s, ww)])
    }
  }
  return { chain: out, length }
}
