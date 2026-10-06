/**
 * Annotation and print (NEW-21, M3.2): hatching, detail views, line types, and prints that measure
 * to scale: in the PDF, part lengths are their size over the print scale, hatch lines are their
 * spacing over the scale apart, a detail view is its own factor larger again, and dashes are their
 * set paper lengths at any scale.
 */
import { describe, expect, it } from 'vitest'
import { annotationLines, brokenAnnotations, clipToCircle, dashPolyline, detailView, hatchLines, hatchRings, LINE_TYPES } from '@/cam/annotate'
import { makeEntity, newPart } from '@/cam/doc'
import { type P, rect } from '@/cam/geom'
import { DEFAULT_PRINT, printPdf, printPlan } from '@/cam/print'
import type { CamPart } from '@/cam/types'

const len = (l: P[]) => l.slice(1).reduce((n, b, i) => n + Math.hypot(b.x - l[i].x, b.y - l[i].y), 0)
const PT = 72 / 25.4

/** Every straight piece the PDF draws, in paper mm (jsPDF writes "x y m x y l" in points). */
function pdfSegments(pdf: Uint8Array): { a: P; b: P; l: number }[] {
  const text = new TextDecoder('latin1').decode(pdf)
  return [...text.matchAll(/(-?[\d.]+) (-?[\d.]+) m\s*\n?(-?[\d.]+) (-?[\d.]+) l/g)].map((m) => {
    const a = { x: Number(m[1]) / PT, y: Number(m[2]) / PT }
    const b = { x: Number(m[3]) / PT, y: Number(m[4]) / PT }
    return { a, b, l: Math.hypot(b.x - a.x, b.y - a.y) }
  })
}

function part(): CamPart {
  const p = newPart({ name: 'Panel', length: 400, width: 200 })
  const outline = makeEntity({ t: 'contour', c: rect(0, 0, 400, 200) }, 'outline')
  outline.id = 'o'
  const pocket = makeEntity({ t: 'contour', c: rect(50, 50, 100, 60) }, 'outline')
  pocket.id = 'k'
  const hole = makeEntity({ t: 'circle', c: { x: 100, y: 80 }, r: 15 }, 'outline')
  hole.id = 'h'
  p.entities = [outline, pocket, hole]
  return p
}

describe('hatching', () => {
  it('fills a rectangle with lines the set spacing apart, ends on the boundary', () => {
    const ring = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 60 },
      { x: 0, y: 60 },
    ]
    const ls = hatchLines([ring], 45, 5)
    expect(ls.length).toBeGreaterThan(20)
    // every end on the rectangle's edge
    for (const [a, b] of ls)
      for (const p of [a, b]) {
        const onEdge = Math.min(Math.abs(p.x), Math.abs(p.x - 100), Math.abs(p.y), Math.abs(p.y - 60))
        expect(onEdge).toBeLessThan(1e-9)
      }
    // 45 degrees, and neighbouring lines exactly 5 apart (measured square to them)
    const n = { x: -Math.SQRT1_2, y: Math.SQRT1_2 }
    const offs = ls.map(([a, b]) => {
      expect(Math.abs(Math.atan2(b.y - a.y, b.x - a.x) - Math.PI / 4)).toBeLessThan(1e-9)
      return a.x * n.x + a.y * n.y
    })
    offs.sort((x, y) => x - y)
    for (let i = 1; i < offs.length; i++) expect(offs[i] - offs[i - 1]).toBeCloseTo(5, 9)
    // total length times the spacing is the area (to within a line's worth at the corners)
    const total = ls.reduce((s, [a, b]) => s + Math.hypot(b.x - a.x, b.y - a.y), 0)
    expect(Math.abs(total * 5 - 6000)).toBeLessThan(5 * 60)
  })

  it('leaves holes empty, crosses when asked, and follows its shapes', () => {
    const p = part()
    p.annotations = [{ id: 'a', k: 'hatch', shapes: ['k', 'h'], angle: 30, spacing: 3 }]
    const h = p.annotations[0] as Extract<NonNullable<CamPart['annotations']>[number], { k: 'hatch' }>
    const ls = hatchLines(hatchRings(p, h), h.angle, h.spacing)
    for (const [a, b] of ls) {
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      expect(m.x).toBeGreaterThan(50 - 1e-9)
      expect(m.x).toBeLessThan(150 + 1e-9)
      // nothing drawn inside the round hole
      const t = Math.max(0, Math.min(1, ((100 - a.x) * (b.x - a.x) + (80 - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2)))
      const near = Math.hypot(a.x + (b.x - a.x) * t - 100, a.y + (b.y - a.y) * t - 80)
      expect(near).toBeGreaterThan(15 - 0.06)
    }
    const crossed = hatchLines(hatchRings(p, h), h.angle, h.spacing, true)
    expect(crossed.length).toBeGreaterThan(ls.length * 1.5)
    // the pocket made longer: the hatch follows it
    const longer = { ...p, entities: p.entities.map((e) => (e.id === 'k' ? { ...e, g: { t: 'contour' as const, c: rect(50, 50, 200, 60) } } : e)) }
    const after = annotationLines(longer).lines
    expect(Math.max(...after.flat().map((q) => q.x))).toBeGreaterThan(240)
    // the shapes deleted: the hatch draws nothing and is listed as broken
    const gone = { ...p, entities: p.entities.filter((e) => e.id === 'o') }
    expect(annotationLines(gone).lines).toEqual([])
    expect(brokenAnnotations(gone).map((a) => a.id)).toEqual(['a'])
  })
})

