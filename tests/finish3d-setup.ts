/**
 * Shared set-up for the M3.1 finishing tests: an analytic test surface (tests/surfaces.ts) as an
 * STL model on a part, one finishing operation on it, and its toolpath.
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect } from 'vitest'
import { makeEntity, newPart } from '@/cam/doc'
import { buildMesh } from '@/cam/mesh/build'
import { DEFAULT_PLACEMENT } from '@/cam/mesh/place'
import { parseStl } from '@/cam/mesh/read'
import { type Mesh, meshBounds } from '@/cam/mesh/types'
import { defaultOp } from '@/cam/ops'
import { generateOp, type Toolpath } from '@/cam/toolpath'
import type { CamPart, Finish3dOp } from '@/cam/types'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import type { MachineProfile } from '@/core/types'
import { digest3d } from './cam-digest'
import { stlBinary } from './mesh-fixtures'
import { SURFACES } from './surfaces'

export const BALL = 't105' // 6 mm ball-nose (placeholder)
export const BULL = 't107' // 12 mm R2 bull-nose (placeholder)
export const FLAT = 't102' // 8 mm flat (placeholder)
/** THOROUGH=1 checks many more tool positions (minutes instead of seconds). */
export const THOROUGH = process.env.THOROUGH === '1'

const meshCache = new Map<string, Mesh>()

/** The mesh of a named test surface (built once). */
export function surfaceMesh(name: string): Mesh {
  let mesh = meshCache.get(name)
  if (!mesh) {
    mesh = buildMesh(parseStl(stlBinary(SURFACES[name].soup())), { gapTol: 0 }).mesh
    meshCache.set(name, mesh)
  }
  return mesh
}

/** Register a mesh under a name (for surfaces made in a test). */
export function addSurface(name: string, mesh: Mesh, f: (x: number, y: number) => number) {
  meshCache.set(name, mesh)
  SURFACES[name] = { soup: () => [], f }
}

export function finishSetup(name: string, strategy: Finish3dOp['strategy'], patch: Partial<Finish3dOp> = {}, boundary?: ReturnType<typeof makeEntity>[], machine: MachineProfile = PLACEHOLDER_MACHINE) {
  const mesh = surfaceMesh(name)
  const b = meshBounds(mesh)
  const part: CamPart = {
    ...newPart({ name, length: b.max[0], width: b.max[1], thickness: 45 }),
    models: [{ id: 'm', name, kind: 'mesh', blob: name, source: `${name}.stl`, units: 'mm', place: { ...DEFAULT_PLACEMENT, at: [b.min[0], b.min[1], b.max[2]] }, layer: 'models', visible: true, triangles: mesh.indices.length / 3, size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]] }],
  }
  if (boundary) part.entities = [...part.entities, ...boundary]
  const base = defaultOp('finish3d', boundary?.map((e) => e.id) ?? [], { strategy } as Partial<Finish3dOp>) as Finish3dOp
  const op: Finish3dOp = { ...base, toolId: BALL, stepover: 1, ...patch, strategy, surface: { ...base.surface, modelId: 'm', ...(patch.surface ?? {}) } }
  part.ops = [op]
  const tp = generateOp(op, { part, machine, meshes: new Map([[name, mesh]]) })
  return { mesh, part, op, tp }
}

/** CL points (exact drop positions) of the cutting chains. */
export function clPoints(tp: Toolpath): [number, number, number][] {
  const out: [number, number, number][] = []
  for (const m of tp.moves) if (m.t === 'poly') for (let i = 0; i < m.pts.length; i += 3) out.push([m.pts[i], m.pts[i + 1], m.pts[i + 2]])
  return out
}

/** Compare (or with UPDATE_GOLDEN=1 write) a 3D golden digest under tests/golden/cam3d/<name>. */
export function expectGolden3d(name: string, tp: Toolpath) {
  const dig = JSON.stringify(digest3d(tp), null, 1) + '\n'
  const f = path.join(import.meta.dirname, 'golden', 'cam3d', name, 'toolpath.json')
  if (process.env.UPDATE_GOLDEN === '1') {
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, dig)
  }
  // a missing golden fails: it must be made on purpose with UPDATE_GOLDEN=1
  expect(fs.existsSync(f), `${f} missing; run UPDATE_GOLDEN=1 once to create it`).toBe(true)
  expect(dig).toBe(fs.readFileSync(f, 'utf8'))
}
