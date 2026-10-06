/**
 * 3D rest machining (3D-06): where earlier operations left material that this tool can still
 * remove. The earlier operations' actual toolpaths are carved into the simulator's stock
 * (`HeightfieldStock`). The surface this tool can reach is found the same way: the tool dropped
 * onto the model (plus the stock to leave) at every cell near where material is left, and carved
 * into a second heightfield. Wherever the stock is thicker than a set amount over that surface
 * (measured square to the model's surface: the height difference times the slope's cosine), there
 * is rest; the rest areas, grown by the tool radius, limit where the tool centre may go.
 */
import type { P } from '../geom'
import { inflatePolys, unionPolys } from '../kernel'
import type { Mesh } from '../mesh/types'
import { buildTimeline, type Cutter, createHeightfield, cutterZ, type Heightfield, stamp, type V3 } from '../sim'
import type { Toolpath } from '../toolpath'
import { type Cutter3D, grownCutter } from './cutter'
import { DropCutter } from './dropcutter'

export interface RestArea {
  /** Areas of rest material (filled polygons, mm). */
  rest: P[][]
  /** Thickest rest found (that this tool can remove, square to the surface), mm. */
  thickest: number
  /** Area of rest, mm². */
  area: number
}

/** The simulator's cutter for a 3D cutter. */
export function simCutter(c: Cutter3D): Cutter {
  if (c.kind === 'v') return { r: c.R, shape: 'v', angle: (2 * Math.atan(1 / c.k) * 180) / Math.PI }
  if (c.rc >= c.R - 1e-9) return { r: c.R, shape: 'ball', angle: 0 }
  if (c.rc <= 1e-9) return { r: c.R, shape: 'flat', angle: 0 }
  return { r: c.R, shape: 'bull', angle: 0, cornerRadius: c.rc }
}

/**
 * Rest left on `mesh` after `sources` ran on a panel `length` x `width` x `thickness`, that
 * `cutter` (leaving `stock` on the model) could still remove where it is thicker than `min`.
 * Cells of `cell` mm. The tool is dropped at cell centres, so the surface it reaches is found a
 * little high between them (by under 0.01 mm for a 3 mm ball at 0.25 mm cells). See `carve` for
 * how close the earlier operations' stock is.
 */
export function restArea(
  mesh: Mesh,
  sources: Toolpath[],
  panel: { length: number; width: number; thickness: number },
  opt: {
    cutter: Cutter3D
    stock: number
    min: number
    cell: number
    /**
     * Flat faces only (cosine of the steepest slope that counts as flat), for flat-area finishing:
     * rest counts only on such faces, and only where the tool can reach resting on one.
     */
    flatter?: number
  },
): RestArea {
  const { cutter, stock, min, cell } = opt
  const hf = createHeightfield(panel.length, panel.width, panel.thickness, cell)
  for (const s of buildTimeline(sources).segs) if (s.kind !== 'rapid' && !s.side) carve(hf, s.a, s.b, s.cutter, min / 4)
  const { nx, ny } = hf
  const empty: RestArea = { rest: [], thickest: 0, area: 0 }
  // first, cells where the stock stands more than `min` above the model (plus the stock to leave):
  // this tool can never cut lower than that
  const { top: model, nz } = topRaster(mesh, nx, ny, cell)
  // (heights to thickness square to the surface; walls near vertical count as 1 in 20)
  const cos = (k: number) => Math.max(0.05, nz[k])
  const cand = new Uint8Array(nx * ny)
  let any = false
  for (let k = 0; k < nx * ny; k++)
    if ((hf.top[k] - (model[k] + stock)) * cos(k) > min && (opt.flatter === undefined || nz[k] >= opt.flatter)) {
      cand[k] = 1
      any = true
    }
  if (!any) return empty
  // the surface this tool reaches near them: dropped at every cell centre within its radius
  const grown = grownCutter(cutter, stock)
  if (!grown) return empty
  const dc = new DropCutter(mesh, grown)
  const sim = simCutter(cutter)
  const reach = createHeightfield(panel.length, panel.width, panel.thickness, cell)
  const n = Math.ceil(cutter.R / cell) + 1
  const drop = new Uint8Array(nx * ny)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      if (!cand[j * nx + i]) continue
      for (let b = Math.max(0, j - n); b <= Math.min(ny - 1, j + n); b++)
        for (let a = Math.max(0, i - n); a <= Math.min(nx - 1, i + n); a++) {
          const k = b * nx + a
          if (drop[k] || (a - i) * (a - i) + (b - j) * (b - j) > n * n) continue
          drop[k] = 1
          const x = (a + 0.5) * cell
          const y = (b + 0.5) * cell
          // (flat faces only: positions where the tool rests on one)
          if (dc.drop(x, y) && (opt.flatter === undefined || dc.hitNz >= opt.flatter)) stamp(reach, { x, y, z: dc.z + stock }, sim)
        }
    }
  // rest: the stock more than `min` above what this tool reaches
  let thickest = 0
  let count = 0
  const rows: P[][] = []
  for (let j = 0; j < ny; j++) {
    let run = -1
    for (let i = 0; i <= nx; i++) {
      let on = false
      if (i < nx && cand[j * nx + i]) {
        const t = (hf.top[j * nx + i] - reach.top[j * nx + i]) * cos(j * nx + i)
        if (t > min) {
          on = true
          count++
          if (t > thickest) thickest = t
        }
      }
      if (on && run < 0) run = i
      if (!on && run >= 0) {
        rows.push([
          { x: run * cell, y: j * cell },
          { x: i * cell, y: j * cell },
          { x: i * cell, y: (j + 1) * cell },
          { x: run * cell, y: (j + 1) * cell },
        ])
        run = -1
      }
    }
  }
  return { rest: rows.length ? unionPolys(rows) : [], thickest, area: count * cell * cell }
}

