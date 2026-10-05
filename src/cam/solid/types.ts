/**
 * Solid models (STEP, IGES, BREP) as the app keeps them: each body is the solid's faces, each
 * face a run of triangles whose corners lie exactly on the true surface (the reader places them
 * there), with the surface type and its exact parameters worked out from those points (plane,
 * cylinder, cone, sphere, or other). Face ids are kept from import onwards (1, 2, 3, ... over the
 * whole file, in the file's own order), so faces can be picked, coloured, sent to layers and
 * machined.
 */

export type V3 = [number, number, number]

export type SolidFormat = 'step' | 'iges' | 'brep'

export type SurfaceKind = 'plane' | 'cylinder' | 'cone' | 'sphere' | 'other'

/**
 * The surface a face lies on. Plane: points p with n·p = d, `n` the outward normal (out of the
 * material). Cylinder: axis through `p` along unit `v`, radius `r`. Cone: axis through `p` (the
 * apex) along `v` (towards the opening), half-angle `angle` (radians). Sphere: centre `p`, radius
 * `r`. `concave`: the material is outside the surface (a hole), not inside it (a boss).
 * `fit`: largest distance of the face's points from the surface found (mm).
 */
export interface FaceSurface {
  kind: SurfaceKind
  n?: V3
  d?: number
  p?: V3
  v?: V3
  r?: number
  angle?: number
  concave?: boolean
  fit: number
}

export interface SolidFace {
  /** Face id, unique in the file (1-based). */
  id: number
  /** Triangles of this face: `first` to `last` (inclusive) in the body's index list. */
  first: number
  last: number
  /** Colour from the file (#rrggbb), when it gives the face one. */
  color?: string
  surface: FaceSurface
  /** Area, mm² (exact for planes; the triangles' area for curved faces, within the reader's deflection). */
  area: number
}

export interface SolidBody {
  /** Index in the file (0-based). */
  index: number
  /** Product name from the file (may be empty). */
  name: string
  /** Assembly path: the names of the assemblies above it, outermost first. */
  path: string[]
  color?: string
  /** x, y, z per vertex in mm (float64: corners lie on the true surface). */
  positions: Float64Array
  /** Surface normal at each vertex (unit, pointing out of the material). */
  normals: Float32Array
  /** Three vertex indices per triangle, counter-clockwise seen from outside. */
  indices: Uint32Array
  faces: SolidFace[]
}

export interface SolidProduct {
  name: string
  /** User-defined properties (name -> text or number) when the file has them. */
  properties: Record<string, string | number>
}

export interface SolidData {
  format: SolidFormat
  /** STEP schema (AP203 / AP214 / AP242) or IGES version, when known. */
  schema?: string
  /** Length unit the file was drawn in (the data is always mm). */
  units: string
  bodies: SolidBody[]
  products: SolidProduct[]
  warnings: string[]
}

export const faceCount = (s: SolidData) => s.bodies.reduce((n, b) => n + b.faces.length, 0)
