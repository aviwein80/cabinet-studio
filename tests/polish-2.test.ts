import { describe, expect, it } from 'vitest'
import { cutFreeEarly, makeEntity, moveCutOutsLast, newPart, withNewOp } from '../src/cam/doc'
import { BUILTIN_DOOR_STYLES, buildDoor } from '../src/cam/doors'
import { rect } from '../src/cam/geom'
import { defaultOp, orderByTool } from '../src/cam/ops'
import { generatePart } from '../src/cam/toolpath'
import type { CamOp } from '../src/cam/types'
import { thumbFrame } from '../src/components/thumbFrame'
import { costByOptions } from '../src/core/areas'
import { featuresOf } from '../src/core/features'
import { contentsLabel } from '../src/components/kindLabel'
import { lCornerUnconfirmed, placeholderBoard } from '../src/core/confirm'
import { EDGEBAND_OVERHANG, edgebandUsage } from '../src/core/cutlist'
import { defaultAppData, DRAWER_BOARD_ID, DRAWER_BOARD_PLACEHOLDER, drawerBoard, KITCHEN_PRESETS } from '../src/core/defaults'
import { layoutOf, markUntouched } from '../src/core/manualNest'
import { normalizeData } from '../src/core/normalize'
import { bomCsv } from '../src/core/output'
import { outputKey, runJob } from '../src/core/pipeline'
import { sampleJob } from '../src/core/sample'
import { cabinetOnWall, elevationLabels, elevationOf, labelWidth, narrowLabelRows } from '../src/core/elevation'
import { arrangeCabinets, fillersPastWall, pastWallTolerance, placementOf, pushNeighbours, roomProblems, runGaps, shrinkToFit } from '../src/core/room'
import type { CabinetInstance, Job } from '../src/core/types'
import { fineLength, fineText, formatLength, parseLength, runLength, sizeText, toolSize } from '../src/core/units'
import { add, arrange, inch, laundry, newJob, ortizKitchen, pantryWall, usBase, usDrawerBase, usWall, vanity } from './polish-2-jobs'

// Polish-2: fixes for what was found while recording the "Real jobs" video tour. One block per item.

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const d0 = defaultAppData()
const lib = d0.library

const inchData = () => {
  const d = defaultAppData()
  d.settings.units = 'in'
  return d
}
/** A job with the pie-cut corner base preset (its bottom, top and shelf are L parts). */
function pieJob() {
  const j = newJob('J2051', 'Novak kitchen')
  add(j, 'Pie-cut corner base 36" x 36"', clone(KITCHEN_PRESETS.find((t) => t.id === 'tpl-us-pie-base-36')!.params))
  return j
}

