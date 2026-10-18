import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { evalLength } from '../src/cam/expr'
import { doorStylesOf, parseDoorCsv } from '../src/cam/doors'
import { parseBatchCsv } from '../src/core/batch'
import { materialPlaceholder, placeholderBoard, placeholderStock } from '../src/core/confirm'
import { defaultAppData, defaultLibrary, THICK_STOCK_PLACEHOLDERS } from '../src/core/defaults'
import { expandJob } from '../src/core/cutlist'
import { applySwap, BAND_GROUP_LABEL, BAND_GROUPS, previewSwap, undoSwap } from '../src/core/jobMaterials'
import { importMaterials, parseCsv } from '../src/core/library/import'
import { normalizeData } from '../src/core/normalize'
import { blockedSpans, newOpening, openingBox, openingConflicts, openingUnconfirmed, overlapWithOpening, wallSpans } from '../src/core/openings'
import { bomCsv } from '../src/core/output'
import { mprFiles, runJob } from '../src/core/pipeline'
import { jobQuote, quoteCsv } from '../src/core/quote'
import { quotePdf } from '../src/core/quotePdf'
import {
  arrangeCabinets,
  copyCabinet,
  describeResize,
  fillGap,
  footprint,
  placeCopy,
  placementOf,
  planBoxes,
  pushNeighbours,
  rightward,
  roomProblems,
  runGaps,
  snapBackToWall,
  snapPlacement,
  toRoom,
  turnedTo,
  wallBehind,
} from '../src/core/room'
import { groupBox, groupOf, moveGroup, newRoomPart, planShapes, elevationShapes, roomPartBox, roomPartFrame, roomPartSolids, standSize, turnGroup } from '../src/core/roomParts'
import { redoOf, roomSnapshot, undoRoomStep } from '../src/core/roomUndo'
import { parseCell, TOOL_FIELDS, toolsFromRows } from '../src/core/toolData'
import type { CabinetInstance, CabinetPlacement, Job, Room, RoomPart } from '../src/core/types'
import { commitFieldText, commitLengthText, parseLength, parseNumberText } from '../src/core/units'
import { KITCHEN_PRESETS } from '../src/core/defaults'
import { bookcase, cab, inch, LIBRARY_ROOM, libraryData, libraryJob } from './library-1-jobs'
import { clone } from './helpers'

// Library-1: fixes and features found while building a full library room (bookcases on four walls,
// a sliding bookcase door at the entry, a custom table). One block per item.

const lib = defaultLibrary()
const at = (cabs: CabinetInstance[], id: string) => cabs.find((c) => c.id === id)!.placement!
const fpOf = (cabs: CabinetInstance[], id: string) => {
  const c = cabs.find((x) => x.id === id)!
  return footprint(c.params.width, c.params.depth, c.placement!)
}
const overlaps = (j: Job) => roomProblems(j.cabinets, j.room!, (c) => c.placement!, lib).overlaps

