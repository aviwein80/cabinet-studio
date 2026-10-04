/**
 * Toolpath generation. Each op produces:
 *  - moves: a machine-neutral IR (rapid / feed / arc / drill cycle) for preview, backplot and
 *    template posts. Z is 0 at face 1 and negative into the material.
 *  - intents: what a native woodWOP program should contain (contour milling on the drawn
 *    geometry with radius correction, drilling macros, rectangular pockets, saw grooves).
 */
import type { HDrillDir, MachineProfile, Tool } from '@/core/types'
import { entityContours, layerOf } from './doc'
import {
  add,
  arc,
  area,
  boxOf,
  type Contour,
  contourLength,
  dist,
  dot,
  left,
  line,
  mul,
  type P,
  pointAt,
  pointInContour,
  radius,
  reverse,
  right,
  type Seg,
  segLength,
  splitMajorArcs,
  startOf,
  sub,
  subSeg,
  sweep,
  tangentAt,
  toPoints,
  unit,
  closestOnContour,
  atLength,
} from './geom'
import { breakAt, normaliseWinding, offset, offsetChain } from './kernel'
import { feedsFor, passDepths, resolveTool } from './ops'
import type { CamOp, CamPart, DrillOp, Entity, FaceId, PocketOp, ProfileOp, SweepOp, VCarveOp } from './types'

export type FeedKind = 'cut' | 'plunge' | 'lead'
export type Move =
  | { t: 'rapid'; x: number; y: number; z: number }
  | { t: 'feed'; x: number; y: number; z: number; f: FeedKind }
  | { t: 'arc'; x: number; y: number; z: number; cx: number; cy: number; ccw: boolean; f: FeedKind }
  | { t: 'drill'; x: number; y: number; z: number; r: number; peck: number; dwell: number }

export interface ContourPass {
  depth: number
  /** Inclusive element range (indices into segs). */
  from: number
  to: number
}

export type Intent =
  | {
      k: 'contour'
      segs: Seg[]
      closed: boolean
      rk: 'WRKL' | 'WRKR' | 'NOWRK'
      approach: 'TAN' | 'SEN' | 'SEI'
      ramp: boolean
      tool: Tool | null
      label: string
      passes: ContourPass[]
    }
  | { k: 'vdrill'; x: number; y: number; d: number; depth: number; through: boolean; tool: Tool | null; label: string }
  | { k: 'hdrill'; x: number; y: number; z: number; d: number; depth: number; dir: HDrillDir; face: FaceId; tool: Tool | null; label: string }
  | { k: 'pocket-rect'; cx: number; cy: number; len: number; wid: number; r: number; angle: number; depth: number; stepoverPct: number; ccw: boolean; tool: Tool | null; label: string }
  | { k: 'saw'; xa: number; ya: number; xe: number; ye: number; width: number; depth: number; tool: Tool | null; label: string }
  | { k: 'comment'; text: string; stop: boolean }

export interface Toolpath {
  opId: string
  kind: CamOp['kind']
  name: string
  tool: Tool | null
  feeds: { rpm: number; feed: number; plunge: number }
  moves: Move[]
  intents: Intent[]
  warnings: string[]
  stats: { cut: number; rapid: number; minutes: number }
}

export interface GenContext {
  part: CamPart
  machine: MachineProfile
}

const RAPID_RATE = 40000

// ---------------------------------------------------------------------------------------------
// Move builder
// ---------------------------------------------------------------------------------------------

class Builder {
  moves: Move[] = []
  x = 0
  y = 0
  z = 50
  rapid(x: number, y: number, z: number) {
    if (Math.abs(x - this.x) < 1e-9 && Math.abs(y - this.y) < 1e-9 && Math.abs(z - this.z) < 1e-9) return
    this.moves.push({ t: 'rapid', x, y, z })
    Object.assign(this, { x, y, z })
  }
  feed(x: number, y: number, z: number, f: FeedKind = 'cut') {
    if (Math.abs(x - this.x) < 1e-9 && Math.abs(y - this.y) < 1e-9 && Math.abs(z - this.z) < 1e-9) return
    this.moves.push({ t: 'feed', x, y, z, f })
    Object.assign(this, { x, y, z })
  }
  seg(s: Seg, z: number, f: FeedKind = 'cut') {
    if (s.k === 'L') this.feed(s.b.x, s.b.y, z, f)
    else for (const a of splitMajorArcs([s])) this.arcTo(a as Extract<Seg, { k: 'A' }>, z, f)
  }
  arcTo(s: Extract<Seg, { k: 'A' }>, z: number, f: FeedKind) {
    this.moves.push({ t: 'arc', x: s.b.x, y: s.b.y, z, cx: s.c.x, cy: s.c.y, ccw: s.ccw, f })
    Object.assign(this, { x: s.b.x, y: s.b.y, z })
  }
  /** Run along segs while Z changes linearly from z0 to z1 (ramps); arcs are broken into short lines. */
  ramp(segs: Seg[], z0: number, z1: number) {
    const total = segs.reduce((n, s) => n + segLength(s), 0)
    let acc = 0
    for (const s of segs) {
      const l = segLength(s)
      const n = s.k === 'L' ? 1 : Math.max(2, Math.ceil(l / 1))
      for (let i = 1; i <= n; i++) {
        const p = pointAt(s, i / n)
        const z = total > 0 ? z0 + ((z1 - z0) * (acc + (l * i) / n)) / total : z1
        this.feed(p.x, p.y, z, 'plunge')
      }
      acc += l
    }
  }
  drill(x: number, y: number, z: number, r: number, peck = 0, dwell = 0) {
    this.moves.push({ t: 'drill', x, y, z, r, peck, dwell })
    Object.assign(this, { x, y, z: r })
  }
}

