/**
 * Flip-side sheets (M2.8, NST-07).
 *
 * Parts with underside (face 6) work are nested together on their own sheets. Each such sheet gets
 * two programs:
 *
 *   side 1 (run first): the sheet lies face 6 up, its factory edges against the stops. The program
 *     mills a reference edge (a strip `reference` mm wide off the far end, or the far side) and
 *     drills the underside holes, mirrored.
 *   side 2 (the sheet's normal program): the sheet is turned over (end for end, or over its long
 *     edge) so the milled edge lies against the stop; top work and cut-outs as usual.
 *
 * Registration: the milled edge is cut by the machine, so on side 2 it sits exactly where side 1
 * put it, whatever the real sheet length; the other direction keeps the same factory edge against
 * the stops. Turned end for end, a point at x on side 2 was at (length - reference) - x on side 1
 * (y unchanged); turned over its long edge, y and width instead.
 */
import { generatePart, type Toolpath } from '@/cam/toolpath'
import { placeIntent } from '@/cam/mpr'
import type { PartInstance } from './cutlist'
import { cutoutTool, type CamProgramOp, type Contour, placementTransform, type SheetProgram, type VDrill } from './machining'
import type { NestedSheet } from './nesting'
import type { MachineProfile, Vec2 } from './types'

export type FlipAxis = 'end' | 'side'

export interface FlipInfo {
  axis: FlipAxis
  /** Strip milled off on side 1 to make the reference edge, mm. */
  reference: number
  /** The sheet as it comes (side 1); the nested sheet is `reference` shorter (or narrower). */
  length: number
  width: number
}

const r3 = (n: number) => Math.round(n * 1000) / 1000

/** Side-2 (nest) point -> side-1 point, and back (the same mirror both ways). */
export function flipMap(sheet: Pick<NestedSheet, 'sheetLength' | 'sheetWidth'>, axis: FlipAxis) {
  const toSide1 = (p: Vec2): Vec2 => (axis === 'end' ? { x: r3(sheet.sheetLength - p.x), y: p.y } : { x: p.x, y: r3(sheet.sheetWidth - p.y) })
  return { toSide1, toSide2: toSide1 }
}

/** Toolpaths of custom parts, worked out once per part design. */
const pathsCache = new WeakMap<object, { machine: MachineProfile; paths: Toolpath[] }>()
export function camPaths(inst: PartInstance, machine: MachineProfile): Toolpath[] {
  if (!inst.cam) return []
  const hit = pathsCache.get(inst.cam)
  if (hit && hit.machine === machine) return hit.paths
  const paths = generatePart(inst.cam, machine)
  pathsCache.set(inst.cam, { machine, paths })
  return paths
}

/** Does the part need work on its underside (face 6)? */
export function needsUnderside(inst: PartInstance, machine: MachineProfile) {
  return camPaths(inst, machine).some((tp) => tp.intents.some((it) => it.k === 'vdrill' && it.back))
}

/** Underside holes of every part on a sheet, in side-2 (nest) coordinates. */
export function undersideHoles(sheet: NestedSheet, instances: ReadonlyMap<string, PartInstance>, machine: MachineProfile) {
  const out: (VDrill & { local: Vec2 })[] = []
  for (const pl of sheet.placements) {
    const inst = instances.get(pl.uid)
    if (!inst?.cam) continue
    const { pt, dir, angle } = placementTransform(inst, pl)
    for (const tp of camPaths(inst, machine))
      for (const it of tp.intents) {
        if (it.k !== 'vdrill' || !it.back) continue
        const q = placeIntent(it, { pt, dir, rotated: pl.rotated, angle })
        if (q.k !== 'vdrill') continue
        out.push({ kind: 'vdrill', partUid: inst.uid, partNo: inst.no, opId: tp.opId, purpose: 'custom', x: q.x, y: q.y, diameter: it.d, depth: it.depth, through: it.through, tool: it.tool, local: { x: it.x, y: it.y } })
      }
  }
  return out
}

