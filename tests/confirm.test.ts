/**
 * M2.6e: placeholder values tracked as unconfirmed, shown with "Configure", cleared when a real
 * value is entered or the value is marked confirmed; changes mark operations stale; confirming
 * never switches on output.
 */
import { describe, expect, it } from 'vitest'
import { makeEntity, newPart, opInputHash, opState } from '../src/cam/doc'
import { polyline, pt, rect } from '../src/cam/geom'
import { DEFAULT_SAW, defaultOp, resolveTool } from '../src/cam/ops'
import { generatePart } from '../src/cam/toolpath'
import type { CamOp, CamPart, FaceOp, SawOp } from '../src/cam/types'
import {
  BUILTIN_CUT_DEFAULTS,
  confirmKey,
  confirmOp,
  cutDefaultsOf,
  machineUnconfirmed,
  MODEL_FACTS,
  newOpDefaults,
  opUnconfirmed,
  retargetDefault,
  setCutDefault,
  toolUnconfirmed,
} from '../src/core/confirm'
import { defaultAppData, PLACEHOLDER_MACHINE } from '../src/core/defaults'
import { machineModelOf, PLACEHOLDER_N200_MODEL } from '../src/core/machineModel'
import { runJob } from '../src/core/pipeline'
import type { AppData, Job, MachineProfile } from '../src/core/types'

const fresh = (): MachineProfile => structuredClone(PLACEHOLDER_MACHINE)
const keys = (m: MachineProfile) => machineUnconfirmed(m).map((u) => u.key)

function facePart(extra: Partial<FaceOp> = {}): CamPart {
  const part = newPart({ name: 'Face', length: 300, width: 200, thickness: 19, entities: [], materialId: 'mat-mdf18' })
  const o = makeEntity({ t: 'contour', c: rect(0, 0, 300, 200) }, 'outline')
  part.entities = [o]
  part.outlineId = o.id
  part.ops = [defaultOp('face', [], { levels: { safeZ: 20, rapidZ: 3, depth: 1, through: false, stockZ: 0, passDepth: 0 }, ...extra } as Partial<CamOp>)]
  return part
}

function sawPart(): CamPart {
  const part = newPart({ name: 'Saw', length: 400, width: 200, thickness: 18, entities: [], materialId: 'mat-mdf18', qty: 6 })
  const o = makeEntity({ t: 'contour', c: rect(0, 0, 400, 200) }, 'outline')
  const l = makeEntity({ t: 'contour', c: polyline([pt(0, 100), pt(400, 100)], false) }, 'machining')
  part.entities = [o, l]
  part.outlineId = o.id
  part.ops = [defaultOp('saw', [l.id], { saw: { ...DEFAULT_SAW, avoid: false }, levels: { safeZ: 20, rapidZ: 3, depth: 8, through: false, stockZ: 0, passDepth: 0 } } as Partial<CamOp>)]
  return part
}

