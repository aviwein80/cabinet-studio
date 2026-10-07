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
import { COLLISION_TOL, type Collision, type CollisionKind, DEFAULT_COLLISION_MARGIN, type StockMarks, takeMarks } from '../collision/collision'
import { buildTimeline, programOrder, type SimTimeline } from '../sim'
import { TriDexelStock, tridexelCell, type ToolPiece, toolPieces } from '../stock/tridexel'
import type { Move, Toolpath } from '../toolpath'
import type { CamPart } from '../types'
import { type V3 } from './frame'
import { type MachineProgram, machineProgram, partFrameMoves, replayMachine } from './convert'
import { positionalAxes } from './kinematics'
import { angleDeg, slerp } from '../multiaxis/axis'
import { type MachineProgram5, replaySimultaneous, simultaneousProgram } from '../multiaxis/kinematics5'
import { simpleMoves } from '../moves'
import { fixturePieces } from '../fixtures/fixture'
import { fixtureHits, fixturesBox, fixtureText, toolBody } from '../collision/fixtureCheck'

/** Is this toolpath on a tilted work plane, or a 5-axis one (M3.5)? */
export const isTiltedPath = (tp: Pick<Toolpath, 'tilt' | 'multiAxis'>) => !!tp.tilt || !!tp.multiAxis

/** Does the program need the tilted-tool simulation (any tilted or 5-axis toolpath)? */
export const needsPositional = (paths: readonly Pick<Toolpath, 'tilt' | 'multiAxis'>[]) => paths.some(isTiltedPath)

