/** M3.1d test parts with overhangs: a cross-section (x, z) run along Y as a closed mesh. */
import { buildMesh } from '@/cam/mesh/build'
import { parseStl } from '@/cam/mesh/read'
import type { Mesh } from '@/cam/mesh/types'
import { ShapeUtils, Vector2 } from 'three'
import { stlBinary } from './mesh-fixtures'

/** A closed prism: `profile` (x, z) counter-clockwise seen from -Y, from y = 0 to `length`. */
export function prism(profile: [number, number][], length: number): Mesh {
  const soup: number[][] = []
  const n = profile.length
  for (let i = 0; i < n; i++) {
    const [x0, z0] = profile[i]
    const [x1, z1] = profile[(i + 1) % n]
    soup.push([x0, 0, z0, x1, 0, z1, x1, length, z1], [x0, 0, z0, x1, length, z1, x0, length, z0])
  }
  const tris = ShapeUtils.triangulateShape(profile.map(([x, z]) => new Vector2(x, z)), [])
  for (const [a, b, c] of tris) {
    const A = profile[a], B = profile[b], C = profile[c]
    soup.push([A[0], 0, A[1], C[0], 0, C[1], B[0], 0, B[1]], [A[0], length, A[1], B[0], length, B[1], C[0], length, C[1]])
  }
  return buildMesh(parseStl(stlBinary(soup)), { gapTol: 0 }).mesh
}

/**
 * A block 80 x 60 x 50 with a dovetail-like lip along its right side: the lip's underside leans
 * out at about 69° from the recess (x = 30, z = -25) up to the lip's edge (x = 38, z = -4); the
 * floor in front of it is at -40.
 */
export const LIP: [number, number][] = [
  [0, -50],
  [80, -50],
  [80, -40],
  [30, -40],
  [30, -25],
  [38, -4],
  [38, 0],
  [0, 0],
]
/** The lip's underside, from the recess to the edge (x, z). */
export const UNDERSIDE: [[number, number], [number, number]] = [
  [30, -25],
  [38, -4],
]
