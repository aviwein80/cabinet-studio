/**
 * Undercut roughing (3D-08, M3.1g): a lollipop clears the material under an overhang that a tool
 * coming straight down cannot reach (Z-level roughing leaves it), level by level, before undercut
 * finishing.
 *
 * The ball's centre goes only where the ball (radius R + stock) and the neck above it (neck radius
 * + collision margin + stock, from the ball's centre up) both keep clear of the model; at each
 * level that is the "clear" set, found exactly per grid node from the heights at which the ball
 * touches each facet near the vertical line (`BallLine`) and an exact flat-cutter drop for the
 * neck. Where the ball could also rise straight up the way is "open"; where it could not, it is
 * under an overhang. The material there is cleared working in from the open side: passes along
 * the lines a step-over, two step-overs, ... in from the open area (distance measured through the
 * clear set, so a pass is only made where the tool can get to it sideways), then one pass along
 * the edge of the clear set, where the ball touches the model (or the neck reaches the margin).
 *
 * Every pass point is clear by an exact test, and every straight move (passes, links, the way in
 * and out) is checked every 0.05 mm and cut where it is not. The tool goes down and up only in the
 * open, where nothing is above it; under the overhang it only moves level.
 */
import { checkCancel, type Work } from '@/core/cancel'
import type { P } from '../geom'
import { type Mesh, meshBounds } from '../mesh/types'
import type { Move } from '../toolpath'
import type { Levels, Rough3dOp } from '../types'
import { insideRegion, polysBox, type Region } from './region'
import { levelLines } from './scallop'
import { UndercutModel, type UndercutTool } from './undercut'

export interface UndercutRoughResult {
  moves: Move[]
  warnings: string[]
  /** Lowest tool-tip Z of any cutting move (NaN when nothing was cut). */
  minZ: number
  /** Ball-centre heights of the levels that were cut, top down. */
  levels: number[]
  /** Distance between passes used, mm. */
  spacing: number
}

/** Grid nodes at most. */
const MAX_NODES = 1_500_000
/** Straight moves are checked this often, mm. */
const CHECK_STEP = 0.05

type V3 = [number, number, number]

