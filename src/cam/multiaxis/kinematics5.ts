/**
 * Simultaneous 5-axis conversion to machine axes (M3.5), our own kinematics on the machine model
 * (the same two rotary axes and layouts as positional 3+2, `positional/kinematics.ts`).
 *
 * For every point of a toolpath (tool tip and tool direction, part frame) both closed-form axis
 * solutions are known. Along a path we follow one branch, each point taking the solution nearest
 * the last one (angles never wrapped, so an axis that keeps turning keeps counting):
 * - head flip (NEW-26): the branch at the start is the usual one (least turn of the first axis),
 *   the other one (head or table turned the other way round), or, 'auto', the usual one unless only
 *   the other stays inside the travel all the way;
 * - poles: where the tool points along the axis whose angle is then free (the first axis of a head
 *   or table-and-head layout, the second of a trunnion table), that angle is held from the points
 *   next to it, so the axis does not spin for nothing;
 * - between points the machine moves its five axes evenly, so the tip does not run quite straight in
 *   the part: each move is split until its middle, played back through the kinematics, lies within
 *   the tolerance of the straight move (and the tool direction within 0.05°).
 * Machine X, Y, Z come from `toMachine`; the replay (`fromMachine`) turns a program back into the
 * part for the simulator.
 *
 * Pure: no DOM, no React.
 */
import { effectiveGauge, machineModelOf } from '@/core/machineModel'
import type { MachineProfile, PositionalKinematics } from '@/core/types'
import type { FeedKind, Move, Toolpath } from '../toolpath'
import { partFrameMoves } from '../positional/convert'
import { AXIS_OF, type Angles, fromMachine, headLength, pickAngles, positionalAxes, solveAngles, toMachine } from '../positional/kinematics'
import { angleDeg, cross, dot, len, slerp, sub, unit, type V3 } from './axis'
import { axisNodes, type AxisNode } from './result'

/** A tool direction within this angle (radians) of a pole counts as on it. */
const POLE = 1e-7

/** A rotary axis turning more than this (degrees) within one move is a swing: refused on cutting moves, noted on rapids. */
const SWING = 90

export interface MachineMove5 {
  t: 'rapid' | 'feed'
  /** Machine X, Y, Z. */
  x: number
  y: number
  z: number
  /** The two rotary axes, degrees (never wrapped), first then second. */
  a1: number
  a2: number
  f?: FeedKind
  k?: number
  /** Feed moves: how far the tool tip travels on the part, mm (for inverse-time feeds). */
  len?: number
  /** Tool tip and direction in the part (as asked for). */
  tip: V3
  tool: V3
}

export interface MachineOp5 {
  name: string
  /** Index into the toolpaths given. */
  path: number
  letters: [PositionalKinematics['first'], PositionalKinematics['second']]
  /** Pivot plus stick-out used for the head (0 with tool-centre-point control or table axes only). */
  L: number
  /** Which branch it runs on (from the start of the operation). */
  solution: 'usual' | 'other'
  /** A 5-axis toolpath (the axes move while cutting), or a flat / tilted one with its angles held. */
  simultaneous: boolean
  moves: MachineMove5[]
  notes: string[]
}

export interface MachineProgram5 {
  ops: MachineOp5[]
  /** Why (some of) it cannot run on this machine: each blocks writing. */
  problems: string[]
  travel: Record<'X' | 'Y' | 'Z' | 'A1' | 'A2', [number, number]>
}

/** The pole the tool direction sits on, if any: which axis is then free. */
export function poleOf(kin: Pick<PositionalKinematics, 'layout' | 'first' | 'second'>, v: readonly number[]): 'first' | 'second' | null {
  const k = kin.layout === 'table-table' ? AXIS_OF[kin.second] : AXIS_OF[kin.first]
  return len(cross(v, k)) < POLE ? (kin.layout === 'table-table' ? 'second' : 'first') : null
}

/** Angle (degrees) that turns `from` onto `to` about unit k, both seen square to k. */
function angleAbout(k: readonly number[], from: readonly number[], to: readonly number[]): number {
  const fp = sub(from, k.map((q) => q * dot(from, k)))
  const tp = sub(to, k.map((q) => q * dot(to, k)))
  return (Math.atan2(dot(k, cross(fp, tp)), dot(fp, tp)) * 180) / Math.PI
}

const rot = (k: readonly number[], deg: number, v: readonly number[]): V3 => {
  const t = (deg * Math.PI) / 180
  const c = Math.cos(t)
  const s = Math.sin(t)
  const kv = cross(k, v)
  const kd = dot(k, v)
  return [v[0] * c + kv[0] * s + k[0] * kd * (1 - c), v[1] * c + kv[1] * s + k[1] * kd * (1 - c), v[2] * c + kv[2] * s + k[2] * kd * (1 - c)]
}

