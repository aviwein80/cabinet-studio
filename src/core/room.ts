import type { CabinetInstance, CabinetPlacement, CarcassParams, Job, Library, Room, Vec3 } from './types'

/** 12 ft × 10 ft × 8 ft. Wall cabinets sit 54 in off the floor. */
export const DEFAULT_ROOM: Room = { width: 3657.6, depth: 3048, height: 2438.4 }
export const WALL_ELEVATION = 54 * 25.4

export function footprint(width: number, depth: number, pl: CabinetPlacement) {
  const turned = pl.rotation === 90 || pl.rotation === 270
  return { x: pl.x, y: pl.y, w: turned ? depth : width, d: turned ? width : depth }
}

/**
 * Cabinet-local point (X width, Y depth, Z up) into room coordinates. Every rotation is a true turn
 * about the vertical, so a turned cabinet keeps its hand: seen from the front, its left side stays on
 * the left (Kitchen-2: 90 and 270 used to mirror the cabinet, which swapped hinge and blind sides).
 */
export function toRoom(x: number, y: number, z: number, pl: CabinetPlacement, width: number, depth: number): Vec3 {
  switch (pl.rotation) {
    case 0:
      return [pl.x + x, pl.y + y, pl.z + z]
    case 90:
      return [pl.x + y, pl.y + (width - x), pl.z + z]
    case 180:
      return [pl.x + (width - x), pl.y + (depth - y), pl.z + z]
    case 270:
      return [pl.x + (depth - y), pl.y + x, pl.z + z]
  }
}

function nearest(value: number, targets: number[], tol: number) {
  let best = value
  let gap = tol
  for (const t of targets) {
    const d = Math.abs(t - value)
    if (d <= gap) {
      gap = d
      best = t
    }
  }
  return best
}

export type SnapTarget = { x: number; y: number; w: number; d: number; z?: number; h?: number }

/**
 * Snap a footprint to walls and to neighbouring cabinets (side to side, aligned fronts).
 * When `height` is set, also snap the floor to 0, the 54 in wall line, the ceiling, and
 * neighbour tops (a wall cabinet sitting on a base). `enabled: false` returns the placement unchanged.
 */
export function snapPlacement(
  pl: CabinetPlacement,
  width: number,
  depth: number,
  others: SnapTarget[],
  room: Room,
  tol = 12.7,
  opts?: { enabled?: boolean; height?: number },
): CabinetPlacement {
  if (opts?.enabled === false) return { ...pl }
  const fp = footprint(width, depth, pl)
  const xs = [0, room.width - fp.w]
  const ys = [0, room.depth - fp.d]
  for (const o of others) {
    xs.push(o.x, o.x + o.w, o.x - fp.w, o.x + o.w - fp.w)
    ys.push(o.y, o.y + o.d, o.y - fp.d, o.y + o.d - fp.d)
  }
  const next = { ...pl, x: nearest(pl.x, xs, tol), y: nearest(pl.y, ys, tol) }
  if (opts?.height == null) return next
  const h = opts.height
  const zs = [0, WALL_ELEVATION, Math.max(0, room.height - h)]
  for (const o of others) {
    if (o.z == null || o.h == null) continue
    zs.push(o.z, o.z + o.h, o.z + o.h - h, o.z - h)
  }
  return { ...next, z: nearest(pl.z, zs, tol) }
}

// ---------------------------------------------------------------------------------------------
// Kitchen-2: corners, walls and runs
// ---------------------------------------------------------------------------------------------

type Item = Pick<CabinetInstance, 'id' | 'params'>
export type Segment = 'back' | 'left' | 'right'
type Span = [number, number]

/** A cabinet whose back is within this of a wall counts as standing on it (as in the elevations). */
const ON_WALL = 40
const TOUCH = 0.5

const boardThickness = (lib: Library | undefined, id: string) => lib?.materials.find((m) => m.id === id)?.thickness ?? 18

