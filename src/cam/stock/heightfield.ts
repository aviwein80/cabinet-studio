/**
 * Heightfield stock: one surface height per square cell. Exact for a vertical 3-axis tool (it
 * cannot undercut). It wraps the simulator's heightfield (`src/cam/sim.ts`) so the simulation and
 * the stock model share one carving routine.
 */
import type { Box3, Mesh } from '../mesh/types'
import { createHeightfield, type Cutter, type Heightfield, heightAt, stamp, type V3 } from '../sim'
import type { StockModel, StockSnapshot } from './types'

export class HeightfieldStock implements StockModel {
  readonly kind = 'heightfield' as const
  readonly hf: Heightfield
  private dirty: { minX: number; minY: number; maxX: number; maxY: number; through: boolean } | null = null

  constructor(length: number, width: number, thickness: number, cell?: number) {
    this.hf = createHeightfield(length, width, thickness, cell)
  }

  static wrap(hf: Heightfield): HeightfieldStock {
    const s = Object.create(HeightfieldStock.prototype) as HeightfieldStock
    Object.assign(s, { kind: 'heightfield', hf, dirty: null })
    return s
  }

  bounds(): Box3 {
    return { min: [0, 0, -this.hf.thickness], max: [this.hf.length, this.hf.width, 0] }
  }

  carve(a: V3, b: V3, cutter: Cutter) {
    if (Math.min(a.z, b.z) >= 0) return
    const r = cutter.r
    const through = Math.min(a.z, b.z) <= -this.hf.thickness + 1e-6
    const d = this.dirty
    if (d) {
      d.minX = Math.min(d.minX, a.x - r, b.x - r)
      d.minY = Math.min(d.minY, a.y - r, b.y - r)
      d.maxX = Math.max(d.maxX, a.x + r, b.x + r)
      d.maxY = Math.max(d.maxY, a.y + r, b.y + r)
      d.through ||= through
    } else this.dirty = { minX: Math.min(a.x, b.x) - r, minY: Math.min(a.y, b.y) - r, maxX: Math.max(a.x, b.x) + r, maxY: Math.max(a.y, b.y) + r, through }
    const step = this.hf.cell / 2
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step))
    for (let q = 0; q <= n; q++) {
      const k = q / n
      stamp(this.hf, { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k }, cutter)
    }
  }

  heightAt(x: number, y: number) {
    return heightAt(this.hf, x, y)
  }

  occupied(x: number, y: number, z: number) {
    const h = this.heightAt(x, y)
    return Number.isFinite(h) && z <= h && z >= -this.hf.thickness && h > -this.hf.thickness + 1e-6
  }

  maxInDisc(x: number, y: number, r: number) {
    const { hf } = this
    const i0 = Math.max(0, Math.floor((x - r) / hf.cell))
    const i1 = Math.min(hf.nx - 1, Math.floor((x + r) / hf.cell))
    const j0 = Math.max(0, Math.floor((y - r) / hf.cell))
    const j1 = Math.min(hf.ny - 1, Math.floor((y + r) / hf.cell))
    let best = -Infinity
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        if (Math.hypot((i + 0.5) * hf.cell - x, (j + 0.5) * hf.cell - y) > r) continue
        const v = hf.top[j * hf.nx + i]
        if (v > -hf.thickness + 1e-6 && v > best) best = v
      }
    return best
  }

  /** Cell (i, j) area clipped to the stock edges (the last row and column can be partial). */
  private cellArea(i: number, j: number) {
    const { hf } = this
    const w = Math.min(hf.cell, hf.length - i * hf.cell)
    const h = Math.min(hf.cell, hf.width - j * hf.cell)
    return Math.max(0, w) * Math.max(0, h)
  }

  removedVolume() {
    const { hf } = this
    let v = 0
    for (let j = 0; j < hf.ny; j++) for (let i = 0; i < hf.nx; i++) v += -hf.top[j * hf.nx + i] * this.cellArea(i, j)
    return v
  }

  /**
   * Closed mesh of the remaining material: a top surface through the cell corners (each corner
   * takes the lowest neighbouring cell, so the mesh never shows material that was cut), four walls
   * and a bottom. Through-cut areas collapse to zero thickness but the surface stays closed.
   */
  toMesh(): Mesh {
    return stockMesh(this.hf)
  }

  reset() {
    this.hf.top.fill(0)
    this.dirty = { minX: 0, minY: 0, maxX: this.hf.length, maxY: this.hf.width, through: true }
  }

  takeDirty() {
    const d = this.dirty
    this.dirty = null
    return d
  }

  snapshot(): StockSnapshot {
    return { kind: 'heightfield', data: this.hf.top.slice() }
  }

  restore(s: StockSnapshot) {
    if (s.kind !== 'heightfield' || s.data.length !== this.hf.top.length) throw new Error('Snapshot is from a different stock.')
    this.hf.top.set(s.data)
    this.dirty = { minX: 0, minY: 0, maxX: this.hf.length, maxY: this.hf.width, through: true }
  }
}

