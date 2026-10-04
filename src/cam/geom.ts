/**
 * 2D geometry kernel for custom parts. Contours are chains of native line and arc segments;
 * arcs are never tessellated until a consumer (booleans, display, nesting) needs points.
 * All lengths are millimetres. Arcs are stored with an explicit centre and direction.
 */

export interface P {
  x: number
  y: number
}
export interface LineSeg {
  k: 'L'
  a: P
  b: P
}
export interface ArcSeg {
  k: 'A'
  a: P
  b: P
  c: P
  ccw: boolean
}
export type Seg = LineSeg | ArcSeg
export interface Contour {
  segs: Seg[]
  closed: boolean
}

/** Kernel tolerances (mm). Editable from settings; every function reads them at call time. */
export const TOL = {
  /** Max chord error when arcs are turned into points for Clipper or display. */
  chord: 0.001,
  /** Max deviation when points are fitted back into lines and arcs. */
  fit: 0.005,
  /** Endpoints closer than this are the same point (join, close, snap). */
  join: 0.01,
}
export function setTolerances(t: Partial<typeof TOL>) {
  Object.assign(TOL, t)
}

const TAU = Math.PI * 2
export const pt = (x: number, y: number): P => ({ x, y })
export const add = (a: P, b: P): P => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: P, b: P): P => ({ x: a.x - b.x, y: a.y - b.y })
export const mul = (a: P, s: number): P => ({ x: a.x * s, y: a.y * s })
export const dot = (a: P, b: P) => a.x * b.x + a.y * b.y
export const cross = (a: P, b: P) => a.x * b.y - a.y * b.x
export const len = (a: P) => Math.hypot(a.x, a.y)
export const dist = (a: P, b: P) => Math.hypot(b.x - a.x, b.y - a.y)
export const near = (a: P, b: P, t = TOL.join) => dist(a, b) <= t
export const unit = (a: P): P => {
  const l = len(a)
  return l < 1e-15 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }
}
/** Rotate +90 degrees (left normal). */
export const left = (a: P): P => ({ x: -a.y, y: a.x })
export const right = (a: P): P => ({ x: a.y, y: -a.x })
export const lerp = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
export const angleOf = (c: P, p: P) => Math.atan2(p.y - c.y, p.x - c.x)
export const polar = (c: P, r: number, ang: number): P => ({ x: c.x + r * Math.cos(ang), y: c.y + r * Math.sin(ang) })
export const r6 = (n: number) => Math.round(n * 1e6) / 1e6
export const rp = (p: P): P => ({ x: r6(p.x), y: r6(p.y) })

export const line = (a: P, b: P): LineSeg => ({ k: 'L', a, b })
export const arc = (a: P, b: P, c: P, ccw: boolean): ArcSeg => ({ k: 'A', a, b, c, ccw })

export function radius(s: ArcSeg) {
  return (dist(s.c, s.a) + dist(s.c, s.b)) / 2
}

/** Signed sweep, positive counter-clockwise, magnitude in (0, 2*pi]. */
export function sweep(s: ArcSeg) {
  let d = angleOf(s.c, s.b) - angleOf(s.c, s.a)
  if (s.ccw) while (d <= 1e-12) d += TAU
  else while (d >= -1e-12) d -= TAU
  return d
}

export function segLength(s: Seg) {
  return s.k === 'L' ? dist(s.a, s.b) : Math.abs(sweep(s)) * radius(s)
}
export function contourLength(c: Contour) {
  return c.segs.reduce((n, s) => n + segLength(s), 0)
}

export function pointAt(s: Seg, t: number): P {
  if (s.k === 'L') return lerp(s.a, s.b, t)
  return polar(s.c, radius(s), angleOf(s.c, s.a) + sweep(s) * t)
}

/** Unit tangent in the direction of travel. */
export function tangentAt(s: Seg, t: number): P {
  if (s.k === 'L') return unit(sub(s.b, s.a))
  const r = sub(pointAt(s, t), s.c)
  return unit(s.ccw ? left(r) : right(r))
}

export function reverseSeg(s: Seg): Seg {
  return s.k === 'L' ? line(s.b, s.a) : arc(s.b, s.a, s.c, !s.ccw)
}
export function reverse(c: Contour): Contour {
  return { closed: c.closed, segs: c.segs.map(reverseSeg).reverse() }
}
export const startOf = (c: Contour) => c.segs[0].a
export const endOf = (c: Contour) => c.segs[c.segs.length - 1].b

/** Points along a segment, excluding its start point. */
export function tessellateSeg(s: Seg, tol = TOL.chord): P[] {
  if (s.k === 'L') return [s.b]
  const r = radius(s)
  const sw = sweep(s)
  const step = r <= tol ? Math.PI / 2 : 2 * Math.acos(Math.max(-1, 1 - tol / r))
  const n = Math.max(1, Math.ceil(Math.abs(sw) / Math.max(step, 1e-4)))
  const a0 = angleOf(s.c, s.a)
  const out: P[] = []
  for (let i = 1; i < n; i++) out.push(polar(s.c, r, a0 + (sw * i) / n))
  out.push(s.b)
  return out
}

