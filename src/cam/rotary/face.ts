/**
 * Cylindrical faces of a solid model, placed in the part (M3.3, NEW-14 "from a cylindrical face"):
 * each face's exact cylinder (axis point, direction, radius, how far the face strays from it) and
 * its points, moved the way the model's placement moves the model. `planeFromCylinder` makes a
 * wrapped plane from one; `axisFromCylinder` puts the rotary axis on it.
 */
import { placePoints } from '../mesh/place'
import { meshBounds } from '../mesh/types'
import { solidMesh } from '../solid/encode'
import type { SolidData } from '../solid/types'
import type { ModelRef } from '../types'
import type { V3 } from './frame'

export interface PlacedCylinder {
  faceId: number
  cyl: { p: V3; v: V3; r: number; fit: number }
  points: V3[]
  /** The material is outside it (a hole) rather than inside (a boss). */
  concave: boolean
}

export function solidCylinders(solid: SolidData, model: Pick<ModelRef, 'place'>): PlacedCylinder[] {
  const box = meshBounds(solidMesh(solid))
  const place = (pts: number[]) => Array.from(placePoints(Float64Array.from(pts), box, model.place))
  const out: PlacedCylinder[] = []
  for (const b of solid.bodies)
    for (const f of b.faces) {
      const s = f.surface
      if (s.kind !== 'cylinder' || !s.p || !s.v || !(s.r! > 0)) continue
      // the face's corners, each once
      const seen = new Set<number>()
      const raw: number[] = []
      for (let t = f.first; t <= f.last; t++)
        for (let k = 0; k < 3; k++) {
          const v = b.indices[t * 3 + k]
          if (seen.has(v)) continue
          seen.add(v)
          raw.push(b.positions[v * 3], b.positions[v * 3 + 1], b.positions[v * 3 + 2])
        }
      const pts = place(raw)
      // the axis: two points on it moved the same way
      const L = 100
      const ax = place([s.p[0], s.p[1], s.p[2], s.p[0] + s.v[0] * L, s.p[1] + s.v[1] * L, s.p[2] + s.v[2] * L])
      const d: V3 = [ax[3] - ax[0], ax[4] - ax[1], ax[5] - ax[2]]
      const len = Math.hypot(d[0], d[1], d[2])
      const scale = len / L
      out.push({
        faceId: f.id,
        cyl: { p: [ax[0], ax[1], ax[2]], v: [d[0] / len, d[1] / len, d[2] / len], r: s.r! * scale, fit: s.fit * scale },
        points: Array.from({ length: pts.length / 3 }, (_, k) => [pts[k * 3], pts[k * 3 + 1], pts[k * 3 + 2]] as V3),
        concave: !!s.concave,
      })
    }
  return out
}
