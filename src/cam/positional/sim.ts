/**
 * Positional (3+2) programs in the simulator (M3.4, 5AX-01). Toolpaths on tilted planes (and the
 * part's face-1 toolpaths with them) are turned into the part's frame with their tool directions,
 * played on one timeline into the tri-dexel stock, and checked for collisions:
 *
 * - shank (above the flutes, with the margin) and holder (its outline, with the margin) against the
 *   material left, rapids through material, along the tilted tool;
 * - the tip deeper than the spoilboard allows, or into the table;
 * - the shank or holder reaching below the part's underside (the spoilboard and table round it).
 *
 * With a machine model that has two rotary axes for 3+2 (`replay`), the program is first converted
 * to the machine's axes and turned back into the part by the machine's kinematics (`replayMachine`)
 * so what is simulated is what the converted program does. Between operations on differently
 * tilted planes the tool backs off along its axis clear of the block (plus 10 mm) before the
 * rotary axes turn; that move itself is not checked here (the whole machine's movement is M3.6).
 *
 * Pure: no DOM, no React.
 */
import { checkCancel, type Work } from '@/core/cancel'
import { type CutterOutline, machineModelOf, toolOutline } from '@/core/machineModel'
import type { MachineProfile } from '@/core/types'
import { COLLISION_TOL, type Collision, type CollisionKind, DEFAULT_COLLISION_MARGIN } from '../collision/collision'
import { buildTimeline, programOrder, type SimTimeline } from '../sim'
import { TriDexelStock, tridexelCell, type ToolPiece, toolPieces } from '../stock/tridexel'
import type { Move, Toolpath } from '../toolpath'
import type { CamPart } from '../types'
import { type V3 } from './frame'
import { type MachineProgram, machineProgram, partFrameMoves, replayMachine } from './convert'
import { positionalAxes } from './kinematics'

/** Is this toolpath on a tilted work plane? */
export const isTiltedPath = (tp: Pick<Toolpath, 'tilt'>) => !!tp.tilt

/** Does the program need the 3+2 simulation (any tilted toolpath)? */
export const needsPositional = (paths: readonly Pick<Toolpath, 'tilt'>[]) => paths.some(isTiltedPath)

/** Clearance beyond the block the tool backs off to before the rotary axes turn (mm). */
export const TURN_CLEAR = 10

type Block = Pick<CamPart, 'length' | 'width' | 'thickness'>

/** How far along w from p until the ray has left the block's box for good (0 when it never enters). */
function exitDistance(b: Block, p: readonly number[], w: readonly number[]): number {
  const lo = [0, 0, -b.thickness]
  const hi = [b.length, b.width, 0]
  let t0 = -Infinity
  let t1 = Infinity
  for (let k = 0; k < 3; k++) {
    if (Math.abs(w[k]) < 1e-12) {
      if (p[k] < lo[k] || p[k] > hi[k]) return 0
      continue
    }
    let a = (lo[k] - p[k]) / w[k]
    let c = (hi[k] - p[k]) / w[k]
    if (a > c) [a, c] = [c, a]
    t0 = Math.max(t0, a)
    t1 = Math.min(t1, c)
  }
  return t1 >= t0 ? Math.max(0, t1) : 0
}

const same = (a: V3, b: V3) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9 && Math.abs(a[2] - b[2]) < 1e-9

export interface PositionalRun {
  tl: SimTimeline
  /** The toolpaths as played: part frame, straight moves (index = `SimOp.path`). */
  paths: Toolpath[]
  /** Tool direction per played toolpath, part frame. */
  axes: V3[]
  /** The machine program, when replayed through a machine model's kinematics. */
  program?: MachineProgram
}

/**
 * A part's toolpaths (rotary ones left out) in program order, in the part's frame with their tool
 * directions, on one timeline. `replay`: through this machine's 3+2 kinematics and back.
 * `tol`: chord tolerance for arcs (mm).
 */
