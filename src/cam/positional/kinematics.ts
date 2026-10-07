/**
 * Positional (3+2) kinematics on the machine model (M3.4, 5AX-01). Our own maths: from the tool
 * direction a tilted plane needs, the two rotary angles that give it (both solutions); and with
 * those angles locked, part points to the machine's X, Y, Z and back.
 *
 * Conventions (see `PositionalKinematics`): A turns about X, B about Y, C about Z, right-handed. A
 * head axis turns the tool; a table axis turns the table and the part on it. Tool direction = from
 * the tip towards the spindle (the tilted plane's normal). With every rotary axis at 0 the tool
 * points along +Z and the part sits on the table with its axes along the machine's, its origin at
 * `partAt`.
 *
 *   head-head:   tool  = R1(a1)·R2(a2)·Z           part unturned
 *   table-table: tool  = Z                         part turned by R1(a1)·R2(a2) about `centre`
 *   table-head:  tool  = R2(a2)·Z                  part turned by R1(a1) about `centre`
 *
 * Machine X, Y, Z: the tip, when the controller keeps the tip on the point as the head turns
 * (`tcp`), or the point that sits at the tip with every axis at 0 (tool length set along Z): the
 * tip plus (pivot + stick-out)·(tool - Z).
 *
 * Pure: no DOM, no React.
 */
import type { MachineAxisId, MachineModel, PositionalKinematics } from '@/core/types'
import { cross3, dot3, norm3, rotateAbout, type V3 } from './frame'

export type RotaryLetter = 'A' | 'B' | 'C'

/** The machine axis each rotary axis turns about. */
export const AXIS_OF: Record<RotaryLetter, V3> = { A: [1, 0, 0], B: [0, 1, 0], C: [0, 0, 1] }

/** Locked angles, degrees: the first axis (nearer the machine frame) and the second. */
export interface Angles {
  first: number
  second: number
}

const Z: V3 = [0, 0, 1]
const DEG = Math.PI / 180

/** Angle in degrees, wrapped into (-180, 180], tidied near whole numbers. */
export function wrap180(d: number): number {
  let a = ((d % 360) + 360) % 360
  if (a > 180) a -= 360
  const r = Math.round(a * 1e9) / 1e9
  return r === -180 ? 180 : r === 0 ? 0 : r
}

/**
 * Both ways of turning Z about `ki` then `ko` (inner first) onto v: angles (φo, φi) with
 * Rko(φo)·Rki(φi)·Z = v. Empty when v is out of reach; one when the two coincide.
 */
function solveTwo(ko: V3, ki: V3, v: V3): { o: number; i: number }[] {
  const kiz = dot3(ki, Z)
  const koki = dot3(ko, ki)
  const P = dot3(ko, Z) - koki * kiz
  const Q = dot3(ko, cross3(ki, Z))
  const c = dot3(ko, v) - koki * kiz
  const amp = Math.hypot(P, Q)
  if (amp < 1e-12) return []
  if (Math.abs(c) > amp * (1 + 1e-9) + 1e-12) return []
  const base = Math.atan2(Q, P)
  const d = Math.acos(Math.max(-1, Math.min(1, c / amp)))
  const out: { o: number; i: number }[] = []
  for (const phi of d < 1e-9 ? [base] : [base + d, base - d]) {
    const iDeg = phi / DEG
    const w = rotateAbout(ki, iDeg, Z)
    const wp = [0, 1, 2].map((k) => w[k] - dot3(w, ko) * ko[k])
    const vp = [0, 1, 2].map((k) => v[k] - dot3(v, ko) * ko[k])
    let oDeg = 0
    if (Math.hypot(wp[0], wp[1], wp[2]) > 1e-9 && Math.hypot(vp[0], vp[1], vp[2]) > 1e-9) oDeg = Math.atan2(dot3(ko, cross3(wp, vp)), dot3(wp, vp)) / DEG
    out.push({ o: wrap180(oDeg), i: wrap180(iDeg) })
  }
  return out
}

