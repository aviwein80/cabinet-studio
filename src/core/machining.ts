import type { Seg } from '@/cam/geom'
import { partCollisions } from '@/cam/collision/collision'
import { partProgramOps } from '@/cam/mpr'
import { generatePart, type Intent, isAdaptive, isFlatLayer, isMore25d, OPS_3D, pathKey, type Toolpath } from '@/cam/toolpath'
import type { CancelCheck } from './cancel'
import { featuresOf } from './features'
import type { PartInstance } from './cutlist'
import { polygonArea, r3 } from './geometry'
import { nestMaterial, type NestedSheet, type NestPart } from './nesting'
import type { HDrillDir, Job, Library, MachineProfile, NestSettings, OpPurpose, ShopSettings, Tool, Vec2 } from './types'

export interface JobNest {
  sheets: NestedSheet[]
  unplaced: { uid: string; reason: string }[]
  spacing: number
  /** Engine and kit result per material. */
  materials?: { materialId: string; engine: 'rect' | 'shape'; strategy: string; splitKits: string[] }[]
}

export function cutoutTool(machine: MachineProfile): Tool | undefined {
  return machine.tools.find((t) => t.type === 'router' && t.number === machine.cutoutToolNumber)
}

/** Flat-bottomed router: what 2D pockets, grooves and engraving are calculated for (not V, ball or bull-nose). */
export function squareEnd(t: Tool) {
  return t.type === 'router' && t.shape !== 'v' && t.shape !== 'ball' && t.shape !== 'bull'
}

export function partSpacing(machine: MachineProfile, settings: ShopSettings) {
  return (cutoutTool(machine)?.diameter ?? 12) + settings.nesting.extraSpacing
}

export const NEST_DEFAULTS: Required<Omit<NestSettings, 'edgeTrim' | 'extraSpacing' | 'allowRotation' | 'premill'>> = {
  engine: 'auto',
  nestInApertures: true,
  keepKitsTogether: false,
  kitByCabinet: false,
  onionSkin: 0,
  onionSkinMaxArea: 100_000,
  offcutType: 'vertical',
  offcutMinLength: 300,
  offcutMinWidth: 300,
  useOffcuts: false,
}

export const nestSettingsOf = (settings: ShopSettings) => ({ ...NEST_DEFAULTS, ...settings.nesting })

export function nestJob(instances: PartInstance[], lib: Library, machine: MachineProfile, settings: ShopSettings, isCancelled?: CancelCheck): JobNest {
  const spacing = partSpacing(machine, settings)
  const ns = nestSettingsOf(settings)
  const byMaterial = new Map<string, PartInstance[]>()
  for (const inst of instances) {
    const list = byMaterial.get(inst.materialId) ?? []
    list.push(inst)
    byMaterial.set(inst.materialId, list)
  }
  const sheets: NestedSheet[] = []
  const unplaced: JobNest['unplaced'] = []
  const materials: NonNullable<JobNest['materials']> = []
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
    const res = nestMaterial(list.map((i) => nestPartOf(i, ns)), {
      sheetLength: material.sheetLength,
      sheetWidth: material.sheetWidth,
      edgeTrim: settings.nesting.edgeTrim,
      spacing,
      allowRotation: settings.nesting.allowRotation,
      // True-shape nesting has its own switch; off = rectangles only.
      engine: featuresOf(settings).camNesting ? ns.engine : 'rect',
      keepKits: ns.keepKitsTogether,
      offcuts: ns.useOffcuts ? (lib.offcuts ?? []).filter((o) => o.materialId === materialId) : [],
      offcutType: ns.offcutType,
      offcutMin: { length: ns.offcutMinLength, width: ns.offcutMinWidth },
      isCancelled,
    })
    for (const sh of res.sheets) sheets.push({ ...sh, index: sheets.length + 1, materialId, thickness: material.thickness })
    unplaced.push(...res.unplaced)
    materials.push({ materialId, engine: res.engine, strategy: res.strategy, splitKits: res.splitKits })
  }
  return { sheets, unplaced, spacing, materials }
}

