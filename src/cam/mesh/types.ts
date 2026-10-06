/**
 * Triangle meshes for 3D models (imported STL/OBJ/3MF, stock, sections). Indexed and welded:
 * `positions` holds x, y, z per vertex (mm, Float32 for storage; maths runs in float64),
 * `indices` holds three vertex indices per triangle, counter-clockwise seen from outside.
 */
export interface Mesh {
  positions: Float32Array
  indices: Uint32Array
  /** Optional per-triangle group (OBJ group, 3MF object, STEP face); names in `groupNames`. */
  groups?: Uint32Array
  groupNames?: string[]
  /**
   * Set on surfaces made of rows and columns of points (`gridMesh`): `rows` rows of `cols` points,
   * one row after the other in `positions`; closed rows wrap round to the first row, closed
   * columns (each row a loop) to the first point. Not stored with the mesh.
   */
  grid?: MeshGrid
}

export interface MeshGrid {
  rows: number
  cols: number
  closedRows: boolean
  closedCols: boolean
  /**
   * A trimmed face's grid (M3.1g): some points lie on the surface beyond the face's edges; only the
   * points its facets use are on the face, and lines along the grid stop where they leave them.
   */
  trimmed?: boolean
}

export interface Box3 {
  min: [number, number, number]
  max: [number, number, number]
}

/** What import found and fixed. */
export interface MeshReport {
  format: 'stl-binary' | 'stl-ascii' | 'obj' | '3mf' | 'mesh'
  /** Triangles in the file. */
  triangles: number
  /** Triangles kept after removing bad and degenerate facets. */
  kept: number
  vertices: number
  /** Facets with non-numeric coordinates, skipped. */
  badFacets: number
  /** Zero-area facets (or facets that collapsed when vertices were welded), removed. */
  degenerate: number
  /** Facets turned round to match their neighbours or to face outwards. */
  flipped: number
  /** Endpoints closer than the weld tolerance that were joined to close small gaps. */
  gapsClosed: number
  /** Edges used by one facet only (holes in the surface). */
  openEdges: number
  /** Edges used by more than two facets. */
  nonManifoldEdges: number
  /** Separate pieces (shells). */
  shells: number
  /** Unit the file was read in and the factor applied to reach mm. */
  units: MeshUnits
  scale: number
  warnings: string[]
}

export type MeshUnits = 'mm' | 'cm' | 'm' | 'in' | 'ft'

export const UNIT_MM: Record<MeshUnits, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }

export const triCount = (m: Mesh) => m.indices.length / 3
export const vertCount = (m: Mesh) => m.positions.length / 3

export function meshBounds(m: Pick<Mesh, 'positions'>): Box3 {
  const p = m.positions
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const v = p[i + k]
      if (v < min[k]) min[k] = v
      if (v > max[k]) max[k] = v
    }
  return { min, max }
}

/** Signed volume (positive when facets face outwards). */
export function meshVolume(m: Mesh): number {
  const p = m.positions
  const ix = m.indices
  let v = 0
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3
    const b = ix[t + 1] * 3
    const c = ix[t + 2] * 3
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])
  }
  return v / 6
}

export function meshArea(m: Mesh): number {
  const p = m.positions
  const ix = m.indices
  let s = 0
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3
    const b = ix[t + 1] * 3
    const c = ix[t + 2] * 3
    const ux = p[b] - p[a]
    const uy = p[b + 1] - p[a + 1]
    const uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a]
    const vy = p[c + 1] - p[a + 1]
    const vz = p[c + 2] - p[a + 2]
    s += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
  }
  return s
}
