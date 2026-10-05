/**
 * Face types and exact surface parameters from the reader's triangulation. Every triangle corner
 * lies on the true surface and carries the true surface normal, so the fits below recover planes,
 * cylinders, cones and spheres to the precision of the numbers (about 1e-9 mm on the fixtures),
 * not to the triangle size. Anything that fits none of them within `FIT_TOL` is 'other'.
 *
 * Also: which faces touch which (shared boundary edges) and each face's boundary loops, with the
 * neighbouring face along every edge.
 */
import type { FaceSurface, SolidBody, V3 } from './types'

/** Largest distance (mm) of a face's points from a fitted surface for the fit to count. */
export const FIT_TOL = 1e-4

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
export const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const len3 = (a: V3) => Math.hypot(a[0], a[1], a[2])
export const unit3 = (a: V3): V3 => {
  const l = len3(a)
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]
}

/** Eigenvalues (ascending) and unit eigenvectors of a symmetric 3x3 matrix (Jacobi rotations). */
export function eigenSym3(m: number[][]): { values: number[]; vectors: V3[] } {
  const a = m.map((r) => r.slice())
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2])
    if (off < 1e-300) break
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      if (Math.abs(a[p][q]) < 1e-300) continue
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
      const c = 1 / Math.sqrt(t * t + 1)
      const s = t * c
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p]
        const akq = a[k][q]
        a[k][p] = c * akp - s * akq
        a[k][q] = s * akp + c * akq
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k]
        const aqk = a[q][k]
        a[p][k] = c * apk - s * aqk
        a[q][k] = s * apk + c * aqk
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p]
        const vkq = v[k][q]
        v[k][p] = c * vkp - s * vkq
        v[k][q] = s * vkp + c * vkq
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j])
  return { values: order.map((i) => a[i][i]), vectors: order.map((i) => unit3([v[0][i], v[1][i], v[2][i]])) }
}

/** Two unit vectors square to `v` and to each other. */
export function basisOf(v: V3): [V3, V3] {
  const t: V3 = Math.abs(v[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const e1 = unit3(cross3(v, t))
  return [e1, cross3(v, e1)]
}

/** Point nearest (least squares) to all lines q + t m (2D); null when the lines are all parallel. */
function linesMeet2(qs: [number, number][], ms: [number, number][]): [number, number] | null {
  let a00 = 0
  let a01 = 0
  let a11 = 0
  let b0 = 0
  let b1 = 0
  for (let i = 0; i < qs.length; i++) {
    const [mx, my] = ms[i]
    const p00 = 1 - mx * mx
    const p01 = -mx * my
    const p11 = 1 - my * my
    const [qx, qy] = qs[i]
    a00 += p00
    a01 += p01
    a11 += p11
    b0 += p00 * qx + p01 * qy
    b1 += p01 * qx + p11 * qy
  }
  const det = a00 * a11 - a01 * a01
  if (Math.abs(det) < 1e-9 * Math.max(1, (a00 + a11) ** 2)) return null
  return [(a11 * b0 - a01 * b1) / det, (a00 * b1 - a01 * b0) / det]
}

/** Point nearest (least squares) to all lines p + t n (3D); null when they do not pin a point. */
function linesMeet3(ps: V3[], ns: V3[]): V3 | null {
  const A = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  const b = [0, 0, 0]
  for (let i = 0; i < ps.length; i++) {
    const n = ns[i]
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) {
        const P = (r === c ? 1 : 0) - n[r] * n[c]
        A[r][c] += P
        b[r] += P * ps[i][c]
      }
  }
  const { values } = eigenSym3(A)
  if (values[0] < 1e-6 * values[2]) return null
  // solve A x = b (Cramer)
  const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  const D = det(A)
  const col = (k: number) => A.map((r, i) => r.map((x, j) => (j === k ? b[i] : x)))
  return [det(col(0)) / D, det(col(1)) / D, det(col(2)) / D]
}

export interface FacePoints {
  /** Distinct points of the face and their normals. */
  pts: V3[]
  nrm: V3[]
  /** Area-weighted normal of the triangles (follows their winding: outward). */
  areaNormal: V3
  area: number
}

/** The points, normals and area of one face. */
export function facePoints(body: SolidBody, first: number, last: number): FacePoints {
  const P = body.positions
  const N = body.normals
  const ix = body.indices
  const seen = new Set<number>()
  const pts: V3[] = []
  const nrm: V3[] = []
  let an: V3 = [0, 0, 0]
  let area = 0
  for (let t = first; t <= last; t++) {
    const tri = [ix[t * 3], ix[t * 3 + 1], ix[t * 3 + 2]]
    const [a, b, c] = tri.map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]] as V3)
    const cr = cross3(sub(b, a), sub(c, a))
    an = add(an, cr)
    area += len3(cr) / 2
    for (const i of tri)
      if (!seen.has(i)) {
        seen.add(i)
        pts.push([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]])
        nrm.push(unit3([N[i * 3], N[i * 3 + 1], N[i * 3 + 2]]))
      }
  }
  return { pts, nrm, areaNormal: an, area }
}