describe('unconfirmed values on the placeholder machine', () => {
  it('lists the saw blade, tools, holders, 3D tool lengths, feeds, every machine-model fact and every default cutting value', () => {
    const k = keys(fresh())
    expect(k).toContain('tool:t140:blade')
    expect(k).toContain('tool:t140:data')
    expect(k).toContain('tool:t105:lengths')
    expect(k).toContain('tool:t102:feeds')
    expect(k).toContain('holder:h-placeholder')
    for (const f of MODEL_FACTS) expect(k).toContain(`model:${f}`)
    for (const d of ['faceStepover', 'corners', 'edgeHeight', 'edgeReach', 'zwave', 'betweenStepover', 'pocketStepover', 'finishStepover', 'roughStepdown']) expect(k).toContain(`default:${d}`)
    // the blade shows the placeholder value in use
    expect(machineUnconfirmed(fresh()).find((u) => u.key === 'tool:t140:blade')!.value).toBe('Ø200 mm (assumed)')
    // and the aggregate counts as not fitted
    expect(machineUnconfirmed(fresh()).find((u) => u.key === 'model:aggregate')!.value).toBe('not fitted')
  })

  it('"Mark as confirmed" clears exactly that badge and changes no value', () => {
    const m = fresh()
    const before = structuredClone(m.tools)
    confirmKey(m, 'tool:t140:blade')
    expect(keys(m)).not.toContain('tool:t140:blade')
    expect(keys(m)).toContain('tool:t140:data')
    expect(m.tools).toEqual(before)
  })

  it('entering a real blade diameter on a real tool table: no badge; on the placeholder table it still needs confirming', () => {
    const m = fresh()
    m.tools.find((t) => t.id === 't140')!.bladeDiameter = 180
    expect(keys(m)).toContain('tool:t140:blade') // placeholder table: the tool data itself is invented
    confirmKey(m, 'tool:t140:blade') // what the Machine page does when the value is typed in
    expect(keys(m)).not.toContain('tool:t140:blade')
    const real = { ...fresh(), placeholder: false }
    real.tools = real.tools.map((t) => (t.id === 't140' ? { ...t, bladeDiameter: 180 } : t))
    expect(toolUnconfirmed(real, real.tools.find((t) => t.id === 't140')!).map((u) => u.key)).not.toContain('tool:t140:blade')
    // no blade on a real table: still assumed, still a badge
    expect(toolUnconfirmed({ ...real, tools: fresh().tools }, fresh().tools.find((t) => t.id === 't140')!).map((u) => u.key)).toContain('tool:t140:blade')
  })

  it('confirming every machine-model fact clears the model placeholder, but never fits a unit or switches on output', () => {
    const m = fresh()
    for (const f of MODEL_FACTS) confirmKey(m, `model:${f}`)
    expect(machineModelOf(m).placeholder).toBe(false)
    expect(machineModelOf(m).capabilities).toEqual(PLACEHOLDER_N200_MODEL.capabilities)
    expect(keys(m).some((k) => k.startsWith('model:'))).toBe(false)
    // everything confirmed: output still off, saw and aggregate still refused
    for (const k of keys(m)) confirmKey(m, k)
    expect(keys(m)).toEqual([])
    const data = defaultAppData()
    data.machine = m
    const part = sawPart()
    const j: Job = { id: 'j', number: 'J40', name: 'Confirm', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [part] }
    data.jobs = [j]
    const codes = runJob(j, data).issues.map((i) => i.code)
    expect(codes).toContain('CAM_OUTPUT_OFF')
    expect(codes).toContain('MACHINE_CANNOT')
    expect(codes).not.toContain('UNCONFIRMED')
    expect(data.settings.features?.camMprOutput ?? false).toBe(false)
  })
})

describe('operation values', () => {
  it('a new facing takes the shop default and shows its badge; typing a value (or marking it) clears it for that operation', () => {
    const m = fresh()
    const part = facePart(newOpDefaults('face', m) as Partial<FaceOp>)
    const op = part.ops[0]
    expect((op as FaceOp).stepover).toBe(BUILTIN_CUT_DEFAULTS.faceStepover)
    expect(opUnconfirmed(op, part, m, null).map((u) => u.key)).toEqual([`op:${op.id}:faceStepover`])
    const typed = confirmOp({ ...op, stepover: 0.6 } as FaceOp, 'faceStepover')
    expect(opUnconfirmed(typed, part, m, null)).toEqual([])
    expect(opUnconfirmed(confirmOp(op, 'faceStepover'), part, m, null)).toEqual([])
    // a value different from the placeholder (set before this tracking existed) is the owner's own
    expect(opUnconfirmed({ ...op, stepover: 0.7 } as FaceOp, part, m, null)).toEqual([])
    // confirming the shop default clears it on every operation using it
    confirmKey(m, 'default:faceStepover')
    expect(opUnconfirmed(op, part, m, null)).toEqual([])
  })

  it("an operation lists its tool's unconfirmed values; a saw cut with its own blade drops the tool's blade", () => {
    const m = fresh()
    const part = sawPart()
    const op = part.ops[0] as SawOp
    const tool = resolveTool(op, m)
    const k = opUnconfirmed(op, part, m, tool).map((u) => u.key)
    expect(k).toContain('tool:t140:blade')
    expect(k).toContain('model:saw')
    const own = { ...op, saw: { ...op.saw!, blade: 250 } }
    expect(opUnconfirmed(own, part, m, tool).map((u) => u.key)).not.toContain('tool:t140:blade')
    // the edge-work operation shows the aggregate and its own height and reach
    const edge = defaultOp('edge', [], newOpDefaults('edge', m) as Partial<CamOp>)
    expect(opUnconfirmed(edge, part, m, null).map((u) => u.key)).toEqual([`op:${edge.id}:edgeHeight`, `op:${edge.id}:edgeReach`, 'model:aggregate'])
  })

  it('confirming an operation value does not mark it stale', () => {
    const part = facePart()
    const op = part.ops[0]
    const tool = resolveTool(op, PLACEHOLDER_MACHINE)
    const built = { ...op, builtHash: opInputHash(op, part, tool) }
    expect(opState(confirmOp(built, 'faceStepover'), part, tool)).toBe('current')
  })
})

