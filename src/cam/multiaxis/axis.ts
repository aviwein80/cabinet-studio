/**
 * Tool-axis rules (5AX-02, M3.5) as the built-in preview engine applies them, and small vector and
 * curve helpers shared by the 5-axis code. Our own definitions (see `ToolAxisControl`): every
 * direction is a unit vector from the tool tip towards the spindle, part coordinates.
 *
 * Pure: no DOM, no React.
 */
import type { ToolAxisControl } from '../types'
import type { Curve3 } from './engine'

export type V3 = [number, number, number]

export const Z: V3 = [0, 0, 1]
export const DEG = Math.PI / 180

export const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const add = (a: readonly number[], b: readonly number[]): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const mul = (a: readonly number[], s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
export const len = (a: readonly number[]) => Math.hypot(a[0], a[1], a[2])

/** Unit vector, or `fallback` when a is (nearly) zero. */
export function unit(a: readonly number[], fallback: V3 = Z): V3 {
  const l = len(a)
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [...fallback]
}

/** Angle between two unit vectors, degrees. */
export function angleDeg(a: readonly number[], b: readonly number[]): number {
  // atan2 of the cross and dot products: accurate for small angles too
  return (Math.atan2(len(cross(a, b)), dot(a, b)) * 180) / Math.PI
}

/** Tilt from vertical, degrees. */
export const tiltDeg = (a: readonly number[]) => angleDeg(a, Z)

/** Turn unit vector a towards unit vector b by the share k (0 = a, 1 = b) along the great circle. */
export function slerp(a: readonly number[], b: readonly number[], k: number): V3 {
  const th = Math.atan2(len(cross(a, b)), dot(a, b))
  if (th < 1e-12) return unit(b)
  if (Math.PI - th < 1e-9) {
    // opposite: turn through any direction square to a
    const s = unit(cross(a, Math.abs(a[2]) < 0.9 ? Z : [1, 0, 0]))
    return unit(add(mul(a, Math.cos(th * k)), mul(s, Math.sin(th * k))))
  }
  const sa = Math.sin((1 - k) * th) / Math.sin(th)
  const sb = Math.sin(k * th) / Math.sin(th)
  return unit(add(mul(a, sa), mul(b, sb)))
}

// ---------------------------------------------------------------------------------------------
// Curves
// ---------------------------------------------------------------------------------------------

/** Length of a curve, and the distance along it at each point. */
export function curveLengths(c: Curve3): number[] {
  const L = [0]
  for (let i = 1; i < c.length; i++) L.push(L[i - 1] + len(sub(c[i], c[i - 1])))
  return L
}

/** The point at share s (0..1) of a curve's length. */
export function curveAt(c: Curve3, s: number, L = curveLengths(c)): V3 {
  if (c.length === 1) return [...c[0]]
  const total = L[L.length - 1]
  const t = Math.max(0, Math.min(1, s)) * total
  let i = 1
  while (i < c.length - 1 && L[i] < t) i++
  const seg = L[i] - L[i - 1]
  const k = seg > 1e-12 ? (t - L[i - 1]) / seg : 0
  return add(c[i - 1], mul(sub(c[i], c[i - 1]), k))
}

/** A curve with no piece longer than `step` (its own points kept). */
export function resample(c: Curve3, step: number): Curve3 {
  if (c.length < 2) return c.map((p) => [...p] as V3)
  const out: Curve3 = [[...c[0]]]
  for (let i = 1; i < c.length; i++) {
    const d = len(sub(c[i], c[i - 1]))
    if (d < 1e-9) continue
    const n = Math.max(1, Math.ceil(d / step))
    for (let k = 1; k <= n; k++) out.push(add(c[i - 1], mul(sub(c[i], c[i - 1]), k / n)))
  }
  return out
}

/** Direction of travel at each point (from its neighbours), unit. */
export function tangents(c: Curve3): V3[] {
  return c.map((_, i) => {
    const a = c[Math.max(0, i - 1)]
    const b = c[Math.min(c.length - 1, i + 1)]
    return unit(sub(b, a), [1, 0, 0])
  })
}

// ---------------------------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------------------------

/** Where the axis is wanted: the point, the direction of travel, the surface normal there (if any), the share of the path's length. */
export interface AxisPoint {
  p: readonly number[]
  t: readonly number[]
  n: readonly number[] | null
  share: number
}

/** Square to the travel direction, as near upright as it can be. */
export function curveNormal(t: readonly number[]): V3 {
  const v = sub(Z, mul(t, dot(Z, t)))
  return len(v) > 1e-9 ? unit(v) : unit(sub([1, 0, 0], mul(t, dot([1, 0, 0], t))))
}

/** A reference direction leaned `lead` degrees along the travel and `tilt` degrees to its left. */
export function leanBy(n0: readonly number[], t: readonly number[], lead: number, tilt: number): V3 {
  if (!lead && !tilt) return unit(n0)
  let tt = sub(t, mul(n0, dot(t, n0)))
  tt = len(tt) > 1e-9 ? unit(tt) : unit(cross(n0, Math.abs(n0[2]) < 0.9 ? Z : [1, 0, 0]))
  const s = cross(n0, tt)
  const a1 = add(mul(n0, Math.cos(lead * DEG)), mul(tt, Math.sin(lead * DEG)))
  return unit(add(mul(a1, Math.cos(tilt * DEG)), mul(s, Math.sin(tilt * DEG))))
}

/** The tool direction the rule asks for at a point (before the tilt limit). */
export function axisAt(c: ToolAxisControl, q: AxisPoint, guide: { curve: Curve3; L: number[] } | null): V3 {
  const P: V3 = [c.point.x, c.point.y, c.point.z]
  switch (c.mode) {
    case 'vertical':
      return [...Z]
    case 'fixed': {
      const T = c.tilt * DEG
      const D = c.toward * DEG
      return unit([Math.sin(T) * Math.cos(D), Math.sin(T) * Math.sin(D), Math.cos(T)])
    }
    case 'surface-normal':
      return leanBy(q.n ? unit(q.n) : curveNormal(q.t), q.t, c.lead, c.tilt)
    case 'curve-normal':
      return leanBy(curveNormal(q.t), q.t, c.lead, c.tilt)
    case 'through-point':
      return unit(sub(P, q.p))
    case 'away-from-point':
      return unit(sub(q.p, P))
    case 'through-line':
    case 'away-from-line': {
      const d = unit([c.dir.x, c.dir.y, c.dir.z], [1, 0, 0])
      const Q = add(P, mul(d, dot(sub(q.p, P), d)))
      const v = unit(sub(Q, q.p))
      return c.mode === 'through-line' ? v : mul(v, -1)
    }
    case 'guide': {
      if (!guide) return [...Z]
      return unit(sub(curveAt(guide.curve, q.share, guide.L), q.p))
    }
  }
}

/** The direction leaned back towards vertical to at most `maxTilt` degrees (in its own vertical plane). */
export function clampTilt(a: readonly number[], maxTilt: number): { a: V3; clamped: boolean } {
  const th = tiltDeg(a)
  if (th <= maxTilt + 1e-9) return { a: [a[0], a[1], a[2]], clamped: false }
  const h = Math.hypot(a[0], a[1])
  const m = Math.max(0, maxTilt) * DEG
  if (h < 1e-12) return { a: [...Z], clamped: true }
  return { a: [(a[0] / h) * Math.sin(m), (a[1] / h) * Math.sin(m), Math.cos(m)], clamped: true }
}

/**
 * Axis smoothing: the directions along a path turned so that from one point to the next the axis
 * turns at most `maxTurn` degrees per mm travelled (a pass forwards, then one backwards). In place.
 */
export function smoothAxes(pts: readonly (readonly number[])[], axes: V3[], maxTurn: number): void {
  if (!(maxTurn > 0) || axes.length < 2) return
  const pass = (i: number, j: number) => {
    const lim = maxTurn * len(sub(pts[i], pts[j]))
    const ang = angleDeg(axes[j], axes[i])
    if (ang > lim + 1e-9) axes[i] = slerp(axes[j], axes[i], lim / ang)
  }
  for (let i = 1; i < axes.length; i++) pass(i, i - 1)
  for (let i = axes.length - 2; i >= 0; i--) pass(i, i + 1)
}