/** Solve the square system A x = b (Gaussian elimination with pivoting); null when singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-300) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  const x = new Array(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n]
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]
    x[r] = s / M[r][r]
  }
  return x
}

/** Damped Gauss-Newton (Levenberg-Marquardt) on residuals(params); numeric derivatives. */
function leastSquares(start: number[], residuals: (p: number[]) => number[], iterations = 40): number[] {
  let p = start.slice()
  let r = residuals(p)
  let cost = r.reduce((s, x) => s + x * x, 0)
  let lambda = 1e-6
  const h = 1e-7
  for (let it = 0; it < iterations && cost > 1e-26; it++) {
    const J = p.map((_, k) => {
      const q = p.slice()
      q[k] += h
      const rq = residuals(q)
      return rq.map((x, i) => (x - r[i]) / h)
    })
    const n = p.length
    const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => J[i].reduce((s, x, m) => s + x * J[j][m], 0)))
    const g = Array.from({ length: n }, (_, i) => J[i].reduce((s, x, m) => s + x * r[m], 0))
    let improved = false
    for (let tries = 0; tries < 8 && !improved; tries++) {
      const Ad = A.map((row, i) => row.map((x, j) => (i === j ? x * (1 + lambda) + 1e-30 : x)))
      const step = solve(
        Ad,
        g.map((x) => -x),
      )
      if (!step) break
      const q = p.map((x, i) => x + step[i])
      const rq = residuals(q)
      const cq = rq.reduce((s, x) => s + x * x, 0)
      if (cq < cost) {
        p = q
        r = rq
        const gain = cost - cq
        cost = cq
        lambda = Math.max(1e-12, lambda / 10)
        improved = true
        if (gain < 1e-30) it = iterations
      } else lambda *= 10
    }
    if (!improved) break
  }
  return p
}

/** At most `n` points spread through the list (fits stay fast on big faces). */
function spread<T>(list: T[], n: number): T[] {
  if (list.length <= n) return list
  const out: T[] = []
  for (let i = 0; i < n; i++) out.push(list[Math.floor((i * list.length) / n)])
  return out
}

/** Unit vector near `v`, tilted by angles a, b towards the basis vectors square to it. */
function tilt(v: V3, e: [V3, V3], a: number, b: number): V3 {
  return unit3(add(add(v, mul(e[0], a)), mul(e[1], b)))
}

/** Distance of p from the line through c along unit v. */
function axisDistance(p: V3, c: V3, v: V3) {
  const d = sub(p, c)
  const h = dot3(d, v)
  return Math.sqrt(Math.max(0, dot3(d, d) - h * h))
}

