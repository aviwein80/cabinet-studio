/**
 * Radial and spiral finishing (3D-05), both round a centre and kept inside the boundary.
 *
 * Radial: straight passes out from the centre, spaced so the gap between neighbouring passes is
 * never more than the step-over (at the outer edge). Towards the centre the passes crowd, so every
 * other pass stops where the passes either side of it are still within the step-over of each
 * other (and every other one of those further in, and so on); a set of base passes runs right in.
 *
 * Spiral: one continuous spiral whose turns are the step-over apart in plan (an Archimedean
 * spiral), from the centre out or from the outside in.
 *
 * Both drop the tool exactly along their plan paths and refine every move like parallel finishing
 * (`passes.ts`), so neither can dig into the model beyond the tolerance.
 */
import { checkCancel, type Work } from '@/core/cancel'
import type { P } from '../geom'
import type { Mesh } from '../mesh/types'
import type { Finish3dOp, Levels } from '../types'
import { cutChains, type Pt, refineAlong } from './chain'
import type { Cutter3D } from './cutter'
import { type Finish3dResult, LINK_STEPOVERS } from './parallel'
import { chainMoves, chainsAlong, clipPolyline, surfaceSampler } from './passes'
import { clipLine, polysBox, type Region } from './region'

/** Radial pass counts are a multiple of this, so passes can be dropped in halves towards the centre. */
const RADIAL_BASE = 8

/** Centre of radial and spiral passes: the op's own, or the middle of the region's box. */
export function passCentre(op: Pick<Finish3dOp, 'centre'>, region: Region): P {
  if (op.centre && Number.isFinite(op.centre.x) && Number.isFinite(op.centre.y)) return { x: op.centre.x, y: op.centre.y }
  const b = polysBox(region.polys)
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
}

/** Farthest the region reaches from c. */
function reach(region: Region, c: P): number {
  let r = 0
  for (const poly of region.polys) for (const p of poly) r = Math.max(r, Math.hypot(p.x - c.x, p.y - c.y))
  return r
}

/** How many times 2 divides k (k > 0), at most `cap`. */
function twos(k: number, cap: number): number {
  let v = 0
  while (v < cap && k % 2 === 0) {
    k /= 2
    v++
  }
  return v
}

/**
 * Radial pass layout: `n` passes evenly round the circle, pass k starting `start(k)` from the
 * centre. A pass that halves the gap of the coarser set starts where that coarser gap reaches the
 * step-over, so no gap anywhere is wider than the step-over.
 */
export function radialLayout(rMax: number, stepover: number, inner: number) {
  const step = Math.max(0.01, stepover)
  const n = RADIAL_BASE * Math.max(1, Math.ceil((2 * Math.PI * rMax) / step / RADIAL_BASE - 1e-9))
  const levels = Math.round(Math.log2(RADIAL_BASE))
  const start = (k: number) => {
    const v = k === 0 ? levels : twos(k, levels)
    if (v >= levels) return inner
    // the passes of the coarser set (k divisible by 2^(v+1)) are n / 2^(v+1) round the circle
    return Math.max(inner, (step * n) / (2 * Math.PI * 2 ** (v + 1)))
  }
  return { n, start, gap: (2 * Math.PI * rMax) / n }
}

