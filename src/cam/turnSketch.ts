/**
 * Turn-by-turn sketch (CAD-02): an outline described element by element from a start point, each
 * a line (length, direction) or an arc (radius, sweep, which way it turns), with the direction
 * given absolutely or as the turn from the element before (0 = tangent; the first element's value
 * is always its direction). Values left unknown are
 * worked out by the constraint solver (`solver.ts`) so that the outline closes; blends and
 * chamfers are put on the corners afterwards.
 *
 * Closing a shape gives two equations (the end meets the start in X and Y), so a closed outline
 * takes two unknowns. Fewer is fine (the values are checked); more cannot be decided and is
 * reported. Some outlines have more than one answer (two unknown directions: the elbow can bend
 * either way); every answer found is returned in a fixed order and the chosen one is used.
 */
import { arc, chamferCorner, type Contour, filletCorner, line, type P } from './geom'
import { type Constraint, solve } from './solver'
import type { TurnElement, TurnSketch } from './types'

export interface Unknown {
  element: number
  field: 'length' | 'angle' | 'radius'
  value: number
}

export interface TurnSolution {
  contour: Contour
  /** Values worked out for the unknowns, element by element. */
  unknowns: Unknown[]
  /** Heading at the start of each element and at its end (degrees). */
  headings: { start: number; end: number }[]
  /** Corner points before blends and chamfers (element i runs from points[i] to points[i + 1]). */
  points: P[]
}

export type TurnResult =
  | { ok: true; solution: TurnSolution; solutions: TurnSolution[]; pick: number; warnings: string[] }
  | { ok: false; error: string; unknowns: number; equations: number }

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

/** Number of unknown values in a sketch. */
export function unknownCount(sk: TurnSketch): number {
  return sk.elements.reduce((n, e) => n + Number(e.length === null) + Number(e.angle === null) + Number(e.kind === 'arc' && e.radius === null), 0)
}

/** Plain-words description of what is missing or wrong, or null when the sketch can be solved. */
export function sketchProblem(sk: TurnSketch): string | null {
  if (sk.elements.length < (sk.closed ? 2 : 1)) return sk.closed ? 'A closed outline needs at least two elements.' : 'Add an element.'
  for (const [i, e] of sk.elements.entries()) {
    if (e.length !== null && !(e.length > 0)) return `Element ${i + 1}: ${e.kind === 'arc' ? 'the sweep' : 'the length'} must be above zero.`
    if (e.kind === 'arc' && e.length !== null && e.length >= 360) return `Element ${i + 1}: the sweep must be under 360°.`
    if (e.kind === 'arc' && e.radius !== null && e.radius !== undefined && !(e.radius > 0)) return `Element ${i + 1}: the radius must be above zero.`
  }
  const n = unknownCount(sk)
  const eq = sk.closed ? 2 : 0
  if (n > eq) return `${n} unknown values but ${sk.closed ? 'closing the outline' : 'an open chain'} works out only ${eq}: give ${n - eq} more.`
  return null
}

interface Plan {
  constraints: Constraint[]
  points: { id: string; x: number; y: number; fixed?: boolean }[]
  scalars: Record<string, number>
}

/**
 * Walk the chain with known values and guesses for the unknowns to get starting points for the
 * solver. `guess` gives the starting heading for unknown directions: i -> degrees.
 */
