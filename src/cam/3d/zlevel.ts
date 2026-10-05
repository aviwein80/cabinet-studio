/**
 * Z-level roughing (3D-01). The stock is cut in flat levels from face 1 down. At each level the
 * tool may stand wherever the tool-centre surface (with stock to leave) is at or below the level;
 * that area, inside the boundary, is cleared like a pocket: offset rings from the inside out, or
 * zig-zag lines, ending with a pass along the walls, or adaptive clearing (a steady width of cut,
 * `src/cam/adaptive`). The tool goes down into each area by helix, ramp or plunge. Extra levels sit
 * on the model's flat areas.
 *
 * Every cutting move is checked with exact drops before it is kept: a move that would touch the
 * model (closer than the stock to leave) is cut out of the path and the tool lifts over that spot.
 */
import { checkCancel, subWork, type Work } from '@/core/cancel'
import type { Tool } from '@/core/types'
import type { P } from '../geom'
import { clipPolys, inflatePolys, polyArea } from '../kernel'
import { planAdaptive } from '../adaptive/adaptive'
import { type Mesh, meshBounds } from '../mesh/types'
import type { Move } from '../toolpath'
import type { Rough3dOp } from '../types'
import { CLGrid } from './clgrid'
import { type Cutter3D, grownCutter } from './cutter'
import { DropCutter } from './dropcutter'
import { clipLine, extent, insideRegion, polysBox, type Region } from './region'
import type { Layer } from './waterline'

export interface Rough3dResult {
  moves: Move[]
  warnings: string[]
  /** Lowest tool-tip Z of any cutting move (NaN when nothing was cut). */
  minZ: number
  /** Level heights, top first. */
  levels: number[]
  /** The passes of each level, in cutting order (for flat-layer output). */
  layers: Layer[]
  /** Places where the safety check cut a pass short (normally 0). */
  trimmed: number
  /** Adaptive clearing: trochoidal move ranges (indices into `moves`). */
  sections?: { from: number; to: number }[]
}

interface Path {
  pts: P[]
  closed: boolean
  /** Offset ring number (0 = along the walls); -1 for zig-zag lines. */
  k: number
}

/** A link between passes stays down up to this many step-overs. */
const LINK_STEPOVERS = 1.6
/** Flat facets: steepest slope (degrees) and smallest total area as a share of the tool's footprint. */
const FLAT_DEG = 0.5
const FLAT_MIN_AREA = 0.25