/** A 5-axis toolpath's moves (M3.5) split so the tool axis turns at most `deg` degrees per move, each with its direction. */
export function axisMovesForSim(moves: readonly Move[], deg = 1): Move[] {
  const out: Move[] = []
  let prev: { p: V3; a: V3 } | null = null
  for (const m of simpleMoves(moves as Move[])) {
    if (m.t !== 'rapid' && m.t !== 'feed') continue
    const a: V3 = m.a ? [m.a[0], m.a[1], m.a[2]] : [0, 0, 1]
    const p: V3 = [m.x, m.y, m.z]
    const n = prev ? Math.max(1, Math.ceil(angleDeg(prev.a, a) / deg)) : 1
    for (let s = 1; s <= n; s++) {
      const f = s / n
      const q: V3 = prev && s < n ? [prev.p[0] + (p[0] - prev.p[0]) * f, prev.p[1] + (p[1] - prev.p[1]) * f, prev.p[2] + (p[2] - prev.p[2]) * f] : p
      const w = prev && s < n ? slerp(prev.a, a, f) : a
      out.push(m.t === 'rapid' ? { t: 'rapid', x: q[0], y: q[1], z: q[2], a: w } : { t: 'feed', x: q[0], y: q[1], z: q[2], f: m.f, a: w, ...(m.k ? { k: m.k } : {}) })
    }
    prev = { p, a }
  }
  return out
}

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
  /** Tool direction per played toolpath, part frame (a 5-axis toolpath: where it starts). */
  axes: V3[]
  /** The machine program, when replayed through a machine model's kinematics. */
  program?: MachineProgram
  /** The 5-axis machine program (M3.5), when the program holds 5-axis work and was replayed. */
  program5?: MachineProgram5
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
  let program5: MachineProgram5 | undefined
  if (opts.replay && ordered.some((tp) => tp.multiAxis)) {
    // M3.5: a program with 5-axis work goes through the simultaneous conversion and back
    program5 = simultaneousProgram(ordered, opts.replay, { tol: opts.tol === undefined ? undefined : Math.max(opts.tol, 0.001) })
    const ax = positionalAxes(machineModelOf(opts.replay))
    paths = []
    axes = []
    if (!('error' in ax))
      for (const op of program5.ops) {
        const src = ordered[op.path]
        const { tilt: _t, ...rest } = src
        const moves = replaySimultaneous(op, ax.kin)
        paths.push({ ...rest, moves, intents: [], multiAxis: src.multiAxis ?? { engine: '', engineName: '', licensed: false, preview: false, strategy: 'curve', headFlip: 'auto', maxTilt: 0, maxTurn: 0, gouge: null } })
        const a = moves.find((m) => m.t === 'rapid' || m.t === 'feed') as { a?: readonly number[] } | undefined
        axes.push(a?.a ? [a.a[0], a.a[1], a.a[2]] : [0, 0, 1])
      }
  } else if (opts.replay) {
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
      if (tp.multiAxis) {
        // a 5-axis toolpath as made (part frame), every move with its tool direction
        const { tilt: _t, ...rest } = tp
        const moves = axisMovesForSim(tp.moves)
        paths.push({ ...rest, moves, intents: [] })
        const a = (moves[0] as { a?: readonly number[] } | undefined)?.a
        axes.push(a ? [a[0], a[1], a[2]] : [0, 0, 1])
        continue
      }
      const r = partFrameMoves(tp, opts.tol)
      const { tilt: _t, ...rest } = tp
      paths.push({ ...rest, moves: r.moves, intents: [] })
      axes.push(r.axis)
    }
  }
  // 5-axis toolpaths: the tool direction on every move (split to turn at most 1° each)
  paths = paths.map((tp) => (tp.multiAxis && opts.replay ? { ...tp, moves: axisMovesForSim(tp.moves) } : tp))
  const dirOf = (m: Move | undefined, w: V3): V3 => (m && (m.t === 'rapid' || m.t === 'feed') && m.a ? [m.a[0], m.a[1], m.a[2]] : w)
  const startAxis = paths.map((tp, i) => dirOf(tp.moves.find((m) => m.t === 'rapid' || m.t === 'feed'), axes[i]))
  const endAxis = paths.map((tp, i) => dirOf([...tp.moves].reverse().find((m) => m.t === 'rapid' || m.t === 'feed'), axes[i]))
  // where the tool direction changes between operations (and before the first tilted one): back off
  // along the tool clear of the block, rise straight up clear above it, turn the axes while moving
  // over, come down, go in along the new direction (the way the sample posts retract before they
  // turn the axes); the moves of the turn are checked like any other
  const up: V3 = [0, 0, 1]
  const firstOf = (tp: Toolpath) => tp.moves.find((m) => m.t === 'rapid' || m.t === 'feed') as { x: number; y: number; z: number } | undefined
  const lastOf = (tp: Toolpath) => [...tp.moves].reverse().find((m) => m.t === 'rapid' || m.t === 'feed') as { x: number; y: number; z: number } | undefined
  const backOff = (m: { x: number; y: number; z: number } | undefined, w: V3): V3 | null => {
    if (!m) return null
    const p = [m.x, m.y, m.z]
    const d = exitDistance(part, p, w) + TURN_CLEAR
    return [p[0] + w[0] * d, p[1] + w[1] * d, p[2] + w[2] * d]
  }
  const offStart = paths.map((tp, i) => (!same(i === 0 ? up : endAxis[i - 1], startAxis[i]) ? backOff(firstOf(tp), startAxis[i]) : null))
  const offEnd = paths.map((tp, i) => (!same(i + 1 < paths.length ? startAxis[i + 1] : up, endAxis[i]) ? backOff(lastOf(tp), endAxis[i]) : null))
  // the height the axes turn at, per change: above both backed-off points and the block's top
  const turnZ = (a: V3 | null, b: V3 | null) => Math.max(0, a?.[2] ?? -Infinity, b?.[2] ?? -Infinity) + TURN_CLEAR
  const turnAt = new Map<number, V3>()
  paths = paths.map((tp, i) => {
    const five = !!tp.multiAxis
    const w0 = startAxis[i]
    const w1 = endAxis[i]
    const moves: Move[] = [...tp.moves]
    const s0 = offStart[i]
    if (s0) {
      const zs = turnZ(i > 0 ? offEnd[i - 1] : null, s0)
      moves.unshift({ t: 'rapid', x: s0[0], y: s0[1], z: zs, ...(five ? { a: w0 } : {}) }, { t: 'rapid', x: s0[0], y: s0[1], z: s0[2], ...(five ? { a: w0 } : {}) })
      turnAt.set(i, i === 0 ? up : endAxis[i - 1])
    }
    const e1 = offEnd[i]
    if (e1) {
      const zs = turnZ(e1, i + 1 < paths.length ? offStart[i + 1] : null)
      moves.push({ t: 'rapid', x: e1[0], y: e1[1], z: e1[2], ...(five ? { a: w1 } : {}) }, { t: 'rapid', x: e1[0], y: e1[1], z: zs, ...(five ? { a: w1 } : {}) })
    }
    return { ...tp, moves }
  })
  // each 5-axis move's direction: halfway between where it starts and ends
  const moveAxes = paths.map((tp) => {
    if (!tp.multiAxis) return null
    const out: V3[] = []
    let prev: V3 | null = null
    for (const m of simpleMoves(tp.moves)) {
      const a: V3 = m.t === 'rapid' || m.t === 'feed' ? dirOf(m, prev ?? up) : (prev ?? up)
      out.push(prev ? slerp(prev, a, 0.5) : a)
      prev = a
    }
    return out
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
    const w = moveAxes[path]?.[s.move] ?? axes[path]
    s.axis = { x: w[0], y: w[1], z: w[2] }
    // drilling along a tilted tool is carved (not edge drilling)
    delete s.side
    const f = flutes[path]
    if (f) s.cutter = { ...s.cutter, flute: f }
    if (!seen.has(s.op)) {
      seen.add(s.op)
      const from = turnAt.get(path)
      if (from) {
        s.turn = true
        s.turnFrom = { x: from[0], y: from[1], z: from[2] }
        // (the turn ends on the operation's first direction)
        const w0 = startAxis[path]
        s.axis = { x: w0[0], y: w0[1], z: w0[2] }
      }
    }
  }
  return { tl, paths, axes, ...(program ? { program } : {}), ...(program5 ? { program5 } : {}) }
}

