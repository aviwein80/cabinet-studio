import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeEntity, newPart } from '@/cam/doc'
import { circle, pt, rect } from '@/cam/geom'
import { defaultOp } from '@/cam/ops'
import { hostAllowed, inFolders, normPath, pathAllowed } from '@/cam/plugin/access'
import { API_NAMES } from '@/cam/plugin/api'
import { PluginDenied, PluginError, PluginHost, type PluginEnv } from '@/cam/plugin/host'
import { limitGrants, parseManifest, pluginRecord, ungranted } from '@/cam/plugin/manifest'
import { acceptPluginPart } from '@/cam/plugin/partEdit'
import { quickjs } from '@/cam/plugin/quickjs'
import { recordMacro } from '@/cam/plugin/recorder'
import { pluginBatchSteps, pluginStepId } from '@/cam/plugin/steps'
import type { PluginGrants, PluginLogLine, PluginRecord } from '@/cam/plugin/types'
import type { CamPart } from '@/cam/types'
import { runBatchCsv } from '@/core/batch'
import { stepFileRefused } from '@/core/batchSteps'
import { sha256Hex } from '@/core/sha256'
import { MAIN_MACHINE } from '@/core/machines'
import type { BatchSetup } from '@/core/types'
import { data } from './helpers'

const SAMPLE = fs.readFileSync(path.resolve(import.meta.dirname, '../examples/plugins/sample-shop-tools.js'), 'utf8')
const NOW = '2026-10-06T10:00:00.000Z'
const head = (id: string, extra = '') => `// @plugin ${id}\n// @name ${id}\n${extra}\n`

function install(code: string, grants: PluginGrants = {}, enabled = true): PluginRecord {
  return { ...pluginRecord(code, 'test', NOW), grants, enabled }
}

function logger() {
  const lines: PluginLogLine[] = []
  return { lines, log: (l: PluginLogLine) => lines.push(l) }
}

async function start(code: string, grants: PluginGrants = {}, env: PluginEnv = {}) {
  const lg = logger()
  const h = await PluginHost.start(install(code, grants), { log: lg.log, ...env })
  return { h, lines: lg.lines }
}

function pocketPart(): CamPart {
  const p = newPart({ name: 'Panel', length: 600, width: 400, thickness: 18, entities: [] })
  p.layers.push({ id: 'POCKET', name: 'POCKET', color: '#f00', visible: true, locked: false })
  const o = makeEntity({ t: 'contour', c: rect(0, 0, 600, 400) }, 'outline')
  const a = makeEntity({ t: 'contour', c: rect(100, 100, 80, 60) }, 'POCKET')
  const b = makeEntity({ t: 'circle', c: pt(400, 200), r: 30 }, 'POCKET')
  const open = makeEntity({ t: 'contour', c: { segs: rect(0, 0, 10, 10).segs.slice(0, 2), closed: false } }, 'POCKET')
  p.entities = [o, a, b, open]
  p.outlineId = o.id
  p.ops = [{ ...defaultOp('profile', [o.id]), builtHash: 'h1', confirmed: ['profileStepdown'] }]
  return p
}