/** Plane, cylinder, cone, sphere or other, with exact parameters (fitted to the points). */
export function fitSurface(fp: FacePoints): FaceSurface {
  const { pts, nrm } = fp
  if (pts.length < 3) return { kind: 'other', fit: 0 }
  const centroid = mul(
    pts.reduce((s, p) => add(s, p), [0, 0, 0] as V3),
    1 / pts.length,
  )
  const few = spread(pts, 400)
  const fewN = spread(nrm, 400)
  const fitOf = (dist: (p: V3) => number) => pts.reduce((m, p) => Math.max(m, Math.abs(dist(p))), 0)

  // plane: best plane through the points; outward from the triangles' winding
  {
    const C = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]
    for (const p of pts) {
      const d = sub(p, centroid)
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r][c] += d[r] * d[c]
    }
    let n = eigenSym3(C).vectors[0]
    const ref = len3(fp.areaNormal) > 1e-12 ? fp.areaNormal : nrm.reduce((s, x) => add(s, x), [0, 0, 0] as V3)
    if (dot3(n, ref) < 0) n = mul(n, -1)
    const fit = fitOf((p) => dot3(n, sub(p, centroid)))
    if (fit <= FIT_TOL) return { kind: 'plane', n, d: dot3(n, centroid), fit }
  }

  // axis guess from the normals: square to every normal (cylinder) or at one angle to all (cone)
  const M = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  for (const n of fewN) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) M[r][c] += n[r] * n[c]
  const vCyl = eigenSym3(M).vectors[0]

  // cylinder: radius constant about an axis
  {
    const guess = radialFit(few, fewN, vCyl)
    if (guess) {
      const e = basisOf(vCyl)
      const base = guess.c3
      const res = (q: number[]) => {
        const v = tilt(vCyl, e, q[0], q[1])
        const c = add(add(base, mul(e[0], q[2])), mul(e[1], q[3]))
        return few.map((p) => axisDistance(p, c, v) - q[4])
      }
      const q = leastSquares([0, 0, 0, 0, guess.r], res)
      const v = tilt(vCyl, e, q[0], q[1])
      const c = add(add(base, mul(e[0], q[2])), mul(e[1], q[3]))
      const fit = fitOf((p) => axisDistance(p, c, v) - q[4])
      if (fit <= FIT_TOL && q[4] > 0) {
        const axisPoint = add(c, mul(v, dot3(sub(centroid, c), v)))
        const concave = nrm.reduce((s, n, i) => {
          const d = sub(pts[i], axisPoint)
          return s - dot3(n, sub(d, mul(v, dot3(d, v))))
        }, 0) > 0
        return { kind: 'cylinder', p: axisPoint, v: canonicalDir(v), r: q[4], concave, fit }
      }
    }
  }

  // cone: radius changes linearly along an axis
  {
    const mean = mul(
      fewN.reduce((s, x) => add(s, x), [0, 0, 0] as V3),
      1 / fewN.length,
    )
    const C = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]
    for (const n of fewN) {
      const d = sub(n, mean)
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r][c] += d[r] * d[c]
    }
    let v0 = eigenSym3(C).vectors[0]
    const m = fewN.reduce((s, n) => s + dot3(n, v0), 0) / fewN.length
    if (Math.abs(m) > 1e-3 && Math.abs(m) < 1 - 1e-3) {
      const g = radialFit(few, fewN, v0)
      if (g && Math.abs(g.slope) > 1e-6) {
        if (g.slope < 0) v0 = mul(v0, -1)
        const slope = Math.abs(g.slope)
        const h0 = -g.intercept / g.slope
        const apex0 = add(g.c3, mul(g.slope < 0 ? mul(v0, -1) : v0, h0))
        const e = basisOf(v0)
        const res = (q: number[]) => {
          const v = tilt(v0, e, q[0], q[1])
          const apex = add(apex0, [q[2], q[3], q[4]])
          const ca = Math.cos(q[5])
          const sa = Math.sin(q[5])
          return few.map((p) => {
            const d = sub(p, apex)
            const h = dot3(d, v)
            const rho = Math.sqrt(Math.max(0, dot3(d, d) - h * h))
            return rho * ca - h * sa
          })
        }
        const q = leastSquares([0, 0, 0, 0, 0, Math.atan(slope)], res)
        const v = tilt(v0, e, q[0], q[1])
        const apex = add(apex0, [q[2], q[3], q[4]])
        const ca = Math.cos(q[5])
        const sa = Math.sin(q[5])
        const fit = fitOf((p) => {
          const d = sub(p, apex)
          const h = dot3(d, v)
          return Math.sqrt(Math.max(0, dot3(d, d) - h * h)) * ca - h * sa
        })
        if (fit <= FIT_TOL && q[5] > 1e-4 && q[5] < Math.PI / 2 - 1e-4) {
          const concave = nrm.reduce((s, n, i) => {
            const d = sub(pts[i], apex)
            return s - dot3(n, sub(d, mul(v, dot3(d, v))))
          }, 0) > 0
          return { kind: 'cone', p: apex, v, angle: q[5], concave, fit }
        }
      }
    }
  }

  // sphere: every point at one distance from a centre
  {
    const c0 = linesMeet3(few, fewN)
    if (c0) {
      const r0 = few.reduce((s, p) => s + len3(sub(p, c0)), 0) / few.length
      const q = leastSquares([c0[0], c0[1], c0[2], r0], (q) => few.map((p) => len3(sub(p, [q[0], q[1], q[2]])) - q[3]))
      const c: V3 = [q[0], q[1], q[2]]
      const fit = fitOf((p) => len3(sub(p, c)) - q[3])
      if (fit <= FIT_TOL && q[3] > 0) {
        const concave = nrm.reduce((s, n, i) => s + dot3(n, sub(c, pts[i])), 0) > 0
        return { kind: 'sphere', p: c, r: q[3], concave, fit }
      }
    }
  }
  return { kind: 'other', fit: 0 }
}

