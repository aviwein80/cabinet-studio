/**
 * Citations for values read from a spec sheet or drawing. Every drafted number carries the page
 * it came from, the printed text, and (when known) a box on the page. Values that were not
 * printed stay NaN, which the review dialogs show as blank, required cells.
 */
import type { Region } from '@/cam/types'
import type { Cite, TextPage } from '../hardware/patternImport'

export type { Cite }

/** A drafted number and where it came from. `v` is NaN when the source does not give it. */
export interface CNum {
  v: number
  cite?: Cite
}

export const blank = (): CNum => ({ v: NaN })
export const known = (v: number, cite?: Cite): CNum => ({ v, ...(cite ? { cite } : {}) })

export const squash = (s: string) => s.toLowerCase().replace(/[⌀øΦφ]/g, 'ø').replace(/[^a-z0-9.ø]+/g, '')

const round = (n: number) => Math.round(n * 1000) / 1000

/** Parse a model's region: four fractions 0..1 (percentages are accepted and scaled). */
export function parseRegion(v: unknown): Region | undefined {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined
  let r = v as number[]
  if (r.some((n) => n > 1) && r.every((n) => n >= 0 && n <= 100)) r = r.map((n) => n / 100)
  if (r.some((n) => n < 0 || n > 1)) return undefined
  const [x0, y0, x1, y1] = r
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)].map((n) => Math.round(n * 10000) / 10000) as Region
}

/** Find a quote in the PDF's text layer; returns the page and the line's box. */
export function locate(pages: TextPage[], quote: string, page?: number): { page: number; region?: Region } | null {
  const q = squash(quote)
  if (q.length < 2) return null
  const order = page !== undefined ? [...pages.filter((p) => p.page === page), ...pages.filter((p) => p.page !== page)] : pages
  for (const p of order)
    for (const [i, l] of p.lines.entries()) {
      const s = squash(l)
      if (s.includes(q) || (s.length >= 4 && q.includes(s))) return { page: p.page, ...(p.boxes?.[i] ? { region: p.boxes[i] } : {}) }
    }
  return null
}

/** True when the source has a text layer that could confirm quotes (not a scan or a photo). */
export const hasText = (pages: TextPage[]) => pages.some((p) => p.lines.length > 0)

/**
 * Citation from a model's {page, quote, region}. The quote is checked against the text layer;
 * a found quote fills in the page and box when the model gave none.
 */
export function citeOf(raw: unknown, pages: TextPage[], fallback?: Cite): Cite | undefined {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const page = typeof o.page === 'number' && Number.isFinite(o.page) ? Math.round(o.page) : fallback?.page
  const quote = typeof o.quote === 'string' && o.quote.trim() ? o.quote.trim().slice(0, 200) : fallback?.quote
  const region = parseRegion(o.region) ?? (o.quote === undefined ? fallback?.region : undefined)
  if (page === undefined && !quote && !region) return undefined
  const cite: Cite = { ...(page !== undefined ? { page } : {}), ...(quote ? { quote } : {}), ...(region ? { region } : {}) }
  if (quote && hasText(pages)) {
    const hit = locate(pages, quote, page)
    if (!hit) cite.unverified = true
    else {
      cite.page ??= hit.page
      if (!cite.region && hit.region) cite.region = hit.region
    }
  }
  return cite
}

/** A model value: a bare number, or {value, page, quote, region}. Null or missing stays blank. */
export function cnum(raw: unknown, pages: TextPage[], fallback?: Cite): CNum {
  const isObj = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
  const v = isObj ? (raw as Record<string, unknown>).value : raw
  const n = typeof v === 'number' && Number.isFinite(v) ? round(v) : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? round(Number(v)) : NaN
  if (!Number.isFinite(n)) return blank()
  const cite = citeOf(isObj ? raw : {}, pages, fallback)
  return known(n, cite)
}

export function ctext(raw: unknown, pages: TextPage[], fallback?: Cite): { v: string; cite?: Cite } {
  const isObj = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
  const v = isObj ? (raw as Record<string, unknown>).value : raw
  if (typeof v !== 'string' || !v.trim()) return { v: '' }
  const cite = citeOf(isObj ? raw : {}, pages, fallback)
  return { v: v.trim(), ...(cite ? { cite } : {}) }
}

/** The JSON object in a model's reply (code fences and stray prose are ignored). */
export function modelJson(text: string, label: string): Record<string, unknown> {
  const raw = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  try {
    const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
    if (j && typeof j === 'object' && !Array.isArray(j)) return j as Record<string, unknown>
  } catch {
    /* fall through */
  }
  throw new Error(`${label} did not return readable JSON.`)
}

export const strings = (v: unknown) => (Array.isArray(v) ? v.filter((w): w is string => typeof w === 'string' && !!w.trim()) : [])

/** Short "page 2" text for a citation. */
export function citeLabel(c?: Cite) {
  if (!c) return 'no source'
  return [c.page !== undefined ? `page ${c.page}` : '', c.unverified ? 'not in the text layer' : ''].filter(Boolean).join(' · ') || 'cited'
}

export const CITE_RULES = `Citations: every value is an object {"value": ..., "page": number, "quote": string, "region": [x0, y0, x1, y1]}.
- "quote" is the exact text or dimension label printed on the sheet that the value came from.
- "page" is the page number (1 = first image).
- "region" is the box around that printed value on the page image, as fractions 0..1 of the image width and height, measured from the top-left corner.
- If a value is not printed or you cannot read it, use {"value": null}. Never estimate, scale off the drawing, or assume a standard.
- Millimetres. If the sheet is in inches, convert (x 25.4) and add a warning saying so.`