export function undercutRough(op: Rough3dOp, mesh: Mesh, tool: UndercutTool, region: Region, levels: Levels, work?: Work): UndercutRoughResult {
  const warnings: string[] = []
  const none = (w: string): UndercutRoughResult => ({ moves: [], warnings: [...warnings, w], minZ: NaN, levels: [], spacing: 0 })
  if (!region.polys.length) return none('The boundary is empty.')
  const s = Math.max(0, op.surface.stockToLeave)
  const R = tool.R + s
  const model = new UndercutModel(mesh, { R, neck: tool.neck + s })
  const gougeTol = Math.min(Math.max(0.001, op.surface.tolerance || 0.01), 0.002)
  const step = Math.max(0.05, op.stepover * 2 * tool.R)
  const sd = Math.max(0.1, op.stepdown)
  const reach = Math.max(0, tool.R - tool.neck)

  // the grid over the boundary
  const box = polysBox(region.polys)
  let h = Math.min(0.5, Math.max(0.1, Math.min(step / 4, reach / 6 || 0.5)))
  const pad = 2
  const span = (box.maxX - box.minX + 2 * pad * h) * (box.maxY - box.minY + 2 * pad * h)
  if (span / (h * h) > MAX_NODES) h = Math.sqrt(span / MAX_NODES)
  const x0 = box.minX - pad * h
  const y0 = box.minY - pad * h
  const nx = Math.ceil((box.maxX - box.minX) / h) + 2 * pad + 1
  const ny = Math.ceil((box.maxY - box.minY) / h) + 2 * pad + 1
  const n = nx * ny
  const X = (k: number) => x0 + (k % nx) * h
  const Y = (k: number) => y0 + Math.floor(k / nx) * h

  // per node: inside the boundary, the neck's lowest clear centre height, the ball's intervals
  const inReg = new Uint8Array(n)
  const neckZ = new Float64Array(n)
  const topHi = new Float64Array(n)
  const ivOff = new Int32Array(n + 1)
  const lo: number[] = []
  const hi: number[] = []
  let zTop = -Infinity
  let zBot = Infinity
  for (let k = 0; k < n; k++) {
    if ((k & 4095) === 0) {
      checkCancel(work?.isCancelled)
      work?.progress?.(0.3 * (k / n), 'Finding the overhangs')
    }
    ivOff[k] = lo.length
    const x = X(k)
    const y = Y(k)
    inReg[k] = insideRegion(region, { x, y }) ? 1 : 0
    const iv = model.line.intervals(x, y)
    neckZ[k] = model.neck.drop(x, y) ? model.neck.z : -Infinity
    topHi[k] = iv.length ? iv[iv.length - 1].hi : -Infinity
    for (const v of iv) {
      lo.push(v.lo)
      hi.push(v.hi)
    }
    if (!inReg[k]) continue
    // gaps between the intervals the neck can reach: the ball can be there, under something
    for (let q = 0; q + 1 < iv.length; q++) {
      const bottom = Math.max(iv[q].hi, neckZ[k])
      const top = iv[q + 1].lo
      if (top - bottom < 1e-3) continue
      zTop = Math.max(zTop, top)
      zBot = Math.min(zBot, bottom)
    }
  }
  ivOff[n] = lo.length
  if (!Number.isFinite(zTop)) return none(region.fromModel ? 'Nothing to rough: no overhang this lollipop can reach under (its neck, with the collision margin, must keep clear of the model).' : 'Nothing to rough: no overhang inside the boundary that this lollipop can reach under.')

  /** The ball (and neck) clear of the model with its centre at height zc above node k. */
  const clearNode = (k: number, zc: number) => {
    if (zc < neckZ[k] - 1e-9) return false
    for (let q = ivOff[k]; q < ivOff[k + 1]; q++) if (zc > lo[q] && zc < hi[q]) return false
    return true
  }
  const clearAt = (x: number, y: number, zc: number) => insideRegion(region, { x, y }, 1e-4) && model.clear(x, y, zc, gougeTol)
  /** The straight move a -> b (ball centres) keeps the ball and neck clear, checked every 0.05 mm. */
  const clearMove = (a: V3, b: V3) => {
    const m = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / CHECK_STEP))
    for (let i = 1; i < m; i++) {
      const f = i / m
      if (!clearAt(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f)) return false
    }
    return true
  }

  // levels: from the highest underside the ball can touch down to the lowest floor beneath one
  const zs: number[] = []
  for (let z = zTop; z > zBot + 1e-6; z -= sd) zs.push(z)
  if (!zs.length || zs[zs.length - 1] - zBot > 1e-3) zs.push(zBot)

  const top = meshBounds(mesh).max[2] + s
  const clearZ = Math.max(levels.safeZ, top + levels.rapidZ)
  const above = Math.max(levels.rapidZ, top + levels.rapidZ)
  const tipZ = (zc: number) => zc - tool.R
  const moves: Move[] = []
  let minZ = Infinity
  const cutLevels: number[] = []
  let lostPieces = 0
  const D = new Float64Array(n)
  const isClear = new Uint8Array(n)
  const isOpen = new Uint8Array(n)
  const heap = new NodeHeap()
  const nb = [1, -1, nx, -nx, nx + 1, nx - 1, -nx + 1, -nx - 1]
  const nbLen = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2].map((v) => v * h)

  zs.forEach((zc, li) => {
    checkCancel(work?.isCancelled)
    work?.progress?.(0.3 + (0.7 * li) / zs.length, `Level ${li + 1} of ${zs.length}`)
    // clear, open and under, per node
    let anyUnder = false
    for (let k = 0; k < n; k++) {
      const c = inReg[k] && clearNode(k, zc) ? 1 : 0
      isClear[k] = c
      isOpen[k] = c && zc >= topHi[k] - 1e-9 ? 1 : 0
      if (c && !isOpen[k]) anyUnder = true
      D[k] = NaN
    }
    if (!anyUnder) return
    // distance from the open area, through the clear set (8 neighbours; a diagonal step needs both
    // of its sides clear), starting from open nodes next to an under node
    heap.clear()
    const i0 = (k: number) => k % nx
    const neighbour = (k: number, e: number): number => {
      const i = i0(k)
      const dx = e === 0 || e === 4 || e === 6 ? 1 : e === 1 || e === 5 || e === 7 ? -1 : 0
      if ((dx === 1 && i === nx - 1) || (dx === -1 && i === 0)) return -1
      const q = k + nb[e]
      if (q < 0 || q >= n || !isClear[q]) return -1
      if (e >= 4 && (!isClear[k + dx] || !isClear[q - dx])) return -1
      return q
    }
    for (let k = 0; k < n; k++) {
      if (!isOpen[k]) continue
      for (let e = 0; e < 8; e++) {
        const q = neighbour(k, e)
        if (q >= 0 && !isOpen[q]) {
          D[k] = 0
          heap.push(k, 0)
          break
        }
      }
    }
    let maxD = 0
    while (heap.size) {
      const [k, dk] = heap.pop()
      if (dk > D[k]) continue
      for (let e = 0; e < 8; e++) {
        const q = neighbour(k, e)
        if (q < 0 || isOpen[q]) continue
        const dq = dk + nbLen[e]
        if (!(dq >= D[q])) {
          D[q] = dq
          maxD = Math.max(maxD, dq)
          heap.push(q, dq)
        }
      }
    }
    if (!(maxD > 0)) return
    // cells with a reached corner (the only ones that matter at this level)
    const cells: number[] = []
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const p = j * nx + i
        if (!Number.isNaN(D[p]) || !Number.isNaN(D[p + 1]) || !Number.isNaN(D[p + nx]) || !Number.isNaN(D[p + nx + 1])) cells.push(p)
      }
    const reached = (x: number, y: number) => {
      const i = Math.floor((x - x0) / h)
      const j = Math.floor((y - y0) / h)
      if (i < 0 || j < 0 || i >= nx - 1 || j >= ny - 1) return false
      const p = j * nx + i
      return !Number.isNaN(D[p]) || !Number.isNaN(D[p + 1]) || !Number.isNaN(D[p + nx]) || !Number.isNaN(D[p + nx + 1])
    }

    // passes a step-over apart in from the open side (each split where it is not clear)
    const groups: V3[][][] = []
    // (spaced evenly, never more than the step-over apart)
    const nPass = Math.ceil(maxD / step - 1e-9)
    for (let q = 1; q < nPass; q++) {
      const t = (q * maxD) / nPass
      const g: V3[][] = []
      for (const l of levelLines(D, nx, ny, x0, y0, h, t, cells)) g.push(...clearRuns(l.closed ? [...l.pts, l.pts[0]] : l.pts, zc))
      if (g.length) groups.push(g)
    }
    // the pass along the edge of the clear set, under the overhang: the traced edge (to 0.002 mm,
    // on the clear side) where the ball cannot rise
    const C = new Float64Array(n)
    for (let k = 0; k < n; k++) C[k] = clearNode(k, zc) ? 1 : 0
    const crossing = (p: number, q: number) => {
      const pIn = C[p] > 0.5
      const ax = X(p)
      const ay = Y(p)
      const bx = X(q)
      const by = Y(q)
      let a = 0
      let b = 1
      for (let it = 0; it < 24 && (b - a) * h > 0.002; it++) {
        const m = (a + b) / 2
        if (model.clear(ax + (bx - ax) * m, ay + (by - ay) * m, zc) === pIn) a = m
        else b = m
      }
      return pIn ? a : b
    }
    const wall: V3[][] = []
    for (const l of levelLines(C, nx, ny, x0, y0, h, 0.5, cells, crossing)) {
      const pts = l.closed ? [...l.pts, l.pts[0]] : l.pts
      // keep the stretches under the overhang that the passes reach
      let run: P[] = []
      const flush = () => {
        if (run.length >= 2) wall.push(...clearRuns(run, zc))
        run = []
      }
      for (const p of pts) {
        if (reached(p.x, p.y) && underAt(p.x, p.y, zc)) run.push(p)
        else flush()
      }
      flush()
    }
    if (wall.length) groups.push(wall)
    if (!groups.length) return

    // cut them in order, linked level when the way is short and clear; otherwise out to the open,
    // up, over and down again
    let at: V3 | null = null
    let poly: V3[] = []
    // every point since the tool came down in the open (all clear moves): the way back out if needed
    let trail: V3[] = []
    const flushPoly = () => {
      if (poly.length) {
        const f = new Float64Array(poly.length * 3)
        poly.forEach((q, i) => {
          f[i * 3] = q[0]
          f[i * 3 + 1] = q[1]
          f[i * 3 + 2] = tipZ(q[2])
          minZ = Math.min(minZ, tipZ(q[2]))
        })
        moves.push({ t: 'poly', pts: f, f: 'cut' })
      }
      poly = []
    }
    const leave = () => {
      if (!at) return
      // out sideways to the open, never up under the overhang: down the distance field, or back
      // the way the tool came
      const out = pathToOpen(at, zc) ?? [...trail].reverse()
      poly.push(...out.slice(1))
      flushPoly()
      const e = out[out.length - 1]
      moves.push({ t: 'feed', x: e[0], y: e[1], z: above, f: 'cut' })
      moves.push({ t: 'rapid', x: e[0], y: e[1], z: clearZ })
      at = null
      trail = []
    }
    let used = false
    for (const g of groups) {
      const left = [...g]
      while (left.length) {
        // nearest next (either end)
        let best = 0
        let rev = false
        let bestD = Infinity
        left.forEach((c, i) => {
          const da = at ? Math.hypot(c[0][0] - at[0], c[0][1] - at[1]) : 0
          const db = at ? Math.hypot(c[c.length - 1][0] - at[0], c[c.length - 1][1] - at[1]) : Infinity
          if (da < bestD) [bestD, best, rev] = [da, i, false]
          if (db < bestD) [bestD, best, rev] = [db, i, true]
        })
        const [c0] = left.splice(best, 1)
        const c = rev ? [...c0].reverse() : c0
        if (at && bestD <= 2 * step + 1e-9 && clearMove(at, c[0])) {
          poly.push(...c)
          trail.push(...c)
          at = c[c.length - 1]
          continue
        }
        const inPath = pathToOpen(c[0], zc)
        if (!inPath) {
          lostPieces++
          continue
        }
        leave()
        const o = inPath[inPath.length - 1]
        moves.push({ t: 'rapid', x: o[0], y: o[1], z: clearZ })
        if (above < clearZ) moves.push({ t: 'rapid', x: o[0], y: o[1], z: above })
        moves.push({ t: 'feed', x: o[0], y: o[1], z: tipZ(zc), f: 'plunge' })
        const way = [...[...inPath].reverse(), ...c.slice(1)]
        poly.push(...way.slice(1))
        trail = way
        at = c[c.length - 1]
        used = true
      }
    }
    leave()
    if (used) cutLevels.push(zc)
  })
  if (lostPieces) warnings.push(`${lostPieces} undercut roughing pass(es) left out: no clear way in sideways from where the tool could come down.`)
  if (!moves.length) return none('Nothing to rough: the lollipop cannot get under the overhang from the open side at any level.')
  warnings.push(`Clears up to ${reach.toFixed(1)} mm in under the overhang (the ball radius less the neck and the collision margin); material further in stays.`)
  return { moves, warnings, minZ: Number.isFinite(minZ) ? minZ : NaN, levels: cutLevels, spacing: step }

  /** Is the ball, centre at (x, y, zc), under something (it could not rise straight up)? */
  function underAt(x: number, y: number, zc: number): boolean {
    const iv = model.line.intervals(x, y)
    return iv.length > 0 && iv[iv.length - 1].hi > zc + 1e-9
  }

  /** A plan polyline at height zc as ball centres, split into the runs whose every move is clear. */
  function clearRuns(pts: P[], zc: number): V3[][] {
    const out: V3[][] = []
    let cur: V3[] = []
    const flush = () => {
      if (cur.length >= 2) out.push(cur)
      cur = []
    }
    for (const p of pts) {
      const q: V3 = [p.x, p.y, zc]
      if (!clearAt(p.x, p.y, zc)) {
        flush()
        continue
      }
      if (cur.length && !clearMove(cur[cur.length - 1], q)) flush()
      cur.push(q)
    }
    flush()
    return out
  }

  /**
   * The way from p (ball centre at its level) to the nearest open node, down the distance field,
   * shortened where straight moves stay clear; null when there is none.
   */
  function pathToOpen(p: V3, zc: number): V3[] | null {
    const i = Math.floor((p[0] - x0) / h)
    const j = Math.floor((p[1] - y0) / h)
    let startNode = -1
    let bestScore = Infinity
    for (let dj = -1; dj <= 2; dj++)
      for (let di = -1; di <= 2; di++) {
        const ii = i + di
        const jj = j + dj
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue
        const k = jj * nx + ii
        if (Number.isNaN(D[k])) continue
        const score = D[k] + Math.hypot(X(k) - p[0], Y(k) - p[1])
        if (score < bestScore && clearMove(p, [X(k), Y(k), zc])) {
          bestScore = score
          startNode = k
        }
      }
    if (startNode < 0) return null
    const chain: V3[] = [p, [X(startNode), Y(startNode), zc]]
    let k = startNode
    for (let guard = 0; D[k] > 0 && guard < n; guard++) {
      let next = -1
      for (let e = 0; e < 8; e++) {
        const q = k + nb[e]
        if (q < 0 || q >= n || Number.isNaN(D[q])) continue
        if (Math.abs((q % nx) - (k % nx)) > 1) continue
        if (D[q] < D[k] - 1e-12 && (next < 0 || D[q] < D[next])) next = q
      }
      if (next < 0) return null
      k = next
      chain.push([X(k), Y(k), zc])
    }
    // shortcuts: from each kept point, the farthest point a clear straight move reaches
    const out: V3[] = [chain[0]]
    let a = 0
    while (a < chain.length - 1) {
      let b = chain.length - 1
      while (b > a + 1 && !clearMove(chain[a], chain[b])) b--
      if (b === a + 1 && !clearMove(chain[a], chain[b])) return null
      out.push(chain[b])
      a = b
    }
    return out
  }
}

/** A small binary min-heap of grid nodes by distance. */
class NodeHeap {
  private k: number[] = []
  private d: number[] = []
  get size() {
    return this.k.length
  }
  clear() {
    this.k.length = 0
    this.d.length = 0
  }
  push(node: number, dist: number) {
    const K = this.k
    const Dd = this.d
    let i = K.length
    K.push(node)
    Dd.push(dist)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (Dd[p] <= Dd[i]) break
      ;[K[p], K[i]] = [K[i], K[p]]
      ;[Dd[p], Dd[i]] = [Dd[i], Dd[p]]
      i = p
    }
  }
  pop(): [number, number] {
    const K = this.k
    const Dd = this.d
    const top: [number, number] = [K[0], Dd[0]]
    const lk = K.pop()!
    const ld = Dd.pop()!
    if (K.length) {
      K[0] = lk
      Dd[0] = ld
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < K.length && Dd[l] < Dd[m]) m = l
        if (r < K.length && Dd[r] < Dd[m]) m = r
        if (m === i) break
        ;[K[m], K[i]] = [K[i], K[m]]
        ;[Dd[m], Dd[i]] = [Dd[i], Dd[m]]
        i = m
      }
    }
    return top
  }
}
