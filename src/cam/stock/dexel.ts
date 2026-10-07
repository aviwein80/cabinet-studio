/**
 * Dexel stock: per square cell, the material as a short list of intervals in Z (a column can hold
 * material above an empty pocket, e.g. the lip over an undercut). Exact for any tool whose swept
 * shape meets a vertical line in one piece per part: a vertical tool (cut from its bottom up), and
 * a lollipop (its ball's swept capsule, plus its neck from the ball's centre up). Behind the same
 * `StockModel` interface as the heightfield; later stages carve tilted tools into it too.
 *
 * It keeps a heightfield of its top surface (`hf`) up to date, so everything that reads the
 * heightfield from above (top view, cut summaries, cut-free pieces) works unchanged.
 */
import type { Box3, Mesh } from '../mesh/types'
import { createHeightfield, type Cutter, cutterZ, type Heightfield, THREAD_FLANK, type V3 } from '../sim'
import type { StockModel, StockSnapshot } from './types'

/** Intervals a column can hold by default; more are merged (the smallest gap filled, never showing cut material as gone). */
export const DEXEL_MAX = 6

export class DexelStock implements StockModel {
  readonly kind = 'dexel' as const
  readonly hf: Heightfield
  readonly nx: number
  readonly ny: number
  readonly cell: number
  readonly thickness: number
  /** Intervals a column can hold (a thread's grooves need one per turn). */
  readonly max: number
  /** Intervals per column: [lo, hi] pairs, sorted, `max` per column. */
  private readonly iv: Float32Array
  private readonly cnt: Uint8Array
  /** Columns where intervals had to be merged. */
  overflow = 0
  private dirty: { minX: number; minY: number; maxX: number; maxY: number; through: boolean } | null = null

  constructor(length: number, width: number, thickness: number, cell?: number, maxPieces = DEXEL_MAX) {
    this.hf = createHeightfield(length, width, thickness, cell)
    this.nx = this.hf.nx
    this.ny = this.hf.ny
    this.cell = this.hf.cell
    this.thickness = thickness
    this.max = Math.max(1, Math.min(255, Math.round(maxPieces)))
    this.iv = new Float32Array(this.nx * this.ny * this.max * 2)
    this.cnt = new Uint8Array(this.nx * this.ny)
    this.reset()
    this.dirty = null
  }

  /**
   * Make the stock the shape of a closed mesh (part coordinates): each column takes the stretches
   * of its centre line that are inside the mesh, within the panel. For tests and part compare.
   */
  setFromMesh(mesh: Mesh) {
    const p = mesh.positions
    const ix = mesh.indices
    const nt = ix.length / 3
    // facets by the columns their plan box covers
    const lists = new Map<number, number[]>()
    for (let t = 0; t < nt; t++) {
      let mx = Infinity
      let my = Infinity
      let Mx = -Infinity
      let My = -Infinity
      for (let k = 0; k < 3; k++) {
        const v = ix[t * 3 + k] * 3
        mx = Math.min(mx, p[v])
        Mx = Math.max(Mx, p[v])
        my = Math.min(my, p[v + 1])
        My = Math.max(My, p[v + 1])
      }
      for (let j = Math.max(0, Math.floor(my / this.cell - 0.5)); j <= Math.min(this.ny - 1, Math.ceil(My / this.cell - 0.5)); j++)
        for (let i = Math.max(0, Math.floor(mx / this.cell - 0.5)); i <= Math.min(this.nx - 1, Math.ceil(Mx / this.cell - 0.5)); i++) {
          const k = j * this.nx + i
          let l = lists.get(k)
          if (!l) lists.set(k, (l = []))
          l.push(t)
        }
    }
    for (let j = 0; j < this.ny; j++)
      for (let i = 0; i < this.nx; i++) {
        const k = j * this.nx + i
        // (nudged off the cell centre so the line misses facet edges and corners)
        const px = (i + 0.5) * this.cell + 1.234e-7
        const py = (j + 0.5) * this.cell + 2.345e-7
        const zs: number[] = []
        for (const t of lists.get(k) ?? []) {
          const a = ix[t * 3] * 3
          const b = ix[t * 3 + 1] * 3
          const c = ix[t * 3 + 2] * 3
          const d1 = (p[b] - p[a]) * (py - p[a + 1]) - (p[b + 1] - p[a + 1]) * (px - p[a])
          const d2 = (p[c] - p[b]) * (py - p[b + 1]) - (p[c + 1] - p[b + 1]) * (px - p[b])
          const d3 = (p[a] - p[c]) * (py - p[c + 1]) - (p[a + 1] - p[c + 1]) * (px - p[c])
          if (!((d1 > 0 && d2 > 0 && d3 > 0) || (d1 < 0 && d2 < 0 && d3 < 0))) continue
          const area = d1 + d2 + d3
          zs.push((d2 * p[a + 2] + d3 * p[b + 2] + d1 * p[c + 2]) / area)
        }
        zs.sort((u, v) => u - v)
        const out: number[] = []
        for (let q = 0; q + 1 < zs.length && out.length / 2 < this.max; q += 2) {
          const lo = Math.max(-this.thickness, zs[q])
          const hi = Math.min(0, zs[q + 1])
          if (hi - lo > 1e-6) out.push(lo, hi)
        }
        this.iv.set(out, k * this.max * 2)
        this.cnt[k] = out.length / 2
        this.hf.top[k] = this.cnt[k] ? out[out.length - 1] : -this.thickness
      }
    this.dirty = { minX: 0, minY: 0, maxX: this.hf.length, maxY: this.hf.width, through: true }
  }

