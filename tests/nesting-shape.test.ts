import { describe, expect, it } from 'vitest'
import { makeEntity, newPart } from '@/cam/doc'
import { circle, polyline, pt, rect } from '@/cam/geom'
import { defaultOp } from '@/cam/ops'
import type { CamOp, CamPart } from '@/cam/types'
import { defaultAppData } from '@/core/defaults'
import { placementTransform } from '@/core/machining'
import { orient } from '@/core/nestShape'
import { nestMaterial, orderForCutting, remnantsOf, type NestOptions, type NestPart } from '@/core/nesting'
import { mprFiles, runJob } from '@/core/pipeline'
import { updateOffcutStock } from '@/core/offcuts'
import type { AppData, Job } from '@/core/types'
import { cabinet, job, data } from './helpers'
import { sampleJob } from '../src/core/sample'

const OPT: NestOptions = { sheetLength: 3658, sheetWidth: 1524, edgeTrim: 10, spacing: 14, allowRotation: true }

const tri = (uid: string, L: number, W: number, extra: Partial<NestPart> = {}): NestPart => ({
  uid,
  length: L,
  width: W,
  canRotate: true,
  outline: [
    { x: 0, y: 0 },
    { x: L, y: 0 },
    { x: 0, y: W },
  ],
  shape: `tri${L}x${W}`,
  ...extra,
})

const rectPart = (uid: string, L: number, W: number, extra: Partial<NestPart> = {}): NestPart => ({ uid, length: L, width: W, canRotate: true, ...extra })

/** Exact polygon test: no two placed outlines come closer than the spacing (sampled). */
function minGap(res: ReturnType<typeof nestMaterial>, parts: NestPart[]) {
  const byUid = new Map(parts.map((p) => [p.uid, p]))
  let gap = Infinity
  for (const sh of res.sheets) {
    const polys = sh.placements.map((pl) => {
      const p = byUid.get(pl.uid)!
      const { pt: tp } = placementTransform({ cutLength: p.length, cutWidth: p.width }, pl)
      const o = p.outline ?? [
        { x: 0, y: 0 },
        { x: p.length, y: 0 },
        { x: p.length, y: p.width },
        { x: 0, y: p.width },
      ]
      return o.map((q) => tp(q.x, q.y))
    })
    const segs = (poly: { x: number; y: number }[]) => poly.map((a, i) => [a, poly[(i + 1) % poly.length]] as const)
    const dPS = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)))
      return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
    }
    for (let i = 0; i < polys.length; i++)
      for (let j = i + 1; j < polys.length; j++) {
        for (const p of polys[i]) for (const [a, b] of segs(polys[j])) gap = Math.min(gap, dPS(p, a, b))
        for (const p of polys[j]) for (const [a, b] of segs(polys[i])) gap = Math.min(gap, dPS(p, a, b))
      }
    for (const poly of polys)
      for (const q of poly) {
        expect(q.x).toBeGreaterThanOrEqual(OPT.edgeTrim - 1e-6)
        expect(q.y).toBeGreaterThanOrEqual(OPT.edgeTrim - 1e-6)
        expect(q.x).toBeLessThanOrEqual(sh.sheetLength - OPT.edgeTrim + 1e-6)
        expect(q.y).toBeLessThanOrEqual(sh.sheetWidth - OPT.edgeTrim + 1e-6)
      }
  }
  return gap
}

