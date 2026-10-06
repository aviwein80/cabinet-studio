/**
 * A face's own rows and columns on an imported solid (M3.1g, for curve-driven finishing).
 *
 * The solid reader keeps faces as triangles only. Here the B-rep kernel (`brep.ts`) reads the same
 * file again, finds the face (by where it lies: its points against the stored face's triangles,
 * and its area), and samples its true surface on a grid of its own parameters: row after row along
 * the first parameter (rows), each row at a value of the second (so the columns run along the
 * second). The grid is fine enough that straight pieces between its points stay within the chord
 * tolerance of the surface. Points outside the trimmed face (holes, cut edges) are left out of the
 * facets, so passes stop at the face's edges (within one grid spacing).
 *
 * The result is an ordinary surface mesh with its rows and columns (`Mesh.grid`), in part
 * coordinates (placed like the solid), ready to be added as a surface model that curve-driven
 * passes follow.
 */
import type { ModelPlacement } from '../types'
import type { Mesh } from '../mesh/types'
import { UNIT_MM, type MeshUnits } from '../mesh/types'
import type { BrepKernel } from './brep'
import { placementFrame } from './faces'
import { readStepMeta } from './step21'
import type { SolidData, V3 } from './types'

export interface FaceGridOptions {
  /** Largest gap between straight pieces of the grid and the true surface, mm (default 0.01). */
  tol?: number
  /** Most grid points (default 250,000). */
  maxPoints?: number
}

export interface FaceGridResult {
  mesh: Mesh
  /** The face (id in the solid) and its index in the kernel's reading of the file. */
  faceId: number
  brepIndex: number
  rows: number
  cols: number
  /** Grid points inside the trimmed face. */
  inside: number
  /** Largest gap found between the grid's straight pieces and the surface, mm. */
  chord: number
  /** Surface type as the kernel names it (e.g. BSplineSurface, Cylinder). */
  surface: string
  warnings: string[]
}

export class FaceGridError extends Error {}

type Pnt = { X(): number; Y(): number; Z(): number }

/** The kernel's enum values come back as objects or numbers depending on the build. */
const enumName = (v: unknown): string => (typeof v === 'object' && v && 'constructor' in v ? String((v as { constructor: { name?: string } }).constructor?.name ?? '') : String(v))

/**
 * Rows and columns of face `faceId` of `solid` (read from `bytes`, the file it came from), placed
 * as the model `place` puts it.
 */
