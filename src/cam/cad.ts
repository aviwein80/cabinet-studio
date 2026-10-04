/**
 * CAD commands as pure functions on a part. Entity ids are kept when an edit replaces one
 * entity with one entity, so operations stay attached (and turn stale).
 */
import { nanoid } from 'nanoid'
import { entityContours, makeEntity, transformEntity } from './doc'
import {
  add,
  arc,
  area,
  boxOf,
  bulgeOf,
  chamferCorner,
  closestOnContour,
  type Contour,
  corners,
  dist,
  filletCorner,
  fromBulges,
  type Mat,
  mulM,
  type P,
  reliefCorner,
  reliefAll,
  type ReliefStyle,
  rotateM,
  sub,
  toBulges,
  translateM,
  scaleM,
  mirrorM,
  bulgeSeg,
  pointInContour,
  cross,
  tangentAt,
} from './geom'
import { autoClose, boolean, type BoolOp, breakAt, explode, extendTo, joinContours, offset, offsetChain, removeDuplicateSegs, simplify, trim } from './kernel'
import type { CamPart, Entity } from './types'

const touch = (p: CamPart): CamPart => ({ ...p, updatedAt: new Date().toISOString() })

export function addEntities(part: CamPart, es: Entity[]): CamPart {
  return touch({ ...part, entities: [...part.entities, ...es] })
}

export function deleteEntities(part: CamPart, ids: string[]): CamPart {
  const set = new Set(ids)
  return touch({
    ...part,
    entities: part.entities.filter((e) => !set.has(e.id)),
    ops: part.ops.map((o) => (o.geometry.some((g) => set.has(g)) ? { ...o, geometry: o.geometry.filter((g) => !set.has(g)) } : o)),
    outlineId: part.outlineId && set.has(part.outlineId) ? undefined : part.outlineId,
  })
}

function replace(part: CamPart, id: string, next: Entity[]): CamPart {
  const i = part.entities.findIndex((e) => e.id === id)
  if (i < 0) return part
  const entities = [...part.entities]
  entities.splice(i, 1, ...next)
  return touch({ ...part, entities })
}

function asContourEntity(e: Entity): { e: Entity; c: Contour } | null {
  const cs = entityContours(e)
  if (cs.length !== 1) return null
  return { e: { ...e, g: { t: 'contour', c: cs[0] } }, c: cs[0] }
}

export function transformEntities(part: CamPart, ids: string[], m: Mat, copy = false): { part: CamPart; ids: string[] } {
  const set = new Set(ids)
  if (!copy) return { part: touch({ ...part, entities: part.entities.map((e) => (set.has(e.id) ? transformEntity(e, m) : e)) }), ids }
  const copies = part.entities.filter((e) => set.has(e.id)).map((e) => ({ ...transformEntity(e, m), id: nanoid(8) }))
  return { part: addEntities(part, copies), ids: copies.map((e) => e.id) }
}

export const moveM = (from: P, to: P) => translateM(to.x - from.x, to.y - from.y)
export { rotateM, scaleM, mirrorM, mulM }

export function arrayEntities(part: CamPart, ids: string[], nx: number, ny: number, dx: number, dy: number): CamPart {
  const set = new Set(ids)
  const src = part.entities.filter((e) => set.has(e.id))
  const out: Entity[] = []
  for (let i = 0; i < Math.max(1, nx); i++)
    for (let j = 0; j < Math.max(1, ny); j++) {
      if (!i && !j) continue
      for (const e of src) out.push({ ...transformEntity(e, translateM(i * dx, j * dy)), id: nanoid(8) })
    }
  return addEntities(part, out)
}

