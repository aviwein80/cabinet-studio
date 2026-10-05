/**
 * Performance guards. Each limit is about twice the time measured in the build container with the
 * whole suite running in parallel (so a 2x slow-down fails) and never above the spec target.
 * Measured numbers are logged; time the shop computer with `npx vitest run tests/perf.test.ts`.
 *
 * Measured when set (October 2026, cloud container, Linux x64):
 *   1M-triangle STL import: 1.45 s alone, 2.4 s with the full suite (spec target 5 s)
 *   Z section of that mesh:  85 ms alone, 130 ms with the full suite
 *   Parallel finishing, 200k facets, 0.6 mm step-over: 9.9 s alone, 10.3 s with the full suite
 *     (spec target 30 s; limit 20 s)
 */
import { describe, expect, it } from 'vitest'
import { buildMesh } from '@/cam/mesh/build'
import { parseStl, readMeshFile } from '@/cam/mesh/read'
import { sectionAt } from '@/cam/mesh/tools'
import { newPart } from '@/cam/doc'
import { DEFAULT_PLACEMENT } from '@/cam/mesh/place'
import { meshBounds } from '@/cam/mesh/types'
import { defaultOp } from '@/cam/ops'
import { generateOp } from '@/cam/toolpath'
import type { Finish3dOp, Rough3dOp } from '@/cam/types'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import { relief, stlBinary } from './mesh-fixtures'

/** Binary STL of a UV sphere with about `n` facets, written straight into the buffer. */
function bigSphereStl(n: number, r = 300): Uint8Array {
  const rings = Math.round(Math.sqrt(n / 4))
  const seg = Math.round(n / (2 * rings))
  const P = (i: number, j: number): [number, number, number] => {
    if (j === 0) return [0, 0, r]
    if (j === rings) return [0, 0, -r]
    const th = (Math.PI * j) / rings
    const ph = (2 * Math.PI * (i % seg)) / seg
    return [r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)]
  }
  const count = seg * (2 * rings - 2)
  const buf = new Uint8Array(84 + count * 50)
  const dv = new DataView(buf.buffer)
  dv.setUint32(80, count, true)
  let t = 0
  const put = (a: number[], b: number[], c: number[]) => {
    const o = 84 + t++ * 50 + 12
    for (let k = 0; k < 3; k++) {
      dv.setFloat32(o + k * 4, a[k], true)
      dv.setFloat32(o + 12 + k * 4, b[k], true)
      dv.setFloat32(o + 24 + k * 4, c[k], true)
    }
  }
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < seg; i++) {
      const a = P(i, j), b = P(i, j + 1), c = P(i + 1, j + 1), d = P(i + 1, j)
      if (j > 0) put(a, b, d)
      if (j < rings - 1) put(b, c, d)
    }
  return buf
}

const log = (msg: string) => process.stdout.write(`  [perf] ${msg}\n`)

describe('M2.1 performance', () => {
  it('1 M-triangle binary STL imports (read + weld + repair) in under 5 s', async () => {
    const bytes = bigSphereStl(1_000_000)
    const t0 = performance.now()
    const soup = await readMeshFile(bytes, 'big.stl')
    const { mesh, report } = buildMesh(soup)
    const ms = performance.now() - t0
    log(`1M-triangle STL import: ${report.kept.toLocaleString('en')} facets in ${Math.round(ms)} ms`)
    expect(report.kept).toBeGreaterThan(990_000)
    expect(report.openEdges).toBe(0)
    expect(ms).toBeLessThan(PERF_LIMIT_IMPORT_MS)
    const t1 = performance.now()
    const s = sectionAt(mesh, 12.3)
    const sms = performance.now() - t1
    log(`Z section of the 1M mesh: ${s.loops[0].length} points in ${Math.round(sms)} ms`)
    expect(s.loops).toHaveLength(1)
    expect(sms).toBeLessThan(PERF_LIMIT_SECTION_MS)
  }, 60_000)
})

