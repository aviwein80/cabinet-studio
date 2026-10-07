/**
 * Convex solids and the distance between them (M3.6): the geometry under the fixture checks
 * (FIX-01) and the machine simulation (SIM-06). Our own code.
 *
 * A convex solid is known by its support point: the point of the solid farthest along a direction.
 * From that alone we get its box, the solid moved along a straight line (its swept volume), two
 * poses of it hulled together, and the distance between two solids by the GJK method (the closest
 * point of the solids' difference to the origin, found on a growing simplex of support points).
 *
 * Shapes: prisms (a convex polygon between two heights, in any frame: blocks, pods, rails,
 * slices of an imported model, parts of a machine), frusta round any axis (cylinders, cones,
 * discs; rounded by a ball: spheres, a bull-nose's corner), and those swept, hulled and grown.
 *
 * Pure: no DOM, no React.
 */

export type Vec = [number, number, number]

export interface Convex {
  /** The solid's point farthest along d (d need not be a unit vector, nor non-zero). */
  support(d: readonly number[]): Vec
  /** A point inside it. */
  centre: Vec
}

export interface Aabb {
  lo: Vec
  hi: Vec
}

export const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const sub = (a: readonly number[], b: readonly number[]): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: readonly number[], b: readonly number[]): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mul = (a: readonly number[], s: number): Vec => [a[0] * s, a[1] * s, a[2] * s]
const cross = (a: readonly number[], b: readonly number[]): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = (a: readonly number[]) => Math.hypot(a[0], a[1], a[2])

/** A rotation as three rows (world = R · local). */
export type Mat3 = [Vec, Vec, Vec]
export const IDENTITY: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]
export const apply3 = (R: Mat3, v: readonly number[]): Vec => [dot(R[0], v), dot(R[1], v), dot(R[2], v)]
/** Rᵀ · v (world to local). */
export const applyT3 = (R: Mat3, v: readonly number[]): Vec => [R[0][0] * v[0] + R[1][0] * v[1] + R[2][0] * v[2], R[0][1] * v[0] + R[1][1] * v[1] + R[2][1] * v[2], R[0][2] * v[0] + R[1][2] * v[1] + R[2][2] * v[2]]
export const mulM3 = (A: Mat3, B: Mat3): Mat3 => [0, 1, 2].map((i) => [0, 1, 2].map((j) => A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j])) as Mat3

/** Rotation by `deg` degrees about unit axis k (right-handed). */
export function rotM3(k: readonly number[], deg: number): Mat3 {
  const a = (deg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  const t = 1 - c
  const [x, y, z] = k
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ]
}

// ---------------------------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------------------------

/**
 * A prism: the convex polygon `poly` (x, y pairs, any order of a convex outline) between heights
 * z0 and z1, placed by rotation R and origin o (world = o + R · local).
 */
export function prism(poly: readonly number[], z0: number, z1: number, o: readonly number[] = [0, 0, 0], R: Mat3 = IDENTITY): Convex {
  const n = poly.length >> 1
  let cx = 0
  let cy = 0
  for (let i = 0; i < n; i++) {
    cx += poly[2 * i]
    cy += poly[2 * i + 1]
  }
  const ident = R === IDENTITY
  return {
    centre: add(o, apply3(R, [cx / n, cy / n, (z0 + z1) / 2])),
    support(d) {
      const l = ident ? d : applyT3(R, d)
      let best = 0
      let bv = -Infinity
      for (let i = 0; i < n; i++) {
        const v = l[0] * poly[2 * i] + l[1] * poly[2 * i + 1]
        if (v > bv) {
          bv = v
          best = i
        }
      }
      const p: Vec = [poly[2 * best], poly[2 * best + 1], l[2] >= 0 ? z1 : z0]
      return ident ? [o[0] + p[0], o[1] + p[1], o[2] + p[2]] : add(o, apply3(R, p))
    },
  }
}

/** An axis-aligned box. */
export const box = (lo: readonly number[], hi: readonly number[]): Convex => prism([lo[0], lo[1], hi[0], lo[1], hi[0], hi[1], lo[0], hi[1]], lo[2], hi[2])

/**
 * A frustum round unit axis w through P: from height h0 (radius r0) to h1 (radius r1) along w,
 * grown by a ball of radius `round` (a sphere is a frustum of no length or radius, rounded).
 */
export function frustum(P: readonly number[], w: readonly number[], h0: number, h1: number, r0: number, r1: number, round = 0): Convex {
  return {
    centre: add(P, mul(w, (h0 + h1) / 2)),
    support(d) {
      const dw = dot(d, w)
      const rad: Vec = [d[0] - dw * w[0], d[1] - dw * w[1], d[2] - dw * w[2]]
      const rl = len(rad)
      const u: Vec = rl > 1e-15 ? [rad[0] / rl, rad[1] / rl, rad[2] / rl] : [0, 0, 0]
      const v0 = dw * h0 + rl * r0
      const v1 = dw * h1 + rl * r1
      const h = v1 > v0 ? h1 : h0
      const r = v1 > v0 ? r1 : r0
      let p: Vec = [P[0] + w[0] * h + u[0] * r, P[1] + w[1] * h + u[1] * r, P[2] + w[2] * h + u[2] * r]
      if (round > 0) {
        const dl = len(d)
        if (dl > 1e-15) p = add(p, mul(d, round / dl))
      }
      return p
    },
  }
}

