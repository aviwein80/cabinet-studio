/**
 * Batch runs: a part-list CSV (plus the DXF drawings it names) becomes one job per order, nested
 * and written as MPR programs, labels, sheet maps, cut list and a report, with nobody at the
 * screen. The same export checker applies: an order with errors gets its report only.
 *
 * CSV columns (any order, case-insensitive, our names or common aliases):
 *   order, customer, job name, item, name, type (part/drawing/door), file, rules, style,
 *   material, length, width, thickness, qty, grain, priority, kit, hinge, pull, pull at, nest
 * Lengths use the shop units and accept inch fractions (15 1/2).
 */
import Papa from 'papaparse'
import { newPart } from '@/cam/doc'
import { buildDoor, doorStylesOf, type DoorSpec, type HingeSide, type PullKind } from '@/cam/doors'
import { dxfToPart } from '@/cam/dxf'
import { applyRules, recipesOf, ruleSetsOf } from '@/cam/rules'
import type { CamPart } from '@/cam/types'
import { Cancelled, checkCancel, type CancelCheck } from './cancel'
import { buildFiles, type ExportKind, type OutFile } from './output'
import { runJob } from './pipeline'
import type { AppData, Job, UnitSystem } from './types'
import { parseLength } from './units'
import { countBySeverity } from './validator'

export interface BatchRowError {
  row: number
  message: string
}

export interface BatchItem {
  row: number
  kind: 'part' | 'drawing' | 'door'
  item: string
  name: string
  file?: string
  rules?: string
  style?: string
  materialId: string | null
  length: number
  width: number
  thickness: number
  qty: number
  grain: 'length' | 'none'
  priority?: number
  kit?: string
  hinge: HingeSide
  pull: PullKind
  pullAt: DoorSpec['pullAt']
}

export interface BatchOrder {
  number: string
  name: string
  customer: string
  items: BatchItem[]
}

const HEAD: Record<string, keyof RawRow> = {
  order: 'order', 'order no': 'order', job: 'order', 'job no': 'order', 'job number': 'order',
  customer: 'customer', client: 'customer',
  'job name': 'jobName', project: 'jobName',
  item: 'item', 'item no': 'item', line: 'item',
  name: 'name', part: 'name', description: 'name',
  type: 'type', kind: 'type',
  file: 'file', drawing: 'file', dxf: 'file',
  rules: 'rules', 'layer rules': 'rules', mapping: 'rules',
  style: 'style', 'door style': 'style',
  material: 'material', mat: 'material', 'material code': 'material',
  length: 'length', l: 'length', height: 'length', h: 'length',
  width: 'width', w: 'width',
  thickness: 'thickness', t: 'thickness',
  qty: 'qty', quantity: 'qty', count: 'qty',
  grain: 'grain', rotate: 'rotate', rotation: 'rotate',
  priority: 'priority', kit: 'kit',
  hinge: 'hinge', hand: 'hinge', pull: 'pull', handle: 'pull', 'pull at': 'pullAt',
  nest: 'nest',
}

interface RawRow {
  order: string
  customer: string
  jobName: string
  item: string
  name: string
  type: string
  file: string
  rules: string
  style: string
  material: string
  length: string
  width: string
  thickness: string
  qty: string
  grain: string
  rotate: string
  priority: string
  kit: string
  hinge: string
  pull: string
  pullAt: string
  nest: string
}

const yes = (s: string) => /^(y|yes|true|1|on|x)$/i.test(s.trim())
const no = (s: string) => /^(n|no|false|0|off)$/i.test(s.trim())
const r6 = (n: number) => Math.round(n * 1e6) / 1e6

