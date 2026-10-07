/**
 * Pre-export safety checks on generated sheet programs. These catch obvious mistakes; they are
 * NOT a substitute for simulating every program in woodWOP before it runs on the machine.
 */
import { boxOf, type Seg, toPoints } from '@/cam/geom'
import type { PartInstance } from './cutlist'
import { EPS, fmt } from './geometry'
import { areaPaths, EndType, FillRule, inflatePaths, intersect, JoinType, type Paths64 } from 'clipper2-ts'
import { cutoutTool, placementTransform, type JobNest, type SheetProgram } from './machining'
import type { Placement } from './nesting'
import { machineModelOf } from './machineModel'
import { featuresOf } from './features'
import type { Library, MachineProfile, ShopSettings } from './types'
import { machineUnconfirmed, MODEL_FACT_LABEL, type Unconfirmed, usedUnconfirmed } from './confirm'
import { resolveTool } from '@/cam/ops'
import { pathToRegion, uncutLength } from './sheetCuts'
import { checkSheet } from './manualNest'

export type Severity = 'error' | 'warning' | 'info'

export interface Issue {
  severity: Severity
  code: string
  message: string
  sheet?: number
  partNo?: number
  partUid?: string
  /** Placeholder values behind this issue: each opens the field for the real value (M2.6e). */
  configure?: Unconfirmed[]
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

  const shopItems = machineUnconfirmed(machine)
  if (machine.placeholder)
    add({
      severity: 'warning',
      code: 'PLACEHOLDER_TOOLS',
      message: 'Machine profile uses PLACEHOLDER tool data. Replace it with the real N-200 tool table before running any program.',
      configure: shopItems.filter((u) => u.group === 'Tools' && u.target.kind === 'tool' && u.target.part === 'data'),
    })

  const model = machineModelOf(machine)
  if (model.placeholder)
    add({
      severity: 'warning',
      code: 'MACHINE_PLACEHOLDER',
      message: 'Machine model (table, travel, tool change, spoilboard, saw and aggregate units) is PLACEHOLDER data. Confirm the real N-200 figures on the Machine page.',
      configure: shopItems.filter((u) => u.group === 'Machine model'),
    })
  const noSaw = (what: string) => `${what}: the machine model has no saw unit. Confirm the unit on the Machine page (Saw unit fitted) or use router pockets.`
  const unit = (fact: 'saw' | 'aggregate'): Unconfirmed[] => [{ key: `model:${fact}`, label: MODEL_FACT_LABEL[fact], value: model.capabilities[fact] ? 'fitted' : 'not fitted', group: 'Machine model', target: { kind: 'model', fact } }]

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

