/**
 * M2.3c pencil pass and 3D rest machining (3D-06), checked against analytic valleys and the exact
 * gouge checker: the pencil line where a ball touches both sides of a valley, worked out by hand;
 * 3D rest cutting only around what a larger ball could not reach, and leaving less behind.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkGouge, meshDistance } from '@/cam/3d/check'
import { carve, restArea, topRaster } from '@/cam/3d/rest3d'
import { modelsFor, newPart, opInputHash, opState, restSources } from '@/cam/doc'
import { buildMesh } from '@/cam/mesh/build'
import { DEFAULT_PLACEMENT } from '@/cam/mesh/place'
import { parseStl } from '@/cam/mesh/read'
import { type Mesh, meshBounds } from '@/cam/mesh/types'
import { defaultOp, toTemplate } from '@/cam/ops'
import { generateOp, isFlatLayer, type Toolpath } from '@/cam/toolpath'
import type { CamOp, CamPart, Finish3dOp } from '@/cam/types'
import { createHeightfield, cutterZ, stamp } from '@/cam/sim'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import { digest3d } from './cam-digest'
import { relief, stlBinary } from './mesh-fixtures'
import { SURFACES } from './surfaces'

const machine = PLACEHOLDER_MACHINE
const BALL = 't105' // 6 mm ball-nose (placeholder)
const SMALL_BALL = 't106' // 3 mm ball-nose (placeholder)

// a V groove 10 mm deep with 45° sides along x = 50, and one along the diagonal x = y; both
// creases lie on facet edges of the relief, so the meshes are exact
const vGroove = (x: number) => Math.min(0, -10 + Math.abs(x - 50))
const vDiagonal = (x: number, y: number) => Math.min(0, -10 + Math.abs(x - y) / Math.SQRT2)
const MODELS: Record<string, () => number[][]> = {
  ...Object.fromEntries(Object.entries(SURFACES).map(([k, v]) => [k, v.soup])),
  'v-groove': () => relief(100, 60, 100, 60, vGroove),
  'v-diagonal': () => relief(100, 100, 100, 100, vDiagonal),
}

const meshCache = new Map<string, Mesh>()
function meshOf(name: string): Mesh {
  let mesh = meshCache.get(name)
  if (!mesh) {
    mesh = buildMesh(parseStl(stlBinary(MODELS[name]())), { gapTol: 0 }).mesh
    meshCache.set(name, mesh)
  }
  return mesh
}

function partOf(name: string): CamPart {
  const mesh = meshOf(name)
  const b = meshBounds(mesh)
  return {
    ...newPart({ name, length: b.max[0], width: b.max[1], thickness: 45 }),
    models: [{ id: 'm', name, kind: 'mesh', blob: name, source: `${name}.stl`, units: 'mm', place: { ...DEFAULT_PLACEMENT, at: [b.min[0], b.min[1], b.max[2]] }, layer: 'models', visible: true, triangles: mesh.indices.length / 3, size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]] }],
  }
}

function finish(strategy: Finish3dOp['strategy'], patch: Partial<Finish3dOp> = {}): Finish3dOp {
  const base = defaultOp('finish3d', [], { strategy } as Partial<CamOp>) as Finish3dOp
  return { ...base, strategy, toolId: BALL, ...patch, surface: { ...base.surface, modelId: 'm', ...(patch.surface ?? {}) } }
}

/** Generate the last of `ops` on model `name` (the others run before it). */
function run(name: string, ops: Finish3dOp[]) {
  const part = { ...partOf(name), ops }
  const op = ops[ops.length - 1]
  const tp = generateOp(op, { part, machine, meshes: new Map([[name, meshOf(name)]]) })
  return { mesh: meshOf(name), part, op, tp }
}

/**
 * Points of the cutting chains (each from the point its plunge reaches), and with `step` their
 * segments sampled every `step` mm too (to check between the points).
 */
