/**
 * Positional (3+2) work planes (M3.4, 5AX-01): tilted work planes through a part at any angle.
 *
 * A tilted plane has its own frame: x and y along it, z (the normal) out of the material, the way
 * the tool points from its tip towards the spindle. It is turned from the level frame (part X, Y,
 * Z) in two steps: first a turn of `toward + 90 + spin` degrees about Z, then a tilt of `tilt`
 * degrees about the level line k = (-sin toward, cos toward, 0), which takes the normal from +Z
 * towards the plan direction `toward` (degrees from +X, counter-clockwise seen from above). With
 * spin 0 the plane's x stays level (along k) and its y runs up the slope; for a level plane
 * (tilt 0) the usual choice is toward -90, which leaves x = X and y = Y.
 *
 * Shapes drawn inside the plane's rectangle on the part's drawing (corner `at`, `size` along x and
 * y) lie on the plane: drawing (x, y) is the plane point (x - at.x, y - at.y). A toolpath on the
 * plane keeps drawing x, y and has z = height above the plane along its normal (negative into the
 * material), exactly as a face-1 toolpath has z below face 1. `planeToPart` maps it into the part.
 *
 * Pure: no DOM, no React.
 */
import type { P } from '../geom'
import type { CamPart, TiltedPlane } from '../types'

export type V3 = [number, number, number]

const DEG = Math.PI / 180

export const dot3 = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross3 = (a: readonly number[], b: readonly number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const norm3 = (a: readonly number[]): V3 => {
  const l = Math.hypot(a[0], a[1], a[2])
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]
}

/** Turn v about the unit axis k by `deg` degrees (right-handed). */
export function rotateAbout(k: readonly number[], deg: number, v: readonly number[]): V3 {
  const c = Math.cos(deg * DEG)
  const s = Math.sin(deg * DEG)
  const kv = dot3(k, v)
  const x = cross3(k, v)
  return [v[0] * c + x[0] * s + k[0] * kv * (1 - c), v[1] * c + x[1] * s + k[1] * kv * (1 - c), v[2] * c + x[2] * s + k[2] * kv * (1 - c)]
}

/** The plane's frame in part coordinates: unit x, y and normal z (right-handed). */
export interface PlaneFrame {
  o: V3
  x: V3
  y: V3
  z: V3
}

/** Unit x, y and z of a plane turned by the given angles (degrees). */
export function axesFromAngles(tilt: number, toward: number, spin: number): { x: V3; y: V3; z: V3 } {
  const k: V3 = [-Math.sin(toward * DEG), Math.cos(toward * DEG), 0]
  const turn = toward + 90 + spin
  const z0: V3 = [0, 0, 1]
  const x0: V3 = [Math.cos(turn * DEG), Math.sin(turn * DEG), 0]
  const y0: V3 = [-Math.sin(turn * DEG), Math.cos(turn * DEG), 0]
  const clean = (v: V3): V3 => v.map((q) => (Math.abs(q) < 1e-15 ? 0 : q)) as V3
  return { x: clean(rotateAbout(k, tilt, x0)), y: clean(rotateAbout(k, tilt, y0)), z: clean(rotateAbout(k, tilt, z0)) }
}

export function planeFrame(p: Pick<TiltedPlane, 'origin' | 'tilt' | 'toward' | 'spin'>): PlaneFrame {
  const a = axesFromAngles(p.tilt, p.toward, p.spin)
  return { o: [p.origin.x, p.origin.y, p.origin.z], ...a }
}

/** A point on the plane's drawing rectangle (drawing x, y) at height z above the plane, in part coordinates. */
export function planeToPart(p: TiltedPlane, x: number, y: number, z: number, f: PlaneFrame = planeFrame(p)): V3 {
  const u = x - p.at.x
  const v = y - p.at.y
  return [f.o[0] + u * f.x[0] + v * f.y[0] + z * f.z[0], f.o[1] + u * f.x[1] + v * f.y[1] + z * f.z[1], f.o[2] + u * f.x[2] + v * f.y[2] + z * f.z[2]]
}

