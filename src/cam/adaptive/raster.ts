/**
 * Bit raster of the material still to be cut in one level of a pocket, for adaptive clearing.
 * One bit per square cell (set = material); a cell counts as covered by a shape when its centre is
 * inside it. Shapes are swept discs (capsules), handled one raster row at a time as spans, so
 * counting and clearing cost a few word operations per row.
 */
import type { P } from '../geom'

export class MaterialRaster {
  readonly h: number
  readonly x0: number
  readonly y0: number
  readonly nx: number
  readonly ny: number
  /** Words per row. */
  readonly w: number
  readonly bits: Uint32Array

  /** Raster over the box, cell size h, filled where cell centres are inside `polys` (even-odd). */
  constructor(polys: P[][], h: number) {
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
    if (!Number.isFinite(minX)) minX = minY = maxX = maxY = 0
    this.h = h
    this.x0 = minX - h
    this.y0 = minY - h
    this.nx = Math.max(1, Math.ceil((maxX - minX) / h) + 2)
    this.ny = Math.max(1, Math.ceil((maxY - minY) / h) + 2)
    this.w = Math.ceil(this.nx / 32)
    this.bits = new Uint32Array(this.w * this.ny)
    // scanline fill at each row centre
    for (let j = 0; j < this.ny; j++) {
      const y = this.cy(j)
      const xs: number[] = []
      for (const poly of polys)
        for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) {
          const a = poly[i]
          const b = poly[k]
          if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y))
        }
      xs.sort((a, b) => a - b)
      for (let q = 0; q + 1 < xs.length; q += 2) this.span(j, xs[q], xs[q + 1], true)
    }
  }

  cx(i: number) {
    return this.x0 + (i + 0.5) * this.h
  }
  cy(j: number) {
    return this.y0 + (j + 0.5) * this.h
  }

  /** Cells of row j whose centres lie in [xa, xb]: set (fill) or count/clear. */
  private range(xa: number, xb: number): [number, number] | null {
    const i0 = Math.max(0, Math.ceil((xa - this.x0) / this.h - 0.5))
    const i1 = Math.min(this.nx - 1, Math.floor((xb - this.x0) / this.h - 0.5))
    return i0 <= i1 ? [i0, i1] : null
  }

  private span(j: number, xa: number, xb: number, set: boolean, log?: number[]) {
    const r = this.range(xa, xb)
    if (!r) return
    const row = j * this.w
    for (let i = r[0]; i <= r[1]; ) {
      const wi = i >> 5
      const b0 = i & 31
      const b1 = Math.min(31, r[1] - (wi << 5))
      const mask = maskOf(b0, b1)
      const k = row + wi
      const old = this.bits[k]
      if (set) this.bits[k] |= mask
      else this.bits[k] &= ~mask
      if (log && this.bits[k] !== old) log.push(k, old)
      i = (wi + 1) << 5
    }
  }

  /** Put back the words a `clearCapsule` with this log changed. */
  undo(log: number[]) {
    for (let i = log.length - 2; i >= 0; i -= 2) this.bits[log[i]] = log[i + 1]
  }

  private countSpan(j: number, xa: number, xb: number): number {
    const r = this.range(xa, xb)
    if (!r) return 0
    const row = j * this.w
    let n = 0
    for (let i = r[0]; i <= r[1]; ) {
      const wi = i >> 5
      const b0 = i & 31
      const b1 = Math.min(31, r[1] - (wi << 5))
      n += popcount(this.bits[row + wi] & maskOf(b0, b1))
      i = (wi + 1) << 5
    }
    return n
  }

  /** Rows touched by a shape between y = lo and y = hi. */
  private rows(lo: number, hi: number): [number, number] {
    return [Math.max(0, Math.ceil((lo - this.y0) / this.h - 0.5)), Math.min(this.ny - 1, Math.floor((hi - this.y0) / this.h - 0.5))]
  }

  /** Material cells inside the disc swept from a to b with radius r. */
  countCapsule(a: P, b: P, r: number): number {
    let n = 0
    const [j0, j1] = this.rows(Math.min(a.y, b.y) - r, Math.max(a.y, b.y) + r)
    const c = new CapsuleRows(a, b, r)
    for (let j = j0; j <= j1; j++) if (c.span(this.cy(j))) n += this.countSpan(j, c.lo, c.hi)
    return n
  }

  /**
   * Material cells a step from a to b newly sweeps: the disc swept from a to b less the disc at a
   * (which must already be cut: the tool stands there). Same cells as `countCapsule` when the disc
   * at a is clear, at a fraction of the cost.
   */
  countStep(a: P, b: P, r: number): number {
    let n = 0
    const [j0, j1] = this.rows(Math.min(a.y, b.y) - r, Math.max(a.y, b.y) + r)
    const c = new CapsuleRows(a, b, r)
    for (let j = j0; j <= j1; j++) {
      const y = this.cy(j)
      if (!c.span(y)) continue
      const lo = c.lo
      const hi = c.hi
      const dy = y - a.y
      if (Math.abs(dy) <= r) {
        // less the disc at a: up to two pieces either side of it
        const w = Math.sqrt(r * r - dy * dy)
        const da = a.x - w
        const db = a.x + w
        // a cell centre on the disc's edge counts as inside it (cut by the move that reached a)
        if (lo < da) n += this.countSpan(j, lo, Math.min(hi, da - 1e-12))
        if (hi > db) n += this.countSpan(j, Math.max(lo, db + 1e-12), hi)
      } else n += this.countSpan(j, lo, hi)
    }
    return n
  }

  /** Is there any material inside the disc swept from a to b with radius r? (stops at the first) */
  anyCapsule(a: P, b: P, r: number): boolean {
    const [j0, j1] = this.rows(Math.min(a.y, b.y) - r, Math.max(a.y, b.y) + r)
    const c = new CapsuleRows(a, b, r)
    // from the middle row outwards: material is most likely near the centre line
    const mid = Math.round((j0 + j1) / 2)
    for (let k = 0; k <= j1 - j0; k++) {
      const j = k & 1 ? mid - ((k + 1) >> 1) : mid + (k >> 1)
      if (j < j0 || j > j1) continue
      if (c.span(this.cy(j)) && this.countSpan(j, c.lo, c.hi) > 0) return true
    }
    return false
  }

  /** Remove the material swept by a disc of radius r from a to b (`log`: what changed, for `undo`). */
  clearCapsule(a: P, b: P, r: number, log?: number[]) {
    const [j0, j1] = this.rows(Math.min(a.y, b.y) - r, Math.max(a.y, b.y) + r)
    const c = new CapsuleRows(a, b, r)
    for (let j = j0; j <= j1; j++) if (c.span(this.cy(j))) this.span(j, c.lo, c.hi, false, log)
  }

  /** Material cells left anywhere. */
  total(): number {
    let n = 0
    for (let k = 0; k < this.bits.length; k++) n += popcount(this.bits[k])
    return n
  }

  /** Is the cell holding (x, y) still material? */
  at(x: number, y: number): boolean {
    const i = Math.floor((x - this.x0) / this.h)
    const j = Math.floor((y - this.y0) / this.h)
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return false
    return (this.bits[j * this.w + (i >> 5)] >>> (i & 31)) & 1 ? true : false
  }
}

