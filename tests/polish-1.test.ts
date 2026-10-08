import { describe, expect, it } from 'vitest'
import { makeEntity, newPart } from '../src/cam/doc'
import { pt, rect } from '../src/cam/geom'
import { writePartMpr } from '../src/cam/mpr'
import { readMpr } from '../src/cam/mprRead'
import { defaultOp } from '../src/cam/ops'
import { generatePart } from '../src/cam/toolpath'
import { toolUnconfirmed } from '../src/core/confirm'
import { generateCarcass } from '../src/core/construction/carcass'
import { elevationLabels, labelWidth } from '../src/core/elevation'
import { readerInUse } from '../src/core/hardware/aiProviders'
import { layoutOf } from '../src/core/manualNest'
import { arrangeCabinets, placementOf, pushNeighbours, roomProblems, DEFAULT_ROOM } from '../src/core/room'
import { sampleJob } from '../src/core/sample'
import { refitCamera } from '../src/components/viewerFit'
import { defaultAppData, defaultLibrary, PLACEHOLDER_MACHINE } from '../src/core/defaults'
import { DRILL_TOLERANCE, findDrill } from '../src/core/machining'
import { normalizeData } from '../src/core/normalize'
import { mprFiles, runJob } from '../src/core/pipeline'
import type { AppData, CabinetInstance, Job } from '../src/core/types'
import { importEdgebands, importMaterials, importTemplates, importTools, parseCsv } from '../src/core/library/import'
import { formatDims, offcutSize, parseLength, sizedName, toMm } from '../src/core/units'
import { cabinet, clone, data, job } from './helpers'

// Polish-1: fixes from the owner's video walkthrough. One block per item.

describe('Polish-1 units and inch mode', () => {
  it('1-3: card, dialog and part-panel sizes are in the shop unit and rounded for reading', () => {
    expect(formatDims([600, 870, 560], 'mm')).toBe('600 × 870 × 560')
    expect(formatDims([600, 876.3, 590.55], 'mm')).toBe('600 × 876.3 × 590.6')
    expect(formatDims([609.5999999999999, 876.3, 590.55], 'in')).toBe('24" × 34-1/2" × 23-1/4"')
    expect(formatDims([600, 870, 560], 'in')).toBe('23-5/8" × 34-1/4" × 22-1/16"')
    // no long float tails in either unit
    expect(formatDims([609.5999999999999], 'mm')).toBe('609.6')
  })

  it('4: offcut labels follow the shop unit', () => {
    expect(offcutSize(3380, 1524, 'mm')).toBe('3380 × 1524')
    expect(offcutSize(3380, 1524, 'in')).toBe('133-1/16" × 60"')
  })

  it('5: "Save as template" pre-fills a unit-correct name without repeating a size', () => {
    expect(sizedName('Sink base 36"', 914.4, 'in')).toBe('Sink base 36"')
    expect(sizedName('Sink base', 914.4, 'in')).toBe('Sink base 36"')
    expect(sizedName('Sink base 800', 800, 'mm')).toBe('Sink base 800')
    expect(sizedName('Sink base 36"', 914.4, 'mm')).toBe('Sink base 914')
    expect(sizedName('Wall 23-1/4"', 762, 'in')).toBe('Wall 30"')
    expect(sizedName('B3 drawer', 600, 'mm')).toBe('B3 drawer 600')
  })

  it('6: an explicit "mm" or "in" suffix wins over the shop unit in either mode', () => {
    expect(parseLength('6 mm', 'in')).toBe(6)
    expect(parseLength('6mm', 'in')).toBe(6)
    expect(parseLength('18 MM', 'in')).toBe(18)
    expect(parseLength('1/2"', 'mm')).toBeCloseTo(12.7, 9)
    expect(parseLength('1/2 in', 'mm')).toBeCloseTo(12.7, 9)
    expect(parseLength('23-1/4 in', 'mm')).toBeCloseTo(590.55, 9)
    expect(parseLength('2in', 'mm')).toBeCloseTo(50.8, 9)
    // unchanged behaviour without a suffix
    expect(parseLength('6', 'in')).toBeCloseTo(toMm(6), 9)
    expect(parseLength('6', 'mm')).toBe(6)
    expect(parseLength('mm', 'in')).toBeNull()
    expect(parseLength('abc mm', 'in')).toBeNull()
  })

  it('7: library import reads mm by default, inches when chosen, and a units column row by row', () => {
    const lib = defaultLibrary()
    const csv = 'code,name,thickness,sheetLength,sheetWidth\nPLY-IN,Ply,3/4,96,48\n'
    const asMm = importMaterials(parseCsv(csv), lib.materials)
    expect(asMm.units).toEqual({ default: 'mm', column: false, rows: { mm: 1, in: 0 } })
    // "3/4" is not a millimetre number: refused rather than guessed
    expect(asMm.errors).toHaveLength(1)
    const asIn = importMaterials(parseCsv(csv), lib.materials, 'in')
    const m = asIn.items.find((x) => x.code === 'PLY-IN')!
    for (const [got, want] of [[m.thickness, 19.05], [m.sheetLength, 2438.4], [m.sheetWidth, 1219.2]]) expect(got).toBeCloseTo(want, 9)

    const mixed = parseCsv('name,kind,width,height,depth,units\nBase 36,base,36,34-1/2,24,in\nBase 900,base,900,870,560,mm\nBase 600,base,600,870,560,\n')
    const res = importTemplates(mixed, lib.templates, lib)
    expect(res.units).toEqual({ default: 'mm', column: true, rows: { mm: 2, in: 1 } })
    const t36 = res.items.find((x) => x.name === 'Base 36')!
    expect(t36.params.width).toBeCloseTo(914.4, 9)
    expect(t36.params.height).toBeCloseTo(876.3, 9)
    expect(res.items.find((x) => x.name === 'Base 900')!.params.width).toBe(900)
    expect(res.items.find((x) => x.name === 'Base 600')!.params.width).toBe(600)

    // a unit written in the cell wins
    const eb = importEdgebands(parseCsv('code,thickness,width\nEB-X,1 mm,7/8"\n'), lib.edgebands, 'in')
    const e = eb.items.find((x) => x.code === 'EB-X')!
    expect(e.thickness).toBe(1)
    expect(e.width).toBeCloseTo(22.225, 9)

    const tools = importTools(parseCsv('number,type,diameter,maxDepth,units\n301,router,1/2,1-5/8,in\n'), data().machine.tools)
    const t = tools.items.find((x) => x.number === 301)!
    expect(t.diameter).toBeCloseTo(12.7, 9)
    expect(t.maxDepth).toBeCloseTo(41.275, 9)
  })
})