export function zLevelRough(op: Rough3dOp, mesh: Mesh, cutter: Cutter3D, region: Region, stock: { length: number; width: number }, tool: Tool, work?: Work): Rough3dResult {
  const warnings: string[] = []
  const none = (w: string): Rough3dResult => ({ moves: [], warnings: [...warnings, w], minZ: NaN, levels: [], layers: [], trimmed: 0 })
  const sxy = Math.max(0, op.surface.stockToLeave)
  const sz = Math.max(0, op.stockZ)
  const grown = grownCutter(cutter, sxy)
  if (!grown) return none('3D roughing needs a flat, bull-nose or ball-nose tool (not a V cutter).')
  const dc = new DropCutter(mesh, grown)
  const R = cutter.R
  const Rg = grown.R
  const rf = grown.kind === 'torus' ? grown.R - grown.rc : 0
  const tol = Math.max(0.005, op.surface.tolerance || 0.05)
  const gougeTol = 0.002
  const sd = Math.max(0.1, op.stepdown)
  const step = Math.max(0.05, op.stepover * 2 * R)
  const ds = Math.min(0.25, Math.max(0.05, R / 8))

  // where the tool centre may go: the boundary, and no further off the part than the tool radius
  const stockPoly = [
    { x: -R, y: -R },
    { x: stock.length + R, y: -R },
    { x: stock.length + R, y: stock.width + R },
    { x: -R, y: stock.width + R },
  ]
  const work0 = clipPolys('intersect', [stockPoly], region.polys).filter((p) => Math.abs(polyArea(p)) > 1e-4)
  if (!work0.length) return none('The boundary is empty or off the part.')
  const box = polysBox(work0)
  const h = Math.min(2, Math.max(0.25, R / 3))
  const grid = new CLGrid(dc, box, h, -Infinity, sz, tol / 4, subWork(work, 0, 0.25))
  const { lo, open } = grid.range()
  const mb = meshBounds(mesh)
  const bottom = open ? mb.min[2] + sz : lo
  const top = 0
  if (!Number.isFinite(bottom)) return none('Nothing to rough: the model is not under the boundary.')
  if (bottom >= top - 1e-6) return none('Nothing to rough: the model does not go below face 1 inside the boundary.')

  // levels: every step-down from face 1, the bottom, and the model's flat areas
  const zs: number[] = []
  for (let k = 1; top - k * sd > bottom + 1e-6; k++) zs.push(top - k * sd)
  zs.push(bottom)
  if (op.flats)
    for (const f of flatHeights(mesh, FLAT_MIN_AREA * Math.PI * R * R)) {
      const z = f + sz
      if (z >= top - 1e-6 || z < bottom - 1e-6) continue
      const near = zs.findIndex((x) => Math.abs(x - z) <= 0.05)
      if (near >= 0) zs[near] = Math.min(zs[near], z)
      else zs.push(z)
    }
  zs.sort((a, b) => b - a)

  // entry
  let entry = op.entry
  if (entry === 'plunge' && tool.centreCutting === false) {
    warnings.push(`T${tool.number} is not centre-cutting: plunge changed to ramp.`)
    entry = 'ramp'
  }
  if (entry === 'plunge' && tool.maxPlunge && sd > tool.maxPlunge + 1e-9) {
    warnings.push(`Step-down ${sd} mm is deeper than T${tool.number} max plunge ${tool.maxPlunge} mm: using a ramp.`)
    entry = 'ramp'
  }
  const rampTan = Math.tan((Math.max(1, op.rampAngle) * Math.PI) / 180)
  const clear = Math.max(op.levels.safeZ, Math.max(top, mb.max[2] + sz) + op.levels.rapidZ)

  /** The tool clears the model at (x, y) standing at z (fast proof first, exact drop otherwise). */
  const safe = (x: number, y: number, z: number) => grid.clearAt(x, y, z, Rg, rf) || grid.below(x, y, z + gougeTol)
  const segSafe = (a: P, b: P, z: number) => {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / ds)
    for (let j = 1; j <= n; j++) if (!safe(a.x + ((b.x - a.x) * j) / n, a.y + ((b.y - a.y) * j) / n, z)) return false
    return true
  }
  let trimmed = 0
  /** A path checked every `ds`: the parts where the tool would touch the model are cut out. */
  const checked = (p: Path, z: number): Path[] => {
    const pts = p.closed ? [...p.pts, p.pts[0]] : p.pts
    const ok = pts.map((q) => safe(q.x, q.y, z))
    const segOk = pts.slice(1).map((b, i) => ok[i] && ok[i + 1] && segSafe(pts[i], b, z))
    if (segOk.every(Boolean)) return [p]
    trimmed++
    const out: Path[] = []
    let cur: P[] = []
    const flush = () => {
      if (cur.length >= 2) out.push({ pts: cur, closed: false, k: p.k })
      cur = []
    }
    // closed paths start after a bad piece so a good run is not split at the seam
    const n = segOk.length
    const start = p.closed ? segOk.indexOf(false) + 1 : 0
    for (let c = 0; c < n; c++) {
      const i = (start + c) % n
      if (segOk[i]) {
        if (!cur.length) cur.push(pts[i])
        cur.push(pts[i + 1])
      } else flush()
    }
    flush()
    return out
  }

  const moves: Move[] = []
  const layers: Layer[] = []
  const sections: { from: number; to: number }[] = []
  let cutAny = false
  let minZ = Infinity
  let at = { x: 0, y: 0, z: clear }
  const go = (t: 'rapid' | 'feed', x: number, y: number, z: number, f: 'cut' | 'plunge' | 'lead' = 'cut') => {
    if (Math.abs(x - at.x) < 1e-9 && Math.abs(y - at.y) < 1e-9 && Math.abs(z - at.z) < 1e-9) return
    moves.push(t === 'rapid' ? { t, x, y, z } : { t, x, y, z, f })
    at = { x, y, z }
  }
  const run = (pts: P[], z: number) => {
    const f = new Float64Array(pts.length * 3)
    pts.forEach((p, i) => {
      f[i * 3] = p.x
      f[i * 3 + 1] = p.y
      f[i * 3 + 2] = z
    })
    if (pts.length) {
      moves.push({ t: 'poly', pts: f, f: 'cut' })
      at = { ...pts[pts.length - 1], z }
    }
  }

  zs.forEach((z, li) => {
    checkCancel(work?.isCancelled)
    work?.progress?.(0.25 + (0.75 * li) / zs.length, `Level ${li + 1} of ${zs.length}`)
    const prevZ = li === 0 ? top : zs[li - 1]
    const loops = grid.loops(z, tol, gougeTol).map((l) => l.pts.map((p) => ({ x: p.x, y: p.y })))
    const allowed = clipPolys('intersect', loops, work0).filter((p) => Math.abs(polyArea(p)) > 1e-4)
    if (!allowed.length) return
    if (op.pattern === 'adaptive') {
      adaptiveLevel(z, prevZ, allowed, li)
      return
    }
    const outers = allowed.filter((p) => polyArea(p) > 0)
    const compOf = (p: P) => {
      let best = -1
      let bestA = Infinity
      outers.forEach((o, i) => {
        const a = polyArea(o)
        if (a < bestA && insideRegion({ polys: [o], fromModel: false }, p)) {
          best = i
          bestA = a
        }
      })
      return best
    }
    const comps = outers.map(() => [] as Path[])
    const add = (p: Path, poly?: P[]) => {
      // an outer boundary belongs to its own area (its points are on the edge, not inside it)
      const own = poly ? outers.indexOf(poly) : -1
      const c = own >= 0 ? own : compOf(p.pts[0])
      if (c >= 0) comps[c].push(p)
    }
    // rings run with the open side on the left (counter-clockwise around areas); climb keeps the
    // material on the right
    const orient = (pts: P[]) => (op.direction === 'conventional' ? [...pts].reverse() : pts)
    if (op.pattern === 'zigzag') {
      const shrunk = inflatePolys(allowed, -0.01, 'round', 0.02)
      const a = (op.angle * Math.PI) / 180
      const ux = Math.cos(a)
      const uy = Math.sin(a)
      const reg: Region = { polys: shrunk, fromModel: false }
      const { lo: elo, hi: ehi } = extent(reg, ux, uy)
      let flip = false
      for (let s = elo + step / 2; s < ehi; s += step) {
        for (const [t0, t1] of clipLine(reg, ux, uy, s)) {
          const A = { x: ux * t0 - uy * s, y: uy * t0 + ux * s }
          const B = { x: ux * t1 - uy * s, y: uy * t1 + ux * s }
          add({ pts: flip ? [B, A] : [A, B], closed: false, k: -1 })
        }
        flip = !flip
      }
      for (const p of allowed) add({ pts: orient(p), closed: true, k: 0 }, p)
    } else {
      for (let k = 0; k < 2000; k++) {
        const ring = k === 0 ? allowed : inflatePolys(allowed, -k * step, 'round', 0.02).filter((p) => Math.abs(polyArea(p)) > 1e-4)
        if (!ring.length) break
        for (const p of ring) add({ pts: orient(p), closed: true, k }, k === 0 ? p : undefined)
      }
    }
    const layer: Layer = { z, chains: [] }
    const compsLeft = comps.map((c, i) => ({ c, i })).filter((x) => x.c.length)
    while (compsLeft.length) {
      // nearest area next
      let bi = 0
      let bd = Infinity
      compsLeft.forEach((x, i) => {
        const p = x.c[0].pts[0]
        const d = Math.hypot(p.x - at.x, p.y - at.y)
        if (d < bd) {
          bd = d
          bi = i
        }
      })
      const [{ c: paths, i: ci }] = compsLeft.splice(bi, 1)
      const comp: Region = { polys: allowed.filter((p) => p === outers[ci] || (polyArea(p) < 0 && compOf(p[0]) === ci)), fromModel: false }
      // innermost rings first, walls last (zig-zag: lines in order, then walls); nearest next
      // among rings of the same offset
      const queue = op.pattern === 'zigzag' ? [...paths] : [...paths].sort((a, b) => b.k - a.k)
      let started = false
      while (queue.length) {
        let bi2 = 0
        let bk = 0
        let bd2 = Infinity
        if (started)
          queue.forEach((p, i) => {
            if (p.k !== queue[0].k || (p.k < 0 && i > 0)) return
            for (let j = 0; j < (p.closed ? p.pts.length : 1); j++) {
              const d = Math.hypot(p.pts[j].x - at.x, p.pts[j].y - at.y)
              if (d < bd2) {
                bd2 = d
                bi2 = i
                bk = j
              }
            }
          })
        const [p0] = queue.splice(bi2, 1)
        const rotated: Path = p0.closed && bk ? { ...p0, pts: [...p0.pts.slice(bk), ...p0.pts.slice(0, bk)] } : p0
        for (const p of checked(rotated, z)) {
          const S = p.pts[0]
          const near =
            started &&
            Math.abs(at.z - z) < 1e-9 &&
            Math.hypot(S.x - at.x, S.y - at.y) <= LINK_STEPOVERS * step + 1e-6 &&
            [0.25, 0.5, 0.75].every((t) => insideRegion(comp, { x: at.x + (S.x - at.x) * t, y: at.y + (S.y - at.y) * t }, 1e-4)) &&
            segSafe(at, S, z)
          if (near) go('feed', S.x, S.y, z)
          else enter(p, z, prevZ, comp)
          started = true
          run(p.closed ? [...p.pts.slice(1), S] : p.pts.slice(1), z)
          layer.chains.push({ pts: p.pts, closed: p.closed })
          minZ = Math.min(minZ, z)
        }
      }
    }
    if (layer.chains.length) layers.push(layer)
  })
  go('rapid', at.x, at.y, clear)

  /**
   * Adaptive clearing of one level: the area the tool can reach (where its centre may stand, grown
   * by its radius, on the part) is the material; the centre stays inside where it may stand. The
   * tool counts as a cylinder of its full radius. Every pass is checked like the other patterns
   * before it is kept.
   */
  function adaptiveLevel(z: number, prevZ: number, allowed: P[][], li: number) {
    const a = op.adaptive
    if (!a) return
    const width = a.angle && a.angle > 0 ? R * (1 - Math.cos((Math.min(180, a.angle) * Math.PI) / 180)) : Math.max(0.01, a.width) * 2 * R
    // the material runs on past the edges of the panel by the corner radius: a tool whose disc
    // only grazes an edge would leave its corner radius standing on the floor there
    // (and a millimetre more, as strips thinner than that count as crumbs and are left)
    const e = cutter.kind === 'torus' && cutter.rc > 0 ? cutter.rc + 1 : 0
    const part = [{ x: -e, y: -e }, { x: stock.length + e, y: -e }, { x: stock.length + e, y: stock.width + e }, { x: -e, y: stock.width + e }]
    const material = clipPolys('intersect', inflatePolys(allowed, R, 'round', 0.001), [part])
    if (!material.length) return
    const span = 0.75 / zs.length
    // a bull-nose's helix stays within its flat bottom, so it leaves no peak in the middle
    const flat = cutter.kind === 'torus' ? cutter.R - cutter.rc : 0
    const helixPct = flat > 0.1 * R ? Math.min(op.helixPct, (0.95 * flat) / R) : op.helixPct
    const plan = planAdaptive(material, allowed, allowed, { r: R, target: width, smoothing: Math.max(0, a.smoothing), climb: op.direction === 'climb', helixPct, wallGap: 0.01 }, subWork(work, 0.25 + span * li, span))
    for (const w of plan.warnings) if (!warnings.includes(w)) warnings.push(w)
    const comp: Region = { polys: allowed, fromModel: false }
    const boost = Math.max(1, a.feedBoost || 1)
    const lift = Math.max(0, a.lift)
    // after an entry that is not safe, nothing until the next entry (that area was never opened)
    let skip = false
    for (const it of plan.items) {
      if (it.k === 'helix') {
        const ring = Array.from({ length: 24 }, (_, k) => ({ x: it.c.x + it.rho * Math.cos((k * Math.PI) / 12), y: it.c.y + it.rho * Math.sin((k * Math.PI) / 12) }))
        skip = !ring.every((q) => safe(q.x, q.y, z)) || !safe(it.start.x, it.start.y, z)
        if (skip) {
          trimmed++
          continue
        }
        go('rapid', at.x, at.y, clear)
        go('rapid', it.start.x, it.start.y, clear)
        go('rapid', it.start.x, it.start.y, prevZ + op.levels.rapidZ)
        go('feed', it.start.x, it.start.y, prevZ, 'plunge')
        // turns down round c, ending at the start of the first pass
        const dz = prevZ - z
        const pitch = Math.max(0.5, 2 * Math.PI * it.rho * rampTan)
        const turns = Math.max(1, Math.ceil(dz / pitch))
        const W = { x: 2 * it.c.x - it.start.x, y: 2 * it.c.y - it.start.y }
        const ccw = true
        for (let i = 0; i < turns; i++) {
          moves.push({ t: 'arc', x: W.x, y: W.y, z: prevZ - (dz * (i + 0.5)) / turns, cx: it.c.x, cy: it.c.y, ccw, f: 'plunge' })
          moves.push({ t: 'arc', x: it.start.x, y: it.start.y, z: prevZ - (dz * (i + 1)) / turns, cx: it.c.x, cy: it.c.y, ccw, f: 'plunge' })
        }
        moves.push({ t: 'arc', x: W.x, y: W.y, z, cx: it.c.x, cy: it.c.y, ccw, f: 'cut' })
        moves.push({ t: 'arc', x: it.start.x, y: it.start.y, z, cx: it.c.x, cy: it.c.y, ccw, f: 'cut' })
        at = { x: it.start.x, y: it.start.y, z }
        minZ = Math.min(minZ, z)
      } else if (skip) continue
      else if (it.k === 'link') {
        if (it.clear && segSafe(at, it.to, z + lift)) {
          go('feed', at.x, at.y, z + lift, 'lead')
          moves.push({ t: 'feed', x: it.to.x, y: it.to.y, z: z + lift, f: 'lead', ...(boost > 1 ? { k: boost } : {}) })
          at = { x: it.to.x, y: it.to.y, z: z + lift }
          go('feed', it.to.x, it.to.y, z, 'lead')
        } else {
          go('rapid', at.x, at.y, clear)
          go('rapid', it.to.x, it.to.y, clear)
          go('rapid', it.to.x, it.to.y, prevZ + op.levels.rapidZ)
          go('feed', it.to.x, it.to.y, z, 'plunge')
        }
      } else {
        const path: Path = { pts: [{ x: at.x, y: at.y }, ...it.pts], closed: false, k: -1 }
        const pieces = checked(path, z)
        const from = moves.length
        if (pieces.length === 1 && pieces[0].pts.length === path.pts.length) {
          it.pts.forEach((q, i) => {
            const k = boost > 1 ? Math.min(boost, Math.max(1, width / Math.max(1e-9, it.load[i]))) : 1
            moves.push({ t: 'feed', x: q.x, y: q.y, z, f: 'cut', ...(k > 1 ? { k } : {}) })
          })
          at = { ...it.pts[it.pts.length - 1], z }
        } else
          // the safety check cut the pass: what is left is cut at the plain feed, each piece entered
          // like the other patterns
          for (const pc of pieces) {
            const S = pc.pts[0]
            if (Math.hypot(S.x - at.x, S.y - at.y) > 1e-9 || Math.abs(at.z - z) > 1e-9) enter(pc, z, prevZ, comp)
            run(pc.pts.slice(1), z)
          }
        if (it.trochoidal && moves.length > from) sections.push({ from, to: moves.length })
        cutAny = true
        minZ = Math.min(minZ, z)
      }
    }
  }

  function enter(p: Path, z: number, prevZ: number, comp: Region) {
    const S = p.pts[0]
    go('rapid', at.x, at.y, clear)
    go('rapid', S.x, S.y, clear)
    go('rapid', S.x, S.y, prevZ + op.levels.rapidZ)
    go('feed', S.x, S.y, prevZ, 'plunge')
    const dz = prevZ - z
    if (dz <= 1e-9) return
    if (entry === 'helix') {
      const rh = Math.max(0.2, op.helixPct * R)
      const next = p.pts[1] ?? S
      const tl = Math.hypot(next.x - S.x, next.y - S.y) || 1
      const tx = (next.x - S.x) / tl
      const ty = (next.y - S.y) / tl
      const C = [
        { x: S.x - ty * rh, y: S.y + tx * rh },
        { x: S.x + ty * rh, y: S.y - tx * rh },
      ].find((c) =>
        Array.from({ length: 24 }, (_, k) => (k * Math.PI) / 12).every((a) => {
          const q = { x: c.x + rh * Math.cos(a), y: c.y + rh * Math.sin(a) }
          return insideRegion(comp, q, 1e-3) && safe(q.x, q.y, z)
        }),
      )
      if (C) {
        const pitch = Math.max(0.5, 2 * Math.PI * rh * rampTan)
        const turns = Math.max(1, Math.ceil(dz / pitch))
        const W = { x: 2 * C.x - S.x, y: 2 * C.y - S.y }
        for (let i = 0; i < turns; i++) {
          const za = prevZ - (dz * (i + 0.5)) / turns
          const zb = prevZ - (dz * (i + 1)) / turns
          moves.push({ t: 'arc', x: W.x, y: W.y, z: za, cx: C.x, cy: C.y, ccw: true, f: 'plunge' })
          moves.push({ t: 'arc', x: S.x, y: S.y, z: zb, cx: C.x, cy: C.y, ccw: true, f: 'plunge' })
        }
        moves.push({ t: 'arc', x: W.x, y: W.y, z, cx: C.x, cy: C.y, ccw: true, f: 'cut' })
        moves.push({ t: 'arc', x: S.x, y: S.y, z, cx: C.x, cy: C.y, ccw: true, f: 'cut' })
        at = { x: S.x, y: S.y, z }
        return
      }
    }
    if (entry === 'helix' || entry === 'ramp') {
      // ramp along the pass itself (round a ring, back and forth along a line) and end at its start
      const walk = p.closed ? [...p.pts, S] : [...p.pts, ...[...p.pts].reverse().slice(1)]
      let L = 0
      for (let i = 1; i < walk.length; i++) L += Math.hypot(walk[i].x - walk[i - 1].x, walk[i].y - walk[i - 1].y)
      if (L > 1e-6) {
        const laps = Math.max(1, Math.ceil(dz / rampTan / L - 1e-9))
        const total = laps * L
        let acc = 0
        for (let lap = 0; lap < laps; lap++)
          for (let i = 1; i < walk.length; i++) {
            acc += Math.hypot(walk[i].x - walk[i - 1].x, walk[i].y - walk[i - 1].y)
            go('feed', walk[i].x, walk[i].y, prevZ - (dz * acc) / total, 'plunge')
          }
        at = { x: S.x, y: S.y, z }
        return
      }
    }
    go('feed', S.x, S.y, z, 'plunge')
  }

  if (!layers.length && !cutAny) return none('Nothing to rough inside the boundary.')
  return { moves, warnings, minZ: Number.isFinite(minZ) ? minZ : NaN, levels: zs, layers, trimmed, ...(sections.length ? { sections } : {}) }
}

/** Heights of the model's flat, upward-facing areas, with at least `minArea` of facets each. */
export function flatHeights(mesh: Mesh, minArea: number): number[] {
  const { positions: v, indices: ix } = mesh
  const cos = Math.cos((FLAT_DEG * Math.PI) / 180)
  const area = new Map<number, number>()
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3
    const b = ix[t + 1] * 3
    const c = ix[t + 2] * 3
    const ux = v[b] - v[a]
    const uy = v[b + 1] - v[a + 1]
    const uz = v[b + 2] - v[a + 2]
    const wx = v[c] - v[a]
    const wy = v[c + 1] - v[a + 1]
    const wz = v[c + 2] - v[a + 2]
    const nx = uy * wz - uz * wy
    const ny = uz * wx - ux * wz
    const nz = ux * wy - uy * wx
    const l = Math.hypot(nx, ny, nz)
    if (!(l > 0) || nz / l < cos) continue
    const key = Math.round(((v[a + 2] + v[b + 2] + v[c + 2]) / 3) * 1000) / 1000
    area.set(key, (area.get(key) ?? 0) + l / 2)
  }
  return [...area].filter(([, a]) => a >= minArea).map(([z]) => z)
}
