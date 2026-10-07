/**
 * Placing fixtures automatically (M3.6, FIX-01): clamps round the part, pods under it, each where
 * the whole tool (cutter, shank and holder, plus the collision margin) never comes near it on any
 * move of the part's toolpaths. The same check as the collision check (`fixtureHits`), so a
 * fixture placed here is clear by construction.
 *
 * - Clamps: the outline is split into as many equal stretches as clamps asked for; in each, the
 *   place nearest the part (fewest mm out from the edge, then nearest the stretch's middle) where
 *   a clamp standing on the table beside the edge, its length along the edge, is clear.
 * - Pods: points on a grid inside the outline where the whole pod fits under the part and is clear;
 *   as many as asked for, each the free point nearest its share of the part (spread like the
 *   corners of a grid over the part), never two closer than a pod's size.
 *
 * Pure: no DOM, no React.
 */
import { checkCancel, type Work } from '@/core/cancel'
import { toolOutline } from '@/core/machineModel'
import type { FixtureType, MachineProfile } from '@/core/types'
import { DEFAULT_COLLISION_MARGIN } from '../collision/collision'
import { type Aabb, boxesNear, type Vec } from '../collision/convex'
import { type BodyPiece, bodyReach, fixtureHits, toolBody } from '../collision/fixtureCheck'
import { partOutline } from '../doc'
import { toPoints } from '../geom'
import { needsPositional, positionalTimeline } from '../positional/sim'
import { buildTimeline, programOrder } from '../sim'
import type { Toolpath } from '../toolpath'
import type { CamPart, Fixture } from '../types'
import { defaultBaseZ, fixturePieces, KIND_NAME, shapeHeight } from './fixture'

/** A straight move of the tool: from tip a to tip b along w (turning to w1). */
export interface Sweep {
  a: Vec
  b: Vec
  w: Vec
  w1?: Vec
  body: BodyPiece[]
  box: Aabb
}

/** Every move of the part's toolpaths as the tool sweeps it (rotary toolpaths left out). */
export function partSweeps(part: Pick<CamPart, 'length' | 'width' | 'thickness'>, toolpaths: readonly Toolpath[], machine: MachineProfile): Sweep[] {
  const flat = toolpaths.filter((tp) => !tp.rotary && tp.moves.length)
  const tilted = needsPositional(flat)
  const run = tilted ? positionalTimeline(flat, part) : null
  const paths = run ? run.paths : programOrder([...flat])
  const tl = run ? run.tl : buildTimeline(paths)
  const top = Math.hypot(part.length, part.width, part.thickness) + 50
  const bodies = new Map<number, BodyPiece[]>()
  const out: Sweep[] = []
  for (const s of tl.segs) {
    if (s.side) continue
    let body = bodies.get(s.op)
    if (!body) {
      const tool = paths[tl.ops[s.op].path]?.tool
      bodies.set(s.op, (body = toolBody(s.cutter, tool ? toolOutline(machine, tool) : null, top)))
    }
    const w: Vec = s.axis && !s.turn ? [s.axis.x, s.axis.y, s.axis.z] : s.turn && s.turnFrom ? [s.turnFrom.x, s.turnFrom.y, s.turnFrom.z] : [0, 0, 1]
    const w1: Vec | undefined = s.turn && s.axis ? [s.axis.x, s.axis.y, s.axis.z] : undefined
    const reach = bodyReach(body)
    const a: Vec = [s.a.x, s.a.y, s.a.z]
    const b: Vec = [s.b.x, s.b.y, s.b.z]
    out.push({ a, b, w, ...(w1 ? { w1 } : {}), body, box: { lo: [Math.min(a[0], b[0]) - reach, Math.min(a[1], b[1]) - reach, Math.min(a[2], b[2]) - reach], hi: [Math.max(a[0], b[0]) + reach, Math.max(a[1], b[1]) + reach, Math.max(a[2], b[2]) + reach] } })
  }
  return out
}

/** Moves bucketed on a plan grid by their boxes, to find the ones near a place quickly. */
export class SweepGrid {
  readonly cell = 50
  readonly map = new Map<string, number[]>()
  readonly sweeps: readonly Sweep[]
  constructor(sweeps: readonly Sweep[]) {
    this.sweeps = sweeps
    sweeps.forEach((s, i) => {
      for (let x = Math.floor(s.box.lo[0] / this.cell); x <= Math.floor(s.box.hi[0] / this.cell); x++)
        for (let y = Math.floor(s.box.lo[1] / this.cell); y <= Math.floor(s.box.hi[1] / this.cell); y++) {
          const k = `${x},${y}`
          const l = this.map.get(k)
          if (l) l.push(i)
          else this.map.set(k, [i])
        }
    })
  }
  near(b: Aabb, gap: number): number[] {
    const seen = new Set<number>()
    for (let x = Math.floor((b.lo[0] - gap) / this.cell); x <= Math.floor((b.hi[0] + gap) / this.cell); x++)
      for (let y = Math.floor((b.lo[1] - gap) / this.cell); y <= Math.floor((b.hi[1] + gap) / this.cell); y++) for (const i of this.map.get(`${x},${y}`) ?? []) seen.add(i)
    return [...seen].sort((p, q) => p - q)
  }
}

