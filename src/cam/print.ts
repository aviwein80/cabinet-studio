/**
 * Print to scale (CAD-08): the part's face-1 drawing (and its dimensions) on paper at 1:N, split
 * over as many sheets as it needs with crop marks so full-size templates can be taped together.
 * Every sheet carries a check bar of a known length: measure it with a rule before trusting the
 * print (printers are told "actual size"; any scaling by the printer shows on the bar).
 */
import { jsPDF } from 'jspdf'
import { formatInches } from '@/core/units'
import type { UnitSystem } from '@/core/types'
import { dimText, measureDim } from './dims'
import { entityContours, layerOf } from './doc'
import { boxOf, type P, toPoints } from './geom'
import type { CamPart } from './types'

export const PAPER = {
  letter: { w: 215.9, h: 279.4, label: 'Letter' },
  tabloid: { w: 279.4, h: 431.8, label: 'Tabloid / 11 x 17' },
  a4: { w: 210, h: 297, label: 'A4' },
  a3: { w: 297, h: 420, label: 'A3' },
} as const
export type PaperSize = keyof typeof PAPER

export interface PrintOptions {
  /** 1:N (1 = full size). */
  scale: number
  paper: PaperSize
  landscape: boolean
  /** Paper margin, mm. */
  margin: number
  dims: boolean
  units: UnitSystem
  /** Overlap between neighbouring sheets, mm of paper (for taping). */
  overlap: number
}

export const DEFAULT_PRINT: PrintOptions = { scale: 1, paper: 'letter', landscape: true, margin: 12, dims: true, units: 'mm', overlap: 10 }

export interface PrintPage {
  /** Part point (mm) at the drawing area's lower-left corner. */
  origin: P
  row: number
  col: number
  /** Polylines in paper mm (y down from the top of the paper), clipped to the drawing area. */
  lines: P[][]
  texts: { at: P; text: string; angle: number }[]
}

export interface PrintPlan {
  paper: { w: number; h: number }
  /** Drawing area on each sheet (paper mm). */
  area: { x: number; y: number; w: number; h: number }
  rows: number
  cols: number
  pages: PrintPage[]
  /** The check bar: its length on paper (mm) and what it says. */
  bar: { length: number; label: string }
}

/** Shapes and dimensions of face 1 as part-mm polylines and texts. */
function drawing(part: CamPart, opt: PrintOptions) {
  const lines: P[][] = []
  for (const e of part.entities) {
    if (e.face !== 1 || layerOf(part, e.layer)?.visible === false) continue
    for (const c of entityContours(e)) {
      const pts = toPoints(c, 0.05)
      if (pts.length > 1) lines.push(c.closed ? [...pts, pts[0]] : pts)
    }
  }
  const texts: PrintPage['texts'] = []
  if (opt.dims)
    for (const d of part.dims ?? []) {
      const g = measureDim(part, d)
      if (!g) continue
      for (const l of g.lines) lines.push([l[0], l[1]])
      for (const a of g.arcs) {
        const n = Math.max(8, Math.ceil(Math.abs(a.a1 - a.a0) * 12))
        lines.push(Array.from({ length: n + 1 }, (_, i) => ({ x: a.c.x + a.r * Math.cos(a.a0 + ((a.a1 - a.a0) * i) / n), y: a.c.y + a.r * Math.sin(a.a0 + ((a.a1 - a.a0) * i) / n) })))
      }
      for (const a of g.arrows) {
        const s = 2.5 * opt.scale
        const l = (k: number) => ({ x: a.at.x - s * Math.cos(a.dir + k), y: a.at.y - s * Math.sin(a.dir + k) })
        lines.push([l(0.35), a.at, l(-0.35)])
      }
      texts.push({ at: g.text, text: dimText(d, g, opt.units), angle: g.textDir })
    }
  return { lines, texts }
}

/** Keep the parts of a polyline inside a box (each piece is its own polyline). */
function clip(poly: P[], b: { x0: number; y0: number; x1: number; y1: number }): P[][] {
  const out: P[][] = []
  let cur: P[] = []
  for (let i = 0; i + 1 < poly.length; i++) {
    const seg = clipSeg(poly[i], poly[i + 1], b)
    if (!seg) {
      if (cur.length > 1) out.push(cur)
      cur = []
      continue
    }
    const [a, c] = seg
    if (cur.length && Math.hypot(cur[cur.length - 1].x - a.x, cur[cur.length - 1].y - a.y) < 1e-9) cur.push(c)
    else {
      if (cur.length > 1) out.push(cur)
      cur = [a, c]
    }
  }
  if (cur.length > 1) out.push(cur)
  return out
}

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
  return [
    { x: a.x + dx * t0, y: a.y + dy * t0 },
    { x: a.x + dx * t1, y: a.y + dy * t1 },
  ]
}