  // M2.8 manual nesting: the layout was edited by hand; say what changed since, and hold it to
  // the nest's spacing (closer than the cut-out tool itself is an error below, as for any nest)
  if (nest.manual) {
    const m = nest.manual
    add({ severity: 'info', code: 'NEST_MANUAL', message: `Sheets laid out by hand (saved ${m.savedAt.slice(0, 16).replace('T', ' ')}). Every check below runs on the edited layout.` })
    if (m.missing.length)
      add({ severity: 'warning', code: 'NEST_MISSING', message: `${m.missing.length} part(s) in the saved layout are no longer in the job: ${m.missing.slice(0, 8).map((x) => x.partId ?? x.uid).join(', ')}${m.missing.length > 8 ? ', …' : ''}. Their places are empty; save the layout again to drop them.` })
    if (m.moved.length) add({ severity: 'warning', code: 'NEST_MATERIAL', message: `${m.moved.length} part(s) changed material since the layout was saved; they were nested again on their new material.` })
    if (m.added.length) add({ severity: 'info', code: 'NEST_ADDED', message: `${m.added.length} part(s) are not in the saved layout and were nested automatically after the saved sheets.` })
    for (const sh of nest.sheets) {
      const mat = lib.materials.find((x) => x.id === sh.materialId)
      const seen = new Set<string>()
      for (const c of checkSheet(sh, byUid, { minGap: cutoutTool(machine)?.diameter ?? 0, spacing: nest.spacing, trim: settings.nesting.edgeTrim, grain: !!mat?.grain }))
        if (c.kind === 'spacing' && c.other && !seen.has([c.uid, c.other].sort().join())) {
          seen.add([c.uid, c.other].sort().join())
          add({ severity: 'warning', code: 'NEST_SPACING', sheet: sh.index, partNo: byUid.get(c.uid)?.no, partUid: c.uid, message: `Parts #${byUid.get(c.uid)?.no} and #${byUid.get(c.other)?.no} are closer than the nesting spacing of ${fmt(nest.spacing)} mm (the cut-out tool still fits).` })
        }
    }
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
          if (!model.capabilities.saw) add({ ...ref, severity: 'error', code: 'MACHINE_CANNOT', message: noSaw(label), configure: unit('saw') })
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
          if (it.k === 'saw' && !model.capabilities.saw) add({ ...ref, severity: 'error', code: 'MACHINE_CANNOT', message: noSaw(what), configure: unit('saw') })
          // M2.6: how far the cutter reaches past its path (facing) or the blade past the cut's ends
          // (saw run-out) must stay off every other part on the sheet
          if ((it.k === 'contour' && it.reach) || (it.k === 'saw' && it.runout)) {
            const hit = sh.placements.find((other) => other.uid !== op.partUid && reachHits(it, other))
            if (hit)
              add({
                ...ref,
                severity: 'error',
                code: 'OP_HITS_NEIGHBOUR',
                message: it.k === 'saw' ? `${what}: the saw blade's run-out (${fmt(it.runout!)} mm past each end) cuts into part #${byUid.get(hit.uid)?.no}.` : `${what}: the cutter reaches ${fmt(it.reach!)} mm past its path and cuts into part #${byUid.get(hit.uid)?.no}.`,
              })
          }
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

    // M2.8 shared-line cutting: the tool-centre paths written must stay a tool radius clear of
    // every part on the sheet, and must cut every edge of every part in the plan (checked here on
    // the program's own paths, independently of the planner)
    if (prog.shared) {
      const { plan, written, diameter } = prog.shared
      const r = diameter / 2
      const pct = plan.separateLength > 0 ? Math.round((1 - plan.planLength / plan.separateLength) * 1000) / 10 : 0
      const m = (mm: number) => `${(mm / 1000).toFixed(1)} m`
      add({
        severity: 'info',
        code: 'SHARED_LINES',
        sheet: sheetNo,
        message: `Shared-line cutting: ${plan.parts.length} part(s) cut with ${m(plan.planLength)} of cutting instead of ${m(plan.separateLength)} one by one (${pct} % less)${plan.own.length ? `; ${plan.own.length} part(s) keep their own cut-out` : ''}. ${written ? 'Written as tool-centre paths: simulate in woodWOP.' : 'Not written: the switch "Write shared-line cuts to MPR" is off, so each part gets its own cut-out.'}`,
      })
      if (written) {
        const centre = prog.ops.filter((o): o is Extract<typeof o, { kind: 'contour' }> => o.kind === 'contour' && !!o.centre)
        const outlines = sh.placements.map((pl) => {
          const inst = byUid.get(pl.uid)
          if (!inst) return { pl, ring: [] }
          const { pt } = placementTransform(inst, pl)
          const o = inst.outline.length >= 3 ? inst.outline : [{ x: 0, y: 0 }, { x: inst.cutLength, y: 0 }, { x: inst.cutLength, y: inst.cutWidth }, { x: 0, y: inst.cutWidth }]
          return { pl, ring: o.map((q) => pt(q.x, q.y)) }
        })
        for (const c of centre)
          for (const { pl, ring } of outlines) {
            if (ring.length < 3) continue
            const d = pathToRegion(c.points, ring)
            if (d < r - 0.001)
              add({ severity: 'error', code: 'SHARED_GOUGE', sheet: sheetNo, partNo: byUid.get(pl.uid)?.no, partUid: pl.uid, message: `Shared cut ${c.opId} comes ${fmt(d)} mm from part #${byUid.get(pl.uid)?.no}; the tool centre must stay ${fmt(r)} mm away.` })
          }
        for (const uid of plan.parts) {
          const pl = sh.placements.find((p) => p.uid === uid)
          if (!pl) continue
          const miss = uncutLength(pl, r, centre.map((c) => ({ pts: c.points })))
          if (miss > 0.01)
            add({ severity: 'error', code: 'SHARED_UNCUT', sheet: sheetNo, partNo: byUid.get(uid)?.no, partUid: uid, message: `Part #${byUid.get(uid)?.no}: ${fmt(miss)} mm of its edge is not cut by the shared-line paths.` })
        }
      }
    }

    // M2.8 bridged nesting: every bridge no longer than set and a tool diameter clear of other
    // parts; each group's path never runs into a part; the path encloses exactly its parts and
    // bridges (checked on the program's own paths)
    if (prog.bridges) {
      const { plan, written, diameter, maxLength } = prog.bridges
      const nb = plan.clusters.reduce((n, c) => n + c.bridges.length, 0)
      const linked = plan.clusters.reduce((n, c) => n + c.members.length, 0)
      add({
        severity: 'info',
        code: 'BRIDGES',
        sheet: sheetNo,
        message: `Bridged nesting: ${linked} small part(s) linked into ${plan.clusters.length} group(s) by ${nb} bridge(s), each group cut as one path${plan.alone.length ? `; ${plan.alone.length} small part(s) had no neighbour close enough` : ''}. ${written ? 'Written: break the bridges off after cutting, and simulate in woodWOP.' : 'Not written: the switch "Write bridged groups to MPR" is off, so each part gets its own cut-out.'}`,
      })
      if (written) {
        const placement = new Map(sh.placements.map((p) => [p.uid, p]))
        const no = (u: string) => byUid.get(u)?.no
        for (const cl of plan.clusters)
          for (const b of cl.bridges) {
            // a bridge beside its part (left or right of it) runs along x; above or below, along y
            const pa = placement.get(b.a)!
            const beside = b.x1 <= pa.x + EPS || b.x0 >= pa.x + pa.dx - EPS
            const len = beside ? b.x1 - b.x0 : b.y1 - b.y0
            if (len > maxLength + EPS) add({ severity: 'error', code: 'BRIDGE_LONG', sheet: sheetNo, partNo: no(b.a), message: `Bridge between #${no(b.a)} and #${no(b.b)} is ${fmt(len)} mm long; the longest allowed is ${fmt(maxLength)} mm.` })
            for (const p of sh.placements) {
              if (p.uid === b.a || p.uid === b.b) continue
              const gap = Math.max(p.x - b.x1, b.x0 - (p.x + p.dx), p.y - b.y1, b.y0 - (p.y + p.dy))
              if (gap < diameter - EPS)
                add({ severity: 'error', code: 'BRIDGE_CLOSE', sheet: sheetNo, partNo: no(b.a), message: `Bridge between #${no(b.a)} and #${no(b.b)} is ${fmt(gap)} mm from part #${no(p.uid)}; the tool needs ${fmt(diameter)} mm to pass.` })
            }
          }
        const groupOps = prog.ops.filter((o): o is Extract<typeof o, { kind: 'contour' }> => o.kind === 'contour' && !!o.bridged && !o.skin)
        for (const c of groupOps) {
          for (const p of sh.placements) {
            const box = { x0: p.x + EPS, y0: p.y + EPS, x1: p.x + p.dx - EPS, y1: p.y + p.dy - EPS }
            if (c.points.some((a, i) => i > 0 && segmentHitsBox(c.points[i - 1], a, box)))
              add({ severity: 'error', code: 'BRIDGE_GOUGE', sheet: sheetNo, partNo: no(p.uid), partUid: p.uid, message: `Bridged group path ${c.opId} runs into part #${no(p.uid)}.` })
          }
        }
        for (const [k, cl] of plan.clusters.entries()) {
          const ring = (o: { points: { x: number; y: number }[] }) => {
            let a = 0
            const q = o.points
            for (let i = 1; i < q.length; i++) a += q[i - 1].x * q[i].y - q[i].x * q[i - 1].y
            return Math.abs(a / 2)
          }
          const mine = groupOps.filter((c) => c.opId === `bridged-${k + 1}` || c.opId === `bridged-${k + 1}-hole`)
          const enclosed = mine.reduce((n, c) => n + (c.hole ? -ring(c) : ring(c)), 0)
          const expect = cl.members.reduce((n, u) => n + placement.get(u)!.dx * placement.get(u)!.dy, 0) + cl.bridges.reduce((n, b) => n + (b.x1 - b.x0) * (b.y1 - b.y0), 0)
          if (Math.abs(enclosed - expect) > 1)
            add({ severity: 'error', code: 'BRIDGE_SHAPE', sheet: sheetNo, partNo: no(cl.members[0]), message: `Bridged group ${k + 1}: its path encloses ${fmt(enclosed / 1e6)} m² but its parts and bridges are ${fmt(expect / 1e6)} m².` })
        }
      }
    }

    // M2.8 flip-side sheets: the side-1 program's holes must land on their parts once the sheet is
    // turned over (checked by mapping each hole back, independently of how it was made), and its
    // reference edge must stay off the parts
    if (prog.back) {
      const { program: side1, written } = prog.back
      const f = sh.flip!
      const holes = side1.ops.filter((o): o is Extract<typeof o, { kind: 'vdrill' }> => o.kind === 'vdrill')
      add({
        severity: 'info',
        code: 'FLIP_SHEETS',
        sheet: sheetNo,
        message: `Flip-side sheet: ${holes.length} underside hole(s) on ${new Set(holes.map((h) => h.partUid)).size} part(s). Side 1 (${side1.name}) mills a ${fmt(f.reference)} mm reference strip and drills the underside with the sheet face 6 up; then the sheet is turned over ${f.axis === 'end' ? 'end for end' : 'over its long edge'} for this program. ${written ? 'Both programs are written: run side 1 first, and simulate both in woodWOP.' : 'Not written: the switch "Write flip-side sheet programs" (and custom-part output) is off, so underside holes stay in each part\'s own turned-over program.'}`,
      })
      if (written) {
        const L = sh.sheetLength
        const W = sh.sheetWidth
        const back = (h: { x: number; y: number }) => (f.axis === 'end' ? { x: L - h.x, y: h.y } : { x: h.x, y: W - h.y })
        for (const h of holes) {
          const ref = { sheet: sheetNo, partNo: h.partNo, partUid: h.partUid }
          const label = `#${h.partNo} underside hole`
          if (!h.tool) add({ ...ref, severity: 'error', code: 'TOOL_MISSING', message: `${label}: no vertical drill D${fmt(h.diameter)} reaching ${fmt(h.depth)} mm in the tool table.` })
          if (h.depth > T + machine.spoilboardAllowance + EPS) add({ ...ref, severity: 'error', code: 'DEPTH_SPOILBOARD', message: `${label}: ${fmt(h.depth)} mm goes ${fmt(h.depth - T)} mm into the spoilboard.` })
          const p = back(h)
          if (!inFootprint(h.partUid, p.x, p.y)) add({ ...ref, severity: 'error', code: 'FLIP_OUTSIDE', message: `${label} at X${fmt(h.x)} Y${fmt(h.y)} on side 1 lands outside its part once the sheet is turned over.` })
        }
        for (const c of side1.ops) {
          if (c.kind !== 'contour' || !c.reference) continue
          // the strip the tool removes (one diameter on the strip's side of the line) stays off every part
          const d = c.tool?.diameter ?? 0
          const edge = f.axis === 'end' ? L : W
          const clear = Math.min(...sh.placements.map((p) => (f.axis === 'end' ? L - (p.x + p.dx) : W - (p.y + p.dy))))
          if (c.points.some((q) => Math.abs((f.axis === 'end' ? q.x : q.y) - edge) > EPS) || clear < -EPS)
            add({ severity: 'error', code: 'FLIP_REFERENCE', sheet: sheetNo, message: `Side 1 reference edge is not on the sheet's turned-over edge (${fmt(edge)} mm) or cuts into a part.` })
          if (!c.tool) add({ severity: 'error', code: 'TOOL_MISSING', sheet: sheetNo, message: 'Side 1 reference edge: cut-out router missing.' })
          else if (d <= 0) add({ severity: 'error', code: 'FLIP_REFERENCE', sheet: sheetNo, message: 'Side 1 reference edge: no tool diameter.' })
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
          message: `Custom part #${c.partNo} ${name}: ${c.ops3d} 3D operation(s) need true 3D output, which cannot be written to woodWOP yet (it stays off until the format is confirmed with a program from the machine). Only simulate them. Z-level roughing, waterline without the shallow-area fill, and flat-area finishing on level flats can be written as flat layers.`,
        })
      if (c.adaptiveOps)
        add({
          ...ref,
          severity: 'error',
          code: 'CAM_ADAPTIVE_NO_OUTPUT',
          message: `Custom part #${c.partNo} ${name}: ${c.adaptiveOps} adaptive-clearing operation(s) (pockets or Z-level roughing) cannot be written to woodWOP yet (their entry helixes, lifted moves back and steady width of cut have no contour-milling form that is confirmed). Only simulate them, or use follow-shape or back-and-forth for the program.`,
        })
      if (c.flat3d && !c.flat3dWritten) {
        const off = !featuresOf(settings).cam3dMprOutput || !c.written
        add({
          ...ref,
          severity: 'error',
          code: off ? 'CAM_3D_OUTPUT_OFF' : 'CAM_3D_NOT_READY',
          message: off
            ? `Custom part #${c.partNo} ${name}: ${c.flat3d} 3D roughing, waterline or flat-area operation(s) are not written because 3D flat-layer output is off (Machine > Features).`
            : `Custom part #${c.partNo} ${name}: ${c.flat3dMissing} 3D roughing, waterline or flat-area toolpath(s) are not calculated yet. Wait for the job page to finish calculating them (batch runs cannot calculate 3D toolpaths yet).`,
        })
      }
      if (c.collisions?.length)
        add({
          ...ref,
          severity: 'error',
          code: 'CAM_COLLISION',
          message: `Custom part #${c.partNo} ${name}: the simulation found ${c.collisions.length} collision(s). ${c.collisions.slice(0, 3).join(' ')}${c.collisions.length > 3 ? ` And ${c.collisions.length - 3} more.` : ''} Open Simulate on the part to see each one.`,
        })
      for (const b of c.blocked ?? [])
        add({ ...ref, severity: 'error', code: 'CAM_NO_OUTPUT', message: `Custom part #${c.partNo} ${name}: "${b.name}" cannot be written to woodWOP (${b.reason}). Only simulate it, or switch it off.` })
      if (c.more25d && !c.more25dWritten)
        add({
          ...ref,
          severity: 'error',
          code: 'CAM_25D_OUTPUT_OFF',
          message: `Custom part #${c.partNo} ${name}: ${c.more25d} newer 2.5D operation(s) (facing, chamfers, saw-cut settings, hand-drawn or edited toolpaths) are not written because their output is off (Machine > Features).`,
        })
      if (c.aggregateOps && !model.capabilities.aggregate)
        add({ ...ref, severity: 'error', code: 'MACHINE_CANNOT', message: `Custom part #${c.partNo} ${name}: ${c.aggregateOps} edge-work operation(s) need a rotating aggregate, and the machine model has none. Confirm the unit on the Machine page (Aggregate head fitted) or machine the edge another way.`, configure: unit('aggregate') })
      if (c.sawUnwritten && !model.capabilities.saw) add({ ...ref, severity: 'error', code: 'MACHINE_CANNOT', message: noSaw(`Custom part #${c.partNo} ${name}: ${c.sawUnwritten} saw operation(s)`), configure: unit('saw') })
      if (c.written) for (const w of c.warnings) add({ ...ref, severity: 'warning', code: 'CAM_TOOLPATH', message: `#${c.partNo} ${w}` })
      if (c.written && c.backHoles > 0 && !prog.back?.written)
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

  // M2.6e: every placeholder value this job uses, each with the field where the real value goes
  const toolIds = new Set<string>()
  for (const prog of programs)
    for (const op of prog.ops) {
      const t = op.kind === 'cam' ? ('tool' in op.intent ? op.intent.tool : null) : op.tool
      if (t) toolIds.add(t.id)
    }
  const camParts = [...new Map(instances.filter((i) => i.cam).map((i) => [i.cam!.id, i.cam!])).values()]
  for (const p of camParts) for (const op of p.ops) if (op.enabled && op.toolId) toolIds.add(op.toolId)
  const used = usedUnconfirmed(machine, toolIds, camParts, (op) => (op.toolId ? null : resolveTool(op, machine)))
  if (used.length)
    add({
      severity: 'warning',
      code: 'UNCONFIRMED',
      message: `${used.length} value(s) this job uses are placeholders, not confirmed yet: ${used
        .slice(0, 6)
        .map((u) => `${u.label} (${u.value})`)
        .join('; ')}${used.length > 6 ? `; and ${used.length - 6} more` : ''}. Configure each one, or mark it confirmed if it is right. Confirming does not switch on any output.`,
      configure: used,
    })

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

/** Does the reach of a facing path, or a saw cut's run-out, touch another part's footprint? */
function reachHits(it: { k: 'contour'; segs: Seg[]; closed: boolean; reach?: number } | { k: 'saw'; xa: number; ya: number; xe: number; ye: number; runout?: number }, p: Placement): boolean {
  const box = { x0: p.x + EPS, y0: p.y + EPS, x1: p.x + p.dx - EPS, y1: p.y + p.dy - EPS }
  if (it.k === 'saw') {
    const L = Math.hypot(it.xe - it.xa, it.ye - it.ya)
    const u = L > 1e-9 ? { x: (it.xe - it.xa) / L, y: (it.ye - it.ya) / L } : { x: 0, y: 0 }
    const s = it.runout ?? 0
    return segmentHitsBox({ x: it.xa - u.x * s, y: it.ya - u.y * s }, { x: it.xe + u.x * s, y: it.ye + u.y * s }, box)
  }
  const r = it.reach ?? 0
  const grown = { x0: box.x0 - r, y0: box.y0 - r, x1: box.x1 + r, y1: box.y1 + r }
  const pts = toPoints({ segs: it.segs, closed: it.closed }, 0.01)
  return pts.some((a, i) => (i + 1 < pts.length || it.closed) && segmentHitsBox(a, pts[(i + 1) % pts.length], grown))
}

/** Liang-Barsky: does the segment a-b enter the open box? */
function segmentHitsBox(a: { x: number; y: number }, b: { x: number; y: number }, bx: { x0: number; y0: number; x1: number; y1: number }): boolean {
  if (bx.x1 <= bx.x0 || bx.y1 <= bx.y0) return false
  let t0 = 0
  let t1 = 1
  const dx = b.x - a.x
  const dy = b.y - a.y
  for (const [p, q] of [
    [-dx, a.x - bx.x0],
    [dx, bx.x1 - a.x],
    [-dy, a.y - bx.y0],
    [dy, bx.y1 - a.y],
  ]) {
    if (Math.abs(p) < 1e-12) {
      if (q <= 0) return false
      continue
    }
    const t = q / p
    if (p < 0) t0 = Math.max(t0, t)
    else t1 = Math.min(t1, t)
    if (t0 > t1) return false
  }
  return t1 > t0
}

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

/** A machine's post: the built-in woodWOP writer, a text template, or a script post from a plugin (M2.10b). */
export type PostChoice = import('./types').MachineSetup['post']

/** The N-200 (the main machine, or a machine still described as one) takes woodWOP programs only. */
export const isN200 = (setup: Pick<import('./types').MachineSetup, 'id' | 'profile'>) => setup.id === 'main' || /n-?\s?200/i.test(`${setup.profile.model} ${setup.profile.name}`)

/**
 * M3.3: parts turned on a rotary axis in a job. They are never nested on a sheet or written to
 * woodWOP: the N-200 (and any machine without a rotary axis in its model) refuses them, and the
 * job's export is refused while one is in it. Only a script post for a machine model with that
 * rotary axis may write one (Program dialog, `checkTextPost`).
 */
export function rotaryIssues(job: Pick<import('./types').Job, 'camParts'>, machine: MachineProfile): Issue[] {
  const out: Issue[] = []
  const caps = machineModelOf(machine).capabilities
  for (const cp of job.camParts ?? []) {
    if (!cp.rotary) continue
    const n = cp.ops.filter((o) => o.enabled && o.kind === 'rotary').length
    out.push({
      severity: 'error',
      code: 'CAM_ROTARY',
      message: `Custom part ${cp.name} is turned on a rotary axis${n ? ` (${n} rotary operation(s))` : ''}. ${caps.rotary ? 'Sheet programs cannot hold rotary work' : `The machine model (${machine.model || machine.name}) has no rotary axis`}, so it is not nested and nothing of it is written to woodWOP. Simulate it on the Parts page; only a script post for a machine model with a rotary axis can write it (Program dialog). Take it out of this job to export the sheets.`,
    })
  }
  return out
}

/**
 * M2.10b: may a text post (template or script) write programs of these toolpaths for this machine?
 * Every error blocks writing; previews are always allowed. On top of the export checker's own
 * results for the part on that machine (`issues`, all kept), a text post is refused:
 * - for the N-200 (it takes woodWOP only; nothing goes to it through a script post);
 * - while "Write programs through script posts" is off, or without the plugin's machine-output grant;
 * - for an operation without one tool number (the program would cut with whatever tool is loaded);
 * - for work a G-code style post cannot describe: edge (horizontal) drilling, drilling from the
 *   underside after turning the part, edge work with an aggregate, saw cuts without a saw unit,
 *   anything not on face 1, 3D or rotary / tilted work the machine model does not declare, and
 *   any toolpath that has no confirmed program form.
 */
export function checkTextPost(
  setup: import('./types').MachineSetup,
  opts: { switchOn: boolean; plugin?: import('@/cam/plugin/types').PluginRecord | null; toolpaths: readonly import('@/cam/toolpath').Toolpath[]; issues?: readonly Issue[] },
): Issue[] {
  const out: Issue[] = []
  const err = (code: string, message: string) => out.push({ severity: 'error', code, message })
  const post = setup.post
  if (post.kind === 'woodwop-mpr') return [...(opts.issues ?? [])]
  if (isN200(setup)) err('POST_N200', `${setup.name} is the N-200 (or still described as one): it takes woodWOP programs only. Template and script posts are for other machines; give this machine its own model name first.`)
  if (!opts.switchOn) err('POST_OUTPUT_OFF', '"Write programs through script posts" is off (Machine page): programs are shown, not written.')
  if (post.kind === 'script') {
    const p = opts.plugin
    if (!p) err('POST_PLUGIN_MISSING', `The plugin "${post.plugin}" for this post is not installed.`)
    else if (!p.enabled) err('POST_PLUGIN_OFF', `The plugin ${p.manifest.name} is switched off.`)
    else if (!p.grants.machineOutput) err('POST_NO_GRANT', `The plugin ${p.manifest.name} has not been granted machine output (Settings → Plugins).`)
    else if (!p.contributes?.posts.some((x) => x.id === post.post)) err('POST_MISSING', `The plugin ${p.manifest.name} has no post "${post.post}".`)
  }
  const caps = machineModelOf(setup.profile).capabilities
  for (const tp of opts.toolpaths) {
    const what = (why: string) => err('POST_UNSUPPORTED', `${tp.name}: ${why}`)
    if (tp.noOutput) what(tp.noOutput)
    // a text post changes tools per operation: without one tool the machine would cut with whatever is in the spindle
    if (!tp.tool) what('has no single tool from the tool table (for example holes drilled by diameter); a text post needs one tool number per operation.')
    if (tp.intents.some((i) => i.k === 'hdrill')) what('edge (horizontal) drilling cannot be written by a text post.')
    if (tp.intents.some((i) => i.k === 'vdrill' && i.back)) what('drilling from the underside (part turned over) cannot be written by a text post.')
    if (tp.kind === 'edge' || tp.edge) what('edge work with an aggregate cannot be written by a text post.')
    if (tp.kind === 'saw' && !caps.saw) what(`${setup.name} has no saw unit in its machine model.`)
    if ((tp.kind === 'finish3d' || tp.kind === 'rough3d') && !caps.mill3d) what(`${setup.name} does not declare 3D milling in its machine model.`)
  }
  for (const i of opts.issues ?? []) out.push(i)
  return out
}
