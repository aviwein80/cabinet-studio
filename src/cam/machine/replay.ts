/**
 * The machine replay (M3.6, SIM-06): a program as the machine runs it, step by step, as positions
 * of the machine's axes. Made either from the part's toolpaths converted for the machine (what the
 * posts receive: 3-axis moves with the part placed on the table, or the 3+2 and 5-axis
 * conversions of the machine model's kinematics) or read back from a program's text (a post's
 * G-code with its rotary axes, or our own MPR), so the whole machine can be simulated and checked
 * from the post output.
 *
 * Between operations the replay does what the sample posts do: for a tool change it rises to the
 * tool-change height, goes to the tool-change place, changes the tool and comes back over the
 * first point; where only the rotary axes change it rises, turns the axes while moving over, and
 * comes down. A program read back is replayed exactly as written.
 *
 * Pure: no DOM, no React.
 */
import { effectiveGauge, machineModelOf, toolOutline, type CutterOutline } from '@/core/machineModel'
import type { MachineProfile, Tool } from '@/core/types'
import type { Vec } from '../collision/convex'
import { RAPID_RATE } from '../moves'
import { machineProgram, straightMoves } from '../positional/convert'
import { needsPositional } from '../positional/sim'
import { type AxisProgram, isMprText, readGcodeAxes, readProgram } from '../programRead'
import { simultaneousProgram } from '../multiaxis/kinematics5'
import { cutterOf, type Cutter, programOrder, type SimTimeline } from '../sim'
import type { Toolpath } from '../toolpath'
import type { CamPart } from '../types'
import { type AxisState, kinOf } from './model'

/** The tool in the spindle for a stretch of the replay. */
export interface ReplayOp {
  name: string
  tool: Tool | null
  cutter: Cutter
  outline: CutterOutline | null
  /** Tip to the tool's gauge point (mm); 0 when unknown (no holder, no stick-out). */
  stickOut: number
}

export interface ReplayStep {
  from: AxisState
  to: AxisState
  kind: 'rapid' | 'feed' | 'change'
  /** Index into `ops`. */
  op: number
  /** Move within the operation (0-based; the moves between operations count with the next one). */
  move: number
  t0: number
  t1: number
  /** Time on the cutting simulation's timeline at the step's end (the stock to show), when known. */
  stockT?: number
  /** Between operations: rising, the tool change, turning the axes, coming down. */
  link?: boolean
  /** Line of the program read back. */
  line?: number
}

export interface MachineReplay {
  steps: ReplayStep[]
  ops: ReplayOp[]
  total: number
  /** The rotary axes' letters (first, second), or null on a 3-axis machine. */
  letters: [string, string] | null
  /** Where the part's face-1 corner is, machine coordinates with every axis at 0. */
  partAt: Vec
  /** What could not be replayed, and why. */
  problems: string[]
  notes: string[]
  source: 'toolpaths' | 'program'
}

type Block = Pick<CamPart, 'length' | 'width' | 'thickness'>

/** Seconds the tool change takes in the replay (for playback only). */
const CHANGE_S = 6
/** Rotary axes' rapid rate in the replay, degrees per minute (for playback only). */
const ROTARY_RATE = 7200

/** Where the part sits: the 3+2 kinematics say; on a 3-axis machine its face-1 corner at X, Y on the spoilboard's top. */
export function partPlacement(machine: MachineProfile, part: Block, at?: { x: number; y: number }): Vec {
  const k = kinOf(machineModelOf(machine))
  if (k) return [k.partAt.x, k.partAt.y, k.partAt.z]
  return [at?.x ?? 0, at?.y ?? 0, part.thickness]
}

function opOf(name: string, tool: Tool | null, machine: MachineProfile, notes: string[], cutter?: Cutter): ReplayOp {
  const g = tool ? effectiveGauge(machine, tool) : null
  // no stick-out known (no holder, none given): the shortest it can be, its cutting length (the head as low as it can come)
  let stickOut = g && Number.isFinite(g.gauge) ? g.gauge : (tool?.fluteLength ?? tool?.maxDepth ?? 30)
  if (!(stickOut > 0)) stickOut = 30
  if (tool && (!g || !Number.isFinite(g.gauge) || g.assumed)) {
    const n = `T${tool.number}: stick-out not known, ${stickOut} mm (its cutting length) assumed.`
    if (!notes.includes(n)) notes.push(n)
  }
  if (tool?.type === 'drill-vertical' || tool?.type === 'drill-horizontal') {
    const n = `T${tool.number} is a drill: replayed in the spindle's place (the drill block's offset is not in the machine model).`
    if (!notes.includes(n)) notes.push(n)
  }
  const outline = tool ? toolOutline(machine, tool) : null
  return { name, tool, cutter: cutter ?? (tool ? { r: tool.diameter / 2, shape: tool.shape ?? 'flat', angle: tool.angle ?? 90 } : { r: 3, shape: 'flat', angle: 90 }), outline: outline ? { ...outline, gauge: stickOut } : null, stickOut }
}

