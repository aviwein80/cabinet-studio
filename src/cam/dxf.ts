/**
 * DXF in and out (ASCII). Reads LINE, ARC, CIRCLE, LWPOLYLINE, POLYLINE/VERTEX, SPLINE,
 * ELLIPSE, POINT, TEXT, MTEXT and INSERT (nested blocks, arrays, mirrored OCS); skips the rest
 * with a warning. Writes R12 (AC1009) LINE / ARC / CIRCLE / POINT / TEXT so every CAD and
 * nesting package can open it. DWG needs a licensed reader and is not handled here.
 */
import { entityContours, fitWorkVolume, layerOf, makeEntity, newPart, transformEntity } from './doc'
import {
  arc,
  boxOf,
  type Contour,
  dot,
  fitPoints,
  fromBulges,
  line,
  mergeSegs,
  type Mat,
  mulM,
  type P,
  radius,
  rotateM,
  scaleM,
  type Seg,
  sweep,
  tangentAt,
  transform,
  translateM,
  applyM,
  unit,
  segLength,
} from './geom'
import { joinContours } from './kernel'
import type { CamPart, Entity, Geom, Layer } from './types'

type Group = { code: number; value: string }
interface RawEntity {
  type: string
  g: Group[]
  /** VERTEX children of a POLYLINE. */
  vertices?: Group[][]
}

export function readGroups(text: string): Group[] {
  const lines = text.split(/\r\n|\r|\n/)
  const out: Group[] = []
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim())
    if (!Number.isFinite(code)) throw new Error(`Not a DXF file (bad group code on line ${i + 1}).`)
    out.push({ code, value: lines[i + 1].trim() })
  }
  return out
}

const num = (g: Group[], code: number, d = 0) => {
  const x = g.find((q) => q.code === code)
  return x ? Number(x.value) : d
}
const str = (g: Group[], code: number, d = '') => g.find((q) => q.code === code)?.value ?? d
const all = (g: Group[], code: number) => g.filter((q) => q.code === code).map((q) => Number(q.value))

export interface DxfDoc {
  header: Record<string, Group[]>
  layers: { name: string; color: number }[]
  blocks: Record<string, { base: P; entities: RawEntity[] }>
  entities: RawEntity[]
}

function splitEntities(gs: Group[]): RawEntity[] {
  const out: RawEntity[] = []
  let cur: RawEntity | null = null
  let poly: RawEntity | null = null
  for (const q of gs) {
    if (q.code === 0) {
      if (cur && cur !== poly) out.push(cur)
      if (q.value === 'VERTEX' && poly) {
        poly.vertices!.push([])
        cur = poly
        continue
      }
      if (q.value === 'SEQEND') {
        if (poly) out.push(poly)
        poly = null
        cur = null
        continue
      }
      if (poly) {
        out.push(poly)
        poly = null
      }
      cur = { type: q.value, g: [] }
      if (q.value === 'POLYLINE') {
        cur.vertices = []
        poly = cur
      }
      continue
    }
    if (!cur) continue
    if (cur === poly && poly.vertices!.length) poly.vertices![poly.vertices!.length - 1].push(q)
    else cur.g.push(q)
  }
  if (cur && cur !== poly) out.push(cur)
  if (poly) out.push(poly)
  return out
}

