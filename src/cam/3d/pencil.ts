/**
 * Pencil pass (3D-06): the tool runs along the valleys and inside corners of the model, where it
 * touches two surfaces at once. On the tool-centre surface these are creases: crossing one, the
 * point where the tool touches the model jumps from one surface to the other, while elsewhere it
 * moves smoothly with the tool.
 *
 * Creases are found on a grid of exact drops (the touch point moving much further than the tool
 * between neighbours), each crossing pinned down by bisection (a true crease keeps its jump however
 * small the step; a tight smooth curve does not), joined into chains, and each chain split until
 * its straight pieces stay within the tolerance of the crease. Heights come from exact drops and
 * are refined like every other strategy, so the pass cannot dig in.
 */
import { checkCancel, type Work } from '@/core/cancel'
import type { P } from '../geom'
import { type Mesh, meshBounds } from '../mesh/types'
import type { Move } from '../toolpath'
import type { Finish3dOp, Levels } from '../types'
import { cutChains, type Pt, refineAlong } from './chain'
import { type Cutter3D, grownCutter } from './cutter'
import { DropCutter } from './dropcutter'
import type { Finish3dResult } from './parallel'
import { insideRegion, polysBox, type Region } from './region'

/** Valleys sharper than this (degrees between the two surfaces' normals) get a pass. */
export const PENCIL_MIN_ANGLE = 5

interface Touch {
  ok: boolean
  x: number
  y: number
}

