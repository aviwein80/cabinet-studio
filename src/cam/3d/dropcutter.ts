/**
 * Drop-cutter: the lowest height a vertical tool can stand at (x, y) without cutting into a
 * triangle mesh. For every facet under the tool it takes the highest of three exact contacts:
 * the facet's inside, its three corners and its three edges. That height is the tool-tip Z of
 * the cutter-location (CL) surface every 3D finishing strategy is built on.
 *
 * Exact closed forms for flat, ball and V cutters; the bull-nose edge contact is found by a
 * search on a concave function (exact to ~1e-9 mm). All maths in float64. Our own code.
 */
import { buildEdges } from '../mesh/build'
import type { Mesh } from '../mesh/types'
import { type Cutter3D, profileNz } from './cutter'

/** Per facet: corners (9), unit normal (3), plane offset, highest Z, XY box (4). */
const STRIDE = 18

export class DropCutter {
  readonly cutter: Cutter3D
  readonly mesh: Mesh
  private readonly tri: Float64Array
  private readonly n: number
  private readonly cell: number
  private readonly ox: number
  private readonly oy: number
  private readonly nx: number
  private readonly ny: number
  private readonly start: Int32Array
  private readonly items: Int32Array
  /** Highest facet corner in each cell: a cell wholly below a `clears` height is skipped unread. */
  private readonly cellTop: Float64Array
  private readonly stamp: Int32Array
  private mark = 0
  /** Corners and edges are shared by several facets: test each once per drop. */
  private readonly triEdge: Int32Array
  private readonly vStamp: Int32Array
  private readonly eStamp: Int32Array
  /** Candidate facets of the current drop, tallest first. */
  private cand = new Int32Array(256)
  private candZ = new Float64Array(256)
  /** 0 ball, 1 flat, 2 bull-nose, 3 V */
  private readonly shape: number
  private readonly R: number
  private readonly rc: number
  private readonly flatR: number
  private readonly k: number

  /** Results of the last successful `drop`: tip Z, the facet touched, and the contact normal's Z. */
  z = -Infinity
  hitTri = -1
  hitNz = 1

