/**
 * Relief import (ART-01): carved surfaces made elsewhere (an STL exported from relief software,
 * or a greyscale height map) brought onto a part at an exact size and depth, then machined with
 * the 3D roughing and finishing operations. We import reliefs; we do not model them.
 *
 * A relief is stored like any imported model (a mesh in the blob store), already made to its
 * size: X and Y from 0, its highest point at Z 0 and its lowest at -depth. `ReliefInfo` on the
 * model keeps its outline seen from above, so the operations stay inside it, and the panel face
 * round the relief is kept: the tool never cuts the panel outside the outline (`reliefSurround`).
 */
import { checkCancel, tick, type Work } from '@/core/cancel'
import type { P } from '../geom'
import { flat } from '../mesh/surface'
import { projectOutline } from '../mesh/tools'
import { type Mesh, meshBounds } from '../mesh/types'
import { placePoints } from '../mesh/place'
import type { ModelRef, ReliefInfo } from '../types'
import type { HeightImage } from './image'

const r3 = (n: number) => Math.round(n * 1000) / 1000

// ---------------------------------------------------------------------------------------------
// Height maps
// ---------------------------------------------------------------------------------------------

export interface HeightMapOptions {
  /** Size of the picture on the part, mm (X along the picture's width, Y along its height). */
  length: number
  width: number
  /** Depth from the highest to the lowest possible height, mm. */
  depth: number
  /** White is high (the usual way); otherwise black is high. */
  whiteHigh: boolean
  /** Use the picture's own lowest and highest values as the full depth. */
  stretch: boolean
  /** Distance between the points of the surface, mm. */
  spacing: number
  /** Smoothing passes over the surface points (0 = none). */
  smooth: number
  /** Transparent pixels count as the top (not cut) or the bottom (cut to the full depth). */
  transparent: 'top' | 'bottom'
}

/** Most surface points made by default (about 500,000 facets). */
export const DEFAULT_MAX_POINTS = 250_000
/** Most surface points allowed at all (about 4 million facets). */
export const MAX_POINTS = 2_000_000

/**
 * Default distance between surface points: one point per pixel, but no more than
 * `DEFAULT_MAX_POINTS` points over the whole relief. Rounded up to 0.01 mm.
 */
export function defaultSpacing(img: Pick<HeightImage, 'width' | 'height'>, length: number, width: number, maxPoints = DEFAULT_MAX_POINTS): number {
  const pixel = Math.max(length / img.width, width / img.height)
  const cap = Math.sqrt((length * width) / maxPoints)
  return Math.ceil(Math.max(pixel, cap, 0.01) * 100) / 100
}

/** Points along X and Y for a size and spacing. */
export function gridCounts(length: number, width: number, spacing: number) {
  const s = Math.max(0.01, spacing)
  return { nx: Math.max(2, Math.round(length / s) + 1), ny: Math.max(2, Math.round(width / s) + 1) }
}

export interface HeightMapResult {
  mesh: Mesh
  info: ReliefInfo
  warnings: string[]
}

/**
 * The surface of a height map: a grid of points `spacing` apart covering exactly `length` x
 * `width`, Z from 0 (highest) to -depth (lowest). Where a point covers several pixels it takes
 * their average; between pixels it is interpolated.
 */
