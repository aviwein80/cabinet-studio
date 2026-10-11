import { jsPDF } from 'jspdf'
import { describe, expect, it } from 'vitest'
import { newPart } from '../src/cam/doc'
import { countOf } from '../src/components/kindLabel'
import { areaField, areasCsv, jobCosts } from '../src/core/areas'
import { jobQuote, quoteCsv } from '../src/core/quote'
import { buildCabinet } from '../src/core/construction/carcass'
import { defaultAppData } from '../src/core/defaults'
import { elevationOf, frontDivisions, labelWidth, planNumberLabels } from '../src/core/elevation'
import { edgeLines, LABEL_TEXT_WIDTH, labelsPdf } from '../src/core/labels/pdf'
import { layoutOf, markUntouched, nestChangedText, readNestList, nestListJson } from '../src/core/manualNest'
import { nestValue } from '../src/core/nestConfirm'
import { buildFiles } from '../src/core/output'
import { runJob, type JobOutput } from '../src/core/pipeline'
import { arrangeCabinets, placementOf } from '../src/core/room'
import { sampleJob } from '../src/core/sample'
import type { AppData, CabinetInstance, Job } from '../src/core/types'
import { fineLength, pathLength, shapeArea, sizedName, TOOL_UNITS_NOTE, toolSize } from '../src/core/units'
import { add, inch, laundry, newJob, ortizKitchen, pantryWall, usBase, usWall } from './polish-2-jobs'

// Polish-3: fixes for what was found while re-recording the video tour on d7b8e08. One block per item.

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const FT2 = 304.8 * 304.8
const inchData = () => {
  const d = defaultAppData()
  d.settings.units = 'in'
  return d
}
const textOf = (f: { data: string | Uint8Array }) => (typeof f.data === 'string' ? f.data : new TextDecoder().decode(f.data))

