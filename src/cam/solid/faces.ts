/**
 * Working with a solid's faces on a part (SOL-02, SOL-03):
 *
 * - Machine picked faces directly: a pocket from a floor face, a drill from a hole's wall (or its
 *   floor), a profile from walls (the outline's, a cut-out's, a pocket's, or loose walls), a saw
 *   cut along a straight wall's top edge. The picked faces are matched to the recognised feature
 *   they belong to, so the shape is the same exact geometry recognition gives; the shapes are made
 *   for you, linked to the faces (no extracting 2D first).
 * - Faces to layers by colour or type: the faces' shapes go on a layer (the layer rules then
 *   machine them by its name), or get a recipe's operations.
 * - Face colours set in the app, and grain direction from a face (its longest straight edge).
 * - When the solid's data changes, operations on its shapes go stale (`opInputHash`) and the shapes
 *   can be made again from the same face ids.
 */
import { nanoid } from 'nanoid'
import { line, type Contour } from '../geom'
import { withNewOp } from '../doc'
import { defaultOp, fromTemplate } from '../ops'
import type { CamOp, CamOpKind, CamPart, Entity, FaceId, Geom, Layer, ModelPlacement, ModelRef, ProfileSide, Recipe, SolidRole } from '../types'
import type { PanelFrame } from './align'
import { dot3, topology } from './classify'
import { panelContext, type Recognition, recognizePanel } from './recognize'
import { bodyOfFace } from './faceSelect'
import type { SolidBody, SolidData, V3 } from './types'

export { bodyOfFace, faceColors, facesByColor, facesByType, faceType, setFaceColor, staleSolidShapes, type FaceType } from './faceSelect'

type M3 = [V3, V3, V3]

const UP: Record<ModelPlacement['up'], M3> = {
  '+z': [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  '-z': [
    [1, 0, 0],
    [0, -1, 0],
    [0, 0, -1],
  ],
  '+y': [
    [1, 0, 0],
    [0, 0, -1],
    [0, 1, 0],
  ],
  '-y': [
    [1, 0, 0],
    [0, 0, 1],
    [0, -1, 0],
  ],
  '+x': [
    [0, 0, -1],
    [0, 1, 0],
    [1, 0, 0],
  ],
  '-x': [
    [0, 0, 1],
    [0, 1, 0],
    [-1, 0, 0],
  ],
}

const mulM = (a: M3, b: M3): M3 => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j])) as M3

/**
 * The part frame a model's placement gives (as `placeMesh` places it), for a body. Only for
 * placements that keep sizes (scale 1, not mirrored) with the model's top flush with face 1:
 * depths are then measured from face 1. Otherwise null and the reason.
 */
export function placementFrame(body: SolidBody, place: ModelPlacement): { frame: PanelFrame } | { error: string } {
  if (Math.abs(place.scale - 1) > 1e-12 || place.mirror) return { error: 'The model is scaled or mirrored; machine faces only on a model at its true size.' }
  if (Math.abs(place.at[2]) > 1e-9) return { error: 'The model is not flush with face 1 (its top is moved up or down). Lay it flat as the part first (Find features → Lay flat), or set its top to 0.' }
  const F: M3 = place.frame?.length === 9 ? [place.frame.slice(0, 3) as V3, place.frame.slice(3, 6) as V3, place.frame.slice(6, 9) as V3] : UP['+z']
  const a = (place.rotZ * Math.PI) / 180
  const Z: M3 = [
    [Math.cos(a), -Math.sin(a), 0],
    [Math.sin(a), Math.cos(a), 0],
    [0, 0, 1],
  ]
  const R = mulM(Z, mulM(UP[place.up], F))
  const P = body.positions
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < P.length; i += 3) {
    const p: V3 = [P[i], P[i + 1], P[i + 2]]
    for (let k = 0; k < 3; k++) {
      const v = dot3(R[k], p)
      lo[k] = Math.min(lo[k], v)
      hi[k] = Math.max(hi[k], v)
    }
  }
  return { frame: { R, origin: [lo[0] - place.at[0], lo[1] - place.at[1], hi[2] - place.at[2]], length: hi[0] - lo[0], width: hi[1] - lo[1], thickness: hi[2] - lo[2], warnings: [] } }
}

export type FaceAction = 'profile' | 'pocket' | 'drill' | 'saw'

