import type { Toolpath } from '../src/cam/toolpath'

const r3 = (n: number) => Math.round(n * 1000) / 1000

/** Stable summary of a toolpath: counts, lengths, extents, depths and native intents. */
export function digest(tp: Toolpath) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let zMin = Infinity
  const count = { rapid: 0, feed: 0, arc: 0, drill: 0 }
  for (const m of tp.moves) {
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
    first: tp.moves.slice(0, 4).map((m) => ({ ...m, x: r3(m.x), y: r3(m.y), z: r3(m.z) })),
  }
}
