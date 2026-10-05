/**
 * Projection finishing (3D-04): drawn shapes (lines, arcs, curves, text) are dropped straight down
 * onto the model. The tool centre follows each shape in plan while the tool rides the surface;
 * with a depth it runs that far below the surface (engraving on a 3D face), in passes.
 *
 * Every point is an exact drop-cutter position (then lowered by the depth), and the straight moves
 * between points are refined until they stay within the tolerance of the true tool-centre surface.
 * On the surface (depth 0) the tool therefore cannot dig into the model beyond that tolerance. With
 * a depth, the tool cuts only the facet groups being machined: protected groups and groups not
 * chosen are kept clear by a second exact drop on just those facets.
 */
import { checkCancel, type Work } from '@/core/cancel'
import type { P } from '../geom'
import { type Mesh, meshBounds } from '../mesh/types'
import type { Move } from '../toolpath'
import type { Finish3dOp, Levels } from '../types'
import { cutChains, type Pt, refineAlong } from './chain'
import { type Cutter3D, grownCutter } from './cutter'
import { DropCutter } from './dropcutter'
import type { Finish3dResult } from './parallel'

/** A drawn shape in plan, as points (closed: the last point joins the first). */
export interface PlanPath {
  pts: P[]
  closed: boolean
}

/**
 * `depths`: depth below the surface of each pass, mm, shallowest first ([0] = on the surface).
 */
export function projectionFinish(op: Finish3dOp, mesh: Mesh, cutter: Cutter3D, paths: PlanPath[], depths: number[], levels: Levels, work?: Work): Finish3dResult {
  const warnings: string[] = []
  const none = (w: string): Finish3dResult => ({ moves: [], warnings: [...warnings, w], minZ: NaN, spacing: 0 })
  if (!paths.some((p) => p.pts.length >= 2)) return none('Pick the shapes to project onto the model: lines, arcs, curves or text on face 1.')
  const s = Math.max(0, op.surface.stockToLeave)
  const grown = grownCutter(cutter, s)
  if (!grown) return none('Stock to leave needs a ball-nose, bull-nose or flat tool (not a V cutter).')
  const dc = new DropCutter(mesh, grown)
  const tol = Math.max(0.001, op.surface.tolerance || 0.01)
  const gougeTol = Math.min(tol, 0.002)
  const step0 = Math.min(0.5, Math.max(0.05, cutter.R / 3))
  const ds = depths.length ? depths.map((d) => Math.max(0, d)) : [0]
  const deepest = Math.max(...ds)
  const machine = op.surface.groups?.length ? new Set(op.surface.groups) : null
  const protect = new Set(op.surface.protect ?? [])
  const groups = mesh.groups
  const machined = (g: number) => !protect.has(g) && (!machine || machine.has(g))

  // Below the surface the tool would cut every facet it reaches; keep it clear of the ones that are
  // not machined with an exact drop on just those facets.
  let keepOut: DropCutter | null = null
  if (deepest > 0 && groups && (protect.size || machine)) {
    const kept: number[] = []
    for (let t = 0; t < groups.length; t++) if (!machined(groups[t])) kept.push(mesh.indices[t * 3], mesh.indices[t * 3 + 1], mesh.indices[t * 3 + 2])
    if (kept.length) keepOut = new DropCutter({ positions: mesh.positions, indices: Uint32Array.from(kept) }, grown)
  }

  let offModel = false
  const sample = (x: number, y: number): Pt => {
    if (!dc.drop(x, y)) {
      offModel = true
      return { x, y, z: NaN, ok: false, cut: false, prot: false }
    }
    const g = groups ? groups[dc.hitTri] : 0
    let cut = machined(g)
    // the lowered tool (tip at drop - deepest, in the grown cutter's frame) must clear the facets kept out
    if (cut && keepOut && !keepOut.clears(x, y, dc.z - deepest + gougeTol)) cut = false
    return { x, y, z: dc.z + s, ok: true, cut, prot: protect.has(g) }
  }

  // chains on the surface, per shape, in drawn order
  const chains: { pts: Pt[]; loop: boolean }[] = []
  paths.forEach((path, k) => {
    if ((k & 15) === 0) {
      checkCancel(work?.isCancelled)
      work?.progress?.(k / paths.length, `Shape ${k + 1} of ${paths.length}`)
    }
    const poly = path.closed ? [...path.pts, path.pts[0]] : path.pts
    let all: Pt[] = []
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i - 1]
      const b = poly[i]
      const L = Math.hypot(b.x - a.x, b.y - a.y)
      if (L < 1e-9) continue
      const seg = refineAlong((t) => sample(a.x + ((b.x - a.x) * t) / L, a.y + ((b.y - a.y) * t) / L), 0, L, step0, tol, gougeTol)
      all.push(...(all.length ? seg.slice(1) : seg))
    }
    if (all.length < 2) return
    const whole = all.every((p) => p.cut)
    if (path.closed && !whole) {
      // start a closed shape where it stops cutting, so a run across the seam stays in one piece
      const ring = all.slice(0, -1)
      const k0 = ring.findIndex((p) => !p.cut)
      all = [...ring.slice(k0), ...ring.slice(0, k0), ring[k0]]
    }
    for (const c of cutChains(all)) chains.push({ pts: c, loop: path.closed && whole })
  })
  if (offModel) warnings.push('Parts of the shapes are not over the model; those parts are not cut.')
  if (!chains.length) return none('Nothing to cut: the shapes are not over the model, or only over protected groups or groups not chosen.')

  // moves: each shape at every depth, then the next shape
  const top = meshBounds(mesh).max[2] + s
  const clear = Math.max(levels.safeZ, top + levels.rapidZ)
  const moves: Move[] = []
  let minZ = Infinity
  const at = (c: Pt[], d: number, from: number) => {
    const f = new Float64Array((c.length - from) * 3)
    for (let i = from; i < c.length; i++) {
      const o = (i - from) * 3
      f[o] = c[i].x
      f[o + 1] = c[i].y
      f[o + 2] = c[i].z - d
      if (f[o + 2] < minZ) minZ = f[o + 2]
    }
    return f
  }
  let last: Pt | null = null
  for (const { pts: c, loop } of chains) {
    const first = c[0]
    ds.forEach((d, i) => {
      if (i > 0 && loop) {
        // a closed shape ends where it started: straight down in the groove already cut
        moves.push({ t: 'feed', x: first.x, y: first.y, z: first.z - d, f: 'plunge' })
      } else {
        if (last) moves.push({ t: 'rapid', x: last.x, y: last.y, z: clear })
        moves.push({ t: 'rapid', x: first.x, y: first.y, z: clear })
        // rapid only to just above the stock top (face 1, or the surface where higher), then feed
        const above = Math.max(levels.rapidZ, first.z + levels.rapidZ)
        if (above < clear) moves.push({ t: 'rapid', x: first.x, y: first.y, z: above })
        moves.push({ t: 'feed', x: first.x, y: first.y, z: first.z - d, f: 'plunge' })
      }
      moves.push({ t: 'poly', pts: at(c, d, 1), f: 'cut' })
      last = c[c.length - 1]
    })
  }
  if (last) moves.push({ t: 'rapid', x: (last as Pt).x, y: (last as Pt).y, z: clear })
  return { moves, warnings, minZ: Number.isFinite(minZ) ? minZ : NaN, spacing: 0 }
}
