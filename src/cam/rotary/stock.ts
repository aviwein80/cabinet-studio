/**
 * Rotary stock model (M3.3, 3D-10): the blank turned on the rotary axis, held as rays out from the
 * axis. The blank's surface is unrolled into a grid of cells (along the axis by round it); each
 * cell holds the material on its ray as a short list of intervals of distance from the axis, so a
 * groove cut by a square-ended tool (whose side walls overhang the ray) is kept exactly.
 *
 * Frame (`StockModel`): x along the axis from the blank's start, y round it as arc length on the
 * blank's outer radius Rs (y = Rs·θ), z = distance from the axis - Rs (0 at the blank's farthest
 * reach, -Rs at the axis). The tool stands square to the axis and points at it: a tool tip at
 * (x, y, z) is the tool on the ray at θ = y / Rs, at distance Rs + z from the axis.
 *
 * Carving is exact per ray for a tool standing still, and for moves straight along the axis or
 * straight round it (the swept shape is the tool at its nearest position); other moves are carved
 * at positions a quarter cell apart. `hf` keeps the outermost material of every cell as a
 * heightfield over the unrolled surface (the simulator's unrolled view and cut summary read it).
 *
 * Pure: no DOM, no React.
 */
import type { Box3, Mesh } from '../mesh/types'
import { type Cutter, cutterZ, type Heightfield, type V3 } from '../sim'
import type { StockModel, StockSnapshot } from '../stock/types'
import type { RotarySetup } from '../types'
import { blankRadius, blankRho, fromCyl } from './frame'

/** Pieces of material a ray holds before the smallest gaps are filled (never hiding material). */
export const ROTARY_MAX = 8

// ---------------------------------------------------------------------------------------------
// The tool against one ray
// ---------------------------------------------------------------------------------------------

/** |y'| <= W, z' >= zb against the ray (t·sn, t·cs). */
function strip(W: number, zb: number, cs: number, sn: number): [number, number] | null {
  const t0 = Math.max(0, zb / cs)
  const t1 = sn > 1e-12 ? W / sn : Infinity
  return t1 > t0 + 1e-12 ? [t0, t1] : null
}

/** Disc of radius W centred at height K on the tool axis, against the ray. */
function disc(W: number, K: number, cs: number, sn: number): [number, number] | null {
  const D = W * W - K * K * sn * sn
  if (D <= 0) return null
  const q = Math.sqrt(D)
  const lo = Math.max(0, K * cs - q)
  const hi = K * cs + q
  return hi > lo + 1e-12 ? [lo, hi] : null
}

/** {t in [0, tMax]: f(t) >= 0} for f concave there (the tool's side and underside against a ray). */
function concaveSpan(f: (t: number) => number, tMax: number): [number, number] | null {
  // the highest point of f, then where it crosses 0 on each side
  let a = 0
  let b = tMax
  const g = (Math.sqrt(5) - 1) / 2
  let x1 = b - g * (b - a)
  let x2 = a + g * (b - a)
  let f1 = f(x1)
  let f2 = f(x2)
  for (let i = 0; i < 60 && b - a > 1e-9 * Math.max(1, tMax); i++) {
    if (f1 < f2) {
      a = x1
      x1 = x2
      f1 = f2
      x2 = a + g * (b - a)
      f2 = f(x2)
    } else {
      b = x2
      x2 = x1
      f2 = f1
      x1 = b - g * (b - a)
      f1 = f(x1)
    }
  }
  const tp = (a + b) / 2
  if (f(tp) < 0) return null
  const root = (lo: number, hi: number, rising: boolean) => {
    for (let i = 0; i < 60 && hi - lo > 1e-10; i++) {
      const m = (lo + hi) / 2
      if (f(m) >= 0 === rising) hi = m
      else lo = m
    }
    return (lo + hi) / 2
  }
  const t0 = f(0) >= 0 ? 0 : root(0, tp, true)
  const t1 = f(tMax) >= 0 ? tMax : root(tp, tMax, false)
  return t1 > t0 + 1e-12 ? [t0, t1] : null
}

