/**
 * Undercut finishing (3D-08) with a lollipop tool: a ball on a narrower neck reaches under an
 * overhang (a lip, a dovetail, the inside of a moulding) where a tool coming straight down cannot.
 * Straight passes at an angle, the step-over apart, like parallel finishing; at each point the tool
 * goes where it touches the underside of the overhang from below, or the floor beneath it.
 *
 * Positions are exact. Along the vertical line through a point, the ball (radius R + stock) would
 * touch a facet for one interval of centre heights (the facet grown by R is convex); the interval
 * is found in closed form from the facet's corners (spheres), edges (cylinders) and face (a slab),
 * on a grid of the facets near the line. The free heights between those intervals are the gaps;
 * the neck (a cylinder of the neck radius + the collision margin + stock, from the ball's centre
 * up) must clear the model too, which an exact flat-cutter drop gives. The top of the highest gap
 * below the open space touches the underside of the overhang; its bottom rests on the floor.
 *
 * Pieces between positions are checked at their middle and quarters and split until they stay
 * within the tolerance. The tool enters and leaves each pass sideways at its own height, from and to
 * the nearest point along the pass where the way straight up is clear, so it never lifts into the
 * overhang.
 */
import { checkCancel, type Work } from '@/core/cancel'
import type { P } from '../geom'
import { type Mesh, meshBounds } from '../mesh/types'
import type { Move } from '../toolpath'
import type { Finish3dOp, Levels } from '../types'
import { DropCutter } from './dropcutter'
import type { Finish3dResult } from './parallel'
import { clipLine, extent, insideRegion, type Region } from './region'

export interface UndercutTool {
  /** Ball radius, mm. */
  R: number
  /** Neck radius, mm (the collision margin is added by the caller). */
  neck: number
}

export type UndercutSurface = 'underside' | 'floor'

