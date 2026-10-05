/**
 * M2.5b: feature recognition (SOL-01). On the fixtures, every outline, cut-out, pocket and hole is
 * found with positions, sizes and depths within 0.01 mm of the design numbers (the `.truth.json`
 * files, written from the construction parameters, never from recognition). The features land on
 * layers that the Stage 1 layer rules machine, into an MPR the export checker passes (with
 * custom-part output switched on for the test; it stays off by default).
 */
import { describe, expect, it } from 'vitest'
import { area, boxOf, type Contour, radius } from '@/cam/geom'
import { readMpr } from '@/cam/mprRead'
import { writePartPrograms } from '@/cam/mpr'
import { applyRules, BUILTIN_RECIPES, BUILTIN_RULESETS } from '@/cam/rules'
import { minAreaRect, hull2, panelFrame } from '@/cam/solid/align'
import { OPEN_REACH, type Recognition, recognizePanel } from '@/cam/solid/recognize'
import { solidToPart } from '@/cam/solid/toPart'
import { generatePart } from '@/cam/toolpath'
import type { CamPart } from '@/cam/types'
import { defaultAppData, PLACEHOLDER_MACHINE } from '@/core/defaults'
import { mprFiles, runJob } from '@/core/pipeline'
import type { Job, Material } from '@/core/types'
import { readFixture, type Truth, truthOf } from './solid-fixtures'

type XY = [number, number]
/** The four turns that keep face 1 up, from the design's frame (size X0 x Y0) into the part's. */
const turns = (X0: number, Y0: number): ((p: XY) => XY)[] => [(p) => [p[0], p[1]], (p) => [Y0 - p[1], p[0]], (p) => [X0 - p[0], Y0 - p[1]], (p) => [p[1], X0 - p[0]]]

/** The turn that lays the design's holes (or, with none, its box) onto the recognised ones. */
function matchTurn(t: Truth, rec: Recognition, size: XY): (p: XY) => XY {
  const vh = t.holes.filter((h) => h.face === 1 || h.face === 6)
  let best = turns(...size)[0]
  let err = Infinity
  for (const f of turns(...size)) {
    let worst = 0
    for (const h of vh) {
      const [x, y] = f([h.x, h.y])
      const d = Math.min(...rec.holes.filter((r) => r.face === h.face).map((r) => Math.hypot(r.x - x, r.y - y)))
      worst = Math.max(worst, d)
    }
    if (!vh.length) {
      const b = boxOf([rec.outline])
      const [x, y] = f([0, 0])
      worst = Math.min(Math.hypot(x - b.minX, y - b.minY), Math.hypot(x - b.maxX, y - b.minY), Math.hypot(x - b.minX, y - b.maxY), Math.hypot(x - b.maxX, y - b.maxY))
    }
    if (worst < err) {
      err = worst
      best = f
    }
  }
  return best
}

const mapBox = (f: (p: XY) => XY, b: [number, number, number, number]) => {
  const a = f([b[0], b[1]])
  const c = f([b[2], b[3]])
  return [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[0], c[0]), Math.max(a[1], c[1])]
}
const boxErr = (c: Contour, want: number[]) => {
  const b = boxOf([c])
  return Math.max(Math.abs(b.minX - want[0]), Math.abs(b.minY - want[1]), Math.abs(b.maxX - want[2]), Math.abs(b.maxY - want[3]))
}

