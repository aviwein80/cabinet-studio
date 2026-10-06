/**
 * Areas and costs of a nest (M2.8, NEW-20).
 *
 * Areas: each part's true area (outline less its through openings), and per sheet the area under
 * parts, in remnant strips worth keeping, and the rest (scrap: edge trim, gaps, small leftovers).
 * Sheet = parts + remnants + scrap, exactly.
 *
 * Costs: a material is costed per m² of sheet, or per kg with its density; both come down to one
 * rate per m² of sheet. A sheet costs its whole area (an offcut its own area); the parts, remnants
 * and scrap split that cost by area. A part's "share of the sheet" spreads the sheet's cost, less
 * the value of the remnants kept, over the parts on it by area. Prices are the shop's own: with no
 * price entered nothing is costed (no invented prices).
 */
import type { PartInstance } from './cutlist'
import { polygonArea } from './geometry'
import type { JobNest } from './machining'
import type { Library, Material, UnitSystem } from './types'
import type { Unconfirmed } from './confirm'

const MM2_PER_M2 = 1e6
const MM2_PER_FT2 = 304.8 * 304.8

export interface PartArea {
  uid: string
  no: number
  /** True area, mm²: the outline less its through openings. */
  area: number
  /** Cut rectangle, mm². */
  rectArea: number
}

export interface SheetAreas {
  index: number
  materialId: string
  /** Whole sheet (or offcut), mm². */
  sheetArea: number
  partsArea: number
  remnantArea: number
  /** Sheet less parts less remnants, mm². */
  scrapArea: number
  parts: number
  /** Parts area / sheet area, percent. */
  partsPct: number
}

/** True area of a part instance, mm². */
export function instanceArea(i: Pick<PartInstance, 'outline' | 'holes' | 'cutLength' | 'cutWidth'>) {
  const outer = i.outline.length >= 3 ? Math.abs(polygonArea(i.outline)) : i.cutLength * i.cutWidth
  return outer - (i.holes ?? []).reduce((s, h) => s + Math.abs(polygonArea(h)), 0)
}

export function nestAreas(nest: JobNest, instances: PartInstance[]): { sheets: SheetAreas[]; parts: Map<string, PartArea> } {
  const byUid = new Map(instances.map((i) => [i.uid, i]))
  const parts = new Map<string, PartArea>()
  for (const i of instances) parts.set(i.uid, { uid: i.uid, no: i.no, area: instanceArea(i), rectArea: i.cutLength * i.cutWidth })
  const sheets = nest.sheets.map((sh) => {
    const sheetArea = sh.sheetLength * sh.sheetWidth
    const partsArea = sh.placements.reduce((s, p) => s + (byUid.has(p.uid) ? parts.get(p.uid)!.area : p.dx * p.dy), 0)
    const remnantArea = (sh.remnants ?? []).reduce((s, r) => s + r.length * r.width, 0)
    return {
      index: sh.index,
      materialId: sh.materialId,
      sheetArea,
      partsArea,
      remnantArea,
      scrapArea: sheetArea - partsArea - remnantArea,
      parts: sh.placements.length,
      partsPct: sheetArea > 0 ? (partsArea / sheetArea) * 100 : 0,
    }
  })
  return { sheets, parts }
}

/** Cost per m² of sheet, or null while the price (or, by weight, the density) is not set. */
export function ratePerM2(m: Pick<Material, 'cost' | 'thickness'> | undefined): number | null {
  const c = m?.cost
  if (!c || c.price === undefined || !(c.price >= 0)) return null
  if (c.by === 'area') return c.price
  if (!c.density || !(c.density > 0)) return null
  return c.price * c.density * (m!.thickness / 1000)
}

/** Weight per m² of sheet (kg), or null without a density. */
export function kgPerM2(m: Pick<Material, 'cost' | 'thickness'> | undefined): number | null {
  const d = m?.cost?.density
  return d && d > 0 ? d * (m!.thickness / 1000) : null
}

export interface SheetCost extends SheetAreas {
  /** Null when the material has no price. */
  sheetCost: number | null
  partsCost: number | null
  remnantValue: number | null
  scrapCost: number | null
  /** kg, null without a density. */
  sheetWeight: number | null
}

export interface PartCost extends PartArea {
  materialId: string
  /** Material in the part: area x rate. */
  cost: number | null
  /** The part's share of its sheet's cost less the remnants kept, by area. */
  share: number | null
  weight: number | null
}

export interface JobCosts {
  sheets: SheetCost[]
  parts: PartCost[]
  /** Totals over the sheets that could be costed. */
  total: { sheetArea: number; partsArea: number; remnantArea: number; scrapArea: number; sheetCost: number; partsCost: number; remnantValue: number; scrapCost: number; weight: number }
  /** Materials used by the nest whose cost cannot be worked out (no price, or no density by weight). */
  missing: string[]
}

