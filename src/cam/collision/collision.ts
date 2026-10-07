/**
 * Collision checking (SIM-03). The program is replayed into a stock model; before the stock is
 * carved at each tool position, the parts of the tool that do not cut are checked against the
 * material still there:
 *
 * - shank: from the top of the flutes up to the holder, its radius plus the safety margin;
 * - holder: its revolved outline (from the tool table's holder) plus the margin all round;
 * - rapids: the whole tool (cutter, shank, holder) must not touch material on a rapid move;
 * - spoilboard and table: the tip must not go deeper than the spoilboard limit below the
 *   underside, and never into the table under the spoilboard.
 *
 * Material above the top of the flutes within the shank's reach counts as a shank collision
 * (the tool is too short for that depth): a stock model seen from above cannot tell a ledge
 * left above short flutes from solid material, so this errs on the side of a warning.
 *
 * Results are merged into runs: one entry per run of consecutive colliding moves of one kind in
 * one operation, with the first position and time (for jump-to-move) and the worst depth.
 * Part frame: Z = 0 at face 1, negative into the material.
 */
import { checkCancel, type Work } from '@/core/cancel'
import { type CutterOutline, machineModelOf, toolOutline } from '@/core/machineModel'
import type { MachineProfile } from '@/core/types'
import { buildTimeline, cutterZ, programOrder, type SimTimeline, type V3 } from '../sim'
import { stockFor } from '../stock/choose'
import { simCell } from '../stock/simulation'
import type { Toolpath } from '../toolpath'
import type { CamPart } from '../types'
import type { StockModel } from '../stock/types'

export type CollisionKind = 'shank' | 'holder' | 'rapid' | 'spoilboard' | 'table' | 'axis'

export interface Collision {
  kind: CollisionKind
  /** Timeline operation index. */
  op: number
  /** First colliding move (0-based) and how many moves in a row collide. */
  move: number
  moves: number
  /** Program time of the first colliding position (seconds). */
  t: number
  at: V3
  /** Worst intrusion (mm): material inside the envelope, or depth past the limit. */
  depth: number
  message: string
}

export interface CollisionSetup {
  /** Tool outline per timeline operation (null: tool unknown, only rapids and depths are checked). */
  outlines: (CutterOutline | null)[]
  /** Panel thickness. */
  thickness: number
  /** Deepest a cut may go below the underside (`MachineProfile.spoilboardAllowance`). */
  spoilboardAllowance: number
  /** Spoilboard thickness (machine model): deeper than this below the underside is the table. */
  spoilboardThickness: number
  /** Clearance kept round the shank and holder (mm); any intrusion is a collision. */
  margin: number
  /**
   * Rotary stock (M3.3): `thickness` is the blank's farthest reach from the axis, and the only
   * depth limit is the axis itself (no spoilboard or table under a turned part).
   */
  rotary?: boolean
  /** How a position is written in messages (default X, Y, Z of the part frame). */
  place?: (at: V3) => string
}

/** Material reaching into the envelope less than this (mm) is not reported (cell quantisation). */
export const COLLISION_TOL = 0.01
/** Default clearance round shank and holder (mm). */
export const DEFAULT_COLLISION_MARGIN = 2

/**
 * The checks' settings for a program on a panel of `thickness`: tool outlines from the tool table
 * and its holders, the spoilboard limit, the machine model's spoilboard, the margin setting.
 * `toolpaths` are the ones given to `buildTimeline`.
 */
export function collisionSetup(tl: SimTimeline, toolpaths: Toolpath[], machine: MachineProfile, thickness: number): CollisionSetup {
  return {
    outlines: tl.ops.map((o) => {
      const tool = toolpaths[o.path]?.tool
      return tool ? toolOutline(machine, tool) : null
    }),
    thickness,
    spoilboardAllowance: machine.spoilboardAllowance,
    spoilboardThickness: machineModelOf(machine).spoilboard.thickness,
    margin: machine.collisionMargin ?? DEFAULT_COLLISION_MARGIN,
  }
}

/** Lowest height (above the tip) of the shank's envelope at distance d, Infinity where it does not reach. */
export function shankLow(o: CutterOutline, margin: number, d: number): number {
  return d <= o.shankR + margin ? o.flute : Infinity
}

/**
 * Lowest height (above the tip) of the holder's envelope at distance d: the outline grown by the
 * margin sideways and downwards. Infinity where the holder does not reach (or is unknown).
 */
