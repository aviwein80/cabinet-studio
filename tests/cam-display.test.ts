/**
 * M3.1g plan view of very large toolpaths (owner decision 5): drawn simplified for the screen
 * within a point budget, every point drawn a real toolpath point, every real point within the
 * stated tolerance of the drawing, and the toolpath itself never changed. The owner's case: the
 * Z-level roughing of the lip part with the default settings (about 472,000 points), which stopped
 * the plan view from drawing.
 */
import { describe, expect, it } from 'vitest'
import { displayPaths, movePoints, simplifyIdx } from '@/cam/display'
import { newPart } from '@/cam/doc'
import { DEFAULT_PLACEMENT } from '@/cam/mesh/place'
import { meshBounds } from '@/cam/mesh/types'
import { defaultOp } from '@/cam/ops'
import { generateOp, type Move, type Toolpath } from '@/cam/toolpath'
import type { CamPart, Rough3dOp } from '@/cam/types'
import { runTask } from '@/cam/worker/tasks'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import { LIP, prism } from './undercut-fixtures'

/** Plan polylines of a drawing's path data (an arc's end starts a new one: arcs are checked apart). */
function polylines(d: string): [number, number][][] {
  const out: [number, number][][] = []
  for (const tok of d.match(/[MLA][^MLA]+/g) ?? []) {
    const v = tok.slice(1).trim().split(/\s+/).map(Number)
    if (tok[0] === 'A') out.push([[v[5], v[6]]])
    else if (tok[0] === 'M') out.push([[v[0], v[1]]])
    else out[out.length - 1].push([v[0], v[1]])
  }
  return out
}

/** Distance from a point to the nearest piece of the drawing (pieces kept in a grid). */
function distanceTo(lines: [number, number][][], cell = 2) {
  const grid = new Map<string, [number, number, number, number][]>()
  const key = (i: number, j: number) => `${i},${j}`
  for (const l of lines)
    for (let k = 1; k < l.length; k++) {
      const [ax, ay] = l[k - 1]
      const [bx, by] = l[k]
      for (let i = Math.floor(Math.min(ax, bx) / cell); i <= Math.floor(Math.max(ax, bx) / cell); i++)
        for (let j = Math.floor(Math.min(ay, by) / cell); j <= Math.floor(Math.max(ay, by) / cell); j++) {
          const g = grid.get(key(i, j)) ?? []
          g.push([ax, ay, bx, by])
          grid.set(key(i, j), g)
        }
    }
  return (x: number, y: number) => {
    let best = Infinity
    const i0 = Math.floor(x / cell)
    const j0 = Math.floor(y / cell)
    for (let i = i0 - 1; i <= i0 + 1; i++)
      for (let j = j0 - 1; j <= j0 + 1; j++)
        for (const [ax, ay, bx, by] of grid.get(key(i, j)) ?? []) {
          const dx = bx - ax
          const dy = by - ay
          const L2 = dx * dx + dy * dy
          const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0
          best = Math.min(best, Math.hypot(ax + dx * t - x, ay + dy * t - y))
        }
    return best
  }
}

