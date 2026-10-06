/**
 * Fold, flatten and wrap (NEW-07, M3.2).
 *
 * - Wrap: 2D shapes bent along a curve. A point's X becomes the distance along the curve (from a
 *   chosen start) and its Y the distance out from it, square to the curve; lengths along the
 *   baseline are kept exactly (the curve is walked by its own arc length, lines and arcs exact).
 * - Flatten: a developable surface (a cylinder, a cone, a ruled or swept sheet, a folded pattern)
 *   unrolled flat, every facet laid down with its edge lengths kept; how far the facets fail to
 *   meet tells whether the surface really is developable.
 * - Fold: a flat pattern folded along straight fold lines by set angles into a 3D surface (to see a
 *   folded part, or check a pattern); flattening it gives the pattern back.
 */
import { ShapeUtils, Vector2 } from 'three'
import { type Contour, fitPoints, type P, pointAt, segLength, tangentAt, toPoints } from './geom'
import { unionPolys } from './kernel'
import type { Mesh } from './mesh/types'

type V3 = [number, number, number]

// ---------------------------------------------------------------------------------------------
// Wrap
// ---------------------------------------------------------------------------------------------

export interface WrapOptions {
  /** Y of the shapes that lies on the curve (default: the lowest Y of the shapes). */
  baseline?: number
  /** X of the shapes that lands at the curve's start point (default: the lowest X of the shapes). */
  x0?: number
  /** Distance along the curve where `x0` lands, mm (default 0). */
  start?: number
  /** Shapes stand on the curve's left (default) or right, seen along it. */
  side?: 'left' | 'right'
  /** Chord tolerance of the result, mm (default 0.01). */
  tol?: number
}

/** A curve walked by arc length: the point and the left normal at any distance along it. */
export function curveWalker(curve: Contour) {
  const lens = curve.segs.map(segLength)
  const total = lens.reduce((a, b) => a + b, 0)
  const at = (s: number): { p: P; n: P } => {
    let d = curve.closed && total > 0 ? ((s % total) + total) % total : Math.max(0, Math.min(total, s))
    for (let i = 0; i < curve.segs.length; i++) {
      if (d <= lens[i] + 1e-12 || i === curve.segs.length - 1) {
        const t = lens[i] > 0 ? Math.max(0, Math.min(1, d / lens[i])) : 0
        const p = pointAt(curve.segs[i], t)
        const tg = tangentAt(curve.segs[i], t)
        return { p, n: { x: -tg.y, y: tg.x } }
      }
      d -= lens[i]
    }
    return { p: curve.segs[0].a, n: { x: 0, y: 1 } }
  }
  return { total, at }
}

/**
 * Shapes wrapped along a curve. Each comes back as polylines fitted with lines and arcs within the
 * tolerance (open shapes stay open; a closed shape stays closed). Points beyond the ends of an open
 * curve are carried on straight past the end, along its last direction.
 */
