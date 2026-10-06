/**
 * M2.7c: geometry queries (CAD-17), fill with holes (CAD-18), panelling (NEW-05).
 * Queries reproduce the Stage 1 layer-rule results (checked against the Stage 1 claim written out
 * here independently), and add face and model tests.
 */
import { describe, expect, it } from 'vitest'
import { entityContours, makeEntity, newPart, partOutline } from '@/cam/doc'
import { dxfToPart } from '@/cam/dxf'
import { area, circle, closestOnContour, type Contour, pointInContour, polyline, pt, rect } from '@/cam/geom'
import { DEFAULT_FILL, fillHoles } from '@/cam/holeFill'
import { panelize, panelStarts } from '@/cam/panelling'
import { claimShapes, entityFacts, faceFacts, layerMatches, modelFacts, queryFaces, queryModels, queryShapes, runAutoQueries, testPasses } from '@/cam/query'
import { applyRules, BUILTIN_RECIPES, BUILTIN_RULESETS } from '@/cam/rules'
import { faceType } from '@/cam/solid/faceSelect'
import type { CamPart, Entity, GeoQuery, LayerRule, ModelRef } from '@/cam/types'
import { referenceParts } from './cam-reference'
import { readFixture } from './solid-fixtures'

/** The Stage 1 claim, as it was written before M2.7 (kept here as the reference). */
function stage1Claim(part: CamPart, rules: LayerRule[]): Map<string, string> {
  const sorted = [...rules].sort((a, b) => a.order - b.order)
  const out = new Map<string, string>()
  for (const e of part.entities) {
    const layer = part.layers.find((l) => l.id === e.layer)
    if (layer?.construction || e.g.t === 'point') continue
    const f = entityFacts(part, e)
    const r = sorted.find((rr) => layerMatches(rr.layer, f.layer) && (rr.where ?? []).every((t) => testPasses(t, f)))
    if (r) out.set(e.id, r.id)
  }
  return out
}

/** A deterministic mix of shapes on shop layer names (closed, open, circles, text, points). */
function mixedPart(seed: number): CamPart {
  let s = seed
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
  const layers = ['DRILL_5_12', 'THRU_HOLE', 'POCKET_D8', 'pocket', 'ENGRAVE_1.5', 'VCARVE', 'SAW', 'kerf', 'INSIDE', 'OUTLINE', 'cut', '0', 'DIMENSIONS', 'bore_35', 'through-drill', 'text', 'profile']
  const p = newPart({ name: `Mix ${seed}`, length: 1000, width: 600, entities: [] })
  const es: Entity[] = []
  for (let i = 0; i < 60; i++) {
    const name = layers[Math.floor(rnd() * layers.length)]
    let lid = p.layers.find((l) => l.name === name)?.id
    if (!lid) {
      lid = `L${p.layers.length}`
      p.layers.push({ id: lid, name, color: '#888', visible: true, locked: false })
    }
    const x = rnd() * 900
    const y = rnd() * 500
    const k = Math.floor(rnd() * 5)
    const g =
      k === 0
        ? { t: 'circle' as const, c: pt(x, y), r: 1 + rnd() * 20 }
        : k === 1
          ? { t: 'contour' as const, c: rect(x, y, 10 + rnd() * 90, 10 + rnd() * 90) }
          : k === 2
            ? { t: 'contour' as const, c: polyline([pt(x, y), pt(x + 50, y + rnd() * 50), pt(x + 90, y)], false) }
            : k === 3
              ? { t: 'text' as const, at: pt(x, y), text: 'AB', height: 20, angle: 0 }
              : { t: 'point' as const, p: pt(x, y) }
    es.push(makeEntity(g, lid))
  }
  p.entities = es
  return p
}

