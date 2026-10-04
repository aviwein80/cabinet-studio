/**
 * Patterns from manufacturer data. DXF and CSV give exact numbers; PDF spec sheets are read as
 * text and drafted. Everything here returns drafts: nothing reaches the library until a person
 * approves it (see approvePattern).
 */
import { nanoid } from 'nanoid'
import { importDxf } from '@/cam/dxf'
import type { FaceId, HardwarePattern, PatternHole } from '@/cam/types'
import { parseCsv, type Row } from '../library/import'

export interface PatternDraft {
  pattern: HardwarePattern
  /** Numbers found in the source, with the text they came from. */
  findings: Finding[]
  warnings: string[]
}

export interface Finding {
  label: string
  value: number
  page?: number
  quote: string
  /** Used to build a hole. */
  used: boolean
}

const MANUFACTURERS = ['Salice', 'Blum', 'Hettich', 'Grass', 'Häfele', 'Hafele', 'Accuride', 'Sugatsune', 'Knape & Vogt', 'Richelieu', 'Titus', 'Lamello', 'Kesseböhmer', 'Kessebohmer', 'Mepla']

const draftOf = (name: string, source: HardwarePattern['source'], holes: PatternHole[], extra: Partial<HardwarePattern> = {}): HardwarePattern => ({
  id: `pat-${nanoid(8)}`,
  name,
  manufacturer: '',
  anchor: 'edge-start',
  holes,
  status: 'draft',
  source,
  provenance: [],
  ...extra,
})

const round = (n: number) => Math.round(n * 1000) / 1000

function faceFromName(name: string): FaceId {
  if (/face[\s_-]?6|under|back[\s_-]?side|bottom[\s_-]?face/i.test(name)) return 6
  if (/edge|horiz|side[\s_-]?bore/i.test(name)) return 2
  return 1
}

function depthFromName(name: string): number | undefined {
  const m = /(?:depth|deep|tief|dp|(?:^|[_\s-])d|(?:^|[_\s-])t)[\s_=-]?(\d+(?:[.,]\d+)?)/i.exec(name)
  return m ? Number(m[1].replace(',', '.')) : undefined
}

// ---------------------------------------------------------------------------------------------
// DXF: every circle is a hole; layer names carry depth and face (e.g. "DRILL_D13.5", "EDGE_D12").
// The drawing origin is the pattern's insertion point.
// ---------------------------------------------------------------------------------------------

export function patternFromDxf(text: string, file: string, opts: { defaultDepth?: number; units?: 'auto' | 'mm' | 'in' } = {}): PatternDraft {
  const imp = importDxf(text, { units: opts.units ?? 'auto' })
  const warnings = [...imp.warnings]
  const holes: PatternHole[] = []
  const provenance: HardwarePattern['provenance'] = []
  const layerName = (id: string) => imp.layers.find((l) => l.id === id)?.name ?? id
  let missingDepth = 0
  for (const e of imp.entities) {
    if (e.g.t !== 'circle') continue
    const name = layerName(e.layer)
    const depth = depthFromName(name) ?? opts.defaultDepth
    if (depth === undefined) missingDepth++
    holes.push({ x: round(e.g.c.x), y: round(e.g.c.y), diameter: round(e.g.r * 2), depth: depth ?? NaN, face: faceFromName(name) })
    provenance.push({ file, note: `Circle on layer ${name}` })
  }
  if (!holes.length) warnings.push('No circles found. Draw each hole as a circle around the insertion point (0,0).')
  if (missingDepth) warnings.push(`${missingDepth} hole(s) have no depth: put it in the layer name (e.g. DRILL_D12) or enter it before approving.`)
  if (imp.counts.open + imp.counts.closed) warnings.push(`${imp.counts.open + imp.counts.closed} non-circle shape(s) ignored.`)
  const base = file.replace(/\.[^.]+$/, '')
  const pattern = draftOf(base, 'dxf', holes, { manufacturer: MANUFACTURERS.find((m) => base.toLowerCase().includes(m.toLowerCase())) ?? '', provenance: [{ file, note: `Units: ${imp.unitName}` }, ...provenance] })
  return { pattern, findings: [], warnings }
}

