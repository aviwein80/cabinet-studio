/**
 * M3.2 thread milling (NEW-08): internal and external threads, pitch, hand, top-down or bottom-up,
 * radial passes, the core hole. Acceptance: the pitch and the depth are exact in the toolpath (the
 * helix drops exactly one pitch per turn and its last pass puts the tooth's tip exactly on the
 * major diameter, internal, or the minor, external, over exactly the thread's length). Also: the
 * simulated groove repeats at the pitch and stops at the major diameter; refusals; badges; the
 * export block; a golden.
 */
import { describe, expect, it } from 'vitest'
import { CAM_FILE_VERSION, makeEntity, newPart, parsePart, serializePart } from '@/cam/doc'
import { isClimb, isoDepth, minorDiameter, threadMoves, turnsCcw } from '@/cam/more25d/thread'
import { defaultOp, resolveTool } from '@/cam/ops'
import { buildTimeline } from '@/cam/sim'
import { needsDexel, piecesNeeded } from '@/cam/stock/choose'
import { DexelStock } from '@/cam/stock/dexel'
import { generateOp, type Move, THREAD_NO_OUTPUT, type Toolpath } from '@/cam/toolpath'
import type { CamOp, CamPart, ThreadOp } from '@/cam/types'
import { opUnconfirmed } from '@/core/confirm'
import { squareEnd } from '@/core/machining'
import { defaultAppData, PLACEHOLDER_MACHINE } from '@/core/defaults'
import { runJob } from '@/core/pipeline'
import type { Job, MachineProfile } from '@/core/types'
import { expectGolden3d } from './finish3d-setup'

const machine = PLACEHOLDER_MACHINE
const C = { x: 15, y: 15 }

function threadPart(patch: Partial<ThreadOp> = {}, r = 5, extra: CamOp[] = [], m: MachineProfile = machine) {
  const part: CamPart = { ...newPart({ name: 'Threads', length: 30, width: 30, thickness: 20, materialId: 'mat-mdf18' }) }
  const hole = makeEntity({ t: 'circle', c: C, r }, 'holes')
  hole.id = 'hole'
  part.entities = [...part.entities, hole]
  const base = defaultOp('thread', ['hole']) as ThreadOp
  const op: ThreadOp = { ...base, toolId: 't109', ...patch, levels: { ...base.levels, ...(patch.levels ?? {}) } }
  part.ops = [...extra, op]
  const tp = generateOp(op, { part, machine: m, done: new Map() })
  return { part, op, tp }
}

/** The helix arcs (around the hole's centre) of a toolpath, with where each starts. */
function helixArcs(tp: Toolpath) {
  const out: { from: { x: number; y: number; z: number }; m: Extract<Move, { t: 'arc' }> }[] = []
  let at = { x: 0, y: 0, z: 0 }
  for (const m of tp.moves) {
    if (m.t === 'poly') continue
    if (m.t === 'arc' && Math.hypot(m.cx - C.x, m.cy - C.y) < 1e-9 && Math.abs(m.z - at.z) > 1e-12) out.push({ from: at, m })
    at = { x: m.x, y: m.y, z: m.z }
  }
  return out
}
const sweepOf = (from: { x: number; y: number }, m: { x: number; y: number; cx: number; cy: number; ccw: boolean }) => {
  let s = Math.atan2(m.y - m.cy, m.x - m.cx) - Math.atan2(from.y - m.cy, from.x - m.cx)
  if (m.ccw) while (s <= 1e-9) s += 2 * Math.PI
  else while (s >= -1e-9) s -= 2 * Math.PI
  return Math.abs(s)
}

