/**
 * Job-1: a job quote beyond board: board, edgeband, hardware and labour, then markup and sales tax.
 *
 * Every price is the shop's own entry. A price that is not entered is never taken as 0: its item is
 * "price not set" (with a Configure badge on screen), left out of the sums, and the total says it is
 * incomplete. The only built-in values are the PLACEHOLDER labour times, badged until confirmed; the
 * shop rate starts not set.
 *
 * Rounding: each item's amount is rounded to the cent (quantity as shown x price), a line is the sum
 * of its items, markup is rounded on the subtotal, sales tax is rounded on subtotal + markup.
 * Edgeband is priced per metre (stored), shown and typed per foot in an inch shop; its quantity is the
 * running length shown in the BOM (0.01 m, or 0.1 ft).
 */
import { ratePerM2 } from './areas'
import type { Unconfirmed } from './confirm'
import type { PartInstance } from './cutlist'
import type { JobNest } from './machining'
import type { AppData, Job, QuoteManualLine, UnitSystem } from './types'

export type LabourTimeKey = 'cabinet' | 'drawer' | 'door' | 'sheet'
export type LabourKey = 'shopRate' | LabourTimeKey
export const LABOUR_TIME_KEYS: LabourTimeKey[] = ['cabinet', 'drawer', 'door', 'sheet']

export interface PricingSettings {
  /** Shop rate per hour, shop currency. Absent = not set. */
  shopRate?: number
  /** Labour minutes per cabinet, drawer, door and sheet cut. Absent = the PLACEHOLDER times. */
  minutes?: Partial<Record<LabourTimeKey, number>>
  /** Labour values the shop has confirmed as shown (`labour:<key>`). */
  confirmed?: string[]
}

/** PLACEHOLDER labour times, minutes (invented round numbers, badged until the shop confirms or edits them). */
export const PLACEHOLDER_LABOUR_MINUTES: Record<LabourTimeKey, number> = { cabinet: 60, drawer: 20, door: 10, sheet: 15 }

export const LABOUR_LABEL: Record<LabourKey, string> = {
  shopRate: 'Shop rate per hour',
  cabinet: 'Labour per cabinet',
  drawer: 'Labour per drawer',
  door: 'Labour per door',
  sheet: 'Labour per sheet cut',
}

const LABOUR_ITEM: Record<LabourTimeKey, [string, string]> = {
  cabinet: ['Cabinets', 'cabinets'],
  drawer: ['Drawers', 'drawers'],
  door: ['Doors', 'doors'],
  sheet: ['Sheets cut', 'sheets'],
}

/** Round to the cent, halves away from zero (1.005 -> 1.01). */
export function round2(v: number) {
  return Math.round(v * 100 + (v >= 0 ? 1e-7 : -1e-7)) / 100
}

export const M_PER_FT = 0.3048

export function labourMinutes(p: PricingSettings | undefined): Record<LabourTimeKey, number> {
  return { ...PLACEHOLDER_LABOUR_MINUTES, ...(p?.minutes ?? {}) }
}

/** Labour values still unconfirmed: the shop rate while not set, each time while it is the placeholder and not confirmed. */
export function labourUnconfirmed(p: PricingSettings | undefined): Unconfirmed[] {
  const out: Unconfirmed[] = []
  if (p?.shopRate === undefined) out.push({ key: 'labour:shopRate', label: LABOUR_LABEL.shopRate, value: 'price not set', group: 'Pricing', target: { kind: 'labour', key: 'shopRate' } })
  const m = labourMinutes(p)
  for (const k of LABOUR_TIME_KEYS) {
    const placeholder = p?.minutes?.[k] === undefined || Math.abs(m[k] - PLACEHOLDER_LABOUR_MINUTES[k]) < 1e-9
    if (placeholder && !p?.confirmed?.includes(`labour:${k}`)) out.push({ key: `labour:${k}`, label: LABOUR_LABEL[k], value: `${m[k]} min (placeholder)`, group: 'Pricing', target: { kind: 'labour', key: k } })
  }
  return out
}

export type QuoteLineKey = 'board' | 'edgeband' | 'hardware' | 'labour'
/** Library-1: the lines typed in by hand, in the quote, the CSVs and the PDF. */
export const MANUAL_LABEL = 'Other'
export const QUOTE_LINES: QuoteLineKey[] = ['board', 'edgeband', 'hardware', 'labour']
export const QUOTE_LINE_LABEL: Record<QuoteLineKey, string> = { board: 'Board', edgeband: 'Edgeband', hardware: 'Hardware', labour: 'Labour' }

export interface QuoteItem {
  code: string
  name: string
  qty: number
  unit: string
  /** Price per unit; null = price not set. */
  price: number | null
  /** qty x price to the cent; null = price not set. */
  amount: number | null
  /** What to set for an unpriced item (the Configure badge). */
  missing?: Unconfirmed
}