/** The corner a corner cabinet belongs in: a blind-left one in the back-left corner, a blind-right one in the back-right. */
export function cornerSide(p: CarcassParams): 'left' | 'right' | null {
  return !p.panel && p.corner?.type === 'blind' ? p.corner.blindSide : null
}

/**
 * How far the cabinet's front stands out in front of its box (its footprint stops at the carcass
 * front): doors, drawer fronts, a blind panel, a filler strip or an end panel.
 */
export function frontThickness(p: CarcassParams, lib?: Library) {
  const t = boardThickness(lib, p.doorMaterialId)
  if (p.panel?.type === 'filler') return t
  if (p.panel?.type === 'end-panel') return t + (p.panel.front === 'proud' ? Math.max(0, p.panel.proud) : 0)
  return p.doors.count > 0 || (p.drawers?.count ?? 0) > 0 || p.corner?.blindPanel ? t : 0
}

/** What a run on the side wall butts against: the face of the corner cabinet's blind panel, or its box. */
function blindFace(p: CarcassParams, lib?: Library) {
  return p.corner?.blindPanel ? boardThickness(lib, p.doorMaterialId) : 0
}

/** The wall a placed cabinet stands against, facing into the room (back, left or right), or null. */
export function segmentOf(c: Item, pl: CabinetPlacement, room: Room): Segment | null {
  const fp = footprint(c.params.width, c.params.depth, pl)
  if (pl.rotation === 0 && Math.abs(fp.y + fp.d - room.depth) <= ON_WALL) return 'back'
  if (pl.rotation === 270 && Math.abs(fp.x) <= ON_WALL) return 'left'
  if (pl.rotation === 90 && Math.abs(fp.x + fp.w - room.width) <= ON_WALL) return 'right'
  return null
}

const levelOf = (p: CarcassParams) => (p.kind === 'wall' ? 'wall' : 'floor')

/** Push `start` forward past any blocked span the length `len` would overlap. */
function clearForward(start: number, len: number, blocked: Span[]) {
  let s = start
  for (let guard = 0; guard < 16; guard++) {
    const hit = blocked.find(([a, b]) => s < b - TOUCH && s + len > a + TOUCH)
    if (!hit) return s
    s = hit[1]
  }
  return s
}

/** Move `end` back past any blocked span the length `len` would overlap. */
function clearBackward(end: number, len: number, blocked: Span[]) {
  let e = end
  for (let guard = 0; guard < 16; guard++) {
    const hit = blocked.find(([a, b]) => e - len < b - TOUCH && e > a + TOUCH)
    if (!hit) return e
    e = hit[0]
  }
  return e
}

/** The old layout: floor cabinets left to right along the back wall, the overflow returned on the left wall. */
function arrangeLegacyFloor(floor: Item[], room: Room, out: Record<string, CabinetPlacement>) {
  let x = 0
  let backDepth = 0
  let wrapped = false
  let returnTop = 0
  for (const c of floor) {
    const w = c.params.width
    const d = c.params.depth
    if (!wrapped && x + w <= room.width + 0.5) {
      out[c.id] = { x, y: room.depth - d, rotation: 0, z: 0 }
      backDepth = Math.max(backDepth, d)
      x += w
    } else {
      // the return on the left wall faces into the room (270), butted against the side of the back
      // run, one after another towards the front wall (Kitchen-2: it used to face the wall, and every
      // returned cabinet was put in the same place)
      if (!wrapped) returnTop = room.depth - Math.max(backDepth, d)
      wrapped = true
      out[c.id] = { x: 0, y: returnTop - w, rotation: 270, z: 0 }
      returnTop -= w
    }
  }
}

function spansOn(segment: Segment, items: Item[], out: Record<string, CabinetPlacement>, room: Room): Span[] {
  const spans: Span[] = []
  for (const c of items) {
    const pl = out[c.id]
    if (!pl || segmentOf(c, pl, room) !== segment) continue
    const fp = footprint(c.params.width, c.params.depth, pl)
    spans.push(segment === 'back' ? [fp.x, fp.x + fp.w] : [fp.y, fp.y + fp.d])
  }
  return spans
}