function clPoints(tp: Toolpath, step = 0): [number, number, number][] {
  const out: [number, number, number][] = []
  let at: [number, number, number] | null = null
  const to = (p: [number, number, number]) => {
    if (at && step > 0) {
      const n = Math.ceil(Math.hypot(p[0] - at[0], p[1] - at[1]) / step)
      for (let k = 1; k < n; k++) out.push([at[0] + ((p[0] - at[0]) * k) / n, at[1] + ((p[1] - at[1]) * k) / n, at[2] + ((p[2] - at[2]) * k) / n])
    }
    out.push(p)
    at = p
  }
  for (const m of tp.moves) {
    if (m.t === 'rapid') at = null
    else if (m.t === 'feed' && m.f === 'plunge') {
      at = null
      to([m.x, m.y, m.z])
    } else if (m.t === 'poly') for (let i = 0; i < m.pts.length; i += 3) to([m.pts[i], m.pts[i + 1], m.pts[i + 2]])
  }
  return out
}

/** Length of the cutting moves in plan. */
function cutLength(tp: Toolpath): number {
  let L = 0
  for (const m of tp.moves) if (m.t === 'poly') for (let i = 3; i < m.pts.length; i += 3) L += Math.hypot(m.pts[i] - m.pts[i - 3], m.pts[i + 1] - m.pts[i - 2])
  return L
}

