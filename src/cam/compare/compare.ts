/**
 * Part compare (M3.6, SIM-04): the simulated stock against the design model, as a colour map of
 * gouges (material cut away inside the design) and leftover (material still outside it).
 *
 * Every point of the stock's surface gets a signed distance to the design: negative inside the
 * design (a gouge), positive outside it (material left over), 0 on it. The design is the part's
 * 3D models as placed, within the part's block:
 *
 * - a closed model (a solid, or a watertight mesh) is its own inside;
 * - an open model (a relief or a surface) is closed off downwards: everything under it, down to the
 *   part's underside, inside its outline seen from above. Outside that outline there is no design
 *   to compare with, and the stock there is not compared (left uncoloured).
 *
 * The distance is to the nearest point of the models' surfaces; inside the design it is also never
 * more than the distance to the block's faces that close it off (the stock's own uncut sides lie on
 * the design there). The stock's underside (and columns cut right through) is not compared. Exact
 * for the stock mesh given: the colour map is as fine as the stock model's cells. A closed model
 * must be one solid (faces inside it would count as its surface).
 *
 * Pure: no DOM, no React.
 */
import { checkCancel, type Work } from '@/core/cancel'
import { buildEdges, edgeCounts } from '../mesh/build'
import { pointTriDist2 } from '../mesh/distance'
import { type Mesh, meshBounds, triCount } from '../mesh/types'

export interface CompareOptions {
  /** Within this of the design counts as on it (mm). */
  tol: number
  /** Distances beyond this are shown at full colour (mm). */
  range: number
}

export const DEFAULT_COMPARE: CompareOptions = { tol: 0.05, range: 2 }

export interface CompareSummary {
  /** Stock points compared, and of those how many within the tolerance, gouged, left over. */
  compared: number
  within: number
  gouged: number
  leftover: number
  /** Deepest gouge (mm, positive) and where; null when none past the tolerance. */
  gouge: { depth: number; at: [number, number, number] } | null
  /** Thickest leftover (mm) and where (capped at the range: "at least"). */
  left: { depth: number; at: [number, number, number]; capped: boolean } | null
}

export interface CompareResult {
  /** Signed distance per stock vertex (mm): negative = gouge, positive = leftover; NaN = not compared. */
  d: Float32Array
  summary: CompareSummary
}

/** A design model placed in the part (part frame, mm). */
interface Design {
  mesh: Mesh
  closed: boolean
  near: NearGrid
  /** Plan grid of facet indices (for vertical rays). */
  plan: { x0: number; y0: number; cell: number; nx: number; ny: number; start: Int32Array; items: Int32Array }
}

/**
 * Facets bucketed on a 3D grid for "nearest facet within `cap`" queries: only the cells within cap
 * of the point are looked at (cells of at least half the cap, so at most 5 x 5 x 5 of them).
 */
