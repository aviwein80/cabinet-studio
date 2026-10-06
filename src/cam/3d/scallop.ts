/**
 * Scallop finishing (3D-07): passes offset across the surface so the cusp (the ridge of material
 * left between two neighbouring passes) has the same height everywhere, on slopes and over curves
 * as much as on flat ground.
 *
 * How it works (our own method, on the tool-centre surface):
 *
 * 1. The tool-centre (CL) surface on a grid of exact drops.
 * 2. A distance field T on that surface, measured in 3D along it (not in plan), from the start:
 *    the boundary (passes work in from it) or picked start curves (passes work out from them on
 *    both sides). It is solved with a fast-marching pass over the grid triangles followed by
 *    sweeps until it settles, so it is the true shortest distance over the triangulated surface.
 * 3. The spacing that gives the target cusp at each point. On a flat the cusp of a ball of radius
 *    R with passes d apart is R - sqrt(R² - d²/4). Over a curve the chord between two passes
 *    sags below (convex) or rises above (concave) the tool-centre surface, which lowers or raises
 *    the cusp; the sag is measured with exact drops across the passes (the direction T grows in)
 *    and the spacing solved so the cusp comes out at the target. T is then solved again with
 *    that spacing, so one unit of T is one pass.
 * 4. Passes are the level lines T = 0, 1, 2, ..., each dropped onto the model exactly and refined
 *    like every other strategy (`passes.ts`), so the tool cannot dig in beyond the tolerance.
 *    Where an island of the field closes before the next whole level, a pass halfway to its top
 *    is added, so the last gap is never wider than one spacing.
 *
 * Ball-nose tools get the exact cusp; a bull-nose is spaced for its corner radius (the cusp is
 * then at most the target, smaller where its flat bottom does the cutting). Flat end mills and
 * V cutters are refused.
 */
import { checkCancel, type Work } from '@/core/cancel'
import type { P } from '../geom'
import type { Mesh } from '../mesh/types'
import type { Finish3dOp, Levels } from '../types'
import type { Pt } from './chain'
import type { Cutter3D } from './cutter'
import { type Finish3dResult, LINK_STEPOVERS } from './parallel'
import { chainMoves, chainsAlong, clipPolyline, type Sampler, surfaceSampler } from './passes'
import { insideRegion, polysBox, type Region } from './region'

/** Level given to crease passes for ordering (after every whole level going in). */
const CREASE_LEVEL = 1e9
/** Level given to repair passes (after the creases going in). */
const REPAIR_LEVEL = 2e9
/** Material farther than this from every pass (in spacings) gets a repair pass. */
const GAP = 0.505
const REPAIR_ROUNDS = 3
/** Grid nodes at most (the grid gets coarser for big areas). */
const MAX_NODES = 1_500_000
/** Fronts meeting at more than this angle (cosine of it) make a crease that gets its own pass. */
const CREASE = Math.cos((30 * Math.PI) / 180)
/** Fronts meeting head on (cosine of the angle between them below this): the ridge stays level. */
const HEAD_ON = Math.cos((140 * Math.PI) / 180)
/** Spacing never drops below / rises above this share of the flat spacing. */
const SPACING_MIN = 0.3
const SPACING_MAX = 3

/** Cusp height on a flat of a ball (or corner) radius r with passes d apart. */
export function flatCusp(r: number, d: number): number {
  return r - Math.sqrt(Math.max(0, r * r - (d * d) / 4))
}

/**
 * Pass spacing (3D, along the tool-centre surface) that leaves cusp `h` with tool radius `r`,
 * where a chord of length `d0` sags `s0` below the tool-centre surface (negative: rises above it).
 * The sag grows with the square of the chord.
 */
export function cuspSpacing(r: number, h: number, d0: number, s0: number): number {
  const q0 = (d0 * d0) / 4
  const k = q0 > 0 ? s0 / q0 : 0
  const a = r - h
  // sqrt(r² - q) = a - k q  ->  k² q² + (1 - 2 a k) q + (a² - r²) = 0
  const A = k * k
  const B = 1 - 2 * a * k
  const C = a * a - r * r
  let q: number
  if (Math.abs(A) < 1e-15) q = -C / B
  else {
    const disc = B * B - 4 * A * C
    if (disc < 0) return NaN
    // the root with a - k q >= 0 (the cusp point below the chord): the smaller positive one
    const r1 = (-B - Math.sqrt(disc)) / (2 * A)
    const r2 = (-B + Math.sqrt(disc)) / (2 * A)
    const ok = [r1, r2].filter((x) => x > 0 && a - k * x >= -1e-12).sort((x, y) => x - y)
    if (!ok.length) return NaN
    q = ok[0]
  }
  return q > 0 ? 2 * Math.sqrt(q) : NaN
}

/** Neighbours counter-clockwise from +X. */
const NB: [number, number][] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
]

/** Arrival directions closer than this (cosine) count as one front. */
const AGREE = 0.8

/** Binary min-heap of node ids keyed by a value (stale entries are skipped by the caller). */
class Heap {
  private ids: number[] = []
  private keys: number[] = []
  get size() {
    return this.ids.length
  }
  push(id: number, key: number) {
    const ids = this.ids
    const keys = this.keys
    let i = ids.length
    ids.push(id)
    keys.push(key)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (keys[p] <= key) break
      ids[i] = ids[p]
      keys[i] = keys[p]
      i = p
    }
    ids[i] = id
    keys[i] = key
  }
  pop(): [number, number] {
    const ids = this.ids
    const keys = this.keys
    const top: [number, number] = [ids[0], keys[0]]
    const lastId = ids.pop()!
    const lastKey = keys.pop()!
    const n = ids.length
    if (n) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        if (l >= n) break
        const r = l + 1
        const c = r < n && keys[r] < keys[l] ? r : l
        if (keys[c] >= lastKey) break
        ids[i] = ids[c]
        keys[i] = keys[c]
        i = c
      }
      ids[i] = lastId
      keys[i] = lastKey
    }
    return top
  }
}

