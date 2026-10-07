/**
 * Rotary toolpaths (M3.3, 3D-10). The tool stands square to the rotary axis and points at it; the
 * part turns under it. Every point is worked out in the frame round the axis (along it u, angle θ,
 * tip's distance from the axis ρ) and written on the operation's wrapped plane (unrolled x, y and
 * z = ρ - the plane's radius), where a straight move is a straight move of the machine's axes.
 *
 * On a model:
 * - along: passes along the axis, one per step round it;
 * - around: rings round the axis, one per step along it;
 * - spiral: one continuous spiral, the step along the axis per turn;
 * each from the rotary drop-cutter (`RotaryDrop`), refined until the straight moves between points
 * stay within tolerance of the true tool-tip surface (never more than 0.002 mm below it), and in
 * roughing levels (`stepdown`) from the blank's surface in. Between passes the tool lifts to the
 * clearance radius (clear of the whole blank) before it turns or moves along.
 *
 * Wrapped shapes ('wrap'): shapes drawn in the plane's unrolled rectangle, cut a depth below the
 * plane's cylinder or below the model's surface; with a saw blade, straight along the axis
 * (grooves, flutes) or straight round it (rings).
 *
 * Pure: no DOM, no React.
 */
import type { Work } from '@/core/cancel'
import { checkCancel } from '@/core/cancel'
import type { P } from '../geom'
import type { Move } from '../toolpath'
import type { RotaryOp, RotarySetup, WrappedPlane } from '../types'
import { cutChains, type Pt, refineAlong } from '../3d/chain'
import type { Cutter3D } from '../3d/cutter'
import { blankRadius, blankRho, cylToPlane, planeToCyl } from './frame'
import type { RotaryDrop } from './drop'

const TWO_PI = Math.PI * 2
const DEG = Math.PI / 180

export interface RotaryPathInputs {
  setup: RotarySetup
  plane: WrappedPlane
  op: Pick<RotaryOp, 'strategy' | 'stepover' | 'stepdown' | 'stockToLeave' | 'tolerance' | 'zigzag' | 'levels' | 'onModel'>
  /** The tool's cutting radius. */
  R: number
  /** Drop-cutter on the model with the cutter grown by the stock to leave (null: no model). */
  drop: RotaryDrop | null
  work?: Work
}

export interface RotaryPaths {
  moves: Move[]
  warnings: string[]
  /** Deepest the tip goes below the blank's farthest reach (mm). */
  deepest: number
  /** Roughing levels used (tip distances from the axis), outermost first; empty = one pass on the model. */
  levels: number[]
}

/** Points on a pass in the frame round the axis. */
interface CPt extends Pt {
  /** Along the axis, angle (radians), tip distance from the axis. */
  u: number
  th: number
  rho: number
}

/** Moves on the plane, starting and ending at the safe radius. */
class Out {
  moves: Move[] = []
  private at: { x: number; y: number; z: number } | null = null
  private readonly plane: WrappedPlane
  readonly clear: number
  readonly safe: number
  constructor(plane: WrappedPlane, clear: number, safe: number) {
    this.plane = plane
    this.clear = clear
    this.safe = safe
  }
  private P(u: number, th: number, rho: number) {
    return cylToPlane(this.plane, u, th, rho)
  }
  rapid(u: number, th: number, rho: number) {
    const p = this.P(u, th, rho)
    if (this.at && Math.abs(p.x - this.at.x) < 1e-9 && Math.abs(p.y - this.at.y) < 1e-9 && Math.abs(p.z - this.at.z) < 1e-9) return
    this.moves.push({ t: 'rapid', x: p.x, y: p.y, z: p.z })
    this.at = p
  }
  feed(u: number, th: number, rho: number, f: 'cut' | 'plunge') {
    const p = this.P(u, th, rho)
    if (this.at && Math.abs(p.x - this.at.x) < 1e-9 && Math.abs(p.y - this.at.y) < 1e-9 && Math.abs(p.z - this.at.z) < 1e-9) return
    this.moves.push({ t: 'feed', x: p.x, y: p.y, z: p.z, f })
    this.at = p
  }
  /** Cutting chain from its first point (already there). */
  chain(pts: CPt[]) {
    if (pts.length < 2) return
    const a = new Float64Array((pts.length - 1) * 3)
    for (let i = 1; i < pts.length; i++) {
      const p = this.P(pts[i].u, pts[i].th, pts[i].rho)
      a[(i - 1) * 3] = p.x
      a[(i - 1) * 3 + 1] = p.y
      a[(i - 1) * 3 + 2] = p.z
    }
    this.moves.push({ t: 'poly', pts: a, f: 'cut' })
    const l = pts[pts.length - 1]
    this.at = this.P(l.u, l.th, l.rho)
  }
  /** Lift to the clearance radius where the tool is, then go to above `p` and plunge to it. */
  enter(p: CPt, from: { u: number; th: number } | null) {
    if (from) this.rapid(from.u, from.th, this.clear)
    else this.rapid(p.u, p.th, this.safe)
    this.rapid(p.u, p.th, this.clear)
    this.feed(p.u, p.th, p.rho, 'plunge')
  }
}

