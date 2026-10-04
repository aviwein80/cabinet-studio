import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { BASE_PARAMS, BUILTIN_TEMPLATES } from '../defaults'
import type {
  BackType,
  BottomJoint,
  CabinetKind,
  CabinetTemplate,
  EdgeBand,
  Hardware,
  HardwareCategory,
  Joinery,
  Library,
  Material,
  Tool,
  ToolType,
} from '../types'

export type ImportKind = 'materials' | 'edgebands' | 'hardware' | 'templates' | 'tools'

export interface ImportResult<T> {
  kind: ImportKind
  items: T[]
  added: number
  updated: number
  errors: string[]
}

export type Row = Record<string, unknown>

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

const ALIASES: Record<string, string[]> = {
  code: ['code', 'sku', 'materialcode', 'partcode', 'item', 'itemcode'],
  name: ['name', 'description', 'desc', 'title'],
  thickness: ['thickness', 't', 'thk', 'thick', 'thicknessmm'],
  sheetLength: ['sheetlength', 'length', 'l', 'lengthmm', 'sheetl'],
  sheetWidth: ['sheetwidth', 'width', 'w', 'widthmm', 'sheetw'],
  grain: ['grain', 'hasgrain', 'grained', 'direction'],
  color: ['color', 'colour', 'hex', 'rgb'],
  category: ['category', 'type', 'group'],
  number: ['number', 'tno', 'tool', 'toolnumber', 'toolno', 't'],
  diameter: ['diameter', 'dia', 'd', 'diametermm'],
  maxDepth: ['maxdepth', 'depth', 'cuttinglength', 'maxdepthmm'],
  kind: ['kind', 'cabinettype', 'type'],
  height: ['height', 'h'],
  depth: ['depth'],
  shelves: ['shelves', 'shelfcount'],
  doors: ['doors', 'doorcount'],
  material: ['material', 'carcassmaterial', 'carcass'],
  backMaterial: ['backmaterial', 'back'],
  joinery: ['joinery', 'connector'],
  bottomJoint: ['bottomjoint', 'bottom'],
  backType: ['backtype', 'backconstruction'],
  description: ['description', 'notes'],
}

function get(row: Row, key: string, ...extra: string[]): unknown {
  const names = new Set([...(ALIASES[key] ?? [key]), ...extra].map(norm))
  for (const [k, v] of Object.entries(row)) if (names.has(norm(k))) return v
  return undefined
}

function str(v: unknown) {
  return v === undefined || v === null ? '' : String(v).trim()
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.').trim())
  return Number.isFinite(n) ? n : null
}

function bool(v: unknown) {
  const s = str(v).toLowerCase()
  return ['1', 'yes', 'y', 'true', 'x', 'length', 'l', 'long'].includes(s)
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export function parseCsv(text: string): Row[] {
  const res = Papa.parse<Row>(text.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: 'greedy', dynamicTyping: false, delimitersToGuess: [',', ';', '\t', '|'] })
  return res.data
}

export function parseXlsx(data: ArrayBuffer | Uint8Array): Row[] {
  const wb = XLSX.read(data, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json<Row>(ws, { defval: '' })
}

export function rowsFromFile(fileName: string, data: ArrayBuffer | Uint8Array | string): Row[] {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    if (typeof data === 'string') throw new Error('XLSX must be read as binary')
    return parseXlsx(data)
  }
  const text = typeof data === 'string' ? data : new TextDecoder('utf-8').decode(data)
  if (lower.endsWith('.json')) {
    const parsed = JSON.parse(text) as unknown
    if (Array.isArray(parsed)) return parsed as Row[]
    throw new Error('JSON import expects an array of rows, or use "Import library bundle".')
  }
  return parseCsv(text)
}

export function guessKind(rows: Row[]): ImportKind {
  const keys = new Set(Object.keys(rows[0] ?? {}).map(norm))
  const has = (k: string) => (ALIASES[k] ?? [k]).some((a) => keys.has(norm(a)))
  if (has('diameter')) return 'tools'
  if (has('height') && (has('shelves') || has('doors'))) return 'templates'
  if (keys.has('category')) return 'hardware'
  if (has('sheetLength') && has('sheetWidth')) return 'materials'
  if (has('thickness') && has('width')) return 'edgebands'
  return 'materials'
}