/** Polyline of a contour. Closed contours do not repeat the first point. */
export function toPoints(c: Contour, tol = TOL.chord): P[] {
  if (!c.segs.length) return []
  const out: P[] = [c.segs[0].a]
  for (const s of c.segs) out.push(...tessellateSeg(s, tol))
  if (c.closed && out.length > 1 && near(out[0], out[out.length - 1], 1e-9)) out.pop()
  return out
}

/** Exact signed area (counter-clockwise positive) of a closed contour. */
export function area(c: Contour) {
  let a = 0
  for (const s of c.segs) {
    a += (s.a.x * s.b.y - s.b.x * s.a.y) / 2
    if (s.k === 'A') {
      const r = radius(s)
      const th = Math.abs(sweep(s))
      a += (s.ccw ? 1 : -1) * (r * r * (th - Math.sin(th))) / 2
    }
  }
  return a
}

export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}
export function segBox(s: Seg): Box {
  const xs = [s.a.x, s.b.x]
  const ys = [s.a.y, s.b.y]
  if (s.k === 'A') {
    const r = radius(s)
    const a0 = angleOf(s.c, s.a)
    const sw = sweep(s)
    for (let q = 0; q < 4; q++) {
      const ang = (q * Math.PI) / 2
      let d = ang - a0
      if (sw > 0) {
        while (d < 0) d += TAU
        while (d >= TAU) d -= TAU
        if (d <= sw) {
          xs.push(s.c.x + r * Math.cos(ang))
          ys.push(s.c.y + r * Math.sin(ang))
        }
      } else {
        while (d > 0) d -= TAU
        while (d <= -TAU) d += TAU
        if (d >= sw) {
          xs.push(s.c.x + r * Math.cos(ang))
          ys.push(s.c.y + r * Math.sin(ang))
        }
      }
    }
  }
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}
export function boxOf(cs: Contour[]): Box {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const c of cs)
    for (const s of c.segs) {
      const sb = segBox(s)
      b.minX = Math.min(b.minX, sb.minX)
      b.minY = Math.min(b.minY, sb.minY)
      b.maxX = Math.max(b.maxX, sb.maxX)
      b.maxY = Math.max(b.maxY, sb.maxY)
    }
  return b
}

// ---------------------------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------------------------

export function polyline(points: P[], closed: boolean): Contour {
  const segs: Seg[] = []
  for (let i = 0; i + 1 < points.length; i++) segs.push(line(points[i], points[i + 1]))
  if (closed && points.length > 2 && !near(points[0], points[points.length - 1], 1e-9)) segs.push(line(points[points.length - 1], points[0]))
  return { segs, closed }
}
export function rect(x: number, y: number, w: number, h: number): Contour {
  return polyline([pt(x, y), pt(x + w, y), pt(x + w, y + h), pt(x, y + h)], true)
}
export function circle(c: P, r: number): Contour {
  const a = pt(c.x + r, c.y)
  const b = pt(c.x - r, c.y)
  return { closed: true, segs: [arc(a, b, c, true), arc(b, a, c, true)] }
}
export function roundedRect(x: number, y: number, w: number, h: number, r: number): Contour {
  r = Math.max(0, Math.min(r, w / 2, h / 2))
  if (r < 1e-9) return rect(x, y, w, h)
  const segs: Seg[] = []
  const pts = [
    [pt(x + r, y), pt(x + w - r, y), pt(x + w - r, y + r)],
    [pt(x + w, y + r), pt(x + w, y + h - r), pt(x + w - r, y + h - r)],
    [pt(x + w - r, y + h), pt(x + r, y + h), pt(x + r, y + h - r)],
    [pt(x, y + h - r), pt(x, y + r), pt(x + r, y + r)],
  ]
  for (let i = 0; i < 4; i++) {
    const [a, b, c] = pts[i]
    if (dist(a, b) > 1e-9) segs.push(line(a, b))
    segs.push(arc(b, pts[(i + 1) % 4][0], c, true))
  }
  return { segs, closed: true }
}
export function regularPolygon(c: P, r: number, n: number, rot = 0): Contour {
  const pts: P[] = []
  for (let i = 0; i < n; i++) pts.push(polar(c, r, rot + (TAU * i) / n))
  return polyline(pts, true)
}
export function slot(a: P, b: P, width: number): Contour {
  const r = width / 2
  const d = unit(sub(b, a))
  const n = left(d)
  const a1 = add(a, mul(n, -r))
  const b1 = add(b, mul(n, -r))
  const b2 = add(b, mul(n, r))
  const a2 = add(a, mul(n, r))
  return { closed: true, segs: [line(a1, b1), arc(b1, b2, b, true), line(b2, a2), arc(a2, a1, a, true)] }
}
export function ellipse(c: P, rx: number, ry: number, rot = 0): Contour {
  const pts: P[] = []
  const n = 720
  for (let i = 0; i < n; i++) {
    const t = (TAU * i) / n
    const x = rx * Math.cos(t)
    const y = ry * Math.sin(t)
    pts.push(pt(c.x + x * Math.cos(rot) - y * Math.sin(rot), c.y + x * Math.sin(rot) + y * Math.cos(rot)))
  }
  return { closed: true, segs: fitPoints(pts, true, Math.max(TOL.fit, 0.01)) }
}