export interface FaceShape {
  g: Geom
  face: FaceId
  depth: number
  through: boolean
  role: SolidRole
  faces: number[]
  side?: ProfileSide
}

/** The recognised feature shapes the picked faces belong to (or, for loose walls and saw cuts, their edges). */
export function faceShapes(body: SolidBody, frame: PanelFrame, picked: number[], action: FaceAction, rec?: Recognition): { shapes: FaceShape[]; warnings: string[] } {
  const r = rec ?? recognizePanel(body, { frame })
  const warnings: string[] = []
  const shapes: FaceShape[] = []
  const has = (faces: number[]) => faces.some((f) => picked.includes(f))
  const T = frame.thickness
  const circleOrContour = (c: Contour): Geom => {
    const arcs = c.segs.every((s) => s.k === 'A')
    if (arcs && c.segs.length <= 2 && c.segs.length > 0) {
      const a = c.segs[0] as Extract<Contour['segs'][number], { k: 'A' }>
      return { t: 'circle', c: a.c, r: Math.hypot(a.a.x - a.c.x, a.a.y - a.c.y) }
    }
    return { t: 'contour', c }
  }
  if (action === 'drill') {
    for (const h of r.holes) if (has(h.faces)) shapes.push({ g: { t: 'circle', c: { x: h.x, y: h.y }, r: h.d / 2 }, face: h.face, depth: h.depth, through: h.through, role: 'hole', faces: h.faces })
    if (!shapes.length) warnings.push('None of the picked faces is part of a round hole (pick the hole’s wall or its floor).')
    return { shapes, warnings }
  }
  if (action === 'pocket') {
    for (const p of r.pockets) {
      if (!has([p.floor, ...p.faces])) continue
      if (p.face === 6) {
        warnings.push(`The pocket on face ${p.floor} opens on the underside; it is not machined from the top.`)
        continue
      }
      shapes.push({ g: circleOrContour(p.contour), face: 1, depth: p.depth, through: false, role: 'pocket', faces: p.faces })
      for (const isl of p.islands) shapes.push({ g: circleOrContour(isl), face: 1, depth: p.depth, through: false, role: 'island', faces: [p.floor] })
    }
    if (!shapes.length) warnings.push('None of the picked faces is a pocket’s floor or wall.')
    return { shapes, warnings }
  }
  if (action === 'profile') {
    if (has(r.outlineFaces)) shapes.push({ g: { t: 'contour', c: r.outline }, face: 1, depth: T, through: true, role: 'outline', faces: r.outlineFaces, side: 'outside' })
    for (const c of r.cutouts) if (has(c.faces)) shapes.push({ g: circleOrContour(c.contour), face: 1, depth: T, through: true, role: 'cutout', faces: c.faces, side: 'inside' })
    for (const p of r.pockets) if (p.face === 1 && has(p.faces.filter((f) => f !== p.floor))) shapes.push({ g: circleOrContour(p.contour), face: 1, depth: p.depth, through: false, role: 'pocket', faces: p.faces, side: 'inside' })
    const known = new Set([...r.outlineFaces, ...r.cutouts.flatMap((c) => c.faces), ...r.pockets.flatMap((p) => p.faces), ...r.holes.flatMap((h) => h.faces)])
    const loose = picked.filter((f) => !known.has(f))
    if (loose.length) {
      const e = topEdges(body, frame, loose)
      if (e.contour) shapes.push({ g: { t: 'contour', c: e.contour }, face: 1, depth: e.depth, through: e.depth >= T - 1e-9, role: 'profile', faces: loose, side: e.contour.closed ? 'auto' : 'centre' })
      warnings.push(...e.warnings)
    }
    if (!shapes.length) warnings.push('None of the picked faces is a wall (pick the side faces to profile along).')
    return { shapes, warnings }
  }
  // saw: along the top edge of each picked straight wall
  for (const f of picked) {
    const e = topEdges(body, frame, [f], true)
    if (e.contour) shapes.push({ g: { t: 'contour', c: e.contour }, face: 1, depth: e.depth, through: e.depth >= T - 1e-9, role: 'saw', faces: [f] })
    warnings.push(...e.warnings)
  }
  if (!shapes.length) warnings.push('Pick a straight, upright wall to saw along.')
  return { shapes, warnings }
}

/**
 * The top edges of walls (where they meet a level face above), chained, and how deep the walls go.
 * `straight`: one straight upright wall only (for saw cuts).
 */
