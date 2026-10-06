/**
 * M3.1g undercut roughing (owner decision 3): a lollipop clears the material under an overhang that
 * roughing from above leaves, before undercut finishing. Checked independently: the ball and the
 * neck (with the collision margin) against the model by exact distance along every move; the reach
 * the tool allows; the tool only goes up or down where nothing is above it; simulated in the dexel
 * stock (the lip stays, the material under it is cleared to the stock to leave plus at most one
 * step-down); collision checks with no false alarms and a real case caught; refusals; the export
 * block; goldens.
 */
import { describe, expect, it } from 'vitest'
import { meshDistance } from '@/cam/3d/check'
import { checkCollisions, collisionSetup } from '@/cam/collision/collision'
import { CAM_FILE_VERSION, newPart, opInputHash, opState, parsePart, serializePart } from '@/cam/doc'
import { DEFAULT_PLACEMENT } from '@/cam/mesh/place'
import { meshBounds, type Mesh } from '@/cam/mesh/types'
import { defaultOp, resolveTool } from '@/cam/ops'
import { buildTimeline } from '@/cam/sim'
import { DexelStock } from '@/cam/stock/dexel'
import { needsDexel } from '@/cam/stock/choose'
import { generateOp, isFlatLayer, simpleMoves, type Toolpath, UNDERCUT_ROUGH_NO_OUTPUT } from '@/cam/toolpath'
import type { CamPart, Finish3dOp, Rough3dOp } from '@/cam/types'
import { newOpDefaults, opUnconfirmed } from '@/core/confirm'
import { defaultAppData, PLACEHOLDER_MACHINE } from '@/core/defaults'
import { runJob } from '@/core/pipeline'
import type { Job, MachineProfile, Tool } from '@/core/types'
import { expectGolden3d } from './finish3d-setup'
import { LIP, prism } from './undercut-fixtures'

const LOLLY20: Tool = { id: 'lolly20', number: 901, type: 'router', name: 'Test lollipop 20 mm on a 6 mm neck', diameter: 20, maxDepth: 45, shape: 'lollipop', shankDiameter: 6, fluteLength: 20, gaugeLength: 80, holderId: 'h-placeholder' }
const machineWith = (margin = 2): MachineProfile => ({ ...PLACEHOLDER_MACHINE, collisionMargin: margin, tools: [...PLACEHOLDER_MACHINE.tools, LOLLY20] })

const MESH = prism(LIP, 60)
/** What roughing from above leaves of an 80 x 60 x 50 block round the lip part: the part and everything under the lip. */
const SHADOW = prism(
  [
    [0, -50],
    [80, -50],
    [80, -40],
    [38, -40],
    [38, 0],
    [0, 0],
  ],
  60,
)

function lipPart(): CamPart {
  const b = meshBounds(MESH)
  return { ...newPart({ name: 'Lip', length: 80, width: 60, thickness: 50 }), models: [{ id: 'm', name: 'Lip', kind: 'mesh', blob: 'lip', source: 'lip.stl', units: 'mm', place: { ...DEFAULT_PLACEMENT, at: [b.min[0], b.min[1], b.max[2]] }, layer: 'models', visible: true, triangles: MESH.indices.length / 3, size: [80, 60, 50] }] }
}

function rough(toolId: string, patch: Partial<Rough3dOp> = {}, machine = machineWith(), withZLevel = true) {
  const part = lipPart()
  const base = defaultOp('rough3d', [], { pattern: 'undercut' } as Partial<Rough3dOp>) as Rough3dOp
  const op: Rough3dOp = { ...base, toolId, stepdown: 2, stepover: 0.1, ...patch, pattern: 'undercut', surface: { ...base.surface, modelId: 'm', ...(patch.surface ?? {}) } }
  const z = defaultOp('rough3d') as Rough3dOp
  const zlevel: Rough3dOp = { ...z, toolId: 't107', surface: { ...z.surface, modelId: 'm' } }
  part.ops = withZLevel ? [zlevel, op] : [op]
  const t0 = performance.now()
  const tp = generateOp(op, { part, machine, meshes: new Map([['lip', MESH]]) })
  return { part, op, tp, machine, ms: performance.now() - t0 }
}