describe('Library-1 #1: every length field takes fractions, mixed numbers, decimals and mm, in both units', () => {
  const cases: [string, number][] = [
    ['1/2', 12.7],
    ['1-1/2', 38.1],
    ['1 1/2', 38.1],
    ['1 - 1/2', 38.1],
    ['1.5', 38.1],
    ['.5', 12.7],
    ['1,5', 38.1],
    ['23-1/4"', 590.55],
    ['1-1/2 in', 38.1],
    ['38mm', 38],
    ['38 mm', 38],
    ['12.5 mm', 12.5],
    ['-1/4', -6.35],
  ]
  it('inch shop: a bare value is inches, an explicit mm wins', () => {
    for (const [t, mm] of cases) expect(parseLength(t, 'in'), t).toBeCloseTo(mm, 9)
  })
  it('millimetre shop: a bare value is millimetres (fractions too), an inch mark or "in" wins', () => {
    const mmCases: [string, number][] = [
      ['12.5', 12.5],
      ['1/2', 0.5],
      ['1-1/2', 1.5],
      ['1 1/2', 1.5],
      ['38', 38],
      ['38 mm', 38],
      ['1/2"', 12.7],
      ['1-1/2"', 38.1],
      ['1 1/2 in', 38.1],
      ['1.5"', 38.1],
    ]
    for (const [t, mm] of mmCases) expect(parseLength(t, 'mm'), t).toBeCloseTo(mm, 9)
  })
  it('refuses what is not a length (and never reads it as 0)', () => {
    for (const t of ['', '  ', 'abc', '1/0', '1-1/0', '0x10', '1e3', '1/2/3', '"', 'mm']) {
      expect(parseLength(t, 'in'), t).toBeNull()
      expect(parseLength(t, 'mm'), t).toBeNull()
    }
    expect(parseNumberText('3/4')).toBe(0.75)
    expect(parseNumberText('2 3/4')).toBe(2.75)
  })
  it('a file keeps the Polish-1 rule: a bare fraction in a millimetre file is refused, explicit units and inches read', () => {
    expect(parseLength('3/4', 'mm', { file: true })).toBeNull()
    expect(parseLength('1-1/2', 'mm', { file: true })).toBeNull()
    expect(parseLength('3/4"', 'mm', { file: true })).toBeCloseTo(19.05, 9)
    expect(parseLength('19.5', 'mm', { file: true })).toBe(19.5)
    expect(parseLength('3/4', 'in', { file: true })).toBeCloseTo(19.05, 9)
  })

  it('the field commit (NumField, LenInput): fractions apply, out of range or unreadable puts the field back', () => {
    expect(commitLengthText('1/2', 'in', 0)).toEqual({ value: 12.7, same: false })
    expect(commitLengthText('1-1/2', 'in', 0, { min: 0, max: 2438.4 }).value).toBeCloseTo(38.1, 9)
    expect(commitLengthText('1 1/2', 'in', 38.1).same).toBe(true)
    expect(commitLengthText('38 mm', 'in', 0).value).toBe(38)
    expect(commitLengthText('1/2', 'mm', 0).value).toBe(0.5)
    expect(commitLengthText('1/2"', 'mm', 0).value).toBeCloseTo(12.7, 9)
    expect(commitLengthText('-1/2', 'in', 0, { min: 0 })).toEqual({ value: null, same: false })
    expect(commitLengthText('abc', 'in', 5)).toEqual({ value: null, same: false })
    // a plain number field (a count, a percent) reads fractions too
    expect(commitFieldText('1/2', 0, parseNumberText).value).toBe(0.5)
    expect(commitFieldText('7.25', 0, parseNumberText, { max: 5 }).value).toBeNull()
  })

  it('every length input that uses the shared reader reads 1-1/2 (the inputs found in the source)', () => {
    // the source files that read a length: each must go through parseLength (or the field commit)
    const root = path.resolve(__dirname, '../src')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.(ts|tsx)$/.test(p)) files.push(p)
      }
    }
    walk(root)
    const users = files.filter((f) => /parseLength\(|commitFieldText\(/.test(fs.readFileSync(f, 'utf8')) && !f.endsWith(path.join('core', 'units.ts'))).map((f) => path.relative(root, f).split(path.sep).join('/')).sort()
    expect(users).toEqual(
      [
        'cam/doors.ts',
        'cam/expr.ts',
        'cam/plugin/host.ts',
        'components/EditableTable.tsx',
        'components/LenInput.tsx',
        'components/fields.tsx',
        'core/batch.ts',
        'core/library/import.ts',
        'core/toolData.ts',
        'pages/LibraryEditDialog.tsx',
        'pages/library/RulesTab.tsx',
        'pages/part/EditsPanel.tsx',
        'pages/part/FillHolesDialog.tsx',
        'pages/part/ImageTraceDialog.tsx',
        'pages/part/PanelDialog.tsx',
        'pages/part/QueryDialog.tsx',
        'pages/part/SolidFacesPanel.tsx',
        'pages/part/TurnSketchDialog.tsx',
      ].sort(),
    )
    // the screens' fields (NumField, LenInput, table cells, the part designer's dialogs) all call
    // parseLength(text, units) as above; the modules with their own reading are exercised here:
    // expressions (the part designer's length fields)
    expect(evalLength('1-1/2', 'in')).toBeCloseTo(38.1, 9)
    expect(evalLength('1 1/2', 'in')).toBeCloseTo(38.1, 9)
    expect(evalLength('1-1/2', 'mm')).toBeCloseTo(1.5, 9)
    expect(evalLength('1/2"', 'mm')).toBeCloseTo(12.7, 9)
    expect(evalLength('38 mm', 'in')).toBeCloseTo(38, 9)
    expect(evalLength('10 - 2', 'mm')).toBe(8)
    // the tool grid's cells (typed) and the tool spreadsheet (a file)
    const dia = TOOL_FIELDS.find((f) => f.key === 'diameter')!
    expect(parseCell('1/2', dia, 'in')).toEqual({ value: 12.7 })
    expect(parseCell('1/2"', dia, 'mm')).toEqual({ value: 12.7 })
    expect(parseCell('1/2', dia, 'mm')).toEqual({ value: 0.5 })
    expect('error' in parseCell('1/2', dia, 'mm', undefined, { file: true })).toBe(true)
    const m = defaultAppData().machine
    expect(toolsFromRows([{ number: 301, type: 'router', diameter: '1/2"', maxDepth: '1-5/8"' }], m).tools.find((t) => t.number === 301)!.diameter).toBeCloseTo(12.7, 9)
    // the library import (a file)
    const asIn = importMaterials(parseCsv('code,name,thickness,sheetLength,sheetWidth\nMDF-IN,MDF,1-1/2,96,48\n'), lib.materials, 'in')
    expect(asIn.items.find((x) => x.code === 'MDF-IN')!.thickness).toBeCloseTo(38.1, 9)
    // the batch list and the door list (files)
    const d = defaultAppData()
    const batch = parseBatchCsv('order,type,name,length,width,material\nO1,part,Shelf,35-1/2,11 1/4,PB18-WHT\n', d, { defaultOrder: 'O1', units: 'in' })
    expect(batch.errors).toEqual([])
    expect(batch.orders[0].items[0]).toMatchObject({ length: 901.7, width: 285.75 })
    const doors = parseDoorCsv('name,width,height\nD1,15-3/4,30 1/2\n', { units: 'in', styles: doorStylesOf(d.library), materials: d.library.materials, defaultStyleId: doorStylesOf(d.library)[0].id })
    expect(doors.errors).toEqual([])
    expect(doors.specs[0].width).toBeCloseTo(400.05, 6)
    expect(doors.specs[0].height).toBeCloseTo(774.7, 6)
  })

  it('Room "Height off the floor": a typed 1/2" is kept (it was snapped to the floor, so it saved 0)', () => {
    const room = LIBRARY_ROOM
    const pl: CabinetPlacement = { x: 0, y: room.depth - inch(12), rotation: 0, z: 0 }
    // the cause: the drag snap pulls anything within 1/2" (12.7 mm) to the floor
    expect(snapPlacement({ ...pl, z: 12.7 }, inch(36), inch(12), [], room, 12.7, { enabled: true, height: inch(84) }).z).toBe(0)
    expect(parseLength('1/2', 'in')).toBeCloseTo(12.7, 9)
    // the field now sets the typed height as it is (no snap), as one undo step
    const src = fs.readFileSync(path.resolve(__dirname, '../src/pages/RoomTab.tsx'), 'utf8')
    const field = src.slice(src.indexOf('label="Height off the floor"'), src.indexOf('/>', src.indexOf('label="Height off the floor"')))
    expect(field).toContain('z: v }')
    expect(field).not.toContain('snapTo')
  })
})