export interface QuoteLine {
  key: QuoteLineKey
  label: string
  items: QuoteItem[]
  /** Sum of the priced items. */
  amount: number
  /** Items without a price. */
  unpriced: number
  /** Values in use that are placeholders (labour times), shown with Configure badges. */
  unconfirmed: Unconfirmed[]
}

/** Library-1: a line typed into the quote by hand, as quoted (its own price, taxed or not). */
export interface ManualQuoteItem extends QuoteItem {
  id: string
  taxable: boolean
}

export interface JobQuote {
  currency: string
  units: UnitSystem
  lines: QuoteLine[]
  /**
   * Library-1: the lines typed in by hand (installation, delivery...). Priced as typed: they come
   * after the markup (not marked up) and carry the sales tax only when taxable. `amount` is their
   * sum, `taxable` the sum of the taxable ones; a line without a price is left out and counted.
   */
  manual: { items: ManualQuoteItem[]; amount: number; taxable: number; unpriced: number }
  labour: { minutes: Record<LabourTimeKey, number>; counts: Record<LabourTimeKey, number>; hours: number; rate: number | null }
  subtotal: number
  markupPct: number
  markup: number
  taxPct: number
  /** Library-1: what the sales tax is on: subtotal + markup + the taxable lines typed in. */
  taxBase: number
  tax: number
  total: number
  /** Every item without a price (deduplicated by what to set). */
  unpriced: Unconfirmed[]
  complete: boolean
}

export type QuoteInput = { instances: PartInstance[]; nest: Pick<JobNest, 'sheets'>; hardware: { code: string; name: string; qty: number }[]; edgebands: { id: string; code: string; name: string; length: number }[] }

/** What the labour times are counted on: carcasses (copies counted; fillers and end panels not), drawers, doors, sheets. */
export function labourCounts(job: Pick<Job, 'cabinets'>, out: Pick<QuoteInput, 'instances' | 'nest'>): Record<LabourTimeKey, number> {
  return {
    cabinet: job.cabinets.filter((c) => !c.params.panel).reduce((n, c) => n + Math.max(1, c.qty), 0),
    drawer: out.instances.filter((i) => i.part.key.startsWith('drawer-front-')).length,
    door: out.instances.filter((i) => i.part.role === 'door').length,
    sheet: out.nest.sheets.length,
  }
}

/** The quantity of edgeband as the BOM shows it: metres to 0.01, or feet to 0.1 in an inch shop. */
export function bandQty(lengthMm: number, units: UnitSystem) {
  return units === 'in' ? Math.round((lengthMm / 304.8) * 10) / 10 : Math.round(lengthMm / 10) / 100
}

/** A band's price per unit shown (per m, or per ft in an inch shop), from the price per metre stored. */
export function bandPriceShown(perM: number | undefined, units: UnitSystem): number | undefined {
  return perM === undefined ? undefined : units === 'in' ? perM * M_PER_FT : perM
}

/** The price per metre to store from one typed per unit shown. */
export function bandPriceStored(shown: number | undefined, units: UnitSystem): number | undefined {
  return shown === undefined ? undefined : units === 'in' ? shown / M_PER_FT : shown
}

const materialMissing = (id: string, code: string, part: 'price' | 'density'): Unconfirmed => ({ key: `material:${id}:${part}`, label: `${code} ${part}`, value: 'not set', group: 'Materials', target: { kind: 'material', materialId: id, part } })
const notSet = (label: string, target: Unconfirmed['target'], key: string): Unconfirmed => ({ key, label, value: 'price not set', group: 'Pricing', target })

/** Library-1: a hand-typed line's item (its price not set until typed: never taken as 0). */
export function manualItem(l: QuoteManualLine, i: number): ManualQuoteItem {
  const qty = Number.isFinite(l.qty) ? l.qty : 0
  const price = l.unitPrice === undefined || !Number.isFinite(l.unitPrice) ? null : l.unitPrice
  return {
    id: l.id,
    code: `Line ${i + 1}`,
    name: l.description.trim() || `Line ${i + 1}`,
    qty,
    unit: 'ea',
    price,
    amount: price === null ? null : round2(qty * price),
    taxable: l.taxable,
    ...(price === null ? { missing: notSet(`${l.description.trim() || `Line ${i + 1}`}: unit price`, { kind: 'quote', key: `line:${l.id}` }, `quote:line:${l.id}`) } : {}),
  }
}