  bounds(): Box3 {
    return { min: [0, 0, -this.thickness], max: [this.hf.length, this.hf.width, 0] }
  }

  /** The intervals of column k (copies). */
  column(k: number): [number, number][] {
    const out: [number, number][] = []
    for (let q = 0; q < this.cnt[k]; q++) out.push([this.iv[(k * this.max + q) * 2], this.iv[(k * this.max + q) * 2 + 1]])
    return out
  }

  /** Remove [lo, hi] from column k. */
  private remove(k: number, lo: number, hi: number) {
    const n = this.cnt[k]
    if (!n || hi <= lo) return
    const base = k * this.max * 2
    const out: number[] = []
    let changed = false
    for (let q = 0; q < n; q++) {
      const a = this.iv[base + q * 2]
      const b = this.iv[base + q * 2 + 1]
      if (hi <= a || lo >= b) {
        out.push(a, b)
        continue
      }
      changed = true
      if (lo > a) out.push(a, lo)
      if (hi < b) out.push(hi, b)
    }
    if (!changed) return
    // too many pieces: fill the smallest gaps (shows material, never hides it)
    while (out.length / 2 > this.max) {
      let best = 1
      let gap = Infinity
      for (let q = 1; q < out.length / 2; q++) {
        const g = out[q * 2] - out[q * 2 - 1]
        if (g < gap) {
          gap = g
          best = q
        }
      }
      out.splice(best * 2 - 1, 2)
      this.overflow++
    }
    // drop slivers left by rounding
    const kept: number[] = []
    for (let q = 0; q < out.length; q += 2) if (out[q + 1] - out[q] > 1e-5) kept.push(out[q], out[q + 1])
    this.iv.set(kept, base)
    this.cnt[k] = kept.length / 2
    this.hf.top[k] = this.cnt[k] ? kept[kept.length - 1] : -this.thickness
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

  /** Columns within r of the plan segment a -> b: index, centre, and the closest point's parameter. */
  private forColumns(a: V3, b: V3, r: number, f: (k: number, px: number, py: number, t: number, d: number) => void) {
    const c = this.cell
    const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - r) / c))
    const i1 = Math.min(this.nx - 1, Math.floor((Math.max(a.x, b.x) + r) / c))
    const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - r) / c))
    const j1 = Math.min(this.ny - 1, Math.floor((Math.max(a.y, b.y) + r) / c))
    const dx = b.x - a.x
    const dy = b.y - a.y
    const l2 = dx * dx + dy * dy
    for (let j = j0; j <= j1; j++) {
      const py = (j + 0.5) * c
      for (let i = i0; i <= i1; i++) {
        const px = (i + 0.5) * c
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2)) : 0
        const d = Math.hypot(a.x + dx * t - px, a.y + dy * t - py)
        if (d <= r + 1e-9) f(j * this.nx + i, px, py, t, d)
      }
    }
  }

  carve(a: V3, b: V3, cutter: Cutter) {
    if (Math.min(a.z, b.z) >= 0 && cutter.shape !== 'lollipop') return
    const r = cutter.r
    this.mark(Math.min(a.x, b.x) - r, Math.min(a.y, b.y) - r, Math.max(a.x, b.x) + r, Math.max(a.y, b.y) + r, Math.min(a.z, b.z) <= -this.thickness + 1e-6)
    if (cutter.shape === 'lollipop') {
      this.carveLollipop(a, b, cutter)
      return
    }
    if (cutter.shape === 'thread') {
      this.carveThread(a, b, cutter)
      return
    }
    // a vertical tool takes everything from its bottom up: the lowest bottom over the move
    if (Math.abs(a.z - b.z) < 1e-9) {
      this.forColumns(a, b, r, (k, _px, _py, _t, d) => this.remove(k, Math.max(-this.thickness, cutterZ(cutter, a.z, d)), Infinity))
      return
    }
    for (const p of this.carvePoints(a, b)) this.forColumns(p, p, r, (k, _px, _py, _t, d) => this.remove(k, Math.max(-this.thickness, cutterZ(cutter, p.z, d)), Infinity))
  }

  /** The ball's swept capsule (centre r above the tip) and the neck from the ball's centre up. */
  private carveLollipop(a: V3, b: V3, c: Cutter) {
    const R = c.r
    const neck = Math.min(R, c.neck ?? R)
    const A = { x: a.x, y: a.y, z: a.z + R }
    const B = { x: b.x, y: b.y, z: b.z + R }
    const dx = B.x - A.x
    const dy = B.y - A.y
    const dz = B.z - A.z
    const L = Math.hypot(dx, dy, dz)
    this.forColumns(a, b, R, (k, px, py) => {
      // the vertical line through the column against the capsule: spheres at the ends and the
      // cylinder between (one interval: the capsule is convex)
      let lo = Infinity
      let hi = -Infinity
      for (const P of [A, B]) {
        const d2 = (px - P.x) ** 2 + (py - P.y) ** 2
        if (d2 < R * R) {
          const h = Math.sqrt(R * R - d2)
          lo = Math.min(lo, P.z - h)
          hi = Math.max(hi, P.z + h)
        }
      }
      if (L > 1e-12) {
        const ux = dx / L
        const uy = dy / L
        const uz = dz / L
        const wx = px - A.x
        const wy = py - A.y
        const a0 = wx * ux + wy * uy
        const qa = 1 - uz * uz
        const qb = -2 * a0 * uz
        const qc = wx * wx + wy * wy - a0 * a0 - R * R
        let s0 = -Infinity
        let s1 = Infinity
        let ok = true
        if (qa < 1e-12) ok = qc < 0
        else {
          const disc = qb * qb - 4 * qa * qc
          if (disc <= 0) ok = false
          else {
            s0 = (-qb - Math.sqrt(disc)) / (2 * qa)
            s1 = (-qb + Math.sqrt(disc)) / (2 * qa)
          }
        }
        if (ok) {
          if (Math.abs(uz) < 1e-12) ok = a0 >= 0 && a0 <= L
          else {
            const e0 = -a0 / uz
            const e1 = (L - a0) / uz
            s0 = Math.max(s0, Math.min(e0, e1))
            s1 = Math.min(s1, Math.max(e0, e1))
            ok = s1 > s0
          }
        }
        if (ok) {
          lo = Math.min(lo, A.z + s0)
          hi = Math.max(hi, A.z + s1)
        }
      }
      if (hi > lo) this.remove(k, lo, hi)
    })
    // the neck: everything from the lowest centre over the part of the move within its radius up
    this.forColumns(a, b, neck, (k, px, py) => {
      // the stretch of the move whose axis passes within `neck` of the column: its ends
      const ex = b.x - a.x
      const ey = b.y - a.y
      const l2 = ex * ex + ey * ey
      let zMin: number
      if (l2 < 1e-18) zMin = Math.min(A.z, B.z)
      else {
        const t = ((px - a.x) * ex + (py - a.y) * ey) / l2
        const d2 = (a.x + ex * t - px) ** 2 + (a.y + ey * t - py) ** 2
        const half = Math.sqrt(Math.max(0, neck * neck - d2) / l2)
        const t0 = Math.max(0, t - half)
        const t1 = Math.min(1, t + half)
        zMin = Math.min(A.z + dz * t0, A.z + dz * t1)
      }
      this.remove(k, zMin, Infinity)
    })
  }

  /**
   * A thread mill: a 60° tooth (tip at the tool's radius, at the move's height) on a neck. Along a
   * short move the tooth's cut in each column is one piece: from the lowest lower flank to the
   * highest upper flank over the positions where it reaches the column; within the neck's radius,
   * everything from the tooth's base up.
   */
  private carveThread(a: V3, b: V3, c: Cutter) {
    const R = c.r
    const neck = Math.min(R, c.neck ?? 0)
    const base = (R - neck) * THREAD_FLANK
    const n = Math.max(8, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (this.cell / 4)))
    this.forColumns(a, b, R, (k, px, py) => {
      let lo = Infinity
      let hi = -Infinity
      let neckLo = Infinity
      for (let q = 0; q <= n; q++) {
        const f = q / n
        const x = a.x + (b.x - a.x) * f
        const y = a.y + (b.y - a.y) * f
        const z = a.z + (b.z - a.z) * f
        const d = Math.hypot(px - x, py - y)
        if (d > R) continue
        if (d <= neck) neckLo = Math.min(neckLo, z - base)
        else {
          const w = (R - d) * THREAD_FLANK
          lo = Math.min(lo, z - w)
          hi = Math.max(hi, z + w)
        }
      }
      if (Number.isFinite(neckLo)) this.remove(k, Math.min(neckLo, lo), Infinity)
      else if (hi > lo) this.remove(k, lo, hi)
    })
  }

  carvePoints(a: V3, b: V3): V3[] {
    const step = this.cell / 2
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step))
    const out: V3[] = []
    for (let q = 0; q <= n; q++) {
      const k = q / n
      out.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k })
    }
    return out
  }

  carveAt(p: V3, cutter: Cutter) {
    this.carve(p, p, cutter)
  }

  intrusion(x: number, y: number, rMax: number, lowest: (d: number) => number) {
    let depth = -Infinity
    let at = 0
    const p = { x, y, z: 0 }
    this.forColumns(p, p, rMax, (k, _px, _py, _t, d) => {
      const n = this.cnt[k]
      if (!n) return
      const low = lowest(d)
      // material reaching above the envelope's lowest point (it occupies everything above it)
      const top = this.iv[(k * this.max + n - 1) * 2 + 1]
      if (top <= -this.thickness + 1e-6) return
      const e = top - low
      if (e > depth) {
        depth = e
        at = d
      }
    })
    return { depth, d: at }
  }

  heightAt(x: number, y: number) {
    const i = Math.floor(x / this.cell)
    const j = Math.floor(y / this.cell)
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return NaN
    return this.hf.top[j * this.nx + i]
  }

  occupied(x: number, y: number, z: number) {
    const i = Math.floor(x / this.cell)
    const j = Math.floor(y / this.cell)
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return false
    const k = j * this.nx + i
    for (let q = 0; q < this.cnt[k]; q++) if (z >= this.iv[(k * this.max + q) * 2] && z <= this.iv[(k * this.max + q) * 2 + 1]) return true
    return false
  }

  maxInDisc(x: number, y: number, r: number) {
    let best = -Infinity
    const p = { x, y, z: 0 }
    this.forColumns(p, p, r, (k) => {
      const v = this.hf.top[k]
      if (this.cnt[k] && v > best) best = v
    })
    return best
  }

  private cellArea(i: number, j: number) {
    const w = Math.min(this.cell, this.hf.length - i * this.cell)
    const h = Math.min(this.cell, this.hf.width - j * this.cell)
    return Math.max(0, w) * Math.max(0, h)
  }

  removedVolume() {
    let v = 0
    for (let j = 0; j < this.ny; j++)
      for (let i = 0; i < this.nx; i++) {
        const k = j * this.nx + i
        let left = 0
        for (let q = 0; q < this.cnt[k]; q++) left += this.iv[(k * this.max + q) * 2 + 1] - this.iv[(k * this.max + q) * 2]
        v += (this.thickness - left) * this.cellArea(i, j)
      }
    return v
  }

  /**
   * Closed mesh of the material: per interval a top and a bottom square, and walls wherever a
   * column holds material its neighbour does not (the stock's edges included). Blocky (one cell),
   * but it shows material under an overhang, which a heightfield cannot.
   */
  toMesh(limit: { i1?: number; j1?: number } = {}): Mesh {
    return columnsMesh({ nx: this.nx, ny: this.ny, cell: this.cell, length: this.hf.length, width: this.hf.width }, (k) => this.column(k), limit)
  }

  reset() {
    for (let k = 0; k < this.nx * this.ny; k++) {
      this.iv[k * this.max * 2] = -this.thickness
      this.iv[k * this.max * 2 + 1] = 0
      this.cnt[k] = 1
    }
    this.hf.top.fill(0)
    this.overflow = 0
    this.dirty = { minX: 0, minY: 0, maxX: this.hf.length, maxY: this.hf.width, through: true }
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
    return { kind: 'dexel', data }
  }

  restore(s: StockSnapshot) {
    if (s.kind !== 'dexel' || s.data.length !== this.iv.length + this.cnt.length) throw new Error('Snapshot is from a different stock.')
    this.iv.set(s.data.subarray(0, this.iv.length))
    for (let k = 0; k < this.cnt.length; k++) {
      this.cnt[k] = s.data[this.iv.length + k]
      this.hf.top[k] = this.cnt[k] ? this.iv[(k * this.max + this.cnt[k] - 1) * 2 + 1] : -this.thickness
    }
    this.dirty = { minX: 0, minY: 0, maxX: this.hf.length, maxY: this.hf.width, through: true }
  }
}