describe('Library-1 #2: a width change keeps the back on its wall and grows along it', () => {
  const room: Room = { width: inch(168), depth: inch(144), height: inch(96) }
  // two bookcases butted along one wall, each turned to face the room
  const pair = (rot: CabinetPlacement['rotation']) => {
    const d = inch(12)
    const pl = (i: number): CabinetPlacement =>
      rot === 0 ? { x: inch(40 + 36 * i), y: room.depth - d, rotation: 0, z: 0 } : rot === 180 ? { x: inch(40 + 36 * i), y: 0, rotation: 180, z: 0 } : { x: rot === 90 ? room.width - d : 0, y: inch(40 + 36 * i), rotation: rot, z: 0 }
    return [cab('A', bookcase(), pl(0)), cab('B', bookcase(), pl(1))]
  }
  for (const rot of [0, 90, 180, 270] as const) {
    it(`turned ${rot}: the back stays on the wall, the left end (seen from the front) stays, the run moves to the right`, () => {
      const cabs = pair(rot)
      const b = cabs[1]
      const back = rot === 90 ? fpOf(cabs, 'lib-b').x + fpOf(cabs, 'lib-b').w : rot === 270 ? fpOf(cabs, 'lib-b').x : rot === 0 ? fpOf(cabs, 'lib-b').y + fpOf(cabs, 'lib-b').d : fpOf(cabs, 'lib-b').y
      const leftEnd = toRoom(0, 0, 0, b.placement!, b.params.width, b.params.depth)
      const old = b.params.width
      b.params.width = inch(39.125)
      const moved = pushNeighbours(cabs, b.id, old, room, lib)
      const fp = fpOf(cabs, b.id)
      const backNow = rot === 90 ? fp.x + fp.w : rot === 270 ? fp.x : rot === 0 ? fp.y + fp.d : fp.y
      expect(backNow).toBeCloseTo(back, 9)
      const leftNow = toRoom(0, 0, 0, b.placement!, b.params.width, b.params.depth)
      expect(leftNow[0]).toBeCloseTo(leftEnd[0], 9)
      expect(leftNow[1]).toBeCloseTo(leftEnd[1], 9)
      // A sits on B's right (seen from the front) when the room axis runs against the cabinets' left-to-right
      const aRight = rightward(rot) < 0
      expect(moved).toEqual(aRight ? ['lib-a'] : [])
      expect(roomProblems(cabs, room, (c) => c.placement!, lib).overlaps).toEqual([])
    })
  }
  it('the reported case: a right-wall unit at x = 156" stays at 156" (it moved to 152.9")', () => {
    const j = libraryJob()
    const t6 = j.cabinets.find((c) => c.number === 'T6')!
    expect(t6.placement!.x).toBeCloseTo(inch(156), 9)
    const old = t6.params.width
    t6.params.width = inch(39.125)
    pushNeighbours(j.cabinets, t6.id, old, j.room!, lib)
    expect(t6.placement!.x).toBeCloseTo(inch(156), 9)
    // its back end stays against the back run's front (the corner), it grows towards the front, T7 moves along
    expect(fpOf(j.cabinets, t6.id).y + fpOf(j.cabinets, t6.id).d).toBeCloseTo(inch(132), 9)
    expect(at(j.cabinets, 'lib-t7').y).toBeCloseTo(inch(60 - 3.125), 9)
    expect(overlaps(j)).toEqual([])
  })
  it('a left-wall run closed against the back run grows towards the front (it ran into the corner bookcase)', () => {
    const j = libraryJob()
    const t4 = j.cabinets.find((c) => c.number === 'T4')!
    const old = t4.params.width
    t4.params.width = inch(40)
    expect(pushNeighbours(j.cabinets, t4.id, old, j.room!, lib)).toEqual(['lib-t5'])
    expect(fpOf(j.cabinets, t4.id).y + fpOf(j.cabinets, t4.id).d).toBeCloseTo(inch(132), 9)
    expect(at(j.cabinets, 'lib-t5').y).toBeCloseTo(inch(56), 9)
    expect(at(j.cabinets, 'lib-t4').x).toBe(0)
    expect(overlaps(j)).toEqual([])
  })
  it('the back-wall run: neighbours move along (the run behaviour, kept), and the notice says which and how far', () => {
    const j = libraryJob()
    // the back wall run is held at the left wall: T2 wider pushes T3 onwards
    const laid = arrangeCabinets(j.cabinets, j.room!, lib)
    const before = Object.fromEntries(j.cabinets.map((c) => [c.id, placementOf(c, laid)]))
    const t2 = j.cabinets.find((c) => c.number === 'T2')!
    t2.params.width = inch(34)
    expect(pushNeighbours(j.cabinets, t2.id, inch(36), j.room!, lib)).toEqual(['lib-t3', 'lib-t10', 'lib-t11'])
    expect(at(j.cabinets, 'lib-t3').x).toBeCloseTo(inch(70), 9)
    expect(describeResize(before, j.cabinets, t2.id, inch(36), j.room!, 'in')).toBe('T2 is 2" narrower; its left end stayed where it was along the back wall. T3, T10 and T11 moved 2" to the left along the back wall, so the run stays closed.')
    // a turned unit says the same in its own terms
    const k = libraryJob()
    const b4 = Object.fromEntries(k.cabinets.map((c) => [c.id, { ...c.placement! }]))
    const t7 = k.cabinets.find((c) => c.number === 'T7')!
    t7.params.width = inch(30)
    pushNeighbours(k.cabinets, t7.id, inch(36), k.room!, lib)
    // (the right wall's run is closed against the back run at its back end, which is T7's left end seen from its front)
    expect(describeResize(b4, k.cabinets, t7.id, inch(36), k.room!, 'in')).toBe('T7 is 6" narrower; its left end stayed where it was along the right wall.')
    expect(describeResize(b4, k.cabinets, t7.id, inch(30), k.room!, 'in')).toBe('')
  })
  it('a run held only by the right wall grows to the left (it ran past the wall)', () => {
    const cabs = [cab('A', bookcase(), { x: room.width - inch(72), y: room.depth - inch(12), rotation: 0, z: 0 }), cab('B', bookcase(), { x: room.width - inch(36), y: room.depth - inch(12), rotation: 0, z: 0 })]
    cabs[0].params.width = inch(40)
    expect(pushNeighbours(cabs, 'lib-a', inch(36), room, lib)).toEqual([])
    expect(at(cabs, 'lib-a').x).toBeCloseTo(room.width - inch(76), 9)
    expect(roomProblems(cabs, room, (c) => c.placement!, lib)).toMatchObject({ overlaps: [], outside: [] })
  })
})

