import type { SimpleMove, Toolpath } from '../src/cam/toolpath'

const r3 = (n: number) => Math.round(n * 1000) / 1000

/** Stable summary of a 2D toolpath (Stage 1 goldens; 3D chains use `digest3d`): counts, lengths, extents, depths and native intents. */
export function digest(tp: Toolpath) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let zMin = Infinity
  const count = { rapid: 0, feed: 0, arc: 0, drill: 0 }
  const moves = tp.moves as SimpleMove[]
  for (const m of moves) {
    count[m.t]++
    if (m.t === 'rapid') continue
    minX = Math.min(minX, m.x)
    minY = Math.min(minY, m.y)
    maxX = Math.max(maxX, m.x)
    maxY = Math.max(maxY, m.y)
    zMin = Math.min(zMin, m.z)
  }
  const intents: Record<string, number> = {}
  for (const it of tp.intents) intents[it.k] = (intents[it.k] ?? 0) + 1
  return {
    op: tp.name,
    kind: tp.kind,
    tool: tp.tool?.number ?? null,
    moves: count,
    cutMm: Math.round(tp.stats.cut * 10) / 10,
    box: Number.isFinite(minX) ? [r3(minX), r3(minY), r3(maxX), r3(maxY)] : null,
    zMin: Number.isFinite(zMin) ? r3(zMin) : null,
    intents,
    warnings: tp.warnings,
    first: moves.slice(0, 4).map((m) => ({ ...m, x: r3(m.x), y: r3(m.y), z: r3(m.z) })),
  }
}

/**
 * Stable summary of a 3D toolpath for goldens under tests/golden/cam3d: move and point counts,
 * cut length, 3D extents, warnings, and a hash of every move rounded to 0.001 mm (so any change
 * to any point changes the golden).
 */
export function digest3d(tp: Toolpath) {
  const count = { rapid: 0, feed: 0, arc: 0, drill: 0, poly: 0, points: 0 }
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  let h = 0x811c9dc5
  const mix = (s: string) => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  }
  const visit = (t: string, x: number, y: number, z: number) => {
    mix(`${t}${r3(x)},${r3(y)},${r3(z)};`)
    if (t === 'r') return
    for (const [k, v] of [x, y, z].entries()) {
      lo[k] = Math.min(lo[k], v)
      hi[k] = Math.max(hi[k], v)
    }
  }
  for (const m of tp.moves) {
    count[m.t]++
    if (m.t === 'poly') {
      count.points += m.pts.length / 3
      for (let i = 0; i < m.pts.length; i += 3) visit('p', m.pts[i], m.pts[i + 1], m.pts[i + 2])
    } else visit(m.t[0], m.x, m.y, m.z)
  }
  return {
    op: tp.name,
    kind: tp.kind,
    tool: tp.tool?.number ?? null,
    moves: count,
    cutMm: Math.round(tp.stats.cut * 10) / 10,
    box: Number.isFinite(lo[0]) ? [...lo, ...hi].map(r3) : null,
    warnings: tp.warnings,
    hash: (h >>> 0).toString(16).padStart(8, '0'),
  }
}
