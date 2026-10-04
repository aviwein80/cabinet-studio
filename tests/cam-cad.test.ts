import { describe, expect, it } from 'vitest'
import { booleanEntities, chamferAt, deleteEntities, deleteNode, filletAll, filletAt, insertNode, moveNode, offsetEntity, reliefAt, setArcRadius, toggleArc, transformEntities, trimAt, arrayEntities, moveM, joinEntities, breakEntity } from '@/cam/cad'
import { entityContours, makeEntity, newPart } from '@/cam/doc'
import { evalLength, evaluate, parseCoord, resolveVariables } from '@/cam/expr'
import { area, boxOf, circle, type Contour, line, polyline, pt, radius, rect } from '@/cam/geom'
import { ALL_SNAPS, snap, type SnapContext } from '@/cam/snap'
import type { CamPart } from '@/cam/types'

const ctx = (contours: Contour[], extra: Partial<SnapContext> = {}): SnapContext => ({ contours, points: [], modes: new Set(ALL_SNAPS), tol: 2, grid: 10, ortho: false, enabled: true, ...extra })
const outline = (p: CamPart) => entityContours(p.entities.find((e) => e.id === p.outlineId)!)[0]
const arcs = (c: Contour) => c.segs.filter((s) => s.k === 'A')

describe('numeric prompt', () => {
  it('evaluates expressions with variables, functions and units', () => {
    expect(evaluate('2+3*4')).toBe(14)
    expect(evaluate('(2+3)*4^2')).toBe(80)
    expect(evaluate('W/2 - rail', { W: 400, rail: 70 })).toBe(130)
    expect(evaluate('sin(30)')).toBeCloseTo(0.5, 9)
    expect(evaluate('hyp(3,4)')).toBe(5)
    expect(evaluate('-2^2')).toBe(-4)
    expect(() => evaluate('2+')).toThrow()
    expect(() => evaluate('foo')).toThrow(/Unknown/)
  })
  it('reads lengths in the display unit, with suffixes and inch fractions', () => {
    expect(evalLength('10', 'mm')).toBe(10)
    expect(evalLength('1in', 'mm')).toBeCloseTo(25.4, 9)
    expect(evalLength('2', 'in')).toBeCloseTo(50.8, 9)
    expect(evalLength('23-1/4', 'in')).toBeCloseTo(23.25 * 25.4, 6)
    expect(evalLength('3/4', 'in')).toBeCloseTo(19.05, 6)
    expect(evalLength('10mm+1', 'in')).toBeCloseTo(10 + 25.4, 6)
  })
  it('parses absolute, relative and polar coordinates', () => {
    expect(parseCoord('100,50', 'mm')).toEqual({ kind: 'abs', x: 100, y: 50 })
    expect(parseCoord('@10,-5', 'mm')).toEqual({ kind: 'rel', dx: 10, dy: -5 })
    const p = parseCoord('@100<30', 'mm')
    expect(p.kind).toBe('polar')
    if (p.kind === 'polar') {
      expect(p.rel).toBe(true)
      expect(p.d).toBe(100)
      expect(p.a).toBe(30)
    }
    expect(parseCoord('max(1,2),3', 'mm')).toEqual({ kind: 'abs', x: 2, y: 3 })
    expect(parseCoord('W', 'mm', { W: 12 })).toEqual({ kind: 'value', v: 12 })
    expect(parseCoord('?', 'mm')).toEqual({ kind: 'unknown' })
  })
  it('resolves variables that depend on each other in any order', () => {
    const v = resolveVariables([
      { name: 'panel', value: 0, expr: 'W - 2*stile' },
      { name: 'W', value: 400 },
      { name: 'stile', value: 70 },
    ])
    expect(v.panel).toBe(260)
  })
})

describe('snaps', () => {
  const sq = rect(0, 0, 100, 60)
  const ring = circle(pt(200, 0), 50)
  it('finds end, mid, centre and quadrant points', () => {
    expect(snap(ctx([sq]), pt(99, 1)).kind).toBe('end')
    expect(snap(ctx([sq]), pt(99, 1)).p).toEqual(pt(100, 0))
    const m = snap(ctx([sq]), pt(50.5, 0.4))
    expect(m.kind).toBe('mid')
    expect(m.p.x).toBeCloseTo(50, 9)
    expect(snap(ctx([ring]), pt(201, 1)).kind).toBe('centre')
    const q = snap(ctx([ring]), pt(201, 49.5))
    expect(q.kind).toBe('quadrant')
    expect(q.p.y).toBeCloseTo(50, 9)
  })
  it('finds intersections, perpendicular and tangent points', () => {
    const a = polyline([pt(0, 0), pt(100, 100)], false)
    const b = polyline([pt(0, 100), pt(100, 0)], false)
    const x = snap(ctx([a, b], { modes: new Set(['intersection']) }), pt(51, 49))
    expect(x.kind).toBe('intersection')
    expect(x.p.x).toBeCloseTo(50, 9)
    const perp = snap(ctx([sq], { modes: new Set(['perpendicular']), last: pt(30, -40) }), pt(30.5, 0.5))
    expect(perp.kind).toBe('perpendicular')
    expect(perp.p.x).toBeCloseTo(30, 9)
    const tan = snap(ctx([ring], { modes: new Set(['tangent']), last: pt(200, 100), tol: 10 }), pt(160, 30))
    expect(tan.kind).toBe('tangent')
    expect(Math.hypot(tan.p.x - 200, tan.p.y)).toBeCloseTo(50, 6)
  })
  it('falls back to grid, ortho and alignment', () => {
    expect(snap(ctx([], { modes: new Set(['grid']) }), pt(13, 27)).p).toEqual(pt(10, 30))
    const o = snap(ctx([], { modes: new Set(), ortho: true, last: pt(0, 0) }), pt(80, 7))
    expect(o.kind).toBe('ortho')
    expect(o.p).toEqual(pt(80, 0))
    const al = snap(ctx([sq], { modes: new Set(['align']) }), pt(101, 200))
    expect(al.kind).toBe('align')
    expect(al.p.x).toBe(100)
    expect(al.guides).toHaveLength(1)
    expect(snap(ctx([sq], { enabled: false }), pt(99, 1)).kind).toBe('free')
  })
})

