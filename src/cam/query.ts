/**
 * Geometry queries (CAD-17): tests (field, operator, value) on the facts of shapes, of the faces of
 * solid models, and of whole models; queries run by hand from the designer or as auto-queries
 * before the layer rules. The Stage 1 layer rules are themselves queries on this engine
 * (`ruleQuery`): a rule is "layer matches the pattern, and its extra tests", and each shape is
 * claimed by the first rule (lowest order) whose query it passes.
 */
import { entityContours, layerOf, partOutline } from './doc'
import { area, boxOf, contourLength, radius as arcRadius, toPoints } from './geom'
import { panelFrame } from './solid/align'
import { faceType } from './solid/faceSelect'
import { placementFrame } from './solid/faces'
import type { SolidData, V3 } from './solid/types'
import type { CamPart, Entity, GeoQuery, GeoTest, LayerRule, ModelRef, QueryTest } from './types'

/** Exact (case-insensitive), glob with * and ?, or /regex/ (case-insensitive). */
export function layerMatches(pattern: string, name: string): boolean {
  const p = pattern.trim()
  if (!p) return false
  if (p.length > 2 && p.startsWith('/') && p.lastIndexOf('/') > 0) {
    const end = p.lastIndexOf('/')
    try {
      return new RegExp(p.slice(1, end), p.slice(end + 1).replace(/[^gimsuy]/g, '') + (p.slice(end + 1).includes('i') ? '' : 'i')).test(name)
    } catch {
      return false
    }
  }
  if (/[*?]/.test(p)) {
    const re = new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i')
    return re.test(name)
  }
  return p.toLowerCase() === name.toLowerCase()
}

/** The Stage 1 facts of a shape (the rules' fields). */
export interface EntityFacts {
  layer: string
  type: string
  closed: boolean
  diameter: number
  width: number
  height: number
  area: number
  face: number
}

const r3 = (n: number) => Math.round(n * 1000) / 1000

