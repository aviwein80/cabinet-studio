import { jsPDF } from 'jspdf'
import { describe, expect, it } from 'vitest'
import { areasCsv, jobCosts } from '../src/core/areas'
import { buildCabinet } from '../src/core/construction/carcass'
import { expandJob } from '../src/core/cutlist'
import { defaultAppData } from '../src/core/defaults'
import { applySwap, cabinetWalls, partRoles, planSwap, previewSwap, undoSwap, type MaterialSwap } from '../src/core/jobMaterials'
import { nestJob } from '../src/core/machining'
import { layoutOf } from '../src/core/manualNest'
import { bomCsv, buildFiles } from '../src/core/output'
import { runJob } from '../src/core/pipeline'
import { bandPriceShown, bandPriceStored, jobQuote, labourUnconfirmed, M_PER_FT, PLACEHOLDER_LABOUR_MINUTES, quoteCsv, round2 } from '../src/core/quote'
import { quotePdf } from '../src/core/quotePdf'
import { sampleJob } from '../src/core/sample'
import type { AppData, Job } from '../src/core/types'
import { ortizKitchen, vanity } from './polish-2-jobs'

// Job-1: change materials for a whole job (A) and pricing beyond board (B).

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const swapOf = (s: Partial<MaterialSwap>): MaterialSwap => ({ materials: {}, edgebands: {}, scope: 'all', replaceOverrides: false, ...s })
const partsOf = (job: Job, d: AppData, cabId: string) => buildCabinet(job.cabinets.find((c) => c.id === cabId)!, d.library).parts
const textOf = (f: { data: string | Uint8Array }) => (typeof f.data === 'string' ? f.data : new TextDecoder().decode(f.data))

