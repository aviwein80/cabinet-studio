/**
 * Collision check of the machine replay (M3.6, SIM-06): every part of the machine that moves with
 * the head (the gantry, its carriage, the head, the spindle, the tool and its holder) against
 * everything on the table side (the table and spoilboard, the rotary table and cradle, the part's
 * clamps, pods and rails, and the part's block), along every step of the replay, keeping the
 * collision margin; and every axis inside its travel.
 *
 * Straight steps (no rotary axis turning) are checked exactly: each moving part is swept along the
 * step (a convex solid moved in a straight line stays convex) and its distance to each part on the
 * table side found. Where rotary axes turn, the step is split so they turn at most half a degree at
 * a time, each piece the hull of its two ends grown by how far the parts' arcs bulge out of it.
 *
 * What the cutting check covers is left to it: the cutter in the part and the spoilboard (cutting
 * is meant), the shank and holder in the part (it knows the material left). The part counts as its
 * whole block here (the head against the part: errs on the side of a warning).
 *
 * Pure: no DOM, no React.
 */
import { checkCancel, type Work } from '@/core/cancel'
import { machineModelOf } from '@/core/machineModel'
import type { MachineBody, MachineProfile } from '@/core/types'
import { DEFAULT_COLLISION_MARGIN } from '../collision/collision'
import { type Aabb, boxesNear, type Convex, distance, frustum, grown, hull2, penetration, placed, swept, type Vec } from '../collision/convex'
import { type BodyPiece, toolBody } from '../collision/fixtureCheck'
import { fixturePieces } from '../fixtures/fixture'
import type { CamPart } from '../types'
import { type AxisState, bodiesOf, bodyConvex, bodyReachFrom, HEAD_SIDE, kinOf, machinePose, type MachinePose, type Pose, tableBodies } from './model'
import type { MachineReplay, ReplayStep } from './replay'

export type MachineHitKind = 'fixture' | 'table' | 'part' | 'machine' | 'travel'

export interface MachineHit {
  kind: MachineHitKind
  /** First step and how many in a row. */
  step: number
  steps: number
  /** Replay time where it starts (seconds). */
  t: number
  /** The axes there. */
  s: AxisState
  /** Margin less the distance (mm), the margin plus the overlap, or how far past the travel. */
  depth: number
  /** What moves into what. */
  mover: string
  other: string
  /** Fixture index (part's fixtures), for a fixture hit. */
  fixture?: number
  /** Travel: the axis value furthest past its travel. */
  value?: number
  message: string
}

/** Reported intrusions smaller than this are not reported (mm). */
const TOL = 0.01
/** Largest turn of the rotary axes per checked piece of a step (degrees). */
const TURN_STEP = 0.5

interface Mover {
  name: string
  /** A machine part on a head-side link, or a piece of the tool. */
  body?: MachineBody
  tool?: BodyPiece
  /** Reach from the head's pivot (for the bulge of a turn). */
  reach: number
}

interface Fixed {
  name: string
  kind: Exclude<MachineHitKind, 'travel'>
  body?: MachineBody
  /** A fixture's (or the part block's) convex piece, placed on the part (part frame). */
  local?: Convex
  fixture?: number
  reach: number
}

const sub = (a: readonly number[], b: readonly number[]): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

function boxOf(c: Convex): Aabb {
  return { lo: [c.support([-1, 0, 0])[0], c.support([0, -1, 0])[1], c.support([0, 0, -1])[2]], hi: [c.support([1, 0, 0])[0], c.support([0, 1, 0])[1], c.support([0, 0, 1])[2]] }
}

const lerpState = (a: AxisState, b: AxisState, k: number): AxisState => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, a1: a.a1 + (b.a1 - a.a1) * k, a2: a.a2 + (b.a2 - a.a2) * k })

/** A mover placed for a pose. */
function moverAt(m: Mover, p: MachinePose): Convex {
  if (m.body) return bodyConvex(m.body, p.links[m.body.link])
  const t = m.tool!
  return frustum(p.tip, p.tool, t.h0, t.h1, t.r0, t.r1, t.round)
}

/** A fixed part placed for a pose (table parts turn with the table). */
function fixedAt(f: Fixed, p: MachinePose, partPose: Pose): Convex {
  if (f.body) return bodyConvex(f.body, p.links[f.body.link])
  return placed(f.local!, partPose.R, partPose.t)
}

/**
 * Check a replay on `machine` with the part (its block and fixtures) where the replay put it.
 * Hits are merged into runs (one per moving part and thing hit, while the steps follow on).
 */