export function faceGrid(oc: BrepKernel, bytes: Uint8Array, format: SolidData['format'], solid: SolidData, place: ModelPlacement, faceId: number, opt: FaceGridOptions = {}): FaceGridResult {
  const tol = Math.max(0.001, opt.tol ?? 0.01)
  const maxPoints = Math.max(100, opt.maxPoints ?? 250_000)
  const warnings: string[] = []
  if (format === 'iges') throw new FaceGridError('Rows and columns of a face need the solid as a STEP or BREP file: the B-rep kernel in this app has no IGES reader. Save the model as STEP and import that.')
  const body = solid.bodies.find((b) => b.faces.some((f) => f.id === faceId))
  const face = body?.faces.find((f) => f.id === faceId)
  if (!body || !face) throw new FaceGridError(`Face ${faceId} is not in this solid.`)
  const pf = placementFrame(body, place)
  if ('error' in pf) throw new FaceGridError(pf.error)
  const { R, origin } = pf.frame
  // the reader gave mm from the file's unit; a unit chosen on import scaled it again
  const stated: MeshUnits = format === 'step' ? (readStepMeta(bytes).units ?? 'mm') : 'mm'
  const scale = UNIT_MM[solid.units as MeshUnits] && UNIT_MM[stated] ? UNIT_MM[solid.units as MeshUnits] / UNIT_MM[stated] : 1
  /** A point in the stored solid's frame (file mm) to part coordinates, as the model is placed. */
  const toPart = (p: V3): V3 => [R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2] - origin[0], R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2] - origin[1], R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2] - origin[2]]

  // read the file with the kernel
  const shape = readShape(oc, bytes, format)
  // (its own triangles: for finding the face and for its trimmed outline in its parameters)
  new oc.BRepMesh_IncrementalMesh(shape, Math.min(0.05, 5 * tol), false, 0.2, false)

  // the stored face's triangles (file mm), for matching
  const tris: number[][] = []
  let areaStored = 0
  for (let t = face.first; t <= face.last; t++) {
    const v = [0, 1, 2].map((k) => body.indices[t * 3 + k] * 3)
    const tri = v.flatMap((o) => [body.positions[o], body.positions[o + 1], body.positions[o + 2]])
    tris.push(tri)
    areaStored += triArea(tri)
  }
  const boxStored = boxOf(tris.flat())

  // find the kernel's face lying where the stored face lies
  let best: { f: BrepKernel; idx: number; d: number; tri: Triangulation } | null = null
  const ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE)
  for (let idx = 0; ex.More(); ex.Next(), idx++) {
    const f = oc.TopoDS.Face(ex.Current())
    const tri = triangulation(oc, f, scale)
    if (!tri || !tri.nodes.length) continue
    // quick reject by the boxes, then the area, then every node's distance from the stored triangles
    const box = boxOf(tri.nodes)
    if (box.some((v, k) => Math.abs(v - boxStored[k]) > 0.5 + 0.01 * Math.max(1, Math.abs(boxStored[k])))) continue
    if (Math.abs(tri.area - areaStored) > 0.03 * Math.max(areaStored, 1)) continue
    let d = 0
    const stepN = Math.max(1, Math.floor(tri.nodes.length / 3 / 60))
    for (let i = 0; i < tri.nodes.length / 3 && d < 1; i += stepN) d = Math.max(d, nearestTri(tris, tri.nodes[i * 3], tri.nodes[i * 3 + 1], tri.nodes[i * 3 + 2]))
    if (!best || d < best.d) best = { f, idx, d, tri }
  }
  // (both are faceted within about 0.05 mm of the true surface)
  if (!best || best.d > 0.2) throw new FaceGridError(`Face ${faceId} was not found again in the file (${best ? `nearest face ${best.d.toFixed(2)} mm off` : 'no face of the same size and place'}). Import the file again, then try once more.`)
  const f = best.f
  const tri = best.tri

  // the face's true surface over its parameter range
  const ad = new oc.BRepAdaptor_Surface(f, true)
  const surface = enumName(ad.GetType()).replace(/^GeomAbs_/, '') || 'surface'
  const b = oc.BRepTools.UVBounds(f) as { UMin: number; UMax: number; VMin: number; VMax: number }
  const reversed = /REVERSED/.test(enumName(f.Orientation()))
  const P = (u: number, v: number): V3 => {
    const p = ad.Value(u, v) as Pnt
    return [p.X() * scale, p.Y() * scale, p.Z() * scale]
  }
  const uClosed = !!ad.IsUClosed() && Math.abs(b.UMax - b.UMin - (ad.IsUPeriodic() ? ad.UPeriod() : b.UMax - b.UMin)) < 1e-9 && dist(P(b.UMin, (b.VMin + b.VMax) / 2), P(b.UMax, (b.VMin + b.VMax) / 2)) < 1e-6
  const vClosed = !!ad.IsVClosed() && Math.abs(b.VMax - b.VMin - (ad.IsVPeriodic() ? ad.VPeriod() : b.VMax - b.VMin)) < 1e-9 && dist(P((b.UMin + b.UMax) / 2, b.VMin), P((b.UMin + b.UMax) / 2, b.VMax)) < 1e-6
  // lengths along each parameter (largest over a few lines), for the spacing
  let Lu = 0
  let Lv = 0
  for (let k = 0; k <= 8; k++) {
    const t = k / 8
    Lu = Math.max(Lu, curveLen((s) => P(b.UMin + (b.UMax - b.UMin) * s, b.VMin + (b.VMax - b.VMin) * t)))
    Lv = Math.max(Lv, curveLen((s) => P(b.UMin + (b.UMax - b.UMin) * t, b.VMin + (b.VMax - b.VMin) * s)))
  }
  // grid fine enough for the chord tolerance (halved until it is, or the point limit is reached)
  let h = 0.5
  let nu = 2
  let nv = 2
  let chord = Infinity
  for (let round = 0; round < 6; round++) {
    nu = Math.max(2, Math.ceil(Lu / h) + 1)
    nv = Math.max(2, Math.ceil(Lv / h) + 1)
    if (nu * nv > maxPoints) {
      const k = Math.sqrt((nu * nv) / maxPoints)
      nu = Math.max(2, Math.floor(nu / k))
      nv = Math.max(2, Math.floor(nv / k))
    }
    chord = chordError(P, b, nu, nv)
    if (chord <= tol || nu * nv >= maxPoints * 0.9) break
    h /= 2
  }
  if (chord > tol) warnings.push(`The face is large for the grid: its rows and columns are within ${chord.toFixed(3)} mm of the true surface (asked: ${tol} mm).`)
  // grid: row j at v_j, its points along u (closed directions without the repeated last point)
  const cols = uClosed ? nu - 1 : nu
  const rows = vClosed ? nv - 1 : nv
  const us = Array.from({ length: cols }, (_, i) => b.UMin + ((b.UMax - b.UMin) * i) / (nu - 1))
  const vs = Array.from({ length: rows }, (_, j) => b.VMin + ((b.VMax - b.VMin) * j) / (nv - 1))
  const positions = new Float32Array(rows * cols * 3)
  const inside = new Uint8Array(rows * cols)
  const uvIn = uvInside(tri)
  let nIn = 0
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      positions.set(toPart(P(us[i], vs[j])), (j * cols + i) * 3)
      if (uvIn(us[i], vs[j])) {
        inside[j * cols + i] = 1
        nIn++
      }
    }
  if (nIn < 4) throw new FaceGridError(`Face ${faceId} is too small or too narrow for rows and columns at this grid.`)
  // facets over the quads whose four corners are inside the face, facing out of the material
  const idx: number[] = []
  const at = (i: number, j: number) => (j % rows) * cols + (i % cols)
  // (a forward face's outward normal is d/du x d/dv; a reversed face's the other way; the
  // placement only turns the model, so the winding carries over)
  const flip = reversed
  for (let j = 0; j < (vClosed ? rows : rows - 1); j++)
    for (let i = 0; i < (uClosed ? cols : cols - 1); i++) {
      const a = at(i, j)
      const bb = at(i + 1, j)
      const c = at(i + 1, j + 1)
      const d = at(i, j + 1)
      if (!(inside[a] && inside[bb] && inside[c] && inside[d])) continue
      if (flip) idx.push(a, d, c, a, c, bb)
      else idx.push(a, bb, c, a, c, d)
    }
  const mesh: Mesh = { positions, indices: Uint32Array.from(idx), grid: { rows, cols, closedRows: vClosed, closedCols: uClosed, ...(nIn < rows * cols ? { trimmed: true } : {}) } }
  return { mesh, faceId, brepIndex: best.idx, rows, cols, inside: nIn, chord, surface, warnings }
}

