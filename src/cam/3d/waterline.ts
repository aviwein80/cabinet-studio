/**
 * Waterline finishing (3D-03): passes at constant heights that follow the line where the tool
 * touches the model at each height (the level lines of the tool-centre surface, see `clgrid.ts`).
 * Best on steep walls. Slope limits keep it off flatter areas; "fill shallow areas" finishes those
 * with parallel passes.
 *
 * Every pass point is an exact drop-cutter position on the level line, and the straight moves
 * between them are refined until they stay within the tolerance; links between passes stay down
 * only where exact drops along them show the tool clears the model.
 */
import { checkCancel, subWork, type Work } from '@/core/cancel'
import type { P } from '../geom'
import { type Mesh, meshBounds } from '../mesh/types'
import type { Move } from '../toolpath'
import type { Finish3dOp, Levels } from '../types'
import { CLGrid, type LevelPoint } from './clgrid'
import { type Cutter3D, grownCutter } from './cutter'
import { DropCutter } from './dropcutter'
import { type Finish3dResult, parallelFinish } from './parallel'
import { insideRegion, polysBox, type Region } from './region'

/** Passes at one height, in cutting order and direction. */
export interface Layer {
  z: number
  chains: { pts: P[]; closed: boolean }[]
}

export interface WaterlineResult extends Finish3dResult {
  /** The constant-height passes (for flat-layer output). The shallow-area fill is not in here. */
  layers: Layer[]
}

/** Steepest a point may be and still count as flat (skip flats). */
const FLAT_DEG = 0.5

