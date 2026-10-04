import { describe, expect, it } from 'vitest'
import { DEFAULT_PLACEMENT } from '@/cam/mesh/place'
import { ComputeClient, type WorkerLike } from '@/cam/worker/client'
import { type FromWorker, serve, type ToWorker } from '@/cam/worker/serve'
import { runTask } from '@/cam/worker/tasks'
import { Cancelled } from '@/core/cancel'
import { box, relief, sphere, stlBinary } from './mesh-fixtures'

/** In-process stand-in for a Web Worker: same message handling, delivered asynchronously. */
class FakeWorker implements WorkerLike {
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  dead = false
  private delay: number
  constructor(delay = 0) {
    this.delay = delay
  }
  postMessage(msg: ToWorker) {
    setTimeout(() => {
      if (this.dead) return
      void serve(msg, (m) => {
        if (!this.dead) this.onmessage?.({ data: m } as MessageEvent<FromWorker>)
      })
    }, this.delay)
  }
  terminate() {
    this.dead = true
  }
}

describe('M2.1 background tasks (3D-12)', () => {
  it('import task: reads, repairs, picks the up axis that lays the model flat', async () => {
    const r = await runTask('mesh.import', { bytes: stlBinary(box(0, 0, 0, 30, 400, 600)), name: 'panel.stl' })
    expect(r.report.kept).toBe(12)
    expect(r.up).toBe('+x')
    expect(r.size.map(Math.round)).toEqual([600, 400, 30])
  })

  it('pack/unpack round-trips and refuses damaged data', async () => {
    const { mesh } = await runTask('mesh.import', { bytes: stlBinary(sphere(10)), name: 's.stl' })
    const p = await runTask('blob.pack', { mesh })
    const back = await runTask('blob.unpack', p)
    expect(back.indices.length).toBe(mesh.indices.length)
    await expect(runTask('blob.unpack', { gz: p.gz, hash: '1'.repeat(64) })).rejects.toThrow(/damaged/)
  })

  it('section task works on the placed model: top at face 1, loops closed', async () => {
    const { mesh, up } = await runTask('mesh.import', { bytes: stlBinary(sphere(20, 64, 32)), name: 's.stl', up: 'auto' })
    const place = { ...DEFAULT_PLACEMENT, up, at: [10, 10, 0] as [number, number, number] }
    const out = await runTask('mesh.section', { mesh, place, levels: [-1, -20, -39.5], fitTol: 0 })
    expect(out.map((s) => s.contours.length)).toEqual([1, 1, 1])
    expect(out.every((s) => s.contours.every((c) => c.closed))).toBe(true)
    const outline = await runTask('mesh.outline', { mesh, place })
    expect(outline).toHaveLength(1)
  })

  it('delete-facets task returns a repaired mesh and report', async () => {
    const { mesh } = await runTask('mesh.import', { bytes: stlBinary(box(0, 0, 0, 10, 10, 10)), name: 'b.stl' })
    const r = await runTask('mesh.deleteFacets', { mesh, filter: { k: 'facing-down', maxDeg: 5 } })
    expect(r.report.kept).toBe(10)
    expect(r.report.openEdges).toBe(4)
  })

  it('a shared cancel flag stops a task cleanly', async () => {
    const cancel = new SharedArrayBuffer(4)
    Atomics.store(new Int32Array(cancel), 0, 1)
    const got: FromWorker[] = []
    await serve({ id: 1, task: 'mesh.import', input: { bytes: stlBinary(sphere(10, 512, 256)), name: 's.stl' }, cancel }, (m) => got.push(m))
    expect(got.at(-1)).toEqual({ id: 1, kind: 'error', message: 'Cancelled', cancelled: true })
  })

  it('client: results, progress, cancel ends and replaces the worker, errors come back as errors', async () => {
    let made = 0
    const c = new ComputeClient(() => (made++, new FakeWorker(30)), 1)
    const notes: number[] = []
    const ok = await c.run('mesh.import', { bytes: stlBinary(relief(400, 300, 200, 150, (x) => -2 + Math.sin(x / 9))), name: 'r.stl' }, { onProgress: (f) => notes.push(f) })
    expect(ok.report.kept).toBe(2 * 200 * 150)
    expect(notes.length).toBeGreaterThan(0)
    expect(made).toBe(1)

    const ac = new AbortController()
    const p = c.run('mesh.import', { bytes: stlBinary(sphere(10)), name: 's.stl' }, { signal: ac.signal })
    await new Promise((r) => setTimeout(r, 10)) // the worker has the job (it starts after 30 ms)
    ac.abort()
    await expect(p).rejects.toBeInstanceOf(Cancelled)
    // the next task gets a fresh worker and still works
    const again = await c.run('mesh.size', { mesh: ok.mesh, place: DEFAULT_PLACEMENT })
    expect(again[0]).toBeCloseTo(400, 3)
    expect(made).toBe(2)

    await expect(c.run('mesh.import', { bytes: new TextEncoder().encode('junk'), name: 'x.stl' })).rejects.toThrow(/STL/)
    const pre = new AbortController()
    pre.abort()
    await expect(c.run('mesh.size', { mesh: ok.mesh, place: DEFAULT_PLACEMENT }, { signal: pre.signal })).rejects.toBeInstanceOf(Cancelled)
    c.dispose()
  })

  it('client: a pool of one runs calls one after another', async () => {
    const c = new ComputeClient(() => new FakeWorker(5), 1)
    const { mesh } = await runTask('mesh.import', { bytes: stlBinary(box(0, 0, 0, 1, 2, 3)), name: 'b.stl' })
    const sizes = await Promise.all([1, 2, 3].map((s) => c.run('mesh.size', { mesh, place: { ...DEFAULT_PLACEMENT, scale: s } })))
    expect(sizes.map((x) => Math.round(x[2]))).toEqual([3, 6, 9])
    c.dispose()
  })
})
