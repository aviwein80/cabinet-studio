/**
 * Job-1: a simple printable quote (PDF): the job's number, name and customer field (no other customer
 * data), the four lines, markup, sales tax and the total, then every item. An item or line without a
 * price says "price not set" with a Configure tag; it is left out of the sums and the total says so.
 */
import { jsPDF } from 'jspdf'
import { pinPdf } from './labels/pdf'
import { anyPriced, lineNote, money, totalNote, unitPrice, type JobQuote } from './quote'
import type { Job } from './types'

export function quotePdf(job: Pick<Job, 'id' | 'number' | 'name' | 'customer' | 'updatedAt'>, q: JobQuote, shopName = ''): Uint8Array {
  const letter = q.units === 'in'
  const doc = new jsPDF({ unit: 'mm', format: letter ? 'letter' : 'a4', orientation: 'portrait', compress: true })
  doc.setProperties({ title: `Quote ${job.number}`, creator: 'Cabinet Studio' })
  pinPdf(doc, job.updatedAt, `quote|${job.id}`)
  const W = letter ? 215.9 : 210
  const H = letter ? 279.4 : 297
  const L = 18
  const R = W - 18
  const $ = (v: number) => money(v, q.currency)
  let y = 20
  const room = (need: number) => {
    if (y + need <= H - 20) return
    doc.addPage(letter ? 'letter' : 'a4', 'portrait')
    y = 20
  }
  const tag = (x: number, yy: number) => {
    // the Configure tag: an amber box, as the badge on screen
    doc.setFontSize(7)
    const w = doc.getTextWidth('Configure') + 3
    doc.setFillColor(253, 230, 138)
    doc.setDrawColor(217, 119, 6)
    doc.roundedRect(x - w, yy - 3, w, 4.2, 0.8, 0.8, 'FD')
    doc.setTextColor(146, 64, 14)
    doc.text('Configure', x - w + 1.5, yy)
    doc.setTextColor(0, 0, 0)
    return w
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('Quote', L, y)
  if (shopName) {
    doc.setFontSize(11)
    doc.text(shopName, R, y, { align: 'right' })
  }
  y += 9
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Job ${job.number}  ${job.name}`, L, y)
  y += 5
  doc.text(`Customer: ${job.customer || '-'}`, L, y)
  doc.text(`Date: ${(job.updatedAt ?? '').slice(0, 10)}`, R, y, { align: 'right' })
  y += 10

  // summary
  const row = (label: string, detail: string, amount: string, opts: { bold?: boolean; missing?: string } = {}) => {
    room(7)
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal')
    doc.setFontSize(opts.bold ? 11 : 10)
    doc.text(label, L, y)
    doc.setFontSize(9)
    doc.text(detail, L + 38, y)
    doc.setFontSize(opts.bold ? 11 : 10)
    if (opts.missing) {
      const w = tag(R, y)
      doc.setFontSize(9)
      doc.text(amount ? `${amount}  (${opts.missing})` : opts.missing, R - w - 2, y, { align: 'right' })
    } else doc.text(amount, R, y, { align: 'right' })
    y += 6.5
  }
  doc.setDrawColor(0)
  doc.setLineWidth(0.2)
  doc.line(L, y - 4, R, y - 4)
  for (const l of q.lines) {
    const detail =
      l.key === 'labour'
        ? `${q.labour.hours} h${q.labour.rate !== null ? ` at ${$(q.labour.rate)}/h` : ''}`
        : l.items.map((i) => `${i.qty} ${i.unit}`).reduce((acc, s, k) => (k < 3 ? (acc ? `${acc}, ${s}` : s) : k === 3 ? `${acc}, ...` : acc), '')
    const note = lineNote(l)
    row(l.label, l.items.length ? detail : 'none', l.items.length === 0 ? $(0) : note && l.unpriced === l.items.length ? '' : $(l.amount), note ? { missing: note } : {})
  }
  doc.line(L, y - 4, R, y - 4)
  const tn = totalNote(q)
  // nothing priced yet: no amounts at all ("price not set", never $0.00)
  const some = anyPriced(q)
  const a = (v: number) => (some ? $(v) : '')
  row('Subtotal', '', a(q.subtotal), tn ? { missing: tn } : {})
  row('Markup', `${q.markupPct} %`, some ? $(q.markup) : '', some ? {} : { missing: 'price not set' })
  row('Sales tax', `${q.taxPct} %`, some ? $(q.tax) : '', some ? {} : { missing: 'price not set' })
  doc.line(L, y - 4, R, y - 4)
  row('Total', '', a(q.total), { bold: true, ...(tn ? { missing: tn } : {}) })
  y += 4

  // items
  room(14)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('Items', L, y)
  y += 6
  doc.setFontSize(8)
  const cols = [L, L + 22, L + 102, L + 122, R - 26, R]
  doc.text('Line', cols[0], y)
  doc.text('Item', cols[1], y)
  doc.text('Qty', cols[2], y, { align: 'right' })
  doc.text('Unit', cols[3] - 16, y)
  doc.text('Each', cols[4], y, { align: 'right' })
  doc.text('Amount', cols[5], y, { align: 'right' })
  y += 1.5
  doc.line(L, y, R, y)
  y += 4
  doc.setFont('helvetica', 'normal')
  for (const l of q.lines)
    for (const i of l.items) {
      room(5)
      doc.setFontSize(8)
      doc.text(l.label, cols[0], y)
      const text = `${i.code}  ${i.name}`
      doc.text(doc.splitTextToSize(text, 78)[0] as string, cols[1], y)
      doc.text(String(i.qty), cols[2], y, { align: 'right' })
      doc.text(i.unit, cols[3] - 16, y)
      if (i.amount === null) {
        const w = tag(R, y)
        doc.setFontSize(8)
        doc.text('price not set', R - w - 2, y, { align: 'right' })
      } else {
        doc.text(unitPrice(i.price!), cols[4], y, { align: 'right' })
        doc.text(i.amount.toFixed(2), cols[5], y, { align: 'right' })
      }
      y += 4.6
    }
  y += 4
  room(12)
  doc.setFontSize(7.5)
  doc.setTextColor(90)
  doc.text(doc.splitTextToSize("Prices are the shop's own entries. An item marked 'price not set' is left out of every sum above until its price is entered. Board is whole sheets as nested.", R - L) as string[], L, y)
  doc.setTextColor(0)
  return new Uint8Array(doc.output('arraybuffer'))
}