export function positionalTimeline(toolpaths: readonly Toolpath[], part: Block, opts: { tol?: number; replay?: MachineProfile } = {}): PositionalRun {
  const ordered = programOrder(toolpaths.filter((tp) => !tp.rotary))
  let paths: Toolpath[]
  let axes: V3[]
  let program: MachineProgram | undefined
  if (opts.replay) {
    program = machineProgram(ordered, opts.replay, { tol: opts.tol })
    const ax = positionalAxes(machineModelOf(opts.replay))
    if ('error' in ax) {
      paths = []
      axes = []
    } else ({ paths, axes } = replayMachine(program, ordered, ax.kin))
  } else {
    paths = []
    axes = []
    for (const tp of ordered) {
      const r = partFrameMoves(tp, opts.tol)
      const { tilt: _t, ...rest } = tp
      paths.push({ ...rest, moves: r.moves, intents: [] })
      axes.push(r.axis)
    }
  }
  // back off clear of the block where the tool direction changes (and before the first tilted one)
  const up: V3 = [0, 0, 1]
  const turnAt = new Set<number>()
  paths = paths.map((tp, i) => {
    const w = axes[i]
    const before = i === 0 ? up : axes[i - 1]
    const after = i + 1 < axes.length ? axes[i + 1] : up
    const moves: Move[] = [...tp.moves]
    const first = moves.find((m) => m.t === 'rapid' || m.t === 'feed')
    const last = [...moves].reverse().find((m) => m.t === 'rapid' || m.t === 'feed')
    if (first && !same(before, w)) {
      const p = [first.x, first.y, (first as { z: number }).z]
      const d = exitDistance(part, p, w) + TURN_CLEAR
      moves.unshift({ t: 'rapid', x: p[0] + w[0] * d, y: p[1] + w[1] * d, z: p[2] + w[2] * d })
      turnAt.add(i)
    }
    if (last && !same(after, w)) {
      const p = [last.x, last.y, (last as { z: number }).z]
      const d = exitDistance(part, p, w) + TURN_CLEAR
      moves.push({ t: 'rapid', x: p[0] + w[0] * d, y: p[1] + w[1] * d, z: p[2] + w[2] * d })
    }
    return { ...tp, moves }
  })
  const tl = buildTimeline(paths)
  const flutes = paths.map((tp) => (tp.tool ? (tp.tool.fluteLength ?? tp.tool.maxDepth) : undefined))
  const seen = new Set<number>()
  for (const op of tl.ops) {
    const f = flutes[op.path]
    if (f) op.cutter = { ...op.cutter, flute: f }
  }
  for (const s of tl.segs) {
    const path = tl.ops[s.op].path
    const w = axes[path]
    s.axis = { x: w[0], y: w[1], z: w[2] }
    // drilling along a tilted tool is carved (not edge drilling)
    delete s.side
    const f = flutes[path]
    if (f) s.cutter = { ...s.cutter, flute: f }
    if (!seen.has(s.op)) {
      seen.add(s.op)
      if (turnAt.has(path)) s.turn = true
    }
  }
  return { tl, paths, axes, ...(program ? { program } : {}) }
}

/** A tri-dexel stock of the part's block. */
export function positionalStock(part: Block, cell?: number): TriDexelStock {
  return new TriDexelStock(part.length, part.width, part.thickness, cell ?? Math.max(0.5, tridexelCell(part.length, part.width, part.thickness)))
}

/** The shank above the flutes, grown by the margin (to `top` where the stick-out is unknown). */
function shankPieces(o: CutterOutline, M: number, top: number): ToolPiece[] {
  const h1 = Number.isFinite(o.gauge) ? o.gauge : top
  return h1 > o.flute ? [{ k: 'frustum', h0: o.flute, h1, r0: o.shankR + M, r1: o.shankR + M }] : []
}

/** The holder's outline grown by the margin sideways and downwards, its last radius carried up to `top`. */
function holderPieces(o: CutterOutline, M: number, top: number): ToolPiece[] {
  const h = o.holder
  if (!h.length) return []
  const out: ToolPiece[] = []
  for (let i = 0; i < h.length; i++) {
    const a = h[i]
    const b = h[i + 1] ?? { z: Math.max(top, a.z + 1), r: a.r }
    const h0 = i === 0 ? a.z - M : a.z
    if (b.z > h0) out.push({ k: 'frustum', h0, h1: b.z, r0: a.r + M, r1: b.r + M })
  }
  return out
}