describe('Polish-2 A: inch mode shows inches everywhere (mm mode unchanged)', () => {
  it('thin lengths: an exact fraction when they are one, else decimal inches, never rounded to 1/16', () => {
    expect(fineLength(1, 'in')).toBe('0.039"')
    expect(fineLength(6, 'in')).toBe('0.236"')
    expect(fineLength(0.4, 'in')).toBe('0.016"')
    expect(fineLength(12.7, 'in')).toBe('1/2"')
    expect(fineLength(25.4, 'in')).toBe('1"')
    expect(fineLength(0, 'in')).toBe('0"')
    // millimetres as before
    expect(fineLength(1, 'mm')).toBe('1')
    expect(fineLength(6, 'mm')).toBe('6')
    expect(fineText(6, 'mm')).toBe('6 mm')
    expect(fineText(6, 'in')).toBe('0.236"')
  })

  it('1: the L parts\' inside corner radius: the job field, its badge and the part note are in inches', () => {
    const d = inchData()
    const j = pieJob()
    // the field on the Cabinets tab and the part's own radius in the editor (NumField / LenInput `fine`): not rounded to 1/4" or 1"
    expect(fineLength(6, 'in')).toBe('0.236"')
    expect(fineLength(25, 'in')).toBe('0.984"')
    expect(formatLength(6, 'in')).toBe('1/4"')
    expect(lCornerUnconfirmed(j, d.machine, 6, (mm) => fineText(mm, 'in'))[0].value).toBe('0.236" (the cut-out tool\'s radius)')
    // the nesting part detail and the label say it in inches
    const notes = runJob(j, d).labels.flatMap((l) => l.notes).filter((n) => n.startsWith('Inside corner'))
    expect(notes.length).toBeGreaterThan(0)
    expect(new Set(notes)).toEqual(new Set(['Inside corner R0.236"']))
    // millimetres unchanged
    const mm = defaultAppData()
    expect(new Set(runJob(j, mm).labels.flatMap((l) => l.notes).filter((n) => n.startsWith('Inside corner')))).toEqual(new Set(['Inside corner R6 mm']))
    expect(lCornerUnconfirmed(j, mm.machine, 6)[0].value).toBe("6 mm (the cut-out tool's radius)")
  })

  it('2: edgeband totals in feet and the overhang heading in inches; metres and "50 mm" in a mm shop', () => {
    const d = defaultAppData()
    const out = runJob(sampleJob(), d)
    expect(out.edgebands.length).toBeGreaterThan(0)
    for (const e of out.edgebands) {
      expect(runLength(e.length, 'mm')).toBe(`${e.metres} m`)
      expect(runLength(e.length, 'in')).toBe(`${(Math.round((e.length / 304.8) * 10) / 10).toFixed(1)} ft`)
    }
    expect(runLength(30480, 'in')).toBe('100.0 ft')
    expect(runLength(12345, 'mm')).toBe('12.35 m')
    expect(EDGEBAND_OVERHANG).toBe(50)
    expect(sizeText(EDGEBAND_OVERHANG, 'mm')).toBe('50 mm')
    expect(sizeText(EDGEBAND_OVERHANG, 'in')).toBe('1-15/16"')
    // the length behind the metres is the same total
    const usage = edgebandUsage(out.instances, d.library)
    for (const e of usage) expect(e.metres).toBe(Math.round(e.length / 10) / 100)
  })

  it('3: BOM CSV: sheet sizes in inches and edgeband in feet in an inch shop; byte-identical in mm', () => {
    const mm = defaultAppData()
    const out = runJob(sampleJob(), mm)
    const before = bomCsv(out, mm)
    expect(before).toContain('"Melamine PB 18 white 3658x1524"')
    expect(before).toMatch(/\r\nEdgeband,EB-WHT-1\.0,"ABS white 1\.0 x 22",\d+(\.\d+)?,m\r\n/)
    const d = inchData()
    const csv = bomCsv(runJob(sampleJob(), d), d)
    expect(csv).toContain('"Melamine PB 18 white 144 x 60 in"')
    expect(csv).not.toMatch(/3658|1524/)
    const band = out.edgebands.find((e) => e.code === 'EB-WHT-1.0')!
    expect(csv).toContain(`Edgeband,EB-WHT-1.0,"ABS white 1.0 x 22",${(Math.round((band.length / 304.8) * 10) / 10).toFixed(1)},ft\r\n`)
    // the hardware lines are the same
    expect(csv.split('\r\n').filter((l) => l.startsWith('Hardware'))).toEqual(before.split('\r\n').filter((l) => l.startsWith('Hardware')))
  })

  it('4: the material dialog\'s "Costed by" says per ft² next to the price per ft² in an inch shop', () => {
    expect(costByOptions(true)[0]).toEqual({ value: 'area', label: 'Area (per ft²)' })
    expect(costByOptions(false)[0]).toEqual({ value: 'area', label: 'Area (per m²)' })
    expect(costByOptions(true)[1]).toEqual({ value: 'weight', label: 'Weight (per kg)' })
  })

  it('5: a 1 mm edgeband reads 0.039" (not 1/16"), in the library table and its edit field', () => {
    // the library's edgeband T column and the edit dialog's Thickness are `fine`
    for (const b of defaultAppData().library.edgebands) expect(fineLength(b.thickness, 'in')).toBe(b.thickness === 1 ? '0.039"' : '0.016"')
    expect(formatLength(1, 'in')).toBe('1/16"')
    // sizes still round to 1/16 (the band's 22 mm width)
    expect(formatLength(22, 'in')).toBe('7/8"')
  })

  it('6: the Add hole dialog shows drill sizes exactly in inch mode (an 8 mm hole is "8 mm", not 5/16")', () => {
    // its Diameter and Depth are `tool` fields
    expect(toolSize(8, 'in')).toBe('8 mm')
    expect(toolSize(7.9375, 'in')).toBe('5/16"')
    expect(toolSize(12, 'in')).toBe('12 mm')
    expect(formatLength(8, 'in')).toBe('5/16"')
  })
})


