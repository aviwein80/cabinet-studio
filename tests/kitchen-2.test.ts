import { describe, expect, it } from 'vitest'
import { kitchenUnconfirmed } from '../src/core/confirm'
import { blindSpans, buildCabinet, generateCarcass } from '../src/core/construction/carcass'
import { defaultAppData, defaultLibrary, KITCHEN_DEFAULTS, KITCHEN_PRESETS } from '../src/core/defaults'
import { alongWall, elevationOf, frontDivisions, placementFromElevation, type WallId } from '../src/core/elevation'
import { toWorld } from '../src/core/geometry'
import { normalizeData } from '../src/core/normalize'
import { runJob } from '../src/core/pipeline'
import {
  arrangeCabinets,
  cornerClearance,
  DEFAULT_ROOM,
  fillGap,
  footprint,
  nextCabinetNumber,
  placementOf,
  pushNeighbours,
  roomProblems,
  runGaps,
  toRoom,
  WALL_ELEVATION,
} from '../src/core/room'
import type { AppData, BlindCornerParams, CabinetInstance, CabinetPlacement, CarcassParams, DrillOp, Job, Part } from '../src/core/types'
import { formatInches, toMm } from '../src/core/units'
import { cabinet, clone, data, job } from './helpers'

const lib = defaultLibrary()
const room = DEFAULT_ROOM
const inch = (n: number) => Math.round(n * 25.4 * 1000) / 1000
const drills = (p: Part, purpose: string) => p.ops.filter((o): o is DrillOp => o.kind === 'drill' && o.purpose === purpose)
const part = (parts: Part[], key: string) => parts.find((p) => p.key === key)!
/** Kitchen-3: `corner` may also be a pie-cut; these tests are about blind corners. */
const blindOf = (p: Pick<CarcassParams, 'corner'>) => p.corner as BlindCornerParams
/** A part's extent in cabinet (or room) coordinates. */
function extent(p: Part) {
  const c = [0, p.length].flatMap((x) => [0, p.width].flatMap((y) => [0, p.thickness].map((d) => toWorld(p.frame, x, y, d))))
  const lo = [0, 1, 2].map((i) => Math.min(...c.map((v) => v[i])))
  const hi = [0, 1, 2].map((i) => Math.max(...c.map((v) => v[i])))
  return { lo, hi }
}

/** A US-sized ordinary cabinet from a built-in template. */
function us(templateId: string, id: string, number: string, width: number, patch: (p: CarcassParams) => void = () => {}) {
  return cabinet(
    templateId,
    (p) => {
      p.width = inch(width)
      if (p.kind === 'wall') {
        p.height = inch(30)
        p.depth = inch(12)
      } else {
        p.height = inch(34.5)
        p.depth = inch(24)
        p.toeKick = { enabled: true, height: inch(4), setback: inch(3), board: false }
      }
      patch(p)
    },
    id,
    number,
  )
}
function preset(id: string, cabId: string, number: string, patch: (p: CarcassParams) => void = () => {}): CabinetInstance {
  const t = KITCHEN_PRESETS.find((x) => x.id === id)!
  const params = clone(t.params)
  patch(params)
  return { id: cabId, number, name: t.name, templateId: t.id, qty: 1, params, overrides: {} }
}

/**
 * The acceptance kitchen: an L of the back wall and the left wall round a blind-left corner, in job
 * order as walked left to right: the left wall from its front end (end panels) to the corner, the
 * corner cabinets, then the back wall. The back base run stops 3" short of the right wall.
 */
function lKitchen(): CabinetInstance[] {
  return [
    preset('tpl-us-end-base', 'e1', 'E1', (p) => p.panel?.type === 'end-panel' && (p.panel.side = 'left')),
    us('tpl-base-1door', 'b1', 'B1', 18),
    us('tpl-base-drawers', 'b2', 'B2', 24),
    preset('tpl-us-blind-base-36', 'bc', 'B3'),
    us('tpl-base-2door', 'b4', 'B4', 30),
    us('tpl-sink-base', 'b5', 'B5', 36),
    us('tpl-base-drawers', 'b6', 'B6', 24),
    us('tpl-base-1door', 'b7', 'B7', 12),
    preset('tpl-us-end-wall', 'e2', 'E2', (p) => p.panel?.type === 'end-panel' && (p.panel.side = 'left')),
    us('tpl-wall-2door', 'w1', 'W1', 30),
    preset('tpl-us-blind-wall-24', 'wc', 'W2'),
    us('tpl-wall-2door', 'w3', 'W3', 30),
    us('tpl-wall-2door', 'w4', 'W4', 36),
    us('tpl-wall-2door', 'w5', 'W5', 30),
    us('tpl-wall-2door', 'w6', 'W6', 18),
    preset('tpl-us-filler-3-wall', 'f2', 'F2', (p) => p.panel?.type === 'filler' && (p.panel.scribeSide = 'right')),
  ]
}

function placed(cabs: CabinetInstance[]) {
  const laid = arrangeCabinets(cabs, room, lib)
  for (const c of cabs) c.placement = laid[c.id]
  return cabs
}
const at = (cabs: CabinetInstance[], id: string) => cabs.find((c) => c.id === id)!.placement!
const fpOf = (cabs: CabinetInstance[], id: string) => {
  const c = cabs.find((x) => x.id === id)!
  return footprint(c.params.width, c.params.depth, c.placement!)
}

/** Every part of every cabinet, in room coordinates (as the room's 3D view places them). */
function roomParts(cabs: CabinetInstance[]) {
  const out: { cab: string; part: Part; lo: number[]; hi: number[] }[] = []
  for (const c of cabs) {
    const pl = c.placement!
    for (const p of buildCabinet(c, lib).parts) {
      const e = extent(p)
      const a = toRoom(e.lo[0], e.lo[1], e.lo[2], pl, c.params.width, c.params.depth)
      const b = toRoom(e.hi[0], e.hi[1], e.hi[2], pl, c.params.width, c.params.depth)
      out.push({ cab: c.id, part: p, lo: [0, 1, 2].map((i) => Math.min(a[i], b[i])), hi: [0, 1, 2].map((i) => Math.max(a[i], b[i])) })
    }
  }
  return out
}