export interface StockMeshRange {
  /** Every `step` cells (1 = every cell). */
  step?: number
  i0?: number
  i1?: number
  j0?: number
  j1?: number
  /**
   * Coarse steps: each corner takes the lowest cell of the blocks round it, so the mesh never
   * shows material that was cut (for export). Off: the four cells at the corner (for display).
   */
  exact?: boolean
}

function meshGrid(hf: Heightfield, opt: StockMeshRange) {
  const s = Math.max(1, Math.floor(opt.step ?? 1))
  const i0 = Math.max(0, Math.min(hf.nx - 1, opt.i0 ?? 0))
  const j0 = Math.max(0, Math.min(hf.ny - 1, opt.j0 ?? 0))
  const i1 = Math.min(hf.nx, Math.max(i0 + 1, opt.i1 ?? hf.nx))
  const j1 = Math.min(hf.ny, Math.max(j0 + 1, opt.j1 ?? hf.ny))
  // corner lines in cells, every s, always including the ends
  const lines = (a: number, b: number) => {
    const out: number[] = []
    for (let k = a; k < b; k += s) out.push(k)
    out.push(b)
    return out
  }
  return { s, i0, j0, i1, j1, xs: lines(i0, i1), ys: lines(j0, j1) }
}

/** Write the top-surface heights of a `stockMesh` (same range and step) into its positions. */
export function stockMeshTops(hf: Heightfield, positions: Float32Array, opt: StockMeshRange = {}) {
  const { s, i0, j0, i1, j1, xs, ys } = meshGrid(hf, opt)
  const reach = opt.exact && s > 1 ? s : 1
  const bottom = -hf.thickness
  const cx = xs.length
  for (let b = 0; b < ys.length; b++)
    for (let a = 0; a < cx; a++) {
      const i = xs[a]
      const j = ys[b]
      let z = 0
      for (let jj = Math.max(j0, j - reach); jj < Math.min(j1, j + reach); jj++)
        for (let ii = Math.max(i0, i - reach); ii < Math.min(i1, i + reach); ii++) {
          const v = hf.top[jj * hf.nx + ii]
          if (v < z) z = v
        }
      positions[(b * cx + a) * 3 + 2] = Math.max(bottom, z)
    }
}

/**
 * Closed mesh of a heightfield's material, or of part of it: cells i0..i1-1 by j0..j1-1, every
 * `step` cells. At step 1 (or with `exact`) the mesh never shows material that was cut. The walls
 * round the range show the material's cross-section, so a range cut short in X or Y is a section
 * view. The top-surface vertices come first (`stockMeshTops` refreshes them).
 */
export function stockMesh(hf: Heightfield, opt: StockMeshRange = {}): Mesh {
  const { xs, ys } = meshGrid(hf, opt)
  const cx = xs.length
  const cy = ys.length
  const n = cx * cy
  const pos = new Float32Array(n * 2 * 3)
  const bottom = -hf.thickness
  for (let b = 0; b < cy; b++)
    for (let a = 0; a < cx; a++) {
      const k = b * cx + a
      const x = Math.min(xs[a] * hf.cell, hf.length)
      const y = Math.min(ys[b] * hf.cell, hf.width)
      pos[k * 3] = x
      pos[k * 3 + 1] = y
      pos[(n + k) * 3] = x
      pos[(n + k) * 3 + 1] = y
      pos[(n + k) * 3 + 2] = bottom
    }
  stockMeshTops(hf, pos, opt)
  const tris = new Uint32Array(((cx - 1) * (cy - 1) * 4 + 4 * ((cx - 1) + (cy - 1))) * 3)
  let w = 0
  const tri = (a: number, b: number, c: number) => {
    tris[w++] = a
    tris[w++] = b
    tris[w++] = c
  }
  const v = (a: number, b: number, top: boolean) => (top ? 0 : n) + b * cx + a
  for (let b = 0; b + 1 < cy; b++)
    for (let a = 0; a + 1 < cx; a++) {
      tri(v(a, b, true), v(a + 1, b, true), v(a + 1, b + 1, true))
      tri(v(a, b, true), v(a + 1, b + 1, true), v(a, b + 1, true))
      tri(v(a, b, false), v(a + 1, b + 1, false), v(a + 1, b, false))
      tri(v(a, b, false), v(a, b + 1, false), v(a + 1, b + 1, false))
    }
  // walls: walk the boundary counter-clockwise seen from above; outward normals
  const ring: [number, number][] = []
  for (let a = 0; a + 1 < cx; a++) ring.push([a, 0])
  for (let b = 0; b + 1 < cy; b++) ring.push([cx - 1, b])
  for (let a = cx - 1; a > 0; a--) ring.push([a, cy - 1])
  for (let b = cy - 1; b > 0; b--) ring.push([0, b])
  for (let k = 0; k < ring.length; k++) {
    const [ai, aj] = ring[k]
    const [bi, bj] = ring[(k + 1) % ring.length]
    tri(v(ai, aj, false), v(bi, bj, false), v(bi, bj, true))
    tri(v(ai, aj, false), v(bi, bj, true), v(ai, aj, true))
  }
  return { positions: pos, indices: tris }
}
