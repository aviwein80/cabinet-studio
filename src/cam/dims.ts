/**
 * Dimensions (CAD-08): linear (aligned, horizontal, vertical), angular, radius, diameter and
 * ordinate dimensions on face 1. Each end refers to the geometry where possible (a node of a
 * shape, the centre of a circle or arc, an arc itself), so a dimension measures again whenever the
 * geometry changes; a free point is used where nothing was there. Values show in the shop unit
 * (inches as fractions to 1/16 in) with the other unit beside them when asked.
 *
 * Dimensions are notes on the drawing: never machined, never exported to a machine.
 */
import { formatInches } from '@/core/units'
import { fmt } from '@/core/geometry'
import type { UnitSystem } from '@/core/types'
import { nodesOf } from './cad'
import { angleOf, dist, type P, radius as arcRadius } from './geom'
import type { CamPart, Dimension, DimRef } from './types'

const TAU = Math.PI * 2

/** The point a reference stands for now (null when the shape or node is gone). */
export function refPoint(part: Pick<CamPart, 'entities'>, r: DimRef): P | null {
  if ('p' in r) return r.p
  const e = part.entities.find((x) => x.id === r.entity)
  if (!e) return null
  if (r.at === 'node') return nodesOf(e)[r.index] ?? null
  if (r.at === 'centre') {
    if (e.g.t === 'circle') return e.g.c
    if (e.g.t === 'contour') {
      const s = e.g.c.segs[r.index]
      return s?.k === 'A' ? s.c : null
    }
  }
  return null
}

/** Circle or arc a radius / diameter dimension measures. */
export function refCircle(part: Pick<CamPart, 'entities'>, r: DimRef): { c: P; r: number } | null {
  if ('p' in r) return null
  const e = part.entities.find((x) => x.id === r.entity)
  if (!e) return null
  if (e.g.t === 'circle') return { c: e.g.c, r: e.g.r }
  if (e.g.t === 'contour' && r.at === 'centre') {
    const s = e.g.c.segs[r.index]
    return s?.k === 'A' ? { c: s.c, r: arcRadius(s) } : null
  }
  return null
}

/**
 * The reference for a picked point: a node of a shape, or the centre of a circle or arc, within
 * `tol` of it (nearest first); otherwise the point itself.
 */
export function refAt(part: Pick<CamPart, 'entities'>, p: P, tol: number): DimRef {
  let best: { r: DimRef; d: number } | null = null
  const consider = (r: DimRef, q: P) => {
    const d = dist(p, q)
    if (d <= tol && (!best || d < best.d - 1e-12)) best = { r, d }
  }
  for (const e of part.entities) {
    if (e.face !== 1) continue
    nodesOf(e).forEach((q, i) => consider({ entity: e.id, at: 'node', index: i }, q))
    if (e.g.t === 'circle') consider({ entity: e.id, at: 'centre', index: 0 }, e.g.c)
    if (e.g.t === 'contour') e.g.c.segs.forEach((s, i) => s.k === 'A' && consider({ entity: e.id, at: 'centre', index: i }, s.c))
  }
  return (best as { r: DimRef } | null)?.r ?? { p: { x: p.x, y: p.y } }
}

/** The circle or arc under a pick (for radius and diameter dimensions). */
export function circleRefAt(part: Pick<CamPart, 'entities'>, entityId: string, p: P): DimRef | null {
  const e = part.entities.find((x) => x.id === entityId)
  if (!e) return null
  if (e.g.t === 'circle') return { entity: e.id, at: 'centre', index: 0 }
  if (e.g.t !== 'contour') return null
  let best = -1
  let bd = Infinity
  e.g.c.segs.forEach((s, i) => {
    if (s.k !== 'A') return
    const d = Math.abs(dist(s.c, p) - arcRadius(s))
    if (d < bd) {
      bd = d
      best = i
    }
  })
  return best >= 0 ? { entity: e.id, at: 'centre', index: best } : null
}

