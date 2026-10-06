/**
 * Surfaces made and edited in the app (NEW-19), as meshes the 3D strategies machine: revolve,
 * ruled between two curves, loft through sections, sweep a section along a path, extrude, flat
 * (a closed shape filled), fillet between two flat faces, split by a plane, extend open edges,
 * untrim a solid's face (its whole underlying surface). Curves come in as point lists in part
 * coordinates (mm); round shapes are divided so the facets stay within `tol` of the true surface.
 */
import { ShapeUtils, Vector2 } from 'three'
import type { Mesh } from './types'

export type V3 = [number, number, number]

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = (a: V3) => Math.hypot(a[0], a[1], a[2])
const unit = (a: V3): V3 => {
  const l = len(a)
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]
}

/** Divisions of an arc of radius r and sweep `angle` (radians) keeping the chord within tol. */
export function segmentsFor(r: number, angle: number, tol = 0.01): number {
  if (r <= tol) return Math.max(1, Math.ceil(Math.abs(angle) / (Math.PI / 2)))
  const step = 2 * Math.acos(Math.max(-1, 1 - tol / r))
  return Math.max(1, Math.ceil(Math.abs(angle) / step))
}

/**
 * Quads between rows of points (each row the same length) as triangles. The mesh keeps its layout
 * (`grid`): its points are the rows' points in order, so passes can follow rows and columns.
 */
export function gridMesh(rows: V3[][], closeRows = false, closeCols = false): Mesh {
  const nr = rows.length
  const nc = rows[0]?.length ?? 0
  const positions = new Float32Array(nr * nc * 3)
  rows.forEach((row, i) => row.forEach((p, j) => positions.set(p, (i * nc + j) * 3)))
  const idx: number[] = []
  const R = closeRows ? nr : nr - 1
  const C = closeCols ? nc : nc - 1
  for (let i = 0; i < R; i++)
    for (let j = 0; j < C; j++) {
      const a = i * nc + j
      const b = i * nc + ((j + 1) % nc)
      const c = ((i + 1) % nr) * nc + j
      const d = ((i + 1) % nr) * nc + ((j + 1) % nc)
      idx.push(a, b, d, a, d, c)
    }
  return { ...dropDegenerate({ positions, indices: Uint32Array.from(idx) }), grid: { rows: nr, cols: nc, closedRows: closeRows, closedCols: closeCols } }
}

/** Remove zero-area triangles (an axis point repeated in a revolve, for example). */
function dropDegenerate(m: Mesh): Mesh {
  const p = m.positions
  const keep: number[] = []
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]]
    const A: V3 = [p[a * 3], p[a * 3 + 1], p[a * 3 + 2]]
    const B: V3 = [p[b * 3], p[b * 3 + 1], p[b * 3 + 2]]
    const C: V3 = [p[c * 3], p[c * 3 + 1], p[c * 3 + 2]]
    if (len(cross(sub(B, A), sub(C, A))) > 1e-12) keep.push(a, b, c)
  }
  return { positions: m.positions, indices: Uint32Array.from(keep) }
}

/** Points along a polyline at the given arc-length fractions (0..1). */
function resample(pts: V3[], n: number): V3[] {
  const L: number[] = [0]
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + len(sub(pts[i], pts[i - 1])))
  const total = L[L.length - 1]
  const out: V3[] = []
  let k = 1
  for (let i = 0; i < n; i++) {
    const s = (total * i) / (n - 1)
    while (k < pts.length - 1 && L[k] < s) k++
    const seg = L[k] - L[k - 1]
    const t = seg > 0 ? (s - L[k - 1]) / seg : 0
    out.push(add(pts[k - 1], mul(sub(pts[k], pts[k - 1]), t)))
  }
  return out
}

/**
 * Revolve a profile (radius, height) about the Z axis through `centre` by `angle` degrees
 * (360 = all the way round). Points with radius 0 lie on the axis.
 */
