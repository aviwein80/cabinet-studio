import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { pluginRecord } from '@/cam/plugin/manifest'
import { PluginHost } from '@/cam/plugin/host'
import { planPartPost, runScriptPost } from '@/cam/plugin/posts'
import type { PluginRecord } from '@/cam/plugin/types'
import { parseTemplate, postInput, runPost, runTemplate, SAMPLE_TEMPLATE, type PostTemplate } from '@/cam/post'
import { generatePart, simpleMoves, type Toolpath } from '@/cam/toolpath'
import type { CamPart } from '@/cam/types'
import { runBatchCsv } from '@/core/batch'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import { MAIN_MACHINE, newMachineSetup } from '@/core/machines'
import type { AppData, MachineSetup } from '@/core/types'
import { checkTextPost, isN200 } from '@/core/validator'
import { referenceParts } from './cam-reference'
import { chamferParts, curveParts, edgeParts, faceParts, manualParts, sawParts } from './cam-reference-25d'
import { data } from './helpers'

const POST = fs.readFileSync(path.resolve(import.meta.dirname, '../examples/plugins/iso-router-post.js'), 'utf8')
const machine = structuredClone(PLACEHOLDER_MACHINE)
const NOW = '2026-10-06T10:00:00.000Z'

/** The template post exactly as it was before M2.10b (kept here to prove the change of path changed nothing). */
function legacyRunPost(template: PostTemplate, name: string, paths: Toolpath[], zTop = 0): { ext: string; text: string } {
  const t = parseTemplate(template.text)
  const lines: string[] = []
  const last: Record<string, string> = {}
  const emit = (section: string, vars: Record<string, string | number | undefined>) => {
    for (const tl of t.sections[section] ?? []) {
      let ln = tl
      const cond = /^\?(\w+) /.exec(ln)
      if (cond) {
        if (vars[cond[1]] === undefined || vars[cond[1]] === '') continue
        ln = ln.slice(cond[0].length)
      }
      ln = ln.replace(/(\S*?)\{(\w+)(?::(\d+))?\}/g, (_all, prefix: string, key: string, dec?: string) => {
        const v = vars[key]
        if (v === undefined) return ''
        const s = typeof v === 'number' ? v.toFixed(dec ? Number(dec) : t.decimals) : v
        const word = (prefix || '').toUpperCase()
        if (word && t.modal.has(word)) {
          if (last[word] === s) return ''
          last[word] = s
        }
        return `${prefix}${s}`
      })
      lines.push(ln.replace(/\s+$/, '').replace(/ {2,}/g, ' '))
    }
  }
  emit('start', { NAME: name })
  let x = 0
  let y = 0
  for (const tp of paths) {
    if (tp.tool) emit('toolchange', { T: String(tp.tool.number), S: String(Math.round(tp.feeds.rpm)), TOOLNAME: tp.tool.name })
    emit('comment', { TEXT: tp.name })
    for (const m of simpleMoves(tp.moves)) {
      const Z = m.z + zTop
      if (m.t === 'rapid') emit('rapid', { X: m.x, Y: m.y, Z })
      else if (m.t === 'feed') emit('feed', { X: m.x, Y: m.y, Z, F: String(Math.round((m.f === 'plunge' ? tp.feeds.plunge : tp.feeds.feed) * (m.k ?? 1))) })
      else if (m.t === 'arc') emit(m.ccw ? 'arc_ccw' : 'arc_cw', { X: m.x, Y: m.y, Z, I: m.cx - x, J: m.cy - y, F: String(Math.round(tp.feeds.feed * (m.k ?? 1))) })
      else emit(m.peck > 0 ? 'peck' : 'drill', { X: m.x, Y: m.y, Z, R: m.r + zTop, Q: m.peck, F: String(Math.round(tp.feeds.plunge)) })
      x = m.x
      y = m.y
    }
  }
  emit('end', {})
  return { ext: t.ext, text: lines.join('\r\n') + '\r\n' }
}

const allParts = (): CamPart[] => [...referenceParts(), ...sawParts(), ...faceParts(), ...chamferParts(), ...curveParts(), ...manualParts(), ...edgeParts()]
const pathsOf = (p: CamPart) => generatePart(p, machine, undefined, undefined, true).filter((t) => t.moves.length)

function install(code: string, grants: PluginRecord['grants'] = {}): PluginRecord {
  return { ...pluginRecord(code, 'test', NOW), grants, enabled: true }
}

/** A second machine that is not an N-200, with a post. */
function withRouter(d: AppData, post: MachineSetup['post']): MachineSetup {
  const m = newMachineSetup(d, { name: 'Router two', from: 'main' })
  m.profile.model = 'ISO router (example)'
  m.post = post
  d.machines = [...(d.machines ?? []), m]
  return m
}

