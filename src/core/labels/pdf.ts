import JsBarcode from 'jsbarcode'
import { jsPDF } from 'jspdf'
import type { PartInstance } from '../cutlist'
import { formatLength } from '../units'
import { placementTransform, type SheetProgram } from '../machining'
import type { JobOutput, LabelRecord } from '../pipeline'
import type { Job, Library, UnitSystem, Vec2 } from '../types'
import { labelDims, type LabelSpot } from './placement'

function code128Bars(text: string): string {
  const target: { encodings?: { data: string }[] } = {}
  JsBarcode(target, text, { format: 'CODE128' })
  return (target.encodings ?? []).map((e) => e.data).join('')
}

function drawBarcode(doc: jsPDF, text: string, x: number, y: number, maxW: number, h: number) {
  const bars = code128Bars(text)
  // 10-module quiet zone each side is required by the symbology.
  const module = Math.min(0.38, maxW / (bars.length + 20))
  let cx = x + 10 * module
  doc.setFillColor(0, 0, 0)
  let run = 0
  for (let i = 0; i <= bars.length; i++) {
    if (bars[i] === '1') run++
    else if (run) {
      doc.rect(cx - run * module, y, run * module, h, 'F')
      run = 0
    }
    cx += module
  }
  return (bars.length + 20) * module
}

/** Filled triangle in the top-left corner: the orientation mark shared by label and sheet map. */
function cornerMark(doc: jsPDF, x: number, y: number, size: number, color: [number, number, number]) {
  doc.setFillColor(...color)
  doc.triangle(x, y, x + size, y, x, y + size, 'F')
}

function edgeDiagram(doc: jsPDF, l: LabelRecord, x: number, y: number, w: number, h: number, units: UnitSystem, shape?: { outline: Vec2[]; holes: Vec2[][]; L: number; W: number }) {
  const ratio = l.finished.w / l.finished.l
  let bw = w
  let bh = w * ratio
  if (bh > h) {
    bh = h
    bw = h / ratio
  }
  bw = Math.max(bw, 10)
  bh = Math.max(bh, 6)
  const ox = x + (w - bw) / 2
  const oy = y + (h - bh) / 2
  doc.setDrawColor(0)
  doc.setLineWidth(0.2)
  doc.setFillColor(235, 235, 235)
  if (shape) {
    // Custom part: its true outline and openings, part x to the right, y up.
    const map = (p: Vec2): [number, number] => [ox + (p.x / shape.L) * bw, oy + bh - (p.y / shape.W) * bh]
    const draw = (pts: Vec2[], style: 'FD' | 'S') => {
      if (pts.length < 3) return
      const m = pts.map(map)
      doc.lines(m.slice(1).map((q, i) => [q[0] - m[i][0], q[1] - m[i][1]]), m[0][0], m[0][1], [1, 1], style, true)
    }
    draw(shape.outline, 'FD')
    doc.setFillColor(255, 255, 255)
    for (const hole of shape.holes) draw(hole, 'FD')
  } else doc.rect(ox, oy, bw, bh, 'FD')
  doc.setLineWidth(1.4)
  // Part frame on the label: local x to the right, local y up. L1 = bottom, L2 = top, W1 = left, W2 = right.
  if (l.edges.L1) doc.line(ox, oy + bh, ox + bw, oy + bh)
  if (l.edges.L2) doc.line(ox, oy, ox + bw, oy)
  if (l.edges.W1) doc.line(ox, oy, ox, oy + bh)
  if (l.edges.W2) doc.line(ox + bw, oy, ox + bw, oy + bh)
  doc.setLineWidth(0.2)
  doc.setFontSize(6)
  doc.setFont('helvetica', 'normal')
  doc.text(`${formatLength(l.finished.l, units)}`, ox + bw / 2, oy + bh / 2 + 1, { align: 'center' })
  if (l.grainLocked) {
    const ay = oy + bh / 2 + 3.5
    doc.line(ox + bw * 0.2, ay, ox + bw * 0.8, ay)
    doc.triangle(ox + bw * 0.8, ay - 0.8, ox + bw * 0.8 + 1.6, ay, ox + bw * 0.8, ay + 0.8, 'F')
    doc.text('GRAIN', ox + bw / 2, ay + 2.4, { align: 'center' })
  }
}