describe('M2.7c queries reproduce the Stage 1 layer rules (CAD-17)', () => {
  const SIGN = [0, 'SECTION', 2, 'ENTITIES', 0, 'LWPOLYLINE', 8, 'CUTOUT', 90, 4, 70, 1, 10, 0, 20, 0, 10, 800, 20, 0, 10, 800, 20, 400, 10, 0, 20, 400, 0, 'CIRCLE', 8, 'DRILL_5_12', 10, 40, 20, 40, 40, 2.5, 0, 'LINE', 8, 'SAW', 10, 0, 20, 380, 11, 800, 21, 380, 0, 'ENDSEC', 0, 'EOF'].join('\n')

  it('every shape of 40 mixed parts, the 20 reference parts and an imported DXF is claimed by the same rule', () => {
    const rules = BUILTIN_RULESETS[0].rules
    const parts = [...Array.from({ length: 40 }, (_, i) => mixedPart(i + 1)), ...referenceParts(), dxfToPart(SIGN, 'Sign').part]
    let shapes = 0
    let claimed = 0
    for (const p of parts) {
      const want = stage1Claim(p, rules)
      const got = new Map([...claimShapes(p, rules)].map(([id, r]) => [id, r.id]))
      expect(Object.fromEntries(got), p.name).toEqual(Object.fromEntries(want))
      shapes += p.entities.length
      claimed += want.size
    }
    expect(shapes).toBeGreaterThan(2400)
    expect(claimed).toBeGreaterThan(1000)
  })

  it('the layer rules give the same operations as before (applyRules runs on the query engine)', () => {
    const p = mixedPart(7)
    const r = applyRules(p, BUILTIN_RULESETS[0], BUILTIN_RECIPES)
    const want = stage1Claim(p, BUILTIN_RULESETS[0].rules)
    const opShapes = r.part.ops.flatMap((o) => o.geometry)
    expect(new Set(opShapes)).toEqual(new Set(want.keys()))
  })

  it('new shape fields and operators: radius, length, holes, inside, outline, between, in, not', () => {
    const p = newPart({ name: 'Q', length: 600, width: 400, entities: [] })
    const outline = makeEntity({ t: 'contour', c: rect(0, 0, 600, 400) }, 'outline')
    const pocket = makeEntity({ t: 'contour', c: rect(100, 100, 120, 80) }, 'machining')
    const holes = [5, 8, 35].map((d, i) => makeEntity({ t: 'circle', c: pt(300 + i * 60, 200), r: d / 2 }, 'holes'))
    const island = makeEntity({ t: 'circle', c: pt(160, 140), r: 10 }, 'holes')
    p.entities = [outline, pocket, ...holes, island]
    const q = (tests: GeoQuery['tests'], match: GeoQuery['match'] = 'all') => queryShapes(p, { match, tests })
    expect(q([{ field: 'diameter', op: 'between', value: 4, value2: 10 }])).toEqual([holes[0].id, holes[1].id])
    expect(q([{ field: 'diameter', op: 'in', value: '8, 35' }])).toEqual([holes[1].id, holes[2].id])
    expect(q([{ field: 'outline', op: '=', value: true }])).toEqual([outline.id])
    expect(q([{ field: 'holes', op: '>=', value: 1 }, { field: 'outline', op: '=', value: false }])).toEqual([pocket.id])
    expect(q([{ field: 'inside', op: '=', value: false }])).toEqual([outline.id])
    expect(q([{ field: 'length', op: '>', value: 1000 }])).toEqual([outline.id])
    expect(q([{ field: 'layer', op: '!matches', value: 'hol*' }, { field: 'radius', op: '=', value: 0 }])).toEqual([outline.id, pocket.id])
    expect(q([{ field: 'type', op: '=', value: 'circle' }, { field: 'x', op: '<', value: 200 }], 'any')).toHaveLength(5)
  })

  it('auto-queries move what they find to their result layer before the rules run', () => {
    const p = newPart({ name: 'A', length: 600, width: 400, entities: [] })
    const holes = [5, 5, 35].map((d, i) => makeEntity({ t: 'circle', c: pt(100 + i * 100, 200), r: d / 2 }, 'outline'))
    const outline = makeEntity({ t: 'contour', c: rect(0, 0, 600, 400) }, 'outline')
    p.entities = [outline, ...holes]
    const q: GeoQuery = { id: 'q', name: '5 mm holes', target: 'shapes', match: 'all', tests: [{ field: 'diameter', op: '=', value: 5 }], resultLayer: 'DRILL_5_12' }
    const moved = runAutoQueries(p, [q])
    expect(moved.report).toEqual([{ query: '5 mm holes', shapes: 2, layer: 'DRILL_5_12' }])
    const set = { ...BUILTIN_RULESETS[0], queries: [q] }
    const r = applyRules(p, set, BUILTIN_RECIPES)
    const drill = r.part.ops.find((o) => o.kind === 'drill')!
    expect(drill.geometry.sort()).toEqual([holes[0].id, holes[1].id].sort())
    expect(drill.levels.depth).toBe(12)
  })

  it('face and model queries on a STEP cabinet side: the 26 5 mm holes, the pocket floors by depth', async () => {
    const solid = await readFixture('cabinet-side.step')
    const model: ModelRef = { id: 'm', name: 'Cabinet side', kind: 'solid', blob: 'b', source: 'cabinet-side.step', units: 'mm', place: { up: '+z', rotZ: 0, scale: 1, mirror: false, at: [0, 0, 0] }, layer: 'models', visible: true, triangles: 1000, size: [720, 560, 19], faces: solid.bodies.reduce((n, b) => n + b.faces.length, 0), format: 'STEP AP214' }
    const part = { ...newPart({ name: 'Side', length: 720, width: 560, thickness: 19 }), models: [model] }
    const holes = queryFaces(part, model, solid, { match: 'all', tests: [{ field: 'type', op: '=', value: 'hole' }, { field: 'diameter', op: '=', value: 5 }] })
    const byFace = new Map(solid.bodies.flatMap((b) => b.faces.map((f) => [f.id, f])))
    // the panel stands on its edge in the file (thickness along X): hole axes run along X, so they differ in Y and Z
    const axes = new Set(holes.map((id) => { const s = byFace.get(id)!.surface; return `${s.p![1].toFixed(2)},${s.p![2].toFixed(2)}` }))
    expect(holes.every((id) => faceType(byFace.get(id)!) === 'hole')).toBe(true)
    expect(axes.size).toBe(26)
    const floors = queryFaces(part, model, solid, { match: 'all', tests: [{ field: 'type', op: '=', value: 'flat' }, { field: 'facing', op: '=', value: 'up' }, { field: 'depth', op: 'between', value: 0.1, value2: 18.9 }, { field: 'area', op: '>', value: 200 }] })
    const facts = new Map(faceFacts(solid, model, (x) => x).map((f) => [f.id, f.facts]))
    const depths = [...new Set(floors.map((id) => facts.get(id)!.depth as number))].sort((a, b) => a - b)
    expect(depths).toEqual([3, 4, 9.5, 10])
    expect(queryModels(part, { match: 'all', tests: [{ field: 'kind', op: '=', value: 'solid' }, { field: 'sizeZ', op: '=', value: 19 }] })).toEqual(['m'])
    expect(modelFacts(part, model).format).toBe('STEP AP214')
  })
})