/** Every pair of locked angles that points the tool along `v` (part frame, tip to spindle). */
export function solveAngles(k: Pick<PositionalKinematics, 'layout' | 'first' | 'second'>, v: readonly number[]): Angles[] {
  const u = norm3(v)
  const k1 = AXIS_OF[k.first]
  const k2 = AXIS_OF[k.second]
  if (k.first === k.second) return []
  switch (k.layout) {
    case 'head-head':
      return solveTwo(k1, k2, u).map((s) => ({ first: s.o, second: s.i }))
    case 'table-table':
      // the part turned so v lands on Z: v = R2(-a2)·R1(-a1)·Z
      return solveTwo(k2, k1, u).map((s) => ({ first: wrap180(-s.i), second: wrap180(-s.o) }))
    case 'table-head':
      // R1(a1)·v = R2(a2)·Z: v = R1(-a1)·R2(a2)·Z
      return solveTwo(k1, k2, u).map((s) => ({ first: wrap180(-s.o), second: s.i }))
  }
}

/** The machine model's two 3+2 axes and their travel, or why it has none. */
export function positionalAxes(m: Pick<MachineModel, 'axes' | 'capabilities' | 'positional'>): { kin: PositionalKinematics; first: { min: number; max: number }; second: { min: number; max: number } } | { error: string } {
  const k = m.positional
  if (!m.capabilities.positional || !k) return { error: 'its machine model has no 3+2 (positional) axes' }
  const a1 = m.axes.find((a) => a.id === k.first)
  const a2 = m.axes.find((a) => a.id === k.second)
  if (!a1 || !a2) return { error: `its machine model does not list the ${!a1 ? k.first : k.second} axis` }
  return { kin: k, first: { min: a1.min, max: a1.max }, second: { min: a2.min, max: a2.max } }
}

/** Problems with a machine model's 3+2 set-up (empty = fine). */
export function kinematicsProblems(m: Pick<MachineModel, 'axes' | 'capabilities' | 'positional'>): string[] {
  const out: string[] = []
  const ax = positionalAxes(m)
  if ('error' in ax) return [ax.error[0].toUpperCase() + ax.error.slice(1) + '.']
  const k = ax.kin
  if (k.first === k.second) out.push('The two rotary axes must be different.')
  else if (!solveAngles(k, norm3([0.3, 0.5, 0.8])).length || !solveAngles(k, norm3([-0.6, 0.2, 0.7])).length)
    out.push(`${k.first} then ${k.second} cannot tilt the tool every way round (the second axis must not turn about the tool itself).`)
  if (!(k.pivot >= 0) || !Number.isFinite(k.pivot)) out.push('The pivot distance must be 0 or more.')
  for (const [name, p] of [['table centre', k.centre], ['part position', k.partAt]] as const) if (![p.x, p.y, p.z].every(Number.isFinite)) out.push(`The ${name} needs X, Y and Z.`)
  for (const [id, a] of [[k.first, ax.first], [k.second, ax.second]] as const) if (!(a.max > a.min)) out.push(`The ${id} axis needs a travel (its largest angle above its smallest).`)
  return out
}

/** An angle moved by whole turns into [min, max], the one nearest 0; null when no turn fits. */
function fitTravel(a: number, lim: { min: number; max: number }): number | null {
  let best: number | null = null
  for (const n of [0, -1, 1, -2, 2, -3, 3]) {
    const x = a + 360 * n
    if (x < lim.min - 1e-9 || x > lim.max + 1e-9) continue
    if (best === null || Math.abs(x) < Math.abs(best) - 1e-12) best = x
  }
  return best
}

/**
 * The locked angles to use for tool direction `v`: of the solutions inside the axes' travel, the
 * one turning the first axis least (then the second axis's positive side); `flip` takes the other.
 * Says why when none fits.
 */
