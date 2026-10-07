/**
 * M3.5b 5-axis output (standing rule: rotary, 3+2 and 5-axis output only through a script post for a
 * machine model that declares those axes; the N-200 export always refuses, naming the part). The
 * sample 5-axis script post writes a licensed engine's toolpath (the test engine stands in: no
 * engine is licensed) for test routers with simultaneous 5-axis, only with every switch on and the
 * grant; its program read back through our kinematics lands on the toolpath. Everything else is
 * refused with its reason: the N-200, the switches, the built-in preview engine, a gouge, a machine
 * without simultaneous 5-axis, axes too short, the template post, a toolpath not calculated.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { newPart } from '@/cam/doc'
import type { MultiAxisEngine } from '@/cam/multiaxis/engine'
import { PluginHost } from '@/cam/plugin/host'
import { pluginRecord } from '@/cam/plugin/manifest'
import { planPartPost, runScriptPost } from '@/cam/plugin/posts'
import type { PluginRecord } from '@/cam/plugin/types'
import { SAMPLE_TEMPLATE } from '@/cam/post'
import { fromMachine } from '@/cam/positional/kinematics'
import { generateOp, type Move, pathKey, type Toolpath } from '@/cam/toolpath'
import type { CamPart } from '@/cam/types'
import { dataFor, MAIN_MACHINE, newMachineSetup } from '@/core/machines'
import { runJob } from '@/core/pipeline'
import type { AppData, Job, MachineSetup, PositionalKinematics } from '@/core/types'
import { surfaceMesh } from './finish3d-setup'
import { data } from './helpers'
import { hemiPart, machine5, TEST_ENGINE } from './multiaxis-fixtures'
import { machine32 } from './positional-fixtures'

const POST = fs.readFileSync(path.resolve(import.meta.dirname, '../examples/plugins/simultaneous-5axis-post.js'), 'utf8')
const NOW = '2026-10-07T00:00:00.000Z'
const say = (s: string) => process.stdout.write(`  [5-axis post] ${s}\n`)
const codes = (issues: { code: string; severity: string }[]) => issues.filter((i) => i.severity === 'error').map((i) => i.code)

function install(code: string, grants: PluginRecord['grants'] = {}): PluginRecord {
  return { ...pluginRecord(code, 'test', NOW), grants, enabled: true }
}

/** A router with simultaneous 5-axis in the machine list, posting through the sample 5-axis post. */
function router5(d: AppData, layout: PositionalKinematics['layout'], first: 'A' | 'B' | 'C', second: 'A' | 'B' | 'C', extra: Partial<PositionalKinematics> = {}, travel: Record<string, [number, number]> = {}, post?: MachineSetup['post'], simultaneous = true): MachineSetup {
  const m = newMachineSetup(d, { name: `5-axis router ${layout}${simultaneous ? '' : ' (3+2 only)'}`, from: 'main' })
  const t = simultaneous ? machine5(layout, first, second, extra, travel) : machine32(layout, first, second, extra, travel)
  m.profile = { ...m.profile, model: t.model, physical: t.physical }
  m.post = post ?? { kind: 'script', plugin: 'simultaneous-5axis-post', post: 'simultaneous-5axis' }
  d.machines = [...(d.machines ?? []).filter((x) => x.id !== m.id), m]
  return m
}

/** The part's 5-axis toolpaths as the background calculation hands them over (by `pathKey`). */
/** `engine`: the licensed engine slot (null = none installed: the stub). */
function paths3d(d: AppData, machineId: string, part: CamPart, engine: MultiAxisEngine | null = TEST_ENGINE): Map<string, Toolpath> {
  const m = dataFor(d, machineId).machine
  const meshes = new Map([['hemisphere', surfaceMesh('hemisphere')]])
  const out = new Map<string, Toolpath>()
  for (const op of part.ops) if (op.kind === 'multiaxis') out.set(pathKey(op, part, m), generateOp(op, { part, machine: m, meshes, ...(engine ? { engine } : {}) }))
  return out
}