/** Portion of a contour between arc lengths d0 < d1 (closed contours wrap). */
export function sliceByLength(c: Contour, d0: number, d1: number): Seg[] {
  const L = contourLength(c)
  if (c.closed && (d1 > L || d0 < 0)) {
    const segs = [...c.segs, ...c.segs, ...c.segs]
    return sliceByLength({ segs, closed: false }, d0 + L, d1 + L)
  }
  const out: Seg[] = []
  let acc = 0
  for (const s of c.segs) {
    const l = segLength(s)
    const a = Math.max(d0, acc)
    const b = Math.min(d1, acc + l)
    if (b > a + 1e-9 && l > 1e-12) out.push(subSeg(s, (a - acc) / l, (b - acc) / l))
    acc += l
  }
  return out
}

function stats(moves: Move[], feed: number) {
  let cut = 0
  let rapid = 0
  let drills = 0
  let x = 0
  let y = 0
  let z = 50
  for (const m of moves) {
    if (m.t === 'drill') {
      rapid += Math.hypot(m.x - x, m.y - y)
      cut += 2 * Math.abs(m.r - m.z)
      drills++
      x = m.x
      y = m.y
      z = m.r
      continue
    }
    let d = Math.hypot(m.x - x, m.y - y, m.z - z)
    if (m.t === 'arc') {
      const r = Math.hypot(x - m.cx, y - m.cy)
      let sw = Math.atan2(m.y - m.cy, m.x - m.cx) - Math.atan2(y - m.cy, x - m.cx)
      if (m.ccw) while (sw <= 1e-12) sw += Math.PI * 2
      else while (sw >= -1e-12) sw -= Math.PI * 2
      d = Math.hypot(Math.abs(sw) * r, m.z - z)
    }
    if (m.t === 'rapid') rapid += d
    else cut += d
    x = m.x
    y = m.y
    z = m.z
  }
  return { cut: Math.round(cut), rapid: Math.round(rapid), minutes: Math.round((cut / Math.max(1, feed) + rapid / RAPID_RATE + drills * 0.03) * 100) / 100 }
}

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

function geometryOf(op: CamOp, part: CamPart): { e: Entity; contours: Contour[] }[] {
  return op.geometry
    .map((id) => part.entities.find((e) => e.id === id))
    .filter((e): e is Entity => !!e && !layerOf(part, e.layer)?.construction)
    .map((e) => ({ e, contours: entityContours(e) }))
}

function totalDepth(op: CamOp, ctx: GenContext) {
  return op.levels.through ? ctx.part.thickness + ctx.machine.throughDepth : Math.max(0, op.levels.depth - op.levels.stockZ)
}

function maxPass(op: CamOp, tool: Tool | null) {
  return op.levels.passDepth > 0 ? op.levels.passDepth : tool?.stepdown && tool.stepdown > 0 ? tool.stepdown : (tool?.maxDepth ?? 0)
}

/** Rotate a closed contour so it starts at arc length d. */
function startAtLength(c: Contour, d: number): Contour {
  if (!c.closed) return c
  const L = contourLength(c)
  const dd = ((d % L) + L) % L
  if (dd < 1e-9 || L - dd < 1e-9) return c
  const p = atLength(c, dd).p
  const [open] = breakAt(c, p)
  return { segs: open.segs, closed: true }
}

/** Default start: middle of the longest segment. */
function defaultStart(c: Contour) {
  let best = 0
  let bestLen = -1
  let acc = 0
  let at = 0
  for (const s of c.segs) {
    const l = segLength(s)
    if (l > bestLen + 1e-9 && s.k === 'L') {
      bestLen = l
      best = acc + l / 2
    }
    acc += l
  }
  if (bestLen < 0) best = 0
  at = best
  return at
}

function rotateToNearest(c: Contour, p: P): Contour {
  if (!c.closed) return c
  const q = closestOnContour(c, p)
  let d = 0
  for (let i = 0; i < q.seg; i++) d += segLength(c.segs[i])
  d += q.t * segLength(c.segs[q.seg])
  return startAtLength(c, d)
}

// ---------------------------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------------------------

