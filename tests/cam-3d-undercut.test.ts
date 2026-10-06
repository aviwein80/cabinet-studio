/**
 * M3.1d undercut finishing with lollipop tools (3D-08) and the dexel stock: the M2.2 tolerances
 * (no gouge over 0.005 mm, checked independently, here for the neck too; on the surface within
 * the tolerance), the reach the tool's ball, neck and the collision margin allow, the way in and
 * out sideways, simulation that keeps the lip, collision checks, refusals, goldens and the export
 * block.
 */
import { describe, expect, it } from 'vitest'
import { meshDistance } from '@/cam/3d/check'
import { BallLine } from '@/cam/3d/undercut'
import { checkCollisions, collisionSetup } from '@/cam/collision/collision'
import { newPart } from '@/cam/doc'
import { DEFAULT_PLACEMENT } from '@/cam/mesh/place'
import { meshBounds, meshVolume, type Mesh } from '@/cam/mesh/types'
import { defaultOp, resolveTool } from '@/cam/ops'
import { buildTimeline, cutterOf, type V3 } from '@/cam/sim'
import { DexelStock } from '@/cam/stock/dexel'
import { HeightfieldStock } from '@/cam/stock/heightfield'
import { generateOp, isFlatLayer, simpleMoves, type Toolpath } from '@/cam/toolpath'
import type { CamPart, Finish3dOp } from '@/cam/types'
import { defaultAppData, PLACEHOLDER_MACHINE } from '@/core/defaults'
import { runJob } from '@/core/pipeline'
import type { Job, MachineProfile, Tool } from '@/core/types'
import { expectGolden3d } from './finish3d-setup'
import { LIP, prism, UNDERSIDE } from './undercut-fixtures'

/** A test lollipop (ball 20 mm on a 6 mm neck) beside the placeholder table's T108 (12 mm on 4 mm). */
const LOLLY20: Tool = { id: 'lolly20', number: 901, type: 'router', name: 'Test lollipop 20 mm on a 6 mm neck', diameter: 20, maxDepth: 45, shape: 'lollipop', shankDiameter: 6, fluteLength: 20, gaugeLength: 80, holderId: 'h-placeholder' }
const machineWith = (margin = 2): MachineProfile => ({ ...PLACEHOLDER_MACHINE, collisionMargin: margin, tools: [...PLACEHOLDER_MACHINE.tools, LOLLY20] })

const MESH = prism(LIP, 60)

function lipPart(): CamPart {
  const b = meshBounds(MESH)
  return { ...newPart({ name: 'Lip', length: 80, width: 60, thickness: 50 }), models: [{ id: 'm', name: 'Lip', kind: 'mesh', blob: 'lip', source: 'lip.stl', units: 'mm', place: { ...DEFAULT_PLACEMENT, at: [b.min[0], b.min[1], b.max[2]] }, layer: 'models', visible: true, triangles: MESH.indices.length / 3, size: [80, 60, 50] }] }
}

function undercut(toolId: string, patch: Partial<Finish3dOp> = {}, machine = machineWith()) {
  const part = lipPart()
  const base = defaultOp('finish3d', [], { strategy: 'undercut' } as Partial<Finish3dOp>) as Finish3dOp
  const op: Finish3dOp = { ...base, toolId, stepover: 2, angle: 0, ...patch, surface: { ...base.surface, modelId: 'm', ...(patch.surface ?? {}) } }
  part.ops = [op]
  const tp = generateOp(op, { part, machine, meshes: new Map([['lip', MESH]]) })
  return { part, op, tp, machine }
}

/** Every tool position along every move (rapids too), at most `step` apart: tip points. */
function* allPositions(tp: Toolpath, step = 0.1): Generator<[number, number, number]> {
  let at: [number, number, number] | null = null
  for (const m of simpleMoves(tp.moves)) {
    if (m.t === 'drill' || m.t === 'arc') {
      at = null
      continue
    }
    const p: [number, number, number] = [m.x, m.y, m.z]
    if (at) {
      const n = Math.max(1, Math.ceil(Math.hypot(p[0] - at[0], p[1] - at[1], p[2] - at[2]) / step))
      for (let i = 1; i <= n; i++) yield [at[0] + ((p[0] - at[0]) * i) / n, at[1] + ((p[1] - at[1]) * i) / n, at[2] + ((p[2] - at[2]) * i) / n]
    } else yield p
    at = p
  }
}