/** Is a fixture clear of every move (the tool keeping the margin)? */
export function fixtureClear(f: Fixture, grid: SweepGrid, M: number): boolean {
  const pieces = fixturePieces([{ ...f, off: false }])
  if (!pieces.length) return true
  const region: Aabb = { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] }
  for (const p of pieces)
    for (let k = 0; k < 3; k++) {
      region.lo[k] = Math.min(region.lo[k], p.box.lo[k])
      region.hi[k] = Math.max(region.hi[k], p.box.hi[k])
    }
  for (const i of grid.near(region, M)) {
    const s = grid.sweeps[i]
    if (!boxesNear(s.box, region, M)) continue
    if (fixtureHits(pieces, region, s.body, s.a, s.b, s.w, M, s.w1 ? { w1: s.w1 } : {}).length) return false
  }
  return true
}

export interface AutoPlaceResult {
  fixtures: Fixture[]
  /** What could not be done, in plain words. */
  notes: string[]
}

/**
 * Place `count` fixtures of library entry `type` (a clamp round the part, a pod or rail under it)
 * clear of the toolpaths. `ids` gives each new fixture its id. Fixtures placed automatically before
 * (of the same kind) are replaced; the others stay and are not moved.
 */
export function autoPlace(part: CamPart, toolpaths: readonly Toolpath[], machine: MachineProfile, type: FixtureType, count: number, ids: () => string, work?: Work): AutoPlaceResult {
  const M = Math.max(0, machine.collisionMargin ?? DEFAULT_COLLISION_MARGIN)
  const notes: string[] = []
  const kept = (part.fixtures ?? []).filter((f) => !(f.auto && f.kind === type.kind))
  const grid = new SweepGrid(partSweeps(part, toolpaths, machine))
  const z = defaultBaseZ(type.kind, type.shape, part.thickness)
  const outline = toPoints(partOutline(part).contour, 0.05)
  const n0 = kept.filter((f) => f.kind === type.kind).length
  const make = (x: number, y: number, rot: number, i: number): Fixture => ({
    id: ids(),
    name: `${KIND_NAME[type.kind]} ${n0 + i + 1}`,
    kind: type.kind,
    shape: structuredClone(type.shape),
    at: { x: r3(x), y: r3(y), z },
    rot: r3(rot),
    auto: true,
    typeId: type.id,
    ...(type.placeholder ? { placeholder: true } : {}),
  })
  const want = Math.max(1, Math.min(32, Math.round(count)))
  const placed: Fixture[] = []
  if (type.kind === 'clamp') {
    // the outline counter-clockwise, its length, and the outward side of each stretch
    const pts = ccw(outline)
    const L = perimeter(pts)
    // half its size across the edge: a block's width, a round one's radius, else its extent
    const half = halfAcross(type.shape)
    const along = halfAlong(type.shape)
    for (let i = 0; i < want; i++) {
      checkCancel(work?.isCancelled)
      work?.progress?.(i / want, 'Placing clamps')
      let best: { f: Fixture; g: number; off: number } | null = null
      const from = (L * i) / want
      const to = (L * (i + 1)) / want
      const mid = (from + to) / 2
      // stations along the stretch, its middle first
      const stations: number[] = []
      for (let d = 0; d <= (to - from) / 2 - along + 1e-9; d += 10) stations.push(...(d ? [mid - d, mid + d] : [mid]))
      if (!stations.length) stations.push(mid)
      for (const s of stations) {
        const { p, t } = atLength(pts, ((s % L) + L) % L)
        const n: [number, number] = [t[1], -t[0]]
        const rot = (Math.atan2(t[1], t[0]) * 180) / Math.PI
        for (let g = 0; g <= 100 + 1e-9; g += 2) {
          if (best && g >= best.g) break
          const f = make(p[0] + n[0] * (half + g), p[1] + n[1] * (half + g), rot, i)
          if (overlapsAny(f, [...kept, ...placed])) continue
          if (fixtureClear(f, grid, M)) {
            if (!best || g < best.g || (g === best.g && Math.abs(s - mid) < best.off)) best = { f, g, off: Math.abs(s - mid) }
            break
          }
        }
        if (best && best.g === 0) break
      }
      if (best) placed.push(best.f)
      else notes.push(`No clear place for clamp ${i + 1} within 100 mm of its stretch of the outline.`)
    }
  } else {
    // pods (and rails) under the part: a grid of free points inside the outline
    const xs = outline.map((p) => p.x)
    const ys = outline.map((p) => p.y)
    const x0 = Math.min(...xs)
    const x1 = Math.max(...xs)
    const y0 = Math.min(...ys)
    const y1 = Math.max(...ys)
    const step = Math.max(5, Math.min(x1 - x0, y1 - y0) / 40)
    const free: { x: number; y: number }[] = []
    const poly = outline.map((p) => [p.x, p.y] as [number, number])
    for (let y = y0 + step / 2; y < y1; y += step) {
      checkCancel(work?.isCancelled)
      work?.progress?.((y - y0) / (y1 - y0), `Placing ${type.kind === 'pod' ? 'pods' : 'rails'}`)
      for (let x = x0 + step / 2; x < x1; x += step) {
        const f = make(x, y, 0, 0)
        if (!footprintInside(f, poly)) continue
        if (overlapsAny(f, kept)) continue
        if (fixtureClear(f, grid, M)) free.push({ x, y })
      }
    }
    // targets spread over the part like the corners of a grid (2 x 2 for four)
    const cols = Math.ceil(Math.sqrt(want))
    const rows = Math.ceil(want / cols)
    const targets: { x: number; y: number }[] = []
    for (let r = 0; r < rows && targets.length < want; r++) for (let c = 0; c < cols && targets.length < want; c++) targets.push({ x: x0 + ((x1 - x0) * (c + 0.5)) / cols, y: y0 + ((y1 - y0) * (r + 0.5)) / rows })
    const size = Math.max(halfAcross(type.shape), halfAlong(type.shape)) * 2
    targets.forEach((tg, i) => {
      let best: { x: number; y: number; d: number } | null = null
      for (const q of free) {
        if (placed.some((f) => Math.hypot(f.at.x - q.x, f.at.y - q.y) < size)) continue
        const d = Math.hypot(q.x - tg.x, q.y - tg.y)
        if (!best || d < best.d - 1e-9) best = { ...q, d }
      }
      if (best) placed.push(make(best.x, best.y, 0, i))
      else notes.push(`No clear place under the part for ${type.kind} ${i + 1}.`)
    })
  }
  if (!toolpaths.some((tp) => tp.moves.length)) notes.push('No toolpaths yet: the fixtures were placed without anything to keep clear of. Place them again once the operations are calculated.')
  return { fixtures: [...kept, ...placed], notes }
}