function miniSheet(doc: jsPDF, out: JobOutput, l: LabelRecord, x: number, y: number, w: number, h: number) {
  const prog = out.programs.find((p) => p.sheet.index === l.sheetIndex)
  if (!prog) return
  const s = prog.sheet
  const k = Math.min(w / s.sheetLength, h / s.sheetWidth)
  const sw = s.sheetLength * k
  const sh = s.sheetWidth * k
  const ox = x + (w - sw) / 2
  const oy = y + (h - sh) / 2
  doc.setLineWidth(0.15)
  doc.setDrawColor(0)
  doc.rect(ox, oy, sw, sh)
  for (const pl of s.placements) {
    const mine = pl.uid === l.uid
    doc.setFillColor(...((mine ? [0, 0, 0] : [215, 215, 215]) as [number, number, number]))
    doc.rect(ox + pl.x * k, oy + (s.sheetWidth - pl.y - pl.dy) * k, pl.dx * k, pl.dy * k, 'F')
  }
}

/**
 * Same job in, same PDF bytes out: the creation date is the job's own date (not the clock) and
 * the file id is derived from it, so re-running a job gives byte-identical files.
 */
function pinPdf(doc: jsPDF, stamp: string | undefined, key: string) {
  let d = stamp ? new Date(stamp) : new Date(NaN)
  if (!Number.isFinite(d.getTime()) || d.getUTCFullYear() < 1970 || d.getUTCFullYear() > 2037) d = new Date(Date.UTC(2026, 0, 1))
  // Written in UTC as text, so the shop computer's time zone does not change the file.
  const two = (n: number) => String(n).padStart(2, '0')
  doc.setCreationDate(`D:${d.getUTCFullYear()}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}+00'00'`)
  let h = 0x811c9dc5
  const src = `${key}|${stamp ?? ''}`
  const words: string[] = []
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < src.length; i++) h = Math.imul(h ^ src.charCodeAt(i), 0x01000193)
    h = Math.imul(h ^ k, 0x01000193)
    words.push((h >>> 0).toString(16).padStart(8, '0'))
  }
  doc.setFileId(words.join('').toUpperCase())
}

export function labelsPdf(out: JobOutput, size: '100x70' | '100x80', units: UnitSystem = 'mm', stamp?: string): Uint8Array {
  const { w: W, h: H } = labelDims(size)
  const doc = new jsPDF({ unit: 'mm', format: [W, H], orientation: 'landscape', compress: true })
  doc.setProperties({ title: 'Part labels', creator: 'Cabinet Studio' })
  pinPdf(doc, stamp, 'labels')
  let first = true
  const bySheet = new Map<number, LabelRecord[]>()
  for (const l of out.labels) bySheet.set(l.sheetIndex, [...(bySheet.get(l.sheetIndex) ?? []), l])

  for (const [sheetIndex, labels] of bySheet) {
    // Sheet header label: printed first so each sheet's stack of labels is separated.
    if (!first) doc.addPage([W, H], 'landscape')
    first = false
    const prog = out.programs.find((p) => p.sheet.index === sheetIndex)!
    doc.setFillColor(0, 0, 0)
    doc.rect(0, 0, W, 14, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(18)
    doc.text(`SHEET ${sheetIndex} / ${prog ? out.programs.length : '?'}`, 4, 10)
    doc.setTextColor(0, 0, 0)
    doc.setFontSize(11)
    doc.text(prog.materialCode, 4, 22)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`${formatLength(prog.sheet.sheetLength, units)} x ${formatLength(prog.sheet.sheetWidth, units)} x ${formatLength(prog.sheet.thickness, units)}   ${labels.length} parts   yield ${prog.sheet.utilization}%`, 4, 28)
    doc.text(`Program: ${prog.name}.mpr`, 4, 33)
    doc.setFontSize(7)
    doc.text('Labels follow in cut order. Place each label as shown on the sheet map.', 4, 38)
    drawBarcode(doc, prog.name, 4, 41, W - 8, 13)
    doc.setFontSize(7)
    doc.text(prog.name, 4, 58)

    for (const l of labels) {
      doc.addPage([W, H], 'landscape')
      drawLabel(doc, out, l, W, H, units)
    }
  }
  return new Uint8Array(doc.output('arraybuffer'))
}

