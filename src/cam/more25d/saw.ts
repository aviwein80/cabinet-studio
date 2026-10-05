/**
 * Saw cuts (2D-11): straight cuts with a circular blade, vertical or tilted.
 *
 * A blade of radius R cutting d deep (measured in the blade's own plane) reaches along the line,
 * at the surface, a distance `s = sqrt(2 R d - d²)` beyond the point where it is at full depth
 * (its run-out). The floor of the cut ends in a circular arc of the blade. Everything here is
 * pure geometry; the toolpath generator turns it into moves and intents.
 *
 * Moves follow the lowest point of the blade (the floor of the cut), run-outs included, so the
 * simulator carves the cut the blade really makes; the native saw macro carries the full-depth
 * span of the cut.
 */
import type { P } from '../geom'

export interface SawLine {
  a: P
  b: P
}

/** One planned cut. Lengths along the line are measured from `line[0]`. */
export interface SawCut {
  /** The drawn line (after joining). */
  line: [P, P]
  /** Full-depth span of the blade's lowest point, at the surface position (before the tilt offset). */
  a: P
  b: P
  /** The cut's footprint at the surface (run-outs included). */
  surf: [P, P]
  /** Sideways offset of the floor from the drawn line (angled cuts), mm. */
  floorOffset: P
  /** Depth below face 1, mm. */
  depth: number
  /** Length of the drawn line that is not cut to full depth, mm. */
  short: number
}

export interface SawPlanInput {
  /** Blade radius, mm. */
  R: number
  /** Depth below face 1, mm. */
  depth: number
  /** Tilt from vertical, degrees. */
  tilt: number
  tiltSide: 'left' | 'right'
  clear: boolean
  extend: number
  minLength: number
  join: boolean
  avoid: boolean
  /** The part's outline as a polygon (for `avoid`). */
  outline: P[]
}

export interface SawPlan {
  cuts: SawCut[]
  /** Run-out at the surface beyond each full-depth end, mm. */
  runout: number
  warnings: string[]
}

const r3 = (n: number) => Math.round(n * 1000) / 1000

/** Run-out at the surface of a blade of radius R cutting d deep (in its plane). */
export function runOut(R: number, d: number): number {
  if (d <= 0) return 0
  if (d >= R) return R
  return Math.sqrt(2 * R * d - d * d)
}

/**
 * Join straight lines that lie on one line (direction within `angTol` radians, offset within `tol`
 * mm) and touch or overlap (gap within `tol`) into one line. The first line of each group keeps
 * its place in the order; the joined line runs the way that line runs.
 */
export function joinCollinear(lines: SawLine[], tol = 0.01, angTol = 1e-4): SawLine[] {
  const info = lines.map((l, i) => {
    const dx = l.b.x - l.a.x
    const dy = l.b.y - l.a.y
    const len = Math.hypot(dx, dy)
    let ux = dx / len
    let uy = dy / len
    // canonical direction: angle in [0, pi)
    if (uy < -1e-12 || (Math.abs(uy) <= 1e-12 && ux < 0)) {
      ux = -ux
      uy = -uy
    }
    const c = -uy * l.a.x + ux * l.a.y
    const t0 = ux * l.a.x + uy * l.a.y
    const t1 = ux * l.b.x + uy * l.b.y
    return { i, l, len, ux, uy, c, lo: Math.min(t0, t1), hi: Math.max(t0, t1), fwd: t1 >= t0 }
  })
  const used = new Set<number>()
  const out: SawLine[] = []
  for (const f of info) {
    if (used.has(f.i) || !(f.len > 1e-9)) continue
    used.add(f.i)
    let lo = f.lo
    let hi = f.hi
    // grow the interval until nothing more joins (lines may chain through each other)
    let grew = true
    while (grew) {
      grew = false
      for (const g of info) {
        if (used.has(g.i) || !(g.len > 1e-9)) continue
        const ang = Math.abs(f.ux * g.uy - f.uy * g.ux)
        if (ang > angTol || Math.abs(g.c - f.c) > tol || g.lo > hi + tol || g.hi < lo - tol) continue
        used.add(g.i)
        lo = Math.min(lo, g.lo)
        hi = Math.max(hi, g.hi)
        grew = true
      }
    }
    const at = (t: number): P => ({ x: f.ux * t - f.uy * f.c, y: f.uy * t + f.ux * f.c })
    // keep the drawn points exactly when nothing was joined
    if (lo === f.lo && hi === f.hi) out.push(f.l)
    else out.push(f.fwd ? { a: at(lo), b: at(hi) } : { a: at(hi), b: at(lo) })
  }
  return out
}

