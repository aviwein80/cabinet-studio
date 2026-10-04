import { describe, expect, it } from 'vitest'
import { entityContours } from '@/cam/doc'
import { BUILTIN_DOOR_STYLES, buildDoor, type DoorSpec, fieldContour, hingeCups, parseDoorCsv, rebuildDoor, solveCathedral } from '@/cam/doors'
import { area, endOf, startOf, tangentAt } from '@/cam/geom'
import { solve } from '@/cam/solver'
import { generatePart } from '@/cam/toolpath'
import { defaultAppData } from '@/core/defaults'
import { mprFiles, runJob } from '@/core/pipeline'
import type { AppData, Job } from '@/core/types'
import { readMpr } from '@/cam/mprRead'

const style = (id: string) => BUILTIN_DOOR_STYLES.find((s) => s.id === id)!
const spec = (over: Partial<DoorSpec> = {}): DoorSpec => ({ name: 'Door', styleId: 'ds-shaker', width: 400, height: 700, qty: 1, materialId: 'mat-mdf18', thickness: 18, hinge: 'left', pull: 'none', pullAt: 'top', values: {}, grain: 'none', ...over })

describe('C6 constraint solver', () => {
  const rectSketch = (w: number) => ({
    points: [
      { id: 'a', x: 0, y: 0, fixed: true },
      { id: 'b', x: 90, y: 3 },
      { id: 'c', x: 95, y: 55 },
      { id: 'd', x: -4, y: 47 },
    ],
    constraints: [
      { k: 'horizontal' as const, a: 'a', b: 'b' },
      { k: 'vertical' as const, a: 'b', b: 'c' },
      { k: 'horizontal' as const, a: 'c', b: 'd' },
      { k: 'vertical' as const, a: 'd', b: 'a' },
      { k: 'dx' as const, a: 'a', b: 'b', d: w },
      { k: 'dy' as const, a: 'b', b: 'c', d: 50 },
    ],
  })

  it('solves a fully dimensioned rectangle exactly with no freedom left', () => {
    const r = solve(rectSketch(100))
    expect(r.ok).toBe(true)
    expect(r.dof).toBe(0)
    expect(r.points.c.x).toBeCloseTo(100, 9)
    expect(r.points.c.y).toBeCloseTo(50, 9)
    expect(r.points.d.x).toBeCloseTo(0, 9)
  })

  it('is stable: the same input gives the same answer and a small change moves points a little', () => {
    const a = solve(rectSketch(100))
    const b = solve(rectSketch(100))
    expect(b.points).toEqual(a.points)
    const c = solve(rectSketch(101))
    expect(c.points.b.x - a.points.b.x).toBeCloseTo(1, 9)
    expect(c.points.d).toEqual(expect.objectContaining({ x: expect.closeTo(0, 9), y: expect.closeTo(50, 9) }))
  })

  it('leaves an under-constrained sketch near where it was drawn and reports the freedom', () => {
    const r = solve({ points: [{ id: 'a', x: 0, y: 0, fixed: true }, { id: 'b', x: 30, y: 40 }], constraints: [{ k: 'distance', a: 'a', b: 'b', d: 100 }] })
    expect(r.ok).toBe(true)
    expect(r.dof).toBe(1)
    // pulled straight out along its own direction, not swung round
    expect(r.points.b.x).toBeCloseTo(60, 3)
    expect(r.points.b.y).toBeCloseTo(80, 3)
  })

  it('reports constraints that cannot all hold', () => {
    const r = solve({
      points: [{ id: 'a', x: 0, y: 0, fixed: true }, { id: 'b', x: 10, y: 0 }],
      constraints: [
        { k: 'dx', a: 'a', b: 'b', d: 10 },
        { k: 'distance', a: 'a', b: 'b', d: 5 },
      ],
    })
    expect(r.ok).toBe(false)
    expect(r.failing.length).toBeGreaterThan(0)
  })

  it('cathedral S curve: tangent arcs match the closed-form radius and hold for unequal radii', () => {
    const half = 130
    const s = 40
    const rise = 70
    const c = solveCathedral(half, s, rise)
    expect(c.ok).toBe(true)
    const expected = ((half - s) ** 2 + rise ** 2) / (4 * rise)
    expect(c.r1).toBeCloseTo(expected, 6)
    expect(c.r2).toBeCloseTo(expected, 6)
    const u = solveCathedral(half, s, rise, 2)
    expect(u.ok).toBe(true)
    expect(u.r2 / u.r1).toBeCloseTo(2, 6)
    expect(Math.hypot(u.C2.x - u.C1.x, u.C2.y - u.C1.y)).toBeCloseTo(u.r1 + u.r2, 6)
  })
})

