/**
 * Mesh file readers: STL (binary and ASCII), OBJ and 3MF. Our own parsers. Each returns a
 * triangle soup (three corners per facet, in file units) that `buildMesh` welds and repairs.
 * Bad input gives a `MeshReadError` with a plain message, never a crash.
 */
import JSZip from 'jszip'
import { checkCancel, tick, type Work } from '@/core/cancel'
import type { MeshUnits } from './types'

export class MeshReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MeshReadError'
  }
}

export interface TriangleSoup {
  format: 'stl-binary' | 'stl-ascii' | 'obj' | '3mf' | 'mesh'
  /** 9 numbers per facet: x, y, z of each corner. */
  corners: Float32Array
  /** Optional group per facet. */
  groups?: Uint32Array
  groupNames?: string[]
  /** Facets in the file, including bad ones. */
  triangles: number
  /** Facets skipped because a coordinate was not a number or a face had a missing vertex. */
  bad: number
  /** Units stated by the file (3MF only; micron files are converted to mm while reading). */
  units?: MeshUnits
  warnings: string[]
}

export type MeshFormat = 'stl' | 'obj' | '3mf'

export function formatOf(name: string): MeshFormat | null {
  const ext = name.toLowerCase().split('.').pop()
  return ext === 'stl' ? 'stl' : ext === 'obj' ? 'obj' : ext === '3mf' ? '3mf' : null
}

export async function readMeshFile(bytes: Uint8Array, name: string, work?: Work): Promise<TriangleSoup> {
  const f = formatOf(name)
  if (!bytes.length) throw new MeshReadError(`${name} is empty.`)
  if (f === 'stl') return parseStl(bytes, work)
  if (f === 'obj') return parseObj(new TextDecoder('utf-8').decode(bytes), work)
  if (f === '3mf') return parse3mf(bytes, work)
  throw new MeshReadError(`${name}: only STL, OBJ and 3MF models can be imported.`)
}

// ---------------------------------------------------------------------------------------------
// STL
// ---------------------------------------------------------------------------------------------

function looksAscii(bytes: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 2048))).trimStart().toLowerCase()
  return head.startsWith('solid') && /facet|endsolid/.test(head)
}

export function parseStl(bytes: Uint8Array, work?: Work): TriangleSoup {
  if (bytes.length >= 84) {
    const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true)
    const need = 84 + 50 * n
    // Some binary files start with "solid" in their header, so the size test comes first.
    if (need === bytes.length || (need < bytes.length && !looksAscii(bytes))) return parseStlBinary(bytes, n, work)
    if (!looksAscii(bytes)) {
      if (need > bytes.length) throw new MeshReadError(`STL file is cut short: its header lists ${n.toLocaleString('en')} facets but the file has room for ${Math.max(0, Math.floor((bytes.length - 84) / 50)).toLocaleString('en')}.`)
      throw new MeshReadError('Not an STL file (neither binary nor text STL).')
    }
  } else if (!looksAscii(bytes)) throw new MeshReadError('Not an STL file: too short for a binary STL and not text STL.')
  return parseStlAscii(new TextDecoder('latin1').decode(bytes), work)
}

function parseStlBinary(bytes: Uint8Array, n: number, work?: Work): TriangleSoup {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const corners = new Float32Array(n * 9)
  let kept = 0
  let bad = 0
  for (let t = 0; t < n; t++) {
    tick(work, t, n, 65536, 0, 1, 'Reading STL')
    const o = 84 + t * 50 + 12
    let ok = true
    for (let k = 0; k < 9; k++) {
      const v = dv.getFloat32(o + k * 4, true)
      if (!Number.isFinite(v)) ok = false
      corners[kept * 9 + k] = v
    }
    if (ok) kept++
    else bad++
  }
  return { format: 'stl-binary', corners: kept === n ? corners : corners.slice(0, kept * 9), triangles: n, bad, warnings: [] }
}