describe('Job-1 A: change materials for a whole job', () => {
  it('scope all: every cabinet takes the new carcass and fronts; backs and drawer boxes kept as they are', () => {
    const d = defaultAppData()
    const job = sampleJob()
    const { cabinets, undo } = applySwap(job, swapOf({ materials: { carcass: 'mat-pb16-white', fronts: 'mat-mdf18' } }), d.library)
    const after = { ...job, cabinets }
    for (const c of after.cabinets) {
      expect(c.params.carcassMaterialId).toBe('mat-pb16-white')
      expect(c.params.doorMaterialId).toBe('mat-mdf18')
      expect(c.params.backMaterialId).toBe('mat-hdf6-white')
      for (const p of partsOf(after, d, c.id)) {
        if (p.role === 'door') expect(p.materialId).toBe('mat-mdf18')
        else if (p.role === 'back') expect(p.materialId).toBe('mat-hdf6-white')
        else expect(p.materialId).toBe('mat-pb16-white')
      }
    }
    // two settings on each of the four cabinets
    expect(undo.changes).toHaveLength(8)
    // nothing on the input job moved
    expect(job.cabinets[0].params.carcassMaterialId).toBe('mat-pb18-white')
  })

  it('scope: a chosen set only; "select by wall" sorts the cabinets by the wall they stand on', () => {
    const d = defaultAppData()
    const job = ortizKitchen(d)
    const walls = cabinetWalls(job, d.library)
    const left = job.cabinets.filter((c) => walls[c.id] === 'left').map((c) => c.id)
    const back = job.cabinets.filter((c) => walls[c.id] === 'back').map((c) => c.id)
    expect(left.length).toBeGreaterThan(0)
    expect(back.length).toBeGreaterThan(0)
    const { cabinets } = applySwap(job, swapOf({ materials: { carcass: 'mat-pb18-oak' }, scope: left }), d.library)
    for (const c of cabinets) expect(c.params.carcassMaterialId).toBe(left.includes(c.id) ? 'mat-pb18-oak' : job.cabinets.find((x) => x.id === c.id)!.params.carcassMaterialId)
    // a role already at the picked board is no change
    expect(planSwap(job, swapOf({ materials: { backs: 'mat-hdf6-white' } }), d.library)).toEqual([])
  })

  it('roles come from the generator: doors and drawer fronts are fronts, drawer sides boxes, the back backs', () => {
    const d = defaultAppData()
    const job = vanity(d)
    const drawerCab = job.cabinets[1]
    const roles = partRoles(drawerCab, d.library)
    expect(roles.material.get('drawer-front-1')).toBe('fronts')
    expect([...roles.material.entries()].filter(([, r]) => r === 'boxes').length).toBeGreaterThan(0)
    expect(roles.material.get('side-left')).toBe('carcass')
    expect(roles.material.get('back')).toBe('backs')
    expect(roles.edges.get('drawer-front-1')).toMatchObject({ L1: 'door', L2: 'door', W1: 'door', W2: 'door' })
    expect(roles.edges.get('side-left')).toEqual(Object.fromEntries(Object.entries(roles.edges.get('side-left')!).map(([k]) => [k, 'carcassFront'])))
  })

  it('edgebands per group: the door band changes on doors only; "no band" takes it off', () => {
    const d = defaultAppData()
    const job = sampleJob()
    const after = { ...job, cabinets: applySwap(job, swapOf({ edgebands: { door: 'eb-oak-1' } }), d.library).cabinets }
    const door = partsOf(after, d, 'cab-b1').find((p) => p.role === 'door')!
    expect(Object.values(door.edges).every((v) => v === 'eb-oak-1')).toBe(true)
    const side = partsOf(after, d, 'cab-b1').find((p) => p.key === 'side-left')!
    expect(side.edges).toEqual(partsOf(job, d, 'cab-b1').find((p) => p.key === 'side-left')!.edges)
    const none = { ...job, cabinets: applySwap(job, swapOf({ edgebands: { door: null } }), d.library).cabinets }
    expect(Object.values(partsOf(none, d, 'cab-b1').find((p) => p.role === 'door')!.edges).every((v) => !v)).toBe(true)
  })

  it('part overrides set by hand are kept unless "also replace part overrides" is ticked', () => {
    const d = defaultAppData()
    const job = sampleJob()
    const b1 = job.cabinets[0]
    const doorKey = partsOf(job, d, 'cab-b1').find((p) => p.role === 'door')!.key
    // the left side's front edge is L2 (carcass front group); L1 is a raw edge banded by hand
    b1.overrides['side-left'] = { materialId: 'mat-pb18-oak', edges: { L2: 'eb-oak-1', L1: 'eb-oak-1' } }
    b1.overrides[doorKey] = { materialId: 'mat-pb18-oak' }
    const swap = swapOf({ materials: { carcass: 'mat-mdf18' }, edgebands: { carcassFront: 'eb-white-04' } })
    // kept: the side keeps oak and its oak band; the preview says so
    const kept = { ...job, cabinets: applySwap(job, swap, d.library).cabinets }
    const side = partsOf(kept, d, 'cab-b1').find((p) => p.key === 'side-left')!
    expect(side.materialId).toBe('mat-pb18-oak')
    expect(side.edges.L2).toBe('eb-oak-1')
    expect(side.edges.L1).toBe('eb-oak-1')
    expect(partsOf(kept, d, 'cab-b1').find((p) => p.key === 'side-right')!.materialId).toBe('mat-mdf18')
    const pv = previewSwap(job, swap, d)
    expect(pv.keptOverrides).toEqual([
      { cabinetNumber: 'B1', part: 'Left side', what: 'material' },
      { cabinetNumber: 'B1', part: 'Left side', what: 'band' },
    ])
    // replaced: the side follows the new carcass and band; the door's own board is a front, not changed, so kept
    const rep = applySwap(job, { ...swap, replaceOverrides: true }, d.library)
    const repJob = { ...job, cabinets: rep.cabinets }
    const side2 = partsOf(repJob, d, 'cab-b1').find((p) => p.key === 'side-left')!
    expect(side2.materialId).toBe('mat-mdf18')
    expect(side2.edges.L2).toBe('eb-white-04')
    // a band put by hand on an edge no group bands is not a group's: kept
    expect(side2.edges.L1).toBe('eb-oak-1')
    expect(rep.cabinets[0].overrides['side-left']).toEqual({ edges: { L1: 'eb-oak-1' } })
    expect(rep.cabinets[0].overrides[doorKey]).toEqual({ materialId: 'mat-pb18-oak' })
    expect(previewSwap(job, { ...swap, replaceOverrides: true }, d).keptOverrides).toEqual([])
  })

  it('one undo puts every change back; a setting changed since is left as it is', () => {
    const d = defaultAppData()
    const job = sampleJob()
    job.cabinets[0].overrides['side-left'] = { materialId: 'mat-pb18-oak', edges: { L1: 'eb-oak-1' }, exclude: false }
    const swap = swapOf({ materials: { carcass: 'mat-pb16-white', fronts: 'mat-mdf18', backs: 'mat-hdf6-white' }, edgebands: { door: 'eb-oak-1', carcassFront: null }, replaceOverrides: true })
    const { cabinets, undo } = applySwap(job, swap, d.library)
    const back = undoSwap({ cabinets }, undo)
    expect(back.cabinets).toEqual(job.cabinets)
    expect(back.skipped).toBe(0)
    expect(back.reverted).toBe(undo.changes.length)
    // the owner changed B2's carcass again after the swap: undo leaves that one, reverts the rest
    const edited = clone(cabinets)
    edited[1].params.carcassMaterialId = 'mat-pb18-oak'
    const partly = undoSwap({ cabinets: edited }, undo)
    expect(partly.skipped).toBe(1)
    expect(partly.cabinets[1].params.carcassMaterialId).toBe('mat-pb18-oak')
    expect(partly.cabinets[1].params.doorMaterialId).toBe(job.cabinets[1].params.doorMaterialId)
    expect(partly.cabinets[0]).toEqual(job.cabinets[0])
  })

  it('warnings: an 18 mm drawer-box board (TANDEM 16 mm sides), a 6 mm carcass (dado and groove depths), a kept override of another thickness', () => {
    const d = defaultAppData()
    const job = vanity(d)
    const box = previewSwap(job, swapOf({ materials: { boxes: 'mat-pb18-white' } }), d)
    expect(box.newWarnings.some((w) => /Blum TANDEM allows drawer sides up to 16 mm/.test(w) && w.includes('PB18-WHT'))).toBe(true)
    // the same check the cabinet editor shows: identical text from the generator
    const applied = { ...job, cabinets: applySwap(job, swapOf({ materials: { boxes: 'mat-pb18-white' } }), d.library).cabinets }
    expect(box.newWarnings).toEqual(expandJob(applied, d.library, d.settings).warnings.filter((w) => !expandJob(job, d.library, d.settings).warnings.includes(w)))
    // a cabinet without drawers does not take a drawer-box board
    expect(applySwap(job, swapOf({ materials: { boxes: 'mat-pb18-white' } }), d.library).cabinets[0].params.drawers.boxMaterialId).toBeUndefined()
    const thin = previewSwap(job, swapOf({ materials: { carcass: 'mat-hdf6-white' } }), d)
    expect(thin.newWarnings.some((w) => /Dado depth 8 mm is not less than side thickness 6 mm/.test(w))).toBe(true)
    expect(thin.newWarnings.some((w) => /Back groove depth 8 mm is not less than panel thickness 6 mm/.test(w))).toBe(true)
    // back to 16 mm boxes clears the TANDEM warning
    const fixed = previewSwap(applied, swapOf({ materials: { boxes: 'mat-pb16-white' } }), d)
    expect(fixed.clearedWarnings.some((w) => /Blum TANDEM/.test(w))).toBe(true)
    // a side kept at 18 mm oak while the carcass goes to 16 mm: the thickness check says so
    const s = sampleJob()
    s.cabinets[0].overrides['side-left'] = { materialId: 'mat-pb18-oak' }
    const kept = previewSwap(s, swapOf({ materials: { carcass: 'mat-pb16-white' } }), d)
    expect(kept.newWarnings).toContain('B1 Left side: part is 16 mm but material PB18-OAK is 18 mm.')
  })

  it('preview: parts old -> new, sizes that follow the board thickness, sheets before and after', () => {
    const d = defaultAppData()
    const job = sampleJob()
    const swap = swapOf({ materials: { carcass: 'mat-pb16-white', fronts: 'mat-mdf18' } })
    const pv = previewSwap(job, swap, d)
    expect(pv.cabinets).toBe(4)
    const bottom = pv.parts.find((p) => p.cabinetNumber === 'B1' && p.key === 'bottom')!
    expect(bottom.before.materialId).toBe('mat-pb18-white')
    expect(bottom.after.materialId).toBe('mat-pb16-white')
    // thinner sides: the bottom between them (in its dados) gets 4 mm longer
    expect(bottom.sizeChanged).toBe(true)
    expect(bottom.after.size[0] - bottom.before.size[0]).toBeCloseTo(4, 6)
    expect(bottom.after.size[2]).toBe(16)
    expect(pv.parts.find((p) => p.cabinetNumber === 'W1')!.qty).toBe(2)
    const sum = pv.boards.reduce((n, b) => n + b.parts, 0)
    expect(sum).toBe(pv.parts.filter((p) => p.materialChanged).reduce((n, p) => n + p.qty, 0))
    // the sheet estimate is the automatic nest of the whole job, before and after
    const after = { ...job, cabinets: applySwap(job, swap, d.library).cabinets }
    expect(pv.sheets.before).toBe(nestJob(expandJob(job, d.library, d.settings).instances, d.library, d.machine, d.settings).sheets.length)
    expect(pv.sheets.after).toBe(nestJob(expandJob(after, d.library, d.settings).instances, d.library, d.machine, d.settings).sheets.length)
    expect(pv.sheets.byMaterial.find((m) => m.materialId === 'mat-pb18-white')).toEqual({ materialId: 'mat-pb18-white', before: 2, after: 0 })
    expect(pv.newWarnings).toEqual([])
  })

  it('a hand-saved layout: parts whose board changes are counted in the preview and flagged by the nest as today', () => {
    const d = defaultAppData()
    const job = sampleJob()
    job.nestEdit = { savedAt: '2026-10-01T00:00:00.000Z', sheets: layoutOf(runJob(job, d).nest) }
    const swap = swapOf({ materials: { fronts: 'mat-mdf18' } })
    const pv = previewSwap(job, swap, d)
    const doors = runJob(job, d).instances.filter((i) => i.part.role === 'door').length
    expect(pv.savedLayoutParts).toBe(doors)
    const after = { ...job, cabinets: applySwap(job, swap, d.library).cabinets }
    expect(runJob(after, d).nest.manual!.moved).toHaveLength(doors)
  })
})

