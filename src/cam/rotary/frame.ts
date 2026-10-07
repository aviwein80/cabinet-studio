/**
 * Rotary (4-axis) geometry (M3.3, NEW-14): the frame round a part's rotary axis, the blank turned
 * on it, and wrapped (developed) work planes.
 *
 * Frame round the axis: `u` is the part coordinate along the axis; the angle θ round it is
 * measured from the reference direction e0 towards e1 = axis × e0 (right-handed about the axis);
 * ρ is the distance from the axis.
 *
 *   axis X: e0 = +Z, e1 = -Y      axis Y: e0 = +Z, e1 = +X      axis Z: e0 = +X, e1 = +Y
 *
 * so θ = 0 is straight up for an axis along X or Y: where the tool stands when the rotary axis is
 * at 0. The tool always stands square to the axis and points at it.
 *
 * A wrapped plane of radius R is the cylinder ρ = R from `start` to `end` along the axis and from
 * `a0` to `a1` degrees round it, unrolled into the drawing with its corner at `at`:
 *   drawing x = at.x + (u - start),  drawing y = at.y + R·(θ - a0)   (θ in radians)
 * A toolpath on the plane uses those x, y and z = ρ - R (0 on the plane's cylinder, negative
 * towards the axis). A straight move in these coordinates is a straight move of the machine's
 * axes (along the axis, round it, in towards it), so the simulator and a post agree on the path
 * between points.
 *
 * Pure: no DOM, no React.
 */
import type { P } from '../geom'
import type { RotaryAxis, RotarySetup, WrappedPlane } from '../types'

export type V3 = [number, number, number]

const DEG = Math.PI / 180

export interface AxisFrame {
  /** Unit vector along the axis. */
  a: V3
  /** θ = 0 and θ = 90° directions. */
  e0: V3
  e1: V3
}

const FRAMES: Record<RotaryAxis, AxisFrame> = {
  X: { a: [1, 0, 0], e0: [0, 0, 1], e1: [0, -1, 0] },
  Y: { a: [0, 1, 0], e0: [0, 0, 1], e1: [1, 0, 0] },
  Z: { a: [0, 0, 1], e0: [1, 0, 0], e1: [0, 1, 0] },
}

export const axisFrame = (axis: RotaryAxis): AxisFrame => FRAMES[axis]

/** The machine's rotary axis that turns about a part axis (A about X, B about Y, C about Z). */
export const ROTARY_LETTER: Record<RotaryAxis, 'A' | 'B' | 'C'> = { X: 'A', Y: 'B', Z: 'C' }

const dot = (p: readonly number[], q: readonly number[]) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2]

/** Point (part coordinates) to the frame round the axis: u along it, θ (radians, -π..π), ρ. */
export function toCyl(s: Pick<RotarySetup, 'axis' | 'centre'>, p: readonly number[]): { u: number; theta: number; rho: number } {
  const f = FRAMES[s.axis]
  const c: V3 = [s.centre.x, s.centre.y, s.centre.z]
  const d: V3 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]
  const q0 = dot(d, f.e0)
  const q1 = dot(d, f.e1)
  return { u: dot(p, f.a), theta: Math.atan2(q1, q0), rho: Math.hypot(q0, q1) }
}

/** The frame round the axis back to part coordinates. */
export function fromCyl(s: Pick<RotarySetup, 'axis' | 'centre'>, u: number, theta: number, rho: number): V3 {
  const f = FRAMES[s.axis]
  const c: V3 = [s.centre.x, s.centre.y, s.centre.z]
  // the centre's own coordinate along the axis is replaced by u
  const along = u - dot(c, f.a)
  const ct = Math.cos(theta) * rho
  const st = Math.sin(theta) * rho
  return [0, 1, 2].map((k) => c[k] + f.a[k] * along + f.e0[k] * ct + f.e1[k] * st) as V3
}

/** The blank's farthest reach from the axis: half the diameter, or half the diagonal of a square. */
export function blankRadius(b: RotarySetup['blank']): number {
  return b.shape === 'round' ? b.size / 2 : (b.size / 2) * Math.SQRT2
}

/**
 * The blank's surface at angle θ (radians): a round blank's radius, or where the ray meets a
 * square blank whose faces are square to e0 and e1.
 */
export function blankRho(b: RotarySetup['blank'], theta: number): number {
  if (b.shape === 'round') return b.size / 2
  return b.size / 2 / Math.max(Math.abs(Math.cos(theta)), Math.abs(Math.sin(theta)))
}