describe('Kitchen-2 A1: blind corner cabinets', () => {
  it('36" blind base: blind panel, one door on the open side, Salice cups and 3 mm plates in the open side only', () => {
    const t = KITCHEN_PRESETS.find((x) => x.id === 'tpl-us-blind-base-36')!
    const p = t.params
    const g = generateCarcass(p, lib)
    expect(g.warnings).toEqual([])
    const W = p.width
    const bw = blindOf(p).blindWidth
    const gap = p.doors.gap
    // blind panel over the blind part, from the blind side to the door gap
    const bp = part(g.parts, 'blind-panel')
    const be = extent(bp)
    expect(bp.role).toBe('blind-panel')
    expect(be.lo[0]).toBeCloseTo(0, 6)
    expect(be.hi[0]).toBeCloseTo(bw - gap / 2, 6)
    expect(be.lo[1]).toBeCloseTo(-18, 6)
    expect(be.hi[1]).toBeCloseTo(0, 6)
    expect(bp.grain).toBe('length')
    expect(Object.values(bp.edges).filter(Boolean)).toHaveLength(4)
    // one door over the rest of the face: 36 - 24 - 3 mm gap = 11-7/8"
    const door = part(g.parts, 'door')
    const de = extent(door)
    expect(de.lo[0]).toBeCloseTo(bw + gap / 2, 6)
    expect(de.hi[0]).toBeCloseTo(W - gap / 2, 6)
    expect(blindSpans(p, blindOf(p)).doorWidth).toBeCloseTo(W - bw - gap, 6)
    expect(formatInches(W - bw - gap)).toBe('11-7/8"')
    expect(g.parts.filter((x) => x.role === 'door')).toHaveLength(1)
    // the cups are on the open (right) edge; the plate holes are in the right side only
    const cups = drills(door, 'hinge-cup')
    expect(cups.length).toBeGreaterThanOrEqual(2)
    for (const c of cups) expect(toWorld(door.frame, c.x, c.y)[0]).toBeCloseTo(W - gap / 2 - p.doors.cupEdgeDistance, 3)
    // (plate screws on the 37 mm row share holes with the front shelf-pin row, so look without shelves)
    const bare = generateCarcass({ ...p, shelves: { ...p.shelves, count: 0 } }, lib)
    expect(drills(part(bare.parts, 'side-right'), 'mounting-plate').length).toBe(cups.length * 2)
    expect(drills(part(bare.parts, 'side-left'), 'mounting-plate')).toHaveLength(0)
    expect(g.hardware.find((h) => h.hardwareCode === 'SALICE-110-SC')?.qty).toBe(cups.length)
    expect(g.hardware.find((h) => h.hardwareCode === 'SALICE-B2VGV-H3')?.qty).toBe(cups.length)
    // the carcass is the usual one: notched sides, dadoed bottom, grooved back, shelf on 32 mm pins
    for (const k of ['side-left', 'side-right', 'bottom', 'back', 'rail-front', 'rail-back', 'shelf-1']) expect(g.parts.some((x) => x.key === k)).toBe(true)
    expect(part(g.parts, 'side-left').outline).toBeDefined()
    expect(drills(part(g.parts, 'side-left'), 'shelf-pin').length).toBeGreaterThan(0)
  })

  it('blind right mirrors it: blind panel at the right, door hinged left, plates in the left side', () => {
    const p = clone(KITCHEN_PRESETS.find((x) => x.id === 'tpl-us-blind-base-36')!.params)
    blindOf(p).blindSide = 'right'
    const g = generateCarcass(p, lib)
    const be = extent(part(g.parts, 'blind-panel'))
    expect(be.hi[0]).toBeCloseTo(p.width, 6)
    expect(be.lo[0]).toBeCloseTo(p.width - blindOf(p).blindWidth + p.doors.gap / 2, 6)
    const door = part(g.parts, 'door')
    for (const c of drills(door, 'hinge-cup')) expect(toWorld(door.frame, c.x, c.y)[0]).toBeCloseTo(p.doors.gap / 2 + p.doors.cupEdgeDistance, 3)
    const bare = generateCarcass({ ...p, shelves: { ...p.shelves, count: 0 } }, lib)
    expect(drills(part(bare.parts, 'side-left'), 'mounting-plate').length).toBeGreaterThan(0)
    expect(drills(part(bare.parts, 'side-right'), 'mounting-plate')).toHaveLength(0)
  })

  it('24" blind wall: full top, 12" blind part, 11-7/8" door; no drawers in a blind corner; bad sizes warned', () => {
    const p = KITCHEN_PRESETS.find((x) => x.id === 'tpl-us-blind-wall-24')!.params
    const g = generateCarcass(p, lib)
    expect(g.warnings).toEqual([])
    expect(p.kind).toBe('wall')
    expect(g.parts.some((x) => x.key === 'top')).toBe(true)
    expect(formatInches(blindSpans(p, blindOf(p)).doorWidth)).toBe('11-7/8"')
    const q = clone(p)
    q.drawers.count = 2
    blindOf(q).blindWidth = p.width + 10
    const h = generateCarcass(q, lib)
    expect(h.warnings.some((w) => /Drawers are left out/.test(w))).toBe(true)
    expect(h.warnings.some((w) => /Blind width/.test(w))).toBe(true)
    expect(h.parts.some((x) => x.role === 'drawer' || x.role === 'door')).toBe(false)
  })

  it('the elevation shows the blind panel and the door where they are built', () => {
    const p = KITCHEN_PRESETS.find((x) => x.id === 'tpl-us-blind-base-36')!.params
    const d = frontDivisions(p, 0)
    const blind = d.find((x) => x.kind === 'blind')!
    const door = d.find((x) => x.kind === 'door')!
    expect(blind.u0).toBe(0)
    expect(blind.u1 * p.width).toBeCloseTo(blindOf(p).blindWidth - p.doors.gap / 2, 6)
    expect(door.u0 * p.width).toBeCloseTo(blindOf(p).blindWidth + p.doors.gap / 2, 6)
    expect(d.filter((x) => x.kind === 'drawer')).toHaveLength(0)
  })
})

