/**
 * Stock simulation (SIM-02): plays a timeline into a stock model. Carves lazily to whatever time
 * is asked for; going back restores the nearest saved state (taken at operation starts, within a
 * memory budget) and carves forward from there. Playback helpers: advance by real time with
 * separate speeds for feed moves and rapids, stop at a tool change or at a chosen time, step one
 * move forward or back, and the time at which a given move ends.
 *
 * Pure: no DOM, no React. The simulator screen and the tests both use it.
 */
import type { SimSeg, SimTimeline, V3 } from '../sim'
import { segIndexAt } from '../sim'
import type { StockModel, StockSnapshot } from './types'

/** Memory kept for saved stock states (bytes). */
const SNAPSHOT_BUDGET = 256 * 1024 * 1024

const lerp = (a: V3, b: V3, k: number): V3 => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k })

/** Carve the timeline's cutting moves between times t0 and t1 into the stock (rapids never cut). */
export function carveStock(stock: StockModel, tl: SimTimeline, t0: number, t1: number) {
  if (t1 <= t0 || !tl.segs.length) return
  for (let i = Math.max(0, segIndexAt(tl, t0)); i < tl.segs.length; i++) {
    const s = tl.segs[i]
    if (s.t0 >= t1) break
    if (s.side || s.kind === 'rapid') continue
    const k0 = s.t1 > s.t0 ? Math.max(0, (t0 - s.t0) / (s.t1 - s.t0)) : 0
    const k1 = s.t1 > s.t0 ? Math.min(1, (t1 - s.t0) / (s.t1 - s.t0)) : 1
    if (k1 < k0) continue
    stock.carve(lerp(s.a, s.b, k0), lerp(s.a, s.b, k1), s.cutter)
  }
}

export class StockSimulation {
  readonly tl: SimTimeline
  readonly stock: StockModel
  /** Time the stock is carved to. */
  at = 0
  private snaps: { t: number; s: StockSnapshot }[] = []
  private bytes = 0

  constructor(tl: SimTimeline, stock: StockModel) {
    this.tl = tl
    this.stock = stock
  }

  /** Carve (or go back) to time t. */
  syncTo(t: number) {
    t = Math.max(0, Math.min(this.tl.total, t))
    if (t === this.at) return
    if (t < this.at) {
      const snap = this.snaps.findLast((x) => x.t <= t)
      if (snap) {
        this.stock.restore(snap.s)
        this.at = snap.t
      } else {
        this.stock.reset()
        this.at = 0
      }
    }
    // carve op by op, saving the state at each operation start on the way
    for (const op of this.tl.ops) {
      if (op.start <= this.at || op.start > t) continue
      carveStock(this.stock, this.tl, this.at, op.start)
      this.at = op.start
      this.save(op.start)
    }
    carveStock(this.stock, this.tl, this.at, t)
    this.at = t
  }

  /**
   * A stock state worked out elsewhere (e.g. the collision check in the background worker, which
   * plays the whole program): kept like a saved state, so going to time `t` is immediate.
   */
  seed(t: number, s: StockSnapshot) {
    this.snaps = this.snaps.filter((x) => Math.abs(x.t - t) >= 1e-9)
    this.snaps.push({ t, s })
    this.snaps.sort((a, b) => a.t - b.t)
  }

  private save(t: number) {
    if (this.snaps.some((x) => Math.abs(x.t - t) < 1e-9)) return
    const s = this.stock.snapshot()
    if (this.bytes + s.data.byteLength > SNAPSHOT_BUDGET) return
    this.bytes += s.data.byteLength
    this.snaps.push({ t, s })
    this.snaps.sort((a, b) => a.t - b.t)
  }
}

export interface PlayOptions {
  /** Program seconds per real second on feed moves (cutting, plunges, leads, drilling). */
  speed: number
  /** Program seconds per real second on rapids. */
  rapidSpeed: number
  /** Pause where the next operation uses a different tool. */
  stopAtToolChange?: boolean
  /** Pause when this program time is reached. */
  stopAt?: number
}