/** Facets of a mesh near vertical lines, and the heights at which a ball touches them. */
export class BallLine {
  private readonly p: Float64Array
  private readonly tri: Int32Array
  private readonly cell: number
  private readonly x0: number
  private readonly y0: number
  private readonly nx: number
  private readonly ny: number
  private readonly start: Int32Array
  private readonly items: Int32Array
  readonly R: number
  /** Facet of the last interval's top and bottom ends (`intervals`). */
  constructor(mesh: Mesh, R: number) {
    this.R = R
    this.p = Float64Array.from(mesh.positions)
    this.tri = Int32Array.from(mesh.indices)
    const b = meshBounds(mesh)
    this.cell = Math.max(R, 1)
    this.x0 = b.min[0] - R
    this.y0 = b.min[1] - R
    this.nx = Math.max(1, Math.ceil((b.max[0] - b.min[0] + 2 * R) / this.cell) + 1)
    this.ny = Math.max(1, Math.ceil((b.max[1] - b.min[1] + 2 * R) / this.cell) + 1)
    const nt = this.tri.length / 3
    const counts = new Int32Array(this.nx * this.ny + 1)
    const range = (t: number) => {
      let mx = Infinity
      let my = Infinity
      let Mx = -Infinity
      let My = -Infinity
      for (let k = 0; k < 3; k++) {
        const v = this.tri[t * 3 + k] * 3
        mx = Math.min(mx, this.p[v])
        Mx = Math.max(Mx, this.p[v])
        my = Math.min(my, this.p[v + 1])
        My = Math.max(My, this.p[v + 1])
      }
      return [Math.max(0, Math.floor((mx - R - this.x0) / this.cell)), Math.min(this.nx - 1, Math.floor((Mx + R - this.x0) / this.cell)), Math.max(0, Math.floor((my - R - this.y0) / this.cell)), Math.min(this.ny - 1, Math.floor((My + R - this.y0) / this.cell))]
    }
    for (let t = 0; t < nt; t++) {
      const [i0, i1, j0, j1] = range(t)
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) counts[j * this.nx + i + 1]++
    }
    for (let k = 1; k < counts.length; k++) counts[k] += counts[k - 1]
    this.start = counts.slice()
    this.items = new Int32Array(counts[counts.length - 1])
    const fill = counts.slice()
    for (let t = 0; t < nt; t++) {
      const [i0, i1, j0, j1] = range(t)
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.items[fill[j * this.nx + i]++] = t
    }
  }

  /**
   * Centre heights at which the ball, standing on the vertical line through (x, y), touches each
   * facet near it, merged and sorted (low to high). Each merged interval also gives the facet at
   * its bottom and top end.
   */
  intervals(x: number, y: number): { lo: number; hi: number; loTri: number; hiTri: number }[] {
    const i = Math.floor((x - this.x0) / this.cell)
    const j = Math.floor((y - this.y0) / this.cell)
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return []
    const c = j * this.nx + i
    const out: { lo: number; hi: number; loTri: number; hiTri: number }[] = []
    for (let k = this.start[c]; k < this.start[c + 1]; k++) {
      const t = this.items[k]
      const iv = this.triInterval(x, y, t)
      if (iv) out.push({ lo: iv[0], hi: iv[1], loTri: t, hiTri: t })
    }
    out.sort((a, b) => a.lo - b.lo)
    const merged: typeof out = []
    for (const iv of out) {
      const last = merged[merged.length - 1]
      if (last && iv.lo <= last.hi) {
        if (iv.hi > last.hi) {
          last.hi = iv.hi
          last.hiTri = iv.hiTri
        }
      } else merged.push({ ...iv })
    }
    return merged
  }

  /** Heights (ball centre) on the line through (x, y) where the ball touches facet t, or null. */
  triInterval(x: number, y: number, t: number): [number, number] | null {
    const R = this.R
    const R2 = R * R
    const p = this.p
    const a = this.tri[t * 3] * 3
    const b = this.tri[t * 3 + 1] * 3
    const cc = this.tri[t * 3 + 2] * 3
    const V = [
      [p[a], p[a + 1], p[a + 2]],
      [p[b], p[b + 1], p[b + 2]],
      [p[cc], p[cc + 1], p[cc + 2]],
    ]
    let lo = Infinity
    let hi = -Infinity
    const take = (l: number, h: number) => {
      if (h < l) return
      if (l < lo) lo = l
      if (h > hi) hi = h
    }
    // corners: spheres
    for (const v of V) {
      const d2 = (x - v[0]) ** 2 + (y - v[1]) ** 2
      if (d2 < R2) {
        const hh = Math.sqrt(R2 - d2)
        take(v[2] - hh, v[2] + hh)
      }
    }
    // edges: cylinders (the part between the two corners)
    for (let e = 0; e < 3; e++) {
      const A = V[e]
      const B = V[(e + 1) % 3]
      const ux0 = B[0] - A[0]
      const uy0 = B[1] - A[1]
      const uz0 = B[2] - A[2]
      const L = Math.hypot(ux0, uy0, uz0)
      if (!(L > 0)) continue
      const ux = ux0 / L
      const uy = uy0 / L
      const uz = uz0 / L
      const wx = x - A[0]
      const wy = y - A[1]
      // s = z - Az: t(s) = a0 + uz s; distance² to the line = (1 - uz²) s² - 2 a0 uz s + (wx² + wy² - a0²)
      const a0 = wx * ux + wy * uy
      const qa = 1 - uz * uz
      const qb = -2 * a0 * uz
      const qc = wx * wx + wy * wy - a0 * a0 - R2
      let s0: number
      let s1: number
      if (qa < 1e-12) {
        // upright edge
        if (qc >= 0) continue
        s0 = -Infinity
        s1 = Infinity
      } else {
        const disc = qb * qb - 4 * qa * qc
        if (disc <= 0) continue
        const sq = Math.sqrt(disc)
        s0 = (-qb - sq) / (2 * qa)
        s1 = (-qb + sq) / (2 * qa)
      }
      // within the edge: 0 <= a0 + uz s <= L
      if (Math.abs(uz) < 1e-12) {
        if (a0 < 0 || a0 > L) continue
      } else {
        const e0 = (0 - a0) / uz
        const e1 = (L - a0) / uz
        s0 = Math.max(s0, Math.min(e0, e1))
        s1 = Math.min(s1, Math.max(e0, e1))
      }
      if (s1 > s0) take(A[2] + s0, A[2] + s1)
    }
    // face: within R of the plane, the foot inside the facet
    const e1 = [V[1][0] - V[0][0], V[1][1] - V[0][1], V[1][2] - V[0][2]]
    const e2 = [V[2][0] - V[0][0], V[2][1] - V[0][1], V[2][2] - V[0][2]]
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
    const nl = Math.hypot(n[0], n[1], n[2])
    if (nl > 1e-15) {
      n = [n[0] / nl, n[1] / nl, n[2] / nl]
      // s = z - V0z; signed distance = n·(c - V0) = k0 + nz s
      const k0 = n[0] * (x - V[0][0]) + n[1] * (y - V[0][1])
      let s0 = -Infinity
      let s1 = Infinity
      if (Math.abs(n[2]) > 1e-12) {
        const ea = (-R - k0) / n[2]
        const eb = (R - k0) / n[2]
        s0 = Math.min(ea, eb)
        s1 = Math.max(ea, eb)
      } else if (Math.abs(k0) >= R) s1 = -Infinity
      // inside: for each edge P -> Q, ((Q - P) x (c - P)) · n >= 0, linear in s
      for (let e = 0; e < 3 && s1 > s0; e++) {
        const P0 = V[e]
        const Q = V[(e + 1) % 3]
        const d = [Q[0] - P0[0], Q[1] - P0[1], Q[2] - P0[2]]
        const w0 = [x - P0[0], y - P0[1], V[0][2] - P0[2]]
        // (d x w) · n with w = w0 + (0, 0, s)
        const cx = (u: number[], v: number[]) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
        const c0 = cx(d, w0)
        const c1 = cx(d, [0, 0, 1])
        const f0 = c0[0] * n[0] + c0[1] * n[1] + c0[2] * n[2]
        const f1 = c1[0] * n[0] + c1[1] * n[1] + c1[2] * n[2]
        if (Math.abs(f1) < 1e-15) {
          if (f0 < 0) s1 = -Infinity
        } else if (f1 > 0) s0 = Math.max(s0, -f0 / f1)
        else s1 = Math.min(s1, -f0 / f1)
      }
      if (s1 > s0) take(V[0][2] + s0, V[0][2] + s1)
    }
    return lo < hi ? [lo, hi] : null
  }
}