export function heightMapMesh(img: HeightImage, opt: HeightMapOptions, work?: Work): HeightMapResult {
  const L = opt.length
  const Wd = opt.width
  const D = opt.depth
  if (!(L > 0 && Wd > 0)) throw new Error('Give the relief a length and a width.')
  if (!(D > 0)) throw new Error('Give the relief a depth.')
  const { nx, ny } = gridCounts(L, Wd, opt.spacing)
  if (nx * ny > MAX_POINTS) throw new Error(`That spacing makes ${(nx * ny).toLocaleString('en')} points; the most is ${MAX_POINTS.toLocaleString('en')}. Use a larger spacing.`)
  const warnings: string[] = []
  const { width: IW, height: IH } = img
  // heights 0..1 (1 = top) per pixel
  const h = new Float64Array(IW * IH)
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < h.length; i++) {
    const v = opt.whiteHigh ? img.values[i] : 1 - img.values[i]
    h[i] = v
    if (img.transparent?.[i]) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  if (!Number.isFinite(lo)) {
    lo = 0
    hi = 1
  }
  const stretch = opt.stretch && hi - lo > 1e-9
  if (opt.stretch && !stretch) warnings.push('The picture is one flat shade: there is nothing to stretch.')
  for (let i = 0; i < h.length; i++) {
    if (img.transparent?.[i]) h[i] = opt.transparent === 'top' ? 1 : 0
    else if (stretch) h[i] = (h[i] - lo) / (hi - lo)
  }
  if (img.transparent) warnings.push(`Transparent pixels count as the ${opt.transparent === 'top' ? 'top of the relief (not cut)' : 'bottom of the relief (cut to the full depth)'}.`)
  // summed-area table for averaging
  const sat = new Float64Array((IW + 1) * (IH + 1))
  for (let y = 0; y < IH; y++) {
    let row = 0
    for (let x = 0; x < IW; x++) {
      row += h[y * IW + x]
      sat[(y + 1) * (IW + 1) + x + 1] = sat[y * (IW + 1) + x + 1] + row
    }
  }
  const boxAvg = (x0: number, x1: number, y0: number, y1: number) => (sat[y1 * (IW + 1) + x1] - sat[y0 * (IW + 1) + x1] - sat[y1 * (IW + 1) + x0] + sat[y0 * (IW + 1) + x0]) / ((x1 - x0) * (y1 - y0))
  const at = (x: number, y: number) => h[Math.max(0, Math.min(IH - 1, y)) * IW + Math.max(0, Math.min(IW - 1, x))]
  const dx = L / (nx - 1)
  const dy = Wd / (ny - 1)
  // pixels per surface point
  const fx = (dx / L) * IW
  const fy = (dy / Wd) * IH
  const grid = new Float64Array(nx * ny)
  for (let j = 0; j < ny; j++) {
    tick(work, j, ny, 64, 0, 0.7, 'Sampling the picture')
    // picture rows run from the top (Y = width) down
    const py = ((Wd - j * dy) / Wd) * IH
    for (let i = 0; i < nx; i++) {
      const px = ((i * dx) / L) * IW
      let v: number
      if (fx > 1.5 || fy > 1.5) {
        // the pixels whose centres fall within the point's share of the picture
        const x0 = Math.max(0, Math.min(IW - 1, Math.ceil(px - fx / 2 - 0.5 - 1e-9)))
        const x1 = Math.max(x0 + 1, Math.min(IW, Math.floor(px + fx / 2 - 0.5 + 1e-9) + 1))
        const y0 = Math.max(0, Math.min(IH - 1, Math.ceil(py - fy / 2 - 0.5 - 1e-9)))
        const y1 = Math.max(y0 + 1, Math.min(IH, Math.floor(py + fy / 2 - 0.5 + 1e-9) + 1))
        v = boxAvg(x0, x1, y0, y1)
      } else {
        const u = Math.max(0, Math.min(IW - 1, px - 0.5))
        const w = Math.max(0, Math.min(IH - 1, py - 0.5))
        const x0 = Math.floor(u)
        const y0 = Math.floor(w)
        const tx = u - x0
        const ty = w - y0
        v = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty
      }
      grid[j * nx + i] = v
    }
  }
  for (let pass = 0; pass < Math.max(0, Math.floor(opt.smooth)); pass++) smoothGrid(grid, nx, ny)
  checkCancel(work?.isCancelled)
  const positions = new Float32Array(nx * ny * 3)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = (j * nx + i) * 3
      positions[k] = i === nx - 1 ? L : i * dx
      positions[k + 1] = j === ny - 1 ? Wd : j * dy
      positions[k + 2] = (grid[j * nx + i] - 1) * D
    }
  const indices = new Uint32Array((nx - 1) * (ny - 1) * 6)
  let q = 0
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i
      const b = a + 1
      const c = a + nx + 1
      const d = a + nx
      indices.set([a, b, c, a, c, d], q)
      q += 6
    }
  work?.progress?.(1, 'Surface made')
  if (img.levels && img.levels <= 256 && !opt.smooth) warnings.push(`8-bit picture: heights come in ${img.levels} steps of ${r3(D / (img.levels - 1))} mm${stretch ? ' (before stretching)' : ''}. A 16-bit picture or one smoothing pass hides them.`)
  if (opt.spacing < Math.max(L / IW, Wd / IH) * 0.75) warnings.push('The points are closer than the pixels: the extra points are interpolated and add no detail.')
  const mesh: Mesh = { positions, indices }
  const b = meshBounds(mesh)
  return {
    mesh,
    info: {
      from: 'image',
      size: [r3(L), r3(Wd), r3(b.max[2] - b.min[2])],
      outline: [[0, 0, r3(L), 0, r3(L), r3(Wd), 0, r3(Wd)]],
      image: { width: IW, height: IH, bits: img.bits, whiteHigh: opt.whiteHigh, stretched: stretch, spacing: r3(dx), smooth: Math.max(0, Math.floor(opt.smooth)), depth: r3(D) },
    },
    warnings,
  }
}