const allOn = (x: AppData) => (x.settings.features = { ...x.settings.features, scriptPostOutput: true, multiAxisPostOutput: true })

/** The hemisphere finished with the ball on the surface normal (at most 30°), coarse passes. */
const finishPart = () => hemiPart([], { id: 'ma-surface', toolId: 't105', stepover: 5, axis: { mode: 'surface-normal', lead: 0, tilt: 0, toward: 0, point: { x: 0, y: 0, z: 100 }, dir: { x: 1, y: 0, z: 0 }, maxTilt: 30 } }).part

describe('M3.5 5-axis programs through a script post', () => {
  for (const [layout, first, second, extra] of [
    ['head-head', 'C', 'B', { tcp: false }],
    ['table-table', 'A', 'C', {}],
    ['table-head', 'C', 'B', { tcp: true }],
  ] as const) {
    it(`writes a licensed engine's 5-axis toolpath for a ${layout} ${first}/${second} router: every move read back through the kinematics lands on it`, async () => {
      const d = data()
      const router = router5(d, layout, first, second, extra)
      const h = await PluginHost.start(install(POST))
      d.plugins = [{ ...install(POST, { machineOutput: true }), contributes: h.contributes }]
      const part = finishPart()
      const pre = paths3d(d, router.id, part)
      // switches off: shown, not written, each switch named
      const off = planPartPost(d, router.id, part, { paths3d: pre })
      expect(off.writable).toBe(false)
      expect(codes(off.issues)).toEqual(['POST_OUTPUT_OFF', 'POST_MULTIAXIS_OFF'])
      allOn(d)
      const on = planPartPost(d, router.id, part, { paths3d: pre })
      expect(codes(on.issues)).toEqual([])
      expect(on.writable).toBe(true)
      const op = on.input.ops[0]
      expect(op.multiAxis).toBeTruthy()
      expect(op.multiAxis!.simultaneous).toBe(true)
      const text = (await runScriptPost(h, 'simultaneous-5axis', on.input)).text
      expect(text).toMatch(/^%\r\n\(Hemisphere \(5-axis\)\)\r\n\(GENERATED BY CABINET STUDIO - NOT MACHINE-VALIDATED\)\r\nG21 G90 G17 G94 G54\r\n/)
      // read back: X Y Z and both rotary axes on every line, in work coordinates
      const k = router.profile.physical!.positional!
      const re = new RegExp(`^(?:G9[34] )?G[01] X(-?[\\d.]+) Y(-?[\\d.]+) Z(-?[\\d.]+) ${first}(-?[\\d.]+) ${second}(-?[\\d.]+)`)
      const moves = op.multiAxis!.moves
      let worst = 0
      let worstA = 0
      let n = 0
      for (const l of text.split('\r\n')) {
        const m = re.exec(l)
        if (!m) continue
        const want = moves[n++]
        const xyz = [Number(m[1]) + k.partAt.x, Number(m[2]) + k.partAt.y, Number(m[3]) + k.partAt.z]
        const back = fromMachine(k, { first: Number(m[4]), second: Number(m[5]) }, xyz, op.multiAxis!.L)
        // the tip read back against the tip the move was made for
        const tip = fromMachine(k, { first: want.a1, second: want.a2 }, [want.x, want.y, want.z], op.multiAxis!.L).tip
        worst = Math.max(worst, Math.hypot(back.tip[0] - tip[0], back.tip[1] - tip[1], back.tip[2] - tip[2]))
        const t = back.tool
        worstA = Math.max(worstA, (Math.acos(Math.max(-1, Math.min(1, (t[0] * want.tool[0] + t[1] * want.tool[1] + t[2] * want.tool[2]) / Math.hypot(t[0], t[1], t[2])))) * 180) / Math.PI)
      }
      expect(n).toBe(moves.length)
      say(`${layout} ${first}/${second}${k.tcp ? ' (tip control)' : ` (pivot ${k.pivot} mm)`}: ${n} moves read back through the kinematics, tip within ${worst.toFixed(4)} mm, tool within ${worstA.toFixed(4)}° (3 decimals written); ${(text.match(/G93 /g) ?? []).length} inverse-time switch(es)`)
      expect(n).toBeGreaterThan(200)
      expect(worst).toBeLessThan(0.005)
      expect(worstA).toBeLessThan(0.01)
      // inverse-time feeds where the rotary axes turn while cutting
      expect(text).toMatch(/G93 G1 /)
      h.dispose()
    }, 120_000)
  }
})