/**
 * The stretch of a ray inside the cutter (distances from the rotary axis): the tool's tip at `h`
 * from the axis, the ray's cell `dx` along the axis from the tool's axis, and the ray `cs`, `sn`
 * (cosine and |sine| of its angle) off the tool's axis. The cutter is its cutting shape carried
 * on up (a shank of the same radius), as every stock model carves it; a saw blade is its disc.
 */
export function rayInterval(c: Cutter, h: number, dx: number, cs: number, sn: number): [number, number] | null {
  if (cs <= 1e-12) return null
  const adx = Math.abs(dx)
  if (c.blade) {
    const R = c.blade.R
    if (c.blade.plane === 'axial') {
      if (adx > R) return null
      return strip(c.r, h + R - Math.sqrt(R * R - dx * dx), cs, sn)
    }
    if (adx > c.r) return null
    return disc(R, h + R, cs, sn)
  }
  const r = c.r
  if (adx > r) return null
  const W = Math.sqrt(Math.max(0, r * r - dx * dx))
  if (c.shape === 'ball') {
    const K = h + r
    const d = disc(W, K, cs, sn)
    if (!d) return null
    const s = strip(W, K, cs, sn)
    return s ? [Math.min(d[0], s[0]), Math.max(d[1], s[1])] : d
  }
  if (c.shape === 'v' || c.shape === 'bull') {
    if (sn <= 1e-12) {
      const t0 = Math.max(0, h + cutterZ(c, 0, adx))
      return [t0, Infinity]
    }
    return concaveSpan((t) => t * cs - h - cutterZ(c, 0, Math.min(r, Math.hypot(dx, t * sn))), W / sn)
  }
  return strip(W, h, cs, sn)
}

/** How far round the tool reaches (radians each side of its axis) at `dx` along the axis, tip at `h`. */
function reachAngle(c: Cutter, h: number, dx: number): number {
  const adx = Math.abs(dx)
  if (c.blade) {
    if (c.blade.plane === 'axial') return adx > c.blade.R ? -1 : Math.atan2(c.r, Math.max(1e-9, h))
    if (adx > c.r) return -1
    const K = h + c.blade.R
    return K <= c.blade.R ? Math.PI / 2 : Math.asin(c.blade.R / K)
  }
  if (adx > c.r) return -1
  const W = Math.sqrt(Math.max(0, c.r * c.r - dx * dx))
  return h <= 1e-9 ? Math.PI / 2 : Math.atan2(W, h)
}

/** Reach of the tool along the axis from its own axis. */
const reachAlong = (c: Cutter) => (c.blade?.plane === 'axial' ? c.blade.R : c.r)

// ---------------------------------------------------------------------------------------------
// The stock
// ---------------------------------------------------------------------------------------------

export interface RotaryPose {
  /** Along the axis (stock frame x). */
  u: number
  /** Angle round the axis, radians. */
  theta: number
  /** Tip's distance from the axis. */
  rho: number
}

export class RotaryStock implements StockModel {
  readonly kind = 'rotary' as const
  readonly setup: RotarySetup
  /** The blank's farthest reach from the axis (z = 0 there). */
  readonly Rs: number
  readonly length: number
  /** Cell size along the axis and (as arc at Rs) round it. */
  readonly cell: number
  readonly nu: number
  readonly nt: number
  /** Angle of one cell. */
  readonly dphi: number
  readonly max: number
  /** Outermost material per cell (z frame), over the unrolled surface: x along, y round. */
  readonly hf: Heightfield
  private readonly iv: Float32Array
  private readonly cnt: Uint8Array
  /** cos and sin of every ray's angle. */
  private readonly cosT: Float64Array
  private readonly sinT: Float64Array
  /** Scratch for interval removal. */
  private readonly tmp: Float64Array
  private readonly initial: number
  overflow = 0
  private dirty: { minX: number; minY: number; maxX: number; maxY: number; through: boolean } | null = null

