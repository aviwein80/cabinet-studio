/**
 * Curve-driven finishing (3D-09). The passes are guided by:
 * - one drive curve (a shape on face 1): the curve and copies offset from it in plan, a step-over
 *   apart, to both sides or to one;
 * - two drive curves: passes blended from the first to the second, never more than a step-over
 *   apart;
 * - an earlier operation's toolpath: its cutting moves (and copies offset from them);
 * - the line where two surfaces (two sets of the model's facet groups) meet: a ball-nose touching
 *   both where they make a valley, riding over the edge where they make a ridge;
 * - the rows or columns of a surface made in the app: lines across it a step-over apart (measured
 *   on the surface), the tool placed to touch each line.
 * The tool can also be kept on one side of chosen facet groups, which are then never cut.
 *
 * A drive only decides where each pass runs in plan: every point is an exact drop-cutter position,
 * refined to the tolerance by the shared pass code, so no drive can make the tool dig in.
 */
import { checkCancel, type Work } from '@/core/cancel'
import type { P } from '../geom'
import { sweptPolys } from '../kernel'
import type { Mesh, MeshGrid } from '../mesh/types'
import { simpleMoves } from '../moves'
import type { Move } from '../toolpath'
import type { Finish3dOp, Levels } from '../types'
import type { Pt } from './chain'
import type { Cutter3D } from './cutter'
import { type Finish3dResult, LINK_STEPOVERS } from './parallel'
import { chainMoves, chainsAlong, clipPolyline, nearestOrder, type Sampler, surfaceSampler } from './passes'
import { insideRegion, type Region } from './region'

type V3 = [number, number, number]

export interface DrivePath {
  pts: P[]
  closed: boolean
}

/** What a drive needs from outside the model: plan paths (curves, toolpath) or a surface's points and layout (parameter). */
export interface CurveInputs {
  paths?: DrivePath[]
  grid?: { positions: ArrayLike<number>; layout: MeshGrid; inside?: ArrayLike<number> }
}

/** Most copies to a side of a drive when they are not counted (as many as the boundary holds). */
const MAX_COPIES = 1000
/** Points along an intersection line at most this far apart (mm; less for small tools). */
const SEAM_STEP = 0.25
/** Intersection lines steeper than this (sine of the angle from upright) are left out: the tool cannot follow them from above. */
const SEAM_UPRIGHT = 0.15

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const addv = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3) => Math.hypot(a[0], a[1], a[2])
const unit = (a: V3): V3 => {
  const l = norm(a)
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]
}
/** a less its part along unit t. */
const perp = (a: V3, t: V3): V3 => sub(a, mul(t, dot(a, t)))
const vert = (m: Mesh, v: number): V3 => [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]]

export function curveFinish(op: Finish3dOp, mesh: Mesh, cutter: Cutter3D, region: Region, inputs: CurveInputs, levels: Levels, work?: Work): Finish3dResult {
  const warnings: string[] = []
  const none = (w: string): Finish3dResult => ({ moves: [], warnings: [...warnings, w], minZ: NaN, spacing: 0 })
  const drive = op.drive
  if (!drive) return none('Choose what guides the passes (drive curves, a toolpath, an intersection or a surface).')
  const base = surfaceSampler(op, mesh, cutter)
  if ('error' in base) return none(base.error)
  const step = Math.max(0.01, op.stepover)
  const s = base.s

  // what may be cut: the intersection's two surfaces only; never the keep-side groups, nor
  // anywhere on their other side
  let only: Set<number> | null = null
  if (drive.mode === 'intersection') {
    if (!drive.groupsA?.length || !drive.groupsB?.length) return none('Pick the facet groups of both surfaces whose intersection the passes follow.')
    if (drive.groupsA.some((g) => drive.groupsB!.includes(g))) return none('The two surfaces of the intersection must not share a facet group.')
    if (cutter.kind !== 'torus' || Math.abs(cutter.rc - cutter.R) > 1e-9) return none('Passes along an intersection need a ball-nose tool (it touches both surfaces at once).')
    only = new Set([...drive.groupsA, ...drive.groupsB])
  }
  const keeper = op.keepSide?.groups.length ? sideKeeper(mesh, new Set(op.keepSide.groups), op.keepSide.side === 'back' ? -1 : 1, cutter.R) : null
  if (op.keepSide?.groups.length && !keeper) return none('None of the facet groups to keep to one side of is in the model.')
  const groups = mesh.groups
  const smp: Sampler =
    only || keeper
      ? {
          ...base,
          sample: (x, y) => {
            const p = base.sample(x, y)
            if (!p.ok) return p
            const g = groups ? groups[base.dc.hitTri] : 0
            if (only && !only.has(g)) p.cut = false
            if (keeper && !keeper(p, g)) {
              p.cut = false
              // (links must not run over them either)
              p.prot = true
            }
            return p
          },
        }
      : base

  // the passes in plan, in cutting order (each a list of paths: a pass may be in pieces)
  let passes: DrivePath[][]
  let byDistance = false
  switch (drive.mode) {
    case 'curves':
    case 'toolpath': {
      const paths = (inputs.paths ?? []).filter((p) => p.pts.length >= 2)
      if (!paths.length) return none(drive.mode === 'curves' ? 'Pick one or two drive shapes on face 1.' : 'The toolpath picked to follow has no cutting moves.')
      if (drive.mode === 'curves' && paths.length === 2) {
        const b = blendPasses(paths[0], paths[1], step)
        if (typeof b === 'string') return none(b)
        passes = b.map((p) => [p])
        break
      }
      if (drive.mode === 'curves' && paths.length > 2) return none(`Pick one or two drive shapes: ${paths.length} curves are picked.`)
      passes = []
      for (const p of paths) {
        checkCancel(work?.isCancelled)
        passes.push(...copiesOf(p, step, drive.side ?? 'both', drive.copies, region, warnings))
      }
      byDistance = drive.mode === 'toolpath' && paths.length > 1
      break
    }
    case 'parameter': {
      if (!inputs.grid) return none('Passes along a surface\'s rows or columns need a surface made in the app (Surfaces: revolve, ruled, loft, sweep, extrude, a solid face untrimmed, or a solid face\'s rows and columns). This model has no rows and columns.')
      passes = gridPasses(inputs.grid.positions, inputs.grid.layout, drive.along ?? 'rows', step, cutter, s, inputs.grid.inside).filter((p) => p.length)
      if (!passes.length) return none('The surface has no rows and columns to follow.')
      break
    }
    case 'intersection': {
      const seams = seamLines(mesh, new Set(drive.groupsA), new Set(drive.groupsB))
      if (!seams.length) return none('The two surfaces do not meet: no edge is shared between their facet groups.')
      const ρ = cutter.R + s
      const A = new TriSet(mesh, trisOf(mesh, new Set(drive.groupsA)))
      const B = new TriSet(mesh, trisOf(mesh, new Set(drive.groupsB)))
      let upright = 0
      passes = []
      for (const sm of seams) {
        checkCancel(work?.isCancelled)
        const r = seamCentres(mesh, sm, ρ, A, B)
        upright += r.upright
        passes.push(r.paths)
      }
      if (upright) warnings.push(`${upright} point(s) where the intersection runs nearly upright are left out: the tool cannot follow it there from above.`)
      byDistance = true
      break
    }
    default:
      return none('Unknown drive.')
  }

  // drop each pass onto the model, inside the boundary
  const cutPasses: Pt[][][] = []
  passes.forEach((pass, k) => {
    if ((k & 7) === 0) {
      checkCancel(work?.isCancelled)
      work?.progress?.(k / Math.max(1, passes.length), `Pass ${k + 1} of ${passes.length}`)
    }
    const chains: Pt[][] = []
    for (const path of pass) {
      const pts = path.closed ? [...path.pts, path.pts[0]] : path.pts
      for (const piece of clipPolyline(region, pts)) chains.push(...chainsAlong(smp, piece))
    }
    if (chains.length) cutPasses.push(chains)
  })
  let ordered: Pt[][]
  if (byDistance) ordered = nearestOrder(cutPasses.flat(), null, op.pattern === 'oneway')
  else {
    // back and forth: every other pass the other way; one way: along the drive (climb) or against it
    ordered = []
    cutPasses.forEach((chains, k) => {
      const forward = op.pattern === 'zigzag' ? k % 2 === 0 : op.direction === 'climb'
      ordered.push(...(forward ? chains : [...chains].reverse().map((c) => [...c].reverse())))
    })
  }
  if (op.pattern === 'oneway' && byDistance && op.direction !== 'climb') ordered = ordered.reverse().map((c) => [...c].reverse())
  if (!ordered.length) {
    const why = keeper ? ', on the side kept to' : only ? ' on the two surfaces' : ''
    return none(`Nothing to cut: no pass touches the model inside the boundary${why} within the slope limits and groups chosen.`)
  }
  const { moves, minZ } = chainMoves(ordered, smp, region, mesh, { linkMax: LINK_STEPOVERS * step, levels })
  return { moves, warnings, minZ, spacing: step }
}

