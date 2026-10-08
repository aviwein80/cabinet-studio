/**
 * Document helpers: factories, entity geometry, outline, undo/redo history and input hashing
 * for associative operations.
 */
import { nanoid } from 'nanoid'
import { strokeText } from './font'
import { area, boxOf, circle, type Contour, fitPoints, type P, pointInContour, polyline, pt, rect, toPoints, transform, type Mat } from './geom'
import { normaliseWinding } from './kernel'
import { aggregateOf, effectiveGauge, effectiveHolder } from '@/core/machineModel'
import type { MachineProfile, Tool } from '@/core/types'
import type { CamOp, CamPart, Entity, FaceId, Geom, Layer } from './types'

/**
 * Part document version. 2 (Stage 2): optional 3D models (`models`) and `workVolume`.
 * 3 (M2.5): solid models (`kind: 'solid'`, face colours and layers), shapes made from solid faces
 * (`Entity.solid`) and the placement turn (`ModelPlacement.frame`). An older app refuses a v3 part
 * instead of reading a solid as a mesh.
 * 4 (M2.6): new operation kinds (facing, chamfer, curve cuts, hand-drawn toolpaths, edge work with
 * an aggregate), saw-cut settings and toolpath edits. An older app refuses a v4 part instead of
 * leaving those operations out without a word.
 * 5 (M3.1): more 3D finishing strategies (radial, spiral and the rest of M3.1) and their settings.
 * An older app refuses a v5 part instead of machining a new strategy as parallel passes.
 * 6 (M3.1g): undercut roughing (`rough3d` with pattern 'undercut'). An older app refuses a v6 part
 * instead of roughing from above with a lollipop.
 * 7 (M3.2): thread milling, hatching and detail views, layer line types, stroke fonts on texts,
 * rapid surfaces. An older app refuses a v7 part instead of leaving them out without a word.
 * 8 (M3.3): rotary set-ups (`rotary`: axis, blank, wrapped planes) and rotary operations. An older
 * app refuses a v8 part instead of nesting a turned part on a sheet or dropping its operations.
 * 9 (M3.4): tilted work planes (`tilted`) and operations on them (`tiltedPlane`). An older app
 * refuses a v9 part instead of cutting a tilted plane's shapes straight down on face 1.
 * 10 (M3.5): simultaneous 5-axis operations (`multiaxis`) and barrel / form tools on operations'
 * tool data. An older app refuses a v10 part instead of dropping its 5-axis operations.
 * 11 (M3.6): clamps, pods and rails on the part (`fixtures`). An older app refuses a v11 part
 * instead of checking its toolpaths without the fixtures they must keep clear of.
 */
export const CAM_FILE_VERSION = 11

export const DEFAULT_LAYERS: Layer[] = [
  { id: 'outline', name: 'Outline', color: '#e2e8f0', visible: true, locked: false },
  { id: 'machining', name: 'Machining', color: '#38bdf8', visible: true, locked: false },
  { id: 'holes', name: 'Holes', color: '#f59e0b', visible: true, locked: false },
  { id: 'text', name: 'Text', color: '#a78bfa', visible: true, locked: false },
  { id: 'construction', name: 'Construction', color: '#64748b', visible: true, locked: false, construction: true },
]

export function newPart(fields: Partial<CamPart> = {}): CamPart {
  const length = fields.length ?? 600
  const width = fields.width ?? 400
  const part: CamPart = {
    id: nanoid(10),
    name: 'Custom part',
    version: CAM_FILE_VERSION,
    materialId: null,
    length,
    width,
    thickness: 19,
    grain: 'none',
    qty: 1,
    layers: DEFAULT_LAYERS.map((l) => ({ ...l })),
    entities: [],
    ops: [],
    variables: [],
    updatedAt: new Date().toISOString(),
    ...fields,
  }
  if (!fields.entities) {
    const e = makeEntity({ t: 'contour', c: rect(0, 0, length, width) }, 'outline')
    part.entities = [e]
    part.outlineId = e.id
  }
  return part
}

export function makeEntity(g: Geom, layer = 'outline', face: FaceId = 1, extra: Partial<Entity> = {}): Entity {
  return { id: nanoid(8), layer, g, face, ...extra }
}

