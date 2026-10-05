/**
 * M2.4b stock simulation (SIM-02) on the `StockModel` interface: removed volume against analytic
 * volumes for a real pocket and a real profile, lazy carving back and forth (saved states),
 * playback with separate feed and rapid speeds, stop at tool change or at a mark, stepping by
 * move, dirty-region shading, section meshes and a watertight stock STL.
 */
import { describe, expect, it } from 'vitest'
import { makeEntity, newPart } from '@/cam/doc'
import { circle, pt, roundedRect } from '@/cam/geom'
import { buildMesh } from '@/cam/mesh/build'
import { parseStl } from '@/cam/mesh/read'
import { writeStl } from '@/cam/mesh/tools'
import { meshVolume } from '@/cam/mesh/types'
import { defaultOp } from '@/cam/ops'
import { buildTimeline, cellRect, shadeHeightfield } from '@/cam/sim'
import { HeightfieldStock, stockMesh } from '@/cam/stock/heightfield'
import { advance, carveStock, moveEnd, simCell, StockSimulation, stepMove, toolChanges } from '@/cam/stock/simulation'
import { generatePart } from '@/cam/toolpath'
import type { CamOp, CamPart } from '@/cam/types'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import { isWatertight } from './mesh-fixtures'

const machine = PLACEHOLDER_MACHINE
const lv = (depth: number, passDepth = 0) => ({ safeZ: 20, rapidZ: 3, depth, through: false, stockZ: 0, passDepth })
const NO_LEADS = { in: 'none', out: 'none', length: 0, radius: 0, rampAngle: 5, overlap: 0, feedPct: 50 } as const

function part(ops: (ids: Record<string, string>) => CamOp[]): CamPart {
  const p = newPart({ name: 'Sim', length: 300, width: 200, thickness: 18, materialId: 'mat-mdf18', entities: [] })
  const pocket = makeEntity({ t: 'contour', c: roundedRect(30, 40, 100, 60, 8) }, 'machining')
  const ring = makeEntity({ t: 'contour', c: circle(pt(220, 100), 40) }, 'machining')
  p.entities = [pocket, ring]
  p.ops = ops({ pocket: pocket.id, ring: ring.id })
  return p
}

const op = <K extends CamOp['kind']>(k: K, ids: string[], extra: Partial<CamOp> = {}) => ({ ...defaultOp(k, ids), ...extra }) as CamOp

function removed(p: CamPart, cell = 0.5) {
  const tl = buildTimeline(generatePart(p, machine))
  const s = new HeightfieldStock(p.length, p.width, p.thickness, cell)
  carveStock(s, tl, 0, tl.total + 1)
  return s.removedVolume()
}

describe('M2.4b removed volume (0.5 mm cells, real toolpaths)', () => {
  it('pocket: rounded rectangle 100 x 60 R8, 6 mm deep in two passes, 8 mm tool: within 1 % of the analytic volume', () => {
    const p = part((id) => [op('pocket', [id.pocket], { toolId: 't102', levels: lv(6, 3) })])
    const analytic = (100 * 60 - (4 - Math.PI) * 64) * 6
    const v = removed(p)
    process.stdout.write(`  [stock] pocket: ${v.toFixed(0)} mm³ vs ${analytic.toFixed(0)} mm³ analytic (${(((v - analytic) / analytic) * 100).toFixed(3)} %)\n`)
    expect(Math.abs(v - analytic) / analytic).toBeLessThan(0.01)
  })

  it('profile: inside a 40 mm radius circle, 5 mm deep, 12 mm tool, no leads: within 1 % of the annulus', () => {
    const p = part((id) => [op('profile', [id.ring], { side: 'inside', toolId: 't101', levels: lv(5), leads: { ...NO_LEADS } } as Partial<CamOp>)])
    const analytic = Math.PI * (40 ** 2 - 28 ** 2) * 5
    const v = removed(p)
    process.stdout.write(`  [stock] profile: ${v.toFixed(0)} mm³ vs ${analytic.toFixed(0)} mm³ analytic (${(((v - analytic) / analytic) * 100).toFixed(3)} %)\n`)
    expect(Math.abs(v - analytic) / analytic).toBeLessThan(0.01)
  })
})