class NearGrid {
  readonly o: [number, number, number]
  readonly n: [number, number, number]
  readonly cell: number
  readonly start: Int32Array
  readonly items: Int32Array
  readonly stamp: Int32Array
  readonly mesh: Mesh
  readonly cap: number
  mark = 0
  constructor(mesh: Mesh, cap: number) {
    this.mesh = mesh
    this.cap = cap
    const b = meshBounds(mesh)
    const nt = triCount(mesh)
    const area = Math.max(1e-6, (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]))
    this.cell = Math.max(cap / 2, Math.sqrt(area / Math.max(1, nt)) * 1.5, 0.05)
    this.o = [b.min[0] - cap, b.min[1] - cap, b.min[2] - cap]
    this.n = [0, 1, 2].map((k) => Math.max(1, Math.ceil((b.max[k] - b.min[k] + 2 * cap) / this.cell) + 1)) as [number, number, number]
    const counts = new Int32Array(this.n[0] * this.n[1] * this.n[2] + 1)
    const P = mesh.positions
    const I = mesh.indices
    const cells = (t: number, fn: (c: number) => void) => {
      const lo = [Infinity, Infinity, Infinity]
      const hi = [-Infinity, -Infinity, -Infinity]
      for (let k = 0; k < 3; k++) {
        const v = I[t * 3 + k] * 3
        for (let a = 0; a < 3; a++) {
          lo[a] = Math.min(lo[a], P[v + a])
          hi[a] = Math.max(hi[a], P[v + a])
        }
      }
      const i0 = lo.map((x, a) => Math.floor((x - this.o[a]) / this.cell))
      const i1 = hi.map((x, a) => Math.floor((x - this.o[a]) / this.cell))
      for (let k = i0[2]; k <= i1[2]; k++) for (let j = i0[1]; j <= i1[1]; j++) for (let i = i0[0]; i <= i1[0]; i++) fn((k * this.n[1] + j) * this.n[0] + i)
    }
    for (let t = 0; t < nt; t++) cells(t, (c) => counts[c + 1]++)
    for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1]
    this.start = counts.slice()
    const fill = counts.slice()
    this.items = new Int32Array(counts[counts.length - 1])
    for (let t = 0; t < nt; t++) cells(t, (c) => (this.items[fill[c]++] = t))
    this.stamp = new Int32Array(nt)
  }

  /** Distance from p to the nearest facet, or `cap` when none is nearer. */
  nearest(px: number, py: number, pz: number): number {
    const cap = this.cap
    const c = this.cell
    const i0 = Math.max(0, Math.floor((px - cap - this.o[0]) / c))
    const i1 = Math.min(this.n[0] - 1, Math.floor((px + cap - this.o[0]) / c))
    const j0 = Math.max(0, Math.floor((py - cap - this.o[1]) / c))
    const j1 = Math.min(this.n[1] - 1, Math.floor((py + cap - this.o[1]) / c))
    const k0 = Math.max(0, Math.floor((pz - cap - this.o[2]) / c))
    const k1 = Math.min(this.n[2] - 1, Math.floor((pz + cap - this.o[2]) / c))
    let best = cap * cap
    const mark = ++this.mark
    const P = this.mesh.positions
    const I = this.mesh.indices
    for (let k = k0; k <= k1; k++)
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const cell = (k * this.n[1] + j) * this.n[0] + i
          for (let q = this.start[cell]; q < this.start[cell + 1]; q++) {
            const t = this.items[q]
            if (this.stamp[t] === mark) continue
            this.stamp[t] = mark
            const a = I[t * 3] * 3
            const b = I[t * 3 + 1] * 3
            const d = I[t * 3 + 2] * 3
            const dd = pointTriDist2(px, py, pz, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[d], P[d + 1], P[d + 2])
            if (dd < best) best = dd
          }
        }
    return Math.sqrt(best)
  }
}

/** Exact distance from p to the nearest facet of a mesh (every facet: for a few points only). */
function nearestAll(m: Mesh, px: number, py: number, pz: number): number {
  const P = m.positions
  const I = m.indices
  let best = Infinity
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3
    const b = I[t + 1] * 3
    const c = I[t + 2] * 3
    const dd = pointTriDist2(px, py, pz, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2])
    if (dd < best) best = dd
  }
  return Math.sqrt(best)
}

/** Facets bucketed on a plan grid by their boxes. */
function planGrid(m: Mesh): Design['plan'] {
  const b = meshBounds(m)
  const nt = triCount(m)
  const ext = Math.max(1e-6, (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]))
  const cell = Math.max(0.05, Math.sqrt(ext / Math.max(1, nt)) * 2)
  const nx = Math.max(1, Math.ceil((b.max[0] - b.min[0]) / cell) + 1)
  const ny = Math.max(1, Math.ceil((b.max[1] - b.min[1]) / cell) + 1)
  const counts = new Int32Array(nx * ny + 1)
  const P = m.positions
  const I = m.indices
  const span = (t: number) => {
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (let k = 0; k < 3; k++) {
      const v = I[t * 3 + k] * 3
      x0 = Math.min(x0, P[v])
      x1 = Math.max(x1, P[v])
      y0 = Math.min(y0, P[v + 1])
      y1 = Math.max(y1, P[v + 1])
    }
    return [Math.floor((x0 - b.min[0]) / cell), Math.floor((x1 - b.min[0]) / cell), Math.floor((y0 - b.min[1]) / cell), Math.floor((y1 - b.min[1]) / cell)]
  }
  for (let t = 0; t < nt; t++) {
    const [i0, i1, j0, j1] = span(t)
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) counts[j * nx + i + 1]++
  }
  for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1]
  const start = counts.slice()
  const fill = counts.slice()
  const items = new Int32Array(counts[counts.length - 1])
  for (let t = 0; t < nt; t++) {
    const [i0, i1, j0, j1] = span(t)
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) items[fill[j * nx + i]++] = t
  }
  return { x0: b.min[0], y0: b.min[1], cell, nx, ny, start, items }
}

