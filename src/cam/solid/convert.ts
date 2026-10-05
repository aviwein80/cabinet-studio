/**
 * Reading a solid file: the OpenCascade reader turns STEP / IGES / BREP into faces of triangles;
 * this keeps every face (id, colour), classifies its surface, and adds the names, properties,
 * schema and unit read from the file itself.
 */
import type { Work } from '@/core/cancel'
import { Cancelled } from '@/core/cancel'
import { UNIT_MM, type MeshUnits } from '../mesh/types'
import { facePoints, fitSurface } from './classify'
import { type OcctModule, type OcctNode, type OcctParams, type OcctResult } from './occt'
import { readIgesMeta, readStepMeta } from './step21'
import type { SolidBody, SolidData, SolidFace, SolidFormat, SolidProduct } from './types'

export class SolidReadError extends Error {}

export function solidFormatOf(name: string): SolidFormat | null {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'step' || ext === 'stp' || ext === 'p21') return 'step'
  if (ext === 'iges' || ext === 'igs') return 'iges'
  if (ext === 'brep' || ext === 'brp') return 'brep'
  return null
}

export const isSolidFile = (name: string) => solidFormatOf(name) !== null

export interface SolidReadOptions {
  /** Read the numbers in this unit instead of the one the file states. */
  units?: MeshUnits
  /** Largest gap between the triangles and the true surface, mm (corners are always exact). */
  deflection?: number
  /** Largest angle between neighbouring triangles on curved faces, radians. */
  angle?: number
}

const hex = (c: ArrayLike<number> | null | undefined) =>
  c && c.length >= 3
    ? `#${[0, 1, 2]
        .map((i) =>
          Math.round(Math.max(0, Math.min(1, c[i])) * 255)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')}`
    : undefined

function looksLike(bytes: Uint8Array, format: SolidFormat): boolean {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 2048)))
  if (format === 'step') return /ISO-10303-21/.test(head)
  if (format === 'iges') return head.length >= 80 && /S\s*0*1\s*$/m.test(head.split(/\r?\n/)[0] ?? '')
  return /DBRep_DrawableShape|CASCADE Topology/.test(head)
}

/** Paths (assembly names above) of each mesh in the reader's tree. */
function meshPaths(root: OcctNode): Map<number, { name: string; path: string[] }> {
  const out = new Map<number, { name: string; path: string[] }>()
  const walk = (n: OcctNode, path: string[]) => {
    for (const m of n.meshes) out.set(m, { name: n.name, path })
    for (const c of n.children) walk(c, n.name ? [...path, n.name] : path)
  }
  walk(root, [])
  return out
}

/** Turn the reader's result into bodies with face ids, colours and surface types. */
export function convertResult(res: OcctResult, scale = 1, work?: Work): SolidBody[] {
  const paths = meshPaths(res.root)
  const bodies: SolidBody[] = []
  let nextFace = 1
  res.meshes.forEach((m, index) => {
    if (work?.isCancelled?.()) throw new Cancelled()
    work?.progress?.(0.6 + (0.4 * index) / Math.max(1, res.meshes.length), `Face types: body ${index + 1} of ${res.meshes.length}`)
    const src = m.attributes.position.array
    const positions = new Float64Array(src.length)
    for (let i = 0; i < src.length; i++) positions[i] = src[i] * scale
    const indices = Uint32Array.from(m.index.array)
    const nsrc = m.attributes.normal?.array
    const normals = new Float32Array(src.length)
    if (nsrc && nsrc.length === src.length) normals.set(nsrc)
    else {
      // no normals given: area-weighted triangle normals per vertex
      for (let t = 0; t < indices.length; t += 3) {
        const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]]
        const ux = positions[b * 3] - positions[a * 3]
        const uy = positions[b * 3 + 1] - positions[a * 3 + 1]
        const uz = positions[b * 3 + 2] - positions[a * 3 + 2]
        const vx = positions[c * 3] - positions[a * 3]
        const vy = positions[c * 3 + 1] - positions[a * 3 + 1]
        const vz = positions[c * 3 + 2] - positions[a * 3 + 2]
        const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
        for (const v of [a, b, c]) for (let k = 0; k < 3; k++) normals[v * 3 + k] += n[k]
      }
      for (let v = 0; v < normals.length; v += 3) {
        const l = Math.hypot(normals[v], normals[v + 1], normals[v + 2]) || 1
        normals[v] /= l
        normals[v + 1] /= l
        normals[v + 2] /= l
      }
    }
    const info = paths.get(index)
    const bodyColor = hex(m.color)
    const body: SolidBody = { index, name: m.name ?? info?.name ?? '', path: info?.path.filter(Boolean) ?? [], ...(bodyColor ? { color: bodyColor } : {}), positions, normals, indices, faces: [] }
    const faces: SolidFace[] = []
    for (const f of m.brep_faces) {
      if (f.last < f.first) {
        nextFace++
        continue
      }
      const fp = facePoints(body, f.first, f.last)
      const color = hex(f.color)
      faces.push({ id: nextFace++, first: f.first, last: f.last, ...(color ? { color } : {}), surface: fitSurface(fp), area: fp.area })
    }
    // plain JSON values (no -0), exactly as they are stored
    body.faces = JSON.parse(JSON.stringify(faces)) as SolidFace[]
    bodies.push(body)
  })
  return bodies
}

