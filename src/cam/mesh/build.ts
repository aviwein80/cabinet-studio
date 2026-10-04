/**
 * Turn a triangle soup into a clean indexed mesh: scale to mm, weld identical corners, close small
 * gaps, drop collapsed facets, make every facet agree with its neighbours and face outwards
 * (closed shells) or upwards (open surfaces such as reliefs), and report what was found.
 */
import { checkCancel, tick, type Work } from '@/core/cancel'
import type { TriangleSoup } from './read'
import { type Mesh, type MeshReport, type MeshUnits, UNIT_MM } from './types'

export interface BuildOptions {
  /** Unit the file is drawn in. Default: what the file says (3MF), else millimetres. */
  units?: MeshUnits
  /** Open-edge endpoints closer than this (mm) are joined. 0 = off. Default 0.01 mm. */
  gapTol?: number
}

const pow2 = (n: number) => {
  let s = 1
  while (s < n) s <<= 1
  return s
}

// ---------------------------------------------------------------------------------------------
// Edge table (open addressing on numeric keys) shared by repair and the mesh tools
// ---------------------------------------------------------------------------------------------

export interface EdgeTable {
  /** Per half-edge (3 per facet): edge slot. */
  slot: Int32Array
  /** Per slot: number of facets using the edge, and the first two half-edges. */
  count: Int32Array
  h0: Int32Array
  h1: Int32Array
  /** Slots in use. */
  used: Int32Array
}

export function buildEdges(indices: Uint32Array, nVerts: number): EdgeTable {
  const nh = indices.length
  const size = pow2(Math.max(16, nh * 2))
  const mask = size - 1
  const keys = new Float64Array(size).fill(-1)
  const count = new Int32Array(size)
  const h0 = new Int32Array(size).fill(-1)
  const h1 = new Int32Array(size).fill(-1)
  const slot = new Int32Array(nh)
  const used: number[] = []
  for (let h = 0; h < nh; h++) {
    const t = h - (h % 3)
    const a = indices[h]
    const b = indices[t + ((h - t + 1) % 3)]
    const key = a < b ? a * nVerts + b : b * nVerts + a
    const lo = key >>> 0
    const hi = Math.floor(key / 4294967296)
    let i = (Math.imul(lo, 0x9e3779b1) ^ Math.imul(hi + 0x7f4a7c15, 0x85ebca77)) & mask
    while (keys[i] !== -1 && keys[i] !== key) i = (i + 1) & mask
    if (keys[i] === -1) {
      keys[i] = key
      used.push(i)
    }
    if (count[i] === 0) h0[i] = h
    else if (count[i] === 1) h1[i] = h
    count[i]++
    slot[h] = i
  }
  return { slot, count, h0, h1, used: Int32Array.from(used) }
}

export function edgeCounts(e: EdgeTable) {
  let open = 0
  let nonManifold = 0
  for (const s of e.used) {
    if (e.count[s] === 1) open++
    else if (e.count[s] > 2) nonManifold++
  }
  return { open, nonManifold }
}

// ---------------------------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------------------------