describe('Polish-2 B: the room', () => {
  const placeOf = (j: Job) => (c: CabinetInstance) => placementOf(c, arrangeCabinets(j.cabinets, j.room!, lib))
  const num = (j: Job, ids: string[]) => ids.map((id) => j.cabinets.find((c) => c.id === id)!.number)
  const byNo = (j: Job, n: string) => j.cabinets.find((c) => c.number === n)!

  it('7: the back-wall elevation shows a tall cabinet in the back-left corner of a wall with no bases (laundry)', () => {
    const j = laundry()
    const place = placeOf(j)
    // the tall cabinet's back edge lands 2e-13 mm off the back wall of the 72" deep room, while it is exactly on the left wall
    const t1 = place(byNo(j, 'T1'))
    expect(t1.y + byNo(j, 'T1').params.depth - j.room!.depth).not.toBe(0)
    expect(elevationOf(j.cabinets, j.room!, 'back', place, lib).map((e) => e.number)).toEqual(['T1', 'W1', 'W2'])
    expect(elevationOf(j.cabinets, j.room!, 'left', place, lib).map((e) => e.number)).toEqual([])
    const tall = elevationOf(j.cabinets, j.room!, 'back', place, lib)[0]
    expect(tall).toMatchObject({ x: 0, z: 0, h: inch(84), faces: true })
    expect(tall.divisions.filter((d) => d.kind === 'door')).toHaveLength(2)
    // an exact tie still prefers the back wall, and a cabinet only on the left wall is still on the left wall
    expect(cabinetOnWall({ x: 0, y: inch(48), w: inch(24), d: inch(24) }, j.room!)).toBe('back')
    expect(cabinetOnWall({ x: 0, y: inch(10), w: inch(24), d: inch(24) }, j.room!)).toBe('left')
  })

  it('8 (not reproduced): a cabinet set to Doors: None has no doors in its elevation', () => {
    const j = laundry()
    byNo(j, 'W2').params.doors.count = 0
    const w2 = elevationOf(j.cabinets, j.room!, 'back', placeOf(j), lib).find((e) => e.number === 'W2')!
    expect(w2.divisions).toEqual([])
  })

  it('9: a size change in a room as Arrange left it keeps it arranged (the vanity: no second Arrange)', () => {
    // u03: a 36" sink base and an 18" drawer base in a 48" alcove: the drawer base does not fit and is returned on the left wall
    const j = newJob('J2053', 'Patel vanity', { width: inch(48), depth: inch(84), height: inch(96) })
    add(j, 'Sink base 36"', usBase(36))
    add(j, 'Base 18" 3-drawer', usDrawerBase(18))
    arrange(j, d0)
    const [b1, b2] = j.cabinets
    expect(b2.placement).toMatchObject({ x: 0, rotation: 270 })
    // narrowed to 30" (Room tab or cabinet editor): the drawer base comes back onto the back wall beside it
    b1.params.width = inch(30)
    expect(pushNeighbours(j.cabinets, b1.id, { width: inch(36) }, j.room!, lib)).toEqual([b2.id])
    expect(b1.placement).toMatchObject({ x: 0, rotation: 0 })
    expect(b2.placement!.x).toBeCloseTo(inch(30), 6)
    expect(b2.placement!.rotation).toBe(0)
    expect(b2.placement!.y + b2.params.depth).toBeCloseTo(j.room!.depth, 6)
    // shallower and lower (31-1/2" x 21"): both keep their backs on the wall, nothing to re-arrange
    b1.params.depth = inch(21)
    pushNeighbours(j.cabinets, b1.id, { width: inch(30), depth: inch(24) }, j.room!, lib)
    b2.params.depth = inch(21)
    pushNeighbours(j.cabinets, b2.id, { width: inch(18), depth: inch(24) }, j.room!, lib)
    for (const c of [b1, b2]) expect(c.placement!.y + inch(21)).toBeCloseTo(j.room!.depth, 6)
    const laid = arrangeCabinets(j.cabinets, j.room!, lib)
    for (const c of j.cabinets) {
      for (const k of ['x', 'y', 'z'] as const) expect(c.placement![k]).toBeCloseTo(laid[c.id][k], 6)
      expect(c.placement!.rotation).toBe(laid[c.id].rotation)
    }
    expect(roomProblems(j.cabinets, j.room!, (c) => c.placement!, lib, 'in')).toMatchObject({ overlaps: [], outside: [] })
    // widened again past the alcove: as Arrange would, the drawer base goes back into the return
    b1.params.width = inch(36)
    expect(pushNeighbours(j.cabinets, b1.id, { width: inch(30) }, j.room!, lib)).toEqual([b2.id])
    expect(b2.placement).toMatchObject({ x: 0, rotation: 270 })
  })

  it('9: a size change still moves only the neighbours once a cabinet was moved by hand', () => {
    const j = newJob('J2053', 'Patel vanity', { width: inch(48), depth: inch(84), height: inch(96) })
    add(j, 'Sink base 36"', usBase(36))
    add(j, 'Base 18" 3-drawer', usDrawerBase(18))
    arrange(j, d0)
    const [b1, b2] = j.cabinets
    b2.placement = { ...b2.placement!, y: b2.placement!.y - inch(6) }
    b1.params.width = inch(30)
    expect(pushNeighbours(j.cabinets, b1.id, { width: inch(36) }, j.room!, lib)).toEqual([])
    expect(b2.placement).toMatchObject({ x: 0, rotation: 270 })
  })

  it('9: a filler\'s new width keeps the run closed; a cabinet without its own placement in an arranged room moves its neighbours', () => {
    const j = ortizKitchen()
    const f1 = byNo(j, 'F1')
    const e2 = byNo(j, 'E2')
    const x = f1.placement!.x
    f1.params.width = inch(2)
    pushNeighbours(j.cabinets, f1.id, { width: 83.6 }, j.room!, lib)
    expect(f1.placement!.x).toBeCloseTo(x, 6)
    expect(e2.placement!.x + e2.params.width).toBeCloseTo(x, 6)
    // a cabinet with no placement of its own (added after Arrange): narrowing it still moves the placed one beside it
    const k = laundry()
    const w1 = byNo(k, 'W1')
    const w2 = byNo(k, 'W2')
    expect(w2.placement!.x).toBeCloseTo(inch(60), 6)
    delete w1.placement
    w1.params.width = inch(30)
    expect(pushNeighbours(k.cabinets, w1.id, { width: inch(36) }, k.room!, lib)).toEqual([w2.id])
    expect(w2.placement!.x).toBeCloseTo(inch(54), 6)
    expect(placeOf(k)(w1).x).toBeCloseTo(inch(24), 6)
  })

  it('10: a filler typed to the width shown for the gap (1-5/16") fits the wall after Re-arrange, as Fill gap\'s does', () => {
    // u10: the Ortiz back wall re-measured at 119"; F1 (3-5/16") is removed and the gap measured again
    const j = ortizKitchen()
    j.room!.width = inch(119)
    const f1 = byNo(j, 'F1')
    j.cabinets = j.cabinets.filter((c) => c !== f1)
    const gap = runGaps(j.cabinets, j.room!, placeOf(j), lib)[0]
    expect(gap.total).toBeCloseTo(32.8, 6)
    expect(formatLength(gap.total, 'in')).toBe('1-5/16"')
    // the filler typed to what was shown is 0.54 mm wider than the gap
    j.cabinets.push(f1)
    f1.params.width = parseLength('1-5/16', 'in')!
    arrange(j, d0)
    const over = f1.placement!.x + f1.params.width - j.room!.width
    expect(over).toBeCloseTo(0.5375, 6)
    expect(roomProblems(j.cabinets, j.room!, (c) => c.placement!, lib, 'in').outside).toEqual([])
    // the check itself is not loosened beyond the rounding of a 1/16" size (1/32"), nor in millimetres
    expect(pastWallTolerance('in')).toBeCloseTo(25.4 / 32, 9)
    expect(pastWallTolerance('mm')).toBe(0.5)
    expect(roomProblems(j.cabinets, j.room!, (c) => c.placement!, lib, 'mm').outside).toEqual([f1.id])
    f1.params.width = parseLength('1-3/8', 'in')!
    arrange(j, d0)
    expect(num(j, roomProblems(j.cabinets, j.room!, (c) => c.placement!, lib, 'in').outside)).toEqual(['F1'])
  })

  it('12: the numbers of narrow neighbours (end panel and filler) above the elevation are stacked, not run together', () => {
    // u02 / u10: E2 (the 11/16" end panel) and F1 beside it at the right end of the Ortiz back wall
    const j = ortizKitchen()
    const items = elevationOf(j.cabinets, j.room!, 'back', placeOf(j), lib)
    const font = Math.max(j.room!.width, j.room!.height) / 36
    const narrow = (i: { w: number }) => i.w < font * 2.2
    expect(items.filter(narrow).map((i) => i.number)).toEqual(['E2', 'F1'])
    const rows = narrowLabelRows(items, font * 0.6, narrow)
    const row = (n: string) => rows.get(items.find((i) => i.number === n)!.id)
    expect([row('E2'), row('F1')]).toEqual([0, 1])
    // their boxes are closer than a label is wide: on one row they would overlap
    const [e2, f1] = items.filter(narrow)
    expect(f1.x + f1.w / 2 - (e2.x + e2.w / 2)).toBeLessThan(labelWidth('E2', font * 0.6))
    // the pantry wall: narrow items far apart (end panel, filler at each end) keep the first row
    const p = pantryWall()
    const pItems = elevationOf(p.cabinets, p.room!, 'back', placeOf(p), lib)
    const pFont = Math.max(p.room!.width, p.room!.height) / 36
    const pRows = narrowLabelRows(pItems, pFont * 0.6, (i) => i.w < pFont * 2.2)
    const byNumber = Object.fromEntries(pItems.filter((i) => pRows.has(i.id)).map((i) => [i.number, pRows.get(i.id)]))
    expect(byNumber).toEqual({ F1: 0, E1: 1, E2: 0, F2: 1 })
    // the labels across wider boxes are fitted inside them (Polish-1, unchanged)
    expect(elevationLabels({ w: inch(18), h: inch(30), z: inch(54) }, font, (mm) => formatLength(mm, 'in')).lines.map((l) => l.text)).toEqual(['30"', 'floor 54"'])
  })

  it('11: Re-arrange with an oversize filler past the wall warns and offers to shrink it to fit', () => {
    const j = ortizKitchen()
    j.room!.width = inch(119)
    arrange(j, d0)
    const f1 = byNo(j, 'F1')
    const p = roomProblems(j.cabinets, j.room!, (c) => c.placement!, lib, 'in')
    expect(num(j, p.outside)).toEqual(['F1'])
    const shrink = fillersPastWall(j.cabinets, j.room!, (c) => c.placement!, 'in')
    expect(shrink).toHaveLength(1)
    expect(shrink[0].id).toBe(f1.id)
    expect(shrink[0].width).toBeCloseTo(32.8, 6)
    expect(shrink[0].placement).toEqual(f1.placement)
    // shrunk as offered: it meets the end panel and the wall, nothing else moves
    const before = j.cabinets.map((c) => ({ ...c.placement! }))
    f1.params.width = shrink[0].width
    f1.placement = shrink[0].placement
    expect(roomProblems(j.cabinets, j.room!, (c) => c.placement!, lib, 'mm')).toMatchObject({ overlaps: [], outside: [] })
    expect(fillersPastWall(j.cabinets, j.room!, (c) => c.placement!, 'mm')).toEqual([])
    expect(j.cabinets.map((c) => c.placement)).toEqual(before)
    expect(f1.placement!.x + f1.params.width).toBeCloseTo(j.room!.width, 6)
    // past the left wall, or a filler on the left wall past the front wall: the wall end is cut back, the run end stays
    const filler = { params: { ...ortizKitchen().cabinets[0].params, width: inch(3), depth: inch(24) } }
    expect(shrinkToFit(filler, { x: -10, y: inch(48), rotation: 0, z: 0 }, j.room!)).toEqual({ width: inch(3) - 10, placement: { x: 0, y: inch(48), rotation: 0, z: 0 } })
    expect(shrinkToFit(filler, { x: 0, y: -20, rotation: 270, z: 0 }, j.room!)).toEqual({ width: inch(3) - 20, placement: { x: 0, y: 0, rotation: 270, z: 0 } })
    // inside the walls, past the wall across its run (too deep), or nothing left of it: no offer
    expect(shrinkToFit(filler, { x: 100, y: inch(48), rotation: 0, z: 0 }, j.room!)).toBeNull()
    expect(shrinkToFit(filler, { x: -10, y: inch(80), rotation: 0, z: 0 }, j.room!)).toBeNull()
    expect(shrinkToFit(filler, { x: -inch(3) + 1, y: inch(48), rotation: 0, z: 0 }, j.room!)).toBeNull()
  })
})

