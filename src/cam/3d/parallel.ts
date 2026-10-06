/**
 * Parallel finishing (3D-02): straight passes at an angle across the model, the tool dropped onto
 * the surface along each pass. Every point of every pass is an exact drop-cutter position, and
 * the straight moves between them are refined until they stay within the tolerance of the true
 * tool-centre surface, so the tool cannot dig into the model beyond that tolerance.
 */
import { checkCancel, type Work } from '@/core/cancel'
import type { Mesh } from '../mesh/types'
import type { Move } from '../toolpath'
import type { Finish3dOp, Levels } from '../types'
import { cutChains, type Pt, refineAlong } from './chain'
import type { Cutter3D } from './cutter'
import { chainMoves, surfaceSampler } from './passes'
import { clipLine, extent, type Region } from './region'

export interface Finish3dResult {
  moves: Move[]
  warnings: string[]
  /** Lowest tool-tip Z of any cutting move (NaN when nothing was cut). */
  minZ: number
  /** Passes actually used (span divided evenly, never wider than the step-over). */
  spacing: number
}

/** A link between passes stays down only up to this many step-overs. */
export const LINK_STEPOVERS = 2

export function parallelFinish(op: Finish3dOp, mesh: Mesh, cutter: Cutter3D, region: Region, levels: Levels, work?: Work): Finish3dResult {
  const warnings: string[] = []
  const smp = surfaceSampler(op, mesh, cutter)
  if ('error' in smp) return { moves: [], warnings: [smp.error], minZ: NaN, spacing: 0 }
  const { sample, tol, gougeTol, step0 } = smp

  const a = (op.angle * Math.PI) / 180
  const ux = Math.cos(a)
  const uy = Math.sin(a)
  const { lo, hi } = extent(region, ux, uy)
  if (!Number.isFinite(lo) || hi - lo < 0) return { moves: [], warnings: ['The boundary is empty.'], minZ: NaN, spacing: 0 }
  const step = Math.max(0.01, op.stepover)
  const nPass = Math.max(1, Math.ceil((hi - lo - 2e-6) / step))
  const spacing = nPass > 0 ? (hi - lo - 2e-6) / nPass : 0

  /** Points along one interval, refined to the tolerance and split where cutting stops. */
  const pass = (s0: number, t0: number, t1: number): Pt[][] => cutChains(refineAlong((t) => sample(ux * t - uy * s0, uy * t + ux * s0), t0, t1, step0, tol, gougeTol))

  // all passes, in order across the region
  const passes: Pt[][][] = []
  for (let k = 0; k <= nPass; k++) {
    if ((k & 7) === 0) {
      checkCancel(work?.isCancelled)
      work?.progress?.(k / (nPass + 1), `Pass ${k + 1} of ${nPass + 1}`)
    }
    const sOff = lo + 1e-6 + k * spacing
    const line: Pt[][] = []
    for (const [t0, t1] of clipLine(region, ux, uy, sOff)) line.push(...pass(sOff, t0, t1))
    passes.push(line)
  }

  // direction: zig-zag alternates; one-way runs every pass the same way
  const oneWayForward = op.direction === 'climb'
  const ordered: Pt[][] = []
  passes.forEach((line, k) => {
    const forward = op.pattern === 'zigzag' ? k % 2 === 0 : oneWayForward
    const chains = forward ? line : [...line].reverse().map((c) => [...c].reverse())
    ordered.push(...chains)
  })
  if (!ordered.length) {
    warnings.push(region.fromModel ? 'Nothing to cut: no surface within the slope limits and groups chosen.' : 'Nothing to cut: the boundary does not cover the model within the slope limits and groups chosen.')
    return { moves: [], warnings, minZ: NaN, spacing }
  }
  const { moves, minZ } = chainMoves(ordered, smp, region, mesh, { linkMax: LINK_STEPOVERS * step, levels })
  return { moves, warnings, minZ, spacing }
}
