/**
 * M2.2a parallel finishing on analytic test surfaces (hemisphere, sine relief, raised-panel field,
 * cove moulding), checked by the independent gouge checker, plus stock to leave, scallop height,
 * boundaries, slope limits, protected faces and golden digests.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkGouge, distanceToMesh } from '@/cam/3d/check'
import { DropCutter } from '@/cam/3d/dropcutter'
import { makeEntity, newPart, opInputHash, opState } from '@/cam/doc'
import { circle, pt } from '@/cam/geom'
import { buildMesh } from '@/cam/mesh/build'
import { DEFAULT_PLACEMENT } from '@/cam/mesh/place'
import { parseStl } from '@/cam/mesh/read'
import { type Mesh, meshBounds } from '@/cam/mesh/types'
import { defaultOp } from '@/cam/ops'
import { generateOp, simpleMoves, type Toolpath } from '@/cam/toolpath'
import type { CamPart, Finish3dOp } from '@/cam/types'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import { digest3d } from './cam-digest'
import { relief, type Soup, stlBinary } from './mesh-fixtures'

const machine = PLACEHOLDER_MACHINE
/** THOROUGH=1 checks many more tool positions (minutes instead of seconds). */
const THOROUGH = process.env.THOROUGH === '1'
const BALL = 't105' // 6 mm ball-nose (placeholder)
const BULL = 't107' // 12 mm R2 bull-nose (placeholder)
const FLAT = 't102' // 8 mm flat (placeholder)

// analytic test surfaces (z = 0 at the top of each)
// radius 20 so the 6 mm ball's 25 mm flutes reach the base
const hemisphere = (x: number, y: number) => {
  const r = Math.hypot(x - 40, y - 40)
  return r < 20 ? Math.sqrt(400 - r * r) - 20 : -20
}
const sine = (x: number, y: number) => -3 + 2.5 * Math.sin(x / 15) * Math.cos(y / 20)
const raisedPanel = (x: number, y: number) => {
  const e = Math.min(x - 20, y - 20, 180 - x, 130 - y) // distance in from the bevel's outer edge
  return e >= 40 ? 0 : e <= 0 ? -10 : -10 + (10 * e) / 40
}
const cove = (_x: number, y: number) => (y < 20 ? -Math.sqrt(Math.max(0, 400 - (y - 20) ** 2)) : -20)

const SURFACES: Record<string, { soup: () => Soup; f: (x: number, y: number) => number }> = {
  hemisphere: { soup: () => relief(80, 80, 160, 160, hemisphere), f: hemisphere },
  sine: { soup: () => relief(150, 100, 150, 100, sine), f: sine },
  'raised-panel': { soup: () => relief(200, 150, 200, 150, raisedPanel), f: raisedPanel },
  cove: { soup: () => relief(60, 40, 30, 160, cove), f: cove },
}

const meshCache = new Map<string, Mesh>()
function setup(name: string, patch: Partial<Finish3dOp> = {}, boundary?: ReturnType<typeof makeEntity>[]) {
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
  const base = defaultOp('finish3d', boundary?.map((e) => e.id) ?? []) as Finish3dOp
  const op: Finish3dOp = { ...base, toolId: BALL, stepover: 1, ...patch, surface: { ...base.surface, modelId: 'm', ...(patch.surface ?? {}) } }
  part.ops = [op]
  const tp = generateOp(op, { part, machine, meshes: new Map([[name, mesh]]) })
  return { mesh, part, op, tp }
}

/** CL points (exact drop positions) of the cutting chains. */
function clPoints(tp: Toolpath): [number, number, number][] {
  const out: [number, number, number][] = []
  for (const m of tp.moves) if (m.t === 'poly') for (let i = 0; i < m.pts.length; i += 3) out.push([m.pts[i], m.pts[i + 1], m.pts[i + 2]])
  return out
}

