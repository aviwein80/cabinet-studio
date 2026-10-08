import { describe, expect, it } from 'vitest'
import { kindLabel } from '../src/components/kindLabel'
import { box, PartBuilder } from '../src/core/construction/builder'
import { buildCabinet, generateCarcass, isOpInsidePart } from '../src/core/construction/carcass'
import { pieFootprint, pieLegForDoor, pieSpans } from '../src/core/construction/pieCut'
import { cutListCsv, edgeDiagram, edgebandUsage, expandJob } from '../src/core/cutlist'
import { defaultAppData, defaultLibrary, KITCHEN_PRESETS } from '../src/core/defaults'
import { elevationOf } from '../src/core/elevation'
import { neg, toWorld, X, Y, Z } from '../src/core/geometry'
import { labelsZpl } from '../src/core/labels/zpl'
import { lCorner, lEdgeLengths, lSegments, onPart } from '../src/core/lpart'
import { mprFiles, runJob } from '../src/core/pipeline'
import {
  arrangeCabinets,
  cornerClearance,
  cornerSide,
  cornerWall,
  DEFAULT_ROOM,
  fillGap,
  footprint,
  pieClearance,
  planBoxes,
  pushNeighbours,
  roomProblems,
  runGaps,
  toRoom,
  WALL_ELEVATION,
} from '../src/core/room'
import type { BlindCornerParams, CabinetInstance, CarcassParams, DrillOp, Job, Part, PieCutParams, Vec2 } from '../src/core/types'
import { formatInches } from '../src/core/units'
import { cabinet, clone, data, job } from './helpers'

const lib = defaultLibrary()
const room = DEFAULT_ROOM
const inch = (n: number) => Math.round(n * 25.4 * 1000) / 1000
const part = (parts: Part[], key: string) => parts.find((p) => p.key === key)!
const drills = (p: Part, purpose: string) => p.ops.filter((o): o is DrillOp => o.kind === 'drill' && o.purpose === purpose)
const pieOf = (p: Pick<CarcassParams, 'corner'>) => p.corner as PieCutParams
const blindOf = (p: Pick<CarcassParams, 'corner'>) => p.corner as BlindCornerParams

type Box = { lo: number[]; hi: number[] }
/** World boxes a part fills: its box, or an L part's two rectangles (the cut-away corner left out). */
function solids(p: Part): Box[] {
  const rects: [number, number, number, number][] = []
  const c = p.shape === 'L' ? lCorner(p) : null
  if (!c) rects.push([0, p.length, 0, p.width])
  else {
    const xs: [number, number] = c.nW3 > 0 ? [0, c.inner.x] : [c.inner.x, p.length]
    const xo: [number, number] = c.nW3 > 0 ? [c.inner.x, p.length] : [0, c.inner.x]
    const yo: [number, number] = c.nL3 > 0 ? [0, c.inner.y] : [c.inner.y, p.width]
    rects.push([xs[0], xs[1], 0, p.width], [xo[0], xo[1], yo[0], yo[1]])
  }
  return rects.map(([x0, x1, y0, y1]) => {
    const pts = [x0, x1].flatMap((x) => [y0, y1].flatMap((y) => [0, p.thickness].map((d) => toWorld(p.frame, x, y, d))))
    return { lo: [0, 1, 2].map((i) => Math.min(...pts.map((v) => v[i]))), hi: [0, 1, 2].map((i) => Math.max(...pts.map((v) => v[i]))) }
  })
}
const clash = (a: Box, b: Box, tol = 0.01) => [0, 1, 2].every((k) => Math.min(a.hi[k], b.hi[k]) - Math.max(a.lo[k], b.lo[k]) > tol)
const extent = (p: Part) => {
  const s = solids(p)
  return { lo: [0, 1, 2].map((i) => Math.min(...s.map((b) => b.lo[i]))), hi: [0, 1, 2].map((i) => Math.max(...s.map((b) => b.hi[i]))) }
}

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
const pieBase = () => clone(KITCHEN_PRESETS.find((t) => t.id === 'tpl-us-pie-base-36')!.params)
const pieWall = () => clone(KITCHEN_PRESETS.find((t) => t.id === 'tpl-us-pie-wall-24')!.params)

/**
 * The acceptance kitchen: an L of the left wall and the back wall round a pie-cut corner (base and
 * wall), in job order as walked left to right: the left wall from its front end, the corners, then
 * the back wall. In the 144" room the back base run stops 3" short of the right wall (Fill gap);
 * the wall cabinets fill it.
 */