describe('M2.10b one post path', () => {
  it('the template post reads the shared post input and writes exactly what it wrote before', () => {
    let lines = 0
    for (const p of allParts()) {
      const tps = pathsOf(p)
      for (const zTop of [0, 19]) {
        const now = runPost(SAMPLE_TEMPLATE, p.name, tps, zTop)
        expect(now, `${p.id} z${zTop}`).toEqual(legacyRunPost(SAMPLE_TEMPLATE, p.name, tps, zTop))
        lines += now.text.split('\r\n').length
      }
    }
    expect(lines).toBeGreaterThan(5000)
  })

  it('the post input carries every move, with feeds per move and arc centres both ways', () => {
    const p = referenceParts()[2] // arched door: lines and arcs
    const tps = pathsOf(p)
    const input = postInput(p.name, tps, { zTop: 19, part: { length: p.length, width: p.width, thickness: p.thickness } })
    expect(input.ops).toHaveLength(tps.length)
    expect(input.ops.map((o) => o.moves.length)).toEqual(tps.map((t) => [...simpleMoves(t.moves)].length))
    const arc = input.ops.flatMap((o) => o.moves).find((m) => m.t === 'arc')!
    expect(arc.t === 'arc' && Math.abs(arc.cx - arc.i - (input.ops[0].moves[input.ops[0].moves.indexOf(arc) - 1] as { x: number }).x)).toBeLessThan(1e-9)
    expect(input.part).toEqual({ length: 400, width: 700, thickness: 19 })
    expect(JSON.parse(JSON.stringify(input))).toEqual(input)
  })
})

describe('M2.10b acceptance: the sample script post writes what the built-in template post writes', () => {
  it('on every reference part, byte for byte', async () => {
    const h = await PluginHost.start(install(POST))
    expect(h.contributes.posts).toEqual([{ id: 'iso-router', name: 'Generic ISO router (script sample)', ext: 'nc', description: expect.any(String) }])
    let n = 0
    let bytes = 0
    for (const p of allParts()) {
      const input = postInput(p.name, pathsOf(p), { zTop: 0 })
      const built = runTemplate(SAMPLE_TEMPLATE, input)
      const script = await runScriptPost(h, 'iso-router', input)
      expect(script.ext).toBe(built.ext)
      expect(script.text, p.id).toBe(built.text)
      n++
      bytes += script.text.length
    }
    h.dispose()
    expect(n).toBe(allParts().length)
    process.stdout.write(`  [script post] ${n} reference parts, ${(bytes / 1024).toFixed(0)} KB of G-code, identical to the template post\n`)
  }, 120_000)

  it('a script post that returns no text, too much or never finishes is refused', async () => {
    const head = '// @plugin bad-post\n// @name Bad post\n'
    const h = await PluginHost.start(install(head + `cs.post.add({ id: 'num', name: 'Number', run: function () { return 42 } }); cs.post.add({ id: 'loop', name: 'Loop', run: function () { for (;;) {} } }); cs.post.add({ id: 'nul', name: 'Nul', run: function () { return 'G0\\u0000' } })`), { timeLimitMs: 300 })
    const input = postInput('X', [])
    await expect(runScriptPost(h, 'num', input)).rejects.toThrow(/must return the program as text/)
    await expect(runScriptPost(h, 'loop', input)).rejects.toThrow(/was stopped/)
    await expect(runScriptPost(h, 'nul', input)).rejects.toThrow(/NUL/)
    await expect(runScriptPost(h, 'none', input)).rejects.toThrow(/no post "none"/)
    h.dispose()
  })
})

