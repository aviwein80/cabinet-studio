/**
 * M2.4c collision checking (SIM-03). The suite: shank too short for a deep pocket, holder into a
 * wall, rapid through stock, cut below the spoilboard limit and into the table. Each case has a
 * near-miss twin that must come out clean (zero false alarms), every collision must be found
 * (zero misses) at the right place, and each one leads to its move (jump-to-move). Generated
 * programs (the twenty Stage 1 reference parts) must be clean.
 */
import { describe, expect, it } from 'vitest'
import { checkCollisions, type Collision, collisionSetup, holderLow, shankLow } from '@/cam/collision/collision'
import { makeEntity, newPart } from '@/cam/doc'
import { rect } from '@/cam/geom'
import { defaultOp } from '@/cam/ops'
import { buildTimeline, positionAt, programOrder } from '@/cam/sim'
import { HeightfieldStock } from '@/cam/stock/heightfield'
import { generatePart, simpleMoves, type Toolpath } from '@/cam/toolpath'
import type { CamOp, CamPart } from '@/cam/types'
import { defaultAppData, PLACEHOLDER_HOLDER, PLACEHOLDER_MACHINE } from '@/core/defaults'
import { cutterOutline } from '@/core/machineModel'
import { runJob } from '@/core/pipeline'
import type { Job, MachineProfile } from '@/core/types'
import { buildMesh } from '@/cam/mesh/build'
import { DEFAULT_PLACEMENT } from '@/cam/mesh/place'
import { parseStl } from '@/cam/mesh/read'
import { meshBounds } from '@/cam/mesh/types'
import type { Finish3dOp, Rough3dOp } from '@/cam/types'
import { referenceParts } from './cam-reference'
import { relief, stlBinary } from './mesh-fixtures'
import { SURFACES } from './surfaces'

const lv = (depth: number, passDepth = 0, through = false) => ({ safeZ: 20, rapidZ: 3, depth, through, stockZ: 0, passDepth })

/** Placeholder machine plus a long test tool (10 mm flat, 50 mm flutes, 50 mm stick-out, placeholder holder). */
function machineWith(patch: Partial<MachineProfile> = {}): MachineProfile {
  const m = structuredClone(PLACEHOLDER_MACHINE)
  m.tools.push({ id: 't190', number: 190, type: 'router', name: 'Long flat 10 mm (test placeholder)', diameter: 10, maxDepth: 50, shankDiameter: 10, fluteLength: 50, gaugeLength: 50, holderId: PLACEHOLDER_HOLDER.id })
  return { ...m, ...patch }
}

function pocketPart(thickness: number, depth: number, toolId: string, passDepth: number): CamPart {
  const p = newPart({ name: 'Deep pocket', length: 200, width: 160, thickness, materialId: 'mat-mdf18', entities: [] })
  const pocket = makeEntity({ t: 'contour', c: rect(70, 50, 60, 60) }, 'machining')
  p.entities = [pocket]
  p.ops = [{ ...defaultOp('pocket', [pocket.id]), toolId, levels: lv(depth, passDepth) } as CamOp]
  return p
}

function run(part: CamPart, machine: MachineProfile, extra: Toolpath[] = []) {
  const paths = [...programOrder(generatePart(part, machine)), ...extra]
  const tl = buildTimeline(paths)
  const stock = new HeightfieldStock(part.length, part.width, part.thickness, 0.5)
  return { tl, paths, found: checkCollisions(tl, stock, collisionSetup(tl, paths, machine, part.thickness)) }
}

/** Every collision leads to its move: the time given puts the tool at the place given, on that move. */
function jumpsRight(tl: ReturnType<typeof buildTimeline>, found: Collision[]) {
  for (const c of found) {
    const p = positionAt(tl, c.t)
    expect(Math.hypot(p.p.x - c.at.x, p.p.y - c.at.y, p.p.z - c.at.z), c.message).toBeLessThan(1e-6)
    const s = tl.segs[p.seg]
    expect(s.op).toBe(c.op)
    expect(s.move).toBe(c.move)
  }
}

