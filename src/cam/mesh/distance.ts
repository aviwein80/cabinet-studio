/**
 * Distance between two meshes (sampled Hausdorff distance): used to report how far a simplified
 * mesh moved from the original. Independent of the simplifier.
 */
import { tick, type Work } from '@/core/cancel'
import { type Mesh, meshBounds, triCount } from './types'

/** Squared distance from point p to triangle abc (closest-feature method). */
export function pointTriDist2(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az
  const acx = cx - ax, acy = cy - ay, acz = cz - az
  const apx = px - ax, apy = py - ay, apz = pz - az
  const d1 = abx * apx + aby * apy + abz * apz
  const d2 = acx * apx + acy * apy + acz * apz
  const sq = (x: number, y: number, z: number) => x * x + y * y + z * z
  if (d1 <= 0 && d2 <= 0) return sq(apx, apy, apz)
  const bpx = px - bx, bpy = py - by, bpz = pz - bz
  const d3 = abx * bpx + aby * bpy + abz * bpz
  const d4 = acx * bpx + acy * bpy + acz * bpz
  if (d3 >= 0 && d4 <= d3) return sq(bpx, bpy, bpz)
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3)
    return sq(apx - v * abx, apy - v * aby, apz - v * abz)
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz
  const d5 = abx * cpx + aby * cpy + abz * cpz
  const d6 = acx * cpx + acy * cpy + acz * cpz
  if (d6 >= 0 && d5 <= d6) return sq(cpx, cpy, cpz)
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6)
    return sq(apx - w * acx, apy - w * acy, apz - w * acz)
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
    return sq(bpx - w * (cx - bx), bpy - w * (cy - by), bpz - w * (cz - bz))
  }
  const den = 1 / (va + vb + vc)
  const v = vb * den
  const w = vc * den
  return sq(apx - abx * v - acx * w, apy - aby * v - acy * w, apz - abz * v - acz * w)
}

/** Uniform 3D grid of triangle boxes for nearest-surface queries. */
class TriGrid {
  readonly cell: number
  readonly n: [number, number, number]
  readonly o: [number, number, number]
  readonly start: Int32Array
  readonly items: Int32Array
  readonly mesh: Mesh
  constructor(mesh: Mesh) {
    this.mesh = mesh
    const b = meshBounds(mesh)
    const nt = triCount(mesh)
    const ext = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]
    const vol = Math.max(1e-9, ext[0] * ext[1] * Math.max(ext[2], 1e-3))
    this.cell = Math.max(1e-3, Math.cbrt(vol / Math.max(1, nt)))
    this.o = [b.min[0], b.min[1], b.min[2]]
    this.n = [0, 1, 2].map((k) => Math.max(1, Math.ceil(ext[k] / this.cell) + 1)) as [number, number, number]
    const counts = new Int32Array(this.n[0] * this.n[1] * this.n[2] + 1)
    const cellsOf = (t: number, fn: (c: number) => void) => {
      const p = mesh.positions
      const lo = [Infinity, Infinity, Infinity]
      const hi = [-Infinity, -Infinity, -Infinity]
      for (let k = 0; k < 3; k++) {
        const v = mesh.indices[t * 3 + k] * 3
        for (let a = 0; a < 3; a++) {
          lo[a] = Math.min(lo[a], p[v + a])
          hi[a] = Math.max(hi[a], p[v + a])
        }
      }
      const i0 = lo.map((x, a) => Math.floor((x - this.o[a]) / this.cell))
      const i1 = hi.map((x, a) => Math.floor((x - this.o[a]) / this.cell))
      for (let i = i0[0]; i <= i1[0]; i++) for (let j = i0[1]; j <= i1[1]; j++) for (let k = i0[2]; k <= i1[2]; k++) fn(this.idx(i, j, k))
    }
    for (let t = 0; t < nt; t++) cellsOf(t, (c) => counts[c + 1]++)
    for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1]
    this.start = counts
    this.items = new Int32Array(counts[counts.length - 1])
    const fill = counts.slice()
    for (let t = 0; t < nt; t++) cellsOf(t, (c) => (this.items[fill[c]++] = t))
  }
  idx(i: number, j: number, k: number) {
    return (k * this.n[1] + j) * this.n[0] + i
  }
  /** Distance from p to the nearest facet. */
  nearest(px: number, py: number, pz: number, stamp: Int32Array, mark: number): number {
    const p = this.mesh.positions
    const ix = this.mesh.indices
    const ci = [px, py, pz].map((x, a) => Math.min(this.n[a] - 1, Math.max(0, Math.floor((x - this.o[a]) / this.cell))))
    let best = Infinity
    const maxR = Math.max(...this.n)
    for (let r = 0; r <= maxR; r++) {
      // every facet within r cells has been seen once the shell at r is done; stop when the best
      // distance is closer than anything a further shell could hold
      for (let i = ci[0] - r; i <= ci[0] + r; i++)
        for (let j = ci[1] - r; j <= ci[1] + r; j++)
          for (let k = ci[2] - r; k <= ci[2] + r; k++) {
            if (Math.max(Math.abs(i - ci[0]), Math.abs(j - ci[1]), Math.abs(k - ci[2])) !== r) continue
            if (i < 0 || j < 0 || k < 0 || i >= this.n[0] || j >= this.n[1] || k >= this.n[2]) continue
            const c = this.idx(i, j, k)
            for (let q = this.start[c]; q < this.start[c + 1]; q++) {
              const t = this.items[q]
              if (stamp[t] === mark) continue
              stamp[t] = mark
              const a = ix[t * 3] * 3, b = ix[t * 3 + 1] * 3, cc = ix[t * 3 + 2] * 3
              const d = pointTriDist2(px, py, pz, p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[cc], p[cc + 1], p[cc + 2])
              if (d < best) best = d
            }
          }
      // distance from p to the outside of the searched block of cells
      let reach = Infinity
      for (let ax = 0; ax < 3; ax++) {
        const x = ax === 0 ? px : ax === 1 ? py : pz
        const lo = this.o[ax] + (ci[ax] - r) * this.cell
        const hi = this.o[ax] + (ci[ax] + r + 1) * this.cell
        if (ci[ax] - r > 0) reach = Math.min(reach, x - lo)
        if (ci[ax] + r + 1 < this.n[ax]) reach = Math.min(reach, hi - x)
      }
      if (reach === Infinity || (reach > 0 && best <= reach * reach)) break
    }
    return Math.sqrt(best)
  }
}

