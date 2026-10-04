/**
 * Mesh utilities: Z sections as closed 2D contours, the outline seen from above, feature edges as
 * 3D polylines, deleting facets, and STL export.
 */
import { tick, type Work } from '@/core/cancel'
import { type Contour, fitPoints, type P, polyline } from '../geom'
import { inflatePolys, unionPolys } from '../kernel'
import { buildEdges } from './build'
import { type Mesh, triCount } from './types'

// ---------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------

export interface Section {
  /** Closed loops, counter-clockwise around material (holes clockwise), seen from above. */
  loops: P[][]
  /** Chains that do not close (the mesh has holes there). */
  open: P[][]
}

/**
 * Cut the mesh with the plane Z = z. A vertex exactly on the plane counts as above it, so every
 * crossing is on an edge and neighbouring facets share their crossing points exactly: closed
 * meshes always give closed loops.
 */
export function sectionAt(mesh: Mesh, z: number): Section {
  const p = mesh.positions
  const ix = mesh.indices
  const nv = p.length / 3
  const above = (v: number) => p[v * 3 + 2] >= z
  const key = (a: number, b: number) => (a < b ? a * nv + b : b * nv + a)
  const cross = (a: number, b: number): P => {
    const [lo, hi] = a < b ? [a, b] : [b, a]
    const za = p[lo * 3 + 2]
    const zb = p[hi * 3 + 2]
    const t = (z - za) / (zb - za)
    return { x: p[lo * 3] + (p[hi * 3] - p[lo * 3]) * t, y: p[lo * 3 + 1] + (p[hi * 3 + 1] - p[lo * 3 + 1]) * t }
  }
  const from = new Map<number, { to: number; a: P; b: P }>()
  for (let t = 0; t < ix.length; t += 3) {
    const v = [ix[t], ix[t + 1], ix[t + 2]]
    const up = v.map(above)
    if (up[0] === up[1] && up[1] === up[2]) continue
    // Direction from the winding (facets face outwards): leave through the edge the walk goes
    // above -> below and arrive at the edge it goes below -> above. Material is then on the left
    // (loops counter-clockwise around material). Exact even when a crossing has zero length.
    let e1: [number, number] | null = null
    let e2: [number, number] | null = null
    for (let k = 0; k < 3; k++) {
      const n = (k + 1) % 3
      if (up[k] && !up[n]) e1 = [v[k], v[n]]
      else if (!up[k] && up[n]) e2 = [v[k], v[n]]
    }
    if (!e1 || !e2) continue
    const a = cross(...e1)
    const b = cross(...e2)
    from.set(key(...e1), { to: key(...e2), a, b })
  }
  const loops: P[][] = []
  const open: P[][] = []
  const hasPred = new Set<number>()
  for (const s of from.values()) hasPred.add(s.to)
  const take = (start: number) => {
    const pts: P[] = []
    let k = start
    let s = from.get(k)
    while (s) {
      from.delete(k)
      if (!pts.length) pts.push(s.a)
      pts.push(s.b)
      k = s.to
      s = from.get(k)
    }
    return { pts, closed: k === start }
  }
  // open chains first (they start where nothing leads in), then the loops
  for (const k of [...from.keys()]) if (!hasPred.has(k) && from.has(k)) open.push(dedupe(take(k).pts))
  for (const k of [...from.keys()]) {
    if (!from.has(k)) continue
    const r = take(k)
    const pts = dedupe(r.pts)
    if (r.closed) {
      pts.pop()
      if (pts.length >= 3) loops.push(pts)
    } else open.push(pts)
  }
  return { loops, open }
}

function dedupe(pts: P[]) {
  const out: P[] = []
  for (const q of pts) if (!out.length || Math.hypot(q.x - out[out.length - 1].x, q.y - out[out.length - 1].y) > 1e-9) out.push(q)
  return out
}

/** Section loops as contours, optionally refitted to lines and arcs within `fitTol` mm. */
export function sectionContours(s: Section, fitTol = 0): Contour[] {
  const make = (pts: P[], closed: boolean): Contour => (fitTol > 0 && pts.length > 3 ? { segs: fitPoints(pts, closed, fitTol), closed } : polyline(pts, closed))
  return [...s.loops.map((l) => make(l, true)), ...s.open.filter((o) => o.length > 1).map((o) => make(o, false))]
}