/** Node states. */
const FAR = 0
const TRIAL = 1
const DONE = 2
/** Not part of the surface (outside the region, or no model under the tool). */
const OUT = 3

/**
 * Distance (in passes) over the tool-centre surface on a grid: `z` per node (NaN = no surface),
 * `speed` = 1 / spacing per node, seeds with their starting values.
 */
export class SurfaceField {
  readonly T: Float64Array
  readonly state: Uint8Array
  /**
   * Plan direction the shortest path arrives from, per node. A triangle update interpolates T
   * between two neighbours only when their directions agree: across a crease, where fronts from
   * different sides meet, T is not linear and interpolating there would under-read it.
   */
  readonly dx: Float32Array
  readonly dy: Float32Array
  private bx = 0
  private by = 0
  private readonly ids = new Int32Array(8)
  readonly nx: number
  readonly ny: number
  readonly h: number
  readonly z: Float64Array
  readonly open: Uint8Array
  constructor(nx: number, ny: number, h: number, z: Float64Array, open: Uint8Array) {
    this.nx = nx
    this.ny = ny
    this.h = h
    this.z = z
    this.open = open
    this.T = new Float64Array(nx * ny).fill(Infinity)
    this.state = new Uint8Array(nx * ny)
    this.dx = new Float32Array(nx * ny)
    this.dy = new Float32Array(nx * ny)
  }

  /**
   * Smallest T at node p from its neighbours' current values (edges and the 8 triangles); the
   * direction it arrives from is left in (bx, by).
   */
  private update(p: number, speed: number, known: (q: number) => boolean): number {
    const { nx, h, z, T } = this
    const i = p % nx
    const j = (p - i) / nx
    const zp = z[p]
    let best = Infinity
    this.bx = 0
    this.by = 0
    const ids = this.ids
    ids.fill(-1)
    for (let k = 0; k < 8; k++) {
      const ii = i + NB[k][0]
      const jj = j + NB[k][1]
      if (ii < 0 || jj < 0 || ii >= nx || jj >= this.ny) continue
      const q = jj * nx + ii
      if (!known(q)) continue
      ids[k] = q
      const dz = zp - z[q]
      const len = Math.sqrt((NB[k][0] * NB[k][0] + NB[k][1] * NB[k][1]) * h * h + dz * dz)
      const v = T[q] + len * speed
      if (v < best) {
        best = v
        const l = Math.hypot(NB[k][0], NB[k][1])
        this.bx = -NB[k][0] / l
        this.by = -NB[k][1] / l
      }
    }
    for (let k = 0; k < 8; k++) {
      const a = ids[k]
      const b = ids[(k + 1) & 7]
      if (a < 0 || b < 0) continue
      // (both arrived the same way: not across a crease; seeds without a direction always agree)
      const ma = this.dx[a] * this.dx[a] + this.dy[a] * this.dy[a]
      const mb = this.dx[b] * this.dx[b] + this.dy[b] * this.dy[b]
      if (ma > 0.25 && mb > 0.25 && this.dx[a] * this.dx[b] + this.dy[a] * this.dy[b] < AGREE * Math.sqrt(ma * mb)) continue
      // w = Xp - Xb, v = Xa - Xb (plan in cells, z in mm)
      const ka = NB[k]
      const kb = NB[(k + 1) & 7]
      const wx = -kb[0] * h
      const wy = -kb[1] * h
      const wz = zp - z[b]
      const vx = (ka[0] - kb[0]) * h
      const vy = (ka[1] - kb[1]) * h
      const vz = z[a] - z[b]
      const A = vx * vx + vy * vy + vz * vz
      const B = wx * vx + wy * vy + wz * vz
      const C = wx * wx + wy * wy + wz * wz
      const g = (T[b] - T[a]) / speed
      if (A <= g * g) continue
      const lam = (B + g * Math.sqrt(Math.max(0, (A * C - B * B) / (A - g * g)))) / A
      if (!(lam > 0 && lam < 1)) continue
      const ex = wx - lam * vx
      const ey = wy - lam * vy
      const ez = wz - lam * vz
      const v = lam * T[a] + (1 - lam) * T[b] + Math.sqrt(ex * ex + ey * ey + ez * ez) * speed
      if (v < best) {
        best = v
        const l = Math.hypot(ex, ey)
        this.bx = l > 0 ? ex / l : 0
        this.by = l > 0 ? ey / l : 0
      }
    }
    return best
  }

