import { describe, expect, it } from 'vitest'
import { generateCarcass } from '../src/core/construction/carcass'
import { BASE_PARAMS, defaultLibrary } from '../src/core/defaults'
import { BLUM, SALICE, selectTandem } from '../src/core/hardware/specs'
import { toWorld } from '../src/core/geometry'
import { arrangeCabinets, snapPlacement } from '../src/core/room'
import { formatInches, formatLength, parseLength, toMm } from '../src/core/units'
import type { DrillOp } from '../src/core/types'
import { clone } from './helpers'

const lib = defaultLibrary()
const drills = (key: string, parts: ReturnType<typeof generateCarcass>['parts'], purpose: string) =>
  parts.find((p) => p.key === key)!.ops.filter((o): o is DrillOp => o.kind === 'drill' && o.purpose === purpose)

describe('units', () => {
  it('stores inches as exact millimetres and prints cabinet fractions', () => {
    expect(toMm(23.25)).toBeCloseTo(590.55, 6)
    expect(formatInches(590.55)).toBe('23-1/4"')
    expect(formatInches(12.7)).toBe('1/2"')
    expect(formatInches(25.4)).toBe('1"')
    expect(formatLength(18, 'mm')).toBe('18')
  })

  it('parses decimal and fractional inches without drifting an exact fraction', () => {
    for (const text of ['23-1/4', '23 1/4', '23.25', '23-1/4"']) expect(parseLength(text, 'in')).toBeCloseTo(590.55, 6)
    expect(parseLength('1/2', 'in')).toBeCloseTo(12.7, 6)
    expect(parseLength('18', 'mm')).toBe(18)
    const mm = 600
    const shown = formatInches(mm)
    const back = parseLength(shown, 'in')!
    expect(Math.abs(back - mm)).toBeLessThanOrEqual(25.4 / 32 + 1e-6)
    expect(parseLength(formatInches(toMm(23.25)), 'in')).toBeCloseTo(toMm(23.25), 6)
  })
})

describe('Salice hinge boring', () => {
  const g = generateCarcass(BASE_PARAMS, lib)
  const door = g.parts.find((p) => p.key === 'door-left')!
  const side = g.parts.find((p) => p.key === 'side-left')!
  const cups = drills('door-left', g.parts, 'hinge-cup')

  it('bores a 35 mm cup, K = 3 mm from the door edge, 13.5 mm deep', () => {
    expect(cups.length).toBeGreaterThan(1)
    for (const c of cups) {
      expect(c.diameter).toBe(SALICE.cupDiameter)
      expect(c.depth).toBe(SALICE.cupDepth)
      expect(c.y).toBe(SALICE.cupCentreFromEdge)
    }
  })

  it('bores the 3 mm plate as two 5 mm holes, 32 mm apart, 37 mm from the front', () => {
    // The front System 32 row is also the shelf-pin row, so a plate screw that lands on it is one hole.
    const holes = side.ops.filter((o): o is DrillOp => o.kind === 'drill' && o.diameter === SALICE.plateHoleDiameter)
    for (const cup of cups) {
      const z = toWorld(door.frame, cup.x, cup.y)[2]
      const pair = holes.filter((h) => Math.abs(toWorld(side.frame, h.x, h.y)[2] - z) < 16.01 && Math.abs(toWorld(side.frame, h.x, h.y)[1] - SALICE.plateSetback) < 0.1)
      expect(pair.length).toBe(2)
      const zs = pair.map((h) => toWorld(side.frame, h.x, h.y)[2]).sort((a, b) => a - b)
      expect(zs[1] - zs[0]).toBeCloseTo(SALICE.plateSpacing, 3)
    }
  })
})

describe('Blum TANDEM', () => {
  it('picks the runner from Blum\'s cabinet-depth table', () => {
    expect(selectTandem(610, 'auto').slide.inches).toBe(21)
    expect(selectTandem(560, 'auto').slide.inches).toBe(18)
    expect(selectTandem(457, 'auto').slide.inches).toBe(15)
    expect(selectTandem(400, 'auto').shallow).toBe(true)
    expect(selectTandem(700, 15).slide.part).toBe('563H3810B')
  })

  it('bores the System 32 runner holes and sizes the box to the published clearances', () => {
    const p = clone(BASE_PARAMS)
    p.doors.count = 0
    p.shelves.count = 0
    p.drawers = { count: 1, frontHeight: 150, slide: 'auto' }
    const g = generateCarcass(p, lib)
    const slide = selectTandem(p.depth, 'auto').slide
    expect(g.hardware.find((h) => h.hardwareCode === slide.part)?.qty).toBe(1)
    for (const key of ['side-left', 'side-right']) {
      const holes = drills(key, g.parts, 'slide')
      const ys = holes.map((h) => toWorld(g.parts.find((x) => x.key === key)!.frame, h.x, h.y)[1]).sort((a, b) => a - b)
      expect(ys).toEqual(slide.holesFromFront)
      for (const y of ys) expect((y - BLUM.line) % BLUM.pitch).toBe(0)
      const zs = holes.map((h) => toWorld(g.parts.find((x) => x.key === key)!.frame, h.x, h.y)[2])
      expect(new Set(zs).size).toBe(1)
      expect(zs[0]).toBeCloseTo(p.toeKick.height + BLUM.line, 3)
      expect(holes.every((h) => h.diameter === BLUM.holeDiameter)).toBe(true)
    }
    const opening = p.width - 2 * 18
    const back = g.parts.find((x) => x.key === 'drawer-1-back')!
    expect(back.length).toBeCloseTo(opening - BLUM.insideWidthDeduction, 3)
    const side = g.parts.find((x) => x.key === 'drawer-1-side-l')!
    expect(side.length).toBe(slide.length)
    const hooks = drills('drawer-1-back', g.parts, 'slide')
    expect(hooks.map((h) => h.diameter)).toEqual([6, 6])
  })
})

describe('room arrangement', () => {
  it('lines base cabinets along the back wall and returns the overflow around the corner', () => {
    const room = { width: 1000, depth: 800, height: 2400 }
    const cab = (id: string, width: number, kind: 'base' | 'wall' = 'base') => ({
      id,
      params: { ...BASE_PARAMS, width, kind, depth: kind === 'wall' ? 320 : 560 },
    })
    const laid = arrangeCabinets([cab('a', 600), cab('b', 600), cab('w', 600, 'wall')], room)
    expect(laid.a).toMatchObject({ x: 0, y: 800 - 560, rotation: 0, z: 0 })
    expect(laid.b.rotation).toBe(90)
    expect(laid.b.x).toBe(0)
    expect(laid.b.y).toBe(800 - 560 - 600)
    expect(laid.w.z).toBeCloseTo(54 * 25.4, 3)
  })

  it('snaps a cabinet to the wall and to its neighbour', () => {
    const room = { width: 3000, depth: 3000, height: 2400 }
    const snapped = snapPlacement({ x: 8, y: 8, rotation: 0, z: 0 }, 600, 560, [{ x: 600, y: 0, w: 600, d: 560 }], room, 12.7)
    expect(snapped.x).toBe(0)
    expect(snapped.y).toBe(0)
  })
})
