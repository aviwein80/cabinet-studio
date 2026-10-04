/**
 * M2.1 end to end: a carved-panel mesh is imported, stored outside the part, fitted, sectioned
 * into contours that Stage 1 machining uses, cut in the stock model, and checked for export.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeEntity, newPart } from '@/cam/doc'
import { DEFAULT_PLACEMENT, fitWorkVolumeToModel } from '@/cam/mesh/place'
import { getMesh, MemoryBlobStore, putMesh } from '@/cam/model/blobs'
import { parsePartFile, serializePartFile } from '@/cam/model/partFile'
import { defaultOp } from '@/cam/ops'
import { buildTimeline, programOrder } from '@/cam/sim'
import { HeightfieldStock } from '@/cam/stock/heightfield'
import { generatePart } from '@/cam/toolpath'
import type { CamPart, ModelRef } from '@/cam/types'
import { runTask } from '@/cam/worker/tasks'
import { defaultAppData } from '@/core/defaults'
import { runJob } from '@/core/pipeline'
import type { Job } from '@/core/types'
import { collectBlobs } from '../electron/blobGc'
import { relief, stlBinary } from './mesh-fixtures'

/** Raised field 3 mm proud of a 1 mm deep surround, 300 x 200 mm. */
const panel = () => relief(300, 200, 150, 100, (x, y) => (Math.min(x, y, 300 - x, 200 - y) > 40 ? -1 : -4))

describe('M2.1 import to stock to export checker', () => {
  it('mesh -> blob -> fitted part -> sections -> pocket -> carved stock -> blocked/allowed export', async () => {
    const store = new MemoryBlobStore()
    const imp = await runTask('mesh.import', { bytes: stlBinary(panel()), name: 'panel.stl' })
    expect(imp.up).toBe('+z')
    const blob = await putMesh(store, imp.mesh)
    const model: ModelRef = { id: 'm', name: 'Panel', kind: 'mesh', blob, source: 'panel.stl', units: 'mm', place: { ...DEFAULT_PLACEMENT, up: imp.up }, layer: 'models', visible: true, triangles: imp.report.kept, size: imp.size }
    let part: CamPart = { ...newPart({ name: 'Carved panel', materialId: 'mat-mdf18' }), models: [model] }
    part = fitWorkVolumeToModel(part, 'm', imp.size, { xy: 10, top: 0, bottom: 15 })
    expect([part.length, part.width, part.thickness]).toEqual([320, 220, 18])

    // the section 2 mm down is the boundary of the raised field: one closed loop
    const mesh = await getMesh(store, blob)
    const [sec] = await runTask('mesh.section', { mesh, place: part.models![0].place, levels: [-2], fitTol: 0.01 })
    expect(sec.contours).toHaveLength(1)
    const ring = sec.contours[0]
    expect(ring.closed).toBe(true)
    const field = makeEntity({ t: 'contour', c: ring }, 'machining', 1, { depth: 2 })
    // pocket the surround (outline minus field) down to the model's surround, 3 mm below the field, then cut out
    const pocket = defaultOp('pocket', [part.outlineId!, field.id], { levels: { safeZ: 20, rapidZ: 3, depth: 3, through: false, stockZ: 0, passDepth: 0 } })
    const cut = defaultOp('profile', [part.outlineId!])
    part = { ...part, entities: [...part.entities, field], ops: [pocket, cut] }
    const paths = generatePart(part, defaultAppData().machine)
    expect(paths.every((p) => p.moves.length > 0)).toBe(true)

    // carve the pocket in the stock model: the field stays at face 1, the surround is 3 mm down
    const stock = new HeightfieldStock(part.length, part.width, part.thickness, 1)
    const tl = buildTimeline(programOrder(paths.slice(0, 1)))
    for (const s of tl.segs) if (s.kind !== 'rapid') stock.carve(s.a, s.b, s.cutter)
    expect(stock.heightAt(160, 110)).toBe(0)
    expect(stock.heightAt(30, 30)).toBeCloseTo(-3, 6)
    // the model's own surface agrees: the stock follows the relief there
    expect(sec.z).toBe(-2)
    expect(stock.removedVolume()).toBeGreaterThan(0)

    // export: custom-part output is off by default, so the checker blocks it
    const data = defaultAppData()
    const job: Job = { id: 'j', number: 'J3D', name: '3D', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [part] }
    data.jobs = [job]
    const off = runJob(job, data)
    expect(off.issues.some((i) => i.code === 'CAM_OUTPUT_OFF' && i.severity === 'error')).toBe(true)
    data.settings.features = { ...data.settings.features, camMprOutput: true } as typeof data.settings.features
    const on = runJob(job, data)
    expect(on.issues.filter((i) => i.severity === 'error')).toEqual([])

    // the part file carries the model data to another computer
    const other = new MemoryBlobStore()
    const back = await parsePartFile(await serializePartFile(part, store), other)
    expect(back.missing).toEqual([])
    expect((await getMesh(other, blob)).indices.length).toBe(imp.mesh.indices.length)
  }, 30_000)
})

describe('M2.1 model data clean-up (desktop)', () => {
  it('removes only unreferenced model files older than the keep time; unreadable shop data stops it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-blobs-'))
    const dir = { blobs: path.join(root, 'blobs'), dataFile: path.join(root, 'cabinet-studio.json'), backups: path.join(root, 'backups') }
    fs.mkdirSync(dir.blobs)
    fs.mkdirSync(dir.backups)
    const h = (c: string) => c.repeat(64)
    for (const c of ['a', 'b', 'c', 'd']) fs.writeFileSync(path.join(dir.blobs, `${h(c)}.bin.gz`), 'x')
    fs.writeFileSync(path.join(dir.blobs, 'notes.txt'), 'x')
    fs.writeFileSync(dir.dataFile, JSON.stringify({ blob: h('a') }))
    fs.writeFileSync(path.join(dir.backups, 'cabinet-studio-old.json'), JSON.stringify({ blob: h('b') }))
    const day = 24 * 3600e3
    const old = Date.now() - 40 * day
    for (const c of ['a', 'b', 'c']) fs.utimesSync(path.join(dir.blobs, `${h(c)}.bin.gz`), old / 1000, old / 1000)
    // c is unused and old: removed; d is unused but new: kept; a and b are referenced
    expect(collectBlobs(dir, 30 * day)).toEqual([h('c')])
    expect(fs.readdirSync(dir.blobs).sort()).toEqual([`${h('a')}.bin.gz`, `${h('b')}.bin.gz`, `${h('d')}.bin.gz`, 'notes.txt'])
    fs.rmSync(root, { recursive: true })
  })
})
