import { describe, expect, it } from 'vitest'
import { readMpr } from '@/cam/mprRead'
import type { CamPart } from '@/cam/types'
import { fittingBom, itemPart, parseBatchCsv, runBatchCsv } from '@/core/batch'
import { REF_EDGE } from '@/core/fittings'
import { boringPattern, placePattern } from '@/core/hardware/patterns'
import { runJob } from '@/core/pipeline'
import type { Job } from '@/core/types'
import { data } from './helpers'

const NOW = new Date('2026-10-04T09:30:00')
const none = () => null

/** A base cabinet as an assembly: two sides with plates, shelf dowels, a door with two hinge cups. */
const CSV = [
  'order,assembly,item,name,type,material,length,width,qty,hardware,panel,face,edge,at,mirror',
  'A1,Base B1,1,Left side,part,PB18-WHT,720,560,1,,,,,,',
  'A1,Base B1,2,Right side,part,PB18-WHT,720,560,1,,,,,,',
  'A1,Base B1,3,Door,part,PB18-WHT,716,446,1,,,,,,',
  'A1,Base B1,,Plate,fitting,,,,1,SALICE-B2VGV-H3,1,top,front,100,',
  'A1,Base B1,,Plate,fitting,,,,1,SALICE-B2VGV-H3,2,bottom,front,100,',
  'A1,Base B1,,Cup,fitting,,,,1,SALICE-110-SC,3,top,front,100,',
  'A1,Base B1,,Cup,fitting,,,,1,SALICE-110-SC,3,top,front,616,',
  'A1,Base B1,,Dowel,fitting,,,,4,DOWEL-8x30,1,back,,,',
  'A1,Wall W1,1,Left side,part,PB18-WHT,720,300,2,,,,,,',
  'A1,Wall W1,,Plate,fitting,,,,1,SALICE-B2VGV-H3,1,left,,100,',
].join('\n')

const holes = (p: CamPart) =>
  p.entities
    .filter((e) => e.layer === 'holes' && e.g.t === 'circle')
    .map((e) => {
      const g = e.g as { t: 'circle'; c: { x: number; y: number }; r: number }
      return { face: e.face, x: Math.round(g.c.x * 1000) / 1000, y: Math.round(g.c.y * 1000) / 1000, d: g.r * 2, depth: e.depth }
    })
    .sort((a, b) => a.x - b.x || a.y - b.y)