/** Circle through three points, or null when they are collinear. */
export function circleThrough(p1: P, p2: P, p3: P): { c: P; r: number } | null {
  const d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y))
  if (Math.abs(d) < 1e-12) return null
  const s1 = p1.x * p1.x + p1.y * p1.y
  const s2 = p2.x * p2.x + p2.y * p2.y
  const s3 = p3.x * p3.x + p3.y * p3.y
  const c = pt((s1 * (p2.y - p3.y) + s2 * (p3.y - p1.y) + s3 * (p1.y - p2.y)) / d, (s1 * (p3.x - p2.x) + s2 * (p1.x - p3.x) + s3 * (p2.x - p1.x)) / d)
  return { c, r: dist(c, p1) }
}
/** Arc from p1 through p2 to p3. */
export function arc3(p1: P, p2: P, p3: P): Seg {
  const ci = circleThrough(p1, p2, p3)
  if (!ci) return line(p1, p3)
  return arc(p1, p3, ci.c, cross(sub(p2, p1), sub(p3, p2)) > 0)
}
/** Arc from a DXF-style bulge (tan of a quarter of the included angle; positive = CCW). */
export function bulgeSeg(a: P, b: P, bulge: number): Seg {
  if (Math.abs(bulge) < 1e-12 || near(a, b, 1e-12)) return line(a, b)
  const th = 4 * Math.atan(bulge)
  const chord = dist(a, b)
  const r = chord / (2 * Math.sin(Math.abs(th) / 2))
  const m = lerp(a, b, 0.5)
  const h = r * Math.cos(Math.abs(th) / 2)
  const n = left(unit(sub(b, a)))
  const c = add(m, mul(n, (bulge > 0 ? 1 : -1) * (Math.abs(th) < Math.PI ? h : -h)))
  return arc(a, b, c, bulge > 0)
}
export function bulgeOf(s: Seg) {
  return s.k === 'L' ? 0 : Math.tan(sweep(s) / 4)
}

export function boltHoles(c: P, r: number, n: number, start = 0): P[] {
  const out: P[] = []
  for (let i = 0; i < n; i++) out.push(polar(c, r, start + (TAU * i) / n))
  return out
}

/** Point and tangent at arc length `d` along a contour. */
export function atLength(c: Contour, d: number): { p: P; t: P; seg: number; u: number } {
  let acc = 0
  for (let i = 0; i < c.segs.length; i++) {
    const s = c.segs[i]
    const l = segLength(s)
    if (d <= acc + l + 1e-12 || i === c.segs.length - 1) {
      const u = l < 1e-12 ? 0 : Math.min(1, Math.max(0, (d - acc) / l))
      return { p: pointAt(s, u), t: tangentAt(s, u), seg: i, u }
    }
    acc += l
  }
  return { p: startOf(c), t: tangentAt(c.segs[0], 0), seg: 0, u: 0 }
}
/** n points equally spaced along a contour (closed: n gaps, open: ends included). */
export function pointsAlong(c: Contour, n: number): P[] {
  const L = contourLength(c)
  const out: P[] = []
  const gaps = c.closed ? n : Math.max(1, n - 1)
  for (let i = 0; i < n; i++) out.push(atLength(c, (L * i) / gaps).p)
  return out
}

// ---------------------------------------------------------------------------------------------
// Transforms: m = [a, b, c, d, e, f] maps (x, y) -> (a x + c y + e, b x + d y + f)
// ---------------------------------------------------------------------------------------------

export type Mat = [number, number, number, number, number, number]
export const applyM = (m: Mat, p: P): P => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] })
export const mulM = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]
export const translateM = (dx: number, dy: number): Mat => [1, 0, 0, 1, dx, dy]
export function rotateM(ang: number, about: P = pt(0, 0)): Mat {
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  return [c, s, -s, c, about.x - c * about.x + s * about.y, about.y - s * about.x - c * about.y]
}
export function scaleM(sx: number, sy: number, about: P = pt(0, 0)): Mat {
  return [sx, 0, 0, sy, about.x - sx * about.x, about.y - sy * about.y]
}
export function mirrorM(a: P, b: P): Mat {
  const d = unit(sub(b, a))
  const c2 = d.x * d.x - d.y * d.y
  const s2 = 2 * d.x * d.y
  const m: Mat = [c2, s2, s2, -c2, 0, 0]
  const q = applyM(m, a)
  return [m[0], m[1], m[2], m[3], a.x - q.x, a.y - q.y]
}
export const skewM = (kx: number, ky: number): Mat => [1, Math.tan(ky), Math.tan(kx), 1, 0, 0]