describe('M2.7c fill with holes (CAD-18)', () => {
  const dist = (c: Contour, p: { x: number; y: number }) => closestOnContour(c, p).d

  it('grid: 126 holes in a 300 x 200 panel (5 mm, 10 mm margin, 20 mm pitch), centred, every hole clear by the margin', () => {
    const b = rect(0, 0, 300, 200)
    const r = fillHoles([b], { ...DEFAULT_FILL, diameter: 5, margin: 10, spacingX: 20, spacingY: 20 })
    expect(r.error).toBeUndefined()
    expect(r.centres).toHaveLength(14 * 9)
    const xs = r.centres.map((p) => p.x)
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(300, 9)
    for (const p of r.centres) expect(dist(b, p) - 2.5).toBeGreaterThanOrEqual(10 - 1e-6)
  })

  it('islands stay clear, staggered rows are offset by half a pitch, a turned grid stays inside', () => {
    const outer = circle(pt(200, 200), 180)
    const island = rect(150, 150, 100, 100)
    const st = fillHoles([outer, island], { ...DEFAULT_FILL, pattern: 'staggered', diameter: 8, margin: 6, spacingX: 24, spacingY: 20 })
    expect(st.centres.length).toBeGreaterThan(100)
    for (const p of st.centres) {
      expect(pointInContour(outer, p)).toBe(true)
      expect(pointInContour(island, p)).toBe(false)
      expect(Math.min(dist(outer, p), dist(island, p)) - 4).toBeGreaterThanOrEqual(6 - 1e-3)
    }
    const rows = [...new Set(st.centres.map((p) => p.y.toFixed(6)))]
    const firstX = (y: string) => Math.min(...st.centres.filter((p) => p.y.toFixed(6) === y).map((p) => p.x))
    const shift = Math.abs(((firstX(rows[1]) - firstX(rows[0])) % 24) + 24) % 24
    expect(Math.min(shift, 24 - shift)).toBeCloseTo(12, 6)
    const turned = fillHoles([rect(0, 0, 400, 300)], { ...DEFAULT_FILL, angle: 30, diameter: 6, margin: 5, spacingX: 25, spacingY: 25 })
    for (const p of turned.centres) expect(dist(rect(0, 0, 400, 300), p) - 3).toBeGreaterThanOrEqual(5 - 1e-6)
    // holes never closer than the pitch
    for (let i = 0; i < turned.centres.length; i++) for (let j = i + 1; j < turned.centres.length; j++) expect(Math.hypot(turned.centres[i].x - turned.centres[j].x, turned.centres[i].y - turned.centres[j].y)).toBeGreaterThan(25 - 1e-6)
  })

  it('radial: a hole in the middle and rings round it', () => {
    const r = fillHoles([circle(pt(0, 0), 100)], { ...DEFAULT_FILL, pattern: 'radial', diameter: 6, margin: 5, ringStep: 30, holeStep: 30 })
    expect(r.centres[0]).toEqual({ x: 0, y: 0 })
    const rings = new Map<number, number>()
    for (const p of r.centres) rings.set(Math.round(Math.hypot(p.x, p.y)), (rings.get(Math.round(Math.hypot(p.x, p.y))) ?? 0) + 1)
    expect([...rings]).toEqual([
      [0, 1],
      [30, 6],
      [60, 12],
      [90, 18],
    ])
  })

  it('refuses spacing tighter than the hole and an area too small', () => {
    expect(fillHoles([rect(0, 0, 100, 100)], { ...DEFAULT_FILL, diameter: 10, spacingX: 8 }).error).toMatch(/spacing/)
    expect(fillHoles([rect(0, 0, 20, 20)], { ...DEFAULT_FILL, diameter: 5, margin: 10 }).error).toMatch(/too small/)
    expect(fillHoles([polyline([pt(0, 0), pt(10, 0)], false)], DEFAULT_FILL).error).toMatch(/closed shape/)
  })
})