describe('C6 parametric doors', () => {
  it('shaker: field inset by stiles and rails, pocket, Salice cups on face 6, cut-out last', () => {
    const { part, warnings } = buildDoor(spec(), style('ds-shaker'))
    expect(warnings).toEqual([])
    expect([part.length, part.width]).toEqual([700, 400])
    const field = part.entities.find((e) => e.tag === 'door-field')!
    expect(Math.abs(area(entityContours(field)[0]))).toBeCloseTo((700 - 140) * (400 - 140), 6)
    expect(part.ops.map((o) => o.kind)).toEqual(['pocket', 'drill', 'profile'])
    expect(part.ops[0].levels.depth).toBe(6)
    const cups = part.entities.filter((e) => e.tag === 'hinge-cup')
    expect(cups.map((e) => [e.face, e.g.t === 'circle' && e.g.c.x, e.g.t === 'circle' && e.g.c.y, e.g.t === 'circle' && e.g.r * 2, e.depth])).toEqual([
      [6, 100, 379.5, 35, 13.5],
      [6, 600, 379.5, 35, 13.5],
    ])
    const paths = generatePart(part, defaultAppData().machine)
    expect(paths.every((p) => p.moves.length || p.intents.length)).toBe(true)
  })

  it('hinge count follows the cabinet rule and right-hand doors hinge on the other edge', () => {
    expect(hingeCups(400, 1000, 'left', 100)).toHaveLength(3)
    expect(hingeCups(400, 2100, 'left', 100)).toHaveLength(5)
    expect(hingeCups(400, 700, 'right', 100)[0].y).toBe(20.5)
    expect(hingeCups(400, 700, 'none', 100)).toEqual([])
  })

  it('arched and cathedral fields are closed, tangent where they should be, and inside the door', () => {
    for (const kind of ['arched', 'cathedral'] as const) {
      const { contour } = fieldContour(kind, 400, 700, style(kind === 'arched' ? 'ds-arched' : 'ds-cathedral').defaults)
      expect(contour).not.toBeNull()
      const c = contour!
      for (let i = 0; i < c.segs.length; i++) {
        const a = c.segs[i]
        const b = c.segs[(i + 1) % c.segs.length]
        expect(Math.hypot(endOf({ segs: [a], closed: false }).x - startOf({ segs: [b], closed: false }).x, endOf({ segs: [a], closed: false }).y - startOf({ segs: [b], closed: false }).y)).toBeLessThan(1e-6)
      }
      // all arc-to-arc joints are smooth
      for (let i = 0; i + 1 < c.segs.length; i++) {
        const a = c.segs[i]
        const b = c.segs[i + 1]
        if (a.k !== 'A' || b.k !== 'A') continue
        const ta = tangentAt(a, 1)
        const tb = tangentAt(b, 0)
        expect(ta.x * tb.x + ta.y * tb.y).toBeCloseTo(1, 6)
      }
      expect(area(c)).toBeGreaterThan(0)
      const shaker = (700 - 140) * (400 - 140)
      expect(area(c)).toBeLessThan(shaker)
      expect(area(c)).toBeGreaterThan(shaker - 260 * 70)
    }
  })

  it('pulls: a 128 mm pull near the top on the free edge, through holes', () => {
    const { part } = buildDoor(spec({ pull: '128', pullAt: 'top' }), style('ds-slab'))
    const pulls = part.entities.filter((e) => e.tag === 'pull').map((e) => (e.g.t === 'circle' ? e.g.c : null))
    expect(pulls).toEqual([
      { x: 700 - 64 - 128, y: 38 },
      { x: 700 - 64, y: 38 },
    ])
    expect(part.ops.find((o) => o.name === 'Pull holes')?.levels.through).toBe(true)
  })

  it('rebuilds from its variables: a new width moves the hinge cups and the field', () => {
    const { part } = buildDoor(spec(), style('ds-shaker'))
    const wider = { ...part, variables: part.variables.map((v) => (v.name === 'W' ? { ...v, value: 450 } : v)) }
    const re = rebuildDoor(wider, BUILTIN_DOOR_STYLES)!.part
    expect(re.id).toBe(part.id)
    expect(re.width).toBe(450)
    const cup = re.entities.find((e) => e.tag === 'hinge-cup')!
    expect(cup.g.t === 'circle' && cup.g.c.y).toBe(450 - 20.5)
  })

  it('door list CSV in inches with fractions, styles by name, variable columns and row errors', () => {
    const data = defaultAppData()
    const csv = ['Name,Qty,Width,Height,Style,Material,Hinge,Pull,Rail', 'Base L,2,15 1/2,30,Shaker 70,MDF18,left,128,3', 'Wall R,1,12,"36",arched,MDF18,right,knob,', 'Bad,1,wide,30,shaker,,,,', 'Odd,1,12,30,roman,,,,'].join('\n')
    const r = parseDoorCsv(csv, { units: 'in', styles: BUILTIN_DOOR_STYLES, materials: data.library.materials })
    expect(r.specs).toHaveLength(2)
    expect(r.specs[0]).toMatchObject({ name: 'Base L', qty: 2, width: 393.7, height: 762, styleId: 'ds-shaker', materialId: 'mat-mdf18', hinge: 'left', pull: '128', values: { rail: 76.2 } })
    expect(r.specs[1]).toMatchObject({ styleId: 'ds-arched', hinge: 'right', pull: 'knob' })
    expect(r.errors.map((e) => e.row)).toEqual([4, 5])
  })

  it('doors in a job nest with cabinets and write cups in the turned-over program', () => {
    const data: AppData = defaultAppData()
    data.settings.features = { camMprOutput: true }
    const d1 = buildDoor(spec({ name: 'Base door', qty: 2 }), style('ds-shaker')).part
    const d2 = buildDoor(spec({ name: 'Cathedral door', styleId: 'ds-cathedral', height: 760 }), style('ds-cathedral')).part
    const job: Job = { id: 'j', number: 'J77', name: 'Doors', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [d1, d2] }
    data.jobs = [job]
    const out = runJob(job, data)
    expect(out.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(out.instances).toHaveLength(3)
    const files = mprFiles(job, data, out)
    expect(files.map((f) => f.name)).toEqual(['J77_S01_MDF18.mpr', 'J77_Base-door_B.mpr', 'J77_Cathedral-door_B.mpr'])
    for (const f of files) expect(readMpr(f.text).errors).toEqual([])
    const cups = readMpr(files[1].text).macros.filter((m) => m.id === 102)
    expect(cups.map((m) => Number(m.values.DU))).toEqual([35, 35])
  })
})
