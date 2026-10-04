import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseBatchCsv, runBatchCsv } from '@/core/batch'
import { InboxWatcher, writeBatchResult, type BatchFs } from '@/core/batchWatch'
import { readMpr } from '@/cam/mprRead'
import { data } from './helpers'

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

describe('C8 batch CSV', () => {
  it('reads parts, drawings and doors grouped by order', () => {
    const { orders, errors } = parseBatchCsv(CSV, data(), { defaultOrder: 'x' })
    expect(errors).toEqual([])
    expect(orders.map((o) => [o.number, o.items.length])).toEqual([
      ['B100', 3],
      ['B200', 1],
    ])
    const [shelf, sign, door] = orders[0].items
    expect([shelf.kind, sign.kind, door.kind]).toEqual(['part', 'drawing', 'door'])
    expect(sign.priority).toBe(5)
    expect(door).toMatchObject({ length: 1200, width: 450, hinge: 'right', pull: '128', kit: 'K1', qty: 2 })
  })

  it('takes inch lengths and reports bad rows', () => {
    const csv = 'name,material,length,width,qty\nA,MDF18,23 5/8,11 1/4,2\nB,NOPE,10,10,1\nC,MDF18,abc,10,1\nD,MDF18,10,,1'
    const { orders, errors } = parseBatchCsv(csv, data(), { defaultOrder: 'list', units: 'in' })
    expect(orders[0].number).toBe('list')
    expect(orders[0].items[0]).toMatchObject({ length: 600.075, width: 285.75 })
    expect(errors.map((e) => e.row)).toEqual([3, 4, 5])
  })

  it('writes programs, labels, sheet maps and a report for each order', () => {
    const d = data((x) => (x.settings.features = { camMprOutput: true }))
    const res = runBatchCsv('orders.csv', CSV, { data: d, readFile: read, now: NOW })
    expect(res.cancelled).toBe(false)
    expect(res.orders.map((o) => o.status)).toEqual(['done', 'done'])
    const b100 = res.orders[0]
    expect(b100.folder).toBe('B100_20261004-0930')
    expect(b100.parts).toBe(7)
    const names = b100.files.map((f) => f.name)
    expect(names.filter((n) => n.endsWith('.mpr')).length).toBeGreaterThanOrEqual(2)
    expect(names).toEqual(expect.arrayContaining(['B100_labels_100x70.pdf', 'B100_sheet-maps.pdf', 'B100_cutlist.csv', 'B100_bom.csv', 'B100_report.txt']))
    const sheet = b100.files.find((f) => /_S01_.*\.mpr$/.test(f.name))!
    const doc = readMpr(new TextDecoder('latin1').decode(sheet.data as Uint8Array))
    expect(doc.errors).toEqual([])
    expect(doc.macros.some((m) => m.id === 102)).toBe(true)
    const report = b100.files.find((f) => f.name.endsWith('_report.txt'))!.data as string
    expect(report).toContain('Programs written')
    expect(report).toContain('not machine-proven')
  })

  it('holds back programs when the export checker finds errors', () => {
    const res = runBatchCsv('orders.csv', CSV, { data: data(), readFile: read, now: NOW })
    expect(res.orders[0].status).toBe('blocked')
    expect(res.orders[0].files.map((f) => f.name)).toEqual(['B100_report.txt'])
    expect(res.orders[0].errors.join(' ')).toMatch(/machining/i)
    expect(res.orders[1].status).toBe('done')
    const missing = runBatchCsv('m.csv', 'name,file,material\nGone,nothere.dxf,MDF18', { data: data(), readFile: read, now: NOW })
    expect(missing.orders[0].status).toBe('blocked')
    expect(missing.orders[0].errors[0]).toMatch(/nothere\.dxf not found/)
  })

  it('cancel stops the run and leaves no programs', () => {
    let calls = 0
    const res = runBatchCsv('orders.csv', CSV, { data: data((x) => (x.settings.features = { camMprOutput: true })), readFile: read, now: NOW, isCancelled: () => ++calls > 3 })
    expect(res.cancelled).toBe(true)
    expect(res.orders.length).toBe(1)
    expect(res.orders[0].status).toBe('cancelled')
    expect(res.orders[0].files.map((f) => f.name)).toEqual(['B100_report.txt'])
  })
})

/** In-memory file system with real path rules. */
function memFs() {
  const store = new Map<string, string | Uint8Array>()
  const dirs = new Set<string>()
  const fsx: BatchFs & { store: typeof store } = {
    store,
    list: (dir) => [...store.keys()].filter((k) => path.posix.dirname(k) === dir).map((k) => path.posix.basename(k)),
    size: (p) => (store.has(p) ? (typeof store.get(p) === 'string' ? (store.get(p) as string).length : (store.get(p) as Uint8Array).length) : null),
    readText: (p) => {
      const v = store.get(p)
      return v === undefined ? null : typeof v === 'string' ? v : new TextDecoder().decode(v)
    },
    writeFile: (p, d) => void store.set(p, d),
    mkdirp: (p) => void dirs.add(p),
    rename: (a, b) => {
      for (const k of [...store.keys()])
        if (k === a || k.startsWith(a + '/')) {
          store.set(b + k.slice(a.length), store.get(k)!)
          store.delete(k)
        }
      dirs.delete(a)
      dirs.add(b)
    },
    remove: (p) => {
      for (const k of [...store.keys()]) if (k === p || k.startsWith(p + '/')) store.delete(k)
      dirs.delete(p)
    },
    exists: (p) => store.has(p) || dirs.has(p),
    join: (...ps) => path.posix.join(...ps),
    isAbsolute: (p) => p.startsWith('/'),
  }
  return fsx
}

