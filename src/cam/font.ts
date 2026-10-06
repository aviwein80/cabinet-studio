/**
 * Built-in single-stroke engraving font, drawn for Cabinet Studio on a 4 x 6 grid
 * (cap height 6, advance 6). Lower case uses the capitals.
 *
 * Stroke fonts made in the library's font editor (NEW-24, M3.2) draw the same way: each glyph is
 * strokes (polylines) on the font's own grid, from x 0 and the baseline up, with its own advance.
 * A character a font does not have is drawn with the built-in glyph, scaled to the font's grid.
 */
import { type Contour, fitPoints, polyline, type P, pt } from './geom'
import { nanoid } from 'nanoid'
import type { StrokeFont, StrokeGlyph } from './types'

const G: Record<string, string> = {
  A: '0,0 2,6 4,0|1,3 3,3',
  B: '0,0 0,6 3,6 4,5 4,4 3,3 0,3|3,3 4,2 4,1 3,0 0,0',
  C: '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1',
  D: '0,0 0,6 2,6 4,4 4,2 2,0 0,0',
  E: '4,0 0,0 0,6 4,6|0,3 3,3',
  F: '0,0 0,6 4,6|0,3 3,3',
  G: '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,3 2,3',
  H: '0,0 0,6|4,0 4,6|0,3 4,3',
  I: '1,0 3,0|2,0 2,6|1,6 3,6',
  J: '0,1 1,0 2,0 3,1 3,6|2,6 4,6',
  K: '0,0 0,6|4,6 0,2|1,3 4,0',
  L: '0,6 0,0 4,0',
  M: '0,0 0,6 2,3 4,6 4,0',
  N: '0,0 0,6 4,0 4,6',
  O: '1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0',
  P: '0,0 0,6 3,6 4,5 4,4 3,3 0,3',
  Q: '1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0|2,2 4,0',
  R: '0,0 0,6 3,6 4,5 4,4 3,3 0,3|2,3 4,0',
  S: '4,5 3,6 1,6 0,5 0,4 1,3 3,3 4,2 4,1 3,0 1,0 0,1',
  T: '0,6 4,6|2,6 2,0',
  U: '0,6 0,1 1,0 3,0 4,1 4,6',
  V: '0,6 2,0 4,6',
  W: '0,6 1,0 2,4 3,0 4,6',
  X: '0,0 4,6|0,6 4,0',
  Y: '0,6 2,3 4,6|2,3 2,0',
  Z: '0,6 4,6 0,0 4,0',
  '0': '1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0|0,1 4,5',
  '1': '1,5 2,6 2,0|1,0 3,0',
  '2': '0,5 1,6 3,6 4,5 4,4 0,0 4,0',
  '3': '0,5 1,6 3,6 4,5 4,4 3,3 4,2 4,1 3,0 1,0 0,1|1,3 3,3',
  '4': '3,0 3,6 0,2 4,2',
  '5': '4,6 0,6 0,3 3,3 4,2 4,1 3,0 0,0',
  '6': '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,2 3,3 0,3',
  '7': '0,6 4,6 1,0',
  '8': '1,3 0,4 0,5 1,6 3,6 4,5 4,4 3,3 1,3 0,2 0,1 1,0 3,0 4,1 4,2 3,3',
  '9': '0,1 1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,4 1,3 4,3',
  '-': '1,3 3,3',
  '.': '2,0 2,0.4',
  ',': '2,0.5 1.5,-1',
  '/': '0,0 4,6',
  ':': '2,1 2,1.4|2,4 2,4.4',
  '(': '3,6 1.5,4 1.5,2 3,0',
  ')': '1,6 2.5,4 2.5,2 1,0',
  '+': '2,1 2,5|0,3 4,3',
  '=': '0,2 4,2|0,4 4,4',
  _: '0,0 4,0',
  '#': '1,0 1,6|3,0 3,6|0,2 4,2|0,4 4,4',
  "'": '2,6 2,4.5',
  '"': '1.5,6 1.5,4.5|2.5,6 2.5,4.5',
  '!': '2,6 2,2|2,0 2,0.4',
  '?': '0,5 1,6 3,6 4,5 4,4 2,3 2,2|2,0 2,0.4',
}

const strokes = (ch: string): P[][] => {
  const def = G[ch] ?? G[ch.toUpperCase()]
  if (!def) return []
  return def.split('|').map((s) => s.split(' ').map((q) => pt(Number(q.split(',')[0]), Number(q.split(',')[1]))))
}

export const ADVANCE = 6

export function hasGlyph(ch: string) {
  return ch === ' ' || !!(G[ch] ?? G[ch.toUpperCase()])
}

