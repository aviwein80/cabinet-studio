/**
 * Library hardware from a manufacturer's sheet (PDF, scan or photo): a vision model drafts the
 * drilling pattern and the item's data. Everything is a draft until a named person ticks that
 * they checked it; then the pattern and (optionally) a new library row are saved together.
 */
import { nanoid } from 'nanoid'
import type { FaceId, HardwarePattern, PatternHole } from '@/cam/types'
import type { Hardware, HardwareCategory, Library } from '../types'
import { type AiProviderId, type AiTransport, type PageImage, providerInfo } from '../hardware/aiProviders'
import type { Cite, Finding, ItemDraft, PatternDraft, PatternDrafter, TextPage } from '../hardware/patternImport'
import { approvePattern, patternIssues, type Review, savePattern } from '../hardware/patterns'
import { CITE_RULES, citeOf, cnum, ctext, hasText, modelJson, strings } from './cite'

export type HoleKey = 'x' | 'y' | 'diameter' | 'depth'
export type HoleCites = Partial<Record<HoleKey, Cite>>

export const HW_CATEGORIES: HardwareCategory[] = ['hinge', 'mounting-plate', 'shelf-pin', 'slide', 'handle', 'connector', 'dowel', 'screw', 'leg', 'other']

/** Item fields a sheet can give, with the label shown in the review dialog. */
export const ITEM_FIELDS: { key: keyof Hardware; label: string; for: HardwareCategory[] }[] = [
  { key: 'cupDiameter', label: 'Cup diameter', for: ['hinge'] },
  { key: 'cupDepth', label: 'Cup depth', for: ['hinge'] },
  { key: 'cupCentre', label: 'Cup centre from door edge', for: ['hinge'] },
  { key: 'plateHeight', label: 'Plate height H', for: ['mounting-plate'] },
  { key: 'plateSetback', label: 'Screws back from the front', for: ['mounting-plate'] },
  { key: 'plateSpacing', label: 'Screw spacing', for: ['mounting-plate'] },
  { key: 'slideLength', label: 'Runner length', for: ['slide'] },
  { key: 'minCabinetDepth', label: 'Smallest cabinet depth', for: ['slide'] },
  { key: 'holeDiameter', label: 'Screw / hole diameter', for: ['mounting-plate', 'slide', 'shelf-pin', 'handle', 'connector', 'dowel', 'screw', 'leg', 'other'] },
  { key: 'holeDepth', label: 'Screw / hole depth', for: ['mounting-plate', 'slide', 'shelf-pin', 'handle', 'connector', 'dowel', 'screw', 'leg', 'other'] },
]

export const HARDWARE_PROMPT = `You read cabinet hardware spec sheets (hinges, mounting plates, drawer runners, shelf pins, handles, connectors). The pages may be a PDF, a scan or a photo. Extract the item data and its drilling pattern.

Return ONLY a JSON object, no prose:
{"name": V, "manufacturer": V, "code": V,
 "category": "hinge"|"mounting-plate"|"slide"|"shelf-pin"|"handle"|"connector"|"dowel"|"screw"|"leg"|"other",
 "item": {"cupDiameter": V, "cupDepth": V, "cupCentre": V, "plateHeight": V, "plateSetback": V, "plateSpacing": V,
          "holeDiameter": V, "holeDepth": V, "slideLength": V, "minCabinetDepth": V},
 "holes": [{"x": V, "y": V, "diameter": V, "depth": V, "face": "top"|"underside"|"edge"}],
 "notes": string, "warnings": [string]}
Leave out item fields that do not apply to this kind of hardware.

Pattern frame: the reference edge is the edge the sheet measures from (door edge for hinge cups, cabinet front edge for runners and plates, the rail or panel edge for handles). x runs along that edge from the insertion point, y goes into the panel away from it. For "edge" holes, y is the depth below the top face. For handles, x = 0 is the handle's centre.

${CITE_RULES}
- If the sheet lists several variants (e.g. K = 3 to 6, or several handle lengths), pick none: use null and list the options in warnings.
- Put anything unclear in warnings.`

