import { describe, expect, it } from 'vitest'
import { area, type Contour } from '@/cam/geom'
import { buildMesh } from '@/cam/mesh/build'
import { meshDeviation } from '@/cam/mesh/distance'
import { autoUp, DEFAULT_PLACEMENT, fitWorkVolumeToModel, placedSize, placeMesh } from '@/cam/mesh/place'
import { MeshReadError, parseObj, parseStl, readMeshFile } from '@/cam/mesh/read'
import { simplifyMesh } from '@/cam/mesh/simplify'
import { deleteFacets, featureEdges, projectOutline, sectionAt, sectionContours, writeStl } from '@/cam/mesh/tools'
import { type Mesh, meshBounds, meshVolume, triCount } from '@/cam/mesh/types'
import { newPart } from '@/cam/doc'
import { Cancelled } from '@/core/cancel'
import { box, relief, rng, type Soup, sphere, stlAscii, stlBinary, threeMf, torus } from './mesh-fixtures'
import { isWatertight } from './cam-machine-stock.test'

const enc = (s: string) => new TextEncoder().encode(s)
const load = async (bytes: Uint8Array, name: string, units?: 'mm' | 'in') => buildMesh(await readMeshFile(bytes, name), { units })
const polyArea = (pts: { x: number; y: number }[]) => pts.reduce((s, p, i) => s + (pts[(i + 1) % pts.length].x - p.x) * (pts[(i + 1) % pts.length].y + p.y), 0) / -2