/**
 * Closed mesh of columns of material (dexel stocks): per interval a top and a bottom square, and
 * walls wherever a column holds material its neighbour does not (the stock's edges included).
 * Blocky (one cell), but it shows material under an overhang, which a heightfield cannot.
 * `limit`: a section, only the columns before i1 / j1, with their walls on the cut.
 */
export function columnsMesh(g: { nx: number; ny: number; cell: number; length: number; width: number }, column: (k: number) => [number, number][], limit: { i1?: number; j1?: number } = {}): Mesh {
  const pos: number[] = []
  const quad = (a: number[], b: number[], c: number[], d: number[]) => pos.push(...a, ...b, ...c, ...a, ...c, ...d)
  const c = g.cell
  const X = (i: number) => Math.min(i * c, g.length)
  const Y = (j: number) => Math.min(j * c, g.width)
  // (a section: only the columns before i1 / j1, with their walls on the cut)
  const ni = Math.min(g.nx, limit.i1 ?? g.nx)
  const nj = Math.min(g.ny, limit.j1 ?? g.ny)
  const inside = (i: number, j: number) => i < ni && j < nj
  const col = (i: number, j: number) => (i < 0 || j < 0 || i >= g.nx || j >= g.ny || !inside(i, j) ? [] : column(j * g.nx + i))
  /** Parts of intervals `a` not covered by `b`. */
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
  for (let j = 0; j < nj; j++)
    for (let i = 0; i < ni; i++) {
      const me = col(i, j)
      if (!me.length) continue
      const x0 = X(i)
      const x1 = X(i + 1)
      const y0 = Y(j)
      const y1 = Y(j + 1)
      for (const [lo, hi] of me) {
        quad([x0, y0, hi], [x1, y0, hi], [x1, y1, hi], [x0, y1, hi])
        quad([x0, y0, lo], [x0, y1, lo], [x1, y1, lo], [x1, y0, lo])
      }
      // walls facing each neighbour where it has no material
      for (const [lo, hi] of minus(me, col(i + 1, j))) quad([x1, y0, lo], [x1, y1, lo], [x1, y1, hi], [x1, y0, hi])
      for (const [lo, hi] of minus(me, col(i - 1, j))) quad([x0, y0, lo], [x0, y0, hi], [x0, y1, hi], [x0, y1, lo])
      for (const [lo, hi] of minus(me, col(i, j + 1))) quad([x0, y1, lo], [x0, y1, hi], [x1, y1, hi], [x1, y1, lo])
      for (const [lo, hi] of minus(me, col(i, j - 1))) quad([x0, y0, lo], [x1, y0, lo], [x1, y0, hi], [x0, y0, hi])
    }
  const positions = Float32Array.from(pos)
  const indices = new Uint32Array(positions.length / 3)
  for (let q = 0; q < indices.length; q++) indices[q] = q
  return { positions, indices }
}
