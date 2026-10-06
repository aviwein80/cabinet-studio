import { areaPaths, difference, EndType, FillRule, inflatePaths, intersect, JoinType } from 'clipper2-ts'
import { describe, expect, it } from 'vitest'
import type { PartInstance } from '../src/core/cutlist'
import type { Contour, SheetProgram } from '../src/core/machining'
import { writeSheetMpr } from '../src/core/mpr/writer'
import { nestUnconfirmed } from '../src/core/nestConfirm'
import type { NestedSheet, Placement } from '../src/core/nesting'
import { runJob } from '../src/core/pipeline'
import { sampleJob } from '../src/core/sample'
import { bridgePlan } from '../src/core/sheetCuts'
import type { AppData } from '../src/core/types'
import { validateJob } from '../src/core/validator'
import { data } from './helpers'

const D = 12
const rect = (l: number, w: number) => [
  { x: 0, y: 0 },
  { x: l, y: 0 },
  { x: l, y: w },
  { x: 0, y: w },
]
const inst = (uid: string, l: number, w: number) => ({ uid, no: Number(uid.replace(/\D/g, '')), cutLength: l, cutWidth: w, outline: rect(l, w) }) as unknown as PartInstance
const pl = (uid: string, x: number, y: number, dx: number, dy: number): Placement => ({ uid, x, y, dx, dy, rotated: false })
const sheetOf = (placements: Placement[]): NestedSheet => ({ index: 1, materialId: 'm', sheetLength: 2440, sheetWidth: 1220, thickness: 18, utilization: 0, placements })
const opts = { diameter: D, width: 6, maxLength: 20, maxArea: 100_000 }
const mapOf = (ps: Placement[]) => new Map(ps.map((p) => [p.uid, inst(p.uid, p.dx, p.dy)]))
const polyArea = (q: { x: number; y: number }[]) => Math.abs(q.reduce((s, p, i) => s + p.x * q[(i + 1) % q.length].y - q[(i + 1) % q.length].x * p.y, 0) / 2)

describe('bridged nesting plan (NST-05)', () => {
  it('three small parts in a row, 14 mm apart: two bridges, one path round all (by hand)', () => {
    const ps = [pl('p1', 10, 10, 300, 200), pl('p2', 324, 10, 300, 200), pl('p3', 638, 10, 300, 200)]
    const plan = bridgePlan(sheetOf(ps), mapOf(ps), opts)
    expect(plan.clusters).toHaveLength(1)
    const c = plan.clusters[0]
    expect(c.members).toEqual(['p1', 'p2', 'p3'])
    expect(c.bridges).toEqual([
      { a: 'p1', b: 'p2', x0: 310, y0: 107, x1: 324, y1: 113 },
      { a: 'p2', b: 'p3', x0: 624, y0: 107, x1: 638, y1: 113 },
    ])
    expect(c.holes).toEqual([])
    expect(polyArea(c.outer)).toBeCloseTo(3 * 60_000 + 2 * 14 * 6, 6)
  })

  it('longest bridge, large parts and parts too close to a bridge are respected', () => {
    // 25 mm apart: longer than the 20 mm limit
    const far = [pl('p1', 10, 10, 300, 200), pl('p2', 335, 10, 300, 200)]
    expect(bridgePlan(sheetOf(far), mapOf(far), opts)).toEqual({ clusters: [], alone: ['p1', 'p2'] })
    // 0.12 m² parts are over the 0.1 m² limit
    const big = [pl('p1', 10, 10, 600, 200), pl('p2', 624, 10, 600, 200)]
    expect(bridgePlan(sheetOf(big), mapOf(big), opts).clusters).toEqual([])
    // a third part 7 mm from where the bridge would go: no bridge (the tool could not pass)
    const tight = [pl('p1', 10, 10, 300, 100), pl('p2', 324, 10, 300, 100), pl('p3', 312, 70, 10, 30)]
    const t = bridgePlan(sheetOf(tight), mapOf(tight), opts)
    expect(t.clusters.flatMap((c) => c.bridges).some((b) => (b.a === 'p1' && b.b === 'p2') || (b.a === 'p2' && b.b === 'p1'))).toBe(false)
  })

  it('a 2 x 2 block links as a tree: three bridges, no waste boxed in', () => {
    const ps = [pl('p1', 10, 10, 200, 200), pl('p2', 224, 10, 200, 200), pl('p3', 10, 224, 200, 200), pl('p4', 224, 224, 200, 200)]
    const plan = bridgePlan(sheetOf(ps), mapOf(ps), opts)
    expect(plan.clusters).toHaveLength(1)
    expect(plan.clusters[0].bridges).toHaveLength(3)
    expect(plan.clusters[0].holes).toEqual([])
  })
})

const withBridges = (d: AppData, write: boolean, skin = 0) => {
  d.settings.nesting.bridges = true
  d.settings.nesting.onionSkin = skin
  d.settings.features = { ...d.settings.features, nestBridgeOutput: write }
}
const j = { ...sampleJob(), id: 'j', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }

/** Independent check: the band the tool sweeps outside a compensated path (one diameter wide) meets no part. */
function sweptHits(c: Contour, sheet: NestedSheet) {
  const K = 1000
  const ring = c.points.slice(0, -1).map((p) => ({ x: Math.round(p.x * K), y: Math.round(p.y * K) }))
  const swept = c.hole ? difference([ring], inflatePaths([ring], -D * K, JoinType.Round, EndType.Polygon), FillRule.NonZero) : difference(inflatePaths([ring], D * K, JoinType.Round, EndType.Polygon), [ring], FillRule.NonZero)
  let hit = 0
  for (const p of sheet.placements) {
    const box = [
      { x: p.x * K, y: p.y * K },
      { x: (p.x + p.dx) * K, y: p.y * K },
      { x: (p.x + p.dx) * K, y: (p.y + p.dy) * K },
      { x: p.x * K, y: (p.y + p.dy) * K },
    ].map((q) => ({ x: Math.round(q.x), y: Math.round(q.y) }))
    hit = Math.max(hit, areaPaths(intersect(swept, [box], FillRule.NonZero)) / (K * K))
  }
  return hit
}

