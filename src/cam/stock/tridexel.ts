/**
 * Tri-dexel stock (M3.4): the material as intervals along three sets of straight rays, along X, Y
 * and Z, on square grids `cell` apart. A tool standing along any direction (positional 3+2: the
 * rotary axes locked at an angle) carves it exactly: the tool is a solid of revolution made of
 * pieces (frusta, a ball's sphere, a bull-nose corner) and every ray's meeting with what a move
 * sweeps is worked out with quadratics and slabs:
 *
 * - a move along the tool: the tool at its lower end, lengthened by the move;
 * - a move square to the tool: the tool at both ends and, between them, each piece's cross-section
 *   pushed along the move (a prism);
 * - any other move (a ramp or helix entry): the tool standing at points a quarter cell apart.
 *
 * The tool cuts only its cutting length (`Cutter.flute`); material higher up the tool is left for
 * the collision check to find. The Z rays keep a heightfield of the top (top view, `heightAt`)
 * and give the mesh (blocky, one cell, as the dexel stock's). Exact along each ray (float32
 * storage: about 1e-5 mm at 100 mm), so cut surfaces can be measured from the ray ends.
 *
 * Part frame: X along the length, Y along the width, Z = 0 at face 1 and negative into it.
 */
import type { Box3, Mesh } from '../mesh/types'
import { createHeightfield, type Cutter, type Heightfield, type V3 } from '../sim'
import { columnsMesh } from './dexel'
import type { StockModel, StockSnapshot } from './types'
import { clipOutline, sweptOutline } from '../tools/form'

/** Intervals a ray can hold; more are merged (the smallest gap filled: shows material, never hides it). */
export const TRIDEXEL_MAX = 12

/**
 * A piece of a tool (tool frame: h along the tool from the tip, ρ out from its axis):
 * frustum: ρ <= r0 + (r1 - r0)(h - h0)/(h1 - h0) for h0 <= h <= h1 (a cylinder when r0 = r1);
 * sphere: within R of the axis point at height c, for h0 <= h <= h1;
 * corner: a bull-nose's rounded corner and the flat inside it, ρ <= a + sqrt(rc² - (h - rc)²) for 0 <= h <= rc.
 */
export type ToolPiece = { k: 'frustum'; h0: number; h1: number; r0: number; r1: number } | { k: 'sphere'; c: number; R: number; h0: number; h1: number } | { k: 'corner'; a: number; rc: number }

/** The cutter's cutting part, `H` long from the tip, as pieces. */
export function toolPieces(c: Cutter, H: number): ToolPiece[] {
  const R = c.r
  if (!(H > 0) || !(R > 0)) return []
  // barrel and form tools (TOOL-07): a frustum per straight piece of the outline, the last radius carried up
  if (c.profile && c.profile.length > 1) {
    const o = clipOutline(c.profile, H)
    const out: ToolPiece[] = []
    for (let i = 1; i < o.length; i++) if (o[i].h > o[i - 1].h + 1e-12) out.push({ k: 'frustum', h0: o[i - 1].h, h1: o[i].h, r0: o[i - 1].r, r1: o[i].r })
    const top = o[o.length - 1]
    if (H > top.h + 1e-12) out.push({ k: 'frustum', h0: top.h, h1: H, r0: top.r, r1: top.r })
    return out
  }
  switch (c.shape) {
    case 'ball':
    case 'lollipop': {
      const out: ToolPiece[] = [{ k: 'sphere', c: R, R, h0: 0, h1: Math.min(R, H) }]
      if (H > R) out.push({ k: 'frustum', h0: R, h1: H, r0: R, r1: R })
      return out
    }
    case 'bull': {
      const rc = Math.min(Math.max(0, c.cornerRadius ?? 0), R, H)
      if (rc < 1e-9) return [{ k: 'frustum', h0: 0, h1: H, r0: R, r1: R }]
      const out: ToolPiece[] = [{ k: 'corner', a: R - rc, rc }]
      if (H > rc) out.push({ k: 'frustum', h0: rc, h1: H, r0: R, r1: R })
      return out
    }
    case 'v': {
      const tan = Math.tan(((c.angle || 90) * Math.PI) / 360)
      const hR = R / tan
      const out: ToolPiece[] = [{ k: 'frustum', h0: 0, h1: Math.min(hR, H), r0: 0, r1: Math.min(R, H * tan) }]
      if (H > hR) out.push({ k: 'frustum', h0: hR, h1: H, r0: R, r1: R })
      return out
    }
    default:
      // flat end mills, drills (flat-bottomed, as the other stocks draw them)
      return [{ k: 'frustum', h0: 0, h1: H, r0: R, r1: R }]
  }
}

/** Largest radius and length of a set of pieces. */
function extent(ps: readonly ToolPiece[]): { R: number; H: number } {
  let R = 0
  let H = 0
  for (const p of ps) {
    if (p.k === 'frustum') {
      R = Math.max(R, p.r0, p.r1)
      H = Math.max(H, p.h1)
    } else if (p.k === 'sphere') {
      R = Math.max(R, p.R)
      H = Math.max(H, p.h1)
    } else {
      R = Math.max(R, p.a + p.rc)
      H = Math.max(H, p.rc)
    }
  }
  return { R, H }
}

/** Pieces of a tool moved `D` along itself: the top piece's radius carried up D further. */
function lengthened(ps: readonly ToolPiece[], D: number): ToolPiece[] {
  if (!(D > 1e-12) || !ps.length) return [...ps]
  const { H } = extent(ps)
  let top = 0
  for (const p of ps) if (p.k === 'frustum' && Math.abs(p.h1 - H) < 1e-12) top = Math.max(top, p.r1)
  if (!top) for (const p of ps) top = Math.max(top, p.k === 'sphere' ? p.R : p.k === 'corner' ? p.a + p.rc : p.r1)
  return [...ps, { k: 'frustum', h0: H, h1: H + D, r0: top, r1: top }]
}