export function entityFacts(part: CamPart, e: Entity): EntityFacts {
  const cs = entityContours(e)
  const b = cs.length && cs.some((c) => c.segs.length) ? boxOf(cs) : { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return {
    layer: layerOf(part, e.layer)?.name ?? e.layer,
    type: e.g.t,
    closed: e.g.t === 'circle' || cs.some((c) => c.closed),
    diameter: e.g.t === 'circle' ? e.g.r * 2 : 0,
    width: r3(b.maxX - b.minX),
    height: r3(b.maxY - b.minY),
    area: r3(cs.filter((c) => c.closed).reduce((n, c) => n + Math.abs(area(c)), 0)),
    face: e.face,
  }
}

/** One test against a fact value. */
export function testValue(op: GeoTest['op'], v: unknown, want: GeoTest['value'], want2?: number): boolean {
  switch (op) {
    case '=':
      return typeof v === 'string' ? v.toLowerCase() === String(want).toLowerCase() : v === (typeof v === 'number' ? Number(want) : want === true || want === 'true')
    case '!=':
      return !testValue('=', v, want)
    case '<':
      return Number(v) < Number(want)
    case '<=':
      return Number(v) <= Number(want) + 1e-9
    case '>':
      return Number(v) > Number(want)
    case '>=':
      return Number(v) >= Number(want) - 1e-9
    case 'between':
      return Number(v) >= Number(want) - 1e-9 && Number(v) <= Number(want2 ?? want) + 1e-9
    case 'in':
      return String(want)
        .split(/[,;]/)
        .map((x) => x.trim())
        .filter(Boolean)
        .some((x) => testValue('=', v, typeof v === 'number' ? Number(x) : x))
    case 'contains':
      return String(v).toLowerCase().includes(String(want).toLowerCase())
    case '!contains':
      return !testValue('contains', v, want)
    case 'matches':
      return layerMatches(String(want), String(v))
    case '!matches':
      return !layerMatches(String(want), String(v))
  }
}

/** Stage 1 test on a shape's facts (the layer rules' `where`). */
export function testPasses(t: QueryTest, f: EntityFacts | Record<string, unknown>): boolean {
  return testValue(t.op, (f as Record<string, unknown>)[t.field], t.value, t.value2)
}

// ---------------------------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------------------------

export type FieldKind = 'text' | 'number' | 'length' | 'bool'
export interface FieldDef {
  key: string
  label: string
  kind: FieldKind
  /** Choices shown for text fields. */
  options?: string[]
}

export const SHAPE_FIELDS: FieldDef[] = [
  { key: 'layer', label: 'Layer', kind: 'text' },
  { key: 'type', label: 'Type', kind: 'text', options: ['contour', 'circle', 'text', 'spline', 'point', 'poly3d'] },
  { key: 'closed', label: 'Closed', kind: 'bool' },
  { key: 'diameter', label: 'Circle diameter', kind: 'length' },
  { key: 'radius', label: 'Radius (circle or arcs)', kind: 'length' },
  { key: 'width', label: 'Width (X)', kind: 'length' },
  { key: 'height', label: 'Height (Y)', kind: 'length' },
  { key: 'area', label: 'Area (mm²)', kind: 'number' },
  { key: 'length', label: 'Length round it', kind: 'length' },
  { key: 'segments', label: 'Number of segments', kind: 'number' },
  { key: 'arcs', label: 'Number of arcs', kind: 'number' },
  { key: 'holes', label: 'Closed shapes inside it', kind: 'number' },
  { key: 'inside', label: 'Lies inside another closed shape', kind: 'bool' },
  { key: 'outline', label: 'Is the part outline', kind: 'bool' },
  { key: 'depth', label: 'Depth given', kind: 'length' },
  { key: 'face', label: 'Face', kind: 'number' },
  { key: 'x', label: 'Middle X', kind: 'length' },
  { key: 'y', label: 'Middle Y', kind: 'length' },
  { key: 'tag', label: 'Tag', kind: 'text' },
  { key: 'role', label: 'Made from a solid as', kind: 'text', options: ['outline', 'cutout', 'pocket', 'island', 'hole', 'edge', 'profile', 'saw'] },
]

export const FACE_FIELDS: FieldDef[] = [
  { key: 'type', label: 'Face type', kind: 'text', options: ['flat', 'hole', 'round', 'cone', 'sphere', 'free-form'] },
  { key: 'diameter', label: 'Diameter (holes, rounds)', kind: 'length' },
  { key: 'area', label: 'Area (mm²)', kind: 'number' },
  { key: 'facing', label: 'Facing (flat faces, as the part lies)', kind: 'text', options: ['up', 'down', 'side', 'sloped'] },
  { key: 'depth', label: 'Depth below the top (flat faces)', kind: 'length' },
  { key: 'color', label: 'Colour (#rrggbb)', kind: 'text' },
  { key: 'layer', label: 'Layer sent to', kind: 'text' },
  { key: 'id', label: 'Face id', kind: 'number' },
  { key: 'body', label: 'Body name', kind: 'text' },
]

export const MODEL_FIELDS: FieldDef[] = [
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'kind', label: 'Kind', kind: 'text', options: ['mesh', 'solid'] },
  { key: 'faces', label: 'Faces', kind: 'number' },
  { key: 'triangles', label: 'Triangles', kind: 'number' },
  { key: 'sizeX', label: 'Size X', kind: 'length' },
  { key: 'sizeY', label: 'Size Y', kind: 'length' },
  { key: 'sizeZ', label: 'Size Z', kind: 'length' },
  { key: 'format', label: 'File format', kind: 'text' },
  { key: 'source', label: 'File name', kind: 'text' },
  { key: 'layer', label: 'Layer', kind: 'text' },
]

export const FIELDS_OF: Record<GeoQuery['target'], FieldDef[]> = { shapes: SHAPE_FIELDS, faces: FACE_FIELDS, models: MODEL_FIELDS }

// ---------------------------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------------------------

/** All facts of a shape; the costly ones (inside, holes, outline) are worked out only when a test asks. */
export function shapeFacts(part: CamPart, e: Entity, closedPolys: () => Map<string, { x: number; y: number }[][]>): Record<string, unknown> {
  const base = entityFacts(part, e)
  const cs = entityContours(e)
  const segs = cs.flatMap((c) => c.segs)
  const b = cs.length && segs.length ? boxOf(cs) : null
  const radii = e.g.t === 'circle' ? [e.g.r] : segs.flatMap((s) => (s.k === 'A' ? [arcRadius(s)] : []))
  const facts: Record<string, unknown> = {
    ...base,
    length: r3(cs.reduce((n, c) => n + contourLength(c), 0)),
    radius: radii.length ? r3(Math.min(...radii)) : 0,
    segments: e.g.t === 'circle' ? 1 : segs.length,
    arcs: e.g.t === 'circle' ? 1 : segs.filter((s) => s.k === 'A').length,
    depth: e.depth ?? 0,
    x: b ? r3((b.minX + b.maxX) / 2) : 0,
    y: b ? r3((b.minY + b.maxY) / 2) : 0,
    tag: e.tag ?? '',
    role: e.solid?.role ?? '',
  }
  const mid = b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : null
  const firstPt = cs[0]?.segs[0]?.a ?? (e.g.t === 'circle' ? { x: e.g.c.x + e.g.r, y: e.g.c.y } : null)
  Object.defineProperties(facts, {
    outline: { enumerable: true, get: () => partOutline(part).entity?.id === e.id },
    inside: {
      enumerable: true,
      get: () => {
        if (!firstPt) return false
        for (const [id, polys] of closedPolys()) if (id !== e.id && polys.some((poly) => inPoly(poly, firstPt) && (!mid || inPoly(poly, mid)))) return true
        return false
      },
    },
    holes: {
      enumerable: true,
      get: () => {
        const mine = closedPolys().get(e.id)
        if (!mine) return 0
        let n = 0
        for (const [id, polys] of closedPolys()) {
          if (id === e.id) continue
          const p = polys[0]?.[0]
          if (p && mine.some((poly) => inPoly(poly, p))) n++
        }
        return n
      },
    },
  })
  return facts
}