describe('M2.10b where text posts may write', () => {
  const tpOf = (p: CamPart) => pathsOf(p)

  it('never the N-200: the main machine, or another machine still described as one', () => {
    const d = data()
    const copy = newMachineSetup(d, { name: 'Copy', from: 'main' })
    expect(isN200({ id: MAIN_MACHINE, profile: d.machine })).toBe(true)
    expect(isN200(copy)).toBe(true) // model still CENTATEQ N-200
    const tmpl: MachineSetup = { ...copy, post: { kind: 'template', ...SAMPLE_TEMPLATE } }
    expect(checkTextPost(tmpl, { switchOn: true, toolpaths: [] }).map((i) => i.code)).toEqual(['POST_N200'])
    const router = withRouter(d, { kind: 'template', ...SAMPLE_TEMPLATE })
    expect(isN200(router)).toBe(false)
    expect(checkTextPost(router, { switchOn: true, toolpaths: tpOf(referenceParts()[0]) })).toEqual([])
  })

  it('switch off, a missing, switched-off or ungranted plugin, a missing post: each blocks writing', () => {
    const d = data()
    const router = withRouter(d, { kind: 'script', plugin: 'iso-router-post', post: 'iso-router' })
    const tps = tpOf(referenceParts()[0])
    const codes = (plugin: PluginRecord | null, on = true) => checkTextPost(router, { switchOn: on, plugin, toolpaths: tps }).map((i) => i.code)
    const ok = { ...install(POST, { machineOutput: true }), contributes: { menu: [], steps: [], posts: [{ id: 'iso-router', name: 'x', ext: 'nc', description: '' }] } }
    expect(codes(ok)).toEqual([])
    expect(codes(ok, false)).toEqual(['POST_OUTPUT_OFF'])
    expect(codes(null)).toEqual(['POST_PLUGIN_MISSING'])
    expect(codes({ ...ok, enabled: false })).toEqual(['POST_PLUGIN_OFF'])
    expect(codes({ ...ok, grants: {} })).toEqual(['POST_NO_GRANT'])
    expect(codes({ ...ok, contributes: { menu: [], steps: [], posts: [] } })).toEqual(['POST_MISSING'])
  })

  it('work a G-code post cannot describe is refused: edge drilling, turned-over drilling, aggregates, saws without a saw unit, 3D without 3D milling', () => {
    const d = data()
    const router = withRouter(d, { kind: 'template', ...SAMPLE_TEMPLATE })
    const fake = (patch: Partial<Toolpath>): Toolpath => ({ opId: 'o', kind: 'drill', name: 'Op', tool: null, feeds: { rpm: 1, feed: 1, plunge: 1 }, moves: [], intents: [], warnings: [], stats: { cut: 0, rapid: 0, minutes: 0 }, ...patch })
    const msg = (tp: Toolpath) => checkTextPost(router, { switchOn: true, toolpaths: [tp] }).map((i) => i.message)
    expect(msg(fake({ intents: [{ k: 'hdrill', x: 0, y: 0, z: 9, d: 8, depth: 30, dir: 'XP' as never, face: 5, tool: null, label: '' }] }))).toEqual(['Op: edge (horizontal) drilling cannot be written by a text post.'])
    expect(msg(fake({ intents: [{ k: 'vdrill', x: 0, y: 0, d: 5, depth: 10, through: false, tool: null, label: '', back: true }] }))).toEqual(['Op: drilling from the underside (part turned over) cannot be written by a text post.'])
    expect(msg(fake({ kind: 'edge' }))).toEqual(['Op: edge work with an aggregate cannot be written by a text post.'])
    expect(msg(fake({ kind: 'saw' }))).toEqual(['Op: Router two has no saw unit in its machine model.'])
    expect(msg(fake({ kind: 'finish3d', noOutput: 'no confirmed form' }))).toEqual(['Op: no confirmed form'])
    router.profile.physical = { ...router.profile.physical!, capabilities: { ...router.profile.physical!.capabilities, mill3d: false } }
    expect(msg(fake({ kind: 'rough3d' }))).toEqual(['Op: Router two does not declare 3D milling in its machine model.'])
    // the reference parts with edge work and turned-over holes are refused too
    const refused = allParts().filter((p) => checkTextPost(router, { switchOn: true, toolpaths: tpOf(p) }).length).map((p) => p.id)
    expect(refused.length).toBeGreaterThan(0)
    for (const p of edgeParts()) expect(refused).toContain(p.id)
  })

  it('a part through a machine\'s post: toolpaths with that machine\'s tools, the export checker\'s errors kept, writable only when all is clear', async () => {
    const d = data()
    withRouter(d, { kind: 'script', plugin: 'iso-router-post', post: 'iso-router' })
    const h = await PluginHost.start(install(POST))
    d.plugins = [{ ...install(POST, { machineOutput: true }), contributes: h.contributes }]
    const part = referenceParts()[0]
    const mat = d.library.materials[0]
    part.materialId = mat.id
    part.thickness = mat.thickness
    const off = planPartPost(d, d.machines![0].id, part)
    expect(off.writable).toBe(false)
    expect(off.issues.map((i) => i.code)).toContain('POST_OUTPUT_OFF')
    expect(off.issues.some((i) => /custom-part/i.test(i.message))).toBe(true) // the job's own check: custom-part output off
    d.settings.features = { ...d.settings.features, scriptPostOutput: true, camMprOutput: true }
    const on = planPartPost(d, d.machines![0].id, part)
    expect(on.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(on.writable).toBe(true)
    const text = (await runScriptPost(h, 'iso-router', on.input)).text
    expect(text).toBe(runTemplate(SAMPLE_TEMPLATE, on.input).text)
    expect(text).toMatch(/G81 X40\.000 Y40\.000/)
    // the main machine never: its post is the woodWOP writer
    expect(planPartPost(d, MAIN_MACHINE, part).writable).toBe(false)
    h.dispose()
  })

  it('batch runs never write woodWOP files for a machine with a text post: its set is checked and held', () => {
    const d = data((x) => (x.settings.features = { camMprOutput: true, batchMachinesOutput: true, scriptPostOutput: true }))
    const r = withRouter(d, { kind: 'template', ...SAMPLE_TEMPLATE })
    const res = runBatchCsv('t.csv', 'order,name,material,length,width,qty\nT1,Shelf,PB18-WHT,600,300,2', { data: d, readFile: () => null, now: new Date(NOW), setup: { id: 's', name: 'S', machines: [MAIN_MACHINE, r.id] } })
    const o = res.orders[0]
    expect(o.status).toBe('done')
    expect(o.machines.map((m) => [m.name, m.status])).toEqual([
      [d.machine.name, 'written'],
      ['Router two', 'held'],
    ])
    expect(o.files.some((f) => f.name.startsWith('Router-two/'))).toBe(false)
    expect(o.warnings).toContain('[Router two] Programs for Router two go through its template post; batch runs do not write sheet programs through text posts, so they were checked and not written.')
  })
})
