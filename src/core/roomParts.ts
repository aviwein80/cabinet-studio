/**
 * Library-1: a job's custom parts placed in the room (a table made of a top, legs and aprons): shown
 * in the plan, the elevations and the 3D view as plain solids, each its outline drawn through its
 * thickness. Display only: placing a part changes nothing about its machining, its nesting or its
 * programs (the custom part itself is not touched; the placements are kept on the job).
 *
 * A placement stands the panel one of three ways, then turns it about the vertical like a cabinet:
 * - 'flat': face up, its length along the room's X (at rotation 0), its width along Y (a table top);
 * - 'edge': on its long edge, length along X, width upright, its face to the front (an apron);
 * - 'end': on its end, length upright, width along X, its face to the front (a leg).
 * (x, y) is the corner of its footprint nearest the room's origin, z its underside above the floor.
 * Parts in the same group move and turn together.
 */
import { partOutline as camOutline } from '@/cam/doc'
import { toPoints } from '@/cam/geom'
import type { CamPart } from '@/cam/types'
import { toRoom } from './room'
import type { Job, Part, Room, RoomPart, Vec2, Vec3 } from './types'

export type Stand = RoomPart['stand']
export const STANDS: Stand[] = ['flat', 'edge', 'end']
export const STAND_LABEL: Record<Stand, string> = { flat: 'Flat (a top)', edge: 'On its long edge (an apron)', end: 'On its end (a leg)' }

/** The part's own size seen standing as placed (before the turn): along X, along Y (front to back), up. */
export function standSize(p: Pick<CamPart, 'length' | 'width' | 'thickness'>, stand: Stand): { w: number; d: number; h: number } {
  if (stand === 'flat') return { w: p.length, d: p.width, h: p.thickness }
  if (stand === 'edge') return { w: p.length, d: p.thickness, h: p.width }
  return { w: p.width, d: p.thickness, h: p.length }
}

/** The footprint in the room (the turn swaps its sides at 90 and 270), and its height. */
export function roomPartBox(p: Pick<CamPart, 'length' | 'width' | 'thickness'>, rp: Pick<RoomPart, 'x' | 'y' | 'z' | 'rotation' | 'stand'>) {
  const s = standSize(p, rp.stand)
  const turned = rp.rotation === 90 || rp.rotation === 270
  return { x: rp.x, y: rp.y, w: turned ? s.d : s.w, d: turned ? s.w : s.d, z0: rp.z, z1: rp.z + s.h }
}

/** Part point (x along its length, y along its width, `depth` below its face) to the stood, unturned local frame. */
function standPoint(p: Pick<CamPart, 'thickness'>, stand: Stand, x: number, y: number, depth: number): Vec3 {
  const up = p.thickness - depth
  if (stand === 'flat') return [x, y, up]
  // the face to the front (local y = 0); the back face at y = thickness
  if (stand === 'edge') return [x, depth, y]
  return [y, depth, x]
}

/** The part's frame in the room, for the 3D view (the same frame convention as a cabinet part). */
export function roomPartFrame(p: Pick<CamPart, 'length' | 'width' | 'thickness'>, rp: Pick<RoomPart, 'x' | 'y' | 'z' | 'rotation' | 'stand'>): Part['frame'] {
  const s = standSize(p, rp.stand)
  const pl = { x: rp.x, y: rp.y, z: rp.z, rotation: rp.rotation }
  const at = (x: number, y: number, depth: number) => {
    const q = standPoint(p, rp.stand, x, y, depth)
    return toRoom(q[0], q[1], q[2], pl, s.w, s.d)
  }
  const o = at(0, 0, 0)
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0] + 0, a[1] - b[1] + 0, a[2] - b[2] + 0]
  const u = sub(at(1, 0, 0), o)
  const v = sub(at(0, 1, 0), o)
  // toWorld goes down from the face along -n
  const n = sub(o, at(0, 0, 1))
  return { origin: o, u, v, n }
}