function parseStlAscii(text: string, work?: Work): TriangleSoup {
  const out: number[] = []
  const groups: number[] = []
  const names: string[] = []
  let triangles = 0
  let bad = 0
  let inFacet = false
  let vs: number[] = []
  let group = -1
  const len = text.length
  let pos = 0
  let line = 0
  while (pos < len) {
    let end = text.indexOf('\n', pos)
    if (end < 0) end = len
    const raw = text.slice(pos, end).trim()
    pos = end + 1
    if ((++line & 65535) === 0) {
      checkCancel(work?.isCancelled)
      work?.progress?.(pos / len, 'Reading STL')
    }
    if (!raw) continue
    const sp = raw.indexOf(' ')
    const word = (sp < 0 ? raw : raw.slice(0, sp)).toLowerCase()
    if (word === 'vertex') {
      const parts = raw.slice(sp + 1).trim().split(/\s+/)
      vs.push(Number(parts[0]), Number(parts[1]), Number(parts[2]))
      if (parts.length < 3) vs.push(NaN)
    } else if (word === 'facet') {
      inFacet = true
      vs = []
    } else if (word === 'endfacet') {
      if (!inFacet) continue
      inFacet = false
      triangles++
      if (vs.length !== 9 || vs.some((v) => !Number.isFinite(v))) {
        bad++
        continue
      }
      out.push(...vs)
      groups.push(Math.max(0, group))
    } else if (word === 'solid') {
      names.push(sp < 0 ? `Solid ${names.length + 1}` : raw.slice(sp + 1).trim() || `Solid ${names.length + 1}`)
      group = names.length - 1
    }
  }
  if (!triangles) throw new MeshReadError('Text STL file has no facets.')
  const many = names.length > 1
  return { format: 'stl-ascii', corners: Float32Array.from(out), triangles, bad, ...(many ? { groups: Uint32Array.from(groups), groupNames: names } : {}), warnings: [] }
}

// ---------------------------------------------------------------------------------------------
// OBJ
// ---------------------------------------------------------------------------------------------

export function parseObj(text: string, work?: Work): TriangleSoup {
  const v: number[] = []
  const out: number[] = []
  const groups: number[] = []
  const names: string[] = []
  let group = -1
  let triangles = 0
  let bad = 0
  const len = text.length
  let pos = 0
  let line = 0
  while (pos < len) {
    let end = text.indexOf('\n', pos)
    if (end < 0) end = len
    const raw = text.slice(pos, end).trim()
    pos = end + 1
    if ((++line & 65535) === 0) {
      checkCancel(work?.isCancelled)
      work?.progress?.(pos / len, 'Reading OBJ')
    }
    if (!raw || raw[0] === '#') continue
    const parts = raw.split(/\s+/)
    const w = parts[0]
    if (w === 'v') v.push(Number(parts[1]), Number(parts[2]), Number(parts[3]))
    else if (w === 'f') {
      const nv = v.length / 3
      const idx = parts.slice(1).map((p) => {
        const i = parseInt(p.split('/')[0], 10)
        return i < 0 ? nv + i : i - 1
      })
      const fans = Math.max(0, idx.length - 2)
      triangles += fans
      if (idx.length < 3) {
        bad++
        continue
      }
      for (let k = 1; k + 1 < idx.length; k++) {
        const tri = [idx[0], idx[k], idx[k + 1]]
        if (tri.some((i) => !(i >= 0 && i < nv))) {
          bad++
          continue
        }
        const c = tri.flatMap((i) => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]])
        if (c.some((x) => !Number.isFinite(x))) {
          bad++
          continue
        }
        out.push(...c)
        groups.push(Math.max(0, group))
      }
    } else if (w === 'g' || w === 'o') {
      const nm = parts.slice(1).join(' ') || `Group ${names.length + 1}`
      const at = names.indexOf(nm)
      group = at >= 0 ? at : names.push(nm) - 1
    }
  }
  if (!triangles) throw new MeshReadError('OBJ file has no faces.')
  const many = names.length > 1
  return { format: 'obj', corners: Float32Array.from(out), triangles, bad, ...(many ? { groups: Uint32Array.from(groups), groupNames: names } : {}), warnings: [] }
}

// ---------------------------------------------------------------------------------------------
// 3MF (zip with an XML model; parsed with regular expressions so it also runs in a worker)
// ---------------------------------------------------------------------------------------------

const UNITS_3MF: Record<string, { units: MeshUnits; scale: number }> = {
  micron: { units: 'mm', scale: 0.001 },
  millimeter: { units: 'mm', scale: 1 },
  centimeter: { units: 'cm', scale: 1 },
  inch: { units: 'in', scale: 1 },
  foot: { units: 'ft', scale: 1 },
  meter: { units: 'm', scale: 1 },
}

type M34 = number[]
const IDENT: M34 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(tag)?.[1]
const matOf = (s: string | undefined): M34 => {
  const n = (s ?? '').trim().split(/\s+/).map(Number)
  return n.length === 12 && n.every(Number.isFinite) ? n : IDENT
}
/** 3MF row-vector transform: [x y z 1] * M, M given as m00 m01 m02 m10 ... m32. */
const apply = (m: M34, x: number, y: number, z: number): [number, number, number] => [
  x * m[0] + y * m[3] + z * m[6] + m[9],
  x * m[1] + y * m[4] + z * m[7] + m[10],
  x * m[2] + y * m[5] + z * m[8] + m[11],
]
/** a then b. */
const compose = (a: M34, b: M34): M34 => {
  const r: M34 = new Array(12).fill(0)
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 3; j++) {
      const ai = i < 3 ? [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]] : [a[9], a[10], a[11]]
      r[i * 3 + j] = ai[0] * b[j] + ai[1] * b[3 + j] + ai[2] * b[6 + j] + (i === 3 ? b[9 + j] : 0)
    }
  return r
}

