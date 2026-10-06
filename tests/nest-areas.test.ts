import { describe, expect, it } from 'vitest'
import { areasCsv, formatArea, instanceArea, jobCosts, kgPerM2, materialUnconfirmed, nestAreas, ratePerM2 } from '../src/core/areas'
import type { PartInstance } from '../src/core/cutlist'
import type { JobNest } from '../src/core/machining'
import { runJob } from '../src/core/pipeline'
import { sampleJob } from '../src/core/sample'
import type { Material } from '../src/core/types'
import { data } from './helpers'

const rect = (l: number, w: number, x = 0, y = 0) => [
  { x, y },
  { x: x + l, y },
  { x: x + l, y: y + w },
  { x, y: y + w },
]

const inst = (uid: string, no: number, l: number, w: number, extra: Partial<PartInstance> = {}) =>
  ({ uid, no, cutLength: l, cutWidth: w, outline: rect(l, w), part: { name: uid }, materialId: 'm', ...extra }) as unknown as PartInstance

// Hand-worked job: one 2440 x 1220 sheet, three parts and a 600 mm end strip kept as a remnant.
const instances = [
  inst('A', 1, 1000, 500),
  // 600 x 400 with a 200 x 100 opening right through
  inst('B', 2, 600, 400, { holes: [rect(200, 100, 100, 100)] }),
  // L shape: 400 x 400 less a 200 x 200 corner
  inst('C', 3, 400, 400, { outline: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 }, { x: 200, y: 200 }, { x: 200, y: 400 }, { x: 0, y: 400 }] }),
]
const nest: JobNest = {
  spacing: 14,
  unplaced: [],
  sheets: [
    {
      index: 1,
      materialId: 'm',
      sheetLength: 2440,
      sheetWidth: 1220,
      thickness: 18,
      utilization: 0,
      placements: [
        { uid: 'A', x: 10, y: 10, rotated: false, dx: 1000, dy: 500 },
        { uid: 'B', x: 1024, y: 10, rotated: false, dx: 600, dy: 400 },
        { uid: 'C', x: 10, y: 524, rotated: false, dx: 400, dy: 400 },
      ],
      remnants: [{ x: 1840, y: 0, length: 600, width: 1220, dir: 'vertical' }],
    },
  ],
}
const mat = (cost?: Material['cost']): Material => ({ id: 'm', code: 'MEL18', name: 'Melamine', thickness: 18, sheetLength: 2440, sheetWidth: 1220, grain: false, color: '#fff', ...(cost ? { cost } : {}) })

describe('areas (NEW-20)', () => {
  it('part areas: outline less openings', () => {
    expect(instanceArea(instances[0])).toBe(500_000)
    expect(instanceArea(instances[1])).toBe(240_000 - 20_000)
    expect(instanceArea(instances[2])).toBe(160_000 - 40_000)
  })

  it('sheet areas match the hand numbers and add up', () => {
    const { sheets } = nestAreas(nest, instances)
    const s = sheets[0]
    expect(s.sheetArea).toBe(2_976_800)
    expect(s.partsArea).toBe(840_000)
    expect(s.remnantArea).toBe(732_000)
    expect(s.scrapArea).toBe(1_404_800)
    expect(s.partsArea + s.remnantArea + s.scrapArea).toBe(s.sheetArea)
    expect(s.partsPct).toBeCloseTo(28.218, 3)
  })

  it('shows m² or ft²', () => {
    expect(formatArea(2_976_800, 'mm')).toBe('2.977 m²')
    expect(formatArea(92_903.04, 'in')).toBe('1.00 ft²')
  })
})