describe('Polish-3 A: inch mode shows inches and feet everywhere (mm mode unchanged)', () => {
  it('1: the areas-and-costs CSV has its areas in ft² in an inch shop; the millimetre file is as before', () => {
    const mm = defaultAppData()
    const outMm = runJob(sampleJob(), mm)
    const costs = jobCosts(outMm.nest, outMm.instances, mm.library)
    const fileMm = textOf(buildFiles(['areas-csv'], sampleJob(), mm, outMm)[0])
    // millimetres: the header and every area as before (m² to 4 places), and the same as the call without units
    expect(fileMm.split('\r\n')[0]).toBe('Row,Sheet or part,Material,Area m2,Parts m2,Remnant m2,Scrap m2,Cost $,Parts cost,Remnant value,Scrap cost,Weight kg')
    // (Job-1: the quote follows the areas after a blank row)
    expect(fileMm).toBe(areasCsv(costs, outMm.instances, mm.library, '$') + quoteCsv(jobQuote(sampleJob(), outMm, mm)))
    expect(fileMm.split('\r\n')[1].split(',')[3]).toBe((costs.sheets[0].sheetArea / 1e6).toFixed(4))
    // inches: the same rows, areas in ft²
    const d = inchData()
    const out = runJob(sampleJob(), d)
    const file = textOf(buildFiles(['areas-csv'], sampleJob(), d, out)[0])
    const rows = file.split('\r\n')
    expect(rows[0]).toBe('Row,Sheet or part,Material,Area ft2,Parts ft2,Remnant ft2,Scrap ft2,Cost $,Parts cost,Remnant value,Scrap cost,Weight kg')
    expect(file).not.toMatch(/m2/)
    const c = jobCosts(out.nest, out.instances, d.library)
    expect(rows[1].split(',').slice(3, 7)).toEqual([c.sheets[0].sheetArea, c.sheets[0].partsArea, c.sheets[0].remnantArea, c.sheets[0].scrapArea].map((a) => (a / FT2).toFixed(4)))
    const total = rows.find((r) => r.startsWith('Total'))!.split(',')
    expect(total[3]).toBe((c.total.sheetArea / FT2).toFixed(4))
    expect(rows.length).toBe(fileMm.split('\r\n').length)
  })

  it('2: the custom-part shape panel gives a closed shape\'s area in ft² in an inch shop', () => {
    expect(shapeArea(154_300, 'mm')).toBe('0.1543 m²')
    expect(shapeArea(154_300, 'in')).toBe(`${(154_300 / FT2).toFixed(4)} ft²`)
    expect(shapeArea(154_300, 'in')).toBe('1.6609 ft²')
  })

  it('3: the simulator\'s cutting and rapid totals and the operation summary are in feet in an inch shop', () => {
    // simulator totals (to 0.1 m as before) and the operation summary's "m cut" (to 0.01 m as before)
    expect(pathLength(4200, 'mm')).toBe('4.2 m')
    expect(pathLength(1234, 'mm')).toBe('1.2 m')
    expect(pathLength(4200, 'mm', 2)).toBe('4.20 m')
    expect(pathLength(4200, 'in')).toBe('13.8 ft')
    expect(pathLength(1234, 'in')).toBe('4.0 ft')
    expect(pathLength(4200, 'in', 2)).toBe('13.8 ft')
    // the simulator's cell size: under 1/16", so decimal inches (it read 0")
    expect(fineLength(0.5, 'in')).toBe('0.020"')
    expect(fineLength(0.5, 'mm')).toBe('0.5')
  })

  it('4: the nesting area limits on Machine & tools are in ft² in an inch shop, their badges too; m² in mm as before', () => {
    expect(areaField(100_000, 'mm')).toMatchObject({ suffix: 'm²', value: 0.1, max: 3 })
    expect(areaField(50_000, 'mm').toMm2(0.05)).toBe(50_000)
    const f = areaField(100_000, 'in')
    expect(f).toMatchObject({ suffix: 'ft²', value: 1.08, max: 32 })
    expect(f.toMm2(1)).toBeCloseTo(FT2, 6)
    const mm = defaultAppData().settings
    expect(nestValue(mm, 'sharedSmall')).toBe('0.05 m², 120 mm side')
    expect(nestValue(mm, 'bridgeMaxArea')).toBe('0.10 m²')
    expect(nestValue(mm, 'bridgeWidth')).toBe('6 mm')
    expect(nestValue(mm, 'flipReference')).toBe('5 mm')
    const ins = inchData().settings
    expect(nestValue(ins, 'sharedSmall')).toBe('0.54 ft², 4-3/4" side')
    expect(nestValue(ins, 'bridgeMaxArea')).toBe('1.08 ft²')
    expect(nestValue(ins, 'bridgeWidth')).toBe('1/4"')
    expect(nestValue(ins, 'bridgeMaxLength')).toBe('13/16"')
  })

  it('5: tool sizes stay metric on purpose: the tool table says so, and the tool pickers carry the unit', () => {
    expect(TOOL_UNITS_NOTE).toMatch(/Tool sizes stay in millimetres, as the bits are made/)
    // each placeholder tool's name gives its metric size, and the picker's size reads with its unit
    for (const t of defaultAppData().machine.tools) {
      const named = /(\d+(?:\.\d+)?) mm/.exec(t.name)
      if (named) expect(Number(named[1])).toBe(t.diameter)
      const shown = toolSize(t.diameter, 'in')
      expect(shown === `${t.diameter} mm` || shown.endsWith('"')).toBe(true)
    }
    expect(toolSize(6, 'in')).toBe('6 mm')
    expect(toolSize(12.7, 'in')).toBe('1/2"')
  })
})

describe('Polish-3 A, found while fixing', () => {
  it('a part too big for the sheet: the export check gives its size and the sheet\'s in inches in an inch shop (mm as before)', () => {
    const job = (): Job => ({ ...newJob('J2061', 'Kim bench'), camParts: [newPart({ id: 'p-long', name: 'Bench top', length: 4000, width: 500, thickness: 18, materialId: 'mat-pb18-white' })] })
    const msg = (d: AppData) => runJob(job(), d).issues.find((i) => i.code === 'NOT_NESTED')!.message
    expect(msg(defaultAppData())).toBe('Part J2061-001 could not be nested: 4000 x 500 does not fit the usable sheet area 3638 x 1504')
    expect(msg(inchData())).toBe('Part J2061-001 could not be nested: 157-1/2" x 19-11/16" does not fit the usable sheet area 143-1/4" x 59-3/16"')
  })
})

