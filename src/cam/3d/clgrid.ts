/**
 * The tool-centre (CL) surface on a grid, and its level lines. At height z the tool may stand
 * wherever the CL height is at most z (it would cut into the model anywhere higher). The
 * boundary of that "allowed" area is where the tool touches the model at that height: the path
 * of a waterline pass, and the outer wall pass of a Z-level roughing slice.
 *
 * Level lines come from marching squares on a grid of exact drops; every crossing is then moved
 * onto the true level line by bisection with exact drops, and each straight piece is checked at
 * its midpoint and split (moving the new point onto the line) until it stays within tolerance.
 * Loops run with the allowed area on their left (counter-clockwise around allowed areas).
 */
import { checkCancel, type Work } from '@/core/cancel'
import type { P } from '../geom'
import type { DropCutter } from './dropcutter'

export interface LevelPoint extends P {
  /** Contact normal Z at this point (1 = touching a flat, 0 = a vertical wall). */
  nz: number
  /** Facet touched (-1 when none, e.g. on the grid frame). */
  tri: number
}

export interface LevelLoop {
  pts: LevelPoint[]
}

/** Pieces of a level line shorter than this (mm) are not split further. */
const MIN_PIECE = 0.004

export class CLGrid {
  readonly h: number
  readonly x0: number
  readonly y0: number
  /** Grid size including one frame of "forbidden" cells all round. */
  readonly nx: number
  readonly ny: number
  readonly vals: Float64Array
  readonly dc: DropCutter
  /** Added to every drop (stock to leave in Z). */
  readonly shift: number
  /** CL height where no facet lies under the tool. */
  readonly floor: number
  /** Bisection steps that put a crossing within `precision` of the level line. */
  private readonly steps: number
  private dil: Float64Array | null = null

  constructor(dc: DropCutter, box: { minX: number; minY: number; maxX: number; maxY: number }, h: number, floor: number, shift: number, precision: number, work?: Work) {
    this.dc = dc
    this.h = h
    this.shift = shift
    this.floor = floor
    this.steps = Math.max(4, Math.min(24, Math.ceil(Math.log2(h / Math.max(1e-6, precision)))))
    const nx = Math.max(2, Math.ceil((box.maxX - box.minX) / h) + 1)
    const ny = Math.max(2, Math.ceil((box.maxY - box.minY) / h) + 1)
    // one extra column/row each side, valued +Infinity, so every level line closes
    this.nx = nx + 2
    this.ny = ny + 2
    this.x0 = box.minX - h
    this.y0 = box.minY - h
    this.vals = new Float64Array(this.nx * this.ny).fill(Infinity)
    for (let j = 1; j <= ny; j++) {
      if ((j & 15) === 0) {
        checkCancel(work?.isCancelled)
        work?.progress?.(j / ny, 'Tool-centre surface')
      }
      for (let i = 1; i <= nx; i++) this.vals[j * this.nx + i] = this.z(this.x0 + i * h, this.y0 + j * h)
    }
  }

  /** Exact CL height at (x, y). */
  z(x: number, y: number): number {
    return this.dc.drop(x, y) ? this.dc.z + this.shift : this.floor
  }

  /** CL height at (x, y) is at most z (faster than `z(x, y) <= z`). */
  below(x: number, y: number, z: number): boolean {
    if (this.floor > z) return this.z(x, y) <= z
    return this.dc.clears(x, y, z - this.shift)
  }

  private point(x: number, y: number): LevelPoint {
    const hit = this.dc.drop(x, y)
    return { x, y, nz: hit ? this.dc.hitNz : 1, tri: hit ? this.dc.hitTri : -1 }
  }

  /** Lowest and highest CL height on the grid (frame excluded); `open`: somewhere no facet lies under the tool. */
  range() {
    let lo = Infinity
    let hi = -Infinity
    let open = false
    for (let j = 1; j + 1 < this.ny; j++)
      for (let i = 1; i + 1 < this.nx; i++) {
        const v = this.vals[j * this.nx + i]
        if (Number.isFinite(v)) {
          lo = Math.min(lo, v)
          hi = Math.max(hi, v)
        } else if (v < 0) open = true
      }
    return { lo, hi, open }
  }

