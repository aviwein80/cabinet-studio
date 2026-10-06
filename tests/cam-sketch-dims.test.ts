/**
 * M2.7b: turn-by-turn sketch (CAD-02) and dimensions (CAD-08). The sketch solves door outlines
 * with two unknowns; dimensions follow the geometry when it changes and show inch fractions.
 */
import { describe, expect, it } from 'vitest'
import { moveNode, transformEntities } from '@/cam/cad'
import { makeEntity, newPart } from '@/cam/doc'
import { area, contourLength, rect, translateM, type ArcSeg } from '@/cam/geom'
import { brokenDims, circleRefAt, dimText, linearAxis, measureAngle, measureDim, refAt } from '@/cam/dims'
import { SAMPLE_SKETCH, solveTurnSketch, unknownCount, sketchProblem } from '@/cam/turnSketch'
import { DEFAULT_PRINT, printPdf, printPlan } from '@/cam/print'
import type { CamPart, Dimension, TurnSketch } from '@/cam/types'

const L = (length: number | null, angle: number | null, angleMode: 'absolute' | 'turn' = 'absolute') => ({ kind: 'line' as const, length, angle, angleMode })
const A = (radius: number | null, sweep: number | null, angle: number | null, ccw = true, angleMode: 'absolute' | 'turn' = 'turn') => ({ kind: 'arc' as const, length: sweep, angle, angleMode, radius, ccw })

