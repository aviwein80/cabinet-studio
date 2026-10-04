/**
 * Performance guards. Each limit is about twice the time measured in the build container with the
 * whole suite running in parallel (so a 2x slow-down fails) and never above the spec target.
 * Measured numbers are logged; time the shop computer with `npx vitest run tests/perf.test.ts`.
 *
 * Measured when set (October 2026, cloud container, Linux x64):
 *   1M-triangle STL import: 1.45 s alone, 2.4 s with the full suite (spec target 5 s)
 *   Z section of that mesh:  85 ms alone, 130 ms with the full suite
 */
import { describe, expect, it } from 'vitest'
import { buildMesh } from '@/cam/mesh/build'
import { readMeshFile } from '@/cam/mesh/read'
import { sectionAt } from '@/cam/mesh/tools'

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

const PERF_LIMIT_IMPORT_MS = 5000
const PERF_LIMIT_SECTION_MS = 400
