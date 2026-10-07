/**
 * Part compare for whole parts (M3.6, SIM-04): a part's program simulated to its end on the stock
 * model it needs (the same choice as the simulator: heightfield, dexel for lollipops and thread
 * mills, three-way rays for tilted and 5-axis work, the rotary stock for turned work), its surface
 * compared with the part's 3D models, and a summary per part (for several parts at once).
 *
 * Pure: no DOM, no React.
 */
import type { Work } from '@/core/cancel'
import type { MachineProfile } from '@/core/types'
import { placeMesh } from '../mesh/place'
import type { Mesh } from '../mesh/types'
import { needsPositional, positionalCollisions } from '../positional/sim'
import { rotaryCollisions, rotaryCell } from '../rotary/sim'
import { buildTimeline, type Heightfield, programOrder } from '../sim'
import { stockFor } from '../stock/choose'
import { carveStock, simCell } from '../stock/simulation'
import type { StockModel } from '../stock/types'
import type { Toolpath } from '../toolpath'
import type { CamPart } from '../types'
import { compareStock, compareThumb, type CompareOptions, type CompareSummary, DEFAULT_COMPARE } from './compare'

/** The stock at the end of the part's program. */
export function finishedStock(part: CamPart, toolpaths: readonly Toolpath[], machine: MachineProfile, opts: { cell?: number; work?: Work } = {}): StockModel {
  const live = toolpaths.filter((tp) => tp.moves.length)
  if (part.rotary && live.some((tp) => tp.rotary)) return rotaryCollisions(part.rotary, live.filter((tp) => tp.rotary), machine, { cell: opts.cell ?? Math.max(0.5, rotaryCell(part.rotary)), work: opts.work }).stock
  if (needsPositional(live)) return positionalCollisions(part, live, machine, { cell: opts.cell, work: opts.work }).stock
  const paths = programOrder([...live])
  const tl = buildTimeline(paths)
  const stock = stockFor(part, paths, opts.cell ?? simCell(part.length, part.width))
  carveStock(stock, tl, 0, tl.total)
  return stock
}

/**
 * The surface of a heightfield as a closed mesh with one top point per cell, at the cell's centre
 * and its height (what the simulation holds there; the plain stock mesh puts its corners at the
 * lowest of the cells round them, for drawing). Every `step` cells.
 */
export function cellMesh(hf: Heightfield, step = 1): Mesh {
  const s = Math.max(1, Math.round(step))
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < hf.nx; i += s) xs.push(i)
  for (let j = 0; j < hf.ny; j += s) ys.push(j)
  const cx = xs.length
  const cy = ys.length
  const n = cx * cy
  const pos = new Float32Array(n * 2 * 3)
  const bottom = -hf.thickness
  for (let b = 0; b < cy; b++)
    for (let a = 0; a < cx; a++) {
      const k = b * cx + a
      const x = Math.min((xs[a] + 0.5) * hf.cell, hf.length)
      const y = Math.min((ys[b] + 0.5) * hf.cell, hf.width)
      pos[k * 3] = x
      pos[k * 3 + 1] = y
      pos[k * 3 + 2] = Math.max(bottom, hf.top[ys[b] * hf.nx + xs[a]])
      pos[(n + k) * 3] = x
      pos[(n + k) * 3 + 1] = y
      pos[(n + k) * 3 + 2] = bottom
    }
  const tris: number[] = []
  const v = (a: number, b: number, top: boolean) => (top ? 0 : n) + b * cx + a
  for (let b = 0; b + 1 < cy; b++)
    for (let a = 0; a + 1 < cx; a++) {
      tris.push(v(a, b, true), v(a + 1, b, true), v(a + 1, b + 1, true), v(a, b, true), v(a + 1, b + 1, true), v(a, b + 1, true))
      tris.push(v(a, b, false), v(a + 1, b + 1, false), v(a + 1, b, false), v(a, b, false), v(a, b + 1, false), v(a + 1, b + 1, false))
    }
  const ring: [number, number][] = []
  for (let a = 0; a + 1 < cx; a++) ring.push([a, 0])
  for (let b = 0; b + 1 < cy; b++) ring.push([cx - 1, b])
  for (let a = cx - 1; a > 0; a--) ring.push([a, cy - 1])
  for (let b = cy - 1; b > 0; b--) ring.push([0, b])
  for (let k = 0; k < ring.length; k++) {
    const [ai, aj] = ring[k]
    const [bi, bj] = ring[(k + 1) % ring.length]
    tris.push(v(ai, aj, false), v(bi, bj, false), v(bi, bj, true), v(ai, aj, false), v(bi, bj, true), v(ai, aj, true))
  }
  return { positions: pos, indices: Uint32Array.from(tris) }
}

/** Largest number of cells compared one by one; bigger stocks are compared every few cells. */
export const COMPARE_MAX_CELLS = 2e6

/** The stock's surface for the compare: one point per cell for the heightfield, else its mesh. */
export function stockSurface(stock: StockModel): Mesh {
  if (stock.kind === 'heightfield') {
    const hf = (stock as unknown as { hf: Heightfield }).hf
    return cellMesh(hf, Math.max(1, Math.ceil(Math.sqrt((hf.nx * hf.ny) / COMPARE_MAX_CELLS))))
  }
  return stock.toMesh()
}

/** A part's 3D models placed in the part (visible ones), from their stored meshes by blob key. */
export function placedModels(part: Pick<CamPart, 'models'>, meshes: ReadonlyMap<string, Mesh>): Mesh[] {
  return (part.models ?? []).filter((m) => m.visible !== false && meshes.has(m.blob)).map((m) => placeMesh(meshes.get(m.blob)!, m.place))
}

export interface PartCompare {
  /** The stock surface compared (part frame) and the signed distance at each of its points. */
  mesh: Mesh
  d: Float32Array
  summary: CompareSummary
  /** A small top view of the colour map. */
  thumb: { w: number; h: number; rgba: Uint8ClampedArray }
  /** Why (some of) it could not be compared. */
  notes: string[]
}

/** Simulate a part's program to its end and compare the stock with its models. */
export function comparePart(part: CamPart, toolpaths: readonly Toolpath[], machine: MachineProfile, models: readonly Mesh[], opt: CompareOptions = DEFAULT_COMPARE, work?: Work): PartCompare {
  const notes: string[] = []
  if (!models.length) notes.push('The part has no 3D model to compare with.')
  if (!toolpaths.some((tp) => tp.moves.length)) notes.push('No toolpaths yet: the uncut block is compared.')
  const stock = finishedStock(part, toolpaths, machine, { work: work && { isCancelled: work.isCancelled, progress: (f, n) => work.progress?.(f * 0.5, n ?? 'Simulating') } })
  const mesh = stockSurface(stock)
  const r = compareStock(mesh, models, part, opt, work && { isCancelled: work.isCancelled, progress: (f, n) => work.progress?.(0.5 + f * 0.5, n) })
  if (models.length && !r.summary.compared) notes.push('No point of the stock lies over a model (an open model is compared only inside its outline seen from above).')
  return { mesh, d: r.d, summary: r.summary, thumb: compareThumb(mesh, r.d, part, 160, opt), notes }
}
