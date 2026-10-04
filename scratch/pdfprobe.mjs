import { jsPDF } from 'jspdf'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
const doc = new jsPDF({ unit: 'mm', format: [200, 150] })
doc.line(10, 10, 100, 10)
doc.rect(20, 20, 50, 30)
doc.circle(120, 60, 20)
const buf = new Uint8Array(doc.output('arraybuffer'))
const pdf = await pdfjs.getDocument({ data: buf, useWorkerFetch: false, isEvalSupported: false }).promise
const page = await pdf.getPage(1)
console.log(page.view, page.userUnit)
const ops = await page.getOperatorList()
const names = Object.fromEntries(Object.entries(pdfjs.OPS).map(([k, v]) => [v, k]))
ops.fnArray.forEach((f, i) => console.log(names[f], JSON.stringify(ops.argsArray[i], (k, v) => (v && v.constructor && v.constructor.name.endsWith('Array') && !(v instanceof Array) ? Array.from(v) : v)).slice(0, 400)))
console.log(Object.keys(pdfjs).filter(k=>/Draw|OPS|Path/i.test(k)))
