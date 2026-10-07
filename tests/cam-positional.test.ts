/**
 * M3.4 positional (3+2) machining (5AX-01): tilted work planes, our own kinematics on the machine
 * model, conversion to machine axes and to vertical, the tri-dexel stock, the collision check, and
 * the acceptance test: tilted-plane holes and pockets on a test block land within 0.01 mm after
 * the axis conversion, checked in simulation; the N-200 export refuses it.
 *
 * The design numbers below (hole centres, axes, pocket outlines) are worked out by hand from the
 * fixture's chamfers, not from the code under test.
 */
import { describe, expect, it } from 'vitest'
import { opInputHash, opState } from '@/cam/doc'
import { axesFromAngles, blockDepthBelow, inTilted, partToPlane, planeFrame, planeFromFace, planeToPart, sidePlane, type V3 } from '@/cam/positional/frame'
import { fromMachine, kinematicsProblems, pickAngles, solveAngles, toMachine, wrap180 } from '@/cam/positional/kinematics'
import { machineProgram, partFrameMoves, replayMachine, straightMoves, toVertical } from '@/cam/positional/convert'
import { positionalCollisions, positionalTimeline } from '@/cam/positional/sim'
import { TriDexelStock } from '@/cam/stock/tridexel'
import { generateOp, generatePart, TILTED_NO_MPR, type Toolpath } from '@/cam/toolpath'
import { resolveTool } from '@/cam/ops'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import { PLACEHOLDER_N200_MODEL } from '@/core/machineModel'
import { BLANK, BLOCK, blockPart, HOLES, machine32, MACHINES_32, opById } from './positional-fixtures'
import { expectGolden3d } from './finish3d-setup'
import { data as appData } from './helpers'
import { newPart } from '@/cam/doc'
import { defaultSetup } from '@/cam/rotary/frame'
import { writePartMpr } from '@/cam/mpr'
import { partCollisions } from '@/cam/collision/collision'
import type { CamPart } from '@/cam/types'
import { runJob } from '@/core/pipeline'
import type { Job } from '@/core/types'
import { PLACEHOLDER_POSITIONAL, rotaryAxisOf, withPositional, withRotaryAxis } from '@/core/machineModel'
import { confirmKey, machineUnconfirmed, POSITIONAL_FACT_LABEL } from '@/core/confirm'
import { DEFAULT_FEATURES } from '@/core/features'
import { markTimes, type StockMarks } from '@/cam/collision/collision'
import { positionalStock } from '@/cam/positional/sim'
import { StockSimulation } from '@/cam/stock/simulation'
import { rotaryCollisions, rotaryTimeline } from '@/cam/rotary/sim'
import { RotaryStock } from '@/cam/rotary/stock'
import { columnPart, rotaryOp } from './rotary-fixtures'