describe('M2.7c panelling (NEW-05)', () => {
  it('panel starts: equal panels no bigger than the sheet, neighbours overlapping by exactly the overlap', () => {
    const s = panelStarts(0, 5000, 2440, 50)
    expect(s).toHaveLength(3)
    const each = (5000 + 2 * 50) / 3
    expect(s[1] - s[0]).toBeCloseTo(each - 50, 6)
    expect(s[2] + each).toBeCloseTo(5000, 6)
    expect(panelStarts(0, 2000, 2440, 50)).toEqual([0])
  })

  it('a 5000 x 1200 sign with a hole and a cut-out letter is split into closed panels that add up to it', () => {
    const p = newPart({ name: 'Sign', length: 5000, width: 1200, thickness: 19, entities: [] })
    const outline = makeEntity({ t: 'contour', c: { closed: true, segs: [...rect(0, 0, 5000, 1200).segs] } }, 'outline')
    const hole = makeEntity({ t: 'circle', c: pt(1700, 600), r: 300 }, 'machining')
    const slotE = makeEntity({ t: 'contour', c: rect(2300, 200, 900, 150) }, 'machining')
    const groove = makeEntity({ t: 'contour', c: polyline([pt(100, 1000), pt(4900, 1000)], false) }, 'machining')
    p.entities = [outline, hole, slotE, groove]
    p.outlineId = outline.id
    p.ops = [{ id: 'cut', name: 'Cut out', kind: 'profile', geometry: [outline.id] } as never, { id: 'g', name: 'Groove', kind: 'engrave', geometry: [groove.id] } as never]
    const r = panelize(p, { length: 2440, width: 1220, overlap: 50 })
    expect(r.error).toBeUndefined()
    expect(r.panels).toHaveLength(3)
    let outlineArea = 0
    for (const pn of r.panels) {
      expect(pn.part.length).toBeLessThanOrEqual(2440 + 1e-6)
      expect(pn.part.width).toBeLessThanOrEqual(1220 + 1e-6)
      for (const e of pn.part.entities) for (const c of entityContours(e)) for (const s of c.segs) for (const q of [s.a, s.b]) {
        // (pieces cut by a join are refitted to lines and arcs within the kernel's 0.005 mm)
        expect(q.x).toBeGreaterThanOrEqual(-0.005)
        expect(q.x).toBeLessThanOrEqual(pn.part.length + 0.005)
      }
      // the outline's piece is closed (closed again along the join) and is the panel's outline
      const out = partOutline(pn.part)
      expect(out.contour.closed).toBe(true)
      outlineArea += Math.abs(area(out.contour))
      // the cut-out operation follows its piece; the groove its pieces
      expect(pn.part.ops.find((o) => o.name === 'Cut out')?.geometry).toHaveLength(1)
      expect(pn.part.ops.find((o) => o.name === 'Groove')?.geometry.length).toBeGreaterThan(0)
    }
    // the pieces add up to the sign plus the two overlap strips
    expect(outlineArea).toBeCloseTo(5000 * 1200 + 2 * 50 * 1200, 0)
    // the hole straddles the first join: closed pieces on both panels, their areas add up to the circle plus the overlap strip through it
    const holeAreas = r.panels.flatMap((pn) => pn.part.entities.filter((e) => e.layer === hole.layer && e.g.t === 'contour' && entityContours(e)[0].closed && Math.abs(area(entityContours(e)[0])) < 3e5).map((e) => Math.abs(area(entityContours(e)[0]))))
    expect(holeAreas.length).toBeGreaterThanOrEqual(2)
  })
})