/** @deprecated use HARDWARE_PROMPT */
export const DRAFT_PROMPT = HARDWARE_PROMPT

const FACE: Record<string, FaceId> = { top: 1, underside: 6, edge: 2 }

/**
 * Turn the model's JSON into a draft. Accepts bare numbers or cited values for every field.
 * Quotes that cannot be found in the PDF's own text are flagged so the reviewer looks at those first.
 */
export function draftFromModel(text: string, file: string, pages: TextPage[], label: string): PatternDraft {
  const j = modelJson(text, label)
  const warnings = strings(j.warnings)
  const findings: Finding[] = []
  const holes: PatternHole[] = []
  const holeCites: HoleCites[] = []
  const provenance: HardwarePattern['provenance'] = []
  const textLayer = hasText(pages)
  let unverified = 0
  for (const h of Array.isArray(j.holes) ? (j.holes as Record<string, unknown>[]) : []) {
    const n = holes.length + 1
    const base = citeOf(h, pages)
    const cites: HoleCites = {}
    const hole = { face: FACE[String(h.face)] ?? 1 } as PatternHole
    for (const k of ['x', 'y', 'diameter', 'depth'] as const) {
      const c = cnum(h[k], pages, base)
      hole[k] = c.v
      if (c.cite) cites[k] = c.cite
    }
    holes.push({ x: hole.x, y: hole.y, diameter: hole.diameter, depth: hole.depth, face: hole.face })
    holeCites.push(cites)
    const seen = new Set<string>()
    for (const k of ['diameter', 'depth', 'x', 'y'] as const) {
      const c = cites[k]
      if (!Number.isFinite(hole[k])) continue
      findings.push({ label: `Hole ${n} ${k}`, value: hole[k], page: c?.page, quote: c?.quote ?? '', ...(c?.region ? { region: c.region } : {}), used: true })
      const key = JSON.stringify([c?.page, c?.quote, c?.region])
      if (seen.has(key)) continue
      seen.add(key)
      if (c?.unverified) unverified++
      provenance.push({
        file,
        ...(c?.page !== undefined ? { page: c.page } : {}),
        quote: c?.quote ?? '',
        ...(c?.region ? { region: c.region } : {}),
        note: `${label}: hole ${n} ${k}${c?.unverified ? ' (quote not found in the PDF text; check the drawing)' : ''}`,
      })
    }
  }
  if (!holes.length) warnings.push(`${label} found no holes on this sheet.`)
  if (unverified) warnings.push(`${unverified} quote(s) are not in the PDF's text layer (they may come from the drawing itself). Check those holes against the sheet.`)
  if (!textLayer) warnings.push('This source has no text layer (a scan or a photo), so no quote could be checked automatically. Compare every value with the page.')
  if (holes.some((h) => ![h.x, h.y, h.diameter, h.depth].every(Number.isFinite))) warnings.push('Some values were not printed on the sheet; fill them in before approving.')

  const name = ctext(j.name, pages)
  const maker = ctext(j.manufacturer, pages)
  const code = ctext(j.code ?? j.partNumber, pages)
  const pattern: HardwarePattern = {
    id: `pat-${nanoid(8)}`,
    name: name.v || file.replace(/\.[^.]+$/, ''),
    manufacturer: maker.v,
    anchor: 'edge-start',
    holes,
    status: 'draft',
    source: 'pdf-draft',
    provenance,
    notes: [code.v ? `Part ${code.v}` : '', typeof j.notes === 'string' ? j.notes : '', `Drafted by ${label}`].filter(Boolean).join(' · '),
  }
  const item = itemFromModel(j, name.v || pattern.name, code, pages)
  if (name.cite) item.cites.name = name.cite
  return { pattern, findings, warnings, holeCites, ...(item ? { item } : {}) }
}

