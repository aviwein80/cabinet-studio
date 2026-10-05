/**
 * Adaptive clearing (NEW-01) of one level of a pocket: the tool keeps a steady width of cut.
 *
 * The material still to cut is a bit raster (`raster.ts`). The tool moves in short straight steps;
 * before each step the heading is searched so that the material the step removes, divided by its
 * length (the equivalent width of cut), comes close to the target without passing it. The tool
 * turns into the material when the cut gets light and away from it when it gets heavy, so it
 * spirals out from each entry and follows the material face. Every step keeps the tool at least
 * its radius from the pocket wall (exact distance to the wall edges, `walls.ts`).
 *
 * When a pass can go no further, the tool goes back (through cleared area when it can, lifted a
 * little) to the nearest place beside uncut material and carries on. Regions not yet opened get a
 * helix entry. Material in channels too narrow for that (where the tool would cut its full width)
 * is cleared with trochoidal loops: circles whose centre creeps forward, the creep chosen loop by
 * loop to hold the width of cut. Those moves are flagged.
 *
 * Our own design, using general published ideas on constant-engagement clearing.
 */
import { checkCancel, type Work } from '@/core/cancel'
import type { P } from '../geom'
import { PolySet } from './rest'
import { MaterialRaster } from './raster'
import { Walls } from './walls'

export interface AdaptiveOptions {
  /** Tool radius, mm. */
  r: number
  /** Width of cut to hold (radial engagement), mm. */
  target: number
  /** Smallest turning radius of the path between steps, mm (0 = turn freely). */
  smoothing: number
  /** Material on the right of the tool (climb, clockwise spindle). */
  climb: boolean
  /** Entry helix radius as a fraction of the tool radius. */
  helixPct: number
  /** Raster cell, mm (default: tool radius / 40, between 0.02 and 0.1). */
  cell?: number
  /**
   * How far the tool centre keeps from the walls, mm (default: the tool radius, for walls that are
   * the edge of the material; 0 when the walls already bound where the centre may go).
   */
  wallGap?: number
}

export type AdaptiveItem =
  /** Helix down around `c` with radius `rho`, ending at `start` (at the level). */
  | { k: 'helix'; c: P; rho: number; start: P }
  /** Cutting moves through `pts` (from the current position). `load`: estimated width of cut of each move. `trochoidal`: loops in a narrow channel. */
  | { k: 'pass'; pts: P[]; load: number[]; trochoidal?: boolean }
  /** Go to `to`: straight through cleared area (lifted a little) when `clear`, otherwise up and over. */
  | { k: 'link'; to: P; clear: boolean }

export interface AdaptivePlan {
  items: AdaptiveItem[]
  /** Reachable material in the level, and what is left uncut, mm². */
  total: number
  left: number
  warnings: string[]
}

const DEG = Math.PI / 180

/**
 * Plan one level. `material`: what the tool can reach (filled polygons); `centres`: where its
 * centre may go; `walls`: the boundary it must keep its radius (or `wallGap`) from.
 */