function pieKitchen(): CabinetInstance[] {
  return [
    preset('tpl-us-end-base', 'e1', 'E1', (p) => p.panel?.type === 'end-panel' && (p.panel.side = 'left')),
    us('tpl-base-1door', 'b1', 'B1', 18),
    us('tpl-base-drawers', 'b2', 'B2', 24),
    preset('tpl-us-pie-base-36', 'pc', 'B3'),
    us('tpl-base-2door', 'b4', 'B4', 30),
    us('tpl-sink-base', 'b5', 'B5', 36),
    us('tpl-base-drawers', 'b6', 'B6', 24),
    us('tpl-base-1door', 'b7', 'B7', 15),
    preset('tpl-us-end-wall', 'e2', 'E2', (p) => p.panel?.type === 'end-panel' && (p.panel.side = 'left')),
    us('tpl-wall-2door', 'w1', 'W1', 30),
    us('tpl-wall-2door', 'w2', 'W2', 18),
    preset('tpl-us-pie-wall-24', 'pw', 'W3'),
    us('tpl-wall-2door', 'w4', 'W4', 30),
    us('tpl-wall-2door', 'w5', 'W5', 36),
    us('tpl-wall-2door', 'w6', 'W6', 30),
    us('tpl-wall-2door', 'w7', 'W7', 24),
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
const place = (c: CabinetInstance) => c.placement!

/** Every solid of every cabinet in room coordinates (L parts as their two rectangles). */
function roomSolids(cabs: CabinetInstance[]) {
  const out: { cab: string; key: string; role: string; b: Box }[] = []
  for (const c of cabs) {
    for (const p of buildCabinet(c, lib).parts)
      for (const s of solids(p)) {
        const a = toRoom(s.lo[0], s.lo[1], s.lo[2], c.placement!, c.params.width, c.params.depth)
        const b = toRoom(s.hi[0], s.hi[1], s.hi[2], c.placement!, c.params.width, c.params.depth)
        out.push({ cab: c.id, key: p.key, role: p.role, b: { lo: [0, 1, 2].map((i) => Math.min(a[i], b[i])), hi: [0, 1, 2].map((i) => Math.max(a[i], b[i])) } })
      }
  }
  return out
}
function crossClashes(cabs: CabinetInstance[]) {
  const s = roomSolids(cabs)
  const out: string[] = []
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) if (s[i].cab !== s[j].cab && clash(s[i].b, s[j].b)) out.push(`${s[i].cab}:${s[i].key} x ${s[j].cab}:${s[j].key}`)
  return out
}

// ---------------------------------------------------------------------------------------------

describe('Kitchen-3 A: L-shaped parts', () => {
  const L = (missing: 'x0y0' | 'xLy0' | 'x0yW' | 'xLyW'): Pick<Part, 'length' | 'width' | 'outline' | 'shape'> => {
    // a 1000 x 600 rectangle with a 400 x 250 corner cut away
    const o: Record<typeof missing, Vec2[]> = {
      x0y0: [{ x: 400, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 600 }, { x: 0, y: 600 }, { x: 0, y: 250 }, { x: 400, y: 250 }],
      xLy0: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 250 }, { x: 1000, y: 250 }, { x: 1000, y: 600 }, { x: 0, y: 600 }],
      x0yW: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 600 }, { x: 400, y: 600 }, { x: 400, y: 350 }, { x: 0, y: 350 }],
      xLyW: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 350 }, { x: 600, y: 350 }, { x: 600, y: 600 }, { x: 0, y: 600 }],
    }
    return { length: 1000, width: 600, outline: o[missing], shape: 'L' }
  }

  it('finds the cut-away corner and names every edge: the outer four, and L3 / W3 along the cut', () => {
    const want = { x0y0: [-1, -1, 400, 250], xLy0: [1, -1, 600, 250], x0yW: [-1, 1, 400, 350], xLyW: [1, 1, 600, 350] } as const
    for (const [k, [nW3, nL3, cx, cy]] of Object.entries(want)) {
      const p = L(k as keyof typeof want)
      const c = lCorner(p)!
      expect([c.nW3, c.nL3, c.inner.x, c.inner.y], k).toEqual([nW3, nL3, cx, cy])
      const segs = lSegments(p)!
      expect(segs.map((s) => s.key).sort(), k).toEqual(['L1', 'L2', 'L3', 'W1', 'W2', 'W3'])
      // every normal points out of the part: a point just outside the edge's middle is off the part
      for (const s of segs) {
        const m = { x: (s.a.x + s.b.x) / 2 + s.n.x, y: (s.a.y + s.b.y) / 2 + s.n.y }
        const inward = { x: (s.a.x + s.b.x) / 2 - s.n.x, y: (s.a.y + s.b.y) / 2 - s.n.y }
        expect(onPart(p, m), `${k} ${s.key} outside`).toBe(false)
        expect(onPart(p, inward), `${k} ${s.key} inside`).toBe(true)
      }
      // two outer edges are stopped by the cut; the inside edges run along it
      const len = lEdgeLengths(p)
      expect(len.L3! + len.W3!).toBeCloseTo(400 + 250, 9)
      expect(len.L1! + len.L2!).toBeCloseTo(2000 - 400, 9)
      expect(len.W1! + len.W2!).toBeCloseTo(1200 - len.W3!, 9)
    }
    // anything that is not an L: no corner
    expect(lCorner({ length: 10, width: 10, outline: undefined })).toBeNull()
    expect(lCorner({ length: 10, width: 10, outline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] })).toBeNull()
  })

  it('a part builder cuts the corner away, bands the inside edges by world direction, and drills nothing in the cut', () => {
    // a 900 x 900 bottom (face up +Z), the front-right 600 x 300 cut away
    const b = new PartBuilder('bottom', 'Bottom', 'bottom', 'mat-pb18-white', box([0, 0, 0], [900, 900, 18]), X, Z, 'length')
    b.lShape(box([300, -1, -1], [901, 600, 19]))
    expect(b.part.shape).toBe('L')
    expect(b.insideEdgeOf(neg(Y))).toBe('L3')
    expect(b.insideEdgeOf(X)).toBe('W3')
    expect(b.insideEdgeOf(Y)).toBeNull()
    b.bandInside(neg(Y), 'eb-white-1')
    b.bandInside(X, 'eb-white-1')
    expect(b.part.edges).toEqual({ L3: 'eb-white-1', W3: 'eb-white-1' })
    b.drill([450, 300, 18], 5, 10, 'custom')
    b.drill([150, 300, 18], 5, 10, 'custom')
    expect(b.part.ops.map((o) => (o.kind === 'drill' ? [o.x, o.y] : null))).toEqual([[150, 300]])
    expect(isOpInsidePart(b.part, { kind: 'drill', id: 'h', x: 450, y: 300, diameter: 5, depth: 5, through: false, purpose: 'custom' })).toBe(false)
    expect(isOpInsidePart(b.part, { kind: 'drill', id: 'h', x: 450, y: 700, diameter: 5, depth: 5, through: false, purpose: 'custom' })).toBe(true)
    // turned over (face up -Z), the same cut and bands land on the same physical edges
    const t = new PartBuilder('top', 'Top', 'top', 'mat-pb18-white', box([0, 0, 0], [900, 900, 18]), X, neg(Z), 'length')
    t.lShape(box([300, -1, -1], [901, 600, 19]))
    t.bandInside(neg(Y), 'eb-white-1')
    t.bandInside(X, 'eb-white-1')
    expect(t.part.edges).toEqual({ L3: 'eb-white-1', W3: 'eb-white-1' })
    const seg = lSegments(t.part)!.find((s) => s.key === 'L3')!
    expect(toWorld(t.part.frame, (seg.a.x + seg.b.x) / 2, seg.a.y)[1]).toBeCloseTo(600, 9)
  })

  it('cut sizes: the inside edges move in by their band less the pre-mill; the unbanded outer frame as before', () => {
    const p = pieBase()
    const d = data((x) => (x.settings.nesting.premill = 0.5))
    const ex = expandJob(job([{ id: 'pc', number: 'B1', name: 'Pie', templateId: null, qty: 1, params: p, overrides: {} }]), d.library, d.settings)
    const bottom = ex.instances.find((i) => i.part.key === 'bottom')!
    const fin = bottom.part
    const c = lCorner(fin)!
    // no band on the outer four edges: no compensation there (as on any part)
    expect(bottom.cutLength).toBeCloseTo(fin.length, 9)
    expect(bottom.cutWidth).toBeCloseTo(fin.width, 9)
    // each inside edge moves along its normal by the pre-mill less the 1 mm band
    const cut = lCorner({ length: bottom.cutLength, width: bottom.cutWidth, outline: bottom.outline })!
    expect(cut.inner.x).toBeCloseTo(c.inner.x + c.nW3 * (0.5 - 1), 9)
    expect(cut.inner.y).toBeCloseTo(c.inner.y + c.nL3 * (0.5 - 1), 9)
    // the outer corners stay on the cut rectangle
    for (const v of bottom.outline) if (v.x !== cut.inner.x || v.y !== cut.inner.y) expect([0, bottom.cutLength].includes(v.x) || [0, bottom.cutWidth].includes(v.y)).toBe(true)
    // the finished L (less the bands) fits inside the cut L, and the cut L is no more than the pre-mill bigger
    expect(cut.nW3).toBe(c.nW3)
    expect(cut.nL3).toBe(c.nL3)
  })

  it('rectangular parts are untouched: four edge keys, the old edge code, the old cut-list columns', () => {
    const out = runJob(job([cabinet('tpl-base-2door'), cabinet('tpl-sink-base', () => {}, 'c2', 'B2')]), defaultAppData())
    for (const l of out.labels) {
      expect(Object.keys(l.edges)).toEqual(['L1', 'L2', 'W1', 'W2'])
      expect(l.edgeDiagram.split(':')).toHaveLength(4)
    }
    expect(cutListCsv(out.cutList).split('\r\n')[0]).toBe('Material,Part,Cabinets,Qty,Cut L,Cut W,T,Finished L,Finished W,Edge L1,Edge L2,Edge W1,Edge W2,Grain')
    expect(out.instances.some((i) => i.part.shape)).toBe(false)
  })
})