export function transform(c: Contour, m: Mat): Contour {
  const det = m[0] * m[3] - m[1] * m[2]
  const similar = (Math.abs(m[0] - m[3]) < 1e-12 && Math.abs(m[1] + m[2]) < 1e-12) || (Math.abs(m[0] + m[3]) < 1e-12 && Math.abs(m[1] - m[2]) < 1e-12)
  if (!similar && c.segs.some((s) => s.k === 'A')) {
    const pts = toPoints(c).map((p) => applyM(m, p))
    return { closed: c.closed, segs: fitPoints(c.closed ? pts : pts, c.closed) }
  }
  return {
    closed: c.closed,
    segs: c.segs.map((s) => (s.k === 'L' ? line(applyM(m, s.a), applyM(m, s.b)) : arc(applyM(m, s.a), applyM(m, s.b), applyM(m, s.c), det < 0 ? !s.ccw : s.ccw))),
  }
}

// ---------------------------------------------------------------------------------------------
// Intersections
// ---------------------------------------------------------------------------------------------

export interface Hit {
  p: P
  /** Parameter along segment 1 / 2 (0..1). */
  t1: number
  t2: number
}

function paramOn(s: Seg, p: P) {
  if (s.k === 'L') {
    const d = sub(s.b, s.a)
    const l2 = dot(d, d)
    return l2 < 1e-24 ? 0 : dot(sub(p, s.a), d) / l2
  }
  const sw = sweep(s)
  let d = angleOf(s.c, p) - angleOf(s.c, s.a)
  if (sw > 0) {
    while (d < -1e-9) d += TAU
    while (d > TAU - 1e-9) d -= TAU
  } else {
    while (d > 1e-9) d -= TAU
    while (d < -TAU + 1e-9) d += TAU
  }
  return d / sw
}
export { paramOn }

type Curve = { k: 'line'; p: P; d: P } | { k: 'circle'; c: P; r: number }
export const curveOf = (s: Seg): Curve => (s.k === 'L' ? { k: 'line', p: s.a, d: unit(sub(s.b, s.a)) } : { k: 'circle', c: s.c, r: radius(s) })

export function intersectCurves(a: Curve, b: Curve): P[] {
  if (a.k === 'line' && b.k === 'line') {
    const den = cross(a.d, b.d)
    if (Math.abs(den) < 1e-12) return []
    const t = cross(sub(b.p, a.p), b.d) / den
    return [add(a.p, mul(a.d, t))]
  }
  if (a.k === 'circle' && b.k === 'line') return intersectCurves(b, a)
  if (a.k === 'line' && b.k === 'circle') {
    const f = sub(a.p, b.c)
    const B = 2 * dot(f, a.d)
    const C = dot(f, f) - b.r * b.r
    let disc = B * B - 4 * C
    if (disc < -1e-9) return []
    disc = Math.max(0, disc)
    const sq = Math.sqrt(disc)
    const t1 = (-B - sq) / 2
    const t2 = (-B + sq) / 2
    return sq < 1e-12 ? [add(a.p, mul(a.d, t1))] : [add(a.p, mul(a.d, t1)), add(a.p, mul(a.d, t2))]
  }
  const A = a as { c: P; r: number }
  const Bc = b as { c: P; r: number }
  const d = dist(A.c, Bc.c)
  if (d < 1e-12 || d > A.r + Bc.r + 1e-9 || d < Math.abs(A.r - Bc.r) - 1e-9) return []
  const x = (d * d + A.r * A.r - Bc.r * Bc.r) / (2 * d)
  const h = Math.sqrt(Math.max(0, A.r * A.r - x * x))
  const u = unit(sub(Bc.c, A.c))
  const m = add(A.c, mul(u, x))
  return h < 1e-12 ? [m] : [add(m, mul(left(u), h)), add(m, mul(left(u), -h))]
}

export function intersectSegs(s1: Seg, s2: Seg, eps = 1e-7): Hit[] {
  const out: Hit[] = []
  for (const p of intersectCurves(curveOf(s1), curveOf(s2))) {
    const t1 = paramOn(s1, p)
    const t2 = paramOn(s2, p)
    if (t1 >= -eps && t1 <= 1 + eps && t2 >= -eps && t2 <= 1 + eps) out.push({ p, t1: Math.min(1, Math.max(0, t1)), t2: Math.min(1, Math.max(0, t2)) })
  }
  return out
}

/** Split a segment at parameter t. */
export function splitSeg(s: Seg, t: number): [Seg, Seg] {
  const m = pointAt(s, t)
  if (s.k === 'L') return [line(s.a, m), line(m, s.b)]
  return [arc(s.a, m, s.c, s.ccw), arc(m, s.b, s.c, s.ccw)]
}
/** Portion of a segment between parameters t0 < t1. */
export function subSeg(s: Seg, t0: number, t1: number): Seg {
  const a = pointAt(s, t0)
  const b = pointAt(s, t1)
  return s.k === 'L' ? line(a, b) : arc(a, b, s.c, s.ccw)
}

