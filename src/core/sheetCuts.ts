/**
 * Cut-out plans for a nested sheet beyond "every part on its own" (M2.8).
 *
 * Shared-line cutting (NST-04). Two rectangular parts nested exactly one cut-out tool diameter
 * apart have their tool-centre lines on top of each other: one pass between them cuts both edges.
 * The plan walks the parts in the sheet's cut order; for each part it cuts what is still uncut of
 * the rectangle one tool radius outside it (the tool centre, sharp corners), so every line is cut
 * once, collinear pieces are joined into one straight cut, and each part is cut free at (or before)
 * its own turn. Hold-down: parts that are small (under the area or narrower than the side set)
 * keep their own cut-out (and onion skin), as do shaped parts, custom parts and parts in or around
 * cut-outs. Nothing here changes a part's size: the paths are checked separately (no path closer
 * than the tool radius to any part; every edge of every part in the plan cut).
 */
import type { PartInstance } from './cutlist'
import type { NestedSheet, Placement } from './nesting'
import { area as areaOf, EndType, FillRule, inflatePaths, JoinType, trimCollinear, union } from 'clipper2-ts'
import type { Vec2 } from './types'

const EPS = 1e-3
const r3 = (n: number) => Math.round(n * 1000) / 1000

/** The part's outline is its whole cut rectangle (no openings). */
export function isRectInstance(i: Pick<PartInstance, 'outline' | 'holes' | 'cutLength' | 'cutWidth'>) {
  if (i.holes?.length) return false
  let a = 0
  const o = i.outline
  for (let k = 0, j = o.length - 1; k < o.length; j = k++) a += (o[j].x + o[k].x) * (o[j].y - o[k].y)
  return o.length < 3 || Math.abs(Math.abs(a / 2) - i.cutLength * i.cutWidth) <= 0.002 * i.cutLength * i.cutWidth
}

export interface SharedOptions {
  /** Cut-out tool diameter. */
  diameter: number
  /** Parts with less area than this (mm²) keep their own cut-out. */
  minArea: number
  /** Parts narrower than this (mm) keep their own cut-out. */
  minSide: number
  /** Parts that get an onion skin keep their own cut-out (and skin pass). */
  skinned?: ReadonlySet<string>
  /** Parts cut with bridges (M2.8 NST-05) are not in the shared plan. */
  bridged?: ReadonlySet<string>
  /** Cutting direction of closed loops: clockwise (climb with a right-hand spindle) or not. */
  clockwise: boolean
}

export interface CutPath {
  /** Tool-centre points; a closed path repeats its first point at the end. */
  pts: Vec2[]
  closed: boolean
  /** The part being cut free when this path is cut (its turn in the cut order). */
  partUid: string
  /** Other parts whose edge this path also cuts. */
  shared: string[]
}

export interface SharedPlan {
  paths: CutPath[]
  /** Parts cut by the plan. */
  parts: string[]
  /** Parts on their own cut-out, and why. */
  own: { uid: string; why: 'small' | 'shaped' | 'custom' | 'cut-out' | 'skin' | 'bridged' }[]
  /** Tool-centre cutting length of the plan's paths, mm. */
  planLength: number
  /** The same parts cut one by one (tool centre round each, arcs at the corners), mm. */
  separateLength: number
}

type Line = { key: string; horiz: boolean; at: number; from: number; to: number }

/** Subtract sorted intervals from [a, b]. */
function subtract(a: number, b: number, cut: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  let cur = a
  for (const [c0, c1] of cut) {
    if (c1 <= cur + EPS) continue
    if (c0 >= b - EPS) break
    if (c0 > cur + EPS) out.push([cur, Math.min(c0, b)])
    cur = Math.max(cur, c1)
    if (cur >= b - EPS) break
  }
  if (cur < b - EPS) out.push([cur, b])
  return out
}

function addInterval(list: [number, number][], a: number, b: number) {
  list.push([a, b])
  list.sort((p, q) => p[0] - q[0])
  const merged: [number, number][] = []
  for (const iv of list) {
    const last = merged[merged.length - 1]
    if (last && iv[0] <= last[1] + EPS) last[1] = Math.max(last[1], iv[1])
    else merged.push([iv[0], iv[1]])
  }
  list.splice(0, list.length, ...merged)
}

