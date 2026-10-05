/**
 * M2.2b Z-level roughing and waterline finishing on the analytic test surfaces: independent gouge
 * checks, stock to leave, material left after roughing (simulated), entry rules, flats, boundaries,
 * flat-layer output and golden digests.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkGouge, distanceToMesh, meshDistance } from '@/cam/3d/check'
import { DropCutter } from '@/cam/3d/dropcutter'
import { flatHeights } from '@/cam/3d/zlevel'
import { makeEntity, newPart } from '@/cam/doc'
import { circle, pt } from '@/cam/geom'
import { buildMesh } from '@/cam/mesh/build'
import { DEFAULT_PLACEMENT } from '@/cam/mesh/place'
import { parseStl } from '@/cam/mesh/read'
import { type Mesh, meshBounds } from '@/cam/mesh/types'
import { defaultOp } from '@/cam/ops'
import { buildTimeline } from '@/cam/sim'
import { HeightfieldStock } from '@/cam/stock/heightfield'
import { generateOp, isFlatLayer, type Toolpath } from '@/cam/toolpath'
import type { CamOp, CamPart, Finish3dOp, Rough3dOp } from '@/cam/types'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import type { MachineProfile } from '@/core/types'
import { digest3d } from './cam-digest'
import { box, relief, stlBinary } from './mesh-fixtures'
import { SURFACES } from './surfaces'

const machine = PLACEHOLDER_MACHINE
const THOROUGH = process.env.THOROUGH === '1'
const BALL = 't105' // 6 mm ball-nose (placeholder)
const BULL = 't107' // 12 mm R2 bull-nose (placeholder)
const FLAT = 't102' // 8 mm flat (placeholder)

const meshCache = new Map<string, Mesh>()
function partFor(name: string, boundary?: ReturnType<typeof makeEntity>[]) {
  let mesh = meshCache.get(name)
  if (!mesh) {
    mesh = buildMesh(parseStl(stlBinary(SURFACES[name].soup())), { gapTol: 0 }).mesh
    meshCache.set(name, mesh)
  }
  const b = meshBounds(mesh)
  const part: CamPart = {
    ...newPart({ name, length: b.max[0], width: b.max[1], thickness: 45 }),
    models: [{ id: 'm', name, kind: 'mesh', blob: name, source: `${name}.stl`, units: 'mm', place: { ...DEFAULT_PLACEMENT, at: [b.min[0], b.min[1], b.max[2]] }, layer: 'models', visible: true, triangles: mesh.indices.length / 3, size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]] }],
  }
  if (boundary) part.entities = [...part.entities, ...boundary]
  return { mesh, part }
}

function gen(name: string, op: CamOp, boundary?: ReturnType<typeof makeEntity>[], m: MachineProfile = machine) {
  const { mesh, part } = partFor(name, boundary)
  part.ops = [op]
  const tp = generateOp(op, { part, machine: m, meshes: new Map([[name, mesh]]) })
  return { mesh, part, op, tp }
}

function rough(name: string, patch: Partial<Rough3dOp> = {}, boundary?: ReturnType<typeof makeEntity>[], m?: MachineProfile) {
  const base = defaultOp('rough3d', boundary?.map((e) => e.id) ?? []) as Rough3dOp
  return gen(name, { ...base, toolId: BULL, ...patch, surface: { ...base.surface, modelId: 'm', ...(patch.surface ?? {}) } }, boundary, m)
}

function waterline(name: string, patch: Partial<Finish3dOp> = {}, boundary?: ReturnType<typeof makeEntity>[]) {
  const base = defaultOp('finish3d', boundary?.map((e) => e.id) ?? [], { strategy: 'waterline' } as Partial<CamOp>) as Finish3dOp
  return gen(name, { ...base, toolId: BALL, stepdown: 1, fillShallow: false, slope: { min: 0, max: 90 }, ...patch, surface: { ...base.surface, modelId: 'm', ...(patch.surface ?? {}) } }, boundary)
}

/** Every point of the cutting chains. */
function clPoints(tp: Toolpath): [number, number, number][] {
  const out: [number, number, number][] = []
  for (const m of tp.moves) if (m.t === 'poly') for (let i = 0; i < m.pts.length; i += 3) out.push([m.pts[i], m.pts[i + 1], m.pts[i + 2]])
  return out
}