  /**
   * Fast test for a flat-bottomed cutter (flat part radius `rf` at least 0.75 of the grid step,
   * cutter radius `R`): true when the tool is certainly clear of the model at (x, y) at height z.
   * Any position where the tool would be too high is caused by a contact whose whole flat-bottom
   * disc lies at least as high, and that disc holds a grid point within R + rf of the position,
   * so a grid maximum over that window that is at most z proves the position clear. False means
   * "not proven": check with an exact drop.
   */
  clearAt(x: number, y: number, z: number, R: number, rf: number): boolean {
    if (rf < 0.75 * this.h) return false
    if (!this.dil) {
      const m = Math.ceil((R + rf) / this.h) + 1
      const { nx, ny, vals } = this
      const tmp = new Float64Array(nx * ny)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          let v = -Infinity
          for (let k = Math.max(0, i - m); k <= Math.min(nx - 1, i + m); k++) v = Math.max(v, vals[j * nx + k])
          tmp[j * nx + i] = v
        }
      const dil = new Float64Array(nx * ny)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          let v = -Infinity
          for (let k = Math.max(0, j - m); k <= Math.min(ny - 1, j + m); k++) v = Math.max(v, tmp[k * nx + i])
          dil[j * nx + i] = v
        }
      this.dil = dil
    }
    const i = Math.round((x - this.x0) / this.h)
    const j = Math.round((y - this.y0) / this.h)
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return false
    return this.dil[j * this.nx + i] <= z
  }

  /** Point on the grid edge between corner a (allowed) and b (forbidden), on the level line. */
  private crossing(ia: number, ja: number, ib: number, jb: number, z: number): LevelPoint {
    let ax = this.x0 + ia * this.h
    let ay = this.y0 + ja * this.h
    let bx = this.x0 + ib * this.h
    let by = this.y0 + jb * this.h
    // the frame: halfway, never touching anything
    if (this.vals[jb * this.nx + ib] === Infinity) return { x: (ax + bx) / 2, y: (ay + by) / 2, nz: 1, tri: -1 }
    {
      for (let k = 0; k < this.steps; k++) {
        const mx = (ax + bx) / 2
        const my = (ay + by) / 2
        if (this.below(mx, my, z)) {
          ax = mx
          ay = my
        } else {
          bx = mx
          by = my
        }
      }
      // the allowed end: never past the level line
      return this.point(ax, ay)
    }
  }

  /**
   * Closed level lines at height z, allowed area on the left. `tol`: largest gap allowed between
   * a straight piece and the true line on the open side; `gougeTol` on the material side.
   */
  loops(z: number, tol: number, gougeTol: number): LevelLoop[] {
    const { nx, ny, vals, h } = this
    const inside = (i: number, j: number) => vals[j * nx + i] <= z
    // edge ids: horizontal (i,j)-(i+1,j) = 2*(j*nx+i); vertical (i,j)-(i,j+1) = 2*(j*nx+i)+1
    const next = new Map<number, { to: number; p: LevelPoint }>()
    const corner = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]
    const edgeId = (i: number, j: number, k: number) => (k === 0 ? 2 * (j * nx + i) : k === 1 ? 2 * (j * nx + i + 1) + 1 : k === 2 ? 2 * ((j + 1) * nx + i) : 2 * (j * nx + i) + 1)
    for (let j = 0; j + 1 < ny; j++)
      for (let i = 0; i + 1 < nx; i++) {
        const ins = corner.map(([di, dj]) => inside(i + di, j + dj))
        const n = ins.filter(Boolean).length
        if (n === 0 || n === 4) continue
        const exits: number[] = []
        const entries: number[] = []
        for (let k = 0; k < 4; k++) {
          const a = ins[k]
          const b = ins[(k + 1) % 4]
          if (a && !b) exits.push(k)
          else if (!a && b) entries.push(k)
        }
        const pairs: [number, number][] = []
        if (exits.length === 1) pairs.push([exits[0], entries[0]])
        else {
          // saddle: the centre decides whether the two allowed corners connect
          const cIn = this.below(this.x0 + (i + 0.5) * h, this.y0 + (j + 0.5) * h, z)
          for (const e of exits) pairs.push([e, cIn ? (e + 1) % 4 : (e + 3) % 4])
        }
        for (const [ex, en] of pairs) {
          const [ai, aj] = corner[ex]
          const [bi, bj] = corner[(ex + 1) % 4]
          const p = this.crossing(i + ai, j + aj, i + bi, j + bj, z)
          next.set(edgeId(i, j, ex), { to: edgeId(i, j, en), p })
        }
      }
    const loops: LevelLoop[] = []
    for (const start of [...next.keys()]) {
      if (!next.has(start)) continue
      const pts: LevelPoint[] = []
      let k = start
      for (let guard = 0; guard < 1e7; guard++) {
        const s = next.get(k)
        if (!s) break
        next.delete(k)
        pts.push(s.p)
        k = s.to
        if (k === start) break
      }
      if (pts.length >= 3) loops.push({ pts: this.refine(pts, z, tol, gougeTol) })
    }
    return loops
  }

  /** Split straight pieces until each stays within tolerance of the level line. */
  private refine(pts: LevelPoint[], z: number, tol: number, gougeTol: number): LevelPoint[] {
    const out: LevelPoint[] = []
    const n = pts.length
    const onLine = (m: P, dirX: number, dirY: number, towardsAllowed: boolean): LevelPoint | null => {
      // walk from m sideways until the other side of the line is found, then bisect
      const l = Math.hypot(dirX, dirY) || 1
      const nx = (-dirY / l) * (towardsAllowed ? 1 : -1)
      const ny = (dirX / l) * (towardsAllowed ? 1 : -1)
      for (const s of [this.h / 8, this.h / 4, this.h / 2, this.h]) {
        const qx = m.x + nx * s
        const qy = m.y + ny * s
        const qIn = this.below(qx, qy, z)
        if (qIn !== towardsAllowed) continue
        let ax = towardsAllowed ? qx : m.x
        let ay = towardsAllowed ? qy : m.y
        let bx = towardsAllowed ? m.x : qx
        let by = towardsAllowed ? m.y : qy
        for (let k = 0; k < this.steps; k++) {
          const mx = (ax + bx) / 2
          const my = (ay + by) / 2
          if (this.below(mx, my, z)) {
            ax = mx
            ay = my
          } else {
            bx = mx
            by = my
          }
        }
        return this.point(ax, ay)
      }
      return null
    }
    const split = (a: LevelPoint, b: LevelPoint, depth: number) => {
      if (depth > 10 || a.tri < 0 || b.tri < 0) return
      const dx = b.x - a.x
      const dy = b.y - a.y
      // pieces this short cannot stray further than half their length from the line
      if (dx * dx + dy * dy < MIN_PIECE * MIN_PIECE) return
      const m = { x: a.x + dx / 2, y: a.y + dy / 2 }
      let c: LevelPoint | null = null
      if (!this.below(m.x, m.y, z + gougeTol)) c = onLine(m, dx, dy, true)
      else if (this.below(m.x, m.y, z - tol)) c = onLine(m, dx, dy, false)
      else
        // a kink in the level line (a facet edge) can hide from the midpoint: test the quarters
        for (const f of [0.25, 0.75]) {
          const q = { x: a.x + dx * f, y: a.y + dy * f }
          if (!this.below(q.x, q.y, z + gougeTol)) {
            c = onLine(q, dx, dy, true)
            break
          }
        }
      if (!c) return
      split(a, c, depth + 1)
      out.push(c)
      split(c, b, depth + 1)
    }
    for (let i = 0; i < n; i++) {
      out.push(pts[i])
      split(pts[i], pts[(i + 1) % n], 0)
    }
    return out
  }
}
