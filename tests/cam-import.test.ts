import { jsPDF } from 'jspdf'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'
import { entityContours, newPart, makeEntity, partOutline } from '@/cam/doc'
import { dxfToPart, exportDxf, importDxf, parseDxf, readGroups, splineSamples } from '@/cam/dxf'
import { area, boxOf, circle, type Contour, pt, radius, roundedRect } from '@/cam/geom'
import { pdfVectors, type PdfLib } from '@/cam/pdfVectors'

/** Minimal DXF writer for fixtures: pairs of (code, value). */
const dxf = (sections: (string | number)[][]) => [...sections.flat(), 0, 'EOF'].join('\n') + '\n'
const ent = (type: string, ...kv: (string | number)[]) => [0, type, ...kv]
const header = (insunits: number) => [0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, insunits, 0, 'ENDSEC']
const entities = (...es: (string | number)[][]) => [0, 'SECTION', 2, 'ENTITIES', ...es.flat(), 0, 'ENDSEC']
const arcs = (c: Contour) => c.segs.filter((s) => s.k === 'A')

describe('DXF import', () => {
  it('reads groups and sections', () => {
    expect(readGroups('0\nSECTION\n2\nHEADER\n')).toEqual([
      { code: 0, value: 'SECTION' },
      { code: 2, value: 'HEADER' },
    ])
    expect(() => readGroups('hello\nworld\n')).toThrow(/Not a DXF/)
    const d = parseDxf(dxf([header(4), entities(ent('LINE', 8, 'A', 10, 0, 20, 0, 11, 10, 21, 0))]))
    expect(d.header.$INSUNITS[0].value).toBe('4')
    expect(d.entities[0].type).toBe('LINE')
  })

  it('joins loose lines and arcs into a closed outline within the join tolerance', () => {
    // 100 x 60 with a R10 rounded top-right corner, drawn as separate pieces with 0.02 gaps
    const text = dxf([
      header(4),
      entities(
        ent('LINE', 8, 'OUTLINE', 10, 0, 20, 0, 11, 100, 21, 0),
        ent('LINE', 8, 'OUTLINE', 10, 100.02, 20, 0, 11, 100, 21, 50),
        ent('ARC', 8, 'OUTLINE', 10, 90, 20, 50, 40, 10, 50, 0, 51, 90),
        ent('LINE', 8, 'OUTLINE', 10, 90, 20, 60, 11, 0, 21, 60),
        ent('LINE', 8, 'OUTLINE', 10, 0, 20, 60.02, 11, 0, 21, 0),
      ),
    ])
    const r = importDxf(text, { joinTol: 0.05 })
    expect(r.counts.closed).toBe(1)
    expect(r.counts.open).toBe(0)
    const c = entityContours(r.entities[0])[0]
    expect(arcs(c)).toHaveLength(1)
    expect(radius(arcs(c)[0] as never)).toBeCloseTo(10, 9)
    expect(Math.abs(area(c))).toBeCloseTo(100 * 60 - 100 + 25 * Math.PI, 0)
    expect(importDxf(text, { joinTol: 0.001 }).counts.closed).toBe(0)
    // tangent-only join keeps the sharp corners apart, so only line-arc-line chains survive
    const t = importDxf(text, { joinTol: 0.05, tangentOnly: true })
    expect(t.counts.closed).toBe(0)
    expect(t.counts.open).toBe(3)
  })

  it('combines collinear pieces and reads LWPOLYLINE bulges, circles, points, text', () => {
    const text = dxf([
      header(4),
      entities(
        ent('LINE', 8, 'CUT', 10, 0, 20, 0, 11, 40, 21, 0),
        ent('LINE', 8, 'CUT', 10, 40, 20, 0, 11, 80, 21, 0),
        // slot: two lines and two half-circle bulges
        ent('LWPOLYLINE', 8, 'SLOT', 90, 4, 70, 1, 10, 10, 20, 10, 10, 50, 20, 10, 42, 1, 10, 50, 20, 20, 10, 10, 20, 20, 42, 1),
        ent('CIRCLE', 8, 'HOLES', 10, 30, 20, 30, 40, 2.5),
        ent('POINT', 8, 'HOLES', 10, 5, 20, 5),
        ent('TEXT', 8, 'TEXT', 10, 0, 20, 40, 40, 5, 1, 'PART A', 50, 0),
        ent('HATCH', 8, 'X'),
      ),
    ])
    const r = importDxf(text)
    const cut = r.entities.filter((e) => e.layer === 'dxf-cut').flatMap(entityContours)
    expect(cut).toHaveLength(1)
    expect(cut[0].segs).toHaveLength(1)
    const slot = r.entities.find((e) => e.layer === 'dxf-slot')!
    const sc = entityContours(slot)[0]
    expect(sc.closed).toBe(true)
    expect(arcs(sc)).toHaveLength(2)
    expect(Math.abs(area(sc))).toBeCloseTo(40 * 10 + Math.PI * 25, 6)
    expect(r.entities.find((e) => e.g.t === 'circle')).toBeTruthy()
    expect(r.entities.find((e) => e.g.t === 'point')).toBeTruthy()
    expect(r.entities.find((e) => e.g.t === 'text' && e.g.text === 'PART A')).toBeTruthy()
    expect(r.layers.map((l) => l.name).sort()).toEqual(['CUT', 'HOLES', 'SLOT', 'TEXT'])
    expect(r.warnings.join(' ')).toMatch(/HATCH/)
  })

  it('applies drawing units, block inserts with arrays, and mirrored arcs', () => {
    const text = dxf([
      header(1),
      [0, 'SECTION', 2, 'BLOCKS', 0, 'BLOCK', 2, 'HOLE', 10, 0, 20, 0, 0, 'CIRCLE', 8, '0', 10, 0, 20, 0, 40, 0.125, 0, 'ENDBLK', 0, 'ENDSEC'],
      entities(
        ent('INSERT', 8, 'HOLES', 2, 'HOLE', 10, 1, 20, 1, 70, 3, 71, 2, 44, 1, 45, 2),
        // arc in a mirrored OCS (extrusion -Z): centre (2,0) becomes (-2,0)
        ent('ARC', 8, 'M', 10, 2, 20, 0, 40, 1, 50, 0, 51, 90, 210, 0, 220, 0, 230, -1),
      ),
    ])
    const r = importDxf(text)
    expect(r.unitName).toBe('inches')
    const holes = r.entities.filter((e) => e.g.t === 'circle')
    expect(holes).toHaveLength(6)
    expect(holes.every((h) => h.layer === 'dxf-holes')).toBe(true)
    const xs = holes.map((h) => (h.g as { c: { x: number } }).c.x).sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(25.4, 6)
    expect(xs[5]).toBeCloseTo(3 * 25.4, 6)
    expect((holes[0].g as { r: number }).r).toBeCloseTo(3.175, 6)
    const m = entityContours(r.entities.find((e) => e.layer === 'dxf-m')!)[0]
    expect((m.segs[0] as { c: { x: number } }).c.x).toBeCloseTo(-2 * 25.4, 6)
    expect(importDxf(text, { units: 'mm' }).scale).toBe(1)
  })

  it('samples splines and ellipses and fits them to lines and arcs', () => {
    // a degree-2 NURBS circle quadrant (exact quarter circle radius 50)
    const w = Math.SQRT1_2
    const q = splineSamples(2, [0, 0, 0, 1, 1, 1], [pt(50, 0), pt(50, 50), pt(0, 50)], [1, w, 1])
    expect(q.every((p) => Math.abs(Math.hypot(p.x, p.y) - 50) < 1e-9)).toBe(true)
    const text = dxf([
      header(4),
      entities(
        ent('SPLINE', 8, 'S', 70, 8, 71, 2, 72, 6, 73, 3, 40, 0, 40, 0, 40, 0, 40, 1, 40, 1, 40, 1, 41, 1, 41, w, 41, 1, 10, 50, 20, 0, 10, 50, 20, 50, 10, 0, 20, 50),
        ent('ELLIPSE', 8, 'E', 10, 0, 20, 0, 11, 100, 21, 0, 40, 0.5, 41, 0, 42, 2 * Math.PI),
      ),
    ])
    const r = importDxf(text)
    const s = entityContours(r.entities.find((e) => e.layer === 'dxf-s')!)[0]
    expect(arcs(s).length).toBeGreaterThanOrEqual(1)
    expect(s.segs.length).toBeLessThanOrEqual(2)
    const e = entityContours(r.entities.find((x) => x.layer === 'dxf-e')!)[0]
    expect(e.closed).toBe(true)
    expect(Math.abs(area(e))).toBeCloseTo(Math.PI * 100 * 50, -1)
  })

  it('builds a part with the largest closed shape as the outline at the origin', () => {
    const text = dxf([
      header(4),
      entities(ent('LWPOLYLINE', 8, 'OUT', 90, 4, 70, 1, 10, 100, 20, 100, 10, 400, 20, 100, 10, 400, 20, 300, 10, 100, 20, 300), ent('CIRCLE', 8, 'HOLES', 10, 150, 20, 150, 40, 4)),
    ])
    const { part } = dxfToPart(text, 'Bracket', { thickness: 18 })
    expect(part.length).toBe(300)
    expect(part.width).toBe(200)
    expect(part.thickness).toBe(18)
    expect(boxOf([partOutline(part).contour])).toMatchObject({ minX: 0, minY: 0, maxX: 300, maxY: 200 })
    const hole = part.entities.find((e) => e.g.t === 'circle')!
    expect((hole.g as { c: { x: number } }).c.x).toBeCloseTo(50, 9)
  })
})

