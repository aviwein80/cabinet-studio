/**
 * Stage 2 exit test (spec section 3.2): an STL relief door panel and a STEP shaped part each go
 * from import to simulated, collision-free toolpaths and a checked MPR. MPR output stays off by
 * default (the export checker blocks it); the switches are turned on here for the test only.
 *
 * What "checked" means here: the export checker (`runJob`, which also runs the collision check)
 * reports no errors for what can be written, and the program written is read back and simulated
 * again, giving the same material left as the toolpaths themselves.
 */
import { describe, expect, it } from 'vitest'
import { checkGouge } from '@/cam/3d/check'
import { defaultOp } from '@/cam/ops'
import { placeMesh } from '@/cam/mesh/place'
import { writePartPrograms } from '@/cam/mpr'
import { readProgram } from '@/cam/programRead'
import { addRelief } from '@/cam/relief/part'
import { placedReliefOutline } from '@/cam/relief/relief'
import { applyRules, BUILTIN_RECIPES, BUILTIN_RULESETS } from '@/cam/rules'
import { buildTimeline } from '@/cam/sim'
import { solidToPart } from '@/cam/solid/toPart'
import { HeightfieldStock } from '@/cam/stock/heightfield'
import { partCollisions } from '@/cam/collision/collision'
import { generatePart, pathKey, type Toolpath } from '@/cam/toolpath'
import type { CamPart, Finish3dOp, Rough3dOp } from '@/cam/types'
import { runTask } from '@/cam/worker/tasks'
import { newPart } from '@/cam/doc'
import { defaultAppData, PLACEHOLDER_MACHINE } from '@/core/defaults'
import { DEFAULT_FEATURES } from '@/core/features'
import { runJob } from '@/core/pipeline'
import type { AppData, Job, Material } from '@/core/types'
import { stlBinary } from './mesh-fixtures'
import { reliefBlock } from './relief-fixtures'
import { readFixture } from './solid-fixtures'

const machine = PLACEHOLDER_MACHINE

function jobOf(part: CamPart, extra: Material[] = []): { data: AppData; job: Job } {
  const data = defaultAppData()
  data.library.materials.push(...extra)
  const job: Job = { id: 'exit', number: 'EXIT2', name: 'Stage 2 exit', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [part] }
  data.jobs = [job]
  return { data, job }
}
const switches = (data: AppData, on: boolean) => (data.settings.features = { ...data.settings.features, camMprOutput: on, cam3dMprOutput: on } as typeof data.settings.features)
const errors = (out: ReturnType<typeof runJob>) => out.issues.filter((i) => i.severity === 'error').map((i) => i.code)

function simulate(len: number, wid: number, thick: number, tps: Toolpath[], cell: number) {
  const tl = buildTimeline(tps)
  const stock = new HeightfieldStock(len, wid, thick, cell)
  for (const s of tl.segs) if (s.kind !== 'rapid') stock.carve(s.a, s.b, s.cutter)
  return stock
}

const lowest = (s: HeightfieldStock) => s.hf.top.reduce((a, b) => Math.min(a, b), Infinity)

/** Largest difference between two simulated stocks of the same size. */
function stockDiff(a: HeightfieldStock, b: HeightfieldStock) {
  let worst = 0
  for (let i = 0; i < a.hf.top.length; i++) worst = Math.max(worst, Math.abs(a.hf.top[i] - b.hf.top[i]))
  return worst
}

