/**
 * Tool table data (M2.7): the fields of a tool as one list (used by the grid editor, the
 * spreadsheet export and import, and the confirmation of typed values), the tool data an
 * operation was calculated with and its comparison with the table (TOOL-05), and the grid's
 * editing logic (NEW-15).
 */
import * as XLSX from 'xlsx'
import { feedsFor } from '@/cam/ops'
import type { CamOp, CamPart, ToolSnapshot } from '@/cam/types'
import { confirmKey, type ToolPart } from './confirm'
import { effectiveGauge, effectiveHolder } from './machineModel'
import type { MachineProfile, Tool, ToolShape, ToolType } from './types'
import { formatLength, parseLength } from './units'
import type { UnitSystem } from './types'

export type ToolFieldKind = 'num' | 'len' | 'text' | 'type' | 'shape' | 'bool' | 'holder' | 'aggregate'

export interface ToolField {
  key: keyof Tool & string
  label: string
  kind: ToolFieldKind
  /** Which confirmation the value belongs to (M2.6e): typing it confirms that part of the tool. */
  part?: ToolPart
  /** Must be above zero when given. */
  positive?: boolean
  /** Shown in the grid (all fields are in the spreadsheet). */
  grid?: boolean
  width?: number
}

export const TOOL_TYPES: ToolType[] = ['router', 'drill-vertical', 'drill-horizontal', 'saw']
export const TOOL_SHAPES: ToolShape[] = ['flat', 'ball', 'bull', 'v', 'drill', 'saw', 'profile', 'lollipop']

export const TOOL_FIELDS: ToolField[] = [
  { key: 'number', label: 'Tool no.', kind: 'num', part: 'data', positive: true, grid: true, width: 70 },
  { key: 'type', label: 'Type', kind: 'type', grid: true, width: 120 },
  { key: 'name', label: 'Description', kind: 'text', grid: true, width: 240 },
  { key: 'diameter', label: 'Ø / kerf', kind: 'len', part: 'data', positive: true, grid: true, width: 80 },
  { key: 'maxDepth', label: 'Max depth', kind: 'len', part: 'data', positive: true, grid: true, width: 80 },
  { key: 'shape', label: 'Shape', kind: 'shape', grid: true, width: 80 },
  { key: 'angle', label: 'V angle °', kind: 'num', positive: true, grid: true, width: 70 },
  { key: 'cornerRadius', label: 'Corner R', kind: 'len', grid: true, width: 70 },
  { key: 'flutes', label: 'Flutes', kind: 'num', part: 'feeds', positive: true, width: 60 },
  { key: 'rpm', label: 'rpm', kind: 'num', part: 'feeds', positive: true, grid: true, width: 70 },
  { key: 'feed', label: 'Feed mm/min', kind: 'num', part: 'feeds', positive: true, grid: true, width: 80 },
  { key: 'plungeFeed', label: 'Plunge mm/min', kind: 'num', part: 'feeds', positive: true, grid: true, width: 80 },
  { key: 'stepdown', label: 'Step-down', kind: 'len', part: 'feeds', grid: true, width: 70 },
  { key: 'feedPerTooth', label: 'Feed per tooth', kind: 'num', part: 'feeds', positive: true },
  { key: 'centreCutting', label: 'Centre cutting', kind: 'bool' },
  { key: 'maxPlunge', label: 'Max plunge', kind: 'len' },
  { key: 'shankDiameter', label: 'Shank Ø', kind: 'len', part: 'lengths', positive: true, grid: true, width: 70 },
  { key: 'fluteLength', label: 'Flute length', kind: 'len', part: 'lengths', positive: true, grid: true, width: 70 },
  { key: 'gaugeLength', label: 'Stick-out', kind: 'len', part: 'lengths', positive: true, grid: true, width: 70 },
  { key: 'holderId', label: 'Holder', kind: 'holder', part: 'lengths', grid: true, width: 150 },
  { key: 'aggregateId', label: 'Aggregate', kind: 'aggregate', width: 150 },
  { key: 'kerf', label: 'Kerf', kind: 'len', positive: true },
  { key: 'bladeDiameter', label: 'Blade Ø', kind: 'len', part: 'blade', positive: true },
  { key: 'folder', label: 'Folder', kind: 'text' },
  { key: 'notes', label: 'Notes', kind: 'text' },
]