describe('M2.3c pencil pass: follows valleys within 0.02 mm (analytic), no gouges', () => {
  it('raised panel: along the foot of the bevel, at the analytic offset and height, all the way round', () => {
    const { mesh, tp } = run('raised-panel', [finish('pencil')])
    expect(tp.warnings).toEqual([])
    // a 6 mm ball touching the flat border (z = -10) and the bevel (slope 1 in 4) sits r tan(a / 2)
    // outside the foot of the bevel, its tip on the border's level
    const want = 3 * Math.tan(Math.atan(0.25) / 2)
    let worstXY = 0
    let worstZ = 0
    let n = 0
    const sides = [0, 0, 0, 0]
    for (const [x, y, z] of clPoints(tp, 0.25)) {
      // (the corners of the foot are rounded by the ball: checked for gouges below)
      if ((Math.abs(x - 20) < 8 || Math.abs(x - 180) < 8) && (Math.abs(y - 20) < 8 || Math.abs(y - 130) < 8)) continue
      // distance out from the foot of the bevel, to the nearest side
      const d = [20 - x, x - 180, 20 - y, y - 130]
      const k = d.indexOf(Math.max(...d))
      sides[k]++
      worstXY = Math.max(worstXY, Math.abs(d[k] - want))
      worstZ = Math.max(worstZ, Math.abs(z + 10))
      n++
    }
    process.stdout.write(`  [pencil] raised panel: ${n} points checked, worst ${worstXY.toFixed(4)} mm in plan, ${worstZ.toFixed(4)} mm in height\n`)
    expect(sides.every((c) => c > 50)).toBe(true)
    expect(worstXY).toBeLessThanOrEqual(0.02)
    expect(worstZ).toBeLessThanOrEqual(0.02)
    // one closed loop round the panel
    expect(tp.moves.filter((m) => m.t === 'poly')).toHaveLength(1)
    const g = checkGouge(mesh, { shape: 'ball', r: 3 }, tp.moves, { step: 0.05 })
    expect(g.exact).toBe(true)
    expect(g.max).toBeLessThanOrEqual(0.005)
  }, 60_000)

  for (const [name, toolId, r] of [
    ['v-groove', BALL, 3],
    ['v-groove', SMALL_BALL, 1.5],
    ['v-diagonal', BALL, 3],
  ] as const) {
    it(`${name}, ${2 * r} mm ball: on the groove's centre line, tip at the analytic height`, () => {
      const { mesh, tp } = run(name, [finish('pencil', { toolId })])
      expect(tp.warnings).toEqual([])
      // touching both 45° sides: centre r √2 above the bottom, so the tip is r (√2 - 1) above it
      const tip = -10 + r * (Math.SQRT2 - 1)
      const pts = clPoints(tp, 0.25)
      let worstXY = 0
      let worstZ = 0
      let lo = Infinity
      let hi = -Infinity
      const len = name === 'v-groove' ? 60 : 100 * Math.SQRT2
      for (const [x, y, z] of pts) {
        const along = name === 'v-groove' ? y : (x + y) / Math.SQRT2
        lo = Math.min(lo, along)
        hi = Math.max(hi, along)
        worstXY = Math.max(worstXY, name === 'v-groove' ? Math.abs(x - 50) : Math.abs(x - y) / Math.SQRT2)
        // (where the diagonal groove runs out at a corner of the model, one side is missing within
        // r of the edge, so the ball sits lower there: checked for gouges below)
        if (name === 'v-groove' || (along > 2 * r && along < len - 2 * r)) worstZ = Math.max(worstZ, Math.abs(z - tip))
      }
      process.stdout.write(`  [pencil] ${name}, ${2 * r} mm ball: worst ${worstXY.toFixed(4)} mm in plan, ${worstZ.toFixed(4)} mm in height\n`)
      expect(worstXY).toBeLessThanOrEqual(0.02)
      expect(worstZ).toBeLessThanOrEqual(0.02)
      // the whole length of the groove (to within a tool radius of the model's ends)
      expect(lo).toBeLessThan(r + 0.5)
      expect(hi).toBeGreaterThan(len - r - 0.5)
      expect(checkGouge(mesh, { shape: 'ball', r }, tp.moves, { step: 0.05 }).max).toBeLessThanOrEqual(0.005)
    }, 60_000)
  }

  it('hemisphere: rings round the foot of the dome near the analytic radius, no gouges', () => {
    const { mesh, tp } = run('hemisphere', [finish('pencil')])
    expect(tp.warnings).toEqual([])
    // a 6 mm ball on the base (z = -20) touching the dome of radius 20: centre 23 from the dome's
    // centre, so sqrt(23² - 3²) out in plan, tip on the base. The mesh's facets near the vertical
    // foot of the dome sit up to about 0.4 mm inside the true sphere and meet each other in small
    // valleys of their own, so the ring follows the facets, not the sphere.
    const R = Math.sqrt(23 * 23 - 9)
    const pts = clPoints(tp)
    expect(pts.length).toBeGreaterThan(200)
    for (const [x, y] of pts) expect(Math.abs(Math.hypot(x - 40, y - 40) - R)).toBeLessThan(0.5)
    // all the way round, on the base or just above it where it follows the facets' own small
    // valleys (measured: about 60 % of the points within 0.01 mm of the base)
    for (const [, , z] of pts) expect(z).toBeGreaterThan(-20 - 1e-6)
    for (const [, , z] of pts) expect(z).toBeLessThan(-17)
    const angles = new Set(pts.map(([x, y]) => Math.floor(((Math.atan2(y - 40, x - 40) + Math.PI) / (2 * Math.PI)) * 36) % 36))
    expect(angles.size).toBe(36)
    expect(checkGouge(mesh, { shape: 'ball', r: 3 }, tp.moves, { step: 0.05 }).max).toBeLessThanOrEqual(0.005)
  }, 60_000)

  it('smooth surfaces (sine, a cove larger than the ball) have no valleys: nothing to cut, with a warning', () => {
    for (const name of ['sine', 'cove']) {
      const { tp } = run(name, [finish('pencil')])
      expect(tp.moves, name).toEqual([])
      expect(tp.warnings[0], name).toMatch(/No valleys or inside corners/)
    }
  }, 60_000)

  it('the valley angle setting: the panel bevel (14°) is skipped when only valleys over 20° are wanted', () => {
    const { tp } = run('raised-panel', [finish('pencil', { pencilAngle: 20 })])
    expect(tp.moves).toEqual([])
    // the 90° groove is still found
    expect(clPoints(run('v-groove', [finish('pencil', { pencilAngle: 20 })]).tp).length).toBeGreaterThan(2)
  }, 60_000)

  it('stock to leave: the pencil line stays 0.3 mm off both sides of the groove', () => {
    const { mesh, tp } = run('v-groove', [finish('pencil', { surface: { stockToLeave: 0.3 } as Finish3dOp['surface'] })])
    const dist = meshDistance(mesh)
    const pts = clPoints(tp)
    expect(pts.length).toBeGreaterThan(1)
    for (const [x, y, z] of pts) expect(dist(x, y, z + 3) - 3).toBeCloseTo(0.3, 3)
    expect(checkGouge(mesh, { shape: 'ball', r: 3 }, tp.moves, { stock: 0.3, step: 0.05 }).max).toBeLessThanOrEqual(0.005)
  }, 60_000)

  it('picks the smallest ball-nose; never a flat layer; editing the angle marks it stale', () => {
    const { part, op, tp } = run('v-groove', [finish('pencil', { toolId: null })])
    expect(tp.tool?.id).toBe(SMALL_BALL)
    expect(isFlatLayer(op)).toBe(false)
    const tool = machine.tools.find((t) => t.id === SMALL_BALL)!
    const built = { ...op, builtHash: opInputHash(op, part, tool, machine) }
    expect(opState(built, part, tool, machine)).toBe('current')
    expect(opState({ ...built, pencilAngle: 30 }, part, tool, machine)).toBe('stale')
  }, 60_000)
})