// ---------------------------------------------------------------------------------------------
// Drive curves: copies offset from one, passes blended between two
// ---------------------------------------------------------------------------------------------

/** A plan polyline, its length along it, and the nearest point on it (segments kept in a grid). */
class PathIndex {
  readonly pts: P[]
  readonly L: number[]
  readonly length: number
  private readonly cell: number
  private readonly x0: number
  private readonly y0: number
  private readonly cols: number
  private readonly rows: number
  private readonly cells = new Map<number, number[]>()
  private readonly seen: Int32Array
  private mark = 0

  constructor(pts: P[], cell: number) {
    this.pts = pts
    this.L = [0]
    for (let i = 1; i < pts.length; i++) this.L.push(this.L[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
    this.length = this.L[this.L.length - 1]
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const p of pts) {
      x0 = Math.min(x0, p.x)
      y0 = Math.min(y0, p.y)
      x1 = Math.max(x1, p.x)
      y1 = Math.max(y1, p.y)
    }
    // (cells no smaller than a 500th of the length, so long straight pieces stay cheap)
    this.cell = Math.max(cell, this.length / 500, 1e-3)
    this.x0 = x0
    this.y0 = y0
    this.cols = Math.floor((x1 - x0) / this.cell) + 1
    this.rows = Math.floor((y1 - y0) / this.cell) + 1
    this.seen = new Int32Array(Math.max(1, pts.length))
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      const [i0, i1] = [this.cx(Math.min(a.x, b.x)), this.cx(Math.max(a.x, b.x))]
      const [j0, j1] = [this.cy(Math.min(a.y, b.y)), this.cy(Math.max(a.y, b.y))]
      for (let jj = j0; jj <= j1; jj++)
        for (let ii = i0; ii <= i1; ii++) {
          const k = jj * this.cols + ii
          let l = this.cells.get(k)
          if (!l) this.cells.set(k, (l = []))
          l.push(i - 1)
        }
    }
  }
  private cx(x: number) {
    return Math.max(0, Math.min(this.cols - 1, Math.floor((x - this.x0) / this.cell)))
  }
  private cy(y: number) {
    return Math.max(0, Math.min(this.rows - 1, Math.floor((y - this.y0) / this.cell)))
  }
  /** Nearest point within r: distance along the path, segment, the point and the distance. */
  nearest(q: P, r: number): { t: number; seg: number; foot: P; d: number } | null {
    this.mark++
    let best: { t: number; seg: number; foot: P; d: number } | null = null
    const [i0, i1] = [this.cx(q.x - r), this.cx(q.x + r)]
    const [j0, j1] = [this.cy(q.y - r), this.cy(q.y + r)]
    for (let jj = j0; jj <= j1; jj++)
      for (let ii = i0; ii <= i1; ii++) {
        const l = this.cells.get(jj * this.cols + ii)
        if (!l) continue
        for (const sgi of l) {
          if (this.seen[sgi] === this.mark) continue
          this.seen[sgi] = this.mark
          const a = this.pts[sgi]
          const b = this.pts[sgi + 1]
          const dx = b.x - a.x
          const dy = b.y - a.y
          const l2 = dx * dx + dy * dy
          const f = l2 > 0 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2)) : 0
          const foot = { x: a.x + dx * f, y: a.y + dy * f }
          const d = Math.hypot(q.x - foot.x, q.y - foot.y)
          if (d <= r && (!best || d < best.d)) best = { t: this.L[sgi] + Math.sqrt(l2) * f, seg: sgi, foot, d }
        }
      }
    return best
  }
  /** Unit direction of segment i. */
  dir(i: number): P {
    const a = this.pts[i]
    const b = this.pts[i + 1]
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }
  }
  /** The point and direction at distance t along the path. */
  at(t: number): { p: P; d: P } {
    let i = 1
    while (i < this.pts.length - 1 && this.L[i] < t) i++
    const seg = this.L[i] - this.L[i - 1]
    const f = seg > 0 ? (t - this.L[i - 1]) / seg : 0
    const a = this.pts[i - 1]
    const b = this.pts[i]
    return { p: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, d: this.dir(i - 1) }
  }
}

