/**
 * The plugin sandbox (M2.10, API-01). Each plugin gets its own QuickJS interpreter (WebAssembly):
 * no `require`, no `fetch`, no files, no access to the app's objects. The only way out is the
 * `cs` object (`prelude.ts`), which calls back here with JSON text. This side:
 *
 * - checks every file and network request against the owner's grants before anything happens,
 *   and logs every refusal;
 * - caps memory (64 MB) and the time a call may run (5 s by default), so a plugin cannot hang or
 *   exhaust the app;
 * - hands over copies of the data, never the app's own objects.
 *
 * It is pure TypeScript: the same host runs in the page's plugin worker, the batch workers and
 * the tests.
 */
import type { QuickJSContext, QuickJSDeferredPromise, QuickJSHandle, QuickJSRuntime, QuickJSWASMModule } from 'quickjs-emscripten-core'
import { nanoid } from 'nanoid'
import { makeEntity, entityContours } from '../doc'
import { area, boxOf, contourLength, polyline, rect, roundedRect, type Contour } from '../geom'
import { boolean, offset } from '../kernel'
import { defaultOp, OP_LABEL } from '../ops'
import type { CamOpKind, Entity, FaceId, Geom } from '../types'
import { formatLength, parseLength } from '@/core/units'
import type { MachineProfile, UnitSystem } from '@/core/types'
import { hostAllowed, normPath, pathAllowed } from './access'
import { codeHash } from './manifest'
import { PRELUDE } from './prelude'
import { quickjs } from './quickjs'
import type { MenuArea, PluginContributions, PluginGrants, PluginIO, PluginLogLine, PluginRecord } from './types'

export const PLUGIN_MEMORY_LIMIT = 64 * 1024 * 1024
export const PLUGIN_TIME_LIMIT_MS = 5000
/** Longest a call may wait for files or the network in total. */
export const PLUGIN_WAIT_LIMIT_MS = 60_000

export interface PluginEnv {
  machine?: Pick<MachineProfile, 'tools' | 'placeholder'>
  units?: UnitSystem
  io?: PluginIO
  log?(line: PluginLogLine): void
  /** Milliseconds a single run of plugin code may take (default 5 s). */
  timeLimitMs?: number
}

export class PluginError extends Error {}

/** Thrown into the plugin when it asks for something it was not granted. */
export class PluginDenied extends PluginError {}

type Call = 'menu' | 'step' | 'post'

const kinds = Object.keys(OP_LABEL) as CamOpKind[]
const GEOM_KINDS = new Set(['contour', 'circle', 'point', 'text', 'spline', 'poly3d'])

const num = (v: unknown, what: string) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new PluginError(`${what} must be a number.`)
  return v
}
const contours = (v: unknown): Contour[] => {
  const list = Array.isArray(v) ? v : [v]
  for (const c of list) if (!c || typeof c !== 'object' || !Array.isArray((c as Contour).segs)) throw new PluginError('Expected a contour ({ segs, closed }).')
  return list as Contour[]
}

export class PluginHost {
  readonly record: PluginRecord
  contributes: PluginContributions = { menu: [], steps: [], posts: [] }
  private rt: QuickJSRuntime | null = null
  private vm: QuickJSContext | null = null
  private deadline = 0
  private waits = new Set<Promise<unknown>>()
  /** Promises handed to the plugin that are not settled yet (released when the plugin stops). */
  private open = new Set<QuickJSDeferredPromise>()
  private env: PluginEnv

  private constructor(record: PluginRecord, env: PluginEnv) {
    this.record = record
    this.env = env
  }

  get grants(): PluginGrants {
    return this.record.grants
  }

  /** Start a plugin: the sandbox, the `cs` object, then the plugin's own code (its set-up). */
  static async start(record: PluginRecord, env: PluginEnv = {}): Promise<PluginHost> {
    return PluginHost.startWith(await quickjs(), record, env)
  }

