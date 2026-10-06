/**
 * Toolpaths as drawn in the plan view (M3.1g): the same moves seen from above, simplified for the
 * screen so very large toolpaths (a Z-level roughing can hold half a million points) draw quickly.
 * Display only: the toolpath itself is never changed, and the simulator, the checks and every
 * program use the full moves.
 *
 * Each cutting run (straight feeds and chains one after another, up to a rapid, a drill point or
 * an arc) is simplified in plan (points closer than `tol` to the straight line drawn past them are
 * left out; every point kept is a real point of the toolpath). The tolerance
 * starts below anything visible and is raised only as far as needed to keep the drawing within a
 * point budget. Rapids, drill points and arcs are drawn as they are.
 */
import type { P } from './geom'
import type { Move, Toolpath } from './toolpath'

export interface DisplayOptions {
  /** Largest number of points drawn for one toolpath (default 60,000). */
  budget?: number
  /** Starting plan tolerance, mm (default 0.01: far below a pixel at any zoom the canvas uses). */
  tol?: number
  /** Never simplify more than this, mm (default 1). */
  maxTol?: number
}

export interface DisplayPaths {
  /** SVG path data of the cutting moves (feeds, arcs, chains). */
  cut: string
  /** SVG path data of the rapids that move in plan. */
  rapid: string
  drills: P[]
  /** Where the toolpath starts cutting. */
  start?: P
  /** Points in the toolpath's cutting moves, and how many are drawn. */
  total: number
  drawn: number
  /** Plan tolerance used, mm (0: drawn exactly). */
  tol: number
}

/** Points in a toolpath's moves (a chain counts each of its points). */
export function movePoints(moves: readonly Move[]): number {
  let n = 0
  for (const m of moves) n += m.t === 'poly' ? m.pts.length / 3 : 1
  return n
}

export function displayPaths(tp: Pick<Toolpath, 'moves'>, opt: DisplayOptions = {}): DisplayPaths {
  const budget = Math.max(1000, opt.budget ?? 60_000)
  const maxTol = Math.max(opt.tol ?? 0.01, opt.maxTol ?? 1)
  const total = movePoints(tp.moves)
  let tol = total > budget ? Math.max(0, opt.tol ?? 0.01) : 0
  let out = build(tp.moves, tol)
  // raise the tolerance until the drawing fits the budget (each round about halves the points)
  while (out.drawn > budget && tol < maxTol) {
    tol = Math.min(maxTol, Math.max(tol * 2.5, 0.01))
    out = build(tp.moves, tol)
  }
  return { ...out, total, tol }
}

const f = (n: number) => (Math.round(n * 1000) / 1000).toString()

function build(moves: readonly Move[], tol: number): Omit<DisplayPaths, 'total' | 'tol'> {
  const cut: string[] = []
  const rapid: string[] = []
  const drills: P[] = []
  let x = 0
  let y = 0
  let first = true
  let drawn = 0
  let start: P | undefined
  // the cutting run being collected: straight feeds and chains one after another, as a plan
  // polyline (a run ends at a rapid, a drill point or an arc)
  let xs: number[] = []
  let ys: number[] = []
  const add = (px: number, py: number) => {
    const n = xs.length
    if (n && Math.abs(xs[n - 1] - px) <= 1e-9 && Math.abs(ys[n - 1] - py) <= 1e-9) return
    xs.push(px)
    ys.push(py)
  }
  const flush = () => {
    if (xs.length >= 2) {
      const X = Float64Array.from(xs)
      const Y = Float64Array.from(ys)
      const keep = tol > 0 ? simplifyIdx(X, Y, tol) : null
      let d = ''
      for (let i = 0; i < X.length; i++) {
        if (keep && !keep[i]) continue
        d += `${d ? 'L' : 'M'}${f(X[i])} ${f(Y[i])}`
        drawn++
      }
      cut.push(d)
    }
    xs = []
    ys = []
  }
  for (const m of moves) {
    if (m.t === 'poly') {
      const p = m.pts
      if (!p.length) continue
      start ??= { x: p[0], y: p[1] }
      // the chain starts where the tool is
      if (!first) add(x, y)
      for (let i = 0; i < p.length; i += 3) add(p[i], p[i + 1])
      x = p[p.length - 3]
      y = p[p.length - 2]
      first = false
      continue
    }
    if (m.t === 'drill') {
      flush()
      drills.push({ x: m.x, y: m.y })
      start ??= { x: m.x, y: m.y }
      x = m.x
      y = m.y
      first = false
      drawn++
      continue
    }
    if (first) {
      x = m.x
      y = m.y
      first = false
      if (m.t !== 'rapid') start ??= { x: m.x, y: m.y }
      continue
    }
    if (m.t === 'rapid') {
      flush()
      if (Math.abs(m.x - x) > 1e-9 || Math.abs(m.y - y) > 1e-9) {
        rapid.push(`M${f(x)} ${f(y)}L${f(m.x)} ${f(m.y)}`)
        drawn += 2
      }
    } else if (m.t === 'feed') {
      start ??= { x: m.x, y: m.y }
      add(x, y)
      add(m.x, m.y)
    } else {
      flush()
      start ??= { x: m.x, y: m.y }
      const r = Math.hypot(x - m.cx, y - m.cy)
      const a0 = Math.atan2(y - m.cy, x - m.cx)
      let a1 = Math.atan2(m.y - m.cy, m.x - m.cx)
      if (m.ccw && a1 <= a0) a1 += 2 * Math.PI
      if (!m.ccw && a1 >= a0) a1 -= 2 * Math.PI
      cut.push(`M${f(x)} ${f(y)}A${f(r)} ${f(r)} 0 ${Math.abs(a1 - a0) > Math.PI ? 1 : 0} ${m.ccw ? 1 : 0} ${f(m.x)} ${f(m.y)}`)
      drawn += 2
    }
    x = m.x
    y = m.y
  }
  flush()
  return { cut: cut.join(''), rapid: rapid.join(''), drills, start, drawn }
}

/**
 * Which points of a plan polyline to keep so that no point left out is farther than `tol` from the
 * straight piece drawn past it (Douglas-Peucker, iterative). The ends are always kept.
 */
export function simplifyIdx(xs: Float64Array, ys: Float64Array, tol: number): Uint8Array {
  const n = xs.length
  const keep = new Uint8Array(n)
  if (n <= 2) {
    keep.fill(1)
    return keep
  }
  keep[0] = 1
  keep[n - 1] = 1
  const stack: number[] = [0, n - 1]
  const t2 = tol * tol
  while (stack.length) {
    const b = stack.pop()!
    const a = stack.pop()!
    const ax = xs[a]
    const ay = ys[a]
    const dx = xs[b] - ax
    const dy = ys[b] - ay
    const L2 = dx * dx + dy * dy
    let far = -1
    let fd = t2
    for (let k = a + 1; k < b; k++) {
      let ex = xs[k] - ax
      let ey = ys[k] - ay
      if (L2 > 0) {
        const t = Math.max(0, Math.min(1, (ex * dx + ey * dy) / L2))
        ex -= dx * t
        ey -= dy * t
      }
      const d2 = ex * ex + ey * ey
      if (d2 > fd) {
        fd = d2
        far = k
      }
    }
    if (far >= 0) {
      keep[far] = 1
      stack.push(a, far, far, b)
    }
  }
  return keep
}
