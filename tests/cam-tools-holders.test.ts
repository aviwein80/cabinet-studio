/**
 * M2.7a: holders and aggregates (TOOL-04), tool data compare and spreadsheet import/export
 * (TOOL-05), tool table grid (NEW-15). Holders now reach every router: the shop default holder for
 * tools that name none, the stick-out assumed to be the flute length (the worst case) when none is
 * given; the simulator draws them and the collision checks use them, 2D tools included.
 */
import { describe, expect, it } from 'vitest'
import { checkCollisions, collisionSetup } from '@/cam/collision/collision'
import { makeEntity, newPart, opInputHash, opState } from '@/cam/doc'
import { rect } from '@/cam/geom'
import { revolve } from '@/cam/mesh/surface'
import { defaultOp, toTemplate } from '@/cam/ops'
import { buildTimeline, programOrder } from '@/cam/sim'
import { HeightfieldStock } from '@/cam/stock/heightfield'
import { generatePart } from '@/cam/toolpath'
import { holderEnvelope } from '@/cam/tools/holder'
import type { CamOp, CamPart } from '@/cam/types'
import { confirmKey, machineUnconfirmed, opUnconfirmed } from '@/core/confirm'
import { defaultAppData, PLACEHOLDER_AGGREGATE, PLACEHOLDER_HOLDER, PLACEHOLDER_MACHINE } from '@/core/defaults'
import { parseXlsx } from '@/core/library/import'
import { anglesOutOfReach, effectiveGauge, effectiveHolder, holderProblems, PLACEHOLDER_N200_MODEL, toolOutline } from '@/core/machineModel'
import { normalizeData } from '@/core/normalize'
import { applyToolTable, compareOpTool, GRID_FIELDS, moveCell, parseCell, toolDataReport, toolsCsv, toolsFromRows, toolSnapshot, toolsXlsx, updateOpTool, withField } from '@/core/toolData'
import type { MachineProfile, Tool } from '@/core/types'
import { parseCsv } from '@/core/library/import'
import { edgeParts } from './cam-reference-25d'

const lv = (depth: number, passDepth = 0, through = false) => ({ safeZ: 20, rapidZ: 3, depth, through, stockZ: 0, passDepth })
const clone = () => structuredClone(PLACEHOLDER_MACHINE)

function pocketPart(thickness: number, depth: number, toolId: string, passDepth: number): CamPart {
  const p = newPart({ name: 'Pocket', length: 200, width: 160, thickness, materialId: 'mat-mdf18', entities: [] })
  const e = makeEntity({ t: 'contour', c: rect(70, 50, 60, 60) }, 'machining')
  p.entities = [e]
  p.ops = [{ ...defaultOp('pocket', [e.id]), toolId, levels: lv(depth, passDepth) } as CamOp]
  return p
}

function collide(part: CamPart, m: MachineProfile) {
  const paths = programOrder(generatePart(part, m))
  const tl = buildTimeline(paths)
  return checkCollisions(tl, new HeightfieldStock(part.length, part.width, part.thickness, 0.5), collisionSetup(tl, paths, m, part.thickness))
}

/** A 2D router with long flutes (no holder of its own, so it sits in the shop default). */
const longFlat = (extra: Partial<Tool> = {}): Tool => ({ id: 't191', number: 191, type: 'router', name: 'Long flat 10 mm (test placeholder)', diameter: 10, maxDepth: 45, fluteLength: 45, ...extra })

