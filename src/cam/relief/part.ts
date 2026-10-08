/**
 * Putting a relief on a part (ART-01): the model (already made to its size and stored in the blob
 * store), placed centred or at a given corner with its top at a given height, and, if asked, a
 * roughing and a finishing operation on it. The operations use the usual placeholder cutting
 * values (each shows its "Configure" badge until the shop sets its own).
 */
import { nanoid } from 'nanoid'
import { withNewOp } from '../doc'
import { defaultOp } from '../ops'
import type { CamOp, CamPart, Finish3dOp, ModelRef, ReliefInfo, Rough3dOp } from '../types'
import type { MeshUnits } from '../mesh/types'

export const RELIEF_LAYER = { id: 'models', name: '3D models', color: '#c084fc', visible: true, locked: false }

export interface ReliefPlacement {
  /** Centre the relief on the part, or put its lower-left corner at `x`, `y`. */
  centre: boolean
  x: number
  y: number
  /** Height of the relief's highest point: 0 = flush with face 1, negative = below it. */
  top: number
}

export interface AddRelief {
  blob: string
  name: string
  source: string
  units: MeshUnits
  triangles: number
  info: ReliefInfo
  place: ReliefPlacement
  /** Also add Z-level roughing and parallel finishing on the relief. */
  withOps: boolean
}

const r3 = (n: number) => Math.round(n * 1000) / 1000

/** Where the relief's lower-left corner goes. */
export function reliefCorner(part: Pick<CamPart, 'length' | 'width'>, size: [number, number, number], p: ReliefPlacement): [number, number, number] {
  return p.centre ? [r3((part.length - size[0]) / 2), r3((part.width - size[1]) / 2), p.top] : [p.x, p.y, p.top]
}

/** Things to tell the user about where the relief sits (not blocking). */
export function reliefPlacementNotes(part: Pick<CamPart, 'length' | 'width' | 'thickness'>, size: [number, number, number], at: [number, number, number]): string[] {
  const out: string[] = []
  if (at[0] < -1e-6 || at[1] < -1e-6 || at[0] + size[0] > part.length + 1e-6 || at[1] + size[1] > part.width + 1e-6) out.push('The relief runs past the edge of the part.')
  if (at[2] > 1e-6) out.push('The top of the relief is above face 1: the part of it above the panel is not cut.')
  if (-(at[2] - size[2]) > part.thickness - 1e-6) out.push('The relief goes deeper than the part is thick.')
  return out
}

/** The part with the relief added (and its operations, if asked). */
export function addRelief(part: CamPart, a: AddRelief): { part: CamPart; model: ModelRef; ops: CamOp[] } {
  const at = reliefCorner(part, a.info.size, a.place)
  const model: ModelRef = {
    id: nanoid(8),
    name: a.name,
    kind: 'mesh',
    blob: a.blob,
    source: a.source,
    units: a.units,
    place: { up: '+z', rotZ: 0, scale: 1, mirror: false, at },
    layer: RELIEF_LAYER.id,
    visible: true,
    triangles: a.triangles,
    size: [...a.info.size],
    relief: a.info,
  }
  const ops: CamOp[] = []
  if (a.withOps) {
    const r = defaultOp('rough3d') as Rough3dOp
    const f = defaultOp('finish3d') as Finish3dOp
    ops.push({ ...r, name: `Relief roughing: ${a.name}`, surface: { ...r.surface, modelId: model.id } }, { ...f, name: `Relief finishing: ${a.name}`, surface: { ...f.surface, modelId: model.id } })
  }
  const layers = part.layers.some((l) => l.id === RELIEF_LAYER.id) ? part.layers : [...part.layers, { ...RELIEF_LAYER }]
  // Polish-2: before the part's cut-out, if it has one
  return { part: { ...part, layers, models: [...(part.models ?? []), model], ops: withNewOp(part, ...ops) }, model, ops }
}