describe('Library-1 #2 (found with it): a field still focused never applies its text to the next cabinet picked', () => {
  it('NumField follows a new value during the render, and the Room tab applies a field before it picks anything else', () => {
    // Clicking another cabinet in the plan with the Width (or Depth) field still focused used to apply
    // the text typed for the last cabinet to the new one when the field lost focus after the pick
    // (a Depth typed for one unit then moved a right-wall unit off its wall). Checked in the source:
    // there is no DOM in these tests.
    const fields = fs.readFileSync(path.resolve(__dirname, '../src/components/fields.tsx'), 'utf8')
    const num = fields.slice(fields.indexOf('export function NumField'), fields.indexOf('export function TextField'))
    expect(num).not.toMatch(/useEffect\(/)
    expect(num).toMatch(/if \(shown !== last \|\| resync\)/)
    const room = fs.readFileSync(path.resolve(__dirname, '../src/pages/RoomTab.tsx'), 'utf8')
    const pickAt = room.indexOf('const pick = (')
    expect(room.slice(pickAt, room.indexOf('\n', room.indexOf('{', pickAt) + 1) + 30)).toContain('applyField()')
    // each pointer press that picks first applies a focused field (and then starts no drag)
    expect(room.match(/if \(applyField\(\)\) return pick\(/g)).toHaveLength(3)
    expect(room).toContain('<div key={sel.id}')
  })
})

describe('Library-1 #3: a copy lands beside the original on its wall, in the first free space', () => {
  it('beside it, to its right when that is free, on the same wall and turn', () => {
    const j = libraryJob()
    j.cabinets = j.cabinets.filter((c) => c.number !== 'T10' && c.number !== 'T11')
    const r = copyCabinet(j, 'lib-t3', j.room!, lib, () => 'copy-1')!
    expect(r).toEqual({ id: 'copy-1', how: 'beside' })
    const copy = j.cabinets.find((c) => c.id === 'copy-1')!
    expect(copy.number).toBe('T10')
    expect(j.cabinets.indexOf(copy)).toBe(j.cabinets.findIndex((c) => c.id === 'lib-t3') + 1)
    expect(copy.placement).toEqual({ x: inch(108), y: j.room!.depth - inch(12), rotation: 0, z: 0 })
    expect(overlaps(j)).toEqual([])
  })
  it('a turned one beside it along its wall (its right, seen from the front, then its left); never on T1 in the corner', () => {
    const j = libraryJob()
    // T7 on the right wall: its right (seen from the front) is towards the front wall
    const r = copyCabinet(j, 'lib-t7', j.room!, lib, () => 'copy-7')!
    expect(r.how).toBe('beside')
    const p = at(j.cabinets, 'copy-7')
    expect(p).toMatchObject({ x: j.room!.width - inch(12), rotation: 90 })
    expect(p.y).toBeCloseTo(inch(24), 9)
    expect(overlaps(j)).toEqual([])
    expect(p).not.toEqual(at(j.cabinets, 'lib-t1'))
  })
  it('keeps out of a door: the front wall copy goes past the entry door', () => {
    const j = libraryJob()
    j.cabinets = j.cabinets.filter((c) => c.number !== 'S1' && c.number !== 'T9')
    // T8 is at the front wall's left end (x 132..168): its right (seen from the front) is x 96..132, which
    // runs into the door at 66..102, so the copy goes on past the door: x 30..66, against its far edge
    const r = placeCopy(j.cabinets, 'lib-t8', j.room!, lib)!
    expect(r.how).toBe('beside')
    expect(r.placement.x).toBeCloseTo(inch(30), 6)
    expect(r.placement).toMatchObject({ y: 0, rotation: 180 })
    const spans = blockedSpans(j.room!, 'front', 0, inch(84))
    expect(spans).toHaveLength(1)
    expect(spans[0][0]).toBeCloseTo(inch(66), 6)
    expect(spans[0][1]).toBeCloseTo(inch(102), 6)
    // with T9 back at 0..36 there is no 36" left on that wall: set in front, to be moved
    expect(placeCopy(libraryJob().cabinets.filter((c) => c.number !== 'S1'), 'lib-t8', j.room!, lib)!.how).toBe('offset')
  })
  it('no free space on its wall: set in front of it, overlapping, to be moved (the room shows the overlap)', () => {
    const j = libraryJob()
    const r = copyCabinet(j, 'lib-t2', j.room!, lib, () => 'copy-2')!
    // the back wall is full corner to corner, and nowhere else on it fits 36"
    expect(r.how).toBe('offset')
    const p = at(j.cabinets, 'copy-2')
    expect(p.y).toBeCloseTo(j.room!.depth - inch(12) - 101.6, 9)
    expect(p.x).toBeCloseTo(inch(36) + 101.6, 9)
    expect(overlaps(j).some(([a, b]) => a === 'copy-2' || b === 'copy-2')).toBe(true)
  })
  it('an arranged room (no placements): Arrange puts the copy after the original, nothing set', () => {
    const j = libraryJob()
    for (const c of j.cabinets) delete c.placement
    expect(placeCopy(j.cabinets, 'lib-t1', j.room!, lib)).toBeNull()
    expect(copyCabinet(j, 'lib-t1', j.room!, lib, () => 'c')).toEqual({ id: 'c', how: 'arranged' })
    expect(j.cabinets.find((c) => c.id === 'c')!.placement).toBeUndefined()
  })
  it('every other cabinet keeps its place (they are all given their own placement first)', () => {
    const j = libraryJob()
    delete j.cabinets.find((c) => c.number === 'T9')!.placement
    const laid = arrangeCabinets(j.cabinets, j.room!, lib)
    const was = placementOf(j.cabinets.find((c) => c.number === 'T9')!, laid)
    copyCabinet(j, 'lib-t5', j.room!, lib, () => 'c5')
    expect(j.cabinets.find((c) => c.number === 'T9')!.placement).toEqual(was)
  })
})

describe('Library-1 #4: typed position, the turn, snap back to the wall, undo', () => {
  it('snap back to the wall: straight back to the wall it faces away from, at every turn', () => {
    const p = bookcase()
    const c = { params: p }
    const room = LIBRARY_ROOM
    const near = (a: CabinetPlacement, b: CabinetPlacement) => {
      expect(a.rotation).toBe(b.rotation)
      for (const k of ['x', 'y', 'z'] as const) expect(a[k]).toBeCloseTo(b[k], 6)
    }
    near(snapBackToWall(c, { x: inch(10), y: inch(50), rotation: 0, z: 0 }, room), { x: inch(10), y: room.depth - inch(12), rotation: 0, z: 0 })
    near(snapBackToWall(c, { x: inch(10), y: inch(50), rotation: 90, z: 0 }, room), { x: room.width - inch(12), y: inch(50), rotation: 90, z: 0 })
    expect(snapBackToWall(c, { x: inch(10), y: inch(50), rotation: 180, z: 5 }, room)).toEqual({ x: inch(10), y: 0, rotation: 180, z: 5 })
    expect(snapBackToWall(c, { x: inch(10), y: inch(50), rotation: 270, z: 0 }, room)).toEqual({ x: 0, y: inch(50), rotation: 270, z: 0 })
    expect([0, 90, 180, 270].map((r) => wallBehind(r as CabinetPlacement['rotation']))).toEqual(['back', 'right', 'front', 'left'])
  })
  it('turning keeps the middle of the footprint (as Rotate does)', () => {
    const c = { params: bookcase() }
    const pl: CabinetPlacement = { x: inch(50), y: inch(50), rotation: 0, z: 0 }
    const t = turnedTo(c, pl, 90)
    const a = footprint(c.params.width, c.params.depth, pl)
    const b = footprint(c.params.width, c.params.depth, t)
    expect(b.x + b.w / 2).toBeCloseTo(a.x + a.w / 2, 9)
    expect(b.y + b.d / 2).toBeCloseTo(a.y + a.d / 2, 9)
    expect(t.rotation).toBe(90)
  })
  it('undo puts a typed position back, redo does it again; a setting changed since is left as it is', () => {
    const j = libraryJob()
    const before = roomSnapshot(j, LIBRARY_ROOM)
    const t1 = j.cabinets.find((c) => c.number === 'T1')!
    t1.placement = { ...t1.placement!, x: inch(2), y: inch(100) }
    j.cabinets.find((c) => c.number === 'T2')!.placement!.x = inch(40)
    const step = { before, after: roomSnapshot(j, LIBRARY_ROOM) }
    // T2 is moved again by hand before the undo: left as it is
    j.cabinets.find((c) => c.number === 'T2')!.placement = { ...j.cabinets.find((c) => c.number === 'T2')!.placement!, x: inch(41) }
    expect(undoRoomStep(j, step, LIBRARY_ROOM)).toEqual({ reverted: 1, skipped: 1 })
    expect(t1.placement).toBeDefined()
    expect(j.cabinets.find((c) => c.number === 'T1')!.placement).toEqual(libraryJob().cabinets.find((c) => c.number === 'T1')!.placement)
    expect(j.cabinets.find((c) => c.number === 'T2')!.placement!.x).toBe(inch(41))
    expect(undoRoomStep(j, redoOf({ jobId: j.id, label: 'Move T1', ...step }), LIBRARY_ROOM).reverted).toBe(1)
    expect(j.cabinets.find((c) => c.number === 'T1')!.placement).toMatchObject({ x: inch(2), y: inch(100) })
  })
  it('undo removes a copy, brings back what was removed, and puts the room and its openings back', () => {
    const j = libraryJob()
    const before = roomSnapshot(j, LIBRARY_ROOM)
    copyCabinet(j, 'lib-t5', j.room!, lib, () => 'c5')
    j.room = { ...j.room!, width: inch(170), openings: [...j.room!.openings!.filter((o) => o.id !== 'op-window'), newOpening('door', 'back', j.room!, 'op-new')] }
    j.cabinets = j.cabinets.filter((c) => c.number !== 'T9')
    const after = roomSnapshot(j, LIBRARY_ROOM)
    undoRoomStep(j, { before, after }, LIBRARY_ROOM)
    expect(j.cabinets.map((c) => c.id)).toEqual(libraryJob().cabinets.map((c) => c.id))
    expect(j.room!.width).toBe(inch(168))
    expect(j.room!.openings!.map((o) => o.id)).toEqual(['op-entry', 'op-window'])
  })
})

describe('Library-1 #5: doors, windows and openings', () => {
  it('a new opening starts at placeholder sizes with a Configure badge, gone once a size is typed', () => {
    const o = newOpening('window', 'left', LIBRARY_ROOM, 'w')
    expect(o).toMatchObject({ kind: 'window', wall: 'left', width: 914.4, height: 1219.2, sill: 914.4, placeholder: true, name: 'W1' })
    expect(o.at).toBeCloseTo((LIBRARY_ROOM.depth - 914.4) / 2, 6)
    const u = openingUnconfirmed(o, 'in')!
    expect(u).toMatchObject({ key: 'room:opening:w', group: 'Room', target: { kind: 'room', key: 'opening:w' } })
    expect(u.value).toBe('36" x 48", sill 36" (starting size, not measured)')
    expect(openingUnconfirmed({ ...o, placeholder: undefined }, 'in')).toBeNull()
  })
  it('a cabinet standing in an opening is flagged; a base under a window and a wall cabinet above a door are clear', () => {
    const room: Room = { ...LIBRARY_ROOM, openings: [{ id: 'w', kind: 'window', wall: 'back', at: inch(36), width: inch(36), height: inch(48), sill: inch(36), name: 'W1' }, { id: 'd', kind: 'door', wall: 'back', at: inch(108), width: inch(36), height: inch(80), sill: 0, name: 'D1' }] }
    const base = { params: { ...bookcase(), kind: 'base' as const, height: inch(34.5) } }
    const box = (x: number, z: number, h: number) => ({ x: inch(x), y: room.depth - inch(12), w: inch(36), d: inch(12), z0: z, z1: z + h })
    expect(overlapWithOpening(box(36, 0, inch(34.5)), room.openings![0], room)).toBe(0)
    expect(overlapWithOpening(box(36, 0, inch(84)), room.openings![0], room)).toBeCloseTo(inch(36), 6)
    expect(overlapWithOpening(box(108, inch(80), inch(12)), room.openings![1], room)).toBe(0)
    expect(overlapWithOpening(box(100, 0, inch(84)), room.openings![1], room)).toBeCloseTo(inch(28), 6)
    void base
    // a corner box stands against two walls
    expect(wallSpans({ x: 0, y: room.depth - inch(12), w: inch(36), d: inch(12), z0: 0, z1: 1 }, room).map((s) => s.wall)).toEqual(['back', 'left'])
  })
  it('the library: the sliding bookcase door covers the entry on purpose (a note); a bookcase moved into the window is a warning', () => {
    const j = libraryJob()
    const place = (c: CabinetInstance) => c.placement!
    const list = openingConflicts(j.cabinets, (c) => planBoxes(c as CabinetInstance, place(c as CabinetInstance)), j.room!)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ cabinet: 'lib-s1', opening: 'op-entry', intended: true })
    expect(list[0].by).toBeCloseTo(inch(36), 6)
    // T5 slid towards the front over the window W1 (left wall, 12"..48" from the front, 36" up)
    j.cabinets.find((c) => c.number === 'T5')!.placement!.y = inch(30)
    const now = openingConflicts(j.cabinets, (c) => planBoxes(c as CabinetInstance, place(c as CabinetInstance)), j.room!)
    expect(now.find((x) => x.cabinet === 'lib-t5')).toMatchObject({ opening: 'op-window', intended: false })
    // not marked sliding: the cover is a warning too
    delete j.cabinets.find((c) => c.number === 'S1')!.slidingDoor
    expect(openingConflicts(j.cabinets, (c) => planBoxes(c as CabinetInstance, place(c as CabinetInstance)), j.room!).find((x) => x.cabinet === 'lib-s1')!.intended).toBe(false)
  })
  it('Arrange keeps out of a door in the back wall, and out of a window only at the height it is', () => {
    const room: Room = { ...LIBRARY_ROOM, openings: [{ id: 'd', kind: 'door', wall: 'back', at: inch(40), width: inch(36), height: inch(80), sill: 0, name: 'D1' }] }
    const cabs = [cab('A'), cab('B'), cab('C')]
    for (const c of cabs) delete c.placement
    const laid = arrangeCabinets(cabs, room, lib)
    expect(laid['lib-a'].x).toBe(0)
    expect(laid['lib-b'].x).toBeCloseTo(inch(76), 6)
    expect(laid['lib-c'].x).toBeCloseTo(inch(112), 6)
    // a window 36" up: a 34-1/2" base goes under it, a tall bookcase does not
    const win: Room = { ...LIBRARY_ROOM, openings: [{ id: 'w', kind: 'window', wall: 'back', at: inch(40), width: inch(36), height: inch(36), sill: inch(36), name: 'W1' }] }
    const lowBase = cab('L', { ...bookcase(36), kind: 'base', height: inch(34.5) })
    const two = [cab('A'), lowBase]
    expect(arrangeCabinets(two, win, lib)['lib-l'].x).toBeCloseTo(inch(36), 6)
    expect(arrangeCabinets([cab('A'), cab('B')], win, lib)['lib-b'].x).toBeCloseTo(inch(76), 6)
    // no openings: as before
    expect(arrangeCabinets(cabs, LIBRARY_ROOM, lib)['lib-b'].x).toBeCloseTo(inch(36), 6)
  })
  it('Fill gap counts a run to the door beside it, and fills up to the door (no scribe at a door)', () => {
    const room: Room = { ...LIBRARY_ROOM, openings: [{ id: 'd', kind: 'door', wall: 'back', at: inch(110), width: inch(36), height: inch(80), sill: 0, name: 'D1' }] }
    const j: Job = { ...libraryJob(), room, cabinets: [cab('A', bookcase(), { x: 0, y: room.depth - inch(12), rotation: 0, z: 0 }), cab('B', bookcase(), { x: inch(36), y: room.depth - inch(12), rotation: 0, z: 0 }), cab('C', bookcase(), { x: inch(72), y: room.depth - inch(12), rotation: 0, z: 0 }), cab('D', bookcase(18), { x: inch(150), y: room.depth - inch(12), rotation: 0, z: 0 })] }
    const gaps = runGaps(j.cabinets, room, (c) => c.placement!, lib)
    // the run on the left of the door is 2" short of it (108 to 110); the one on its right, against the
    // right wall (150..168), is 4" short of the door's far edge (146)
    expect(gaps).toHaveLength(2)
    expect(gaps[1]).toMatchObject({ wall: 'back', ids: ['lib-d'], startIsWall: false, endIsWall: true, startOpening: 'd', anchor: 'end' })
    expect(gaps[1].total).toBeCloseTo(inch(4), 6)
    expect(gaps[0]).toMatchObject({ wall: 'back', ids: ['lib-a', 'lib-b', 'lib-c'], startIsWall: true, endIsWall: false, endOpening: 'd', anchor: 'start' })
    expect(gaps[0].total).toBeCloseTo(inch(2), 6)
    expect(gaps[0].endBound).toBeCloseTo(inch(110), 6)
    const filler = KITCHEN_PRESETS.find((t) => t.id === 'tpl-us-filler-3')!.params
    const ids = fillGap(j, gaps[0], 'one', filler, room, (c) => c.placement!, () => 'f1')
    const f = j.cabinets.find((c) => c.id === ids[0])!
    expect(f.params.width).toBeCloseTo(inch(2), 6)
    expect(f.placement!.x).toBeCloseTo(inch(108), 6)
    expect(f.params.panel?.type === 'filler' && f.params.panel.scribeSide).toBe('none')
    // a door across the middle of a run: each side is its own run
    const mid: Room = { ...LIBRARY_ROOM, width: inch(108), openings: [{ id: 'd', kind: 'door', wall: 'back', at: inch(37), width: inch(34), height: inch(80), sill: 0, name: 'D1' }] }
    const k = [cab('A', bookcase(), { x: 0, y: mid.depth - inch(12), rotation: 0, z: 0 }), cab('B', bookcase(), { x: inch(72), y: mid.depth - inch(12), rotation: 0, z: 0 })]
    const g2 = runGaps(k, mid, (c) => c.placement!, lib)
    expect(g2.map((g) => [g.ids, Math.round(g.total / 25.4 * 16) / 16])).toEqual([
      [['lib-a'], 1],
      [['lib-b'], 1],
    ])
  })
  it('an opening as a box for the 3D view, just outside its wall', () => {
    const j = libraryJob()
    const b = openingBox(j.room!.openings![0], j.room!)
    expect(b).toMatchObject({ y: -60, d: 60, z0: 0, z1: inch(80) })
    expect(b.x).toBeCloseTo(inch(66), 6)
    expect(b.w).toBeCloseTo(inch(36), 6)
  })
  it('saved with the job and loaded back; the room problems list stays as it was (openings are their own list)', () => {
    const d = normalizeData(clone(libraryData()))
    expect(d.jobs[0].room!.openings).toHaveLength(2)
    expect(d.jobs[0].cabinets.find((c) => c.number === 'S1')!.slidingDoor).toBe(true)
    expect(Object.keys(roomProblems(d.jobs[0].cabinets, d.jobs[0].room!, (c) => c.placement!, lib))).toEqual(['overlaps', 'outside', 'blocked'])
  })
})

