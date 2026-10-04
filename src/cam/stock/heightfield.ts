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

  constructor(length: number, width: number, thickness: number, cell?: number) {
    this.hf = createHeightfield(length, width, thickness, cell)
  }

  static wrap(hf: Heightfield): HeightfieldStock {
    const s = Object.create(HeightfieldStock.prototype) as HeightfieldStock
    Object.assign(s, { kind: 'heightfield', hf })
    return s
  }

  bounds(): Box3 {
    return { min: [0, 0, -this.hf.thickness], max: [this.hf.length, this.hf.width, 0] }
  }

  carve(a: V3, b: V3, cutter: Cutter) {
    if (Math.min(a.z, b.z) >= 0) return
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
    const { hf } = this
    const cx = hf.nx + 1
    const cy = hf.ny + 1
    const n = cx * cy
    const pos = new Float32Array(n * 2 * 3)
    const bottom = -hf.thickness
    for (let j = 0; j < cy; j++)
      for (let i = 0; i < cx; i++) {
        let z = 0
        for (const [di, dj] of [
          [-1, -1],
          [0, -1],
          [-1, 0],
          [0, 0],
        ]) {
          const ii = i + di
          const jj = j + dj
          if (ii >= 0 && jj >= 0 && ii < hf.nx && jj < hf.ny) z = Math.min(z, hf.top[jj * hf.nx + ii])
        }
        const k = j * cx + i
        const x = Math.min(i * hf.cell, hf.length)
        const y = Math.min(j * hf.cell, hf.width)
        pos.set([x, y, Math.max(bottom, z)], k * 3)
        pos.set([x, y, bottom], (n + k) * 3)
      }
    const tris: number[] = []
    const v = (i: number, j: number, top: boolean) => (top ? 0 : n) + j * cx + i
    for (let j = 0; j < hf.ny; j++)
      for (let i = 0; i < hf.nx; i++) {
        tris.push(v(i, j, true), v(i + 1, j, true), v(i + 1, j + 1, true), v(i, j, true), v(i + 1, j + 1, true), v(i, j + 1, true))
        tris.push(v(i, j, false), v(i + 1, j + 1, false), v(i + 1, j, false), v(i, j, false), v(i, j + 1, false), v(i + 1, j + 1, false))
      }
    // walls: walk the boundary counter-clockwise seen from above; outward normals
    const ring: [number, number][] = []
    for (let i = 0; i < hf.nx; i++) ring.push([i, 0])
    for (let j = 0; j < hf.ny; j++) ring.push([hf.nx, j])
    for (let i = hf.nx; i > 0; i--) ring.push([i, hf.ny])
    for (let j = hf.ny; j > 0; j--) ring.push([0, j])
    for (let k = 0; k < ring.length; k++) {
      const [ai, aj] = ring[k]
      const [bi, bj] = ring[(k + 1) % ring.length]
      tris.push(v(ai, aj, false), v(bi, bj, false), v(bi, bj, true), v(ai, aj, false), v(bi, bj, true), v(ai, aj, true))
    }
    return { positions: pos, indices: Uint32Array.from(tris) }
  }

  snapshot(): StockSnapshot {
    return { kind: 'heightfield', data: this.hf.top.slice() }
  }

  restore(s: StockSnapshot) {
    if (s.kind !== 'heightfield' || s.data.length !== this.hf.top.length) throw new Error('Snapshot is from a different stock.')
    this.hf.top.set(s.data)
  }
}