describe('M2.4b playback', () => {
  const p = part((id) => [op('pocket', [id.pocket], { toolId: 't102', levels: lv(6, 3) }), op('profile', [id.ring], { side: 'inside', toolId: 't101', levels: lv(5) }), op('pocket', [id.ring], { toolId: 't101', levels: lv(2) })])
  const tl = buildTimeline(generatePart(p, machine))

  it('carves lazily back and forth and always matches one straight carve to that time', () => {
    const sim = new StockSimulation(tl, new HeightfieldStock(p.length, p.width, p.thickness, 1))
    const times = [0.9, 0.3, 0.6, 0.05, 1, 0.45, 0.45, 0.2].map((f) => f * tl.total)
    for (const t of times) {
      sim.syncTo(t)
      const ref = new HeightfieldStock(p.length, p.width, p.thickness, 1)
      carveStock(ref, tl, 0, t)
      expect(sim.at).toBe(t)
      expect(Buffer.from((sim.stock as HeightfieldStock).hf.top.buffer).equals(Buffer.from(ref.hf.top.buffer)), `t=${t}`).toBe(true)
    }
  })

  it('rapids and feed moves play at their own speeds', () => {
    const rapids = tl.segs.filter((s) => s.kind === 'rapid').reduce((n, s) => n + s.t1 - s.t0, 0)
    const feeds = tl.total - rapids
    // whole program in real seconds: feed time / speed + rapid time / rapid speed
    let t = 0
    let real = 0
    const dt = 0.01
    for (let guard = 0; guard < 1e6 && t < tl.total; guard++) {
      const r = advance(tl, t, dt, { speed: 10, rapidSpeed: 40 })
      t = r.t
      real += dt
      if (r.stop) break
    }
    expect(t).toBe(tl.total)
    expect(Math.abs(real - (feeds / 10 + rapids / 40))).toBeLessThan(0.02)
  })

  it('stops at a tool change (only where the tool changes) and at a chosen time', () => {
    expect(tl.ops.map((o) => o.toolNumber)).toEqual([102, 101, 101])
    expect(toolChanges(tl, 0, 1)).toBe(true)
    expect(toolChanges(tl, 1, 2)).toBe(false)
    const a = advance(tl, 0, 1e9, { speed: 1, rapidSpeed: 1, stopAtToolChange: true })
    expect(a).toEqual({ t: tl.ops[1].start, stop: 'tool-change' })
    // the next stop is the end (no tool change between ops 1 and 2)
    expect(advance(tl, a.t, 1e9, { speed: 1, rapidSpeed: 1, stopAtToolChange: true })).toEqual({ t: tl.total, stop: 'end' })
    const mark = tl.total * 0.37
    expect(advance(tl, 0, 1e9, { speed: 1, rapidSpeed: 1, stopAt: mark })).toEqual({ t: mark, stop: 'mark' })
  })

  it('steps one move at a time, forward and back, and finds the end of any move', () => {
    let t = 0
    const ends: number[] = []
    for (let k = 0; k < 40; k++) ends.push((t = stepMove(tl, t, 1)))
    for (let k = 1; k < ends.length; k++) expect(ends[k]).toBeGreaterThan(ends[k - 1])
    // each step ends exactly where some move ends
    for (const e of ends) expect(tl.segs.some((s) => Math.abs(s.t1 - e) < 1e-12 && (tl.segs[tl.segs.indexOf(s) + 1]?.move !== s.move || tl.segs[tl.segs.indexOf(s) + 1]?.op !== s.op))).toBe(true)
    // back from the end of move k goes to its start, then to the previous move's start
    const s10 = stepMove(tl, ends[10], -1)
    expect(s10).toBeCloseTo(ends[9], 12)
    expect(stepMove(tl, s10, -1)).toBeCloseTo(ends[8], 12)
    expect(stepMove(tl, 0, -1)).toBe(0)
    expect(stepMove(tl, tl.total, 1)).toBe(tl.total)
    const seg = tl.segs[200]
    const end = moveEnd(tl, seg.op, seg.move)!
    expect(end).toBeGreaterThanOrEqual(seg.t1)
    expect(moveEnd(tl, seg.op, 1e9)).toBeNull()
  })

  it('shading only the changed cells gives the same picture as shading everything', () => {
    const s = new HeightfieldStock(p.length, p.width, p.thickness, 1)
    const sim = new StockSimulation(tl, s)
    const { hf } = s
    const inc = new Uint8ClampedArray(hf.nx * hf.ny * 4)
    shadeHeightfield(hf, inc, { base: [200, 170, 120] })
    s.takeDirty()
    for (let k = 1; k <= 25; k++) {
      sim.syncTo((tl.total * k) / 25)
      const d = s.takeDirty()
      if (d) shadeHeightfield(hf, inc, { base: [200, 170, 120], rect: cellRect(hf, d, 1) })
    }
    const full = new Uint8ClampedArray(hf.nx * hf.ny * 4)
    shadeHeightfield(hf, full, { base: [200, 170, 120] })
    expect(Buffer.from(inc.buffer).equals(Buffer.from(full.buffer))).toBe(true)
    expect(s.takeDirty()).toBeNull()
  })

  it('stock STL: watertight, and the volume read back is the block less what was removed', () => {
    const s = new HeightfieldStock(p.length, p.width, p.thickness, 1)
    carveStock(s, tl, 0, tl.total)
    const back = buildMesh(parseStl(writeStl(s.toMesh(), 'stock')), { gapTol: 0 }).mesh
    expect(isWatertight(back.indices)).toBe(true)
    const cells = p.length * p.width * p.thickness - s.removedVolume()
    const v = meshVolume(back)
    expect(v).toBeLessThanOrEqual(cells + 1)
    expect(v).toBeGreaterThan(cells * 0.995)
  })

  it('section and coarse display meshes are closed too', () => {
    const s = new HeightfieldStock(p.length, p.width, p.thickness, 1)
    carveStock(s, tl, 0, tl.total)
    for (const o of [{ j1: 100 }, { i0: 220, step: 3 }, { step: 7 }, { step: 5, exact: true }, { i0: 10, i1: 11, j0: 5, j1: 6 }]) {
      const m = stockMesh(s.hf, o)
      expect(isWatertight(m.indices), JSON.stringify(o)).toBe(true)
    }
    // a coarse export mesh never shows material that was cut: less volume than the fine one
    expect(meshVolume(stockMesh(s.hf, { step: 5, exact: true }))).toBeLessThan(meshVolume(s.toMesh()))
    // the section through the ring's centre shows the 5 mm channel in its wall
    const m = stockMesh(s.hf, { j1: 100 })
    let low = 0
    // (top surface only: the first half of the vertices)
    for (let k = 0; k < m.positions.length / 2; k += 3) if (Math.abs(m.positions[k + 1] - 100) < 1e-6 && m.positions[k] > 175 && m.positions[k] < 265) low = Math.min(low, m.positions[k + 2])
    expect(low).toBeCloseTo(-5, 3)
  })

  it('cell size: a full 5 x 12 ft sheet simulates at 1 mm, a door at 0.25 mm', () => {
    expect(simCell(3658, 1524)).toBe(1)
    expect(simCell(600, 400)).toBe(0.25)
  })
})
