import { jsPDF } from 'jspdf'
import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'
import { areasCsv, jobCosts } from '../src/core/areas'
import { generateCarcass } from '../src/core/construction/carcass'
import { defaultAppData, KITCHEN_PRESETS } from '../src/core/defaults'
import { BLUM, selectTandem, TANDEM } from '../src/core/hardware/specs'
import { applySwap } from '../src/core/jobMaterials'
import { labelsPdf, noteLines } from '../src/core/labels/pdf'
import { runJob, type JobOutput } from '../src/core/pipeline'
import { jobQuote, quoteCsv, unitPrice } from '../src/core/quote'
import { arrangeCabinets, cornerHints, cornerHintText, fillGap, jobFronts, placementOf, runGaps, withJobFronts } from '../src/core/room'
import type { AppData, CabinetInstance, CarcassParams, Job } from '../src/core/types'
import { add, arrange, fill, filler, inch, newJob, ortizKitchen, usBase, usDrawerBase, vanity } from './polish-2-jobs'

// Polish-4: fixes for what was found while recording the Advanced examples on c159f7b. One block per item.

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const inchData = () => {
  const d = defaultAppData()
  d.settings.units = 'in'
  return d
}
const preset = (id: string) => clone(KITCHEN_PRESETS.find((t) => t.id === id)!.params)
const pie = (side: 'left' | 'right') => {
  const p = preset('tpl-us-pie-base-36')
  if (p.corner?.type === 'pie-cut') p.corner.side = side
  return p
}

/**
 * A U-shaped kitchen: a base on the left wall, a pie-cut corner, the back wall (a 36" sink base with
 * MDF doors, a 24" base), a second pie-cut corner (from the same template: set to the back-left
 * corner), a base on the right wall.
 */
function uKitchen(data: AppData) {
  // the back wall is 3" longer than its cabinets
  const job = newJob('J2060', 'Nguyen kitchen', { width: inch(135), depth: inch(120), height: inch(96) })
  add(job, 'Base 24"', usBase(24))
  add(job, 'Pie-cut corner base 36"', pie('left'))
  add(job, 'Sink base 36"', usBase(36, (p) => ((p.shelves = { ...p.shelves, count: 0 }), (p.doorMaterialId = 'mat-mdf18'))))
  add(job, 'Base 24"', usBase(24))
  add(job, 'Pie-cut corner base 36"', pie('left'))
  add(job, 'Base 24"', usBase(24))
  arrange(job, data)
  return job
}