/** Every tool position along every move (rapids too), at most `step` apart: tip points, and whether it cuts. */
function* allPositions(tp: Toolpath, step = 0.1): Generator<[number, number, number, boolean]> {
  let at: [number, number, number] | null = null
  for (const m of simpleMoves(tp.moves)) {
    if (m.t === 'drill' || m.t === 'arc') {
      at = null
      continue
    }
    const p: [number, number, number] = [m.x, m.y, m.z]
    if (at) {
      const n = Math.max(1, Math.ceil(Math.hypot(p[0] - at[0], p[1] - at[1], p[2] - at[2]) / step))
      for (let i = 1; i <= n; i++) yield [at[0] + ((p[0] - at[0]) * i) / n, at[1] + ((p[1] - at[1]) * i) / n, at[2] + ((p[2] - at[2]) * i) / n, m.t !== 'rapid']
    } else yield [...p, false]
    at = p
  }
}

/** Independent check: the ball and the neck (up past face 1) against the mesh, by exact distance. */
function clearance(mesh: Mesh, tp: Toolpath, R: number, neck: number) {
  const dist = meshDistance(mesh)
  let ball = Infinity
  let neckGap = Infinity
  let minX = Infinity
  let outside = 0
  for (const [x, y, z, cut] of allPositions(tp)) {
    const c = z + R
    ball = Math.min(ball, dist(x, y, c) - R)
    if (c < 0) for (let h = c; h <= 2; h += 0.25) neckGap = Math.min(neckGap, dist(x, y, h) - neck)
    if (cut && c < -1) minX = Math.min(minX, x)
    if (x < -1e-6 || y < -1e-6 || x > 80 + 1e-6 || y > 60 + 1e-6) outside++
  }
  return { ball, neckGap, minX, outside }
}

