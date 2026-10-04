/**
 * Vector paths out of PDF (and Illustrator files saved with PDF content) through pdf.js
 * (Apache-2.0). Lines stay lines, Bezier curves are flattened and re-fitted to lines and arcs,
 * shapes are grouped into layers by stroke / fill colour. Page units (points) become mm.
 */
import { makeEntity } from './doc'
import { applyM, type Contour, fitPoints, type Mat, mulM, type P, polyline } from './geom'
import type { Entity, Layer } from './types'

/** The subset of pdf.js this module needs (legacy build in tests, worker build in the app). */
export interface PdfLib {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean; useWorkerFetch?: boolean }): { promise: Promise<PdfDoc> }
  OPS: Record<string, number>
}
interface PdfDoc {
  numPages: number
  getPage(n: number): Promise<{ view: number[]; userUnit?: number; getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }> }>
}

export interface PdfVectors {
  pages: number
  entities: Entity[]
  layers: Layer[]
  warnings: string[]
  /** Pages with text but no vector paths (likely scans or text-only spec sheets). */
  textOnly: boolean
}

const PT = 25.4 / 72
const MOVE = 0
const LINE = 1
const CURVE = 2
const QUAD = 3
const CLOSE = 4

function cubic(a: P, b: P, c: P, d: P, n: number): P[] {
  const out: P[] = []
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    out.push({ x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x, y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y })
  }
  return out
}

const hex = (v: unknown) => (typeof v === 'string' ? v : Array.isArray(v) ? `#${v.map((n) => Math.round(Number(n)).toString(16).padStart(2, '0')).join('')}` : '#000000')

