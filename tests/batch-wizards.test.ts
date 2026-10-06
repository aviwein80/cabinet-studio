import { describe, expect, it } from 'vitest'
import { dxfToPart } from '@/cam/dxf'
import { defaultOp, orderByTool } from '@/cam/ops'
import { BUILTIN_RECIPES, BUILTIN_RULESETS } from '@/cam/rules'
import { newPart } from '@/cam/doc'
import { checkPassword, hiddenScreens, isLocked, missingRecipeReport, moveTool, newLock, recipeReportCsv, toolOrderOf, unmachinedLayers } from '@/core/admin'
import { DEFAULT_BATCH_KINDS, DEFAULT_BATCH_SETUP, runBatchCsv } from '@/core/batch'
import { MAIN_MACHINE, newMachineSetup } from '@/core/machines'
import { batchSetupFromWizard, batchWizardProblems, exactLayer, layerNames, partLayerNames, ruleSetFromWizard, ruleWizardProblems, suggestLayer, type BatchWizardAnswers } from '@/core/wizards'
import { layerMatches } from '@/cam/rules'
import { BATCH_CHECK_LIST, BATCH_EXAMPLE } from '@/core/batchExample'
import { parseBatchCsv } from '@/core/batch'
import { data } from './helpers'

// the Stage 1 batch test's list and drawings (tests/batch.test.ts)
const dxf = (...es: (string | number)[][]) =>
  [0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, 4, 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES', ...es.flat(), 0, 'ENDSEC', 0, 'EOF'].join('\n') + '\n'
const ent = (type: string, ...kv: (string | number)[]) => [0, type, ...kv]
const box = (layer: string, x: number, y: number, w: number, h: number) =>
  ent('LWPOLYLINE', 8, layer, 90, 4, 70, 1, 10, x, 20, y, 10, x + w, 20, y, 10, x + w, 20, y + h, 10, x, 20, y + h)
const SIGN = dxf(box('CUTOUT', 0, 0, 800, 400), box('POCKET_D8', 100, 100, 200, 120), ent('CIRCLE', 8, 'DRILL_5_12', 10, 40, 20, 40, 40, 2.5))
const PLAIN = dxf(box('CUTOUT', 0, 0, 500, 300))
const CSV = [
  'Order,Customer,Item,Name,Type,File,Style,Material,Length,Width,Qty,Priority,Kit,Hinge,Pull,Nest',
  'B100,Weinreb,1,Shelf,,,,MDF18,600,300,4,,,,,',
  'B100,Weinreb,2,Sign,drawing,sign.dxf,,MDF18,,,1,5,,,,',
  'B100,Weinreb,3,Pantry door,door,,Shaker,MDF18,1200,450,2,,K1,right,128,',
  'B100,Weinreb,4,Skip me,,,,MDF18,600,300,1,,,,,N',
  'B200,Other,1,Plain,,plain.dxf,,MDF18,,,2,,,,,',
].join('\r\n')
const files: Record<string, string> = { 'sign.dxf': SIGN, 'plain.dxf': PLAIN }
const read = (p: string) => files[p] ?? null
const NOW = new Date('2026-10-04T09:30:00')
const on = () => data((x) => (x.settings.features = { camMprOutput: true, batchMachinesOutput: true }))
const bytes = (r: ReturnType<typeof runBatchCsv>) => r.orders.map((o) => o.files.map((f) => [f.name, typeof f.data === 'string' ? f.data : Buffer.from(f.data).toString('base64')]))

describe('M2.9d batch setup wizard', () => {
  const answers: BatchWizardAnswers = { name: 'Shop standard', machines: [MAIN_MACHINE], kinds: [...DEFAULT_BATCH_KINDS], steps: [] }

  it('checks each step before moving on', () => {
    const d = data((x) => (x.settings.batchSetups = [{ ...DEFAULT_BATCH_SETUP, name: 'Taken' }]))
    expect(batchWizardProblems(0, { ...answers, name: ' ' }, d)).toEqual(['Give the setup a name.'])
    expect(batchWizardProblems(0, { ...answers, name: 'taken' }, d)).toEqual(['A setup called "taken" already exists.'])
    expect(batchWizardProblems(1, { ...answers, machines: [] }, d)).toEqual(['Pick at least one machine.'])
    expect(batchWizardProblems(1, { ...answers, machines: ['m-x'] }, d)).toEqual(['Machine "m-x" is not in the machine list.'])
    expect(batchWizardProblems(2, { ...answers, kinds: [] }, d)).toEqual(['Pick at least one output.'])
    expect(batchWizardProblems(3, { ...answers, steps: ['nope'] }, d)).toEqual(['Batch step "nope" is not available.'])
    expect(batchWizardProblems(4, answers, d)).toEqual([])
    const s = batchSetupFromWizard(answers, data((x) => (x.settings.batchSetups = [{ id: 'bs-shop-standard', name: 'Old', machines: [MAIN_MACHINE] }])))
    expect(s).toEqual({ id: 'bs-shop-standard-2', name: 'Shop standard', machines: [MAIN_MACHINE], kinds: DEFAULT_BATCH_KINDS, steps: [] })
  })

  it('a wizard setup passes the Stage 1 batch tests, file for file', () => {
    const d = on()
    const setup = batchSetupFromWizard(answers, d)
    const before = runBatchCsv('orders.csv', CSV, { data: d, readFile: read, now: NOW })
    const res = runBatchCsv('orders.csv', CSV, { data: d, readFile: read, now: NOW, setup })
    // the C8 expectations
    expect(res.orders.map((o) => o.status)).toEqual(['done', 'done'])
    expect(res.orders[0].folder).toBe('B100_20261004-0930')
    expect(res.orders[0].parts).toBe(7)
    expect(res.orders[0].files.map((f) => f.name)).toEqual(expect.arrayContaining(['B100_labels_100x70.pdf', 'B100_sheet-maps.pdf', 'B100_cutlist.csv', 'B100_bom.csv', 'B100_report.txt']))
    expect(bytes(res)).toEqual(bytes(before))
    // and with custom-part output off it is held back exactly like before
    const off = runBatchCsv('orders.csv', CSV, { data: data(), readFile: read, now: NOW, setup })
    expect(off.orders.map((o) => o.status)).toEqual(['blocked', 'done'])
    expect(off.orders[0].files.map((f) => f.name)).toEqual(['B100_report.txt'])
  })

  it('the shipped example list reads cleanly; the wizard\'s check list runs with a new setup', () => {
    expect(parseBatchCsv(BATCH_EXAMPLE, data(), { defaultOrder: 'x' }).errors).toEqual([])
    const setup = batchSetupFromWizard(answers, data())
    const done = runBatchCsv('setup-check.csv', BATCH_CHECK_LIST, { data: on(), readFile: read, now: NOW, setup })
    expect(done.rowErrors).toEqual([])
    expect(done.orders.map((o) => o.status)).toEqual(['done'])
    expect(done.orders[0].files.some((f) => f.name.endsWith('.mpr'))).toBe(true)
    // with custom-part output off (the shipped default) the drilled side holds it back, as it should
    expect(runBatchCsv('setup-check.csv', BATCH_CHECK_LIST, { data: data(), readFile: read, now: NOW, setup }).orders[0].status).toBe('blocked')
  })

  it('a wizard setup with two machines and a step passes the M2.9 tests', () => {
    const d = on()
    const m = newMachineSetup(d, { name: 'Second', from: 'main' })
    d.machines = [m]
    const setup = batchSetupFromWizard({ ...answers, machines: [MAIN_MACHINE, m.id], steps: ['waste-areas'] }, d)
    expect(batchWizardProblems(4, { ...answers, machines: [MAIN_MACHINE, m.id], steps: ['waste-areas'] }, d)).toEqual([])
    const res = runBatchCsv('orders.csv', CSV, { data: d, readFile: read, now: NOW, setup })
    expect(res.orders.map((o) => o.status)).toEqual(['done', 'done'])
    expect(res.orders[0].machines.map((x) => x.status)).toEqual(['written', 'written'])
    const names = res.orders[0].files.map((f) => f.name)
    // the same programs for each machine (sheet programs and the door's turned-over program)
    expect(names.filter((n) => n.startsWith('Second/') && n.endsWith('.mpr')).map((n) => n.slice(7))).toEqual(names.filter((n) => !n.includes('/') && n.endsWith('.mpr')))
    expect(names).toEqual(expect.arrayContaining(['B100_waste-areas.csv', 'Second/B100_waste-areas.csv']))
  })
})

describe('M2.9d layer-rule wizard', () => {
  const layersOf = (text: string) => partLayerNames(dxfToPart(text, 'x').part)

  it('suggests what the shop rules do with each layer and checks each step', () => {
    const lib = data().library
    const layers = layerNames([...layersOf(SIGN), ...layersOf(PLAIN), 'cutout', 'NOTES'])
    expect(layers).toEqual(['CUTOUT', 'POCKET_D8', 'DRILL_5_12', 'NOTES'])
    expect(layers.map((l) => [l, suggestLayer(l, lib).recipeId, suggestLayer(l, lib).depthFromName])).toEqual([
      ['CUTOUT', 'rc-auto', false],
      ['POCKET_D8', 'rc-pocket', true],
      ['DRILL_5_12', 'rc-drill', true],
      ['NOTES', null, false],
    ])
    const a = { name: 'Sign shop', layers: layers.map((l) => suggestLayer(l, lib)), outlineLayer: '', alignLongestEdge: false }
    expect(ruleWizardProblems(0, { ...a, name: 'Shop layer names' }, lib)).toEqual(['A rule set called "Shop layer names" already exists.'])
    expect(ruleWizardProblems(1, { ...a, layers: [] }, lib)).toEqual(['Add the layer names your drawings use.'])
    expect(ruleWizardProblems(2, { ...a, layers: a.layers.map((l) => ({ ...l, recipeId: null })) }, lib)).toEqual(['Choose machining for at least one layer.'])
    expect(ruleWizardProblems(3, a, lib)).toEqual([])
    const set = ruleSetFromWizard(a, lib)
    expect(set.rules.map((r) => [r.layer, r.recipeId, r.order])).toEqual([
      ['CUTOUT', 'rc-auto', 0],
      ['POCKET_D8', 'rc-pocket', 1],
      ['DRILL_5_12', 'rc-drill', 2],
    ])
    // names with wildcard characters stay exact
    expect(layerMatches(exactLayer('HOLE*5'), 'HOLE*5')).toBe(true)
    expect(layerMatches(exactLayer('HOLE*5'), 'HOLE_X_5')).toBe(false)
    expect(layerMatches(exactLayer('/x/'), '/x/')).toBe(true)
  })

  it('a wizard rule set machines the Stage 1 batch drawings exactly as the shop rules do', () => {
    const d = on()
    const layers = layerNames([...layersOf(SIGN), ...layersOf(PLAIN)])
    const set = ruleSetFromWizard({ name: 'Sign shop', layers: layers.map((l) => suggestLayer(l, d.library)), outlineLayer: '', alignLongestEdge: false }, d.library)
    const shop = runBatchCsv('orders.csv', CSV, { data: d, readFile: read, now: NOW })
    // as the only rule set (the default for drawing rows) ...
    const only = runBatchCsv('orders.csv', CSV, { data: { ...d, library: { ...d.library, layerRules: [set] } }, readFile: read, now: NOW })
    // ... and named in the rules column next to the shop set
    const withRules = CSV.split('\r\n').map((l, i) => `${l},${i === 0 ? 'Rules' : l.includes('.dxf') ? 'Sign shop' : ''}`).join('\r\n')
    const named = runBatchCsv('orders.csv', withRules, { data: { ...d, library: { ...d.library, layerRules: [...BUILTIN_RULESETS, set] } }, readFile: read, now: NOW })
    for (const r of [only, named]) {
      expect(r.orders.map((o) => o.status)).toEqual(['done', 'done'])
      expect(r.orders.flatMap((o) => o.warnings).filter((w) => /No rule for layers/.test(w))).toEqual([])
      const mpr = (x: typeof r) => bytes(x).map((o) => o.filter(([n]) => n.endsWith('.mpr')))
      expect(mpr(r)).toEqual(mpr(shop))
    }
  })
})

describe('M2.9d admin tools', () => {
  it('tool-change order: saved order first, then the rest; Order by tool follows it', () => {
    const m = data().machine
    const order = toolOrderOf({ ...m, toolOrder: [103, 999, 101, 103] })
    expect(order.slice(0, 2)).toEqual([103, 101])
    expect(order.length).toBe(m.tools.length)
    expect(moveTool(order, 101, -1).slice(0, 2)).toEqual([101, 103])
    expect(moveTool(order, 103, -1)).toEqual(order)
    const a = { ...defaultOp('pocket', []), id: 'a' }
    const b = { ...defaultOp('profile', []), id: 'b' }
    const tool = (o: { id: string }) => m.tools.find((t) => t.number === (o.id === 'a' ? 101 : 103))!
    expect(orderByTool([a, b], tool, toolOrderOf({ ...m, toolOrder: [103] })).map((o) => o.id)).toEqual(['b', 'a'])
    expect(orderByTool([a, b], tool, toolOrderOf(m)).map((o) => o.id)).toEqual(['a', 'b'])
  })

  it('missing-recipe report: deleted recipes, empty sets, unmachined layers', () => {
    const d = data((x) => {
      x.library.recipes = BUILTIN_RECIPES.filter((r) => r.id !== 'rc-pocket').concat([{ id: 'rc-empty', name: 'Empty', ops: [] }])
      x.library.layerRules = [...BUILTIN_RULESETS, { id: 'rs-none', name: 'Nothing yet', rules: [], alignLongestEdge: false }]
      x.library.doorStyles = [{ id: 'ds', name: 'Raised', kind: 'shaker', defaults: {}, fieldRecipeId: 'rc-gone' }]
      const { part } = dxfToPart(SIGN, 'Sign')
      x.jobs.push({ id: 'j', number: 'J7', name: '', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [{ ...part, ops: [{ ...defaultOp('drill', part.entities.filter((e) => part.layers.find((l) => l.id === e.layer)?.name === 'DRILL_5_12').map((e) => e.id)) }] }] })
      x.library.partLibrary = [newPart({ name: 'Blank' })]
    })
    const rows = missingRecipeReport(d)
    expect(rows).toEqual([
      { where: 'Recipe Empty', problem: 'has no operations.' },
      { where: 'Rule set Shop layer names, layer /^pocket/', problem: 'uses recipe rc-pocket, which no longer exists.' },
      { where: 'Rule set Nothing yet', problem: 'has no rules.' },
      { where: 'Door style Raised', problem: 'panel-field recipe rc-gone no longer exists.' },
      { where: 'Job J7, part Sign', problem: '1 shape on layer POCKET_D8 with no operation.' },
    ])
    expect(recipeReportCsv(rows).split('\r\n')[0]).toBe('Where,Problem')
    expect(missingRecipeReport(data())).toEqual([])
    expect(unmachinedLayers(newPart({}))).toEqual([])
  })

  it('password on the defaults, hidden screens', async () => {
    const lock = await newLock('n200shop', 'fixed-salt')
    expect(lock.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(lock.hash).not.toContain('n200shop')
    expect(await checkPassword(lock, 'n200shop')).toBe(true)
    expect(await checkPassword(lock, 'N200shop')).toBe(false)
    expect(await checkPassword(undefined, 'anything')).toBe(true)
    await expect(newLock('abc')).rejects.toThrow(/at least 4/)
    expect((await newLock('n200shop')).salt).not.toBe((await newLock('n200shop')).salt)
    const s = { admin: { lock, hidden: ['parts', 'jobs', 'batch', 'settings'] } }
    expect(isLocked(s, false)).toBe(true)
    expect(isLocked(s, true)).toBe(false)
    expect(isLocked({}, false)).toBe(false)
    expect(hiddenScreens(s)).toEqual(['parts', 'batch'])
  })
})