/** Closest point on a segment. */
export function closestOnSeg(s: Seg, p: P): { p: P; t: number; d: number } {
  if (s.k === 'L') {
    const t = Math.min(1, Math.max(0, paramOn(s, p)))
    const q = pointAt(s, t)
    return { p: q, t, d: dist(p, q) }
  }
  const r = radius(s)
  const onCircle = add(s.c, mul(unit(sub(p, s.c)), r))
  const t = paramOn(s, onCircle)
  if (t >= 0 && t <= 1) return { p: onCircle, t, d: dist(p, onCircle) }
  const da = dist(p, s.a)
  const db = dist(p, s.b)
  return da < db ? { p: s.a, t: 0, d: da } : { p: s.b, t: 1, d: db }
}
export function closestOnContour(c: Contour, p: P) {
  let best = { seg: 0, p: startOf(c), t: 0, d: Infinity }
  c.segs.forEach((s, i) => {
    const q = closestOnSeg(s, p)
    if (q.d < best.d) best = { seg: i, ...q }
  })
  return best
}

export function pointInContour(c: Contour, p: P) {
  const pts = toPoints(c, 0.01)
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]
    const b = pts[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

// ---------------------------------------------------------------------------------------------
// Point fitting: polyline -> lines and arcs (used after offsets, booleans and imports)
// ---------------------------------------------------------------------------------------------

function distToSegment(p: P, a: P, b: P) {
  const d = sub(b, a)
  const l2 = dot(d, d)
  if (l2 < 1e-24) return dist(p, a)
  const t = Math.min(1, Math.max(0, dot(sub(p, a), d) / l2))
  return dist(p, add(a, mul(d, t)))
}

/** Fit a polyline with lines and arcs (each arc at most 180 degrees) within `tol`. */
export function fitPoints(input: P[], closed: boolean, tol = TOL.fit): Seg[] {
  const p: P[] = []
  for (const q of input) if (!p.length || !near(p[p.length - 1], q, 1e-9)) p.push(q)
  if (closed) {
    while (p.length > 1 && near(p[0], p[p.length - 1], 1e-9)) p.pop()
    if (p.length < 3) return []
    let best = 0
    let bestTurn = -1
    for (let i = 0; i < p.length; i++) {
      const a = p[(i - 1 + p.length) % p.length]
      const b = p[i]
      const c = p[(i + 1) % p.length]
      const turn = Math.abs(Math.atan2(cross(sub(b, a), sub(c, b)), dot(sub(b, a), sub(c, b))))
      if (turn > bestTurn + 1e-9) {
        bestTurn = turn
        best = i
      }
    }
    const rot = [...p.slice(best), ...p.slice(0, best)]
    p.length = 0
    p.push(...rot, rot[0])
  }
  if (p.length < 2) return []
  const n = p.length - 1

  const lineFits = (i: number, j: number) => {
    for (let k = i + 1; k < j; k++) if (distToSegment(p[k], p[i], p[j]) > tol) return false
    return true
  }
  const arcFor = (i: number, j: number) => {
    if (j - i < 3) return null
    const m = (i + j) >> 1
    const ci = circleThrough(p[i], p[m], p[j])
    if (!ci || ci.r > 1e5) return null
    const ccw = cross(sub(p[m], p[i]), sub(p[j], p[m])) > 0
    let total = 0
    for (let k = i; k < j; k++) {
      if (Math.abs(dist(ci.c, p[k]) - ci.r) > tol) return null
      const mid = lerp(p[k], p[k + 1], 0.5)
      if (Math.abs(dist(ci.c, mid) - ci.r) > tol) return null
      let d = angleOf(ci.c, p[k + 1]) - angleOf(ci.c, p[k])
      while (d > Math.PI) d -= TAU
      while (d < -Math.PI) d += TAU
      if ((ccw && d < -1e-9) || (!ccw && d > 1e-9) || Math.abs(d) > Math.PI / 4) return null
      total += Math.abs(d)
    }
    if (total > Math.PI + 1e-6) return null
    return { c: ci.c, ccw }
  }
  const extend = (i: number, ok: (i: number, j: number) => boolean, min: number) => {
    if (i + min > n || !ok(i, i + min)) return -1
    let good = i + min
    let step = 1
    while (good + step <= n && ok(i, good + step)) {
      good += step
      step *= 2
    }
    let lo = good
    let hi = Math.min(n, good + step)
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (ok(i, mid)) lo = mid
      else hi = mid
    }
    return lo
  }

  const segs: Seg[] = []
  let i = 0
  while (i < n) {
    const jl = extend(i, lineFits, 1)
    const ja = extend(i, (a, b) => !!arcFor(a, b), 3)
    if (ja > jl && ja > 0) {
      const a = arcFor(i, ja)!
      segs.push(arc(p[i], p[ja], a.c, a.ccw))
      i = ja
    } else {
      segs.push(line(p[i], p[jl]))
      i = jl
    }
  }
  return cleanFit(mergeSegs(segs, tol), closed, tol)
}

const onCircle = (p: P, c: P, r: number, tol: number) => Math.abs(dist(p, c) - r) <= tol