/** On a pole: the free axis held at `held`, the other solved. */
function solveHeld(kin: Pick<PositionalKinematics, 'layout' | 'first' | 'second'>, v: readonly number[], held: number): Angles {
  const k1 = AXIS_OF[kin.first]
  const k2 = AXIS_OF[kin.second]
  const Z: V3 = [0, 0, 1]
  if (kin.layout === 'head-head') return { first: held, second: angleAbout(k2, Z, rot(k1, -held, v)) }
  if (kin.layout === 'table-head') return { first: held, second: angleAbout(k2, Z, rot(k1, held, v)) }
  // table-table: v = R2(-a2) R1(-a1) Z, a2 held
  return { first: -angleAbout(k1, Z, rot(k2, held, v)), second: held }
}

/** `a` moved by whole turns to lie nearest `near`, inside [min, max]; null when no turn fits. */
function nearestTurn(a: number, near: number, lim: { min: number; max: number }): number | null {
  let best: number | null = null
  const n0 = Math.round((near - a) / 360)
  for (const n of [n0, n0 - 1, n0 + 1, n0 - 2, n0 + 2]) {
    const x = a + 360 * n
    if (x < lim.min - 1e-9 || x > lim.max + 1e-9) continue
    if (best === null || Math.abs(x - near) < Math.abs(best - near) - 1e-12) best = x
  }
  return best
}

interface Lims {
  first: { min: number; max: number }
  second: { min: number; max: number }
}

/** The solution for direction v nearest the angles `prev` (inside the travel), or null. */
function nearestSolution(kin: PositionalKinematics, lims: Lims, v: readonly number[], prev: Angles): Angles | null {
  const pole = poleOf(kin, v)
  const cands = pole ? [solveHeld(kin, v, pole === 'first' ? prev.first : prev.second)] : solveAngles(kin, v)
  let best: Angles | null = null
  let cost = Infinity
  for (const c of cands) {
    const f = nearestTurn(c.first, prev.first, lims.first)
    const s = nearestTurn(c.second, prev.second, lims.second)
    if (f === null || s === null) continue
    const d = Math.abs(f - prev.first) + Math.abs(s - prev.second)
    if (d < cost - 1e-12) {
      cost = d
      best = { first: f, second: s }
    }
  }
  return best
}

/** A toolpath's points with their tool directions (part frame): 5-axis as made, others along their fixed direction. */
export function pathNodes(tp: Toolpath, tol = 0.001): AxisNode[] {
  if (tp.multiAxis) return axisNodes(tp.moves)
  const { moves, axis } = partFrameMoves(tp, tol)
  const a: V3 = [axis[0], axis[1], axis[2]]
  return axisNodes(moves.map((m) => (m.t === 'rapid' || m.t === 'feed' ? { ...m, a } : m)) as Move[])
}

/**
 * Angles along a path on one branch from `start` (worked out from its first direction off a pole, so
 * points on a pole before it hold the free axis there), or why not.
 */
function follow(kin: PositionalKinematics, lims: Lims, nodes: readonly AxisNode[], start: Angles): { angles: Angles[]; error?: string; swing: { at: number; deg: number } | null } {
  const out: Angles[] = []
  let prev = start
  let swing: { at: number; deg: number } | null = null
  for (let i = 0; i < nodes.length; i++) {
    const s = nearestSolution(kin, lims, nodes[i].a, prev)
    if (!s) return { angles: out, error: `move ${i + 1} needs the tool along (${nodes[i].a.map((q) => q.toFixed(3)).join(', ')}), which the ${kin.first} and ${kin.second} axes cannot reach inside their travel from where they are`, swing }
    const d = Math.max(Math.abs(s.first - prev.first), Math.abs(s.second - prev.second))
    // a rotary axis swinging round within one cutting move (out of travel, or through a pole): refused
    if (i > 0 && d > SWING && nodes[i].kind !== 'rapid')
      return { angles: out, error: `the ${Math.abs(s.first - prev.first) >= Math.abs(s.second - prev.second) ? kin.first : kin.second} axis would swing ${d.toFixed(1)}° within one cutting move (move ${i + 1}): it runs out of travel there, or the tool passes through a pole`, swing }
    if (i > 0 && d > SWING && (!swing || d > swing.deg)) swing = { at: i, deg: d }
    out.push(s)
    prev = s
  }
  return { angles: out, swing }
}

/** The angles the path starts on for a head-flip choice: from its first direction off a pole. */
function startAngles(model: ReturnType<typeof machineModelOf>, kin: PositionalKinematics, nodes: readonly AxisNode[], other: boolean): Angles | { error: string } {
  const i = nodes.findIndex((n) => !poleOf(kin, n.a))
  const v = i >= 0 ? nodes[i].a : (nodes[0]?.a ?? [0, 0, 1])
  const p = pickAngles(model, v, other)
  if ('error' in p) return p
  return p.angles
}

