/**
 * Drop-cutter round a rotary axis (M3.3, 3D-10): the tool stands square to the axis, pointing at
 * it, and is lowered in towards the axis until it touches the model. For each angle the model is
 * turned so the tool's direction is straight up, and the existing exact drop-cutter
 * (`DropCutter`: facet inside, corners and edges) is run on the facets the tool can reach at that
 * angle. The result is the tip's distance from the axis.
 *
 * Facets are indexed by the angles round the axis they span (widened by how far round the tool
 * reaches at their distance from the axis), so an angle only turns the facets near it. Turned
 * meshes are kept for the most recent angles (`keep`).
 */
import type { Mesh } from '../mesh/types'
import type { RotarySetup } from '../types'
import { type Cutter3D } from '../3d/cutter'
import { DropCutter } from '../3d/dropcutter'
import { axisFrame } from './frame'

const TWO_PI = Math.PI * 2

export class RotaryDrop {
  readonly cutter: Cutter3D
  private readonly n: number
  private readonly ix: Uint32Array
  /** Per vertex: along the axis, and the two coordinates across it (e0, e1). */
  private readonly vu: Float64Array
  private readonly q0: Float64Array
  private readonly q1: Float64Array
  /** Per facet: its extent along the axis. */
  private readonly tu0: Float64Array
  private readonly tu1: Float64Array
  private readonly nb: number
  private readonly buckets: Int32Array[]
  private readonly keep: number
  private readonly cache = new Map<number, DropCutter | null>()
  /** Turned meshes made so far (for tests and progress). */
  built = 0

  constructor(mesh: Mesh, setup: Pick<RotarySetup, 'axis' | 'centre'>, cutter: Cutter3D, opt: { buckets?: number; keep?: number } = {}) {
    this.cutter = cutter
    const f = axisFrame(setup.axis)
    const c = [setup.centre.x, setup.centre.y, setup.centre.z]
    const p = mesh.positions
    const nv = p.length / 3
    this.vu = new Float64Array(nv)
    this.q0 = new Float64Array(nv)
    this.q1 = new Float64Array(nv)
    for (let v = 0; v < nv; v++) {
      const x = p[v * 3]
      const y = p[v * 3 + 1]
      const z = p[v * 3 + 2]
      const d = [x - c[0], y - c[1], z - c[2]]
      this.vu[v] = x * f.a[0] + y * f.a[1] + z * f.a[2]
      this.q0[v] = d[0] * f.e0[0] + d[1] * f.e0[1] + d[2] * f.e0[2]
      this.q1[v] = d[0] * f.e1[0] + d[1] * f.e1[1] + d[2] * f.e1[2]
    }
    this.ix = mesh.indices
    this.n = mesh.indices.length / 3
    this.tu0 = new Float64Array(this.n)
    this.tu1 = new Float64Array(this.n)
    for (let t = 0; t < this.n; t++) {
      const a = this.vu[this.ix[t * 3]]
      const b = this.vu[this.ix[t * 3 + 1]]
      const c2 = this.vu[this.ix[t * 3 + 2]]
      this.tu0[t] = Math.min(a, b, c2)
      this.tu1[t] = Math.max(a, b, c2)
    }
    this.nb = Math.max(8, opt.buckets ?? 720)
    this.keep = Math.max(2, opt.keep ?? 96)
    const lists: number[][] = Array.from({ length: this.nb }, () => [])
    const R = cutter.R
    const w = TWO_PI / this.nb
    for (let t = 0; t < this.n; t++) {
      const a = this.ix[t * 3]
      const b = this.ix[t * 3 + 1]
      const cc = this.ix[t * 3 + 2]
      const dmin = originDist(this.q0[a], this.q1[a], this.q0[b], this.q1[b], this.q0[cc], this.q1[cc])
      let lo: number
      let hi: number
      if (dmin <= R + 1e-9) {
        // near the axis: the tool can meet it from any angle
        lo = 0
        hi = TWO_PI
      } else {
        const span = arcOf([Math.atan2(this.q1[a], this.q0[a]), Math.atan2(this.q1[b], this.q0[b]), Math.atan2(this.q1[cc], this.q0[cc])])
        const reach = Math.asin(Math.min(1, R / dmin))
        lo = span[0] - reach
        hi = span[1] + reach
      }
      if (hi - lo >= TWO_PI - w) {
        for (let k = 0; k < this.nb; k++) lists[k].push(t)
        continue
      }
      const k0 = Math.floor(lo / w)
      const k1 = Math.floor(hi / w)
      for (let k = k0; k <= k1; k++) lists[((k % this.nb) + this.nb) % this.nb].push(t)
    }
    this.buckets = lists.map((l) => Int32Array.from(l))
  }