/**
 * Read a STEP, IGES or BREP file. `reader` is the loaded OpenCascade reader (see `occt.ts`).
 * Corrupt or empty files raise `SolidReadError` with a plain message.
 */
export function readSolid(reader: OcctModule, bytes: Uint8Array, name: string, opt: SolidReadOptions = {}, work?: Work): SolidData {
  const format = solidFormatOf(name)
  if (!format) throw new SolidReadError(`${name}: not a STEP, IGES or BREP file (.step, .stp, .iges, .igs, .brep).`)
  if (!bytes.length) throw new SolidReadError(`${name} is empty.`)
  if (!looksLike(bytes, format)) throw new SolidReadError(`${name} does not look like a ${format.toUpperCase()} file (its first line is wrong). It may be damaged or saved in another format.`)
  const warnings: string[] = []
  let schema: string | undefined
  let fileUnits: MeshUnits | undefined
  let products: SolidProduct[] = []
  if (format === 'step') {
    const meta = readStepMeta(bytes)
    schema = meta.schema
    fileUnits = meta.units
    products = meta.products
  } else if (format === 'iges') {
    const meta = readIgesMeta(bytes)
    schema = meta.schema
    fileUnits = meta.units
  }
  work?.progress?.(0.05, 'Reading the solid')
  const params: OcctParams = { linearUnit: 'millimeter', linearDeflectionType: 'absolute_value', linearDeflection: opt.deflection ?? 0.05, angularDeflection: opt.angle ?? 0.2 }
  let res: OcctResult
  try {
    res = format === 'step' ? reader.ReadStepFile(bytes, params) : format === 'iges' ? reader.ReadIgesFile(bytes, params) : reader.ReadBrepFile(bytes, params)
  } catch (e) {
    throw new SolidReadError(`${name} could not be read: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!res?.success) throw new SolidReadError(`${name} could not be read. The file may be damaged or cut short.`)
  if (!res.meshes.length || res.meshes.every((m) => !m.index.array.length)) throw new SolidReadError(`${name} has no solids or surfaces in it.`)
  work?.progress?.(0.6, 'Face types')
  // the reader gives mm (from the unit in the file; BREP files have none and are taken as mm)
  const stated = fileUnits ?? 'mm'
  const scale = opt.units ? UNIT_MM[opt.units] / UNIT_MM[stated] : 1
  if (opt.units && opt.units !== stated) warnings.push(`Read in ${opt.units} instead of ${stated} as the file says.`)
  if (format === 'brep' && !opt.units) warnings.push('BREP files do not say their unit; read as millimetres.')
  const bodies = convertResult(res, scale, work)
  const others = bodies.reduce((n, b) => n + b.faces.filter((f) => f.surface.kind === 'other').length, 0)
  if (others) warnings.push(`${others} face(s) are free-form (not flat, round or conical); they can be machined in 3D but feature recognition skips them.`)
  return { format, schema, units: opt.units ?? stated, bodies, products, warnings }
}
