import { describe, expect, it } from 'vitest'
import { defaultLibrary } from '../src/core/defaults'
import { importEdgebands, importMaterials, importTemplates, importTools, parseCsv } from '../src/core/library/import'
import { formatDims, offcutSize, parseLength, sizedName, toMm } from '../src/core/units'
import { data } from './helpers'

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
