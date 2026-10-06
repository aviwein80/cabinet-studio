import { afterEach, describe, expect, it } from 'vitest'
import { jobCosts } from '@/core/areas'
import { itemPart, parseBatchCsv, runBatchCsv } from '@/core/batch'
import { batchSteps, registerBatchStep, type BatchStep } from '@/core/batchSteps'
import { MAIN_MACHINE, newMachineSetup } from '@/core/machines'
import { runJob } from '@/core/pipeline'
import type { BatchSetup, Job } from '@/core/types'
import { data } from './helpers'

const NOW = new Date('2026-10-04T09:30:00')
const none = () => null
const CSV = ['order,name,material,length,width,qty', 'S1,Shelf,PB18-WHT,600,300,6', 'S1,Side,PB18-WHT,720,560,4'].join('\n')
const on = () => data((x) => (x.settings.features = { camMprOutput: true, batchMachinesOutput: true }))
const setup = (steps: string[], machines = [MAIN_MACHINE]): BatchSetup => ({ id: 's', name: 'Steps', machines, steps })
const bytes = (r: ReturnType<typeof runBatchCsv>) => r.orders[0].files.filter((f) => !f.name.endsWith('_report.txt')).map((f) => [f.name, typeof f.data === 'string' ? f.data : Buffer.from(f.data).toString('base64')])

let undo: (() => void)[] = []
afterEach(() => {
  for (const u of undo) u()
  undo = []
})
const add = (s: BatchStep) => undo.push(registerBatchStep(s))