  /** The same, with the engine already loaded (no waiting: the batch engine runs straight through). */
  static startWith(mod: QuickJSWASMModule, record: PluginRecord, env: PluginEnv = {}): PluginHost {
    if (record.codeHash !== codeHash(record.code)) throw new PluginError(`${record.manifest.name}: its code changed since it was installed; install it again.`)
    const h = new PluginHost(record, env)
    h.rt = mod.newRuntime()
    h.rt.setMemoryLimit(PLUGIN_MEMORY_LIMIT)
    h.rt.setMaxStackSize(1024 * 1024)
    h.rt.setInterruptHandler(() => Date.now() > h.deadline)
    h.vm = h.rt.newContext()
    const fnHandle = h.vm.newFunction('__host', (name, args) => h.hostCall(h.vm!.getString(name), h.vm!.getString(args)))
    h.vm.setProp(h.vm.global, '__host', fnHandle)
    fnHandle.dispose()
    try {
      h.evalOrThrow(PRELUDE, 'cs-api.js')
      h.evalOrThrow(record.code, `${record.id}.js`)
      h.pump()
      const found = h.vm.getProp(h.vm.global, '__cs')
      const f = h.vm.getProp(found, 'found')
      const res = h.vm.callFunction(f, found)
      f.dispose()
      found.dispose()
      h.contributes = JSON.parse(h.vm.getString(h.unwrap(res))) as PluginContributions
    } catch (e) {
      h.dispose()
      throw e
    }
    return h
  }

  dispose() {
    for (const d of this.open) d.dispose()
    this.open.clear()
    this.vm?.dispose()
    this.rt?.dispose()
    this.vm = null
    this.rt = null
  }

  setEnv(env: Partial<PluginEnv>) {
    this.env = { ...this.env, ...env }
  }

  private say(level: PluginLogLine['level'], text: string) {
    this.env.log?.({ plugin: this.record.id, level, text })
  }

  private arm() {
    this.deadline = Date.now() + (this.env.timeLimitMs ?? PLUGIN_TIME_LIMIT_MS)
  }

  private errorText(h: QuickJSHandle): string {
    const d = this.vm!.dump(h) as unknown
    h.dispose()
    if (d && typeof d === 'object' && 'message' in d) {
      const m = String((d as { message: unknown }).message)
      const name = String((d as { name?: unknown }).name ?? '')
      return /interrupted/i.test(m) ? `took longer than ${(this.env.timeLimitMs ?? PLUGIN_TIME_LIMIT_MS) / 1000} s and was stopped` : /out of memory/i.test(m) ? 'ran out of its memory (64 MB) and was stopped' : name && name !== 'Error' ? `${name}: ${m}` : m
    }
    return String(d)
  }

  private unwrap(res: { value: QuickJSHandle } | { error: QuickJSHandle }): QuickJSHandle {
    if ('error' in res && res.error) throw new PluginError(`${this.record.manifest.name}: ${this.errorText(res.error)}`)
    return (res as { value: QuickJSHandle }).value
  }

  private evalOrThrow(code: string, file: string) {
    this.arm()
    this.unwrap(this.vm!.evalCode(code, file)).dispose()
  }

  /** Run whatever the plugin's promises have queued. */
  private pump() {
    if (!this.rt) return
    this.arm()
    const r = this.rt.executePendingJobs()
    if ('error' in r && r.error) throw new PluginError(`${this.record.manifest.name}: ${this.errorText(r.error)}`)
  }

  private deny(what: string): never {
    this.say('denied', what)
    throw new PluginDenied(`${what} was not granted to this plugin. The owner can grant it on the Plugins screen.`)
  }

  private needFile(path: unknown, mode: 'read' | 'write'): string {
    if (typeof path !== 'string') throw new PluginError('A file path must be text.')
    const p = normPath(path)
    if (!p) this.deny(`${mode === 'read' ? 'Reading' : 'Writing'} "${path}" (not a full path)`)
    if (!pathAllowed(this.grants, p, mode)) this.deny(`${mode === 'read' ? 'Reading' : 'Writing'} ${p}`)
    return p
  }

