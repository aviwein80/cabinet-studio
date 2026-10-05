/**
 * M2.5c: assemblies into parts with quantities and properties, into the job and nesting (SOL-04);
 * faces to layers by colour or type, face colours, grain from a face (SOL-03); machining picked
 * faces directly (SOL-02); operations on solid shapes go stale when the solid changes.
 */
import { describe, expect, it } from 'vitest'
import { opInputHash, opState } from '@/cam/doc'
import { boxOf, segLength } from '@/cam/geom'
import { BUILTIN_RECIPES, applyRules, BUILTIN_RULESETS } from '@/cam/rules'
import { assemblyParts } from '@/cam/solid/assembly'
import { facePoints, fitSurface } from '@/cam/solid/classify'
import { faceColors, facesByColor, facesByType, grainDirection, machineFaces, refreshSolidShapes, sendFacesToLayer, setFaceColor, staleSolidShapes } from '@/cam/solid/faces'
import { recognizePanel } from '@/cam/solid/recognize'
import { solidToPart } from '@/cam/solid/toPart'
import type { SolidBody, SolidData } from '@/cam/solid/types'
import { generatePart } from '@/cam/toolpath'
import type { CamPart, ModelRef } from '@/cam/types'
import { defaultAppData, PLACEHOLDER_MACHINE } from '@/core/defaults'
import { runJob } from '@/core/pipeline'
import type { Job, Material } from '@/core/types'
import { readFixture } from './solid-fixtures'

const ply: Material = { id: 'mat-ply19', code: 'PLY19', name: 'Maple ply 19', thickness: 19, sheetLength: 3658, sheetWidth: 1524, grain: false, color: '#d8c39a' }
const mdf6: Material = { id: 'mat-mdf6', code: 'MDF6', name: 'MDF 6', thickness: 6, sheetLength: 3658, sheetWidth: 1524, grain: false, color: '#8a7350' }

/** A copy of a body moved by a 3 x 3 matrix (rows) and offset; faces classified again. */
function moved(b: SolidBody, M: number[][], off: [number, number, number], index: number): SolidBody {
  const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0])
  const positions = new Float64Array(b.positions.length)
  const normals = new Float32Array(b.normals.length)
  for (let i = 0; i < b.positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      positions[i + k] = M[k][0] * b.positions[i] + M[k][1] * b.positions[i + 1] + M[k][2] * b.positions[i + 2] + off[k]
      normals[i + k] = M[k][0] * b.normals[i] + M[k][1] * b.normals[i + 1] + M[k][2] * b.normals[i + 2]
    }
  const indices = b.indices.slice()
  if (det < 0) for (let t = 0; t < indices.length; t += 3) [indices[t + 1], indices[t + 2]] = [indices[t + 2], indices[t + 1]]
  const out: SolidBody = { ...b, index, positions, normals, indices, faces: [] }
  out.faces = b.faces.map((f) => ({ ...f, id: f.id + 1000 * index, surface: fitSurface(facePoints(out, f.first, f.last)) }))
  return { ...out, faces: JSON.parse(JSON.stringify(out.faces)) }
}

async function sidePart(): Promise<{ part: CamPart; model: ModelRef; solid: SolidData }> {
  const solid = await readFixture('cabinet-side.step')
  const { part } = solidToPart(solid, { body: 0, blob: 'a'.repeat(64), source: 'cabinet-side.step', materials: [ply] })
  return { part, model: part.models![0], solid }
}