describe('Polish-4 1: the label notes print in full', () => {
  /** The notes printed at the foot of each label (bold, right-aligned at the label's right margin), with where they start. */
  function footers(out: JobOutput) {
    const rows: { page: number; text: string; left: number; right: number; y: number; size: number }[] = []
    const ids: { page: number; right: number }[] = []
    const events = (jsPDF.API as unknown as { events: [string, (p: { text: string[]; x: number; y: number; options: { align?: string } }) => void][] }).events
    const hook: [string, (p: { text: string[]; x: number; y: number; options: { align?: string } }) => void] = [
      'preProcessText',
      function (this: jsPDF, p) {
        const text = p.text.join('')
        const w = this.getTextWidth(text)
        if (p.y > 55 && p.options?.align === 'right') rows.push({ page: this.getNumberOfPages(), text, left: p.x - w, right: p.x, y: p.y, size: this.getFontSize() })
        if (p.x === 4 && Math.abs(p.y - 64) < 1e-6) ids.push({ page: this.getNumberOfPages(), right: 4 + w })
      },
    ]
    events.push(hook)
    try {
      labelsPdf(out, '100x70', 'in', '2026-10-01T00:00:00.000Z')
    } finally {
      events.splice(events.indexOf(hook), 1)
    }
    return { rows, ids }
  }

  it('1: Ortiz F1: "Scribe 1/2" on L2: trim to the wall | Label does not fit: apply to back face" in full, inside the label', () => {
    const d = inchData()
    const out = runJob(ortizKitchen(d), d)
    const f1 = out.labels.find((l) => l.cabinet === 'F1 Filler' && l.partName === 'Filler')!
    const want = 'Scribe 1/2" on L2: trim to the wall | Label does not fit: apply to back face'
    expect(f1.notes.join(' | ')).toBe(want)
    expect(want.length).toBeGreaterThan(60) // (it was cut at 60: "...Label does not fit: ap")
    const { rows } = footers(out)
    const row = rows.find((r) => r.text === want)!
    expect(row).toBeDefined()
    expect(row.size).toBe(7) // it fits on one line at the size every note had
    expect(row.left).toBeGreaterThanOrEqual(3 - 1e-6)
    expect(row.right).toBeLessThanOrEqual(100 - 3 + 1e-6)
    // every label's notes are printed whole, on the label
    for (const l of out.labels.filter((x) => x.notes.length)) {
      const page = rows.filter((r) => r.y > 66)
      expect(page.some((r) => r.text === l.notes.join(' | '))).toBe(true)
    }
    for (const r of rows) expect(r.left).toBeGreaterThanOrEqual(3 - 1e-6)
  })

  it('1: notes too long for one line go on two, the upper one clear of the part id; the program and edge code move up a line', () => {
    const d = inchData()
    const out = runJob(ortizKitchen(d), d)
    const f1 = out.labels.find((l) => l.cabinet === 'F1 Filler' && l.partName === 'Filler')!
    const notes = ['Edge drill: 2x D8, 4x D5', ...f1.notes, "Fix on site under shelf 2's back corner", 'Inside corner R0.236"']
    f1.notes = notes
    const { rows, ids } = footers(out)
    const page = rows.find((r) => r.text.startsWith('Edge drill'))!.page
    const mine = rows.filter((r) => r.page === page).sort((a, b) => a.y - b.y)
    const id = ids.find((i) => i.page === page)!
    // program, edge code, then the two note lines
    expect(mine.map((r) => r.y)).toEqual([70 - 12, 70 - 9, 70 - 5.2, 70 - 2.5])
    const [, , upper, lower] = mine
    expect(`${upper.text} | ${lower.text}`).toBe(notes.join(' | ')) // split between two notes, nothing lost
    expect(upper.left).toBeGreaterThan(id.right)
    expect(lower.left).toBeGreaterThanOrEqual(3 - 1e-6)
    for (const r of mine) expect(r.right).toBeLessThanOrEqual(97 + 1e-6)
    expect(upper.size).toBeGreaterThanOrEqual(5)
    // the helper: one line at 7 pt when it fits, smaller before wrapping
    const doc = new jsPDF({ unit: 'mm', format: [100, 70], orientation: 'landscape' })
    doc.setFont('helvetica', 'bold')
    expect(noteLines(doc, [], 100, 20)).toEqual([])
    expect(noteLines(doc, ['Label does not fit: apply to back face'], 100, 20)).toEqual([{ text: 'Label does not fit: apply to back face', size: 7 }])
    const longer = ['Scribe 1/2" on L2: trim to the wall', 'Label does not fit: apply to back face', 'Inside corner R0.236"']
    const one = noteLines(doc, longer, 100, 20)
    expect(one).toHaveLength(1)
    expect(one[0].size).toBeLessThan(7)
    expect(one[0].text).toBe(longer.join(' | '))
  })
})

