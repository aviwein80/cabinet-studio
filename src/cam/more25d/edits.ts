/**
 * Toolpath edits (NEW-11) and hand-drawn toolpaths (NEW-09). Pure functions on the move list.
 *
 * Edits are applied to the unedited toolpath every time it is calculated: point edits first (by
 * anchor), then the rapid height, the corner slow-down and the reverse. A point edit's anchor is
 * the move's number in the unedited toolpath and where that move ended; when the toolpath changes,
 * the edit goes to the move that now ends at the same point (nearest in number), or is lost. Lost
 * edits are counted, so the operation can be flagged and its output refused.
 */
import type { P } from '../geom'
import type { Move, SimpleMove } from '../toolpath'
import type { Levels, ManualOp, MoveAnchor, ToolpathEdits } from '../types'

type Arc = Extract<SimpleMove, { t: 'arc' }>
type Feed = Extract<SimpleMove, { t: 'feed' }>
type V = { x: number; y: number; z: number }

const r3 = (n: number) => Math.round(n * 1000) / 1000
/** Points this close count as the same end point when an anchor is moved (mm). */
export const ANCHOR_TOL = 0.01

/** Hash of a move list rounded to 0.001 mm (which toolpath the point edits were made on). */
export function movesHash(moves: Iterable<SimpleMove>): string {
  let h = 0x811c9dc5
  const mix = (s: string) => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  }
  for (const m of moves) mix(`${m.t[0]}${r3(m.x)},${r3(m.y)},${r3(m.z)};`)
  return (h >>> 0).toString(36)
}

/** Anchor for move `i` of an (unedited) move list. */
export function anchorOf(moves: SimpleMove[], i: number): MoveAnchor {
  const m = moves[i]
  return { i, x: r3(m.x), y: r3(m.y), z: r3(m.z) }
}

/**
 * Where an anchor lands in `moves`: the same number when the toolpath is the one the edit was made
 * on, else the move ending at the anchor's point nearest in number, else null (lost).
 */
export function locate(moves: SimpleMove[], a: MoveAnchor, same: boolean): number | null {
  const at = (j: number) => Math.abs(moves[j].x - a.x) <= ANCHOR_TOL && Math.abs(moves[j].y - a.y) <= ANCHOR_TOL && Math.abs(moves[j].z - a.z) <= ANCHOR_TOL
  if (same && a.i < moves.length && at(a.i)) return a.i
  let best: number | null = null
  for (let j = 0; j < moves.length; j++) if (at(j) && (best === null || Math.abs(j - a.i) < Math.abs(best - a.i))) best = j
  return best
}

/** Is a move one that cuts (feed or arc, not a plunge or lead)? */
const cutting = (m: SimpleMove): m is Feed | Arc => (m.t === 'feed' || m.t === 'arc') && m.f === 'cut'

/** Sweep (radians, signed) of an arc from `a`. */
function sweepOf(a: V, m: Arc): number {
  let sw = Math.atan2(m.y - m.cy, m.x - m.cx) - Math.atan2(a.y - m.cy, a.x - m.cx)
  if (m.ccw) while (sw <= 1e-12) sw += Math.PI * 2
  else while (sw >= -1e-12) sw -= Math.PI * 2
  return sw
}

/** Length in plan of a move from `a`. */
function planLength(a: V, m: SimpleMove): number {
  if (m.t === 'arc') return Math.abs(sweepOf(a, m)) * Math.hypot(a.x - m.cx, a.y - m.cy)
  return Math.hypot(m.x - a.x, m.y - a.y)
}

/** Unit direction of travel at the start (t = 0) or end (t = 1) of a move from `a`. */
function tangent(a: V, m: SimpleMove, end: boolean): P | null {
  if (m.t === 'arc') {
    const p = end ? m : a
    const rx = p.x - m.cx
    const ry = p.y - m.cy
    const l = Math.hypot(rx, ry) || 1
    return m.ccw ? { x: -ry / l, y: rx / l } : { x: ry / l, y: -rx / l }
  }
  const l = Math.hypot(m.x - a.x, m.y - a.y)
  return l > 1e-9 ? { x: (m.x - a.x) / l, y: (m.y - a.y) / l } : null
}

