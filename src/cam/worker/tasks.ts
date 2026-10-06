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
import type { CamPart, ModelPlacement, ModelRef, Recipe, UpAxis } from '../types'
import { generateOp, type Toolpath } from '../toolpath'
import type { MachineProfile } from '@/core/types'
import { type Collision, partCollisions } from '../collision/collision'
import { readSolid, type SolidReadOptions } from '../solid/convert'
import { decodeSolid, encodeSolid } from '../solid/encode'
import { occt } from '../solid/occt'
import type { SolidData } from '../solid/types'
import { type Recognition, recognizePanel, type RecognizeOptions } from '../solid/recognize'
import { type FeatureRow, featureEntities, solidToPart, type SolidPartOptions } from '../solid/toPart'
import { type AssemblyPart, assemblyParts } from '../solid/assembly'
import { type FaceAction, grainDirection, machineFaces, placementFrame, refreshSolidShapes, sendFacesToLayer } from '../solid/faces'
import { extendMesh, extrude, flat, loft, revolve, ruled, splitMesh, sweep, type V3 } from '../mesh/surface'
import { facesMesh, filletFaces, solidEdges, untrimFace } from '../solid/wires'
import type { Entity, Layer } from '../types'
import { holderEnvelope, type HolderFromModel } from '../tools/holder'
import { isSolidFile } from '../solid/format'
import { type ImagePixels, traceImage, type TraceOptions, type TraceResult } from '../trace'

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
  /** Read a STEP / IGES / BREP file. `vendor`: URL of the folder with the OpenCascade reader files. */
  'solid.import': { in: { bytes: Uint8Array; name: string; vendor?: string } & SolidReadOptions; out: SolidData }
  'solid.pack': { in: { solid: SolidData }; out: Packed }
  /** Trace a picture into closed contours (NEW-06). */
  'image.trace': { in: { img: ImagePixels; opt: TraceOptions }; out: TraceResult }
  /** A holder's revolved outline from a model of it (TOOL-04): mesh or solid file, its axis along the file's `up`. */
  'holder.fromModel': { in: { bytes: Uint8Array; name: string; units?: MeshUnits; up?: UpAxis; step?: number; vendor?: string }; out: HolderFromModel & { triangles: number } }
  'blob.unpackSolid': { in: { gz: Uint8Array; hash: string }; out: SolidData }
  /** Find the features of one body (SOL-01); with `model`, also the layers and shapes for them. */
  'solid.recognize': { in: { solid: SolidData; body: number; opt: Omit<RecognizeOptions, 'frame'>; model?: { id: string; blob: string }; layers?: Layer[]; grainFaces?: number[] }; out: { recognition: Recognition; layers?: Layer[]; entities?: Entity[]; outlineId?: string; rows?: FeatureRow[] } }
  /** Bodies of a file grouped into parts with quantities and properties (SOL-04). */
  'solid.assembly': { in: { solid: SolidData; opt: Omit<RecognizeOptions, 'frame'> }; out: AssemblyPart[] }
  /** A custom part from one body of a solid, laid flat with its features on layers. */
  'solid.part': { in: { solid: SolidData; opt: SolidPartOptions }; out: { part: CamPart; rows: FeatureRow[]; warnings: string[] } }
  /** Make or edit a surface (NEW-19); the result is a mesh in part coordinates. */
  'surface.make': { in: SurfaceJob; out: Mesh }
  /** Surfaces and edges from a solid's faces (CAD-16): in part coordinates as the model is placed. */
  'solid.faces': { in: { solid: SolidData; place: ModelPlacement; job: SolidFacesJob }; out: { mesh?: Mesh; edges?: [number, number, number][][] } }
  /** Machine picked faces (SOL-02): the part with the new shapes and operation. */
  'solid.machineFaces': { in: { part: CamPart; model: ModelRef; solid: SolidData; faces: number[]; action: FaceAction }; out: { part: CamPart; made: number; opName: string | null; warnings: string[] } }
  /** Send faces to a layer, with a recipe's operations (SOL-03). */
  'solid.sendFaces': { in: { part: CamPart; model: ModelRef; solid: SolidData; faces: number[]; layer: string; recipe?: Recipe }; out: { part: CamPart; made: number; warnings: string[] } }
  /** Make a model's shapes again from its current solid (same face ids). */
  'solid.refresh': { in: { part: CamPart; model: ModelRef; solid: SolidData }; out: { part: CamPart; updated: number; missing: number } }
  /** Store any bytes (the original file of a solid). */
  'blob.packBytes': { in: { bytes: Uint8Array }; out: Packed }
  /** Toolpaths of the given (3D) operations; meshes by blob hash. */
  'cam.generate': { in: { part: CamPart; machine: MachineProfile; opIds: string[]; meshes: Record<string, Mesh> }; out: Toolpath[] }
  /** Collision check of toolpaths on a panel (operations numbered in program order). */
  'sim.collide': { in: { panel: { length: number; width: number; thickness: number }; toolpaths: Toolpath[]; machine: MachineProfile }; out: Collision[] }
}

