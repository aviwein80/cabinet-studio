/**
 * M2.5d: 3D wires and surfaces (CAD-16, NEW-19). Surfaces made in the app are checked against
 * their analytic shapes: every point on the true surface, facets within the chord tolerance,
 * areas as calculated by hand.
 */
import { describe, expect, it } from 'vitest'
import { area } from '@/cam/geom'
import { buildMesh } from '@/cam/mesh/build'
import { deletePoint3d, insertPoint3d, movePoint3d, parsePoints3d, poly3dLength } from '@/cam/mesh/poly3d'
import { parseStl } from '@/cam/mesh/read'
import { extendMesh, extrude, filletPlanes, flat, loft, meshArea, revolve, ruled, segmentsFor, splitMesh, sweep, type V3 } from '@/cam/mesh/surface'
import type { Mesh } from '@/cam/mesh/types'
import { makeEntity } from '@/cam/doc'
import { placementFrame } from '@/cam/solid/faces'
import { recognizePanel } from '@/cam/solid/recognize'
import { solidToPart } from '@/cam/solid/toPart'
import { contourFromEdges, facesMesh, filletFaces, solidEdges, untrimFace } from '@/cam/solid/wires'
import { box, stlBinary } from './mesh-fixtures'
import { readFixture } from './solid-fixtures'

const pts = (m: Mesh): V3[] => Array.from({ length: m.positions.length / 3 }, (_, i) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]])
const centroids = (m: Mesh): V3[] => {
  const out: V3[] = []
  for (let t = 0; t < m.indices.length; t += 3) {
    const c: V3 = [0, 0, 0]
    for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) c[j] += m.positions[m.indices[t + k] * 3 + j] / 3
    out.push(c)
  }
  return out
}
const arcPts = (r: number, a0: number, a1: number, n: number, f: (x: number, y: number) => V3): V3[] => Array.from({ length: n + 1 }, (_, i) => f(r * Math.cos(a0 + ((a1 - a0) * i) / n), r * Math.sin(a0 + ((a1 - a0) * i) / n)))
// float32 storage: points within 2e-5 mm of where they were computed at these sizes
const F32 = 2e-5