/** Why a part keeps its own cut-out, or null when it can share lines. */
export function ownReason(inst: PartInstance, pl: Placement, sheet: NestedSheet, o: Pick<SharedOptions, 'minArea' | 'minSide' | 'skinned' | 'bridged'>): SharedPlan['own'][number]['why'] | null {
  if (o.bridged?.has(pl.uid)) return 'bridged'
  if (inst.cam) return 'custom'
  if (pl.inside || sheet.placements.some((q) => q.inside === pl.uid)) return 'cut-out'
  if (!isRectInstance(inst)) return 'shaped'
  if (o.skinned?.has(pl.uid)) return 'skin'
  if (pl.dx * pl.dy < o.minArea - EPS || Math.min(pl.dx, pl.dy) < o.minSide - EPS) return 'small'
  return null
}

/** Tool-centre length of a part cut on its own: the outline grown by the radius (round corners). */
export function separateCutLength(perimeter: number, diameter: number) {
  return perimeter + Math.PI * diameter
}

export function sharedLinePlan(sheet: NestedSheet, instances: ReadonlyMap<string, PartInstance>, o: SharedOptions): SharedPlan {
  const r = o.diameter / 2
  const cut = new Map<string, [number, number][]>()
  const paths: CutPath[] = []
  const parts: string[] = []
  const own: SharedPlan['own'] = []
  let separateLength = 0
  // which parts have an edge on each line, for the "shared" list
  const users = new Map<string, { uid: string; from: number; to: number }[]>()
  const lineKey = (horiz: boolean, at: number) => `${horiz ? 'h' : 'v'}${r3(at)}`
  const loopOf = (pl: Placement): Line[] => {
    const x0 = pl.x - r
    const x1 = pl.x + pl.dx + r
    const y0 = pl.y - r
    const y1 = pl.y + pl.dy + r
    // walked clockwise from the lower-left corner: up the left, along the top, down the right, back along the bottom
    return [
      { key: lineKey(false, x0), horiz: false, at: x0, from: y0, to: y1 },
      { key: lineKey(true, y1), horiz: true, at: y1, from: x0, to: x1 },
      { key: lineKey(false, x1), horiz: false, at: x1, from: y1, to: y0 },
      { key: lineKey(true, y0), horiz: true, at: y0, from: x1, to: x0 },
    ]
  }
  const members: Placement[] = []
  for (const pl of sheet.placements) {
    const inst = instances.get(pl.uid)
    if (!inst) continue
    const why = ownReason(inst, pl, sheet, o)
    if (why) {
      own.push({ uid: pl.uid, why })
      continue
    }
    members.push(pl)
    parts.push(pl.uid)
    separateLength += separateCutLength(2 * (pl.dx + pl.dy), o.diameter)
    for (const ln of loopOf(pl)) {
      const list = users.get(ln.key) ?? []
      list.push({ uid: pl.uid, from: Math.min(ln.from, ln.to), to: Math.max(ln.from, ln.to) })
      users.set(ln.key, list)
    }
  }
  const pt = (ln: Line, t: number): Vec2 => (ln.horiz ? { x: r3(t), y: r3(ln.at) } : { x: r3(ln.at), y: r3(t) })
  for (const pl of members) {
    let loop = loopOf(pl)
    if (!o.clockwise) loop = [...loop].reverse().map((l) => ({ ...l, from: l.to, to: l.from }))
    // the uncut pieces of each side, in walking order
    const pieces: { ln: Line; a: number; b: number }[] = []
    for (const ln of loop) {
      const lo = Math.min(ln.from, ln.to)
      const hi = Math.max(ln.from, ln.to)
      const free = subtract(lo, hi, cut.get(ln.key) ?? [])
      const ordered = ln.from <= ln.to ? free : [...free].reverse().map(([a, b]) => [b, a] as [number, number])
      for (const [a, b] of ordered) pieces.push({ ln, a, b })
    }
    if (!pieces.length) continue
    // chain pieces that meet end to start (round a corner, or straight on)
    const chains: { ln: Line; a: number; b: number }[][] = []
    for (const p of pieces) {
      const last = chains[chains.length - 1]?.at(-1)
      if (last) {
        const e = pt(last.ln, last.b)
        const s = pt(p.ln, p.a)
        if (Math.abs(e.x - s.x) < EPS && Math.abs(e.y - s.y) < EPS) {
          chains[chains.length - 1].push(p)
          continue
        }
      }
      chains.push([p])
    }
    // the last chain may run on into the first (round the starting corner)
    if (chains.length > 1) {
      const e = chains[chains.length - 1].at(-1)!
      const s = chains[0][0]
      const pe = pt(e.ln, e.b)
      const ps = pt(s.ln, s.a)
      if (Math.abs(pe.x - ps.x) < EPS && Math.abs(pe.y - ps.y) < EPS) chains[0] = [...chains.pop()!, ...chains[0]]
    }
    const whole = chains.length === 1 && pieces.length === 4 && pieces.every((p) => Math.abs(Math.abs(p.b - p.a) - Math.abs(p.ln.to - p.ln.from)) < EPS)
    for (const ch of chains) {
      const pts: Vec2[] = [pt(ch[0].ln, ch[0].a)]
      for (const p of ch) pts.push(pt(p.ln, p.b))
      const shared = new Set<string>()
      for (const p of ch) {
        const lo = Math.min(p.a, p.b)
        const hi = Math.max(p.a, p.b)
        for (const u of users.get(p.ln.key) ?? []) if (u.uid !== pl.uid && u.from < hi - EPS && u.to > lo + EPS) shared.add(u.uid)
      }
      paths.push({ pts: simplify(pts), closed: whole, partUid: pl.uid, shared: [...shared].sort() })
    }
    for (const p of pieces) addInterval(cut.get(p.ln.key) ?? (cut.set(p.ln.key, []), cut.get(p.ln.key)!), Math.min(p.a, p.b), Math.max(p.a, p.b))
  }
  return { paths, parts, own, planLength: paths.reduce((s, p) => s + pathLength(p.pts), 0), separateLength }
}