/** Bits b0..b1 (inclusive) of a 32-bit word. */
function maskOf(b0: number, b1: number): number {
  const hi = b1 === 31 ? 0xffffffff : (1 << (b1 + 1)) - 1
  return (hi & ~((1 << b0) - 1)) >>> 0
}

function popcount(v: number): number {
  v = v - ((v >>> 1) & 0x55555555)
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

/** Rows of one swept disc without allocations: `span(y)` sets `lo`, `hi` (false when the row misses it). */
class CapsuleRows {
  lo = 0
  hi = 0
  private readonly ax: number
  private readonly ay: number
  private readonly bx: number
  private readonly by: number
  private readonly r: number
  /** Corners of the band between the discs (a + n, b + n, b - n, a - n), or none for a point. */
  private readonly q: Float64Array | null
  constructor(a: P, b: P, r: number) {
    this.ax = a.x
    this.ay = a.y
    this.bx = b.x
    this.by = b.y
    this.r = r
    const dx = b.x - a.x
    const dy = b.y - a.y
    const L = Math.hypot(dx, dy)
    if (L > 1e-12) {
      const nx = (-dy / L) * r
      const ny = (dx / L) * r
      this.q = Float64Array.of(a.x + nx, a.y + ny, b.x + nx, b.y + ny, b.x - nx, b.y - ny, a.x - nx, a.y - ny)
    } else this.q = null
  }
  span(y: number): boolean {
    let lo = Infinity
    let hi = -Infinity
    const r = this.r
    let d = y - this.ay
    if (d <= r && d >= -r) {
      const w = Math.sqrt(r * r - d * d)
      lo = this.ax - w
      hi = this.ax + w
    }
    d = y - this.by
    if (d <= r && d >= -r) {
      const w = Math.sqrt(r * r - d * d)
      if (this.bx - w < lo) lo = this.bx - w
      if (this.bx + w > hi) hi = this.bx + w
    }
    const q = this.q
    if (q)
      for (let i = 0; i < 8; i += 2) {
        const k = (i + 2) & 7
        const y0 = q[i + 1]
        const y1 = q[k + 1]
        if ((y0 - y) * (y1 - y) > 0) continue
        let x0: number
        let x1: number
        if (Math.abs(y1 - y0) < 1e-12) {
          x0 = q[i]
          x1 = q[k]
        } else x0 = x1 = q[i] + ((y - y0) * (q[k] - q[i])) / (y1 - y0)
        if (x0 < lo) lo = x0
        if (x1 < lo) lo = x1
        if (x0 > hi) hi = x0
        if (x1 > hi) hi = x1
      }
    this.lo = lo
    this.hi = hi
    return lo <= hi
  }
}

/** The x-range where the line y = const crosses the disc of radius r swept from a to b, or null. */
export function capsuleSpan(a: P, b: P, r: number, y: number): [number, number] | null {
  let lo = Infinity
  let hi = -Infinity
  for (const c of [a, b]) {
    const dy = y - c.y
    if (Math.abs(dy) <= r) {
      const w = Math.sqrt(r * r - dy * dy)
      lo = Math.min(lo, c.x - w)
      hi = Math.max(hi, c.x + w)
    }
  }
  const dx = b.x - a.x
  const dyy = b.y - a.y
  const L = Math.hypot(dx, dyy)
  if (L > 1e-12) {
    // the band between the two discs: a parallelogram with corners a +- r n, b +- r n
    const nx = (-dyy / L) * r
    const ny = (dx / L) * r
    const q = [
      { x: a.x + nx, y: a.y + ny },
      { x: b.x + nx, y: b.y + ny },
      { x: b.x - nx, y: b.y - ny },
      { x: a.x - nx, y: a.y - ny },
    ]
    for (let i = 0; i < 4; i++) {
      const p0 = q[i]
      const p1 = q[(i + 1) % 4]
      if ((p0.y - y) * (p1.y - y) > 0) continue
      if (Math.abs(p1.y - p0.y) < 1e-12) {
        lo = Math.min(lo, p0.x, p1.x)
        hi = Math.max(hi, p0.x, p1.x)
        continue
      }
      const x = p0.x + ((y - p0.y) * (p1.x - p0.x)) / (p1.y - p0.y)
      lo = Math.min(lo, x)
      hi = Math.max(hi, x)
    }
  }
  return lo <= hi ? [lo, hi] : null
}