/** Sections every `step` mm from the top down (or at the given levels). */
export function sectionLevels(mesh: Mesh, levels: number[], work?: Work): { z: number; section: Section }[] {
  return levels.map((z, i) => {
    tick(work, i, levels.length, 1, 0, 1, `Section ${i + 1} of ${levels.length}`)
    return { z, section: sectionAt(mesh, z) }
  })
}

// ---------------------------------------------------------------------------------------------
// Outline seen from above
// ---------------------------------------------------------------------------------------------

/**
 * Footprint of the mesh projected onto XY: the union of the upward-facing facets (every vertical
 * line through a closed solid or a relief surface meets one). Joined in batches so large meshes
 * stay fast; seams between facets are closed by growing 0.005 mm and shrinking back.
 */
export function projectOutline(mesh: Mesh, work?: Work): P[][] {
  const p = mesh.positions
  const ix = mesh.indices
  const nt = triCount(mesh)
  const batch: P[][] = []
  let parts: P[][][] = []
  const flush = () => {
    if (batch.length) parts.push(unionPolys(batch.splice(0)))
  }
  for (let t = 0; t < nt; t++) {
    tick(work, t, nt, 16384, 0, 0.8, 'Projecting facets')
    const a = ix[t * 3], b = ix[t * 3 + 1], c = ix[t * 3 + 2]
    const ax = p[a * 3], ay = p[a * 3 + 1]
    const bx = p[b * 3], by = p[b * 3 + 1]
    const cx = p[c * 3], cy = p[c * 3 + 1]
    const area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    if (area2 <= 1e-12) continue
    batch.push([{ x: ax, y: ay }, { x: bx, y: by }, { x: cx, y: cy }])
    if (batch.length >= 4096) flush()
  }
  flush()
  while (parts.length > 1) {
    const next: P[][][] = []
    for (let i = 0; i < parts.length; i += 2) next.push(i + 1 < parts.length ? unionPolys([...parts[i], ...parts[i + 1]]) : parts[i])
    parts = next
  }
  work?.progress?.(0.9, 'Cleaning outline')
  const merged = parts[0] ?? []
  return inflatePolys(inflatePolys(merged, 0.005, 'miter'), -0.005, 'miter').filter((r) => r.length >= 3)
}

// ---------------------------------------------------------------------------------------------
// Feature edges as 3D polylines
// ---------------------------------------------------------------------------------------------

/**
 * Edges where the surface folds by more than `angleDeg`, plus open edges, chained into 3D
 * polylines (facets and slices to polylines).
 */