/** Axis directions pointing up (or along +Y, +X when level), so equal axes compare equal. */
function canonicalDir(v: V3): V3 {
  const k = Math.abs(v[2]) > 1e-9 ? v[2] : Math.abs(v[1]) > 1e-9 ? v[1] : v[0]
  return k < 0 ? mul(v, -1) : v
}

/**
 * Points around an axis along `v`: the axis position from the normals (they cross it), each
 * point's distance from it and its height along it; fits radius = constant and radius = a + b h.
 * A starting guess for the exact fits above.
 */
function radialFit(pts: V3[], nrm: V3[], v: V3) {
  const [e1, e2] = basisOf(v)
  const qs = pts.map((p) => [dot3(p, e1), dot3(p, e2)] as [number, number])
  const ms = nrm.map((n) => {
    const x = dot3(n, e1)
    const y = dot3(n, e2)
    const l = Math.hypot(x, y) || 1
    return [x / l, y / l] as [number, number]
  })
  const c = linesMeet2(qs, ms)
  if (!c) return null
  const rho = qs.map((q) => Math.hypot(q[0] - c[0], q[1] - c[1]))
  const h = pts.map((p) => dot3(p, v))
  const r = rho.reduce((s, x) => s + x, 0) / rho.length
  const n = h.length
  const mh = h.reduce((s, x) => s + x, 0) / n
  let shh = 0
  let shr = 0
  for (let i = 0; i < n; i++) {
    shh += (h[i] - mh) ** 2
    shr += (h[i] - mh) * (rho[i] - r)
  }
  const slope = shh > 1e-12 ? shr / shh : 0
  const intercept = r - slope * mh
  const c3 = add(mul(e1, c[0]), mul(e2, c[1]))
  return { c3, r, slope, intercept }
}

// ---------------------------------------------------------------------------------------------
// Topology: shared edges, boundary loops
// ---------------------------------------------------------------------------------------------

export interface LoopEdge {
  /** Welded vertex ids at the start and end of the edge (direction as the face's triangles run). */
  a: number
  b: number
  /** Face on the other side of the edge (0: none, an open edge). */
  other: number
}

export interface FaceLoops {
  face: number
  /** Closed loops of boundary edges, each running counter-clockwise seen from outside the material. */
  loops: LoopEdge[][]
}

export interface Topology {
  /** Welded positions (one per distinct point of the body). */
  points: V3[]
  /** Welded id of each vertex of the body. */
  weld: Uint32Array
  loops: Map<number, FaceLoops>
  /** Faces next to each face. */
  neighbours: Map<number, Set<number>>
}