/** Builds the steps, with timing and the moves between operations. */
class Steps {
  steps: ReplayStep[] = []
  t = 0
  at: AxisState
  constructor(home: AxisState) {
    this.at = { ...home }
  }
  go(to: AxisState, kind: ReplayStep['kind'], op: number, move: number, rate: number, extra: Partial<ReplayStep> = {}) {
    const l = Math.hypot(to.x - this.at.x, to.y - this.at.y, to.z - this.at.z)
    const turn = Math.abs(to.a1 - this.at.a1) + Math.abs(to.a2 - this.at.a2)
    if (l < 1e-9 && turn < 1e-9 && kind !== 'change') return
    const dt = kind === 'change' ? CHANGE_S : Math.max(l / Math.max(1e-6, rate), turn / (ROTARY_RATE / 60), 1e-4)
    this.steps.push({ from: this.at, to: { ...to }, kind, op, move, t0: this.t, t1: this.t + dt, ...extra })
    this.t += dt
    this.at = { ...to }
  }
  /** Rise to `zUp`, (change the tool at `tc`,) turn the axes while moving over the next point, come down. */
  between(next: AxisState, op: number, zUp: number, tc: { x: number; y: number; z: number } | null, stockT?: number) {
    const R = RAPID_RATE / 60
    const e = { link: true, ...(stockT !== undefined ? { stockT } : {}) }
    if (tc) {
      this.go({ ...this.at, z: Math.max(this.at.z, tc.z) }, 'rapid', op, 0, R, e)
      this.go({ ...this.at, x: tc.x, y: tc.y, z: tc.z }, 'rapid', op, 0, R, e)
      this.go({ ...this.at }, 'change', op, 0, R, e)
      this.go({ x: next.x, y: next.y, z: Math.max(tc.z, next.z), a1: next.a1, a2: next.a2 }, 'rapid', op, 0, R, e)
    } else {
      this.go({ ...this.at, z: Math.max(this.at.z, zUp) }, 'rapid', op, 0, R, e)
      this.go({ x: next.x, y: next.y, z: Math.max(zUp, next.z), a1: next.a1, a2: next.a2 }, 'rapid', op, 0, R, e)
    }
    this.go(next, 'rapid', op, 0, R, e)
  }
}

/** Where each toolpath runs on the cutting simulation's timeline, by operation id. */
export function stockSpans(tl: SimTimeline, ordered: readonly Pick<Toolpath, 'opId'>[]): Record<string, { start: number; end: number }> {
  const out: Record<string, { start: number; end: number }> = {}
  for (const o of tl.ops) {
    const id = ordered[o.path]?.opId
    if (id !== undefined && !out[id]) out[id] = { start: o.start, end: o.end }
  }
  return out
}

/**
 * The part's toolpaths as the machine runs them (rotary toolpaths left out). `at`: where a part
 * goes on a 3-axis machine's table (its face-1 corner, X and Y). `spans`: each operation's stretch
 * of the cutting simulation's timeline (`stockSpans`), so each step knows the stock to show.
 */
