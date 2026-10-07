/**
 * Simultaneous 5-axis test fixtures (M3.5): parts with a 5-axis operation, the test engine (the
 * preview engine's code declared licensed, standing in for a licensed engine: no licensed engine is
 * installed), a barrel and a form tool, and a test machine with simultaneous 5-axis on two rotary
 * axes (not a machine in the shop).
 */
import { makeEntity, newPart } from '@/cam/doc'
import { DEFAULT_PLACEMENT } from '@/cam/mesh/place'
import { meshBounds } from '@/cam/mesh/types'
import { fakeEngine } from '@/cam/multiaxis/fake'
import { defaultOp } from '@/cam/ops'
import { generateOp, type GenContext, type Toolpath } from '@/cam/toolpath'
import type { CamPart, Entity, MultiAxisOp } from '@/cam/types'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import type { MachineProfile, PositionalKinematics, Tool } from '@/core/types'
import { machine32 } from './positional-fixtures'
import { surfaceMesh } from './finish3d-setup'

/** The test engine: the preview engine's methods, declared licensed (a stand-in; nothing is licensed). */
export const TEST_ENGINE = fakeEngine({ id: 'test', name: 'Test engine (stand-in for a licensed engine)', licensed: true })

/** A barrel cutter like the placeholder T110 and a form tool (an 8 mm taper with a rounded tip on a 6 mm neck). */
export const BARREL: Tool = { id: 't110', number: 110, type: 'router', name: 'Barrel 12 mm, side R40, tip R2', diameter: 12, maxDepth: 30, shape: 'barrel', barrelRadius: 40, cornerRadius: 2, centreCutting: true, shankDiameter: 10, fluteLength: 30, gaugeLength: 60, holderId: 'h-placeholder' }
export const FORM: Tool = {
  id: 't111',
  number: 111,
  type: 'router',
  name: 'Form taper 8 mm, R1 tip, 6 mm neck',
  diameter: 8,
  maxDepth: 20,
  shape: 'form',
  form: [
    { h: 0, r: 0 },
    { h: 1, r: 1, arc: 1 },
    { h: 20, r: 4 },
    { h: 22, r: 3 },
    { h: 40, r: 3 },
  ],
  centreCutting: true,
  shankDiameter: 6,
  fluteLength: 20,
  gaugeLength: 50,
  holderId: 'h-placeholder',
}

/** The placeholder machine with the form tool added (the barrel T110 is in the placeholder table). */
export function testMachine(): MachineProfile {
  const m = structuredClone(PLACEHOLDER_MACHINE)
  m.tools = [...m.tools, structuredClone(FORM)]
  return m
}

/** A test machine with simultaneous 5-axis on its two rotary axes (from the 3+2 test machines). */
export function machine5(layout: PositionalKinematics['layout'], first: 'A' | 'B' | 'C', second: 'A' | 'B' | 'C', extra: Partial<PositionalKinematics> = {}, travel: Record<string, [number, number]> = {}): MachineProfile {
  const m = machine32(layout, first, second, extra, travel)
  m.name = m.name.replace('Test 5-axis router', 'Test simultaneous 5-axis router')
  m.physical!.capabilities.simultaneous5 = true
  m.tools = [...m.tools, structuredClone(FORM)]
  return m
}

/** A latitude circle on the test hemisphere (centre 40, 40, -20; radius 20): radius `r` round its axis. */
export function latitude(r: number, n = 72): [number, number, number][] {
  const z = Math.sqrt(400 - r * r) - 20
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (2 * Math.PI * i) / n
    return [40 + r * Math.cos(t), 40 + r * Math.sin(t), z] as [number, number, number]
  })
}

/** A part with the hemisphere model (80 x 80, 45 thick) and the given shapes and 5-axis operation. */
export function hemiPart(entities: Entity[], patch: Partial<MultiAxisOp>, strategy: MultiAxisOp['strategy'] = 'surface'): { part: CamPart; op: MultiAxisOp } {
  const mesh = surfaceMesh('hemisphere')
  const b = meshBounds(mesh)
  const part: CamPart = {
    ...newPart({ id: 'hemi5', name: 'Hemisphere (5-axis)', length: b.max[0], width: b.max[1], thickness: 45, entities }),
    models: [{ id: 'm', name: 'hemisphere', kind: 'mesh', blob: 'hemisphere', source: 'hemisphere.stl', units: 'mm', place: { ...DEFAULT_PLACEMENT, at: [b.min[0], b.min[1], b.max[2]] }, layer: 'models', visible: true, triangles: mesh.indices.length / 3, size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]] }],
  }
  const base = defaultOp('multiaxis', [], { strategy } as Partial<MultiAxisOp>) as MultiAxisOp
  const op: MultiAxisOp = { ...base, id: `ma-${strategy}`, modelId: 'm', ...patch, axis: { ...base.axis, ...(patch.axis ?? {}) } }
  return { part: { ...part, ops: [op] }, op }
}

/** A plain block part (no model) with the given shapes and 5-axis operation. */
export function blockPart5(entities: Entity[], patch: Partial<MultiAxisOp>, strategy: MultiAxisOp['strategy']): { part: CamPart; op: MultiAxisOp } {
  const base = defaultOp('multiaxis', [], { strategy } as Partial<MultiAxisOp>) as MultiAxisOp
  const op: MultiAxisOp = { ...base, id: `ma-${strategy}`, ...patch, axis: { ...base.axis, ...(patch.axis ?? {}) } }
  return { part: { ...newPart({ id: 'block5', name: 'Block (5-axis)', length: 120, width: 80, thickness: 40, entities }), ops: [op] }, op }
}

/** A 3D curve as a shape. */
export const curve3 = (id: string, pts: [number, number, number][]): Entity => makeEntity({ t: 'poly3d', pts }, 'machining', 1, { id })

/** The operation's toolpath (meshes: the hemisphere). `engine`: the licensed engine slot. */
export function gen5(part: CamPart, op: MultiAxisOp, opts: { machine?: MachineProfile; engine?: GenContext['engine'] | null } = {}): Toolpath {
  return generateOp(op, { part, machine: opts.machine ?? testMachine(), meshes: new Map([['hemisphere', surfaceMesh('hemisphere')]]), ...(opts.engine === null ? {} : { engine: opts.engine ?? TEST_ENGINE }) })
}

/** Cutting points of a 5-axis toolpath with their tool directions. */
export function cutPoints(tp: Toolpath): { p: [number, number, number]; a: [number, number, number] }[] {
  const out: { p: [number, number, number]; a: [number, number, number] }[] = []
  for (const m of tp.moves) {
    if (m.t !== 'poly' || !m.axes) continue
    for (let i = 0; i < m.pts.length; i += 3) out.push({ p: [m.pts[i], m.pts[i + 1], m.pts[i + 2]], a: [m.axes[i], m.axes[i + 1], m.axes[i + 2]] })
  }
  return out
}
