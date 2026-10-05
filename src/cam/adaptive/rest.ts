/**
 * 2D rest machining (2D-07): the material earlier operations left inside a pocket, worked out from
 * their actual toolpaths (the area each tool swept at the pocket's depth, by Clipper2 booleans),
 * and the pocket's own passes cut down to the pieces that reach some of it.
 *
 * Swept areas lean towards "less removed": arcs of the swept outline lie inside the true circle,
 * and a tool that is narrower higher up (ball, bull-nose, V) counts with its narrowest width over
 * each move. So the rest is never smaller than what was really left.
 */
import { atLength, type Contour, contourLength, type P, toPoints } from '../geom'
import { clipPolys, inflatePolys, polyArea, sweptPolys } from '../kernel'
import type { Cutter3D } from '../3d/cutter'
import type { SimpleMove } from '../toolpath'

/** A finished toolpath as a source of removed material. */
export interface SweepSource {
  moves: Iterable<SimpleMove>
  cutter: Cutter3D
}

/** Slivers of rest thinner than twice this are ignored (mm). */
const SLIVER = 0.005
/** Rest pieces smaller than this are ignored (mm²). */
const MIN_AREA = 1e-4

/** Radius of the cutter at height h above its tip (0 below the tip). */
export function radiusAt(c: Cutter3D, h: number): number {
  if (h < 0) return 0
  if (c.kind === 'v') return Math.min(c.R, h / c.k)
  const flat = c.R - c.rc
  if (h >= c.rc) return c.R
  return flat + Math.sqrt(Math.max(0, c.rc * c.rc - (c.rc - h) * (c.rc - h)))
}

/**
 * Area the sources removed at height z (part Z, 0 = face 1, down negative): every cutting move
 * whose tool tip is at or below z, each part of a move with the tool's width at z.
 */
export function sweptAt(sources: SweepSource[], z: number): P[][] {
  const out: P[][] = []
  for (const src of sources) {
    // chains of moves below z, grouped by the (rounded down) width they cut at z
    const byR = new Map<number, P[][]>()
    let cur: P[] | null = null
    let curR = -1
    const flush = () => {
      if (cur && cur.length) {
        const list = byR.get(curR) ?? []
        list.push(cur)
        byR.set(curR, list)
      }
      cur = null
      curR = -1
    }
    const piece = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
      // part of the move with the tip at or below z
      let t0 = 0
      let t1 = 1
      if (az > z && bz > z) return flush()
      if (az > z) t0 = (az - z) / (az - bz)
      if (bz > z) t1 = (z - az) / (bz - az)
      const p0 = { x: ax + (bx - ax) * t0, y: ay + (by - ay) * t0 }
      const p1 = { x: ax + (bx - ax) * t1, y: ay + (by - ay) * t1 }
      const hiTip = Math.max(az + (bz - az) * t0, az + (bz - az) * t1)
      const r = Math.floor(radiusAt(src.cutter, z - hiTip) * 1e4) / 1e4
      if (!(r > 0)) return flush()
      // carry on the chain only when this move continues it (same width, from its last point)
      if (cur && r === curR && t0 === 0) cur.push(p1)
      else {
        flush()
        cur = [p0, p1]
        curR = r
      }
      if (t1 < 1) flush()
    }
    let at: { x: number; y: number; z: number } | null = null
    for (const m of src.moves) {
      if (m.t === 'rapid' || m.t === 'drill') {
        flush()
        at = { x: m.x, y: m.y, z: m.z }
        continue
      }
      if (!at) {
        at = { x: m.x, y: m.y, z: m.z }
        continue
      }
      if (m.t === 'feed') piece(at.x, at.y, at.z, m.x, m.y, m.z)
      else {
        // arc (helical when z changes): short chords, inside the true arc by at most 0.001 mm
        const r = Math.hypot(at.x - m.cx, at.y - m.cy)
        let a0 = Math.atan2(at.y - m.cy, at.x - m.cx)
        let a1 = Math.atan2(m.y - m.cy, m.x - m.cx)
        if (m.ccw && a1 <= a0 + 1e-12) a1 += 2 * Math.PI
        if (!m.ccw && a1 >= a0 - 1e-12) a1 -= 2 * Math.PI
        // a full circle (start = end) is a whole turn
        if (Math.hypot(m.x - at.x, m.y - at.y) < 1e-9) a1 = a0 + (m.ccw ? 2 * Math.PI : -2 * Math.PI)
        const step = r > 0.001 ? 2 * Math.acos(Math.max(-1, 1 - 0.001 / r)) : Math.PI
        const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / step))
        let px = at.x
        let py = at.y
        let pz = at.z
        for (let i = 1; i <= n; i++) {
          const a = a0 + ((a1 - a0) * i) / n
          const qx = i === n ? m.x : m.cx + r * Math.cos(a)
          const qy = i === n ? m.y : m.cy + r * Math.sin(a)
          const qz = at.z + ((m.z - at.z) * i) / n
          piece(px, py, pz, qx, qy, qz)
          px = qx
          py = qy
          pz = qz
        }
      }
      at = { x: m.x, y: m.y, z: m.z }
    }
    flush()
    for (const [r, paths] of byR) out.push(...sweptPolys(paths, r))
  }
  return out
}