  constructor(mesh: Mesh, cutter: Cutter3D, cell?: number) {
    this.mesh = mesh
    this.cutter = cutter
    this.R = cutter.R
    if (cutter.kind === 'v') {
      this.shape = 3
      this.rc = 0
      this.flatR = 0
      this.k = cutter.k
    } else {
      this.shape = cutter.rc >= cutter.R - 1e-12 ? 0 : cutter.rc <= 1e-12 ? 1 : 2
      this.rc = cutter.rc
      this.flatR = cutter.R - cutter.rc
      this.k = 0
    }
    const p = mesh.positions
    const ix = mesh.indices
    const n = ix.length / 3
    this.n = n
    const tri = new Float64Array(n * STRIDE)
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let t = 0; t < n; t++) {
      const o = t * STRIDE
      for (let k = 0; k < 3; k++) {
        const v = ix[t * 3 + k] * 3
        tri[o + k * 3] = p[v]
        tri[o + k * 3 + 1] = p[v + 1]
        tri[o + k * 3 + 2] = p[v + 2]
      }
      const ax = tri[o], ay = tri[o + 1], az = tri[o + 2]
      const ux = tri[o + 3] - ax, uy = tri[o + 4] - ay, uz = tri[o + 5] - az
      const vx = tri[o + 6] - ax, vy = tri[o + 7] - ay, vz = tri[o + 8] - az
      let cx = uy * vz - uz * vy
      let cy = uz * vx - ux * vz
      let cz = ux * vy - uy * vx
      const l = Math.hypot(cx, cy, cz)
      if (l > 0) {
        cx /= l
        cy /= l
        cz /= l
      }
      // the drop only cares which way is up: point the normal upwards
      if (cz < 0) {
        cx = -cx
        cy = -cy
        cz = -cz
      }
      tri[o + 9] = cx
      tri[o + 10] = cy
      tri[o + 11] = cz
      tri[o + 12] = cx * ax + cy * ay + cz * az
      tri[o + 13] = Math.max(az, tri[o + 5], tri[o + 8])
      tri[o + 14] = Math.min(ax, tri[o + 3], tri[o + 6])
      tri[o + 15] = Math.min(ay, tri[o + 4], tri[o + 7])
      tri[o + 16] = Math.max(ax, tri[o + 3], tri[o + 6])
      tri[o + 17] = Math.max(ay, tri[o + 4], tri[o + 7])
      minX = Math.min(minX, tri[o + 14])
      minY = Math.min(minY, tri[o + 15])
      maxX = Math.max(maxX, tri[o + 16])
      maxY = Math.max(maxY, tri[o + 17])
    }
    this.tri = tri
    if (!n) {
      minX = minY = 0
      maxX = maxY = 1
    }
    const area = Math.max(1e-6, (maxX - minX) * (maxY - minY))
    this.cell = cell ?? Math.max(cutter.R / 3, Math.sqrt(area / Math.max(1, n)) * 2, 0.5)
    this.ox = minX
    this.oy = minY
    this.nx = Math.max(1, Math.ceil((maxX - minX) / this.cell) + 1)
    this.ny = Math.max(1, Math.ceil((maxY - minY) / this.cell) + 1)
    const counts = new Int32Array(this.nx * this.ny + 1)
    const each = (t: number, fn: (c: number) => void) => {
      const o = t * STRIDE
      const i0 = Math.floor((tri[o + 14] - this.ox) / this.cell)
      const i1 = Math.floor((tri[o + 16] - this.ox) / this.cell)
      const j0 = Math.floor((tri[o + 15] - this.oy) / this.cell)
      const j1 = Math.floor((tri[o + 17] - this.oy) / this.cell)
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * this.nx + i)
    }
    for (let t = 0; t < n; t++) each(t, (c) => counts[c + 1]++)
    for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1]
    this.start = counts
    this.items = new Int32Array(counts[counts.length - 1])
    const fill = counts.slice()
    const cellTop = new Float64Array(this.nx * this.ny).fill(-Infinity)
    for (let t = 0; t < n; t++)
      each(t, (c) => {
        this.items[fill[c]++] = t
        if (tri[t * STRIDE + 13] > cellTop[c]) cellTop[c] = tri[t * STRIDE + 13]
      })
    this.cellTop = cellTop
    this.stamp = new Int32Array(n)
    const nv = mesh.positions.length / 3
    const edges = buildEdges(ix, nv)
    this.triEdge = edges.slot
    this.vStamp = new Int32Array(nv)
    this.eStamp = new Int32Array(edges.count.length)
  }

  /** Highest Z of any facet (the top of the model). */
  get top(): number {
    let z = -Infinity
    for (let t = 0; t < this.n; t++) z = Math.max(z, this.tri[t * STRIDE + 13])
    return z
  }

  /**
   * Drop the tool at (x, y). Returns false when no facet lies under the tool; otherwise `z`,
   * `hitTri` and `hitNz` hold the tip height, the facet touched and the contact normal's Z.
   */
  drop(x: number, y: number): boolean {
    return this.run(x, y, -Infinity, false)
  }

  /**
   * True when the tool standing with its tip at `z` over (x, y) touches no facet (it may go that
   * low). Same answer as `!drop(x, y) || this.z <= z`, but facets that lie wholly below `z`
   * are skipped at once, so it is much faster near the floor. Leaves `z`/`hitTri` undefined.
   */
  clears(x: number, y: number, z: number): boolean {
    return !this.run(x, y, z, true)
  }

  /**
   * Highest contact above `above` at (x, y). `any`: stop at the first contact found above it
   * (enough to answer `clears`; `z` and `hitTri` are then not the highest).
   */
  private run(x: number, y: number, above: number, any: boolean): boolean {
    const R = this.cutter.R
    const tri = this.tri
    const i0 = Math.max(0, Math.floor((x - R - this.ox) / this.cell))
    const i1 = Math.min(this.nx - 1, Math.floor((x + R - this.ox) / this.cell))
    const j0 = Math.max(0, Math.floor((y - R - this.oy) / this.cell))
    const j1 = Math.min(this.ny - 1, Math.floor((y + R - this.oy) / this.cell))
    if (i0 > i1 || j0 > j1) return false
    const mark = ++this.mark
    if (mark > 2e9) {
      this.stamp.fill(0)
      this.vStamp.fill(0)
      this.eStamp.fill(0)
      this.mark = 1
    }
    this.z = above
    this.hitTri = -1
    this.hitNz = 1
    // gather the facets under the tool with an upper bound on each one's contact; a facet whose
    // bound is below the best contact found so far cannot win
    let n = 0
    let best = -1
    let bestUb = -Infinity
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const c = j * this.nx + i
        // every facet in the cell is lower than `above`, so none can touch above it
        if (this.cellTop[c] <= above) continue
        if (any) {
          // No facet of this cell, seen from this cell, can touch above `above`. A facet that
          // reaches nearer the axis than the cell does is also listed in the cell that holds its
          // nearest point (inside the visited square), where it is tested; only the yes/no
          // answer of `clears` is needed, so the order does not matter.
          const cx = this.ox + i * this.cell
          const cy = this.oy + j * this.cell
          const ex = Math.max(0, cx - x, x - cx - this.cell)
          const ey = Math.max(0, cy - y, y - cy - this.cell)
          const d = Math.sqrt(ex * ex + ey * ey) - 1e-9
          if (d > R || this.cellTop[c] - this.h(Math.max(0, d)) <= above) continue
        }
        for (let q = this.start[c]; q < this.start[c + 1]; q++) {
          const t = this.items[q]
          if (this.stamp[t] === this.mark) continue
          this.stamp[t] = this.mark
          const o = t * STRIDE
          if (tri[o + 14] > x + R || tri[o + 16] < x - R || tri[o + 15] > y + R || tri[o + 17] < y - R) continue
          if (n === this.cand.length) {
            const c2 = new Int32Array(n * 2)
            c2.set(this.cand)
            this.cand = c2
            const z2 = new Float64Array(n * 2)
            z2.set(this.candZ)
            this.candZ = z2
          }
          // upper bound on this facet's contact: its highest corner, lowered by the cutter's
          // height at the facet's nearest XY distance from the axis
          const bx = Math.max(0, tri[o + 14] - x, x - tri[o + 16])
          const by = Math.max(0, tri[o + 15] - y, y - tri[o + 17])
          const ub = tri[o + 13] - this.h(Math.min(R, Math.sqrt(bx * bx + by * by)))
          if (ub <= above) continue
          if (ub > bestUb) {
            bestUb = ub
            best = n
          }
          this.cand[n] = t
          this.candZ[n++] = ub
        }
      }
    // test the most promising facet first, then every other one that could still beat it
    if (best >= 0) this.test(this.cand[best], x, y)
    if (any && this.hitTri >= 0) return true
    for (let q = 0; q < n; q++)
      if (q !== best && this.candZ[q] > this.z) {
        this.test(this.cand[q], x, y)
        if (any && this.hitTri >= 0) return true
      }
    return this.hitTri >= 0
  }

  /** All three contact kinds of one facet (corners and edges shared with facets already tested are skipped). */
  private test(t: number, x: number, y: number) {
    const tri = this.tri
    const o = t * STRIDE
    this.facet(t, x, y)
    for (let k = 0; k < 3; k++) {
      const v = this.mesh.indices[t * 3 + k]
      if (this.vStamp[v] === this.mark) continue
      this.vStamp[v] = this.mark
      this.vertex(t, tri[o + k * 3], tri[o + k * 3 + 1], tri[o + k * 3 + 2], x, y)
    }
    for (let k = 0; k < 3; k++) {
      const e = this.triEdge[t * 3 + k]
      if (this.eStamp[e] === this.mark) continue
      this.eStamp[e] = this.mark
      const a = o + k * 3
      const b = o + ((k + 1) % 3) * 3
      this.edge(t, tri[a], tri[a + 1], tri[a + 2], tri[b], tri[b + 1], tri[b + 2], x, y)
    }
  }

  /** Cutter height above the tip at distance d (d <= R). Same as `profileHeight`, without the lookups. */
  private h(d: number): number {
    switch (this.shape) {
      case 0: {
        const R = this.R
        return R - Math.sqrt(Math.max(0, R * R - d * d))
      }
      case 1:
        return 0
      case 3:
        return this.k * d
      default: {
        if (d <= this.flatR) return 0
        const e = Math.min(d - this.flatR, this.rc)
        return this.rc - Math.sqrt(Math.max(0, this.rc * this.rc - e * e))
      }
    }
  }

  private take(z: number, t: number, nz: number) {
    if (z > this.z) {
      this.z = z
      this.hitTri = t
      this.hitNz = nz
    }
  }

  private facet(t: number, x: number, y: number) {
    const tri = this.tri
    const o = t * STRIDE
    const nx = tri[o + 9], ny = tri[o + 10], nz = tri[o + 11]
    if (nz < 1e-9) return
    const c = this.cutter
    const nh = Math.sqrt(nx * nx + ny * ny)
    // contact distance from the axis, in the uphill direction u = -n_h / |n_h|
    let d = 0
    if (nh > 1e-12) {
      if (c.kind === 'v') d = nh / nz > c.k ? c.R : 0
      else d = c.R - c.rc + c.rc * nh // rc * sin(slope)
    }
    const px = nh > 1e-12 ? x - (d * nx) / nh : x
    const py = nh > 1e-12 ? y - (d * ny) / nh : y
    if (!insideXY(tri, o, px, py)) return
    const zPlane = (tri[o + 12] - nx * px - ny * py) / nz
    this.take(zPlane - this.h(d), t, nz)
  }

  private vertex(t: number, vx: number, vy: number, vz: number, x: number, y: number) {
    const dx = vx - x
    const dy = vy - y
    const d2 = dx * dx + dy * dy
    if (d2 > this.R * this.R) return
    const d = Math.sqrt(d2)
    const z = vz - this.h(d)
    if (z > this.z) this.take(z, t, profileNz(this.cutter, d))
  }

  /** Tip height with the tool touching the edge at parameter s, or -Infinity outside [lo, hi]. */
  private edgeAt(s: number, x0: number, y0: number, z0: number, bx: number, by: number, ez: number, x: number, y: number): number {
    const dx = x0 + s * bx - x
    const dy = y0 + s * by - y
    const d = Math.min(this.R, Math.sqrt(dx * dx + dy * dy))
    return z0 + s * ez - this.h(d)
  }

  private edgeTake(t: number, s: number, lo: number, hi: number, x0: number, y0: number, z0: number, bx: number, by: number, ez: number, x: number, y: number) {
    if (!(s >= lo && s <= hi)) return
    const z = this.edgeAt(s, x0, y0, z0, bx, by, ez, x, y)
    if (z <= this.z) return
    const dx = x0 + s * bx - x
    const dy = y0 + s * by - y
    this.take(z, t, profileNz(this.cutter, Math.min(this.R, Math.sqrt(dx * dx + dy * dy))))
  }

  private edge(t: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, x: number, y: number) {
    if (Math.max(z0, z1) <= this.z) return
    const R = this.R
    const bx = x1 - x0
    const by = y1 - y0
    const B = bx * bx + by * by
    if (B < 1e-18) return // vertical edge: its top corner is the highest contact
    const ez = z1 - z0
    const ax = x0 - x
    const ay = y0 - y
    const ab = ax * bx + ay * by
    const aa = ax * ax + ay * ay
    // part of the edge within the tool radius: B s^2 + 2 ab s + aa - R^2 <= 0
    const disc = ab * ab - B * (aa - R * R)
    if (disc < 0) return
    const sq = Math.sqrt(disc)
    const lo = Math.max(0, (-ab - sq) / B)
    const hi = Math.min(1, (-ab + sq) / B)
    if (lo > hi) return
    const p2 = Math.max(0, aa - (ab * ab) / B) // squared distance from the axis to the edge's line
    // no point of this part of the edge is nearer the axis than its line, nor higher than its ends
    if (Math.max(z0 + lo * ez, z0 + hi * ez) - this.h(Math.min(R, Math.sqrt(p2))) <= this.z) return
    switch (this.shape) {
      case 0: {
        // ball: the centre height along the edge is concave; its maximum solves a closed form
        if (p2 >= R * R) return
        const u = ez * Math.sqrt((R * R - p2) / (1 + (ez * ez) / B))
        this.edgeTake(t, (u - ab) / B, lo, hi, x0, y0, z0, bx, by, ez, x, y)
        break
      }
      case 3: {
        const k = this.k
        if (k * k * B > ez * ez && p2 > 0) {
          const u = (ez * Math.sqrt(p2)) / Math.sqrt(k * k - (ez * ez) / B)
          this.edgeTake(t, (u - ab) / B, lo, hi, x0, y0, z0, bx, by, ez, x, y)
        }
        break
      }
      case 2: {
        // bull-nose: z(s) - h(d(s)) is concave (h convex and increasing, d convex), so a
        // golden-section search finds its maximum
        let a = lo
        let b = hi
        const g = 0.6180339887498949
        let m1 = b - g * (b - a)
        let m2 = a + g * (b - a)
        let f1 = this.edgeAt(m1, x0, y0, z0, bx, by, ez, x, y)
        let f2 = this.edgeAt(m2, x0, y0, z0, bx, by, ez, x, y)
        // stop at 1e-6 mm along the edge: the height error is then far below 1e-9 mm (the
        // function is flat at its maximum)
        const stop = 1e-6 / Math.sqrt(B)
        for (let i = 0; i < 60 && b - a > stop; i++) {
          if (f1 < f2) {
            a = m1
            m1 = m2
            f1 = f2
            m2 = a + g * (b - a)
            f2 = this.edgeAt(m2, x0, y0, z0, bx, by, ez, x, y)
          } else {
            b = m2
            m2 = m1
            f2 = f1
            m1 = b - g * (b - a)
            f1 = this.edgeAt(m1, x0, y0, z0, bx, by, ez, x, y)
          }
        }
        this.edgeTake(t, (a + b) / 2, lo, hi, x0, y0, z0, bx, by, ez, x, y)
        break
      }
      // flat end: the bottom disc touches the highest point of the edge inside the radius,
      // which is one of the ends of that part of the edge (taken below)
    }
    this.edgeTake(t, lo, lo, hi, x0, y0, z0, bx, by, ez, x, y)
    this.edgeTake(t, hi, lo, hi, x0, y0, z0, bx, by, ez, x, y)
  }
}

/** Is (px, py) inside the facet seen from above? Edges count as inside. */
function insideXY(tri: Float64Array, o: number, px: number, py: number): boolean {
  const ax = tri[o], ay = tri[o + 1]
  const bx = tri[o + 3], by = tri[o + 4]
  const cx = tri[o + 6], cy = tri[o + 7]
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  if (Math.abs(area) < 1e-14) return false
  const s = area > 0 ? 1 : -1
  const eps = -1e-12 * Math.abs(area)
  const w0 = s * ((bx - ax) * (py - ay) - (by - ay) * (px - ax))
  if (w0 < eps) return false
  const w1 = s * ((cx - bx) * (py - by) - (cy - by) * (px - bx))
  if (w1 < eps) return false
  const w2 = s * ((ax - cx) * (py - cy) - (ay - cy) * (px - cx))
  return w2 >= eps
}