describe('Library-1 #6: lines typed into the quote, and library hardware added to the job', () => {
  const priced = () => {
    const d = libraryData()
    d.settings.units = 'mm'
    for (const m of d.library.materials) m.cost = { by: 'area', price: 10 }
    for (const e of d.library.edgebands) e.price = 1
    for (const h of d.library.hardware) h.price = 2
    d.settings.pricing = { shopRate: 60, confirmed: ['labour:cabinet', 'labour:drawer', 'labour:door', 'labour:sheet'] }
    return d
  }
  it('manual lines: qty x unit price, after the markup (not marked up), taxed only when taxable', () => {
    const d = priced()
    const j = d.jobs[0]
    j.quote = { markupPct: 10, taxPct: 8, lines: [{ id: 'a', description: 'Installation', qty: 2, unitPrice: 150, taxable: false }, { id: 'b', description: 'Crown moulding (bought in)', qty: 3, unitPrice: 25.5, taxable: true }] }
    const q = jobQuote(j, runJob(j, d), d)
    expect(q.manual.items.map((i) => [i.name, i.amount, i.taxable])).toEqual([
      ['Installation', 300, false],
      ['Crown moulding (bought in)', 76.5, true],
    ])
    expect(q.manual.amount).toBe(376.5)
    expect(q.manual.taxable).toBe(76.5)
    expect(q.markup).toBe(Math.round(q.subtotal * 10) / 100)
    expect(q.taxBase).toBeCloseTo(q.subtotal + q.markup + 76.5, 6)
    expect(q.tax).toBeCloseTo(Math.round(q.taxBase * 8) / 100, 6)
    expect(q.total).toBeCloseTo(q.subtotal + q.markup + 376.5 + q.tax, 6)
    expect(q.complete).toBe(true)
    // in the CSV (BOM and areas) and the PDF
    const csv = quoteCsv(q)
    expect(csv).toContain('Other,Line 1,Installation,2,ea,150.00,300.00,no tax')
    expect(csv).toContain('Other,Line 2,Crown moulding (bought in),3,ea,25.50,76.50,')
    expect(csv).toContain('Line total,Other,,,,,376.50,')
    const pdf = quotePdf(j, q, 'Shop')
    expect(pdf.length).toBeGreaterThan(1000)
    expect(new TextDecoder('latin1').decode(pdf).startsWith('%PDF')).toBe(true)
  })
  it('a line without a price is "price not set" with a Configure badge (never 0), and the total says it is incomplete', () => {
    const d = priced()
    const j = d.jobs[0]
    j.quote = { lines: [{ id: 'x', description: 'Delivery', qty: 1, taxable: true }] }
    const q = jobQuote(j, runJob(j, d), d)
    expect(q.manual.items[0]).toMatchObject({ amount: null, price: null, missing: { key: 'quote:line:x', target: { kind: 'quote', key: 'line:x' } } })
    expect(q.complete).toBe(false)
    expect(q.unpriced.map((u) => u.key)).toContain('quote:line:x')
    expect(quoteCsv(q)).toContain('Other,Line 1,Delivery,1,ea,,,price not set')
  })
  it('saved with the job (a reload keeps the lines)', () => {
    const d = libraryData()
    d.jobs[0].quote = { lines: [{ id: 'a', description: 'Installation', qty: 1, unitPrice: 100, taxable: false }] }
    expect(normalizeData(clone(d)).jobs[0].quote!.lines).toEqual(d.jobs[0].quote.lines)
  })
  it('a library hardware row added to the job goes into the BOM and the quote (a sliding-door track kit)', () => {
    const d = priced()
    d.library.hardware.push({ id: 'hw-track', code: 'TRACK-KIT-96', name: 'Sliding door track kit 96"', category: 'other', price: 189 })
    const j = d.jobs[0]
    j.hardware = [{ id: 'jh1', hardwareId: 'hw-track', qty: 1 }]
    const out = runJob(j, d)
    expect(out.hardware.find((h) => h.code === 'TRACK-KIT-96')).toEqual({ code: 'TRACK-KIT-96', name: 'Sliding door track kit 96"', qty: 1 })
    expect(bomCsv(out, d)).toContain('Hardware,TRACK-KIT-96,"Sliding door track kit 96""",1,pcs')
    const q = jobQuote(j, out, d)
    expect(q.lines.find((l) => l.key === 'hardware')!.items.find((i) => i.code === 'TRACK-KIT-96')).toMatchObject({ qty: 1, price: 189, amount: 189 })
    // more of an item the cabinets already use adds to their count
    j.hardware = [{ id: 'jh2', hardwareId: 'hw-pin', qty: 8 }]
    const pins = (o: ReturnType<typeof runJob>) => o.hardware.find((h) => h.code === 'PIN-5')?.qty ?? 0
    expect(pins(runJob(j, d))).toBe(pins(out) + 8)
    // a row no longer in the library is left out, with a warning
    j.hardware = [{ id: 'jh3', hardwareId: 'hw-gone', qty: 1 }]
    expect(expandJob(j, d.library, d.settings).warnings.some((w) => /hw-gone\) is no longer in the library/.test(w))).toBe(true)
  })
  it('no programs change: the lines and the hardware are quote and BOM only', () => {
    const d = libraryData()
    const j = d.jobs[0]
    const a = mprFiles(j, d, runJob(j, d)).map((f) => f.text)
    j.quote = { lines: [{ id: 'a', description: 'Installation', qty: 1, unitPrice: 100, taxable: false }] }
    j.hardware = [{ id: 'jh', hardwareId: 'hw-pin', qty: 4 }]
    expect(mprFiles(j, d, runJob(j, d)).map((f) => f.text)).toEqual(a)
  })
})