export async function parse3mf(bytes: Uint8Array, work?: Work): Promise<TriangleSoup> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    throw new MeshReadError('Not a 3MF file (it is not a valid zip package).')
  }
  checkCancel(work?.isCancelled)
  const rels = await zip.file('_rels/.rels')?.async('string')
  const target = rels ? /Target="\/?([^"]+\.model)"/i.exec(rels)?.[1] : undefined
  const file = (target && zip.file(target)) || zip.file(/\.model$/i)[0]
  if (!file) throw new MeshReadError('3MF package has no 3D model part.')
  const xml = await file.async('string')
  const unitName = attr(/<model\b[^>]*>/i.exec(xml)?.[0] ?? '', 'unit') ?? 'millimeter'
  const unit = UNITS_3MF[unitName] ?? UNITS_3MF.millimeter
  const warnings: string[] = []
  if (!UNITS_3MF[unitName]) warnings.push(`Unknown 3MF unit "${unitName}"; read as millimetres.`)

  const objects = new Map<string, { verts: number[]; tris: number[]; components: { id: string; m: M34 }[]; name: string }>()
  const objRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/gi
  for (let m = objRe.exec(xml); m; m = objRe.exec(xml)) {
    const head = m[1]
    const body = m[2]
    const id = attr(head, 'id') ?? ''
    const verts: number[] = []
    const tris: number[] = []
    const vRe = /<vertex\b([^>]*)\/?>/gi
    for (let v = vRe.exec(body); v; v = vRe.exec(body)) verts.push(Number(attr(v[1], 'x')), Number(attr(v[1], 'y')), Number(attr(v[1], 'z')))
    const tRe = /<triangle\b([^>]*)\/?>/gi
    for (let t = tRe.exec(body); t; t = tRe.exec(body)) tris.push(Number(attr(t[1], 'v1')), Number(attr(t[1], 'v2')), Number(attr(t[1], 'v3')))
    const components: { id: string; m: M34 }[] = []
    const cRe = /<component\b([^>]*)\/?>/gi
    for (let c = cRe.exec(body); c; c = cRe.exec(body)) components.push({ id: attr(c[1], 'objectid') ?? '', m: matOf(attr(c[1], 'transform')) })
    objects.set(id, { verts, tris, components, name: attr(head, 'name') ?? `Object ${id}` })
  }
  const items: { id: string; m: M34 }[] = []
  const build = /<build\b[^>]*>([\s\S]*?)<\/build>/i.exec(xml)?.[1] ?? ''
  const iRe = /<item\b([^>]*)\/?>/gi
  for (let it = iRe.exec(build); it; it = iRe.exec(build)) items.push({ id: attr(it[1], 'objectid') ?? '', m: matOf(attr(it[1], 'transform')) })
  if (!items.length) for (const id of objects.keys()) items.push({ id, m: IDENT })

  const out: number[] = []
  const groups: number[] = []
  const names: string[] = []
  let triangles = 0
  let bad = 0
  const emit = (id: string, m: M34, depth: number) => {
    const o = objects.get(id)
    if (!o) {
      warnings.push(`3MF build refers to missing object ${id}.`)
      return
    }
    if (depth > 16) throw new MeshReadError('3MF components nest too deeply (loop?).')
    for (const c of o.components) emit(c.id, compose(c.m, m), depth + 1)
    if (!o.tris.length) return
    const g = names.push(o.name) - 1
    const nv = o.verts.length / 3
    for (let t = 0; t < o.tris.length; t += 3) {
      triangles++
      const c: number[] = []
      for (let k = 0; k < 3; k++) {
        const i = o.tris[t + k]
        if (!(i >= 0 && i < nv)) break
        c.push(...apply(m, o.verts[i * 3], o.verts[i * 3 + 1], o.verts[i * 3 + 2]))
      }
      if (c.length !== 9 || c.some((x) => !Number.isFinite(x))) {
        bad++
        continue
      }
      out.push(...c)
      groups.push(g)
    }
  }
  for (const it of items) emit(it.id, it.m, 0)
  if (!triangles) throw new MeshReadError('3MF model has no triangles.')
  const corners = Float32Array.from(out)
  if (unit.scale !== 1) for (let i = 0; i < corners.length; i++) corners[i] *= unit.scale
  return { format: '3mf', corners, triangles, bad, units: unit.units, ...(names.length > 1 ? { groups: Uint32Array.from(groups), groupNames: names } : {}), warnings }
}
