/**
 * Toolpath generation. Each op produces:
 *  - moves: a machine-neutral IR (rapid / feed / arc / drill cycle) for preview, backplot and
 *    template posts. Z is 0 at face 1 and negative into the material.
 *  - intents: what a native woodWOP program should contain (contour milling on the drawn
 *    geometry with radius correction, drilling macros, rectangular pockets, saw grooves).
 */
import type { HDrillDir, MachineProfile, Tool } from '@/core/types'
import { entityContours, layerOf, opInputHash, partOutline, restSources, stockTopShift } from './doc'
import { cutFloor, planSawCuts, type SawCut } from './more25d/saw'
import { betweenCurves, type Chain3, smooth3, zWave } from './more25d/curves'
import { applyEdits, movesHash } from './more25d/edits'
import {
  add,
  arc,
  area,
  endOf,
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
  polyline,
} from './geom'
import { breakAt, clipPolys, inflatePolys, normaliseWinding, offset, offsetChain } from './kernel'
import { RAPID_RATE, simpleMoves } from './moves'
import { contourPolys, PolySet, restAt, restPieces, type SweepSource, sweptAt } from './adaptive/rest'
import { planAdaptive } from './adaptive/adaptive'
import { DEFAULT_ADAPTIVE, feedsFor, passDepths, PLACEHOLDER_BLADE, resolveTool } from './ops'
import type { Work } from '@/core/cancel'
import { cutterOfTool } from './3d/cutter'
import { parallelFinish } from './3d/parallel'
import { radialFinish, spiralFinish } from './3d/radial'
import { scallopFinish } from './3d/scallop'
import { flatAreaFinish } from './3d/flat'
import { FLAT_DEG } from './3d/passes'
import { helicalFinish } from './3d/helical'
import { undercutFinish } from './3d/undercut'
import { pencilFinish } from './3d/pencil'
import { projectionFinish } from './3d/projection'
import { centreRegion, type Region } from './3d/region'
import { restArea, restCentres } from './3d/rest3d'
import { type Layer, waterlineFinish } from './3d/waterline'
import { zLevelRough } from './3d/zlevel'
import { DEFAULT_COLLISION_MARGIN } from './collision/collision'
import { modelClearance } from './collision/model'
import { aggregateOf, anglesOutOfReach, effectiveGauge, machineModelOf, toolOutline } from '@/core/machineModel'
import { placeMesh } from './mesh/place'
import { mergeMeshes, placedReliefOutline, reliefSurround } from './relief/relief'
import { type Mesh, meshBounds } from './mesh/types'
import type { CamOp, CamPart, ChamferOp, CurveOp, EdgeOp, ManualOp, ToolpathEdits, DrillOp, Entity, FaceId, FaceOp, Finish3dOp, PocketOp, ProfileOp, Rough3dOp, SawOp, SweepOp, VCarveOp } from './types'

export type FeedKind = 'cut' | 'plunge' | 'lead'
export type Move =
  | { t: 'rapid'; x: number; y: number; z: number }
  /** `k`: adaptive feed, this move runs at k times the operation's feed (absent = 1). */
  | { t: 'feed'; x: number; y: number; z: number; f: FeedKind; k?: number }
  /** `k`: feed factor as on feed moves (toolpath edits slow arcs in corners). */
  | { t: 'arc'; x: number; y: number; z: number; cx: number; cy: number; ccw: boolean; f: FeedKind; k?: number }
  | { t: 'drill'; x: number; y: number; z: number; r: number; peck: number; dwell: number }
  /** 3D chain: straight feed moves through each (x, y, z) in `pts` in turn, from the current position. */
  | { t: 'poly'; pts: Float64Array; f: FeedKind }

/** A move that is not a 3D chain. */
export type SimpleMove = Exclude<Move, { t: 'poly' }>

export { RAPID_RATE, simpleMoves } from './moves'

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
      /** How far the cutter reaches past this path (facing): the export checker keeps it off neighbouring parts. */
      reach?: number
    }
  /** `back`: drilled from face 6 in a separate program after the part is turned over (x mirrored). */
  | { k: 'vdrill'; x: number; y: number; d: number; depth: number; through: boolean; tool: Tool | null; label: string; back?: boolean }
  | { k: 'hdrill'; x: number; y: number; z: number; d: number; depth: number; dir: HDrillDir; face: FaceId; tool: Tool | null; label: string }
  | { k: 'pocket-rect'; cx: number; cy: number; len: number; wid: number; r: number; angle: number; depth: number; stepoverPct: number; ccw: boolean; tool: Tool | null; label: string }
  /** `runout`: how far the blade cuts past each end at the surface (M2.6 saw cuts); the export checker keeps it off neighbouring parts. */
  | { k: 'saw'; xa: number; ya: number; xe: number; ye: number; width: number; depth: number; tool: Tool | null; label: string; runout?: number }
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
  /** Flagged move ranges (indices into `moves`, `to` exclusive): trochoidal loops of adaptive clearing. */
  sections?: { kind: 'trochoidal'; from: number; to: number }[]
  /**
   * Why this operation cannot be written to woodWOP (no confirmed form); nothing of it is written
   * and the export checker refuses the job while it is enabled. Absent = written as its intents.
   */
  noOutput?: string
  /** Saw cuts (2D-11): the blade and each cut, for drawing the blade and its run-out. */
  saw?: { r: number; kerf: number; tilt: number; runout: number; placeholderBlade: boolean; cuts: SawCut[] }
  /** Depths were measured from a faced top this far below face 1 (2D-16). */
  top?: number
  /**
   * Toolpath edits (NEW-11): hash of the unedited toolpath (point edits are made against it), and
   * how many point edits were applied as made, moved to the matching move, or lost.
   */
  edited?: { base: string; applied: number; moved: number; lost: number; reversed: boolean }
  /**
   * Edge work with an aggregate (5AX-04): the moves are the tool tip, at the tool axis height; the
   * tool lies flat, square to the path, on the `side` of travel where the material is.
   */
  edge?: {
    height: number
    r: number
    flute: number
    side: 'left' | 'right'
    /** The tool's aggregate (TOOL-04): its housing behind the tool's gauge face, `gauge` from the tip, and the offset up to the spindle. */
    housing?: { width: number; above: number; below: number; length: number; gauge: number; offset: { x: number; y: number; z: number } }
  }
}

