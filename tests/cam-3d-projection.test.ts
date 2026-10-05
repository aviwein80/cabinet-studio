/**
 * M2.2c projection finishing: drawn shapes and text dropped onto the analytic test surfaces.
 * Checked independently: no gouge on the surface, the tool centre on the drawn shape in plan,
 * stock to leave, engraving depth below the surface, protected and unchosen groups kept clear,
 * passes, warnings, export checker and golden digests.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkGouge, meshDistance } from '@/cam/3d/check'
import { makeEntity, newPart, opInputHash, opState } from '@/cam/doc'
import { circle, polyline, pt } from '@/cam/geom'
import { buildMesh } from '@/cam/mesh/build'
import { DEFAULT_PLACEMENT } from '@/cam/mesh/place'
import { parseStl } from '@/cam/mesh/read'
import { type Mesh, meshBounds } from '@/cam/mesh/types'
import { defaultOp } from '@/cam/ops'
import { generateOp, isFlatLayer, type Toolpath } from '@/cam/toolpath'
import type { CamOp, CamPart, Entity, Finish3dOp } from '@/cam/types'
import { defaultAppData, PLACEHOLDER_MACHINE } from '@/core/defaults'
import { runJob } from '@/core/pipeline'
import type { Job } from '@/core/types'
import { digest3d } from './cam-digest'
import { stlBinary } from './mesh-fixtures'
import { SURFACES } from './surfaces'

const machine = PLACEHOLDER_MACHINE
const THOROUGH = process.env.THOROUGH === '1'
const BALL = 't105' // 6 mm ball-nose (placeholder)
const SMALL_BALL = 't106' // 3 mm ball-nose (placeholder)
const BULL = 't107' // 12 mm R2 bull-nose (placeholder)
const FLAT = 't102' // 8 mm flat (placeholder)
const VBIT = 't104' // 90° V-bit 12.7 mm (placeholder)

const meshCache = new Map<string, Mesh>()
function meshOf(name: string): Mesh {
  let mesh = meshCache.get(name)
  if (!mesh) {
    mesh = buildMesh(parseStl(stlBinary(SURFACES[name].soup())), { gapTol: 0 }).mesh
    meshCache.set(name, mesh)
  }
  return mesh
}

/** Generate a projection op on surface `name` with the shapes `pattern`. */
function project(name: string, pattern: Entity[], patch: Partial<Finish3dOp> = {}, mesh = meshOf(name)) {
  const b = meshBounds(mesh)
  const part: CamPart = {
    ...newPart({ name, length: b.max[0], width: b.max[1], thickness: 45 }),
    models: [{ id: 'm', name, kind: 'mesh', blob: name, source: `${name}.stl`, units: 'mm', place: { ...DEFAULT_PLACEMENT, at: [b.min[0], b.min[1], b.max[2]] }, layer: 'models', visible: true, triangles: mesh.indices.length / 3, size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]] }],
  }
  part.entities = [...part.entities, ...pattern]
  const base = defaultOp('finish3d', pattern.map((e) => e.id), { strategy: 'projection' } as Partial<CamOp>) as Finish3dOp
  const op: Finish3dOp = { ...base, toolId: BALL, ...patch, levels: { ...base.levels, ...(patch.levels ?? {}) }, surface: { ...base.surface, modelId: 'm', ...(patch.surface ?? {}) } }
  part.ops = [op]
  const tp = generateOp(op, { part, machine, meshes: new Map([[name, mesh]]) })
  return { mesh, part, op, tp }
}

/** Points of the cutting chains. */
function clPoints(tp: Toolpath): [number, number, number][] {
  const out: [number, number, number][] = []
  for (const m of tp.moves) if (m.t === 'poly') for (let i = 0; i < m.pts.length; i += 3) out.push([m.pts[i], m.pts[i + 1], m.pts[i + 2]])
  return out
}

const ring = (cx: number, cy: number, r: number) => makeEntity({ t: 'contour', c: circle(pt(cx, cy), r) }, 'machining')
const wave = (pts: [number, number][]) => makeEntity({ t: 'contour', c: polyline(pts.map(([x, y]) => pt(x, y)), false) }, 'machining')
const text = (s: string, x: number, y: number, h: number) => makeEntity({ t: 'text', at: pt(x, y), text: s, height: h, angle: 0 }, 'text')