function genProfile(op: ProfileOp, ctx: GenContext, tp: Toolpath, b: Builder) {
  const tool = tp.tool
  const r = (tool?.diameter ?? 0) / 2
  const D = totalDepth(op, ctx)
  const depths = passDepths(D, maxPass(op, tool))
  if (!tool) tp.warnings.push('No router selected or available for this profile.')
  if (tool && D > tool.maxDepth + 1e-9) tp.warnings.push(`Depth ${D} mm exceeds T${tool.number} max depth ${tool.maxDepth} mm.`)
  if (op.slope) tp.warnings.push('Sloped walls are previewed vertical; the slope is written as a note only.')
  if (op.corners === 'loop') tp.warnings.push('Looped corners are generated as rolled (round) corners.')

  for (const { contours } of geometryOf(op, ctx.part)) {
    for (const c0 of contours) {
      let g = c0
      let side: 'L' | 'R' | 'C'
      if (g.closed) {
        const outside = op.side === 'outside' || op.side === 'left'
        // climb with a CW spindle keeps the material on the right of travel
        const wantCw = outside ? op.direction === 'climb' : op.direction !== 'climb'
        const isCw = area(g) < 0
        if (wantCw !== isCw) g = reverse(g)
        side = outside ? (wantCw ? 'L' : 'R') : wantCw ? 'R' : 'L'
        g = startAtLength(g, op.start !== undefined ? op.start * contourLength(g) : defaultStart(g))
      } else {
        side = op.side === 'left' || op.side === 'outside' ? 'L' : op.side === 'right' || op.side === 'inside' ? 'R' : 'C'
        if (op.direction === 'conventional' && side !== 'C') {
          g = reverse(g)
          side = side === 'L' ? 'R' : 'L'
        }
      }
      const o = r + op.stockXY
      let centres: Contour[]
      if (side === 'C' || o <= 1e-9) centres = [g]
      else if (g.closed) {
        const outward = side === 'L' ? area(g) < 0 : area(g) > 0
        const res = offset([g], outward ? o : -o, op.corners === 'straight' ? 'miter' : 'round')
        if (!res.length) {
          tp.warnings.push(`Tool D${tool?.diameter} does not fit inside a ${op.side} contour.`)
          continue
        }
        centres = res.map((cc) => {
          const oriented = area(cc) < 0 === area(g) < 0 ? cc : reverse(cc)
          return rotateToNearest(oriented, startOf(g))
        })
      } else centres = [offsetChain(g, side === 'L' ? o : -o)]

      const tagRanges = tagIntervals(op, centres[0])
      const tagTop = -(D - op.tags.height)

      for (const cp of centres) {
        if (!cp.segs.length) continue
        depths.forEach((d, pi) => {
          const reverseThis = !cp.closed && op.bidirectional && pi % 2 === 1
          const path = reverseThis ? reverse(cp) : cp
          const z = -d
          const prevZ = pi === 0 ? 0 : -depths[pi - 1]
          emitProfilePass(op, path, side, r, z, prevZ, tagRanges.length && z < tagTop - 1e-9 ? { ranges: tagRanges, top: tagTop, shape: op.tags.shape, angle: op.tags.rampAngle } : null, b)
        })
        b.rapid(b.x, b.y, op.levels.safeZ)
      }

      // native intent on the drawn geometry with radius correction
      const rk = side === 'C' ? 'NOWRK' : side === 'L' ? 'WRKL' : 'WRKR'
      const L = contourLength(g)
      const cuts = tagRanges.length ? tagRanges.map(([a, bb]) => [a / contourLength(centres[0]), bb / contourLength(centres[0])] as [number, number]) : []
      const { segs, tagEls } = splitForTags(g, cuts.map(([a, bb]) => [a * L, bb * L]))
      const passes: ContourPass[] = []
      for (const d of depths) {
        if (tagEls.length && -d < tagTop - 1e-9) {
          for (const [from, to, isTag] of elementRuns(segs.length, tagEls)) passes.push({ depth: isTag ? D - op.tags.height : d, from, to })
        } else passes.push({ depth: d, from: 0, to: segs.length - 1 })
      }
      if (op.stockXY) tp.warnings.push('Stock to leave is not written to woodWOP; set an offset in the macro if needed.')
      if (op.tags.mode !== 'none' && op.tags.shape !== 'flat') tp.warnings.push('Ramped tags are written to woodWOP as flat tags.')
      tp.intents.push({
        k: 'contour',
        segs,
        closed: g.closed,
        rk,
        approach: op.leads.in === 'arc' || op.leads.in === 'line-arc' ? 'TAN' : op.leads.in === 'line' ? 'SEI' : 'SEN',
        ramp: op.leads.in === 'ramp',
        tool,
        label: op.name,
        passes,
      })
    }
  }
}

function tagIntervals(op: ProfileOp, c: Contour): [number, number][] {
  if (op.tags.mode === 'none' || !c.closed) return []
  const L = contourLength(c)
  const at = op.tags.mode === 'manual' ? op.tags.at : Array.from({ length: op.tags.count }, (_, i) => (i + 0.5) / op.tags.count)
  return at
    .map((f) => [f * L - op.tags.length / 2, f * L + op.tags.length / 2] as [number, number])
    .filter(([a, b]) => a >= 0 && b <= L)
    .sort((a, b) => a[0] - b[0])
}

/** Split geometry at tag boundaries; returns segments and which element indices are tags. */
function splitForTags(c: Contour, cuts: [number, number][]) {
  if (!cuts.length) return { segs: c.segs, tagEls: [] as number[] }
  const L = contourLength(c)
  const bounds = [0, ...cuts.flat(), L]
  const segs: Seg[] = []
  const tagEls: number[] = []
  for (let i = 0; i + 1 < bounds.length; i++) {
    const piece = sliceByLength(c, bounds[i], bounds[i + 1])
    const isTag = i % 2 === 1
    for (const s of piece) {
      if (isTag) tagEls.push(segs.length)
      segs.push(s)
    }
  }
  return { segs, tagEls }
}

function elementRuns(n: number, tagEls: number[]): [number, number, boolean][] {
  const out: [number, number, boolean][] = []
  let start = 0
  for (let i = 1; i <= n; i++) {
    if (i === n || tagEls.includes(i) !== tagEls.includes(start)) {
      out.push([start, i - 1, tagEls.includes(start)])
      start = i
    }
  }
  return out
}