function drawLabel(doc: jsPDF, out: JobOutput, l: LabelRecord, W: number, H: number, units: UnitSystem) {
  doc.setFillColor(0, 0, 0)
  doc.rect(0, 0, W, 11, 'F')
  cornerMark(doc, 0, 0, 5, [255, 255, 255])
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(19)
  doc.text(`#${l.no}`, 6, 8.6)
  doc.setFontSize(9)
  doc.text(`${l.jobNumber}  ${l.customer}`.slice(0, 34), 26, 5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text(l.jobName.slice(0, 40), 26, 9)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(`S${l.sheetIndex}/${l.sheetCount}`, W - 3, 5.2, { align: 'right' })
  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  doc.text(`cut ${l.cutOrder}${l.copy ? `  ·  ${l.copy.n} of ${l.copy.of}` : ''}`, W - 3, 9, { align: 'right' })
  doc.setTextColor(0, 0, 0)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text(l.partName.slice(0, 26), 4, 17.5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(l.cabinet.slice(0, 40), 4, 22)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(`${formatLength(l.finished.l, units)} x ${formatLength(l.finished.w, units)} x ${formatLength(l.finished.t, units)}`, 4, 29.5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text(`finished size   cut ${formatLength(l.cut.l, units)} x ${formatLength(l.cut.w, units)}`, 4, 33.5)
  doc.setFontSize(8)
  doc.text(`${l.materialCode}  ${l.materialName}`.slice(0, 44), 4, 38.5)
  const edgeText = (['L1', 'L2', 'W1', 'W2'] as const)
    .filter((k) => l.edges[k])
    .map((k) => `${k} ${l.edges[k]}`)
    .join('  ')
  doc.setFontSize(7)
  doc.text(edgeText ? `Edges: ${edgeText}` : 'Edges: none', 4, 43)

  const inst = out.instances.find((i) => i.uid === l.uid)
  const shape = inst?.cam ? { outline: inst.outline, holes: inst.holes ?? [], L: inst.cutLength, W: inst.cutWidth } : undefined
  edgeDiagram(doc, l, 62, 13, 34, 20, units, shape)
  miniSheet(doc, out, l, 62, 35, 34, 14)

  const barY = H - 20
  drawBarcode(doc, l.partId, 2, barY, 58, 11)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text(l.partId, 4, barY + 14)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6)
  doc.text(l.program, W - 3, H - 9, { align: 'right' })
  doc.text(`edge code ${l.edgeDiagram}`, W - 3, H - 6, { align: 'right' })
  if (l.notes.length) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.text(l.notes.join(' | ').slice(0, 60), W - 3, H - 2.5, { align: 'right' })
  }
}

// ---------------------------------------------------------------------------------------------
// Sheet map: one A4 landscape page per sheet showing every part, its number and its label spot.
// ---------------------------------------------------------------------------------------------

export function sheetMapPdf(job: Job, out: JobOutput, lib: Library, units: UnitSystem = 'mm'): Uint8Array {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true })
  doc.setProperties({ title: `Sheet maps ${job.number}`, creator: 'Cabinet Studio' })
  pinPdf(doc, job.updatedAt, `sheets|${job.id}`)
  const byUid = new Map(out.instances.map((i) => [i.uid, i]))
  out.programs.forEach((prog, idx) => {
    if (idx > 0) doc.addPage('a4', 'landscape')
    drawSheetPage(doc, job, out, prog, out.spots.get(prog.sheet.index) ?? [], byUid, lib, units)
  })
  if (!out.programs.length) {
    doc.setFontSize(14)
    doc.text('No sheets: the job has no parts.', 20, 30)
  }
  return new Uint8Array(doc.output('arraybuffer'))
}