/** Every design hole, pocket and cut-out found within 0.01 mm; returns the worst errors seen. */
function checkAgainstTruth(name: string, rec: Recognition, t: Truth, size: XY) {
  const f = matchTurn(t, rec, size)
  const worst = { position: 0, diameter: 0, depth: 0, tip: 0, area: 0, box: 0 }
  // holes: one recognised hole per design hole, same face, same kind of floor
  expect(rec.holes.length, `${name} hole count`).toBe(t.holes.length)
  const left = [...rec.holes]
  for (const h of t.holes) {
    const [x, y] = h.face === 1 || h.face === 6 ? f([h.x, h.y]) : [h.x, h.y]
    const i = left.findIndex((r) => r.face === h.face && Math.hypot(r.x - x, r.y - y) < 0.01 && Math.abs(r.d - h.d) < 0.01)
    expect(i, `${name}: hole Ø${h.d} at ${h.x},${h.y} face ${h.face}`).toBeGreaterThanOrEqual(0)
    const r = left.splice(i, 1)[0]
    worst.position = Math.max(worst.position, Math.hypot(r.x - x, r.y - y))
    worst.diameter = Math.max(worst.diameter, Math.abs(r.d - h.d))
    worst.depth = Math.max(worst.depth, Math.abs(r.depth - h.depth))
    expect(r.through).toBe(h.through)
    expect(r.floor).toBe(h.floor)
    if (h.tipDepth !== undefined) {
      worst.tip = Math.max(worst.tip, Math.abs(r.tipDepth! - h.tipDepth))
      expect(r.tipAngle).toBeCloseTo(h.tipAngle!, 6)
    }
  }
  // pockets: same face and depth, same area, same box
  expect(rec.pockets.length, `${name} pocket count`).toBe(t.pockets.length)
  for (const p of t.pockets) {
    const face = (p as { face?: number }).face ?? 1
    const cand = rec.pockets.filter((r) => r.face === face && Math.abs(r.depth - p.depth) < 0.01)
    expect(cand.length, `${name}: pocket ${p.depth} deep`).toBeGreaterThan(0)
    const r = cand.reduce((b, c) => (Math.abs(Math.abs(area(c.contour)) - p.area) < Math.abs(Math.abs(area(b.contour)) - p.area) ? c : b))
    worst.depth = Math.max(worst.depth, Math.abs(r.depth - p.depth))
    worst.area = Math.max(worst.area, Math.abs(Math.abs(area(r.contour)) - p.area))
    if (p.box) worst.box = Math.max(worst.box, boxErr(r.contour, mapBox(f, p.box)))
    expect(r.islands.length).toBe((p as { islands?: number }).islands ?? 0)
  }
  expect(rec.cutouts.length, `${name} cut-out count`).toBe(t.cutouts.length)
  for (const c of t.cutouts) {
    const r = rec.cutouts.reduce((b, x) => (Math.abs(Math.abs(area(x.contour)) - c.area) < Math.abs(Math.abs(area(b.contour)) - c.area) ? x : b))
    worst.area = Math.max(worst.area, Math.abs(Math.abs(area(r.contour)) - c.area))
    worst.box = Math.max(worst.box, boxErr(r.contour, mapBox(f, c.box)))
  }
  worst.area = Math.max(worst.area, Math.abs(Math.abs(area(rec.outline)) - t.outline.area))
  for (const [k, v] of Object.entries(worst)) expect(v, `${name}: worst ${k} error`).toBeLessThan(0.01)
  console.log(`[recognition] ${name}: ${rec.holes.length} holes, ${rec.pockets.length} pockets, ${rec.cutouts.length} cut-outs; worst error position ${worst.position.toExponential(1)} mm, Ø ${worst.diameter.toExponential(1)}, depth ${worst.depth.toExponential(1)}, point ${worst.tip.toExponential(1)}, area ${worst.area.toExponential(1)} mm², box ${worst.box.toExponential(1)}`)
  return f
}

