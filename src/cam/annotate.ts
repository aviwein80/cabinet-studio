/**
 * Annotation (NEW-21, M3.2): hatching, detail views and line types. Notes only, like dimensions:
 * never machined or written to a machine program.
 *
 * - A hatch fills closed shapes with parallel lines (or crossed lines) at a set angle and spacing
 *   (part mm). It refers to its shapes by id, so it follows them when they change, and drops out
 *   when they are deleted.
 * - A detail view magnifies a circle of the drawing by a set factor and shows it elsewhere on the
 *   sheet, with the circle marked and labelled where it was taken.
 * - Line types (dashed, hidden, centre, dotted) are set per layer. Their dash lengths are paper mm
 *   in a print (so a print at any scale has the same dashes) and screen pixels on screen.
 */
import { entityContours } from './doc'
import { type P, toPoints } from './geom'
import type { Annotation, CamPart, DetailNote, HatchNote, LineType } from './types'

export const LINE_TYPES: Record<LineType, { label: string; dash: number[] }> = {
  solid: { label: 'Solid', dash: [] },
  dashed: { label: 'Dashed', dash: [4, 2] },
  hidden: { label: 'Hidden (short dashes)', dash: [2, 1.5] },
  centre: { label: 'Centre line', dash: [8, 1.5, 1.5, 1.5] },
  dotted: { label: 'Dotted', dash: [0.4, 1.2] },
}

/** Dash pattern of a layer's line type on screen (pixels), or undefined for solid lines. */
export function screenDash(t: LineType | undefined): string | undefined {
  const d = t ? LINE_TYPES[t].dash : []
  return d.length ? d.map((x) => Math.max(1, Math.round(x * 2))).join(' ') : undefined
}

/**
 * A polyline cut into the dashes of a pattern (dash, gap, dash, gap...; in the polyline's units).
 * The pattern runs on round corners without starting again.
 */
export function dashPolyline(pts: P[], pattern: number[], phase = 0): P[][] {
  if (pts.length < 2 || !pattern.length || pattern.some((d) => !(d > 0))) return pts.length >= 2 ? [pts] : []
  const period = pattern.reduce((a, b) => a + b, 0)
  // where in the pattern we are: index k, and how far into it
  let k = 0
  let into = ((phase % period) + period) % period
  while (into >= pattern[k]) {
    into -= pattern[k]
    k = (k + 1) % pattern.length
  }
  const out: P[][] = []
  let cur: P[] | null = k % 2 === 0 ? [pts[0]] : null
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const L = Math.hypot(b.x - a.x, b.y - a.y)
    let s = 0
    while (L - s > 1e-12) {
      const left = pattern[k] - into
      if (left > L - s) {
        into += L - s
        s = L
        if (cur) cur.push(b)
        break
      }
      s += left
      const q = { x: a.x + ((b.x - a.x) * s) / L, y: a.y + ((b.y - a.y) * s) / L }
      if (cur) {
        cur.push(q)
        if (cur.length > 1) out.push(cur)
        cur = null
      } else cur = [q]
      into = 0
      k = (k + 1) % pattern.length
    }
  }
  if (cur && cur.length > 1) out.push(cur)
  return out
}

/**
 * Hatch lines over closed rings (read even-odd, so a ring inside another is a hole). Lines are at
 * `angle` degrees, `spacing` apart, on a grid through the origin (so neighbouring hatches line up);
 * `cross` adds the same at 90° more.
 */
export function hatchLines(rings: P[][], angle: number, spacing: number, cross = false): [P, P][] {
  const out: [P, P][] = []
  if (!(spacing > 0) || !rings.length) return out
  for (const deg of cross ? [angle, angle + 90] : [angle]) {
    const a = (deg * Math.PI) / 180
    const c = Math.cos(a)
    const s = Math.sin(a)
    // into the hatch's frame: lines run along u, stacked along v
    const toF = (p: P) => ({ u: p.x * c + p.y * s, v: -p.x * s + p.y * c })
    const fromF = (u: number, v: number): P => ({ x: u * c - v * s, y: u * s + v * c })
    const fr = rings.map((r) => r.map(toF))
    let vMin = Infinity
    let vMax = -Infinity
    for (const r of fr)
      for (const p of r) {
        vMin = Math.min(vMin, p.v)
        vMax = Math.max(vMax, p.v)
      }
    // more lines than this would only make a grey blot (and hold the screen up)
    if ((vMax - vMin) / spacing > 20000) continue
    for (let j = Math.ceil(vMin / spacing); j * spacing <= vMax; j++) {
      const v = j * spacing
      const us: number[] = []
      for (const r of fr)
        for (let i = 0; i < r.length; i++) {
          const p = r[i]
          const q = r[(i + 1) % r.length]
          // half-open, so a line through a corner counts it once
          if (p.v <= v !== q.v <= v) us.push(p.u + ((v - p.v) * (q.u - p.u)) / (q.v - p.v))
        }
      us.sort((x, y) => x - y)
      for (let i = 0; i + 1 < us.length; i += 2) if (us[i + 1] - us[i] > 1e-9) out.push([fromF(us[i], v), fromF(us[i + 1], v)])
    }
  }
  return out
}

/** The closed rings a hatch fills (its shapes as they are now; shapes gone are left out). */
export function hatchRings(part: CamPart, h: HatchNote, tol = 0.05): P[][] {
  const rings: P[][] = []
  for (const id of h.shapes) {
    const e = part.entities.find((x) => x.id === id)
    if (!e) continue
    for (const c of entityContours(e)) if (c.closed) rings.push(toPoints(c, tol))
  }
  return rings
}