/**
 * One run (the floor cabinets, or the wall cabinets) with corner cabinets in it, in job order read as
 * walking the kitchen left to right: the left wall from its front end to the back-left corner, the
 * back wall from left to right, then the right wall from the back-right corner to its front end. A
 * blind-left corner cabinet stands in the back-left corner (pulled out from the left wall by its
 * pull-out clearance) and ends the left-wall part of the run; a blind-right one stands in the
 * back-right corner and starts the right-wall part. Each side run butts against the corner cabinet's
 * face (its blind panel). Cabinets that do not fit are still placed, past the wall, so the room shows
 * the problem.
 */
function arrangeCornerRun(run: Item[], room: Room, z: number, lib: Library | undefined, out: Record<string, CabinetPlacement>, blocked: Record<Segment, Span[]>) {
  const iL = run.findIndex((c) => cornerSide(c.params) === 'left')
  let iR = run.findIndex((c) => cornerSide(c.params) === 'right')
  if (iR >= 0 && iR < iL) iR = -1
  const leftItems = iL >= 0 ? run.slice(0, iL) : []
  const backItems = run.slice(iL >= 0 ? iL + 1 : 0, iR >= 0 ? iR : run.length)
  const rightItems = iR >= 0 ? run.slice(iR + 1) : []
  const back = (c: Item, x: number): CabinetPlacement => ({ x, y: room.depth - c.params.depth, rotation: 0, z })

  let backStart = 0
  let backEnd = room.width
  let leftTop = room.depth
  let rightTop = room.depth
  if (iL >= 0) {
    const c = run[iL]
    const pull = Math.max(0, c.params.corner?.pullOut ?? 0)
    out[c.id] = back(c, pull)
    backStart = pull + c.params.width
    leftTop = room.depth - c.params.depth - blindFace(c.params, lib)
  }
  if (iR >= 0) {
    const c = run[iR]
    const pull = Math.max(0, c.params.corner?.pullOut ?? 0)
    out[c.id] = back(c, room.width - pull - c.params.width)
    backEnd = room.width - pull - c.params.width
    rightTop = room.depth - c.params.depth - blindFace(c.params, lib)
  }

  if (iL >= 0 || iR < 0) {
    let x = backStart
    for (const c of backItems) {
      x = clearForward(x, c.params.width, blocked.back)
      out[c.id] = back(c, x)
      x += c.params.width
    }
  } else {
    // only a right corner: the back run is held against it and grows to the left
    let x = backEnd
    for (const c of [...backItems].reverse()) {
      x = clearBackward(x, c.params.width, blocked.back)
      out[c.id] = back(c, x - c.params.width)
      x -= c.params.width
    }
  }
  let y = leftTop
  for (const c of [...leftItems].reverse()) {
    y = clearBackward(y, c.params.width, blocked.left)
    out[c.id] = { x: 0, y: y - c.params.width, rotation: 270, z }
    y -= c.params.width
  }
  y = rightTop
  for (const c of rightItems) {
    y = clearBackward(y, c.params.width, blocked.right)
    out[c.id] = { x: room.width - c.params.depth, y: y - c.params.width, rotation: 90, z }
    y -= c.params.width
  }
}

/**
 * Lay the job out in the room. Without corner cabinets: floor cabinets along the back wall, left to
 * right; one that does not fit becomes a return on the left wall, butted against the side of the
 * back run. With corner cabinets (Kitchen-2): the run turns the corner, see `arrangeCornerRun`. Wall
 * cabinets go the same way at 54 in, skipping any span a tall cabinet already occupies.
 */