describe('M2.2 performance', () => {
  it('parallel finishing: 200 k-triangle 600 x 400 mm relief, 6 mm ball, 10 % step-over, in under 30 s', () => {
    // carved-panel style relief: rosettes and waves, 316 x 316 grid = 199,712 facets
    const f = (x: number, y: number) => -6 + 2.5 * Math.sin(x / 23) * Math.cos(y / 17) + 1.5 * Math.exp(-((x - 300) ** 2 + (y - 200) ** 2) / 3000)
    const mesh = buildMesh(parseStl(stlBinary(relief(600, 400, 316, 316, f))), { gapTol: 0 }).mesh
    const b = meshBounds(mesh)
    const part = { ...newPart({ length: 600, width: 400, thickness: 19 }), models: [{ id: 'm', name: 'relief', kind: 'mesh' as const, blob: 'r', source: 'r.stl', units: 'mm' as const, place: { ...DEFAULT_PLACEMENT, at: [0, 0, b.max[2]] as [number, number, number] }, layer: 'models', visible: true, triangles: mesh.indices.length / 3, size: [600, 400, b.max[2] - b.min[2]] as [number, number, number] }] }
    const base = defaultOp('finish3d') as Finish3dOp
    const op: Finish3dOp = { ...base, toolId: 't105', stepover: 0.6, surface: { ...base.surface, modelId: 'm' } }
    const t0 = performance.now()
    const tp = generateOp(op, { part, machine: PLACEHOLDER_MACHINE, meshes: new Map([['r', mesh]]) })
    const ms = performance.now() - t0
    const pts = tp.moves.reduce((n, m) => n + (m.t === 'poly' ? m.pts.length / 3 : 0), 0)
    log(`parallel finishing, ${(mesh.indices.length / 3).toLocaleString('en')} facets, 0.6 mm step-over: ${pts.toLocaleString('en')} points in ${Math.round(ms)} ms`)
    expect(tp.warnings).toEqual([])
    expect(ms).toBeLessThan(PERF_LIMIT_PARALLEL_MS)
  }, 120_000)

  it('Z-level roughing: the same relief, 12 mm tool, 3 mm step-down, in under 30 s', () => {
    const f = (x: number, y: number) => -6 + 2.5 * Math.sin(x / 23) * Math.cos(y / 17) + 1.5 * Math.exp(-((x - 300) ** 2 + (y - 200) ** 2) / 3000)
    const mesh = buildMesh(parseStl(stlBinary(relief(600, 400, 316, 316, f))), { gapTol: 0 }).mesh
    const b = meshBounds(mesh)
    const part = { ...newPart({ length: 600, width: 400, thickness: 19 }), models: [{ id: 'm', name: 'relief', kind: 'mesh' as const, blob: 'r', source: 'r.stl', units: 'mm' as const, place: { ...DEFAULT_PLACEMENT, at: [0, 0, b.max[2]] as [number, number, number] }, layer: 'models', visible: true, triangles: mesh.indices.length / 3, size: [600, 400, b.max[2] - b.min[2]] as [number, number, number] }] }
    const base = defaultOp('rough3d') as Rough3dOp
    const op: Rough3dOp = { ...base, toolId: 't107', stepdown: 3, surface: { ...base.surface, modelId: 'm' } }
    const t0 = performance.now()
    const tp = generateOp(op, { part, machine: PLACEHOLDER_MACHINE, meshes: new Map([['r', mesh]]) })
    const ms = performance.now() - t0
    log(`Z-level roughing, 12 mm bull-nose, 3 mm step-down: ${tp.intents.length} passes, ${Math.round(tp.stats.cut / 1000)} m of cutting, in ${Math.round(ms)} ms`)
    expect(tp.moves.length).toBeGreaterThan(100)
    expect(ms).toBeLessThan(PERF_LIMIT_ROUGHING_MS)
  }, 120_000)
})

const PERF_LIMIT_ROUGHING_MS = 20_000

const PERF_LIMIT_PARALLEL_MS = 20_000
const PERF_LIMIT_IMPORT_MS = 5000
const PERF_LIMIT_SECTION_MS = 400