/** Join coincident vertices (within `eps` mm) so faces that share an edge share its points. */
export function weldVertices(pos: Float64Array, eps = 1e-6): { weld: Uint32Array; points: V3[] } {
  const n = pos.length / 3
  const weld = new Uint32Array(n)
  const points: V3[] = []
  const cell = eps * 4
  const grid = new Map<string, number[]>()
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3]
    const y = pos[i * 3 + 1]
    const z = pos[i * 3 + 2]
    const gx = Math.floor(x / cell)
    const gy = Math.floor(y / cell)
    const gz = Math.floor(z / cell)
    let found = -1
    for (let dx = -1; dx <= 1 && found < 0; dx++)
      for (let dy = -1; dy <= 1 && found < 0; dy++)
        for (let dz = -1; dz <= 1 && found < 0; dz++) {
          const list = grid.get(key(gx + dx, gy + dy, gz + dz))
          if (!list) continue
          for (const id of list) {
            const p = points[id]
            if (Math.abs(p[0] - x) <= eps && Math.abs(p[1] - y) <= eps && Math.abs(p[2] - z) <= eps) {
              found = id
              break
            }
          }
        }
    if (found < 0) {
      found = points.length
      points.push([x, y, z])
      const k = key(gx, gy, gz)
      const list = grid.get(k)
      if (list) list.push(found)
      else grid.set(k, [found])
    }
    weld[i] = found
  }
  return { weld, points }
}

export function topology(body: SolidBody): Topology {
  const { weld, points } = weldVertices(body.positions)
  const ix = body.indices
  // directed boundary edges of each face (edges used once within the face)
  const faceOfTri = new Int32Array(ix.length / 3)
  for (const f of body.faces) for (let t = f.first; t <= f.last; t++) faceOfTri[t] = f.id
  const perFace = new Map<number, Map<string, LoopEdge>>()
  const ek = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`)
  for (const f of body.faces) {
    const count = new Map<string, LoopEdge & { n: number }>()
    for (let t = f.first; t <= f.last; t++) {
      for (let k = 0; k < 3; k++) {
        const a = weld[ix[t * 3 + k]]
        const b = weld[ix[t * 3 + ((k + 1) % 3)]]
        if (a === b) continue
        const key = ek(a, b)
        const e = count.get(key)
        if (e) e.n++
        else count.set(key, { a, b, other: 0, n: 1 })
      }
    }
    const bnd = new Map<string, LoopEdge>()
    for (const [k, e] of count) if (e.n === 1) bnd.set(k, { a: e.a, b: e.b, other: 0 })
    perFace.set(f.id, bnd)
  }
  // the face on the other side of each boundary edge
  const owners = new Map<string, number[]>()
  for (const [fid, bnd] of perFace) for (const k of bnd.keys()) owners.set(k, [...(owners.get(k) ?? []), fid])
  const neighbours = new Map<number, Set<number>>()
  for (const f of body.faces) neighbours.set(f.id, new Set())
  for (const [k, fs] of owners) {
    if (fs.length < 2) continue
    for (const f of fs) {
      const e = perFace.get(f)!.get(k)!
      e.other = fs.find((x) => x !== f) ?? 0
      for (const g of fs) if (g !== f) neighbours.get(f)!.add(g)
    }
  }
  // chain each face's boundary edges into loops
  const loops = new Map<number, FaceLoops>()
  for (const [fid, bnd] of perFace) {
    const from = new Map<number, LoopEdge[]>()
    for (const e of bnd.values()) from.set(e.a, [...(from.get(e.a) ?? []), e])
    const used = new Set<LoopEdge>()
    const out: LoopEdge[][] = []
    for (const start of bnd.values()) {
      if (used.has(start)) continue
      const loop: LoopEdge[] = []
      let e: LoopEdge | undefined = start
      while (e && !used.has(e)) {
        used.add(e)
        loop.push(e)
        const next: LoopEdge[] = (from.get(e.b) ?? []).filter((x) => !used.has(x))
        e = next[0]
      }
      if (loop.length >= 2) out.push(loop)
    }
    loops.set(fid, { face: fid, loops: out })
  }
  return { points, weld, loops, neighbours }
}