export const sphere = (c: readonly number[], r: number): Convex => frustum(c, [0, 0, 1], 0, 0, 0, 0, r)

/** The solid moved along the straight line by `delta`: everything it passes through. */
export function swept(c: Convex, delta: readonly number[]): Convex {
  if (Math.abs(delta[0]) + Math.abs(delta[1]) + Math.abs(delta[2]) < 1e-15) return c
  return {
    centre: add(c.centre, mul(delta, 0.5)),
    support(d) {
      const p = c.support(d)
      return dot(d, delta) > 0 ? add(p, delta) : p
    },
  }
}

/** The convex hull of two solids (e.g. one solid in two poses). */
export function hull2(a: Convex, b: Convex): Convex {
  return {
    centre: mul(add(a.centre, b.centre), 0.5),
    support(d) {
      const p = a.support(d)
      const q = b.support(d)
      return dot(d, q) > dot(d, p) ? q : p
    },
  }
}

/** The solid grown by a ball of radius r. */
export function grown(c: Convex, r: number): Convex {
  if (!(r > 0)) return c
  return {
    centre: c.centre,
    support(d) {
      const p = c.support(d)
      const l = len(d)
      return l > 1e-15 ? add(p, mul(d, r / l)) : p
    },
  }
}

/** The solid placed by rotation R about the origin, then moved by t (world = t + R · local). */
export function placed(c: Convex, R: Mat3, t: readonly number[]): Convex {
  return {
    centre: add(t, apply3(R, c.centre)),
    support(d) {
      return add(t, apply3(R, c.support(applyT3(R, d))))
    },
  }
}

/** The box round a solid (exact for convex solids). */
export function aabbOf(c: Convex): Aabb {
  const lo: Vec = [c.support([-1, 0, 0])[0], c.support([0, -1, 0])[1], c.support([0, 0, -1])[2]]
  const hi: Vec = [c.support([1, 0, 0])[0], c.support([0, 1, 0])[1], c.support([0, 0, 1])[2]]
  return { lo, hi }
}

/** Do two boxes come within `gap` of each other? */
export const boxesNear = (a: Aabb, b: Aabb, gap = 0) =>
  a.lo[0] <= b.hi[0] + gap && b.lo[0] <= a.hi[0] + gap && a.lo[1] <= b.hi[1] + gap && b.lo[1] <= a.hi[1] + gap && a.lo[2] <= b.hi[2] + gap && b.lo[2] <= a.hi[2] + gap

// ---------------------------------------------------------------------------------------------
// Distance (GJK)
// ---------------------------------------------------------------------------------------------

/** Closest point to the origin on a simplex of 1-4 points; the points that span it are kept. */
function closest(s: Vec[]): { v: Vec; s: Vec[] } {
  switch (s.length) {
    case 1:
      return { v: s[0], s }
    case 2:
      return seg(s[0], s[1])
    case 3:
      return tri(s[0], s[1], s[2])
    default:
      return tet(s[0], s[1], s[2], s[3])
  }
}

function seg(a: Vec, b: Vec): { v: Vec; s: Vec[] } {
  const ab = sub(b, a)
  const den = dot(ab, ab)
  if (den < 1e-30) return { v: a, s: [a] }
  const t = -dot(a, ab) / den
  if (t <= 0) return { v: a, s: [a] }
  if (t >= 1) return { v: b, s: [b] }
  return { v: add(a, mul(ab, t)), s: [a, b] }
}

/** Closest point of triangle abc to the origin, by its feature regions. */
function tri(a: Vec, b: Vec, c: Vec): { v: Vec; s: Vec[] } {
  const ab = sub(b, a)
  const ac = sub(c, a)
  const ap = mul(a, -1)
  const d1 = dot(ab, ap)
  const d2 = dot(ac, ap)
  if (d1 <= 0 && d2 <= 0) return { v: a, s: [a] }
  const bp = mul(b, -1)
  const d3 = dot(ab, bp)
  const d4 = dot(ac, bp)
  if (d3 >= 0 && d4 <= d3) return { v: b, s: [b] }
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3)
    return { v: add(a, mul(ab, t)), s: [a, b] }
  }
  const cp = mul(c, -1)
  const d5 = dot(ab, cp)
  const d6 = dot(ac, cp)
  if (d6 >= 0 && d5 <= d6) return { v: c, s: [c] }
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6)
    return { v: add(a, mul(ac, t)), s: [a, c] }
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / (d4 - d3 + (d5 - d6))
    return { v: add(b, mul(sub(c, b), t)), s: [b, c] }
  }
  const den = va + vb + vc
  if (Math.abs(den) < 1e-30) return seg(a, b)
  const v = vb / den
  const w = vc / den
  return { v: add(a, add(mul(ab, v), mul(ac, w))), s: [a, b, c] }
}

