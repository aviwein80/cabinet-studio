/**
 * M3.6a clamps, pods and rails (FIX-01) and the convex geometry under them. The distance engine
 * against exact formulas; fixtures from typed sizes, drawn outlines and an imported model; fixtures
 * in the collision checks (vertical and tilted tools), each case with a near-miss twin that must
 * come out clean; automatic placement clear of every toolpath; the export checker blocks a hit.
 */
import { describe, expect, it } from 'vitest'
import { checkCollisions, collisionSetup, partCollisions } from '@/cam/collision/collision'
import { box, distance, frustum, penetration, prism, rotM3, sphere, swept } from '@/cam/collision/convex'
import { fixtureHits, fixturesBox, toolBody } from '@/cam/collision/fixtureCheck'
import { makeEntity, newPart, parsePart, serializePart } from '@/cam/doc'
import { autoPlace } from '@/cam/fixtures/place'
import { fixtureFootprint, fixturePieces, loopTriangles, modelShape, outlineShape, PLACEHOLDER_FIXTURE_TYPES } from '@/cam/fixtures/fixture'
import { circle, rect } from '@/cam/geom'
import { buildMesh } from '@/cam/mesh/build'
import { parseStl } from '@/cam/mesh/read'
import { defaultOp } from '@/cam/ops'
import { positionalCollisions } from '@/cam/positional/sim'
import { buildTimeline, positionAt, programOrder } from '@/cam/sim'
import { HeightfieldStock } from '@/cam/stock/heightfield'
import { generatePart, type Toolpath } from '@/cam/toolpath'
import type { CamOp, CamPart, Fixture } from '@/cam/types'
import { fixtureUnconfirmed, machineUnconfirmed } from '@/core/confirm'
import { defaultAppData, PLACEHOLDER_MACHINE } from '@/core/defaults'
import { runJob } from '@/core/pipeline'
import type { Job } from '@/core/types'
import { box as boxSoup, rng, stlBinary } from './mesh-fixtures'
import { blockPart } from './positional-fixtures'

const say = (s: string) => process.stdout.write(`  [fixtures] ${s}\n`)
const lv = (depth: number, passDepth = 0, through = false) => ({ safeZ: 20, rapidZ: 3, depth, through, stockZ: 0, passDepth })

const clamp = (x: number, y: number, length: number, width: number, height: number, z: number, extra: Partial<Fixture> = {}): Fixture => ({ id: `c${x}`, name: 'Clamp A', kind: 'clamp', shape: { k: 'block', length, width, height }, at: { x, y, z }, rot: 0, ...extra })

/** A 300 x 200 x 19 panel with one 60 x 60 pocket, 10 deep in one pass, cut with T102 (Ø8, gauge 50, the placeholder holder). */
function pocketPart(fixtures: Fixture[]): CamPart {
  const p = newPart({ name: 'Clamped pocket', length: 300, width: 200, thickness: 19, materialId: 'mat-mdf18', entities: [] })
  const e = makeEntity({ t: 'contour', c: rect(100, 60, 60, 60) }, 'machining')
  p.entities = [e]
  p.ops = [{ ...defaultOp('pocket', [e.id]), toolId: 't102', levels: lv(10) } as CamOp]
  p.fixtures = fixtures
  return p
}

function check(part: CamPart) {
  const paths = programOrder(generatePart(part, PLACEHOLDER_MACHINE))
  const tl = buildTimeline(paths)
  const stock = new HeightfieldStock(part.length, part.width, part.thickness, 0.5)
  return { tl, paths, found: checkCollisions(tl, stock, collisionSetup(tl, paths, PLACEHOLDER_MACHINE, part.thickness, part)) }
}

