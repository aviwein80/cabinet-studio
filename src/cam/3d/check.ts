/**
 * Independent gouge check for 3D toolpaths: how far below the model surface the tool goes,
 * anywhere along its cutting moves. It shares no code with the drop-cutter that made the path:
 *
 * - Ball-nose: exact. The ball's centre must stay at least radius (+ stock) from the mesh; the
 *   distance comes from the mesh-distance grid (point-to-facet distance).
 * - Flat, bull-nose and V: sampled. Points on every facet near the tool (corners, edges and an
 *   even grid inside, `resolution` apart) are compared with the cutter's underside from the
 *   simulator's `cutterZ`. A gouge between samples can be missed by up to about
 *   resolution x surface slope, which the report states.
 *
 * Moves are checked every `step` mm along their length, not only at their ends.
 */
import { pointTriDist2, TriGrid } from '../mesh/distance'
import { type Mesh, triCount } from '../mesh/types'
import { cutterZ, type Cutter } from '../sim'
import { type Move, simpleMoves } from '../toolpath'

export interface GougeReport {
  /** Deepest cut below the surface (+ stock to leave), mm; 0 or negative = no gouge. */
  max: number
  at: [number, number, number] | null
  /** Smallest clearance seen (how close the tool came to the surface + stock), mm. */
  minClearance: number
  /** Tool positions checked. */
  points: number
  exact: boolean
  /** Sampling distance on the surface for the sampled check, mm (0 for the exact check). */
  resolution: number
}

export interface CheckTool {
  shape: 'flat' | 'ball' | 'bull' | 'v'
  /** Radius, mm. */
  r: number
  cornerRadius?: number
  /** Included angle for V, degrees. */
  angle?: number
}

/** Tool-tip positions along the cutting moves, at most `step` apart. */
function* positions(moves: Move[], step: number): Generator<[number, number, number]> {
  let x = NaN
  let y = NaN
  let z = NaN
  for (const m of simpleMoves(moves)) {
    if (m.t === 'rapid' || m.t === 'drill' || m.t === 'arc') {
      x = m.x
      y = m.y
      z = m.z
      continue
    }
    if (Number.isFinite(x)) {
      const n = Math.max(1, Math.ceil(Math.hypot(m.x - x, m.y - y, m.z - z) / step))
      for (let i = 1; i <= n; i++) yield [x + ((m.x - x) * i) / n, y + ((m.y - y) * i) / n, z + ((m.z - z) * i) / n]
    } else yield [m.x, m.y, m.z]
    x = m.x
    y = m.y
    z = m.z
  }
}