function readShape(oc: BrepKernel, bytes: Uint8Array, format: SolidData['format']) {
  if (format === 'brep') {
    const shape = oc.BRepToolsWrapper.Read(new TextDecoder('latin1').decode(bytes))
    if (!shape || shape.IsNull()) throw new FaceGridError('The B-rep kernel could not read this BREP file.')
    return shape
  }
  const file = '/cabinet-studio-face.step'
  oc.FS.writeFile(file, bytes)
  try {
    const r = new oc.STEPControl_Reader()
    const status = enumName(r.ReadFile(file))
    if (!/RetDone/.test(status)) throw new FaceGridError(`The B-rep kernel could not read this STEP file (${status.replace(/^IFSelect_/, '')}).`)
    r.TransferRoots(new oc.Message_ProgressRange())
    const shape = r.OneShape()
    if (!shape || shape.IsNull()) throw new FaceGridError('The STEP file has no shape the B-rep kernel can use.')
    return shape
  } finally {
    try {
      oc.FS.unlink(file)
    } catch {
      // already gone
    }
  }
}

interface Triangulation {
  /** Nodes in file mm (scaled), x y z. */
  nodes: number[]
  /** Parameter (u, v) of each node. */
  uv: number[]
  /** Three node indices per triangle (0-based). */
  tris: number[]
  area: number
}