describe('C7 true-shape nesting', () => {
  it('interlocks triangles that the rectangular engine has to box', () => {
    const parts = Array.from({ length: 10 }, (_, i) => tri(`t${i}`, 1100, 700))
    const rectRes = nestMaterial(parts, { ...OPT, engine: 'rect' })
    const shapeRes = nestMaterial(parts, { ...OPT, engine: 'shape' })
    expect(rectRes.sheets.length).toBe(2)
    expect(shapeRes.sheets.length).toBe(1)
    expect(shapeRes.engine).toBe('shape')
    expect(shapeRes.sheets[0].placements.some((p) => p.flip)).toBe(true)
    expect(minGap(shapeRes, parts)).toBeGreaterThanOrEqual(OPT.spacing - 0.01)
    const auto = nestMaterial(parts, { ...OPT, engine: 'auto' })
    expect(auto.sheets.length).toBe(1)
  })

  it('keeps grain-locked parts along the grain (only half turns)', () => {
    const parts = Array.from({ length: 10 }, (_, i) => tri(`g${i}`, 900, 500, { canRotate: false }))
    const res = nestMaterial(parts, { ...OPT, engine: 'shape' })
    for (const sh of res.sheets) for (const p of sh.placements) expect(p.rotated).toBe(false)
    expect(res.sheets[0].placements.some((p) => p.flip)).toBe(true)
    expect(minGap(res, parts)).toBeGreaterThanOrEqual(OPT.spacing - 0.01)
  })

  it('puts higher-priority parts on the first sheet', () => {
    const parts = [
      ...Array.from({ length: 8 }, (_, i) => rectPart(`low${i}`, 1200, 700)),
      ...Array.from({ length: 4 }, (_, i) => rectPart(`hi${i}`, 1200, 700, { priority: 5 })),
    ]
    for (const engine of ['rect', 'shape'] as const) {
      const res = nestMaterial(parts, { ...OPT, engine })
      expect(res.sheets.length).toBe(2)
      expect(res.sheets[0].placements.filter((p) => p.uid.startsWith('hi')).length).toBe(4)
    }
  })

  it('keeps kits on one sheet when asked', () => {
    // Sheet 1 fills with A parts; kit K (3 parts) would otherwise straddle sheets.
    const parts = [
      ...Array.from({ length: 5 }, (_, i) => rectPart(`a${i}`, 1150, 720, { kit: 'A' })),
      ...Array.from({ length: 3 }, (_, i) => rectPart(`k${i}`, 1150, 720, { kit: 'K' })),
    ]
    const loose = nestMaterial(parts, { ...OPT, engine: 'shape' })
    expect(loose.splitKits.length).toBeGreaterThan(0)
    const kept = nestMaterial(parts, { ...OPT, engine: 'auto', keepKits: true })
    expect(kept.splitKits).toEqual([])
    const sheetOf = (uid: string) => kept.sheets.findIndex((s) => s.placements.some((p) => p.uid === uid))
    expect(new Set(['k0', 'k1', 'k2'].map(sheetOf)).size).toBe(1)
    expect(new Set(['a0', 'a1', 'a2', 'a3', 'a4'].map(sheetOf)).size).toBe(1)
  })

  it('nests small parts inside openings and cuts them first', () => {
    const frame: NestPart = {
      uid: 'frame',
      length: 900,
      width: 900,
      canRotate: true,
      outline: [
        { x: 0, y: 0 },
        { x: 900, y: 0 },
        { x: 900, y: 900 },
        { x: 0, y: 900 },
      ],
      holes: [
        [
          { x: 100, y: 100 },
          { x: 800, y: 100 },
          { x: 800, y: 800 },
          { x: 100, y: 800 },
        ],
      ],
    }
    const smalls = Array.from({ length: 4 }, (_, i) => rectPart(`s${i}`, 300, 300))
    const res = nestMaterial([frame, ...smalls], { ...OPT, sheetLength: 1000, sheetWidth: 1000, engine: 'shape' })
    expect(res.sheets.length).toBe(1)
    const pls = res.sheets[0].placements
    expect(pls.filter((p) => p.inside === 'frame').length).toBe(4)
    expect(pls[pls.length - 1].uid).toBe('frame')
    expect(orderForCutting(pls).map((p) => p.uid).indexOf('frame')).toBe(4)
  })

  it('reports vertical and horizontal offcuts and fills stock offcuts first', () => {
    const parts = Array.from({ length: 3 }, (_, i) => rectPart(`p${i}`, 700, 1400))
    const res = nestMaterial(parts, { ...OPT, engine: 'rect', offcutType: 'both' })
    const r = res.sheets[0].remnants!
    expect(r[0].dir).toBe('vertical')
    expect(r[0].length).toBeCloseTo(3658 - (10 + 3 * 700 + 2 * 14 + 14), 1)
    expect(r[0].width).toBe(1524)
    expect(remnantsOf({ length: 3658, width: 1524 }, [{ uid: 'x', x: 10, y: 10, dx: 3600, dy: 1400, rotated: false }], { spacing: 14 })).toEqual([])
    const withStock = nestMaterial([...parts, rectPart('small', 500, 400)], { ...OPT, engine: 'auto', offcuts: [{ id: 'oc1', length: 800, width: 600 }] })
    const oc = withStock.sheets.find((s) => s.offcutId === 'oc1')!
    expect(oc.sheetLength).toBe(800)
    expect(oc.placements.map((p) => p.uid)).toEqual(['small'])
  })

  it('orients half turns the same way as the sheet transform', () => {
    const inst = { cutLength: 500, cutWidth: 300 }
    for (const o of [0, 90, 180, 270] as const) {
      const pl = { x: 0, y: 0, rotated: o % 180 === 90, flip: o >= 180 }
      const { pt: tp } = placementTransform(inst, pl)
      for (const q of [pt(0, 0), pt(500, 0), pt(120, 260)]) expect(tp(q.x, q.y)).toEqual(orient(q, 500, 300, o))
    }
    const { dir, angle } = placementTransform(inst, { x: 0, y: 0, rotated: false, flip: true })
    expect(dir('XP')).toBe('XM')
    expect(dir('YM')).toBe('YP')
    expect(angle).toBe(180)
  })
})