/**
 * Where the line p0 + t u is inside the polygon: the interval [lo, hi] of t that holds `tMid`
 * (even-odd rule), or null when `tMid` is outside.
 */
export function insideInterval(poly: P[], p0: P, u: P, tMid: number): [number, number] | null {
  const n = { x: -u.y, y: u.x }
  const ts: number[] = []
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    const dp = (p.x - p0.x) * n.x + (p.y - p0.y) * n.y
    const dq = (q.x - p0.x) * n.x + (q.y - p0.y) * n.y
    // half-open rule so a vertex on the line counts once
    if (dp > 0 === dq > 0) continue
    const k = dp / (dp - dq)
    const x = p.x + (q.x - p.x) * k
    const y = p.y + (q.y - p.y) * k
    ts.push((x - p0.x) * u.x + (y - p0.y) * u.y)
  }
  ts.sort((a, b) => a - b)
  for (let i = 0; i + 1 < ts.length; i += 2) if (tMid >= ts[i] - 1e-9 && tMid <= ts[i + 1] + 1e-9) return [ts[i], ts[i + 1]]
  return null
}

/** Plan the cuts along straight lines. */
export function planSawCuts(lines0: SawLine[], o: SawPlanInput): SawPlan {
  const warnings: string[] = []
  const tilt = (Math.min(45, Math.max(0, o.tilt)) * Math.PI) / 180
  // depth in the blade's plane
  const d1 = o.depth / Math.cos(tilt)
  if (!(o.depth > 0)) return { cuts: [], runout: 0, warnings: ['Saw cut depth is 0: nothing to cut.'] }
  if (d1 >= o.R - 1e-9) return { cuts: [], runout: 0, warnings: [`The blade (Ø${r3(2 * o.R)}) cannot cut ${r3(d1)} mm deep: nothing is cut.`] }
  const s = runOut(o.R, d1)
  const lines = o.join ? joinCollinear(lines0) : lines0
  if (o.join && lines.length < lines0.length) warnings.push(`${lines0.length - lines.length} line(s) joined to the line they continue.`)
  const cuts: SawCut[] = []
  let tooShort = 0
  let noRoom = 0
  let outside = 0
  let pulled = 0
  for (const ln of lines) {
    const L = Math.hypot(ln.b.x - ln.a.x, ln.b.y - ln.a.y)
    if (L < 1e-9) continue
    if (L < o.minLength - 1e-9) {
      tooShort++
      continue
    }
    const u = { x: (ln.b.x - ln.a.x) / L, y: (ln.b.y - ln.a.y) / L }
    const side = o.tiltSide === 'left' ? { x: -u.y, y: u.x } : { x: u.y, y: -u.x }
    const lat = o.depth * Math.tan(tilt)
    const floorOffset = { x: side.x * lat, y: side.y * lat }
    let t0 = (o.clear ? 0 : s) - o.extend
    let t1 = (o.clear ? L : L - s) + o.extend
    if (o.avoid && o.outline.length >= 3) {
      const iv = insideInterval(o.outline, ln.a, u, L / 2)
      const floor = lat > 1e-9 ? insideInterval(o.outline, { x: ln.a.x + floorOffset.x, y: ln.a.y + floorOffset.y }, u, L / 2) : iv
      if (!iv || !floor) {
        outside++
        continue
      }
      const lo = Math.max(iv[0] + s, floor[0])
      const hi = Math.min(iv[1] - s, floor[1])
      if (lo > t0 + 1e-9 || hi < t1 - 1e-9) pulled++
      t0 = Math.max(t0, lo)
      t1 = Math.min(t1, hi)
    }
    if (t1 <= t0 + 1e-6) {
      noRoom++
      continue
    }
    const at = (t: number): P => ({ x: ln.a.x + u.x * t, y: ln.a.y + u.y * t })
    const short = Math.max(0, Math.min(L, t0)) + Math.max(0, Math.min(L, L - t1))
    cuts.push({ line: [ln.a, ln.b], a: at(t0), b: at(t1), surf: [at(t0 - s), at(t1 + s)], floorOffset, depth: o.depth, short })
  }
  if (tooShort) warnings.push(`${tooShort} line(s) shorter than the minimum length ${r3(o.minLength)} mm are not cut.`)
  if (outside) warnings.push(`${outside} line(s) lie outside the part and are not cut.`)
  if (noRoom) warnings.push(`${noRoom} line(s) are too short for the blade's run-out (${r3(s)} mm each end) and are not cut.`)
  if (pulled) {
    const short = cuts.reduce((n, c) => n + c.short, 0)
    warnings.push(`${pulled} cut(s) pulled back so the blade stays inside the part: ${r3(short)} mm of the drawn lines is not cut to full depth. Finish it with a router.`)
  } else if (!o.clear && cuts.length) warnings.push(`The cut stays on the drawn lines at the surface, so the floor stops ${r3(s)} mm short of each end.`)
  if (o.clear && !o.avoid && cuts.length) warnings.push(`Full depth to the line ends: the blade cuts ${r3(s + o.extend)} mm past each end at the surface.`)
  return { cuts, runout: s, warnings }
}