export function revolve(profile: [number, number][], opt: { angle?: number; centre?: [number, number]; tol?: number } = {}): Mesh {
  const angle = ((opt.angle ?? 360) * Math.PI) / 180
  const full = Math.abs(Math.abs(angle) - 2 * Math.PI) < 1e-9
  const rmax = Math.max(...profile.map((p) => p[0]))
  const n = Math.max(3, segmentsFor(rmax, angle, opt.tol ?? 0.01))
  const [cx, cy] = opt.centre ?? [0, 0]
  const rows: V3[][] = []
  const steps = full ? n : n + 1
  for (let i = 0; i < steps; i++) {
    const a = (angle * i) / n
    rows.push(profile.map(([r, z]) => [cx + r * Math.cos(a), cy + r * Math.sin(a), z]))
  }
  return gridMesh(rows, full, false)
}

/** Ruled surface: straight lines joining two curves point for point (each resampled by length). */
export function ruled(a: V3[], b: V3[], opt: { n?: number } = {}): Mesh {
  const n = opt.n ?? Math.max(a.length, b.length, 2)
  return gridMesh([resample(a, n), resample(b, n)])
}

/** Loft: ruled strips through a list of sections (each resampled to the same count). */
export function loft(sections: V3[][], opt: { n?: number } = {}): Mesh {
  const n = opt.n ?? Math.max(...sections.map((s) => s.length), 2)
  return gridMesh(sections.map((s) => resample(s, n)))
}

/** Extrude a curve along a vector. */
export function extrude(curve: V3[], v: V3): Mesh {
  return gridMesh([curve, curve.map((p) => add(p, v))])
}

/** A closed shape (with holes) filled flat at height z. */
export function flat(outer: [number, number][], holes: [number, number][][] = [], z = 0): Mesh {
  const ring = (pts: [number, number][]) => {
    const r = pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] ? pts.slice(0, -1) : pts
    return r.map(([x, y]) => new Vector2(x, y))
  }
  let o = ring(outer)
  if (ShapeUtils.isClockWise(o)) o = o.reverse()
  const hs = holes.map((h) => {
    const r = ring(h)
    return ShapeUtils.isClockWise(r) ? r : r.reverse()
  })
  const tris = ShapeUtils.triangulateShape(o, hs)
  const all = [...o, ...hs.flat()]
  const positions = new Float32Array(all.length * 3)
  all.forEach((p, i) => positions.set([p.x, p.y, z], i * 3))
  const indices = Uint32Array.from(tris.flatMap((t) => (orient(all, t) > 0 ? t : [t[0], t[2], t[1]])))
  return { positions, indices }
}

