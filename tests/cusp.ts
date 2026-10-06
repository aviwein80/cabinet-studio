/**
 * Independent cusp measurement for 3D finishing tests (shares no code with the generators): how
 * much material a ball-nose leaves above the model, measured along the surface normal, from the
 * capsules its centre sweeps along the cutting moves.
 */
import { DropCutter } from '@/cam/3d/dropcutter'
import type { Mesh } from '@/cam/mesh/types'
import { type Move, simpleMoves } from '@/cam/toolpath'

type V = [number, number, number]

/** Ball-centre segments of the cutting moves, binned in plan. */
export class SweptBalls {
  readonly segs: { a: V; b: V }[] = []
  private readonly bins = new Map<number, number[]>()
  private readonly cell = 2
  readonly r: number
  constructor(moves: Move[], r: number) {
    this.r = r
    let at: V | null = null
    for (const m of simpleMoves(moves)) {
      if (m.t === 'drill' || m.t === 'arc') {
        at = null
        continue
      }
      const p: V = [m.x, m.y, m.z + r]
      if (m.t === 'feed' && at) this.segs.push({ a: at, b: p })
      at = p
    }
    this.segs.forEach((s, k) => {
      const x0 = Math.floor((Math.min(s.a[0], s.b[0]) - r) / this.cell)
      const x1 = Math.floor((Math.max(s.a[0], s.b[0]) + r) / this.cell)
      const y0 = Math.floor((Math.min(s.a[1], s.b[1]) - r) / this.cell)
      const y1 = Math.floor((Math.max(s.a[1], s.b[1]) + r) / this.cell)
      for (let j = y0; j <= y1; j++)
        for (let i = x0; i <= x1; i++) {
          const key = (j + 50000) * 100000 + (i + 50000)
          let b = this.bins.get(key)
          if (!b) this.bins.set(key, (b = []))
          b.push(k)
        }
    })
  }

  /** Smallest t >= 0 at which p + t n enters any swept ball (0 when p is already inside). */
  entry(p: V, n: V): number {
    const key = (Math.floor(p[1] / this.cell) + 50000) * 100000 + (Math.floor(p[0] / this.cell) + 50000)
    let best = Infinity
    const R2 = this.r * this.r
    for (const k of this.bins.get(key) ?? []) {
      const { a, b } = this.segs[k]
      const t = capsuleEntry(p, n, a, b, R2)
      if (t < best) best = t
    }
    return best
  }
}

function capsuleEntry(p: V, n: V, a: V, b: V, R2: number): number {
  let best = Infinity
  const sphere = (c: V) => {
    const dx = p[0] - c[0], dy = p[1] - c[1], dz = p[2] - c[2]
    const bb = n[0] * dx + n[1] * dy + n[2] * dz
    const cc = dx * dx + dy * dy + dz * dz - R2
    if (cc <= 0) return 0
    const disc = bb * bb - cc
    if (disc < 0) return Infinity
    const t = -bb - Math.sqrt(disc)
    return t >= 0 ? t : Infinity
  }
  best = Math.min(sphere(a), sphere(b))
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
  const L = Math.hypot(ux, uy, uz)
  if (L > 1e-12) {
    const u: V = [ux / L, uy / L, uz / L]
    const D: V = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]
    const du = D[0] * u[0] + D[1] * u[1] + D[2] * u[2]
    const nu = n[0] * u[0] + n[1] * u[1] + n[2] * u[2]
    const Dp: V = [D[0] - du * u[0], D[1] - du * u[1], D[2] - du * u[2]]
    const np: V = [n[0] - nu * u[0], n[1] - nu * u[1], n[2] - nu * u[2]]
    const A = np[0] * np[0] + np[1] * np[1] + np[2] * np[2]
    const B = Dp[0] * np[0] + Dp[1] * np[1] + Dp[2] * np[2]
    const C = Dp[0] * Dp[0] + Dp[1] * Dp[1] + Dp[2] * Dp[2] - R2
    if (C <= 0 && du >= 0 && du <= L) return 0
    if (A > 1e-15) {
      const disc = B * B - A * C
      if (disc >= 0) {
        const t = (-B - Math.sqrt(disc)) / A
        const s = du + t * nu
        if (t >= 0 && s >= 0 && s <= L) best = Math.min(best, t)
      }
    }
  }
  return best
}

