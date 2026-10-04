/**
 * Folder watcher for batch runs. Polls an inbox for part-list CSVs (polling works on network
 * shares where change events do not), waits until a file stops growing, runs it, writes each
 * order's files into the outbox atomically (temporary folder, then rename), and moves the CSV
 * to done/, problems/ or cancelled/ under the inbox. File access is injected, so the same code
 * runs in the desktop app's worker, the command line and the tests.
 */
import type { BatchResult } from './batch'

export interface BatchFs {
  list(dir: string): string[]
  size(path: string): number | null
  readText(path: string): string | null
  writeFile(path: string, data: string | Uint8Array): void
  mkdirp(path: string): void
  rename(from: string, to: string): void
  remove(path: string): void
  exists(path: string): boolean
  join(...parts: string[]): string
  isAbsolute(path: string): boolean
}

export interface WatchConfig {
  inbox: string
  outbox: string
  pollMs?: number
}

export type RunCsv = (name: string, text: string, readFile: (path: string) => string | null) => BatchResult

/** Write one batch result: a folder per order, then the CSV moves out of the inbox. */
export function writeBatchResult(fs: BatchFs, cfg: WatchConfig, csvPath: string | null, result: BatchResult, now = new Date()) {
  const written: string[] = []
  fs.mkdirp(cfg.outbox)
  for (const o of result.orders) {
    if (!o.files.length) continue
    let target = fs.join(cfg.outbox, o.folder)
    for (let n = 2; fs.exists(target); n++) target = fs.join(cfg.outbox, `${o.folder}-${n}`)
    const tmp = fs.join(cfg.outbox, `.partial-${o.folder}`)
    if (fs.exists(tmp)) fs.remove(tmp)
    fs.mkdirp(tmp)
    for (const f of o.files) fs.writeFile(fs.join(tmp, f.name), f.data)
    fs.rename(tmp, target)
    written.push(target)
  }
  let movedTo: string | null = null
  if (csvPath) {
    const status = result.cancelled ? 'cancelled' : result.orders.every((o) => o.status === 'done') && !result.rowErrors.length ? 'done' : 'problems'
    const dir = fs.join(cfg.inbox, status)
    fs.mkdirp(dir)
    const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
    movedTo = fs.join(dir, `${ts}_${result.csv.replace(/^.*[\\/]/, '')}`)
    fs.rename(csvPath, movedTo)
  }
  return { written, movedTo }
}

export class InboxWatcher {
  private sizes = new Map<string, number>()
  private timer: ReturnType<typeof setInterval> | null = null
  private busy = false
  readonly fs: BatchFs
  readonly cfg: WatchConfig
  readonly run: RunCsv
  readonly log: (msg: string) => void

  constructor(fs: BatchFs, cfg: WatchConfig, run: RunCsv, log: (msg: string) => void = () => {}) {
    this.fs = fs
    this.cfg = cfg
    this.run = run
    this.log = log
  }

  get running() {
    return this.timer !== null
  }

  start() {
    if (this.timer) return
    this.fs.mkdirp(this.cfg.inbox)
    this.log(`Watching ${this.cfg.inbox}`)
    this.timer = setInterval(() => void this.tick(), this.cfg.pollMs ?? 2000)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.log('Stopped watching')
  }

  /** One poll: run every CSV whose size held still since the last poll. Returns the CSVs run. */
  tick(): string[] {
    if (this.busy) return []
    this.busy = true
    const ran: string[] = []
    try {
      const names = this.fs.list(this.cfg.inbox).filter((n) => /\.csv$/i.test(n) && !n.startsWith('.') && !n.startsWith('~'))
      for (const k of [...this.sizes.keys()]) if (!names.includes(k)) this.sizes.delete(k)
      for (const name of names.sort()) {
        const path = this.fs.join(this.cfg.inbox, name)
        const size = this.fs.size(path)
        const prev = this.sizes.get(name)
        this.sizes.set(name, size ?? -1)
        if (size === null || size <= 0 || prev !== size) continue
        const text = this.fs.readText(path)
        if (text === null) continue
        this.sizes.delete(name)
        const read = (p: string) => this.fs.readText(this.fs.isAbsolute(p) ? p : this.fs.join(this.cfg.inbox, p))
        const result = this.run(name, text, read)
        const { written, movedTo } = writeBatchResult(this.fs, this.cfg, path, result)
        this.log(`${name}: ${result.cancelled ? 'cancelled' : `${written.length} order folder${written.length === 1 ? '' : 's'} written`}${movedTo ? `; moved to ${movedTo}` : ''}`)
        ran.push(name)
        if (result.cancelled) break
      }
    } catch (e) {
      this.log(`Watcher error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      this.busy = false
    }
    return ran
  }
}
