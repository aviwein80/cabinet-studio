/// <reference lib="webworker" />
import { quickjs, setQuickJsBase } from '@/cam/plugin/quickjs'
import { pluginBatchSteps } from '@/cam/plugin/steps'
import { runBatchCsv } from '@/core/batch'
import type { AppData, BatchSetup } from '@/core/types'

interface Request {
  csvName: string
  csvText: string
  drawings: Record<string, string>
  data: AppData
  /** A setup to run instead of the active one (setup wizard check, M2.9). */
  setup?: BatchSetup
  /** Where the plugin sandbox's WebAssembly is (M2.10). */
  pluginBase?: string
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const { csvName, csvText, drawings, data, setup, pluginBase } = e.data
  const byName = new Map(Object.entries(drawings).map(([k, v]) => [k.toLowerCase(), v]))
  const readFile = (p: string) => byName.get(p.toLowerCase()) ?? byName.get(p.replace(/^.*[\\/]/, '').toLowerCase()) ?? null
  // plugin batch steps (M2.10): in their sandboxes; the browser preview has no files or network for them
  let mod = null
  if (data.plugins?.some((p) => p.enabled && p.contributes?.steps.length)) {
    setQuickJsBase(pluginBase ?? null)
    mod = await quickjs().catch((err: unknown) => (postMessage({ type: 'log', msg: `Plugins are not available: ${err instanceof Error ? err.message : String(err)}` }), null))
  }
  const plugins = pluginBatchSteps(data, mod, { log: (l) => void (l.level !== 'info' && postMessage({ type: 'log', msg: `Plugin ${l.plugin}: ${l.text}` })) })
  for (const p of plugins.problems) postMessage({ type: 'log', msg: `Plugin ${p}` })
  try {
    const result = runBatchCsv(csvName, csvText, { data, readFile, onProgress: (msg) => postMessage({ type: 'log', msg }), extraSteps: plugins.steps, ...(setup ? { setup } : {}) })
    postMessage({ type: 'done', result })
  } catch (err) {
    postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  } finally {
    plugins.dispose()
  }
}
