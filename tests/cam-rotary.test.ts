/**
 * M3.3 rotary (4-axis): wrapped work planes (NEW-14), rotary machining (3D-10), the rotary stock
 * model, the independent gouge check, the collision check and the woodWOP refusal.
 *
 * Acceptance (spec M3.3): a turned leg and a fluted column simulate in a rotary stock model with
 * no gouges; the N-200 export refuses rotary work (output through script posts: cam-rotary-post).
 */
import { describe, expect, it } from 'vitest'
import { CAM_FILE_VERSION, makeEntity, newPart, opInputHash, parsePart, serializePart } from '@/cam/doc'
import { line } from '@/cam/geom'
import { checkRotaryGouge } from '@/cam/rotary/check'
import { RotaryDrop } from '@/cam/rotary/drop'
import { angleSpan, axisFrame, axisFromCylinder, blankRadius, cylToPlane, defaultSetup, fromCyl, inPlane, planeFromCylinder, planeFromRadius, planeProblems, planeRect, planeSize, planeToCyl, setupProblems, toCyl, wrapPoint } from '@/cam/rotary/frame'
import { rotaryCollisions, rotaryTimeline } from '@/cam/rotary/sim'
import { rayInterval, RotaryStock } from '@/cam/rotary/stock'
import { meshVolume } from '@/cam/mesh/types'
import { generateOp, generatePart, inBackground, type Toolpath } from '@/cam/toolpath'
import type { CamPart, RotaryOp, RotarySetup } from '@/cam/types'
import { confirmOp, opUnconfirmed } from '@/core/confirm'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import { runJob } from '@/core/pipeline'
import type { Job } from '@/core/types'
import { expectGolden3d } from './finish3d-setup'
import { readFixture } from './solid-fixtures'
import { solidCylinders } from '@/cam/rotary/face'
import { DEFAULT_PLACEMENT } from '@/cam/mesh/place'
import { data as appData } from './helpers'
import { COLUMN, columnPart, LEG, legPart, meshRadii, revolved, rotaryOp } from './rotary-fixtures'

const DEG = Math.PI / 180
const say = (s: string) => process.stdout.write(`  [rotary] ${s}\n`)
const near = (a: number[], b: number[], tol = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) <= tol)

function gen(part: CamPart, op: RotaryOp, meshes?: Map<string, import('@/cam/mesh/types').Mesh>): Toolpath {
  return generateOp(op, { part: { ...part, ops: [...part.ops.filter((o) => o.id !== op.id), op] }, machine: PLACEHOLDER_MACHINE, meshes })
}