  /**
   * Solve from the seeds (node -> T and the plan direction away from the start there);
   * `speed(p)` = 1 / spacing at node p.
   */
  solve(seeds: Map<number, { t: number; dx: number; dy: number }>, speed: (p: number) => number, work?: Work) {
    const { T, state, open } = this
    const n = T.length
    T.fill(Infinity)
    this.dx.fill(0)
    this.dy.fill(0)
    for (let p = 0; p < n; p++) state[p] = open[p] ? FAR : OUT
    const heap = new Heap()
    for (const [p, sd] of seeds) {
      if (state[p] === OUT) continue
      if (sd.t < T[p]) {
        T[p] = sd.t
        this.dx[p] = sd.dx
        this.dy[p] = sd.dy
      }
      state[p] = TRIAL
      heap.push(p, T[p])
    }
    const done = (q: number) => state[q] === DONE
    let count = 0
    while (heap.size) {
      const [p, t] = heap.pop()
      if (state[p] === DONE || t > T[p]) continue
      state[p] = DONE
      if ((++count & 65535) === 0) checkCancel(work?.isCancelled)
      const i = p % this.nx
      const j = (p - i) / this.nx
      for (const [di, dj] of NB) {
        const ii = i + di
        const jj = j + dj
        if (ii < 0 || jj < 0 || ii >= this.nx || jj >= this.ny) continue
        const q = jj * this.nx + ii
        if (state[q] === DONE || state[q] === OUT) continue
        const v = this.update(q, speed(q), done)
        if (v < T[q]) {
          T[q] = v
          this.dx[q] = this.bx
          this.dy[q] = this.by
          state[q] = TRIAL
          heap.push(q, v)
        }
      }
    }
    // sweeps in the four diagonal orders until nothing improves (obtuse triangles on steep
    // ground can make the marching order not quite right)
    const finite = (q: number) => state[q] !== OUT && Number.isFinite(T[q])
    for (let round = 0; round < 12; round++) {
      checkCancel(work?.isCancelled)
      let changed = 0
      for (const [si, sj] of [
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ]) {
        for (let jj = 0; jj < this.ny; jj++) {
          const j = sj > 0 ? jj : this.ny - 1 - jj
          for (let ii = 0; ii < this.nx; ii++) {
            const i = si > 0 ? ii : this.nx - 1 - ii
            const p = j * this.nx + i
            if (state[p] === OUT) continue
            const v = this.update(p, speed(p), finite)
            if (v < T[p] - 1e-12) {
              T[p] = v
              this.dx[p] = this.bx
              this.dy[p] = this.by
              changed++
            }
          }
        }
      }
      if (!changed) break
    }
  }
}

/** One polyline of a level line; `closed` when it comes back to its start. */
export interface LevelPolyline {
  pts: P[]
  closed: boolean
}

/**
 * Level lines of a grid field at `level` (marching squares; NaN nodes end the lines). Each line
 * keeps the higher side on its left, so a line round a hill runs counter-clockwise.
 */
export function levelLines(
  T: Float64Array,
  nx: number,
  ny: number,
  x0: number,
  y0: number,
  h: number,
  level: number,
  cells?: ArrayLike<number>,
  /** Where along the edge p -> q (0..1) the line crosses, when not by straight interpolation. */
  crossing?: (p: number, q: number, level: number) => number,
): LevelPolyline[] {
  // crossing point on each cell edge, by edge id: 2 * node (+0 the edge to +X, +1 the edge to +Y)
  const pointOf = (e: number): P => {
    const p = e >> 1
    const i = p % nx
    const j = (p - i) / nx
    const q = e & 1 ? p + nx : p + 1
    const t = crossing ? crossing(p, q, level) : (level - T[p]) / (T[q] - T[p])
    return e & 1 ? { x: x0 + i * h, y: y0 + (j + t) * h } : { x: x0 + (i + t) * h, y: y0 + j * h }
  }
  const next = new Map<number, number>()
  const hasPrev = new Set<number>()
  const nCells = cells ? cells.length : (nx - 1) * (ny - 1)
  for (let ci = 0; ci < nCells; ci++) {
    {
      const p = cells ? cells[ci] : Math.floor(ci / (nx - 1)) * nx + (ci % (nx - 1))
      const a = T[p]
      const b = T[p + 1]
      const c = T[p + nx + 1]
      const d = T[p + nx]
      if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(d)) continue
      const code = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0)
      if (code === 0 || code === 15) continue
      // edges: bottom (p, +X), right (p+1, +Y), top (p+nx, +X), left (p, +Y)
      const eb = 2 * p
      const er = 2 * (p + 1) + 1
      const et = 2 * (p + nx)
      const el = 2 * p + 1
      const seg = (from: number, to: number) => {
        next.set(from, to)
        hasPrev.add(to)
      }
      // each segment runs with the high corners on its left
      switch (code) {
        case 1:
          seg(el, eb)
          break
        case 2:
          seg(eb, er)
          break
        case 3:
          seg(el, er)
          break
        case 4:
          seg(er, et)
          break
        case 6:
          seg(eb, et)
          break
        case 7:
          seg(el, et)
          break
        case 8:
          seg(et, el)
          break
        case 9:
          seg(et, eb)
          break
        case 11:
          seg(et, er)
          break
        case 12:
          seg(er, el)
          break
        case 13:
          seg(er, eb)
          break
        case 14:
          seg(eb, el)
          break
        case 5:
        case 10: {
          const mid = (a + b + c + d) / 4 > level
          if (code === 5) {
            if (mid) {
              seg(el, et)
              seg(er, eb)
            } else {
              seg(el, eb)
              seg(er, et)
            }
          } else if (mid) {
            seg(eb, el)
            seg(et, er)
          } else {
            seg(eb, er)
            seg(et, el)
          }
          break
        }
      }
    }
  }
  const out: LevelPolyline[] = []
  const used = new Set<number>()
  const walk = (start: number) => {
    const ids = [start]
    used.add(start)
    let e = next.get(start)
    while (e !== undefined && !used.has(e)) {
      ids.push(e)
      used.add(e)
      e = next.get(e)
    }
    const closed = e === start
    out.push({ pts: ids.map(pointOf), closed })
  }
  // open lines first (from their starts), then loops
  for (const s of next.keys()) if (!hasPrev.has(s) && !used.has(s)) walk(s)
  for (const s of next.keys()) if (!used.has(s)) walk(s)
  return out.filter((l) => l.pts.length >= 2)
}