/** The drive's points, closed ones ending where they start. */
const loopOf = (p: DrivePath): P[] => (p.closed ? [...p.pts, p.pts[0]] : p.pts)

/** An open path run on straight past both ends by e (so offsets of it reach past the ends). */
function extendEnds(pts: P[], e: number): P[] {
  const n = pts.length
  const d0 = unit2(pts[0], pts[1])
  const d1 = unit2(pts[n - 2], pts[n - 1])
  return [{ x: pts[0].x - d0.x * e, y: pts[0].y - d0.y * e }, ...pts, { x: pts[n - 1].x + d1.x * e, y: pts[n - 1].y + d1.y * e }]
}
function unit2(a: P, b: P): P {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }
}

/**
 * The drive offset by d to its left (+1), right (-1) or both (0): every point a distance d from
 * it (in plan), running the same way as the drive. Open drives stop square to their ends.
 */
export function offsetDrive(path: DrivePath, d: number, want: 1 | -1 | 0): (DrivePath & { side: 1 | -1 })[] {
  const pts = path.pts.filter((p, i) => i === 0 || Math.hypot(p.x - path.pts[i - 1].x, p.y - path.pts[i - 1].y) > 1e-9)
  if (pts.length < 2) return []
  const e = path.closed ? 0 : d + 1
  const line = path.closed ? [...pts, pts[0]] : extendEnds(pts, e)
  const idx = new PathIndex(line, Math.max(0.25, d / 4))
  const [L0, L1] = [e, idx.length - e]
  const out: (DrivePath & { side: 1 | -1 })[] = []
  // (open drives run on straight past their ends, so their copies can be cut square to the ends)
  for (const outline of sweptPolys([line], d, 0.001)) {
    // (points along the outline's long straight pieces too, so every part of it is classified)
    const loop = densify(outline, Math.max(0.05, Math.min(1, d / 2)))
    const K = loop.length
    if (K < 2) continue
    const near = loop.map((q) => idx.nearest(q, d * 1.02 + 0.01))
    // +1 / -1: on the left or right and wanted; 0: not wanted (another side, past an end, not found)
    const lab = near.map((n, i) => {
      if (!n || (!path.closed && (n.t < L0 - 1e-6 || n.t > L1 + 1e-6))) return 0
      const dr = idx.dir(n.seg)
      const sgn = dr.x * (loop[i].y - n.foot.y) - dr.y * (loop[i].x - n.foot.x) > 0 ? 1 : -1
      return want === 0 || sgn === want ? sgn : 0
    })
    // a point where the end square to the drive crosses between q (kept) and o (past the end)
    const endCross = (q: P, o: P, n: { t: number }): P | null => {
      const atEnd = n.t < L0 ? idx.at(L0) : n.t > L1 ? idx.at(L1) : null
      if (!atEnd) return null
      const g = (p: P) => (p.x - atEnd.p.x) * atEnd.d.x + (p.y - atEnd.p.y) * atEnd.d.y
      const [gq, go] = [g(q), g(o)]
      if (gq === go || gq * go > 0) return null
      const f = gq / (gq - go)
      return { x: q.x + (o.x - q.x) * f, y: q.y + (o.y - q.y) * f }
    }
    // the way a run of loop points goes along the drive: copies run the same way as it
    const forward = (from: number, count: number) => {
      let sum = 0
      for (let q = 1; q < count; q++) {
        const [a, b] = [near[(from + q - 1) % K], near[(from + q) % K]]
        if (!a || !b) continue
        let dt = b.t - a.t
        if (path.closed) {
          if (dt > idx.length / 2) dt -= idx.length
          if (dt < -idx.length / 2) dt += idx.length
        }
        sum += dt
      }
      return sum >= 0
    }
    const first = lab.findIndex((l, i) => l !== lab[(i + K - 1) % K])
    if (first < 0) {
      if (lab[0] !== 0) {
        // round the same way as the drive, starting level with its start
        let at = 0
        near.forEach((n, i) => {
          const t = n ? Math.min(n.t, idx.length - n.t) : Infinity
          const b = near[at]
          if (t < (b ? Math.min(b.t, idx.length - b.t) : Infinity)) at = i
        })
        const ring = [...loop.slice(at), ...loop.slice(0, at)]
        out.push({ pts: straighten(forward(at, K) ? ring : [ring[0], ...ring.slice(1).reverse()]), closed: true, side: lab[0] as 1 | -1 })
      }
      continue
    }
    for (let k = 0; k < K; k++) {
      const i = (first + k) % K
      if (lab[i] === 0 || lab[i] === lab[(i + K - 1) % K]) continue
      // a run starting at i
      const run: P[] = []
      const before = (i + K - 1) % K
      const nb = near[before]
      if (nb) {
        const c = endCross(loop[i], loop[before], nb)
        if (c) run.push(c)
      }
      let j = i
      let count = 0
      while (lab[j] === lab[i] && count < K) {
        run.push(loop[j])
        count++
        j = (j + 1) % K
      }
      const after = j
      const na = near[after]
      if (na && lab[after] !== lab[i]) {
        const c = endCross(loop[(after + K - 1) % K], loop[after], na)
        if (c) run.push(c)
      }
      // (slivers where the outline's own corners sit right on an end are not copies)
      let len = 0
      for (let q = 1; q < run.length; q++) len += Math.hypot(run[q].x - run[q - 1].x, run[q].y - run[q - 1].y)
      if (len > 0.01) out.push({ pts: straighten(forward(i, count) ? run : run.reverse()), closed: false, side: lab[i] as 1 | -1 })
    }
  }
  return out
}