describe('Polish-2 C: job editing', () => {
  it('13: the job card counts drawers ("3 drawers", not "0 doors · 0 shelf")', () => {
    expect(contentsLabel(usDrawerBase(18))).toBe('3 drawers')
    expect(contentsLabel(usBase(24))).toBe('2 doors · 1 shelf')
    expect(contentsLabel(usWall(30))).toBe('2 doors · 2 shelves')
    expect(contentsLabel(usBase(24, (p) => ((p.drawers.count = 1), (p.doors.count = 1))))).toBe('1 drawer · 1 door · 1 shelf')
    expect(contentsLabel(usBase(24, (p) => ((p.doors.count = 0), (p.shelves.count = 0))))).toBe('no doors, drawers or shelves')
  })

  it('14: typing in the job notes does not work the job out again (the output key leaves out notes and save time)', () => {
    const d = inchData()
    const j = ortizKitchen(d)
    const key = outputKey(j, d)
    // a 63-part job: about 0.6 s to work out, each key typed in the notes used to do it again
    expect(runJob(j, d).instances).toHaveLength(63)
    expect(outputKey({ ...j, notes: 'Re-measured: back wall 119"', updatedAt: '2026-10-08T12:00:00.000Z' }, d)).toBe(key)
    // anything the output depends on still changes it
    const wider = clone(j)
    wider.cabinets[1].params.width += 25.4
    expect(outputKey(wider, d)).not.toBe(key)
    expect(outputKey({ ...j, name: 'Ortiz kitchen rev B' }, d)).not.toBe(key)
    const d2 = clone(d)
    d2.library.materials[0].sheetLength = 2440
    expect(outputKey(j, d2)).not.toBe(key)
    const d3 = clone(d)
    d3.settings.units = 'mm'
    expect(outputKey(j, d3)).not.toBe(key)
    const d4 = clone(d)
    d4.machine.throughDepth += 0.5
    expect(outputKey(j, d4)).not.toBe(key)
  })

  it('15: drawer boxes default to the 16 mm drawer-box board, so TANDEM is not warned about on every job', () => {
    const d = defaultAppData()
    for (const j of [ortizKitchen(d), vanity(d)]) {
      const out = runJob(j, d)
      expect(out.issues.filter((i) => /TANDEM allows drawer sides/.test(i.message))).toEqual([])
      const sides = out.instances.filter((i) => /^drawer-\d-side/.test(i.part.key))
      expect(sides.length).toBeGreaterThan(0)
      expect(new Set(sides.map((i) => i.materialId))).toEqual(new Set([DRAWER_BOARD_ID]))
      expect(new Set(sides.map((i) => i.thickness))).toEqual(new Set([16]))
    }
    // the "Base 18" 3-drawer" has no box material of its own: it is the drawer-box board
    expect(usDrawerBase().drawers.boxMaterialId).toBeUndefined()
    expect(drawerBoard(d.library)!.id).toBe(DRAWER_BOARD_ID)
    // a box board chosen on purpose is used, and an 18 mm one is still warned about by name
    const v = vanity(d)
    v.cabinets[1].params.drawers.boxMaterialId = 'mat-pb18-white'
    expect(runJob(v, d).issues.find((i) => /TANDEM allows drawer sides/.test(i.message))!.message).toMatch(/18 mm drawer-box board \(PB18-WHT\)/)
  })

  it('15: a library with no 16 mm board gets a placeholder drawer-box board with a Configure badge', () => {
    const raw = clone(defaultAppData())
    raw.library.materials = raw.library.materials.filter((m) => m.thickness !== 16)
    raw.jobs = [vanity(raw)]
    const d = normalizeData(raw)
    const board = d.library.materials.find((m) => m.placeholder)!
    expect(board).toMatchObject({ id: DRAWER_BOARD_PLACEHOLDER.id, code: 'DRAWER-16', thickness: 16, placeholder: true })
    expect(drawerBoard(d.library)).toEqual(board)
    const out = runJob(d.jobs[0], d)
    expect(out.issues.filter((i) => /TANDEM allows drawer sides/.test(i.message))).toEqual([])
    expect(new Set(out.instances.filter((i) => /^drawer-\d-side/.test(i.part.key)).map((i) => i.materialId))).toEqual(new Set([board.id]))
    // the badge, until confirmed (or saved as the shop's own board: the flag goes)
    const item = placeholderBoard(board, d.machine)!
    expect(item).toMatchObject({ key: 'material:mat-drawer16:board', group: 'Materials', target: { kind: 'material', materialId: 'mat-drawer16', part: 'board' } })
    expect(placeholderBoard(board, { confirmed: [item.key] })).toBeNull()
    expect(placeholderBoard({ ...board, placeholder: undefined }, d.machine)).toBeNull()
    // loading again does not add a second one; a library that has a 16 mm board gets none
    expect(normalizeData(clone(d)).library.materials.filter((m) => m.placeholder)).toHaveLength(1)
    expect(normalizeData(clone(defaultAppData())).library.materials.some((m) => m.placeholder)).toBe(false)
    const other = clone(defaultAppData())
    other.library.materials = other.library.materials.map((m) => (m.thickness === 16 ? { ...m, id: 'mat-maple16', code: 'PLY16-MAPLE', name: 'Maple ply 16' } : m))
    const n = normalizeData(other)
    expect(n.library.materials.some((m) => m.placeholder)).toBe(false)
    expect(drawerBoard(n.library)!.id).toBe('mat-maple16')
  })
})

