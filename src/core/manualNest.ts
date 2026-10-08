/**
 * Manual nesting (M2.8, NST-09): parts moved, turned and snapped on a nested sheet by hand, sheets
 * split, the layout saved with the job or as a nest list file and loaded again.
 *
 * A saved layout is applied over the job as it is now: parts still in the job keep their place
 * (their size follows the job), parts gone from the job are reported as missing, and parts not in
 * the layout are nested automatically on extra sheets. Every edited sheet then goes through the
 * same sheet programs and the same export checker as an automatic nest, so a part moved too close,
 * off the sheet or turned against the grain is caught there.
 */
import type { PartInstance } from './cutlist'
import { nestJob, nestSettingsOf, nestSpacing, placementTransform, type JobNest } from './machining'
import { orderForCutting, remnantsOf, type NestedSheet, type Placement } from './nesting'
import { instanceArea } from './areas'
import type { Library, MachineProfile, SavedNest, SavedSheet, ShopSettings, Vec2 } from './types'
import type { CancelCheck } from './cancel'

const r3 = (n: number) => Math.round(n * 1000) / 1000
const EPS = 1e-6

/** Footprint of a part on the sheet for a turn. */
export const footprint = (inst: Pick<PartInstance, 'cutLength' | 'cutWidth'>, rotated: boolean) => (rotated ? { dx: inst.cutWidth, dy: inst.cutLength } : { dx: inst.cutLength, dy: inst.cutWidth })

/** The current nest as a layout to edit or save. */
export function layoutOf(nest: Pick<JobNest, 'sheets'>): SavedSheet[] {
  return nest.sheets.map((s) => ({
    materialId: s.materialId,
    sheetLength: s.sheetLength,
    sheetWidth: s.sheetWidth,
    ...(s.offcutId ? { offcutId: s.offcutId } : {}),
    ...(s.flip ? { flip: { ...s.flip } } : {}),
    placements: s.placements.map((p) => ({ uid: p.uid, x: p.x, y: p.y, rotated: p.rotated, ...(p.flip ? { flip: true } : {}), ...(p.inside ? { inside: p.inside } : {}) })),
  }))
}

export interface ManualInfo {
  savedAt: string
  /** Parts in the layout that are no longer in the job (uid and the label's part id when known). */
  missing: { uid: string; partId?: string }[]
  /** Job parts not in the layout, nested automatically on extra sheets. */
  added: string[]
  /** Parts in the layout on a sheet of another material than the job now gives them. */
  moved: string[]
}

/**
 * The job's nest with a saved layout applied. Sheets with no part left are dropped; new parts are
 * nested automatically after the saved sheets.
 */
export function applySavedNest(saved: SavedNest, instances: PartInstance[], lib: Library, machine: MachineProfile, settings: ShopSettings, isCancelled?: CancelCheck, opts: { underside?: (i: PartInstance) => boolean } = {}): JobNest & { manual: ManualInfo } {
  const byUid = new Map(instances.map((i) => [i.uid, i]))
  const ns = nestSettingsOf(settings)
  const used = new Set<string>()
  const missing: ManualInfo['missing'] = []
  const moved: string[] = []
  const sheets: NestedSheet[] = []
  for (const s of saved.sheets) {
    const placements: Placement[] = []
    let area = 0
    for (const p of s.placements) {
      const inst = byUid.get(p.uid)
      if (!inst || used.has(p.uid)) {
        if (!inst) missing.push({ uid: p.uid })
        continue
      }
      if (inst.materialId !== s.materialId) {
        moved.push(p.uid)
        continue
      }
      used.add(p.uid)
      placements.push({ uid: p.uid, x: r3(p.x), y: r3(p.y), rotated: p.rotated, ...footprint(inst, p.rotated), ...(p.flip ? { flip: true } : {}), ...(p.inside && s.placements.some((q) => q.uid === p.inside) ? { inside: p.inside } : {}) })
      area += instanceArea(inst)
    }
    if (!placements.length) continue
    const mat = lib.materials.find((m) => m.id === s.materialId)
    sheets.push({
      index: sheets.length + 1,
      materialId: s.materialId,
      sheetLength: s.sheetLength,
      sheetWidth: s.sheetWidth,
      thickness: mat?.thickness ?? byUid.get(placements[0].uid)!.thickness,
      placements: orderForCutting(placements),
      utilization: Math.round((area / (s.sheetLength * s.sheetWidth)) * 1000) / 10,
      ...(s.offcutId ? { offcutId: s.offcutId } : {}),
      ...(s.flip ? { flip: { ...s.flip } } : {}),
      manual: true,
      remnants: remnantsOf({ length: s.sheetLength, width: s.sheetWidth }, placements, { spacing: nestSpacing(machine, settings), offcutType: ns.offcutType, offcutMin: { length: ns.offcutMinLength, width: ns.offcutMinWidth } }),
    })
  }
  const rest = instances.filter((i) => !used.has(i.uid))
  const extra = rest.length ? nestJob(rest, lib, machine, settings, isCancelled, opts) : { sheets: [], unplaced: [], spacing: nestSpacing(machine, settings), materials: [] }
  for (const s of extra.sheets) sheets.push({ ...s, index: sheets.length + 1 })
  return {
    sheets,
    unplaced: extra.unplaced,
    spacing: extra.spacing,
    materials: extra.materials,
    manual: { savedAt: saved.savedAt, missing, added: rest.map((i) => i.uid), moved },
  }
}