describe('Polish-4 2: one rule for a filler\'s board', () => {
  it('2: Split in a U kitchen: both fillers take the job\'s front board, not the MDF of the sink base beside one of them', () => {
    const d = inchData()
    const job = uKitchen(d)
    job.cabinets[4].params.corner = { ...(job.cabinets[4].params.corner as Extract<CarcassParams['corner'], { type: 'pie-cut' }>), side: 'right' }
    arrange(job, d)
    const laid = arrangeCabinets(job.cabinets, job.room!, d.library)
    const place = (c: CabinetInstance) => placementOf(c, laid)
    const gap = runGaps(job.cabinets, job.room!, place, d.library).find((g) => g.wall === 'back' && g.level === 'floor')!
    expect(gap.ids.map((id) => job.cabinets.find((c) => c.id === id)!.number)).toEqual(['B3', 'B4'])
    let n = 0
    const ids = fillGap(job, gap, 'split', filler('base'), job.room!, place, () => `f-${++n}`)
    const fillers = ids.map((id) => job.cabinets.find((c) => c.id === id)!)
    // the start filler stands beside the MDF sink base (it took MDF before), the end one beside a white base
    expect(job.cabinets[job.cabinets.indexOf(fillers[0]) + 1].params.doorMaterialId).toBe('mat-mdf18')
    for (const f of fillers) {
      expect(f.params.doorMaterialId).toBe('mat-pb18-white')
      expect(f.params.carcassMaterialId).toBe('mat-pb18-white')
      expect(f.params.edgebands.door).toEqual(job.cabinets[0].params.edgebands.door)
    }
  })

  it('2: Fill gap and a filler added from its template follow the same rule; a board set by hand on one filler stays, Arrange too', () => {
    const d = inchData()
    // the vanity: most fronts MDF (both cabinets); Fill gap gives MDF, as a filler added by hand does
    const job = vanity(d)
    job.cabinets[0].params.width = inch(27)
    for (const c of job.cabinets) c.params.doorMaterialId = 'mat-mdf18'
    arrange(job, d)
    const [id] = fill(job, d, 'one')
    const f1 = job.cabinets.find((c) => c.id === id)!
    expect(f1.params.doorMaterialId).toBe('mat-mdf18')
    // the store's Add: a filler template's params with the job's boards
    expect(withJobFronts(clone(filler('base')), jobFronts(job.cabinets)).doorMaterialId).toBe('mat-mdf18')
    // a cabinet that is not a filler keeps its template's boards
    expect(withJobFronts(usBase(24), jobFronts(job.cabinets)).doorMaterialId).toBe('mat-pb18-white')
    // no cabinet to take it from: the template's
    expect(jobFronts([])).toBeNull()
    expect(withJobFronts(clone(filler('base')), null).doorMaterialId).toBe(filler('base').doorMaterialId)
    // editable per filler: set by hand, kept by Arrange
    f1.params.doorMaterialId = 'mat-pb18-oak'
    arrange(job, d)
    expect(f1.params.doorMaterialId).toBe('mat-pb18-oak')
    // "most": copies count, fillers and end panels do not, an open cabinet's unused door board does not either
    const j2 = newJob('J1', 'Count')
    add(j2, 'A', usBase(24, (p) => (p.doorMaterialId = 'mat-mdf18')))
    add(j2, 'B', usBase(24)).qty = 3
    add(j2, 'Open', usBase(24, (p) => ((p.doors.count = 0), (p.doorMaterialId = 'mat-pb18-oak')))).qty = 9
    add(j2, 'F', filler('base')).params.doorMaterialId = 'mat-pb18-oak'
    expect(jobFronts(j2.cabinets)!.doorMaterialId).toBe('mat-pb18-white')
    // on a tie, the first cabinet's
    j2.cabinets[1].qty = 1
    expect(jobFronts(j2.cabinets)!.doorMaterialId).toBe('mat-mdf18')
  })
})