function upsert<T extends { id: string; code?: string }>(existing: T[], incoming: T[], keyOf: (t: T) => string) {
  const out = [...existing]
  let added = 0
  let updated = 0
  for (const item of incoming) {
    const idx = out.findIndex((e) => keyOf(e).toLowerCase() === keyOf(item).toLowerCase())
    if (idx >= 0) {
      out[idx] = { ...out[idx], ...item, id: out[idx].id }
      updated++
    } else {
      out.push(item)
      added++
    }
  }
  return { items: out, added, updated }
}

export function importMaterials(rows: Row[], existing: Material[]): ImportResult<Material> {
  const errors: string[] = []
  const incoming: Material[] = []
  rows.forEach((r, i) => {
    const code = str(get(r, 'code'))
    const thickness = num(get(r, 'thickness'))
    const L = num(get(r, 'sheetLength'))
    const W = num(get(r, 'sheetWidth'))
    if (!code) return errors.push(`Row ${i + 2}: missing code`)
    if (!thickness || thickness <= 0) return errors.push(`Row ${i + 2} (${code}): invalid thickness`)
    if (!L || !W) return errors.push(`Row ${i + 2} (${code}): invalid sheet size`)
    incoming.push({
      id: `mat-${slug(code)}`,
      code,
      name: str(get(r, 'name')) || code,
      thickness,
      sheetLength: Math.max(L, W),
      sheetWidth: Math.min(L, W),
      grain: bool(get(r, 'grain')),
      color: /^#?[0-9a-f]{6}$/i.test(str(get(r, 'color'))) ? '#' + str(get(r, 'color')).replace('#', '') : '#d8d2c4',
    })
  })
  return { kind: 'materials', ...upsert(existing, incoming, (m) => m.code), errors }
}

export function importEdgebands(rows: Row[], existing: EdgeBand[]): ImportResult<EdgeBand> {
  const errors: string[] = []
  const incoming: EdgeBand[] = []
  rows.forEach((r, i) => {
    const code = str(get(r, 'code'))
    const t = num(get(r, 'thickness'))
    if (!code) return errors.push(`Row ${i + 2}: missing code`)
    if (t === null || t < 0 || t > 5) return errors.push(`Row ${i + 2} (${code}): invalid thickness`)
    incoming.push({
      id: `eb-${slug(code)}`,
      code,
      name: str(get(r, 'name')) || code,
      thickness: t,
      width: num(get(r, 'width', 'sheetwidth')) ?? 22,
      color: /^#?[0-9a-f]{6}$/i.test(str(get(r, 'color'))) ? '#' + str(get(r, 'color')).replace('#', '') : '#eeeeee',
    })
  })
  return { kind: 'edgebands', ...upsert(existing, incoming, (m) => m.code), errors }
}

const HW_CATS: HardwareCategory[] = ['shelf-pin', 'hinge', 'mounting-plate', 'connector', 'dowel', 'screw', 'leg', 'slide', 'other']

export function importHardware(rows: Row[], existing: Hardware[]): ImportResult<Hardware> {
  const errors: string[] = []
  const incoming: Hardware[] = []
  rows.forEach((r, i) => {
    const code = str(get(r, 'code'))
    if (!code) return errors.push(`Row ${i + 2}: missing code`)
    const cat = str(get(r, 'category')).toLowerCase() as HardwareCategory
    incoming.push({ id: `hw-${slug(code)}`, code, name: str(get(r, 'name')) || code, category: HW_CATS.includes(cat) ? cat : 'other' })
  })
  return { kind: 'hardware', ...upsert(existing, incoming, (m) => m.code), errors }
}

const TOOL_TYPES: Record<string, ToolType> = {
  router: 'router',
  mill: 'router',
  cutter: 'router',
  fraeser: 'router',
  drill: 'drill-vertical',
  'drill-vertical': 'drill-vertical',
  vertical: 'drill-vertical',
  'drill-horizontal': 'drill-horizontal',
  horizontal: 'drill-horizontal',
  saw: 'saw',
}

export function importTools(rows: Row[], existing: Tool[]): ImportResult<Tool> {
  const errors: string[] = []
  const incoming: Tool[] = []
  rows.forEach((r, i) => {
    const n = num(get(r, 'number'))
    const dia = num(get(r, 'diameter'))
    const type = TOOL_TYPES[str(get(r, 'category', 'type')).toLowerCase()]
    if (n === null) return errors.push(`Row ${i + 2}: missing tool number`)
    if (!dia || dia <= 0) return errors.push(`Row ${i + 2} (T${n}): invalid diameter`)
    if (!type) return errors.push(`Row ${i + 2} (T${n}): type must be router, drill-vertical, drill-horizontal or saw`)
    incoming.push({
      id: `t${n}`,
      number: n,
      type,
      name: str(get(r, 'name')) || `T${n}`,
      diameter: dia,
      maxDepth: num(get(r, 'maxDepth')) ?? 30,
    })
  })
  const res = upsert(existing, incoming, (t) => String(t.number))
  return { kind: 'tools', ...res, errors }
}

