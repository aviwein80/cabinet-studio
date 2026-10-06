/**
 * Panelling (NEW-05): geometry larger than a sheet is split into sheet-sized panels. Neighbouring
 * panels overlap by a set amount; closed shapes cut by a join are closed again along it (each
 * panel gets a closed piece it can be cut out by), open shapes are cut into pieces, circles and
 * text go whole to the panel that holds them. Each panel becomes its own part (moved to start at
 * 0,0), with the operations of the original that machine its shapes.
 */
import { nanoid } from 'nanoid'
import { entityContours, newPart } from './doc'
import { boolean } from './kernel'
import { boxOf, type Contour, fitPoints, type P, rect, toPoints, transform, translateM } from './geom'
import type { CamOp, CamPart, Entity } from './types'

export interface PanelOptions {
  /** Largest panel, mm (e.g. the sheet less its trim). */
  length: number
  width: number
  /** Overlap between neighbouring panels, mm. */
  overlap: number
}

export interface Panel {
  row: number
  col: number
  /** The panel's area in the original part's coordinates. */
  box: { x: number; y: number; w: number; h: number }
  part: CamPart
}

/** Panels along one direction: start positions so that each is at most `size` and neighbours overlap by `overlap`. */
export function panelStarts(from: number, to: number, size: number, overlap: number): number[] {
  const total = to - from
  if (total <= size + 1e-9) return [from]
  const n = Math.ceil((total - overlap) / (size - overlap) - 1e-9)
  // equal panels (each <= size) with exactly `overlap` between neighbours
  const each = (total + (n - 1) * overlap) / n
  return Array.from({ length: n }, (_, i) => from + i * (each - overlap)).map((x) => Math.round(x * 1e6) / 1e6)
}

export function panelSize(from: number, to: number, size: number, overlap: number): number {
  const starts = panelStarts(from, to, size, overlap)
  return starts.length === 1 ? to - from : (to - from + (starts.length - 1) * overlap) / starts.length
}

/** Cut an open contour to a box: the pieces inside (refitted to lines and arcs). */
function clipOpen(c: Contour, b: { x0: number; y0: number; x1: number; y1: number }): Contour[] {
  const pts = toPoints(c, 0.005)
  const out: Contour[] = []
  let cur: P[] = []
  const flush = () => {
    if (cur.length > 1) {
      const segs = fitPoints(cur, false)
      if (segs.length) out.push({ closed: false, segs })
    }
    cur = []
  }
  for (let i = 0; i + 1 < pts.length; i++) {
    const seg = clipSeg(pts[i], pts[i + 1], b)
    if (!seg) {
      flush()
      continue
    }
    const [a, q] = seg
    if (cur.length && Math.hypot(cur[cur.length - 1].x - a.x, cur[cur.length - 1].y - a.y) < 1e-9) cur.push(q)
    else {
      flush()
      cur = [a, q]
    }
  }
  flush()
  return out
}

/** The part of a straight piece inside a box (Liang-Barsky), or null. */
function clipSeg(a: P, c: P, b: { x0: number; y0: number; x1: number; y1: number }): [P, P] | null {
  let t0 = 0
  let t1 = 1
  const dx = c.x - a.x
  const dy = c.y - a.y
  for (const [p, q] of [
    [-dx, a.x - b.x0],
    [dx, b.x1 - a.x],
    [-dy, a.y - b.y0],
    [dy, b.y1 - a.y],
  ]) {
    if (Math.abs(p) < 1e-15) {
      if (q < 0) return null
      continue
    }
    const r = q / p
    if (p < 0) t0 = Math.max(t0, r)
    else t1 = Math.min(t1, r)
    if (t0 > t1) return null
  }
  if (t1 - t0 < 1e-12) return null
  return [
    { x: a.x + dx * t0, y: a.y + dy * t0 },
    { x: a.x + dx * t1, y: a.y + dy * t1 },
  ]
}

/**
 * Split the part's face-1 shapes into panels. `ids`: the shapes to split (default: every shape on
 * face 1). Returns one part per panel that holds anything.
 */