/**
 * Post-fit cleanup: short lines lying on a neighbouring arc's circle become part of that arc,
 * arcs merge across the start of closed loops, and every junction moves to the exact tangent
 * or intersection point of its two neighbours.
 */
export function cleanFit(input: Seg[], closed: boolean, tol = TOL.fit): Seg[] {
  let segs = [...input]
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    if (s.k !== 'L' || dist(s.a, s.b) > 3) continue
    const nb = [segs[i - 1] ?? (closed ? segs[segs.length - 1] : undefined), segs[i + 1] ?? (closed ? segs[0] : undefined)]
    for (const o of nb) {
      if (!o || o.k !== 'A') continue
      const r = radius(o)
      if (onCircle(s.a, o.c, r, tol) && onCircle(s.b, o.c, r, tol) && onCircle(lerp(s.a, s.b, 0.5), o.c, r, tol)) {
        segs[i] = arc(s.a, s.b, o.c, o.ccw)
        break
      }
    }
  }
  segs = mergeSegs(segs, tol)
  if (closed && segs.length > 2) {
    const merged = mergeSegs([segs[segs.length - 1], segs[0]], tol)
    if (merged.length === 1) segs = [merged[0], ...segs.slice(1, -1)]
  }
  const n = segs.length
  const last = closed ? n : n - 1
  for (let i = 0; i < last; i++) {
    const s1 = segs[i]
    const s2 = segs[(i + 1) % n]
    const j = s1.b
    let q: P | null = null
    if (s1.k === 'L' && s2.k === 'L') {
      const hits = intersectCurves(curveOf(s1), curveOf(s2))
      if (hits.length && dist(hits[0], j) < 0.5) q = hits[0]
    } else {
      const lineSeg = s1.k === 'L' ? s1 : s2.k === 'L' ? s2 : null
      if (lineSeg) {
        const a = (s1.k === 'A' ? s1 : s2) as ArcSeg
        const r = radius(a)
        const d = unit(sub(lineSeg.b, lineSeg.a))
        const foot = add(lineSeg.a, mul(d, dot(sub(a.c, lineSeg.a), d)))
        if (Math.abs(dist(foot, a.c) - r) <= tol * 2 && dist(foot, j) < 3) q = foot
        else {
          const hits = intersectCurves(curveOf(lineSeg), { k: 'circle', c: a.c, r }).sort((x, y) => dist(x, j) - dist(y, j))
          if (hits.length && dist(hits[0], j) < 0.5) q = hits[0]
        }
      } else {
        const a1 = s1 as ArcSeg
        const a2 = s2 as ArcSeg
        const r1 = radius(a1)
        const r2 = radius(a2)
        const dc = dist(a1.c, a2.c)
        if (dc > 1e-9 && (Math.abs(dc - (r1 + r2)) <= tol * 2 || Math.abs(dc - Math.abs(r1 - r2)) <= tol * 2)) {
          const u = unit(sub(a2.c, a1.c))
          const cand = [add(a1.c, mul(u, r1)), add(a1.c, mul(u, -r1))].sort((x, y) => dist(x, j) - dist(y, j))
          if (dist(cand[0], j) < 3) q = cand[0]
        } else {
          const hits = intersectCurves({ k: 'circle', c: a1.c, r: r1 }, { k: 'circle', c: a2.c, r: r2 }).sort((x, y) => dist(x, j) - dist(y, j))
          if (hits.length && dist(hits[0], j) < 0.5) q = hits[0]
        }
      }
    }
    if (q) {
      segs[i] = { ...s1, b: q } as Seg
      segs[(i + 1) % n] = { ...segs[(i + 1) % n], a: q } as Seg
    }
  }
  return segs.filter((s) => segLength(s) > 1e-7)
}

/** Merge consecutive collinear lines and co-circular arcs. */
export function mergeSegs(segs: Seg[], tol = TOL.fit): Seg[] {
  const out: Seg[] = []
  for (const s of segs) {
    const last = out[out.length - 1]
    if (last && last.k === 'L' && s.k === 'L') {
      const merged = line(last.a, s.b)
      if (distToSegment(last.b, merged.a, merged.b) <= tol / 4 && dot(sub(last.b, last.a), sub(s.b, s.a)) > 0) {
        out[out.length - 1] = merged
        continue
      }
    }
    if (last && last.k === 'A' && s.k === 'A' && last.ccw === s.ccw && dist(last.c, s.c) <= tol && Math.abs(radius(last) - radius(s)) <= tol) {
      const merged = arc(last.a, s.b, last.c, last.ccw)
      if (Math.abs(sweep(merged)) <= Math.PI + 1e-6 && Math.abs(Math.abs(sweep(last)) + Math.abs(sweep(s)) - Math.abs(sweep(merged))) < 1e-6) {
        out[out.length - 1] = merged
        continue
      }
    }
    out.push(s)
  }
  return out
}