describe('M3.3 rotary frame and wrapped planes (NEW-14)', () => {
  const setups: RotarySetup[] = (['X', 'Y', 'Z'] as const).map((axis) => ({ axis, centre: { x: 3, y: -4, z: -7 }, blank: { shape: 'round', size: 40, start: 0, end: 100 }, planes: [] }))

  it('turns about X, Y or Z right-handed from straight up (+X for Z), and round-trips', () => {
    // θ = 0 is +Z for X and Y, +X for Z; θ = 90° is e1 = axis × e0
    expect(axisFrame('X')).toEqual({ a: [1, 0, 0], e0: [0, 0, 1], e1: [0, -1, 0] })
    expect(axisFrame('Y')).toEqual({ a: [0, 1, 0], e0: [0, 0, 1], e1: [1, 0, 0] })
    expect(axisFrame('Z')).toEqual({ a: [0, 0, 1], e0: [1, 0, 0], e1: [0, 1, 0] })
    for (const s of setups) {
      const f = axisFrame(s.axis)
      const cross = [f.a[1] * f.e0[2] - f.a[2] * f.e0[1], f.a[2] * f.e0[0] - f.a[0] * f.e0[2], f.a[0] * f.e0[1] - f.a[1] * f.e0[0]]
      expect(near(cross, f.e1)).toBe(true)
      for (const [u, th, rho] of [[10, 0.3, 12], [55, -2.9, 0.5], [99, 3.1, 30]]) {
        const p = fromCyl(s, u, th, rho)
        const c = toCyl(s, p)
        expect(c.u).toBeCloseTo(u, 9)
        expect(c.theta).toBeCloseTo(th, 9)
        expect(c.rho).toBeCloseTo(rho, 9)
      }
    }
    // axis X: 90° looks along -Y, from a centre at y -4, z -7
    expect(near(fromCyl(setups[0], 10, Math.PI / 2, 5), [10, -9, -7])).toBe(true)
  })

  it('unrolls a plane: along the axis as it is, round it as arc at its radius; drawn shapes wrap keeping their length', () => {
    const s = { ...setups[0], planes: [] }
    const p = { ...planeFromRadius(s, 15, { id: 'p', name: 'P', at: { x: 200, y: 50 } }), start: 20, end: 80, a0: 30, a1: 210, from: 'extents' as const }
    expect(planeSize(p).along).toBe(60)
    expect(planeSize(p).round).toBeCloseTo(15 * Math.PI, 12)
    const rect = planeRect(p)
    expect(near([rect.x0, rect.y0, rect.x1, rect.y1], [200, 50, 260, 50 + 15 * Math.PI], 1e-12)).toBe(true)
    const c = planeToCyl(p, 230, 50 + 15 * (Math.PI / 4), -2)
    expect(c.u).toBe(50)
    expect(c.theta).toBeCloseTo(75 * DEG, 12)
    expect(c.rho).toBe(13)
    const back = cylToPlane(p, c.u, c.theta, c.rho)
    expect(near([back.x, back.y, back.z], [230, 50 + 15 * (Math.PI / 4), -2])).toBe(true)
    // a line drawn round the plane (60 mm) is 60 mm of arc on the cylinder; one drawn along it stays straight
    let len = 0
    let prev = wrapPoint(s, p, { x: 210, y: 60 })
    for (let k = 1; k <= 6000; k++) {
      const q = wrapPoint(s, p, { x: 210, y: 60 + (60 * k) / 6000 })
      len += Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2])
      prev = q
    }
    expect(len).toBeCloseTo(60, 5)
    const a = wrapPoint(s, p, { x: 200, y: 70 })
    const b = wrapPoint(s, p, { x: 260, y: 70 })
    expect(b[0] - a[0]).toBeCloseTo(60, 12)
    expect(Math.hypot(b[1] - a[1], b[2] - a[2])).toBeLessThan(1e-12)
    // depth goes in towards the axis
    expect(toCyl(s, wrapPoint(s, p, { x: 230, y: 80 }, 4)).rho).toBeCloseTo(11, 12)
    expect(inPlane(p, { x: 260, y: 50 })).toBe(true)
    expect(inPlane(p, { x: 260.1, y: 50 })).toBe(false)
  })

  it('fits a plane to a cylindrical face on the axis: radius, extents along and round it; refuses one off the axis', () => {
    const s: RotarySetup = { axis: 'X', centre: { x: 0, y: 20, z: -20 }, blank: { shape: 'square', size: 40, start: 0, end: 300 }, planes: [] }
    // a quarter of a Ø30 cylinder from x 40 to 90, from 30° to 120°
    const pts: [number, number, number][] = []
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 18; j++) pts.push(fromCyl(s, 40 + i * 5, (30 + j * 5) * DEG, 15))
    const fit = planeFromCylinder(s, { p: [123, 20, -20], v: [-1, 0, 0], r: 15, fit: 0.0001 }, pts, { id: 'f', name: 'Face', at: { x: 0, y: 60 }, modelId: 'm', faceId: 7 })
    if (!('plane' in fit)) throw new Error(fit.error)
    expect(fit.plane).toMatchObject({ radius: 15, start: 40, end: 90, from: 'face', face: { modelId: 'm', faceId: 7, fit: 0.0001 } })
    expect(fit.plane.a0).toBeCloseTo(30, 9)
    expect(fit.plane.a1).toBeCloseTo(120, 9)
    // the face's axis off the rotary axis, or tilted: refused with the reason
    const off = planeFromCylinder(s, { p: [0, 20.2, -20], v: [1, 0, 0], r: 15, fit: 0 }, pts, { id: 'f', name: 'Face', at: { x: 0, y: 0 }, modelId: 'm' })
    expect('error' in off && off.error).toMatch(/0\.200 mm from the rotary axis/)
    const tilt = planeFromCylinder(s, { p: [0, 20, -20], v: [Math.cos(0.01), Math.sin(0.01), 0], r: 15, fit: 0 }, pts, { id: 'f', name: 'Face', at: { x: 0, y: 0 }, modelId: 'm' })
    expect('error' in tilt && tilt.error).toMatch(/off the rotary axis/)
    // moving the axis onto a face: along X, Y or Z only
    const moved = axisFromCylinder(s, { p: [0, 5, -6], v: [0, 1, 0] })
    expect('setup' in moved && moved.setup).toMatchObject({ axis: 'Y', centre: { x: 0, y: 5, z: -6 } })
    expect('error' in axisFromCylinder(s, { p: [0, 0, 0], v: [0.7, 0.7, 0.14] })).toBe(true)
    // angle spans: across 0°, and all the way round
    const span = angleSpan([350 * DEG, 10 * DEG, 0])
    expect(span.a0).toBeCloseTo(350, 9)
    expect(span.a1).toBeCloseTo(370, 9)
    expect(angleSpan(Array.from({ length: 360 }, (_, k) => k * DEG))).toEqual({ a0: 0, a1: 360 })
  })

  it('checks set-ups and planes', () => {
    const s = defaultSetup({ length: 300, width: 40, thickness: 40 })
    expect(s).toMatchObject({ axis: 'X', centre: { x: 0, y: 20, z: -20 }, blank: { shape: 'square', size: 40, start: 0, end: 300 } })
    expect(blankRadius(s.blank)).toBeCloseTo(20 * Math.SQRT2, 12)
    const p = planeFromRadius(s, 20, { id: 'p', name: 'P', at: { x: 0, y: 60 } })
    expect(planeProblems(s, p)).toEqual([])
    expect(planeProblems(s, { ...p, end: 400 })).toEqual(['The plane runs past the ends of the blank.'])
    expect(planeProblems(s, { ...p, a1: 400 })).toContain('A plane goes at most once round the axis (360°).')
    expect(setupProblems({ ...s, blank: { ...s.blank, size: 0 }, planes: [{ ...p, radius: 0 }] })).toEqual(['The blank needs a size.', 'P: The radius must be more than 0.'])
  })
})

