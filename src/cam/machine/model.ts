/**
 * The whole machine for the machine simulation (M3.6, SIM-06): its parts (boxes and cylinders,
 * each carried by an axis), and where every part is for a set of axis values, worked out along
 * the kinematic chain of the machine model (`PositionalKinematics` for machines with rotary axes;
 * a plain gantry router otherwise). Our own kinematics, the same conventions as the 3+2 and
 * 5-axis conversions (`positional/kinematics.ts`), so a program converted for a machine and
 * replayed here puts the tool where the toolpath asked for.
 *
 * Machine coordinates: those of the machine model. For a 3-axis router like the N-200 the origin
 * is the sheet origin on the spoilboard's top (X along the table's length, Y across, Z up), and
 * the part's face-1 corner sits at `partAt` (by default X 0, Y 0, Z = the part's thickness, its
 * underside on the spoilboard).
 *
 * Pure: no DOM, no React.
 */
import type { MachineBody, MachineLink, MachineModel, PositionalKinematics } from '@/core/types'
import { apply3, type Convex, frustum, IDENTITY, type Mat3, mulM3, prism, rotM3, type Vec } from '../collision/convex'
import { AXIS_OF, headLength } from '../positional/kinematics'

/** Axis values: X, Y, Z as programmed (machine coordinates) and the two rotary axes (degrees). */
export interface AxisState {
  x: number
  y: number
  z: number
  a1: number
  a2: number
}

/** A rigid placement: world = t + R · local. */
export interface Pose {
  R: Mat3
  t: Vec
}

export const LINKS: MachineLink[] = ['frame', 'x', 'y', 'z', 'head1', 'head2', 'table1', 'table2']
export const HEAD_SIDE: readonly MachineLink[] = ['x', 'y', 'z', 'head1', 'head2']
export const TABLE_SIDE: readonly MachineLink[] = ['frame', 'table1', 'table2']

export const LINK_NAME: Record<MachineLink, string> = {
  frame: 'Frame (fixed)',
  x: 'X axis',
  y: 'Y axis',
  z: 'Z axis (head)',
  head1: 'Head, first rotary axis',
  head2: 'Head, second rotary axis',
  table1: 'Table, first rotary axis',
  table2: 'Table, second rotary axis',
}

const box = (id: string, name: string, link: MachineLink, min: [number, number, number], max: [number, number, number]): MachineBody => ({ id, name, link, shape: { k: 'box', min, max }, placeholder: true })
const cyl = (id: string, name: string, link: MachineLink, base: [number, number, number], r: number, h: number, axis: 'x' | 'y' | 'z' = 'z'): MachineBody => ({ id, name, link, shape: { k: 'cylinder', base, axis, r, h }, placeholder: true })

/**
 * PLACEHOLDER machine parts (invented sizes, Configure badge) for the model's layout: a gantry
 * (beam and legs on X, carriage on Y) and the head on Z, plus for machines with rotary axes a fork
 * head, a tilting rotary table or a rotary table with a tilting head.
 */