/**
 * Toolpaths (5-axis, tilted or flat) as a simultaneous 5-axis program for a machine model with
 * simultaneous 5-axis: every move as machine X, Y, Z and both rotary angles. `tol`: how far the tip
 * may run off a straight move between points (mm).
 */
export function simultaneousProgram(paths: readonly Toolpath[], machine: MachineProfile, opts: { tol?: number } = {}): MachineProgram5 {
  const model = machineModelOf(machine)
  const travel: MachineProgram5['travel'] = { X: [Infinity, -Infinity], Y: [Infinity, -Infinity], Z: [Infinity, -Infinity], A1: [Infinity, -Infinity], A2: [Infinity, -Infinity] }
  const ax = positionalAxes(model)
  if ('error' in ax) return { ops: [], problems: [`${machine.name}: ${ax.error}.`], travel }
  if (!model.capabilities.simultaneous5) return { ops: [], problems: [`${machine.name}: its machine model does not declare simultaneous 5-axis (its rotary axes do not move while cutting).`], travel }
  const kin = ax.kin
  const lims: Lims = { first: ax.first, second: ax.second }
  const tol = Math.max(1e-4, opts.tol ?? 0.01)
  const problems: string[] = []
  const ops: MachineOp5[] = []
  let last: Angles | null = null
  paths.forEach((tp, path) => {
    if (tp.rotary) {
      problems.push(`${tp.name}: turned (rotary) work is not part of a 5-axis program.`)
      return
    }
    const nodes = pathNodes(tp)
    if (!nodes.length) return
    const want: 'usual' | 'other' | 'auto' = tp.multiAxis ? tp.multiAxis.headFlip : tp.tilt?.plane.flip ? 'other' : 'usual'
    const notes: string[] = []
    // try the asked-for branch (auto: usual, then other)
    const tries: ('usual' | 'other')[] = want === 'auto' ? ['usual', 'other'] : [want]
    let chosen: { solution: 'usual' | 'other'; angles: Angles[]; swing: { at: number; deg: number } | null } | null = null
    let why = ''
    for (const sol of tries) {
      const st = startAngles(model, kin, nodes, sol === 'other')
      if ('error' in st) {
        why = st.error
        continue
      }
      // the same angles by whole turns: nearest where the last operation left the axes first, then
      // the other turns inside the travel (a path that turns an axis one way may only fit from one end)
      const near = last ? { first: nearestTurn(st.first, last.first, lims.first) ?? st.first, second: nearestTurn(st.second, last.second, lims.second) ?? st.second } : st
      const starts = [near]
      const fits = (v: number, l: { min: number; max: number }) => v >= l.min - 1e-9 && v <= l.max + 1e-9
      for (const n1 of [0, -1, 1, -2, 2])
        for (const n2 of [0, -1, 1, -2, 2]) {
          const f = near.first + 360 * n1
          const g = near.second + 360 * n2
          if ((n1 || n2) && fits(f, lims.first) && fits(g, lims.second)) starts.push({ first: f, second: g })
        }
      for (const start of starts) {
        const r = follow(kin, lims, nodes, start)
        if (r.error) {
          if (!why || start === near) why = r.error
          continue
        }
        chosen = { solution: sol, angles: r.angles, swing: r.swing }
        break
      }
      if (chosen) break
    }
    if (!chosen) {
      problems.push(`${tp.name}: ${why}.`)
      return
    }
    if (want === 'auto' && chosen.solution === 'other') notes.push('Head flip: the usual solution leaves the axes\' travel, so the other one (turned the other way round) is used.')
    if (chosen.swing) notes.push(`The rotary axes swing ${chosen.swing.deg.toFixed(1)}° on a move between cuts (move ${chosen.swing.at + 1}).`)
    let L = 0
    if (!kin.tcp && kin.layout !== 'table-table') {
      const g = tp.tool ? effectiveGauge(machine, tp.tool) : { gauge: Infinity, assumed: false }
      if (!Number.isFinite(g.gauge)) {
        problems.push(`${tp.name}: the head turns about a pivot and the controller does not keep the tip on the point, so the tool's stick-out is needed (give the tool a stick-out or a holder).`)
        return
      }
      if (g.assumed) notes.push(`T${tp.tool!.number}: stick-out assumed (the flute length); give the real one.`)
      L = headLength(kin, g.gauge)
    }
    const moves: MachineMove5[] = []
    const emit = (n: { tip: V3; tool: V3; ang: Angles; kind: AxisNode['kind']; k?: number }, from: V3 | null) => {
      const { xyz } = toMachine(kin, n.ang, n.tip, L)
      const m: MachineMove5 = { t: n.kind === 'rapid' ? 'rapid' : 'feed', x: xyz[0], y: xyz[1], z: xyz[2], a1: n.ang.first, a2: n.ang.second, tip: n.tip, tool: n.tool }
      if (n.kind !== 'rapid') {
        m.f = n.kind
        if (n.k) m.k = n.k
        m.len = from ? len(sub(n.tip, from)) : 0
      }
      moves.push(m)
      for (const [key, v] of [['X', xyz[0]], ['Y', xyz[1]], ['Z', xyz[2]], ['A1', n.ang.first], ['A2', n.ang.second]] as const) {
        travel[key][0] = Math.min(travel[key][0], v)
        travel[key][1] = Math.max(travel[key][1], v)
      }
    }
    // split a move until the machine's even axis motion keeps the tip on it
    const split = (a: { tip: V3; tool: V3; ang: Angles }, b: { tip: V3; tool: V3; ang: Angles; kind: AxisNode['kind']; k?: number }, depth: number) => {
      const ma = toMachine(kin, a.ang, a.tip, L).xyz
      const mb = toMachine(kin, b.ang, b.tip, L).xyz
      const midAng = { first: (a.ang.first + b.ang.first) / 2, second: (a.ang.second + b.ang.second) / 2 }
      const played = fromMachine(kin, midAng, [(ma[0] + mb[0]) / 2, (ma[1] + mb[1]) / 2, (ma[2] + mb[2]) / 2], L)
      const tip: V3 = [(a.tip[0] + b.tip[0]) / 2, (a.tip[1] + b.tip[1]) / 2, (a.tip[2] + b.tip[2]) / 2]
      const tool = slerp(a.tool, b.tool, 0.5)
      if (depth < 12 && (len(sub(played.tip, tip)) > tol || angleDeg(played.tool, tool) > 0.05)) {
        const ang = nearestSolution(kin, lims, tool, midAng) ?? midAng
        const mid = { tip, tool, ang, kind: b.kind, k: b.k }
        split(a, mid, depth + 1)
        split(mid, b, depth + 1)
        return
      }
      emit(b, a.tip)
    }
    nodes.forEach((n, i) => {
      const cur = { tip: [n.x, n.y, n.z] as V3, tool: unit(n.a), ang: chosen!.angles[i], kind: n.kind, k: n.k }
      if (i === 0) emit(cur, null)
      else {
        const p = nodes[i - 1]
        split({ tip: [p.x, p.y, p.z], tool: unit(p.a), ang: chosen!.angles[i - 1] }, cur, 0)
      }
    })
    last = chosen.angles[chosen.angles.length - 1]
    ops.push({ name: tp.name, path, letters: [kin.first, kin.second], L, solution: chosen.solution, simultaneous: !!tp.multiAxis, moves, notes })
  })
  for (const id of ['X', 'Y', 'Z'] as const) {
    const a = model.axes.find((x) => x.id === id)
    const [lo, hi] = travel[id]
    if (!a || !Number.isFinite(lo)) continue
    if (lo < a.min - 1e-6 || hi > a.max + 1e-6) problems.push(`The program moves ${id} from ${lo.toFixed(2)} to ${hi.toFixed(2)} mm, outside its travel (${a.min} to ${a.max} mm) in ${machine.name}'s machine model.`)
  }
  return { ops, problems, travel }
}

