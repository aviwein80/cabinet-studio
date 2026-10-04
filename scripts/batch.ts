/**
 * Batch runs without the app.
 *
 *   npm run batch -- run <parts.csv> --out <folder> [--data <cabinet-studio.json>]
 *   npm run batch -- watch <inbox> --out <folder> [--data <cabinet-studio.json>] [--poll <ms>]
 *
 * --data is the app's data file (library, machine, settings); without it the built-in defaults
 * are used. Each order gets its own folder; a CSV in the inbox moves to done/, problems/ or
 * cancelled/ when finished. Ctrl+C stops; a half-finished order leaves no files behind.
 */
import fs from 'node:fs'
import path from 'node:path'
import { nodeBatchFs } from '../electron/batchFs'
import { runBatchCsv } from '../src/core/batch'
import { InboxWatcher, writeBatchResult } from '../src/core/batchWatch'
import { normalizeData } from '../src/core/normalize'

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const [mode, target] = args
const out = flag('--out')
const dataPath = flag('--data')
if (!mode || !target || !out || !['run', 'watch'].includes(mode)) {
  console.error('Usage: npm run batch -- run <parts.csv> --out <folder> [--data <file>]\n       npm run batch -- watch <inbox> --out <folder> [--data <file>] [--poll <ms>]')
  process.exit(2)
}
const loadData = () => normalizeData(dataPath && fs.existsSync(dataPath) ? JSON.parse(fs.readFileSync(dataPath, 'utf8')) : null)
const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${m}`)

if (mode === 'run') {
  const csv = path.resolve(target)
  const dir = path.dirname(csv)
  const read = (p: string) => nodeBatchFs.readText(path.isAbsolute(p) ? p : path.join(dir, p))
  const result = runBatchCsv(path.basename(csv), fs.readFileSync(csv, 'utf8'), { data: loadData(), readFile: read, onProgress: log })
  const { written } = writeBatchResult(nodeBatchFs, { inbox: dir, outbox: path.resolve(out) }, null, result)
  for (const w of written) log(`wrote ${w}`)
  process.exit(result.orders.every((o) => o.status === 'done') ? 0 : 1)
} else {
  const watcher = new InboxWatcher(nodeBatchFs, { inbox: path.resolve(target), outbox: path.resolve(out), pollMs: Number(flag('--poll') ?? 2000) }, (name, text, read) => runBatchCsv(name, text, { data: loadData(), readFile: read, onProgress: log }), log)
  process.on('SIGINT', () => {
    watcher.stop()
    process.exit(130)
  })
  watcher.start()
}