/** A closed loop with points added so no piece is longer than h. */
function densify(loop: P[], h: number): P[] {
  const out: P[] = []
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]
    const b = loop[(i + 1) % loop.length]
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / h))
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n })
  }
  return out
}

/** Points in line with their neighbours (within 1e-5 mm) left out. */
function straighten(pts: P[]): P[] {
  if (pts.length <= 2) return pts
  const out: P[] = [pts[0]]
  for (let i = 1; i + 1 < pts.length; i++) {
    const a = out[out.length - 1]
    const b = pts[i + 1]
    const p = pts[i]
    const l = Math.hypot(b.x - a.x, b.y - a.y)
    if (l === 0 || Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / l > 1e-5 || (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y) < 0) out.push(p)
  }
  out.push(pts[pts.length - 1])
  return out
}

/**
 * The drive and its copies, ordered across from one side to the other: `copies` each side (all
 * that reach inside the boundary when not given).
 */
function copiesOf(path: DrivePath, step: number, side: 'both' | 'left' | 'right', copies: number | undefined, region: Region, warnings: string[]): DrivePath[][] {
  const want = side === 'left' ? 1 : side === 'right' ? -1 : 0
  const right: DrivePath[][] = []
  const left: DrivePath[][] = []
  const max = copies === undefined ? MAX_COPIES : Math.max(0, Math.floor(copies))
  for (let k = 1; k <= max; k++) {
    const cs = offsetDrive(path, k * step, want)
    const inside = cs.filter((c) => c.pts.some((p) => insideRegion(region, p)))
    if (copies === undefined && !inside.length) break
    if (k === max && copies === undefined) warnings.push(`Copies stopped at ${MAX_COPIES} each side.`)
    const l = cs.filter((c) => c.side === 1)
    const r = cs.filter((c) => c.side === -1)
    if (l.length) left.push(l)
    if (r.length) right.push(r)
  }
  return [...right.reverse(), [path], ...left]
}

/** n points along a path at equal steps of its length (closed: round the loop, not repeating the start). */
function resample(pts: P[], n: number, closed: boolean): P[] {
  const idx = new PathIndex(closed ? [...pts, pts[0]] : pts, 1)
  const out: P[] = []
  for (let i = 0; i < n; i++) out.push(idx.at((idx.length * i) / (closed ? n : n - 1)).p)
  return out
}