export function pickAngles(m: Pick<MachineModel, 'axes' | 'capabilities' | 'positional'>, v: readonly number[], flip = false): { angles: Angles; other: Angles | null; note?: string } | { error: string } {
  const ax = positionalAxes(m)
  if ('error' in ax) return ax
  const all = solveAngles(ax.kin, v)
  if (!all.length) return { error: `the ${ax.kin.first} and ${ax.kin.second} axes cannot point the tool along (${v.map((q) => q.toFixed(3)).join(', ')})` }
  const fit = all
    .map((s) => ({ s, f: fitTravel(s.first, ax.first), g: fitTravel(s.second, ax.second) }))
    .filter((x) => x.f !== null && x.g !== null)
    .map((x) => ({ first: x.f!, second: x.g! }))
    .sort((p, q) => Math.abs(p.first) - Math.abs(q.first) || q.second - p.second)
  if (!fit.length) {
    const s = all.map((a) => `${ax.kin.first}${a.first.toFixed(3)}° ${ax.kin.second}${a.second.toFixed(3)}°`).join(' or ')
    return { error: `it needs ${s}, outside the axes' travel (${ax.kin.first} ${ax.first.min}° to ${ax.first.max}°, ${ax.kin.second} ${ax.second.min}° to ${ax.second.max}°)` }
  }
  if (flip) {
    if (fit.length < 2) return { angles: fit[0], other: null, note: 'The other solution is outside the axes\' travel (or there is only one): the usual one is used.' }
    return { angles: fit[1], other: fit[0] }
  }
  return { angles: fit[0], other: fit[1] ?? null }
}

const rot = (l: RotaryLetter, deg: number, v: readonly number[]) => (Math.abs(deg) < 1e-15 ? ([v[0], v[1], v[2]] as V3) : rotateAbout(AXIS_OF[l], deg, v))

/** The tool direction in machine axes. */
function headTurn(k: PositionalKinematics, a: Angles, v: readonly number[]): V3 {
  if (k.layout === 'head-head') return rot(k.first, a.first, rot(k.second, a.second, v))
  if (k.layout === 'table-head') return rot(k.second, a.second, v)
  return [v[0], v[1], v[2]]
}

/** The table's turn applied to a vector (part as set on the table -> as turned). */
function tableTurn(k: PositionalKinematics, a: Angles, v: readonly number[], back = false): V3 {
  if (k.layout === 'table-table') return back ? rot(k.second, -a.second, rot(k.first, -a.first, v)) : rot(k.first, a.first, rot(k.second, a.second, v))
  if (k.layout === 'table-head') return rot(k.first, back ? -a.first : a.first, v)
  return [v[0], v[1], v[2]]
}

const add = (a: readonly number[], b: readonly number[]): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a: readonly number[], s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]

/** Head offset length: pivot plus the tool's stick-out (0 with tool-centre-point control or no head axis). */
export function headLength(k: PositionalKinematics, stickOut: number): number {
  if (k.tcp || k.layout === 'table-table') return 0
  return k.pivot + stickOut
}

/**
 * A part point (the tip there, the angles locked) as the machine's X, Y, Z; also the tip and the
 * tool direction in machine axes. `L` = `headLength(...)`.
 */
export function toMachine(k: PositionalKinematics, a: Angles, p: readonly number[], L: number): { xyz: V3; tip: V3; tool: V3 } {
  const c: V3 = [k.centre.x, k.centre.y, k.centre.z]
  const p0 = add([k.partAt.x, k.partAt.y, k.partAt.z], p)
  const tip = add(c, tableTurn(k, a, sub(p0, c)))
  const tool = headTurn(k, a, Z)
  const xyz = L ? add(tip, mul(sub(tool, Z), L)) : tip
  return { xyz, tip, tool }
}

/** The machine's X, Y, Z with the angles locked back to the tip and tool direction in part coordinates. */
export function fromMachine(k: PositionalKinematics, a: Angles, xyz: readonly number[], L: number): { tip: V3; tool: V3 } {
  const c: V3 = [k.centre.x, k.centre.y, k.centre.z]
  const toolM = headTurn(k, a, Z)
  const tipM = L ? sub(xyz, mul(sub(toolM, Z), L)) : [xyz[0], xyz[1], xyz[2]]
  const p0 = add(c, tableTurn(k, a, sub(tipM, c), true))
  return { tip: sub(p0, [k.partAt.x, k.partAt.y, k.partAt.z]), tool: tableTurn(k, a, toolM, true) }
}

/** Machine axis ids of the model's 3+2 axes (for messages and posts). */
export const positionalLetters = (k: Pick<PositionalKinematics, 'first' | 'second'>): [MachineAxisId, MachineAxisId] => [k.first, k.second]