describe('M3.2 thread milling: pitch and depth exact in the toolpath', () => {
  it('M10 x 1.5 internal, right-hand, bottom-up, 12 mm long, 2 radial passes: one pitch per turn, the tooth exactly on the major diameter at the last pass', () => {
    const { tp } = threadPart()
    expect(tp.noOutput).toBe(THREAD_NO_OUTPUT)
    expect(tp.tool?.id).toBe('t109')
    const arcs = helixArcs(tp)
    expect(arcs.length).toBeGreaterThan(10)
    const P = 1.5
    const h = isoDepth('internal', P)
    expect(h).toBeCloseTo(0.8119, 4)
    // every helix arc rises exactly its share of the pitch
    let worst = 0
    for (const { from, m } of arcs) {
      expect(m.ccw).toBe(true)
      worst = Math.max(worst, Math.abs(m.z - from.z - (P * sweepOf(from, m)) / (2 * Math.PI)))
    }
    expect(worst).toBeLessThan(1e-9)
    // passes: from -12 up to 0 exactly, at radii out to the major diameter less the tool's radius
    const radii = [...new Set(arcs.map(({ m }) => Math.round(Math.hypot(m.x - C.x, m.y - C.y) * 1e9) / 1e9))]
    expect(radii).toHaveLength(2)
    expect(Math.max(...radii) + 3).toBeCloseTo(5, 9)
    expect(Math.min(...radii) + 3).toBeCloseTo(5 - h / 2, 9)
    for (const R of radii) {
      const pass = arcs.filter(({ m }) => Math.abs(Math.hypot(m.x - C.x, m.y - C.y) - R) < 1e-9)
      expect(pass[0].from.z).toBe(-12)
      expect(pass[pass.length - 1].m.z).toBe(0)
      const turns = pass.reduce((n, a) => n + sweepOf(a.from, a.m), 0) / (2 * Math.PI)
      expect(turns).toBeCloseTo(12 / P, 12)
    }
    // feed set at the tooth's tip: the centre runs R / (R + r) of it inside a hole
    for (const { m } of arcs) {
      const R = Math.hypot(m.x - C.x, m.y - C.y)
      expect(m.k).toBeCloseTo(R / (R + 3), 12)
    }
    expect(isClimb({ side: 'internal', hand: 'right', travel: 'up' })).toBe(true)
    process.stdout.write(`  [thread] M10 x 1.5 internal: ${arcs.length} helix arcs, pitch error ${worst.toExponential(1)} mm, last pass tooth at Ø${((Math.max(...radii) + 3) * 2).toFixed(6)}, ${((12 / P) * 2).toFixed(0)} turns in all\n`)
  })

  it('hand and direction: right-hand top-down turns clockwise (conventional inside), left-hand top-down counter-clockwise; external threads put the tooth on the minor diameter', () => {
    for (const [hand, travel, ccw] of [
      ['right', 'down', false],
      ['right', 'up', true],
      ['left', 'down', true],
      ['left', 'up', false],
    ] as const) {
      expect(turnsCcw({ hand, travel })).toBe(ccw)
      const arcs = helixArcs(threadPart({ hand, travel, passes: 1 }).tp)
      expect(arcs.every(({ m }) => m.ccw === ccw)).toBe(true)
      const z0 = travel === 'down' ? 0 : -12
      expect(arcs[0].from.z).toBe(z0)
      expect(arcs[arcs.length - 1].m.z).toBe(-12 - z0)
    }
    expect(isClimb({ side: 'internal', hand: 'right', travel: 'down' })).toBe(false)
    expect(isClimb({ side: 'external', hand: 'right', travel: 'down' })).toBe(true)
    // external M20 x 1.5 round a boss, 3 passes and a spring pass
    const { tp } = threadPart({ side: 'external', pitch: 1.5, passes: 3, spring: true, toolId: 't109' }, 10)
    const h = isoDepth('external', 1.5)
    const arcs = helixArcs(tp)
    const radii = arcs.map(({ m }) => Math.hypot(m.x - C.x, m.y - C.y))
    expect(Math.min(...radii) - 3).toBeCloseTo(10 - h, 12)
    expect(minorDiameter({ diameter: 20, depth: h }) / 2).toBeCloseTo(Math.min(...radii) - 3, 12)
    // 3 passes + the spring pass at full depth
    expect(new Set(radii.map((r) => r.toFixed(9))).size).toBe(3)
    expect(arcs.filter(({ m }) => Math.abs(Math.hypot(m.x - C.x, m.y - C.y) - Math.min(...radii)) < 1e-9).length).toBe(2 * Math.ceil((2 * 12) / 1.5))
  })

  it('threadMoves on its own: a part turn at the end lands exactly on the thread\'s length', () => {
    const plan = threadMoves({ x: 0, y: 0 }, { side: 'internal', diameter: 12, pitch: 1.75, hand: 'right', travel: 'down', length: 10, depth: isoDepth('internal', 1.75), passes: 1 }, 3, 20, 3)
    const arcs = plan.moves.filter((m): m is Extract<Move, { t: 'arc' }> => m.t === 'arc' && m.cx === 0 && m.cy === 0)
    expect(arcs[arcs.length - 1].z).toBe(-10)
    // 10 / 1.75 = 5.714 turns: 11 half turns and a part turn
    expect(arcs).toHaveLength(12)
  })
})

