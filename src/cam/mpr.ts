/**
 * Custom parts -> woodWOP. Intents become native macros through the shared sheet writer, so
 * custom parts and cabinets go through one MPR code path and one export checker.
 */
import type { CamProgramOp, Contour as CutContour, ProgramOp, SheetProgram } from '@/core/machining'
import { cutoutTool } from '@/core/machining'
import { writeSheetMpr } from '@/core/mpr/writer'
import type { HDrillDir, Job, MachineProfile, Vec2 } from '@/core/types'
import { partOutline } from './doc'
import { area, type Contour, reverse, type Seg } from './geom'
import type { Intent, Toolpath } from './toolpath'
import type { CamPart } from './types'

export interface Placement2D {
  pt: (x: number, y: number) => Vec2
  dir: (d: HDrillDir) => HDrillDir
  rotated: boolean
  /** Turn in degrees applied to directional macros; defaults to 90 when `rotated`. */
  angle?: number
}

export const IDENTITY: Placement2D = { pt: (x, y) => ({ x, y }), dir: (d) => d, rotated: false }

const r3 = (n: number) => Math.round(n * 1000) / 1000

export function placeSegs(segs: Seg[], tf: Placement2D): Seg[] {
  const p = (q: { x: number; y: number }) => tf.pt(q.x, q.y)
  return segs.map((s) => (s.k === 'L' ? { k: 'L', a: p(s.a), b: p(s.b) } : { k: 'A', a: p(s.a), b: p(s.b), c: p(s.c), ccw: s.ccw }))
}

/** Move an intent from part coordinates into program (sheet) coordinates. */
export function placeIntent(it: Intent, tf: Placement2D): Intent {
  switch (it.k) {
    case 'contour':
      return { ...it, segs: placeSegs(it.segs, tf) }
    case 'vdrill': {
      const q = tf.pt(it.x, it.y)
      return { ...it, x: q.x, y: q.y }
    }
    case 'hdrill': {
      const q = tf.pt(it.x, it.y)
      return { ...it, x: q.x, y: q.y, dir: tf.dir(it.dir) }
    }
    case 'pocket-rect': {
      const q = tf.pt(it.cx, it.cy)
      return { ...it, cx: q.x, cy: q.y, angle: r3((it.angle + (tf.angle ?? (tf.rotated ? 90 : 0))) % 360) }
    }
    case 'saw': {
      const a = tf.pt(it.xa, it.ya)
      const e = tf.pt(it.xe, it.ye)
      return { ...it, xa: a.x, ya: a.y, xe: e.x, ye: e.y }
    }
    case 'comment':
      return it
  }
}

/** Cut-out contour (native arcs) in machining direction for the machine's contour setting. */
export function cutoutSegs(c: Contour, machine: MachineProfile): Seg[] {
  const cw = machine.contour.direction === 'climb-cw'
  const isCw = area(c) < 0
  return (cw === isCw ? c : reverse(c)).segs
}

export type PartSide = 'front' | 'back'

const isBack = (it: Intent) => it.k === 'vdrill' && !!it.back

export const hasBackSide = (paths: Toolpath[]) => paths.some((tp) => tp.intents.some(isBack))

/** Turned over end for end: face 6 faces up and x runs the other way. */
export function backPlacement(part: { length: number }): Placement2D {
  return { pt: (x, y) => ({ x: r3(part.length - x), y: r3(y) }), dir: (d) => (d === 'XP' ? 'XM' : d === 'XM' ? 'XP' : d), rotated: false }
}

/** Program ops for one part: its intents (outline profile dropped when `withCutout` adds the standard cut-out). */
export function partProgramOps(part: CamPart, paths: Toolpath[], tf: Placement2D, partUid: string, partNo: number, machine: MachineProfile, withCutout: boolean, side: PartSide = 'front'): ProgramOp[] {
  const ops: ProgramOp[] = []
  const outline = partOutline(part)
  const cutouts: CutContour[] = []
  for (const tp of paths) {
    const op = part.ops.find((o) => o.id === tp.opId)
    const isOutlineCut = withCutout && op?.kind === 'profile' && op.levels.through && outline.entity && op.geometry.includes(outline.entity.id)
    for (const it of tp.intents) {
      if (isOutlineCut && it.k === 'contour') continue
      if (isBack(it) !== (side === 'back')) continue
      ops.push({ kind: 'cam', partUid, partNo, opId: tp.opId, purpose: 'custom', intent: placeIntent(it, tf) } satisfies CamProgramOp)
    }
  }
  if (withCutout && side === 'front') {
    const segs = placeSegs(cutoutSegs(outline.contour, machine), tf)
    cutouts.push({
      kind: 'contour',
      partUid,
      partNo,
      opId: `${part.id}-outline`,
      purpose: 'cut-out',
      points: [segs[0].a, ...segs.map((s) => s.b)],
      segs,
      za: -machine.throughDepth,
      tool: cutoutTool(machine) ?? null,
    })
  }
  const order = (o: ProgramOp) => (o.kind === 'cam' ? ({ vdrill: 0, hdrill: 1, comment: 2, 'pocket-rect': 3, saw: 3, contour: 3 } as const)[o.intent.k] : 4)
  return [...ops.map((o, i) => ({ o, i })).sort((a, b) => order(a.o) - order(b.o) || a.i - b.i).map((x) => x.o), ...cutouts]
}

/** Stand-alone program for one custom part (work volume = part size, origin at its lower-left). */
export function writePartMpr(part: CamPart, paths: Toolpath[], machine: MachineProfile, materialCode = 'MATERIAL', opts: { withCutout?: boolean; side?: PartSide; name?: string } = {}): string {
  const uid = part.id
  const side = opts.side ?? 'front'
  const ops = partProgramOps(part, paths, side === 'back' ? backPlacement(part) : IDENTITY, uid, 1, machine, opts.withCutout ?? false, side)
  const base = opts.name ?? partFileName(part)
  const prog: SheetProgram = {
    name: side === 'back' ? `${base}_B` : base,
    sheet: { index: 1, materialId: part.materialId ?? '', sheetLength: part.length, sheetWidth: part.width, thickness: part.thickness, placements: [], utilization: 0 },
    materialCode,
    ops,
    skipped: [],
  }
  const job: Job = { id: uid, number: part.name, name: part.name, customer: '', notes: '', createdAt: part.updatedAt, updatedAt: part.updatedAt, cabinets: [] }
  return writeSheetMpr(prog, { job, machine, mprNumber: 1, mprCount: 1, single: { partName: side === 'back' ? `${part.name} (turned over)` : part.name } })
}

export const partFileName = (part: { name: string }) => part.name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'PART'

/** The part's program, plus a turned-over program when it has underside (face 6) drilling. */
export function writePartPrograms(part: CamPart, paths: Toolpath[], machine: MachineProfile, materialCode = 'MATERIAL', opts: { withCutout?: boolean; name?: string } = {}) {
  const base = opts.name ?? partFileName(part)
  const files = [{ name: `${base}.mpr`, side: 'front' as PartSide, text: writePartMpr(part, paths, machine, materialCode, { ...opts, name: base }) }]
  if (hasBackSide(paths)) files.push({ name: `${base}_B.mpr`, side: 'back', text: writePartMpr(part, paths, machine, materialCode, { ...opts, name: base, side: 'back' }) })
  return files
}