describe('Kitchen-2 A3: room, turned cabinets and the L-shaped kitchen', () => {
  it('a turned cabinet keeps its hand: seen from its front, its left end stays on the left', () => {
    // standing in front of the cabinet, looking at it, your left is (front -> back) turned +90°
    for (const rotation of [0, 90, 180, 270] as const) {
      const pl: CabinetPlacement = { x: 100, y: 200, rotation, z: 0 }
      const W = 600
      const D = 560
      const left = toRoom(0, 0, 0, pl, W, D)
      const right = toRoom(W, 0, 0, pl, W, D)
      const back = toRoom(0, D, 0, pl, W, D)
      const fwd = [back[0] - left[0], back[1] - left[1]] // the viewer looks along this
      const leftHand = [-fwd[1], fwd[0]]
      const run = [left[0] - right[0], left[1] - right[1]]
      expect(run[0] * leftHand[0] + run[1] * leftHand[1]).toBeGreaterThan(0)
      // and the cabinet stays inside its footprint
      const fp = footprint(W, D, pl)
      for (const c of [left, right, back, toRoom(W, D, 0, pl, W, D)]) {
        expect(c[0]).toBeGreaterThanOrEqual(fp.x - 1e-9)
        expect(c[0]).toBeLessThanOrEqual(fp.x + fp.w + 1e-9)
        expect(c[1]).toBeGreaterThanOrEqual(fp.y - 1e-9)
        expect(c[1]).toBeLessThanOrEqual(fp.y + fp.d + 1e-9)
      }
    }
  })

  it('side-wall elevations read as seen from the room: the left wall has the front wall on the left, the right wall the back wall', () => {
    const fp = { x: 0, y: 100, w: 600, d: 450 }
    expect(alongWall('left', fp, room).x).toBe(100)
    expect(alongWall('right', { ...fp, x: room.width - 600 }, room).x).toBeCloseTo(room.depth - 550, 9)
    // and dragging in the elevation maps back to the same place
    const pl: CabinetPlacement = { x: 0, y: 100, rotation: 270, z: 0 }
    expect(placementFromElevation(pl, 450, 600, 'left', 100, 0, room).y).toBe(100)
    const pr: CabinetPlacement = { x: room.width - 600, y: 100, rotation: 90, z: 0 }
    const along = alongWall('right', footprint(450, 600, pr), room).x
    expect(placementFromElevation(pr, 450, 600, 'right', along, 0, room).y).toBeCloseTo(100, 9)
  })

  it('arranges the L round the corner: corner in the back-left corner, the left run butted against its blind panel, the back run after it', () => {
    const cabs = placed(lKitchen())
    const bc = cabs.find((c) => c.id === 'bc')!
    // the corner: on the back wall, 3" off the left wall, front facing the room
    expect(at(cabs, 'bc')).toMatchObject({ x: inch(3), y: room.depth - inch(24), rotation: 0, z: 0 })
    // the back run starts at its open end and goes right
    expect(at(cabs, 'b4').x).toBeCloseTo(inch(39), 6)
    expect(at(cabs, 'b5').x).toBeCloseTo(inch(69), 6)
    expect(at(cabs, 'b7').x).toBeCloseTo(inch(129), 6)
    // the left run: turned to face the room, packed up to the blind panel's face (24" + 18 mm from the back wall)
    for (const id of ['e1', 'b1', 'b2']) expect(at(cabs, id)).toMatchObject({ x: 0, rotation: 270, z: 0 })
    const face = room.depth - inch(24) - 18
    const b2 = fpOf(cabs, 'b2')
    expect(b2.y + b2.d).toBeCloseTo(face, 6)
    expect(fpOf(cabs, 'b1').y + fpOf(cabs, 'b1').d).toBeCloseTo(b2.y, 6)
    expect(fpOf(cabs, 'e1').y + fpOf(cabs, 'e1').d).toBeCloseTo(fpOf(cabs, 'b1').y, 6)
    // wall cabinets the same way at 54"
    expect(at(cabs, 'wc')).toMatchObject({ x: inch(3), y: room.depth - inch(12), rotation: 0, z: WALL_ELEVATION })
    expect(at(cabs, 'w3').x).toBeCloseTo(inch(27), 6)
    expect(fpOf(cabs, 'w1').y + fpOf(cabs, 'w1').d).toBeCloseTo(room.depth - inch(12) - 18, 6)
    expect(at(cabs, 'f2').x + inch(3)).toBeCloseTo(inch(144), 6)
    // nothing overlaps, nothing runs past a wall, the corner door is clear of the return
    const place = (c: CabinetInstance) => c.placement!
    expect(roomProblems(cabs, room, place, lib)).toEqual({ overlaps: [], outside: [], blocked: [] })
    const cl = cornerClearance(cabs, 'bc', room, place, lib)!
    expect(cl.id).toBe('b2')
    // door edge 3 + 24 + 1.5 mm gap/2 from the left wall; return front 24" + its 18 mm drawer fronts
    expect(cl.clearance).toBeCloseTo(inch(3) + inch(24) + 1.5 - inch(24) - 18, 6)
    expect(cornerClearance(cabs, 'wc', room, place, lib)!.clearance).toBeCloseTo(inch(3) + inch(12) + 1.5 - inch(12) - 18, 6)
    expect(blindOf(bc.params).pullOut).toBe(KITCHEN_DEFAULTS.pullOut)
  })

  it('no overlaps in 3D: every part of every cabinet, placed in the room, stays clear of every other cabinet', () => {
    const cabs = placed(lKitchen())
    const parts = roomParts(cabs)
    const clash: string[] = []
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i]
        const b = parts[j]
        if (a.cab === b.cab) continue
        const o = [0, 1, 2].map((k) => Math.min(a.hi[k], b.hi[k]) - Math.max(a.lo[k], b.lo[k]))
        if (o.every((v) => v > 0.01)) clash.push(`${a.cab}:${a.part.key} x ${b.cab}:${b.part.key}`)
      }
    expect(clash).toEqual([])
    // and the corner's blind panel is what the return butts against (they touch)
    const bp = parts.find((p) => p.cab === 'bc' && p.part.key === 'blind-panel')!
    const side = parts.filter((p) => p.cab === 'b2' && p.part.role === 'side')
    expect(side.some((s) => Math.abs(s.hi[1] - bp.lo[1]) < 1e-6)).toBe(true)
  })

  it('no overlaps in either elevation; the corner shows on the back wall and end on at the corner end of the left wall', () => {
    const cabs = placed(lKitchen())
    const place = (c: CabinetInstance) => c.placement!
    for (const wall of ['back', 'left'] as WallId[]) {
      const items = elevationOf(cabs, room, wall, place)
      for (let i = 0; i < items.length; i++)
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i]
          const b = items[j]
          const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
          const oz = Math.min(a.z + a.h, b.z + b.h) - Math.max(a.z, b.z)
          expect(ox > 0.5 && oz > 0.5, `${wall}: ${a.number} and ${b.number}`).toBe(false)
        }
    }
    const back = elevationOf(cabs, room, 'back', place)
    expect(back.find((i) => i.id === 'bc')).toMatchObject({ faces: true, x: inch(3) })
    expect(back.some((i) => ['e1', 'b1', 'b2'].includes(i.id))).toBe(false)
    const left = elevationOf(cabs, room, 'left', place)
    const corner = left.find((i) => i.id === 'bc')!
    expect(corner.endView).toBe(true)
    expect(corner.x + corner.w).toBeCloseTo(room.depth, 6)
    // the return reads front wall (left) to corner (right), facing the viewer
    expect(left.filter((i) => i.z === 0 && !i.endView).map((i) => i.number)).toEqual(['E1', 'B1', 'B2'])
    expect(left.filter((i) => !i.endView).every((i) => i.faces)).toBe(true)
    expect(left.find((i) => i.id === 'e1')!.kind).toBe('end-panel')
    expect(back.find((i) => i.id === 'f2')!.kind).toBe('filler')
  })

  it('a blind-right corner turns onto the right wall, the run there walking from the corner to the front', () => {
    const cabs = placed([
      us('tpl-base-2door', 'a', 'B1', 30),
      us('tpl-base-2door', 'b', 'B2', 30),
      preset('tpl-us-blind-base-36', 'c', 'B3', (p) => (blindOf(p).blindSide = 'right')),
      us('tpl-base-1door', 'd', 'B4', 18),
      us('tpl-base-1door', 'e', 'B5', 18),
    ])
    expect(at(cabs, 'c').x + inch(36)).toBeCloseTo(room.width - inch(3), 6)
    // only a right corner: the back run is held against it
    expect(at(cabs, 'b').x + inch(30)).toBeCloseTo(at(cabs, 'c').x, 6)
    expect(at(cabs, 'a').x + inch(30)).toBeCloseTo(at(cabs, 'b').x, 6)
    for (const id of ['d', 'e']) expect(at(cabs, id)).toMatchObject({ x: room.width - inch(24), rotation: 90 })
    expect(fpOf(cabs, 'd').y + fpOf(cabs, 'd').d).toBeCloseTo(room.depth - inch(24) - 18, 6)
    expect(fpOf(cabs, 'e').y + fpOf(cabs, 'e').d).toBeCloseTo(fpOf(cabs, 'd').y, 6)
    const place = (c: CabinetInstance) => c.placement!
    expect(roomProblems(cabs, room, place, lib)).toEqual({ overlaps: [], outside: [], blocked: [] })
    expect(cornerClearance(cabs, 'c', room, place, lib)!.clearance).toBeCloseTo(inch(3) + inch(24) + 1.5 - inch(24) - 18, 6)
    const right = elevationOf(cabs, room, 'right', place)
    // facing the right wall the back wall is on the left: the corner first, then B4, B5
    expect(right.map((i) => i.number)).toEqual(['B3', 'B4', 'B5'])
    expect(right[0].endView).toBe(true)
    expect(right[0].x).toBeCloseTo(0, 6)
  })

  it('without a corner cabinet the old layout stays, with the left-wall return now facing into the room and not stacked', () => {
    const r = { width: 1000, depth: 2000, height: 2400 }
    const cab = (id: string, width: number) => ({ id, params: { ...cabinet('tpl-base-2door').params, width } })
    const laid = arrangeCabinets([cab('a', 600), cab('b', 600), cab('c', 500)], r)
    expect(laid.a).toMatchObject({ x: 0, y: 2000 - 560, rotation: 0 })
    expect(laid.b).toMatchObject({ x: 0, rotation: 270, y: 2000 - 560 - 600 })
    expect(laid.c).toMatchObject({ x: 0, rotation: 270, y: 2000 - 560 - 600 - 500 })
  })
})