describe('bridged groups in the sheet programs', () => {
  it('switch on: each group one path, members lose their own cut-outs, nothing cut into a part', () => {
    const d = data((x) => withBridges(x, true))
    const off = runJob(j, data((x) => withBridges(x, false)))
    const out = runJob(j, d)
    const groups = out.programs.flatMap((p) => p.bridges?.plan.clusters ?? [])
    expect(groups.length).toBeGreaterThan(0)
    let paths = 0
    for (const p of out.programs) {
      if (!p.bridges) continue
      const groupOps = p.ops.filter((o): o is Contour => o.kind === 'contour' && !!o.bridged)
      paths += groupOps.length
      for (const cl of p.bridges.plan.clusters) {
        // no member keeps its own cut-out
        expect(p.ops.some((o) => o.kind === 'contour' && !o.bridged && cl.members.includes(o.partUid))).toBe(false)
        for (const b of cl.bridges) expect(Math.max(b.x1 - b.x0, b.y1 - b.y0)).toBeLessThanOrEqual(20 + 1e-9)
      }
      for (const c of groupOps) expect(sweptHits(c, p.sheet)).toBeLessThan(1e-6)
    }
    const linked = groups.reduce((n, g) => n + g.members.length, 0)
    // fewer separate paths (and tool entries) than parts linked
    expect(paths).toBeLessThan(linked)
    expect(out.issues.filter((i) => i.code.startsWith('BRIDGE_'))).toEqual([])
    expect(out.issues.filter((i) => i.severity === 'error').map((i) => i.code)).toEqual(off.issues.filter((i) => i.severity === 'error').map((i) => i.code))
    const text = writeSheetMpr(out.programs.find((p) => p.bridges)!, { job: j, machine: d.machine, mprNumber: 1, mprCount: 1 })
    expect(text).toMatch(/bridged group of \d+/)
    expect(text).toMatch(/break them off after cutting/)
    console.log(`[bridges] sample kitchen: ${linked} small parts in ${groups.length} groups, ${groups.reduce((n, g) => n + g.bridges.length, 0)} bridges, ${paths} paths`)
  })

  it('with an onion skin: the group is cut to the skin first and through at the end of the sheet', () => {
    const out = runJob(j, data((x) => withBridges(x, true, 0.4)))
    const p = out.programs.find((q) => q.bridges)!
    const group = p.ops.filter((o): o is Contour => o.kind === 'contour' && !!o.bridged)
    const first = group.filter((o) => !o.skin)
    const last = group.filter((o) => o.skin)
    expect(first.length).toBe(last.length)
    for (const o of first) expect(o.za).toBe(0.4)
    for (const o of last) expect(o.za).toBeLessThan(0)
    // the final passes come after every other cut-out
    const lastIdx = Math.min(...last.map((o) => p.ops.indexOf(o)))
    expect(p.ops.slice(lastIdx).every((o) => o.kind === 'contour' && o.skin)).toBe(true)
  })

  it('switch off (default): groups shown, programs unchanged', () => {
    const a = runJob(j, data())
    const b = runJob(j, data((x) => withBridges(x, false)))
    expect(b.programs.map((p) => p.ops)).toEqual(a.programs.map((p) => p.ops))
    expect(b.programs.some((p) => p.bridges && !p.bridges.written)).toBe(true)
    expect(b.issues.find((i) => i.code === 'BRIDGES')!.message).toMatch(/Not written/)
  })

  it('the export checker catches a path into a part, a long bridge and a wrong outline', () => {
    const d = data((x) => withBridges(x, true))
    const out = runJob(j, d)
    const p = out.programs.find((q) => q.bridges)!
    const k = p.ops.findIndex((o) => o.kind === 'contour' && !!o.bridged)
    const c = p.ops[k] as Contour
    const moved: SheetProgram = { ...p, ops: p.ops.map((o, i) => (i === k ? { ...c, points: c.points.map((q) => ({ x: q.x + 40, y: q.y })) } : o)) }
    const codes = (prog: SheetProgram) => validateJob([prog], out.nest, out.instances, d.library, d.machine, d.settings).map((i) => i.code)
    expect(codes(moved)).toContain('BRIDGE_GOUGE')
    const o = c.points[0]
    const shrunk: SheetProgram = { ...p, ops: p.ops.map((q, i) => (i === k ? { ...c, points: c.points.map((v) => ({ x: o.x + (v.x - o.x) * 0.9, y: o.y + (v.y - o.y) * 0.9 })) } : q)) }
    expect(codes(shrunk)).toContain('BRIDGE_SHAPE')
    const strict: SheetProgram = { ...p, bridges: { ...p.bridges!, maxLength: 10 } }
    expect(codes(strict)).toContain('BRIDGE_LONG')
  })

  it('bridge values carry Configure badges while bridges are on', () => {
    const d = data()
    withBridges(d, false)
    expect(nestUnconfirmed(d.settings, d.machine).map((u) => [u.key, u.value])).toEqual([
      ['nest:bridgeWidth', '6 mm'],
      ['nest:bridgeMaxLength', '20 mm'],
      ['nest:bridgeMaxArea', '0.10 m²'],
    ])
  })
})
