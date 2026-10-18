/**
 * Library-1: the library room the round's items were found on: open bookcases on all four walls, the
 * entry door in the front wall with a sliding bookcase door over it, a window in the left wall, and a
 * table made of custom parts (a top, four legs, two long and two short aprons). Built the way the app
 * builds it (each bookcase placed by hand, turned to face the room). Used by `library-1.test.ts` and
 * the screenshots.
 */
import { newPart } from '../src/cam/doc'
import type { CamPart } from '../src/cam/types'
import { defaultAppData } from '../src/core/defaults'
import type { AppData, CabinetInstance, CabinetPlacement, Job, Room } from '../src/core/types'
import { inch, usTall } from './polish-2-jobs'

export { inch }

export const LIBRARY_ROOM: Room = { width: inch(168), depth: inch(144), height: inch(96) }

/** An open bookcase: no doors, five shelves, 12" deep, 84" high on the toe kick. */
export function bookcase(width = 36, depth = 12) {
  const p = usTall(width)
  p.depth = inch(depth)
  p.doors = { ...p.doors, count: 0 }
  p.shelves = { ...p.shelves, count: 5 }
  return p
}

export function cab(number: string, params = bookcase(), placement?: CabinetPlacement, extra: Partial<CabinetInstance> = {}): CabinetInstance {
  return { id: `lib-${number.toLowerCase()}`, number, name: `Bookcase ${number}`, templateId: null, qty: 1, params, overrides: {}, ...(placement ? { placement } : {}), ...extra }
}

/** A table part from 1-1/2" stock (the placeholder MDF38). */
export function tablePart(id: string, name: string, length: number, width: number, qty = 1): CamPart {
  return newPart({ id, name, length: inch(length), width: inch(width), thickness: 38, materialId: 'mat-mdf38', qty, assembly: 'Table', updatedAt: '2026-10-01T00:00:00.000Z' })
}

/**
 * The library: on the back wall five bookcases from corner to corner; on the left wall two, from the
 * back run's front towards the front wall (a window between them and the front wall); on the right
 * wall two the same way; on the front wall the entry door 36" wide at 66" from the wall's left end
 * (seen from inside), a bookcase either side of it, and the sliding bookcase door over the door.
 */
export function libraryJob(): Job {
  const R = LIBRARY_ROOM
  const d12 = inch(12)
  const back = (x: number): CabinetPlacement => ({ x: inch(x), y: R.depth - d12, rotation: 0, z: 0 })
  const left = (y: number): CabinetPlacement => ({ x: 0, y: inch(y), rotation: 270, z: 0 })
  const right = (y: number): CabinetPlacement => ({ x: R.width - d12, y: inch(y), rotation: 90, z: 0 })
  const front = (x: number): CabinetPlacement => ({ x: inch(x), y: 0, rotation: 180, z: 0 })
  const cabinets = [
    cab('T1', bookcase(), back(0)),
    cab('T2', bookcase(), back(36)),
    cab('T3', bookcase(), back(72)),
    cab('T10', bookcase(), back(108)),
    cab('T11', bookcase(24), back(144)),
    // the left wall's run butts against the back run's front (132"), towards the front wall
    cab('T4', bookcase(), left(96)),
    cab('T5', bookcase(), left(60)),
    cab('T6', bookcase(), right(96)),
    cab('T7', bookcase(), right(60)),
    // the front wall seen from inside: its left end is the room's right side (x = 168")
    cab('T8', bookcase(), front(132)),
    cab('T9', bookcase(), front(0)),
    // the sliding bookcase door on its track 1/2" off the wall, over the entry door (66"..102" from the wall's left end = x 66..102)
    cab('S1', bookcase(38, 12), { x: inch(65), y: inch(0.5), rotation: 180, z: 0 }, { name: 'Sliding bookcase door', slidingDoor: true }),
  ]
  const top = tablePart('cp-top', 'Table top', 60, 36)
  const leg = tablePart('cp-leg', 'Leg', 28.5, 2.5, 4)
  const apronL = tablePart('cp-apron-l', 'Long apron', 52, 4, 2)
  const apronS = tablePart('cp-apron-s', 'Short apron', 28, 4, 2)
  return {
    id: 'job-library',
    number: 'L101',
    name: 'Library',
    customer: 'Library client',
    notes: '',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    room: {
      ...R,
      openings: [
        { id: 'op-entry', kind: 'door', wall: 'front', at: inch(66), width: inch(36), height: inch(80), sill: 0, name: 'D1' },
        { id: 'op-window', kind: 'window', wall: 'left', at: inch(12), width: inch(36), height: inch(48), sill: inch(36), name: 'W1' },
      ],
    },
    cabinets,
    camParts: [top, leg, apronL, apronS],
  }
}

export function libraryData(): AppData {
  const d = defaultAppData()
  d.settings.units = 'in'
  d.jobs = [libraryJob()]
  return d
}
