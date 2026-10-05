/**
 * M2.3c adaptive clearing in each level of Z-level roughing (NEW-01 in 3D). Checked independently:
 * the width of cut of every move at each level by exact Clipper2 areas against material worked out
 * by hand (`checkEngagement`), no full-width moves outside flagged trochoidal loops, no gouges, what
 * it clears against the offset pattern (simulated stock), and that woodWOP output is blocked.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkGouge } from '@/cam/3d/check'
import { checkEngagement } from '@/cam/adaptive/check'
import { newPart } from '@/cam/doc'
import type { P } from '@/cam/geom'
import { clipPolys } from '@/cam/kernel'
import { buildMesh } from '@/cam/mesh/build'
import { DEFAULT_PLACEMENT } from '@/cam/mesh/place'
import { parseStl } from '@/cam/mesh/read'
import { type Mesh, meshBounds } from '@/cam/mesh/types'
import { DEFAULT_ADAPTIVE, defaultOp } from '@/cam/ops'
import { buildTimeline } from '@/cam/sim'
import { HeightfieldStock } from '@/cam/stock/heightfield'
import { generateOp, inBackground, isAdaptive, isFlatLayer, type Toolpath } from '@/cam/toolpath'
import type { CamPart, Rough3dOp } from '@/cam/types'
import { defaultAppData, PLACEHOLDER_MACHINE } from '@/core/defaults'
import { runJob } from '@/core/pipeline'
import type { Job } from '@/core/types'
import { digest3d } from './cam-digest'
import { relief, stlBinary } from './mesh-fixtures'
import { SURFACES } from './surfaces'

const machine = PLACEHOLDER_MACHINE
const BULL = 't107' // 12 mm R2 bull-nose (placeholder)
const R = 6
const TARGET = DEFAULT_ADAPTIVE.width * 2 * R

// a block 40 x 30 standing 12 mm proud of a 100 x 80 panel (walls 1 in 48, over one 0.25 mm cell)
const block = (x: number, y: number) => (x >= 30 && x <= 70 && y >= 25 && y <= 55 ? 0 : -12)
const MODELS: Record<string, () => number[][]> = {
  block: () => relief(100, 80, 400, 320, block),
  hemisphere: SURFACES.hemisphere.soup,
}

const meshCache = new Map<string, Mesh>()
function meshOf(name: string): Mesh {
  let mesh = meshCache.get(name)
  if (!mesh) {
    mesh = buildMesh(parseStl(stlBinary(MODELS[name]())), { gapTol: 0 }).mesh
    meshCache.set(name, mesh)
  }
  return mesh
}

const runs = new Map<string, { mesh: Mesh; part: CamPart; op: Rough3dOp; tp: Toolpath }>()
function rough(name: string, patch: Partial<Rough3dOp> = {}) {
  const key = name + JSON.stringify(patch)
  const hit = runs.get(key)
  if (hit) return hit
  const mesh = meshOf(name)
  const b = meshBounds(mesh)
  const part: CamPart = {
    ...newPart({ name, length: b.max[0], width: b.max[1], thickness: 45 }),
    models: [{ id: 'm', name, kind: 'mesh', blob: name, source: `${name}.stl`, units: 'mm', place: { ...DEFAULT_PLACEMENT, at: [b.min[0], b.min[1], b.max[2]] }, layer: 'models', visible: true, triangles: mesh.indices.length / 3, size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]] }],
  }
  const base = defaultOp('rough3d') as Rough3dOp
  const op: Rough3dOp = { ...base, pattern: 'adaptive', toolId: BULL, stepdown: 3, ...patch, surface: { ...base.surface, modelId: 'm', ...(patch.surface ?? {}) } }
  part.ops = [op]
  const tp = generateOp(op, { part, machine, meshes: new Map([[name, mesh]]) })
  const out = { mesh, part, op, tp }
  runs.set(key, out)
  return out
}

/** Heights the tool cuts at (feed moves along a level). */
const levelsOf = (tp: Toolpath) => [...new Set(tp.moves.flatMap((m) => (m.t === 'feed' && m.f === 'cut' ? [Math.round(m.z * 1e6) / 1e6] : [])))].sort((a, b) => b - a)

const square = (x0: number, y0: number, x1: number, y1: number): P[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]
const disc = (cx: number, cy: number, r: number): P[] => Array.from({ length: 720 }, (_, k) => ({ x: cx + r * Math.cos((k * Math.PI) / 360), y: cy + r * Math.sin((k * Math.PI) / 360) }))

