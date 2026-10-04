/**
 * Object snaps for drawing: end, mid, centre, quadrant, intersection, perpendicular, tangent,
 * nearest, grid, plus ortho and "same X / same Y" alignment with existing points.
 */
import { add, angleOf, closestOnSeg, type Contour, dist, intersectSegs, mul, type P, pointAt, polar, radius, sub, unit, paramOn } from './geom'

export type SnapMode = 'end' | 'mid' | 'centre' | 'quadrant' | 'intersection' | 'perpendicular' | 'tangent' | 'nearest' | 'grid' | 'align'
export const ALL_SNAPS: SnapMode[] = ['end', 'mid', 'centre', 'quadrant', 'intersection', 'perpendicular', 'tangent', 'nearest', 'grid', 'align']

export interface SnapResult {
  p: P
  kind: SnapMode | 'ortho' | 'free'
  /** Alignment guide lines to draw (from a reference point to the result). */
  guides: { from: P; to: P }[]
}

export interface SnapContext {
  contours: Contour[]
  points: P[]
  modes: Set<SnapMode>
  /** Capture radius in mm (pixel radius / zoom). */
  tol: number
  grid: number
  ortho: boolean
  last?: P
  enabled: boolean
}

const RANK: Record<SnapMode, number> = { end: 0, centre: 1, quadrant: 2, mid: 3, intersection: 4, perpendicular: 5, tangent: 6, align: 7, nearest: 8, grid: 9 }

export function snapCandidates(ctx: SnapContext, cursor: P): { p: P; kind: SnapMode }[] {
  const out: { p: P; kind: SnapMode }[] = []
  const m = ctx.modes
  const within = (p: P) => dist(p, cursor) <= ctx.tol
  for (const p of ctx.points) if (m.has('end') && within(p)) out.push({ p, kind: 'end' })
  const segs = ctx.contours.flatMap((c) => c.segs)
  for (const s of segs) {
    if (m.has('end')) for (const p of [s.a, s.b]) if (within(p)) out.push({ p, kind: 'end' })
    if (m.has('mid')) {
      const p = pointAt(s, 0.5)
      if (within(p)) out.push({ p, kind: 'mid' })
    }
    if (s.k === 'A') {
      if (m.has('centre') && within(s.c)) out.push({ p: s.c, kind: 'centre' })
      if (m.has('quadrant'))
        for (let q = 0; q < 4; q++) {
          const p = polar(s.c, radius(s), (q * Math.PI) / 2)
          const t = paramOn(s, p)
          if (t >= -1e-9 && t <= 1 + 1e-9 && within(p)) out.push({ p, kind: 'quadrant' })
        }
      if (m.has('tangent') && ctx.last) {
        const d = dist(ctx.last, s.c)
        const r = radius(s)
        if (d > r + 1e-9) {
          const base = angleOf(s.c, ctx.last)
          const off = Math.acos(r / d)
          for (const a of [base + off, base - off]) {
            const p = polar(s.c, r, a)
            const t = paramOn(s, p)
            if (t >= -1e-9 && t <= 1 + 1e-9 && within(p)) out.push({ p, kind: 'tangent' })
          }
        }
      }
    }
    if (m.has('perpendicular') && ctx.last) {
      let p: P
      if (s.k === 'L') {
        const d = unit(sub(s.b, s.a))
        p = add(s.a, mul(d, (ctx.last.x - s.a.x) * d.x + (ctx.last.y - s.a.y) * d.y))
      } else p = add(s.c, mul(unit(sub(ctx.last, s.c)), radius(s)))
      const t = paramOn(s, p)
      if (t >= -1e-9 && t <= 1 + 1e-9 && within(p) && dist(p, ctx.last) > 1e-6) out.push({ p, kind: 'perpendicular' })
    }
  }
  if (m.has('intersection')) {
    const near = segs.filter((s) => closestOnSeg(s, cursor).d <= ctx.tol * 2)
    for (let i = 0; i < near.length; i++)
      for (let j = i + 1; j < near.length; j++) for (const h of intersectSegs(near[i], near[j])) if (within(h.p)) out.push({ p: h.p, kind: 'intersection' })
  }
  if (m.has('nearest'))
    for (const s of segs) {
      const q = closestOnSeg(s, cursor)
      if (q.d <= ctx.tol) out.push({ p: q.p, kind: 'nearest' })
    }
  return out
}

export function snap(ctx: SnapContext, cursor: P): SnapResult {
  let p = cursor
  if (ctx.ortho && ctx.last) {
    const d = sub(cursor, ctx.last)
    p = Math.abs(d.x) >= Math.abs(d.y) ? { x: cursor.x, y: ctx.last.y } : { x: ctx.last.x, y: cursor.y }
  }
  if (!ctx.enabled) return { p, kind: ctx.ortho && ctx.last ? 'ortho' : 'free', guides: [] }
  const cands = snapCandidates(ctx, p)
  if (cands.length) {
    cands.sort((a, b) => RANK[a.kind] - RANK[b.kind] || dist(a.p, p) - dist(b.p, p))
    const best = cands[0]
    if (ctx.ortho && ctx.last && best.kind !== 'end' && best.kind !== 'centre' && best.kind !== 'intersection') {
      // keep the ortho constraint when the snap is a weak one
    } else return { p: best.p, kind: best.kind, guides: [] }
  }
  const guides: SnapResult['guides'] = []
  let q = { ...p }
  if (ctx.modes.has('align')) {
    const refs = [...ctx.points, ...ctx.contours.flatMap((c) => c.segs.flatMap((s) => (s.k === 'A' ? [s.a, s.b, s.c] : [s.a, s.b])))]
    let bx: P | null = null
    let by: P | null = null
    for (const r of refs) {
      if (Math.abs(r.x - q.x) <= ctx.tol && (!bx || Math.abs(r.x - q.x) < Math.abs(bx.x - q.x))) bx = r
      if (Math.abs(r.y - q.y) <= ctx.tol && (!by || Math.abs(r.y - q.y) < Math.abs(by.y - q.y))) by = r
    }
    if (bx && !(ctx.ortho && ctx.last && Math.abs(p.x - ctx.last.x) < 1e-9 && p.y !== ctx.last.y)) {
      q = { x: bx.x, y: q.y }
      guides.push({ from: bx, to: q })
    }
    if (by) {
      q = { x: q.x, y: by.y }
      guides.push({ from: by, to: q })
    }
    if (guides.length) return { p: q, kind: 'align', guides }
  }
  if (ctx.modes.has('grid') && ctx.grid > 0) {
    const g = ctx.grid
    const gp = { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g }
    if (ctx.ortho && ctx.last) {
      if (p.y === ctx.last.y) gp.y = p.y
      else gp.x = p.x
    }
    return { p: gp, kind: 'grid', guides: [] }
  }
  return { p, kind: ctx.ortho && ctx.last ? 'ortho' : 'free', guides: [] }
}

export const SNAP_LABEL: Record<SnapResult['kind'], string> = {
  end: 'End',
  mid: 'Middle',
  centre: 'Centre',
  quadrant: 'Quadrant',
  intersection: 'Intersection',
  perpendicular: 'Perpendicular',
  tangent: 'Tangent',
  nearest: 'On',
  grid: 'Grid',
  align: 'Aligned',
  ortho: 'Ortho',
  free: '',
}