function topEdges(body: SolidBody, frame: PanelFrame, walls: number[], straight = false): { contour: Contour | null; depth: number; warnings: string[] } {
  const ctx = panelContext(body, frame)
  const warnings: string[] = []
  const ws = walls.map((w) => ctx.info.get(w)).filter((x) => !!x)
  const bad = ws.filter((w) => (straight ? w.kind !== 'vwall' : w.kind !== 'vwall' && w.kind !== 'vcyl'))
  if (bad.length) warnings.push(`Face(s) ${bad.map((b) => b.id).join(', ')} are not ${straight ? 'flat upright walls' : 'upright walls'}; left out.`)
  const good = ws.filter((w) => !bad.includes(w))
  if (!good.length) return { contour: null, depth: 0, warnings }
  const depth = Math.round(-Math.min(...good.map((w) => w.zmin)) * 1e6) / 1e6
  // edges of these walls whose other side is a level face higher up
  const edges: { a: number; b: number; other: number }[] = []
  for (const w of good)
    for (const loop of ctx.loopsOf(w.id))
      for (const e of loop) {
        const o = ctx.info.get(e.other)
        if (!o || (o.kind !== 'up' && o.kind !== 'down')) continue
        if (Math.abs(ctx.pp[e.a][2] - w.zmax) > 1e-6 || Math.abs(ctx.pp[e.b][2] - w.zmax) > 1e-6) continue
        edges.push(e)
      }
  if (!edges.length) {
    warnings.push('No top edge found on the picked walls.')
    return { contour: null, depth, warnings }
  }
  // chain them (direction as the walls run)
  const next = new Map(edges.map((e) => [e.a, e]))
  const starts = edges.filter((e) => !edges.some((x) => x.b === e.a))
  const first = starts[0] ?? edges[0]
  const ids = [first.a]
  let e: (typeof edges)[number] | undefined = first
  const seen = new Set<typeof first>()
  while (e && !seen.has(e)) {
    seen.add(e)
    ids.push(e.b)
    e = next.get(e.b)
  }
  const closed = ids[0] === ids[ids.length - 1] && ids.length > 2
  if (seen.size < edges.length) warnings.push('The picked walls do not join up; only one connected run is used.')
  const fake = ids.slice(0, -1).map((a, i) => ({ a, b: ids[i + 1], other: 0 }))
  if (straight) {
    const A = ctx.pp[ids[0]]
    const B = ctx.pp[ids[ids.length - 1]]
    return { contour: { closed: false, segs: [line({ x: r6(A[0]), y: r6(A[1]) }, { x: r6(B[0]), y: r6(B[1]) })] }, depth, warnings }
  }
  // the same exact lines and arcs as recognition: runs along each wall
  const loop = fake.map((x, i) => ({ ...x, other: wallOfEdge(ctx, good.map((g) => g.id), x.a, x.b) ?? good[Math.min(i, good.length - 1)].id }))
  const c = ctx.contourOf(loop)
  return { contour: { closed, segs: c.segs }, depth, warnings }
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6

function wallOfEdge(ctx: ReturnType<typeof panelContext>, walls: number[], a: number, b: number) {
  for (const w of walls) for (const loop of ctx.loopsOf(w)) if (loop.some((e) => e.a === a && e.b === b)) return w
  return null
}

const KIND_OF: Record<FaceAction, CamOpKind> = { profile: 'profile', pocket: 'pocket', drill: 'drill', saw: 'saw' }
export const FACE_LAYER: Layer = { id: 'sol-faces', name: 'Machined faces', color: '#fb923c', visible: true, locked: false }

export interface MachineFacesResult {
  part: CamPart
  op: CamOp | null
  entities: Entity[]
  warnings: string[]
}

/** The frame for a solid model on a part (see `placementFrame`), and the body of the picked faces. */
export function modelFrame(solid: SolidData, model: ModelRef, faces: number[]): { body: SolidBody; frame: PanelFrame } | { error: string } {
  const body = bodyOfFace(solid, faces[0])
  if (!body) return { error: `Face ${faces[0]} is not in this solid.` }
  if (faces.some((f) => !body.faces.some((x) => x.id === f))) return { error: 'The picked faces belong to different bodies; pick faces of one body.' }
  const pf = placementFrame(body, model.place)
  if ('error' in pf) return pf
  return { body, frame: pf.frame }
}

/**
 * Machine picked faces: shapes linked to the faces on the "Machined faces" layer (no rule reads
 * it, so applying the rules never doubles them) and one operation of the asked kind, its depth
 * from the faces.
 */
export function machineFaces(part: CamPart, model: ModelRef, solid: SolidData, faces: number[], action: FaceAction): MachineFacesResult {
  const mf = modelFrame(solid, model, faces)
  if ('error' in mf) return { part, op: null, entities: [], warnings: [mf.error] }
  const { shapes, warnings } = faceShapes(mf.body, mf.frame, faces, action)
  if (!shapes.length) return { part, op: null, entities: [], warnings }
  const entities: Entity[] = shapes.map((s) => ({ id: nanoid(8), layer: FACE_LAYER.id, g: s.g, face: s.face, ...(action === 'drill' ? { depth: s.depth } : {}), solid: { modelId: model.id, faces: [...s.faces].sort((a, b) => a - b), blob: model.blob, role: s.role } }))
  const deepest = Math.max(...shapes.map((s) => s.depth))
  const through = shapes.every((s) => s.through)
  const sides = new Set(shapes.map((s) => s.side).filter(Boolean))
  const extra: Partial<CamOp> = { levels: { safeZ: 20, rapidZ: 3, depth: deepest, through, stockZ: 0, passDepth: 0 } } as Partial<CamOp>
  if (action === 'profile') Object.assign(extra, { side: sides.size === 1 ? [...sides][0] : 'auto', order: 'inside-first' })
  const op = defaultOp(KIND_OF[action], entities.map((e) => e.id), extra)
  op.name = `${op.name} (faces ${[...new Set(shapes.flatMap((s) => s.faces))].sort((a, b) => a - b).slice(0, 6).join(', ')}${shapes.flatMap((s) => s.faces).length > 6 ? '…' : ''})`
  if (action === 'saw') warnings.push('Saw cuts need a saw unit on the machine; the export checker refuses them for a machine without one.')
  const layers = part.layers.some((l) => l.id === FACE_LAYER.id) ? part.layers : [...part.layers, { ...FACE_LAYER }]
  // Polish-2: before the part's cut-out, if it has one
  return { part: { ...part, layers, entities: [...part.entities, ...entities], ops: withNewOp(part, op), updatedAt: new Date().toISOString() }, op, entities, warnings }
}

/** Every shape the picked faces make, whatever kind (for sending faces to a layer). */
export function shapesOfFaces(body: SolidBody, frame: PanelFrame, faces: number[]): FaceShape[] {
  const rec = recognizePanel(body, { frame })
  const out: FaceShape[] = []
  const seen = new Set<string>()
  for (const action of ['drill', 'pocket', 'profile'] as FaceAction[]) {
    for (const s of faceShapes(body, frame, faces, action, rec).shapes) {
      const k = `${s.role}:${s.faces.join(',')}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push(s)
    }
  }
  return out
}

/**
 * Send faces to a layer (by name; made when missing): their shapes go on it, linked to the faces,
 * and the faces remember the layer. With a recipe, its operations are added for those shapes.
 */
export function sendFacesToLayer(part: CamPart, model: ModelRef, solid: SolidData, faces: number[], layerName: string, recipe?: Recipe): { part: CamPart; entities: Entity[]; warnings: string[] } {
  const mf = modelFrame(solid, model, faces)
  if ('error' in mf) return { part, entities: [], warnings: [mf.error] }
  const shapes = shapesOfFaces(mf.body, mf.frame, faces)
  if (!shapes.length) return { part, entities: [], warnings: ['The picked faces make no shape to machine (pick walls, floors or holes).'] }
  let layers = part.layers
  let layer = layers.find((l) => l.name.toLowerCase() === layerName.trim().toLowerCase())
  if (!layer) {
    layer = { id: `sol-${layerName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${nanoid(4)}`, name: layerName.trim(), color: '#fb923c', visible: true, locked: false }
    layers = [...layers, layer]
  }
  const lid = layer.id
  const entities: Entity[] = shapes.map((s) => ({ id: nanoid(8), layer: lid, g: s.g, face: s.face, ...(s.role === 'hole' ? { depth: s.depth } : {}), solid: { modelId: model.id, faces: [...s.faces].sort((a, b) => a - b), blob: model.blob, role: s.role } }))
  const faceLayers = { ...(model.faceLayers ?? {}) }
  for (const f of faces) faceLayers[String(f)] = lid
  const models = (part.models ?? []).map((m) => (m.id === model.id ? { ...m, faceLayers } : m))
  let ops = part.ops
  if (recipe) {
    const depth = Math.max(...shapes.map((s) => s.depth))
    const through = shapes.every((s) => s.through)
    ops = [
      ...ops,
      ...recipe.ops.map((t) => {
        const op = fromTemplate(t, entities.map((e) => e.id))
        op.recipeId = recipe.id
        op.name = `${t.name} (${layer!.name})`
        if (!op.levels.through) op.levels = { ...op.levels, depth, through }
        return op
      }),
    ]
  }
  return { part: { ...part, layers, entities: [...part.entities, ...entities], models, ops, updatedAt: new Date().toISOString() }, entities, warnings: [] }
}

/**
 * Grain direction from faces (file coordinates): the longest straight edge round them. On a
 * panel's show face this is its long side; on a narrow face that shows the grain, its length.
 */
export function grainDirection(body: SolidBody, faces: number[]): V3 | null {
  const topo = topology(body)
  let best: { len: number; d: V3 } | null = null
  for (const f of faces) {
    for (const loop of topo.loops.get(f)?.loops ?? []) {
      // runs of edges along one neighbour that are straight: length end to end
      let i = 0
      while (i < loop.length) {
        let j = i
        while (j + 1 < loop.length && loop[j + 1].other === loop[i].other) j++
        const a = topo.points[loop[i].a]
        const b = topo.points[loop[j].b]
        const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
        const len = Math.hypot(...d)
        // straight: every point of the run on the chord
        let straight = len > 1e-6
        for (let k = i; k <= j && straight; k++) {
          const p = topo.points[loop[k].b]
          const t: V3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]
          const along = dot3(t, d) / len
          straight = Math.hypot(t[0] - (along * d[0]) / len, t[1] - (along * d[1]) / len, t[2] - (along * d[2]) / len) < 1e-6
        }
        if (straight && (!best || len > best.len + 1e-9)) best = { len, d: [d[0] / len, d[1] / len, d[2] / len] }
        i = j + 1
      }
    }
  }
  return best?.d ?? null
}

/**
 * Make a model's shapes again from its current solid (same face ids). Shapes whose faces are no
 * longer there are left as they were and listed.
 */
export function refreshSolidShapes(part: CamPart, model: ModelRef, solid: SolidData): { part: CamPart; updated: number; missing: Entity[] } {
  const mine = part.entities.filter((e) => e.solid?.modelId === model.id)
  if (!mine.length) return { part, updated: 0, missing: [] }
  const missing: Entity[] = []
  const byId = new Map<string, Entity>()
  const recs = new Map<number, { rec: Recognition; body: SolidBody; frame: PanelFrame }>()
  for (const e of mine) {
    const body = bodyOfFace(solid, e.solid!.faces[0])
    if (!body) {
      missing.push(e)
      continue
    }
    let r = recs.get(body.index)
    if (!r) {
      const pf = placementFrame(body, model.place)
      if ('error' in pf) {
        missing.push(e)
        continue
      }
      r = { rec: recognizePanel(body, { frame: pf.frame }), body, frame: pf.frame }
      recs.set(body.index, r)
    }
    const role = e.solid!.role
    const action: FaceAction = role === 'hole' ? 'drill' : role === 'pocket' || role === 'island' ? 'pocket' : role === 'saw' ? 'saw' : 'profile'
    const shapes = faceShapes(r.body, r.frame, e.solid!.faces, action, r.rec).shapes.filter((s) => s.role === role)
    const s = shapes.find((x) => x.faces.some((f) => e.solid!.faces.includes(f)))
    if (!s) {
      missing.push(e)
      continue
    }
    byId.set(e.id, { ...e, g: s.g, face: s.face, ...(e.depth !== undefined || role === 'hole' ? { depth: s.depth } : {}), solid: { ...e.solid!, faces: [...s.faces].sort((a, b) => a - b), blob: model.blob } })
  }
  const entities = part.entities.map((e) => byId.get(e.id) ?? e)
  return { part: { ...part, entities, updatedAt: new Date().toISOString() }, updated: byId.size, missing }
}
