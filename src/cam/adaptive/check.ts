/**
 * Independent engagement check for clearing at one level: for every straight cutting move, the
 * width of cut it really takes = the area of material it removes (its swept disc, less the
 * material that earlier moves removed, by exact Clipper2 booleans) divided by its length. This
 * shares nothing with the raster the adaptive generator plans on.
 *
 * Also flags full-width moves: where material covers the whole leading half of the tool at the end
 * of the move (as when cutting a slot).
 */
import type { P } from '../geom'
import { clipPolys, polyArea, sweptPolys, unionPolys } from '../kernel'
import type { Toolpath } from '../toolpath'

export interface EngagementMove {
  /** Index into the toolpath's moves. */
  i: number
  /** Width of cut (removed area / length), mm. */
  width: number
  len: number
  /** Material covers at least 95 % of the leading half of the tool. */
  full: boolean
  /** Inside a flagged trochoidal section. */
  flagged: boolean
}

export interface EngagementReport {
  moves: EngagementMove[]
  /** Largest width of cut outside flagged sections, and inside them. */
  max: number
  maxFlagged: number
  /** Full-width moves outside flagged sections. */
  fullOutside: number
  /** Material removed at the level, mm². */
  removed: number
}

/** Check the moves of `tp` at level z (part Z) against `material` (filled polygons), tool radius r. */
export function checkEngagement(tp: Toolpath, r: number, material: P[][], z: number, opt: { minLength?: number } = {}): EngagementReport {
  const minLen = opt.minLength ?? 0.05
  const flaggedAt = (i: number) => (tp.sections ?? []).some((s) => i >= s.from && i < s.to)
  // what earlier moves removed at the level, as one union per square tile (tiles never overlap)
  const T = Math.max(4 * r, 2)
  const tiles = new Map<string, P[][]>()
  const tileBox = (i: number, j: number): P[][] => [[{ x: i * T, y: j * T }, { x: (i + 1) * T, y: j * T }, { x: (i + 1) * T, y: (j + 1) * T }, { x: i * T, y: (j + 1) * T }]]
  const tilesOf = (a: P, b: P) => {
    const out: [number, number][] = []
    for (let j = Math.floor((Math.min(a.y, b.y) - r) / T); j <= Math.floor((Math.max(a.y, b.y) + r) / T); j++)
      for (let i = Math.floor((Math.min(a.x, b.x) - r) / T); i <= Math.floor((Math.max(a.x, b.x) + r) / T); i++) out.push([i, j])
    return out
  }
  const add = (cap: P[][], a: P, b: P) => {
    for (const [i, j] of tilesOf(a, b)) {
      const part = clipPolys('intersect', cap, tileBox(i, j))
      if (!part.length) continue
      const k = `${i},${j}`
      const cur = tiles.get(k)
      // (merged outlines thinned to 0.0002 mm: far below what the widths are compared at)
      tiles.set(k, cur ? unionPolys([...cur, ...part], 0.0002) : part)
    }
  }
  const nearby = (a: P, b: P) => tilesOf(a, b).flatMap(([i, j]) => tiles.get(`${i},${j}`) ?? [])
  const inside = (polys: P[][], p: P) => {
    let n = false
    for (const poly of polys)
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i]
        const b = poly[j]
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) n = !n
      }
    return n
  }
  const atLevel = (v: number) => Math.abs(v - z) < 1e-6

  const out: EngagementMove[] = []
  let removed = 0
  let at: { x: number; y: number; z: number } | null = null
  const visit = (i: number, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, cutting: boolean) => {
    // only moves with the tip at the level remove material at it
    if (!(atLevel(a.z) || a.z < z) || !(atLevel(b.z) || b.z < z)) return
    const cap = sweptPolys([[a, b]], r, 0.0005)
    const before = nearby(a, b)
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (cutting && len >= minLen) {
      let fresh = clipPolys('intersect', cap, material)
      if (before.length && fresh.length) fresh = clipPolys('subtract', fresh, before)
      const area = fresh.reduce((n, p) => n + polyArea(p), 0)
      removed += area
      // material over the leading half of the tool at the end of the move
      const ux = (b.x - a.x) / len
      const uy = (b.y - a.y) / len
      let lead = 0
      let mat = 0
      for (let k = 0; k < 72; k++) {
        const ang = (2 * Math.PI * (k + 0.5)) / 72
        const cx = Math.cos(ang)
        const cy = Math.sin(ang)
        if (cx * ux + cy * uy <= 0) continue
        lead++
        const p = { x: b.x + cx * r * 0.999, y: b.y + cy * r * 0.999 }
        if (inside(material, p) && !inside(before, p)) mat++
      }
      out.push({ i, width: area / len, len, full: lead > 0 && mat / lead >= 0.95, flagged: flaggedAt(i) })
    }
    add(cap, a, b)
  }
  tp.moves.forEach((m, i) => {
    if (m.t === 'poly' || m.t === 'drill') {
      at = null
      return
    }
    const b = { x: m.x, y: m.y, z: m.z }
    if (at && m.t !== 'rapid') {
      if (m.t === 'arc') {
        // entry helix turns: they remove material (counted for later moves) but are not checked
        const rr = Math.hypot(at.x - m.cx, at.y - m.cy)
        let a0 = Math.atan2(at.y - m.cy, at.x - m.cx)
        let a1 = Math.atan2(m.y - m.cy, m.x - m.cx)
        if (m.ccw && a1 <= a0 + 1e-12) a1 += 2 * Math.PI
        if (!m.ccw && a1 >= a0 - 1e-12) a1 -= 2 * Math.PI
        const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 0.05))
        let p = at
        for (let k = 1; k <= n; k++) {
          const t = a0 + ((a1 - a0) * k) / n
          const q = { x: m.cx + rr * Math.cos(t), y: m.cy + rr * Math.sin(t), z: at.z + ((m.z - at.z) * k) / n }
          visit(i, p, q, false)
          p = q
        }
      } else visit(i, at, b, m.f === 'cut')
    }
    at = b
  })
  const outside = out.filter((m) => !m.flagged)
  const inside_ = out.filter((m) => m.flagged)
  return {
    moves: out,
    max: outside.reduce((n, m) => Math.max(n, m.width), 0),
    maxFlagged: inside_.reduce((n, m) => Math.max(n, m.width), 0),
    fullOutside: outside.filter((m) => m.full).length,
    removed,
  }
}
