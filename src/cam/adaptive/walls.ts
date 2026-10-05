/**
 * Exact wall clearance for adaptive clearing: the edges of the material boundary in a bucket grid,
 * and the distance from a straight tool-centre move to the nearest of them. A move whose distance
 * is at least the tool radius cannot cut past the boundary.
 */
import type { P } from '../geom'

export class Walls {
  private readonly ax: Float64Array
  private readonly ay: Float64Array
  private readonly bx: Float64Array
  private readonly by: Float64Array
  private readonly cell: number
  private readonly ox: number
  private readonly oy: number
  private readonly nx: number
  private readonly ny: number
  private readonly start: Int32Array
  private readonly items: Int32Array
  private readonly stamp: Int32Array
  private mark = 0

  constructor(polys: P[][], cell: number) {
    const edges: [P, P][] = []
    for (const poly of polys) for (let i = 0; i < poly.length; i++) edges.push([poly[i], poly[(i + 1) % poly.length]])
    const n = edges.length
    this.ax = new Float64Array(n)
    this.ay = new Float64Array(n)
    this.bx = new Float64Array(n)
    this.by = new Float64Array(n)
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    edges.forEach(([a, b], k) => {
      this.ax[k] = a.x
      this.ay[k] = a.y
      this.bx[k] = b.x
      this.by[k] = b.y
      minX = Math.min(minX, a.x, b.x)
      minY = Math.min(minY, a.y, b.y)
      maxX = Math.max(maxX, a.x, b.x)
      maxY = Math.max(maxY, a.y, b.y)
    })
    if (!n) minX = minY = maxX = maxY = 0
    this.cell = Math.max(0.1, cell)
    this.ox = minX
    this.oy = minY
    this.nx = Math.max(1, Math.ceil((maxX - minX) / this.cell) + 1)
    this.ny = Math.max(1, Math.ceil((maxY - minY) / this.cell) + 1)
    const counts = new Int32Array(this.nx * this.ny + 1)
    const each = (k: number, fn: (c: number) => void) => {
      const i0 = this.ci(Math.min(this.ax[k], this.bx[k]))
      const i1 = this.ci(Math.max(this.ax[k], this.bx[k]))
      const j0 = this.cj(Math.min(this.ay[k], this.by[k]))
      const j1 = this.cj(Math.max(this.ay[k], this.by[k]))
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * this.nx + i)
    }
    for (let k = 0; k < n; k++) each(k, (c) => counts[c + 1]++)
    for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1]
    this.start = counts
    this.items = new Int32Array(counts[counts.length - 1])
    const fill = counts.slice()
    for (let k = 0; k < n; k++) each(k, (c) => (this.items[fill[c]++] = k))
    this.stamp = new Int32Array(n)
  }

  private ci(x: number) {
    return Math.max(0, Math.min(this.nx - 1, Math.floor((x - this.ox) / this.cell)))
  }
  private cj(y: number) {
    return Math.max(0, Math.min(this.ny - 1, Math.floor((y - this.oy) / this.cell)))
  }

  /** True when every point of the move from p to q is at least r from every wall edge. */
  clear(p: P, q: P, r: number): boolean {
    const mark = ++this.mark
    const i0 = this.ci(Math.min(p.x, q.x) - r)
    const i1 = this.ci(Math.max(p.x, q.x) + r)
    const j0 = this.cj(Math.min(p.y, q.y) - r)
    const j1 = this.cj(Math.max(p.y, q.y) + r)
    const r2 = r * r
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const c = j * this.nx + i
        for (let s = this.start[c]; s < this.start[c + 1]; s++) {
          const k = this.items[s]
          if (this.stamp[k] === mark) continue
          this.stamp[k] = mark
          if (segSegDist2(p.x, p.y, q.x, q.y, this.ax[k], this.ay[k], this.bx[k], this.by[k]) < r2) return false
        }
      }
    return true
  }

  /** Distance from point p to the nearest wall edge within `limit` (limit when none is nearer). */
  distance(p: P, limit: number): number {
    const mark = ++this.mark
    let best = limit * limit
    const i0 = this.ci(p.x - limit)
    const i1 = this.ci(p.x + limit)
    const j0 = this.cj(p.y - limit)
    const j1 = this.cj(p.y + limit)
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const c = j * this.nx + i
        for (let s = this.start[c]; s < this.start[c + 1]; s++) {
          const k = this.items[s]
          if (this.stamp[k] === mark) continue
          this.stamp[k] = mark
          best = Math.min(best, pointSegDist2(p.x, p.y, this.ax[k], this.ay[k], this.bx[k], this.by[k]))
        }
      }
    return Math.sqrt(best)
  }
}

function pointSegDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0
  const x = ax + dx * t - px
  const y = ay + dy * t - py
  return x * x + y * y
}

/** Squared distance between segments pq and ab (0 when they cross). */
export function segSegDist2(px: number, py: number, qx: number, qy: number, ax: number, ay: number, bx: number, by: number) {
  const d1 = (qx - px) * (ay - py) - (qy - py) * (ax - px)
  const d2 = (qx - px) * (by - py) - (qy - py) * (bx - px)
  const d3 = (bx - ax) * (py - ay) - (by - ay) * (px - ax)
  const d4 = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0
  return Math.min(pointSegDist2(px, py, ax, ay, bx, by), pointSegDist2(qx, qy, ax, ay, bx, by), pointSegDist2(ax, ay, px, py, qx, qy), pointSegDist2(bx, by, px, py, qx, qy))
}
