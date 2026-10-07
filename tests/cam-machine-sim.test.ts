/**
 * M3.6b machine simulation (SIM-06): the machine model drives a kinematic replay of the whole
 * machine (gantry, head, spindle, tool, table, clamps) from the toolpaths converted for it or from
 * a post's output read back, with collision checks. The acceptance case: a deliberate
 * head-into-clamp, which the cutting check (tool, shank and holder) cannot see, is caught; each with
 * a near-miss twin that must come out clean.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { partCollisions } from '@/cam/collision/collision'
import { makeEntity, newPart } from '@/cam/doc'
import { rect } from '@/cam/geom'
import { machineCollisions } from '@/cam/machine/check'
import { bodiesOf, defaultBodies, kinOf, machinePose, rotations } from '@/cam/machine/model'
import { replayAt, replayProgram, replayToolpaths } from '@/cam/machine/replay'
import { writePartMpr } from '@/cam/mpr'
import { defaultOp } from '@/cam/ops'
import { PluginHost } from '@/cam/plugin/host'
import { pluginRecord } from '@/cam/plugin/manifest'
import { planPartPost, runScriptPost } from '@/cam/plugin/posts'
import type { PluginRecord } from '@/cam/plugin/types'
import { partFrameMoves, straightMoves } from '@/cam/positional/convert'
import { fromMachine, headLength, toMachine } from '@/cam/positional/kinematics'
import { readGcodeAxes } from '@/cam/programRead'
import { generatePart, type Toolpath } from '@/cam/toolpath'
import type { CamOp, CamPart, Fixture } from '@/cam/types'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import { machineModelOf } from '@/core/machineModel'
import { bodiesItem, confirmKey, machineUnconfirmed } from '@/core/confirm'
import { newMachineSetup } from '@/core/machines'
import type { AppData, MachineBody, MachineProfile, PositionalKinematics } from '@/core/types'
import { data } from './helpers'
import { rng } from './mesh-fixtures'
import { blockPart, machine32, MACHINES_32 } from './positional-fixtures'
import { curve3, cutPoints, gen5, hemiPart, machine5 } from './multiaxis-fixtures'

const say = (s: string) => process.stdout.write(`  [machine sim] ${s}\n`)
const lv = (depth: number, passDepth = 0, through = false) => ({ safeZ: 20, rapidZ: 3, depth, through, stockZ: 0, passDepth })
const clamp = (x: number, y: number, length: number, width: number, height: number, z: number, name = 'Clamp A'): Fixture => ({ id: `c-${x}-${height}`, name, kind: 'clamp', shape: { k: 'block', length, width, height }, at: { x, y, z }, rot: 0 })

/** The N-200 placeholder machine with only a spindle motor on the head (r 75, from 70 above the gauge point): clean thresholds. */
function motorOnly(): MachineProfile {
  const m = structuredClone(PLACEHOLDER_MACHINE)
  const motor: MachineBody = { id: 'motor', name: 'Spindle motor', link: 'z', shape: { k: 'cylinder', base: [0, 0, 70], axis: 'z', r: 75, h: 330 } }
  m.physical = { ...machineModelOf(m), bodies: [motor] }
  return m
}

/** 300 x 200 x 19 with a 60 x 60 pocket 10 deep in one pass (T102 Ø8, stick-out 50; its finishing pass runs at x 104..156). */
function pocketPart(fixtures: Fixture[]): CamPart {
  const p = newPart({ name: 'Clamped pocket', length: 300, width: 200, thickness: 19, materialId: 'mat-mdf18', entities: [] })
  const e = makeEntity({ t: 'contour', c: rect(100, 60, 60, 60) }, 'machining')
  p.entities = [e]
  p.ops = [{ ...defaultOp('pocket', [e.id]), toolId: 't102', levels: lv(10) } as CamOp]
  p.fixtures = fixtures
  return p
}

const machineHits = (part: CamPart, machine: MachineProfile, paths?: Toolpath[]) => {
  const tps = paths ?? generatePart(part, machine)
  return machineCollisions(replayToolpaths(tps, part, machine), part, machine)
}