describe('Polish-4 3: a second corner cabinet in a U-shaped kitchen', () => {
  it('3: two pie-cuts both set to the back-left corner: the room says to set the second to Back-right; once set, Arrange turns the run there', () => {
    const d = inchData()
    const job = uKitchen(d)
    const num = (id: string) => job.cabinets.find((c) => c.id === id)!.number
    const hints = cornerHints(job.cabinets)
    expect(hints).toHaveLength(1)
    const h = hints[0]
    expect([num(h.id), num(h.takenBy), h.corner, h.free, h.field, h.value, h.move]).toEqual(['B5', 'B2', 'left', 'right', 'Which corner', 'Back-right', false])
    expect(cornerHintText(h, num)).toBe(
      "B5 is set to the back-left corner, which B2 already fills, so Arrange lays it along the back wall. To put it in the free back-right corner (a U-shaped kitchen), set B5's Which corner to Back-right: Arrange then turns the run there.",
    )
    // before: B5 on the back wall like any other cabinet, and B6 after it, past the right wall
    const room = job.room!
    expect(job.cabinets[4].placement!.rotation).toBe(0)
    expect(job.cabinets[5].placement!.rotation).toBe(0)
    // set as the hint says
    const c = job.cabinets[4].params.corner as Extract<CarcassParams['corner'], { type: 'pie-cut' }>
    c.side = h.value === 'Back-right' ? 'right' : 'left'
    arrange(job, d)
    expect(cornerHints(job.cabinets)).toEqual([])
    const b5 = job.cabinets[4]
    expect(b5.placement!.x + b5.params.width).toBeCloseTo(room.width, 3) // in the back-right corner
    expect(job.cabinets[5].placement!.rotation).toBe(90) // B6 on the right wall
  })

  it('3: blind corners and the wall-cabinet run get the same hint; no hint when both corners are filled', () => {
    const blind = (id: string) => preset(id)
    const job = newJob('J2061', 'Blind U', { width: inch(150), depth: inch(120), height: inch(96) })
    add(job, 'Blind corner base 36"', blind('tpl-us-blind-base-36'))
    add(job, 'Base 24"', usBase(24))
    add(job, 'Blind corner base 36"', blind('tpl-us-blind-base-36'))
    add(job, 'Pie-cut wall 24"', preset('tpl-us-pie-wall-24'))
    add(job, 'Pie-cut wall 24"', preset('tpl-us-pie-wall-24'))
    const num = (id: string) => job.cabinets.find((c) => c.id === id)!.number
    const side = (job.cabinets[0].params.corner as { blindSide: string }).blindSide
    const hints = cornerHints(job.cabinets)
    expect(hints.map((x) => [num(x.id), num(x.takenBy), x.field, x.value])).toEqual([
      ['B3', 'B1', 'Blind side', side === 'left' ? 'Right' : 'Left'],
      ['W2', 'W1', 'Which corner', 'Back-right'],
    ])
    // a blind corner on a side wall has its blind side the other way round: blind left on the side wall
    // is the back-right corner, so B1 fills that one and B3 is told to set Right for the back-left
    expect(side).toBe('left')
    const onSide = clone(job)
    for (const i of [0, 2]) (onSide.cabinets[i].params.corner as { wall?: string }).wall = 'side'
    const b3 = cornerHints(onSide.cabinets).find((x) => num(x.id) === 'B3')!
    expect([b3.corner, b3.free, b3.value, b3.move]).toEqual(['right', 'left', 'Right', true])
    // both corners filled: nothing to say
    for (const x of hints) {
      const k = job.cabinets.find((c) => c.id === x.id)!.params.corner!
      if (k.type === 'pie-cut') k.side = 'right'
      else k.blindSide = k.blindSide === 'left' ? 'right' : 'left'
    }
    expect(cornerHints(job.cabinets)).toEqual([])
    // a second back-right corner with the back-left free must also be listed before the back wall's cabinets
    const r = newJob('J2062', 'Right', { width: inch(150), depth: inch(120), height: inch(96) })
    add(r, 'Base 24"', usBase(24))
    add(r, 'Pie', pie('right'))
    add(r, 'Pie', pie('right'))
    expect(cornerHints(r.cabinets).map((x) => [x.free, x.value, x.move])).toEqual([['left', 'Back-left', true]])
  })
})