  constructor(setup: RotarySetup, cell = 0.5, maxPieces = ROTARY_MAX) {
    this.setup = setup
    this.Rs = blankRadius(setup.blank)
    this.length = Math.max(1e-6, setup.blank.end - setup.blank.start)
    this.nt = Math.max(16, Math.round((2 * Math.PI * this.Rs) / cell))
    this.cell = (2 * Math.PI * this.Rs) / this.nt
    this.dphi = (2 * Math.PI) / this.nt
    this.nu = Math.max(1, Math.ceil(this.length / this.cell - 1e-9))
    this.max = Math.max(1, Math.min(255, Math.round(maxPieces)))
    this.hf = { nx: this.nu, ny: this.nt, cell: this.cell, length: this.length, width: this.nt * this.cell, thickness: this.Rs, top: new Float32Array(this.nu * this.nt) }
    this.iv = new Float32Array(this.nu * this.nt * this.max * 2)
    this.cnt = new Uint8Array(this.nu * this.nt)
    this.cosT = new Float64Array(this.nt)
    this.sinT = new Float64Array(this.nt)
    for (let j = 0; j < this.nt; j++) {
      this.cosT[j] = Math.cos(this.phiOf(j))
      this.sinT[j] = Math.sin(this.phiOf(j))
    }
    this.tmp = new Float64Array(this.max * 2 + 4)
    this.reset()
    this.initial = this.volume()
    this.dirty = null
  }

  /** Centre of cell column i along the axis (stock frame x) and of row j round it (radians). */
  uOf(i: number) {
    return Math.min(this.length, (i + 0.5) * this.cell)
  }
  phiOf(j: number) {
    return (j + 0.5) * this.dphi
  }
  private widthOf(i: number) {
    return Math.max(0, Math.min(this.cell, this.length - i * this.cell))
  }

  /** Stock frame point to the tool pose it stands for. */
  pose(p: V3): RotaryPose {
    return { u: p.x, theta: p.y / this.Rs, rho: this.Rs + p.z }
  }

  bounds(): Box3 {
    return { min: [0, 0, -this.Rs], max: [this.length, this.hf.width, 0] }
  }

  /** The intervals of cell (i, j), as distances from the axis (copies). */
  ray(i: number, j: number): [number, number][] {
    const k = this.key(i, j)
    const out: [number, number][] = []
    for (let q = 0; q < this.cnt[k]; q++) out.push([this.iv[(k * this.max + q) * 2], this.iv[(k * this.max + q) * 2 + 1]])
    return out
  }

  /** Outermost material on the ray of cell (i, j), or 0 when none is left. */
  outer(i: number, j: number): number {
    const k = this.key(i, j)
    return this.cnt[k] ? this.iv[(k * this.max + this.cnt[k] - 1) * 2 + 1] : 0
  }

  private key(i: number, j: number) {
    return (((j % this.nt) + this.nt) % this.nt) * this.nu + i
  }

