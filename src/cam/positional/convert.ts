/**
 * Positional (3+2) conversions (M3.4, 5AX-01). A toolpath on a tilted plane keeps the plane's own
 * frame (drawing x, y on its rectangle, z along its normal). From there:
 *
 * - to the part: every point turned into part coordinates, arcs as straight moves within a chord
 *   tolerance (helical entries within 0.01 mm at most), drill cycles spelled out as moves along
 *   the tool; with the tool direction. The
 *   simulator and the collision check use this.
 * - to machine axes: with a machine model that has two rotary axes for 3+2, the locked angles that
 *   put the tool on the plane's normal (`pickAngles`), and every point as the machine's X, Y, Z
 *   (`toMachine`), checked against the axes' travel. `replayMachine` turns such a program back
 *   into the part (the kinematic replay the simulation checks).
 * - to vertical: the same moves as a plain 3-axis program in the plane's own frame (x, y from its
 *   origin, z along its normal; arcs and drill cycles kept), for a controller that tilts its own
 *   working plane, or the part set on an angle fixture with the plane level.
 *
 * Face-1 toolpaths in the same program go through unchanged, the tool straight up.
 *
 * Pure: no DOM, no React.
 */
import { effectiveGauge, machineModelOf } from '@/core/machineModel'
import type { MachineProfile, PositionalKinematics } from '@/core/types'
import { simpleMoves } from '../moves'
import type { FeedKind, Move, Toolpath } from '../toolpath'
import type { TiltedPlane } from '../types'
import { planeFrame, planeToPart, type V3 } from './frame'
import { type Angles, fromMachine, headLength, pickAngles, positionalAxes, toMachine } from './kinematics'

const UP: V3 = [0, 0, 1]

/** Arc from (x0, y0, z0) to the move's end as points every chord within `tol` (the end included). */
function arcSteps(x0: number, y0: number, z0: number, m: { x: number; y: number; z: number; cx: number; cy: number; ccw: boolean }, tol: number): [number, number, number][] {
  const r = Math.hypot(x0 - m.cx, y0 - m.cy)
  const a0 = Math.atan2(y0 - m.cy, x0 - m.cx)
  let sw = Math.atan2(m.y - m.cy, m.x - m.cx) - a0
  if (m.ccw) while (sw <= 1e-12) sw += Math.PI * 2
  else while (sw >= -1e-12) sw -= Math.PI * 2
  const step = r > tol ? 2 * Math.acos(Math.max(-1, 1 - tol / r)) : Math.PI / 2
  const n = Math.max(1, Math.ceil(Math.abs(sw) / Math.max(1e-6, step)))
  const out: [number, number, number][] = []
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const a = a0 + sw * t
    out.push(i === n ? [m.x, m.y, m.z] : [m.cx + r * Math.cos(a), m.cy + r * Math.sin(a), z0 + (m.z - z0) * t])
  }
  return out
}

/** A toolpath as straight moves in its own frame: arcs within `tol`, drill cycles (with pecks) spelled out. */
export function straightMoves(tp: Pick<Toolpath, 'moves'>, tol = 0.001): Move[] {
  const out: Move[] = []
  let x = 0
  let y = 0
  let z = 50
  for (const m of simpleMoves(tp.moves)) {
    if (m.t === 'arc') {
      // helical arcs (entries) only clear room for the passes after them: chords within 0.01 mm
      // (a chord is inside its arc, so the tool cuts no more than the arc would)
      const t = Math.abs(m.z - z) > 1e-9 ? Math.max(tol, 0.01) : tol
      for (const [px, py, pz] of arcSteps(x, y, z, m, t)) out.push({ t: 'feed', x: px, y: py, z: pz, f: m.f, ...(m.k ? { k: m.k } : {}) })
    } else if (m.t === 'drill') {
      out.push({ t: 'rapid', x: m.x, y: m.y, z: m.r })
      if (m.peck > 0) {
        let at = Math.min(0, m.r)
        while (at > m.z + 1e-9) {
          const next = Math.max(m.z, at - m.peck)
          if (at < Math.min(0, m.r) - 1e-9) out.push({ t: 'rapid', x: m.x, y: m.y, z: at + 0.5 })
          out.push({ t: 'feed', x: m.x, y: m.y, z: next, f: 'plunge' })
          if (next > m.z + 1e-9) out.push({ t: 'rapid', x: m.x, y: m.y, z: m.r })
          at = next
        }
      } else out.push({ t: 'feed', x: m.x, y: m.y, z: m.z, f: 'plunge' })
      out.push({ t: 'rapid', x: m.x, y: m.y, z: m.r })
    } else out.push(m)
    x = m.x
    y = m.y
    z = m.t === 'drill' ? m.r : m.z
  }
  return out
}

/** The tool direction of a toolpath, part frame: the tilted plane's normal, else straight up. */
export function toolDirection(tp: Pick<Toolpath, 'tilt'>): V3 {
  return tp.tilt ? planeFrame(tp.tilt.plane).z : UP
}

/** A toolpath's moves in part coordinates (straight moves), and its tool direction. */
export function partFrameMoves(tp: Toolpath, tol = 0.001): { moves: Move[]; axis: V3 } {
  const moves = straightMoves(tp, tol)
  const plane = tp.tilt?.plane
  if (!plane) return { moves, axis: UP }
  const f = planeFrame(plane)
  return {
    moves: moves.map((m) => {
      if (m.t !== 'rapid' && m.t !== 'feed') return m
      const [x, y, z] = planeToPart(plane, m.x, m.y, m.z, f)
      return { ...m, x, y, z }
    }),
    axis: f.z,
  }
}

