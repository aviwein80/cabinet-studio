/**
 * M2.6a: saw cuts (2D-11) and facing (2D-16), with the export checker's saw-unit, switch and
 * neighbour checks.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeEntity, newPart, opInputHash, opState } from '../src/cam/doc'
import { polyline, pt, rect } from '../src/cam/geom'
import { writePartMpr } from '../src/cam/mpr'
import { readMpr } from '../src/cam/mprRead'
import { DEFAULT_SAW, defaultOp, PLACEHOLDER_BLADE, resolveTool } from '../src/cam/ops'
import { cutFloor, insideInterval, joinCollinear, planSawCuts, runOut } from '../src/cam/more25d/saw'
import { buildTimeline, carve, createHeightfield, heightAt } from '../src/cam/sim'
import { generateOp, generatePart, simpleMoves, type Toolpath } from '../src/cam/toolpath'
import type { CamOp, CamPart, FaceOp, SawOp } from '../src/cam/types'
import { defaultAppData, PLACEHOLDER_MACHINE } from '../src/core/defaults'
import { PLACEHOLDER_N200_MODEL } from '../src/core/machineModel'
import { runJob } from '../src/core/pipeline'
import type { AppData, Job, MachineProfile } from '../src/core/types'
import { digest } from './cam-digest'
import { faceParts, sawParts } from './cam-reference-25d'

const machine = PLACEHOLDER_MACHINE

/** The placeholder machine with a saw unit declared and a 200 mm blade with a 4 mm kerf. */
function sawMachine(base: MachineProfile = machine, blade = 200): MachineProfile {
  const m = structuredClone(base)
  m.physical = { ...structuredClone(PLACEHOLDER_N200_MODEL), capabilities: { ...PLACEHOLDER_N200_MODEL.capabilities, saw: true } }
  for (const t of m.tools) if (t.type === 'saw') Object.assign(t, { kerf: 4, bladeDiameter: blade })
  return m
}

function simulate(part: CamPart, paths: Toolpath[], cell = 0.25) {
  const hf = createHeightfield(part.length, part.width, part.thickness, cell)
  const tl = buildTimeline(paths)
  carve(hf, tl, 0, tl.total)
  return hf
}

function sawPart(lines: [number, number, number, number][], saw: Partial<SawOp['saw']> = {}, depth = 8, size: [number, number, number] = [400, 200, 19]) {
  const part = newPart({ name: 'Saw', length: size[0], width: size[1], thickness: size[2], entities: [] })
  const outline = makeEntity({ t: 'contour', c: rect(0, 0, size[0], size[1]) }, 'outline')
  const es = lines.map(([x0, y0, x1, y1]) => makeEntity({ t: 'contour', c: polyline([pt(x0, y0), pt(x1, y1)], false) }, 'machining'))
  part.entities = [outline, ...es]
  part.outlineId = outline.id
  const op = defaultOp('saw', es.map((e) => e.id), { saw: { ...DEFAULT_SAW, ...saw }, levels: { safeZ: 20, rapidZ: 3, depth, through: false, stockZ: 0, passDepth: 0 } } as Partial<CamOp>) as SawOp
  part.ops = [op]
  return { part, op }
}