  /** Calls from the plugin (`__host`). Returns a JSON string, or a promise for the async ones. */
  private hostCall(name: string, argsJson: string): QuickJSHandle | undefined {
    const vm = this.vm!
    const args = JSON.parse(argsJson) as unknown[]
    const out = (v: unknown) => (v === undefined ? undefined : vm.newString(JSON.stringify(v)))
    const io = this.env.io ?? {}
    switch (name) {
      case 'log':
        this.say(args[0] === 'warning' ? 'warning' : 'info', String(args[1]).slice(0, 2000))
        return undefined
      case 'newId':
        return out(nanoid(8))
      case 'part.entity': {
        const g = args[0] as Geom
        if (!g || typeof g !== 'object' || !GEOM_KINDS.has((g as { t?: string }).t ?? '')) throw new PluginError('A shape needs a geometry such as cs.geom.rect(...) wrapped as { t: "contour", c }.')
        const face = num(args[2] ?? 1, 'face') as FaceId
        return out(makeEntity(g, String(args[1] ?? 'outline'), face))
      }
      case 'ops.kinds':
        return out(kinds)
      case 'ops.default': {
        const k = String(args[0]) as CamOpKind
        if (!kinds.includes(k)) throw new PluginError(`Unknown operation kind "${k}". Kinds: ${kinds.join(', ')}.`)
        return out(defaultOp(k, Array.isArray(args[1]) ? (args[1] as string[]) : []))
      }
      case 'tools.list':
        return out((this.env.machine?.tools ?? []).map((t) => ({ ...t, placeholder: !!this.env.machine?.placeholder })))
      case 'units.current':
        return out(this.env.units ?? 'mm')
      case 'units.format':
        return out(formatLength(num(args[0], 'length'), this.env.units ?? 'mm'))
      case 'units.parse':
        return out(parseLength(String(args[0]), this.env.units ?? 'mm'))
      case 'geom.rect':
        return out({ t: 'contour', c: rect(num(args[0], 'x'), num(args[1], 'y'), num(args[2], 'width'), num(args[3], 'height')) })
      case 'geom.roundedRect':
        return out({ t: 'contour', c: roundedRect(num(args[0], 'x'), num(args[1], 'y'), num(args[2], 'width'), num(args[3], 'height'), num(args[4], 'radius')) })
      case 'geom.circle':
        return out({ t: 'circle', c: { x: num(args[0], 'x'), y: num(args[1], 'y') }, r: num(args[2], 'radius') })
      case 'geom.polyline': {
        const pts = (Array.isArray(args[0]) ? args[0] : []).map((p) => ({ x: num((p as { x: unknown }).x, 'x'), y: num((p as { y: unknown }).y, 'y') }))
        if (pts.length < 2) throw new PluginError('A polyline needs at least two points.')
        return out({ t: 'contour', c: polyline(pts, !!args[1]) })
      }
      case 'geom.offset':
        return out(offset(contours(args[0]), num(args[1], 'distance')))
      case 'geom.boolean': {
        const op = ({ union: 'unite', difference: 'subtract', intersection: 'intersect' } as const)[String(args[0]) as 'union']
        return out(boolean(op, contours(args[1]), contours(args[2])))
      }
      case 'geom.area':
        return out(Math.abs(area(contours(args[0])[0])))
      case 'geom.length':
        return out(contourLength(contours(args[0])[0]))
      case 'geom.box':
        return out(boxOf(contours(args[0])))
      case 'geom.ofShape':
        return out(entityContours(args[0] as Entity))
      case 'files.read':
        return this.later(() => {
          const p = this.needFile(args[0], 'read')
          if (!io.readText) this.deny('Reading files (not available here)')
          return io.readText(p)
        })
      case 'files.write':
        return this.later(() => {
          const p = this.needFile(args[0], 'write')
          if (!io.writeText) this.deny('Writing files (not available here)')
          return io.writeText(p, String(args[1]))
        })
      case 'files.list':
        return this.later(() => {
          const p = this.needFile(args[0], 'read')
          if (!io.list) this.deny('Listing folders (not available here)')
          return io.list(p)
        })
      case 'net.fetch':
        return this.later(() => {
          const url = String(args[0])
          if (!hostAllowed(this.grants, url)) this.deny(`Fetching ${url}`)
          if (!io.fetchText) this.deny('Network access (not available here)')
          const init = (args[1] ?? {}) as { method?: string; body?: string; headers?: Record<string, string> }
          return io.fetchText(url, { method: String(init.method ?? 'GET').toUpperCase(), ...(init.body !== undefined ? { body: String(init.body) } : {}), ...(init.headers ? { headers: init.headers } : {}) })
        })
      default:
        throw new PluginError(`Unknown call ${name}.`)
    }
  }