/** The side-1 program of a flip-side sheet: reference edge, then the underside holes, mirrored. */
export function sideOneProgram(front: SheetProgram, instances: ReadonlyMap<string, PartInstance>, machine: MachineProfile): SheetProgram | null {
  const sh = front.sheet
  const f = sh.flip
  if (!f) return null
  const { toSide1 } = flipMap(sh, f.axis)
  const holes = undersideHoles(sh, instances, machine)
  const cutter = cutoutTool(machine) ?? null
  // the milled reference edge: side 2's x = 0 (end) or y = 0 (side); the tool runs on the strip's side
  const edge: Contour =
    f.axis === 'end'
      ? { kind: 'contour', partUid: '', partNo: 0, opId: 'reference-edge', purpose: 'cut-out', points: [{ x: sh.sheetLength, y: 0 }, { x: sh.sheetLength, y: f.width }], za: -machine.throughDepth, tool: cutter, open: true, rk: 'WRKR', reference: true }
      : { kind: 'contour', partUid: '', partNo: 0, opId: 'reference-edge', purpose: 'cut-out', points: [{ x: f.length, y: sh.sheetWidth }, { x: 0, y: sh.sheetWidth }], za: -machine.throughDepth, tool: cutter, open: true, rk: 'WRKR', reference: true }
  const note: CamProgramOp = {
    kind: 'cam',
    partUid: '',
    partNo: 0,
    opId: 'side-1-note',
    purpose: 'custom',
    intent: {
      k: 'comment',
      stop: false,
      text: `SIDE 1 OF 2 (underside): sheet face 6 up, factory edges against the stops. Mills the reference edge, then ${holes.length} underside hole(s). Then turn the sheet over ${f.axis === 'end' ? 'end for end' : 'over its long edge'} and run ${front.name} with the milled edge against the ${f.axis === 'end' ? 'X' : 'Y'} stop.`,
    },
  }
  const drills = holes
    .map(({ local: _l, ...h }) => ({ ...h, ...toSide1(h) }))
    .sort((a, b) => a.diameter - b.diameter || a.y - b.y || a.x - b.x)
  return {
    name: `${front.name}_side1`,
    sheet: { ...sh, sheetLength: f.length, sheetWidth: f.width, placements: [], remnants: [] },
    materialCode: front.materialCode,
    ops: [note, ...drills, edge],
    skipped: [],
  }
}

/** The comment that opens a flip-side sheet's side-2 program. */
export function sideTwoNote(front: SheetProgram): CamProgramOp {
  const f = front.sheet.flip!
  return {
    kind: 'cam',
    partUid: '',
    partNo: 0,
    opId: 'side-2-note',
    purpose: 'custom',
    intent: { k: 'comment', stop: true, text: `SIDE 2 OF 2: run ${front.name}_side1 first. Turn the sheet over ${f.axis === 'end' ? 'end for end' : 'over its long edge'}; milled edge against the ${f.axis === 'end' ? 'X' : 'Y'} stop.` },
  }
}

/**
 * Registration as the side-1 program has it: each underside hole mapped back onto side 2, against
 * where the part design puts it. Largest error in mm (0 for a sheet with no holes).
 */
export function registrationError(front: SheetProgram, side1: SheetProgram, instances: ReadonlyMap<string, PartInstance>, machine: MachineProfile) {
  const f = front.sheet.flip
  if (!f) return 0
  const { toSide2 } = flipMap(front.sheet, f.axis)
  const want = undersideHoles(front.sheet, instances, machine)
  const got = side1.ops.filter((o): o is VDrill => o.kind === 'vdrill')
  let worst = 0
  for (const w of want) {
    let best = Infinity
    for (const g of got) {
      if (g.partUid !== w.partUid || Math.abs(g.diameter - w.diameter) > 1e-6) continue
      const p = toSide2(g)
      best = Math.min(best, Math.hypot(p.x - w.x, p.y - w.y))
    }
    worst = Math.max(worst, best)
  }
  return want.length && !got.length ? Infinity : worst
}