describe('M3.3 rotary stock model', () => {
  const round: RotarySetup = { axis: 'X', centre: { x: 0, y: 25, z: -25 }, blank: { shape: 'round', size: 50, start: 0, end: 60 }, planes: [] }

  it('holds the blank: a round one exactly, a square one to the cells', () => {
    const r = new RotaryStock(round, 0.5)
    expect(r.blankVolume()).toBeCloseTo(Math.PI * 25 * 25 * 60, 3)
    const sq = new RotaryStock({ ...round, blank: { shape: 'square', size: 40, start: 0, end: 60 } }, 0.25)
    expect(Math.abs(sq.blankVolume() / (40 * 40 * 60) - 1)).toBeLessThan(2e-4)
    // the unrolled frame: z = 0 at the blank's farthest reach, a square's faces lower
    expect(sq.Rs).toBeCloseTo(20 * Math.SQRT2, 12)
    expect(sq.heightAt(30, 0.01)).toBeCloseTo(sq.outer(Math.floor(30 / sq.cell), 0) - sq.Rs, 5)
    expect(sq.outer(Math.floor(30 / sq.cell), 0)).toBeCloseTo(20 / Math.cos(sq.phiOf(0)), 5)
  })

  it('a full ring cut by a flat tool removes the annulus exactly; a ball ring the revolved ball', () => {
    const cell = 0.5
    const s = new RotaryStock(round, cell)
    // flat Ø8 tip 18 mm from the axis at x 30: turning once round the axis (exact sweep)
    s.carve({ x: 30, y: 0, z: 18 - s.Rs }, { x: 30, y: 2 * Math.PI * s.Rs, z: 18 - s.Rs }, { r: 4, shape: 'flat', angle: 0 })
    let cols = 0
    for (let i = 0; i < s.nu; i++) if (Math.abs(s.uOf(i) - 30) <= 4) cols++
    // (the stock's cell: the requested size made to fit the circumference)
    expect(s.removedVolume() / (Math.PI * (25 * 25 - 18 * 18) * cols * s.cell)).toBeCloseTo(1, 6)
    const b = new RotaryStock(round, cell)
    b.carve({ x: 30, y: 0, z: 20 - b.Rs }, { x: 30, y: 2 * Math.PI * b.Rs, z: 20 - b.Rs }, { r: 3, shape: 'ball', angle: 0 })
    let want = 0
    for (let i = 0; i < b.nu; i++) {
      const dx = b.uOf(i) - 30
      if (Math.abs(dx) <= 3) want += Math.PI * (25 * 25 - (20 + 3 - Math.sqrt(9 - dx * dx)) ** 2) * b.cell
    }
    expect(b.removedVolume() / want).toBeCloseTo(1, 6)
    // the same ring as 400 short moves (carved at positions a quarter cell apart): within 0.1 %
    const c = new RotaryStock(round, cell)
    for (let k = 0; k < 400; k++) c.carve({ x: 30, y: (2 * Math.PI * c.Rs * k) / 400, z: 20.0000001 - c.Rs + (k % 2) * 1e-7 }, { x: 30, y: (2 * Math.PI * c.Rs * (k + 1)) / 400, z: 20.0000001 - c.Rs + ((k + 1) % 2) * 1e-7 }, { r: 3, shape: 'ball', angle: 0 })
    expect(Math.abs(c.removedVolume() / want - 1)).toBeLessThan(1e-3)
  })

  it('keeps the walls of a flat-bottomed groove (two pieces on a ray) and reports material in an envelope, not a wall on the tool\'s side', () => {
    const s = new RotaryStock(round, 0.25)
    // a flat Ø6 slot along the axis at θ = 0, tip 21 mm out: rays just beside it pass under its wall
    s.carve({ x: 10, y: 0, z: 21 - s.Rs }, { x: 50, y: 0, z: 21 - s.Rs }, { r: 3, shape: 'flat', angle: 0 })
    // a ray 7.5° off the slot's middle: it enters the slot's floor and leaves through its wall inside the blank
    const j = Math.floor((7.5 * DEG) / s.dphi)
    const ray = s.ray(Math.floor(30 / s.cell), j)
    const psi = s.phiOf(j)
    const enter = 21 / Math.cos(psi)
    const leave = 3 / Math.sin(psi)
    expect(ray.length).toBe(2)
    expect(ray[0][1]).toBeCloseTo(enter, 4)
    expect(ray[1][0]).toBeCloseTo(leave, 4)
    // standing in the slot: nothing inside the cutter; the shank's envelope (radius 3 + 2) meets the walls
    const at = { x: 30, y: 0, z: 21 - s.Rs }
    // (the stock holds distances as float32: a wall can sit a micron inside)
    expect(s.intrusion(at.x, at.y, 3, () => at.z).depth).toBeLessThanOrEqual(1e-5)
    expect(s.intrusion(at.x, at.y, 5, (d) => (d <= 5 ? at.z + 1 : Infinity)).depth).toBeGreaterThan(1)
    // one ray against the cutter, by hand: flat tip 21 mm out, the ray 7.5° off its axis
    const iv = rayInterval({ r: 3, shape: 'flat', angle: 0 }, 21, 0, Math.cos(7.5 * DEG), Math.sin(7.5 * DEG))!
    expect(iv[0]).toBeCloseTo(21 / Math.cos(7.5 * DEG), 12)
    expect(iv[1]).toBeCloseTo(3 / Math.sin(7.5 * DEG), 12)
    // 10° off, the ray passes beside the cutter (tan 10° > 3 / 21)
    expect(rayInterval({ r: 3, shape: 'flat', angle: 0 }, 21, 0, Math.cos(10 * DEG), Math.sin(10 * DEG))).toBeNull()
    // straight in towards the axis: the deepest point stands for the move
    const p1 = new RotaryStock(round, 0.5)
    const p2 = new RotaryStock(round, 0.5)
    p1.carve({ x: 30, y: 5, z: 0 }, { x: 30, y: 5, z: -6 }, { r: 3, shape: 'ball', angle: 0 })
    p2.carveAt({ x: 30, y: 5, z: -6 }, { r: 3, shape: 'ball', angle: 0 })
    expect(p1.removedVolume()).toBeCloseTo(p2.removedVolume(), 9)
  })

  it('saves and restores its state, and gives a closed mesh in the part', () => {
    const s = new RotaryStock({ ...round, blank: { shape: 'square', size: 30, start: 0, end: 20 } }, 1)
    s.carve({ x: 4, y: 0, z: -8 }, { x: 16, y: 3, z: -9 }, { r: 3, shape: 'ball', angle: 0 })
    const snap = s.snapshot()
    const v = s.removedVolume()
    s.reset()
    expect(s.removedVolume()).toBe(0)
    s.restore(snap)
    expect(s.removedVolume()).toBeCloseTo(v, 9)
    // closed and facing out: the volume it encloses is the material's (each patch is a flat chord
    // across its cell, a hair inside the true curve)
    expect(meshVolume(s.toMesh()) / s.materialVolume()).toBeCloseTo(1, 3)
    expect(meshVolume(s.toMesh({ frame: 'local' })) / s.materialVolume()).toBeCloseTo(1, 3)
  })
})