describe('saw cuts: geometry', () => {
  it('run-out of a blade is the chord half-length at the surface', () => {
    // 200 mm blade, 8 mm deep: sqrt(2*100*8 - 64)
    expect(runOut(100, 8)).toBeCloseTo(Math.sqrt(1536), 12)
    expect(runOut(100, 0)).toBe(0)
    expect(runOut(100, 100)).toBe(100)
  })

  it('joins lines on one line that touch or overlap, in either direction, and keeps others apart', () => {
    const j = joinCollinear([
      { a: pt(0, 20), b: pt(300, 20) },
      { a: pt(600, 20), b: pt(299.995, 20) },
      { a: pt(0, 380), b: pt(200, 380) },
      { a: pt(250, 380), b: pt(400, 380) },
      { a: pt(0, 20.5), b: pt(100, 20.5) },
    ])
    expect(j).toHaveLength(4)
    expect(j[0]).toEqual({ a: pt(0, 20), b: pt(600, 20) })
    expect(j[1]).toEqual({ a: pt(0, 380), b: pt(200, 380) })
    expect(j[2]).toEqual({ a: pt(250, 380), b: pt(400, 380) })
    // a diagonal chain
    const d = joinCollinear([
      { a: pt(0, 0), b: pt(10, 10) },
      { a: pt(20, 20), b: pt(10, 10) },
      { a: pt(20, 20), b: pt(30, 30) },
    ])
    expect(d).toHaveLength(1)
    expect(d[0].a.x).toBeCloseTo(0, 9)
    expect(d[0].b.y).toBeCloseTo(30, 9)
  })

  it('finds where a line is inside a polygon', () => {
    const sq = [pt(0, 0), pt(100, 0), pt(100, 50), pt(0, 50)]
    expect(insideInterval(sq, pt(-20, 10), pt(1, 0), 50)).toEqual([20, 120])
    expect(insideInterval(sq, pt(-20, 60), pt(1, 0), 50)).toBeNull()
  })

  it('extend to clear: full depth to both ends, run-out past them; off: the surface cut stays on the line', () => {
    const s = runOut(100, 8)
    const base = { R: 100, depth: 8, tilt: 0, tiltSide: 'left' as const, extend: 0, minLength: 0, join: false, avoid: false, outline: [] }
    const clear = planSawCuts([{ a: pt(50, 50), b: pt(350, 50) }], { ...base, clear: true })
    expect(clear.cuts[0].a).toEqual(pt(50, 50))
    expect(clear.cuts[0].b).toEqual(pt(350, 50))
    expect(clear.cuts[0].surf[0].x).toBeCloseTo(50 - s, 9)
    expect(clear.cuts[0].surf[1].x).toBeCloseTo(350 + s, 9)
    expect(clear.cuts[0].short).toBe(0)
    const stay = planSawCuts([{ a: pt(50, 50), b: pt(350, 50) }], { ...base, clear: false })
    expect(stay.cuts[0].surf[0].x).toBeCloseTo(50, 9)
    expect(stay.cuts[0].surf[1].x).toBeCloseTo(350, 9)
    expect(stay.cuts[0].short).toBeCloseTo(2 * s, 9)
    // extra length at each end
    const ext = planSawCuts([{ a: pt(50, 50), b: pt(350, 50) }], { ...base, clear: true, extend: 5 })
    expect(ext.cuts[0].a.x).toBeCloseTo(45, 9)
    expect(ext.cuts[0].b.x).toBeCloseTo(355, 9)
  })

  it('avoid neighbours: the blade never cuts outside the outline, and the short ends are reported', () => {
    const s = runOut(100, 8)
    const outline = [pt(0, 0), pt(400, 0), pt(400, 200), pt(0, 200)]
    const p = planSawCuts([{ a: pt(0, 100), b: pt(400, 100) }], { R: 100, depth: 8, tilt: 0, tiltSide: 'left', clear: true, extend: 0, minLength: 0, join: false, avoid: true, outline })
    expect(p.cuts[0].surf[0].x).toBeCloseTo(0, 9)
    expect(p.cuts[0].surf[1].x).toBeCloseTo(400, 9)
    expect(p.cuts[0].a.x).toBeCloseTo(s, 9)
    expect(p.warnings.join(' ')).toMatch(/pulled back/)
    // too short for the run-out at both ends
    const q = planSawCuts([{ a: pt(0, 100), b: pt(60, 100) }], { R: 100, depth: 8, tilt: 0, tiltSide: 'left', clear: true, extend: 0, minLength: 0, join: false, avoid: true, outline: [pt(0, 0), pt(60, 0), pt(60, 200), pt(0, 200)] })
    expect(q.cuts).toEqual([])
    expect(q.warnings.join(' ')).toMatch(/too short for the blade/)
  })

  it('angled cut: the floor sits beside the line by depth x tan(tilt), the run-out grows with depth along the blade', () => {
    const p = planSawCuts([{ a: pt(50, 100), b: pt(350, 100) }], { R: 100, depth: 10, tilt: 30, tiltSide: 'right', clear: true, extend: 0, minLength: 0, join: false, avoid: false, outline: [] })
    const c = p.cuts[0]
    expect(c.floorOffset.x).toBeCloseTo(0, 12)
    expect(c.floorOffset.y).toBeCloseTo(-10 * Math.tan(Math.PI / 6), 12)
    expect(p.runout).toBeCloseTo(runOut(100, 10 / Math.cos(Math.PI / 6)), 12)
    const floor = cutFloor(c, 100, 30)
    const deepest = floor.reduce((m, q) => Math.min(m, q.z), 0)
    expect(deepest).toBeCloseTo(-10, 9)
    for (const q of floor) expect(q.y).toBeCloseTo(100 + (q.z / 10) * 10 * Math.tan(Math.PI / 6), 9)
  })

  it('the floor is the blade arc: at distance e past the full-depth end it is R - sqrt(R² - e²) higher', () => {
    const p = planSawCuts([{ a: pt(50, 50), b: pt(350, 50) }], { R: 100, depth: 8, tilt: 0, tiltSide: 'left', clear: true, extend: 0, minLength: 0, join: false, avoid: false, outline: [] })
    for (const q of cutFloor(p.cuts[0], 100, 0)) {
      const e = q.x > 350 ? q.x - 350 : q.x < 50 ? 50 - q.x : 0
      expect(q.z).toBeCloseTo(Math.min(0, -8 + 100 - Math.sqrt(100 * 100 - e * e)), 9)
    }
  })
})