describe('M2.10a plugin header and grants', () => {
  it('reads the header without running the code; requests are only requests', () => {
    const { manifest, errors } = parseManifest(SAMPLE)
    expect(errors).toEqual([])
    expect(manifest).toMatchObject({ id: 'sample-shop-tools', name: 'Sample shop tools', version: '1.0', requests: { read: ['C:/Shop/Lists'] } })
    const r = pluginRecord(SAMPLE, 'sample', NOW)
    expect(r.enabled).toBe(false)
    expect(r.grants).toEqual({})
    expect(r.codeHash).toBe(sha256Hex(SAMPLE))
    expect(ungranted(r)).toEqual(['read files in C:/Shop/Lists'])
    // the screen can only grant what was asked for
    expect(limitGrants(r, { read: ['C:/Shop/Lists', 'C:/Windows'], write: ['C:/'], net: ['x.com'], machineOutput: true })).toEqual({ read: ['C:/Shop/Lists'] })
    expect(parseManifest('cs.log(1)').errors[0]).toMatch(/plugin header/)
    expect(parseManifest('// @plugin bad id!').errors[0]).toMatch(/may only use/)
    expect(parseManifest(head('x', '// @read Lists')).errors[0]).toMatch(/full paths/)
    expect(parseManifest(head('x', '// @net http://x.com/a')).errors[0]).toMatch(/plain host/)
  })

  it('changed code starts switched off with nothing granted; the sandbox refuses code that does not match its hash', async () => {
    const r1 = install(SAMPLE, { read: ['C:/Shop/Lists'] })
    const same = pluginRecord(SAMPLE, 'again', NOW, r1)
    expect(same.grants).toEqual({ read: ['C:/Shop/Lists'] })
    expect(same.enabled).toBe(true)
    const changed = pluginRecord(SAMPLE + '\n// one more line', 'update', NOW, r1)
    expect(changed.grants).toEqual({})
    expect(changed.enabled).toBe(false)
    const tampered: PluginRecord = { ...r1, code: SAMPLE.replace('30 %', '3 %') }
    await expect(PluginHost.start(tampered)).rejects.toThrow(/code changed/)
    // SHA-256 known answers
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3')
  })

  it('paths: full paths only, no climbing out, Windows paths without case, no look-alike folders', () => {
    expect(normPath('C:\\Shop\\Lists\\a.csv')).toBe('C:/Shop/Lists/a.csv')
    expect(normPath('c:/Shop/./Lists//a.csv')).toBe('C:/Shop/Lists/a.csv')
    expect(normPath('C:/Shop/Lists/../../Windows/x')).toBe('C:/Windows/x')
    expect(normPath('C:/../x')).toBeNull()
    expect(normPath('Lists/a.csv')).toBeNull()
    expect(normPath('/home/shop/../../..')).toBeNull()
    expect(normPath('\\\\server\\share\\lists\\a.csv')).toBe('//server/share/lists/a.csv')
    expect(normPath('C:/a\0b')).toBeNull()
    const g: PluginGrants = { read: ['C:/Shop/Lists'], write: ['/srv/reports'] }
    expect(pathAllowed(g, 'c:\\shop\\lists\\prices.csv', 'read')).toBe(true)
    expect(pathAllowed(g, 'C:/Shop/Lists', 'read')).toBe(true)
    expect(pathAllowed(g, 'C:/Shop/Lists2/prices.csv', 'read')).toBe(false)
    expect(pathAllowed(g, 'C:/Shop/Lists/../Secret.txt', 'read')).toBe(false)
    expect(pathAllowed(g, 'C:/Shop/Lists/prices.csv', 'write')).toBe(false)
    expect(pathAllowed(g, '/srv/reports/a.txt', 'write')).toBe(true)
    expect(pathAllowed(g, '/srv/reports/a.txt', 'read')).toBe(true)
    expect(pathAllowed(g, '/srv/Reports/a.txt', 'write')).toBe(false)
    expect(inFolders('/etc/passwd', ['/'])).toBe(true)
    expect(inFolders('/etc/passwd', [])).toBe(false)
    expect(hostAllowed({ net: ['prices.example.com'] }, 'https://prices.example.com/list?a=1')).toBe(true)
    expect(hostAllowed({ net: ['prices.example.com'] }, 'http://prices.example.com/list')).toBe(false)
    expect(hostAllowed({ net: ['prices.example.com'] }, 'https://evil.com/?prices.example.com')).toBe(false)
    expect(hostAllowed({ net: ['prices.example.com'] }, 'https://prices.example.com.evil.com/')).toBe(false)
    expect(hostAllowed({ net: ['prices.example.com'] }, 'https://prices.example.com:8443/')).toBe(false)
    expect(hostAllowed({ net: ['prices.example.com'] }, 'https://user:pw@prices.example.com/')).toBe(false)
    expect(hostAllowed({}, 'https://prices.example.com/')).toBe(false)
  })

  it('step files: no programs, folders or names Windows would save under another name', () => {
    for (const bad of ['x.mpr', 'X.MPR', 'x.nc', 'x.mpr.', 'x.mpr ', 'x.mpr. .', 'a/b.txt', 'a\\b.txt', 'x.txt:alt', '..', 'con\u0001.txt', '']) expect(stepFileRefused(bad), bad).toBe(true)
    for (const ok of ['S1_parts-summary.csv', 'report.txt', 'a.b.csv']) expect(stepFileRefused(ok), ok).toBe(false)
  })
})

