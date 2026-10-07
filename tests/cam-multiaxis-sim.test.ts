/**
 * M3.5b simultaneous 5-axis kinematics and simulation: our own conversion to machine axes (both
 * solutions, head flip NEW-26, poles, axes never wrapped, moves split until the machine's even axis
 * motion keeps the tip on them), the kinematic replay, the tilted-tool stock with a tool direction
 * on every move, and the check of the axis turn between operations (the M3.4 limit closed).
 */
import { describe, expect, it } from 'vitest'
import { angleDeg, len, sub, unit, type V3 } from '@/cam/multiaxis/axis'
import { poleOf, replaySimultaneous, simultaneousProgram } from '@/cam/multiaxis/kinematics5'
import { axisNodes } from '@/cam/multiaxis/result'
import { fromMachine, solveAngles } from '@/cam/positional/kinematics'
import { positionalCollisions, positionalStock, positionalTimeline } from '@/cam/positional/sim'
import type { Move, Toolpath } from '@/cam/toolpath'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import { PLACEHOLDER_N200_MODEL, PLACEHOLDER_POSITIONAL, withPositional, withSimultaneous } from '@/core/machineModel'
import type { MachineProfile } from '@/core/types'
import { hemisphere } from './surfaces'
import { blockPart5, curve3, cutPoints, gen5, hemiPart, machine5 } from './multiaxis-fixtures'
import { BLANK, BLOCK, blockPart } from './positional-fixtures'
import { generatePart } from '@/cam/toolpath'

const say = (s: string) => process.stdout.write(`  [5-axis sim] ${s}\n`)

/** A bare 5-axis toolpath from points and directions (one cutting chain, in and out along the tool). */
function path5(pts: V3[], axes: V3[], patch: Partial<Toolpath['multiAxis']> = {}): Toolpath {
  const moves: Move[] = [{ t: 'rapid', x: pts[0][0] + axes[0][0] * 20, y: pts[0][1] + axes[0][1] * 20, z: pts[0][2] + axes[0][2] * 20, a: axes[0] }]
  pts.forEach((p, i) => moves.push({ t: 'feed', x: p[0], y: p[1], z: p[2], f: i ? 'cut' : 'plunge', a: axes[i] }))
  const n = pts.length - 1
  moves.push({ t: 'rapid', x: pts[n][0] + axes[n][0] * 20, y: pts[n][1] + axes[n][1] * 20, z: pts[n][2] + axes[n][2] * 20, a: axes[n] })
  const tool = PLACEHOLDER_MACHINE.tools.find((t) => t.id === 't105')!
  return { opId: 'p', kind: 'multiaxis', name: '5-axis test path', tool, feeds: { rpm: 18000, feed: 3000, plunge: 1000 }, moves, intents: [], warnings: [], stats: { cut: 0, rapid: 0, minutes: 0 }, multiAxis: { engine: 'test', engineName: 'test', licensed: true, preview: false, strategy: 'curve', headFlip: 'auto', maxTilt: 0, maxTurn: 0, gouge: null, ...patch } }
}

/** A cone of tool directions round vertical, `turns` times round, tilted `tilt` degrees; tips on a small circle. */
function cone(turns: number, tilt: number, n = 180): { pts: V3[]; axes: V3[] } {
  const pts: V3[] = []
  const axes: V3[] = []
  for (let i = 0; i <= n; i++) {
    const t = (2 * Math.PI * turns * i) / n
    pts.push([60 + 10 * Math.cos(t), 40 + 10 * Math.sin(t), -5])
    axes.push(unit([Math.sin((tilt * Math.PI) / 180) * Math.cos(t), Math.sin((tilt * Math.PI) / 180) * Math.sin(t), Math.cos((tilt * Math.PI) / 180)]))
  }
  return { pts, axes }
}

