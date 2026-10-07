/**
 * Rotary toolpaths in the simulator (M3.3): moved from their wrapped planes into the rotary
 * stock's frame (x along the axis from the blank's start, y = Rs·θ, z = distance from the axis
 * - Rs), so the one timeline, playback and collision check run on them unchanged. Straight moves
 * stay straight in the machine's axes in both frames.
 */
import type { Work } from '@/core/cancel'
import type { MachineProfile } from '@/core/types'
import { checkCollisions, type Collision, collisionSetup } from '../collision/collision'
import { buildTimeline, programOrder, type SimTimeline } from '../sim'
import type { Move, Toolpath } from '../toolpath'
import { simpleMoves } from '../moves'
import type { RotarySetup } from '../types'
import { blankRadius, planeToCyl, ROTARY_LETTER } from './frame'
import { RotaryStock } from './stock'

/** Is this toolpath on a rotary set-up? */
export const isRotaryPath = (tp: Pick<Toolpath, 'rotary'>) => !!tp.rotary

/** A rotary toolpath's moves in the stock frame of a blank whose farthest reach is `Rs`. */
export function stockFrameMoves(tp: Toolpath, setup: RotarySetup): Move[] {
  const r = tp.rotary
  if (!r) return tp.moves
  const Rs = blankRadius(setup.blank)
  const u0 = setup.blank.start
  const out: Move[] = []
  for (const m of simpleMoves(tp.moves)) {
    if (m.t === 'drill' || m.t === 'arc') continue
    const c = planeToCyl(r.plane, m.x, m.y, m.z)
    const p = { x: c.u - u0, y: Rs * c.theta, z: c.rho - Rs }
    out.push(m.t === 'rapid' ? { t: 'rapid', ...p } : { t: 'feed', ...p, f: m.f, ...(m.k ? { k: m.k } : {}) })
  }
  return out
}

/** The rotary toolpaths of a list, in program order, moved into the stock frame (others left out). */
export function rotaryProgram(toolpaths: readonly Toolpath[], setup: RotarySetup): Toolpath[] {
  return programOrder(toolpaths.filter(isRotaryPath)).map((tp) => ({ ...tp, moves: stockFrameMoves(tp, setup) }))
}

/** Timeline of a part's rotary toolpaths in the stock frame. */
export function rotaryTimeline(toolpaths: readonly Toolpath[], setup: RotarySetup): { tl: SimTimeline; paths: Toolpath[] } {
  const paths = rotaryProgram(toolpaths, setup)
  return { tl: buildTimeline(paths), paths }
}

/** A sensible cell for a rotary stock: 0.25 mm, coarser for large blanks (at most about 4 million rays). */
export function rotaryCell(setup: RotarySetup): number {
  const L = Math.max(1, setup.blank.end - setup.blank.start)
  const C = 2 * Math.PI * blankRadius(setup.blank)
  for (const c of [0.25, 0.5, 1, 2]) if ((L / c) * (C / c) <= 4e6) return c
  return 4
}

/**
 * Collision check of a part's rotary toolpaths (SIM-03 on the rotary stock): shank above the
 * flutes and holder (with the margin) against the material left, rapids through material, and the
 * tip reaching the axis.
 */
export function rotaryCollisions(setup: RotarySetup, toolpaths: readonly Toolpath[], machine: MachineProfile, opt: { cell?: number; work?: Work } = {}): { found: Collision[]; tl: SimTimeline; stock: RotaryStock } {
  const { tl, paths } = rotaryTimeline(toolpaths, setup)
  const stock = new RotaryStock(setup, opt.cell ?? Math.max(0.5, rotaryCell(setup)))
  const cs = collisionSetup(tl, paths, machine, stock.Rs)
  const u0 = setup.blank.start
  // positions as the machine's axes: along the axis, the rotary angle, the tip's distance from the axis
  const place = (at: { x: number; y: number; z: number }) => `${setup.axis}${(at.x + u0).toFixed(1)} ${ROTARY_LETTER[setup.axis]}${((at.y / stock.Rs) * (180 / Math.PI)).toFixed(1)}° at ${(at.z + stock.Rs).toFixed(1)} mm from the axis`
  return { found: checkCollisions(tl, stock, { ...cs, rotary: true, place }, opt.work), tl, stock }
}