/**
 * Heights where the vertical line through (x, y) crosses the model's facets (any order). A point
 * exactly on an edge is nudged by a tiny fixed amount so it is counted once.
 */
function crossings(d: Design, x: number, y: number): number[] {
  const g = d.plan
  const i = Math.floor((x - g.x0) / g.cell)
  const j = Math.floor((y - g.y0) / g.cell)
  if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return []
  const P = d.mesh.positions
  const I = d.mesh.indices
  const out: number[] = []
  // (a fixed, irrational-looking nudge so lines through vertices and edges count once)
  const px = x + 1.3e-7
  const py = y + 0.7e-7
  for (let q = g.start[j * g.nx + i]; q < g.start[j * g.nx + i + 1]; q++) {
    const t = g.items[q]
    const a = I[t * 3] * 3
    const b = I[t * 3 + 1] * 3
    const c = I[t * 3 + 2] * 3
    const ax = P[a] - px
    const ay = P[a + 1] - py
    const bx = P[b] - px
    const by = P[b + 1] - py
    const cx = P[c] - px
    const cy = P[c + 1] - py
    const w0 = bx * cy - by * cx
    const w1 = cx * ay - cy * ax
    const w2 = ax * by - ay * bx
    if (!((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0))) continue
    const s = w0 + w1 + w2
    if (Math.abs(s) < 1e-18) continue
    out.push((w0 * P[a + 2] + w1 * P[b + 2] + w2 * P[c + 2]) / s)
  }
  return out
}

/** Is a mesh closed (every edge shared by two facets)? */
export function meshClosed(m: Mesh): boolean {
  const e = edgeCounts(buildEdges(m.indices, m.positions.length / 3))
  return e.open === 0
}

/**
 * Compare a stock surface (`stock`, part frame) with the design models (`models`, placed in the part
 * frame). `block`: the part's size (the design is held within it).
 */
