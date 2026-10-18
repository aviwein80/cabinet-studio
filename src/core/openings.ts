/**
 * Library-1: doors, windows and plain openings in the room's walls.
 *
 * An opening sits on one wall. Its position is measured along the wall as the wall's elevation shows
 * it: from the viewer's left end (someone standing in the room facing that wall) to the opening's
 * left edge. `sill` is its bottom above the floor (0 for a door or an opening down to the floor).
 *
 * Openings are room geometry only: they never change a cabinet, a part or a program. The room warns
 * when a cabinet stands in one (a sliding-door unit may cover one on purpose), and the run tools
 * (Arrange, Fill gap, a copy's free space, snapping) treat an opening like the end of the wall.
 *
 * This module has no imports from the room or elevation modules (both import it).
 */
import type { Unconfirmed } from './confirm'
import type { CabinetInstance, OpeningKind, Room, RoomOpening, UnitSystem } from './types'
import { formatLength } from './units'

export type OpeningWall = RoomOpening['wall']

export const OPENING_KINDS: OpeningKind[] = ['door', 'window', 'opening']
export const OPENING_LABEL: Record<OpeningKind, string> = { door: 'Door', window: 'Window', opening: 'Opening' }

/**
 * The size a new opening starts at: a 36" x 80" door, a 36" x 48" window 36" off the floor, a 36" x
 * 80" opening. These are PLACEHOLDERS (a Configure badge until the opening's sizes are typed).
 */
export const OPENING_DEFAULTS: Record<OpeningKind, { width: number; height: number; sill: number }> = {
  door: { width: 914.4, height: 2032, sill: 0 },
  window: { width: 914.4, height: 1219.2, sill: 914.4 },
  opening: { width: 914.4, height: 2032, sill: 0 },
}

/** A cabinet whose back is within this of a wall stands on it (as `segmentOf` and the elevations judge it). */
const ON_WALL = 40
const TOUCH = 0.5

export function wallLengthOf(wall: OpeningWall, room: Pick<Room, 'width' | 'depth'>) {
  return wall === 'left' || wall === 'right' ? room.depth : room.width
}

/** A position along a wall (from the viewer's left end) as room X (back, front) or Y (left, right). */
export function alongToRoom(wall: OpeningWall, s: number, room: Pick<Room, 'width' | 'depth'>) {
  if (wall === 'back') return s
  if (wall === 'front') return room.width - s
  if (wall === 'left') return s
  return room.depth - s
}

/** The room axis a wall runs along. */
export const wallAxis = (wall: OpeningWall): 'x' | 'y' => (wall === 'back' || wall === 'front' ? 'x' : 'y')

/** The opening's span along its wall as room coordinates on the wall's axis, low to high. */
export function openingRoomSpan(o: Pick<RoomOpening, 'wall' | 'at' | 'width'>, room: Pick<Room, 'width' | 'depth'>): [number, number] {
  const a = alongToRoom(o.wall, o.at, room)
  const b = alongToRoom(o.wall, o.at + o.width, room)
  return [Math.min(a, b), Math.max(a, b)]
}

export const openingsOf = (room: Pick<Room, 'openings'> | undefined | null) => room?.openings ?? []

/** A new opening of `kind` on `wall`, centred on the wall (or at its start when the wall is short), with the placeholder sizes. */
export function newOpening(kind: OpeningKind, wall: OpeningWall, room: Pick<Room, 'width' | 'depth' | 'openings'>, id: string): RoomOpening {
  const d = OPENING_DEFAULTS[kind]
  const len = wallLengthOf(wall, room)
  const at = Math.max(0, Math.round(((len - d.width) / 2) * 1000) / 1000)
  const n = openingsOf(room).filter((o) => o.kind === kind).length + 1
  return { id, kind, wall, at, width: d.width, height: d.height, sill: d.sill, name: `${kind === 'door' ? 'D' : kind === 'window' ? 'W' : 'O'}${n}`, placeholder: true }
}

/** Library-1: its sizes are still the starting placeholders (cleared as soon as one is typed). */
export function openingPlaceholder(o: Pick<RoomOpening, 'placeholder'>) {
  return o.placeholder === true
}

/** Library-1: the Configure badge of an opening still at its starting sizes (null once a size is typed). */
export function openingUnconfirmed(o: RoomOpening, units: UnitSystem): Unconfirmed | null {
  if (!openingPlaceholder(o)) return null
  const name = o.name || OPENING_LABEL[o.kind]
  return { key: `room:opening:${o.id}`, label: `${name} size`, value: `${formatLength(o.width, units)} x ${formatLength(o.height, units)}${o.sill > 0 ? `, sill ${formatLength(o.sill, units)}` : ''} (starting size, not measured)`, group: 'Room', target: { kind: 'room', key: `opening:${o.id}` } }
}

/** A box in room coordinates (as `roomProblems` uses). */
export type RoomBox = { x: number; y: number; w: number; d: number; z0: number; z1: number }

/**
 * The walls a box stands against (its face within 40 mm of the wall) and its span along each, from
 * the viewer's left end, as the wall's elevation shows it. A box in a corner stands against two.
 */