export function panelize(part: CamPart, opt: PanelOptions, ids?: string[]): { panels: Panel[]; error?: string } {
  if (!(opt.length > 0 && opt.width > 0)) return { panels: [], error: 'The panel size must be above zero.' }
  if (!(opt.overlap >= 0) || opt.overlap >= Math.min(opt.length, opt.width) / 2) return { panels: [], error: 'The overlap must be less than half the panel size.' }
  const picked = part.entities.filter((e) => e.face === 1 && (!ids || ids.includes(e.id)) && e.g.t !== 'poly3d')
  const cs = picked.flatMap(entityContours).filter((c) => c.segs.length)
  if (!cs.length) return { panels: [], error: 'Nothing to split.' }
  const bb = boxOf(cs)
  const xs = panelStarts(bb.minX, bb.maxX, opt.length, opt.overlap)
  const ys = panelStarts(bb.minY, bb.maxY, opt.width, opt.overlap)
  const pw = panelSize(bb.minX, bb.maxX, opt.length, opt.overlap)
  const ph = panelSize(bb.minY, bb.maxY, opt.width, opt.overlap)
  const panels: Panel[] = []
  for (let row = 0; row < ys.length; row++)
    for (let col = 0; col < xs.length; col++) {
      const box = { x: xs[col], y: ys[row], w: pw, h: ph }
      const tile = rect(box.x, box.y, box.w, box.h)
      const lim = { x0: box.x, y0: box.y, x1: box.x + box.w, y1: box.y + box.h }
      const move = translateM(-box.x, -box.y)
      const made: Entity[] = []
      const from = new Map<string, string[]>()
      const keep = (src: Entity, e: Entity) => {
        made.push(e)
        from.set(src.id, [...(from.get(src.id) ?? []), e.id])
      }
      for (const e of picked) {
        const ecs = entityContours(e).filter((c) => c.segs.length)
        const eb = ecs.length ? boxOf(ecs) : null
        const whole = eb && eb.minX >= lim.x0 - 1e-9 && eb.maxX <= lim.x1 + 1e-9 && eb.minY >= lim.y0 - 1e-9 && eb.maxY <= lim.y1 + 1e-9
        if (e.g.t === 'point' || e.g.t === 'text') {
          const at = e.g.t === 'point' ? e.g.p : e.g.at
          // text and points belong to the first panel that holds their anchor
          const first = xs.findIndex((x) => at.x >= x - 1e-9 && at.x <= x + pw + 1e-9) === col && ys.findIndex((y) => at.y >= y - 1e-9 && at.y <= y + ph + 1e-9) === row
          if (first) keep(e, { ...structuredClone(e), id: nanoid(10), g: e.g.t === 'point' ? { t: 'point', p: { x: at.x - box.x, y: at.y - box.y } } : { ...e.g, at: { x: at.x - box.x, y: at.y - box.y } } })
          continue
        }
        if (!eb || eb.maxX < lim.x0 || eb.minX > lim.x1 || eb.maxY < lim.y0 || eb.minY > lim.y1) continue
        if (whole) {
          // wholly on this panel: as it is (circles stay circles)
          const g = e.g.t === 'circle' ? { t: 'circle' as const, c: { x: e.g.c.x - box.x, y: e.g.c.y - box.y }, r: e.g.r } : { t: 'contour' as const, c: transform(ecs[0], move) }
          if (e.g.t !== 'circle' && ecs.length > 1) for (const c of ecs) keep(e, { ...structuredClone(e), id: nanoid(10), g: { t: 'contour', c: transform(c, move) } })
          else keep(e, { ...structuredClone(e), id: nanoid(10), g })
          continue
        }
        for (const c of ecs) {
          const pieces = c.closed ? boolean('intersect', [c], [tile]) : clipOpen(c, lim)
          for (const pc of pieces) keep(e, { ...structuredClone(e), id: nanoid(10), g: { t: 'contour', c: transform(pc, move) } })
        }
      }
      if (!made.length) continue
      const p = newPart({
        ...structuredClone({ ...part, entities: [], ops: [], dims: undefined, sketches: undefined, models: undefined, outlineId: undefined, door: undefined, workVolume: undefined }),
        id: nanoid(10),
        name: `${part.name} panel ${row + 1}-${col + 1}`,
        length: Math.round(box.w * 1000) / 1000,
        width: Math.round(box.h * 1000) / 1000,
      })
      p.entities = made
      // the original's operations on the shapes of this panel (geometry follows the pieces)
      p.ops = part.ops
        .filter((o) => o.kind === 'code' || o.geometry.some((g) => from.has(g)))
        .map((o) => ({ ...structuredClone(o), id: nanoid(8), geometry: o.geometry.flatMap((g) => from.get(g) ?? []), builtHash: undefined }) as CamOp)
        .filter((o) => o.kind === 'code' || o.geometry.length)
      panels.push({ row, col, box, part: p })
    }
  return { panels }
}