describe('M2.1 mesh import (CAD-13)', () => {
  it('binary STL: welded, closed, one shell, facing out', async () => {
    const { mesh, report } = await load(stlBinary(sphere(20)), 'ball.stl')
    expect(report.format).toBe('stl-binary')
    expect(report.triangles).toBe(sphere(20).length)
    expect(report.vertices).toBe(48 * 23 + 2)
    expect(report.openEdges).toBe(0)
    expect(report.nonManifoldEdges).toBe(0)
    expect(report.shells).toBe(1)
    expect(report.flipped).toBe(0)
    expect(isWatertight(mesh.indices)).toBe(true)
    // polyhedron inscribed in the sphere: a little under 4/3 pi r^3
    const v = meshVolume(mesh)
    expect(v).toBeLessThan((4 / 3) * Math.PI * 8000)
    expect(v).toBeGreaterThan((4 / 3) * Math.PI * 8000 * 0.98)
  })

  it('a binary STL whose header starts with "solid" is still read as binary', async () => {
    const { report } = await load(stlBinary(box(0, 0, 0, 10, 10, 10), 'solid made by some exporter'), 'b.stl')
    expect(report.format).toBe('stl-binary')
    expect(report.kept).toBe(12)
  })

  it('ASCII STL gives the same mesh; units scale to mm', async () => {
    const a = await load(stlBinary(torus(30, 8)), 't.stl')
    const b = await load(enc(stlAscii(torus(30, 8))), 't.stl')
    expect(b.report.format).toBe('stl-ascii')
    expect(b.report.vertices).toBe(a.report.vertices)
    expect(b.report.kept).toBe(a.report.kept)
    expect(Math.abs(meshVolume(b.mesh) - meshVolume(a.mesh)) / meshVolume(a.mesh)).toBeLessThan(1e-5)
    const inch = await load(enc(stlAscii(box(0, 0, 0, 1, 2, 0.75))), 'in.stl', 'in')
    const bb = meshBounds(inch.mesh)
    expect(bb.max[0]).toBeCloseTo(25.4, 4)
    expect(bb.max[1]).toBeCloseTo(50.8, 4)
    expect(inch.report.scale).toBe(25.4)
  })

  it('turns flipped facets round and an inside-out solid outwards', async () => {
    const r = rng(7)
    const soup = sphere(15).map((t) => (r() < 0.3 ? [...t.slice(0, 3), ...t.slice(6, 9), ...t.slice(3, 6)] : t))
    const { mesh, report } = await load(stlBinary(soup), 's.stl')
    expect(report.flipped).toBeGreaterThan(0)
    expect(meshVolume(mesh)).toBeGreaterThan(0)
    expect(isWatertight(mesh.indices)).toBe(true)
    const inside = sphere(15).map((t) => [...t.slice(0, 3), ...t.slice(6, 9), ...t.slice(3, 6)])
    const out = await load(stlBinary(inside), 'in.stl')
    expect(out.report.flipped).toBe(out.report.kept)
    expect(meshVolume(out.mesh)).toBeGreaterThan(0)
  })

  it('an open relief surface is turned to face up', async () => {
    const down = relief(100, 60, 20, 12, (x, y) => -2 + Math.sin(x / 10) * Math.cos(y / 10)).map((t) => [...t.slice(0, 3), ...t.slice(6, 9), ...t.slice(3, 6)])
    const { mesh, report } = await load(stlBinary(down), 'r.stl')
    expect(report.openEdges).toBe(2 * (20 + 12))
    expect(report.flipped).toBe(report.kept)
    const p = mesh.positions
    const [a, b, c] = [0, 1, 2].map((k) => mesh.indices[k] * 3)
    expect((p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[b + 1] - p[a + 1]) * (p[c] - p[a])).toBeGreaterThan(0)
  })

  it('closes small gaps between facets', async () => {
    const soup = box(0, 0, 0, 40, 30, 20)
    // nudge one corner of one facet by 4 microns: two edges open up
    const gap: Soup = soup.map((t, i) => (i === 3 ? [t[0] + 0.004, ...t.slice(1)] : t))
    const off = buildMesh(await readMeshFile(stlBinary(gap), 'g.stl'), { gapTol: 0 })
    expect(off.report.openEdges).toBeGreaterThan(0)
    const on = await load(stlBinary(gap), 'g.stl')
    expect(on.report.gapsClosed).toBe(1)
    expect(on.report.openEdges).toBe(0)
    expect(isWatertight(on.mesh.indices)).toBe(true)
  })

  it('bad files give a clear error, never a crash', async () => {
    const good = stlBinary(sphere(10))
    await expect(readMeshFile(good.slice(0, good.length - 120), 'cut.stl')).rejects.toThrow(/cut short/)
    await expect(readMeshFile(enc('hello world, not a mesh at all'), 'x.stl')).rejects.toThrow(MeshReadError)
    await expect(readMeshFile(new Uint8Array(0), 'empty.stl')).rejects.toThrow(/empty/)
    await expect(readMeshFile(enc('solid x\nendsolid x\n'), 'x.stl')).rejects.toThrow(/no facets/)
    await expect(readMeshFile(enc('v 0 0 0\nv 1 0 0\n'), 'x.obj')).rejects.toThrow(/no faces/)
    await expect(readMeshFile(enc('not a zip'), 'x.3mf')).rejects.toThrow(/3MF/)
    await expect(readMeshFile(good, 'x.step')).rejects.toThrow(/STL, OBJ and 3MF/)
    // a facet with a NaN coordinate is skipped and counted
    const soup = box(0, 0, 0, 1, 1, 1)
    soup[4] = [NaN, ...soup[4].slice(1)]
    const r = await load(stlBinary(soup), 'nan.stl')
    expect(r.report.badFacets).toBe(1)
    expect(r.report.kept).toBe(11)
    expect(r.report.warnings.join(' ')).toMatch(/bad facet/)
  })

  it('OBJ: quads, negative indices, v/vt/vn faces and groups', () => {
    const text = ['# cube side', 'o First', 'v 0 0 0', 'v 10 0 0', 'v 10 10 0', 'v 0 10 0', 'f 1/1/1 2/2/1 3/3/1 4/4/1', 'g Second', 'v 0 0 5', 'v 10 0 5', 'v 10 10 5', 'f -3 -2 -1'].join('\n')
    const soup = parseObj(text)
    expect(soup.triangles).toBe(3)
    expect(soup.groupNames).toEqual(['First', 'Second'])
    expect([...soup.groups!]).toEqual([0, 0, 1])
    const { mesh } = buildMesh(soup)
    expect(triCount(mesh)).toBe(3)
  })

  it('3MF: units, build transforms and several objects', async () => {
    const bytes = await threeMf([{ soup: box(0, 0, 0, 1, 1, 1), name: 'A' }, { soup: box(2, 0, 0, 3, 1, 1), name: 'B' }], 'inch', '1 0 0 0 1 0 0 0 1 10 0 0')
    const soup = await readMeshFile(bytes, 'm.3mf')
    expect(soup.units).toBe('in')
    expect(soup.groupNames).toEqual(['A', 'B'])
    const { mesh, report } = buildMesh(soup)
    expect(report.shells).toBe(2)
    const b = meshBounds(mesh)
    expect(b.min[0]).toBeCloseTo(10 * 25.4, 3)
    expect(b.max[0]).toBeCloseTo(13 * 25.4, 3)
  })

  it('a 10 MB ASCII STL imports', async () => {
    const soup = relief(400, 300, 170, 140, (x, y) => -3 + 2 * Math.sin(x / 20) * Math.sin(y / 15))
    const text = stlAscii(soup)
    expect(text.length).toBeGreaterThan(10e6)
    const t0 = performance.now()
    const { report } = buildMesh(parseStl(enc(text)))
    expect(report.kept).toBe(soup.length)
    expect(performance.now() - t0).toBeLessThan(10_000)
  })

  it('reports progress and can be cancelled', async () => {
    const bytes = stlBinary(sphere(10, 256, 256))
    const seen: number[] = []
    await readMeshFile(bytes, 's.stl', { progress: (f) => seen.push(f) })
    expect(seen.length).toBeGreaterThan(0)
    let n = 0
    await expect(readMeshFile(bytes, 's.stl', { isCancelled: () => ++n > 1 })).rejects.toThrow(Cancelled)
  })
})