export function radialFinish(op: Finish3dOp, mesh: Mesh, cutter: Cutter3D, region: Region, levels: Levels, work?: Work): Finish3dResult {
  const smp = surfaceSampler(op, mesh, cutter)
  if ('error' in smp) return { moves: [], warnings: [smp.error], minZ: NaN, spacing: 0 }
  const { sample, tol, gougeTol, step0 } = smp
  const c = passCentre(op, region)
  const rMax = reach(region, c)
  const inner = Math.max(0, op.innerRadius ?? 0)
  if (!region.polys.length || !(rMax > inner)) return { moves: [], warnings: ['The boundary is empty or lies inside the inner radius.'], minZ: NaN, spacing: 0 }
  const step = Math.max(0.01, op.stepover)
  const lay = radialLayout(rMax, step, inner)
  const a0 = (op.angle * Math.PI) / 180

  // passes in order round the circle; each is the ray from the centre clipped to the region
  const passes: Pt[][][] = []
  for (let k = 0; k < lay.n; k++) {
    if ((k & 15) === 0) {
      checkCancel(work?.isCancelled)
      work?.progress?.(k / lay.n, `Pass ${k + 1} of ${lay.n}`)
    }
    const a = a0 + (2 * Math.PI * k) / lay.n
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    const along = ux * c.x + uy * c.y
    const r0 = lay.start(k)
    const line: Pt[][] = []
    for (const [t0, t1] of clipLine(region, ux, uy, -uy * c.x + ux * c.y)) {
      const lo = Math.max(r0, t0 - along)
      const hi = t1 - along
      if (hi - lo > 1e-6) line.push(...cutChains(refineAlong((t) => sample(c.x + ux * t, c.y + uy * t), lo, hi, step0, tol, gougeTol)))
    }
    passes.push(line)
  }

  // zig-zag: out, then in on the next pass; one way: every pass out (or every pass in)
  const out = (op.travel ?? 'outward') === 'outward'
  const ordered: Pt[][] = []
  passes.forEach((line, k) => {
    const forward = op.pattern === 'zigzag' ? k % 2 === 0 : out
    ordered.push(...(forward ? line : [...line].reverse().map((ch) => [...ch].reverse())))
  })
  if (!ordered.length) return { moves: [], warnings: [nothing(region)], minZ: NaN, spacing: lay.gap }
  const { moves, minZ } = chainMoves(ordered, smp, region, mesh, { linkMax: LINK_STEPOVERS * step, levels })
  return { moves, warnings: [], minZ, spacing: lay.gap }
}

/**
 * Plan points of an Archimedean spiral round c, turns `pitch` apart, from radius r0 out to rMax
 * (one turn past it, so the outer edge is covered), within `sag` of the true curve.
 */
export function spiralPoints(c: P, r0: number, rMax: number, pitch: number, a0: number, ccw: boolean, sag = 0.0005): P[] {
  const b = pitch / (2 * Math.PI)
  const end = (rMax - r0) / b + 2 * Math.PI
  const pts: P[] = []
  const sgn = ccw ? 1 : -1
  for (let th = 0; ; ) {
    const r = r0 + b * th
    pts.push({ x: c.x + r * Math.cos(a0 + sgn * th), y: c.y + r * Math.sin(a0 + sgn * th) })
    if (th >= end) break
    // chord within `sag` of the curve: curvature (r² + 2b²) / (r² + b²)^1.5, arc length
    // sqrt(r² + b²) per radian
    const q = r * r + b * b
    const chord = Math.sqrt((8 * sag * q ** 1.5) / (r * r + 2 * b * b))
    th = Math.min(end, th + Math.min(Math.PI / 16, chord / Math.sqrt(q)))
  }
  return pts
}

export function spiralFinish(op: Finish3dOp, mesh: Mesh, cutter: Cutter3D, region: Region, levels: Levels, work?: Work): Finish3dResult {
  const smp = surfaceSampler(op, mesh, cutter)
  if ('error' in smp) return { moves: [], warnings: [smp.error], minZ: NaN, spacing: 0 }
  const c = passCentre(op, region)
  const rMax = reach(region, c)
  const inner = Math.max(0, op.innerRadius ?? 0)
  if (!region.polys.length || !(rMax > inner)) return { moves: [], warnings: ['The boundary is empty or lies inside the inner radius.'], minZ: NaN, spacing: 0 }
  const pitch = Math.max(0.01, op.stepover)
  checkCancel(work?.isCancelled)
  const pts = spiralPoints(c, inner, rMax, pitch, (op.angle * Math.PI) / 180, op.direction !== 'conventional')
  const pieces = clipPolyline(region, pts)
  const chains: Pt[][] = []
  pieces.forEach((piece, i) => {
    if ((i & 7) === 0) {
      checkCancel(work?.isCancelled)
      work?.progress?.(i / pieces.length, `Piece ${i + 1} of ${pieces.length}`)
    }
    chains.push(...chainsAlong(smp, piece))
  })
  const ordered = (op.travel ?? 'outward') === 'outward' ? chains : [...chains].reverse().map((ch) => [...ch].reverse())
  if (!ordered.length) return { moves: [], warnings: [nothing(region)], minZ: NaN, spacing: pitch }
  const { moves, minZ } = chainMoves(ordered, smp, region, mesh, { linkMax: LINK_STEPOVERS * pitch, levels })
  return { moves, warnings: [], minZ, spacing: pitch }
}

const nothing = (region: Region) => (region.fromModel ? 'Nothing to cut: no surface within the slope limits and groups chosen.' : 'Nothing to cut: the boundary does not cover the model within the slope limits and groups chosen.')
