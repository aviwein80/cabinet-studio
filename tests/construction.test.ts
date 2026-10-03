import { describe, expect, it } from 'vitest'
import { buildCabinet, generateCarcass, hingeCount, isOpInsidePart } from '../src/core/construction/carcass'
import { expandJob } from '../src/core/cutlist'
import { BASE_PARAMS, defaultLibrary, DEFAULT_SETTINGS } from '../src/core/defaults'
import { toWorld } from '../src/core/geometry'
import type { DrillOp, GrooveOp } from '../src/core/types'
import { cabinet, clone, job } from './helpers'

const lib = defaultLibrary()
const part = (parts: ReturnType<typeof generateCarcass>['parts'], key: string) => {
  const p = parts.find((x) => x.key === key)
  if (!p) throw new Error(`no part ${key}`)
  return p
}

describe('base carcass generator', () => {
  const g = generateCarcass(BASE_PARAMS, lib)

  it('creates the expected parts', () => {
    expect(g.parts.map((p) => p.key)).toEqual(['side-left', 'side-right', 'bottom', 'rail-front', 'rail-back', 'back', 'shelf-1', 'door-left', 'door-right'])
    expect(g.warnings).toEqual([])
  })

  it('sizes panels from width / height / depth / thickness / dado depth', () => {
    const side = part(g.parts, 'side-left')
    expect([side.length, side.width, side.thickness]).toEqual([870, 560, 18])
    const bottom = part(g.parts, 'bottom')
    expect(bottom.length).toBe(600 - 2 * 18 + 2 * 8)
    expect(bottom.width).toBe(560)
    const rail = part(g.parts, 'rail-front')
    expect([rail.length, rail.width]).toEqual([564, 100])
    const back = part(g.parts, 'back')
    expect(back.thickness).toBe(6)
    expect(back.length).toBe(600 - 36 + 16 - 1)
  })

  it('keeps every operation inside its part', () => {
    for (const p of g.parts) for (const op of p.ops) expect(isOpInsidePart(p, op), `${p.key} ${op.id}`).toBe(true)
  })

  it('drills shelf pins on the 32 mm grid, mirrored on left and right sides', () => {
    const left = part(g.parts, 'side-left').ops.filter((o): o is DrillOp => o.kind === 'drill' && o.purpose === 'shelf-pin')
    const right = part(g.parts, 'side-right').ops.filter((o): o is DrillOp => o.kind === 'drill' && o.purpose === 'shelf-pin')
    expect(left.length).toBeGreaterThan(0)
    const xs = [...new Set(left.map((o) => o.x))].sort((a, b) => a - b)
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(32, 6)
    // Left side local y runs back->front, right side front->back: same world holes.
    const W = 560
    const leftWorld = left.map((o) => `${o.x}/${W - o.y}`).sort()
    const rightWorld = right.map((o) => `${o.x}/${o.y}`).sort()
    expect(leftWorld).toEqual(rightWorld)
    for (const o of left) expect(o.diameter).toBe(5)
  })

  it('puts the back groove and dado on the inside face with open ends', () => {
    const side = part(g.parts, 'side-left')
    const grooves = side.ops.filter((o): o is GrooveOp => o.kind === 'groove')
    const back = grooves.find((o) => o.purpose === 'back-groove')!
    expect(back.open).toEqual({ x1: true, x2: true, y1: false, y2: false })
    expect(back.y2 - back.y1).toBeCloseTo(6.5, 6)
    expect(back.y1).toBe(12)
    const dado = grooves.find((o) => o.purpose === 'dado')!
    expect([dado.x1, dado.x2, dado.depth]).toEqual([100, 118, 8])
    expect(dado.open.y1 && dado.open.y2).toBe(true)
  })

  it('notches the toe kick out of the front-bottom corner of each side', () => {
    const left = part(g.parts, 'side-left')
    const right = part(g.parts, 'side-right')
    expect(left.outline).toContainEqual({ x: 100, y: 500 })
    expect(right.outline).toContainEqual({ x: 100, y: 60 })
  })

  it('lines hinge cups up with the mounting plate holes on the side', () => {
    const door = part(g.parts, 'door-left')
    const cups = door.ops.filter((o): o is DrillOp => o.kind === 'drill' && o.purpose === 'hinge-cup')
    expect(cups.length).toBe(hingeCount(door.length))
    const side = part(g.parts, 'side-left')
    const sideHoles = side.ops.filter((o): o is DrillOp => o.kind === 'drill' && o.diameter === 5)
    for (const cup of cups) {
      const z = toWorld(door.frame, cup.x, cup.y)[2]
      const near = sideHoles.filter((h) => Math.abs(toWorld(side.frame, h.x, h.y)[2] - z) <= 16.0001 && Math.abs(h.y - (560 - 37)) < 1e-6)
      expect(near.length).toBe(2)
    }
    expect(cups.every((c) => c.y === 20.5)).toBe(true)
    expect(cups.every((c) => c.diameter === 35 && c.depth === 13.5)).toBe(true)
  })

  it('creates horizontal holes for dowel joinery and counts hardware', () => {
    const p = clone(BASE_PARAMS)
    p.bottomJoint = 'butt'
    p.joinery = 'dowel'
    const gd = generateCarcass(p, lib)
    const bottom = part(gd.parts, 'bottom')
    const h = bottom.ops.filter((o) => o.kind === 'hdrill')
    expect(h.length).toBe(6)
    expect(h.every((o) => o.kind === 'hdrill' && (o.dir === 'XP' || o.dir === 'XM') && o.z === 9)).toBe(true)
    expect(gd.hardware.find((x) => x.hardwareCode === 'DOWEL-8x30')?.qty).toBe(6 + 8)
  })

  it('builds a wall cabinet with full top and no toe kick', () => {
    const p = clone(BASE_PARAMS)
    p.kind = 'wall'
    p.height = 720
    p.depth = 320
    const gw = generateCarcass(p, lib)
    expect(gw.parts.some((x) => x.key === 'top')).toBe(true)
    expect(gw.parts.some((x) => x.key.startsWith('rail'))).toBe(false)
    expect(part(gw.parts, 'side-left').outline).toBeUndefined()
  })
})