export function parseBatchCsv(text: string, data: AppData, opts: { defaultOrder: string; units?: UnitSystem }): { orders: BatchOrder[]; errors: BatchRowError[] } {
  const units = opts.units ?? data.settings.units
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' })
  const rows = parsed.data
  const errors: BatchRowError[] = []
  if (!rows.length) return { orders: [], errors: [{ row: 0, message: 'The file is empty.' }] }
  const cols = rows[0].map((h) => HEAD[h.trim().toLowerCase()] ?? null)
  if (!cols.includes('length') || !cols.includes('width')) {
    if (!cols.includes('file')) return { orders: [], errors: [{ row: 1, message: 'Need length and width columns (or a file column for drawings).' }] }
  }
  const lib = data.library
  const styles = doorStylesOf(lib)
  const orders = new Map<string, BatchOrder>()
  for (let i = 1; i < rows.length; i++) {
    const rowNo = i + 1
    const raw = Object.fromEntries(Object.keys(HEAD).map((k) => [HEAD[k], ''])) as unknown as RawRow
    rows[i].forEach((cell, k) => {
      const c = cols[k]
      if (c) raw[c] = cell.trim()
    })
    if (raw.nest && no(raw.nest)) continue
    const type = raw.type.toLowerCase()
    const kind: BatchItem['kind'] = type.startsWith('door') || (!type && raw.style) ? 'door' : type.startsWith('draw') || type === 'dxf' || (!type && raw.file) ? 'drawing' : 'part'
    const len = (s: string, what: string, required: boolean) => {
      if (!s) {
        if (required) errors.push({ row: rowNo, message: `${what} is missing.` })
        return null
      }
      const n = parseLength(s, units)
      if (n === null || !(n > 0)) {
        errors.push({ row: rowNo, message: `${what} "${s}" is not a length.` })
        return null
      }
      return r6(n)
    }
    const L = len(raw.length, kind === 'door' ? 'Height' : 'Length', kind !== 'drawing')
    const W = len(raw.width, 'Width', kind !== 'drawing')
    if (kind !== 'drawing' && (L === null || W === null)) continue
    const matKey = raw.material.toLowerCase()
    const mat = matKey ? lib.materials.find((m) => m.code.toLowerCase() === matKey || m.id.toLowerCase() === matKey || m.name.toLowerCase() === matKey) : undefined
    if (!matKey) errors.push({ row: rowNo, message: 'Material is missing; the part cannot be nested.' })
    else if (!mat) errors.push({ row: rowNo, message: `Material "${raw.material}" is not in the library.` })
    if (kind === 'door' && raw.style && !styles.some((s) => [s.id, s.name, s.kind].some((x) => x.toLowerCase() === raw.style.toLowerCase()))) {
      errors.push({ row: rowNo, message: `Unknown door style "${raw.style}".` })
      continue
    }
    if (kind === 'drawing' && !raw.file) {
      errors.push({ row: rowNo, message: 'Drawing row without a file.' })
      continue
    }
    const qty = raw.qty ? Math.round(Number(raw.qty)) : 1
    if (!(qty >= 1)) errors.push({ row: rowNo, message: `Quantity "${raw.qty}" is not a whole number; using 1.` })
    const prio = raw.priority ? Number(raw.priority) : undefined
    if (raw.priority && !Number.isFinite(prio)) errors.push({ row: rowNo, message: `Priority "${raw.priority}" is not a number.` })
    const locked = raw.grain ? yes(raw.grain) || /^(l|length|along)/i.test(raw.grain) : raw.rotate ? no(raw.rotate) || /^lock/i.test(raw.rotate) : !!mat?.grain
    const hinge = (raw.hinge.toLowerCase().startsWith('r') ? 'right' : raw.hinge.toLowerCase().startsWith('n') || raw.hinge === '0' ? 'none' : 'left') as HingeSide
    const pullRaw = (raw.pull || 'none').toLowerCase().replace(/\s*mm$/, '')
    const pull = (['none', 'knob', '96', '128', '160'].includes(pullRaw) ? pullRaw : 'none') as PullKind
    const number = raw.order || opts.defaultOrder
    let order = orders.get(number)
    if (!order) {
      order = { number, name: raw.jobName || `Batch ${number}`, customer: raw.customer, items: [] }
      orders.set(number, order)
    }
    order.items.push({
      row: rowNo,
      kind,
      item: raw.item || String(order.items.length + 1),
      name: raw.name || (kind === 'drawing' ? raw.file.replace(/^.*[\\/]/, '').replace(/\.dxf$/i, '') : `Part ${order.items.length + 1}`),
      ...(raw.file ? { file: raw.file } : {}),
      ...(raw.rules ? { rules: raw.rules } : {}),
      ...(raw.style ? { style: raw.style } : {}),
      materialId: mat?.id ?? null,
      length: L ?? 0,
      width: W ?? 0,
      thickness: (raw.thickness ? parseLength(raw.thickness, units) : null) ?? mat?.thickness ?? 19,
      qty: qty >= 1 ? qty : 1,
      grain: locked ? 'length' : 'none',
      ...(prio && Number.isFinite(prio) ? { priority: prio } : {}),
      ...(raw.kit ? { kit: raw.kit } : {}),
      hinge,
      pull,
      pullAt: raw.pullAt.toLowerCase().startsWith('b') ? 'bottom' : raw.pullAt.toLowerCase().startsWith('m') ? 'middle' : 'top',
    })
  }
  return { orders: [...orders.values()], errors }
}