/** Drops in batches grouped by angle (so each turned model is made once), in the order asked. */
function batchDrops(drop: RotaryDrop, samples: { u: number; th: number }[], work?: Work): Float64Array {
  const out = new Float64Array(samples.length)
  const order = samples.map((_, i) => i)
  const key = (th: number) => Math.round((((th % TWO_PI) + TWO_PI) % TWO_PI) * 1e9)
  order.sort((a, b) => key(samples[a].th) - key(samples[b].th) || a - b)
  for (let q = 0; q < order.length; q++) {
    if ((q & 4095) === 0) checkCancel(work?.isCancelled)
    const s = samples[order[q]]
    out[order[q]] = drop.drop(s.u, s.th)
  }
  return out
}

/**
 * Points along straight lines in (u, θ), each refined as `refineAlong` refines one (until the
 * straight moves between points stay within `tol` of the tip surface and never more than
 * `gougeTol` below it), but all lines together, round by round: before each round the points it
 * needs are handed to `prefetch` at once (so they can be worked out angle by angle). Lines are
 * measured in mm: along the axis, and round it as arc at `Rref`.
 */
function refineLines(lines: { a: { u: number; th: number }; b: { u: number; th: number } }[], Rref: number, step0: number, tol: number, gougeTol: number, pointAt: (u: number, th: number) => CPt, prefetch: (reqs: { u: number; th: number }[]) => void): CPt[][] {
  const geo = lines.map((l) => ({ ...l, len: Math.max(1e-12, Math.hypot(l.b.u - l.a.u, (l.b.th - l.a.th) * Rref)) }))
  const where = (i: number, t: number) => {
    const g = geo[i]
    const k = t / g.len
    return { u: g.a.u + (g.b.u - g.a.u) * k, th: g.a.th + (g.b.th - g.a.th) * k }
  }
  const at = (i: number, t: number) => {
    const w = where(i, t)
    return pointAt(w.u, w.th)
  }
  // the base points
  const kept: { t: number; p: CPt }[][] = geo.map(() => [])
  const base: number[][] = geo.map((g) => {
    const n = Math.max(1, Math.ceil(g.len / step0))
    return Array.from({ length: n + 1 }, (_, k) => (k === n ? g.len : (g.len * k) / n))
  })
  prefetch(base.flatMap((ts, i) => ts.map((t) => where(i, t))))
  type Iv = { i: number; ta: number; pa: CPt; tb: number; pb: CPt; depth: number }
  let queue: Iv[] = []
  base.forEach((ts, i) => {
    let prev: { t: number; p: CPt } | null = null
    for (const t of ts) {
      const p = at(i, t)
      kept[i].push({ t, p })
      if (prev && (prev.p.cut || p.cut)) queue.push({ i, ta: prev.t, pa: prev.p, tb: t, pb: p, depth: 0 })
      prev = { t, p }
    }
  })
  while (queue.length) {
    prefetch(queue.map((iv) => where(iv.i, (iv.ta + iv.tb) / 2)))
    const decided = queue.map((iv) => {
      const tm = (iv.ta + iv.tb) / 2
      const m = at(iv.i, tm)
      const mixed = iv.pa.cut !== iv.pb.cut || m.cut !== iv.pa.cut
      let deeper = false
      let quarters = false
      if (mixed) deeper = iv.depth < 7
      else if (iv.pa.cut && iv.depth < 9) {
        const lin = (iv.pa.z + iv.pb.z) / 2
        deeper = m.z - lin > gougeTol || Math.abs(m.z - lin) > tol
        // a kink can hide from the midpoint: where it is not clearly straight, or steep, test the quarters too
        quarters = !deeper && (Math.abs(m.z - lin) > gougeTol / 8 || Math.abs(iv.pb.z - iv.pa.z) > 0.5 * Math.abs(iv.tb - iv.ta))
      }
      return { iv, tm, m, mixed, deeper, quarters }
    })
    const q = decided.filter((d) => d.quarters)
    if (q.length) {
      prefetch(q.flatMap((d) => [0.25, 0.75].map((f) => where(d.iv.i, d.iv.ta + (d.iv.tb - d.iv.ta) * f))))
      for (const d of q)
        for (const f of [0.25, 0.75]) {
          const qp = at(d.iv.i, d.iv.ta + (d.iv.tb - d.iv.ta) * f)
          if (qp.cut && qp.z - (d.iv.pa.z + (d.iv.pb.z - d.iv.pa.z) * f) > gougeTol) d.deeper = true
        }
    }
    const next: Iv[] = []
    for (const d of decided) {
      if (!d.deeper) {
        if (d.mixed || d.iv.pa.cut) kept[d.iv.i].push({ t: d.tm, p: d.m })
        continue
      }
      kept[d.iv.i].push({ t: d.tm, p: d.m })
      next.push({ ...d.iv, tb: d.tm, pb: d.m, depth: d.iv.depth + 1 }, { ...d.iv, ta: d.tm, pa: d.m, depth: d.iv.depth + 1 })
    }
    queue = next
  }
  return kept.map((k) => k.sort((a, b) => a.t - b.t).map((x) => x.p))
}