/** Width of a text string at a given cap height. */
export function textWidth(text: string, height: number, spacing = 1, font?: StrokeFont) {
  if (font) {
    const chars = [...text]
    if (!chars.length) return 0
    const sum = chars.reduce((n, ch) => n + glyphOf(font, ch).advance, 0)
    return ((sum - font.gap) * height * spacing) / font.capHeight
  }
  return text.length ? ((text.length * ADVANCE - (ADVANCE - 4)) * height * spacing) / 6 : 0
}

/**
 * Text as open stroke contours. Straight text runs from `at` along `angle` (radians); arc text
 * centres the string on the top of the arc and reads clockwise around it. `font`: a stroke font
 * (the built-in one when absent).
 */
export function strokeText(text: string, at: P, height: number, angle = 0, spacing = 1, onArc?: { c: P; r: number }, font?: StrokeFont): Contour[] {
  if (font) return fontText(font, text, at, height, angle, spacing, onArc)
  const s = height / 6
  const out: Contour[] = []
  const total = textWidth(text, height, spacing)
  ;[...text].forEach((ch, i) => {
    const x0 = i * ADVANCE * s * spacing
    for (const stroke of strokes(ch)) {
      const mapped = stroke.map((p) => {
        const lx = x0 + p.x * s
        const ly = p.y * s
        if (onArc) {
          const a = Math.PI / 2 - (lx - total / 2) / onArc.r
          const r = onArc.r + ly
          return pt(onArc.c.x + r * Math.cos(a), onArc.c.y + r * Math.sin(a))
        }
        return pt(at.x + lx * Math.cos(angle) - ly * Math.sin(angle), at.y + lx * Math.sin(angle) + ly * Math.cos(angle))
      })
      if (mapped.length < 2) continue
      if (onArc) {
        const dense: P[] = []
        for (let k = 0; k + 1 < mapped.length; k++) for (let t = 0; t < 8; t++) dense.push(pt(mapped[k].x + ((mapped[k + 1].x - mapped[k].x) * t) / 8, mapped[k].y + ((mapped[k + 1].y - mapped[k].y) * t) / 8))
        dense.push(mapped[mapped.length - 1])
        out.push({ segs: fitPoints(dense, false, 0.02), closed: false })
      } else out.push(polyline(mapped, false))
    }
  })
  return out
}

// ---------------------------------------------------------------------------------------------
// Stroke fonts (NEW-24)
// ---------------------------------------------------------------------------------------------

/** The built-in font as a stroke font (to start a new font from, or compare with). */
export const BUILTIN_FONT: StrokeFont = {
  id: 'builtin',
  name: 'Built-in single stroke',
  capHeight: 6,
  gap: ADVANCE - 4,
  glyphs: Object.fromEntries(Object.keys(G).map((ch) => [ch, { strokes: strokes(ch).map((st) => st.map((p) => [p.x, p.y] as [number, number])), advance: ADVANCE }])),
}

/** The glyph a font draws for a character: its own, its capital's, else the built-in one scaled to its grid. */
export function glyphOf(font: StrokeFont, ch: string): StrokeGlyph {
  const own = font.glyphs[ch] ?? font.glyphs[ch.toUpperCase()]
  if (own) return own
  const k = font.capHeight / 6
  return { strokes: strokes(ch).map((st) => st.map((p) => [p.x * k, p.y * k] as [number, number])), advance: ADVANCE * k }
}

function fontText(font: StrokeFont, text: string, at: P, height: number, angle: number, spacing: number, onArc?: { c: P; r: number }): Contour[] {
  const s = height / font.capHeight
  const out: Contour[] = []
  const total = textWidth(text, height, spacing, font)
  let acc = 0
  for (const ch of text) {
    const g = glyphOf(font, ch)
    const x0 = acc * s * spacing
    acc += g.advance
    for (const stroke of g.strokes) {
      const mapped = stroke.map(([x, y]) => {
        const lx = x0 + x * s
        const ly = y * s
        if (onArc) {
          const a = Math.PI / 2 - (lx - total / 2) / onArc.r
          const r = onArc.r + ly
          return pt(onArc.c.x + r * Math.cos(a), onArc.c.y + r * Math.sin(a))
        }
        return pt(at.x + lx * Math.cos(angle) - ly * Math.sin(angle), at.y + lx * Math.sin(angle) + ly * Math.cos(angle))
      })
      if (mapped.length < 2) continue
      if (onArc) {
        const dense: P[] = []
        for (let k = 0; k + 1 < mapped.length; k++) for (let t = 0; t < 8; t++) dense.push(pt(mapped[k].x + ((mapped[k + 1].x - mapped[k].x) * t) / 8, mapped[k].y + ((mapped[k + 1].y - mapped[k].y) * t) / 8))
        dense.push(mapped[mapped.length - 1])
        out.push({ segs: fitPoints(dense, false, 0.02), closed: false })
      } else out.push(polyline(mapped, false))
    }
  }
  return out
}