  private remove(k: number, lo: number, hi: number) {
    const n = this.cnt[k]
    if (!n || hi <= lo) return false
    const base = k * this.max * 2
    const iv = this.iv
    // most rays the tool reaches are already clear of it: leave them at once
    let hit = false
    for (let q = 0; q < n; q++)
      if (hi > iv[base + q * 2] && lo < iv[base + q * 2 + 1]) {
        hit = true
        break
      }
    if (!hit) return false
    const out = this.tmp
    let m = 0
    for (let q = 0; q < n; q++) {
      const a = iv[base + q * 2]
      const b = iv[base + q * 2 + 1]
      if (hi <= a || lo >= b) {
        out[m++] = a
        out[m++] = b
        continue
      }
      if (lo > a) {
        out[m++] = a
        out[m++] = lo
      }
      if (hi < b) {
        out[m++] = hi
        out[m++] = b
      }
    }
    while (m / 2 > this.max) {
      // too many pieces: fill the smallest gap (shows material, never hides it)
      let best = 1
      let gap = Infinity
      for (let q = 1; q < m / 2; q++) {
        const g = out[q * 2] - out[q * 2 - 1]
        if (g < gap) {
          gap = g
          best = q
        }
      }
      for (let q = best * 2 - 1; q + 2 < m; q++) out[q] = out[q + 2]
      m -= 2
      this.overflow++
    }
    let c = 0
    for (let q = 0; q < m; q += 2)
      if (out[q + 1] - out[q] > 1e-5) {
        iv[base + c * 2] = out[q]
        iv[base + c * 2 + 1] = out[q + 1]
        c++
      }
    this.cnt[k] = c
    this.hf.top[k] = (c ? iv[base + c * 2 - 1] : 0) - this.Rs
    return true
  }

  private mark(u0: number, u1: number, t0: number, t1: number, through: boolean) {
    const W = this.hf.width
    let y0 = t0 * this.Rs
    let y1 = t1 * this.Rs
    if (y1 - y0 >= W) {
      y0 = 0
      y1 = W
    } else {
      const s = Math.floor(y0 / W) * W
      y0 -= s
      y1 -= s
      // across the seam: the whole way round
      if (y1 > W) {
        y0 = 0
        y1 = W
      }
    }
    const d = this.dirty
    if (d) {
      d.minX = Math.min(d.minX, u0)
      d.minY = Math.min(d.minY, y0)
      d.maxX = Math.max(d.maxX, u1)
      d.maxY = Math.max(d.maxY, y1)
      d.through ||= through
    } else this.dirty = { minX: u0, minY: y0, maxX: u1, maxY: y1, through }
  }

  /**
   * Every cell the tool can reach standing at `p` (any position of a move from u0 to u1 along the
   * axis and th0 to th1 round it): f(k, i, j, dx, cs, sn), dx and the angle measured to the pose
   * nearest the cell (the move's own nearest point for moves straight along or round).
   */
  private forCells(c: Cutter, rho: number, u0: number, u1: number, th0: number, th1: number, f: (k: number, dx: number, cs: number, sn: number) => void) {
    const ra = reachAlong(c)
    const ua = Math.min(u0, u1)
    const ub = Math.max(u0, u1)
    const i0 = Math.max(0, Math.floor((ua - ra) / this.cell))
    const i1 = Math.min(this.nu - 1, Math.floor((ub + ra) / this.cell))
    const lo = Math.min(th0, th1)
    const hi = Math.max(th0, th1)
    const sweep = hi - lo
    const TWO = 2 * Math.PI
    // the ray's angle to the nearest pose of the move: 0 inside the swept range, else to its nearer end
    const cl = Math.cos(lo)
    const sl = Math.sin(lo)
    const ch = Math.cos(hi)
    const sh = Math.sin(hi)
    for (let i = i0; i <= i1; i++) {
      const u = this.uOf(i)
      const dx = u < ua ? u - ua : u > ub ? u - ub : 0
      const reach = reachAngle(c, rho, dx)
      if (reach < 0) continue
      const cosReach = Math.cos(Math.min(Math.PI, reach)) - 1e-12
      const all = sweep + 2 * reach >= TWO - this.dphi
      const ja = all ? 0 : Math.floor((lo - reach) / this.dphi - 0.5)
      const jb = all ? this.nt - 1 : Math.ceil((hi + reach) / this.dphi - 0.5)
      for (let jj = ja; jj <= jb; jj++) {
        const j = ((jj % this.nt) + this.nt) % this.nt
        const cp = this.cosT[j]
        const sp = this.sinT[j]
        let cs: number
        let sn: number
        const m = sweep > 0 ? (((this.phiOf(j) - lo) % TWO) + TWO) % TWO : -1
        if (sweep >= TWO || (m >= 0 && m <= sweep)) {
          cs = 1
          sn = 0
        } else if (m >= 0 && m - sweep < TWO - m) {
          // past the end of the range
          cs = cp * ch + sp * sh
          sn = Math.abs(sp * ch - cp * sh)
        } else {
          cs = cp * cl + sp * sl
          sn = Math.abs(sp * cl - cp * sl)
        }
        if (cs < cosReach) continue
        f(j * this.nu + i, dx, cs, sn)
      }
    }
  }