/** What a dimension measures and how it is drawn (world mm; angles in radians from +X). */
export interface DimDrawing {
  /** mm for lengths, degrees for angles. */
  value: number
  measure: 'length' | 'angle'
  lines: [P, P][]
  /** Arrowheads: tip and the direction they point. */
  arrows: { at: P; dir: number }[]
  arcs: { c: P; r: number; a0: number; a1: number }[]
  /** Text anchor and its direction (kept readable when drawn). */
  text: P
  textDir: number
  prefix: '' | 'R' | 'Ø'
}

const add = (a: P, b: P, s = 1): P => ({ x: a.x + b.x * s, y: a.y + b.y * s })
const dot = (a: P, b: P) => a.x * b.x + a.y * b.y

/** Choose horizontal, vertical or aligned from where the dimension line is put (outside the box of the two points). */
export function linearAxis(a: P, b: P, place: P): 'horizontal' | 'vertical' | 'aligned' {
  const inX = place.x >= Math.min(a.x, b.x) && place.x <= Math.max(a.x, b.x)
  const inY = place.y >= Math.min(a.y, b.y) && place.y <= Math.max(a.y, b.y)
  if (inX && !inY) return 'horizontal'
  if (inY && !inX) return 'vertical'
  return 'aligned'
}

/** Measure a dimension on the part as it is now; null when a shape it refers to is gone. */
export function measureDim(part: Pick<CamPart, 'entities' | 'dimOrigin'>, d: Dimension): DimDrawing | null {
  const gap = 1.5
  switch (d.kind) {
    case 'aligned':
    case 'horizontal':
    case 'vertical': {
      const A = refPoint(part, d.refs[0])
      const B = refPoint(part, d.refs[1])
      if (!A || !B) return null
      let u = d.kind === 'horizontal' ? { x: 1, y: 0 } : d.kind === 'vertical' ? { x: 0, y: 1 } : { x: B.x - A.x, y: B.y - A.y }
      const l = Math.hypot(u.x, u.y)
      if (l < 1e-12) u = { x: 1, y: 0 }
      else u = { x: u.x / l, y: u.y / l }
      const n = { x: -u.y, y: u.x }
      // dimension line at `offset` from A along n
      const A2 = add(A, n, d.offset)
      const B2 = add(B, n, d.offset + dot({ x: A.x - B.x, y: A.y - B.y }, n))
      const value = Math.abs(dot({ x: B.x - A.x, y: B.y - A.y }, u))
      const side = Math.sign(d.offset) || 1
      const ext = (from: P, to: P): [P, P] => {
        const v = { x: to.x - from.x, y: to.y - from.y }
        const lv = Math.hypot(v.x, v.y)
        const w = lv > 1e-9 ? { x: v.x / lv, y: v.y / lv } : { x: n.x * side, y: n.y * side }
        return [lv > gap ? add(from, w, gap) : from, add(to, w, gap)]
      }
      const dir = angleOf(A2, B2)
      return {
        value,
        measure: 'length',
        lines: [ext(A, A2), ext(B, B2), [A2, B2]],
        arrows: value > 1e-9 ? [{ at: A2, dir: dir + Math.PI }, { at: B2, dir }] : [],
        arcs: [],
        text: add({ x: (A2.x + B2.x) / 2, y: (A2.y + B2.y) / 2 }, n, 0),
        textDir: Math.atan2(u.y, u.x),
        prefix: '',
      }
    }
    case 'angular': {
      const V = refPoint(part, d.refs[0])
      const A = refPoint(part, d.refs[1])
      const B = refPoint(part, d.refs[2])
      if (!V || !A || !B) return null
      const a0 = angleOf(V, A)
      const a1 = angleOf(V, B)
      const norm = (a: number) => ((a % TAU) + TAU) % TAU
      const ccw = norm(a1 - a0)
      // the side the dimension was put on: counter-clockwise from the first arm, or the other way
      const inside = d.side !== 'other'
      const start = inside ? a0 : a1
      const sweep = inside ? ccw : TAU - ccw
      const r = Math.max(1e-6, d.offset)
      const mid = start + sweep / 2
      const at = (a: number): P => ({ x: V.x + r * Math.cos(a), y: V.y + r * Math.sin(a) })
      return {
        value: (sweep * 180) / Math.PI,
        measure: 'angle',
        lines: [
          [V, at(a0)],
          [V, at(a1)],
        ],
        arrows: [
          { at: at(start), dir: start - Math.PI / 2 },
          { at: at(start + sweep), dir: start + sweep + Math.PI / 2 },
        ],
        arcs: [{ c: V, r, a0: start, a1: start + sweep }],
        text: at(mid),
        textDir: mid - Math.PI / 2,
        prefix: '',
      }
    }
    case 'radius':
    case 'diameter': {
      const c = refCircle(part, d.refs[0])
      if (!c) return null
      const a = d.offset
      const u = { x: Math.cos(a), y: Math.sin(a) }
      const edge = add(c.c, u, c.r)
      const far = add(c.c, u, -c.r)
      const out = add(c.c, u, c.r + 8)
      return {
        value: d.kind === 'radius' ? c.r : 2 * c.r,
        measure: 'length',
        lines: d.kind === 'radius' ? [[c.c, edge], [edge, out]] : [[far, edge], [edge, out]],
        arrows: d.kind === 'radius' ? [{ at: edge, dir: a }] : [{ at: edge, dir: a }, { at: far, dir: a + Math.PI }],
        arcs: [],
        text: out,
        textDir: a,
        prefix: d.kind === 'radius' ? 'R' : 'Ø',
      }
    }
    case 'ordinate': {
      const Q = refPoint(part, d.refs[0])
      if (!Q) return null
      const O = part.dimOrigin ?? { x: 0, y: 0 }
      const x = d.axis !== 'y'
      // X ordinate: the leader runs along Y to `offset`; Y ordinate along X
      const end = x ? { x: Q.x, y: Q.y + d.offset } : { x: Q.x + d.offset, y: Q.y }
      const start = add(Q, x ? { x: 0, y: Math.sign(d.offset) || 1 } : { x: Math.sign(d.offset) || 1, y: 0 }, gap)
      return {
        value: x ? Q.x - O.x : Q.y - O.y,
        measure: 'length',
        lines: [[start, end]],
        arrows: [],
        arcs: [],
        text: end,
        textDir: x ? Math.PI / 2 : 0,
        prefix: '',
      }
    }
  }
}