describe('M3.1g undercut roughing: clear of the model, as far under as the tool allows, in and out sideways', () => {
  for (const [label, toolId, R, neck, s] of [
    ['T108 placeholder lollipop 12 mm on a 4 mm neck, 0.3 mm stock', 't108', 6, 2, 0.3],
    ['T108, no stock', 't108', 6, 2, 0],
    ['test lollipop 20 mm on a 6 mm neck, 0.3 mm stock', 'lolly20', 10, 3, 0.3],
  ] as [string, string, number, number, number][]) {
    it(`${label}: ball and neck never closer than the stock and the margin; reaches exactly to the neck's limit`, () => {
      const { tp, ms } = rough(toolId, { surface: { stockToLeave: s } as Rough3dOp['surface'] })
      expect(tp.tool?.shape).toBe('lollipop')
      expect(tp.noOutput).toBe(UNDERCUT_ROUGH_NO_OUTPUT)
      expect(tp.moves.length).toBeGreaterThan(10)
      const c = clearance(MESH, tp, R, neck)
      // ball: never closer to the model than the stock to leave (0.005 mm allowed)
      expect(c.ball).toBeGreaterThanOrEqual(s - 0.005)
      expect(c.ball).toBeLessThan(s + 0.01)
      // neck: never closer than the 2 mm margin plus the stock
      expect(c.neckGap).toBeGreaterThanOrEqual(2 + s - 0.005)
      // the neck's limit: its centre line no nearer the lip's edge (x 38) than neck + margin + stock
      const limit = 38 + neck + 2 + s
      expect(c.minX).toBeGreaterThanOrEqual(limit - 0.005)
      expect(c.minX).toBeLessThan(limit + 0.01)
      // never outside the part's own 80 x 60 outline (neighbours on a sheet)
      expect(c.outside).toBe(0)
      process.stdout.write(`  [undercut rough] ${label}: ${tp.moves.length} moves in ${ms.toFixed(0)} ms; ball ${c.ball.toFixed(4)} mm from the model (stock ${s}), neck ${c.neckGap.toFixed(4)} mm (margin 2 + stock), deepest reach x ${c.minX.toFixed(3)} (limit ${limit.toFixed(3)}: ${(38 - (c.minX - R - s)).toFixed(3)} mm under the lip's edge)\n`)
    }, 120_000)
  }

  it('goes up and down only where nothing is above it; every move under the lip is level', () => {
    const { tp } = rough('t108')
    const dist = meshDistance(MESH)
    const R = 6.3
    let vertical = 0
    let at: [number, number, number] | null = null
    for (const m of simpleMoves(tp.moves)) {
      if (m.t === 'drill' || m.t === 'arc') continue
      const p: [number, number, number] = [m.x, m.y, m.z]
      if (at && Math.abs(p[2] - at[2]) > 1e-9) {
        // a move that changes height is straight up or down, with the ball clear all the way to the top
        expect(Math.hypot(p[0] - at[0], p[1] - at[1])).toBeLessThan(1e-9)
        vertical++
        for (let z = Math.min(p[2], at[2]); z <= 5; z += 0.25) expect(dist(p[0], p[1], z + 6)).toBeGreaterThanOrEqual(R - 0.005)
      }
      at = p
    }
    expect(vertical).toBeGreaterThan(4)
  }, 60_000)

  it('levels between the underside and the floor, the step-down apart, top down', () => {
    const { tp } = rough('t108', { stepdown: 2.5 })
    const zs: number[] = []
    for (const m of tp.moves) if (m.t === 'poly') for (let i = 2; i < m.pts.length; i += 3) zs.push(Math.round(m.pts[i] * 1e6) / 1e6)
    const levels = [...new Set(zs)].sort((a, b) => b - a)
    expect(levels.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < levels.length - 1; i++) expect(levels[i - 1] - levels[i]).toBeCloseTo(2.5, 6)
    // the lowest: the ball (with 0.3 mm stock) resting on the floor at -40
    expect(levels[levels.length - 1]).toBeCloseTo(-40 + 0.3, 6)
    // cut from the top down
    const order = zs.filter((z, i) => i === 0 || z !== zs[i - 1])
    expect([...order].sort((a, b) => b - a)).toEqual(order)
  }, 60_000)
})

