import type { PartFrame, Vec2, Vec3 } from './types'

export const EPS = 1e-6

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
export const vecEq = (a: Vec3, b: Vec3) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < EPS

export const X: Vec3 = [1, 0, 0]
export const Y: Vec3 = [0, 1, 0]
export const Z: Vec3 = [0, 0, 1]
export const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]]

export interface Box3 {
  min: Vec3
  max: Vec3
}

/** Round to 1/1000 mm to keep generated numbers stable across platforms. */
export const r3 = (n: number) => {
  const v = Math.round(n * 1000) / 1000
  return Object.is(v, -0) ? 0 : v
}

/**
 * Build a part frame from a world-space box, a length axis `u` and the face-up normal `n`
 * (both signed unit axes). v = n x u so that u x v = n: looking down on the face-up side,
 * local x points right and local y points up, exactly like the sheet on the machine table.
 */
export function frameFromBox(box: Box3, u: Vec3, n: Vec3) {
  const v = cross(n, u)
  const pick = (axis: Vec3, useMaxWhenPositive: boolean): Vec3 => {
    const out: Vec3 = [0, 0, 0]
    for (let i = 0; i < 3; i++) {
      if (Math.abs(axis[i]) < EPS) continue
      const positive = axis[i] > 0
      out[i] = positive === useMaxWhenPositive ? box.max[i] : box.min[i]
    }
    return out
  }
  const ou = pick(u, false)
  const ov = pick(v, false)
  const on = pick(n, true)
  const origin: Vec3 = [0, 0, 0]
  for (let i = 0; i < 3; i++) origin[i] = ou[i] + ov[i] + on[i]
  const ext = sub(box.max, box.min)
  const along = (a: Vec3) => Math.abs(dot(ext, a))
  return {
    frame: { origin, u, v, n } as PartFrame,
    length: r3(along(u)),
    width: r3(along(v)),
    thickness: r3(along(n)),
  }
}

/** World point -> part-local (x, y, depth below face). */
export function toLocal(frame: PartFrame, p: Vec3) {
  const d = sub(p, frame.origin)
  return { x: r3(dot(d, frame.u)), y: r3(dot(d, frame.v)), depth: r3(-dot(d, frame.n)) }
}

/** Part-local (x, y, depth) -> world point. */
export function toWorld(frame: PartFrame, x: number, y: number, depth = 0): Vec3 {
  return add(add(add(frame.origin, scale(frame.u, x)), scale(frame.v, y)), scale(frame.n, -depth))
}

export function polygonArea(poly: Vec2[]) {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

export function rectPolygon(l: number, w: number): Vec2[] {
  return [
    { x: 0, y: 0 },
    { x: l, y: 0 },
    { x: l, y: w },
    { x: 0, y: w },
  ]
}

export function pointInPolygon(pt: Vec2, poly: Vec2[]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Number formatting used by every exporter: max 3 decimals, no trailing zeros, no "-0". */
export function fmt(n: number) {
  const v = r3(n)
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}