/** A tri-dexel stock of the part's block (fewer pieces per ray on big blocks, to keep memory down). */
export function positionalStock(part: Block, cell?: number): TriDexelStock {
  const c = cell ?? Math.max(0.5, tridexelCell(part.length, part.width, part.thickness))
  const nx = Math.ceil(part.length / c)
  const ny = Math.ceil(part.width / c)
  const nz = Math.ceil(part.thickness / c)
  return new TriDexelStock(part.length, part.width, part.thickness, c, nx * ny + ny * nz + nx * nz > 5e5 ? 6 : 12)
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

/** The turn between operations (M3.5). */
const TURN_TEXT = 'tool or holder hits material while the rotary axes turn between operations'

const KIND_TEXT: Record<CollisionKind, string> = {
  shank: 'shank hits material above the flutes (tool too short for this depth)',
  holder: 'holder hits material',
  rapid: 'rapid move through material',
  spoilboard: 'cuts deeper into the spoilboard than allowed',
  table: 'goes through the spoilboard into the table',
  axis: 'tool tip reaches the rotary axis',
  fixture: 'hits a fixture',
}

/**
 * Collision check of a part's 3+2 program on a tri-dexel stock of its block (or `opts.stock`,
 * e.g. a blank already cut to shape), carved as it goes. Returns the collisions in program order,
 * the timeline and the finished stock.
 */
export function positionalCollisions(part: Block & Pick<CamPart, 'fixtures'>, toolpaths: readonly Toolpath[], machine: MachineProfile, opts: { cell?: number; work?: Work; stock?: TriDexelStock; tol?: number; replay?: MachineProfile; marks?: StockMarks } = {}): { found: Collision[]; run: PositionalRun; stock: TriDexelStock } {
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
  const report = (kind: CollisionKind, text: string, op: number, move: number, t: number, at: { x: number; y: number; z: number }, depth: number, fixture?: number) => {
    const key = `${kind}:${text}`
    const c = open.get(key)
    if (c && c.op === op && move <= c.move + c.moves) {
      c.moves = move - c.move + 1
      if (depth > c.depth) c.depth = depth
      return
    }
    const n: Collision = { kind, op, move, moves: 1, t, at, depth, message: text, ...(fixture !== undefined ? { fixture } : {}) }
    open.set(key, n)
    out.push(n)
  }
  const segs = tl.segs
  // M3.6: the part's clamps, pods and rails, against the whole tool along its own direction
  const fixtures = fixturePieces(part.fixtures)
  const region = fixturesBox(fixtures)
  const bodies = new Map<number, ReturnType<typeof toolBody>>()
  const bodyOf = (s: (typeof segs)[number]) => {
    let b = bodies.get(s.op)
    if (!b) bodies.set(s.op, (b = toolBody(s.cutter, outlines[s.op], top)))
    return b
  }
  const checkFixtures = (s: (typeof segs)[number], w0: V3, w1?: V3) => {
    for (const h of fixtureHits(fixtures, region, bodyOf(s), [s.a.x, s.a.y, s.a.z], [s.b.x, s.b.y, s.b.z], w0, M, { w1 })) {
      const at = { x: s.a.x + (s.b.x - s.a.x) * h.k, y: s.a.y + (s.b.y - s.a.y) * h.k, z: s.a.z + (s.b.z - s.a.z) * h.k }
      report('fixture', fixtureText(h), s.op, s.move, s.t0 + (s.t1 - s.t0) * h.k, at, h.depth, h.fixture)
    }
  }
  // shank, holder and rapid checks every `spacing` mm along each operation
  const spacing = Math.max(stock.cell, 1)
  /**
   * M3.5 (closes the M3.4 limit): the move between operations while the rotary axes turn, checked as
   * an even turn of the tool from one direction to the other along the move: the whole tool, its
   * shank and its holder against the material left, and against the table round the part.
   */
  const checkTurn = (s: (typeof segs)[number]) => {
    const o = outlines[s.op]
    const from: V3 = s.turnFrom ? [s.turnFrom.x, s.turnFrom.y, s.turnFrom.z] : [0, 0, 1]
    const to: V3 = s.axis ? [s.axis.x, s.axis.y, s.axis.z] : [0, 0, 1]
    const ps = [...toolPieces(s.cutter, s.cutter.flute ?? o?.flute ?? top), ...(o ? [...shankPieces(o, M, top), ...holderPieces(o, M, top)] : [])]
    const L = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y, s.b.z - s.a.z)
    const n = Math.max(2, Math.ceil(Math.max(L / spacing, angleDeg(from, to))))
    for (let q = 0; q <= n; q++) {
      const k = q / n
      const p = { x: s.a.x + (s.b.x - s.a.x) * k, y: s.a.y + (s.b.y - s.a.y) * k, z: s.a.z + (s.b.z - s.a.z) * k }
      const w = slerp(from, to, k)
      const t = s.t0 + (s.t1 - s.t0) * k
      const r = stock.probe(p, { x: w[0], y: w[1], z: w[2] }, ps)
      if (r.depth > COLLISION_TOL) report('rapid', TURN_TEXT, s.op, s.move, t, p, r.depth)
      const low = lowestZ([p.x, p.y, p.z], w, ps)
      if (low < -T - COLLISION_TOL) report('table', 'tool or holder reaches below the part\'s underside while the rotary axes turn', s.op, s.move, t, p, -T - low)
    }
  }
  let lastOp = -1
  let travelled = 0
  let mark = 0
  let carved = 0
  for (let si = 0; si < segs.length; si++) {
    if ((si & 255) === 0) {
      checkCancel(opts.work?.isCancelled)
      opts.work?.progress?.(si / segs.length, 'Collision check (3+2)')
    }
    const s = segs[si]
    if (opts.marks) mark = takeMarks(opts.marks, stock, s.t0, mark, carved)
    if (s.turn) {
      checkTurn(s)
      if (region) checkFixtures(s, s.turnFrom ? [s.turnFrom.x, s.turnFrom.y, s.turnFrom.z] : [0, 0, 1], s.axis ? [s.axis.x, s.axis.y, s.axis.z] : [0, 0, 1])
      continue
    }
    const w: V3 = s.axis ? [s.axis.x, s.axis.y, s.axis.z] : [0, 0, 1]
    if (region) checkFixtures(s, w)
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
    if (!rapid) {
      const c0 = opts.marks ? performance.now() : 0
      stock.carve(s.a, s.b, s.cutter, s.axis)
      if (opts.marks) carved += performance.now() - c0
    }
  }
  for (const c of out) {
    const name = tl.ops[c.op]?.name ?? 'Operation'
    const span = c.moves > 1 ? `moves ${c.move + 1}-${c.move + c.moves}` : `move ${c.move + 1}`
    c.message = `${name}, ${span}: ${c.message} at X${c.at.x.toFixed(1)} Y${c.at.y.toFixed(1)} Z${c.at.z.toFixed(1)} (${c.depth.toFixed(2)} mm).`
  }
  return { found: out, run, stock }
}