export function checkGouge(mesh: Mesh, tool: CheckTool, moves: Move[], opt: { stock?: number; step?: number; resolution?: number; /** Check at most this many evenly spread positions (sampled check only). */ maxPoints?: number } = {}): GougeReport {
  const stock = Math.max(0, opt.stock ?? 0)
  const step = opt.step ?? 0.05
  const rep: GougeReport = { max: -Infinity, at: null, minClearance: Infinity, points: 0, exact: tool.shape === 'ball', resolution: 0 }
  if (tool.shape === 'ball') {
    const grid = new TriGrid(mesh)
    const stamp = new Int32Array(triCount(mesh))
    let mark = 0
    const R = tool.r + stock
    for (const [x, y, z] of positions(moves, step)) {
      rep.points++
      const d = grid.nearest(x, y, z + tool.r, stamp, ++mark)
      const g = R - d
      if (g > rep.max) {
        rep.max = g
        rep.at = [x, y, z]
      }
      rep.minClearance = Math.min(rep.minClearance, d - R)
    }
    return rep
  }
  // sampled check: grown cutter for stock to leave (exact for flat and bull; V must have none)
  const res = opt.resolution ?? Math.min(0.02, tool.r / 50)
  rep.resolution = res
  const c: Cutter =
    tool.shape === 'v'
      ? { r: tool.r, shape: 'v', angle: tool.angle ?? 90 }
      : { r: tool.r + stock, shape: 'bull', angle: 0, cornerRadius: (tool.shape === 'flat' ? 0 : (tool.cornerRadius ?? 0)) + stock }
  const lower = tool.shape === 'v' ? 0 : stock
  const p = mesh.positions
  const ix = mesh.indices
  const nt = triCount(mesh)
  // bucket facets by XY box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < p.length; i += 3) {
    minX = Math.min(minX, p[i])
    maxX = Math.max(maxX, p[i])
    minY = Math.min(minY, p[i + 1])
    maxY = Math.max(maxY, p[i + 1])
  }
  const cell = Math.max(c.r, 1)
  const gx = Math.max(1, Math.ceil((maxX - minX) / cell) + 1)
  const gy = Math.max(1, Math.ceil((maxY - minY) / cell) + 1)
  const buckets: number[][] = Array.from({ length: gx * gy }, () => [])
  for (let t = 0; t < nt; t++) {
    const xs = [0, 1, 2].map((k) => p[ix[t * 3 + k] * 3])
    const ys = [0, 1, 2].map((k) => p[ix[t * 3 + k] * 3 + 1])
    for (let j = Math.floor((Math.min(...ys) - minY) / cell); j <= Math.floor((Math.max(...ys) - minY) / cell); j++)
      for (let i = Math.floor((Math.min(...xs) - minX) / cell); i <= Math.floor((Math.max(...xs) - minX) / cell); i++) buckets[j * gx + i].push(t)
  }
  const all = [...positions(moves, step)]
  const stride = opt.maxPoints ? Math.max(1, Math.ceil(all.length / opt.maxPoints)) : 1
  for (let q = 0; q < all.length; q += stride) {
    const [x, y, z] = all[q]
    rep.points++
    const tip = z - lower
    const seen = new Set<number>()
    for (let j = Math.max(0, Math.floor((y - c.r - minY) / cell)); j <= Math.min(gy - 1, Math.floor((y + c.r - minY) / cell)); j++)
      for (let i = Math.max(0, Math.floor((x - c.r - minX) / cell)); i <= Math.min(gx - 1, Math.floor((x + c.r - minX) / cell)); i++)
        for (const t of buckets[j * gx + i]) {
          if (seen.has(t)) continue
          seen.add(t)
          const v = [0, 1, 2].map((k) => ix[t * 3 + k] * 3)
          const A = [p[v[0]], p[v[0] + 1], p[v[0] + 2]]
          const B = [p[v[1]], p[v[1] + 1], p[v[1] + 2]]
          const C = [p[v[2]], p[v[2] + 1], p[v[2] + 2]]
          const span = Math.max(Math.hypot(B[0] - A[0], B[1] - A[1]), Math.hypot(C[0] - A[0], C[1] - A[1]), Math.hypot(C[0] - B[0], C[1] - B[1]))
          const n = Math.max(1, Math.ceil(span / res))
          for (let a = 0; a <= n; a++)
            for (let b = 0; a + b <= n; b++) {
              const u = a / n
              const w = b / n
              const sx = A[0] + (B[0] - A[0]) * u + (C[0] - A[0]) * w
              const sy = A[1] + (B[1] - A[1]) * u + (C[1] - A[1]) * w
              const d = Math.hypot(sx - x, sy - y)
              if (d > c.r) continue
              const sz = A[2] + (B[2] - A[2]) * u + (C[2] - A[2]) * w
              const g = sz - cutterZ(c, tip, d)
              if (g > rep.max) {
                rep.max = g
                rep.at = [x, y, z]
              }
              rep.minClearance = Math.min(rep.minClearance, -g)
            }
        }
  }
  return rep
}

/** Exact distance from a point to the nearest facet (for tests and reports). */
export function distanceToMesh(mesh: Mesh, x: number, y: number, z: number): number {
  let best = Infinity
  const p = mesh.positions
  const ix = mesh.indices
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3
    best = Math.min(best, pointTriDist2(x, y, z, p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]))
  }
  return Math.sqrt(best)
}
