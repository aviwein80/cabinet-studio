import type { Seg } from '@/cam/geom'
import type { Intent } from '@/cam/toolpath'
import type { PartInstance } from './cutlist'
import { polygonArea, r3 } from './geometry'
import { nestMaterial, type NestedSheet } from './nesting'
import type { HDrillDir, Job, Library, MachineProfile, OpPurpose, ShopSettings, Tool, Vec2 } from './types'

export interface JobNest {
  sheets: NestedSheet[]
  unplaced: { uid: string; reason: string }[]
  spacing: number
}

export function cutoutTool(machine: MachineProfile): Tool | undefined {
  return machine.tools.find((t) => t.type === 'router' && t.number === machine.cutoutToolNumber)
}

export function partSpacing(machine: MachineProfile, settings: ShopSettings) {
  return (cutoutTool(machine)?.diameter ?? 12) + settings.nesting.extraSpacing
}

export function nestJob(instances: PartInstance[], lib: Library, machine: MachineProfile, settings: ShopSettings): JobNest {
  const spacing = partSpacing(machine, settings)
  const byMaterial = new Map<string, PartInstance[]>()
  for (const inst of instances) {
    const list = byMaterial.get(inst.materialId) ?? []
    list.push(inst)
    byMaterial.set(inst.materialId, list)
  }
  const sheets: NestedSheet[] = []
  const unplaced: JobNest['unplaced'] = []
  const materialOrder = [...byMaterial.keys()].sort((a, b) => {
    const ma = lib.materials.find((m) => m.id === a)?.code ?? a
    const mb = lib.materials.find((m) => m.id === b)?.code ?? b
    return ma.localeCompare(mb)
  })
  for (const materialId of materialOrder) {
    const list = byMaterial.get(materialId)!
    const material = lib.materials.find((m) => m.id === materialId)
    if (!material) {
      for (const i of list) unplaced.push({ uid: i.uid, reason: `Material ${materialId} not in library` })
      continue
    }
    const res = nestMaterial(
      list.map((i) => ({ uid: i.uid, length: i.cutLength, width: i.cutWidth, canRotate: i.canRotate })),
      {
        sheetLength: material.sheetLength,
        sheetWidth: material.sheetWidth,
        edgeTrim: settings.nesting.edgeTrim,
        spacing,
        allowRotation: settings.nesting.allowRotation,
      },
    )
    for (const sh of res.sheets) sheets.push({ ...sh, index: sheets.length + 1, materialId, thickness: material.thickness })
    unplaced.push(...res.unplaced)
  }
  return { sheets, unplaced, spacing }
}

// ---------------------------------------------------------------------------------------------
// Sheet programs: operations in sheet coordinates with tools resolved
// ---------------------------------------------------------------------------------------------

interface Base {
  partUid: string
  partNo: number
  opId: string
  purpose: OpPurpose | 'cut-out'
}

export interface VDrill extends Base {
  kind: 'vdrill'
  x: number
  y: number
  diameter: number
  /** Programmed depth (through holes include the machine's through depth). */
  depth: number
  through: boolean
  tool: Tool | null
}

export interface HDrill extends Base {
  kind: 'hdrill'
  x: number
  y: number
  z: number
  diameter: number
  depth: number
  dir: HDrillDir
  tool: Tool | null
}

export interface Pocket extends Base {
  kind: 'pocket'
  /** Rectangle actually machined, in sheet coordinates (open sides already extended). */
  x1: number
  y1: number
  x2: number
  y2: number
  depth: number
  tool: Tool | null
  /** Narrowest groove width, used for tool checks. */
  width: number
}

export interface SawGroove extends Base {
  kind: 'saw'
  xa: number
  ya: number
  xe: number
  ye: number
  width: number
  depth: number
  throughEnds: boolean
  tool: Tool | null
}

export interface Contour extends Base {
  kind: 'contour'
  /** Closed path, first point repeated at the end, in machining direction. */
  points: Vec2[]
  /** Z of the cut relative to the sheet underside (negative = into spoilboard). */
  za: number
  tool: Tool | null
  /** Native lines and arcs (custom parts). When present the writer uses these instead of `points`. */
  segs?: Seg[]
}

