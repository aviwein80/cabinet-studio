import { useEffect, useMemo, useState } from 'react'
import type { Mesh } from '@/cam/mesh/types'
import { isFlatLayer, pathKey, type Toolpath } from '@/cam/toolpath'
import { compute } from '@/cam/worker/client'
import { Cancelled } from '@/core/cancel'
import { featuresOf } from '@/core/features'
import { runJob, type JobOutput } from '@/core/pipeline'
import type { AppData, Job } from '@/core/types'
import { loadModelMesh } from '@/pages/part/modelData'

/** 3D toolpaths already calculated for job output, by `pathKey` (kept while the app runs). */
const done3d = new Map<string, Toolpath>()

/**
 * The flat-layer 3D toolpaths a job's MPR output needs (only when 3D output is switched on),
 * calculated in the compute worker so the screen stays responsive. Returns the toolpaths found so
 * far and how many are still being calculated.
 */
function useJob3dPaths(job: Job | undefined, data: AppData | null) {
  const [version, setVersion] = useState(0)
  const want = useMemo(() => {
    if (!job || !data) return []
    const f = featuresOf(data.settings)
    if (!f.camMprOutput || !f.cam3dMprOutput) return []
    return (job.camParts ?? []).flatMap((part) => part.ops.filter((op) => op.enabled && isFlatLayer(op)).map((op) => ({ part, op, key: pathKey(op, part, data.machine) })))
  }, [job, data])
  const missing = want.filter((w) => !done3d.has(w.key))

  useEffect(() => {
    if (!data || !missing.length) return
    const abort = new AbortController()
    void (async () => {
      for (const { part, op, key } of missing) {
        if (abort.signal.aborted) return
        try {
          const meshes: Record<string, Mesh> = {}
          const model = 'surface' in op ? part.models?.find((m) => m.id === op.surface.modelId) : undefined
          if (model) meshes[model.blob] = await loadModelMesh(model.blob)
          const [tp] = await compute().run('cam.generate', { part, machine: data.machine, opIds: [op.id], meshes }, { signal: abort.signal })
          done3d.set(key, tp)
          if (done3d.size > 64) done3d.delete(done3d.keys().next().value!)
          setVersion((v) => v + 1)
        } catch (e) {
          if (e instanceof Cancelled || abort.signal.aborted) return
          // leave it missing: the export checker reports it
          console.error(e)
        }
      }
    })()
    return () => abort.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want])

  const paths = useMemo(() => {
    const m = new Map<string, Toolpath>()
    for (const w of want) {
      const tp = done3d.get(w.key)
      if (tp) m.set(w.key, tp)
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want, version])
  return { paths, pending: want.length - paths.size }
}

export function useJobOutput(job: Job | undefined, data: AppData | null): { out: JobOutput | null; error: string | null; pending3d: number } {
  const { paths, pending } = useJob3dPaths(job, data)
  const res = useMemo(() => {
    if (!job || !data) return { out: null, error: null }
    try {
      return { out: runJob(job, data, paths.size ? { paths3d: paths } : {}), error: null }
    } catch (e) {
      console.error(e)
      return { out: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [job, data, paths])
  return { ...res, pending3d: pending }
}

export { bomCsv, buildFiles, type ExportKind } from '@/core/output'