/** A circle as a closed polyline, within `tol` of the true circle. */
export function circlePts(c: P, r: number, tol = 0.02): P[] {
  const n = Math.max(24, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - tol / Math.max(r, tol)))))
  return Array.from({ length: n + 1 }, (_, i) => ({ x: c.x + r * Math.cos((2 * Math.PI * i) / n), y: c.y + r * Math.sin((2 * Math.PI * i) / n) }))
}

/** The parts of a polyline inside a circle. */
export function clipToCircle(poly: P[], c: P, r: number): P[][] {
  const out: P[][] = []
  let cur: P[] = []
  const inside = (p: P) => Math.hypot(p.x - c.x, p.y - c.y) <= r + 1e-12
  for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i]
    const b = poly[i + 1]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const A = dx * dx + dy * dy
    const B = 2 * (dx * (a.x - c.x) + dy * (a.y - c.y))
    const C = (a.x - c.x) ** 2 + (a.y - c.y) ** 2 - r * r
    let t0 = 0
    let t1 = 1
    if (A < 1e-24) {
      if (!inside(a)) continue
    } else {
      const disc = B * B - 4 * A * C
      if (disc <= 0) {
        if (cur.length > 1) out.push(cur)
        cur = []
        continue
      }
      const sq = Math.sqrt(disc)
      t0 = Math.max(0, (-B - sq) / (2 * A))
      t1 = Math.min(1, (-B + sq) / (2 * A))
      if (t0 >= t1) {
        if (cur.length > 1) out.push(cur)
        cur = []
        continue
      }
    }
    const p = { x: a.x + dx * t0, y: a.y + dy * t0 }
    const q = { x: a.x + dx * t1, y: a.y + dy * t1 }
    if (cur.length && Math.hypot(cur[cur.length - 1].x - p.x, cur[cur.length - 1].y - p.y) < 1e-9) cur.push(q)
    else {
      if (cur.length > 1) out.push(cur)
      cur = [p, q]
    }
    if (t1 < 1) {
      if (cur.length > 1) out.push(cur)
      cur = []
    }
  }
  if (cur.length > 1) out.push(cur)
  return out
}

export interface DetailView {
  /** The circle marked on the drawing where the detail is taken. */
  mark: P[]
  /** The magnified drawing, placed at the detail's spot (part mm, so a print scales it once more). */
  lines: P[][]
  /** The detail's border. */
  border: P[]
  /** Label at the marked circle and under the detail. */
  texts: { at: P; text: string }[]
}

/** A detail view: the drawing inside the circle, magnified about its centre and moved to `at`. */
export function detailView(lines: P[][], d: DetailNote): DetailView {
  const k = d.scale
  const map = (p: P): P => ({ x: d.at.x + (p.x - d.c.x) * k, y: d.at.y + (p.y - d.c.y) * k })
  const out = lines.flatMap((l) => clipToCircle(l, d.c, d.r)).map((l) => l.map(map))
  const ratio = k >= 1 ? `${trim(k)}:1` : `1:${trim(1 / k)}`
  return {
    mark: circlePts(d.c, d.r),
    lines: out,
    border: circlePts(d.at, d.r * k),
    texts: [
      { at: { x: d.c.x, y: d.c.y + d.r * 1.08 }, text: d.label },
      { at: { x: d.at.x, y: d.at.y - d.r * k * 1.08 }, text: `Detail ${d.label} (${ratio})` },
    ],
  }
}
const trim = (n: number) => String(Math.round(n * 100) / 100)

/** Lines of face 1 a detail view magnifies: the shapes on visible layers, hatching too. */
export function drawingLines(part: CamPart, tol = 0.05): P[][] {
  const lines: P[][] = []
  for (const e of part.entities) {
    if (e.face !== 1 || part.layers.find((l) => l.id === e.layer)?.visible === false) continue
    for (const c of entityContours(e)) {
      const pts = toPoints(c, tol)
      if (pts.length > 1) lines.push(c.closed ? [...pts, pts[0]] : pts)
    }
  }
  for (const a of part.annotations ?? []) if (a.k === 'hatch') for (const [p, q] of hatchLines(hatchRings(part, a, tol), a.angle, a.spacing, a.cross)) lines.push([p, q])
  return lines
}

/** Everything the annotations draw, in part mm: lines (hatching, detail views) and texts. */
export function annotationLines(part: CamPart, tol = 0.05): { lines: P[][]; texts: { at: P; text: string }[] } {
  const notes = part.annotations ?? []
  const lines: P[][] = []
  const texts: { at: P; text: string }[] = []
  for (const a of notes) if (a.k === 'hatch') for (const [p, q] of hatchLines(hatchRings(part, a, tol), a.angle, a.spacing, a.cross)) lines.push([p, q])
  const details = notes.filter((a): a is DetailNote => a.k === 'detail')
  if (details.length) {
    const base = drawingLines(part, tol)
    for (const d of details) {
      const v = detailView(base, d)
      lines.push(v.mark, v.border, ...v.lines)
      texts.push(...v.texts)
    }
  }
  return { lines, texts }
}

/** Annotations whose shapes are all gone (a hatch with nothing left to fill). */
export function brokenAnnotations(part: CamPart): Annotation[] {
  return (part.annotations ?? []).filter((a) => a.k === 'hatch' && !a.shapes.some((id) => part.entities.some((e) => e.id === id)))
}