export function replayToolpaths(toolpaths: readonly Toolpath[], part: Block, machine: MachineProfile, opts: { at?: { x: number; y: number }; spans?: Record<string, { start: number; end: number }> } = {}): MachineReplay {
  const model = machineModelOf(machine)
  const k = kinOf(model)
  const problems: string[] = []
  const notes: string[] = []
  const turned = toolpaths.filter((tp) => tp.rotary && tp.moves.length)
  if (turned.length) problems.push(`${turned.length} turned (rotary) operation(s) are not part of the machine replay.`)
  let paths = programOrder(toolpaths.filter((tp) => !tp.rotary && tp.moves.length))
  const tilted = needsPositional(paths)
  if (tilted && !k) {
    problems.push(`${machine.name} has no rotary axes: operations on tilted planes and 5-axis operations cannot run on it, so they are left out of the replay. Pick a machine with 3+2 axes.`)
    paths = paths.filter((tp) => !tp.tilt && !tp.multiAxis)
  }
  const partAt = partPlacement(machine, part, opts.at)
  const tc = model.toolChange
  const home: AxisState = { x: tc.x, y: tc.y, z: tc.z, a1: 0, a2: 0 }
  const S = new Steps(home)
  const ops: ReplayOp[] = []
  const letters: [string, string] | null = k ? [k.first, k.second] : null
  // the cutting timeline's span of each toolpath, for the stock to show
  const span = (path: number) => opts.spans?.[paths[path]?.opId ?? '']
  type MMove = { t: 'rapid' | 'feed'; x: number; y: number; z: number; a1: number; a2: number; f?: string; k?: number }
  // every operation as machine moves: 3-axis, the toolpath's straight moves (arcs within 0.01 mm,
  // drill cycles spelled out) with the part placed on the table; 3+2 or 5-axis, the machine
  // model's own conversion (what its posts receive)
  const list: { path: number; name: string; moves: MMove[] }[] = []
  if (!k)
    paths.forEach((tp, path) => {
      const moves = straightMoves(tp, 0.01)
        .filter((m) => m.t === 'rapid' || m.t === 'feed')
        .map((m) => {
          const q = m as { t: 'rapid' | 'feed'; x: number; y: number; z: number; f?: string; k?: number }
          return { t: q.t, x: q.x + partAt[0], y: q.y + partAt[1], z: q.z + partAt[2], a1: 0, a2: 0, f: q.f, k: q.k }
        })
      list.push({ path, name: tp.name, moves })
    })
  else {
    const five = paths.some((tp) => tp.multiAxis)
    const prog = five ? simultaneousProgram(paths, machine) : machineProgram(paths, machine)
    problems.push(...prog.problems)
    for (const op of prog.ops) {
      notes.push(...op.notes.map((n) => `${op.name}: ${n}`))
      const held = 'angles' in op ? op.angles : null
      list.push({ path: op.path, name: op.name, moves: op.moves.map((m) => ({ t: m.t, x: m.x, y: m.y, z: m.z, a1: 'a1' in m ? m.a1 : held!.first, a2: 'a2' in m ? m.a2 : held!.second, f: m.f, k: m.k })) })
    }
  }
  let lastTool: string | null = null
  for (const op of list) {
    if (!op.moves.length) continue
    const tp = paths[op.path]
    ops.push(opOf(op.name, tp.tool, machine, notes, cutterOf(tp)))
    const oi = ops.length - 1
    const sp = span(op.path)
    const m0 = op.moves[0]
    const first: AxisState = { x: m0.x, y: m0.y, z: m0.z, a1: m0.a1, a2: m0.a2 }
    const toolKey = tp.tool?.id ?? `none-${tp.opId}`
    const turns = Math.abs(first.a1 - S.at.a1) + Math.abs(first.a2 - S.at.a2) > 1e-9
    if (toolKey !== lastTool) S.between(first, oi, tc.z, { x: tc.x, y: tc.y, z: tc.z }, sp?.start)
    else if (turns) S.between(first, oi, tc.z, null, sp?.start)
    lastTool = toolKey
    const feed = Math.max(1, tp.feeds.feed) / 60
    const plunge = Math.max(1, tp.feeds.plunge || tp.feeds.feed) / 60
    // the stock to show: the cutting simulation's time, by the share of this operation's length done
    let total = 0
    let prev = first
    const lens = op.moves.map((m) => {
      const l = Math.hypot(m.x - prev.x, m.y - prev.y, m.z - prev.z)
      prev = m
      total += l
      return l
    })
    let done = 0
    op.moves.forEach((m, i) => {
      done += lens[i]
      const stockT = sp ? sp.start + (sp.end - sp.start) * (total > 0 ? done / total : (i + 1) / op.moves.length) : undefined
      const rate = m.t === 'rapid' ? RAPID_RATE / 60 : (m.f === 'plunge' ? plunge : feed) * (m.k ?? 1)
      S.go({ x: m.x, y: m.y, z: m.z, a1: m.a1, a2: m.a2 }, m.t, oi, i, rate, stockT !== undefined ? { stockT } : {})
    })
  }
  return { steps: S.steps, ops, total: S.t, letters, partAt, problems, notes, source: 'toolpaths' }
}

/**
 * A program's text (a post's output) replayed on the machine: our MPR read back (3-axis), or
 * G-code with the machine's rotary axes. Work coordinates are taken from the part's origin
 * (the sample posts' G54); G53 X / Y are the machine model's coordinates and G53 Z is measured
 * from the top of the Z travel (machine zero at the top, as on most controls). The tool's numbers
 * are looked up in the machine's tool table.
 */
