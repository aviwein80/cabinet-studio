import { describe, expect, it } from 'vitest'
import { confirmKey } from '../src/core/confirm'
import type { PartInstance } from '../src/core/cutlist'
import type { Contour } from '../src/core/machining'
import { writeSheetMpr } from '../src/core/mpr/writer'
import { nestUnconfirmed } from '../src/core/nestConfirm'
import type { NestedSheet, Placement } from '../src/core/nesting'
import { runJob } from '../src/core/pipeline'
import { sampleJob } from '../src/core/sample'
import { programCutLength, sharedLinePlan } from '../src/core/sheetCuts'
import type { AppData, Job } from '../src/core/types'
import { validateJob } from '../src/core/validator'
import { cabinet, data, job } from './helpers'

const D = 12
const r = D / 2
const rect = (l: number, w: number) => [
  { x: 0, y: 0 },
  { x: l, y: 0 },
  { x: l, y: w },
  { x: 0, y: w },
]
const inst = (uid: string, l: number, w: number, extra: Partial<PartInstance> = {}) => ({ uid, no: Number(uid.replace(/\D/g, '')) || 1, cutLength: l, cutWidth: w, outline: rect(l, w), ...extra }) as unknown as PartInstance
const sheetOf = (placements: Placement[]): NestedSheet => ({ index: 1, materialId: 'm', sheetLength: 2440, sheetWidth: 1220, thickness: 18, utilization: 0, placements })
const pl = (uid: string, x: number, y: number, dx: number, dy: number): Placement => ({ uid, x, y, dx, dy, rotated: false })
const opts = { diameter: D, minArea: 50_000, minSide: 120, clockwise: true }

/** Independent check: sample every path every 0.5 mm; distance to every part rectangle. */
function closest(paths: { pts: { x: number; y: number }[] }[], placements: Placement[]) {
  let best = Infinity
  for (const p of paths)
    for (let i = 1; i < p.pts.length; i++) {
      const a = p.pts[i - 1]
      const b = p.pts[i]
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.5))
      for (let k = 0; k <= n; k++) {
        const x = a.x + ((b.x - a.x) * k) / n
        const y = a.y + ((b.y - a.y) * k) / n
        for (const q of placements) {
          const dx = Math.max(q.x - x, 0, x - (q.x + q.dx))
          const dy = Math.max(q.y - y, 0, y - (q.y + q.dy))
          best = Math.min(best, Math.hypot(dx, dy))
        }
      }
    }
  return best
}

/** Independent check: every 0.5 mm along a part's tool-centre rectangle lies on some path. */
function uncovered(q: Placement, paths: { pts: { x: number; y: number }[] }[]) {
  const on = (x: number, y: number) =>
    paths.some((p) =>
      p.pts.some((b, i) => {
        if (!i) return false
        const a = p.pts[i - 1]
        const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)
        const within = x >= Math.min(a.x, b.x) - 1e-6 && x <= Math.max(a.x, b.x) + 1e-6 && y >= Math.min(a.y, b.y) - 1e-6 && y <= Math.max(a.y, b.y) + 1e-6
        return Math.abs(cross) < 1e-6 && within
      }),
    )
  const x0 = q.x - r
  const x1 = q.x + q.dx + r
  const y0 = q.y - r
  const y1 = q.y + q.dy + r
  let miss = 0
  for (let t = 0; t <= 1; t += 1 / 400) {
    const pts = [
      [x0 + (x1 - x0) * t, y0],
      [x0 + (x1 - x0) * t, y1],
      [x0, y0 + (y1 - y0) * t],
      [x1, y0 + (y1 - y0) * t],
    ]
    for (const [x, y] of pts) if (!on(x, y)) miss++
  }
  return miss
}

