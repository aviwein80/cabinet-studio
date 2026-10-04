import { describe, expect, it } from 'vitest'
import {
  area,
  boxOf,
  bulgeSeg,
  chamferCorner,
  circle,
  type Contour,
  ellipse,
  filletCorner,
  fitPoints,
  mirrorM,
  pt,
  radius,
  rect,
  reliefAll,
  roundedRect,
  slot,
  sweep,
  toBulges,
  fromBulges,
  toPoints,
  transform,
  rotateM,
  scaleM,
} from '@/cam/geom'
import { autoClose, boolean, breakAt, extendTo, joinContours, offset, offsetChain, simplify, trim } from '@/cam/kernel'

const arcs = (c: Contour) => c.segs.filter((s) => s.k === 'A')

describe('geometry kernel (P0.2)', () => {
  it('exact areas with native arcs', () => {
    expect(area(rect(0, 0, 100, 50))).toBeCloseTo(5000, 9)
    expect(area(circle(pt(0, 0), 10))).toBeCloseTo(Math.PI * 100, 9)
    expect(area(roundedRect(0, 0, 100, 50, 10))).toBeCloseTo(5000 - (4 - Math.PI) * 100, 9)
    expect(area(slot(pt(0, 0), pt(50, 0), 10))).toBeCloseTo(500 + Math.PI * 25, 9)
  })

  it('offset keeps arcs and their exact radii', () => {
    const outward = offset([roundedRect(0, 0, 200, 100, 20)], 6)
    expect(outward).toHaveLength(1)
    const a = arcs(outward[0])
    expect(a.length).toBeGreaterThanOrEqual(4)
    for (const s of a) expect(radius(s as never)).toBeCloseTo(26, 6)
    expect(area(outward[0])).toBeCloseTo(212 * 112 - (4 - Math.PI) * 26 * 26, 1)
    // sharp rectangle grown with round joins gets tool-radius arcs at the corners
    const grown = offset([rect(0, 0, 100, 100)], 5)[0]
    expect(arcs(grown).length).toBe(4)
    for (const s of arcs(grown)) expect(radius(s as never)).toBeCloseTo(5, 6)
    // inward offset of a circle stays one circle
    const inner = offset([circle(pt(50, 50), 30)], -10)[0]
    expect(arcs(inner).length).toBe(inner.segs.length)
    for (const s of arcs(inner)) expect(radius(s as never)).toBeCloseTo(20, 6)
  })

  it('booleans keep arcs', () => {
    const plate = rect(0, 0, 300, 200)
    const holes = [circle(pt(60, 100), 25), circle(pt(240, 100), 25)]
    const cut = boolean('subtract', [plate], holes)
    expect(cut).toHaveLength(3)
    const holeContours = cut.filter((c) => c.segs.every((s) => s.k === 'A'))
    expect(holeContours).toHaveLength(2)
    for (const h of holeContours) for (const s of h.segs) expect(radius(s as never)).toBeCloseTo(25, 6)
    const u = boolean('unite', [rect(0, 0, 100, 100)], [circle(pt(100, 50), 30)])
    expect(u).toHaveLength(1)
    expect(arcs(u[0]).every((s) => Math.abs(radius(s as never) - 30) < 1e-9)).toBe(true)
    expect(area(u[0])).toBeCloseTo(10000 + (Math.PI * 900) / 2, 0)
    const i = boolean('intersect', [rect(0, 0, 100, 100)], [circle(pt(100, 100), 50)])
    expect(area(i[0])).toBeCloseTo((Math.PI * 2500) / 4, 0)
  })

  it('fillets lines and arcs; chamfers', () => {
    const r = rect(0, 0, 100, 60)
    const f = filletCorner(r, 1, 10)
    expect(f.segs).toHaveLength(5)
    expect(area(f)).toBeCloseTo(6000 - (1 - Math.PI / 4) * 100, 6)
    let all: Contour = r
    for (const i of [3, 2, 1, 0]) all = filletCorner(all, i, 8)
    expect(all.segs.filter((s) => s.k === 'A')).toHaveLength(4)
    const ch = chamferCorner(r, 2, 10)
    expect(area(ch)).toBeCloseTo(6000 - 50, 6)
    // line-arc fillet on a slot end
    const s = slot(pt(0, 0), pt(100, 0), 40)
    const sf = filletCorner({ segs: [...s.segs], closed: true }, 1, 5)
    expect(sf.segs.length).toBe(s.segs.length)
  })

  it('T-bone and dog-bone relief only at corners the tool cannot reach', () => {
    const pocket = rect(0, 0, 100, 60)
    const t = reliefAll(pocket, 6, 'tbone-in', 'interior')
    expect(arcs(t)).toHaveLength(4)
    for (const s of arcs(t)) {
      expect(radius(s as never)).toBeCloseTo(6, 9)
      expect(Math.abs(sweep(s as never))).toBeCloseTo(Math.PI, 9)
    }
    expect(area(t)).toBeCloseTo(6000 + 4 * (Math.PI * 36) / 2, 6)
    const box = boxOf([t])
    // tbone-in runs each relief along the incoming edge, so it bulges past the next wall
    expect([box.minX, box.minY, box.maxX, box.maxY].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([-6, -6, 106, 66])
    // an outside profile of a rectangle has no corners the tool cannot reach
    expect(reliefAll(pocket, 6, 'dogbone', 'exterior').segs).toHaveLength(4)
    const d = reliefAll(pocket, 6, 'dogbone', 'interior')
    expect(arcs(d)).toHaveLength(4)
    expect(area(d)).toBeGreaterThan(6000)
  })

  it('fits polylines back into arcs and lines; bulge round trip; transforms', () => {
    const pts = toPoints(roundedRect(0, 0, 80, 40, 10), 0.001)
    const segs = fitPoints(pts, true)
    expect(segs.filter((s) => s.k === 'L')).toHaveLength(4)
    expect(segs.filter((s) => s.k === 'A').length).toBe(4)
    const e = ellipse(pt(0, 0), 50, 30)
    expect(e.segs.every((s) => s.k === 'A')).toBe(true)
    expect(area(e)).toBeCloseTo(Math.PI * 1500, -1)
    const c = fromBulges([pt(0, 0), pt(100, 0), pt(100, 50)], [0.4142135623730951, 0, 0], true)
    const back = toBulges(c)
    expect(back.bulges[0]).toBeCloseTo(0.4142135623730951, 9)
    expect(bulgeSeg(pt(0, 0), pt(10, 0), 1).k).toBe('A')
    const m = transform(roundedRect(0, 0, 80, 40, 10), mirrorM(pt(0, 0), pt(0, 1)))
    expect(area(m)).toBeCloseTo(-area(roundedRect(0, 0, 80, 40, 10)), 6)
    const rot = transform(circle(pt(10, 0), 5), rotateM(Math.PI / 2))
    expect(rot.segs[0].k).toBe('A')
    const sc = transform(circle(pt(0, 0), 10), scaleM(2, 1))
    expect(area(sc)).toBeCloseTo(Math.PI * 200, -1)
  })

  it('trim, break, join, extend, close, simplify, open offset', () => {
    const l = { segs: [{ k: 'L' as const, a: pt(0, 0), b: pt(100, 0) }], closed: false }
    const cutter = { segs: [{ k: 'L' as const, a: pt(40, -10), b: pt(40, 10) }], closed: false }
    const kept = trim(l, [cutter], pt(80, 0))
    expect(kept).toHaveLength(1)
    expect(kept[0].segs[0].b.x).toBeCloseTo(40, 9)
    expect(breakAt(l, pt(30, 1))).toHaveLength(2)
    const parts = breakAt(rect(0, 0, 10, 10), pt(5, 0))
    const joined = joinContours(parts)
    expect(joined[0].closed).toBe(true)
    const ext = extendTo({ segs: [{ k: 'L', a: pt(0, 0), b: pt(10, 0) }], closed: false }, [cutter], pt(10, 0))
    expect(ext.segs[0].b.x).toBeCloseTo(40, 9)
    const open = { segs: rect(0, 0, 10, 10).segs.slice(0, 3), closed: false }
    expect(autoClose([open], 20)[0].closed).toBe(true)
    const many = { segs: fitPoints(toPoints(circle(pt(0, 0), 20), 0.5), true, 0.0001), closed: true }
    expect(simplify(many, 0.5).segs.length).toBeLessThan(many.segs.length)
    const chain = offsetChain({ segs: rect(0, 0, 100, 50).segs.slice(0, 2), closed: false }, -5)
    expect(chain.segs.map((s) => s.k)).toEqual(['L', 'A', 'L'])
  })
})