describe('Polish-2 D: nesting', () => {
  /** Can these widths be packed into `bins` bands of `cap` each? (exhaustive, small inputs) */
  function packs(widths: number[], bins: number, cap: number) {
    const w = [...widths].sort((a, b) => b - a)
    const load = new Array<number>(bins).fill(0)
    const go = (i: number): boolean => {
      if (i === w.length) return true
      const tried = new Set<number>()
      for (let b = 0; b < bins; b++) {
        if (tried.has(load[b]) || load[b] + w[i] > cap + 1e-9) continue
        tried.add(load[b])
        load[b] += w[i]
        if (go(i + 1)) return true
        load[b] -= w[i]
      }
      return false
    }
    return go(0)
  }

  it('16: three 24" x 84" pantries nest on 8 sheets, the fewest possible (the 84" parts set the count)', () => {
    const d = defaultAppData()
    const j = pantryWall(d)
    const out = runJob(j, d)
    const count = (code: string) => out.programs.filter((p) => p.materialCode === code).length
    expect(out.programs).toHaveLength(8)
    expect([count('PB18-WHT'), count('HDF6-WHT')]).toEqual([6, 2])
    // why: a 5 x 12 ft sheet takes an 84" part only along its length, and never two end to end, so
    // every sheet holds its 84" parts side by side across its 60" width
    const ns = d.settings.nesting
    const spacing = out.nest.spacing
    const usableL = 3658 - 2 * ns.edgeTrim
    const usableW = 1524 - 2 * ns.edgeTrim
    for (const code of ['PB18-WHT', 'HDF6-WHT']) {
      const mat = d.library.materials.find((m) => m.code === code)!
      const long = out.instances.filter((i) => i.materialId === mat.id && Math.max(i.cutLength, i.cutWidth) > usableW)
      for (const i of long) expect(2 * Math.max(i.cutLength, i.cutWidth) + spacing).toBeGreaterThan(usableL)
      const widths = long.map((i) => Math.min(i.cutLength, i.cutWidth) + spacing)
      // ... and no fewer sheets can hold them (an exhaustive check, independent of the nester)
      const fewest = [1, 2, 3, 4, 5, 6, 7, 8].find((k) => packs(widths, k, usableW + spacing))!
      expect(fewest).toBe(count(code))
    }
    // PB18: eight 24"-wide pieces (sides, end panels) and six 11-13/16" doors; two wide ones fill a sheet's width
    const pb = out.instances.filter((i) => i.materialId === 'mat-pb18-white')
    expect(pb.filter((i) => i.cutLength > 2000 && i.cutWidth > 600)).toHaveLength(8)
    expect(pb.filter((i) => i.cutLength > 2000 && i.cutWidth > 290 && i.cutWidth < 310)).toHaveLength(6)
  })

  it('17: saving an edited layout marks only the sheets changed by hand; the others stay "nested automatically"', () => {
    const d = defaultAppData()
    const j = pantryWall(d)
    const auto = runJob(j, d)
    const draft = layoutOf(auto.nest)
    // one part moved on sheet 3, the rest as the nester left them
    draft[2].placements[0] = { ...draft[2].placements[0], x: draft[2].placements[0].x + 5 }
    const saved = markUntouched(draft, auto.nest)
    expect(saved.map((s) => !!s.auto)).toEqual(auto.nest.sheets.map((_, i) => i !== 2))
    j.nestEdit = { savedAt: '2026-10-08T12:00:00.000Z', sheets: saved }
    const after = runJob(j, d)
    expect(after.nest.sheets.map((s) => !!s.manual)).toEqual(auto.nest.sheets.map((_, i) => i === 2))
    // a layout saved before (no flag): every saved sheet laid out by hand, as before
    j.nestEdit = { savedAt: '2026-10-08T12:00:00.000Z', sheets: layoutOf(auto.nest) }
    expect(runJob(j, d).nest.sheets.every((s) => s.manual)).toBe(true)
    // saved again unchanged: a sheet laid out by hand stays so
    const again = markUntouched(layoutOf(after.nest), after.nest)
    expect(again.map((s) => !!s.auto)).toEqual(auto.nest.sheets.map((_, i) => i !== 2))
  })
})

