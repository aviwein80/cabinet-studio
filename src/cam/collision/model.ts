/**
 * Shank and holder against the 3D model, checked when a 3D operation is calculated (not only in
 * simulation). The model (plus the stock to leave) is material that stays whatever ran before, so
 * any shank or holder intrusion into it is certain. Reports the stick-out and flute length the
 * operation needs. Uses the same envelopes as the simulation's collision check.
 */
import type { CutterOutline } from '@/core/machineModel'
import { topRaster } from '../3d/rest3d'
import type { Mesh } from '../mesh/types'
import { meshBounds } from '../mesh/types'
import { simpleMoves } from '../moves'
import { arcPoints, createHeightfield, type V3 } from '../sim'
import { HeightfieldStock } from '../stock/heightfield'
import { simCell } from '../stock/simulation'
import type { Move } from '../toolpath'
import { COLLISION_TOL, envelopeR, holderLow, shankLow } from './collision'

export interface ModelClearance {
  /** Worst holder intrusion (mm) and where it first happens; null when clear. */
  holder: { depth: number; move: number; at: V3 } | null
  shank: { depth: number; move: number; at: V3 } | null
}

/**
 * Check every tool position of `moves` (every half cell along each move) against the model.
 * `panel`: the part's size (the model raster covers it).
 */
export function modelClearance(mesh: Mesh, moves: Move[], o: CutterOutline, margin: number, stock: number, panel: { length: number; width: number; thickness: number }): ModelClearance {
  const res: ModelClearance = { holder: null, shank: null }
  const M = Math.max(0, margin)
  const top = Math.min(0, meshBounds(mesh).max[2] + Math.max(0, stock))
  // nothing can reach the model if every position keeps flutes and holder above its top
  let lowTip = Infinity
  for (const m of simpleMoves(moves)) if (m.t !== 'drill' && m.z < lowTip) lowTip = m.z
  const holderFace = o.holder.length ? o.holder[0].z - M : Infinity
  if (!(lowTip + Math.min(o.flute, holderFace) < top)) return res
  const cell = Math.max(0.5, simCell(panel.length, panel.width))
  const hf = createHeightfield(panel.length, panel.width, panel.thickness, cell)
  const { top: model } = topRaster(mesh, hf.nx, hf.ny, cell)
  for (let k = 0; k < model.length; k++) hf.top[k] = Number.isFinite(model[k]) ? Math.max(-panel.thickness, Math.min(0, model[k] + Math.max(0, stock))) : -panel.thickness
  const raster = HeightfieldStock.wrap(hf)
  let at: V3 = { x: 0, y: 0, z: 50 }
  let n = -1
  const note = (key: 'holder' | 'shank', depth: number, p: V3) => {
    const r = res[key]
    if (!r) res[key] = { depth, move: n, at: p }
    else if (depth > r.depth) r.depth = depth
  }
  for (const m of simpleMoves(moves)) {
    n++
    // (arcs as the simulator draws them, so helix entries are followed)
    const ends: V3[] = m.t === 'arc' ? arcPoints(at, m) : [{ x: m.x, y: m.y, z: m.z }]
    for (const b of ends) {
      for (const p of raster.carvePoints(at, b)) {
        if (p.z + Math.min(o.flute, holderFace) >= top) continue
        if (p.z + o.flute < top) {
          const r = raster.intrusion(p.x, p.y, o.shankR + M, (d) => p.z + shankLow(o, M, d))
          if (r.depth > COLLISION_TOL) note('shank', r.depth, p)
        }
        if (o.holder.length && p.z + holderFace < top) {
          const r = raster.intrusion(p.x, p.y, envelopeR(o, M), (d) => p.z + holderLow(o, M, d))
          if (r.depth > COLLISION_TOL) note('holder', r.depth, p)
        }
      }
      at = b
    }
  }
  return res
}