describe('Library-1 #7: custom parts placed in the room (display only)', () => {
  const j0 = libraryJob()
  const part = (id: string) => j0.camParts!.find((p) => p.id === id)!
  it('each way a panel stands: its size along X, front to back and up, and the footprint turned', () => {
    const top = part('cp-top')
    expect(standSize(top, 'flat')).toEqual({ w: inch(60), d: inch(36), h: 38 })
    expect(standSize(top, 'edge')).toEqual({ w: inch(60), d: 38, h: inch(36) })
    expect(standSize(top, 'end')).toEqual({ w: inch(36), d: 38, h: inch(60) })
    expect(roomPartBox(top, { x: 10, y: 20, z: inch(28.5), rotation: 90, stand: 'flat' })).toEqual({ x: 10, y: 20, w: inch(36), d: inch(60), z0: inch(28.5), z1: inch(28.5) + 38 })
  })
  it('the frame puts the outline through the thickness inside that box, at every turn and stand', () => {
    const leg = part('cp-leg')
    for (const stand of ['flat', 'edge', 'end'] as const)
      for (const rotation of [0, 90, 180, 270] as const) {
        const rp = { x: 100, y: 200, z: 50, rotation, stand }
        const f = roomPartFrame(leg, rp)
        const box = roomPartBox(leg, rp)
        const pts = [0, leg.length].flatMap((a) => [0, leg.width].flatMap((b) => [0, leg.thickness].map((c) => [0, 1, 2].map((k) => f.origin[k] + f.u[k] * a + f.v[k] * b - f.n[k] * c))))
        for (const p of pts) {
          expect(p[0]).toBeGreaterThanOrEqual(box.x - 1e-6)
          expect(p[0]).toBeLessThanOrEqual(box.x + box.w + 1e-6)
          expect(p[1]).toBeGreaterThanOrEqual(box.y - 1e-6)
          expect(p[1]).toBeLessThanOrEqual(box.y + box.d + 1e-6)
          expect(p[2]).toBeGreaterThanOrEqual(box.z0 - 1e-6)
          expect(p[2]).toBeLessThanOrEqual(box.z1 + 1e-6)
        }
        // unit axes at right angles
        const len = (v: number[]) => Math.hypot(v[0], v[1], v[2])
        expect([len(f.u), len(f.v), len(f.n)].map((x) => Math.round(x * 1e9) / 1e9)).toEqual([1, 1, 1])
      }
  })
  it('a table: top, legs and aprons placed as a group, shown as solids in 3D, outlines in plan, strips seen edge on', () => {
    const j = libraryJob()
    const P = (id: string) => j.camParts!.find((p) => p.id === id)!
    const top = newRoomPart(P('cp-top'), j.room!, 'rp-top', 'Table')
    top.z = inch(28.5)
    const legs: RoomPart[] = [
      [0, 0],
      [57.5, 0],
      [0, 33.5],
      [57.5, 33.5],
    ].map(([dx, dy], i) => ({ id: `rp-leg-${i}`, partId: 'cp-leg', x: top.x + inch(dx), y: top.y + inch(dy), z: 0, rotation: 0, stand: 'end', group: 'Table' }))
    j.roomParts = [top, ...legs, { id: 'rp-apron', partId: 'cp-apron-l', x: top.x + inch(4), y: top.y, z: inch(24.5), rotation: 0, stand: 'edge', group: 'Table' }]
    expect(top.group).toBe('Table')
    const solids = roomPartSolids(j)
    expect(solids).toHaveLength(6)
    expect(solids[0]).toMatchObject({ key: 'rp:rp-top', role: 'custom', materialId: 'mat-mdf38', thickness: 38 })
    expect(solids[0].outline!.length).toBeGreaterThanOrEqual(4)
    const plan = planShapes(j)
    // the top seen from above is its 60" x 36" outline; a leg is a 2-1/2" x 1-1/2" strip
    const span = (pts: [number, number][], k: 0 | 1) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k]))
    expect(span(plan[0].points, 0)).toBeCloseTo(inch(60), 3)
    expect(span(plan[0].points, 1)).toBeCloseTo(inch(36), 3)
    expect(span(plan[1].points, 0)).toBeCloseTo(inch(2.5), 3)
    expect(span(plan[1].points, 1)).toBeCloseTo(38, 3)
    // seen facing the back wall: the top is a strip 1-1/2" high at 28-1/2", a leg its outline 28-1/2" high
    const elev = elevationShapes(j, (p) => p[0], 'y')
    expect(span(elev[0].points, 1)).toBeCloseTo(38, 3)
    expect(Math.min(...elev[0].points.map((p) => p[1]))).toBeCloseTo(inch(28.5), 3)
    expect(span(elev[1].points, 1)).toBeCloseTo(inch(28.5), 3)
    // the group moves and turns as one
    const g = groupOf(j, 'rp-leg-2')
    expect(g).toHaveLength(6)
    const b0 = groupBox(j, g)!
    moveGroup(g, 100, -50, 0)
    expect(groupBox(j, g)).toMatchObject({ x: b0.x + 100, y: b0.y - 50 })
    turnGroup(j, g)
    const b1 = groupBox(j, g)!
    expect(b1.w).toBeCloseTo(b0.d, 3)
    expect(b1.d).toBeCloseTo(b0.w, 3)
    expect(b1.x + b1.w / 2).toBeCloseTo(b0.x + 100 + b0.w / 2, 3)
    expect(b1.y + b1.d / 2).toBeCloseTo(b0.y - 50 + b0.d / 2, 3)
    expect(j.roomParts!.every((r) => r.rotation === 90)).toBe(true)
  })
  it('a part deleted from the job leaves its placements out', () => {
    const j = libraryJob()
    j.roomParts = [newRoomPart(j.camParts![0], j.room!, 'a'), { ...newRoomPart(j.camParts![0], j.room!, 'b'), partId: 'gone' }]
    expect(roomPartSolids(j).map((p) => p.key)).toEqual(['rp:a'])
  })
  it('changes no machining: the cut list, the nest and every program are the same with the parts placed', () => {
    const d = libraryData()
    const j = d.jobs[0]
    const parts = clone(j.camParts)
    const before = runJob(j, d)
    j.roomParts = [newRoomPart(j.camParts![0], j.room!, 'a', 'Table'), { id: 'b', partId: 'cp-leg', x: 0, y: 0, z: 0, rotation: 90, stand: 'end' }]
    const after = runJob(j, d)
    expect(after.instances.map((i) => [i.uid, i.cutLength, i.cutWidth])).toEqual(before.instances.map((i) => [i.uid, i.cutLength, i.cutWidth]))
    expect(mprFiles(j, d, after).map((f) => f.text)).toEqual(mprFiles(j, d, before).map((f) => f.text))
    expect(j.camParts).toEqual(parts)
  })
})

