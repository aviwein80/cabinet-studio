/**
 * Small 2D geometric constraint solver (damped least squares).
 *
 * Unknowns are point coordinates and named scalars. Each constraint contributes residuals that
 * are zero when it holds. Each step is the minimum-norm Gauss-Newton move (damped when the
 * system is singular), so an under-constrained sketch moves as little as possible from where
 * it was drawn and the same input always gives the same answer (no branch flipping).
 */

export interface SPoint {
  id: string
  x: number
  y: number
  fixed?: boolean
}

export type Constraint =
  | { k: 'coincident'; a: string; b: string }
  | { k: 'horizontal'; a: string; b: string }
  | { k: 'vertical'; a: string; b: string }
  | { k: 'distance'; a: string; b: string; d: number | string }
  | { k: 'dx'; a: string; b: string; d: number | string }
  | { k: 'dy'; a: string; b: string; d: number | string }
  | { k: 'fix'; a: string; x: number; y: number }
  | { k: 'equal'; a: string; b: string; c: string; d: string }
  | { k: 'parallel'; a: string; b: string; c: string; d: string }
  | { k: 'perpendicular'; a: string; b: string; c: string; d: string }
  | { k: 'angle'; a: string; b: string; deg: number }
  /** |p - c| = r (r may be a scalar name). */
  | { k: 'onCircle'; p: string; c: string; r: number | string }
  | { k: 'onLine'; p: string; a: string; b: string }
  /** Two circles touch: |c1 - c2| = r1 + r2 (outside) or |r1 - r2| (inside). */
  | { k: 'tangentCircles'; c1: string; r1: number | string; c2: string; r2: number | string; inside?: boolean }
  /** Scalar relation: value(a) = factor * value(b) + offset. */
  | { k: 'ratio'; a: string; b: string; factor: number; offset?: number }
  /** b = a + len (cos ang, sin ang), `ang` in degrees: a straight element of a chain (CAD-02). */
  | { k: 'polar'; a: string; b: string; len: number | string; ang: number | string }
  /**
   * b is the end of an arc that starts at a heading `ang` (degrees), with radius `r` and sweep
   * `sweep` (degrees, 0-360), turning left (`ccw`) or right: an arc element of a chain (CAD-02).
   */
  | { k: 'chord'; a: string; b: string; ang: number | string; r: number | string; sweep: number | string; ccw: boolean }
  /** Linear relation between scalars: sum of coefficient x value = `value` (headings along a chain). */
  | { k: 'lin'; terms: { v: number | string; c: number }[]; value: number }

export interface Sketch {
  points: SPoint[]
  /** Free scalar unknowns (e.g. radii) with starting values. */
  scalars?: Record<string, number>
  constraints: Constraint[]
}

export interface SolveResult {
  points: Record<string, { x: number; y: number }>
  scalars: Record<string, number>
  ok: boolean
  /** Root-mean-square residual at the end. */
  residual: number
  iterations: number
  /** Remaining degrees of freedom (unknowns minus independent equations). */
  dof: number
  /** Constraints that still do not hold (over-constrained or impossible). */
  failing: number[]
}

const rad = (d: number) => (d * Math.PI) / 180