/**
 * The model's top at each cell centre (the highest facet over it; -Infinity where there is none)
 * and the upward part of that facet's normal (1 = flat), by drawing the facets into the grid. A
 * centre on a shared edge takes both facets; vertical facets draw nothing, so beside a wall the
 * lower side's height is taken (never too high).
 */
export function topRaster(mesh: Mesh, nx: number, ny: number, cell: number): { top: Float64Array; nz: Float64Array } {
  const top = new Float64Array(nx * ny).fill(-Infinity)
  const nz = new Float64Array(nx * ny).fill(1)
  const P = mesh.positions
  const I = mesh.indices
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3
    const b = I[t + 1] * 3
    const c = I[t + 2] * 3
    const ax = P[a], ay = P[a + 1], az = P[a + 2]
    const bx = P[b], by = P[b + 1], bz = P[b + 2]
    const cx = P[c], cy = P[c + 1], cz = P[c + 2]
    const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
    if (Math.abs(det) < 1e-12) continue
    // |normal z| / |normal|: the cross product's z is det
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    const n = Math.abs(det) / Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, det)
    const i0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx) / cell - 0.5))
    const i1 = Math.min(nx - 1, Math.floor(Math.max(ax, bx, cx) / cell - 0.5))
    const j0 = Math.max(0, Math.ceil(Math.min(ay, by, cy) / cell - 0.5))
    const j1 = Math.min(ny - 1, Math.floor(Math.max(ay, by, cy) / cell - 0.5))
    const eps = 1e-9
    for (let j = j0; j <= j1; j++) {
      const y = (j + 0.5) * cell
      for (let i = i0; i <= i1; i++) {
        const x = (i + 0.5) * cell
        const u = ((x - ax) * (cy - ay) - (cx - ax) * (y - ay)) / det
        const v = ((bx - ax) * (y - ay) - (x - ax) * (by - ay)) / det
        if (u < -eps || v < -eps || u + v > 1 + eps) continue
        const z = az + u * (bz - az) + v * (cz - az)
        const k = j * nx + i
        if (z > top[k]) {
          top[k] = z
          nz[k] = n
        }
      }
    }
  }
  return { top, nz }
}

/**
 * Carve the move a -> b into the heightfield. Level moves are carved exactly (each cell takes the
 * cutter's height at its distance from the move). Sloped moves are stamped in steps short enough
 * that the ridges left between stamps stay under `cusp` where the tool's corner touches at up to
 * 70° from flat (more on steeper walls): the stock is never shown lower than it is, at worst a
 * little higher, which can only add rest.
 */
export function carve(hf: Heightfield, a: V3, b: V3, c: Cutter, cusp: number) {
  if (Math.min(a.z, b.z) >= 0) return
  const L = Math.hypot(b.x - a.x, b.y - a.y)
  if (Math.abs(b.z - a.z) < 1e-9 && L > 1e-9) {
    const r = c.r
    const floor = -hf.thickness
    const ux = (b.x - a.x) / L
    const uy = (b.y - a.y) / L
    const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - r) / hf.cell))
    const j1 = Math.min(hf.ny - 1, Math.floor((Math.max(a.y, b.y) + r) / hf.cell))
    const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - r) / hf.cell))
    const i1 = Math.min(hf.nx - 1, Math.floor((Math.max(a.x, b.x) + r) / hf.cell))
    for (let j = j0; j <= j1; j++) {
      const y = (j + 0.5) * hf.cell
      for (let i = i0; i <= i1; i++) {
        const x = (i + 0.5) * hf.cell
        const t = Math.max(0, Math.min(L, (x - a.x) * ux + (y - a.y) * uy))
        const z = cutterZ(c, a.z, Math.hypot(x - a.x - ux * t, y - a.y - uy * t))
        if (z === Infinity) continue
        const k = j * hf.nx + i
        const v = Math.max(floor, z)
        if (v < hf.top[k]) hf.top[k] = v
      }
    }
    return
  }
  // the radius that cuts the side of a wall 70° steep: the corner's (the whole radius for a ball)
  const rc = c.shape === 'ball' ? c.r : c.shape === 'bull' ? Math.min(c.r, c.cornerRadius ?? 0) : 0
  const rho = rc * Math.cos((70 * Math.PI) / 180)
  const e = Math.max(1e-4, cusp)
  const step = rc > 0 ? Math.max(hf.cell / 2, Math.min(c.r / 2, 2 * Math.sqrt(Math.max(0, 2 * rho * e - e * e)))) : hf.cell / 2
  const n = Math.max(1, Math.ceil(Math.hypot(L, b.z - a.z) / step))
  for (let q = 0; q <= n; q++) {
    const k = q / n
    stamp(hf, { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k }, c)
  }
}

/** Where the tool centre may go to reach the rest: the rest areas grown by the tool radius (and a cell). */
export function restCentres(rest: P[][], R: number, cell: number): P[][] {
  return rest.length ? inflatePolys(rest, R + cell, 'round', 0.01) : []
}