describe('M3.1g undercut roughing in the dexel stock', () => {
  /** Probe: the material a ball of radius R at centre c would find inside it, as the deepest reach (0 = none). */
  function inside(stock: DexelStock, c: [number, number, number], R: number) {
    let deepest = 0
    for (let a = 0; a < 48; a++) {
      const th = (a / 48) * 2 * Math.PI
      for (let e = -6; e <= 6; e++) {
        const ph = (e / 6) * (Math.PI / 2) * 0.95
        const d = [Math.cos(ph) * Math.cos(th), Math.cos(ph) * Math.sin(th), Math.sin(ph)]
        for (let t = 0; t < R; t += 0.02)
          if (stock.occupied(c[0] + d[0] * t, c[1] + d[1] * t, c[2] + d[2] * t)) {
            deepest = Math.max(deepest, R - t)
            break
          }
      }
    }
    return deepest
  }

  it('the material under the lip is cleared to the stock plus at most one step-down; the lip stays; no false collision alarms', () => {
    const s = 0.3
    const sd = 2
    const { tp, part, machine } = rough('t108', { stepdown: sd, surface: { stockToLeave: s } as Rough3dOp['surface'] })
    expect(needsDexel([tp])).toBe(true)
    const stock = new DexelStock(80, 60, 50, 0.1)
    stock.setFromMesh(SHADOW)
    const tl = buildTimeline([tp])
    // no false alarms: the neck keeps its margin from the material and nothing rapids through it
    // (the check simulates as it goes, on its own stock)
    const sim = new DexelStock(80, 60, 50, 0.1)
    sim.setFromMesh(SHADOW)
    expect(checkCollisions(tl, sim, collisionSetup(tl, [tp], machine, part.thickness))).toEqual([])
    const fresh = new DexelStock(80, 60, 50, 0.1)
    fresh.setFromMesh(SHADOW)
    const before = stock.removedVolume()
    for (const sg of tl.segs) if (sg.kind !== 'rapid') stock.carve(sg.a, sg.b, sg.cutter)
    const removed = stock.removedVolume() - before
    expect(removed).toBeGreaterThan(100)
    // the lip is still there over the recess: material from face 1 down, and the floor beneath
    const k = Math.floor(30 / 0.1) * stock.nx + Math.floor(37.05 / 0.1)
    expect(stock.column(k).length).toBe(2)
    expect(stock.heightAt(37.05, 30)).toBeCloseTo(0, 6)
    // what is left where undercut finishing touches the model (the surface this tool can reach):
    // the finishing ball (no stock) finds at most the roughing's stock plus one step-down inside it
    const base = defaultOp('finish3d', [], { strategy: 'undercut' } as Partial<Finish3dOp>) as Finish3dOp
    const fin: Finish3dOp = { ...base, toolId: 't108', stepover: 2, angle: 0, surface: { ...base.surface, modelId: 'm' } }
    const p2 = { ...part, ops: [fin] }
    const ftp = generateOp(fin, { part: p2, machine, meshes: new Map([['lip', MESH]]) })
    const centres: [number, number, number][] = []
    for (const m of ftp.moves) if (m.t === 'poly') for (let i = 0; i < m.pts.length; i += 3) if (m.pts[i + 1] > 10 && m.pts[i + 1] < 50) centres.push([m.pts[i], m.pts[i + 1], m.pts[i + 2] + 6])
    expect(centres.length).toBeGreaterThan(50)
    let worst = 0
    let worstBefore = 0
    const probe = centres.filter((_, i) => i % Math.max(1, Math.floor(centres.length / 120)) === 0)
    for (const c of probe) {
      worst = Math.max(worst, inside(stock, c, 6))
      worstBefore = Math.max(worstBefore, inside(fresh, c, 6))
    }
    process.stdout.write(`  [undercut rough] dexel stock (0.1 mm cells), T108, 0.3 mm stock, 2 mm step-down: ${removed.toFixed(0)} mm³ removed under the lip; where finishing touches, at most ${worst.toFixed(3)} mm left (${worstBefore.toFixed(3)} mm before roughing; ${probe.length} finishing positions probed)\n`)
    expect(worstBefore).toBeGreaterThan(1)
    // never more than the stock plus one step-down (the cell size, 0.1 mm, for the probe)
    expect(worst).toBeLessThanOrEqual(s + sd + 0.1)
    // in fact the ball's cusp between levels: R - sqrt(R² - (sd/2)²) = 0.084 mm here
    expect(worst).toBeLessThanOrEqual(s + 0.084 + 0.15)
  }, 240_000)

  it('a deliberate case is caught: passes made with no collision margin bring the neck within the 2 mm margin of the material', () => {
    const { tp, part } = rough('t108', {}, machineWith(0))
    expect(tp.moves.length).toBeGreaterThan(0)
    const tl = buildTimeline([tp])
    const stock = new DexelStock(80, 60, 50, 0.25)
    stock.setFromMesh(SHADOW)
    const found = checkCollisions(tl, stock, collisionSetup(tl, [tp], machineWith(2), part.thickness))
    expect(found.length).toBeGreaterThan(0)
    expect(found.every((c) => c.kind === 'shank')).toBe(true)
  }, 120_000)
})