/** Uniform cubic B-spline (clamped) or Catmull-Rom through the points, sampled densely. */
export function splinePoints(ctrl: P[], closed: boolean, through = false, perSpan = 24): P[] {
  if (ctrl.length < 2) return [...ctrl]
  const out: P[] = []
  if (through) {
    const pts = closed ? [ctrl[ctrl.length - 1], ...ctrl, ctrl[0], ctrl[1]] : [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]]
    for (let i = 1; i + 2 < pts.length; i++) {
      const [p0, p1, p2, p3] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]]
      for (let k = 0; k < perSpan; k++) {
        const t = k / perSpan
        const t2 = t * t
        const t3 = t2 * t
        const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
        out.push(pt(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y)))
      }
    }
    out.push(closed ? ctrl[0] : ctrl[ctrl.length - 1])
    return out
  }
  const pts = closed ? [...ctrl, ctrl[0], ctrl[1], ctrl[2 % ctrl.length]] : [ctrl[0], ctrl[0], ...ctrl, ctrl[ctrl.length - 1], ctrl[ctrl.length - 1]]
  for (let i = 0; i + 3 < pts.length; i++) {
    const [p0, p1, p2, p3] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]]
    for (let k = 0; k < perSpan; k++) {
      const t = k / perSpan
      const b0 = (1 - t) ** 3 / 6
      const b1 = (3 * t ** 3 - 6 * t ** 2 + 4) / 6
      const b2 = (-3 * t ** 3 + 3 * t ** 2 + 3 * t + 1) / 6
      const b3 = t ** 3 / 6
      out.push(pt(b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x, b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y))
    }
  }
  if (!closed) out.push(ctrl[ctrl.length - 1])
  return out
}

/** Spline converted to lines and arcs. */
export function splineToContour(ctrl: P[], closed: boolean, through = false, tol = 0.02): Contour {
  const pts = splinePoints(ctrl, closed, through, 48)
  return { segs: fitPoints(pts, closed, tol), closed }
}

/** Machinable 2D contours of an entity on its face. */
export function entityContours(e: Entity): Contour[] {
  const g = e.g
  switch (g.t) {
    case 'contour':
      return [g.c]
    case 'circle':
      return [circle(g.c, g.r)]
    case 'text':
      return strokeText(g.text, g.at, g.height, g.angle, g.spacing ?? 1, g.arc, g.font)
    case 'spline':
      return [splineToContour(g.ctrl, g.closed, g.through)]
    case 'poly3d':
      return [polyline(g.pts.map(([x, y]) => pt(x, y)), false)]
    case 'point':
      return []
  }
}

export function transformEntity(e: Entity, m: Mat): Entity {
  const g = e.g
  const ap = (p: P) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] })
  const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
  switch (g.t) {
    case 'contour':
      return { ...e, g: { t: 'contour', c: transform(g.c, m) } }
    case 'circle': {
      const uniform = Math.abs(Math.hypot(m[0], m[1]) - Math.hypot(m[2], m[3])) < 1e-9
      if (uniform) return { ...e, g: { t: 'circle', c: ap(g.c), r: g.r * scale } }
      return { ...e, g: { t: 'contour', c: transform(circle(g.c, g.r), m) } }
    }
    case 'point':
      return { ...e, g: { t: 'point', p: ap(g.p) } }
    case 'text': {
      const dir = ap(pt(g.at.x + Math.cos(g.angle), g.at.y + Math.sin(g.angle)))
      const at = ap(g.at)
      return { ...e, g: { ...g, at, angle: Math.atan2(dir.y - at.y, dir.x - at.x), height: g.height * scale, arc: g.arc ? { c: ap(g.arc.c), r: g.arc.r * scale } : undefined } }
    }
    case 'spline':
      return { ...e, g: { ...g, ctrl: g.ctrl.map(ap) } }
    case 'poly3d':
      return { ...e, g: { t: 'poly3d', pts: g.pts.map(([x, y, z]) => [ap(pt(x, y)).x, ap(pt(x, y)).y, z]) } }
  }
}

export function layerOf(part: CamPart, id: string) {
  return part.layers.find((l) => l.id === id)
}