describe('M3.3 rotary drop-cutter', () => {
  const s: RotarySetup = { axis: 'X', centre: { x: 0, y: 30, z: -30 }, blank: { shape: 'round', size: 60, start: 0, end: 100 }, planes: [] }
  const mesh = revolved(s, () => 25, 0, 100, 5, 64)

  it('lowers a ball onto a 64-sided turned cylinder: on a corner at its radius, on a facet at the facet', () => {
    const d = new RotaryDrop(mesh, s, { kind: 'torus', R: 3, rc: 3 })
    for (let k = 0; k < 64; k += 7) {
      expect(d.drop(50, (2 * Math.PI * k) / 64)).toBeCloseTo(25, 4)
      expect(d.drop(50, (2 * Math.PI * (k + 0.5)) / 64)).toBeCloseTo(25 * Math.cos(Math.PI / 64), 4)
      expect(d.dropOnce(50.3, (2 * Math.PI * (k + 0.5)) / 64)).toBeCloseTo(d.drop(50.3, (2 * Math.PI * (k + 0.5)) / 64), 9)
    }
    // past the model's end: nothing to meet
    expect(Number.isNaN(d.drop(110, 0))).toBe(true)
  })
})

describe('M3.3 acceptance: a turned leg simulates in the rotary stock with no gouges', () => {
  it('rough along the axis in levels, finish in rings; gouge-checked, simulated against the model ray by ray, no collisions', () => {
    const { part, mesh, setup } = legPart()
    const meshes = new Map([['leg', mesh]])
    const rough = rotaryOp('along', { id: 'rough', toolId: 't102', stepover: 4, stepdown: 4, stockToLeave: 0.5, modelId: 'leg' })
    const finish = rotaryOp('around', { id: 'finish', toolId: 't105', stepover: 2, modelId: 'leg' })
    const p = { ...part, ops: [rough, finish] }
    const tpR = gen(p, rough, meshes)
    const tpF = gen(p, finish, meshes)
    expect(tpR.rotary?.plane.id).toBe('p1')
    expect(tpR.warnings).toEqual(["Roughing in 5 level(s) from the blank's surface (28.3 mm from the axis) in to 9.49 mm."])
    expect(tpF.warnings).toEqual([])
    // independent gouge checks (no drop-cutter code): roughing keeps its 0.5 mm, finishing touches the model
    const gR = checkRotaryGouge(mesh, setup, setup.planes[0], { shape: 'flat', r: 4 }, tpR.moves, { step: 0.5, stock: 0.5, resolution: 0.5, maxPoints: 3000 })
    const gF = checkRotaryGouge(mesh, setup, setup.planes[0], { shape: 'ball', r: 3 }, tpF.moves, { step: 0.25 })
    expect(gR.max).toBeLessThanOrEqual(0.005)
    expect(gF.exact).toBe(true)
    expect(gF.max).toBeLessThanOrEqual(0.005)
    // simulated on the rotary stock, with the collision check (shank, holder, rapids, the axis)
    const c = rotaryCollisions(setup, [tpR, tpF], PLACEHOLDER_MACHINE, { cell: 0.5 })
    expect(c.found).toEqual([])
    // the stock against the model, ray by ray (plain ray-mesh crossings)
    const rad = meshRadii(mesh, setup)
    const st = c.stock
    let gouge = -Infinity
    const left: number[] = []
    let rays = 0
    for (let i = 0; i < st.nu; i++) {
      const u = st.uOf(i)
      for (let j = 0; j < st.nt; j++) {
        const d = rad(u, st.phiOf(j))
        expect(Number.isFinite(d)).toBe(true)
        gouge = Math.max(gouge, d - st.outer(i, j))
        if (u > LEG.pommel + 5 && u < LEG.length - 5) left.push(st.outer(i, j) - d)
        rays++
      }
    }
    left.sort((a, b) => a - b)
    const p95 = left[Math.floor(left.length * 0.95)]
    say(`turned leg: roughing gouge ${gR.max.toFixed(4)} mm (sampled, 0.5 stock), finishing gouge ${gF.max.toFixed(4)} mm (exact); simulated stock vs model on ${rays} rays: deepest ${gouge.toFixed(4)} mm below, left on the turned part p95 ${p95.toFixed(3)} mm (2 mm step, 6 mm ball: cusp ${(3 - Math.sqrt(8)).toFixed(3)}); removed ${(st.removedVolume() / 1000).toFixed(1)} cm³`)
    expect(gouge).toBeLessThanOrEqual(0.005)
    // every bit of the turned part is finished: at most a cusp and a little left (no roughing stock)
    expect(p95).toBeLessThan(3 - Math.sqrt(8) + 0.01)
    // the pommel stays square: rays over its faces untouched
    expect(st.outer(Math.floor(25 / st.cell), Math.floor(st.nt / 8))).toBeCloseTo(st.outer(Math.floor(25 / st.cell), Math.floor(st.nt / 8)), 9)
    for (const j of [0, Math.floor(st.nt / 8), Math.floor(st.nt / 4)]) expect(st.outer(Math.floor(25 / st.cell), j)).toBeCloseTo(20 / Math.max(Math.abs(Math.cos(st.phiOf(j))), Math.abs(Math.sin(st.phiOf(j)))), 4)
    expectGolden3d('rotary-leg-rough-along', tpR)
    expectGolden3d('rotary-leg-finish-rings', tpF)
  }, 120_000)
})