/**
 * Toolpath of a model strategy ('along', 'around', 'spiral'). The tip never goes inside the model
 * grown by the stock to leave (the drop-cutter's surface, refined between samples), and in
 * roughing never deeper than its level.
 */
export function modelPaths(inp: RotaryPathInputs): RotaryPaths {
  const { setup, plane, op, drop, R } = inp
  const warnings: string[] = []
  const moves: Move[] = []
  if (!drop) return { moves, warnings: ['Pick the model to machine.'], deepest: 0, levels: [] }
  const Rs = blankRadius(setup.blank)
  const s = Math.max(0, op.stockToLeave)
  const tol = Math.max(0.001, op.tolerance || 0.01)
  const gougeTol = Math.min(tol, 0.002)
  const step0 = Math.min(0.5, Math.max(0.05, R / 3))
  const clear = Rs + Math.max(1, op.levels.rapidZ)
  const safe = Math.max(clear, Rs + op.levels.safeZ)
  const u0 = plane.start
  const u1 = plane.end
  const full = plane.a1 - plane.a0 >= 360 - 1e-9
  const t0 = plane.a0 * DEG
  const t1 = plane.a1 * DEG
  if (op.strategy === 'spiral' && !full) return { moves, warnings: ['A spiral needs a wrapped plane that goes all the way round (0° to 360°).'], deepest: 0, levels: [] }
  if (!(op.stepover > 0)) return { moves, warnings: ['Set the step-over.'], deepest: 0, levels: [] }

  // where the tool can stand: the model grown by the stock to leave; NaN where it meets nothing
  const memo = new Map<string, number>()
  const cl = (u: number, th: number, once = false) => {
    const k = `${Math.round(u * 1e7)}:${Math.round(th * 1e9)}`
    let v = memo.get(k)
    if (v === undefined) {
      v = once ? drop.dropOnce(u, th) : drop.drop(u, th)
      if (Number.isFinite(v)) v += s
      memo.set(k, v)
      if (memo.size > 2e6) memo.clear()
    }
    return v
  }

  // roughing levels: from the blank's surface in to the lowest point the tool reaches on the model
  let floor = Infinity
  {
    const nu = Math.max(2, Math.ceil((u1 - u0) / 2) + 1)
    const nt = Math.max(8, Math.ceil(((t1 - t0) * Rs) / 2))
    const probes: { u: number; th: number }[] = []
    for (let i = 0; i < nu; i++) for (let j = 0; j <= nt; j++) probes.push({ u: u0 + ((u1 - u0) * i) / (nu - 1), th: t0 + ((t1 - t0) * j) / nt })
    const r = batchDrops(drop, probes, inp.work)
    for (let q = 0; q < r.length; q++) if (Number.isFinite(r[q])) floor = Math.min(floor, r[q] + s)
  }
  if (!Number.isFinite(floor)) return { moves, warnings: ['The tool meets the model nowhere on this wrapped plane: check the model sits on the rotary axis and inside the plane.'], deepest: 0, levels: [] }
  const levels: number[] = []
  if (op.stepdown > 0) {
    const total = Rs - floor
    const n = Math.max(1, Math.ceil(total / op.stepdown - 1e-9))
    for (let k = 1; k <= n; k++) levels.push(Rs - (total * k) / n)
  }
  const passLevels = levels.length ? levels : [-Infinity]
  const out = new Out(plane, clear, safe)
  let last: { u: number; th: number } | null = null
  let deepest = 0

  const pointAt = (u: number, th: number, level: number): CPt => {
    const c = cl(u, th)
    const ok = Number.isFinite(c)
    const rho = ok ? Math.max(level, c) : level
    // material only inside the blank: outside it the tool would cut air (1 µm: a tip resting on a
    // face of the blank, as on a square pommel, is not cutting)
    const cut = ok && rho < blankRho(setup.blank, th) - 1e-3
    const p = cylToPlane(plane, u, th, rho)
    return { x: p.x, y: p.y, z: p.z, ok, cut, prot: false, u, th, rho }
  }
  /** Points along a straight line in (u, θ) from a to b, refined against the tip surface. */
  const along = (a: { u: number; th: number }, b: { u: number; th: number }, level: number, step: number): CPt[] => {
    const len = Math.max(Math.abs(b.u - a.u), Math.abs(b.th - a.th) * Rs)
    if (len < 1e-12) return [pointAt(a.u, a.th, level)]
    const at = (t: number) => pointAt(a.u + (b.u - a.u) * t, a.th + (b.th - a.th) * t, level)
    return refineAlong(at, 0, 1, step / len, tol, gougeTol) as CPt[]
  }
  const emit = (pts: CPt[]) => {
    for (const ch of cutChains(pts) as CPt[][]) {
      out.enter(ch[0], last)
      out.chain(ch)
      const e = ch[ch.length - 1]
      for (const p of ch) deepest = Math.max(deepest, Rs - p.rho)
      out.rapid(e.u, e.th, clear)
      last = { u: e.u, th: e.th }
    }
  }

  let done = 0
  if (op.strategy === 'along') {
    // passes along the axis, the step-over apart round it (measured on the plane's cylinder)
    const span = t1 - t0
    const J = full ? Math.max(1, Math.round((span * plane.radius) / op.stepover)) : Math.max(1, Math.ceil((span * plane.radius) / op.stepover - 1e-9))
    const angles = Array.from({ length: full ? J : J + 1 }, (_, j) => t0 + (span * j) / J)
    const total = passLevels.length * angles.length
    for (const level of passLevels)
      angles.forEach((th, j) => {
        checkCancel(inp.work?.isCancelled)
        inp.work?.progress?.(done++ / total, 'Rotary passes')
        const fwd = !op.zigzag || j % 2 === 0
        const pts = along({ u: fwd ? u0 : u1, th }, { u: fwd ? u1 : u0, th }, level, step0)
        emit(pts)
      })
  } else {
    // rings round the axis the step-over apart along it, or one spiral the step-over per turn:
    // every ring of a level refined together, round by round, each round's new points worked
    // out angle by angle (a ring visits every angle; one ring at a time would turn the model for
    // each angle again and again)
    const spiral = op.strategy === 'spiral'
    const len = u1 - u0
    const span = spiral ? TWO_PI * Math.max(1e-9, len / op.stepover) : t1 - t0
    const nRings = Math.max(1, Math.ceil(len / op.stepover - 1e-9))
    const rings = spiral ? [u0] : Array.from({ length: nRings + 1 }, (_, i) => u0 + (len * i) / nRings)
    const lines = rings.map((u) => ({ a: { u, th: t0 }, b: { u: spiral ? u1 : u, th: t0 + span } }))
    const prefetch = (reqs: { u: number; th: number }[]) => {
      const key = (th: number) => Math.round((((th % TWO_PI) + TWO_PI) % TWO_PI) * 1e9)
      const keys = reqs.map((r) => key(r.th))
      const order = reqs.map((_, i) => i).sort((p, q) => keys[p] - keys[q])
      for (let q = 0; q < order.length; ) {
        checkCancel(inp.work?.isCancelled)
        // all the points at one angle: the turned model is worth making when there are several
        let e = q
        while (e < order.length && keys[order[e]] === keys[order[q]]) e++
        for (let k = q; k < e; k++) cl(reqs[order[k]].u, reqs[order[k]].th, e - q < 8)
        q = e
      }
    }
    let li = 0
    for (const level of passLevels) {
      inp.work?.progress?.(li++ / passLevels.length, spiral ? 'Rotary spiral' : 'Rotary rings')
      const all = refineLines(lines, Math.max(plane.radius, R), step0, tol, gougeTol, (u, th) => pointAt(u, th, level), prefetch)
      let back = false
      let turns = 0
      for (let i = 0; i < all.length; i++) {
        let pts = all[i]
        // zig-zag: every other ring the other way round. One way, all the way round: the next
        // ring starts where this one ended, a turn further on (the axis never winds back).
        if (back) pts = pts.slice().reverse()
        if (turns) pts = pts.map((p) => ({ ...p, th: p.th + turns * TWO_PI, ...cylToPlane(plane, p.u, p.th + turns * TWO_PI, p.rho) }))
        emit(pts)
        if (op.zigzag) back = !back
        else if (full && !spiral) turns++
      }
    }
  }
  // (set inside the closures above)
  const end = last as { u: number; th: number } | null
  if (!out.moves.length) warnings.push('Nothing to cut: the model lies outside the blank or the tool cannot reach it here.')
  else if (end) out.rapid(end.u, end.th, safe)
  moves.push(...out.moves)
  return { moves, warnings, deepest, levels }
}