export function jobQuote(job: Pick<Job, 'cabinets' | 'quote'>, out: QuoteInput, data: Pick<AppData, 'library' | 'settings'>): JobQuote {
  const lib = data.library
  const units = data.settings.units
  const currency = data.settings.currency ?? '$'
  const pricing = data.settings.pricing
  const line = (key: QuoteLineKey, items: QuoteItem[], unconfirmed: Unconfirmed[] = []): QuoteLine => ({
    key,
    label: QUOTE_LINE_LABEL[key],
    items,
    amount: round2(items.reduce((s, i) => s + (i.amount ?? 0), 0)),
    unpriced: items.filter((i) => i.amount === null).length,
    unconfirmed,
  })

  // board: the sheets the nest uses, each at its material's price (an offcut at its own area)
  const board: QuoteItem[] = []
  for (const id of [...new Set(out.nest.sheets.map((s) => s.materialId))]) {
    const m = lib.materials.find((x) => x.id === id)
    const sheets = out.nest.sheets.filter((s) => s.materialId === id)
    const rate = ratePerM2(m)
    const area = (s: (typeof sheets)[number]) => (s.flip ? s.flip.length * s.flip.width : s.sheetLength * s.sheetWidth)
    const std = m ? m.sheetLength * m.sheetWidth : area(sheets[0])
    const price = rate === null ? null : round2((std / 1e6) * rate)
    const amount = rate === null ? null : sheets.every((s) => Math.abs(area(s) - std) < 1) ? round2(sheets.length * price!) : round2(sheets.reduce((n, s) => n + round2((area(s) / 1e6) * rate), 0))
    board.push({
      code: m?.code ?? id,
      name: m?.name ?? id,
      qty: sheets.length,
      unit: 'sheets',
      price,
      amount,
      ...(rate === null ? { missing: materialMissing(id, m?.code ?? id, m?.cost?.by === 'weight' && m.cost.price !== undefined ? 'density' : 'price') } : {}),
    })
  }

  // edgeband: the BOM's running lengths
  const unit = units === 'in' ? 'ft' : 'm'
  const bands: QuoteItem[] = out.edgebands.map((e) => {
    const b = lib.edgebands.find((x) => x.id === e.id)
    const qty = bandQty(e.length, units)
    const price = bandPriceShown(b?.price, units) ?? null
    return { code: e.code, name: e.name, qty, unit, price, amount: price === null ? null : round2(qty * price), ...(price === null ? { missing: notSet(`${e.code} price per ${unit}`, { kind: 'price', what: 'edgeband', id: e.id }, `price:edgeband:${e.id}`) } : {}) }
  })

  // hardware: every BOM line, per piece
  const hardware: QuoteItem[] = out.hardware.map((h) => {
    const row = lib.hardware.find((x) => x.code === h.code)
    const price = row?.price ?? null
    return { code: h.code, name: h.name, qty: h.qty, unit: 'pcs', price, amount: price === null ? null : round2(h.qty * price), ...(price === null ? { missing: notSet(`${h.code} price per piece`, { kind: 'price', what: 'hardware', id: row?.id ?? h.code }, `price:hardware:${row?.id ?? h.code}`) } : {}) }
  })

  // labour: time per cabinet, drawer, door and sheet at the shop rate
  const minutes = labourMinutes(pricing)
  const counts = labourCounts(job, out)
  const rate = pricing?.shopRate ?? null
  const rateMissing = notSet(LABOUR_LABEL.shopRate, { kind: 'labour', key: 'shopRate' }, 'labour:shopRate')
  const labourItems: QuoteItem[] = LABOUR_TIME_KEYS.filter((k) => counts[k] > 0).map((k) => {
    const [name, u] = LABOUR_ITEM[k]
    return { code: name, name: `${name}, ${minutes[k]} min each`, qty: counts[k], unit: u, price: rate === null ? null : (minutes[k] / 60) * rate, amount: rate === null ? null : round2(((counts[k] * minutes[k]) / 60) * rate), ...(rate === null ? { missing: rateMissing } : {}) }
  })
  const totalMinutes = LABOUR_TIME_KEYS.reduce((n, k) => n + counts[k] * minutes[k], 0)
  const lines = [line('board', board), line('edgeband', bands), line('hardware', hardware), line('labour', labourItems, labourUnconfirmed(pricing).filter((u) => u.key !== 'labour:shopRate'))]

  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0))
  const markupPct = job.quote?.markupPct ?? 0
  const taxPct = job.quote?.taxPct ?? 0
  const markup = round2((subtotal * markupPct) / 100)
  // Library-1: the lines typed in by hand, as quoted: not marked up, taxed when taxable
  const manualItems = (job.quote?.lines ?? []).map(manualItem)
  const manual = {
    items: manualItems,
    amount: round2(manualItems.reduce((n, i) => n + (i.amount ?? 0), 0)),
    taxable: round2(manualItems.filter((i) => i.taxable).reduce((n, i) => n + (i.amount ?? 0), 0)),
    unpriced: manualItems.filter((i) => i.amount === null).length,
  }
  const taxBase = round2(subtotal + markup + manual.taxable)
  const tax = round2((taxBase * taxPct) / 100)
  const unpriced = new Map<string, Unconfirmed>()
  for (const l of lines) for (const i of l.items) if (i.missing) unpriced.set(i.missing.key, i.missing)
  for (const i of manualItems) if (i.missing) unpriced.set(i.missing.key, i.missing)
  return {
    currency,
    units,
    lines,
    labour: { minutes, counts, hours: Math.round((totalMinutes / 60) * 100) / 100, rate },
    manual,
    subtotal,
    markupPct,
    markup,
    taxPct,
    taxBase,
    tax,
    total: round2(subtotal + markup + manual.amount + tax),
    unpriced: [...unpriced.values()],
    complete: unpriced.size === 0,
  }
}