describe('M2.1 mesh utilities (NEW-18)', () => {
  let ball: Mesh
  let ring: Mesh
  it('setup', async () => {
    ball = (await load(stlBinary(sphere(20, 96, 48)), 'b.stl')).mesh
    ring = (await load(stlBinary(torus(40, 10, 96, 48)), 't.stl')).mesh
    expect(triCount(ball)).toBeGreaterThan(0)
  })

  it('sections at Z return closed contours: one CCW loop through a sphere, outer + hole through a torus', () => {
    for (const z of [0, 7.3, -15.1, 19.5]) {
      const s = sectionAt(ball, z)
      expect(s.open).toEqual([])
      expect(s.loops).toHaveLength(1)
      expect(polyArea(s.loops[0])).toBeGreaterThan(0)
      const r = Math.sqrt(400 - z * z)
      for (const p of s.loops[0]) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(r + 1e-3)
    }
    const t = sectionAt(ring, 0.01)
    expect(t.loops).toHaveLength(2)
    const areas = t.loops.map(polyArea).sort((a, b) => a - b)
    expect(areas[0]).toBeLessThan(0)
    expect(areas[1]).toBeGreaterThan(0)
    const cs: Contour[] = sectionContours(t, 0.01)
    expect(cs.every((c) => c.closed)).toBe(true)
    // arcs refitted: the net area is close to the annulus pi (50^2 - 30^2)
    const net = cs.reduce((s, c) => s + area(c), 0)
    expect(Math.abs(net - Math.PI * (2500 - 900)) / (Math.PI * 1600)).toBeLessThan(0.01)
    // a plane through a vertex ring is still closed
    const atVertex = sectionAt(ball, ball.positions[2 + 3 * 10])
    expect(atVertex.open).toEqual([])
  })

  it('projects the outline onto XY', () => {
    const o = projectOutline(ball)
    expect(o).toHaveLength(1)
    expect(Math.abs(polyArea(o[0])) / (Math.PI * 400)).toBeGreaterThan(0.99)
    const t = projectOutline(ring)
    expect(t).toHaveLength(2)
  })

  it('feature edges of a box are its 12 edges; deleting the underside opens 4 edges', async () => {
    const b = (await load(stlBinary(box(0, 0, 0, 40, 30, 20)), 'b.stl')).mesh
    const chains = featureEdges(b, 30)
    expect(chains).toHaveLength(12)
    expect(chains.reduce((s, c) => s + Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1], c[1][2] - c[0][2]), 0)).toBeCloseTo(4 * (40 + 30 + 20), 6)
    const top = deleteFacets(b, { k: 'facing-down', maxDeg: 10 })
    expect(triCount(top)).toBe(10)
    expect(featureEdges(top, 89).length).toBeGreaterThan(0)
  })

  it('simplify to 10 % keeps the shape within the measured tolerance; tolerance mode holds its limit', async () => {
    const src = (await load(stlBinary(relief(300, 200, 150, 100, (x, y) => -5 + 4 * Math.sin(x / 40) * Math.cos(y / 30))), 'r.stl')).mesh
    const pct = await simplifyMesh(src, { k: 'percent', percent: 10 })
    expect(pct.after).toBeLessThanOrEqual(Math.ceil(pct.before * 0.1) + 2)
    expect(pct.deviation).toBeLessThan(0.1)
    // the reported deviation is our own measurement: check it against the analytic surface
    const p = pct.mesh.positions
    let worst = 0
    for (let i = 0; i < p.length; i += 3) worst = Math.max(worst, Math.abs(p[i + 2] - (-5 + 4 * Math.sin(p[i] / 40) * Math.cos(p[i + 1] / 30))))
    expect(worst).toBeLessThan(0.1)
    for (const tol of [0.02, 0.05]) {
      const r = await simplifyMesh(src, { k: 'tolerance', mm: tol })
      expect(r.after).toBeLessThan(r.before)
      expect(r.deviation).toBeLessThanOrEqual(tol)
    }
  }, 30_000)

  it('mesh distance is exact for a shifted copy', () => {
    const up = { ...ball, positions: ball.positions.map((v, i) => (i % 3 === 2 ? v + 0.25 : v)) }
    const d = meshDeviation(ball, up)
    expect(d.max).toBeGreaterThan(0.2)
    expect(d.max).toBeLessThanOrEqual(0.25 + 1e-5)
  })

  it('STL export round-trips', async () => {
    const again = await load(writeStl(ring), 'r.stl')
    expect(again.report.kept).toBe(triCount(ring))
    expect(again.report.vertices).toBe(ring.positions.length / 3)
  })
})