const orient = (pts: Vector2[], t: number[]) => {
  const [a, b, c] = t.map((i) => pts[i])
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

/**
 * Sweep a section (u, v in the plane square to the path) along a path, the section turning with
 * the path without twisting (rotation-minimising frames, double reflection).
 */
export function sweep(section: [number, number][], path: V3[], opt: { closedSection?: boolean; up?: V3 } = {}): Mesh {
  if (path.length < 2) throw new Error('The path needs at least two points.')
  const tangents = path.map((_, i) => unit(sub(path[Math.min(i + 1, path.length - 1)], path[Math.max(i - 1, 0)])))
  // first frame: normal square to the tangent, from `up` (or the least aligned axis)
  const t0 = tangents[0]
  let up = opt.up ?? ([0, 0, 1] as V3)
  if (Math.abs(dot(up, t0)) > 0.99) up = [1, 0, 0]
  let r = unit(cross(up, t0))
  const rows: V3[][] = []
  for (let i = 0; i < path.length; i++) {
    if (i > 0) {
      // double reflection
      const v1 = sub(path[i], path[i - 1])
      const c1 = dot(v1, v1)
      if (c1 > 0) {
        const rL = sub(r, mul(v1, (2 / c1) * dot(v1, r)))
        const tL = sub(tangents[i - 1], mul(v1, (2 / c1) * dot(v1, tangents[i - 1])))
        const v2 = sub(tangents[i], tL)
        const c2 = dot(v2, v2)
        r = c2 > 0 ? sub(rL, mul(v2, (2 / c2) * dot(v2, rL))) : rL
      }
    }
    const s = cross(tangents[i], r)
    rows.push(section.map(([u, v]) => add(path[i], add(mul(r, u), mul(s, v)))))
  }
  return gridMesh(rows, false, !!opt.closedSection)
}

export interface Plane {
  /** A point on the plane and its outward normal (out of the material). */
  p: V3
  n: V3
}

/**
 * Round the edge where two flat faces meet with radius r (a rolling ball): the strip of cylinder
 * tangent to both, along the edge from `a` to `b`. `concave`: an inside corner (the ball sits
 * outside the material) instead of an outside edge.
 */
export function filletPlanes(A: Plane, B: Plane, edge: [V3, V3], r: number, opt: { concave?: boolean; tol?: number } = {}): Mesh {
  const nA = unit(A.n)
  const nB = unit(B.n)
  const axis = unit(sub(edge[1], edge[0]))
  if (Math.abs(dot(nA, nB)) > 1 - 1e-9) throw new Error('The two faces are parallel; there is no edge to round.')
  const s = opt.concave ? 1 : -1
  // centre line: distance r from both planes, on the ball's side
  const dA = dot(nA, A.p) + s * r
  const dB = dot(nB, B.p) + s * r
  const solveAt = (q: V3): V3 => {
    // point c with c·nA = dA, c·nB = dB, c·axis = q·axis
    const dq = dot(q, axis)
    const M = [nA, nB, axis]
    const rhs = [dA, dB, dq]
    const det3 = (m: V3[]) => dot(m[0], cross(m[1], m[2]))
    const D = det3(M)
    const col = (k: number) => M.map((row, i) => row.map((x, j) => (j === k ? rhs[i] : x)) as V3)
    return [det3(col(0)) / D, det3(col(1)) / D, det3(col(2)) / D]
  }
  const c0 = solveAt(edge[0])
  const c1 = solveAt(edge[1])
  // tangent points: on each plane, square to it from the centre
  const tA = mul(nA, -s)
  const tB = mul(nB, -s)
  const sweepAng = Math.acos(Math.max(-1, Math.min(1, dot(tA, tB))))
  const n = Math.max(2, segmentsFor(r, sweepAng, opt.tol ?? 0.01))
  const perp = unit(cross(axis, tA))
  const sign = dot(cross(tA, tB), axis) >= 0 ? 1 : -1
  const arc = (c: V3): V3[] => {
    const out: V3[] = []
    for (let i = 0; i <= n; i++) {
      const a = (sweepAng * i) / n
      out.push(add(c, add(mul(tA, r * Math.cos(a)), mul(perp, sign * r * Math.sin(a)))))
    }
    return out
  }
  return gridMesh([arc(c0), arc(c1)])
}

/** Cut a mesh by a plane: the part on the side the normal points to, and the rest. */
export function splitMesh(m: Mesh, plane: Plane): { above: Mesh; below: Mesh } {
  const p = m.positions
  const n = unit(plane.n)
  const d0 = dot(n, plane.p)
  const above: V3[] = []
  const below: V3[] = []
  const side = (q: V3) => dot(n, q) - d0
  for (let t = 0; t < m.indices.length; t += 3) {
    const tri = [0, 1, 2].map((k) => {
      const i = m.indices[t + k]
      return [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]] as V3
    })
    const s = tri.map(side)
    const keep = (want: 1 | -1) => {
      const out: V3[] = []
      for (let k = 0; k < 3; k++) {
        const a = tri[k]
        const b = tri[(k + 1) % 3]
        const sa = s[k] * want
        const sb = s[(k + 1) % 3] * want
        if (sa >= 0) out.push(a)
        if ((sa >= 0) !== (sb >= 0) && Math.abs(sa - sb) > 0) out.push(add(a, mul(sub(b, a), sa / (sa - sb))))
      }
      return out
    }
    for (const [want, dest] of [
      [1, above],
      [-1, below],
    ] as const) {
      const poly = keep(want)
      for (let k = 1; k + 1 < poly.length; k++) dest.push(poly[0], poly[k], poly[k + 1])
    }
  }
  const pack = (tris: V3[]): Mesh => dropDegenerate({ positions: Float32Array.from(tris.flat()), indices: Uint32Array.from(tris.map((_, i) => i)) })
  return { above: pack(above), below: pack(below) }
}

