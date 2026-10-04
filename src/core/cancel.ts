/** Thrown when a long run is stopped by its caller. */
export class Cancelled extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'Cancelled'
  }
}

export type CancelCheck = () => boolean

export function checkCancel(isCancelled?: CancelCheck) {
  if (isCancelled?.()) throw new Cancelled()
}

/** Progress and cancel hooks for long pure functions (run in a worker or inline in tests). */
export interface Work {
  /** Fraction done (0..1) and an optional note. Called at most every few thousand items. */
  progress?: (fraction: number, note?: string) => void
  isCancelled?: CancelCheck
}

/** Report progress and check for cancel every `every` items of `n`. */
export function tick(work: Work | undefined, i: number, n: number, every = 65536, from = 0, span = 1, note?: string) {
  if (!work || (i & (every - 1)) !== 0) return
  checkCancel(work.isCancelled)
  work.progress?.(from + (span * i) / Math.max(1, n), note)
}
