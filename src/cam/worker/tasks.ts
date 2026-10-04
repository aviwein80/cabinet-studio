/**
 * Heavy 3D jobs, as plain functions keyed by name. The compute worker runs them off the UI thread;
 * tests and the batch runner can call them directly. Inputs and outputs are structured-clone
 * friendly (typed arrays, plain objects).
 */
import type { Work } from '@/core/cancel'
import type { Contour, P } from '../geom'
import { buildMesh } from '../mesh/build'
import { autoUp, DEFAULT_PLACEMENT, placedSize, placeMesh } from '../mesh/place'
import { readMeshFile } from '../mesh/read'
import { simplifyMesh, type SimplifyResult, type SimplifyTarget } from '../mesh/simplify'
import { deleteFacets, type FacetFilter, featureEdges, projectOutline, sectionAt, sectionContours } from '../mesh/tools'
import type { Mesh, MeshReport, MeshUnits } from '../mesh/types'
import { decodeMesh, encodeMesh, gunzip, gzip, sha256Hex } from '../model/blobs'
import { polyline } from '../geom'
import type { ModelPlacement, UpAxis } from '../types'

export interface ImportedModel {
  mesh: Mesh
  report: MeshReport
  /** Up axis chosen (auto lays the model flat). */
  up: UpAxis
  /** Size once placed with that up axis. */
  size: [number, number, number]
}

export interface Packed {
  hash: string
  gz: Uint8Array
}

export interface TaskMap {
  'mesh.import': { in: { bytes: Uint8Array; name: string; units?: MeshUnits; up?: UpAxis | 'auto'; gapTol?: number }; out: ImportedModel }
  'mesh.simplify': { in: { mesh: Mesh; target: SimplifyTarget }; out: SimplifyResult }
  'mesh.section': { in: { mesh: Mesh; place: ModelPlacement; levels: number[]; fitTol: number }; out: { z: number; contours: Contour[] }[] }
  'mesh.outline': { in: { mesh: Mesh; place: ModelPlacement }; out: Contour[] }
  'mesh.edges': { in: { mesh: Mesh; place: ModelPlacement; angle: number }; out: [number, number, number][][] }
  'mesh.deleteFacets': { in: { mesh: Mesh; filter: FacetFilter }; out: { mesh: Mesh; report: MeshReport } }
  'mesh.size': { in: { mesh: Mesh; place: ModelPlacement }; out: [number, number, number] }
  'blob.pack': { in: { mesh: Mesh }; out: Packed }
  'blob.unpack': { in: { gz: Uint8Array; hash: string }; out: Mesh }
}

export type TaskName = keyof TaskMap
export type TaskIn<K extends TaskName> = TaskMap[K]['in']
export type TaskOut<K extends TaskName> = TaskMap[K]['out']

type Handler<K extends TaskName> = (input: TaskIn<K>, work: Work) => Promise<TaskOut<K>> | TaskOut<K>

const loops = (pts: P[][]) => pts.map((p) => polyline(p, true))

export const TASKS: { [K in TaskName]: Handler<K> } = {
  async 'mesh.import'({ bytes, name, units, up, gapTol }, work) {
    const soup = await readMeshFile(bytes, name, { ...work, progress: (f, n) => work.progress?.(f * 0.5, n) })
    const { mesh, report } = buildMesh(soup, { units, gapTol }, { ...work, progress: (f, n) => work.progress?.(0.5 + f * 0.5, n) })
    const axis = !up || up === 'auto' ? autoUp(mesh) : up
    return { mesh, report, up: axis, size: placedSize(mesh, { ...DEFAULT_PLACEMENT, up: axis }) }
  },
  'mesh.simplify': ({ mesh, target }, work) => simplifyMesh(mesh, target, work),
  'mesh.section'({ mesh, place, levels, fitTol }, work) {
    const placed = placeMesh(mesh, place)
    return levels.map((z, i) => {
      work.progress?.(i / Math.max(1, levels.length), `Section ${i + 1} of ${levels.length}`)
      return { z, contours: sectionContours(sectionAt(placed, z), fitTol) }
    })
  },
  'mesh.outline': ({ mesh, place }, work) => loops(projectOutline(placeMesh(mesh, place), work)),
  'mesh.edges': ({ mesh, place, angle }) => featureEdges(placeMesh(mesh, place), angle),
  'mesh.deleteFacets'({ mesh, filter }, work) {
    const kept = deleteFacets(mesh, filter)
    const ix = kept.indices
    const corners = new Float32Array(ix.length * 3)
    for (let i = 0; i < ix.length; i++) corners.set(kept.positions.subarray(ix[i] * 3, ix[i] * 3 + 3), i * 3)
    return buildMesh({ format: 'mesh', corners, triangles: ix.length / 3, bad: 0, warnings: [], ...(kept.groups ? { groups: kept.groups, groupNames: kept.groupNames } : {}) }, { units: 'mm', gapTol: 0 }, work)
  },
  'mesh.size': ({ mesh, place }) => placedSize(mesh, place),
  async 'blob.pack'({ mesh }) {
    const raw = encodeMesh(mesh)
    return { hash: await sha256Hex(raw), gz: await gzip(raw) }
  },
  async 'blob.unpack'({ gz, hash }) {
    const raw = await gunzip(gz)
    if ((await sha256Hex(raw)) !== hash) throw new Error(`3D model data ${hash.slice(0, 12)}… is damaged (checksum mismatch).`)
    return decodeMesh(raw)
  },
}

export async function runTask<K extends TaskName>(name: K, input: TaskIn<K>, work: Work = {}): Promise<TaskOut<K>> {
  const h = TASKS[name] as Handler<K> | undefined
  if (!h) throw new Error(`Unknown task ${name}`)
  return h(input, work)
}

/** Typed arrays in a result, so they move to the caller without copying. */
export function transferables(v: unknown, out: Set<ArrayBuffer> = new Set(), depth = 0): ArrayBuffer[] {
  if (depth > 6 || v === null || typeof v !== 'object') return [...out]
  if (ArrayBuffer.isView(v)) {
    if (v.buffer instanceof ArrayBuffer && v.byteOffset === 0 && v.byteLength === v.buffer.byteLength) out.add(v.buffer)
    return [...out]
  }
  for (const x of Array.isArray(v) ? v : Object.values(v)) transferables(x, out, depth + 1)
  return [...out]
}
