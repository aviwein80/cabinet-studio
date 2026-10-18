/**
 * Library-1: undo and redo for what is changed on the Room tab (positions typed or dragged, snap back
 * to the wall, Rotate, a width or depth there and the run it moves, a copy, the room's sizes, its
 * doors, windows and openings, custom parts placed in it).
 *
 * Each step keeps the room before and after the change. Undo puts back, item by item, what is still
 * as the step left it; anything changed again since (on the Room tab or elsewhere, e.g. a cabinet's
 * width in the cabinet editor) is left as it is and counted, as the material change's undo does.
 */
import type { CabinetInstance, Job, Room, RoomOpening, RoomPart } from './types'

/** The parts of a cabinet the Room tab changes; the rest (its name, its overrides...) is never touched by an undo. */
const CAB_FIELDS = ['placement', 'params', 'slidingDoor'] as const

export interface RoomSnapshot {
  size: Pick<Room, 'width' | 'depth' | 'height'>
  openings: RoomOpening[]
  cabinets: CabinetInstance[]
  roomParts: RoomPart[]
}

export interface RoomStep {
  jobId: string
  /** What the step did, for the Undo button ("Undo: move B3"). */
  label: string
  before: RoomSnapshot
  after: RoomSnapshot
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? null)) as T
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export function roomSnapshot(job: Pick<Job, 'room' | 'cabinets' | 'roomParts'>, fallback: Room): RoomSnapshot {
  const room = job.room ?? fallback
  return { size: { width: room.width, depth: room.depth, height: room.height }, openings: clone(room.openings ?? []), cabinets: clone(job.cabinets), roomParts: clone(job.roomParts ?? []) }
}

export function sameSnapshot(a: RoomSnapshot, b: RoomSnapshot) {
  return same(a, b)
}

/**
 * Put back a list of items keyed by id: an item the step added is removed (if unchanged since), one it
 * removed comes back where it was, one it changed goes back field by field (`fields`, or the whole
 * item) when that field is still as the step left it.
 */
function revertList<T extends { id: string }>(current: T[], before: T[], after: T[], fields?: readonly (keyof T)[]): { list: T[]; reverted: number; skipped: number } {
  let reverted = 0
  let skipped = 0
  let list = [...current]
  const inBefore = new Map(before.map((x) => [x.id, x]))
  const inAfter = new Map(after.map((x) => [x.id, x]))
  for (const a of after) {
    if (inBefore.has(a.id)) continue
    const cur = list.find((x) => x.id === a.id)
    if (!cur) continue
    if (same(cur, a)) {
      list = list.filter((x) => x.id !== a.id)
      reverted++
    } else skipped++
  }
  for (const [i, b] of before.entries()) {
    if (inAfter.has(b.id)) continue
    if (list.some((x) => x.id === b.id)) continue
    // back after the item it followed before the change, else at its old index
    const prev = i > 0 ? list.findIndex((x) => x.id === before[i - 1].id) : -1
    list.splice(prev >= 0 ? prev + 1 : Math.min(i, list.length), 0, clone(b))
    reverted++
  }
  for (const b of before) {
    const a = inAfter.get(b.id)
    if (!a) continue
    const idx = list.findIndex((x) => x.id === b.id)
    if (idx < 0) continue
    const cur = { ...list[idx] }
    const keys = fields ?? ([...new Set([...Object.keys(b), ...Object.keys(a)])] as (keyof T)[])
    let changed = false
    for (const k of keys) {
      if (same(b[k], a[k])) continue
      if (!same(cur[k], a[k])) {
        skipped++
        continue
      }
      if (b[k] === undefined) delete cur[k]
      else cur[k] = clone(b[k])
      changed = true
      reverted++
    }
    if (changed) list[idx] = cur
  }
  return { list, reverted, skipped }
}

/** Undo `step` on the job (in place). Returns how many settings went back, and how many were left (changed since). */
export function undoRoomStep(job: Job, step: Pick<RoomStep, 'before' | 'after'>, fallback: Room): { reverted: number; skipped: number } {
  let reverted = 0
  let skipped = 0
  const room: Room = { ...(job.room ?? fallback) }
  for (const k of ['width', 'depth', 'height'] as const) {
    if (step.before.size[k] === step.after.size[k]) continue
    if (room[k] === step.after.size[k]) {
      room[k] = step.before.size[k]
      reverted++
    } else skipped++
  }
  const op = revertList(room.openings ?? [], step.before.openings, step.after.openings)
  room.openings = op.list
  if (!room.openings.length) delete room.openings
  job.room = room
  const cabs = revertList(job.cabinets, step.before.cabinets, step.after.cabinets, CAB_FIELDS as unknown as (keyof CabinetInstance)[])
  job.cabinets = cabs.list
  const rp = revertList(job.roomParts ?? [], step.before.roomParts, step.after.roomParts)
  job.roomParts = rp.list
  if (!job.roomParts.length) delete job.roomParts
  return { reverted: reverted + op.reverted + cabs.reverted + rp.reverted, skipped: skipped + op.skipped + cabs.skipped + rp.skipped }
}

/** The step that redoes an undone one. */
export const redoOf = (step: RoomStep): RoomStep => ({ ...step, before: step.after, after: step.before })

/** Steps kept per job (the oldest are dropped). */
export const ROOM_UNDO_LIMIT = 50