/** Where the lollipop goes at (x, y): its centre heights touching the underside and resting on the floor. */
export interface UndercutSpot {
  /** Ball centre touching the underside of the overhang from below (null: none, or the neck would hit). */
  under: number | null
  /** Ball centre resting on the floor beneath the overhang. */
  floor: number | null
  /** Facets touched at those spots. */
  underTri: number
  floorTri: number
  /** Lowest centre height from which the way straight up is clear (ball and neck). */
  open: number
}

export class UndercutModel {
  readonly line: BallLine
  readonly neck: DropCutter
  readonly R: number
  constructor(mesh: Mesh, tool: UndercutTool) {
    this.R = tool.R
    this.line = new BallLine(mesh, tool.R)
    this.neck = new DropCutter(mesh, { kind: 'torus', R: tool.neck, rc: 0 })
  }

  /** The neck, from a centre at height zc up, keeps clear of the model at (x, y). */
  neckClear(x: number, y: number, zc: number): boolean {
    return !this.neck.drop(x, y) || this.neck.z <= zc + 1e-9
  }

  spot(x: number, y: number): UndercutSpot {
    const iv = this.line.intervals(x, y)
    const neckZ = this.neck.drop(x, y) ? this.neck.z : -Infinity
    const top = iv.length ? iv[iv.length - 1].hi : -Infinity
    const out: UndercutSpot = { under: null, floor: null, underTri: -1, floorTri: -1, open: Math.max(top, neckZ) }
    // gaps between the intervals, highest first: the first one the neck can reach
    for (let k = iv.length - 2; k >= 0; k--) {
      const bottom = iv[k].hi
      const topOfGap = iv[k + 1].lo
      if (topOfGap - bottom < 1e-3) continue
      if (topOfGap < neckZ - 1e-9) continue
      out.under = topOfGap
      out.underTri = iv[k + 1].loTri
      if (bottom >= neckZ - 1e-9) {
        out.floor = bottom
        out.floorTri = iv[k].hiTri
      }
      break
    }
    return out
  }