/** Douglas-Peucker in plan (closed lines keep their start). */
export function simplifyPlan(pts: P[], tol: number): P[] {
  if (pts.length <= 2) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = 1
  keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const A = pts[a]
    const B = pts[b]
    const dx = B.x - A.x
    const dy = B.y - A.y
    const L2 = dx * dx + dy * dy
    let far = -1
    let fd = tol
    for (let k = a + 1; k < b; k++) {
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((pts[k].x - A.x) * dx + (pts[k].y - A.y) * dy) / L2)) : 0
      const d = Math.hypot(A.x + dx * t - pts[k].x, A.y + dy * t - pts[k].y)
      if (d > fd) {
        fd = d
        far = k
      }
    }
    if (far >= 0) {
      keep[far] = 1
      stack.push([a, far], [far, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

/** Nearest point on the edges of polygons (closed) or polylines (open) to p. */
function nearestOn(lines: { pts: P[]; closed: boolean }[], p: P): { q: P; d: number } {
  let best: P = p
  let bd = Infinity
  for (const l of lines) {
    const n = l.pts.length
    const m = l.closed ? n : n - 1
    for (let k = 0; k < m; k++) {
      const a = l.pts[k]
      const b = l.pts[(k + 1) % n]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const L2 = dx * dx + dy * dy
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0
      const q = { x: a.x + dx * t, y: a.y + dy * t }
      const d = Math.hypot(q.x - p.x, q.y - p.y)
      if (d < bd) {
        bd = d
        best = q
      }
    }
  }
  return { q: best, d: bd }
}

export interface ScallopResult extends Finish3dResult {
  /** Target cusp height (mm). */
  cusp: number
  /** The passes in plan with their level (for tests and drawing). */
  passes: { level: number; pts: P[]; closed: boolean }[]
}

export function scallopFinish(op: Finish3dOp, mesh: Mesh, cutter: Cutter3D, region: Region, levels: Levels, starts: { pts: P[]; closed: boolean }[] = [], work?: Work): ScallopResult {
  const none = (w: string, cusp = 0): ScallopResult => ({ moves: [], warnings: [w], minZ: NaN, spacing: 0, cusp, passes: [] })
  if (cutter.kind === 'v' || cutter.rc <= 1e-9) return none('Scallop finishing needs a ball-nose or bull-nose tool: the cusp comes from the rounded end.')
  const smp = surfaceSampler(op, mesh, cutter)
  if ('error' in smp) return none(smp.error)
  // the rounded part that leaves the cusp (grown by the stock to leave)
  const r = cutter.rc + smp.s
  const step = Math.max(0.01, op.stepover)
  if (step >= 2 * r * 0.98) return none(`The step-over (${step} mm) must be less than the ${cutter.rc < cutter.R ? 'corner ' : ''}diameter of the tool's rounded end (${(2 * cutter.rc).toFixed(2)} mm).`)
  const cusp = flatCusp(r, step)
  const warnings: string[] = []
  if (cutter.rc < cutter.R - 1e-9) warnings.push(`Bull-nose: passes are spaced for its ${cutter.rc} mm corner radius, so the cusp is at most ${cusp.toFixed(4)} mm (less where the flat bottom cuts).`)
  const seedLines = starts.length ? starts : region.polys.map((p) => ({ pts: p, closed: true }))
  if (!region.polys.length) return none('The boundary is empty.', cusp)

  // 1. grid of exact drops
  const box = polysBox(region.polys)
  let h = Math.min(0.5, Math.max(0.05, step / 4))
  const pad = 2
  const area = (box.maxX - box.minX + 2 * pad * h) * (box.maxY - box.minY + 2 * pad * h)
  if (area / (h * h) > MAX_NODES) h = Math.sqrt(area / MAX_NODES)
  const x0 = box.minX - pad * h
  const y0 = box.minY - pad * h
  const nx = Math.ceil((box.maxX - box.minX) / h) + 2 * pad + 1
  const ny = Math.ceil((box.maxY - box.minY) / h) + 2 * pad + 1
  const N = nx * ny
  const z = new Float64Array(N)
  const inside = new Uint8Array(N)
  const open = new Uint8Array(N)
  const dc = smp.dc
  for (let j = 0; j < ny; j++) {
    if ((j & 15) === 0) {
      checkCancel(work?.isCancelled)
      work?.progress?.(0.25 * (j / ny), 'Tool-centre surface')
    }
    for (let i = 0; i < nx; i++) {
      const p = j * nx + i
      const pt = { x: x0 + i * h, y: y0 + j * h }
      inside[p] = insideRegion(region, pt) ? 1 : 0
      if (dc.drop(pt.x, pt.y)) z[p] = dc.z
      else z[p] = NaN
      // boundary start: only the region takes part; start curves: the whole grid (passes are
      // clipped to the region afterwards)
      open[p] = Number.isFinite(z[p]) && (starts.length ? 1 : inside[p]) ? 1 : 0
    }
  }
  const field = new SurfaceField(nx, ny, h, z, open)
  const node = (p: number): P => ({ x: x0 + (p % nx) * h, y: y0 + Math.floor(p / nx) * h })

  // seeds: nodes next to the start lines, at their 3D distance from the nearest point on them
  const seedOf = (spacing: (p: number) => number) => {
    const seeds = new Map<number, { t: number; dx: number; dy: number }>()
    for (let p = 0; p < N; p++) {
      if (!open[p]) continue
      const a = node(p)
      const { q, d } = nearestOn(seedLines, a)
      if (d > 1.5 * h) continue
      const zq = dc.drop(q.x, q.y) ? dc.z : z[p]
      seeds.set(p, { t: Math.hypot(d, z[p] - zq) / spacing(p), dx: d > 1e-9 ? (a.x - q.x) / d : 0, dy: d > 1e-9 ? (a.y - q.y) / d : 0 })
    }
    return seeds
  }

  // 2. distance with the flat spacing, to find which way the passes run
  work?.progress?.(0.3, 'Distance over the surface')
  field.solve(seedOf(() => step), () => 1 / step, work)
  const T1 = Float64Array.from(field.T)

  // 3. spacing for the target cusp, from the sag across the passes (exact drops), on a coarser
  // lattice and spread to every node
  work?.progress?.(0.45, 'Spacing for the cusp')
  const m = Math.max(1, Math.round(step / (2 * h)))
  const cnx = Math.ceil((nx - 1) / m) + 1
  const cny = Math.ceil((ny - 1) / m) + 1
  const coarse = new Float64Array(cnx * cny).fill(NaN)
  const zAt = (x: number, y: number) => (dc.drop(x, y) ? dc.z : NaN)
  for (let cj = 0; cj < cny; cj++) {
    if ((cj & 7) === 0) checkCancel(work?.isCancelled)
    for (let ci = 0; ci < cnx; ci++) {
      const i = Math.min(nx - 1, ci * m)
      const j = Math.min(ny - 1, cj * m)
      const p = j * nx + i
      if (!open[p] || !Number.isFinite(T1[p])) continue
      // direction the passes are spaced in: T's gradient in plan
      const tx = grad(T1, open, nx, ny, i, j, 1, 0) / h
      const ty = grad(T1, open, nx, ny, i, j, 0, 1) / h
      const gl = Math.hypot(tx, ty)
      if (!(gl > 0)) continue
      const ux = tx / gl
      const uy = ty / gl
      const zx = grad(z, open, nx, ny, i, j, 1, 0) / h
      const zy = grad(z, open, nx, ny, i, j, 0, 1) / h
      const g = zx * ux + zy * uy
      const a = step / 2 / Math.sqrt(1 + g * g)
      const pt = node(p)
      // (only where both ends are inside: past the edge of a model the tool rolls off it, which
      // would read as a hill)
      const pm = { x: pt.x - a * ux, y: pt.y - a * uy }
      const pp = { x: pt.x + a * ux, y: pt.y + a * uy }
      if (!insideRegion(region, pm, 1e-6) || !insideRegion(region, pp, 1e-6)) continue
      const zm = zAt(pm.x, pm.y)
      const zp = zAt(pp.x, pp.y)
      if (!Number.isFinite(zm) || !Number.isFinite(zp)) continue
      const D0 = Math.hypot(2 * a, zp - zm)
      // sag of the chord below the surface, square to the chord
      const s0 = (z[p] - (zm + zp) / 2) * ((2 * a) / D0)
      const d = cuspSpacing(r, cusp, D0, s0)
      coarse[cj * cnx + ci] = Number.isFinite(d) ? Math.max(SPACING_MIN * step, Math.min(SPACING_MAX * step, d, 1.9 * r)) : SPACING_MIN * step
    }
  }
  const spacing = new Float64Array(N)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      // bilinear between the lattice points that have a value
      const fx = i / m
      const fy = j / m
      const ci = Math.min(cnx - 2, Math.floor(fx))
      const cj = Math.min(cny - 2, Math.floor(fy))
      const tx = Math.max(0, Math.min(1, fx - ci))
      const ty = Math.max(0, Math.min(1, fy - cj))
      let sw = 0
      let sv = 0
      for (const [di, dj, w] of [
        [0, 0, (1 - tx) * (1 - ty)],
        [1, 0, tx * (1 - ty)],
        [0, 1, (1 - tx) * ty],
        [1, 1, tx * ty],
      ]) {
        const v = coarse[Math.max(0, cj + dj) * cnx + Math.max(0, ci + di)]
        if (Number.isFinite(v) && w > 0) {
          sw += w
          sv += w * v
        }
      }
      spacing[j * nx + i] = sw > 0 ? sv / sw : step
    }

  // 4. distance in passes with that spacing
  work?.progress?.(0.55, 'Passes')
  field.solve(
    seedOf((p) => spacing[p]),
    (p) => 1 / spacing[p],
    work,
  )
  const T = field.T
  // for the level lines: nodes off the surface are below every level (boundary start: the lines
  // stay inside), or break the lines (start curves: they run on to be clipped at the boundary)
  const F = new Float64Array(N)
  let tMax = 0
  for (let p = 0; p < N; p++) {
    if (open[p] && Number.isFinite(T[p])) {
      F[p] = T[p]
      if (inside[p]) tMax = Math.max(tMax, T[p])
    } else F[p] = starts.length ? NaN : -1
  }

  // Level lines cross a grid edge where T reaches the level. Between two nodes reached from
  // different sides (a crease, where fronts meet) T is not straight but peaks between them, so
  // the crossing is carried on from the lower node's own side (its slope from the node behind it).
  const agree = (a: number, b: number) => {
    const ma = field.dx[a] ** 2 + field.dy[a] ** 2
    const mb = field.dx[b] ** 2 + field.dy[b] ** 2
    return ma < 0.25 || mb < 0.25 || field.dx[a] * field.dx[b] + field.dy[a] * field.dy[b] >= AGREE * Math.sqrt(ma * mb)
  }
  const crossing = (p: number, q: number, level: number) => {
    const lin = (level - F[p]) / (F[q] - F[p])
    if (agree(p, q)) return lin
    // lower end and the node behind it, on the same line
    const [lo, hi, sgn] = F[p] <= F[q] ? [p, q, 1] : [q, p, -1]
    const back = lo - (hi - lo)
    const bi = back % nx
    const li = lo % nx
    if (back < 0 || back >= N || Math.abs(bi - li) > 1 || !Number.isFinite(F[back]) || F[back] < 0 || !agree(lo, back)) return lin
    const slope = F[lo] - F[back]
    if (!(slope > 0)) return lin
    const u = Math.max(0, Math.min(1, (level - F[lo]) / slope))
    return sgn > 0 ? u : 1 - u
  }
  const plans: { level: number; pts: P[]; closed: boolean }[] = []
  const simplifyTol = Math.min(0.005, smp.tol / 2)
  const addLines = (lines: LevelPolyline[], level: number) => {
    for (const l of lines) {
      const pts = simplifyPlan(l.closed ? [...l.pts, l.pts[0]] : l.pts, simplifyTol)
      if (starts.length) for (const piece of clipPolyline(region, pts)) plans.push({ level, pts: piece, closed: false })
      else plans.push({ level, pts, closed: l.closed })
    }
  }
  // the start itself: the boundary (or the start curves, clipped to it)
  if (starts.length) for (const s of starts) for (const piece of clipPolyline(region, s.closed ? [...s.pts, s.pts[0]] : s.pts)) plans.push({ level: 0, pts: piece, closed: false })
  else for (const poly of region.polys) plans.push({ level: 0, pts: [...poly, poly[0]], closed: true })
  const K = Math.floor(tMax + 1e-9)
  // the cells each whole level crosses, so each level reads only its own cells
  const buckets: number[][] = Array.from({ length: K + 1 }, () => [])
  for (let j = 0; j + 1 < ny; j++)
    for (let i = 0; i + 1 < nx; i++) {
      const p = j * nx + i
      const v = [F[p], F[p + 1], F[p + nx], F[p + nx + 1]]
      if (v.some(Number.isNaN)) continue
      const lo = Math.max(1, Math.ceil(Math.min(...v)))
      const hi = Math.min(K, Math.floor(Math.max(...v)))
      for (let k = lo; k <= hi; k++) buckets[k].push(p)
    }
  for (let k = 1; k <= K; k++) {
    if ((k & 3) === 0) {
      checkCancel(work?.isCancelled)
      work?.progress?.(0.6 + (0.15 * k) / Math.max(1, K), `Level ${k} of ${K}`)
    }
    addLines(levelLines(F, nx, ny, x0, y0, h, k, buckets[k], crossing), k)
  }
  // Where fronts meet (a crease of the field: the corner diagonals and the middle line of the
  // area), the passes on either side turn or end, and the material farthest from every pass lies
  // on the crease: at a square corner 0.59 of a spacing from the passes instead of 0.5, and along a
  // middle line up to a whole spacing. A pass along each crease brings it back within half a
  // spacing. Head-on creases whose true height is more than a whole level past the last level the
  // grid could draw also get a pass halfway up to it.
  const creases = creaseLines(F, field.dx, field.dy, nx, ny, x0, y0, h, inside, (dot, v, top) => dot < CREASE && !(dot < HEAD_ON && v - Math.floor(top + 1e-9) <= 0.5))
  const edgesOf = region.polys.map((pl) => ({ pts: pl, closed: true }))
  for (const c of creases) {
    // (from start curves, the boundary pass closes the ends; creases run from low to high values)
    const pts = simplifyPlan(c.pts, simplifyTol)
    if (pts.length < 2) continue
    if (starts.length && pts.every((q) => nearestOn(edgesOf, q).d < 2 * h)) continue
    plans.push({ level: CREASE_LEVEL, pts: c.lo <= c.hi ? pts : [...pts].reverse(), closed: false })
  }
  // start curves: the boundary is the last pass
  if (starts.length) for (const poly of region.polys) plans.push({ level: Infinity, pts: [...poly, poly[0]], closed: true })

  // Check and repair: the distance over the surface from every pass (in spacings). Material more
  // than GAP from every pass would leave a cusp over the target, so a pass goes along the middle of
  // each such gap (the crease of that distance), and the check runs again.
  for (let round = 0; round < REPAIR_ROUNDS; round++) {
    checkCancel(work?.isCancelled)
    work?.progress?.(0.75, 'Checking the gaps between passes')
    const seeds = new Map<number, { t: number; dx: number; dy: number }>()
    for (const pl of plans)
      for (let k = 1; k < pl.pts.length; k++) {
        const A = pl.pts[k - 1]
        const B = pl.pts[k]
        const i0 = Math.max(0, Math.floor((Math.min(A.x, B.x) - x0) / h) - 1)
        const i1 = Math.min(nx - 1, Math.ceil((Math.max(A.x, B.x) - x0) / h) + 1)
        const j0 = Math.max(0, Math.floor((Math.min(A.y, B.y) - y0) / h) - 1)
        const j1 = Math.min(ny - 1, Math.ceil((Math.max(A.y, B.y) - y0) / h) + 1)
        const ex = B.x - A.x
        const ey = B.y - A.y
        const L2 = ex * ex + ey * ey
        for (let j = j0; j <= j1; j++)
          for (let i = i0; i <= i1; i++) {
            const p = j * nx + i
            if (!open[p]) continue
            const x = x0 + i * h
            const y = y0 + j * h
            const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - A.x) * ex + (y - A.y) * ey) / L2)) : 0
            const qx = A.x + ex * t
            const qy = A.y + ey * t
            const d = Math.hypot(x - qx, y - qy)
            if (d > 1.5 * h) continue
            // (the grid's own heights are close enough for finding gaps)
            const zq = gridZ(z, open, nx, ny, x0, y0, h, qx, qy, z[p])
            const v = Math.hypot(d, z[p] - zq) / spacing[p]
            const old = seeds.get(p)
            if (!old || v < old.t) seeds.set(p, { t: v, dx: d > 1e-9 ? (x - qx) / d : 0, dy: d > 1e-9 ? (y - qy) / d : 0 })
          }
      }
    field.solve(
      seeds,
      (p) => 1 / spacing[p],
      work,
    )
    const gaps = creaseLines(field.T, field.dx, field.dy, nx, ny, x0, y0, h, inside, (dot, v) => dot < CREASE && v > GAP)
    let added = 0
    for (const g of gaps) {
      const pts = simplifyPlan(g.pts, simplifyTol)
      if (pts.length < 2) continue
      plans.push({ level: REPAIR_LEVEL, pts, closed: false })
      added++
    }
    if (!added) break
  }

  // order: by level (in from the start, or out to it), nearest next within a level; loops run
  // counter-clockwise for climb, clockwise for conventional, starting nearest the tool
  const inward = (op.travel ?? 'inward') === 'inward'
  // (creases cross many levels: they go after all levels inward, before them outward)
  const byLevel = [...new Set(plans.map((p) => p.level))].sort((a, b) => (inward ? a - b : b - a))
  const ccw = op.direction !== 'conventional'
  let at: P | null = null
  const orderedPlans: { level: number; pts: P[]; closed: boolean }[] = []
  for (const lv of byLevel) {
    const left = plans.filter((p) => p.level === lv)
    while (left.length) {
      let bi = 0
      let bd = Infinity
      let bk = 0
      let brev = false
      left.forEach((pl, i) => {
        if (pl.closed) {
          for (let k = 0; k < pl.pts.length; k++) {
            const d = at ? Math.hypot(pl.pts[k].x - at.x, pl.pts[k].y - at.y) : 0
            if (d < bd) {
              bd = d
              bi = i
              bk = k
            }
          }
        } else
          for (const [k, rev] of [
            [0, false],
            [pl.pts.length - 1, true],
          ] as const) {
            const d = at ? Math.hypot(pl.pts[k].x - at.x, pl.pts[k].y - at.y) : 0
            if (d < bd) {
              bd = d
              bi = i
              bk = k
              brev = rev
            }
          }
      })
      const [pl] = left.splice(bi, 1)
      let pts = pl.pts
      if (pl.closed) {
        const ring = pts.slice(0, -1)
        const isCcw = signedArea(ring) > 0
        let rot = [...ring.slice(bk % ring.length), ...ring.slice(0, bk % ring.length)]
        if (isCcw !== ccw) rot = [rot[0], ...rot.slice(1).reverse()]
        pts = [...rot, rot[0]]
      } else if (brev && pl.level !== CREASE_LEVEL) pts = [...pts].reverse()
      // creases run up the field inward and down it outward
      if (pl.level === CREASE_LEVEL && !inward) pts = [...pts].reverse()
      orderedPlans.push({ level: pl.level, pts, closed: pl.closed })
      at = pts[pts.length - 1]
    }
  }

  // 5. drop and refine each pass; join them
  const chains: Pt[][] = []
  orderedPlans.forEach((pl, i) => {
    if ((i & 15) === 0) {
      checkCancel(work?.isCancelled)
      work?.progress?.(0.75 + (0.25 * i) / orderedPlans.length, `Pass ${i + 1} of ${orderedPlans.length}`)
    }
    chains.push(...chainsAlong(smp as Sampler, pl.pts))
  })
  if (!chains.length) return { ...none(region.fromModel ? 'Nothing to cut: no surface within the slope limits and groups chosen.' : 'Nothing to cut: the boundary does not cover the model within the slope limits and groups chosen.', cusp), warnings: [...warnings, 'Nothing to cut.'].slice(-1) }
  const { moves, minZ } = chainMoves(chains, smp, region, mesh, { linkMax: LINK_STEPOVERS * step, levels })
  return { moves, warnings, minZ, spacing: step, cusp, passes: orderedPlans.map((p) => ({ ...p, level: p.level >= CREASE_LEVEL ? NaN : Number.isFinite(p.level) ? p.level : tMax })) }
}

