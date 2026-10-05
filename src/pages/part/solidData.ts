/**
 * Solid models in the part designer: reading files in the solid worker (the OpenCascade reader is
 * loaded there on first use), storing them next to the shop file, and loading them back by hash.
 */
import { useEffect, useState } from 'react'
import { backend } from '@/app/backend'
import type { SolidData } from '@/cam/solid/types'
import { compute } from '@/cam/worker/client'
import type { MachineProfile } from '@/core/types'

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

/** Store a solid; returns its hash. */
export async function saveSolidData(solid: SolidData): Promise<string> {
  const a = await compute().run('solid.pack', { solid })
  if (!(await backend.blobs.has(a.hash))) await backend.blobs.put(a.hash, a.gz)
  cache.set(a.hash, Promise.resolve(solid))
  return a.hash
}

/** Store the file a solid came from; returns its hash. */
export async function saveSolidFile(bytes: Uint8Array): Promise<string> {
  const b = await compute().run('blob.packBytes', { bytes: bytes.slice() })
  if (!(await backend.blobs.has(b.hash))) await backend.blobs.put(b.hash, b.gz)
  return b.hash
}

/** Store a solid and the file it came from; returns both hashes. */
export async function saveSolid(solid: SolidData, file: Uint8Array): Promise<{ blob: string; file: string }> {
  return { blob: await saveSolidData(solid), file: await saveSolidFile(file) }
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

/** Drill sizes in the tool table, for recognition (vertical for faces 1 and 6, horizontal for edges). */
export function drillSizes(machine: MachineProfile | undefined) {
  const tools = machine?.tools ?? []
  return { drills: tools.filter((t) => t.type === 'drill-vertical').map((t) => t.diameter), edgeDrills: tools.filter((t) => t.type === 'drill-horizontal').map((t) => t.diameter) }
}