describe('M2.2b waterline finishing', () => {
  for (const name of Object.keys(SURFACES)) {
    it(`${name}, 6 mm ball-nose: deepest gouge <= 0.005 mm (exact check)`, () => {
      const { mesh, tp } = waterline(name)
      expect(tp.warnings).toEqual([])
      expect(clPoints(tp).length).toBeGreaterThan(100)
      const g = checkGouge(mesh, { shape: 'ball', r: 3 }, tp.moves, { step: 0.05 })
      process.stdout.write(`  [waterline] ${name}: deepest ${g.max.toFixed(4)} mm over ${g.points} positions\n`)
      expect(g.exact).toBe(true)
      expect(g.max).toBeLessThanOrEqual(0.005)
      expect(g.minClearance).toBeLessThan(0.002)
    }, 120_000)
  }

  it('bull-nose and flat on the raised panel and the cove: deepest gouge <= 0.005 mm (sampled check)', () => {
    for (const [name, toolId, shape, r, cr] of [
      ['raised-panel', BULL, 'bull', 6, 2],
      ['cove', FLAT, 'flat', 4, 0],
    ] as const) {
      const { mesh, tp } = waterline(name, { toolId, stepdown: 2 })
      expect(clPoints(tp).length).toBeGreaterThan(50)
      const g = checkGouge(mesh, { shape, r, cornerRadius: cr }, tp.moves, { step: 0.1, resolution: 0.05, maxPoints: THOROUGH ? 1500 : 250 })
      expect(g.max, name).toBeLessThanOrEqual(0.005)
    }
  }, 120_000)

  it('each pass is level, the levels are one step-down apart, and the passes hug the hemisphere', () => {
    const { tp } = waterline('hemisphere', { stepdown: 2 })
    const zs = [...new Set(clPoints(tp).map((p) => Math.round(p[2] * 1e6) / 1e6))].sort((a, b) => b - a)
    for (let i = 1; i < zs.length - 1; i++) expect(zs[i - 1] - zs[i]).toBeCloseTo(2, 6)
    // ball on a dome of radius 20: the ball centre is 23 from the dome centre
    for (const [x, y, z] of clPoints(tp)) if (z > -17) expect(Math.hypot(x - 40, y - 40, z + 3 + 20)).toBeCloseTo(23, 1)
  }, 60_000)

  it('stock to leave 0.5 mm: points 0.5 ± 0.01 mm off the surface, and no move closer', () => {
    const { mesh, tp } = waterline('sine', { surface: { stockToLeave: 0.5 } as Finish3dOp['surface'] })
    const pts = clPoints(tp)
    for (let i = 0; i < pts.length; i += Math.max(1, Math.floor(pts.length / 400))) {
      const [x, y, z] = pts[i]
      expect(distanceToMesh(mesh, x, y, z + 3) - 3).toBeCloseTo(0.5, 2)
    }
    const g = checkGouge(mesh, { shape: 'ball', r: 3 }, tp.moves, { stock: 0.5, step: 0.05 })
    expect(g.max).toBeLessThanOrEqual(0.005)
  }, 60_000)

  it('slope limit 30°: only the steep part of the dome; fill shallow areas adds parallel passes on the rest', () => {
    const steep = waterline('hemisphere', { slope: { min: 30, max: 90 }, stepdown: 1 }).tp
    for (const [x, y, z] of clPoints(steep)) {
      // contact slope on the dome: asin(r / 23) at ball-centre distance r from the axis
      const r = Math.hypot(x - 40, y - 40)
      expect(r, `at z ${z}`).toBeGreaterThan(23 * Math.sin((29 * Math.PI) / 180))
    }
    const filled = waterline('hemisphere', { slope: { min: 30, max: 90 }, stepdown: 1, fillShallow: true, stepover: 1.5 }).tp
    const n = clPoints(filled).length
    expect(n).toBeGreaterThan(clPoints(steep).length + 100)
    // the fill reaches the top of the dome, which waterline at 30°+ never touches
    expect(clPoints(filled).some(([x, y]) => Math.hypot(x - 40, y - 40) < 3)).toBe(true)
  }, 120_000)

  it('climb keeps the model on the right: loops round the dome run clockwise; conventional reverses them', () => {
    const area = (tp: Toolpath) => {
      const m = tp.moves.find((x) => x.t === 'poly' && x.pts.length > 60) as { pts: Float64Array }
      let a = 0
      const n = m.pts.length / 3
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        a += m.pts[i * 3] * m.pts[j * 3 + 1] - m.pts[j * 3] * m.pts[i * 3 + 1]
      }
      return a / 2
    }
    expect(area(waterline('hemisphere', { stepdown: 4 }).tp)).toBeLessThan(0)
    expect(area(waterline('hemisphere', { stepdown: 4, direction: 'conventional' }).tp)).toBeGreaterThan(0)
  }, 60_000)

  it('flat-layer output: one constant-depth contour per pass; not with the shallow-area fill', () => {
    const { op, tp } = waterline('cove', { stepdown: 2 })
    expect(isFlatLayer(op)).toBe(true)
    const cs = tp.intents.filter((i) => i.k === 'contour')
    expect(cs.length).toBeGreaterThan(5)
    for (const c of cs) if (c.k === 'contour') expect(c.passes).toHaveLength(1)
    const filled = waterline('cove', { stepdown: 2, fillShallow: true, slope: { min: 30, max: 90 } })
    expect(isFlatLayer(filled.op)).toBe(false)
    expect(filled.tp.intents).toEqual([])
  }, 60_000)
})