// ---------------------------------------------------------------------------------------------
// Editing helpers (pure; the editor calls them)
// ---------------------------------------------------------------------------------------------

export interface SnapOptions {
  /** Room kept between parts (the nest spacing). */
  spacing: number
  /** Edge trim of the sheet. */
  trim: number
  /** How close (mm) an edge has to come to snap. */
  reach: number
}

/**
 * Snap a part being moved: its edges to the spacing beside a neighbour, or in line with a
 * neighbour's edge (edge alignment), or to the trim line of the sheet, each direction separately.
 */
export function snapPlacement(p: { x: number; y: number; dx: number; dy: number }, others: Placement[], sheet: { sheetLength: number; sheetWidth: number }, o: SnapOptions) {
  const xs: number[] = [o.trim, sheet.sheetLength - o.trim - p.dx]
  const ys: number[] = [o.trim, sheet.sheetWidth - o.trim - p.dy]
  for (const q of others) {
    xs.push(q.x + q.dx + o.spacing, q.x - o.spacing - p.dx, q.x, q.x + q.dx - p.dx)
    ys.push(q.y + q.dy + o.spacing, q.y - o.spacing - p.dy, q.y, q.y + q.dy - p.dy)
  }
  const pick = (v: number, list: number[]) => {
    let best = v
    let bd = o.reach + EPS
    for (const c of list) {
      const d = Math.abs(c - v)
      if (d < bd) {
        bd = d
        best = c
      }
    }
    return r3(best)
  }
  return { x: pick(p.x, xs), y: pick(p.y, ys) }
}

/** Turn a part a quarter (when it may turn) about its middle. */
export function turnQuarter(p: SavedSheet['placements'][number], inst: PartInstance) {
  const a = footprint(inst, p.rotated)
  const b = footprint(inst, !p.rotated)
  return { ...p, rotated: !p.rotated, x: r3(p.x + (a.dx - b.dx) / 2), y: r3(p.y + (a.dy - b.dy) / 2) }
}

/** Turn a part half round (end for end; the grain still runs the same way). */
export const turnHalf = (p: SavedSheet['placements'][number]) => ({ ...p, flip: !p.flip })

/** The part's outline and openings on the sheet. */
export function regionOnSheet(inst: PartInstance, p: Pick<Placement, 'x' | 'y' | 'rotated' | 'flip'>) {
  const { pt } = placementTransform(inst, p)
  const outline = (inst.outline.length >= 3 ? inst.outline : [{ x: 0, y: 0 }, { x: inst.cutLength, y: 0 }, { x: inst.cutLength, y: inst.cutWidth }, { x: 0, y: inst.cutWidth }]).map((q) => pt(q.x, q.y))
  return { outline, holes: (inst.holes ?? []).map((h) => h.map((q) => pt(q.x, q.y))) }
}

function inside(p: Vec2, poly: Vec2[]) {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c
  }
  return c
}

