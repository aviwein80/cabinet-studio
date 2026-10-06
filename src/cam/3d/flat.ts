/**
 * Flat-area finishing (3D-08): offset passes only on the flat areas of the model (where the tool
 * rests on a face flatter than 0.5°), from the edge of each flat area inwards (or from its middle
 * out), the step-over apart.
 *
 * The flat areas are found on a grid of exact drops (where the tool touches a flat face, inside the
 * boundary and the groups chosen); their edges are then traced to 0.01 mm by bisection with exact
 * drops between the grid points either side. The first pass runs along that edge, the next ones are
 * its offsets inwards. Every pass is dropped onto the model exactly and kept only where the tool
 * still touches a flat face (`passes.ts`), so the tool never rides up a wall or off an edge on this
 * strategy. With rest machining on, only the flat areas earlier operations left material on are cut.
 *
 * On level flats every pass runs at one height, so it can also go to woodWOP as an ordinary
 * contour-milling pass (`layers`, like waterline), behind the 3D flat-layer output switch. A pass
 * on a face that is flatter than 0.5° but not level changes height as it goes: true 3D (`uneven`).
 */
import { checkCancel, type Work } from '@/core/cancel'
import type { P } from '../geom'
import { inflatePolys } from '../kernel'
import type { Mesh } from '../mesh/types'
import type { Finish3dOp, Levels } from '../types'
import type { Pt } from './chain'
import type { Cutter3D } from './cutter'
import { type Finish3dResult, LINK_STEPOVERS } from './parallel'
import { chainMoves, chainsAlong, FLAT_DEG, nearestOrder, surfaceSampler } from './passes'
import { insideRegion, polysBox, type Region } from './region'
import { levelLines, simplifyPlan } from './scallop'
import type { Layer } from './waterline'

/** A pass whose heights differ by no more than this is level (one contour-milling depth), mm. */
export const LEVEL_TOL = 0.0005

export interface FlatAreaResult extends Finish3dResult {
  /** The passes, in cutting order, each at its one height (only the level ones; for flat-layer output). */
  layers: Layer[]
  /** Passes that are not level (on faces flatter than 0.5° but tilted): they need true 3D output. */
  uneven: number
}

/** Grid nodes at most. */
const MAX_NODES = 2_000_000
/** The first pass runs this far inside the traced edge of a flat area, mm. */
const EDGE_IN = 0.005