describe('M2.2b Z-level roughing', () => {
  for (const [name, toolId, shape, r, cr] of [
    ['hemisphere', BALL, 'ball', 3, 3],
    ['sine', BULL, 'bull', 6, 2],
    ['raised-panel', BULL, 'bull', 6, 2],
    ['cove', FLAT, 'flat', 4, 0],
  ] as const) {
    it(`${name}, ${shape}: never leaves less than the stock to leave (independent check)`, () => {
      const { mesh, tp } = rough(name, { toolId, stepdown: 4, surface: { stockToLeave: 0.5 } as Rough3dOp['surface'] })
      expect(tp.warnings.filter((w) => !w.startsWith('For woodWOP'))).toEqual([])
      expect(clPoints(tp).length).toBeGreaterThan(50)
      const g = checkGouge(mesh, { shape, r, cornerRadius: cr }, tp.moves, shape === 'ball' ? { stock: 0.5, step: 0.2 } : { stock: 0.5, step: 0.2, resolution: 0.1, maxPoints: THOROUGH ? 2000 : 400 })
      process.stdout.write(`  [roughing] ${name}, ${shape}: deepest into the stock ${g.max.toFixed(4)} mm (${g.exact ? 'exact' : 'sampled'}, ${g.points} positions)\n`)
      expect(g.max, name).toBeLessThanOrEqual(0.005)
    }, 120_000)
  }

  it('leaves no more than the stock plus one step-down on the surface, measured to the nearest point of the model (simulated)', () => {
    // Material left is measured from each point of the simulated stock top to the nearest point
    // of the model: on a steep wall the material straight above the surface is not its thickness.
    for (const [name, toolId, sd] of [
      ['hemisphere', BULL, 3],
      ['sine', BULL, 2],
      ['raised-panel', BULL, 3],
      ['cove', FLAT, 4],
    ] as const) {
      const s = 0.5
      const { mesh, part, tp } = rough(name, { toolId, stepdown: sd, stockZ: s, surface: { stockToLeave: s } as Rough3dOp['surface'] })
      const stock = new HeightfieldStock(part.length, part.width, part.thickness, 0.5)
      for (const seg of buildTimeline([tp]).segs) if (seg.kind !== 'rapid') stock.carve(seg.a, seg.b, seg.cutter)
      const dist = meshDistance(mesh)
      const probe = new DropCutter(mesh, { kind: 'torus', R: 1e-4, rc: 0 })
      let worst = -Infinity
      let flat = Infinity
      for (let y = 0.25; y < part.width; y += 0.5)
        for (let x = 0.25; x < part.length; x += 0.5) {
          const top = stock.heightAt(x, y)
          const left = dist(x, y, top)
          worst = Math.max(worst, left)
          // where the stock was cut down: never less than the stock straight above the surface
          // (the model's own height there: the facets, which differ from the formula along creases)
          if (top < -1e-6 && probe.drop(x, y)) flat = Math.min(flat, top - probe.z)
        }
      process.stdout.write(`  [roughing] ${name}: at most ${worst.toFixed(3)} mm left (stock ${s} + step-down ${sd}); least straight above the surface ${flat.toFixed(3)} mm\n`)
      expect(worst, name).toBeLessThanOrEqual(s + sd + 0.05)
      expect(flat, name).toBeGreaterThan(s - 0.01)
    }
  }, 300_000)

  it('levels: every step-down from face 1, the bottom, and an extra level on each flat area', () => {
    // a step: flat at -4.5 on the left, -10 on the right
    const step = (x: number) => (x < 50 ? -4.5 : -10)
    SURFACES.step = { soup: () => relief(100, 60, 200, 6, (x) => step(x)), f: (x) => step(x) }
    expect(flatHeights(partFor('step').mesh, 10).sort((a, b) => a - b)).toEqual([-10, -4.5])
    const zsOf = (tp: Toolpath) => [...new Set(clPoints(tp).map((p) => Math.round(p[2] * 1e6) / 1e6))].sort((a, b) => b - a)
    expect(zsOf(rough('step', { stepdown: 3, stockZ: 0.5, flats: true }).tp)).toEqual([-3, -4, -6, -9, -9.5])
    expect(zsOf(rough('step', { stepdown: 3, stockZ: 0.5, flats: false }).tp)).toEqual([-3, -6, -9, -9.5])
  }, 60_000)

  it('entry: helix where it fits, ramp on request; plunge becomes a ramp for a tool that is not centre-cutting', () => {
    const helix = rough('raised-panel', { entry: 'helix', stepdown: 5 }).tp
    expect(helix.moves.some((m) => m.t === 'arc' && m.f === 'plunge')).toBe(true)
    const ramp = rough('raised-panel', { entry: 'ramp', stepdown: 5 }).tp
    expect(ramp.moves.some((m) => m.t === 'arc')).toBe(false)
    // ramp moves go down no steeper than the ramp angle (5°)
    let prev: { x: number; y: number; z: number } | null = null
    for (const m of ramp.moves) {
      if (m.t === 'feed' && m.f === 'plunge' && prev && m.z < prev.z - 1e-9 && Math.hypot(m.x - prev.x, m.y - prev.y) > 1e-6) expect((prev.z - m.z) / Math.hypot(m.x - prev.x, m.y - prev.y)).toBeLessThanOrEqual(Math.tan((5 * Math.PI) / 180) + 1e-6)
      if (m.t !== 'poly' && m.t !== 'drill') prev = m
    }
    const m2 = structuredClone(machine)
    m2.tools = m2.tools.map((t) => (t.id === FLAT ? { ...t, centreCutting: false } : t))
    const plunge = rough('raised-panel', { entry: 'plunge', toolId: FLAT, stepdown: 5 }, undefined, m2).tp
    expect(plunge.warnings.some((w) => w.includes('not centre-cutting'))).toBe(true)
  }, 120_000)

  it('boundary: zig-zag and offset clearing keep the tool centre inside a 30 mm circle', () => {
    for (const pattern of ['offset', 'zigzag'] as const) {
      const ring = makeEntity({ t: 'contour', c: circle(pt(75, 50), 30) }, 'outline')
      const { tp } = rough('sine', { pattern, surface: { boundaryMode: 'centre' } as Rough3dOp['surface'] }, [ring])
      const rs = clPoints(tp).map(([x, y]) => Math.hypot(x - 75, y - 50))
      expect(Math.max(...rs), pattern).toBeLessThanOrEqual(30.01)
      expect(Math.max(...rs), pattern).toBeGreaterThan(29)
    }
  }, 120_000)

  it('a model that does not cover the panel (a closed box standing on its own): the panel round it is roughed to its foot, the box is left (simulated, sampled gouge check)', () => {
    // 40 x 30 x 12 box, top at face 1, in the middle of a 100 x 80 panel. Before the fix every
    // pattern found "nothing to rough": the tool centre was kept inside the model's own footprint.
    const mesh = buildMesh(parseStl(stlBinary(box(30, 25, -12, 70, 55, 0))), { gapTol: 0 }).mesh
    const part: CamPart = {
      ...newPart({ name: 'box', length: 100, width: 80, thickness: 45 }),
      models: [{ id: 'm', name: 'box', kind: 'mesh', blob: 'box', source: 'box.stl', units: 'mm', place: { ...DEFAULT_PLACEMENT, at: [30, 25, 0] }, layer: 'models', visible: true, triangles: mesh.indices.length / 3, size: [40, 30, 12] }],
    }
    const s = 0.5
    const dBox = (x: number, y: number) => Math.hypot(Math.max(0, 30 - x, x - 70), Math.max(0, 25 - y, y - 55))
    for (const pattern of ['offset', 'zigzag', 'adaptive'] as const) {
      const base = defaultOp('rough3d') as Rough3dOp
      const op: Rough3dOp = { ...base, pattern, toolId: BULL, stepdown: 3, stockZ: s, surface: { ...base.surface, modelId: 'm', stockToLeave: s } }
      part.ops = [op]
      const tp = generateOp(op, { part, machine, meshes: new Map([['box', mesh]]) })
      expect(tp.warnings.some((w) => w.includes('does not cover the whole panel') && w.includes('-11.50 mm')), pattern).toBe(true)
      expect(tp.warnings.some((w) => w.startsWith('Nothing to rough')), pattern).toBe(false)
      const g = checkGouge(mesh, { shape: 'bull', r: 6, cornerRadius: 2 }, tp.moves, { stock: s, step: 0.2, resolution: 0.1, maxPoints: THOROUGH ? 2000 : 400 })
      expect(g.max, pattern).toBeLessThanOrEqual(0.005)
      const stock = new HeightfieldStock(part.length, part.width, part.thickness, 0.5)
      for (const seg of buildTimeline([tp]).segs) if (seg.kind !== 'rapid') stock.carve(seg.a, seg.b, seg.cutter)
      let keptMin = Infinity
      let floorHi = -Infinity
      let lowest = Infinity
      for (let y = 0.25; y < part.width; y += 0.5)
        for (let x = 0.25; x < part.length; x += 0.5) {
          const top = stock.heightAt(x, y)
          const d = dBox(x, y)
          lowest = Math.min(lowest, top)
          // the box and the stock to leave round it stay whole
          if (d < s - 0.05) keptMin = Math.min(keptMin, top)
          // beyond the tool's radius (plus the stock and a cell) the panel is down at the floor
          else if (d > 6 + s + 0.5) floorHi = Math.max(floorHi, top)
        }
      process.stdout.write(`  [roughing] box on its own, ${pattern}: box and stock kept to ${keptMin.toFixed(3)} mm, panel round it at most ${floorHi.toFixed(3)}, lowest ${lowest.toFixed(3)} (floor -11.5)\n`)
      expect(keptMin, pattern).toBeGreaterThanOrEqual(-1e-6)
      expect(floorHi, pattern).toBeLessThanOrEqual(-11.5 + 0.05)
      expect(lowest, pattern).toBeGreaterThanOrEqual(-11.5 - 0.005)
    }
    // with a boundary drawn nothing changes: the boundary still limits the tool centre
    const ring = makeEntity({ t: 'contour', c: circle(pt(50, 40), 30) }, 'outline')
    part.entities = [...part.entities, ring]
    const base = defaultOp('rough3d', [ring.id]) as Rough3dOp
    const op: Rough3dOp = { ...base, toolId: BULL, stepdown: 3, surface: { ...base.surface, modelId: 'm', boundaryMode: 'centre' } }
    part.ops = [op]
    const tp = generateOp(op, { part, machine, meshes: new Map([['box', mesh]]) })
    expect(tp.warnings.some((w) => w.includes('does not cover the whole panel'))).toBe(false)
    const rs = clPoints(tp).map(([x, y]) => Math.hypot(x - 50, y - 40))
    expect(rs.length).toBeGreaterThan(100)
    expect(Math.max(...rs)).toBeLessThanOrEqual(30.01)
  }, 120_000)

  it('a model that covers the panel gets no "does not cover" warning', () => {
    for (const name of Object.keys(SURFACES)) expect(rough(name).tp.warnings.some((w) => w.includes('does not cover the whole panel')), name).toBe(false)
  }, 120_000)

  it('flat-layer output: every pass of every level is a closed or open contour at that level depth', () => {
    const { op, tp } = rough('raised-panel', { stepdown: 4 })
    expect(isFlatLayer(op)).toBe(true)
    const cs = tp.intents.filter((i) => i.k === 'contour')
    expect(cs.length).toBeGreaterThan(5)
    const levels = new Set(clPoints(tp).map((p) => Math.round(-p[2] * 1e4) / 1e4))
    for (const c of cs) if (c.k === 'contour') expect(levels.has(c.passes[0].depth)).toBe(true)
  }, 60_000)
})

describe('M2.2b golden digests', () => {
  const cases: [string, () => Toolpath][] = [
    ['rough-hemisphere', () => rough('hemisphere', { stepdown: 4 }).tp],
    ['rough-raised-panel-zigzag', () => rough('raised-panel', { stepdown: 4, pattern: 'zigzag', angle: 30 }).tp],
    ['waterline-hemisphere', () => waterline('hemisphere', { stepdown: 2 }).tp],
    ['waterline-cove', () => waterline('cove', { stepdown: 2 }).tp],
  ]
  for (const [name, make] of cases)
    it(name, () => {
      const file = path.join(__dirname, 'golden', 'cam3d', name, 'toolpath.json')
      const got = digest3d(make())
      if (process.env.UPDATE_GOLDEN === '1') {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, JSON.stringify(got, null, 2) + '\n')
      }
      expect(fs.existsSync(file), `missing golden ${file}: run with UPDATE_GOLDEN=1 once and check the diff`).toBe(true)
      expect(got).toEqual(JSON.parse(fs.readFileSync(file, 'utf8')))
    }, 120_000)
})
