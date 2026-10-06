/**
 * Shared machinery for the 3D finishing strategies that follow paths drawn in plan (parallel,
 * radial, spiral, scallop, curve-driven): the drop sampler with the slope, group and protect
 * rules, passes along a polyline refined to the tolerance, and the moves that join the passes
 * (staying down on short safe links, lifting otherwise).
 *
 * Every point is an exact drop-cutter position and every straight move is refined against the
 * true tool-centre surface, so no strategy built on this can dig into the model beyond the
 * tolerance (checked independently by `check.ts`).
 */
import type { P } from '../geom'
import type { Mesh } from '../mesh/types'
import { meshBounds } from '../mesh/types'
import type { Move } from '../toolpath'
import type { Finish3dOp, Levels } from '../types'
import { cutChains, type Pt, refineAlong, simplify } from './chain'
import { type Cutter3D, grownCutter } from './cutter'
import { DropCutter } from './dropcutter'
import { insideRegion, type Region } from './region'

/** Steepest a point may be and still count as flat (skip flats). */
export const FLAT_DEG = 0.5

export interface Sampler {
  /** Exact drop at (x, y): tool-tip Z (+ stock to leave), and whether this point is cut. */
  sample: (x: number, y: number) => Pt
  dc: DropCutter
  /** Stock to leave. */
  s: number
  tol: number
  gougeTol: number
  /** Largest distance between first samples along a pass. */
  step0: number
}

/** The drop sampler of a finishing operation, or the reason it cannot run. */
export function surfaceSampler(op: Finish3dOp, mesh: Mesh, cutter: Cutter3D): Sampler | { error: string } {
  const s = Math.max(0, op.surface.stockToLeave)
  const grown = grownCutter(cutter, s)
  if (!grown) return { error: 'Stock to leave needs a ball-nose, bull-nose or flat tool (not a V cutter).' }
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
  return { sample, dc, s, tol, gougeTol, step0 }
}

/** A polyline in plan, walked by distance along it. */
export function alongPolyline(pts: P[]): { length: number; at: (t: number) => P } {
  const L: number[] = [0]
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  const length = L[L.length - 1]
  const at = (t: number): P => {
    if (pts.length === 1) return pts[0]
    t = Math.max(0, Math.min(length, t))
    // first piece ending at or after t
    let lo = 1
    let hi = pts.length - 1
    while (lo < hi) {
      const m = (lo + hi) >> 1
      if (L[m] < t) lo = m + 1
      else hi = m
    }
    const seg = L[lo] - L[lo - 1]
    const f = seg > 0 ? (t - L[lo - 1]) / seg : 0
    return { x: pts[lo - 1].x + (pts[lo].x - pts[lo - 1].x) * f, y: pts[lo - 1].y + (pts[lo].y - pts[lo - 1].y) * f }
  }
  return { length, at }
}

/**
 * Cutting chains along a plan polyline: dropped, refined to the tolerance (each piece between the
 * polyline's own points on its own, so its corners are kept) and split where cutting stops.
 */
export function chainsAlong(smp: Sampler, pts: P[]): Pt[][] {
  const out: Pt[] = []
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (!(len > 0)) continue
    const run = refineAlong((t) => smp.sample(a.x + ((b.x - a.x) * t) / len, a.y + ((b.y - a.y) * t) / len), 0, len, smp.step0, smp.tol, smp.gougeTol)
    for (let k = out.length ? 1 : 0; k < run.length; k++) out.push(run[k])
  }
  return cutChains(out)
}

/**
 * The polyline cut to the parts inside the region (crossings found to 1e-4 mm). Each piece keeps
 * the polyline's points that lie inside, plus the crossing points.
 */
