/**
 * The stock model a program needs: the heightfield for vertical tools (fast, exact for them), the
 * dexel stock when a lollipop works under an overhang (a heightfield cannot hold material over an
 * empty space and would show the lip cut away).
 */
import type { Toolpath } from '../toolpath'
import { DEXEL_MAX, DexelStock } from './dexel'
import { HeightfieldStock } from './heightfield'

export function needsDexel(toolpaths: readonly Pick<Toolpath, 'tool'>[]): boolean {
  // (a thread mill cuts sideways into a wall too: its groove has material over it)
  return toolpaths.some((tp) => tp.tool?.shape === 'lollipop' || tp.tool?.shape === 'thread')
}

/**
 * Pieces of material a column may need: one more than the turns of the longest thread (its
 * grooves leave a piece between turns), at least the dexel default, at most 40.
 */
export function piecesNeeded(toolpaths: readonly Pick<Toolpath, 'tool' | 'moves'>[]): number {
  let most = 0
  for (const tp of toolpaths) {
    if (tp.tool?.shape !== 'thread') continue
    // a pass: helical arcs one after another (each half a turn or less)
    let run = 0
    let z = NaN
    for (const m of tp.moves) {
      if (m.t === 'poly') continue
      if (m.t === 'arc' && Math.abs(m.z - z) > 1e-12) run++
      else run = 0
      most = Math.max(most, run)
      z = m.z
    }
  }
  return Math.min(40, Math.max(DEXEL_MAX, Math.ceil(most / 2) + 3))
}

export function stockFor(panel: { length: number; width: number; thickness: number }, toolpaths: readonly Pick<Toolpath, 'tool' | 'moves'>[], cell?: number): HeightfieldStock | DexelStock {
  return needsDexel(toolpaths) ? new DexelStock(panel.length, panel.width, panel.thickness, cell, piecesNeeded(toolpaths)) : new HeightfieldStock(panel.length, panel.width, panel.thickness, cell)
}
