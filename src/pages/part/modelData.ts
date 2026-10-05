/**
 * Loading and saving 3D model data for the part designer. The heavy steps (decompress, hash,
 * decode, encode) run in the compute worker; meshes are cached by hash.
 */
import { nanoid } from 'nanoid'
import { useEffect, useState } from 'react'
import { backend } from '@/app/backend'
import type { Mesh, MeshUnits } from '@/cam/mesh/types'
import type { UpAxis } from '@/cam/types'
import { compute } from '@/cam/worker/client'

const cache = new Map<string, Promise<Mesh>>()

export function loadModelMesh(hash: string): Promise<Mesh> {
  let p = cache.get(hash)
  if (!p) {
    p = (async () => {
      const gz = await backend.blobs.get(hash)
      if (!gz) throw new Error('The data for this 3D model is missing from this computer (data/blobs). Import the model again.')
      return compute().run('blob.unpack', { gz, hash })
    })()
    p.catch(() => cache.delete(hash))
    cache.set(hash, p)
    if (cache.size > 6) cache.delete(cache.keys().next().value!)
  }
  return p
}

/** Store a mesh outside the shop file; returns its hash. */
export async function saveModelMesh(mesh: Mesh): Promise<string> {
  const { hash, gz } = await compute().run('blob.pack', { mesh })
  if (!(await backend.blobs.has(hash))) await backend.blobs.put(hash, gz)
  cache.set(hash, Promise.resolve(mesh))
  return hash
}

export function useModelMesh(hash: string | undefined): { mesh: Mesh | null; error: string | null } {
  const [state, setState] = useState<{ hash?: string; mesh: Mesh | null; error: string | null }>({ mesh: null, error: null })
  useEffect(() => {
    if (!hash) return
    let live = true
    loadModelMesh(hash).then(
      (mesh) => live && setState({ hash, mesh, error: null }),
      (e: unknown) => live && setState({ hash, mesh: null, error: e instanceof Error ? e.message : String(e) }),
    )
    return () => {
      live = false
    }
  }, [hash])
  return state.hash === hash ? { mesh: state.mesh, error: state.error } : { mesh: null, error: null }
}

export const UNIT_OPTIONS: { value: MeshUnits; label: string }[] = [
  { value: 'mm', label: 'Millimetres' },
  { value: 'in', label: 'Inches' },
  { value: 'cm', label: 'Centimetres' },
  { value: 'm', label: 'Metres' },
]
export const UP_OPTIONS: { value: UpAxis; label: string }[] = [
  { value: '+z', label: '+Z up' },
  { value: '-z', label: '−Z up (upside down)' },
  { value: '+y', label: '+Y up' },
  { value: '-y', label: '−Y up' },
  { value: '+x', label: '+X up' },
  { value: '-x', label: '−X up' },
]
export const MODEL_LAYER = { id: 'models', name: '3D models', color: '#c084fc', visible: true, locked: false }

/**
 * Add a surface made in the app (a mesh in part coordinates) to the part as a 3D model: stored like
 * an imported mesh, placed where it was made.
 */
export async function addSurfaceModel(part: import('@/cam/types').CamPart, mesh: Mesh, name: string, source: string): Promise<import('@/cam/types').CamPart> {
  if (!mesh.indices.length) throw new Error('The surface came out empty.')
  const hash = await saveModelMesh(mesh)
  const p = mesh.positions
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[i + k])
      hi[k] = Math.max(hi[k], p[i + k])
    }
  const r3 = (n: number) => Math.round(n * 1000) / 1000
  const model: import('@/cam/types').ModelRef = {
    id: nanoid(8),
    name,
    kind: 'mesh',
    blob: hash,
    source,
    units: 'mm',
    // placed exactly where it was made (no rounding of the position)
    place: { up: '+z', rotZ: 0, scale: 1, mirror: false, at: [lo[0], lo[1], hi[2]] },
    layer: MODEL_LAYER.id,
    visible: true,
    triangles: mesh.indices.length / 3,
    size: [r3(hi[0] - lo[0]), r3(hi[1] - lo[1]), r3(hi[2] - lo[2])],
  }
  return { ...part, layers: part.layers.some((l) => l.id === MODEL_LAYER.id) ? part.layers : [...part.layers, { ...MODEL_LAYER }], models: [...(part.models ?? []), model] }
}
