/**
 * 5-axis tool shapes (TOOL-07, M3.5): barrel cutters and form tools as revolved outlines.
 *
 * An outline is a list of points from the tip up: height `h` above the tip and radius `r` there.
 * A stretch between two points is straight, or an arc of a given radius bulging outwards (away from
 * the tool's axis, positive) or inwards (negative); arcs are always the shorter way round.
 *
 * A barrel cutter (our own definition): widest at its diameter D (radius R); its side is an arc of
 * radius Rb (the barrel radius, larger than R) whose centre lies across the axis, level with the
 * widest point; its tip is a ball of radius rt (the corner radius) on the axis, touching the side
 * arc. The widest point then sits hw = rt + sqrt((Rb - rt)^2 - (Rb - R)^2) above the tip, and the
 * side arc runs on up to the flute length. With rt = 0 the side arc itself meets the axis at the tip.
 *
 * Outlines become straight pieces (arcs within 0.002 mm) for the simulator and the stocks.
 *
 * Pure: no DOM, no React.
 */
import type { FormPoint, Tool } from '@/core/types'

export interface OutlinePt {
  h: number
  r: number
}

/** Arcs become straight pieces no further than this from the arc (mm). */
export const FORM_CHORD = 0.002

const fmt = (n: number) => String(Math.round(n * 1000) / 1000)

/** Problems with a form tool's outline (empty = fine). */
export function formProblems(pts: readonly FormPoint[] | undefined): string[] {
  const out: string[] = []
  if (!pts || pts.length < 2) return ['The outline needs at least two points.']
  if (pts.some((p) => !Number.isFinite(p.h) || !Number.isFinite(p.r) || (p.arc !== undefined && !Number.isFinite(p.arc)))) return ['Every point needs a height and a radius.']
  if (Math.abs(pts[0].h) > 1e-9) out.push('The first point is the tip: its height must be 0.')
  if (pts.some((p) => p.r < 0)) out.push('A radius is below zero.')
  if (pts.some((p, i) => i > 0 && p.h < pts[i - 1].h - 1e-9)) out.push('Heights must not go down (list the points from the tip up).')
  if (!pts.some((p) => p.r > 1e-9)) out.push('At least one point needs a radius above zero.')
  pts.forEach((p, i) => {
    if (i === 0 || p.arc === undefined || p.arc === 0) return
    const a = pts[i - 1]
    const L = Math.hypot(p.r - a.r, p.h - a.h)
    if (Math.abs(p.arc) < L / 2 - 1e-9) out.push(`Point ${i + 1}: an arc of radius ${fmt(Math.abs(p.arc))} cannot reach from the point before (${fmt(L)} mm apart; at least ${fmt(L / 2)}).`)
  })
  return out
}

/** Problems with a barrel cutter's sizes (empty = fine). */
export function barrelProblems(t: Pick<Tool, 'diameter' | 'barrelRadius' | 'cornerRadius' | 'fluteLength' | 'maxDepth'>): string[] {
  const out: string[] = []
  const R = t.diameter / 2
  const Rb = t.barrelRadius
  const rt = t.cornerRadius ?? 0
  if (!(R > 0)) out.push('The diameter must be above zero.')
  if (!(Rb !== undefined && Rb > R)) out.push(`The barrel radius (the side's arc) must be larger than half the diameter (${fmt(R)} mm).`)
  if (rt < 0 || rt > R + 1e-9) out.push(`The tip radius must be between 0 and half the diameter (${fmt(R)} mm).`)
  if (!((t.fluteLength ?? t.maxDepth) > 0)) out.push('The flute length must be above zero.')
  return out
}

/** Height of a barrel cutter's widest point above its tip. */
export function barrelWidest(t: Pick<Tool, 'diameter' | 'barrelRadius' | 'cornerRadius'>): number {
  const R = t.diameter / 2
  const Rb = t.barrelRadius ?? R
  const rt = Math.min(Math.max(0, t.cornerRadius ?? 0), R)
  return rt + Math.sqrt(Math.max(0, (Rb - rt) ** 2 - (Rb - R) ** 2))
}