export function solve(sk: Sketch, opts: { tol?: number; maxIter?: number } = {}): SolveResult {
  const tol = opts.tol ?? 1e-10
  const maxIter = opts.maxIter ?? 200
  const idx = new Map<string, number>()
  const x0: number[] = []
  for (const p of sk.points) {
    if (p.fixed) continue
    idx.set(`${p.id}.x`, x0.length)
    x0.push(p.x)
    idx.set(`${p.id}.y`, x0.length)
    x0.push(p.y)
  }
  for (const [k, v] of Object.entries(sk.scalars ?? {})) {
    idx.set(`$${k}`, x0.length)
    x0.push(v)
  }
  const fixedP = new Map(sk.points.filter((p) => p.fixed).map((p) => [p.id, p]))
  const pointsById = new Map(sk.points.map((p) => [p.id, p]))
  for (const c of sk.constraints)
    for (const id of refs(c)) if (!pointsById.has(id)) throw new Error(`Constraint ${c.k} refers to unknown point ${id}`)

  const P = (x: number[], id: string) => {
    const f = fixedP.get(id)
    if (f) return { x: f.x, y: f.y }
    return { x: x[idx.get(`${id}.x`)!], y: x[idx.get(`${id}.y`)!] }
  }
  const S = (x: number[], v: number | string) => (typeof v === 'number' ? v : x[idx.get(`$${v}`) ?? -1] ?? Number(sk.scalars?.[v] ?? NaN))

  const residuals = (x: number[]): number[][] =>
    sk.constraints.map((c) => {
      switch (c.k) {
        case 'coincident': {
          const a = P(x, c.a)
          const b = P(x, c.b)
          return [a.x - b.x, a.y - b.y]
        }
        case 'horizontal':
          return [P(x, c.a).y - P(x, c.b).y]
        case 'vertical':
          return [P(x, c.a).x - P(x, c.b).x]
        case 'distance': {
          const a = P(x, c.a)
          const b = P(x, c.b)
          return [Math.hypot(b.x - a.x, b.y - a.y) - S(x, c.d)]
        }
        case 'dx':
          return [P(x, c.b).x - P(x, c.a).x - S(x, c.d)]
        case 'dy':
          return [P(x, c.b).y - P(x, c.a).y - S(x, c.d)]
        case 'fix': {
          const a = P(x, c.a)
          return [a.x - c.x, a.y - c.y]
        }
        case 'equal': {
          const [a, b, cc, d] = [P(x, c.a), P(x, c.b), P(x, c.c), P(x, c.d)]
          return [Math.hypot(b.x - a.x, b.y - a.y) - Math.hypot(d.x - cc.x, d.y - cc.y)]
        }
        case 'parallel':
        case 'perpendicular': {
          const [a, b, cc, d] = [P(x, c.a), P(x, c.b), P(x, c.c), P(x, c.d)]
          const u = { x: b.x - a.x, y: b.y - a.y }
          const v = { x: d.x - cc.x, y: d.y - cc.y }
          const lu = Math.hypot(u.x, u.y) || 1
          const lv = Math.hypot(v.x, v.y) || 1
          return [c.k === 'parallel' ? (u.x * v.y - u.y * v.x) / (lu * lv) : (u.x * v.x + u.y * v.y) / (lu * lv)]
        }
        case 'angle': {
          const a = P(x, c.a)
          const b = P(x, c.b)
          const t = rad(c.deg)
          const l = Math.hypot(b.x - a.x, b.y - a.y) || 1
          return [((b.x - a.x) * Math.sin(t) - (b.y - a.y) * Math.cos(t)) / l]
        }
        case 'onCircle': {
          const p = P(x, c.p)
          const o = P(x, c.c)
          return [Math.hypot(p.x - o.x, p.y - o.y) - S(x, c.r)]
        }
        case 'onLine': {
          const [p, a, b] = [P(x, c.p), P(x, c.a), P(x, c.b)]
          const l = Math.hypot(b.x - a.x, b.y - a.y) || 1
          return [((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / l]
        }
        case 'tangentCircles': {
          const a = P(x, c.c1)
          const b = P(x, c.c2)
          const r1 = S(x, c.r1)
          const r2 = S(x, c.r2)
          return [Math.hypot(b.x - a.x, b.y - a.y) - (c.inside ? Math.abs(r1 - r2) : r1 + r2)]
        }
        case 'ratio':
          return [S(x, c.a) - (c.factor * S(x, c.b) + (c.offset ?? 0))]
        case 'polar': {
          const a = P(x, c.a)
          const b = P(x, c.b)
          const L = S(x, c.len)
          const t = rad(S(x, c.ang))
          return [b.x - a.x - L * Math.cos(t), b.y - a.y - L * Math.sin(t)]
        }
        case 'chord': {
          const a = P(x, c.a)
          const b = P(x, c.b)
          const sw = rad(S(x, c.sweep))
          const t = rad(S(x, c.ang)) + (c.ccw ? sw / 2 : -sw / 2)
          const L = 2 * S(x, c.r) * Math.sin(sw / 2)
          return [b.x - a.x - L * Math.cos(t), b.y - a.y - L * Math.sin(t)]
        }
        case 'lin':
          return [c.terms.reduce((n, t) => n + t.c * S(x, t.v), 0) - c.value]
      }
    })
  const flat = (x: number[]) => residuals(x).flat()

  let x = [...x0]
  let r = flat(x)
  let cost = dot(r, r)
  let lambda = 1e-9
  let it = 0
  const n = x.length
  const m = r.length
  for (; it < maxIter && n > 0 && Math.sqrt(cost / Math.max(1, m)) > tol; it++) {
    const J = jacobian(flat, x, r)
    // minimum-norm step: dx = -Jᵀ (J Jᵀ + λI)⁻¹ r, the smallest move that satisfies the linearised constraints
    const JJt: number[][] = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, k) => dot(J[i], J[k])))
    let improved = false
    for (let tries = 0; tries < 16; tries++) {
      const M = JJt.map((row, i) => row.map((v, k) => v + (i === k ? lambda * (1 + JJt[i][i]) : 0)))
      const y = solveLinear(M, r)
      if (!y) {
        lambda = Math.max(lambda * 10, 1e-12)
        continue
      }
      const dx = new Array(n).fill(0)
      for (let i = 0; i < m; i++) if (y[i]) for (let j = 0; j < n; j++) dx[j] -= J[i][j] * y[i]
      const xn = x.map((v, i) => v + dx[i])
      const rn = flat(xn)
      const cn = dot(rn, rn)
      if (cn < cost) {
        x = xn
        r = rn
        cost = cn
        lambda = Math.max(1e-12, lambda / 10)
        improved = true
        break
      }
      lambda = Math.max(lambda * 10, 1e-12)
    }
    if (!improved) break
  }

  const res = residuals(x)
  const failing = res.map((v, i) => (v.some((q) => Math.abs(q) > Math.max(1e-6, tol * 1e3)) ? i : -1)).filter((i) => i >= 0)
  const J = n ? jacobian(flat, x, flat(x)) : []
  const dof = n - rank(J)
  const points: SolveResult['points'] = {}
  for (const p of sk.points) points[p.id] = P(x, p.id)
  const scalars: Record<string, number> = {}
  for (const k of Object.keys(sk.scalars ?? {})) scalars[k] = x[idx.get(`$${k}`)!]
  const rms = Math.sqrt(cost / Math.max(1, r.length))
  return { points, scalars, ok: failing.length === 0, residual: rms, iterations: it, dof, failing }
}