describe('M3.6 the machine model drives the replay: kinematic chain', () => {
  it('the tool tip and direction of every pose agree with the 3+2 kinematics (3 layouts, random axes)', () => {
    const r = rng(7)
    let worst = 0
    for (const m of MACHINES_32()) {
      const k = kinOf(machineModelOf(m))!
      for (let i = 0; i < 300; i++) {
        const s = { x: r() * 800 - 100, y: r() * 600 - 100, z: r() * 400 - 200, a1: r() * 360 - 180, a2: r() * 180 - 90 }
        const stick = 40 + r() * 40
        const p = machinePose(k, s, stick)
        const L = headLength(k, stick)
        const back = fromMachine(k, { first: s.a1, second: s.a2 }, [s.x, s.y, s.z], L)
        // the pose's tip, carried back onto the part by the table's turn, is the kinematics' tip
        const t2 = p.links.table2
        const rel = [p.tip[0] - t2.t[0], p.tip[1] - t2.t[1], p.tip[2] - t2.t[2]]
        const inPart = [0, 1, 2].map((j) => t2.R[0][j] * rel[0] + t2.R[1][j] * rel[1] + t2.R[2][j] * rel[2] - [k.partAt.x, k.partAt.y, k.partAt.z][j])
        worst = Math.max(worst, Math.hypot(inPart[0] - back.tip[0], inPart[1] - back.tip[1], inPart[2] - back.tip[2]))
        const toolPart = [0, 1, 2].map((j) => t2.R[0][j] * p.tool[0] + t2.R[1][j] * p.tool[1] + t2.R[2][j] * p.tool[2])
        worst = Math.max(worst, Math.hypot(toolPart[0] - back.tool[0], toolPart[1] - back.tool[1], toolPart[2] - back.tool[2]))
        // and the forward kinematics land on the programmed axes
        const fwd = toMachine(k, { first: s.a1, second: s.a2 }, back.tip, L)
        worst = Math.max(worst, Math.hypot(fwd.xyz[0] - s.x, fwd.xyz[1] - s.y, fwd.xyz[2] - s.z))
        // the head turns about its pivot: the pivot is stick-out + pivot length up the tool from the tip
        if (k.layout !== 'table-table') {
          const P = [p.tip[0] + p.tool[0] * (stick + k.pivot), p.tip[1] + p.tool[1] * (stick + k.pivot), p.tip[2] + p.tool[2] * (stick + k.pivot)]
          worst = Math.max(worst, Math.hypot(P[0] - p.pivot[0], P[1] - p.pivot[1], P[2] - p.pivot[2]))
        }
      }
      expect(rotations(k, 0, 0).h2).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]])
    }
    say(`3 layouts x 300 random poses: tip, tool direction and axes agree with the 3+2 kinematics within ${worst.toExponential(1)} mm`)
    expect(worst).toBeLessThan(1e-9)
  })

  it('invented machine parts for each layout carry a placeholder flag; the N-200 has a gantry and a head', () => {
    const n200 = defaultBodies(machineModelOf(PLACEHOLDER_MACHINE))
    expect(n200.map((b) => b.name)).toEqual(['Gantry beam', 'Gantry leg (front)', 'Gantry leg (back)', 'Y carriage', 'Head plate', 'Spindle motor', 'Vertical drill block'])
    expect(n200.every((b) => b.placeholder)).toBe(true)
    for (const m of MACHINES_32()) {
      const b = bodiesOf(machineModelOf(m))
      expect(b.some((x) => x.link === 'head2' || x.link === 'table2')).toBe(true)
    }
    // a Configure badge while invented (the simulator's list, not the export's machine-model warning)
    const m = structuredClone(PLACEHOLDER_MACHINE)
    const item = bodiesItem(m)!
    expect(item.key).toBe('bodies:machine')
    expect(item.group).toBe('Machine parts')
    expect(machineUnconfirmed(m).some((u) => u.key === 'bodies:machine')).toBe(true)
    confirmKey(m, 'bodies:machine')
    expect(bodiesItem(m)).toBeNull()
    expect(machineModelOf(m).bodies!.map((b) => b.name)).toEqual(n200.map((b) => b.name))
    expect(machineModelOf(m).bodies!.some((b) => b.placeholder)).toBe(false)
  })
})