  /** Is a ball centre at (x, y, zc) clear of the model (ball and neck)? */
  clear(x: number, y: number, zc: number, tol = 0): boolean {
    for (const iv of this.line.intervals(x, y)) if (zc > iv.lo + tol && zc < iv.hi - tol) return false
    return this.neckClear(x, y, zc + tol)
  }
}

type V3 = [number, number, number]

/**
 * Undercut finishing with a lollipop of ball radius `tool.R` and neck radius `tool.neck` (the
 * caller adds the collision margin to the neck). `surfaces`: the undersides, the floors, or both.
 */
export function undercutFinish(op: Finish3dOp, mesh: Mesh, tool: UndercutTool, region: Region, levels: Levels, work?: Work): Finish3dResult {
  const none = (w: string): Finish3dResult => ({ moves: [], warnings: [w], minZ: NaN, spacing: 0 })
  const s = Math.max(0, op.surface.stockToLeave)
  const R = tool.R + s
  const model = new UndercutModel(mesh, { R, neck: tool.neck + s })
  const tol = Math.max(0.001, op.surface.tolerance || 0.01)
  const gougeTol = Math.min(tol, 0.002)
  const step0 = Math.min(0.5, Math.max(0.05, tool.R / 6))
  const machineG = op.surface.groups?.length ? new Set(op.surface.groups) : null
  const protect = new Set(op.surface.protect ?? [])
  const groups = mesh.groups
  const allowed = (t: number) => {
    if (t < 0) return false
    const g = groups ? groups[t] : 0
    return !protect.has(g) && (!machineG || machineG.has(g))
  }
  const surfaces: UndercutSurface[] = op.undercut === 'underside' ? ['underside'] : op.undercut === 'floor' ? ['floor'] : ['underside', 'floor']

  const a = (op.angle * Math.PI) / 180
  const ux = Math.cos(a)
  const uy = Math.sin(a)
  const { lo, hi } = extent(region, ux, uy)
  if (!Number.isFinite(lo) || hi - lo < 0) return none('The boundary is empty.')
  const step = Math.max(0.01, op.stepover)
  const nPass = Math.max(1, Math.ceil((hi - lo - 2e-6) / step))
  const spacing = (hi - lo - 2e-6) / nPass

  /** Centre height of the chosen surface at (x, y), with the facet touched. */
  const heightAt = (x: number, y: number, surf: UndercutSurface): { z: number; ok: boolean } | null => {
    const sp = model.spot(x, y)
    const z = surf === 'underside' ? sp.under : sp.floor
    if (z === null) return null
    return { z, ok: allowed(surf === 'underside' ? sp.underTri : sp.floorTri) }
  }

  type Q = { x: number; y: number; z: number; ok: boolean }
  /** Points along one line interval for one surface, refined, split where the surface stops. */
  const along = (s0: number, t0: number, t1: number, surf: UndercutSurface): Q[][] => {
    const at = (t: number): Q | null => {
      const x = ux * t - uy * s0
      const y = uy * t + ux * s0
      const h = heightAt(x, y, surf)
      return h ? { x, y, z: h.z, ok: h.ok } : null
    }
    const runs: Q[][] = []
    let cur: Q[] = []
    const flush = () => {
      if (cur.length >= 2) runs.push(cur)
      cur = []
    }
    const n = Math.max(1, Math.ceil((t1 - t0) / step0))
    let prevT = t0
    let prev = at(t0)
    if (prev?.ok) cur.push(prev)
    for (let i = 1; i <= n; i++) {
      const t = i === n ? t1 : t0 + ((t1 - t0) * i) / n
      const q = at(t)
      if (q?.ok && prev?.ok) {
        const mid = refine(prev, prevT, q, t, 0)
        // (null: the surface jumps between them: end the run at prev, start again at q)
        if (mid === null) flush()
        else cur.push(...mid)
        cur.push(q)
      } else {
        flush()
        if (q?.ok) cur.push(q)
      }
      prev = q
      prevT = t
    }
    flush()
    return runs
    /** Points between pa and pb so the straight pieces keep to the surface; null: it jumps (another layer). */
    function refine(pa: Q, ta: number, pb: Q, tb: number, depth: number): Q[] | null {
      const ok = (f: number) => {
        const q = at(ta + (tb - ta) * f)
        if (!q || !q.ok) return { q, good: false }
        const lin = pa.z + (pb.z - pa.z) * f
        // underside: too high digs into the overhang; floor: too low digs into the floor
        const into = surf === 'underside' ? lin - q.z : q.z - lin
        return { q, good: into <= gougeTol && Math.abs(lin - q.z) <= tol && model.neckClear(q.x, q.y, lin - gougeTol) }
      }
      const m = ok(0.5)
      let bad = !m.good
      let at2 = m
      let f = 0.5
      if (!bad)
        for (const g of [0.25, 0.75]) {
          const r = ok(g)
          if (!r.good) {
            bad = true
            at2 = r
            f = g
            break
          }
        }
      if (!bad) return []
      if (!at2.q || !at2.q.ok || depth >= 10) {
        // the surface ends or jumps between them: split here (unless the piece is tiny)
        return Math.abs(tb - ta) < 0.002 ? [] : null
      }
      const tm = ta + (tb - ta) * f
      const l = refine(pa, ta, at2.q, tm, depth + 1)
      const r = refine(at2.q, tm, pb, tb, depth + 1)
      return l && r ? [...l, at2.q, ...r] : null
    }
  }

  // passes
  type Chain = { pts: V3[]; s0: number; dirT: number }
  const chains: Chain[] = []
  for (let k = 0; k <= nPass; k++) {
    if ((k & 7) === 0) {
      checkCancel(work?.isCancelled)
      work?.progress?.(k / (nPass + 1), `Pass ${k + 1} of ${nPass + 1}`)
    }
    const sOff = lo + 1e-6 + k * spacing
    const forward = op.pattern === 'zigzag' ? k % 2 === 0 : op.direction !== 'conventional'
    for (const surf of surfaces)
      for (const [t0, t1] of clipLine(region, ux, uy, sOff))
        for (const run of along(sOff, t0, t1, surf)) {
          const pts = run.map((q) => [q.x, q.y, q.z] as V3)
          chains.push({ pts: forward ? pts : pts.reverse(), s0: sOff, dirT: forward ? 1 : -1 })
        }
  }
  if (!chains.length) return none(region.fromModel ? 'Nothing to cut: no overhang this lollipop can reach under (its neck, with the collision margin, must keep clear of the model).' : 'Nothing to cut: no overhang inside the boundary that this lollipop can reach under.')

  // In and out sideways, at the pass's own height, from and to the nearest point along the pass
  // where the way straight up is clear. A pass with a way out at only one end (it runs in under the
  // overhang and stops) is paired with the next such pass: in along one, across under the overhang
  // (checked clear all the way), out along the other; or, alone, in and back out along itself.
  const warnings: string[] = []
  const reach = 3 * tool.R + 10
  /**
   * From p along the pass (direction sign), at height zc: the first point with a clear way up,
   * every point on the way clear and inside the boundary (never out past the part, where on a
   * sheet the neighbouring parts are).
   */
  const exitFrom = (p: V3, s0: number, sign: number): V3 | null => {
    const t = ux * p[0] + uy * p[1]
    const n = Math.ceil(reach / step0)
    for (let i = 1; i <= n; i++) {
      const tt = t + sign * i * step0
      const x = ux * tt - uy * s0
      const y = uy * tt + ux * s0
      if (!insideRegion(region, { x, y }, 1e-4)) return null
      if (!model.clear(x, y, p[2], gougeTol)) return null
      if (model.spot(x, y).open <= p[2] + 1e-9) return [x, y, p[2]]
    }
    return null
  }
  /** The straight move a -> b keeps the ball and the neck clear (checked every 0.05 mm). */
  const clearMove = (a: V3, b: V3): boolean => {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.05))
    for (let i = 1; i < n; i++) {
      const f = i / n
      if (!model.clear(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, gougeTol)) return false
    }
    return true
  }
  type Plan = { pts: V3[]; entry: V3; exit: V3 }
  const plans: Plan[] = []
  let skipped = 0
  let dead: { c: Chain; open: V3; reversed: boolean } | null = null
  const flushDead = () => {
    if (!dead) return
    // alone: in along the pass and back out along it
    const pts = [...dead.c.pts]
    plans.push({ pts: [...pts, ...pts.slice(0, -1).reverse()], entry: dead.open, exit: dead.open })
    dead = null
  }
  for (const c of chains) {
    const first = c.pts[0]
    const last = c.pts[c.pts.length - 1]
    const entry = exitFrom(first, c.s0, -c.dirT)
    const exit = exitFrom(last, c.s0, c.dirT)
    if (entry && exit) {
      flushDead()
      plans.push({ pts: c.pts, entry, exit })
      continue
    }
    if (!entry && !exit) {
      skipped++
      continue
    }
    // one way out: run it from the open end in
    const pts = entry ? c.pts : [...c.pts].reverse()
    const open = (entry ?? exit)!
    if (dead && clearMove(dead.c.pts[dead.reversed ? 0 : dead.c.pts.length - 1], pts[pts.length - 1])) {
      // in along the earlier one, across, out along this one
      const inPts = dead.reversed ? [...dead.c.pts].reverse() : dead.c.pts
      plans.push({ pts: [...inPts, ...[...pts].reverse()], entry: dead.open, exit: open })
      dead = null
      continue
    }
    flushDead()
    dead = { c: { ...c, pts }, open, reversed: false }
  }
  flushDead()
  if (skipped) warnings.push(`${skipped} undercut pass(es) left out: no way in or out sideways (inside the boundary, within ${reach.toFixed(0)} mm) where the tool could rise clear.`)

  const top = meshBounds(mesh).max[2] + s
  const clearZ = Math.max(levels.safeZ, top + levels.rapidZ)
  const above = Math.max(levels.rapidZ, top + levels.rapidZ)
  const tip = (p: V3): V3 => [p[0], p[1], p[2] - R + s]
  const moves: Move[] = []
  let minZ = Infinity
  for (const pl of plans) {
    const e = tip(pl.entry)
    moves.push({ t: 'rapid', x: e[0], y: e[1], z: clearZ })
    if (above < clearZ) moves.push({ t: 'rapid', x: e[0], y: e[1], z: above })
    // straight down where the way is clear, then sideways in
    moves.push({ t: 'feed', x: e[0], y: e[1], z: e[2], f: 'plunge' })
    const path = [...pl.pts, pl.exit].map(tip)
    const f = new Float64Array(path.length * 3)
    path.forEach((q, i) => {
      f.set(q, i * 3)
      minZ = Math.min(minZ, q[2])
    })
    moves.push({ t: 'poly', pts: f, f: 'cut' })
    const out = path[path.length - 1]
    moves.push({ t: 'feed', x: out[0], y: out[1], z: above, f: 'cut' })
    moves.push({ t: 'rapid', x: out[0], y: out[1], z: clearZ })
  }
  if (!moves.length) return { moves, warnings: [...warnings, 'Nothing to cut.'], minZ: NaN, spacing }
  return { moves, warnings, minZ: Number.isFinite(minZ) ? minZ : NaN, spacing }
}

/** For tests: the plan point of a pass (s0 across, t along) at angle a. */
export const passPoint = (a: number, s0: number, t: number): P => ({ x: Math.cos(a) * t - Math.sin(a) * s0, y: Math.sin(a) * t + Math.cos(a) * s0 })
