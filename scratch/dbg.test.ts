import { it } from 'vitest'
import { jsPDF } from 'jspdf'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { splineSamples } from '@/cam/dxf'
import { fitPoints, pt } from '@/cam/geom'
import { pdfVectors, type PdfLib } from '@/cam/pdfVectors'
import { entityContours } from '@/cam/doc'
it('dbg', async () => {
  const w = Math.SQRT1_2
  const q = splineSamples(2, [0, 0, 0, 1, 1, 1], [pt(50, 0), pt(50, 50), pt(0, 50)], [1, w, 1])
  console.log(q.length, q.slice(0, 3), fitPoints(q, false, 0.01).map((s) => s.k))
  const doc = new jsPDF({ unit: 'mm', format: [300, 200], orientation: 'landscape' })
  doc.circle(200, 100, 40)
  const v = await pdfVectors(pdfjs as unknown as PdfLib, new Uint8Array(doc.output('arraybuffer')))
  for (const c of v.entities.flatMap(entityContours)) console.log(c.closed, c.segs.map((s) => s.k + (s.k === 'A' ? Math.hypot(s.a.x - s.c.x, s.a.y - s.c.y).toFixed(3) : '')).join(','))
})
