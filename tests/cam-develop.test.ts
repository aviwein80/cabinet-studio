/**
 * Fold, flatten and wrap (NEW-07, M3.2).
 *
 * Acceptance: wrapping keeps arc length along the baseline within 0.01 mm. Flattening a faceted
 * cylinder or cone lays it flat with every edge kept; a dome is reported as not developable. A box
 * net folds into an open box whose side corners meet, and flattens back to the same net.
 */
import { describe, expect, it } from 'vitest'
import { foldPattern, flattenMesh, wrapOntoCurve, curveWalker } from '../src/cam/develop'
import { arc, atLength, circle, type Contour, contourLength, fitPoints, line, type P, pointAt, polyline, segLength, toPoints } from '../src/cam/geom'
import { gridMesh } from '../src/cam/mesh/surface'

type V3 = [number, number, number]
const ringArea = (r: P[]) => r.reduce((s, p, i) => s + p.x * r[(i + 1) % r.length].y - r[(i + 1) % r.length].x * p.y, 0) / 2
const ringLength = (r: P[]) => r.reduce((s, p, i) => s + Math.hypot(r[(i + 1) % r.length].x - p.x, r[(i + 1) % r.length].y - p.y), 0)
/** Distance from a point to a contour (each piece sampled every 0.002 mm). */
const distTo = (p: P, c: Contour) => {
  let best = Infinity
  for (const s of c.segs) {
    const n = Math.ceil(segLength(s) / 0.002)
    for (let k = 0; k <= n; k++) {
      const q = pointAt(s, k / n)
      best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y))
    }
  }
  return best
}

describe('wrap along a curve', () => {
  const R = 100
  // a quarter arc, centre (0, 0), from (100, 0) counter-clockwise to (0, 100)
  const quarter: Contour = { segs: [arc({ x: R, y: 0 }, { x: 0, y: R }, { x: 0, y: 0 }, true)], closed: false }
  // a smooth wave: points of a sine fitted with lines and arcs (a spline-like curve)
  const wavePts: P[] = Array.from({ length: 401 }, (_, i) => ({ x: i * 0.75, y: 20 * Math.sin((i * 0.75) / 30) }))
  const wave: Contour = { segs: fitPoints(wavePts, false, 0.001), closed: false }
  const curves: [string, Contour][] = [
    ['arc', quarter],
    ['circle', circle({ x: 10, y: 20 }, 60)],
    ['wave (lines and arcs fitted to a sine)', wave],
    ['polyline', polyline([{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 50 }, { x: 150, y: 90 }], false)],
  ]

  for (const [name, curve] of curves)
    it(`keeps the baseline's arc length within 0.01 mm: ${name}`, () => {
      const L = Math.min(140, contourLength(curve) - 1)
      const base: Contour = { segs: [line({ x: 5, y: 3 }, { x: 5 + L, y: 3 })], closed: false }
      const r = wrapOntoCurve([base], curve)
      expect(r.warnings).toEqual([])
      expect(r.contours).toHaveLength(1)
      expect(Math.abs(contourLength(r.contours[0]) - L)).toBeLessThan(0.01)
      // and it lies on the curve, from its start
      const out = r.contours[0]
      for (const d of [0, L * 0.25, L * 0.5, L * 0.9, L]) {
        const q = atLength(out, d).p
        expect(distTo(q, curve)).toBeLessThan(0.01)
        expect(Math.hypot(q.x - atLength(curve, d).p.x, q.y - atLength(curve, d).p.y)).toBeLessThan(0.01)
      }
    })

  it('puts a point x along the curve and y out from it, square to it', () => {
    const w = curveWalker(quarter)
    expect(w.total).toBeCloseTo((Math.PI / 2) * R, 9)
    // a 10 x 6 rectangle standing on the baseline, starting 20 mm along the arc
    const box = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }], true)
    const r = wrapOntoCurve([box], quarter, { start: 20 })
    const pts = toPoints(r.contours[0], 0.001)
    // every point is between radius 100 (the baseline, on the arc) and 94 (6 mm out on the left, inwards
    // round a counter-clockwise arc), and between 20 and 30 mm along it
    for (const p of pts) {
      const rr = Math.hypot(p.x, p.y)
      expect(rr).toBeGreaterThan(R - 6 - 0.006)
      expect(rr).toBeLessThan(R + 0.006)
      const s = Math.atan2(p.y, p.x) * R
      expect(s).toBeGreaterThan(20 - 0.006)
      expect(s).toBeLessThan(30 + 0.006)
    }
    // the top edge, 6 mm out, is shorter in proportion: 10 x 94 / 100
    const top = wrapOntoCurve([{ segs: [line({ x: 0, y: 6 }, { x: 10, y: 6 })], closed: false }], quarter, { start: 20, baseline: 0, x0: 0 })
    expect(contourLength(top.contours[0])).toBeCloseTo((10 * (R - 6)) / R, 2)
    // on the right side the shapes stand outside the arc
    const right = wrapOntoCurve([box], quarter, { start: 20, side: 'right' })
    for (const p of toPoints(right.contours[0], 0.001)) expect(Math.hypot(p.x, p.y)).toBeGreaterThan(R - 0.006)
  })

  it('warns when the shapes are longer than the curve', () => {
    const long: Contour = { segs: [line({ x: 0, y: 0 }, { x: 200, y: 0 })], closed: false }
    const r = wrapOntoCurve([long], quarter)
    expect(r.warnings.join(' ')).toMatch(/runs on straight past its end/)
    // carried on straight: the run past the end still keeps its length
    expect(Math.abs(contourLength(r.contours[0]) - 200)).toBeLessThan(0.01)
    const round = wrapOntoCurve([{ segs: [line({ x: 0, y: 0 }, { x: 400, y: 0 })], closed: false }], circle({ x: 0, y: 0 }, 50))
    expect(round.warnings.join(' ')).toMatch(/overlap themselves/)
  })
})