describe('M2.7a holders reach every router (TOOL-04)', () => {
  it('2D routers use the shop default holder and their own stick-out; drills and saws have none', () => {
    const m = PLACEHOLDER_MACHINE
    for (const n of [101, 102, 103, 104]) {
      const t = m.tools.find((x) => x.number === n)!
      expect(effectiveHolder(m, t)?.id).toBe(PLACEHOLDER_HOLDER.id)
      expect(effectiveGauge(m, t)).toEqual({ gauge: t.gaugeLength, assumed: false })
      const o = toolOutline(m, t)
      expect(o.gauge).toBe(t.gaugeLength)
      expect(o.holder[0]).toEqual({ z: t.gaugeLength, r: 17.5 })
    }
    for (const t of m.tools.filter((x) => x.type !== 'router')) {
      expect(effectiveHolder(m, t)).toBeNull()
      expect(toolOutline(m, t).holder).toEqual([])
    }
  })

  it('no stick-out given: the flute length is assumed (the shortest possible), with a Configure badge even on a real table', () => {
    const m = { ...clone(), placeholder: false }
    m.tools.push(longFlat())
    const t = m.tools.find((x) => x.id === 't191')!
    expect(effectiveGauge(m, t)).toEqual({ gauge: 45, assumed: true })
    expect(toolOutline(m, t).holder[0].z).toBe(45)
    const u = machineUnconfirmed(m).find((x) => x.key === 'tool:t191:lengths')
    expect(u?.value).toMatch(/assumed = flute length/)
    // giving the real stick-out clears it
    m.tools = m.tools.map((x) => (x.id === 't191' ? { ...x, gaugeLength: 70 } : x))
    expect(machineUnconfirmed(m).some((x) => x.key === 'tool:t191:lengths')).toBe(false)
  })

  it('collision checks use the holder of a 2D tool: the default holder at an assumed stick-out hits; a real long stick-out is clean; no default holder, no holder check', () => {
    const m = clone()
    m.tools.push(longFlat())
    // 44 mm deep pocket, flutes 45 mm: the holder face (assumed at 45 above the tip) less the 2 mm margin is inside the panel
    const hit = collide(pocketPart(60, 44, 't191', 11), m)
    expect(hit.length).toBeGreaterThan(0)
    expect(new Set(hit.map((c) => c.kind))).toEqual(new Set(['holder']))
    expect(Math.max(...hit.map((c) => c.depth))).toBeCloseTo(1, 1)
    // the real stick-out of 60 mm: clean
    const long = clone()
    long.tools.push(longFlat({ gaugeLength: 60 }))
    expect(collide(pocketPart(60, 44, 't191', 11), long)).toEqual([])
    // no default holder: the 2D tool has no holder (only its shank is checked), as before M2.7
    const none = { ...clone(), defaultHolderId: undefined }
    none.tools.push(longFlat())
    expect(collide(pocketPart(60, 44, 't191', 11), none)).toEqual([])
  }, 60_000)

  it('a 2D placeholder tool too short for the holder: 30 mm flutes, 50 mm stick-out, a 49 mm pocket shows shank and holder', () => {
    const m = clone()
    const found = collide(pocketPart(70, 49, 't102', 7), m)
    const kinds = new Set(found.map((c) => c.kind))
    expect(kinds.has('shank')).toBe(true)
    expect(kinds.has('holder')).toBe(true)
  }, 60_000)

  it('a holder or stick-out change marks the operations using it stale; confirming does not', () => {
    const m = clone()
    const part = pocketPart(19, 6, 't102', 0)
    const op = part.ops[0]
    const tool = m.tools.find((t) => t.id === 't102')!
    const built = { ...op, builtHash: opInputHash(op, part, tool, m) }
    expect(opState(built, part, tool, m)).toBe('current')
    const h2 = structuredClone(m)
    h2.holders![0].profile = [{ z: 0, r: 20 }, { z: 50, r: 20 }]
    expect(opState(built, part, tool, h2)).toBe('stale')
    const g2 = structuredClone(m)
    const t2 = { ...tool, gaugeLength: 70 }
    expect(opState(built, part, t2, g2)).toBe('stale')
    const c = structuredClone(m)
    confirmKey(c, `holder:${PLACEHOLDER_HOLDER.id}`)
    // confirming a holder clears its placeholder flag only: the outline is unchanged
    expect(opState(built, part, tool, c)).toBe('current')
    // the stored tool data (TOOL-05) is not an input
    expect(opInputHash({ ...op, toolData: toolSnapshot(tool, m, null) }, part, tool, m)).toBe(opInputHash(op, part, tool, m))
  })

  it('the shop default holder shows its Configure badge on 2D operations until confirmed', () => {
    const m = clone()
    const part = pocketPart(19, 6, 't102', 0)
    const tool = m.tools.find((t) => t.id === 't102')!
    const u = opUnconfirmed(part.ops[0], part, m, tool)
    expect(u.find((x) => x.key === `holder:${PLACEHOLDER_HOLDER.id}`)?.label).toMatch(/shop default/)
    expect(u.some((x) => x.key === 'tool:t102:lengths')).toBe(true)
    confirmKey(m, `holder:${PLACEHOLDER_HOLDER.id}`)
    expect(opUnconfirmed(part.ops[0], part, m, tool).some((x) => x.key === `holder:${PLACEHOLDER_HOLDER.id}`)).toBe(false)
    expect(m.holders![0].placeholder).toBe(false)
  })
})