describe('M3.6 convex geometry: distances (GJK) against exact formulas', () => {
  const B = box([0, 0, 0], [10, 10, 10])
  it('spheres, cylinders, prisms and swept solids against a box', () => {
    const r = rng(36)
    let worst = 0
    for (let i = 0; i < 4000; i++) {
      const c: [number, number, number] = [r() * 40 - 15, r() * 40 - 15, r() * 40 - 15]
      const rad = r() * 5
      const dx = Math.max(0, -c[0], c[0] - 10)
      const dy = Math.max(0, -c[1], c[1] - 10)
      const dz = Math.max(0, -c[2], c[2] - 10)
      worst = Math.max(worst, Math.abs(distance(sphere(c, rad), B) - Math.max(0, Math.hypot(dx, dy, dz) - rad)))
    }
    say(`sphere to box over 4000 random cases: worst error ${worst.toExponential(1)} mm`)
    expect(worst).toBeLessThan(1e-6)
    // an upright cylinder over the box, a tilted one beside it, a turned square
    expect(distance(frustum([5, 5, 15], [0, 0, 1], 0, 10, 3, 3), B)).toBeCloseTo(5, 9)
    expect(distance(frustum([15, 5, 5], [Math.SQRT1_2, 0, Math.SQRT1_2], 0, 10, 2, 2), B)).toBeCloseTo(5 - Math.SQRT2, 9)
    expect(distance(prism([-1, -1, 1, -1, 1, 1, -1, 1], 0, 10, [12, 5, 0], rotM3([0, 0, 1], 45)), B)).toBeCloseTo(2 - Math.SQRT2, 9)
    // a sphere swept past the box: its nearest pass
    expect(distance(swept(sphere([20, 20, 5], 1), [0, -30, 0]), B)).toBeCloseTo(9, 9)
    // overlapping: no distance, and how deep (the shortest way out)
    expect(distance(sphere([9, 5, 5], 2), B)).toBe(0)
    expect(penetration(sphere([9, 5, 5], 2), B)).toBeCloseTo(3, 3)
    expect(penetration(box([8, 2, 2], [12, 8, 8]), B)).toBeCloseTo(2, 3)
  })
})

describe('M3.6 fixtures from sizes, drawn outlines and models', () => {
  it('a turned block, a round pod and an L-shaped outline become the right pieces', () => {
    const [b] = fixturePieces([clamp(50, 50, 40, 20, 30, -19, { rot: 90 })])
    // turned 90°: 20 along x, 40 along y, base at -19
    expect(b.box.lo.map((v) => +v.toFixed(9))).toEqual([40, 30, -19])
    expect(b.box.hi.map((v) => +v.toFixed(9))).toEqual([60, 70, 11])
    const [round] = fixturePieces([{ id: 'p', name: 'Pod', kind: 'pod', shape: { k: 'round', diameter: 50, height: 100 }, at: { x: 0, y: 0, z: -119 }, rot: 0 }])
    expect(distance(sphere([40, 0, -50], 1), round.c)).toBeCloseTo(40 - 25 - 1, 9)
    // an L drawn on the part: the notch stays free
    const L = [0, 0, 60, 0, 60, 20, 20, 20, 20, 60, 0, 60]
    const tris = loopTriangles([L])
    const area = tris.reduce((a, t) => a + Math.abs((t[2] - t[0]) * (t[5] - t[1]) - (t[4] - t[0]) * (t[3] - t[1])) / 2, 0)
    expect(area).toBeCloseTo(60 * 20 + 20 * 40, 6)
    const { shape, at } = outlineShape([L], 25)
    const f: Fixture = { id: 'o', name: 'Jig', kind: 'clamp', shape, at: { ...at, z: -19 }, rot: 0 }
    const pieces = fixturePieces([f])
    const near = (p: [number, number, number]) => Math.min(...pieces.map((q) => distance(sphere(p, 0), q.c)))
    expect(near([40, 40, 0])).toBeCloseTo(20, 6)
    expect(near([10, 10, 0])).toBe(0)
    expect(fixtureFootprint(f)[0]).toHaveLength(6)
    // a hole in an outline is free too
    const ring = loopTriangles([[0, 0, 100, 0, 100, 100, 0, 100], [40, 40, 60, 40, 60, 60, 40, 60]])
    const inHole = ring.some((t) => {
      const s = (ax: number, ay: number, bx: number, by: number) => (bx - ax) * (50 - ay) - (by - ay) * (50 - ax)
      const d1 = s(t[0], t[1], t[2], t[3])
      const d2 = s(t[2], t[3], t[4], t[5])
      const d3 = s(t[4], t[5], t[0], t[1])
      return (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)
    })
    expect(inHole).toBe(false)
  })

  it('an imported L-shaped clamp keeps its overhang: slices hold the whole model and leave the space under the arm', () => {
    // a 40 x 40 x 20 base with a 40 x 80 x 10 arm on top reaching out over +x
    const soup = [...boxSoup(0, 0, 0, 40, 40, 20), ...boxSoup(0, 0, 20, 120, 40, 30)]
    const mesh = buildMesh(parseStl(stlBinary(soup)), { gapTol: 0 }).mesh
    const shape = modelShape(mesh, 'clamp.stl', 6)
    expect(shape.k).toBe('model')
    if (shape.k !== 'model') return
    expect(shape.size).toEqual([120, 40, 30])
    const f: Fixture = { id: 'm', name: 'Clamp model', kind: 'clamp', shape, at: { x: 0, y: 0, z: 0 }, rot: 0 }
    const pieces = fixturePieces([f])
    const near = (p: [number, number, number]) => Math.min(...pieces.map((q) => distance(sphere(p, 0), q.c)))
    // every corner of the model is inside a slice (the slices never under-state it)
    for (let i = 0; i < mesh.positions.length; i += 3) expect(near([mesh.positions[i] - 60, mesh.positions[i + 1] - 20, mesh.positions[i + 2]])).toBeLessThan(1e-6)
    // under the arm, low down, is free: 30 mm out from the base, 5 mm up, the arm 15 mm above
    // (a slice holds all the model has between its heights, its ends included: the 5 mm slice under
    // the arm reaches its underside, so the space under the arm counts as free up to 15 mm)
    expect(near([70 - 60, 0, 5])).toBeCloseTo(10, 6)
    expect(near([70 - 60, 0, 14])).toBeCloseTo(1, 6)
    // in the arm is not
    expect(near([100 - 60, 0, 25])).toBe(0)
  })
})