/**
 * The floor of one cut as points (x, y, z): from the surface at the start of the run-out, down
 * the blade's arc to full depth, along it, and up the arc at the far end. Angled cuts move the
 * floor sideways in proportion to its depth.
 */
export function cutFloor(c: SawCut, R: number, tiltDeg: number, chord = 0.05): { x: number; y: number; z: number }[] {
  const tilt = (Math.min(45, Math.max(0, tiltDeg)) * Math.PI) / 180
  const d1 = c.depth / Math.cos(tilt)
  const s = runOut(R, d1)
  const L = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y)
  const dx = Math.hypot(c.surf[1].x - c.surf[0].x, c.surf[1].y - c.surf[0].y)
  const u = dx > 1e-12 ? { x: (c.surf[1].x - c.surf[0].x) / dx, y: (c.surf[1].y - c.surf[0].y) / dx } : { x: 1, y: 0 }
  const lat = Math.hypot(c.floorOffset.x, c.floorOffset.y)
  const side = lat > 1e-12 ? { x: c.floorOffset.x / lat, y: c.floorOffset.y / lat } : { x: 0, y: 0 }
  const sin = Math.sin(tilt)
  const cos = Math.cos(tilt)
  const point = (base: P, along: number, delta: number) => ({ x: base.x + u.x * along + side.x * delta * sin, y: base.y + u.y * along + side.y * delta * sin, z: -delta * cos })
  // depth of the blade's bottom (in its plane) at a distance e from the blade centre
  const deltaAt = (e: number) => Math.max(0, d1 - (R - Math.sqrt(Math.max(0, R * R - e * e))))
  // samples so the chord error of the arc stays under `chord`
  const n = Math.max(4, Math.ceil(s / Math.max(0.05, Math.sqrt(8 * R * chord))))
  const out: { x: number; y: number; z: number }[] = []
  for (let i = 0; i <= n; i++) {
    const e = s * (1 - i / n)
    out.push(point(c.a, -e, deltaAt(e)))
  }
  if (L > 1e-9) out.push(point(c.a, L, d1))
  for (let i = 1; i <= n; i++) {
    const e = (s * i) / n
    out.push(point(c.b, e, deltaAt(e)))
  }
  return out
}