/** Drop points in the middle of a straight run (collinear pieces become one cut). */
function simplify(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = []
  for (const p of pts) {
    if (out.length && Math.abs(out[out.length - 1].x - p.x) < EPS && Math.abs(out[out.length - 1].y - p.y) < EPS) continue
    if (out.length >= 2) {
      const a = out[out.length - 2]
      const b = out[out.length - 1]
      const cross = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x)
      const dot = (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y)
      if (Math.abs(cross) < EPS && dot > 0) {
        out[out.length - 1] = p
        continue
      }
    }
    out.push(p)
  }
  return out
}

export const pathLength = (pts: Vec2[]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0)

// ---------------------------------------------------------------------------------------------
// Independent checks (used by the export checker and the tests)
// ---------------------------------------------------------------------------------------------

function segSegDist(a: Vec2, b: Vec2, c: Vec2, d: Vec2) {
  const cross = (p: Vec2, q: Vec2, s: Vec2) => (q.x - p.x) * (s.y - p.y) - (q.y - p.y) * (s.x - p.x)
  const d1 = cross(a, b, c)
  const d2 = cross(a, b, d)
  const d3 = cross(c, d, a)
  const d4 = cross(c, d, b)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0
  return Math.min(ptSeg(a, c, d), ptSeg(b, c, d), ptSeg(c, a, b), ptSeg(d, a, b))
}

function ptSeg(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}

function inside(p: Vec2, poly: Vec2[]) {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c
  }
  return c
}

/** Closest a tool-centre path comes to a part region (outline on the sheet; 0 when it runs inside). */
export function pathToRegion(pts: Vec2[], outline: Vec2[]) {
  let best = Infinity
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    for (let k = 0, j = outline.length - 1; k < outline.length; j = k++) best = Math.min(best, segSegDist(a, b, outline[j], outline[k]))
  }
  if (pts.length && inside(pts[0], outline)) return 0
  return best
}

/** Length of a part's tool-centre rectangle not covered by the paths (0 = cut all round). */
export function uncutLength(pl: Placement, r: number, paths: { pts: Vec2[] }[]) {
  const x0 = pl.x - r
  const x1 = pl.x + pl.dx + r
  const y0 = pl.y - r
  const y1 = pl.y + pl.dy + r
  const sides: { horiz: boolean; at: number; lo: number; hi: number }[] = [
    { horiz: true, at: y0, lo: x0, hi: x1 },
    { horiz: true, at: y1, lo: x0, hi: x1 },
    { horiz: false, at: x0, lo: y0, hi: y1 },
    { horiz: false, at: x1, lo: y0, hi: y1 },
  ]
  let missing = 0
  for (const s of sides) {
    const cover: [number, number][] = []
    for (const p of paths)
      for (let i = 1; i < p.pts.length; i++) {
        const a = p.pts[i - 1]
        const b = p.pts[i]
        if (s.horiz && Math.abs(a.y - s.at) < EPS && Math.abs(b.y - s.at) < EPS) addInterval(cover, Math.min(a.x, b.x), Math.max(a.x, b.x))
        if (!s.horiz && Math.abs(a.x - s.at) < EPS && Math.abs(b.x - s.at) < EPS) addInterval(cover, Math.min(a.y, b.y), Math.max(a.y, b.y))
      }
    for (const [a, b] of subtract(s.lo, s.hi, cover)) missing += b - a
  }
  return missing
}

