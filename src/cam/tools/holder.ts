/**
 * Holders from imported models (TOOL-04). A holder measured as a solid or a mesh (STEP, IGES,
 * BREP, STL, OBJ, 3MF) becomes the revolved outline the simulator draws and the collision checks
 * use: the model is cut into height bands and each band takes the largest distance of the model
 * from the holder's axis within it. The outline is therefore never smaller than the model (a
 * stepped envelope round it), so a check made with it errs on the side of a collision.
 */
import type { ToolHolder } from '@/core/types'
import type { Mesh } from '../mesh/types'

export interface HolderFromModel {
  profile: { z: number; r: number }[]
  /** Model height (mm) and largest radius. */
  height: number
  maxR: number
  /** Axis position used (model XY). */
  axis: [number, number]
}

/**
 * Revolved envelope of a mesh about a vertical axis (model +Z up, the holder face at the model's
 * lowest point). `step`: band height, mm; `axis`: the axis in model XY (default: the middle of the
 * model's footprint).
 */
export function holderEnvelope(mesh: Mesh, opt: { step?: number; axis?: [number, number] } = {}): HolderFromModel {
  const step = Math.max(0.05, opt.step ?? 1)
  const p = mesh.positions
  const ix = mesh.indices
  if (!ix.length) throw new Error('The model has no facets.')
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i < p.length; i += 3) {
    minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i])
    minY = Math.min(minY, p[i + 1]); maxY = Math.max(maxY, p[i + 1])
    minZ = Math.min(minZ, p[i + 2]); maxZ = Math.max(maxZ, p[i + 2])
  }
  const ax = opt.axis ?? [(minX + maxX) / 2, (minY + maxY) / 2]
  const height = maxZ - minZ
  const bands = Math.max(1, Math.ceil(height / step - 1e-9))
  const r = new Float64Array(bands)
  const rad = (x: number, y: number) => Math.hypot(x - ax[0], y - ax[1])
  for (let t = 0; t < ix.length; t += 3) {
    const v = [ix[t], ix[t + 1], ix[t + 2]].map((k) => [p[k * 3], p[k * 3 + 1], p[k * 3 + 2] - minZ] as [number, number, number])
    const z0 = Math.min(v[0][2], v[1][2], v[2][2])
    const z1 = Math.max(v[0][2], v[1][2], v[2][2])
    const b0 = Math.max(0, Math.min(bands - 1, Math.floor(z0 / step)))
    const b1 = Math.max(0, Math.min(bands - 1, Math.floor(z1 / step - 1e-12)))
    for (let b = b0; b <= b1; b++) {
      // the facet cut to this band: distance from the axis is convex, so its largest value is at a corner of the cut piece
      const poly = clipZ(clipZ(v, b * step, 1), (b + 1) * step, -1)
      for (const q of poly) r[b] = Math.max(r[b], rad(q[0], q[1]))
    }
  }
  const profile: { z: number; r: number }[] = []
  const top = (b: number) => Math.min(height, (b + 1) * step)
  for (let b = 0; b < bands; b++) {
    const last = profile[profile.length - 1]
    const rb = Math.round(r[b] * 1000) / 1000
    if (last && Math.abs(last.r - rb) < 1e-9) last.z = round(top(b))
    else {
      if (last) profile.push({ z: last.z, r: rb })
      else profile.push({ z: 0, r: rb })
      profile.push({ z: round(top(b)), r: rb })
    }
  }
  return { profile, height, maxR: Math.max(...r), axis: ax }
}

const round = (n: number) => Math.round(n * 1000) / 1000

/** Keep the part of a polygon with z >= at (side 1) or z <= at (side -1). */
function clipZ(poly: [number, number, number][], at: number, side: 1 | -1): [number, number, number][] {
  const out: [number, number, number][] = []
  const inside = (q: [number, number, number]) => (q[2] - at) * side >= -1e-12
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (inside(a)) out.push(a)
    if (inside(a) !== inside(b)) {
      const t = (at - a[2]) / (b[2] - a[2])
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, at])
    }
  }
  return out
}

/** A holder made from a model (the shop's own measured data: not a placeholder). */
export function holderFromModel(mesh: Mesh, file: string, opt: { step?: number; name?: string; id: string }): ToolHolder {
  const env = holderEnvelope(mesh, opt)
  return { id: opt.id, name: opt.name ?? file.replace(/\.[^.]+$/, ''), profile: env.profile, source: { file, triangles: mesh.indices.length / 3, step: opt.step ?? 1 } }
}