describe('M2.3c adaptive clearing per Z level: steady width of cut (independent check)', () => {
  it('block: every move at every level <= target + 10 %, none at full width, no gouges', () => {
    const { mesh, tp } = rough('block', { stockZ: 0, surface: { stockToLeave: 0 } as Rough3dOp['surface'] })
    expect(levelsOf(tp)).toEqual([-3, -6, -9, -12])
    for (const z of [-3, -12]) {
      // the material at the level, by hand: the panel less the block (its walls lean out 0.25 mm
      // over the 12 mm, so it is that much wider at the foot)
      const e = (0.25 * (12 + z)) / 12
      const material = clipPolys('subtract', [square(0, 0, 100, 80)], [square(30 - e, 25 - e, 70 + e, 55 + e)])
      const rep = checkEngagement(tp, R, material, z)
      // (moves of the deeper levels pass through this one too, cutting nothing new there)
      const atLevel = (i: number) => {
        const m = tp.moves[i]
        return m.t === 'feed' && Math.abs(m.z - z) < 1e-6
      }
      const ws = rep.moves.filter((m) => !m.flagged && atLevel(m.i)).map((m) => m.width).sort((a, b) => a - b)
      process.stdout.write(`  [adaptive 3D] block, level ${z}: ${rep.moves.length} moves checked, widest ${rep.max.toFixed(3)} mm (${((rep.max / TARGET) * 100).toFixed(1)} % of ${TARGET.toFixed(2)}), full-width outside loops ${rep.fullOutside}\n`)
      expect(rep.moves.length).toBeGreaterThan(500)
      expect(rep.max).toBeLessThanOrEqual(TARGET * 1.1)
      expect(rep.maxFlagged).toBeLessThanOrEqual(TARGET * 1.1)
      expect(rep.fullOutside).toBe(0)
      expect(ws[Math.floor(ws.length / 2)]).toBeGreaterThan(TARGET * 0.8)
    }
    // simulated: everything further than the corner radius (and a cell) from the block is down to
    // the floor, -12 (within 0.05 mm: measured 0.03 mm at worst, in a corner of the panel)
    const hs = new HeightfieldStock(100, 80, 45, 0.25)
    for (const sg of buildTimeline([tp]).segs) if (sg.kind !== 'rapid') hs.carve(sg.a, sg.b, sg.cutter)
    let worst = -Infinity
    for (let j = 0; j < hs.hf.ny; j++)
      for (let i = 0; i < hs.hf.nx; i++) {
        const x = (i + 0.5) * 0.25
        const y = (j + 0.5) * 0.25
        if (x > 27.5 && x < 72.5 && y > 22.5 && y < 57.5) continue
        worst = Math.max(worst, hs.hf.top[j * hs.hf.nx + i])
      }
    expect(worst).toBeLessThan(-12 + 0.05)
    const g = checkGouge(mesh, { shape: 'bull', r: R, cornerRadius: 2 }, tp.moves, { step: 0.2, resolution: 0.1, maxPoints: 400 })
    expect(g.max).toBeLessThanOrEqual(0.005)
  }, 120_000)

  it('hemisphere with 0.5 mm stock to leave: steady at a middle level and the bottom one, no gouges', () => {
    const { mesh, tp } = rough('hemisphere')
    expect(levelsOf(tp)).toEqual([-3, -6, -9, -12, -15, -18, -19.5])
    for (const z of [-12, -19.5]) {
      // the panel less the dome's slice at the level grown by the stock to leave (the true sphere:
      // the mesh's facets sit a little inside it, so the tool gets a little closer)
      const material = clipPolys('subtract', [square(0, 0, 80, 80)], [disc(40, 40, Math.sqrt(400 - (z + 20) ** 2) + 0.5)])
      const rep = checkEngagement(tp, R, material, z)
      process.stdout.write(`  [adaptive 3D] hemisphere, level ${z}: ${rep.moves.length} moves checked, widest ${rep.max.toFixed(3)} mm (${((rep.max / TARGET) * 100).toFixed(1)} %), full-width outside loops ${rep.fullOutside}\n`)
      expect(rep.moves.length).toBeGreaterThan(500)
      expect(rep.max).toBeLessThanOrEqual(TARGET * 1.1)
      expect(rep.fullOutside).toBe(0)
    }
    const g = checkGouge(mesh, { shape: 'bull', r: R, cornerRadius: 2 }, tp.moves, { stock: 0.5, step: 0.2, resolution: 0.1, maxPoints: 400 })
    expect(g.max).toBeLessThanOrEqual(0.005)
  }, 120_000)

  it('clears what the offset pattern clears (simulated stock, within 1 %)', () => {
    const vol = (tp: Toolpath, part: CamPart) => {
      const hs = new HeightfieldStock(part.length, part.width, part.thickness, 0.5)
      for (const s of buildTimeline([tp]).segs) if (s.kind !== 'rapid') hs.carve(s.a, s.b, s.cutter)
      return hs.removedVolume()
    }
    const a = rough('hemisphere')
    const o = rough('hemisphere', { pattern: 'offset' })
    const va = vol(a.tp, a.part)
    const vo = vol(o.tp, o.part)
    process.stdout.write(`  [adaptive 3D] hemisphere removed ${(va / 1000).toFixed(1)} cm³ vs ${(vo / 1000).toFixed(1)} cm³ with offset rings\n`)
    expect(Math.abs(va - vo) / vo).toBeLessThan(0.01)
  }, 120_000)

  it('adaptive feed: the lighter moves and the lifted moves back run faster, never above the boost', () => {
    const { tp } = rough('block', { stockZ: 0, adaptive: { ...DEFAULT_ADAPTIVE, feedBoost: 2 }, surface: { stockToLeave: 0 } as Rough3dOp['surface'] })
    const ks = tp.moves.flatMap((m) => (m.t === 'feed' && m.k ? [m.k] : []))
    expect(ks.length).toBeGreaterThan(100)
    for (const k of ks) {
      expect(k).toBeGreaterThan(1)
      expect(k).toBeLessThanOrEqual(2)
    }
  }, 120_000)
})

