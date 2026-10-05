/**
 * What the geometry reader does not report from a STEP file, read from the file's text (ISO
 * 10303-21, the open STEP exchange format): the schema (AP203 / AP214 / AP242), the length unit,
 * the product names and their user-defined properties. The IGES length unit comes from the IGES
 * global section. Only the few entity types needed are decoded; everything else is skipped.
 */
import type { SolidProduct } from './types'

type Val = string | number | null | { ref: number } | { enum: string } | { type: string; args: Val[] } | Val[]

interface Rec {
  type: string
  args: Val[]
  /** Complex instances: each part's type and arguments. */
  parts?: { type: string; args: Val[] }[]
}

const WANTED = new Set([
  'PRODUCT',
  'PRODUCT_DEFINITION_FORMATION',
  'PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE',
  'PRODUCT_DEFINITION',
  'PROPERTY_DEFINITION',
  'PROPERTY_DEFINITION_REPRESENTATION',
  'REPRESENTATION',
  'DESCRIPTIVE_REPRESENTATION_ITEM',
  'VALUE_REPRESENTATION_ITEM',
  'MEASURE_REPRESENTATION_ITEM',
])

/** STEP string escapes: '' -> ', \\ -> \, \X\hh (latin-1), \X2\hhhh...\X0\ (UTF-16), \S\c. */
export function decodeStepString(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === "'" && s[i + 1] === "'") {
      out += "'"
      i++
    } else if (c === '\\' && s[i + 1] === '\\') {
      out += '\\'
      i++
    } else if (c === '\\' && s.startsWith('\\X2\\', i)) {
      const end = s.indexOf('\\X0\\', i + 4)
      const hex = s.slice(i + 4, end < 0 ? s.length : end)
      for (let k = 0; k + 4 <= hex.length; k += 4) out += String.fromCharCode(parseInt(hex.slice(k, k + 4), 16))
      i = (end < 0 ? s.length : end + 4) - 1
    } else if (c === '\\' && s.startsWith('\\X\\', i)) {
      out += String.fromCharCode(parseInt(s.slice(i + 3, i + 5), 16))
      i += 4
    } else if (c === '\\' && s.startsWith('\\S\\', i)) {
      out += String.fromCharCode(s.charCodeAt(i + 3) + 128)
      i += 3
    } else out += c
  }
  return out
}

class ArgReader {
  i = 0
  readonly s: string
  constructor(s: string) {
    this.s = s
  }
  ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++
  }
  list(): Val[] {
    // at '('
    this.i++
    const out: Val[] = []
    this.ws()
    if (this.s[this.i] === ')') {
      this.i++
      return out
    }
    for (;;) {
      out.push(this.value())
      this.ws()
      const c = this.s[this.i++]
      if (c === ')') return out
      if (c !== ',') throw new Error('bad list')
    }
  }
  value(): Val {
    this.ws()
    const c = this.s[this.i]
    if (c === "'") {
      let j = this.i + 1
      for (;;) {
        if (j >= this.s.length) throw new Error('open string')
        if (this.s[j] === "'") {
          if (this.s[j + 1] === "'") j += 2
          else break
        } else j++
      }
      const raw = this.s.slice(this.i + 1, j)
      this.i = j + 1
      return decodeStepString(raw)
    }
    if (c === '#') {
      const m = /^#(\d+)/.exec(this.s.slice(this.i, this.i + 24))!
      this.i += m[0].length
      return { ref: Number(m[1]) }
    }
    if (c === '$' || c === '*') {
      this.i++
      return null
    }
    if (c === '.') {
      const j = this.s.indexOf('.', this.i + 1)
      const e = this.s.slice(this.i + 1, j)
      this.i = j + 1
      return { enum: e }
    }
    if (c === '(') return this.list()
    const m = /^[-+0-9.eE]+/.exec(this.s.slice(this.i, this.i + 40))
    if (m && m[0] !== '.') {
      this.i += m[0].length
      return Number(m[0])
    }
    const t = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.s.slice(this.i, this.i + 120))
    if (t) {
      this.i += t[0].length
      this.ws()
      if (this.s[this.i] === '(') return { type: t[0].toUpperCase(), args: this.list() }
      return { enum: t[0] }
    }
    throw new Error('bad value')
  }
}

