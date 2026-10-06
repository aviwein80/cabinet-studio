import { describe, expect, it } from 'vitest'
import { makeEntity, newPart } from '@/cam/doc'
import { pt, rect } from '@/cam/geom'
import { readMpr } from '@/cam/mprRead'
import { defaultOp } from '@/cam/ops'
import type { CamOp, CamPart } from '@/cam/types'
import { jobCosts } from '../src/core/areas'
import { registrationError } from '../src/core/flipSide'
import type { SheetProgram, VDrill } from '../src/core/machining'
import { nestUnconfirmed } from '../src/core/nestConfirm'
import { mprFiles, runJob } from '../src/core/pipeline'
import { sampleJob } from '../src/core/sample'
import type { AppData, Job } from '../src/core/types'
import { validateJob } from '../src/core/validator'
import { data } from './helpers'

const UNDER = [pt(80, 60), pt(520, 60), pt(300, 330), pt(150, 250)]

/** 600 x 400 panel: two holes from the top, four 8 mm holes 12 deep from the underside (face 6). */
function panel(name: string, underside: boolean, qty: number): CamPart {
  const part = newPart({ name, length: 600, width: 400, thickness: 18, materialId: 'mat-pb18-white', entities: [] })
  const outline = makeEntity({ t: 'contour', c: rect(0, 0, 600, 400) }, 'outline')
  const top = [pt(50, 200), pt(550, 200)].map((c) => makeEntity({ t: 'circle', c, r: 2.5 }, 'holes', 1))
  const under = underside ? UNDER.map((c) => makeEntity({ t: 'circle', c, r: 4 }, 'holes', 6, { depth: 12 })) : []
  part.entities = [outline, ...top, ...under]
  part.outlineId = outline.id
  part.ops = [
    { ...defaultOp('drill', [...top, ...under].map((e) => e.id)), levels: { safeZ: 20, rapidZ: 3, depth: 12, through: false, stockZ: 0, passDepth: 0 } } as CamOp,
    { ...defaultOp('profile', [outline.id]), side: 'outside', levels: { safeZ: 20, rapidZ: 3, depth: 18, through: true, stockZ: 0, passDepth: 0 } } as CamOp,
  ]
  part.qty = qty
  return part
}