// ---------------------------------------------------------------------------------------------
// Job level: custom parts with openings, labels, onion skin, yield against the reference engine
// ---------------------------------------------------------------------------------------------

function framePart(): CamPart {
  const part = newPart({ name: 'Mirror frame', length: 900, width: 700, thickness: 18, materialId: 'mat-mdf18', qty: 1, entities: [] })
  const outline = makeEntity({ t: 'contour', c: rect(0, 0, 900, 700) }, 'outline')
  const opening = makeEntity({ t: 'contour', c: rect(120, 120, 660, 460) }, 'machining')
  part.entities = [outline, opening]
  part.outlineId = outline.id
  const lv = { safeZ: 20, rapidZ: 3, depth: 18, through: true, stockZ: 0, passDepth: 0 }
  part.ops = [{ ...defaultOp('profile', [opening.id]), side: 'inside', levels: lv } as CamOp, { ...defaultOp('profile', [outline.id]), side: 'outside', levels: lv } as CamOp]
  return part
}

function discPart(qty: number): CamPart {
  const part = newPart({ name: 'Disc', length: 240, width: 240, thickness: 18, materialId: 'mat-mdf18', qty, entities: [] })
  const outline = makeEntity({ t: 'circle', c: pt(120, 120), r: 120 }, 'outline')
  part.entities = [outline]
  part.outlineId = outline.id
  part.ops = [{ ...defaultOp('profile', [outline.id]), side: 'outside', levels: { safeZ: 20, rapidZ: 3, depth: 18, through: true, stockZ: 0, passDepth: 0 } } as CamOp]
  return part
}

function shapeData(patch: (d: AppData) => void = () => {}) {
  return data((d) => {
    d.settings.features = { camMprOutput: true }
    d.settings.nesting.engine = 'shape'
    patch(d)
  })
}