describe('M3.1g undercut roughing: choices, refusals, output', () => {
  it('picks the lollipop reaching furthest; refuses a ball-nose, a neck too thick and a model with no overhang; asks for roughing from above first', () => {
    const base = defaultOp('rough3d', [], { pattern: 'undercut' } as Partial<Rough3dOp>) as Rough3dOp
    expect(base.name).toBe('3D roughing (undercuts)')
    expect(resolveTool({ ...base, toolId: null }, PLACEHOLDER_MACHINE)?.id).toBe('t108')
    expect(resolveTool({ ...base, toolId: null }, machineWith())?.id).toBe('lolly20')
    expect(rough('t105').tp.warnings.join(' ')).toMatch(/Undercut roughing needs a lollipop/)
    expect(rough('t108', {}, machineWith(4)).tp.warnings.join(' ')).toMatch(/cannot get under an overhang/)
    expect(rough('t108', {}, machineWith(), false).tp.warnings[0]).toMatch(/No Z-level roughing comes before/)
    expect(rough('t108').tp.warnings.join(' ')).not.toMatch(/No Z-level roughing/)
    // a block with no overhang
    const box = prism(
      [
        [0, -50],
        [80, -50],
        [80, -20],
        [0, -20],
      ],
      60,
    )
    const part = lipPart()
    const op: Rough3dOp = { ...base, toolId: 't108', surface: { ...base.surface, modelId: 'm' } }
    part.ops = [op]
    const tp = generateOp(op, { part, machine: machineWith(), meshes: new Map([['lip', box]]) })
    expect(tp.moves).toHaveLength(0)
    expect(tp.warnings.join(' ')).toMatch(/Nothing to rough: no overhang/)
  }, 120_000)

  it('its own placeholder step-down and step-over, with Configure badges; editing them marks the operation stale; saved and read back (format 6 and later)', () => {
    const m = machineWith()
    const d = newOpDefaults('rough3d', m, { pattern: 'undercut' } as Partial<Rough3dOp>)
    expect(d).toEqual({ stepdown: 1, stepover: 0.1 })
    const part = lipPart()
    const op = { ...(defaultOp('rough3d', [], { ...d, pattern: 'undercut' } as Partial<Rough3dOp>) as Rough3dOp), toolId: 't108' }
    part.ops = [op]
    const keys = opUnconfirmed(op, part, m, m.tools.find((t) => t.id === 't108')!).map((u) => u.key)
    expect(keys).toEqual(expect.arrayContaining([`op:${op.id}:undercutStepdown`, `op:${op.id}:undercutStepover`, 'tool:t108:lengths']))
    expect(keys).not.toContain(`op:${op.id}:roughStepdown`)
    const tool = resolveTool(op, m)
    const built = { ...op, builtHash: opInputHash(op, part, tool) }
    expect(opState(built, part, tool)).toBe('current')
    expect(opState({ ...built, stepdown: 1.5 }, part, tool)).toBe('stale')
    const back = parsePart(serializePart(part))
    expect(back.version).toBe(CAM_FILE_VERSION)
    expect(back.ops).toEqual(part.ops)
  })

  it('never a flat layer; the export checker refuses it, even with both output switches on', () => {
    const { part: p, op } = rough('t108')
    expect(isFlatLayer(op)).toBe(false)
    const data = defaultAppData()
    const part = { ...p, materialId: 'mat-mdf18' }
    const job: Job = { id: 'j', number: 'JUR', name: 'Undercut rough', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [part] }
    data.jobs = [job]
    data.settings.features = { ...data.settings.features, camMprOutput: true, cam3dMprOutput: true }
    const issues = runJob(job, data).issues
    // (the Z-level roughing before it is a flat layer; only the undercut roughing needs true 3D)
    expect(issues.filter((i) => i.code === 'CAM_3D_NO_OUTPUT')).toHaveLength(1)
    expect(issues.find((i) => i.code === 'CAM_3D_NO_OUTPUT')!.message).toMatch(/1 3D operation/)
  }, 60_000)

  for (const [label, toolId, patch] of [
    ['undercut-rough-lip-t108', 't108', {}],
    ['undercut-rough-lip-lolly20', 'lolly20', { stepdown: 3, stepover: 0.15 }],
  ] as [string, string, Partial<Rough3dOp>][]) {
    it(`golden: ${label}`, () => expectGolden3d(label, rough(toolId, patch).tp), 60_000)
  }
})