describe('M2.10a the sandbox', () => {
  it('nothing of the app or the computer is reachable; only the cs object, frozen', async () => {
    const { h } = await start(
      head('probe') +
        `cs.menu.add({ id: 'probe', label: 'Probe' }, function () {
          var r = {}
          ;['require', 'process', 'fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'window', 'document', 'globalThis.__host', 'Deno', 'Bun', 'module', 'std', 'os'].forEach(function (n) {
            r[n] = n.indexOf('.') > 0 ? typeof globalThis.__host : typeof globalThis[n]
          })
          r.frozen = Object.isFrozen(cs) && Object.isFrozen(cs.files)
          var files = cs.files
          try { cs.files = null } catch (e) {}
          r.assign = cs.files === files ? 'refused' : 'replaced'
          return { message: JSON.stringify(r) }
        })`,
    )
    const out = (await h.call('menu', 'probe', '', { part: null })) as { result: { message: string } }
    const r = JSON.parse(out.result.message)
    for (const k of Object.keys(r)) if (k !== 'frozen' && k !== 'assign') expect(r[k], k).toBe('undefined')
    expect(r.frozen).toBe(true)
    expect(r.assign).toBe('refused')
    h.dispose()
  })

  it('a plugin that runs forever is stopped (set-up and commands), and the app carries on', async () => {
    await expect(PluginHost.start(install(head('spin') + 'while (true) {}'), { timeLimitMs: 300 })).rejects.toThrow(/longer than 0.3 s and was stopped/)
    const { h } = await start(head('spin2') + `cs.menu.add({ id: 'spin', label: 'Spin' }, function () { for (;;) {} }); cs.menu.add({ id: 'ok', label: 'OK' }, function () { return { message: 'still here' } })`, {}, { timeLimitMs: 300 })
    const t0 = Date.now()
    await expect(h.call('menu', 'spin', '', {})).rejects.toThrow(/was stopped/)
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(((await h.call('menu', 'ok', '', {})) as { result: { message: string } }).result.message).toBe('still here')
    h.dispose()
  })

  it('a plugin that grabs too much memory is stopped', async () => {
    const { h } = await start(head('hog') + `cs.menu.add({ id: 'hog', label: 'Hog' }, function () { var a = []; for (;;) a.push(1.5) })`, {}, { timeLimitMs: 30_000 })
    await expect(h.call('menu', 'hog', '', {})).rejects.toThrow(/ran out of its memory \(64 MB\) and was stopped/)
    h.dispose()
  }, 60_000)

  it('every name of the typed API exists in the sandbox; random numbers repeat from run to run', async () => {
    const code = head('names') + `cs.menu.add({ id: 'n', label: 'N' }, function () { var r = {}; Object.keys(cs).forEach(function (k) { r[k] = typeof cs[k] === 'object' ? Object.keys(cs[k]).filter(function (f) { return typeof cs[k][f] === 'function' }) : typeof cs[k] }); r.rnd = [Math.random(), Math.random()]; return { message: JSON.stringify(r) } })`
    const run = async () => {
      const { h } = await start(code)
      const out = JSON.parse(((await h.call('menu', 'n', '', {})) as { result: { message: string } }).result.message)
      h.dispose()
      return out
    }
    const a = await run()
    for (const [k, fns] of Object.entries(API_NAMES)) {
      if (fns) expect([...a[k]].sort(), k).toEqual([...fns].sort())
      else expect(a[k], k).not.toBe('undefined')
    }
    expect(Object.keys(a).filter((k) => k !== 'rnd').sort()).toEqual(Object.keys(API_NAMES).sort())
    const b = await run()
    expect(b.rnd).toEqual(a.rnd)
  })
})