function plan(sk: TurnSketch, guessAngle: (i: number, prevEnd: number, at: P) => number): Plan {
  const els = sk.elements
  const known = els.filter((e) => e.kind === 'line' && e.length !== null).map((e) => e.length as number)
  const typical = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 100
  const points: Plan['points'] = [{ id: 'p0', x: sk.start.x, y: sk.start.y, fixed: true }]
  const scalars: Record<string, number> = {}
  const constraints: Constraint[] = []
  let at = { ...sk.start }
  let prevEnd = 0
  const n = els.length
  for (let i = 0; i < n; i++) {
    const e = els[i]
    const from = `p${i}`
    const to = sk.closed && i === n - 1 ? 'p0' : `p${i + 1}`
    // heading at the start of this element
    const h = `h${i}`
    let hv: number
    if (e.angle === null) {
      hv = guessAngle(i, prevEnd, at)
      scalars[h] = hv
    } else if (e.angleMode === 'absolute' || i === 0) {
      hv = e.angle
      scalars[h] = hv
      constraints.push({ k: 'lin', terms: [{ v: h, c: 1 }], value: e.angle })
    } else {
      hv = prevEnd + e.angle
      scalars[h] = hv
      // h_i = end heading of the element before + turn
      const p = els[i - 1]
      const terms: { v: number | string; c: number }[] = [{ v: h, c: 1 }, { v: `h${i - 1}`, c: -1 }]
      if (p.kind === 'arc') terms.push({ v: `l${i - 1}`, c: p.ccw ? -1 : 1 })
      constraints.push({ k: 'lin', terms, value: e.angle })
    }
    const l = `l${i}`
    const lenGuess = e.kind === 'arc' ? 90 : typical
    const lv = e.length ?? lenGuess
    scalars[l] = lv
    if (e.length !== null) constraints.push({ k: 'lin', terms: [{ v: l, c: 1 }], value: e.length })
    let end: P
    let endHeading = hv
    if (e.kind === 'line') {
      constraints.push({ k: 'polar', a: from, b: to, len: l, ang: h })
      end = { x: at.x + lv * Math.cos(rad(hv)), y: at.y + lv * Math.sin(rad(hv)) }
    } else {
      const r = `r${i}`
      const rv = e.radius ?? typical / 2
      scalars[r] = rv
      if (e.radius !== null && e.radius !== undefined) constraints.push({ k: 'lin', terms: [{ v: r, c: 1 }], value: e.radius })
      constraints.push({ k: 'chord', a: from, b: to, ang: h, r, sweep: l, ccw: !!e.ccw })
      const t = rad(hv) + (e.ccw ? rad(lv) / 2 : -rad(lv) / 2)
      const L = 2 * rv * Math.sin(rad(lv) / 2)
      end = { x: at.x + L * Math.cos(t), y: at.y + L * Math.sin(t) }
      endHeading = hv + (e.ccw ? lv : -lv)
    }
    if (to !== 'p0') points.push({ id: to, x: end.x, y: end.y })
    at = end
    prevEnd = endHeading
  }
  return { constraints, points, scalars }
}

function build(sk: TurnSketch, pts: Record<string, P>, sc: Record<string, number>): TurnSolution | string {
  const els = sk.elements
  const n = els.length
  const segs = []
  const points: P[] = []
  const headings: { start: number; end: number }[] = []
  const unknowns: Unknown[] = []
  for (let i = 0; i < n; i++) {
    const e = els[i]
    const a = pts[`p${i}`]
    const b = pts[sk.closed && i === n - 1 ? 'p0' : `p${i + 1}`]
    points.push(a)
    const h = sc[`h${i}`]
    const l = sc[`l${i}`]
    if (e.kind === 'line') {
      if (!(l > 1e-6)) return `element ${i + 1} would be ${l.toFixed(3)} mm long`
      segs.push(line(a, b))
      headings.push({ start: h, end: h })
    } else {
      const r = sc[`r${i}`]
      if (!(r > 1e-6)) return `element ${i + 1} would have radius ${r.toFixed(3)} mm`
      if (!(l > 1e-6 && l < 360 - 1e-6)) return `element ${i + 1} would sweep ${l.toFixed(3)}°`
      const nrm = rad(h) + (e.ccw ? Math.PI / 2 : -Math.PI / 2)
      const c = { x: a.x + r * Math.cos(nrm), y: a.y + r * Math.sin(nrm) }
      segs.push(arc(a, b, c, !!e.ccw))
      headings.push({ start: h, end: h + (e.ccw ? l : -l) })
      if (e.radius === null) unknowns.push({ element: i, field: 'radius', value: r })
    }
    if (e.length === null) unknowns.push({ element: i, field: 'length', value: l })
    if (e.angle === null) unknowns.push({ element: i, field: 'angle', value: norm360(h) })
  }
  if (!sk.closed) points.push(pts[`p${n}`])
  else points.push(pts.p0)
  unknowns.sort((x, y) => x.element - y.element || x.field.localeCompare(y.field))
  let contour: Contour = { closed: sk.closed, segs }
  // corners: the end of element i is corner i + 1 (the start of the closed outline is corner 0 = n)
  const corners = els.map((e, i) => ({ i: i + 1, c: e.corner })).filter((x) => x.c && x.c.size > 0 && (sk.closed || x.i < n))
  for (const { i, c } of corners.sort((x, y) => y.i - x.i)) {
    const before = contour.segs.length
    contour = c!.kind === 'blend' ? filletCorner(contour, i, c!.size) : chamferCorner(contour, i, c!.size)
    if (contour.segs.length === before && c!.size > 0) return `the ${c!.kind} at the end of element ${i} (${c!.size} mm) does not fit`
  }
  return { contour, unknowns, headings, points }
}