export function pencilFinish(op: Finish3dOp, mesh: Mesh, cutter: Cutter3D, region: Region, levels: Levels, work?: Work): Finish3dResult {
  const warnings: string[] = []
  const none = (w: string): Finish3dResult => ({ moves: [], warnings: [...warnings, w], minZ: NaN, spacing: 0 })
  const s = Math.max(0, op.surface.stockToLeave)
  const grown = grownCutter(cutter, s)
  if (!grown) return none('Stock to leave needs a ball-nose, bull-nose or flat tool (not a V cutter).')
  const dc = new DropCutter(mesh, grown)
  const tol = Math.max(0.001, op.surface.tolerance || 0.01)
  const gougeTol = Math.min(tol, 0.002)
  const Rg = grown.R
  // a valley of angle a moves the touch point by about 2 Rg sin(a / 2) across the crease
  const minJump = 2 * Rg * Math.sin(((op.pencilAngle ?? PENCIL_MIN_ANGLE) * Math.PI) / 360)
  const hg = Math.min(0.5, Math.max(0.1, cutter.R / 6))
  const machine = op.surface.groups?.length ? new Set(op.surface.groups) : null
  const protect = new Set(op.surface.protect ?? [])
  const groups = mesh.groups

  const touch = (x: number, y: number): Touch => (dc.drop(x, y) ? { ok: true, x: dc.hitX, y: dc.hitY } : { ok: false, x: NaN, y: NaN })
  const jump = (a: Touch, b: Touch) => Math.hypot(a.x - b.x, a.y - b.y)

  /**
   * The crease between p and q (where the touch point jumps), to 0.001 mm, or null when the touch
   * point only moves smoothly (or there is no model under one end).
   */
  const crease = (p: P, q: P, tp?: Touch, tq?: Touch): P | null => {
    let a = p
    let b = q
    let ta = tp ?? touch(p.x, p.y)
    let tb = tq ?? touch(q.x, q.y)
    if (!ta.ok || !tb.ok) return null
    for (let k = 0; k < 30 && Math.hypot(b.x - a.x, b.y - a.y) > 0.001; k++) {
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const tm = touch(m.x, m.y)
      if (!tm.ok) return null
      // keep the half where the touch point jumps more
      if (jump(ta, tm) >= jump(tm, tb)) {
        b = m
        tb = tm
      } else {
        a = m
        ta = tm
      }
    }
    return jump(ta, tb) >= minJump ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null
  }

  // the grid and its crease crossings, one per grid edge at most
  const box = polysBox(region.polys)
  if (!(box.maxX > box.minX && box.maxY > box.minY)) return none('The boundary is empty.')
  const nx = Math.max(2, Math.ceil((box.maxX - box.minX) / hg) + 1)
  const ny = Math.max(2, Math.ceil((box.maxY - box.minY) / hg) + 1)
  const T: Touch[] = new Array(nx * ny)
  for (let j = 0; j < ny; j++) {
    if ((j & 15) === 0) {
      checkCancel(work?.isCancelled)
      work?.progress?.((0.5 * j) / ny, 'Looking for valleys')
    }
    for (let i = 0; i < nx; i++) T[j * nx + i] = touch(box.minX + i * hg, box.minY + j * hg)
  }
  const node = (i: number, j: number): P => ({ x: box.minX + i * hg, y: box.minY + j * hg })
  // edge ids: horizontal (i,j)-(i+1,j) = 2*(j*nx+i); vertical (i,j)-(i,j+1) = 2*(j*nx+i)+1
  const cross = new Map<number, P>()
  const test = (i0: number, j0: number, i1: number, j1: number, id: number) => {
    const a = T[j0 * nx + i0]
    const b = T[j1 * nx + i1]
    if (!a.ok || !b.ok) return
    // on one surface the touch point moves about as far as the tool (or less); much further means
    // the tool went over a crease (or a tight inside curve, which bisection tells apart)
    if (jump(a, b) <= 1.3 * hg) return
    const c = crease(node(i0, j0), node(i1, j1), a, b)
    if (c && insideRegion(region, c, 1e-4)) cross.set(id, c)
  }
  for (let j = 0; j < ny; j++) {
    if ((j & 15) === 0) {
      checkCancel(work?.isCancelled)
      work?.progress?.(0.5 + (0.3 * j) / ny, 'Following valleys')
    }
    for (let i = 0; i < nx; i++) {
      if (i + 1 < nx) test(i, j, i + 1, j, 2 * (j * nx + i))
      if (j + 1 < ny) test(i, j, i, j + 1, 2 * (j * nx + i) + 1)
    }
  }
  if (!cross.size) return none('No valleys or inside corners found within the boundary.')

  // join the crossings of each grid cell: two make a piece; four are paired by distance
  const adj = new Map<number, number[]>()
  const link = (a: number, b: number) => {
    adj.set(a, [...(adj.get(a) ?? []), b])
    adj.set(b, [...(adj.get(b) ?? []), a])
  }
  for (let j = 0; j + 1 < ny; j++)
    for (let i = 0; i + 1 < nx; i++) {
      const ids = [2 * (j * nx + i), 2 * (j * nx + i + 1) + 1, 2 * ((j + 1) * nx + i), 2 * (j * nx + i) + 1].filter((id) => cross.has(id))
      if (ids.length < 2) continue
      if (ids.length === 2) {
        link(ids[0], ids[1])
        continue
      }
      // several crossings: pair the closest first
      const left = [...ids]
      while (left.length >= 2) {
        let best: [number, number] = [0, 1]
        let bd = Infinity
        for (let a = 0; a < left.length; a++)
          for (let b = a + 1; b < left.length; b++) {
            const pa = cross.get(left[a])!
            const pb = cross.get(left[b])!
            const d = Math.hypot(pa.x - pb.x, pa.y - pb.y)
            if (d < bd) {
              bd = d
              best = [a, b]
            }
          }
        link(left[best[0]], left[best[1]])
        left.splice(best[1], 1)
        left.splice(best[0], 1)
      }
    }
  // chains: walk from ends (and junctions) first, then the remaining loops
  const used = new Set<string>()
  const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`)
  const chains: { ids: number[]; closed: boolean }[] = []
  const walk = (start: number, next: number) => {
    const ids = [start]
    let prev = start
    let cur = next
    used.add(key(start, next))
    for (let guard = 0; guard < 1e6; guard++) {
      ids.push(cur)
      const nb = adj.get(cur) ?? []
      if (cur === start) return { ids, closed: true }
      if (nb.length !== 2) break
      const nn = nb[0] === prev ? nb[1] : nb[0]
      if (used.has(key(cur, nn))) break
      used.add(key(cur, nn))
      prev = cur
      cur = nn
    }
    return { ids, closed: false }
  }
  const sortedIds = [...adj.keys()].sort((a, b) => a - b)
  for (const id of sortedIds) if ((adj.get(id) ?? []).length !== 2) for (const nb of adj.get(id)!) if (!used.has(key(id, nb))) chains.push(walk(id, nb))
  for (const id of sortedIds) for (const nb of adj.get(id) ?? []) if (!used.has(key(id, nb))) chains.push(walk(id, nb))

  // each chain as points on the crease, split until every piece follows it within tolerance
  const onCrease = (a: P, b: P, depth: number, out: P[]) => {
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const L = Math.hypot(b.x - a.x, b.y - a.y)
    if (depth > 10 || L < 0.01) return
    const nxv = -(b.y - a.y) / L
    const nyv = (b.x - a.x) / L
    const w = Math.max(hg, L / 2)
    const c = crease({ x: m.x - nxv * w, y: m.y - nyv * w }, { x: m.x + nxv * w, y: m.y + nyv * w })
    if (!c || Math.hypot(c.x - m.x, c.y - m.y) <= tol / 2) return
    onCrease(a, c, depth + 1, out)
    out.push(c)
    onCrease(c, b, depth + 1, out)
  }
  const paths: { pts: P[]; closed: boolean }[] = []
  for (const ch of chains) {
    const raw = ch.ids.map((id) => cross.get(id)!)
    const pts: P[] = [raw[0]]
    for (let k = 1; k < raw.length; k++) {
      onCrease(raw[k - 1], raw[k], 0, pts)
      pts.push(raw[k])
    }
    if (pts.length >= 2) paths.push({ pts: ch.closed ? pts.slice(0, -1) : pts, closed: ch.closed })
  }
  work?.progress?.(0.85, 'Pencil passes')

  // heights: exact drops, refined between points; cut only on machined, unprotected facets
  const sample = (x: number, y: number): Pt => {
    if (!dc.drop(x, y)) return { x, y, z: NaN, ok: false, cut: false, prot: false }
    const g = groups ? groups[dc.hitTri] : 0
    const cut = !protect.has(g) && (!machine || machine.has(g)) && insideRegion(region, { x, y }, 1e-4)
    return { x, y, z: dc.z + s, ok: true, cut, prot: protect.has(g) }
  }
  const step0 = Math.min(0.5, Math.max(0.05, cutter.R / 3))
  const cutPaths: Pt[][] = []
  for (const p of paths) {
    const poly = p.closed ? [...p.pts, p.pts[0]] : p.pts
    let all: Pt[] = []
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i - 1]
      const b = poly[i]
      const L = Math.hypot(b.x - a.x, b.y - a.y)
      if (L < 1e-9) continue
      const seg = refineAlong((t) => sample(a.x + ((b.x - a.x) * t) / L, a.y + ((b.y - a.y) * t) / L), 0, L, step0, tol, gougeTol)
      all.push(...(all.length ? seg.slice(1) : seg))
    }
    if (p.closed && all.length > 2 && !all.every((q) => q.cut)) {
      const ring = all.slice(0, -1)
      const k0 = ring.findIndex((q) => !q.cut)
      all = [...ring.slice(k0), ...ring.slice(0, k0), ring[k0]]
    }
    for (const c of cutChains(all)) if (c.length >= 2) cutPaths.push(c)
  }
  // drop crumbs: pieces shorter than the tool radius are usually facet noise
  const keep = cutPaths.filter((c) => {
    let L = 0
    for (let i = 1; i < c.length; i++) L += Math.hypot(c[i].x - c[i - 1].x, c[i].y - c[i - 1].y)
    return L >= cutter.R / 2
  })
  if (!keep.length) return none('No valleys or inside corners found within the boundary, slope limits and groups chosen.')

  // order: nearest next, each chain run in the way that starts nearer
  const top = meshBounds(mesh).max[2] + s
  const clear = Math.max(levels.safeZ, top + levels.rapidZ)
  const moves: Move[] = []
  let minZ = Infinity
  let last: Pt | null = null
  const left = [...keep]
  while (left.length) {
    let bi = 0
    let rev = false
    let bd = Infinity
    left.forEach((c, i) => {
      const d0 = last ? Math.hypot(c[0].x - last.x, c[0].y - last.y) : 0
      const d1 = last ? Math.hypot(c[c.length - 1].x - last.x, c[c.length - 1].y - last.y) : Infinity
      if (d0 < bd) {
        bd = d0
        bi = i
        rev = false
      }
      if (d1 < bd) {
        bd = d1
        bi = i
        rev = true
      }
    })
    const [c0] = left.splice(bi, 1)
    const c = rev ? [...c0].reverse() : c0
    const first = c[0]
    if (last) moves.push({ t: 'rapid', x: last.x, y: last.y, z: clear })
    moves.push({ t: 'rapid', x: first.x, y: first.y, z: clear })
    const above = Math.max(levels.rapidZ, first.z + levels.rapidZ)
    if (above < clear) moves.push({ t: 'rapid', x: first.x, y: first.y, z: above })
    moves.push({ t: 'feed', x: first.x, y: first.y, z: first.z, f: 'plunge' })
    const f = new Float64Array((c.length - 1) * 3)
    for (let i = 1; i < c.length; i++) {
      f[(i - 1) * 3] = c[i].x
      f[(i - 1) * 3 + 1] = c[i].y
      f[(i - 1) * 3 + 2] = c[i].z
      minZ = Math.min(minZ, c[i].z)
    }
    minZ = Math.min(minZ, first.z)
    moves.push({ t: 'poly', pts: f, f: 'cut' })
    last = c[c.length - 1]
  }
  if (last) moves.push({ t: 'rapid', x: last.x, y: last.y, z: clear })
  return { moves, warnings, minZ: Number.isFinite(minZ) ? minZ : NaN, spacing: 0 }
}