function smoothGrid(g: Float64Array, nx: number, ny: number) {
  const src = g.slice()
  const v = (i: number, j: number) => src[Math.max(0, Math.min(ny - 1, j)) * nx + Math.max(0, Math.min(nx - 1, i))]
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      let s = 0
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) s += v(i + a, j + b)
      g[j * nx + i] = s / 9
    }
}

// ---------------------------------------------------------------------------------------------
// Mesh reliefs (STL, OBJ, 3MF)
// ---------------------------------------------------------------------------------------------

const facetN = (p: Float32Array, ix: Uint32Array, t: number): [number, number, number, number] => {
  const a = ix[t * 3] * 3, b = ix[t * 3 + 1] * 3, c = ix[t * 3 + 2] * 3
  const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
  const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
  const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx
  const l = Math.hypot(x, y, z)
  return [x / (l || 1), y / (l || 1), z / (l || 1), l / 2]
}

export interface MeshReliefCheck {
  /** Size as read (mm). */
  size: [number, number, number]
  /** The model is a block with a flat bottom (a base) under the carved top. */
  base: boolean
  /** Depth of the carved top alone (highest to lowest point of the facets that face up), mm. */
  topDepth: number
}

/**
 * Look at a relief mesh: its size, whether it is a block with a flat bottom under the carving
 * (a base, which `stripBase` takes off), and the depth of the carved top alone.
 */
export function checkReliefMesh(mesh: Mesh): MeshReliefCheck {
  const b = meshBounds(mesh)
  const p = mesh.positions
  const ix = mesh.indices
  let down = 0
  let topMin = Infinity
  for (let t = 0; t < ix.length / 3; t++) {
    const [, , nz, area] = facetN(p, ix, t)
    if (nz < -0.9) down += area * -nz
    if (nz > 1e-3) for (let k = 0; k < 3; k++) topMin = Math.min(topMin, p[ix[t * 3 + k] * 3 + 2])
  }
  const footprint = (b.max[0] - b.min[0]) * (b.max[1] - b.min[1])
  const size: [number, number, number] = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]
  return { size, base: footprint > 0 && down >= 0.5 * footprint, topDepth: Number.isFinite(topMin) ? b.max[2] - topMin : size[2] }
}

/**
 * Take the base off a relief block: facets that face down, and the upright sides that run down
 * below the carved top. What is left is the carved top surface; the tool only ever touches that.
 */
export function stripBase(mesh: Mesh): { mesh: Mesh; removed: number } {
  const p = mesh.positions
  const ix = mesh.indices
  const nt = ix.length / 3
  let topMin = Infinity
  for (let t = 0; t < nt; t++) if (facetN(p, ix, t)[2] > 1e-3) for (let k = 0; k < 3; k++) topMin = Math.min(topMin, p[ix[t * 3 + k] * 3 + 2])
  const keep: number[] = []
  for (let t = 0; t < nt; t++) {
    const nz = facetN(p, ix, t)[2]
    if (nz < -1e-3) continue
    if (nz <= 1e-3 && [0, 1, 2].some((k) => p[ix[t * 3 + k] * 3 + 2] < topMin - 1e-3)) continue
    keep.push(t)
  }
  return { mesh: compact(mesh, keep), removed: nt - keep.length }
}