/** A custom-part operation in sheet coordinates, written as native woodWOP macros. */
export interface CamProgramOp extends Base {
  kind: 'cam'
  intent: Intent
}

export type ProgramOp = VDrill | HDrill | Pocket | SawGroove | Contour | CamProgramOp

export interface SheetProgram {
  name: string
  sheet: NestedSheet
  materialCode: string
  ops: ProgramOp[]
  /** Horizontal holes left out of the program because the machine has no horizontal unit. */
  skipped: HDrill[]
}

const safeName = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')

export function sheetProgramName(job: Job, sheetIndex: number, materialCode: string) {
  return `${safeName(job.number)}_S${String(sheetIndex).padStart(2, '0')}_${safeName(materialCode)}`
}

export function findDrill(machine: MachineProfile, diameter: number, depth: number, type: 'drill-vertical' | 'drill-horizontal') {
  return machine.tools.find((t) => t.type === type && Math.abs(t.diameter - diameter) < 0.01 && t.maxDepth + 1e-9 >= depth) ?? null
}

export function findPocketTool(machine: MachineProfile, width: number, depth: number) {
  const fits = machine.tools.filter((t) => t.type === 'router' && t.shape !== 'v' && t.diameter <= width + 1e-9 && t.maxDepth + 1e-9 >= depth)
  fits.sort((a, b) => b.diameter - a.diameter || a.number - b.number)
  return fits[0] ?? null
}

/** Part-local -> sheet transform for a placement. Rotation is 90 degrees counter-clockwise. */
export function placementTransform(inst: PartInstance, pl: { x: number; y: number; rotated: boolean }) {
  const pt = (x: number, y: number): Vec2 =>
    pl.rotated ? { x: r3(pl.x + (inst.cutWidth - y)), y: r3(pl.y + x) } : { x: r3(pl.x + x), y: r3(pl.y + y) }
  const dir = (d: HDrillDir): HDrillDir => {
    if (!pl.rotated) return d
    return ({ XP: 'YP', XM: 'YM', YP: 'XM', YM: 'XP' } as const)[d]
  }
  return { pt, dir }
}

function startAtLongestEdge(poly: Vec2[]) {
  let best = 0
  let bestLen = -1
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len > bestLen + 1e-9) {
      bestLen = len
      best = i
    }
  }
  const a = poly[best]
  const b = poly[(best + 1) % poly.length]
  const mid = { x: r3((a.x + b.x) / 2), y: r3((a.y + b.y) / 2) }
  const rest: Vec2[] = []
  for (let k = 1; k <= poly.length; k++) rest.push(poly[(best + k) % poly.length])
  return [mid, ...rest, mid]
}

