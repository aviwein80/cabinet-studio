/**
 * 3D toolpaths for the part designer, calculated in the compute worker. A toolpath is recalculated
 * only when its inputs change (the same hash that marks an operation stale); a newer request
 * cancels an older one for the same operation.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { opInputHash } from '@/cam/doc'
import type { Mesh } from '@/cam/mesh/types'
import { feedsFor, resolveTool } from '@/cam/ops'
import { OPS_3D, type Toolpath } from '@/cam/toolpath'
import type { CamOp, CamPart } from '@/cam/types'
import { compute } from '@/cam/worker/client'
import { Cancelled } from '@/core/cancel'
import type { MachineProfile } from '@/core/types'
import { loadModelMesh } from './modelData'

export interface Busy {
  fraction: number
  note?: string
}

const keyOf = (op: CamOp, part: CamPart, machine: MachineProfile) => opInputHash(op, part, resolveTool(op, machine), machine)

export function use3dToolpaths(part: CamPart, machine: MachineProfile) {
  const [done, setDone] = useState<Map<string, { key: string; tp: Toolpath }>>(new Map())
  const [busy, setBusy] = useState<Map<string, Busy>>(new Map())
  const running = useRef(new Map<string, { key: string; abort: AbortController }>())

  useEffect(() => {
    const ops = part.ops.filter((o) => o.enabled && OPS_3D.has(o.kind))
    const live = new Set(ops.map((o) => o.id))
    for (const [id, r] of running.current)
      if (!live.has(id)) {
        r.abort.abort()
        running.current.delete(id)
      }
    for (const op of ops) {
      const key = keyOf(op, part, machine)
      if (done.get(op.id)?.key === key || running.current.get(op.id)?.key === key) continue
      running.current.get(op.id)?.abort.abort()
      const abort = new AbortController()
      running.current.set(op.id, { key, abort })
      setBusy((b) => new Map(b).set(op.id, { fraction: 0, note: 'Loading the model' }))
      void (async () => {
        try {
          const meshes: Record<string, Mesh> = {}
          for (const m of part.models ?? []) if (op.kind === 'finish3d' && m.id === op.surface.modelId) meshes[m.blob] = await loadModelMesh(m.blob)
          const [tp] = await compute().run('cam.generate', { part, machine, opIds: [op.id], meshes }, { signal: abort.signal, onProgress: (fraction, note) => setBusy((b) => new Map(b).set(op.id, { fraction, note })) })
          if (running.current.get(op.id)?.abort !== abort) return
          setDone((d) => new Map(d).set(op.id, { key, tp }))
        } catch (e) {
          if (e instanceof Cancelled || running.current.get(op.id)?.abort !== abort) return
          const tool = resolveTool(op, machine)
          setDone((d) => new Map(d).set(op.id, { key, tp: emptyPath(op, part, machine, tool, `Could not calculate this toolpath: ${e instanceof Error ? e.message : String(e)}`) }))
        } finally {
          if (running.current.get(op.id)?.abort === abort) {
            running.current.delete(op.id)
            setBusy((b) => {
              const n = new Map(b)
              n.delete(op.id)
              return n
            })
          }
        }
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [part, machine])

  useEffect(() => () => running.current.forEach((r) => r.abort.abort()), [])

  /** The current toolpath of a 3D op, or a placeholder while it is being calculated. */
  const pathOf = useCallback(
    (op: CamOp): Toolpath => {
      const d = done.get(op.id)
      if (d && d.key === keyOf(op, part, machine)) return d.tp
      return emptyPath(op, part, machine, resolveTool(op, machine), 'Calculating in the background…')
    },
    [done, part, machine],
  )
  return { pathOf, busy }
}

function emptyPath(op: CamOp, part: CamPart, machine: MachineProfile, tool: Toolpath['tool'], warning: string): Toolpath {
  return { opId: op.id, kind: op.kind, name: op.name, tool, feeds: feedsFor(op, tool, part.materialId, machine), moves: [], intents: [], warnings: [warning], stats: { cut: 0, rapid: 0, minutes: 0 } }
}