// ---------------------------------------------------------------------------------------------
// Intervals on a line s -> (linear and quadratic conditions)
// ---------------------------------------------------------------------------------------------

/** Scratch range filled by `halfLine` and `slab` (no allocation in the inner loops). */
const RG = { a: 0, b: 0 }

/** Where p + q·s >= 0 within [lo, hi]: false when nowhere, else the range is left in RG. */
function halfLine(p: number, q: number, lo: number, hi: number): boolean {
  if (Math.abs(q) < 1e-14) {
    RG.a = lo
    RG.b = hi
    return p >= -1e-12 && hi > lo
  }
  const s = -p / q
  if (q > 0) lo = Math.max(lo, s)
  else hi = Math.min(hi, s)
  RG.a = lo
  RG.b = hi
  return hi > lo
}

/** Where A s² + B s + C <= 0 within [lo, hi]: up to two intervals, pushed to `out`. */
function quadLE(A: number, B: number, C: number, lo: number, hi: number, out: number[]) {
  if (!(hi > lo)) return
  if (Math.abs(A) < 1e-14) {
    if (Math.abs(B) < 1e-14) {
      if (C <= 0) out.push(lo, hi)
      return
    }
    if (halfLine(-C, -B, lo, hi)) out.push(RG.a, RG.b)
    return
  }
  const disc = B * B - 4 * A * C
  if (A > 0) {
    if (disc <= 0) return
    const q = -0.5 * (B + (B < 0 ? -1 : 1) * Math.sqrt(disc))
    const r1 = q / A
    const r2 = C / q
    const a = Math.max(lo, Math.min(r1, r2))
    const b = Math.min(hi, Math.max(r1, r2))
    if (b > a) out.push(a, b)
    return
  }
  // A < 0: outside the roots
  if (disc <= 0) {
    out.push(lo, hi)
    return
  }
  const q = -0.5 * (B + (B < 0 ? -1 : 1) * Math.sqrt(disc))
  const r1 = Math.min(q / A, C / q)
  const r2 = Math.max(q / A, C / q)
  if (Math.min(hi, r1) > lo) out.push(lo, Math.min(hi, r1))
  if (hi > Math.max(lo, r2)) out.push(Math.max(lo, r2), hi)
}

/** Slab h0 <= H0 + s·Hd <= h1 narrowed into [lo, hi]: false when empty, else the range is left in RG. */
function slab(H0: number, Hd: number, h0: number, h1: number, lo: number, hi: number): boolean {
  if (Math.abs(Hd) < 1e-14) {
    RG.a = lo
    RG.b = hi
    return H0 >= h0 - 1e-12 && H0 <= h1 + 1e-12 && hi > lo
  }
  let a = (h0 - H0) / Hd
  let b = (h1 - H0) / Hd
  if (a > b) {
    const t = a
    a = b
    b = t
  }
  RG.a = Math.max(a, lo)
  RG.b = Math.min(b, hi)
  return RG.b > RG.a
}

/** Smallest of a convex function on [a, b] (golden section) and where. */
function convexMin(f: (s: number) => number, a: number, b: number): { s: number; v: number } {
  const g = (Math.sqrt(5) - 1) / 2
  let x1 = b - g * (b - a)
  let x2 = a + g * (b - a)
  let f1 = f(x1)
  let f2 = f(x2)
  for (let i = 0; i < 80 && b - a > 1e-9; i++) {
    if (f1 <= f2) {
      b = x2
      x2 = x1
      f2 = f1
      x1 = b - g * (b - a)
      f1 = f(x1)
    } else {
      a = x1
      x1 = x2
      f1 = f2
      x2 = a + g * (b - a)
      f2 = f(x2)
    }
  }
  return f1 <= f2 ? { s: x1, v: f1 } : { s: x2, v: f2 }
}

/** Where a convex f is <= 0 on [a, b], given a point inside: by bisection both ways. */
function convexInside(f: (s: number) => number, a: number, b: number, inside: number): [number, number] {
  const edge = (from: number, to: number) => {
    if (f(to) <= 0) return to
    let i = from
    let o = to
    for (let n = 0; n < 60 && Math.abs(o - i) > 1e-9; n++) {
      const m = (i + o) / 2
      if (f(m) <= 0) i = m
      else o = m
    }
    return i
  }
  return [edge(inside, a), edge(inside, b)]
}

// ---------------------------------------------------------------------------------------------
// The rays
// ---------------------------------------------------------------------------------------------

/** One set of parallel rays along axis `g`, on a grid over the other two axes (u, v). */
class RayGrid {
  readonly g: 0 | 1 | 2
  readonly ua: 0 | 1 | 2
  readonly va: 0 | 1 | 2
  readonly nu: number
  readonly nv: number
  readonly u0: number
  readonly v0: number
  readonly cell: number
  readonly max: number
  readonly iv: Float32Array
  readonly cnt: Uint8Array
  /** Each ray's material before any cutting (lo, hi; lo > hi = none). */
  readonly orig: Float32Array
  overflow = 0
  private readonly scratch: Float64Array