function emitProfilePass(
  op: ProfileOp,
  c: Contour,
  side: 'L' | 'R' | 'C',
  r: number,
  z: number,
  prevZ: number,
  tags: { ranges: [number, number][]; top: number; shape: string; angle: number } | null,
  b: Builder,
) {
  const S = startOf(c)
  const t0 = tangentAt(c.segs[0], 0)
  const free = (t: P) => (side === 'R' ? right(t) : left(t))
  const R = Math.max(0.5, op.leads.radius * r)
  const Ll = Math.max(0.5, op.leads.length * r)
  const ccwLead = side !== 'R'
  // lead in
  const leadIn = op.leads.in
  let entry: P = S
  const leadSegs: Seg[] = []
  if (c.closed || side !== 'C') {
    if (leadIn === 'arc' || leadIn === 'line-arc') {
      const C = add(S, mul(free(t0), R))
      const B = add(C, mul(t0, -R))
      leadSegs.push(arc(B, S, C, ccwLead))
      entry = B
      if (leadIn === 'line-arc') {
        const B0 = add(B, mul(t0, -Ll))
        leadSegs.unshift(line(B0, B))
        entry = B0
      }
    } else if (leadIn === 'line') {
      entry = add(S, add(mul(free(t0), Ll * 0.7071), mul(t0, -Ll * 0.7071)))
      leadSegs.push(line(entry, S))
    }
  }
  b.rapid(entry.x, entry.y, op.levels.safeZ)
  b.rapid(entry.x, entry.y, Math.max(prevZ, 0) + op.levels.rapidZ)
  const L = contourLength(c)
  if (leadIn === 'ramp') {
    const rampLen = Math.min(L, Math.abs(z - prevZ) / Math.tan((Math.max(1, op.leads.rampAngle) * Math.PI) / 180))
    b.feed(S.x, S.y, prevZ, 'plunge')
    b.ramp(sliceByLength(c, 0, rampLen), prevZ, z)
    emitAlong(c, rampLen, L + (c.closed ? rampLen : 0), z, tags, b)
  } else {
    b.feed(entry.x, entry.y, z, 'plunge')
    for (const s of leadSegs) b.seg(s, z, 'lead')
    emitAlong(c, 0, L, z, tags, b)
  }
  if (c.closed && op.leads.overlap > 0) for (const s of sliceByLength(c, 0, Math.min(op.leads.overlap, L))) b.seg(s, z)
  // lead out
  const E = { x: b.x, y: b.y }
  const tE = c.closed ? tangentAt(c.segs[0], 0) : tangentAt(c.segs[c.segs.length - 1], 1)
  if (op.leads.out === 'arc' || op.leads.out === 'line-arc') {
    const C = add(E, mul(free(tE), R))
    const X = add(C, mul(tE, R))
    b.seg(arc(E, X, C, ccwLead), z, 'lead')
    if (op.leads.out === 'line-arc') {
      const X1 = add(X, mul(tE, Ll))
      b.feed(X1.x, X1.y, z, 'lead')
    }
  } else if (op.leads.out === 'line') {
    const X = add(E, add(mul(free(tE), Ll * 0.7071), mul(tE, Ll * 0.7071)))
    b.feed(X.x, X.y, z, 'lead')
  }
  b.rapid(b.x, b.y, op.levels.rapidZ)
}

function emitAlong(c: Contour, d0: number, d1: number, z: number, tags: { ranges: [number, number][]; top: number; shape: string; angle: number } | null, b: Builder) {
  if (!tags) {
    for (const s of sliceByLength(c, d0, d1)) b.seg(s, z)
    return
  }
  const rampLen = Math.abs(tags.top - z) / Math.tan((Math.max(5, tags.angle) * Math.PI) / 180)
  let cur = d0
  for (const [a, e] of tags.ranges) {
    if (e <= d0 || a >= d1) continue
    const up = tags.shape === 'flat' ? 0 : rampLen
    const down = tags.shape === 'trapezoid' ? rampLen : 0
    for (const s of sliceByLength(c, cur, Math.max(cur, a - up))) b.seg(s, z)
    if (up) b.ramp(sliceByLength(c, a - up, a), z, tags.top)
    else {
      const p = atLength(c, a).p
      b.feed(p.x, p.y, tags.top)
    }
    for (const s of sliceByLength(c, a, e)) b.seg(s, tags.top)
    if (down) {
      b.ramp(sliceByLength(c, e, e + down), tags.top, z)
      cur = e + down
    } else {
      b.feed(b.x, b.y, z)
      cur = e
    }
  }
  for (const s of sliceByLength(c, cur, d1)) b.seg(s, z)
}

// ---------------------------------------------------------------------------------------------
// Pocket
// ---------------------------------------------------------------------------------------------

function regionOf(op: PocketOp | VCarveOp | SweepOp, ctx: GenContext, islands = true): Contour[] {
  const closed = geometryOf(op, ctx.part).flatMap((g) => g.contours.filter((c) => c.closed))
  if (!closed.length) return []
  const norm = normaliseWinding(closed)
  return islands ? norm : norm.filter((c) => area(c) > 0)
}

/** Rectangle (optionally with equal corner radii) -> centre, size, angle, corner radius. */
export function asRectangle(c: Contour): { cx: number; cy: number; len: number; wid: number; angle: number; r: number } | null {
  const lines = c.segs.filter((s) => s.k === 'L')
  const arcs = c.segs.filter((s) => s.k === 'A') as Extract<Seg, { k: 'A' }>[]
  if (!c.closed || lines.length !== 4 || !(arcs.length === 0 || arcs.length === 4)) return null
  const r = arcs.length ? radius(arcs[0]) : 0
  if (arcs.some((a) => Math.abs(radius(a) - r) > 1e-6 || Math.abs(Math.abs(sweep(a)) - Math.PI / 2) > 1e-6)) return null
  const dirs = lines.map((s) => unit(sub(s.b, s.a)))
  for (let i = 0; i < 4; i++) if (Math.abs(dot(dirs[i], dirs[(i + 1) % 4])) > 1e-6) return null
  const angle = Math.atan2(dirs[0].y, dirs[0].x)
  const mids = lines.map((s) => pointAt(s, 0.5))
  const cx = mids.reduce((n, p) => n + p.x, 0) / 4
  const cy = mids.reduce((n, p) => n + p.y, 0) / 4
  return { cx, cy, len: segLength(lines[0]) + 2 * r, wid: segLength(lines[1]) + 2 * r, angle, r }
}