describe('M2.1 placement and work volume (SOL-05)', () => {
  it('up axis, rotation, scale and mirror; the model top sits at `at`', async () => {
    const b = (await load(stlBinary(box(0, 0, 0, 10, 20, 30)), 'b.stl')).mesh
    expect(autoUp(b)).toBe('+x')
    expect(placedSize(b, { ...DEFAULT_PLACEMENT, up: '+y' }).map((v) => Math.round(v))).toEqual([10, 30, 20])
    expect(placedSize(b, { ...DEFAULT_PLACEMENT, up: '+x' }).map((v) => Math.round(v))).toEqual([30, 20, 10])
    expect(placedSize(b, { ...DEFAULT_PLACEMENT, rotZ: 90, scale: 2 }).map((v) => Math.round(v * 1000) / 1000)).toEqual([40, 20, 60])
    const placed = placeMesh(b, { ...DEFAULT_PLACEMENT, at: [5, 6, -2] })
    const bb = meshBounds(placed)
    expect(bb.min.slice(0, 2)).toEqual([5, 6])
    expect(bb.max[2]).toBe(-2)
    const mirrored = placeMesh(b, { ...DEFAULT_PLACEMENT, mirror: true })
    expect(meshVolume(mirrored)).toBeCloseTo(6000, 3)
  })

  it('fits length, width and thickness to the model plus oversize and resizes a plain outline', () => {
    const part = newPart({ length: 600, width: 400 })
    const withModel = { ...part, models: [{ id: 'm1', name: 'Relief', kind: 'mesh' as const, blob: 'x', source: 'r.stl', units: 'mm' as const, place: { ...DEFAULT_PLACEMENT }, layer: 'outline', visible: true, triangles: 10, size: [300, 200, 12] as [number, number, number] }] }
    const fitted = fitWorkVolumeToModel(withModel, 'm1', [300, 200, 12], { xy: 10, top: 1, bottom: 6 })
    expect([fitted.length, fitted.width, fitted.thickness]).toEqual([320, 220, 19])
    expect(fitted.models![0].place.at).toEqual([10, 10, -1])
    expect(fitted.workVolume).toEqual({ modelId: 'm1', oversize: { xy: 10, top: 1, bottom: 6 } })
    const o = fitted.entities.find((e) => e.id === fitted.outlineId)!
    expect(o.g.t === 'contour' && Math.abs(area(o.g.c))).toBeCloseTo(320 * 220, 6)
  })
})
