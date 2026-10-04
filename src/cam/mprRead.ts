/**
 * Minimal MPR 4.0 reader: header, variables, contour blocks (KP/KL/KA) and macros with their
 * key/value pairs. Used to round-trip generated programs in tests and to check structure
 * before export. It reads what this app writes; it is not a full woodWOP parser.
 */
import { arc, line, type P, type Seg } from './geom'

export interface MprMacro {
  id: number
  name: string
  values: Record<string, string>
  /** Repeated keys (e.g. KM) in order. */
  all: [string, string][]
}
export interface MprDoc {
  header: Record<string, string>
  variables: Record<string, string>
  contours: Map<number, { start: P; segs: Seg[] }>
  macros: MprMacro[]
  ended: boolean
  errors: string[]
}

const unq = (v: string) => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v)

/** Centre of an arc from start, end, radius and DS (0/2 CW, 1/3 CCW; 2/3 = more than 180 degrees). */
export function arcCentre(a: P, b: P, r: number, ds: number): P {
  const ccw = ds === 1 || ds === 3
  const major = ds >= 2
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d = Math.hypot(dx, dy)
  const h = Math.sqrt(Math.max(0, r * r - (d * d) / 4))
  const nx = -dy / d
  const ny = dx / d
  const sign = ccw !== major ? 1 : -1
  return { x: mx + nx * h * sign, y: my + ny * h * sign }
}

export function readMpr(text: string): MprDoc {
  const doc: MprDoc = { header: {}, variables: {}, contours: new Map(), macros: [], ended: false, errors: [] }
  if (/[^\r]\n/.test(text.slice(0, 2000))) doc.errors.push('Line endings are not CRLF.')
  const lines = text.split(/\r?\n/)
  type Mode = { k: 'none' } | { k: 'header' } | { k: 'vars' } | { k: 'contour'; n: number } | { k: 'macro'; m: MprMacro }
  let mode: Mode = { k: 'none' }
  let el: { type: string; v: Record<string, string> } | null = null
  const flushEl = () => {
    if (!el || mode.k !== 'contour') return
    const c = doc.contours.get(mode.n)!
    const x = Number(el.v.X)
    const y = Number(el.v.Y)
    if (el.type === 'KP') c.start = { x, y }
    else {
      const a = c.segs.length ? c.segs[c.segs.length - 1].b : c.start
      const b = { x, y }
      if (el.type === 'KL') c.segs.push(line(a, b))
      else if (el.type === 'KA') {
        const ds = Number(el.v.DS ?? 0)
        c.segs.push(arc(a, b, arcCentre(a, b, Number(el.v.R), ds), ds === 1 || ds === 3))
      } else doc.errors.push(`Unknown contour element ${el.type}`)
    }
    el = null
  }
  for (const raw of lines) {
    const ln = raw.trimEnd()
    if (ln === '!') {
      flushEl()
      doc.ended = true
      break
    }
    if (ln === '[H') {
      mode = { k: 'header' }
      continue
    }
    if (ln === '[001') {
      mode = { k: 'vars' }
      continue
    }
    let m = /^\](\d+)$/.exec(ln)
    if (m) {
      flushEl()
      mode = { k: 'contour', n: Number(m[1]) }
      doc.contours.set(mode.n, { start: { x: 0, y: 0 }, segs: [] })
      continue
    }
    m = /^<(\d+) \\(.+)\\$/.exec(ln)
    if (m) {
      flushEl()
      const mac: MprMacro = { id: Number(m[1]), name: m[2], values: {}, all: [] }
      doc.macros.push(mac)
      mode = { k: 'macro', m: mac }
      continue
    }
    if (mode.k === 'contour') {
      if (/^\$E\d+$/.test(ln)) {
        flushEl()
        continue
      }
      if (/^K[PLA] ?$/.test(ln)) {
        el = { type: ln.trim(), v: {} }
        continue
      }
      const kv = /^([A-Z_]+)=(.*)$/.exec(ln)
      if (kv && el) el.v[kv[1]] = kv[2]
      continue
    }
    const kv = /^([A-Z_0-9]+)=(.*)$/.exec(ln)
    if (!kv) continue
    if (mode.k === 'header') doc.header[kv[1]] = unq(kv[2])
    else if (mode.k === 'vars') doc.variables[kv[1]] = unq(kv[2])
    else if (mode.k === 'macro') {
      mode.m.values[kv[1]] = unq(kv[2])
      mode.m.all.push([kv[1], unq(kv[2])])
    }
  }
  if (!doc.ended) doc.errors.push('Missing end-of-file marker "!".')
  if (doc.header.VERSION !== '4.0 Alpha') doc.errors.push(`Unexpected VERSION ${doc.header.VERSION}`)
  if (!doc.macros.some((x) => x.id === 100)) doc.errors.push('Missing <100 WerkStck> workpiece.')
  for (const mac of doc.macros.filter((x) => x.id === 105)) {
    for (const key of ['EA', 'EE']) {
      const [n, e] = (mac.values[key] ?? '').split(':').map(Number)
      const c = doc.contours.get(n)
      if (!c) doc.errors.push(`Contour milling ${key} refers to missing contour ${n}.`)
      else if (e < 0 || e > c.segs.length) doc.errors.push(`Contour milling ${key}=${n}:${e} is outside contour ${n} (0..${c.segs.length}).`)
    }
  }
  return doc
}