export const GRID_FIELDS = TOOL_FIELDS.filter((f) => f.grid)

// ---------------------------------------------------------------------------------------------
// Cells: show and parse
// ---------------------------------------------------------------------------------------------

const fmt = (n: number) => String(Math.round(n * 10000) / 10000)

/** A tool's value as text in a cell (lengths in the shop unit). */
export function cellText(t: Tool, f: ToolField, units: UnitSystem, m?: Pick<MachineProfile, 'holders' | 'aggregates'>): string {
  const v = t[f.key]
  if (v === undefined || v === null || v === '') return ''
  if (f.kind === 'len') return formatLength(v as number, units)
  if (f.kind === 'num') return fmt(v as number)
  if (f.kind === 'bool') return v ? 'yes' : 'no'
  if (f.kind === 'holder') return m?.holders?.find((h) => h.id === v)?.name ?? String(v)
  if (f.kind === 'aggregate') return m?.aggregates?.find((a) => a.id === v)?.name ?? String(v)
  return String(v)
}

/**
 * Read a typed cell. Empty clears an optional field (required ones refuse it). Returns the value,
 * or an error in plain words.
 */
export function parseCell(text: string, f: ToolField, units: UnitSystem, m?: Pick<MachineProfile, 'holders' | 'aggregates'>): { value: unknown } | { error: string } {
  const s = text.trim()
  const required = f.key === 'number' || f.key === 'type' || f.key === 'name' || f.key === 'diameter' || f.key === 'maxDepth'
  if (!s) return required ? { error: `${f.label} is needed.` } : { value: undefined }
  switch (f.kind) {
    case 'num':
    case 'len': {
      const n = f.kind === 'len' ? parseLength(s, units) : Number(s.replace(',', '.'))
      if (n === null || !Number.isFinite(n)) return { error: `${f.label}: “${s}” is not a number.` }
      if (n < 0 || (f.positive && n === 0)) return { error: `${f.label} must be above zero.` }
      if (f.key === 'number' && !Number.isInteger(n)) return { error: 'Tool numbers are whole numbers.' }
      return { value: n }
    }
    case 'type': {
      const v = TOOL_TYPES.find((x) => x === s.toLowerCase())
      return v ? { value: v } : { error: `Type must be ${TOOL_TYPES.join(', ')}.` }
    }
    case 'shape': {
      const v = TOOL_SHAPES.find((x) => x === s.toLowerCase())
      return v ? { value: v } : { error: `Shape must be ${TOOL_SHAPES.join(', ')}.` }
    }
    case 'bool': {
      const l = s.toLowerCase()
      if (['yes', 'y', 'true', '1', 'x'].includes(l)) return { value: true }
      if (['no', 'n', 'false', '0'].includes(l)) return { value: false }
      return { error: `${f.label}: yes or no.` }
    }
    case 'holder': {
      const h = m?.holders?.find((x) => x.id === s || x.name.toLowerCase() === s.toLowerCase())
      return h ? { value: h.id } : { error: `No holder “${s}” in the holder list.` }
    }
    case 'aggregate': {
      const a = m?.aggregates?.find((x) => x.id === s || x.name.toLowerCase() === s.toLowerCase())
      return a ? { value: a.id } : { error: `No aggregate “${s}” in the list.` }
    }
    default:
      return { value: s }
  }
}

/** Set one field (undefined removes it). */
export function withField(t: Tool, key: keyof Tool, value: unknown): Tool {
  const next = { ...t } as Record<string, unknown>
  if (value === undefined) delete next[key]
  else next[key] = value
  return next as unknown as Tool
}

/** Changes between two versions of the tool table, field by field. */
export interface ToolChange {
  toolId: string
  number: number
  field: keyof Tool & string
  from: unknown
  to: unknown
}

export function diffTools(before: Tool[], after: Tool[]): { changes: ToolChange[]; added: Tool[]; removed: Tool[] } {
  const changes: ToolChange[] = []
  const added: Tool[] = []
  for (const t of after) {
    const o = before.find((x) => x.id === t.id)
    if (!o) {
      added.push(t)
      continue
    }
    for (const f of TOOL_FIELDS) if (JSON.stringify(o[f.key]) !== JSON.stringify(t[f.key])) changes.push({ toolId: t.id, number: t.number, field: f.key, from: o[f.key], to: t[f.key] })
  }
  return { changes, added, removed: before.filter((o) => !after.some((t) => t.id === o.id)) }
}