describe('M3.3 acceptance: a fluted column simulates in the rotary stock with no gouges', () => {
  it('eight stopped flutes drawn on a wrapped plane, cut with a ball; the stock matches the design on every ray', () => {
    const { part, setup, flutes } = columnPart()
    const op = rotaryOp('wrap', { id: 'flutes', toolId: 't105', geometry: flutes, levels: { safeZ: 20, rapidZ: 5, depth: 2.5, through: false, stockZ: 0, passDepth: 0 } })
    const tp = gen({ ...part, ops: [op] }, op)
    expect(tp.warnings).toEqual([])
    // eight flutes: in, along, out
    expect(tp.moves.filter((m) => m.t === 'feed' && m.f === 'plunge')).toHaveLength(8)
    const c = rotaryCollisions(setup, [tp], PLACEHOLDER_MACHINE, { cell: 0.25 })
    expect(c.found).toEqual([])
    // the design: the Ø50 column less each flute's capsule (ball centre 25.5 mm out, 3 mm radius, x 30 to 170)
    const R = COLUMN.diameter / 2
    const rc = R - 2.5 + 3
    const design = (u: number, phi: number) => {
      let out = R
      for (let k = 0; k < COLUMN.flutes; k++) {
        const th = ((k + 0.5) * 2 * Math.PI) / COLUMN.flutes
        const du = u < COLUMN.from ? COLUMN.from - u : u > COLUMN.to ? u - COLUMN.to : 0
        if (du >= 3) continue
        const re = Math.sqrt(9 - du * du)
        const ce = rc * Math.cos(phi - th)
        const disc = ce * ce - rc * rc + re * re
        // (a ray on the far side of the axis does not meet it)
        if (disc < 0 || ce <= 0) continue
        out = Math.min(out, ce - Math.sqrt(disc))
      }
      return out
    }
    const st = c.stock
    let worst = 0
    let deepest = Infinity
    let deepestWant = Infinity
    for (let i = 0; i < st.nu; i++)
      for (let j = 0; j < st.nt; j++) {
        const want = design(st.uOf(i), st.phiOf(j))
        worst = Math.max(worst, Math.abs(st.outer(i, j) - want))
        deepest = Math.min(deepest, st.outer(i, j))
        deepestWant = Math.min(deepestWant, want)
      }
    say(`fluted column: ${st.nu * st.nt} rays, stock within ${worst.toExponential(2)} mm of the design, deepest ${deepest.toFixed(4)} mm from the axis (flute floor ${R - 2.5}); removed ${(st.removedVolume() / 1000).toFixed(2)} cm³`)
    expect(worst).toBeLessThanOrEqual(0.005)
    // the floor: 2.5 mm deep (the nearest ray to a flute's middle is half a cell off it)
    expect(deepest).toBeCloseTo(deepestWant, 5)
    expect(deepest - (R - 2.5)).toBeLessThan(0.001)
    // the lands between the flutes and the ends are untouched
    expect(st.outer(Math.floor(100 / st.cell), 0)).toBeCloseTo(R, 5)
    expect(st.outer(Math.floor(10 / st.cell), Math.floor(st.nt / 16))).toBeCloseTo(R, 5)
    expectGolden3d('rotary-column-flutes', tp)
  })
})