describe('M2.9c batch steps', () => {
  it('waste areas: each sheet\'s scrap and remnants in a CSV, the nest\'s own numbers', () => {
    const d = on()
    const plain = runBatchCsv('w.csv', CSV, { data: d, readFile: none, now: NOW })
    const res = runBatchCsv('w.csv', CSV, { data: d, readFile: none, now: NOW, setup: setup(['waste-areas']) })
    const o = res.orders[0]
    expect(o.status).toBe('done')
    const csv = String(o.files.find((f) => f.name === 'S1_waste-areas.csv')!.data).trim().split('\r\n')
    expect(csv[0]).toBe('Sheet,Material,Sheet m2,Parts m2,Remnants m2,Scrap m2,Scrap %,Remnant pieces')
    // the same job measured directly with the area module
    const { orders } = parseBatchCsv(CSV, d, { defaultOrder: 'x' })
    const job: Job = { id: 'batch-S1', number: 'S1', name: '', customer: '', notes: '', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), cabinets: [], camParts: orders[0].items.map((it) => itemPart(it, d, none).part!) }
    const out = runJob(job, d)
    const costs = jobCosts(out.nest, out.instances, d.library)
    expect(csv.length - 1).toBe(costs.sheets.length)
    costs.sheets.forEach((sh, i) => {
      const [n, code, sheet, parts, rem, scrap, pct] = csv[i + 1].split(',')
      expect(Number(n)).toBe(sh.index)
      expect(code).toBe('PB18-WHT')
      expect(Number(sheet)).toBeCloseTo(sh.sheetArea / 1e6, 3)
      expect(Number(parts)).toBeCloseTo(sh.partsArea / 1e6, 3)
      expect(Number(rem)).toBeCloseTo(sh.remnantArea / 1e6, 3)
      expect(Number(scrap)).toBeCloseTo(sh.scrapArea / 1e6, 3)
      expect(Number(pct)).toBeCloseTo((sh.scrapArea / sh.sheetArea) * 100, 1)
    })
    // by hand: 6 shelves 600 x 300 and 4 sides 720 x 560 = 2.6928 m² of parts
    expect(costs.sheets.reduce((t, sh) => t + sh.partsArea, 0) / 1e6).toBeCloseTo(6 * 0.18 + 4 * 0.4032, 6)
    // nothing else changes: every other file is byte-identical to a run without the step
    expect(bytes(res).filter(([n]) => !n.endsWith('_waste-areas.csv'))).toEqual(bytes(plain))
  })

  it('a step can hold an order back after nesting, with its reason', () => {
    add({ id: 'max-parts', name: 'Part limit', description: '', source: 'test', afterNest: (c) => (c.output.instances.length > 8 ? { messages: [{ severity: 'error', text: `${c.output.instances.length} parts, the limit is 8` }] } : undefined) })
    const res = runBatchCsv('w.csv', CSV, { data: on(), readFile: none, now: NOW, setup: setup(['max-parts']) })
    const o = res.orders[0]
    expect(o.status).toBe('blocked')
    expect(o.errors).toEqual(['Part limit: 10 parts, the limit is 8'])
    expect(o.files.map((f) => f.name)).toEqual(['S1_report.txt'])
  })

  it('a step before output can add a report file, and warnings go to the report', () => {
    add({ id: 'count', name: 'Part count', description: '', source: 'test', beforeOutput: (c) => ({ files: [{ name: `${c.order.number}_count.txt`, data: `${c.output.instances.length} parts, ${c.files.length} files` }], messages: [{ severity: 'warning', text: 'checked' }] }) })
    const res = runBatchCsv('w.csv', CSV, { data: on(), readFile: none, now: NOW, setup: setup(['count']) })
    const o = res.orders[0]
    expect(o.status).toBe('done')
    expect(o.files.find((f) => f.name === 'S1_count.txt')!.data).toBe(`10 parts, ${o.files.length - 2} files`)
    expect(o.warnings).toContain('Part count: checked')
  })

  it('a step can never change what is cut or write a program', () => {
    add({
      id: 'meddle',
      name: 'Meddler',
      description: '',
      source: 'test',
      afterNest: (c) => {
        ;(c.output.programs as unknown as unknown[]).pop()
      },
    })
    add({ id: 'program', name: 'Program writer', description: '', source: 'test', beforeOutput: () => ({ files: [{ name: 'extra.mpr', data: '[H' }] }) })
    add({ id: 'clash', name: 'Clash', description: '', source: 'test', beforeOutput: (c) => ({ files: [{ name: c.files[0].name, data: 'x' }] }) })
    add({ id: 'folder', name: 'Folder', description: '', source: 'test', beforeOutput: () => ({ files: [{ name: '../escape.txt', data: 'x' }] }) })
    const d = on()
    const a = runBatchCsv('w.csv', CSV, { data: d, readFile: none, now: NOW, setup: setup(['meddle']) })
    expect(a.orders[0].status).toBe('blocked')
    expect(a.orders[0].errors[0]).toMatch(/^Meddler failed: /)
    for (const id of ['program', 'clash', 'folder']) {
      const r = runBatchCsv('w.csv', CSV, { data: d, readFile: none, now: NOW, setup: setup([id]) })
      expect(r.orders[0].status).toBe('blocked')
      expect(r.orders[0].errors[0]).toMatch(/may not write/)
      expect(r.orders[0].files.map((f) => f.name)).toEqual(['S1_report.txt'])
    }
  })

  it('steps run for every machine; an unknown step is reported and skipped', () => {
    const d = on()
    const m = newMachineSetup(d, { name: 'Second', from: 'main' })
    d.machines = [m]
    const res = runBatchCsv('w.csv', CSV, { data: d, readFile: none, now: NOW, setup: setup(['waste-areas', 'gone'], [MAIN_MACHINE, m.id]) })
    const names = res.orders[0].files.map((f) => f.name)
    expect(names).toContain('S1_waste-areas.csv')
    expect(names).toContain('Second/S1_waste-areas.csv')
    expect(res.orders[0].warnings).toContain('Batch step "gone" is not available; skipped.')
    expect(res.orders[0].status).toBe('done')
  })

  it('the built-in list and plugin registration', () => {
    expect(batchSteps().map((s) => s.id)).toEqual(['waste-areas'])
    add({ id: 'p1', name: 'Plugin step', description: 'from a plugin', source: 'Sample plugin' })
    expect(batchSteps().map((s) => s.id)).toEqual(['waste-areas', 'p1'])
    undo.pop()!()
    expect(batchSteps().map((s) => s.id)).toEqual(['waste-areas'])
  })
})