/** Closest point of tetrahedron abcd to the origin; the origin inside gives the origin itself. */
function tet(a: Vec, b: Vec, c: Vec, d: Vec): { v: Vec; s: Vec[] } {
  const faces: [Vec, Vec, Vec, Vec][] = [
    [a, b, c, d],
    [a, c, d, b],
    [a, d, b, c],
    [b, d, c, a],
  ]
  let best: { v: Vec; s: Vec[] } | null = null
  let bd = Infinity
  let outside = false
  for (const [p, q, r, o] of faces) {
    const n = cross(sub(q, p), sub(r, p))
    const so = dot(sub(o, p), n)
    const sp = -dot(p, n)
    // the origin on the far side of this face from the fourth point (or a flat tetrahedron)
    if (Math.abs(so) < 1e-18 || sp * so < 0) {
      outside = true
      const f = tri(p, q, r)
      const dd = dot(f.v, f.v)
      if (dd < bd) {
        bd = dd
        best = f
      }
    }
  }
  if (!outside) return { v: [0, 0, 0], s: [a, b, c, d] }
  return best!
}

/**
 * Distance between two convex solids (0 when they overlap or touch). `stopAt`: once the distance
 * is known to be at least this, stop and return what is known so far (a value >= stopAt).
 */
export function distance(A: Convex, B: Convex, stopAt = Infinity): number {
  // start from a point of the difference A - B (a support point), so v only ever gets nearer
  let d0 = sub(B.centre, A.centre)
  if (len(d0) < 1e-12) d0 = [1, 0, 0]
  let v = sub(A.support(d0), B.support(mul(d0, -1)))
  let s: Vec[] = [v]
  if (dot(v, v) < 1e-24) return 0
  const stop2 = stopAt * stopAt
  for (let it = 0; it < 96; it++) {
    const w = sub(A.support(mul(v, -1)), B.support(v))
    const vv = dot(v, v)
    const vw = dot(v, w)
    // a lower bound: the distance is at least v·w / |v|
    if (vw > 0 && vw * vw >= stop2 * vv) return vw / Math.sqrt(vv)
    if (vv - vw <= 1e-11 * vv + 1e-20) return Math.sqrt(vv)
    if (s.some((p) => Math.abs(p[0] - w[0]) + Math.abs(p[1] - w[1]) + Math.abs(p[2] - w[2]) < 1e-12)) return Math.sqrt(vv)
    s.push(w)
    const c = closest(s)
    s = c.s
    const nv = dot(c.v, c.v)
    if (s.length === 4 || nv < 1e-24) return 0
    if (nv >= vv * (1 - 1e-14)) return Math.sqrt(Math.min(nv, vv))
    v = c.v
  }
  return len(v)
}

/** Unit directions spread over the sphere (the six axes, the eight corners, twelve edges, and an icosahedron's twelve). */
const DIRS: Vec[] = (() => {
  const out: Vec[] = []
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) out.push(mul([x, y, z], 1 / Math.hypot(x, y, z)))
  const g = (1 + Math.sqrt(5)) / 2
  for (const [a, b] of [
    [1, g],
    [-1, g],
    [1, -g],
    [-1, -g],
  ])
    for (const p of [
      [0, a, b],
      [a, b, 0],
      [b, 0, a],
    ] as Vec[])
      out.push(mul(p, 1 / len(p)))
  return out
})()

/**
 * How far two overlapping solids reach into each other: the shortest move that separates them
 * (the smallest of their combined support along any direction), found over spread directions and
 * refined. An upper bound on the true depth (close to it); 0 when they do not overlap.
 */
export function penetration(A: Convex, B: Convex, extra: readonly Vec[] = []): number {
  const h = (d: Vec) => dot(d, A.support(d)) - dot(d, B.support(mul(d, -1)))
  let best: Vec = [0, 0, 1]
  let bv = Infinity
  for (const d of [...DIRS, ...extra.map((e) => mul(e, 1 / (len(e) || 1)))]) {
    const v = h(d)
    if (v < bv) {
      bv = v
      best = d
    }
  }
  if (bv <= 0) return 0
  // refine: try turning the best direction a little each way, halving the turn
  for (let step = 0.3; step > 1e-4; step /= 2) {
    let moved = true
    while (moved) {
      moved = false
      const t1 = Math.abs(best[2]) < 0.9 ? cross(best, [0, 0, 1]) : cross(best, [1, 0, 0])
      const a1 = mul(t1, 1 / len(t1))
      const a2 = cross(best, a1)
      for (const e of [a1, mul(a1, -1), a2, mul(a2, -1)]) {
        const d = add(best, mul(e, step))
        const u = mul(d, 1 / len(d))
        const v = h(u)
        if (v < bv - 1e-12) {
          bv = v
          best = u
          moved = true
        }
      }
    }
  }
  return Math.max(0, bv)
}