describe('M3.3 more rotary passes', () => {
  it('spiral and along-the-axis finishing gouge-check clean; one-way rings keep turning, never winding back', () => {
    const { part, mesh, setup } = legPart()
    const meshes = new Map([['leg', mesh]])
    // a plane over the taper only (x 100 to 260), all the way round, at the blank's half size
    const taper = { ...setup.planes[0], id: 'p2', name: 'Taper', start: 100, end: 260, from: 'extents' as const }
    const p = { ...part, rotary: { ...setup, planes: [setup.planes[0], taper] } }
    const spiral = gen(p, rotaryOp('spiral', { id: 'sp', toolId: 't105', stepover: 3, planeId: 'p2', modelId: 'leg' }), meshes)
    const along = gen(p, rotaryOp('along', { id: 'al', toolId: 't105', stepover: 3, planeId: 'p2', modelId: 'leg' }), meshes)
    for (const tp of [spiral, along]) {
      expect(tp.warnings).toEqual([])
      expect(checkRotaryGouge(mesh, setup, taper, { shape: 'ball', r: 3 }, tp.moves, { step: 0.5 }).max).toBeLessThanOrEqual(0.005)
    }
    // the spiral: one cut, angle rising all the way, 3 mm along per turn
    const sp = spiral.moves.filter((m) => m.t === 'poly')
    expect(sp).toHaveLength(1)
    const pts = sp[0].t === 'poly' ? sp[0].pts : new Float64Array()
    const plunge = spiral.moves.find((m) => m.t === 'feed' && m.f === 'plunge')!
    const ys = [plunge.t === 'feed' ? plunge.y : 0, ...Array.from({ length: pts.length / 3 }, (_, k) => pts[k * 3 + 1])]
    expect(ys.every((y, k) => k === 0 || y > ys[k - 1])).toBe(true)
    const turns = (ys[ys.length - 1] - ys[0]) / (2 * Math.PI * taper.radius)
    expect(turns).toBeCloseTo(160 / 3, 6)
    // rings one way: each starts a turn on from the last, so the rotary axis only ever turns one way
    const oneWay = gen(p, rotaryOp('around', { id: 'ow', toolId: 't105', stepover: 20, planeId: 'p2', modelId: 'leg', zigzag: false }), meshes)
    const starts = oneWay.moves.filter((m) => m.t === 'feed' && m.f === 'plunge').map((m) => (m.t === 'feed' ? m.y : 0))
    expect(starts.length).toBe(9)
    expect(starts.every((y, k) => k === 0 || y - starts[k - 1] > 2 * Math.PI * taper.radius - 1e-6)).toBe(true)
    expectGolden3d('rotary-leg-spiral', spiral)
  }, 120_000)

  it('stays inside a plane that goes only part of the way round; a spiral needs the whole way', () => {
    const { part, mesh, setup } = legPart()
    const meshes = new Map([['leg', mesh]])
    const quarter = { ...setup.planes[0], id: 'q', name: 'Quarter', start: 120, end: 200, a0: 45, a1: 135, from: 'extents' as const }
    const p = { ...part, rotary: { ...setup, planes: [quarter] } }
    const tp = gen(p, rotaryOp('along', { id: 'a', toolId: 't105', stepover: 2, planeId: 'q', modelId: 'leg' }), meshes)
    const r = planeRect(quarter)
    for (const m of tp.moves) {
      if (m.t !== 'poly') continue
      for (let k = 0; k < m.pts.length; k += 3) {
        expect(m.pts[k]).toBeGreaterThanOrEqual(r.x0 - 1e-9)
        expect(m.pts[k]).toBeLessThanOrEqual(r.x1 + 1e-9)
        expect(m.pts[k + 1]).toBeGreaterThanOrEqual(r.y0 - 1e-9)
        expect(m.pts[k + 1]).toBeLessThanOrEqual(r.y1 + 1e-9)
      }
    }
    expect(gen(p, rotaryOp('spiral', { id: 's', toolId: 't105', planeId: 'q', modelId: 'leg' }), meshes).warnings).toEqual(['A spiral needs a wrapped plane that goes all the way round (0° to 360°).'])
  })
})

describe('M3.3 saw blades on the rotary axis (disc and saw tools)', () => {
  it('cuts reeds along the axis with the blade standing in the axis plane, rings round it with the blade square to it', () => {
    const { part, setup } = columnPart()
    const r = planeRect(setup.planes[0])
    const reeds = [0, 1, 2, 3].map((k) => makeEntity({ t: 'contour', c: { closed: false, segs: [line({ x: r.x0 + 40, y: r.y0 + 10 + k * 30 }, { x: r.x0 + 160, y: r.y0 + 10 + k * 30 })] } }, 'machining'))
    const p = { ...part, entities: [...part.entities, ...reeds] }
    const op = rotaryOp('wrap', { id: 'reeds', toolId: 't140', geometry: reeds.map((e) => e.id), levels: { safeZ: 20, rapidZ: 5, depth: 3, through: false, stockZ: 0, passDepth: 0 } })
    const tp = gen(p, op)
    expect(tp.rotary?.blade).toEqual({ R: 100, plane: 'axial' })
    expect(tp.warnings).toEqual([`T140 has no blade diameter: a 200 mm placeholder blade is assumed.`, `The blade's curve runs ${Math.sqrt(100 * 100 - 97 * 97).toFixed(1)} mm past each end of a groove at the plane's surface (blade Ø200, 3 mm deep).`])
    const st = rotaryCollisions(setup, [tp], PLACEHOLDER_MACHINE, { cell: 0.25 }).stock
    // a groove 4 mm wide (the kerf), 3 mm deep at its middle, untouched beside it
    const i = Math.floor(100 / st.cell)
    const groove = (y: number) => y / (COLUMN.diameter / 2)
    const jMid = Math.floor(groove(10) / st.dphi)
    expect(st.outer(i, jMid)).toBeCloseTo(22, 3)
    const halfKerf = Math.asin(2 / 22)
    expect(st.outer(i, Math.floor((groove(10) + halfKerf + 2 * st.dphi) / st.dphi))).toBeCloseTo(25, 5)
    // round the axis: a ring groove, blade square to the axis
    const ring = makeEntity({ t: 'contour', c: { closed: false, segs: [line({ x: r.x0 + 100, y: r.y0 }, { x: r.x0 + 100, y: r.y1 })] } }, 'machining')
    const ringOp = rotaryOp('wrap', { id: 'ring', toolId: 't140', geometry: [ring.id], levels: { safeZ: 20, rapidZ: 5, depth: 4, through: false, stockZ: 0, passDepth: 0 } })
    const tr = gen({ ...part, entities: [...part.entities, ring] }, ringOp)
    expect(tr.rotary?.blade).toEqual({ R: 100, plane: 'ring' })
    const rs = rotaryCollisions(setup, [tr], PLACEHOLDER_MACHINE, { cell: 0.25 }).stock
    let cols = 0
    for (let k = 0; k < rs.nu; k++) if (Math.abs(rs.uOf(k) - 100) <= 2) cols++
    // the kerf's annulus 4 mm deep all the way round (to the cells)
    expect(rs.removedVolume() / (Math.PI * (25 * 25 - 21 * 21) * cols * rs.cell)).toBeCloseTo(1, 3)
    // a blade cuts only straight along or round the axis
    const diag = makeEntity({ t: 'contour', c: { closed: false, segs: [line({ x: r.x0 + 20, y: r.y0 + 5 }, { x: r.x0 + 60, y: r.y0 + 40 })] } }, 'machining')
    const td = gen({ ...p, entities: [...p.entities, diag] }, { ...op, geometry: [...op.geometry, diag.id] })
    expect(td.warnings).toContain('1 shape(s) are not straight along the axis and are left out: a saw blade cuts straight along the axis or straight round it, one way per operation.')
  })
})