export function buildSheetProgram(
  job: Job,
  sheet: NestedSheet,
  instances: Map<string, PartInstance>,
  lib: Library,
  machine: MachineProfile,
): SheetProgram {
  const material = lib.materials.find((m) => m.id === sheet.materialId)
  const materialCode = material?.code ?? sheet.materialId
  const T = sheet.thickness
  const drills: VDrill[] = []
  const hdrills: HDrill[] = []
  const grooves: (Pocket | SawGroove)[] = []
  const contours: Contour[] = []
  const cutter = cutoutTool(machine) ?? null

  for (const pl of sheet.placements) {
    const inst = instances.get(pl.uid)
    if (!inst) continue
    const { pt, dir } = placementTransform(inst, pl)
    const base = { partUid: inst.uid, partNo: inst.no }
    for (const op of inst.ops) {
      if (op.kind === 'drill') {
        const p = pt(op.x, op.y)
        const depth = op.through ? r3(T + machine.throughDepth) : op.depth
        drills.push({
          ...base,
          kind: 'vdrill',
          opId: op.id,
          purpose: op.purpose,
          x: p.x,
          y: p.y,
          diameter: op.diameter,
          depth,
          through: op.through,
          tool: findDrill(machine, op.diameter, depth, 'drill-vertical'),
        })
      } else if (op.kind === 'hdrill') {
        const p = pt(op.x, op.y)
        hdrills.push({
          ...base,
          kind: 'hdrill',
          opId: op.id,
          purpose: op.purpose,
          x: p.x,
          y: p.y,
          z: r3(T - op.z),
          diameter: op.diameter,
          depth: op.depth,
          dir: dir(op.dir),
          tool: findDrill(machine, op.diameter, op.depth, 'drill-horizontal'),
        })
      } else {
        const width = Math.min(op.x2 - op.x1, op.y2 - op.y1)
        if (machine.grooveMethod === 'saw') {
          const alongX = op.x2 - op.x1 >= op.y2 - op.y1
          const a = alongX ? pt(op.x1, (op.y1 + op.y2) / 2) : pt((op.x1 + op.x2) / 2, op.y1)
          const e = alongX ? pt(op.x2, (op.y1 + op.y2) / 2) : pt((op.x1 + op.x2) / 2, op.y2)
          const tool = machine.tools.find((t) => t.type === 'saw' && t.maxDepth + 1e-9 >= op.depth) ?? null
          grooves.push({
            ...base,
            kind: 'saw',
            opId: op.id,
            purpose: op.purpose,
            xa: a.x,
            ya: a.y,
            xe: e.x,
            ye: e.y,
            width: r3(width),
            depth: op.depth,
            throughEnds: alongX ? op.open.x1 || op.open.x2 : op.open.y1 || op.open.y2,
            tool,
          })
        } else {
          const tool = findPocketTool(machine, width, op.depth)
          const ext = tool ? tool.diameter / 2 + 1 : 0
          const lx1 = op.open.x1 ? op.x1 - ext : op.x1
          const lx2 = op.open.x2 ? op.x2 + ext : op.x2
          const ly1 = op.open.y1 ? op.y1 - ext : op.y1
          const ly2 = op.open.y2 ? op.y2 + ext : op.y2
          const c1 = pt(lx1, ly1)
          const c2 = pt(lx2, ly2)
          grooves.push({
            ...base,
            kind: 'pocket',
            opId: op.id,
            purpose: op.purpose,
            x1: Math.min(c1.x, c2.x),
            y1: Math.min(c1.y, c2.y),
            x2: Math.max(c1.x, c2.x),
            y2: Math.max(c1.y, c2.y),
            depth: op.depth,
            tool,
            width: r3(width),
          })
        }
      }
    }
    let poly = inst.outline.map((p) => pt(p.x, p.y))
    const cw = machine.contour.direction === 'climb-cw'
    const area = polygonArea(poly)
    if ((cw && area > 0) || (!cw && area < 0)) poly = [...poly].reverse()
    contours.push({
      ...base,
      kind: 'contour',
      opId: `${inst.part.key}-outline`,
      purpose: 'cut-out',
      points: startAtLongestEdge(poly),
      za: -machine.throughDepth,
      tool: cutter,
    })
  }

  const cutRank = new Map(sheet.placements.map((p, i) => [p.uid, i]))
  const rank = (o: { partUid: string }) => cutRank.get(o.partUid) ?? 0
  drills.sort((a, b) => a.diameter - b.diameter || rank(a) - rank(b) || a.y - b.y || a.x - b.x)
  grooves.sort((a, b) => rank(a) - rank(b))
  const ops: ProgramOp[] = [...drills]
  if (machine.hasHorizontalDrillUnit) ops.push(...hdrills)
  ops.push(...grooves, ...contours)
  return {
    name: sheetProgramName(job, sheet.index, materialCode),
    sheet,
    materialCode,
    ops,
    skipped: machine.hasHorizontalDrillUnit ? [] : hdrills,
  }
}

export function buildAllPrograms(job: Job, nest: JobNest, instances: PartInstance[], lib: Library, machine: MachineProfile) {
  const map = new Map(instances.map((i) => [i.uid, i]))
  return nest.sheets.map((s) => buildSheetProgram(job, s, map, lib, machine))
}