describe('DXF export', () => {
  it('round-trips outline arcs, holes and text through R12', () => {
    let part = newPart({ length: 500, width: 300, entities: [] })
    const outline = makeEntity({ t: 'contour', c: roundedRect(0, 0, 500, 300, 40) }, 'outline')
    part = { ...part, entities: [outline, makeEntity({ t: 'circle', c: pt(100, 100), r: 17.5 }, 'holes'), makeEntity({ t: 'text', at: pt(50, 200), text: 'DOOR', height: 20, angle: 0 }, 'text')], outlineId: outline.id }
    const text = exportDxf(part, { toolpaths: [{ name: 'Profile', contours: [circle(pt(250, 150), 30)] }] })
    expect(text).toMatch(/AC1009/)
    expect(text.includes('\r\n')).toBe(true)
    const back = importDxf(text)
    expect(back.unitName).toBe('millimetres')
    const out = back.entities.find((e) => e.layer === 'dxf-outline')!
    const c = entityContours(out)[0]
    expect(c.closed).toBe(true)
    expect(arcs(c)).toHaveLength(4)
    expect(Math.abs(area(c))).toBeCloseTo(Math.abs(area(roundedRect(0, 0, 500, 300, 40))), 4)
    expect(back.entities.find((e) => e.g.t === 'circle' && Math.abs(e.g.r - 17.5) < 1e-9)).toBeTruthy()
    expect(back.entities.find((e) => e.g.t === 'text')).toBeTruthy()
    expect(back.layers.map((l) => l.name)).toContain('TOOLPATH_PROFILE')
  })
})