describe('line types and detail views', () => {
  it('cuts a line into dashes of the set lengths, the pattern running on round corners', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]
    const d = dashPolyline(pts, [4, 2])
    // 20 long: dashes at 0-4, 6-10 (round the corner? no: 6-10 ends at the corner), 12-16, 18-20
    expect(d.map((q) => Math.round(len(q) * 1e9) / 1e9)).toEqual([4, 4, 4, 2])
    // a dash that runs round a corner keeps its length
    const e = dashPolyline(pts, [3, 1])
    expect(e.map((q) => Math.round(len(q) * 1e9) / 1e9)).toEqual([3, 3, 3, 3, 3])
    expect(e[2]).toHaveLength(3)
    // the centre line pattern
    const c = dashPolyline([pts[0], { x: 100, y: 0 }], LINE_TYPES.centre.dash)
    expect(len(c[0])).toBeCloseTo(8, 9)
    expect(len(c[1])).toBeCloseTo(1.5, 9)
  })

  it('clips to a circle and magnifies the detail about its centre', () => {
    const pieces = clipToCircle(
      [
        { x: -20, y: 0 },
        { x: 20, y: 0 },
      ],
      { x: 0, y: 0 },
      10,
    )
    expect(pieces).toHaveLength(1)
    expect(len(pieces[0])).toBeCloseTo(20, 9)
    const v = detailView(
      [
        [
          { x: -20, y: 0 },
          { x: 20, y: 0 },
        ],
      ],
      { id: 'd', k: 'detail', c: { x: 0, y: 0 }, r: 10, scale: 2.5, at: { x: 300, y: 100 }, label: 'A' },
    )
    expect(v.lines).toHaveLength(1)
    expect(len(v.lines[0])).toBeCloseTo(50, 9)
    expect(v.lines[0][0].x).toBeCloseTo(275, 9)
    expect(v.texts.map((t) => t.text)).toEqual(['A', 'Detail A (2.5:1)'])
  })
})