describe('flatten a surface', () => {
  /** A faceted cylinder segment: radius r, angle a (rad), height h, n facets round. */
  const cylinder = (r: number, a: number, h: number, n: number, closed = false) => {
    const rows: V3[][] = []
    for (const z of [0, h]) rows.push(Array.from({ length: closed ? n : n + 1 }, (_, i) => [r * Math.cos((a * i) / n), r * Math.sin((a * i) / n), z] as V3))
    return gridMesh(rows, false, closed)
  }

  it('lays a cylinder segment flat as a rectangle, every edge kept', () => {
    const n = 24
    const r = 80
    const a = (2 * Math.PI) / 3
    const f = flattenMesh(cylinder(r, a, 120, n))
    const chords = n * 2 * r * Math.sin(a / (2 * n))
    expect(f.warnings).toEqual([])
    expect(f.defect).toBeLessThan(1e-3)
    expect(f.gap).toBeLessThan(1e-4)
    expect(f.stretch).toBeLessThan(1e-4)
    expect(f.overlap).toBeLessThan(0.01)
    expect(f.area2d).toBeCloseTo(f.area3d, 1)
    expect(f.outline).toHaveLength(1)
    expect(Math.abs(ringArea(f.outline[0])) - chords * 120).toBeLessThan(0.05)
    expect(Math.abs(ringLength(f.outline[0]) - 2 * (chords + 120))).toBeLessThan(0.01)
  })

  it('cuts a whole cylinder open and lays it flat', () => {
    const n = 36
    const f = flattenMesh(cylinder(50, 2 * Math.PI, 70, n, true))
    const chords = n * 2 * 50 * Math.sin(Math.PI / n)
    expect(f.defect).toBeLessThan(1e-3)
    expect(f.overlap).toBeLessThan(0.01)
    expect(f.area2d).toBeCloseTo(chords * 70, 0)
    expect(f.outline.reduce((s, r) => s + ringArea(r), 0)).toBeCloseTo(chords * 70, 0)
  })

  it('lays a cone frustum flat as part of a ring', () => {
    // radii 60 (bottom) and 30 (top), height 40: slant 50; apex 100 slant from the bottom edge
    const n = 32
    const rows: V3[][] = []
    for (const [rr, z] of [
      [60, 0],
      [30, 40],
    ])
      rows.push(Array.from({ length: n + 1 }, (_, i) => [rr * Math.cos((Math.PI * i) / n), rr * Math.sin((Math.PI * i) / n), z] as V3))
    const mesh = gridMesh(rows)
    const f = flattenMesh(mesh)
    expect(f.warnings).toEqual([])
    expect(f.defect).toBeLessThan(1e-3)
    expect(f.stretch).toBeLessThan(1e-4)
    const bottom = n * 2 * 60 * Math.sin(Math.PI / (2 * n))
    const top = n * 2 * 30 * Math.sin(Math.PI / (2 * n))
    expect(f.outline).toHaveLength(1)
    expect(Math.abs(ringLength(f.outline[0]) - (bottom + top + 2 * 50))).toBeLessThan(0.01)
    // the two end generators laid flat meet at the apex; every corner is 100 (bottom) or 50 (top) from it
    const flat = (vi: number): P => {
      for (let t = 0; t < mesh.indices.length; t++) if (mesh.indices[t] === vi) return { x: f.facets[t * 2], y: f.facets[t * 2 + 1] }
      throw new Error('vertex not used')
    }
    const c = meet(flat(0), flat(n + 1), flat(n), flat(2 * n + 1))
    for (let vi = 0; vi <= 2 * n + 1; vi++) {
      const q = flat(vi)
      expect(Math.abs(Math.hypot(q.x - c.x, q.y - c.y) - (vi <= n ? 100 : 50))).toBeLessThan(0.01)
    }
  })

  it('reports a dome as not developable', () => {
    const rows: V3[][] = []
    for (let i = 0; i <= 12; i++) {
      const phi = (Math.PI / 2) * (i / 12)
      rows.push(Array.from({ length: 32 }, (_, j) => [50 * Math.cos(phi) * Math.cos((2 * Math.PI * j) / 32), 50 * Math.cos(phi) * Math.sin((2 * Math.PI * j) / 32), 50 * Math.sin(phi)] as V3))
    }
    const f = flattenMesh(gridMesh(rows, false, true))
    expect(f.gap).toBeGreaterThan(0.01)
    expect(f.warnings.join(' ')).toMatch(/not developable/)
  })
})