export type SurfaceJob =
  | { k: 'revolve'; profile: [number, number][]; angle: number; centre: [number, number]; tol: number }
  | { k: 'ruled'; a: V3[]; b: V3[] }
  | { k: 'loft'; sections: V3[][] }
  | { k: 'extrude'; curves: V3[][]; v: V3 }
  | { k: 'flat'; outer: [number, number][]; holes: [number, number][][]; z: number }
  | { k: 'sweep'; section: [number, number][]; closed: boolean; path: V3[] }
  | { k: 'extend'; mesh: Mesh; d: number }
  | { k: 'split'; mesh: Mesh; z: number; keep: 'above' | 'below' }

export type SolidFacesJob = { k: 'mesh'; faces: number[] } | { k: 'untrim'; face: number; tol: number } | { k: 'edges'; faces?: number[]; minAngle: number } | { k: 'fillet'; a: number; b: number; r: number; tol: number }

/** Several meshes as one (for extruding several curves). */
function joinMeshes(ms: Mesh[]): Mesh {
  let nv = 0
  const pos: number[] = []
  const idx: number[] = []
  for (const m of ms) {
    pos.push(...m.positions)
    for (const i of m.indices) idx.push(i + nv)
    nv += m.positions.length / 3
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) }
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
  'cam.generate'({ part, machine, opIds, meshes }, work) {
    const map = new Map(Object.entries(meshes))
    const ops = part.ops.filter((o) => opIds.includes(o.id))
    return ops.map((op, i) => generateOp(op, { part, machine, meshes: map, work: { isCancelled: work.isCancelled, progress: (f, n) => work.progress?.((i + f) / ops.length, n) } }))
  },
  'sim.collide': ({ panel, toolpaths, machine }, work) => partCollisions(panel, toolpaths, machine, work).found,
  async 'solid.import'({ bytes, name, vendor, ...opt }, work) {
    work.progress?.(0, 'Loading the solid-model reader')
    const reader = await occt(vendor)
    return readSolid(reader, bytes, name, opt, work)
  },
  'image.trace': ({ img, opt }) => traceImage(img, opt),
  async 'holder.fromModel'({ bytes, name, units, up, step, vendor }, work) {
    let mesh: Mesh
    if (isSolidFile(name)) {
      work.progress?.(0, 'Loading the solid-model reader')
      const solid = readSolid(await occt(vendor), bytes, name, {}, work)
      const n = solid.bodies.reduce((a, b) => a + b.positions.length, 0)
      const positions = new Float32Array(n)
      const idx: number[] = []
      let base = 0
      for (const b of solid.bodies) {
        positions.set(b.positions, base * 3)
        for (const k of b.indices) idx.push(k + base)
        base += b.positions.length / 3
      }
      mesh = { positions, indices: Uint32Array.from(idx) }
    } else {
      const soup = await readMeshFile(bytes, name, work)
      mesh = buildMesh(soup, { units }, work).mesh
    }
    const placed = placeMesh(mesh, { ...DEFAULT_PLACEMENT, up: up ?? '+z' })
    work.progress?.(0.9, 'Revolved outline')
    return { ...holderEnvelope(placed, { step }), triangles: mesh.indices.length / 3 }
  },
  async 'solid.pack'({ solid }) {
    const raw = encodeSolid(solid)
    return { hash: await sha256Hex(raw), gz: await gzip(raw) }
  },
  async 'blob.unpackSolid'({ gz, hash }) {
    const raw = await gunzip(gz)
    if ((await sha256Hex(raw)) !== hash) throw new Error(`Solid model data ${hash.slice(0, 12)}… is damaged (checksum mismatch).`)
    return decodeSolid(raw)
  },
  'solid.recognize'({ solid, body, opt, model, layers, grainFaces }, work) {
    const b = solid.bodies.find((x) => x.index === body)
    if (!b) throw new Error(`Body ${body} is not in this solid.`)
    work.progress?.(0.1, 'Finding features')
    const along = grainFaces?.length ? grainDirection(b, grainFaces) : null
    const recognition = recognizePanel(b, along ? { ...opt, align: { ...opt.align, along } } : opt)
    if (!model) return { recognition }
    return { recognition, ...featureEntities(recognition, model, layers) }
  },
  'solid.assembly'({ solid, opt }, work) {
    work.progress?.(0.1, 'Sorting the bodies into parts')
    return assemblyParts(solid, opt)
  },
  'solid.part'({ solid, opt }, work) {
    work.progress?.(0.1, 'Finding features')
    const { part, rows, recognition } = solidToPart(solid, opt)
    return { part, rows, warnings: recognition.warnings }
  },
  'surface.make'(job) {
    switch (job.k) {
      case 'revolve':
        return revolve(job.profile, { angle: job.angle, centre: job.centre, tol: job.tol })
      case 'ruled':
        return ruled(job.a, job.b)
      case 'loft':
        return loft(job.sections)
      case 'extrude':
        return joinMeshes(job.curves.map((c) => extrude(c, job.v)))
      case 'flat':
        return flat(job.outer, job.holes, job.z)
      case 'sweep':
        return sweep(job.section, job.path, { closedSection: job.closed })
      case 'extend':
        return extendMesh(job.mesh, job.d)
      case 'split': {
        const r = splitMesh(job.mesh, { p: [0, 0, job.z], n: [0, 0, 1] })
        return job.keep === 'above' ? r.above : r.below
      }
    }
  },
  'solid.faces'({ solid, place, job }) {
    const face = job.k === 'mesh' ? job.faces[0] : job.k === 'untrim' ? job.face : job.k === 'fillet' ? job.a : job.faces?.[0]
    const body = face !== undefined ? solid.bodies.find((b) => b.faces.some((f) => f.id === face)) : solid.bodies[0]
    if (!body) throw new Error('Those faces are not in this solid.')
    const pf = placementFrame(body, place)
    if ('error' in pf) throw new Error(pf.error)
    switch (job.k) {
      case 'mesh':
        return { mesh: facesMesh(body, pf.frame, job.faces) }
      case 'untrim':
        return { mesh: untrimFace(body, pf.frame, job.face, job.tol) }
      case 'fillet':
        return { mesh: filletFaces(body, pf.frame, job.a, job.b, job.r, job.tol) }
      case 'edges':
        return { edges: solidEdges(body, pf.frame, { faces: job.faces, minAngle: job.minAngle }).map((e) => e.pts) }
    }
  },
  'solid.machineFaces'({ part, model, solid, faces, action }) {
    const r = machineFaces(part, model, solid, faces, action)
    return { part: r.part, made: r.entities.length, opName: r.op?.name ?? null, warnings: r.warnings }
  },
  'solid.sendFaces'({ part, model, solid, faces, layer, recipe }) {
    const r = sendFacesToLayer(part, model, solid, faces, layer, recipe)
    return { part: r.part, made: r.entities.length, warnings: r.warnings }
  },
  'solid.refresh'({ part, model, solid }) {
    const r = refreshSolidShapes(part, model, solid)
    return { part: r.part, updated: r.updated, missing: r.missing.length }
  },
  async 'blob.packBytes'({ bytes }) {
    return { hash: await sha256Hex(bytes), gz: await gzip(bytes) }
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