describe('C8 folder watcher', () => {
  const cfg = { inbox: '/in', outbox: '/out' }
  const d = data((x) => (x.settings.features = { camMprOutput: true }))
  const run = (name: string, text: string, readFile: (p: string) => string | null) => runBatchCsv(name, text, { data: d, readFile, now: NOW })

  it('waits for a CSV to stop growing, runs it, writes order folders and files the CSV', () => {
    const fsx = memFs()
    fsx.writeFile('/in/sign.dxf', SIGN)
    fsx.writeFile('/in/plain.dxf', PLAIN)
    fsx.writeFile('/in/orders.csv', CSV.slice(0, 40))
    const log: string[] = []
    const w = new InboxWatcher(fsx, cfg, run, (m) => log.push(m))
    expect(w.tick()).toEqual([])
    fsx.writeFile('/in/orders.csv', CSV)
    expect(w.tick()).toEqual([])
    expect(w.tick()).toEqual(['orders.csv'])
    expect(fsx.exists('/in/orders.csv')).toBe(false)
    const keys = [...fsx.store.keys()]
    expect(keys.some((k) => /^\/in\/done\/.*_orders\.csv$/.test(k))).toBe(true)
    expect(keys.filter((k) => k.startsWith('/out/B100_20261004-0930/')).length).toBeGreaterThan(4)
    expect(keys.some((k) => k.startsWith('/out/B200_20261004-0930/'))).toBe(true)
    expect(keys.some((k) => k.includes('.partial-'))).toBe(false)
    expect(log.join('\n')).toMatch(/2 order folders written/)
    expect(w.tick()).toEqual([])
  })

  it('files a CSV with problems under problems/ and a cancelled run under cancelled/', () => {
    const fsx = memFs()
    fsx.writeFile('/in/bad.csv', 'name,material,length,width\nX,NOPE,100,100')
    const w = new InboxWatcher(fsx, cfg, run)
    w.tick()
    w.tick()
    expect([...fsx.store.keys()].some((k) => k.startsWith('/in/problems/'))).toBe(true)

    fsx.writeFile('/in/sign.dxf', SIGN)
    fsx.writeFile('/in/plain.dxf', PLAIN)
    fsx.writeFile('/in/orders.csv', CSV)
    let n = 0
    const cancelling = new InboxWatcher(fsx, cfg, (name, text, rf) => runBatchCsv(name, text, { data: d, readFile: rf, now: NOW, isCancelled: () => ++n > 2 }))
    cancelling.tick()
    cancelling.tick()
    const keys = [...fsx.store.keys()]
    expect(keys.some((k) => /^\/in\/cancelled\/.*orders\.csv$/.test(k))).toBe(true)
    expect(keys.some((k) => k.endsWith('.mpr'))).toBe(false)
  })

  it('never leaves half-written order folders and does not overwrite earlier runs', () => {
    const fsx = memFs()
    const res = run('orders.csv', CSV, read)
    writeBatchResult(fsx, cfg, null, res)
    writeBatchResult(fsx, cfg, null, res)
    const folders = new Set([...fsx.store.keys()].map((k) => k.split('/')[2]))
    expect([...folders].sort()).toEqual(['B100_20261004-0930', 'B100_20261004-0930-2', 'B200_20261004-0930', 'B200_20261004-0930-2'])
  })
})

describe('C8 command line (no UI)', () => {
  it('npm run batch -- run writes the order folders', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-batch-'))
    fs.writeFileSync(path.join(dir, 'plain.dxf'), PLAIN)
    fs.writeFileSync(path.join(dir, 'list.csv'), 'order,name,file,material,qty\nC1,Plain,plain.dxf,MDF18,3\n')
    const out = path.join(dir, 'out')
    const stdout = execFileSync(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), 'scripts/batch.ts', 'run', path.join(dir, 'list.csv'), '--out', out], { encoding: 'utf8' })
    expect(stdout).toMatch(/C1: 1 sheet/)
    const [folder] = fs.readdirSync(out)
    expect(folder).toMatch(/^C1_\d{8}-\d{4}$/)
    const written = fs.readdirSync(path.join(out, folder))
    expect(written.some((f) => f.endsWith('.mpr'))).toBe(true)
    expect(written).toContain('C1_labels_100x70.pdf')
    fs.rmSync(dir, { recursive: true, force: true })
  }, 60_000)
})
