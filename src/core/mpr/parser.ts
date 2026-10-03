/**
 * Minimal MPR 4.x reader. Used to lint generated files and to compare them against
 * programs exported from the shop's own woodWOP (field names, macro order, tool numbers).
 * It does not evaluate formulas.
 */

export interface MprBlock {
  /** "H", "001", "K", "contour", or a macro id such as "102". */
  type: string
  name?: string
  /** Contour number for contour blocks. */
  contour?: number
  fields: [string, string][]
  /** Contour elements for contour blocks. */
  elements?: { index: number; kind: string; fields: [string, string][] }[]
  line: number
}

export interface ParsedMpr {
  blocks: MprBlock[]
  endMarker: boolean
  crlf: boolean
  lfOnlyLines: number
}

export function parseMpr(text: string): ParsedMpr {
  const lfOnlyLines = (text.match(/(?<!\r)\n/g) ?? []).length
  const crlf = lfOnlyLines === 0 && text.includes('\r\n')
  const lines = text.split(/\r?\n/)
  const blocks: MprBlock[] = []
  let cur: MprBlock | null = null
  let el: NonNullable<MprBlock['elements']>[number] | null = null
  let endMarker = false
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    if (line === '!') {
      endMarker = true
      break
    }
    if (!line || line.startsWith('\\')) continue
    let m: RegExpMatchArray | null
    if ((m = line.match(/^\[(H|\d{3}|K)\b/))) {
      cur = { type: m[1], fields: [], line: i + 1 }
      el = null
      blocks.push(cur)
      continue
    }
    if ((m = line.match(/^\](\d+)/))) {
      cur = { type: 'contour', contour: Number(m[1]), fields: [], elements: [], line: i + 1 }
      el = null
      blocks.push(cur)
      continue
    }
    if ((m = line.match(/^<(\d+)\s*\\([^\\]*)\\?/))) {
      cur = { type: m[1], name: m[2], fields: [], line: i + 1 }
      el = null
      blocks.push(cur)
      continue
    }
    if (cur?.type === 'contour' && (m = line.match(/^\$E(\d+)/))) {
      el = { index: Number(m[1]), kind: '', fields: [] }
      cur.elements!.push(el)
      continue
    }
    if (el && !el.kind && /^K[A-Z]+/.test(line)) {
      el.kind = line.split(/\s+/)[0]
      continue
    }
    if ((m = line.match(/^([^=]+)=(.*)$/))) {
      const key = m[1]
      let value = m[2]
      if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1)
      if (el) el.fields.push([key, value])
      else if (cur) cur.fields.push([key, value])
    }
  }
  return { blocks, endMarker, crlf, lfOnlyLines }
}

export const field = (b: MprBlock, key: string) => b.fields.find(([k]) => k === key)?.[1]