describe('M2.3c adaptive Z-level roughing: flags, output and golden', () => {
  it('calculated in the background; never a flat layer; no woodWOP passes', () => {
    const { part, op, tp } = rough('block', { stockZ: 0, surface: { stockToLeave: 0 } as Rough3dOp['surface'] })
    expect(isAdaptive(op)).toBe(true)
    expect(isFlatLayer(op)).toBe(false)
    expect(inBackground(op, part)).toBe(true)
    expect(tp.intents).toEqual([])
    expect(tp.warnings).toContain('Adaptive clearing per level is not written to woodWOP yet; simulate it.')
    // the offset pattern is still a flat layer
    expect(isFlatLayer({ ...op, pattern: 'offset' })).toBe(true)
  }, 120_000)

  it('the export checker refuses it for woodWOP (adaptive), even with both output switches on', () => {
    const { part: p } = rough('block', { stockZ: 0, surface: { stockToLeave: 0 } as Rough3dOp['surface'] })
    const part = { ...p, materialId: 'mat-mdf18', thickness: 19 }
    const data = defaultAppData()
    const job: Job = { id: 'j', number: 'JA', name: 'Adaptive 3D', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [part] }
    data.jobs = [job]
    data.settings.features = { ...data.settings.features, camMprOutput: true, cam3dMprOutput: true } as typeof data.settings.features
    const issues = runJob(job, data).issues
    const e = issues.filter((i) => i.code === 'CAM_ADAPTIVE_NO_OUTPUT')
    expect(e).toHaveLength(1)
    expect(e[0].severity).toBe('error')
    expect(e[0].message).toMatch(/Z-level roughing/)
    // reported once, as adaptive clearing (not also as true 3D output)
    expect(issues.filter((i) => i.code === 'CAM_3D_NO_OUTPUT')).toHaveLength(0)
  }, 120_000)

  const DIR = path.join(import.meta.dirname, 'golden', 'cam3d')
  const UPDATE = process.env.UPDATE_GOLDEN === '1'
  it('golden: adaptive Z-level roughing, hemisphere', () => {
    const dig = JSON.stringify(digest3d(rough('hemisphere').tp), null, 1) + '\n'
    const f = path.join(DIR, 'rough-hemisphere-adaptive', 'toolpath.json')
    if (UPDATE) {
      fs.mkdirSync(path.dirname(f), { recursive: true })
      fs.writeFileSync(f, dig)
    }
    expect(fs.existsSync(f), `${f} missing; run UPDATE_GOLDEN=1 once to create it`).toBe(true)
    expect(dig).toBe(fs.readFileSync(f, 'utf8'))
  }, 120_000)
})
