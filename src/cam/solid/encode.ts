/**
 * Stored form of a solid (a blob in the model store, like meshes): little-endian
 * "CSS1", JSON length (u32), JSON (UTF-8: format, schema, units, products, warnings, and per body
 * its name, path, colour, counts and faces), then per body: positions (f64), normals (f32),
 * indices (u32). Positions stay float64 so hole sizes and depths keep their exact values.
 *
 * `solidMesh` gives the same model as an ordinary mesh (float32, one facet group per face) for
 * the 3D strategies, the simulator and the 3D view.
 */
import type { Mesh } from '../mesh/types'
import type { SolidBody, SolidData, SolidFace } from './types'

export const SOLID_MAGIC = 0x31535343 // "CSS1"

interface Head {
  format: SolidData['format']
  schema?: string
  units: string
  products: SolidData['products']
  warnings: string[]
  bodies: { index: number; name: string; path: string[]; color?: string; nv: number; nt: number; faces: SolidFace[] }[]
}

export function isSolidBlob(buf: Uint8Array): boolean {
  return buf.length >= 8 && new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0, true) === SOLID_MAGIC
}

export function encodeSolid(s: SolidData): Uint8Array {
  const head: Head = {
    format: s.format,
    ...(s.schema ? { schema: s.schema } : {}),
    units: s.units,
    products: s.products,
    warnings: s.warnings,
    bodies: s.bodies.map((b) => ({ index: b.index, name: b.name, path: b.path, ...(b.color ? { color: b.color } : {}), nv: b.positions.length / 3, nt: b.indices.length / 3, faces: b.faces })),
  }
  const json = new TextEncoder().encode(JSON.stringify(head))
  const pad = (4 - ((8 + json.length) % 4)) % 4
  let size = 8 + json.length + pad
  for (const b of s.bodies) size += b.positions.length * 8 + b.normals.length * 4 + b.indices.length * 4
  const buf = new Uint8Array(size)
  const dv = new DataView(buf.buffer)
  dv.setUint32(0, SOLID_MAGIC, true)
  dv.setUint32(4, json.length, true)
  buf.set(json, 8)
  let o = 8 + json.length + pad
  for (const b of s.bodies) {
    for (let i = 0; i < b.positions.length; i++, o += 8) dv.setFloat64(o, b.positions[i], true)
    for (let i = 0; i < b.normals.length; i++, o += 4) dv.setFloat32(o, b.normals[i], true)
    for (let i = 0; i < b.indices.length; i++, o += 4) dv.setUint32(o, b.indices[i], true)
  }
  return buf
}

export function decodeSolid(buf: Uint8Array): SolidData {
  if (!isSolidBlob(buf)) throw new Error('Stored model data is not a Cabinet Studio solid.')
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const jl = dv.getUint32(4, true)
  if (8 + jl > buf.length) throw new Error('Stored solid data is cut short.')
  const head = JSON.parse(new TextDecoder().decode(buf.subarray(8, 8 + jl))) as Head
  let o = 8 + jl + ((4 - ((8 + jl) % 4)) % 4)
  const bodies: SolidBody[] = head.bodies.map((h) => {
    const need = h.nv * 3 * 8 + h.nv * 3 * 4 + h.nt * 3 * 4
    if (o + need > buf.length) throw new Error('Stored solid data is cut short.')
    const positions = new Float64Array(h.nv * 3)
    const normals = new Float32Array(h.nv * 3)
    const indices = new Uint32Array(h.nt * 3)
    for (let i = 0; i < positions.length; i++, o += 8) positions[i] = dv.getFloat64(o, true)
    for (let i = 0; i < normals.length; i++, o += 4) normals[i] = dv.getFloat32(o, true)
    for (let i = 0; i < indices.length; i++, o += 4) {
      indices[i] = dv.getUint32(o, true)
      if (indices[i] >= h.nv) throw new Error('Stored solid data refers to a missing vertex.')
    }
    return { index: h.index, name: h.name, path: h.path, ...(h.color ? { color: h.color } : {}), positions, normals, indices, faces: h.faces }
  })
  return { format: head.format, ...(head.schema ? { schema: head.schema } : {}), units: head.units, products: head.products, warnings: head.warnings, bodies }
}

/** Short description of a face for lists and facet-group names. */
export function faceLabel(f: SolidFace): string {
  const s = f.surface
  switch (s.kind) {
    case 'plane':
      return `Face ${f.id} · flat`
    case 'cylinder':
      return `Face ${f.id} · ${s.concave ? 'hole' : 'round'} Ø${round3((s.r ?? 0) * 2)}`
    case 'cone':
      return `Face ${f.id} · cone ${round3(((s.angle ?? 0) * 360) / Math.PI)}°`
    case 'sphere':
      return `Face ${f.id} · sphere R${round3(s.r ?? 0)}`
    default:
      return `Face ${f.id} · free-form`
  }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

/**
 * The solid as a mesh: all bodies (or the given ones) in one, float32, facet group = face id
 * (group names hold every id up to the largest, so `groups[t]` indexes `groupNames`).
 */
export function solidMesh(s: SolidData, bodies?: number[]): Mesh {
  const use = s.bodies.filter((b) => !bodies || bodies.includes(b.index))
  let nv = 0
  let nt = 0
  let maxFace = 0
  for (const b of use) {
    nv += b.positions.length / 3
    nt += b.indices.length / 3
    for (const f of b.faces) maxFace = Math.max(maxFace, f.id)
  }
  const positions = new Float32Array(nv * 3)
  const indices = new Uint32Array(nt * 3)
  const groups = new Uint32Array(nt)
  const groupNames: string[] = Array.from({ length: maxFace + 1 }, (_, i) => (i === 0 ? 'No face' : `Face ${i}`))
  let vo = 0
  let to = 0
  for (const b of use) {
    positions.set(b.positions, vo * 3)
    for (let i = 0; i < b.indices.length; i++) indices[to * 3 + i] = b.indices[i] + vo
    for (const f of b.faces) {
      groupNames[f.id] = faceLabel(f)
      for (let t = f.first; t <= f.last; t++) groups[to + t] = f.id
    }
    vo += b.positions.length / 3
    to += b.indices.length / 3
  }
  return { positions, indices, groups, groupNames }
}

/** Bounding box of the chosen bodies (all when not given), mm. */
export function solidBounds(s: SolidData, bodies?: number[]): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const b of s.bodies) {
    if (bodies && !bodies.includes(b.index)) continue
    const p = b.positions
    for (let i = 0; i < p.length; i += 3)
      for (let k = 0; k < 3; k++) {
        if (p[i + k] < min[k]) min[k] = p[i + k]
        if (p[i + k] > max[k]) max[k] = p[i + k]
      }
  }
  return { min, max }
}