/** Offset by |d| toward the side of `toward` (closed: inside/outside; open: left/right). */
export function offsetEntity(part: CamPart, id: string, d: number, toward: P): CamPart {
  const e = part.entities.find((x) => x.id === id)
  if (!e) return part
  const out: Entity[] = []
  for (const c of entityContours(e)) {
    if (c.closed) {
      const inside = pointInContour(c, toward)
      for (const r of offset([c], inside ? -Math.abs(d) : Math.abs(d))) out.push(makeEntity({ t: 'contour', c: r }, e.layer, e.face))
    } else {
      const q = closestOnContour(c, toward)
      const t = tangentAt(c.segs[q.seg], q.t)
      const leftSide = cross(t, sub(toward, q.p)) > 0
      out.push(makeEntity({ t: 'contour', c: offsetChain(c, leftSide ? Math.abs(d) : -Math.abs(d)) }, e.layer, e.face))
    }
  }
  return addEntities(part, out)
}

function nearestCorner(c: Contour, p: P) {
  let best = -1
  let bd = Infinity
  for (const i of corners(c, 0.5)) {
    const v = c.segs[i % c.segs.length].a
    const d = dist(v, p)
    if (d < bd) {
      bd = d
      best = i
    }
  }
  return best
}

export function filletAt(part: CamPart, id: string, pick: P, r: number): CamPart {
  const e = part.entities.find((x) => x.id === id)
  const ce = e && asContourEntity(e)
  if (!ce) return part
  const i = nearestCorner(ce.c, pick)
  if (i < 0) return part
  return replace(part, id, [{ ...ce.e, g: { t: 'contour', c: filletCorner(ce.c, i, r) } }])
}

export function filletAll(part: CamPart, id: string, r: number): CamPart {
  const e = part.entities.find((x) => x.id === id)
  const ce = e && asContourEntity(e)
  if (!ce) return part
  let c = ce.c
  for (const i of corners(c).sort((a, b) => b - a)) c = filletCorner(c, i, r)
  return replace(part, id, [{ ...ce.e, g: { t: 'contour', c } }])
}

export function chamferAt(part: CamPart, id: string, pick: P, d: number): CamPart {
  const e = part.entities.find((x) => x.id === id)
  const ce = e && asContourEntity(e)
  if (!ce) return part
  const i = nearestCorner(ce.c, pick)
  if (i < 0) return part
  return replace(part, id, [{ ...ce.e, g: { t: 'contour', c: chamferCorner(ce.c, i, d) } }])
}

export function reliefAt(part: CamPart, id: string, pick: P | null, r: number, style: ReliefStyle, removed: 'interior' | 'exterior'): CamPart {
  const e = part.entities.find((x) => x.id === id)
  const ce = e && asContourEntity(e)
  if (!ce || !ce.c.closed) return part
  const c = pick ? reliefCorner(ce.c, nearestCorner(ce.c, pick), r, style, removed) : reliefAll(ce.c, r, style, removed)
  return replace(part, id, [{ ...ce.e, g: { t: 'contour', c } }])
}

function cuttersFor(part: CamPart, id: string): Contour[] {
  const self = part.entities.find((e) => e.id === id)
  return part.entities.filter((e) => e.id !== id && e.face === self?.face).flatMap(entityContours)
}

export function trimAt(part: CamPart, id: string, pick: P): CamPart {
  const e = part.entities.find((x) => x.id === id)
  const ce = e && asContourEntity(e)
  if (!ce) return part
  const pieces = trim(ce.c, cuttersFor(part, id), pick)
  return replace(part, id, pieces.map((c, i) => ({ ...ce.e, id: i === 0 ? ce.e.id : nanoid(8), g: { t: 'contour', c } })))
}

export function extendAt(part: CamPart, id: string, pick: P): CamPart {
  const e = part.entities.find((x) => x.id === id)
  const ce = e && asContourEntity(e)
  if (!ce || ce.c.closed) return part
  return replace(part, id, [{ ...ce.e, g: { t: 'contour', c: extendTo(ce.c, cuttersFor(part, id), pick) } }])
}

export function breakEntity(part: CamPart, id: string, pick: P): CamPart {
  const e = part.entities.find((x) => x.id === id)
  const ce = e && asContourEntity(e)
  if (!ce) return part
  return replace(part, id, breakAt(ce.c, pick).map((c, i) => ({ ...ce.e, id: i === 0 ? ce.e.id : nanoid(8), g: { t: 'contour', c } })))
}

