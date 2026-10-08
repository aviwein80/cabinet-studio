import { blindSpans } from './construction/carcass'
import { cornerSide, footprint } from './room'
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

/**
 * Horizontal axis of an elevation: viewer's left to viewer's right, for someone standing in the room
 * facing that wall. Facing the left wall, the front wall is on your left and the back wall on your
 * right; facing the right wall, the other way round (Kitchen-2: the two side walls were drawn
 * mirrored, so a corner cabinet showed at the wrong end).
 */
export function alongWall(wall: WallId, fp: { x: number; y: number; w: number; d: number }, room: Room) {
  if (wall === 'back') return { x: fp.x, w: fp.w }
  if (wall === 'front') return { x: room.width - (fp.x + fp.w), w: fp.w }
  if (wall === 'left') return { x: fp.y, w: fp.d }
  return { x: room.depth - (fp.y + fp.d), w: fp.d }
}

export function wallLength(wall: WallId, room: Room) {
  return wall === 'left' || wall === 'right' ? room.depth : room.width
}

export interface FrontDivision {
  /** Kitchen-2: `blind` the blind panel of a blind corner, `filler` a filler strip's face. */
  kind: 'toe' | 'drawer' | 'door' | 'blind' | 'filler'
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
  // Kitchen-2: a filler's face from the toe kick up; an end panel is drawn as its own box
  if (p.panel?.type === 'filler') {
    if (tk > 0) out.push({ kind: 'toe', z0: z, z1: z + tk, u0: 0, u1: 1 })
    out.push({ kind: 'filler', z0: z + tk, z1: z + p.height, u0: 0, u1: 1 })
    return out
  }
  if (p.panel) return out
  if (tk > 0) out.push({ kind: 'toe', z0: z, z1: z + tk, u0: 0, u1: 1 })
  const frontZ0 = p.kind === 'base' ? tk : g / 2
  const frontZ1 = p.kind === 'base' ? p.height - g : p.height - g / 2
  const span = frontZ1 - frontZ0
  // Kitchen-2: a blind corner's face: the blind panel and one door, no drawers
  if (p.corner?.type === 'blind') {
    const b = blindSpans(p, p.corner)
    if (b.panel) out.push({ kind: 'blind', z0: z + frontZ0, z1: z + frontZ1, u0: b.panel.x0 / p.width, u1: b.panel.x1 / p.width })
    if (b.door && span > 80) out.push({ kind: 'door', z0: z + frontZ0, z1: z + frontZ1, u0: b.door.x0 / p.width, u1: b.door.x1 / p.width })
    return out
  }
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
  /** Kitchen-2: what it is, for the drawing's fill. */
  kind: 'cabinet' | 'filler' | 'end-panel'
  /**
   * Kitchen-2: a corner cabinet seen end on, from the side wall whose run butts against its face. It
   * stands in the corner on that wall too; it is moved from the back wall's elevation or the plan.
   */
  endView?: boolean
}

/**
 * The cabinets on one wall, viewer's left to right. A blind corner cabinet stands on the back wall
 * and shows end on in the side wall's elevation too (Kitchen-2), at the corner end, so both walls
 * show the corner taken.
 */
export function elevationOf(cabinets: CabinetInstance[], room: Room, wall: WallId, place: (c: CabinetInstance) => CabinetPlacement): ElevationCabinet[] {
  const items: ElevationCabinet[] = []
  for (const c of cabinets) {
    const pl = place(c)
    const fp = footprint(c.params.width, c.params.depth, pl)
    const kind = c.params.panel?.type ?? 'cabinet'
    const on = cabinetOnWall(fp, room)
    if (on === wall) {
      const span = alongWall(wall, fp, room)
      const faces = facesViewer(wall, pl.rotation)
      items.push({ id: c.id, number: c.number, name: c.name, x: span.x, w: span.w, z: pl.z, h: c.params.height, faces, divisions: faces ? frontDivisions(c.params, pl.z) : [], kind })
      continue
    }
    // a corner cabinet in a back corner, seen from the side wall beside it
    const side = cornerSide(c.params)
    if (side && side === wall && on === 'back' && pl.rotation === 0) {
      const gap = side === 'left' ? fp.x : room.width - (fp.x + fp.w)
      if (gap > c.params.width) continue
      const span = alongWall(wall, fp, room)
      items.push({ id: c.id, number: c.number, name: c.name, x: span.x, w: span.w, z: pl.z, h: c.params.height, faces: false, divisions: [], kind, endView: true })
    }
  }
  return items.sort((a, b) => a.x - b.x)
}

/** Map an elevation drag (viewer's left, floor height) back onto the placement. */
export function placementFromElevation(pl: CabinetPlacement, width: number, depth: number, wall: WallId, alongX: number, z: number, room: Room): CabinetPlacement {
  const fp = footprint(width, depth, pl)
  const next = { ...pl, z }
  if (wall === 'back') next.x = alongX
  else if (wall === 'front') next.x = room.width - alongX - fp.w
  else if (wall === 'left') next.y = alongX
  else next.y = room.depth - alongX - fp.d
  return next
}

/** Rough width of a label in the drawing's sans font: about 0.58 of the font size per character. */
export const labelWidth = (text: string, size: number) => text.length * size * 0.58

/** A font size no larger than `size` at which `text` fits in `room` (never below a third of `size`). */
export function fitSize(text: string, size: number, room: number) {
  const w = labelWidth(text, size)
  return w <= room ? size : Math.max(size / 3, (size * room) / w)
}

/**
 * Polish-1: the size labels in a cabinet's elevation box, kept inside the box so neighbours' labels
 * never collide (18-19-1/2 in cabinets had "30" floor 54"" running into the next one). The width
 * sits at the top; the height, and the height off the floor for raised cabinets, at the bottom
 * right on one line when it fits, else stacked on two, each line shrunk to the box if needed.
 * `y` is up from the bottom of the box.
 */
export function elevationLabels(item: Pick<ElevationCabinet, 'w' | 'h' | 'z'>, font: number, fmt: (mm: number) => string) {
  const room = item.w * 0.92
  const small = font * 0.7
  const width = { text: fmt(item.w), size: fitSize(fmt(item.w), small, room) }
  const h = fmt(item.h)
  const floor = item.z > 1 ? `floor ${fmt(item.z)}` : ''
  const one = floor ? `${h}  ${floor}` : h
  const lines = labelWidth(one, small) <= room || !floor ? [one] : [h, floor]
  const size = Math.min(...lines.map((l) => fitSize(l, small, room)))
  return { width, size, lines: lines.map((text, i) => ({ text, y: size * (0.35 + (lines.length - 1 - i) * 1.15) })) }
}