describe('M2.7a holder from a model: revolved envelope', () => {
  // collet chuck: radius 17.5 at the face rising to 21 over 30 mm (a cone), a shoulder to 32, then 40 mm straight
  const profile: [number, number][] = [
    [0, 0],
    [17.5, 0],
    [21, 30],
    [32, 30],
    [32, 70],
    [0, 70],
  ]
  const truth = (z: number) => (z <= 30 ? 17.5 + (3.5 * z) / 30 : 32)
  const mesh = revolve(profile, { tol: 0.005 })

  it('is never smaller than the model, and within one band of it (1 mm bands, 0.1 mm on the cone)', () => {
    const env = holderEnvelope(mesh, { step: 1 })
    expect(env.height).toBeCloseTo(70, 6)
    expect(env.maxR).toBeCloseTo(32, 2)
    expect(env.profile[0].z).toBe(0)
    expect(holderProblems({ profile: env.profile })).toEqual([])
    const o = { r: 0, flute: 0, shankR: 0, gauge: 0, holder: env.profile }
    for (let z = 0.25; z < 70; z += 0.5) {
      // radius of the envelope at height z (the stepped outline)
      const pts = o.holder
      let r = 0
      for (let i = 0; i < pts.length - 1; i++) if (pts[i].z <= z && z <= pts[i + 1].z) r = Math.max(r, Math.min(pts[i].r, pts[i + 1].r))
      expect(r, `z=${z}`).toBeGreaterThanOrEqual(truth(z) - 0.01)
      expect(r - truth(z), `z=${z}`).toBeLessThan(z < 29 ? 0.13 : z < 31 ? 11 : 0.01)
    }
    const fine = holderEnvelope(mesh, { step: 0.25 })
    expect(fine.profile.length).toBeGreaterThan(env.profile.length)
  })

  it('a model with nothing in it is refused', () => {
    expect(() => holderEnvelope({ positions: new Float32Array(), indices: new Uint32Array() })).toThrow(/no facets/)
  })

  it('outline checks: two points, heights from 0 upwards, radii not below zero', () => {
    expect(holderProblems({ profile: [{ z: 0, r: 10 }] })).toHaveLength(1)
    expect(holderProblems({ profile: [{ z: 0, r: 10 }, { z: -5, r: 10 }] }).join(' ')).toMatch(/not go down/)
    expect(holderProblems({ profile: [{ z: 2, r: 10 }, { z: 5, r: -1 }] })).toHaveLength(2)
    expect(holderProblems(PLACEHOLDER_HOLDER)).toEqual([])
  })
})

