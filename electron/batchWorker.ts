/**
 * Batch watcher thread. Nesting can run for seconds, so it stays off the main process.
 * The main process sets the shared cancel flag to stop the CSV being processed.
 */
import path from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { runBatchCsv } from '../src/core/batch'
import { InboxWatcher } from '../src/core/batchWatch'
import { normalizeData } from '../src/core/normalize'
import { nodeBatchFs } from './batchFs'
import { ShopStore } from './shopStore'

const { inbox, outbox, dataFile, cancel, pollMs } = workerData as { inbox: string; outbox: string; dataFile: string; cancel: SharedArrayBuffer; pollMs?: number }
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
    try {
      return runBatchCsv(name, text, { data: loadData(), readFile, isCancelled: () => Atomics.load(flag, 0) === 1, onProgress: log })
    } finally {
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

watcher.start()
watcher.tick()