  constructor(g: 0 | 1 | 2, ua: 0 | 1 | 2, va: 0 | 1 | 2, nu: number, nv: number, u0: number, v0: number, cell: number, max: number) {
    this.g = g
    this.ua = ua
    this.va = va
    this.nu = nu
    this.nv = nv
    this.u0 = u0
    this.v0 = v0
    this.cell = cell
    this.max = max
    this.iv = new Float32Array(nu * nv * max * 2)
    this.cnt = new Uint8Array(nu * nv)
    this.orig = new Float32Array(nu * nv * 2)
    this.scratch = new Float64Array((max + 2) * 2)
  }

  get rays() {
    return this.nu * this.nv
  }

  /** Does ray k hold material anywhere in [lo, hi]? */
  touches(k: number, lo: number, hi: number): boolean {
    const n = this.cnt[k]
    if (!n) return false
    const base = k * this.max * 2
    return this.iv[base] < hi && this.iv[base + (n - 1) * 2 + 1] > lo
  }

  /** Ray k's material: [lo, hi] pairs. */
  intervals(k: number): [number, number][] {
    const out: [number, number][] = []
    for (let q = 0; q < this.cnt[k]; q++) out.push([this.iv[(k * this.max + q) * 2], this.iv[(k * this.max + q) * 2 + 1]])
    return out
  }

  /** Remove [lo, hi] from ray k; true when something changed. */
  remove(k: number, lo: number, hi: number): boolean {
    const n = this.cnt[k]
    if (!n || !(hi > lo)) return false
    const iv = this.iv
    const base = k * this.max * 2
    if (hi <= iv[base] || lo >= iv[base + (n - 1) * 2 + 1]) return false
    const out = this.scratch
    let m = 0
    let changed = false
    for (let q = 0; q < n; q++) {
      const a = iv[base + q * 2]
      const b = iv[base + q * 2 + 1]
      if (hi <= a || lo >= b) {
        out[m++] = a
        out[m++] = b
        continue
      }
      changed = true
      if (lo > a) {
        out[m++] = a
        out[m++] = lo
      }
      if (hi < b) {
        out[m++] = hi
        out[m++] = b
      }
    }
    if (!changed) return false
    // drop slivers left by rounding, then, still too many pieces: fill the smallest gaps (shows
    // material, never hides it)
    let kept = 0
    for (let q = 0; q < m; q += 2)
      if (out[q + 1] - out[q] > 1e-5) {
        out[kept++] = out[q]
        out[kept++] = out[q + 1]
      }
    m = kept
    while (m / 2 > this.max) {
      let best = 1
      let gap = Infinity
      for (let q = 1; q < m / 2; q++) {
        const d = out[q * 2] - out[q * 2 - 1]
        if (d < gap) {
          gap = d
          best = q
        }
      }
      out.copyWithin(best * 2 - 1, best * 2 + 1, m)
      m -= 2
      this.overflow++
    }
    for (let q = 0; q < m; q++) iv[base + q] = out[q]
    this.cnt[k] = m / 2
    return true
  }

  reset() {
    for (let k = 0; k < this.rays; k++) {
      const lo = this.orig[k * 2]
      const hi = this.orig[k * 2 + 1]
      if (hi - lo > 1e-6) {
        this.iv[k * this.max * 2] = lo
        this.iv[k * this.max * 2 + 1] = hi
        this.cnt[k] = 1
      } else this.cnt[k] = 0
    }
    this.overflow = 0
  }
}

/** A half-space n·p <= d (n need not be a unit vector). */
export interface HalfSpace {
  n: [number, number, number]
  d: number
}

export class TriDexelStock implements StockModel {
  readonly kind = 'tridexel' as const
  readonly length: number
  readonly width: number
  readonly thickness: number
  readonly cell: number
  readonly nx: number
  readonly ny: number
  readonly nz: number
  /** Rays along X, Y and Z. */
  readonly grids: [RayGrid, RayGrid, RayGrid]
  /** Top of the Z rays (top view). */
  readonly hf: Heightfield
  private dirty: { minX: number; minY: number; maxX: number; maxY: number; through: boolean } | null = null
  private readonly diag: number

  constructor(length: number, width: number, thickness: number, cell = 0.5, max = TRIDEXEL_MAX) {
    this.length = length
    this.width = width
    this.thickness = thickness
    this.cell = cell
    this.hf = createHeightfield(length, width, thickness, cell)
    this.nx = this.hf.nx
    this.ny = this.hf.ny
    this.nz = Math.max(1, Math.ceil(thickness / cell))
    const m = Math.max(1, Math.min(255, Math.round(max)))
    this.grids = [new RayGrid(0, 1, 2, this.ny, this.nz, 0, -thickness, cell, m), new RayGrid(1, 0, 2, this.nx, this.nz, 0, -thickness, cell, m), new RayGrid(2, 0, 1, this.nx, this.ny, 0, 0, cell, m)]
    this.diag = Math.hypot(length, width, thickness)
    this.setConvex([])
  }

  /**
   * The block cut down to a convex shape: the panel box and the given half-spaces (a blank with
   * chamfers, for tests and 3+2 set-ups on such blanks). Resets the stock.
   */
  setConvex(planes: readonly HalfSpace[]) {
    this.last = null
    const lo0: [number, number, number] = [0, 0, -this.thickness]
    const hi0: [number, number, number] = [this.length, this.width, 0]
    for (const G of this.grids) {
      for (let jv = 0; jv < G.nv; jv++)
        for (let iu = 0; iu < G.nu; iu++) {
          const k = jv * G.nu + iu
          const o = [0, 0, 0]
          o[G.ua] = G.u0 + (iu + 0.5) * G.cell
          o[G.va] = G.v0 + (jv + 0.5) * G.cell
          let lo = lo0[G.g]
          let hi = hi0[G.g]
          for (const h of planes) {
            const p = h.d - (h.n[G.ua] * o[G.ua] + h.n[G.va] * o[G.va])
            const q = h.n[G.g]
            if (Math.abs(q) < 1e-14) {
              if (p < 0) hi = lo - 1
            } else if (q > 0) hi = Math.min(hi, p / q)
            else lo = Math.max(lo, p / q)
          }
          G.orig[k * 2] = lo
          G.orig[k * 2 + 1] = hi
        }
      G.reset()
    }
    this.refreshTop()
    this.dirty = { minX: 0, minY: 0, maxX: this.length, maxY: this.width, through: true }
  }

