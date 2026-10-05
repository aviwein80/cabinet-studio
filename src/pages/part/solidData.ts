/**
 * Solid models in the part designer: reading files in the solid worker (the OpenCascade reader is
 * loaded there on first use), storing them next to the shop file, and loading them back by hash.
 */
import { useEffect, useState } from 'react'
import { backend } from '@/app/backend'
import type { SolidData } from '@/cam/solid/types'
import { compute, solidCompute } from '@/cam/worker/client'

const cache = new Map<string, Promise<SolidData>>()

export function loadModelSolid(hash: string): Promise<SolidData> {
  let p = cache.get(hash)
  if (!p) {
    p = (async () => {
      const gz = await backend.blobs.get(hash)
      if (!gz) throw new Error('The data for this solid model is missing from this computer (data/blobs). Import the file again.')
      return compute().run('blob.unpackSolid', { gz, hash })
    })()
    p.catch(() => cache.delete(hash))
    cache.set(hash, p)
    if (cache.size > 6) cache.delete(cache.keys().next().value!)
  }
  return p
}

/** Store a solid and the file it came from; returns both hashes. */
export async function saveSolid(solid: SolidData, file: Uint8Array): Promise<{ blob: string; file: string }> {
  const a = await solidCompute().run('solid.pack', { solid })
  const b = await solidCompute().run('blob.packBytes', { bytes: file })
  for (const x of [a, b]) if (!(await backend.blobs.has(x.hash))) await backend.blobs.put(x.hash, x.gz)
  cache.set(a.hash, Promise.resolve(solid))
  return { blob: a.hash, file: b.hash }
}

export function useModelSolid(hash: string | undefined, enabled = true): { solid: SolidData | null; error: string | null } {
  const [state, setState] = useState<{ hash?: string; solid: SolidData | null; error: string | null }>({ solid: null, error: null })
  useEffect(() => {
    if (!hash || !enabled) return
    let live = true
    loadModelSolid(hash).then(
      (solid) => live && setState({ hash, solid, error: null }),
      (e: unknown) => live && setState({ hash, solid: null, error: e instanceof Error ? e.message : String(e) }),
    )
    return () => {
      live = false
    }
  }, [hash, enabled])
  return state.hash === hash ? { solid: state.solid, error: state.error } : { solid: null, error: null }
}

/** Colour of each face: set in the app, else from the file (face, then body), else none. */
export function faceColorMap(solid: SolidData, overrides?: Record<string, string>): Map<number, string> {
  const out = new Map<number, string>()
  for (const b of solid.bodies) for (const f of b.faces) {
    const c = overrides?.[String(f.id)] ?? f.color ?? b.color
    if (c) out.set(f.id, c)
  }
  return out
}