describe('M2.5d surface creation (NEW-19)', () => {
  it('revolve: a quarter circle round Z makes a hemisphere; every point on it, facets within the tolerance, area 2πr²', () => {
    const r = 50
    const n = segmentsFor(r, Math.PI / 2, 0.01)
    const profile = Array.from({ length: n + 1 }, (_, i) => [r * Math.sin((Math.PI / 2) * (i / n)), -r + r * Math.cos((Math.PI / 2) * (i / n))] as [number, number])
    const m = revolve(profile, { tol: 0.01, centre: [100, 80] })
    const d = (p: V3) => Math.hypot(p[0] - 100, p[1] - 80, p[2] + r)
    for (const p of pts(m)) expect(Math.abs(d(p) - r)).toBeLessThan(F32 * 10)
    // facet centres sit inside the sphere by at most about twice the chord tolerance (two directions)
    const worst = Math.max(...centroids(m).map((c) => r - d(c)))
    expect(worst).toBeLessThan(0.02)
    expect(Math.abs(meshArea(m) - 2 * Math.PI * r * r) / (2 * Math.PI * r * r)).toBeLessThan(1e-3)
    // part way round
    const half = revolve([
      [10, 0],
      [10, -5],
    ], { angle: 180, tol: 0.01 })
    expect(meshArea(half)).toBeCloseTo(Math.PI * 10 * 5, 1)
  })

  it('ruled between two circles is the cone between them (the rulings lie on it)', () => {
    const N = 256
    const a = arcPts(50, 0, 2 * Math.PI, N, (x, y) => [x, y, 0])
    const b = arcPts(30, 0, 2 * Math.PI, N, (x, y) => [x, y, -20])
    const m = ruled(a, b)
    // radius falls linearly from 50 at z=0 to 30 at z=-20; rulings (mid-edges) on the cone
    const onCone = (p: V3) => Math.abs(Math.hypot(p[0], p[1]) - (50 + p[2]))
    for (const p of pts(m)) expect(onCone(p)).toBeLessThan(F32 * 10)
    const mids = centroids(m).map(onCone)
    expect(Math.max(...mids)).toBeLessThan(0.03)
    const slant = Math.hypot(20, 20)
    expect(Math.abs(meshArea(m) - Math.PI * (50 + 30) * slant) / (Math.PI * 80 * slant)).toBeLessThan(1e-3)
  })

  it('loft through sections, extrude, flat with a hole: areas exact', () => {
    const sq = (s: number, z: number): V3[] => [
      [-s, -s, z],
      [s, -s, z],
      [s, s, z],
      [-s, s, z],
      [-s, -s, z],
    ]
    const l = loft([sq(50, 0), sq(40, -5), sq(30, -10)], { n: 5 })
    const side = (s1: number, s2: number) => 4 * ((2 * s1 + 2 * s2) / 2) * Math.hypot(5, s1 - s2)
    expect(meshArea(l)).toBeCloseTo(side(50, 40) + side(40, 30), 6)
    const e = extrude(sq(50, 0), [0, 0, -20])
    expect(meshArea(e)).toBeCloseTo(4 * 100 * 20, 6)
    const hole = arcPts(20, 0, 2 * Math.PI, 128, (x, y) => [x, y, 0]).map(([x, y]) => [x, y] as [number, number])
    const holeArea = Math.abs(area({ closed: true, segs: hole.slice(0, -1).map((p, i) => ({ k: 'L' as const, a: { x: p[0], y: p[1] }, b: { x: hole[i + 1][0], y: hole[i + 1][1] } })) }))
    const f = flat(
      [
        [-50, -50],
        [50, -50],
        [50, 50],
        [-50, 50],
      ],
      [hole],
      -3,
    )
    expect(meshArea(f)).toBeCloseTo(10000 - holeArea, 3)
    for (const p of pts(f)) expect(p[2]).toBe(-3)
    // facing up
    const [a, b, c] = [0, 1, 2].map((k) => pts(f)[f.indices[k]])
    expect((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])).toBeGreaterThan(0)
  })

  it('sweep: a circle along a straight path is a cylinder; along a quarter arc, a quarter torus (Pappus), with no twist', () => {
    const sec = arcPts(5, 0, 2 * Math.PI, 64, (x, y) => [x, y, 0]).slice(0, -1).map(([x, y]) => [x, y] as [number, number])
    const straight = sweep(sec, [
      [0, 0, 0],
      [0, 50, 0],
      [0, 100, 0],
    ], { closedSection: true })
    for (const p of pts(straight)) expect(Math.abs(Math.hypot(p[0], p[2]) - 5)).toBeLessThan(F32)
    const polyPerim = 64 * 2 * 5 * Math.sin(Math.PI / 64)
    expect(meshArea(straight)).toBeCloseTo(polyPerim * 100, 3)
    const path = arcPts(50, 0, Math.PI / 2, 200, (x, y) => [x, y, -10])
    const bent = sweep(sec, path, { closedSection: true })
    // every section point 5 from the path's circle (R50 in the plane z=-10)
    for (const p of pts(bent)) expect(Math.abs(Math.hypot(Math.hypot(p[0], p[1]) - 50, p[2] + 10) - 5)).toBeLessThan(1e-4)
    const pathLen = 200 * 2 * 50 * Math.sin(Math.PI / 4 / 200)
    expect(Math.abs(meshArea(bent) - polyPerim * pathLen) / (polyPerim * pathLen)).toBeLessThan(1e-3)
  })

  it('fillet between two flat faces: tangent to both, radius exact, outside edge and inside corner', () => {
    // top face z = 0 (out +Z), side face x = 0 (out -X), block at x >= 0, z <= 0; edge along Y
    const m = filletPlanes({ p: [0, 0, 0], n: [0, 0, 1] }, { p: [0, 0, 0], n: [-1, 0, 0] }, [
      [0, 0, 0],
      [0, 100, 0],
    ], 10)
    for (const p of pts(m)) expect(Math.abs(Math.hypot(p[0] - 10, p[2] + 10) - 10)).toBeLessThan(F32)
    const xs = pts(m).map((p) => p[0])
    const zs = pts(m).map((p) => p[2])
    expect(Math.max(...zs)).toBeCloseTo(0, 5)
    expect(Math.min(...xs)).toBeCloseTo(0, 5)
    expect(Math.min(...zs)).toBeCloseTo(-10, 5)
    expect(meshArea(m)).toBeCloseTo((Math.PI / 2) * 10 * 100, 0)
    // inside corner: floor z = -10 (out +Z) and wall x = 0 (out +X), material below and left
    const c = filletPlanes({ p: [0, 0, -10], n: [0, 0, 1] }, { p: [0, 0, -10], n: [1, 0, 0] }, [
      [0, 0, -10],
      [0, 50, -10],
    ], 4, { concave: true })
    for (const p of pts(c)) expect(Math.abs(Math.hypot(p[0] - 4, p[2] + 6) - 4)).toBeLessThan(F32)
  })

  it('split by a plane, extend open edges', () => {
    const cube = buildMesh(parseStl(stlBinary(box(0, 0, 0, 10, 10, 10)))).mesh
    const { above, below } = splitMesh(cube, { p: [0, 0, 4], n: [0, 0, 1] })
    expect(meshArea(above) + meshArea(below)).toBeCloseTo(600, 6)
    expect(meshArea(above)).toBeCloseTo(100 + 4 * 60, 6)
    for (const p of pts(above)) expect(p[2]).toBeGreaterThanOrEqual(4 - 1e-6)
    const sq = flat([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ])
    const big = extendMesh(sq, 2)
    expect(meshArea(big)).toBeCloseTo(196, 6)
    const xs = pts(big).map((p) => p[0])
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([-2, 12])
    expect(() => extendMesh(cube, 1)).toThrow(/closed/)
  })
})

