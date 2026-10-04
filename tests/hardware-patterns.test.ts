import { jsPDF } from 'jspdf'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'
import { newPart } from '@/cam/doc'
import { defaultOp } from '@/cam/ops'
import { generatePart } from '@/cam/toolpath'
import type { HardwarePattern } from '@/cam/types'
import { defaultAppData } from '@/core/defaults'
import { patternFromDxf, patternsFromCsv, pdfTextPages, textDrafter } from '@/core/hardware/patternImport'
import { approvePattern, builtInPatterns, isUsable, patternIssues, patternsOf, placePattern, savePattern, usablePatterns, withdrawPattern } from '@/core/hardware/patterns'
import { SALICE, TANDEM } from '@/core/hardware/specs'

const now = new Date('2026-10-04T12:00:00Z')

describe('Hardware patterns: verified library', () => {
  const lib = defaultAppData().library
  const all = builtInPatterns()

  it('ships verified Salice and Blum patterns built from the published numbers', () => {
    expect(all.every((p) => p.status === 'verified' && p.source === 'library' && patternIssues(p).length === 0)).toBe(true)
    const cup = all.find((p) => p.id === 'pat-salice-700-cup')!
    expect(cup.holes).toEqual([{ x: 0, y: 20.5, diameter: 35, depth: 13.5, face: 1 }])
    const plate = all.find((p) => p.id === 'pat-salice-b2vgv-h3')!
    expect(plate.holes.map((h) => [h.x, h.y, h.diameter, h.depth])).toEqual([
      [-16, 37, 5, 11],
      [16, 37, 5, 11],
    ])
    expect(plate.name).toContain('H = 3')
    for (const t of TANDEM) {
      const p = all.find((q) => q.id === `pat-blum-563h-${t.inches}`)!
      expect(p.holes.map((h) => h.x)).toEqual(t.holesFromFront)
      expect(p.holes.every((h) => h.y === 37 && h.diameter === 5)).toBe(true)
    }
    expect(all.filter((p) => p.manufacturer === 'Blum' && p.name.includes('runner')).map((p) => p.name.match(/(\d+) in/)![1])).toEqual(['15', '18', '21'])
    expect(SALICE.cupCentreFromEdge).toBe(20.5)
    expect(usablePatterns(lib).length).toBe(all.length)
  })

  it('refuses to save drafts and only approves complete, reviewed patterns', () => {
    const l = structuredClone(lib)
    const draft: HardwarePattern = { id: 'pat-x', name: 'Test hinge', manufacturer: 'Grass', anchor: 'edge-start', holes: [{ x: 0, y: NaN, diameter: 35, depth: 12, face: 1 }], status: 'draft', source: 'pdf-draft', provenance: [{ file: 'grass.pdf', page: 2, quote: 'Ø35 x 12' }] }
    expect(savePattern(l, draft).ok).toBe(false)
    expect(l.patterns ?? []).toHaveLength(0)
    expect(isUsable(draft)).toBe(false)
    let r = approvePattern(draft, { reviewer: 'Avi', checked: true }, now)
    expect(r.errors).toContain('Hole 1: position is missing.')
    draft.holes[0].y = 21.5
    r = approvePattern(draft, { reviewer: '', checked: false }, now)
    expect(r.errors).toEqual(['Enter the name of the person who checked it.', 'Confirm every hole was checked against the source.'])
    r = approvePattern(draft, { reviewer: 'Avi', checked: true }, now)
    expect(r.errors).toEqual([])
    expect(r.pattern).toMatchObject({ status: 'approved', reviewedBy: 'Avi', reviewedAt: now.toISOString() })
    expect(draft.status).toBe('draft')
    expect(savePattern(l, r.pattern!).ok).toBe(true)
    expect(usablePatterns(l).some((p) => p.id === 'pat-x')).toBe(true)
    withdrawPattern(l, 'pat-x', 'superseded')
    expect(usablePatterns(l).some((p) => p.id === 'pat-x')).toBe(false)
    expect(patternsOf(l).find((p) => p.id === 'pat-x')?.status).toBe('rejected')
    expect(savePattern(l, { ...r.pattern!, id: 'pat-y', status: 'verified', source: 'csv' }).ok).toBe(false)
    const overlap = { ...r.pattern!, holes: [r.pattern!.holes[0], { ...r.pattern!.holes[0], x: 10 }] }
    expect(patternIssues(overlap)).toContain('Holes 1 and 2 overlap.')
  })

  it('places patterns on a part edge, mirrored, and the drill op picks them up', () => {
    const part = newPart({ name: 'Side', length: 560, width: 720, thickness: 18, materialId: 'mat-mdf18', entities: [] })
    const slide = all.find((p) => p.id === 'pat-blum-563h-21')!
    let r = placePattern(part, slide, { edge: 'left', at: 0 })
    expect(r.warnings).toEqual([])
    const pts = r.part.entities.map((e) => (e.g.t === 'circle' ? [e.g.c.x, e.g.c.y, e.g.r, e.depth, e.tag] : null))
    expect(pts).toEqual([
      [37, 720 - 261, 2.5, 12, 'pattern:pat-blum-563h-21'],
      [37, 720 - 517, 2.5, 12, 'pattern:pat-blum-563h-21'],
    ])
    const plate = all.find((p) => p.id === 'pat-salice-b2vgv-h3')!
    r = placePattern(r.part, plate, { edge: 'bottom', at: 100 })
    const plateHoles = r.part.entities.slice(2).map((e) => (e.g.t === 'circle' ? [e.g.c.x, e.g.c.y] : null))
    expect(plateHoles).toEqual([
      [84, 37],
      [116, 37],
    ])
    const hook = all.find((p) => p.id === 'pat-blum-563h-hook')!
    const m = placePattern(r.part, hook, { edge: 'bottom', at: 560, mirror: true })
    const last = m.part.entities[m.part.entities.length - 1]
    expect(last.g.t === 'circle' && [last.g.c.x, last.g.c.y]).toEqual([553, 11])
    const off = placePattern(part, plate, { edge: 'bottom', at: 5 })
    expect(off.warnings).toContain('Hole 1 runs off the part.')

    const machine = defaultAppData().machine
    const withOp = { ...m.part, ops: [{ ...defaultOp('drill', m.part.entities.map((e) => e.id)), levels: { safeZ: 20, rapidZ: 3, depth: 12, through: false, stockZ: 0, passDepth: 0 } }] }
    const holes = generatePart(withOp, machine)[0].intents.filter((i) => i.k === 'vdrill')
    expect(holes).toHaveLength(5)
    expect(holes.map((h) => (h.k === 'vdrill' ? `${h.d}x${h.depth}` : '')).sort()).toEqual(['5x11', '5x11', '5x12', '5x12', '6x10'])
  })

  it('places reference-edge holes as edge-face bores', () => {
    const part = newPart({ name: 'Rail', length: 600, width: 100, thickness: 18, materialId: 'mat-mdf18', entities: [] })
    const dowel: HardwarePattern = { id: 'pat-d', name: 'Dowel pair', manufacturer: '', anchor: 'edge-start', holes: [0, 32].map((x) => ({ x, y: 9, diameter: 8, depth: 30, face: 2 })), status: 'approved', source: 'manual', provenance: [], reviewedBy: 'Avi', reviewedAt: now.toISOString() }
    const r = placePattern(part, dowel, { edge: 'right', at: 34 })
    expect(r.part.entities.map((e) => [e.face, e.g.t === 'circle' && e.g.c.x, e.g.t === 'circle' && e.g.c.y])).toEqual([
      [3, 34, 9],
      [3, 66, 9],
    ])
    expect(placePattern(part, { ...dowel, status: 'draft' }, { edge: 'right', at: 34 }).ids).toEqual([])
  })
})