/** A new, empty font (`capHeight` grid units tall, `gap` units between letters). */
export function newFont(name: string, opt: { capHeight?: number; gap?: number; from?: StrokeFont } = {}): StrokeFont {
  const from = opt.from
  return {
    id: `font-${nanoid(8)}`,
    name,
    capHeight: opt.capHeight ?? from?.capHeight ?? 6,
    gap: opt.gap ?? from?.gap ?? 2,
    glyphs: from ? structuredClone(from.glyphs) : {},
  }
}

const withGlyph = (f: StrokeFont, ch: string, fn: (g: StrokeGlyph) => StrokeGlyph): StrokeFont => {
  const g = f.glyphs[ch] ?? { strokes: [], advance: f.capHeight + f.gap - Math.round(f.capHeight / 3) }
  return { ...f, glyphs: { ...f.glyphs, [ch]: fn(g) } }
}
/** Start a new stroke in a glyph. */
export const glyphNewStroke = (f: StrokeFont, ch: string) => withGlyph(f, ch, (g) => ({ ...g, strokes: [...g.strokes, []] }))
/** Add a point (grid units) to the glyph's last stroke (starting one if it has none). */
export const glyphAddPoint = (f: StrokeFont, ch: string, p: [number, number]) =>
  withGlyph(f, ch, (g) => {
    const st = g.strokes.length ? g.strokes : [[]]
    return { ...g, strokes: [...st.slice(0, -1), [...st[st.length - 1], p]] }
  })
/** Take back the last point (an emptied stroke goes too). */
export const glyphUndo = (f: StrokeFont, ch: string) =>
  withGlyph(f, ch, (g) => {
    if (!g.strokes.length) return g
    const last = g.strokes[g.strokes.length - 1].slice(0, -1)
    return { ...g, strokes: last.length ? [...g.strokes.slice(0, -1), last] : g.strokes.slice(0, -1) }
  })
export const glyphRemoveStroke = (f: StrokeFont, ch: string, i: number) => withGlyph(f, ch, (g) => ({ ...g, strokes: g.strokes.filter((_, k) => k !== i) }))

/** The part of a font a text needs (its characters' own glyphs), to keep with the text. */
export function embedFont(font: StrokeFont, text: string): StrokeFont {
  const glyphs: Record<string, StrokeGlyph> = {}
  for (const ch of text) {
    const key = font.glyphs[ch] ? ch : font.glyphs[ch.toUpperCase()] ? ch.toUpperCase() : null
    if (key && !glyphs[key]) glyphs[key] = structuredClone(font.glyphs[key])
  }
  return { id: font.id, name: font.name, capHeight: font.capHeight, gap: font.gap, glyphs }
}

export function fontToJson(font: StrokeFont): string {
  return JSON.stringify({ format: 'cabinet-studio-stroke-font', version: 1, ...font }, null, 1)
}

/** A font read from a file, checked: every glyph's strokes are lists of [x, y] numbers. */
export function fontFromJson(text: string): { font: StrokeFont | null; errors: string[] } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { font: null, errors: ['This is not a font file (it is not JSON).'] }
  }
  const o = raw as Partial<StrokeFont> & { format?: string; version?: number }
  const errors: string[] = []
  if (!o || typeof o !== 'object' || typeof o.glyphs !== 'object' || !o.glyphs) return { font: null, errors: ['This is not a font file (no glyphs).'] }
  if (!(typeof o.capHeight === 'number' && o.capHeight > 0)) errors.push('The cap height must be a number above 0.')
  const gap = typeof o.gap === 'number' && Number.isFinite(o.gap) ? o.gap : 2
  const glyphs: Record<string, StrokeGlyph> = {}
  for (const [ch, g] of Object.entries(o.glyphs as Record<string, StrokeGlyph>)) {
    const okStrokes = Array.isArray(g?.strokes) && g.strokes.every((st) => Array.isArray(st) && st.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v))))
    if (!okStrokes || !(typeof g.advance === 'number' && Number.isFinite(g.advance))) {
      errors.push(`Glyph "${ch}" is not strokes of [x, y] numbers with an advance.`)
      continue
    }
    glyphs[ch] = { strokes: g.strokes.map((st) => st.map(([x, y]) => [x, y] as [number, number])), advance: g.advance }
  }
  if (errors.length) return { font: null, errors }
  return { font: { id: typeof o.id === 'string' && o.id ? o.id : `font-${nanoid(8)}`, name: typeof o.name === 'string' && o.name ? o.name : 'Imported font', capHeight: o.capHeight as number, gap, glyphs }, errors: [] }
}