/**
 * The kinematic replay of a 5-axis program: each machine move played as the machine makes it (its
 * five axes moving evenly), in steps of at most `stepDeg` of either rotary axis, turned back into
 * the part: tool tip and direction as moves with `a`, for the simulator.
 */
export function replaySimultaneous(op: MachineOp5, kin: PositionalKinematics, stepDeg = 0.5): Move[] {
  const out: Move[] = []
  let prev: MachineMove5 | null = null
  for (const m of op.moves) {
    const n = prev ? Math.max(1, Math.ceil(Math.max(Math.abs(m.a1 - prev.a1), Math.abs(m.a2 - prev.a2)) / stepDeg)) : 1
    for (let s = 1; s <= n; s++) {
      const f = s / n
      const p = prev ?? m
      const ang = { first: p.a1 + (m.a1 - p.a1) * f, second: p.a2 + (m.a2 - p.a2) * f }
      const r = fromMachine(kin, ang, [p.x + (m.x - p.x) * f, p.y + (m.y - p.y) * f, p.z + (m.z - p.z) * f], op.L)
      const a = unit(r.tool)
      out.push(m.t === 'rapid' ? { t: 'rapid', x: r.tip[0], y: r.tip[1], z: r.tip[2], a } : { t: 'feed', x: r.tip[0], y: r.tip[1], z: r.tip[2], f: m.f ?? 'cut', a, ...(m.k ? { k: m.k } : {}) })
    }
    prev = m
  }
  return out
}