const dxf = (circles: [string, number, number, number][], insunits = 4) =>
  ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', String(insunits), '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', ...circles.flatMap(([layer, x, y, r]) => ['0', 'CIRCLE', '8', layer, '10', String(x), '20', String(y), '40', String(r)]), '0', 'ENDSEC', '0', 'EOF'].join('\n')

describe('Hardware patterns: manufacturer data import', () => {
  it('reads holes from DXF circles with depth and face from layer names', () => {
    const d = patternFromDxf(
      dxf([
        ['CUP_D13.5', 0, 20.5, 17.5],
        ['SCREW_D11', -16, 37, 2.5],
        ['SCREW_D11', 16, 37, 2.5],
        ['EDGE_DEPTH30', 50, 9, 4],
        ['MARK', 80, 80, 1],
      ]),
      'Salice hinge.dxf',
    )
    expect(d.pattern.status).toBe('draft')
    expect(d.pattern.source).toBe('dxf')
    expect(d.pattern.manufacturer).toBe('Salice')
    expect(d.pattern.holes.slice(0, 4)).toEqual([
      { x: 0, y: 20.5, diameter: 35, depth: 13.5, face: 1 },
      { x: -16, y: 37, diameter: 5, depth: 11, face: 1 },
      { x: 16, y: 37, diameter: 5, depth: 11, face: 1 },
      { x: 50, y: 9, diameter: 8, depth: 30, face: 2 },
    ])
    expect(Number.isNaN(d.pattern.holes[4].depth)).toBe(true)
    expect(d.warnings.some((w) => w.includes('no depth'))).toBe(true)
    expect(approvePattern(d.pattern, { reviewer: 'Avi', checked: true }, now).errors).toContain('Hole 5: depth is missing.')
    const inch = patternFromDxf(dxf([['DRILL_D0.5', 1, 1, 0.125]], 1), 'x.dxf')
    expect(inch.pattern.holes[0]).toMatchObject({ x: 25.4, y: 25.4, diameter: 6.35 })
  })

  it('reads hole tables from CSV, grouped by pattern, with inch rows', () => {
    const csv = ['pattern,manufacturer,code,x,y,diameter,depth,face,units', 'Hettich plate,Hettich,9071,-16,37,5,11,1,mm', 'Hettich plate,Hettich,9071,16,37,5,11,1,mm', 'Shelf pin,,,0,1.5,0.197,0.47,,in', 'Bad,,,x,1,5,1,,'].join('\n')
    const r = patternsFromCsv(csv, 'hw.csv')
    expect(r.errors).toEqual(['Line 5: needs x, y and diameter numbers.'])
    expect(r.drafts.map((d) => d.pattern.name)).toEqual(['Hettich plate', 'Shelf pin'])
    expect(r.drafts[0].pattern).toMatchObject({ manufacturer: 'Hettich', status: 'draft', source: 'csv', notes: 'Part 9071' })
    expect(r.drafts[0].pattern.holes).toHaveLength(2)
    expect(r.drafts[1].pattern.holes[0]).toEqual({ x: 0, y: 38.1, diameter: 5.004, depth: 11.938, face: 1 })
  })
})

