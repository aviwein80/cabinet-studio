/**
 * Recognised features to a custom part: each kind of feature on a layer named the way the Stage 1
 * layer rules already read (shop layer names), so applying the rules gives the operations:
 *
 * | Feature | Layer | Stage 1 rule |
 * |---|---|---|
 * | Outer outline | Outline | profile, outside, through |
 * | Cut-out through the panel | INSIDE | inside cut, through |
 * | Pocket from face 1 (with its islands) | POCKET_D<depth> | pocket, depth from the name |
 * | Blind hole from face 1 | DRILL_D<diameter>_<depth> | drill, depth from the name (and the shape's own depth) |
 * | Through hole | THRU_DRILL_D<diameter> | drill through |
 * | Blind hole from face 6 | DRILL_D<diameter>_<depth>_BACK | drill; face 6 holes go into the turned-over program |
 * | Hole in an edge (faces 2-5) | DRILL_D<diameter>_<depth>_EDGE | drill; needs a horizontal drill unit |
 * | Pocket from face 6 | BACK_POCKET_D<depth> | none (not machined from the top; a warning says so) |
 * | Edge hole with no drill that size | EDGE_HOLE_D<diameter>_<depth> | none (shown, not machined) |
 *
 * Depths and diameters are written to 0.001 mm. Hole shapes also carry their exact depth.
 * Every shape remembers the solid faces it came from (`Entity.solid`).
 */
import { nanoid } from 'nanoid'
import { DEFAULT_LAYERS, newPart } from '../doc'
import { area, type Contour, radius, type Seg } from '../geom'
import type { CamPart, Entity, Geom, Layer, ModelRef, SolidRole } from '../types'
import { type Recognition, recognizePanel, type RecognizeOptions } from './recognize'
import { matchMaterial } from './material'
import type { SolidData } from './types'

export { matchMaterial }

const n3 = (n: number) => String(Math.round(n * 1000) / 1000)

export const featureLayerName = {
  outline: () => 'Outline',
  cutout: () => 'INSIDE',
  pocket: (depth: number) => `POCKET_D${n3(depth)}`,
  backPocket: (depth: number) => `BACK_POCKET_D${n3(depth)}`,
  drill: (d: number, depth: number) => `DRILL_D${n3(d)}_${n3(depth)}`,
  thru: (d: number) => `THRU_DRILL_D${n3(d)}`,
  backDrill: (d: number, depth: number) => `DRILL_D${n3(d)}_${n3(depth)}_BACK`,
  edgeDrill: (d: number, depth: number) => `DRILL_D${n3(d)}_${n3(depth)}_EDGE`,
  /** An edge hole with no drill that size: no rule machines this layer. */
  edgeNoTool: (d: number, depth: number) => `EDGE_HOLE_D${n3(d)}_${n3(depth)}`,
}