export function arrangeCabinets(cabinets: Item[], room: Room, lib?: Library): Record<string, CabinetPlacement> {
  const out: Record<string, CabinetPlacement> = {}
  const floor = cabinets.filter((c) => c.params.kind !== 'wall')
  const walls = cabinets.filter((c) => c.params.kind === 'wall')
  const hasCorner = (run: Item[]) => run.some((c) => cornerSide(c.params))
  const none: Record<Segment, Span[]> = { back: [], left: [], right: [] }
  if (hasCorner(floor)) arrangeCornerRun(floor, room, 0, lib, out, none)
  else arrangeLegacyFloor(floor, room, out)
  const talls = floor.filter((c) => c.params.kind === 'tall')
  const blocked: Record<Segment, Span[]> = { back: spansOn('back', talls, out, room), left: spansOn('left', talls, out, room), right: spansOn('right', talls, out, room) }
  if (hasCorner(walls)) {
    arrangeCornerRun(walls, room, WALL_ELEVATION, lib, out, blocked)
    return out
  }
  let wx = 0
  for (const c of walls) {
    const w = c.params.width
    wx = clearForward(wx, w, blocked.back)
    if (wx + w > room.width + 0.5) continue
    out[c.id] = { x: wx, y: room.depth - c.params.depth, rotation: 0, z: WALL_ELEVATION }
    wx += w
  }
  return out
}

export function placementOf(cab: CabinetInstance, arranged: Record<string, CabinetPlacement>): CabinetPlacement {
  return cab.placement ?? arranged[cab.id] ?? { x: 0, y: 0, rotation: 0, z: cab.params.kind === 'wall' ? WALL_ELEVATION : 0 }
}

export function turned(rotation: CabinetPlacement['rotation']) {
  return rotation === 90 || rotation === 270
}

export const nextRotation = (r: CabinetPlacement['rotation']): CabinetPlacement['rotation'] => ((r + 90) % 360) as CabinetPlacement['rotation']

export type { CarcassParams }

type Box = { x: number; y: number; w: number; d: number; z0: number; z1: number }

function boxOf(c: Pick<CabinetInstance, 'params'>, pl: CabinetPlacement): Box {
  const fp = footprint(c.params.width, c.params.depth, pl)
  return { ...fp, z0: pl.z, z1: pl.z + c.params.height }
}

const zOverlap = (a: Box, b: Box) => Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > TOUCH

type Placed = { c: CabinetInstance; pl: CabinetPlacement; b: Box }

/**
 * Move a chain of cabinets along `along`, one after another, so it stays closed against an edge
 * that moved from `oldEdge` to `newEdge`. `dir` +1: the edge is the far (high) end of what changed
 * and the chain lies beyond it; -1: the edge is the near (low) end and the chain lies before it.
 * A cabinet that was butted against the edge, or that the edge now overlaps, moves; the first one
 * standing apart (a gap absorbs the change) or a corner cabinet (it stays in its corner) stops it.
 */
function chainPush(cands: Placed[], along: 'x' | 'y', dir: 1 | -1, oldEdge: number, newEdge: number): string[] {
  const len = (b: Box) => (along === 'x' ? b.w : b.d)
  const list = [...cands].sort((a, b) => (dir > 0 ? a.b[along] - b.b[along] : b.b[along] + len(b.b) - (a.b[along] + len(a.b))))
  const moved: string[] = []
  for (const { c, pl, b } of list) {
    const start = b[along]
    const end = start + len(b)
    const near = dir > 0 ? start : end
    const butted = Math.abs(near - oldEdge) <= TOUCH
    const overlapped = dir > 0 ? near < newEdge - TOUCH : near > newEdge + TOUCH
    if ((!butted && !overlapped) || cornerSide(c.params)) break
    const shift = newEdge - near
    oldEdge = dir > 0 ? end : start
    if (Math.abs(shift) < 1e-9) {
      newEdge = oldEdge
      continue
    }
    c.placement = { ...pl, [along]: pl[along] + shift }
    newEdge = oldEdge + shift
    moved.push(c.id)
  }
  return moved
}

/** Corner cabinets standing in the back corners, at the height of `box`. */
function cornersAt(placed: Placed[], room: Room, box: Box) {
  const at = (side: 'left' | 'right') => placed.find((o) => cornerSide(o.c.params) === side && segmentOf(o.c, o.pl, room) === 'back' && zOverlap(o.b, box))
  return { left: at('left'), right: at('right') }
}