export function replayProgram(text: string, part: Block, machine: MachineProfile, opts: { at?: { x: number; y: number } } = {}): MachineReplay {
  const model = machineModelOf(machine)
  const k = kinOf(model)
  const partAt = partPlacement(machine, part, opts.at)
  if (isMprText(text) || !k) {
    // a 3-axis program: read back into toolpaths (part frame, Z from the top) and replayed as the toolpaths are
    const read = readProgram(text, { machine })
    const r = replayToolpaths(read.toolpaths, part, machine, opts)
    return { ...r, problems: [...read.errors, ...r.problems], notes: [...read.warnings, ...r.notes], source: 'program' }
  }
  const prog: AxisProgram = readGcodeAxes(text, [k.first, k.second])
  const problems = [...prog.errors]
  const notes = [...prog.warnings]
  const zTop = model.axes.find((a) => a.id === 'Z')?.max ?? model.toolChange.z
  const tc = model.toolChange
  const S = new Steps({ x: tc.x, y: tc.y, z: tc.z, a1: 0, a2: 0 })
  const ops: ReplayOp[] = []
  const tools = new Map<number, Tool>(machine.tools.map((t) => [t.number, t]))
  const opFor = (tool: number | undefined, label: string) => {
    const t = tool !== undefined ? (tools.get(tool) ?? null) : null
    if (tool !== undefined && !t) notes.push(`T${tool} is not in ${machine.name}'s tool table: replayed without its holder.`)
    ops.push(opOf(label || (t ? `T${t.number} ${t.name}` : 'Program'), t, machine, notes))
  }
  let ci = 0
  let move = 0
  if (!prog.changes.length || prog.changes[0].at > 0) opFor(undefined, 'Program start')
  prog.blocks.forEach((b, bi) => {
    while (ci < prog.changes.length && prog.changes[ci].at <= bi) {
      const c = prog.changes[ci++]
      opFor(c.tool, c.label)
      move = 0
      // the tool change itself: at the tool-change place
      S.go({ ...S.at, z: Math.max(S.at.z, tc.z) }, 'rapid', ops.length - 1, 0, RAPID_RATE / 60, { link: true })
      S.go({ ...S.at, x: tc.x, y: tc.y, z: tc.z }, 'rapid', ops.length - 1, 0, RAPID_RATE / 60, { link: true })
      S.go({ ...S.at }, 'change', ops.length - 1, 0, RAPID_RATE / 60, { link: true })
    }
    const set = b.machine?.set
    const coord = (key: 'x' | 'y' | 'z', i: number) => {
      const v = b[key]
      if (set) return set.includes(key.toUpperCase() as 'X' | 'Y' | 'Z') ? (key === 'z' ? zTop + v : v) : S.at[key]
      return Number.isFinite(v) ? v + partAt[i] : S.at[key]
    }
    const to: AxisState = { x: coord('x', 0), y: coord('y', 1), z: coord('z', 2), a1: b.rot[k.first as 'A' | 'B' | 'C'] ?? S.at.a1, a2: b.rot[k.second as 'A' | 'B' | 'C'] ?? S.at.a2 }
    const l = Math.hypot(to.x - S.at.x, to.y - S.at.y, to.z - S.at.z)
    const op = ops[ops.length - 1]
    const rate = b.t === 'rapid' ? RAPID_RATE / 60 : b.inverse ? (b.f > 0 ? (l * b.f) / 60 : 1000 / 60) : Math.max(1, b.f || op.tool?.feed || 1000) / 60
    S.go(to, b.t, ops.length - 1, move++, rate, { line: b.ln })
  })
  return { steps: S.steps, ops, total: S.t, letters: [k.first, k.second], partAt, problems, notes, source: 'program' }
}

/** The step at program time t (binary search) and where the axes are. */
export function replayAt(r: MachineReplay, t: number): { step: number; s: AxisState } {
  const st = r.steps
  if (!st.length) return { step: -1, s: { x: 0, y: 0, z: 0, a1: 0, a2: 0 } }
  let lo = 0
  let hi = st.length - 1
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (st[m].t1 < t) lo = m + 1
    else hi = m
  }
  const q = st[lo]
  const k = q.t1 > q.t0 ? Math.max(0, Math.min(1, (t - q.t0) / (q.t1 - q.t0))) : 1
  const f = q.from
  const g = q.to
  return { step: lo, s: { x: f.x + (g.x - f.x) * k, y: f.y + (g.y - f.y) * k, z: f.z + (g.z - f.z) * k, a1: f.a1 + (g.a1 - f.a1) * k, a2: f.a2 + (g.a2 - f.a2) * k } }
}