/** A circle, a zig-zag line and two letters inside each surface's footprint. */
const PATTERNS: Record<string, () => Entity[]> = {
  hemisphere: () => [ring(40, 40, 12), wave([[8, 30], [30, 50], [50, 30], [72, 50]]), text('AB', 26, 8, 10)],
  'hemisphere-dome': () => [ring(40, 40, 12), text('AB', 34, 36, 8)],
  sine: () => [ring(75, 50, 30), wave([[10, 10], [40, 90], [70, 10], [100, 90], [140, 20]]), text('CS', 50, 35, 25)],
  'raised-panel': () => [ring(100, 75, 50), wave([[30, 30], [100, 120], [170, 30]]), text('DOOR', 55, 60, 22)],
  cove: () => [wave([[5, 5], [25, 35], [45, 5]]), ring(30, 20, 12), text('M', 45, 22, 12)],
}

describe('M2.2c projection finishing: on the surface, no gouges (independent check)', () => {
  for (const name of Object.keys(SURFACES)) {
    it(`${name}, 6 mm ball-nose: deepest gouge <= 0.005 mm (exact check) and the tool rides the surface`, () => {
      const { mesh, tp } = project(name, PATTERNS[name]())
      expect(tp.warnings).toEqual([])
      const pts = clPoints(tp)
      expect(pts.length).toBeGreaterThan(100)
      const g = checkGouge(mesh, { shape: 'ball', r: 3 }, tp.moves, { step: 0.05 })
      expect(g.exact).toBe(true)
      expect(g.max).toBeLessThanOrEqual(0.005)
      expect(g.minClearance).toBeLessThan(0.001)
      // every chain point is an exact drop: the ball touches the surface there
      const dist = meshDistance(mesh)
      for (let i = 0; i < pts.length; i += Math.max(1, Math.floor(pts.length / 500))) {
        const [x, y, z] = pts[i]
        expect(Math.abs(dist(x, y, z + 3) - 3), `${x}, ${y}`).toBeLessThan(1e-4)
      }
    }, 60_000)
  }

  for (const [name, toolId, shape, r, cr, angle] of [
    ['sine', BULL, 'bull', 6, 2, 0],
    ['raised-panel', FLAT, 'flat', 4, 0, 0],
    ['sine', VBIT, 'v', 6.35, 0, 90],
    ['cove', VBIT, 'v', 6.35, 0, 90],
  ] as const) {
    it(`${name}, ${shape}: deepest gouge <= 0.005 mm (sampled check)`, () => {
      const { mesh, tp } = project(name, PATTERNS[name](), { toolId })
      expect(clPoints(tp).length).toBeGreaterThan(50)
      const g = checkGouge(mesh, { shape, r, cornerRadius: cr, angle }, tp.moves, { step: 0.1, resolution: 0.05, maxPoints: THOROUGH ? 1500 : 250 })
      expect(g.max).toBeLessThanOrEqual(0.005)
    }, 120_000)
  }

  it('the tool centre follows the drawn shape in plan', () => {
    const { tp } = project('sine', [ring(75, 50, 30)])
    const pts = clPoints(tp)
    expect(pts.length).toBeGreaterThan(100)
    for (const [x, y] of pts) expect(Math.abs(Math.hypot(x - 75, y - 50) - 30)).toBeLessThan(0.002)
    // a closed shape on the model is one unbroken chain, back to its start
    const polys = tp.moves.filter((m) => m.t === 'poly')
    expect(polys).toHaveLength(1)
    const start = tp.moves.find((m) => m.t === 'feed')!
    const end = pts[pts.length - 1]
    expect(Math.hypot(end[0] - (start as { x: number }).x, end[1] - (start as { y: number }).y)).toBeLessThan(1e-6)
  })

  it('stock to leave 0.5 mm: every point 0.5 ± 0.01 mm off the surface, no move closer', () => {
    for (const name of ['sine', 'hemisphere']) {
      const { mesh, tp } = project(name, PATTERNS[name](), { surface: { stockToLeave: 0.5 } as Finish3dOp['surface'] })
      const dist = meshDistance(mesh)
      const pts = clPoints(tp)
      for (let i = 0; i < pts.length; i += Math.max(1, Math.floor(pts.length / 400))) {
        const [x, y, z] = pts[i]
        expect(dist(x, y, z + 3) - 3).toBeCloseTo(0.5, 2)
      }
      expect(checkGouge(mesh, { shape: 'ball', r: 3 }, tp.moves, { stock: 0.5, step: 0.05 }).max, name).toBeLessThanOrEqual(0.005)
    }
  }, 60_000)
})