  private refreshTop(k0 = 0, k1 = this.nx * this.ny) {
    const Z = this.grids[2]
    for (let k = k0; k < k1; k++) this.hf.top[k] = Z.cnt[k] ? Z.iv[(k * Z.max + Z.cnt[k] - 1) * 2 + 1] : -this.thickness
  }

  bounds(): Box3 {
    return { min: [0, 0, -this.thickness], max: [this.length, this.width, 0] }
  }

  private mark(minX: number, minY: number, maxX: number, maxY: number, through: boolean) {
    const d = this.dirty
    if (d) {
      d.minX = Math.min(d.minX, minX)
      d.minY = Math.min(d.minY, minY)
      d.maxX = Math.max(d.maxX, maxX)
      d.maxY = Math.max(d.maxY, maxY)
      d.through ||= through
    } else this.dirty = { minX, minY, maxX, maxY, through }
  }

  /** The tool's pieces for this cutter (cutting length = its flute, or the whole block). */
  private piecesOf(c: Cutter) {
    return toolPieces(c, c.flute && c.flute > 0 ? c.flute : this.diag + 1)
  }

  carve(a: V3, b: V3, cutter: Cutter, axis?: V3) {
    const w = unit(axis ?? { x: 0, y: 0, z: 1 })
    const ps = this.piecesOf(cutter)
    if (!ps.length) return
    const A: number[] = [a.x, a.y, a.z]
    const B: number[] = [b.x, b.y, b.z]
    const m = [B[0] - A[0], B[1] - A[1], B[2] - A[2]]
    const ma = m[0] * w[0] + m[1] * w[1] + m[2] * w[2]
    const ml = [m[0] - ma * w[0], m[1] - ma * w[1], m[2] - ma * w[2]]
    const lat = Math.hypot(ml[0], ml[1], ml[2])
    if (lat <= 1e-7) {
      // along the tool (or standing): the tool at its lower end, lengthened by the move (an outline
      // tool keeps its widest radius over the move, then its part above that)
      const H = cutter.flute && cutter.flute > 0 ? cutter.flute : this.diag + 1
      this.stamp(ma < 0 ? B : A, w, cutter.profile ? toolPieces({ ...cutter, profile: sweptOutline(cutter.profile, Math.abs(ma)) }, H + Math.abs(ma)) : lengthened(ps, Math.abs(ma)))
      this.last = null
      return
    }
    // (the start was stamped already when the last move ended there with the same tool)
    const again = !!this.last && sameCutter(this.last.cutter, cutter) && sameV(this.last.p, A) && sameV(this.last.w, w)
    if (Math.abs(ma) <= 1e-7) {
      if (!again) this.stamp(A, w, ps)
      this.stamp(B, w, ps)
      this.prism(A, w, [ml[0] / lat, ml[1] / lat, ml[2] / lat], lat, ps)
    } else {
      // a ramp: the tool standing at points a quarter cell apart
      const n = Math.max(1, Math.ceil(Math.hypot(m[0], m[1], m[2]) / (this.cell / 4)))
      for (let q = again ? 1 : 0; q <= n; q++) this.stamp([A[0] + (m[0] * q) / n, A[1] + (m[1] * q) / n, A[2] + (m[2] * q) / n], w, ps)
    }
    this.last = { cutter, p: B, w }
  }

  /** Where the last carve left the tool (its end is stamped), so the next move from there need not stamp it again. */
  private last: { cutter: Cutter; p: number[]; w: number[] } | null = null

  carveAt(p: V3, cutter: Cutter, axis?: V3) {
    this.carve(p, p, cutter, axis)
  }