export function defaultBodies(m: Pick<MachineModel, 'table' | 'capabilities' | 'positional'>): MachineBody[] {
  const W = m.table.width
  const k = m.capabilities.positional ? m.positional : undefined
  const gantry = [
    box('beam', 'Gantry beam', 'x', [110, -300, 420], [410, W + 300, 720]),
    box('leg-front', 'Gantry leg (front)', 'x', [110, -420, -260], [410, -300, 720]),
    box('leg-back', 'Gantry leg (back)', 'x', [110, W + 300, -260], [410, W + 420, 720]),
    box('carriage', 'Y carriage', 'y', [60, -160, 300], [110, 160, 780]),
  ]
  if (!k)
    return [
      ...gantry,
      box('plate', 'Head plate', 'z', [40, -140, 60], [60, 140, 620]),
      cyl('motor', 'Spindle motor', 'z', [0, 0, 70], 75, 330),
      box('drills', 'Vertical drill block', 'z', [-260, -90, 110], [-90, 90, 400]),
    ]
  const P = k.pivot
  const c = [k.centre.x, k.centre.y, k.centre.z] as const
  switch (k.layout) {
    case 'head-head': {
      // the first axis turns the fork (axis vertical for C); the second turns the spindle between the fork's arms
      const arm = (s: 1 | -1, id: string): MachineBody => (k.second === 'A' ? box(id, `Fork arm (${s > 0 ? '+X' : '-X'})`, 'head1', s > 0 ? [90, -60, P - 60] : [-130, -60, P - 60], s > 0 ? [130, 60, P + 50] : [-90, 60, P + 50]) : box(id, `Fork arm (${s > 0 ? '+Y' : '-Y'})`, 'head1', s > 0 ? [-60, 90, P - 60] : [-60, -130, P - 60], s > 0 ? [60, 130, P + 50] : [60, -90, P + 50]))
      return [...gantry, box('ram', 'Z ram', 'z', [-90, -90, P + 150], [90, 90, P + 700]), cyl('first', `${k.first}-axis housing`, 'head1', [0, 0, P + 50], 120, 100), arm(1, 'arm-a'), arm(-1, 'arm-b'), cyl('spindle', 'Spindle housing', 'head2', [0, 0, 70], 60, Math.max(20, P - 10))]
    }
    case 'table-table':
      return [
        ...gantry,
        box('plate', 'Head plate', 'z', [40, -140, 60], [60, 140, 620]),
        cyl('motor', 'Spindle motor', 'z', [0, 0, 70], 75, 330),
        box('cradle', `Cradle (${k.first} axis)`, 'table1', [c[0] - 360, c[1] - 260, c[2] - 160], [c[0] + 360, c[1] + 260, c[2] - 100]),
        cyl('rotary', `Rotary table (${k.second} axis)`, 'table2', [c[0], c[1], c[2] - 100], 250, 100),
      ]
    case 'table-head':
      return [...gantry, box('ram', 'Z ram', 'z', [-90, -90, P + 150], [90, 90, P + 700]), box('head', `${k.second}-axis head`, 'head2', [-80, -80, P - 60], [80, 80, P + 60]), cyl('spindle', 'Spindle housing', 'head2', [0, 0, 70], 60, Math.max(20, P - 70)), cyl('rotary', `Rotary table (${k.first} axis)`, 'table2', [c[0], c[1], c[2] - 100], 250, 100)]
  }
}

/** The machine's parts: its own, else the invented ones for its layout. */
export const bodiesOf = (m: Pick<MachineModel, 'table' | 'capabilities' | 'positional' | 'bodies'>): MachineBody[] => m.bodies ?? defaultBodies(m)

/** Are the machine's parts (any of them) still invented? */
export const bodiesInvented = (m: Pick<MachineModel, 'bodies'>) => !m.bodies || m.bodies.some((b) => b.placeholder)

/**
 * The table under the part, from the machine model: on a machine without table axes, the
 * spoilboard over the whole table (its top where the part's underside is, `under`) and the
 * machine's table under it.
 */
export function tableBodies(m: Pick<MachineModel, 'table' | 'spoilboard' | 'capabilities' | 'positional'>, under: number): MachineBody[] {
  const k = m.capabilities.positional ? m.positional : undefined
  if (k && k.layout !== 'head-head') return []
  const S = Math.max(0, m.spoilboard.thickness)
  return [
    { id: 'spoilboard', name: 'Spoilboard', link: 'frame', shape: { k: 'box', min: [0, 0, under - S], max: [m.table.length, m.table.width, under] } },
    { id: 'table', name: 'Machine table', link: 'frame', shape: { k: 'box', min: [-60, -60, under - S - 120], max: [m.table.length + 60, m.table.width + 60, under - S] } },
  ]
}

/** The machine's kinematics for the replay: its 3+2 axes, or none (a 3-axis router). */
export const kinOf = (m: Pick<MachineModel, 'capabilities' | 'positional'>): PositionalKinematics | null => (m.capabilities.positional && m.positional ? m.positional : null)

/** Rotation of the head (first link, both links) and of the table (first, both) for the angles. */
export function rotations(k: PositionalKinematics | null, a1: number, a2: number): { h1: Mat3; h2: Mat3; t1: Mat3; t2: Mat3 } {
  if (!k) return { h1: IDENTITY, h2: IDENTITY, t1: IDENTITY, t2: IDENTITY }
  const R1 = rotM3(AXIS_OF[k.first], a1)
  const R2 = rotM3(AXIS_OF[k.second], a2)
  switch (k.layout) {
    case 'head-head':
      return { h1: R1, h2: mulM3(R1, R2), t1: IDENTITY, t2: IDENTITY }
    case 'table-table':
      return { h1: IDENTITY, h2: IDENTITY, t1: R1, t2: mulM3(R1, R2) }
    case 'table-head':
      return { h1: IDENTITY, h2: R2, t1: R1, t2: R1 }
  }
}

export interface MachinePose {
  links: Record<MachineLink, Pose>
  /** Tool tip and direction (tip to spindle), machine coordinates. */
  tip: Vec
  tool: Vec
  /** The head's pivot (where its rotary axes turn about), machine coordinates. */
  pivot: Vec
}