describe('M2.9c assemblies and fittings by face', () => {
  it('reads assemblies and fittings and finds each fitting its panel', () => {
    const { orders, errors } = parseBatchCsv(CSV, data(), { defaultOrder: 'x' })
    expect(errors).toEqual([])
    const items = orders[0].items
    expect(items.map((i) => [i.assembly, i.item, i.fittings.length])).toEqual([
      ['Base B1', '1', 2],
      ['Base B1', '2', 1],
      ['Base B1', '3', 2],
      ['Wall W1', '1', 1],
    ])
    expect(items[0].fittings[0]).toMatchObject({ face: 'top', edge: 'front', at: 100, qty: 1 })
    expect(items[0].fittings[1]).toMatchObject({ face: 'back', at: null, qty: 4 })
  })

  it('puts the holes where hand numbers say, the same as the designer', () => {
    const d = data()
    const { orders } = parseBatchCsv(CSV, d, { defaultOrder: 'x' })
    const [left, right, door, wall] = orders[0].items.map((it) => itemPart(it, d, none))
    // plate: holes ±16 along the edge, 37 in, Ø5 x 11
    expect(holes(left.part!)).toEqual([
      { face: 1, x: 84, y: 37, d: 5, depth: 11 },
      { face: 1, x: 116, y: 37, d: 5, depth: 11 },
    ])
    // the same plate on the underside: same places, face 6
    expect(holes(right.part!)).toEqual([
      { face: 6, x: 84, y: 37, d: 5, depth: 11 },
      { face: 6, x: 116, y: 37, d: 5, depth: 11 },
    ])
    // hinge cups on the door's front (hinge) edge: 20.5 in, at 100 and 616 along, Ø35 x 13.5
    expect(holes(door.part!)).toEqual([
      { face: 1, x: 100, y: 20.5, d: 35, depth: 13.5 },
      { face: 1, x: 616, y: 20.5, d: 35, depth: 13.5 },
    ])
    // a plate on the wall side's left edge: 37 in from X = 0, 100 ± 16 down from the back
    expect(holes(wall.part!)).toEqual([
      { face: 1, x: 37, y: 300 - 116, d: 5, depth: 11 },
      { face: 1, x: 37, y: 300 - 84, d: 5, depth: 11 },
    ])
    // the designer's own placement gives the very same part
    const plate = boringPattern(d.library, 'hw-plate')!
    const byHand = placePattern(itemPart({ ...orders[0].items[0], fittings: [] }, d, none).part!, plate, { edge: REF_EDGE.front, at: 100 })
    expect(holes(byHand.part)).toEqual(holes(left.part!))
    // each drilled fitting adds a drilling operation; BOM-only ones add nothing
    expect(left.part!.ops.map((o) => o.kind)).toEqual(['drill'])
    expect(left.warnings.join(' ')).toMatch(/DOWEL-8x30: no approved drilling pattern, so it is in the BOM only/)
    expect(left.part!.assembly).toBe('Base B1')
    expect(left.part!.kit).toBe('Base B1')
  })

  it('reports bad fitting rows and never assumes a position', () => {
    const csv = [
      'order,assembly,item,name,type,material,length,width,qty,hardware,panel,face,edge,at',
      'B,X,1,Side,part,PB18-WHT,720,560,1,,,,,',
      'B,Y,1,Side,part,PB18-WHT,720,560,1,,,,,',
      'B,X,,F,fitting,,,,1,NOPE,1,top,,10',
      'B,X,,F,fitting,,,,1,SALICE-B2VGV-H3,1,inside,,10',
      'B,X,,F,fitting,,,,1,SALICE-B2VGV-H3,1,top,middle,10',
      'B,X,,F,fitting,,,,1,SALICE-B2VGV-H3,1,top,front,',
      'B,X,,F,fitting,,,,1,SALICE-B2VGV-H3,9,top,front,10',
      'B,,,F,fitting,,,,1,SALICE-B2VGV-H3,1,top,front,10',
      'B,X,,F,fitting,,,,1,SALICE-B2VGV-H3,1,left,front,10',
    ].join('\n')
    const { orders, errors } = parseBatchCsv(csv, data(), { defaultOrder: 'x' })
    expect(errors.map((e) => [e.row, e.message])).toEqual([
      [4, 'Hardware "NOPE" is not in the library.'],
      [5, 'Face "inside" is not one of top, bottom, front, back, left, right.'],
      [6, 'Edge "middle" is not one of front, back, left, right.'],
      [7, 'SALICE-B2VGV-H3 is drilled: give its position along the edge (at).'],
      [10, 'A fitting on the left edge is placed from that edge; edge "front" is ignored.'],
      [8, 'Panel item 9 in assembly X not found in order B.'],
      [9, 'Panel item 1 is in more than one assembly; name the assembly on the fitting row.'],
    ])
    expect(orders[0].items[0].fittings.length).toBe(1)
  })

  it('a batch run drills the fittings, counts them in the BOM and lists them in the report', () => {
    const d = data((x) => (x.settings.features = { camMprOutput: true }))
    const res = runBatchCsv('asm.csv', CSV, { data: d, readFile: none, now: NOW })
    const o = res.orders[0]
    expect(o.errors).toEqual([])
    expect(o.status).toBe('done')
    const bom = String(o.files.find((f) => f.name === 'A1_bom.csv')!.data)
    expect(bom).toMatch(/Hardware,SALICE-B2VGV-H3,"[^"]+",4,pcs/) // 2 sides x 1 + 1 wall side x 2 copies
    expect(bom).toMatch(/Hardware,SALICE-110-SC,"[^"]+",2,pcs/)
    expect(bom).toMatch(/Hardware,DOWEL-8x30,"[^"]+",4,pcs/)
    const report = String(o.files.find((f) => f.name === 'A1_report.txt')!.data)
    expect(report).toContain('Assemblies and fittings:')
    expect(report).toContain('Base B1: 3 panels')
    expect(report).toContain('1 Left side: 1 x SALICE-B2VGV-H3 on the top face, from the front edge at 100 mm')
    expect(report).toContain('4 x DOWEL-8x30 on the back edge (BOM only)')
    // every face-1 hole is in a sheet program; the underside plate gets the turned-over program
    const progs = o.files.filter((f) => f.name.endsWith('.mpr')).map((f) => readMpr(new TextDecoder('latin1').decode(f.data as Uint8Array)))
    for (const p of progs) expect(p.errors).toEqual([])
    const drills = progs.flatMap((p) => p.macros.filter((m) => m.id === 102))
    expect(drills.length).toBeGreaterThanOrEqual(2 + 2 + 2 * 2)
    expect(fittingBom(parseBatchCsv(CSV, d, { defaultOrder: 'x' }).orders[0], d).map((b) => [b.code, b.qty])).toEqual([
      ['SALICE-B2VGV-H3', 4],
      ['DOWEL-8x30', 4],
      ['SALICE-110-SC', 2],
    ])
  })

  it('labels name the assembly; the export checker still decides', () => {
    const d = data()
    const { orders } = parseBatchCsv(CSV, d, { defaultOrder: 'x' })
    const job: Job = { id: 'j', number: 'A1', name: 'A', customer: '', notes: '', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), cabinets: [], camParts: orders[0].items.map((it) => itemPart(it, d, none).part!) }
    const out = runJob(job, d)
    expect(new Set(out.labels.map((l) => l.cabinet.split(' ')[0] + ' ' + l.cabinet.split(' ')[1]))).toEqual(new Set(['Base B1', 'Wall W1']))
    // custom-part output off: drilled panels are held back exactly as before
    const res = runBatchCsv('asm.csv', CSV, { data: d, readFile: none, now: NOW })
    expect(res.orders[0].status).toBe('blocked')
  })
})