/** The cut-out outline: `outlineId` if it is a closed contour, else the largest closed contour on face 1. */
export function partOutline(part: CamPart): { entity: Entity | null; contour: Contour } {
  const byId = part.outlineId ? part.entities.find((e) => e.id === part.outlineId) : undefined
  const closedOf = (e: Entity) => entityContours(e).find((c) => c.closed)
  if (byId && closedOf(byId)) return { entity: byId, contour: closedOf(byId)! }
  let best: { entity: Entity; contour: Contour; a: number } | null = null
  for (const e of part.entities) {
    if (e.face !== 1 || layerOf(part, e.layer)?.construction) continue
    for (const c of entityContours(e))
      if (c.closed) {
        const a = Math.abs(area(c))
        if (!best || a > best.a) best = { entity: e, contour: c, a }
      }
  }
  return best ? { entity: best.entity, contour: best.contour } : { entity: null, contour: rect(0, 0, part.length, part.width) }
}

/**
 * Openings cut right through the part (through profiles on the inside or on the line of a
 * closed shape inside the outline). Other parts may nest in them; the slug is waste.
 */
export function partApertures(part: CamPart): Contour[] {
  const outline = partOutline(part)
  const outer = Math.abs(area(outline.contour))
  const out: Contour[] = []
  const seen = new Set<string>()
  for (const op of part.ops) {
    if (op.kind !== 'profile' || !op.levels.through || op.side === 'outside') continue
    for (const id of op.geometry) {
      if (id === outline.entity?.id || seen.has(id)) continue
      const e = part.entities.find((x) => x.id === id)
      if (!e || e.face !== 1) continue
      seen.add(id)
      for (const c of entityContours(e)) {
        const a = Math.abs(area(c))
        if (c.closed && a > 1 && a < outer && pointInContour(outline.contour, c.segs[0].a)) out.push(c)
      }
    }
  }
  return out
}

/** Fit the work volume to the outline and move everything so the outline starts at (0, 0). */
/**
 * Polish-1: closed shapes on the pocket's face that lie inside it (inside a picked boundary, not in
 * a picked island) and that no operation uses: shapes drawn as islands but not picked. Shapes an
 * operation uses (holes to drill, cut-outs) and construction shapes are left out.
 */
export function enclosedShapes(op: Pick<CamOp, 'geometry' | 'face'>, part: CamPart): { e: Entity; c: Contour }[] {
  const picked = normaliseWinding(
    op.geometry
      .map((id) => part.entities.find((e) => e.id === id))
      .filter((e): e is Entity => !!e && !layerOf(part, e.layer)?.construction)
      .flatMap((e) => entityContours(e).filter((c) => c.closed)),
  )
  const outers = picked.filter((c) => area(c) > 0)
  const holes = picked.filter((c) => area(c) < 0)
  if (!outers.length) return []
  const used = new Set(part.ops.flatMap((o) => o.geometry))
  const outline = partOutline(part).entity?.id
  const out: { e: Entity; c: Contour }[] = []
  for (const e of part.entities) {
    if (used.has(e.id) || e.id === outline || e.face !== op.face || layerOf(part, e.layer)?.construction) continue
    for (const c of entityContours(e)) {
      if (!c.closed) continue
      const pts = toPoints(c, 0.5)
      if (outers.some((o) => pts.every((q) => pointInContour(o, q))) && !holes.some((h) => pts.some((q) => pointInContour(h, q)))) out.push({ e, c })
    }
  }
  return out
}

/**
 * Polish-1: the cut-outs that free the part (an enabled profile through the panel along its
 * outline, on face 1) while operations after them in the list still machine it. Drilling is left
 * out: it is always written first, whatever the list order.
 */
/** Polish-1: an operation that cuts the part free: a through profile on its outline, face 1. */
export function isCutOut(part: CamPart, o: CamOp) {
  const outline = partOutline(part).entity?.id
  return !!outline && o.enabled && o.kind === 'profile' && o.face === 1 && !o.tiltedPlane && o.geometry.includes(outline) && (o.levels.through || o.levels.depth >= part.thickness - 1e-9)
}