const COLORS = ['#f59e0b', '#38bdf8', '#34d399', '#f472b6', '#a78bfa', '#fb7185', '#facc15', '#22d3ee', '#4ade80', '#e879f9']
const layerId = (name: string) => `sol-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

/** A closed contour that is one whole circle, as a circle (so drills and rules see a circle). */
function asCircle(c: Contour): { c: { x: number; y: number }; r: number } | null {
  if (!c.segs.length || c.segs.some((s) => s.k !== 'A')) return null
  const arcs = c.segs as Extract<Seg, { k: 'A' }>[]
  const c0 = arcs[0].c
  const r0 = radius(arcs[0])
  if (arcs.some((a) => Math.hypot(a.c.x - c0.x, a.c.y - c0.y) > 1e-6 || Math.abs(radius(a) - r0) > 1e-6)) return null
  if (Math.abs(Math.abs(area(c)) - Math.PI * r0 * r0) > 1e-3 * r0) return null
  return { c: c0, r: r0 }
}

export interface FeatureRow {
  kind: 'outline' | 'cut-out' | 'pocket' | 'hole' | 'edge hole' | 'back pocket'
  layer: string
  face: number
  size: string
  depth?: number
  faces: number[]
}

/**
 * Layers and shapes for a recognition. `model`: the solid model's id and blob (the shapes link to
 * its faces). Existing layers are kept; the Outline layer is the standard one.
 */
export function featureEntities(rec: Recognition, model: { id: string; blob: string }, existing: Layer[] = DEFAULT_LAYERS) {
  const layers = existing.map((l) => ({ ...l }))
  const entities: Entity[] = []
  const rows: FeatureRow[] = []
  const layerFor = (name: string) => {
    if (name === 'Outline') return layers.find((l) => l.id === 'outline' || l.name === 'Outline')!.id
    const id = layerId(name)
    if (!layers.some((l) => l.id === id)) layers.push({ id, name, color: COLORS[layers.length % COLORS.length], visible: true, locked: false })
    return id
  }
  const add = (g: Geom, layer: string, role: SolidRole, faces: number[], face: Entity['face'] = 1, depth?: number) => {
    const e: Entity = { id: nanoid(8), layer: layerFor(layer), g, face, ...(depth !== undefined ? { depth } : {}), solid: { modelId: model.id, faces: [...faces].sort((a, b) => a - b), blob: model.blob, role } }
    entities.push(e)
    return e
  }
  const shape = (c: Contour): Geom => {
    const circ = asCircle(c)
    return circ ? { t: 'circle', c: circ.c, r: circ.r } : { t: 'contour', c }
  }
  const outline = add({ t: 'contour', c: rec.outline }, featureLayerName.outline(), 'outline', rec.outlineFaces)
  rows.push({ kind: 'outline', layer: 'Outline', face: 1, size: `${n3(rec.frame.length)} × ${n3(rec.frame.width)}`, faces: rec.outlineFaces })
  for (const c of rec.cutouts) {
    add(shape(c.contour), featureLayerName.cutout(), 'cutout', c.faces)
    rows.push({ kind: 'cut-out', layer: 'INSIDE', face: 1, size: sizeOf(c.contour), faces: c.faces })
  }
  for (const p of rec.pockets) {
    const name = p.face === 1 ? featureLayerName.pocket(p.depth) : featureLayerName.backPocket(p.depth)
    add(shape(p.contour), name, 'pocket', p.faces, p.face)
    for (const isl of p.islands) add(shape(isl), name, 'island', [p.floor], p.face)
    rows.push({ kind: p.face === 1 ? 'pocket' : 'back pocket', layer: name, face: p.face, size: `${sizeOf(p.contour)}${p.islands.length ? `, ${p.islands.length} island(s)` : ''}`, depth: p.depth, faces: p.faces })
  }
  for (const h of rec.holes) {
    const name = h.face === 6 ? featureLayerName.backDrill(h.d, h.depth) : h.face === 1 ? (h.through ? featureLayerName.thru(h.d) : featureLayerName.drill(h.d, h.depth)) : h.noTool ? featureLayerName.edgeNoTool(h.d, h.depth) : featureLayerName.edgeDrill(h.d, h.depth)
    add({ t: 'circle', c: { x: h.x, y: h.y }, r: h.d / 2 }, name, 'hole', h.faces, h.face, h.depth)
    rows.push({ kind: h.face >= 2 && h.face <= 5 ? 'edge hole' : 'hole', layer: name, face: h.face, size: `Ø${n3(h.d)}${h.tipDepth !== undefined ? ` (point to ${n3(h.tipDepth)})` : ''}`, depth: h.depth, faces: h.faces })
  }
  return { layers, entities, outlineId: outline.id, rows }
}

function sizeOf(c: Contour) {
  const circ = asCircle(c)
  if (circ) return `Ø${n3(circ.r * 2)}`
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const s of c.segs)
    for (const p of [s.a, s.b]) {
      x0 = Math.min(x0, p.x)
      y0 = Math.min(y0, p.y)
      x1 = Math.max(x1, p.x)
      y1 = Math.max(y1, p.y)
    }
  return `${n3(x1 - x0)} × ${n3(y1 - y0)}`
}

export interface SolidPartOptions extends RecognizeOptions {
  /** Body (index in the file) to make the part from. */
  body: number
  /** Blobs of the stored solid (only that body) and of the original file. */
  blob: string
  file?: string
  source: string
  name?: string
  qty?: number
  materialId?: string | null
  modelId?: string
  /** Library materials: one named (or coded) as the file's "Material" property is picked. */
  materials?: { id: string; name: string; code?: string }[]
}


/**
 * A custom part from one body of a solid: laid flat (face 1 up, length along X), sized to it,
 * with the solid on it as a model and the recognised features on layers.
 */
export function solidToPart(solid: SolidData, opt: SolidPartOptions): { part: CamPart; recognition: Recognition; rows: FeatureRow[] } {
  const body = solid.bodies.find((b) => b.index === opt.body)
  if (!body) throw new Error(`Body ${opt.body} is not in this solid.`)
  const rec = recognizePanel(body, opt)
  const f = rec.frame
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6
  const modelId = opt.modelId ?? nanoid(8)
  const props = solid.products.find((p) => p.name === body.name)?.properties ?? {}
  const model: ModelRef = {
    id: modelId,
    name: body.name || opt.source.replace(/\.[^.]+$/, ''),
    kind: 'solid',
    blob: opt.blob,
    ...(opt.file ? { file: opt.file } : {}),
    source: opt.source,
    units: (['mm', 'cm', 'm', 'in', 'ft'].includes(solid.units) ? solid.units : 'mm') as ModelRef['units'],
    place: { frame: [...f.R[0], ...f.R[1], ...f.R[2]], up: '+z', rotZ: 0, scale: 1, mirror: false, at: [0, 0, 0] },
    layer: 'models',
    visible: true,
    triangles: body.indices.length / 3,
    size: [r6(f.length), r6(f.width), r6(f.thickness)],
    faces: body.faces.length,
    format: `${solid.format.toUpperCase()}${solid.schema && solid.format === 'step' ? ` ${solid.schema}` : ''}`,
  }
  const { layers, entities, outlineId, rows } = featureEntities(rec, { id: modelId, blob: opt.blob })
  const modelsLayer: Layer = { id: 'models', name: '3D models', color: '#c084fc', visible: true, locked: false }
  const notes = Object.keys(props).length ? Object.entries(props).map(([k, v]) => `${k}: ${v}`).join('\n') : undefined
  const part = newPart({
    name: opt.name ?? (body.name || opt.source.replace(/\.[^.]+$/, '')),
    length: r6(f.length),
    width: r6(f.width),
    thickness: r6(f.thickness),
    qty: opt.qty ?? 1,
    materialId: opt.materialId ?? matchMaterial(props, opt.materials),
    layers: [...layers, modelsLayer],
    entities,
    outlineId,
    models: [model],
    source: `${model.format}: ${opt.source}`,
    ...(notes ? { notes } : {}),
  })
  return { part, recognition: rec, rows }
}