export function wrapOntoCurve(shapes: Contour[], curve: Contour, opt: WrapOptions = {}): { contours: Contour[]; length: number; warnings: string[] } {
  const warnings: string[] = []
  const tol = Math.max(0.0005, opt.tol ?? 0.01)
  const pts = shapes.flatMap((c) => toPoints(c, tol / 4))
  if (!pts.length || !curve.segs.length) return { contours: [], length: 0, warnings: ['Pick the shapes to wrap and a curve to wrap them along.'] }
  const x0 = opt.x0 ?? Math.min(...pts.map((p) => p.x))
  const base = opt.baseline ?? Math.min(...pts.map((p) => p.y))
  const sign = opt.side === 'right' ? -1 : 1
  const w = curveWalker(curve)
  const start = opt.start ?? 0
  const xMax = Math.max(...pts.map((p) => p.x))
  if (!curve.closed && start + (xMax - x0) > w.total + 1e-9) warnings.push(`The shapes are ${(xMax - x0).toFixed(1)} mm long but the curve has only ${(w.total - start).toFixed(1)} mm from the start: the rest runs on straight past its end.`)
  if (curve.closed && xMax - x0 > w.total + 1e-9) warnings.push(`The shapes are longer than the closed curve (${w.total.toFixed(1)} mm): they overlap themselves.`)
  const map = (p: P): P => {
    const s = start + (p.x - x0)
    const off = (p.y - base) * sign
    if (!curve.closed && (s < 0 || s > w.total)) {
      const end = w.at(s < 0 ? 0 : w.total)
      const t = { x: end.n.y, y: -end.n.x }
      const over = s < 0 ? s : s - w.total
      return { x: end.p.x + t.x * over + end.n.x * off, y: end.p.y + t.y * over + end.n.y * off }
    }
    const q = w.at(s)
    return { x: q.p.x + q.n.x * off, y: q.p.y + q.n.y * off }
  }
  // fine enough that the bend is followed within the tolerance (the tightest bend of the curve,
  // out at the shapes' furthest point from it)
  const radii = curve.segs.filter((s) => s.k === 'A').map((s) => Math.hypot(s.a.x - (s as { c: P }).c.x, s.a.y - (s as { c: P }).c.y))
  const reachOut = Math.max(...pts.map((p) => Math.abs(p.y - base)))
  const tight = radii.length ? Math.max(0.1, Math.min(...radii) - reachOut) : Infinity
  const step = Number.isFinite(tight) ? Math.max(0.01, Math.min(1, Math.sqrt(8 * (tol / 4) * tight))) : 1
  const contours: Contour[] = []
  for (const c of shapes) {
    const src = toPoints(c, tol / 4)
    if (src.length < 2) continue
    const ring = c.closed ? [...src, src[0]] : src
    const dense: P[] = [map(ring[0])]
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1]
      const b = ring[i]
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step))
      for (let k = 1; k <= n; k++) dense.push(map({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n }))
    }
    if (c.closed) dense.pop()
    contours.push({ segs: fitPoints(dense, c.closed, tol / 2), closed: c.closed })
  }
  return { contours, length: w.total, warnings }
}

// ---------------------------------------------------------------------------------------------
// Flatten
// ---------------------------------------------------------------------------------------------

export interface FlatPattern {
  /** The unrolled outline(s): closed loops in the plane (counter-clockwise; holes clockwise). */
  outline: P[][]
  /** Each facet laid flat: three 2D corners per facet, in the mesh's facet order. */
  facets: Float64Array
  /** Area of the surface and of the flat pattern, mm². */
  area3d: number
  area2d: number
  /**
   * How far the surface is from developable: at each inner corner, the facets round it laid flat
   * leave a wedge open (or overlap) by the corner's angle defect; `defect` is the largest, degrees,
   * and `gap` the widest such wedge across the corner's edges, mm. Both 0 for a developable surface.
   */
  defect: number
  gap: number
  /** Facets laid flat that overlap one another (the pattern runs over itself), mm². */
  overlap: number
  /** Largest change in an edge's length (mm). */
  stretch: number
  warnings: string[]
}

/**
 * Unroll a surface mesh: facets are laid flat one from the next across shared edges (breadth first
 * from the largest facet), each keeping its own edge lengths. A closed surface (a whole cylinder) is
 * cut open where the two ways round meet. The angles round each inner corner show whether the
 * surface is developable (`defect`, `gap`).
 */