describe('M2.2c engraving below the surface', () => {
  it('depth 1.5 mm in 3 passes: the tip is exactly 1.5 mm below where the tool touches, never deeper', () => {
    const { mesh, tp } = project('hemisphere', PATTERNS['hemisphere-dome'](), { toolId: SMALL_BALL, levels: { depth: 1.5, passDepth: 0.5 } as Finish3dOp['levels'] })
    expect(tp.warnings).toEqual([])
    const dist = meshDistance(mesh)
    // raised by the depth of its pass, every point touches the surface again (independent distance)
    const depthOf: number[] = []
    for (const m of tp.moves) {
      if (m.t !== 'poly') continue
      let worst = 0
      let d = NaN
      for (let i = 0; i < m.pts.length; i += 3) {
        const x = m.pts[i], y = m.pts[i + 1], z = m.pts[i + 2]
        if (!Number.isFinite(d)) d = [0.5, 1, 1.5].find((k) => Math.abs(dist(x, y, z + k + 1.5) - 1.5) < 1e-4) ?? NaN
        worst = Math.max(worst, Math.abs(dist(x, y, z + d + 1.5) - 1.5))
      }
      expect(Number.isFinite(d)).toBe(true)
      expect(worst).toBeLessThan(1e-4)
      depthOf.push(d)
    }
    // shallowest first, every shape at every depth
    expect(depthOf.filter((d) => d === 0.5).length).toBe(depthOf.filter((d) => d === 1.5).length)
    expect(depthOf.filter((d) => d === 1).length).toBe(depthOf.filter((d) => d === 1.5).length)
    // the independent gouge check sees the engraving: as deep as 1.5 mm into the surface, never more
    const g = checkGouge(mesh, { shape: 'ball', r: 1.5 }, tp.moves, { step: 0.05 })
    process.stdout.write(`  [engrave] 1.5 mm below the dome: deepest into the surface ${g.max.toFixed(4)} mm\n`)
    expect(g.max).toBeGreaterThan(1.4)
    expect(g.max).toBeLessThanOrEqual(1.5 + 0.005)
  }, 60_000)

  it('on a flat field the engraving depth is exact; a closed shape stays down between passes', () => {
    const { tp } = project('raised-panel', [ring(100, 75, 15)], { toolId: VBIT, levels: { depth: 2, passDepth: 1 } as Finish3dOp['levels'] })
    const zs = new Set(clPoints(tp).map((p) => Math.round(p[2] * 1e6) / 1e6))
    expect([...zs].sort((a, b) => a - b)).toEqual([-2, -1])
    // one approach for the shape, then straight down in the groove for the second pass
    expect(tp.moves.filter((m) => m.t === 'feed' && m.f === 'plunge')).toHaveLength(2)
    expect(tp.moves.filter((m) => m.t === 'rapid').length).toBeLessThanOrEqual(4)
  })

  it('protected groups and groups not chosen are never cut, even when engraving below the surface', () => {
    // groups: 0 = field (flat top), 1 = bevel and border
    const base = meshOf('raised-panel')
    const groups = new Uint32Array(base.indices.length / 3)
    for (let t = 0; t < groups.length; t++) {
      const zs = [0, 1, 2].map((k) => base.positions[base.indices[t * 3 + k] * 3 + 2])
      groups[t] = zs.every((z) => Math.abs(z) < 1e-6) ? 0 : 1
    }
    const mesh: Mesh = { ...base, groups, groupNames: ['Field', 'Bevel'] }
    const bevel: Mesh = { positions: mesh.positions, indices: Uint32Array.from([...groups].flatMap((g, t) => (g === 1 ? [mesh.indices[t * 3], mesh.indices[t * 3 + 1], mesh.indices[t * 3 + 2]] : []))) }
    const across = [wave([[20, 75], [180, 75]]), wave([[100, 10], [100, 140]])]
    for (const surface of [{ protect: [1] }, { groups: [0] }] as Partial<Finish3dOp['surface']>[]) {
      const { tp } = project('raised-panel', across, { toolId: SMALL_BALL, levels: { depth: 1 } as Finish3dOp['levels'], surface: surface as Finish3dOp['surface'] }, mesh)
      const pts = clPoints(tp)
      // (straight lines on a flat need few points)
      expect(pts.length).toBeGreaterThan(3)
      // all cutting is 1 mm into the field; the bevel is never touched (independent exact check on its facets alone)
      for (const [, , z] of pts) expect(z).toBeCloseTo(-1, 6)
      expect(checkGouge(bevel, { shape: 'ball', r: 1.5 }, tp.moves, { step: 0.05 }).max).toBeLessThanOrEqual(0.005)
      // and it reaches close to the bevel (the keep-out is not too timid)
      const starts = tp.moves.flatMap((m) => (m.t === 'feed' ? [[m.x, m.y, m.z] as [number, number, number]] : []))
      const xs = [...starts, ...pts].filter(([, y]) => Math.abs(y - 75) < 1e-6).map(([x]) => x)
      expect(Math.min(...xs)).toBeLessThan(62)
      expect(Math.max(...xs)).toBeGreaterThan(138)
    }
  }, 60_000)
})