describe('Kitchen-3 B: the pie-cut corner base and wall', () => {
  it('36" x 36" base: end sides, an L bottom, top and shelf banded on their inside edges, two backs, two doors', () => {
    const p = pieBase()
    const g = generateCarcass(p, lib)
    expect(g.warnings).toEqual([])
    expect(g.parts.map((x) => x.key)).toEqual(['side-back', 'side-return', 'bottom', 'top', 'back', 'back-side', 'shelf-1', 'door-back', 'door-side'])
    const f = pieFootprint(p, pieOf(p))
    for (const k of ['bottom', 'top', 'shelf-1']) {
      const lp = part(g.parts, k)
      expect(lp.shape, k).toBe('L')
      expect(lp.outline, k).toHaveLength(6)
      // only the two inside edges are banded (carcass front band, the shelf front band on the shelf)
      expect(Object.entries(lp.edges).filter(([, v]) => v).map(([e]) => e).sort(), k).toEqual(['L3', 'W3'])
      expect(lp.edges.L3).toBe(k === 'shelf-1' ? p.edgebands.shelfFront : p.edgebands.carcassFront)
      // the L lies in the legs: nothing in the open square in front of them
      for (const s of solids(lp)) {
        const inOpening = s.lo[0] < f.opening.x1 - 0.01 && s.hi[0] > f.opening.x0 + 0.01 && s.lo[1] < f.opening.y1 - 0.01 && s.hi[1] > f.opening.y0 + 0.01
        expect(inOpening, k).toBe(false)
      }
      // the inside edges lie on (bottom, top) or behind (shelf, by its front setback) the two fronts
      const segs = lSegments(lp)!
      const world = (s: (typeof segs)[number]) => toWorld(lp.frame, (s.a.x + s.b.x) / 2, (s.a.y + s.b.y) / 2)
      const back = k === 'shelf-1' ? p.shelves.frontSetback : 0
      expect(world(segs.find((s) => s.key === 'L3')!)[1] - (p.depth - pieOf(p).legDepth), k).toBeCloseTo(back, 6)
      expect(pieOf(p).legDepth - world(segs.find((s) => s.key === 'W3')!)[0], k).toBeCloseTo(back, 6)
    }
    // no part of the cabinet runs into another, except the bottom and top in their dados and the backs in their grooves
    const all = g.parts.flatMap((x) => solids(x).map((b) => ({ k: x.key, b })))
    const allowed = new Set(['side-back|bottom', 'side-back|top', 'side-return|bottom', 'side-return|top', 'side-back|back', 'side-return|back-side', 'bottom|back', 'bottom|back-side', 'top|back', 'top|back-side', 'back|back-side'])
    const hits = new Set<string>()
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (all[i].k !== all[j].k && clash(all[i].b, all[j].b)) hits.add(`${all[i].k}|${all[j].k}`)
    expect([...hits].filter((h) => !allowed.has(h))).toEqual([])
    // the backs only meet where the side-wall back butts against the back-wall back's face
    expect(hits.has('back|back-side')).toBe(false)
  })

  it('two doors, each hinged at the end of its leg on Salice cups and 3 mm plates in that end side; the back-wall door runs through at the corner', () => {
    const p = pieBase()
    p.shelves.count = 0 // (plate screws share the 37 mm row with the front shelf pins)
    const g = generateCarcass(p, lib)
    const c = pieOf(p)
    const W = p.width
    const B = p.depth
    const d = c.legDepth
    const gap = p.doors.gap
    const back = part(g.parts, 'door-back')
    const side = part(g.parts, 'door-side')
    const be = extent(back)
    const se = extent(side)
    // the back-wall door in front of the back leg, from the inside corner to its end
    expect(be.lo[0]).toBeCloseTo(d, 6)
    expect(be.hi[0]).toBeCloseTo(W - gap / 2, 6)
    expect(be.lo[1]).toBeCloseTo(B - d - 18, 6)
    expect(be.hi[1]).toBeCloseTo(B - d, 6)
    // the side-wall door in front of the side leg, stopping the gap short of the back-wall door's face
    expect(se.lo[0]).toBeCloseTo(d, 6)
    expect(se.hi[0]).toBeCloseTo(d + 18, 6)
    expect(se.lo[1]).toBeCloseTo(gap / 2, 6)
    expect(se.hi[1]).toBeCloseTo(B - d - 18 - gap, 6)
    expect(clash(be, se)).toBe(false)
    const sp = pieSpans(p, c, 18)
    expect(formatInches(sp.backWidth)).toBe('11-15/16"')
    expect(formatInches(sp.sideWidth)).toBe('11-1/8"')
    // cups at each door's hinge edge, at the far end of its leg
    const cupsB = drills(back, 'hinge-cup')
    const cupsS = drills(side, 'hinge-cup')
    expect(cupsB.length).toBe(2)
    expect(cupsS.length).toBe(2)
    for (const h of cupsB) expect(toWorld(back.frame, h.x, h.y)[0]).toBeCloseTo(W - gap / 2 - p.doors.cupEdgeDistance, 6)
    for (const h of cupsS) expect(toWorld(side.frame, h.x, h.y)[1]).toBeCloseTo(gap / 2 + p.doors.cupEdgeDistance, 6)
    // plates: two screws per hinge, 37 mm back from the front edge of the end side the door hangs on
    const pb = drills(part(g.parts, 'side-back'), 'mounting-plate')
    const ps = drills(part(g.parts, 'side-return'), 'mounting-plate')
    expect(pb).toHaveLength(4)
    expect(ps).toHaveLength(4)
    const sb = part(g.parts, 'side-back')
    for (const h of pb) {
      const w = toWorld(sb.frame, h.x, h.y)
      expect(w[0]).toBeCloseTo(W - 18, 6)
      expect(w[1]).toBeCloseTo(B - d + 37, 6)
    }
    const sr = part(g.parts, 'side-return')
    for (const h of ps) {
      const w = toWorld(sr.frame, h.x, h.y)
      expect(w[0]).toBeCloseTo(d - 37, 6)
      expect(w[1]).toBeCloseTo(18, 6)
    }
    // the plate pairs at each cup's height
    expect(new Set(pb.map((h) => Math.round(toWorld(sb.frame, h.x, h.y)[2] * 1000))).size).toBe(4)
    expect(g.hardware.find((h) => h.hardwareCode === 'SALICE-110-SC')?.qty).toBe(4)
    expect(g.hardware.find((h) => h.hardwareCode === 'SALICE-B2VGV-H3')?.qty).toBe(4)
    // the other way round: the side-wall door runs through and the back-wall door stops short
    c.cornerDoor = 'side'
    const h = generateCarcass(p, lib)
    expect(extent(part(h.parts, 'door-side')).hi[1]).toBeCloseTo(B - d, 6)
    expect(extent(part(h.parts, 'door-back')).lo[0]).toBeCloseTo(d + 18 + gap, 6)
    expect(clash(extent(part(h.parts, 'door-side')), extent(part(h.parts, 'door-back')))).toBe(false)
    // typing a door width sets the leg
    expect(pieLegForDoor(p, c, 18, 'back', sp.backWidth)).toBeCloseTo(d + 18 + gap + sp.backWidth + gap / 2, 6)
  })

  it('back-right is the mirror image of back-left', () => {
    const l = generateCarcass(pieBase(), lib)
    const q = pieBase()
    pieOf(q).side = 'right'
    const r = generateCarcass(q, lib)
    expect(r.warnings).toEqual([])
    expect(r.parts.map((x) => x.key)).toEqual(l.parts.map((x) => x.key))
    for (const pl of l.parts) {
      const pr = part(r.parts, pl.key)
      const a = extent(pl)
      const b = extent(pr)
      expect([b.lo[0], b.hi[0]], pl.key).toEqual([expect.closeTo(q.width - a.hi[0], 6), expect.closeTo(q.width - a.lo[0], 6)])
      expect([b.lo[1], b.hi[1], b.lo[2], b.hi[2]], pl.key).toEqual([a.lo[1], a.hi[1], a.lo[2], a.hi[2]].map((v) => expect.closeTo(v, 6)))
      expect(pr.ops.length, pl.key).toBe(pl.ops.length)
      // (a mirrored part's frame is mirrored too, so an outer edge may change its name; the inside edges keep theirs)
      expect(Object.values(pr.edges).filter(Boolean).length, pl.key).toBe(Object.values(pl.edges).filter(Boolean).length)
      if (pl.shape === 'L') expect([pr.edges.L3, pr.edges.W3], pl.key).toEqual([pl.edges.L3, pl.edges.W3])
    }
    // the back-wall door hinges at the back leg's end, now at the left
    const cups = drills(part(r.parts, 'door-back'), 'hinge-cup')
    for (const h of cups) expect(toWorld(part(r.parts, 'door-back').frame, h.x, h.y)[0]).toBeCloseTo(q.doors.gap / 2 + q.doors.cupEdgeDistance, 6)
  })

  it('24" x 24" wall: full L top and bottom, two L shelves, 12" legs, two doors', () => {
    const p = pieWall()
    const g = generateCarcass(p, lib)
    expect(g.warnings).toEqual([])
    expect(p.kind).toBe('wall')
    expect(g.parts.filter((x) => x.shape === 'L').map((x) => x.key)).toEqual(['bottom', 'top', 'shelf-1', 'shelf-2'])
    expect(g.parts.filter((x) => x.role === 'door')).toHaveLength(2)
    expect(extent(part(g.parts, 'bottom')).lo[2]).toBeCloseTo(0, 6)
    expect(g.hardware.find((h) => h.hardwareCode === 'PIN-5')?.qty).toBe(8)
  })

  it('butt joints: connectors at both end sides into the L panels; applied backs; toe-kick boards; warnings', () => {
    const p = pieBase()
    p.bottomJoint = 'butt'
    p.joinery = 'dowel'
    p.back.type = 'applied'
    p.toeKick.board = true
    const g = generateCarcass(p, lib)
    expect(g.warnings).toEqual([])
    const bottom = part(g.parts, 'bottom')
    const h = bottom.ops.filter((o) => o.kind === 'hdrill')
    // three joints along each 24" leg end (over 450 mm: front, middle, back)
    expect(h).toHaveLength(6)
    for (const o of h) expect(onPart(bottom, { x: o.x, y: o.y })).toBe(true)
    expect(drills(part(g.parts, 'side-back'), 'dowel')).toHaveLength(6)
    expect(drills(part(g.parts, 'side-return'), 'dowel')).toHaveLength(6)
    expect(g.hardware.find((x) => x.hardwareCode === 'DOWEL-8x30')?.qty).toBe(12)
    // applied backs on the walls, the carcass stepped in by their thickness
    const back = extent(part(g.parts, 'back'))
    const bs = extent(part(g.parts, 'back-side'))
    expect(back.hi[1]).toBeCloseTo(p.depth, 6)
    expect(bs.lo[0]).toBeCloseTo(0, 6)
    expect(clash(back, bs)).toBe(false)
    expect(g.parts.filter((x) => x.role === 'toekick').map((x) => x.key)).toEqual(['toekick', 'toekick-side'])
    expect(clash(extent(part(g.parts, 'toekick')), extent(part(g.parts, 'toekick-side')))).toBe(false)
    // warnings: drawers, rails, legs too short for the depth
    const q = pieBase()
    q.drawers.count = 2
    q.top = 'rails'
    expect(generateCarcass(q, lib).warnings).toEqual(['Drawers are left out of a pie-cut corner cabinet.', 'A pie-cut corner has a full L-shaped top; the two rails are not used.'])
    const r = pieBase()
    pieOf(r).legDepth = inch(34)
    const bad = generateCarcass(r, lib, undefined, 'in')
    expect(bad.parts).toEqual([])
    expect(bad.warnings[0]).toMatch(/must be longer than the 34" leg depth/)
    const narrow = pieBase()
    narrow.width = inch(29)
    expect(generateCarcass(narrow, lib, undefined, 'in').warnings).toEqual(['The back-wall door is only 4-15/16" wide; lengthen the back-wall leg.'])
  })

  it('presets: in inches, no warnings, labelled, and a corner cabinet that fills the back-left corner', () => {
    for (const p of [pieBase(), pieWall()]) {
      expect(generateCarcass(p, lib).warnings).toEqual([])
      expect(cornerSide(p)).toBe('left')
      expect(cornerWall(p)).toBe('back')
    }
    expect(kindLabel(pieBase())).toBe('Pie-cut corner base, back-left corner')
    expect(defaultAppData().library.templates.filter((t) => t.params.corner?.type === 'pie-cut').map((t) => t.id)).toEqual(['tpl-us-pie-base-36', 'tpl-us-pie-wall-24'])
  })
})

describe('Kitchen-3 C: the room', () => {
  it('Arrange fills the back-left corner: the left run butts against the side leg, the back run starts at the back leg; no problems', () => {
    const cabs = placed(pieKitchen())
    expect(at(cabs, 'pc')).toMatchObject({ x: 0, y: room.depth - inch(36), rotation: 0, z: 0 })
    expect(at(cabs, 'pw')).toMatchObject({ x: 0, y: room.depth - inch(24), rotation: 0, z: WALL_ELEVATION })
    expect(at(cabs, 'b4').x).toBeCloseTo(inch(36), 6)
    expect(at(cabs, 'w4').x).toBeCloseTo(inch(24), 6)
    const b2 = fpOf(cabs, 'b2')
    expect(b2.y + b2.d).toBeCloseTo(room.depth - inch(36), 6)
    expect(fpOf(cabs, 'w2').y + fpOf(cabs, 'w2').d).toBeCloseTo(room.depth - inch(24), 6)
    for (const id of ['e1', 'b1', 'b2', 'e2', 'w1', 'w2']) expect(at(cabs, id)).toMatchObject({ x: 0, rotation: 270 })
    expect(roomProblems(cabs, room, place, lib)).toEqual({ overlaps: [], outside: [], blocked: [] })
    // the doors beside each pie-cut door stand flush with it
    expect(pieClearance(cabs, 'pc', place, lib)).toEqual({ back: { id: 'b4', clearance: 0 }, side: { id: 'b2', clearance: 0 } })
    expect(pieClearance(cabs, 'pw', place, lib)).toEqual({ back: { id: 'w4', clearance: 0 }, side: { id: 'w2', clearance: 0 } })
    // its plan: two legs, the square in front of them open
    const pc = cabs.find((c) => c.id === 'pc')!
    const legs = planBoxes(pc, at(cabs, 'pc'))
    expect(legs).toHaveLength(2)
    expect(legs.reduce((a, b) => a + b.w * b.d, 0)).toBeCloseTo(inch(36) * inch(36) - inch(12) * inch(12), 3)
  })

  it('no overlaps in 3D: every solid of every cabinet (L parts as their two legs) stays clear of every other cabinet', () => {
    const cabs = placed(pieKitchen())
    expect(crossClashes(cabs)).toEqual([])
    // the return's end butts against the side leg's end side; the back run against the back leg's
    const s = roomSolids(cabs)
    const sideEnd = s.find((x) => x.cab === 'pc' && x.key === 'side-return')!.b
    expect(s.filter((x) => x.cab === 'b2' && x.role === 'side').some((x) => Math.abs(x.b.hi[1] - sideEnd.lo[1]) < 1e-6)).toBe(true)
    const backEnd = s.find((x) => x.cab === 'pc' && x.key === 'side-back')!.b
    expect(s.filter((x) => x.cab === 'b4' && x.role === 'side').some((x) => Math.abs(x.b.lo[0] - backEnd.hi[0]) < 1e-6)).toBe(true)
  })

  it('both elevations show it facing you: the back wall its back-wall door, the left wall its side-wall door, the other leg end on', () => {
    const cabs = placed(pieKitchen())
    for (const wall of ['back', 'left'] as const) {
      const items = elevationOf(cabs, room, wall, place, lib)
      for (let i = 0; i < items.length; i++)
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i]
          const b = items[j]
          const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
          const oz = Math.min(a.z + a.h, b.z + b.h) - Math.max(a.z, b.z)
          expect(ox > 0.5 && oz > 0.5, `${wall}: ${a.number} and ${b.number}`).toBe(false)
        }
    }
    const p = cabs.find((c) => c.id === 'pc')!.params
    const sp = pieSpans(p, pieOf(p), 18)
    const back = elevationOf(cabs, room, 'back', place, lib).find((i) => i.id === 'pc')!
    expect(back).toMatchObject({ x: 0, faces: true })
    expect(back.secondWall).toBeUndefined()
    const door = back.divisions.find((d) => d.kind === 'door')!
    expect(door.u0 * back.w).toBeCloseTo(sp.back!.x0, 6)
    expect(door.u1 * back.w).toBeCloseTo(sp.back!.x1, 6)
    expect(back.divisions.find((d) => d.kind === 'leg')).toMatchObject({ u0: 0, u1: expect.closeTo(pieOf(p).legDepth / p.width, 9) })
    const left = elevationOf(cabs, room, 'left', place, lib)
    const lp = left.find((i) => i.id === 'pc')!
    expect(lp).toMatchObject({ faces: true, secondWall: true })
    expect(lp.x + lp.w).toBeCloseTo(room.depth, 6)
    const sd = lp.divisions.find((d) => d.kind === 'door')!
    expect(lp.x + sd.u0 * lp.w).toBeCloseTo(room.depth - p.depth + sp.side!.y0, 6)
    expect(lp.x + sd.u1 * lp.w).toBeCloseTo(room.depth - p.depth + sp.side!.y1, 6)
    expect(left.filter((i) => i.z === 0).map((i) => i.number)).toEqual(['E1', 'B1', 'B2', 'B3'])
  })

  it('back-right: the right run walks from the corner to the front, mirrored', () => {
    const cabs = placed([
      us('tpl-base-2door', 'a', 'B1', 30),
      us('tpl-base-2door', 'b', 'B2', 30),
      preset('tpl-us-pie-base-36', 'c', 'B3', (p) => (pieOf(p).side = 'right')),
      us('tpl-base-1door', 'd', 'B4', 18),
      us('tpl-base-1door', 'e', 'B5', 18),
    ])
    expect(at(cabs, 'c')).toMatchObject({ x: room.width - inch(36), y: room.depth - inch(36), rotation: 0 })
    expect(at(cabs, 'b').x + inch(30)).toBeCloseTo(room.width - inch(36), 6)
    for (const id of ['d', 'e']) expect(at(cabs, id)).toMatchObject({ x: room.width - inch(24), rotation: 90 })
    expect(fpOf(cabs, 'd').y + fpOf(cabs, 'd').d).toBeCloseTo(room.depth - inch(36), 6)
    expect(roomProblems(cabs, room, place, lib)).toEqual({ overlaps: [], outside: [], blocked: [] })
    expect(crossClashes(cabs)).toEqual([])
    expect(pieClearance(cabs, 'c', place, lib)).toEqual({ back: { id: 'b', clearance: 0 }, side: { id: 'd', clearance: 0 } })
    const right = elevationOf(cabs, room, 'right', place, lib)
    expect(right.map((i) => i.number)).toEqual(['B3', 'B4', 'B5'])
    expect(right[0]).toMatchObject({ x: 0, secondWall: true, faces: true })
  })

  it('the push follows the legs: a longer back leg moves the back run, a longer side leg the left run; the corner stays put', () => {
    const cabs = placed(pieKitchen())
    const pc = cabs.find((c) => c.id === 'pc')!
    const b4 = at(cabs, 'b4').x
    pc.params.width = inch(39)
    expect(pushNeighbours(cabs, 'pc', { width: inch(36), depth: inch(36) }, room, lib)).toEqual(['b4', 'b5', 'b6', 'b7'])
    expect(at(cabs, 'pc')).toMatchObject({ x: 0, y: room.depth - inch(36) })
    expect(at(cabs, 'b4').x).toBeCloseTo(b4 + inch(3), 6)
    const e1 = at(cabs, 'e1').y
    pc.params.depth = inch(38)
    expect(pushNeighbours(cabs, 'pc', { width: inch(39), depth: inch(36) }, room, lib)).toEqual(['b2', 'b1', 'e1'])
    expect(at(cabs, 'pc').y + inch(38)).toBeCloseTo(room.depth, 6)
    expect(fpOf(cabs, 'b2').y + fpOf(cabs, 'b2').d).toBeCloseTo(room.depth - inch(38), 6)
    expect(at(cabs, 'e1').y).toBeCloseTo(e1 - inch(2), 6)
    // a wider cabinet on the back run grows away from the corner
    const b5 = cabs.find((c) => c.id === 'b5')!
    b5.params.width = inch(39)
    expect(pushNeighbours(cabs, 'b5', inch(36), room, lib)).toEqual(['b6', 'b7'])
    expect(roomProblems(cabs, room, place, lib).overlaps).toEqual([])
  })

  it('a deeper cabinet against a wall keeps its back on the wall and its front comes forward (and the room says when that is proud of a pie-cut door)', () => {
    const cabs = placed(pieKitchen())
    const b4 = cabs.find((c) => c.id === 'b4')!
    const y = at(cabs, 'b4').y
    b4.params.depth = inch(25)
    expect(pushNeighbours(cabs, 'b4', { width: b4.params.width, depth: inch(24) }, room, lib)).toEqual([])
    expect(at(cabs, 'b4').y).toBeCloseTo(y - inch(1), 6)
    expect(fpOf(cabs, 'b4').y + fpOf(cabs, 'b4').d).toBeCloseTo(room.depth, 6)
    expect(roomProblems(cabs, room, place, lib)).toEqual({ overlaps: [], outside: [], blocked: [{ corner: 'pc', by: 'b4', clearance: -inch(1), kind: 'door' }] })
    // on the left wall the box already grows away from the wall; on the right wall it is moved off it
    const b1 = cabs.find((c) => c.id === 'b1')!
    const x1 = at(cabs, 'b1').x
    b1.params.depth = inch(26)
    pushNeighbours(cabs, 'b1', { width: b1.params.width, depth: inch(24) }, room, lib)
    expect(at(cabs, 'b1').x).toBe(x1)
    const r = placed([preset('tpl-us-pie-base-36', 'c', 'B1', (p) => (pieOf(p).side = 'right')), us('tpl-base-1door', 'd', 'B2', 18)])
    const d = r.find((c) => c.id === 'd')!
    d.params.depth = inch(26)
    pushNeighbours(r, 'd', { width: d.params.width, depth: inch(24) }, room, lib)
    expect(fpOf(r, 'd').x + fpOf(r, 'd').w).toBeCloseTo(room.width, 6)
    expect(pieClearance(r, 'c', place, lib)!.side).toEqual({ id: 'd', clearance: -inch(2) })
  })

  it('Fill gap: the back run is held at the back leg and filled at the wall', () => {
    const cabs = placed(pieKitchen())
    const gaps = runGaps(cabs, room, place, lib)
    expect(gaps.map((x) => [x.wall, x.level])).toEqual([['back', 'floor']])
    const g = gaps[0]
    expect(g.startBound).toBeCloseTo(inch(36), 6)
    expect(g.anchor).toBe('start')
    expect(g.total).toBeCloseTo(inch(3), 6)
    const j: Job = job(cabs)
    const filler = KITCHEN_PRESETS.find((t) => t.id === 'tpl-us-filler-3')!.params
    const ids = fillGap(j, g, 'one', filler, room, place, () => 'f1')
    expect(ids).toEqual(['f1'])
    const f = j.cabinets.find((c) => c.id === 'f1')!
    expect(f.placement!.x + f.params.width).toBeCloseTo(room.width, 6)
    expect(roomProblems(j.cabinets, room, place, lib)).toEqual({ overlaps: [], outside: [], blocked: [] })
  })

  it('the open square in front is kept for the doors: a cabinet put there is reported, as is a deeper cabinet beside a door', () => {
    const cabs = placed(pieKitchen())
    const b1 = cabs.find((c) => c.id === 'b1')!
    // a 10" deep cabinet dragged into the open square in front of the legs (clear of both)
    b1.params.depth = inch(10)
    b1.placement = { x: inch(25), y: room.depth - inch(36), rotation: 0, z: 0 }
    const pr = roomProblems(cabs, room, place, lib)
    // not counted as an overlap with the corner (it is clear of its legs) ...
    expect(pr.overlaps.some((o) => o.includes('pc'))).toBe(false)
    // ... but its doors cannot swing
    expect(pr.blocked.find((b) => b.by === 'b1')).toMatchObject({ corner: 'pc', kind: 'opening' })
    // a 25" deep cabinet beside the back-wall door stands 1" proud of it
    const cabs2 = placed(pieKitchen())
    const b4 = cabs2.find((c) => c.id === 'b4')!
    b4.params.depth = inch(25)
    b4.placement = { ...b4.placement!, y: room.depth - inch(25) }
    expect(pieClearance(cabs2, 'pc', place, lib)!.back).toEqual({ id: 'b4', clearance: -inch(1) })
    expect(roomProblems(cabs2, room, place, lib).blocked).toEqual([{ corner: 'pc', by: 'b4', clearance: -inch(1), kind: 'door' }])
  })
})