describe('M3.5 5-axis output refused', () => {
  it('the N-200, the preview engine, a gouge, a machine without simultaneous 5-axis, axes too short, the template post, nothing calculated, the switches', async () => {
    const d = data(allOn)
    const h = await PluginHost.start(install(POST))
    d.plugins = [{ ...install(POST, { machineOutput: true }), contributes: h.contributes }]
    const part = finishPart()
    // the N-200 (the main machine: woodWOP only)
    expect(planPartPost(d, MAIN_MACHINE, part, { paths3d: paths3d(d, MAIN_MACHINE, part) }).writable).toBe(false)
    const good = router5(d, 'head-head', 'C', 'B', { tcp: true })
    expect(codes(planPartPost(d, good.id, part, { paths3d: paths3d(d, good.id, part) }).issues)).toEqual([])
    // the built-in preview engine: simulation only, never written
    const preview = { ...part, ops: part.ops.map((o) => ({ ...o, engine: 'preview' })) }
    const pv = planPartPost(d, good.id, preview, { paths3d: paths3d(d, good.id, preview, null) })
    expect(codes(pv.issues)).toEqual(['POST_MULTIAXIS_ENGINE'])
    expect(pv.issues[0].message).toMatch(/made by the built-in preview engine, which is for the simulator only/)
    // no licensed engine (the stub): nothing calculated, nothing written
    const stub = planPartPost(d, good.id, part, { paths3d: paths3d(d, good.id, part, null) })
    expect(codes(stub.issues)).toContain('POST_NOT_READY')
    expect(stub.issues.find((i) => i.code === 'POST_NOT_READY')!.message).toMatch(/5-axis engine not licensed/)
    // an engine whose toolpath digs 0.2 mm into the model: our own gouge check refuses it
    const digger: MultiAxisEngine = {
      info: { ...TEST_ENGINE.info, id: 'dig', name: 'Digging engine' },
      generate: (req, work) => {
        const r = TEST_ENGINE.generate(req, work)
        if (r.status !== 'ok') return r
        const down = (m: Move): Move => {
          if (m.t === 'poly' && m.axes) {
            const pts = Float64Array.from(m.pts)
            for (let i = 0; i < pts.length; i += 3) for (let q = 0; q < 3; q++) pts[i + q] -= m.axes[i + q] * 0.2
            return { ...m, pts }
          }
          return m
        }
        return { ...r, moves: r.moves.map(down) }
      },
    }
    const dug = planPartPost(d, good.id, part, { paths3d: paths3d(d, good.id, part, digger) })
    expect(codes(dug.issues)).toEqual(['POST_MULTIAXIS_GOUGE'])
    expect(dug.issues[0].message).toMatch(/our own gouge check finds the tool 0\.2\d\d mm into the model/)
    // a router with 3+2 axes that do not move while cutting: refused, its post gets no 5-axis move
    const only32 = router5(d, 'head-head', 'C', 'B', {}, {}, undefined, false)
    const p32 = planPartPost(d, only32.id, part, { paths3d: paths3d(d, only32.id, part) })
    expect(codes(p32.issues)).toEqual(['POST_MULTIAXIS_MACHINE'])
    expect(p32.issues[0].message).toBe(`${only32.name}: its machine model does not declare simultaneous 5-axis (its rotary axes do not move while it cuts).`)
    expect(p32.input.ops.every((o) => o.fiveAxis && !o.moves.length)).toBe(true)
    // the B axis tilts only 10°: out of reach
    const short = router5(d, 'head-head', 'C', 'B', { tcp: true }, { B: [-10, 10] })
    expect(codes(planPartPost(d, short.id, part, { paths3d: paths3d(d, short.id, part) }).issues)).toContain('POST_MULTIAXIS_TRAVEL')
    // the built-in template post: its text never carries the 5-axis moves
    const tm = router5(d, 'table-table', 'A', 'C', {}, {}, { kind: 'template', ...SAMPLE_TEMPLATE })
    const tp = planPartPost(d, tm.id, part, { paths3d: paths3d(d, tm.id, part) })
    expect(codes(tp.issues)).toContain('POST_MULTIAXIS_TEMPLATE')
    expect(tp.writable).toBe(false)
    expect(tp.templateText!.text).toContain('5-AXIS - NOT WRITTEN BY A TEMPLATE POST')
    expect(tp.templateText!.text).not.toMatch(/G1 |G0 X/)
    // the switches and the grant, as for any script post
    const ungranted = structuredClone(d)
    ungranted.plugins = [{ ...d.plugins![0], grants: {} }]
    expect(codes(planPartPost(ungranted, good.id, part, { paths3d: paths3d(ungranted, good.id, part) }).issues)).toEqual(['POST_NO_GRANT'])
    const noSwitch = structuredClone(d)
    noSwitch.settings.features = { ...noSwitch.settings.features, multiAxisPostOutput: false }
    expect(codes(planPartPost(noSwitch, good.id, part, { paths3d: paths3d(noSwitch, good.id, part) }).issues)).toEqual(['POST_MULTIAXIS_OFF'])
    h.dispose()
  }, 120_000)
})