function itemFromModel(j: Record<string, unknown>, name: string, code: { v: string; cite?: Cite }, pages: TextPage[]): ItemDraft {
  const cat = HW_CATEGORIES.includes(j.category as HardwareCategory) ? (j.category as HardwareCategory) : 'other'
  const hardware: Hardware = { id: `hw-${nanoid(8)}`, code: code.v, name, category: cat }
  const cites: ItemDraft['cites'] = code.cite ? { code: code.cite } : {}
  const raw = j.item && typeof j.item === 'object' ? (j.item as Record<string, unknown>) : {}
  for (const f of ITEM_FIELDS) {
    if (!(f.key in raw)) continue
    const c = cnum(raw[f.key], pages)
    ;(hardware as unknown as Record<string, number>)[f.key] = c.v
    if (c.cite) cites[f.key] = c.cite
  }
  return { hardware, cites, add: true }
}

/** Problems with the item data that block approval. Blank numbers are left unset, not guessed. */
export function itemIssues(item: ItemDraft, lib: Library): string[] {
  if (!item.add) return []
  const h = item.hardware
  const out: string[] = []
  if (!h.code.trim()) out.push('Item: enter the part number (code).')
  if (!h.name.trim()) out.push('Item: enter a name.')
  if (h.code.trim() && lib.hardware.some((x) => x.code.trim().toLowerCase() === h.code.trim().toLowerCase()))
    out.push(`Item: ${h.code} is already in the library. Link the pattern to it instead of adding a new row.`)
  for (const f of ITEM_FIELDS) {
    const v = h[f.key]
    if (typeof v === 'number' && Number.isFinite(v) && v < 0) out.push(`Item: ${f.label.toLowerCase()} cannot be negative.`)
  }
  return out
}

/** Library row with blank (NaN) numbers left out. */
export function cleanItem(h: Hardware): Hardware {
  const out = { ...h } as Record<string, unknown>
  for (const [k, v] of Object.entries(out)) if (typeof v === 'number' && !Number.isFinite(v)) delete out[k]
  return out as unknown as Hardware
}

/**
 * Approve a reviewed draft and save it: the pattern, plus the library item when `item.add`.
 * Nothing is written unless the reviewer is named, the box is ticked and nothing is missing.
 */
export function approveHardwareDraft(lib: Library, pattern: HardwarePattern, item: ItemDraft | undefined, review: Review, now: Date): { errors: string[]; pattern?: HardwarePattern; hardware?: Hardware } {
  const errors = [...patternIssues(pattern), ...(item ? itemIssues(item, lib) : [])]
  const r = approvePattern(pattern, review, now)
  for (const e of r.errors) if (!errors.includes(e)) errors.push(e)
  if (errors.length || !r.pattern) return { errors }
  const hardware = item?.add ? cleanItem({ ...item.hardware, code: item.hardware.code.trim(), name: item.hardware.name.trim() }) : undefined
  const p = hardware ? { ...r.pattern, hardwareId: hardware.id } : r.pattern
  const saved = savePattern(lib, p)
  if (!saved.ok) return { errors: [saved.error ?? 'Could not save the pattern.'] }
  if (hardware) lib.hardware.push(hardware)
  return { errors: [], pattern: p, ...(hardware ? { hardware } : {}) }
}

/** A drafter backed by a vision model. `images` are the PDF's rendered pages, or the photo itself. */
export function aiDrafter(provider: AiProviderId, model: string, transport: AiTransport): PatternDrafter {
  const label = `${providerInfo(provider).label} ${model}`
  return {
    id: `ai-${provider}`,
    label,
    async draft(pages, file, images?: PageImage[]) {
      if (!images?.length) throw new Error('No page images to send.')
      const text = await transport({ provider, model, prompt: HARDWARE_PROMPT, images })
      return draftFromModel(text, file, pages, label)
    },
  }
}