describe('M3.5 simultaneous kinematics on the machine model', () => {
  it('every machine move turns back into the asked-for tip and direction (3 layouts, both solutions)', () => {
    const { pts, axes } = cone(1, 30)
    for (const m of [machine5('head-head', 'C', 'B'), machine5('table-table', 'A', 'C'), machine5('table-head', 'C', 'B', { tcp: true })]) {
      const k = m.physical!.positional!
      for (const flip of ['usual', 'other'] as const) {
        const prog = simultaneousProgram([path5(pts, axes, { headFlip: flip })], m)
        expect(prog.problems).toEqual([])
        const op = prog.ops[0]
        expect(op.solution).toBe(flip)
        let worst = 0
        let worstA = 0
        for (const mv of op.moves) {
          const r = fromMachine(k, { first: mv.a1, second: mv.a2 }, [mv.x, mv.y, mv.z], op.L)
          worst = Math.max(worst, len(sub(r.tip, mv.tip)))
          worstA = Math.max(worstA, angleDeg(unit(r.tool), mv.tool))
        }
        expect(worst).toBeLessThan(1e-9)
        expect(worstA).toBeLessThan(1e-7)
      }
    }
  })

  it('head flip: the other solution turns the head the other way round and cuts the same', () => {
    const { pts, axes } = cone(0.25, 40, 30)
    const m = machine5('head-head', 'C', 'B', { tcp: true })
    const u = simultaneousProgram([path5(pts, axes, { headFlip: 'usual' })], m).ops[0]
    const o = simultaneousProgram([path5(pts, axes, { headFlip: 'other' })], m).ops[0]
    // C apart by 180°, B the other sign, the same tip (tool-centre-point control: X Y Z are the tip)
    for (let i = 0; i < u.moves.length; i++) {
      expect(Math.abs(Math.abs(((u.moves[i].a1 - o.moves[i].a1) % 360 + 360) % 360) - 180)).toBeLessThan(1e-6)
      expect(u.moves[i].a2).toBeCloseTo(-o.moves[i].a2, 6)
      expect(Math.hypot(u.moves[i].x - o.moves[i].x, u.moves[i].y - o.moves[i].y, u.moves[i].z - o.moves[i].z)).toBeLessThan(1e-9)
    }
    // auto takes the other one when the usual one leaves the travel (B only from -10° up)
    const tight = machine5('head-head', 'C', 'B', { tcp: true }, { B: [-10, 120] })
    const usualB = u.moves.map((mv) => mv.a2)
    const autoP = simultaneousProgram([path5(pts, axes, { headFlip: 'auto' })], tight)
    if (Math.min(...usualB) < -10) {
      expect(autoP.problems).toEqual([])
      expect(autoP.ops[0].solution).toBe('other')
      expect(autoP.ops[0].notes.join(' ')).toMatch(/Head flip: the usual solution leaves the axes' travel/)
      expect(simultaneousProgram([path5(pts, axes, { headFlip: 'usual' })], tight).problems[0]).toMatch(/cannot reach inside their travel/)
    } else expect(autoP.ops[0].solution).toBe('usual')
  })

  it('axes are never wrapped: a tool going round twice keeps counting, and is refused when the axis is too short', () => {
    const { pts, axes } = cone(2, 25, 240)
    const long = machine5('head-head', 'C', 'B', { tcp: true }, { C: [-36000, 36000] })
    const op = simultaneousProgram([path5(pts, axes)], long).ops[0]
    const cs = op.moves.map((m) => m.a1)
    expect(Math.max(...cs) - Math.min(...cs)).toBeGreaterThan(700)
    for (let i = 1; i < op.moves.length; i++) expect(Math.abs(op.moves[i].a1 - op.moves[i - 1].a1)).toBeLessThan(5)
    const short = machine5('head-head', 'C', 'B', { tcp: true }, { C: [-300, 300] })
    expect(simultaneousProgram([path5(pts, axes)], short).problems[0]).toMatch(/axis would swing \d+\.\d° within one cutting move \(move \d+\): it runs out of travel there, or the tool passes through a pole/)
  })

  it('at a pole the free axis is held: no spin when the tool stands upright', () => {
    const k = machine5('head-head', 'C', 'B', { tcp: true }).physical!.positional!
    expect(poleOf(k, [0, 0, 1])).toBe('first')
    expect(poleOf(k, [0.1, 0, 0.99])).toBe(null)
    // upright, then leaning towards +Y (C must be at ±90 there), then upright again
    const pts: V3[] = Array.from({ length: 21 }, (_, i) => [50 + i, 40, -5])
    const axes: V3[] = pts.map((_, i) => (i < 5 || i > 15 ? [0, 0, 1] : unit([0, Math.sin(((i - 4) * 3 * Math.PI) / 180), Math.cos(((i - 4) * 3 * Math.PI) / 180)])))
    const op = simultaneousProgram([path5(pts, axes)], machine5('head-head', 'C', 'B', { tcp: true })).ops[0]
    const cs = new Set(op.moves.map((m) => Math.round(m.a1 * 1e6) / 1e6))
    // C sits at the leaning value the whole way (held through the upright stretches)
    expect(cs.size).toBe(1)
    expect(Math.abs(Math.abs([...cs][0]) - 90)).toBeLessThan(1e-6)
    expect(solveAngles(k, [0, 0, 1]).length).toBeGreaterThan(0)
  })

  it('moves are split until the machine\'s even axis motion keeps the tip within 0.01 mm of each straight move', () => {
    const { pts, axes } = cone(0.5, 45, 12)
    const m = machine5('head-head', 'C', 'B', { tcp: false })
    const k = m.physical!.positional!
    const op = simultaneousProgram([path5(pts, axes)], m, { tol: 0.01 }).ops[0]
    expect(op.L).toBeGreaterThan(150)
    // replay finely: every played point within 0.01 (plus a little: the split is checked at middles) of the straight moves asked for
    const played = replaySimultaneous(op, k, 0.05)
    const want = axisNodes(path5(pts, axes).moves).filter((n) => n.kind !== 'rapid')
    let worst = 0
    for (const q of played) {
      if (q.t !== 'feed') continue
      let d = Infinity
      for (let i = 1; i < want.length; i++) {
        const a = [want[i - 1].x, want[i - 1].y, want[i - 1].z]
        const b = [want[i].x, want[i].y, want[i].z]
        const ab = sub(b, a)
        const t = Math.max(0, Math.min(1, ((q.x - a[0]) * ab[0] + (q.y - a[1]) * ab[1] + (q.z - a[2]) * ab[2]) / Math.max(1e-12, len(ab) ** 2)))
        d = Math.min(d, len(sub([q.x, q.y, q.z], [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t])))
      }
      worst = Math.max(worst, d)
    }
    say(`cone, 45° tilt, 12 points, fork head C/B without tip control (pivot ${k.pivot} + stick-out): ${op.moves.length} machine moves, played back within ${worst.toFixed(4)} mm of the straight moves`)
    expect(op.moves.length).toBeGreaterThan(14)
    expect(worst).toBeLessThan(0.015)
  })
})

describe('M3.5 machine model: simultaneous 5-axis on the 3+2 axes', () => {
  it('declared only with 3+2 axes; taking the 3+2 axes away takes it too; the N-200 has none', () => {
    const n200 = PLACEHOLDER_MACHINE.physical ?? PLACEHOLDER_N200_MODEL
    expect(withSimultaneous(n200, true).capabilities.simultaneous5).toBe(false)
    const m32 = withPositional(structuredClone(PLACEHOLDER_N200_MODEL), PLACEHOLDER_POSITIONAL)
    const m5 = withSimultaneous(m32, true)
    expect(m5.capabilities).toMatchObject({ positional: true, simultaneous5: true })
    expect(withPositional(m5, null).capabilities).toMatchObject({ positional: false, simultaneous5: false })
    // a program for a machine with 3+2 axes that do not move while cutting is refused with the reason
    const { pts, axes } = cone(0.25, 20, 20)
    const only32 = structuredClone(PLACEHOLDER_MACHINE)
    only32.name = 'Router with 3+2 axes'
    only32.physical = m32
    expect(simultaneousProgram([path5(pts, axes)], only32).problems).toEqual(['Router with 3+2 axes: its machine model does not declare simultaneous 5-axis (its rotary axes do not move while cutting).'])
  })
})

describe('M3.5 simulation with the tool direction on every move', () => {
  it('swarf on a leaning wall: the simulated wall lies on the design within the stock\'s cells; no collisions', () => {
    const lean = (20 * Math.PI) / 180
    const dy = 25 * Math.tan(lean)
    // the rails run from outside the block's ends; the block holds material only on the wall's side,
    // 2 mm proud of it (as left by roughing)
    const { part, op } = blockPart5([curve3('b', [[-10, 20, -25], [130, 20, -25]]), curve3('t', [[-10, 20 + dy, 0], [130, 20 + dy, 0]])], { geometry: ['b'], top: ['t'], toolId: 't102', side: 'right', levels: { safeZ: 20, rapidZ: 3, depth: 0, through: false, stockZ: 0, passDepth: 0 } }, 'swarf')
    const tp = gen5(part, op)
    const n: [number, number, number] = [0, Math.cos(lean), -Math.sin(lean)]
    const stock = positionalStock(part, 0.25)
    stock.setConvex([{ n: [-n[0], -n[1], -n[2]], d: 2 - (n[1] * 20 + n[2] * -25) }])
    const res = positionalCollisions(part, [tp], PLACEHOLDER_MACHINE, { stock })
    expect(res.found.map((c) => c.message)).toEqual([])
    // the Y rays at mid-length: material starts at the wall (the tool cut a slot on its -y side)
    const st = res.stock
    const G = st.grids[1]
    let worst = 0
    let checked = 0
    for (const z of [-24, -20, -15, -10, -5, -1]) {
      for (const x of [30, 60, 90]) {
        const iu = Math.floor(x / 0.25)
        const jv = Math.floor((z + 40) / 0.25)
        const zc = -40 + (jv + 0.5) * 0.25
        const wall = 20 + (zc + 25) * Math.tan(lean)
        const k = jv * G.nu + iu
        const iv = Array.from({ length: G.cnt[k] * 2 }, (_, q) => G.iv[k * G.max * 2 + q])
        // the start of the piece of material at or beyond the wall
        const start = iv.filter((_, q) => q % 2 === 0).find((y) => y > wall - 1)
        expect(start, `material at the wall at x ${x}, z ${z}`).toBeDefined()
        worst = Math.max(worst, Math.abs(start! - wall))
        checked++
      }
    }
    say(`swarf wall leaning 20°, T102 Ø8, 0.25 mm rays: ${checked} wall points within ${worst.toFixed(3)} mm of the design; no collisions`)
    expect(worst).toBeLessThan(0.05)
  })

  it('surface finishing with the ball tilted: the stock is never below the model (no gouge) and the dome is cut', () => {
    const { part, op } = hemiPart([], { toolId: 't105', stepover: 2, axis: { mode: 'surface-normal', lead: 0, tilt: 0, toward: 0, point: { x: 0, y: 0, z: 100 }, dir: { x: 1, y: 0, z: 0 }, maxTilt: 35 } })
    const tp = gen5(part, op)
    // (finishing straight into an unroughed block: the collision check rightly reports the shank in
    // the uncut material; this test is about the surface)
    const res = positionalCollisions(part, [tp], PLACEHOLDER_MACHINE, { cell: 0.5 })
    const st = res.stock
    let below = 0
    let cut = 0
    // (on the dome where it is no steeper than 58°, and on the flat round it: nearer the rim the
    // 0.5 mm facets of the model lie up to 0.14 mm inside the true sphere, and the tool follows the facets)
    for (let x = 1; x <= 79; x += 1.5)
      for (let y = 1; y <= 79; y += 1.5) {
        const cx = (Math.floor(x / 0.5) + 0.5) * 0.5
        const cy = (Math.floor(y / 0.5) + 0.5) * 0.5
        const r = Math.hypot(cx - 40, cy - 40)
        if (r > 17 && r < 23) continue
        const top = st.hf.top[Math.floor(y / 0.5) * st.hf.nx + Math.floor(x / 0.5)]
        below = Math.max(below, hemisphere(cx, cy) - top)
        if (top < -0.5) cut++
      }
    say(`hemisphere finished with the ball tilted (≤ 35°), 0.5 mm rays: deepest below the model ${below.toFixed(4)} mm; ${cut} sampled columns cut`)
    expect(below).toBeLessThan(0.02)
    expect(cut).toBeGreaterThan(500)
  }, 60_000)

  it('a 5-axis program replayed through the machine kinematics plays what the toolpath asks for', () => {
    const { part, op } = hemiPart([curve3('lat', [[25, 40, -20 + Math.sqrt(400 - 225)], [40, 25, -20 + Math.sqrt(400 - 225)], [55, 40, -20 + Math.sqrt(400 - 225)]])], { geometry: ['lat'], toolId: 't106', axis: { mode: 'through-point', lead: 0, tilt: 0, toward: 0, point: { x: 40, y: 40, z: 80 }, dir: { x: 1, y: 0, z: 0 }, maxTilt: 60 } }, 'curve')
    const tp = gen5(part, op)
    const m = machine5('head-head', 'C', 'B', { tcp: false })
    const run = positionalTimeline([tp], part, { replay: m })
    expect(run.program5?.problems).toEqual([])
    // every cutting point of the toolpath is played (within 0.01 mm) by the replayed program
    const played = run.paths[0].moves.filter((q) => q.t === 'feed') as { x: number; y: number; z: number }[]
    let worst = 0
    for (const { p } of cutPoints(tp)) worst = Math.max(worst, Math.min(...played.map((q) => Math.hypot(q.x - p[0], q.y - p[1], q.z - p[2]))))
    expect(worst).toBeLessThan(0.01)
  })
})

describe('M3.5 the axis turn between operations is checked (the M3.4 limit closed)', () => {
  it('a holder far too big for the turn is caught; the test block with the placeholder holder stays clear', () => {
    const { part } = blockPart()
    const m: MachineProfile = structuredClone(PLACEHOLDER_MACHINE)
    const toolpaths = generatePart(part, m)
    // the M3.4 test block: tool backs off, rises clear, turns: no collision
    const blank = () => {
      const st = positionalStock(BLOCK, 0.5)
      st.setConvex(BLANK)
      return st
    }
    const ok = positionalCollisions(part, toolpaths, m, { stock: blank() })
    expect(ok.found.map((c) => c.message)).toEqual([])
    // a holder 200 mm across on the same tools: it sweeps into the block while the axes turn
    m.holders = [...(m.holders ?? []).map((h) => ({ ...h, profile: [{ z: 0, r: 100 }, { z: 40, r: 100 }] }))]
    const bad = positionalCollisions(part, toolpaths, m, { stock: blank() })
    const turn = bad.found.filter((c) => /while the rotary axes turn/.test(c.message))
    say(`test block, holder 200 mm across: ${turn.length} collision(s) while the axes turn, first: ${turn[0]?.message ?? '-'}`)
    expect(turn.length).toBeGreaterThan(0)
  }, 120_000)
})