describe('M2.10a acceptance: the sample plugin', () => {
  it('adds menu items and a batch step', async () => {
    const { h } = await start(SAMPLE)
    expect(h.contributes.menu).toEqual([
      { id: 'pocket-layer', label: 'Pocket the closed shapes on layer POCKET', area: 'part' },
      { id: 'part-list', label: 'Parts list as text', area: 'job' },
      { id: 'price-list', label: 'Count the lines of the price list', area: 'part' },
    ])
    expect(h.contributes.steps).toEqual([{ id: 'sheet-use', name: 'Sheet use check', description: expect.stringContaining('30 %'), hooks: ['afterNest', 'beforeOutput'] }])
    h.dispose()
  })

  it('its designer command adds a pocket on the POCKET shapes; the part comes back checked, nothing confirmed, to be calculated', async () => {
    const { h } = await start(SAMPLE)
    const before = pocketPart()
    const out = (await h.call('menu', 'pocket-layer', '', { part: structuredClone(before), selection: [], units: 'mm' })) as { part: unknown; result: { message: string } }
    expect(out.result.message).toBe('Added a pocket for 2 shapes. Check its depth and tool.')
    const { part, changes } = acceptPluginPart(before, out.part, 'Sample shop tools')
    expect(changes).toEqual(['1 operation added'])
    const op = part.ops[1]
    expect(op).toMatchObject({ kind: 'pocket', name: 'Pocket (layer POCKET)', geometry: [before.entities[1].id, before.entities[2].id] })
    expect(op.builtHash).toBeUndefined()
    expect(op.confirmed).toBeUndefined()
    // the operation the plugin did not touch keeps its state
    expect(part.ops[0]).toEqual(before.ops[0])
    h.dispose()
  })

  it('is denied the file it was not granted (and the refusal is logged); granted, it reads it', async () => {
    const reads: string[] = []
    const io = { readText: (p: string) => (reads.push(p), 'a,1\nb,2\nc,3\n') }
    const a = await start(SAMPLE, {}, { io })
    await expect(a.h.call('menu', 'price-list', '', { part: pocketPart() })).rejects.toThrow(/Reading C:\/Shop\/Lists\/prices.csv was not granted/)
    expect(reads).toEqual([])
    expect(a.lines).toEqual([{ plugin: 'sample-shop-tools', level: 'denied', text: 'Reading C:/Shop/Lists/prices.csv' }])
    a.h.dispose()
    const b = await start(SAMPLE, { read: ['C:/Shop/Lists'] }, { io })
    const out = (await b.h.call('menu', 'price-list', '', { part: pocketPart() })) as { result: { message: string } }
    expect(out.result.message).toBe('The price list has 3 lines.')
    expect(reads).toEqual(['C:/Shop/Lists/prices.csv'])
    b.h.dispose()
  })

  it('other ways round the grants are refused too: climbing out, writing with a read grant, other folders, the network', async () => {
    const io = { readText: () => 'secret', writeText: () => undefined, list: () => ['a'], fetchText: () => 'page' }
    const tries = {
      climb: `cs.files.read('C:/Shop/Lists/../Accounts/pay.csv')`,
      relative: `cs.files.read('prices.csv')`,
      write: `cs.files.write('C:/Shop/Lists/new.csv', 'x')`,
      list: `cs.files.list('C:/Shop')`,
      net: `cs.net.fetch('https://prices.example.com/')`,
      plain: `cs.net.fetch('http://allowed.example.com/')`,
    }
    const code = head('sneaky') + Object.entries(tries).map(([id, expr]) => `cs.menu.add({ id: '${id}', label: '${id}' }, async function () { try { await ${expr}; return { message: 'got in' } } catch (e) { return { message: e.name + ': ' + e.message } } })`).join('\n')
    const { h, lines } = await start(code, { read: ['C:/Shop/Lists'], net: ['allowed.example.com'] }, { io })
    for (const id of Object.keys(tries)) {
      const m = ((await h.call('menu', id, '', {})) as { result: { message: string } }).result.message
      expect(m, id).toMatch(/^PermissionError: .* was not granted/)
    }
    expect(lines.filter((l) => l.level === 'denied').map((l) => l.text)).toEqual(['Reading C:/Shop/Accounts/pay.csv', 'Reading "prices.csv" (not a full path)', 'Writing C:/Shop/Lists/new.csv', 'Reading C:/Shop', 'Fetching https://prices.example.com/', 'Fetching http://allowed.example.com/'])
    h.dispose()
  })

  it('granted access works the same with answers that come later (the desktop app asks its main process)', async () => {
    const io = { readText: async () => 'x\ny\n', fetchText: async (url: string) => `fetched ${url}`, writeText: async () => undefined }
    const code = head('later', '// @read /srv/lists\n// @net api.example.com') + `cs.menu.add({ id: 'go', label: 'Go' }, async function () { var t = await cs.files.read('/srv/lists/a.txt'); var n = await cs.net.fetch('https://api.example.com/p'); return { message: t.length + ' ' + n } })`
    const { h } = await start(code, { read: ['/srv/lists'], net: ['api.example.com'] }, { io })
    expect(((await h.call('menu', 'go', '', {})) as { result: { message: string } }).result.message).toBe('4 fetched https://api.example.com/p')
    // a batch step cannot wait for the network
    expect(() => h.callNow('menu', 'go', '', {})).toThrow(/has to wait/)
    h.dispose()
  })
})

