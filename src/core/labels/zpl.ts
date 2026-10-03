/**
 * ZPL II for Zebra label printers (GK420d, ZD421, ...), 203 dpi = 8 dots/mm.
 * Sending ZPL straight to the printer keeps barcodes crisp and avoids driver scaling.
 */
import { formatLength } from '../units'
import type { UnitSystem } from '../types'
import type { JobOutput, LabelRecord } from '../pipeline'
import { labelDims } from './placement'

const DPMM = 8
const d = (mm: number) => Math.round(mm * DPMM)

/** ZPL field data: strip control characters and the ^ ~ command prefixes. */
const zText = (s: string) => s.replace(/[\^~\r\n]/g, ' ').replace(/[^\x20-\x7e]/g, '?')

function labelZpl(l: LabelRecord, W: number, H: number, units: UnitSystem) {
  const z: string[] = []
  z.push('^XA', '^CI28', `^PW${d(W)}`, `^LL${d(H)}`, '^LH0,0')
  z.push(`^FO0,0^GB${d(W)},${d(11)},${d(11)}^FS`)
  z.push(`^FO0,0^GB${d(4)},${d(4)},${d(4)},W^FS`)
  z.push(`^FO${d(6)},${d(1.5)}^A0N,${d(8)},${d(7)}^FR^FD#${l.no}^FS`)
  z.push(`^FO${d(30)},${d(1.5)}^A0N,${d(3.5)},${d(3)}^FR^FD${zText(`${l.jobNumber} ${l.customer}`).slice(0, 34)}^FS`)
  z.push(`^FO${d(30)},${d(6)}^A0N,${d(3)},${d(2.6)}^FR^FD${zText(l.jobName).slice(0, 40)}^FS`)
  z.push(`^FO${d(W - 22)},${d(1.5)}^A0N,${d(4)},${d(3.5)}^FR^FDS${l.sheetIndex}/${l.sheetCount}^FS`)
  z.push(`^FO${d(W - 22)},${d(6.5)}^A0N,${d(3)},${d(2.6)}^FR^FDcut ${l.cutOrder}^FS`)
  z.push(`^FO${d(4)},${d(13)}^A0N,${d(5)},${d(4.5)}^FD${zText(l.partName).slice(0, 26)}^FS`)
  z.push(`^FO${d(4)},${d(19)}^A0N,${d(3)},${d(2.6)}^FD${zText(l.cabinet).slice(0, 40)}^FS`)
  z.push(`^FO${d(4)},${d(24)}^A0N,${d(5.5)},${d(5)}^FD${formatLength(l.finished.l, units)} x ${formatLength(l.finished.w, units)} x ${formatLength(l.finished.t, units)}^FS`)
  z.push(`^FO${d(4)},${d(31)}^A0N,${d(2.8)},${d(2.4)}^FDfinished  cut ${formatLength(l.cut.l, units)} x ${formatLength(l.cut.w, units)}^FS`)
  z.push(`^FO${d(4)},${d(35.5)}^A0N,${d(3)},${d(2.6)}^FD${zText(`${l.materialCode} ${l.materialName}`).slice(0, 44)}^FS`)
  const edges = (['L1', 'L2', 'W1', 'W2'] as const).filter((k) => l.edges[k]).map((k) => `${k} ${l.edges[k]}`).join('  ')
  z.push(`^FO${d(4)},${d(40)}^A0N,${d(2.8)},${d(2.4)}^FD${zText(edges ? `Edges: ${edges}` : 'Edges: none')}^FS`)

  // Edge diagram: thin box, thick bars on banded edges.
  const bx = 64
  const by = 14
  const bw = 30
  const bh = 16
  z.push(`^FO${d(bx)},${d(by)}^GB${d(bw)},${d(bh)},2^FS`)
  if (l.edges.L2) z.push(`^FO${d(bx)},${d(by)}^GB${d(bw)},${d(1.4)},${d(1.4)}^FS`)
  if (l.edges.L1) z.push(`^FO${d(bx)},${d(by + bh - 1.4)}^GB${d(bw)},${d(1.4)},${d(1.4)}^FS`)
  if (l.edges.W1) z.push(`^FO${d(bx)},${d(by)}^GB${d(1.4)},${d(bh)},${d(1.4)}^FS`)
  if (l.edges.W2) z.push(`^FO${d(bx + bw - 1.4)},${d(by)}^GB${d(1.4)},${d(bh)},${d(1.4)}^FS`)
  if (l.grainLocked) z.push(`^FO${d(bx + 6)},${d(by + bh + 1.5)}^A0N,${d(2.6)},${d(2.3)}^FDGRAIN -->^FS`)

  z.push(`^FO${d(4)},${d(H - 20)}^BY2,3,${d(11)}^BCN,${d(11)},N,N,N^FD${zText(l.partId)}^FS`)
  z.push(`^FO${d(4)},${d(H - 7)}^A0N,${d(3.5)},${d(3)}^FD${zText(l.partId)}^FS`)
  z.push(`^FO${d(56)},${d(H - 11)}^A0N,${d(2.5)},${d(2.2)}^FB${d(41)},1,0,R^FD${zText(l.program)}^FS`)
  if (l.notes.length) z.push(`^FO${d(48)},${d(H - 6)}^A0N,${d(2.8)},${d(2.5)}^FB${d(49)},2,0,R^FD${zText(l.notes.join(' | ')).slice(0, 60)}^FS`)
  z.push('^XZ')
  return z.join('\r\n')
}

export function labelsZpl(out: JobOutput, size: '100x70' | '100x80', units: UnitSystem = 'mm') {
  const { w, h } = labelDims(size)
  return out.labels.map((l) => labelZpl(l, w, h, units)).join('\r\n') + '\r\n'
}