function signedArea(pts: P[]) {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

/** Passes blended from drive a to drive b, never more than `step` apart (in plan), a and b included. */
export function blendPasses(a: DrivePath, b: DrivePath, step: number): DrivePath[] | string {
  if (a.closed !== b.closed) return 'Both drive curves must be open, or both closed.'
  const len = (p: DrivePath) => new PathIndex(loopOf(p), 1).length
  const n = Math.min(20000, Math.max(32, Math.ceil(Math.max(len(a), len(b)) / 0.2)))
  let B = b.pts
  if (a.closed) {
    // same way round, starting at the points nearest each other
    if (Math.sign(signedArea(a.pts)) !== Math.sign(signedArea(B))) B = [...B].reverse()
  } else {
    const [a0, a1, b0, b1] = [a.pts[0], a.pts[a.pts.length - 1], B[0], B[B.length - 1]]
    const dd = (p: P, q: P) => Math.hypot(p.x - q.x, p.y - q.y)
    if (dd(a0, b0) + dd(a1, b1) > dd(a0, b1) + dd(a1, b0)) B = [...B].reverse()
  }
  const ra = resample(a.pts, n, a.closed)
  let rb = resample(B, n, a.closed)
  if (a.closed) {
    let best = 0
    rb.forEach((p, i) => {
      if (Math.hypot(p.x - ra[0].x, p.y - ra[0].y) < Math.hypot(rb[best].x - ra[0].x, rb[best].y - ra[0].y)) best = i
    })
    rb = [...rb.slice(best), ...rb.slice(0, best)]
  }
  let gap = 0
  for (let i = 0; i < n; i++) gap = Math.max(gap, Math.hypot(rb[i].x - ra[i].x, rb[i].y - ra[i].y))
  const m = Math.max(1, Math.ceil(gap / step - 1e-9))
  const out: DrivePath[] = [a]
  for (let k = 1; k < m; k++) {
    const f = k / m
    out.push({ pts: ra.map((p, i) => ({ x: p.x + (rb[i].x - p.x) * f, y: p.y + (rb[i].y - p.y) * f })), closed: a.closed })
  }
  out.push({ pts: B, closed: a.closed })
  return out
}

// ---------------------------------------------------------------------------------------------
// Earlier toolpath
// ---------------------------------------------------------------------------------------------

/** A toolpath's cutting moves as plan paths: one per unbroken run of cutting (rapids, plunges and leads end a run). */
export function toolpathRuns(moves: Move[]): DrivePath[] {
  const out: DrivePath[] = []
  let cur: P[] = []
  let at: { x: number; y: number } | null = null
  const flush = () => {
    if (cur.length >= 2) {
      const [p, q] = [cur[0], cur[cur.length - 1]]
      const closed = cur.length > 3 && Math.hypot(p.x - q.x, p.y - q.y) < 1e-4
      out.push({ pts: closed ? cur.slice(0, -1) : cur, closed })
    }
    cur = []
  }
  const push = (x: number, y: number) => {
    if (!cur.length && at) cur.push({ x: at.x, y: at.y })
    const last = cur[cur.length - 1]
    if (!last || Math.hypot(x - last.x, y - last.y) > 1e-6) cur.push({ x, y })
  }
  for (const m of simpleMoves(moves)) {
    if (m.t === 'feed' && m.f === 'cut') push(m.x, m.y)
    else if (m.t === 'arc' && m.f === 'cut' && at) {
      const r = Math.hypot(at.x - m.cx, at.y - m.cy)
      const a0 = Math.atan2(at.y - m.cy, at.x - m.cx)
      let sweep = Math.atan2(m.y - m.cy, m.x - m.cx) - a0
      if (m.ccw && sweep <= 1e-12) sweep += 2 * Math.PI
      if (!m.ccw && sweep >= -1e-12) sweep -= 2 * Math.PI
      const da = r > 0.005 ? 2 * Math.acos(1 - 0.005 / r) : Math.PI / 2
      const n = Math.max(1, Math.ceil(Math.abs(sweep) / da))
      for (let i = 1; i <= n; i++) {
        const a = a0 + (sweep * i) / n
        push(i === n ? m.x : m.cx + r * Math.cos(a), i === n ? m.y : m.cy + r * Math.sin(a))
      }
    } else flush()
    at = { x: m.x, y: m.y }
  }
  flush()
  return out
}

// ---------------------------------------------------------------------------------------------
// Parameter lines
// ---------------------------------------------------------------------------------------------

/**
 * Lines along a surface's rows (or columns), spaced across it so that neighbouring lines are never
 * more than `step` apart on the surface (between corresponding points). Each comes back as the
 * plan path where the tool touches the line: moved off it along the surface normal (facing up) by
 * the tool's rounded end and out by its flat bottom. `inside` (one flag per grid point): only these
 * points belong to the surface (a trimmed face); a line is cut where it leaves them.
 */
export function gridLines(pos: ArrayLike<number>, g: MeshGrid, along: 'rows' | 'columns', step: number, cutter: Cutter3D, s: number, inside?: ArrayLike<number>): DrivePath[] {
  return gridPasses(pos, g, along, step, cutter, s, inside).flat()
}

/** `gridLines`, each line as one pass (in pieces where it leaves a trimmed face). */
export function gridPasses(pos: ArrayLike<number>, g: MeshGrid, along: 'rows' | 'columns', step: number, cutter: Cutter3D, s: number, inside?: ArrayLike<number>): DrivePath[][] {
  const rowsWay = along === 'rows'
  const na = rowsWay ? g.rows : g.cols
  const nb = rowsWay ? g.cols : g.rows
  const closedAcross = rowsWay ? g.closedRows : g.closedCols
  const closedAlong = rowsWay ? g.closedCols : g.closedRows
  if (na < 1 || nb < 2) return []
  const get = (a: number, b: number): V3 => {
    const [i, j] = rowsWay ? [a, b] : [b, a]
    const k = (i * g.cols + j) * 3
    return [pos[k], pos[k + 1], pos[k + 2]]
  }
  // distance across from line a to the next (largest over the points along)
  const gaps: number[] = []
  const nGaps = closedAcross ? na : na - 1
  for (let a = 0; a < nGaps; a++) {
    let d = 0
    for (let b = 0; b < nb; b++) d = Math.max(d, norm(sub(get((a + 1) % na, b), get(a, b))))
    gaps.push(d)
  }
  const S = [0]
  for (const d of gaps) S.push(S[S.length - 1] + d)
  const total = S[S.length - 1]
  const n = total > 0 ? Math.max(1, Math.ceil(total / step - 1e-9)) : 0
  const count = closedAcross ? Math.max(1, n) : n + 1
  const rc = cutter.kind === 'torus' ? cutter.rc + s : 0
  const flat = cutter.kind === 'torus' ? cutter.R - cutter.rc : 0
  // each line's points and the surface normal there, the way the facets face (rows x columns),
  // and whether each point is on the (trimmed) surface
  const lines: { pts: V3[]; nrm: V3[]; on: boolean[] }[] = []
  const isIn = (a: number, b: number) => {
    if (!inside) return true
    const [i, j] = rowsWay ? [a, b] : [b, a]
    return !!inside[i * g.cols + j]
  }
  let up = 0
  for (let k = 0; k < count; k++) {
    const sk = n > 0 ? (total * k) / n : 0
    let a = 0
    while (a < gaps.length - 1 && S[a + 1] < sk) a++
    const f = gaps.length && gaps[a] > 0 ? Math.max(0, Math.min(1, (sk - S[a]) / gaps[a])) : 0
    const a1 = gaps.length ? (a + 1) % na : a
    // the way across at each grid point (from its neighbours either side), blended along: the
    // normal then follows the surface's curve between the lines, not the straight facet
    const acrossAt = (a0: number, b: number): V3 => {
      // (at an open edge, from the two points in from it: as true as in the middle)
      if (!closedAcross && na >= 3 && (a0 === 0 || a0 === na - 1)) {
        const [p0, p1, p2] = a0 === 0 ? [get(0, b), get(1, b), get(2, b)] : [get(na - 1, b), get(na - 2, b), get(na - 3, b)]
        const t = addv(mul(sub(p1, p0), 4), mul(sub(p2, p0), -1))
        return a0 === 0 ? t : mul(t, -1)
      }
      const lo = closedAcross ? (a0 + na - 1) % na : Math.max(0, a0 - 1)
      const hi = closedAcross ? (a0 + 1) % na : Math.min(na - 1, a0 + 1)
      return sub(get(hi, b), get(lo, b))
    }
    const line: V3[] = []
    const across: V3[] = []
    const on: boolean[] = []
    for (let b = 0; b < nb; b++) {
      const p = get(a, b)
      const q = get(a1, b)
      line.push(addv(p, mul(sub(q, p), f)))
      on.push((f >= 1 - 1e-12 || isIn(a, b)) && (f <= 1e-12 || isIn(a1, b)))
      const [u, v] = [unit(acrossAt(a, b)), unit(acrossAt(a1, b))]
      const w = addv(mul(u, 1 - f), mul(v, f))
      across.push(norm(w) > 1e-12 ? w : sub(q, p))
    }
    const nrm: V3[] = []
    for (let b = 0; b < nb; b++) {
      const prev = closedAlong ? (b + nb - 1) % nb : Math.max(0, b - 1)
      const next = closedAlong ? (b + 1) % nb : Math.min(nb - 1, b + 1)
      const c = rowsWay ? cross(sub(line[next], line[prev]), across[b]) : cross(across[b], sub(line[next], line[prev]))
      const n = unit(c)
      nrm.push(n)
      up += c[2]
    }
    lines.push({ pts: line, nrm, on })
  }
  // the tool works on the side facing up (a surface made the other way round is turned over)
  const sgn = up < 0 ? -1 : 1
  return lines.map(({ pts, nrm, on }) => {
    const plan = pts.map((q, b) => {
      let n = mul(nrm[b], sgn)
      if (norm(n) === 0) n = [0, 0, 1]
      const h = Math.hypot(n[0], n[1])
      // round end along the normal; a flat bottom further out, square to the line in plan (on
      // nearly level ground the flat bottom sits over the line: it touches anywhere under it)
      const off = rc + (h > 1e-12 ? (flat * Math.min(1, h / 0.1)) / h : 0)
      return { x: q[0] + n[0] * off, y: q[1] + n[1] * off }
    })
    if (on.every(Boolean)) return [{ pts: plan, closed: closedAlong }]
    // the pieces on the surface (a closed line that leaves it is no longer closed: it starts after a gap)
    const pieces: DrivePath[] = []
    const n = plan.length
    const start = closedAlong ? on.findIndex((v, b) => v && !on[(b + n - 1) % n]) : 0
    let cur: P[] = []
    for (let k = 0; k < n; k++) {
      const b = (start + k) % n
      if (on[b]) cur.push(plan[b])
      else {
        if (cur.length >= 2) pieces.push({ pts: cur, closed: false })
        cur = []
      }
    }
    if (closedAlong && cur.length && on[start] && on[(start + n - 1) % n]) cur.push(plan[start])
    if (cur.length >= 2) pieces.push({ pts: cur, closed: false })
    return pieces
  })
}

// ---------------------------------------------------------------------------------------------
// Intersection of two surfaces
// ---------------------------------------------------------------------------------------------

function trisOf(mesh: Mesh, groups: Set<number>): number[] {
  const out: number[] = []
  const nt = mesh.indices.length / 3
  for (let t = 0; t < nt; t++) if (groups.has(mesh.groups ? mesh.groups[t] : 0)) out.push(t)
  return out
}

/** Closest point to p on triangle abc. */
function closestOnTri(p: V3, a: V3, b: V3, c: V3): V3 {
  const ab = sub(b, a)
  const ac = sub(c, a)
  const ap = sub(p, a)
  const d1 = dot(ab, ap)
  const d2 = dot(ac, ap)
  if (d1 <= 0 && d2 <= 0) return a
  const bp = sub(p, b)
  const d3 = dot(ab, bp)
  const d4 = dot(ac, bp)
  if (d3 >= 0 && d4 <= d3) return b
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return addv(a, mul(ab, d1 / (d1 - d3)))
  const cp = sub(p, c)
  const d5 = dot(ab, cp)
  const d6 = dot(ac, cp)
  if (d6 >= 0 && d5 <= d6) return c
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return addv(a, mul(ac, d2 / (d2 - d6)))
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return addv(b, mul(sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6))))
  const den = 1 / (va + vb + vc)
  return addv(a, addv(mul(ab, vb * den), mul(ac, vc * den)))
}

