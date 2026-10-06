/**
 * Fittings placed by panel face in batch part lists (M2.9, AM-09). A fitting names a library
 * hardware item, the panel it goes on, the face and a position along an edge. Its holes come only
 * from the hardware's verified or approved drilling pattern (the same pattern and placement as the
 * Parts designer's "Place hardware holes"); a fitting without one is listed in the BOM only.
 *
 * Face words are the part model's own faces (`src/cam/types.ts`), the panel lying face up on the
 * machine with its length along X:
 *   top    = face 1 (face up)                  bottom = face 6 (underside)
 *   front  = face 2, the edge at Y = 0         back   = face 4, the edge at Y = width
 *   left   = face 5, the edge at X = 0         right  = face 3, the edge at X = length
 * For a fitting on an edge, that edge is the pattern's reference edge. For one on the top or
 * bottom face, the `edge` column names the reference edge (default front). `at` is the distance
 * along the reference edge from its left end seen from outside the panel (as edge faces and the
 * designer measure it): front left to right, right front to back, back right to left, left back
 * to front.
 */
import type { CamPart, FaceId, HardwarePattern } from '@/cam/types'
import { boringPattern, isUsable, patternDrillOp, placePattern, type RefEdge } from './hardware/patterns'
import type { Hardware, Library } from './types'

export type PanelFace = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right'
export type PanelEdge = 'front' | 'back' | 'left' | 'right'

export const PANEL_FACES: PanelFace[] = ['top', 'bottom', 'front', 'back', 'left', 'right']
const EDGES: PanelEdge[] = ['front', 'back', 'left', 'right']

/** Panel edge -> the designer's edge (plan view, face up). */
export const REF_EDGE: Record<PanelEdge, RefEdge> = { front: 'bottom', right: 'right', back: 'top', left: 'left' }

export const parseFace = (s: string): PanelFace | null => (PANEL_FACES as string[]).includes(s.trim().toLowerCase()) ? (s.trim().toLowerCase() as PanelFace) : null
export const parseEdge = (s: string): PanelEdge | null => (EDGES as string[]).includes(s.trim().toLowerCase()) ? (s.trim().toLowerCase() as PanelEdge) : null

export interface Fitting {
  row: number
  hardwareId: string
  /** Item number of the panel it goes on (same order). */
  panel: string
  face: PanelFace
  /** Reference edge for top / bottom fittings. */
  edge: PanelEdge
  /** Distance along the reference edge; null when the hardware has no drilling pattern. */
  at: number | null
  mirror: boolean
  /** How many of the fitting at this place on each panel (BOM). */
  qty: number
}

export function findHardware(lib: Library, key: string): Hardware | undefined {
  const k = key.trim().toLowerCase()
  return k ? lib.hardware.find((h) => h.code.toLowerCase() === k || h.id.toLowerCase() === k) : undefined
}

/** The drilling pattern for a fitting, turned to its face (bottom: top-face holes go to the underside). */
export function fittingPattern(lib: Library, f: Pick<Fitting, 'hardwareId' | 'face'>): HardwarePattern | null {
  const p = boringPattern(lib, f.hardwareId)
  if (!p || !isUsable(p) || !p.holes.length) return null
  if (f.face !== 'bottom') return p
  const flip = (face: FaceId): FaceId => (face === 1 ? 6 : face === 6 ? 1 : face)
  return { ...p, holes: p.holes.map((h) => ({ ...h, face: flip(h.face) })) }
}

export const refEdgeOf = (f: Pick<Fitting, 'face' | 'edge'>): PanelEdge => (f.face === 'top' || f.face === 'bottom' ? f.edge : f.face)

/**
 * Put one fitting's holes on a panel, with a drilling operation (as the designer does). Returns the
 * new part, whether it was drilled, and anything that does not fit.
 */
export function placeFitting(part: CamPart, f: Fitting, lib: Library): { part: CamPart; drilled: boolean; warnings: string[] } {
  const hw = lib.hardware.find((h) => h.id === f.hardwareId)
  const pattern = fittingPattern(lib, f)
  if (!pattern) return { part, drilled: false, warnings: [`${hw?.code ?? f.hardwareId}: no approved drilling pattern, so it is in the BOM only.`] }
  const placed = placePattern(part, pattern, { edge: REF_EDGE[refEdgeOf(f)], at: f.at ?? 0, mirror: f.mirror })
  if (!placed.ids.length) return { part, drilled: false, warnings: placed.warnings }
  const op = patternDrillOp(pattern, placed.ids)
  return { part: { ...placed.part, ops: [...placed.part.ops, { ...op, name: `${op.name} (${f.face}${f.face === 'top' || f.face === 'bottom' ? `, from the ${f.edge} edge` : ''})` }] }, drilled: true, warnings: placed.warnings }
}
