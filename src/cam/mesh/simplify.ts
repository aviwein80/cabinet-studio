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
  const measure = (m: Mesh, from: number, span: number) => meshDeviation(mesh, m, { work: { isCancelled: work?.isCancelled, progress: (f, n) => work?.progress?.(from + span * f, n) } })

  if (target.k === 'percent') {
    const out = run(Math.max(3, Math.floor((before * Math.max(0, Math.min(100, target.percent))) / 100) * 3), Number.MAX_VALUE)
    checkCancel(work?.isCancelled)
    work?.progress?.(0.5, 'Measuring the change')
    const d = measure(out, 0.5, 0.5)
    return { mesh: out, before, after: triCount(out), deviation: d.max, meanDeviation: d.mean }
  }
  // Tolerance: the simplifier's own error estimate is not a distance guarantee, so measure the
  // result and tighten until the measured deviation is within the limit (at most 6 tries).
  const tol = Math.max(0, target.mm)
  let err = tol
  for (let i = 0; i < 6; i++) {
    checkCancel(work?.isCancelled)
    const out = run(0, err)
    const d = measure(out, (i / 6) * 0.95, 0.95 / 6)
    if (d.max <= tol || i === 5) {
      work?.progress?.(1, 'Done')
      if (d.max > tol) return { mesh, before, after: before, deviation: 0, meanDeviation: 0 }
      return { mesh: out, before, after: triCount(out), deviation: d.max, meanDeviation: d.mean }
    }
    err *= Math.max(0.2, Math.min(0.8, (tol / d.max) * 0.9))
  }
  return { mesh, before, after: before, deviation: 0, meanDeviation: 0 }
}