export function buildMesh(soup: TriangleSoup, opt: BuildOptions = {}, work?: Work): { mesh: Mesh; report: MeshReport } {
  const units = opt.units ?? soup.units ?? 'mm'
  const scale = UNIT_MM[units]
  const gapTol = opt.gapTol ?? 0.01
  const warnings = [...soup.warnings]
  const nc = soup.corners.length / 3

  // 1. weld bit-identical corners
  const size = pow2(Math.max(16, nc * 2))
  const mask = size - 1
  const table = new Int32Array(size).fill(-1)
  const vbits = new Uint32Array(nc * 3)
  const pos = new Float32Array(nc * 3)
  const f = new Float32Array(3)
  const u = new Uint32Array(f.buffer)
  let nv = 0
  const corner = new Uint32Array(nc)
  for (let c = 0; c < nc; c++) {
    tick(work, c, nc, 65536, 0, 0.4, 'Welding vertices')
    f[0] = soup.corners[c * 3] * scale + 0
    f[1] = soup.corners[c * 3 + 1] * scale + 0
    f[2] = soup.corners[c * 3 + 2] * scale + 0
    let i = (Math.imul(u[0], 73856093) ^ Math.imul(u[1], 19349663) ^ Math.imul(u[2], 83492791)) & mask
    for (;;) {
      const v = table[i]
      if (v === -1) {
        table[i] = nv
        vbits[nv * 3] = u[0]
        vbits[nv * 3 + 1] = u[1]
        vbits[nv * 3 + 2] = u[2]
        pos[nv * 3] = f[0]
        pos[nv * 3 + 1] = f[1]
        pos[nv * 3 + 2] = f[2]
        corner[c] = nv++
        break
      }
      if (vbits[v * 3] === u[0] && vbits[v * 3 + 1] === u[1] && vbits[v * 3 + 2] === u[2]) {
        corner[c] = v
        break
      }
      i = (i + 1) & mask
    }
  }

  // 2. facets, dropping those with a repeated corner
  let degenerate = 0
  const dropRepeated = (ix: Uint32Array, groups?: Uint32Array) => {
    const keep: number[] = []
    for (let t = 0; t < ix.length / 3; t++) {
      const a = ix[t * 3]
      const b = ix[t * 3 + 1]
      const c = ix[t * 3 + 2]
      if (a === b || b === c || a === c) degenerate++
      else keep.push(t)
    }
    const out = new Uint32Array(keep.length * 3)
    const g = groups ? new Uint32Array(keep.length) : undefined
    keep.forEach((t, k) => {
      out[k * 3] = ix[t * 3]
      out[k * 3 + 1] = ix[t * 3 + 1]
      out[k * 3 + 2] = ix[t * 3 + 2]
      if (g && groups) g[k] = groups[t]
    })
    return { ix: out, groups: g }
  }
  let { ix, groups } = dropRepeated(corner, soup.groups)
  checkCancel(work?.isCancelled)
  work?.progress?.(0.45, 'Checking edges')

  // 3. close small gaps: join open-edge endpoints closer than gapTol
  let gapsClosed = 0
  let edges = buildEdges(ix, nv)
  if (gapTol > 0 && edgeCounts(edges).open > 0) {
    const onOpen = new Uint8Array(nv)
    for (const s of edges.used)
      if (edges.count[s] === 1) {
        const h = edges.h0[s]
        const t = h - (h % 3)
        onOpen[ix[h]] = 1
        onOpen[ix[t + ((h - t + 1) % 3)]] = 1
      }
    const parent = new Int32Array(nv)
    for (let i = 0; i < nv; i++) parent[i] = i
    const find = (i: number): number => {
      while (parent[i] !== i) i = parent[i] = parent[parent[i]]
      return i
    }
    const cellOf = (x: number) => Math.floor(x / gapTol)
    const grid = new Map<string, number[]>()
    for (let v = 0; v < nv; v++) {
      if (!onOpen[v]) continue
      const key = `${cellOf(pos[v * 3])},${cellOf(pos[v * 3 + 1])},${cellOf(pos[v * 3 + 2])}`
      const list = grid.get(key)
      if (list) list.push(v)
      else grid.set(key, [v])
    }
    for (let v = 0; v < nv; v++) {
      if (!onOpen[v]) continue
      const cx = cellOf(pos[v * 3])
      const cy = cellOf(pos[v * 3 + 1])
      const cz = cellOf(pos[v * 3 + 2])
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++)
            for (const w of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
              if (w <= v) continue
              const d = Math.hypot(pos[v * 3] - pos[w * 3], pos[v * 3 + 1] - pos[w * 3 + 1], pos[v * 3 + 2] - pos[w * 3 + 2])
              if (d > gapTol) continue
              const a = find(v)
              const b = find(w)
              if (a !== b) {
                parent[Math.max(a, b)] = Math.min(a, b)
                gapsClosed++
              }
            }
    }
    if (gapsClosed) {
      const remap = new Uint32Array(ix.length)
      for (let i = 0; i < ix.length; i++) remap[i] = find(ix[i])
      ;({ ix, groups } = dropRepeated(remap, groups))
      edges = buildEdges(ix, nv)
    }
  }

  // 4. drop unused vertices
  const newId = new Int32Array(nv).fill(-1)
  let n2 = 0
  for (let i = 0; i < ix.length; i++) if (newId[ix[i]] < 0) newId[ix[i]] = n2++
  const positions = new Float32Array(n2 * 3)
  for (let v = 0; v < nv; v++) if (newId[v] >= 0) positions.set(pos.subarray(v * 3, v * 3 + 3), newId[v] * 3)
  for (let i = 0; i < ix.length; i++) ix[i] = newId[ix[i]]
  if (n2 !== nv) edges = buildEdges(ix, n2)
  nv = n2
  checkCancel(work?.isCancelled)
  work?.progress?.(0.7, 'Orienting facets')

  // 5. orientation: neighbours agree, closed shells face out, open surfaces face up
  const nt = ix.length / 3
  const flip = new Uint8Array(nt)
  const shell = new Int32Array(nt).fill(-1)
  const shellClosed: boolean[] = []
  const queue = new Int32Array(nt)
  let shells = 0
  for (let s0 = 0; s0 < nt; s0++) {
    if (shell[s0] >= 0) continue
    tick(work, s0, nt, 65536, 0.7, 0.2, 'Orienting facets')
    const id = shells++
    let closed = true
    let qh = 0
    let qt = 0
    queue[qt++] = s0
    shell[s0] = id
    while (qh < qt) {
      const t = queue[qh++]
      for (let k = 0; k < 3; k++) {
        const h = t * 3 + k
        const s = edges.slot[h]
        const c = edges.count[s]
        if (c === 1) closed = false
        if (c !== 2) continue
        const o = edges.h0[s] === h ? edges.h1[s] : edges.h0[s]
        const t2 = (o / 3) | 0
        if (shell[t2] >= 0) continue
        // same direction along the shared edge = inconsistent winding
        const same = ix[h] === ix[o]
        flip[t2] = flip[t] ^ (same ? 1 : 0)
        shell[t2] = id
        queue[qt++] = t2
      }
    }
    shellClosed.push(closed)
  }
  const vol = new Float64Array(shells)
  const upArea = new Float64Array(shells)
  for (let t = 0; t < nt; t++) {
    const [a, b, c] = flip[t] ? [ix[t * 3], ix[t * 3 + 2], ix[t * 3 + 1]] : [ix[t * 3], ix[t * 3 + 1], ix[t * 3 + 2]]
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2]
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2]
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2]
    vol[shell[t]] += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
    upArea[shell[t]] += (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  }
  let flipped = 0
  for (let t = 0; t < nt; t++) {
    const sh = shell[t]
    const outward = shellClosed[sh] ? vol[sh] < 0 : upArea[sh] < 0
    if (outward) flip[t] ^= 1
    if (flip[t]) {
      flipped++
      const b = ix[t * 3 + 1]
      ix[t * 3 + 1] = ix[t * 3 + 2]
      ix[t * 3 + 2] = b
    }
  }
  const { open, nonManifold } = edgeCounts(edges)
  if (soup.bad) warnings.push(`${soup.bad} bad facet(s) skipped (missing or non-numeric coordinates).`)
  if (open) warnings.push(`${open} open edge(s): the surface has holes. Fine for a relief; a solid should be closed.`)
  if (nonManifold) warnings.push(`${nonManifold} edge(s) shared by more than two facets.`)
  if (!nt) warnings.push('No usable facets.')
  work?.progress?.(1, 'Done')
  const mesh: Mesh = { positions, indices: ix, ...(groups && soup.groupNames ? { groups, groupNames: soup.groupNames } : {}) }
  return {
    mesh,
    report: {
      format: soup.format,
      triangles: soup.triangles,
      kept: nt,
      vertices: nv,
      badFacets: soup.bad,
      degenerate,
      flipped,
      gapsClosed,
      openEdges: open,
      nonManifoldEdges: nonManifold,
      shells,
      units,
      scale,
      warnings,
    },
  }
}

/** Build a mesh from an already indexed mesh (after edits): weld, repair and report. */
export function rebuild(mesh: Mesh, work?: Work) {
  const ix = mesh.indices
  const corners = new Float32Array(ix.length * 3)
  for (let i = 0; i < ix.length; i++) corners.set(mesh.positions.subarray(ix[i] * 3, ix[i] * 3 + 3), i * 3)
  const soup: TriangleSoup = { format: 'mesh', corners, triangles: ix.length / 3, bad: 0, warnings: [], ...(mesh.groups ? { groups: mesh.groups, groupNames: mesh.groupNames } : {}) }
  return buildMesh(soup, { units: 'mm', gapTol: 0 }, work)
}