describe('M2.10a part changes from plugins are checked', () => {
  it('confirmations, approvals, models and "up to date" marks cannot be made by a plugin', () => {
    const before = pocketPart()
    before.review = { status: 'draft', file: 'x.pdf', drafter: 'AI' }
    const raw = structuredClone(before)
    raw.review = { status: 'approved', file: 'x.pdf', drafter: 'AI', reviewedBy: 'plugin' }
    raw.ops[0] = { ...raw.ops[0], confirmed: ['profileStepdown', 'feedRate'], builtHash: 'forged', toolData: { number: 1 } as never, levels: { ...raw.ops[0].levels, depth: 5 } }
    raw.ops.push({ ...defaultOp('drill', [before.entities[2].id]), confirmed: ['drillPeck'], builtHash: 'forged' })
    raw.models = [{ id: 'm' } as never]
    const { part, changes } = acceptPluginPart(before, raw, 'P')
    expect(part.review).toEqual(before.review)
    expect(part.models).toBeUndefined()
    expect(part.ops[0].confirmed).toEqual(['profileStepdown'])
    expect(part.ops[0].builtHash).toBeUndefined()
    expect(part.ops[0].toolData).toBeUndefined()
    expect(part.ops[1].confirmed).toBeUndefined()
    expect(part.ops[1].builtHash).toBeUndefined()
    expect(changes).toEqual(['1 operation added', '1 operation changed'])
  })

  it('broken parts are refused with the reasons', () => {
    const before = pocketPart()
    const bad = (f: (p: CamPart) => void) => {
      const p = structuredClone(before)
      f(p)
      return () => acceptPluginPart(before, p, 'P')
    }
    expect(bad((p) => p.ops.push({ ...defaultOp('pocket', ['nope']) }))).toThrow(/shape nope does not exist/)
    expect(bad((p) => p.ops.push({ ...defaultOp('pocket', []), kind: 'laser' as never }))).toThrow(/unknown kind "laser"/)
    expect(bad((p) => (p.thickness = -1))).toThrow(/thickness must be above 0/)
    expect(bad((p) => (p.entities[1] = { ...p.entities[1], g: { t: 'blob' } as never }))).toThrow(/unknown geometry/)
    expect(bad((p) => p.entities.push(structuredClone(p.entities[1])))).toThrow(/used twice/)
    expect(bad((p) => ((p.ops[0] as { levels: unknown }).levels = 'deep'))).toThrow(/levels has the wrong type/)
    expect(bad((p) => (p.length = Number.NaN))).toThrow(/not a number/)
    expect(() => acceptPluginPart(before, 'x', 'P')).toThrow(/did not return a part/)
  })
})