describe('saw cuts: toolpaths, simulation and output', () => {
  it('the simulated cut matches the blade: full depth along the line, the blade arc at the ends, nothing past the run-out', () => {
    const m = sawMachine()
    const { part } = sawPart([[100, 100, 300, 100]], { avoid: false })
    const [tp] = generatePart(part, m)
    const hf = simulate(part, [tp])
    const s = runOut(100, 8)
    for (let x = 100; x <= 300; x += 5) expect(heightAt(hf, x, 100)).toBeCloseTo(-8, 3)
    // the simulator cuts with a round cutter as wide as the kerf (2 mm radius), so at a distance e
    // past the end it shows the blade's floor somewhere between e - 2 and e
    const floorAt = (e: number) => Math.min(0, -8 + 100 - Math.sqrt(100 * 100 - Math.max(0, e) ** 2))
    for (const e of [5, 15, 25, 35]) {
      const x = Math.floor((300 + e) / hf.cell) * hf.cell + hf.cell / 2
      const z = heightAt(hf, x, 100)
      expect(z).toBeLessThanOrEqual(floorAt(x - 300) + 1e-4)
      expect(z).toBeGreaterThanOrEqual(floorAt(x - 300 - 2) - 1e-4)
    }
    expect(heightAt(hf, 300 + s + 2.5, 100)).toBe(0)
    expect(heightAt(hf, 100, 104)).toBe(0)
    // the native groove is the full-depth span, with the run-out for the neighbour check
    expect(tp.intents).toEqual([{ k: 'saw', xa: 100, ya: 100, xe: 300, ye: 100, width: 4, depth: 8, tool: tp.tool, label: tp.name, runout: Math.round(s * 1000) / 1000 }])
    expect(tp.saw!.r).toBe(100)
    expect(tp.saw!.placeholderBlade).toBe(false)
  })

  it('without a blade diameter a placeholder blade is assumed, with a warning', () => {
    const { part } = sawPart([[100, 100, 300, 100]])
    const [tp] = generatePart(part, machine)
    expect(tp.saw!.r).toBe(PLACEHOLDER_BLADE / 2)
    expect(tp.saw!.placeholderBlade).toBe(true)
    expect(tp.warnings.join(' ')).toMatch(/PLACEHOLDER/)
  })

  it('a Stage 1 saw groove (no saw settings) is unchanged', () => {
    const { part, op } = sawPart([[0, 20, 400, 20]])
    const plain = { ...op, saw: undefined }
    const tp = generateOp(plain, { part: { ...part, ops: [plain] }, machine })
    expect([...simpleMoves(tp.moves)].map((m) => m.t)).toEqual(['rapid', 'feed', 'feed', 'rapid'])
    expect(tp.intents).toEqual([{ k: 'saw', xa: 0, ya: 20, xe: 400, ye: 20, width: 4, depth: 8, tool: tp.tool, label: tp.name }])
  })

  it('angled cuts are simulated and never written (no confirmed woodWOP form)', () => {
    const { part } = sawPart([[100, 100, 300, 100]], { tilt: 20 })
    const [tp] = generatePart(part, sawMachine())
    expect(tp.intents).toEqual([])
    expect(tp.noOutput).toMatch(/angled saw cuts/)
    expect(tp.moves.length).toBeGreaterThan(4)
  })

  const job = (parts: CamPart[], features: Partial<AppData['settings']['features']>, m?: MachineProfile) => {
    const data = defaultAppData()
    if (m) data.machine = m
    const j: Job = { id: 'j', number: 'J26', name: 'Saw', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: parts }
    data.jobs = [j]
    data.settings.features = { ...data.settings.features, ...features } as AppData['settings']['features']
    return runJob(j, data)
  }
  const errs = (out: ReturnType<typeof runJob>) => [...new Set(out.issues.filter((i) => i.severity === 'error' && i.code !== 'THICKNESS').map((i) => i.code))].sort()

  it('export checker: no saw unit blocks saw cuts with a clear message, whatever the switches', () => {
    const { part } = sawPart([[0, 100, 400, 100]])
    part.materialId = 'mat-mdf18'
    for (const f of [{}, { camMprOutput: true }, { camMprOutput: true, cam25dMprOutput: true }]) {
      const out = job([part], f)
      expect(errs(out)).toContain('MACHINE_CANNOT')
      expect(out.issues.find((i) => i.code === 'MACHINE_CANNOT')!.message).toMatch(/no saw unit/)
    }
  })

  it('export checker: with a saw unit, the newer-operations switch decides; on, the native groove is written', () => {
    const { part } = sawPart([[0, 100, 400, 100]])
    part.materialId = 'mat-mdf18'
    const m = sawMachine(defaultAppData().machine)
    const off = job([part], { camMprOutput: true }, m)
    expect(errs(off)).toEqual(['CAM_25D_OUTPUT_OFF'])
    const on = job([part], { camMprOutput: true, cam25dMprOutput: true }, m)
    expect(errs(on)).toEqual([])
    const grooves = on.programs.flatMap((p) => p.ops).filter((o) => o.kind === 'cam' && o.intent.k === 'saw')
    expect(grooves).toHaveLength(1)
  })

  it('export checker: an angled cut is refused (CAM_NO_OUTPUT) even with every switch on', () => {
    const { part } = sawPart([[100, 100, 300, 100]], { tilt: 15 })
    part.materialId = 'mat-mdf18'
    const out = job([part], { camMprOutput: true, cam25dMprOutput: true }, sawMachine(defaultAppData().machine))
    expect(errs(out)).toEqual(['CAM_NO_OUTPUT'])
    expect(out.issues.find((i) => i.code === 'CAM_NO_OUTPUT')!.message).toMatch(/tilted blade is not confirmed/)
  })

  it('export checker: a run-out into a neighbouring part on the sheet is an error; kept inside, it is not', () => {
    const mk = (avoid: boolean) => {
      const { part } = sawPart([[0, 100, 400, 100]], { avoid }, 8, [400, 200, 18])
      part.materialId = 'mat-mdf18'
      part.qty = 6
      return part
    }
    const m = sawMachine(defaultAppData().machine)
    const bad = job([mk(false)], { camMprOutput: true, cam25dMprOutput: true }, m)
    expect(errs(bad)).toContain('OP_HITS_NEIGHBOUR')
    expect(bad.issues.find((i) => i.code === 'OP_HITS_NEIGHBOUR')!.message).toMatch(/run-out/)
    const good = job([mk(true)], { camMprOutput: true, cam25dMprOutput: true }, m)
    expect(errs(good)).toEqual([])
  })
})