/** "Convert to vertical": a tilted toolpath as a plain 3-axis toolpath in its plane's own frame (x, y from the plane's origin, z along its normal). */
export function toVertical(tp: Toolpath): Toolpath {
  const p = tp.tilt?.plane
  if (!p) return tp
  const dx = p.at.x
  const dy = p.at.y
  const moves: Move[] = tp.moves.map((m) => {
    if (m.t === 'poly') {
      const pts = new Float64Array(m.pts)
      for (let i = 0; i + 2 < pts.length; i += 3) {
        pts[i] -= dx
        pts[i + 1] -= dy
      }
      return { ...m, pts }
    }
    if (m.t === 'arc') return { ...m, x: m.x - dx, y: m.y - dy, cx: m.cx - dx, cy: m.cy - dy }
    return { ...m, x: m.x - dx, y: m.y - dy }
  })
  const { tilt: _t, ...rest } = tp
  return { ...rest, moves }
}

// ---------------------------------------------------------------------------------------------
// Machine axes
// ---------------------------------------------------------------------------------------------

export interface MachineMove {
  t: 'rapid' | 'feed'
  /** Machine X, Y, Z with the operation's angles locked. */
  x: number
  y: number
  z: number
  f?: FeedKind
  k?: number
}

/** One operation of a 3+2 program: its locked angles and its moves in machine axes. */
export interface MachineOp {
  name: string
  /** Index into the toolpaths given. */
  path: number
  letters: [PositionalKinematics['first'], PositionalKinematics['second']]
  angles: Angles
  /** The other solution, when there is one inside the travel. */
  other: Angles | null
  /** Tool direction, part frame. */
  tool: V3
  /** Head offset used (pivot + stick-out; 0 with tool-centre-point control or table axes only). */
  L: number
  moves: MachineMove[]
  plane: TiltedPlane | null
  notes: string[]
}

export interface MachineProgram {
  ops: MachineOp[]
  /** Why (some of) it cannot run on this machine: each blocks writing. */
  problems: string[]
  /** Lowest and highest of each machine axis the program reaches. */
  travel: Record<'X' | 'Y' | 'Z', [number, number]>
}

/**
 * Toolpaths (tilted or face 1) converted to the machine's axes for positional 3+2 machining: the
 * locked angles per operation and every point as machine X, Y, Z. Rotary (turned) work cannot be
 * part of it.
 */
export function machineProgram(paths: readonly Toolpath[], machine: MachineProfile, opts: { tol?: number } = {}): MachineProgram {
  const model = machineModelOf(machine)
  const problems: string[] = []
  const travel: MachineProgram['travel'] = { X: [Infinity, -Infinity], Y: [Infinity, -Infinity], Z: [Infinity, -Infinity] }
  const ax = positionalAxes(model)
  if ('error' in ax) return { ops: [], problems: [`${machine.name}: ${ax.error}.`], travel }
  const kin = ax.kin
  const ops: MachineOp[] = []
  paths.forEach((tp, path) => {
    if (tp.rotary) {
      problems.push(`${tp.name}: turned (rotary) work is not part of a 3+2 program.`)
      return
    }
    const { moves, axis } = partFrameMoves(tp, opts.tol)
    const pick = pickAngles(model, axis, !!tp.tilt?.plane.flip)
    if ('error' in pick) {
      problems.push(`${tp.name}: ${pick.error}.`)
      return
    }
    const notes = pick.note ? [pick.note] : []
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
    const out: MachineMove[] = []
    for (const m of moves) {
      if (m.t !== 'rapid' && m.t !== 'feed') continue
      const { xyz } = toMachine(kin, pick.angles, [m.x, m.y, m.z], L)
      const q: MachineMove = { t: m.t, x: xyz[0], y: xyz[1], z: xyz[2] }
      if (m.t === 'feed') {
        q.f = m.f
        if (m.k) q.k = m.k
      }
      out.push(q)
      for (const [i, id] of (['X', 'Y', 'Z'] as const).entries()) {
        travel[id][0] = Math.min(travel[id][0], xyz[i])
        travel[id][1] = Math.max(travel[id][1], xyz[i])
      }
    }
    ops.push({ name: tp.name, path, letters: [kin.first, kin.second], angles: pick.angles, other: pick.other, tool: axis, L, moves: out, plane: tp.tilt?.plane ?? null, notes })
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
 * The kinematic replay: a 3+2 program's machine X, Y, Z and locked angles turned back into the
 * part (tool tip and direction), as toolpaths of straight moves the simulator plays.
 */
export function replayMachine(prog: MachineProgram, paths: readonly Toolpath[], kin: PositionalKinematics): { paths: Toolpath[]; axes: V3[] } {
  const out: Toolpath[] = []
  const axes: V3[] = []
  for (const op of prog.ops) {
    const src = paths[op.path]
    let axis: V3 = UP
    const moves: Move[] = op.moves.map((m) => {
      const r = fromMachine(kin, op.angles, [m.x, m.y, m.z], op.L)
      axis = r.tool
      return m.t === 'rapid' ? { t: 'rapid', x: r.tip[0], y: r.tip[1], z: r.tip[2] } : { t: 'feed', x: r.tip[0], y: r.tip[1], z: r.tip[2], f: m.f ?? 'cut', ...(m.k ? { k: m.k } : {}) }
    })
    if (!op.moves.length) axis = fromMachine(kin, op.angles, [0, 0, 0], op.L).tool
    const { tilt: _t, ...rest } = src
    out.push({ ...rest, moves, intents: [] })
    axes.push(axis)
  }
  return { paths: out, axes }
}