describe('M3.5 the N-200 export refuses 5-axis work', () => {
  it('leaves a part with 5-axis operations out of nesting and refuses the job, naming the part', () => {
    const d = data()
    const mat = d.library.materials[0]
    const five: CamPart = { ...finishPart(), materialId: mat.id, thickness: mat.thickness }
    const flat: CamPart = { ...newPart({ id: 'flat1', name: 'Plain panel', length: 300, width: 200 }), materialId: mat.id, thickness: mat.thickness }
    const at = '2026-01-01T00:00:00.000Z'
    const job: Job = { id: 'j', number: 'P1', name: '5-axis', customer: '', notes: '', createdAt: at, updatedAt: at, cabinets: [], camParts: [five, flat] }
    // every output switch on: still refused
    const on = { ...d, settings: { ...d.settings, features: { ...d.settings.features, camMprOutput: true, cam3dMprOutput: true, cam25dMprOutput: true, scriptPostOutput: true, rotaryPostOutput: true, positionalPostOutput: true, multiAxisPostOutput: true } } }
    const r = runJob(job, on)
    const err = r.issues.filter((i) => i.code === 'CAM_MULTIAXIS')
    expect(err).toHaveLength(1)
    expect(err[0].severity).toBe('error')
    expect(err[0].message).toMatch(/^Custom part Hemisphere \(5-axis\) has 1 simultaneous 5-axis operation\(s\): "5-axis surface finishing"\. /)
    expect(err[0].message).toMatch(/cannot move rotary axes while cutting \(it has no simultaneous 5-axis\), so the part is not nested and nothing of it is written to woodWOP/)
    expect(err[0].message).toMatch(/Remove Hemisphere \(5-axis\) from this job \(or switch its 5-axis operations off\) to export the rest of it\.$/)
    expect(r.issues.some((i) => /Hemisphere \(5-axis\) has simultaneous 5-axis operations\. It is left out of the cut list and nesting/.test(i.message))).toBe(true)
    // the plain panel is still nested; the 5-axis part is on no sheet
    expect(r.nest.sheets.flatMap((s) => s.placements).length).toBe(1)
    // with its 5-axis operation switched off it is a plain part again
    const offPart = { ...five, ops: five.ops.map((o) => ({ ...o, enabled: false })) }
    const r2 = runJob({ ...job, camParts: [offPart, flat] }, on)
    expect(r2.issues.some((i) => i.code === 'CAM_MULTIAXIS')).toBe(false)
    expect(r2.nest.sheets.flatMap((s) => s.placements).length).toBe(2)
    say(`N-200 job: ${err[0].code} - ${err[0].message.slice(0, 120)}…`)
  })
})
