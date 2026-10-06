import { describe, expect, it } from 'vitest'
import type { PartInstance } from '../src/core/cutlist'
import { checkSheet, layoutOf, nestListJson, readNestList, snapPlacement, turnHalf, turnQuarter } from '../src/core/manualNest'
import { runJob } from '../src/core/pipeline'
import { sampleJob } from '../src/core/sample'
import type { Job, SavedNest } from '../src/core/types'
import { cabinet, clone, data } from './helpers'

const base: Job = { ...sampleJob(), id: 'j', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
const d = data()
const auto = runJob(base, d)
const saved = (): SavedNest => ({ savedAt: '2026-10-06T09:00:00.000Z', sheets: layoutOf(auto.nest) })
const withLayout = (s: SavedNest, j: Job = base): Job => ({ ...j, nestEdit: s })
const errors = (o: ReturnType<typeof runJob>) => o.issues.filter((i) => i.severity === 'error')

describe('manual nesting (NST-09)', () => {
  it('a saved layout of the automatic nest gives the same sheets and programs', () => {
    const out = runJob(withLayout(saved()), d)
    expect(out.nest.sheets.map((s) => s.placements)).toEqual(auto.nest.sheets.map((s) => s.placements))
    expect(out.programs.map((p) => p.ops)).toEqual(auto.programs.map((p) => p.ops))
    expect(out.nest.manual).toEqual({ savedAt: '2026-10-06T09:00:00.000Z', missing: [], added: [], moved: [] })
    expect(out.issues.some((i) => i.code === 'NEST_MANUAL')).toBe(true)
    expect(errors(out)).toEqual(errors(auto))
  })

  it('edits are re-validated: overlap, too close for the tool, closer than the spacing, off the sheet, against the grain', () => {
    const s = saved()
    const sheet = s.sheets.find((x) => x.placements.length >= 2)!
    const [a, b] = sheet.placements
    const inst = auto.instances.find((i) => i.uid === b.uid)!
    const wide = b.rotated ? inst.cutWidth : inst.cutLength
    const D = 12
    const at = (x: number) => {
      const t = clone(s)
      const sh = t.sheets[s.sheets.indexOf(sheet)]
      sh.placements[1] = { ...sh.placements[1], x, y: a.y }
      // keep the others out of the way of b
      sh.placements = sh.placements.filter((p, i) => i < 2 || Math.abs(p.y - a.y) > 2000)
      return runJob(withLayout(t), d)
    }
    const codes = (o: ReturnType<typeof runJob>) => o.issues.map((i) => i.code)
    const aw = a.rotated ? auto.instances.find((i) => i.uid === a.uid)!.cutWidth : auto.instances.find((i) => i.uid === a.uid)!.cutLength
    expect(codes(at(a.x + aw - 50))).toContain('OVERLAP')
    expect(codes(at(a.x + aw + 5))).toContain('SPACING')
    // 13 mm: the 12 mm tool fits, but the nest keeps 14 mm (tool + 2 extra)
    const near = at(a.x + aw + D + 1)
    expect(codes(near)).toContain('NEST_SPACING')
    expect(codes(near)).not.toContain('SPACING')
    expect(codes(at(3658 - wide + 30))).toContain('OUT_OF_SHEET')
    // grain: a grain-locked part on an oak (grained) sheet turned a quarter
    const oak = data((x) => (x.library.materials.find((m) => m.id === 'mat-pb18-oak')!.grain = true))
    const j = { ...base, cabinets: base.cabinets.map((c) => ({ ...c, params: { ...c.params, carcassMaterialId: 'mat-pb18-oak' } })) }
    const o1 = runJob(j, oak)
    const t = { savedAt: 'x', sheets: layoutOf(o1.nest) }
    const locked = o1.instances.find((i) => !i.canRotate && i.materialId === 'mat-pb18-oak')!
    const sh = t.sheets.find((x) => x.placements.some((p) => p.uid === locked.uid))!
    const k = sh.placements.findIndex((p) => p.uid === locked.uid)
    sh.placements[k] = turnQuarter(sh.placements[k], locked)
    expect(runJob({ ...j, nestEdit: t }, oak).issues.map((i) => i.code)).toContain('GRAIN')
  })

  it('parts gone from the job are reported missing, new parts are nested after the saved sheets', () => {
    const s = saved()
    const fewer = { ...base, cabinets: base.cabinets.slice(1) }
    const o1 = runJob(withLayout(s, fewer), d)
    expect(o1.nest.manual!.missing.length).toBeGreaterThan(0)
    expect(o1.issues.find((i) => i.code === 'NEST_MISSING')!.severity).toBe('warning')
    const more = { ...base, cabinets: [...base.cabinets, cabinet('tpl-base-2door', () => {}, 'cab-new', 'B99')] }
    const o2 = runJob(withLayout(s, more), d)
    expect(o2.nest.manual!.added.length).toBeGreaterThan(0)
    expect(o2.nest.manual!.added.every((u) => u.startsWith('cab-new'))).toBe(true)
    expect(o2.nest.sheets.length).toBeGreaterThan(s.sheets.length)
    // every part placed once, nothing overlaps
    const placed = o2.nest.sheets.flatMap((x) => x.placements.map((p) => p.uid))
    expect(new Set(placed).size).toBe(o2.instances.length)
    expect(errors(o2).filter((i) => ['OVERLAP', 'SPACING', 'OUT_OF_SHEET'].includes(i.code))).toEqual([])
  })

  it('split: parts moved onto a new sheet keep their places and get a program of their own', () => {
    const s = saved()
    const from = s.sheets.find((x) => x.placements.length >= 3)!
    const moved = from.placements.splice(0, 2)
    s.sheets.push({ ...from, offcutId: undefined, placements: moved })
    const out = runJob(withLayout(s), d)
    expect(out.programs.length).toBe(auto.programs.length + 1)
    expect(out.nest.sheets.at(-1)!.placements.map((p) => p.uid).sort()).toEqual(moved.map((p) => p.uid).sort())
    expect(errors(out)).toEqual(errors(auto))
  })
})

describe('editing helpers', () => {
  const inst = { uid: 'p', cutLength: 600, cutWidth: 300, outline: [], canRotate: true } as unknown as PartInstance
  it('snap: to the spacing beside a neighbour, edges in line, and to the trim', () => {
    const others = [{ uid: 'q', x: 10, y: 10, dx: 500, dy: 400, rotated: false }]
    const sheet = { sheetLength: 3658, sheetWidth: 1524 }
    const o = { spacing: 14, trim: 10, reach: 25 }
    expect(snapPlacement({ x: 530, y: 18, dx: 600, dy: 300 }, others, sheet, o)).toEqual({ x: 524, y: 10 })
    // top edges in line: y 110 + 300 = 410 = the neighbour's top
    expect(snapPlacement({ x: 700, y: 120, dx: 600, dy: 300 }, others, sheet, o)).toEqual({ x: 700, y: 110 })
    expect(snapPlacement({ x: 3040, y: 1200, dx: 600, dy: 300 }, [], sheet, o)).toEqual({ x: 3048, y: 1214 })
    // nothing near: left alone
    expect(snapPlacement({ x: 1500, y: 700, dx: 600, dy: 300 }, others, sheet, o)).toEqual({ x: 1500, y: 700 })
  })

  it('turning: a quarter about the middle, a half (end for end)', () => {
    const p = { uid: 'p', x: 100, y: 100, rotated: false }
    const q = turnQuarter(p, inst)
    expect(q).toEqual({ uid: 'p', x: 250, y: -50, rotated: true })
    expect(turnQuarter(q, inst)).toEqual(p)
    expect(turnHalf(p)).toEqual({ ...p, flip: true })
  })

  it('live check flags only the part being moved and its neighbours', () => {
    const map = new Map<string, PartInstance>([
      ['a', { ...inst, uid: 'a', outline: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 0, y: 300 }] }],
      ['b', { ...inst, uid: 'b', outline: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 0, y: 300 }] }],
      ['c', { ...inst, uid: 'c', outline: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 0, y: 300 }] }],
    ])
    const sheet = { sheetLength: 3658, sheetWidth: 1524, placements: [{ uid: 'a', x: 10, y: 10, rotated: false }, { uid: 'b', x: 615, y: 10, rotated: false }, { uid: 'c', x: 10, y: 1300, rotated: false }] }
    const o = { minGap: 12, spacing: 14, trim: 10, grain: false }
    // a and b 5 mm apart (closer than the tool); c runs past the top trim
    expect(checkSheet(sheet, map, o)).toEqual([
      { uid: 'c', kind: 'off-sheet' },
      { uid: 'a', other: 'b', kind: 'close' },
      { uid: 'b', other: 'a', kind: 'close' },
    ])
    expect(checkSheet(sheet, map, o, 'b')).toEqual([
      { uid: 'a', other: 'b', kind: 'close' },
      { uid: 'b', other: 'a', kind: 'close' },
    ])
  })
})

describe('nest list files', () => {
  it('save and reload: the same layout; unknown parts reported; parts found by label id', () => {
    const s = saved()
    const text = nestListJson(base.number, s, auto.instances, d.library)
    const back = readNestList(text, auto.instances, d.library)
    expect(back.saved).toEqual(s)
    expect(back.missing).toEqual([])
    // a list from an older version of the job: one uid changed (found by its part id), one part gone
    const raw = JSON.parse(text)
    const p0 = raw.sheets[0].placements[0]
    p0.uid = 'old-uid'
    raw.sheets[0].placements.push({ uid: 'gone', partId: 'J1042-999', x: 2000, y: 20, rotated: false })
    const r2 = readNestList(JSON.stringify(raw), auto.instances, d.library)
    expect(r2.saved.sheets[0].placements[0].uid).toBe(s.sheets[0].placements[0].uid)
    expect(r2.missing).toEqual([{ uid: 'gone', partId: 'J1042-999' }])
    expect(() => readNestList('{"format":"other"}', auto.instances, d.library)).toThrow(/not a Cabinet Studio nest list/)
    expect(() => readNestList('nope', auto.instances, d.library)).toThrow(/not JSON/)
  })
})