describe('Polish-3 B: the room', () => {
  const lib = defaultAppData().library
  const placeOf = (j: Job) => {
    const laid = arrangeCabinets(j.cabinets, j.room!, lib)
    return (c: CabinetInstance) => placementOf(c, laid)
  }
  const byNo = (j: Job, n: string) => j.cabinets.find((c) => c.number === n)!

  it('6: an open cabinet (Doors: None) shows its shelves in the elevation, where the construction puts them', () => {
    for (const p of [usBase(24), usWall(30)]) {
      p.doors.count = 0
      expect(p.shelves.count).toBeGreaterThan(0)
      const d = frontDivisions(p, 0, 18)
      const shelves = d.filter((x) => x.kind === 'shelf')
      expect(shelves).toHaveLength(p.shelves.count)
      expect(d.filter((x) => x.kind !== 'shelf' && x.kind !== 'toe')).toEqual([])
      // each matches the shelf part of the construction: its height and its length between the sides
      const parts = buildCabinet({ id: 'c', number: 'B1', name: 'B', templateId: null, qty: 1, params: p, overrides: {} }, lib).parts.filter((q) => q.role === 'shelf')
      expect(parts).toHaveLength(shelves.length)
      shelves.forEach((s, i) => {
        // (the frame's origin is on face 1, the top; the board runs down from it)
        const f = parts[i].frame
        expect(f.n).toEqual([0, 0, 1])
        expect(s.z0).toBeCloseTo(f.origin[2] - parts[i].thickness, 6)
        expect(s.z1).toBeCloseTo(f.origin[2], 6)
        const x = [f.origin[0], f.origin[0] + f.u[0] * parts[i].length].sort((a, b) => a - b)
        expect(s.u0 * p.width).toBeCloseTo(x[0], 6)
        expect(s.u1 * p.width).toBeCloseTo(x[1], 6)
      })
    }
    // with doors, or with drawers, no shelves are drawn (they are behind the fronts, or left out)
    expect(frontDivisions(usBase(24), 0).some((x) => x.kind === 'shelf')).toBe(false)
    const drawers = usBase(18)
    drawers.doors.count = 0
    drawers.drawers = { ...drawers.drawers, count: 3 }
    expect(frontDivisions(drawers, 0).some((x) => x.kind === 'shelf')).toBe(false)
    // in a room: the laundry's W2 set to Doors: None, seen on the back wall
    const j = laundry()
    byNo(j, 'W2').params.doors.count = 0
    const w2 = elevationOf(j.cabinets, j.room!, 'back', placeOf(j), lib).find((e) => e.number === 'W2')!
    expect(w2.divisions.map((x) => x.kind)).toEqual(Array(byNo(j, 'W2').params.shelves.count).fill('shelf'))
    expect(w2.divisions.every((x) => x.z0 > w2.z && x.z1 < w2.z + w2.h)).toBe(true)
  })

  it('7: the plan keeps narrow neighbours\' numbers apart (the Ortiz end panel and filler ran together, "EF1")', () => {
    const j = ortizKitchen()
    const place = placeOf(j)
    const font = Math.max(j.room!.width, j.room!.depth) / 42
    const labels = planNumberLabels(j.cabinets, place, font)
    const box = (id: string) => {
      const l = labels.get(id)!
      const hw = labelWidth(l.item.number, l.size) / 2
      return { x0: l.x - hw, x1: l.x + hw, y0: l.y - l.size * 0.5, y1: l.y + l.size * 0.5, l }
    }
    const overlaps = (centred: boolean) => {
      const bs = [...labels.keys()].map((id) => {
        const b = box(id)
        if (!centred) return b
        const it = b.l.item
        const dx = it.x + it.w / 2 - b.l.x
        const dy = it.y + it.d / 2 - b.l.y
        return { ...b, x0: b.x0 + dx, x1: b.x1 + dx, y0: b.y0 + dy, y1: b.y1 + dy }
      })
      const out: string[] = []
      for (let a = 0; a < bs.length; a++)
        for (let b = a + 1; b < bs.length; b++)
          if (bs[a].x0 < bs[b].x1 && bs[a].x1 > bs[b].x0 && bs[a].y0 < bs[b].y1 && bs[a].y1 > bs[b].y0) out.push(`${bs[a].l.item.number}+${bs[b].l.item.number}`)
      return out
    }
    // as it was (every number in the middle of its footprint): the end panel and the filler beside it collide
    expect(overlaps(true).length).toBeGreaterThan(0)
    expect(overlaps(true).some((p) => /E\d/.test(p) && /F\d/.test(p))).toBe(true)
    // now: no two numbers overlap, each stays inside its own footprint, and wide cabinets' numbers do not move
    expect(overlaps(false)).toEqual([])
    for (const l of labels.values()) {
      const it = l.item
      expect(l.x).toBeGreaterThanOrEqual(it.x - 1e-6)
      expect(l.x).toBeLessThanOrEqual(it.x + it.w + 1e-6)
      expect(l.y).toBeGreaterThanOrEqual(it.y - 1e-6)
      expect(l.y).toBeLessThanOrEqual(it.y + it.d + 1e-6)
      if (labelWidth(it.number, l.size) <= it.w * 0.9 && l.size <= it.d * 0.9) expect([l.x, l.y]).toEqual([it.x + it.w / 2, it.y + it.d / 2])
    }
  })
})