describe('M2.10a macro recorder', () => {
  it('records the changes as a plugin that makes them again: replayed on the starting part it gives the recorded part', async () => {
    const before = pocketPart()
    before.ops.push(defaultOp('drill', [before.entities[2].id]), defaultOp('engrave', [before.entities[1].id]))
    const after = structuredClone(before)
    const extra = makeEntity({ t: 'circle', c: pt(50, 50), r: 4 }, 'holes')
    after.entities.push(extra)
    after.entities[1] = { ...after.entities[1], g: { t: 'contour', c: rect(110, 100, 80, 60) } }
    after.ops.push(defaultOp('drill', [extra.id], { name: 'Drill new hole' }))
    after.ops[0] = { ...after.ops[0], levels: { ...after.ops[0].levels, depth: 12 } }
    after.ops.splice(2, 1) // remove the engrave
    after.ops = [after.ops[2], after.ops[0], after.ops[1]] // the new drill first
    after.layers.push({ id: 'DRILLS', name: 'DRILLS', color: '#0f0', visible: true, locked: false })
    after.notes = 'recorded'
    const { code, steps } = recordMacro(before, after, { name: 'My macro', when: '6 Oct 2026' })
    expect(steps).toEqual(['add layer DRILLS', 'change shape ' + before.entities[1].id, 'add a circle on holes', 'add operation Drill new hole', 'change operation Profile (levels)', 'remove operation Engrave', 'set notes'])
    expect(code.startsWith('// @plugin recorded-my-macro\n// @name My macro\n')).toBe(true)
    const { h } = await start(code)
    expect(h.contributes.menu).toEqual([{ id: 'replay', label: 'My macro', area: 'part' }])
    const out = (await h.call('menu', 'replay', '', { part: structuredClone(before) })) as { part: unknown }
    const { part } = acceptPluginPart(before, out.part, 'macro')
    const plain = (p: CamPart) => ({ ...p, ops: p.ops.map(({ builtHash: _b, ...o }) => o) })
    expect(plain(part)).toEqual(plain({ ...after, updatedAt: before.updatedAt }))
    h.dispose()
  })

  it('on a part that already has those ids, new shapes get new ids and the new operations follow them', async () => {
    const before = pocketPart()
    const after = structuredClone(before)
    const extra = makeEntity({ t: 'contour', c: rect(300, 50, 40, 40) }, 'POCKET')
    after.entities.push(extra)
    after.ops.push(defaultOp('pocket', [extra.id]))
    const { code } = recordMacro(before, after, { name: 'Add a pocket' })
    const { h } = await start(code)
    // run it twice: the second run's shape and operation cannot reuse the ids
    const once = acceptPluginPart(before, ((await h.call('menu', 'replay', '', { part: structuredClone(before) })) as { part: unknown }).part, 'm').part
    const twice = acceptPluginPart(once, ((await h.call('menu', 'replay', '', { part: structuredClone(once) })) as { part: unknown }).part, 'm').part
    expect(twice.entities).toHaveLength(6)
    expect(twice.ops).toHaveLength(3)
    const [e5, e6] = twice.entities.slice(4)
    expect(e5.id).toBe(extra.id)
    expect(e6.id).not.toBe(extra.id)
    expect(e6.g).toEqual(extra.g)
    expect(twice.ops[2].geometry).toEqual([e6.id])
    expect(twice.ops[2].id).not.toBe(twice.ops[1].id)
    h.dispose()
  })

  it('records nothing as nothing', () => {
    const p = pocketPart()
    expect(recordMacro(p, structuredClone(p), { name: 'Empty' }).steps).toEqual([])
  })
})

