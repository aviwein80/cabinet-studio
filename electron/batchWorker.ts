/**
 * Batch watcher thread. Nesting can run for seconds, so it stays off the main process.
 * The main process sets the shared cancel flag to stop the CSV being processed.
 */
import path from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { quickjs, quickjsReady, setQuickJsWasm } from '../src/cam/plugin/quickjs'
import { pluginBatchSteps } from '../src/cam/plugin/steps'
import { runBatchCsv } from '../src/core/batch'
import { InboxWatcher } from '../src/core/batchWatch'
import { normalizeData } from '../src/core/normalize'
import { nodeBatchFs } from './batchFs'
import { nodePluginIO } from './pluginIo'
import { ShopStore } from './shopStore'

const { inbox, outbox, dataFile, cancel, pollMs, quickjsWasm } = workerData as { inbox: string; outbox: string; dataFile: string; cancel: SharedArrayBuffer; pollMs?: number; quickjsWasm?: Uint8Array | null }
const flag = new Int32Array(cancel)
const log = (msg: string) => parentPort?.postMessage({ type: 'log', at: new Date().toISOString(), msg })

// the JSON file or, with the SQLite option (M2.9), the database beside it
const loadData = () => normalizeData(new ShopStore(path.dirname(dataFile)).loadData())

const watcher = new InboxWatcher(
  nodeBatchFs,
  { inbox, outbox, pollMs: pollMs ?? 2000 },
  (name, text, readFile) => {
    Atomics.store(flag, 0, 0)
    parentPort?.postMessage({ type: 'busy', csv: name })
    const data = loadData()
    // plugin batch steps (M2.10): each plugin in its sandbox, with the file access it was granted
    const plugins = pluginBatchSteps(data, quickjsReady(), (r) => ({ io: nodePluginIO(r.grants), log: (l) => void (l.level !== 'info' && log(`Plugin ${l.plugin}: ${l.text}`)) }))
    for (const p of plugins.problems) log(`Plugin ${p}`)
    try {
      return runBatchCsv(name, text, { data, readFile, isCancelled: () => Atomics.load(flag, 0) === 1, onProgress: log, extraSteps: plugins.steps })
    } finally {
      plugins.dispose()
      parentPort?.postMessage({ type: 'idle' })
    }
  },
  log,
)

parentPort?.on('message', (m: { type: string }) => {
  if (m.type === 'stop') {
    watcher.stop()
    process.exit(0)
  }
})

// the plugin sandbox loads once, before the first list is read
if (quickjsWasm) setQuickJsWasm(quickjsWasm)
void quickjs()
  .catch((e) => log(`Plugins are not available in batch runs: ${e instanceof Error ? e.message : String(e)}`))
  .finally(() => {
    watcher.start()
    watcher.tick()
  })