/** Volume of the uncut blank (mm³). */
export function blankVolume(b: RotarySetup['blank']): number {
  const L = Math.max(0, b.end - b.start)
  return b.shape === 'round' ? Math.PI * (b.size / 2) ** 2 * L : b.size * b.size * L
}

// ---------------------------------------------------------------------------------------------
// Wrapped planes
// ---------------------------------------------------------------------------------------------

/** Unrolled size of a plane: along the axis, round it (arc at its radius). */
export function planeSize(p: Pick<WrappedPlane, 'radius' | 'start' | 'end' | 'a0' | 'a1'>): { along: number; round: number } {
  return { along: p.end - p.start, round: p.radius * (p.a1 - p.a0) * DEG }
}

/** The plane's unrolled rectangle in the drawing. */
export function planeRect(p: WrappedPlane): { x0: number; y0: number; x1: number; y1: number } {
  const s = planeSize(p)
  return { x0: p.at.x, y0: p.at.y, x1: p.at.x + s.along, y1: p.at.y + s.round }
}

/** Unrolled (drawing) coordinates with z to the frame round the axis (θ in radians, continuous). */
export function planeToCyl(p: WrappedPlane, x: number, y: number, z: number): { u: number; theta: number; rho: number } {
  return { u: p.start + (x - p.at.x), theta: p.a0 * DEG + (y - p.at.y) / p.radius, rho: p.radius + z }
}

/** The frame round the axis to the plane's unrolled coordinates (θ in radians; not wrapped). */
export function cylToPlane(p: WrappedPlane, u: number, theta: number, rho: number): { x: number; y: number; z: number } {
  return { x: p.at.x + (u - p.start), y: p.at.y + (theta - p.a0 * DEG) * p.radius, z: rho - p.radius }
}

/** A drawing point inside the plane's unrolled rectangle wrapped onto its cylinder (part coordinates), `depth` below it. */
export function wrapPoint(s: RotarySetup, p: WrappedPlane, pt: P, depth = 0): V3 {
  const c = planeToCyl(p, pt.x, pt.y, -depth)
  return fromCyl(s, c.u, c.theta, c.rho)
}

/** Is a drawing point inside the plane's unrolled rectangle? */
export function inPlane(p: WrappedPlane, pt: P, tol = 1e-6): boolean {
  const r = planeRect(p)
  return pt.x >= r.x0 - tol && pt.x <= r.x1 + tol && pt.y >= r.y0 - tol && pt.y <= r.y1 + tol
}

/** Where the next plane's rectangle goes in the drawing: above the part and the planes already there. */
export function nextPlaneSpot(s: RotarySetup | undefined, part: { width: number }, gap = 20): P {
  let y = part.width + gap
  for (const p of s?.planes ?? []) y = Math.max(y, planeRect(p).y1 + gap)
  return { x: s?.blank.start ?? 0, y }
}

export function planeFromRadius(s: RotarySetup, radius: number, fields: Pick<WrappedPlane, 'id' | 'name' | 'at'>): WrappedPlane {
  return { ...fields, radius, start: s.blank.start, end: s.blank.end, a0: 0, a1: 360, from: 'radius' }
}

/** Problems with a plane (empty = fine). */
export function planeProblems(s: RotarySetup, p: WrappedPlane): string[] {
  const out: string[] = []
  if (!(p.radius > 0)) out.push('The radius must be more than 0.')
  if (!(p.end > p.start)) out.push('The end along the axis must be past the start.')
  if (!(p.a1 > p.a0)) out.push('The end angle must be past the start angle.')
  if (p.a1 - p.a0 > 360 + 1e-9) out.push('A plane goes at most once round the axis (360°).')
  if (p.start < s.blank.start - 1e-9 || p.end > s.blank.end + 1e-9) out.push('The plane runs past the ends of the blank.')
  return out
}

/** Problems with a set-up (empty = fine). */
export function setupProblems(s: RotarySetup): string[] {
  const out: string[] = []
  if (!(s.blank.size > 0)) out.push('The blank needs a size.')
  if (!(s.blank.end > s.blank.start)) out.push('The blank\'s end along the axis must be past its start.')
  for (const p of s.planes) for (const m of planeProblems(s, p)) out.push(`${p.name}: ${m}`)
  return out
}