/** Lowest point (part z) of pieces standing at tip P along unit w. */
function lowestZ(P: readonly number[], w: readonly number[], ps: readonly ToolPiece[]): number {
  const side = Math.sqrt(Math.max(0, 1 - w[2] * w[2]))
  let low = Infinity
  for (const p of ps) {
    if (p.k === 'frustum') low = Math.min(low, P[2] + p.h0 * w[2] - p.r0 * side, P[2] + p.h1 * w[2] - p.r1 * side)
    else if (p.k === 'sphere') {
      // its lowest point, or the lowest of its cut-off rims
      const z = P[2] + p.c * w[2] - p.R
      const h = p.c - p.R * w[2]
      if (h >= p.h0 - 1e-12 && h <= p.h1 + 1e-12) low = Math.min(low, z)
      for (const hh of [p.h0, p.h1]) low = Math.min(low, P[2] + hh * w[2] - Math.sqrt(Math.max(0, p.R * p.R - (hh - p.c) ** 2)) * side)
    } else {
      // the corner's torus: the lowest point of its tube circle, and its flat bottom's rim
      const z = P[2] + p.rc * w[2] - p.a * side - p.rc
      low = Math.min(low, z, P[2] - p.a * side)
    }
  }
  return low
}

const KIND_TEXT: Record<CollisionKind, string> = {
  shank: 'shank hits material above the flutes (tool too short for this depth)',
  holder: 'holder hits material',
  rapid: 'rapid move through material',
  spoilboard: 'cuts deeper into the spoilboard than allowed',
  table: 'goes through the spoilboard into the table',
  axis: 'tool tip reaches the rotary axis',
}

/**
 * Collision check of a part's 3+2 program on a tri-dexel stock of its block (or `opts.stock`,
 * e.g. a blank already cut to shape), carved as it goes. Returns the collisions in program order,
 * the timeline and the finished stock.
 */