/** Statements of the DATA section as `#id = text` (strings and comments respected). */
function* statements(text: string): Generator<{ id: number; body: string }> {
  const start = text.search(/\bDATA\s*;/)
  if (start < 0) return
  let i = text.indexOf(';', start) + 1
  let begin = i
  let inStr = false
  for (; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (c === "'") {
        if (text[i + 1] === "'") i++
        else inStr = false
      }
      continue
    }
    if (c === "'") inStr = true
    else if (c === '/' && text[i + 1] === '*') {
      const e = text.indexOf('*/', i + 2)
      i = e < 0 ? text.length : e + 1
    } else if (c === ';') {
      const st = text.slice(begin, i).trim()
      begin = i + 1
      if (st.startsWith('ENDSEC')) return
      const m = /^#(\d+)\s*=\s*/.exec(st)
      if (m) yield { id: Number(m[1]), body: st.slice(m[0].length) }
    }
  }
}

function parseRec(body: string): Rec | null {
  if (body.startsWith('(')) {
    // complex instance: (TYPE1(args) TYPE2(args) ...)
    if (!/LENGTH_UNIT/.test(body)) return null
    const parts: { type: string; args: Val[] }[] = []
    const r = new ArgReader(body.slice(1, body.lastIndexOf(')')))
    for (;;) {
      r.ws()
      if (r.i >= r.s.length) break
      const v = r.value()
      if (v && typeof v === 'object' && 'type' in v) parts.push(v)
      else break
    }
    return { type: '()', args: [], parts }
  }
  const t = /^([A-Z_][A-Z0-9_]*)\s*\(/i.exec(body)
  if (!t) return null
  const type = t[1].toUpperCase()
  if (!WANTED.has(type)) return null
  const r = new ArgReader(body.slice(t[0].length - 1))
  return { type, args: r.list() }
}

const ref = (v: Val | undefined) => (v && typeof v === 'object' && 'ref' in v ? v.ref : null)
const str = (v: Val | undefined) => (typeof v === 'string' ? v : '')

export interface StepMeta {
  schema?: string
  /** Length unit name: mm, cm, m, in or ft (undefined when not found). */
  units?: 'mm' | 'cm' | 'm' | 'in' | 'ft'
  products: SolidProduct[]
}

/** Schema family from FILE_SCHEMA. */
function schemaOf(header: string): string | undefined {
  const m = /FILE_SCHEMA\s*\(\s*\(\s*'([^']*)'/i.exec(header)
  if (!m) return undefined
  const s = m[1].toUpperCase()
  if (s.includes('AP242') || s.includes('MANAGED_MODEL_BASED')) return 'AP242'
  if (s.includes('AUTOMOTIVE_DESIGN') || s.includes('AP214')) return 'AP214'
  if (s.includes('CONFIG_CONTROL_DESIGN') || s.includes('AP203')) return 'AP203'
  return m[1]
}

export function readStepMeta(bytes: Uint8Array): StepMeta {
  const text = new TextDecoder('latin1').decode(bytes)
  const headEnd = text.search(/\bDATA\s*;/)
  const schema = schemaOf(headEnd > 0 ? text.slice(0, headEnd) : text.slice(0, 4000))
  const recs = new Map<number, Rec>()
  let units: StepMeta['units']
  for (const { id, body } of statements(text)) {
    let r: Rec | null = null
    try {
      r = parseRec(body)
    } catch {
      continue
    }
    if (!r) continue
    if (r.type === '()') {
      if (units) continue
      const conv = r.parts!.find((p) => p.type === 'CONVERSION_BASED_UNIT')
      const si = r.parts!.find((p) => p.type === 'SI_UNIT')
      if (conv) {
        const n = str(conv.args[0]).toUpperCase()
        units = n.startsWith('INCH') ? 'in' : n.startsWith('FOOT') || n.startsWith('FEET') ? 'ft' : n.startsWith('MILLI') ? 'mm' : undefined
      } else if (si) {
        const prefix = si.args[0] && typeof si.args[0] === 'object' && 'enum' in si.args[0] ? si.args[0].enum.toUpperCase() : ''
        units = prefix === 'MILLI' ? 'mm' : prefix === 'CENTI' ? 'cm' : prefix === '' ? 'm' : undefined
      }
      continue
    }
    recs.set(id, r)
  }
  // product of a PRODUCT_DEFINITION: PD -> formation -> product
  const productOfPd = (pd: number): number | null => {
    const r = recs.get(pd)
    if (!r || r.type !== 'PRODUCT_DEFINITION') return null
    const f = recs.get(ref(r.args[2]) ?? -1)
    return f ? ref(f.args[2]) : null
  }
  const products = new Map<number, SolidProduct>()
  const order: number[] = []
  for (const [id, r] of recs)
    if (r.type === 'PRODUCT') {
      products.set(id, { name: str(r.args[1]) || str(r.args[0]), properties: {} })
      order.push(id)
    }
  for (const r of recs.values()) {
    if (r.type !== 'PROPERTY_DEFINITION_REPRESENTATION') continue
    const pdef = recs.get(ref(r.args[0]) ?? -1)
    const rep = recs.get(ref(r.args[1]) ?? -1)
    if (!pdef || pdef.type !== 'PROPERTY_DEFINITION' || !rep || rep.type !== 'REPRESENTATION') continue
    const prod = products.get(productOfPd(ref(pdef.args[2]) ?? -1) ?? -1)
    if (!prod) continue
    const items = Array.isArray(rep.args[1]) ? rep.args[1] : []
    for (const it of items) {
      const item = recs.get(ref(it) ?? -1)
      if (!item) continue
      const name = str(item.args[0]) || str(pdef.args[0])
      if (!name) continue
      if (item.type === 'DESCRIPTIVE_REPRESENTATION_ITEM') prod.properties[name] = str(item.args[1])
      else {
        const v = item.args[1]
        const n = typeof v === 'number' ? v : v && typeof v === 'object' && 'type' in v && typeof v.args[0] === 'number' ? v.args[0] : null
        if (n !== null) prod.properties[name] = n
        else if (typeof v === 'string') prod.properties[name] = v
      }
    }
  }
  return { schema, units, products: order.map((id) => products.get(id)!) }
}

/** IGES: version and unit from the global section (parameters 15 unit name, 23 version). */
export function readIgesMeta(bytes: Uint8Array): { schema?: string; units?: StepMeta['units'] } {
  const text = new TextDecoder('latin1').decode(bytes)
  const lines = text.split(/\r?\n/)
  const g = lines
    .filter((l) => l.length >= 73 && l[72] === 'G')
    .map((l) => l.slice(0, 72))
    .join('')
  if (!g) return {}
  // parameter and record delimiters: given as 1H? in fields 1 and 2, else ',' and ';'
  const pd = g.startsWith('1H') ? g[2] : ','
  const afterPd = g.startsWith('1H') ? 3 : 0
  const rdField = g.slice(afterPd + 1)
  const rd = rdField.startsWith('1H') ? rdField[2] : ';'
  const params: string[] = []
  let i = 0
  while (i <= g.length && params.length < 26) {
    const h = /^(\d+)H/.exec(g.slice(i))
    if (h) {
      const n = Number(h[1])
      params.push(g.slice(i + h[0].length, i + h[0].length + n))
      i += h[0].length + n + 1
      continue
    }
    let j = i
    while (j < g.length && g[j] !== pd && g[j] !== rd) j++
    params.push(g.slice(i, j).trim())
    if (g[j] === rd) break
    i = j + 1
  }
  const flag = Number(params[13])
  const name = (params[14] ?? '').toUpperCase()
  const byFlag: Record<number, StepMeta['units']> = { 1: 'in', 2: 'mm', 4: 'ft', 6: 'm', 10: 'cm' }
  const units = name === 'IN' || name === 'INCH' ? 'in' : name === 'MM' ? 'mm' : name === 'FT' ? 'ft' : name === 'M' ? 'm' : name === 'CM' ? 'cm' : byFlag[flag]
  const ver = Number(params[22])
  const versions: Record<number, string> = { 6: 'IGES 4.0', 8: 'IGES 5.0', 9: 'IGES 5.1', 10: 'IGES 5.2', 11: 'IGES 5.3' }
  return { units, schema: Number.isFinite(ver) ? (versions[ver] ?? `IGES (version flag ${ver})`) : 'IGES' }
}
