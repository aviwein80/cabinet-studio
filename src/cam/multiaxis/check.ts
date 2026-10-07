/**
 * Independent gouge check of a 5-axis toolpath against the model (M3.5, 5AX-03 "gouge check" on our
 * side, whatever the engine claims). Shares no code with any engine.
 *
 * For a ball-nose it is exact at every checked position, at any tilt: the ball's centre sits one
 * radius up the tool from the tip, and the ball cuts into the model (plus the stock to leave) by
 * exactly how much nearer than radius + stock that centre is to the nearest facet. Positions are
 * taken along every feed move at most `step` apart, the tool direction turned evenly between the
 * ends of each move. Other tool shapes are not checked here (the simulator's stock shows them).
 *
 * Pure: no DOM, no React.
 */
import { TriGrid } from '../mesh/distance'
import { type Mesh, triCount } from '../mesh/types'
import type { Move } from '../toolpath'
import { add, mul, slerp } from './axis'
import { axisNodes } from './result'

/** Gouges deeper than this (mm) are reported by the independent check and block 5-axis output (the shop's gouge tolerance). */
export const GOUGE_TOL = 0.005

export interface AxisGougeReport {
  /** Checked exactly (ball-nose), or not checked (other shapes). */
  method: 'exact' | 'none'
  /** Deepest cut into the model plus the stock, mm (0 or less = none). */
  depth: number
  at: [number, number, number] | null
  points: number
}

/** Distance to the nearest facet, for many points (the facet grid is built once). */
export function distanceTo(mesh: Mesh): (x: number, y: number, z: number) => number {
  const grid = new TriGrid(mesh)
  const stamp = new Int32Array(triCount(mesh))
  let mark = 0
  return (x, y, z) => grid.nearest(x, y, z, stamp, ++mark)
}

/** Facets of the given groups only (all when none are given). */
export function meshGroups(mesh: Mesh, groups: readonly number[] | undefined): Mesh {
  if (!groups?.length || !mesh.groups) return mesh
  const keep = new Set(groups)
  const ix: number[] = []
  for (let t = 0; t < mesh.indices.length / 3; t++) if (keep.has(mesh.groups[t])) ix.push(mesh.indices[t * 3], mesh.indices[t * 3 + 1], mesh.indices[t * 3 + 2])
  return { positions: mesh.positions, indices: Uint32Array.from(ix) }
}

export function checkAxisGouge(mesh: Mesh, tool: { shape?: string; diameter: number }, moves: readonly Move[], opt: { stock?: number; step?: number; maxPoints?: number } = {}): AxisGougeReport {
  if (tool.shape !== 'ball') return { method: 'none', depth: 0, at: null, points: 0 }
  const R = tool.diameter / 2
  const s = Math.max(0, opt.stock ?? 0)
  const step = Math.max(0.01, opt.step ?? 0.25)
  const dist = distanceTo(mesh)
  const nodes = axisNodes(moves)
  // positions to check: along every feed move
  const at: { p: number[]; a: number[] }[] = []
  for (let i = 1; i < nodes.length; i++) {
    const b = nodes[i]
    if (b.kind === 'rapid') continue
    const a = nodes[i - 1]
    const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
    const n = Math.max(1, Math.ceil(L / step))
    for (let k = i === 1 || nodes[i - 1].kind === 'rapid' ? 0 : 1; k <= n; k++) {
      const f = k / n
      at.push({ p: [a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f], a: slerp(a.a, b.a, f) })
    }
  }
  const every = opt.maxPoints && at.length > opt.maxPoints ? at.length / opt.maxPoints : 1
  const rep: AxisGougeReport = { method: 'exact', depth: -Infinity, at: null, points: 0 }
  for (let q = 0; q < at.length; q += every) {
    const { p, a } = at[Math.floor(q)]
    const c = add(p, mul(a, R))
    const g = R + s - dist(c[0], c[1], c[2])
    rep.points++
    if (g > rep.depth) {
      rep.depth = g
      rep.at = [p[0], p[1], p[2]]
    }
  }
  if (!rep.points) rep.depth = 0
  return rep
}