export function importTemplates(rows: Row[], existing: CabinetTemplate[], lib: Library): ImportResult<CabinetTemplate> {
  const errors: string[] = []
  const incoming: CabinetTemplate[] = []
  const matByCode = (code: string) => lib.materials.find((m) => m.code.toLowerCase() === code.toLowerCase())
  rows.forEach((r, i) => {
    const name = str(get(r, 'name'))
    if (!name) return errors.push(`Row ${i + 2}: missing name`)
    const kind = (str(get(r, 'kind')).toLowerCase() || 'base') as CabinetKind
    if (!['base', 'wall', 'tall'].includes(kind)) return errors.push(`Row ${i + 2} (${name}): kind must be base, wall or tall`)
    const seed = BUILTIN_TEMPLATES.find((t) => t.params.kind === kind)?.params ?? BASE_PARAMS
    const params = JSON.parse(JSON.stringify(seed)) as typeof BASE_PARAMS
    params.kind = kind
    if (kind === 'tall') {
      params.top = 'full'
      params.height = 2100
    }
    const w = num(get(r, 'width'))
    const h = num(get(r, 'height'))
    const dpt = num(get(r, 'depth'))
    if (w) params.width = w
    if (h) params.height = h
    if (dpt) params.depth = dpt
    const sh = num(get(r, 'shelves'))
    if (sh !== null) params.shelves.count = Math.max(0, Math.round(sh))
    const dr = num(get(r, 'doors'))
    if (dr !== null) params.doors.count = Math.max(0, Math.min(2, Math.round(dr))) as 0 | 1 | 2
    const mc = str(get(r, 'material'))
    if (mc) {
      const m = matByCode(mc)
      if (!m) return errors.push(`Row ${i + 2} (${name}): unknown material code ${mc}`)
      params.carcassMaterialId = m.id
      params.doorMaterialId = m.id
    }
    const bc = str(get(r, 'backMaterial'))
    if (bc) {
      const m = matByCode(bc)
      if (!m) return errors.push(`Row ${i + 2} (${name}): unknown back material code ${bc}`)
      params.backMaterialId = m.id
    }
    const j = str(get(r, 'joinery')).toLowerCase()
    if (j) {
      if (!['dowel', 'confirmat', 'screw', 'none'].includes(j)) return errors.push(`Row ${i + 2} (${name}): unknown joinery ${j}`)
      params.joinery = j as Joinery
    }
    const bj = str(get(r, 'bottomJoint')).toLowerCase()
    if (bj) {
      if (!['dado', 'butt'].includes(bj)) return errors.push(`Row ${i + 2} (${name}): bottom joint must be dado or butt`)
      params.bottomJoint = bj as BottomJoint
    }
    const bt = str(get(r, 'backType')).toLowerCase()
    if (bt) {
      if (!['groove', 'rabbet', 'applied'].includes(bt)) return errors.push(`Row ${i + 2} (${name}): back type must be groove, rabbet or applied`)
      params.back.type = bt as BackType
    }
    incoming.push({
      id: `tpl-${slug(name)}`,
      name,
      description: str(get(r, 'description')) || `Imported ${kind} cabinet`,
      generator: 'carcass',
      params,
    })
  })
  return { kind: 'templates', ...upsert(existing, incoming, (t) => t.name), errors }
}

/** Full library bundle (exported from the app) - merged by code / name. */
export function importLibraryBundle(json: string, lib: Library) {
  const data = JSON.parse(json) as Partial<Library>
  const merge = <T extends { id: string }>(a: T[], b: T[] | undefined, key: (t: T) => string) => (b ? upsert(a as never[], b as never[], key as never).items : a) as T[]
  return {
    materials: merge(lib.materials, data.materials, (m) => m.code),
    edgebands: merge(lib.edgebands, data.edgebands, (m) => m.code),
    hardware: merge(lib.hardware, data.hardware, (m) => m.code),
    templates: merge(lib.templates, data.templates, (t) => t.name),
  } satisfies Library
}