/** Height of the tool-centre surface between grid nodes (bilinear over the nodes that have one). */
function gridZ(z: Float64Array, open: Uint8Array, nx: number, ny: number, x0: number, y0: number, h: number, x: number, y: number, fallback: number): number {
  const fx = (x - x0) / h
  const fy = (y - y0) / h
  const i = Math.max(0, Math.min(nx - 2, Math.floor(fx)))
  const j = Math.max(0, Math.min(ny - 2, Math.floor(fy)))
  const tx = Math.max(0, Math.min(1, fx - i))
  const ty = Math.max(0, Math.min(1, fy - j))
  let sw = 0
  let sv = 0
  for (const [di, dj, w] of [
    [0, 0, (1 - tx) * (1 - ty)],
    [1, 0, tx * (1 - ty)],
    [0, 1, (1 - tx) * ty],
    [1, 1, tx * ty],
  ]) {
    const p = (j + dj) * nx + i + di
    if (w > 0 && open[p] && Number.isFinite(z[p])) {
      sw += w
      sv += w * z[p]
    }
  }
  return sw > 0 ? sv / sw : fallback
}

/** Central difference of a grid field along (di, dj) (one-sided at the edges of what is open). */
function grad(F: Float64Array, open: Uint8Array, nx: number, ny: number, i: number, j: number, di: number, dj: number): number {
  const p = j * nx + i
  const okAt = (ii: number, jj: number) => ii >= 0 && jj >= 0 && ii < nx && jj < ny && open[jj * nx + ii] && Number.isFinite(F[jj * nx + ii])
  const fw = okAt(i + di, j + dj)
  const bw = okAt(i - di, j - dj)
  if (fw && bw) return (F[p + dj * nx + di] - F[p - dj * nx - di]) / 2
  if (fw) return F[p + dj * nx + di] - F[p]
  if (bw) return F[p] - F[p - dj * nx - di]
  return 0
}