describe('M3.2 thread milling: simulated, checked, refused when it cannot work', () => {
  it('the simulated groove repeats at the pitch and reaches the major diameter, never past it (dexel stock, 0.05 mm cells)', () => {
    const { tp } = threadPart({ passes: 2 })
    expect(needsDexel([tp])).toBe(true)
    const stock = new DexelStock(30, 30, 20, 0.05, piecesNeeded([tp]))
    expect(stock.max).toBe(Math.ceil((2 * 12) / 1.5 / 2) + 3)
    const h = isoDepth('internal', 1.5)
    const minor = 10 - 2 * h
    // the core hole, drilled first (a flat cutter of the core's radius straight down)
    stock.carve({ x: C.x, y: C.y, z: 0 }, { x: C.x, y: C.y, z: -14 }, { r: minor / 2, shape: 'flat', angle: 0 })
    for (const s of buildTimeline([tp]).segs) if (s.kind !== 'rapid') stock.carve(s.a, s.b, s.cutter)
    // a column halfway up the flank: empty stretches (the groove) every pitch along it
    const rho = (minor / 2 + 5) / 2
    const col = stock.column(Math.floor((C.y + 0.001) / 0.05) * stock.nx + Math.floor((C.x + rho) / 0.05))
    const gaps: number[] = []
    for (let i = 1; i < col.length; i++) if (col[i][0] > -11 && col[i - 1][1] < -1) gaps.push((col[i - 1][1] + col[i][0]) / 2)
    expect(gaps.length).toBeGreaterThan(4)
    const steps = gaps.slice(1).map((g, i) => g - gaps[i])
    for (const s of steps) expect(s).toBeCloseTo(1.5, 1)
    const mean = steps.reduce((a, b) => a + b, 0) / steps.length
    expect(Math.abs(mean - 1.5)).toBeLessThan(0.01)
    // just inside the major diameter the groove is still there; just outside it, solid
    const at = (r: number) => stock.column(Math.floor((C.y + 0.001) / 0.05) * stock.nx + Math.floor((C.x + r) / 0.05))
    expect(at(4.9).length).toBeGreaterThan(4)
    expect(at(5.15)).toEqual([[-20, 0]])
    process.stdout.write(`  [thread] simulated groove at r ${rho.toFixed(3)}: ${gaps.length} turns, mean spacing ${mean.toFixed(4)} mm (pitch 1.5)\n`)
  }, 60_000)

  it('refuses a tool that is not a thread mill, one too big for the core hole, a tooth too short for the depth; asks for the core hole; no circles', () => {
    expect(threadPart({ toolId: 't102' }).tp.warnings[0]).toMatch(/needs a thread mill/)
    expect(resolveTool({ ...(defaultOp('thread') as ThreadOp), toolId: null }, machine)?.id).toBe('t109')
    // M6 x 1: the core hole (4.9) is narrower than the 6 mm tool
    expect(threadPart({ pitch: 1 }, 3).tp.warnings.join(' ')).toMatch(/does not fit the core hole/)
    // M16 x 2: 1.08 mm deep, more than the tooth stands proud of the neck (1 mm)
    expect(threadPart({ pitch: 2 }, 8).tp.warnings.join(' ')).toMatch(/neck would rub/)
    expect(threadPart().tp.warnings.join(' ')).toMatch(/no core hole cut before them/)
    // the neck within the collision margin of the crests: said up front (the check itself is unchanged)
    expect(threadPart().tp.warnings.join(' ')).toMatch(/neck passes 0\.19 mm from the thread's crests, inside the collision check's 2 mm safety margin/)
    // with a pocket on a core-hole circle first, no such warning
    const core = makeEntity({ t: 'circle', c: C, r: (10 - 2 * isoDepth('internal', 1.5)) / 2 }, 'holes')
    const { tp } = threadPartWith(core)
    expect(tp.warnings.join(' ')).not.toMatch(/no core hole/)
    const none = threadPart()
    const op = { ...none.op, geometry: [] }
    expect(generateOp(op, { part: { ...none.part, ops: [op] }, machine }).warnings.join(' ')).toMatch(/Pick the circles/)
  })

  it('placeholders show Configure (the passes; the thread mill); never written to woodWOP, even with every switch on', () => {
    const { part, op } = threadPart()
    const keys = opUnconfirmed(op, part, machine, machine.tools.find((t) => t.id === 't109')!).map((u) => u.key)
    expect(keys).toEqual(expect.arrayContaining([`op:${op.id}:threadPasses`, 'tool:t109:data']))
    const data = defaultAppData()
    const job: Job = { id: 'j', number: 'JT', name: 'Threads', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [part] }
    data.jobs = [job]
    data.settings.features = { ...data.settings.features, camMprOutput: true, cam3dMprOutput: true, cam25dMprOutput: true }
    const issues = runJob(job, data).issues.filter((i) => i.code === 'CAM_NO_OUTPUT')
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toMatch(/helical/)
    // saved and read back
    const back = parsePart(serializePart(part))
    expect(back.version).toBe(CAM_FILE_VERSION)
    expect(back.ops).toEqual(part.ops)
  })

  it('the thread mill is never picked on its own for flat-bottomed work (pockets, engraving, edges, facing, flat areas)', () => {
    const t109 = machine.tools.find((t) => t.id === 't109')!
    expect(squareEnd(t109)).toBe(false)
    for (const kind of ['pocket', 'engrave', 'edge', 'manual', 'face', 'curve', 'profile'] as const) expect(resolveTool({ ...defaultOp(kind), toolId: null } as CamOp, machine)?.shape).not.toBe('thread')
    expect(resolveTool({ ...defaultOp('finish3d'), strategy: 'flat', toolId: null } as CamOp, machine)?.shape).not.toBe('thread')
    // even on a machine whose only router other than the thread mill is a ball-nose
    const lean: MachineProfile = { ...machine, tools: machine.tools.filter((t) => t.type !== 'router' || t.shape === 'thread' || t.shape === 'ball'), cutoutToolNumber: -1 }
    for (const kind of ['pocket', 'engrave', 'face'] as const) expect(resolveTool({ ...defaultOp(kind), toolId: null } as CamOp, lean)?.shape).not.toBe('thread')
  })

  it('golden: M10 x 1.5 internal bottom-up, 2 passes', () => expectGolden3d('thread-m10-internal', threadPart().tp))
})

function threadPartWith(core: ReturnType<typeof makeEntity>) {
  const part: CamPart = { ...newPart({ name: 'Threads', length: 30, width: 30, thickness: 20, materialId: 'mat-mdf18' }) }
  const hole = makeEntity({ t: 'circle', c: C, r: 5 }, 'holes')
  part.entities = [...part.entities, hole, core]
  const pocket = defaultOp('pocket', [core.id], { levels: { ...defaultOp('pocket').levels, depth: 13 } } as Partial<CamOp>)
  const op = { ...(defaultOp('thread', [hole.id]) as ThreadOp), toolId: 't109' }
  part.ops = [pocket, op]
  return { part, tp: generateOp(op, { part, machine }) }
}
