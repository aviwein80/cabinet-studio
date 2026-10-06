/**
 * Machining regions for 3D strategies: the area the tool centre may cover, as closed polygons
 * (even-odd), and straight passes clipped to it.
 */
import { entityContours } from '../doc'
import { type Contour, type P, polyline, rect, toPoints } from '../geom'
import { offset } from '../kernel'
import type { Box3 } from '../mesh/types'
import type { CamPart, Surface3D } from '../types'

export interface Region {
  polys: P[][]
  /** True when no boundary was picked and the model's footprint was used. */
  fromModel: boolean
}

/**
 * Region for the tool centre: the picked closed shapes (or the model's footprint: `footprint` when
 * given, else the box round it), moved in by
 * the tool radius for 'contained', out for 'touching', unchanged for 'centre'.
 */
export function centreRegion(part: CamPart, geometry: string[], surface: Surface3D, toolR: number, modelBox: Box3, footprint?: P[][]): Region {
  const picked: Contour[] = []
  for (const id of geometry) {
    const e = part.entities.find((x) => x.id === id)
    if (!e || e.face !== 1) continue
    for (const c of entityContours(e)) if (c.closed && c.segs.length) picked.push(c)
  }
  const fromModel = picked.length === 0
  // (a relief's own outline, when there is one, instead of the box round the model)
  const base = fromModel ? (footprint?.length ? footprint.map((l) => polyline(l, true)) : [rect(modelBox.min[0], modelBox.min[1], modelBox.max[0] - modelBox.min[0], modelBox.max[1] - modelBox.min[1])]) : picked
  const d = surface.boundaryMode === 'contained' ? -toolR : surface.boundaryMode === 'touching' ? toolR : 0
  const cs = d === 0 ? base : offset(base, d)
  return { polys: cs.map((c) => toPoints(c, 0.005)).filter((p) => p.length >= 3), fromModel }
}

/** Inside the region, or within `tol` of its edge. */
export function insideRegion(r: Region, p: P, tol = 0): boolean {
  if (tol > 0)
    for (const poly of r.polys)
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[j]
        const b = poly[i]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const l2 = dx * dx + dy * dy
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0
        if (Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y) <= tol) return true
      }
  let inside = false
  for (const poly of r.polys)
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]
      const b = poly[j]
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
    }
  return inside
}

/** Extent of the region along direction (ux, uy) and across it (normal). */
export function extent(r: Region, ux: number, uy: number) {
  let lo = Infinity
  let hi = -Infinity
  for (const poly of r.polys)
    for (const p of poly) {
      const s = -uy * p.x + ux * p.y
      lo = Math.min(lo, s)
      hi = Math.max(hi, s)
    }
  return { lo, hi }
}

/**
 * The line { p : n . p = s } (n = left normal of u) clipped to the region: intervals of the
 * coordinate along u, in increasing order.
 */
export function clipLine(r: Region, ux: number, uy: number, s: number): [number, number][] {
  const nx = -uy
  const ny = ux
  const ts: number[] = []
  for (const poly of r.polys)
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]
      const q = poly[(i + 1) % poly.length]
      const dp = nx * p.x + ny * p.y - s
      const dq = nx * q.x + ny * q.y - s
      if (dp > 0 === dq > 0) continue
      const k = dp / (dp - dq)
      ts.push(ux * (p.x + (q.x - p.x) * k) + uy * (p.y + (q.y - p.y) * k))
    }
  ts.sort((a, b) => a - b)
  const out: [number, number][] = []
  for (let i = 0; i + 1 < ts.length; i += 2) if (ts[i + 1] - ts[i] > 1e-9) out.push([ts[i], ts[i + 1]])
  return out
}

/** XY box of a set of polygons. */
export function polysBox(polys: P[][]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const poly of polys)
    for (const p of poly) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  return { minX, minY, maxX, maxY }
}