/** A part point as drawing x, y on the plane's rectangle and height z above the plane. */
export function partToPlane(p: TiltedPlane, q: readonly number[], f: PlaneFrame = planeFrame(p)): { x: number; y: number; z: number } {
  const d = [q[0] - f.o[0], q[1] - f.o[1], q[2] - f.o[2]]
  return { x: p.at.x + dot3(d, f.x), y: p.at.y + dot3(d, f.y), z: dot3(d, f.z) }
}

/** The plane's rectangle on the drawing. */
export function tiltedRect(p: Pick<TiltedPlane, 'at' | 'size'>): { x0: number; y0: number; x1: number; y1: number } {
  return { x0: p.at.x, y0: p.at.y, x1: p.at.x + p.size.x, y1: p.at.y + p.size.y }
}

/** Is a drawing point inside the plane's rectangle? */
export function inTilted(p: Pick<TiltedPlane, 'at' | 'size'>, pt: P, tol = 1e-6): boolean {
  const r = tiltedRect(p)
  return pt.x >= r.x0 - tol && pt.x <= r.x1 + tol && pt.y >= r.y0 - tol && pt.y <= r.y1 + tol
}

/** Angles (degrees) of a unit normal: tilt from +Z, and the plan direction it leans towards (-90 when level). */
export function anglesOfNormal(n: readonly number[]): { tilt: number; toward: number } {
  const tilt = Math.acos(Math.max(-1, Math.min(1, n[2]))) / DEG
  const flat = Math.hypot(n[0], n[1])
  const toward = flat < 1e-12 ? -90 : Math.atan2(n[1], n[0]) / DEG
  return { tilt: Math.round(tilt * 1e9) / 1e9, toward: Math.round(toward * 1e9) / 1e9 }
}

/** The part's sides as tilted planes: x along the side seen from outside, y up, z out of it. */
export type PartSide = 'top' | 'front' | 'right' | 'back' | 'left' | 'underside'

export const SIDE_NAMES: Record<PartSide, string> = { top: 'Top (face 1)', front: 'Front (face 2)', right: 'Right (face 3)', back: 'Back (face 4)', left: 'Left (face 5)', underside: 'Underside (face 6)' }

/** A side of the part's block as plane fields: angles, origin at the side's corner, size. */
export function sidePlane(part: Pick<CamPart, 'length' | 'width' | 'thickness'>, side: PartSide): Pick<TiltedPlane, 'origin' | 'tilt' | 'toward' | 'spin' | 'size'> {
  const { length: L, width: W, thickness: T } = part
  switch (side) {
    case 'top':
      return { origin: { x: 0, y: 0, z: 0 }, tilt: 0, toward: -90, spin: 0, size: { x: L, y: W } }
    case 'front':
      return { origin: { x: 0, y: 0, z: -T }, tilt: 90, toward: -90, spin: 0, size: { x: L, y: T } }
    case 'right':
      return { origin: { x: L, y: 0, z: -T }, tilt: 90, toward: 0, spin: 0, size: { x: W, y: T } }
    case 'back':
      return { origin: { x: L, y: W, z: -T }, tilt: 90, toward: 90, spin: 0, size: { x: L, y: T } }
    case 'left':
      return { origin: { x: 0, y: W, z: -T }, tilt: 90, toward: 180, spin: 0, size: { x: W, y: T } }
    case 'underside':
      return { origin: { x: 0, y: W, z: -T }, tilt: 180, toward: -90, spin: 0, size: { x: L, y: W } }
  }
}

/**
 * A plane fitted to a flat face (normal `n` out of the material, its points in part coordinates):
 * the face's angles with x level (y up the slope), the origin at the lowest corner of the points'
 * box on the plane, the size of that box.
 */
