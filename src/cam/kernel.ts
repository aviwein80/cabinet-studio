/**
 * Offsets and area booleans on Clipper2 (clipper2-ts, BSL-1.0). Contours are tessellated finely,
 * clipped in integer space, then fitted back into lines and arcs and snapped onto the exact
 * source circles (and their offsets) so radii survive the round trip.
 */
import { area as clipArea, areaPaths, booleanOp, ClipType, EndType, FillRule, inflatePaths, intersect, JoinType, union, type Path64, type Paths64 } from 'clipper2-ts'
import {
  add,
  arc,
  area,
  circleRefs,
  cleanFit,
  closestOnSeg,
  type CircleRef,
  type Contour,
  cross,
  dist,
  endOf,
  fitPoints,
  intersectCurves,
  curveOf,
  intersectSegs,
  left,
  line,
  mergeSegs,
  mul,
  near,
  type P,
  reverse,
  type Seg,
  segLength,
  snapArcs,
  startOf,
  subSeg,
  sub,
  tangentAt,
  toPoints,
  TOL,
  unit,
  radius,
  paramOn,
} from './geom'

const SCALE = 1e4

const polyPath = (poly: P[]): Path64 => poly.map((p) => ({ x: Math.round(p.x * SCALE), y: Math.round(p.y * SCALE) }))
const pathPoly = (path: Path64): P[] => path.map((q) => ({ x: q.x / SCALE, y: q.y / SCALE }))
const toPath = (c: Contour): Path64 => polyPath(toPoints(c, TOL.chord))
const toPaths = (cs: Contour[]): Paths64 => cs.filter((c) => c.closed && c.segs.length).map(toPath)
function fromPaths(paths: Paths64, refs: CircleRef[]): Contour[] {
  const out: Contour[] = []
  for (const path of paths) {
    const pts = pathPoly(path)
    if (pts.length < 3) continue
    let segs = fitPoints(pts, true, TOL.fit)
    segs = cleanFit(snapArcs(segs, refs, Math.max(TOL.fit * 4, 0.02)), true)
    if (segs.length) out.push({ segs: mergeSegs(segs), closed: true })
  }
  return out
}

export type Join = 'round' | 'miter' | 'square'
const JOIN: Record<Join, JoinType> = { round: JoinType.Round, miter: JoinType.Miter, square: JoinType.Square }

/**
 * Offset closed contours by d (positive grows the filled area). Holes are contours of opposite
 * winding inside an outer contour; even-odd nesting is respected.
 */
export function offset(cs: Contour[], d: number, join: Join = 'round'): Contour[] {
  const closed = cs.filter((c) => c.closed)
  if (!closed.length) return []
  const norm = normaliseWinding(closed)
  const sol = inflatePaths(toPaths(norm), d * SCALE, JOIN[join], EndType.Polygon, 4, TOL.chord * SCALE)
  const refs = circleRefs(closed).flatMap((r) => [r, { c: r.c, r: r.r + Math.abs(d) }, { c: r.c, r: Math.max(1e-6, r.r - Math.abs(d)) }])
  const cornerRefs: CircleRef[] = []
  if (join === 'round') for (const c of closed) for (const s of c.segs) cornerRefs.push({ c: s.a, r: Math.abs(d) })
  return fromPaths(sol, [...refs, ...cornerRefs])
}

/** Give outer loops CCW and holes CW winding based on containment depth. */
export function normaliseWinding(cs: Contour[]): Contour[] {
  return cs.map((c, i) => {
    const probe = toPoints(c, 0.05)[0]
    let depth = 0
    cs.forEach((o, j) => {
      if (j !== i && Math.abs(area(o)) > Math.abs(area(c)) && containsPoint(o, probe)) depth++
    })
    const wantCcw = depth % 2 === 0
    return area(c) > 0 === wantCcw ? c : reverse(c)
  })
}

