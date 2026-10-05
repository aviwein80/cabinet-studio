/**
 * Pre-export safety checks on generated sheet programs. These catch obvious mistakes; they are
 * NOT a substitute for simulating every program in woodWOP before it runs on the machine.
 */
import { boxOf } from '@/cam/geom'
import type { PartInstance } from './cutlist'
import { EPS, fmt } from './geometry'
import { areaPaths, EndType, FillRule, inflatePaths, intersect, JoinType, type Paths64 } from 'clipper2-ts'
import { cutoutTool, placementTransform, type JobNest, type SheetProgram } from './machining'
import type { Placement } from './nesting'
import { machineModelOf } from './machineModel'
import { featuresOf } from './features'
import type { Library, MachineProfile, ShopSettings } from './types'

export type Severity = 'error' | 'warning' | 'info'

export interface Issue {
  severity: Severity
  code: string
  message: string
  sheet?: number
  partNo?: number
  partUid?: string
}

const SMALL_PART_MIN_SIDE = 120
const SMALL_PART_MIN_AREA = 0.05e6
const MIN_REMAINING_FLOOR = 3

export function validateJob(
  programs: SheetProgram[],
  nest: JobNest,
  instances: PartInstance[],
  lib: Library,
  machine: MachineProfile,
  settings: ShopSettings,
): Issue[] {
  const issues: Issue[] = []
  const byUid = new Map(instances.map((i) => [i.uid, i]))
  const add = (i: Issue) => issues.push(i)

  if (machine.placeholder)
    add({
      severity: 'warning',
      code: 'PLACEHOLDER_TOOLS',
      message: 'Machine profile uses PLACEHOLDER tool data. Replace it with the real N-200 tool table before running any program.',
    })

  const model = machineModelOf(machine)
  if (model.placeholder)
    add({
      severity: 'warning',
      code: 'MACHINE_PLACEHOLDER',
      message: 'Machine model (table, travel, tool change, spoilboard, saw and aggregate units) is PLACEHOLDER data. Confirm the real N-200 figures on the Machine page.',
    })
  const noSaw = (what: string) => `${what}: the machine model has no saw unit. Confirm the unit on the Machine page (Saw unit fitted) or use router pockets.`

  const cutter = cutoutTool(machine)
  if (!cutter)
    add({ severity: 'error', code: 'TOOL_MISSING', message: `Cut-out router T${machine.cutoutToolNumber} is not in the tool table.` })

  if (settings.nesting.edgeTrim < (cutter?.diameter ?? 0) / 2)
    add({ severity: 'warning', code: 'TRIM_SMALL', message: `Edge trim ${settings.nesting.edgeTrim} mm is less than the cut-out tool radius.` })

  if (machine.throughDepth > machine.spoilboardAllowance + EPS)
    add({
      severity: 'error',
      code: 'DEPTH_SPOILBOARD',
      message: `Through depth ${machine.throughDepth} mm exceeds spoilboard allowance ${machine.spoilboardAllowance} mm.`,
    })

  for (const u of nest.unplaced) {
    const inst = byUid.get(u.uid)
    add({ severity: 'error', code: 'NOT_NESTED', message: `Part ${inst?.partId ?? u.uid} could not be nested: ${u.reason}`, partUid: u.uid, partNo: inst?.no })
  }

  for (const prog of programs) {
    const sh = prog.sheet
    const T = sh.thickness
    const sheetNo = sh.index
    const maxZ = T + machine.spoilboardAllowance
    const trim = settings.nesting.edgeTrim
    if (sh.sheetLength > model.table.length + EPS || sh.sheetWidth > model.table.width + EPS)
      add({
        severity: 'error',
        code: 'OFF_TABLE',
        sheet: sheetNo,
        message: `Sheet ${fmt(sh.sheetLength)} x ${fmt(sh.sheetWidth)} mm is larger than the machine table ${fmt(model.table.length)} x ${fmt(model.table.width)} mm.`,
      })

    // Placement checks: inside sheet, spacing, grain, thickness.
    for (const pl of sh.placements) {
      const inst = byUid.get(pl.uid)
      if (!inst) continue
      const ref = { sheet: sheetNo, partNo: inst.no, partUid: inst.uid }
      if (pl.x < trim - EPS || pl.y < trim - EPS || pl.x + pl.dx > sh.sheetLength - trim + EPS || pl.y + pl.dy > sh.sheetWidth - trim + EPS)
        add({ ...ref, severity: 'error', code: 'OUT_OF_SHEET', message: `Part #${inst.no} lies outside the usable sheet area.` })
      if (Math.abs(inst.thickness - T) > EPS)
        add({ ...ref, severity: 'error', code: 'THICKNESS', message: `Part #${inst.no} is ${inst.thickness} mm thick but sheet is ${T} mm.` })
      const mat = lib.materials.find((m) => m.id === sh.materialId)
      if (mat?.grain && !inst.canRotate && pl.rotated)
        add({ ...ref, severity: 'error', code: 'GRAIN', message: `Grain-locked part #${inst.no} was rotated.` })
      const minSide = Math.min(pl.dx, pl.dy)
      if (minSide < SMALL_PART_MIN_SIDE || pl.dx * pl.dy < SMALL_PART_MIN_AREA)
        add({
          ...ref,
          severity: 'warning',
          code: 'SMALL_PART',
          message: `Part #${inst.no} (${fmt(pl.dx)} x ${fmt(pl.dy)}) is small; vacuum may not hold it. Consider onion-skin or tabs (not yet supported).`,
        })
    }
    const spacing = cutter?.diameter ?? 0
    for (let i = 0; i < sh.placements.length; i++) {
      for (let j = i + 1; j < sh.placements.length; j++) {
        const a = sh.placements[i]
        const b = sh.placements[j]
        const gapX = Math.max(b.x - (a.x + a.dx), a.x - (b.x + b.dx))
        const gapY = Math.max(b.y - (a.y + a.dy), a.y - (b.y + b.dy))
        const boxGap = Math.max(gapX, gapY)
        if (boxGap >= spacing - EPS) continue
        const na = byUid.get(a.uid)?.no
        const nb = byUid.get(b.uid)?.no
        const ia = byUid.get(a.uid)
        const ib = byUid.get(b.uid)
        const shaped = ia && ib && (!isRectInst(ia) || !isRectInst(ib))
        const close = shaped ? shapeClash(regionOf(ia, a), regionOf(ib, b), spacing) : boxGap < -EPS ? 'overlap' : 'close'
        if (close === 'overlap') add({ severity: 'error', code: 'OVERLAP', sheet: sheetNo, partNo: na, message: `Parts #${na} and #${nb} overlap.` })
        else if (close === 'close')
          add({
            severity: 'error',
            code: 'SPACING',
            sheet: sheetNo,
            partNo: na,
            message: shaped
              ? `Parts #${na} and #${nb} are closer than ${fmt(spacing)} mm; the cut-out tool needs that much room.`
              : `Parts #${na} and #${nb} are ${fmt(boxGap)} mm apart; the cut-out tool needs ${fmt(spacing)} mm.`,
          })
      }
    }

    const inSheet = (x: number, y: number) => x >= -EPS && y >= -EPS && x <= sh.sheetLength + EPS && y <= sh.sheetWidth + EPS
    const placementOf = new Map(sh.placements.map((p) => [p.uid, p]))
    const inFootprint = (uid: string, x: number, y: number) => {
      const p = placementOf.get(uid)
      return !!p && x >= p.x - EPS && x <= p.x + p.dx + EPS && y >= p.y - EPS && y <= p.y + p.dy + EPS
    }

    for (const op of prog.ops) {
      const ref = { sheet: sheetNo, partNo: op.partNo, partUid: op.partUid }
      const label = `#${op.partNo} ${op.purpose}`
      switch (op.kind) {
        case 'vdrill': {
          if (!op.tool)
            add({ ...ref, severity: 'error', code: 'TOOL_MISSING', message: `${label}: no vertical drill D${fmt(op.diameter)} reaching ${fmt(op.depth)} mm in the tool table.` })
          if (!inSheet(op.x, op.y) || !inFootprint(op.partUid, op.x, op.y))
            add({ ...ref, severity: 'error', code: 'OP_OUTSIDE', message: `${label}: hole at X${fmt(op.x)} Y${fmt(op.y)} is outside its part.` })
          if (op.through && op.depth > maxZ + EPS)
            add({ ...ref, severity: 'error', code: 'DEPTH', message: `${label}: through hole ${fmt(op.depth)} mm exceeds ${fmt(maxZ)} mm (thickness + spoilboard allowance).` })
          if (!op.through && op.depth >= T - EPS)
            add({ ...ref, severity: 'error', code: 'DEPTH', message: `${label}: blind hole ${fmt(op.depth)} mm would break through ${fmt(T)} mm material.` })
          else if (!op.through && T - op.depth < MIN_REMAINING_FLOOR)
            add({ ...ref, severity: 'warning', code: 'THIN_FLOOR', message: `${label}: only ${fmt(T - op.depth)} mm material left under the hole.` })
          break
        }
        case 'hdrill':
          if (!op.tool)
            add({ ...ref, severity: 'error', code: 'TOOL_MISSING', message: `${label}: no horizontal drill D${fmt(op.diameter)} in the tool table.` })
          break
        case 'pocket': {
          if (!op.tool)
            add({ ...ref, severity: 'error', code: 'TOOL_MISSING', message: `${label}: no router narrow enough for a ${fmt(op.width)} mm groove ${fmt(op.depth)} mm deep.` })
          if (op.depth >= T - EPS)
            add({ ...ref, severity: 'error', code: 'DEPTH', message: `${label}: groove depth ${fmt(op.depth)} mm cuts through ${fmt(T)} mm material.` })
          if (!inSheet(op.x1, op.y1) || !inSheet(op.x2, op.y2))
            add({ ...ref, severity: 'error', code: 'OUT_OF_SHEET', message: `${label}: groove runs outside the sheet.` })
          for (const other of sh.placements) {
            if (other.uid === op.partUid) continue
            if (op.x1 < other.x + other.dx - EPS && op.x2 > other.x + EPS && op.y1 < other.y + other.dy - EPS && op.y2 > other.y + EPS)
              add({
                ...ref,
                severity: 'error',
                code: 'OP_HITS_NEIGHBOUR',
                message: `${label}: groove run-out cuts into part #${byUid.get(other.uid)?.no}.`,
              })
          }
          break
        }
        case 'saw':
          if (!model.capabilities.saw) add({ ...ref, severity: 'error', code: 'MACHINE_CANNOT', message: noSaw(label) })
          if (!op.tool) add({ ...ref, severity: 'error', code: 'TOOL_MISSING', message: `${label}: no saw unit in the tool table.` })
          if (op.depth >= T - EPS)
            add({ ...ref, severity: 'error', code: 'DEPTH', message: `${label}: saw groove ${fmt(op.depth)} mm cuts through ${fmt(T)} mm material.` })
          add({
            ...ref,
            severity: 'warning',
            code: 'SAW_RUNOUT',
            message: `${label}: saw blade run-out on a nested sheet can cut into neighbouring parts. Check in simulation or switch grooves to router pockets.`,
          })
          break
        case 'cam': {
          const it = op.intent
          if (it.k === 'comment') break
          const what = `#${op.partNo} ${it.label}`
          if (!it.tool) add({ ...ref, severity: 'error', code: 'TOOL_MISSING', message: `${what}: no tool resolved for this custom-part operation.` })
          const deepest = it.k === 'contour' ? Math.max(...it.passes.map((p) => p.depth)) : it.k === 'pocket-rect' || it.k === 'saw' ? it.depth : 0
          if (deepest > maxZ + EPS) add({ ...ref, severity: 'error', code: 'DEPTH_SPOILBOARD', message: `${what}: ${fmt(deepest)} mm deep goes past the spoilboard allowance.` })
          else if ((it.k === 'pocket-rect' || it.k === 'saw') && deepest >= T - EPS) add({ ...ref, severity: 'error', code: 'DEPTH', message: `${what}: ${fmt(deepest)} mm cuts through ${fmt(T)} mm material.` })
          if (it.tool && deepest > it.tool.maxDepth + EPS) add({ ...ref, severity: 'error', code: 'DEPTH', message: `${what}: ${fmt(deepest)} mm exceeds T${it.tool.number} max depth ${it.tool.maxDepth} mm.` })
          if (it.k === 'contour') {
            const r = (it.tool?.diameter ?? 0) / 2 + 0.5
            const p = placementOf.get(op.partUid)
            const bx = boxOf([{ segs: it.segs, closed: it.closed }])
            if (p && (bx.minX < p.x - r || bx.minY < p.y - r || bx.maxX > p.x + p.dx + r || bx.maxY > p.y + p.dy + r))
              add({ ...ref, severity: 'error', code: 'OP_OUTSIDE', message: `${what}: path leaves its part and would cut a neighbour.` })
          }
          if (it.k === 'saw' && !model.capabilities.saw) add({ ...ref, severity: 'error', code: 'MACHINE_CANNOT', message: noSaw(what) })
          if (it.k === 'saw')
            add({ ...ref, severity: 'warning', code: 'SAW_RUNOUT', message: `${what}: saw blade run-out on a nested sheet can cut into neighbouring parts. Check in simulation.` })
          break
        }
        case 'contour': {
          if (!op.tool) add({ ...ref, severity: 'error', code: 'TOOL_MISSING', message: `#${op.partNo}: cut-out router missing.` })
          const below = -op.za
          if (below > machine.spoilboardAllowance + EPS)
            add({ ...ref, severity: 'error', code: 'DEPTH_SPOILBOARD', message: `#${op.partNo}: cut-out goes ${fmt(below)} mm into the spoilboard.` })
          if (op.tool && T + below > op.tool.maxDepth + EPS)
            add({ ...ref, severity: 'error', code: 'DEPTH', message: `#${op.partNo}: cut depth exceeds T${op.tool.number} max depth ${op.tool.maxDepth} mm.` })
          if (op.points.some((p) => !inSheet(p.x, p.y)))
            add({ ...ref, severity: 'error', code: 'OUT_OF_SHEET', message: `#${op.partNo}: outline leaves the sheet.` })
          break
        }
      }
    }

    for (const c of prog.custom ?? []) {
      const ref = { sheet: sheetNo, partNo: c.partNo, partUid: c.partUid }
      const name = byUid.get(c.partUid)?.part.name ?? c.partUid
      if (!c.written && c.machiningOps > 0)
        add({
          ...ref,
          severity: 'error',
          code: 'CAM_OUTPUT_OFF',
          message: `Custom part #${c.partNo} ${name}: ${c.machiningOps} machining operation(s) are not written to MPR because custom-part MPR output is off (Machine > Features). Only its cut-out would be cut.`,
        })
      if (c.ops3d)
        add({
          ...ref,
          severity: 'error',
          code: 'CAM_3D_NO_OUTPUT',
          message: `Custom part #${c.partNo} ${name}: ${c.ops3d} 3D operation(s) need true 3D output, which cannot be written to woodWOP yet (it stays off until the format is confirmed with a program from the machine). Only simulate them. Z-level roughing, and waterline without the shallow-area fill, can be written as flat layers.`,
        })
      if (c.flat3d && !c.flat3dWritten) {
        const off = !featuresOf(settings).cam3dMprOutput || !c.written
        add({
          ...ref,
          severity: 'error',
          code: off ? 'CAM_3D_OUTPUT_OFF' : 'CAM_3D_NOT_READY',
          message: off
            ? `Custom part #${c.partNo} ${name}: ${c.flat3d} 3D roughing or waterline operation(s) are not written because 3D flat-layer output is off (Machine > Features).`
            : `Custom part #${c.partNo} ${name}: ${c.flat3dMissing} 3D roughing or waterline toolpath(s) are not calculated yet. Wait for the job page to finish calculating them (batch runs cannot calculate 3D toolpaths yet).`,
        })
      }
      if (c.written) for (const w of c.warnings) add({ ...ref, severity: 'warning', code: 'CAM_TOOLPATH', message: `#${c.partNo} ${w}` })
      if (c.written && c.backHoles > 0)
        add({ ...ref, severity: 'warning', code: 'CAM_BACKSIDE', message: `Custom part #${c.partNo} ${name}: ${c.backHoles} underside hole(s) are in its own turned-over program; run it after cutting the sheet.` })
    }

    if (prog.skipped.length) {
      const parts = [...new Set(prog.skipped.map((s) => s.partNo))].sort((a, b) => a - b)
      add({
        severity: 'warning',
        code: 'HORIZONTAL_SKIPPED',
        sheet: sheetNo,
        message: `${prog.skipped.length} horizontal holes on parts ${parts.map((p) => '#' + p).join(', ')} are not in the program (no horizontal drill unit). Drill them off-machine.`,
      })
    }
  }

  add({
    severity: 'info',
    code: 'SIMULATE',
    message: 'Generated programs are not machine-proven. Open every MPR in woodWOP and run the simulation before cutting.',
  })
  return issues
}