describe('M3.3 rotary operations: refusals and checks', () => {
  it('says what is missing or unsuitable', () => {
    const { part, mesh } = legPart()
    const meshes = new Map([['leg', mesh]])
    const op = rotaryOp('along', { id: 'x', toolId: 't105', modelId: 'leg' })
    expect(gen({ ...part, rotary: undefined }, op, meshes).warnings).toEqual(['This part has no rotary set-up: set the axis and the blank first (3D tab, Rotary).'])
    expect(gen(part, { ...op, planeId: 'none' }, meshes).warnings).toEqual(['Pick the wrapped plane this operation works on.'])
    expect(gen(part, { ...op, toolId: 't108' }, meshes).warnings[0]).toMatch(/lollipop\) cannot be used for rotary machining/)
    expect(gen(part, { ...op, toolId: 't140' }, meshes).warnings[0]).toMatch(/saw blade: a blade cuts drawn grooves only/)
    expect(gen(part, { ...op, toolId: 't104', stockToLeave: 0.5 }, meshes).warnings).toEqual(['Stock to leave needs a ball-nose, bull-nose or flat tool (not a V cutter).'])
    expect(gen(part, op).warnings).toEqual(['The 3D model "Leg" is not loaded, so no toolpath was calculated.'])
    // a tool too short for the depth: said up front (a short stretch of the taper keeps it quick)
    const short = { ...part, rotary: { ...part.rotary!, planes: [{ ...part.rotary!.planes[0], start: 200, end: 230 }] } }
    expect(gen(short, { ...op, toolId: 't106', stepover: 10, stepdown: 5 }, meshes).warnings.some((w) => /T106 cuts only 12 mm deep/.test(w))).toBe(true)
    // model strategies run in the background; shapes cut below the plane do not
    expect(inBackground(op, part)).toBe(true)
    expect(inBackground(rotaryOp('wrap'), part)).toBe(false)
    expect(inBackground(rotaryOp('wrap', { onModel: true }), part)).toBe(true)
  }, 60_000)

  it('finds a tool too short for the depth (shank) and a tip past the axis', () => {
    const { part, mesh, setup } = legPart()
    const tp = gen(part, rotaryOp('along', { id: 'deep', toolId: 't106', stepover: 6, stepdown: 4, modelId: 'leg' }), new Map([['leg', mesh]]))
    const c = rotaryCollisions(setup, [tp], PLACEHOLDER_MACHINE, { cell: 1 })
    expect(c.found.some((x) => x.kind === 'shank')).toBe(true)
    expect(c.found.find((x) => x.kind === 'shank')!.message).toMatch(/shank hits material above the flutes .* at X\d+\.\d A\d+\.\d° at \d+\.\d mm from the axis/)
    // a hand-made path through the axis
    const bad: Toolpath = { ...tp, moves: [{ t: 'rapid', x: 50, y: 60, z: 20 }, { t: 'feed', x: 50, y: 60, z: -22, f: 'plunge' }] }
    expect(rotaryCollisions(setup, [bad], PLACEHOLDER_MACHINE, { cell: 1 }).found.map((x) => x.kind)).toContain('axis')
  })

  it('goes stale when the axis, the blank, the plane or the model changes', () => {
    const { part } = legPart()
    const op = rotaryOp('along', { toolId: 't105', modelId: 'leg' })
    const h = opInputHash(op, part, null)
    expect(opInputHash(op, { ...part, rotary: { ...part.rotary!, blank: { ...part.rotary!.blank, size: 41 } } }, null)).not.toBe(h)
    expect(opInputHash(op, { ...part, rotary: { ...part.rotary!, centre: { x: 0, y: 21, z: -20 } } }, null)).not.toBe(h)
    expect(opInputHash(op, { ...part, rotary: { ...part.rotary!, planes: [{ ...part.rotary!.planes[0], radius: 19 }] } }, null)).not.toBe(h)
    expect(opInputHash(op, { ...part, models: [{ ...part.models![0], blob: 'other' }] }, null)).not.toBe(h)
    // another plane changing does not
    const extra = { ...part.rotary!.planes[0], id: 'p9' }
    expect(opInputHash(op, { ...part, rotary: { ...part.rotary!, planes: [part.rotary!.planes[0], extra] } }, null)).toBe(h)
  })

  it('shows its placeholder step-over and step-down with Configure badges until confirmed', () => {
    const m = PLACEHOLDER_MACHINE
    const op = rotaryOp('along', { stepover: 1, stepdown: 3 })
    const keys = opUnconfirmed(op, { id: 'p' }, m, null).map((u) => u.label)
    expect(keys).toEqual(['Rotary passes along the axis: rotary step-over', 'Rotary passes along the axis: rotary roughing step-down'])
    expect(opUnconfirmed(confirmOp(confirmOp(op, 'rotaryStepover'), 'rotaryStepdown'), { id: 'p' }, m, null)).toEqual([])
    expect(opUnconfirmed(rotaryOp('wrap'), { id: 'p' }, m, null)).toEqual([])
  })
})