export function parseDxf(text: string): DxfDoc {
  const gs = readGroups(text)
  const doc: DxfDoc = { header: {}, layers: [], blocks: {}, entities: [] }
  let i = 0
  while (i < gs.length) {
    if (gs[i].code === 0 && gs[i].value === 'SECTION' && gs[i + 1]?.code === 2) {
      const name = gs[i + 1].value
      let j = i + 2
      while (j < gs.length && !(gs[j].code === 0 && gs[j].value === 'ENDSEC')) j++
      const body = gs.slice(i + 2, j)
      if (name === 'HEADER') {
        let key = ''
        for (const q of body) {
          if (q.code === 9) {
            key = q.value
            doc.header[key] = []
          } else if (key) doc.header[key].push(q)
        }
      } else if (name === 'TABLES') {
        for (const e of splitEntities(body)) if (e.type === 'LAYER') doc.layers.push({ name: str(e.g, 2), color: num(e.g, 62, 7) })
      } else if (name === 'BLOCKS') {
        let k = 0
        while (k < body.length) {
          if (body[k].code === 0 && body[k].value === 'BLOCK') {
            let m = k + 1
            while (m < body.length && body[m].code !== 0) m++
            const head = body.slice(k + 1, m)
            let n = m
            while (n < body.length && !(body[n].code === 0 && body[n].value === 'ENDBLK')) n++
            doc.blocks[str(head, 2)] = { base: { x: num(head, 10), y: num(head, 20) }, entities: splitEntities(body.slice(m, n)) }
            k = n + 1
          } else k++
        }
      } else if (name === 'ENTITIES') doc.entities = splitEntities(body)
      i = j + 1
    } else i++
  }
  return doc
}