export function positionalCollisions(part: Block, toolpaths: readonly Toolpath[], machine: MachineProfile, opts: { cell?: number; work?: Work; stock?: TriDexelStock; tol?: number; replay?: MachineProfile } = {}): { found: Collision[]; run: PositionalRun; stock: TriDexelStock } {
  const run = positionalTimeline(toolpaths, part, { tol: opts.tol, replay: opts.replay })
  const { tl, paths } = run
  const stock = opts.stock ?? positionalStock(part, opts.cell)
  const M = Math.max(0, machine.collisionMargin ?? DEFAULT_COLLISION_MARGIN)
  const T = part.thickness
  const limit = -(T + Math.max(0, machine.spoilboardAllowance))
  const table = -(T + Math.max(0, machineModelOf(machine).spoilboard.thickness))
  const top = Math.hypot(part.length, part.width, part.thickness) + 50
  const outlines = tl.ops.map((o) => {
    const tool = paths[o.path]?.tool
    return tool ? toolOutline(machine, tool) : null
  })
  const out: Collision[] = []
  const open = new Map<string, Collision>()
  const report = (kind: CollisionKind, text: string, op: number, move: number, t: number, at: { x: number; y: number; z: number }, depth: number) => {
    const key = `${kind}:${text}`
    const c = open.get(key)
    if (c && c.op === op && move <= c.move + c.moves) {
      c.moves = move - c.move + 1
      if (depth > c.depth) c.depth = depth
      return
    }
    const n: Collision = { kind, op, move, moves: 1, t, at, depth, message: text }
    open.set(key, n)
    out.push(n)
  }
  const segs = tl.segs
  // shank, holder and rapid checks every `spacing` mm along each operation
  const spacing = Math.max(stock.cell, 1)
  let lastOp = -1
  let travelled = 0
  for (let si = 0; si < segs.length; si++) {
    if ((si & 255) === 0) {
      checkCancel(opts.work?.isCancelled)
      opts.work?.progress?.(si / segs.length, 'Collision check (3+2)')
    }
    const s = segs[si]
    if (s.turn) continue
    const w: V3 = s.axis ? [s.axis.x, s.axis.y, s.axis.z] : [0, 0, 1]
    // the tip below the spoilboard limit or into the table, where it first goes below
    for (const [kind, lim] of [
      ['table', table],
      ['spoilboard', limit],
    ] as const) {
      const lo = Math.min(s.a.z, s.b.z)
      if (lo >= lim - 1e-6) continue
      const k = s.a.z < lim - 1e-6 ? 0 : (s.a.z - lim) / (s.a.z - s.b.z)
      const at = { x: s.a.x + (s.b.x - s.a.x) * k, y: s.a.y + (s.b.y - s.a.y) * k, z: s.a.z + (s.b.z - s.a.z) * k }
      report(kind, KIND_TEXT[kind], s.op, s.move, s.t0 + (s.t1 - s.t0) * k, at, lim - lo)
      break
    }
    const o = outlines[s.op]
    const rapid = s.kind === 'rapid'
    const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y, s.b.z - s.a.z)
    const shank = o ? shankPieces(o, M, top) : []
    const holder = o ? holderPieces(o, M, top) : []
    const cutter = rapid ? toolPieces(s.cutter, s.cutter.flute ?? o?.flute ?? top) : []
    // positions every `spacing` along the operation's path (its first point, then on), not per move:
    // a toolpath of many short moves is checked as often as one long one
    if (s.op !== lastOp) {
      lastOp = s.op
      travelled = spacing
    }
    const ds: number[] = []
    for (let d = Math.max(0, spacing - travelled); d <= len + 1e-9; d += spacing) ds.push(d)
    travelled = ds.length ? len - ds[ds.length - 1] : travelled + len
    for (const d of ds) {
      const k = len > 0 ? Math.min(1, d / len) : 0
      const p = { x: s.a.x + (s.b.x - s.a.x) * k, y: s.a.y + (s.b.y - s.a.y) * k, z: s.a.z + (s.b.z - s.a.z) * k }
      const t = s.t0 + (s.t1 - s.t0) * k
      const P = [p.x, p.y, p.z]
      // the shank or holder below the part's underside: the spoilboard and table round the part
      const low = lowestZ(P, w, [...shank, ...holder])
      if (low < -T - COLLISION_TOL) report('table', 'shank or holder reaches below the part\'s underside (spoilboard and table round the part)', s.op, s.move, t, p, -T - low)
      // a tilted cutter's side deeper than its tip: against the spoilboard limit and the table
      if (!rapid && (Math.abs(w[0]) > 1e-9 || Math.abs(w[1]) > 1e-9)) {
        const cut = lowestZ(P, w, toolPieces(s.cutter, s.cutter.flute ?? o?.flute ?? top))
        if (cut < table - 1e-6) report('table', KIND_TEXT.table, s.op, s.move, t, p, table - cut)
        else if (cut < limit - 1e-6) report('spoilboard', KIND_TEXT.spoilboard, s.op, s.move, t, p, limit - cut)
      }
      for (const [kind, ps] of [
        ['shank', shank],
        ['holder', holder],
        ['rapid', cutter],
      ] as const) {
        if (!ps.length) continue
        const r = stock.probe(p, { x: w[0], y: w[1], z: w[2] }, ps)
        if (r.depth > COLLISION_TOL) report(kind, KIND_TEXT[kind], s.op, s.move, t, p, r.depth)
      }
    }
    if (!rapid) stock.carve(s.a, s.b, s.cutter, s.axis)
  }
  for (const c of out) {
    const name = tl.ops[c.op]?.name ?? 'Operation'
    const span = c.moves > 1 ? `moves ${c.move + 1}-${c.move + c.moves}` : `move ${c.move + 1}`
    c.message = `${name}, ${span}: ${c.message} at X${c.at.x.toFixed(1)} Y${c.at.y.toFixed(1)} Z${c.at.z.toFixed(1)} (${c.depth.toFixed(2)} mm).`
  }
  return { found: out, run, stock }
}