const add = (a: readonly number[], b: readonly number[]): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: readonly number[], b: readonly number[]): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a: readonly number[], s: number): Vec => [a[0] * s, a[1] * s, a[2] * s]

/**
 * Where every link is for axis values `s` with a tool of `stickOut` (tip to its gauge point) in
 * the spindle. Programmed X, Y, Z are the tip when the controller keeps the tip on the point
 * (`tcp`) or the machine has no head axes; otherwise the point at the tip with every axis at 0
 * (`toMachine`).
 */
export function machinePose(k: PositionalKinematics | null, s: AxisState, stickOut: number): MachinePose {
  const r = rotations(k, s.a1, s.a2)
  const tool = apply3(r.h2, [0, 0, 1])
  const xyz: Vec = [s.x, s.y, s.z]
  const L = k ? headLength(k, stickOut) : 0
  const tip = L ? sub(xyz, mul(sub(tool, [0, 0, 1]), L)) : xyz
  // the head's pivot: a table-table machine (or a 3-axis one) has none; its "pivot" is the gauge point
  const pivotLen = k && k.layout !== 'table-table' ? k.pivot : 0
  const P = add(tip, mul(tool, stickOut + pivotLen))
  const Oz = sub(P, [0, 0, pivotLen])
  const headPose = (R: Mat3): Pose => ({ R, t: sub(P, apply3(R, [0, 0, pivotLen])) })
  const c: Vec = k ? [k.centre.x, k.centre.y, k.centre.z] : [0, 0, 0]
  const tablePose = (R: Mat3): Pose => ({ R, t: sub(c, apply3(R, c)) })
  return {
    links: {
      frame: { R: IDENTITY, t: [0, 0, 0] },
      x: { R: IDENTITY, t: [Oz[0], 0, 0] },
      y: { R: IDENTITY, t: [Oz[0], Oz[1], 0] },
      z: { R: IDENTITY, t: Oz },
      head1: headPose(r.h1),
      head2: headPose(r.h2),
      table1: tablePose(r.t1),
      table2: tablePose(r.t2),
    },
    tip,
    tool,
    pivot: P,
  }
}

/** A point of a link (its own coordinates) placed. */
export const placePoint = (p: Pose, q: readonly number[]): Vec => add(p.t, apply3(p.R, q))

const AXIS_VEC = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] } as const

/** A body as a convex solid, placed by its link's pose. */
export function bodyConvex(b: MachineBody, p: Pose): Convex {
  const s = b.shape
  if (s.k === 'box') return prism([s.min[0], s.min[1], s.max[0], s.min[1], s.max[0], s.max[1], s.min[0], s.max[1]], s.min[2], s.max[2], p.t, p.R)
  return frustum(placePoint(p, s.base), apply3(p.R, AXIS_VEC[s.axis]), 0, s.h, s.r, s.r)
}

/** Farthest any point of a body is from a point of its link's own frame (for the bulge of a turn). */
export function bodyReachFrom(b: MachineBody, o: readonly number[]): number {
  const s = b.shape
  if (s.k === 'box') {
    let r = 0
    for (const x of [s.min[0], s.max[0]]) for (const y of [s.min[1], s.max[1]]) for (const z of [s.min[2], s.max[2]]) r = Math.max(r, Math.hypot(x - o[0], y - o[1], z - o[2]))
    return r
  }
  const a = AXIS_VEC[s.axis]
  const top = [s.base[0] + a[0] * s.h, s.base[1] + a[1] * s.h, s.base[2] + a[2] * s.h]
  return Math.max(Math.hypot(s.base[0] - o[0], s.base[1] - o[1], s.base[2] - o[2]), Math.hypot(top[0] - o[0], top[1] - o[1], top[2] - o[2])) + s.r
}

/** Problems with a machine part (empty = fine). */
export function bodyProblems(b: MachineBody): string[] {
  const out: string[] = []
  const s = b.shape
  if (s.k === 'box') {
    if ([...s.min, ...s.max].some((v) => !Number.isFinite(v))) out.push('Every corner needs X, Y and Z.')
    else if (s.max.some((v, i) => v <= s.min[i])) out.push('Each "to" must be above its "from".')
  } else {
    if (!(s.r > 0) || !(s.h > 0)) out.push('The radius and length must be more than 0.')
    if (s.base.some((v) => !Number.isFinite(v))) out.push('The base centre needs X, Y and Z.')
  }
  return out
}