describe('Kitchen-2 A3: the neighbour push follows the run round the corner', () => {
  it('a corner pulled further out moves the back run; a deeper corner moves the left run towards the front', () => {
    const cabs = placed(lKitchen())
    const bc = cabs.find((c) => c.id === 'bc')!
    const b4 = at(cabs, 'b4').x
    blindOf(bc.params).pullOut = inch(4)
    const moved = pushNeighbours(cabs, 'bc', { width: bc.params.width, depth: bc.params.depth, pullOut: inch(3) }, room, lib)
    expect(at(cabs, 'bc').x).toBeCloseTo(inch(4), 6)
    expect(at(cabs, 'b4').x).toBeCloseTo(b4 + inch(1), 6)
    expect(moved).toEqual(['b4', 'b5', 'b6', 'b7'])
    // deeper: its back stays on the wall, the return slides towards the front
    const b2top = fpOf(cabs, 'b2').y + fpOf(cabs, 'b2').d
    const e1 = at(cabs, 'e1').y
    bc.params.depth = inch(25)
    expect(pushNeighbours(cabs, 'bc', { width: bc.params.width, depth: inch(24), pullOut: inch(4) }, room, lib)).toEqual(['b2', 'b1', 'e1'])
    expect(at(cabs, 'bc').y + inch(25)).toBeCloseTo(room.depth, 6)
    expect(fpOf(cabs, 'b2').y + fpOf(cabs, 'b2').d).toBeCloseTo(b2top - inch(1), 6)
    expect(at(cabs, 'e1').y).toBeCloseTo(e1 - inch(1), 6)
    expect(roomProblems(cabs, room, (c) => c.placement!, lib).overlaps).toEqual([])
  })

  it('a wider cabinet on the side wall grows away from the corner, pushing the ones in front of it', () => {
    const cabs = placed(lKitchen())
    const top = fpOf(cabs, 'b1').y + fpOf(cabs, 'b1').d
    const e1 = at(cabs, 'e1').y
    const b1 = cabs.find((c) => c.id === 'b1')!
    b1.params.width = inch(21)
    expect(pushNeighbours(cabs, 'b1', inch(18), room, lib)).toEqual(['e1'])
    expect(fpOf(cabs, 'b1').y + fpOf(cabs, 'b1').d).toBeCloseTo(top, 6)
    expect(at(cabs, 'e1').y).toBeCloseTo(e1 - inch(3), 6)
    expect(roomProblems(cabs, room, (c) => c.placement!, lib).overlaps).toEqual([])
  })

  it('a wider back-run cabinet beside a left corner pushes to the right; the corner itself never moves', () => {
    const cabs = placed(lKitchen())
    const b4 = cabs.find((c) => c.id === 'b4')!
    b4.params.width = inch(33)
    expect(pushNeighbours(cabs, 'b4', inch(30), room, lib)).toEqual(['b5', 'b6', 'b7'])
    expect(at(cabs, 'b4').x).toBeCloseTo(inch(39), 6)
    expect(at(cabs, 'bc').x).toBeCloseTo(inch(3), 6)
    expect(at(cabs, 'b5').x).toBeCloseTo(inch(72), 6)
  })

  it('with only a right corner, a back-run cabinet grows to the left', () => {
    const cabs = placed([us('tpl-base-2door', 'a', 'B1', 30), us('tpl-base-2door', 'b', 'B2', 30), preset('tpl-us-blind-base-36', 'c', 'B3', (p) => (blindOf(p).blindSide = 'right'))])
    const right = at(cabs, 'b').x + inch(30)
    const a = at(cabs, 'a').x
    cabs.find((c) => c.id === 'b')!.params.width = inch(33)
    expect(pushNeighbours(cabs, 'b', inch(30), room, lib)).toEqual(['a'])
    expect(at(cabs, 'b').x + inch(33)).toBeCloseTo(right, 6)
    expect(at(cabs, 'a').x).toBeCloseTo(a - inch(3), 6)
  })
})