describe('Polish-2 E: custom parts and CAM', () => {
  const shaker = BUILTIN_DOOR_STYLES.find((s) => s.id === 'ds-shaker')!
  /** u08: the Kim replacement door, 15" x 30" shaker in MDF, hinged left, 128 mm pull near the top. */
  const kimDoor = () =>
    buildDoor({ name: 'Kim door', styleId: shaker.id, width: inch(15), height: inch(30), qty: 2, materialId: 'mat-mdf18', thickness: 18, hinge: 'left', pull: '128', pullAt: 'top', values: {}, grain: 'none' }, shaker).part

  it('18: the door dialog draws a 15" x 30" door standing up (taller than wide), hinge edge on the left', () => {
    const part = kimDoor()
    // the part lies with its height along X, as it is cut
    expect([part.length, part.width]).toEqual([inch(30), inch(15)])
    const box = { minX: 0, minY: 0, maxX: part.length, maxY: part.width }
    const flat = thumbFrame(box)
    expect(flat.width).toBeGreaterThan(flat.height)
    const up = thumbFrame(box, true)
    expect(up.height).toBeGreaterThan(up.width)
    expect(up.height / up.width).toBeCloseTo(flat.width / flat.height, 9)
    // part (x, y) is drawn at (-y, -x): the pull holes (on the hinge-free edge, small y) are on the right
    const [vx, , vw] = up.viewBox.split(' ').map(Number)
    const pulls = part.entities.filter((e) => e.tag === 'pull')
    expect(pulls.length).toBe(2)
    for (const e of pulls) {
      const c = e.g.t === 'circle' ? e.g.c : null
      expect(-c!.y).toBeGreaterThan(vx + vw / 2)
    }
    // ... and the higher pull hole is higher on the screen (x runs up the door: the pull is near the top)
    expect(Math.max(...pulls.map((e) => (e.g.t === 'circle' ? e.g.c.x : 0)))).toBeGreaterThan(part.length / 2)
  })

  it('19: the hinge cups\' mark is the turned-over program (a note, not a warning); the export check still lists it', () => {
    const d = defaultAppData()
    const part = kimDoor()
    const paths = generatePart(part, d.machine)
    const cups = paths.find((tp) => tp.name.startsWith('Hinge cups'))!
    expect(cups.warnings).toEqual([])
    expect(cups.notes).toEqual(['2 hole(s) on face 6 (underside) go into a separate program run after the part is turned over end for end.'])
    // the 35 mm bit is matched exactly; not a placeholder tool (the whole table is, with its own badge)
    expect(cups.drills).toEqual([{ hole: 35, face: 6, tool: 204, diameter: 35, fits: true }])
    expect(d.machine.tools.find((t) => t.number === 204)!.placeholder).toBeFalsy()
    // with custom-part output on (test only; the switch stays off), the export check says it as before
    const on = clone(d)
    on.settings.features = { ...on.settings.features, camMprOutput: true }
    const j = newJob('J2066', 'Kim replacement doors')
    j.camParts = [part]
    const msgs = runJob(j, on).issues.filter((i) => i.code === 'CAM_TOOLPATH').map((i) => i.message)
    expect(msgs.some((m) => /Hinge cups \(Salice, 2\): 2 hole\(s\) on face 6 \(underside\) go into a separate program/.test(m))).toBe(true)
    expect(featuresOf(d.settings).camMprOutput).toBe(false)
  })

  it('22: inside work added to a part goes before its cut-out; a new cut-out goes last; Sort by tool keeps it last', () => {
    const part = newPart({ length: 400, width: 300 })
    const sq = makeEntity({ t: 'contour', c: rect(100, 100, 200, 100) }, 'machining')
    part.entities.push(sq)
    const cut = defaultOp('profile', [part.outlineId!], { name: 'Cut out', levels: { ...defaultOp('profile', []).levels, through: true } } as Partial<CamOp>)
    part.ops = [cut]
    const pocket = defaultOp('pocket', [sq.id], { name: 'Pocket' })
    const p1 = { ...part, ops: withNewOp(part, pocket) }
    expect(p1.ops.map((o) => o.name)).toEqual(['Pocket', 'Cut out'])
    expect(cutFreeEarly(p1)).toEqual([])
    // drilling too (it runs first in the program anyway); a second cut-out goes to the end
    const drill = defaultOp('drill', [], { name: 'Drill' })
    const p2 = { ...p1, ops: withNewOp(p1, drill) }
    expect(p2.ops.map((o) => o.name)).toEqual(['Pocket', 'Drill', 'Cut out'])
    const cut2 = { ...cut, id: 'cut2', name: 'Cut out again' }
    expect(withNewOp(p2, cut2).map((o) => o.name)).toEqual(['Pocket', 'Drill', 'Cut out', 'Cut out again'])
    // a part with no cut-out: at the end, as before
    const bare = { ...part, ops: [pocket] }
    expect(withNewOp(bare, drill).map((o) => o.name)).toEqual(['Pocket', 'Drill'])
    // "Sort by tool" can put the cut-out's cutter first: the cut-out still ends up last
    const d = defaultAppData()
    const tools = generatePart(p1, d.machine)
    const toolOf = (o: CamOp) => tools.find((t) => t.opId === o.id)?.tool ?? null
    const byTool = orderByTool([...p1.ops].reverse(), toolOf, [...new Set([toolOf(cut)!.number, ...d.machine.tools.map((t) => t.number)])])
    expect(byTool.map((o) => o.name)).toEqual(['Cut out', 'Pocket'])
    expect(moveCutOutsLast({ ...p1, ops: byTool }).map((o) => o.name)).toEqual(['Pocket', 'Cut out'])
  })
})
