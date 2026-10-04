import { nanoid } from 'nanoid'
import type { JobNest } from './machining'
import type { Offcut } from './types'

export interface JobRemnant {
  sheetIndex: number
  materialId: string
  length: number
  width: number
  dir: 'vertical' | 'horizontal'
}

export function jobRemnants(nest: JobNest): JobRemnant[] {
  return nest.sheets.flatMap((s) => (s.remnants ?? []).map((r) => ({ sheetIndex: s.index, materialId: s.materialId, length: r.length, width: r.width, dir: r.dir })))
}

/**
 * Stock after cutting this job: offcuts the nest used are taken out, the job's remnants go in.
 * Remnants saved earlier from the same job are replaced, so saving twice does not double up.
 */
export function updateOffcutStock(stock: Offcut[], nest: JobNest, jobNumber: string, now = new Date().toISOString()) {
  const used = new Set(nest.sheets.map((s) => s.offcutId).filter((x): x is string => !!x))
  const fresh: Offcut[] = jobRemnants(nest).map((r) => ({ id: nanoid(8), materialId: r.materialId, length: r.length, width: r.width, from: jobNumber, createdAt: now }))
  const kept = stock.filter((o) => !used.has(o.id) && o.from !== jobNumber)
  return { offcuts: [...kept, ...fresh], used: used.size, added: fresh.length }
}