describe('Kitchen-3 D: cut list, nesting and labels', () => {
  it('the L parts nest once each with their inside-edge banding, cut and labelled; the MPR cuts the L', () => {
    const d = data((x) => {
      x.settings.units = 'in'
    })
    const j: Job = job(placed(pieKitchen()), 'K3')
    const out = runJob(j, d)
    expect(out.issues.filter((i) => i.severity === 'error')).toEqual([])
    const nested = out.nest.sheets.flatMap((s) => s.placements.map((p) => p.uid))
    expect(nested.length).toBe(out.instances.length)
    expect(new Set(nested).size).toBe(out.instances.length)
    const lParts = out.instances.filter((i) => i.part.shape === 'L')
    expect(lParts.map((i) => `${i.cabinetNumber}:${i.part.key}`)).toEqual(['B3:bottom', 'B3:top', 'B3:shelf-1', 'W3:bottom', 'W3:top', 'W3:shelf-1', 'W3:shelf-2'])
    // cut list: L3 and W3 columns, banded on the L parts only
    const csv = cutListCsv(out.cutList).split('\r\n')
    expect(csv[0]).toBe('Material,Part,Cabinets,Qty,Cut L,Cut W,T,Finished L,Finished W,Edge L1,Edge L2,Edge W1,Edge W2,Edge L3,Edge W3,Grain')
    const bottomRow = out.cutList.find((r) => r.name === 'Bottom' && r.cabinets === 'B3')!
    expect(bottomRow.edges).toEqual({ L1: '', L2: '', W1: '', W2: '', L3: 'EB-WHT-1.0', W3: 'EB-WHT-1.0' })
    expect(out.cutList.find((r) => r.name === 'Shelf 1' && r.cabinets === 'B3')!.edges).toMatchObject({ L3: 'EB-WHT-0.4', W3: 'EB-WHT-0.4' })
    expect(out.cutList.filter((r) => r.edges.L3 !== undefined).map((r) => r.name).sort()).toEqual(['Bottom', 'Bottom', 'Shelf 1', 'Shelf 1', 'Shelf 2', 'Top', 'Top'])
    // labels: the inside edges by name, the six-place edge code
    const bl = out.labels.find((l) => l.partName === 'Bottom' && l.cabinet.startsWith('B3'))!
    expect(bl.edges).toMatchObject({ L3: 'EB-WHT-1.0', W3: 'EB-WHT-1.0' })
    expect(bl.edgeDiagram).toBe('0:0:0:0:1:1')
    expect(edgeDiagram(lParts[0].part)).toBe('0:0:0:0:1:1')
    const zpl = labelsZpl(out, '100x70', 'in').split('^XZ').find((t) => t.includes(`^FD${bl.partId}^FS`))!
    expect(zpl).toContain('Edges: L3 EB-WHT-1.0  W3 EB-WHT-1.0')
    // the L drawn edge by edge: six bars in the diagram, two of them thick (1.4 mm = 11 dots)
    const bars = zpl.split('\r\n').filter((l) => /^\^FO(5\d\d|6\d\d|7\d\d),\d+\^GB/.test(l))
    expect(bars).toHaveLength(6)
    expect(bars.filter((l) => /\^GB\d+,\d+,11\^FS/.test(l))).toHaveLength(2)
    // edgeband: the inside edges measured along them
    const usage = edgebandUsage(lParts.filter((i) => i.part.key === 'bottom'), d.library, 0)
    const len = lEdgeLengths(lParts[0].part)
    expect(usage[0].metres).toBeCloseTo(Math.round((len.L3! + len.W3! + lEdgeLengths(lParts[3].part).L3! + lEdgeLengths(lParts[3].part).W3!) / 10) / 100, 9)
    // the cut outline on the sheet: the MPR contour of the base bottom has the L's six corners
    const inst = lParts[0]
    const prog = out.programs.find((p) => p.sheet.placements.some((pl) => pl.uid === inst.uid))!
    const contour = prog.ops.find((o) => o.kind === 'contour' && o.partUid === inst.uid)
    expect(contour && contour.kind === 'contour' ? contour.points.length : 0).toBe(8) // 6 corners, started mid-edge and closed
    const file = mprFiles(j, d, out).find((f) => f.name.startsWith(prog.name))!
    expect(file.text).toContain('KL ')
  })

  it('nests on rectangles too (true-shape nesting off): the L takes its whole cut rectangle, still no errors', () => {
    const d = data((x) => {
      x.settings.features = { ...(x.settings.features ?? {}), camNesting: false }
    })
    const out = runJob(job([preset('tpl-us-pie-base-36', 'pc', 'B1'), preset('tpl-us-pie-wall-24', 'pw', 'W1')]), d)
    expect(out.nest.materials?.length).toBeGreaterThan(0)
    expect(out.nest.materials!.every((m) => m.engine === 'rect')).toBe(true)
    expect(out.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(out.nest.sheets.flatMap((s) => s.placements).length).toBe(out.instances.length)
  })
})

describe('Kitchen-3 E: a blind corner on either wall', () => {
  /** The Kitchen-2 L with its blind corners turned onto the left wall (blind right): the back run butts against their faces. */
  function sideKitchen(): CabinetInstance[] {
    return [
      us('tpl-base-1door', 'b1', 'B1', 18),
      preset('tpl-us-blind-base-36', 'bc', 'B2', (p) => {
        blindOf(p).blindSide = 'right'
        blindOf(p).wall = 'side'
        p.doors.hingeSide = 'left'
      }),
      us('tpl-base-2door', 'b3', 'B3', 30),
      us('tpl-sink-base', 'b4', 'B4', 36),
      us('tpl-wall-2door', 'w1', 'W1', 18),
      preset('tpl-us-blind-wall-24', 'wc', 'W2', (p) => {
        blindOf(p).blindSide = 'right'
        blindOf(p).wall = 'side'
        p.doors.hingeSide = 'left'
      }),
      us('tpl-wall-2door', 'w3', 'W3', 30),
    ]
  }

  it('stands on the left wall, its blind end in the back-left corner; the back run butts against its blind panel; no problems', () => {
    const cabs = placed(sideKitchen())
    const bc = cabs.find((c) => c.id === 'bc')!
    expect(cornerSide(bc.params)).toBe('left')
    expect(cornerWall(bc.params)).toBe('left')
    expect(at(cabs, 'bc')).toMatchObject({ x: 0, y: room.depth - inch(3) - inch(36), rotation: 270, z: 0 })
    expect(at(cabs, 'b3')).toMatchObject({ x: inch(24) + 18, rotation: 0 })
    expect(at(cabs, 'b4').x).toBeCloseTo(inch(24) + 18 + inch(30), 6)
    // the left run before it, butted against its open end
    expect(fpOf(cabs, 'b1').y + fpOf(cabs, 'b1').d).toBeCloseTo(at(cabs, 'bc').y, 6)
    expect(at(cabs, 'wc')).toMatchObject({ x: 0, y: room.depth - inch(3) - inch(24), rotation: 270, z: WALL_ELEVATION })
    expect(at(cabs, 'w3').x).toBeCloseTo(inch(12) + 18, 6)
    expect(roomProblems(cabs, room, place, lib)).toEqual({ overlaps: [], outside: [], blocked: [] })
    // the corner door clears the back run's fronts: 3" pull-out + 24" blind part + 1.5 mm - 24" - 18 mm fronts
    expect(cornerClearance(cabs, 'bc', room, place, lib)).toEqual({ id: 'b3', clearance: expect.closeTo(inch(3) - 16.5, 6) })
    expect(cornerClearance(cabs, 'wc', room, place, lib)!.clearance).toBeCloseTo(inch(3) - 16.5, 6)
    expect(crossClashes(cabs)).toEqual([])
    // its blind panel is what the back run butts against
    const s = roomSolids(cabs)
    const bp = s.find((x) => x.cab === 'bc' && x.key === 'blind-panel')!.b
    expect(s.filter((x) => x.cab === 'b3' && x.role === 'side').some((x) => Math.abs(x.b.lo[0] - bp.hi[0]) < 1e-6)).toBe(true)
    // and the blind panel is at the back end of its face
    expect(bp.hi[1]).toBeCloseTo(room.depth - inch(3), 6)
  })

  it('elevations: facing you on the left wall (blind panel at the corner end); end on at the corner end of the back wall', () => {
    const cabs = placed(sideKitchen())
    const left = elevationOf(cabs, room, 'left', place, lib)
    const c = left.find((i) => i.id === 'bc')!
    expect(c.faces).toBe(true)
    expect(c.divisions.find((d) => d.kind === 'blind')!.u1).toBeCloseTo(1, 9)
    const back = elevationOf(cabs, room, 'back', place, lib)
    const e = back.find((i) => i.id === 'bc')!
    expect(e).toMatchObject({ endView: true, x: 0, w: expect.closeTo(inch(24), 6) })
    expect(back.filter((i) => i.z === 0).map((i) => i.number)).toEqual(['B2', 'B3', 'B4'])
  })

  it('the push: deeper moves the back run, wider (or pulled further out) moves its open end and the left run towards the front', () => {
    const cabs = placed(sideKitchen())
    const bc = cabs.find((c) => c.id === 'bc')!
    const b3 = at(cabs, 'b3').x
    bc.params.depth = inch(25)
    expect(pushNeighbours(cabs, 'bc', { width: inch(36), depth: inch(24), pullOut: inch(3) }, room, lib)).toEqual(['b3', 'b4'])
    expect(at(cabs, 'b3').x).toBeCloseTo(b3 + inch(1), 6)
    const y = at(cabs, 'bc').y
    const b1 = at(cabs, 'b1').y
    blindOf(bc.params).pullOut = inch(4)
    expect(pushNeighbours(cabs, 'bc', { width: inch(36), depth: inch(25), pullOut: inch(3) }, room, lib)).toEqual(['b1'])
    expect(at(cabs, 'bc').y).toBeCloseTo(y - inch(1), 6)
    expect(at(cabs, 'b1').y).toBeCloseTo(b1 - inch(1), 6)
    expect(roomProblems(cabs, room, place, lib).overlaps).toEqual([])
  })

  it('on the right wall too (blind left); Fill gap counts the back run from the left wall to its face', () => {
    const cabs = placed([
      us('tpl-base-2door', 'a', 'B1', 30),
      us('tpl-base-2door', 'b', 'B2', 30),
      preset('tpl-us-blind-base-36', 'c', 'B3', (p) => (blindOf(p).wall = 'side')),
      us('tpl-base-1door', 'd', 'B4', 18),
    ])
    expect(cornerSide(cabs[2].params)).toBe('right')
    expect(at(cabs, 'c')).toMatchObject({ x: room.width - inch(24), y: room.depth - inch(3) - inch(36), rotation: 90 })
    expect(at(cabs, 'b').x + inch(30)).toBeCloseTo(room.width - inch(24) - 18, 6)
    expect(roomProblems(cabs, room, place, lib)).toEqual({ overlaps: [], outside: [], blocked: [] })
    expect(cornerClearance(cabs, 'c', room, place, lib)!.clearance).toBeCloseTo(inch(3) - 16.5, 6)
    expect(crossClashes(cabs)).toEqual([])
    const g = runGaps(cabs, room, place, lib).find((x) => x.wall === 'back')
    // the back run (held at the corner's face) is 60" long in a 144" room less 24" + 18 mm: far more than 12": no Fill gap
    expect(g).toBeUndefined()
    cabs[0].params.width = inch(30) + (room.width - inch(24) - 18 - inch(60)) - inch(6)
    const laid = placed(cabs)
    const gg = runGaps(laid, room, place, lib).find((x) => x.wall === 'back')!
    expect(gg.endBound).toBeCloseTo(room.width - inch(24) - 18, 6)
    expect(gg.total).toBeCloseTo(inch(6), 6)
  })

  it('blind panel boring: none (no standard pattern; fixed from inside on site, as before)', () => {
    const g = generateCarcass(KITCHEN_PRESETS.find((t) => t.id === 'tpl-us-blind-base-36')!.params, lib)
    expect(part(g.parts, 'blind-panel').ops).toEqual([])
  })
})