export function holderLow(o: CutterOutline, margin: number, d: number): number {
  const h = o.holder
  if (!h.length) return Infinity
  let low = Infinity
  for (let i = 0; i < h.length; i++) {
    const a = h[i]
    const b = h[i + 1] ?? { z: Infinity, r: a.r }
    // within the segment's radius range: the lowest height at which the outline reaches d
    const ra = a.r + margin
    const rb = b.r + margin
    let z = Infinity
    if (d <= ra) z = a.z
    else if (d <= rb && rb > ra) z = a.z + ((d - ra) / (rb - ra)) * (b.z - a.z)
    if (z < low) low = z
  }
  return low === Infinity ? Infinity : low - margin
}

/** Largest radius of the shank and holder envelopes. */
export function envelopeR(o: CutterOutline, margin: number) {
  return Math.max(o.r, o.shankR, ...o.holder.map((p) => p.r)) + margin
}

const kindText: Record<CollisionKind, string> = {
  shank: 'shank hits material above the flutes (tool too short for this depth)',
  holder: 'holder hits material',
  rapid: 'rapid move through material',
  spoilboard: 'cuts deeper into the spoilboard than allowed',
  table: 'goes through the spoilboard into the table',
  axis: 'tool tip reaches the rotary axis',
}

/**
 * Replay the program into `stock` (which is carved as it goes) and return the collisions found,
 * in program order. When no shank, holder or rapid can reach below face 1 anywhere, nothing is
 * carved (only the depth limits are checked): `stock` is then left uncut.
 */
export function checkCollisions(tl: SimTimeline, stock: StockModel, setup: CollisionSetup, work?: Work, marks?: StockMarks): Collision[] {
  const out: Collision[] = []
  const open = new Map<CollisionKind, Collision>()
  const limit = -(setup.thickness + Math.max(0, setup.spoilboardAllowance))
  const table = -(setup.thickness + Math.max(0, setup.spoilboardThickness))
  const M = Math.max(0, setup.margin)
  const report = (kind: CollisionKind, op: number, move: number, t: number, at: V3, depth: number) => {
    const c = open.get(kind)
    if (c && c.op === op && move <= c.move + c.moves) {
      c.moves = move - c.move + 1
      if (depth > c.depth) c.depth = depth
      return
    }
    const n: Collision = { kind, op, move, moves: 1, t, at, depth, message: '' }
    open.set(kind, n)
    out.push(n)
  }
  const segs = tl.segs
  // the stock is only needed where a shank, holder or rapid can reach material at all
  const holderFace = (o: CutterOutline) => (o.holder.length ? o.holder[0].z - M : Infinity)
  const needStock = segs.some((s) => {
    if (s.side) return false
    const z = Math.min(s.a.z, s.b.z)
    if (z >= 0) return false
    if (s.kind === 'rapid') return true
    const o = setup.outlines[s.op]
    return !!o && z + Math.min(o.flute, holderFace(o)) < 0
  })
  let mark = 0
  let carved = 0
  for (let si = 0; si < segs.length; si++) {
    if ((si & 1023) === 0) {
      checkCancel(work?.isCancelled)
      work?.progress?.(si / segs.length, 'Collision check')
    }
    const s = segs[si]
    // the stock as it is at the times asked for (only when it is carved at all)
    if (marks && needStock) mark = takeMarks(marks, stock, s.t0, mark, carved)
    if (s.side) continue
    // depth limits, exactly: where the move first goes below the limit, and how far
    for (const [kind, lim] of setup.rotary
      ? ([['axis', -setup.thickness]] as const)
      : ([
          ['table', table],
          ['spoilboard', limit],
        ] as const)) {
      const lo = Math.min(s.a.z, s.b.z)
      if (lo >= lim - 1e-6) continue
      const k = s.a.z < lim - 1e-6 ? 0 : (s.a.z - lim) / (s.a.z - s.b.z)
      const at = { x: s.a.x + (s.b.x - s.a.x) * k, y: s.a.y + (s.b.y - s.a.y) * k, z: s.a.z + (s.b.z - s.a.z) * k }
      report(kind, s.op, s.move, s.t0 + (s.t1 - s.t0) * k, at, lim - lo)
      break
    }
    if (!needStock || Math.min(s.a.z, s.b.z) >= 0) continue
    const o = setup.outlines[s.op] ?? null
    const rapid = s.kind === 'rapid'
    const lo = Math.min(s.a.z, s.b.z)
    const shankRisk = !!o && lo + o.flute < 0
    const holderRisk = !!o && lo + holderFace(o) < 0
    // the move's own positions are checked against the stock as it was before the move (material
    // above the flutes is not removed by them, so this is what the shank meets), then it is carved
    if (rapid || shankRisk || holderRisk) {
      const pts = stock.carvePoints(s.a, s.b)
      for (let q = 0; q < pts.length; q++) {
        const p = pts[q]
        if (p.z >= 0) continue
        const t = s.t0 + ((s.t1 - s.t0) * q) / Math.max(1, pts.length - 1)
        if (o && shankRisk && p.z + o.flute < 0) {
          const r = stock.intrusion(p.x, p.y, o.shankR + M, (d) => p.z + shankLow(o, M, d))
          if (r.depth > COLLISION_TOL) report('shank', s.op, s.move, t, p, r.depth)
        }
        if (o && holderRisk && p.z + holderFace(o) < 0) {
          const r = stock.intrusion(p.x, p.y, envelopeR(o, M), (d) => p.z + holderLow(o, M, d))
          if (r.depth > COLLISION_TOL) report('holder', s.op, s.move, t, p, r.depth)
        }
        if (rapid) {
          // the cutting part touching material (no margin on the cutter itself)
          const c = s.cutter
          const r = stock.intrusion(p.x, p.y, c.r, (d) => cutterZ(c, p.z, d))
          if (r.depth > COLLISION_TOL) report('rapid', s.op, s.move, t, p, r.depth)
        }
      }
    }
    if (!rapid) {
      const c0 = marks ? performance.now() : 0
      stock.carve(s.a, s.b, s.cutter)
      if (marks) carved += performance.now() - c0
    }
  }
  for (const c of out) {
    const name = tl.ops[c.op]?.name ?? 'Operation'
    const where = setup.place ? setup.place(c.at) : `X${c.at.x.toFixed(1)} Y${c.at.y.toFixed(1)} Z${c.at.z.toFixed(1)}`
    const span = c.moves > 1 ? `moves ${c.move + 1}-${c.move + c.moves}` : `move ${c.move + 1}`
    c.message = `${name}, ${span}: ${kindText[c.kind]} at ${where} (${c.depth.toFixed(2)} mm).`
  }
  return out
}