export function cutFreeEarly(part: CamPart): { cut: CamOp; after: CamOp[] }[] {
  const outline = partOutline(part).entity?.id
  if (!outline) return []
  const isCut = (o: CamOp) => isCutOut(part, o)
  const out: { cut: CamOp; after: CamOp[] }[] = []
  part.ops.forEach((o, i) => {
    if (!isCut(o)) return
    const after = part.ops.slice(i + 1).filter((x) => x.enabled && x.kind !== 'drill' && x.kind !== 'code' && !isCut(x))
    if (after.length) out.push({ cut: o, after })
  })
  return out
}

/**
 * Polish-2: where a new operation goes: inside work before the part's cut-out (the cut-out stays
 * last, so the part is not cut free first), a cut-out (or anything on a part without one) at the end.
 */
export function withNewOp(part: CamPart, ...ops: CamOp[]): CamOp[] {
  let out = part.ops
  for (const op of ops) {
    const at = isCutOut(part, op) ? -1 : out.findIndex((o) => isCutOut(part, o))
    out = at < 0 ? [...out, op] : [...out.slice(0, at), op, ...out.slice(at)]
  }
  return out
}

/** Polish-1: the same operations with the cut-outs of `cutFreeEarly` moved to the end, in their order. */
export function moveCutOutsLast(part: CamPart): CamOp[] {
  const early = new Set(cutFreeEarly(part).map((e) => e.cut.id))
  return [...part.ops.filter((o) => !early.has(o.id)), ...part.ops.filter((o) => early.has(o.id))]
}

/**
 * Polish-1: change a part's length or width. While its outline is still the plain rectangle the
 * size draws (corner at 0, 0, exactly the old length by the old width, four straight sides), the
 * rectangle follows the new size (same shape id, so operations on it keep it). Any other outline
 * is the user's drawing and is left as drawn.
 */
export function resizePart(part: CamPart, size: { length?: number; width?: number }): CamPart {
  const length = size.length ?? part.length
  const width = size.width ?? part.width
  const next = { ...part, length, width }
  const { entity } = partOutline(part)
  if (!entity || entity.id !== part.outlineId || entity.g.t !== 'contour') return next
  const c = entity.g.c
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-6
  const corners = c.segs.map((s) => s.a)
  const want = [pt(0, 0), pt(part.length, 0), pt(part.length, part.width), pt(0, part.width)]
  const plain = c.closed && c.segs.length === 4 && c.segs.every((s) => s.k === 'L') && corners.every((q, i) => close(q.x, want[i].x) && close(q.y, want[i].y))
  if (!plain) return next
  return { ...next, entities: part.entities.map((e) => (e.id === entity.id ? { ...e, g: { t: 'contour', c: rect(0, 0, length, width) } } : e)) }
}

export function fitWorkVolume(part: CamPart): CamPart {
  const { contour } = partOutline(part)
  const b = boxOf([contour])
  if (!Number.isFinite(b.minX)) return part
  const m: Mat = [1, 0, 0, 1, -b.minX, -b.minY]
  const moved = Math.abs(b.minX) > 1e-9 || Math.abs(b.minY) > 1e-9
  return {
    ...part,
    length: Math.round((b.maxX - b.minX) * 1000) / 1000,
    width: Math.round((b.maxY - b.minY) * 1000) / 1000,
    entities: moved ? part.entities.map((e) => (e.face === 1 ? transformEntity(e, m) : e)) : part.entities,
  }
}

// ---------------------------------------------------------------------------------------------
// Undo / redo
// ---------------------------------------------------------------------------------------------

export interface History<T> {
  past: T[]
  present: T
  future: T[]
}
export const LIMIT = 200
export const historyOf = <T>(present: T): History<T> => ({ past: [], present, future: [] })
export function commit<T>(h: History<T>, next: T): History<T> {
  if (next === h.present) return h
  return { past: [...h.past, h.present].slice(-LIMIT), present: next, future: [] }
}
export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }
}
export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }
}

// ---------------------------------------------------------------------------------------------
// File format
// ---------------------------------------------------------------------------------------------

export function serializePart(part: CamPart): string {
  return JSON.stringify({ format: 'cabinet-studio-part', version: CAM_FILE_VERSION, part }, null, 1)
}
/**
 * Step-by-step upgrades of a stored part, one per version. Each takes the part as stored in the
 * older version and returns it in the next one. Nothing a v1 part holds changes meaning in v2.
 */