export function flattenMesh(mesh: Pick<Mesh, 'positions' | 'indices'>): FlatPattern {
  const warnings: string[] = []
  const pos = mesh.positions
  const ix = mesh.indices
  const nt = ix.length / 3
  const v = (i: number): V3 => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]
  const len3 = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  // facets by shared edges
  const edgeKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`)
  const byEdge = new Map<string, number[]>()
  let area3d = 0
  let biggest = 0
  let biggestA = -1
  for (let t = 0; t < nt; t++) {
    const [a, b, c] = [ix[t * 3], ix[t * 3 + 1], ix[t * 3 + 2]]
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const k = edgeKey(p, q)
      const l = byEdge.get(k)
      if (l) l.push(t)
      else byEdge.set(k, [t])
    }
    const A = v(a)
    const B = v(b)
    const C = v(c)
    const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]]
    const ac = [C[0] - A[0], C[1] - A[1], C[2] - A[2]]
    const ar = Math.hypot(ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]) / 2
    area3d += ar
    if (ar > biggestA) {
      biggestA = ar
      biggest = t
    }
  }
  const facets = new Float64Array(nt * 6).fill(NaN)
  const put = (t: number, k: number, p: P) => {
    facets[t * 6 + k * 2] = p.x
    facets[t * 6 + k * 2 + 1] = p.y
  }
  // developable? at each inner corner (every edge round it shared by two facets) the facets' angles
  // add up to a full turn
  const angleSum = new Map<number, number>()
  const edgeSum = new Map<number, { l: number; n: number }>()
  for (let t = 0; t < nt; t++)
    for (let k = 0; k < 3; k++) {
      const i = ix[t * 3 + k]
      const P0 = v(i)
      const P1 = v(ix[t * 3 + ((k + 1) % 3)])
      const P2 = v(ix[t * 3 + ((k + 2) % 3)])
      const l1 = len3(P0, P1)
      const l2 = len3(P0, P2)
      if (!(l1 > 0 && l2 > 0)) continue
      const c = ((P1[0] - P0[0]) * (P2[0] - P0[0]) + (P1[1] - P0[1]) * (P2[1] - P0[1]) + (P1[2] - P0[2]) * (P2[2] - P0[2])) / (l1 * l2)
      angleSum.set(i, (angleSum.get(i) ?? 0) + Math.acos(Math.max(-1, Math.min(1, c))))
      const e = edgeSum.get(i) ?? { l: 0, n: 0 }
      e.l += l1 + l2
      e.n += 2
      edgeSum.set(i, e)
    }
  const rim = new Set<number>()
  for (const [k, l] of byEdge)
    if (l.length !== 2) for (const i of k.split('_')) rim.add(Number(i))
  let defect = 0
  let gap = 0
  for (const [i, sum] of angleSum) {
    if (rim.has(i)) continue
    const d = Math.abs(2 * Math.PI - sum)
    const e = edgeSum.get(i)!
    defect = Math.max(defect, d)
    gap = Math.max(gap, d * (e.l / e.n))
  }
  /** Third corner of a facet laid against the edge p -> q (2D), on the side away from `away`. */
  const third = (p: P, q: P, dp: number, dq: number, away: P | null, ccwWanted: boolean): P => {
    const L = Math.hypot(q.x - p.x, q.y - p.y)
    const a = (dp * dp - dq * dq + L * L) / (2 * L)
    const h = Math.sqrt(Math.max(0, dp * dp - a * a))
    const ux = (q.x - p.x) / L
    const uy = (q.y - p.y) / L
    const m = { x: p.x + ux * a, y: p.y + uy * a }
    const s1 = { x: m.x - uy * h, y: m.y + ux * h }
    const s2 = { x: m.x + uy * h, y: m.y - ux * h }
    if (away) {
      const side = (r: P) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
      return side(s1) * side(away) < 0 ? s1 : s2
    }
    return ccwWanted ? s1 : s2
  }
  const done = new Uint8Array(nt)
  let laidOut = 0
  const layFirst = (t: number) => {
    const [a, b, c] = [ix[t * 3], ix[t * 3 + 1], ix[t * 3 + 2]]
    const A = v(a)
    const B = v(b)
    const C = v(c)
    const pa = { x: 0, y: 0 }
    const pb = { x: len3(A, B), y: 0 }
    put(t, 0, pa)
    put(t, 1, pb)
    put(t, 2, third(pa, pb, len3(A, C), len3(B, C), null, true))
    done[t] = 1
    laidOut++
  }
  // breadth first over shared edges, from the biggest facet (then any facet not reached: islands)
  const queue: number[] = []
  const start = (t: number) => {
    layFirst(t)
    queue.push(t)
  }
  if (nt) start(biggest)
  let island = 0
  for (;;) {
    while (queue.length) {
      const t = queue.shift()!
      for (let e = 0; e < 3; e++) {
        const i = ix[t * 3 + e]
        const j = ix[t * 3 + ((e + 1) % 3)]
        for (const u of byEdge.get(edgeKey(i, j)) ?? []) {
          if (done[u]) continue
          // u's corners: the shared two as t laid them, its third against them
          const pi = { x: facets[t * 6 + e * 2], y: facets[t * 6 + e * 2 + 1] }
          const pj = { x: facets[t * 6 + ((e + 1) % 3) * 2], y: facets[t * 6 + ((e + 1) % 3) * 2 + 1] }
          const k3 = (e + 2) % 3
          const away = { x: facets[t * 6 + k3 * 2], y: facets[t * 6 + k3 * 2 + 1] }
          const corners = [ix[u * 3], ix[u * 3 + 1], ix[u * 3 + 2]]
          const ki = corners.indexOf(i)
          const kj = corners.indexOf(j)
          const ko = 3 - ki - kj
          const W = v(corners[ko])
          put(u, ki, pi)
          put(u, kj, pj)
          put(u, ko, third(pi, pj, len3(v(i), W), len3(v(j), W), away, true))
          done[u] = 1
          laidOut++
          queue.push(u)
        }
      }
    }
    if (laidOut >= nt) break
    // another piece of the surface (not joined by an edge): laid beside the last
    let next = -1
    for (let t = 0; t < nt; t++)
      if (!done[t]) {
        next = t
        break
      }
    if (next < 0) break
    island++
    start(next)
  }
  if (island) warnings.push(`${island + 1} separate pieces: each was flattened on its own (they may overlap in the pattern).`)
  // edges kept? (laid facets keep theirs by construction; check every edge anyway)
  let stretch = 0
  let area2d = 0
  const tris: P[][] = []
  for (let t = 0; t < nt; t++) {
    const q = [0, 1, 2].map((k) => ({ x: facets[t * 6 + k * 2], y: facets[t * 6 + k * 2 + 1] }))
    for (let k = 0; k < 3; k++) {
      const l2 = Math.hypot(q[k].x - q[(k + 1) % 3].x, q[k].y - q[(k + 1) % 3].y)
      stretch = Math.max(stretch, Math.abs(l2 - len3(v(ix[t * 3 + k]), v(ix[t * 3 + ((k + 1) % 3)]))))
    }
    const sa = ((q[1].x - q[0].x) * (q[2].y - q[0].y) - (q[2].x - q[0].x) * (q[1].y - q[0].y)) / 2
    area2d += Math.abs(sa)
    tris.push(sa >= 0 ? q : [q[0], q[2], q[1]])
  }
  if (gap > 0.01) warnings.push(`The surface is not developable: round some corners the facets laid flat leave gaps of up to ${gap.toFixed(3)} mm (${((defect * 180) / Math.PI).toFixed(2)}°), so the pattern is only approximate.`)
  // the outline: all facets together (they only touch along edges unless the pattern runs over itself)
  const outline = unionPolys(tris, 0.0005)
  const flatArea = outline.reduce((s, r) => s + ringArea(r), 0)
  const overlap = Math.max(0, area2d - flatArea)
  if (overlap > Math.max(0.01, area2d * 1e-6)) warnings.push(`The pattern runs over itself (${overlap.toFixed(1)} mm² laid twice): cut the surface into pieces to flatten it.`)
  return { outline, facets, area3d, area2d, defect: (defect * 180) / Math.PI, gap, overlap, stretch, warnings }
}

// ---------------------------------------------------------------------------------------------
// Fold
// ---------------------------------------------------------------------------------------------

export interface FoldLine {
  a: P
  b: P
  /** Fold angle, degrees: positive folds the far side up (towards +Z), negative down. */
  angle: number
}

/**
 * A flat pattern (one closed outline in the plane, holes allowed) folded along straight fold lines.
 * Each fold line splits the piece it runs across (the piece holding its middle) in two along the
 * line. The piece holding `fixed` (default: the outline's first point's piece) stays flat; every
 * other piece turns about the folds on the way to it from the fixed piece, the nearest first.
 * Returns the folded surface (each piece triangulated, joined along the folds) and the pieces in
 * the plane.
 */
export function foldPattern(outline: P[][], folds: FoldLine[], fixed?: P): { mesh: Mesh; pieces: P[][][]; warnings: string[] } {
  const warnings: string[] = []
  const insidePiece = (pc: P[][], q: P) => pc.reduce((inside, ring) => inside !== pointInRing(q, ring), false)
  const mid = (f: FoldLine): P => ({ x: (f.a.x + f.b.x) / 2, y: (f.a.y + f.b.y) / 2 })
  // a point just off the middle of a fold, on its left (+1) or right (-1)
  const off = (f: FoldLine, s: number): P => {
    const L = Math.hypot(f.b.x - f.a.x, f.b.y - f.a.y) || 1
    const m = mid(f)
    const e = 0.001 * s
    return { x: m.x - ((f.b.y - f.a.y) / L) * e, y: m.y + ((f.b.x - f.a.x) / L) * e }
  }
  let pieces: P[][][] = [outline]
  const used: FoldLine[] = []
  folds.forEach((f, n) => {
    if (Math.hypot(f.b.x - f.a.x, f.b.y - f.a.y) < 1e-6) return
    const i = pieces.findIndex((pc) => insidePiece(pc, mid(f)))
    if (i < 0) {
      warnings.push(`Fold line ${n + 1} does not run across the pattern: left out.`)
      return
    }
    const [l, r] = splitByLine(pieces[i], f.a, f.b)
    if (!l.length || !r.length) {
      warnings.push(`Fold line ${n + 1} does not split the pattern: left out.`)
      return
    }
    pieces.splice(i, 1, l, r)
    used.push(f)
  })
  const pieceAt = (q: P) => pieces.findIndex((pc) => insidePiece(pc, q))
  const fixAt = fixed ?? outline[0][0]
  let root = pieceAt(fixAt)
  if (root < 0) {
    // the fixed point on an edge: the piece with a corner nearest it
    let best = Infinity
    pieces.forEach((pc, i) => {
      for (const p of pc[0]) {
        const d = Math.hypot(p.x - fixAt.x, p.y - fixAt.y)
        if (d < best) {
          best = d
          root = i
        }
      }
    })
  }
  // the folds join the pieces on either side of their middles; walk out from the fixed piece
  const joins = used.map((f) => ({ f, l: pieceAt(off(f, 1)), r: pieceAt(off(f, -1)) }))
  const T: (M4 | undefined)[] = pieces.map(() => undefined)
  T[root] = identity()
  const queue = [root]
  while (queue.length) {
    const i = queue.shift()!
    for (const { f, l, r } of joins) {
      const j = l === i ? r : r === i ? l : -1
      if (j < 0 || T[j]) continue
      // the far piece turns about the fold as the folds nearer the fixed piece have moved it; a
      // positive angle lifts it, whichever side of the line it is on
      const axis = foldAxis(f, T[i]!)
      const sgn = j === l ? 1 : -1
      T[j] = mul4(rotateAboutAxis(axis.p, axis.d, ((f.angle * Math.PI) / 180) * sgn), T[i]!)
      queue.push(j)
    }
  }
  if (T.some((t) => !t)) warnings.push('Some pieces are not joined to the fixed piece by a fold: they stay flat.')
  // one mesh, joined where the pattern is (corners at one point of the pattern, within 0.001 mm, are
  // one corner), so the pieces stay joined along their folds; sides that only touch once folded
  // (the corners of a box) are not joined, so the surface flattens back to the same pattern
  const positions: number[] = []
  const indices: number[] = []
  const at = new Map<string, number>()
  pieces.forEach((pc, i) => {
    const m = T[i] ?? identity()
    for (const p2 of triangulate(pc)) {
      const p = apply(m, [p2.x, p2.y, 0])
      const key = `${Math.round(p2.x * 1000)},${Math.round(p2.y * 1000)}`
      let k = at.get(key)
      if (k === undefined) {
        k = positions.length / 3
        at.set(key, k)
        positions.push(...p)
      }
      indices.push(k)
    }
  })
  return { mesh: { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }, pieces, warnings }
}

function pointInRing(p: P, ring: P[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** The rings of a piece split by the infinite line through a, b: the left part and the right. */
function splitByLine(pc: P[][], a: P, b: P): [P[][], P[][]] {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const L = Math.hypot(dx, dy) || 1
  const big = 1e6
  const ux = dx / L
  const uy = dy / L
  const left = [
    { x: a.x - ux * big, y: a.y - uy * big },
    { x: a.x + ux * big, y: a.y + uy * big },
    { x: a.x + ux * big - uy * big, y: a.y + uy * big + ux * big },
    { x: a.x - ux * big - uy * big, y: a.y - uy * big + ux * big },
  ]
  const right = [
    { x: a.x - ux * big, y: a.y - uy * big },
    { x: a.x - ux * big + uy * big, y: a.y - uy * big - ux * big },
    { x: a.x + ux * big + uy * big, y: a.y + uy * big - ux * big },
    { x: a.x + ux * big, y: a.y + uy * big },
  ]
  return [clipRings(pc, left), clipRings(pc, right)]
}

/** A piece (outer ring, holes) clipped to a convex polygon, exactly (Sutherland-Hodgman per ring). */
function clipRings(pc: P[][], convex: P[]): P[][] {
  const out: P[][] = []
  for (const ring of pc) {
    let poly = ring
    for (let i = 0; i < convex.length && poly.length; i++) {
      const A = convex[i]
      const B = convex[(i + 1) % convex.length]
      const inside = (p: P) => (B.x - A.x) * (p.y - A.y) - (B.y - A.y) * (p.x - A.x) >= -1e-9
      const cut = (p: P, q: P): P => {
        const d1 = (B.x - A.x) * (p.y - A.y) - (B.y - A.y) * (p.x - A.x)
        const d2 = (B.x - A.x) * (q.y - A.y) - (B.y - A.y) * (q.x - A.x)
        const t = d1 / (d1 - d2)
        return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }
      }
      const next: P[] = []
      for (let k = 0; k < poly.length; k++) {
        const p = poly[k]
        const q = poly[(k + 1) % poly.length]
        const pin = inside(p)
        const qin = inside(q)
        if (pin) next.push(p)
        if (pin !== qin) next.push(cut(p, q))
      }
      poly = next
    }
    if (poly.length >= 3) out.push(poly)
  }
  // (a hole cut away from its outer ring is simply dropped with it)
  return out.length && ringArea(out[0]) !== 0 ? out : []
}

const ringArea = (r: P[]) => r.reduce((s, p, i) => s + p.x * r[(i + 1) % r.length].y - r[(i + 1) % r.length].x * p.y, 0) / 2

function triangulate(pc: P[][]): P[] {
  const outer = ringArea(pc[0]) >= 0 ? pc[0] : [...pc[0]].reverse()
  const holes = pc.slice(1).map((h) => (ringArea(h) <= 0 ? h : [...h].reverse()))
  const contour = outer.map((p) => new Vector2(p.x, p.y))
  const hs = holes.map((h) => h.map((p) => new Vector2(p.x, p.y)))
  const all = [...outer, ...holes.flat()]
  return ShapeUtils.triangulateShape(contour, hs).flatMap((t) => t.map((i) => all[i]))
}

type M4 = number[]
const identity = (): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
function mul4(a: M4, b: M4): M4 {
  const o = new Array(16).fill(0)
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c]
  return o
}
const apply = (m: M4, p: V3): V3 => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]]

/** Rotation by `a` about the axis through p along unit d (right-hand rule). */
function rotateAboutAxis(p: V3, d: V3, a: number): M4 {
  const [x, y, z] = d
  const c = Math.cos(a)
  const s = Math.sin(a)
  const t = 1 - c
  const R = [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c]
  const tx = p[0] - (R[0] * p[0] + R[1] * p[1] + R[2] * p[2])
  const ty = p[1] - (R[3] * p[0] + R[4] * p[1] + R[5] * p[2])
  const tz = p[2] - (R[6] * p[0] + R[7] * p[1] + R[8] * p[2])
  return [R[0], R[1], R[2], tx, R[3], R[4], R[5], ty, R[6], R[7], R[8], tz, 0, 0, 0, 1]
}

/** The fold's axis after the folds nearer the fixed piece have moved it (`T`). */
function foldAxis(f: FoldLine, T: M4): { p: V3; d: V3 } {
  const p = apply(T, [f.a.x, f.a.y, 0])
  const q = apply(T, [f.b.x, f.b.y, 0])
  const L = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) || 1
  return { p, d: [(q[0] - p[0]) / L, (q[1] - p[1]) / L, (q[2] - p[2]) / L] }
}

/** Outline of a flat pattern as contours fitted with lines and arcs. */
export function outlineContours(outline: P[][], tol = 0.01): Contour[] {
  return outline.map((r) => ({ segs: fitPoints(r, true, tol), closed: true }))
}