const r3 = (n: number) => Math.round(n * 1000) / 1000

function ccw(pts: { x: number; y: number }[]): [number, number][] {
  const p = pts.map((q) => [q.x, q.y] as [number, number])
  if (p.length > 1 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 1e-9) p.pop()
  let a = 0
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length
    a += p[i][0] * p[j][1] - p[j][0] * p[i][1]
  }
  return a < 0 ? p.reverse() : p
}

function perimeter(p: [number, number][]): number {
  let L = 0
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length
    L += Math.hypot(p[j][0] - p[i][0], p[j][1] - p[i][1])
  }
  return L
}

/** Point and unit direction at distance s along a closed outline. */
function atLength(p: [number, number][], s: number): { p: [number, number]; t: [number, number] } {
  let left = s
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length
    const l = Math.hypot(p[j][0] - p[i][0], p[j][1] - p[i][1])
    if (l < 1e-12) continue
    if (left <= l || i === p.length - 1) {
      const k = Math.min(1, left / l)
      return { p: [p[i][0] + (p[j][0] - p[i][0]) * k, p[i][1] + (p[j][1] - p[i][1]) * k], t: [(p[j][0] - p[i][0]) / l, (p[j][1] - p[i][1]) / l] }
    }
    left -= l
  }
  return { p: p[0], t: [1, 0] }
}

function halfAcross(s: Fixture['shape']): number {
  if (s.k === 'block') return s.width / 2
  if (s.k === 'round') return s.diameter / 2
  return extentOf(s) / 2
}

function halfAlong(s: Fixture['shape']): number {
  if (s.k === 'block') return s.length / 2
  if (s.k === 'round') return s.diameter / 2
  return extentOf(s) / 2
}

function extentOf(s: Fixture['shape']): number {
  const pts: number[] = s.k === 'outline' ? s.loops.flat() : s.k === 'model' ? s.slabs.flatMap((q) => q.hull) : []
  let r = 0
  for (let k = 0; k + 1 < pts.length; k += 2) r = Math.max(r, Math.hypot(pts[k], pts[k + 1]))
  return 2 * r
}

function inPoly(poly: [number, number][], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Does the fixture's plan (its pieces' boxes, sampled along their edges) lie inside the outline? */
function footprintInside(f: Fixture, poly: [number, number][]): boolean {
  for (const p of fixturePieces([f])) {
    const [x0, y0] = p.box.lo
    const [x1, y1] = p.box.hi
    for (let k = 0; k <= 8; k++) {
      const u = k / 8
      for (const [x, y] of [
        [x0 + (x1 - x0) * u, y0],
        [x0 + (x1 - x0) * u, y1],
        [x0, y0 + (y1 - y0) * u],
        [x1, y0 + (y1 - y0) * u],
      ])
        if (!inPoly(poly, x, y)) return false
    }
  }
  return true
}

/** Does the fixture overlap one already there (their boxes)? */
function overlapsAny(f: Fixture, others: readonly Fixture[]): boolean {
  const mine = fixturePieces([f])
  const theirs = fixturePieces(others)
  return mine.some((a) => theirs.some((b) => boxesNear(a.box, b.box, -1e-6)))
}

/** Height a placed fixture reaches (part z), for messages. */
export const fixtureTopZ = (f: Pick<Fixture, 'at' | 'shape'>) => f.at.z + shapeHeight(f.shape)