describe('shared-line plan (NST-04)', () => {
  it('two neighbours one tool diameter apart: the line between them is cut once (by hand)', () => {
    const a = pl('p1', 10, 10, 500, 300)
    const b = pl('p2', 10 + 500 + D, 10, 500, 300)
    const plan = sharedLinePlan(sheetOf([a, b]), new Map([['p1', inst('p1', 500, 300)], ['p2', inst('p2', 500, 300)]]), opts)
    expect(plan.parts).toEqual(['p1', 'p2'])
    expect(plan.paths).toHaveLength(2)
    // A: a closed loop round its tool-centre rectangle, 2 x (512 + 312)
    expect(plan.paths[0]).toMatchObject({ closed: true, partUid: 'p1', shared: ['p2'] })
    expect(plan.paths[0].pts[0]).toEqual(plan.paths[0].pts.at(-1))
    // B: its left side was cut with A; the rest is one open path of three sides, 512 + 312 + 512
    expect(plan.paths[1]).toMatchObject({ closed: false, partUid: 'p2' })
    expect(plan.planLength).toBeCloseTo(1648 + 1336, 9)
    expect(plan.separateLength).toBeCloseTo(2 * (1600 + Math.PI * D), 9)
    expect(closest(plan.paths, [a, b])).toBeCloseTo(r, 9)
    expect(uncovered(a, plan.paths) + uncovered(b, plan.paths)).toBe(0)
  })

  it('a 3 x 2 grid: shared lines joined into straight cuts, every edge cut, nothing closer than the radius', () => {
    const ps: Placement[] = []
    const map = new Map<string, PartInstance>()
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 2; j++) {
        const uid = `p${i * 2 + j + 1}`
        ps.push(pl(uid, 10 + i * (600 + D), 10 + j * (400 + D), 600, 400))
        map.set(uid, inst(uid, 600, 400))
      }
    const plan = sharedLinePlan(sheetOf(ps), map, opts)
    expect(closest(plan.paths, ps)).toBeCloseTo(r, 9)
    for (const q of ps) expect(uncovered(q, plan.paths)).toBe(0)
    // the grid's lines: 3 horizontal of 3 x 600 + 2 gaps + 2 radii = 3 x 612, and 4 vertical of 2 x 412
    expect(plan.planLength).toBeCloseTo(3 * (3 * 612) + 4 * (2 * 412), 6)
    expect(1 - plan.planLength / plan.separateLength).toBeCloseTo(1 - 8804 / (6 * (2000 + Math.PI * D)), 9)
  })

  it('hold-down: small, onion-skinned, shaped, custom and cut-out parts keep their own cut-out', () => {
    const map = new Map<string, PartInstance>([
      ['p1', inst('p1', 800, 400)],
      ['p2', inst('p2', 200, 200)], // 0.04 m²: under 0.05
      ['p3', inst('p3', 900, 100)], // narrower than 120
      ['p4', inst('p4', 500, 500, { outline: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 0, y: 500 }] })],
      ['p5', inst('p5', 500, 500, { cam: {} as PartInstance['cam'] })],
      ['p6', inst('p6', 600, 600)],
    ])
    const sheet = sheetOf([pl('p1', 10, 10, 800, 400), pl('p2', 1000, 10, 200, 200), pl('p3', 10, 600, 900, 100), pl('p4', 1300, 10, 500, 500), pl('p5', 1300, 600, 500, 500), pl('p6', 10, 800, 600, 600)])
    const plan = sharedLinePlan(sheet, map, { ...opts, skinned: new Set(['p6']) })
    expect(plan.parts).toEqual(['p1'])
    expect(Object.fromEntries(plan.own.map((o) => [o.uid, o.why]))).toEqual({ p2: 'small', p3: 'small', p4: 'shaped', p5: 'custom', p6: 'skin' })
  })
})

const withShared = (d: AppData, write: boolean) => {
  d.settings.nesting.sharedLines = true
  d.settings.features = { ...d.settings.features, nestSharedOutput: write }
}
const fix = (j: Job) => ({ ...j, id: 'j', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })

describe('shared-line cutting on rectangle-heavy reference jobs (acceptance)', () => {
  const jobs: [string, Job][] = [
    ['sample kitchen', fix(sampleJob())],
    [
      'eight base and wall cabinets',
      job(
        Array.from({ length: 8 }, (_, i) => cabinet(i % 2 ? 'tpl-wall-2door' : 'tpl-base-2door', () => {}, `c${i}`, `C${i + 1}`)),
        'REF8',
      ),
    ],
  ]
  for (const [name, j] of jobs)
    it(`${name}: measured cut length at least 15 % shorter, part sizes and places unchanged, checks clean`, () => {
      const off = data((d) => withShared(d, false))
      const on = data((d) => withShared(d, true))
      const a = runJob(j, off)
      const b = runJob(j, on)
      // same nest, same parts: only the cutting changes
      expect(b.nest.spacing).toBe(D)
      expect(b.nest.sheets.map((s) => s.placements)).toEqual(a.nest.sheets.map((s) => s.placements))
      expect(b.instances.map((i) => [i.uid, i.cutLength, i.cutWidth])).toEqual(a.instances.map((i) => [i.uid, i.cutLength, i.cutWidth]))
      const lenA = a.programs.reduce((s, p) => s + programCutLength(p.ops), 0)
      const lenB = b.programs.reduce((s, p) => s + programCutLength(p.ops), 0)
      const saving = 1 - lenB / lenA
      console.log(`[shared lines] ${name}: ${(lenA / 1000).toFixed(2)} m -> ${(lenB / 1000).toFixed(2)} m of cut-out, ${(saving * 100).toFixed(1)} % less (${b.programs.length} sheets)`)
      expect(saving).toBeGreaterThanOrEqual(0.15)
      // independent: no tool-centre path closer than the radius to any part, every planned edge cut
      for (const p of b.programs) {
        const centre = p.ops.filter((o): o is Contour => o.kind === 'contour' && !!o.centre).map((o) => ({ pts: o.points }))
        expect(centre.length > 0).toBe((p.shared?.plan.parts.length ?? 0) > 0)
        expect(closest(centre, p.sheet.placements)).toBeGreaterThanOrEqual(r - 1e-6)
        for (const uid of p.shared?.plan.parts ?? []) expect(uncovered(p.sheet.placements.find((q) => q.uid === uid)!, centre)).toBe(0)
      }
      const codes = (o: typeof a) => o.issues.filter((i) => i.severity === 'error').map((i) => i.code)
      expect(codes(b)).toEqual(codes(a))
      expect(b.issues.some((i) => i.code.startsWith('SHARED_') && i.severity === 'error')).toBe(false)
    })
})