describe('Library-1 #8: 1-1/2" (38 mm) sheet stock, as placeholders with Configure badges', () => {
  it('in the library: MDF and plywood 38 mm, badged until confirmed or made the shop\'s own', () => {
    const l = defaultLibrary()
    const thick = l.materials.filter((m) => m.thickness === 38)
    expect(thick.map((m) => m.code)).toEqual(['MDF38', 'PLY38'])
    for (const m of thick) {
      expect(m.placeholderStock).toBe(true)
      expect(m.placeholder).toBeUndefined()
      const u = placeholderStock(m, defaultAppData().machine)!
      expect(u).toMatchObject({ key: `material:${m.id}:board`, group: 'Materials', target: { kind: 'material', materialId: m.id, part: 'board' } })
      expect(materialPlaceholder(m, defaultAppData().machine)).toEqual(u)
      expect(placeholderStock(m, { confirmed: [u.key] })).toBeNull()
      expect(placeholderStock({ ...m, placeholderStock: undefined }, defaultAppData().machine)).toBeNull()
    }
    expect(placeholderStock(thick[0], defaultAppData().machine)!.value).toBe('placeholder 38 mm, 2438.4 x 1219.2 mm sheet')
    // the drawer-box board placeholder is a different badge
    expect(placeholderBoard(thick[0], defaultAppData().machine)).toBeNull()
  })
  it('reach a shop file saved before them, once; one the shop deleted stays deleted', () => {
    const old = defaultAppData()
    old.library.materials = old.library.materials.filter((m) => !m.placeholderStock)
    delete old.library.seededMaterials
    const n = normalizeData(clone(old))
    expect(n.library.materials.filter((m) => m.placeholderStock).map((m) => m.id)).toEqual(THICK_STOCK_PLACEHOLDERS.map((m) => m.id))
    expect(n.library.seededMaterials).toEqual(THICK_STOCK_PLACEHOLDERS.map((m) => m.id))
    n.library.materials = n.library.materials.filter((m) => m.id !== 'mat-ply38')
    const again = normalizeData(clone(n))
    expect(again.library.materials.some((m) => m.id === 'mat-ply38')).toBe(false)
    expect(again.library.materials.filter((m) => m.id === 'mat-mdf38')).toHaveLength(1)
  })
  it('a job cutting a part from it lists it in the export check (UNCONFIRMED) until confirmed', () => {
    const d = libraryData()
    const issue = (dd: typeof d) => runJob(dd.jobs[0], dd).issues.find((i) => i.code === 'UNCONFIRMED')
    expect(issue(d)!.configure!.map((u) => u.key)).toContain('material:mat-mdf38:board')
    d.machine.confirmed = [...(d.machine.confirmed ?? []), 'material:mat-mdf38:board']
    expect(issue(d)?.configure?.map((u) => u.key) ?? []).not.toContain('material:mat-mdf38:board')
  })
})

