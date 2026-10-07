/**
 * What we do with an engine's 5-axis toolpath (M3.5), whatever engine made it:
 * - check it is something we can use: straight moves only (rapid, feed, 3D chains), every one with a
 *   finite tool direction of unit length;
 * - cut it as made, reversed, or there and back (NEW-26);
 * - measure the tool axis: largest tilt from vertical, largest turn per mm on cutting moves.
 *
 * Pure: no DOM, no React.
 */
import { simpleMoves } from '../moves'
import type { FeedKind, Move, ToolAxis } from '../toolpath'
import type { MultiAxisOp } from '../types'
import { angleDeg, tiltDeg } from './axis'

/** A point of a 5-axis toolpath and the move that arrives at it. */
export interface AxisNode {
  x: number
  y: number
  z: number
  a: ToolAxis
  /** 'rapid', or the feed kind. */
  kind: 'rapid' | FeedKind
  k?: number
}

/** Why an engine's moves cannot be used (empty = fine). */
export function engineMoveProblems(moves: readonly Move[]): string[] {
  const out = new Set<string>()
  if (!moves.length) out.add('it returned no moves')
  const okAxis = (a: readonly number[] | undefined) => !!a && a.length === 3 && a.every(Number.isFinite) && Math.abs(Math.hypot(a[0], a[1], a[2]) - 1) <= 1e-6
  for (const m of moves) {
    if (m.t === 'arc' || m.t === 'drill') out.add('it returned arcs or drill cycles (a 5-axis toolpath is straight moves only)')
    else if (m.t === 'poly') {
      if (!m.pts.every(Number.isFinite)) out.add('a position is not a number')
      if (!m.axes || m.axes.length !== m.pts.length) out.add('a move has no tool direction')
      else for (let i = 0; i < m.axes.length; i += 3) if (!okAxis([m.axes[i], m.axes[i + 1], m.axes[i + 2]])) out.add('a tool direction is not a unit vector')
    } else {
      if (![m.x, m.y, m.z].every(Number.isFinite)) out.add('a position is not a number')
      if (!m.a) out.add('a move has no tool direction')
      else if (!okAxis(m.a)) out.add('a tool direction is not a unit vector')
    }
  }
  return [...out]
}

/** The toolpath as points with the move arriving at each. */
export function axisNodes(moves: readonly Move[]): AxisNode[] {
  const out: AxisNode[] = []
  for (const m of simpleMoves(moves as Move[])) {
    if (m.t !== 'rapid' && m.t !== 'feed') continue
    const a = m.a ?? ([0, 0, 1] as const)
    out.push(m.t === 'rapid' ? { x: m.x, y: m.y, z: m.z, a, kind: 'rapid' } : { x: m.x, y: m.y, z: m.z, a, kind: m.f, ...(m.k ? { k: m.k } : {}) })
  }
  return out
}

/** Points back into moves: runs of cutting points as 3D chains with their directions. */
export function nodesToMoves(nodes: readonly AxisNode[]): Move[] {
  const out: Move[] = []
  let i = 0
  while (i < nodes.length) {
    const n = nodes[i]
    if (n.kind === 'cut' && !n.k) {
      let j = i
      while (j < nodes.length && nodes[j].kind === 'cut' && !nodes[j].k) j++
      if (j - i > 1) {
        const pts = new Float64Array((j - i) * 3)
        const axes = new Float64Array((j - i) * 3)
        for (let q = i; q < j; q++) {
          pts.set([nodes[q].x, nodes[q].y, nodes[q].z], (q - i) * 3)
          axes.set(nodes[q].a, (q - i) * 3)
        }
        out.push({ t: 'poly', pts, f: 'cut', axes })
        i = j
        continue
      }
    }
    out.push(n.kind === 'rapid' ? { t: 'rapid', x: n.x, y: n.y, z: n.z, a: n.a } : { t: 'feed', x: n.x, y: n.y, z: n.z, f: n.kind, a: n.a, ...(n.k ? { k: n.k } : {}) })
    i++
  }
  return out
}

/**
 * The same points run backwards: each move keeps its kind, a way in becomes a way out and back
 * (plunge and lead swap); the first point is reached by a rapid.
 */
export function reversedNodes(nodes: readonly AxisNode[]): AxisNode[] {
  const n = nodes.length
  if (!n) return []
  const swap = (k: AxisNode['kind']): AxisNode['kind'] => (k === 'plunge' ? 'lead' : k === 'lead' ? 'plunge' : k)
  const node = (p: AxisNode, kind: AxisNode['kind'], k?: number): AxisNode => (k ? { x: p.x, y: p.y, z: p.z, a: p.a, kind, k } : { x: p.x, y: p.y, z: p.z, a: p.a, kind })
  const out: AxisNode[] = [node(nodes[n - 1], 'rapid')]
  // the move that arrived at point i now leaves it, back to point i - 1
  for (let j = 1; j < n; j++) out.push(node(nodes[n - 1 - j], swap(nodes[n - j].kind), nodes[n - j].k))
  return out
}

/** Cut as made, reversed, or there and back (NEW-26). */
export function withDirection(moves: Move[], direction: MultiAxisOp['direction']): Move[] {
  if (direction === 'forward') return moves
  const fwd = axisNodes(moves)
  const back = reversedNodes(fwd)
  if (direction === 'reversed') return nodesToMoves(back)
  // there and back: the way back starts where the way there ended
  return nodesToMoves([...fwd, ...back.slice(1)])
}

/** Largest tilt from vertical anywhere, and the largest turn of the axis per mm along cutting moves (degrees). */
export function axisStats(moves: readonly Move[]): { maxTilt: number; maxTurn: number; points: number } {
  let maxTilt = 0
  let maxTurn = 0
  let prev: AxisNode | null = null
  const nodes = axisNodes(moves)
  for (const n of nodes) {
    maxTilt = Math.max(maxTilt, tiltDeg(n.a))
    if (prev && n.kind === 'cut') {
      const d = Math.hypot(n.x - prev.x, n.y - prev.y, n.z - prev.z)
      if (d > 1e-6) maxTurn = Math.max(maxTurn, angleDeg(prev.a, n.a) / d)
    }
    prev = n
  }
  return { maxTilt, maxTurn, points: nodes.length }
}