const MIGRATIONS: Record<number, (p: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 -> v2: 3D models and the fitted work volume are new optional fields.
  1: (p) => ({ ...p, version: 2 }),
  // v2 -> v3: solids, solid-face shapes and the placement turn are new optional fields.
  2: (p) => ({ ...p, version: 3 }),
  // v3 -> v4: new operation kinds, saw settings and toolpath edits are new and optional.
  3: (p) => ({ ...p, version: 4 }),
  // v4 -> v5: new finishing strategies and their settings are new and optional.
  4: (p) => ({ ...p, version: 5 }),
  // v5 -> v6: the undercut roughing pattern is new.
  5: (p) => ({ ...p, version: 6 }),
  // v6 -> v7: thread milling, annotations, line types, stroke fonts and rapid surfaces are new and optional.
  6: (p) => ({ ...p, version: 7 }),
  // v7 -> v8: the rotary set-up and rotary operations are new and optional.
  7: (p) => ({ ...p, version: 8 }),
  // v8 -> v9: tilted work planes and operations on them are new and optional.
  8: (p) => ({ ...p, version: 9 }),
  // v9 -> v10: 5-axis operations are new and optional.
  9: (p) => ({ ...p, version: 10 }),
  // v10 -> v11: fixtures (clamps, pods, rails) are new and optional.
  10: (p) => ({ ...p, version: 11 }),
}

/** Bring a part stored by any earlier version up to `CAM_FILE_VERSION`. */
export function migratePart<T extends { version?: number }>(stored: T): CamPart {
  let p = stored as unknown as Record<string, unknown>
  let v = typeof p.version === 'number' ? p.version : 1
  if (v > CAM_FILE_VERSION) throw new Error(`Part version ${v} is newer than this app.`)
  while (v < CAM_FILE_VERSION) p = MIGRATIONS[v++](p)
  return p as unknown as CamPart
}

export function parsePart(text: string): CamPart {
  const raw = JSON.parse(text)
  if (raw?.format !== 'cabinet-studio-part' || !raw.part) throw new Error('Not a Cabinet Studio part file.')
  if (raw.version > CAM_FILE_VERSION) throw new Error(`Part file version ${raw.version} is newer than this app.`)
  const p = migratePart(raw.part as CamPart)
  return { ...newPart({ entities: [] }), ...p, layers: p.layers?.length ? p.layers : DEFAULT_LAYERS.map((l) => ({ ...l })) }
}

// ---------------------------------------------------------------------------------------------
// Associativity: hash of everything an op's toolpath depends on
// ---------------------------------------------------------------------------------------------