describe('Library-1 #9: Change materials changes the shelf-front banding too', () => {
  it('the "Shelf fronts" picker: a whole-job switch to oak bands every shelf front in oak, shown in the preview, one undo', () => {
    expect(BAND_GROUPS).toContain('shelfFront')
    expect(BAND_GROUP_LABEL.shelfFront).toBe('Shelf fronts')
    const d = libraryData()
    const j = d.jobs[0]
    const swap = { materials: { carcass: 'mat-pb18-oak' }, edgebands: { carcassFront: 'eb-oak-1', shelfFront: 'eb-oak-1' }, scope: 'all' as const, replaceOverrides: false }
    const p = previewSwap(j, swap, d)
    const shelves = p.parts.filter((x) => x.key.startsWith('shelf-'))
    expect(shelves.length).toBe(j.cabinets.length * 5)
    for (const s of shelves) {
      expect(s.edgesChanged).toBe(true)
      expect(Object.values(s.after.edges)).toContain('eb-oak-1')
      expect(Object.values(s.before.edges)).toContain('eb-white-04')
    }
    const { cabinets, undo } = applySwap(j, swap, d.library)
    expect(cabinets.every((c) => c.params.edgebands.shelfFront === 'eb-oak-1')).toBe(true)
    expect(undo.changes.filter((c) => c.path.join('.') === 'params.edgebands.shelfFront')).toHaveLength(j.cabinets.length)
    const back = undoSwap({ cabinets }, undo)
    expect(back.cabinets.every((c) => c.params.edgebands.shelfFront === 'eb-white-04')).toBe(true)
    expect(back.skipped).toBe(0)
  })
})