describe('PDF / AI vectors', () => {
  it('reads lines, rectangles and curves and fits curves to arcs', async () => {
    const doc = new jsPDF({ unit: 'mm', format: [300, 200], orientation: 'landscape' })
    doc.setDrawColor(255, 0, 0)
    doc.rect(20, 20, 100, 60)
    doc.setDrawColor(0, 0, 255)
    doc.circle(200, 100, 40)
    doc.line(10, 150, 280, 150)
    const data = new Uint8Array(doc.output('arraybuffer'))
    const v = await pdfVectors(pdfjs as unknown as PdfLib, data)
    expect(v.pages).toBe(1)
    const cs = v.entities.flatMap(entityContours)
    const rect = cs.find((c) => c.closed && c.segs.every((s) => s.k === 'L'))!
    const b = boxOf([rect])
    expect(b.maxX - b.minX).toBeCloseTo(100, 2)
    expect(b.maxY - b.minY).toBeCloseTo(60, 2)
    const circ = cs.find((c) => c.closed && arcs(c).length > 0)!
    expect(arcs(circ).every((s) => Math.abs(radius(s as never) - 40) < 0.1)).toBe(true)
    expect(Math.abs(area(circ))).toBeCloseTo(Math.PI * 1600, -1)
    expect(cs.find((c) => !c.closed)).toBeTruthy()
    expect(v.layers.length).toBeGreaterThanOrEqual(2)
  })
  it('reports text-only pages', async () => {
    const doc = new jsPDF()
    doc.text('Hinge spec sheet', 20, 20)
    const v = await pdfVectors(pdfjs as unknown as PdfLib, new Uint8Array(doc.output('arraybuffer')))
    expect(v.entities).toHaveLength(0)
    expect(v.textOnly).toBe(true)
  })
})
