/**
 * Helical finishing (3D-08): one continuous descent round steep walls instead of separate
 * waterline levels, so the tool never steps down at one place (no step-down mark on the wall).
 *
 * The waterline level lines (`clgrid.ts`) are found every step-down. Where a closed line at one
 * level has exactly one closed line below it (a stack: round a hill or inside a hollow), the tool
 * goes round once per level and sinks one step-down as it goes: at every point the height is
 * interpolated along the round, and the point is found exactly on the wall at that height, between
 * the line it left and the line below (bisection with exact drops). Each straight piece is checked
 * at its middle and split until it stays within the tolerance, so the tool cannot dig in. A stack
 * ends with one full round at its lowest level. Lines that are not part of a stack (open lines,
 * splits and joins, slope limits) are cut as waterline passes.
 */
import { checkCancel, subWork, type Work } from '@/core/cancel'
import type { P } from '../geom'
import { type Mesh, meshBounds } from '../mesh/types'
import type { Move } from '../toolpath'
import type { Finish3dOp, Levels } from '../types'
import { CLGrid, type LevelPoint } from './clgrid'
import { type Cutter3D, grownCutter } from './cutter'
import { DropCutter } from './dropcutter'
import type { Finish3dResult } from './parallel'
import { FLAT_DEG } from './passes'
import { insideRegion, polysBox, type Region } from './region'

type V3 = [number, number, number]

export interface HelicalResult extends Finish3dResult {
  /** Continuous descents made (stacks of two or more levels). */
  helices: number
}