export function wallSpans(b: RoomBox, room: Pick<Room, 'width' | 'depth'>): { wall: OpeningWall; a: number; b: number }[] {
  const out: { wall: OpeningWall; a: number; b: number }[] = []
  if (Math.abs(b.y + b.d - room.depth) <= ON_WALL) out.push({ wall: 'back', a: b.x, b: b.x + b.w })
  if (Math.abs(b.y) <= ON_WALL) out.push({ wall: 'front', a: room.width - (b.x + b.w), b: room.width - b.x })
  if (Math.abs(b.x) <= ON_WALL) out.push({ wall: 'left', a: b.y, b: b.y + b.d })
  if (Math.abs(b.x + b.w - room.width) <= ON_WALL) out.push({ wall: 'right', a: room.depth - (b.y + b.d), b: room.depth - b.y })
  return out
}

/** How far a box stands in an opening (the smaller of the two overlaps, along the wall and in height), 0 when clear. */
export function overlapWithOpening(b: RoomBox, o: RoomOpening, room: Pick<Room, 'width' | 'depth'>) {
  let worst = 0
  for (const s of wallSpans(b, room)) {
    if (s.wall !== o.wall) continue
    const along = Math.min(s.b, o.at + o.width) - Math.max(s.a, o.at)
    const up = Math.min(b.z1, o.sill + o.height) - Math.max(b.z0, o.sill)
    if (along > TOUCH && up > TOUCH) worst = Math.max(worst, Math.min(along, up))
  }
  return worst
}

export interface OpeningConflict {
  cabinet: string
  opening: string
  /** How far it stands in the opening. */
  by: number
  /** A sliding-door unit covering the opening on purpose: shown as a note, not a warning. */
  intended: boolean
}

/**
 * Cabinets standing in an opening: a cabinet against a wall whose span along the wall and whose
 * height both overlap a door, window or opening in that wall. A base under a window (its top at or
 * below the sill) and a wall cabinet above a door are clear. A cabinet marked as a sliding-door unit
 * (`slidingDoor`) covers an opening on purpose: listed with `intended`.
 */
export function openingConflicts(cabinets: Pick<CabinetInstance, 'id' | 'slidingDoor'>[], boxes: (c: Pick<CabinetInstance, 'id'>) => RoomBox[], room: Room): OpeningConflict[] {
  const out: OpeningConflict[] = []
  const openings = openingsOf(room)
  if (!openings.length) return out
  for (const c of cabinets) {
    for (const o of openings) {
      const by = Math.max(0, ...boxes(c).map((b) => overlapWithOpening(b, o, room)))
      if (by > 0) out.push({ cabinet: c.id, opening: o.id, by, intended: c.slidingDoor === true })
    }
  }
  return out
}

/** "D1 (door)": an opening's name in a message. */
export function openingName(o: Pick<RoomOpening, 'kind' | 'name'>) {
  return `${o.name || OPENING_LABEL[o.kind]} (${o.kind === 'opening' ? 'opening' : o.kind})`
}

/** The room problem line for the conflicts (warnings only; intended ones are a separate note). */
export function openingConflictText(list: OpeningConflict[], room: Room, numberOf: (id: string) => string, units: UnitSystem) {
  const byId = new Map(openingsOf(room).map((o) => [o.id, o]))
  return list
    .filter((c) => !c.intended)
    .map((c) => `${numberOf(c.cabinet)} stands ${formatLength(c.by, units)} in ${openingName(byId.get(c.opening)!)} on the ${byId.get(c.opening)!.wall} wall.`)
    .join(' ')
}

/** The note for sliding-door units over an opening on purpose. */
export function intendedText(list: OpeningConflict[], room: Room, numberOf: (id: string) => string) {
  const byId = new Map(openingsOf(room).map((o) => [o.id, o]))
  return list
    .filter((c) => c.intended)
    .map((c) => `${numberOf(c.cabinet)} slides across ${openingName(byId.get(c.opening)!)}: a sliding-door unit, on purpose.`)
    .join(' ')
}

/**
 * The spans along a wall's room axis (x for the back and front walls, y for the side walls) that
 * openings on it block for something standing from `z0` to `z1`, low to high. Arrange, Fill gap and a
 * copy's free space keep out of them, as out of a tall cabinet's span.
 */
export function blockedSpans(room: Room, wall: OpeningWall, z0: number, z1: number): [number, number][] {
  return openingsOf(room)
    .filter((o) => o.wall === wall && Math.min(z1, o.sill + o.height) - Math.max(z0, o.sill) > TOUCH)
    .map((o) => openingRoomSpan(o, room))
    .sort((a, b) => a[0] - b[0])
}

/** Openings past their wall's end or above the ceiling (shown so a typo is not silent). */
export function openingsOutside(room: Room): string[] {
  return openingsOf(room)
    .filter((o) => o.at < -TOUCH || o.at + o.width > wallLengthOf(o.wall, room) + TOUCH || o.sill < -TOUCH || o.sill + o.height > room.height + TOUCH)
    .map((o) => o.id)
}

/**
 * Library-1: openings as boxes in the room (for the 3D view): the opening's rectangle on its wall,
 * `depth` thick, standing just outside the wall so it never hides a cabinet.
 */
export function openingBox(o: RoomOpening, room: Room, depth = 60): RoomBox {
  const [lo, hi] = openingRoomSpan(o, room)
  const z0 = o.sill
  const z1 = o.sill + o.height
  if (o.wall === 'back') return { x: lo, y: room.depth, w: hi - lo, d: depth, z0, z1 }
  if (o.wall === 'front') return { x: lo, y: -depth, w: hi - lo, d: depth, z0, z1 }
  if (o.wall === 'left') return { x: -depth, y: lo, w: depth, d: hi - lo, z0, z1 }
  return { x: room.width, y: lo, w: depth, d: hi - lo, z0, z1 }
}