describe('Polish-4 4: the TANDEM runner is picked from Blum\'s minimum inside cabinet depth', () => {
  const runner = (g: ReturnType<typeof generateCarcass>) => g.hardware.filter((h) => /^563H/.test(h.hardwareCode)).map((h) => h.hardwareCode)
  const inside = (p: CarcassParams, lib = defaultAppData().library) => p.depth - p.back.setback - (lib.materials.find((m) => m.id === p.backMaterialId)!.thickness + p.back.clearance)

  it('4: a 530 mm (20-7/8") deep drawer base takes the 18" runner (511.5 mm inside; Blum: 480 mm, 18-29/32")', () => {
    for (const units of ['mm', 'in'] as const) {
      const d = defaultAppData()
      d.settings.units = units
      const p = usDrawerBase(18)
      p.depth = units === 'mm' ? 530 : inch(20 + 7 / 8)
      expect(inside(p)).toBeGreaterThan(480)
      expect(inside(p)).toBeLessThan(557)
      const g = generateCarcass(p, d.library, undefined, units)
      expect(runner(g)).toEqual(['563H4570B'])
      expect(g.warnings.filter((w) => /TANDEM|depth/i.test(w))).toEqual([])
      const side = g.parts.find((x) => x.key === 'drawer-1-side-l')!
      expect(side.length).toBe(457)
    }
  })

  it('4: a 24" base takes the 21" runner (it took 18": 609.6 mm was under "610"); 21" takes 18"; 18" takes 15"', () => {
    const d = defaultAppData()
    for (const [depth, code] of [[inch(24), '563H5330B'], [inch(21), '563H4570B'], [inch(18), '563H3810B']] as const) {
      const p = usDrawerBase(18)
      p.depth = depth
      expect(runner(generateCarcass(p, d.library, undefined, 'in'))).toEqual([code])
    }
  })

  it('4: the limits are Blum\'s inside depths, both ways; too shallow for any runner is a warning in the shop unit', () => {
    expect(TANDEM.map((t) => [t.inches, t.minInside])).toEqual([[15, 404], [18, 480], [21, 557]])
    expect(selectTandem(557, 'auto').slide.inches).toBe(21)
    expect(selectTandem(556.9, 'auto').slide.inches).toBe(18)
    expect(selectTandem(480, 'auto').slide.inches).toBe(18)
    expect(selectTandem(479.9, 'auto').slide.inches).toBe(15)
    expect(selectTandem(404, 'auto').shallow).toBe(false)
    expect(selectTandem(403.9, 'auto').shallow).toBe(true)
    expect(selectTandem(500, 21)).toEqual({ slide: TANDEM[2], shallow: true })
    for (const units of ['mm', 'in'] as const) {
      const d = defaultAppData()
      const p = usDrawerBase(18)
      p.depth = 400
      const w = generateCarcass(p, d.library, undefined, units).warnings.filter((x) => /TANDEM runner/.test(x))
      expect(w).toEqual([
        units === 'mm'
          ? 'Inside depth 381.5 mm (cabinet depth 400 mm) is under the 404 mm minimum inside depth for a 15 in TANDEM runner.'
          : 'Inside depth 15" (cabinet depth 15-3/4") is under the 15-7/8" minimum inside depth for a 15 in TANDEM runner.',
      ])
    }
  })

  it('4: the library\'s own minimum inside depth (a runner from another maker) picks the runner and drives the warning', () => {
    const d = defaultAppData()
    const row = d.library.hardware.find((h) => h.code === '563H4570B')!
    expect(row.minInsideDepth).toBe(480)
    row.minInsideDepth = 520
    const p = usDrawerBase(18)
    p.depth = 530
    expect(runner(generateCarcass(p, d.library))).toEqual(['563H3810B'])
    p.drawers.slide = 18
    expect(generateCarcass(p, d.library).warnings.filter((x) => /TANDEM runner/.test(x))).toEqual(['Inside depth 511.5 mm (cabinet depth 530 mm) is under the 520 mm minimum inside depth for a 18 in TANDEM runner.'])
    expect(BLUM.runnerSetback).toBe(3)
  })
})