describe('M2.3c 3D rest machining: only where the earlier operations left material', () => {
  // the earlier finish: 6 mm ball, 1 mm stepover, passes across the groove
  const big = (patch: Partial<Finish3dOp> = {}) => finish('parallel', { id: 'big', toolId: BALL, stepover: 1, ...patch })
  const rest = (patch: Partial<Finish3dOp> = {}) => finish('parallel', { id: 'rest', toolId: SMALL_BALL, stepover: 0.3, rest: { from: [], minThickness: 0.1 }, ...patch })

  it('V groove after a 6 mm ball: a 3 mm ball cuts only along the groove, much less than a full finish, and leaves less', () => {
    const { mesh, part, tp } = run('v-groove', [big(), rest()])
    expect(tp.warnings.join(' ')).toMatch(/Rest machining: \d+ mm² left by the earlier operations that this tool can reach/)
    const pts = clPoints(tp)
    expect(pts.length).toBeGreaterThan(50)
    // the 6 mm ball touches the sides 3 sin 45° = 2.1 mm from the bottom: material is left inside
    // that, and the small ball's centre stays within its radius (and a cell) of it
    const far = Math.max(...pts.map(([x]) => Math.abs(x - 50)))
    process.stdout.write(`  [rest3d] farthest cut from the groove: ${far.toFixed(2)} mm\n`)
    expect(far).toBeLessThan(2.13 + 1.5 + 0.25 + 0.01)
    // it reaches the bottom along the whole groove
    expect(Math.min(...pts.map(([, , z]) => z))).toBeCloseTo(-10 + 1.5 * (Math.SQRT2 - 1), 2)
    const ys = pts.filter(([x]) => Math.abs(x - 50) < 0.2).map(([, y]) => y)
    expect(Math.min(...ys)).toBeLessThan(3)
    expect(Math.max(...ys)).toBeGreaterThan(57)
    // a fraction of a full finish with the same tool and settings
    const full = run('v-groove', [rest({ rest: undefined })]).tp
    const ratio = cutLength(tp) / cutLength(full)
    process.stdout.write(`  [rest3d] cut length ${cutLength(tp).toFixed(0)} mm vs ${cutLength(full).toFixed(0)} mm for a full finish (${(100 * ratio).toFixed(1)} %)\n`)
    expect(ratio).toBeLessThan(0.15)
    // no gouges (exact check)
    expect(checkGouge(mesh, { shape: 'ball', r: 1.5 }, tp.moves, { step: 0.05 }).max).toBeLessThanOrEqual(0.005)
    // simulated: what the 3 mm ball could still remove, after the 6 mm ball alone and after both
    const bigTp = run('v-groove', [big()]).tp
    const opt = { cutter: { kind: 'torus' as const, R: 1.5, rc: 1.5 }, stock: 0, min: 0.01, cell: 0.1 }
    const before = restArea(mesh, [bigTp], part, opt)
    const after = restArea(mesh, [bigTp, tp], part, opt)
    process.stdout.write(`  [rest3d] thickest a 3 mm ball can remove: ${before.thickest.toFixed(3)} mm after the 6 mm ball, ${after.thickest.toFixed(3)} mm after the rest pass\n`)
    // (the 6 mm ball's tip stops 3 (√2 - 1) above the groove's bottom, the 3 mm ball's half that:
    // 0.62 mm straight up, 0.44 mm square to the 45° sides)
    expect(before.thickest).toBeGreaterThan(0.4)
    expect(after.thickest).toBeLessThan(0.1)
  }, 120_000)

  it('nothing to follow, or nothing left: no moves and a warning', () => {
    const none = run('v-groove', [rest()]).tp
    expect(none.moves).toEqual([])
    expect(none.warnings).toContain('Rest machining: there is no earlier milling operation to follow, so nothing is cut.')
    // after the same small ball has finished everything, nothing thicker than 0.1 mm is left
    const same = run('v-groove', [big({ toolId: SMALL_BALL, stepover: 0.3 }), rest()]).tp
    expect(same.moves).toEqual([])
    expect(same.warnings.join(' ')).toMatch(/left nothing thicker than 0.1 mm that this tool can reach/)
  }, 120_000)

  it('pencil and waterline take rest machining too; it follows only the picked operations', () => {
    const pencil = run('v-groove', [big(), rest({ strategy: 'pencil' })]).tp
    expect(clPoints(pencil).length).toBeGreaterThan(1)
    for (const [x] of clPoints(pencil)) expect(Math.abs(x - 50)).toBeLessThan(0.02)
    const water = run('v-groove', [big(), rest({ strategy: 'waterline', stepdown: 0.5, fillShallow: false, slope: { min: 0, max: 90 } })]).tp
    const wz = clPoints(water).length ? clPoints(water) : water.moves.flatMap((m) => (m.t === 'feed' ? [[m.x, m.y, m.z] as [number, number, number]] : []))
    expect(wz.length).toBeGreaterThan(1)
    for (const [x] of wz) expect(Math.abs(x - 50)).toBeLessThan(4)
    // picking an operation that is not earlier (or not there) means nothing to follow
    const picked = run('v-groove', [big(), rest({ rest: { from: ['nope'], minThickness: 0.1 } })]).tp
    expect(picked.moves).toEqual([])
  }, 120_000)

  it('changing the earlier operation marks the rest pass stale; templates follow every earlier operation', () => {
    const { part, op } = run('v-groove', [big(), rest({ rest: { from: ['big'], minThickness: 0.1 } })])
    const tool = machine.tools.find((t) => t.id === SMALL_BALL)!
    const built = { ...op, builtHash: opInputHash(op, part, tool, machine) }
    expect(opState(built, part, tool, machine)).toBe('current')
    const changed = { ...part, ops: [{ ...(part.ops[0] as Finish3dOp), stepover: 2 }, built] }
    expect(opState(built, changed, tool, machine)).toBe('stale')
    expect(opState({ ...built, rest: { from: ['big'], minThickness: 0.2 } }, part, tool, machine)).toBe('stale')
    expect((toTemplate(op) as Finish3dOp).rest).toEqual({ from: [], minThickness: 0.1 })
    // the background calculation gets the models of the operations it follows too
    expect(modelsFor(built, part)).toEqual(['m'])
    const other = { ...part, ops: [{ ...(part.ops[0] as Finish3dOp), surface: { ...(part.ops[0] as Finish3dOp).surface, modelId: 'm2' } }, built] }
    expect(modelsFor(built, other).sort()).toEqual(['m', 'm2'])
  }, 60_000)

  it('the stock the earlier operations leave: level moves carved exactly, sloped ones never too low', () => {
    const ball = { r: 3, shape: 'ball' as const, angle: 0 }
    // a level move: every cell at the cutter's height for its distance from the move
    const hf = createHeightfield(40, 30, 20, 0.25)
    const a = { x: 5.3, y: 7.1, z: -4 }
    const b = { x: 33.2, y: 21.7, z: -4 }
    carve(hf, a, b, ball, 0.025)
    const L = Math.hypot(b.x - a.x, b.y - a.y)
    let worst = 0
    for (let j = 0; j < hf.ny; j++)
      for (let i = 0; i < hf.nx; i++) {
        const x = (i + 0.5) * 0.25
        const y = (j + 0.5) * 0.25
        const t = Math.max(0, Math.min(L, ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / L))
        const want = Math.min(0, cutterZ(ball, -4, Math.hypot(x - a.x - ((b.x - a.x) * t) / L, y - a.y - ((b.y - a.y) * t) / L)))
        worst = Math.max(worst, Math.abs(hf.top[j * hf.nx + i] - want))
      }
    expect(worst).toBeLessThan(1e-6)
    // a sloped move: never below the swept ball (stamped every 0.005 mm), at most the cusp above it
    // within 3 cos 70° of the move's line
    const coarse = createHeightfield(40, 30, 20, 0.25)
    const fine = createHeightfield(40, 30, 20, 0.25)
    const c = { x: 6, y: 15, z: -1 }
    const d = { x: 34, y: 15, z: -9 }
    carve(coarse, c, d, ball, 0.025)
    const n = Math.ceil(Math.hypot(28, 8) / 0.005)
    for (let q = 0; q <= n; q++) stamp(fine, { x: c.x + (28 * q) / n, y: 15, z: c.z - (8 * q) / n }, ball)
    let low = 0
    let high = 0
    for (let j = 0; j < fine.ny; j++)
      for (let i = 0; i < fine.nx; i++) {
        const k = j * fine.nx + i
        low = Math.max(low, fine.top[k] - coarse.top[k])
        if (Math.abs((j + 0.5) * 0.25 - 15) <= 3 * Math.cos((70 * Math.PI) / 180)) high = Math.max(high, coarse.top[k] - fine.top[k])
      }
    expect(low).toBeLessThan(1e-6)
    expect(high).toBeLessThanOrEqual(0.025 + 1e-3)
    // and the model's top drawn into cells matches exact drops of a needle
    const mesh = meshOf('hemisphere')
    const { top, nz } = topRaster(mesh, 160, 160, 0.5)
    const dist = meshDistance(mesh)
    for (let k = 0; k < top.length; k += 97) {
      const x = ((k % 160) + 0.5) * 0.5
      const y = (Math.floor(k / 160) + 0.5) * 0.5
      expect(dist(x, y, top[k]), `${x}, ${y}`).toBeLessThan(1e-6)
      // and the slope there: flat on the base, steeper towards the foot of the dome
      const r = Math.hypot(x - 40, y - 40)
      if (r > 21) expect(nz[k]).toBeCloseTo(1, 9)
      else if (r < 18) expect(Math.abs(nz[k] - Math.sqrt(Math.max(0, 400 - r * r)) / 20)).toBeLessThan(0.05)
    }
  })

  it('projection finishing ignores rest machining (it follows drawn shapes)', () => {
    const { op, part } = run('v-groove', [big()])
    expect(restSources({ ...op, id: 'p', strategy: 'projection', rest: { from: [], minThickness: 0.1 } }, part)).toEqual([])
  })
})