describe('Polish-3 C: nesting and output', () => {
  const resize = (j: Job, d: AppData) => {
    const auto = runJob(j, d)
    j.nestEdit = { savedAt: '2026-10-11T12:00:00.000Z', sheets: markUntouched(layoutOf(auto.nest), auto.nest) }
    return auto
  }

  it('8: a hand-saved layout flags parts that changed size since (as it flags a material change) and offers the automatic nest', () => {
    const d = defaultAppData()
    const j = pantryWall(d)
    const auto = resize(j, d)
    // saved as the nester left it: nothing flagged
    const same = runJob(j, d)
    expect(same.nest.manual).toMatchObject({ moved: [], resized: [] })
    expect(same.issues.some((i) => i.code === 'NEST_SIZE')).toBe(false)
    expect(nestChangedText(same.nest.manual!, () => undefined)).toBeNull()
    // the first pantry made 1" narrower: its bottom, top, shelves, back and doors change size
    const p1 = j.cabinets.find((c) => c.number === 'T1')!
    p1.params.width -= inch(1)
    const after = runJob(j, d)
    const was = new Map(auto.instances.map((i) => [i.uid, i]))
    const changed = after.instances.filter((i) => was.has(i.uid) && (Math.abs(was.get(i.uid)!.cutLength - i.cutLength) > 0.01 || Math.abs(was.get(i.uid)!.cutWidth - i.cutWidth) > 0.01)).map((i) => i.uid)
    expect(changed.length).toBeGreaterThan(0)
    expect([...after.nest.manual!.resized].sort()).toEqual([...changed].sort())
    const issue = after.issues.find((i) => i.code === 'NEST_SIZE')!
    expect(issue.severity).toBe('warning')
    const no = (uid: string) => after.instances.find((i) => i.uid === uid)!.no
    expect(issue.message).toContain(`${changed.length} part(s) changed size since the layout was saved (#${no(after.nest.manual!.resized[0])}`)
    expect(issue.message).toContain('Re-nest automatically')
    // the Nesting tab's banner (with Re-nest automatically)
    expect(nestChangedText(after.nest.manual!, no)).toMatch(new RegExp(`^${changed.length} parts changed size since this layout was saved \\(#\\d+`))
    // a material change is still flagged as before, beside it
    const t2 = j.cabinets.find((c) => c.number === 'T2')!
    t2.params.carcassMaterialId = d.library.materials.find((m) => m.thickness === 18 && m.id !== t2.params.carcassMaterialId && !m.placeholder)!.id
    const both = runJob(j, d)
    expect(both.issues.some((i) => i.code === 'NEST_MATERIAL')).toBe(true)
    expect(both.issues.some((i) => i.code === 'NEST_SIZE')).toBe(true)
    expect(nestChangedText(both.nest.manual!, no)).toMatch(/changed size .*; \d+ parts? changed material/)
    // a layout saved before this run has no sizes: not checked (as before)
    const old = clone(j.nestEdit!)
    for (const s of old.sheets) for (const p of s.placements) delete p.size
    expect(runJob({ ...j, nestEdit: old }, d).nest.manual!.resized).toEqual([])
    // a nest list file keeps the sizes
    const read = readNestList(nestListJson(j.number, j.nestEdit!, auto.instances, d.library), auto.instances, d.library)
    expect(read.saved.sheets[0].placements[0].size).toEqual(j.nestEdit!.sheets[0].placements[0].size)
  })

  it('9: the small-part warning says what the onion skin setting does, not "not yet supported"', () => {
    const d = defaultAppData()
    const msg = (out: JobOutput) => out.issues.find((i) => i.code === 'SMALL_PART' && i.partNo === 22)!.message
    // off (the default)
    expect(msg(runJob(sampleJob(), d))).toBe('Part #22 (764 x 100) is small; vacuum may not hold it. Set an onion skin (Machine & tools → Nesting → Onion skin) so it stays held until the last pass.')
    // on, and the part is under the limit: it is left on the skin (and the sheet program does leave it)
    d.settings.nesting.onionSkin = 0.3
    d.settings.nesting.onionSkinMaxArea = 100_000
    const on = runJob(sampleJob(), d)
    expect(msg(on)).toBe('Part #22 (764 x 100) is small; vacuum may not hold it. It is left on the 0.3 mm onion skin, cut last.')
    // on, but only for smaller parts than this one
    d.settings.nesting.onionSkinMaxArea = 50_000
    expect(msg(runJob(sampleJob(), d))).toBe('Part #22 (764 x 100) is small; vacuum may not hold it. The onion skin is set only for parts under 0.050 m² (Machine & tools → Nesting → Onion skin); this part is larger.')
    const ins = inchData()
    ins.settings.nesting.onionSkin = 0.3
    ins.settings.nesting.onionSkinMaxArea = 50_000
    expect(msg(runJob(sampleJob(), ins))).toBe('Part #22 (30-1/16" x 3-15/16") is small; vacuum may not hold it. The onion skin is set only for parts under 0.54 ft² (Machine & tools → Nesting → Onion skin); this part is larger.')
    for (const out of [runJob(sampleJob(), defaultAppData()), on]) expect(out.issues.some((i) => /not yet supported/.test(i.message))).toBe(false)
  })
})

