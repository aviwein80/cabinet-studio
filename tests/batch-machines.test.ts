import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { nodeBatchFs } from '../electron/batchFs'
import { readMpr } from '@/cam/mprRead'
import { activeBatchSetup, DEFAULT_BATCH_SETUP, runBatchCsv } from '@/core/batch'
import { writeBatchResult } from '@/core/batchWatch'
import { confirmKey, machineUnconfirmed } from '@/core/confirm'
import { dataFor, machineFolder, machineSetups, MAIN_MACHINE, newMachineSetup, profileOf } from '@/core/machines'
import { normalizeData } from '@/core/normalize'
import type { AppData, BatchSetup } from '@/core/types'
import { clone, data } from './helpers'

const dxf = (...es: (string | number)[][]) =>
  [0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, 4, 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES', ...es.flat(), 0, 'ENDSEC', 0, 'EOF'].join('\n') + '\n'
const ent = (type: string, ...kv: (string | number)[]) => [0, type, ...kv]
const box = (layer: string, x: number, y: number, w: number, h: number) =>
  ent('LWPOLYLINE', 8, layer, 90, 4, 70, 1, 10, x, 20, y, 10, x + w, 20, y, 10, x + w, 20, y + h, 10, x, 20, y + h)
const SIGN = dxf(box('CUTOUT', 0, 0, 800, 400), box('POCKET_D8', 100, 100, 200, 120), ent('CIRCLE', 8, 'DRILL_5_12', 10, 40, 20, 40, 40, 2.5))
const files: Record<string, string> = { 'sign.dxf': SIGN }
const read = (p: string) => files[p] ?? null
const NOW = new Date('2026-10-04T09:30:00')

const CSV = ['Order,Customer,Item,Name,Type,File,Material,Length,Width,Qty', 'M100,Weinreb,1,Shelf,,,MDF18,600,300,4', 'M100,Weinreb,2,Sign,drawing,sign.dxf,MDF18,,,1'].join('\r\n')

/** The shop data with a second machine: a WEEKE with its own tool numbers and a smaller cut-out tool. */
function twoMachines(patch: (d: AppData) => void = () => {}) {
  return data((d) => {
    d.settings.features = { camMprOutput: true, batchMachinesOutput: true }
    const m = newMachineSetup(d, { name: 'WEEKE second', from: 'main' })
    m.profile.mat = 'WEEKE'
    m.profile.tools = m.profile.tools.map((t) => ({ ...t, number: t.number + 100, ...(t.id === 't101' ? { diameter: 10 } : {}) }))
    m.profile.cutoutToolNumber = 201
    d.machines = [m]
    d.settings.batchSetups = [{ id: 'both', name: 'Both machines', machines: [MAIN_MACHINE, m.id] }]
    d.settings.batch = { inbox: '', outbox: '', setupId: 'both' }
    patch(d)
  })
}

const mprs = (o: { files: { name: string; data: string | Uint8Array }[] }, folder: string) =>
  o.files.filter((f) => f.name.endsWith('.mpr') && (folder ? f.name.startsWith(`${folder}/`) : !f.name.includes('/'))).map((f) => ({ name: f.name, doc: readMpr(new TextDecoder('latin1').decode(f.data as Uint8Array)) }))

describe('M2.9a machines and process steps', () => {
  it('a new machine starts as a placeholder copy with nothing confirmed', () => {
    const d = data((x) => {
      for (const u of machineUnconfirmed(x.machine)) confirmKey(x.machine, u.key)
      x.machine.placeholder = false
    })
    expect(machineUnconfirmed(d.machine)).toEqual([])
    const a = newMachineSetup(d, { name: 'Drilling step', kind: 'step', from: 'main' })
    expect(a.profile.placeholder).toBe(true)
    expect(a.profile.confirmed).toEqual([])
    expect(a.profile.physical?.placeholder).toBe(true)
    expect(machineUnconfirmed(a.profile).length).toBeGreaterThan(20)
    expect(d.machine.confirmed!.length).toBeGreaterThan(0) // the main machine is untouched
    d.machines = [a]
    const b = newMachineSetup(d, { name: 'Drilling step' })
    expect(b.id).not.toBe(a.id)
    expect(machineSetups(d).map((m) => m.id)).toEqual([MAIN_MACHINE, a.id])
    expect(profileOf(d, a.id)).toBe(a.profile)
    expect(profileOf(d, 'gone')).toBe(d.machine)
    expect(dataFor(d, a.id).machine).toBe(a.profile)
    expect(dataFor(d, MAIN_MACHINE)).toBe(d)
    expect(machineFolder({ id: 'x', name: 'WEEKE BHX / drill' })).toBe('WEEKE-BHX-drill')
  })

  it('extra machines survive saving and loading', () => {
    const d = twoMachines()
    const back = normalizeData(JSON.parse(JSON.stringify(d)))
    expect(back.machines).toEqual(d.machines)
    expect(back.settings.batchSetups).toEqual(d.settings.batchSetups)
    expect(activeBatchSetup(back.settings).id).toBe('both')
    expect(activeBatchSetup(data().settings)).toEqual(DEFAULT_BATCH_SETUP)
  })

  it('a batch run to two machine models gives two program sets', () => {
    const d = twoMachines()
    const res = runBatchCsv('two.csv', CSV, { data: d, readFile: read, now: NOW })
    const o = res.orders[0]
    expect(o.status).toBe('done')
    expect(o.machines.map((m) => [m.name, m.status, m.folder])).toEqual([
      [d.machine.name, 'written', ''],
      ['WEEKE second', 'written', 'WEEKE-second'],
    ])
    const a = mprs(o, '')
    const b = mprs(o, 'WEEKE-second')
    expect(a.length).toBeGreaterThan(0)
    expect(b.length).toBe(o.machines[1].sheets)
    for (const p of [...a, ...b]) expect(p.doc.errors).toEqual([])
    // each set is written for its own machine: header, tool numbers
    expect(a.every((p) => p.doc.header.MAT === 'HOMAG')).toBe(true)
    expect(b.every((p) => p.doc.header.MAT === 'WEEKE')).toBe(true)
    const tools = (ps: typeof a) => new Set(ps.flatMap((p) => p.doc.macros.map((m) => m.values.TNO).filter(Boolean)))
    expect([...tools(a)].every((t) => Number(t) < 200)).toBe(true)
    expect([...tools(b)].every((t) => Number(t) > 200)).toBe(true)
    expect(tools(b).has('201')).toBe(true)
    // machine-independent lists once, in the order folder; per-machine labels and sheet maps in each
    const names = o.files.map((f) => f.name)
    expect(names).toEqual(expect.arrayContaining(['M100_cutlist.csv', 'M100_bom.csv', 'M100_labels_100x70.pdf', 'WEEKE-second/M100_labels_100x70.pdf', 'WEEKE-second/M100_sheet-maps.pdf']))
    expect(names.some((n) => n.startsWith('WEEKE-second/') && n.endsWith('_cutlist.csv'))).toBe(false)
    const report = o.files.find((f) => f.name === 'M100_report.txt')!.data as string
    expect(report).toContain('WEEKE second:')
    expect(report).toContain('programs in WEEKE-second/')
  })

  it('the main machine alone gives exactly the Stage 1 output', () => {
    const plain = data((x) => (x.settings.features = { camMprOutput: true }))
    const one = runBatchCsv('two.csv', CSV, { data: plain, readFile: read, now: NOW })
    const withSetup = runBatchCsv('two.csv', CSV, { data: plain, readFile: read, now: NOW, setup: { id: 's', name: 'S', machines: [MAIN_MACHINE] } })
    const second = twoMachines()
    second.settings.features = { camMprOutput: true, batchMachinesOutput: true }
    const both = runBatchCsv('two.csv', CSV, { data: second, readFile: read, now: NOW })
    const top = (r: typeof one) => r.orders[0].files.filter((f) => !f.name.includes('/') && !f.name.endsWith('_report.txt')).map((f) => [f.name, typeof f.data === 'string' ? f.data : Buffer.from(f.data).toString('base64')])
    expect(top(withSetup)).toEqual(top(one))
    expect(top(both)).toEqual(top(one))
  })

  it('with the output switch off the other machine is checked but nothing is written for it', () => {
    const d = twoMachines((x) => (x.settings.features = { camMprOutput: true }))
    const res = runBatchCsv('two.csv', CSV, { data: d, readFile: read, now: NOW })
    const o = res.orders[0]
    expect(o.status).toBe('done')
    expect(o.machines[1].status).toBe('held')
    expect(o.machines[1].sheets).toBeGreaterThan(0)
    expect(o.files.some((f) => f.name.includes('/'))).toBe(false)
    expect(o.warnings.join(' ')).toMatch(/WEEKE second were checked but not written/)
    expect(o.files.find((f) => f.name.endsWith('_report.txt'))!.data).toMatch(/checked, not written/)
  })

  it('an export-checker error on either machine holds back the whole order', () => {
    const d = twoMachines((x) => {
      const p = x.machines![0].profile
      p.physical = { ...clone(p.physical!), table: { length: 2000, width: 1000 } }
    })
    const res = runBatchCsv('two.csv', CSV, { data: d, readFile: read, now: NOW })
    const o = res.orders[0]
    expect(o.status).toBe('blocked')
    expect(o.machines.map((m) => m.status)).toEqual(['blocked', 'blocked'])
    expect(o.machines[1].errors.join(' ')).toMatch(/^\[WEEKE second\] Sheet .* larger than the machine table/)
    expect(o.machines[0].errors).toEqual([])
    expect(o.files.map((f) => f.name)).toEqual(['M100_report.txt'])
  })

  it('a setup naming a machine that is gone runs the others and says so', () => {
    const d = twoMachines()
    const setup: BatchSetup = { id: 'x', name: 'Old setup', machines: ['m-gone', MAIN_MACHINE] }
    const res = runBatchCsv('two.csv', CSV, { data: d, readFile: read, now: NOW, setup })
    expect(res.rowErrors.map((e) => e.message)).toEqual(['Batch setup "Old setup": machine "m-gone" is not in the machine list; skipped.'])
    expect(res.orders[0].machines.map((m) => m.id)).toEqual([MAIN_MACHINE])
    expect(res.orders[0].status).toBe('done')
  })

  it('order folders get one sub-folder per other machine on disk', () => {
    const d = twoMachines()
    const res = runBatchCsv('two.csv', CSV, { data: d, readFile: read, now: NOW })
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-machines-'))
    const { written } = writeBatchResult(nodeBatchFs, { inbox: dir, outbox: path.join(dir, 'out') }, null, res)
    expect(written.length).toBe(1)
    const top = fs.readdirSync(written[0])
    expect(top).toContain('WEEKE-second')
    expect(fs.readdirSync(path.join(written[0], 'WEEKE-second')).filter((f) => f.endsWith('.mpr')).length).toBe(res.orders[0].machines[1].sheets)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