function signedArea(pts: P[]): number {
  let a = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y)
  return a / 2
}

/**
 * Creases of the field: lines between grid nodes reached from different sides (their arrival
 * directions differ by more than CREASE), kept where `accept` says. Each crease point sits where
 * the two sides' slopes meet on the grid edge; the points are joined cell by cell (three or four
 * in a cell meet at its centre) into polylines, with the field's value at each end.
 */
export function creaseLines(
  F: Float64Array,
  dx: Float32Array,
  dy: Float32Array,
  nx: number,
  ny: number,
  x0: number,
  y0: number,
  h: number,
  inside: Uint8Array,
  /** Keep a crease point: cosine of the angle between the two sides, its height, and the higher node's value. */
  accept: (dot: number, v: number, top: number) => boolean,
): { pts: P[]; lo: number; hi: number }[] {
  const ok = (p: number) => p >= 0 && p < F.length && inside[p] === 1 && Number.isFinite(F[p]) && F[p] >= 0 && dx[p] * dx[p] + dy[p] * dy[p] > 0.25
  /** Crease point on the edge p -> q (step `st` in node index), or null. */
  const point = (p: number, q: number, st: number): { x: number; y: number; v: number } | null => {
    if (!ok(p) || !ok(q)) return null
    const dot = (dx[p] * dx[q] + dy[p] * dy[q]) / Math.sqrt((dx[p] ** 2 + dy[p] ** 2) * (dx[q] ** 2 + dy[q] ** 2))
    if (dot >= CREASE) return null
    // the two sides' slopes carried on until they meet
    const bp = p - st
    const bq = q + st
    const sp = ok(bp) && Math.abs((bp % nx) - (p % nx)) <= 1 ? F[p] - F[bp] : NaN
    const sq = ok(bq) && Math.abs((bq % nx) - (q % nx)) <= 1 ? F[q] - F[bq] : NaN
    let u = 0.5
    let v = Math.max(F[p], F[q])
    if (sp > 0 && sq > 0) {
      const t = (F[q] + sq - F[p]) / (sp + sq)
      if (t >= 0 && t <= 1) {
        u = t
        v = F[p] + sp * t
      }
    }
    if (!accept(dot, v, Math.max(F[p], F[q]))) return null
    const i = p % nx
    const j = (p - i) / nx
    return st === 1 ? { x: x0 + (i + u) * h, y: y0 + j * h, v } : { x: x0 + i * h, y: y0 + (j + u) * h, v }
  }
  // crease points on the edges, by edge id (2 * node, +1 for the edge to +Y)
  const pts = new Map<number, { x: number; y: number; v: number }>()
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const p = j * nx + i
      if (i + 1 < nx) {
        const c = point(p, p + 1, 1)
        if (c) pts.set(2 * p, c)
      }
      if (j + 1 < ny) {
        const c = point(p, p + nx, nx)
        if (c) pts.set(2 * p + 1, c)
      }
    }
  // join within cells; ids >= 2 N are cell centres
  const N2 = 2 * F.length
  const adj = new Map<number, number[]>()
  const link = (a: number, b: number) => {
    let la = adj.get(a)
    if (!la) adj.set(a, (la = []))
    la.push(b)
    let lb = adj.get(b)
    if (!lb) adj.set(b, (lb = []))
    lb.push(a)
  }
  const centres = new Map<number, { x: number; y: number; v: number }>()
  for (let j = 0; j + 1 < ny; j++)
    for (let i = 0; i + 1 < nx; i++) {
      const p = j * nx + i
      const es = [2 * p, 2 * (p + 1) + 1, 2 * (p + nx), 2 * p + 1].filter((e) => pts.has(e))
      if (es.length === 2) link(es[0], es[1])
      else if (es.length >= 3) {
        const cid = N2 + p
        const ps = es.map((e) => pts.get(e)!)
        centres.set(cid, { x: ps.reduce((a, q) => a + q.x, 0) / ps.length, y: ps.reduce((a, q) => a + q.y, 0) / ps.length, v: Math.max(...ps.map((q) => q.v)) })
        for (const e of es) link(e, cid)
      }
    }
  const at = (id: number) => (id >= N2 ? centres.get(id)! : pts.get(id)!)
  const used = new Set<string>()
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`)
  const out: { pts: P[]; lo: number; hi: number }[] = []
  const walk = (start: number, next: number) => {
    const ids = [start, next]
    used.add(key(start, next))
    let prev = start
    let cur = next
    while ((adj.get(cur)?.length ?? 0) === 2) {
      const nb = adj.get(cur)!.find((x) => x !== prev)!
      if (used.has(key(cur, nb))) break
      used.add(key(cur, nb))
      ids.push(nb)
      prev = cur
      cur = nb
    }
    const ps = ids.map(at)
    out.push({ pts: ps.map((q) => ({ x: q.x, y: q.y })), lo: ps[0].v, hi: ps[ps.length - 1].v })
  }
  // from ends and junctions first, then what is left (loops)
  for (const [id, nb] of adj) if (nb.length !== 2) for (const n of nb) if (!used.has(key(id, n))) walk(id, n)
  for (const [id, nb] of adj) for (const n of nb) if (!used.has(key(id, n))) walk(id, n)
  return out.filter((c) => c.pts.length >= 2)
}