/** A barrel cutter's outline (exact arcs) up to its flute length. Assumes `barrelProblems` found nothing. */
export function barrelForm(t: Pick<Tool, 'diameter' | 'barrelRadius' | 'cornerRadius' | 'fluteLength' | 'maxDepth'>): FormPoint[] {
  const R = t.diameter / 2
  const Rb = t.barrelRadius ?? R
  const rt = Math.min(Math.max(0, t.cornerRadius ?? 0), R)
  const flute = t.fluteLength ?? t.maxDepth
  const hw = barrelWidest(t)
  // the side arc's centre (across the axis, level with the widest point) and its radius at height h
  const cr = R - Rb
  const side = (h: number) => cr + Math.sqrt(Math.max(0, Rb * Rb - (h - hw) ** 2))
  const out: FormPoint[] = [{ h: 0, r: 0 }]
  // where the tip ball meets the side arc (on the line through both centres)
  const k = rt > 1e-12 ? Rb / (Rb - rt) : 1
  const T = { r: cr + (0 - cr) * k, h: hw + (rt - hw) * k }
  if (rt > 1e-12) out.push({ h: T.h, r: T.r, arc: rt })
  if (flute <= T.h + 1e-12) {
    // flutes end on the tip: cut it there (on the ball)
    const r = Math.sqrt(Math.max(0, rt * rt - (flute - rt) ** 2))
    return [{ h: 0, r: 0 }, { h: flute, r, arc: rt }]
  }
  if (flute <= hw) out.push({ h: flute, r: side(flute), arc: Rb })
  else {
    out.push({ h: hw, r: R, arc: Rb })
    out.push({ h: flute, r: Math.max(0, side(flute)), arc: Rb })
  }
  return out
}

/** One arc or straight stretch from a to b as points (b included, a not), arcs within `chord`. */
function stretch(a: OutlinePt, b: FormPoint, chord: number): OutlinePt[] {
  const L = Math.hypot(b.r - a.r, b.h - a.h)
  if (!b.arc || L < 1e-12) return [{ h: b.h, r: b.r }]
  const rho = Math.max(Math.abs(b.arc), L / 2)
  // outward normal of a -> b in the (r, h) plane (towards +r when going up)
  const nx = (b.h - a.h) / L
  const ny = -(b.r - a.r) / L
  const mid = { r: (a.r + b.r) / 2, h: (a.h + b.h) / 2 }
  const off = Math.sqrt(Math.max(0, rho * rho - (L * L) / 4))
  const s = b.arc > 0 ? -1 : 1
  const c = { r: mid.r + s * nx * off, h: mid.h + s * ny * off }
  const a0 = Math.atan2(a.h - c.h, a.r - c.r)
  let sw = Math.atan2(b.h - c.h, b.r - c.r) - a0
  while (sw > Math.PI) sw -= 2 * Math.PI
  while (sw < -Math.PI) sw += 2 * Math.PI
  const step = rho > chord ? 2 * Math.acos(1 - chord / rho) : Math.PI / 4
  const n = Math.max(1, Math.ceil(Math.abs(sw) / step))
  const out: OutlinePt[] = []
  for (let i = 1; i <= n; i++) {
    if (i === n) {
      out.push({ h: b.h, r: b.r })
      break
    }
    const t = a0 + (sw * i) / n
    out.push({ h: c.h + rho * Math.sin(t), r: Math.max(0, c.r + rho * Math.cos(t)) })
  }
  return out
}

/** An outline as straight pieces (arcs within `chord` mm), from the tip up. */
export function outlinePoints(pts: readonly FormPoint[], chord = FORM_CHORD): OutlinePt[] {
  if (!pts.length) return []
  const out: OutlinePt[] = [{ h: pts[0].h, r: pts[0].r }]
  for (let i = 1; i < pts.length; i++) out.push(...stretch(out[out.length - 1], pts[i], chord))
  return out
}

/** Is this a tool drawn from an outline (barrel or form)? */
export const isFormShape = (t: Pick<Tool, 'shape'> | null | undefined) => t?.shape === 'barrel' || t?.shape === 'form'

/** The outline points of a barrel or form tool (the whole outline given; null for other shapes or a bad outline). */
export function toolForm(t: Pick<Tool, 'shape' | 'diameter' | 'barrelRadius' | 'cornerRadius' | 'fluteLength' | 'maxDepth' | 'form'>): FormPoint[] | null {
  if (t.shape === 'barrel') return barrelProblems(t).length ? null : barrelForm(t)
  if (t.shape === 'form') return formProblems(t.form).length ? null : (t.form ?? null)
  return null
}