describe('Polish-4 5: the Patel vanity change order', () => {
  it('5: 4 drawers, the sink base narrowed to 27" with a filler, MDF fronts: the two new warnings are the filler\'s two strips, small parts', () => {
    const d = inchData()
    const job = vanity(d)
    const warnings = (j: Job) => runJob(j, d).issues.filter((i) => i.severity === 'warning').map((i) => `${i.code} ${i.message.replace(/Part #\d+ /, '')}`)
    const before = warnings(job)
    job.cabinets[1].params.drawers.count = 4
    job.cabinets[0].params.width = inch(27)
    arrange(job, d)
    fill(job, d, 'one')
    job.cabinets = applySwap(job, { materials: { fronts: 'mat-mdf18' }, edgebands: {}, scope: 'all', replaceOverrides: false }, d.library).cabinets
    const after = warnings(job)
    expect(after.length).toBe(before.length + 2)
    const added = [...after]
    for (const w of before) {
      const i = added.findIndex((x) => x.split(' ')[0] === w.split(' ')[0] && (x === w || w.startsWith('UNCONFIRMED') || w.startsWith('SMALL_PART')))
      if (i >= 0) added.splice(i, 1)
    }
    // the filler strip (3" x 27-1/2") and its return (3-7/16" x 27-1/2"): narrow strips the vacuum may not hold,
    // flagged by the same rule as the vanity's 3-7/8" drawer parts already were
    expect(added.every((w) => w.startsWith('SMALL_PART'))).toBe(true)
    const out = runJob(job, d)
    const f1 = out.instances.filter((i) => i.cabinetNumber === 'F1')
    expect(f1.map((i) => i.part.name).sort()).toEqual(['Filler', 'Filler return'])
    const small = out.issues.filter((i) => i.code === 'SMALL_PART').map((i) => Number(/#(\d+)/.exec(i.message)![1]))
    for (const i of f1) expect(small).toContain(i.no)
    expect(small.length).toBe(before.filter((w) => w.startsWith('SMALL_PART')).length + 2)
  })
})

describe('Polish-4 6: unit prices are shown rounded, the same way everywhere', () => {
  it('6: labour per door at 52/h, 10 min: 8.67 in the areas-and-costs and BOM CSVs (was 8.6667); amounts from the exact price', () => {
    expect(unitPrice((10 / 60) * 52)).toBe('8.67')
    expect(unitPrice(12.5)).toBe('12.50')
    expect(unitPrice(1.005)).toBe('1.01')
    expect(unitPrice(1)).toBe('1.00')
    // under 1.00 a price keeps its fractions of a cent (edgeband per foot)
    expect(unitPrice(0.035)).toBe('0.035')
    expect(unitPrice(0.3048)).toBe('0.3048')
    expect(unitPrice(0.5)).toBe('0.50')
    const d = inchData()
    d.settings.pricing = { shopRate: 52 }
    const job = ortizKitchen(d)
    const out = runJob(job, d)
    const q = jobQuote(job, out, d)
    const door = q.lines.find((l) => l.key === 'labour')!.items.find((i) => i.unit === 'doors')!
    expect(door.price).toBeCloseTo(8.666667, 5)
    const csv = quoteCsv(q)
    const rows = Papa.parse<string[]>(csv.trim()).data
    const row = rows.find((r) => r[0] === 'Labour' && r[1] === door.code)!
    expect(row[5]).toBe('8.67')
    expect(row[6]).toBe(((door.qty * 10 * 52) / 60).toFixed(2))
    // every price and amount in the block to the cent (none of these is under 1.00)
    for (const r of rows.slice(1)) for (const v of r.slice(5, 7)) if (v) expect(v).toMatch(/^\d+\.\d\d$/)
    // the areas-and-costs CSV carries the same block
    expect(areasCsv(jobCosts(out.nest, out.instances, d.library), out.instances, d.library, '$', 'in') + quoteCsv(q)).toContain(',8.67,')
  })
})
