/**
 * Thread milling (NEW-08, M3.2): a single-profile thread mill runs a helix round each picked
 * circle, one pitch down (or up) per turn, inside a hole (internal thread) or round a boss
 * (external), in radial passes out to the full thread depth.
 *
 * The helix is written as half-turn arcs (and a last part turn), each dropping exactly its share
 * of the pitch, so the pitch and the thread's length are exact in the toolpath. Hand and direction
 * decide which way round the tool goes: a right-hand thread climbs counter-clockwise (seen from
 * above), so cutting it top-down runs clockwise. With the spindle turning clockwise, counter-
 * clockwise round the inside of a hole (or clockwise round a boss) is climb milling.
 *
 * Lengths in mm. The tooth's cutting point is the toolpath's Z (tool tip); the tool's radius is to
 * the tooth's tip.
 */
import type { P } from '../geom'
import type { Move } from '../toolpath'

export interface ThreadParams {
  side: 'internal' | 'external'
  /** Major (nominal) diameter of the thread, mm. */
  diameter: number
  pitch: number
  hand: 'right' | 'left'
  /** Top-down (from face 1 down to the thread's length) or bottom-up. */
  travel: 'down' | 'up'
  /** Thread length below face 1, mm. */
  length: number
  /** Thread depth (radial, from the major to the minor diameter), mm. */
  depth: number
  /** Radial passes out to the full depth (the last at full depth); an extra pass at full depth with `spring`. */
  passes: number
  spring?: boolean
}

/** ISO metric basic profile (ISO 68-1): fundamental triangle height H = 0.866 P. */
export const ISO_H = Math.sqrt(3) / 2
/** Basic thread depth, internal (5/8 H) and external (17/24 H), as a share of the pitch. */
export const isoDepth = (side: ThreadParams['side'], pitch: number) => (side === 'internal' ? (5 / 8) * ISO_H : (17 / 24) * ISO_H) * pitch

/** Minor diameter: the core hole for an internal thread, the root for an external one. */
export const minorDiameter = (t: Pick<ThreadParams, 'diameter' | 'depth'>) => t.diameter - 2 * t.depth

/** Counter-clockwise seen from above? (right-hand threads climb counter-clockwise) */
export const turnsCcw = (t: Pick<ThreadParams, 'hand' | 'travel'>) => (t.hand === 'right') === (t.travel === 'up')

/** Climb milling with the spindle turning clockwise? */
export const isClimb = (t: Pick<ThreadParams, 'hand' | 'travel' | 'side'>) => (t.side === 'internal' ? turnsCcw(t) : !turnsCcw(t))

export interface ThreadPlan {
  moves: Move[]
  /** Tool-centre radius of each radial pass (the last is at full depth). */
  radii: number[]
  warnings: string[]
}

/**
 * The moves for one thread round centre `c`, tool radius `rt` (to the tooth tip). `safe` and
 * `rapid` are the clearance and rapid-down heights above face 1.
 */
export function threadMoves(c: P, t: ThreadParams, rt: number, safe: number, rapid: number): ThreadPlan {
  const warnings: string[] = []
  const P_ = t.pitch
  const L = t.length
  const internal = t.side === 'internal'
  const R0 = t.diameter / 2
  const h = Math.min(Math.max(0, t.depth), R0)
  const n = Math.max(1, Math.round(t.passes))
  // the tooth's tip on the thread's root at the last pass: inside, the major radius; outside, the minor
  const radii: number[] = []
  for (let k = 1; k <= n; k++) {
    const reach = (h * k) / n
    radii.push(internal ? R0 - h + reach - rt : R0 - reach + rt)
  }
  if (t.spring) radii.push(radii[radii.length - 1])
  const moves: Move[] = []
  const ccw = turnsCcw(t)
  const zStart = t.travel === 'down' ? 0 : -L
  const zEnd = t.travel === 'down' ? -L : 0
  const turns = L / P_
  const sweep = 2 * Math.PI * turns
  // edge feed: the tooth's tip runs at the programmed feed, so the centre runs slower inside a hole
  // and faster round a boss (k on the moves)
  for (const R of radii) {
    if (!(R > 1e-6)) {
      warnings.push(`The tool (Ø${(2 * rt).toFixed(2)}) is too big for this thread: it cannot get round inside it.`)
      break
    }
    const k = internal ? R / (R + rt) : R / (R - rt)
    const at = (a: number) => ({ x: c.x + R * Math.cos(a), y: c.y + R * Math.sin(a) })
    const a0 = 0
    const S = at(a0)
    // way in: inside, from the centre along a half circle onto the helix; outside, from out beyond
    // the boss straight in
    const outR = R + 2 * rt + 2
    const entry = internal ? c : { x: c.x + outR, y: c.y }
    moves.push({ t: 'rapid', x: entry.x, y: entry.y, z: safe })
    moves.push({ t: 'rapid', x: entry.x, y: entry.y, z: rapid })
    if (internal) {
      moves.push({ t: 'feed', x: c.x, y: c.y, z: zStart, f: 'plunge' })
      // half circle of radius R/2 from the centre to S, turning the way the helix turns
      moves.push({ t: 'arc', x: S.x, y: S.y, z: zStart, cx: (c.x + S.x) / 2, cy: (c.y + S.y) / 2, ccw, f: 'cut', k })
    } else {
      moves.push({ t: 'feed', x: entry.x, y: entry.y, z: zStart, f: 'plunge' })
      moves.push({ t: 'feed', x: S.x, y: S.y, z: zStart, f: 'cut' })
    }
    // the helix: half turns, then what is left, each dropping (or rising) its exact share of the pitch
    const dir = ccw ? 1 : -1
    let done = 0
    while (done < sweep - 1e-12) {
      const step = Math.min(Math.PI, sweep - done)
      done += step
      const z = zStart + (zEnd - zStart) * (done / sweep)
      const q = at(a0 + dir * done)
      moves.push({ t: 'arc', x: q.x, y: q.y, z: Math.abs(done - sweep) < 1e-12 ? zEnd : z, cx: c.x, cy: c.y, ccw, f: 'cut', k })
    }
    const E = at(a0 + dir * sweep)
    // way out: back to the centre (inside) or straight out (outside), then up
    if (internal) moves.push({ t: 'arc', x: c.x, y: c.y, z: zEnd, cx: (c.x + E.x) / 2, cy: (c.y + E.y) / 2, ccw, f: 'cut', k })
    else {
      const o = { x: c.x + ((E.x - c.x) * outR) / R, y: c.y + ((E.y - c.y) * outR) / R }
      moves.push({ t: 'feed', x: o.x, y: o.y, z: zEnd, f: 'cut' })
    }
    const last = moves[moves.length - 1] as { x: number; y: number }
    moves.push({ t: 'rapid', x: last.x, y: last.y, z: safe })
  }
  return { moves, radii, warnings }
}