describe('M2.2c projection: warnings, tool choice, associativity and output', () => {
  it('shapes partly off the model are cut where they are over it, with a warning; none over it: nothing', () => {
    const { tp } = project('hemisphere', [wave([[-30, 40], [110, 40]])])
    expect(tp.warnings).toContain('Parts of the shapes are not over the model; those parts are not cut.')
    const xs = clPoints(tp).map((p) => p[0])
    expect(Math.min(...xs)).toBeGreaterThan(-3.01)
    expect(Math.max(...xs)).toBeLessThan(83.01)
    const off = project('hemisphere', [wave([[-30, -30], [-10, -10]])]).tp
    expect(off.moves).toEqual([])
    expect(off.warnings.join(' ')).toMatch(/Nothing to cut/)
    const empty = project('hemisphere', []).tp
    expect(empty.warnings[0]).toMatch(/Pick the shapes to project/)
  })

  it('picks the smallest ball-nose automatically; stock to leave with a V-bit is refused', () => {
    expect(project('sine', [ring(75, 50, 30)], { toolId: null }).tp.tool?.id).toBe(SMALL_BALL)
    const v = project('sine', [ring(75, 50, 30)], { toolId: VBIT, surface: { stockToLeave: 0.2 } as Finish3dOp['surface'] }).tp
    expect(v.moves).toEqual([])
    expect(v.warnings[0]).toMatch(/not a V cutter/)
  })

  it('editing a projected shape or the depth marks the op stale; it is never a flat layer', () => {
    const { part, op } = project('sine', [ring(75, 50, 30)])
    const tool = machine.tools.find((t) => t.id === BALL)!
    const built = { ...op, builtHash: opInputHash(op, part, tool, machine) }
    expect(opState(built, part, tool, machine)).toBe('current')
    const moved = { ...part, entities: part.entities.map((e) => (e.id === op.geometry[0] ? { ...e, g: { t: 'contour' as const, c: circle(pt(75, 50), 31) } } : e)) }
    expect(opState(built, moved, tool, machine)).toBe('stale')
    expect(opState({ ...built, levels: { ...built.levels, depth: 1 } }, part, tool, machine)).toBe('stale')
    expect(isFlatLayer(op)).toBe(false)
  })

  it('the export checker refuses projection finishing for woodWOP, even with both output switches on', () => {
    const { part: p } = project('sine', [ring(75, 50, 30)])
    const part = { ...p, materialId: 'mat-mdf18', thickness: 19 }
    const data = defaultAppData()
    const job: Job = { id: 'j', number: 'JP', name: 'Projection', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [part] }
    data.jobs = [job]
    data.settings.features = { ...data.settings.features, camMprOutput: true, cam3dMprOutput: true } as typeof data.settings.features
    const e = runJob(job, data).issues.filter((i) => i.code === 'CAM_3D_NO_OUTPUT')
    expect(e).toHaveLength(1)
    expect(e[0].severity).toBe('error')
  })

  const DIR = path.join(import.meta.dirname, 'golden', 'cam3d')
  const UPDATE = process.env.UPDATE_GOLDEN === '1'
  for (const [label, name, pattern, patch] of [
    ['sine-text', 'sine', 'sine', {}],
    ['hemisphere-engrave', 'hemisphere', 'hemisphere-dome', { toolId: VBIT, levels: { depth: 1, passDepth: 0.5 } }],
    ['raised-panel-stock', 'raised-panel', 'raised-panel', { toolId: BULL, surface: { stockToLeave: 0.3 } }],
  ] as [string, string, string, Partial<Finish3dOp>][]) {
    it(`golden: projection finishing, ${label}`, () => {
      const dig = JSON.stringify(digest3d(project(name, PATTERNS[pattern](), patch).tp), null, 1) + '\n'
      const f = path.join(DIR, `projection-${label}`, 'toolpath.json')
      if (UPDATE) {
        fs.mkdirSync(path.dirname(f), { recursive: true })
        fs.writeFileSync(f, dig)
      }
      expect(fs.existsSync(f), `${f} missing; run UPDATE_GOLDEN=1 once to create it`).toBe(true)
      expect(dig).toBe(fs.readFileSync(f, 'utf8'))
    }, 60_000)
  }
})
