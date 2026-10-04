/**
 * Message handling of the compute worker, kept apart from the worker global so it can be tested
 * in-process. Progress is posted at most every 100 ms.
 */
import { Cancelled } from '@/core/cancel'
import { runTask, type TaskName, transferables } from './tasks'

export type ToWorker = { id: number; task: TaskName; input: unknown; cancel?: SharedArrayBuffer }
export type FromWorker =
  | { id: number; kind: 'progress'; fraction: number; note?: string }
  | { id: number; kind: 'done'; result: unknown }
  | { id: number; kind: 'error'; message: string; cancelled: boolean }

export async function serve(msg: ToWorker, post: (m: FromWorker, transfer?: ArrayBuffer[]) => void) {
  const { id, task, input, cancel } = msg
  const flag = cancel ? new Int32Array(cancel) : null
  let last = -Infinity
  try {
    const result = await runTask(task, input as never, {
      isCancelled: () => !!flag && Atomics.load(flag, 0) === 1,
      progress: (fraction, note) => {
        const now = performance.now()
        if (now - last < 100) return
        last = now
        post({ id, kind: 'progress', fraction, note })
      },
    })
    post({ id, kind: 'done', result }, transferables(result))
  } catch (err) {
    post({ id, kind: 'error', message: err instanceof Error ? err.message : String(err), cancelled: err instanceof Cancelled })
  }
}