describe('costs (NEW-20)', () => {
  it('no price: nothing costed, the material is listed to configure', () => {
    const c = jobCosts(nest, instances, { materials: [mat()] })
    expect(c.sheets[0].sheetCost).toBeNull()
    expect(c.parts.every((p) => p.cost === null && p.share === null)).toBe(true)
    expect(c.missing).toEqual(['m'])
    const u = materialUnconfirmed({ materials: [mat()] })
    expect(u.map((x) => x.key)).toEqual(['material:m:price'])
    expect(u[0].target).toEqual({ kind: 'material', materialId: 'm', part: 'price' })
  })

  it('by area: $40 per m², by hand', () => {
    const c = jobCosts(nest, instances, { materials: [mat({ by: 'area', price: 40 })] })
    const s = c.sheets[0]
    expect(s.sheetCost).toBeCloseTo(119.072, 9) // 2.9768 m² x 40
    expect(s.partsCost).toBeCloseTo(33.6, 9) // 0.84 m²
    expect(s.remnantValue).toBeCloseTo(29.28, 9) // 0.732 m²
    expect(s.scrapCost).toBeCloseTo(56.192, 9) // 1.4048 m²
    expect(s.sheetWeight).toBeNull()
    const [a, b, cc] = c.parts
    expect(a.cost).toBeCloseTo(20, 9)
    expect(b.cost).toBeCloseTo(8.8, 9)
    expect(cc.cost).toBeCloseTo(4.8, 9)
    // share: (119.072 - 29.28) / 0.84 m² = 106.895238 per m² of part
    expect(a.share).toBeCloseTo(53.447619, 5)
    expect(b.share).toBeCloseTo(23.516952, 5)
    expect(cc.share).toBeCloseTo(12.827429, 5)
    expect(a.share! + b.share! + cc.share!).toBeCloseTo(s.sheetCost! - s.remnantValue!, 9)
    expect(c.missing).toEqual([])
    expect(materialUnconfirmed({ materials: [mat({ by: 'area', price: 40 })] })).toEqual([])
  })

  it('by weight: $0.50 per kg at 700 kg/m³, 18 mm thick, by hand', () => {
    const m = mat({ by: 'weight', price: 0.5, density: 700 })
    expect(kgPerM2(m)).toBeCloseTo(12.6, 12) // 700 x 0.018
    expect(ratePerM2(m)).toBeCloseTo(6.3, 12)
    const c = jobCosts(nest, instances, { materials: [m] })
    expect(c.sheets[0].sheetWeight).toBeCloseTo(37.50768, 9)
    expect(c.sheets[0].sheetCost).toBeCloseTo(18.75384, 9)
    expect(c.parts[0].weight).toBeCloseTo(6.3, 9)
    expect(c.parts[0].cost).toBeCloseTo(3.15, 9)
    // by weight without a density: not costed, the density is listed
    const noDensity = mat({ by: 'weight', price: 0.5 })
    expect(ratePerM2(noDensity)).toBeNull()
    expect(materialUnconfirmed({ materials: [noDensity] }).map((x) => x.key)).toEqual(['material:m:density'])
  })

  it('CSV carries every sheet, part and the total', () => {
    const c = jobCosts(nest, instances, { materials: [mat({ by: 'area', price: 40 })] })
    const csv = areasCsv(c, instances, { materials: [mat()] }).split('\r\n')
    expect(csv[1]).toBe('Sheet,1,MEL18,2.9768,0.8400,0.7320,1.4048,119.07,33.60,29.28,56.19,')
    expect(csv[2]).toBe('Part,"#1 A",MEL18,0.5000,,,,20.00,53.45,,,')
    expect(csv[5]).toBe('Total,,,2.9768,0.8400,0.7320,1.4048,119.07,33.60,29.28,56.19,0.0')
  })

  it('sample job: sheets add up and match the parts', () => {
    const d = data((x) => x.library.materials.forEach((m) => (m.cost = { by: 'area', price: 25 })))
    const out = runJob({ ...sampleJob(), id: 'j', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }, d)
    const c = jobCosts(out.nest, out.instances, d.library)
    for (const s of c.sheets) {
      expect(s.partsArea + s.remnantArea + s.scrapArea).toBeCloseTo(s.sheetArea, 6)
      expect(s.scrapArea).toBeGreaterThan(0)
      expect(s.sheetCost).toBeCloseTo((s.sheetArea / 1e6) * 25, 9)
    }
    expect(c.parts.length).toBe(out.instances.length)
    expect(c.parts.reduce((n, p) => n + p.area, 0)).toBeCloseTo(c.total.partsArea, 3)
    expect(c.parts.reduce((n, p) => n + p.share!, 0)).toBeCloseTo(c.total.sheetCost - c.total.remnantValue, 6)
  })
})