describe('M3.6 fixtures in the collision check (vertical tool)', () => {
  // the pocket's tool centre comes to x 156 (the wall at 160 less the radius 4); the holder face
  // (radius 17.5) is 50 above the tip; the margin is 2
  it('the holder into a tall clamp is caught where it starts; 0.05 mm further away it is clear', () => {
    // a clamp beside the pocket, 120 long across it, standing on the table, its top 45 above face 1
    // (the holder face is at 40 when the tip is on the pocket floor; the holder widens from 17.5 to
    // 21 over its first 30 mm, so it is 17.5 + 3.5 x 5/30 at the clamp's top)
    const R = 17.5 + (3.5 * 5) / 30
    const hit = check(pocketPart([clamp(166 + 20, 90, 40, 120, 64, -19)]))
    const fx = hit.found.filter((c) => c.kind === 'fixture')
    expect(fx.length).toBeGreaterThan(0)
    expect(fx[0].message).toMatch(/holder hits fixture "Clamp A"/)
    // the cutter and shank (radius 4) stay 6 mm off it: only the holder hits
    expect(fx.every((c) => /holder hits/.test(c.message))).toBe(true)
    // beyond the margin, and no deeper than the holder reaches past the clamp's face
    const worst = Math.max(...fx.map((c) => c.depth))
    expect(worst).toBeGreaterThan(2)
    // (the depth past the margin is the shortest way out, found over spread directions: an upper bound within 0.01 mm)
    expect(worst).toBeLessThanOrEqual(2 + R - 10 + 0.01)
    // the place given is where the tool starts to come too near, and it leads to its move
    for (const c of fx) {
      const p = positionAt(hit.tl, c.t)
      expect(Math.hypot(p.p.x - c.at.x, p.p.y - c.at.y, p.p.z - c.at.z)).toBeLessThan(1e-6)
      // (there the holder is within the margin of the clamp's top edge: its axis no further than R
      // plus the margin measured square to the holder's widening side, 2 / cos(atan(3.5 / 30)))
      expect(166 - c.at.x).toBeLessThanOrEqual(R + 2 / Math.cos(Math.atan(3.5 / 30)) + 1e-6)
    }
    say(`holder into a clamp: ${fx[0].message}`)
    // just outside the margin: clear (no false alarm); just inside: caught
    const edge = 156 + R + 2
    expect(check(pocketPart([clamp(edge + 0.05 + 20, 90, 40, 120, 64, -19)])).found.filter((c) => c.kind === 'fixture')).toEqual([])
    expect(check(pocketPart([clamp(edge - 0.05 + 20, 90, 40, 120, 64, -19)])).found.filter((c) => c.kind === 'fixture').length).toBeGreaterThan(0)
    // a clamp too low for the holder (its top 2.05 below the holder face at its lowest): clear; 1.95: caught
    expect(check(pocketPart([clamp(166 + 20, 90, 40, 120, 40 - 2.05 + 19, -19)])).found.filter((c) => c.kind === 'fixture')).toEqual([])
    expect(check(pocketPart([clamp(166 + 20, 90, 40, 120, 40 - 1.95 + 19, -19)])).found.filter((c) => c.kind === 'fixture').length).toBeGreaterThan(0)
  })

  it('a through cut over a pod is caught (cutter hits the pod); the pod moved clear is not; switched off it is not checked', () => {
    const p = newPart({ name: 'Hole over a pod', length: 300, width: 200, thickness: 19, materialId: 'mat-mdf18', entities: [] })
    const e = makeEntity({ t: 'contour', c: circle({ x: 80, y: 100 }, 20) }, 'machining')
    p.entities = [e]
    p.ops = [{ ...defaultOp('profile', [e.id]), side: 'inside', toolId: 't102', levels: { ...lv(19, 0, true) } } as CamOp]
    const pod = (x: number, off = false): Fixture => ({ id: 'pod', name: 'Pod 1', kind: 'pod', shape: { k: 'block', length: 60, width: 60, height: 100 }, at: { x, y: 100, z: -119 }, rot: 0, ...(off ? { off } : {}) })
    const under = check({ ...p, fixtures: [pod(80)] }).found.filter((c) => c.kind === 'fixture')
    expect(under.length).toBeGreaterThan(0)
    expect(under[0].message).toMatch(/cutter hits fixture "Pod 1"/)
    say(`through cut over a pod: ${under[0].message}`)
    // the cutter (Ø8 on a Ø40 hole) sweeps x 56..104: a 60 mm pod at x 200 is 66 mm away
    expect(check({ ...p, fixtures: [pod(200)] }).found.filter((c) => c.kind === 'fixture')).toEqual([])
    expect(check({ ...p, fixtures: [pod(80, true)] }).found.filter((c) => c.kind === 'fixture')).toEqual([])
    // parts without fixtures: exactly as before
    expect(check(p).found).toEqual(check({ ...p, fixtures: [] }).found)
  })

  it('first place along a long move is exact (halving), and a rapid over a clamp is caught', () => {
    // a straight move from x 0 to 300 at z 5 with T102, a clamp 40 wide at x 200 reaching to z 30
    const tp: Toolpath = { opId: 'm', kind: 'profile', name: 'Line', tool: PLACEHOLDER_MACHINE.tools.find((t) => t.id === 't102')!, feeds: { rpm: 18000, feed: 6000, plunge: 2000 }, moves: [{ t: 'rapid', x: 0, y: 100, z: 5 }, { t: 'rapid', x: 300, y: 100, z: 5 }], intents: [], warnings: [], stats: { cut: 0, rapid: 300, minutes: 0 } }
    const body = toolBody({ r: 4, shape: 'flat', angle: 90 }, null, 100)
    const pieces = fixturePieces([clamp(220, 100, 40, 40, 49, -19)])
    const [h] = fixtureHits(pieces, fixturesBox(pieces), body, [0, 100, 5], [300, 100, 5], [0, 0, 1], 2)
    // the cutter's side comes within 2 mm of the clamp's face at x 200 when its centre is at 194
    // (where it first comes within the margin less the 0.01 mm reporting tolerance)
    expect(h.k * 300).toBeCloseTo(194.01, 3)
    // the cutter's sweep goes through the clamp: the margin plus the shortest way out (sideways: the
    // clamp's half-width 20 plus the cutter's radius 4)
    expect(h.depth).toBeCloseTo(2 + 24, 3)
    const part = { ...newPart({ length: 300, width: 200, thickness: 19 }), fixtures: [clamp(220, 100, 40, 40, 49, -19)] }
    const tl = buildTimeline([tp])
    const found = checkCollisions(tl, new HeightfieldStock(300, 200, 19, 1), collisionSetup(tl, [tp], PLACEHOLDER_MACHINE, 19, part))
    expect(found.filter((c) => c.kind === 'fixture')[0].at.x).toBeCloseTo(194.01, 3)
  })
})

