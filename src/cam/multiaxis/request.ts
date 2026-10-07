/**
 * A 5-axis operation turned into an engine request (M3.5): plain data only, so the engine can run
 * anywhere. The model placed in part coordinates, curves as 3D points (3D curves and solid edges as
 * they are; shapes on face 1 at height 0), the boundary as closed loops, the tool with its cutting
 * outline, shaft and holder, and the machine's two rotary axes when it has them.
 *
 * Pure: no DOM, no React.
 */
import { effectiveGauge, machineModelOf, toolOutline } from '@/core/machineModel'
import type { FormPoint, MachineProfile, Tool } from '@/core/types'
import { entityContours } from '../doc'
import { toPoints } from '../geom'
import { placeMesh } from '../mesh/place'
import type { Mesh } from '../mesh/types'
import { positionalAxes } from '../positional/kinematics'
import { cuttingOutline, outlinePoints } from '../tools/form'
import type { CamPart, MultiAxisOp } from '../types'
import type { Curve3, MultiAxisRequest, MultiAxisTool } from './engine'

/** The tool's cutting outline from the tip up, for any shape (straight pieces). */
export function cutterOutlineOf(t: Tool): FormPoint[] {
  const R = t.diameter / 2
  const flute = t.fluteLength ?? t.maxDepth
  switch (t.shape ?? 'flat') {
    case 'ball':
    case 'lollipop':
      return flute > R ? [{ h: 0, r: 0 }, { h: R, r: R, arc: R }, { h: flute, r: R }] : [{ h: 0, r: 0 }, { h: flute, r: Math.sqrt(Math.max(0, R * R - (flute - R) ** 2)), arc: R }]
    case 'bull': {
      const rc = Math.min(R, Math.max(0, t.cornerRadius ?? 0))
      return rc > 1e-9 ? [{ h: 0, r: 0 }, { h: 0, r: R - rc }, { h: rc, r: R, arc: rc }, { h: Math.max(rc, flute), r: R }] : [{ h: 0, r: 0 }, { h: 0, r: R }, { h: flute, r: R }]
    }
    case 'v': {
      const k = Math.tan(((t.angle ?? 90) * Math.PI) / 360)
      const hR = R / k
      return hR < flute ? [{ h: 0, r: 0 }, { h: hR, r: R }, { h: flute, r: R }] : [{ h: 0, r: 0 }, { h: flute, r: flute * k }]
    }
    default:
      return [{ h: 0, r: 0 }, { h: 0, r: R }, { h: flute, r: R }]
  }
}

/** The tool as the engine sees it. */
export function engineTool(t: Tool, machine: MachineProfile): MultiAxisTool {
  const form = cuttingOutline(t)
  const o = toolOutline(machine, t)
  const g = effectiveGauge(machine, t)
  return {
    number: t.number,
    name: t.name,
    shape: t.shape ?? 'flat',
    diameter: t.diameter,
    cornerRadius: t.cornerRadius ?? 0,
    angle: t.angle ?? 90,
    outline: form ? form.outline : outlinePoints(cutterOutlineOf(t)),
    fluteLength: t.fluteLength ?? t.maxDepth,
    shaftR: o.shankR,
    gauge: g.gauge,
    holder: o.holder,
  }
}

/** A shape as 3D curves: 3D curves and solid edges as they are, other shapes on face 1 at height 0. */
export function entityCurves(part: CamPart, id: string): Curve3[] {
  const e = part.entities.find((x) => x.id === id)
  if (!e) return []
  if (e.g.t === 'poly3d') return e.g.pts.length >= 2 ? [e.g.pts.map(([x, y, z]) => [x, y, z] as [number, number, number])] : []
  if (e.face !== 1) return []
  return entityContours(e)
    .filter((c) => c.segs.length)
    .map((c) => toPoints(c, 0.005).map((p) => [p.x, p.y, 0] as [number, number, number]))
    .filter((c) => c.length >= 2)
}

/** The model an operation names, placed in part coordinates, or why it cannot be had. */
export function placedModel(part: CamPart, modelId: string, meshes: ReadonlyMap<string, Mesh> | undefined): { mesh: Mesh } | { error: string } | null {
  if (!modelId) return null
  const m = part.models?.find((x) => x.id === modelId)
  if (!m) return { error: 'Its 3D model is gone: pick another.' }
  const raw = meshes?.get(m.blob)
  if (!raw) return { error: `The 3D model "${m.name}" is not loaded, so no toolpath was calculated.` }
  return { mesh: placeMesh(raw, m.place) }
}

/** The engine request for a 5-axis operation, or why none can be made. */
export function multiAxisRequest(op: MultiAxisOp, part: CamPart, machine: MachineProfile, tool: Tool, meshes?: ReadonlyMap<string, Mesh>): { req: MultiAxisRequest } | { error: string } {
  const model = placedModel(part, op.modelId, meshes)
  if (model && 'error' in model) return model
  if ((op.strategy === 'surface' || op.strategy === 'rough') && !model) return { error: 'Pick the 3D model this operation machines.' }
  const curves = (ids: string[] | undefined) => (ids ?? []).flatMap((id) => entityCurves(part, id))
  const isCurve = op.strategy === 'curve' || op.strategy === 'swarf'
  const boundary: [number, number][][] = []
  if (!isCurve)
    for (const id of op.geometry) {
      const e = part.entities.find((x) => x.id === id)
      if (!e || e.face !== 1) continue
      for (const c of entityContours(e)) if (c.closed && c.segs.length) boundary.push(toPoints(c, 0.005).map((p) => [p.x, p.y]))
    }
  const guide = op.axis.mode === 'guide' && op.axis.guide ? (entityCurves(part, op.axis.guide)[0] ?? null) : null
  const ax = positionalAxes(machineModelOf(machine))
  return {
    req: {
      part: { length: part.length, width: part.width, thickness: part.thickness },
      strategy: op.strategy,
      axis: { ...op.axis, point: { ...op.axis.point }, dir: { ...op.axis.dir } },
      surface: model ? { mesh: model.mesh, ...(op.groups?.length ? { groups: [...op.groups] } : {}), ...(op.check?.length ? { check: [...op.check] } : {}) } : null,
      curves: { drive: isCurve ? curves(op.geometry) : [], top: op.strategy === 'swarf' ? curves(op.top) : [], guide },
      boundary,
      tool: engineTool(tool, machine),
      side: op.side ?? 'left',
      stepover: op.stepover,
      stepdown: op.stepdown,
      stockToLeave: op.stockToLeave,
      tolerance: op.tolerance,
      depth: op.strategy === 'curve' || op.strategy === 'swarf' ? op.levels.depth : 0,
      safeZ: op.levels.safeZ,
      rapidZ: op.levels.rapidZ,
      headFlip: op.headFlip,
      maxTurn: op.maxTurn,
      gougeCheck: op.gougeCheck,
      machine: 'error' in ax ? null : { kinematics: { ...ax.kin }, travel: { first: { ...ax.first }, second: { ...ax.second } } },
    },
  }
}
