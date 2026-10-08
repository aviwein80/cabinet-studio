/**
 * Polish-2: the "Real jobs" of the video tour, built the way the app builds them (templates copied
 * into the job, the room set, Arrange, Fill gap). Used by `polish-2.test.ts` to reproduce what was
 * found while recording, and by the screenshots.
 */
import { BASE_PARAMS, defaultAppData, KITCHEN_PRESETS } from '../src/core/defaults'
import { arrangeCabinets, fillGap, nextCabinetNumber, placementOf, runGaps } from '../src/core/room'
import type { AppData, CabinetInstance, CarcassParams, Job, Room } from '../src/core/types'

export const inch = (n: number) => Math.round(n * 25.4 * 1000) / 1000
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const preset = (id: string) => clone(KITCHEN_PRESETS.find((t) => t.id === id)!.params)

/** A US base, as the kitchen presets build it: 34-1/2" high, 24" deep, 4" toe kick set back 3". */
export function usBase(width: number, patch: (p: CarcassParams) => void = () => {}): CarcassParams {
  const p = clone(BASE_PARAMS)
  p.width = inch(width)
  p.height = inch(34.5)
  p.depth = inch(24)
  p.toeKick = { enabled: true, height: inch(4), setback: inch(3), board: false }
  patch(p)
  return p
}

export function usWall(width: number, patch: (p: CarcassParams) => void = () => {}): CarcassParams {
  const p = usBase(width)
  p.kind = 'wall'
  p.height = inch(30)
  p.depth = inch(12)
  p.top = 'full'
  p.toeKick = { ...p.toeKick, enabled: false }
  p.shelves = { ...p.shelves, count: 2 }
  patch(p)
  return p
}

/** The tour's "Tall 24" x 84"" pantry: two doors, four shelves, on the base toe kick. */
export function usTall(width = 24): CarcassParams {
  return usBase(width, (p) => {
    p.kind = 'tall'
    p.height = inch(84)
    p.top = 'full'
    p.shelves = { ...p.shelves, count: 4 }
  })
}

/**
 * The tour's "Base 18" 3-drawer": a US base set to three drawers in the cabinet editor (no doors,
 * no shelf) and saved as a template. It has no drawer-box material of its own.
 */
export function usDrawerBase(width = 18): CarcassParams {
  return usBase(width, (p) => {
    p.doors = { ...p.doors, count: 0 }
    p.shelves = { ...p.shelves, count: 0 }
    p.drawers = { count: 3, frontHeight: 152.4, slide: 'auto' }
  })
}

export const endPanel = (level: 'base' | 'wall' | 'tall') => preset(level === 'base' ? 'tpl-us-end-base' : level === 'wall' ? 'tpl-us-end-wall' : 'tpl-us-end-tall')
export const filler = (level: 'base' | 'wall') => preset(level === 'base' ? 'tpl-us-filler-3' : 'tpl-us-filler-3-wall')

let seq = 0
/** Add a cabinet as the Add dialog does (next number for its kind, the params copied). */
export function add(job: Job, name: string, params: CarcassParams): CabinetInstance {
  const c: CabinetInstance = { id: `cab-${job.number}-${++seq}`, number: nextCabinetNumber(job, params), name, templateId: null, qty: 1, params: clone(params), overrides: {} }
  job.cabinets.push(c)
  return c
}

export function newJob(number: string, name: string, room?: Room): Job {
  return { id: `job-${number}`, number, name, customer: name, notes: '', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', cabinets: [], ...(room ? { room } : {}) }
}

/** The room tab's "Arrange" / "Re-arrange along the back wall": every cabinet gets the arranged placement. */
export function arrange(job: Job, data: AppData) {
  const laid = arrangeCabinets(job.cabinets, job.room!, data.library)
  for (const c of job.cabinets) if (laid[c.id]) c.placement = laid[c.id]
}

/** The room tab's "Fill gap" on the first gap of a wall and level ('one' filler, or 'split'). */
export function fill(job: Job, data: AppData, mode: 'one' | 'split', level: 'floor' | 'wall' = 'floor') {
  const laid = arrangeCabinets(job.cabinets, job.room!, data.library)
  const place = (c: CabinetInstance) => placementOf(c, laid)
  const gap = runGaps(job.cabinets, job.room!, place, data.library).find((g) => g.level === level)
  if (!gap) throw new Error('no gap to fill')
  return fillGap(job, gap, mode, filler(level === 'wall' ? 'wall' : 'base'), job.room!, place, () => `cab-${job.number}-${++seq}`)
}

/** u02 / u10: the Ortiz kitchen. A blind corner, end panels at both open ends, 121" back wall, filled. */
export function ortizKitchen(data: AppData = defaultAppData()) {
  const job = newJob('J2052', 'Ortiz kitchen', { width: inch(121), depth: inch(96), height: inch(96) })
  add(job, 'End panel, base', { ...endPanel('base'), panel: { ...(endPanel('base').panel as Extract<CarcassParams['panel'], { type: 'end-panel' }>), side: 'left' } })
  add(job, 'Base 24"', usBase(24))
  add(job, 'Blind corner base 36"', preset('tpl-us-blind-base-36'))
  add(job, 'Sink base 36"', usBase(36, (p) => (p.shelves = { ...p.shelves, count: 0 })))
  add(job, 'Base 24"', usBase(24))
  add(job, 'Base 18" 3-drawer', usDrawerBase(18))
  add(job, 'End panel, base', endPanel('base'))
  arrange(job, data)
  fill(job, data, 'one')
  return job
}

/** u05: the Reyes laundry. A 24" x 84" tall cabinet and two wall cabinets on an 84" wall, no bases. */
export function laundry(data: AppData = defaultAppData()) {
  const job = newJob('J2055', 'Reyes laundry', { width: inch(84), depth: inch(72), height: inch(96) })
  add(job, 'Tall 24" x 84"', usTall(24))
  add(job, 'Wall 36"', usWall(36))
  add(job, 'Wall 24"', usWall(24))
  arrange(job, data)
  return job
}

/** u04: the Brooks pantry wall. Tall end panel, three 24" x 84" pantries, tall end panel, 76" wall, split filled. */
export function pantryWall(data: AppData = defaultAppData()) {
  const job = newJob('J2054', 'Brooks pantry', { width: inch(76), depth: inch(120), height: inch(96) })
  const left = endPanel('tall')
  if (left.panel?.type === 'end-panel') left.panel.side = 'left'
  add(job, 'End panel, tall', left)
  for (let i = 0; i < 3; i++) add(job, 'Tall 24" x 84"', usTall(24))
  add(job, 'End panel, tall', endPanel('tall'))
  arrange(job, data)
  fill(job, data, 'split')
  return job
}

/** u03: the Patel vanity. A 30" sink base and an 18" 3-drawer base at 31-1/2" x 21" in a 48" alcove. */
export function vanity(data: AppData = defaultAppData()) {
  const job = newJob('J2053', 'Patel vanity', { width: inch(48), depth: inch(60), height: inch(96) })
  add(job, 'Sink base 36"', usBase(30, (p) => ((p.height = inch(31.5)), (p.depth = inch(21)), (p.shelves = { ...p.shelves, count: 0 }))))
  add(job, 'Base 18" 3-drawer', usDrawerBase(18))
  job.cabinets[1].params.height = inch(31.5)
  job.cabinets[1].params.depth = inch(21)
  arrange(job, data)
  return job
}