/** The part of a move from `a` between fractions t0 and t1 of its length. */
function piece(a: V, m: Feed | Arc, t0: number, t1: number): { from: V; move: Feed | Arc } {
  const z = (t: number) => a.z + (m.z - a.z) * t
  if (m.t === 'feed') {
    const at = (t: number): V => ({ x: a.x + (m.x - a.x) * t, y: a.y + (m.y - a.y) * t, z: z(t) })
    const e = t1 >= 1 ? { x: m.x, y: m.y, z: m.z } : at(t1)
    return { from: at(t0), move: { ...m, ...e } }
  }
  const sw = sweepOf(a, m)
  const r = Math.hypot(a.x - m.cx, a.y - m.cy)
  const a0 = Math.atan2(a.y - m.cy, a.x - m.cx)
  const at = (t: number): V => ({ x: m.cx + r * Math.cos(a0 + sw * t), y: m.cy + r * Math.sin(a0 + sw * t), z: z(t) })
  const e = t1 >= 1 ? { x: m.x, y: m.y, z: m.z } : at(t1)
  return { from: at(t0), move: { ...m, ...e } }
}

/**
 * Slow down near corners (a turn of `angle` degrees or more between two cutting moves, or an arc
 * tighter than `distance` that turns that much, counted at its middle): within
 * `distance` mm of the corner, in `steps` equal bands, the feed rises from `percent` % at the corner
 * back to full. Moves are split at the band edges; each piece gets its band's factor.
 */
export function slowCorners(moves: SimpleMove[], c: { angle: number; distance: number; steps: number; percent: number }, start: V = { x: 0, y: 0, z: 50 }): { moves: SimpleMove[]; corners: number } {
  const d = Math.max(0, c.distance)
  const steps = Math.max(1, Math.round(c.steps))
  const pct = Math.min(100, Math.max(1, c.percent)) / 100
  if (d <= 0 || pct >= 1) return { moves, corners: 0 }
  // position along the cutting runs of every move's start and end, and the corners
  const from: V[] = []
  const s0: number[] = []
  const s1: number[] = []
  const corners: number[] = []
  let at: V = start
  let s = 0
  let prev: SimpleMove | null = null
  let prevFrom: V | null = null
  for (const m of moves) {
    from.push(at)
    if (cutting(m)) {
      if (!prev || !cutting(prev)) s += 1e6 // a new run: far from every corner of the last one
      if (prev && cutting(prev) && prevFrom) {
        const ti = tangent(prevFrom, prev, true)
        const to = tangent(at, m, false)
        if (ti && to) {
          const turn = (Math.acos(Math.max(-1, Math.min(1, ti.x * to.x + ti.y * to.y))) * 180) / Math.PI
          if (turn >= c.angle - 1e-9) corners.push(s)
        }
      }
      s0.push(s)
      const len = planLength(at, m)
      // a rolled corner: an arc tighter than the slow-down distance that turns at least the angle
      if (m.t === 'arc' && Math.hypot(at.x - m.cx, at.y - m.cy) < d && (Math.abs(sweepOf(at, m)) * 180) / Math.PI >= c.angle - 1e-9) corners.push(s + len / 2)
      s += len
      s1.push(s)
    } else {
      s0.push(NaN)
      s1.push(NaN)
    }
    prev = m
    prevFrom = at
    at = m.t === 'drill' ? { x: m.x, y: m.y, z: m.r } : { x: m.x, y: m.y, z: m.z }
  }
  if (!corners.length) return { moves, corners: 0 }
  const band = d / steps
  const factor = (pos: number) => {
    let k = 1
    for (const cp of corners) {
      const dist = Math.abs(pos - cp)
      if (dist < d - 1e-12) k = Math.min(k, pct + ((1 - pct) * Math.floor(dist / band)) / steps)
    }
    return k
  }
  const out: SimpleMove[] = []
  moves.forEach((m, i) => {
    if (!cutting(m) || !(s1[i] > s0[i])) {
      out.push(m)
      return
    }
    const a = s0[i]
    const b = s1[i]
    const cuts = new Set<number>()
    for (const cp of corners) for (let j = -steps; j <= steps; j++) {
      const q = cp + j * band
      if (q > a + 1e-9 && q < b - 1e-9) cuts.add(q)
    }
    const bounds = [a, ...[...cuts].sort((x, y) => x - y), b]
    for (let j = 0; j + 1 < bounds.length; j++) {
      const t0 = (bounds[j] - a) / (b - a)
      const t1 = (bounds[j + 1] - a) / (b - a)
      const k = factor((bounds[j] + bounds[j + 1]) / 2) * (m.k ?? 1)
      const { move } = piece(from[i], m, t0, t1)
      out.push(k !== 1 ? { ...move, k } : (({ k: _k, ...rest }) => rest)(move as Feed & { k?: number }))
    }
  })
  return { moves: out, corners: corners.length }
}