/** Where the line a1-a2 meets the line b1-b2. */
function meet(a1: P, a2: P, b1: P, b2: P): P {
  const d = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x)
  const t = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / d
  return { x: a1.x + (a2.x - a1.x) * t, y: a1.y + (a2.y - a1.y) * t }
}

describe('fold a flat pattern', () => {
  // an open box net: base 100 x 100, four sides 50 high
  const net: P[] = [
    { x: 0, y: -50 },
    { x: 100, y: -50 },
    { x: 100, y: 0 },
    { x: 150, y: 0 },
    { x: 150, y: 100 },
    { x: 100, y: 100 },
    { x: 100, y: 150 },
    { x: 0, y: 150 },
    { x: 0, y: 100 },
    { x: -50, y: 100 },
    { x: -50, y: 0 },
    { x: 0, y: 0 },
  ]
  const folds = [
    { a: { x: 0, y: 0 }, b: { x: 0, y: 100 }, angle: 90 },
    { a: { x: 100, y: 0 }, b: { x: 100, y: 100 }, angle: 90 },
    { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, angle: 90 },
    { a: { x: 0, y: 100 }, b: { x: 100, y: 100 }, angle: 90 },
  ]

  it('folds a box net into an open box whose corners meet', () => {
    const r = foldPattern([net], folds, { x: 50, y: 50 })
    expect(r.warnings).toEqual([])
    expect(r.pieces).toHaveLength(5)
    const pos = r.mesh.positions
    const pts: V3[] = []
    for (let i = 0; i < pos.length; i += 3) pts.push([pos[i], pos[i + 1], pos[i + 2]])
    // every corner within the box: x, y in 0..100, z in 0..50
    for (const p of pts) {
      expect(p[0]).toBeGreaterThan(-1e-3)
      expect(p[0]).toBeLessThan(100 + 1e-3)
      expect(p[1]).toBeGreaterThan(-1e-3)
      expect(p[1]).toBeLessThan(100 + 1e-3)
      expect(p[2]).toBeGreaterThan(-1e-3)
      expect(p[2]).toBeLessThan(50 + 1e-3)
    }
    // the four top corners: each where two sides meet (a corner of each; not joined, as in the net)
    for (const [x, y] of [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]) {
      const hits = pts.filter((p) => Math.hypot(p[0] - x, p[1] - y, p[2] - 50) < 1e-3)
      expect(hits).toHaveLength(2)
    }
    // the sides stand upright: every facet off the base is vertical
    const ix = r.mesh.indices
    let upright = 0
    for (let t = 0; t < ix.length; t += 3) {
      const [a, b, c] = [pts[ix[t]], pts[ix[t + 1]], pts[ix[t + 2]]]
      const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
      if (Math.max(a[2], b[2], c[2]) > 1) {
        expect(Math.abs(nz)).toBeLessThan(0.01)
        upright++
      }
    }
    expect(upright).toBeGreaterThanOrEqual(8)
  })

  it('flattens the folded box back to the same net', () => {
    const r = foldPattern([net], folds, { x: 50, y: 50 })
    const f = flattenMesh(r.mesh)
    expect(f.area3d).toBeCloseTo(30000, 1)
    expect(f.outline).toHaveLength(1)
    expect(Math.abs(ringArea(f.outline[0]))).toBeCloseTo(30000, 0)
    expect(Math.abs(ringLength(f.outline[0]) - 800)).toBeLessThan(0.01)
    expect(f.overlap).toBeLessThan(0.01)
  })

  it('folds a lid on a side: folds turn the pieces beyond them, the nearest first', () => {
    // a strip: base 0..100, side 100..150, lid 150..250 (y); fold the side up 90 and the lid 90 more
    const strip: P[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 250 },
      { x: 0, y: 250 },
    ]
    const r = foldPattern(
      [strip],
      [
        { a: { x: 0, y: 100 }, b: { x: 100, y: 100 }, angle: 90 },
        { a: { x: 0, y: 150 }, b: { x: 100, y: 150 }, angle: 90 },
      ],
      { x: 50, y: 50 },
    )
    expect(r.pieces).toHaveLength(3)
    // the lid lies flat over the base, 50 up: its far edge at y = 0, z = 50
    const pos = r.mesh.positions
    let found = false
    for (let i = 0; i < pos.length; i += 3) if (Math.hypot(pos[i + 1] - 0, pos[i + 2] - 50) < 1e-3) found = true
    expect(found).toBe(true)
    for (let i = 0; i < pos.length; i += 3) {
      expect(pos[i + 1]).toBeGreaterThan(-1e-3)
      expect(pos[i + 1]).toBeLessThan(100 + 1e-3)
    }
  })

  it('leaves out a fold line that does not cross the pattern', () => {
    const r = foldPattern([net], [{ a: { x: 300, y: 0 }, b: { x: 300, y: 10 }, angle: 90 }])
    expect(r.warnings.join(' ')).toMatch(/does not run across the pattern/)
    expect(r.pieces).toHaveLength(1)
  })
})
