/// <reference lib="webworker" />
/**
 * Compute worker: runs 3D tasks (`tasks.ts`) off the UI thread. Same file in the desktop app and
 * the browser preview.
 */
import { serve, type ToWorker } from './serve'

const ctx = self as unknown as DedicatedWorkerGlobalScope
ctx.onmessage = (e: MessageEvent<ToWorker>) => void serve(e.data, (m, transfer) => ctx.postMessage(m, transfer ?? []))