describe('M3.6 fixtures with a tilted tool (3+2)', () => {
  it('the holder of a tool tilted 45° over a clamp beside the block is caught; with the clamp moved off it is not', () => {
    const { part } = blockPart({ ops: 'holes' })
    // a tall clamp right of the block (x 125..165), up to 60 above its top: under the tilted holder
    const tall = clamp(145, 50, 40, 100, 120, -60)
    const hit = positionalCollisions({ ...part, fixtures: [tall] }, generatePart(part, PLACEHOLDER_MACHINE), PLACEHOLDER_MACHINE, { cell: 1 })
    const fx = hit.found.filter((c) => c.kind === 'fixture')
    expect(fx.length).toBeGreaterThan(0)
    say(`tilted holder over a clamp: ${fx[0].message}`)
    expect(fx.some((c) => /Holes Ø8 \(45°/.test(c.message) || /holder hits fixture/.test(c.message))).toBe(true)
    const clear = positionalCollisions({ ...part, fixtures: [{ ...tall, at: { ...tall.at, x: 400 } }] }, generatePart(part, PLACEHOLDER_MACHINE), PLACEHOLDER_MACHINE, { cell: 1 })
    expect(clear.found.filter((c) => c.kind === 'fixture')).toEqual([])
  }, 60_000)
})

describe('M3.6 placing fixtures automatically', () => {
  /** 400 x 300 x 19: cut out round the outside (T101 Ø12, through), a pocket and a through hole near one corner. */
  function shapedPart(): CamPart {
    const p = newPart({ name: 'Auto fixtures', length: 400, width: 300, thickness: 19, materialId: 'mat-mdf18', entities: [] })
    const outline = makeEntity({ t: 'contour', c: rect(0, 0, 400, 300) }, 'outline')
    const pocket = makeEntity({ t: 'contour', c: rect(150, 100, 100, 80) }, 'machining')
    const hole = makeEntity({ t: 'contour', c: circle({ x: 70, y: 70 }, 25) }, 'machining')
    p.entities = [outline, pocket, hole]
    p.outlineId = outline.id
    p.ops = [
      { ...defaultOp('pocket', [pocket.id]), toolId: 't102', levels: lv(8) } as CamOp,
      { ...defaultOp('profile', [hole.id]), side: 'inside', toolId: 't102', levels: lv(19, 0, true) } as CamOp,
      { ...defaultOp('profile', [outline.id]), side: 'outside', toolId: 't101', levels: lv(19, 0, true) } as CamOp,
    ]
    return p
  }

  it('four clamps round the part and four pods under it, every one clear of every move; one pushed onto the cut-out is caught', () => {
    const part = shapedPart()
    const paths = generatePart(part, PLACEHOLDER_MACHINE)
    let n = 0
    const ids = () => `fx${++n}`
    const clampType = PLACEHOLDER_FIXTURE_TYPES.find((t) => t.kind === 'clamp')!
    const podType = PLACEHOLDER_FIXTURE_TYPES.find((t) => t.id === 'fx-pod')!
    const c = autoPlace(part, paths, PLACEHOLDER_MACHINE, clampType, 4, ids)
    expect(c.notes).toEqual([])
    expect(c.fixtures).toHaveLength(4)
    const withClamps = { ...part, fixtures: c.fixtures }
    const p = autoPlace(withClamps, paths, PLACEHOLDER_MACHINE, podType, 4, ids)
    expect(p.notes).toEqual([])
    expect(p.fixtures).toHaveLength(8)
    const all = { ...part, fixtures: p.fixtures }
    // clamps: one per side, outside the outline, placeholders (badged)
    const clamps = all.fixtures.filter((f) => f.kind === 'clamp')
    const sides = new Set(clamps.map((f) => (f.at.y < 0 ? 'front' : f.at.y > 300 ? 'back' : f.at.x < 0 ? 'left' : 'right')))
    expect(sides.size).toBe(4)
    // nearest they can go: the cut-out cutter's far side (its centre 6 out, its side 12) plus the
    // margin (2), within the 2 mm search step
    for (const f of clamps) {
      const gap = f.at.y < 0 ? -f.at.y - 20 : f.at.y > 300 ? f.at.y - 300 - 20 : f.at.x < 0 ? -f.at.x - 20 : f.at.x - 400 - 20
      expect(gap).toBeGreaterThanOrEqual(14 - 1e-6)
      expect(gap).toBeLessThanOrEqual(16 + 1e-6)
    }
    // pods: inside the outline, none under the through hole (x 70, y 70, radius 25 + the cutter)
    for (const f of all.fixtures.filter((x) => x.kind === 'pod')) {
      expect(f.at.z).toBe(-119)
      const b = fixturePieces([f])[0].box
      expect(b.lo[0]).toBeGreaterThan(0)
      expect(b.hi[0]).toBeLessThan(400)
      const nx = Math.max(b.lo[0], Math.min(70, b.hi[0]))
      const ny = Math.max(b.lo[1], Math.min(70, b.hi[1]))
      expect(Math.hypot(nx - 70, ny - 70)).toBeGreaterThan(25 + 2 - 1e-6)
    }
    // the collision check agrees: nothing touches a fixture
    const found = partCollisions(all, paths, PLACEHOLDER_MACHINE).found
    expect(found.filter((x) => x.kind === 'fixture')).toEqual([])
    say(`auto-placed: ${clamps.map((f) => `${f.name} at ${f.at.x.toFixed(0)}, ${f.at.y.toFixed(0)}`).join('; ')}; pods ${all.fixtures.filter((x) => x.kind === 'pod').map((f) => `${f.at.x.toFixed(0)}, ${f.at.y.toFixed(0)}`).join('; ')}`)
    // a clamp pushed 5 mm in towards the part is hit by the cut-out cutter
    const front = clamps.find((f) => f.at.y < 0)!
    const pushed = all.fixtures.map((f) => (f.id === front.id ? { ...f, at: { ...f.at, y: f.at.y + 5 } } : f))
    const hit = partCollisions({ ...all, fixtures: pushed }, paths, PLACEHOLDER_MACHINE).found.filter((x) => x.kind === 'fixture')
    expect(hit.length).toBeGreaterThan(0)
    expect(hit[0].message).toContain(front.name)
    // running it again replaces the automatic ones only
    const again = autoPlace({ ...all, fixtures: [...all.fixtures, clamp(-200, -200, 10, 10, 10, -19, { id: 'mine', name: 'Mine' })] }, paths, PLACEHOLDER_MACHINE, clampType, 2, ids)
    expect(again.fixtures.filter((f) => f.kind === 'clamp' && f.auto)).toHaveLength(2)
    expect(again.fixtures.some((f) => f.id === 'mine')).toBe(true)
    expect(again.fixtures.filter((f) => f.kind === 'pod')).toHaveLength(4)
  }, 60_000)
})

describe('M3.6 fixtures: file format, Configure badges and the export checker', () => {
  it('fixtures round-trip in a part file; invented sizes carry a Configure badge until confirmed', () => {
    const part = pocketPart([{ ...clamp(250, 90, 60, 40, 50, -19), placeholder: true }])
    const back = parsePart(serializePart(part))
    expect(back.fixtures).toEqual(part.fixtures)
    const items = fixtureUnconfirmed(part)
    expect(items).toHaveLength(1)
    expect(items[0].key).toBe(`fixture:${part.id}:${part.fixtures![0].id}`)
    expect(items[0].value).toBe('block 60 x 40 x 50 mm')
    expect(fixtureUnconfirmed({ ...part, fixtures: [{ ...part.fixtures![0], placeholder: false }] })).toEqual([])
    // the shop's library examples are badged too
    const lib = machineUnconfirmed(PLACEHOLDER_MACHINE).filter((u) => u.group === 'Fixtures')
    expect(lib.map((u) => u.key)).toEqual(PLACEHOLDER_FIXTURE_TYPES.map((t) => `fixtureType:${t.id}`))
  })

  it('a part whose holder hits its clamp blocks the job export (CAM_COLLISION naming the fixture); clear, it does not', () => {
    const run = (x: number) => {
      const part = { ...pocketPart([clamp(x, 90, 40, 120, 64, -19)]), id: `clamped-${x}` }
      const data = defaultAppData()
      const job: Job = { id: 'j', number: 'JF', name: 'Fixtures', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [part] }
      data.jobs = [job]
      return runJob(job, data).issues.filter((i) => i.code === 'CAM_COLLISION')
    }
    const e = run(186)
    expect(e).toHaveLength(1)
    expect(e[0].severity).toBe('error')
    expect(e[0].message).toMatch(/holder hits fixture "Clamp A"/)
    expect(run(260)).toEqual([])
  })
})