const FIVE_SIXTEENTHS = toMm(5 / 16) // 7.9375 mm

/** A cabinet whose left side carries one custom 5/16 in hole (Add hole dialog in an inch job). */
function holeJob(diameter = FIVE_SIXTEENTHS): Job {
  const c = cabinet('tpl-base-2door')
  c.overrides['side-left'] = { extraOps: [{ kind: 'drill', id: 'h516', x: 400, y: 280, diameter, depth: 10, through: false, purpose: 'custom' }] }
  return job([c])
}

const dus = (d: AppData, j: Job) => {
  const out = runJob(j, d)
  const all = mprFiles(j, d, out).flatMap((f) => readMpr(f.text).macros.filter((m) => m.id === 102).map((m) => ({ du: m.values.DU, mnm: m.values.MNM })))
  return { out, all }
}

describe('Polish-1 drilling and output', () => {
  it('8: a hole takes the nearest drill within the tolerance (0.1 mm by default), never outside it', () => {
    const m = clone(PLACEHOLDER_MACHINE)
    expect(DRILL_TOLERANCE).toBe(0.1)
    expect(findDrill(m, FIVE_SIXTEENTHS, 10, 'drill-vertical')?.number).toBe(203)
    expect(findDrill(m, 8, 10, 'drill-vertical')?.number).toBe(203)
    // 7.85 is 0.15 off 8: not matched
    expect(findDrill(m, 7.85, 10, 'drill-vertical')).toBeNull()
    // the setting widens or narrows it
    expect(findDrill({ ...m, drillTolerance: 0.2 }, 7.85, 10, 'drill-vertical')?.number).toBe(203)
    expect(findDrill({ ...m, drillTolerance: 0.05 }, FIVE_SIXTEENTHS, 10, 'drill-vertical')).toBeNull()
    // an exact drill wins over a nearer-numbered one; depth still counts
    expect(findDrill(m, 5, 10, 'drill-vertical')?.number).toBe(201)
    expect(findDrill(m, FIVE_SIXTEENTHS, 40, 'drill-vertical')).toBeNull()
  })

  it('8-9: the cabinet MPR asks for the matched drill (DU=8) and the checker says which drill was matched', () => {
    const d = data()
    const { out, all } = dus(d, holeJob())
    const hole = all.find((x) => /custom/.test(x.mnm))!
    expect(hole.du).toBe('8')
    expect(hole.mnm).toMatch(/D7\.938 drilled D8/)
    expect(out.issues.filter((i) => i.code === 'TOOL_MISSING')).toEqual([])
    const info = out.issues.find((i) => i.code === 'DRILL_MATCHED')!
    expect(info.severity).toBe('info')
    expect(info.message).toMatch(/D7\.938 hole\(s\).*T203 \(D8, \+0\.063 mm, within the ±0\.1 mm drill tolerance\)/)
  })

  it('8: outside the tolerance the hole is refused, never matched silently', () => {
    const { out } = dus(data(), holeJob(7.85))
    const miss = out.issues.find((i) => i.code === 'TOOL_MISSING')!
    expect(miss.severity).toBe('error')
    expect(miss.message).toMatch(/no vertical drill D7\.85 \(±0\.1 mm\)/)
    expect(out.issues.some((i) => i.code === 'DRILL_MATCHED')).toBe(false)
  })

  it('9: a custom part with T203 picked for a 5/16 in hole writes DU=8; a drill outside the tolerance blocks the export', () => {
    const part = newPart({ name: 'Plate', length: 300, width: 200, thickness: 19, entities: [] })
    const o = makeEntity({ t: 'contour', c: rect(0, 0, 300, 200) }, 'outline')
    const h = makeEntity({ t: 'circle', c: pt(150, 100), r: FIVE_SIXTEENTHS / 2 }, 'holes')
    part.entities = [o, h]
    part.outlineId = o.id
    part.ops = [defaultOp('drill', [h.id], { toolId: 't203' }), defaultOp('profile', [o.id])]
    const m = clone(PLACEHOLDER_MACHINE)
    const paths = generatePart(part, m)
    expect(paths[0].warnings.join(' ')).toMatch(/D7\.938 holes are drilled with T203 \(D8, \+0\.062 mm, within the ±0\.1 mm drill tolerance\)/)
    expect(paths[0].drills).toEqual([{ hole: 7.938, face: 1, tool: 203, diameter: 8, fits: true }])
    const drill = readMpr(writePartMpr(part, paths, m, 'MEL19')).macros.find((x) => x.id === 102)!
    expect(drill.values.DU).toBe('8')

    // automatic matching picks T203 too
    part.ops[0] = defaultOp('drill', [h.id])
    expect(generatePart(part, m)[0].drills?.[0].tool).toBe(203)

    // T204 (35 mm) picked by hand: warned in the toolpath and refused by the export checker
    part.ops[0] = defaultOp('drill', [h.id], { toolId: 't204' })
    const bad = generatePart(part, m)
    expect(bad[0].warnings.join(' ')).toMatch(/outside the ±0\.1 mm drill tolerance/)
    expect(bad[0].drills?.[0].fits).toBe(false)
    const d = data()
    d.settings.features = { ...d.settings.features, camMprOutput: true } as typeof d.settings.features
    const cp = { ...part, materialId: 'mat-mdf18', thickness: 18 }
    const j: Job = { ...job([]), camParts: [cp] }
    const refused = runJob(j, d).issues.filter((i) => i.code === 'DRILL_TOLERANCE')
    expect(refused).toHaveLength(1)
    expect(refused[0].severity).toBe('error')
    expect(refused[0].message).toMatch(/T204 \(D35\) is 27\.062 mm off the D7\.938 hole, outside the ±0\.1 mm drill tolerance/)
    // with T203 picked the same job exports without that error and asks for D8
    cp.ops = [defaultOp('drill', [h.id], { toolId: 't203' }), defaultOp('profile', [o.id])]
    const ok = runJob(j, d)
    expect(ok.issues.filter((i) => i.code === 'DRILL_TOLERANCE')).toEqual([])
    expect(ok.issues.find((i) => i.code === 'DRILL_MATCHED')?.message).toMatch(/T203 \(D8/)
    const du = mprFiles(j, d, ok).flatMap((f) => readMpr(f.text).macros.filter((x) => x.id === 102).map((x) => x.values.DU))
    expect(du).toEqual(['8'])
  })

  it('10: a placeholder 6 mm drill covers the Blum TANDEM runner holes, with a Configure badge', () => {
    const d = defaultAppData()
    const t6 = d.machine.tools.find((t) => t.type === 'drill-vertical' && t.diameter === 6)!
    expect(t6).toMatchObject({ number: 205, placeholder: true })
    const c = cabinet('tpl-base-drawers')
    const out = runJob(job([c]), d)
    expect(out.issues.filter((i) => i.code === 'TOOL_MISSING')).toEqual([])
    // badged while a placeholder, even in a real (non-placeholder) tool table; gone once confirmed
    const real = { ...d.machine, placeholder: false }
    expect(toolUnconfirmed(real, t6).map((u) => u.key)).toContain('tool:t205:data')
    expect(toolUnconfirmed({ ...real, confirmed: ['tool:t205:data'] }, t6)).toEqual([])
    // a placeholder table saved before Polish-1 gets the drill on load; a real table does not
    const old = clone(d)
    old.machine.tools = old.machine.tools.filter((t) => t.number !== 205)
    expect(normalizeData(old).machine.tools.some((t) => t.number === 205)).toBe(true)
    old.machine.placeholder = false
    expect(normalizeData(old).machine.tools.some((t) => t.number === 205)).toBe(false)
  })

  it('11: drawer boxes use their own material, and the TANDEM warning names what is really used', () => {
    const lib = defaultLibrary()
    const tpl = cabinet('tpl-base-drawers')
    expect(tpl.params.drawers.boxMaterialId).toBe('mat-pb16-white')
    const g = generateCarcass(tpl.params, lib)
    const sides = g.parts.filter((p) => /^drawer-\d-side/.test(p.key))
    expect(sides.length).toBe(6)
    expect(sides.every((p) => p.materialId === 'mat-pb16-white' && p.thickness === 16)).toBe(true)
    expect(g.warnings.some((w) => /TANDEM allows drawer sides/.test(w))).toBe(false)

    // no box material (cabinets saved before Polish-1): the 18 mm carcass board, and the warning says how to fix it
    const old = cabinet('tpl-base-drawers', (p) => (p.drawers.boxMaterialId = undefined))
    const g2 = generateCarcass(old.params, lib)
    expect(g2.parts.find((p) => p.key === 'drawer-1-side-l')!.thickness).toBe(18)
    expect(g2.warnings.find((w) => /TANDEM allows drawer sides/.test(w))).toMatch(/18 mm carcass board; choose a drawer-box material of 16 mm or less/)

    // an 18 mm box material chosen on purpose is still warned about, by name
    const thick = cabinet('tpl-base-drawers', (p) => (p.drawers.boxMaterialId = 'mat-mdf18'))
    expect(generateCarcass(thick.params, lib).warnings.find((w) => /TANDEM/.test(w))).toMatch(/18 mm drawer-box board \(MDF18\)/)
  })
})

describe('Polish-1 cabinets and room', () => {
  /** B1 600, B2 450, B3 800 along the back wall, then W1 600 above; all placed (after "Arrange"). */
  function arrangedRun() {
    const cabs: CabinetInstance[] = [
      cabinet('tpl-base-2door', () => {}, 'b1', 'B1'),
      cabinet('tpl-base-1door', () => {}, 'b2', 'B2'),
      cabinet('tpl-sink-base', () => {}, 'b3', 'B3'),
      cabinet('tpl-wall-2door', () => {}, 'w1', 'W1'),
    ]
    const laid = arrangeCabinets(cabs, DEFAULT_ROOM)
    for (const c of cabs) c.placement = laid[c.id]
    return cabs
  }
  const at = (cabs: CabinetInstance[], id: string) => cabs.find((c) => c.id === id)!.placement!

  it('12: widening a placed cabinet pushes its neighbours along the run; narrowing pulls them back; never overlaps', () => {
    const cabs = arrangedRun()
    expect(roomProblems(cabs, DEFAULT_ROOM, (c) => placementOf(c, {})).overlaps).toEqual([])
    const b2 = cabs.find((c) => c.id === 'b2')!
    b2.params.width = 600
    expect(roomProblems(cabs, DEFAULT_ROOM, (c) => placementOf(c, {})).overlaps).toEqual([['b2', 'b3']])
    expect(pushNeighbours(cabs, 'b2', 450, DEFAULT_ROOM)).toEqual(['b3'])
    expect(at(cabs, 'b3').x).toBe(1200)
    expect(at(cabs, 'b1').x).toBe(0)
    // the wall cabinet above is another run (different height band): not moved
    expect(at(cabs, 'w1').x).toBe(0)
    expect(roomProblems(cabs, DEFAULT_ROOM, (c) => placementOf(c, {})).overlaps).toEqual([])
    // narrowing keeps the run closed
    b2.params.width = 400
    pushNeighbours(cabs, 'b2', 600, DEFAULT_ROOM)
    expect(at(cabs, 'b3').x).toBe(1000)
    // a cabinet standing apart (gap) is left alone when there is room
    at(cabs, 'b3').x = 1500
    b2.params.width = 500
    expect(pushNeighbours(cabs, 'b2', 400, DEFAULT_ROOM)).toEqual([])
    expect(at(cabs, 'b3').x).toBe(1500)
  })

  it('12: an overlap or a cabinet past a wall is always reported', () => {
    const cabs = arrangedRun()
    at(cabs, 'b3').x = 3200
    const p = roomProblems(cabs, DEFAULT_ROOM, (c) => placementOf(c, {}))
    expect(p.outside).toEqual(['b3'])
  })

  it('13: elevation labels stay inside narrow cabinets (18 in, raised 54 in) instead of colliding', () => {
    const font = 3657.6 / 36
    const fmt = (mm: number) => formatDims([mm], 'in')
    for (const w of [toMm(18), toMm(19.5)]) {
      const item = { w, h: toMm(30), z: toMm(54) }
      const l = elevationLabels(item, font, fmt)
      expect(l.lines.map((x) => x.text)).toEqual(['30"', 'floor 54"'])
      for (const line of l.lines) expect(labelWidth(line.text, l.size)).toBeLessThanOrEqual(item.w * 0.92 + 1e-9)
      expect(labelWidth(l.width.text, l.width.size)).toBeLessThanOrEqual(item.w * 0.92 + 1e-9)
      // stacked, not on top of each other
      expect(l.lines[0].y - l.lines[1].y).toBeGreaterThanOrEqual(l.size)
    }
    // a wide cabinet keeps one line at the full size
    const wide = elevationLabels({ w: toMm(36), h: toMm(30), z: toMm(54) }, font, fmt)
    expect(wide.lines.map((x) => x.text)).toEqual(['30"  floor 54"'])
    expect(wide.size).toBeCloseTo(font * 0.7, 9)
  })

  it('14: the 3D view re-centres on a size change, keeping its angle', () => {
    const prev = { target: [0.225, 0.435, -0.28] as [number, number, number], size: 0.87 }
    const cam: [number, number, number] = [prev.target[0] + 1, prev.target[1] + 0.5, prev.target[2] + 1.5]
    const next = { target: [0.6, 0.435, -0.28] as [number, number, number], size: 1.2 }
    const p = refitCamera(cam, prev, next)
    const k = 1.2 / 0.87
    expect(p[0] - next.target[0]).toBeCloseTo(1 * k, 9)
    expect(p[1] - next.target[1]).toBeCloseTo(0.5 * k, 9)
    expect(p[2] - next.target[2]).toBeCloseTo(1.5 * k, 9)
  })

  it('15: only sheets laid out by hand are marked so; sheets the nester added are not', () => {
    const d = data()
    const base: Job = { ...sampleJob(), id: 'j', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
    const auto = runJob(base, d)
    expect(auto.nest.sheets.some((s) => s.manual)).toBe(false)
    // keep only the first sheet's layout: the rest are nested automatically
    const saved = { savedAt: '2026-10-06T09:00:00.000Z', sheets: layoutOf(auto.nest).slice(0, 1) }
    const out = runJob({ ...base, nestEdit: saved }, d)
    expect(out.nest.sheets.map((s) => !!s.manual)).toEqual([true, ...out.nest.sheets.slice(1).map(() => false)])
    expect(out.nest.sheets.length).toBeGreaterThan(1)
  })

  it('16: the spec-sheet reader says what is really in use', () => {
    expect(readerInUse({ provider: 'anthropic' }, null)).toBe('off')
    expect(readerInUse({ provider: 'anthropic' }, {})).toBe('off')
    expect(readerInUse({ provider: 'anthropic' }, { anthropic: { saved: false } })).toBe('off')
    expect(readerInUse({ provider: 'anthropic' }, { anthropic: { saved: true } })).toBe('anthropic')
    expect(readerInUse({ provider: 'off' }, { anthropic: { saved: true } })).toBe('off')
    expect(readerInUse(undefined, { anthropic: { saved: true } })).toBe('anthropic')
  })
})
