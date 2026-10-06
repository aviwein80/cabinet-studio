/**
 * M3.1e test models with facet groups (built directly, no welding): a prism whose side faces each
 * have their own group, and a floor with a thin upright sheet standing on it.
 */
import type { Mesh } from '@/cam/mesh/types'
import { ShapeUtils, Vector2 } from 'three'

type V3 = [number, number, number]

/** Triangles with groups, each turned to face `want`. */
class Soup {
  pos: number[] = []
  grp: number[] = []
  add(a: V3, b: V3, c: V3, want: V3, g: number) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const [p, q] = n[0] * want[0] + n[1] * want[1] + n[2] * want[2] >= 0 ? [b, c] : [c, b]
    this.pos.push(...a, ...p, ...q)
    this.grp.push(g)
  }
  mesh(names: string[]): Mesh {
    const nt = this.grp.length
    return { positions: Float32Array.from(this.pos), indices: Uint32Array.from({ length: nt * 3 }, (_, i) => i), groups: Uint32Array.from(this.grp), groupNames: names }
  }
}

/**
 * A closed prism: `profile` (x, z) counter-clockwise seen from -Y, from y = 0 to `length`. Side
 * face i (from point i to point i + 1) is in group `groups[i]`; both ends in group 0.
 */
export function groupedPrism(profile: [number, number][], groups: number[], length: number): Mesh {
  const s = new Soup()
  const n = profile.length
  for (let i = 0; i < n; i++) {
    const [x0, z0] = profile[i]
    const [x1, z1] = profile[(i + 1) % n]
    const out: V3 = [z1 - z0, 0, -(x1 - x0)]
    s.add([x0, 0, z0], [x1, 0, z1], [x1, length, z1], out, groups[i])
    s.add([x0, 0, z0], [x1, length, z1], [x0, length, z0], out, groups[i])
  }
  for (const [a, b, c] of ShapeUtils.triangulateShape(profile.map(([x, z]) => new Vector2(x, z)), [])) {
    const [A, B, C] = [profile[a], profile[b], profile[c]]
    s.add([A[0], 0, A[1]], [B[0], 0, B[1]], [C[0], 0, C[1]], [0, -1, 0], 0)
    s.add([A[0], length, A[1]], [B[0], length, B[1]], [C[0], length, C[1]], [0, 1, 0], 0)
  }
  return s.mesh(Array.from({ length: Math.max(...groups) + 1 }, (_, i) => (i ? `Face ${i}` : 'Ends')))
}

/** Radius of the round wall in VALLEY (centre x 0, z -25). */
export const ROUND_R = 30
const ROUND_END = Math.asin(25 / ROUND_R)

/**
 * A 100 x 60 block, 40 deep, cut along Y (x, z):
 * - group 5, a floor at z -25 from x 30 to 55;
 * - group 4, a 45° wall up from the floor (x 55) to z -10 (x 70): a valley with the floor;
 * - group 3, the top at -10 from x 70 to 100: a ridge with the wall;
 * - group 6, a round wall (radius 30 about x 0, z -25) rising from the floor at x 30 (square to
 *   it) and curving over to z 0: a valley between a flat and a curved face;
 * - group 7 the top at 0 from x 0 to the round; 1, 2, 8 the bottom and sides.
 */
export const VALLEY_PROFILE: [number, number][] = [
  [0, -40],
  [100, -40],
  [100, -10],
  [70, -10],
  [55, -25],
  [30, -25],
  ...Array.from({ length: 40 }, (_, i): [number, number] => {
    const a = (ROUND_END * (i + 1)) / 40
    return [ROUND_R * Math.cos(a), -25 + ROUND_R * Math.sin(a)]
  }),
  [0, 0],
]
export const VALLEY_GROUPS = [1, 2, 3, 4, 5, ...Array.from({ length: 40 }, () => 6), 7, 8]

/** A floor at z -20 (group 1, 100 x 60) with a thin upright sheet at x 50 (group 2, up to z 0) facing -X. */
export function floorAndSheet(): Mesh {
  const s = new Soup()
  s.add([0, 0, -20], [100, 0, -20], [100, 60, -20], [0, 0, 1], 1)
  s.add([0, 0, -20], [100, 60, -20], [0, 60, -20], [0, 0, 1], 1)
  s.add([50, 0, -20], [50, 60, -20], [50, 60, 0], [-1, 0, 0], 2)
  s.add([50, 0, -20], [50, 60, 0], [50, 0, 0], [-1, 0, 0], 2)
  return s.mesh(['None', 'Floor', 'Sheet'])
}

/** The facets of some groups as a mesh of their own (for independent distance checks). */
export function groupMesh(m: Mesh, groups: number[]): Mesh {
  const pos: number[] = []
  const nt = m.indices.length / 3
  for (let t = 0; t < nt; t++) {
    if (!groups.includes(m.groups ? m.groups[t] : 0)) continue
    for (let k = 0; k < 3; k++) {
      const v = m.indices[t * 3 + k]
      pos.push(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2])
    }
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from({ length: pos.length / 3 }, (_, i) => i) }
}