/** Custom part for one CSV row. Drawings are read through `readFile` (path as written in the CSV). */
export function itemPart(it: BatchItem, data: AppData, readFile: (path: string) => string | null): { part: CamPart | null; warnings: string[] } {
  const lib = data.library
  const common = { materialId: it.materialId, qty: it.qty, grain: it.grain, ...(it.priority ? { priority: it.priority } : {}), ...(it.kit ? { kit: it.kit } : {}) }
  if (it.kind === 'part') return { part: { ...newPart({ name: it.name, length: it.length, width: it.width, thickness: it.thickness }), ...common, source: `Batch row ${it.row}` }, warnings: [] }
  if (it.kind === 'door') {
    const styles = doorStylesOf(lib)
    const key = (it.style ?? '').toLowerCase()
    const style = styles.find((s) => [s.id, s.name, s.kind].some((x) => x.toLowerCase() === key)) ?? styles[0]
    const spec: DoorSpec = { name: it.name, styleId: style.id, width: it.width, height: it.length, qty: it.qty, materialId: it.materialId, thickness: it.thickness, hinge: it.hinge, pull: it.pull, pullAt: it.pullAt, values: {}, grain: it.grain }
    const r = buildDoor(spec, style, recipesOf(lib))
    return { part: { ...r.part, ...common }, warnings: r.warnings }
  }
  const text = readFile(it.file!)
  if (text === null) return { part: null, warnings: [`Drawing ${it.file} not found.`] }
  const { part, report } = dxfToPart(text, it.name, { thickness: it.thickness })
  const sets = ruleSetsOf(lib)
  const set = it.rules ? sets.find((s) => s.name.toLowerCase() === it.rules!.toLowerCase() || s.id === it.rules) : sets[0]
  const warnings = [...report.warnings]
  if (it.rules && !set) warnings.push(`Machining rules "${it.rules}" not found; using ${sets[0]?.name ?? 'none'}.`)
  const applied = set ?? sets[0] ? applyRules(part, (set ?? sets[0])!, recipesOf(lib)) : null
  if (applied?.unmatched.length) warnings.push(`No rule for layers: ${applied.unmatched.join(', ')}`)
  return { part: { ...(applied?.part ?? part), ...common, source: `Batch ${it.file}` }, warnings }
}

export type BatchStatus = 'done' | 'blocked' | 'failed' | 'cancelled'

export interface BatchOrderResult {
  number: string
  folder: string
  status: BatchStatus
  sheets: number
  parts: number
  files: OutFile[]
  errors: string[]
  warnings: string[]
}

export interface BatchResult {
  csv: string
  orders: BatchOrderResult[]
  rowErrors: BatchRowError[]
  cancelled: boolean
}

export interface BatchContext {
  data: AppData
  readFile: (path: string) => string | null
  now?: Date
  isCancelled?: CancelCheck
  onProgress?: (msg: string) => void
  /** Outputs per order; MPR files are only written when the export checker finds no errors. */
  kinds?: ExportKind[]
}

const stamp = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'job'

export const DEFAULT_BATCH_KINDS: ExportKind[] = ['mpr', 'labels-pdf', 'sheetmap-pdf', 'cutlist-csv', 'bom-csv']