export type StopReason = 'end' | 'tool-change' | 'mark'

/**
 * Program time after `dt` real seconds of playback from `t`, and why it stopped early (if it did).
 * Rapids and feed moves play at their own speeds.
 */
export function advance(tl: SimTimeline, t: number, dt: number, o: PlayOptions): { t: number; stop?: StopReason } {
  if (!tl.segs.length || t >= tl.total) return { t: tl.total, stop: 'end' }
  let i = Math.max(0, segIndexAt(tl, t))
  // a segment that ends right here is done (so a stop at an operation start is not hit again)
  while (i + 1 < tl.segs.length && tl.segs[i].t1 <= t + 1e-12) i++
  let budget = dt
  const mark = o.stopAt !== undefined && o.stopAt > t + 1e-9 ? o.stopAt : Infinity
  for (let guard = 0; guard < 1e7 && i < tl.segs.length; guard++) {
    const s = tl.segs[i]
    const rate = Math.max(1e-9, s.kind === 'rapid' ? o.rapidSpeed : o.speed)
    const end = Math.min(s.t1, mark)
    const need = (end - t) / rate
    if (budget < need) return { t: t + budget * rate }
    budget -= need
    t = end
    if (t >= mark - 1e-12) return { t: mark, stop: 'mark' }
    const next = tl.segs[i + 1]
    if (!next) break
    if (o.stopAtToolChange && next.op !== s.op && toolChanges(tl, s.op, next.op)) return { t, stop: 'tool-change' }
    i++
  }
  return { t: tl.total, stop: 'end' }
}

/** The tool is changed between operations a and b. */
export function toolChanges(tl: SimTimeline, a: number, b: number) {
  return tl.ops[a]?.toolNumber !== tl.ops[b]?.toolNumber
}

const sameMove = (a: SimSeg, b: SimSeg) => a.op === b.op && a.move === b.move

/** Time range of the move containing segment i. */
function moveRange(tl: SimTimeline, i: number) {
  let a = i
  let b = i
  while (a > 0 && sameMove(tl.segs[a - 1], tl.segs[i])) a--
  while (b + 1 < tl.segs.length && sameMove(tl.segs[b + 1], tl.segs[i])) b++
  return { a, b, t0: tl.segs[a].t0, t1: tl.segs[b].t1 }
}

/** One move forward (to the end of the current move, or of the next) or back (to the start of the current move, or of the previous). */
export function stepMove(tl: SimTimeline, t: number, dir: 1 | -1): number {
  if (!tl.segs.length) return 0
  const eps = 1e-9
  if (dir > 0) {
    if (t >= tl.total) return tl.total
    const r = moveRange(tl, Math.max(0, segIndexAt(tl, t + eps)))
    return r.t1 > t + eps ? r.t1 : r.b + 1 < tl.segs.length ? moveRange(tl, r.b + 1).t1 : tl.total
  }
  if (t <= 0) return 0
  const r = moveRange(tl, Math.max(0, segIndexAt(tl, t)))
  if (r.t0 < t - eps) return r.t0
  return r.a > 0 ? moveRange(tl, r.a - 1).t0 : 0
}

/** Time at which move `move` of operation `op` ends (null when there is no such move). */
export function moveEnd(tl: SimTimeline, op: number, move: number): number | null {
  let end: number | null = null
  for (const s of tl.segs) {
    if (s.op === op && s.move === move) end = s.t1
    else if (end !== null) break
  }
  return end
}

/** Where a time falls: the operation and move numbers (for display). */
export function moveAt(tl: SimTimeline, t: number): { op: number; move: number } | null {
  if (!tl.segs.length || t <= 0) return null
  const s = tl.segs[Math.max(0, segIndexAt(tl, t))]
  return { op: s.op, move: s.move }
}

/** A sensible simulation cell for a panel: as fine as 0.25 mm, never more than about 6 million cells. */
export function simCell(length: number, width: number): number {
  for (const c of [0.25, 0.5, 1, 2, 4]) if (Math.ceil(length / c) * Math.ceil(width / c) <= 6e6) return c
  return 8
}