/** Some of a mesh's facets in a grid, for the nearest point on them. */
class TriSet {
  readonly size: number
  private readonly mesh: Mesh
  private readonly tris: number[]
  private readonly cell: number
  private readonly o: V3
  private readonly n: [number, number, number]
  private readonly start: Int32Array
  private readonly items: Int32Array
  private readonly stamp: Int32Array
  private mark = 0

  constructor(mesh: Mesh, tris: number[]) {
    this.mesh = mesh
    this.tris = tris
    this.size = tris.length
    const lo: V3 = [Infinity, Infinity, Infinity]
    const hi: V3 = [-Infinity, -Infinity, -Infinity]
    const boxes = tris.map((t) => {
      const b = { lo: [Infinity, Infinity, Infinity] as V3, hi: [-Infinity, -Infinity, -Infinity] as V3 }
      for (let k = 0; k < 3; k++) {
        const v = vert(mesh, mesh.indices[t * 3 + k])
        for (let a = 0; a < 3; a++) {
          b.lo[a] = Math.min(b.lo[a], v[a])
          b.hi[a] = Math.max(b.hi[a], v[a])
          lo[a] = Math.min(lo[a], v[a])
          hi[a] = Math.max(hi[a], v[a])
        }
      }
      return b
    })
    const ext = [0, 1, 2].map((a) => Math.max(0, hi[a] - lo[a]))
    // cells about the size of a facet, at most 64 along any side
    let size = 0
    for (const b of boxes) size += Math.max(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2])
    this.cell = Math.max(1e-3, size / Math.max(1, boxes.length), Math.max(...ext) / 64)
    this.o = tris.length ? lo : [0, 0, 0]
    this.n = [0, 1, 2].map((a) => Math.max(1, Math.ceil(ext[a] / this.cell) + 1)) as [number, number, number]
    const cellsOf = (b: { lo: V3; hi: V3 }, fn: (c: number) => void) => {
      const i0 = [0, 1, 2].map((a) => this.ci(b.lo[a], a))
      const i1 = [0, 1, 2].map((a) => this.ci(b.hi[a], a))
      for (let i = i0[0]; i <= i1[0]; i++) for (let j = i0[1]; j <= i1[1]; j++) for (let k = i0[2]; k <= i1[2]; k++) fn(this.idx(i, j, k))
    }
    const counts = new Int32Array(this.n[0] * this.n[1] * this.n[2] + 1)
    boxes.forEach((b) => cellsOf(b, (c) => counts[c + 1]++))
    for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1]
    this.start = counts
    this.items = new Int32Array(counts[counts.length - 1])
    const fill = counts.slice()
    boxes.forEach((b, q) => cellsOf(b, (c) => (this.items[fill[c]++] = q)))
    this.stamp = new Int32Array(Math.max(1, tris.length))
  }
  private ci(x: number, a: number) {
    return Math.min(this.n[a] - 1, Math.max(0, Math.floor((x - this.o[a]) / this.cell)))
  }
  private idx(i: number, j: number, k: number) {
    return (k * this.n[1] + j) * this.n[0] + i
  }
  /** Facet t's unit normal (from its winding: out of a solid). */
  normal(t: number): V3 {
    const m = this.mesh
    const [a, b, c] = [0, 1, 2].map((k) => vert(m, m.indices[t * 3 + k]))
    return unit(cross(sub(b, a), sub(c, a)))
  }
  /**
   * Nearest point on the facets to p (no further than maxR): its distance, the point, and every
   * facet that nearest point is on (several where it is on an edge or a corner).
   */
  closest(p: V3, maxR = Infinity): { d: number; q: V3; tris: number[] } | null {
    if (!this.size) return null
    this.mark++
    let best = Infinity
    let q: V3 = [0, 0, 0]
    let ties: number[] = []
    const m = this.mesh
    const visit = (qi: number) => {
      if (this.stamp[qi] === this.mark) return
      this.stamp[qi] = this.mark
      const t = this.tris[qi]
      const x = closestOnTri(p, vert(m, m.indices[t * 3]), vert(m, m.indices[t * 3 + 1]), vert(m, m.indices[t * 3 + 2]))
      const d = norm(sub(p, x))
      if (d < best - 1e-9) {
        best = d
        q = x
        ties = [t]
      } else if (d <= best + 1e-9) ties.push(t)
    }
    // few facets: look at them all
    if (this.size <= 256) {
      for (let qi = 0; qi < this.size; qi++) visit(qi)
      return best <= maxR ? { d: best, q, tris: ties } : null
    }
    const c0 = [0, 1, 2].map((a) => this.ci(p[a], a))
    const maxShell = Math.max(...this.n)
    for (let r = 0; r <= maxShell; r++) {
      // the cells r away from c0 (on the faces of the cube round it)
      for (let i = Math.max(0, c0[0] - r); i <= Math.min(this.n[0] - 1, c0[0] + r); i++)
        for (let j = Math.max(0, c0[1] - r); j <= Math.min(this.n[1] - 1, c0[1] + r); j++) {
          const side = Math.abs(i - c0[0]) === r || Math.abs(j - c0[1]) === r
          const ks: number[] = []
          if (side) for (let k = Math.max(0, c0[2] - r); k <= Math.min(this.n[2] - 1, c0[2] + r); k++) ks.push(k)
          else for (const k of r ? [c0[2] - r, c0[2] + r] : [c0[2]]) if (k >= 0 && k < this.n[2]) ks.push(k)
          for (const k of ks) {
            const c = this.idx(i, j, k)
            for (let s = this.start[c]; s < this.start[c + 1]; s++) visit(this.items[s])
          }
        }
      // nothing in a further shell can be nearer than the walls of the block searched
      let reach = Infinity
      for (let a = 0; a < 3; a++) {
        const lo = this.o[a] + (c0[a] - r) * this.cell
        const hi = this.o[a] + (c0[a] + r + 1) * this.cell
        if (c0[a] - r > 0) reach = Math.min(reach, p[a] - lo)
        if (c0[a] + r + 1 < this.n[a]) reach = Math.min(reach, hi - p[a])
      }
      if (reach === Infinity || (reach > 0 && best <= reach)) break
      if (reach >= maxR) break
    }
    return best <= maxR ? { d: best, q, tris: ties } : null
  }
}

