import { useMemo } from 'react'
import { runJob, type JobOutput } from '@/core/pipeline'
import type { AppData, Job } from '@/core/types'

export function useJobOutput(job: Job | undefined, data: AppData | null): { out: JobOutput | null; error: string | null } {
  return useMemo(() => {
    if (!job || !data) return { out: null, error: null }
    try {
      return { out: runJob(job, data), error: null }
    } catch (e) {
      console.error(e)
      return { out: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [job, data])
}

export { bomCsv, buildFiles, type ExportKind } from '@/core/output'