/**
 * A default set-up for a part: the axis along its length (X) through the middle of its width and
 * thickness, a square blank the size of the smaller of the two, from end to end.
 */
export function defaultSetup(part: { length: number; width: number; thickness: number }): RotarySetup {
  const size = Math.min(part.width, part.thickness)
  return { axis: 'X', centre: { x: 0, y: part.width / 2, z: -part.thickness / 2 }, blank: { shape: 'square', size, start: 0, end: part.length }, planes: [] }
}

/**
 * Smallest range of angles (degrees, a0 < a1, a1 - a0 <= 360) holding all the given angles
 * (radians): the circle less its largest empty gap. Within `full` of all the way round: 0..360.
 */
export function angleSpan(thetas: number[], full = 2): { a0: number; a1: number } {
  if (!thetas.length) return { a0: 0, a1: 360 }
  const a = thetas.map((t) => (((t / DEG) % 360) + 360) % 360).sort((p, q) => p - q)
  let gap = a[0] + 360 - a[a.length - 1]
  let after = a[a.length - 1]
  for (let i = 1; i < a.length; i++)
    if (a[i] - a[i - 1] > gap) {
      gap = a[i] - a[i - 1]
      after = a[i - 1]
    }
  if (gap <= full) return { a0: 0, a1: 360 }
  const a0 = after + gap
  const span = 360 - gap
  const start = a0 >= 360 ? a0 - 360 : a0
  return { a0: start, a1: start + span }
}

/**
 * A plane fitted to a cylindrical face (NEW-14): the face's cylinder (axis point `p`, unit
 * direction `v`, radius `r`, in part coordinates) must lie on the set-up's axis; the plane takes
 * the face's radius and the extents of its points along and round the axis.
 */
export function planeFromCylinder(s: RotarySetup, cyl: { p: V3; v: V3; r: number; fit: number }, points: readonly V3[], fields: Pick<WrappedPlane, 'id' | 'name' | 'at'> & { modelId: string; faceId?: number }, tol = { angle: 0.05, offset: 0.05 }): { plane: WrappedPlane } | { error: string } {
  const f = FRAMES[s.axis]
  const along = Math.abs(dot(cyl.v, f.a))
  if (along < Math.cos(tol.angle * DEG)) return { error: `The face's axis is ${(Math.acos(Math.min(1, along)) / DEG).toFixed(2)}° off the rotary axis (${s.axis}). Turn the model, or set the rotary axis to match it.` }
  // the face's axis line must be the set-up's: its point's distance from the rotary axis
  const off = toCyl(s, cyl.p).rho
  if (off > tol.offset) return { error: `The face's axis is ${off.toFixed(3)} mm from the rotary axis. Move the rotary axis onto it first ("Axis from this face").` }
  if (!(cyl.r > 0)) return { error: 'The face has no radius.' }
  if (!points.length) return { error: 'The face has no points.' }
  let u0 = Infinity
  let u1 = -Infinity
  const thetas: number[] = []
  for (const q of points) {
    const c = toCyl(s, q)
    u0 = Math.min(u0, c.u)
    u1 = Math.max(u1, c.u)
    thetas.push(c.theta)
  }
  const span = angleSpan(thetas)
  const { modelId, faceId, ...rest } = fields
  return { plane: { ...rest, radius: cyl.r, start: Math.max(s.blank.start, u0), end: Math.min(s.blank.end, u1), a0: span.a0, a1: span.a1, from: 'face', face: { modelId, ...(faceId !== undefined ? { faceId } : {}), fit: cyl.fit } } }
}

/** The set-up's axis moved onto a cylinder's axis (which must run along X, Y or Z). */
export function axisFromCylinder(s: RotarySetup, cyl: { p: V3; v: V3 }, tolDeg = 0.05): { setup: RotarySetup } | { error: string } {
  const axes: RotaryAxis[] = ['X', 'Y', 'Z']
  const best = axes.map((a) => ({ a, k: Math.abs(dot(cyl.v, FRAMES[a].a)) })).sort((p, q) => q.k - p.k)[0]
  if (best.k < Math.cos(tolDeg * DEG)) return { error: 'The face\'s axis does not run along X, Y or Z of the part. Turn the model so it does.' }
  return { setup: { ...s, axis: best.a, centre: { x: cyl.p[0], y: cyl.p[1], z: cyl.p[2] } } }
}