function setup(o: { flip?: boolean; write?: boolean; cam?: boolean; axis?: 'end' | 'side' } = {}): { job: Job; d: AppData } {
  const d = data((x) => {
    x.settings.nesting.flipSheets = o.flip ?? true
    if (o.axis) x.settings.nesting.flipAxis = o.axis
    x.settings.features = { ...x.settings.features, nestFlipOutput: o.write ?? false, camMprOutput: o.cam ?? false }
  })
  const job: Job = { ...sampleJob(), id: 'j', number: 'J7', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', camParts: [panel('Flip panel', true, 3), panel('Plain panel', false, 2)] }
  return { job, d }
}

describe('flip-side nesting (NST-07)', () => {
  it('parts with underside work nest on their own flip-side sheets, the reference strip off the length', () => {
    const { job, d } = setup()
    const out = runJob(job, d)
    const name = (uid: string) => out.instances.find((i) => i.uid === uid)!.part.name
    const flip = out.nest.sheets.filter((s) => s.flip)
    expect(flip).toHaveLength(1)
    expect(flip[0].placements.map((p) => name(p.uid))).toEqual(['Flip panel', 'Flip panel', 'Flip panel'])
    expect(flip[0].flip).toEqual({ axis: 'end', reference: 5, length: 3658, width: 1524 })
    expect(flip[0].sheetLength).toBe(3653)
    for (const p of flip[0].placements) expect(p.x + p.dx).toBeLessThanOrEqual(3653 - 10 + 1e-9)
    for (const s of out.nest.sheets.filter((x) => !x.flip)) expect(s.placements.some((p) => name(p.uid) === 'Flip panel')).toBe(false)
    // bought whole: the area of a flip-side sheet is the full sheet
    const c = jobCosts(out.nest, out.instances, d.library)
    expect(c.sheets.find((s) => s.index === flip[0].index)!.sheetArea).toBe(3658 * 1524)
  })

  it('off: nest and programs exactly as before', () => {
    const a = setup({ flip: false })
    const b = runJob(a.job, data((x) => (x.settings.features = { ...x.settings.features, nestFlipOutput: true })))
    const base = runJob(a.job, a.d)
    expect(b.nest).toEqual(base.nest)
    expect(base.nest.sheets.some((s) => s.flip)).toBe(false)
  })

  for (const axis of ['end', 'side'] as const)
    it(`turned ${axis === 'end' ? 'end for end' : 'over the long edge'}: the side-1 MPR, read back and turned over, puts every underside hole within 0.1 mm of its design position`, () => {
      const { job, d } = setup({ write: true, cam: true, axis })
      const out = runJob(job, d)
      const prog = out.programs.find((p) => p.sheet.flip)!
      const files = mprFiles(job, d, out)
      const side1 = files.find((f) => f.name === `${prog.name}_side1.mpr`)!
      expect(side1).toBeTruthy()
      // per-part turned-over programs are not written for parts on a written flip-side sheet
      expect(files.some((f) => f.name.endsWith('Flip-panel_B.mpr'))).toBe(false)
      const doc = readMpr(side1.text)
      expect(doc.errors).toEqual([])
      expect(doc.header.ARTICLE).toBeDefined()
      const holes = doc.macros.filter((m) => m.id === 102).map((m) => ({ x: Number(m.values.XA), y: Number(m.values.YA), d: Number(m.values.DU ?? 8), ti: Number(m.values.TI) }))
      // independent: where the design puts each underside hole on side 2 (Placement: optional half
      // turn, then a quarter turn), and where side 1 must drill it (mirror over the reference edge)
      const Ls = prog.sheet.sheetLength
      const Ws = prog.sheet.sheetWidth
      let worst = 0
      for (const pl of prog.sheet.placements) {
        for (const h of UNDER) {
          let x = pl.flip ? 600 - h.x : h.x
          let y = pl.flip ? 400 - h.y : h.y
          ;[x, y] = pl.rotated ? [pl.x + (400 - y), pl.y + x] : [pl.x + x, pl.y + y]
          // drilled on side 1 at the mirror image; read back and turned over again
          const near = Math.min(...holes.map((q) => (axis === 'end' ? Math.hypot(Ls - q.x - x, q.y - y) : Math.hypot(q.x - x, Ws - q.y - y))))
          worst = Math.max(worst, near)
        }
      }
      console.log(`[flip ${axis}] ${holes.length} underside holes, registration within ${worst.toFixed(4)} mm`)
      expect(holes).toHaveLength(3 * UNDER.length)
      expect(worst).toBeLessThanOrEqual(0.1)
      expect(holes.every((q) => q.ti === 12)).toBe(true)
      // the reference edge: a through cut along the turned-over edge, tool on the strip's side
      const edge = doc.macros.find((m) => m.id === 105 && /reference edge/.test(m.values.MNM ?? ''))!
      expect(edge.values.RK).toBe('WRKR')
      const block = doc.contours.get(Number(edge.values.EA.split(':')[0]))!
      const along = axis === 'end' ? [block.start.x, block.segs[0].b.x] : [block.start.y, block.segs[0].b.y]
      expect(along).toEqual(axis === 'end' ? [Ls, Ls] : [Ws, Ws])
      // the backplot's own registration figure agrees
      expect(registrationError(prog, prog.back!.program, new Map(out.instances.map((i) => [i.uid, i])), d.machine)).toBeLessThanOrEqual(0.001)
      // side 2 opens with the turning instruction and keeps the cut-outs
      const side2 = files.find((f) => f.name === `${prog.name}.mpr`)!.text
      expect(side2).toMatch(/SIDE 2 OF 2/)
      expect(out.issues.filter((i) => i.severity === 'error' && /FLIP|DEPTH|OUTSIDE/.test(i.code))).toEqual([])
      expect(out.issues.some((i) => i.code === 'CAM_BACKSIDE')).toBe(false)
    })

  it('output off: the side-1 program is only shown; underside holes stay in the per-part program', () => {
    const { job, d } = setup({ write: false, cam: true })
    const out = runJob(job, d)
    const prog = out.programs.find((p) => p.sheet.flip)!
    expect(prog.back?.written).toBe(false)
    expect(prog.ops.some((o) => o.kind === 'cam' && o.intent.k === 'comment' && /SIDE 2/.test(o.intent.text))).toBe(false)
    const files = mprFiles(job, d, out)
    expect(files.some((f) => f.name.endsWith('_side1.mpr'))).toBe(false)
    expect(files.some((f) => f.name.endsWith('Flip-panel_B.mpr'))).toBe(true)
    expect(out.issues.find((i) => i.code === 'FLIP_SHEETS')!.message).toMatch(/Not written/)
    // the flip switch alone does not write custom-part work
    const only = setup({ write: true, cam: false })
    const o2 = runJob(only.job, only.d)
    expect(o2.programs.find((p) => p.sheet.flip)!.back?.written).toBe(false)
  })

  it('the export checker catches a hole off its part, too deep, and a misplaced reference edge', () => {
    const { job, d } = setup({ write: true, cam: true })
    const out = runJob(job, d)
    const prog = out.programs.find((p) => p.sheet.flip)!
    const side1 = prog.back!.program
    const k = side1.ops.findIndex((o) => o.kind === 'vdrill')
    const h = side1.ops[k] as VDrill
    const codes = (s1: SheetProgram['ops']) => validateJob([{ ...prog, back: { program: { ...side1, ops: s1 }, written: true } }], out.nest, out.instances, d.library, d.machine, d.settings).map((i) => i.code)
    expect(codes(side1.ops.map((o, i) => (i === k ? { ...h, x: h.x + 700 } : o)))).toContain('FLIP_OUTSIDE')
    expect(codes(side1.ops.map((o, i) => (i === k ? { ...h, depth: 25 } : o)))).toContain('DEPTH_SPOILBOARD')
    expect(codes(side1.ops.map((o) => (o.kind === 'contour' ? { ...o, points: o.points.map((p) => ({ x: p.x - 20, y: p.y })) } : o)))).toContain('FLIP_REFERENCE')
    expect(codes(side1.ops)).not.toContain('FLIP_OUTSIDE')
  })

  it('how the sheet is turned and the reference strip carry Configure badges', () => {
    const { d } = setup()
    expect(nestUnconfirmed(d.settings, d.machine).map((u) => [u.key, u.value])).toEqual([
      ['nest:flipAxis', 'end for end'],
      ['nest:flipReference', '5 mm'],
    ])
  })
})