/** Text of a dimension: the shop unit (inches as fractions to 1/16 in), the other unit in brackets when asked. */
export function dimText(d: Pick<Dimension, 'alt' | 'text' | 'kind'>, g: Pick<DimDrawing, 'value' | 'measure' | 'prefix'>, units: UnitSystem): string {
  if (d.text) return d.text
  if (g.measure === 'angle') return `${fmtAngle(g.value)}°`
  const main = units === 'in' ? formatInches(g.value) : fmt(g.value)
  const other = units === 'in' ? `${fmt(g.value)} mm` : formatInches(g.value)
  return `${g.prefix}${main}${d.alt ? ` [${g.prefix}${other}]` : ''}`
}

const fmtAngle = (deg: number) => String(Math.round(deg * 100) / 100)

/** Dimensions whose shapes are gone (they are kept, drawn nowhere, and listed). */
export function brokenDims(part: Pick<CamPart, 'entities' | 'dims' | 'dimOrigin'>): Dimension[] {
  return (part.dims ?? []).filter((d) => !measureDim(part, d))
}

/** Remove dimensions that refer to any of these shapes (when the shapes are deleted on purpose). */
export function dropDimsOf<T extends Pick<CamPart, 'dims'>>(part: T, entityIds: string[]): T {
  if (!part.dims?.length) return part
  const keep = part.dims.filter((d) => !d.refs.some((r) => 'entity' in r && entityIds.includes(r.entity)))
  return keep.length === part.dims.length ? part : { ...part, dims: keep }
}

/** Distance and angle between picks: two points, or an angle at a vertex between two points. */
export function measureAngle(vertex: P, a: P, b: P): { inside: number; outside: number } {
  const ccw = ((((angleOf(vertex, b) - angleOf(vertex, a)) % TAU) + TAU) % TAU) * (180 / Math.PI)
  const inside = Math.min(ccw, 360 - ccw)
  return { inside, outside: 360 - inside }
}