describe('editable any time: changes mark operations stale and re-run the checks', () => {
  it('changing a shop default moves every operation still on the old value (marked stale) and leaves overridden ones', () => {
    const data = defaultAppData()
    const a = facePart()
    const b = facePart()
    b.ops = [confirmOp({ ...b.ops[0], stepover: 0.45 } as FaceOp, 'faceStepover')]
    const lib = facePart()
    data.jobs = [{ id: 'j', number: 'J41', name: '', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [a, b] }]
    data.library.partLibrary = [lib]
    const tool = resolveTool(a.ops[0], data.machine)
    const builtA = opInputHash(a.ops[0], a, tool)
    setCutDefault(data, 'faceStepover', 0.6)
    expect(cutDefaultsOf(data.machine).faceStepover).toBe(0.6)
    expect(machineUnconfirmed(data.machine).map((u) => u.key)).not.toContain('default:faceStepover')
    const [na, nb] = data.jobs[0].camParts!
    expect((na.ops[0] as FaceOp).stepover).toBe(0.6)
    expect((nb.ops[0] as FaceOp).stepover).toBe(0.45)
    expect((data.library.partLibrary![0].ops[0] as FaceOp).stepover).toBe(0.6)
    expect(opState({ ...na.ops[0], builtHash: builtA }, na, tool)).toBe('stale')
    // the Z-wave default moves min / max / length together
    const w = retargetDefault([{ ...a, ops: [defaultOp('curve', [], { mode: 'zwave' } as Partial<CamOp>)] }], 'zwave', BUILTIN_CUT_DEFAULTS.zwave, { min: 2, max: 5, length: 30 })
    expect((w[0].ops[0] as Extract<CamOp, { kind: 'curve' }>).wave).toMatchObject({ min: 2, max: 5, length: 30, shape: 'sine' })
  })

  it('a different saw blade diameter: the saw cut goes stale, its run-out changes, and the export check follows it', () => {
    const run = (blade: number | undefined) => {
      const data = defaultAppData()
      data.machine.physical = { ...structuredClone(PLACEHOLDER_N200_MODEL), capabilities: { ...PLACEHOLDER_N200_MODEL.capabilities, saw: true } }
      data.machine.tools = data.machine.tools.map((t) => (t.id === 't140' ? { ...t, kerf: 4, ...(blade ? { bladeDiameter: blade } : {}) } : t))
      data.settings.features = { ...data.settings.features, camMprOutput: true, cam25dMprOutput: true } as AppData['settings']['features']
      const part = sawPart()
      const j: Job = { id: 'j', number: 'J42', name: '', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [part] }
      data.jobs = [j]
      const tp = generatePart(part, data.machine)[0]
      return { tool: resolveTool(part.ops[0], data.machine), part, runout: tp.saw!.runout, codes: runJob(j, data).issues.filter((i) => i.severity === 'error').map((i) => i.code) }
    }
    const big = run(undefined) // placeholder 200 mm: 39 mm run-out reaches the next part
    const small = run(20) // a 20 mm blade, 8 mm deep: 9.8 mm run-out stays within the 14 mm gap
    expect(big.codes).toContain('OP_HITS_NEIGHBOUR')
    expect(small.codes).not.toContain('OP_HITS_NEIGHBOUR')
    expect(small.runout).toBeLessThan(big.runout)
    const op = big.part.ops[0]
    const built = { ...op, builtHash: opInputHash(op, big.part, big.tool) }
    expect(opState(built, big.part, small.tool)).toBe('stale')
  })
})