describe('part CAD commands', () => {
  it('draws a door outline, fillets corners and keeps the outline id', () => {
    let p = newPart({ length: 700, width: 400 })
    const id = p.outlineId!
    p = filletAt(p, id, pt(699, 399), 25)
    expect(p.outlineId).toBe(id)
    expect(arcs(outline(p))).toHaveLength(1)
    expect(radius(arcs(outline(p))[0] as never)).toBeCloseTo(25, 6)
    p = filletAll(p, id, 10)
    expect(arcs(outline(p)).length).toBeGreaterThanOrEqual(4)
    p = chamferAt(newPart(), newPart().outlineId!, pt(0, 0), 5)
    expect(p.entities).toHaveLength(1)
  })
  it('cuts T-bone reliefs into an inside pocket corner', () => {
    let p = newPart()
    const pocket = makeEntity({ t: 'contour', c: rect(100, 100, 200, 120) }, 'machining')
    p = { ...p, entities: [...p.entities, pocket] }
    p = reliefAt(p, pocket.id, null, 6, 'tbone-in', 'interior')
    const c = entityContours(p.entities.find((e) => e.id === pocket.id)!)[0]
    expect(arcs(c).length).toBe(4)
    expect(arcs(c).every((s) => Math.abs(radius(s as never) - 6) < 1e-6)).toBe(true)
    expect(Math.abs(area(c))).toBeGreaterThan(200 * 120)
  })
  it('booleans keep arcs as arcs', () => {
    let p = newPart({ length: 600, width: 400 })
    const hole = makeEntity({ t: 'circle', c: pt(600, 200), r: 50 }, 'outline')
    p = { ...p, entities: [...p.entities, hole] }
    p = booleanEntities(p, 'subtract', [p.outlineId!], [hole.id])
    const c = outline(p)
    expect(p.entities).toHaveLength(1)
    const as = arcs(c)
    expect(as.length).toBeGreaterThanOrEqual(1)
    expect(as.every((s) => Math.abs(radius(s as never) - 50) < 1e-3)).toBe(true)
    expect(Math.abs(area(c))).toBeCloseTo(600 * 400 - (Math.PI * 50 * 50) / 2, 0)
  })
  it('offsets toward a side, trims, breaks, joins and transforms', () => {
    let p = newPart()
    const id = p.outlineId!
    p = offsetEntity(p, id, 10, pt(300, 200))
    const inner = entityContours(p.entities[1])[0]
    expect(boxOf([inner])).toMatchObject({ minX: 10, minY: 10, maxX: 590, maxY: 390 })
    p = offsetEntity(p, id, 10, pt(-50, -50))
    expect(Math.abs(area(entityContours(p.entities[2])[0]))).toBeGreaterThan(600 * 400)

    let q = newPart({ entities: [] })
    const l1 = makeEntity({ t: 'contour', c: { closed: false, segs: [line(pt(0, 50), pt(100, 50))] } }, 'machining')
    const l2 = makeEntity({ t: 'contour', c: { closed: false, segs: [line(pt(50, 0), pt(50, 100))] } }, 'machining')
    q = { ...q, entities: [l1, l2] }
    q = trimAt(q, l1.id, pt(80, 50))
    const kept = entityContours(q.entities.find((e) => e.id === l1.id)!)[0]
    expect(boxOf([kept]).maxX).toBeCloseTo(50, 9)
    q = breakEntity(q, l2.id, pt(50, 30))
    expect(q.entities).toHaveLength(3)
    q = joinEntities(q, q.entities.filter((e) => e.id !== l1.id).map((e) => e.id), 0.01)
    expect(q.entities).toHaveLength(2)

    const t = transformEntities(q, [l1.id], moveM(pt(0, 0), pt(10, 0)), true)
    expect(t.part.entities).toHaveLength(3)
    expect(arrayEntities(q, [l1.id], 3, 2, 10, 10).entities).toHaveLength(2 + 5)
    expect(deleteEntities(p, [id]).outlineId).toBeUndefined()
  })
  it('edits nodes: move, insert, delete, arc toggle and radius', () => {
    let p = newPart({ length: 100, width: 100 })
    const id = p.outlineId!
    p = moveNode(p, id, 2, pt(120, 120))
    expect(boxOf([outline(p)]).maxX).toBe(120)
    p = insertNode(p, id, 0)
    expect(outline(p).segs).toHaveLength(5)
    p = deleteNode(p, id, 1)
    expect(outline(p).segs).toHaveLength(4)
    p = toggleArc(p, id, 0)
    expect(outline(p).segs[0].k).toBe('A')
    p = setArcRadius(p, id, 0, 80)
    expect(radius(outline(p).segs[0] as never)).toBeCloseTo(80, 6)
    p = toggleArc(p, id, 0)
    expect(outline(p).segs[0].k).toBe('L')
  })
})
