import { describe, expect, it } from 'vitest'
import { kitchenUnconfirmed, lCornerUnconfirmed } from '../src/core/confirm'
import { buildCabinet, generateCarcass } from '../src/core/construction/carcass'
import { pieFootprint } from '../src/core/construction/pieCut'
import { expandJob } from '../src/core/cutlist'
import { defaultAppData, defaultLibrary, KITCHEN_DEFAULTS, KITCHEN_PRESETS } from '../src/core/defaults'
import { polygonArea, toWorld } from '../src/core/geometry'
import { lCorner, roundInnerCorner } from '../src/core/lpart'
import { cutoutTool, nestPartOf, nestSettingsOf, placementTransform } from '../src/core/machining'
import { runJob } from '../src/core/pipeline'
import { sampleJob } from '../src/core/sample'
import type { CabinetInstance, CarcassParams, Job, MachineProfile, Part, PieCutParams, Vec2 } from '../src/core/types'
import { clone, data, job } from './helpers'

const lib = defaultLibrary()
const inch = (n: number) => Math.round(n * 25.4 * 1000) / 1000
const part = (parts: Part[], key: string) => parts.find((p) => p.key === key)!
const pieOf = (p: Pick<CarcassParams, 'corner'>) => p.corner as PieCutParams
const pieBase = () => clone(KITCHEN_PRESETS.find((t) => t.id === 'tpl-us-pie-base-36')!.params)
const pieWall = () => clone(KITCHEN_PRESETS.find((t) => t.id === 'tpl-us-pie-wall-24')!.params)
const cab = (params: CarcassParams, id = 'pc', number = 'B1'): CabinetInstance => ({ id, number, name: 'Pie-cut', templateId: null, qty: 1, params, overrides: {} })

/** A part's extent in cabinet coordinates (its whole box). */
function extent(p: Part) {
  const c = [0, p.length].flatMap((x) => [0, p.width].flatMap((y) => [0, p.thickness].map((d) => toWorld(p.frame, x, y, d))))
  return { lo: [0, 1, 2].map((i) => Math.min(...c.map((v) => v[i]))), hi: [0, 1, 2].map((i) => Math.max(...c.map((v) => v[i]))) }
}
/** World boxes a part fills (an L part as its two rectangles). */
function solids(p: Part) {
  const c = p.shape === 'L' ? lCorner(p) : null
  const rects: [number, number, number, number][] = []
  if (!c) rects.push([0, p.length, 0, p.width])
  else {
    rects.push(c.nW3 > 0 ? [0, c.inner.x, 0, p.width] : [c.inner.x, p.length, 0, p.width])
    rects.push([...(c.nW3 > 0 ? [c.inner.x, p.length] : [0, c.inner.x]), ...(c.nL3 > 0 ? [0, c.inner.y] : [c.inner.y, p.width])] as [number, number, number, number])
  }
  return rects.map(([x0, x1, y0, y1]) => {
    const pts = [x0, x1].flatMap((x) => [y0, y1].flatMap((y) => [0, p.thickness].map((d) => toWorld(p.frame, x, y, d))))
    return { lo: [0, 1, 2].map((i) => Math.min(...pts.map((v) => v[i]))), hi: [0, 1, 2].map((i) => Math.max(...pts.map((v) => v[i]))) }
  })
}
const clash = (a: { lo: number[]; hi: number[] }, b: { lo: number[]; hi: number[] }) => [0, 1, 2].every((k) => Math.min(a.hi[k], b.hi[k]) - Math.max(a.lo[k], b.lo[k]) > 0.01)