const norm360 = (d: number) => ((d % 360) + 360) % 360

/**
 * Solve a turn-by-turn sketch. `pick` chooses among the answers when there is more than one (in a
 * fixed order: the one nearest the drawing as described first).
 */
export function solveTurnSketch(sk: TurnSketch, pick = 0): TurnResult {
  const problem = sketchProblem(sk)
  const unknowns = unknownCount(sk)
  const equations = sk.closed ? 2 : 0
  if (problem) return { ok: false, error: problem, unknowns, equations }
  // starting headings for unknown directions: straight on, left, right, towards the start
  const towards = (at: P) => deg(Math.atan2(sk.start.y - at.y, sk.start.x - at.x))
  const guesses: ((i: number, prevEnd: number, at: P) => number)[] = [
    (_i, prev) => prev + 90,
    (_i, prev) => prev,
    (_i, prev) => prev - 90,
    (_i, _p, at) => towards(at),
    (_i, prev) => prev + 180,
  ]
  const found: TurnSolution[] = []
  const warnings: string[] = []
  let lastError = ''
  for (const g of guesses) {
    const pl = plan(sk, g)
    const res = solve({ points: pl.points, scalars: pl.scalars, constraints: pl.constraints }, { tol: 1e-11, maxIter: 300 })
    if (!res.ok || res.residual > 1e-7) {
      lastError = 'the values given cannot all hold at once'
      continue
    }
    const sol = build(sk, res.points, res.scalars)
    if (typeof sol === 'string') {
      lastError = sol
      continue
    }
    const same = found.some((f) => f.points.every((p, i) => Math.hypot(p.x - sol.points[i].x, p.y - sol.points[i].y) < 1e-6))
    if (!same) found.push(sol)
  }
  if (!found.length) return { ok: false, error: `No outline fits: ${lastError || 'the values given conflict'}.`, unknowns, equations }
  if (found.length > 1) warnings.push(`${found.length} outlines fit these values; showing answer ${Math.min(pick, found.length - 1) + 1}.`)
  const k = Math.max(0, Math.min(pick, found.length - 1))
  return { ok: true, solution: found[k], solutions: found, pick: k, warnings }
}

/** A blank element of each kind (used by the sketch editor). */
export function newElement(kind: TurnElement['kind']): TurnElement {
  return kind === 'line' ? { kind, length: 100, angle: 90, angleMode: 'turn' } : { kind, length: 90, angle: 0, angleMode: 'turn', radius: 50, ccw: true }
}

/** A door to start from: 450 x 700 with an arch tangent to the sides (two unknowns: right side and radius). */
export const SAMPLE_SKETCH: TurnSketch = {
  start: { x: 0, y: 0 },
  closed: true,
  elements: [
    { kind: 'line', length: 450, angle: 0, angleMode: 'absolute' },
    { kind: 'line', length: null, angle: 90, angleMode: 'turn' },
    { kind: 'arc', length: 180, angle: 0, angleMode: 'turn', radius: null, ccw: true },
    { kind: 'line', length: 600, angle: 0, angleMode: 'turn' },
  ],
}