export function machineCollisions(r: MachineReplay, part: Pick<CamPart, 'length' | 'width' | 'thickness' | 'fixtures'>, machine: MachineProfile, opts: { work?: Work } = {}): MachineHit[] {
  const model = machineModelOf(machine)
  const k = kinOf(model)
  const M = Math.max(0, machine.collisionMargin ?? DEFAULT_COLLISION_MARGIN)
  const T = part.thickness
  const at = r.partAt
  const bodies = bodiesOf(model)
  const fixedBodies = [...tableBodies(model, at[2] - T), ...bodies.filter((b) => !HEAD_SIDE.includes(b.link))]
  const pivotLen = k && k.layout !== 'table-table' ? k.pivot : 0
  const centre: Vec = k ? [k.centre.x, k.centre.y, k.centre.z] : [0, 0, 0]
  // the part's block and its fixtures (part frame; placed on the table with the part)
  const fixedList: Fixed[] = [
    ...fixedBodies.map((b): Fixed => ({ name: b.name, kind: b.id === 'spoilboard' || b.id === 'table' ? 'table' : 'machine', body: b, reach: bodyReachFrom(b, centre) })),
    ...fixturePieces(part.fixtures).map((p): Fixed => ({ name: `fixture "${p.name}"`, kind: 'fixture', local: p.c, fixture: p.fixture, reach: Math.hypot(...p.box.hi.map((v, i) => Math.max(Math.abs(v + at[i] - centre[i]), Math.abs(p.box.lo[i] + at[i] - centre[i])))) })),
    { name: "the part's block", kind: 'part', local: { centre: [part.length / 2, part.width / 2, -T / 2], support: (d) => [d[0] >= 0 ? part.length : 0, d[1] >= 0 ? part.width : 0, d[2] >= 0 ? 0 : -T] }, reach: Math.hypot(part.length, part.width, T) + Math.hypot(...sub(at, centre)) },
  ]
  const headBodies = bodies.filter((b) => HEAD_SIDE.includes(b.link))
  const tableTurns = !!k && k.layout !== 'head-head'
  const out: MachineHit[] = []
  const open = new Map<string, MachineHit>()
  const report = (h: Omit<MachineHit, 'steps' | 'message'>) => {
    const key = `${h.kind}:${h.mover}:${h.other}`
    const c = open.get(key)
    if (c && h.step <= c.step + c.steps) {
      c.steps = h.step - c.step + 1
      if (h.depth > c.depth) {
        c.depth = h.depth
        if (h.value !== undefined) c.value = h.value
      }
      return
    }
    const n: MachineHit = { ...h, steps: 1, message: '' }
    open.set(key, n)
    out.push(n)
  }
  // travel: every axis the model lists, per step end (the start is the previous step's end)
  const travel = model.axes
  const letters = r.letters
  const axisValue = (s: AxisState, id: string) => (id === 'X' ? s.x : id === 'Y' ? s.y : id === 'Z' ? s.z : letters && id === letters[0] ? s.a1 : letters && id === letters[1] ? s.a2 : NaN)
  const bodyCache = new Map<number, Mover[]>()
  const moversOf = (op: number): Mover[] => {
    let m = bodyCache.get(op)
    if (m) return m
    const o = r.ops[op]
    // the tool up to the top of its holder (the spindle's parts take over from there), else to its gauge point
    const h = o.outline?.holder
    const tool = o.outline ? toolBody(o.cutter, { ...o.outline, gauge: o.stickOut }, Math.max(1, h?.length ? h[h.length - 1].z - 1 : o.stickOut)) : []
    m = [
      ...headBodies.map((b) => ({ name: b.name, body: b, reach: bodyReachFrom(b, [0, 0, pivotLen]) + o.stickOut + pivotLen })),
      ...tool.map((p) => ({ name: p.part === 'cutter' ? 'the cutter' : p.part === 'shank' ? 'the shank' : 'the holder', tool: p, reach: Math.hypot(p.h1, Math.max(p.r0, p.r1)) + p.round + o.stickOut + pivotLen })),
    ]
    bodyCache.set(op, m)
    return m
  }
  const skip = (mv: Mover, f: Fixed) => !!mv.tool && (f.kind === 'part' || (f.body?.id === 'spoilboard' && mv.tool.part === 'cutter'))
  const fmt = (s: AxisState) => `X${s.x.toFixed(1)} Y${s.y.toFixed(1)} Z${s.z.toFixed(1)}${letters ? ` ${letters[0]}${s.a1.toFixed(2)} ${letters[1]}${s.a2.toFixed(2)}` : ''}`
  const partPoseOf = (p: MachinePose): Pose => {
    const tp = p.links.table2
    return { R: tp.R, t: [tp.t[0] + (tp.R[0][0] * at[0] + tp.R[0][1] * at[1] + tp.R[0][2] * at[2]), tp.t[1] + (tp.R[1][0] * at[0] + tp.R[1][1] * at[1] + tp.R[1][2] * at[2]), tp.t[2] + (tp.R[2][0] * at[0] + tp.R[2][1] * at[1] + tp.R[2][2] * at[2])] }
  }
  r.steps.forEach((st: ReplayStep, si: number) => {
    if ((si & 255) === 0) {
      checkCancel(opts.work?.isCancelled)
      opts.work?.progress?.(si / Math.max(1, r.steps.length), 'Machine collision check')
    }
    // travel
    for (const a of travel) {
      const v = axisValue(st.to, a.id)
      if (!Number.isFinite(v)) continue
      const past = v < a.min - 1e-6 ? a.min - v : v > a.max + 1e-6 ? v - a.max : 0
      if (past > 0) report({ kind: 'travel', step: si, t: st.t1, s: st.to, depth: past, value: v, mover: a.id, other: `its travel (${a.min} to ${a.max}${a.id === 'X' || a.id === 'Y' || a.id === 'Z' ? ' mm' : '°'})` })
    }
    if (st.kind === 'change') return
    const o = r.ops[st.op]
    const movers = moversOf(st.op)
    const turn = Math.abs(st.to.a1 - st.from.a1) + Math.abs(st.to.a2 - st.from.a2)
    const n = turn > 1e-9 ? Math.max(1, Math.ceil(turn / TURN_STEP)) : 1
    for (let i = 0; i < n; i++) {
      const s0 = lerpState(st.from, st.to, i / n)
      const s1 = lerpState(st.from, st.to, (i + 1) / n)
      const p0 = machinePose(k, s0, o.stickOut)
      const p1 = machinePose(k, s1, o.stickOut)
      const th = ((Math.abs(s1.a1 - s0.a1) + Math.abs(s1.a2 - s0.a2)) * Math.PI) / 180
      const pp0 = partPoseOf(p0)
      const pp1 = partPoseOf(p1)
      const fixedNow = fixedList.map((f) => {
        const a = fixedAt(f, p0, pp0)
        const moving = tableTurns && th > 0 && (!f.body || f.body.link !== 'frame')
        const c = moving ? grown(hull2(a, fixedAt(f, p1, pp1)), (f.reach * th * th) / 8 + 1e-9) : a
        return { f, c, box: boxOf(c) }
      })
      for (const mv of movers) {
        const a = moverAt(mv, p0)
        let c: Convex
        if (th > 0) c = grown(hull2(a, moverAt(mv, p1)), (mv.reach * th * th) / 8 + 1e-9)
        else {
          // a straight step: the part moves without turning; its sweep is exact
          const b = moverAt(mv, p1)
          const d = sub(b.centre, a.centre)
          c = swept(a, d)
        }
        const cb = boxOf(c)
        for (const { f, c: fc, box } of fixedNow) {
          if (skip(mv, f) || !boxesNear(cb, box, M)) continue
          const d = distance(c, fc, M)
          if (d >= M - TOL) continue
          const depth = d > 1e-9 ? M - d : M + penetration(c, fc)
          // where it starts on a straight step: halve the share of the step swept
          let kk = i / n
          if (th === 0) {
            const a0 = moverAt(mv, p0)
            const d1 = sub(moverAt(mv, p1).centre, a0.centre)
            let lo = 0
            let hi = 1
            if (distance(a0, fc, M) >= M - TOL)
              for (let it = 0; it < 30 && hi - lo > 1e-6; it++) {
                const km = (lo + hi) / 2
                if (distance(swept(a0, [d1[0] * km, d1[1] * km, d1[2] * km]), fc, M) < M - TOL) hi = km
                else lo = km
              }
            else hi = 0
            kk = (i + hi) / n
          }
          const s = lerpState(st.from, st.to, kk)
          report({ kind: f.kind, step: si, t: st.t0 + (st.t1 - st.t0) * kk, s, depth, mover: mv.name, other: f.name, ...(f.fixture !== undefined ? { fixture: f.fixture } : {}) })
        }
      }
    }
  })
  for (const h of out) {
    const st = r.steps[h.step]
    const op = r.ops[st.op]
    const where = st.link ? (st.kind === 'change' ? 'at the tool change' : 'between operations') : `move ${st.move + 1}${h.steps > 1 ? ` (and ${h.steps - 1} more step${h.steps > 2 ? 's' : ''})` : ''}`
    const line = st.line ? `, line ${st.line}` : ''
    h.message =
      h.kind === 'travel'
        ? `${op?.name ?? 'Program'}, ${where}${line}: ${h.mover} goes to ${h.value!.toFixed(3)}, beyond ${h.other} (${h.depth.toFixed(2)} past).`
        : `${op?.name ?? 'Program'}, ${where}${line}: ${h.mover} ${h.depth > M + 1e-9 ? 'hits' : 'comes within the margin of'} ${h.other} at ${fmt(h.s)} (${h.depth.toFixed(2)} mm).`
  }
  return out
}