// ---------------------------------------------------------------------------------------------
// Measuring a sheet program's cut-out length
// ---------------------------------------------------------------------------------------------

/**
 * Tool-centre length of every cut-out pass in a sheet program (custom-part machining not
 * included). Tool-centre paths are measured as written; compensated outlines are grown by the tool
 * radius (round corners, as the control cuts them) and measured round. Each pass counts.
 */
export function programCutLength(ops: readonly { kind: string; points?: Vec2[]; segs?: unknown; centre?: boolean; tool?: { diameter: number } | null; purpose?: string }[]): number {
  let total = 0
  for (const o of ops) {
    if (o.kind !== 'contour' || !o.points?.length) continue
    if (o.centre) {
      total += pathLength(o.points)
      continue
    }
    const r = (o.tool?.diameter ?? 0) / 2
    const ring = o.points.slice(0, -1)
    const K = 1000
    const grown = inflatePaths([ring.map((p) => ({ x: Math.round(p.x * K), y: Math.round(p.y * K) }))], r * K, JoinType.Round, EndType.Polygon, 2, 0.001 * K)
    for (const g of grown) total += g.reduce((s, p, i) => s + Math.hypot(p.x - g[(i + 1) % g.length].x, p.y - g[(i + 1) % g.length].y), 0) / K
  }
  return total
}

// ---------------------------------------------------------------------------------------------
// Bridged nesting (NST-05)
// ---------------------------------------------------------------------------------------------

export interface BridgeOptions {
  /** Cut-out tool diameter: the tool has to pass round every bridge. */
  diameter: number
  /** Bridge width (along the parts' edges), mm. */
  width: number
  /** Longest bridge (the widest gap bridged), mm. */
  maxLength: number
  /** Parts under this area (mm²) are linked; larger parts are cut on their own. */
  maxArea: number
  /** Parts that keep their own cut-out whatever their size (e.g. in shared lines). */
  skip?: ReadonlySet<string>
}

