/// <reference lib="webworker" />
import { runBatchCsv } from '@/core/batch'
import type { AppData, BatchSetup } from '@/core/types'

interface Request {
  csvName: string
  csvText: string
  drawings: Record<string, string>
  data: AppData
  /** A setup to run instead of the active one (setup wizard check, M2.9). */
  setup?: BatchSetup
}

self.onmessage = (e: MessageEvent<Request>) => {
  const { csvName, csvText, drawings, data, setup } = e.data
  const byName = new Map(Object.entries(drawings).map(([k, v]) => [k.toLowerCase(), v]))
  const readFile = (p: string) => byName.get(p.toLowerCase()) ?? byName.get(p.replace(/^.*[\\/]/, '').toLowerCase()) ?? null
  try {
    const result = runBatchCsv(csvName, csvText, { data, readFile, onProgress: (msg) => postMessage({ type: 'log', msg }), ...(setup ? { setup } : {}) })
    postMessage({ type: 'done', result })
  } catch (err) {
    postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