function triangulation(oc: BrepKernel, f: unknown, scale: number): Triangulation | null {
  const loc = new oc.TopLoc_Location()
  const t = oc.BRep_Tool.Triangulation(f, loc, 0)
  if (!t || (typeof t.IsNull === 'function' && t.IsNull())) return null
  const n = t.NbNodes()
  const trsf = loc.Transformation()
  const nodes: number[] = []
  const uv: number[] = []
  const hasUV = t.HasUVNodes()
  for (let i = 1; i <= n; i++) {
    const p = (t.Node(i) as { Transformed(x: unknown): Pnt }).Transformed(trsf)
    nodes.push(p.X() * scale, p.Y() * scale, p.Z() * scale)
    if (hasUV) {
      const q = t.UVNode(i) as { X(): number; Y(): number }
      uv.push(q.X(), q.Y())
    }
  }
  const tris: number[] = []
  let area = 0
  for (let i = 1; i <= t.NbTriangles(); i++) {
    const tr = t.Triangle(i) as { Value(k: number): number }
    const a = tr.Value(1) - 1
    const b = tr.Value(2) - 1
    const c = tr.Value(3) - 1
    tris.push(a, b, c)
    area += triArea([nodes[a * 3], nodes[a * 3 + 1], nodes[a * 3 + 2], nodes[b * 3], nodes[b * 3 + 1], nodes[b * 3 + 2], nodes[c * 3], nodes[c * 3 + 1], nodes[c * 3 + 2]])
  }
  return { nodes, uv: hasUV ? uv : [], tris, area }
}

/** Is (u, v) inside the face's triangles in its parameter plane (a grid of buckets for speed)? */
function uvInside(t: Triangulation): (u: number, v: number) => boolean {
  if (!t.uv.length) return () => true
  let u0 = Infinity
  let u1 = -Infinity
  let v0 = Infinity
  let v1 = -Infinity
  for (let i = 0; i < t.uv.length; i += 2) {
    u0 = Math.min(u0, t.uv[i])
    u1 = Math.max(u1, t.uv[i])
    v0 = Math.min(v0, t.uv[i + 1])
    v1 = Math.max(v1, t.uv[i + 1])
  }
  const nt = t.tris.length / 3
  const N = Math.max(1, Math.min(256, Math.ceil(Math.sqrt(nt))))
  const du = (u1 - u0) / N || 1
  const dv = (v1 - v0) / N || 1
  const buckets: number[][] = Array.from({ length: N * N }, () => [])
  const cl = (x: number) => Math.max(0, Math.min(N - 1, x))
  for (let k = 0; k < nt; k++) {
    const ids = [t.tris[k * 3], t.tris[k * 3 + 1], t.tris[k * 3 + 2]]
    const uu = ids.map((i) => t.uv[i * 2])
    const vv = ids.map((i) => t.uv[i * 2 + 1])
    for (let a = cl(Math.floor((Math.min(...uu) - u0) / du)); a <= cl(Math.floor((Math.max(...uu) - u0) / du)); a++)
      for (let c = cl(Math.floor((Math.min(...vv) - v0) / dv)); c <= cl(Math.floor((Math.max(...vv) - v0) / dv)); c++) buckets[c * N + a].push(k)
  }
  const eps = 1e-9 * Math.max(u1 - u0, v1 - v0, 1)
  return (u, v) => {
    if (u < u0 - eps || u > u1 + eps || v < v0 - eps || v > v1 + eps) return false
    for (const k of buckets[cl(Math.floor((v - v0) / dv)) * N + cl(Math.floor((u - u0) / du))]) {
      const [a, b, c] = [t.tris[k * 3], t.tris[k * 3 + 1], t.tris[k * 3 + 2]]
      const ax = t.uv[a * 2]
      const ay = t.uv[a * 2 + 1]
      const bx = t.uv[b * 2]
      const by = t.uv[b * 2 + 1]
      const cx = t.uv[c * 2]
      const cy = t.uv[c * 2 + 1]
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
      if (Math.abs(d) < 1e-30) continue
      const l1 = ((by - cy) * (u - cx) + (cx - bx) * (v - cy)) / d
      const l2 = ((cy - ay) * (u - cx) + (ax - cx) * (v - cy)) / d
      const l3 = 1 - l1 - l2
      if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) return true
    }
    return false
  }
}