/** The plan view's drawing before M3.1g (kept here only to measure what it cost). */
function drawingBefore(tp: Toolpath) {
  let x = 0
  let y = 0
  let first = true
  let cut = ''
  let rapid = ''
  const drills: { x: number; y: number }[] = []
  const f = (n: number) => (Math.round(n * 1000) / 1000).toString()
  for (const m of tp.moves) {
    if (m.t === 'poly') {
      // 3D chains can hold millions of points: draw a point once it is 0.25 mm from the last one
      const p = m.pts
      let d = first ? '' : `M${f(x)} ${f(y)}`
      for (let i = 0; i + 2 < p.length; i += 3) {
        const last = i + 3 >= p.length
        if (first) {
          x = p[i]
          y = p[i + 1]
          first = false
          d = `M${f(x)} ${f(y)}`
          continue
        }
        if (!last && Math.hypot(p[i] - x, p[i + 1] - y) < 0.25) continue
        x = p[i]
        y = p[i + 1]
        d += `L${f(x)} ${f(y)}`
      }
      cut += d
      continue
    }
    if (m.t === 'drill') {
      drills.push({ x: m.x, y: m.y })
      x = m.x
      y = m.y
      continue
    }
    if (first) {
      x = m.x
      y = m.y
      first = false
      continue
    }
    if (m.t === 'rapid') {
      if (Math.abs(m.x - x) > 1e-9 || Math.abs(m.y - y) > 1e-9) rapid += `M${f(x)} ${f(y)}L${f(m.x)} ${f(m.y)}`
    } else if (m.t === 'feed') {
      if (Math.abs(m.x - x) > 1e-9 || Math.abs(m.y - y) > 1e-9) cut += `M${f(x)} ${f(y)}L${f(m.x)} ${f(m.y)}`
    } else {
      const r = Math.hypot(x - m.cx, y - m.cy)
      const a0 = Math.atan2(y - m.cy, x - m.cx)
      let a1 = Math.atan2(m.y - m.cy, m.x - m.cx)
      if (m.ccw && a1 <= a0) a1 += 2 * Math.PI
      if (!m.ccw && a1 >= a0) a1 -= 2 * Math.PI
      cut += `M${f(x)} ${f(y)}A${f(r)} ${f(r)} 0 ${Math.abs(a1 - a0) > Math.PI ? 1 : 0} ${m.ccw ? 1 : 0} ${f(m.x)} ${f(m.y)}`
    }
    x = m.x
    y = m.y
  }
  const m0 = tp.moves.find((m) => m.t !== 'rapid')
  const start = m0?.t === 'poly' ? (m0.pts.length >= 2 ? { x: m0.pts[0], y: m0.pts[1] } : undefined) : m0
  return { cut, rapid, drills, start }
}


/** A deep copy of the moves, to show the toolpath is not changed. */
const copyMoves = (ms: Move[]) => ms.map((m) => (m.t === 'poly' ? { ...m, pts: Float64Array.from(m.pts) } : { ...m }))