/**
 * Put an edited tool table on a copy of the machine: typed values are the shop's own, so each
 * changed tool's part (data, lengths, feeds, blade) is confirmed (M2.6e); a new tool's given parts
 * too. Nothing here switches on an output or clears the placeholder-table flag.
 */
export function applyToolTable(m: MachineProfile, tools: Tool[]) {
  const d = diffTools(m.tools, tools)
  m.tools = tools
  const parts = new Set<string>()
  for (const c of d.changes) {
    const part = TOOL_FIELDS.find((f) => f.key === c.field)?.part
    if (part && c.to !== undefined) parts.add(`tool:${c.toolId}:${part}`)
  }
  for (const t of d.added) for (const f of TOOL_FIELDS) if (f.part && t[f.key] !== undefined) parts.add(`tool:${t.id}:${f.part}`)
  for (const k of parts) confirmKey(m, k)
  return d
}

// ---------------------------------------------------------------------------------------------
// Grid (NEW-15): keyboard navigation over cells
// ---------------------------------------------------------------------------------------------

export interface Cell {
  row: number
  col: number
}

/** The cell a key moves to (Tab / Shift+Tab run along rows and wrap; Enter goes down). */
export function moveCell(at: Cell, key: string, shift: boolean, rows: number, cols: number): Cell {
  const clamp = (c: Cell): Cell => ({ row: Math.max(0, Math.min(rows - 1, c.row)), col: Math.max(0, Math.min(cols - 1, c.col)) })
  switch (key) {
    case 'ArrowUp':
      return clamp({ ...at, row: at.row - 1 })
    case 'ArrowDown':
      return clamp({ ...at, row: at.row + 1 })
    case 'ArrowLeft':
      return clamp({ ...at, col: at.col - 1 })
    case 'ArrowRight':
      return clamp({ ...at, col: at.col + 1 })
    case 'Enter':
      return clamp({ ...at, row: at.row + (shift ? -1 : 1) })
    case 'Tab': {
      const i = at.row * cols + at.col + (shift ? -1 : 1)
      const n = Math.max(0, Math.min(rows * cols - 1, i))
      return { row: Math.floor(n / cols), col: n % cols }
    }
    case 'Home':
      return { ...at, col: 0 }
    case 'End':
      return { ...at, col: cols - 1 }
    default:
      return at
  }
}

// ---------------------------------------------------------------------------------------------
// Spreadsheet export / import (TOOL-05)
// ---------------------------------------------------------------------------------------------

/** One row per tool, every field, lengths in mm (the column headers are the field keys). */
export function toolRows(m: MachineProfile): Record<string, string | number | boolean>[] {
  return m.tools.map((t) => {
    const row: Record<string, string | number | boolean> = {}
    for (const f of TOOL_FIELDS) {
      const v = t[f.key]
      row[f.key] = v === undefined || v === null ? '' : f.kind === 'holder' ? (m.holders?.find((h) => h.id === v)?.name ?? String(v)) : f.kind === 'aggregate' ? (m.aggregates?.find((a) => a.id === v)?.name ?? String(v)) : (v as string | number | boolean)
    }
    return row
  })
}

/** The tool table as an .xlsx workbook (sheet "Tools", lengths in mm, plus a "Read me" sheet). */
export function toolsXlsx(m: MachineProfile): Uint8Array {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toolRows(m), { header: TOOL_FIELDS.map((f) => f.key) }), 'Tools')
  const notes = [
    ['Cabinet Studio tool table. Lengths in millimetres, feeds in mm/min.'],
    ['Rows are matched by tool number. An empty cell leaves the value as it is.'],
    m.placeholder ? ['PLACEHOLDER: these tools are invented, not the N-200 tool table.'] : ['Tool table marked as real.'],
    [],
    ['Column', 'Meaning'],
    ...TOOL_FIELDS.map((f) => [f.key, f.label]),
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(notes), 'Read me')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array
}

