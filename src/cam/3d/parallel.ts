/**
 * Parallel finishing (3D-02): straight passes at an angle across the model, the tool dropped onto
 * the surface along each pass. Every point of every pass is an exact drop-cutter position, and
 * the straight moves between them are refined until they stay within the tolerance of the true
 * tool-centre surface, so the tool cannot dig into the model beyond that tolerance.
 */
import { checkCancel, type Work } from '@/core/cancel'
import type { Mesh } from '../mesh/types'
import { meshBounds } from '../mesh/types'
import type { Move } from '../toolpath'
import type { Finish3dOp, Levels } from '../types'
import { cutChains, type Pt, refineAlong, simplify } from './chain'
import { type Cutter3D, grownCutter } from './cutter'
import { DropCutter } from './dropcutter'
import { clipLine, extent, insideRegion, type Region } from './region'

export interface Finish3dResult {
  moves: Move[]
  warnings: string[]
  /** Lowest tool-tip Z of any cutting move (NaN when nothing was cut). */
  minZ: number
  /** Passes actually used (span divided evenly, never wider than the step-over). */
  spacing: number
}

/** Steepest a point may be and still count as flat (skip flats). */
const FLAT_DEG = 0.5
/** A link between passes stays down only up to this many step-overs. */
const LINK_STEPOVERS = 2

export function parallelFinish(op: Finish3dOp, mesh: Mesh, cutter: Cutter3D, region: Region, levels: Levels, work?: Work): Finish3dResult {
  const warnings: string[] = []
  const s = Math.max(0, op.surface.stockToLeave)
  const grown = grownCutter(cutter, s)
  if (!grown) return { moves: [], warnings: ['Stock to leave needs a ball-nose, bull-nose or flat tool (not a V cutter).'], minZ: NaN, spacing: 0 }
  const dc = new DropCutter(mesh, grown)
  const tol = Math.max(0.001, op.surface.tolerance || 0.01)
  // Moves may sit below the true tool-centre surface by at most this much between samples.
  const gougeTol = Math.min(tol, 0.002)
  const step0 = Math.min(0.5, Math.max(0.05, cutter.R / 3))
  const slopeMin = Math.max(op.slope.min, op.skipFlats ? FLAT_DEG : 0)
  const slopeMax = op.slope.max
  const machine = op.surface.groups?.length ? new Set(op.surface.groups) : null
  const protect = new Set(op.surface.protect ?? [])
  const groups = mesh.groups

  const sample = (x: number, y: number): Pt => {
    if (!dc.drop(x, y)) return { x, y, z: NaN, ok: false, cut: false, prot: false }
    const slope = (Math.acos(Math.max(-1, Math.min(1, dc.hitNz))) * 180) / Math.PI
    const g = groups ? groups[dc.hitTri] : 0
    const cut = slope >= slopeMin - 1e-9 && slope <= slopeMax + 1e-9 && !protect.has(g) && (!machine || machine.has(g))
    return { x, y, z: dc.z + s, ok: true, cut, prot: protect.has(g) }
  }

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

  // moves
  const top = meshBounds(mesh).max[2] + s
  const clear = Math.max(levels.safeZ, top + levels.rapidZ)
  const moves: Move[] = []
  let minZ = Infinity
  const chainArray = (c: Pt[]) => {
    const f = new Float64Array(c.length * 3)
    c.forEach((p, i) => {
      f[i * 3] = p.x
      f[i * 3 + 1] = p.y
      f[i * 3 + 2] = p.z
      if (p.z < minZ) minZ = p.z
    })
    return f
  }
  const linkDown = (from: Pt, to: Pt): Pt[] | null => {
    const d = Math.hypot(to.x - from.x, to.y - from.y)
    if (d > LINK_STEPOVERS * step + 1e-9 || !insideRegion(region, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, 1e-4)) return null
    const n = Math.max(1, Math.ceil(d / step0))
    const out: Pt[] = []
    for (let i = 1; i < n; i++) {
      const p = sample(from.x + ((to.x - from.x) * i) / n, from.y + ((to.y - from.y) * i) / n)
      if (!p.ok || p.prot) return null
      out.push(p)
    }
    // refine the link like a pass so it cannot dig in either
    const pts = [from, ...out, to]
    const fine: Pt[] = [from]
    for (let i = 1; i < pts.length; i++) {
      const segs = refineLink(pts[i - 1], pts[i], 0)
      if (!segs) return null
      fine.push(...segs, pts[i])
    }
    return fine.slice(1, -1)
  }
  const refineLink = (pa: Pt, pb: Pt, depth: number): Pt[] | null => {
    const m = sample((pa.x + pb.x) / 2, (pa.y + pb.y) / 2)
    if (!m.ok || m.prot) return null
    const lin = (pa.z + pb.z) / 2
    let fine = m.z - lin <= gougeTol && Math.abs(m.z - lin) <= tol
    if (fine && (Math.abs(m.z - lin) > gougeTol / 8 || Math.abs(pb.z - pa.z) > 0.5 * Math.hypot(pb.x - pa.x, pb.y - pa.y)))
      for (const f of [0.25, 0.75]) {
        const q = sample(pa.x + (pb.x - pa.x) * f, pa.y + (pb.y - pa.y) * f)
        if (!q.ok || q.prot) return null
        if (q.z - (pa.z + (pb.z - pa.z) * f) > gougeTol) fine = false
      }
    if (depth >= 9 || fine) return [m]
    const l = refineLink(pa, m, depth + 1)
    const r = refineLink(m, pb, depth + 1)
    return l && r ? [...l, m, ...r] : null
  }

  let last: Pt | null = null
  for (const c of ordered) {
    const first = c[0]
    const link = last ? linkDown(last, first) : null
    if (last && link) {
      if (link.length) moves.push({ t: 'poly', pts: chainArray(simplify([last, ...link, first]).slice(1)), f: 'cut' })
      else moves.push({ t: 'poly', pts: chainArray([first]), f: 'cut' })
    } else {
      if (last) moves.push({ t: 'rapid', x: last.x, y: last.y, z: clear })
      moves.push({ t: 'rapid', x: first.x, y: first.y, z: clear })
      // Rapid only to just above the stock top (face 1, or the model's top where that is higher):
      // material above the surface may not have been roughed away. Then feed down.
      const above = Math.max(levels.rapidZ, first.z + levels.rapidZ)
      if (above < clear) moves.push({ t: 'rapid', x: first.x, y: first.y, z: above })
      moves.push({ t: 'feed', x: first.x, y: first.y, z: first.z, f: 'plunge' })
    }
    moves.push({ t: 'poly', pts: chainArray(c.slice(1)), f: 'cut' })
    last = c[c.length - 1]
  }
  if (last) moves.push({ t: 'rapid', x: last.x, y: last.y, z: clear })
  return { moves, warnings, minZ, spacing }
}
