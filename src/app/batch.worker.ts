/// <reference lib="webworker" />
import { runBatchCsv } from '@/core/batch'
import type { AppData } from '@/core/types'

interface Request {
  csvName: string
  csvText: string
  drawings: Record<string, string>
  data: AppData
}

self.onmessage = (e: MessageEvent<Request>) => {
  const { csvName, csvText, drawings, data } = e.data
  const byName = new Map(Object.entries(drawings).map(([k, v]) => [k.toLowerCase(), v]))
  const readFile = (p: string) => byName.get(p.toLowerCase()) ?? byName.get(p.replace(/^.*[\\/]/, '').toLowerCase()) ?? null
  try {
    const result = runBatchCsv(csvName, csvText, { data, readFile, onProgress: (msg) => postMessage({ type: 'log', msg }) })
    postMessage({ type: 'done', result })
  } catch (err) {
    postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