function genPocket(op: PocketOp, ctx: GenContext, tp: Toolpath, b: Builder) {
  const region = regionOf(op, ctx, op.islands)
  if (!region.length) {
    tp.warnings.push('Pocket needs at least one closed contour.')
    return
  }
  const tool = tp.tool
  if (!tool) {
    tp.warnings.push('No router fits this pocket.')
    return
  }
  const r = tool.diameter / 2
  const D = totalDepth(op, ctx)
  const depths = passDepths(D, maxPass(op, tool))
  const step = Math.max(0.05, op.stepover * tool.diameter)
  let entry = op.entry
  if (entry === 'plunge' && tool.centreCutting === false) {
    tp.warnings.push(`T${tool.number} is not centre-cutting: plunge changed to ramp.`)
    entry = 'ramp'
  }
  if (entry === 'plunge' && tool.maxPlunge && depths[0] > tool.maxPlunge + 1e-9) {
    tp.warnings.push(`First pass ${depths[0]} mm is deeper than T${tool.number} max plunge ${tool.maxPlunge} mm: using a ramp.`)
    entry = 'ramp'
  }
  const first = offset(region, -(r + op.stockXY))
  if (!first.length) {
    tp.warnings.push(`T${tool.number} (D${tool.diameter}) does not fit in the pocket.`)
    return
  }
  const levels: Contour[][] = [first]
  for (let i = 0; i < 2000; i++) {
    const next = offset(levels[levels.length - 1], -step)
    if (!next.length) break
    levels.push(next)
  }
  const orient = (c: Contour) => (op.direction === 'climb' ? c : reverse(c))

  const circ = region.length === 1 && region[0].segs.every((s) => s.k === 'A') && new Set(region[0].segs.map((s) => radius(s as never).toFixed(6))).size === 1

  depths.forEach((d, pi) => {
    const z = -d
    const prevZ = pi === 0 ? 0 : -depths[pi - 1]
    let paths: Contour[] = []
    if (op.pattern === 'zigzag') paths = zigzag(first, step, op.angle)
    else if (op.pattern === 'spiral' && circ) paths = [spiralCircle(region[0], r + op.stockXY, step, op.direction)]
    else paths = [...levels].reverse().flat().map(orient)
    if ((op.pattern === 'zigzag' || (op.pattern === 'spiral' && circ)) && op.finishPass) paths.push(...first.map(orient))
    let started = false
    for (let i = 0; i < paths.length; i++) {
      let c = paths[i]
      if (started) c = rotateToNearest(c, { x: b.x, y: b.y })
      const S = startOf(c)
      const near = started && Math.hypot(S.x - b.x, S.y - b.y) <= step * 1.6 + 1e-6 && linkInside(first, { x: b.x, y: b.y }, S)
      if (near) b.feed(S.x, S.y, z)
      else {
        b.rapid(b.x, b.y, op.levels.rapidZ)
        b.rapid(S.x, S.y, op.levels.safeZ)
        b.rapid(S.x, S.y, Math.max(prevZ, 0) + op.levels.rapidZ)
        enterAt(entry, c, S, prevZ, z, op, r, first, b, tp)
      }
      started = true
      for (const s of c.segs) b.seg(s, z)
    }
    b.rapid(b.x, b.y, op.levels.safeZ)
  })

  // native intents
  const rectInfo = op.islands && region.length > 1 ? null : region.length === 1 ? asRectangle(region[0]) : null
  if (rectInfo && op.pattern !== 'zigzag') {
    tp.intents.push({
      k: 'pocket-rect',
      cx: rectInfo.cx,
      cy: rectInfo.cy,
      len: rectInfo.len,
      wid: rectInfo.wid,
      r: Math.max(rectInfo.r, r),
      angle: (rectInfo.angle * 180) / Math.PI,
      depth: D,
      stepoverPct: Math.round(op.stepover * 100),
      ccw: op.direction === 'climb',
      tool,
      label: op.name,
    })
  } else {
    for (const ring of [...levels].reverse().flat().map(orient))
      tp.intents.push({ k: 'contour', segs: ring.segs, closed: true, rk: 'NOWRK', approach: 'SEN', ramp: entry !== 'plunge', tool, label: `${op.name} ring`, passes: depths.map((d) => ({ depth: d, from: 0, to: ring.segs.length - 1 })) })
    tp.warnings.push('Free-form pocket is written to woodWOP as contour-milling passes on the offset rings (each one editable).')
  }
}

function linkInside(region: Contour[], a: P, b: P) {
  const mids = [0.25, 0.5, 0.75].map((t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }))
  return mids.every((m) => {
    let inside = false
    for (const c of region) if (pointInContour(c, m)) inside = !inside
    return inside
  })
}

function enterAt(entry: PocketOp['entry'], c: Contour, S: P, prevZ: number, z: number, op: PocketOp, r: number, region: Contour[], b: Builder, tp: Toolpath) {
  if (entry === 'helix') {
    const h = Math.max(0.2, op.helixPct * r)
    const C = { x: S.x - h, y: S.y }
    const fits = [0, 1, 2, 3, 4, 5, 6, 7].every((k) => {
      const p = { x: C.x + h * Math.cos((k * Math.PI) / 4), y: C.y + h * Math.sin((k * Math.PI) / 4) }
      let inside = false
      for (const rc of region) if (pointInContour(rc, p)) inside = !inside
      return inside
    })
    if (fits) {
      const pitch = Math.max(0.5, 2 * Math.PI * h * Math.tan((Math.max(1, op.rampAngle) * Math.PI) / 180))
      const turns = Math.max(1, Math.ceil(Math.abs(z - prevZ) / pitch))
      b.feed(S.x, S.y, prevZ, 'plunge')
      const W = { x: C.x - h, y: C.y }
      for (let i = 0; i < turns; i++) {
        const za = prevZ + ((z - prevZ) * (i + 0.5)) / turns
        const zb = prevZ + ((z - prevZ) * (i + 1)) / turns
        b.moves.push({ t: 'arc', x: W.x, y: W.y, z: za, cx: C.x, cy: C.y, ccw: true, f: 'plunge' })
        b.moves.push({ t: 'arc', x: S.x, y: S.y, z: zb, cx: C.x, cy: C.y, ccw: true, f: 'plunge' })
      }
      b.moves.push({ t: 'arc', x: W.x, y: W.y, z, cx: C.x, cy: C.y, ccw: true, f: 'cut' })
      b.moves.push({ t: 'arc', x: S.x, y: S.y, z, cx: C.x, cy: C.y, ccw: true, f: 'cut' })
      Object.assign(b, { x: S.x, y: S.y, z })
      return
    }
    tp.warnings.push('Helix does not fit at a pocket start; ramped instead.')
    entry = 'ramp'
  }
  if (entry === 'ramp') {
    const L = contourLength(c)
    const need = Math.abs(z - prevZ) / Math.tan((Math.max(1, op.rampAngle) * Math.PI) / 180)
    b.feed(S.x, S.y, prevZ, 'plunge')
    if (L >= need || !c.closed) b.ramp(sliceByLength(c, 0, Math.min(L, need)), prevZ, z)
    else {
      let zc = prevZ
      const per = Math.abs(z - prevZ) * (L / need)
      while (zc > z + 1e-9) {
        const zn = Math.max(z, zc - per)
        b.ramp(c.segs, zc, zn)
        zc = zn
      }
    }
    b.feed(S.x, S.y, z, 'cut')
    return
  }
  b.feed(S.x, S.y, z, 'plunge')
}

