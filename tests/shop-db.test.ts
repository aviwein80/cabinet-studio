import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { readDbFile, ShopStore, sqlDb, writeDbFile } from '../electron/shopStore'
import { newPart } from '@/cam/doc'
import { defaultOp } from '@/cam/ops'
import { newMachineSetup } from '@/core/machines'
import { normalizeData } from '@/core/normalize'
import { sampleJob } from '@/core/sample'
import { readShopDb, SHOP_DB_FORMAT, ShopDbError, shopSummary, writeShopDb } from '@/core/shopDb'
import type { AppData } from '@/core/types'
import { data } from './helpers'

/** Shop data with everything in it: a sample job, a custom part, another machine, awkward text and numbers. */
function richData(): AppData {
  return data((d) => {
    d.jobs.push(sampleJob())
    const part = { ...newPart({ name: 'Sign «Ä» "quoted" \\ back\nslash', length: 812.8, width: 304.8, thickness: 19.05 }), materialId: d.library.materials[0].id, qty: 3 }
    part.ops = [{ ...defaultOp('profile', []), name: 'Cut out ⌀12' }]
    d.jobs.push({ id: 'j2', number: 'K-2041', name: 'Pantry ✓', customer: 'Weinreb', notes: 'line 1\r\nline 2', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z', cabinets: [], camParts: [part] })
    d.library.materials[0].cost = { by: 'area', price: 0.1 + 0.2 }
    d.library.materials[1].notes = 'tiny 1e-9, big 12345678901234'
    d.library.partLibrary = [part]
    const m = newMachineSetup(d, { name: 'WEEKE second', from: 'main' })
    m.profile.tools = m.profile.tools.slice(0, 3)
    d.machines = [m]
    d.settings.batchSetups = [{ id: 'b', name: 'Both', machines: ['main', m.id] }]
    d.settings.features = { camMprOutput: true }
  })
}

const memDb = () => sqlDb(new DatabaseSync(':memory:'))
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cs-db-'))

describe('M2.9b SQLite storage option', () => {
  it('round-trips the shop data without loss', () => {
    const d = richData()
    const db = memDb()
    writeShopDb(db, d)
    const back = readShopDb(db)
    expect(JSON.stringify(back)).toBe(JSON.stringify(d))
    expect(JSON.stringify(back, null, 1)).toBe(JSON.stringify(d, null, 1))
    // the default data and an empty job list too
    const plain = data()
    writeShopDb(db, plain)
    expect(JSON.stringify(readShopDb(db))).toBe(JSON.stringify(plain))
    // loading through the normal loader gives the same app data either way
    expect(normalizeData(readShopDb((writeShopDb(db, d), db)))).toEqual(normalizeData(JSON.parse(JSON.stringify(d))))
  })

  it('keeps materials, tools and jobs as rows other programs can query', () => {
    const d = richData()
    const db = memDb()
    writeShopDb(db, d)
    expect(db.all('SELECT code FROM materials ORDER BY ord').map((r) => r.code)).toEqual(d.library.materials.map((m) => m.code))
    expect(db.all("SELECT number FROM tools WHERE machine = 'main' ORDER BY ord").map((r) => r.number)).toEqual(d.machine.tools.map((t) => t.number))
    expect(db.all('SELECT count(*) AS n FROM tools WHERE machine = ?', d.machines![0].id)[0].n).toBe(3)
    expect(db.all('SELECT number, customer FROM jobs ORDER BY ord')).toEqual(d.jobs.map((j) => ({ number: j.number, customer: j.customer })))
    expect(db.all("SELECT value FROM meta WHERE key = 'format'")[0].value).toBe(String(SHOP_DB_FORMAT))
    // the shell holds no copy of the rows
    const shell = String(db.all("SELECT value FROM meta WHERE key = 'shell'")[0].value)
    expect(shell).not.toContain(d.library.materials[0].name)
    expect(shell).not.toContain('Pantry ✓')
    expect(shopSummary(d)).toEqual({ jobs: 2, materials: d.library.materials.length, tools: d.machine.tools.length, machines: 2 })
  })

  it('a save replaces everything; a change made in the database is read back', () => {
    const d = richData()
    const db = memDb()
    writeShopDb(db, d)
    const fewer = { ...d, jobs: d.jobs.slice(0, 1) }
    writeShopDb(db, fewer)
    expect(db.all('SELECT count(*) AS n FROM jobs')[0].n).toBe(1)
    expect(JSON.stringify(readShopDb(db))).toBe(JSON.stringify(fewer))
    const m = JSON.parse(String(db.all('SELECT data FROM materials WHERE ord = 0')[0].data))
    db.run('UPDATE materials SET data = ? WHERE ord = 0', JSON.stringify({ ...m, cost: { by: 'area', price: 41.5 } }))
    expect(readShopDb(db).library.materials[0].cost).toEqual({ by: 'area', price: 41.5 })
  })

  it('refuses files that are not ours, or from a newer app', () => {
    const db = memDb()
    expect(() => readShopDb(db)).toThrow(ShopDbError)
    db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    expect(() => readShopDb(db)).toThrow(/not a Cabinet Studio database/)
    writeShopDb(db, data())
    db.run("UPDATE meta SET value = '99' WHERE key = 'format'")
    expect(() => readShopDb(db)).toThrow(/newer Cabinet Studio/)
    const dup = richData()
    dup.machines![0].id = 'main'
    expect(() => writeShopDb(memDb(), dup)).toThrow(/share one id/)
  })

  it('JSON stays the default; switching to SQLite and back loses nothing', () => {
    const dir = tmp()
    const store = new ShopStore(dir)
    expect(store.kind()).toBe('json')
    expect(store.load()).toBeNull()
    const d = richData()
    store.save(JSON.stringify(d, null, 1))
    expect(fs.existsSync(store.dbFile)).toBe(false)
    expect(store.switchTo('sqlite').kind).toBe('sqlite')
    expect(store.kind()).toBe('sqlite')
    expect(store.load()).toBe(JSON.stringify(d))
    // saves write the database and the JSON copy beside it
    const next = { ...d, settings: { ...d.settings, shopName: 'Saved in SQLite' } }
    store.save(JSON.stringify(next, null, 1))
    expect(readDbFile(store.dbFile).settings.shopName).toBe('Saved in SQLite')
    expect(JSON.parse(fs.readFileSync(store.jsonFile, 'utf8')).settings.shopName).toBe('Saved in SQLite')
    // an edit made in the database by another program is what the app loads
    const raw = new DatabaseSync(store.dbFile)
    raw.prepare("UPDATE jobs SET data = json_set(data, '$.customer', 'Edited elsewhere') WHERE ord = 1").run()
    raw.close()
    expect(store.loadData()!.jobs[1].customer).toBe('Edited elsewhere')
    store.switchTo('json')
    expect(store.kind()).toBe('json')
    expect(JSON.parse(fs.readFileSync(store.jsonFile, 'utf8')).jobs[1].customer).toBe('Edited elsewhere')
    expect(store.loadData()!.jobs[1].customer).toBe('Edited elsewhere')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('export to and import from a database file', () => {
    const dir = tmp()
    const d = richData()
    const file = path.join(dir, 'export', 'shop.sqlite')
    writeDbFile(file, d)
    expect(JSON.stringify(readDbFile(file))).toBe(JSON.stringify(d))
    expect(fs.readdirSync(path.dirname(file))).toEqual(['shop.sqlite'])
    expect(() => readDbFile(path.join(dir, 'none.sqlite'))).toThrow(/not found/)
    fs.writeFileSync(path.join(dir, 'junk.sqlite'), 'not a database')
    expect(() => readDbFile(path.join(dir, 'junk.sqlite'))).toThrow()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('the command-line batch runner reads shop data from a database file', () => {
    const dir = tmp()
    const d = data((x) => (x.settings.features = { camMprOutput: true }))
    writeDbFile(path.join(dir, 'shop.sqlite'), d)
    fs.writeFileSync(path.join(dir, 'list.csv'), 'order,name,material,length,width,qty\nD1,Shelf,MDF18,600,300,2\n')
    const out = path.join(dir, 'out')
    const stdout = execFileSync(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), 'scripts/batch.ts', 'run', path.join(dir, 'list.csv'), '--out', out, '--data', path.join(dir, 'shop.sqlite')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    expect(stdout).toMatch(/D1: 1 sheet/)
    const [folder] = fs.readdirSync(out)
    expect(fs.readdirSync(path.join(out, folder)).some((f) => f.endsWith('.mpr'))).toBe(true)
    fs.rmSync(dir, { recursive: true, force: true })
  }, 60_000)
})