describe('Stage 2 exit: STL relief door panel', () => {
  async function reliefDoor(finish: 'parallel' | 'waterline') {
    // 1. import: an STL as relief software exports it (inches, a block with a base), made 250 x 375 x 8 mm
    const imp = await runTask('mesh.import', { bytes: stlBinary(reliefBlock(8, 12, 64, 96, 0.25, -0.75)), name: 'rose-panel.stl', units: 'in', up: '+z' })
    const chk = await runTask('relief.checkMesh', { mesh: imp.mesh })
    expect(chk.base).toBe(true)
    const made = await runTask('relief.fromMesh', { mesh: imp.mesh, removeBase: true, size: { length: 250, width: 375, depth: 8 } })
    // 2. on a 400 x 600 x 18 MDF door, centred, top flush with face 1, with roughing and finishing
    const door: CamPart = { ...newPart({ name: 'Relief door', length: 400, width: 600, thickness: 18, materialId: 'mat-mdf18' }) }
    const added = addRelief(door, { blob: 'relief-blob', name: 'Rose', source: 'rose-panel.stl', units: 'in', triangles: made.mesh.indices.length / 3, info: made.info, place: { centre: true, x: 0, y: 0, top: 0 }, withOps: true })
    const part = added.part
    const [rough, fin] = added.ops as [Rough3dOp, Finish3dOp]
    // the cut-out round the door, and the finishing strategy for this run
    part.ops = [
      rough,
      finish === 'parallel' ? { ...fin, stepover: 1.5 } : ({ ...fin, strategy: 'waterline', stepdown: 0.5, fillShallow: false, slope: { min: 0, max: 90 } } as Finish3dOp),
      defaultOp('profile', [part.outlineId!]),
    ]
    // 3. toolpaths: 3D in the compute-worker task (as the app does), 2D as usual
    const meshes = { 'relief-blob': made.mesh }
    const tps3d = await runTask('cam.generate', { part, machine, opIds: [part.ops[0].id, part.ops[1].id], meshes })
    const tps = [...tps3d, ...generatePart({ ...part, ops: [part.ops[2]] }, machine)]
    const paths3d = new Map<string, Toolpath>(part.ops.slice(0, 2).map((op, i) => [pathKey(op, part, machine), tps3d[i]]))
    return { part, tps, paths3d, mesh: made.mesh }
  }

  for (const finish of ['parallel', 'waterline'] as const)
    it(`${finish} finishing: simulated without gouges or collisions; the panel round the relief is untouched; the export checker and the program read back agree`, async () => {
      const { part, tps, paths3d, mesh } = await reliefDoor(finish)
      expect(tps.map((t) => t.tool?.number)).toEqual([107, 105, expect.any(Number)])
      for (const t of tps) expect(t.moves.length, t.name).toBeGreaterThan(5)
      const placed = placeMesh(mesh, part.models![0].place)
      // no gouge (independent check, exact for the ball-nose)
      expect(checkGouge(placed, { shape: 'ball', r: 3 }, tps[1].moves, { step: 1 }).max).toBeLessThanOrEqual(0.005)
      // simulated: the relief is carved, the panel round it is untouched (apart from the cut-out)
      const stock = simulate(part.length, part.width, part.thickness, tps, 1)
      expect(stock.heightAt(200, 300)).toBeLessThan(-6)
      const o = placedReliefOutline(part.models![0])[0]
      const [x0, x1] = [Math.min(...o.map((p) => p.x)), Math.max(...o.map((p) => p.x))]
      const [y0, y1] = [Math.min(...o.map((p) => p.y)), Math.max(...o.map((p) => p.y))]
      let cutOutside = 0
      for (let y = 20.5; y < part.width - 20; y += 1)
        for (let x = 20.5; x < part.length - 20; x += 1) if ((x < x0 - 1 || x > x1 + 1 || y < y0 - 1 || y > y1 + 1) && stock.heightAt(x, y) < -1e-6) cutOutside++
      expect(cutOutside).toBe(0)
      // collision-free (stock, shank, holder, rapids, spoilboard)
      expect(partCollisions(part, tps, machine).found).toEqual([])

      // the export checker: with the default switches, output is blocked
      const { data, job } = jobOf(part)
      expect(DEFAULT_FEATURES.camMprOutput).toBe(false)
      expect(DEFAULT_FEATURES.cam3dMprOutput).toBe(false)
      expect(errors(runJob(job, data, { paths3d }))).toContain('CAM_OUTPUT_OFF')
      // switched on for the test: roughing and waterline have a woodWOP form (contour milling level by
      // level); parallel finishing does not yet (decision 2: true 3D output waits for a sample program
      // from woodWOP), so the checker stops it and says why
      switches(data, true)
      const out = runJob(job, data, { paths3d })
      if (finish === 'parallel') expect(errors(out)).toEqual(['CAM_3D_NO_OUTPUT'])
      else expect(errors(out)).toEqual([])
      expect(out.issues.some((i) => i.code === 'CAM_COLLISION')).toBe(false)

      // the part's program, read back and simulated, leaves the same material as the toolpaths it was
      // written from (everything with a woodWOP form: roughing, waterline, cut-out)
      const written = finish === 'parallel' ? [tps[0], tps[2]] : tps
      const [file] = writePartPrograms(part, written, machine, 'MDF18', { withCutout: true })
      const back = readProgram(file.text, { machine })
      expect(back.errors).toEqual([])
      expect(back.stock).toMatchObject({ length: 400, width: 600, thickness: 18 })
      const direct = simulate(400, 600, 18, written, 1)
      const fromFile = simulate(400, 600, 18, back.toolpaths, 1)
      console.log(`[exit] relief door (${finish}): program read back, stock difference ${stockDiff(direct, fromFile).toFixed(4)} mm; checker errors with switches on: ${JSON.stringify(errors(out))}`)
      expect(stockDiff(direct, fromFile)).toBeLessThanOrEqual(0.01)
    }, 300_000)
})