/** Parallel lines across the region at an angle, linked end to end. */
function zigzag(region: Contour[], step: number, angleDeg: number): Contour[] {
  const a = (angleDeg * Math.PI) / 180
  const u = { x: Math.cos(a), y: Math.sin(a) }
  const n = left(u)
  const polys = region.map((c) => toPoints(c, 0.01))
  let lo = Infinity
  let hi = -Infinity
  for (const poly of polys)
    for (const p of poly) {
      lo = Math.min(lo, dot(p, n))
      hi = Math.max(hi, dot(p, n))
    }
  const out: Contour[] = []
  let flip = false
  for (let s = lo + step / 2; s < hi; s += step) {
    const ts: number[] = []
    for (const poly of polys)
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i]
        const q = poly[(i + 1) % poly.length]
        const dp = dot(p, n) - s
        const dq = dot(q, n) - s
        if (dp > 0 === dq > 0) continue
        const t = dp / (dp - dq)
        ts.push(dot({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }, u))
      }
    ts.sort((x, y) => x - y)
    const pieces: Contour[] = []
    for (let i = 0; i + 1 < ts.length; i += 2) {
      const A = add(mul(u, ts[i]), mul(n, s))
      const B = add(mul(u, ts[i + 1]), mul(n, s))
      pieces.push({ segs: [flip ? line(B, A) : line(A, B)], closed: false })
    }
    out.push(...(flip ? pieces.reverse() : pieces))
    flip = !flip
  }
  return out
}

/** Spiral out from the centre of a circular pocket using half-circle arcs. */
function spiralCircle(c: Contour, inset: number, step: number, dir: PocketOp['direction']): Contour {
  const s0 = c.segs[0] as Extract<Seg, { k: 'A' }>
  const C = s0.c
  const Rf = radius(s0) - inset
  const segs: Seg[] = []
  let rr = 0
  let p = { ...C }
  let up = true
  while (rr < Rf - 1e-9) {
    const nr = Math.min(Rf, rr + step / 2)
    const centre = up ? { x: p.x + nr, y: C.y } : { x: p.x - nr, y: C.y }
    const end = { x: centre.x + (up ? nr : -nr), y: C.y }
    if (dist(p, end) > 1e-9) segs.push(arc(p, end, centre, true))
    p = end
    rr = Math.abs(end.x - C.x)
    up = !up
  }
  const out: Contour = { segs, closed: false }
  return dir === 'climb' ? out : { segs: out.segs.map((s) => (s.k === 'A' ? { ...s, ccw: false, c: { x: s.c.x, y: 2 * C.y - s.c.y }, a: { x: s.a.x, y: 2 * C.y - s.a.y }, b: { x: s.b.x, y: 2 * C.y - s.b.y } } : s)), closed: false }
}

// ---------------------------------------------------------------------------------------------
// Drill
// ---------------------------------------------------------------------------------------------

/** Edge-face (u, v) -> part point and drilling direction. */
export function faceToPart(face: FaceId, u: number, part: { length: number; width: number }): { x: number; y: number; dir: HDrillDir } | null {
  switch (face) {
    case 2:
      return { x: u, y: 0, dir: 'YP' }
    case 3:
      return { x: part.length, y: u, dir: 'XM' }
    case 4:
      return { x: part.length - u, y: part.width, dir: 'YM' }
    case 5:
      return { x: 0, y: part.width - u, dir: 'XP' }
    default:
      return null
  }
}