/** The model's surface point at (x, y) seen from above, and its facet's upward normal. */
export function surfacePoint(needle: DropCutter, mesh: Mesh, x: number, y: number): { p: V; n: V } | null {
  if (!needle.drop(x, y)) return null
  const t = needle.hitTri
  const ix = mesh.indices
  const P = mesh.positions
  const A = [P[ix[t * 3] * 3], P[ix[t * 3] * 3 + 1], P[ix[t * 3] * 3 + 2]]
  const B = [P[ix[t * 3 + 1] * 3], P[ix[t * 3 + 1] * 3 + 1], P[ix[t * 3 + 1] * 3 + 2]]
  const C = [P[ix[t * 3 + 2] * 3], P[ix[t * 3 + 2] * 3 + 1], P[ix[t * 3 + 2] * 3 + 2]]
  const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]]
  const e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]]
  let n: V = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
  const l = Math.hypot(...n)
  n = [n[0] / l, n[1] / l, n[2] / l]
  if (n[2] < 0) n = [-n[0], -n[1], -n[2]]
  // the plane of the facet at (x, y)
  const z = A[2] - (n[0] * (x - A[0]) + n[1] * (y - A[1])) / n[2]
  return { p: [x, y, z], n }
}

/** A needle for `surfacePoint`. */
export const needleFor = (mesh: Mesh) => new DropCutter(mesh, { kind: 'torus', R: 1e-5, rc: 0 })

export interface Ridge {
  /** Plan position of the ridge top. */
  x: number
  y: number
  /** Material left there, along the normal (mm). */
  h: number
}

/**
 * Ridges (cusps) along a plan line from (x0, y0) to (x1, y1): material left at points `step`
 * apart; a ridge is the highest point between two places the tool touched (left < `touch`).
 */
export function ridgesAlong(balls: SweptBalls, needle: DropCutter, mesh: Mesh, x0: number, y0: number, x1: number, y1: number, step: number, touch: number): Ridge[] {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step))
  const out: Ridge[] = []
  let touched = false
  let best: Ridge | null = null
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n
    const y = y0 + ((y1 - y0) * i) / n
    const sp = surfacePoint(needle, mesh, x, y)
    if (!sp) {
      touched = false
      best = null
      continue
    }
    const h = balls.entry(sp.p, sp.n)
    if (h < touch) {
      if (touched && best) out.push(best)
      touched = true
      best = null
    } else if (touched && (!best || h > best.h)) best = { x, y, h }
  }
  return out
}

export interface CrossRidge extends Ridge {
  /** Levels of the passes on either side (as the generator numbered them). */
  a: number
  b: number
}

/** Nearest pass to a plan point, from a grid of pass pieces. */
class PassIndex {
  private readonly bins = new Map<number, number[]>()
  private readonly segs: { x0: number; y0: number; x1: number; y1: number; level: number }[] = []
  private readonly cell = 2
  constructor(passes: { level: number; pts: { x: number; y: number }[] }[]) {
    for (const p of passes)
      for (let i = 1; i < p.pts.length; i++) {
        const s = { x0: p.pts[i - 1].x, y0: p.pts[i - 1].y, x1: p.pts[i].x, y1: p.pts[i].y, level: p.level }
        const k = this.segs.push(s) - 1
        for (let j = Math.floor(Math.min(s.y0, s.y1) / this.cell); j <= Math.floor(Math.max(s.y0, s.y1) / this.cell); j++)
          for (let ii = Math.floor(Math.min(s.x0, s.x1) / this.cell); ii <= Math.floor(Math.max(s.x0, s.x1) / this.cell); ii++) {
            const key = (j + 50000) * 100000 + ii + 50000
            let b = this.bins.get(key)
            if (!b) this.bins.set(key, (b = []))
            b.push(k)
          }
      }
  }
  nearest(x: number, y: number): { level: number; d: number } {
    let best = { level: NaN, d: Infinity }
    const ci = Math.floor(x / this.cell)
    const cj = Math.floor(y / this.cell)
    for (let j = cj - 1; j <= cj + 1; j++)
      for (let i = ci - 1; i <= ci + 1; i++)
        for (const k of this.bins.get((j + 50000) * 100000 + i + 50000) ?? []) {
          const s = this.segs[k]
          const dx = s.x1 - s.x0
          const dy = s.y1 - s.y0
          const L2 = dx * dx + dy * dy
          const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - s.x0) * dx + (y - s.y0) * dy) / L2)) : 0
          const d = Math.hypot(s.x0 + dx * t - x, s.y0 + dy * t - y)
          if (d < best.d) best = { level: s.level, d }
        }
    return best
  }
}

