import { describe, expect, it } from 'vitest'
import { meshVolume } from '@/cam/mesh/types'
import { defaultOp, resolveTool } from '@/cam/ops'
import { cutterZ, type Cutter } from '@/cam/sim'
import { HeightfieldStock } from '@/cam/stock/heightfield'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import { cutterOutline, holderOf, machineModelOf, PLACEHOLDER_N200_MODEL } from '@/core/machineModel'
import { squareEnd } from '@/core/machining'
import { isWatertight } from './mesh-fixtures'

describe('M2.1 machine model and holder fields', () => {
  it('the N-200 model is a marked placeholder: 3 axes, sheet-size table, no saw, no aggregate, no rotary or 5-axis', () => {
    const m = machineModelOf(PLACEHOLDER_MACHINE)
    expect(m).toBe(PLACEHOLDER_N200_MODEL)
    expect(m.placeholder).toBe(true)
    expect(m.axes.map((a) => a.id)).toEqual(['X', 'Y', 'Z'])
    expect(m.table).toEqual({ length: 3658, width: 1524 })
    expect(m.capabilities).toEqual({ mill3d: true, saw: false, aggregate: false, rotary: false, positional: false, simultaneous5: false })
  })

  it('3D placeholder tools carry shank, flute length, gauge length and a placeholder holder', () => {
    const balls = PLACEHOLDER_MACHINE.tools.filter((t) => t.shape === 'ball' || t.shape === 'bull')
    expect(balls.length).toBe(3)
    for (const t of balls) {
      expect(t.name).toMatch(/placeholder/i)
      expect(t.fluteLength).toBeGreaterThan(0)
      expect(t.gaugeLength).toBeGreaterThan(t.fluteLength!)
      const h = holderOf(PLACEHOLDER_MACHINE, t)
      expect(h?.placeholder).toBe(true)
      const o = cutterOutline(t, h)
      expect(o.holder[0].z).toBe(t.gaugeLength)
      expect(o.shankR).toBe(t.shankDiameter! / 2)
    }
    const plain = PLACEHOLDER_MACHINE.tools.find((t) => t.number === 102)!
    const o = cutterOutline(plain, holderOf(PLACEHOLDER_MACHINE, plain))
    expect(o.gauge).toBe(Infinity)
    expect(o.holder).toEqual([])
  })

  it('2D operations never pick a ball or bull-nose tool automatically', () => {
    for (const t of PLACEHOLDER_MACHINE.tools.filter((x) => x.shape === 'ball' || x.shape === 'bull')) expect(squareEnd(t)).toBe(false)
    for (const kind of ['pocket', 'engrave', 'sweep', 'profile'] as const) {
      const t = resolveTool(defaultOp(kind), PLACEHOLDER_MACHINE)
      expect(t && t.shape !== 'ball' && t.shape !== 'bull').toBe(true)
    }
  })
})

describe('M2.1 bull-nose cutter and the heightfield stock model', () => {
  const bull: Cutter = { r: 6, shape: 'bull', angle: 0, cornerRadius: 2 }

  it('bull-nose bottom: flat to r - rc, then the corner arc', () => {
    expect(cutterZ(bull, -5, 0)).toBe(-5)
    expect(cutterZ(bull, -5, 4)).toBe(-5)
    expect(cutterZ(bull, -5, 6)).toBeCloseTo(-3, 9)
    expect(cutterZ(bull, -5, 5)).toBeCloseTo(-5 + 2 - Math.sqrt(3), 9)
    expect(cutterZ(bull, -5, 6.01)).toBe(Infinity)
    // corner radius 0 is a flat end mill, corner radius = r is a ball
    expect(cutterZ({ ...bull, cornerRadius: 0 }, -5, 5.9)).toBe(-5)
    expect(cutterZ({ ...bull, cornerRadius: 6 }, -5, 3)).toBeCloseTo(cutterZ({ r: 6, shape: 'ball', angle: 0 }, -5, 3), 12)
  })

  it('removed volume of a flat slot matches the analytic volume within 1% at 0.5 mm cells', () => {
    const s = new HeightfieldStock(200, 100, 19, 0.5)
    const flat: Cutter = { r: 5, shape: 'flat', angle: 0 }
    s.carve({ x: 50, y: 50, z: -6 }, { x: 150, y: 50, z: -6 }, flat)
    const analytic = (100 * 10 + Math.PI * 25) * 6
    expect(Math.abs(s.removedVolume() - analytic) / analytic).toBeLessThan(0.01)
  })

  it('stock mesh is watertight and its volume is the block less what was removed', () => {
    const s = new HeightfieldStock(60, 40, 18, 1)
    s.carve({ x: 10, y: 20, z: -5 }, { x: 50, y: 20, z: -5 }, { r: 4, shape: 'ball', angle: 0 })
    s.carve({ x: 30, y: 5, z: -30 }, { x: 30, y: 35, z: -30 }, { r: 3, shape: 'flat', angle: 0 })
    const m = s.toMesh()
    expect(isWatertight(m.indices)).toBe(true)
    // the corner surface takes the lowest neighbour, so it can only remove a little more than the cells
    const vol = meshVolume(m)
    const cells = 60 * 40 * 18 - s.removedVolume()
    expect(vol).toBeLessThanOrEqual(cells + 1e-3)
    expect(vol).toBeGreaterThan(cells * 0.97)
  })

  it('queries, snapshot and restore', () => {
    const s = new HeightfieldStock(100, 100, 19, 1)
    const snap = s.snapshot()
    s.carve({ x: 50, y: 50, z: -19.3 }, { x: 50, y: 50, z: -19.3 }, { r: 10, shape: 'flat', angle: 0 })
    expect(s.heightAt(50.5, 50.5)).toBe(-19)
    expect(s.occupied(50.5, 50.5, -10)).toBe(false)
    expect(s.occupied(5, 5, -10)).toBe(true)
    expect(s.maxInDisc(50.5, 50.5, 5)).toBe(-Infinity)
    expect(s.maxInDisc(50.5, 50.5, 15)).toBe(0)
    expect(Number.isNaN(s.heightAt(-1, 5))).toBe(true)
    s.restore(snap)
    expect(s.removedVolume()).toBe(0)
    expect(s.bounds()).toEqual({ min: [0, 0, -19], max: [100, 100, 0] })
  })
})
