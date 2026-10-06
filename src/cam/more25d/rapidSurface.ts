/**
 * Rapid surfaces (2D-18, M3.2): moves between cuts follow a cylinder or a sphere over the panel
 * instead of the flat safe height. Every rapid that goes up to the safe height ends on the surface
 * instead, and every rapid across at the safe height follows the surface, in steps short enough
 * that the straight moves between them stay within `tol` of it. The surface never brings a rapid
 * below the clearance height (`minZ`, above face 1): where it would, the rapid is held there; where
 * the surface does not reach (beside a cylinder, outside a sphere), the flat safe height is kept.
 *
 * The cutting moves are not touched. woodWOP programs move between cuts at the machine's own
 * safety height, so the surface shows in the simulation, the checks and text programs only.
 */
import type { P } from '../geom'
import type { Move } from '../toolpath'
import type { RapidSurface } from '../types'

/** Height of the surface's top over a point (above face 1), or null where it does not reach. */
export function surfaceZ(s: RapidSurface, p: P): number | null {
  if (s.kind === 'cylinder') {
    const d = s.axis === 'x' ? p.y - s.centre : p.x - s.centre
    const h = s.r * s.r - d * d
    return h < 0 ? null : s.z + Math.sqrt(h)
  }
  const h = s.r * s.r - (p.x - s.c.x) ** 2 - (p.y - s.c.y) ** 2
  return h < 0 ? null : s.z + Math.sqrt(h)
}

export interface RapidSurfaceResult {
  moves: Move[]
  warnings: string[]
  /** Rapids held at the clearance height, and kept at the flat safe height (outside the surface). */
  held: number
  outside: number
}

/**
 * The moves with their rapids on the surface. `safe`: the flat safe height the rapids use now
 * (rapids reaching it are the ones moved); `minZ`: the lowest a rapid may go.
 */
export function onRapidSurface(moves: readonly Move[], s: RapidSurface, safe: number, minZ: number, tol = 0.1): RapidSurfaceResult {
  const out: Move[] = []
  let held = 0
  let outside = 0
  const zAt = (p: P): number => {
    const z = surfaceZ(s, p)
    if (z === null) {
      outside++
      return safe
    }
    if (z < minZ) {
      held++
      return minZ
    }
    return z
  }
  // the longest step across that keeps the chord within tol of the surface (its radius) and
  // never more than 10 mm
  const step = Math.max(0.5, Math.min(10, Math.sqrt(8 * tol * Math.max(tol, s.r))))
  let x = NaN
  let y = NaN
  let z = NaN
  let onSurface = false
  for (const m of moves) {
    if (m.t === 'rapid' && m.z >= safe - 1e-6) {
      const to = { x: m.x, y: m.y }
      const across = Number.isFinite(x) && Math.hypot(to.x - x, to.y - y) > 1e-9
      if (across) {
        // a rapid that rises as it goes (up from the clearance height to the safe height over the
        // next start): straight up onto the surface first
        if (!onSurface) {
          const z0 = zAt({ x, y })
          if (z0 > z + 1e-9) out.push({ t: 'rapid', x, y, z: z0 })
        }
        // across, on the surface
        const L = Math.hypot(to.x - x, to.y - y)
        const n = Math.max(1, Math.ceil(L / step))
        for (let k = 1; k <= n; k++) {
          const q = { x: x + ((to.x - x) * k) / n, y: y + ((to.y - y) * k) / n }
          out.push({ t: 'rapid', x: q.x, y: q.y, z: zAt(q) })
        }
      } else out.push({ t: 'rapid', x: to.x, y: to.y, z: zAt(to) })
      onSurface = true
      x = to.x
      y = to.y
      z = (out[out.length - 1] as { z: number }).z
      continue
    }
    onSurface = false
    out.push(m)
    if (m.t === 'poly') {
      const n = m.pts.length
      if (n >= 3) {
        x = m.pts[n - 3]
        y = m.pts[n - 2]
        z = m.pts[n - 1]
      }
    } else {
      x = m.x
      y = m.y
      z = m.z
    }
  }
  const warnings: string[] = []
  if (held) warnings.push(`The rapid surface comes below the clearance height (${minZ.toFixed(1)} mm above face 1) over part of the panel: rapids are held at the clearance height there.`)
  if (outside) warnings.push(`Some rapids are beside or outside the rapid surface: they stay at the flat safe height (${safe.toFixed(1)} mm) there.`)
  return { moves: out, warnings, held, outside }
}

/**
 * A surface suggested for a panel: arched across it (a cylinder along its length, or a dome)
 * from the clearance height at its edges to the safe height over its middle.
 */
export function suggestSurface(kind: RapidSurface['kind'], length: number, width: number, safe: number, minZ: number): RapidSurface {
  const rise = Math.max(1, safe - minZ)
  // a circle through the two edges (half-width w apart from the middle) rising `rise` in the middle
  const arch = (w: number) => {
    const r = (w * w + rise * rise) / (2 * rise)
    return { r, z: safe - r }
  }
  if (kind === 'cylinder') {
    const along: 'x' | 'y' = length >= width ? 'x' : 'y'
    const a = arch((along === 'x' ? width : length) / 2)
    return { kind: 'cylinder', axis: along, centre: along === 'x' ? width / 2 : length / 2, z: a.z, r: a.r }
  }
  const a = arch(Math.hypot(length, width) / 2)
  return { kind: 'sphere', c: { x: length / 2, y: width / 2 }, z: a.z, r: a.r }
}
