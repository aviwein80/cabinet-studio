/**
 * Kitchen-3: L-shaped parts (a pie-cut corner's bottom, top and shelves). An L part is its length x
 * width rectangle with one rectangular corner cut away (`Part.shape === 'L'`, a six-corner
 * `outline`). Its edges: the outer four keep their names (L1 at y = 0, L2 at y = width, W1 at x = 0,
 * W2 at x = length; two of them are shorter, stopped by the cut), and the two inside edges along the
 * cut are L3 (along the length) and W3 (across). Each can be banded.
 */
import { EPS } from './geometry'
import type { AnyEdgeKey, Part, Vec2 } from './types'

/** The cut-away corner of an L: the inside corner (the outline's one corner inside the rectangle) and the rectangle's corner that is missing. */
export interface LCorner {
  /** The inside (re-entrant) corner. */
  inner: Vec2
  /** The rectangle's corner cut away. */
  missing: Vec2
  /** Outward normal of L3 (0, ±1) and of W3 (±1, 0), in part coordinates: they point into the cut. */
  nL3: number
  nW3: number
}

type Shape = Pick<Part, 'length' | 'width' | 'outline'>

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6

/** The cut-away corner of a six-corner rectilinear outline with one corner cut off, or null for any other outline. */
export function lCorner(p: Shape): LCorner | null {
  const o = p.outline
  if (!o || o.length !== 6) return null
  const L = p.length
  const W = p.width
  const onX = (v: Vec2) => near(v.x, 0) || near(v.x, L)
  const onY = (v: Vec2) => near(v.y, 0) || near(v.y, W)
  const inner = o.filter((v) => !onX(v) && !onY(v))
  if (inner.length !== 1) return null
  const corners: Vec2[] = [
    { x: 0, y: 0 },
    { x: L, y: 0 },
    { x: L, y: W },
    { x: 0, y: W },
  ]
  const missing = corners.filter((c) => !o.some((v) => near(v.x, c.x) && near(v.y, c.y)))
  if (missing.length !== 1) return null
  const m = missing[0]
  const c = inner[0]
  return { inner: c, missing: m, nL3: Math.sign(m.y - c.y), nW3: Math.sign(m.x - c.x) }
}

/** One straight edge of a part's outline and its key; `n` is the outward normal in part coordinates. */
export interface EdgeSegment {
  key: AnyEdgeKey
  a: Vec2
  b: Vec2
  n: Vec2
}

/**
 * The edges of an L part in outline order, each with its key, or null when the part is not an L. The
 * outline is walked as given; the normals are worked out from where the edge lies, not the winding.
 */
export function lSegments(p: Shape): EdgeSegment[] | null {
  const c = lCorner(p)
  if (!c) return null
  const o = p.outline!
  const out: EdgeSegment[] = []
  for (let i = 0; i < o.length; i++) {
    const a = o[i]
    const b = o[(i + 1) % o.length]
    const horizontal = Math.abs(a.y - b.y) < EPS
    let key: AnyEdgeKey
    let n: Vec2
    if (horizontal) {
      if (near(a.y, 0)) [key, n] = ['L1', { x: 0, y: -1 }]
      else if (near(a.y, p.width)) [key, n] = ['L2', { x: 0, y: 1 }]
      else [key, n] = ['L3', { x: 0, y: c.nL3 }]
    } else if (near(a.x, 0)) [key, n] = ['W1', { x: -1, y: 0 }]
    else if (near(a.x, p.length)) [key, n] = ['W2', { x: 1, y: 0 }]
    else [key, n] = ['W3', { x: c.nW3, y: 0 }]
    out.push({ key, a, b, n })
  }
  return out
}

/** Length of each edge of an L part (an outer edge stopped by the cut is shorter than its side). */
export function lEdgeLengths(p: Shape): Partial<Record<AnyEdgeKey, number>> {
  const out: Partial<Record<AnyEdgeKey, number>> = {}
  for (const s of lSegments(p) ?? []) out[s.key] = (out[s.key] ?? 0) + Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y)
  return out
}

/** True when `pt` lies on the part (inside its outline), for an L part; the rectangle otherwise. */
export function onPart(p: Shape & Pick<Part, 'shape'>, pt: Vec2) {
  const inRect = pt.x >= -EPS && pt.x <= p.length + EPS && pt.y >= -EPS && pt.y <= p.width + EPS
  if (!inRect || p.shape !== 'L') return inRect
  const c = lCorner(p)
  if (!c) return inRect
  // strictly inside the cut-away rectangle = off the part
  const inCutX = c.nW3 > 0 ? pt.x > c.inner.x + EPS : pt.x < c.inner.x - EPS
  const inCutY = c.nL3 > 0 ? pt.y > c.inner.y + EPS : pt.y < c.inner.y - EPS
  return !(inCutX && inCutY)
}

/**
 * Kitchen-3c: an L outline with its inside corner rounded to radius `r` (as cut): the inside corner is
 * replaced by a quarter circle that meets L3 and W3 (centre in the cut-away corner, so the part keeps
 * the material a router leaves there), as straight segments no more than `tol` from the true arc.
 * `r` is kept under the shorter inside edge. Any other outline, or `r` <= 0, comes back unchanged.
 */
export function roundInnerCorner(p: Shape, r: number, tol = 0.01): Vec2[] {
  const o = p.outline ?? []
  const c = r > 0 ? lCorner(p) : null
  if (!c) return o
  const i = o.findIndex((v) => near(v.x, c.inner.x) && near(v.y, c.inner.y))
  const prev = o[(i + o.length - 1) % o.length]
  const next = o[(i + 1) % o.length]
  const reach = Math.min(Math.hypot(prev.x - c.inner.x, prev.y - c.inner.y), Math.hypot(next.x - c.inner.x, next.y - c.inner.y))
  const rr = Math.min(r, reach - 0.01)
  if (!(rr > 0)) return o
  // centre in the cut-away corner; from the point on W3 (t = 0) to the point on L3 (t = 90°)
  const cx = c.inner.x + rr * c.nW3
  const cy = c.inner.y + rr * c.nL3
  const n = Math.max(2, Math.ceil(Math.PI / 2 / (2 * Math.acos(Math.max(-1, 1 - Math.min(tol, rr) / rr)))))
  const arc: Vec2[] = []
  for (let k = 0; k <= n; k++) {
    const t = (Math.PI / 2) * (k / n)
    arc.push({ x: Math.round((cx - rr * c.nW3 * Math.cos(t)) * 1000) / 1000 + 0, y: Math.round((cy - rr * c.nL3 * Math.sin(t)) * 1000) / 1000 + 0 })
  }
  // the outline reaches the corner along W3 (same x) or along L3 (same y)
  const fromW3 = near(prev.x, c.inner.x)
  return [...o.slice(0, i), ...(fromW3 ? arc : arc.reverse()), ...o.slice(i + 1)]
}