describe('C7 job nesting with custom parts', () => {
  const j: Job = { ...job([], 'J7'), camParts: [framePart(), discPart(4)] }

  it('nests discs in the frame opening, cuts them before the opening frees the slug', () => {
    const d = shapeData()
    const out = runJob(j, d)
    expect(out.nest.sheets.length).toBe(1)
    const sh = out.nest.sheets[0]
    const frameUid = out.instances.find((i) => i.cam?.name === 'Mirror frame')!.uid
    const inner = sh.placements.filter((p) => p.inside === frameUid)
    expect(inner.length).toBeGreaterThanOrEqual(2)
    expect(out.issues.filter((i) => i.code === 'OVERLAP' || i.code === 'SPACING' || i.code === 'OUT_OF_SHEET')).toEqual([])
    const ops = out.programs[0].ops
    const apertureAt = ops.findIndex((o) => o.kind === 'cam' && o.partUid === frameUid && o.intent.k === 'contour')
    const frameCut = ops.findIndex((o) => o.kind === 'contour' && o.partUid === frameUid)
    for (const p of inner) {
      const c = ops.findIndex((o) => o.kind === 'contour' && o.partUid === p.uid)
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThan(apertureAt)
    }
    expect(apertureAt).toBeLessThan(frameCut)
  })

  it('keeps labels off openings and counts copies', () => {
    const out = runJob(j, shapeData())
    const frame = out.labels.find((l) => l.partName === 'Mirror frame')!
    const sh = out.nest.sheets[0]
    const pl = sh.placements.find((p) => p.uid === frame.uid)!
    const inst = out.instances.find((i) => i.uid === frame.uid)!
    const { pt: tp } = placementTransform(inst, pl)
    const hole = inst.holes![0].map((q) => tp(q.x, q.y))
    const hx = hole.map((q) => q.x)
    const hy = hole.map((q) => q.y)
    const s = frame.spot
    const overlaps = s.cx + s.w / 2 > Math.min(...hx) && s.cx - s.w / 2 < Math.max(...hx) && s.cy + s.h / 2 > Math.min(...hy) && s.cy - s.h / 2 < Math.max(...hy)
    expect(overlaps).toBe(false)
    const discs = out.labels.filter((l) => l.partName === 'Disc')
    expect(discs.map((l) => `${l.copy?.n} of ${l.copy?.of}`).sort()).toEqual(['1 of 4', '2 of 4', '3 of 4', '4 of 4'])
    expect(frame.copy).toBeUndefined()
  })

  it('leaves an onion skin on small parts and cuts it last', () => {
    const d = shapeData((x) => {
      x.settings.nesting.onionSkin = 0.4
      x.settings.nesting.onionSkinMaxArea = 100_000
    })
    const out = runJob({ ...j, camParts: [discPart(3)] }, d)
    const ops = out.programs[0].ops
    const cuts = ops.filter((o) => o.kind === 'contour')
    expect(cuts.length).toBe(6)
    expect(cuts.slice(0, 3).every((c) => c.kind === 'contour' && c.za === 0.4 && !c.skin)).toBe(true)
    expect(cuts.slice(3).every((c) => c.kind === 'contour' && c.skin && c.za < 0)).toBe(true)
    expect(ops.slice(-3).every((o) => o.kind === 'contour' && o.skin)).toBe(true)
    const mpr = mprFiles({ ...j, camParts: [discPart(3)] }, d, out)[0].text
    expect(mpr.match(/onion-skin pass/g)?.length).toBe(3)
  })

  it('shape and rectangular nests of the reference kitchen are within 3% yield', () => {
    const yieldOf = (engine: 'rect' | 'shape') => {
      const out = runJob(sampleJob(), data((d) => (d.settings.nesting.engine = engine)))
      expect(out.nest.unplaced).toEqual([])
      expect(out.issues.filter((i) => ['OVERLAP', 'SPACING', 'OUT_OF_SHEET', 'GRAIN'].includes(i.code))).toEqual([])
      const used = out.nest.sheets.reduce((a, s) => a + (s.utilization / 100) * s.sheetLength * s.sheetWidth, 0)
      const total = out.nest.sheets.reduce((a, s) => a + s.sheetLength * s.sheetWidth, 0)
      return { y: (used / total) * 100, sheets: out.nest.sheets.length, parts: out.instances.length }
    }
    const t0 = Date.now()
    const ref = yieldOf('rect')
    const shape = yieldOf('shape')
    expect(ref.parts).toBeGreaterThan(40)
    expect(shape.sheets).toBeLessThanOrEqual(ref.sheets)
    expect(Math.abs(shape.y - ref.y)).toBeLessThanOrEqual(3)
    expect(Date.now() - t0).toBeLessThan(20_000)
  })

  it('auto engine with cabinets and shaped parts keeps every check clean', () => {
    const big: Job = { ...job([cabinet('tpl-base-2door'), cabinet('tpl-base-2door', () => {}, 'cab-2', 'B2')], 'J8'), camParts: [framePart(), discPart(6)] }
    const out = runJob(big, data((d) => (d.settings.features = { camMprOutput: true })))
    expect(out.nest.unplaced).toEqual([])
    expect(out.issues.filter((i) => ['OVERLAP', 'SPACING', 'OUT_OF_SHEET', 'GRAIN'].includes(i.code))).toEqual([])
  })

  it('arched and round parts beat bounding boxes', () => {
    const arch = newPart({ name: 'Arch', length: 800, width: 400, thickness: 18, materialId: 'mat-mdf18', qty: 14, entities: [] })
    const c = polyline([pt(0, 0), pt(800, 0), pt(800, 50), pt(400, 400), pt(0, 50)], true)
    const e = makeEntity({ t: 'contour', c }, 'outline')
    arch.entities = [e]
    arch.outlineId = e.id
    const parts = [arch, discPart(16)]
    const rectOut = runJob({ ...job([], 'J9'), camParts: parts }, data((d) => (d.settings.nesting.engine = 'rect')))
    const shapeOut = runJob({ ...job([], 'J9'), camParts: parts }, data((d) => (d.settings.nesting.engine = 'shape')))
    expect(shapeOut.nest.sheets.length).toBeLessThan(rectOut.nest.sheets.length)
    expect(shapeOut.issues.filter((i) => ['OVERLAP', 'SPACING', 'OUT_OF_SHEET'].includes(i.code))).toEqual([])
    void circle
    void defaultAppData
  })
})

describe('C7 offcut stock', () => {
  it('uses a stock offcut, then swaps it for the job remnants (idempotent)', () => {
    const d = data((x) => {
      x.settings.nesting.useOffcuts = true
      x.library.offcuts = [{ id: 'oc-a', materialId: 'mat-mdf18', length: 1000, width: 700, createdAt: '2026-01-01' }]
    })
    const j: Job = { ...job([], 'J10'), camParts: [discPart(4)] }
    const out = runJob(j, d)
    expect(out.nest.sheets.map((s) => s.offcutId)).toEqual(['oc-a'])
    expect(out.nest.sheets[0].sheetLength).toBe(1000)
    const once = updateOffcutStock(d.library.offcuts!, out.nest, j.number, 'now')
    expect(once.used).toBe(1)
    expect(once.offcuts.some((o) => o.id === 'oc-a')).toBe(false)
    expect(once.offcuts.every((o) => o.from === 'J10' && o.materialId === 'mat-mdf18')).toBe(true)
    const twice = updateOffcutStock(once.offcuts, out.nest, j.number, 'now')
    expect(twice.offcuts.length).toBe(once.offcuts.length)
  })
})