/** Split arcs larger than 180 degrees (some controllers only take minor arcs). */
export function splitMajorArcs(segs: Seg[]): Seg[] {
  const out: Seg[] = []
  for (const s of segs) {
    if (s.k === 'A' && Math.abs(sweep(s)) > Math.PI + 1e-9) out.push(...splitSeg(s, 0.5))
    else out.push(s)
  }
  return out
}

export interface CircleRef {
  c: P
  r: number
}
/** Snap fitted arcs onto known circles (exact centre and radius) so fits do not drift. */
export function snapArcs(segs: Seg[], refs: CircleRef[], tol = 0.02): Seg[] {
  if (!refs.length) return segs
  const out = segs.map((s) => ({ ...s })) as Seg[]
  for (let i = 0; i < out.length; i++) {
    const s = out[i]
    if (s.k !== 'A') continue
    const r = radius(s)
    const ref = refs.find((q) => dist(q.c, s.c) <= tol && Math.abs(q.r - r) <= tol)
    if (!ref) continue
    const a = add(ref.c, mul(unit(sub(s.a, ref.c)), ref.r))
    const b = add(ref.c, mul(unit(sub(s.b, ref.c)), ref.r))
    out[i] = arc(a, b, ref.c, s.ccw)
    const prev = out[(i - 1 + out.length) % out.length]
    const next = out[(i + 1) % out.length]
    if (prev !== out[i] && near(prev.b, s.a, tol * 2)) prev.b = a
    if (next !== out[i] && near(next.a, s.b, tol * 2)) next.a = b
  }
  return out
}

export function circleRefs(cs: Contour[]): CircleRef[] {
  const out: CircleRef[] = []
  for (const c of cs) for (const s of c.segs) if (s.k === 'A' && !out.some((q) => near(q.c, s.c, 1e-6) && Math.abs(q.r - radius(s)) < 1e-6)) out.push({ c: s.c, r: radius(s) })
  return out
}

// ---------------------------------------------------------------------------------------------
// Corner edits
// ---------------------------------------------------------------------------------------------

/** Corner index i sits between segs[i-1] and segs[i] (wrapping on closed contours). */
function cornerSegs(c: Contour, i: number) {
  const n = c.segs.length
  if (!c.closed && (i <= 0 || i >= n)) return null
  const i1 = (i - 1 + n) % n
  const i2 = i % n
  return { i1, i2, s1: c.segs[i1], s2: c.segs[i2] }
}

function offsetCurve(cv: Curve, s: Seg, side: 1 | -1, r: number): Curve {
  if (cv.k === 'line') return { k: 'line', p: add(cv.p, mul(left(cv.d), side * r)), d: cv.d }
  const towardCentre = (s as ArcSeg).ccw ? side === 1 : side === -1
  return { k: 'circle', c: cv.c, r: towardCentre ? cv.r - r : cv.r + r }
}
function footOn(cv: Curve, p: P): P {
  if (cv.k === 'line') return add(cv.p, mul(cv.d, dot(sub(p, cv.p), cv.d)))
  return add(cv.c, mul(unit(sub(p, cv.c)), cv.r))
}

function replaceCorner(c: Contour, i1: number, i2: number, s1: Seg, s2: Seg, mid: Seg[]): Contour {
  const segs = [...c.segs]
  if (i2 === 0 && c.closed) {
    segs[i1] = s1
    segs[0] = s2
    segs.splice(i1 + 1, 0, ...mid)
  } else {
    segs[i1] = s1
    segs[i2] = s2
    segs.splice(i2, 0, ...mid)
  }
  return { closed: c.closed, segs: segs.filter((s) => segLength(s) > 1e-9) }
}

/** Round a corner with radius r (works for any line/arc combination). */
export function filletCorner(c: Contour, i: number, r: number): Contour {
  const cs = cornerSegs(c, i)
  if (!cs || r <= 0) return c
  const { i1, i2, s1, s2 } = cs
  const turn = cross(tangentAt(s1, 1), tangentAt(s2, 0))
  if (Math.abs(turn) < 1e-9) return c
  const side: 1 | -1 = turn > 0 ? 1 : -1
  const c1 = curveOf(s1)
  const c2 = curveOf(s2)
  const P0 = s1.b
  const cands = intersectCurves(offsetCurve(c1, s1, side, r), offsetCurve(c2, s2, side, r))
  if (!cands.length) return c
  cands.sort((a, b) => dist(a, P0) - dist(b, P0))
  for (const C of cands) {
    const T1 = footOn(c1, C)
    const T2 = footOn(c2, C)
    const t1 = paramOn(s1, T1)
    const t2 = paramOn(s2, T2)
    if (t1 < -1e-7 || t1 > 1 + 1e-7 || t2 < -1e-7 || t2 > 1 + 1e-7) continue
    return replaceCorner(c, i1, i2, subSeg(s1, 0, t1), subSeg(s2, t2, 1), [arc(T1, T2, C, side === 1)])
  }
  return c
}

