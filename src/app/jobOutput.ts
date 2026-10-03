import { useMemo } from 'react'
import { cutListCsv } from '@/core/cutlist'
import { labelsPdf, sheetMapPdf } from '@/core/labels/pdf'
import { labelsZpl } from '@/core/labels/zpl'
import { encodeCp1252 } from '@/core/mpr/writer'
import { mprFiles, runJob, type JobOutput } from '@/core/pipeline'
import type { AppData, Job } from '@/core/types'
import type { OutFile } from './backend'

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

export function bomCsv(out: JobOutput, data: AppData) {
  const lines = ['Type,Code,Name,Qty,Unit']
  const sheetsByMat = new Map<string, number>()
  for (const p of out.programs) sheetsByMat.set(p.materialCode, (sheetsByMat.get(p.materialCode) ?? 0) + 1)
  for (const [code, n] of sheetsByMat) {
    const m = data.library.materials.find((mm) => mm.code === code)
    lines.push(['Sheet', code, `"${m?.name ?? code} ${m?.sheetLength}x${m?.sheetWidth}"`, n, 'sheets'].join(','))
  }
  for (const e of out.edgebands) lines.push(['Edgeband', e.code, `"${e.name}"`, e.metres, 'm'].join(','))
  for (const h of out.hardware) lines.push(['Hardware', h.code, `"${h.name}"`, h.qty, 'pcs'].join(','))
  return lines.join('\r\n') + '\r\n'
}

export type ExportKind = 'mpr' | 'labels-pdf' | 'sheetmap-pdf' | 'labels-zpl' | 'cutlist-csv' | 'bom-csv'

export function buildFiles(kinds: ExportKind[], job: Job, data: AppData, out: JobOutput): OutFile[] {
  const files: OutFile[] = []
  const base = job.number.replace(/[^A-Za-z0-9_-]+/g, '-')
  for (const k of kinds) {
    switch (k) {
      case 'mpr':
        for (const f of mprFiles(job, data, out)) files.push({ name: f.name, data: encodeCp1252(f.text) })
        break
      case 'labels-pdf':
        files.push({ name: `${base}_labels_${data.settings.labels.size}.pdf`, data: labelsPdf(out, data.settings.labels.size) })
        break
      case 'sheetmap-pdf':
        files.push({ name: `${base}_sheet-maps.pdf`, data: sheetMapPdf(job, out, data.library) })
        break
      case 'labels-zpl':
        files.push({ name: `${base}_labels_${data.settings.labels.size}.zpl`, data: labelsZpl(out, data.settings.labels.size) })
        break
      case 'cutlist-csv':
        files.push({ name: `${base}_cutlist.csv`, data: cutListCsv(out.cutList) })
        break
      case 'bom-csv':
        files.push({ name: `${base}_bom.csv`, data: bomCsv(out, data) })
        break
    }
  }
  return files
}