describe('Kitchen-2 B4/B5: fillers and end panels', () => {
  it('a filler: strip in the door plane from the toe kick up, banded except on the scribe edge, with its return behind', () => {
    const p = clone(KITCHEN_PRESETS.find((x) => x.id === 'tpl-us-filler-3')!.params)
    if (p.panel?.type !== 'filler') throw new Error('filler')
    p.panel.scribeSide = 'right'
    const g = generateCarcass(p, lib)
    expect(g.warnings).toEqual([])
    const strip = part(g.parts, 'filler')
    const e = extent(strip)
    ;[0, -18, inch(4)].forEach((v, i) => expect(e.lo[i]).toBeCloseTo(v, 6))
    expect(e.hi[0]).toBeCloseTo(inch(3) + inch(0.5), 6)
    expect(e.hi[2]).toBeCloseTo(inch(34.5), 6)
    expect(strip.length).toBeCloseTo(inch(34.5) - inch(4), 6)
    expect(strip.width).toBeCloseTo(inch(3.5), 6)
    expect(strip.grain).toBe('length')
    expect(strip.scribe).toEqual({ edge: strip.scribe!.edge, amount: inch(0.5) })
    // the scribed edge has no band, the other long edge has
    expect(strip.edges[strip.scribe!.edge]).toBeUndefined()
    expect(Object.values(strip.edges).filter(Boolean)).toHaveLength(1)
    const ret = part(g.parts, 'filler-return')
    const r = extent(ret)
    ;[0, 0, inch(4)].forEach((v, i) => expect(r.lo[i]).toBeCloseTo(v, 6))
    ;[18, inch(3), inch(34.5)].forEach((v, i) => expect(r.hi[i]).toBeCloseTo(v, 6))
    expect(ret.materialId).toBe(p.carcassMaterialId)
  })

  it('an end panel: flush with the door faces, toe-kick notch, scribe at the back, front edge banded', () => {
    const p = KITCHEN_PRESETS.find((x) => x.id === 'tpl-us-end-base')!.params
    const g = generateCarcass(p, lib)
    expect(g.warnings).toEqual([])
    const ep = part(g.parts, 'end-panel')
    const e = extent(ep)
    ;[0, -18, 0].forEach((v, i) => expect(e.lo[i]).toBeCloseTo(v, 6))
    expect(e.hi[1]).toBeCloseTo(inch(24) + inch(0.5), 6)
    expect(ep.length).toBeCloseTo(inch(34.5), 6)
    expect(ep.width).toBeCloseTo(inch(24) + 18 + inch(0.5), 6)
    expect(ep.thickness).toBe(18)
    expect(ep.outline).toHaveLength(6)
    expect(ep.scribe?.amount).toBe(inch(0.5))
    const front = Object.entries(ep.edges).filter(([, v]) => v)
    expect(front).toHaveLength(1)
    expect(front[0][0]).not.toBe(ep.scribe!.edge)
    // proud: the front stands out by that much more; a wall panel has no notch and its top and bottom are banded
    const proud = clone(p)
    if (proud.panel?.type === 'end-panel') proud.panel.front = 'proud'
    expect(extent(part(generateCarcass(proud, lib).parts, 'end-panel')).lo[1]).toBeCloseTo(-18 - inch(0.25), 6)
    const wall = KITCHEN_PRESETS.find((x) => x.id === 'tpl-us-end-wall')!.params
    const we = part(generateCarcass(wall, lib).parts, 'end-panel')
    expect(we.outline).toBeUndefined()
    expect(Object.values(we.edges).filter(Boolean)).toHaveLength(3)
    const tall = part(generateCarcass(KITCHEN_PRESETS.find((x) => x.id === 'tpl-us-end-tall')!.params, lib).parts, 'end-panel')
    expect(tall.length).toBeCloseTo(inch(84), 6)
    expect(tall.outline).toHaveLength(6)
  })

  it('the cut list, nesting and labels carry every new part with its size, edges and grain', () => {
    const d = data((x) => {
      x.settings.units = 'in'
    })
    const cabs = placed(lKitchen())
    // fronts and panels in a grained board: grain must hold
    for (const c of cabs) c.params.doorMaterialId = 'mat-pb18-oak'
    const j: Job = job(cabs, 'K2')
    const out = runJob(j, d)
    const names = new Set(out.cutList.map((r) => r.name))
    for (const n of ['Blind panel', 'Filler', 'Filler return', 'End panel']) expect(names.has(n), n).toBe(true)
    // every part of every cabinet is nested exactly once
    const nested = out.nest.sheets.flatMap((s) => s.placements.map((p) => p.uid))
    expect(new Set(nested).size).toBe(out.instances.length)
    expect(nested.length).toBe(out.instances.length)
    // sizes: the base end panel, cut to finished size less nothing (no premill), banded front only
    const ep = out.cutList.find((r) => r.name === 'End panel' && Math.abs(r.finishedLength - inch(34.5)) < 0.01)!
    expect(ep.finishedWidth).toBeCloseTo(inch(24) + 18 + inch(0.5), 6)
    expect(ep.cutWidth).toBeCloseTo(ep.finishedWidth - 1, 6) // 1 mm ABS on the front edge
    expect(ep.grain).toBe('L')
    expect(Object.values(ep.edges).filter(Boolean)).toEqual(['EB-WHT-1.0'])
    const bp = out.cutList.find((r) => r.name === 'Blind panel')!
    expect(bp.grain).toBe('L')
    expect(Object.values(bp.edges).filter(Boolean)).toHaveLength(4)
    const fl = out.cutList.find((r) => r.name === 'Filler')!
    expect(fl.finishedLength).toBeCloseTo(inch(30), 6)
    expect(fl.finishedWidth).toBeCloseTo(inch(3.5), 6)
    // grain-locked parts sit along the sheet's grain
    for (const s of out.nest.sheets)
      for (const pl of s.placements) {
        const inst = out.instances.find((i) => i.uid === pl.uid)!
        if (!inst.canRotate) expect(pl.rotated).toBe(false)
      }
    // labels: one per part, the scribe note in the shop's unit
    expect(out.labels.length).toBe(out.instances.length)
    const fLabel = out.labels.find((l) => l.partName === 'Filler')!
    expect(fLabel.notes.some((n) => /^Scribe 1\/2" on (L1|L2|W1|W2): trim to the wall$/.test(n))).toBe(true)
    expect(out.labels.find((l) => l.partName === 'Blind panel')!.grainLocked).toBe(true)
    expect(out.issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it('numbers fillers F and end panels E', () => {
    const j = { cabinets: [cabinet('tpl-base-2door', () => {}, 'a', 'B1')] }
    expect(nextCabinetNumber(j, KITCHEN_PRESETS.find((t) => t.id === 'tpl-us-filler-3')!.params)).toBe('F1')
    expect(nextCabinetNumber(j, KITCHEN_PRESETS.find((t) => t.id === 'tpl-us-end-wall')!.params)).toBe('E1')
    expect(nextCabinetNumber(j, KITCHEN_PRESETS.find((t) => t.id === 'tpl-us-blind-base-36')!.params)).toBe('B2')
  })
})

describe('Kitchen-2 B6: Fill gap', () => {
  const gapKitchen = () => placed(lKitchen().filter((c) => c.id !== 'f2'))
  const filler = (level: 'floor' | 'wall') => KITCHEN_PRESETS.find((t) => t.params.panel?.type === 'filler' && (level === 'wall') === (t.params.kind === 'wall'))!.params

  it('finds runs short of their wall: the back base run 3" short, the back wall run 3" short', () => {
    const cabs = gapKitchen()
    const gaps = runGaps(cabs, room, (c) => c.placement!, lib)
    expect(gaps.map((g) => [g.wall, g.level, Math.round(g.total * 1000) / 1000])).toEqual([
      ['back', 'floor', inch(3)],
      ['back', 'wall', inch(3)],
    ])
    expect(gaps[0]).toMatchObject({ anchor: 'start', startIsWall: false, endIsWall: true })
    expect(gaps[0].startGap).toBeCloseTo(0, 6)
  })

  it('one filler takes the whole gap against the wall, scribed to it; the run does not move', () => {
    const cabs = gapKitchen()
    const j = job(cabs)
    const g = runGaps(cabs, room, (c) => c.placement!, lib)[0]
    const before = cabs.map((c) => ({ ...c.placement! }))
    let n = 0
    const ids = fillGap(j, g, 'one', filler('floor'), room, (c) => c.placement!, () => `f-${++n}`)
    expect(ids).toEqual(['f-1'])
    const f = j.cabinets.find((c) => c.id === 'f-1')!
    expect(f.number).toBe('F1')
    expect(f.params.width).toBeCloseTo(inch(3), 6)
    expect(f.params.height).toBe(inch(34.5))
    expect(f.params.panel).toMatchObject({ type: 'filler', scribeSide: 'right' })
    expect(f.placement).toMatchObject({ x: room.width - inch(3), y: room.depth - inch(24), rotation: 0, z: 0 })
    // placed after the run's last cabinet, so Arrange keeps it there
    expect(j.cabinets.indexOf(f)).toBe(j.cabinets.findIndex((c) => c.id === 'b7') + 1)
    expect(j.cabinets.filter((c) => c.id !== 'f-1').map((c) => c.placement)).toEqual(before)
    expect(roomProblems(j.cabinets, room, (c) => c.placement!, lib)).toEqual({ overlaps: [], outside: [], blocked: [] })
    expect(runGaps(j.cabinets, room, (c) => c.placement!, lib).filter((x) => x.level === 'floor')).toEqual([])
    const laid = arrangeCabinets(j.cabinets, room, lib)
    expect(laid['f-1'].x).toBeCloseTo(room.width - inch(3), 6)
  })

  it('split: the run is centred, half the gap at each end; only the wall end is scribed', () => {
    const cabs = gapKitchen()
    const j = job(cabs)
    const g = runGaps(cabs, room, (c) => c.placement!, lib)[1]
    expect(g.level).toBe('wall')
    const w3 = at(cabs, 'w3').x
    let n = 0
    const ids = fillGap(j, g, 'split', filler('wall'), room, (c) => c.placement!, () => `f-${++n}`)
    const [a, b] = ids.map((id) => j.cabinets.find((c) => c.id === id)!)
    expect(a.params.width).toBeCloseTo(inch(1.5), 6)
    expect(b.params.width).toBeCloseTo(inch(1.5), 6)
    expect(a.params.panel).toMatchObject({ scribeSide: 'none' })
    expect(b.params.panel).toMatchObject({ scribeSide: 'right' })
    expect(a.placement!.x).toBeCloseTo(inch(27), 6)
    expect(at(j.cabinets, 'w3').x).toBeCloseTo(w3 + inch(1.5), 6)
    expect(a.params.kind).toBe('wall')
    expect(a.placement!.z).toBe(WALL_ELEVATION)
    expect(roomProblems(j.cabinets, room, (c) => c.placement!, lib)).toEqual({ overlaps: [], outside: [], blocked: [] })
  })

  it('a gap on a side wall run is offered between the run and the front wall only when small', () => {
    const cabs = placed([us('tpl-base-2door', 'a', 'B1', 30), preset('tpl-us-blind-base-36', 'c', 'B2')])
    // nothing on the left wall: no gap there; the back run is far from the wall: no fill offered
    expect(runGaps(cabs, room, (c) => c.placement!, lib)).toEqual([])
  })
})

describe('Kitchen-2 B7: US presets', () => {
  it('are in inches, stored to 0.001 mm and shown as plain fractions', () => {
    const want: Record<string, string[]> = {
      'tpl-us-blind-base-36': ['36"', '34-1/2"', '24"'],
      'tpl-us-blind-wall-24': ['24"', '30"', '12"'],
      // Kitchen-3: the pie-cut corners (width = the back-wall leg, depth = the side-wall leg)
      'tpl-us-pie-base-36': ['36"', '34-1/2"', '36"'],
      'tpl-us-pie-wall-24': ['24"', '30"', '24"'],
      'tpl-us-filler-3': ['3"', '34-1/2"', '24"'],
      'tpl-us-filler-3-wall': ['3"', '30"', '12"'],
      'tpl-us-end-base': ['11/16"', '34-1/2"', '24"'],
      'tpl-us-end-wall': ['11/16"', '30"', '12"'],
      'tpl-us-end-tall': ['11/16"', '84"', '24"'],
    }
    for (const t of KITCHEN_PRESETS) {
      const p = t.params
      expect([p.width, p.height, p.depth].map(formatInches), t.id).toEqual(want[t.id])
      for (const v of [p.width, p.height, p.depth]) expect(Math.round(v * 1000) / 1000).toBe(v)
      expect(generateCarcass(p, lib).warnings, t.id).toEqual([])
    }
    expect(KITCHEN_PRESETS.find((t) => t.id === 'tpl-us-blind-base-36')!.params.toeKick).toMatchObject({ height: toMm(4), setback: inch(3) })
  })

  it('reach a shop file saved before them, once; one the shop deleted stays deleted', () => {
    const old = defaultAppData() as Partial<AppData> & { library: AppData['library'] }
    old.library.templates = old.library.templates.filter((t) => !t.id.startsWith('tpl-us-'))
    delete old.library.seeded
    const n = normalizeData(clone(old) as AppData)
    expect(n.library.templates.filter((t) => t.id.startsWith('tpl-us-')).map((t) => t.id)).toEqual(KITCHEN_PRESETS.map((t) => t.id))
    expect(n.library.seeded).toEqual(KITCHEN_PRESETS.map((t) => t.id))
    n.library.templates = n.library.templates.filter((t) => t.id !== 'tpl-us-filler-3')
    const again = normalizeData(clone(n))
    expect(again.library.templates.some((t) => t.id === 'tpl-us-filler-3')).toBe(false)
    expect(again.library.templates.filter((t) => t.id.startsWith('tpl-us-'))).toHaveLength(KITCHEN_PRESETS.length - 1)
  })

  it('their invented values carry Configure badges until confirmed or changed', () => {
    const m = defaultAppData().machine
    const bc = KITCHEN_PRESETS.find((t) => t.id === 'tpl-us-blind-base-36')!.params
    expect(kitchenUnconfirmed(bc, m).map((u) => u.key)).toEqual(['kitchen:pullOut'])
    const end = clone(KITCHEN_PRESETS.find((t) => t.id === 'tpl-us-end-base')!.params)
    if (end.panel?.type === 'end-panel') end.panel.front = 'proud'
    expect(kitchenUnconfirmed(end, m).map((u) => u.key)).toEqual(['kitchen:scribe', 'kitchen:proud'])
    const filler = clone(KITCHEN_PRESETS.find((t) => t.id === 'tpl-us-filler-3')!.params)
    // no scribe side: the allowance is not used, so not badged
    expect(kitchenUnconfirmed(filler, m).map((u) => u.key)).toEqual(['kitchen:fillerReturn'])
    expect(kitchenUnconfirmed(bc, { confirmed: ['kitchen:pullOut'] })).toEqual([])
    const own = clone(bc)
    blindOf(own).pullOut = inch(2)
    expect(kitchenUnconfirmed(own, m)).toEqual([])
    // never part of the export check
    const out = runJob(job(placed(lKitchen())), defaultAppData())
    expect(out.issues.some((i) => /kitchen/i.test(i.message) || /Pull-out|Scribe allowance/.test(i.message))).toBe(false)
  })
})

describe('Kitchen-2: the old sample is untouched', () => {
  it('placementOf still falls back to the arranged layout', () => {
    const cabs = lKitchen()
    const laid = arrangeCabinets(cabs, room, lib)
    expect(placementOf(cabs[3], laid)).toEqual(laid.bc)
  })
})

describe('Kitchen-2 C: Polish-1 leftovers', () => {
  it('8: export-check sizes follow the inch switch (SMALL_PART, off-table sheets, construction sizes); mm stays as it was', async () => {
    const { sampleJob } = await import('../src/core/sample')
    const base = { ...sampleJob(), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
    const mm = runJob(base, data())
    expect(mm.issues.find((i) => i.code === 'SMALL_PART' && i.partNo === 22)!.message).toBe('Part #22 (764 x 100) is small; vacuum may not hold it. Consider onion-skin or tabs (not yet supported).')
    const inches = runJob(base, data((d) => (d.settings.units = 'in')))
    expect(inches.issues.find((i) => i.code === 'SMALL_PART' && i.partNo === 22)!.message).toBe('Part #22 (30-1/16" x 3-15/16") is small; vacuum may not hold it. Consider onion-skin or tabs (not yet supported).')
    // a sheet bigger than the machine table
    const big = (units: 'mm' | 'in') =>
      runJob(
        base,
        data((d) => {
          d.settings.units = units
          for (const m of d.library.materials) {
            m.sheetLength = 6000
            m.sheetWidth = 2400
          }
        }),
      ).issues.find((i) => i.code === 'OFF_TABLE')!.message
    expect(big('mm')).toMatch(/^Sheet 6000 x 2400 mm is larger than the machine table \d+(\.\d+)? x \d+(\.\d+)? mm\.$/)
    expect(big('in')).toMatch(/^Sheet 236-1\/4" x 94-1\/2" is larger than the machine table [\d-/]+" x [\d-/]+"\.$/)
    // sizes in construction warnings; machining values (depths, thicknesses) stay in mm
    const shallow = job([cabinet('tpl-base-drawers', (p) => (p.depth = 450))])
    const w = (units: 'mm' | 'in') => runJob(shallow, data((d) => (d.settings.units = units))).issues.filter((i) => i.code === 'CONSTRUCTION').map((i) => i.message)
    expect(w('mm')).toContain('B1 Base cabinet, 3 drawers: Cabinet depth 450 mm is under the 457 mm minimum for a 15 in TANDEM runner.')
    expect(w('in')).toContain('B1 Base cabinet, 3 drawers: Cabinet depth 17-11/16" is under the 18" minimum for a 15 in TANDEM runner.')
  })

  it('9: the nesting header gives trim and spacing in the shop unit', async () => {
    const { trimSpacingText, sizeText } = await import('../src/core/units')
    expect(trimSpacingText(10, 14, 'mm')).toBe('Trim 10 · spacing 14 mm')
    expect(trimSpacingText(10, 14, 'in')).toBe('Trim 3/8" · spacing 9/16"')
    expect(sizeText(14, 'mm')).toBe('14 mm')
    expect(sizeText(14, 'in')).toBe('9/16"')
  })

  it('10: metric tool sizes stay exact in inch mode (6 mm, not 1/4"); exact inch tools read as fractions; both read back', async () => {
    const { toolSize, exactInches, parseLength } = await import('../src/core/units')
    const { cellText, parseCell, GRID_FIELDS } = await import('../src/core/toolData')
    expect(toolSize(6, 'in')).toBe('6 mm')
    expect(toolSize(35, 'in')).toBe('35 mm')
    expect(toolSize(13.5, 'in')).toBe('13.5 mm')
    expect(toolSize(12.7, 'in')).toBe('1/2"')
    expect(toolSize(3.175, 'in')).toBe('1/8"')
    expect(toolSize(6.35, 'in')).toBe('1/4"')
    expect(toolSize(25.4, 'in')).toBe('1"')
    expect(toolSize(6, 'mm')).toBe('6')
    expect(exactInches(7.938)).toBe('5/16"') // a 5/16 in hole, stored to 0.001 mm
    expect(exactInches(7.95)).toBeNull()
    for (const v of [6, 35, 13.5, 12.7, 3.175, 0.5, 42, 9.525]) expect(parseLength(toolSize(v, 'in'), 'in')).toBeCloseTo(v, 9)
    const d = defaultAppData()
    const t205 = d.machine.tools.find((t) => t.number === 205)!
    const dia = GRID_FIELDS.find((f) => f.key === 'diameter')!
    expect(cellText(t205, dia, 'in')).toBe('6 mm')
    expect(cellText(t205, dia, 'mm')).toBe('6')
    expect(parseCell('6 mm', dia, 'in')).toEqual({ value: 6 })
    // a bare number still means the shop unit, as before
    expect(parseCell('1/2', dia, 'in')).toEqual({ value: 12.7 })
  })

  it('11: Enter applies a plain field as Tab does, and every field that applies on leaving also applies on Enter', async () => {
    const { enterApplies } = await import('../src/components/enterApplies')
    let blurred = 0
    let prevented = 0
    const ev = (key: string) => ({ key, preventDefault: () => prevented++, currentTarget: { blur: () => blurred++ } }) as unknown as Parameters<typeof enterApplies>[0]
    enterApplies(ev('a'))
    enterApplies(ev('Tab'))
    expect([blurred, prevented]).toEqual([0, 0])
    enterApplies(ev('Enter'))
    expect([blurred, prevented]).toEqual([1, 1])
    // every <input>/<Input> in the app that applies on blur also handles Enter
    const fs = await import('node:fs')
    const path = await import('node:path')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (p.endsWith('.tsx')) files.push(p)
      }
    }
    walk(path.resolve(__dirname, '../src'))
    const missing: string[] = []
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8')
      for (let at = src.indexOf('onBlur='); at >= 0; at = src.indexOf('onBlur=', at + 1)) {
        const start = Math.max(src.lastIndexOf('<input', at), src.lastIndexOf('<Input', at))
        if (start < 0) continue
        const end = src.indexOf('/>', at)
        if (!src.slice(start, end).includes('onKeyDown')) missing.push(`${path.relative(path.resolve(__dirname, '..'), f)}:${src.slice(0, at).split('\n').length}`)
      }
    }
    expect(missing).toEqual([])
    expect(files.length).toBeGreaterThan(50)
  })
})
