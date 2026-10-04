/**
 * Large binary data (3D meshes now; solids and height maps later) lives outside the shop file, in
 * a content-addressed blob store: each blob is gzip-compressed and named by the SHA-256 of its
 * uncompressed bytes. Blobs never change, so shop-file backups always point at valid data.
 *
 * Stores: the desktop app keeps blobs as files in `data/blobs/` next to `cabinet-studio.json`;
 * the browser preview keeps them in IndexedDB; tests use memory.
 */
import type { Mesh } from '../mesh/types'

export interface BlobStore {
  has(hash: string): Promise<boolean>
  /** Store gzip-compressed bytes under the hash of their uncompressed content. */
  put(hash: string, gz: Uint8Array): Promise<void>
  /** The gzip-compressed bytes, or null when missing. */
  get(hash: string): Promise<Uint8Array | null>
}

export const isBlobHash = (h: string) => /^[0-9a-f]{64}$/.test(h)

export class MemoryBlobStore implements BlobStore {
  readonly blobs = new Map<string, Uint8Array>()
  async has(h: string) {
    return this.blobs.has(h)
  }
  async put(h: string, gz: Uint8Array) {
    this.blobs.set(h, gz.slice())
  }
  async get(h: string) {
    return this.blobs.get(h)?.slice() ?? null
  }
}

// ---------------------------------------------------------------------------------------------
// Bytes: hash, gzip, base64
// ---------------------------------------------------------------------------------------------

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream))
  return new Uint8Array(await out.arrayBuffer())
}
export const gzip = (b: Uint8Array) => pipe(b, new CompressionStream('gzip'))
export const gunzip = (b: Uint8Array) => pipe(b, new DecompressionStream('gzip'))

export function toBase64(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}
export function fromBase64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ---------------------------------------------------------------------------------------------
// Mesh encoding (little-endian): "CSM1", vertex count, facet count, flags, positions (f32),
// indices (u32), [groups (u32), group-name JSON length (u32), JSON (UTF-8)]
// ---------------------------------------------------------------------------------------------

const MAGIC = 0x314d5343 // "CSM1"

export function encodeMesh(m: Mesh): Uint8Array {
  const nv = m.positions.length / 3
  const nt = m.indices.length / 3
  const names = m.groups ? new TextEncoder().encode(JSON.stringify(m.groupNames ?? [])) : new Uint8Array(0)
  const size = 16 + nv * 12 + nt * 12 + (m.groups ? nt * 4 + 4 + names.length : 0)
  const buf = new Uint8Array(size)
  const dv = new DataView(buf.buffer)
  dv.setUint32(0, MAGIC, true)
  dv.setUint32(4, nv, true)
  dv.setUint32(8, nt, true)
  dv.setUint32(12, m.groups ? 1 : 0, true)
  let o = 16
  for (let i = 0; i < m.positions.length; i++, o += 4) dv.setFloat32(o, m.positions[i], true)
  for (let i = 0; i < m.indices.length; i++, o += 4) dv.setUint32(o, m.indices[i], true)
  if (m.groups) {
    for (let i = 0; i < nt; i++, o += 4) dv.setUint32(o, m.groups[i], true)
    dv.setUint32(o, names.length, true)
    buf.set(names, o + 4)
  }
  return buf
}

export function decodeMesh(buf: Uint8Array): Mesh {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (buf.length < 16 || dv.getUint32(0, true) !== MAGIC) throw new Error('Stored model data is not a Cabinet Studio mesh.')
  const nv = dv.getUint32(4, true)
  const nt = dv.getUint32(8, true)
  const grouped = dv.getUint32(12, true) & 1
  const need = 16 + nv * 12 + nt * 12 + (grouped ? nt * 4 + 4 : 0)
  if (buf.length < need) throw new Error('Stored model data is cut short.')
  const positions = new Float32Array(nv * 3)
  const indices = new Uint32Array(nt * 3)
  let o = 16
  for (let i = 0; i < positions.length; i++, o += 4) positions[i] = dv.getFloat32(o, true)
  for (let i = 0; i < indices.length; i++, o += 4) {
    indices[i] = dv.getUint32(o, true)
    if (indices[i] >= nv) throw new Error('Stored model data refers to a missing vertex.')
  }
  if (!grouped) return { positions, indices }
  const groups = new Uint32Array(nt)
  for (let i = 0; i < nt; i++, o += 4) groups[i] = dv.getUint32(o, true)
  const len = dv.getUint32(o, true)
  const groupNames = JSON.parse(new TextDecoder().decode(buf.subarray(o + 4, o + 4 + len))) as string[]
  return { positions, indices, groups, groupNames }
}

// ---------------------------------------------------------------------------------------------
// Mesh <-> store
// ---------------------------------------------------------------------------------------------

/** Store a mesh; returns its hash (stored once however often it is saved). */
export async function putMesh(store: BlobStore, m: Mesh): Promise<string> {
  const raw = encodeMesh(m)
  const hash = await sha256Hex(raw)
  if (!(await store.has(hash))) await store.put(hash, await gzip(raw))
  return hash
}

const cache = new Map<string, Mesh>()
const CACHE_MAX = 6

/** Load a mesh by hash. The bytes are checked against the hash, so damaged files are reported. */
export async function getMesh(store: BlobStore, hash: string): Promise<Mesh> {
  const hit = cache.get(hash)
  if (hit) return hit
  const gz = await store.get(hash)
  if (!gz) throw new Error(`3D model data ${hash.slice(0, 12)}… is missing from the model store.`)
  const raw = await gunzip(gz)
  if ((await sha256Hex(raw)) !== hash) throw new Error(`3D model data ${hash.slice(0, 12)}… is damaged (checksum mismatch).`)
  const m = decodeMesh(raw)
  cache.set(hash, m)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
  return m
}

// ---------------------------------------------------------------------------------------------
// Part files carry their blobs so one .csp.json stays portable
// ---------------------------------------------------------------------------------------------

/** Hashes a part (or any JSON-able data holding parts) refers to. */
export function blobRefs(part: { models?: { blob: string; original?: string }[] }): string[] {
  const out = new Set<string>()
  for (const m of part.models ?? []) {
    out.add(m.blob)
    if (m.original) out.add(m.original)
  }
  return [...out].filter(isBlobHash).sort()
}

/** Gzip + base64 copies of the part's blobs, for writing into a part file. */
export async function exportBlobs(part: { models?: { blob: string; original?: string }[] }, store: BlobStore): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const h of blobRefs(part)) {
    const gz = await store.get(h)
    if (gz) out[h] = toBase64(gz)
  }
  return out
}

/** Put blobs from a part file into the store, checking each one against its hash. */
export async function importBlobs(blobs: Record<string, string> | undefined, store: BlobStore): Promise<string[]> {
  const bad: string[] = []
  for (const [h, b64] of Object.entries(blobs ?? {})) {
    if (!isBlobHash(h)) continue
    const gz = fromBase64(b64)
    try {
      if ((await sha256Hex(await gunzip(gz))) !== h) throw new Error()
      if (!(await store.has(h))) await store.put(h, gz)
    } catch {
      bad.push(h)
    }
  }
  return bad
}