function inPoly(poly: { x: number; y: number }[], p: { x: number; y: number }) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Closed shapes of face 1 as polygons (for inside / holes), made once per query run. */
function closedPolygons(part: CamPart) {
  let cache: Map<string, { x: number; y: number }[][]> | null = null
  return () => {
    if (cache) return cache
    cache = new Map()
    for (const e of part.entities) {
      if (e.g.t === 'point' || layerOf(part, e.layer)?.construction) continue
      const polys = entityContours(e)
        .filter((c) => c.closed && c.segs.length)
        .map((c) => toPoints(c, 0.05))
      if (polys.length) cache.set(e.id, polys)
    }
    return cache
  }
}

/**
 * The turn from a body's file axes to the part's (rows = part x, y, z in file coordinates): the
 * model's placement when it was laid flat as the part, else the panel alignment that feature
 * recognition uses (thickness along Z).
 */
function partAxes(b: SolidData['bodies'][number], model: Pick<ModelRef, 'place'>): [V3, V3, V3] {
  if (model.place?.frame) {
    const f = placementFrame(b, model.place)
    if ('frame' in f) return f.frame.R
  }
  try {
    return panelFrame(b).R
  } catch {
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
  }
}

/** Facts of every face of a solid model (facing and depth as the part lies: face 1 up). */
export function faceFacts(solid: SolidData, model: Pick<ModelRef, 'faceColors' | 'faceLayers'> & Partial<Pick<ModelRef, 'place'>>, layerName: (id: string) => string): { id: number; facts: Record<string, unknown> }[] {
  const out: { id: number; facts: Record<string, unknown> }[] = []
  for (const b of solid.bodies) {
    const R = partAxes(b, { place: model.place ?? { up: '+z', rotZ: 0, scale: 1, mirror: false, at: [0, 0, 0] } })
    const zOf = (i: number) => R[2][0] * b.positions[i * 3] + R[2][1] * b.positions[i * 3 + 1] + R[2][2] * b.positions[i * 3 + 2]
    let top = -Infinity
    for (let i = 0; i < b.positions.length / 3; i++) top = Math.max(top, zOf(i))
    for (const f of b.faces) {
      const s = f.surface
      const t = faceType(f)
      let facing = ''
      let depth = 0
      if (s.kind === 'plane' && s.n) {
        const nz = R[2][0] * s.n[0] + R[2][1] * s.n[1] + R[2][2] * s.n[2]
        facing = nz > 0.999 ? 'up' : nz < -0.999 ? 'down' : Math.abs(nz) < 0.001 ? 'side' : 'sloped'
        // a flat face facing up or down: how far it lies below the top
        if (Math.abs(Math.abs(nz) - 1) < 1e-3) depth = r3(top - zOf(b.indices[f.first * 3]))
      }
      out.push({
        id: f.id,
        facts: {
          id: f.id,
          type: t,
          diameter: s.r !== undefined && (s.kind === 'cylinder' || s.kind === 'sphere') ? r3(2 * s.r) : 0,
          area: r3(f.area),
          facing,
          depth,
          color: (model.faceColors?.[String(f.id)] ?? f.color ?? b.color ?? '').toLowerCase(),
          layer: model.faceLayers?.[String(f.id)] ? layerName(model.faceLayers[String(f.id)]) : '',
          body: b.name,
        },
      })
    }
  }
  return out
}

