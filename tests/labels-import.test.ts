import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { cutListCsv } from '../src/core/cutlist'
import { defaultLibrary } from '../src/core/defaults'
import { labelsPdf, sheetMapPdf } from '../src/core/labels/pdf'
import { labelsZpl } from '../src/core/labels/zpl'
import { guessKind, importMaterials, importTemplates, importTools, parseCsv, parseXlsx } from '../src/core/library/import'
import { runJob } from '../src/core/pipeline'
import { sampleJob } from '../src/core/sample'
import { data } from './helpers'

describe('labels', () => {
  const d = data()
  const j = sampleJob()
  const out = runJob(j, d)

  it('creates one label per nested part, ordered by sheet and cut order', () => {
    expect(out.labels.length).toBe(out.instances.length)
    const keys = out.labels.map((l) => l.sheetIndex * 1000 + l.cutOrder)
    expect(keys).toEqual([...keys].sort((a, b) => a - b))
    expect(new Set(out.labels.map((l) => l.partId)).size).toBe(out.labels.length)
  })

  it('places labels inside their part, clear of holes, with edge clearance', () => {
    for (const prog of out.programs) {
      const spots = out.spots.get(prog.sheet.index)!
      for (const s of spots.filter((sp) => sp.fits)) {
        const pl = prog.sheet.placements.find((p) => p.uid === s.uid)!
        const c = d.settings.labels.edgeClearance
        expect(s.cx - s.w / 2).toBeGreaterThanOrEqual(pl.x + c - 1e-6)
        expect(s.cx + s.w / 2).toBeLessThanOrEqual(pl.x + pl.dx - c + 1e-6)
        expect(s.cy - s.h / 2).toBeGreaterThanOrEqual(pl.y + c - 1e-6)
        expect(s.cy + s.h / 2).toBeLessThanOrEqual(pl.y + pl.dy - c + 1e-6)
        for (const op of prog.ops)
          if (op.kind === 'vdrill' && op.partUid === s.uid) {
            const inside = Math.abs(op.x - s.cx) < s.w / 2 && Math.abs(op.y - s.cy) < s.h / 2
            expect(inside).toBe(false)
          }
      }
    }
  })

  it('flags labels that do not fit on narrow parts', () => {
    const rails = out.labels.filter((l) => l.partName === 'Front rail')
    expect(rails.length).toBeGreaterThan(0)
    expect(rails.every((l) => !l.spot.fits && l.notes.some((n) => /does not fit/.test(n)))).toBe(true)
  })

  it('renders label and sheet-map PDFs and ZPL', () => {
    const pdf = labelsPdf(out, '100x70')
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-')
    const map = sheetMapPdf(j, out, d.library)
    expect(new TextDecoder().decode(map.slice(0, 5))).toBe('%PDF-')
    const zpl = labelsZpl(out, '100x80')
    expect(zpl.match(/\^XA/g)!.length).toBe(out.labels.length)
    expect(zpl).toContain('^PW800')
    expect(zpl).toContain('^LL640')
    expect(zpl).toContain('^BCN')
  })

  it('exports a CSV cut list with CRLF', () => {
    const csv = cutListCsv(out.cutList)
    expect(csv.startsWith('Material,Part,Cabinets,Qty')).toBe(true)
    expect(csv.includes('\r\n')).toBe(true)
    const totalQty = out.cutList.reduce((n, r) => n + r.qty, 0)
    expect(totalQty).toBe(out.instances.length)
  })
})

describe('library import', () => {
  const lib = defaultLibrary()

  it('imports materials from a semicolon CSV with alias headers and upserts by code', () => {
    const csv = 'Code;Description;Thk;Length;Width;Grain;Colour\nPB18-WHT;White updated;18;2800;2070;no;#ffffff\nPLY18-BIR;Birch ply 18;18;1220;2440;yes;c8a165\n;missing;18;1;1;;\n'
    const rows = parseCsv(csv)
    expect(guessKind(rows)).toBe('materials')
    const res = importMaterials(rows, lib.materials)
    expect(res.added).toBe(1)
    expect(res.updated).toBe(1)
    expect(res.errors.length).toBe(1)
    const ply = res.items.find((m) => m.code === 'PLY18-BIR')!
    expect([ply.sheetLength, ply.sheetWidth, ply.grain, ply.color]).toEqual([2440, 1220, true, '#c8a165'])
    expect(res.items.find((m) => m.code === 'PB18-WHT')!.id).toBe('mat-pb18-white')
  })

  it('imports a tool table from XLSX', () => {
    const ws = XLSX.utils.json_to_sheet([
      { Tool: 101, Type: 'router', Name: 'Compression 12', Diameter: 12, 'Max depth': 41 },
      { Tool: 207, Type: 'drill', Name: 'Drill 10', Diameter: 10, 'Max depth': 30 },
      { Tool: 999, Type: 'laser', Name: 'bad', Diameter: 1 },
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Tools')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const rows = parseXlsx(buf)
    expect(guessKind(rows)).toBe('tools')
    const res = importTools(rows, data().machine.tools)
    expect(res.updated).toBe(1)
    expect(res.added).toBe(1)
    expect(res.errors).toHaveLength(1)
    expect(res.items.find((t) => t.number === 101)!.maxDepth).toBe(41)
  })

  it('imports cabinet templates from CSV', () => {
    const rows = parseCsv('name,kind,width,height,depth,shelves,doors,material,joinery\nBase 900,base,900,870,560,1,2,PB18-WHT,dowel\nTall pantry,tall,600,2100,560,4,2,,\nBad,box,1,1,1,,,,\n')
    expect(guessKind(rows)).toBe('templates')
    const res = importTemplates(rows, lib.templates, lib)
    expect(res.added).toBe(2)
    expect(res.errors).toHaveLength(1)
    const t = res.items.find((x) => x.name === 'Base 900')!
    expect([t.params.width, t.params.joinery, t.params.doors.count]).toEqual([900, 'dowel', 2])
    expect(res.items.find((x) => x.name === 'Tall pantry')!.params.top).toBe('full')
  })
})