export interface Bridge {
  a: string
  b: string
  /** The bridge on the sheet: x0..x1 by y0..y1. */
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface BridgeCluster {
  members: string[]
  bridges: Bridge[]
  /** Outline of the parts and bridges together (counter-clockwise), and any enclosed waste (clockwise). */
  outer: Vec2[]
  holes: Vec2[][]
}

export interface BridgePlan {
  clusters: BridgeCluster[]
  /** Small parts that found no neighbour to link to (cut on their own). */
  alone: string[]
}

/** Gap between two placements' boxes along x or y, and the overlap along the other axis. */
function facing(a: Placement, b: Placement) {
  const ox = Math.min(a.x + a.dx, b.x + b.dx) - Math.max(a.x, b.x)
  const oy = Math.min(a.y + a.dy, b.y + b.dy) - Math.max(a.y, b.y)
  if (oy > 0) {
    const [l, rr] = a.x < b.x ? [a, b] : [b, a]
    const gap = rr.x - (l.x + l.dx)
    if (gap > 0) return { horiz: true, gap, lo: Math.max(a.y, b.y), hi: Math.min(a.y + a.dy, b.y + b.dy), from: l.x + l.dx, to: rr.x }
  }
  if (ox > 0) {
    const [l, rr] = a.y < b.y ? [a, b] : [b, a]
    const gap = rr.y - (l.y + l.dy)
    if (gap > 0) return { horiz: false, gap, lo: Math.max(a.x, b.x), hi: Math.min(a.x + a.dx, b.x + b.dx), from: l.y + l.dy, to: rr.y }
  }
  return null
}

const boxGap = (b: { x0: number; y0: number; x1: number; y1: number }, p: Placement) => Math.max(p.x - b.x1, b.x0 - (p.x + p.dx), p.y - b.y1, b.y0 - (p.y + p.dy))

/**
 * Link small rectangular parts with short bridges so each group is cut as one continuous path
 * round the parts and bridges together: the group stays one piece on the vacuum (and on the
 * table) until the bridges are broken. Bridges go between facing edges no further apart than the
 * longest bridge, in the middle of the stretch the edges share, and never within a tool diameter
 * of another part (the tool has to pass). Links form a tree (shortest gaps first), so no waste is
 * boxed in by bridges.
 */
export function bridgePlan(sheet: NestedSheet, instances: ReadonlyMap<string, PartInstance>, o: BridgeOptions): BridgePlan {
  const eligible = sheet.placements.filter((pl) => {
    const inst = instances.get(pl.uid)
    if (!inst || o.skip?.has(pl.uid) || inst.cam || pl.inside || sheet.placements.some((q) => q.inside === pl.uid) || !isRectInstance(inst)) return false
    return pl.dx * pl.dy < o.maxArea - EPS
  })
  const ids = new Set(eligible.map((p) => p.uid))
  const cand: { a: Placement; b: Placement; f: NonNullable<ReturnType<typeof facing>> }[] = []
  for (let i = 0; i < eligible.length; i++)
    for (let j = i + 1; j < eligible.length; j++) {
      const f = facing(eligible[i], eligible[j])
      if (!f || f.gap > o.maxLength + EPS || f.gap < o.diameter - EPS || f.hi - f.lo < o.width - EPS) continue
      cand.push({ a: eligible[i], b: eligible[j], f })
    }
  cand.sort((p, q) => p.f.gap - q.f.gap || q.f.hi - q.f.lo - (p.f.hi - p.f.lo) || (p.a.uid + p.b.uid).localeCompare(q.a.uid + q.b.uid))
  const root = new Map([...ids].map((u) => [u, u]))
  const find = (u: string): string => (root.get(u) === u ? u : find(root.get(u)!))
  const bridges: Bridge[] = []
  for (const { a, b, f } of cand) {
    if (find(a.uid) === find(b.uid)) continue
    const mid = (f.lo + f.hi) / 2
    const box = f.horiz ? { x0: f.from, x1: f.to, y0: mid - o.width / 2, y1: mid + o.width / 2 } : { x0: mid - o.width / 2, x1: mid + o.width / 2, y0: f.from, y1: f.to }
    const rb = { x0: r3(box.x0), y0: r3(box.y0), x1: r3(box.x1), y1: r3(box.y1) }
    // the tool has to get round the bridge: every other part at least a tool diameter away
    if (sheet.placements.some((p) => p.uid !== a.uid && p.uid !== b.uid && boxGap(rb, p) < o.diameter - EPS)) continue
    root.set(find(a.uid), find(b.uid))
    bridges.push({ a: a.uid, b: b.uid, ...rb })
  }
  const groups = new Map<string, string[]>()
  for (const p of eligible) groups.set(find(p.uid), [...(groups.get(find(p.uid)) ?? []), p.uid])
  const clusters: BridgeCluster[] = []
  const alone: string[] = []
  // clusters in cut order of their first member
  for (const members of groups.values()) {
    if (members.length < 2) {
      alone.push(members[0])
      continue
    }
    const set = new Set(members)
    const own = bridges.filter((b) => set.has(b.a))
    const K = 1000
    const box = (x0: number, y0: number, x1: number, y1: number) => [
      { x: Math.round(x0 * K), y: Math.round(y0 * K) },
      { x: Math.round(x1 * K), y: Math.round(y0 * K) },
      { x: Math.round(x1 * K), y: Math.round(y1 * K) },
      { x: Math.round(x0 * K), y: Math.round(y1 * K) },
    ]
    const shapes = [...members.map((u) => sheet.placements.find((p) => p.uid === u)!).map((p) => box(p.x, p.y, p.x + p.dx, p.y + p.dy)), ...own.map((b) => box(b.x0, b.y0, b.x1, b.y1))]
    const merged = union(shapes, FillRule.NonZero).map((ring) => trimCollinear(ring))
    const toMm = (ring: { x: number; y: number }[]) => ring.map((q) => ({ x: q.x / K, y: q.y / K }))
    const outerRings = merged.filter((ring) => areaOf(ring) > 0)
    const outer = toMm(outerRings.sort((p, q) => areaOf(q) - areaOf(p))[0])
    const holes = merged.filter((ring) => areaOf(ring) < 0).map(toMm)
    clusters.push({ members, bridges: own, outer, holes })
  }
  return { clusters, alone }
}