/**
 * Polish-1, extended in Kitchen-2: a cabinet in the room changed size. The cabinets beside it in the
 * same run (same turn, overlapping across the run and in height) that were butted against it, or
 * that it now overlaps, move by the change, one after another, so the run stays closed and nothing
 * overlaps; a gap absorbs the change. A run held by a corner cabinet grows away from the corner: on
 * a side wall towards the front, on the back wall away from the corner. A corner cabinet that gets
 * wider, deeper or pulled further out moves the back run and the side-wall run beside it, so the
 * change follows the run round the corner. Without a corner, a cabinet grows to the right (or along
 * the wall), as before. Only cabinets with a placement of their own are moved (an arranged layout
 * reflows by itself). `old` is the old width, or the old width, depth and pull-out. Returns the ids moved.
 */
export function pushNeighbours(cabinets: CabinetInstance[], id: string, old: number | { width?: number; depth?: number; pullOut?: number }, room: Room, lib?: Library): string[] {
  const cab = cabinets.find((c) => c.id === id)
  if (!cab?.placement) return []
  const prev = typeof old === 'number' ? { width: old } : old
  const oldW = prev.width ?? cab.params.width
  const oldD = prev.depth ?? cab.params.depth
  const pullNow = cab.params.corner?.pullOut ?? 0
  const oldPull = prev.pullOut ?? pullNow
  const dW = cab.params.width - oldW
  const dD = cab.params.depth - oldD
  const dP = pullNow - oldPull
  if (Math.abs(dW) < 1e-9 && Math.abs(dD) < 1e-9 && Math.abs(dP) < 1e-9) return []
  const before = cabinets.map((c) =>
    c.id === id ? { ...c, params: { ...c.params, width: oldW, depth: oldD, ...(c.params.corner ? { corner: { ...c.params.corner, pullOut: oldPull } } : {}) } } : c,
  )
  const arranged = arrangeCabinets(before, room, lib)
  const pl = cab.placement
  const me = boxOf({ params: before.find((c) => c.id === id)!.params }, pl)
  const others: Placed[] = cabinets.filter((c) => c.id !== id).map((c) => ({ c, pl: placementOf(c, arranged), b: boxOf(c, placementOf(c, arranged)) }))
  const moved: string[] = []
  const side = cornerSide(cab.params)

  if (side && pl.rotation === 0 && segmentOf(cab, pl, room) === 'back') {
    // the back run beside the corner cabinet
    const backRun = others.filter((o) => !turned(o.pl.rotation) && zOverlap(o.b, me) && Math.min(o.b.y + o.b.d, me.y + me.d) - Math.max(o.b.y, me.y) > TOUCH)
    let x = pl.x
    if (side === 'left') {
      x = pl.x + dP
      moved.push(...chainPush(backRun.filter((o) => o.b.x > me.x + TOUCH), 'x', 1, pl.x + oldW, x + cab.params.width))
    } else {
      x = pl.x - dW - dP
      moved.push(...chainPush(backRun.filter((o) => o.b.x + o.b.w < me.x + me.w - TOUCH), 'x', -1, pl.x, x))
    }
    // the side-wall run butted against its face moves when it gets deeper
    const face = blindFace(cab.params, lib)
    const sideRun = others.filter((o) => segmentOf(o.c, o.pl, room) === (side === 'left' ? 'left' : 'right') && zOverlap(o.b, me) && o.b.y + o.b.d <= pl.y + TOUCH)
    if (Math.abs(dD) > 1e-9) moved.push(...chainPush(sideRun, 'y', -1, pl.y - face, pl.y - dD - face))
    cab.placement = { ...pl, x, y: pl.y - dD }
    return moved
  }

  if (Math.abs(dW) < 1e-9) return moved
  const along = turned(pl.rotation) ? 'y' : 'x'
  const across = along === 'x' ? 'y' : 'x'
  const len = (b: Box) => (along === 'x' ? b.w : b.d)
  const span = (b: Box) => (across === 'x' ? b.w : b.d)
  const run = others.filter(({ pl: p, b }) => {
    if (turned(p.rotation) !== turned(pl.rotation)) return false
    const crossOverlap = Math.min(b[across] + span(b), me[across] + span(me)) - Math.max(b[across], me[across]) > TOUCH
    return crossOverlap && zOverlap(b, me)
  })
  // which way the run grows: away from a corner cabinet that holds it
  const corners = cornersAt(others, room, me)
  const seg = segmentOf(cab, pl, room)
  const dir: 1 | -1 = seg === 'back' ? (corners.left ? 1 : corners.right ? -1 : 1) : seg === 'left' ? (corners.left ? -1 : 1) : seg === 'right' ? (corners.right ? -1 : 1) : 1
  if (dir > 0) {
    moved.push(...chainPush(run.filter(({ b }) => b[along] > me[along] + TOUCH), along, 1, me[along] + len(me), me[along] + len(me) + dW))
  } else {
    const start = pl[along]
    moved.push(...chainPush(run.filter(({ b }) => b[along] + len(b) < me[along] + len(me) - TOUCH), along, -1, start, start - dW))
    cab.placement = { ...pl, [along]: start - dW }
  }
  return moved
}