export function flatAreaFinish(op: Finish3dOp, mesh: Mesh, cutter: Cutter3D, region: Region, levels: Levels, work?: Work): FlatAreaResult {
  const none = (w: string): FlatAreaResult => ({ moves: [], warnings: [w], minZ: NaN, spacing: 0, layers: [], uneven: 0 })
  // only where the tool touches a flat face (and the groups chosen)
  const smp = surfaceSampler({ ...op, slope: { min: 0, max: FLAT_DEG }, skipFlats: false }, mesh, cutter)
  if ('error' in smp) return none(smp.error)
  if (!region.polys.length) return none('The boundary is empty.')
  const step = Math.max(0.01, op.stepover)
  const box = polysBox(region.polys)
  let h = Math.min(0.5, Math.max(0.05, Math.min(cutter.R / 4, step / 2)))
  const pad = 2
  const area = (box.maxX - box.minX + 2 * pad * h) * (box.maxY - box.minY + 2 * pad * h)
  if (area / (h * h) > MAX_NODES) h = Math.sqrt(area / MAX_NODES)
  const x0 = box.minX - pad * h
  const y0 = box.minY - pad * h
  const nx = Math.ceil((box.maxX - box.minX) / h) + 2 * pad + 1
  const ny = Math.ceil((box.maxY - box.minY) / h) + 2 * pad + 1
  const flat = (x: number, y: number) => insideRegion(region, { x, y }) && smp.sample(x, y).cut
  const F = new Float64Array(nx * ny)
  let any = false
  for (let j = 0; j < ny; j++) {
    if ((j & 15) === 0) {
      checkCancel(work?.isCancelled)
      work?.progress?.(0.4 * (j / ny), 'Finding the flat areas')
    }
    for (let i = 0; i < nx; i++) {
      const on = flat(x0 + i * h, y0 + j * h)
      F[j * nx + i] = on ? 1 : 0
      any ||= on
    }
  }
  if (!any) return none(region.fromModel ? 'Nothing to cut: the model has no flat areas the tool can rest on.' : 'Nothing to cut: no flat areas inside the boundary.')

  // edges of the flat areas, traced between a grid point on a flat and one off it
  const crossing = (p: number, q: number) => {
    const ax = x0 + (p % nx) * h
    const ay = y0 + Math.floor(p / nx) * h
    const bx = x0 + (q % nx) * h
    const by = y0 + Math.floor(q / nx) * h
    const pIn = F[p] > 0.5
    let lo = 0
    let hi = 1
    for (let k = 0; k < 20 && (hi - lo) * h > 0.005; k++) {
      const m = (lo + hi) / 2
      if (flat(ax + (bx - ax) * m, ay + (by - ay) * m) === pIn) lo = m
      else hi = m
    }
    // the end on the flat
    return pIn ? lo : hi
  }
  work?.progress?.(0.45, 'Edges of the flat areas')
  const edges = levelLines(F, nx, ny, x0, y0, h, 0.5, undefined, crossing)
    .filter((l) => l.closed)
    .map((l) => simplifyPlan([...l.pts, l.pts[0]], 0.002).slice(0, -1))
    .filter((pl) => pl.length >= 3)

  // rings: the edge (moved 0.005 mm onto the flat, so straight pieces between its points never
  // leave it where the edge curves), then offsets inwards every step-over until nothing is left
  const rings: { k: number; pts: P[] }[] = []
  for (let k = 0; ; k++) {
    const polys = inflatePolys(edges, -(EDGE_IN + k * step), 'round', 0.001)
    if (!polys.length) break
    for (const pl of polys) if (pl.length >= 3) rings.push({ k, pts: [...pl, pl[0]] })
    if (k > 100000) break
  }
  const outward = op.travel === 'outward'
  const ks = [...new Set(rings.map((r) => r.k))].sort((a, b) => (outward ? b - a : a - b))
  // loops counter-clockwise (climb) or clockwise; the rings of one offset nearest first
  const ccw = op.direction !== 'conventional'
  const ordered: Pt[][] = []
  let at: P | null = null
  ks.forEach((k, n) => {
    checkCancel(work?.isCancelled)
    work?.progress?.(0.5 + (0.5 * n) / ks.length, `Pass ${n + 1} of ${ks.length}`)
    const group: Pt[][] = []
    for (const r of rings) {
      if (r.k !== k) continue
      const pts = signedArea(r.pts) > 0 === ccw ? r.pts : [...r.pts].reverse()
      group.push(...chainsAlong(smp, pts))
    }
    if (!group.length) return
    const g = nearestOrder(group, at, true)
    ordered.push(...g)
    const last = g[g.length - 1]
    at = last[last.length - 1]
  })
  if (!ordered.length) return none('Nothing to cut: the passes found no flat face to rest on.')
  // (links stay down only over flat faces: this strategy never rides up a wall)
  const { moves, minZ } = chainMoves(ordered, smp, region, mesh, { linkMax: LINK_STEPOVERS * step, levels, onCutOnly: true })
  const { layers, uneven } = levelPasses(ordered)
  return { moves, warnings: [], minZ, spacing: step, layers, uneven }
}

/**
 * The passes as flat layers, in cutting order: each level pass at its height (a pass that comes
 * back to its start is closed), points in line with their neighbours left out; passes whose
 * heights differ by more than `LEVEL_TOL` are counted.
 */
export function levelPasses(chains: Pt[][]): { layers: Layer[]; uneven: number } {
  const layers: Layer[] = []
  let uneven = 0
  for (const c of chains) {
    let lo = Infinity
    let hi = -Infinity
    for (const p of c) {
      lo = Math.min(lo, p.z)
      hi = Math.max(hi, p.z)
    }
    if (c.length < 2 || hi - lo > LEVEL_TOL) {
      if (c.length >= 2) uneven++
      continue
    }
    const a = c[0]
    const b = c[c.length - 1]
    const closed = c.length > 3 && Math.hypot(b.x - a.x, b.y - a.y) < 1e-6
    // (at one height, points in line with their neighbours add nothing: the pass is the same within 0.0005 mm)
    const pts = simplifyPlan(
      (closed ? c.slice(0, -1) : c).map((p) => ({ x: p.x, y: p.y })),
      LEVEL_TOL,
    )
    layers.push({ z: (lo + hi) / 2, chains: [{ pts, closed }] })
  }
  return { layers, uneven }
}

function signedArea(pts: P[]): number {
  let a = 0
  for (let i = 1; i < pts.length; i++) a += (pts[i].x - pts[i - 1].x) * (pts[i].y + pts[i - 1].y)
  return -a / 2
}