// ---------------------------------------------------------------------------------------------
// CSV: one row per hole. Columns: pattern, manufacturer, x, y, diameter, depth, face, units.
// ---------------------------------------------------------------------------------------------

const ALIASES: Record<string, string[]> = {
  pattern: ['pattern', 'name', 'pattern name', 'item', 'description'],
  manufacturer: ['manufacturer', 'brand', 'maker', 'make'],
  code: ['code', 'part', 'part number', 'article', 'sku'],
  x: ['x', 'x mm', 'along', 'x (mm)'],
  y: ['y', 'y mm', 'from edge', 'y (mm)'],
  diameter: ['diameter', 'dia', 'd', 'ø', 'hole diameter'],
  depth: ['depth', 'deep', 'hole depth', 'z'],
  face: ['face', 'side'],
  units: ['units', 'unit'],
}

function field(row: Row, key: string): string {
  const names = ALIASES[key]
  for (const [k, v] of Object.entries(row)) if (names.includes(k.trim().toLowerCase())) return String(v ?? '').trim()
  return ''
}

function parseFace(v: string): FaceId {
  const n = Number(v)
  if (n === 1 || n === 6) return n
  if (n >= 2 && n <= 5) return 2
  return v ? faceFromName(v) : 1
}

export function patternsFromCsv(text: string, file: string): { drafts: PatternDraft[]; errors: string[] } {
  const rows = parseCsv(text)
  const errors: string[] = []
  const groups = new Map<string, { manufacturer: string; code: string; holes: PatternHole[]; lines: number[] }>()
  rows.forEach((row, i) => {
    const line = i + 2
    const name = field(row, 'pattern') || file.replace(/\.[^.]+$/, '')
    const inch = /^(in|inch|inches|")$/i.test(field(row, 'units'))
    const num = (k: string) => {
      const s = field(row, k).replace(',', '.')
      return s === '' ? NaN : Number(s) * (inch ? 25.4 : 1)
    }
    const h: PatternHole = { x: round(num('x')), y: round(num('y')), diameter: round(num('diameter')), depth: round(num('depth')), face: parseFace(field(row, 'face')) }
    if (![h.x, h.y, h.diameter].every(Number.isFinite)) {
      errors.push(`Line ${line}: needs x, y and diameter numbers.`)
      return
    }
    const g = groups.get(name) ?? { manufacturer: field(row, 'manufacturer'), code: field(row, 'code'), holes: [], lines: [] }
    g.holes.push(h)
    g.lines.push(line)
    groups.set(name, g)
  })
  const drafts = [...groups].map(([name, g]) => {
    const warnings = g.holes.some((h) => !Number.isFinite(h.depth)) ? ['Some holes have no depth; enter it before approving.'] : []
    return { pattern: draftOf(name, 'csv', g.holes, { manufacturer: g.manufacturer, notes: g.code ? `Part ${g.code}` : undefined, provenance: [{ file, note: `CSV lines ${g.lines.join(', ')}` }] }), findings: [], warnings }
  })
  if (!rows.length) errors.push('The file has no rows.')
  return { drafts, errors }
}

// ---------------------------------------------------------------------------------------------
// PDF spec sheets
// ---------------------------------------------------------------------------------------------

export interface TextPage {
  page: number
  lines: string[]
}

interface TextLib {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean; useWorkerFetch?: boolean }): { promise: Promise<{ numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }> }> }
}

/** Text lines per page (items grouped by baseline, left to right). */
export async function pdfTextPages(lib: TextLib, data: Uint8Array, maxPages = 12): Promise<TextPage[]> {
  const doc = await lib.getDocument({ data, isEvalSupported: false, useWorkerFetch: false }).promise
  const out: TextPage[] = []
  for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
    const page = await doc.getPage(n)
    const { items } = await page.getTextContent()
    const rows: { y: number; parts: { x: number; s: string }[] }[] = []
    for (const it of items as { str?: string; transform?: number[] }[]) {
      if (!it.str?.trim() || !it.transform) continue
      const x = it.transform[4]
      const y = it.transform[5]
      const row = rows.find((r) => Math.abs(r.y - y) < 2.5)
      if (row) row.parts.push({ x, s: it.str })
      else rows.push({ y, parts: [{ x, s: it.str }] })
    }
    rows.sort((a, b) => b.y - a.y)
    out.push({
      page: n,
      lines: rows.map((r) =>
        r.parts
          .sort((a, b) => a.x - b.x)
          .map((p) => p.s.trim())
          .join(' ')
          .replace(/\s+/g, ' '),
      ),
    })
  }
  return out
}