/**
 * Kitchen-2: the room left between a blind corner cabinet's door and the doors of the run butted
 * against its face (the return on the side wall). Negative = the return's doors stand in front of
 * the corner door, so it cannot open. Null when nothing is butted against it.
 */
export function cornerClearance(cabinets: CabinetInstance[], id: string, room: Room, place: (c: CabinetInstance) => CabinetPlacement, lib?: Library) {
  const cab = cabinets.find((c) => c.id === id)
  const side = cab ? cornerSide(cab.params) : null
  if (!cab || !side || !cab.params.corner) return null
  const pl = place(cab)
  if (pl.rotation !== 0 || segmentOf(cab, pl, room) !== 'back') return null
  const me = boxOf(cab, pl)
  const face = pl.y - blindFace(cab.params, lib)
  const g = cab.params.doors.gap
  const bw = cab.params.corner.blindWidth
  let best: { id: string; clearance: number; off: number } | null = null
  for (const o of cabinets) {
    if (o.id === id) continue
    const opl = place(o)
    if (segmentOf(o, opl, room) !== side) continue
    const b = boxOf(o, opl)
    const off = Math.abs(b.y + b.d - face)
    if (!zOverlap(b, me) || off > ON_WALL || (best && off >= best.off)) continue
    const front = frontThickness(o.params, lib)
    const clearance = side === 'left' ? pl.x + bw + g / 2 - (b.x + b.w + front) : b.x - front - (pl.x + cab.params.width - bw - g / 2)
    best = { id: o.id, clearance, off }
  }
  return best && { id: best.id, clearance: best.clearance }
}

/**
 * Polish-1: what in the room needs attention: cabinets whose boxes overlap (pairs of ids), and
 * cabinets that run past a wall. Kitchen-2: blind corner doors that the return's doors stand in
 * front of. Shown in the room so an overlap is never silent.
 */
export function roomProblems(cabinets: CabinetInstance[], room: Room, place: (c: CabinetInstance) => CabinetPlacement, lib?: Library) {
  const boxes = cabinets.map((c) => ({ c, b: boxOf(c, place(c)) }))
  const overlaps: [string, string][] = []
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].b
      const b = boxes[j].b
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const oy = Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y)
      const oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0)
      if (ox > TOUCH && oy > TOUCH && oz > TOUCH) overlaps.push([boxes[i].c.id, boxes[j].c.id])
    }
  const outside = boxes.filter(({ b }) => b.x < -TOUCH || b.y < -TOUCH || b.x + b.w > room.width + TOUCH || b.y + b.d > room.depth + TOUCH).map(({ c }) => c.id)
  const blocked: { corner: string; by: string; clearance: number }[] = []
  for (const c of cabinets) {
    if (!cornerSide(c.params)) continue
    const cl = cornerClearance(cabinets, c.id, room, place, lib)
    if (cl && cl.clearance < -TOUCH) blocked.push({ corner: c.id, by: cl.id, clearance: cl.clearance })
  }
  return { overlaps, outside, blocked }
}