/** Independent check: the ball and the neck (up past face 1) against the mesh, by exact distance. */
function clearance(mesh: Mesh, tp: Toolpath, R: number, neck: number) {
  const dist = meshDistance(mesh)
  let ball = Infinity
  let neckGap = Infinity
  for (const [x, y, z] of allPositions(tp)) {
    const c = z + R
    ball = Math.min(ball, dist(x, y, c) - R)
    // the neck's axis from the ball's centre to above the part, every 0.25 mm
    if (c < 0) for (let h = c; h <= 2; h += 0.25) neckGap = Math.min(neckGap, dist(x, y, h) - neck)
  }
  return { ball, neckGap }
}

describe('M3.1d undercut finishing: clear of the model, on the surface, as far under as the tool allows', () => {
  for (const [label, toolId, R, neck] of [
    ['T108 placeholder lollipop 12 mm on a 4 mm neck', 't108', 6, 2],
    ['test lollipop 20 mm on a 6 mm neck', 'lolly20', 10, 3],
  ] as const) {
    it(`${label}: ball and neck clear (exact, every move), touching the surface, reach as the geometry allows`, () => {
      const { tp, machine } = undercut(toolId)
      expect(tp.warnings).toEqual([])
      expect(tp.tool?.shape).toBe('lollipop')
      const M = machine.collisionMargin!
      const c = clearance(MESH, tp, R, neck + M)
      // never into the model: ball (gouge) and neck with the collision margin
      expect(c.ball).toBeGreaterThanOrEqual(-0.005)
      expect(c.neckGap).toBeGreaterThanOrEqual(-0.005)
      // the cutting points touch the surface (within the tolerance), except where the tool comes out
      const dist = meshDistance(MESH)
      const contacts: [number, number, number][] = []
      for (const m of tp.moves)
        if (m.t === 'poly')
          for (let i = 0; i + 3 < m.pts.length; i += 3) {
            const [x, y, z] = [m.pts[i], m.pts[i + 1], m.pts[i + 2]]
            const d = dist(x, y, z + R) - R
            expect(d).toBeLessThan(0.011)
            contacts.push([x, y, z + R])
          }
      expect(contacts.length).toBeGreaterThan(100)
      // reach under the lip's underside (n: its outward normal): the neck, with the margin, keeps
      // clear of the lip's edge at x = 38, so contact gets no further in than 38 + neck + M - R sin(a)
      const [[ax, az], [bx, bz]] = UNDERSIDE
      const len = Math.hypot(bx - ax, bz - az)
      const n = [(bz - az) / len, -(bx - ax) / len] // pointing away from the material (down and out)
      const under = contacts.filter(([x, , zc]) => {
        // contact point on the underside: the centre less R along its normal
        const px = x - R * n[0]
        const pz = zc - R * n[1]
        const t = ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / (len * len)
        return t > 0 && t < 1 && Math.abs((px - ax) * n[0] + (pz - az) * n[1]) < 0.02
      })
      expect(under.length).toBeGreaterThan(20)
      const deepest = Math.min(...under.map(([x]) => x - R * n[0]))
      const predicted = 38 + neck + M - R * n[0]
      process.stdout.write(`  [undercut] ${toolId}: ball clearance ${c.ball.toFixed(4)} mm, neck clearance (with the ${M} mm margin) ${c.neckGap.toFixed(4)} mm; reaches the underside to x ${deepest.toFixed(3)} (geometry allows ${predicted.toFixed(3)}), ${under.length} points on it\n`)
      expect(deepest).toBeGreaterThanOrEqual(predicted - 0.01)
      expect(deepest).toBeLessThan(predicted + 0.25)
    }, 120_000)
  }

  it('the lollipop picked automatically is the one reaching furthest; a ball-nose, a lollipop too thick in the neck, or no overhang are refused', () => {
    const base = defaultOp('finish3d', [], { strategy: 'undercut' } as Partial<Finish3dOp>) as Finish3dOp
    expect(resolveTool({ ...base, toolId: null }, machineWith())?.id).toBe('lolly20')
    expect(resolveTool({ ...base, toolId: null }, PLACEHOLDER_MACHINE)?.id).toBe('t108')
    expect(undercut('t105').tp.warnings[0]).toMatch(/needs a lollipop/)
    // T108: 6 mm ball, 2 mm neck: with a 4 mm margin the neck reaches as far as the ball
    expect(undercut('t108', {}, machineWith(4)).tp.warnings[0]).toMatch(/cannot get under an overhang/)
    const plain = undercut('t108', { surface: { modelId: 'm' } as Finish3dOp['surface'] })
    expect(plain.tp.moves.length).toBeGreaterThan(0)
  })

  it('in and out sideways, inside the part: the tool only goes up or down where the way up is clear; passes along the lip (no way out inside the part) are left out with a warning', () => {
    const along = undercut('lolly20', { angle: 90 }).tp
    expect(along.moves).toEqual([])
    expect(along.warnings.join(' ')).toMatch(/no way in or out sideways \(inside the boundary/)
    const { tp } = undercut('t108')
    for (const [x, y] of allPositions(tp)) {
      expect(x).toBeGreaterThanOrEqual(-1e-6)
      expect(y).toBeGreaterThanOrEqual(-1e-6)
      expect(x).toBeLessThanOrEqual(80 + 1e-6)
      expect(y).toBeLessThanOrEqual(60 + 1e-6)
    }
    const line = new BallLine(MESH, 6)
    let ups = 0
    let prev: { x: number; y: number; z: number } | null = null
    for (const m of simpleMoves(tp.moves)) {
      if (m.t === 'drill' || m.t === 'arc') continue
      if (prev && Math.hypot(m.x - prev.x, m.y - prev.y) < 1e-9 && Math.abs(m.z - prev.z) > 1e-9) {
        ups++
        // nothing the ball could touch above the lower end of the vertical move
        const iv = line.intervals(m.x, m.y)
        const low = Math.min(m.z, prev.z) + 6
        for (const v of iv) expect(v.hi <= low + 0.005 || v.lo >= Math.max(m.z, prev.z) + 6).toBe(true)
      }
      prev = m
    }
    expect(ups).toBeGreaterThan(10)
  })
})

describe('M3.1d dexel stock and simulation', () => {
  it('a vertical tool carves the dexel stock exactly as the heightfield', () => {
    const d = new DexelStock(60, 40, 20, 0.25)
    const h = new HeightfieldStock(60, 40, 20, 0.25)
    const ball = { r: 3, shape: 'ball' as const, angle: 0 }
    const flat = { r: 4, shape: 'flat' as const, angle: 0 }
    for (const s of [d, h]) {
      s.carve({ x: 5, y: 5, z: -3 }, { x: 50, y: 30, z: -8 }, ball)
      s.carve({ x: 10, y: 30, z: -5 }, { x: 50, y: 10, z: -5 }, flat)
    }
    let worst = 0
    for (let k = 0; k < d.hf.top.length; k++) worst = Math.max(worst, Math.abs(d.hf.top[k] - h.hf.top[k]))
    expect(worst).toBeLessThan(1e-4)
    expect(Math.abs(d.removedVolume() - h.removedVolume()) / h.removedVolume()).toBeLessThan(1e-4)
  })

  it('a lollipop moving level inside a block removes its capsule and the slot of its neck: volume within 1 % of the analytic at 0.25 mm cells', () => {
    const R = 6
    const rn = 2
    const L = 30
    const zc = -15
    const s = new DexelStock(80, 60, 40, 0.25)
    s.carve({ x: 20, y: 30, z: zc - R }, { x: 20 + L, y: 30, z: zc - R }, { r: R, shape: 'lollipop', angle: 0, neck: rn })
    const capsule = Math.PI * R * R * L + (4 / 3) * Math.PI * R ** 3
    const slot = (2 * rn * L + Math.PI * rn * rn) * -zc
    // the part of the neck's slot inside the capsule's upper half
    const strip = L * (rn * Math.sqrt(R * R - rn * rn) + R * R * Math.asin(rn / R))
    const caps = ((2 * Math.PI) / 3) * (R ** 3 - (R * R - rn * rn) ** 1.5)
    const analytic = capsule + slot - strip - caps
    const v = s.removedVolume()
    process.stdout.write(`  [dexel] lollipop slot: removed ${v.toFixed(1)} mm³, analytic ${analytic.toFixed(1)} mm³ (${((v / analytic - 1) * 100).toFixed(2)} %)\n`)
    expect(Math.abs(v / analytic - 1)).toBeLessThan(0.01)
    // under the neck's reach the material above the ball is still there (no heightfield could keep it)
    expect(s.occupied(20 + L / 2, 30 + rn + 2, zc + R + 1)).toBe(true)
    expect(s.occupied(20 + L / 2, 30 + rn + 2, zc)).toBe(false)
    // its mesh is closed: its volume is the material left
    expect(Math.abs(meshVolume(s.toMesh()) - (80 * 60 * 40 - v))).toBeLessThan(1)
  })

  it('simulated on a stock the shape of the part: the lip stays, nothing of the part is cut; a heightfield would lose the lip', () => {
    const { tp, part, machine } = undercut('t108')
    const dex = new DexelStock(80, 60, 50, 0.25)
    dex.setFromMesh(MESH)
    const before = dex.removedVolume()
    const tl = buildTimeline([tp])
    for (const sg of tl.segs) if (sg.kind !== 'rapid') dex.carve(sg.a, sg.b, sg.cutter)
    const cut = dex.removedVolume() - before
    // (the ball touches the faceted surface; cells near it may lose a sliver)
    expect(cut).toBeLessThan(5)
    // the lip over the recess is still there: two pieces of material in its columns
    const k = Math.floor(30 / 0.25) * dex.nx + Math.floor(36 / 0.25)
    expect(dex.column(k).length).toBe(2)
    expect(dex.heightAt(36, 30)).toBeCloseTo(0, 6)
    // the same moves on a heightfield (the tool can only be seen from above) cut the lip away
    const hf = new HeightfieldStock(80, 60, 50, 0.25)
    for (const sg of tl.segs) if (sg.kind !== 'rapid') hf.carve(sg.a, sg.b, sg.cutter)
    expect(hf.heightAt(37, 30)).toBeLessThan(-1)
    // collision check on the part-shaped dexel stock: nothing (no false alarms)
    const stock = new DexelStock(80, 60, 50, 0.25)
    stock.setFromMesh(MESH)
    expect(checkCollisions(tl, stock, collisionSetup(tl, [tp], machine, part.thickness))).toEqual([])
    expect(cutterOf(tp).neck).toBe(2)
  }, 120_000)

  it('a deliberate case is caught: passes made with no collision margin bring the neck within the 2 mm margin of the lip', () => {
    const { tp, part } = undercut('t108', {}, machineWith(0))
    expect(tp.moves.length).toBeGreaterThan(0)
    const tl = buildTimeline([tp])
    const stock = new DexelStock(80, 60, 50, 0.25)
    stock.setFromMesh(MESH)
    const found = checkCollisions(tl, stock, collisionSetup(tl, [tp], machineWith(2), part.thickness))
    expect(found.length).toBeGreaterThan(0)
    expect(found.every((c) => c.kind === 'shank')).toBe(true)
  }, 120_000)
})

describe('M3.1d output and goldens', () => {
  it('not a flat layer; the export checker refuses undercut finishing, even with both output switches on', () => {
    const { part: p, op } = undercut('t108')
    expect(isFlatLayer(op)).toBe(false)
    const data = defaultAppData()
    const part = { ...p, materialId: 'mat-mdf18' }
    const job: Job = { id: 'j', number: 'JU', name: 'Undercut', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [part] }
    data.jobs = [job]
    data.settings.features = { ...data.settings.features, camMprOutput: true, cam3dMprOutput: true }
    expect(runJob(job, data).issues.filter((i) => i.code === 'CAM_3D_NO_OUTPUT')).toHaveLength(1)
  }, 60_000)

  for (const [label, toolId, patch] of [
    ['undercut-lip-t108', 't108', {}],
    ['undercut-lip-lolly20-underside', 'lolly20', { undercut: 'underside', pattern: 'oneway', stepover: 3 }],
  ] as [string, string, Partial<Finish3dOp>][]) {
    it(`golden: ${label}`, () => expectGolden3d(label, undercut(toolId, patch).tp), 60_000)
  }
})

void ({} as V3)