/** Facts of a model on the part. */
export function modelFacts(part: CamPart, m: ModelRef): Record<string, unknown> {
  return { name: m.name, kind: m.kind, faces: m.faces ?? 0, triangles: m.triangles, sizeX: r3(m.size[0] * m.place.scale), sizeY: r3(m.size[1] * m.place.scale), sizeZ: r3(m.size[2] * m.place.scale), format: m.format ?? m.report?.format ?? '', source: m.source, layer: layerOf(part, m.layer)?.name ?? m.layer }
}

const passes = (q: Pick<GeoQuery, 'match' | 'tests'>, facts: Record<string, unknown>) =>
  q.tests.length === 0 ? true : q.match === 'any' ? q.tests.some((t) => testValue(t.op, facts[t.field], t.value, t.value2)) : q.tests.every((t) => testValue(t.op, facts[t.field], t.value, t.value2))

/** Shapes (ids) a query finds; construction layers and points are left out unless asked by type. */
export function queryShapes(part: CamPart, q: Pick<GeoQuery, 'match' | 'tests'>): string[] {
  const polys = closedPolygons(part)
  return part.entities.filter((e) => !layerOf(part, e.layer)?.construction && passes(q, shapeFacts(part, e, polys))).map((e) => e.id)
}

/** Faces (ids) of a solid model a query finds. */
export function queryFaces(part: CamPart, model: ModelRef, solid: SolidData, q: Pick<GeoQuery, 'match' | 'tests'>): number[] {
  return faceFacts(solid, model, (id) => layerOf(part, id)?.name ?? id)
    .filter((f) => passes(q, f.facts))
    .map((f) => f.id)
}

/** Models (ids) a query finds. */
export function queryModels(part: CamPart, q: Pick<GeoQuery, 'match' | 'tests'>): string[] {
  return (part.models ?? []).filter((m) => passes(q, modelFacts(part, m))).map((m) => m.id)
}

/** A layer rule as a query: the layer matches the pattern, and every extra test passes. */
export function ruleQuery(rule: LayerRule): Pick<GeoQuery, 'match' | 'tests'> {
  return { match: 'all', tests: [{ field: 'layer', op: 'matches', value: rule.layer }, ...(rule.where ?? [])] }
}

/**
 * Each shape claimed by the first rule (lowest order first) whose query it passes. Construction
 * layers and points are never claimed (as in Stage 1).
 */
export function claimShapes(part: CamPart, rules: LayerRule[]): Map<string, LayerRule> {
  const sorted = [...rules].sort((a, b) => a.order - b.order)
  const qs = sorted.map((r) => ({ r, q: ruleQuery(r) }))
  const polys = closedPolygons(part)
  const claimed = new Map<string, LayerRule>()
  for (const e of part.entities) {
    if (layerOf(part, e.layer)?.construction || e.g.t === 'point') continue
    const f = shapeFacts(part, e, polys)
    const hit = qs.find(({ q }) => passes(q, f))
    if (hit) claimed.set(e.id, hit.r)
  }
  return claimed
}

/** Find (or make) a layer by name; returns the part and the layer id. */
export function ensureLayer(part: CamPart, name: string): { part: CamPart; id: string } {
  const have = part.layers.find((l) => l.name.toLowerCase() === name.toLowerCase())
  if (have) return { part, id: have.id }
  const id = `l-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${part.layers.length}`
  const palette = ['#38bdf8', '#a3e635', '#f472b6', '#fb923c', '#c084fc', '#facc15', '#2dd4bf']
  return { part: { ...part, layers: [...part.layers, { id, name, color: palette[part.layers.length % palette.length], visible: true, locked: false }] }, id }
}

/** Move shapes to a layer (made when missing). */
export function moveShapesToLayer(part: CamPart, ids: string[], layerName: string): CamPart {
  if (!ids.length) return part
  const { part: p, id } = ensureLayer(part, layerName)
  const set = new Set(ids)
  return { ...p, entities: p.entities.map((e) => (set.has(e.id) ? { ...e, layer: id } : e)) }
}

/** Run auto-queries on shapes in order: each moves what it finds to its result layer. */
export function runAutoQueries(part: CamPart, queries: GeoQuery[]): { part: CamPart; report: { query: string; shapes: number; layer: string }[] } {
  let p = part
  const report: { query: string; shapes: number; layer: string }[] = []
  for (const q of queries) {
    if (q.target !== 'shapes' || !q.resultLayer) continue
    const ids = queryShapes(p, q)
    p = moveShapesToLayer(p, ids, q.resultLayer)
    report.push({ query: q.name, shapes: ids.length, layer: q.resultLayer })
  }
  return { part: p, report }
}