describe('Hardware patterns: PDF spec-sheet drafts', () => {
  it('drafts a hinge cup from sheet text and quotes every number it used', async () => {
    const d = await textDrafter.draft(
      [
        { page: 1, lines: ['Salice Silentia+ Series 700 110° hinge', 'Soft-close, full overlay'] },
        { page: 3, lines: ['Boring pattern', 'Cup Ø35 x 13.5 mm', 'K = 3 - 6 mm boring distance from the edge of the door', 'Screw holes Ø 8, spacing 45 mm'] },
      ],
      'salice.pdf',
    )
    expect(d.pattern).toMatchObject({ status: 'draft', source: 'pdf-draft', manufacturer: 'Salice', name: 'Salice Silentia+ Series 700 110° hinge' })
    expect(d.pattern.holes[0]).toEqual({ x: 0, y: 20.5, diameter: 35, depth: 13.5, face: 1 })
    expect(d.pattern.holes.slice(1).map((h) => [h.x, h.diameter])).toEqual([
      [-22.5, 8],
      [22.5, 8],
    ])
    expect(Number.isNaN(d.pattern.holes[1].y)).toBe(true)
    expect(d.pattern.provenance.every((p) => p.page === 3 && p.quote)).toBe(true)
    expect(d.pattern.provenance.map((p) => p.quote)).toContain('Cup Ø35 x 13.5 mm')
    expect(patternIssues(d.pattern).length).toBeGreaterThan(0)
    expect(savePattern(structuredClone(defaultAppData().library), d.pattern).ok).toBe(false)
  })

  it('drafts slide holes from positions along the edge', async () => {
    const d = await textDrafter.draft([{ page: 1, lines: ['Blum TANDEM 563H 21"', 'Drill Ø5 mm, 12 mm deep', 'Screw positions 261 and 517 mm from the front', 'Hole line 37 mm above the bottom of the opening'] }], 'tandem.pdf')
    expect(d.pattern.holes).toEqual([
      { x: 261, y: 37, diameter: 5, depth: 12, face: 1 },
      { x: 517, y: 37, diameter: 5, depth: 12, face: 1 },
    ])
    expect(d.pattern.manufacturer).toBe('Blum')
    const ok = approvePattern(d.pattern, { reviewer: 'Avi', checked: true }, now)
    expect(ok.errors).toEqual([])
  })

  it('says so when the text has no holes, and never invents numbers', async () => {
    const d = await textDrafter.draft([{ page: 1, lines: ['Installation instructions', 'See drawing'] }], 'scan.pdf')
    expect(d.pattern.holes).toEqual([])
    expect(d.warnings[0]).toContain('No hole diameters found')
  })

  it('reads text lines out of a real PDF', async () => {
    const doc = new jsPDF({ unit: 'mm' })
    doc.text('Blum TANDEM 563H 15"', 20, 20)
    doc.text('Drill Ø5 mm, 12 mm deep', 20, 30)
    doc.text('Screw positions 165 and 357 mm from the front', 20, 40)
    doc.text('37 mm above the bottom', 20, 50)
    const pages = await pdfTextPages(pdfjs as never, new Uint8Array(doc.output('arraybuffer')))
    expect(pages[0].lines[2]).toBe('Screw positions 165 and 357 mm from the front')
    const d = await textDrafter.draft(pages, 'tandem15.pdf')
    expect(d.pattern.holes.map((h) => [h.x, h.y])).toEqual([
      [165, 37],
      [357, 37],
    ])
  })
})