describe('Kitchen-3c: corner cleats under the L shelves', () => {
  it('one cleat under the base shelf\'s back corner: carcass board on edge against the back-wall back, from the side-wall back, its top at the shelf\'s underside', () => {
    const p = pieBase()
    const g = generateCarcass(p, lib)
    expect(g.warnings).toEqual([])
    const cl = part(g.parts, 'cleat-1')
    expect(cl).toMatchObject({ name: 'Shelf 1 corner cleat', role: 'cleat', materialId: p.carcassMaterialId, length: KITCHEN_DEFAULTS.cleatLength, width: KITCHEN_DEFAULTS.cleatHeight, thickness: 18, onSite: "Fix on site under shelf 1's back corner" })
    expect(cl.edges).toEqual({})
    expect(cl.ops).toEqual([])
    const e = extent(cl)
    const shelf = extent(part(g.parts, 'shelf-1'))
    const back = extent(part(g.parts, 'back'))
    const backSide = extent(part(g.parts, 'back-side'))
    // top at the shelf's underside; in front of the back-wall back; from the side-wall back's face
    expect(e.hi[2]).toBeCloseTo(shelf.lo[2], 6)
    expect(e.hi[2] - e.lo[2]).toBeCloseTo(KITCHEN_DEFAULTS.cleatHeight, 6)
    expect(e.hi[1]).toBeLessThanOrEqual(back.lo[1] + 1e-6)
    expect(back.lo[1] - e.hi[1]).toBeLessThan(0.5)
    expect(e.lo[0]).toBeGreaterThanOrEqual(backSide.hi[0] - 1e-6)
    expect(e.lo[0] - backSide.hi[0]).toBeLessThan(0.5)
    expect(e.hi[0] - e.lo[0]).toBeCloseTo(KITCHEN_DEFAULTS.cleatLength, 6)
    // under the shelf's back corner (the shelf rests on it), and in no other part
    expect(Math.min(e.hi[0], shelf.hi[0]) - Math.max(e.lo[0], shelf.lo[0])).toBeGreaterThan(100)
    expect(Math.min(e.hi[1], shelf.hi[1]) - Math.max(e.lo[1], shelf.lo[1])).toBeGreaterThan(10)
    for (const o of g.parts) if (o.key !== 'cleat-1') for (const s of solids(o)) expect(clash(e, s), o.key).toBe(false)
    // inside the L, at its back corner
    const f = pieFootprint(p, pieOf(p))
    expect(e.lo[0]).toBeGreaterThan(f.sideLeg.x0)
    expect(e.hi[1]).toBeLessThan(f.backLeg.y1)
  })

  it('two on the wall cabinet (one per shelf); mirrored for back-right; none with the switch off; badly sized ones warned', () => {
    const w = generateCarcass(pieWall(), lib)
    expect(w.parts.filter((x) => x.role === 'cleat').map((x) => x.key)).toEqual(['cleat-1', 'cleat-2'])
    for (const k of ['1', '2']) expect(extent(part(w.parts, `cleat-${k}`)).hi[2]).toBeCloseTo(extent(part(w.parts, `shelf-${k}`)).lo[2], 6)
    const l = extent(part(generateCarcass(pieBase(), lib).parts, 'cleat-1'))
    const q = pieBase()
    pieOf(q).side = 'right'
    const r = extent(part(generateCarcass(q, lib).parts, 'cleat-1'))
    expect([r.lo[0], r.hi[0]]).toEqual([expect.closeTo(q.width - l.hi[0], 6), expect.closeTo(q.width - l.lo[0], 6)])
    const off = pieBase()
    pieOf(off).cleats = false
    expect(generateCarcass(off, lib).parts.some((x) => x.role === 'cleat')).toBe(false)
    // a pie-cut saved before Kitchen-3c (no cleat settings) gets them, at the placeholder sizes
    const old = pieBase()
    delete pieOf(old).cleats
    delete pieOf(old).cleatLength
    delete pieOf(old).cleatHeight
    expect(part(generateCarcass(old, lib).parts, 'cleat-1').length).toBe(KITCHEN_DEFAULTS.cleatLength)
    const tall = pieWall()
    pieOf(tall).cleatHeight = 400
    expect(generateCarcass(tall, lib, undefined, 'in').warnings).toEqual([
      'The corner cleat under shelf 1 (15-3/4" high) does not fit above the bottom; it is left out.',
      'The corner cleat under shelf 2 (15-3/4" high) does not fit above the shelf below; it is left out.',
    ])
    const long = pieWall()
    pieOf(long).cleatLength = 700
    const lg = generateCarcass(long, lib, undefined, 'in')
    expect(lg.warnings[0]).toMatch(/^The corner cleat \(27-9\/16"\) is longer than shelf 1's back edge; it is cut to /)
    expect(extent(part(lg.parts, 'cleat-1')).hi[0]).toBeCloseTo(extent(part(lg.parts, 'shelf-1')).hi[0], 6)
  })

  it('placeholder sizes carry Configure badges until changed or confirmed; not while off or without shelves', () => {
    const m = defaultAppData().machine
    const keys = (p: CarcassParams, mm: Pick<MachineProfile, 'confirmed'> = m) => kitchenUnconfirmed(p, mm).map((u) => u.key)
    expect(keys(pieBase())).toEqual(['kitchen:cleatLength', 'kitchen:cleatHeight'])
    const own = pieBase()
    pieOf(own).cleatLength = inch(8)
    expect(keys(own)).toEqual(['kitchen:cleatHeight'])
    expect(keys(pieBase(), { confirmed: ['kitchen:cleatLength', 'kitchen:cleatHeight'] })).toEqual([])
    const off = pieBase()
    pieOf(off).cleats = false
    expect(keys(off)).toEqual([])
    const bare = pieBase()
    bare.shelves.count = 0
    expect(keys(bare)).toEqual([])
    // never part of the export check
    const out = runJob(job([cab(pieBase())]), defaultAppData())
    expect(out.issues.some((i) => /cleat/i.test(i.message))).toBe(false)
  })

  it('in the cut list, nested, and labelled "fix on site"; drawn in 3D with the cabinet', () => {
    const out = runJob(job([cab(pieBase()), cab(pieWall(), 'pw', 'W1')]), data((x) => (x.settings.units = 'in')))
    expect(out.issues.filter((i) => i.severity === 'error')).toEqual([])
    const rows = out.cutList.filter((r) => /corner cleat/.test(r.name))
    expect(rows.map((r) => `${r.name}|${r.cabinets}|${r.qty}`).sort()).toEqual(['Shelf 1 corner cleat|B1, W1|2', 'Shelf 2 corner cleat|W1|1'])
    expect(rows[0]).toMatchObject({ finishedLength: KITCHEN_DEFAULTS.cleatLength, finishedWidth: KITCHEN_DEFAULTS.cleatHeight, thickness: 18 })
    const nested = out.nest.sheets.flatMap((s) => s.placements.map((p) => p.uid))
    for (const i of out.instances.filter((x) => x.part.role === 'cleat')) expect(nested).toContain(i.uid)
    const labels = out.labels.filter((l) => /corner cleat/.test(l.partName))
    expect(labels).toHaveLength(3)
    for (const l of labels) expect(l.notes).toContain(`Fix on site under shelf ${l.partName[6]}'s back corner`)
    // the room's 3D view draws every built part, the cleat among them
    expect(buildCabinet(cab(pieBase()), lib).parts.some((x) => x.role === 'cleat')).toBe(true)
  })
})

describe('Kitchen-3c: the inside corner radius of L parts', () => {
  const machine = defaultAppData().machine
  const rc = cutoutTool(machine)!.diameter / 2
  const pieJob = (patch: (j: Job) => void = () => {}) => {
    const j = job([cab(pieBase()), cab(pieWall(), 'pw', 'W1')], 'K3C')
    patch(j)
    return j
  }
  /** The arc of a rounded outline: its points off the six sharp corners. */
  const arcOf = (outline: Vec2[], sharp: Vec2[]) => outline.filter((v) => !sharp.some((s) => Math.abs(s.x - v.x) < 1e-6 && Math.abs(s.y - v.y) < 1e-6))

  it('rounds the inside corner of the cut outline: a quarter circle of the radius, between L3 and W3, keeping the corner\'s material', () => {
    const p = { length: 900, width: 600, outline: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 250 }, { x: 900, y: 250 }, { x: 900, y: 600 }, { x: 0, y: 600 }] }
    const r = 20
    const o = roundInnerCorner(p, r)
    const arc = arcOf(o, p.outline)
    expect(arc.length).toBeGreaterThanOrEqual(3)
    // centre in the cut-away corner, every point at the radius
    for (const v of arc) expect(Math.hypot(v.x - 520, v.y - 230)).toBeCloseTo(r, 2)
    expect(arc[0]).toEqual({ x: 500, y: 230 })
    expect(arc[arc.length - 1]).toEqual({ x: 520, y: 250 })
    // the part gains the corner's fillet, r² (1 - π/4), plus the slivers between the arc and its
    // chords (each chord no more than 0.01 mm inside the circle: under 0.01 x the arc's length)
    const gained = Math.abs(polygonArea(o)) - Math.abs(polygonArea(p.outline))
    expect(gained).toBeGreaterThan(r * r * (1 - Math.PI / 4) - 0.01)
    expect(gained).toBeLessThan(r * r * (1 - Math.PI / 4) + 0.01 * (Math.PI / 2) * r + 0.01)
    // the other way round the outline, and r <= 0 or not an L: unchanged
    const rev = { ...p, outline: [...p.outline].reverse() }
    expect(arcOf(roundInnerCorner(rev, r), rev.outline)).toEqual([...arc].reverse())
    expect(roundInnerCorner(p, 0)).toEqual(p.outline)
    expect(roundInnerCorner({ length: 10, width: 10, outline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }, 3)).toHaveLength(4)
  })

  it('defaults to the cut-out tool\'s radius: the outline (nesting, labels, sheet map) is rounded, the MPR cuts the corner sharp as before and the tool leaves that radius', () => {
    const out = runJob(pieJob(), defaultAppData())
    expect(out.issues.filter((i) => i.severity === 'error')).toEqual([])
    const lParts = out.instances.filter((i) => i.lCut)
    expect(lParts).toHaveLength(7)
    for (const i of lParts) {
      expect(i.lCut!.radius).toBe(rc)
      expect(i.outline.length).toBeGreaterThan(6)
      expect(i.lCut!.sharp).toHaveLength(6)
    }
    // the MPR contour is the sharp L (six corners, started mid-edge and closed), as in Kitchen-3b
    const inst = lParts[0]
    const prog = out.programs.find((p) => p.sheet.placements.some((pl) => pl.uid === inst.uid))!
    const c = prog.ops.find((o) => o.kind === 'contour' && o.partUid === inst.uid)!
    expect(c.kind === 'contour' && c.points.length).toBe(8)
    const sharp = runJob(pieJob((j) => (j.lCornerRadius = 0)), defaultAppData())
    const i0 = sharp.instances.find((x) => x.uid === inst.uid)!
    expect(i0.lCut!.radius).toBe(0)
    expect(i0.outline).toEqual(inst.lCut!.sharp)
    // the label notes the radius
    expect(out.labels.find((l) => l.uid === inst.uid)!.notes).toContain(`Inside corner R${rc} mm`)
    // nesting: the L takes its whole cut rectangle (no part in its cut-away corner)
    const ns = nestSettingsOf(defaultAppData().settings)
    expect(nestPartOf(inst, ns).outline).toBeUndefined()
    for (const s of out.nest.sheets)
      for (const a of s.placements)
        for (const b of s.placements) {
          if (a.uid === b.uid || !out.instances.find((x) => x.uid === a.uid)!.lCut) continue
          const ox = Math.min(a.x + a.dx, b.x + b.dx) - Math.max(a.x, b.x)
          const oy = Math.min(a.y + a.dy, b.y + b.dy) - Math.max(a.y, b.y)
          expect(ox > 0.01 && oy > 0.01, `${a.uid} / ${b.uid}`).toBe(false)
        }
  })

  it('a bigger radius for the job: the MPR cuts the rounded corner (straight segments on the arc); a part can have its own', () => {
    const j = pieJob((x) => (x.lCornerRadius = 25))
    j.cabinets[0].overrides.bottom = { cornerRadius: 40 }
    const out = runJob(j, defaultAppData())
    expect(out.issues.filter((i) => i.severity === 'error')).toEqual([])
    const bottom = out.instances.find((i) => i.uid === 'pc#1:bottom')!
    const top = out.instances.find((i) => i.uid === 'pc#1:top')!
    expect(bottom.lCut!.radius).toBe(40)
    expect(top.lCut!.radius).toBe(25)
    for (const [inst, r] of [
      [bottom, 40],
      [top, 25],
    ] as const) {
      const prog = out.programs.find((p) => p.sheet.placements.some((pl) => pl.uid === inst.uid))!
      const pl = prog.sheet.placements.find((x) => x.uid === inst.uid)!
      const c = prog.ops.find((o) => o.kind === 'contour' && o.partUid === inst.uid)!
      if (c.kind !== 'contour') throw new Error('contour')
      expect(c.segs).toBeUndefined() // straight segments only (no arcs to write)
      // the contour's arc points, on the sheet, all at the radius from one centre
      const { pt } = placementTransform(inst, pl)
      const corner = lCorner({ length: inst.cutLength, width: inst.cutWidth, outline: inst.lCut!.sharp })!
      const centre = pt(corner.inner.x + r * corner.nW3, corner.inner.y + r * corner.nL3)
      const inner = pt(corner.inner.x, corner.inner.y)
      expect(c.points.some((v) => Math.hypot(v.x - inner.x, v.y - inner.y) < 0.5)).toBe(false)
      const arc = c.points.filter((v) => Math.hypot(v.x - centre.x, v.y - centre.y) < r * 1.2)
      expect(arc.length).toBeGreaterThan(4)
      for (const v of arc) expect(Math.hypot(v.x - centre.x, v.y - centre.y)).toBeCloseTo(r, 2)
      expect(out.labels.find((l) => l.uid === inst.uid)!.notes).toContain(`Inside corner R${r} mm`)
    }
  })

  it('a radius under the cut-out tool\'s: cut sharp (the tool leaves its own radius) and the export check says so', () => {
    const j = pieJob((x) => (x.lCornerRadius = 3))
    const out = runJob(j, defaultAppData())
    const inst = out.instances.find((i) => i.uid === 'pc#1:bottom')!
    const prog = out.programs.find((p) => p.sheet.placements.some((pl) => pl.uid === inst.uid))!
    const c = prog.ops.find((o) => o.kind === 'contour' && o.partUid === inst.uid)!
    expect(c.kind === 'contour' && c.points.length).toBe(8)
    const w = out.issues.filter((i) => i.code === 'L_CORNER_RADIUS')
    expect(w).toHaveLength(7)
    expect(w[0]).toMatchObject({ severity: 'warning' })
    expect(w[0].message).toMatch(/inside corner radius 3 mm is under the cut-out tool's 6 mm; the corner is cut at the tool's radius\.$/)
    expect(out.issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it('carries a Configure badge while it is the default and unconfirmed, on a job with L parts only', () => {
    expect(lCornerUnconfirmed(pieJob(), machine, rc).map((u) => [u.key, u.value])).toEqual([['kitchen:lCornerRadius', "6 mm (the cut-out tool's radius)"]])
    expect(lCornerUnconfirmed(pieJob((j) => (j.lCornerRadius = 6)), machine, rc)).toEqual([])
    expect(lCornerUnconfirmed(pieJob(), { confirmed: ['kitchen:lCornerRadius'] }, rc)).toEqual([])
    expect(lCornerUnconfirmed(sampleJob(), machine, rc)).toEqual([])
  })

  it('a job without L parts is unchanged: no rounded corners, the same outlines as before', () => {
    const d = defaultAppData()
    const out = runJob(sampleJob(), d)
    expect(out.instances.some((i) => i.lCut)).toBe(false)
    const plain = expandJob(sampleJob(), d.library, d.settings)
    expect(out.instances.map((i) => i.outline)).toEqual(plain.instances.map((i) => i.outline))
    expect(out.issues.some((i) => i.code === 'L_CORNER_RADIUS')).toBe(false)
  })
})