/** The sample job with every price set, in round numbers for checking by hand. */
function priced(d = defaultAppData()) {
  for (const m of d.library.materials) m.cost = { by: 'area', price: m.thickness > 10 ? 20 : 10 }
  for (const e of d.library.edgebands) e.price = 0.5
  for (const h of d.library.hardware) h.price = 1.25
  d.settings.pricing = { shopRate: 60 }
  return d
}

describe('Job-1 B: pricing beyond board', () => {
  it('rounding: halves of a cent go up, each item is rounded, markup on the subtotal, tax on subtotal + markup', () => {
    expect(round2(1.005)).toBe(1.01)
    expect(round2(2.675)).toBe(2.68)
    expect(round2(0.125)).toBe(0.13)
    expect(round2(9.984375)).toBe(9.98)
    expect(round2(0)).toBe(0)
    const d = priced()
    const job = { ...sampleJob(), quote: { markupPct: 12.5, taxPct: 8.875 } }
    const q = jobQuote(job, runJob(job, d), d)
    expect(q.subtotal).toBe(round2(q.lines.reduce((s, l) => s + l.amount, 0)))
    expect(q.markup).toBe(round2(q.subtotal * 0.125))
    expect(q.tax).toBe(round2((q.subtotal + q.markup) * 0.08875))
    expect(q.total).toBe(round2(q.subtotal + q.markup + q.tax))
    for (const l of q.lines) for (const i of l.items) if (l.key !== 'labour') expect(i.amount).toBe(round2(i.qty * i.price!))
  })

  it('each line: board sheets at the material price, edgeband per metre, hardware per piece, labour at the shop rate', () => {
    const d = priced()
    const job = sampleJob()
    const out = runJob(job, d)
    const q = jobQuote(job, out, d)
    expect(q.complete).toBe(true)
    expect(q.unpriced).toEqual([])
    const line = (k: string) => q.lines.find((l) => l.key === k)!
    // board: 2 PB18 sheets (5.5742 m² at $20) and 1 HDF6 sheet (at $10)
    const area = (3658 * 1524) / 1e6
    const pb = line('board').items.find((i) => i.code === 'PB18-WHT')!
    expect(pb).toMatchObject({ qty: 2, unit: 'sheets', price: round2(area * 20), amount: round2(2 * round2(area * 20)) })
    expect(line('board').items.find((i) => i.code === 'HDF6-WHT')).toMatchObject({ qty: 1, price: round2(area * 10) })
    expect(line('board').amount).toBe(round2(2 * round2(area * 20) + round2(area * 10)))
    // edgeband: the BOM's metres at $0.50
    for (const e of out.edgebands) expect(line('edgeband').items.find((i) => i.code === e.code)).toMatchObject({ qty: e.metres, unit: 'm', price: 0.5, amount: round2(e.metres * 0.5) })
    // hardware: every BOM line at $1.25 a piece (hinges, plates, pins, screws, dowels)
    expect(line('hardware').items.map((i) => [i.code, i.qty])).toEqual(out.hardware.map((h) => [h.code, h.qty]))
    expect(line('hardware').amount).toBe(round2(out.hardware.reduce((s, h) => s + round2(h.qty * 1.25), 0)))
    // labour: 5 carcasses (W1 twice) x 60, 9 doors x 10, 3 sheets x 15 min = 435 min = 7.25 h at $60
    expect(q.labour.counts).toEqual({ cabinet: 5, drawer: 0, door: 9, sheet: 3 })
    expect(q.labour.hours).toBe(7.25)
    expect(line('labour').amount).toBe(435)
    expect(q.markupPct).toBe(0)
    expect(q.taxPct).toBe(0)
    expect(q.total).toBe(q.subtotal)
  })

  it('drawers and TANDEM runners: counted per drawer, priced per piece as the BOM counts them', () => {
    const d = priced()
    const job = vanity(d)
    const out = runJob(job, d)
    const q = jobQuote(job, out, d)
    expect(q.labour.counts.drawer).toBe(3)
    const runner = out.hardware.find((h) => /^563H/.test(h.code))!
    expect(runner.qty).toBe(3)
    expect(q.lines.find((l) => l.key === 'hardware')!.items.find((i) => i.code === runner.code)).toMatchObject({ qty: 3, unit: 'pcs', price: 1.25, amount: 3.75 })
  })

  it('unpriced lines are "price not set" with what to set (never $0); the total says it is incomplete', () => {
    const d = defaultAppData()
    const job = sampleJob()
    const out = runJob(job, d)
    const q = jobQuote(job, out, d)
    expect(q.complete).toBe(false)
    for (const l of q.lines) for (const i of l.items) {
      expect(i.amount).toBeNull()
      expect(i.missing).toBeDefined()
    }
    expect(q.unpriced.map((u) => u.key).sort()).toEqual(
      [
        'material:mat-hdf6-white:price',
        'material:mat-pb18-white:price',
        ...out.edgebands.map((e) => `price:edgeband:${e.id}`),
        ...out.hardware.map((h) => `price:hardware:${d.library.hardware.find((x) => x.code === h.code)!.id}`),
        'labour:shopRate',
      ].sort(),
    )
    const csv = quoteCsv(q).split('\r\n')
    // no amount anywhere: every item and line "price not set", the totals blank and marked incomplete
    expect(csv.filter((r) => /,0\.00,/.test(r))).toEqual([])
    expect(csv.find((r) => r.startsWith('Line total,Board'))).toBe('Line total,Board,,,,,,price not set')
    expect(csv.find((r) => r.startsWith('Total'))).toBe(`Total,,,,,,,incomplete: ${q.unpriced.length} prices not set`)
    // one price missing: that line is partly priced, the rest adds up, the total leaves it out
    const p = priced()
    p.library.hardware.find((h) => h.code === 'PIN-5')!.price = undefined
    const q2 = jobQuote(job, runJob(job, p), p)
    const hw = q2.lines.find((l) => l.key === 'hardware')!
    expect(hw.unpriced).toBe(1)
    expect(q2.unpriced.map((u) => u.key)).toEqual(['price:hardware:hw-pin'])
    expect(q2.unpriced[0].target).toEqual({ kind: 'price', what: 'hardware', id: 'hw-pin' })
    expect(hw.amount).toBe(round2(out.hardware.filter((h) => h.code !== 'PIN-5').reduce((s, h) => s + round2(h.qty * 1.25), 0)))
    expect(quoteCsv(q2)).toContain(`Line total,Hardware,,,,,${hw.amount.toFixed(2)},price not set for 1 of ${hw.items.length} items`)
    // a price entered as 0 is the shop's own 0, not "not set"
    p.library.hardware.find((h) => h.code === 'PIN-5')!.price = 0
    expect(jobQuote(job, runJob(job, p), p).complete).toBe(true)
  })

  it('units: edgeband typed per foot in an inch shop, stored per metre; the amount is the feet shown x the price per foot', () => {
    expect(bandPriceStored(0.3, 'in')).toBeCloseTo(0.3 / M_PER_FT, 12)
    expect(bandPriceShown(bandPriceStored(0.3, 'in'), 'in')).toBeCloseTo(0.3, 12)
    expect(bandPriceStored(1.2, 'mm')).toBe(1.2)
    const d = priced()
    d.settings.units = 'in'
    for (const e of d.library.edgebands) e.price = bandPriceStored(0.3, 'in')
    const job = sampleJob()
    const out = runJob(job, d)
    const q = jobQuote(job, out, d)
    for (const e of out.edgebands) {
      const ft = Math.round((e.length / 304.8) * 10) / 10
      const it = q.lines.find((l) => l.key === 'edgeband')!.items.find((i) => i.code === e.code)!
      expect(it.unit).toBe('ft')
      expect(it.qty).toBe(ft)
      expect(it.amount).toBe(round2(ft * 0.3))
    }
    // the BOM's foot figure is the quantity the quote multiplies
    expect(bomCsv(out, d)).toContain(`,${q.lines[1].items[0].qty.toFixed(1)},ft`)
    // the same stored price in a millimetre shop: metres x price per metre
    const mm = priced()
    for (const e of mm.library.edgebands) e.price = bandPriceStored(0.3, 'in')
    const qm = jobQuote(job, runJob(job, mm), mm)
    const it = qm.lines.find((l) => l.key === 'edgeband')!.items[0]
    expect(it.unit).toBe('m')
    expect(it.amount).toBe(round2(it.qty * (0.3 / M_PER_FT)))
  })

  it('labour times are PLACEHOLDER (badged) until edited or confirmed; the shop rate starts not set', () => {
    expect(labourUnconfirmed(undefined).map((u) => u.key)).toEqual(['labour:shopRate', 'labour:cabinet', 'labour:drawer', 'labour:door', 'labour:sheet'])
    expect(labourUnconfirmed(undefined)[1]).toMatchObject({ value: `${PLACEHOLDER_LABOUR_MINUTES.cabinet} min (placeholder)`, target: { kind: 'labour', key: 'cabinet' } })
    expect(labourUnconfirmed({ shopRate: 75, minutes: { cabinet: 45 }, confirmed: ['labour:door'] }).map((u) => u.key)).toEqual(['labour:drawer', 'labour:sheet'])
    const d = defaultAppData()
    const q = jobQuote(sampleJob(), runJob(sampleJob(), d), d)
    expect(q.lines.find((l) => l.key === 'labour')!.unconfirmed.map((u) => u.key)).toEqual(['labour:cabinet', 'labour:drawer', 'labour:door', 'labour:sheet'])
    expect(q.labour.rate).toBeNull()
  })

  it('exports: the BOM and the areas-and-costs CSV carry the quote after a blank row; the rows above are unchanged', () => {
    const d = priced()
    const job = { ...sampleJob(), quote: { markupPct: 10, taxPct: 6 } }
    const out = runJob(job, d)
    const q = jobQuote(job, out, d)
    const bom = textOf(buildFiles(['bom-csv'], job, d, out)[0])
    expect(bom).toBe(bomCsv(out, d) + quoteCsv(q))
    expect(bom).toContain('\r\n\r\nQuote,Item,Name,Qty,Unit,Price each $,Total,Note\r\n')
    expect(bom).toContain(`Markup,10 %,,,,,${q.markup.toFixed(2)},\r\n`)
    expect(bom).toContain(`Sales tax,6 %,,,,,${q.tax.toFixed(2)},\r\n`)
    expect(bom.endsWith(`Total,,,,,,${q.total.toFixed(2)},\r\n`)).toBe(true)
    const areas = textOf(buildFiles(['areas-csv'], job, d, out)[0])
    expect(areas).toBe(areasCsv(jobCosts(out.nest, out.instances, d.library), out.instances, d.library, '$', 'mm') + quoteCsv(q))
  })

  it('quote PDF: job name and customer field only, every line, "price not set" with a Configure tag; the same file every time', () => {
    const d = defaultAppData()
    d.library.edgebands.forEach((e) => (e.price = 0.5))
    const job = sampleJob()
    const out = runJob(job, d)
    const q = jobQuote(job, out, d)
    const texts: string[] = []
    const events = (jsPDF.API as unknown as { events: [string, (p: { text: string[] }) => void][] }).events
    const hook: [string, (p: { text: string[] }) => void] = ['preProcessText', (p) => void texts.push(p.text.join(''))]
    events.push(hook)
    let a: Uint8Array
    try {
      a = quotePdf(job, q, 'Shop')
    } finally {
      events.splice(events.indexOf(hook), 1)
    }
    expect(texts).toContain('Job J1042  Cohen kitchen - sample')
    expect(texts).toContain('Customer: Cohen')
    for (const l of ['Board', 'Edgeband', 'Hardware', 'Labour', 'Subtotal', 'Markup', 'Sales tax', 'Total']) expect(texts).toContain(l)
    expect(texts.filter((t) => t === 'price not set').length).toBeGreaterThan(5)
    expect(texts.filter((t) => t === 'Configure').length).toBeGreaterThan(5)
    // edgeband is priced: its amount, not "price not set"
    expect(texts).toContain(q.lines[1].items[0].amount!.toFixed(2))
    expect(texts.some((t) => /notes|Placeholder tools/i.test(t))).toBe(false)
    expect(quotePdf(job, q, 'Shop')).toEqual(a!)
    expect(textOf(buildFiles(['quote-pdf'], job, d, out)[0]).startsWith('%PDF')).toBe(true)
  })
})