export function helicalFinish(op: Finish3dOp, mesh: Mesh, cutter: Cutter3D, region: Region, levels: Levels, work?: Work): HelicalResult {
  const warnings: string[] = []
  const none = (w: string): HelicalResult => ({ moves: [], warnings: [...warnings, w], minZ: NaN, spacing: 0, helices: 0 })
  const s = Math.max(0, op.surface.stockToLeave)
  const grown = grownCutter(cutter, s)
  if (!grown) return none('Stock to leave needs a ball-nose, bull-nose or flat tool (not a V cutter).')
  const dc = new DropCutter(mesh, grown)
  const tol = Math.max(0.001, op.surface.tolerance || 0.01)
  const gougeTol = Math.min(tol, 0.002)
  const sd = Math.max(0.05, op.stepdown ?? 1)
  const slopeMin = Math.max(op.slope.min, op.skipFlats ? FLAT_DEG : 0)
  const slopeMax = op.slope.max
  const machine = op.surface.groups?.length ? new Set(op.surface.groups) : null
  const protect = new Set(op.surface.protect ?? [])
  const groups = mesh.groups

  const box = polysBox(region.polys)
  if (!(box.maxX > box.minX && box.maxY > box.minY)) return none('The boundary is empty.')
  const h = Math.min(1, Math.max(0.25, cutter.R / 3))
  const grid = new CLGrid(dc, box, h, -Infinity, s, tol / 4, subWork(work, 0, 0.3))
  const { lo, hi } = grid.range()
  if (!Number.isFinite(lo)) return none('Nothing to cut: the model is not under the boundary.')
  const zs: number[] = []
  for (let k = 1; hi - k * sd > lo + 1e-6; k++) zs.push(hi - k * sd)
  if (!zs.length) return none('Nothing to cut: the model is less than one step-down high.')

  /** May the tool cut here at all (on the model, inside the boundary, groups allowed)? */
  const allowed = (p: LevelPoint) => {
    if (p.tri < 0) return false
    const g = groups ? groups[p.tri] : 0
    return !protect.has(g) && (!machine || machine.has(g)) && insideRegion(region, p, 1e-4)
  }
  const slopeOk = (p: LevelPoint) => {
    const slope = (Math.acos(Math.max(-1, Math.min(1, p.nz))) * 180) / Math.PI
    return slope >= slopeMin - 1e-9 && slope <= slopeMax + 1e-9
  }
  /**
   * Points of a closed line to cut. The slope is read from the facet touched, which at a corner
   * or edge of the model is not the real contact (a convex corner of a flat face reads as flat):
   * runs shorter than the tool radius that fail only on the slope do not break the line.
   */
  const cutMask = (pts: LevelPoint[]): boolean[] => {
    const ok = pts.map((p) => allowed(p) && slopeOk(p))
    const n = pts.length
    const start = ok.indexOf(true)
    if (start < 0) return ok
    let i = 0
    while (i < n) {
      const k = (start + i) % n
      if (ok[k]) {
        i++
        continue
      }
      // a run of misses from k
      let len = 0
      let j = i
      let slopeOnly = true
      while (j < n && !ok[(start + j) % n]) {
        const q = (start + j) % n
        if (!allowed(pts[q])) slopeOnly = false
        const r = (start + j + 1) % n
        len += Math.hypot(pts[r].x - pts[q].x, pts[r].y - pts[q].y)
        j++
      }
      if (slopeOnly && len < cutter.R) for (let m = i; m < j; m++) ok[(start + m) % n] = true
      i = j
    }
    return ok
  }

  // level lines: closed and cut all round (helix material), or pieces (waterline passes)
  type Loop = { z: number; pts: P[]; next?: Loop; prev?: Loop; used?: boolean }
  const loops: Loop[][] = []
  const pieces: { z: number; pts: P[]; closed: boolean }[] = []
  zs.forEach((z, li) => {
    checkCancel(work?.isCancelled)
    work?.progress?.(0.3 + (0.4 * li) / zs.length, `Level ${li + 1} of ${zs.length}`)
    const here: Loop[] = []
    for (const loop of grid.loops(z, tol, gougeTol)) {
      const ok = cutMask(loop.pts)
      const pts = loop.pts.map((p) => ({ x: p.x, y: p.y }))
      if (ok.every(Boolean)) {
        // climb: the model on the right (the lines run with the open side on the left)
        here.push({ z, pts: op.direction === 'conventional' ? [...pts].reverse() : pts })
        continue
      }
      const firstOff = ok.indexOf(false)
      if (firstOff < 0) continue
      let cur: P[] = []
      for (let k = 1; k <= pts.length; k++) {
        const i = (firstOff + k) % pts.length
        if (ok[i]) cur.push(pts[i])
        else {
          if (cur.length >= 2) pieces.push({ z, pts: op.direction === 'conventional' ? cur.reverse() : cur, closed: false })
          cur = []
        }
      }
      if (cur.length >= 2) pieces.push({ z, pts: op.direction === 'conventional' ? cur.reverse() : cur, closed: false })
    }
    loops.push(here)
  })

  // stacks: a loop whose only close neighbour one level down is one loop, which has no other
  const reach = sd / Math.tan((Math.max(15, slopeMin) * Math.PI) / 180) + 2 * h
  for (let li = 0; li + 1 < loops.length; li++) {
    const cand = new Map<Loop, Loop[]>()
    const back = new Map<Loop, Loop[]>()
    for (const a of loops[li])
      for (const b of loops[li + 1])
        if (near(a.pts, b.pts, reach)) {
          cand.set(a, [...(cand.get(a) ?? []), b])
          back.set(b, [...(back.get(b) ?? []), a])
        }
    for (const [a, bs] of cand) if (bs.length === 1 && back.get(bs[0])!.length === 1) {
      a.next = bs[0]
      bs[0].prev = a
    }
  }

  // the cutting chains, in 3D
  const chains: { pts: V3[]; closed: boolean }[] = []
  let helices = 0
  let at: P | null = null
  for (let li = 0; li < loops.length; li++)
    for (const top of loops[li]) {
      if (top.prev || top.used) continue
      checkCancel(work?.isCancelled)
      // start nearest the tool
      let ring = rotateNearest(top.pts, at)
      const out: V3[] = []
      let L: Loop = top
      for (;;) {
        L.used = true
        if (!L.next) {
          // the last round, level
          for (const p of ring) out.push([p.x, p.y, L.z])
          out.push([ring[0].x, ring[0].y, L.z])
          break
        }
        out.push(...descend(ring, L.z, L.next.z, L.next.pts))
        const end = out[out.length - 1]
        L = L.next
        ring = rotateNearest(L.pts, { x: end[0], y: end[1] })
      }
      if (L !== top) helices++
      chains.push({ pts: out, closed: L === top })
      at = { x: out[out.length - 1][0], y: out[out.length - 1][1] }
    }
  for (const pc of pieces) chains.push({ pts: pc.pts.map((p) => [p.x, p.y, pc.z] as V3), closed: false })
  if (!chains.length) return none(region.fromModel ? 'Nothing to cut: no surface within the slope limits and groups chosen.' : 'Nothing to cut: the boundary does not cover the model within the slope limits and groups chosen.')

  /**
   * One round of `ring` (at z0) sinking to z1: each point moved towards the line below until the
   * tool, at its interpolated height, just touches the wall; then pieces split until they keep
   * within the tolerance.
   */
  function descend(ring: P[], z0: number, z1: number, below: P[]): V3[] {
    const L: number[] = [0]
    for (let i = 1; i <= ring.length; i++) {
      const a = ring[i - 1]
      const b = ring[i % ring.length]
      L.push(L[i - 1] + Math.hypot(b.x - a.x, b.y - a.y))
    }
    const total = L[ring.length]
    const place = (p: P, z: number): V3 => {
      const q = nearestOnLoop(below, p)
      // p: CL at z0 (above z: the tool may not stand lower); q: CL at z1 (at most z): bisect
      let a = 0
      let b = 1
      if (grid.below(p.x, p.y, z)) return [p.x, p.y, z]
      for (let k = 0; k < 30 && (b - a) * Math.hypot(q.x - p.x, q.y - p.y) > 0.0005; k++) {
        const m = (a + b) / 2
        if (grid.below(p.x + (q.x - p.x) * m, p.y + (q.y - p.y) * m, z)) b = m
        else a = m
      }
      return [p.x + (q.x - p.x) * b, p.y + (q.y - p.y) * b, z]
    }
    const pts: V3[] = []
    for (let i = 0; i <= ring.length; i++) {
      const p = ring[i % ring.length]
      const z = z0 + ((z1 - z0) * L[i]) / total
      pts.push(i === ring.length ? place(nearestOnLoop(below, p), z1) : place(p, z))
    }
    // split pieces whose middle would dig in (or float more than the tolerance)
    const out: V3[] = [pts[0]]
    const split = (a: V3, b: V3, depth: number) => {
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const len = Math.hypot(dx, dy)
      // is the piece off the wall at its middle, or at a quarter (a kink in the wall at a corner
      // of the model can hide from the middle)?
      const at = (t: number) => {
        const x = a[0] + dx * t
        const y = a[1] + dy * t
        const z = a[2] + (b[2] - a[2]) * t
        return { x, y, z, cl: grid.z(x, y) }
      }
      let m = at(0.5)
      let bad = m.cl > m.z + gougeTol || m.cl < m.z - tol
      if (!bad)
        for (const q of [0.25, 0.75]) {
          const c = at(q)
          if (c.cl > c.z + gougeTol) {
            m = c
            bad = true
            break
          }
        }
      if (!bad) return
      if (depth >= 12 || len < 0.002) {
        // too short to split further: lift that point onto the wall
        if (m.cl > m.z + gougeTol) out.push([m.x, m.y, m.cl])
        return
      }
      // that point, moved square to the piece onto the wall at its height
      const l = len || 1
      const w = onWall(m.x, m.y, m.z, -dy / l, dx / l)
      split(a, w, depth + 1)
      out.push(w)
      split(w, b, depth + 1)
    }
    for (let i = 1; i < pts.length; i++) {
      split(pts[i - 1], pts[i], 0)
      out.push(pts[i])
    }
    return out
  }

  /** From (x, y), along (ux, uy) or back, the point where the tool at height z just touches the wall. */
  function onWall(x: number, y: number, z: number, ux: number, uy: number): V3 {
    const isIn = grid.below(x, y, z)
    for (const dist of [h / 8, h / 4, h / 2, h, 2 * h, 4 * h, 8 * h, 16 * h])
      for (const sg of [1, -1]) {
        const qx = x + ux * dist * sg
        const qy = y + uy * dist * sg
        if (grid.below(qx, qy, z) === isIn) continue
        // a: allowed end, b: the other
        let ax = isIn ? x : qx
        let ay = isIn ? y : qy
        let bx = isIn ? qx : x
        let by = isIn ? qy : y
        for (let k = 0; k < 30 && Math.hypot(bx - ax, by - ay) > 0.0005; k++) {
          const mx = (ax + bx) / 2
          const my = (ay + by) / 2
          if (grid.below(mx, my, z)) {
            ax = mx
            ay = my
          } else {
            bx = mx
            by = my
          }
        }
        return [ax, ay, z]
      }
    // no wall within reach: the tool rides the surface there
    return [x, y, Math.max(z, grid.z(x, y))]
  }

  // moves: chains joined by links that stay down where exact drops along them show the tool
  // clears; otherwise up to the safe height
  const top = meshBounds(mesh).max[2] + s
  const clear = Math.max(levels.safeZ, top + levels.rapidZ)
  const ds = Math.min(0.05, Math.max(0.01, cutter.R / 30))
  const linkMax = Math.max(2 * sd, cutter.R)
  const safe = (x: number, y: number, z: number) => {
    if (!dc.drop(x, y)) return true
    if (dc.z + s > z + gougeTol) return false
    return !(groups && protect.has(groups[dc.hitTri]))
  }
  const linkOk = (a: V3, b: V3) => {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (d > linkMax || !insideRegion(region, { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 }, 1e-4)) return false
    const n = Math.max(1, Math.ceil(Math.hypot(d, b[2] - a[2]) / ds))
    for (let i = 1; i < n; i++) {
      const t = i / n
      if (!safe(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)) return false
    }
    return true
  }
  const moves: Move[] = []
  let minZ = Infinity
  let last: V3 | null = null
  for (const c of chains) {
    const first = c.pts[0]
    if (last && linkOk(last, first)) moves.push({ t: 'poly', pts: new Float64Array(first), f: 'cut' })
    else {
      if (last) moves.push({ t: 'rapid', x: last[0], y: last[1], z: clear })
      moves.push({ t: 'rapid', x: first[0], y: first[1], z: clear })
      const above = Math.max(levels.rapidZ, first[2] + levels.rapidZ)
      if (above < clear) moves.push({ t: 'rapid', x: first[0], y: first[1], z: above })
      moves.push({ t: 'feed', x: first[0], y: first[1], z: first[2], f: 'plunge' })
    }
    const f = new Float64Array((c.pts.length - 1) * 3)
    for (let i = 1; i < c.pts.length; i++) {
      f.set(c.pts[i], (i - 1) * 3)
      minZ = Math.min(minZ, c.pts[i][2])
    }
    minZ = Math.min(minZ, first[2])
    moves.push({ t: 'poly', pts: f, f: 'cut' })
    last = c.pts[c.pts.length - 1]
  }
  if (last) moves.push({ t: 'rapid', x: last[0], y: last[1], z: clear })
  return { moves, warnings, minZ: Number.isFinite(minZ) ? minZ : NaN, spacing: sd, helices }
}