/**
 * The tool on one side of some facet groups: a test of a cutting point (and the group the tool
 * rests on there) that fails where the tool rests on those groups or its centre is on their other
 * side. Null when none of the groups is in the model.
 */
function sideKeeper(mesh: Mesh, groups: Set<number>, side: 1 | -1, R: number): ((p: Pt, g: number) => boolean) | null {
  const set = new TriSet(mesh, trisOf(mesh, groups))
  if (!set.size) return null
  return (p, g) => {
    if (groups.has(g)) return false
    const c: V3 = [p.x, p.y, p.z + R]
    const r = set.closest(c)
    if (!r) return true
    const v = sub(c, r.q)
    const l = norm(v)
    if (l < 1e-9) return false
    // where the nearest point is on an edge or corner, the facet facing the point most squarely
    let cos = 0
    for (const t of r.tris) {
      const k = dot(set.normal(t), v) / l
      if (Math.abs(k) > Math.abs(cos)) cos = k
    }
    return cos * side > 1e-9
  }
}

interface Seam {
  /** Points along the line where the surfaces meet. */
  pts: V3[]
  /** For each piece (pts[i] to pts[i + 1]): a facet of each surface on it. */
  ta: number[]
  tb: number[]
}

/** The lines where facets of groups a and b share an edge (points welded to 0.001 mm), as chains. */
function seamLines(mesh: Mesh, a: Set<number>, b: Set<number>): Seam[] {
  const ids = new Map<string, number>()
  const where: V3[] = []
  const nv = mesh.positions.length / 3
  const weld = new Int32Array(nv)
  for (let v = 0; v < nv; v++) {
    const p = vert(mesh, v)
    const key = `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)},${Math.round(p[2] * 1000)}`
    let id = ids.get(key)
    if (id === undefined) {
      id = where.length
      ids.set(key, id)
      where.push(p)
    }
    weld[v] = id
  }
  const groupOf = (t: number) => (mesh.groups ? mesh.groups[t] : 0)
  const nt = mesh.indices.length / 3
  const edgeKey = (u: number, v: number) => (u < v ? `${u}-${v}` : `${v}-${u}`)
  const ofA = new Map<string, number>()
  for (let t = 0; t < nt; t++) {
    if (!a.has(groupOf(t))) continue
    for (let k = 0; k < 3; k++) ofA.set(edgeKey(weld[mesh.indices[t * 3 + k]], weld[mesh.indices[t * 3 + ((k + 1) % 3)]]), t)
  }
  const edges: { u: number; v: number; ta: number; tb: number }[] = []
  const done = new Set<string>()
  for (let t = 0; t < nt; t++) {
    if (!b.has(groupOf(t))) continue
    for (let k = 0; k < 3; k++) {
      const u = weld[mesh.indices[t * 3 + k]]
      const v = weld[mesh.indices[t * 3 + ((k + 1) % 3)]]
      const key = edgeKey(u, v)
      const ta = ofA.get(key)
      if (ta === undefined || u === v || done.has(key)) continue
      done.add(key)
      edges.push({ u, v, ta, tb: t })
    }
  }
  // chain the edges: from the ends of open lines first, then round the closed ones
  const at = new Map<number, number[]>()
  edges.forEach((e, i) => {
    for (const w of [e.u, e.v]) {
      const l = at.get(w)
      if (l) l.push(i)
      else at.set(w, [i])
    }
  })
  const used = new Uint8Array(edges.length)
  const out: Seam[] = []
  const walk = (from: number) => {
    const seam: Seam = { pts: [where[from]], ta: [], tb: [] }
    let w = from
    for (;;) {
      const next = (at.get(w) ?? []).find((i) => !used[i])
      if (next === undefined) break
      used[next] = 1
      const e = edges[next]
      w = e.u === w ? e.v : e.u
      seam.pts.push(where[w])
      seam.ta.push(e.ta)
      seam.tb.push(e.tb)
    }
    if (seam.pts.length >= 2) out.push(seam)
  }
  for (const [w, l] of at) if (l.length !== 2) while (l.some((i) => !used[i])) walk(w)
  for (let i = 0; i < edges.length; i++) if (!used[i]) walk(edges[i].u)
  return out
}

