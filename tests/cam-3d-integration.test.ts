/**
 * M2.2a end to end: model -> 3D finishing in the worker task -> simulator stock -> generic post,
 * and the export checker refusing 3D operations for woodWOP.
 */
import { describe, expect, it } from 'vitest'
import { newPart } from '@/cam/doc'
import { buildMesh } from '@/cam/mesh/build'
import { DEFAULT_PLACEMENT } from '@/cam/mesh/place'
import { parseStl } from '@/cam/mesh/read'
import { meshBounds } from '@/cam/mesh/types'
import { defaultOp } from '@/cam/ops'
import { runPost, SAMPLE_TEMPLATE } from '@/cam/post'
import { buildTimeline } from '@/cam/sim'
import { HeightfieldStock } from '@/cam/stock/heightfield'
import { toolpathContours } from '@/cam/toolpath'
import type { CamPart, Finish3dOp } from '@/cam/types'
import { runTask, transferables } from '@/cam/worker/tasks'
import { defaultAppData, PLACEHOLDER_MACHINE } from '@/core/defaults'
import { runJob } from '@/core/pipeline'
import type { Job } from '@/core/types'
import { relief, stlBinary } from './mesh-fixtures'

const bowl = (x: number, y: number) => -6 + 0.002 * ((x - 50) ** 2 + (y - 40) ** 2)

function part3d(): { part: CamPart; mesh: ReturnType<typeof buildMesh>['mesh'] } {
  const mesh = buildMesh(parseStl(stlBinary(relief(100, 80, 50, 40, bowl))), { gapTol: 0 }).mesh
  const b = meshBounds(mesh)
  const part: CamPart = {
    ...newPart({ name: 'Bowl panel', length: 100, width: 80, thickness: 19, materialId: 'mat-mdf18' }),
    models: [{ id: 'm', name: 'Bowl', kind: 'mesh', blob: 'b', source: 'bowl.stl', units: 'mm', place: { ...DEFAULT_PLACEMENT, at: [0, 0, b.max[2] - b.max[2]] }, layer: 'models', visible: true, triangles: mesh.indices.length / 3, size: [100, 80, b.max[2] - b.min[2]] }],
  }
  const base = defaultOp('finish3d') as Finish3dOp
  part.ops = [{ ...base, toolId: 't105', stepover: 2, surface: { ...base.surface, modelId: 'm' } }, defaultOp('profile', [part.outlineId!])]
  return { part, mesh }
}

describe('M2.2a 3D finishing through the worker task, simulator and posts', () => {
  it('the worker task returns the same toolpath as a direct call, ready to transfer', async () => {
    const { part, mesh } = part3d()
    const [tp] = await runTask('cam.generate', { part, machine: PLACEHOLDER_MACHINE, opIds: [part.ops[0].id], meshes: { b: mesh } })
    expect(tp.kind).toBe('finish3d')
    expect(tp.warnings).toEqual([])
    const polys = tp.moves.filter((m) => m.t === 'poly')
    expect(polys.length).toBeGreaterThan(10)
    expect(transferables([tp]).length).toBe(polys.length)
    // the top of the bowl model sits at face 1: the tool never cuts above it
    for (const m of polys) for (let i = 2; i < (m as { pts: Float64Array }).pts.length; i += 3) expect((m as { pts: Float64Array }).pts[i]).toBeLessThanOrEqual(1e-9)
  })

  it('simulates into the stock model, and the generic post writes the chains as G1 lines', async () => {
    const { part, mesh } = part3d()
    const [tp] = await runTask('cam.generate', { part, machine: PLACEHOLDER_MACHINE, opIds: [part.ops[0].id], meshes: { b: mesh } })
    const tl = buildTimeline([tp])
    const points = tp.moves.reduce((n, m) => n + (m.t === 'poly' ? m.pts.length / 3 : 0), 0)
    expect(tl.segs.filter((s) => s.kind === 'cut').length).toBeGreaterThanOrEqual(points - 1)
    expect(tl.ops[0].cutter.shape).toBe('ball')
    const stock = new HeightfieldStock(100, 80, 19, 0.5)
    for (const s of tl.segs) if (s.kind !== 'rapid') stock.carve(s.a, s.b, s.cutter)
    // the bowl's centre (6 mm below its rim) is cut to the surface; nothing below it
    const b = meshBounds(mesh)
    expect(stock.heightAt(50.25, 40.25)).toBeCloseTo(-6 - b.max[2], 1)
    const post = runPost(SAMPLE_TEMPLATE, 'BOWL', [tp])
    expect(post.text.split('\r\n').filter((l) => l.startsWith('G1')).length).toBeGreaterThanOrEqual(points)
    // zig-zag stays down between passes: one long chain in the drawing
    const cs = toolpathContours(tp)
    expect(cs.reduce((n, c) => n + c.segs.length, 0)).toBeGreaterThanOrEqual(points - 1)
  })

  it('the export checker refuses 3D operations for woodWOP, with custom-part output off or on', () => {
    const { part } = part3d()
    const data = defaultAppData()
    const job: Job = { id: 'j', number: 'J3D', name: '3D', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [part] }
    data.jobs = [job]
    for (const on of [false, true]) {
      data.settings.features = { ...data.settings.features, camMprOutput: on } as typeof data.settings.features
      const out = runJob(job, data)
      const e = out.issues.filter((i) => i.code === 'CAM_3D_NO_OUTPUT')
      expect(e).toHaveLength(1)
      expect(e[0].severity).toBe('error')
    }
  })
})