describe('M2.7b turn-by-turn sketch (CAD-02)', () => {
  it('door with a raked top: the top length and angle are unknown; the solver closes the outline', () => {
    // 450 wide, 600 high on the right, 700 on the left
    const sk: TurnSketch = { start: { x: 0, y: 0 }, closed: true, elements: [L(450, 0), L(600, 90), L(null, null), L(700, 270)] }
    expect(unknownCount(sk)).toBe(2)
    const r = solveTurnSketch(sk)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const u = Object.fromEntries(r.solution.unknowns.map((x) => [`${x.element}.${x.field}`, x.value]))
    expect(u['2.length']).toBeCloseTo(Math.hypot(450, 100), 9)
    expect(u['2.angle']).toBeCloseTo((Math.atan2(100, -450) * 180) / Math.PI, 9)
    expect(r.solution.contour.closed).toBe(true)
    expect(Math.abs(area(r.solution.contour))).toBeCloseTo(450 * 600 + (450 * 100) / 2, 6)
    expect(r.solution.points[2].x).toBeCloseTo(450, 9)
    expect(r.solution.points[3]).toMatchObject({ x: expect.closeTo(0, 9), y: expect.closeTo(700, 9) })
  })

  it('arched door, arch tangent to both sides: right side length and arch radius unknown', () => {
    const sk: TurnSketch = { start: { x: 0, y: 0 }, closed: true, elements: [L(450, 0), L(null, 90, 'turn'), A(null, 180, 0), L(600, 0, 'turn')] }
    const r = solveTurnSketch(sk)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const u = Object.fromEntries(r.solution.unknowns.map((x) => [`${x.element}.${x.field}`, x.value]))
    expect(u['1.length']).toBeCloseTo(600, 9)
    expect(u['2.radius']).toBeCloseTo(225, 9)
    const arcSeg = r.solution.contour.segs.find((s) => s.k === 'A') as ArcSeg
    expect(arcSeg.c.x).toBeCloseTo(225, 9)
    expect(arcSeg.c.y).toBeCloseTo(600, 9)
    expect(Math.abs(area(r.solution.contour))).toBeCloseTo(450 * 600 + (Math.PI * 225 * 225) / 2, 6)
  })

  it('pointed (gothic) door: two 400 mm arcs meet at the peak; the right side and the turn at the peak are unknown; corners blended', () => {
    const sk: TurnSketch = {
      start: { x: 0, y: 0 },
      closed: true,
      elements: [
        { ...L(400, 0), corner: { kind: 'blend', size: 10 } },
        L(null, 90, 'turn'),
        A(400, 60, 0, true),
        A(400, 60, null, true, 'absolute'),
        { ...L(500, 270), corner: { kind: 'chamfer', size: 5 } },
      ],
    }
    expect(unknownCount(sk)).toBe(2)
    const r = solveTurnSketch(sk)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const u = Object.fromEntries(r.solution.unknowns.map((x) => [`${x.element}.${x.field}`, x.value]))
    expect(u['1.length']).toBeCloseTo(500, 7)
    // the second arc starts square to its radius from (400, 500): heading 210°, a 60° turn at the peak
    expect(u['3.angle']).toBeCloseTo(210, 7)
    expect(r.solution.points[3]).toMatchObject({ x: expect.closeTo(200, 7), y: expect.closeTo(500 + Math.sqrt(400 * 400 - 200 * 200), 7) })
    // blend at the end of the bottom line and a chamfer at the end of the left side: 2 extra segments
    expect(r.solution.contour.segs.length).toBe(7)
    expect(r.solution.contour.segs.filter((s) => s.k === 'A')).toHaveLength(3)
  })

  it('two unknown directions: both elbows are found, in a fixed order, and either can be chosen', () => {
    const sk: TurnSketch = { start: { x: 0, y: 0 }, closed: true, elements: [L(300, 0), L(200, null), L(200, null), L(150, 270)] }
    const r = solveTurnSketch(sk)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.solutions.length).toBe(2)
    expect(r.warnings.join(' ')).toMatch(/2 outlines fit/)
    const other = solveTurnSketch(sk, 1)
    expect(other.ok && other.solution.points[2]).not.toEqual(r.solution.points[2])
    // the same input gives the same answers
    expect(JSON.stringify(solveTurnSketch(sk))).toBe(JSON.stringify(r))
  })

  it('too many unknowns, conflicting values and bad sizes are refused in plain words', () => {
    expect(sketchProblem({ start: { x: 0, y: 0 }, closed: true, elements: [L(null, 0), L(null, 90), L(null, null)] })).toMatch(/4 unknown values .* give 2 more/)
    const r = solveTurnSketch({ start: { x: 0, y: 0 }, closed: true, elements: [L(100, 0), L(100, 90), L(100, 180), L(50, 270)] })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/No outline fits/)
    expect(sketchProblem({ start: { x: 0, y: 0 }, closed: true, elements: [L(0, 0), L(10, 90)] })).toMatch(/above zero/)
  })

  it('an open chain with every value given is just drawn', () => {
    const r = solveTurnSketch({ start: { x: 10, y: 20 }, closed: false, elements: [L(50, 0), A(25, 90, 0)] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(contourLength(r.solution.contour)).toBeCloseTo(50 + (Math.PI * 25) / 2, 9)
    expect(r.solution.points[2]).toMatchObject({ x: expect.closeTo(85, 9), y: expect.closeTo(45, 9) })
  })
})