export interface GenContext {
  part: CamPart
  machine: MachineProfile
  /** 3D model meshes by blob hash (as stored, before placement). Needed by 3D operations only. */
  meshes?: ReadonlyMap<string, Mesh>
  /** Progress and cancel for long 3D operations. */
  work?: Work
  /** Toolpaths of operations already generated, by op id (rest machining reads them). */
  done?: ReadonlyMap<string, Toolpath>
  /** The part as drawn, when `part` is a thinner copy after a facing that re-set the stock top. */
  base?: CamPart
}


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
  feed(x: number, y: number, z: number, f: FeedKind = 'cut', k?: number) {
    if (Math.abs(x - this.x) < 1e-9 && Math.abs(y - this.y) < 1e-9 && Math.abs(z - this.z) < 1e-9) return
    this.moves.push(k && k !== 1 ? { t: 'feed', x, y, z, f, k } : { t: 'feed', x, y, z, f })
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
  // adaptive feed: time saved or added by moves that run at k times the feed (in feed-mm)
  let boost = 0
  let x = 0
  let y = 0
  let z = 50
  for (const m of simpleMoves(moves)) {
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
    if ((m.t === 'feed' || m.t === 'arc') && m.k && m.k !== 1) boost += d / m.k - d
    x = m.x
    y = m.y
    z = m.z
  }
  return { cut: Math.round(cut), rapid: Math.round(rapid), minutes: Math.round(((boost ? cut + boost : cut) / Math.max(1, feed) + rapid / RAPID_RATE + drills * 0.03) * 100) / 100 }
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

function depthsFor(op: CamOp, tool: Tool | null, total: number) {
  return op.levels.cuts && op.levels.cuts > 0 ? passDepths(total, total / Math.round(op.levels.cuts)) : passDepths(total, maxPass(op, tool))
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
  const depths = depthsFor(op, tool, D)
  if (!tool) tp.warnings.push('No router selected or available for this profile.')
  if (tool && D > tool.maxDepth + 1e-9) tp.warnings.push(`Depth ${D} mm exceeds T${tool.number} max depth ${tool.maxDepth} mm.`)
  if (op.slope) tp.warnings.push('Sloped walls are previewed vertical; the slope is written as a note only.')
  if (op.corners === 'loop') tp.warnings.push('Looped corners are generated as rolled (round) corners.')

  const picked = geometryOf(op, ctx.part).flatMap((x) => x.contours)
  const nested = (c: Contour) => picked.filter((o) => o !== c && o.closed && c.segs.length && pointInContour(o, startOf(c)) && Math.abs(area(o)) > Math.abs(area(c))).length
  for (const c0 of orderContours(picked, op.order ?? 'drawn')) {
    {
      let g = op.reverse && !c0.closed ? reverse(c0) : c0
      let side: 'L' | 'R' | 'C'
      if (g.closed) {
        const outside = op.side === 'auto' ? nested(g) % 2 === 0 : op.side === 'outside' || op.side === 'left'
        // climb with a CW spindle keeps the material on the right of travel
        const wantCw = outside ? op.direction === 'climb' : op.direction !== 'climb'
        const isCw = area(g) < 0
        if (wantCw !== isCw) g = reverse(g)
        side = outside ? (wantCw ? 'L' : 'R') : wantCw ? 'R' : 'L'
        g = startAtLength(g, op.start !== undefined ? op.start * contourLength(g) : defaultStart(g))
      } else {
        side = op.side === 'left' || op.side === 'outside' ? 'L' : op.side === 'right' || op.side === 'inside' ? 'R' : 'C'
        if (op.side === 'auto') side = 'C'
        if (op.direction === 'conventional' && side !== 'C') {
          g = reverse(g)
          side = side === 'L' ? 'R' : 'L'
        }
      }
      const final = r + op.stockXY
      const rough = side === 'C' ? 0 : Math.max(0, Math.round(op.xyPasses ?? 0))
      const xyStep = Math.max(0.1, op.xyStep ?? r)
      const ringsAt = (o: number): Contour[] | null => {
        if (side === 'C' || o <= 1e-9) return [g]
        if (!g.closed) return [offsetChain(g, side === 'L' ? o : -o)]
        const outward = side === 'L' ? area(g) < 0 : area(g) > 0
        const res = offset([g], outward ? o : -o, op.corners === 'straight' ? 'miter' : 'round')
        if (!res.length) return null
        return res.map((cc) => rotateToNearest(area(cc) < 0 === area(g) < 0 ? cc : reverse(cc), startOf(g)))
      }
      const centres = ringsAt(final)
      if (!centres) {
        tp.warnings.push(`Tool D${tool?.diameter} does not fit inside a ${op.side} contour.`)
        continue
      }
      const roughing: Contour[] = []
      for (let k = rough; k >= 1; k--) roughing.push(...(ringsAt(final + k * xyStep) ?? []))

      const tagRanges = tagIntervals(op, centres[0])
      const tagTop = -(D - op.tags.height)

      for (const cp of roughing) {
        depths.forEach((d, pi) => emitProfilePass(op, cp, side, r, -d, pi === 0 ? 0 : -depths[pi - 1], null, b))
        b.rapid(b.x, b.y, op.levels.safeZ)
      }
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

/** Centre of a contour made only of arcs on one circle (a drawn hole), else null. */
function circleCentre(c: Contour): P | null {
  if (!c.closed || !c.segs.length || c.segs.some((s) => s.k !== 'A')) return null
  const s0 = c.segs[0] as Extract<Seg, { k: 'A' }>
  return c.segs.every((s) => s.k === 'A' && dist(s.c, s0.c) < 1e-6) ? s0.c : null
}

/** Shapes inside other shapes first (smallest first), or nearest-next from the origin. */
export function orderContours(cs: Contour[], order: 'drawn' | 'inside-first' | 'nearest'): Contour[] {
  if (order === 'drawn' || cs.length < 2) return cs
  if (order === 'inside-first') {
    const depthOf = (c: Contour) => cs.filter((o) => o !== c && o.closed && c.segs.length && pointInContour(o, startOf(c)) && Math.abs(area(o)) > Math.abs(area(c))).length
    const info = cs.map((c, i) => ({ c, i, depth: depthOf(c), a: c.closed ? Math.abs(area(c)) : 0 }))
    return info.sort((x, y) => y.depth - x.depth || x.a - y.a || x.i - y.i).map((x) => x.c)
  }
  const todo = [...cs]
  const out: Contour[] = []
  let at: P = { x: 0, y: 0 }
  while (todo.length) {
    let bi = 0
    for (let i = 1; i < todo.length; i++) if (dist(closestOnContour(todo[i], at).p, at) < dist(closestOnContour(todo[bi], at).p, at)) bi = i
    const c = todo.splice(bi, 1)[0]
    out.push(c)
    at = c.closed ? startOf(c) : endOf(c)
  }
  return out
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
  if (leadIn === 'centre') {
    const centre = circleCentre(c)
    if (centre) {
      entry = centre
      leadSegs.push(line(centre, S))
    }
  } else if (c.closed || side !== 'C') {
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
  const depths = depthsFor(op, tool, D)
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
  for (let i = 1; i < 2000; i++) {
    const next = offset(region, -(r + op.stockXY + i * step))
    if (!next.length) break
    levels.push(next)
  }
  const orient = (c: Contour) => (op.direction === 'climb' ? c : reverse(c))
  const slack = offset(first, 0.01)
  if (op.rest) return genRestPocket(op, ctx, tp, b, { region, tool, depths, entry, first, rings: [...levels].reverse().flat().map(orient), slack })
  if (op.pattern === 'adaptive') return genAdaptivePocket(op, ctx, tp, b, { region, tool, depths, first })

  const circ = region.length === 1 && region[0].segs.every((s) => s.k === 'A') && new Set(region[0].segs.map((s) => radius(s as never).toFixed(6))).size === 1

  const starts = op.edits?.starts?.length ? op.edits.starts : null
  if (starts && op.pattern === 'spiral' && circ) tp.warnings.push('A spiral pocket always starts at its centre: the start point is not used.')
  depths.forEach((d, pi) => {
    const z = -d
    const prevZ = pi === 0 ? 0 : -depths[pi - 1]
    let paths: Contour[] = []
    if (op.pattern === 'zigzag') paths = zigzag(first, step, op.angle)
    else if (op.pattern === 'spiral' && circ) paths = [spiralCircle(region[0], r + op.stockXY, step, op.direction)]
    else paths = [...levels].reverse().flat().map(orient)
    if (op.pattern === 'zigzag' && op.finishPass) paths.push(...first.map(orient))
    // NEW-11 start points: back-and-forth lines run from the end nearer a start point; rings start
    // at the point nearest one
    if (starts && op.pattern === 'zigzag' && paths.length) {
      const near = (q: P) => Math.min(...starts.map((s0) => dist(s0, q)))
      const lines = paths.filter((c) => !c.closed)
      if (lines.length && near(endOf(lines[lines.length - 1])) < near(startOf(lines[0]) ) - 1e-9) paths = [...lines.reverse().map(reverse), ...paths.filter((c) => c.closed)]
    }
    let started = false
    for (let i = 0; i < paths.length; i++) {
      let c = paths[i]
      if (started) c = rotateToNearest(c, { x: b.x, y: b.y })
      else if (starts && c.closed) {
        let best = starts[0]
        for (const s0 of starts) if (dist(closestOnContour(c, s0).p, s0) < dist(closestOnContour(c, best).p, best)) best = s0
        c = rotateToNearest(c, best)
      }
      const S = startOf(c)
      const near = started && Math.hypot(S.x - b.x, S.y - b.y) <= step * 1.6 + 1e-6 && linkInside(slack, { x: b.x, y: b.y }, S)
      if (near) b.feed(S.x, S.y, z)
      else {
        b.rapid(b.x, b.y, op.levels.rapidZ)
        b.rapid(S.x, S.y, op.levels.safeZ)
        b.rapid(S.x, S.y, Math.max(prevZ, 0) + op.levels.rapidZ)
        enterAt(entry, c, S, prevZ, z, op, r, slack, b, tp)
      }
      started = true
      for (const s of c.segs) b.seg(s, z)
    }
    b.rapid(b.x, b.y, op.levels.safeZ)
  })

  // native intents
  const rectInfo = op.islands && region.length > 1 ? null : region.length === 1 ? asRectangle(region[0]) : null
  if (rectInfo && op.pattern !== 'zigzag') {
    if (starts) tp.warnings.push("Start points are not written to woodWOP's pocket macro (it picks its own start).")
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

/**
 * Rest machining (2D-07): the pocket's offset passes (inside out) cut down, level by level, to the
 * pieces that reach material the earlier operations left. A piece starting clear of that material
 * goes straight down (the column above it was cut by the earlier tools); one starting in it uses
 * the pocket's entry.
 */
function genRestPocket(op: PocketOp, ctx: GenContext, tp: Toolpath, b: Builder, g: { region: Contour[]; tool: Tool; depths: number[]; entry: PocketOp['entry']; first: Contour[]; rings: Contour[]; slack: Contour[] }) {
  const rest = op.rest!
  const sources = restSources(op, ctx.part)
  if (!sources.length) {
    tp.warnings.push('Rest machining: there is no earlier milling operation to follow, so nothing is cut.')
    return
  }
  const srcs: SweepSource[] = []
  for (const s of sources) {
    const stp = ctx.done?.get(s.id) ?? generateOp(s, { part: ctx.part, machine: ctx.machine, meshes: ctx.meshes, done: ctx.done })
    const ct = cutterOfTool(stp.tool)
    if ('error' in ct) {
      tp.warnings.push(`Rest machining: "${s.name}" has no usable router, so it is not counted.`)
      continue
    }
    srcs.push({ moves: [...simpleMoves(stp.moves)], cutter: ct.cutter })
  }
  const r = g.tool.diameter / 2
  const target = contourPolys(op.stockXY > 0 ? offset(g.region, -op.stockXY) : g.region)
  const centres = contourPolys(g.first)
  // keep pieces from a little before the tool reaches the material to a little after
  const margin = Math.min(1, 0.25 * r)
  let pieces = 0
  g.depths.forEach((d, pi) => {
    const z = -d
    const prevZ = pi === 0 ? 0 : -g.depths[pi - 1]
    // tips at this depth count as having cut it
    const left = restAt(target, sweptAt(srcs, z + 1e-6), centres, r)
    if (!left.length) return
    const zone = new PolySet(inflatePolys(left, r + margin, 'round', 0.001))
    const touch = new PolySet(inflatePolys(left, Math.max(0.001, r - 0.002), 'round', 0.001))
    for (const ring of g.rings)
      for (const pc of restPieces(ring, zone, touch, Math.max(0, rest.minLength))) {
        const segs = pc.whole ? ring.segs : sliceByLength(ring, pc.d0, pc.d1)
        if (!segs.length) continue
        const c: Contour = { segs, closed: pc.whole }
        const S = startOf(c)
        if (b.z < op.levels.rapidZ) b.rapid(b.x, b.y, op.levels.rapidZ)
        b.rapid(S.x, S.y, op.levels.safeZ)
        b.rapid(S.x, S.y, Math.max(prevZ, 0) + op.levels.rapidZ)
        if (pc.startsInMaterial) enterAt(g.entry, c, S, prevZ, z, op, r, g.slack, b, tp)
        else b.feed(S.x, S.y, z, 'plunge')
        for (const s of segs) b.seg(s, z)
        tp.intents.push({ k: 'contour', segs, closed: c.closed, rk: 'NOWRK', approach: 'SEN', ramp: pc.startsInMaterial && g.entry !== 'plunge', tool: g.tool, label: `${op.name} rest`, passes: [{ depth: d, from: 0, to: segs.length - 1 }] })
        pieces++
      }
  })
  b.rapid(b.x, b.y, op.levels.safeZ)
  if (!pieces) tp.warnings.push(`Rest machining: the earlier operations left nothing T${g.tool.number} can reach${rest.minLength > 0 ? ' in pieces longer than the minimum length' : ''}.`)
  else tp.warnings.push('Rest machining follows the toolpaths of the earlier operations: they must run first, in the order shown. In woodWOP each rest piece is its own contour-milling pass.')
}

/** Every point of a-b (checked at most 2 mm apart) is inside the region. */
function linkWithin(region: Contour[], a: P, b: P) {
  const n = Math.max(2, Math.ceil(dist(a, b) / 2))
  for (let i = 1; i < n; i++) {
    const m = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }
    let inside = false
    for (const c of region) if (pointInContour(c, m)) inside = !inside
    if (!inside) return false
  }
  return true
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
    const inRegion = (p: P) => {
      let inside = false
      for (const rc of region) if (pointInContour(rc, p)) inside = !inside
      return inside
    }
    const t = c.segs.length ? tangentAt(c.segs[0], 0) : { x: 1, y: 0 }
    // The start sits on the outer ring, so the circle is tested slightly shrunk to accept tangency.
    const fitsAt = (C: P) => Array.from({ length: 16 }, (_, k) => (k * Math.PI) / 8).every((a) => inRegion({ x: C.x + (h - 0.01) * Math.cos(a), y: C.y + (h - 0.01) * Math.sin(a) }))
    const C = [left(t), right(t), t].map((n) => add(S, mul(n, h))).find(fitsAt)
    if (C) {
      helixDown(b, C, S, h, prevZ, z, op.rampAngle)
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

/** Helix of radius h around C from S (on it) down from prevZ to z, then a full turn at z. */
function helixDown(b: Builder, C: P, S: P, h: number, prevZ: number, z: number, rampAngle: number) {
  const pitch = Math.max(0.5, 2 * Math.PI * h * Math.tan((Math.max(1, rampAngle) * Math.PI) / 180))
  const turns = Math.max(1, Math.ceil(Math.abs(z - prevZ) / pitch))
  b.feed(S.x, S.y, prevZ, 'plunge')
  const W = sub(mul(C, 2), S)
  for (let i = 0; i < turns; i++) {
    const za = prevZ + ((z - prevZ) * (i + 0.5)) / turns
    const zb = prevZ + ((z - prevZ) * (i + 1)) / turns
    b.moves.push({ t: 'arc', x: W.x, y: W.y, z: za, cx: C.x, cy: C.y, ccw: true, f: 'plunge' })
    b.moves.push({ t: 'arc', x: S.x, y: S.y, z: zb, cx: C.x, cy: C.y, ccw: true, f: 'plunge' })
  }
  b.moves.push({ t: 'arc', x: W.x, y: W.y, z, cx: C.x, cy: C.y, ccw: true, f: 'cut' })
  b.moves.push({ t: 'arc', x: S.x, y: S.y, z, cx: C.x, cy: C.y, ccw: true, f: 'cut' })
  Object.assign(b, { x: S.x, y: S.y, z })
}

/**
 * Adaptive clearing (NEW-01): one level planned at a steady width of cut (`adaptive/adaptive.ts`)
 * and repeated at every depth (each level of a straight-walled pocket is the same full layer).
 * Entries are helixes; moves back run lifted through cleared area, or up and over. Not written to
 * woodWOP: the export checker blocks it.
 */
function genAdaptivePocket(op: PocketOp, ctx: GenContext, tp: Toolpath, b: Builder, g: { region: Contour[]; tool: Tool; depths: number[]; first: Contour[] }) {
  const a = op.adaptive ?? DEFAULT_ADAPTIVE
  const r = g.tool.diameter / 2
  const width = a.angle && a.angle > 0 ? r * (1 - Math.cos((Math.min(180, a.angle) * Math.PI) / 180)) : Math.max(0.01, a.width) * g.tool.diameter
  const walls = contourPolys(op.stockXY > 0 ? offset(g.region, -op.stockXY) : g.region)
  const centres = contourPolys(g.first)
  const material = inflatePolys(centres, r, 'round', 0.001)
  const plan = planAdaptive(material, centres, walls, { r, target: width, smoothing: Math.max(0, a.smoothing), climb: op.direction === 'climb', helixPct: op.helixPct }, ctx.work)
  tp.warnings.push(...plan.warnings)
  if (!plan.items.length) {
    tp.warnings.push('Adaptive clearing found no place for its entry helix.')
    return
  }
  const boost = Math.max(1, a.feedBoost || 1)
  const lift = Math.max(0, a.lift)
  const sections: NonNullable<Toolpath['sections']> = []
  g.depths.forEach((d, pi) => {
    const z = -d
    const prevZ = pi === 0 ? 0 : -g.depths[pi - 1]
    for (const it of plan.items) {
      if (it.k === 'helix') {
        if (b.z < op.levels.rapidZ) b.rapid(b.x, b.y, op.levels.rapidZ)
        b.rapid(it.start.x, it.start.y, op.levels.safeZ)
        b.rapid(it.start.x, it.start.y, Math.max(prevZ, 0) + op.levels.rapidZ)
        helixDown(b, it.c, it.start, it.rho, prevZ, z, op.rampAngle)
      } else if (it.k === 'link') {
        if (it.clear) {
          b.feed(b.x, b.y, z + lift, 'lead')
          b.feed(it.to.x, it.to.y, z + lift, 'lead', boost)
          b.feed(it.to.x, it.to.y, z, 'lead')
        } else {
          b.rapid(b.x, b.y, op.levels.rapidZ)
          b.rapid(it.to.x, it.to.y, op.levels.safeZ)
          b.rapid(it.to.x, it.to.y, Math.max(prevZ, 0) + op.levels.rapidZ)
          b.feed(it.to.x, it.to.y, z, 'plunge')
        }
      } else {
        const from = b.moves.length
        it.pts.forEach((p, i) => b.feed(p.x, p.y, z, 'cut', boost > 1 ? Math.min(boost, Math.max(1, width / Math.max(1e-9, it.load[i]))) : undefined))
        if (it.trochoidal) sections.push({ kind: 'trochoidal', from, to: b.moves.length })
      }
    }
  })
  b.rapid(b.x, b.y, op.levels.safeZ)
  if (sections.length) {
    tp.sections = sections
    tp.warnings.push(`${sections.length / g.depths.length} narrow place(s) cleared with trochoidal loops.`)
  }
  tp.warnings.push(`Adaptive clearing holds a ${width.toFixed(2)} mm width of cut. It is not written to woodWOP yet; simulate it.`)
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
  if (Rf <= 1e-6) return { segs, closed: false }
  // Half-turns alternate sides of the centre; each one grows the radius by half a stepover.
  let rr = 0
  let side = 1
  while (rr < Rf - 1e-9) {
    const nr = Math.min(Rf, rr + step / 2)
    const a = { x: C.x + side * rr, y: C.y }
    const e = { x: C.x - side * nr, y: C.y }
    if (dist(a, e) > 1e-9) segs.push(arc(a, e, { x: (a.x + e.x) / 2, y: C.y }, true))
    rr = nr
    side = -side
  }
  const last = segs.length ? segs[segs.length - 1].b : { x: C.x + Rf, y: C.y }
  const opp = { x: 2 * C.x - last.x, y: C.y }
  segs.push(arc(last, opp, C, true), arc(opp, last, C, true))
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
    const type = face === 1 || face === 6 ? 'drill-vertical' : 'drill-horizontal'
    const tool = op.toolId ? (machine.tools.find((t) => t.id === op.toolId) ?? null) : (resolveTool(op, machine, { diameter: d }) ?? machine.tools.find((t) => t.type === type && Math.abs(t.diameter - d) < 0.01) ?? null)
    const vertical = face === 1 || face === 6
    if (!tool) tp.warnings.push(`No ${vertical ? 'vertical' : 'horizontal'} drill D${d} in the tool table.`)
    if (face === 6) {
      tp.warnings.push(`${list.length} hole(s) on face 6 (underside) go into a separate program run after the part is turned over end for end.`)
      for (const h of list) {
        const through = op.levels.through || h.depth >= T - 1e-9
        const depth = through ? T + machine.throughDepth : h.depth
        tp.intents.push({ k: 'vdrill', x: h.x, y: h.y, d, depth: Math.round(depth * 1000) / 1000, through, tool, label: op.name, back: true })
      }
      continue
    }
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
        if (op.cycle === 'peck' && (op.peckFactor ?? 1) < 1) {
          b.rapid(h.x, h.y, op.levels.rapidZ)
          let at = 0
          let peck = Math.max(0.1, op.peck)
          while (at < depth - 1e-9) {
            const next = Math.min(depth, at + peck)
            b.feed(h.x, h.y, -next, 'plunge')
            at = next
            if (at < depth - 1e-9) b.rapid(h.x, h.y, op.retract === 'partial' ? -at + 1 : op.levels.rapidZ)
            peck = Math.max(op.minPeck ?? 1, peck * (op.peckFactor ?? 1))
          }
          b.rapid(h.x, h.y, op.levels.rapidZ)
        } else b.drill(h.x, h.y, -depth, op.levels.rapidZ, op.cycle === 'peck' ? op.peck : 0, op.dwell)
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
  const depths = depthsFor(op, tp.tool, D)
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

function genSaw(op: SawOp, ctx: GenContext, tp: Toolpath, b: Builder) {
  if (op.saw) return genSawCuts(op, ctx, tp, b)
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

/**
 * Saw cuts with the M2.6 settings (2D-11): run-out from the blade, extend to clear, minimum length,
 * joined collinear lines, kept inside the part. The moves follow the floor of each cut.
 */
function genSawCuts(op: SawOp, ctx: GenContext, tp: Toolpath, b: Builder) {
  const st = op.saw!
  const tool = tp.tool
  if (!tool) tp.warnings.push('No saw unit in the tool table.')
  const kerf = tool?.kerf ?? 4
  const placeholderBlade = !st.blade && !tool?.bladeDiameter
  const R = (st.blade || tool?.bladeDiameter || PLACEHOLDER_BLADE) / 2
  if (placeholderBlade) tp.warnings.push(`${tool ? `T${tool.number} has` : 'The saw has'} no blade diameter: a PLACEHOLDER Ø${PLACEHOLDER_BLADE} mm blade is assumed for the run-out. Set the real blade on the Machine page.`)
  if (op.levels.through) tp.warnings.push('A saw cut right through the panel: check the spoilboard allowance.')
  const D = totalDepth(op, ctx)
  const lines: { a: P; b: P }[] = []
  let arcs = 0
  for (const { contours } of geometryOf(op, ctx.part))
    for (const c of contours)
      for (const sg of c.segs) {
        if (sg.k === 'L') lines.push({ a: sg.a, b: sg.b })
        else arcs++
      }
  if (arcs) tp.warnings.push(`Saw cuts follow straight lines only; ${arcs} arc(s) were skipped.`)
  const outline = toPoints(partOutline(ctx.base ?? ctx.part).contour, 0.01)
  const plan = planSawCuts(lines, { R, depth: D, tilt: st.tilt, tiltSide: st.tiltSide, clear: st.clear, extend: Math.max(0, st.extend), minLength: Math.max(0, st.minLength), join: st.join, avoid: st.avoid, outline })
  tp.warnings.push(...plan.warnings)
  for (const c of plan.cuts) {
    const pts = cutFloor(c, R, st.tilt)
    const S = pts[0]
    b.rapid(S.x, S.y, op.levels.safeZ)
    b.rapid(S.x, S.y, op.levels.rapidZ)
    b.feed(S.x, S.y, 0, 'plunge')
    // the run-out arc down, the full-depth run, the arc up
    const n = (pts.length - 2) / 2
    pts.slice(1).forEach((p, i) => b.feed(p.x, p.y, p.z, i + 1 <= n ? 'plunge' : i + 1 === n + 1 ? 'cut' : 'lead'))
    b.rapid(b.x, b.y, op.levels.safeZ)
    if (!st.tilt) tp.intents.push({ k: 'saw', xa: c.a.x, ya: c.a.y, xe: c.b.x, ye: c.b.y, width: kerf, depth: D, tool, label: op.name, runout: Math.round(plan.runout * 1000) / 1000 })
  }
  tp.saw = { r: R, kerf, tilt: st.tilt, runout: plan.runout, placeholderBlade, cuts: plan.cuts }
  if (st.tilt) {
    tp.noOutput = `angled saw cuts (${st.tilt}°): the woodWOP form for a tilted blade is not confirmed`
    tp.warnings.push('The simulator shows an angled cut as if the material above the blade were cut too (it sees the stock from above only).')
  }
}

/**
 * Facing (2D-16): back-and-forth lines (plus a pass round the edge) or rings from the outside in,
 * over the picked closed shapes or the whole outline, `levels.depth` down in passes.
 */
function genFace(op: FaceOp, ctx: GenContext, tp: Toolpath, b: Builder) {
  const tool = tp.tool
  if (!tool) {
    tp.warnings.push('No flat router for facing.')
    return
  }
  const r = tool.diameter / 2
  const closed = geometryOf(op, ctx.part).flatMap((g) => g.contours.filter((c) => c.closed))
  const boundary = normaliseWinding(closed.length ? closed : [partOutline(ctx.base ?? ctx.part).contour]).filter((c) => area(c) > 0)
  if (!boundary.length) {
    tp.warnings.push('Facing needs a closed shape (or the part outline).')
    return
  }
  if (op.levels.through) tp.warnings.push('Facing never cuts through: the depth is used.')
  const D = Math.max(0, op.levels.depth - op.levels.stockZ)
  if (!(D > 0)) {
    tp.warnings.push('Facing depth is 0: nothing to cut.')
    return
  }
  if (D >= ctx.part.thickness - 1e-9) {
    tp.warnings.push(`Facing ${D} mm takes the whole ${ctx.part.thickness} mm panel: nothing is cut.`)
    return
  }
  const centre = Math.abs(op.overhang) > 1e-9 ? offset(boundary, op.overhang) : boundary
  if (!centre.length) {
    tp.warnings.push('The boundary is gone after the overhang.')
    return
  }
  const depths = depthsFor(op, tool, D)
  const step = Math.max(0.05, op.stepover * tool.diameter)
  const orient = (c: Contour) => (op.direction === 'climb' ? (area(c) > 0 ? c : reverse(c)) : area(c) > 0 ? reverse(c) : c)
  const rings: Contour[] = []
  if (op.pattern === 'offset')
    for (let i = 0; i < 4000; i++) {
      const next = i ? offset(centre, -i * step) : centre
      if (!next.length) break
      rings.push(...next.map(orient))
    }
  const paths = op.pattern === 'offset' ? rings : [...zigzag(centre, step, op.angle), ...centre.map(orient)]
  const ramp = tool.centreCutting === false || (tool.maxPlunge !== undefined && tool.maxPlunge > 0 && depths[0] > tool.maxPlunge + 1e-9)
  if (ramp) tp.warnings.push(`T${tool.number} cannot plunge that deep: each pass ramps in along its first line.`)
  const slack = offset(centre, 0.01)
  depths.forEach((d, pi) => {
    const z = -d
    const prevZ = pi === 0 ? 0 : -depths[pi - 1]
    // one woodWOP contour per stretch the tool stays down (a lone ring stays a closed contour)
    let run: Seg[] = []
    let pieces = 0
    let lone = false
    const flush = () => {
      if (run.length) tp.intents.push({ k: 'contour', segs: run, closed: pieces === 1 && lone, rk: 'NOWRK', approach: 'SEN', ramp, tool, label: op.name, passes: [{ depth: d, from: 0, to: run.length - 1 }], reach: r })
      run = []
      pieces = 0
    }
    let started = false
    for (const c0 of paths) {
      const c = started && c0.closed ? rotateToNearest(c0, { x: b.x, y: b.y }) : c0
      const S = startOf(c)
      // stay down when the link runs inside the faced area (checked every 2 mm): it is all cut anyway
      const near = started && Math.hypot(S.x - b.x, S.y - b.y) <= Math.max(step * 1.6, 4 * r) + 1e-6 && linkWithin(slack, { x: b.x, y: b.y }, S)
      if (near) {
        run.push(line({ x: b.x, y: b.y }, S))
        b.feed(S.x, S.y, z)
      } else {
        flush()
        b.rapid(b.x, b.y, op.levels.rapidZ)
        b.rapid(S.x, S.y, op.levels.safeZ)
        b.rapid(S.x, S.y, Math.max(prevZ, 0) + op.levels.rapidZ)
        if (ramp) {
          const need = Math.abs(z - prevZ) / Math.tan((5 * Math.PI) / 180)
          b.feed(S.x, S.y, prevZ, 'plunge')
          b.ramp(sliceByLength(c, 0, Math.min(contourLength(c), need)), prevZ, z)
          b.feed(S.x, S.y, z, 'cut')
        } else b.feed(S.x, S.y, z, 'plunge')
      }
      started = true
      for (const sg of c.segs) b.seg(sg, z)
      run.push(...c.segs)
      pieces++
      lone = c.closed
    }
    flush()
    b.rapid(b.x, b.y, op.levels.safeZ)
  })
  tp.warnings.push(`The cutter reaches ${(r + Math.max(0, op.overhang)).toFixed(1)} mm past the facing boundary${closed.length ? '' : ' (the panel edge)'}: on a nested sheet the export checker keeps it off neighbouring parts.`)
}

/** A shape to chamfer: a 2D contour at a height (0 = face 1; a level 3D edge at its own height). */
function chamferShapes(op: ChamferOp, ctx: GenContext, tp: Toolpath): { c: Contour; h: number }[] {
  const out: { c: Contour; h: number }[] = []
  let tilted = 0
  for (const { e, contours } of geometryOf(op, ctx.part)) {
    if (e.face !== 1) continue
    if (e.g.t === 'poly3d') {
      const pts = e.g.pts
      if (pts.length < 2) continue
      const zs = pts.map((p) => p[2])
      if (Math.max(...zs) - Math.min(...zs) > 0.01) {
        tilted++
        continue
      }
      const first = pts[0]
      const last = pts[pts.length - 1]
      const closed = pts.length > 2 && Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.01
      const plan = (closed ? pts.slice(0, -1) : pts).map(([x, y]) => ({ x, y }))
      out.push({ c: polyline(plan, closed), h: zs.reduce((n, z) => n + z, 0) / zs.length })
    } else for (const c of contours) if (c.segs.length) out.push({ c, h: 0 })
  }
  if (tilted) tp.warnings.push(`${tilted} 3D edge(s) are not level and were left out: a chamfer runs along a level edge.`)
  return out
}

/**
 * Chamfer (2D-13): the V cutter's flank lies on the bevel. For a cutter of half-angle a, a chamfer
 * w wide is w / tan(a) deep; the tip runs `tipOffset` below the bottom of the bevel and that much
 * x tan(a) to the waste side of the edge, so the flank (not the point) cuts it.
 */
function genChamfer(op: ChamferOp, ctx: GenContext, tp: Toolpath, b: Builder) {
  const tool = tp.tool
  if (!tool || tool.shape !== 'v' || !(tool.angle && tool.angle > 0 && tool.angle < 180)) {
    tp.warnings.push('Chamfers need a V cutter (shape "v" with an included angle) in the tool table.')
    return
  }
  const tan = Math.tan(((tool.angle / 2) * Math.PI) / 180)
  const d = op.drive === 'width' ? Math.max(0, op.size) / tan : Math.max(0, op.size)
  if (!(d > 0)) {
    tp.warnings.push('Chamfer size is 0: nothing to cut.')
    return
  }
  const c = Math.max(0, op.tipOffset)
  const R = tool.diameter / 2
  if ((d + c) * tan > R + 1e-9) {
    tp.warnings.push(`A chamfer ${(d * tan).toFixed(2)} wide x ${d.toFixed(2)} deep (tip ${c} mm lower) needs ${((d + c) * tan).toFixed(2)} mm of cutter radius; T${tool.number} has ${R} mm. Use a larger V cutter or a smaller chamfer.`)
    return
  }
  const off = c * tan
  const depths = depthsFor(op, tool, d)
  const shapes = chamferShapes(op, ctx, tp)
  if (!shapes.length) tp.warnings.push('Pick the edges to chamfer: shapes on face 1 or level 3D edges.')
  for (const { c: c0, h } of shapes) {
    let g = c0
    let path: Contour | null
    if (g.closed) {
      const outside = op.side === 'outside' || op.side === 'left'
      const wantCw = outside ? op.direction === 'climb' : op.direction !== 'climb'
      if (wantCw !== area(g) < 0) g = reverse(g)
      g = startAtLength(g, defaultStart(g))
      if (off > 1e-9) {
        const res = offset([g], outside ? off : -off, 'round')
        path = res.length ? rotateToNearest(area(res[0]) < 0 === area(g) < 0 ? res[0] : reverse(res[0]), startOf(g)) : null
      } else path = g
    } else {
      let left = op.side === 'left' || op.side === 'outside'
      if (op.direction === 'conventional') {
        g = reverse(g)
        left = !left
      }
      path = off > 1e-9 ? offsetChain(g, left ? off : -off) : g
    }
    if (!path || !path.segs.length) {
      tp.warnings.push('A shape is too small for the tip offset and was left out.')
      continue
    }
    const S = startOf(path)
    const top = Math.max(0, h)
    for (const dk of depths) {
      const z = h - (dk + c)
      b.rapid(S.x, S.y, op.levels.safeZ + top)
      b.rapid(S.x, S.y, top + op.levels.rapidZ)
      b.feed(S.x, S.y, z, 'plunge')
      for (const sg of path.segs) b.seg(sg, z)
      b.rapid(b.x, b.y, top + op.levels.rapidZ)
    }
    tp.intents.push({ k: 'contour', segs: path.segs, closed: path.closed, rk: 'NOWRK', approach: 'SEN', ramp: false, tool, label: op.name, passes: depths.map((dk) => ({ depth: Math.round((dk + c - h) * 1e6) / 1e6, from: 0, to: path!.segs.length - 1 })) })
  }
  b.rapid(b.x, b.y, op.levels.safeZ)
  if (shapes.length) tp.warnings.push(`Chamfer ${(d * tan).toFixed(2)} mm wide and ${d.toFixed(2)} mm deep with T${tool.number} (${tool.angle}°).`)
}

const EDGE_NO_OUTPUT = 'edge work with a rotating aggregate has no confirmed woodWOP macro'

/**
 * Edge work with a rotating aggregate (5AX-04): the tool lies flat with its axis `height` below
 * face 1 and square to the edge; the aggregate turns so it stays square while the tip runs `reach`
 * inside the picked shapes (the outline by default), in passes. It comes in from 2 mm outside the
 * edge and goes back out the same way. Simulated only: the heightfield sees the stock from above, so
 * the cut under the surface is drawn, not carved.
 */
function genEdge(op: EdgeOp, ctx: GenContext, tp: Toolpath, b: Builder) {
  tp.noOutput = EDGE_NO_OUTPUT
  const tool = tp.tool
  if (!tool) {
    tp.warnings.push('No router for the aggregate.')
    return
  }
  if (!machineModelOf(ctx.machine).capabilities.aggregate) tp.warnings.push('The machine model has no rotating aggregate: this is simulated only, and the export checker refuses it.')
  const r = tool.diameter / 2
  const reach = Math.max(0, op.reach)
  const flute = tool.fluteLength ?? tool.maxDepth
  if (!(reach > 0)) {
    tp.warnings.push('Reach into the edge is 0: nothing to cut.')
    return
  }
  if (reach > flute + 1e-9) {
    tp.warnings.push(`Reach ${reach} mm is more than T${tool.number} cuts (${flute} mm): the aggregate would hit the edge.`)
    return
  }
  const T = ctx.part.thickness
  if (op.height - r < -1e-9) tp.warnings.push(`The tool reaches ${(r - op.height).toFixed(2)} mm above face 1: the cut is open to the top.`)
  if (op.height + r > T + 1e-9) tp.warnings.push(`The tool reaches ${(op.height + r - T).toFixed(2)} mm below the underside: check the spoilboard.`)
  const z = -op.height
  const picked = geometryOf(op, ctx.part).flatMap((g) => g.contours.filter((c) => c.segs.length))
  const shapes = picked.length ? picked : [partOutline(ctx.base ?? ctx.part).contour]
  const reaches = op.reachPass > 0 ? passDepths(reach, op.reachPass) : [reach]
  const left = op.direction === 'climb'
  const lv = op.levels
  // head angles the cut needs (the tool pointing into the material), for the aggregate's allowed angles
  const needed = new Set<number>()
  const headAngle = (q: P) => Math.round(((Math.atan2(left ? q.x : -q.x, left ? -q.y : q.y) * 180) / Math.PI + 360) % 360 * 10) / 10
  for (const g0 of shapes) {
    let g = g0
    if (g.closed && left !== area(g) > 0) g = reverse(g)
    if (g.closed) g = startAtLength(g, defaultStart(g))
    for (const rk of reaches) {
      let path: Contour | null
      if (g.closed) {
        // material on the left of travel when the shape runs counter-clockwise
        const res = offset([g], -rk, 'round')
        path = res.length ? rotateToNearest(area(res[0]) > 0 === area(g) > 0 ? res[0] : reverse(res[0]), startOf(g)) : null
      } else {
        const t0 = tangentAt(g.segs[0], 0)
        const t1 = tangentAt(g.segs[g.segs.length - 1], 1)
        const ext: Contour = { closed: false, segs: [line(sub(startOf(g), mul(t0, op.overrun)), startOf(g)), ...g.segs, line(endOf(g), add(endOf(g), mul(t1, op.overrun)))].filter((sg) => segLength(sg) > 1e-9) }
        path = offsetChain(ext, left ? rk : -rk)
      }
      if (!path || !path.segs.length) {
        tp.warnings.push(`A shape is too small for ${rk} mm of reach and was left out.`)
        continue
      }
      const S = startOf(path)
      const E = endOf(path)
      const t = tangentAt(path.segs[0], 0)
      const te = tangentAt(path.segs[path.segs.length - 1], 1)
      // out of the material: the side away from it, square to the path
      const out = (q: P) => (left ? { x: q.y, y: -q.x } : { x: -q.y, y: q.x })
      const A = add(S, mul(out(t), rk + 2))
      const B = add(E, mul(out(te), rk + 2))
      b.rapid(A.x, A.y, lv.safeZ)
      b.feed(A.x, A.y, z, 'lead')
      b.feed(S.x, S.y, z, 'plunge')
      for (const sg of path.segs) {
        b.seg(sg, z)
        const n = sg.k === 'A' ? Math.max(1, Math.ceil(Math.abs(sweep(sg)) / (Math.PI / 180))) : 1
        for (let i = 0; i <= n; i++) needed.add(headAngle(tangentAt(sg, i / n)))
      }
      b.feed(B.x, B.y, z, 'lead')
      b.feed(B.x, B.y, lv.safeZ, 'lead')
    }
  }
  tp.edge = { height: op.height, r, flute, side: left ? 'left' : 'right' }
  const agg = aggregateOf(ctx.machine, tool)
  // no aggregate given for the tool: the editor says the housing and angles are not checked
  if (!agg) return
  const g = effectiveGauge(ctx.machine, tool)
  tp.edge.housing = { ...agg.housing, gauge: g.gauge, offset: agg.offset }
  const margin = ctx.machine.collisionMargin ?? DEFAULT_COLLISION_MARGIN
  const off = anglesOutOfReach(agg, [...needed].sort((a, c) => a - c))
  if (off.length) tp.warnings.push(`The aggregate “${agg.name}” cannot be turned to ${off.length} of the angles this cut needs (e.g. ${off.slice(0, 3).map((a) => `${a}°`).join(', ')}): it only sets ${agg.angles.mode === 'list' ? agg.angles.list.join(', ') + '°' : 'any angle'}.`)
  // the housing starts at the tool's gauge face: (stick-out - reach) outside the edge
  const clear = g.gauge - reach
  const lo = -op.height - agg.housing.below
  const hi = -op.height + agg.housing.above
  if (clear < margin && lo < margin && hi > -T - margin)
    tp.warnings.push(`The aggregate's housing would hit the panel's edge: T${tool.number} sticks out ${g.gauge} mm${g.assumed ? ' (assumed = flute length)' : ''} and goes ${reach} mm in, so the housing comes within ${clear.toFixed(1)} mm of the edge (margin ${margin} mm).`)
  if (lo < -T + margin) tp.warnings.push(`The aggregate's housing reaches ${(-lo).toFixed(1)} mm below face 1, ${(-T - lo).toFixed(1)} mm below the part's underside: it would hit the spoilboard (margin ${margin} mm).`)
}

const CURVE_NO_OUTPUT = 'curve cuts move the tool up and down along the path, which needs true 3D output (off until the format is confirmed)'

/** Tool-tip chains as 3D moves: down to each chain's start, along it, up again. */
function emitChains(chains: Chain3[], op: CamOp, b: Builder) {
  for (const ch of chains) {
    if (ch.length < 2) continue
    const [x0, y0, z0] = ch[0]
    const top = Math.max(0, ...ch.map((p) => p[2]))
    b.rapid(x0, y0, op.levels.safeZ + top)
    b.rapid(x0, y0, top + op.levels.rapidZ)
    b.feed(x0, y0, z0, 'plunge')
    const pts = new Float64Array((ch.length - 1) * 3)
    for (let i = 1; i < ch.length; i++) pts.set(ch[i], (i - 1) * 3)
    b.moves.push({ t: 'poly', pts, f: 'cut' })
    const [x1, y1, z1] = ch[ch.length - 1]
    Object.assign(b, { x: x1, y: y1, z: z1 })
    b.rapid(x1, y1, top + op.levels.rapidZ)
  }
  b.rapid(b.x, b.y, op.levels.safeZ)
}

/** Curve cuts (2D-15): between two curves, along 3D curves, Z-waves. All true 3D: simulated, not written. */
function genCurve(op: CurveOp, ctx: GenContext, tp: Toolpath, b: Builder) {
  const tool = tp.tool
  if (!tool) {
    tp.warnings.push('No router for this curve cut.')
    return
  }
  const shapes = geometryOf(op, ctx.part).filter(({ e }) => e.face === 1)
  const tol = Math.max(0.001, op.tolerance || 0.01)
  let chains: Chain3[] = []
  if (op.mode === 'between') {
    const ct = cutterOfTool(tool)
    if ('error' in ct) {
      tp.warnings.push(ct.error)
      return
    }
    if (shapes.length < 2) {
      tp.warnings.push('Pick two curves: the first and second picked shapes (2D shapes or 3D polylines).')
      return
    }
    if (shapes.length > 2) tp.warnings.push('Only the first two picked shapes are used.')
    const curve = ({ e, contours }: (typeof shapes)[number], depth: number): { pts: [number, number, number][]; closed: boolean } | null => {
      if (e.g.t === 'poly3d') {
        const p = e.g.pts
        const closed = p.length > 2 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1], p[0][2] - p[p.length - 1][2]) < 0.01
        return { pts: p.map((q) => [...q] as [number, number, number]), closed }
      }
      const c = contours.find((k) => k.segs.length)
      if (!c) return null
      const pts = toPoints(c, tol).map((q) => [q.x, q.y, -depth] as [number, number, number])
      return { pts: c.closed ? [...pts, pts[0]] : pts, closed: c.closed }
    }
    const A = curve(shapes[0], op.depthA)
    const B = curve(shapes[1], op.depthB)
    if (!A || !B) {
      tp.warnings.push('A picked shape has no curve to use.')
      return
    }
    if (A.closed !== B.closed) tp.warnings.push('One curve is closed and the other open: both are treated as open.')
    const r = betweenCurves(A.pts, B.pts, A.closed && B.closed, ct.cutter, { stepover: op.stepover, zigzag: op.zigzag, tol })
    tp.warnings.push(...r.warnings)
    chains = r.chains
  } else if (op.mode === 'follow3d') {
    const lines = shapes.filter(({ e }) => e.g.t === 'poly3d')
    if (!lines.length) {
      tp.warnings.push('Pick 3D polylines to follow (made in the 3D tab, or from the edges of a solid).')
      return
    }
    if (lines.length < shapes.length) tp.warnings.push(`${shapes.length - lines.length} picked shape(s) are not 3D polylines and were left out.`)
    const D = Math.max(0, op.levels.depth)
    const depths = D > 0 ? depthsFor(op, tool, D) : [0]
    for (const { e } of lines) {
      const p = (e.g as { pts: [number, number, number][] }).pts
      if (p.length < 2) continue
      const closed = p.length > 2 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1], p[0][2] - p[p.length - 1][2]) < 0.01
      const path = op.smooth ? smooth3(closed ? p.slice(0, -1) : p, closed, tol) : p.map((q) => [...q] as [number, number, number])
      for (const dk of depths) chains.push(path.map(([x, y, z]) => [x, y, z - dk]))
    }
  } else {
    const w = op.wave
    if (!(w.length > 0)) {
      tp.warnings.push('Z-wave length must be more than 0.')
      return
    }
    const deepest = Math.max(w.min, w.max)
    const floors = op.levels.passDepth > 0 || op.levels.cuts ? depthsFor(op, tool, deepest) : [deepest]
    for (const { contours } of shapes)
      for (const c of contours) {
        if (!c.segs.length) continue
        const zw = zWave(toPoints(c, tol), c.closed, w, tol)
        if (c.closed && Math.abs(zw.length - w.length) > 1e-6) tp.warnings.push(`A closed shape gets a whole number of waves: ${zw.length.toFixed(2)} mm each.`)
        for (const f of floors) chains.push(zw.chain.map(([x, y, z]) => [x, y, Math.max(z, -f)]))
      }
    if (!chains.length) tp.warnings.push('Pick the shapes to turn into a Z-wave.')
  }
  emitChains(chains, op, b)
  let minZ = Infinity
  for (const ch of chains) for (const p of ch) minZ = Math.min(minZ, p[2])
  if (Number.isFinite(minZ)) {
    const flute = tool.fluteLength ?? tool.maxDepth
    if (-minZ > flute + 1e-9) tp.warnings.push(`Cuts ${(-minZ).toFixed(2)} mm below face 1 but T${tool.number} cuts only ${flute} mm deep: check in simulation.`)
    if (minZ < -ctx.part.thickness - 1e-9) tp.warnings.push(`Goes ${(-minZ - ctx.part.thickness).toFixed(2)} mm below the part's underside.`)
  }
  tp.noOutput = CURVE_NO_OUTPUT
}

/**
 * Hand-drawn toolpath (NEW-09): to the start from the safe height, then the steps as picked. Runs of
 * cutting steps at one depth are written to woodWOP as contour passes (a straight-down plunge at
 * the start of a run is woodWOP's own approach); a run that changes depth while it cuts cannot be.
 */
function genManual(op: ManualOp, _ctx: GenContext, tp: Toolpath, b: Builder) {
  if (!op.steps.length) {
    tp.warnings.push('Draw the toolpath: pick feed lines, arcs and rapids on the drawing.')
    return
  }
  const lv = op.levels
  const s0 = op.start
  b.rapid(s0.x, s0.y, lv.safeZ)
  if (s0.z < lv.rapidZ) {
    b.rapid(s0.x, s0.y, lv.rapidZ)
    b.feed(s0.x, s0.y, s0.z, 'plunge')
  } else b.rapid(s0.x, s0.y, s0.z)
  let run: Seg[] = []
  let runZ = NaN
  let varying = false
  let rapidsIn = 0
  let bent = 0
  const flush = () => {
    if (run.length && runZ < -1e-9) tp.intents.push({ k: 'contour', segs: run, closed: Math.hypot(run[0].a.x - run[run.length - 1].b.x, run[0].a.y - run[run.length - 1].b.y) < 1e-6, rk: 'NOWRK', approach: 'SEN', ramp: false, tool: tp.tool, label: op.name, passes: [{ depth: Math.round(-runZ * 1e6) / 1e6, from: 0, to: run.length - 1 }] })
    run = []
    runZ = NaN
  }
  for (const st of op.steps) {
    const from = { x: b.x, y: b.y, z: b.z }
    if (st.k === 'rapid') {
      flush()
      if (st.z < -1e-9) rapidsIn++
      b.rapid(st.x, st.y, st.z)
      continue
    }
    const vertical = Math.hypot(st.x - from.x, st.y - from.y) < 1e-9
    if (vertical) {
      // straight down (or up) at the start or end of a run: the approach, not part of the contour
      if (run.length) flush()
      b.feed(st.x, st.y, st.z, st.z < from.z ? 'plunge' : 'lead')
      continue
    }
    if (!run.length) runZ = from.z
    if (Math.abs(st.z - runZ) > 1e-9 || Math.abs(from.z - runZ) > 1e-9) varying = true
    if (st.k === 'arc') {
      const ra = Math.hypot(from.x - st.cx, from.y - st.cy)
      const rb = Math.hypot(st.x - st.cx, st.y - st.cy)
      if (Math.abs(ra - rb) > 0.01 || ra < 1e-6) {
        bent++
        run.push(line(from, st))
        b.feed(st.x, st.y, st.z)
        continue
      }
      run.push(arc(from, { x: st.x, y: st.y }, { x: st.cx, y: st.cy }, st.ccw))
      b.moves.push({ t: 'arc', x: st.x, y: st.y, z: st.z, cx: st.cx, cy: st.cy, ccw: st.ccw, f: 'cut' })
      Object.assign(b, { x: st.x, y: st.y, z: st.z })
    } else {
      run.push(line(from, st))
      b.feed(st.x, st.y, st.z)
    }
  }
  flush()
  b.rapid(b.x, b.y, lv.safeZ)
  if (rapidsIn) tp.warnings.push(`${rapidsIn} rapid(s) go below face 1: rapids through material are collisions. Check in the simulation.`)
  if (bent) tp.warnings.push(`${bent} arc(s) do not fit their centre and were cut as straight lines.`)
  if (varying) {
    tp.intents = []
    tp.noOutput = 'the hand-drawn toolpath changes depth while it cuts, which woodWOP contour passes cannot carry'
  }
}

/** Contour, pocket and saw intents of a reversed toolpath: the other way round and in reverse order. */
function reverseIntents(intents: Intent[]): Intent[] {
  const flip = (rk: 'WRKL' | 'WRKR' | 'NOWRK') => (rk === 'WRKL' ? 'WRKR' : rk === 'WRKR' ? 'WRKL' : rk)
  return [...intents].reverse().map((it) => {
    if (it.k === 'contour') {
      const n = it.segs.length
      return { ...it, segs: reverse({ segs: it.segs, closed: it.closed }).segs, rk: flip(it.rk), passes: it.passes.map((p) => ({ ...p, from: n - 1 - p.to, to: n - 1 - p.from })) }
    }
    if (it.k === 'pocket-rect') return { ...it, ccw: !it.ccw }
    if (it.k === 'saw') return { ...it, xa: it.xe, ya: it.ye, xe: it.xa, ye: it.ya }
    return it
  })
}

/** Edits that change the moves (anything but pocket start points, which act while generating). */
export const hasMoveEdits = (e: ToolpathEdits | undefined) => !!e && (!!e.corners || !!e.feeds?.length || !!e.z?.length || e.rapidHeight !== undefined || !!e.reverse)

/** Apply an operation's toolpath edits (NEW-11) to its calculated toolpath. */
function editToolpath(tp: Toolpath, op: CamOp): Toolpath {
  const e = op.edits!
  const base = movesHash(simpleMoves(tp.moves))
  const r = applyEdits(tp.moves, e, op.levels, tp.tool)
  const out: Toolpath = { ...tp, moves: r.moves, warnings: [...tp.warnings, ...r.warnings], edited: { base, applied: r.applied, moved: r.moved, lost: r.lost, reversed: r.reversed } }
  if (r.reversed) out.intents = reverseIntents(tp.intents)
  if (r.lost) out.noOutput = `${r.lost} toolpath edit(s) no longer match the recalculated toolpath; open the operation and keep or clear them`
  else if (r.zEdited && !out.noOutput && out.intents.some((it) => it.k !== 'comment')) out.noOutput = 'heights were edited point by point, and the woodWOP macros cannot carry them'
  out.stats = stats(out.moves, out.feeds.feed)
  return out
}

/**
 * Re-set stock top (2D-16): a toolpath made for the panel below a faced top is moved down by
 * `top`, so its depths count from the faced surface.
 */
function shiftTop(tp: Toolpath, top: number): Toolpath {
  const moves: Move[] = tp.moves.map((m) => {
    if (m.t === 'poly') {
      const pts = Float64Array.from(m.pts)
      for (let i = 2; i < pts.length; i += 3) pts[i] -= top
      return { ...m, pts }
    }
    if (m.t === 'drill') return { ...m, z: m.z - top, r: m.r - top }
    return { ...m, z: m.z - top }
  })
  const deeper = (n: number) => Math.round((n + top) * 1e6) / 1e6
  const intents: Intent[] = tp.intents.map((it) => {
    switch (it.k) {
      case 'contour':
        return { ...it, passes: it.passes.map((p) => ({ ...p, depth: deeper(p.depth) })) }
      case 'vdrill':
      case 'pocket-rect':
      case 'saw':
        return { ...it, depth: deeper(it.depth) }
      default:
        return it
    }
  })
  return {
    ...tp,
    moves,
    intents,
    top,
    ...(tp.saw ? { saw: { ...tp.saw, cuts: tp.saw.cuts.map((c) => ({ ...c, depth: deeper(c.depth) })) } } : {}),
    warnings: [...tp.warnings, `Depths count from the faced top, ${top} mm below face 1.`],
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
  for (let wc = r; wc <= maxInset + r + 1e-9; wc += Math.max(0.1, op.step)) {
    let depth = Infinity
    for (let k = 0; k <= 8; k++) depth = Math.min(depth, sectionDepth(op.section, wc - r + (2 * r * k) / 8))
    if (depth <= 0.01) continue
    const rings = offset(guide, sign * wc)
    for (const c of rings) {
      const ds = depthsFor(op, tool, depth)
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
// 3D finishing
// ---------------------------------------------------------------------------------------------

/** 3D operation kinds: they need a model's mesh. */
export const OPS_3D: ReadonlySet<CamOp['kind']> = new Set(['finish3d', 'rough3d'])

/**
 * Adaptive clearing: a pocket with the adaptive pattern (rest machining wins over it), or Z-level
 * roughing with it.
 */
export const isAdaptive = (op: CamOp) => (op.kind === 'pocket' && op.pattern === 'adaptive' && !op.rest) || (op.kind === 'rough3d' && op.pattern === 'adaptive')

/**
 * Operations that can take seconds, so screens calculate them in the compute worker: 3D
 * operations, adaptive clearing, rest machining that follows adaptive clearing, and cuts between
 * two curves (drop-cutter on the surface between them).
 */
export function inBackground(op: CamOp, part: CamPart): boolean {
  if (OPS_3D.has(op.kind) || isAdaptive(op) || (op.kind === 'curve' && op.mode === 'between')) return true
  return op.kind === 'pocket' && !!op.rest && restSources(op, part).some(isAdaptive)
}

/**
 * 3D operations that cut only at constant heights (Z-level roughing; waterline without the
 * shallow-area fill). They can be written to woodWOP as ordinary contour-milling passes, behind
 * their own switch. Everything else in 3D needs true 3D output, which stays off.
 */
export function isFlatLayer(op: CamOp): boolean {
  if (op.kind === 'rough3d') return op.pattern !== 'adaptive'
  if (op.kind !== 'finish3d' || op.strategy !== 'waterline') return false
  return !(op.fillShallow && Math.max(op.slope.min, op.skipFlats ? 0.5 : 0) > 0)
}

/**
 * M2.6 operations that have a woodWOP form (contour passes, saw grooves) but are written only
 * behind their own switch (`cam25dMprOutput`): facing, chamfers, hand-drawn toolpaths, and saw cuts
 * with the M2.6 settings, and any operation whose toolpath was edited.
 */
export function isMore25d(op: CamOp): boolean {
  return op.kind === 'face' || op.kind === 'chamfer' || op.kind === 'manual' || (op.kind === 'saw' && !!op.saw) || (op.kind !== 'code' && (hasMoveEdits(op.edits) || !!op.edits?.starts?.length))
}

/** woodWOP's point limit per contour is not confirmed; contours longer than this get a warning. */
export const CONTOUR_POINT_WARN = 2000

function model3d(op: Finish3dOp | Rough3dOp, ctx: GenContext, tp: Toolpath) {
  const model = ctx.part.models?.find((m) => m.id === op.surface.modelId)
  if (!model) {
    tp.warnings.push('Pick the 3D model this operation machines.')
    return null
  }
  const mesh = ctx.meshes?.get(model.blob)
  if (!mesh) {
    tp.warnings.push(`The 3D model "${model.name}" is not loaded, so no toolpath was calculated.`)
    return null
  }
  const ct = cutterOfTool(tp.tool)
  if ('error' in ct) {
    tp.warnings.push(ct.error)
    return null
  }
  if (model.relief) {
    // a relief stays face up; the panel face round it is part of the surface, so nothing outside
    // its outline is cut below face 1
    if (model.place.up !== '+z' || model.place.frame) {
      tp.warnings.push(`The relief "${model.name}" must stay face up (+Z up) to be machined.`)
      return null
    }
    const outline = placedReliefOutline(model)
    const grow = 2 * (ct.cutter.R + Math.max(0, op.surface.stockToLeave)) + 2
    const relief = placeMesh(mesh, model.place)
    return { placed: mergeMeshes([relief, reliefSurround(outline, ctx.part, grow)], 'Panel face round the relief'), cutter: ct.cutter, outline, box: meshBounds(relief) }
  }
  const placed = placeMesh(mesh, model.place)
  return { placed, cutter: ct.cutter, outline: undefined, box: meshBounds(placed) }
}

/**
 * A 3D operation whose shank or holder would hit the model (plus the stock to leave) is flagged
 * now, with the stick-out or flute length it needs; the simulation checks against the stock too.
 */
function clearanceWarnings(mesh: Mesh, moves: Move[], stock: number, ctx: GenContext, tp: Toolpath) {
  const tool = tp.tool
  if (!tool || !moves.length) return
  const margin = ctx.machine.collisionMargin ?? DEFAULT_COLLISION_MARGIN
  const o = toolOutline(ctx.machine, tool)
  const r = modelClearance(mesh, moves, o, margin, stock, ctx.part)
  const at = (p: { x: number; y: number; z: number }) => `X${p.x.toFixed(1)} Y${p.y.toFixed(1)} Z${p.z.toFixed(1)}`
  if (r.holder)
    tp.warnings.push(`The holder would hit the model from move ${r.holder.move + 1} (${at(r.holder.at)}): T${tool.number} sticks out ${o.gauge} mm and needs at least ${(o.gauge + r.holder.depth).toFixed(1)} mm (with the ${margin} mm margin). Use a longer stick-out or cut less deep.`)
  if (r.shank)
    tp.warnings.push(`The shank would rub the model above the flutes from move ${r.shank.move + 1} (${at(r.shank.at)}): T${tool.number} has ${o.flute} mm of flute and needs at least ${(o.flute + r.shank.depth).toFixed(1)} mm (with the ${margin} mm margin).`)
}

function depthWarnings(minZ: number, ctx: GenContext, tp: Toolpath) {
  const tool = tp.tool!
  if (!Number.isFinite(minZ)) return
  // (a lollipop's neck is meant to be in the cut: its usable depth counts, not its ball)
  const flute = tool.shape === 'lollipop' ? tool.maxDepth : (tool.fluteLength ?? tool.maxDepth)
  if (-minZ > flute + 1e-9) tp.warnings.push(`Cuts ${(-minZ).toFixed(2)} mm below face 1 but T${tool.number} cuts only ${flute} mm deep: the shank or holder may rub. Check in simulation.`)
  if (minZ < -ctx.part.thickness - 1e-9) tp.warnings.push(`Goes ${(-minZ - ctx.part.thickness).toFixed(2)} mm below the part's underside: check the model's placement and the part thickness.`)
}

/** Flat-layer output: every pass of every level as one contour-milling pass at that level's depth. */
function layerIntents(layers: Layer[], tp: Toolpath, label: string, ramp: boolean) {
  let long = 0
  let above = 0
  for (const L of layers) {
    const depth = Math.round(-L.z * 10000) / 10000
    if (depth <= 0) {
      above += L.chains.length
      continue
    }
    for (const c of L.chains) {
      const pts = c.closed ? [...c.pts, c.pts[0]] : c.pts
      if (pts.length > CONTOUR_POINT_WARN) long++
      const segs: Seg[] = pts.slice(1).map((b, i) => line(pts[i], b))
      tp.intents.push({ k: 'contour', segs, closed: c.closed, rk: 'NOWRK', approach: 'SEN', ramp, tool: tp.tool, label: `${label} Z${(-depth).toFixed(2)}`, passes: [{ depth, from: 0, to: segs.length - 1 }] })
    }
  }
  if (above) tp.warnings.push(`${above} pass(es) above face 1 are not written to woodWOP (they cut only where the model stands above the panel).`)
  if (long) tp.warnings.push(`${long} contour(s) have more than ${CONTOUR_POINT_WARN} points: woodWOP's limit per contour is not confirmed yet. Check the program loads on the machine.`)
}

/**
 * Undercut finishing needs a lollipop: its ball reaches under overhangs while its neck (with the
 * collision margin round it) keeps clear of the model.
 */
function undercutOf(op: Finish3dOp, mesh: Mesh, region: Region, ctx: GenContext, tp: Toolpath) {
  const t = tp.tool
  const none = (w: string) => ({ moves: [] as Move[], warnings: [w], minZ: NaN, spacing: 0 })
  if (!t || t.shape !== 'lollipop') return none(`Undercut finishing needs a lollipop tool (a ball on a narrower neck)${t ? `: T${t.number} is not one` : ''}. Add one in the tool table (shape Lollipop, with its neck diameter).`)
  const R = t.diameter / 2
  const neck = (t.shankDiameter ?? t.diameter) / 2
  const margin = ctx.machine.collisionMargin ?? DEFAULT_COLLISION_MARGIN
  if (neck + margin >= R) return none(`T${t.number}'s ball (Ø${t.diameter}) reaches no further than its neck (Ø${t.shankDiameter ?? t.diameter}) and the ${margin} mm collision margin round it, so it cannot get under an overhang.`)
  return undercutFinish(op, mesh, { R, neck: neck + margin }, region, op.levels, ctx.work)
}

/** Scallop start shapes (face 1) as plan polylines; missing ones are reported. */
function scallopStarts(op: Finish3dOp, part: CamPart, tp: Toolpath): { pts: P[]; closed: boolean }[] {
  const out: { pts: P[]; closed: boolean }[] = []
  let missing = 0
  for (const id of op.startFrom ?? []) {
    const e = part.entities.find((x) => x.id === id)
    if (!e || e.face !== 1) {
      missing++
      continue
    }
    for (const c of entityContours(e)) if (c.segs.length) out.push({ pts: toPoints(c, 0.005), closed: c.closed })
  }
  if (missing) tp.warnings.push(`${missing} start shape(s) are missing or not on face 1: the passes start from the rest${out.length ? '' : ' (here: the boundary)'}.`)
  return out
}

function genFinish3d(op: Finish3dOp, ctx: GenContext, tp: Toolpath, b: Builder) {
  const m = model3d(op, ctx, tp)
  if (!m) return
  const cutRegion = (region: Region): Region | null => {
    if (!op.rest || op.strategy === 'projection') return region
    // 3D rest machining: only where the earlier operations, as simulated, left material
    const sources = restSources(op, ctx.part)
    if (!sources.length) {
      tp.warnings.push('Rest machining: there is no earlier milling operation to follow, so nothing is cut.')
      return null
    }
    const paths = sources.map((s) => ctx.done?.get(s.id) ?? generateOp(s, { part: ctx.part, machine: ctx.machine, meshes: ctx.meshes, done: ctx.done }))
    const cell = Math.min(0.25, Math.max(0.05, m.cutter.R / 6))
    const min = Math.max(0.01, op.rest.minThickness)
    // (flat-area finishing only ever cuts flat faces: rest counts there only)
    const ra = restArea(m.placed, paths, ctx.part, { cutter: m.cutter, stock: Math.max(0, op.surface.stockToLeave), min, cell, flatter: op.strategy === 'flat' ? Math.cos((FLAT_DEG * Math.PI) / 180) : undefined })
    if (!ra.rest.length) {
      tp.warnings.push(`Rest machining: the earlier operations left nothing thicker than ${min} mm that this tool can reach.`)
      return null
    }
    tp.warnings.push(`Rest machining: ${ra.area.toFixed(0)} mm² left by the earlier operations that this tool can reach (up to ${ra.thickest.toFixed(2)} mm thick, as simulated).`)
    return { polys: clipPolys('intersect', region.polys, restCentres(ra.rest, m.cutter.R, cell)), fromModel: false }
  }
  if (op.strategy === 'projection') {
    // the picked shapes on face 1 are the pattern; the depth below the surface is cut like engraving
    const paths = geometryOf(op, ctx.part)
      .filter(({ e }) => e.face === 1)
      .flatMap(({ contours }) => contours.filter((c) => c.segs.length).map((c) => ({ pts: toPoints(c), closed: c.closed })))
    const D = Math.max(0, op.levels.depth)
    const r = projectionFinish(op, m.placed, m.cutter, paths, D > 0 ? depthsFor(op, tp.tool, D) : [0], op.levels, ctx.work)
    tp.warnings.push(...r.warnings)
    b.moves.push(...r.moves)
    depthWarnings(r.minZ, ctx, tp)
    clearanceWarnings(m.placed, r.moves, op.surface.stockToLeave, ctx, tp)
    return
  }
  const region = cutRegion(centreRegion(ctx.part, op.geometry, op.surface, m.cutter.R, m.box, m.outline))
  if (!region) return
  if (op.strategy === 'waterline') {
    const r = waterlineFinish(op, m.placed, m.cutter, region, op.levels, ctx.work)
    tp.warnings.push(...r.warnings)
    b.moves.push(...r.moves)
    depthWarnings(r.minZ, ctx, tp)
    clearanceWarnings(m.placed, r.moves, op.surface.stockToLeave, ctx, tp)
    if (isFlatLayer(op)) layerIntents(r.layers, tp, op.name, true)
    return
  }
  const r =
    op.strategy === 'pencil'
      ? pencilFinish(op, m.placed, m.cutter, region, op.levels, ctx.work)
      : op.strategy === 'radial'
        ? radialFinish(op, m.placed, m.cutter, region, op.levels, ctx.work)
        : op.strategy === 'spiral'
          ? spiralFinish(op, m.placed, m.cutter, region, op.levels, ctx.work)
          : op.strategy === 'scallop'
            ? scallopFinish(op, m.placed, m.cutter, region, op.levels, scallopStarts(op, ctx.part, tp), ctx.work)
            : op.strategy === 'flat'
              ? flatAreaFinish(op, m.placed, m.cutter, region, op.levels, ctx.work)
              : op.strategy === 'helical'
                ? helicalFinish(op, m.placed, m.cutter, region, op.levels, ctx.work)
                : op.strategy === 'undercut'
                  ? undercutOf(op, m.placed, region, ctx, tp)
                  : parallelFinish(op, m.placed, m.cutter, region, op.levels, ctx.work)
  tp.warnings.push(...r.warnings)
  b.moves.push(...r.moves)
  depthWarnings(r.minZ, ctx, tp)
  clearanceWarnings(m.placed, r.moves, op.surface.stockToLeave, ctx, tp)
}

function genRough3d(op: Rough3dOp, ctx: GenContext, tp: Toolpath, b: Builder) {
  const m = model3d(op, ctx, tp)
  if (!m) return
  const mb = m.box
  let region = centreRegion(ctx.part, op.geometry, op.surface, m.cutter.R, mb, m.outline)
  // no boundary drawn and the model does not cover the panel (a part standing on its own): the
  // stock round the model is roughed too, down to the model's lowest point. Not for a relief: the
  // panel round a relief is kept.
  const { length: L, width: W } = ctx.part
  const COVER = 0.01
  if (region.fromModel && !m.outline && (mb.min[0] > COVER || mb.min[1] > COVER || mb.max[0] < L - COVER || mb.max[1] < W - COVER)) {
    region = centreRegion(ctx.part, op.geometry, op.surface, m.cutter.R, { min: [Math.min(0, mb.min[0]), Math.min(0, mb.min[1]), mb.min[2]], max: [Math.max(L, mb.max[0]), Math.max(W, mb.max[1]), mb.max[2]] })
    tp.warnings.push(`The model does not cover the whole panel: the panel round it is roughed down to the model's lowest point (${(mb.min[2] + Math.max(0, op.stockZ)).toFixed(2)} mm). Draw a boundary to rough less.`)
  }
  const adaptive = op.pattern === 'adaptive'
  const r = zLevelRough(adaptive ? { ...op, adaptive: op.adaptive ?? DEFAULT_ADAPTIVE } : op, m.placed, m.cutter, region, ctx.part, tp.tool!, ctx.work)
  tp.warnings.push(...r.warnings)
  const off = b.moves.length
  // (one at a time: adaptive clearing can make more moves than a call takes arguments)
  for (const mv of r.moves) b.moves.push(mv)
  depthWarnings(r.minZ, ctx, tp)
  clearanceWarnings(m.placed, r.moves, op.surface.stockToLeave, ctx, tp)
  if (adaptive) {
    if (r.sections?.length) {
      tp.sections = r.sections.map((s) => ({ kind: 'trochoidal' as const, from: s.from + off, to: s.to + off }))
      tp.warnings.push(`${r.sections.length} narrow place(s) cleared with trochoidal loops.`)
    }
    if (r.trimmed) tp.warnings.push(`The safety check cut ${r.trimmed} adaptive pass(es) or entries short where the tool would touch the model; the width of cut after them may be higher than planned. Simulate it.`)
    if (r.moves.length) tp.warnings.push('Adaptive clearing per level is not written to woodWOP yet; simulate it.')
    return
  }
  layerIntents(r.layers, tp, op.name, op.entry !== 'plunge')
  if (r.layers.length) tp.warnings.push('For woodWOP, Z-level roughing is written as contour-milling passes level by level; the machine makes its own approach for each pass instead of the helix or ramp shown here.')
}

// ---------------------------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------------------------

export function generateOp(op: CamOp, ctx: GenContext): Toolpath {
  const tp = generateShifted(op, ctx)
  return hasMoveEdits(op.edits) && op.kind !== 'code' ? editToolpath(tp, op) : tp
}

function generateShifted(op: CamOp, ctx: GenContext): Toolpath {
  const base = ctx.base ?? ctx.part
  const top = stockTopShift(op, base)
  if (top > 1e-9) {
    const rest = (op.kind === 'pocket' && !!op.rest) || isAdaptive(op)
    if (rest) {
      const tp = generateAt(op, ctx)
      tp.warnings.push(`A facing before it re-set the stock top, but ${op.kind === 'pocket' && op.rest ? 'rest machining' : 'adaptive clearing'} still measures from face 1.`)
      return tp
    }
    if (top >= base.thickness - 1e-9) {
      const tp = generateAt(op, ctx)
      tp.warnings.push('The facings before it take the whole panel: depths are measured from face 1.')
      return tp
    }
    const tp = generateAt(op, { ...ctx, part: { ...base, thickness: base.thickness - top }, base })
    const shifted = shiftTop(tp, top)
    shifted.stats = stats(shifted.moves, shifted.feeds.feed)
    return shifted
  }
  return generateAt(op, ctx)
}

function generateAt(op: CamOp, ctx: GenContext): Toolpath {
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
      case 'finish3d':
        genFinish3d(op, ctx, tp, b)
        break
      case 'rough3d':
        genRough3d(op, ctx, tp, b)
        break
      case 'face':
        genFace(op, ctx, tp, b)
        break
      case 'chamfer':
        genChamfer(op, ctx, tp, b)
        break
      case 'curve':
        genCurve(op, ctx, tp, b)
        break
      case 'manual':
        genManual(op, ctx, tp, b)
        break
      case 'edge':
        genEdge(op, ctx, tp, b)
        break
    }
  tp.stats = stats(b.moves, feeds.feed)
  tp.moves = b.moves
  const seen = new Map<string, number>()
  for (const w of tp.warnings) seen.set(w, (seen.get(w) ?? 0) + 1)
  tp.warnings = [...seen].map(([w, n]) => (n > 1 ? `${w} (${n} times)` : w))
  return tp
}

function minWidth(op: CamOp, ctx: GenContext) {
  const closed = geometryOf(op, ctx.part).flatMap((g) => g.contours.filter((c) => c.closed))
  if (!closed.length) return undefined
  const bx = boxOf(closed)
  return Math.min(bx.maxX - bx.minX, bx.maxY - bx.minY)
}

/**
 * Toolpaths of a part's enabled operations. `paths3d`: toolpaths already calculated (in the
 * compute worker), by `pathKey`; an operation found there is not calculated again.
 * `skipBackground`: operations that would take seconds (`inBackground`) and are not in `paths3d`
 * get an empty toolpath with a note instead (for export, which blocks them anyway).
 */
export function generatePart(part: CamPart, machine: MachineProfile, meshes?: ReadonlyMap<string, Mesh>, paths3d?: ReadonlyMap<string, Toolpath>, skipBackground = false): Toolpath[] {
  const done = new Map<string, Toolpath>()
  return part.ops
    .filter((o) => o.enabled)
    .map((op) => {
      const bg = inBackground(op, part)
      const pre = bg ? paths3d?.get(pathKey(op, part, machine)) : undefined
      const skip = !pre && bg && skipBackground && !OPS_3D.has(op.kind)
      const tool = skip ? resolveTool(op, machine) : null
      const tp: Toolpath =
        pre ??
        (skip
          ? {
              opId: op.id,
              kind: op.kind,
              name: op.name,
              tool,
              feeds: feedsFor(op, tool, part.materialId, machine),
              moves: [],
              intents: [],
              warnings: [op.kind === 'curve' ? 'Not calculated for export (it is never written; it is calculated in the part designer).' : 'Not calculated for export (adaptive clearing is calculated in the part designer).'],
              stats: { cut: 0, rapid: 0, minutes: 0 },
              ...(op.kind === 'curve' ? { noOutput: CURVE_NO_OUTPUT } : {}),
            }
          : generateOp(op, { part, machine, meshes, done }))
      done.set(op.id, tp)
      return tp
    })
}

/** Key of a toolpath: the part, the operation and the hash of everything the path depends on. */
export function pathKey(op: CamOp, part: CamPart, machine: MachineProfile): string {
  return `${part.id}:${op.id}:${opInputHash(op, part, resolveTool(op, machine), machine)}`
}


/** Cutting moves as 2D contours (rapids split them); used for DXF export and nesting checks. */
export function toolpathContours(tp: Toolpath): Contour[] {
  const out: Contour[] = []
  let segs: Seg[] = []
  let at: { x: number; y: number } | null = null
  const flush = () => {
    if (segs.length) out.push({ closed: Math.hypot(segs[0].a.x - segs[segs.length - 1].b.x, segs[0].a.y - segs[segs.length - 1].b.y) < 1e-6, segs })
    segs = []
  }
  for (const m of simpleMoves(tp.moves)) {
    if (m.t === 'rapid' || m.t === 'drill') {
      flush()
      at = { x: m.x, y: m.y }
      continue
    }
    const b = { x: m.x, y: m.y }
    if (at && Math.hypot(b.x - at.x, b.y - at.y) > 1e-9) segs.push(m.t === 'arc' ? { k: 'A', a: at, b, c: { x: m.cx, y: m.cy }, ccw: m.ccw } : { k: 'L', a: at, b })
    at = b
  }
  flush()
  return out
}