/**
 * Run a toolpath backwards: the cutting runs (moves between rapids) in reverse order, each the
 * other way. A run is entered from above its old end (rapid to the safe height and down to the
 * rapid height, then straight down at the plunge feed) and left back up where it used to start.
 * Drilling stays as it is.
 */
export function reverseMoves(moves: SimpleMove[], levels: Pick<Levels, 'safeZ' | 'rapidZ'>, start: V = { x: 0, y: 0, z: 50 }): { moves: SimpleMove[]; plunges: number[] } {
  type Run = { from: V; moves: SimpleMove[] }
  const runs: Run[] = []
  const drills: SimpleMove[] = []
  let at: V = start
  let cur: Run | null = null
  for (const m of moves) {
    if (m.t === 'rapid' || m.t === 'drill') {
      if (cur) runs.push(cur)
      cur = null
      if (m.t === 'drill') drills.push(m)
    } else {
      if (!cur) cur = { from: at, moves: [] }
      cur.moves.push(m)
    }
    at = m.t === 'drill' ? { x: m.x, y: m.y, z: m.r } : { x: m.x, y: m.y, z: m.z }
  }
  if (cur) runs.push(cur)
  const out: SimpleMove[] = [...drills]
  const plunges: number[] = []
  let p: V = drills.length ? (({ x, y, r }) => ({ x, y, z: r }))(drills[drills.length - 1] as Extract<SimpleMove, { t: 'drill' }>) : start
  const rapid = (x: number, y: number, z: number) => {
    if (Math.abs(x - p.x) < 1e-9 && Math.abs(y - p.y) < 1e-9 && Math.abs(z - p.z) < 1e-9) return
    out.push({ t: 'rapid', x, y, z })
    p = { x, y, z }
  }
  for (const run of [...runs].reverse()) {
    const pts: V[] = [run.from, ...run.moves.map((m) => ({ x: m.x, y: m.y, z: m.z }))]
    const end = pts[pts.length - 1]
    // up, over, down to the rapid height above the old end, then straight down into it
    rapid(p.x, p.y, Math.max(p.z, levels.safeZ))
    rapid(end.x, end.y, Math.max(p.z, levels.safeZ))
    const over = Math.max(0, end.z) + levels.rapidZ
    rapid(end.x, end.y, over)
    if (end.z < over - 1e-9) {
      out.push({ t: 'feed', x: end.x, y: end.y, z: end.z, f: 'plunge' })
      if (end.z < 0) plunges.push(-end.z)
    }
    for (let i = run.moves.length - 1; i >= 0; i--) {
      const m = run.moves[i]
      const to = pts[i]
      if (m.t === 'arc') out.push({ ...m, x: to.x, y: to.y, z: to.z, ccw: !m.ccw })
      else out.push({ ...(m as Feed), x: to.x, y: to.y, z: to.z, f: (m as Feed).f === 'plunge' ? 'lead' : (m as Feed).f })
    }
    p = { ...run.from }
  }
  rapid(p.x, p.y, Math.max(p.z, levels.safeZ))
  const tidy = out
  return { moves: tidy, plunges }
}

export interface EditReport {
  moves: SimpleMove[]
  /** Point edits applied as made, moved to a new move, and lost. */
  applied: number
  moved: number
  lost: number
  corners: number
  warnings: string[]
  /** Heights edited point by point: the native macros no longer match. */
  zEdited: boolean
  reversed: boolean
}