export function featureEdges(mesh: Mesh, angleDeg = 30): [number, number, number][][] {
  const p = mesh.positions
  const ix = mesh.indices
  const nv = p.length / 3
  const e = buildEdges(ix, nv)
  const nt = triCount(mesh)
  const n = new Float64Array(nt * 3)
  for (let t = 0; t < nt; t++) {
    const a = ix[t * 3] * 3, b = ix[t * 3 + 1] * 3, c = ix[t * 3 + 2] * 3
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx
    const l = Math.hypot(x, y, z) || 1
    n.set([x / l, y / l, z / l], t * 3)
  }
  const cosMax = Math.cos((angleDeg * Math.PI) / 180)
  const adj = new Map<number, number[]>()
  const link = (a: number, b: number) => {
    adj.set(a, [...(adj.get(a) ?? []), b])
    adj.set(b, [...(adj.get(b) ?? []), a])
  }
  for (const s of e.used) {
    const h = e.h0[s]
    const t = (h / 3) | 0
    const a = ix[h]
    const b = ix[t * 3 + ((h - t * 3 + 1) % 3)]
    if (e.count[s] === 1) link(a, b)
    else if (e.count[s] === 2) {
      const t2 = (e.h1[s] / 3) | 0
      const d = n[t * 3] * n[t2 * 3] + n[t * 3 + 1] * n[t2 * 3 + 1] + n[t * 3 + 2] * n[t2 * 3 + 2]
      if (d < cosMax) link(a, b)
    } else link(a, b)
  }
  const used = new Set<string>()
  const k = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`)
  const P3 = (v: number): [number, number, number] => [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]]
  const chains: [number, number, number][][] = []
  const walk = (start: number, next: number) => {
    const out = [P3(start)]
    let prev = start
    let cur = next
    used.add(k(prev, cur))
    for (;;) {
      out.push(P3(cur))
      const nb = adj.get(cur) ?? []
      if (nb.length !== 2 || cur === start) break
      const nx = nb[0] === prev ? nb[1] : nb[0]
      if (used.has(k(cur, nx))) break
      used.add(k(cur, nx))
      prev = cur
      cur = nx
    }
    chains.push(out)
  }
  const verts = [...adj.keys()].sort((a, b) => a - b)
  for (const v of verts) if ((adj.get(v)?.length ?? 0) !== 2) for (const w of adj.get(v)!) if (!used.has(k(v, w))) walk(v, w)
  for (const v of verts) for (const w of adj.get(v)!) if (!used.has(k(v, w))) walk(v, w)
  return chains
}

// ---------------------------------------------------------------------------------------------
// Delete facets
// ---------------------------------------------------------------------------------------------

/** Keep only facets where `keep[t]` is set; unused vertices are dropped. */
export function keepFacets(mesh: Mesh, keep: (t: number) => boolean): Mesh {
  const nt = triCount(mesh)
  const tris: number[] = []
  for (let t = 0; t < nt; t++) if (keep(t)) tris.push(t)
  const map = new Int32Array(mesh.positions.length / 3).fill(-1)
  const pos: number[] = []
  const ix = new Uint32Array(tris.length * 3)
  const groups = mesh.groups ? new Uint32Array(tris.length) : undefined
  tris.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const v = mesh.indices[t * 3 + k]
      if (map[v] < 0) {
        map[v] = pos.length / 3
        pos.push(mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2])
      }
      ix[i * 3 + k] = map[v]
    }
    if (groups && mesh.groups) groups[i] = mesh.groups[t]
  })
  return { positions: Float32Array.from(pos), indices: ix, ...(groups ? { groups, groupNames: mesh.groupNames } : {}) }
}

/** Facet normal Z (cosine of the angle to vertical up). */
export function facetNz(mesh: Mesh, t: number) {
  const p = mesh.positions
  const a = mesh.indices[t * 3] * 3, b = mesh.indices[t * 3 + 1] * 3, c = mesh.indices[t * 3 + 2] * 3
  const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
  const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
  const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx
  return z / (Math.hypot(x, y, z) || 1)
}

export type FacetFilter = { k: 'facing-down'; maxDeg: number } | { k: 'group'; group: number } | { k: 'below'; z: number }

/** Delete facets: facing down (within `maxDeg` of straight down), in a group, or wholly below a Z. */
export function deleteFacets(mesh: Mesh, f: FacetFilter): Mesh {
  const cosLim = f.k === 'facing-down' ? Math.cos((f.maxDeg * Math.PI) / 180) : 0
  return keepFacets(mesh, (t) => {
    if (f.k === 'facing-down') return facetNz(mesh, t) > -cosLim
    if (f.k === 'group') return (mesh.groups?.[t] ?? 0) !== f.group
    const p = mesh.positions
    return [0, 1, 2].some((k) => p[mesh.indices[t * 3 + k] * 3 + 2] >= f.z)
  })
}

// ---------------------------------------------------------------------------------------------
// STL export
// ---------------------------------------------------------------------------------------------

export function writeStl(mesh: Mesh, name = 'Cabinet Studio'): Uint8Array {
  const nt = triCount(mesh)
  const buf = new Uint8Array(84 + nt * 50)
  const dv = new DataView(buf.buffer)
  const head = new TextEncoder().encode(name.slice(0, 79))
  buf.set(head, 0)
  dv.setUint32(80, nt, true)
  const p = mesh.positions
  for (let t = 0; t < nt; t++) {
    const o = 84 + t * 50
    const nz = [0, 1, 2].map((k) => mesh.indices[t * 3 + k] * 3)
    const ux = p[nz[1]] - p[nz[0]], uy = p[nz[1] + 1] - p[nz[0] + 1], uz = p[nz[1] + 2] - p[nz[0] + 2]
    const vx = p[nz[2]] - p[nz[0]], vy = p[nz[2] + 1] - p[nz[0] + 1], vz = p[nz[2] + 2] - p[nz[0] + 2]
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx
    const l = Math.hypot(x, y, z) || 1
    dv.setFloat32(o, x / l, true)
    dv.setFloat32(o + 4, y / l, true)
    dv.setFloat32(o + 8, z / l, true)
    for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) dv.setFloat32(o + 12 + k * 12 + c * 4, p[nz[k] + c], true)
  }
  return buf
}