describe('M2.7b dimensions (CAD-08)', () => {
  function part(): CamPart {
    const p = newPart({ name: 'Dims', length: 600, width: 400 })
    const box = makeEntity({ t: 'contour', c: rect(0, 0, 450.85, 300) }, 'outline')
    box.id = 'box'
    const hole = makeEntity({ t: 'circle', c: { x: 200, y: 150 }, r: 17.5 }, 'drill')
    hole.id = 'hole'
    p.entities = [box, hole]
    return p
  }

  it('linear dimensions refer to nodes and update live when the geometry changes; inches show as fractions', () => {
    let p = part()
    const a = refAt(p, { x: 0.2, y: 0 }, 1)
    const b = refAt(p, { x: 450.85, y: 0.3 }, 1)
    expect(a).toEqual({ entity: 'box', at: 'node', index: 0 })
    expect(b).toEqual({ entity: 'box', at: 'node', index: 1 })
    const d: Dimension = { id: 'd1', kind: 'horizontal', refs: [a, b], offset: -20 }
    p = { ...p, dims: [d] }
    const g = measureDim(p, d)!
    expect(g.value).toBeCloseTo(450.85, 9)
    expect(dimText(d, g, 'in')).toBe('17-3/4"')
    expect(dimText(d, g, 'mm')).toBe('450.85')
    expect(dimText({ ...d, alt: true }, g, 'in')).toBe('17-3/4" [450.85 mm]')
    // move the corner: the dimension follows
    p = moveNode(p, 'box', 1, { x: 609.6, y: 0 })
    expect(measureDim(p, d)!.value).toBeCloseTo(609.6, 9)
    expect(dimText(d, measureDim(p, d)!, 'in')).toBe('24"')
    // move the whole shape: same length, the dimension moves with it
    p = transformEntities(p, ['box'], translateM(30, 40)).part
    const g2 = measureDim(p, d)!
    expect(g2.value).toBeCloseTo(609.6, 9)
    expect(g2.lines[2][0]).toMatchObject({ x: expect.closeTo(30, 9), y: expect.closeTo(20, 9) })
  })

  it('aligned, vertical, angular, radius, diameter and ordinate', () => {
    const p = { ...part(), dimOrigin: { x: 0, y: 0 } }
    const n = (i: number) => ({ entity: 'box', at: 'node' as const, index: i })
    const v = measureDim(p, { id: 'v', kind: 'vertical', refs: [n(1), n(2)], offset: 15 })!
    expect(v.value).toBeCloseTo(300, 9)
    const al = measureDim(p, { id: 'a', kind: 'aligned', refs: [n(0), n(2)], offset: 10 })!
    expect(al.value).toBeCloseTo(Math.hypot(450.85, 300), 9)
    const ang = measureDim(p, { id: 'g', kind: 'angular', refs: [n(0), n(1), n(2)], offset: 60 })!
    expect(ang.value).toBeCloseTo((Math.atan2(300, 450.85) * 180) / Math.PI, 9)
    expect(measureDim(p, { id: 'g2', kind: 'angular', refs: [n(0), n(1), n(2)], offset: 60, side: 'other' })!.value).toBeCloseTo(360 - (Math.atan2(300, 450.85) * 180) / Math.PI, 9)
    const hole = circleRefAt(p, 'hole', { x: 217, y: 150 })!
    const r = measureDim(p, { id: 'r', kind: 'radius', refs: [hole], offset: 0.5 })!
    const dd = { id: 'd', kind: 'diameter' as const, refs: [hole], offset: 0.5 }
    expect(r.value).toBe(17.5)
    expect(dimText(dd, measureDim(p, dd)!, 'in')).toBe('Ø1-3/8"')
    const ox = measureDim(p, { id: 'o', kind: 'ordinate', refs: [refAt(p, { x: 200, y: 150 }, 1)], offset: 40, axis: 'x' })!
    expect(ox.value).toBe(200)
    expect(measureDim({ ...p, dimOrigin: { x: 50, y: 0 } }, { id: 'o', kind: 'ordinate', refs: [refAt(p, { x: 200, y: 150 }, 1)], offset: 40, axis: 'x' })!.value).toBe(150)
  })

  it('the dimension line goes where it is put: horizontal above or below, vertical beside, aligned at an angle', () => {
    const a = { x: 0, y: 0 }
    const b = { x: 100, y: 50 }
    expect(linearAxis(a, b, { x: 50, y: 80 })).toBe('horizontal')
    expect(linearAxis(a, b, { x: 130, y: 20 })).toBe('vertical')
    expect(linearAxis(a, b, { x: 120, y: 90 })).toBe('aligned')
  })

  it('a dimension whose shape is gone is listed as broken, not drawn', () => {
    const p = part()
    const d: Dimension = { id: 'd', kind: 'diameter', refs: [{ entity: 'gone', at: 'centre', index: 0 }], offset: 0 }
    expect(measureDim(p, d)).toBeNull()
    expect(brokenDims({ ...p, dims: [d] })).toHaveLength(1)
  })

  it('measure an angle at a vertex', () => {
    const m = measureAngle({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: -10 })
    expect(m.inside).toBeCloseTo(90, 9)
    expect(m.outside).toBeCloseTo(270, 9)
  })
})