/** Every point of `a` (sampled) within `d` of polyline loop `b`, and the other way round. */
function near(a: P[], b: P[], d: number): boolean {
  const ok = (u: P[], v: P[]) => {
    const step = Math.max(1, Math.floor(u.length / 64))
    for (let i = 0; i < u.length; i += step) if (distToLoop(v, u[i]) > d) return false
    return true
  }
  return ok(a, b) && ok(b, a)
}

function distToLoop(loop: P[], p: P): number {
  const q = nearestOnLoop(loop, p)
  return Math.hypot(q.x - p.x, q.y - p.y)
}

function nearestOnLoop(loop: P[], p: P): P {
  let best = loop[0]
  let bd = Infinity
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]
    const b = loop[(i + 1) % loop.length]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const L2 = dx * dx + dy * dy
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0
    const q = { x: a.x + dx * t, y: a.y + dy * t }
    const d = Math.hypot(q.x - p.x, q.y - p.y)
    if (d < bd) {
      bd = d
      best = q
    }
  }
  return best
}

/** The loop started at its point nearest p (as it is when p is null). */
function rotateNearest(loop: P[], p: P | null): P[] {
  if (!p) return loop
  let k = 0
  let bd = Infinity
  loop.forEach((q, i) => {
    const d = Math.hypot(q.x - p.x, q.y - p.y)
    if (d < bd) {
      bd = d
      k = i
    }
  })
  return [...loop.slice(k), ...loop.slice(0, k)]
}