describe('Stage 2 exit: STEP shaped part', () => {
  const ply: Material = { id: 'mat-ply19', code: 'PLY19', name: 'Maple ply 19', thickness: 19, sheetLength: 3658, sheetWidth: 1524, grain: false, color: '#d8c39a' }

  it('shaped door: features found, machined by the layer rules, simulated without collisions; the export checker passes with output on and blocks it off; the program reads back the same', async () => {
    // 1. import and recognise
    const solid = await readFixture('shaped-door.step')
    const { part: raw } = solidToPart(solid, { body: 0, blob: 'b'.repeat(64), source: 'shaped-door.step', materials: [ply] })
    // 2. the Stage 1 layer rules choose the operations
    const r = applyRules(raw, BUILTIN_RULESETS[0], BUILTIN_RECIPES)
    expect(r.unmatched).toEqual([])
    const part = { ...r.part, materialId: 'mat-ply19' }
    const tps = generatePart(part, machine)
    expect(tps.length).toBeGreaterThan(2)
    // 3. simulated, collision-free
    expect(partCollisions(part, tps, machine).found).toEqual([])
    const stock = simulate(part.length, part.width, part.thickness, tps, 1)
    // the field pocket is cut, the hinge cups are on the underside program
    expect(lowest(stock)).toBeLessThan(0)
    // 4. the export checker: blocked by default, clean with output on
    const { data, job } = jobOf(part, [ply])
    expect(errors(runJob(job, data))).toContain('CAM_OUTPUT_OFF')
    switches(data, true)
    const out = runJob(job, data)
    expect(errors(out)).toEqual([])
    // 5. the programs read back and simulate the same
    const files = writePartPrograms(part, tps, machine, 'PLY19', { withCutout: true })
    expect(files.map((f) => f.side)).toEqual(['front', 'back'])
    const front = readProgram(files[0].text, { machine })
    expect(front.errors).toEqual([])
    const fromFile = simulate(part.length, part.width, part.thickness, front.toolpaths, 1)
    expect(lowest(fromFile)).toBeLessThan(0)
    console.log('[exit] STEP front program read back: stock difference', stockDiff(stock, fromFile).toFixed(4), 'mm;', front.toolpaths.length, 'toolpaths')
    expect(stockDiff(stock, fromFile)).toBeLessThanOrEqual(0.01)
    const back = readProgram(files[1].text, { machine })
    expect(back.errors).toEqual([])
  }, 300_000)
})