export function nestPartOf(i: PartInstance, ns: ReturnType<typeof nestSettingsOf>): NestPart {
  const kit = i.kit ?? (ns.kitByCabinet && i.cabinetId ? `Cabinet ${i.cabinetNumber}` : undefined)
  return {
    uid: i.uid,
    length: i.cutLength,
    width: i.cutWidth,
    canRotate: i.canRotate,
    ...(i.outline.length >= 3 ? { outline: i.outline } : {}),
    ...(ns.nestInApertures && i.holes?.length ? { holes: i.holes } : {}),
    shape: i.cam ? `cam-${i.cam.id}-${i.cam.updatedAt}` : undefined,
    ...(i.priority ? { priority: i.priority } : {}),
    ...(kit ? { kit } : {}),
  }
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
  /** Final pass through an onion skin left by the first cut-out pass. */
  skin?: boolean
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
  /** Custom parts on this sheet: toolpath warnings, underside drilling, and whether machining was written. */
  custom?: {
    partUid: string
    partNo: number
    written: boolean
    machiningOps: number
    backHoles: number
    warnings: string[]
    /** 3D operations that need true 3D output (never written). */
    ops3d?: number
    /** Adaptive-clearing pockets: not written to woodWOP (blocked by the export checker). */
    adaptiveOps?: number
    /** Flat-layer 3D operations (Z-level roughing, waterline), and how many of them have no toolpath yet. */
    flat3d?: number
    flat3dMissing?: number
    /** Flat-layer 3D operations written to the program. */
    flat3dWritten?: boolean
    /** Collisions found by simulating the part's toolpaths (shank, holder, rapids, spoilboard, table). */
    collisions?: string[]
    /** Operations with no confirmed woodWOP form (never written): name and reason. */
    blocked?: { name: string; reason: string }[]
    /** M2.6 operations with a woodWOP form (facing, chamfer, saw-cut settings), and whether they were written. */
    more25d?: number
    more25dWritten?: boolean
    /** Enabled saw operations whose grooves were not put in the program (for the saw-unit check). */
    sawUnwritten?: number
    /** Enabled edge-work operations with an aggregate (for the aggregate check). */
    aggregateOps?: number
  }[]
}

export interface ProgramOptions {
  /** Write custom-part machining (feature flag camMprOutput). Off: only the cut-out is written. */
  camOutput?: boolean
  /** Also write flat-layer 3D operations (feature flag cam3dMprOutput). */
  cam3dOutput?: boolean
  /** Also write the M2.6 operations that have a woodWOP form (feature flag cam25dMprOutput). */
  cam25dOutput?: boolean
  /** 3D toolpaths calculated beforehand (in the compute worker), by `pathKey`. */
  paths3d?: ReadonlyMap<string, Toolpath>
  /** Small parts: the cut-out leaves `thickness` and a last pass at the end of the sheet cuts it. */
  onionSkin?: { thickness: number; maxArea: number }
}

/** Collision messages for a custom part's toolpaths, worked out once per part, machine and toolpath set. */
const collisionCache = new WeakMap<object, { machine: MachineProfile; key: string; found: string[] }>()
function collisionsOf(part: NonNullable<PartInstance['cam']>, paths: Toolpath[], machine: MachineProfile): string[] {
  // (a checksum of every move and tool, so an edited part never reuses old results)
  let sum = 0
  for (const p of paths)
    for (const m of p.moves) {
      if (m.t === 'poly') for (let i = 0; i < m.pts.length; i++) sum = (sum * 31 + m.pts[i] * 1000) % 1e15
      else sum = (sum * 31 + m.x * 1000 + m.y * 7 + m.z * 13) % 1e15
    }
  const key = `${part.length}x${part.width}x${part.thickness}:${paths.map((p) => `${p.opId}:${p.tool?.id}:${p.moves.length}`).join('|')}:${sum}`
  const hit = collisionCache.get(part)
  if (hit && hit.machine === machine && hit.key === key) return hit.found
  const found = partCollisions(part, paths, machine).found.map((c) => c.message)
  collisionCache.set(part, { machine, key, found })
  return found
}

function partAreaOf(inst: PartInstance | undefined) {
  if (!inst) return Infinity
  return inst.outline.length >= 3 ? Math.abs(polygonArea(inst.outline)) : inst.cutLength * inst.cutWidth
}

const safeName = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')