export function fnv(s: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/**
 * Machine settings a toolpath reads besides its tool: through depth and the material feed table
 * (and the tool table, for rest machining from operations that pick their tool automatically).
 */
export type OpMachineInputs = Pick<MachineProfile, 'throughDepth' | 'feeds'> & Partial<Pick<MachineProfile, 'tools' | 'holders' | 'defaultHolderId' | 'aggregates'>>

/** Milling operations whose toolpaths count as removed material for 2D rest machining. */
export const REST_SOURCE_KINDS: ReadonlySet<CamOp['kind']> = new Set(['profile', 'pocket', 'engrave', 'vcarve', 'sweep'])

/** For 3D rest machining, 3D operations count as well. */
export const REST_SOURCE_KINDS_3D: ReadonlySet<CamOp['kind']> = new Set([...REST_SOURCE_KINDS, 'finish3d', 'rough3d'])

/**
 * The operations a rest pocket (or a 3D finishing with rest machining) counts as already machined:
 * the picked ones, or every earlier one.
 */
export function restSources(op: CamOp, part: CamPart): CamOp[] {
  const rest = op.kind === 'pocket' ? op.rest : op.kind === 'finish3d' && op.strategy !== 'projection' ? op.rest : undefined
  if (!rest) return []
  const kinds = op.kind === 'pocket' ? REST_SOURCE_KINDS : REST_SOURCE_KINDS_3D
  const i = part.ops.findIndex((o) => o.id === op.id)
  const earlier = (i < 0 ? part.ops : part.ops.slice(0, i)).filter((o) => o.enabled && o.face === 1 && kinds.has(o.kind))
  return rest.from.length ? earlier.filter((o) => rest.from.includes(o.id)) : earlier
}

/** Operations that re-set the stock top do not move these: 3D operations follow their model, notes have no depth. */
const TOP_FIXED: ReadonlySet<CamOp['kind']> = new Set(['finish3d', 'rough3d', 'code', 'face'])

/**
 * How far the stock top is below face 1 when `op` runs: the depth of every enabled facing on face
 * 1 before it that re-sets the stock top (2D-16). 0 for operations it does not move (3D, edges,
 * underside, notes, facing itself).
 */
export function stockTopShift(op: CamOp, part: CamPart): number {
  if (op.face !== 1 || TOP_FIXED.has(op.kind)) return 0
  const i = part.ops.findIndex((o) => o.id === op.id)
  let shift = 0
  for (const o of i < 0 ? part.ops : part.ops.slice(0, i)) if (o.kind === 'face' && o.enabled && o.face === 1 && o.resetTop) shift += Math.max(0, o.levels.depth)
  return shift
}

/**
 * The earlier operation (enabled, on face 1) whose toolpath a curve-driven finishing follows, or
 * null. Only an earlier one, so operations can never follow each other round in a circle.
 */
export function driveSource(op: CamOp, part: CamPart): CamOp | null {
  if (op.kind !== 'finish3d' || op.strategy !== 'curve' || op.drive?.mode !== 'toolpath' || !op.drive.opId) return null
  const id = op.drive.opId
  const i = part.ops.findIndex((o) => o.id === op.id)
  return (i < 0 ? part.ops : part.ops.slice(0, i)).find((o) => o.id === id && o.enabled && o.face === 1 && o.kind !== 'code') ?? null
}

/**
 * The 3D models an op's toolpath needs: its own, those of the earlier operations its rest
 * machining or its drive follows, and the surface whose rows and columns it follows.
 */
export function modelsFor(op: CamOp, part: CamPart): string[] {
  // rotary: its model, or every shown model when none is picked
  if (op.kind === 'rotary') return op.strategy === 'wrap' && !op.onModel ? [] : (part.models ?? []).filter((m) => (op.modelId ? m.id === op.modelId : m.visible !== false)).map((m) => m.id)
  if (op.kind === 'multiaxis') return op.modelId ? [op.modelId] : []
  const own = [op, ...restSources(op, part)].flatMap((o) => (o.kind === 'finish3d' || o.kind === 'rough3d' ? [o.surface.modelId] : []))
  const surface = op.kind === 'finish3d' && op.strategy === 'curve' && op.drive?.mode === 'parameter' && op.drive.modelId ? [op.drive.modelId] : []
  const src = driveSource(op, part)
  return [...new Set([...own, ...surface, ...(src ? modelsFor(src, part) : [])])]
}

/**
 * Hash of everything an op's toolpath depends on: its parameters, the picked geometry, the tool,
 * the part thickness and, when `machine` is given, the through depth and the feed-table row for
 * this tool in the part's material. Changing any of them marks the op stale.
 */
export function opInputHash(op: CamOp, part: CamPart, tool: unknown, machine?: OpMachineInputs): string {
  // (confirming a value changes nothing the toolpath reads)
  const { builtHash: _b, name: _n, note: _note, confirmed: _c, toolData: _t, ...params } = op
  const geo = op.geometry.map((id) => part.entities.find((e) => e.id === id) ?? id)
  const deps: unknown[] = [params, geo, tool, part.thickness]
  // Polish-1: unpicked closed shapes inside a pocket (islands, or a warning); only when there are any
  if (op.kind === 'pocket' && op.islands) {
    const enclosed = enclosedShapes(op, part).map((x) => x.e)
    if (enclosed.length) deps.push({ enclosed })
  }
  // a facing before it re-set the stock top
  const top = stockTopShift(op, part)
  if (top) deps.push({ top })
  // shapes made from solid faces: the solid's current data (a new version marks the op stale)
  const solids = geo.flatMap((e) => (typeof e === 'object' && e.solid ? [part.models?.find((m) => m.id === e.solid!.modelId)?.blob ?? null] : []))
  if (solids.length) deps.push({ solids })
  // 3D ops: the model's data (by hash, never the mesh itself) and where it sits
  if (op.kind === 'finish3d' || op.kind === 'rough3d') {
    const m = part.models?.find((x) => x.id === op.surface.modelId)
    deps.push(m ? { blob: m.blob, place: m.place } : null)
  }
  // rotary: the set-up (axis, blank, the plane used) and the models it machines
  if (op.kind === 'rotary') {
    const r = part.rotary
    deps.push(r ? { axis: r.axis, centre: r.centre, blank: r.blank, plane: r.planes.find((p) => p.id === op.planeId) ?? null } : null)
    deps.push({ models: modelsFor(op, part).map((id) => part.models?.find((m) => m.id === id)).map((m) => (m ? { blob: m.blob, place: m.place } : null)) })
  }
  // a tilted work plane (3+2): where it is and how it is turned
  if (op.tiltedPlane) deps.push({ tilted: part.tilted?.find((p) => p.id === op.tiltedPlane) ?? null })
  // 5-axis: the model (by hash and placement), the top curves (swarf) and the guide curve
  if (op.kind === 'multiaxis') {
    const m = op.modelId ? part.models?.find((x) => x.id === op.modelId) : undefined
    deps.push(m ? { blob: m.blob, place: m.place } : null)
    deps.push({ top: (op.top ?? []).map((id) => part.entities.find((e) => e.id === id) ?? id), guide: op.axis.guide ? (part.entities.find((e) => e.id === op.axis.guide) ?? op.axis.guide) : null })
  }
  // scallop start shapes (not in `geometry`, which holds the boundary)
  if (op.kind === 'finish3d' && op.startFrom?.length) deps.push({ starts: op.startFrom.map((id) => part.entities.find((e) => e.id === id) ?? id) })
  // curve-driven: the drive shapes, and the surface whose rows and columns it follows
  if (op.kind === 'finish3d' && op.strategy === 'curve' && op.drive) {
    if (op.drive.mode === 'curves') deps.push({ drive: (op.drive.shapes ?? []).map((id) => part.entities.find((e) => e.id === id) ?? id) })
    if (op.drive.mode === 'parameter') {
      const m = part.models?.find((x) => x.id === (op.drive!.modelId || op.surface.modelId))
      deps.push({ grid: m ? { blob: m.blob, place: m.place, grid: m.grid ?? null } : null })
    }
  }
  // rest machining and a toolpath followed: everything the earlier operations' toolpaths depend
  // on (and the tool table when one of them picks its tool automatically)
  const src = driveSource(op, part)
  const sources = [...restSources(op, part), ...(src ? [src] : [])]
  if (sources.length) {
    deps.push(sources.map((o) => opInputHash(o, part, machine?.tools?.find((t) => t.id === o.toolId) ?? o.toolId, machine)))
    if (sources.some((o) => !o.toolId) && machine?.tools) deps.push(machine.tools.filter((t) => t.type === 'router'))
  }
  if (machine) {
    const toolId = tool && typeof tool === 'object' && 'id' in tool ? (tool as { id: string }).id : null
    const feed = toolId && part.materialId ? (machine.feeds?.find((f) => f.toolId === toolId && f.materialId === part.materialId) ?? null) : null
    deps.push({ through: machine.throughDepth, material: part.materialId, feed })
    // M2.7: the holder the tool sits in (its own or the shop default), the stick-out used and its
    // aggregate: the collision checks (and 3D clearance warnings, edge-work checks) read them
    if (tool && typeof tool === 'object' && 'type' in tool) {
      const t = tool as Tool
      const holder = effectiveHolder(machine, t)
      const agg = aggregateOf(machine, t)
      if (holder || agg) deps.push({ holder: holder?.profile ?? null, gauge: effectiveGauge(machine, t).gauge, agg })
    }
  }
  return fnv(JSON.stringify(deps))
}

export type OpState = 'new' | 'current' | 'stale' | 'broken'
export function opState(op: CamOp, part: CamPart, tool: unknown, machine?: OpMachineInputs): OpState {
  if (op.kind !== 'code' && op.geometry.some((id) => !part.entities.some((e) => e.id === id))) return 'broken'
  if (!op.builtHash) return 'new'
  return op.builtHash === opInputHash(op, part, tool, machine) ? 'current' : 'stale'
}
