import { describe, expect, it } from 'vitest'
import { type Cutter3D, cutterOfTool, grownCutter, profileHeight } from '@/cam/3d/cutter'
import { DropCutter } from '@/cam/3d/dropcutter'
import { buildMesh } from '@/cam/mesh/build'
import { parseStl } from '@/cam/mesh/read'
import type { Mesh } from '@/cam/mesh/types'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import { relief, rng, type Soup, stlBinary } from './mesh-fixtures'

const meshOf = (soup: Soup): Mesh => buildMesh(parseStl(stlBinary(soup)), { gapTol: 0 }).mesh
const ball: Cutter3D = { kind: 'torus', R: 3, rc: 3 }
const flat: Cutter3D = { kind: 'torus', R: 4, rc: 0 }
const bull: Cutter3D = { kind: 'torus', R: 6, rc: 2 }
const v90: Cutter3D = { kind: 'v', R: 6.35, k: 1 }
const ALL = [ball, flat, bull, v90]

const dropZ = (m: Mesh, c: Cutter3D, x: number, y: number) => {
  const d = new DropCutter(m, c)
  return d.drop(x, y) ? d.z : NaN
}

/** Brute force: the highest contact over dense samples of every facet, edge and corner. */
function bruteDrop(m: Mesh, c: Cutter3D, x: number, y: number, n = 60): number {
  const p = m.positions
  let best = -Infinity
  for (let t = 0; t < m.indices.length; t += 3) {
    const v = [0, 1, 2].map((k) => m.indices[t + k] * 3)
    for (let a = 0; a <= n; a++)
      for (let b = 0; a + b <= n; b++) {
        const u = a / n
        const w = b / n
        const sx = p[v[0]] + (p[v[1]] - p[v[0]]) * u + (p[v[2]] - p[v[0]]) * w
        const sy = p[v[0] + 1] + (p[v[1] + 1] - p[v[0] + 1]) * u + (p[v[2] + 1] - p[v[0] + 1]) * w
        const d = Math.hypot(sx - x, sy - y)
        if (d > c.R) continue
        const sz = p[v[0] + 2] + (p[v[1] + 2] - p[v[0] + 2]) * u + (p[v[2] + 2] - p[v[0] + 2]) * w
        best = Math.max(best, sz - profileHeight(c, d))
      }
  }
  return best
}

describe('M2.2a drop-cutter: closed-form cases', () => {
  const flatTri = meshOf([[-50, -50, -5, 50, -50, -5, 0, 50, -5]])

  it('a flat facet: every cutter rests on it inside; past an edge the tool rolls over the edge', () => {
    for (const c of ALL) expect(dropZ(flatTri, c, 0, 0)).toBeCloseTo(-5, 12)
    // edge y = -50 from (-50,-50) to (50,-50); stand 1 mm outside it (y = -51)
    expect(dropZ(flatTri, ball, 0, -51)).toBeCloseTo(-5 - (3 - Math.sqrt(9 - 1)), 10)
    expect(dropZ(flatTri, flat, 0, -51)).toBeCloseTo(-5, 12)
    expect(dropZ(flatTri, bull, 0, -55)).toBeCloseTo(-5 - (2 - Math.sqrt(4 - 1)), 10)
    expect(dropZ(flatTri, v90, 0, -51)).toBeCloseTo(-6, 10)
    // too far: nothing under the tool
    expect(new DropCutter(flatTri, ball).drop(0, -53.01)).toBe(false)
  })

  for (const deg of [10, 30, 60]) {
    it(`a plane tilted ${deg}°: tip heights match the analytic contacts`, () => {
      const tb = Math.tan((deg * Math.PI) / 180)
      const plane = (x: number) => x * tb
      const m = meshOf([
        [-200, -200, plane(-200), 200, -200, plane(200), 200, 200, plane(200)],
        [-200, -200, plane(-200), 200, 200, plane(200), -200, 200, plane(-200)],
      ])
      const b = (deg * Math.PI) / 180
      const x = 7.3
      // the mesh stores float32 corners, so the plane itself is only good to ~1e-6 mm here
      expect(dropZ(m, ball, x, 1)).toBeCloseTo(plane(x) + 3 * (1 / Math.cos(b) - 1), 5)
      expect(dropZ(m, flat, x, 1)).toBeCloseTo(plane(x + 4), 5)
      expect(dropZ(m, bull, x, 1)).toBeCloseTo(plane(x + 4 + 2 * Math.sin(b)) - 2 * (1 - Math.cos(b)), 5)
      expect(dropZ(m, v90, x, 1)).toBeCloseTo(deg < 45 ? plane(x) : plane(x + 6.35) - 6.35, 5)
    })
  }

  it('a needle-sharp spike: every shape rests on its point with its own profile', () => {
    // sides 89.4° steep, so no cutter can touch them before the point
    const peak = meshOf([
      [-20, -20, -2000, 20, -20, -2000, 0, 0, 0],
      [20, -20, -2000, 20, 20, -2000, 0, 0, 0],
      [20, 20, -2000, -20, 20, -2000, 0, 0, 0],
      [-20, 20, -2000, -20, -20, -2000, 0, 0, 0],
    ])
    for (const c of ALL) for (const d of [0, 1, 2.5]) expect(dropZ(peak, c, d, 0)).toBeCloseTo(-profileHeight(c, d), 9)
  })
})

describe('M2.2a drop-cutter: cross-check against brute force on bumpy meshes', () => {
  it('never below any sampled contact, and within the sampling error above it', () => {
    const r = rng(11)
    const bumps = Array.from({ length: 6 }, () => [r() * 40, r() * 40, 2 + r() * 6, -1 + r() * 3])
    const f = (x: number, y: number) => -8 + bumps.reduce((s, [bx, by, w, h]) => s + h * Math.exp(-((x - bx) ** 2 + (y - by) ** 2) / (w * w)), 0) + 0.3 * Math.sin(x * 0.9) * Math.cos(y * 1.3)
    const m = meshOf(relief(40, 40, 16, 16, f))
    for (const c of ALL)
      for (let i = 0; i < 25; i++) {
        const x = 5 + r() * 30
        const y = 5 + r() * 30
        const z = dropZ(m, c, x, y)
        const brute = bruteDrop(m, c, x, y)
        expect(z).toBeGreaterThanOrEqual(brute - 1e-9)
        // brute force samples facets ~0.04 mm apart; the exact drop can only be a little higher
        expect(z - brute).toBeLessThan(c.kind === 'v' || c.rc === 0 ? 0.05 : 0.01)
      }
  }, 60_000)
})

describe('M2.2a cutters from the tool table', () => {
  it('maps tool shapes; V cutters cannot grow for stock to leave', () => {
    const t = (n: number) => PLACEHOLDER_MACHINE.tools.find((x) => x.number === n)!
    expect(cutterOfTool(t(105))).toEqual({ cutter: { kind: 'torus', R: 3, rc: 3 } })
    expect(cutterOfTool(t(107))).toEqual({ cutter: { kind: 'torus', R: 6, rc: 2 } })
    expect(cutterOfTool(t(102))).toEqual({ cutter: { kind: 'torus', R: 4, rc: 0 } })
    expect('cutter' in cutterOfTool(t(104))).toBe(true)
    expect('error' in cutterOfTool(t(201))).toBe(true)
    expect(grownCutter(ball, 0.5)).toEqual({ kind: 'torus', R: 3.5, rc: 3.5 })
    expect(grownCutter(flat, 0.5)).toEqual({ kind: 'torus', R: 4.5, rc: 0.5 })
    expect(grownCutter(v90, 0.5)).toBeNull()
  })
})