  /** Carve the tool standing at one pose, or swept straight along the axis or straight round it (`u1`, `th1`). */
  private carvePose(c: Cutter, rho: number, u0: number, u1: number, th0: number, th1: number) {
    let any = false
    this.forCells(c, rho, u0, u1, th0, th1, (k, dx, cs, sn) => {
      const iv = rayInterval(c, rho, dx, cs, sn)
      if (iv && this.remove(k, iv[0], iv[1])) any = true
    })
    if (any) this.mark(Math.min(u0, u1) - reachAlong(c), Math.max(u0, u1) + reachAlong(c), Math.min(th0, th1) - Math.PI / 2, Math.max(th0, th1) + Math.PI / 2, rho <= 1e-6)
  }

  /**
   * Turning round the axis, the tool's cut on a ray shrinks the further the ray is from the tool
   * (so the sweep is the tool at its nearest angle), except for a blade square to the axis whose
   * disc reaches past the axis: that is carved at positions.
   */
  private nestedRound(c: Cutter, rho: number) {
    return !(c.blade?.plane === 'ring' && rho < 0)
  }

  carve(a: V3, b: V3, cutter: Cutter) {
    const A = this.pose(a)
    const B = this.pose(b)
    // the tip beyond the blank's farthest reach all the way: nothing to cut
    if (Math.min(A.rho, B.rho) >= this.Rs) return
    const du = Math.abs(B.u - A.u)
    const dt = Math.abs(B.theta - A.theta)
    const dr = Math.abs(B.rho - A.rho)
    const still = (v: number, tol: number) => v <= tol
    // straight in towards the axis (or out): the tool at its deepest (it is carried on outwards)
    const ring = cutter.blade?.plane === 'ring'
    if (still(du, 1e-9) && still(dt, 1e-12) && !ring) {
      this.carvePose(cutter, Math.min(A.rho, B.rho), A.u, A.u, A.theta, A.theta)
      return
    }
    // straight along the axis at one angle and depth: exact
    if (still(dt, 1e-12) && still(dr, 1e-9)) {
      this.carvePose(cutter, A.rho, A.u, B.u, A.theta, A.theta)
      return
    }
    // straight round the axis at one place and depth: exact
    if (still(du, 1e-9) && still(dr, 1e-9) && this.nestedRound(cutter, A.rho)) {
      this.carvePose(cutter, A.rho, A.u, A.u, A.theta, B.theta)
      return
    }
    for (const p of this.posesAlong(A, B, 4)) this.carvePose(cutter, p.rho, p.u, p.u, p.theta, p.theta)
  }