export function planAdaptive(material: P[][], centres: P[][], walls: P[][], o: AdaptiveOptions, work?: Work): AdaptivePlan {
  const r = o.r
  const wg = Math.max(0, o.wallGap ?? r)
  const warnings: string[] = []
  const h = o.cell ?? Math.min(0.1, Math.max(0.02, r / 40))
  const ras = new MaterialRaster(material, h)
  const cellA = h * h
  const total = ras.total() * cellA
  const items: AdaptiveItem[] = []
  if (!(total > 0)) return { items, total: 0, left: 0, warnings }
  const W = new Walls(walls, Math.max(1, r))
  const inC = new PolySet(centres)
  const target = Math.max(0.01, o.target)
  const aim = 0.9 * target
  const eMin = 0.05 * target
  const near = Math.max(1.5 * target, 2 * h)
  const step = Math.min(3, Math.max(0.2, 0.4 * r))
  const tauMax = o.smoothing > 0 && step < 2 * o.smoothing ? Math.min(170 * DEG, 2 * Math.asin(step / (2 * o.smoothing))) : 170 * DEG
  // turning towards the material: clockwise for climb (material on the right)
  const sgn = o.climb ? -1 : 1
  const discCells = (Math.PI * r * r) / cellA

  /** Width of cut of a step from p (where the tool stands, already cut round it) to q. */
  const load = (p: P, q: P) => {
    const L = Math.hypot(q.x - p.x, q.y - p.y)
    if (L < 1e-9 || !W.clear(p, q, wg)) return Infinity
    return (ras.countStep(p, q, r) * cellA) / L
  }
  const rot = (d: P, a: number): P => ({ x: d.x * Math.cos(a) - d.y * Math.sin(a), y: d.x * Math.sin(a) + d.y * Math.cos(a) })

  /** Best next step from p heading d, or null when every allowed heading overloads. */
  const next = (p: P, d: P): { q: P; d: P; e: number } | null => {
    const at = (tau: number) => {
      const dd = rot(d, sgn * tau)
      const q = { x: p.x + dd.x * step, y: p.y + dd.y * step }
      return { q, d: dd, e: load(p, q) }
    }
    let s0 = at(0)
    if (s0.e <= aim) {
      // turn into the material while the cut stays under the aim; with no turn reaching the aim,
      // the heading that cuts most (turning further can point the tool back into cleared area)
      let lo = 0
      let best = s0
      let most = s0
      let hi: number | null = null
      for (let k = 1; k <= 8; k++) {
        const t = (tauMax * k) / 8
        const s = at(t)
        if (s.e > aim) {
          hi = t
          break
        }
        lo = t
        best = s
        if (s.e > most.e) most = s
      }
      if (hi === null) return most
      if (hi !== null) {
        let up: number = hi
        for (let k = 0; k < 6; k++) {
          const m: number = (lo + up) / 2
          const s = at(m)
          if (s.e <= aim) {
            lo = m
            best = s
          } else up = m
        }
      }
      return best
    }
    // turn away from the material until the cut is under the aim
    let bad = 0
    let good: number | null = null
    let best: typeof s0 | null = null
    for (let k = 1; k <= 8; k++) {
      const t = -(tauMax * k) / 8
      const s = at(t)
      if (s.e <= aim) {
        good = t
        best = s
        break
      }
      bad = t
    }
    if (good === null || !best) return null
    let ok: number = good
    for (let k = 0; k < 6; k++) {
      const m: number = (ok + bad) / 2
      const s = at(m)
      if (s.e <= aim) {
        ok = m
        best = s
      } else bad = m
    }
    s0 = best
    return s0
  }

  /** Run a pass from p; returns the moves (the raster is cut as it goes). */
  const pass = (p: P, d: P) => {
    const pts: P[] = []
    const loads: number[] = []
    const logs: number[][] = []
    let light = 0
    let at = p
    let dir = d
    for (let n = 0; n < 200000; n++) {
      const s = next(at, dir)
      if (!s) break
      if (s.e < eMin) {
        if (++light > 4) break
      } else light = 0
      const log: number[] = []
      ras.clearCapsule(at, s.q, r, log)
      touched(at, s.q)
      logs.push(log)
      pts.push(s.q)
      loads.push(s.e)
      at = s.q
      dir = s.d
    }
    // the tool ran on in air at the end: drop those moves, and put back the little they took
    while (loads.length && loads[loads.length - 1] < eMin) {
      ras.undo(logs.pop()!)
      const q = pts.pop()!
      loads.pop()
      touched(pts.length ? pts[pts.length - 1] : p, q)
    }
    return { pts, loads, real: loads.length }
  }

  // candidate positions for starts and entries: a lattice over the centre area
  const g = Math.max(h * 4, r / 2)
  const box = boxOf(centres)
  const gnx = Math.max(1, Math.ceil((box.maxX - box.minX) / g))
  const gny = Math.max(1, Math.ceil((box.maxY - box.minY) / g))
  const grid: P[] = []
  /** Lattice cell -> index into `grid` (-1: not a candidate). */
  const lat = new Int32Array(gnx * gny).fill(-1)
  for (let j = 0; j < gny; j++)
    for (let i = 0; i < gnx; i++) {
      const p = { x: box.minX + (i + 0.5) * g, y: box.minY + (j + 0.5) * g }
      if (inC.has(p) && W.distance(p, wg + 0.01) >= wg) lat[j * gnx + i] = grid.push(p) - 1
    }
  const wallDist = grid.map((p) => W.distance(p, 4 * r + 1))
  const startDead = new Uint8Array(grid.length)
  const entryDead = new Uint8Array(grid.length)
  const trochDead = new Uint8Array(grid.length)
  /** Per grid point: 0 = to be looked at again, 1 = tool clear with material close, 2 = material under the tool, 3 = nothing left near it (for good). */
  const status = new Uint8Array(grid.length)
  /**
   * The raster changed between a and b: grid points that may see the change are looked at again.
   * Points with nothing left near them stay so: statuses are only worked out between passes, and
   * material only ever comes back to the state before a pass (an undone trial), never beyond it.
   */
  const touched = (a: P, b: P) => {
    const reach = 2 * r + near + g
    const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach - box.minX) / g))
    const i1 = Math.min(gnx - 1, Math.floor((Math.max(a.x, b.x) + reach - box.minX) / g))
    const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - reach - box.minY) / g))
    const j1 = Math.min(gny - 1, Math.floor((Math.max(a.y, b.y) + reach - box.minY) / g))
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = lat[j * gnx + i]
        if (k >= 0 && status[k] !== 3) status[k] = 0
      }
  }
  const statusOf = (k: number) => {
    if (status[k] === 0) {
      const q = grid[k]
      status[k] = ras.anyCapsule(q, q, r) ? 2 : ras.anyCapsule(q, q, r + near) ? 1 : 3
    }
    return status[k]
  }
  const cut = (a: P, b: P, rr: number) => {
    ras.clearCapsule(a, b, rr)
    touched(a, b)
  }
  /** Restore the raster to a snapshot (a pass that went nowhere); `path`: where it had cut. */
  const restore = (snap: Uint32Array, from: P, to: P, path: P[] = []) => {
    ras.bits.set(snap)
    touched(from, to)
    for (let i = 0; i < path.length; i++) touched(i ? path[i - 1] : from, path[i])
  }

  /** Direction from p towards the nearest material (unit), or null. */
  const towards = (p: P): P | null => {
    let sx = 0
    let sy = 0
    for (let k = 0; k < 32; k++) {
      const a = (2 * Math.PI * k) / 32
      const c = { x: p.x + Math.cos(a) * (r + near / 2), y: p.y + Math.sin(a) * (r + near / 2) }
      const n = ras.countCapsule(c, c, near / 2 + h)
      sx += Math.cos(a) * n
      sy += Math.sin(a) * n
    }
    const l = Math.hypot(sx, sy)
    return l > 0 ? { x: sx / l, y: sy / l } : null
  }

  /**
   * Nearest grid point to p with a clear tool and material close by: lattice rings outwards from p,
   * so only points near it are looked at (ties: lowest index).
   */
  const findStart = (p: P | null, dead: Uint8Array): number => {
    let best = -1
    let bestD = Infinity
    const ok = (k: number) => k >= 0 && !dead[k] && status[k] !== 3 && statusOf(k) === 1
    if (!p) {
      for (let i = 0; i < grid.length; i++) if (ok(i)) return i
      return -1
    }
    const ci = Math.min(gnx - 1, Math.max(0, Math.floor((p.x - box.minX) / g)))
    const cj = Math.min(gny - 1, Math.max(0, Math.floor((p.y - box.minY) / g)))
    const maxRing = Math.max(gnx, gny)
    for (let ring = 0; ring <= maxRing; ring++) {
      // every point of a further ring is at least (ring - 1) * g away
      if (best >= 0 && (ring - 1) * g > bestD) break
      for (let j = cj - ring; j <= cj + ring; j++) {
        if (j < 0 || j >= gny) continue
        const edge = j === cj - ring || j === cj + ring
        for (let i = ci - ring; i <= ci + ring; i += edge ? 1 : 2 * ring || 1) {
          if (i < 0 || i >= gnx) continue
          const k = lat[j * gnx + i]
          if (!ok(k)) continue
          const q = grid[k]
          const dd = Math.hypot(q.x - p.x, q.y - p.y)
          if (dd < bestD || (dd === bestD && k < best)) {
            bestD = dd
            best = k
          }
        }
      }
    }
    return best
  }

  let at: P | null = null
  const linkTo = (q: P) => {
    if (at) items.push({ k: 'link', to: q, clear: W.clear(at, q, wg) && ras.countCapsule(at, q, r) === 0 })
  }

  for (let guard = 0; guard < 100000; guard++) {
    if ((guard & 15) === 0) checkCancel(work?.isCancelled)
    // (counting what is left reads the whole raster: not too often)
    if ((guard & 255) === 0) work?.progress?.(1 - (ras.total() * cellA) / total, 'Adaptive clearing')
    // 1. carry on from the nearest place beside the material
    const si = findStart(at, startDead)
    if (si >= 0) {
      const s = grid[si]
      const m = towards(s)
      if (!m) {
        startDead[si] = 1
        continue
      }
      const snap = ras.bits.slice()
      const res = pass(s, rot(m, -sgn * 90 * DEG))
      // a pass that only ran through air is no pass: undo it, and do not start here again
      if (res.real < 2) {
        if (res.pts.length) restore(snap, s, res.pts[res.pts.length - 1], res.pts)
        else ras.bits.set(snap)
        startDead[si] = 1
        continue
      }
      linkTo(s)
      items.push({ k: 'pass', pts: res.pts, load: res.loads })
      at = res.pts[res.pts.length - 1]
      continue
    }
    // 2. a helix into a region not opened yet (only where a pass can follow it)
    let ei = -1
    for (let i = 0; i < grid.length; i++) {
      if (entryDead[i] || wallDist[i] < r * 1.1 || (ei >= 0 && wallDist[i] <= wallDist[ei])) continue
      if (statusOf(i) !== 2 || ras.countCapsule(grid[i], grid[i], r) < 0.9 * discCells) continue
      ei = i
    }
    if (ei >= 0) {
      const c = grid[ei]
      const rho = Math.min(o.helixPct * r, wallDist[ei] - wg - 0.02)
      if (rho < 0.1 * r) {
        entryDead[ei] = 1
        continue
      }
      const snap = ras.bits.slice()
      cut(c, c, rho + r)
      const start = { x: c.x + rho, y: c.y }
      const res = pass(start, { x: 0, y: o.climb ? 1 : -1 })
      if (res.real < 3) {
        restore(snap, c, res.pts.length ? res.pts[res.pts.length - 1] : c, res.pts)
        entryDead[ei] = 1
        continue
      }
      if (at) items.push({ k: 'link', to: start, clear: false })
      items.push({ k: 'helix', c, rho, start })
      items.push({ k: 'pass', pts: res.pts, load: res.loads })
      at = res.pts[res.pts.length - 1]
      continue
    }
    // 3. trochoidal loops into a channel too narrow for a pass
    const ti = findStart(at, trochDead)
    if (ti >= 0) {
      const s = grid[ti]
      trochDead[ti] = 1
      // crumbs are not worth loops (a channel has plenty of material within reach of its mouth)
      if (ras.countCapsule(s, s, 3 * r) * cellA < target * r) continue
      const t = trochoid(s)
      if (!t) continue
      linkTo(s)
      items.push({ k: 'pass', pts: t.pts, load: t.loads, trochoidal: true })
      at = t.pts[t.pts.length - 1]
      startDead.fill(0)
      continue
    }
    break
  }

  /**
   * Trochoidal loops from s (a clear place beside a narrow channel): circles whose centre creeps
   * along the middle of the channel, the creep per loop chosen to hold the width of cut. Radius:
   * as large as the channel allows, at most the tool radius.
   */
  function trochoid(s: P): { pts: P[]; loads: number[] } | null {
    const snap0 = ras.bits.slice()
    const res = loops(s)
    // nothing worth keeping: put back what the trial loops took off the raster (the points near
    // the loops were marked to be looked at again as they cut)
    if (!res) ras.bits.set(snap0)
    return res
  }

  function loops(s: P): { pts: P[]; loads: number[] } | null {
    const rhoMin = 0.15 * r
    // the way into the channel: the direction a centre can go furthest with the most material in reach
    let m: P | null = null
    let most = 0
    for (let k = 0; k < 72; k++) {
      const d = { x: Math.cos((k * Math.PI) / 36), y: Math.sin((k * Math.PI) / 36) }
      let L = 0
      for (let t = 0.25 * r; t <= 2 * r + 1e-9; t += 0.25 * r) {
        if (!W.clear(s, { x: s.x + d.x * t, y: s.y + d.y * t }, wg)) break
        L = t
      }
      if (L <= 0) continue
      const n = ras.countCapsule(s, { x: s.x + d.x * L, y: s.y + d.y * L }, r)
      if (n > most) {
        most = n
        m = d
      }
    }
    if (!m) return null
    /** The point across the channel (through c, square to d) farthest from the walls. */
    const middle = (c: P, d: P, span: number) => {
      const n = { x: -d.y, y: d.x }
      let best = c
      let bestD = W.distance(c, 4 * r + 1)
      for (let k = -20; k <= 20; k++) {
        const q = { x: c.x + (n.x * span * k) / 20, y: c.y + (n.y * span * k) / 20 }
        const dq = W.distance(q, 4 * r + 1)
        if (dq > bestD + 1e-9) {
          best = q
          bestD = dq
        }
      }
      return { c: best, d: bestD }
    }
    let mid = middle(s, m, r)
    let rho = Math.min(r, mid.d - wg - 0.02)
    if (rho < rhoMin) return null
    // back off along the channel until the first circle lies in cleared area
    let centre = mid.c
    for (let k = 0; k < 40 && ras.countCapsule(centre, centre, rho + r) > 0; k++) {
      const c = { x: centre.x - m.x * 0.25 * r, y: centre.y - m.y * 0.25 * r }
      if (!W.clear(centre, c, wg + rho)) break
      centre = c
    }
    // loops of 12 straight moves (short moves are measured less precisely on the raster)
    const n = 12
    const dphi = (2 * Math.PI) / n
    // a little more margin under the target on these short moves
    const aimT = 0.85 * aim
    // each loop starts and ends at the back of its circle (in cleared area), so the cut at the
    // front comes in the middle of the loop and depends on that loop's own creep only
    const phi0 = Math.atan2(m.y, m.x) + Math.PI
    const pts: P[] = []
    const loads: number[] = []
    let dir = m
    let pitch = Math.min(rho, target)
    // the first circle must start in cleared area, and so must the way to it
    if (ras.countCapsule(centre, centre, rho + r) > 0) return null
    let tip = { x: centre.x + rho * Math.cos(phi0), y: centre.y + rho * Math.sin(phi0) }
    const L0 = Math.hypot(tip.x - s.x, tip.y - s.y)
    if (L0 > 1e-9) {
      if (!W.clear(s, tip, wg) || ras.countCapsule(s, tip, r) > 0) return null
      pts.push(tip)
      loads.push(0)
    }
    let removed = 0
    let air = 0
    for (let loop = 0; loop < 20000; loop++) {
      // creep direction: as straight on as the channel allows with material ahead, re-centred in it
      let step1: { c: P; d: P; rho: number } | null = null
      for (const a of [0, 15, -15, 30, -30, 45, -45, 60, -60]) {
        const d: P = rot(dir, a * DEG)
        const mm = middle({ x: centre.x + d.x * pitch, y: centre.y + d.y * pitch }, d, Math.min(r, 2 * pitch + 0.5 * rho))
        const rr = Math.min(r, mm.d - wg - 0.02, rho * 1.25)
        // the circle changes radius over the loop: the larger radius must clear the walls all along
        if (rr < rhoMin || !W.clear(centre, mm.c, wg + Math.max(rho, rr))) continue
        if (ras.countCapsule(mm.c, mm.c, rr + r + pitch) === 0) continue
        step1 = { c: mm.c, d, rho: rr }
        break
      }
      // the channel narrows: shrink the circle where it is before creeping on
      if (!step1 && rho > rhoMin * 1.01) step1 = { c: centre, d: dir, rho: Math.max(rhoMin, rho * 0.8) }
      if (!step1) break
      // one loop with this creep; halve it while the cut is too heavy
      let ok: { pts: P[]; loads: number[]; tip: P } | null = null
      for (let tries = 0; tries < 10 && !ok; tries++) {
        const snap = ras.bits.slice()
        const c1 = step1.c
        const lp: P[] = []
        const ll: number[] = []
        let prev = tip
        let heavy = false
        for (let k = 1; k <= n; k++) {
          // the circle moves on (and changes size) in the first quarter of the loop, while the tool is
          // at the back: the front half then cuts exactly this loop's creep
          const f = Math.min(1, (4 * k) / n)
          const phi = phi0 - sgn * dphi * k
          const rk = rho + (step1.rho - rho) * f
          const q = { x: centre.x + (c1.x - centre.x) * f + rk * Math.cos(phi), y: centre.y + (c1.y - centre.y) * f + rk * Math.sin(phi) }
          const e = load(prev, q)
          if (e > aimT) {
            heavy = true
            break
          }
          cut(prev, q, r)
          lp.push(q)
          ll.push(e)
          prev = q
        }
        if (heavy) {
          restore(snap, centre, c1)
          pitch /= 2
          if (pitch < 0.01 * r) break
          const d: P = step1.d
          const mm = middle({ x: centre.x + d.x * pitch, y: centre.y + d.y * pitch }, d, Math.min(r, 2 * pitch + 0.5 * rho))
          const rr = Math.max(rhoMin, Math.min(r, mm.d - wg - 0.02, rho * 1.25))
          step1 = W.clear(centre, mm.c, wg + Math.max(rho, rr)) ? { c: mm.c, d, rho: rr } : { c: centre, d, rho: Math.max(rhoMin, rho * 0.8) }
          continue
        }
        ok = { pts: lp, loads: ll, tip: prev }
      }
      if (!ok) break
      let took = 0
      ok.pts.forEach((q, i) => (took += ok!.loads[i] * Math.hypot(q.x - (i ? ok!.pts[i - 1].x : tip.x), q.y - (i ? ok!.pts[i - 1].y : tip.y))))
      pts.push(...ok.pts)
      loads.push(...ok.loads)
      removed += took
      centre = step1.c
      rho = step1.rho
      tip = ok.tip
      dir = step1.d
      // loops in air on the way in are fine; many in a row mean there is nothing to reach
      air = took < 1e-3 ? air + 1 : 0
      if (air > 30) break
      // a light loop: creep further next time
      if (Math.max(...ok.loads) < 0.6 * aimT) pitch = Math.min(rho, pitch * 1.4)
    }
    // not worth it: loops that took next to nothing
    if (removed < Math.max(target * r, 4 * cellA)) return null
    return { pts, loads }
  }

  const left = ras.total() * cellA
  if (left > Math.max(0.01 * total, 1)) warnings.push(`Adaptive clearing left ${left.toFixed(0)} mm² (${((100 * left) / total).toFixed(1)} %) it could not reach at this width of cut (corners or narrow places): finish with a rest-machining pocket and a smaller tool.`)
  return { items, total, left, warnings }
}

function boxOf(polys: P[][]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const poly of polys)
    for (const p of poly) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  return { minX, minY, maxX, maxY }
}
