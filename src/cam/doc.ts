/**
 * Document helpers: factories, entity geometry, outline, undo/redo history and input hashing
 * for associative operations.
 */
import { nanoid } from 'nanoid'
import { strokeText } from './font'
import { area, boxOf, circle, type Contour, fitPoints, type P, pointInContour, polyline, pt, rect, transform, type Mat } from './geom'
import type { MachineProfile } from '@/core/types'
import type { CamOp, CamPart, Entity, FaceId, Geom, Layer } from './types'

/** Part document version. 2 (Stage 2): optional 3D models (`models`) and `workVolume`. */
export const CAM_FILE_VERSION = 2

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
      return strokeText(g.text, g.at, g.height, g.angle, g.spacing ?? 1, g.arc)
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

/** Machine settings a toolpath reads besides its tool: through depth and the material feed table. */
export type OpMachineInputs = Pick<MachineProfile, 'throughDepth' | 'feeds'>

/**
 * Hash of everything an op's toolpath depends on: its parameters, the picked geometry, the tool,
 * the part thickness and, when `machine` is given, the through depth and the feed-table row for
 * this tool in the part's material. Changing any of them marks the op stale.
 */
export function opInputHash(op: CamOp, part: CamPart, tool: unknown, machine?: OpMachineInputs): string {
  const { builtHash: _b, name: _n, note: _note, ...params } = op
  const geo = op.geometry.map((id) => part.entities.find((e) => e.id === id) ?? id)
  const deps: unknown[] = [params, geo, tool, part.thickness]
  // 3D ops: the model's data (by hash, never the mesh itself) and where it sits
  if (op.kind === 'finish3d' || op.kind === 'rough3d') {
    const m = part.models?.find((x) => x.id === op.surface.modelId)
    deps.push(m ? { blob: m.blob, place: m.place } : null)
  }
  if (machine) {
    const toolId = tool && typeof tool === 'object' && 'id' in tool ? (tool as { id: string }).id : null
    const feed = toolId && part.materialId ? (machine.feeds?.find((f) => f.toolId === toolId && f.materialId === part.materialId) ?? null) : null
    deps.push({ through: machine.throughDepth, material: part.materialId, feed })
  }
  return fnv(JSON.stringify(deps))
}

export type OpState = 'new' | 'current' | 'stale' | 'broken'
export function opState(op: CamOp, part: CamPart, tool: unknown, machine?: OpMachineInputs): OpState {
  if (op.kind !== 'code' && op.geometry.some((id) => !part.entities.some((e) => e.id === id))) return 'broken'
  if (!op.builtHash) return 'new'
  return op.builtHash === opInputHash(op, part, tool, machine) ? 'current' : 'stale'
}