  /** A promise inside the sandbox for a file or network call: settled now if the answer is ready. */
  private later(run: () => unknown): QuickJSHandle {
    const vm = this.vm!
    const d = vm.newPromise()
    this.open.add(d)
    const settle = (ok: boolean, v: unknown) => {
      if (!this.vm || !this.open.delete(d)) return
      if (ok) {
        const h = vm.newString(JSON.stringify(v === undefined ? null : v))
        d.resolve(h)
        h.dispose()
      } else {
        const h = vm.newError({ name: v instanceof PluginDenied ? 'PermissionError' : 'Error', message: v instanceof Error ? v.message : String(v) })
        d.reject(h)
        h.dispose()
      }
    }
    let r: unknown
    try {
      r = run()
    } catch (e) {
      settle(false, e)
      return d.handle
    }
    if (r instanceof Promise) {
      const w: Promise<unknown> = r.then(
        (v) => settle(true, v),
        (e) => settle(false, e),
      )
      this.waits.add(w)
      void w.finally(() => this.waits.delete(w))
    } else settle(true, r)
    return d.handle
  }

  private invoke(kind: Call, id: string, hook: string, ctx: unknown): QuickJSHandle {
    if (!this.vm) throw new PluginError(`${this.record.manifest.name} is not running.`)
    const vm = this.vm
    const api = vm.getProp(vm.global, '__cs')
    const run = vm.getProp(api, 'run')
    const args = [vm.newString(kind), vm.newString(id), vm.newString(hook), vm.newString(JSON.stringify(ctx ?? null))]
    this.arm()
    const res = vm.callFunction(run, api, ...args)
    for (const a of args) a.dispose()
    run.dispose()
    api.dispose()
    return this.unwrap(res)
  }

  private settled(p: QuickJSHandle): { done: true; value: unknown } | { done: false } {
    const vm = this.vm!
    const st = vm.getPromiseState(p)
    if (st.type === 'pending') return { done: false }
    if (st.type === 'rejected') {
      p.dispose()
      throw new PluginError(`${this.record.manifest.name}: ${this.errorText(st.error)}`)
    }
    const text = vm.getString(st.value)
    st.value.dispose()
    p.dispose()
    return { done: true, value: JSON.parse(text) }
  }

  /**
   * Run a contribution and wait for it. Used where waiting is fine (menu commands, previews).
   */
  async call(kind: Call, id: string, hook: string, ctx: unknown): Promise<unknown> {
    const p = this.invoke(kind, id, hook, ctx)
    const until = Date.now() + PLUGIN_WAIT_LIMIT_MS
    for (;;) {
      this.pump()
      const s = this.settled(p)
      if (s.done) return s.value
      if (!this.waits.size) {
        p.dispose()
        throw new PluginError(`${this.record.manifest.name}: ${kind} "${id}" never finished (a promise that is never settled).`)
      }
      if (Date.now() > until) {
        p.dispose()
        throw new PluginError(`${this.record.manifest.name}: ${kind} "${id}" waited more than ${PLUGIN_WAIT_LIMIT_MS / 1000} s for files or the network.`)
      }
      await Promise.race(this.waits)
    }
  }

  /**
   * Run a contribution that must finish straight away (batch steps inside the batch engine).
   * Files answer at once where the engine runs; a plugin that waits for the network here fails.
   */
  callNow(kind: Call, id: string, hook: string, ctx: unknown): unknown {
    const p = this.invoke(kind, id, hook, ctx)
    this.pump()
    const s = this.settled(p)
    if (s.done) return s.value
    p.dispose()
    throw new PluginError(`${this.record.manifest.name}: ${kind} "${id}" has to wait (files or network); it cannot run here.`)
  }
}

export const menuArea = (a: unknown): MenuArea => (a === 'job' ? 'job' : 'part')