describe('M2.4c envelopes', () => {
  it('shank from the top of the flutes, its radius plus the margin; holder grown by the margin', () => {
    const tool = machineWith().tools.find((t) => t.id === 't190')!
    const o = cutterOutline(tool, PLACEHOLDER_HOLDER)
    expect(shankLow(o, 2, 6.99)).toBe(50)
    expect(shankLow(o, 2, 7.01)).toBe(Infinity)
    // holder: radius 17.5 at the holder face (50 above the tip), 21 at 30 mm above it, then 32
    expect(holderLow(o, 2, 0)).toBe(48)
    expect(holderLow(o, 2, 19.5)).toBe(48)
    expect(holderLow(o, 2, 21.25)).toBeCloseTo(48 + 15, 9)
    expect(holderLow(o, 2, 30)).toBe(78)
    expect(holderLow(o, 2, 34)).toBe(78)
    expect(holderLow(o, 2, 34.01)).toBe(Infinity)
    expect(holderLow(o, 0, 19.5)).toBeCloseTo(50 + 17.14285714, 6)
  })
})

describe('M2.4c collision suite: zero misses, zero false alarms', () => {
  it('shank too short for a deep pocket: 40 mm deep with 30 mm flutes collides from the first pass below 30; 30 mm deep is clean', () => {
    const m = machineWith()
    const deep = run(pocketPart(45, 40, 't102', 5), m)
    const kinds = new Set(deep.found.map((c) => c.kind))
    expect([...kinds]).toEqual(['shank'])
    const first = deep.found[0]
    expect(first.at.z).toBeLessThan(-30)
    expect(first.at.z).toBeGreaterThanOrEqual(-35 - 1e-6)
    // the worst: 10 mm of wall above the flutes at full depth
    expect(Math.max(...deep.found.map((c) => c.depth))).toBeCloseTo(10, 1)
    jumpsRight(deep.tl, deep.found)
    process.stdout.write(`  [collision] deep pocket: ${deep.found.length} run(s), first: ${first.message}\n`)
    expect(run(pocketPart(45, 30, 't102', 5), m).found).toEqual([])
  })

  it('holder into the wall: 49 mm deep with a 50 mm stick-out collides near the walls (1 mm into the 2 mm margin); 47 mm is clean; margin 0 makes 49 clean', () => {
    const m = machineWith()
    const deep = run(pocketPart(60, 49, 't190', 7), m)
    expect([...new Set(deep.found.map((c) => c.kind))]).toEqual(['holder'])
    expect(Math.max(...deep.found.map((c) => c.depth))).toBeCloseTo(1, 2)
    for (const c of deep.found) expect(c.at.z).toBeCloseTo(-49, 6)
    jumpsRight(deep.tl, deep.found)
    process.stdout.write(`  [collision] holder: ${deep.found.length} run(s), first: ${deep.found[0].message}\n`)
    expect(run(pocketPart(60, 47, 't190', 7), m).found).toEqual([])
    expect(run(pocketPart(60, 49, 't190', 7), machineWith({ collisionMargin: 0 })).found).toEqual([])
  }, 60_000)

  it('rapid through stock: a rapid at Z-4 over uncut panel collides; the same rapid inside the cut pocket, or above the panel, is clean', () => {
    const m = machineWith()
    const part = pocketPart(18, 6, 't102', 0)
    const base = generatePart(part, m)[0]
    const rapid = (name: string, z: number, x0: number, x1: number): Toolpath => ({
      ...base,
      name,
      moves: [
        { t: 'rapid', x: x0, y: 80, z: 20 },
        { t: 'rapid', x: x0, y: 80, z },
        { t: 'rapid', x: x1, y: 80, z },
        { t: 'rapid', x: x1, y: 80, z: 20 },
      ],
    })
    const bad = run(part, m, [rapid('Rapid across', -4, 20, 180)])
    expect(bad.found.map((c) => c.kind)).toEqual(['rapid'])
    const c = bad.found[0]
    // first touch: on the way down at X20 (material at 0, the tool reaches it at Z0)
    expect(c.at.x).toBeCloseTo(20, 6)
    expect(c.depth).toBeCloseTo(4, 6)
    jumpsRight(bad.tl, bad.found)
    expect(run(part, m, [rapid('Rapid inside the pocket', -4, 85, 115)]).found).toEqual([])
    expect(run(part, m, [rapid('Rapid above', 0.5, 20, 180)]).found).toEqual([])
  })

  it('below the spoilboard limit: 1 mm under the underside (limit 0.5) is a spoilboard collision; through cuts (0.3 mm) are clean; past the spoilboard is the table', () => {
    const m = machineWith()
    const mk = (depth: number, through: boolean) => {
      const p = newPart({ name: 'Through', length: 200, width: 160, thickness: 18, materialId: 'mat-mdf18', entities: [] })
      const e = makeEntity({ t: 'contour', c: rect(50, 40, 100, 80) }, 'outline')
      p.entities = [e]
      p.ops = [{ ...defaultOp('profile', [e.id]), side: 'inside', toolId: 't101', levels: lv(depth, 0, through) } as CamOp]
      return p
    }
    const deep = run(mk(19, false), m)
    expect([...new Set(deep.found.map((c) => c.kind))]).toEqual(['spoilboard'])
    expect(Math.max(...deep.found.map((c) => c.depth))).toBeCloseTo(0.5, 6)
    jumpsRight(deep.tl, deep.found)
    expect(run(mk(18, true), m).found).toEqual([])
    expect(run(mk(18.5, false), m).found).toEqual([])
    // the placeholder spoilboard is 19 mm: 20 mm under the underside is in the table
    const table = run(mk(38, false), m)
    expect(table.found.some((c) => c.kind === 'table')).toBe(true)
    expect(Math.max(...table.found.filter((c) => c.kind === 'table').map((c) => c.depth))).toBeCloseTo(1, 6)
  })

  it('the twenty Stage 1 reference parts: no collision anywhere (no false alarms on generated programs)', () => {
    let segs = 0
    for (const part of referenceParts()) {
      const r = run(part, PLACEHOLDER_MACHINE)
      segs += r.tl.segs.length
      expect(r.found.map((c) => c.message), part.name).toEqual([])
    }
    expect(segs).toBeGreaterThan(1000)
  }, 120_000)

  it('3D programs on the four test surfaces (Z-level roughing then parallel and waterline finishing): no collision', () => {
    for (const name of Object.keys(SURFACES)) {
      const mesh = buildMesh(parseStl(stlBinary(SURFACES[name].soup())), { gapTol: 0 }).mesh
      const b = meshBounds(mesh)
      const part: CamPart = {
        ...newPart({ name, length: b.max[0], width: b.max[1], thickness: 45 }),
        models: [{ id: 'm', name, kind: 'mesh', blob: name, source: `${name}.stl`, units: 'mm', place: { ...DEFAULT_PLACEMENT, at: [b.min[0], b.min[1], b.max[2]] }, layer: 'models', visible: true, triangles: mesh.indices.length / 3, size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]] }],
      }
      const r3 = defaultOp('rough3d') as Rough3dOp
      const f3 = defaultOp('finish3d') as Finish3dOp
      part.ops = [
        { ...r3, toolId: 't107', stepdown: 4, surface: { ...r3.surface, modelId: 'm' } },
        { ...f3, toolId: 't105', stepover: 0.2, surface: { ...f3.surface, modelId: 'm', stockToLeave: 0 } },
        { ...f3, strategy: 'waterline', toolId: 't105', stepdown: 2, fillShallow: false, surface: { ...f3.surface, modelId: 'm', stockToLeave: 0 } } as Finish3dOp,
      ]
      const paths = generatePart(part, PLACEHOLDER_MACHINE, new Map([[name, mesh]]))
      const tl = buildTimeline(paths)
      const found = checkCollisions(tl, new HeightfieldStock(part.length, part.width, part.thickness, 0.5), collisionSetup(tl, paths, PLACEHOLDER_MACHINE, part.thickness))
      expect(tl.ops.length, name).toBe(3)
      expect(found.map((c) => c.message), name).toEqual([])
    }
  }, 300_000)
})