describe('overrides and cut sizes', () => {
  it('excludes parts and adds custom holes', () => {
    const c = cabinet('tpl-base-2door')
    c.overrides['shelf-1'] = { exclude: true }
    c.overrides['side-left'] = { extraOps: [{ kind: 'drill', id: 'x1', x: 400, y: 280, diameter: 8, depth: 10, through: false, purpose: 'custom' }] }
    const g = buildCabinet(c, lib)
    expect(g.parts.some((p) => p.key === 'shelf-1')).toBe(false)
    expect(g.parts.find((p) => p.key === 'side-left')!.ops.some((o) => o.id === 'x1')).toBe(true)
  })

  it('subtracts edgeband thickness and adds pre-mill to cut size, shifting machining', () => {
    const settings = clone(DEFAULT_SETTINGS)
    settings.nesting.premill = 0.5
    const e = expandJob(job([cabinet('tpl-base-2door')]), lib, settings)
    const door = e.instances.find((i) => i.part.key === 'door-left')!
    // 1 mm band all round, 0.5 mm pre-mill: each edge contributes -0.5.
    expect(door.cutLength).toBe(door.part.length - 1)
    expect(door.cutWidth).toBe(door.part.width - 1)
    const cup = door.ops.find((o) => o.kind === 'drill')!
    const orig = door.part.ops.find((o) => o.kind === 'drill')!
    expect(cup.kind === 'drill' && orig.kind === 'drill' && cup.y - orig.y).toBeCloseTo(-0.5, 6)
  })

  it('numbers parts across the job and expands cabinet quantity', () => {
    const c = cabinet('tpl-wall-2door')
    c.qty = 2
    const e = expandJob(job([c]), lib, DEFAULT_SETTINGS)
    const n = generateCarcass(c.params, lib).parts.length
    expect(e.instances.length).toBe(2 * n)
    expect(e.instances.map((i) => i.no)).toEqual(Array.from({ length: 2 * n }, (_, i) => i + 1))
    expect(e.instances[0].partId).toBe('T001-001')
    expect(e.instances[n].cabinetNumber).toBe('B1.2')
  })
})