describe('M3.1g plan view of very large toolpaths', () => {
  it("the owner's case: the lip part's Z-level roughing with the default settings, drawn within the budget, true to the toolpath, the toolpath unchanged", () => {
    const mesh = prism(LIP, 60)
    const b = meshBounds(mesh)
    const part: CamPart = { ...newPart({ name: 'Lip', length: 80, width: 60, thickness: 50 }), models: [{ id: 'm', name: 'Lip', kind: 'mesh', blob: 'lip', source: 'lip.stl', units: 'mm', place: { ...DEFAULT_PLACEMENT, at: [b.min[0], b.min[1], b.max[2]] }, layer: 'models', visible: true, triangles: mesh.indices.length / 3, size: [80, 60, 50] }] }
    const r = defaultOp('rough3d') as Rough3dOp
    const op: Rough3dOp = { ...r, surface: { ...r.surface, modelId: 'm' } }
    part.ops = [op]
    const tp = generateOp(op, { part, machine: PLACEHOLDER_MACHINE, meshes: new Map([['lip', mesh]]) })
    const total = movePoints(tp.moves)
    expect(total).toBeGreaterThan(300_000)
    const before = copyMoves(tp.moves)
    const t0 = performance.now()
    const dp = displayPaths(tp)
    const ms = performance.now() - t0
    expect(tp.moves).toEqual(before)
    expect(dp.total).toBe(total)
    expect(dp.drawn).toBeLessThanOrEqual(60_000)
    expect(dp.tol).toBeGreaterThan(0)
    expect(dp.tol).toBeLessThanOrEqual(0.25)
    // every point of every cutting chain is within the tolerance of the drawing
    const lines = polylines(dp.cut)
    const dist = distanceTo(lines)
    let worst = 0
    let n = 0
    for (const m of tp.moves)
      if (m.t === 'poly')
        for (let i = 0; i < m.pts.length; i += 3 * 7) {
          worst = Math.max(worst, dist(m.pts[i], m.pts[i + 1]))
          n++
        }
    expect(worst).toBeLessThanOrEqual(dp.tol + 0.001)
    // and every point drawn is a point of the toolpath (rounded to 0.001 mm for the drawing)
    const real = new Set<string>()
    for (const m of tp.moves) if (m.t === 'poly') for (let i = 0; i < m.pts.length; i += 3) real.add(`${Math.round(m.pts[i] * 1000)},${Math.round(m.pts[i + 1] * 1000)}`)
    for (const m of tp.moves) if (m.t !== 'poly') real.add(`${Math.round(m.x * 1000)},${Math.round(m.y * 1000)}`)
    let foreign = 0
    for (const l of lines) for (const [x, y] of l) if (!real.has(`${Math.round(x * 1000)},${Math.round(y * 1000)}`)) foreign++
    expect(foreign).toBe(0)
    // what the drawing cost before: every straight feed its own piece, rebuilt on every redraw
    const t1 = performance.now()
    const before0 = drawingBefore(tp)
    const msBefore = performance.now() - t1
    expect(before0.cut.length).toBeGreaterThan(20 * dp.cut.length)
    process.stdout.write(`  [plan view] lip part, Z-level roughing (defaults, placeholder T107): ${total.toLocaleString('en')} points drawn as ${dp.drawn.toLocaleString('en')} (within ${dp.tol} mm; ${n.toLocaleString('en')} points checked, worst ${worst.toFixed(4)} mm) in ${ms.toFixed(0)} ms, once; path data ${(dp.cut.length / 1e6).toFixed(2)} MB. Before: ${(before0.cut.length / 1e6).toFixed(1)} MB of path data built in ${msBefore.toFixed(0)} ms on every redraw (pan, zoom, hover)\n`)
  }, 180_000)

  it('small toolpaths are drawn exactly; straight 3D passes collapse to their ends in plan; rapids, drills and arcs are kept', () => {
    const moves: Move[] = [
      { t: 'rapid', x: 0, y: 0, z: 10 },
      { t: 'feed', x: 0, y: 0, z: -1, f: 'plunge' },
      { t: 'poly', pts: Float64Array.from([1, 0, -1, 2, 0, -1.5, 3, 0, -1.2, 4, 0, -1]), f: 'cut' },
      { t: 'arc', x: 4, y: 4, z: -1, cx: 4, cy: 2, ccw: true, f: 'cut' },
      { t: 'rapid', x: 4, y: 4, z: 10 },
      { t: 'rapid', x: 10, y: 10, z: 10 },
      { t: 'drill', x: 10, y: 10, z: -5, r: 2, peck: 0, dwell: 0 },
    ]
    const exact = displayPaths({ moves })
    expect(exact.tol).toBe(0)
    expect(exact.cut).toBe('M0 0L1 0L2 0L3 0L4 0M4 0A2 2 0 0 1 4 4')
    expect(exact.rapid).toBe('M4 4L10 10')
    expect(exact.drills).toEqual([{ x: 10, y: 10 }])
    expect(exact.start).toEqual({ x: 0, y: 0 })
    // a big straight pass along X (3D: z changes, plan does not): two points in plan
    const n = 200_000
    const pts = new Float64Array(n * 3)
    for (let i = 0; i < n; i++) pts.set([i * 0.001, 5, -Math.sin(i / 1000)], i * 3)
    const big = displayPaths({ moves: [{ t: 'rapid', x: 0, y: 5, z: 5 }, { t: 'feed', x: 0, y: 5, z: 0, f: 'plunge' }, { t: 'poly', pts, f: 'cut' }] }, { budget: 10_000 })
    expect(big.drawn).toBeLessThan(10)
    expect(big.tol).toBeGreaterThan(0)
  })

  it('simplification keeps the ends and every corner beyond the tolerance', () => {
    const xs = Float64Array.from([0, 1, 2, 3, 3, 3])
    const ys = Float64Array.from([0, 0.004, 0, 0, 1, 2])
    expect(Array.from(simplifyIdx(xs, ys, 0.01))).toEqual([1, 0, 0, 1, 0, 1])
    expect(Array.from(simplifyIdx(xs, ys, 0.001))).toEqual([1, 1, 1, 1, 0, 1])
  })

  it('the background worker gives the same drawing (the moves are copied to it, never moved)', async () => {
    const pts = new Float64Array(150_000 * 3)
    for (let i = 0; i < 150_000; i++) pts.set([Math.cos(i / 500) * 30, Math.sin(i / 500) * 30 + i * 0.0001, -2], i * 3)
    const tp = { moves: [{ t: 'poly', pts, f: 'cut' }] as Move[] } as Pick<Toolpath, 'moves'>
    const direct = displayPaths(tp)
    const viaTask = await runTask('toolpath.display', { moves: tp.moves })
    expect(viaTask).toEqual(direct)
    expect(pts[3]).toBeCloseTo(Math.cos(1 / 500) * 30, 12)
  })
})