describe('M3.6 replay of the toolpaths on the N-200 (3-axis)', () => {
  it('every cutting move is played with the part on the table; the tool change comes first; times rise', () => {
    const part = pocketPart([])
    const paths = generatePart(part, PLACEHOLDER_MACHINE)
    const r = replayToolpaths(paths, part, PLACEHOLDER_MACHINE)
    expect(r.problems).toEqual([])
    expect(r.letters).toBeNull()
    expect(r.partAt).toEqual([0, 0, 19])
    // first: up to the tool change, the change, over the first point, down
    expect(r.steps[0].link).toBe(true)
    expect(r.steps.find((s) => s.kind === 'change')).toBeTruthy()
    for (let i = 1; i < r.steps.length; i++) {
      expect(r.steps[i].t0).toBeCloseTo(r.steps[i - 1].t1, 9)
      expect(r.steps[i].from).toEqual(r.steps[i - 1].to)
    }
    // the cutting moves are the toolpath's straight moves (arcs within 0.01 mm), moved by where the part sits
    const feeds = r.steps.filter((s) => s.kind === 'feed')
    const straight = straightMoves(paths[0], 0.01).filter((m) => m.t === 'feed') as { x: number; y: number; z: number }[]
    expect(feeds.length).toBe(straight.length)
    let worst = 0
    feeds.forEach((s, i) => (worst = Math.max(worst, Math.hypot(s.to.x - straight[i].x, s.to.y - straight[i].y, s.to.z - 19 - straight[i].z))))
    expect(worst).toBeLessThan(1e-9)
    // and the toolpath's true arcs (0.001 mm chords) lie within 0.01 mm of the moves replayed
    const segDist = (p: { x: number; y: number; z: number }, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => {
      const d = [b.x - a.x, b.y - a.y, b.z - a.z]
      const L = d[0] ** 2 + d[1] ** 2 + d[2] ** 2
      const k = L > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * d[0] + (p.y - a.y) * d[1] + (p.z - a.z) * d[2]) / L)) : 0
      return Math.hypot(a.x + d[0] * k - p.x, a.y + d[1] * k - p.y, a.z + d[2] * k - p.z)
    }
    let off = 0
    for (const q of partFrameMoves(paths[0]).moves.filter((m) => m.t === 'feed') as { x: number; y: number; z: number }[]) {
      const p = { x: q.x, y: q.y, z: q.z + 19 }
      off = Math.max(off, Math.min(...feeds.map((s) => segDist(p, s.from, s.to))))
    }
    expect(off).toBeLessThan(0.0101)
    // the replay's position mid-step is between its ends
    const mid = r.steps[Math.floor(r.steps.length / 2)]
    const at = replayAt(r, (mid.t0 + mid.t1) / 2)
    expect(at.s.x).toBeCloseTo((mid.from.x + mid.to.x) / 2, 6)
  })
})