/**
 * Stock states the collision check keeps on its way (M3.4, owner request on M3.3): at each of
 * `at` (program seconds, rising) a snapshot of the stock as it is then, so the simulator can go
 * back there without playing the program from its start. Only stocks the check carves.
 */
export interface StockMarks {
  /** Program times to keep a state at (rising). */
  at?: number[]
  /**
   * Or: keep a state every `every` ms of carving (what replaying costs on screen), at most `max`
   * of them: when there are more, every other one goes and the gap doubles, so they stay spread
   * evenly over the carving work.
   */
  every?: number
  max?: number
  /** (internal, with `every`) when the last state was kept. */
  last?: number
  out: { t: number; snapshot: import('../stock/types').StockSnapshot }[]
}

/** Times splitting a program into `n` equal stretches (the end left out), for `StockMarks`. */
export function markTimes(total: number, n: number): number[] {
  return Array.from({ length: Math.max(0, n - 1) }, (_, k) => (total * (k + 1)) / n)
}

/**
 * Snapshots for the marks reached at program time t0 (the start of the next move), from mark k on;
 * `carved`: ms spent carving so far (for `every`).
 */
export function takeMarks(marks: StockMarks, stock: StockModel, t0: number, k: number, carved = 0): number {
  if (marks.every) {
    const now = carved
    if (marks.last === undefined) marks.last = now
    if (t0 > 0 && (marks.max ?? 8) > 0 && now - marks.last >= marks.every) {
      marks.out.push({ t: t0, snapshot: stock.snapshot() })
      marks.last = now
      if (marks.out.length > (marks.max ?? 8)) {
        marks.out = marks.out.filter((_, i) => i % 2 === 1)
        marks.every *= 2
      }
    }
    return k
  }
  const at = marks.at ?? []
  while (k < at.length && t0 >= at[k] - 1e-9) {
    marks.out.push({ t: t0, snapshot: stock.snapshot() })
    k++
  }
  return k
}

/**
 * Collision check of a part's toolpaths, run in program order on a stock of the part's size
 * (cells of 0.5 mm, coarser only for very large parts). Used by the export checker.
 */
export function partCollisions(part: Pick<CamPart, 'length' | 'width' | 'thickness'>, toolpaths: Toolpath[], machine: MachineProfile, work?: Work): { found: Collision[]; tl: SimTimeline } {
  // (toolpaths on tilted planes and 5-axis ones are checked along their own tool direction: `positionalCollisions`)
  const paths = programOrder(toolpaths.filter((tp) => !tp.tilt && !tp.multiAxis))
  const tl = buildTimeline(paths)
  const cell = Math.max(0.5, simCell(part.length, part.width))
  // (a lollipop under an overhang needs the dexel stock: the lip stays in it)
  const stock = stockFor(part, paths, cell)
  return { found: checkCollisions(tl, stock, collisionSetup(tl, paths, machine, part.thickness), work), tl }
}
