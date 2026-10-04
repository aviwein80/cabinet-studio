import { footprint } from './room'
import type { CabinetInstance, CabinetPlacement, CarcassParams, Room } from './types'

export type WallId = 'back' | 'front' | 'left' | 'right'

export const WALLS: { id: WallId; label: string }[] = [
  { id: 'back', label: 'Back wall' },
  { id: 'front', label: 'Front wall' },
  { id: 'left', label: 'Left wall' },
  { id: 'right', label: 'Right wall' },
]

const ON_WALL = 40

/** Closest wall whose footprint edge is within 40 mm. A corner tie prefers back, then front, then left. */
export function cabinetOnWall(fp: { x: number; y: number; w: number; d: number }, room: Room): WallId | null {
  const candidates: { wall: WallId; gap: number }[] = [
    { wall: 'back', gap: Math.abs(fp.y + fp.d - room.depth) },
    { wall: 'front', gap: Math.abs(fp.y) },
    { wall: 'left', gap: Math.abs(fp.x) },
    { wall: 'right', gap: Math.abs(fp.x + fp.w - room.width) },
  ]
  const hits = candidates.filter((h) => h.gap <= ON_WALL)
  hits.sort((a, b) => a.gap - b.gap)
  return hits[0]?.wall ?? null
}

/** True when the cabinet front points at someone standing in the room looking at this wall. */
export function facesViewer(wall: WallId, rotation: CabinetPlacement['rotation']) {
  return (wall === 'back' && rotation === 0) || (wall === 'front' && rotation === 180) || (wall === 'left' && rotation === 270) || (wall === 'right' && rotation === 90)
}

/** Horizontal axis of an elevation: viewer's left to viewer's right. */
export function alongWall(wall: WallId, fp: { x: number; y: number; w: number; d: number }, room: Room) {
  if (wall === 'back') return { x: fp.x, w: fp.w }
  if (wall === 'front') return { x: room.width - (fp.x + fp.w), w: fp.w }
  if (wall === 'left') return { x: room.depth - (fp.y + fp.d), w: fp.d }
  return { x: fp.y, w: fp.d }
}

export function wallLength(wall: WallId, room: Room) {
  return wall === 'left' || wall === 'right' ? room.depth : room.width
}

export interface FrontDivision {
  kind: 'toe' | 'drawer' | 'door'
  /** Room Z. */
  z0: number
  z1: number
  /** Fraction of the elevation width, viewer's left to right. */
  u0: number
  u1: number
}

export function frontDivisions(p: CarcassParams, z: number): FrontDivision[] {
  const out: FrontDivision[] = []
  const g = p.doors.gap
  const tk = p.kind === 'base' && p.toeKick.enabled ? p.toeKick.height : 0
  if (tk > 0) out.push({ kind: 'toe', z0: z, z1: z + tk, u0: 0, u1: 1 })
  const frontZ0 = p.kind === 'base' ? tk : g / 2
  const frontZ1 = p.kind === 'base' ? p.height - g : p.height - g / 2
  const span = frontZ1 - frontZ0
  const drawers = Math.max(0, Math.round(p.drawers?.count ?? 0))
  let drawerTop = frontZ0
  if (drawers > 0 && span > 0) {
    const mixed = p.doors.count > 0
    let frontH = mixed ? p.drawers.frontHeight : (span - (drawers - 1) * g) / drawers
    if (mixed && drawers * frontH + drawers * g > span - 80) frontH = (span - 80 - drawers * g) / drawers
    for (let i = 0; i < drawers; i++) {
      const z0 = frontZ0 + i * (frontH + g)
      drawerTop = z0 + frontH
      if (frontH > 1) out.push({ kind: 'drawer', z0: z + z0, z1: z + z0 + frontH, u0: 0, u1: 1 })
    }
  }
  if (p.doors.count > 0) {
    const dz0 = drawers > 0 ? drawerTop + g : frontZ0
    const dz1 = frontZ1
    if (dz1 - dz0 > 80) {
      for (let i = 0; i < p.doors.count; i++) out.push({ kind: 'door', z0: z + dz0, z1: z + dz1, u0: i / p.doors.count, u1: (i + 1) / p.doors.count })
    }
  }
  return out
}

export interface ElevationCabinet {
  id: string
  number: string
  name: string
  x: number
  w: number
  z: number
  h: number
  faces: boolean
  divisions: FrontDivision[]
}

export function elevationOf(cabinets: CabinetInstance[], room: Room, wall: WallId, place: (c: CabinetInstance) => CabinetPlacement): ElevationCabinet[] {
  const items: ElevationCabinet[] = []
  for (const c of cabinets) {
    const pl = place(c)
    const fp = footprint(c.params.width, c.params.depth, pl)
    if (cabinetOnWall(fp, room) !== wall) continue
    const span = alongWall(wall, fp, room)
    const faces = facesViewer(wall, pl.rotation)
    items.push({
      id: c.id,
      number: c.number,
      name: c.name,
      x: span.x,
      w: span.w,
      z: pl.z,
      h: c.params.height,
      faces,
      divisions: faces ? frontDivisions(c.params, pl.z) : [],
    })
  }
  return items.sort((a, b) => a.x - b.x)
}

/** Map an elevation drag (viewer's left, floor height) back onto the placement. */
export function placementFromElevation(pl: CabinetPlacement, width: number, depth: number, wall: WallId, alongX: number, z: number, room: Room): CabinetPlacement {
  const fp = footprint(width, depth, pl)
  const next = { ...pl, z }
  if (wall === 'back') next.x = alongX
  else if (wall === 'front') next.x = room.width - alongX - fp.w
  else if (wall === 'left') next.y = room.depth - alongX - fp.d
  else next.y = alongX
  return next
}
