/**
 * Flat faces of a solid model, placed in the part (M3.4, a tilted plane "from a model's flat
 * face"): each planar face's outward normal and its points, moved the way the model's placement
 * moves the model. `planeFromFace` makes a tilted plane from one.
 */
import { placePoints } from '../mesh/place'
import { meshBounds } from '../mesh/types'
import { solidMesh } from '../solid/encode'
import type { SolidData } from '../solid/types'
import type { ModelRef } from '../types'
import { norm3, type V3 } from './frame'

export interface PlacedFlat {
  faceId: number
  /** Outward normal (out of the material), part frame. */
  n: V3
  points: V3[]
  /** How far the face's points stray from its plane (mm). */
  fit: number
}

export function solidFlats(solid: SolidData, model: Pick<ModelRef, 'place'>): PlacedFlat[] {
  const box = meshBounds(solidMesh(solid))
  const place = (pts: number[]) => Array.from(placePoints(Float64Array.from(pts), box, model.place))
  const out: PlacedFlat[] = []
  for (const b of solid.bodies)
    for (const f of b.faces) {
      const s = f.surface
      if (s.kind !== 'plane' || !s.n) continue
      const seen = new Set<number>()
      const raw: number[] = []
      for (let t = f.first; t <= f.last; t++)
        for (let k = 0; k < 3; k++) {
          const v = b.indices[t * 3 + k]
          if (seen.has(v)) continue
          seen.add(v)
          raw.push(b.positions[v * 3], b.positions[v * 3 + 1], b.positions[v * 3 + 2])
        }
      if (raw.length < 9) continue
      const pts = place(raw)
      // the normal: a point and the point 100 mm out along it, moved the same way
      const c = [raw[0], raw[1], raw[2]]
      const q = place([...c, c[0] + s.n[0] * 100, c[1] + s.n[1] * 100, c[2] + s.n[2] * 100])
      const d = [q[3] - q[0], q[4] - q[1], q[5] - q[2]]
      out.push({
        faceId: f.id,
        n: norm3(d),
        points: Array.from({ length: pts.length / 3 }, (_, k) => [pts[k * 3], pts[k * 3 + 1], pts[k * 3 + 2]] as V3),
        fit: (s.fit * Math.hypot(d[0], d[1], d[2])) / 100,
      })
    }
  return out
}