const log = (s: string) => console.log(`  [3+2] ${s}`)
const S2 = Math.SQRT1_2
const C30 = Math.cos(Math.PI / 6)
const S3 = 1 / Math.sqrt(3)
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const sub = (a: readonly number[], b: readonly number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

/** Hand-worked design: each hole's mouth centre on its face (part frame), axis out of the part, Ø, depth. */
const HOLE_DESIGN = [
  { name: 'right chamfer 1', c: [120 - 14 * S2, 30, -20 + 14 * S2], n: [S2, 0, S2], d: 8, depth: 12 },
  { name: 'right chamfer 2', c: [120 - 14 * S2, 80, -20 + 14 * S2], n: [S2, 0, S2], d: 8, depth: 12 },
  { name: 'front chamfer', c: [75, 15 * C30, -7.5], n: [0, -0.5, C30], d: 6, depth: 10 },
  { name: 'corner facet', c: [15, 85, -15], n: [-S3, S3, S3], d: 8, depth: 15 },
  { name: 'back side', c: [60, 100, -20], n: [0, 1, 0], d: 8, depth: 20 },
]
/** Pockets: centre, axis, the plane's x and y in the part, outline half sizes and corner radius, depth. */
const POCKET_DESIGN = [
  { name: 'right chamfer (Ø16)', c: [120 - 14 * S2, 55, -20 + 14 * S2], n: [S2, 0, S2], x: [0, 1, 0], y: [-S2, 0, S2], hw: 8, hh: 8, r: 8, depth: 5 },
  { name: 'front chamfer (40 x 14 R4)', c: [35, 15 * C30, -7.5], n: [0, -0.5, C30], x: [1, 0, 0], y: [0, C30, 0.5], hw: 20, hh: 7, r: 4, depth: 6 },
  { name: 'back side (30 x 16 R5)', c: [90, 100, -18], n: [0, 1, 0], x: [-1, 0, 0], y: [0, 0, 1], hw: 15, hh: 8, r: 5, depth: 4 },
]

/** Signed distance from a point (plane x, y about the centre) to a rounded rectangle's outline (negative inside). */
function roundRectDist(px: number, py: number, hw: number, hh: number, r: number) {
  const qx = Math.abs(px) - (hw - r)
  const qy = Math.abs(py) - (hh - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

/**
 * Every cut surface point of the stock, measured against the design: on a hole's wall or floor, or
 * a pocket's wall or floor. Returns the worst distances and anything that is on no designed surface.
 */
function measure(stock: TriDexelStock) {
  const pts = stock.cutPoints()
  const res = { points: pts.length, holeWall: 0, holeFloor: 0, pocketWall: 0, pocketFloor: 0, stray: [] as number[][], perHole: HOLE_DESIGN.map(() => 0), perPocket: POCKET_DESIGN.map(() => 0), holeCount: HOLE_DESIGN.map(() => 0), pocketCount: POCKET_DESIGN.map(() => 0) }
  for (const { p } of pts) {
    let best = Infinity
    let where: (() => void) | null = null
    HOLE_DESIGN.forEach((h, i) => {
      const d = sub(p, h.c)
      const z = dot(d, h.n)
      const rho = Math.hypot(d[0] - z * h.n[0], d[1] - z * h.n[1], d[2] - z * h.n[2])
      const R = h.d / 2
      if (z > 0.5 || z < -h.depth - 0.5 || rho > R + 0.5) return
      // nearest designed surface: wall (inside the depth) or floor (inside the radius)
      const wall = z >= -h.depth ? Math.abs(rho - R) : Infinity
      const floor = rho <= R ? Math.abs(z + h.depth) : Infinity
      const e = Math.min(wall, floor)
      if (e < best) {
        best = e
        where = () => {
          if (wall <= floor) res.holeWall = Math.max(res.holeWall, wall)
          else res.holeFloor = Math.max(res.holeFloor, floor)
          res.perHole[i] = Math.max(res.perHole[i], e)
          res.holeCount[i]++
        }
      }
    })
    POCKET_DESIGN.forEach((k, i) => {
      const d = sub(p, k.c)
      const z = dot(d, k.n)
      if (z > 0.5 || z < -k.depth - 0.5) return
      const dist = roundRectDist(dot(d, k.x), dot(d, k.y), k.hw, k.hh, k.r)
      if (dist > 0.5) return
      const wall = z >= -k.depth ? Math.abs(dist) : Infinity
      const floor = dist <= 0 ? Math.abs(z + k.depth) : Infinity
      const e = Math.min(wall, floor)
      if (e < best) {
        best = e
        where = () => {
          if (wall <= floor) res.pocketWall = Math.max(res.pocketWall, wall)
          else res.pocketFloor = Math.max(res.pocketFloor, floor)
          res.perPocket[i] = Math.max(res.perPocket[i], e)
          res.pocketCount[i]++
        }
      }
    })
    if (where && best <= 0.05) (where as () => void)()
    else res.stray.push(p)
  }
  return res
}

const blankStock = (cell = 0.25) => {
  const s = new TriDexelStock(BLOCK.length, BLOCK.width, BLOCK.thickness, cell)
  s.setConvex(BLANK)
  return s
}

describe('M3.4 tilted work planes (frames)', () => {
  it('turn right-handed and orthonormal; the sides of the block and a fitted face land where they should', () => {
    for (const [tilt, toward, spin] of [
      [0, -90, 0],
      [30, -90, 0],
      [45, 0, 0],
      [54.7356, 135, 0],
      [90, 90, 0],
      [120, 33, 17],
      [180, -90, 0],
    ]) {
      const a = axesFromAngles(tilt, toward, spin)
      for (const v of [a.x, a.y, a.z]) expect(Math.hypot(...v)).toBeCloseTo(1, 12)
      expect(dot(a.x, a.y)).toBeCloseTo(0, 12)
      expect(dot(a.y, a.z)).toBeCloseTo(0, 12)
      const c = [a.x[1] * a.y[2] - a.x[2] * a.y[1], a.x[2] * a.y[0] - a.x[0] * a.y[2], a.x[0] * a.y[1] - a.x[1] * a.y[0]]
      expect(dot(c, a.z)).toBeCloseTo(1, 12)
      // the normal leans `tilt` from +Z towards `toward`
      expect(Math.acos(Math.min(1, a.z[2])) * (180 / Math.PI)).toBeCloseTo(tilt, 6)
      if (tilt > 1 && tilt < 179) expect(Math.atan2(a.z[1], a.z[0]) * (180 / Math.PI)).toBeCloseTo(((toward + 540) % 360) - 180, 6)
      // spin 0: x level
      if (!spin) expect(Math.abs(a.x[2])).toBeLessThan(1e-12)
    }
    // level plane: the part's own frame
    expect(axesFromAngles(0, -90, 0)).toEqual({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] })
    // each side of the block: its rectangle's corners on that face, normal out of it
    const T = BLOCK.thickness
    const expectSide: Record<string, { n: V3; on: (p: V3) => number }> = {
      top: { n: [0, 0, 1], on: (p) => p[2] },
      front: { n: [0, -1, 0], on: (p) => p[1] },
      right: { n: [1, 0, 0], on: (p) => p[0] - BLOCK.length },
      back: { n: [0, 1, 0], on: (p) => p[1] - BLOCK.width },
      left: { n: [-1, 0, 0], on: (p) => p[0] },
      underside: { n: [0, 0, -1], on: (p) => p[2] + T },
    }
    for (const [side, want] of Object.entries(expectSide)) {
      const f = sidePlane(BLOCK, side as never)
      const pl = { id: 's', name: side, ...f, at: { x: 0, y: 0 }, from: 'side' as const }
      const fr = planeFrame(pl)
      for (let k = 0; k < 3; k++) expect(fr.z[k]).toBeCloseTo(want.n[k], 12)
      for (const [u, v] of [
        [0, 0],
        [f.size.x, 0],
        [0, f.size.y],
        [f.size.x, f.size.y],
      ]) {
        const q = planeToPart(pl, u, v, 0)
        expect(Math.abs(want.on(q))).toBeLessThan(1e-9)
        expect(q[0]).toBeGreaterThan(-1e-9)
        expect(q[0]).toBeLessThan(BLOCK.length + 1e-9)
        expect(q[1]).toBeGreaterThan(-1e-9)
        expect(q[1]).toBeLessThan(BLOCK.width + 1e-9)
        expect(q[2]).toBeGreaterThan(-T - 1e-9)
        expect(q[2]).toBeLessThan(1e-9)
        // and back
        const b = partToPlane(pl, q)
        expect(Math.hypot(b.x - u, b.y - v, b.z)).toBeLessThan(1e-9)
      }
      // y runs up the side (or along the top / underside)
      if (!['top', 'underside'].includes(side)) expect(fr.y[2]).toBeCloseTo(1, 12)
    }
    // fitted to the corner facet: its normal, its points on the plane, inside its rectangle
    const tri: V3[] = [
      [45, 100, 0],
      [0, 55, 0],
      [0, 100, -45],
    ]
    const fit = planeFromFace([-1, 1, 1], tri)
    if ('error' in fit) throw new Error(fit.error)
    expect(fit.fields.tilt).toBeCloseTo(54.7356103, 6)
    expect(fit.fields.toward).toBeCloseTo(135, 9)
    expect(fit.fit).toBeLessThan(1e-9)
    const pl = { id: 'c', name: 'c', ...fit.fields, at: { x: 10, y: 20 }, from: 'face' as const }
    for (const q of tri) {
      const b = partToPlane(pl, q)
      expect(Math.abs(b.z)).toBeLessThan(1e-9)
      expect(inTilted(pl, b)).toBe(true)
    }
    // depth of material below a plane: from the right chamfer to the block's far bottom corner (0, y, -60)
    const right = blockPart().planes.right
    expect(blockDepthBelow(BLOCK, planeFrame(right))).toBeCloseTo(S2 * (120 + 40), 9)
  })
})

describe('M3.4 kinematics on the machine model', () => {
  it('solves both angle pairs for every layout and turns part points to machine axes and back exactly', () => {
    const dirs: V3[] = [
      [S2, 0, S2],
      [0, -0.5, C30],
      [-S3, S3, S3],
      [0, 1, 0],
      [0, 0, 1],
      [0.3, -0.4, Math.sqrt(1 - 0.25)],
    ]
    let worst = 0
    for (const m of [...MACHINES_32(), machine32('head-head', 'A', 'B'), machine32('table-table', 'B', 'C'), machine32('table-head', 'C', 'A')]) {
      const k = m.physical!.positional!
      expect(kinematicsProblems(m.physical!)).toEqual([])
      for (const v of dirs) {
        const sols = solveAngles(k, v)
        expect(sols.length).toBeGreaterThanOrEqual(1)
        for (const a of sols) {
          for (const L of [0, 212.5]) {
            const p: V3 = [37.5, 61.25, -18.75]
            const r = toMachine(k, a, p, L)
            const back = fromMachine(k, a, r.xyz, L)
            worst = Math.max(worst, Math.hypot(...sub(back.tip, p)), Math.hypot(...sub(back.tool, v)))
          }
        }
      }
    }
    log(`kinematics round trip (3 layouts, 6 axis pairs, 6 directions, both solutions): worst ${worst.toExponential(2)} mm`)
    expect(worst).toBeLessThan(1e-9)
    // fork head C/B: tilted 30° towards +X is C0 B30, or C180 B-30 (the other way round)
    const hh = machine32('head-head', 'C', 'B').physical!
    const a30 = axesFromAngles(30, 0, 0).z
    const pick = pickAngles(hh, a30)
    if ('error' in pick) throw new Error(pick.error)
    expect(pick.angles).toEqual({ first: 0, second: 30 })
    expect(pick.other).toEqual({ first: 180, second: -30 })
    const flip = pickAngles(hh, a30, true)
    if ('error' in flip) throw new Error(flip.error)
    expect(flip.angles).toEqual({ first: 180, second: -30 })
    // straight down the Z axis: no turn
    const up = pickAngles(hh, [0, 0, 1])
    if ('error' in up) throw new Error(up.error)
    expect(up.angles).toEqual({ first: 0, second: 0 })
    // the B axis travel too short for a 90° side: refused with the angles it needs
    const short = machine32('head-head', 'C', 'B', {}, { B: [-60, 60] }).physical!
    const side = pickAngles(short, [0, 1, 0])
    expect('error' in side && side.error).toMatch(/outside the axes' travel.*B -60° to 60°/)
    // layouts that cannot tilt every way, and missing axes
    expect(kinematicsProblems(machine32('head-head', 'B', 'C').physical!).join(' ')).toMatch(/cannot tilt the tool every way round/)
    expect(kinematicsProblems(machine32('head-head', 'B', 'B').physical!).join(' ')).toMatch(/must be different/)
    expect(kinematicsProblems(PLACEHOLDER_N200_MODEL)).toEqual(['Its machine model has no 3+2 (positional) axes.'])
    expect(wrap180(-180)).toBe(180)
    expect(wrap180(540.0000000001)).toBe(180)
  })
})

describe('M3.4 operations on tilted planes', () => {
  it('generate in the plane\'s frame, never as woodWOP, refuse what cannot run tilted, and go stale when the plane moves', () => {
    const { part } = blockPart()
    const tps = generatePart(part, PLACEHOLDER_MACHINE)
    expect(tps).toHaveLength(part.ops.length)
    for (const tp of tps) {
      expect(tp.tilt?.plane.id).toBeTruthy()
      expect(tp.noOutput).toBe(TILTED_NO_MPR)
      expect(tp.intents).toEqual([])
      expect(tp.moves.length).toBeGreaterThan(0)
      expect(tp.warnings.filter((w) => /below the part's underside|left out|not inside/.test(w))).toEqual([])
    }
    // holes: plunges straight down the plane's normal to the depth below the plane
    const right = tps.find((t) => t.opId === 'drill-right-8')!
    const { moves, axis } = partFrameMoves(right)
    expect(axis.map((v) => Math.round(v * 1e12) / 1e12)).toEqual([S2, 0, S2].map((v) => Math.round(v * 1e12) / 1e12))
    const bottoms = moves.filter((m) => m.t === 'feed') as { x: number; y: number; z: number }[]
    expect(bottoms).toHaveLength(2)
    for (const [i, b] of bottoms.entries()) {
      const h = HOLE_DESIGN[i]
      const want = h.c.map((c, k) => c - h.n[k] * h.depth)
      expect(Math.hypot(b.x - want[0], b.y - want[1], b.z - want[2])).toBeLessThan(1e-9)
    }
    // refused: a shape-less plane, a drill-block tool, through cuts, adaptive, 3D kinds
    const op = opById(part, 'drill-right-8')
    const gen = (o: typeof op) => generateOp(o, { part, machine: PLACEHOLDER_MACHINE })
    expect(gen({ ...op, toolId: 't201' }).warnings.join(' ')).toMatch(/drill block, which cannot tilt/)
    expect(gen({ ...op, toolId: null }).warnings.join(' ')).toMatch(/Pick the tool for tilted holes/)
    expect(gen({ ...op, levels: { ...op.levels, through: true } }).warnings.join(' ')).toMatch(/Through cuts are not made on a tilted plane/)
    expect(gen({ ...op, tiltedPlane: 'gone' }).warnings.join(' ')).toMatch(/plane is gone/)
    const pocket = opById(part, 'pocket-front-1')
    expect(gen({ ...pocket, pattern: 'adaptive' } as never).warnings.join(' ')).toMatch(/adaptive clearing are not made on a tilted plane/)
    expect(gen({ ...pocket, toolId: 't108' }).warnings.join(' ')).toMatch(/lollipop/)
    for (const t of [gen({ ...op, toolId: 't201' }), gen({ ...pocket, pattern: 'adaptive' } as never)]) {
      expect(t.moves).toEqual([])
      expect(t.noOutput).toBe(TILTED_NO_MPR)
    }
    // a hole drawn off the plane's rectangle is left out; a face-1 op on the plane's shapes is told so
    const flat = gen({ ...op, tiltedPlane: undefined })
    expect(flat.warnings.join(' ')).toMatch(/lie on tilted plane "45° chamfer"/)
    // stale when the plane turns or moves; unchanged when another plane changes
    const tool = resolveTool(op, PLACEHOLDER_MACHINE)
    const h0 = opInputHash(op, part, tool, PLACEHOLDER_MACHINE)
    const built = { ...op, builtHash: h0 }
    const moved = { ...part, tilted: part.tilted!.map((p) => (p.id === 'right' ? { ...p, tilt: 44 } : p)) }
    const other = { ...part, tilted: part.tilted!.map((p) => (p.id === 'front' ? { ...p, tilt: 31 } : p)) }
    expect(opState(built, part, tool, PLACEHOLDER_MACHINE)).toBe('current')
    expect(opState(built, moved, tool, PLACEHOLDER_MACHINE)).toBe('stale')
    expect(opState(built, other, tool, PLACEHOLDER_MACHINE)).toBe('current')
  })

  it('"convert to vertical" gives the same moves in the plane\'s own frame', () => {
    const { part, planes } = blockPart()
    const tp = generateOp(opById(part, 'pocket-front-1'), { part, machine: PLACEHOLDER_MACHINE })
    const v = toVertical(tp)
    expect(v.tilt).toBeUndefined()
    expect(v.noOutput).toBe(TILTED_NO_MPR)
    const p = planes.front
    const a = straightMoves(tp)
    const b = straightMoves(v)
    expect(b).toHaveLength(a.length)
    let worst = 0
    for (let i = 0; i < a.length; i++) {
      const ma = a[i] as { x: number; y: number; z: number }
      const mb = b[i] as { x: number; y: number; z: number }
      // vertical (x, y, z) is the plane point (x, y) from its origin, z along its normal
      const q = planeToPart(p, ma.x, ma.y, ma.z)
      const f = planeFrame(p)
      const r = [0, 1, 2].map((k) => f.o[k] + mb.x * f.x[k] + mb.y * f.y[k] + mb.z * f.z[k])
      worst = Math.max(worst, Math.hypot(...sub(q, r)))
    }
    expect(worst).toBeLessThan(1e-9)
    // arcs are kept as arcs in the vertical program
    expect(v.moves.some((m) => m.t === 'arc')).toBe(true)
  })
})

describe('M3.4 acceptance: tilted holes and pockets after the axis conversion, checked in simulation', () => {
  const { part } = blockPart()
  const tps = generatePart(part, PLACEHOLDER_MACHINE)

  for (const [i, m] of MACHINES_32().entries()) {
    // (0.25 mm rays on the first machine, 0.5 mm on the others: exact along each ray either way)
    const cell = i === 0 ? 0.25 : 0.5
    it(`${m.name}: every cut lands within 0.01 mm of the design; no collisions (${cell} mm rays)`, () => {
      const k = m.physical!.positional!
      const prog = machineProgram(tps, m)
      expect(prog.problems).toEqual([])
      expect(prog.ops).toHaveLength(tps.length)
      // the replay matches the direct turn into the part (kinematics only, no simulation)
      const direct = positionalTimeline(tps, BLOCK)
      const replay = replayMachine(prog, tps, k)
      let kin = 0
      for (const [i, p] of replay.paths.entries()) {
        const d = partFrameMoves(tps.find((t) => t.opId === p.opId)!)
        expect(p.moves).toHaveLength(d.moves.length)
        for (let j = 0; j < p.moves.length; j++) {
          const a = p.moves[j] as { x: number; y: number; z: number }
          const b = d.moves[j] as { x: number; y: number; z: number }
          kin = Math.max(kin, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z))
        }
        kin = Math.max(kin, Math.hypot(...sub(replay.axes[i], d.axis)))
      }
      expect(kin).toBeLessThan(1e-9)
      expect(direct.tl.ops).toHaveLength(tps.length)
      // simulate the converted program on the chamfered blank
      const t0 = performance.now()
      const stock = blankStock(cell)
      const res = positionalCollisions(BLOCK, tps, m, { stock, replay: m })
      const ms = performance.now() - t0
      expect(res.run.program?.problems).toEqual([])
      expect(res.found.map((c) => c.message)).toEqual([])
      const r = measure(stock)
      const angles = prog.ops.map((o) => `${o.letters[0]}${o.angles.first} ${o.letters[1]}${o.angles.second}`)
      log(`${m.name}: angles ${[...new Set(angles)].join(' / ')}; X ${prog.travel.X.map((v) => v.toFixed(1)).join('..')}, Z ${prog.travel.Z.map((v) => v.toFixed(1)).join('..')}; kinematic replay within ${kin.toExponential(1)} mm; ${r.points} cut points: hole walls ${r.holeWall.toFixed(4)}, hole floors ${r.holeFloor.toFixed(4)}, pocket walls ${r.pocketWall.toFixed(4)}, pocket floors ${r.pocketFloor.toFixed(4)} mm, on no designed surface ${r.stray.length}; ${Math.round(ms)} ms`)
      expect(r.points).toBeGreaterThan(cell < 0.3 ? 40000 : 10000)
      expect(r.stray).toEqual([])
      for (const v of [r.holeWall, r.holeFloor, r.pocketWall, r.pocketFloor]) expect(v).toBeLessThan(0.01)
      // every feature was cut (points on each)
      expect(Math.min(...r.holeCount, ...r.pocketCount)).toBeGreaterThan(cell < 0.3 ? 400 : 100)
      expect(HOLES).toHaveLength(r.holeCount.length)
      // (rays whose pieces had to be merged while a helix entry was stamped: a merge only puts
      // material back, and any left would show as cut points on no designed surface, checked above)
      if (stock.overflow) log(`${stock.overflow} ray piece merge(s) on the way`)
    }, 240_000)
  }

  it('the head turned the other way round (other solution) cuts the same', () => {
    const m = machine32('head-head', 'C', 'B')
    const flipped = { ...part, tilted: part.tilted!.map((p) => ({ ...p, flip: true })) }
    const ftps = generatePart(flipped, PLACEHOLDER_MACHINE)
    const prog = machineProgram(ftps, m)
    expect(prog.problems).toEqual([])
    const normal = machineProgram(tps, m)
    for (const [i, op] of prog.ops.entries()) {
      // the C axis half a turn round, B the other way
      expect(Math.abs(wrap180(op.angles.first - normal.ops[i].angles.first))).toBeCloseTo(180, 9)
      expect(op.angles.second).toBeCloseTo(-normal.ops[i].angles.second, 9)
    }
    const stock = blankStock(0.5)
    const res = positionalCollisions(BLOCK, ftps, m, { stock, replay: m })
    expect(res.found).toEqual([])
    const r = measure(stock)
    expect(r.stray).toEqual([])
    for (const v of [r.holeWall, r.holeFloor, r.pocketWall, r.pocketFloor]) expect(v).toBeLessThan(0.01)
  }, 240_000)

  it('a deliberate collision is caught: a hole deeper than the tool\'s flutes, and a holder into the block', () => {
    const deep = { ...part, ops: part.ops.filter((o) => o.id === 'drill-back-8').map((o) => ({ ...o, levels: { ...o.levels, depth: 45 } })) }
    const m = machine32('table-table', 'A', 'C')
    const res = positionalCollisions(BLOCK, generatePart(deep, PLACEHOLDER_MACHINE), m, { stock: blankStock(0.5), replay: m })
    const kinds = new Set(res.found.map((c) => c.kind))
    log(`deep back hole (45 mm, T102 flutes 30): ${res.found.map((c) => c.message).join(' | ')}`)
    expect(kinds.has('shank') || kinds.has('holder')).toBe(true)
    // a hole 5 mm above the underside on the back side: the shank (Ø8 + 2 mm margin) reaches below the part
    const low = { ...part, ops: part.ops.filter((o) => o.id === 'drill-back-8') }
    const lowPart = { ...low, entities: low.entities.map((e) => (e.id === 'h4' && e.g.t === 'circle' ? { ...e, g: { ...e.g, c: { ...e.g.c, y: e.g.c.y - 35 } } } : e)) }
    const res2 = positionalCollisions(BLOCK, generatePart(lowPart, PLACEHOLDER_MACHINE), m, { stock: blankStock(0.5), replay: m })
    log(`hole 5 mm above the underside on the back side: ${res2.found.map((c) => c.message).join(' | ')}`)
    expect(res2.found.some((c) => c.kind === 'table')).toBe(true)
  }, 240_000)

  it('golden digests: tilted toolpaths and machine programs', () => {
    for (const id of ['drill-right-8', 'drill-corner-8', 'pocket-front-1', 'pocket-back-2']) expectGolden3d(`positional-${id}`, tps.find((t) => t.opId === id)!)
    for (const m of MACHINES_32()) {
      const prog = machineProgram(tps, m)
      const name = `${m.physical!.positional!.layout} ${prog.ops.map((o) => `${o.letters[0]}${o.angles.first}/${o.letters[1]}${o.angles.second}`).join(' ')}`
      const tp: Toolpath = { opId: 'program', kind: 'drill', name, tool: null, feeds: { rpm: 0, feed: 1, plunge: 1 }, moves: prog.ops.flatMap((o) => o.moves.map((q) => (q.t === 'rapid' ? { t: 'rapid' as const, x: q.x, y: q.y, z: q.z } : { t: 'feed' as const, x: q.x, y: q.y, z: q.z, f: q.f ?? 'cut' }))), intents: [], warnings: prog.problems, stats: { cut: 0, rapid: 0, minutes: 0 } }
      expectGolden3d(`positional-machine-${m.physical!.positional!.layout}-${m.physical!.positional!.first}${m.physical!.positional!.second}`, tp)
    }
  })
})

describe('M3.4 the N-200 export refuses 3+2 work', () => {
  it('leaves a part with tilted operations out of nesting and refuses the job, naming the part; nothing tilted reaches woodWOP', () => {
    const data = appData()
    const mat = data.library.materials[0]
    const { part } = blockPart()
    const block: CamPart = { ...part, materialId: mat.id, thickness: mat.thickness, ops: part.ops.filter((o) => o.tiltedPlane === 'right') }
    const flat: CamPart = { ...newPart({ id: 'flat1', name: 'Plain panel', length: 300, width: 200 }), materialId: mat.id, thickness: mat.thickness }
    const at = '2026-01-01T00:00:00.000Z'
    const job: Job = { id: 'j', number: 'P1', name: '3+2', customer: '', notes: '', createdAt: at, updatedAt: at, cabinets: [], camParts: [block, flat] }
    // every output switch on: still refused
    const on = { ...data, settings: { ...data.settings, features: { ...data.settings.features, camMprOutput: true, cam3dMprOutput: true, cam25dMprOutput: true, scriptPostOutput: true, rotaryPostOutput: true, positionalPostOutput: true } } }
    const r = runJob(job, on)
    const err = r.issues.filter((i) => i.code === 'CAM_POSITIONAL')
    expect(err).toHaveLength(1)
    expect(err[0].severity).toBe('error')
    expect(err[0].message).toMatch(/^Custom part Test block \(3\+2\) has 2 operation\(s\) on tilted work planes \(3\+2\): "Holes Ø8 \(45° chamfer\)", "Pocket 1 \(45° chamfer\)"\. /)
    expect(err[0].message).toMatch(/cannot tilt the tool \(it has no rotary axes for 3\+2\), so the part is not nested and nothing of it is written to woodWOP/)
    expect(err[0].message).toMatch(/Remove Test block \(3\+2\) from this job \(or switch its tilted operations off\) to export the rest of it\.$/)
    expect(r.issues.some((i) => i.code === 'CONSTRUCTION' && /Test block \(3\+2\) has operations on tilted work planes \(3\+2\)\. It is left out of the cut list and nesting/.test(i.message))).toBe(true)
    // the plain panel is still nested; the block is on no sheet
    expect(r.nest.sheets.flatMap((s) => s.placements).length).toBe(1)
    expect(r.programs.flatMap((p) => p.ops).some((o) => /Holes Ø8|Pocket 1/.test(JSON.stringify(o)))).toBe(false)
    // with its tilted operations switched off the block is a plain part again
    const off = { ...block, ops: block.ops.map((o) => ({ ...o, enabled: false })) }
    const r2 = runJob({ ...job, camParts: [off, flat] }, on)
    expect(r2.issues.some((i) => i.code === 'CAM_POSITIONAL')).toBe(false)
    expect(r2.nest.sheets.flatMap((s) => s.placements).length).toBe(2)
    // the part's own woodWOP program holds none of them, and the N-200 has no 3+2 axes
    const tps = generatePart(block, PLACEHOLDER_MACHINE)
    const mpr = writePartMpr(block, tps, PLACEHOLDER_MACHINE)
    expect(mpr).not.toMatch(/BohrVert|<102|<112|Tasche/)
    expect(machineProgram(tps, PLACEHOLDER_MACHINE).problems).toEqual([`${PLACEHOLDER_MACHINE.name}: its machine model has no 3+2 (positional) axes.`])
    // the N-200's own collision check leaves tilted toolpaths to the 3+2 check
    expect(partCollisions(block, tps, PLACEHOLDER_MACHINE).tl.ops).toHaveLength(0)
  })

  it('turned parts (owner, M3.3 decision 3): still refused, the error names each turned part and says to remove it to export the rest', () => {
    const data = appData()
    const mat = data.library.materials[0]
    const at = '2026-01-01T00:00:00.000Z'
    const turned = (id: string, name: string): CamPart => ({ ...newPart({ id, name, length: 200, width: 40 }), thickness: 40, materialId: mat.id, rotary: defaultSetup({ length: 200, width: 40, thickness: 40 }) })
    const flat: CamPart = { ...newPart({ id: 'flat1', name: 'Plain panel', length: 300, width: 200 }), materialId: mat.id, thickness: mat.thickness }
    const job: Job = { id: 'j', number: 'R2', name: 'Legs', customer: '', notes: '', createdAt: at, updatedAt: at, cabinets: [], camParts: [turned('l1', 'Leg A'), turned('l2', 'Leg B'), flat] }
    const r = runJob(job, data)
    const err = r.issues.filter((i) => i.code === 'CAM_ROTARY')
    expect(err.map((i) => i.severity)).toEqual(['error', 'error'])
    expect(err[0].message).toMatch(/^Custom part Leg A is turned on a rotary axis\..*Remove Leg A from this job to export the rest of it\.$/)
    expect(err[1].message).toMatch(/^Custom part Leg B is turned on a rotary axis\..*Remove Leg B from this job to export the rest of it\.$/)
  })
})

describe('M3.4 the machine model\'s 3+2 axes', () => {
  it('are set and taken away without touching a rotary axis; invented values carry a Configure badge until confirmed', () => {
    const base = { ...structuredClone(PLACEHOLDER_N200_MODEL), placeholder: false }
    const withA = withRotaryAxis(base, 'A')
    const m = withPositional(withA, { ...PLACEHOLDER_POSITIONAL })
    expect(m.axes.map((a) => a.id)).toEqual(['X', 'Y', 'Z', 'A', 'C', 'B'])
    expect(m.capabilities.positional).toBe(true)
    expect(rotaryAxisOf(m)?.id).toBe('A')
    expect(kinematicsProblems(m)).toEqual([])
    // the rotary axis cannot be one of the 3+2 axes; setting it again keeps them
    expect(withRotaryAxis(m, 'C')).toBe(m)
    expect(withRotaryAxis(m, null).axes.map((a) => a.id)).toEqual(['X', 'Y', 'Z', 'C', 'B'])
    // taken away: back to the rotary axis alone
    const back = withPositional(m, null)
    expect(back.axes.map((a) => a.id)).toEqual(['X', 'Y', 'Z', 'A'])
    expect(back.capabilities.positional).toBe(false)
    expect(back.positional).toBeUndefined()
    // Configure badge on another machine's invented 3+2 values; the N-200 has none
    const machine = { ...structuredClone(PLACEHOLDER_MACHINE), name: 'Other router', model: 'Other', physical: m }
    const item = machineUnconfirmed(machine).find((u) => u.key === 'model:positional')
    expect(item?.label).toBe(POSITIONAL_FACT_LABEL)
    expect(item?.value).toBe('head-head C/B, pivot 150 mm, tip control')
    expect(machineUnconfirmed(PLACEHOLDER_MACHINE).some((u) => u.key === 'model:positional')).toBe(false)
    const ok = structuredClone(machine)
    confirmKey(ok, 'model:positional')
    expect(ok.physical!.positional!.placeholder).toBe(false)
    expect(machineUnconfirmed(ok).some((u) => u.key === 'model:positional')).toBe(false)
    // confirming switches no output on
    expect(DEFAULT_FEATURES.positionalPostOutput).toBe(false)
    expect(DEFAULT_FEATURES.camPositional).toBe(true)
  })
})

describe('M3.4 the background check hands back stock states (owner request on M3.3: going back without replaying from the start)', () => {
  it('3+2 and rotary: a state reached from a checkpoint is the state played from the start', () => {
    const { part } = blockPart({ ops: 'pockets' })
    const tps = generatePart(part, PLACEHOLDER_MACHINE)
    const total = positionalTimeline(tps, BLOCK).tl.total
    const marks: StockMarks = { at: markTimes(total, 4), out: [] }
    const r = positionalCollisions(BLOCK, tps, PLACEHOLDER_MACHINE, { cell: 1, marks })
    expect(marks.out.map((m) => m.t).every((t, i) => t >= marks.at![i] - 1e-9)).toBe(true)
    expect(marks.out).toHaveLength(3)
    const t = (marks.out[1].t + marks.out[2].t) / 2
    const fresh = new StockSimulation(r.run.tl, positionalStock(BLOCK, 1))
    fresh.syncTo(t)
    const seeded = new StockSimulation(r.run.tl, positionalStock(BLOCK, 1))
    for (const m of marks.out) seeded.seed(m.t, m.snapshot)
    seeded.seed(r.run.tl.total, r.stock.snapshot())
    seeded.syncTo(r.run.tl.total)
    seeded.syncTo(t)
    expect(seeded.stock.removedVolume()).toBeCloseTo(fresh.stock.removedVolume(), 6)
    expect(Array.from(seeded.stock.snapshot().data)).toEqual(Array.from(fresh.stock.snapshot().data))
    // rotary: the fluted column
    const { part: col, flutes } = columnPart()
    const op = rotaryOp('wrap', { toolId: 't105', geometry: flutes, levels: { safeZ: 20, rapidZ: 5, depth: 2.5, through: false, stockZ: 0, passDepth: 0 } })
    const tp = generateOp(op, { part: { ...col, ops: [op] }, machine: PLACEHOLDER_MACHINE })
    const { tl } = rotaryTimeline([tp], col.rotary!)
    const rm: StockMarks = { at: markTimes(tl.total, 8), out: [] }
    rotaryCollisions(col.rotary!, [tp], PLACEHOLDER_MACHINE, { cell: 1, marks: rm })
    expect(rm.out).toHaveLength(7)
    const t2 = rm.out[5].t + 0.5
    const a = new StockSimulation(tl, new RotaryStock(col.rotary!, 1))
    a.syncTo(t2)
    const b = new StockSimulation(tl, new RotaryStock(col.rotary!, 1))
    for (const m of rm.out) b.seed(m.t, m.snapshot)
    b.syncTo(t2)
    expect(Array.from(b.stock.snapshot().data)).toEqual(Array.from(a.stock.snapshot().data))
  }, 120_000)
})