function drawSheetPage(
  doc: jsPDF,
  job: Job,
  out: JobOutput,
  prog: SheetProgram,
  spots: LabelSpot[],
  byUid: Map<string, PartInstance>,
  lib: Library,
  units: UnitSystem,
) {
  const s = prog.sheet
  const mat = lib.materials.find((m) => m.id === s.materialId)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text(`Sheet ${s.index} of ${out.programs.length}  -  ${prog.materialCode}`, 10, 13)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(
    `Job ${job.number} ${job.name}  |  ${mat?.name ?? ''}  |  ${formatLength(s.sheetLength, units)} x ${formatLength(s.sheetWidth, units)} x ${formatLength(s.thickness, units)}  |  ${s.placements.length} parts  |  yield ${s.utilization}%`,
    10,
    19,
  )
  doc.text(`Program ${prog.name}.mpr  -  NOT MACHINE-VALIDATED: simulate in woodWOP before cutting`, 10, 24)

  const areaX = 10
  const areaY = 30
  const areaW = 200
  const areaH = 165
  const k = Math.min(areaW / s.sheetLength, areaH / s.sheetWidth)
  const sw = s.sheetLength * k
  const sh = s.sheetWidth * k
  const ox = areaX
  const oy = areaY + sh
  const X = (x: number) => ox + x * k
  const Y = (y: number) => oy - y * k

  doc.setDrawColor(0)
  doc.setLineWidth(0.4)
  doc.setFillColor(250, 248, 240)
  doc.rect(ox, areaY, sw, sh, 'FD')

  for (const pl of s.placements) {
    const inst = byUid.get(pl.uid)
    if (!inst) continue
    const { pt } = placementTransform(inst, pl)
    const poly = inst.outline.map((p) => pt(p.x, p.y))
    doc.setFillColor(222, 228, 236)
    doc.setLineWidth(0.25)
    const pts = poly.map((p) => [X(p.x), Y(p.y)] as [number, number])
    const segs = pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]])
    segs.push([pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]])
    doc.lines(segs, pts[0][0], pts[0][1], [1, 1], 'FD', true)
  }

  doc.setLineWidth(0.1)
  doc.setDrawColor(90, 90, 90)
  for (const op of prog.ops) {
    if (op.kind === 'vdrill') doc.circle(X(op.x), Y(op.y), Math.max(0.25, (op.diameter / 2) * k), 'S')
    else if (op.kind === 'pocket') {
      doc.setFillColor(170, 180, 195)
      doc.rect(X(op.x1), Y(op.y2), (op.x2 - op.x1) * k, (op.y2 - op.y1) * k, 'F')
    }
  }

  for (const spot of spots) {
    const inst = byUid.get(spot.uid)
    if (!inst) continue
    const lx = X(spot.cx - spot.w / 2)
    const ly = Y(spot.cy + spot.h / 2)
    const lw = spot.w * k
    const lh = spot.h * k
    doc.setLineWidth(0.3)
    doc.setDrawColor(...((spot.fits ? [20, 20, 20] : [200, 30, 30]) as [number, number, number]))
    doc.setFillColor(255, 255, 255)
    doc.rect(lx, ly, lw, lh, 'FD')
    // Label "top-left" in sheet terms: rotation 0 reads along +X (top = +Y); rotation 90 reads along +Y (top = -X).
    if (spot.rotation === 0) {
      doc.setFillColor(0, 0, 0)
      doc.triangle(lx, ly, lx + 2, ly, lx, ly + 2, 'F')
    } else {
      doc.setFillColor(0, 0, 0)
      doc.triangle(lx, ly + lh, lx, ly + lh - 2, lx + 2, ly + lh, 'F')
    }
    doc.setTextColor(0, 0, 0)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(Math.max(6, Math.min(11, lh * 1.6)))
    doc.text(`#${inst.no}`, lx + lw / 2, ly + lh / 2 + 1.3, { align: 'center' })
  }

  // Origin and axes as on the woodWOP table view (X right, Y up from the zero corner).
  doc.setDrawColor(200, 30, 30)
  doc.setLineWidth(0.4)
  doc.line(ox, oy, ox + 12, oy)
  doc.line(ox, oy, ox, oy - 12)
  doc.setTextColor(200, 30, 30)
  doc.setFontSize(7)
  doc.text('X', ox + 13, oy + 1)
  doc.text('Y', ox - 1, oy - 13)
  doc.text('0,0', ox - 1, oy + 4)
  doc.setTextColor(0, 0, 0)

  // Legend
  const lx = 220
  let ly = 34
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('#', lx, ly)
  doc.text('Part', lx + 8, ly)
  doc.text('Cab', lx + 42, ly)
  doc.text('Cut L x W', lx + 54, ly)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  ly += 2
  doc.setLineWidth(0.2)
  doc.setDrawColor(0)
  doc.line(lx, ly, lx + 72, ly)
  ly += 4
  s.placements.forEach((pl, i) => {
    const inst = byUid.get(pl.uid)
    if (!inst || ly > 196) return
    const spot = spots.find((sp) => sp.uid === pl.uid)
    doc.text(`${inst.no}`, lx, ly)
    doc.text(inst.part.name.slice(0, 18), lx + 8, ly)
    doc.text(inst.cabinetNumber, lx + 42, ly)
    doc.text(`${formatLength(inst.cutLength, units)} x ${formatLength(inst.cutWidth, units)}${pl.rotated ? ' R' : ''}${spot && !spot.fits ? ' *' : ''}`, lx + 54, ly)
    doc.setTextColor(120, 120, 120)
    doc.text(`${i + 1}`, lx + 76, ly, { align: 'right' })
    doc.setTextColor(0, 0, 0)
    ly += 4.2
  })
  doc.setFontSize(6.5)
  doc.setTextColor(80, 80, 80)
  doc.text(
    [
      'White boxes = label positions (face-up side, as the sheet lies on the table).',
      'Black corner = top-left of the label. R = part rotated 90 deg.',
      '* = label does not fit: put it on the back face.',
      'Grey number = cut order.',
    ],
    lx,
    186,
  )
  doc.setTextColor(0, 0, 0)
}
