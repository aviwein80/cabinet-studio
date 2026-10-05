/**
 * Runs compute tasks in background workers with progress and cancel. Each call gets a free worker
 * (a small pool); a cancelled call raises `Cancelled`. Cancel first sets a shared flag (when the
 * page allows SharedArrayBuffer) so the task can stop cleanly; if it has not stopped within
 * `hardStopMs` the worker is ended and replaced. Tasks are pure, so ending one is always safe.
 */
import { Cancelled } from '@/core/cancel'
import type { FromWorker, ToWorker } from './serve'
import type { TaskIn, TaskName, TaskOut } from './tasks'

export interface WorkerLike {
  postMessage(msg: ToWorker): void
  terminate(): void
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null
  onerror: ((e: ErrorEvent) => void) | null
}

export interface RunOptions {
  onProgress?: (fraction: number, note?: string) => void
  signal?: AbortSignal
}

interface Slot {
  w: WorkerLike
  busy: boolean
}

export class ComputeClient {
  private slots: Slot[] = []
  private next = 1
  private waiting: (() => void)[] = []
  private readonly make: () => WorkerLike
  private readonly size: number
  private readonly hardStopMs: number

  constructor(make: () => WorkerLike, size = 2, hardStopMs = 300) {
    this.make = make
    this.size = Math.max(1, size)
    this.hardStopMs = hardStopMs
  }

  private async acquire(): Promise<Slot> {
    for (;;) {
      const free = this.slots.find((s) => !s.busy)
      if (free) {
        free.busy = true
        return free
      }
      if (this.slots.length < this.size) {
        const s = { w: this.make(), busy: true }
        this.slots.push(s)
        return s
      }
      await new Promise<void>((r) => this.waiting.push(r))
    }
  }

  private release(s: Slot, ended: boolean) {
    if (ended) {
      s.w.terminate()
      this.slots = this.slots.filter((x) => x !== s)
    } else s.busy = false
    this.waiting.shift()?.()
  }

  run<K extends TaskName>(task: K, input: TaskIn<K>, opt: RunOptions = {}): Promise<TaskOut<K>> {
    return new Promise<TaskOut<K>>((resolve, reject) => {
      if (opt.signal?.aborted) return reject(new Cancelled())
      void this.acquire().then((slot) => {
        if (opt.signal?.aborted) {
          this.release(slot, false)
          return reject(new Cancelled())
        }
        const id = this.next++
        const cancel = typeof SharedArrayBuffer !== 'undefined' && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated ? new SharedArrayBuffer(4) : undefined
        let settled = false
        let timer: ReturnType<typeof setTimeout> | undefined
        const finish = (ended: boolean) => {
          settled = true
          if (timer) clearTimeout(timer)
          opt.signal?.removeEventListener('abort', onAbort)
          slot.w.onmessage = null
          slot.w.onerror = null
          this.release(slot, ended)
        }
        const onAbort = () => {
          if (settled) return
          if (cancel) Atomics.store(new Int32Array(cancel), 0, 1)
          timer = setTimeout(
            () => {
              if (settled) return
              finish(true)
              reject(new Cancelled())
            },
            cancel ? this.hardStopMs : 0,
          )
        }
        opt.signal?.addEventListener('abort', onAbort)
        slot.w.onmessage = (e) => {
          const m = e.data
          if (m.id !== id || settled) return
          if (m.kind === 'progress') opt.onProgress?.(m.fraction, m.note)
          else if (m.kind === 'done') {
            finish(false)
            resolve(m.result as TaskOut<K>)
          } else {
            finish(false)
            reject(m.cancelled ? new Cancelled() : new Error(m.message))
          }
        }
        slot.w.onerror = (e) => {
          if (settled) return
          finish(true)
          reject(new Error(e.message || 'Background task failed.'))
        }
        slot.w.postMessage({ id, task, input, cancel })
      })
    })
  }

  dispose() {
    for (const s of this.slots) s.w.terminate()
    this.slots = []
  }
}

let shared: ComputeClient | null = null

/** The app's compute workers (created on first use). */
export function compute(): ComputeClient {
  shared ??= new ComputeClient(
    () => new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module', name: 'compute' }) as unknown as WorkerLike,
    typeof navigator !== 'undefined' ? Math.max(1, Math.min(2, (navigator.hardwareConcurrency ?? 2) - 1)) : 1,
  )
  return shared
}

let solid: ComputeClient | null = null

/**
 * The worker that reads solid files. One worker, kept alive, so the OpenCascade reader loads (and
 * compiles its WebAssembly) once, on the first solid read, never at start-up.
 */
export function solidCompute(): ComputeClient {
  solid ??= new ComputeClient(() => new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module', name: 'solid' }) as unknown as WorkerLike, 1, 1000)
  return solid
}

/** Absolute URL of the folder holding the OpenCascade reader files (next to the app's page). */
export function occtVendorUrl(): string | undefined {
  return typeof document !== 'undefined' ? new URL('vendor/occt-import-js/', document.baseURI).href : undefined
}