export function waterlineFinish(op: Finish3dOp, mesh: Mesh, cutter: Cutter3D, region: Region, levels: Levels, work?: Work): WaterlineResult {
  const warnings: string[] = []
  const none = (w: string): WaterlineResult => ({ moves: [], warnings: [...warnings, w], minZ: NaN, spacing: 0, layers: [] })
  const s = Math.max(0, op.surface.stockToLeave)
  const grown = grownCutter(cutter, s)
  if (!grown) return none('Stock to leave needs a ball-nose, bull-nose or flat tool (not a V cutter).')
  const dc = new DropCutter(mesh, grown)
  const tol = Math.max(0.001, op.surface.tolerance || 0.01)
  const gougeTol = Math.min(tol, 0.002)
  const sd = Math.max(0.05, op.stepdown ?? 1)
  const slopeMin = Math.max(op.slope.min, op.skipFlats ? FLAT_DEG : 0)
  const slopeMax = op.slope.max
  const fill = !!op.fillShallow && slopeMin > 0
  const machine = op.surface.groups?.length ? new Set(op.surface.groups) : null
  const protect = new Set(op.surface.protect ?? [])
  const groups = mesh.groups

  const box = polysBox(region.polys)
  if (!(box.maxX > box.minX && box.maxY > box.minY)) return none('The boundary is empty.')
  const h = Math.min(1, Math.max(0.25, cutter.R / 3))
  const grid = new CLGrid(dc, box, h, -Infinity, s, tol / 4, subWork(work, 0, 0.3))
  const { lo, hi } = grid.range()
  if (!Number.isFinite(lo)) return none('Nothing to cut: the model is not under the boundary.')

  const zs: number[] = []
  for (let k = 1; hi - k * sd > lo + 1e-6; k++) zs.push(hi - k * sd)
  if (!zs.length || zs[zs.length - 1] - lo > sd / 4) zs.push(lo + Math.min(0.01, sd / 4))

  const cuts = (p: LevelPoint) => {
    if (p.tri < 0) return false
    const slope = (Math.acos(Math.max(-1, Math.min(1, p.nz))) * 180) / Math.PI
    if (slope < slopeMin - 1e-9 || slope > slopeMax + 1e-9) return false
    const g = groups ? groups[p.tri] : 0
    return !protect.has(g) && (!machine || machine.has(g)) && insideRegion(region, p, 1e-4)
  }

  const span = fill ? 0.5 : 0.7
  const layers: Layer[] = []
  zs.forEach((z, li) => {
    work?.progress?.(0.3 + (span * li) / zs.length, `Level ${li + 1} of ${zs.length}`)
    checkCancel(work?.isCancelled)
    const chains: { pts: P[]; closed: boolean }[] = []
    for (const loop of grid.loops(z, tol, gougeTol)) {
      const pts = loop.pts
      const ok = pts.map(cuts)
      const n = pts.length
      const firstOff = ok.indexOf(false)
      if (firstOff < 0) {
        chains.push({ pts: pts.map(xy), closed: true })
        continue
      }
      let cur: P[] = []
      for (let k = 1; k <= n; k++) {
        const i = (firstOff + k) % n
        if (ok[i]) cur.push(xy(pts[i]))
        else {
          if (cur.length >= 2) chains.push({ pts: cur, closed: false })
          cur = []
        }
      }
      if (cur.length >= 2) chains.push({ pts: cur, closed: false })
    }
    // loops run with the open side on the left; climb keeps the model on the right
    if (op.direction === 'conventional') for (const c of chains) c.pts.reverse()
    if (chains.length) layers.push({ z, chains })
  })

  // order: level by level, nearest pass next; closed loops start at the point nearest the tool
  let at: P | null = null
  for (const layer of layers) {
    const left = [...layer.chains]
    const done: Layer['chains'] = []
    while (left.length) {
      let best = 0
      let bestD = Infinity
      let bestK = 0
      left.forEach((c, i) => {
        const ks = c.closed && at ? c.pts.map((_, k) => k) : [0]
        for (const k of ks) {
          const d = at ? Math.hypot(c.pts[k].x - at.x, c.pts[k].y - at.y) : 0
          if (d < bestD) {
            bestD = d
            best = i
            bestK = k
          }
        }
      })
      const [c] = left.splice(best, 1)
      const pts = c.closed && bestK ? [...c.pts.slice(bestK), ...c.pts.slice(0, bestK)] : c.pts
      done.push({ pts, closed: c.closed })
      at = c.closed ? pts[0] : pts[pts.length - 1]
    }
    layer.chains = done
  }

  // moves
  const top = meshBounds(mesh).max[2] + s
  const clear = Math.max(levels.safeZ, top + levels.rapidZ)
  const ds = Math.min(0.05, Math.max(0.01, cutter.R / 30))
  const linkMax = Math.max(2 * sd, cutter.R)
  const safe = (x: number, y: number, z: number) => {
    if (!dc.drop(x, y)) return true
    if (dc.z + s > z + gougeTol) return false
    return !(groups && protect.has(groups[dc.hitTri]))
  }
  const linkOk = (a: [number, number, number], b: [number, number, number]) => {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (d > linkMax || !insideRegion(region, { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 }, 1e-4)) return false
    // checked along its 3D length: a link down a wall is short in plan but long in height
    const n = Math.max(1, Math.ceil(Math.hypot(d, b[2] - a[2]) / ds))
    for (let i = 1; i < n; i++) {
      const t = i / n
      if (!safe(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)) return false
    }
    return true
  }
  const moves: Move[] = []
  let minZ = Infinity
  let last: [number, number, number] | null = null
  for (const layer of layers)
    for (const c of layer.chains) {
      const z = layer.z
      minZ = Math.min(minZ, z)
      const pts = c.closed ? [...c.pts, c.pts[0]] : c.pts
      const first: [number, number, number] = [pts[0].x, pts[0].y, z]
      if (last && linkOk(last, first)) moves.push({ t: 'poly', pts: new Float64Array(first), f: 'cut' })
      else {
        if (last) moves.push({ t: 'rapid', x: last[0], y: last[1], z: clear })
        moves.push({ t: 'rapid', x: first[0], y: first[1], z: clear })
        // rapid only to just above the stock top (or the model's top where higher), then feed
        const above = Math.max(levels.rapidZ, z + levels.rapidZ)
        if (above < clear) moves.push({ t: 'rapid', x: first[0], y: first[1], z: above })
        moves.push({ t: 'feed', x: first[0], y: first[1], z, f: 'plunge' })
      }
      const f = new Float64Array((pts.length - 1) * 3)
      for (let i = 1; i < pts.length; i++) {
        f[(i - 1) * 3] = pts[i].x
        f[(i - 1) * 3 + 1] = pts[i].y
        f[(i - 1) * 3 + 2] = z
      }
      moves.push({ t: 'poly', pts: f, f: 'cut' })
      last = [pts[pts.length - 1].x, pts[pts.length - 1].y, z]
    }
  if (last) moves.push({ t: 'rapid', x: last[0], y: last[1], z: clear })

  if (fill) {
    const r = parallelFinish({ ...op, strategy: 'parallel', slope: { min: 0, max: slopeMin }, skipFlats: false }, mesh, cutter, region, levels, subWork(work, 0.8, 0.2))
    moves.push(...r.moves)
    if (Number.isFinite(r.minZ)) minZ = Math.min(minZ, r.minZ)
    warnings.push(...r.warnings.filter((w) => !w.startsWith('Nothing to cut')))
  }
  if (!moves.length) return none(region.fromModel ? 'Nothing to cut: no surface within the slope limits and groups chosen.' : 'Nothing to cut: the boundary does not cover the model within the slope limits and groups chosen.')
  return { moves, warnings, minZ: Number.isFinite(minZ) ? minZ : NaN, spacing: sd, layers }
}

const xy = (p: P): P => ({ x: p.x, y: p.y })