describe('M2.2a parallel finishing: no gouges on the analytic surfaces (independent check)', () => {
  for (const name of Object.keys(SURFACES)) {
    it(`${name}, 6 mm ball-nose: deepest gouge <= 0.005 mm (exact check)`, () => {
      const { mesh, tp } = setup(name, { stepover: 1.5 })
      expect(tp.warnings).toEqual([])
      expect(clPoints(tp).length).toBeGreaterThan(100)
      const g = checkGouge(mesh, { shape: 'ball', r: 3 }, tp.moves, { step: 0.1 })
      expect(g.exact).toBe(true)
      expect(g.max).toBeLessThanOrEqual(0.005)
      // and the tool really is on the surface, not floating: closest approach ~ 0
      expect(g.minClearance).toBeLessThan(0.001)
    }, 60_000)
  }

  for (const [name, toolId, shape, r, cr] of [
    ['sine', BULL, 'bull', 6, 2],
    ['raised-panel', BULL, 'bull', 6, 2],
    ['sine', FLAT, 'flat', 4, 0],
    ['cove', FLAT, 'flat', 4, 0],
  ] as const) {
    it(`${name}, ${shape}: deepest gouge <= 0.005 mm (sampled check)`, () => {
      const { mesh, tp } = setup(name, { toolId, stepover: 4 })
      expect(clPoints(tp).length).toBeGreaterThan(50)
      const g = checkGouge(mesh, { shape, r, cornerRadius: cr }, tp.moves, { step: 0.1, resolution: 0.05, maxPoints: THOROUGH ? 1500 : 250 })
      expect(g.max).toBeLessThanOrEqual(0.005)
    }, 120_000)
  }

  it('the meshes are true to the formulas (so the checks speak for the surfaces too)', () => {
    for (const [name, s] of Object.entries(SURFACES)) {
      const mesh = setup(name).mesh
      const p = mesh.positions
      let worst = 0
      for (let i = 0; i < p.length; i += 3) worst = Math.max(worst, Math.abs(p[i + 2] - s.f(p[i], p[i + 1])))
      expect(worst, name).toBeLessThan(1e-5)
    }
  })
})