function genDrill(op: DrillOp, ctx: GenContext, tp: Toolpath, b: Builder) {
  const { part, machine } = ctx
  const holes: { x: number; y: number; d: number; depth: number; face: FaceId }[] = []
  for (const { e } of geometryOf(op, part)) {
    let d = 0
    let c: P | null = null
    if (e.g.t === 'circle') {
      d = e.g.r * 2
      c = e.g.c
    } else if (e.g.t === 'point') {
      c = e.g.p
      d = tp.tool?.diameter ?? 0
    } else continue
    const sel = op.select
    if (sel.mode === 'diameter' && sel.diameter !== undefined && Math.abs(d - sel.diameter) > 0.01) continue
    if (sel.mode === 'range' && ((sel.min !== undefined && d < sel.min - 1e-9) || (sel.max !== undefined && d > sel.max + 1e-9))) continue
    holes.push({ x: c.x, y: c.y, d: Math.round(d * 1000) / 1000, depth: e.depth ?? op.levels.depth, face: e.face })
  }
  if (!holes.length) tp.warnings.push('No holes matched this drill operation.')
  const groups = new Map<string, typeof holes>()
  for (const h of holes) {
    const key = `${h.face}:${h.d}`
    groups.set(key, [...(groups.get(key) ?? []), h])
  }
  const T = part.thickness
  for (const [, list] of [...groups.entries()].sort((a, b) => a[1][0].face - b[1][0].face || a[1][0].d - b[1][0].d)) {
    const face = list[0].face
    const d = list[0].d
    const type = face === 1 ? 'drill-vertical' : 'drill-horizontal'
    const tool = op.toolId ? (machine.tools.find((t) => t.id === op.toolId) ?? null) : (resolveTool(op, machine, { diameter: d }) ?? machine.tools.find((t) => t.type === type && Math.abs(t.diameter - d) < 0.01) ?? null)
    if (face === 6) {
      tp.warnings.push(`${list.length} hole(s) on face 6 (underside) need a flipped program and are not generated.`)
      continue
    }
    if (!tool) tp.warnings.push(`No ${face === 1 ? 'vertical' : 'horizontal'} drill D${d} in the tool table.`)
    // nearest-neighbour order from the origin
    const todo = [...list]
    let cur = { x: 0, y: 0 }
    while (todo.length) {
      let bi = 0
      for (let i = 1; i < todo.length; i++) if (Math.hypot(todo[i].x - cur.x, todo[i].y - cur.y) < Math.hypot(todo[bi].x - cur.x, todo[bi].y - cur.y)) bi = i
      const h = todo.splice(bi, 1)[0]
      cur = h
      if (face === 1) {
        const through = op.levels.through || h.depth >= T - 1e-9
        let depth = through ? T + machine.throughDepth : h.depth
        if (op.depthRef === 'shoulder' && tool?.shape === 'drill') depth += d / 2 / Math.tan((59 * Math.PI) / 180)
        if (tool && depth > tool.maxDepth + 1e-9) tp.warnings.push(`Hole D${d} depth ${depth} mm exceeds T${tool.number} max depth.`)
        b.rapid(h.x, h.y, op.levels.safeZ)
        b.drill(h.x, h.y, -depth, op.levels.rapidZ, op.cycle === 'peck' ? op.peck : 0, op.dwell)
        tp.intents.push({ k: 'vdrill', x: h.x, y: h.y, d, depth: Math.round(depth * 1000) / 1000, through, tool, label: op.name })
      } else {
        const fp = faceToPart(face, h.x, part)!
        const v = h.y
        const dirV = { XP: { x: 1, y: 0 }, XM: { x: -1, y: 0 }, YP: { x: 0, y: 1 }, YM: { x: 0, y: -1 } }[fp.dir]
        const outside = { x: fp.x - dirV.x * 10, y: fp.y - dirV.y * 10 }
        b.rapid(outside.x, outside.y, op.levels.safeZ)
        b.rapid(outside.x, outside.y, -v)
        b.feed(fp.x + dirV.x * h.depth, fp.y + dirV.y * h.depth, -v, 'plunge')
        b.feed(outside.x, outside.y, -v, 'lead')
        b.rapid(outside.x, outside.y, op.levels.safeZ)
        tp.intents.push({ k: 'hdrill', x: fp.x, y: fp.y, z: v, d, depth: h.depth, dir: fp.dir, face, tool, label: op.name })
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Engrave, V-carve, saw, sweep
// ---------------------------------------------------------------------------------------------

function genEngrave(op: CamOp, ctx: GenContext, tp: Toolpath, b: Builder) {
  const D = totalDepth(op, ctx)
  const depths = passDepths(D, maxPass(op, tp.tool))
  for (const { contours } of geometryOf(op, ctx.part))
    for (const c of contours) {
      if (!c.segs.length) continue
      for (const d of depths) {
        const S = startOf(c)
        b.rapid(S.x, S.y, op.levels.safeZ)
        b.rapid(S.x, S.y, op.levels.rapidZ)
        b.feed(S.x, S.y, -d, 'plunge')
        for (const s of c.segs) b.seg(s, -d)
        b.rapid(b.x, b.y, op.levels.rapidZ)
      }
      tp.intents.push({ k: 'contour', segs: c.segs, closed: c.closed, rk: 'NOWRK', approach: 'SEN', ramp: false, tool: tp.tool, label: op.name, passes: depths.map((d) => ({ depth: d, from: 0, to: c.segs.length - 1 })) })
    }
  b.rapid(b.x, b.y, op.levels.safeZ)
}

function genVCarve(op: VCarveOp, ctx: GenContext, tp: Toolpath, b: Builder) {
  const tool = tp.tool
  if (!tool || tool.shape !== 'v') tp.warnings.push('V-carve needs a V tool (shape "v" with an included angle) in the tool table.')
  const half = (((tool?.angle ?? 90) / 2) * Math.PI) / 180
  const maxD = op.levels.depth
  const region = regionOf(op, ctx, true)
  const openOnes = geometryOf(op, ctx.part).flatMap((g) => g.contours.filter((c) => !c.closed))
  const rings: { c: Contour; depth: number }[] = []
  for (let k = 1; k < 4000; k++) {
    const w = k * op.step
    const depth = Math.min(maxD, w / Math.tan(half))
    const res = offset(region, -w)
    if (!res.length) break
    for (const c of res) rings.push({ c, depth })
  }
  for (const { c, depth } of rings) {
    const S = startOf(c)
    b.rapid(S.x, S.y, op.levels.safeZ)
    b.rapid(S.x, S.y, op.levels.rapidZ)
    b.feed(S.x, S.y, -depth, 'plunge')
    for (const s of c.segs) b.seg(s, -depth)
    b.rapid(b.x, b.y, op.levels.rapidZ)
    tp.intents.push({ k: 'contour', segs: c.segs, closed: true, rk: 'NOWRK', approach: 'SEN', ramp: false, tool, label: `${op.name} ring`, passes: [{ depth, from: 0, to: c.segs.length - 1 }] })
  }
  for (const c of openOnes) {
    const S = startOf(c)
    const depth = Math.min(maxD, 0.5 / Math.tan(half))
    b.rapid(S.x, S.y, op.levels.safeZ)
    b.feed(S.x, S.y, -depth, 'plunge')
    for (const s of c.segs) b.seg(s, -depth)
    b.rapid(b.x, b.y, op.levels.safeZ)
    tp.intents.push({ k: 'contour', segs: c.segs, closed: false, rk: 'NOWRK', approach: 'SEN', ramp: false, tool, label: op.name, passes: [{ depth, from: 0, to: c.segs.length - 1 }] })
  }
  b.rapid(b.x, b.y, op.levels.safeZ)
  if (rings.length > 400) tp.warnings.push(`${rings.length} V-carve rings: consider a larger step.`)
}

function genSaw(op: CamOp, ctx: GenContext, tp: Toolpath, b: Builder) {
  const tool = tp.tool
  if (!tool) tp.warnings.push('No saw unit in the tool table.')
  const width = tool?.kerf ?? 4
  const D = totalDepth(op, ctx)
  for (const { contours } of geometryOf(op, ctx.part))
    for (const c of contours)
      for (const s of c.segs) {
        if (s.k !== 'L') {
          tp.warnings.push('Saw grooves follow straight lines only; arcs were skipped.')
          continue
        }
        b.rapid(s.a.x, s.a.y, op.levels.safeZ)
        b.feed(s.a.x, s.a.y, -D, 'plunge')
        b.feed(s.b.x, s.b.y, -D)
        b.rapid(s.b.x, s.b.y, op.levels.safeZ)
        tp.intents.push({ k: 'saw', xa: s.a.x, ya: s.a.y, xe: s.b.x, ye: s.b.y, width, depth: D, tool, label: op.name })
      }
}

/** Depth of a sweep section at an inset (linear between points; deeper than the last point = 0). */
export function sectionDepth(section: SweepOp['section'], inset: number) {
  const s = [...section].sort((a, b) => a.inset - b.inset)
  if (!s.length) return 0
  if (inset <= s[0].inset) return s[0].depth
  for (let i = 0; i + 1 < s.length; i++)
    if (inset <= s[i + 1].inset) {
      const t = (inset - s[i].inset) / Math.max(1e-9, s[i + 1].inset - s[i].inset)
      return s[i].depth + (s[i + 1].depth - s[i].depth) * t
    }
  return 0
}

function genSweep(op: SweepOp, ctx: GenContext, tp: Toolpath, b: Builder) {
  const tool = tp.tool
  if (!tool) {
    tp.warnings.push('No router for the profiled sweep.')
    return
  }
  const guide = regionOf(op, ctx, false)
  if (!guide.length) {
    tp.warnings.push('Profiled sweep needs a closed guide contour.')
    return
  }
  const r = tool.diameter / 2
  const maxInset = Math.max(...op.section.map((s) => s.inset))
  const sign = op.side === 'inside' ? -1 : 1
  const mp = maxPass(op, tool)
  for (let wc = r; wc <= maxInset + r + 1e-9; wc += Math.max(0.1, op.step)) {
    let depth = Infinity
    for (let k = 0; k <= 8; k++) depth = Math.min(depth, sectionDepth(op.section, wc - r + (2 * r * k) / 8))
    if (depth <= 0.01) continue
    const rings = offset(guide, sign * wc)
    for (const c of rings) {
      const ds = passDepths(depth, mp)
      for (const d of ds) {
        const S = startOf(c)
        b.rapid(S.x, S.y, op.levels.safeZ)
        b.rapid(S.x, S.y, op.levels.rapidZ)
        b.feed(S.x, S.y, -d, 'plunge')
        for (const s of c.segs) b.seg(s, -d)
        b.rapid(b.x, b.y, op.levels.rapidZ)
      }
      tp.intents.push({ k: 'contour', segs: c.segs, closed: true, rk: 'NOWRK', approach: 'SEN', ramp: false, tool, label: `${op.name} ${Math.round(depth * 10) / 10}`, passes: ds.map((d) => ({ depth: d, from: 0, to: c.segs.length - 1 })) })
    }
  }
  b.rapid(b.x, b.y, op.levels.safeZ)
}

// ---------------------------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------------------------

export function generateOp(op: CamOp, ctx: GenContext): Toolpath {
  const widthHint = op.kind === 'pocket' ? minWidth(op, ctx) : undefined
  const tool = op.kind === 'drill' ? (op.toolId ? (ctx.machine.tools.find((t) => t.id === op.toolId) ?? null) : null) : resolveTool(op, ctx.machine, { width: widthHint })
  const feeds = feedsFor(op, tool, ctx.part.materialId, ctx.machine)
  const tp: Toolpath = { opId: op.id, kind: op.kind, name: op.name, tool, feeds, moves: [], intents: [], warnings: [], stats: { cut: 0, rapid: 0, minutes: 0 } }
  const b = new Builder()
  if (op.face !== 1 && op.kind !== 'drill' && op.kind !== 'code') tp.warnings.push(`Face ${op.face} milling needs an aggregate; only drilling is generated on edge faces.`)
  else
    switch (op.kind) {
      case 'profile':
        genProfile(op, ctx, tp, b)
        break
      case 'pocket':
        genPocket(op, ctx, tp, b)
        break
      case 'drill':
        genDrill(op, ctx, tp, b)
        break
      case 'engrave':
        genEngrave(op, ctx, tp, b)
        break
      case 'vcarve':
        genVCarve(op, ctx, tp, b)
        break
      case 'saw':
        genSaw(op, ctx, tp, b)
        break
      case 'sweep':
        genSweep(op, ctx, tp, b)
        break
      case 'code':
        tp.intents.push({ k: 'comment', text: op.text, stop: op.stop })
        if (op.stop) tp.warnings.push('woodWOP has no program-stop macro here; the stop is written as a comment.')
        break
    }
  tp.stats = stats(b.moves, feeds.feed)
  tp.moves = b.moves
  return tp
}

function minWidth(op: CamOp, ctx: GenContext) {
  const closed = geometryOf(op, ctx.part).flatMap((g) => g.contours.filter((c) => c.closed))
  if (!closed.length) return undefined
  const bx = boxOf(closed)
  return Math.min(bx.maxX - bx.minX, bx.maxY - bx.minY)
}

export function generatePart(part: CamPart, machine: MachineProfile): Toolpath[] {
  return part.ops.filter((o) => o.enabled).map((op) => generateOp(op, { part, machine }))
}

