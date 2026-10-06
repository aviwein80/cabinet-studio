import { areasCsv, jobCosts } from './areas'
import { cutListCsv } from './cutlist'
import { labelsPdf, sheetMapPdf } from './labels/pdf'
import { labelsZpl } from './labels/zpl'
import { encodeCp1252 } from './mpr/writer'
import { mprFiles, type JobOutput } from './pipeline'
import type { AppData, Job } from './types'

export type OutFile = { name: string; data: string | Uint8Array }

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

export type ExportKind = 'mpr' | 'labels-pdf' | 'sheetmap-pdf' | 'labels-zpl' | 'cutlist-csv' | 'bom-csv' | 'areas-csv'

export function buildFiles(kinds: ExportKind[], job: Job, data: AppData, out: JobOutput): OutFile[] {
  const files: OutFile[] = []
  const base = job.number.replace(/[^A-Za-z0-9_-]+/g, '-')
  for (const k of kinds) {
    switch (k) {
      case 'mpr':
        for (const f of mprFiles(job, data, out)) files.push({ name: f.name, data: encodeCp1252(f.text) })
        break
      case 'labels-pdf':
        files.push({ name: `${base}_labels_${data.settings.labels.size}.pdf`, data: labelsPdf(out, data.settings.labels.size, data.settings.units, job.updatedAt) })
        break
      case 'sheetmap-pdf':
        files.push({ name: `${base}_sheet-maps.pdf`, data: sheetMapPdf(job, out, data.library, data.settings.units) })
        break
      case 'labels-zpl':
        files.push({ name: `${base}_labels_${data.settings.labels.size}.zpl`, data: labelsZpl(out, data.settings.labels.size, data.settings.units) })
        break
      case 'cutlist-csv':
        files.push({ name: `${base}_cutlist.csv`, data: cutListCsv(out.cutList) })
        break
      case 'bom-csv':
        files.push({ name: `${base}_bom.csv`, data: bomCsv(out, data) })
        break
      case 'areas-csv':
        files.push({ name: `${base}_areas-costs.csv`, data: areasCsv(jobCosts(out.nest, out.instances, data.library), out.instances, data.library, data.settings.currency ?? '$') })
        break
    }
  }
  return files
}