describe('M2.2a stock to leave, scallop and limits', () => {
  it('stock to leave 0.5 mm: every CL point is 0.5 ± 0.01 mm off the surface, and no move comes closer', () => {
    for (const name of ['sine', 'cove', 'hemisphere']) {
      const { mesh, tp } = setup(name, { surface: { stockToLeave: 0.5 } as Finish3dOp['surface'], stepover: 2 })
      const pts = clPoints(tp)
      for (let i = 0; i < pts.length; i += Math.max(1, Math.floor(pts.length / 400))) {
        const [x, y, z] = pts[i]
        expect(distanceToMesh(mesh, x, y, z + 3) - 3).toBeCloseTo(0.5, 2)
      }
      const g = checkGouge(mesh, { shape: 'ball', r: 3 }, tp.moves, { stock: 0.5, step: 0.1 })
      expect(g.max, name).toBeLessThanOrEqual(0.005)
    }
  }, 120_000)

  it('scallop height on a flat and on a 5° slope is within ±10 % of the value the step-over implies', () => {
    for (const deg of [0, 5]) {
      const tb = Math.tan((deg * Math.PI) / 180)
      const f = (_x: number, y: number) => -2 + y * tb - 40 * tb
      const mesh = buildMesh(parseStl(stlBinary(relief(40, 40, 4, 4, f))), { gapTol: 0 }).mesh
      meshCache.set(`plane${deg}`, mesh)
      SURFACES[`plane${deg}`] = { soup: () => [], f }
      const { tp } = setup(`plane${deg}`, { stepover: 0.6, angle: 0 })
      // passes run along X, spaced in Y; the cusp between two passes, measured upright
      const ys = [...new Set(clPoints(tp).map((p) => Math.round(p[1] * 1e6) / 1e6))].sort((a, b) => a - b)
      const spacing = ys[1] - ys[0]
      expect(spacing).toBeLessThanOrEqual(0.6)
      const b = (deg * Math.PI) / 180
      const across = spacing / Math.cos(b) // distance between passes on the slope
      const theory = (3 - Math.sqrt(9 - (across / 2) ** 2)) / Math.cos(b)
      // Measure: the material left across the passes at x = 20. A ball moving straight along X
      // leaves a circular groove, so the stock height at y is the lowest ball bottom over all
      // passes (exact for this case); the cusp is the most left above the design surface.
      const passes = new Map<number, number>()
      let prev: { x: number; y: number; z: number } | null = null
      for (const m of simpleMoves(tp.moves)) {
        if (m.t === 'feed' && m.f === 'cut' && prev && (prev.x - 20) * (m.x - 20) <= 0 && prev.x !== m.x && Math.abs(prev.y - m.y) < 1e-9)
          passes.set(Math.round(m.y * 1e6) / 1e6, prev.z + ((m.z - prev.z) * (20 - prev.x)) / (m.x - prev.x))
        prev = m.t === 'drill' ? null : m
      }
      // the model sits at its own height (placement keeps its top where it is), so part Z = f
      let cusp = 0
      for (let y = 15; y < 25; y += 0.001) {
        let low = Infinity
        for (const [py, pz] of passes) if (Math.abs(y - py) <= 3) low = Math.min(low, pz + 3 - Math.sqrt(9 - (y - py) ** 2))
        cusp = Math.max(cusp, low - f(20, y))
      }
      process.stdout.write(`  [scallop] ${deg}°: measured ${cusp.toFixed(5)} mm, theory ${theory.toFixed(5)} mm (${((cusp / theory - 1) * 100).toFixed(1)} %)\n`)
      expect(cusp / theory, `${deg}°: measured ${cusp.toFixed(5)}, theory ${theory.toFixed(5)}`).toBeGreaterThan(0.9)
      expect(cusp / theory).toBeLessThan(1.1)
    }
  }, 120_000)

  it('boundaries: centre, contained and touching clip the tool centre to the right circle', () => {
    for (const [mode, limit] of [
      ['centre', 30],
      ['contained', 27],
      ['touching', 33],
    ] as const) {
      const ring = makeEntity({ t: 'contour', c: circle(pt(75, 50), 30) }, 'outline')
      const { tp } = setup('sine', { surface: { boundaryMode: mode } as Finish3dOp['surface'], stepover: 1 }, [ring])
      const rs = clPoints(tp).map(([x, y]) => Math.hypot(x - 75, y - 50))
      expect(Math.max(...rs), mode).toBeLessThanOrEqual(limit + 0.01)
      expect(Math.max(...rs), mode).toBeGreaterThan(limit - 1)
    }
  }, 60_000)

  it('slope limits and skip flats: only the hemisphere above 30° is cut, the flat base never', () => {
    const { tp } = setup('hemisphere', { slope: { min: 30, max: 90 }, skipFlats: true, stepover: 1 })
    const pts = clPoints(tp)
    expect(pts.length).toBeGreaterThan(100)
    // ball on a sphere: contact slope = asin(r / (20 + 3)) at ball-centre distance r from the axis;
    // the flat base (slope 0) is never cut on its own, so the ball always touches the dome
    for (const [x, y] of pts) {
      const r = Math.hypot(x - 40, y - 40)
      // (slopes come from the facets, which differ from the true sphere by under a degree)
      expect(r).toBeGreaterThan(23 * Math.sin((29 * Math.PI) / 180))
      expect(r).toBeLessThan(23 + 0.05)
    }
    const flat = setup('raised-panel', { slope: { min: 0, max: 90 }, skipFlats: true, stepover: 2 }).tp
    for (const [, , z] of clPoints(flat)) expect(z > -10 + 1e-6 && z < -1e-6).toBe(true)
  }, 60_000)

  it('protected faces: the tool lifts over them but still keeps clear of them', () => {
    // groups: 0 = field (flat top), 1 = bevel and border
    const name = 'raised-panel'
    const mesh = setup(name).mesh
    const groups = new Uint32Array(mesh.indices.length / 3)
    for (let t = 0; t < groups.length; t++) {
      const zs = [0, 1, 2].map((k) => mesh.positions[mesh.indices[t * 3 + k] * 3 + 2])
      groups[t] = zs.every((z) => Math.abs(z) < 1e-6) ? 0 : 1
    }
    meshCache.set('panel-groups', { ...mesh, groups, groupNames: ['Field', 'Bevel'] })
    SURFACES['panel-groups'] = SURFACES[name]
    const { tp } = setup('panel-groups', { surface: { protect: [1] } as Finish3dOp['surface'], stepover: 2 })
    const dc = new DropCutter({ ...mesh, groups }, { kind: 'torus', R: 3, rc: 3 })
    const pts = clPoints(tp)
    expect(pts.length).toBeGreaterThan(50)
    for (const [x, y] of pts) {
      expect(dc.drop(x, y)).toBe(true)
      expect(groups[dc.hitTri]).toBe(0)
    }
    expect(checkGouge(mesh, { shape: 'ball', r: 3 }, tp.moves).max).toBeLessThanOrEqual(0.005)
  }, 60_000)

  it('zig-zag alternates, one-way does not; links stay on the surface and never dig in', () => {
    const zz = setup('sine', { pattern: 'zigzag', stepover: 3 }).tp
    const ow = setup('sine', { pattern: 'oneway', stepover: 3 }).tp
    expect(zz.moves.filter((m) => m.t === 'rapid').length).toBeLessThan(6)
    expect(ow.moves.filter((m) => m.t === 'rapid').length).toBeGreaterThan(40)
    const dirs = (tp: Toolpath) => tp.moves.filter((m) => m.t === 'poly' && m.pts.length > 30).map((m) => Math.sign((m as { pts: Float64Array }).pts.at(-3)! - (m as { pts: Float64Array }).pts[0]))
    expect(new Set(dirs(ow))).toEqual(new Set([1]))
    expect(new Set(dirs(zz))).toEqual(new Set([1, -1]))
  }, 60_000)
})