/**
 * Apply edits to an unedited move list. `tool` limits are used to refuse a reverse that would
 * plunge straight down deeper than the tool may.
 */
export function applyEdits(moves0: Move[], e: ToolpathEdits, levels: Levels, tool: { centreCutting?: boolean; maxPlunge?: number; number: number } | null): EditReport {
  let moves: SimpleMove[] = []
  for (const m of moves0) {
    if (m.t !== 'poly') moves.push(m)
    else for (let i = 0; i + 2 < m.pts.length; i += 3) moves.push({ t: 'feed', x: m.pts[i], y: m.pts[i + 1], z: m.pts[i + 2], f: m.f })
  }
  const warnings: string[] = []
  const same = !!e.base && e.base === movesHash(moves)
  let applied = 0
  let moved = 0
  let lost = 0
  const place = (a: MoveAnchor): number | null => {
    const j = locate(moves, a, same)
    if (j === null) lost++
    else if (same && j === a.i) applied++
    else moved++
    return j
  }
  // point edits on the unedited list (anchors refer to it)
  const zs = new Map<number, number>()
  for (const z of e.z ?? []) {
    const j = place(z.at)
    if (j !== null) zs.set(j, z.z)
  }
  const ks = new Map<number, number>()
  for (const f of e.feeds ?? []) {
    const a = locate(moves, f.from, same)
    const b = locate(moves, f.to, same)
    if (a === null || b === null) {
      lost++
      continue
    }
    if (same && a === f.from.i && b === f.to.i) applied++
    else moved++
    for (let j = Math.min(a, b); j <= Math.max(a, b); j++) ks.set(j, (ks.get(j) ?? 1) * (Math.max(1, f.percent) / 100))
  }
  if (zs.size || ks.size)
    moves = moves.map((m, j) => {
      let out = m
      if (zs.has(j)) out = { ...out, z: zs.get(j)! } as SimpleMove
      if (ks.has(j) && (out.t === 'feed' || out.t === 'arc')) out = { ...out, k: (out.k ?? 1) * ks.get(j)! }
      return out
    })
  if (lost) warnings.push(`${lost} toolpath edit(s) no longer match the recalculated toolpath and are not applied: check them, then keep or clear them.`)
  else if (moved) warnings.push(`${moved} toolpath edit(s) moved to the matching moves of the recalculated toolpath.`)
  if (ks.size) warnings.push('Feed edits are not written to woodWOP (its contour macro keeps one feed); they show in the simulation and times.')
  // rapid height
  if (e.rapidHeight !== undefined && e.rapidHeight >= 0) {
    const h = e.rapidHeight
    moves = moves.map((m) => (m.t === 'rapid' && m.z >= levels.safeZ - 1e-9 ? { ...m, z: h } : m))
    if (h < levels.rapidZ) warnings.push(`Moves between cuts at ${h} mm, below the rapid-down height ${levels.rapidZ} mm: check them in the simulation.`)
    warnings.push('woodWOP makes its own moves between passes: the rapid height edit is not written.')
  }
  // corners
  let corners = 0
  if (e.corners) {
    const r = slowCorners(moves, e.corners)
    moves = r.moves
    corners = r.corners
    if (corners) warnings.push(`Slowed down at ${corners} corner(s) to ${e.corners.percent} % of the feed.`)
  }
  // reverse
  let reversed = false
  if (e.reverse) {
    const r = reverseMoves(moves, levels)
    const deepest = Math.max(0, ...r.plunges)
    if (tool && tool.centreCutting === false && deepest > 0) warnings.push(`Not reversed: T${tool.number} is not centre-cutting and would plunge straight down at the new starts.`)
    else if (tool?.maxPlunge && deepest > tool.maxPlunge + 1e-9) warnings.push(`Not reversed: the new starts plunge straight down ${r3(deepest)} mm, deeper than T${tool.number} may (${tool.maxPlunge} mm).`)
    else {
      moves = r.moves
      reversed = true
      if (deepest > 0) warnings.push(`Reversed: each cut now starts by plunging straight down (up to ${r3(deepest)} mm) where it used to finish.`)
    }
  }
  return { moves, applied, moved, lost, corners, warnings, zEdited: zs.size > 0, reversed }
}