describe('M3.3 the N-200 export refuses rotary work', () => {
  it('leaves a turned part out of nesting and refuses the job; never writes a rotary operation to woodWOP', () => {
    const data = appData()
    const { part } = columnPart()
    const flutes = part.entities.filter((e) => e.layer === 'machining').map((e) => e.id)
    const turned: CamPart = { ...part, materialId: data.library.materials[0].id, thickness: data.library.materials[0].thickness, ops: [rotaryOp('wrap', { toolId: 't105', geometry: flutes })] }
    const at = '2026-01-01T00:00:00.000Z'
    const job: Job = { id: 'j', number: 'R1', name: 'Rotary', customer: '', notes: '', createdAt: at, updatedAt: at, cabinets: [], camParts: [turned] }
    const on = { ...data, settings: { ...data.settings, features: { ...data.settings.features, camMprOutput: true, cam3dMprOutput: true, cam25dMprOutput: true } } }
    const r = runJob(job, on)
    const err = r.issues.find((i) => i.code === 'CAM_ROTARY')
    expect(err?.severity).toBe('error')
    expect(err?.message).toMatch(/turned on a rotary axis \(1 rotary operation\(s\)\)\. The machine model \(.*\) has no rotary axis, so it is not nested and nothing of it is written to woodWOP/)
    expect(r.issues.some((i) => i.code === 'CONSTRUCTION' && /turned on a rotary axis\. It is left out of the cut list and nesting/.test(i.message))).toBe(true)
    expect(r.nest.sheets.length).toBe(0)
    // a rotary operation on a flat part is blocked from woodWOP like any operation without a form
    const flat: CamPart = { ...newPart({ name: 'Flat', length: 300, width: 200 }), materialId: data.library.materials[0].id, thickness: data.library.materials[0].thickness, ops: [rotaryOp('along', { id: 'rot', toolId: 't105' })] }
    const r2 = runJob({ ...job, camParts: [flat] }, on)
    expect(r2.issues.some((i) => i.code === 'CAM_NO_OUTPUT' && /it turns the part on a rotary axis/.test(i.message))).toBe(true)
    expect(r2.programs.length).toBeGreaterThan(0)
    expect(r2.programs.flatMap((p) => p.ops).some((o) => (o as { opId?: string }).opId === 'rot')).toBe(false)
  })
})

describe('M3.3 part format 8', () => {
  it('keeps the rotary set-up and operations through a save; an older part reads unchanged; a newer one is refused', () => {
    expect(CAM_FILE_VERSION).toBe(8)
    const { part, flutes } = columnPart()
    const withOp = { ...part, ops: [rotaryOp('wrap', { toolId: 't105', geometry: flutes })] }
    const back = parsePart(serializePart(withOp))
    expect(back.rotary).toEqual(withOp.rotary)
    expect(back.ops).toEqual(withOp.ops)
    const v7 = JSON.parse(serializePart(newPart({ name: 'Old' })))
    v7.version = 7
    v7.part.version = 7
    const old = parsePart(JSON.stringify(v7))
    expect(old.version).toBe(8)
    expect(old.rotary).toBeUndefined()
    const v9 = JSON.parse(serializePart(newPart({ name: 'New' })))
    v9.version = 9
    expect(() => parsePart(JSON.stringify(v9))).toThrow(/newer than this app/)
    // and the generator: a part's rotary toolpaths come through generatePart with their plane
    const tps = generatePart(withOp, PLACEHOLDER_MACHINE)
    expect(tps[0].rotary?.plane.id).toBe('p1')
    expect(rotaryTimeline(tps, part.rotary!).tl.segs.length).toBeGreaterThan(0)
  })
})

describe('M3.3 wrapped plane from a solid\'s cylindrical face', () => {
  it('lists the cylinders of a STEP part where its placement puts them; a plane fitted to a Ø5 hole wall', async () => {
    const solid = await readFixture('cabinet-side.step')
    const cyls = solidCylinders(solid, { place: DEFAULT_PLACEMENT })
    // a Ø5 hole 13 mm deep (the fixture's truth); the file stands the side on its edge
    const hole = cyls.find((c) => Math.abs(c.cyl.r - 2.5) < 1e-6)!
    expect(hole).toBeDefined()
    expect(hole.concave).toBe(true)
    // the rotary axis put on the hole's axis, then a plane fitted to its wall: 13 mm long, all the way round
    const base: RotarySetup = { axis: 'X', centre: { x: 0, y: 0, z: 0 }, blank: { shape: 'round', size: 10, start: -1000, end: 1000 }, planes: [] }
    const moved0 = axisFromCylinder(base, hole.cyl)
    if (!('setup' in moved0)) throw new Error(moved0.error)
    const s = moved0.setup
    const r = planeFromCylinder(s, hole.cyl, hole.points, { id: 'h', name: 'Hole wall', at: { x: 0, y: 0 }, modelId: 'side', faceId: hole.faceId })
    if (!('plane' in r)) throw new Error(r.error)
    expect(r.plane.radius).toBeCloseTo(2.5, 6)
    expect(r.plane.end - r.plane.start).toBeCloseTo(13, 3)
    expect([r.plane.a0, r.plane.a1]).toEqual([0, 360])
    expect(r.plane.face).toEqual({ modelId: 'side', faceId: hole.faceId, fit: hole.cyl.fit })
    // moved by the placement: 100 mm along X moves the cylinder with it
    const moved = solidCylinders(solid, { place: { ...DEFAULT_PLACEMENT, at: [100, 0, 0] } }).find((c) => c.faceId === hole.faceId)!
    expect(moved.cyl.p[0] - hole.cyl.p[0]).toBeCloseTo(100, 6)
  })
})