/** Lay the drawing out on sheets at 1:`scale`. */
export function printPlan(part: CamPart, opt: PrintOptions): PrintPlan {
  const pp = PAPER[opt.paper]
  const paper = opt.landscape ? { w: pp.h, h: pp.w } : { w: pp.w, h: pp.h }
  const foot = 12
  const area = { x: opt.margin, y: opt.margin, w: paper.w - 2 * opt.margin, h: paper.h - 2 * opt.margin - foot }
  const { lines, texts } = drawing(part, opt)
  const all = lines.flat()
  const box = all.length ? boxOf([{ closed: false, segs: all.slice(1).map((b, i) => ({ k: 'L' as const, a: all[i], b })) }]) : { minX: 0, minY: 0, maxX: part.length, maxY: part.width }
  const pad = 5 * opt.scale
  let x0 = box.minX - pad
  let y0 = box.minY - pad
  // each sheet shows area less the overlap of new drawing (paper mm), i.e. that times N of the part
  const stepX = (area.w - opt.overlap) * opt.scale
  const stepY = (area.h - opt.overlap) * opt.scale
  const cols = Math.max(1, Math.ceil((box.maxX + pad - x0 - opt.overlap * opt.scale) / stepX - 1e-9))
  const rows = Math.max(1, Math.ceil((box.maxY + pad - y0 - opt.overlap * opt.scale) / stepY - 1e-9))
  // one sheet: the drawing in the middle of it
  if (cols === 1 && rows === 1) {
    x0 = (box.minX + box.maxX) / 2 - (area.w * opt.scale) / 2
    y0 = (box.minY + box.maxY) / 2 - (area.h * opt.scale) / 2
  }
  const pages: PrintPage[] = []
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const origin = { x: x0 + col * stepX, y: y0 + row * stepY }
      // part mm -> paper mm (y down)
      const toPaper = (p: P): P => ({ x: area.x + (p.x - origin.x) / opt.scale, y: area.y + area.h - (p.y - origin.y) / opt.scale })
      const b = { x0: area.x, y0: area.y, x1: area.x + area.w, y1: area.y + area.h }
      const pl = lines.flatMap((l) => clip(l.map(toPaper), b))
      const tx = texts.map((t) => ({ ...t, at: toPaper(t.at) })).filter((t) => t.at.x >= b.x0 && t.at.x <= b.x1 && t.at.y >= b.y0 && t.at.y <= b.y1)
      pages.push({ origin, row, col, lines: pl, texts: tx })
    }
  const bar = opt.units === 'in' ? { length: 4 * 25.4, label: `Check bar: ${formatInches(4 * 25.4)} on paper` } : { length: 100, label: 'Check bar: 100 mm on paper' }
  return { paper, area, rows, cols, pages, bar }
}

/** The plan as a PDF (paper in mm; "actual size" printing keeps the scale). */
export function printPdf(part: CamPart, plan: PrintPlan, opt: PrintOptions): Uint8Array {
  const doc = new jsPDF({ unit: 'mm', format: [plan.paper.w, plan.paper.h], orientation: plan.paper.w > plan.paper.h ? 'landscape' : 'portrait' })
  doc.setCreationDate('D:20260101000000+00\'00\'')
  doc.setFileId('CAB1E7570D10914700000000000000AA')
  plan.pages.forEach((pg, i) => {
    if (i) doc.addPage([plan.paper.w, plan.paper.h], plan.paper.w > plan.paper.h ? 'landscape' : 'portrait')
    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(0.2)
    for (const l of pg.lines) for (let k = 0; k + 1 < l.length; k++) doc.line(l[k].x, l[k].y, l[k + 1].x, l[k + 1].y)
    doc.setFontSize(8)
    for (const t of pg.texts) {
      // keep the text readable: never upside down
      let a = (-t.angle * 180) / Math.PI
      a = ((a % 360) + 360) % 360
      if (a > 90 && a <= 270) a -= 180
      doc.text(t.text, t.at.x, t.at.y - 1, { angle: -a, align: 'center' })
    }
    // crop marks at the drawing area's corners (line up the next sheet here)
    const A = plan.area
    doc.setLineWidth(0.1)
    for (const [x, y] of [
      [A.x, A.y],
      [A.x + A.w, A.y],
      [A.x, A.y + A.h],
      [A.x + A.w, A.y + A.h],
    ]) {
      doc.line(x - 4, y, x + 4, y)
      doc.line(x, y - 4, x, y + 4)
    }
    // where the next sheet's drawing starts (the overlap strip, for taping sheets together)
    if (opt.overlap > 0) {
      doc.setLineDashPattern([1.5, 1.5], 0)
      if (pg.col < plan.cols - 1) doc.line(A.x + A.w - opt.overlap, A.y, A.x + A.w - opt.overlap, A.y + A.h)
      if (pg.row < plan.rows - 1) doc.line(A.x, A.y + opt.overlap, A.x + A.w, A.y + opt.overlap)
      doc.setLineDashPattern([], 0)
    }
    // footer: the check bar and what this sheet is
    const fy = A.y + A.h + 7
    doc.setLineWidth(0.4)
    doc.line(A.x, fy, A.x + plan.bar.length, fy)
    doc.line(A.x, fy - 1.5, A.x, fy + 1.5)
    doc.line(A.x + plan.bar.length, fy - 1.5, A.x + plan.bar.length, fy + 1.5)
    doc.setFontSize(7)
    doc.text(plan.bar.label, A.x + plan.bar.length + 3, fy + 1)
    doc.text(`${part.name} · scale 1:${opt.scale} · sheet ${i + 1} of ${plan.pages.length} (row ${pg.row + 1}, column ${pg.col + 1}) · print at actual size`, A.x + A.w, fy + 1, { align: 'right' })
  })
  return new Uint8Array(doc.output('arraybuffer'))
}