describe('prints measure to scale', () => {
  const opt = { ...DEFAULT_PRINT, scale: 5, dims: false, paper: 'a3' as const }

  it('part lengths, hatch spacing, detail views and dashes in the PDF', () => {
    const p = part()
    p.layers = [...p.layers.map((l) => (l.id === 'outline' ? { ...l } : l)), { id: 'centre', name: 'Centre lines', color: '#999', visible: true, locked: false, lineType: 'dashed' }]
    // a dashed centre line 300 long, on its own layer
    const cl = makeEntity({ t: 'contour', c: { closed: false, segs: [{ k: 'L', a: { x: 50, y: 150 }, b: { x: 350, y: 150 } }] } }, 'centre')
    p.entities.push(cl)
    // hatch the pocket at 0 degrees, 10 apart (2 mm on paper at 1:5); a 4x detail of the hole
    p.annotations = [
      { id: 'a', k: 'hatch', shapes: ['k'], angle: 0, spacing: 10 },
      { id: 'b', k: 'detail', c: { x: 100, y: 80 }, r: 20, scale: 4, at: { x: 600, y: 100 }, label: 'B' },
    ]
    const plan = printPlan(p, opt)
    expect(plan.pages).toHaveLength(1)
    const segs = pdfSegments(printPdf(p, plan, opt))
    const has = (mm: number, tol = 0.01) => segs.some((s) => Math.abs(s.l - mm) < tol)
    // the 400 mm outline edge is 80 mm on paper, the 100 mm check bar 100 mm
    expect(has(80)).toBe(true)
    expect(has(100)).toBe(true)
    // hatch lines across the 100 mm wide pocket: 20 mm long on paper, 2 mm apart
    const hatch = segs.filter((s) => Math.abs(s.l - 20) < 0.01 && Math.abs(s.a.y - s.b.y) < 1e-6)
    const ys = [...new Set(hatch.map((s) => Math.round(s.a.y * 1e4) / 1e4))].sort((x, y) => x - y)
    expect(ys.length).toBeGreaterThanOrEqual(5)
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeCloseTo(2, 3)
    // the detail magnifies 4x on top of 1:5: the pocket's 100 mm bottom edge crosses the 20 mm
    // circle as a chord; the hatch line at y = 70 (10 from the centre) has a chord 2 x sqrt(20² - 10²)
    // = 34.64 mm, so 34.64 x 4 / 5 = 27.71 mm on paper
    expect(has((2 * Math.sqrt(400 - 100) * 4) / 5, 0.02)).toBe(true)
    // the dashed centre line: 4 mm dashes on paper whatever the scale
    const dashes = segs.filter((s) => Math.abs(s.l - 4) < 1e-3 && Math.abs(s.a.y - s.b.y) < 1e-6)
    expect(dashes.length).toBeGreaterThanOrEqual(9)
    // and the same 4 mm at 1:2
    const opt2 = { ...opt, scale: 2 }
    const segs2 = pdfSegments(printPdf(p, printPlan(p, opt2), opt2))
    const dashes2 = segs2.filter((s) => Math.abs(s.l - 4) < 1e-3 && Math.abs(s.a.y - s.b.y) < 1e-6)
    expect(dashes2.length).toBeGreaterThan(dashes.length)
  })

  it('annotations can be left out of the print', () => {
    const p = part()
    p.annotations = [{ id: 'a', k: 'hatch', shapes: ['k'], angle: 0, spacing: 10 }]
    const withNotes = printPlan(p, opt).pages[0].lines.length
    const without = printPlan(p, { ...opt, notes: false }).pages[0].lines.length
    expect(withNotes).toBeGreaterThan(without)
  })

  it('a circle stays a circle: the detail border measures 2 pi r x factor / scale', () => {
    const p = part()
    p.annotations = [{ id: 'b', k: 'detail', c: { x: 100, y: 80 }, r: 20, scale: 2, at: { x: 600, y: 100 }, label: 'B' }]
    const lines = annotationLines(p).lines
    const border = lines[1]
    expect(len(border)).toBeCloseTo(2 * Math.PI * 40, 0)
    // the hole (r 15) inside the detail comes out r 30
    const big = lines.slice(2).find((l) => l.length > 20)!
    const rs = big.map((q) => Math.hypot(q.x - (600 + (100 - 100) * 2), q.y - (100 + (80 - 80) * 2)))
    for (const r of rs) expect(Math.abs(r - 30)).toBeLessThan(0.1)
  })
})