function compact(mesh: Mesh, tris: number[]): Mesh {
  const map = new Int32Array(mesh.positions.length / 3).fill(-1)
  const pos: number[] = []
  const out = new Uint32Array(tris.length * 3)
  const groups = mesh.groups ? new Uint32Array(tris.length) : undefined
  tris.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const v = mesh.indices[t * 3 + k]
      if (map[v] < 0) {
        map[v] = pos.length / 3
        pos.push(mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2])
      }
      out[i * 3 + k] = map[v]
    }
    if (groups) groups[i] = mesh.groups![t]
  })
  return { positions: Float32Array.from(pos), indices: out, ...(groups ? { groups, groupNames: mesh.groupNames } : {}) }
}

export interface ReliefSize {
  /** X, Y and depth (highest to lowest point), mm. */
  length: number
  width: number
  depth: number
}

/**
 * Make a relief mesh its final size: stretched (separately in X, Y and Z) to `size`, lowest X and
 * Y at 0, highest point at Z 0. Facets keep their winding (all three factors are positive).
 */
export function sizeRelief(mesh: Mesh, size: ReliefSize): Mesh {
  const b = meshBounds(mesh)
  const sx = b.max[0] - b.min[0]
  const sy = b.max[1] - b.min[1]
  const sz = b.max[2] - b.min[2]
  if (!(sx > 0 && sy > 0)) throw new Error('The relief has no length or width.')
  if (!(size.length > 0 && size.width > 0)) throw new Error('Give the relief a length and a width.')
  const kx = size.length / sx
  const ky = size.width / sy
  const kz = sz > 0 ? (size.depth > 0 ? size.depth / sz : 1) : 1
  const src = mesh.positions
  const out = new Float32Array(src.length)
  for (let i = 0; i < src.length; i += 3) {
    out[i] = (src[i] - b.min[0]) * kx
    out[i + 1] = (src[i + 1] - b.min[1]) * ky
    out[i + 2] = (src[i + 2] - b.max[2]) * kz
  }
  return { ...mesh, positions: out }
}

/** Douglas-Peucker on a closed loop, keeping points further than `tol` from the simplified line. */
function simplifyLoop(pts: P[], tol: number): P[] {
  if (pts.length <= 4) return pts
  // split at the point furthest from the first one, simplify both halves
  let far = 0
  let fd = -1
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y)
    if (d > fd) {
      fd = d
      far = i
    }
  }
  const half = (a: number, b: number): P[] => {
    const seg = pts.slice(a, b + 1)
    if (b === pts.length) seg.push(pts[0])
    return dp(seg, tol)
  }
  const one = half(0, far)
  const two = half(far, pts.length)
  return [...one.slice(0, -1), ...two.slice(0, -1)]
}