describe('M3.6 acceptance: a deliberate head-into-clamp is caught', () => {
  // the finishing pass runs at x 156 with the tip at -10 (z 9 on the machine): the gauge point is
  // 50 above the tip, the motor (radius 75) starts 70 above that, at 110 above face 1 (machine z 129)
  it('N-200, a tall clamp 40 mm from the tool: the holder clears it (the cutting check is clean) but the spindle motor hits it; 0.05 mm lower it is clear', () => {
    const m = motorOnly()
    const tall = clamp(196 + 20, 90, 40, 140, 19 + 110 + 1.95, -19)
    const part = pocketPart([tall])
    const paths = generatePart(part, m)
    expect(partCollisions(part, paths, m).found).toEqual([])
    const hits = machineHits(part, m, paths)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((h) => h.kind === 'fixture')).toBe(true)
    expect(hits[0].mover).toBe('Spindle motor')
    expect(hits[0].other).toBe('fixture "Clamp A"')
    say(`N-200 head into a clamp: ${hits[0].message}`)
    // the motor's underside comes to 110 above face 1 at the deepest: a clamp topping 110 - 2.05 is clear
    expect(machineHits(pocketPart([clamp(196 + 20, 90, 40, 140, 19 + 110 - 2.05, -19)]), m, paths)).toEqual([])
    expect(machineHits(pocketPart([clamp(196 + 20, 90, 40, 140, 19 + 110 - 1.95, -19)]), m, paths).length).toBeGreaterThan(0)
    // and further off than the motor's radius plus the margin (156 + 77.05): clear however tall
    expect(machineHits(pocketPart([clamp(156 + 77.05 + 20, 90, 40, 140, 300, -19)]), m, paths)).toEqual([])
  })

  it('N-200 with its invented parts: a tall clamp beside the pocket is caught by a head part, a low one is not', () => {
    const tall = machineHits(pocketPart([clamp(196 + 20, 90, 40, 140, 200, -19)]), PLACEHOLDER_MACHINE)
    expect(tall.length).toBeGreaterThan(0)
    expect(tall[0].kind).toBe('fixture')
    say(`N-200 (invented parts), tall clamp: ${tall[0].message}`)
    expect(machineHits(pocketPart([clamp(196 + 20, 90, 40, 140, 30, -19)]), PLACEHOLDER_MACHINE)).toEqual([])
  })

  it('3+2 fork head: drilling the 45° chamfer, the spindle housing swings into a clamp beside the block', () => {
    const { part } = blockPart({ ops: 'holes' })
    const m = machine32('head-head', 'C', 'B')
    const paths = generatePart(part, PLACEHOLDER_MACHINE)
    // the clamp stands on the table right of the block (part x 260..300), 150 above its top, under
    // the head as it tilts 45° to drill the chamfer
    // (the cutting check also reports it: above the holder it counts the tool's last radius all the
    // way up; the machine replay names the part of the head that hits)
    const tall = clamp(280, 50, 40, 100, 210, -60)
    const withClamp = { ...part, fixtures: [tall] }
    const r = replayToolpaths(paths, withClamp, m)
    expect(r.problems).toEqual([])
    expect(r.letters).toEqual(['C', 'B'])
    const hits = machineCollisions(r, withClamp, m)
    const fx = hits.filter((h) => h.kind === 'fixture')
    expect(fx.length).toBeGreaterThan(0)
    expect(fx.some((h) => h.mover === 'Spindle housing')).toBe(true)
    const h = fx.find((x) => x.mover === 'Spindle housing')!
    // it happens with the head tilted 45° towards the clamp (C0 B45)
    expect(Math.abs(h.s.a2)).toBeCloseTo(45, 6)
    say(`3+2 fork head into a clamp: ${h.message}`)
    // the clamp moved 300 mm further right: clear
    const far = { ...part, fixtures: [{ ...tall, at: { ...tall.at, x: 580 } }] }
    expect(machineCollisions(replayToolpaths(paths, far, m), far, m).filter((x) => x.kind === 'fixture')).toEqual([])
  }, 60_000)

  it('a tall clamp between the tool change and the part is hit on the way, between operations', () => {
    const m = motorOnly()
    // the head comes from the tool change (X 0, Y 0, Z 150) to the pocket at the motor's height
    const block = clamp(60, 60, 40, 40, 19 + 150, -19, 'Tall block')
    const hits = machineHits(pocketPart([block]), m)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].message).toMatch(/between operations/)
    say(`on the way from the tool change: ${hits[0].message}`)
  })

  it('an axis past its travel is reported with the value', () => {
    const part = pocketPart([])
    const r = replayToolpaths(generatePart(part, PLACEHOLDER_MACHINE), part, PLACEHOLDER_MACHINE, { at: { x: 3600, y: 0 } })
    const t = machineCollisions(r, part, PLACEHOLDER_MACHINE).filter((h) => h.kind === 'travel')
    expect(t.length).toBe(1)
    expect(t[0].mover).toBe('X')
    expect(t[0].value!).toBeCloseTo(3600 + 156, 3)
    expect(t[0].message).toMatch(/X goes to 3756\.000, beyond its travel \(0 to 3658 mm\)/)
  })
})