export function compareStock(stock: Mesh, models: readonly Mesh[], block: { length: number; width: number; thickness: number }, opt: CompareOptions = DEFAULT_COMPARE, work?: Work): CompareResult {
  // distances are found exactly up to `cap` (the colour map's full colour and a little more); the
  // thickest leftover beyond it is measured exactly afterwards on its likeliest points
  const cap = Math.max(opt.range, opt.tol) * 1.5
  const designs: Design[] = models.filter((m) => triCount(m) > 0).map((mesh) => ({ mesh, closed: meshClosed(mesh), near: new NearGrid(mesh, cap), plan: planGrid(mesh) }))
  const n = stock.positions.length / 3
  const d = new Float32Array(n).fill(NaN)
  const P = stock.positions
  const T = block.thickness
  const sum: CompareSummary = { compared: 0, within: 0, gouged: 0, leftover: 0, gouge: null, left: null }
  // capped leftover points, the highest kept for the exact measure
  const far: { v: number; z: number }[] = []
  for (let v = 0; v < n; v++) {
    if ((v & 4095) === 0) {
      checkCancel(work?.isCancelled)
      work?.progress?.(v / n, 'Comparing with the model')
    }
    const x = P[v * 3]
    const y = P[v * 3 + 1]
    const z = P[v * 3 + 2]
    // the block's underside (and columns cut right through) holds nothing to compare
    if (z <= -T + 1e-6) continue
    // inside the design? (any model); covered at all? (an open model's outline, or any closed one)
    let inside = false
    let covered = false
    for (const g of designs) {
      const zs = crossings(g, x, y)
      if (g.closed) {
        covered = true
        // (faces through the point itself, within a hair, count as below it: a point on the surface is on it either way)
        if (zs.filter((h) => h > z + 1e-6).length % 2 === 1) inside = true
      } else if (zs.length) {
        covered = true
        if (z <= Math.max(...zs) + 1e-9) inside = true
      }
    }
    if (!covered) continue
    let s: number
    if (inside) {
      // the block's faces close the design off: on them the stock is on the design
      const toFace = Math.max(0, Math.min(x, block.length - x, y, block.width - y, -z, z + T))
      s = toFace <= opt.tol ? -toFace : -Math.min(toFace, ...designs.map((g) => g.near.nearest(x, y, z)))
    } else {
      s = Math.min(...designs.map((g) => g.near.nearest(x, y, z)))
      if (s >= cap - 1e-9) {
        far.push({ v, z })
        if (far.length > 512) {
          far.sort((a, b) => b.z - a.z)
          far.length = 256
        }
      }
    }
    d[v] = s
    sum.compared++
    if (s < -opt.tol) {
      sum.gouged++
      if (!sum.gouge || -s > sum.gouge.depth) sum.gouge = { depth: -s, at: [x, y, z] }
    } else if (s > opt.tol) {
      sum.leftover++
      if (!sum.left || s > sum.left.depth) sum.left = { depth: s, at: [x, y, z], capped: s >= cap - 1e-9 }
    } else sum.within++
  }
  // the thickest leftover beyond the cap, measured exactly on the highest of those points
  far.sort((a, b) => b.z - a.z)
  for (const { v } of far.slice(0, 256)) {
    const x = P[v * 3]
    const y = P[v * 3 + 1]
    const z = P[v * 3 + 2]
    const e = Math.min(...designs.map((g) => nearestAll(g.mesh, x, y, z)))
    d[v] = e
    if (!sum.left || e > sum.left.depth || sum.left.capped) sum.left = { depth: Math.max(e, sum.left && !sum.left.capped ? sum.left.depth : 0), at: [x, y, z], capped: false }
  }
  return { d, summary: sum }
}

/** Colour of a signed distance (RGB, 0..255): red gouges, green within the tolerance, blue leftover; null = not compared. */
export function compareColor(s: number, opt: CompareOptions = DEFAULT_COMPARE): [number, number, number] | null {
  if (!Number.isFinite(s)) return null
  if (Math.abs(s) <= opt.tol) return [74, 222, 128]
  const k = Math.min(1, (Math.abs(s) - opt.tol) / Math.max(1e-9, opt.range - opt.tol))
  // light to full: gouges from amber-red to deep red, leftover from light to deep blue
  return s < 0 ? [Math.round(251 - 31 * k), Math.round(146 - 108 * k), Math.round(60 - 22 * k)] : [Math.round(147 - 117 * k), Math.round(197 - 133 * k), Math.round(253 - 78 * k)]
}

/**
 * A small top view of the compare (RGBA, `w` pixels across): each pixel the colour of the highest
 * stock point compared over it, grey where nothing was compared.
 */
export function compareThumb(stock: Mesh, d: Float32Array, block: { length: number; width: number }, w = 160, opt: CompareOptions = DEFAULT_COMPARE): { w: number; h: number; rgba: Uint8ClampedArray } {
  const h = Math.max(1, Math.round((w * block.width) / Math.max(1e-9, block.length)))
  const rgba = new Uint8ClampedArray(w * h * 4)
  const top = new Float32Array(w * h).fill(-Infinity)
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = 60
    rgba[i * 4 + 1] = 64
    rgba[i * 4 + 2] = 72
    rgba[i * 4 + 3] = 255
  }
  const P = stock.positions
  for (let v = 0; v < d.length; v++) {
    const c = compareColor(d[v], opt)
    if (!c) continue
    const px = Math.floor((P[v * 3] / block.length) * w)
    const py = h - 1 - Math.floor((P[v * 3 + 1] / block.width) * h)
    if (px < 0 || py < 0 || px >= w || py >= h) continue
    const k = py * w + px
    if (P[v * 3 + 2] < top[k]) continue
    top[k] = P[v * 3 + 2]
    rgba[k * 4] = c[0]
    rgba[k * 4 + 1] = c[1]
    rgba[k * 4 + 2] = c[2]
  }
  return { w, h, rgba }
}
