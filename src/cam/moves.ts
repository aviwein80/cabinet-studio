/**
 * Small helpers on the toolpath move list, shared by the generator and the simulator (kept apart
 * so the simulator does not load the generator).
 */
import type { Move, SimpleMove } from './toolpath'

/** Rapid rate assumed for times, mm/min. */
export const RAPID_RATE = 40000

/**
 * Every move with 3D chains expanded into single feed moves (generated on the fly, not stored); a
 * 5-axis chain's tool directions go onto its feed moves (`a`).
 */
export function* simpleMoves(moves: Move[]): Generator<SimpleMove> {
  for (const m of moves) {
    if (m.t !== 'poly') {
      yield m
      continue
    }
    const ax = m.axes
    if (ax) for (let i = 0; i + 2 < m.pts.length; i += 3) yield { t: 'feed', x: m.pts[i], y: m.pts[i + 1], z: m.pts[i + 2], f: m.f, a: [ax[i], ax[i + 1], ax[i + 2]] }
    else for (let i = 0; i + 2 < m.pts.length; i += 3) yield { t: 'feed', x: m.pts[i], y: m.pts[i + 1], z: m.pts[i + 2], f: m.f }
  }
}
