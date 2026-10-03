/**
 * Writes every output of the built-in sample job (J1042) to examples/sample-job/ so the files can be
 * inspected or opened in woodWOP without running the app. Usage: npm run sample [-- <outDir>]
 */
import fs from 'node:fs'
import path from 'node:path'
import { buildFiles } from '../src/app/jobOutput'
import { defaultAppData } from '../src/core/defaults'
import { runJob } from '../src/core/pipeline'
import { sampleJob } from '../src/core/sample'
import { countBySeverity } from '../src/core/validator'

const outDir = path.resolve(process.argv[2] ?? 'examples/sample-job')
const data = defaultAppData()
const job = { ...sampleJob(), id: 'job-sample', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
const out = runJob(job, data)

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(path.join(outDir, 'mpr'), { recursive: true })

const files = buildFiles(['mpr', 'labels-pdf', 'sheetmap-pdf', 'labels-zpl', 'cutlist-csv', 'bom-csv'], job, data, out)
for (const f of files) {
  const dest = f.name.toLowerCase().endsWith('.mpr') ? path.join(outDir, 'mpr', f.name) : path.join(outDir, f.name)
  fs.writeFileSync(dest, f.data)
}

const issues = out.issues.map((i) => `${i.severity.toUpperCase().padEnd(7)} ${i.code.padEnd(18)} ${i.sheet !== undefined ? `S${i.sheet} ` : ''}${i.partNo !== undefined ? `#${i.partNo} ` : ''}${i.message}`)
fs.writeFileSync(path.join(outDir, 'validation.txt'), issues.join('\r\n') + '\r\n')
fs.writeFileSync(path.join(outDir, 'job.json'), JSON.stringify(job, null, 2))

const c = countBySeverity(out.issues)
console.log(`${job.number}: ${out.instances.length} parts on ${out.programs.length} sheets -> ${outDir}`)
for (const p of out.programs) console.log(`  ${p.name}.mpr  ${p.sheet.placements.length} parts  ${p.sheet.utilization}%`)
console.log(`  validation: ${c.error} errors, ${c.warning} warnings, ${c.info} info`)