describe('M2.10a acceptance: the batch hook', () => {
  const CSV = ['order,name,material,length,width,qty', 'P1,Shelf,PB18-WHT,600,300,2', 'P1,Side,PB18-WHT,720,560,1'].join('\n')
  const on = () => data((x) => (x.settings.features = { camMprOutput: true }))
  const setup = (steps: string[]): BatchSetup => ({ id: 's', name: 'Plugin steps', machines: [MAIN_MACHINE], steps })
  const files = (r: ReturnType<typeof runBatchCsv>) => r.orders[0].files.filter((f) => !f.name.endsWith('_report.txt')).map((f) => [f.name, typeof f.data === 'string' ? f.data : Buffer.from(f.data).toString('base64')])

  it('the sample plugin\'s step runs in the one batch engine: warnings after nesting, a summary file before output, nothing else changed', async () => {
    const d = on()
    d.plugins = [install(SAMPLE)]
    const mod = await quickjs()
    const ps = pluginBatchSteps(d, mod)
    expect(ps.steps.map((s) => s.id)).toEqual([pluginStepId('sample-shop-tools', 'sheet-use')])
    const plain = runBatchCsv('p.csv', CSV, { data: d, readFile: () => null, now: new Date(NOW) })
    const res = runBatchCsv('p.csv', CSV, { data: d, readFile: () => null, now: new Date(NOW), setup: setup(['plugin:sample-shop-tools/sheet-use']), extraSteps: ps.steps })
    ps.dispose()
    const o = res.orders[0]
    expect(o.status).toBe('done')
    expect(o.warnings.some((w) => /^Sheet use check: sheet 1 \(PB18-WHT\) is only \d+ % used\.$/.test(w))).toBe(true)
    const summary = String(o.files.find((f) => f.name === 'P1_parts-summary.csv')!.data).trim().split('\r\n')
    expect(summary[0]).toBe('No,Part ID,Part,Material,Length,Width,Thickness')
    expect(summary).toHaveLength(4)
    expect(summary.slice(1).map((l) => l.split(',')[2]).sort()).toEqual(['"Shelf"', '"Shelf"', '"Side"'])
    expect(files(res).filter(([n]) => n !== 'P1_parts-summary.csv')).toEqual(files(plain))
  })

  it('a plugin step cannot add a program or escape the order folder, and a plugin that cannot start holds the order back', async () => {
    const d = on()
    const evil = head('evil') + `cs.batch.step({ id: 'prog', name: 'Sneaky', beforeOutput: function () { return { files: [{ name: 'extra.mpr.', data: '[H' }, { name: '../up.txt', data: 'x' }] } } })`
    const broken = { ...install(head('broken') + 'cs.batch.step({ id: "chk", name: "Check", afterNest: function () {} })'), contributes: { menu: [], steps: [{ id: 'chk', name: 'Check', description: '', hooks: ['afterNest' as const] }], posts: [] } }
    broken.code += '\nthis is not javascript'
    broken.codeHash = sha256Hex(broken.code)
    d.plugins = [install(evil), broken, install(head('off') + 'cs.batch.step({ id: "x", name: "X", afterNest: function () { return { messages: [{ severity: "error", text: "should not run" }] } } })', {}, false)]
    const ps = pluginBatchSteps(d, await quickjs())
    expect(ps.problems).toEqual([expect.stringMatching(/^broken: broken: SyntaxError: expecting ';'/)])
    const r1 = runBatchCsv('p.csv', CSV, { data: d, readFile: () => null, now: new Date(NOW), setup: setup(['plugin:evil/prog']), extraSteps: ps.steps })
    expect(r1.orders[0].status).toBe('blocked')
    expect(r1.orders[0].errors).toEqual(['Sneaky: may not write extra.mpr. (programs come only from the program writers; names must be new and without folders).', 'Sneaky: may not write ../up.txt (programs come only from the program writers; names must be new and without folders).'])
    expect(r1.orders[0].files.map((f) => f.name)).toEqual(['P1_report.txt'])
    const r2 = runBatchCsv('p.csv', CSV, { data: d, readFile: () => null, now: new Date(NOW), setup: setup(['plugin:broken/chk']), extraSteps: ps.steps })
    expect(r2.orders[0].status).toBe('blocked')
    expect(r2.orders[0].errors[0]).toMatch(/^Check: the plugin broken could not start/)
    // a switched-off plugin's step is not run (the setup is told it is not available)
    const r3 = runBatchCsv('p.csv', CSV, { data: d, readFile: () => null, now: new Date(NOW), setup: setup(['plugin:off/x']), extraSteps: ps.steps })
    expect(r3.orders[0].status).toBe('done')
    expect(r3.orders[0].warnings).toContain('Batch step "plugin:off/x" is not available; skipped.')
    ps.dispose()
  })

  it('without the sandbox (no engine) the steps hold the order back rather than being skipped', () => {
    const d = on()
    d.plugins = [{ ...install(SAMPLE), contributes: { menu: [], steps: [{ id: 'sheet-use', name: 'Sheet use check', description: '', hooks: ['afterNest', 'beforeOutput'] }], posts: [] } }]
    const ps = pluginBatchSteps(d, null)
    const r = runBatchCsv('p.csv', CSV, { data: d, readFile: () => null, now: new Date(NOW), setup: setup(['plugin:sample-shop-tools/sheet-use']), extraSteps: ps.steps })
    expect(r.orders[0].status).toBe('blocked')
    expect(r.orders[0].errors[0]).toMatch(/sandbox is not available/)
  })

  it('installed plugins and their grants survive saving and loading (JSON and the SQLite option)', async () => {
    const { normalizeData } = await import('@/core/normalize')
    const { readShopDb, writeShopDb } = await import('@/core/shopDb')
    const d = on()
    d.plugins = [install(SAMPLE, { read: ['C:/Shop/Lists'] })]
    const back = normalizeData(JSON.parse(JSON.stringify(d)))
    expect(back.plugins).toEqual(d.plugins)
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(':memory:')
    const h = { exec: (q: string) => void db.exec(q), run: (q: string, ...a: (string | number | null)[]) => void db.prepare(q).run(...a), all: (q: string, ...a: (string | number | null)[]) => db.prepare(q).all(...a) as Record<string, unknown>[] }
    writeShopDb(h, d)
    expect(normalizeData(readShopDb(h)).plugins).toEqual(d.plugins)
  })

  it('throws PluginDenied as a PluginError', () => {
    expect(new PluginDenied('x')).toBeInstanceOf(PluginError)
    expect(circle(pt(0, 0), 1).segs).toHaveLength(2)
  })
})
