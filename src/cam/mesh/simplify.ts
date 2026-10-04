/**
 * Mesh simplification with meshoptimizer (MIT, its WebAssembly is embedded in the package and
 * loaded on first use). The result is measured independently with `meshDeviation`, so the
 * reported shape error is ours, not the simplifier's own estimate.
 */
import { checkCancel, type Work } from '@/core/cancel'
import { rebuild } from './build'
import { meshDeviation } from './distance'
import { type Mesh, triCount } from './types'

export type SimplifyTarget = { k: 'percent'; percent: number } | { k: 'tolerance'; mm: number }

export interface SimplifyResult {
  mesh: Mesh
  before: number
  after: number
  /** Largest measured distance between the two surfaces (sampled both ways), mm. */
  deviation: number
  meanDeviation: number
}

type Simplifier = (typeof import('meshoptimizer'))['MeshoptSimplifier']
let simplifier: Promise<Simplifier> | null = null

/** meshoptimizer is imported only when first needed (not part of the start-up bundle). */
export function loadSimplifier(): Promise<Simplifier> {
  simplifier ??= import('meshoptimizer').then(async (m) => {
    await m.MeshoptSimplifier.ready
    return m.MeshoptSimplifier
  })
  return simplifier
}

export async function simplifyMesh(mesh: Mesh, target: SimplifyTarget, work?: Work): Promise<SimplifyResult> {
  const S = await loadSimplifier()
  checkCancel(work?.isCancelled)
  work?.progress?.(0.05, 'Simplifying')
  const before = triCount(mesh)
  // Open edges stay where they are, so a relief keeps its boundary and joins stay closed.
  const flags: ('LockBorder' | 'ErrorAbsolute')[] = ['LockBorder', 'ErrorAbsolute']
  const run = (count: number, err: number) => rebuild({ positions: mesh.positions, indices: S.simplify(mesh.indices, mesh.positions, 3, count, err, flags)[0] }).mesh
  const measure = (m: Mesh, from: number, span: number, samples?: number) => meshDeviation(mesh, m, { samples, work: { isCancelled: work?.isCancelled, progress: (f, n) => work?.progress?.(from + span * f, n) } })

  if (target.k === 'percent') {
    const out = run(Math.max(3, Math.floor((before * Math.max(0, Math.min(100, target.percent))) / 100) * 3), Number.MAX_VALUE)
    checkCancel(work?.isCancelled)
    work?.progress?.(0.5, 'Measuring the change')
    const d = measure(out, 0.5, 0.5)
    return { mesh: out, before, after: triCount(out), deviation: d.max, meanDeviation: d.mean }
  }
  // Tolerance: the simplifier's own error setting is not a distance guarantee (it can move a
  // surface even at 0), so every candidate is measured. First try the tolerance as the error
  // limit; if the measured deviation is too big, search for the smallest facet count whose
  // measured deviation is within the limit (the cheapest collapses go first, so fewer
  // collapses never move the surface more).
  const tol = Math.max(0, target.mm)
  const steps = 9
  let k = 0
  // Search steps measure a sample; the result is measured in full before it is returned.
  const tryOut = (count: number, err: number) => {
    checkCancel(work?.isCancelled)
    const out = run(count, err)
    const d = measure(out, (k / (steps + 1)) * 0.95, 0.95 / (steps + 1), 60_000)
    k++
    return { out, d }
  }
  const verified = (r: { out: Mesh }) => {
    const d = measure(r.out, 0.95, 0.05)
    return d.max <= tol ? { mesh: r.out, before, after: triCount(r.out), deviation: d.max, meanDeviation: d.mean } : null
  }
  const first = tryOut(0, tol)
  const ok = first.d.max <= tol ? verified(first) : null
  if (ok) return ok
  let lo = triCount(first.out)
  let hi = before
  let best: { out: Mesh; d: { max: number; mean: number } } | null = null
  while (k < steps && hi - lo > Math.max(16, before * 0.01)) {
    const mid = Math.round((lo + hi) / 2)
    const r = tryOut(mid * 3, Number.MAX_VALUE)
    if (r.d.max <= tol) {
      hi = triCount(r.out)
      best = r
    } else lo = mid
  }
  const result = best ? verified(best) : null
  work?.progress?.(1, 'Done')
  return result ?? { mesh, before, after: before, deviation: 0, meanDeviation: 0 }
}
