/**
 * Where the shop data lives on disk (M2.9, AM-06). JSON is the default: `cabinet-studio.json`.
 * With the SQLite option the shop data is loaded from `cabinet-studio.sqlite` beside it; every save
 * writes the database and still writes the JSON file as a plain copy, so switching back, backups
 * and the batch runner keep working. `storage.json` in the same folder says which one is used.
 * Node's built-in SQLite (`node:sqlite`) is used: nothing to install, nothing to compile.
 */
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { readShopDb, ShopDbError, type SqlDb, writeShopDb } from '../src/core/shopDb'
import type { AppData } from '../src/core/types'

export type StoreKind = 'json' | 'sqlite'

export function sqlDb(db: DatabaseSync): SqlDb {
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, ...p) => void db.prepare(sql).run(...p),
    all: (sql, ...p) => db.prepare(sql).all(...p) as Record<string, unknown>[],
  }
}

function writeAtomic(file: string, contents: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, contents)
  fs.renameSync(tmp, file)
}

/** Read a database file as shop data. */
export function readDbFile(file: string): AppData {
  if (!fs.existsSync(file)) throw new ShopDbError(`${path.basename(file)} not found.`)
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    return readShopDb(sqlDb(db))
  } finally {
    db.close()
  }
}

/** Write shop data to a database file, checked by reading it back. A fresh file is built beside it and swapped in. */
export function writeDbFile(file: string, data: AppData) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.rmSync(tmp, { force: true })
  const db = new DatabaseSync(tmp)
  try {
    writeShopDb(sqlDb(db), data)
  } finally {
    db.close()
  }
  if (JSON.stringify(readDbFile(tmp)) !== JSON.stringify(data)) {
    fs.rmSync(tmp, { force: true })
    throw new ShopDbError('The database did not read back the same as the shop data; nothing was changed.')
  }
  fs.renameSync(tmp, file)
}

export class ShopStore {
  readonly dir: string
  readonly jsonFile: string
  readonly dbFile: string
  readonly pointer: string

  constructor(dir: string) {
    this.dir = dir
    this.jsonFile = path.join(dir, 'cabinet-studio.json')
    this.dbFile = path.join(dir, 'cabinet-studio.sqlite')
    this.pointer = path.join(dir, 'storage.json')
  }

  kind(): StoreKind {
    try {
      return JSON.parse(fs.readFileSync(this.pointer, 'utf8')).kind === 'sqlite' ? 'sqlite' : 'json'
    } catch {
      return 'json'
    }
  }

  /** The shop data as JSON text, or null when there is none yet. */
  load(): string | null {
    if (this.kind() === 'sqlite' && fs.existsSync(this.dbFile)) return JSON.stringify(readDbFile(this.dbFile))
    return fs.existsSync(this.jsonFile) ? fs.readFileSync(this.jsonFile, 'utf8') : null
  }

  loadData(): AppData | null {
    const t = this.load()
    return t === null ? null : (JSON.parse(t) as AppData)
  }

  save(json: string) {
    if (this.kind() === 'sqlite') {
      const db = new DatabaseSync(this.dbFile)
      try {
        writeShopDb(sqlDb(db), JSON.parse(json) as AppData)
      } finally {
        db.close()
      }
    }
    writeAtomic(this.jsonFile, json)
  }

  /** Switch the store. The data is copied (and checked) before the switch, so nothing is lost either way. */
  switchTo(kind: StoreKind): { kind: StoreKind; message: string } {
    if (kind === this.kind()) return { kind, message: 'Already in use.' }
    const text = this.load()
    if (kind === 'sqlite') {
      if (text !== null) writeDbFile(this.dbFile, JSON.parse(text) as AppData)
      writeAtomic(this.pointer, JSON.stringify({ kind: 'sqlite' }))
      return { kind, message: `Shop data is now kept in ${path.basename(this.dbFile)} (a JSON copy is still written beside it).` }
    }
    if (text !== null) writeAtomic(this.jsonFile, text)
    writeAtomic(this.pointer, JSON.stringify({ kind: 'json' }))
    return { kind, message: `Shop data is kept in ${path.basename(this.jsonFile)} again. The database file is left where it is.` }
  }
}