const POST32 = fs.readFileSync(path.resolve(import.meta.dirname, '../examples/plugins/positional-3plus2-post.js'), 'utf8')
const install = (code: string, grants: PluginRecord['grants'] = {}): PluginRecord => ({ ...pluginRecord(code, 'test', '2026-10-07T00:00:00.000Z'), grants, enabled: true })

describe('M3.6 replay from the post output', () => {
  it("the sample 3+2 post's G-code read back as machine axes plays every move of the toolpaths, and the clamp is caught from it too", async () => {
    const d: AppData = data((x) => (x.settings.features = { ...x.settings.features, scriptPostOutput: true, positionalPostOutput: true }))
    const setup = newMachineSetup(d, { name: '5-axis router head-head', from: 'main' })
    const t = machine32('head-head', 'C', 'B')
    setup.profile = { ...setup.profile, model: t.model, physical: t.physical }
    setup.post = { kind: 'script', plugin: 'positional-3plus2-post', post: 'positional-3plus2' }
    d.machines = [setup]
    const h = await PluginHost.start(install(POST32))
    d.plugins = [{ ...install(POST32, { machineOutput: true }), contributes: h.contributes }]
    const { part } = blockPart()
    const plan = planPartPost(d, setup.id, part)
    expect(plan.writable).toBe(true)
    const text = (await runScriptPost(h, 'positional-3plus2', plan.input)).text
    h.dispose()
    const axes = readGcodeAxes(text, ['C', 'B'])
    expect(axes.errors).toEqual([])
    expect(axes.blocks.some((b) => b.machine?.set.includes('Z'))).toBe(true)
    const m = setup.profile
    const fromText = replayProgram(text, part, m)
    expect(fromText.source).toBe('program')
    expect(fromText.problems).toEqual([])
    // G53 Z0: the top of the Z travel
    const zMax = machineModelOf(m).axes.find((a) => a.id === 'Z')!.max
    expect(fromText.steps.some((s) => Math.abs(s.to.z - zMax) < 1e-9)).toBe(true)
    // every cutting point of the toolpaths is played (3 decimals written)
    const k = kinOf(machineModelOf(m))!
    const tips = fromText.steps.filter((s) => s.kind === 'feed').map((s) => {
      const p = machinePose(k, s.to, fromText.ops[s.op].stickOut)
      return [p.tip[0] - k.partAt.x, p.tip[1] - k.partAt.y, p.tip[2] - k.partAt.z]
    })
    let worst = 0
    let n = 0
    for (const tp of plan.toolpaths)
      for (const q of partFrameMoves(tp).moves) {
        if (q.t !== 'feed') continue
        n++
        worst = Math.max(worst, Math.min(...tips.map((p) => Math.hypot(p[0] - q.x, p[1] - q.y, p[2] - q.z))))
      }
    say(`3+2 post output (fork head C/B) read back: ${fromText.steps.length} steps, ${n} cutting points played within ${worst.toFixed(4)} mm`)
    expect(n).toBeGreaterThan(500)
    expect(worst).toBeLessThan(0.005)
    // the head into the clamp, found from the program text
    const withClamp = { ...part, fixtures: [clamp(280, 50, 40, 100, 210, -60)] }
    const hits = machineCollisions(replayProgram(text, withClamp, m), withClamp, m).filter((x) => x.kind === 'fixture')
    expect(hits.some((x) => x.mover === 'Spindle housing')).toBe(true)
    expect(hits[0].message).toMatch(/line \d+/)
  }, 120_000)

  it("the N-200's own woodWOP program for the part, read back, replays on the machine and finds the head-into-clamp", () => {
    const m = motorOnly()
    const part = pocketPart([clamp(196 + 20, 90, 40, 140, 19 + 110 + 1.95, -19)])
    const paths = generatePart(part, m)
    const mpr = writePartMpr(part, paths, m, 'MDF19')
    const r = replayProgram(mpr, part, m)
    expect(r.source).toBe('program')
    expect(r.letters).toBeNull()
    const hits = machineCollisions(r, part, m)
    expect(hits.some((x) => x.kind === 'fixture' && x.mover === 'Spindle motor')).toBe(true)
  })
})