/** The outline of a custom part (its cut-out contour), as points in part coordinates. */
export function camPartOutline(cp: CamPart): Vec2[] {
  try {
    return toPoints(camOutline(cp).contour, 0.5).map((q) => ({ x: Math.round(q.x * 1000) / 1000, y: Math.round(q.y * 1000) / 1000 }))
  } catch {
    return [
      { x: 0, y: 0 },
      { x: cp.length, y: 0 },
      { x: cp.length, y: cp.width },
      { x: 0, y: cp.width },
    ]
  }
}

/** The placements whose part is still in the job (a deleted part's placements are left out). */
export function placedParts(job: Pick<Job, 'roomParts' | 'camParts'>) {
  const parts = new Map((job.camParts ?? []).map((p) => [p.id, p]))
  return (job.roomParts ?? []).flatMap((rp) => {
    const part = parts.get(rp.partId)
    return part ? [{ rp, part }] : []
  })
}

/** Each placed custom part as a `Part` in the room (role 'custom', its outline through its thickness), for the 3D view. */
export function roomPartSolids(job: Pick<Job, 'roomParts' | 'camParts'>): Part[] {
  return placedParts(job).map(({ rp, part }) => ({
    key: `rp:${rp.id}`,
    name: part.name,
    role: 'custom',
    materialId: part.materialId ?? '',
    length: part.length,
    width: part.width,
    thickness: part.thickness,
    grain: part.grain,
    edges: {},
    ops: [],
    outline: camPartOutline(part),
    frame: roomPartFrame(part, rp),
  }))
}

/** A 2D shape drawn for a placed part: a polygon (room X, Y or along-wall, Z), and whether it is its outline or its edge. */
export interface PartShape {
  id: string
  partId: string
  name: string
  points: [number, number][]
}

/**
 * The placed parts seen from above: a flat part is its outline; a part standing up is the strip its
 * outline spans across its thickness.
 */
export function planShapes(job: Pick<Job, 'roomParts' | 'camParts'>): PartShape[] {
  return placedParts(job).map(({ rp, part }) => {
    const f = roomPartFrame(part, rp)
    const pts = camPartOutline(part)
    const world = (x: number, y: number, depth: number) => {
      const o = f.origin
      return [o[0] + f.u[0] * x + f.v[0] * y - f.n[0] * depth, o[1] + f.u[1] * x + f.v[1] * y - f.n[1] * depth] as [number, number]
    }
    if (rp.stand === 'flat') return { id: rp.id, partId: part.id, name: part.name, points: pts.map((q) => world(q.x, q.y, 0)) }
    return { id: rp.id, partId: part.id, name: part.name, points: hullRect([...pts.map((q) => world(q.x, q.y, 0)), ...pts.map((q) => world(q.x, q.y, part.thickness))]) }
  })
}

/**
 * The placed parts in a wall's elevation (looking at that wall from inside the room): a part whose
 * face looks at the wall is its outline, otherwise the strip it spans. `along` maps a room point to
 * the elevation's horizontal axis (viewer's left to right).
 */
export function elevationShapes(job: Pick<Job, 'roomParts' | 'camParts'>, along: (p: Vec3) => number, facing: 'x' | 'y'): PartShape[] {
  return placedParts(job).map(({ rp, part }) => {
    const f = roomPartFrame(part, rp)
    const pts = camPartOutline(part)
    const world = (x: number, y: number, depth: number): [number, number] => {
      const o = f.origin
      const p: Vec3 = [o[0] + f.u[0] * x + f.v[0] * y - f.n[0] * depth, o[1] + f.u[1] * x + f.v[1] * y - f.n[1] * depth, o[2] + f.u[2] * x + f.v[2] * y - f.n[2] * depth]
      return [along(p), p[2]]
    }
    // the face looks along the view when its normal is along the axis the viewer looks down
    const n = facing === 'x' ? f.n[0] : f.n[1]
    if (Math.abs(n) > 0.5) return { id: rp.id, partId: part.id, name: part.name, points: pts.map((q) => world(q.x, q.y, 0)) }
    return { id: rp.id, partId: part.id, name: part.name, points: hullRect([...pts.map((q) => world(q.x, q.y, 0)), ...pts.map((q) => world(q.x, q.y, part.thickness))]) }
  })
}

