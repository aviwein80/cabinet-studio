/** 3D polylines (`poly3d` shapes) made and edited point by point (CAD-16). */
import { type Contour, fitPoints, pt } from '../geom'
import { joinContours } from '../kernel'
import type { Entity } from '../types'

export type Pt3 = [number, number, number]

const r3 = (n: number) => Math.round(n * 1000) / 1000

export function poly3dLength(pts: Pt3[]): number {
  let s = 0
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2])
  return s
}

/** Move point i. */
export function movePoint3d(e: Entity, i: number, p: Pt3): Entity {
  if (e.g.t !== 'poly3d' || i < 0 || i >= e.g.pts.length) return e
  const pts = e.g.pts.map((q, k) => (k === i ? ([r3(p[0]), r3(p[1]), r3(p[2])] as Pt3) : q))
  return { ...e, g: { t: 'poly3d', pts } }
}

/** Insert a point after point i (-1: at the start); without a point given, half way to the next. */
export function insertPoint3d(e: Entity, i: number, p?: Pt3): Entity {
  if (e.g.t !== 'poly3d') return e
  const pts = [...e.g.pts]
  const a = pts[Math.max(0, i)]
  const b = pts[Math.min(pts.length - 1, i + 1)]
  const q: Pt3 = p ?? (i >= pts.length - 1 ? [a[0], a[1], a[2]] : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2])
  pts.splice(i + 1, 0, [r3(q[0]), r3(q[1]), r3(q[2])])
  return { ...e, g: { t: 'poly3d', pts } }
}

/** Remove point i (a polyline keeps at least two points). */
export function deletePoint3d(e: Entity, i: number): Entity {
  if (e.g.t !== 'poly3d' || e.g.pts.length <= 2) return e
  return { ...e, g: { t: 'poly3d', pts: e.g.pts.filter((_, k) => k !== i) } }
}

/** Parse typed points "x, y, z; x, y, z ..." (one per line or separated by ;). */
export function parsePoints3d(text: string): Pt3[] {
  return text
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const n = s.split(/[\s,]+/).map(Number)
      if (n.length < 3 || n.some((x) => !Number.isFinite(x))) throw new Error(`"${s}" is not a point (x, y, z).`)
      return [n[0], n[1], n[2]] as Pt3
    })
}

/** Picked 3D polylines (or any shapes) joined into 2D contours (projected straight down onto face 1). */
export function contourFromEdges(entities: Entity[], tol = 0.01): Contour[] {
  const cs: Contour[] = []
  for (const e of entities) {
    if (e.g.t === 'poly3d') cs.push({ closed: false, segs: fitPoints(e.g.pts.map(([x, y]) => pt(x, y)), false, 0.001) })
    else if (e.g.t === 'contour') cs.push(e.g.c)
  }
  return joinContours(cs, tol)
}