export function joinEntities(part: CamPart, ids: string[], tol: number): CamPart {
  const es = part.entities.filter((e) => ids.includes(e.id))
  if (es.length < 1) return part
  const joined = joinContours(es.flatMap(entityContours), tol)
  const first = es[0]
  const next = joined.map((c, i) => ({ ...first, id: i === 0 ? first.id : nanoid(8), g: { t: 'contour' as const, c } }))
  let out = deleteEntities(part, ids.filter((x) => x !== first.id))
  out = replace(out, first.id, next)
  return out
}

export function explodeEntity(part: CamPart, id: string): CamPart {
  const e = part.entities.find((x) => x.id === id)
  if (!e) return part
  const pieces = entityContours(e).flatMap(explode)
  return replace(part, id, pieces.map((c, i) => ({ ...e, id: i === 0 ? e.id : nanoid(8), g: { t: 'contour', c } })))
}

/** Area boolean: a (kept ids) op b (tool ids). Results replace a; b is removed for subtract/unite/intersect. */
export function booleanEntities(part: CamPart, op: BoolOp, aIds: string[], bIds: string[]): CamPart {
  const A = part.entities.filter((e) => aIds.includes(e.id))
  const B = part.entities.filter((e) => bIds.includes(e.id))
  if (!A.length || !B.length) return part
  const res = boolean(op, A.flatMap(entityContours).filter((c) => c.closed), B.flatMap(entityContours).filter((c) => c.closed))
  const first = A[0]
  const sorted = [...res].sort((x, y) => Math.abs(area(y)) - Math.abs(area(x)))
  const next = sorted.map((c, i) => ({ ...first, id: i === 0 ? first.id : nanoid(8), g: { t: 'contour' as const, c } }))
  let out = deleteEntities(part, [...aIds.filter((x) => x !== first.id), ...bIds])
  out = replace(out, first.id, next)
  return out
}

/** Close small gaps, drop duplicate lines, re-fit long chains of short lines into lines and arcs. */
export function cleanupEntities(part: CamPart, ids: string[], gap: number, tol: number): CamPart {
  const es = part.entities.filter((e) => ids.includes(e.id) && e.g.t === 'contour')
  if (!es.length) return part
  let cs = joinContours(es.flatMap(entityContours), gap)
  cs = autoClose(cs, gap)
  cs = removeDuplicateSegs(cs)
  cs = cs.map((c) => (c.segs.length > 6 ? simplify(c, tol) : c))
  const first = es[0]
  let out = deleteEntities(part, es.slice(1).map((e) => e.id))
  out = replace(out, first.id, cs.map((c, i) => ({ ...first, id: i === 0 ? first.id : nanoid(8), g: { t: 'contour' as const, c } })))
  return out
}

// ---------------------------------------------------------------------------------------------
// Node editing
// ---------------------------------------------------------------------------------------------

export function nodesOf(e: Entity): P[] {
  if (e.g.t === 'contour') return toBulges(e.g.c).pts
  if (e.g.t === 'spline') return e.g.ctrl
  if (e.g.t === 'circle') return [e.g.c]
  if (e.g.t === 'point') return [e.g.p]
  if (e.g.t === 'text') return [e.g.at]
  return e.g.pts.map(([x, y]) => ({ x, y }))
}

export function moveNode(part: CamPart, id: string, idx: number, p: P): CamPart {
  const e = part.entities.find((x) => x.id === id)
  if (!e) return part
  let g = e.g
  if (g.t === 'contour') {
    const { pts, bulges } = toBulges(g.c)
    pts[idx] = p
    g = { t: 'contour', c: fromBulges(pts, bulges, g.c.closed) }
  } else if (g.t === 'spline') g = { ...g, ctrl: g.ctrl.map((q, i) => (i === idx ? p : q)) }
  else if (g.t === 'circle') g = { ...g, c: p }
  else if (g.t === 'point') g = { ...g, p }
  else if (g.t === 'text') g = { ...g, at: p }
  else g = { ...g, pts: g.pts.map((q, i) => (i === idx ? [p.x, p.y, q[2]] : q)) }
  return replace(part, id, [{ ...e, g }])
}