export function clipPolyline(region: Region, pts: P[]): P[][] {
  const out: P[][] = []
  let cur: P[] = []
  const inside = (p: P) => insideRegion(region, p)
  const cross = (a: P, b: P, ina: boolean): P => {
    let lo = 0
    let hi = 1
    for (let i = 0; i < 40 && Math.hypot(b.x - a.x, b.y - a.y) * (hi - lo) > 1e-4; i++) {
      const m = (lo + hi) / 2
      if (inside({ x: a.x + (b.x - a.x) * m, y: a.y + (b.y - a.y) * m }) === ina) lo = m
      else hi = m
    }
    const f = ina ? lo : hi
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
  }
  let prevIn = false
  pts.forEach((p, i) => {
    const pin = inside(p)
    if (i > 0 && pin !== prevIn) {
      const c = cross(pts[i - 1], p, prevIn)
      if (prevIn) {
        cur.push(c)
        if (cur.length >= 2) out.push(cur)
        cur = []
      } else cur = [c]
    }
    if (pin) cur.push(p)
    prevIn = pin
  })
  if (cur.length >= 2) out.push(cur)
  return out
}

export interface LinkOptions {
  /** Links between chains stay down only up to this long (plan, mm). */
  linkMax: number
  levels: Levels
  /** Links stay down only where every point of them would be cut (e.g. only over flat faces). */
  onCutOnly?: boolean
}

/**
 * The moves for chains in cutting order: a chain starts by staying down from the last one when the
 * link is short, inside the region and the tool can ride the surface along it without touching a
 * protected group; otherwise the tool lifts to the clearance height, rapids over and feeds down
 * from just above the stock.
 */
export function chainMoves(ordered: Pt[][], smp: Sampler, region: Region, mesh: Mesh, opt: LinkOptions): { moves: Move[]; minZ: number } {
  const { sample, step0, gougeTol, tol, s } = smp
  const { levels } = opt
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
    if (d > opt.linkMax + 1e-9 || !insideRegion(region, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, 1e-4)) return null
    const n = Math.max(1, Math.ceil(d / step0))
    const out: Pt[] = []
    for (let i = 1; i < n; i++) {
      const p = sample(from.x + ((to.x - from.x) * i) / n, from.y + ((to.y - from.y) * i) / n)
      if (!p.ok || p.prot || (opt.onCutOnly && !p.cut)) return null
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
    if (!m.ok || m.prot || (opt.onCutOnly && !m.cut)) return null
    const lin = (pa.z + pb.z) / 2
    let fine = m.z - lin <= gougeTol && Math.abs(m.z - lin) <= tol
    if (fine && (Math.abs(m.z - lin) > gougeTol / 8 || Math.abs(pb.z - pa.z) > 0.5 * Math.hypot(pb.x - pa.x, pb.y - pa.y)))
      for (const f of [0.25, 0.75]) {
        const q = sample(pa.x + (pb.x - pa.x) * f, pa.y + (pb.y - pa.y) * f)
        if (!q.ok || q.prot || (opt.onCutOnly && !q.cut)) return null
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
  return { moves, minZ }
}

/** Closed chains (start meets end in plan) can be reversed or rotated freely. */
export const reverseChain = (c: Pt[]): Pt[] => [...c].reverse()

/**
 * Order chains nearest-next from where the tool is, reversing a chain when its far end is nearer
 * (unless `keepDirection`, for passes whose direction matters).
 */
export function nearestOrder(chains: Pt[][], from: P | null = null, keepDirection = false): Pt[][] {
  const left = [...chains]
  const out: Pt[][] = []
  let at = from
  while (left.length) {
    let best = 0
    let bestD = Infinity
    let rev = false
    left.forEach((c, i) => {
      const a = c[0]
      const b = c[c.length - 1]
      const da = at ? Math.hypot(a.x - at.x, a.y - at.y) : 0
      const db = at ? Math.hypot(b.x - at.x, b.y - at.y) : Infinity
      if (da < bestD) {
        bestD = da
        best = i
        rev = false
      }
      if (!keepDirection && db < bestD) {
        bestD = db
        best = i
        rev = true
      }
    })
    const [c] = left.splice(best, 1)
    const o = rev ? reverseChain(c) : c
    out.push(o)
    at = o[o.length - 1]
  }
  return out
}