function refs(c: Constraint): string[] {
  switch (c.k) {
    case 'fix':
      return [c.a]
    case 'onCircle':
      return [c.p, c.c]
    case 'onLine':
      return [c.p, c.a, c.b]
    case 'tangentCircles':
      return [c.c1, c.c2]
    case 'ratio':
    case 'lin':
      return []
    case 'equal':
    case 'parallel':
    case 'perpendicular':
      return [c.a, c.b, c.c, c.d]
    default:
      return [c.a, c.b]
  }
}

const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0)

function jacobian(f: (x: number[]) => number[], x: number[], r: number[]): number[][] {
  const J: number[][] = r.map(() => new Array(x.length).fill(0))
  for (let j = 0; j < x.length; j++) {
    const h = 1e-7 * Math.max(1, Math.abs(x[j]))
    const xp = [...x]
    xp[j] += h
    const xm = [...x]
    xm[j] -= h
    const rp = f(xp)
    const rm = f(xm)
    for (let i = 0; i < r.length; i++) J[i][j] = (rp[i] - rm[i]) / (2 * h)
  }
  return J
}

/** Gaussian elimination with partial pivoting; null when singular. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-300) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c]
      if (!f) continue
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  const out = new Array(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n]
    for (let k = r + 1; k < n; k++) s -= M[r][k] * out[k]
    out[r] = s / M[r][r]
  }
  return out
}

function rank(J: number[][]): number {
  if (!J.length) return 0
  const M = J.map((row) => [...row])
  const rows = M.length
  const cols = M[0].length
  const scale = Math.max(1e-12, ...M.flat().map(Math.abs))
  let rk = 0
  for (let c = 0; c < cols && rk < rows; c++) {
    let p = rk
    for (let r = rk + 1; r < rows; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-7 * scale) continue
    ;[M[rk], M[p]] = [M[p], M[rk]]
    for (let r = rk + 1; r < rows; r++) {
      const f = M[r][c] / M[rk][c]
      for (let k = c; k < cols; k++) M[r][k] -= f * M[rk][k]
    }
    rk++
  }
  return rk
}