export function sheetProgramName(job: Job, sheetIndex: number, materialCode: string) {
  return `${safeName(job.number)}_S${String(sheetIndex).padStart(2, '0')}_${safeName(materialCode)}`
}

export function findDrill(machine: MachineProfile, diameter: number, depth: number, type: 'drill-vertical' | 'drill-horizontal') {
  return machine.tools.find((t) => t.type === type && Math.abs(t.diameter - diameter) < 0.01 && t.maxDepth + 1e-9 >= depth) ?? null
}

export function findPocketTool(machine: MachineProfile, width: number, depth: number) {
  const fits = machine.tools.filter((t) => squareEnd(t) && t.diameter <= width + 1e-9 && t.maxDepth + 1e-9 >= depth)
  fits.sort((a, b) => b.diameter - a.diameter || a.number - b.number)
  return fits[0] ?? null
}

/** Part-local -> sheet transform for a placement: optional half turn, then a quarter turn counter-clockwise. */
export function placementTransform(inst: Pick<PartInstance, 'cutLength' | 'cutWidth'>, pl: { x: number; y: number; rotated: boolean; flip?: boolean }) {
  const pt = (x0: number, y0: number): Vec2 => {
    const x = pl.flip ? inst.cutLength - x0 : x0
    const y = pl.flip ? inst.cutWidth - y0 : y0
    return pl.rotated ? { x: r3(pl.x + (inst.cutWidth - y)), y: r3(pl.y + x) } : { x: r3(pl.x + x), y: r3(pl.y + y) }
  }
  const dir = (d0: HDrillDir): HDrillDir => {
    const d = pl.flip ? ({ XP: 'XM', XM: 'XP', YP: 'YM', YM: 'YP' } as const)[d0] : d0
    if (!pl.rotated) return d
    return ({ XP: 'YP', XM: 'YM', YP: 'XM', YM: 'XP' } as const)[d]
  }
  const angle = (pl.flip ? 180 : 0) + (pl.rotated ? 90 : 0)
  return { pt, dir, angle }
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
  opts: ProgramOptions = {},
): SheetProgram {
  const material = lib.materials.find((m) => m.id === sheet.materialId)
  const materialCode = material?.code ?? sheet.materialId
  const T = sheet.thickness
  const drills: VDrill[] = []
  const hdrills: HDrill[] = []
  const grooves: (Pocket | SawGroove)[] = []
  const contours: Contour[] = []
  const camOps: CamProgramOp[] = []
  const custom: NonNullable<SheetProgram['custom']> = []
  const cutter = cutoutTool(machine) ?? null

  for (const pl of sheet.placements) {
    const inst = instances.get(pl.uid)
    if (!inst) continue
    const { pt, dir, angle } = placementTransform(inst, pl)
    const base = { partUid: inst.uid, partNo: inst.no }
    if (inst.cam) {
      const paths = generatePart(inst.cam, machine, undefined, opts.paths3d, true)
      const tf = { pt, dir, rotated: pl.rotated, angle }
      const all = partProgramOps(inst.cam, paths, tf, inst.uid, inst.no, machine, true)
      const backHoles = paths.reduce((n, tp) => n + tp.intents.filter((it) => it.k === 'vdrill' && it.back).length, 0)
      const machining = all.filter((o) => o.kind === 'cam')
      const enabled3d = inst.cam.ops.filter((o) => o.enabled && OPS_3D.has(o.kind))
      // (adaptive Z-level roughing is reported with the other adaptive clearing)
      const ops3d = enabled3d.filter((o) => !isFlatLayer(o) && !isAdaptive(o)).length
      const adaptiveOps = inst.cam.ops.filter((o) => o.enabled && isAdaptive(o)).length
      const flat = enabled3d.filter(isFlatLayer)
      const flatIds = new Set(flat.map((o) => o.id))
      const flat3dMissing = flat.filter((o) => !opts.paths3d?.has(pathKey(o, inst.cam!, machine))).length
      const write3d = !!opts.camOutput && !!opts.cam3dOutput
      const collisions = collisionsOf(inst.cam, paths, machine)
      const blockedIds = new Set(paths.filter((tp) => tp.noOutput).map((tp) => tp.opId))
      const blocked = paths.filter((tp) => tp.noOutput).map((tp) => ({ name: tp.name, reason: tp.noOutput! }))
      const more = inst.cam.ops.filter((o) => o.enabled && isMore25d(o) && !blockedIds.has(o.id))
      const moreIds = new Set(more.map((o) => o.id))
      const write25d = !!opts.camOutput && !!opts.cam25dOutput
      let sawWritten = 0
      custom.push({
        ...base,
        written: !!opts.camOutput,
        machiningOps: machining.length,
        backHoles,
        warnings: paths.flatMap((tp) => tp.warnings.map((w) => `${tp.name}: ${w}`)),
        ...(ops3d ? { ops3d } : {}),
        ...(adaptiveOps ? { adaptiveOps } : {}),
        ...(flat.length ? { flat3d: flat.length, flat3dMissing, flat3dWritten: write3d && !flat3dMissing } : {}),
        ...(collisions.length ? { collisions } : {}),
        ...(blocked.length ? { blocked } : {}),
        ...(more.length ? { more25d: more.length, more25dWritten: write25d } : {}),
      })
      for (const o of all) {
        if (o.kind === 'contour') contours.push(o)
        else if (o.kind !== 'cam' || !opts.camOutput) continue
        else if (flatIds.has(o.opId) && !(write3d && !flat3dMissing)) continue
        else if (blockedIds.has(o.opId) || (moreIds.has(o.opId) && !write25d)) continue
        else if (o.intent.k === 'vdrill') {
          const it = o.intent
          drills.push({ ...base, kind: 'vdrill', opId: o.opId, purpose: 'custom', x: it.x, y: it.y, diameter: it.d, depth: it.depth, through: it.through, tool: it.tool })
        } else if (o.intent.k === 'hdrill') {
          const it = o.intent
          hdrills.push({ ...base, kind: 'hdrill', opId: o.opId, purpose: 'custom', x: it.x, y: it.y, z: r3(T - it.z), diameter: it.d, depth: it.depth, dir: it.dir, tool: it.tool })
        } else {
          if (o.intent.k === 'saw') sawWritten++
          camOps.push(o)
        }
      }
      const sawOps = inst.cam.ops.filter((o) => o.enabled && o.kind === 'saw' && o.face === 1).length
      if (sawOps && !sawWritten) custom[custom.length - 1].sawUnwritten = sawOps
      const aggregateOps = inst.cam.ops.filter((o) => o.enabled && o.kind === 'edge').length
      if (aggregateOps) custom[custom.length - 1].aggregateOps = aggregateOps
      continue
    }
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
  ops.push(...grooves)
  // A part in another part's cut-out is finished before that cut-out frees the slug under it.
  const inner = new Set(sheet.placements.filter((p) => p.inside).map((p) => p.uid))
  for (const p of sheet.placements)
    if (inner.has(p.uid)) ops.push(...camOps.filter((o) => o.partUid === p.uid), ...contours.filter((c) => c.partUid === p.uid))
  ops.push(...camOps.filter((o) => !inner.has(o.partUid)).sort((a, b) => rank(a) - rank(b)))
  const outer = contours.filter((c) => !inner.has(c.partUid))
  const skin = opts.onionSkin && opts.onionSkin.thickness > 0 ? opts.onionSkin : null
  const skinned = new Set(
    skin
      ? sheet.placements.filter((p) => !inner.has(p.uid) && !sheet.placements.some((q) => q.inside === p.uid) && partAreaOf(instances.get(p.uid)) < skin.maxArea).map((p) => p.uid)
      : [],
  )
  for (const c of outer) ops.push(skinned.has(c.partUid) ? { ...c, za: r3(skin!.thickness) } : c)
  for (const c of outer) if (skinned.has(c.partUid)) ops.push({ ...c, skin: true })
  return {
    name: sheetProgramName(job, sheet.index, materialCode),
    sheet,
    materialCode,
    ops,
    skipped: machine.hasHorizontalDrillUnit ? [] : hdrills,
    ...(custom.length ? { custom } : {}),
  }
}

export function buildAllPrograms(job: Job, nest: JobNest, instances: PartInstance[], lib: Library, machine: MachineProfile, opts: ProgramOptions = {}) {
  const map = new Map(instances.map((i) => [i.uid, i]))
  return nest.sheets.map((s) => buildSheetProgram(job, s, map, lib, machine, opts))
}