describe('M2.5c assemblies (SOL-04)', () => {
  it('the 5-part assembly: 4 parts, the side twice, names and properties from the file', async () => {
    const s = await readFixture('assembly-5.step')
    const parts = assemblyParts(s)
    expect(parts.map((p) => [p.name, p.qty, p.bodies])).toEqual([
      ['Side', 2, [0, 1]],
      ['Bottom', 1, [2]],
      ['Top rail', 1, [3]],
      ['Back', 1, [4]],
    ])
    expect(parts[0].properties).toEqual({ Material: 'Maple ply 19', Edge: 'Front' })
    expect(parts[0].size).toEqual([720, 560, 19])
    expect(parts[3].size).toEqual([701, 562, 6])
    expect(parts.map((p) => p.holes)).toEqual([10, 1, 0, 0])
    expect(parts[0].path).toEqual(['Base cabinet 600'])
  })

  it('a turned copy is the same part; a mirrored copy (same areas, mirrored holes) is not', async () => {
    const s = await readFixture('cabinet-side.step')
    const b = s.bodies[0]
    const turned = moved(
      b,
      [
        [-1, 0, 0],
        [0, -1, 0],
        [0, 0, 1],
      ],
      [900, 1200, 0],
      1,
    )
    const mirrored = moved(
      b,
      [
        [-1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      [-400, 0, 0],
      2,
    )
    const three: SolidData = { ...s, bodies: [b, turned, mirrored] }
    const parts = assemblyParts(three)
    expect(parts.map((p) => [p.name, p.qty, p.bodies])).toEqual([
      ['Cabinet side', 2, [0, 1]],
      ['Cabinet side (2)', 1, [2]],
    ])
    // the mirrored side still reads as a panel with every feature
    expect([parts[1].holes, parts[1].pockets, parts[1].cutouts]).toEqual([30, 4, 1])
  })

  it('into the job and nesting: quantities, materials from the properties, every piece nested and the export checker clean', async () => {
    const s = await readFixture('assembly-5.step')
    const groups = assemblyParts(s)
    const parts = groups.map((g) => {
      const one: SolidData = { ...s, bodies: s.bodies.filter((b) => b.index === g.bodies[0]) }
      const { part } = solidToPart(one, { body: g.bodies[0], blob: 'c'.repeat(64), source: 'assembly-5.step', name: g.name, qty: g.qty, materials: [ply, mdf6] })
      return applyRules(part, BUILTIN_RULESETS[0], BUILTIN_RECIPES).part
    })
    expect(parts.map((p) => [p.name, p.qty, p.materialId])).toEqual([
      ['Side', 2, 'mat-ply19'],
      ['Bottom', 1, 'mat-ply19'],
      ['Top rail', 1, 'mat-ply19'],
      ['Back', 1, 'mat-mdf6'],
    ])
    const data = defaultAppData()
    data.library.materials.push(ply, mdf6)
    data.settings.features = { ...data.settings.features, camMprOutput: true } as typeof data.settings.features
    const job: Job = { id: 'j', number: 'ASM1', name: 'Base cabinet', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: parts }
    data.jobs = [job]
    const out = runJob(job, data)
    expect(out.instances).toHaveLength(5)
    expect(out.issues.filter((i) => i.severity === 'error')).toEqual([])
    const placed = out.programs.flatMap((p) => p.sheet.placements)
    expect(placed).toHaveLength(5)
    // two sheets: the plywood and the MDF back
    expect(new Set(out.programs.map((p) => p.sheet.materialId))).toEqual(new Set(['mat-ply19', 'mat-mdf6']))
    expect(out.cutList.find((r) => r.name === 'Side')?.qty).toBe(2)
  })
})

describe('M2.5c faces: colours, layers by colour or type, grain (SOL-03)', () => {
  it('face colours from the file, set in the app, and faces found by colour', async () => {
    const { model, solid } = await sidePart()
    const red = facesByColor(solid, model, '#CC3333')
    expect(red).toHaveLength(1)
    expect(faceColors(solid, model)).toEqual([
      { color: '#d8c39a', faces: 105 },
      { color: '#cc3333', faces: 1 },
    ])
    const holes = facesByType(solid, 'hole', 5)
    expect(holes).toHaveLength(26)
    const blue = setFaceColor(model, holes, '#3366ff')
    expect(facesByColor(solid, blue, '#3366ff')).toEqual(holes)
    expect(facesByColor(solid, setFaceColor(blue, holes.slice(0, 6), null), '#3366ff')).toHaveLength(20)
  })

  it('faces to a layer by type: the 26 system holes on one layer, with a recipe they are drilled', async () => {
    const { part, model, solid } = await sidePart()
    const bare: CamPart = { ...part, entities: part.entities.filter((e) => e.solid?.role === 'outline'), ops: [] }
    const holes = facesByType(solid, 'hole', 5)
    const r = sendFacesToLayer(bare, model, solid, holes, 'SHELF_PINS', BUILTIN_RECIPES.find((x) => x.id === 'rc-drill'))
    expect(r.warnings).toEqual([])
    expect(r.entities).toHaveLength(26)
    for (const e of r.entities) {
      expect(e.g.t).toBe('circle')
      expect(e.depth).toBe(13)
      expect(e.solid?.role).toBe('hole')
    }
    const lay = r.part.layers.find((l) => l.name === 'SHELF_PINS')!
    expect(r.part.models![0].faceLayers![String(holes[0])]).toBe(lay.id)
    expect(r.part.ops).toHaveLength(1)
    const drills = generatePart(r.part, PLACEHOLDER_MACHINE).flatMap((tp) => tp.intents.filter((i) => i.k === 'vdrill'))
    expect(drills).toHaveLength(26)
    expect(new Set(drills.map((d) => (d.k === 'vdrill' ? d.depth : 0)))).toEqual(new Set([13]))
  })

  it('faces to a layer by colour: the red face (face 1) gives the outline; layer rules then machine the layer by its name', async () => {
    const { part, model, solid } = await sidePart()
    const bare: CamPart = { ...part, entities: [], ops: [], outlineId: undefined }
    const r = sendFacesToLayer(bare, model, solid, facesByColor(solid, model, '#cc3333'), 'Outline')
    // the face is face 1 itself: nothing to profile from a flat face alone
    expect(r.entities).toHaveLength(0)
    const walls = recognizePanel(solid.bodies[0], { frame: { ...placementOf(model, solid) } }).outlineFaces
    const r2 = sendFacesToLayer(bare, model, solid, walls.slice(0, 1), 'cut')
    expect(r2.entities).toHaveLength(1)
    expect(r2.entities[0].solid?.role).toBe('outline')
    const ruled = applyRules(r2.part, BUILTIN_RULESETS[0], BUILTIN_RECIPES)
    expect(ruled.report.map((x) => x.recipe)).toEqual(['Profile, holes inside (through)'])
  })

  it('grain from a face: along its longest straight edge; the part is laid that way with grain along its length', async () => {
    const side = await readFixture('cabinet-side.step')
    const red = facesByColor(side, {}, '#cc3333')
    const d = grainDirection(side.bodies[0], red)!
    // the side stands with its 720 mm length along file Z
    expect(Math.abs(d[2])).toBeCloseTo(1, 12)
    const { part } = solidToPart(side, { body: 0, blob: 'a'.repeat(64), source: 'side', grainFaces: red })
    expect([part.length, part.width, part.grain]).toEqual([720, 560, 'length'])
    // the door's bottom edge face is 400 long: grain across the door puts the 400 side along X
    const door = await readFixture('shaped-door.step')
    const body = door.bodies[0]
    const rec = recognizePanel(body)
    const bottom = rec.outlineFaces.find((f) => {
      const face = body.faces.find((x) => x.id === f)!
      return face.surface.kind === 'plane' && Math.abs(face.area - 400 * 19) < 1e-6
    })!
    const { part: across } = solidToPart(door, { body: 0, blob: 'd'.repeat(64), source: 'door', grainFaces: [bottom] })
    expect([across.length, across.width, across.grain]).toEqual([400, 700, 'length'])
    // the file's "Grain: Length" property alone also sets the grain
    expect(solidToPart(side, { body: 0, blob: 'a'.repeat(64), source: 'side' }).part.grain).toBe('length')
  })
})

function placementOf(model: ModelRef, solid: SolidData) {
  const f = model.place.frame!
  const R: [number, number, number][] = [f.slice(0, 3) as [number, number, number], f.slice(3, 6) as [number, number, number], f.slice(6, 9) as [number, number, number]]
  const P = solid.bodies[0].positions
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < P.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const v = R[k][0] * P[i] + R[k][1] * P[i + 1] + R[k][2] * P[i + 2]
      lo[k] = Math.min(lo[k], v)
      hi[k] = Math.max(hi[k], v)
    }
  return { R: R as [[number, number, number], [number, number, number], [number, number, number]], origin: [lo[0], lo[1], hi[2]] as [number, number, number], length: hi[0] - lo[0], width: hi[1] - lo[1], thickness: hi[2] - lo[2], warnings: [] }
}

describe('M2.5c machining picked faces directly (SOL-02)', () => {
  it('pocket from a floor face, drill from a drill point, profile from an outline wall and from a cut-out wall: exact shapes, depths from the faces', async () => {
    const { part, model, solid } = await sidePart()
    const bare: CamPart = { ...part, ops: [] }
    const rec = recognizePanel(solid.bodies[0], { frame: placementOf(model, solid) })
    // pocket: the 4 mm step's floor
    const step = rec.pockets.find((p) => p.depth === 4)!
    const pk = machineFaces(bare, model, solid, [step.floor], 'pocket')
    expect(pk.warnings).toEqual([])
    expect(pk.op?.kind).toBe('pocket')
    expect(pk.op?.levels.depth).toBe(4)
    const tpk = generatePart(pk.part, PLACEHOLDER_MACHINE).find((t) => t.opId === pk.op!.id)!
    const deepest = Math.max(...tpk.intents.flatMap((i) => (i.k === 'contour' ? i.passes.map((p) => p.depth) : i.k === 'pocket-rect' ? [i.depth] : [])))
    expect(deepest).toBe(4)
    // drill: pick the drill point (cone) of a connector hole
    const cone = solid.bodies[0].faces.find((f) => f.surface.kind === 'cone')!
    const dr = machineFaces(bare, model, solid, [cone.id], 'drill')
    expect(dr.entities).toHaveLength(1)
    expect(dr.entities[0].depth).toBe(13)
    expect(dr.entities[0].g).toMatchObject({ t: 'circle', r: 4 })
    const vd = generatePart(dr.part, PLACEHOLDER_MACHINE).find((t) => t.opId === dr.op!.id)!.intents
    expect(vd).toMatchObject([{ k: 'vdrill', d: 8, depth: 13 }])
    // profile from one wall of the outline: the whole outline, outside, through
    const pr = machineFaces(bare, model, solid, [rec.outlineFaces[0]], 'profile')
    expect(pr.entities[0].solid?.role).toBe('outline')
    expect(pr.op).toMatchObject({ kind: 'profile', side: 'outside', levels: { through: true } })
    // profile from a wall of the cut-out: inside, through
    const co = machineFaces(bare, model, solid, [rec.cutouts[0].faces[0]], 'profile')
    expect(co.op).toMatchObject({ kind: 'profile', side: 'inside', levels: { through: true } })
    const box = boxOf([co.entities[0].g.t === 'contour' ? co.entities[0].g.c : { segs: [], closed: true }])
    expect([box.minX, box.minY, box.maxX, box.maxY]).toEqual([300, 250, 420, 290])
    // a flat face that is no pocket floor: told why
    expect(machineFaces(bare, model, solid, [cone.id], 'pocket').warnings[0]).toMatch(/not a pocket|floor/)
  })

  it('saw along a straight wall: a line the length of its top edge; blocked by the export checker on a machine without a saw', async () => {
    const { part, model, solid } = await sidePart()
    const bare: CamPart = { ...part, ops: [] }
    const rec = recognizePanel(solid.bodies[0], { frame: placementOf(model, solid) })
    const longWall = rec.outlineFaces.map((f) => solid.bodies[0].faces.find((x) => x.id === f)!).find((f) => f.surface.kind === 'plane' && Math.abs(f.area - 720 * 19) < 1e-6)!
    const saw = machineFaces(bare, model, solid, [longWall.id], 'saw')
    expect(saw.op?.kind).toBe('saw')
    expect(saw.entities[0].g.t).toBe('contour')
    const c = (saw.entities[0].g as { c: { segs: Parameters<typeof segLength>[0][] } }).c
    expect(segLength(c.segs[0])).toBeCloseTo(720, 9)
    expect(saw.op?.levels.through).toBe(true)
    const data = defaultAppData()
    data.library.materials.push(ply)
    data.settings.features = { ...data.settings.features, camMprOutput: true } as typeof data.settings.features
    const job: Job = { id: 'j', number: 'SAW', name: 'Saw', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [saw.part] }
    data.jobs = [job]
    expect(runJob(job, data).issues.some((i) => i.code === 'MACHINE_CANNOT')).toBe(true)
  })

  it('needs a model at true size, flush with face 1', async () => {
    const { part, model, solid } = await sidePart()
    const scaled = { ...model, place: { ...model.place, scale: 2 } }
    expect(machineFaces(part, scaled, solid, [1], 'pocket').warnings[0]).toMatch(/scaled or mirrored/)
    const low = { ...model, place: { ...model.place, at: [0, 0, -2] as [number, number, number] } }
    expect(machineFaces(part, low, solid, [1], 'pocket').warnings[0]).toMatch(/not flush/)
  })
})

describe('M2.5c associativity: the solid changes, its shapes and operations follow', () => {
  it('a new version of the solid marks every operation on its shapes stale; shapes are made again from the same faces', async () => {
    const { part: p0, model, solid } = await sidePart()
    const part = applyRules(p0, BUILTIN_RULESETS[0], BUILTIN_RECIPES).part
    const tool = (o: (typeof part.ops)[number]) => PLACEHOLDER_MACHINE.tools.find((t) => t.id === o.toolId) ?? o.toolId
    const built: CamPart = { ...part, ops: part.ops.map((o) => ({ ...o, builtHash: opInputHash(o, part, tool(o), PLACEHOLDER_MACHINE) })) }
    expect(built.ops.every((o) => opState(o, built, tool(o), PLACEHOLDER_MACHINE) === 'current')).toBe(true)
    expect(staleSolidShapes(built)).toEqual([])
    // a new version (another blob)
    const v2: ModelRef = { ...model, blob: 'e'.repeat(64) }
    const changed: CamPart = { ...built, models: [v2] }
    expect(changed.ops.every((o) => opState(o, changed, tool(o), PLACEHOLDER_MACHINE) === 'stale')).toBe(true)
    expect(staleSolidShapes(changed)).toHaveLength(changed.entities.length)
    // made again from the solid (same faces): same shapes, now linked to the new version
    const r = refreshSolidShapes(changed, v2, solid)
    expect(r.missing).toEqual([])
    expect(r.updated).toBe(changed.entities.length)
    expect(staleSolidShapes(r.part)).toEqual([])
    for (const e of r.part.entities) expect(e.g).toEqual(changed.entities.find((x) => x.id === e.id)!.g)
    // a solid whose faces do not match: those shapes are listed, left as they were
    const other = await readFixture('feature-block.step')
    const bad = refreshSolidShapes(changed, v2, other)
    expect(bad.missing.length).toBeGreaterThan(0)
  })

  it('Stage 1 parts (no solid shapes) hash exactly as before', async () => {
    const { part } = await sidePart()
    const plain: CamPart = { ...part, entities: part.entities.map(({ solid: _s, ...e }) => e), models: [] }
    const ruled = applyRules(plain, BUILTIN_RULESETS[0], BUILTIN_RECIPES).part
    const op = ruled.ops[0]
    const a = opInputHash(op, ruled, null)
    const b = opInputHash(op, { ...ruled, models: [{ ...part.models![0], blob: 'f'.repeat(64) }] }, null)
    expect(a).toBe(b)
  })
})