function dp(pts: P[], tol: number): P[] {
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const A = pts[a]
    const B = pts[b]
    const dx = B.x - A.x
    const dy = B.y - A.y
    const l = Math.hypot(dx, dy)
    let best = -1
    let bd = tol
    for (let i = a + 1; i < b; i++) {
      const d = l > 1e-12 ? Math.abs((pts[i].x - A.x) * dy - (pts[i].y - A.y) * dx) / l : Math.hypot(pts[i].x - A.x, pts[i].y - A.y)
      if (d > bd) {
        bd = d
        best = i
      }
    }
    if (best >= 0) {
      keep[best] = 1
      stack.push([a, best], [best, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

/**
 * Outline of a relief seen from above, as stored on the model: closed loops of x, y pairs
 * (rounded to 0.001 mm), simplified within `tol` mm.
 */
export function reliefOutlineOf(mesh: Mesh, tol = 0.01, work?: Work): number[][] {
  return projectOutline(mesh, work)
    .map((loop) => simplifyLoop(loop, tol))
    .filter((loop) => loop.length >= 3)
    .map((loop) => loop.flatMap((p) => [r3(p.x), r3(p.y)]))
}

/** Relief information for a sized mesh relief. */
export function meshReliefInfo(mesh: Mesh, source: { size: [number, number, number]; baseRemoved: number }, work?: Work): ReliefInfo {
  const b = meshBounds(mesh)
  return {
    from: 'mesh',
    size: [r3(b.max[0] - b.min[0]), r3(b.max[1] - b.min[1]), r3(b.max[2] - b.min[2])],
    outline: reliefOutlineOf(mesh, 0.01, work),
    mesh: { size: [r3(source.size[0]), r3(source.size[1]), r3(source.size[2])], baseRemoved: source.baseRemoved },
  }
}

// ---------------------------------------------------------------------------------------------
// On the part
// ---------------------------------------------------------------------------------------------

/** The relief's outline where the model is placed on the part (closed loops). */
export function placedReliefOutline(model: Pick<ModelRef, 'place' | 'relief'>): P[][] {
  const r = model.relief
  if (!r) return []
  const box = { min: [0, 0, -r.size[2]] as [number, number, number], max: [r.size[0], r.size[1], 0] as [number, number, number] }
  return r.outline.map((flatXY) => {
    const pts = new Float64Array((flatXY.length / 2) * 3)
    for (let i = 0; i < flatXY.length / 2; i++) {
      pts[i * 3] = flatXY[i * 2]
      pts[i * 3 + 1] = flatXY[i * 2 + 1]
    }
    const out = placePoints(pts, box, model.place)
    const loop: P[] = []
    for (let i = 0; i < out.length; i += 3) loop.push({ x: out[i], y: out[i + 1] })
    return loop
  })
}

const insideLoop = (loop: P[], p: P) => {
  let inside = false
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i]
    const b = loop[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/**
 * The panel face round a relief, as a flat surface at `z` (face 1) reaching `grow` mm past the
 * panel and the relief: everything outside the relief's outline (and inside any hole in it). Added
 * to the relief for the tool to drop onto, so no operation cuts the panel round the relief.
 */
export function reliefSurround(outline: P[][], panel: { length: number; width: number }, grow: number, z = 0): Mesh {
  let x0 = 0
  let y0 = 0
  let x1 = panel.length
  let y1 = panel.width
  for (const l of outline)
    for (const p of l) {
      x0 = Math.min(x0, p.x)
      y0 = Math.min(y0, p.y)
      x1 = Math.max(x1, p.x)
      y1 = Math.max(y1, p.y)
    }
  x0 -= grow
  y0 -= grow
  x1 += grow
  y1 += grow
  const loops = outline.filter((l) => l.length >= 3)
  // how many other loops each loop is inside: even = edge of the relief, odd = edge of a hole
  const depth = loops.map((l, i) => loops.reduce((n, o, j) => n + (j !== i && insideLoop(o, l[0]) ? 1 : 0), 0))
  const ring = (l: P[]) => l.map((p) => [p.x, p.y] as [number, number])
  const parts: Mesh[] = []
  const directChildren = (d: number, parent: P[] | null) => loops.filter((l, i) => depth[i] === d && (!parent || insideLoop(parent, l[0])))
  parts.push(
    flat(
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ],
      directChildren(0, null).map(ring),
      z,
    ),
  )
  loops.forEach((l, i) => {
    if (depth[i] % 2 === 1) parts.push(flat(ring(l), directChildren(depth[i] + 1, l).map(ring), z))
  })
  return mergeMeshes(parts)
}

/** Meshes joined into one (groups kept when every piece has them; `name` for pieces without). */
export function mergeMeshes(parts: Mesh[], name?: string): Mesh {
  const nv = parts.reduce((n, m) => n + m.positions.length, 0)
  const ni = parts.reduce((n, m) => n + m.indices.length, 0)
  const positions = new Float32Array(nv)
  const indices = new Uint32Array(ni)
  const grouped = parts.some((m) => m.groups)
  const names: string[] = []
  const groups = grouped ? new Uint32Array(ni / 3) : undefined
  let pv = 0
  let pi = 0
  for (const m of parts) {
    positions.set(m.positions, pv)
    const base = pv / 3
    for (let i = 0; i < m.indices.length; i++) indices[pi + i] = m.indices[i] + base
    if (groups) {
      const off = names.length
      if (m.groups) {
        let count = m.groupNames?.length ?? 0
        for (let t = 0; t < m.groups.length; t++) count = Math.max(count, m.groups[t] + 1)
        for (let k = 0; k < count; k++) names.push(m.groupNames?.[k] ?? '')
        for (let t = 0; t < m.indices.length / 3; t++) groups[pi / 3 + t] = m.groups[t] + off
      } else {
        names.push(name ?? '')
        for (let t = 0; t < m.indices.length / 3; t++) groups[pi / 3 + t] = off
      }
    }
    pv += m.positions.length
    pi += m.indices.length
  }
  return { positions, indices, ...(groups ? { groups, groupNames: names } : {}) }
}
