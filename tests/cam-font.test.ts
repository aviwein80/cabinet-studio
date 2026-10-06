/**
 * Stroke font editor (NEW-24, M3.2): single-stroke engraving fonts made and edited in the library.
 * Text keeps a copy of the glyphs it uses, so a part never changes when a library font is edited
 * later, until the text is set to that font again.
 */
import { describe, expect, it } from 'vitest'
import { entityContours, makeEntity, newPart, parsePart, serializePart } from '@/cam/doc'
import { BUILTIN_FONT, embedFont, fontFromJson, fontToJson, glyphAddPoint, glyphNewStroke, glyphRemoveStroke, glyphUndo, newFont, strokeText, textWidth } from '@/cam/font'
import { contourLength, type P, toPoints } from '@/cam/geom'
import type { StrokeFont } from '@/cam/types'

const pts = (cs: ReturnType<typeof strokeText>) => cs.flatMap((c) => toPoints(c, 0.001))

describe('the built-in font as a stroke font', () => {
  it('draws the same as before: same strokes, same widths', () => {
    // a font object built from the built-in glyphs gives identical strokes to the built-in path
    const a = strokeText('AB-12', { x: 5, y: 7 }, 12, 0.3, 1.2)
    const b = strokeText('AB-12', { x: 5, y: 7 }, 12, 0.3, 1.2, undefined, BUILTIN_FONT)
    expect(b).toEqual(a)
    expect(textWidth('AB-12', 12, 1.2, BUILTIN_FONT)).toBeCloseTo(textWidth('AB-12', 12, 1.2), 12)
    expect(textWidth('ABC', 6)).toBe(16)
  })
})

describe('a font made in the editor', () => {
  // a font on a 10-unit grid: an L and a bar, with their own advances
  const make = (): StrokeFont => {
    let f = newFont('Shop marks', { capHeight: 10, gap: 2 })
    f = glyphNewStroke(f, 'L')
    for (const p of [
      [0, 10],
      [0, 0],
      [5, 0],
    ] as [number, number][])
      f = glyphAddPoint(f, 'L', p)
    f = glyphNewStroke(f, '-')
    f = glyphAddPoint(f, '-', [0, 5])
    f = glyphAddPoint(f, '-', [3, 5])
    return { ...f, glyphs: { ...f.glyphs, L: { ...f.glyphs.L, advance: 7 }, '-': { ...f.glyphs['-'], advance: 5 } } }
  }

  it('scales glyph units to the text height and steps by each glyph\'s advance', () => {
    const f = make()
    const cs = strokeText('L-L', { x: 0, y: 0 }, 20, 0, 1, undefined, f)
    expect(cs).toHaveLength(3)
    // 20 mm high on a 10-unit grid: 2 mm per unit; the L is 20 tall and 10 wide
    const L = toPoints(cs[0], 0.001)
    expect(L.map((p) => [p.x, p.y])).toEqual([
      [0, 20],
      [0, 0],
      [10, 0],
    ])
    // the bar starts one L advance (7 units, 14 mm) along; the second L at 7 + 5 = 12 units (24 mm)
    expect(toPoints(cs[1], 0.001)[0]).toEqual({ x: 14, y: 10 })
    expect(toPoints(cs[2], 0.001)[0]).toEqual({ x: 24, y: 20 })
    expect(contourLength(cs[2])).toBeCloseTo(30, 12)
    // width: the advances less the last gap: (7 + 5 + 7 - 2) x 2 = 34 mm
    expect(textWidth('L-L', 20, 1, f)).toBeCloseTo(34, 12)
  })

  it('falls back to the built-in glyph for a character the font does not have, scaled to its grid', () => {
    const f = make()
    const own = strokeText('A', { x: 0, y: 0 }, 6, 0, 1, undefined, f)
    const builtin = strokeText('A', { x: 0, y: 0 }, 6)
    expect(pts(own)).toEqual(pts(builtin))
    // lower case uses the font's capital first
    expect(pts(strokeText('l', { x: 0, y: 0 }, 20, 0, 1, undefined, f))).toEqual(pts(strokeText('L', { x: 0, y: 0 }, 20, 0, 1, undefined, f)))
  })

  it('editing: new stroke, add points, undo, remove a stroke', () => {
    let f = newFont('Edit me')
    f = glyphNewStroke(f, 'T')
    f = glyphAddPoint(f, 'T', [0, 6])
    f = glyphAddPoint(f, 'T', [4, 6])
    f = glyphNewStroke(f, 'T')
    f = glyphAddPoint(f, 'T', [2, 6])
    f = glyphAddPoint(f, 'T', [2, 0])
    expect(f.glyphs.T.strokes).toEqual([
      [
        [0, 6],
        [4, 6],
      ],
      [
        [2, 6],
        [2, 0],
      ],
    ])
    f = glyphUndo(f, 'T')
    expect(f.glyphs.T.strokes[1]).toEqual([[2, 6]])
    f = glyphRemoveStroke(f, 'T', 0)
    expect(f.glyphs.T.strokes).toEqual([[[2, 6]]])
    // a stroke of one point draws nothing
    expect(strokeText('T', { x: 0, y: 0 }, 6, 0, 1, undefined, f)).toEqual([])
  })

  it('saves and reads back as JSON; bad files are refused with a reason', () => {
    const f = make()
    const back = fontFromJson(fontToJson(f))
    expect(back.errors).toEqual([])
    expect(back.font).toEqual(f)
    expect(fontFromJson('{').errors[0]).toMatch(/not a font file/i)
    expect(fontFromJson(JSON.stringify({ name: 'x', capHeight: -1, glyphs: {} })).errors.join(' ')).toMatch(/cap height/i)
    expect(fontFromJson(JSON.stringify({ name: 'x', capHeight: 6, glyphs: { A: { strokes: [[[0, 'a']]], advance: 6 } } })).errors.join(' ')).toMatch(/A/)
  })
})

describe('text keeps the glyphs it uses', () => {
  it('embeds only the characters in the text; the part saves and draws the same after the library font changes', () => {
    let f = newFont('Mine', { capHeight: 10, gap: 2 })
    f = glyphNewStroke(f, 'X')
    f = glyphAddPoint(f, 'X', [0, 0])
    f = glyphAddPoint(f, 'X', [6, 10])
    f = glyphNewStroke(f, 'Y')
    f = glyphAddPoint(f, 'Y', [0, 10])
    f = glyphAddPoint(f, 'Y', [3, 0])
    const emb = embedFont(f, 'XX')
    expect(Object.keys(emb.glyphs)).toEqual(['X'])
    expect(emb.id).toBe(f.id)
    const part = newPart({ name: 'Sign', length: 300, width: 100 })
    const e = makeEntity({ t: 'text', at: { x: 10, y: 10 }, text: 'XX', height: 20, angle: 0, font: emb }, 'text')
    part.entities = [e]
    const before = entityContours(e).map((c) => toPoints(c, 0.001))
    // the library font changes: the part does not
    f = glyphAddPoint(f, 'X', [9, 9])
    const back = parsePart(serializePart(part))
    expect(back.entities[0].g).toEqual(e.g)
    expect(entityContours(back.entities[0]).map((c) => toPoints(c, 0.001))).toEqual(before)
    // 2 mm per unit: the X stroke runs 12 across and 20 up
    const first: P[] = before[0]
    expect(first[1].x - first[0].x).toBeCloseTo(12, 12)
    expect(first[1].y - first[0].y).toBeCloseTo(20, 12)
  })
})
