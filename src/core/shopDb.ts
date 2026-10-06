/**
 * SQLite storage option for the shop data (M2.9, AM-06). Materials, tools (of every machine) and
 * jobs are rows of their own, so other programs can read and query them; everything else is kept
 * as one JSON "shell" in the meta table. Reading gives back the shop data exactly as written, to the
 * last digit and key (each row keeps its JSON text; the shell keeps the place of every list).
 *
 * The database engine is injected (`SqlDb`), so this runs on Node's built-in SQLite in the desktop
 * app, the command line and the tests, with no new dependency.
 */
import type { AppData } from './types'

export interface SqlDb {
  exec(sql: string): void
  run(sql: string, ...params: (string | number | null)[]): void
  all(sql: string, ...params: (string | number | null)[]): Record<string, unknown>[]
}

/** Database layout version (meta key "format"). */
export const SHOP_DB_FORMAT = 1

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS materials (ord INTEGER PRIMARY KEY, id TEXT, code TEXT, name TEXT, thickness REAL, sheet_length REAL, sheet_width REAL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tools (machine TEXT NOT NULL, ord INTEGER NOT NULL, id TEXT, number INTEGER, type TEXT, name TEXT, diameter REAL, max_depth REAL, data TEXT NOT NULL, PRIMARY KEY (machine, ord));
CREATE TABLE IF NOT EXISTS jobs (ord INTEGER PRIMARY KEY, id TEXT, number TEXT, name TEXT, customer TEXT, updated_at TEXT, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS materials_code ON materials (code);
CREATE INDEX IF NOT EXISTS tools_number ON tools (machine, number);
CREATE INDEX IF NOT EXISTS jobs_number ON jobs (number);
`

export class ShopDbError extends Error {}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown) => (typeof v === 'string' ? v : null)

/** Replace the database contents with `data`, in one transaction (all or nothing). */
export function writeShopDb(db: SqlDb, data: AppData) {
  const shell = JSON.parse(JSON.stringify(data)) as AppData
  const lists = { materials: Array.isArray(shell.library?.materials), jobs: Array.isArray(shell.jobs) }
  if (lists.materials) shell.library.materials = []
  if (lists.jobs) shell.jobs = []
  const machines: [string, AppData['machine']['tools'] | undefined][] = [['main', data.machine?.tools]]
  if (Array.isArray(shell.machine?.tools)) shell.machine.tools = []
  for (const [i, m] of (shell.machines ?? []).entries()) {
    machines.push([m.id, data.machines![i].profile?.tools])
    if (Array.isArray(m.profile?.tools)) m.profile.tools = []
  }
  if (new Set(machines.map(([id]) => id)).size !== machines.length) throw new ShopDbError('Two machines share one id; the data cannot be stored by machine.')
  db.exec(SCHEMA)
  db.exec('BEGIN')
  try {
    db.exec('DELETE FROM meta; DELETE FROM materials; DELETE FROM tools; DELETE FROM jobs;')
    db.run('INSERT INTO meta (key, value) VALUES (?, ?)', 'format', String(SHOP_DB_FORMAT))
    db.run('INSERT INTO meta (key, value) VALUES (?, ?)', 'shell', JSON.stringify(shell))
    if (lists.materials)
      data.library.materials.forEach((m, ord) => db.run('INSERT INTO materials VALUES (?, ?, ?, ?, ?, ?, ?, ?)', ord, str(m.id), str(m.code), str(m.name), num(m.thickness), num(m.sheetLength), num(m.sheetWidth), JSON.stringify(m)))
    for (const [machine, tools] of machines)
      if (Array.isArray(tools)) tools.forEach((t, ord) => db.run('INSERT INTO tools VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', machine, ord, str(t.id), num(t.number), str(t.type), str(t.name), num(t.diameter), num(t.maxDepth), JSON.stringify(t)))
    if (lists.jobs) data.jobs.forEach((j, ord) => db.run('INSERT INTO jobs VALUES (?, ?, ?, ?, ?, ?, ?)', ord, str(j.id), str(j.number), str(j.name), str(j.customer), str(j.updatedAt), JSON.stringify(j)))
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

const rows = (db: SqlDb, sql: string, ...p: (string | number)[]) => db.all(sql, ...p).map((r) => JSON.parse(String(r.data)))

/** The shop data stored in the database. Throws `ShopDbError` for a file that is not one of ours. */
export function readShopDb(db: SqlDb): AppData {
  let meta: Record<string, unknown>[]
  try {
    meta = db.all('SELECT key, value FROM meta')
  } catch {
    throw new ShopDbError('This file is not a Cabinet Studio database.')
  }
  const get = (k: string) => meta.find((r) => r.key === k)?.value as string | undefined
  const format = Number(get('format'))
  if (!get('shell') || !Number.isFinite(format)) throw new ShopDbError('This file is not a Cabinet Studio database.')
  if (format > SHOP_DB_FORMAT) throw new ShopDbError(`This database was written by a newer Cabinet Studio (layout ${format}); update the app to open it.`)
  const data = JSON.parse(get('shell')!) as AppData
  if (Array.isArray(data.library?.materials)) data.library.materials = rows(db, 'SELECT data FROM materials ORDER BY ord')
  if (Array.isArray(data.jobs)) data.jobs = rows(db, 'SELECT data FROM jobs ORDER BY ord')
  if (Array.isArray(data.machine?.tools)) data.machine.tools = rows(db, 'SELECT data FROM tools WHERE machine = ? ORDER BY ord', 'main')
  for (const m of data.machines ?? []) if (Array.isArray(m.profile?.tools)) m.profile.tools = rows(db, 'SELECT data FROM tools WHERE machine = ? ORDER BY ord', m.id)
  return data
}

/** Counts shown before an import replaces the shop data. */
export function shopSummary(d: AppData) {
  return { jobs: d.jobs?.length ?? 0, materials: d.library?.materials?.length ?? 0, tools: d.machine?.tools?.length ?? 0, machines: 1 + (d.machines?.length ?? 0) }
}
