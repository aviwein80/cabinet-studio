/**
 * Cutter shapes for 3D work, as solids of revolution about a vertical axis. Heights are measured
 * up from the tool tip (the lowest point).
 *
 * - Torus family: flat end mill (corner radius 0), ball-nose (corner radius = radius) and
 *   bull-nose (between). `R` is the radius, `rc` the corner radius; the flat bottom has radius
 *   `R - rc`.
 * - V: a cone with its apex at the tip; `k` = 1 / tan(half the included angle), so the cone is
 *   `k * d` high at distance `d` from the axis.
 */
import type { Tool } from '@/core/types'

export type Cutter3D = { kind: 'torus'; R: number; rc: number } | { kind: 'v'; R: number; k: number }

/** Height of the cutter surface above its tip at horizontal distance d from the axis (d <= R). */
export function profileHeight(c: Cutter3D, d: number): number {
  if (c.kind === 'v') return c.k * d
  const flat = c.R - c.rc
  if (d <= flat) return 0
  const e = Math.min(d - flat, c.rc)
  return c.rc - Math.sqrt(Math.max(0, c.rc * c.rc - e * e))
}

/** Cosine of the angle between the cutter surface normal and vertical at distance d (1 = flat bottom). */
export function profileNz(c: Cutter3D, d: number): number {
  if (c.kind === 'v') return d < 1e-9 ? 1 : 1 / Math.sqrt(1 + c.k * c.k)
  const flat = c.R - c.rc
  if (d <= flat + 1e-9) return c.rc <= 1e-12 && d >= c.R - 1e-9 ? 0 : 1
  const s = Math.min(1, (d - flat) / c.rc)
  return Math.sqrt(Math.max(0, 1 - s * s))
}

/** The cutter of a tool, or null with the reason when the shape cannot be used for 3D work. */
export function cutterOfTool(t: Tool | null): { cutter: Cutter3D } | { error: string } {
  if (!t) return { error: 'No tool: 3D finishing needs a ball-nose, bull-nose or flat end mill.' }
  if (t.type !== 'router') return { error: `T${t.number} is not a router: 3D finishing needs a ball-nose, bull-nose or flat end mill.` }
  const R = t.diameter / 2
  if (!(R > 0)) return { error: `T${t.number} has no diameter.` }
  switch (t.shape ?? 'flat') {
    case 'ball':
    // a lollipop meets the model from above with its ball (the neck is narrower)
    case 'lollipop':
      return { cutter: { kind: 'torus', R, rc: R } }
    case 'bull':
      return { cutter: { kind: 'torus', R, rc: Math.min(R, Math.max(0, t.cornerRadius ?? 0)) } }
    case 'flat':
      return { cutter: { kind: 'torus', R, rc: 0 } }
    case 'v': {
      const a = t.angle ?? 90
      if (!(a > 0 && a < 180)) return { error: `T${t.number} needs an included angle between 0 and 180°.` }
      return { cutter: { kind: 'v', R, k: 1 / Math.tan((a * Math.PI) / 360) } }
    }
    default:
      return { error: `T${t.number} (${t.shape}) cannot be used for 3D surfaces.` }
  }
}

/**
 * The cutter grown by `s` in every direction. Dropping it onto the surface and raising the
 * result by `s` puts the real tool `s` away from the surface everywhere: stock to leave. Exact
 * for the torus family; a V cutter grown this way is no longer a cone, so it is refused.
 */
export function grownCutter(c: Cutter3D, s: number): Cutter3D | null {
  if (s <= 0) return c
  if (c.kind === 'v') return null
  return { kind: 'torus', R: c.R + s, rc: c.rc + s }
}