/** A wrapped shape: points in the drawing (inside the plane's rectangle). */
export interface WrapShape {
  pts: P[]
  closed: boolean
}

/**
 * Shapes drawn on the wrapped plane, cut `depth` below its cylinder (or below the model's surface
 * with `drop`), in passes of at most `passDepth`. A saw blade (`blade`) cuts straight along the
 * axis or straight round it only.
 */
export function wrapPaths(inp: RotaryPathInputs, shapes: WrapShape[], depth: number, passDepth: number, blade?: { R: number; kerf: number }): RotaryPaths & { bladePlane?: 'axial' | 'ring' } {
  const { setup, plane, op, drop } = inp
  const warnings: string[] = []
  const Rs = blankRadius(setup.blank)
  const s = Math.max(0, op.stockToLeave)
  const tol = Math.max(0.001, op.tolerance || 0.01)
  const clear = Rs + Math.max(1, op.levels.rapidZ)
  const safe = Math.max(clear, Rs + op.levels.safeZ)
  const out = new Out(plane, clear, safe)
  if (!shapes.length) return { moves: [], warnings: ['Pick shapes drawn inside the wrapped plane\'s rectangle.'], deepest: 0, levels: [] }
  if (!(depth > 0)) warnings.push('The depth is 0: the tool only touches the surface.')
  const nPass = passDepth > 0 && depth > 0 ? Math.max(1, Math.ceil(depth / passDepth - 1e-9)) : 1
  const depths = Array.from({ length: nPass }, (_, i) => (depth * (i + 1)) / nPass)
  let bladePlane: 'axial' | 'ring' | undefined
  if (blade) {
    const along = shapes.filter((sh) => sh.pts.every((p) => Math.abs(p.y - sh.pts[0].y) < 1e-6))
    const round = shapes.filter((sh) => sh.pts.every((p) => Math.abs(p.x - sh.pts[0].x) < 1e-6))
    bladePlane = along.length >= round.length ? 'axial' : 'ring'
    const keep = bladePlane === 'axial' ? along : round
    if (keep.length < shapes.length) warnings.push(`${shapes.length - keep.length} shape(s) are not straight ${bladePlane === 'axial' ? 'along the axis' : 'round the axis'} and are left out: a saw blade cuts straight along the axis or straight round it, one way per operation.`)
    shapes = keep.filter((sh) => !sh.closed || bladePlane === 'ring')
    if (bladePlane === 'axial' && depth > 0) {
      const runout = Math.sqrt(Math.max(0, blade.R * blade.R - (blade.R - depth) ** 2))
      warnings.push(`The blade's curve runs ${runout.toFixed(1)} mm past each end of a groove at the plane's surface (blade Ø${(2 * blade.R).toFixed(0)}, ${depth} mm deep).`)
    }
  }
  let last: { u: number; th: number } | null = null
  let deepest = 0
  const step0 = Math.min(0.5, Math.max(0.05, inp.R / 3))
  for (const sh of shapes) {
    checkCancel(inp.work?.isCancelled)
    // points along the drawn shape, in the frame round the axis
    const pts = sh.closed && sh.pts.length > 2 ? [...sh.pts, sh.pts[0]] : sh.pts
    for (const d of depths) {
      const chain: CPt[] = []
      const pointAt = (x: number, y: number): CPt => {
        const c = planeToCyl(plane, x, y, -d)
        let rho = c.rho
        let ok = true
        if (op.onModel && drop) {
          const m = drop.drop(c.u, c.theta)
          ok = Number.isFinite(m)
          rho = ok ? m + s - d : NaN
        }
        return { x, y, z: rho - plane.radius, ok, cut: ok, prot: false, u: c.u, th: c.theta, rho }
      }
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i]
        const b = pts[i + 1]
        const len = Math.hypot(b.x - a.x, b.y - a.y)
        if (len < 1e-9) continue
        const seg = op.onModel && drop ? (refineAlong((t) => pointAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t), 0, 1, step0 / len, tol, Math.min(tol, 0.002)) as CPt[]) : [pointAt(a.x, a.y), pointAt(b.x, b.y)]
        for (const p of seg) if (!chain.length || Math.hypot(p.x - chain[chain.length - 1].x, p.y - chain[chain.length - 1].y, p.z - chain[chain.length - 1].z) > 1e-9) chain.push(p)
      }
      for (const ch of cutChains(chain) as CPt[][]) {
        out.enter(ch[0], last)
        out.chain(ch)
        for (const p of ch) deepest = Math.max(deepest, Rs - p.rho)
        const e = ch[ch.length - 1]
        out.rapid(e.u, e.th, clear)
        last = { u: e.u, th: e.th }
      }
    }
  }
  if (last) out.rapid(last.u, last.th, safe)
  if (op.onModel && !drop) warnings.push('"Below the model" needs a model: cut below the plane instead.')
  return { moves: out.moves, warnings, deepest, levels: [], ...(bladePlane ? { bladePlane } : {}) }
}

export type { Cutter3D }