  /** Poses along a straight move in the machine's axes, at most `1/per` of a cell apart (on the blank's surface). */
  private posesAlong(A: RotaryPose, B: RotaryPose, per: number): RotaryPose[] {
    const step = this.cell / per
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(B.u - A.u), Math.abs(B.theta - A.theta) * this.Rs, Math.abs(B.rho - A.rho)) / step))
    const out: RotaryPose[] = []
    for (let q = 0; q <= n; q++) {
      const k = q / n
      out.push({ u: A.u + (B.u - A.u) * k, theta: A.theta + (B.theta - A.theta) * k, rho: A.rho + (B.rho - A.rho) * k })
    }
    return out
  }

  carvePoints(a: V3, b: V3): V3[] {
    return this.posesAlong(this.pose(a), this.pose(b), 2).map((p) => ({ x: p.u, y: p.theta * this.Rs, z: p.rho - this.Rs }))
  }

  carveAt(p: V3, cutter: Cutter) {
    this.carve(p, p, cutter)
  }

  /**
   * How far material reaches into an envelope round the tool's axis standing at (x, y): the
   * largest (height along the tool's axis, z frame) - lowest(d) over material within rMax of the
   * axis, d the distance from it. Each piece on a ray is tried at its outer end (or where it
   * leaves rMax) and at points between, so a holder outline that rises fast is not missed.
   */
  intrusion(x: number, y: number, rMax: number, lowest: (d: number) => number): { depth: number; d: number } {
    let depth = -Infinity
    let at = 0
    const theta = y / this.Rs
    const env: Cutter = { r: rMax, shape: 'flat', angle: 0 }
    // material can only reach in above the envelope's lowest point (its outline does not come
    // down further out): every ray the cylinder from there up could meet
    const low = Math.min(lowest(0), lowest(rMax / 2), lowest(rMax))
    const from = Number.isFinite(low) ? Math.max(0, this.Rs + low) : this.Rs
    this.forCells(env, from, x, x, theta, theta, (k, dx, cs, sn) => {
      const n = this.cnt[k]
      for (let q = 0; q < n; q++) {
        const r0 = this.iv[(k * this.max + q) * 2]
        const r1 = this.iv[(k * this.max + q) * 2 + 1]
        // the furthest point within rMax of the tool's axis
        const tMax = sn > 1e-12 ? Math.sqrt(Math.max(0, rMax * rMax - dx * dx)) / sn : Infinity
        const hi = Math.min(r1, tMax)
        if (hi < r0) continue
        for (let s = 0; s <= 6; s++) {
          const t = hi - ((hi - r0) * s) / 6
          const d = Math.hypot(dx, t * sn)
          // only material inside the envelope: a wall the tool has just cut lies on its side
          if (d >= rMax - 1e-6) continue
          const e = t * cs - this.Rs - lowest(d)
          if (e > depth) {
            depth = e
            at = d
          }
        }
      }
    })
    return { depth, d: at }
  }

  private cellOf(x: number, y: number): number {
    const i = Math.floor(x / this.cell)
    if (i < 0 || i >= this.nu || !Number.isFinite(y)) return -1
    const j = Math.floor(y / this.cell)
    return this.key(i, j)
  }

  heightAt(x: number, y: number) {
    const k = this.cellOf(x, y)
    return k < 0 ? NaN : this.hf.top[k]
  }

  occupied(x: number, y: number, z: number) {
    const k = this.cellOf(x, y)
    if (k < 0) return false
    const rho = z + this.Rs
    for (let q = 0; q < this.cnt[k]; q++) if (rho >= this.iv[(k * this.max + q) * 2] && rho <= this.iv[(k * this.max + q) * 2 + 1]) return true
    return false
  }

  maxInDisc(x: number, y: number, r: number) {
    let best = -Infinity
    const i0 = Math.max(0, Math.floor((x - r) / this.cell))
    const i1 = Math.min(this.nu - 1, Math.floor((x + r) / this.cell))
    const j0 = Math.floor((y - r) / this.cell)
    const j1 = Math.floor((y + r) / this.cell)
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        if (Math.hypot((i + 0.5) * this.cell - x, (j + 0.5) * this.cell - y) > r + this.cell) continue
        const k = this.key(i, j)
        if (this.cnt[k] && this.hf.top[k] > best) best = this.hf.top[k]
      }
    return best
  }

  private volume() {
    let v = 0
    for (let j = 0; j < this.nt; j++)
      for (let i = 0; i < this.nu; i++) {
        const k = j * this.nu + i
        let a = 0
        for (let q = 0; q < this.cnt[k]; q++) {
          const r0 = this.iv[(k * this.max + q) * 2]
          const r1 = this.iv[(k * this.max + q) * 2 + 1]
          a += (r1 * r1 - r0 * r0) / 2
        }
        v += a * this.dphi * this.widthOf(i)
      }
    return v
  }

  /** Volume of the uncut blank as the cells hold it (mm³). */
  blankVolume() {
    return this.initial
  }

  /** Material left (mm³). */
  materialVolume() {
    return this.volume()
  }

  removedVolume() {
    return this.initial - this.volume()
  }

  /**
   * The material as a closed mesh: per piece of every cell an outer and an inner patch (each a
   * flat quad across the cell), and walls wherever a neighbouring cell lacks that material
   * (the blank's ends included). `frame`: 'part' places it in the part (for STL); 'local' keeps
   * the axis along X with θ = 0 up (+Z) and θ = 90° along -Y, for a view that turns it.
   * `i1`: only the cells before column i1 (a section across the axis).
   */
  toMesh(opt: { frame?: 'part' | 'local'; i1?: number } = {}): Mesh {
    const pos: number[] = []
    const local = opt.frame === 'local'
    const s = this.setup
    const u0 = s.blank.start
    const P = (u: number, phi: number, rho: number): number[] => (local ? [u, -rho * Math.sin(phi), rho * Math.cos(phi)] : fromCyl(s, u0 + u, phi, rho))
    const quad = (a: number[], b: number[], c: number[], d: number[]) => pos.push(...a, ...b, ...c, ...a, ...c, ...d)
    const ni = Math.min(this.nu, opt.i1 ?? this.nu)
    const col = (i: number, j: number): [number, number][] => (i < 0 || i >= ni ? [] : this.ray(i, j))
    const minus = (a: [number, number][], b: [number, number][]) => {
      const out: [number, number][] = []
      for (const [lo, hi] of a) {
        let cur: [number, number][] = [[lo, hi]]
        for (const [l2, h2] of b) {
          const next: [number, number][] = []
          for (const [l, h] of cur) {
            if (h2 <= l || l2 >= h) next.push([l, h])
            else {
              if (l2 > l) next.push([l, l2])
              if (h2 < h) next.push([h2, h])
            }
          }
          cur = next
        }
        out.push(...cur.filter(([l, h]) => h - l > 1e-6))
      }
      return out
    }
    for (let j = 0; j < this.nt; j++) {
      const p0 = j * this.dphi
      const p1 = (j + 1) * this.dphi
      for (let i = 0; i < ni; i++) {
        const me = col(i, j)
        if (!me.length) continue
        const x0 = i * this.cell
        const x1 = Math.min(this.length, (i + 1) * this.cell)
        for (const [lo, hi] of me) {
          quad(P(x0, p0, hi), P(x0, p1, hi), P(x1, p1, hi), P(x1, p0, hi))
          if (lo > 1e-9) quad(P(x0, p0, lo), P(x1, p0, lo), P(x1, p1, lo), P(x0, p1, lo))
        }
        for (const [lo, hi] of minus(me, col(i + 1, j))) quad(P(x1, p0, lo), P(x1, p0, hi), P(x1, p1, hi), P(x1, p1, lo))
        for (const [lo, hi] of minus(me, col(i - 1, j))) quad(P(x0, p0, lo), P(x0, p1, lo), P(x0, p1, hi), P(x0, p0, hi))
        for (const [lo, hi] of minus(me, col(i, j + 1))) quad(P(x0, p1, lo), P(x1, p1, lo), P(x1, p1, hi), P(x0, p1, hi))
        for (const [lo, hi] of minus(me, col(i, j - 1))) quad(P(x0, p0, lo), P(x0, p0, hi), P(x1, p0, hi), P(x1, p0, lo))
      }
    }
    const positions = Float32Array.from(pos)
    const indices = new Uint32Array(positions.length / 3)
    for (let q = 0; q < indices.length; q++) indices[q] = q
    return { positions, indices }
  }

  /**
   * Display mesh (the simulator's 3D view): the outer surface of the material, smooth across the
   * cells (each corner at the mean of the cells round it), closed by flat ends; in the local frame
   * (X along the axis, θ = 0 up, θ = 90° along -Y). Two facets per cell and quick to make; it does
   * not show pieces under an overhang (the exact, closed mesh is `toMesh`). `i1`: only the columns
   * before it (a section across the axis).
   */
  outerMesh(i1 = this.nu): Mesh {
    const n = Math.max(1, Math.min(this.nu, i1))
    const nt = this.nt
    const cols = n + 1
    const positions = new Float32Array((cols * nt + 2) * 3)
    for (let c = 0; c < cols; c++) {
      const u = Math.min(this.length, c * this.cell)
      for (let j = 0; j < nt; j++) {
        let sum = 0
        let k = 0
        for (const i of [c - 1, c])
          if (i >= 0 && i < n)
            for (const jj of [j - 1, j]) {
              sum += this.outer(i, jj)
              k++
            }
        const rho = k ? sum / k : 0
        const phi = j * this.dphi
        const o = (c * nt + j) * 3
        positions[o] = u
        positions[o + 1] = -rho * Math.sin(phi)
        positions[o + 2] = rho * Math.cos(phi)
      }
    }
    const a0 = cols * nt
    positions[a0 * 3] = 0
    positions[a0 * 3 + 3] = Math.min(this.length, n * this.cell)
    const indices = new Uint32Array((n * nt * 2 + 2 * nt) * 3)
    let q = 0
    for (let c = 0; c < n; c++)
      for (let j = 0; j < nt; j++) {
        const A = c * nt + j
        const B = (c + 1) * nt + j
        const C = (c + 1) * nt + ((j + 1) % nt)
        const D = c * nt + ((j + 1) % nt)
        indices.set([A, D, C, A, C, B], q)
        q += 6
      }
    for (let j = 0; j < nt; j++) {
      indices.set([a0, j, (j + 1) % nt], q)
      indices.set([a0 + 1, n * nt + ((j + 1) % nt), n * nt + j], q + 3)
      q += 6
    }
    return { positions, indices }
  }

  reset() {
    const b = this.setup.blank
    for (let j = 0; j < this.nt; j++) {
      const r = blankRho(b, this.phiOf(j))
      for (let i = 0; i < this.nu; i++) {
        const k = j * this.nu + i
        this.iv[k * this.max * 2] = 0
        this.iv[k * this.max * 2 + 1] = r
        this.cnt[k] = 1
        this.hf.top[k] = r - this.Rs
      }
    }
    this.overflow = 0
    this.dirty = { minX: 0, minY: 0, maxX: this.length, maxY: this.hf.width, through: true }
  }

  takeDirty() {
    const d = this.dirty
    this.dirty = null
    return d
  }

  snapshot(): StockSnapshot {
    const data = new Float32Array(this.iv.length + this.cnt.length)
    data.set(this.iv)
    for (let k = 0; k < this.cnt.length; k++) data[this.iv.length + k] = this.cnt[k]
    return { kind: 'rotary', data }
  }

  restore(s: StockSnapshot) {
    if (s.kind !== 'rotary' || s.data.length !== this.iv.length + this.cnt.length) throw new Error('Snapshot is from a different stock.')
    this.iv.set(s.data.subarray(0, this.iv.length))
    for (let k = 0; k < this.cnt.length; k++) {
      this.cnt[k] = s.data[this.iv.length + k]
      this.hf.top[k] = (this.cnt[k] ? this.iv[(k * this.max + this.cnt[k] - 1) * 2 + 1] : 0) - this.Rs
    }
    this.dirty = { minX: 0, minY: 0, maxX: this.length, maxY: this.hf.width, through: true }
  }
}
