import type { CabinetInstance, CabinetPlacement, CarcassParams, Room, Vec3 } from './types'

/** 12 ft × 10 ft × 8 ft. Wall cabinets sit 54 in off the floor. */
export const DEFAULT_ROOM: Room = { width: 3657.6, depth: 3048, height: 2438.4 }
export const WALL_ELEVATION = 54 * 25.4

export function footprint(width: number, depth: number, pl: CabinetPlacement) {
  const turned = pl.rotation === 90 || pl.rotation === 270
  return { x: pl.x, y: pl.y, w: turned ? depth : width, d: turned ? width : depth }
}

/** Cabinet-local point (X width, Y depth, Z up) into room coordinates. */
export function toRoom(x: number, y: number, z: number, pl: CabinetPlacement, width: number, depth: number): Vec3 {
  switch (pl.rotation) {
    case 0:
      return [pl.x + x, pl.y + y, pl.z + z]
    case 90:
      return [pl.x + y, pl.y + x, pl.z + z]
    case 180:
      return [pl.x + (width - x), pl.y + (depth - y), pl.z + z]
    case 270:
      return [pl.x + (depth - y), pl.y + (width - x), pl.z + z]
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

/**
 * Line floor cabinets along the back wall, left to right. A cabinet that does not fit becomes a
 * return on the left wall, butted against the side of the back run (the corner). Wall cabinets go
 * on the same wall at 54 in, skipping any span a tall cabinet already occupies.
 */
export function arrangeCabinets(cabinets: Pick<CabinetInstance, 'id' | 'params'>[], room: Room): Record<string, CabinetPlacement> {
  const out: Record<string, CabinetPlacement> = {}
  const floor = cabinets.filter((c) => c.params.kind !== 'wall')
  const walls = cabinets.filter((c) => c.params.kind === 'wall')
  let x = 0
  let backDepth = 0
  const tall: [number, number][] = []
  let wrapped = false
  for (const c of floor) {
    const w = c.params.width
    const d = c.params.depth
    if (!wrapped && x + w <= room.width + 0.5) {
      out[c.id] = { x, y: room.depth - d, rotation: 0, z: 0 }
      if (c.params.kind === 'tall') tall.push([x, x + w])
      backDepth = Math.max(backDepth, d)
      x += w
    } else {
      wrapped = true
      out[c.id] = { x: 0, y: room.depth - Math.max(backDepth, d) - w, rotation: 90, z: 0 }
    }
  }
  let wx = 0
  for (const c of walls) {
    const w = c.params.width
    let guard = 0
    while (tall.some(([a, b]) => wx < b - 0.5 && wx + w > a + 0.5) && guard++ < 8) {
      const hit = tall.find(([a, b]) => wx < b - 0.5 && wx + w > a + 0.5)!
      wx = hit[1]
    }
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

const TOUCH = 0.5

/**
 * Polish-1: a cabinet in the room changed width (from `oldWidth` to its current width). Its
 * neighbours further along the same run (same turn, overlapping across the run and in height) that
 * were butted against it, or that it now overlaps, move along by the change, one after another,
 * so the run stays closed and nothing overlaps. Narrowing pulls the butted ones back. Only
 * cabinets with a placement of their own are involved (an arranged layout reflows by itself).
 * Returns the ids moved.
 */
export function pushNeighbours(cabinets: CabinetInstance[], id: string, oldWidth: number, room: Room): string[] {
  const cab = cabinets.find((c) => c.id === id)
  if (!cab?.placement || Math.abs(cab.params.width - oldWidth) < 1e-9) return []
  const arranged = arrangeCabinets(
    cabinets.map((c) => (c.id === id ? { ...c, params: { ...c.params, width: oldWidth } } : c)),
    room,
  )
  const pl = cab.placement
  const along = turned(pl.rotation) ? 'y' : 'x'
  const across = along === 'x' ? 'y' : 'x'
  const len = (b: Box) => (along === 'x' ? b.w : b.d)
  const span = (b: Box) => (across === 'x' ? b.w : b.d)
  const me = boxOf(cab, pl)
  const run = cabinets
    .filter((c) => c.id !== id)
    .map((c) => ({ c, pl: placementOf(c, arranged) }))
    .filter(({ c, pl: p }) => {
      if (turned(p.rotation) !== turned(pl.rotation)) return false
      const b = boxOf(c, p)
      const crossOverlap = Math.min(b[across] + span(b), me[across] + span(me)) - Math.max(b[across], me[across]) > TOUCH
      const zOverlap = Math.min(b.z1, me.z1) - Math.max(b.z0, me.z0) > TOUCH
      return crossOverlap && zOverlap && b[along] > me[along] + TOUCH
    })
    .sort((a, b) => a.pl[along] - b.pl[along])
  let endOld = me[along] + (oldWidth - cab.params.width) + len(me)
  let endNew = me[along] + len(me)
  const moved: string[] = []
  for (const { c, pl: p } of run) {
    const b = boxOf(c, p)
    const start = b[along]
    const butted = Math.abs(start - endOld) <= TOUCH
    const overlapped = start < endNew - TOUCH
    if (!butted && !overlapped) break
    const shift = endNew - start
    endOld = start + len(b)
    if (Math.abs(shift) < 1e-9) {
      endNew = endOld
      continue
    }
    c.placement = { ...p, [along]: p[along] + shift }
    endNew = start + shift + len(b)
    moved.push(c.id)
  }
  return moved
}

/**
 * Polish-1: what in the room needs attention: cabinets whose boxes overlap (pairs of ids), and
 * cabinets that run past a wall. Shown in the room so an overlap is never silent.
 */
export function roomProblems(cabinets: CabinetInstance[], room: Room, place: (c: CabinetInstance) => CabinetPlacement) {
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
  return { overlaps, outside }
}