describe('export checker messages', () => {
  it('lists the placeholder values the job uses, each with where it goes; saw refusals point at the saw unit', () => {
    const data = defaultAppData()
    const part = sawPart()
    part.qty = 1
    const j: Job = { id: 'j', number: 'J43', name: '', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [part] }
    data.jobs = [j]
    const issues = runJob(j, data).issues
    const u = issues.find((i) => i.code === 'UNCONFIRMED')!
    expect(u.severity).toBe('warning')
    expect(u.configure!.map((x) => x.key)).toContain('tool:t140:blade')
    expect(u.configure!.find((x) => x.key === 'tool:t140:blade')!.target).toEqual({ kind: 'tool', toolId: 't140', part: 'blade' })
    expect(issues.find((i) => i.code === 'MACHINE_CANNOT')!.configure!.map((x) => x.key)).toEqual(['model:saw'])
    expect(issues.find((i) => i.code === 'MACHINE_PLACEHOLDER')!.configure!.length).toBe(MODEL_FACTS.length)
    // confirm the blade: it leaves the list (the existing checks are all still there)
    confirmKey(data.machine, 'tool:t140:blade')
    const after = runJob(j, data).issues
    expect(after.find((i) => i.code === 'UNCONFIRMED')!.configure!.map((x) => x.key)).not.toContain('tool:t140:blade')
    for (const code of ['PLACEHOLDER_TOOLS', 'MACHINE_PLACEHOLDER', 'MACHINE_CANNOT', 'CAM_OUTPUT_OFF']) expect(after.some((i) => i.code === code)).toBe(true)
  })
})

describe('M3.1g lollipop sizes stay placeholders (owner decision 2)', () => {
  const T108 = (m: MachineProfile) => m.tools.find((t) => t.id === 't108')!
  const parts = (m: MachineProfile) => toolUnconfirmed(m, T108(m)).map((u) => [u.target.kind === 'tool' ? u.target.part : '', u.label, u.value])

  it('ball, neck, flute and stick-out each show Configure, with the values in use', () => {
    const m = fresh()
    const u = parts(m)
    expect(u).toContainEqual(['data', 'T108 number, ball Ø and depth', 'ball Ø12, 40 deep'])
    expect(u).toContainEqual(['lengths', 'T108 neck Ø, flute and stick-out', 'neck Ø4, flute 12, stick-out 60 mm'])
    // on the machine page's list too
    expect(keys(m)).toEqual(expect.arrayContaining(['tool:t108:data', 'tool:t108:lengths']))
  })

  it('still badged once the rest of the tool table is real; gone only when each value is confirmed', () => {
    const m = fresh()
    m.placeholder = false
    // an ordinary tool loses its badge with the real table; the lollipop keeps both
    expect(toolUnconfirmed(m, m.tools.find((t) => t.id === 't102')!).map((x) => x.key)).not.toContain('tool:t102:data')
    expect(parts(m).map((x) => x[0])).toEqual(expect.arrayContaining(['data', 'lengths']))
    // a neck not given at all says so
    const noNeck = { ...T108(m), shankDiameter: undefined }
    expect(toolUnconfirmed(m, noNeck).find((x) => x.key === 'tool:t108:lengths')!.value).toMatch(/neck Ø\? \(not given\)/)
    confirmKey(m, 'tool:t108:data')
    expect(parts(m).map((x) => x[0])).not.toContain('data')
    expect(parts(m).map((x) => x[0])).toContain('lengths')
    confirmKey(m, 'tool:t108:lengths')
    expect(parts(m).map((x) => x[0])).not.toContain('lengths')
  })

  it('an undercut operation lists them in its editor and the export checker lists them; confirming switches nothing on', () => {
    const data = defaultAppData()
    const part = newPart({ name: 'Lip', length: 80, width: 60, thickness: 50, materialId: 'mat-mdf18' })
    const op = { ...defaultOp('finish3d', [], { strategy: 'undercut' } as Partial<CamOp>), toolId: 't108' } as CamOp
    part.ops = [op]
    const u = opUnconfirmed(op, part, data.machine, T108(data.machine)).map((x) => x.key)
    expect(u).toEqual(expect.arrayContaining(['tool:t108:data', 'tool:t108:lengths']))
    const j: Job = { id: 'j', number: 'J108', name: '', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [part] }
    data.jobs = [j]
    const listed = runJob(j, data).issues.find((i) => i.code === 'UNCONFIRMED')!.configure!.map((x) => x.key)
    expect(listed).toEqual(expect.arrayContaining(['tool:t108:data', 'tool:t108:lengths']))
    const before = data.settings.features
    confirmKey(data.machine, 'tool:t108:lengths')
    expect(data.settings.features).toEqual(before)
    expect(runJob(j, data).issues.some((i) => i.code === 'CAM_3D_NO_OUTPUT')).toBe(true)
  })
})
