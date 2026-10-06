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
import { featuresOf } from './features'
import { dataFor, machineFolder, machineSetup, MAIN_MACHINE } from './machines'
import { buildFiles, type ExportKind, type OutFile } from './output'
import { runJob } from './pipeline'
import type { AppData, BatchSetup, Job, ShopSettings, UnitSystem } from './types'
import { parseLength } from './units'

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

/** One machine's program set for an order (M2.9). */
export interface BatchMachineResult {
  id: string
  name: string
  /** Sub-folder of the order folder ('' = the order folder itself, for the main machine). */
  folder: string
  /** written: files made; blocked: export-checker errors; held: other-machine output is switched off. */
  status: 'written' | 'blocked' | 'held'
  sheets: number
  parts: number
  errors: string[]
  files: string[]
}

export interface BatchOrderResult {
  number: string
  folder: string
  status: BatchStatus
  sheets: number
  parts: number
  files: OutFile[]
  errors: string[]
  warnings: string[]
  /** One entry per machine the setup sends the list to (M2.9). */
  machines: BatchMachineResult[]
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
  /** The batch setup to run (default: the one chosen in the settings, else the built-in one). */
  setup?: BatchSetup
}

/** Stage 1 behaviour: the main machine only, the default outputs. */
export const DEFAULT_BATCH_SETUP: BatchSetup = { id: 'standard', name: 'Standard', machines: [MAIN_MACHINE] }

/** The setup the folder watcher and "Run a list now" use. */
export function activeBatchSetup(s: Pick<ShopSettings, 'batch' | 'batchSetups'>): BatchSetup {
  const list = s.batchSetups ?? []
  return list.find((b) => b.id === s.batch?.setupId) ?? list[0] ?? DEFAULT_BATCH_SETUP
}

/** Change the active setup (made from the built-in one the first time). */
export function updateActiveSetup(s: ShopSettings, patch: Partial<Omit<BatchSetup, 'id'>>) {
  const cur = activeBatchSetup(s)
  const next = { ...cur, ...patch }
  const list = s.batchSetups ?? []
  s.batchSetups = list.some((b) => b.id === cur.id) ? list.map((b) => (b.id === cur.id ? next : b)) : [...list, next]
  s.batch = { inbox: s.batch?.inbox ?? '', outbox: s.batch?.outbox ?? '', ...s.batch, setupId: cur.id }
}

/** Outputs that depend on the machine (its nest and programs); the cut list and BOM do not. */
const PER_MACHINE: ExportKind[] = ['mpr', 'labels-pdf', 'sheetmap-pdf', 'labels-zpl', 'areas-csv']

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
  const setup = ctx.setup ?? activeBatchSetup(ctx.data.settings)
  const targets: { id: string; name: string }[] = []
  for (const id of setup.machines.length ? setup.machines : [MAIN_MACHINE]) {
    const m = machineSetup(ctx.data, id)
    if (!m) errors.push({ row: 0, message: `Batch setup "${setup.name}": machine "${id}" is not in the machine list; skipped.` })
    else if (!targets.some((t) => t.id === m.id)) targets.push({ id: m.id, name: m.name })
  }
  if (!targets.length) targets.push({ id: MAIN_MACHINE, name: ctx.data.machine.name })
  const otherOutput = featuresOf(ctx.data.settings).batchMachinesOutput
  for (const order of orders) {
    const res: BatchOrderResult = { number: order.number, folder: `${safe(order.number)}_${stamp(now)}`, status: 'done', sheets: 0, parts: 0, files: [], errors: [], warnings: [], machines: [] }
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
      // M2.9: the same part list goes to every machine of the setup; each gets its own nest,
      // programs and export check. The main machine's files stay in the order folder as before.
      const sets: { m: BatchMachineResult; data: AppData; out: ReturnType<typeof runJob> }[] = []
      for (const t of targets) {
        checkCancel(ctx.isCancelled)
        const main = t.id === MAIN_MACHINE
        const tag = main ? '' : `[${t.name}] `
        say(`${order.number}: nesting ${camParts.reduce((n, p) => n + p.qty, 0)} parts${main ? '' : ` for ${t.name}`}`)
        const d = dataFor(ctx.data, t.id)
        const out = runJob(job, d, { isCancelled: ctx.isCancelled })
        checkCancel(ctx.isCancelled)
        const m: BatchMachineResult = { id: t.id, name: t.name, folder: main ? '' : machineFolder(t), status: 'written', sheets: out.programs.length, parts: out.instances.length, errors: [], files: [] }
        for (const i of out.issues) (i.severity === 'error' ? m.errors : i.severity === 'warning' ? res.warnings : []).push(`${tag}${i.message}`)
        if (m.errors.length) m.status = 'blocked'
        else if (!main && !otherOutput) m.status = 'held'
        res.errors.push(...m.errors)
        res.machines.push(m)
        sets.push({ m, data: d, out })
      }
      res.sheets = res.machines[0].sheets
      res.parts = res.machines[0].parts
      for (const e of errors) res.warnings.push(e.row ? `Row ${e.row}: ${e.message}` : e.message)
      if (res.errors.length) {
        res.status = 'blocked'
        for (const s of sets) if (s.m.status === 'written') s.m.status = 'blocked'
        say(`${order.number}: blocked by ${res.errors.length} error(s); report only`)
      } else {
        for (const s of sets) {
          if (s.m.status !== 'written') continue
          const kinds = ctx.kinds ?? setup.kinds ?? DEFAULT_BATCH_KINDS
          const files = buildFiles(s.m.folder ? kinds.filter((k) => PER_MACHINE.includes(k)) : kinds, job, s.data, s.out)
          for (const f of files) res.files.push(s.m.folder ? { ...f, name: `${s.m.folder}/${f.name}` } : f)
          s.m.files = files.map((f) => f.name)
        }
        const held = res.machines.filter((m) => m.status === 'held')
        if (held.length) res.warnings.push(`Programs for ${held.map((m) => m.name).join(', ')} were checked but not written: "Write programs for other machines" is off on the Machine page.`)
        const sheets = (n: number) => `${n} sheet${n === 1 ? '' : 's'}`
        const only = res.machines.length === 1 && res.machines[0].id === MAIN_MACHINE
        say(`${order.number}: ${only ? sheets(res.sheets) : res.machines.map((m) => `${m.name} ${sheets(m.sheets)}${m.status === 'held' ? ' (held back)' : ''}`).join('; ')}, ${res.files.length} files`)
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
    ...(r.machines.length > 1 || r.machines.some((m) => m.id !== MAIN_MACHINE)
      ? ['', 'Machines:', ...r.machines.map((m) => `  ${m.name}: ${m.sheets} sheet${m.sheets === 1 ? '' : 's'}, ${{ written: m.folder ? `programs in ${m.folder}/` : 'programs in this folder', blocked: 'blocked by the export checker', held: 'checked, not written (output for other machines is off)' }[m.status]}`)]
      : []),
    '',
    'Programs are generated, not machine-proven. Simulate each one in woodWOP before running it on the N-200.',
    '',
    ...(r.errors.length ? ['Errors:', ...r.errors.map((e) => `  - ${e}`), ''] : []),
    ...(r.warnings.length ? ['Warnings:', ...r.warnings.map((e) => `  - ${e}`), ''] : []),
    ...(r.files.length ? ['Files:', ...r.files.map((f) => `  ${f.name}`), ''] : []),
  ]
  return lines.join('\r\n')
}