// ---------------------------------------------------------------------------------------------
// Kitchen-2: runs shorter than their wall, and filling the gap
// ---------------------------------------------------------------------------------------------

/** Gaps up to this are offered "Fill gap"; a wider space is room for another cabinet. */
export const FILL_GAP_MAX = 12 * 25.4

export interface RunGap {
  wall: Segment
  level: 'floor' | 'wall'
  /** The run's cabinets, in order along the wall's axis (x on the back wall, y on a side wall). */
  ids: string[]
  /** Where the run may go: from the wall (or a corner cabinet's side) to the wall (or a corner cabinet). */
  startBound: number
  endBound: number
  startGap: number
  endGap: number
  total: number
  /** The end that stays put when one filler takes the whole gap: the corner end, else the start. */
  anchor: 'start' | 'end'
  startIsWall: boolean
  endIsWall: boolean
}

/**
 * Kitchen-2: runs shorter than their wall. For each wall and level (floor or wall cabinets): the back
 * wall runs from the left wall (or a left corner cabinet's side) to the right wall (or a right corner
 * cabinet); a side wall's run, when it turns a corner, from the front wall to the corner cabinet's
 * face. Gaps of up to 12 in are listed, overflow is left to `roomProblems`.
 */
export function runGaps(cabinets: CabinetInstance[], room: Room, place: (c: CabinetInstance) => CabinetPlacement, lib?: Library): RunGap[] {
  const placed = cabinets.map((c) => ({ c, pl: place(c), b: boxOf(c, place(c)) }))
  const gaps: RunGap[] = []
  for (const level of ['floor', 'wall'] as const) {
    const onLevel = placed.filter((o) => levelOf(o.c.params) === level)
    const corner = (side: 'left' | 'right') => onLevel.find((o) => cornerSide(o.c.params) === side && segmentOf(o.c, o.pl, room) === 'back')
    const L = corner('left')
    const R = corner('right')
    for (const wall of ['back', 'left', 'right'] as const) {
      const items = onLevel.filter((o) => segmentOf(o.c, o.pl, room) === wall && !cornerSide(o.c.params))
      if (!items.length) continue
      const along = wall === 'back' ? 'x' : 'y'
      const len = (b: Box) => (along === 'x' ? b.w : b.d)
      let startBound = 0
      let endBound: number
      let anchor: 'start' | 'end' = 'start'
      let startIsWall = true
      let endIsWall = true
      if (wall === 'back') {
        if (L) {
          startBound = L.b.x + L.b.w
          startIsWall = false
        }
        endBound = room.width
        if (R) {
          endBound = R.b.x
          endIsWall = false
        }
        anchor = L ? 'start' : R ? 'end' : 'start'
      } else {
        const C = wall === 'left' ? L : R
        if (!C) continue
        endBound = C.pl.y - blindFace(C.c.params, lib)
        endIsWall = false
        anchor = 'end'
      }
      const sorted = [...items].sort((a, b) => a.b[along] - b.b[along])
      const start = sorted[0].b[along]
      const last = sorted[sorted.length - 1]
      const end = last.b[along] + len(last.b)
      const startGap = start - startBound
      const endGap = endBound - end
      if (startGap < -TOUCH || endGap < -TOUCH) continue
      const total = Math.max(0, startGap) + Math.max(0, endGap)
      if (total <= 1 || total > FILL_GAP_MAX) continue
      gaps.push({ wall, level, ids: sorted.map((o) => o.c.id), startBound, endBound, startGap, endGap, total, anchor, startIsWall, endIsWall })
    }
  }
  return gaps
}

/** Next free cabinet number: B (base), W (wall), T (tall), F (filler), E (end panel). */
export function nextCabinetNumber(j: Pick<Job, 'cabinets'>, p: Pick<CarcassParams, 'kind' | 'panel'>) {
  const prefix = p.panel?.type === 'filler' ? 'F' : p.panel?.type === 'end-panel' ? 'E' : p.kind === 'wall' ? 'W' : p.kind === 'tall' ? 'T' : 'B'
  let n = 1
  while (j.cabinets.some((c) => c.number === `${prefix}${n}`)) n++
  return `${prefix}${n}`
}