  carvePoints(a: V3, b: V3): V3[] {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / (this.cell / 2)))
    const out: V3[] = []
    for (let q = 0; q <= n; q++) out.push({ x: a.x + ((b.x - a.x) * q) / n, y: a.y + ((b.y - a.y) * q) / n, z: a.z + ((b.z - a.z) * q) / n })
    return out
  }

  /** Box (part frame) round the pieces standing at P along w, swept by `m` (lateral move) when given. */
  private box(P: readonly number[], w: readonly number[], ps: readonly ToolPiece[], m?: readonly number[]) {
    const { R, H } = extent(ps)
    const lo = [0, 0, 0]
    const hi = [0, 0, 0]
    for (let k = 0; k < 3; k++) {
      const r = R * Math.sqrt(Math.max(0, 1 - w[k] * w[k]))
      const ends = [P[k], P[k] + H * w[k]]
      if (m) ends.push(P[k] + m[k], P[k] + m[k] + H * w[k])
      lo[k] = Math.min(...ends) - r - 1e-9
      hi[k] = Math.max(...ends) + r + 1e-9
    }
    return { lo, hi }
  }

  /** Every ray of every grid within the box: callback with the grid, ray index and ray origin (coordinate g = 0). */
  private forRays(lo: readonly number[], hi: readonly number[], f: (G: RayGrid, k: number, o: readonly number[]) => void) {
    const o = [0, 0, 0]
    for (const G of this.grids) {
      const c = G.cell
      const i0 = Math.max(0, Math.ceil((lo[G.ua] - G.u0) / c - 0.5))
      const i1 = Math.min(G.nu - 1, Math.floor((hi[G.ua] - G.u0) / c - 0.5))
      const j0 = Math.max(0, Math.ceil((lo[G.va] - G.v0) / c - 0.5))
      const j1 = Math.min(G.nv - 1, Math.floor((hi[G.va] - G.v0) / c - 0.5))
      o[G.g] = 0
      for (let j = j0; j <= j1; j++) {
        o[G.va] = G.v0 + (j + 0.5) * c
        for (let i = i0; i <= i1; i++) {
          o[G.ua] = G.u0 + (i + 0.5) * c
          f(G, j * G.nu + i, o)
        }
      }
    }
  }

  private changed(G: RayGrid, k: number) {
    if (G.g === 2) this.refreshTop(k, k + 1)
  }

  /** The tool standing with its tip at P along w. */
  private stamp(P: readonly number[], w: readonly number[], ps: readonly ToolPiece[]) {
    const { lo, hi } = this.box(P, w, ps)
    this.mark(lo[0], lo[1], hi[0], hi[1], lo[2] <= -this.thickness + 1e-6)
    const { R, H } = extent(ps)
    const out: number[] = []
    this.forRays(lo, hi, (G, k, o) => {
      if (!G.touches(k, lo[G.g], hi[G.g])) return
      // the ray passes further than R from the tool's axis: nothing (seen along the ray, 2D)
      if (segDist2(o[G.ua] - P[G.ua], o[G.va] - P[G.va], H * w[G.ua], H * w[G.va]) > (R + 1e-9) ** 2) return
      out.length = 0
      standingRay(G.g, o, P, w, ps, lo[G.g], hi[G.g], out)
      let any = false
      for (let q = 0; q < out.length; q += 2) any = G.remove(k, out[q], out[q + 1]) || any
      if (any) this.changed(G, k)
    })
  }

  /**
   * How far material reaches into the pieces standing with their tip at P along w (collision
   * checks): the deepest point of material inside them, measured square to the axis or to their
   * bottom or top, whichever is nearer; -Infinity when none is inside.
   */
  probe(P: V3, axis: V3, ps: readonly ToolPiece[]): { depth: number; at: [number, number, number] | null } {
    const w = unit(axis)
    const T: number[] = [P.x, P.y, P.z]
    const all = ps
    ps = clipToBox(T, w, ps, this.bounds(), this.cell)
    if (!ps.length) return { depth: -Infinity, at: null }
    const box = this.box(T, w, ps)
    const lo = box.lo.map((v, k) => Math.max(v, this.bounds().min[k] - this.cell))
    const hi = box.hi.map((v, k) => Math.min(v, this.bounds().max[k] + this.cell))
    if (lo.some((v, k) => v > hi[k])) return { depth: -Infinity, at: null }
    let hmin = Infinity
    let hmax = -Infinity
    for (const p of all) {
      const h = p.k === 'corner' ? [0, p.rc] : [p.h0, p.h1]
      hmin = Math.min(hmin, h[0])
      hmax = Math.max(hmax, h[1])
    }
    const pen = (q: readonly number[]) => {
      const d = [q[0] - T[0], q[1] - T[1], q[2] - T[2]]
      const h = d[0] * w[0] + d[1] * w[1] + d[2] * w[2]
      const rho = Math.hypot(d[0] - h * w[0], d[1] - h * w[1], d[2] - h * w[2])
      let r = -Infinity
      for (const p of all) r = Math.max(r, pieceRadius(p, h))
      return Math.min(r - rho, h - hmin, hmax - h)
    }
    let depth = -Infinity
    let at: [number, number, number] | null = null
    const out: number[] = []
    const p = [0, 0, 0]
    this.forRays(lo, hi, (G, k, o) => {
      if (!G.touches(k, lo[G.g], hi[G.g])) return
      out.length = 0
      standingRay(G.g, o, T, w, ps, lo[G.g], hi[G.g], out)
      for (let q = 0; q < out.length; q += 2)
        for (let m = 0; m < G.cnt[k]; m++) {
          const a = Math.max(out[q], G.iv[(k * G.max + m) * 2])
          const b = Math.min(out[q + 1], G.iv[(k * G.max + m) * 2 + 1])
          if (!(b > a)) continue
          for (let n = 0; n <= 4; n++) {
            p[0] = o[0]
            p[1] = o[1]
            p[2] = o[2]
            p[G.g] = a + ((b - a) * n) / 4
            const v = pen(p)
            if (v > depth) {
              depth = v
              at = [p[0], p[1], p[2]]
            }
          }
        }
    })
    return { depth, at }
  }

  /** Between the ends of a move square to the tool: each piece's cross-section pushed from A along unit `mu` for `Lm`. */
  private prism(A: readonly number[], w: readonly number[], mu: readonly number[], Lm: number, ps: readonly ToolPiece[]) {
    const nu = [w[1] * mu[2] - w[2] * mu[1], w[2] * mu[0] - w[0] * mu[2], w[0] * mu[1] - w[1] * mu[0]]
    const { lo, hi } = this.box(A, w, ps, [mu[0] * Lm, mu[1] * Lm, mu[2] * Lm])
    this.mark(lo[0], lo[1], hi[0], hi[1], lo[2] <= -this.thickness + 1e-6)
    const { R, H } = extent(ps)
    const out: number[] = []
    this.forRays(lo, hi, (G, k, o) => {
      const g = G.g
      if (!G.touches(k, lo[g], hi[g])) return
      // further than R from every axis position the move passes (a parallelogram, seen along the ray)
      if (paraDist2(o[G.ua] - A[G.ua], o[G.va] - A[G.va], H * w[G.ua], H * w[G.va], Lm * mu[G.ua], Lm * mu[G.va]) > (R + 1e-9) ** 2) return
      const d0x = o[0] - A[0]
      const d0y = o[1] - A[1]
      const d0z = o[2] - A[2]
      const A0 = d0x * mu[0] + d0y * mu[1] + d0z * mu[2]
      const B0 = d0x * nu[0] + d0y * nu[1] + d0z * nu[2]
      const H0 = d0x * w[0] + d0y * w[1] + d0z * w[2]
      const Ad = mu[g]
      const Bd = nu[g]
      const Hd = w[g]
      // along the move: 0 <= α <= Lm
      if (!slab(A0, Ad, 0, Lm, lo[g], hi[g])) return
      const al0 = RG.a
      const al1 = RG.b
      out.length = 0
      for (const p of ps) {
        if (p.k === 'frustum') {
          if (!slab(H0, Hd, p.h0, p.h1, al0, al1)) continue
          const beta = p.h1 - p.h0 > 1e-12 ? (p.r1 - p.r0) / (p.h1 - p.h0) : 0
          const ra = p.r0 + beta * (H0 - p.h0)
          const rb = beta * Hd
          // |β| <= radius: radius - β >= 0 and radius + β >= 0
          if (halfLine(ra - B0, rb - Bd, RG.a, RG.b) && halfLine(ra + B0, rb + Bd, RG.a, RG.b)) out.push(RG.a, RG.b)
        } else if (p.k === 'sphere') {
          if (!slab(H0, Hd, p.h0, p.h1, al0, al1)) continue
          const h = H0 - p.c
          quadLE(Bd * Bd + Hd * Hd, 2 * (B0 * Bd + h * Hd), B0 * B0 + h * h - p.R * p.R, RG.a, RG.b, out)
        } else {
          if (!slab(H0, Hd, 0, p.rc, al0, al1)) continue
          const s0 = RG.a
          const s1 = RG.b
          if (halfLine(p.a - B0, -Bd, s0, s1) && halfLine(p.a + B0, Bd, RG.a, RG.b)) out.push(RG.a, RG.b)
          const h = H0 - p.rc
          for (const side of [p.a, -p.a]) {
            const b = B0 - side
            quadLE(Bd * Bd + Hd * Hd, 2 * (b * Bd + h * Hd), b * b + h * h - p.rc * p.rc, s0, s1, out)
          }
        }
      }
      let any = false
      for (let q = 0; q < out.length; q += 2) any = G.remove(k, out[q], out[q + 1]) || any
      if (any) this.changed(G, k)
    })
  }

  // -------------------------------------------------------------------------------------------
  // Queries (from the Z rays, as the dexel stock)
  // -------------------------------------------------------------------------------------------

  private zcol(k: number): [number, number][] {
    return this.grids[2].intervals(k)
  }

  intrusion(x: number, y: number, rMax: number, lowest: (d: number) => number) {
    let depth = -Infinity
    let at = 0
    const Z = this.grids[2]
    const c = this.cell
    for (let j = Math.max(0, Math.floor((y - rMax) / c)); j <= Math.min(this.ny - 1, Math.floor((y + rMax) / c)); j++)
      for (let i = Math.max(0, Math.floor((x - rMax) / c)); i <= Math.min(this.nx - 1, Math.floor((x + rMax) / c)); i++) {
        const d = Math.hypot((i + 0.5) * c - x, (j + 0.5) * c - y)
        if (d > rMax) continue
        const k = j * this.nx + i
        const n = Z.cnt[k]
        if (!n) continue
        const top = Z.iv[(k * Z.max + n - 1) * 2 + 1]
        const e = top - lowest(d)
        if (e > depth) {
          depth = e
          at = d
        }
      }
    return { depth, d: at }
  }

  heightAt(x: number, y: number) {
    const i = Math.floor(x / this.cell)
    const j = Math.floor(y / this.cell)
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return NaN
    return this.hf.top[j * this.nx + i]
  }

  /** Is the point inside the material? (The nearest ray of each grid; true when most of them say so.) */
  occupied(x: number, y: number, z: number) {
    const p = [x, y, z]
    let votes = 0
    for (const G of this.grids) {
      const i = Math.floor((p[G.ua] - G.u0) / G.cell)
      const j = Math.floor((p[G.va] - G.v0) / G.cell)
      if (i < 0 || j < 0 || i >= G.nu || j >= G.nv) continue
      const k = j * G.nu + i
      const s = p[G.g]
      for (let q = 0; q < G.cnt[k]; q++)
        if (s >= G.iv[(k * G.max + q) * 2] && s <= G.iv[(k * G.max + q) * 2 + 1]) {
          votes++
          break
        }
    }
    return votes >= 2
  }

  maxInDisc(x: number, y: number, r: number) {
    let best = -Infinity
    const c = this.cell
    const Z = this.grids[2]
    for (let j = Math.max(0, Math.floor((y - r) / c)); j <= Math.min(this.ny - 1, Math.floor((y + r) / c)); j++)
      for (let i = Math.max(0, Math.floor((x - r) / c)); i <= Math.min(this.nx - 1, Math.floor((x + r) / c)); i++) {
        if (Math.hypot((i + 0.5) * c - x, (j + 0.5) * c - y) > r) continue
        const k = j * this.nx + i
        if (Z.cnt[k] && this.hf.top[k] > best) best = this.hf.top[k]
      }
    return best
  }

  private cellArea(i: number, j: number) {
    const w = Math.min(this.cell, this.length - i * this.cell)
    const h = Math.min(this.cell, this.width - j * this.cell)
    return Math.max(0, w) * Math.max(0, h)
  }

  /** Volume of the material left (Z rays). */
  volume() {
    const Z = this.grids[2]
    let v = 0
    for (let j = 0; j < this.ny; j++)
      for (let i = 0; i < this.nx; i++) {
        const k = j * this.nx + i
        let left = 0
        for (let q = 0; q < Z.cnt[k]; q++) left += Z.iv[(k * Z.max + q) * 2 + 1] - Z.iv[(k * Z.max + q) * 2]
        v += left * this.cellArea(i, j)
      }
    return v
  }

  removedVolume() {
    const Z = this.grids[2]
    let v0 = 0
    for (let j = 0; j < this.ny; j++)
      for (let i = 0; i < this.nx; i++) {
        const k = j * this.nx + i
        v0 += Math.max(0, Z.orig[k * 2 + 1] - Z.orig[k * 2]) * this.cellArea(i, j)
      }
    return v0 - this.volume()
  }

  toMesh(limit: { i1?: number; j1?: number } = {}): Mesh {
    return columnsMesh({ nx: this.nx, ny: this.ny, cell: this.cell, length: this.length, width: this.width }, (k) => this.zcol(k), limit)
  }

  /**
   * Points on cut surfaces: every ray end that is not where the uncut material ended (part
   * frame), with the grid it came from. For measuring what a program cut.
   */
  cutPoints(filter?: (p: [number, number, number]) => boolean): { p: [number, number, number]; g: 0 | 1 | 2 }[] {
    const out: { p: [number, number, number]; g: 0 | 1 | 2 }[] = []
    for (const G of this.grids)
      for (let jv = 0; jv < G.nv; jv++)
        for (let iu = 0; iu < G.nu; iu++) {
          const k = jv * G.nu + iu
          const lo = G.orig[k * 2]
          const hi = G.orig[k * 2 + 1]
          for (let q = 0; q < G.cnt[k]; q++)
            for (const s of [G.iv[(k * G.max + q) * 2], G.iv[(k * G.max + q) * 2 + 1]]) {
              if (Math.abs(s - lo) < 1e-5 || Math.abs(s - hi) < 1e-5) continue
              const p: [number, number, number] = [0, 0, 0]
              p[G.ua] = G.u0 + (iu + 0.5) * G.cell
              p[G.va] = G.v0 + (jv + 0.5) * G.cell
              p[G.g] = s
              if (!filter || filter(p)) out.push({ p, g: G.g })
            }
        }
    return out
  }

  /** Intervals merged because a ray had too many pieces (shows a little cut material as still there). */
  get overflow() {
    return this.grids[0].overflow + this.grids[1].overflow + this.grids[2].overflow
  }

  reset() {
    this.last = null
    for (const G of this.grids) G.reset()
    this.refreshTop()
    this.dirty = { minX: 0, minY: 0, maxX: this.length, maxY: this.width, through: true }
  }

  takeDirty() {
    const d = this.dirty
    this.dirty = null
    return d
  }

  snapshot(): StockSnapshot {
    let n = 0
    for (const G of this.grids) n += G.iv.length + G.cnt.length
    const data = new Float32Array(n)
    let at = 0
    for (const G of this.grids) {
      data.set(G.iv, at)
      at += G.iv.length
      for (let k = 0; k < G.cnt.length; k++) data[at + k] = G.cnt[k]
      at += G.cnt.length
    }
    return { kind: 'tridexel', data }
  }

  restore(s: StockSnapshot) {
    let n = 0
    for (const G of this.grids) n += G.iv.length + G.cnt.length
    if (s.kind !== 'tridexel' || s.data.length !== n) throw new Error('Snapshot is from a different stock.')
    this.last = null
    let at = 0
    for (const G of this.grids) {
      G.iv.set(s.data.subarray(at, at + G.iv.length))
      at += G.iv.length
      for (let k = 0; k < G.cnt.length; k++) G.cnt[k] = s.data[at + k]
      at += G.cnt.length
    }
    this.refreshTop()
    this.dirty = { minX: 0, minY: 0, maxX: this.length, maxY: this.width, through: true }
  }
}