/** Problems with a barrel or form tool (empty for other shapes). */
export function toolFormProblems(t: Pick<Tool, 'shape' | 'diameter' | 'barrelRadius' | 'cornerRadius' | 'fluteLength' | 'maxDepth' | 'form'>): string[] {
  if (t.shape === 'barrel') return barrelProblems(t)
  if (t.shape === 'form') return formProblems(t.form)
  return []
}

/** The outline cut off at height H (the cutting part when H = the flute length). */
export function clipOutline(o: readonly OutlinePt[], H: number): OutlinePt[] {
  const out: OutlinePt[] = []
  for (let i = 0; i < o.length; i++) {
    const p = o[i]
    if (p.h <= H + 1e-12) {
      out.push(p)
      continue
    }
    const a = o[i - 1]
    if (a && a.h < H) out.push({ h: H, r: a.r + ((p.r - a.r) * (H - a.h)) / (p.h - a.h) })
    break
  }
  return out
}

/** Radius of the outline at height h (0 below the tip; the last radius above the top). */
export function outlineRadius(o: readonly OutlinePt[], h: number): number {
  if (!o.length || h < o[0].h) return 0
  for (let i = 1; i < o.length; i++) {
    const a = o[i - 1]
    const b = o[i]
    if (h <= b.h + 1e-12) {
      if (b.h - a.h < 1e-12) return Math.max(a.r, b.r)
      return a.r + ((b.r - a.r) * (h - a.h)) / (b.h - a.h)
    }
  }
  return o[o.length - 1].r
}

/** Largest radius of an outline. */
export const outlineMax = (o: readonly OutlinePt[]) => o.reduce((m, p) => Math.max(m, p.r), 0)

/**
 * Lowest height at which the outline reaches out to `d` from the axis (where the tool's underside
 * is at that distance), Infinity when it never does.
 */
export function outlineLowest(o: readonly OutlinePt[], d: number): number {
  if (!o.length) return Infinity
  if (o[0].r >= d - 1e-12) return o[0].h
  for (let i = 1; i < o.length; i++) {
    const a = o[i - 1]
    const b = o[i]
    if (b.r >= d - 1e-12) {
      if (Math.abs(b.r - a.r) < 1e-12) return a.h
      return a.h + ((b.h - a.h) * (d - a.r)) / (b.r - a.r)
    }
  }
  return Infinity
}

/**
 * The cutting outline of a barrel or form tool (straight pieces up to the flute length), and the
 * radius of its shaft above the flutes for the collision checks (the widest part of the outline
 * above the flutes, or the shank, whichever is wider: a check made with it can only report more).
 */
export function cuttingOutline(t: Pick<Tool, 'shape' | 'diameter' | 'barrelRadius' | 'cornerRadius' | 'fluteLength' | 'maxDepth' | 'form' | 'shankDiameter'>): { outline: OutlinePt[]; shaftR: number } | null {
  const f = toolForm(t)
  if (!f) return null
  const flute = t.fluteLength ?? t.maxDepth
  const all = outlinePoints(f)
  const outline = clipOutline(all, flute)
  const above = all.filter((p) => p.h > flute)
  const shaftR = Math.max(t.shankDiameter !== undefined ? t.shankDiameter / 2 : 0, above.length ? outlineMax(above) : outlineRadius(all, flute))
  return { outline, shaftR }
}

/**
 * The outline swept by the tool moving `D` along its own axis (from its lower end): below its widest
 * point as it is, then the widest radius for D, then the part above the widest point moved up by D.
 * Exact for outlines that widen up to one widest point and then narrow (barrels, lenses); for others
 * the widest point is the highest one with the largest radius.
 */
export function sweptOutline(o: readonly OutlinePt[], D: number): OutlinePt[] {
  if (!(D > 1e-12) || !o.length) return [...o]
  let k = 0
  for (let i = 1; i < o.length; i++) if (o[i].r >= o[k].r - 1e-12) k = i
  return [...o.slice(0, k + 1), ...o.slice(k).map((p) => ({ h: p.h + D, r: p.r }))]
}