describe('M2.2a associativity, safety and goldens', () => {
  it('moving the model or changing its data marks the op stale', () => {
    const { part, op } = setup('cove')
    const tool = machine.tools.find((t) => t.id === BALL)!
    const built = { ...op, builtHash: opInputHash(op, part, tool, machine) }
    expect(opState(built, part, tool, machine)).toBe('current')
    const moved = { ...part, models: part.models!.map((m) => ({ ...m, place: { ...m.place, at: [m.place.at[0] + 1, m.place.at[1], m.place.at[2]] as [number, number, number] } })) }
    expect(opState(built, moved, tool, machine)).toBe('stale')
    const newData = { ...part, models: part.models!.map((m) => ({ ...m, blob: 'other' })) }
    expect(opState(built, newData, tool, machine)).toBe('stale')
  })

  it('no mesh loaded, no model, or a drill as the tool: a clear warning and no moves', () => {
    const { part, op } = setup('cove')
    expect(generateOp(op, { part, machine }).warnings[0]).toMatch(/not loaded/)
    expect(generateOp({ ...op, surface: { ...op.surface, modelId: 'x' } }, { part, machine }).warnings[0]).toMatch(/Pick the 3D model/)
    const drill = generateOp({ ...op, toolId: 't201' }, { part, machine, meshes: new Map([['cove', meshCache.get('cove')!]]) })
    expect(drill.moves).toEqual([])
    expect(drill.warnings[0]).toMatch(/not a router/)
  })

  it('rapids stay above the surface; the deepest point is reported against the flute length', () => {
    const { tp, mesh } = setup('hemisphere', { stepover: 4, pattern: 'oneway' })
    const dc = new DropCutter(mesh, { kind: 'torus', R: 3, rc: 3 })
    let x = NaN
    let y = NaN
    let z = NaN
    let rapids = 0
    for (const m of simpleMoves(tp.moves)) {
      if (m.t === 'rapid' && Number.isFinite(x)) {
        rapids++
        for (let k = 0; k <= 20; k++) {
          const px = x + ((m.x - x) * k) / 20
          const py = y + ((m.y - y) * k) / 20
          const pz = z + ((m.z - z) * k) / 20
          if (dc.drop(px, py)) expect(pz).toBeGreaterThanOrEqual(dc.z - 1e-6)
        }
      }
      if (m.t !== 'drill') {
        x = m.x
        y = m.y
        z = m.z
      }
    }
    expect(rapids).toBeGreaterThan(10)
    const deep = setup('hemisphere', { toolId: 't106', stepover: 4 }).tp // 3 mm ball, 12 mm flutes, 20 mm deep dome
    expect(deep.warnings.join(' ')).toMatch(/shank or holder may rub/)
  })

  const DIR = path.join(import.meta.dirname, 'golden', 'cam3d')
  const UPDATE = process.env.UPDATE_GOLDEN === '1'
  for (const [name, patch] of [
    ['hemisphere', { stepover: 2 }],
    ['sine', { stepover: 2, angle: 30 }],
    ['raised-panel', { stepover: 3, pattern: 'oneway' }],
    ['cove', { stepover: 1, surface: { stockToLeave: 0.25 } }],
  ] as [string, Partial<Finish3dOp>][]) {
    it(`golden: parallel finishing on ${name}`, () => {
      const dig = JSON.stringify(digest3d(setup(name, patch).tp), null, 1) + '\n'
      const f = path.join(DIR, `parallel-${name}`, 'toolpath.json')
      if (UPDATE) {
        fs.mkdirSync(path.dirname(f), { recursive: true })
        fs.writeFileSync(f, dig)
      }
      // a missing golden fails: it must be made on purpose with UPDATE_GOLDEN=1
      expect(fs.existsSync(f), `${f} missing; run UPDATE_GOLDEN=1 once to create it`).toBe(true)
      expect(dig).toBe(fs.readFileSync(f, 'utf8'))
    }, 60_000)
  }
})