describe('M2.4c 3D operations flagged when calculated (shank and holder against the model)', () => {
  // a square cavity 40 x 40 in a 100 x 100 panel (walls lean over one 1 mm cell)
  const cavity = (D: number) => (x: number, y: number) => (x >= 30 && x <= 70 && y >= 30 && y <= 70 ? -D : 0)
  function waterlineIn(D: number) {
    const mesh = buildMesh(parseStl(stlBinary(relief(100, 100, 100, 100, cavity(D)))), { gapTol: 0 }).mesh
    const b = meshBounds(mesh)
    const part: CamPart = {
      ...newPart({ name: 'Cavity', length: 100, width: 100, thickness: 80 }),
      models: [{ id: 'm', name: 'cavity', kind: 'mesh', blob: 'c', source: 'c.stl', units: 'mm', place: { ...DEFAULT_PLACEMENT, at: [0, 0, 0] }, layer: 'models', visible: true, triangles: mesh.indices.length / 3, size: [100, 100, b.max[2] - b.min[2]] }],
    }
    const f3 = defaultOp('finish3d', [], { strategy: 'waterline' } as Partial<CamOp>) as Finish3dOp
    const op: Finish3dOp = { ...f3, toolId: 't105', stepdown: 10, fillShallow: false, slope: { min: 0, max: 90 }, surface: { ...f3.surface, modelId: 'm', stockToLeave: 0 } }
    part.ops = [op]
    return generatePart(part, PLACEHOLDER_MACHINE, new Map([['c', mesh]]))[0]
  }

  it('60 mm deep with a 6 mm ball (25 mm flutes, 50 mm stick-out): shank and holder flagged with the lengths needed; 20 mm deep is clean', () => {
    const tp = waterlineIn(60)
    const holder = tp.warnings.find((w) => w.startsWith('The holder would hit the model'))
    const shank = tp.warnings.find((w) => w.startsWith('The shank would rub the model'))
    process.stdout.write(`  [collision] cavity 60 mm:\n    ${holder}\n    ${shank}\n`)
    expect(holder).toBeDefined()
    expect(shank).toBeDefined()
    // the ball reaches the floor at -60: flutes need 25 + 35 = 60 mm; the holder (50 mm, margin 2) needs 62
    const need = (w: string) => Number(/needs at least ([\d.]+) mm/.exec(w)![1])
    expect(need(shank!)).toBeGreaterThan(59)
    expect(need(shank!)).toBeLessThanOrEqual(60.05)
    expect(need(holder!)).toBeGreaterThan(61)
    expect(need(holder!)).toBeLessThanOrEqual(62.05)
    // the move given is where it starts: the first level deeper than the flutes (25 mm, the shank envelope reaching the wall)
    const move = Number(/from move (\d+)/.exec(shank!)![1]) - 1
    const z = [...simpleMoves(tp.moves)][move].z
    expect(z).toBeLessThan(-25)
    expect(z).toBeGreaterThanOrEqual(-30 - 1e-6)
    expect(waterlineIn(20).warnings.filter((w) => w.includes('would hit the model') || w.includes('would rub the model'))).toEqual([])
  }, 120_000)
})

describe('M2.4c the export checker blocks collisions', () => {
  const issuesFor = (depth: number) => {
    const part = { ...pocketPart(45, depth, 't102', 5), id: `deep-${depth}` }
    const data = defaultAppData()
    const job: Job = { id: 'j', number: 'JC', name: 'Collision', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [part] }
    data.jobs = [job]
    return runJob(job, data).issues
  }

  it('a 40 mm pocket with 30 mm flutes: CAM_COLLISION error naming the shank and the move; 30 mm: none', () => {
    const e = issuesFor(40).filter((i) => i.code === 'CAM_COLLISION')
    expect(e).toHaveLength(1)
    expect(e[0].severity).toBe('error')
    expect(e[0].message).toMatch(/shank hits material above the flutes/)
    expect(e[0].message).toMatch(/moves? \d+/)
    expect(issuesFor(30).filter((i) => i.code === 'CAM_COLLISION')).toEqual([])
  }, 60_000)
})