/**
 * Arc from `a` through `m` to `b` (three points on a circle): centre and direction, or null when
 * the points lie on a line.
 */
export function arcThrough(a: P, m: P, b: P): { cx: number; cy: number; ccw: boolean } | null {
  const d = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y))
  if (Math.abs(d) < 1e-9) return null
  const a2 = a.x * a.x + a.y * a.y
  const m2 = m.x * m.x + m.y * m.y
  const b2 = b.x * b.x + b.y * b.y
  const cx = (a2 * (m.y - b.y) + m2 * (b.y - a.y) + b2 * (a.y - m.y)) / d
  const cy = (a2 * (b.x - m.x) + m2 * (a.x - b.x) + b2 * (m.x - a.x)) / d
  // counter-clockwise when the through point is to the right of a -> b (the arc bulges that way)
  const ccw = (b.x - a.x) * (m.y - a.y) - (b.y - a.y) * (m.x - a.x) < 0
  return { cx, cy, ccw }
}

/** Where the tool is after the steps of a hand-drawn toolpath (its start when there are none). */
export function manualEnd(op: Pick<ManualOp, 'start' | 'steps'>): V {
  const s = op.steps[op.steps.length - 1]
  return s ? { x: s.x, y: s.y, z: s.z } : { ...op.start }
}

/**
 * Add a step to a hand-drawn toolpath, picked on the drawing at `p` (the tool's height there is
 * `z`). The first pick sets the start. An arc needs the point it passes through (`through`, the
 * pick before the end).
 */
export function appendStep(op: ManualOp, kind: 'feed' | 'rapid' | 'arc', p: P, z: number, through?: P): ManualOp | { error: string } {
  if (!op.steps.length && op.start.x === 0 && op.start.y === 0 && op.start.z === 0 && kind !== 'arc') return { ...op, start: { x: p.x, y: p.y, z } }
  const from = manualEnd(op)
  if (kind === 'arc') {
    if (!through) return { error: 'Pick the point the arc passes through, then its end.' }
    const c = arcThrough(from, through, p)
    if (!c) return { error: 'The three points of the arc lie on a line: pick a point off the line.' }
    return { ...op, steps: [...op.steps, { k: 'arc', x: p.x, y: p.y, z, cx: c.cx, cy: c.cy, ccw: c.ccw }] }
  }
  return { ...op, steps: [...op.steps, { k: kind, x: p.x, y: p.y, z }] }
}

/** Remove the last step (or, with none left, the start). */
export function undoStep(op: ManualOp): ManualOp {
  if (op.steps.length) return { ...op, steps: op.steps.slice(0, -1) }
  return { ...op, start: { x: 0, y: 0, z: 0 } }
}

/**
 * Re-attach point edits to a recalculated (unedited) toolpath: every edit whose move can still be
 * found gets the new move's number and the new hash; edits that cannot be found are dropped and
 * counted.
 */
export function reanchor(e: ToolpathEdits, unedited: SimpleMove[]): { edits: ToolpathEdits; dropped: number } {
  const same = !!e.base && e.base === movesHash(unedited)
  let dropped = 0
  const re = (a: MoveAnchor): MoveAnchor | null => {
    const j = locate(unedited, a, same)
    if (j === null) return null
    return anchorOf(unedited, j)
  }
  const z: NonNullable<ToolpathEdits['z']> = []
  for (const x of e.z ?? []) {
    const at = re(x.at)
    if (at) z.push({ ...x, at })
    else dropped++
  }
  const feeds: NonNullable<ToolpathEdits['feeds']> = []
  for (const f of e.feeds ?? []) {
    const from = re(f.from)
    const to = re(f.to)
    if (from && to) feeds.push({ ...f, from, to })
    else dropped++
  }
  const { z: _z, feeds: _f, base: _b, ...rest } = e
  return { edits: { ...rest, ...(z.length ? { z } : {}), ...(feeds.length ? { feeds } : {}), ...(z.length || feeds.length ? { base: movesHash(unedited) } : {}) }, dropped }
}