/** Open (boundary) edges of a mesh, each with the triangle it belongs to. */
function openEdges(m: Mesh): { a: number; b: number; t: number }[] {
  const count = new Map<string, { a: number; b: number; t: number; n: number }>()
  for (let t = 0; t < m.indices.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = m.indices[t + k]
      const b = m.indices[t + ((k + 1) % 3)]
      const key = a < b ? `${a}_${b}` : `${b}_${a}`
      const e = count.get(key)
      if (e) e.n++
      else count.set(key, { a, b, t, n: 1 })
    }
  return [...count.values()].filter((e) => e.n === 1)
}

/**
 * Extend a surface past its open edges by d (straight on, in the plane of the edge's facet; at a
 * corner the two edges meet square, so a flat 10 x 10 square becomes 14 x 14 with d = 2).
 */
export function extendMesh(m: Mesh, d: number): Mesh {
  const P = (i: number): V3 => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]]
  const edges = openEdges(m)
  if (!edges.length) throw new Error('The surface has no open edges to extend (it is closed).')
  const outs = new Map<number, V3[]>()
  for (const e of edges) {
    const tri = [m.indices[e.t], m.indices[e.t + 1], m.indices[e.t + 2]]
    const third = tri.find((v) => v !== e.a && v !== e.b)!
    const a = P(e.a)
    const b = P(e.b)
    const fn = cross(sub(b, a), sub(P(third), a))
    let o = unit(cross(sub(b, a), fn))
    if (dot(o, sub(P(third), a)) > 0) o = mul(o, -1)
    for (const v of [e.a, e.b]) outs.set(v, [...(outs.get(v) ?? []), o])
  }
  const base = m.positions.length / 3
  const moved = new Map<number, number>()
  const extra: number[] = []
  for (const [v, os] of outs) {
    let off: V3
    if (os.length >= 2) {
      const o1 = os[0]
      const o2 = os[1]
      const k = 1 + dot(o1, o2)
      off = k > 1e-6 ? mul(add(o1, o2), d / k) : mul(o1, d)
    } else off = mul(os[0], d)
    moved.set(v, base + extra.length / 3)
    extra.push(...add(P(v), off))
  }
  const positions = new Float32Array(m.positions.length + extra.length)
  positions.set(m.positions)
  positions.set(extra, m.positions.length)
  const idx = [...m.indices]
  for (const e of edges) {
    const a2 = moved.get(e.a)!
    const b2 = moved.get(e.b)!
    // the facet runs a -> b; the new strip runs b -> a so it faces the same way
    idx.push(e.b, e.a, a2, e.b, a2, b2)
  }
  return { positions, indices: Uint32Array.from(idx) }
}

export function meshArea(m: Mesh): number {
  let s = 0
  const p = m.positions
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]]
    const A: V3 = [p[a * 3], p[a * 3 + 1], p[a * 3 + 2]]
    s += len(cross(sub([p[b * 3], p[b * 3 + 1], p[b * 3 + 2]], A), sub([p[c * 3], p[c * 3 + 1], p[c * 3 + 2]], A))) / 2
  }
  return s
}
