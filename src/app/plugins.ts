/**
 * The page's side of plugins (M2.10): one background worker runs every plugin command
 * (`plugin.worker.ts`); file and network requests the sandbox allowed come back here and go to
 * the desktop app (which checks the grants again). A session log keeps what plugins said and
 * every request that was refused.
 */
import { quickjsPageBase } from '@/cam/plugin/quickjs'
import type { PluginContributions, PluginLogLine, PluginRecord } from '@/cam/plugin/types'
import type { AppData } from '@/core/types'
import { backend } from './backend'
import type { PluginWorkerEnv, PluginWorkerMessage, PluginWorkerRequest } from './plugin.worker'

/** A call that runs longer than this (the sandbox stops code after 5 s; waits up to 60 s) restarts the worker. */
const HARD_LIMIT_MS = 90_000

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()

const logLines: (PluginLogLine & { at: string })[] = []
const listeners = new Set<() => void>()
export const pluginLog = (): readonly (PluginLogLine & { at: string })[] => logLines
export function onPluginLog(cb: () => void) {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}
function addLog(line: PluginLogLine) {
  logLines.push({ ...line, at: new Date().toLocaleTimeString() })
  if (logLines.length > 300) logLines.splice(0, logLines.length - 300)
  for (const l of listeners) l()
}

function stop(reason: string) {
  worker?.terminate()
  worker = null
  for (const [, p] of pending) {
    clearTimeout(p.timer)
    p.reject(new Error(reason))
  }
  pending.clear()
}

function getWorker(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('./plugin.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = async (e: MessageEvent<PluginWorkerMessage>) => {
    const m = e.data
    if (m.type === 'log') return addLog(m.line)
    if (m.type === 'io') {
      const reply = (r: Omit<Extract<PluginWorkerRequest, { type: 'io-reply' }>, 'type' | 'io'>) => w.postMessage({ type: 'io-reply', io: m.io, ...r } satisfies PluginWorkerRequest)
      const b = backend.plugins
      if (!b) return reply({ ok: false, error: 'Files and the network are only available to plugins in the desktop app.' })
      try {
        const [a0, a1] = m.args as [string, unknown]
        const value = m.op === 'read' ? await b.read(a0, m.grants) : m.op === 'write' ? await b.write(a0, String(a1), m.grants) : m.op === 'list' ? await b.list(a0, m.grants) : await b.fetch(a0, a1, m.grants)
        reply({ ok: true, value: value ?? null })
      } catch (err) {
        reply({ ok: false, error: (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
      }
      return
    }
    const p = pending.get(m.req)
    if (!p) return
    pending.delete(m.req)
    clearTimeout(p.timer)
    if (m.type === 'done') p.resolve(m.value)
    else p.reject(new Error(m.message))
  }
  w.onerror = (e) => stop(`The plugin worker stopped: ${e.message}`)
  worker = w
  return w
}

const envOf = (data: AppData): PluginWorkerEnv => ({ units: data.settings.units, machine: { tools: data.machine.tools, placeholder: data.machine.placeholder }, base: quickjsPageBase() })

type Outgoing = { type: 'load'; record: PluginRecord; env: PluginWorkerEnv } | { type: 'call'; record: PluginRecord; env: PluginWorkerEnv; kind: 'menu' | 'post'; id: string; ctx: unknown }

function send<T>(msg: Outgoing): Promise<T> {
  const req = ++seq
  const w = getWorker()
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => stop('A plugin took too long; it was stopped.'), HARD_LIMIT_MS)
    pending.set(req, { resolve: resolve as (v: unknown) => void, reject, timer })
    w.postMessage({ ...msg, req } as PluginWorkerRequest)
  })
}

/** Start a plugin in the sandbox and say what it adds (its set-up code runs; nothing else). */
export function loadPlugin(record: PluginRecord, data: AppData): Promise<PluginContributions> {
  return send({ type: 'load', record, env: envOf(data) })
}

/** Run one of a plugin's menu commands on a copy of the part (or of the job's summary). */
export function runPluginMenu(record: PluginRecord, data: AppData, id: string, ctx: unknown): Promise<{ part?: unknown; result: { message?: string; file?: { name: string; data: string } } | null }> {
  return send({ type: 'call', record, env: envOf(data), kind: 'menu', id, ctx })
}

/** Run a script post (M2.10b). */
export function runPluginPost(record: PluginRecord, data: AppData, id: string, input: unknown): Promise<string> {
  return send({ type: 'call', record, env: envOf(data), kind: 'post', id, ctx: input })
}

/** Enabled plugins with menu items for an area. */
export function pluginMenus(data: AppData, area: 'part' | 'job') {
  return (data.plugins ?? []).filter((p) => p.enabled).flatMap((p) => (p.contributes?.menu ?? []).filter((m) => m.area === area).map((m) => ({ plugin: p, item: m })))
}