export function deleteNode(part: CamPart, id: string, idx: number): CamPart {
  const e = part.entities.find((x) => x.id === id)
  if (!e || e.g.t !== 'contour') return part
  const { pts, bulges } = toBulges(e.g.c)
  if (pts.length <= (e.g.c.closed ? 3 : 2)) return part
  pts.splice(idx, 1)
  bulges.splice(idx, 1)
  if (idx > 0) bulges[idx - 1] = 0
  return replace(part, id, [{ ...e, g: { t: 'contour', c: fromBulges(pts, bulges, e.g.c.closed) } }])
}

/** Insert a node at the middle of segment `seg`. */
export function insertNode(part: CamPart, id: string, seg: number): CamPart {
  const e = part.entities.find((x) => x.id === id)
  if (!e || e.g.t !== 'contour') return part
  const s = e.g.c.segs[seg]
  if (!s) return part
  const mid = s.k === 'L' ? { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 } : add(s.c, { x: 0, y: 0 })
  const segs = [...e.g.c.segs]
  if (s.k === 'L') segs.splice(seg, 1, { k: 'L', a: s.a, b: mid }, { k: 'L', a: mid, b: s.b })
  else {
    const b = bulgeOf(s)
    const half = Math.tan(Math.atan(b) / 2)
    const pm = (() => {
      const th = 4 * Math.atan(b)
      const a0 = Math.atan2(s.a.y - s.c.y, s.a.x - s.c.x)
      const r = dist(s.a, s.c)
      return { x: s.c.x + r * Math.cos(a0 + th / 2), y: s.c.y + r * Math.sin(a0 + th / 2) }
    })()
    segs.splice(seg, 1, bulgeSeg(s.a, pm, half), bulgeSeg(pm, s.b, half))
  }
  return replace(part, id, [{ ...e, g: { t: 'contour', c: { ...e.g.c, segs } } }])
}

/** Turn a line into an arc (bulge 0.25) or an arc into a line. */
export function toggleArc(part: CamPart, id: string, seg: number): CamPart {
  const e = part.entities.find((x) => x.id === id)
  if (!e || e.g.t !== 'contour') return part
  const segs = [...e.g.c.segs]
  const s = segs[seg]
  if (!s) return part
  segs[seg] = s.k === 'L' ? bulgeSeg(s.a, s.b, 0.25) : { k: 'L', a: s.a, b: s.b }
  return replace(part, id, [{ ...e, g: { t: 'contour', c: { ...e.g.c, segs } } }])
}

/** Set an arc's radius keeping its end points and direction (minor arc). */
export function setArcRadius(part: CamPart, id: string, seg: number, r: number): CamPart {
  const e = part.entities.find((x) => x.id === id)
  if (!e || e.g.t !== 'contour') return part
  const segs = [...e.g.c.segs]
  const s = segs[seg]
  if (!s || s.k !== 'A') return part
  const chord = dist(s.a, s.b)
  if (r < chord / 2) return part
  const th = 2 * Math.asin(chord / (2 * r))
  segs[seg] = bulgeSeg(s.a, s.b, (s.ccw ? 1 : -1) * Math.tan(th / 4))
  return replace(part, id, [{ ...e, g: { t: 'contour', c: { ...e.g.c, segs } } }])
}

export function moveToLayer(part: CamPart, ids: string[], layer: string): CamPart {
  return touch({ ...part, entities: part.entities.map((e) => (ids.includes(e.id) ? { ...e, layer } : e)) })
}

export function reverseEntity(part: CamPart, id: string): CamPart {
  const e = part.entities.find((x) => x.id === id)
  if (!e || e.g.t !== 'contour') return part
  const c = e.g.c
  return replace(part, id, [{ ...e, g: { t: 'contour', c: { closed: c.closed, segs: c.segs.map((s) => (s.k === 'L' ? { k: 'L' as const, a: s.b, b: s.a } : arc(s.b, s.a, s.c, !s.ccw))).reverse() } } }])
}

export function selectionBox(part: CamPart, ids: string[]) {
  return boxOf(part.entities.filter((e) => ids.includes(e.id)).flatMap(entityContours))
}