/** Something that turns spec-sheet text into a draft pattern. */
export interface PatternDrafter {
  id: string
  label: string
  draft(pages: TextPage[], file: string): Promise<PatternDraft>
}

const NUM = String.raw`(\d+(?:[.,]\d+)?)`
const n = (s: string) => Number(s.replace(',', '.'))

interface Hit {
  label: string
  value: number
  page: number
  quote: string
}

function scan(pages: TextPage[]) {
  const hits: Record<string, Hit[]> = { diameter: [], depth: [], edge: [], spacing: [], setback: [], positions: [], line: [] }
  const add = (k: string, label: string, value: number, page: number, quote: string) => {
    if (!Number.isFinite(value) || value <= 0 || value > 3000) return
    if (!hits[k].some((h) => h.value === value)) hits[k].push({ label, value, page, quote })
  }
  for (const { page, lines } of pages)
    for (const raw of lines) {
      const line = raw.replace(/[⌀øΦφ]/g, 'Ø')
      const quote = raw.trim().slice(0, 160)
      for (const m of line.matchAll(new RegExp(String.raw`Ø\s*${NUM}(?:\s*mm)?(?:\s*[x×]\s*${NUM})?`, 'g'))) {
        add('diameter', 'Hole diameter', n(m[1]), page, quote)
        if (m[2]) add('depth', `Depth for Ø${n(m[1])}`, n(m[2]), page, quote)
      }
      for (const m of line.matchAll(new RegExp(String.raw`(?:diameter|dia\.?)\s*(?:of\s*)?[:=]?\s*${NUM}`, 'gi'))) add('diameter', 'Hole diameter', n(m[1]), page, quote)
      for (const m of line.matchAll(new RegExp(String.raw`(?:depth|deep)\s*(?:of\s*)?[:=]?\s*${NUM}|${NUM}\s*mm\s*deep`, 'gi'))) add('depth', 'Depth', n(m[1] ?? m[2]), page, quote)
      for (const m of line.matchAll(new RegExp(String.raw`(?:\bK\s*=\s*|boring distance(?: from the (?:door )?edge)?\s*[:=]?\s*|from (?:the )?(?:door )?edge\s*[:=]?\s*|edge distance\s*[:=]?\s*)${NUM}`, 'gi'))) add('edge', 'Distance from the edge (K)', n(m[1]), page, quote)
      for (const m of line.matchAll(new RegExp(String.raw`(?:spacing|pitch|apart|hole distance|centre to centre|center to center)\s*(?:of\s*)?[:=]?\s*${NUM}|${NUM}\s*mm\s*(?:apart|spacing|on centers?|on centres?)`, 'gi'))) add('spacing', 'Hole spacing', n(m[1] ?? m[2]), page, quote)
      for (const m of line.matchAll(new RegExp(String.raw`(?:setback|set back|back from (?:the )?front(?: edge)?)\s*[:=]?\s*${NUM}|${NUM}\s*mm\s*(?:setback|back from (?:the )?front)`, 'gi'))) add('setback', 'Setback from the front edge', n(m[1] ?? m[2]), page, quote)
      for (const m of line.matchAll(new RegExp(String.raw`${NUM}\s*mm\s*(?:above|from|up from)\s*(?:the\s*)?(?:bottom|base)`, 'gi'))) add('line', 'Height of the hole line', n(m[1]), page, quote)
      const list = new RegExp(String.raw`((?:${NUM}\s*(?:mm)?\s*(?:,|and|&|/)\s*)+${NUM})\s*(?:mm)?\s*(?:from (?:the )?(?:cabinet )?front|from front edge)`, 'i').exec(line)
      if (list) for (const v of list[1].split(/,|and|&|\//)) add('positions', 'Position along the edge', n(v.replace(/mm/i, '').trim()), page, quote)
    }
  return hits
}

/**
 * Built-in drafter: reads labelled numbers (Ø, depth, K, spacing, setback, positions from the
 * front, hole-line height) and builds the likely pattern. Unknown values stay empty for the
 * reviewer. It never guesses a number that is not in the text.
 */
export const textDrafter: PatternDrafter = {
  id: 'text',
  label: 'Built-in sheet reader (offline)',
  async draft(pages, file) {
    const hits = scan(pages)
    const warnings: string[] = []
    const findings: Finding[] = Object.values(hits).flatMap((list) => list.map((h) => ({ ...h, used: false })))
    const use = (h: Hit | undefined) => {
      if (!h) return NaN
      const f = findings.find((q) => q.label === h.label && q.value === h.value && q.quote === h.quote)
      if (f) f.used = true
      return h.value
    }
    const all = pages.flatMap((p) => p.lines).join(' ')
    const manufacturer = MANUFACTURERS.find((m) => all.toLowerCase().includes(m.toLowerCase())) ?? ''
    const title = pages[0]?.lines.find((l) => /[a-z]{3}/i.test(l) && l.length < 90) ?? file.replace(/\.[^.]+$/, '')
    const dias = [...hits.diameter].sort((a, b) => b.value - a.value)
    const cup = dias.find((d) => d.value >= 20)
    const small = dias.find((d) => d.value < 20)
    const depthFor = (d: number) => hits.depth.find((h) => h.label === `Depth for Ø${d}`) ?? hits.depth.find((h) => h.label === 'Depth')
    const holes: PatternHole[] = []
    if (cup) {
      const k = hits.edge[0]
      const cupY = Number.isFinite(use(k)) ? k!.value + cup.value / 2 : NaN
      holes.push({ x: 0, y: round(cupY), diameter: use(cup), depth: use(depthFor(cup.value)), face: 1 })
      if (!k) warnings.push('No edge distance (K) found for the cup: enter the cup centre from the edge.')
      if (small && hits.spacing[0]) {
        const s = use(hits.spacing[0])
        for (const sx of [-s / 2, s / 2]) holes.push({ x: round(sx), y: NaN, diameter: use(small), depth: use(depthFor(small.value)), face: 1 })
        warnings.push('Cup screw or dowel holes found: enter their distance from the edge.')
      }
    } else if (small) {
      const d = use(small)
      const depth = use(depthFor(small.value))
      const y = hits.line[0] ? use(hits.line[0]) : hits.setback[0] ? use(hits.setback[0]) : NaN
      if (hits.positions.length >= 2) for (const p of hits.positions) holes.push({ x: use(p), y, diameter: d, depth, face: 1 })
      else if (hits.spacing[0]) {
        const s = use(hits.spacing[0])
        for (const sx of [-s / 2, s / 2]) holes.push({ x: round(sx), y, diameter: d, depth, face: 1 })
      } else holes.push({ x: 0, y, diameter: d, depth, face: 1 })
      if (!Number.isFinite(y)) warnings.push('No distance from the reference edge found: enter y for each hole.')
    } else warnings.push('No hole diameters found in the text. The sheet may be a scan or a drawing without text; enter the holes by hand.')
    if (holes.some((h) => !Number.isFinite(h.depth))) warnings.push('No depth found for some holes.')
    if (/\b\d+\s*\/\s*\d+\s*(?:"|in)/.test(all)) warnings.push('The sheet has inch fractions; only millimetre values were read.')
    const provenance = findings.filter((f) => f.used).map((f) => ({ file, page: f.page, quote: f.quote, note: `${f.label}: ${f.value}` }))
    return { pattern: draftOf(title, 'pdf-draft', holes, { manufacturer, provenance }), findings, warnings }
  },
}

export const DRAFTERS: PatternDrafter[] = [textDrafter]