/** Read every path on the chosen pages. */
export async function pdfVectors(lib: PdfLib, data: Uint8Array, opts: { pages?: number[]; tol?: number } = {}): Promise<PdfVectors> {
  const doc = await lib.getDocument({ data, isEvalSupported: false, useWorkerFetch: false }).promise
  const O = lib.OPS
  const pages = opts.pages ?? Array.from({ length: doc.numPages }, (_, i) => i + 1)
  const tol = opts.tol ?? 0.02
  const entities: Entity[] = []
  const layerIds = new Map<string, string>()
  const warnings: string[] = []
  let anyText = false
  let yOffset = 0
  for (const n of pages) {
    const page = await doc.getPage(n)
    const unit = (page.userUnit ?? 1) * PT
    const list = await page.getOperatorList()
    let ctm: Mat = [1, 0, 0, 1, 0, 0]
    const stack: Mat[] = []
    let stroke = '#000000'
    let fill = '#000000'
    const toMm = (x: number, y: number): P => {
      const q = applyM(ctm, { x, y })
      return { x: (q.x - page.view[0]) * unit, y: (q.y - page.view[1]) * unit + yOffset }
    }
    for (let i = 0; i < list.fnArray.length; i++) {
      const fn = list.fnArray[i]
      const args = list.argsArray[i] ?? []
      if (fn === O.save) stack.push(ctm)
      else if (fn === O.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0]
      else if (fn === O.transform) ctm = mulM(ctm, args.slice(0, 6).map(Number) as Mat)
      else if (fn === O.paintFormXObjectBegin) {
        stack.push(ctm)
        if (Array.isArray(args[0])) ctm = mulM(ctm, (args[0] as number[]).slice(0, 6) as Mat)
      } else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0]
      else if (fn === O.setStrokeRGBColor) stroke = hex(args[0] ?? args)
      else if (fn === O.setFillRGBColor) fill = hex(args[0] ?? args)
      else if (fn === O.showText || fn === O.beginText) anyText = true
      else if (fn === O.constructPath) {
        const paint = Number(args[0])
        const raw = (Array.isArray(args[1]) ? args[1][0] : args[1]) as ArrayLike<number> | undefined
        if (!raw) continue
        const filled = paint === O.fill || paint === O.eoFill || paint === O.fillStroke || paint === O.eoFillStroke
        const colour = paint === O.stroke || paint === O.closeStroke || paint === O.fillStroke ? stroke : filled ? fill : stroke
        const layerName = `${filled ? 'Fill' : 'Line'} ${colour}`
        if (!layerIds.has(layerName)) layerIds.set(layerName, `pdf-${layerIds.size + 1}`)
        for (const c of subpaths(raw, toMm, tol)) entities.push(makeEntity({ t: 'contour', c }, layerIds.get(layerName)!))
      }
    }
    const b = page.view
    yOffset -= (b[3] - b[1]) * unit + 20
  }
  const palette = ['#e2e8f0', '#38bdf8', '#f59e0b', '#a78bfa', '#34d399', '#f472b6']
  const layers: Layer[] = [...layerIds].map(([name, id], i) => ({ id, name, color: /#[0-9a-f]{6}/i.test(name.split(' ')[1]) && name.split(' ')[1] !== '#000000' ? name.split(' ')[1] : palette[i % palette.length], visible: true, locked: false }))
  if (!entities.length) warnings.push(anyText ? 'The PDF has text but no vector drawing on these pages (it may be a scan or a text-only sheet).' : 'No vector paths found.')
  return { pages: doc.numPages, entities, layers, warnings, textOnly: !entities.length && anyText }
}

function subpaths(d: ArrayLike<number>, toMm: (x: number, y: number) => P, tol: number): Contour[] {
  const out: Contour[] = []
  let pts: P[] = []
  let hasCurve = false
  let cur: P = { x: 0, y: 0 }
  let start: P = cur
  const flush = (closePath: boolean) => {
    let closed = closePath
    if (pts.length >= 2) {
      const clean = pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 1e-6)
      const meets = clean.length > 2 && Math.hypot(clean[0].x - clean[clean.length - 1].x, clean[0].y - clean[clean.length - 1].y) < 1e-3
      if (meets) {
        clean.pop()
        closed = true
      }
      if (clean.length >= 2) {
        if (hasCurve) {
          const segs = fitPoints(clean, closed && clean.length > 2, tol)
          if (segs.length) out.push({ closed: closed && clean.length > 2, segs })
        } else out.push(polyline(clean, closed && clean.length > 2))
      }
    }
    pts = []
    hasCurve = false
  }
  let i = 0
  while (i < d.length) {
    const op = d[i++]
    if (op === MOVE) {
      flush(false)
      cur = toMm(d[i], d[i + 1])
      start = cur
      pts = [cur]
      i += 2
    } else if (op === LINE) {
      cur = toMm(d[i], d[i + 1])
      pts.push(cur)
      i += 2
    } else if (op === CURVE) {
      const b = toMm(d[i], d[i + 1])
      const c = toMm(d[i + 2], d[i + 3])
      const e = toMm(d[i + 4], d[i + 5])
      const len = Math.hypot(b.x - cur.x, b.y - cur.y) + Math.hypot(c.x - b.x, c.y - b.y) + Math.hypot(e.x - c.x, e.y - c.y)
      pts.push(...cubic(cur, b, c, e, Math.max(8, Math.min(96, Math.ceil(len / 0.5)))))
      hasCurve = true
      cur = e
      i += 6
    } else if (op === QUAD) {
      const q = toMm(d[i], d[i + 1])
      const e = toMm(d[i + 2], d[i + 3])
      const b = { x: cur.x + (2 / 3) * (q.x - cur.x), y: cur.y + (2 / 3) * (q.y - cur.y) }
      const c = { x: e.x + (2 / 3) * (q.x - e.x), y: e.y + (2 / 3) * (q.y - e.y) }
      pts.push(...cubic(cur, b, c, e, 24))
      hasCurve = true
      cur = e
      i += 4
    } else if (op === CLOSE) {
      if (pts.length) pts.push(start)
      flush(true)
      cur = start
    } else break
  }
  flush(false)
  return out
}

/** pdf.js for the app (module worker bundled by Vite). */
export async function loadPdfLib(): Promise<PdfLib> {
  const [lib, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
  lib.GlobalWorkerOptions.workerSrc = worker.default
  return lib as unknown as PdfLib
}
