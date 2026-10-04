import { entityContours, layerOf } from '@/cam/doc'
import { boxOf, closestOnContour, type Contour, dist, pointAt, type P } from '@/cam/geom'
import type { CamPart } from '@/cam/types'

export function contourPath(c: Contour): string {
  if (!c.segs.length) return ''
  const f = (n: number) => (Math.round(n * 1000) / 1000).toString()
  let d = `M${f(c.segs[0].a.x)} ${f(c.segs[0].a.y)}`
  for (const s of c.segs) {
    if (s.k === 'L') d += `L${f(s.b.x)} ${f(s.b.y)}`
    else {
      const r = dist(s.a, s.c)
      const a0 = Math.atan2(s.a.y - s.c.y, s.a.x - s.c.x)
      let a1 = Math.atan2(s.b.y - s.c.y, s.b.x - s.c.x)
      if (s.ccw && a1 <= a0 + 1e-12) a1 += 2 * Math.PI
      if (!s.ccw && a1 >= a0 - 1e-12) a1 -= 2 * Math.PI
      const sweep = Math.abs(a1 - a0)
      if (sweep > 2 * Math.PI - 1e-9) {
        const mid = pointAt(s, 0.5)
        d += `A${f(r)} ${f(r)} 0 0 ${s.ccw ? 1 : 0} ${f(mid.x)} ${f(mid.y)}A${f(r)} ${f(r)} 0 0 ${s.ccw ? 1 : 0} ${f(s.b.x)} ${f(s.b.y)}`
      } else d += `A${f(r)} ${f(r)} 0 ${sweep > Math.PI ? 1 : 0} ${s.ccw ? 1 : 0} ${f(s.b.x)} ${f(s.b.y)}`
    }
  }
  if (c.closed) d += 'Z'
  return d
}

/** Entity under a point (within tol mm), skipping hidden and locked layers. */
export function hitEntity(part: CamPart, p: P, tol: number, face = 1): string | null {
  let best: { id: string; d: number } | null = null
  for (const e of part.entities) {
    if (e.face !== face) continue
    const l = layerOf(part, e.layer)
    if (l && (!l.visible || l.locked)) continue
    let d = Infinity
    if (e.g.t === 'point') d = dist(e.g.p, p)
    for (const c of entityContours(e)) d = Math.min(d, closestOnContour(c, p).d)
    if (d <= tol && (!best || d < best.d)) best = { id: e.id, d }
  }
  return best?.id ?? null
}

export function entitiesInBox(part: CamPart, a: P, b: P, crossing: boolean): string[] {
  const minX = Math.min(a.x, b.x)
  const maxX = Math.max(a.x, b.x)
  const minY = Math.min(a.y, b.y)
  const maxY = Math.max(a.y, b.y)
  return part.entities
    .filter((e) => {
      if (e.face !== 1) return false
      const l = layerOf(part, e.layer)
      if (l && (!l.visible || l.locked)) return false
      const cs = entityContours(e)
      const bx = e.g.t === 'point' ? { minX: e.g.p.x, maxX: e.g.p.x, minY: e.g.p.y, maxY: e.g.p.y } : boxOf(cs)
      const inside = bx.minX >= minX && bx.maxX <= maxX && bx.minY >= minY && bx.maxY <= maxY
      if (inside) return true
      if (!crossing) return false
      return !(bx.maxX < minX || bx.minX > maxX || bx.maxY < minY || bx.minY > maxY)
    })
    .map((e) => e.id)
}