/** The tool table as CSV (same columns). */
export function toolsCsv(m: MachineProfile): string {
  const head = TOOL_FIELDS.map((f) => f.key)
  const q = (v: unknown) => {
    const s = String(v ?? '')
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [head.join(','), ...toolRows(m).map((r) => head.map((k) => q(r[k])).join(','))].join('\r\n') + '\r\n'
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const COLUMN_ALIASES: Record<string, string[]> = { number: ['tno', 'toolno', 'toolnumber', 'tool'], diameter: ['dia', 'd'], maxDepth: ['depth', 'cuttinglength'], type: ['category'], name: ['description'], gaugeLength: ['stickout', 'gauge'], fluteLength: ['flute'], holderId: ['holder'], aggregateId: ['aggregate'] }

export interface SheetImport {
  /** The table after the import. */
  tools: Tool[]
  changes: ToolChange[]
  added: Tool[]
  errors: string[]
  /** Columns that were not recognised (left out). */
  ignored: string[]
}

/**
 * Read rows from a spreadsheet into the tool table: rows matched by tool number; a filled cell
 * sets the value (lengths in mm), an empty cell leaves it as it is. New tool numbers become new
 * tools (type, diameter and depth needed). Bad cells are reported and the row is skipped.
 */
export function toolsFromRows(rows: Record<string, unknown>[], m: MachineProfile): SheetImport {
  const errors: string[] = []
  const ignored = new Set<string>()
  const colOf = (header: string): ToolField | undefined => {
    const n = norm(header)
    return TOOL_FIELDS.find((f) => norm(f.key) === n || norm(f.label) === n || (COLUMN_ALIASES[f.key] ?? []).includes(n))
  }
  const tools = m.tools.map((t) => ({ ...t }))
  rows.forEach((row, i) => {
    const cells: [ToolField, string][] = []
    for (const [h, v] of Object.entries(row)) {
      const f = colOf(h)
      if (!f) {
        if (h.trim()) ignored.add(h)
        continue
      }
      cells.push([f, v === undefined || v === null ? '' : String(v)])
    }
    const numCell = cells.find(([f]) => f.key === 'number')
    const n = numCell ? Number(numCell[1]) : NaN
    if (!numCell || !numCell[1].trim() || !Number.isInteger(n) || n <= 0) {
      if (cells.some(([, v]) => v.trim())) errors.push(`Row ${i + 2}: no tool number.`)
      return
    }
    const at = tools.findIndex((t) => t.number === n)
    let t: Tool = at >= 0 ? tools[at] : { id: `t${n}`, number: n, type: 'router', name: `T${n}`, diameter: 0, maxDepth: 0 }
    const bad: string[] = []
    for (const [f, v] of cells) {
      if (!v.trim() || f.key === 'number') continue
      const r = parseCell(v, f, 'mm', m)
      if ('error' in r) bad.push(r.error)
      else t = withField(t, f.key, r.value)
    }
    if (at < 0 && !(t.diameter > 0 && t.maxDepth > 0)) bad.push('a new tool needs a diameter and a max depth')
    if (bad.length) {
      errors.push(`Row ${i + 2} (T${n}): ${bad.join(' ')}`)
      return
    }
    if (at >= 0) tools[at] = t
    else {
      while (tools.some((x) => x.id === t.id)) t = { ...t, id: `${t.id}x` }
      tools.push(t)
    }
  })
  const d = diffTools(m.tools, tools)
  return { tools, changes: d.changes, added: d.added, errors, ignored: [...ignored] }
}

// ---------------------------------------------------------------------------------------------
// Tool data in operations (TOOL-05)
// ---------------------------------------------------------------------------------------------

/** The tool data an operation uses now (its own feed overrides left out: they are the operation's). */
export function toolSnapshot(tool: Tool, m: MachineProfile, materialId: string | null): ToolSnapshot {
  const f = feedsFor({ feeds: {} } as CamOp, tool, materialId, m)
  const g = effectiveGauge(m, tool)
  const h = effectiveHolder(m, tool)
  const s: ToolSnapshot = { toolId: tool.id, number: tool.number, diameter: tool.diameter, maxDepth: tool.maxDepth, rpm: Math.round(f.rpm), feed: Math.round(f.feed), plunge: Math.round(f.plunge) }
  if (tool.shape) s.shape = tool.shape
  if (tool.angle !== undefined) s.angle = tool.angle
  if (tool.cornerRadius !== undefined) s.cornerRadius = tool.cornerRadius
  if (tool.fluteLength !== undefined) s.fluteLength = tool.fluteLength
  if (tool.shankDiameter !== undefined) s.shankDiameter = tool.shankDiameter
  if (Number.isFinite(g.gauge)) s.gauge = g.gauge
  if (h) s.holderId = h.id
  return s
}

export const SNAPSHOT_LABEL: Record<keyof ToolSnapshot, string> = {
  toolId: 'Tool',
  number: 'Tool number',
  diameter: 'Diameter',
  maxDepth: 'Max depth',
  shape: 'Shape',
  angle: 'V angle',
  cornerRadius: 'Corner radius',
  fluteLength: 'Flute length',
  shankDiameter: 'Shank Ø',
  gauge: 'Stick-out',
  holderId: 'Holder',
  rpm: 'Speed (rpm)',
  feed: 'Feed',
  plunge: 'Plunge feed',
}

export interface ToolDiff {
  field: keyof ToolSnapshot
  label: string
  stored: unknown
  library: unknown
}

export interface OpToolReport {
  partId: string
  partName: string
  jobId?: string
  jobName?: string
  opId: string
  opName: string
  /** The table's tool now (null: it is gone). */
  tool: Tool | null
  /** No data stored yet (calculated before M2.7, or never accepted). */
  noData: boolean
  diffs: ToolDiff[]
  /** The operation's own feed overrides, which win over the table's feeds. */
  overrides: { feed?: number; plunge?: number; rpm?: number }
}

/** Compare an operation's stored tool data with the table. */
export function compareOpTool(op: CamOp, part: CamPart, m: MachineProfile, tool: Tool | null): Omit<OpToolReport, 'partId' | 'partName' | 'jobId' | 'jobName'> {
  const overrides = Object.fromEntries(Object.entries(op.feeds).filter(([, v]) => v)) as OpToolReport['overrides']
  const base = { opId: op.id, opName: op.name, tool, overrides }
  if (!op.toolData) return { ...base, noData: true, diffs: [] }
  if (!tool) return { ...base, noData: false, diffs: [{ field: 'toolId', label: 'Tool', stored: `T${op.toolData.number}`, library: 'not in the table' }] }
  const now = toolSnapshot(tool, m, part.materialId)
  const keys = [...new Set([...Object.keys(op.toolData), ...Object.keys(now)])] as (keyof ToolSnapshot)[]
  const diffs = keys.filter((k) => JSON.stringify(op.toolData![k]) !== JSON.stringify(now[k])).map((k) => ({ field: k, label: SNAPSHOT_LABEL[k], stored: op.toolData![k], library: now[k] }))
  return { ...base, noData: false, diffs }
}

/** Every operation (in these parts) whose stored tool data differs from the table, or has none, or overrides feeds. */
export function toolDataReport(parts: { part: CamPart; jobId?: string; jobName?: string }[], m: MachineProfile, toolOf: (op: CamOp, part: CamPart) => Tool | null): OpToolReport[] {
  const out: OpToolReport[] = []
  for (const { part, jobId, jobName } of parts)
    for (const op of part.ops) {
      if (op.kind === 'code') continue
      const r = compareOpTool(op, part, m, toolOf(op, part))
      if (r.noData || r.diffs.length || Object.keys(r.overrides).length) out.push({ ...r, partId: part.id, partName: part.name, jobId, jobName })
    }
  return out
}

/**
 * Update an operation from the table on request: stores the table's data now, and (when asked)
 * drops the operation's own feed overrides. The operation goes stale when the tool changed, so its
 * toolpath is calculated again and the checks run again.
 */
export function updateOpTool<T extends CamOp>(op: T, part: CamPart, m: MachineProfile, tool: Tool | null, opt: { clearOverrides?: boolean } = {}): T {
  const next = { ...op }
  if (opt.clearOverrides) next.feeds = {}
  if (tool) next.toolData = toolSnapshot(tool, m, part.materialId)
  else delete next.toolData
  return next
}