describe('M2.5b feature recognition (SOL-01)', () => {
  it('cabinet side (standing up in the file): laid flat with the coloured inside face up; every hole, pocket and the cut-out within 0.01 mm', async () => {
    const s = await readFixture('cabinet-side.step')
    const t = truthOf('cabinet-side.step')
    const body = s.bodies[0]
    const rec = recognizePanel(body)
    expect(rec.frame.length).toBeCloseTo(720, 9)
    expect(rec.frame.width).toBeCloseTo(560, 9)
    expect(rec.frame.thickness).toBeCloseTo(19, 9)
    // face 1 is the side the pockets open on: the inside face, which the file colours
    const red = body.faces.find((f) => f.color === '#cc3333')!
    expect(rec.frame.R[2][0]).toBeCloseTo(red.surface.n![0], 12)
    checkAgainstTruth('cabinet side', rec, t, [720, 560])
    // the L-shaped outline: six straight sides, the toe-kick notch exact
    expect(rec.outline.segs.map((x) => x.k).join('')).toBe('LLLLLL')
    expect(Math.abs(area(rec.outline))).toBeCloseTo(t.outline.area, 6)
    // the stepped pocket: 4 mm round 80 x 50 R6, then 10 mm round 30 x 20 R4; groove ends R3.25
    const radii = rec.pockets.map((p) => Math.round(p.minRadius * 1e6) / 1e6).sort((a, b) => a - b)
    expect(radii).toEqual([3, 3.25, 4, 6])
    expect(rec.unrecognised).toEqual([])
  })

  it('shaped door (turned 30° in the file): arch radius exact, field pocket, knob hole, hinge cups found on face 6', async () => {
    const s = await readFixture('shaped-door.step')
    const t = truthOf('shaped-door.step')
    const rec = recognizePanel(s.bodies[0])
    expect(rec.frame.length).toBeCloseTo(700, 9)
    expect(rec.frame.width).toBeCloseTo(400, 9)
    checkAgainstTruth('shaped door', rec, t, [400, 700])
    const arch = rec.outline.segs.filter((x) => x.k === 'A')
    expect(arch).toHaveLength(1)
    expect(radius(arch[0] as never)).toBeCloseTo(t.outline.archRadius!, 6)
    const field = rec.pockets[0]
    expect(field.contour.segs.filter((x) => x.k === 'A').map((a) => radius(a as never))).toEqual([expect.closeTo(180, 6)])
    expect(rec.holes.filter((h) => h.face === 6).map((h) => [h.d, h.depth])).toEqual([
      [35, 13],
      [35, 13],
    ])
    // the BREP copy gives the same features
    const r2 = recognizePanel((await readFixture('shaped-door.brep')).bodies[0])
    expect(r2.holes.map((h) => [h.face, h.x, h.y, h.d, h.depth])).toEqual(rec.holes.map((h) => [h.face, h.x, h.y, h.d, h.depth]))
  })

  it('feature block: island, hole inside a pocket, underside pocket, round pocket, holes in all four edges, rebate, chamfer', async () => {
    const s = await readFixture('feature-block.step')
    const t = truthOf('feature-block.step')
    const rec = recognizePanel(s.bodies[0])
    // the design's own rebate is not in the pocket list of the truth file; check it apart
    const rebate = rec.pockets.find((p) => p.open)!
    expect(rebate.depth).toBe(12)
    const b = boxOf([rebate.contour])
    // the floor (0..500 x 290..300) grown OPEN_REACH mm wherever it is open; the wall into the
    // material (y = 290) stays where it is; past the ends the shape is in the air
    expect([b.minX, b.minY, b.maxX, b.maxY]).toEqual([-OPEN_REACH, 290 - OPEN_REACH, 500 + OPEN_REACH, 300 + OPEN_REACH])
    expect(Math.abs(area(rebate.contour))).toBeCloseTo(500 * (10 + OPEN_REACH) + 2 * OPEN_REACH * (10 + 2 * OPEN_REACH), 3)
    const rest = { ...rec, pockets: rec.pockets.filter((p) => !p.open) }
    checkAgainstTruth('feature block', rest, t, [500, 300])
    expect(rec.holes.filter((h) => h.face >= 2 && h.face <= 5).map((h) => h.face)).toEqual([2, 3, 4, 5])
    expect(rec.pockets.find((p) => p.face === 6)!.depth).toBe(5)
    expect(rec.warnings.join(' ')).toMatch(/underside \(face 6\)/)
    expect(rec.warnings.join(' ')).toMatch(/not straight up and down \(a chamfer/)
    expect(rec.warnings.join(' ')).toMatch(/rebate/)
    expect(rec.unrecognised).toEqual([])
  })

  it('IGES shelf (inches) and the assembly bodies: holes and sizes in millimetres', async () => {
    const shelf = await readFixture('shelf-inch.igs')
    const rec = recognizePanel(shelf.bodies[0])
    const t = truthOf('shelf-inch.igs')
    expect(rec.frame.length).toBeCloseTo(304.8, 6)
    // IGES stores the holes as surfaces of revolution: sizes within 0.0001 mm
    for (const h of t.holes) expect(rec.holes.some((r) => Math.abs(r.d - h.d) < 1e-3 && Math.abs(r.depth - h.depth) < 1e-3 && r.through === h.through)).toBe(true)
    const asm = await readFixture('assembly-5.step')
    const at = truthOf('assembly-5.step') as unknown as { parts: { name: string; length: number; width: number; thickness: number; holes: number }[] }
    for (const b of asm.bodies) {
      const r = recognizePanel(b)
      const want = at.parts.find((p) => p.name === b.name)!
      expect([r.frame.length, r.frame.width, r.frame.thickness].map((x) => Math.round(x * 1e6) / 1e6)).toEqual([Math.max(want.length, want.width), Math.min(want.length, want.width), want.thickness])
      expect(r.holes, b.name).toHaveLength(want.holes)
    }
  })

  it('minimum bounding box: smallest rectangle round a turned rectangle and an L', () => {
    const turned = (deg: number, pts: XY[]) => pts.map(([x, y]) => [x * Math.cos((deg * Math.PI) / 180) - y * Math.sin((deg * Math.PI) / 180), x * Math.sin((deg * Math.PI) / 180) + y * Math.cos((deg * Math.PI) / 180)] as XY)
    const r = minAreaRect(
      hull2(
        turned(37, [
          [0, 0],
          [720, 0],
          [720, 560],
          [0, 560],
          [0, 75],
          [100, 75],
        ]),
      ),
    )
    expect([Math.max(r.a, r.b), Math.min(r.a, r.b)].map((x) => Math.round(x * 1e9) / 1e9)).toEqual([720, 560])
    const ang = (Math.atan2(r.dir[1], r.dir[0]) * 180) / Math.PI
    expect(Math.round((((ang % 90) + 90) % 90) * 1e9) / 1e9).toBeCloseTo(37, 9)
  })

  it('a face can be named as face 1 instead', async () => {
    const s = await readFixture('cabinet-side.step')
    const body = s.bodies[0]
    const red = body.faces.find((f) => f.color === '#cc3333')!
    const other = body.faces.find((f) => f.surface.kind === 'plane' && Math.abs(f.surface.n![0] - 1) < 1e-9)!
    expect(panelFrame(body, { topFace: other.id }).R[2][0]).toBeCloseTo(1, 12)
    // turned over: the pockets now open on face 6 and are reported, holes from the top become face 6 holes
    const rec = recognizePanel(body, { align: { topFace: other.id } })
    expect(rec.pockets.every((p) => p.face === 6)).toBe(true)
    expect(rec.holes.filter((h) => !h.through).every((h) => h.face === 6)).toBe(true)
    expect(panelFrame(body, { topFace: red.id }).R[2][0]).toBeCloseTo(-1, 12)
  })
})

describe('M2.5b recognised features -> layers -> Stage 1 rules -> MPR -> export checker', () => {
  const ply: Material = { id: 'mat-ply19', code: 'PLY19', name: 'Maple ply 19', thickness: 19, sheetLength: 3658, sheetWidth: 1524, grain: false, color: '#d8c39a' }
  async function partFrom(file: string) {
    const s = await readFixture(file)
    return solidToPart(s, { body: 0, blob: 'b'.repeat(64), source: file, materials: [ply] })
  }
  const ruled = (part: CamPart) => applyRules(part, BUILTIN_RULESETS[0], BUILTIN_RECIPES)

  it('layers are named for the Stage 1 rules; every feature layer is matched (none left over)', async () => {
    const { part, rows } = await partFrom('cabinet-side.step')
    const names = part.layers.map((l) => l.name)
    expect(names).toEqual(expect.arrayContaining(['Outline', 'INSIDE', 'POCKET_D3', 'POCKET_D4', 'POCKET_D9.5', 'POCKET_D10', 'DRILL_D5_13', 'DRILL_D8_13', 'THRU_DRILL_D8']))
    expect(part.materialId).toBe('mat-ply19')
    expect(part.notes).toMatch(/Material: Maple ply 19/)
    expect([part.length, part.width, part.thickness]).toEqual([720, 560, 19])
    expect(rows.filter((r) => r.kind === 'hole')).toHaveLength(30)
    const r = ruled(part)
    expect(r.unmatched).toEqual([])
    expect(r.missingRecipes).toEqual([])
    // shapes keep their solid faces; holes carry their exact depth
    const holes = part.entities.filter((e) => e.solid?.role === 'hole')
    expect(holes).toHaveLength(30)
    for (const h of holes) expect(h.depth! === 13 || h.depth! === 19).toBe(true)
  })

  it('cabinet side: toolpaths drill and pocket to the recognised depths; the MPR passes the export checker with output on, and is blocked with it off (the default)', async () => {
    const { part, recognition } = await partFrom('cabinet-side.step')
    const r = ruled(part)
    const tps = generatePart(r.part, PLACEHOLDER_MACHINE)
    const drills = tps.flatMap((tp) => tp.intents.filter((i) => i.k === 'vdrill'))
    expect(drills).toHaveLength(30)
    const blind = drills.filter((d) => d.k === 'vdrill' && !d.through)
    expect(new Set(blind.map((d) => (d.k === 'vdrill' ? d.depth : 0)))).toEqual(new Set([13]))
    // every recognised pocket depth is cut, no deeper
    const pocketDepths = new Set(recognition.pockets.map((p) => p.depth))
    for (const tp of tps) {
      const op = r.part.ops.find((o) => o.id === tp.opId)!
      if (op.kind !== 'pocket') continue
      const deepest = Math.max(...tp.intents.flatMap((i) => (i.k === 'contour' ? i.passes.map((p) => p.depth) : i.k === 'pocket-rect' ? [i.depth] : [])))
      expect(pocketDepths.has(deepest), `${op.name} deepest ${deepest}`).toBe(true)
    }
    const data = defaultAppData()
    data.library.materials.push(ply)
    const job: Job = { id: 'j', number: 'SOL1', name: 'Solid side', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [r.part] }
    data.jobs = [job]
    // default: custom-part output off -> blocked with the reason
    expect(data.settings.features?.camMprOutput ?? false).toBe(false)
    const off = runJob(job, data)
    expect(off.issues.filter((i) => i.severity === 'error').map((i) => i.code)).toEqual(['CAM_OUTPUT_OFF'])
    // switched on: no errors; the program has every hole at its depth and the pockets
    data.settings.features = { ...data.settings.features, camMprOutput: true } as typeof data.settings.features
    const on = runJob(job, data)
    expect(on.issues.filter((i) => i.severity === 'error')).toEqual([])
    const doc = readMpr(mprFiles(job, data, on)[0].text)
    expect(doc.errors).toEqual([])
    const bores = doc.macros.filter((m) => m.name.includes('BohrVert'))
    expect(bores.filter((m) => m.values.TI === '13' && m.values.DU === '5')).toHaveLength(26)
    expect(bores.filter((m) => m.values.TI === '13' && m.values.DU === '8')).toHaveLength(2)
    expect(bores.filter((m) => m.values.BM === 'LSL' && m.values.DU === '8')).toHaveLength(2)
    const milled = doc.macros.filter((m) => m.name.includes('Konturfraesen') || m.name.includes('Tasche'))
    expect(milled.length).toBeGreaterThan(5)
  })

  it('shaped door: hinge cups go into the turned-over program at 13 mm; the export checker passes with output on', async () => {
    const { part } = await partFrom('shaped-door.step')
    const r = ruled(part)
    expect(r.unmatched).toEqual([])
    const tps = generatePart(r.part, PLACEHOLDER_MACHINE)
    const files = writePartPrograms(r.part, tps, PLACEHOLDER_MACHINE)
    expect(files.map((f) => f.side)).toEqual(['front', 'back'])
    const back = readMpr(files[1].text).macros.filter((m) => m.name.includes('BohrVert'))
    expect(back.map((m) => [m.values.DU, m.values.TI])).toEqual([
      ['35', '13'],
      ['35', '13'],
    ])
    const data = defaultAppData()
    data.library.materials.push(ply)
    data.settings.features = { ...data.settings.features, camMprOutput: true } as typeof data.settings.features
    const job: Job = { id: 'j', number: 'SOL2', name: 'Door', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [{ ...r.part, materialId: 'mat-ply19' }] }
    data.jobs = [job]
    const out = runJob(job, data)
    expect(out.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(out.issues.some((i) => i.code === 'CAM_BACKSIDE')).toBe(true)
  })

  it('feature block: the underside pocket stays off the machined layers; edge holes need the horizontal drill unit', async () => {
    const { part, recognition } = await partFrom('feature-block.step')
    const r = ruled(part)
    expect(r.unmatched).toEqual([{ layer: 'BACK_POCKET_D5', shapes: 1 }])
    expect(recognition.holes.filter((h) => h.face >= 2 && h.face <= 5)).toHaveLength(4)
    const tps = generatePart(r.part, PLACEHOLDER_MACHINE)
    // the rebate clears the floor to the edge; its cutter centre stays within radius + 0.5 mm of the part
    const rebateOp = r.part.ops.find((o) => o.name.includes('POCKET_D12'))!
    const tp = tps.find((x) => x.opId === rebateOp.id)!
    const tool = tp.tool!
    const box = boxOf(tp.intents.flatMap((i) => (i.k === 'contour' ? [{ segs: i.segs, closed: i.closed }] : [])))
    const lim = tool.diameter / 2 + 0.5
    expect(box.minX).toBeGreaterThanOrEqual(-lim)
    expect(box.maxX).toBeLessThanOrEqual(500 + lim)
    expect(box.maxY).toBeLessThanOrEqual(300 + lim)
    expect(box.maxY + tool.diameter / 2).toBeGreaterThanOrEqual(300)
    const hd = tps.flatMap((tp) => tp.intents.filter((i) => i.k === 'hdrill'))
    expect(hd.map((h) => (h.k === 'hdrill' ? [h.face, h.depth, h.d] : []))).toEqual([
      [2, 30, 8],
      [3, 30, 8],
      [4, 30, 8],
      [5, 30, 8],
    ])
  })
})