function segDist(a: Vec2, b: Vec2, c: Vec2, d: Vec2) {
  const cross = (p: Vec2, q: Vec2, s: Vec2) => (q.x - p.x) * (s.y - p.y) - (q.y - p.y) * (s.x - p.x)
  const d1 = cross(a, b, c)
  const d2 = cross(a, b, d)
  const d3 = cross(c, d, a)
  const d4 = cross(c, d, b)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0
  const ps = (p: Vec2, s: Vec2, e: Vec2) => {
    const dx = e.x - s.x
    const dy = e.y - s.y
    const l2 = dx * dx + dy * dy
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - s.x) * dx + (p.y - s.y) * dy) / l2)) : 0
    return Math.hypot(p.x - s.x - t * dx, p.y - s.y - t * dy)
  }
  return Math.min(ps(a, c, d), ps(b, c, d), ps(c, a, b), ps(d, a, b))
}

/** Closest approach of two parts' outlines on the sheet; negative when they overlap, and whether one sits in an opening of the other. */
export function partGap(a: ReturnType<typeof regionOnSheet>, b: ReturnType<typeof regionOnSheet>): { gap: number; inOpening: boolean } {
  let best = Infinity
  for (let i = 0; i < a.outline.length; i++)
    for (let k = 0; k < b.outline.length; k++) best = Math.min(best, segDist(a.outline[i], a.outline[(i + 1) % a.outline.length], b.outline[k], b.outline[(k + 1) % b.outline.length]))
  const aInB = inside(a.outline[0], b.outline)
  const bInA = inside(b.outline[0], a.outline)
  if (aInB || bInA) {
    // inside the other's outline: fine only when it sits in an opening of it
    const [small, big] = aInB ? [a, b] : [b, a]
    const hole = big.holes.find((h) => small.outline.every((q) => inside(q, h)))
    if (!hole) return { gap: -1, inOpening: false }
    for (let i = 0; i < small.outline.length; i++)
      for (let k = 0; k < hole.length; k++) best = Math.min(best, segDist(small.outline[i], small.outline[(i + 1) % small.outline.length], hole[k], hole[(k + 1) % hole.length]))
    return { gap: best, inOpening: true }
  }
  return { gap: best === 0 ? -1 : best, inOpening: false }
}

export type Clash = { uid: string; other?: string; kind: 'overlap' | 'close' | 'spacing' | 'off-sheet' | 'grain' }

/**
 * Live check of an edited sheet: parts overlapping, closer than the cut-out tool (`minGap`), closer
 * than the nest spacing (`spacing`, a warning), outside the trim, or turned against the grain.
 * The export checker runs the full checks once the layout is saved.
 */
export function checkSheet(sheet: Pick<SavedSheet, 'sheetLength' | 'sheetWidth' | 'placements'>, instances: ReadonlyMap<string, PartInstance>, o: { minGap: number; spacing: number; trim: number; grain: boolean }, only?: string): Clash[] {
  const out: Clash[] = []
  const regions = new Map<string, ReturnType<typeof regionOnSheet>>()
  const reg = (p: SavedSheet['placements'][number]) => {
    let r = regions.get(p.uid)
    if (!r) {
      r = regionOnSheet(instances.get(p.uid)!, p)
      regions.set(p.uid, r)
    }
    return r
  }
  const ps = sheet.placements.filter((p) => instances.has(p.uid))
  for (const p of ps) {
    if (only && p.uid !== only) continue
    const inst = instances.get(p.uid)!
    const f = footprint(inst, p.rotated)
    if (p.x < o.trim - 1e-3 || p.y < o.trim - 1e-3 || p.x + f.dx > sheet.sheetLength - o.trim + 1e-3 || p.y + f.dy > sheet.sheetWidth - o.trim + 1e-3) out.push({ uid: p.uid, kind: 'off-sheet' })
    if (o.grain && !inst.canRotate && p.rotated) out.push({ uid: p.uid, kind: 'grain' })
  }
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i]
      const b = ps[j]
      if (only && a.uid !== only && b.uid !== only) continue
      const fa = footprint(instances.get(a.uid)!, a.rotated)
      const fb = footprint(instances.get(b.uid)!, b.rotated)
      const box = Math.max(b.x - (a.x + fa.dx), a.x - (b.x + fb.dx), b.y - (a.y + fa.dy), a.y - (b.y + fb.dy))
      if (box >= o.spacing - 1e-3) continue
      const { gap } = partGap(reg(a), reg(b))
      const kind = gap < 0 ? 'overlap' : gap < o.minGap - 1e-3 ? 'close' : gap < o.spacing - 1e-3 ? 'spacing' : null
      if (kind) out.push({ uid: a.uid, other: b.uid, kind }, { uid: b.uid, other: a.uid, kind })
    }
  return out
}

