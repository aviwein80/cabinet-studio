import { describe, expect, it } from 'vitest'
import { partOutline } from '@/cam/doc'
import { dxfToPart } from '@/cam/dxf'
import { writePartMpr } from '@/cam/mpr'
import { readMpr } from '@/cam/mprRead'
import { applyRules, BUILTIN_RECIPES, BUILTIN_RULESETS, depthFromLayerName, layerMatches } from '@/cam/rules'
import { generatePart } from '@/cam/toolpath'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'

const dxf = (...es: (string | number)[][]) =>
  [0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, 4, 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES', ...es.flat(), 0, 'ENDSEC', 0, 'EOF'].join('\n') + '\n'
const ent = (type: string, ...kv: (string | number)[]) => [0, type, ...kv]
const box = (layer: string, x: number, y: number, w: number, h: number) =>
  ent('LWPOLYLINE', 8, layer, 90, 4, 70, 1, 10, x, 20, y, 10, x + w, 20, y, 10, x + w, 20, y + h, 10, x, 20, y + h)

/** A sign blank as a drafter would send it: layer names carry the intent and depths. */
const SIGN = dxf(
  box('CUTOUT', 0, 0, 800, 400),
  box('INSIDE', 650, 150, 100, 100),
  box('POCKET_D8', 100, 100, 200, 120),
  ent('CIRCLE', 8, 'DRILL_5_12', 10, 40, 20, 40, 40, 2.5),
  ent('CIRCLE', 8, 'DRILL_5_12', 10, 760, 20, 40, 40, 2.5),
  ent('CIRCLE', 8, 'THRU_HOLE', 10, 40, 20, 360, 40, 4),
  ent('LINE', 8, 'ENGRAVE_1.5', 10, 100, 20, 300, 11, 500, 21, 300),
  ent('LINE', 8, 'SAW', 10, 0, 20, 380, 11, 800, 21, 380),
  ent('LINE', 8, 'DIMENSIONS', 10, 0, 20, -20, 11, 800, 21, -20),
)

describe('C5 layer rules', () => {
  it('matches exact, glob and regex layer patterns, case-insensitive', () => {
    expect(layerMatches('CUTOUT', 'cutout')).toBe(true)
    expect(layerMatches('POCKET*', 'pocket_d8')).toBe(true)
    expect(layerMatches('DR?LL', 'DRILL')).toBe(true)
    expect(layerMatches('/^drill/', 'DRILL_5_12')).toBe(true)
    expect(layerMatches('/^drill/', 'PREDRILL')).toBe(false)
    expect(layerMatches('[bad', '[bad')).toBe(true)
    expect(layerMatches('/[bad/', 'x')).toBe(false)
  })

  it('reads depths from layer names', () => {
    expect(depthFromLayerName('POCKET_D8')).toBe(8)
    expect(depthFromLayerName('DRILL_5_12')).toBe(12)
    expect(depthFromLayerName('ENGRAVE_1.5')).toBe(1.5)
    expect(depthFromLayerName('POCKET_0.25in')).toBe(6.35)
    expect(depthFromLayerName('POCKET')).toBeNull()
  })

  it('acceptance: the layer table machines an imported DXF with no hand picking', () => {
    const { part: raw } = dxfToPart(SIGN, 'Sign blank', { thickness: 19 })
    raw.materialId = 'mat-mdf18'
    const { part, report, unmatched, missingRecipes } = applyRules(raw, BUILTIN_RULESETS[0], BUILTIN_RECIPES)
    expect(missingRecipes).toEqual([])
    expect(unmatched).toEqual([{ layer: 'DIMENSIONS', shapes: 1 }])
    const by = (layer: string) => report.find((r) => r.layer === layer)
    expect(by('DRILL_5_12')).toMatchObject({ shapes: 2, depth: 12 })
    expect(by('THRU_HOLE')).toMatchObject({ shapes: 1 })
    expect(by('POCKET_D8')).toMatchObject({ shapes: 1, depth: 8 })
    expect(by('ENGRAVE_1.5')).toMatchObject({ depth: 1.5 })

    const kinds = part.ops.map((o) => `${o.kind}:${o.levels.through ? 'thru' : o.levels.depth}`)
    expect(kinds).toEqual(['drill:thru', 'drill:12', 'pocket:8', 'engrave:1.5', 'saw:8', 'profile:thru', 'profile:thru'])
    const outlineId = partOutline(part).entity!.id
    expect(part.ops[part.ops.length - 1].geometry).toEqual([outlineId])
    const inside = part.ops[part.ops.length - 2]
    expect(inside.kind === 'profile' && inside.side).toBe('inside')

    const paths = generatePart(part, PLACEHOLDER_MACHINE)
    expect(paths).toHaveLength(7)
    expect(paths.every((p) => p.moves.length > 0)).toBe(true)
    const doc = readMpr(writePartMpr(part, paths, PLACEHOLDER_MACHINE, 'MDF18'))
    expect(doc.errors).toEqual([])
    expect(doc.macros.filter((m) => m.id === 102)).toHaveLength(3)
    expect(doc.macros.filter((m) => m.id === 112)).toHaveLength(1)
    expect(doc.macros.filter((m) => m.id === 109)).toHaveLength(1)
  })

  it('re-applying replaces rule-made ops and keeps hand-made ones', () => {
    const { part: raw } = dxfToPart(SIGN, 'Sign blank', { thickness: 19 })
    const once = applyRules(raw, BUILTIN_RULESETS[0], BUILTIN_RECIPES).part
    const manual = { ...once, ops: [...once.ops, { ...once.ops[0], id: 'hand', auto: undefined, name: 'Hand drill' }] }
    const twice = applyRules(manual, BUILTIN_RULESETS[0], BUILTIN_RECIPES).part
    expect(twice.ops.filter((o) => o.auto)).toHaveLength(7)
    expect(twice.ops.find((o) => o.id === 'hand')).toBeTruthy()
  })

  it('geometry tests narrow a rule: only circles of a size range', () => {
    const { part: raw } = dxfToPart(SIGN, 'Sign blank', { thickness: 19 })
    const set = {
      id: 'x',
      name: 'Small holes only',
      alignLongestEdge: false,
      rules: [{ id: 'a', layer: '*', recipeId: 'rc-drill', order: 0, where: [{ field: 'diameter' as const, op: '<=' as const, value: 6 }, { field: 'type' as const, op: '=' as const, value: 'circle' }] }],
    }
    const r = applyRules(raw, set, BUILTIN_RECIPES)
    expect(r.report).toHaveLength(1)
    expect(r.report[0].shapes).toBe(2)
  })

  it('reports rules that point at a missing recipe', () => {
    const { part: raw } = dxfToPart(SIGN, 'Sign blank', { thickness: 19 })
    const r = applyRules(raw, { id: 'y', name: 'y', alignLongestEdge: false, rules: [{ id: 'a', layer: 'SAW', recipeId: 'gone', order: 0 }] }, BUILTIN_RECIPES)
    expect(r.missingRecipes).toEqual(['gone'])
    expect(r.part.ops).toEqual([])
  })
})