export const countBySeverity = (issues: Issue[]) => ({
  error: issues.filter((i) => i.severity === 'error').length,
  warning: issues.filter((i) => i.severity === 'warning').length,
  info: issues.filter((i) => i.severity === 'info').length,
})

const K = 100

const isRectInst = (i: PartInstance) => {
  if (i.holes?.length) return false
  let a = 0
  const o = i.outline
  for (let k = 0, j = o.length - 1; k < o.length; j = k++) a += (o[j].x + o[k].x) * (o[j].y - o[k].y)
  return o.length < 3 || Math.abs(Math.abs(a / 2) - i.cutLength * i.cutWidth) <= 0.002 * i.cutLength * i.cutWidth
}

/** Part outline less its openings, on the sheet, in 0.01 mm units. */
function regionOf(inst: PartInstance, pl: Placement): Paths64 {
  const { pt } = placementTransform(inst, pl)
  const ring = (pts: { x: number; y: number }[]) => pts.map((p) => pt(p.x, p.y)).map((q) => ({ x: Math.round(q.x * K), y: Math.round(q.y * K) }))
  const outline = inst.outline.length >= 3 ? inst.outline : [{ x: 0, y: 0 }, { x: inst.cutLength, y: 0 }, { x: inst.cutLength, y: inst.cutWidth }, { x: 0, y: inst.cutWidth }]
  const signed = (r: Paths64[number], positive: boolean) => {
    let a = 0
    for (let k = 0, j = r.length - 1; k < r.length; j = k++) a += (r[j].x + r[k].x) * (r[j].y - r[k].y)
    return (a < 0) === positive ? r : [...r].reverse()
  }
  return [signed(ring(outline), true), ...(inst.holes ?? []).map((h) => signed(ring(h), false))]
}

function shapeClash(a: Paths64, b: Paths64, spacing: number): 'overlap' | 'close' | null {
  if (areaPaths(intersect(a, b, FillRule.EvenOdd)) > K * K) return 'overlap'
  const grow = (p: Paths64) => inflatePaths(p, ((spacing - 0.05) / 2) * K, JoinType.Round, EndType.Polygon)
  return areaPaths(intersect(grow(a), grow(b), FillRule.NonZero)) > 1 ? 'close' : null
}