describe('facing', () => {
  function facePart(extra: Partial<FaceOp> = {}, size: [number, number, number] = [300, 200, 19]) {
    const part = newPart({ name: 'Face', length: size[0], width: size[1], thickness: size[2], entities: [] })
    const outline = makeEntity({ t: 'contour', c: rect(0, 0, size[0], size[1]) }, 'outline')
    part.entities = [outline]
    part.outlineId = outline.id
    const op = defaultOp('face', [], { levels: { safeZ: 20, rapidZ: 3, depth: 1, through: false, stockZ: 0, passDepth: 0 }, ...extra } as Partial<CamOp>) as FaceOp
    part.ops = [op]
    return { part, op }
  }

  it('picks the widest flat cutter and lowers the whole panel to the level (simulated, every cell)', () => {
    for (const pattern of ['zigzag', 'offset'] as const) {
      const { part, op } = facePart({ pattern })
      expect(resolveTool(op, machine)?.diameter).toBe(12)
      const paths = generatePart(part, machine)
      const hf = simulate(part, paths, 0.5)
      let min = Infinity
      let max = -Infinity
      for (const z of hf.top) {
        min = Math.min(min, z)
        max = Math.max(max, z)
      }
      expect(max, pattern).toBeCloseTo(-1, 4)
      expect(min, pattern).toBeCloseTo(-1, 4)
      // the tool centre never leaves the panel (overhang 0)
      for (const m of simpleMoves(paths[0].moves)) {
        if (m.t === 'rapid') continue
        expect(m.x).toBeGreaterThanOrEqual(-1e-6)
        expect(m.x).toBeLessThanOrEqual(300 + 1e-6)
      }
    }
  })

  it('passes, overhang and a boundary', () => {
    const { part } = facePart({ levels: { safeZ: 20, rapidZ: 3, depth: 3, through: false, stockZ: 0, passDepth: 1 }, overhang: 4 })
    const [tp] = generatePart(part, machine)
    const zs = [...new Set([...simpleMoves(tp.moves)].filter((m) => m.t === 'feed' && m.f === 'cut').map((m) => m.z))].sort((a, b) => b - a)
    expect(zs).toEqual([-1, -2, -3])
    const xs = [...simpleMoves(tp.moves)].filter((m) => m.t !== 'rapid').map((m) => m.x)
    expect(Math.min(...xs)).toBeCloseTo(-4, 6)
    expect(Math.max(...xs)).toBeCloseTo(304, 6)
    // contour passes for woodWOP, each knowing how far the cutter reaches
    expect(tp.intents.every((it) => it.k === 'contour' && it.reach === 6)).toBe(true)
  })

  it('re-set stock top: later depths count from the faced top; through cuts still end at the same place', () => {
    const { part, op } = facePart({ levels: { safeZ: 20, rapidZ: 3, depth: 2, through: false, stockZ: 0, passDepth: 0 } })
    const pocketShape = makeEntity({ t: 'contour', c: rect(100, 50, 100, 100) }, 'machining')
    part.entities.push(pocketShape)
    const pocket = defaultOp('pocket', [pocketShape.id], { toolId: 't102', levels: { safeZ: 20, rapidZ: 3, depth: 5, through: false, stockZ: 0, passDepth: 0 } } as Partial<CamOp>)
    const profile = defaultOp('profile', [part.outlineId!])
    part.ops = [op, pocket, profile]
    const [, tpP, tpO] = generatePart(part, machine)
    expect(Math.min(...[...simpleMoves(tpP.moves)].map((m) => m.z))).toBeCloseTo(-7, 9)
    expect(tpP.intents[0].k === 'pocket-rect' && tpP.intents[0].depth).toBe(7)
    expect(tpP.top).toBe(2)
    // rapid heights are above the new top
    expect(Math.max(...[...simpleMoves(tpP.moves)].map((m) => m.z))).toBeCloseTo(18, 9)
    const through = -(19 + machine.throughDepth)
    expect(Math.min(...[...simpleMoves(tpO.moves)].map((m) => m.z))).toBeCloseTo(through, 9)
    // off: measured from face 1 again; changing the facing marks the later operations stale
    const off = { ...part, ops: [{ ...op, resetTop: false }, pocket, profile] }
    expect(Math.min(...[...simpleMoves(generatePart(off, machine)[1].moves)].map((m) => m.z))).toBeCloseTo(-5, 9)
    const tool = resolveTool(pocket, machine)
    const built = { ...pocket, builtHash: opInputHash(pocket, part, tool) }
    expect(opState(built, { ...part, ops: [op, built, profile] }, tool)).toBe('current')
    expect(opState(built, { ...part, ops: [{ ...op, levels: { ...op.levels, depth: 3 } }, built, profile] }, tool)).toBe('stale')
    expect(opState(built, off, tool)).toBe('stale')
  })

  it('export checker: written behind its own switch; the cutter must not reach a neighbouring part', () => {
    const { part } = facePart({ overhang: 0 })
    part.materialId = 'mat-mdf18'
    const data = defaultAppData()
    const j: Job = { id: 'j', number: 'J27', name: 'Face', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [part] }
    data.jobs = [j]
    data.settings.features = { ...data.settings.features, camMprOutput: true }
    const codes = () => [...new Set(runJob(j, data).issues.filter((i) => i.severity === 'error' && i.code !== 'THICKNESS').map((i) => i.code))]
    expect(codes()).toEqual(['CAM_25D_OUTPUT_OFF'])
    data.settings.features = { ...data.settings.features, cam25dMprOutput: true }
    expect(codes()).toEqual([])
    // several on one sheet: a 12 mm facing cutter reaches 6 mm past each part into the 12 mm gap,
    // fine; a 40 mm cutter reaches 20 mm and hits the next part
    part.qty = 4
    expect(codes()).toEqual([])
    data.machine = structuredClone(data.machine)
    data.machine.tools.push({ id: 't199', number: 199, type: 'router', name: 'Surfacing cutter 40 mm (placeholder)', diameter: 40, maxDepth: 10 })
    expect(codes()).toEqual(['OP_HITS_NEIGHBOUR'])
  })
})