/** The bounding rectangle of points (a standing part seen edge on is the strip it spans). */
function hullRect(pts: [number, number][]): [number, number][] {
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]
}

/** The placements moved together with `id`: its group's, or itself alone. */
export function groupOf(job: Pick<Job, 'roomParts'>, id: string): RoomPart[] {
  const all = job.roomParts ?? []
  const me = all.find((r) => r.id === id)
  if (!me) return []
  return me.group ? all.filter((r) => r.group === me.group) : [me]
}

/** The footprint and height span of a set of placements (a group). */
export function groupBox(job: Pick<Job, 'camParts'>, list: RoomPart[]) {
  const parts = new Map((job.camParts ?? []).map((p) => [p.id, p]))
  const boxes = list.flatMap((rp) => {
    const p = parts.get(rp.partId)
    return p ? [roomPartBox(p, rp)] : []
  })
  if (!boxes.length) return null
  const x0 = Math.min(...boxes.map((b) => b.x))
  const y0 = Math.min(...boxes.map((b) => b.y))
  const x1 = Math.max(...boxes.map((b) => b.x + b.w))
  const y1 = Math.max(...boxes.map((b) => b.y + b.d))
  return { x: x0, y: y0, w: x1 - x0, d: y1 - y0, z0: Math.min(...boxes.map((b) => b.z0)), z1: Math.max(...boxes.map((b) => b.z1)) }
}

/** Move a set of placements by (dx, dy, dz) (a group moves as one). */
export function moveGroup(list: RoomPart[], dx: number, dy: number, dz: number) {
  for (const rp of list) {
    rp.x = Math.round((rp.x + dx) * 1000) / 1000
    rp.y = Math.round((rp.y + dy) * 1000) / 1000
    rp.z = Math.round((rp.z + dz) * 1000) / 1000
  }
}

/**
 * Turn a set of placements a quarter turn (clockwise seen from above, as a cabinet's Rotate) about the
 * middle of their footprint: each part's footprint is turned about that middle and its own rotation
 * goes on by 90.
 */
export function turnGroup(job: Pick<Job, 'camParts'>, list: RoomPart[]) {
  const box = groupBox(job, list)
  if (!box) return
  const cx = box.x + box.w / 2
  const cy = box.y + box.d / 2
  const parts = new Map((job.camParts ?? []).map((p) => [p.id, p]))
  for (const rp of list) {
    const p = parts.get(rp.partId)
    if (!p) continue
    const b = roomPartBox(p, rp)
    // the footprint's middle turned about (cx, cy): rotation r -> r + 90 turns the front from -Y to -X
    // (`CabinetPlacement`), clockwise seen from above (Y towards the back wall): (x, y) -> (y, -x)
    const mx = b.x + b.w / 2 - cx
    const my = b.y + b.d / 2 - cy
    const nx = cx + my
    const ny = cy - mx
    rp.rotation = (((rp.rotation + 90) % 360) as RoomPart['rotation'])
    const nb = roomPartBox(p, rp)
    rp.x = Math.round((nx - nb.w / 2) * 1000) / 1000
    rp.y = Math.round((ny - nb.d / 2) * 1000) / 1000
  }
}

/** A new placement of a custom part: flat on the floor in the middle of the room (a table top's starting place). */
export function newRoomPart(part: Pick<CamPart, 'id' | 'length' | 'width' | 'thickness'>, room: Pick<Room, 'width' | 'depth'>, id: string, group?: string): RoomPart {
  const s = standSize(part, 'flat')
  return { id, partId: part.id, x: Math.round(((room.width - s.w) / 2) * 1000) / 1000, y: Math.round(((room.depth - s.d) / 2) * 1000) / 1000, z: 0, rotation: 0, stand: 'flat', ...(group ? { group } : {}) }
}

/** How many copies of each part are placed (a part made 4 times can be placed 4 times). */
export function placedCount(job: Pick<Job, 'roomParts'>, partId: string) {
  return (job.roomParts ?? []).filter((r) => r.partId === partId).length
}