function chordError(P: (u: number, v: number) => V3, b: { UMin: number; UMax: number; VMin: number; VMax: number }, nu: number, nv: number): number {
  // the middle of grid pieces against the straight piece, on a spread of cells
  let worst = 0
  const su = Math.max(1, Math.floor((nu - 1) / 24))
  const sv = Math.max(1, Math.floor((nv - 1) / 24))
  const U = (i: number) => b.UMin + ((b.UMax - b.UMin) * i) / (nu - 1)
  const V = (j: number) => b.VMin + ((b.VMax - b.VMin) * j) / (nv - 1)
  for (let j = 0; j < nv; j += sv)
    for (let i = 0; i < nu - 1; i += su) {
      const a = P(U(i), V(j))
      const c = P(U(i + 1), V(j))
      worst = Math.max(worst, dist(P((U(i) + U(i + 1)) / 2, V(j)), [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2]))
    }
  for (let i = 0; i < nu; i += su)
    for (let j = 0; j < nv - 1; j += sv) {
      const a = P(U(i), V(j))
      const c = P(U(i), V(j + 1))
      worst = Math.max(worst, dist(P(U(i), (V(j) + V(j + 1)) / 2), [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2]))
    }
  return worst
}

function curveLen(at: (s: number) => V3): number {
  let L = 0
  let prev = at(0)
  for (let k = 1; k <= 64; k++) {
    const p = at(k / 64)
    L += dist(p, prev)
    prev = p
  }
  return L
}

const dist = (a: V3 | number[], b: V3 | number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

function triArea(t: number[]): number {
  const ux = t[3] - t[0]
  const uy = t[4] - t[1]
  const uz = t[5] - t[2]
  const vx = t[6] - t[0]
  const vy = t[7] - t[1]
  const vz = t[8] - t[2]
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
}

function boxOf(p: number[]): number[] {
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[i + k])
      hi[k] = Math.max(hi[k], p[i + k])
    }
  return [...lo, ...hi]
}

/** Distance from (x, y, z) to the nearest of the triangles (9 numbers each). */
function nearestTri(tris: number[][], x: number, y: number, z: number): number {
  let best = Infinity
  for (const t of tris) best = Math.min(best, pointTri(x, y, z, t))
  return best
}

function pointTri(px: number, py: number, pz: number, t: number[]): number {
  // closest point on triangle (Ericson)
  const [ax, ay, az, bx, by, bz, cx, cy, cz] = t
  const abx = bx - ax
  const aby = by - ay
  const abz = bz - az
  const acx = cx - ax
  const acy = cy - ay
  const acz = cz - az
  const apx = px - ax
  const apy = py - ay
  const apz = pz - az
  const d1 = abx * apx + aby * apy + abz * apz
  const d2 = acx * apx + acy * apy + acz * apz
  const D = (qx: number, qy: number, qz: number) => Math.hypot(px - qx, py - qy, pz - qz)
  if (d1 <= 0 && d2 <= 0) return D(ax, ay, az)
  const bpx = px - bx
  const bpy = py - by
  const bpz = pz - bz
  const d3 = abx * bpx + aby * bpy + abz * bpz
  const d4 = acx * bpx + acy * bpy + acz * bpz
  if (d3 >= 0 && d4 <= d3) return D(bx, by, bz)
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3)
    return D(ax + abx * v, ay + aby * v, az + abz * v)
  }
  const cpx = px - cx
  const cpy = py - cy
  const cpz = pz - cz
  const d5 = abx * cpx + aby * cpy + abz * cpz
  const d6 = acx * cpx + acy * cpy + acz * cpz
  if (d6 >= 0 && d5 <= d6) return D(cx, cy, cz)
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6)
    return D(ax + acx * w, ay + acy * w, az + acz * w)
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
    return D(bx + (cx - bx) * w, by + (cy - by) * w, bz + (cz - bz) * w)
  }
  const den = 1 / (va + vb + vc)
  const v = vb * den
  const w = vc * den
  return D(ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w)
}