describe('goldens: 3 reference parts per operation', () => {
  const DIR = path.join(import.meta.dirname, 'golden', 'cam25d')
  const UPDATE = process.env.UPDATE_GOLDEN === '1'
  const check = (f: string, text: string) => {
    if (UPDATE) {
      fs.mkdirSync(path.dirname(f), { recursive: true })
      fs.writeFileSync(f, text, f.endsWith('.json') ? 'utf8' : 'latin1')
    }
    expect(fs.existsSync(f), `${f} missing; run UPDATE_GOLDEN=1 once to create it`).toBe(true)
    expect(text).toBe(fs.readFileSync(f, f.endsWith('.json') ? 'utf8' : 'latin1'))
  }
  const m = sawMachine(machine)
  for (const p of [...sawParts(), ...faceParts()]) {
    it(`${p.id} ${p.name}`, () => {
      const paths = generatePart(p, m)
      check(path.join(DIR, p.id, 'toolpaths.json'), JSON.stringify(paths.map(digest), null, 1) + '\n')
      const mpr = writePartMpr(p, paths.filter((tp) => !tp.noOutput), m, 'REF')
      expect(readMpr(mpr).errors).toEqual([])
      check(path.join(DIR, p.id, 'part.mpr'), mpr)
    })
  }
})