  /** The drop-cutter for the tool at angle `theta` (radians): the reachable facets turned so the tool points down -Z. */
  at(theta: number): DropCutter | null {
    const key = Math.round((((theta % TWO_PI) + TWO_PI) % TWO_PI) * 1e9)
    const hit = this.cache.get(key)
    if (hit !== undefined) {
      // most recently used last
      this.cache.delete(key)
      this.cache.set(key, hit)
      return hit
    }
    const dc = this.build(theta)
    this.cache.set(key, dc)
    if (this.cache.size > this.keep) this.cache.delete(this.cache.keys().next().value!)
    return dc
  }

  private build(theta: number, near?: number): DropCutter | null {
    const w = TWO_PI / this.nb
    const th = ((theta % TWO_PI) + TWO_PI) % TWO_PI
    const list = this.buckets[Math.min(this.nb - 1, Math.floor(th / w))]
    const ct = Math.cos(theta)
    const st = Math.sin(theta)
    const R = this.cutter.R
    const remap = new Map<number, number>()
    const pos: number[] = []
    const idx: number[] = []
    const Y = (v: number) => -this.q0[v] * st + this.q1[v] * ct
    const Z = (v: number) => this.q0[v] * ct + this.q1[v] * st
    for (let q = 0; q < list.length; q++) {
      const t = list[q]
      // (one drop: only the facets within the tool's reach along the axis)
      if (near !== undefined && (this.tu0[t] > near + R || this.tu1[t] < near - R)) continue
      const a = this.ix[t * 3]
      const b = this.ix[t * 3 + 1]
      const c = this.ix[t * 3 + 2]
      const ya = Y(a)
      const yb = Y(b)
      const yc = Y(c)
      if (Math.min(ya, yb, yc) > R || Math.max(ya, yb, yc) < -R) continue
      if (Math.max(Z(a), Z(b), Z(c)) <= 0) continue
      for (const v of [a, b, c]) {
        let k = remap.get(v)
        if (k === undefined) {
          k = pos.length / 3
          remap.set(v, k)
          pos.push(this.vu[v], Y(v), Z(v))
        }
        idx.push(k)
      }
    }
    if (near === undefined) this.built++
    if (!idx.length) return null
    return new DropCutter({ positions: Float32Array.from(pos), indices: Uint32Array.from(idx) }, this.cutter)
  }

  /**
   * Tip's distance from the axis where the tool at `u` along the axis and angle `theta` first
   * touches the model coming in; NaN when it touches nothing.
   */
  drop(u: number, theta: number): number {
    const dc = this.at(theta)
    return dc && dc.drop(u, 0) ? dc.z : NaN
  }

  /**
   * The same as `drop`, for a single point at an angle not otherwise needed: turns only the facets
   * near it and keeps nothing (much quicker than `drop` for an angle met once).
   */
  dropOnce(u: number, theta: number): number {
    const key = Math.round((((theta % TWO_PI) + TWO_PI) % TWO_PI) * 1e9)
    const hit = this.cache.get(key)
    if (hit !== undefined) return hit && hit.drop(u, 0) ? hit.z : NaN
    const dc = this.build(theta, u)
    return dc && dc.drop(u, 0) ? dc.z : NaN
  }
}

/** Distance from the origin to a triangle in the plane. */
function originDist(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  // inside: 0
  const d1 = ax * by - ay * bx
  const d2 = bx * cy - by * cx
  const d3 = cx * ay - cy * ax
  if ((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)) return 0
  return Math.min(segDist(ax, ay, bx, by), segDist(bx, by, cx, cy), segDist(cx, cy, ax, ay))
}

function segDist(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  const t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0
  return Math.hypot(ax + dx * t, ay + dy * t)
}

/** Smallest arc [lo, hi] (radians, hi - lo < 2π) holding the angles. */
function arcOf(a: number[]): [number, number] {
  const s = a.map((x) => ((x % TWO_PI) + TWO_PI) % TWO_PI).sort((p, q) => p - q)
  let gap = s[0] + TWO_PI - s[s.length - 1]
  let start = s[0]
  for (let i = 1; i < s.length; i++)
    if (s[i] - s[i - 1] > gap) {
      gap = s[i] - s[i - 1]
      start = s[i]
    }
  return [start, start + TWO_PI - gap]
}
