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

/** Snap a footprint to walls and to the other cabinets' edges. Tolerance is millimetres. */
export function snapPlacement(pl: CabinetPlacement, width: number, depth: number, others: { x: number; y: number; w: number; d: number }[], room: Room, tol = 12.7): CabinetPlacement {
  const fp = footprint(width, depth, pl)
  const xs = [0, room.width - fp.w]
  const ys = [0, room.depth - fp.d]
  for (const o of others) {
    xs.push(o.x, o.x + o.w, o.x - fp.w, o.x + o.w - fp.w)
    ys.push(o.y, o.y + o.d, o.y - fp.d, o.y + o.d - fp.d)
  }
  return { ...pl, x: nearest(pl.x, xs, tol), y: nearest(pl.y, ys, tol) }
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