/**
 * Material left at one height: the target area (`target`, filled polygons) minus what the sources
 * swept, without slivers, limited to what a tool of radius r can reach from `centres` (the area
 * its centre may cover).
 */
export function restAt(target: P[][], swept: P[][], centres: P[][], r: number): P[][] {
  if (!target.length) return []
  let rest = swept.length ? clipPolys('subtract', target, swept) : target
  rest = inflatePolys(inflatePolys(rest, -SLIVER), SLIVER)
  const reach = inflatePolys(centres, r, 'round', 0.001)
  if (!reach.length) return []
  return clipPolys('intersect', rest, reach).filter((p) => Math.abs(polyArea(p)) > MIN_AREA)
}

/** Even-odd point test against polygons with bounding boxes. */
export class PolySet {
  private readonly polys: { pts: P[]; minX: number; minY: number; maxX: number; maxY: number }[]
  constructor(polys: P[][]) {
    this.polys = polys.map((pts) => {
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const p of pts) {
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }
      return { pts, minX, minY, maxX, maxY }
    })
  }
  get empty() {
    return this.polys.length === 0
  }
  has(p: P): boolean {
    let inside = false
    for (const q of this.polys) {
      if (p.x < q.minX || p.x > q.maxX || p.y < q.minY || p.y > q.maxY) continue
      const pts = q.pts
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i]
        const b = pts[j]
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
      }
    }
    return inside
  }
}

/** A piece of a pass to keep: arc-length range along the pass, and how much of it cuts. */
export interface RestPiece {
  d0: number
  d1: number
  /** The whole closed pass is kept. */
  whole: boolean
  /** Length along which the tool touches rest material, mm. */
  cutLength: number
  /** The tool already touches rest material at the start (it needs a proper entry). */
  startsInMaterial: boolean
}

/**
 * The pieces of a pass (`c`, a tool-centre path) whose centre lies in `zone`, with their cutting
 * length measured against `touch` (centres where the tool reaches rest material). Ends are found
 * to 0.001 mm by bisection. Pieces cutting less than `minLength` are dropped.
 */
export function restPieces(c: Contour, zone: PolySet, touch: PolySet, minLength: number, ds = 0.05): RestPiece[] {
  const L = contourLength(c)
  if (!(L > 0) || zone.empty) return []
  const n = Math.max(2, Math.ceil(L / ds))
  // closed passes wrap round (a piece across the seam starts before 0)
  const at = (d: number) => atLength(c, c.closed ? ((d % L) + L) % L : Math.min(L, Math.max(0, d))).p
  const ins: boolean[] = []
  for (let i = 0; i <= n; i++) ins.push(zone.has(at((L * i) / n)))
  const edge = (a: number, b: number, aIn: boolean) => {
    // a and b straddle the zone edge; return the end of the piece on the inside
    let lo = a
    let hi = b
    for (let k = 0; k < 16 && Math.abs(hi - lo) > 0.001; k++) {
      const m = (lo + hi) / 2
      if (zone.has(at(m)) === aIn) lo = m
      else hi = m
    }
    return aIn ? lo : hi
  }
  const cutLen = (d0: number, d1: number) => {
    const k = Math.max(1, Math.ceil((d1 - d0) / ds))
    let len = 0
    for (let i = 0; i < k; i++) if (touch.has(at(d0 + ((d1 - d0) * (i + 0.5)) / k))) len += (d1 - d0) / k
    return len
  }
  const out: RestPiece[] = []
  if (ins.every(Boolean)) {
    const cl = cutLen(0, L)
    if (cl >= minLength && cl > 0) out.push({ d0: 0, d1: L, whole: c.closed, cutLength: cl, startsInMaterial: touch.has(at(0)) })
    return out
  }
  // runs of inside samples; a closed pass may have one run across its seam
  const runs: [number, number][] = []
  let i = 0
  while (i <= n) {
    if (!ins[i]) {
      i++
      continue
    }
    const s = i
    while (i + 1 <= n && ins[i + 1]) i++
    const d0 = s === 0 ? 0 : edge((L * s) / n, (L * (s - 1)) / n, true)
    const d1 = i === n ? L : edge((L * i) / n, (L * (i + 1)) / n, true)
    runs.push([d0, d1])
    i++
  }
  if (c.closed && runs.length > 1 && ins[0] && ins[n]) {
    const last = runs.pop()!
    runs[0] = [last[0] - L, runs[0][1]]
  }
  for (const [d0, d1] of runs) {
    if (d1 - d0 < 1e-6) continue
    const cl = cutLen(d0, d1)
    if (cl > 0 && cl >= minLength) out.push({ d0, d1, whole: false, cutLength: cl, startsInMaterial: touch.has(at(d0)) })
  }
  return out
}

/** Filled polygons of closed contours (tessellated within 0.001 mm). */
export function contourPolys(cs: Contour[]): P[][] {
  return cs.filter((c) => c.closed && c.segs.length).map((c) => toPoints(c, 0.001))
}