function containsPoint(c: Contour, p: P) {
  const pts = toPoints(c, 0.05)
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]
    const b = pts[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export type BoolOp = 'unite' | 'subtract' | 'intersect' | 'xor'
const CLIP: Record<BoolOp, ClipType> = { unite: ClipType.Union, subtract: ClipType.Difference, intersect: ClipType.Intersection, xor: ClipType.Xor }

export function boolean(op: BoolOp, a: Contour[], b: Contour[]): Contour[] {
  const refs = circleRefs([...a, ...b])
  const res = booleanOp(CLIP[op], toPaths(normaliseWinding(a)), toPaths(normaliseWinding(b)), FillRule.EvenOdd)
  return fromPaths(res, refs)
}

/** Areas a and b both cover, or nothing. */
export function overlapArea(a: Contour[], b: Contour[]) {
  const res = booleanOp(ClipType.Intersection, toPaths(a), toPaths(b), FillRule.NonZero)
  return Math.abs(areaPaths(res)) / (SCALE * SCALE)
}

/** Polygon-level union (fast, no refit). Used by nesting and simulation. */
export function unionPolys(polys: P[][]): P[][] {
  return union(polys.map(polyPath), FillRule.NonZero).map(pathPoly)
}
export function inflatePolys(polys: P[][], d: number, join: Join = 'round', arcTol = 0.05): P[][] {
  return inflatePaths(polys.map(polyPath), d * SCALE, JOIN[join], EndType.Polygon, 4, arcTol * SCALE).map(pathPoly)
}
export function polyOverlap(a: P[][], b: P[][]) {
  return Math.abs(areaPaths(intersect(a.map(polyPath), b.map(polyPath), FillRule.NonZero))) / (SCALE * SCALE)
}
export function polyArea(poly: P[]) {
  return clipArea(polyPath(poly)) / (SCALE * SCALE)
}

// ---------------------------------------------------------------------------------------------
// Open-contour offset (one side, exact lines and arcs, round joins at convex corners)
// ---------------------------------------------------------------------------------------------

function offsetSeg(s: Seg, d: number): Seg | null {
  if (s.k === 'L') {
    const n = mul(left(unit(sub(s.b, s.a))), d)
    return line(add(s.a, n), add(s.b, n))
  }
  const r = radius(s)
  const nr = s.ccw ? r - d : r + d
  if (nr <= 1e-9) return null
  return arc(add(s.c, mul(unit(sub(s.a, s.c)), nr)), add(s.c, mul(unit(sub(s.b, s.c)), nr)), s.c, s.ccw)
}

/** Offset an open or closed chain by d to the left (negative = right) without Clipper. */
export function offsetChain(c: Contour, d: number): Contour {
  const raw = c.segs.map((s) => offsetSeg(s, d)).filter((s): s is Seg => !!s)
  if (!raw.length) return { segs: [], closed: c.closed }
  const out: Seg[] = []
  const n = raw.length
  for (let i = 0; i < n; i++) {
    let s = raw[i]
    if (out.length) {
      const prev = out[out.length - 1]
      if (!near(prev.b, s.a, 1e-7)) {
        const turn = cross(tangentAt(prev, 1), tangentAt(s, 0))
        const convex = d > 0 ? turn < 0 : turn > 0
        if (convex) {
          const corner = c.segs[i].a
          out.push(arc(prev.b, s.a, corner, d < 0))
        } else {
          const hits = intersectCurves(curveOf(prev), curveOf(s))
          if (hits.length) {
            hits.sort((a, b) => dist(a, prev.b) - dist(b, prev.b))
            const h = hits[0]
            out[out.length - 1] = subSeg(prev, 0, Math.max(0, Math.min(1, paramOn(prev, h))))
            s = subSeg(s, Math.max(0, Math.min(1, paramOn(s, h))), 1)
          } else out.push(line(prev.b, s.a))
        }
      }
    }
    out.push(s)
  }
  return { segs: out.filter((s) => segLength(s) > 1e-7), closed: c.closed }
}

// ---------------------------------------------------------------------------------------------
// CAD edits on contours
// ---------------------------------------------------------------------------------------------

/**
 * Chain open contours whose ends meet within tol; chains that close become closed contours.
 * `accept(before, after)` can refuse a joint (e.g. only join where the path stays tangent).
 */
export function joinContours(cs: Contour[], tol = TOL.join, accept?: (before: Seg, after: Seg) => boolean): Contour[] {
  const closed = cs.filter((c) => c.closed)
  const pool = cs.filter((c) => !c.closed && c.segs.length).map((c) => ({ segs: [...c.segs], closed: false }))
  const out: Contour[] = [...closed]
  while (pool.length) {
    const cur = pool.shift()!
    let grew = true
    while (grew) {
      grew = false
      for (let i = 0; i < pool.length; i++) {
        const o = pool[i]
        const e = endOf(cur)
        const s = startOf(cur)
        let add: Seg[] | null = null
        let atEnd = true
        if (near(e, startOf(o), tol)) add = o.segs
        else if (near(e, endOf(o), tol)) add = reverse(o).segs
        else if (near(s, endOf(o), tol)) {
          add = o.segs
          atEnd = false
        } else if (near(s, startOf(o), tol)) {
          add = reverse(o).segs
          atEnd = false
        }
        if (!add) continue
        if (accept && !(atEnd ? accept(cur.segs[cur.segs.length - 1], add[0]) : accept(add[add.length - 1], cur.segs[0]))) continue
        if (atEnd) {
          const a = { ...add[0], a: endOf(cur) } as Seg
          cur.segs.push(a, ...add.slice(1))
        } else {
          const last = { ...add[add.length - 1], b: startOf(cur) } as Seg
          cur.segs.unshift(...add.slice(0, -1), last)
        }
        pool.splice(i, 1)
        grew = true
        break
      }
    }
    if (cur.segs.length > 1 && near(startOf(cur), endOf(cur), tol) && (!accept || accept(cur.segs[cur.segs.length - 1], cur.segs[0]))) {
      const last = cur.segs[cur.segs.length - 1]
      cur.segs[cur.segs.length - 1] = { ...last, b: startOf(cur) } as Seg
      cur.closed = true
    }
    out.push(cur)
  }
  return out
}

/** Close open contours whose ends are within `gap` with a straight segment. */
export function autoClose(cs: Contour[], gap: number): Contour[] {
  return cs.map((c) => {
    if (c.closed || c.segs.length < 2) return c
    const s = startOf(c)
    const e = endOf(c)
    if (dist(s, e) > gap) return c
    const segs = [...c.segs]
    if (dist(s, e) > 1e-9) segs.push(line(e, s))
    return { segs, closed: true }
  })
}

export function explode(c: Contour): Contour[] {
  return c.segs.map((s) => ({ segs: [s], closed: false }))
}

/** Break a contour at the point nearest p. Closed contours open there; open ones split in two. */
export function breakAt(c: Contour, p: P): Contour[] {
  let best = { i: 0, t: 0, d: Infinity }
  c.segs.forEach((s, i) => {
    const q = closestOnSeg(s, p)
    if (q.d < best.d) best = { i, t: q.t, d: q.d }
  })
  const s = c.segs[best.i]
  const first = c.segs.slice(0, best.i)
  const rest = c.segs.slice(best.i + 1)
  const a = best.t > 1e-9 ? [subSeg(s, 0, best.t)] : []
  const b = best.t < 1 - 1e-9 ? [subSeg(s, best.t, 1)] : []
  if (c.closed) return [{ segs: [...b, ...rest, ...first, ...a], closed: false }]
  return [
    { segs: [...first, ...a], closed: false },
    { segs: [...b, ...rest], closed: false },
  ].filter((q) => q.segs.length)
}

/** Break a contour into two at arc length d from its start. */
export function breakAtDistance(c: Contour, d: number, fromEnd = false): Contour[] {
  const cc = fromEnd ? reverse(c) : c
  let acc = 0
  for (let i = 0; i < cc.segs.length; i++) {
    const l = segLength(cc.segs[i])
    if (acc + l >= d) {
      const t = (d - acc) / l
      const parts = breakAt(cc, subSeg(cc.segs[i], 0, Math.max(1e-9, t)).b)
      return fromEnd ? parts.map(reverse).reverse() : parts
    }
    acc += l
  }
  return [c]
}

/** All intersection parameters (as arc-length positions) of contour c with the cutters. */
function cutPositions(c: Contour, cutters: Contour[]) {
  const pos: number[] = []
  let acc = 0
  for (const s of c.segs) {
    const l = segLength(s)
    for (const k of cutters) for (const ks of k.segs) for (const h of intersectSegs(s, ks)) pos.push(acc + h.t1 * l)
    acc += l
  }
  return { pos: [...new Set(pos.map((p) => Math.round(p * 1e6) / 1e6))].sort((a, b) => a - b), total: acc }
}

function sliceByLength(c: Contour, d0: number, d1: number): Contour {
  const segs: Seg[] = []
  let acc = 0
  for (const s of c.segs) {
    const l = segLength(s)
    const a = Math.max(d0, acc)
    const b = Math.min(d1, acc + l)
    if (b > a + 1e-9 && l > 1e-12) segs.push(subSeg(s, (a - acc) / l, (b - acc) / l))
    acc += l
  }
  return { segs, closed: false }
}

/** Trim: remove the piece of c (between cutter intersections) nearest the pick point. */
export function trim(c: Contour, cutters: Contour[], pick: P): Contour[] {
  const { pos, total } = cutPositions(c, cutters)
  if (!pos.length) return [c]
  let pickPos = 0
  let best = Infinity
  let acc = 0
  for (const s of c.segs) {
    const q = closestOnSeg(s, pick)
    if (q.d < best) {
      best = q.d
      pickPos = acc + q.t * segLength(s)
    }
    acc += segLength(s)
  }
  if (c.closed) {
    if (pos.length < 2) return [c]
    let i = pos.findIndex((p) => p > pickPos)
    if (i < 0) i = 0
    const hi = pos[i]
    const lo = pos[(i - 1 + pos.length) % pos.length]
    const keepFrom = hi
    const keepTo = lo < hi ? lo + total : lo
    const doubled: Contour = { segs: [...c.segs, ...c.segs], closed: false }
    return [sliceByLength(doubled, keepFrom, keepTo)]
  }
  const lo = [...pos].reverse().find((p) => p < pickPos) ?? 0
  const hi = pos.find((p) => p > pickPos) ?? total
  return [sliceByLength(c, 0, lo), sliceByLength(c, hi, total)].filter((q) => q.segs.length)
}

/** Extend the nearer end of an open contour until it meets a boundary (lines along their direction, arcs around their circle). */
export function extendTo(c: Contour, boundaries: Contour[], pick: P): Contour {
  if (c.closed) return c
  const atEnd = dist(pick, endOf(c)) <= dist(pick, startOf(c))
  const cc = atEnd ? c : reverse(c)
  const last = cc.segs[cc.segs.length - 1]
  const from = last.b
  let best: P | null = null
  let bestD = Infinity
  for (const b of boundaries)
    for (const bs of b.segs)
      for (const h of intersectCurves(curveOf(last), curveOf(bs))) {
        const tb = paramOn(bs, h)
        if (tb < -1e-7 || tb > 1 + 1e-7) continue
        const t = paramOn(last, h)
        if (last.k === 'L' ? t <= 1 + 1e-9 : false) continue
        const d = dist(from, h)
        if (d < bestD && d > 1e-7) {
          bestD = d
          best = h
        }
      }
  if (!best) return c
  const ext: Seg = last.k === 'L' ? line(last.a, best) : arc(last.a, best, last.c, last.ccw)
  const segs = [...cc.segs.slice(0, -1), ext]
  const out = { segs, closed: false }
  return atEnd ? out : reverse(out)
}

/** Drop exact duplicate segments across contours (common-line removal). */
export function removeDuplicateSegs(cs: Contour[], tol = TOL.join): Contour[] {
  const seen: Seg[] = []
  const same = (a: Seg, b: Seg) =>
    a.k === b.k && ((near(a.a, b.a, tol) && near(a.b, b.b, tol)) || (near(a.a, b.b, tol) && near(a.b, b.a, tol))) && (a.k === 'L' || near((a as { c: P }).c, (b as { c: P }).c, tol))
  const out: Contour[] = []
  for (const c of cs) {
    if (c.closed) {
      out.push(c)
      c.segs.forEach((s) => seen.push(s))
      continue
    }
    const keep = c.segs.filter((s) => {
      if (seen.some((o) => same(o, s))) return false
      seen.push(s)
      return true
    })
    if (keep.length) out.push({ segs: keep, closed: false })
  }
  return out
}

/** Re-fit a contour through its own points: collapses many tiny lines into lines and arcs. */
export function simplify(c: Contour, tol = TOL.fit): Contour {
  const pts = toPoints(c, Math.min(TOL.chord, tol / 4))
  const segs = fitPoints(c.closed ? pts : pts, c.closed, tol)
  if (!c.closed && segs.length) {
    segs[0] = { ...segs[0], a: startOf(c) } as Seg
    segs[segs.length - 1] = { ...segs[segs.length - 1], b: endOf(c) } as Seg
  }
  return { segs: cleanFit(snapArcs(segs, circleRefs([c])), c.closed), closed: c.closed }
}