/** Chamfer a corner with setbacks d1 (along the incoming segment) and d2 (outgoing). */
export function chamferCorner(c: Contour, i: number, d1: number, d2 = d1): Contour {
  const cs = cornerSegs(c, i)
  if (!cs) return c
  const { i1, i2, s1, s2 } = cs
  const l1 = segLength(s1)
  const l2 = segLength(s2)
  if (d1 >= l1 || d2 >= l2) return c
  const t1 = 1 - d1 / l1
  const t2 = d2 / l2
  const a = subSeg(s1, 0, t1)
  const b = subSeg(s2, t2, 1)
  return replaceCorner(c, i1, i2, a, b, [line(a.b, b.a)])
}

export type ReliefStyle = 'tbone-in' | 'tbone-out' | 'dogbone'

/**
 * Corner relief for a router of radius r so a square mating part fits. The relief bulges away
 * from the side being cut away ("removed": the contour interior for pockets and cut-outs,
 * the exterior for outside profiles). Only corners the tool cannot reach are relieved.
 * tbone-in relieves along the incoming edge, tbone-out along the outgoing edge.
 */
export function reliefCorner(c: Contour, i: number, r: number, style: ReliefStyle, removed: 'interior' | 'exterior'): Contour {
  const cs = cornerSegs(c, i)
  if (!cs) return c
  const { i1, i2, s1, s2 } = cs
  const ccw = area(c) > 0
  const interiorLeft = ccw
  const removedLeft = removed === 'interior' ? interiorLeft : !interiorLeft
  const turn = cross(tangentAt(s1, 1), tangentAt(s2, 0))
  if ((removedLeft && turn <= 1e-9) || (!removedLeft && turn >= -1e-9)) return c
  const P0 = s1.b
  const d1 = tangentAt(s1, 1)
  const d2 = tangentAt(s2, 0)
  let C: P
  if (style === 'tbone-in') C = add(P0, mul(d1, -r))
  else if (style === 'tbone-out') C = add(P0, mul(d2, r))
  else {
    const bis = unit(sub(d2, d1))
    C = add(P0, mul(bis, r))
  }
  const circ: Curve = { k: 'circle', c: C, r }
  const pick = (s: Seg, atEnd: boolean) => {
    let best: { p: P; t: number } | null = null
    for (const p of intersectCurves(curveOf(s), circ)) {
      if (near(p, P0, 1e-6)) continue
      const t = paramOn(s, p)
      if (t < -1e-7 || t > 1 + 1e-7) continue
      if (!best || (atEnd ? t > best.t : t < best.t)) best = { p, t }
    }
    return best ?? { p: P0, t: atEnd ? 1 : 0 }
  }
  const A = pick(s1, true)
  const B = pick(s2, false)
  const outward = removedLeft ? right : left
  const n1 = outward(d1)
  const n2 = outward(d2)
  const via = add(C, mul(unit(add(n1, n2)), r))
  const relief: Seg[] = []
  const chord = (a: P, b: P) => {
    const ci = arc3(a, via, b)
    if (ci.k === 'A') relief.push(ci)
  }
  if (near(A.p, P0, 1e-6)) {
    chord(P0, B.p)
  } else if (near(B.p, P0, 1e-6)) {
    chord(A.p, P0)
  } else {
    chord(A.p, B.p)
  }
  return replaceCorner(c, i1, i2, subSeg(s1, 0, A.t), subSeg(s2, B.t, 1), splitMajorArcs(relief))
}

/** Indices of corners (not tangent joints) on a contour. */
export function corners(c: Contour, minTurnDeg = 1): number[] {
  const out: number[] = []
  const n = c.segs.length
  for (let i = c.closed ? 0 : 1; i < n; i++) {
    const s1 = c.segs[(i - 1 + n) % n]
    const s2 = c.segs[i % n]
    const t1 = tangentAt(s1, 1)
    const t2 = tangentAt(s2, 0)
    const ang = Math.abs(Math.atan2(cross(t1, t2), dot(t1, t2)))
    if (ang > (minTurnDeg * Math.PI) / 180) out.push(i)
  }
  return out
}

/** Apply a relief to every corner the tool cannot reach. Corners are processed from the end so indices stay valid. */
export function reliefAll(c: Contour, r: number, style: ReliefStyle, removed: 'interior' | 'exterior'): Contour {
  let out = c
  for (const i of corners(c).sort((a, b) => b - a)) out = reliefCorner(out, i, r, style, removed)
  return out
}

/** Contour as vertices plus bulges (node editing and DXF). */
export function toBulges(c: Contour): { pts: P[]; bulges: number[] } {
  const pts = c.segs.map((s) => s.a)
  const bulges = c.segs.map(bulgeOf)
  if (!c.closed && c.segs.length) {
    pts.push(endOf(c))
    bulges.push(0)
  }
  return { pts, bulges }
}
export function fromBulges(pts: P[], bulges: number[], closed: boolean): Contour {
  const segs: Seg[] = []
  const n = pts.length
  const last = closed ? n : n - 1
  for (let i = 0; i < last; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    if (near(a, b, 1e-9)) continue
    segs.push(bulgeSeg(a, b, bulges[i] ?? 0))
  }
  return { segs, closed }
}