/** Drawing unit -> mm, from $INSUNITS. */
export function unitScale(code: number): { scale: number; name: string } | null {
  switch (code) {
    case 1:
      return { scale: 25.4, name: 'inches' }
    case 2:
      return { scale: 304.8, name: 'feet' }
    case 4:
      return { scale: 1, name: 'millimetres' }
    case 5:
      return { scale: 10, name: 'centimetres' }
    case 6:
      return { scale: 1000, name: 'metres' }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

/** OCS with extrusion (0,0,-1) is a mirror in X; other tilted planes are flattened. */
const ocs = (g: Group[]): Mat => (num(g, 230, 1) < 0 ? [-1, 0, 0, 1, 0, 0] : [1, 0, 0, 1, 0, 0])

function arcSeg(c: P, r: number, a0: number, a1: number): Seg[] {
  const s = (a0 * Math.PI) / 180
  let e = (a1 * Math.PI) / 180
  while (e <= s + 1e-12) e += 2 * Math.PI
  const n = e - s > Math.PI + 1e-9 ? 2 : 1
  const out: Seg[] = []
  for (let k = 0; k < n; k++) {
    const t0 = s + ((e - s) * k) / n
    const t1 = s + ((e - s) * (k + 1)) / n
    out.push(arc({ x: c.x + r * Math.cos(t0), y: c.y + r * Math.sin(t0) }, { x: c.x + r * Math.cos(t1), y: c.y + r * Math.sin(t1) }, c, true))
  }
  return out
}

function deBoor(k: number, knots: number[], ctrl: P[], w: number[], t: number): P {
  const n = ctrl.length - 1
  let s = k
  while (s < n && t >= knots[s + 1]) s++
  const d = []
  for (let j = 0; j <= k; j++) {
    const i = s - k + j
    const wi = w[i] ?? 1
    d.push({ x: ctrl[i].x * wi, y: ctrl[i].y * wi, w: wi })
  }
  for (let r = 1; r <= k; r++)
    for (let j = k; j >= r; j--) {
      const i = s - k + j
      const den = knots[i + k - r + 1] - knots[i]
      const a = den === 0 ? 0 : (t - knots[i]) / den
      d[j] = { x: (1 - a) * d[j - 1].x + a * d[j].x, y: (1 - a) * d[j - 1].y + a * d[j].y, w: (1 - a) * d[j - 1].w + a * d[j].w }
    }
  return { x: d[k].x / d[k].w, y: d[k].y / d[k].w }
}

/** Points along a NURBS curve about `step` mm apart (from the control polygon length). */
export function splineSamples(degree: number, knots: number[], ctrl: P[], weights: number[], step = 0.25): P[] {
  if (ctrl.length < 2) return ctrl
  const k = Math.min(degree, ctrl.length - 1)
  const t0 = knots[k]
  const t1 = knots[ctrl.length]
  if (!(t1 > t0)) return ctrl
  let poly = 0
  for (let i = 1; i < ctrl.length; i++) poly += Math.hypot(ctrl[i].x - ctrl[i - 1].x, ctrl[i].y - ctrl[i - 1].y)
  const n = Math.min(20000, Math.max(16 * (ctrl.length - k), Math.ceil(poly / step)))
  const out: P[] = []
  for (let i = 0; i <= n; i++) out.push(deBoor(k, knots, ctrl, weights, i === n ? t1 - 1e-12 : t0 + ((t1 - t0) * i) / n))
  return out
}

interface Piece {
  layer: string
  g: Geom
}

function convert(e: RawEntity, doc: DxfDoc, m: Mat, layerOverride: string | null, depth: number, warn: (s: string) => void): Piece[] {
  const g = e.g
  const layerName = str(g, 8, '0')
  const layer = layerName === '0' && layerOverride ? layerOverride : layerName
  const M = mulM(m, ocs(g))
  const P2 = (x: number, y: number) => applyM(M, { x, y })
  const uniformScale = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2]))
  const contour = (c: Contour): Piece => ({ layer, g: { t: 'contour', c: transform(c, M) } })
  switch (e.type) {
    case 'LINE': {
      const a = P2(num(g, 10), num(g, 20))
      const b = P2(num(g, 11), num(g, 21))
      return segLength(line(a, b)) > 1e-9 ? [{ layer, g: { t: 'contour', c: { closed: false, segs: [line(a, b)] } } }] : []
    }
    case 'CIRCLE': {
      const c = P2(num(g, 10), num(g, 20))
      return [{ layer, g: { t: 'circle', c, r: num(g, 40) * uniformScale } }]
    }
    case 'ARC': {
      const segs = arcSeg({ x: num(g, 10), y: num(g, 20) }, num(g, 40), num(g, 50), num(g, 51))
      return [contour({ closed: false, segs })]
    }
    case 'LWPOLYLINE': {
      const pts: P[] = []
      const bulges: number[] = []
      for (const q of g) {
        if (q.code === 10) {
          pts.push({ x: Number(q.value), y: 0 })
          bulges.push(0)
        } else if (q.code === 20 && pts.length) pts[pts.length - 1].y = Number(q.value)
        else if (q.code === 42 && pts.length) bulges[bulges.length - 1] = Number(q.value)
      }
      if (pts.length < 2) return []
      const closed = (num(g, 70) & 1) === 1
      return [contour(cleanPoly(pts, bulges, closed))]
    }
    case 'POLYLINE': {
      const flags = num(g, 70)
      const verts = (e.vertices ?? []).filter((v) => (num(v, 70) & 16) === 0)
      const pts = verts.map((v) => ({ x: num(v, 10), y: num(v, 20) }))
      const bulges = verts.map((v) => num(v, 42))
      if (flags & (16 | 64)) {
        warn('Polygon mesh / polyface entities were skipped.')
        return []
      }
      if (pts.length < 2) return []
      return [contour(cleanPoly(pts, bulges, (flags & 1) === 1))]
    }
    case 'SPLINE': {
      const degree = num(g, 71, 3)
      const knots = all(g, 40)
      const weights = all(g, 41)
      const cx = all(g, 10)
      const cy = all(g, 20)
      const ctrl = cx.map((x, i) => ({ x, y: cy[i] ?? 0 }))
      const fx = all(g, 11)
      const fy = all(g, 21)
      let pts: P[]
      if (ctrl.length >= 2 && knots.length >= ctrl.length + Math.min(degree, ctrl.length - 1) + 1) pts = splineSamples(degree, knots, ctrl, weights)
      else if (fx.length >= 2) pts = fx.map((x, i) => ({ x, y: fy[i] ?? 0 }))
      else return []
      const closed = (num(g, 70) & 1) === 1 || (pts.length > 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-6)
      const segs = fitPoints(transformPts(pts, M), closed, 0.01)
      return segs.length ? [{ layer, g: { t: 'contour', c: { closed, segs } } }] : []
    }
    case 'ELLIPSE': {
      const c = { x: num(g, 10), y: num(g, 20) }
      const maj = { x: num(g, 11), y: num(g, 21) }
      const ratio = num(g, 40, 1)
      let t0 = num(g, 41, 0)
      let t1 = num(g, 42, Math.PI * 2)
      while (t1 <= t0 + 1e-12) t1 += 2 * Math.PI
      const full = t1 - t0 > 2 * Math.PI - 1e-6
      const a = Math.hypot(maj.x, maj.y)
      const rot = Math.atan2(maj.y, maj.x)
      const n = Math.min(20000, Math.max(64, Math.ceil(((t1 - t0) * a * Math.max(1, ratio)) / 0.25)))
      const pts: P[] = []
      for (let i = 0; i <= (full ? n - 1 : n); i++) {
        const t = t0 + ((t1 - t0) * i) / n
        const x = a * Math.cos(t)
        const y = a * ratio * Math.sin(t)
        pts.push({ x: c.x + x * Math.cos(rot) - y * Math.sin(rot), y: c.y + x * Math.sin(rot) + y * Math.cos(rot) })
      }
      const segs = fitPoints(transformPts(pts, M), full, 0.01)
      return [{ layer, g: { t: 'contour', c: { closed: full, segs } } }]
    }
    case 'POINT':
      return [{ layer, g: { t: 'point', p: P2(num(g, 10), num(g, 20)) } }]
    case 'TEXT':
    case 'MTEXT': {
      const raw = e.type === 'MTEXT' ? g.filter((q) => q.code === 3 || q.code === 1).map((q) => q.value).join('') : str(g, 1)
      const text = raw
        .replace(/\\[A-Za-z][^;\\]*;/g, '')
        .replace(/\\P/g, ' ')
        .replace(/[{}]/g, '')
        .replace(/%%[cC]/g, 'Ø')
        .replace(/%%[dD]/g, '°')
        .trim()
      if (!text) return []
      const at = P2(num(g, 10), num(g, 20))
      const rot = e.type === 'MTEXT' && g.some((q) => q.code === 11) ? Math.atan2(num(g, 21), num(g, 11)) : (num(g, 50) * Math.PI) / 180
      const dir = applyM(M, { x: num(g, 10) + Math.cos(rot), y: num(g, 20) + Math.sin(rot) })
      return [{ layer, g: { t: 'text', at, text, height: num(g, 40, 10) * uniformScale, angle: Math.atan2(dir.y - at.y, dir.x - at.x) } }]
    }
    case 'INSERT': {
      if (depth > 8) return []
      const name = str(g, 2)
      const blk = doc.blocks[name]
      if (!blk) {
        warn(`Block "${name}" is missing; its insert was skipped.`)
        return []
      }
      const sx = num(g, 41, 1)
      const sy = num(g, 42, 1)
      const rot = (num(g, 50) * Math.PI) / 180
      const cols = Math.max(1, num(g, 70, 1))
      const rows = Math.max(1, num(g, 71, 1))
      const dc = num(g, 44)
      const dr = num(g, 45)
      const out: Piece[] = []
      for (let r = 0; r < rows; r++)
        for (let k = 0; k < cols; k++) {
          const off = applyM(rotateM(rot), { x: k * dc, y: r * dr })
          const local = mulM(translateM(num(g, 10) + off.x, num(g, 20) + off.y), mulM(rotateM(rot), mulM(scaleM(sx, sy), translateM(-blk.base.x, -blk.base.y))))
          const tf = mulM(M, local)
          for (const be of blk.entities) out.push(...convert(be, doc, tf, layer, depth + 1, warn))
        }
      return out
    }
    default:
      return []
  }
}