/** Run one CSV. Never throws for bad input; `Cancelled` stops between and inside orders. */
export function runBatchCsv(csvName: string, csvText: string, ctx: BatchContext): BatchResult {
  const now = ctx.now ?? new Date()
  const base = csvName.replace(/^.*[\\/]/, '').replace(/\.csv$/i, '')
  const { orders, errors } = parseBatchCsv(csvText, ctx.data, { defaultOrder: safe(base) })
  const result: BatchResult = { csv: csvName, orders: [], rowErrors: errors, cancelled: false }
  const say = (m: string) => ctx.onProgress?.(m)
  say(`${csvName}: ${orders.length} order${orders.length === 1 ? '' : 's'}, ${orders.reduce((n, o) => n + o.items.length, 0)} rows${errors.length ? `, ${errors.length} row problem(s)` : ''}`)
  for (const order of orders) {
    const res: BatchOrderResult = { number: order.number, folder: `${safe(order.number)}_${stamp(now)}`, status: 'done', sheets: 0, parts: 0, files: [], errors: [], warnings: [] }
    result.orders.push(res)
    try {
      checkCancel(ctx.isCancelled)
      const camParts: CamPart[] = []
      for (const it of order.items) {
        checkCancel(ctx.isCancelled)
        const r = itemPart(it, ctx.data, ctx.readFile)
        res.warnings.push(...r.warnings.map((w) => `Row ${it.row} (${it.name}): ${w}`))
        if (r.part) camParts.push(r.part)
        else res.errors.push(`Row ${it.row} (${it.name}): ${r.warnings.join(' ')}`)
      }
      const at = now.toISOString()
      const job: Job = { id: `batch-${safe(order.number)}`, number: order.number, name: order.name, customer: order.customer, notes: `Batch from ${csvName}`, createdAt: at, updatedAt: at, cabinets: [], camParts }
      say(`${order.number}: nesting ${camParts.reduce((n, p) => n + p.qty, 0)} parts`)
      const out = runJob(job, ctx.data, { isCancelled: ctx.isCancelled })
      checkCancel(ctx.isCancelled)
      res.sheets = out.programs.length
      res.parts = out.instances.length
      for (const i of out.issues) (i.severity === 'error' ? res.errors : i.severity === 'warning' ? res.warnings : []).push(i.message)
      for (const e of errors) res.warnings.push(`Row ${e.row}: ${e.message}`)
      if (countBySeverity(out.issues).error > 0 || res.errors.length) {
        res.status = 'blocked'
        say(`${order.number}: blocked by ${res.errors.length} error(s); report only`)
      } else {
        res.files = buildFiles(ctx.kinds ?? DEFAULT_BATCH_KINDS, job, ctx.data, out)
        say(`${order.number}: ${res.sheets} sheet${res.sheets === 1 ? '' : 's'}, ${res.files.length} files`)
      }
    } catch (e) {
      if (e instanceof Cancelled) {
        res.status = 'cancelled'
        res.files = []
        result.cancelled = true
        say(`${order.number}: cancelled`)
        res.files.push({ name: `${safe(order.number)}_report.txt`, data: orderReport(result, res, now) })
        break
      }
      res.status = 'failed'
      res.errors.push(e instanceof Error ? e.message : String(e))
      say(`${order.number}: failed: ${res.errors[res.errors.length - 1]}`)
    }
    res.files.push({ name: `${safe(order.number)}_report.txt`, data: orderReport(result, res, now) })
  }
  return result
}

export function orderReport(batch: BatchResult, r: BatchOrderResult, now: Date) {
  const lines = [
    `Cabinet Studio batch report`,
    `Source: ${batch.csv}`,
    `Order: ${r.number}`,
    `Run: ${now.toISOString()}`,
    `Status: ${{ done: 'Programs written', blocked: 'Blocked by the export checker (no programs written)', failed: 'Failed', cancelled: 'Cancelled' }[r.status]}`,
    `Sheets: ${r.sheets}   Parts: ${r.parts}`,
    '',
    'Programs are generated, not machine-proven. Simulate each one in woodWOP before running it on the N-200.',
    '',
    ...(r.errors.length ? ['Errors:', ...r.errors.map((e) => `  - ${e}`), ''] : []),
    ...(r.warnings.length ? ['Warnings:', ...r.warnings.map((e) => `  - ${e}`), ''] : []),
    ...(r.files.length ? ['Files:', ...r.files.map((f) => `  ${f.name}`), ''] : []),
  ]
  return lines.join('\r\n')
}