/**
 * Plan paths of the ball's centre along a seam: in each plane square to the line, the centre a
 * distance ρ from both surfaces where they make a valley (refined against the true facets), or
 * straight out from the edge between them where they make a ridge.
 */
function seamCentres(mesh: Mesh, seam: Seam, ρ: number, A: TriSet, B: TriSet): { paths: DrivePath[]; upright: number } {
  const sub0 = Math.min(SEAM_STEP, ρ / 4)
  const paths: DrivePath[] = []
  let cur: P[] = []
  let upright = 0
  const flush = () => {
    if (cur.length >= 2) paths.push({ pts: cur, closed: false })
    cur = []
  }
  // (the third corner of a facet on the edge p0-p1: the way into it, square to the edge)
  const into = (t: number, p: V3, tan: V3): V3 => {
    let far: V3 = p
    let best = -1
    for (let k = 0; k < 3; k++) {
      const v = vert(mesh, mesh.indices[t * 3 + k])
      const d = norm(perp(sub(v, p), tan))
      if (d > best) {
        best = d
        far = v
      }
    }
    return unit(perp(sub(far, p), tan))
  }
  const up: V3 = [0, 0, 1]
  for (let i = 0; i + 1 < seam.pts.length; i++) {
    const p0 = seam.pts[i]
    const p1 = seam.pts[i + 1]
    const len = norm(sub(p1, p0))
    if (!(len > 0)) continue
    const tan = mul(sub(p1, p0), 1 / len)
    const w = perp(up, tan)
    const n = Math.max(1, Math.ceil(len / sub0))
    const last = i + 2 === seam.pts.length
    for (let k = 0; k <= n; k++) {
      if (k === n && !last) break
      if (k === 0 && i > 0 && cur.length) continue
      const p = addv(p0, mul(sub(p1, p0), k / n))
      if (norm(w) < SEAM_UPRIGHT) {
        upright++
        flush()
        continue
      }
      const c = seamCentre(p, tan, into(seam.ta[i], p, tan), into(seam.tb[i], p, tan), unit(w), ρ, A, B)
      if (!c) {
        flush()
        continue
      }
      cur.push({ x: c[0], y: c[1] })
    }
  }
  flush()
  return { paths, upright }
}

function seamCentre(p: V3, tan: V3, uA: V3, uB: V3, w: V3, ρ: number, A: TriSet, B: TriSet): V3 | null {
  const cosφ = Math.max(-1, Math.min(1, dot(uA, uB)))
  // tangent where they meet (no edge): straight out from the surface, on the side facing up
  if (cosφ < -0.9998) {
    let n = unit(cross(tan, uA))
    if (dot(n, w) < 0) n = mul(n, -1)
    return addv(p, mul(n, ρ))
  }
  const bis0 = addv(uA, uB)
  // folded flat onto each other (a fin): the ball sits on its edge
  if (cosφ > 0.9998) {
    const out = unit(mul(bis0, -1))
    return dot(out, w) > 0 ? addv(p, mul(out, ρ)) : null
  }
  // up = α uA + β uB: both ≥ 0 means the open side lies between the surfaces (a valley)
  const e2 = unit(perp(uB, uA))
  const wb = dot(w, e2) / Math.max(1e-12, dot(uB, e2))
  const wa = dot(w, uA) - wb * cosφ
  const bis = unit(bis0)
  if (wa >= -1e-9 && wb >= -1e-9) {
    const half = Math.acos(cosφ) / 2
    let c = addv(p, mul(bis, ρ / Math.max(1e-6, Math.sin(half))))
    const c0 = c
    // refine against the facets: the same distance ρ from both, staying square to the line
    const e1 = unit(perp(bis, tan))
    const f2 = unit(cross(tan, e1))
    let ok = false
    for (let it = 0; it < 12; it++) {
      const ra = A.closest(c, 4 * ρ + 1)
      const rb = B.closest(c, 4 * ρ + 1)
      if (!ra || !rb || ra.d < 1e-9 || rb.d < 1e-9) break
      const ga = mul(sub(c, ra.q), 1 / ra.d)
      const gb = mul(sub(c, rb.q), 1 / rb.d)
      const [a11, a12, a21, a22] = [dot(ga, e1), dot(ga, f2), dot(gb, e1), dot(gb, f2)]
      const det = a11 * a22 - a12 * a21
      if (Math.abs(det) < 1e-9) break
      const [r1, r2] = [ρ - ra.d, ρ - rb.d]
      if (Math.abs(r1) < 1e-7 && Math.abs(r2) < 1e-7) {
        ok = true
        break
      }
      const x = (r1 * a22 - a12 * r2) / det
      const y = (a11 * r2 - a21 * r1) / det
      c = addv(c, addv(mul(e1, x), mul(f2, y)))
    }
    return ok ? c : c0
  }
  // a ridge: the ball sits on the edge, its centre straight out between the two faces
  const out = mul(bis, -1)
  if (dot(out, w) <= 0) return null
  return addv(p, mul(out, ρ))
}