/**
 * Ridges between neighbouring passes, measured square (in plan) to each pass every `every` mm
 * along it (not within 1 mm of a sharp corner of the pass), on both sides: from where the tool touched at the pass, across the ridge, to where it
 * touched again (`touch`: material left below this counts as touched). Each ridge carries the
 * levels of the pass it starts from and the pass nearest where the walk touched again.
 */
export function crossRidges(balls: SweptBalls, mesh: Mesh, passes: { level: number; pts: { x: number; y: number }[] }[], o: { every: number; reach: number; step: number; touch: number }): CrossRidge[] {
  const needle = needleFor(mesh)
  const index = new PassIndex(passes)
  const out: CrossRidge[] = []
  const left = (x: number, y: number) => {
    const sp = surfacePoint(needle, mesh, x, y)
    return sp ? balls.entry(sp.p, sp.n) : NaN
  }
  for (const pass of passes) {
    // square to the pass is not defined at a sharp corner: no walk starts within 1 mm of one
    const corners: { x: number; y: number }[] = []
    const P = pass.pts
    const closed = P.length > 3 && Math.hypot(P[0].x - P[P.length - 1].x, P[0].y - P[P.length - 1].y) < 1e-6
    for (let i = closed ? 0 : 1; i + 1 < P.length; i++) {
      // (a closed pass's start is also a vertex: the one before it is the last but one)
      const prev = i === 0 ? P[P.length - 2] : P[i - 1]
      const a = Math.atan2(P[i].y - prev.y, P[i].x - prev.x)
      const b = Math.atan2(P[i + 1].y - P[i].y, P[i + 1].x - P[i].x)
      let d = Math.abs(b - a)
      if (d > Math.PI) d = 2 * Math.PI - d
      if (d > Math.PI / 6) corners.push(P[i])
    }
    const nearCorner = (x: number, y: number) => corners.some((c) => Math.hypot(c.x - x, c.y - y) < 1)
    let carry = 0
    for (let i = 1; i < pass.pts.length; i++) {
      const A = pass.pts[i - 1]
      const B = pass.pts[i]
      const L = Math.hypot(B.x - A.x, B.y - A.y)
      if (!(L > 0)) continue
      const nx = -(B.y - A.y) / L
      const ny = (B.x - A.x) / L
      for (let s = carry; s < L; s += o.every) {
        const px = A.x + ((B.x - A.x) * s) / L
        const py = A.y + ((B.y - A.y) * s) / L
        if (nearCorner(px, py)) continue
        for (const side of [1, -1]) {
          // from the pass: through the touched band, then the highest point until touched again
          let state = 0
          let best: Ridge | null = null
          for (let w = -balls.r; w <= o.reach; w += o.step) {
            const x = px + side * nx * w
            const y = py + side * ny * w
            const h = left(x, y)
            if (Number.isNaN(h)) break
            if (state === 0) {
              if (h < o.touch) state = 1
              else if (w > balls.r) break
            } else if (state === 1) {
              if (h >= o.touch) {
                state = 2
                best = { x, y, h }
              }
            } else if (h < o.touch) {
              const near = index.nearest(x, y)
              if (best) out.push({ ...best, a: pass.level, b: near.level })
              break
            } else if (h > best!.h) best = { x, y, h }
          }
        }
      }
      carry = (carry + Math.ceil((L - carry) / o.every) * o.every) - L
    }
  }
  return out
}