describe('shared-line output', () => {
  const j = fix(sampleJob())
  it('switch off (default): plan shown and measured, programs keep separate cut-outs', () => {
    const out = runJob(j, data((d) => withShared(d, false)))
    for (const p of out.programs) {
      expect(p.shared?.written).toBe(false)
      expect(p.ops.some((o) => o.kind === 'contour' && o.centre)).toBe(false)
    }
    const info = out.issues.filter((i) => i.code === 'SHARED_LINES')
    expect(info.length).toBe(out.programs.length)
    expect(info[0].message).toMatch(/Not written/)
  })

  it('switch on: tool-centre contours without radius compensation in the MPR', () => {
    const d = data((x) => withShared(x, true))
    const out = runJob(j, d)
    const text = writeSheetMpr(out.programs[0], { job: j, machine: d.machine, mprNumber: 1, mprCount: out.programs.length })
    expect(text).toMatch(/RK="NOWRK"/)
    expect(text).toMatch(/shared cut/)
    expect(text).toMatch(/Shared-line cutting: \d+ parts/)
  })

  it('off entirely: nest and programs as before', () => {
    const a = runJob(j, data())
    const b = runJob(j, data((x) => (x.settings.features = { ...x.settings.features, nestSharedOutput: true })))
    expect(b.nest).toEqual(a.nest)
    expect(b.programs.map((p) => p.ops)).toEqual(a.programs.map((p) => p.ops))
    expect(a.programs.some((p) => p.shared)).toBe(false)
  })

  it('the export checker catches a path into a part and an edge left uncut', () => {
    const d = data((x) => withShared(x, true))
    const out = runJob(j, d)
    const prog = out.programs.find((p) => (p.shared?.plan.paths.length ?? 0) > 1)!
    const k = prog.ops.findIndex((o) => o.kind === 'contour' && o.centre)
    const c = prog.ops[k] as Contour
    // move the path 3 mm towards the parts
    const moved = { ...c, points: c.points.map((q) => ({ x: q.x + 3, y: q.y + 3 })) }
    const bad = { ...prog, ops: prog.ops.map((o, i) => (i === k ? moved : o)) }
    const issues = validateJob([bad], out.nest, out.instances, d.library, d.machine, d.settings)
    expect(issues.some((i) => i.code === 'SHARED_GOUGE')).toBe(true)
    const gone = { ...prog, ops: prog.ops.filter((_, i) => i !== k) }
    const issues2 = validateJob([gone], out.nest, out.instances, d.library, d.machine, d.settings)
    expect(issues2.some((i) => i.code === 'SHARED_UNCUT')).toBe(true)
  })
})

describe('shared-line settings: Configure badges', () => {
  it('listed while shared lines are on and not confirmed; a typed value or confirming clears it', () => {
    const d = data()
    expect(nestUnconfirmed(d.settings, d.machine)).toEqual([])
    withShared(d, false)
    const u = nestUnconfirmed(d.settings, d.machine)
    expect(u.map((x) => x.key)).toEqual(['nest:sharedSmall'])
    expect(u[0].value).toBe('0.05 m², 120 mm side')
    confirmKey(d.machine, 'nest:sharedSmall')
    expect(nestUnconfirmed(d.settings, d.machine)).toEqual([])
    // confirming never switches the output on
    expect(d.settings.features?.nestSharedOutput).toBe(false)
  })

  it('changing the limit changes the plan at once (no stale result)', () => {
    const j = fix(sampleJob())
    const d = data((x) => withShared(x, false))
    const before = runJob(j, d).programs.reduce((n, p) => n + (p.shared?.plan.parts.length ?? 0), 0)
    d.settings.nesting.sharedMinArea = 0
    d.settings.nesting.sharedMinSide = 0
    const after = runJob(j, d).programs.reduce((n, p) => n + (p.shared?.plan.parts.length ?? 0), 0)
    expect(after).toBeGreaterThan(before)
  })
})