/**
 * The pieces cut down to the heights where they can reach the box (grown by `pad`): where the
 * tool's axis line is within the box grown by the piece's radius. Keeps collision probes local.
 */
function clipToBox(P: readonly number[], w: readonly number[], ps: readonly ToolPiece[], b: Box3, pad: number): ToolPiece[] {
  const { R } = extent(ps)
  let h0 = -Infinity
  let h1 = Infinity
  for (let k = 0; k < 3; k++) {
    const lo = b.min[k] - R - pad
    const hi = b.max[k] + R + pad
    if (Math.abs(w[k]) < 1e-12) {
      if (P[k] < lo || P[k] > hi) return []
      continue
    }
    let a = (lo - P[k]) / w[k]
    let c = (hi - P[k]) / w[k]
    if (a > c) [a, c] = [c, a]
    h0 = Math.max(h0, a)
    h1 = Math.min(h1, c)
  }
  if (!(h1 > h0)) return []
  const out: ToolPiece[] = []
  for (const p of ps) {
    if (p.k === 'frustum') {
      const a = Math.max(p.h0, h0)
      const c = Math.min(p.h1, h1)
      if (!(c > a)) continue
      const r = (h: number) => (p.h1 - p.h0 > 1e-12 ? p.r0 + ((p.r1 - p.r0) * (h - p.h0)) / (p.h1 - p.h0) : Math.max(p.r0, p.r1))
      out.push({ k: 'frustum', h0: a, h1: c, r0: r(a), r1: r(c) })
    } else if (p.k === 'sphere') {
      const a = Math.max(p.h0, h0)
      const c = Math.min(p.h1, h1)
      if (c > a) out.push({ ...p, h0: a, h1: c })
    } else if (p.rc > h0 && 0 < h1) out.push(p)
  }
  return out
}