function transformPts(pts: P[], m: Mat) {
  return pts.map((p) => applyM(m, p))
}

/** Polyline with bulges; drops zero-length pieces and the duplicated closing vertex. */
function cleanPoly(pts: P[], bulges: number[], closed: boolean): Contour {
  if (closed && pts.length > 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-9) {
    pts = pts.slice(0, -1)
    bulges = bulges.slice(0, -1)
  }
  const c = fromBulges(pts, bulges, closed)
  return { ...c, segs: c.segs.filter((s) => segLength(s) > 1e-9) }
}

// ---------------------------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------------------------

export interface DxfImportOptions {
  /** Ends closer than this are joined (mm). */
  joinTol: number
  /** Only join pieces that continue tangentially (keeps sharp corners as separate shapes). */
  tangentOnly: boolean
  /** Merge consecutive collinear lines and co-circular arcs into single elements. */
  combine: boolean
  /** Drawing units; 'auto' uses $INSUNITS and falls back to mm. */
  units: 'auto' | 'mm' | 'in' | 'cm' | 'm'
  /** Layers to leave out (case-insensitive names). */
  skipLayers: string[]
}

export const DEFAULT_DXF_OPTIONS: DxfImportOptions = { joinTol: 0.05, tangentOnly: false, combine: true, units: 'auto', skipLayers: [] }