describe('M2.7a aggregates: offsets, allowed angles, housing (TOOL-04)', () => {
  const withAgg = (patch: Partial<typeof PLACEHOLDER_AGGREGATE> = {}, gauge?: number): MachineProfile => {
    const m = clone()
    m.physical = { ...structuredClone(PLACEHOLDER_N200_MODEL), capabilities: { ...PLACEHOLDER_N200_MODEL.capabilities, aggregate: true } }
    m.aggregates = [{ ...structuredClone(PLACEHOLDER_AGGREGATE), ...patch }]
    m.tools = m.tools.map((t) => (t.id === 't103' ? { ...t, aggregateId: PLACEHOLDER_AGGREGATE.id, ...(gauge ? { gaugeLength: gauge } : {}) } : t))
    return m
  }

  it('angles: any, or a list (within 0.5°)', () => {
    expect(anglesOutOfReach(PLACEHOLDER_AGGREGATE, [0, 33, 271])).toEqual([])
    const four = { ...PLACEHOLDER_AGGREGATE, angles: { mode: 'list' as const, list: [0, 90, 180, 270] } }
    expect(anglesOutOfReach(four, [0, 90.3, 359.8, -90, 45])).toEqual([45])
  })

  it('a tool in an aggregate has no spindle holder; edge work draws the housing and checks angles and clearance', () => {
    const [rectPart, arched] = edgeParts()
    const m = withAgg({}, 40)
    const t = m.tools.find((x) => x.id === 't103')!
    expect(effectiveHolder(m, t)).toBeNull()
    const [tp] = generatePart(rectPart, m)
    expect(tp.edge?.housing).toMatchObject({ width: 70, above: 45, below: 6, length: 90, gauge: 40 })
    expect(tp.warnings.join(' ')).not.toMatch(/cannot be turned|housing/)
    // four fixed angles: the rectangle is fine, the arched door is not
    const four = withAgg({ angles: { mode: 'list', list: [0, 90, 180, 270] } }, 40)
    expect(generatePart(rectPart, four)[0].warnings.join(' ')).not.toMatch(/cannot be turned/)
    expect(generatePart(arched, four)[0].warnings.join(' ')).toMatch(/cannot be turned to \d+ of the angles/)
  })

  it('housing against the panel edge (stick-out less reach under the margin) and below the underside', () => {
    const [rectPart] = edgeParts()
    // 4 mm reach, stick-out assumed = flute length 20: 16 mm clear: fine; stick-out 5: 1 mm clear: hits
    expect(generatePart(rectPart, withAgg())[0].warnings.join(' ')).not.toMatch(/housing would hit/)
    expect(generatePart(rectPart, withAgg({}, 5))[0].warnings.join(' ')).toMatch(/housing would hit the panel's edge/)
    // a housing reaching 30 below the tool axis (9.5 below face 1) on a 19 mm panel: past the underside
    const deep = generatePart(rectPart, withAgg({ housing: { width: 70, above: 45, below: 30, length: 90 } }, 40))[0]
    expect(deep.warnings.join(' ')).toMatch(/would hit the spoilboard/)
    const shallow = generatePart(rectPart, withAgg({ housing: { width: 70, above: 45, below: 5, length: 90 } }, 40))[0]
    expect(shallow.warnings.join(' ')).not.toMatch(/spoilboard/)
  })

  it('a placeholder aggregate has a Configure badge; confirming it clears its flag and fits nothing', () => {
    const m = withAgg()
    const [p] = edgeParts()
    const t = m.tools.find((x) => x.id === 't103')!
    expect(opUnconfirmed(p.ops[0], p, m, t).some((u) => u.key === `aggregate:${PLACEHOLDER_AGGREGATE.id}`)).toBe(true)
    const c = clone()
    expect(machineUnconfirmed(c).some((u) => u.group === 'Aggregates')).toBe(true)
    confirmKey(c, `aggregate:${PLACEHOLDER_AGGREGATE.id}`)
    expect(machineUnconfirmed(c).some((u) => u.group === 'Aggregates')).toBe(false)
    expect(c.aggregates![0].placeholder).toBe(false)
    expect(c.physical?.capabilities.aggregate ?? false).toBe(false)
  })
})

describe('M2.7a tool data in operations (TOOL-05)', () => {
  const part = pocketPart(19, 6, 't102', 0)
  it('an accepted operation keeps its tool data; a table change shows field by field; update stores the new data', () => {
    const m = clone()
    const tool = m.tools.find((t) => t.id === 't102')!
    const op = { ...part.ops[0], toolData: toolSnapshot(tool, m, part.materialId) }
    expect(compareOpTool(op, part, m, tool).diffs).toEqual([])
    const m2 = clone()
    m2.tools = m2.tools.map((t) => (t.id === 't102' ? { ...t, diameter: 10, gaugeLength: 55, feed: 7000 } : t))
    const t2 = m2.tools.find((t) => t.id === 't102')!
    const d = compareOpTool(op, part, m2, t2).diffs
    expect(Object.fromEntries(d.map((x) => [x.field, [x.stored, x.library]]))).toEqual({ diameter: [8, 10], gauge: [50, 55], feed: [5000, 7000], plunge: [2000, Math.round(7000 / 3)] })
    const upd = updateOpTool(op, part, m2, t2)
    expect(compareOpTool(upd, part, m2, t2).diffs).toEqual([])
    // toolData never reaches a recipe
    expect('toolData' in toTemplate(op)).toBe(false)
  })

  it('the report lists changed operations, ones with no data yet and ones with their own feeds; "use table feeds" drops them', () => {
    const m = clone()
    const tool = m.tools.find((t) => t.id === 't102')!
    const a = { ...part, id: 'a', ops: [{ ...part.ops[0], id: 'o1', toolData: toolSnapshot(tool, m, part.materialId) }] }
    const b = { ...part, id: 'b', ops: [{ ...part.ops[0], id: 'o2' }] }
    const c = { ...part, id: 'c', ops: [{ ...part.ops[0], id: 'o3', toolData: toolSnapshot(tool, m, part.materialId), feeds: { feed: 3000 } }] }
    const toolOf = () => tool
    expect(toolDataReport([{ part: a }, { part: b }, { part: c }], m, toolOf).map((r) => [r.opId, r.noData, r.diffs.length, Object.keys(r.overrides)])).toEqual([
      ['o2', true, 0, []],
      ['o3', false, 0, ['feed']],
    ])
    const cleared = updateOpTool(c.ops[0], c, m, tool, { clearOverrides: true })
    expect(cleared.feeds).toEqual({})
  })
})

describe('M2.7a tool table spreadsheet (TOOL-05) and grid (NEW-15)', () => {
  it('exports every field to .xlsx and reads it back with no change (lossless)', () => {
    const m = clone()
    m.tools[0] = { ...m.tools[0], notes: 'a, "quoted" note', centreCutting: true, folder: 'Routers/Compression' }
    const rows = parseXlsx(toolsXlsx(m))
    expect(rows).toHaveLength(m.tools.length)
    const back = toolsFromRows(rows, m)
    expect(back.errors).toEqual([])
    expect(back.changes).toEqual([])
    expect(back.added).toEqual([])
    expect(back.tools).toEqual(m.tools)
    // CSV too
    const csv = toolsFromRows(parseCsv(toolsCsv(m)), m)
    expect(csv.errors).toEqual([])
    expect(csv.changes).toEqual([])
  })

  it('a filled cell changes the value, an empty one keeps it; new numbers become tools; bad rows are skipped with a reason', () => {
    const m = clone()
    const rows = [
      { number: 101, diameter: 12.7, gaugeLength: '', name: '' },
      { 'Tool no.': 150, type: 'router', name: 'New 4 mm', diameter: 4, maxDepth: 15, 'Stick-out': 35, holder: 'Collet chuck (placeholder)' },
      { number: 160, type: 'router', diameter: 5 },
      { number: 102, diameter: 'abc' },
      { tno: 103, weird: 'x' },
    ]
    const r = toolsFromRows(rows, m)
    expect(r.changes).toEqual([{ toolId: 't101', number: 101, field: 'diameter', from: 12, to: 12.7 }])
    expect(r.added.map((t) => [t.number, t.diameter, t.gaugeLength, t.holderId])).toEqual([[150, 4, 35, PLACEHOLDER_HOLDER.id]])
    expect(r.errors.map((e) => e.slice(0, 14))).toEqual(['Row 4 (T160): ', 'Row 5 (T102): '])
    expect(r.ignored).toEqual(['weird'])
    expect(r.tools.find((t) => t.id === 't101')?.gaugeLength).toBe(62)
    // applying confirms what was typed, nothing else; the placeholder-table switch stays
    const applied = structuredClone(m)
    applyToolTable(applied, r.tools)
    expect(applied.confirmed).toEqual(expect.arrayContaining(['tool:t101:data', 'tool:t150:data', 'tool:t150:lengths']))
    expect(applied.confirmed).not.toContain('tool:t102:data')
    expect(applied.placeholder).toBe(true)
  })

  it('grid cells: lengths in inches with fractions, required fields, numbers; keyboard moves wrap with Tab', () => {
    const f = (k: string) => GRID_FIELDS.find((x) => x.key === k)!
    expect(parseCell('1/2', f('diameter'), 'in')).toEqual({ value: 12.7 })
    expect(parseCell('', f('diameter'), 'mm')).toHaveProperty('error')
    expect(parseCell('', f('gaugeLength'), 'mm')).toEqual({ value: undefined })
    expect(parseCell('0', f('rpm'), 'mm')).toHaveProperty('error')
    expect(parseCell('2.5', f('number'), 'mm')).toHaveProperty('error')
    expect(parseCell('BALL', f('shape'), 'mm')).toEqual({ value: 'ball' })
    expect(parseCell('Collet chuck (placeholder)', f('holderId'), 'mm', PLACEHOLDER_MACHINE)).toEqual({ value: PLACEHOLDER_HOLDER.id })
    expect(withField({ ...PLACEHOLDER_MACHINE.tools[0] }, 'gaugeLength', undefined)).not.toHaveProperty('gaugeLength')
    const cols = GRID_FIELDS.length
    expect(moveCell({ row: 0, col: cols - 1 }, 'Tab', false, 3, cols)).toEqual({ row: 1, col: 0 })
    expect(moveCell({ row: 1, col: 0 }, 'Tab', true, 3, cols)).toEqual({ row: 0, col: cols - 1 })
    expect(moveCell({ row: 2, col: 1 }, 'ArrowDown', false, 3, cols)).toEqual({ row: 2, col: 1 })
    expect(moveCell({ row: 2, col: 1 }, 'Enter', true, 3, cols)).toEqual({ row: 1, col: 1 })
    expect(moveCell({ row: 0, col: 3 }, 'Home', false, 3, cols)).toEqual({ row: 0, col: 0 })
  })
})

describe('M2.7a stored data', () => {
  it('a placeholder table saved before M2.7 gets the 2D stick-outs only on tools still as invented; real tables are untouched', () => {
    const old = defaultAppData()
    old.machine.tools = old.machine.tools.map(({ gaugeLength: _g, ...t }) => (t.type === 'router' && !t.shape ? t : { ...t, ...(t.shape ? { gaugeLength: _g } : {}) }) as Tool)
    old.machine.tools = old.machine.tools.map((t) => (t.id === 't102' ? { ...t, diameter: 9 } : t))
    delete (old.machine as Partial<MachineProfile>).defaultHolderId
    delete (old.machine as Partial<MachineProfile>).aggregates
    const d = normalizeData(JSON.parse(JSON.stringify(old)))
    expect(d.machine.tools.find((t) => t.id === 't101')?.gaugeLength).toBe(62)
    expect(d.machine.tools.find((t) => t.id === 't102')?.gaugeLength).toBeUndefined()
    expect(d.machine.defaultHolderId).toBe(PLACEHOLDER_HOLDER.id)
    expect(d.machine.aggregates?.[0].id).toBe(PLACEHOLDER_AGGREGATE.id)
    const real = JSON.parse(JSON.stringify(old))
    real.machine.placeholder = false
    expect(normalizeData(real).machine.tools.find((t) => t.id === 't101')?.gaugeLength).toBeUndefined()
  })
})