export function jobCosts(nest: JobNest, instances: PartInstance[], lib: Pick<Library, 'materials'>): JobCosts {
  const { sheets: areas, parts: partAreas } = nestAreas(nest, instances)
  const mat = (id: string) => lib.materials.find((m) => m.id === id)
  const m2 = (a: number) => a / MM2_PER_M2
  const sheets: SheetCost[] = areas.map((a) => {
    const rate = ratePerM2(mat(a.materialId))
    const kg = kgPerM2(mat(a.materialId))
    const c = (area: number) => (rate === null ? null : m2(area) * rate)
    return { ...a, sheetCost: c(a.sheetArea), partsCost: c(a.partsArea), remnantValue: c(a.remnantArea), scrapCost: c(a.scrapArea), sheetWeight: kg === null ? null : m2(a.sheetArea) * kg }
  })
  const parts: PartCost[] = []
  for (const sh of nest.sheets) {
    const sc = sheets.find((s) => s.index === sh.index)!
    const rate = ratePerM2(mat(sh.materialId))
    const kg = kgPerM2(mat(sh.materialId))
    for (const pl of sh.placements) {
      const pa = partAreas.get(pl.uid)
      if (!pa) continue
      parts.push({
        ...pa,
        materialId: sh.materialId,
        cost: rate === null ? null : m2(pa.area) * rate,
        share: sc.sheetCost === null || sc.partsArea <= 0 ? null : ((sc.sheetCost - sc.remnantValue!) * pa.area) / sc.partsArea,
        weight: kg === null ? null : m2(pa.area) * kg,
      })
    }
  }
  parts.sort((a, b) => a.no - b.no)
  const sum = (f: (s: SheetCost) => number | null) => sheets.reduce((n, s) => n + (f(s) ?? 0), 0)
  const missing = [...new Set(nest.sheets.map((s) => s.materialId))].filter((id) => ratePerM2(mat(id)) === null)
  return {
    sheets,
    parts,
    total: {
      sheetArea: sum((s) => s.sheetArea),
      partsArea: sum((s) => s.partsArea),
      remnantArea: sum((s) => s.remnantArea),
      scrapArea: sum((s) => s.scrapArea),
      sheetCost: sum((s) => s.sheetCost),
      partsCost: sum((s) => s.partsCost),
      remnantValue: sum((s) => s.remnantValue),
      scrapCost: sum((s) => s.scrapCost),
      weight: sum((s) => s.sheetWeight),
    },
    missing,
  }
}

/** Area for display: m² in millimetre mode, ft² in inch mode. */
export function formatArea(mm2: number, units: UnitSystem) {
  return units === 'in' ? `${(mm2 / MM2_PER_FT2).toFixed(2)} ft²` : `${(mm2 / MM2_PER_M2).toFixed(3)} m²`
}

export function formatMoney(v: number | null, currency = '$') {
  return v === null ? '—' : `${currency}${v.toFixed(2)}`
}

/** Material cost values not entered yet (each opens the material's cost field). */
export function materialUnconfirmed(lib: Pick<Library, 'materials'>, ids?: Iterable<string>): Unconfirmed[] {
  const want = ids ? new Set(ids) : null
  const out: Unconfirmed[] = []
  for (const m of lib.materials) {
    if (want && !want.has(m.id)) continue
    const c = m.cost
    if (!c || c.price === undefined) out.push({ key: `material:${m.id}:price`, label: `${m.code} price`, value: 'not set', group: 'Materials', target: { kind: 'material', materialId: m.id, part: 'price' } })
    if (c?.by === 'weight' && !(c.density && c.density > 0)) out.push({ key: `material:${m.id}:density`, label: `${m.code} density`, value: 'not set', group: 'Materials', target: { kind: 'material', materialId: m.id, part: 'density' } })
  }
  return out
}

/** Areas and costs as CSV (one row per sheet, then one per part, then the job total). */
export function areasCsv(costs: JobCosts, instances: PartInstance[], lib: Pick<Library, 'materials'>, currency = '$') {
  const code = (id: string) => lib.materials.find((m) => m.id === id)?.code ?? id
  const n = (v: number | null, d = 2) => (v === null ? '' : v.toFixed(d))
  const a = (mm2: number) => (mm2 / MM2_PER_M2).toFixed(4)
  const lines = [`Row,Sheet or part,Material,Area m2,Parts m2,Remnant m2,Scrap m2,Cost ${currency.replace(/,/g, '')},Parts cost,Remnant value,Scrap cost,Weight kg`]
  for (const s of costs.sheets)
    lines.push(['Sheet', s.index, code(s.materialId), a(s.sheetArea), a(s.partsArea), a(s.remnantArea), a(s.scrapArea), n(s.sheetCost), n(s.partsCost), n(s.remnantValue), n(s.scrapCost), n(s.sheetWeight, 1)].join(','))
  const byUid = new Map(instances.map((i) => [i.uid, i]))
  for (const p of costs.parts) {
    const inst = byUid.get(p.uid)
    lines.push(['Part', `"#${p.no} ${(inst?.part.name ?? '').replace(/"/g, '""')}"`, code(p.materialId), a(p.area), '', '', '', n(p.cost), n(p.share), '', '', n(p.weight, 2)].join(','))
  }
  const t = costs.total
  lines.push(['Total', '', '', a(t.sheetArea), a(t.partsArea), a(t.remnantArea), a(t.scrapArea), n(t.sheetCost), n(t.partsCost), n(t.remnantValue), n(t.scrapCost), n(t.weight, 1)].join(','))
  return lines.join('\r\n') + '\r\n'
}