/**
 * Kitchen-2: fill a run's gap with fillers, using `filler` (a filler template's params) sized to the
 * cabinet beside it. 'one': the run moves to its anchored end and one filler takes the whole gap at
 * the other end; 'split': the run is centred and a filler of half the gap goes at each end. A filler
 * against a wall gets the template's scribe allowance on the wall side. Every cabinet in the job is
 * given its own placement first. Returns the new fillers' ids.
 */
export function fillGap(job: Job, gap: RunGap, mode: 'one' | 'split', filler: CarcassParams, room: Room, place: (c: CabinetInstance) => CabinetPlacement, makeId: () => string): string[] {
  for (const c of job.cabinets) c.placement = place(c)
  const along = gap.wall === 'back' ? 'x' : 'y'
  const run = gap.ids.map((id) => job.cabinets.find((c) => c.id === id)).filter((c): c is CabinetInstance => !!c)
  if (!run.length) return []
  const shift = mode === 'split' ? gap.total / 2 - gap.startGap : gap.anchor === 'start' ? -gap.startGap : gap.endGap
  for (const c of run) c.placement = { ...c.placement!, [along]: c.placement![along] + shift }
  const ends: { at: 'start' | 'end'; width: number }[] = mode === 'split' ? [{ at: 'start', width: gap.total / 2 }, { at: 'end', width: gap.total / 2 }] : [{ at: gap.anchor === 'start' ? 'end' : 'start', width: gap.total }]
  const ids: string[] = []
  for (const e of ends) {
    const ref = e.at === 'start' ? run[0] : run[run.length - 1]
    const p: CarcassParams = JSON.parse(JSON.stringify(filler))
    p.kind = ref.params.kind
    p.height = ref.params.height
    p.depth = ref.params.depth
    p.width = Math.round(e.width * 1000) / 1000
    p.toeKick = { ...ref.params.toeKick }
    p.doorMaterialId = ref.params.doorMaterialId
    p.carcassMaterialId = ref.params.carcassMaterialId
    p.edgebands = { ...p.edgebands, door: ref.params.edgebands.door }
    const atWall = e.at === 'start' ? gap.startIsWall : gap.endIsWall
    if (p.panel?.type === 'filler') {
      // which way the wall is, seen from the filler's front: on the back wall the start is the left;
      // on the left wall (turned 270) the start (front wall) is its left; on the right wall (90) its right
      const startSide = gap.wall === 'right' ? 'right' : 'left'
      const endSide = startSide === 'left' ? 'right' : 'left'
      p.panel = { ...p.panel, scribeSide: atWall && p.panel.scribe > 0 ? (e.at === 'start' ? startSide : endSide) : 'none' }
    }
    const pos = e.at === 'start' ? gap.startBound : gap.endBound - p.width
    const rpl = ref.placement!
    const pl: CabinetPlacement =
      gap.wall === 'back'
        ? { x: pos, y: room.depth - p.depth, rotation: 0, z: rpl.z }
        : gap.wall === 'left'
          ? { x: 0, y: pos, rotation: 270, z: rpl.z }
          : { x: room.width - p.depth, y: pos, rotation: 90, z: rpl.z }
    const id = makeId()
    const idx = job.cabinets.indexOf(ref)
    const inst: CabinetInstance = { id, number: nextCabinetNumber(job, p), name: 'Filler', templateId: null, qty: 1, params: p, overrides: {}, placement: pl }
    // keep the job's order the walking order (left to right as seen in each elevation), so
    // "Arrange" lays the filler out where it was put; the right wall's run walks towards the front
    const after = gap.wall === 'right' ? e.at === 'start' : e.at === 'end'
    job.cabinets.splice(after ? idx + 1 : idx, 0, inst)
    ids.push(id)
  }
  return ids
}