describe('M2.3c goldens: pencil and 3D rest', () => {
  const DIR = path.join(import.meta.dirname, 'golden', 'cam3d')
  const UPDATE = process.env.UPDATE_GOLDEN === '1'
  for (const [label, name, ops] of [
    ['pencil-raised-panel', 'raised-panel', () => [finish('pencil')]],
    ['pencil-v-diagonal', 'v-diagonal', () => [finish('pencil', { toolId: SMALL_BALL })]],
    ['rest-v-groove', 'v-groove', () => [finish('parallel', { id: 'big', stepover: 1 }), finish('parallel', { id: 'rest', toolId: SMALL_BALL, stepover: 0.3, rest: { from: [], minThickness: 0.1 } })]],
  ] as [string, string, () => Finish3dOp[]][]) {
    it(`golden: ${label}`, () => {
      const dig = JSON.stringify(digest3d(run(name, ops()).tp), null, 1) + '\n'
      const f = path.join(DIR, label, 'toolpath.json')
      if (UPDATE) {
        fs.mkdirSync(path.dirname(f), { recursive: true })
        fs.writeFileSync(f, dig)
      }
      expect(fs.existsSync(f), `${f} missing; run UPDATE_GOLDEN=1 once to create it`).toBe(true)
      expect(dig).toBe(fs.readFileSync(f, 'utf8'))
    }, 60_000)
  }
})