/** Money for display: "$1,234.50". */
export function money(v: number, currency = '$') {
  const s = Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${v < 0 ? '-' : ''}${currency}${s}`
}

/**
 * A unit price for display, one rule for the Quote tab, the CSVs and the Quote PDF (Polish-4: a labour
 * price per door showed 8.6667): to the cent, halves up; a price under 1.00 keeps up to 4 places when
 * it has them (an edgeband at 0.035 per ft). Amounts are worked from the exact price, not this text.
 */
export function unitPrice(v: number) {
  if (Math.abs(v) >= 1 - 1e-9) return round2(v).toFixed(2)
  const r4 = Math.round(v * 10000) / 10000
  return Math.abs(r4 * 100 - Math.round(r4 * 100)) < 1e-6 ? r4.toFixed(2) : String(r4)
}

/** "price not set" text for a line: nothing priced, or some items not. */
export function lineNote(l: Pick<QuoteLine, 'items' | 'unpriced'>) {
  if (!l.unpriced) return ''
  return l.unpriced === l.items.length ? 'price not set' : `price not set for ${l.unpriced} of ${l.items.length} items`
}

/** At least one item has a price (else the quote has no amounts at all). */
export function anyPriced(q: Pick<JobQuote, 'lines'> & Partial<Pick<JobQuote, 'manual'>>) {
  return q.lines.some((l) => l.items.some((i) => i.amount !== null)) || !!q.manual?.items.some((i) => i.amount !== null)
}

export function totalNote(q: Pick<JobQuote, 'unpriced'>) {
  return q.unpriced.length ? `incomplete: ${q.unpriced.length} price${q.unpriced.length === 1 ? '' : 's'} not set` : ''
}

/**
 * The quote as a block of CSV rows (appended to the BOM and to the areas-and-costs file after a blank
 * row; the rows above it are unchanged): every item, the four line totals, markup, tax and total.
 */
export function quoteCsv(q: JobQuote): string {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const n = (v: number | null) => (v === null ? '' : v.toFixed(2))
  const rows: (string | number)[][] = [['Quote', 'Item', 'Name', 'Qty', 'Unit', `Price each ${q.currency.replace(/,/g, '')}`, 'Total', 'Note']]
  for (const l of q.lines) for (const i of l.items) rows.push([l.label, i.code, i.name, i.qty, i.unit, i.price === null ? '' : unitPrice(i.price), n(i.amount), i.amount === null ? 'price not set' : ''])
  // Library-1: the lines typed in by hand (after the markup; "no tax" on those not taxed)
  for (const i of q.manual?.items ?? []) rows.push([MANUAL_LABEL, i.code, i.name, i.qty, i.unit, i.price === null ? '' : unitPrice(i.price), n(i.amount), [i.amount === null ? 'price not set' : '', i.taxable ? '' : 'no tax'].filter(Boolean).join('; ')])
  // a line (or the whole quote) with nothing priced has no amount: "price not set", not 0.00
  for (const l of q.lines) rows.push(['Line total', l.label, l.key === 'labour' ? `${q.labour.hours} h` : '', '', '', '', l.items.length && l.unpriced === l.items.length ? '' : n(l.amount), lineNote(l)])
  const some = anyPriced(q)
  rows.push(['Subtotal', '', '', '', '', '', some ? n(q.subtotal) : '', totalNote(q)])
  rows.push(['Markup', `${q.markupPct} %`, '', '', '', '', some ? n(q.markup) : '', ''])
  if (q.manual?.items.length) rows.push(['Line total', MANUAL_LABEL, '', '', '', '', q.manual.unpriced === q.manual.items.length ? '' : n(q.manual.amount), lineNote({ items: q.manual.items, unpriced: q.manual.unpriced })])
  rows.push(['Sales tax', `${q.taxPct} %`, '', '', '', '', some ? n(q.tax) : '', ''])
  rows.push(['Total', '', '', '', '', '', some ? n(q.total) : '', totalNote(q)])
  return '\r\n' + rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n'
}