export interface DxfImport {
  entities: Entity[]
  layers: Layer[]
  warnings: string[]
  unitName: string
  scale: number
  skipped: Record<string, number>
  counts: { read: number; open: number; closed: number; circles: number }
}

const ACI: Record<number, string> = { 1: '#ef4444', 2: '#facc15', 3: '#22c55e', 4: '#22d3ee', 5: '#3b82f6', 6: '#d946ef', 7: '#e2e8f0', 8: '#71717a', 9: '#a1a1aa' }
const SUPPORTED = new Set(['LINE', 'CIRCLE', 'ARC', 'LWPOLYLINE', 'POLYLINE', 'SPLINE', 'ELLIPSE', 'POINT', 'TEXT', 'MTEXT', 'INSERT'])

export const layerIdFor = (name: string) => `dxf-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

export function tangentJoint(maxDeg = 2) {
  const c = Math.cos((maxDeg * Math.PI) / 180)
  return (a: Seg, b: Seg) => dot(unit(tangentAt(a, 1)), unit(tangentAt(b, 0))) >= c
}

export function importDxf(text: string, opts: Partial<DxfImportOptions> = {}): DxfImport {
  const o = { ...DEFAULT_DXF_OPTIONS, ...opts }
  const doc = parseDxf(text)
  const warnings: string[] = []
  const warn = (s: string) => !warnings.includes(s) && warnings.push(s)
  const skipped: Record<string, number> = {}
  const ins = doc.header.$INSUNITS ? num(doc.header.$INSUNITS, 70) : 0
  const auto = unitScale(ins)
  const fixed = { mm: { scale: 1, name: 'millimetres' }, in: { scale: 25.4, name: 'inches' }, cm: { scale: 10, name: 'centimetres' }, m: { scale: 1000, name: 'metres' } }
  const u = o.units === 'auto' ? (auto ?? { scale: 1, name: 'millimetres (no unit in file)' }) : fixed[o.units]
  const S: Mat = [u.scale, 0, 0, u.scale, 0, 0]
  const skip = new Set(o.skipLayers.map((s) => s.toLowerCase()))
  const pieces: Piece[] = []
  for (const e of doc.entities) {
    if (!SUPPORTED.has(e.type)) {
      skipped[e.type] = (skipped[e.type] ?? 0) + 1
      continue
    }
    for (const p of convert(e, doc, S, null, 0, warn)) if (!skip.has(p.layer.toLowerCase())) pieces.push(p)
  }
  for (const [t, n] of Object.entries(skipped)) warn(`${n} ${t} entit${n === 1 ? 'y' : 'ies'} not imported.`)

  const byLayer = new Map<string, Piece[]>()
  for (const p of pieces) byLayer.set(p.layer, [...(byLayer.get(p.layer) ?? []), p])
  const entities: Entity[] = []
  const counts = { read: pieces.length, open: 0, closed: 0, circles: 0 }
  for (const [name, ps] of byLayer) {
    const id = layerIdFor(name)
    const chains = ps.filter((p) => p.g.t === 'contour').map((p) => (p.g as { c: Contour }).c)
    let joined = o.joinTol > 0 ? joinContours(chains, o.joinTol, o.tangentOnly ? tangentJoint() : undefined) : chains
    if (o.combine) joined = joined.map((c) => combine(c))
    for (const c of joined) {
      entities.push(makeEntity({ t: 'contour', c }, id))
      if (c.closed) counts.closed++
      else counts.open++
    }
    for (const p of ps)
      if (p.g.t !== 'contour') {
        entities.push(makeEntity(p.g, id))
        if (p.g.t === 'circle') counts.circles++
      }
  }
  const layers: Layer[] = [...byLayer.keys()].map((name) => {
    const t = doc.layers.find((l) => l.name === name)
    return { id: layerIdFor(name), name, color: ACI[Math.abs(t?.color ?? 7)] ?? '#94a3b8', visible: true, locked: false }
  })
  return { entities, layers, warnings, unitName: u.name, scale: u.scale, skipped, counts }
}

function combine(c: Contour): Contour {
  let segs = mergeSegs(c.segs, 0.005)
  if (c.closed && segs.length > 1) {
    const m = mergeSegs([segs[segs.length - 1], segs[0]], 0.005)
    if (m.length === 1) segs = [m[0], ...segs.slice(1, -1)]
  }
  return { closed: c.closed, segs }
}

/** Build a custom part from a DXF: outline = largest closed shape (optionally on one layer). */
export function dxfToPart(text: string, name: string, opts: Partial<DxfImportOptions> & ImportedPartOptions = {}): { part: CamPart; report: DxfImport } {
  const report = importDxf(text, opts)
  const { part, warnings } = importedPart(name, report.entities, report.layers, 'DXF import', opts)
  report.warnings.push(...warnings)
  return { part, report }
}

export interface ImportedPartOptions {
  outlineLayer?: string
  thickness?: number
}

/** Wrap imported shapes in a part: outline = largest closed shape, work volume fitted, origin at lower-left. */
export function importedPart(name: string, entities: Entity[], layers: Layer[], source: string, opts: ImportedPartOptions = {}): { part: CamPart; warnings: string[] } {
  const warnings: string[] = []
  let part = newPart({ name, entities, layers, thickness: opts.thickness ?? 19, source })
  const candidates = part.entities.filter((e) => (!opts.outlineLayer || layerOf(part, e.layer)?.name.toLowerCase() === opts.outlineLayer.toLowerCase()) && entityContours(e).some((c) => c.closed))
  let best: { id: string; a: number } | null = null
  for (const e of candidates) {
    const b = boxOf(entityContours(e))
    const a = (b.maxX - b.minX) * (b.maxY - b.minY)
    if (!best || a > best.a) best = { id: e.id, a }
  }
  part = { ...part, outlineId: best?.id }
  if (!best) warnings.push('No closed outline found; the part uses the drawing extents.')
  const b = boxOf(part.entities.flatMap(entityContours))
  if (!Number.isFinite(b.minX)) return { part, warnings }
  part = { ...part, length: b.maxX - b.minX, width: b.maxY - b.minY }
  if (best) return { part: fitWorkVolume(part), warnings }
  const m = translateM(-b.minX, -b.minY)
  return { part: { ...part, entities: part.entities.map((e) => transformEntity(e, m)) }, warnings }
}

// ---------------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------------

export interface DxfExportOptions {
  /** Include tool-centre paths (one layer per operation). */
  toolpaths?: { name: string; contours: Contour[] }[]
  includeConstruction?: boolean
}

const dxfName = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '_').toUpperCase().slice(0, 31) || 'LAYER'

export function exportDxf(part: CamPart, opts: DxfExportOptions = {}): string {
  const out: (string | number)[] = []
  const g = (code: number, v: string | number) => out.push(code, typeof v === 'number' ? fmt(v) : v)
  const layerNames = new Map<string, string>()
  for (const l of part.layers) if (opts.includeConstruction || !l.construction) layerNames.set(l.id, dxfName(l.name))
  for (const t of opts.toolpaths ?? []) layerNames.set(`tp-${t.name}`, dxfName(`TOOLPATH_${t.name}`))

  g(0, 'SECTION')
  g(2, 'HEADER')
  g(9, '$ACADVER')
  g(1, 'AC1009')
  g(9, '$INSUNITS')
  g(70, 4)
  g(9, '$MEASUREMENT')
  g(70, 1)
  const b = boxOf(part.entities.flatMap(entityContours))
  g(9, '$EXTMIN')
  g(10, Number.isFinite(b.minX) ? b.minX : 0)
  g(20, Number.isFinite(b.minY) ? b.minY : 0)
  g(9, '$EXTMAX')
  g(10, Number.isFinite(b.maxX) ? b.maxX : part.length)
  g(20, Number.isFinite(b.maxY) ? b.maxY : part.width)
  g(0, 'ENDSEC')
  g(0, 'SECTION')
  g(2, 'TABLES')
  g(0, 'TABLE')
  g(2, 'LAYER')
  g(70, layerNames.size + 1)
  for (const [id, name] of [['0', '0'], ...layerNames]) {
    g(0, 'LAYER')
    g(2, name)
    g(70, 0)
    g(62, id.startsWith('tp-') ? 4 : id === part.layers[0]?.id ? 7 : 3)
    g(6, 'CONTINUOUS')
  }
  g(0, 'ENDTAB')
  g(0, 'ENDSEC')
  g(0, 'SECTION')
  g(2, 'ENTITIES')

  const writeSegs = (segs: Seg[], layer: string) => {
    for (const s of segs) {
      if (s.k === 'L') {
        g(0, 'LINE')
        g(8, layer)
        g(10, s.a.x)
        g(20, s.a.y)
        g(30, 0)
        g(11, s.b.x)
        g(21, s.b.y)
        g(31, 0)
      } else {
        const ccw = s.ccw
        const from = ccw ? s.a : s.b
        const to = ccw ? s.b : s.a
        let a0 = (Math.atan2(from.y - s.c.y, from.x - s.c.x) * 180) / Math.PI
        let a1 = (Math.atan2(to.y - s.c.y, to.x - s.c.x) * 180) / Math.PI
        if (a0 < 0) a0 += 360
        if (a1 < 0) a1 += 360
        if (Math.abs(Math.abs(sweep(s)) - 2 * Math.PI) < 1e-9) {
          g(0, 'CIRCLE')
          g(8, layer)
          g(10, s.c.x)
          g(20, s.c.y)
          g(30, 0)
          g(40, radius(s))
          continue
        }
        g(0, 'ARC')
        g(8, layer)
        g(10, s.c.x)
        g(20, s.c.y)
        g(30, 0)
        g(40, radius(s))
        g(50, a0)
        g(51, a1)
      }
    }
  }

  for (const e of part.entities) {
    const name = layerNames.get(e.layer)
    if (!name || e.face !== 1) continue
    if (e.g.t === 'circle') {
      g(0, 'CIRCLE')
      g(8, name)
      g(10, e.g.c.x)
      g(20, e.g.c.y)
      g(30, 0)
      g(40, e.g.r)
    } else if (e.g.t === 'point') {
      g(0, 'POINT')
      g(8, name)
      g(10, e.g.p.x)
      g(20, e.g.p.y)
      g(30, 0)
    } else if (e.g.t === 'text' && !e.g.font) {
      g(0, 'TEXT')
      g(8, name)
      g(10, e.g.at.x)
      g(20, e.g.at.y)
      g(30, 0)
      g(40, e.g.height)
      g(1, e.g.text.replace(/[^\x20-\x7e]/g, '?'))
      g(50, (e.g.angle * 180) / Math.PI)
    } else for (const c of entityContours(e)) writeSegs(c.segs, name)
  }
  for (const t of opts.toolpaths ?? []) for (const c of t.contours) writeSegs(c.segs, layerNames.get(`tp-${t.name}`)!)
  g(0, 'ENDSEC')
  g(0, 'EOF')
  return out.join('\r\n') + '\r\n'
}

const fmt = (n: number) => {
  const r = Math.round(n * 1e6) / 1e6
  return Object.is(r, -0) ? '0' : String(r)
}