describe('M2.7b print to scale (CAD-08)', () => {
  const part = () => {
    const p = newPart({ name: 'Template', length: 1200, width: 600 })
    const e = makeEntity({ t: 'contour', c: rect(0, 0, 1200, 600) }, 'outline')
    e.id = 'r'
    p.entities = [e]
    p.dims = [{ id: 'd', kind: 'horizontal', refs: [{ entity: 'r', at: 'node', index: 0 }, { entity: 'r', at: 'node', index: 1 }], offset: -30 }]
    return p
  }
  const len = (l: { x: number; y: number }[]) => l.slice(1).reduce((n, b, i) => n + Math.hypot(b.x - l[i].x, b.y - l[i].y), 0)

  it('1:10 fits one letter sheet: the 1200 x 600 outline is 120 x 60 mm on paper; the dimension text is in inches', () => {
    const plan = printPlan(part(), { ...DEFAULT_PRINT, scale: 10, units: 'in' })
    expect(plan.pages).toHaveLength(1)
    const pg = plan.pages[0]
    const outline = pg.lines[0]
    expect(len(outline)).toBeCloseTo(360, 6)
    const xs = outline.map((p) => p.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(120, 9)
    expect(pg.texts.map((t) => t.text)).toEqual(['47-1/4"'])
    expect(plan.bar.length).toBeCloseTo(101.6, 9)
  })

  it('full size over several sheets: every part of the outline is printed, sheets overlap by the set strip, nothing leaves the drawing area', () => {
    const plan = printPlan(part(), { ...DEFAULT_PRINT, scale: 1, dims: false })
    expect(plan.cols * plan.rows).toBe(plan.pages.length)
    expect(plan.pages.length).toBeGreaterThan(4)
    let total = 0
    for (const pg of plan.pages)
      for (const l of pg.lines) {
        for (const p of l) {
          expect(p.x).toBeGreaterThanOrEqual(plan.area.x - 1e-9)
          expect(p.x).toBeLessThanOrEqual(plan.area.x + plan.area.w + 1e-9)
          expect(p.y).toBeGreaterThanOrEqual(plan.area.y - 1e-9)
          expect(p.y).toBeLessThanOrEqual(plan.area.y + plan.area.h + 1e-9)
        }
        total += len(l)
      }
    // the perimeter (3600 mm) plus what is printed twice in the overlap strips
    expect(total).toBeGreaterThanOrEqual(3600 - 1e-6)
    expect(total).toBeLessThan(3600 + (plan.cols + plan.rows) * 2 * 10 + 1e-6)
    // neighbouring sheets start one drawing area less the overlap apart
    expect(plan.pages[1].origin.x - plan.pages[0].origin.x).toBeCloseTo(plan.area.w - 10, 9)
  })

  it('the PDF draws at the size on paper: the 100 mm check bar is 283.46 pt long', () => {
    const p = part()
    const plan = printPlan(p, { ...DEFAULT_PRINT, scale: 5 })
    const pdf = new TextDecoder('latin1').decode(printPdf(p, plan, { ...DEFAULT_PRINT, scale: 5 }))
    const segs = [...pdf.matchAll(/([\d.]+) ([\d.]+) m\s*\n?([\d.]+) ([\d.]+) l/g)].map((m) => Math.hypot(Number(m[3]) - Number(m[1]), Number(m[4]) - Number(m[2])))
    expect(segs.some((s) => Math.abs(s - (100 * 72) / 25.4) < 0.01)).toBe(true)
    // the 1200 mm bottom edge at 1:5 is 240 mm on paper
    expect(segs.some((s) => Math.abs(s - (240 * 72) / 25.4) < 0.01)).toBe(true)
    // deterministic
    expect(new TextDecoder('latin1').decode(printPdf(p, plan, { ...DEFAULT_PRINT, scale: 5 }))).toBe(pdf)
  })
})

describe('M2.7b the sketch the dialog opens with', () => {
  it('is a door with two unknowns that solves', () => {
    expect(unknownCount(SAMPLE_SKETCH)).toBe(2)
    const r = solveTurnSketch(SAMPLE_SKETCH)
    expect(r.ok && r.solution.unknowns.map((u) => Math.round(u.value * 1000) / 1000)).toEqual([600, 225])
  })
})