export function planeFromFace(n: readonly number[], points: readonly (readonly number[])[]): { fields: Pick<TiltedPlane, 'origin' | 'tilt' | 'toward' | 'spin' | 'size'>; fit: number } | { error: string } {
  const nn = norm3(n)
  if (!points.length) return { error: 'The face has no points.' }
  if (!(Math.hypot(nn[0], nn[1], nn[2]) > 0.5)) return { error: 'The face has no normal.' }
  const { tilt, toward } = anglesOfNormal(nn)
  const ax = axesFromAngles(tilt, toward, 0)
  let u0 = Infinity
  let v0 = Infinity
  let u1 = -Infinity
  let v1 = -Infinity
  let w0 = Infinity
  let w1 = -Infinity
  for (const q of points) {
    const u = dot3(q, ax.x)
    const v = dot3(q, ax.y)
    const w = dot3(q, ax.z)
    u0 = Math.min(u0, u)
    u1 = Math.max(u1, u)
    v0 = Math.min(v0, v)
    v1 = Math.max(v1, v)
    w0 = Math.min(w0, w)
    w1 = Math.max(w1, w)
  }
  const w = (w0 + w1) / 2
  const o = [0, 1, 2].map((k) => ax.x[k] * u0 + ax.y[k] * v0 + ax.z[k] * w)
  const r = (q: number) => Math.round(q * 1e9) / 1e9
  return { fields: { origin: { x: r(o[0]), y: r(o[1]), z: r(o[2]) }, tilt, toward, spin: 0, size: { x: r(u1 - u0), y: r(v1 - v0) } }, fit: (w1 - w0) / 2 }
}

/** Problems with a plane (empty = fine). */
export function tiltedProblems(p: TiltedPlane): string[] {
  const out: string[] = []
  for (const [k, v] of [['tilt', p.tilt], ['direction', p.toward], ['turn', p.spin]] as const) if (!Number.isFinite(v)) out.push(`The ${k} angle is not a number.`)
  if (p.tilt < -1e-9 || p.tilt > 180 + 1e-9) out.push('The tilt must be from 0° (level) to 180° (upside down).')
  if (![p.origin.x, p.origin.y, p.origin.z].every(Number.isFinite)) out.push('The origin needs x, y and z.')
  if (!(p.size.x > 0 && p.size.y > 0)) out.push('The rectangle needs a size along x and y.')
  return out
}

/**
 * Depth of the part's block below the plane at its deepest (along -z): how far material can reach
 * from the plane. 0 when the block is all above it.
 */
export function blockDepthBelow(part: Pick<CamPart, 'length' | 'width' | 'thickness'>, f: PlaneFrame): number {
  let deepest = 0
  for (const x of [0, part.length]) for (const y of [0, part.width]) for (const z of [0, -part.thickness]) deepest = Math.max(deepest, -dot3([x - f.o[0], y - f.o[1], z - f.o[2]], f.z))
  return deepest
}

/** Where the next tilted plane's rectangle goes on the drawing: above the part and every plane already there. */
export function nextTiltedSpot(part: Pick<CamPart, 'width' | 'tilted' | 'rotary'>, gap = 20): P {
  let y = part.width + gap
  for (const p of part.tilted ?? []) y = Math.max(y, p.at.y + p.size.y + gap)
  for (const p of part.rotary?.planes ?? []) y = Math.max(y, p.at.y + p.radius * (p.a1 - p.a0) * DEG + gap)
  return { x: 0, y }
}

/** The part has enabled operations on tilted planes (positional 3+2 work). */
export const hasTiltedWork = (part: Pick<CamPart, 'ops'>) => part.ops.some((o) => o.enabled && !!o.tiltedPlane)

/** Operation kinds that can run on a tilted plane. */
export const TILTED_KINDS = new Set(['drill', 'pocket', 'profile', 'engrave'])