const sameV = (a: readonly number[], b: readonly number[]) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
const sameCutter = (a: Cutter, b: Cutter) => a === b || (a.r === b.r && a.shape === b.shape && a.angle === b.angle && a.cornerRadius === b.cornerRadius && a.flute === b.flute && a.profile === b.profile)

/** Squared distance from (px, py) to the segment from 0 to (dx, dy). */
function segDist2(px: number, py: number, dx: number, dy: number): number {
  const l2 = dx * dx + dy * dy
  const t = l2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / l2)) : 0
  const x = px - t * dx
  const y = py - t * dy
  return x * x + y * y
}

/** Squared distance from (px, py) to the parallelogram 0 + s·a + t·b (s, t in [0, 1]); 0 inside. */
function paraDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const det = ax * by - ay * bx
  if (Math.abs(det) > 1e-12) {
    const s = (px * by - py * bx) / det
    const t = (ax * py - ay * px) / det
    if (s >= 0 && s <= 1 && t >= 0 && t <= 1) return 0
  }
  return Math.min(segDist2(px, py, ax, ay), segDist2(px - bx, py - by, ax, ay), segDist2(px, py, bx, by), segDist2(px - ax, py - ay, bx, by))
}

/** A piece's radius at height h above the tip (-Infinity outside it). */
function pieceRadius(p: ToolPiece, h: number): number {
  if (p.k === 'frustum') {
    if (h < p.h0 - 1e-12 || h > p.h1 + 1e-12) return -Infinity
    return p.h1 - p.h0 > 1e-12 ? p.r0 + ((p.r1 - p.r0) * (h - p.h0)) / (p.h1 - p.h0) : Math.max(p.r0, p.r1)
  }
  if (p.k === 'sphere') return h < p.h0 - 1e-12 || h > p.h1 + 1e-12 ? -Infinity : Math.sqrt(Math.max(0, p.R * p.R - (h - p.c) ** 2))
  return h < -1e-12 || h > p.rc + 1e-12 ? -Infinity : p.a + Math.sqrt(Math.max(0, p.rc * p.rc - (h - p.rc) ** 2))
}