/** Which part's opening (if any) each part sits in, for the cut order. */
export function openingsOf(sheet: Pick<SavedSheet, 'placements'>, instances: ReadonlyMap<string, PartInstance>) {
  const out = new Map<string, string>()
  const ps = sheet.placements.filter((p) => instances.has(p.uid))
  for (const a of ps) {
    if (!instances.get(a.uid)?.holes?.length) continue
    const ra = regionOnSheet(instances.get(a.uid)!, a)
    for (const b of ps) {
      if (b.uid === a.uid) continue
      const rb = regionOnSheet(instances.get(b.uid)!, b)
      if (ra.holes.some((h) => rb.outline.every((q) => inside(q, h)))) out.set(b.uid, a.uid)
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Nest list files
// ---------------------------------------------------------------------------------------------

export const NEST_LIST_FORMAT = 'cabinet-studio-nest-list'

/** A saved layout as a file: parts by their uid and label part id, materials by code too. */
export function nestListJson(jobNumber: string, saved: SavedNest, instances: PartInstance[], lib: Pick<Library, 'materials'>) {
  const byUid = new Map(instances.map((i) => [i.uid, i]))
  return JSON.stringify(
    {
      format: NEST_LIST_FORMAT,
      version: 1,
      job: jobNumber,
      savedAt: saved.savedAt,
      sheets: saved.sheets.map((s) => ({
        ...s,
        material: lib.materials.find((m) => m.id === s.materialId)?.code ?? s.materialId,
        placements: s.placements.map((p) => ({ ...p, partId: byUid.get(p.uid)?.partId })),
      })),
    },
    null,
    2,
  )
}

/**
 * Read a nest list. Parts are matched by uid, else by label part id; materials by id, else code.
 * Returns the layout and the parts in the list the job does not have.
 */
export function readNestList(text: string, instances: PartInstance[], lib: Pick<Library, 'materials'>): { saved: SavedNest; missing: { uid: string; partId?: string }[] } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('This file is not a nest list (it is not JSON).')
  }
  const d = raw as { format?: string; savedAt?: string; sheets?: (SavedSheet & { material?: string; placements: (SavedSheet['placements'][number] & { partId?: string })[] })[] }
  if (d?.format !== NEST_LIST_FORMAT || !Array.isArray(d.sheets)) throw new Error('This file is not a Cabinet Studio nest list.')
  const byUid = new Map(instances.map((i) => [i.uid, i]))
  const byPartId = new Map(instances.map((i) => [i.partId, i]))
  const missing: { uid: string; partId?: string }[] = []
  const sheets: SavedSheet[] = []
  for (const s of d.sheets) {
    const mat = lib.materials.find((m) => m.id === s.materialId) ?? lib.materials.find((m) => m.code === s.material)
    if (!mat || !(s.sheetLength > 0) || !(s.sheetWidth > 0) || !Array.isArray(s.placements)) throw new Error(`A sheet in the list has an unknown material (${s.material ?? s.materialId}) or no size.`)
    const placements: SavedSheet['placements'] = []
    for (const p of s.placements) {
      const inst = byUid.get(p.uid) ?? (p.partId ? byPartId.get(p.partId) : undefined)
      if (!inst || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        missing.push({ uid: p.uid, ...(p.partId ? { partId: p.partId } : {}) })
        continue
      }
      placements.push({ uid: inst.uid, x: p.x, y: p.y, rotated: !!p.rotated, ...(p.flip ? { flip: true } : {}), ...(p.inside ? { inside: p.inside } : {}) })
    }
    sheets.push({ materialId: mat.id, sheetLength: s.sheetLength, sheetWidth: s.sheetWidth, ...(s.offcutId ? { offcutId: s.offcutId } : {}), ...(s.flip ? { flip: s.flip } : {}), placements })
  }
  return { saved: { savedAt: d.savedAt ?? new Date(0).toISOString(), sheets }, missing }
}