describe('M3.6 5-axis and table machines in the replay', () => {
  it('a table-table machine turns the part and its clamps with the table: the clamp stays put on the part', () => {
    const m = machine32('table-table', 'A', 'C')
    const { part } = blockPart({ ops: 'holes' })
    const k = kinOf(machineModelOf(m)) as PositionalKinematics
    const s = { x: 0, y: 0, z: 0, a1: 30, a2: 60 }
    const p = machinePose(k, s, 50)
    // a point of the part turned with the table: as the kinematics turn it
    const corner = [120, 100, 0]
    const viaPose = [0, 1, 2].map((i) => p.links.table2.t[i] + p.links.table2.R[i][0] * (corner[0] + k.partAt.x) + p.links.table2.R[i][1] * (corner[1] + k.partAt.y) + p.links.table2.R[i][2] * (corner[2] + k.partAt.z))
    const viaKin = toMachine(k, { first: 30, second: 60 }, corner, 0).tip
    expect(Math.hypot(viaPose[0] - viaKin[0], viaPose[1] - viaKin[1], viaPose[2] - viaKin[2])).toBeLessThan(1e-9)
    // the replay on it: no problems, every hole drilled
    const r = replayToolpaths(generatePart(part, PLACEHOLDER_MACHINE), part, m)
    expect(r.problems).toEqual([])
    expect(r.steps.some((x) => Math.abs(x.to.a1) > 1)).toBe(true)
  })

  it('a 5-axis program on a fork head without tip control: every point of the toolpath is played by the replayed axes (within 0.01 mm)', () => {
    const z = -20 + Math.sqrt(400 - 225)
    const { part, op } = hemiPart([curve3('lat', [[25, 40, z], [40, 25, z], [55, 40, z]])], { geometry: ['lat'], toolId: 't106', axis: { mode: 'through-point', lead: 0, tilt: 0, toward: 0, point: { x: 40, y: 40, z: 80 }, dir: { x: 1, y: 0, z: 0 }, maxTilt: 60 } }, 'curve')
    const tp = gen5(part, op)
    const m = machine5('head-head', 'C', 'B', { tcp: false })
    const r = replayToolpaths([tp], part, m)
    expect(r.problems).toEqual([])
    const k = kinOf(machineModelOf(m))!
    const tips = r.steps.filter((s) => s.kind === 'feed').map((s) => machinePose(k, s.to, r.ops[s.op].stickOut).tip.map((v, i) => v - [k.partAt.x, k.partAt.y, k.partAt.z][i]))
    let worst = 0
    for (const { p } of cutPoints(tp)) worst = Math.max(worst, Math.min(...tips.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]))))
    say(`5-axis along a curve on the dome, fork head C/B (pivot 150): ${r.steps.length} steps, every toolpath point played within ${worst.toFixed(4)} mm; the rotary axes turn while cutting`)
    expect(worst).toBeLessThan(0.01)
    expect(r.steps.some((s) => s.kind === 'feed' && Math.abs(s.to.a2 - s.from.a2) > 1e-6)).toBe(true)
  })

  it('the N-200 cannot replay tilted work: said, and the flat work replays', () => {
    const { part } = blockPart({ ops: 'holes' })
    const r = replayToolpaths(generatePart(part, PLACEHOLDER_MACHINE), part, PLACEHOLDER_MACHINE)
    expect(r.problems.join(' ')).toMatch(/no rotary axes/)
  })
})
