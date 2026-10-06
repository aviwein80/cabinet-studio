/// <reference lib="webworker" />
/**
 * Plugin commands run here (M2.10), off the page's thread, each plugin in its own sandbox. File
 * and network requests the sandbox has allowed are passed to the page, which asks the desktop
 * app's main process (which checks the grants again).
 */
import { PluginHost } from '@/cam/plugin/host'
import { setQuickJsBase } from '@/cam/plugin/quickjs'
import type { PluginRecord } from '@/cam/plugin/types'
import type { MachineProfile, UnitSystem } from '@/core/types'

export type PluginWorkerEnv = { units: UnitSystem; machine: Pick<MachineProfile, 'tools' | 'placeholder'>; base?: string }

export type PluginWorkerRequest =
  | { type: 'load'; req: number; record: PluginRecord; env: PluginWorkerEnv }
  | { type: 'call'; req: number; record: PluginRecord; env: PluginWorkerEnv; kind: 'menu' | 'post'; id: string; ctx: unknown }
  | { type: 'io-reply'; io: number; ok: boolean; value?: unknown; error?: string }

export type PluginWorkerMessage =
  | { type: 'done'; req: number; value: unknown }
  | { type: 'error'; req: number; message: string }
  | { type: 'io'; io: number; op: 'read' | 'write' | 'list' | 'fetch'; args: unknown[]; grants: PluginRecord['grants'] }
  | { type: 'log'; line: import('@/cam/plugin/types').PluginLogLine }

const hosts = new Map<string, { key: string; host: PluginHost }>()
const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
let ioSeq = 0

const post = (m: PluginWorkerMessage) => postMessage(m)

function ask(op: 'read' | 'write' | 'list' | 'fetch', args: unknown[], grants: PluginRecord['grants']) {
  const io = ++ioSeq
  return new Promise<unknown>((resolve, reject) => {
    waiting.set(io, { resolve, reject })
    post({ type: 'io', io, op, args, grants })
  })
}

async function hostFor(record: PluginRecord, env: PluginWorkerEnv): Promise<PluginHost> {
  setQuickJsBase(env.base ?? null)
  const key = JSON.stringify([record.codeHash, record.grants, env.units, env.machine])
  const cur = hosts.get(record.id)
  if (cur && cur.key === key) return cur.host
  cur?.host.dispose()
  hosts.delete(record.id)
  const g = record.grants
  const host = await PluginHost.start(record, {
    units: env.units,
    machine: env.machine,
    log: (line) => post({ type: 'log', line }),
    io: {
      readText: (p) => ask('read', [p], g) as Promise<string>,
      writeText: (p, t) => ask('write', [p, t], g) as Promise<void>,
      list: (p) => ask('list', [p], g) as Promise<string[]>,
      fetchText: (u, init) => ask('fetch', [u, init], g) as Promise<string>,
    },
  })
  hosts.set(record.id, { key, host })
  return host
}

self.onmessage = async (e: MessageEvent<PluginWorkerRequest>) => {
  const m = e.data
  if (m.type === 'io-reply') {
    const w = waiting.get(m.io)
    waiting.delete(m.io)
    if (m.ok) w?.resolve(m.value)
    else w?.reject(new Error(m.error ?? 'failed'))
    return
  }
  try {
    const host = await hostFor(m.record, m.env)
    const value = m.type === 'load' ? host.contributes : await host.call(m.kind, m.id, '', m.ctx)
    post({ type: 'done', req: m.req, value })
  } catch (err) {
    post({ type: 'error', req: m.req, message: err instanceof Error ? err.message : String(err) })
  }
}