/** Sample points of a mesh: every vertex, and each facet's centre and edge midpoints. */
function samples(m: Mesh, limit: number): Float64Array {
  const p = m.positions
  const ix = m.indices
  const nv = p.length / 3
  const nt = triCount(m)
  const total = nv + nt * 4
  const stride = Math.max(1, Math.ceil(total / limit))
  const out: number[] = []
  let k = 0
  const push = (x: number, y: number, z: number) => {
    if (k++ % stride === 0) out.push(x, y, z)
  }
  for (let v = 0; v < nv; v++) push(p[v * 3], p[v * 3 + 1], p[v * 3 + 2])
  for (let t = 0; t < nt; t++) {
    const a = ix[t * 3] * 3, b = ix[t * 3 + 1] * 3, c = ix[t * 3 + 2] * 3
    push((p[a] + p[b] + p[c]) / 3, (p[a + 1] + p[b + 1] + p[c + 1]) / 3, (p[a + 2] + p[b + 2] + p[c + 2]) / 3)
    push((p[a] + p[b]) / 2, (p[a + 1] + p[b + 1]) / 2, (p[a + 2] + p[b + 2]) / 2)
    push((p[b] + p[c]) / 2, (p[b + 1] + p[c + 1]) / 2, (p[b + 2] + p[c + 2]) / 2)
    push((p[c] + p[a]) / 2, (p[c + 1] + p[a + 1]) / 2, (p[c + 2] + p[a + 2]) / 2)
  }
  return Float64Array.from(out)
}

function oneWay(from: Mesh, to: Mesh, limit: number, work: Work | undefined, base: number) {
  const g = new TriGrid(to)
  const s = samples(from, limit)
  const stamp = new Int32Array(triCount(to))
  let max = 0
  let sum = 0
  const n = s.length / 3
  for (let i = 0; i < n; i++) {
    tick(work, i, n, 4096, base, 0.5, 'Measuring')
    const d = g.nearest(s[i * 3], s[i * 3 + 1], s[i * 3 + 2], stamp, i + 1)
    if (d > max) max = d
    sum += d
  }
  return { max, mean: n ? sum / n : 0 }
}

/** Symmetric sampled Hausdorff distance between two meshes (mm). */
export function meshDeviation(a: Mesh, b: Mesh, opt: { samples?: number; work?: Work } = {}) {
  const limit = opt.samples ?? 400_000
  const ab = oneWay(a, b, limit, opt.work, 0)
  const ba = oneWay(b, a, limit, opt.work, 0.5)
  return { max: Math.max(ab.max, ba.max), mean: (ab.mean + ba.mean) / 2 }
}