describe('Polish-3 D: labels and text', () => {
  /** Every text line printed in a label's left column (x = 4 mm, between the header and the barcode), with its width. */
  function leftColumn(out: JobOutput, units: 'mm' | 'in') {
    const lines: { page: number; text: string; y: number; right: number; size: number }[] = []
    // jsPDF's own hook on every text it prints (its `this` is the document)
    const events = (jsPDF.API as unknown as { events: [string, (p: { text: string[]; x: number; y: number }) => void][] }).events
    const hook: [string, (p: { text: string[]; x: number; y: number }) => void] = [
      'preProcessText',
      function (this: jsPDF, p) {
        const text = p.text.join('')
        if (p.x === 4 && p.y > 12 && p.y < 49) lines.push({ page: this.getNumberOfPages(), text, y: p.y, right: p.x + this.getTextWidth(text), size: this.getFontSize() })
      },
    ]
    events.push(hook)
    try {
      labelsPdf(out, '100x70', units, '2026-10-01T00:00:00.000Z')
    } finally {
      events.splice(events.indexOf(hook), 1)
    }
    // (each sheet's header page is full width by design: not a label)
    const headers = new Set(lines.filter((l) => l.text.startsWith('Program: ')).map((l) => l.page))
    expect(headers.size).toBe(out.programs.length)
    return lines.filter((l) => !headers.has(l.page))
  }

  it('10: label PDF: the size line and the Edges line stay clear of the part drawing and the sheet beside them', () => {
    const d = inchData()
    const out = runJob(ortizKitchen(d), d)
    const lines = leftColumn(out, 'in')
    // the drawing and the sheet start at 62 mm; every line ends before them
    expect(lines.length).toBeGreaterThan(out.labels.length * 5)
    for (const l of lines) expect(l.right).toBeLessThanOrEqual(4 + LABEL_TEXT_WIDTH + 1e-6)
    // a door banded on all four edges: every edge printed, on two lines, nothing cut
    const door = out.labels.find((l) => ['L1', 'L2', 'W1', 'W2'].every((k) => l.edges[k as 'L1']))!
    const pages = new Map<number, typeof lines>()
    for (const l of lines) pages.set(l.page, [...(pages.get(l.page) ?? []), l])
    const page = [...pages.values()].find((ls) => ls.some((l) => l.text === door.partName))!
    const edgeRows = page.filter((l) => l.y >= 43)
    expect(edgeRows).toHaveLength(2)
    expect(edgeRows.map((l) => l.text.trim()).join('  ')).toBe(`Edges: ${(['L1', 'L2', 'W1', 'W2'] as const).map((k) => `${k} ${door.edges[k]}`).join('  ')}`)
    expect(edgeRows[1].y).toBeLessThan(70 - 20 - 2) // above the barcode
    // the size line in full, set smaller to fit
    const size = page.find((l) => l.y === 29.5)!
    expect(size.text).toMatch(/^\d[\d/-]*" x \d[\d/-]*" x [\d/-]+"$/)
    expect(size.size).toBeLessThan(14)
    // a millimetre label that fits is printed as before (14 pt size line, one Edges line)
    const mm = defaultAppData()
    const sample = runJob(sampleJob(), mm)
    const sl = leftColumn(sample, 'mm')
    expect(sl.filter((l) => l.y === 29.5).every((l) => l.size === 14)).toBe(true)
    for (const l of sl) expect(l.right).toBeLessThanOrEqual(4 + LABEL_TEXT_WIDTH + 1e-6)
    // (the sample's doors are banded all round: their Edges ran under the sheet in millimetres too) a second
    // Edges line only where the one line would not fit
    const doc = new jsPDF({ unit: 'mm', format: [100, 70], orientation: 'landscape' })
    doc.setFontSize(7)
    const byPage = new Map<number, typeof sl>()
    for (const l of sl) byPage.set(l.page, [...(byPage.get(l.page) ?? []), l])
    let wrapped = 0
    for (const ls of byPage.values()) {
      const rows = ls.filter((l) => l.y >= 43)
      expect(rows.length).toBeGreaterThanOrEqual(1)
      const one = rows.map((l) => l.text.trim()).join('  ')
      expect(rows.length === 2).toBe(doc.getTextWidth(one) > LABEL_TEXT_WIDTH)
      if (rows.length === 2) wrapped++
    }
    expect(wrapped).toBeGreaterThan(0)
    expect(wrapped).toBeLessThan(byPage.size)
    // the helper on its own
    expect(edgeLines(doc, [], 7)).toEqual([{ text: 'Edges: none' }])
    expect(edgeLines(doc, ['L1 EB-WHT-1.0'], 7)).toEqual([{ text: 'Edges: L1 EB-WHT-1.0' }])
    expect(edgeLines(doc, ['L1 EB-WHT-1.0', 'L2 EB-WHT-1.0', 'W1 EB-WHT-1.0', 'W2 EB-WHT-1.0'], 7)).toHaveLength(2)
  })

  it('11: counts in the job header and the export check read "1 error", "2 errors"', () => {
    expect(countOf(1, 'error')).toBe('1 error')
    expect(countOf(2, 'error')).toBe('2 errors')
    expect(countOf(0, 'warning')).toBe('0 warnings')
    expect(countOf(1, 'part')).toBe('1 part')
    expect(countOf(1, 'operation')).toBe('1 operation')
  })

  it('12: Save as template: a name with the width inside it is not given the width twice', () => {
    expect(sizedName('Base 24" 2-door', inch(24), 'in')).toBe('Base 24" 2-door')
    expect(sizedName('Base 24" 2-door', inch(30), 'in')).toBe('Base 30" 2-door')
    expect(sizedName('Base 18" 3-drawer', inch(18), 'in')).toBe('Base 18" 3-drawer')
    expect(sizedName('Base 24-1/2" sink', inch(24.5), 'in')).toBe('Base 24-1/2" sink')
    expect(sizedName('Base 600 mm 2-door', 500, 'mm')).toBe('Base 500 mm 2-door')
    expect(sizedName('Base 600 2-door', 600, 'mm')).toBe('Base 600 2-door')
    // as before: a size at the end is replaced, a name without one gets it added
    expect(sizedName('Sink base 36"', inch(30), 'in')).toBe('Sink base 30"')
    expect(sizedName('Pie-cut corner base 36" x 36"', inch(36), 'in')).toBe('Pie-cut corner base 36" x 36"')
    expect(sizedName('Base cabinet, 2 doors', 600, 'mm')).toBe('Base cabinet, 2 doors 600')
    expect(sizedName('Sink base 900', 800, 'mm')).toBe('Sink base 800')
    // the tour's cabinet: "Base 24"" made a 2-door template
    const j = newJob('J2060', 'Template')
    const c = add(j, 'Base 24" 2-door', usBase(24))
    expect(sizedName(c.name, c.params.width, 'in')).toBe('Base 24" 2-door')
  })
})