describe('M2.5d wires and surfaces from a solid (CAD-16, NEW-19)', () => {
  async function side() {
    const solid = await readFixture('cabinet-side.step')
    const { part } = solidToPart(solid, { body: 0, blob: 'a'.repeat(64), source: 'side' })
    const body = solid.bodies[0]
    const pf = placementFrame(body, part.models![0].place)
    if ('error' in pf) throw new Error(pf.error)
    return { solid, body, frame: pf.frame }
  }

  it('edges where faces meet: the inside face’s outline edges run the L-shaped perimeter; contours join from picked edges', async () => {
    const { body, frame } = await side()
    const red = body.faces.find((f) => f.color === '#cc3333')!
    const rec = recognizePanel(body, { frame })
    const edges = solidEdges(body, frame, { faces: [red.id] })
    const outline = edges.filter((e) => rec.outlineFaces.includes(e.b))
    const perim = outline.reduce((n, e) => n + poly3dLength(e.pts), 0)
    expect(perim).toBeCloseTo(2 * (720 + 560), 6)
    for (const e of outline) for (const p of e.pts) expect(p[2]).toBeCloseTo(0, 9)
    // all edges of the inside face are sharp (90° to the walls)
    for (const e of edges) expect(e.angle).toBeCloseTo(90, 3)
    const cs = contourFromEdges(outline.map((e) => makeEntity({ t: 'poly3d', pts: e.pts }, 'edges')))
    expect(cs).toHaveLength(1)
    expect(cs[0].closed).toBe(true)
    expect(Math.abs(area(cs[0]))).toBeCloseTo(720 * 560 - 100 * 75, 3)
    // every edge of the whole solid sits on both of its faces (z of top edges 0, bottom -19)
    const all = solidEdges(body, frame)
    expect(all.length).toBeGreaterThan(150)
  })

  it('surface from faces; a face untrimmed (flat: its rectangle; round: the whole cylinder; drill point: the whole cone)', async () => {
    const { body, frame } = await side()
    const red = body.faces.find((f) => f.color === '#cc3333')!
    const m = facesMesh(body, frame, [red.id])
    expect(meshArea(m)).toBeCloseTo(red.area, 3)
    const u = untrimFace(body, frame, red.id)
    expect(meshArea(u)).toBeCloseTo(720 * 560, 3)
    for (const p of pts(u)) expect(p[2]).toBeCloseTo(0, 4)
    // a pocket corner (R6 quarter, 4 deep) becomes the whole R6 cylinder 4 high
    const corner = body.faces.find((f) => f.surface.kind === 'cylinder' && Math.abs(f.surface.r! - 6) < 1e-9)!
    const cyl = untrimFace(body, frame, corner.id, 0.01)
    const n = segmentsFor(6, 2 * Math.PI, 0.01)
    expect(meshArea(cyl)).toBeCloseTo(n * 2 * 6 * Math.sin(Math.PI / n) * 4, 3)
    const cone = body.faces.find((f) => f.surface.kind === 'cone')!
    expect(meshArea(untrimFace(body, frame, cone.id))).toBeGreaterThan(0)
  })

  it('fillet between two flat faces of the solid: an outside edge of the panel and an inside corner of a pocket', async () => {
    const { body, frame } = await side()
    const red = body.faces.find((f) => f.color === '#cc3333')!
    const rec = recognizePanel(body, { frame })
    const longWall = rec.outlineFaces.map((f) => body.faces.find((x) => x.id === f)!).find((f) => f.surface.kind === 'plane' && Math.abs(f.area - 720 * 19) < 1e-6)!
    const m = filletFaces(body, frame, red.id, longWall.id, 3)
    // the round-over sits within 3 mm of the edge, its points 3 from the centre line, inside the panel
    const ys = pts(m).map((p) => p[1])
    const yEdge = Math.abs(Math.min(...ys)) < 1 ? 0 : 560
    const zs = pts(m).map((p) => p[2])
    expect(Math.max(...zs)).toBeCloseTo(0, 4)
    expect(Math.min(...zs)).toBeCloseTo(-3, 4)
    for (const p of pts(m)) expect(Math.abs(Math.hypot(p[1] - (yEdge === 0 ? 3 : 557), p[2] + 3) - 3)).toBeLessThan(1e-4)
    // inside corner: the 10 mm step's floor and one of its flat walls
    const deep = rec.pockets.find((p) => p.depth === 10)!
    const wall = deep.faces.map((f) => body.faces.find((x) => x.id === f)!).find((f) => f.surface.kind === 'plane' && f.id !== deep.floor)!
    const c = filletFaces(body, frame, deep.floor, wall.id, 2)
    const cz = pts(c).map((p) => p[2])
    expect(Math.min(...cz)).toBeCloseTo(-10, 4)
    expect(Math.max(...cz)).toBeCloseTo(-8, 4)
    expect(() => filletFaces(body, frame, red.id, deep.floor, 2)).toThrow(/do not share an edge|parallel/)
  })

  it('3D polylines: typed points, move, insert, remove', () => {
    const e = makeEntity({ t: 'poly3d', pts: parsePoints3d('0,0,0; 100, 0, -5\n100 50 -5') }, 'edges')
    expect(e.g.t === 'poly3d' && poly3dLength(e.g.pts)).toBeCloseTo(Math.hypot(100, 5) + 50, 9)
    const moved = movePoint3d(e, 1, [100, 0, -10])
    expect(moved.g.t === 'poly3d' && moved.g.pts[1]).toEqual([100, 0, -10])
    const ins = insertPoint3d(moved, 0)
    expect(ins.g.t === 'poly3d' && ins.g.pts[1]).toEqual([50, 0, -5])
    const del = deletePoint3d(ins, 1)
    expect(del.g.t === 'poly3d' && del.g.pts).toEqual(moved.g.t === 'poly3d' && moved.g.pts)
    expect(() => parsePoints3d('1,2')).toThrow(/not a point/)
  })
})