/**
 * Where the ray along axis g through o (its coordinate g at 0) meets the pieces standing with
 * their tip at P along unit w, within [slo, shi]: [lo, hi] pairs pushed to `out` (they may overlap).
 */
function standingRay(g: number, o: readonly number[], P: readonly number[], w: readonly number[], ps: readonly ToolPiece[], slo: number, shi: number, out: number[]) {
  const d0x = o[0] - P[0]
  const d0y = o[1] - P[1]
  const d0z = o[2] - P[2]
  const d0g = g === 0 ? d0x : g === 1 ? d0y : d0z
  const H0 = d0x * w[0] + d0y * w[1] + d0z * w[2]
  const hd = w[g]
  const dd = d0x * d0x + d0y * d0y + d0z * d0z
  const L0sq = dd - H0 * H0
  const LdL0 = d0g - H0 * hd
  const Ldsq = 1 - hd * hd
  for (const p of ps) {
    if (p.k === 'frustum') {
      if (!slab(H0, hd, p.h0, p.h1, slo, shi)) continue
      const beta = p.h1 - p.h0 > 1e-12 ? (p.r1 - p.r0) / (p.h1 - p.h0) : 0
      const ra = p.r0 + beta * (H0 - p.h0)
      const rb = beta * hd
      quadLE(Ldsq - rb * rb, 2 * (LdL0 - ra * rb), L0sq - ra * ra, RG.a, RG.b, out)
    } else if (p.k === 'sphere') {
      if (!slab(H0, hd, p.h0, p.h1, slo, shi)) continue
      // |d0 - c·w + s·e|² <= R²
      const d1g = d0g - p.c * w[g]
      const d1sq = dd - 2 * p.c * H0 + p.c * p.c
      quadLE(1, 2 * d1g, d1sq - p.R * p.R, RG.a, RG.b, out)
    } else {
      if (!slab(H0, hd, 0, p.rc, slo, shi)) continue
      const s0 = RG.a
      const s1 = RG.b
      const f = (s: number) => Math.sqrt(Math.max(0, L0sq + 2 * s * LdL0 + s * s * Ldsq)) - (p.a + Math.sqrt(Math.max(0, p.rc * p.rc - (H0 + s * hd - p.rc) ** 2)))
      const mn = convexMin(f, s0, s1)
      if (mn.v <= 0) out.push(...convexInside(f, s0, s1, mn.s))
    }
  }
}

function unit(v: V3): [number, number, number] {
  const l = Math.hypot(v.x, v.y, v.z)
  return l > 0 ? [v.x / l, v.y / l, v.z / l] : [0, 0, 1]
}

/** A cell for a tri-dexel stock of this block: 0.25 mm, coarser for big blocks (at most about 2 million rays). */
export function tridexelCell(length: number, width: number, thickness: number): number {
  for (const c of [0.25, 0.5, 1, 2, 4]) {
    const nx = Math.ceil(length / c)
    const ny = Math.ceil(width / c)
    const nz = Math.ceil(thickness / c)
    if (nx * ny + ny * nz + nx * nz <= 2e6) return c
  }
  return 8
}
