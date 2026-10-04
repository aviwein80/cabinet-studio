/**
 * Numeric input: arithmetic with + - * / ^ %, parentheses, variables and functions
 * (sin cos tan asin acos atan atan2 sqrt abs min max round floor ceil hyp; angles in degrees),
 * constants pi and e. Lengths may carry a unit suffix (mm, cm, in, ") and inch fractions such
 * as 23-1/4 when the display unit is inches.
 */
import { parseLength } from '@/core/units'
import type { UnitSystem } from '@/core/types'

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string }

const D = Math.PI / 180
const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: (a) => Math.sin(a * D),
  cos: (a) => Math.cos(a * D),
  tan: (a) => Math.tan(a * D),
  asin: (a) => Math.asin(a) / D,
  acos: (a) => Math.acos(a) / D,
  atan: (a) => Math.atan(a) / D,
  atan2: (y, x) => Math.atan2(y, x) / D,
  sqrt: Math.sqrt,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  round: (a, n = 0) => Math.round(a * 10 ** n) / 10 ** n,
  floor: Math.floor,
  ceil: Math.ceil,
  hyp: Math.hypot,
}

function tokenize(src: string, toMm: (n: number, unit?: string) => number): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    const num = /^(\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*(mm|cm|in|")?/i.exec(src.slice(i))
    if (num) {
      const unit = num[2]?.toLowerCase()
      out.push({ t: 'num', v: toMm(Number(num[1]), unit) })
      i += num[0].length
      continue
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))
    if (id) {
      out.push({ t: 'id', v: id[0] })
      i += id[0].length
      continue
    }
    if ('+-*/^%(),'.includes(c)) {
      out.push({ t: 'op', v: c })
      i++
      continue
    }
    throw new Error(`Unexpected "${c}"`)
  }
  return out
}

export function evaluate(src: string, vars: Record<string, number> = {}, toMm: (n: number, unit?: string) => number = (n) => n): number {
  const toks = tokenize(src, toMm)
  let i = 0
  const peek = () => toks[i]
  const take = (v?: string) => {
    const t = toks[i]
    if (!t || (v && t.v !== v)) throw new Error(v ? `Expected "${v}"` : 'Unexpected end')
    i++
    return t
  }
  const primary = (): number => {
    const t = take()
    if (t.t === 'num') return t.v
    if (t.t === 'op' && t.v === '(') {
      const v = expr()
      take(')')
      return v
    }
    if (t.t === 'op' && t.v === '-') return -power()
    if (t.t === 'op' && t.v === '+') return power()
    if (t.t === 'id') {
      const name = t.v
      if (peek()?.v === '(') {
        take('(')
        const args: number[] = []
        if (peek()?.v !== ')') {
          args.push(expr())
          while (peek()?.v === ',') {
            take(',')
            args.push(expr())
          }
        }
        take(')')
        const f = FUNCS[name.toLowerCase()]
        if (!f) throw new Error(`Unknown function ${name}`)
        return f(...args)
      }
      if (name.toLowerCase() === 'pi') return Math.PI
      if (name === 'e') return Math.E
      if (name in vars) return vars[name]
      throw new Error(`Unknown name ${name}`)
    }
    throw new Error(`Unexpected "${t.v}"`)
  }
  const power = (): number => {
    const b = primary()
    if (peek()?.v === '^') {
      take('^')
      return b ** power()
    }
    return b
  }
  const term = (): number => {
    let v = power()
    while (peek() && ['*', '/', '%'].includes(peek()!.v as string)) {
      const op = take().v
      const r = power()
      v = op === '*' ? v * r : op === '/' ? v / r : v % r
    }
    return v
  }
  const expr = (): number => {
    let v = term()
    while (peek() && (peek()!.v === '+' || peek()!.v === '-')) {
      const op = take().v
      const r = term()
      v = op === '+' ? v + r : v - r
    }
    return v
  }
  const v = expr()
  if (i < toks.length) throw new Error(`Unexpected "${toks[i].v}"`)
  if (!Number.isFinite(v)) throw new Error('Result is not a number')
  return v
}

/**
 * A length typed in the display unit (expression or inch fraction) -> mm. The expression is
 * evaluated in the display unit, so variables (stored in mm) are treated as lengths.
 */
export function evalLength(src: string, units: UnitSystem, vars: Record<string, number> = {}): number {
  const s = src.trim()
  if (units === 'in') {
    const direct = /^-?\d+([\s-]+\d+\s*\/\s*\d+|\s*\/\s*\d+)"?$/.test(s) ? parseLength(s, 'in') : null
    if (direct !== null) return direct
  }
  const k = units === 'in' ? 25.4 : 1
  const conv = (n: number, unit?: string) => (unit === 'mm' ? n : unit === 'cm' ? n * 10 : unit === 'in' || unit === '"' ? n * 25.4 : n * k) / k
  const scaled = k === 1 ? vars : Object.fromEntries(Object.entries(vars).map(([n, v]) => [n, v / k]))
  return evaluate(s, scaled, conv) * k
}

/** Evaluate part variables in order; later variables may use earlier ones. */
export function resolveVariables(list: { name: string; value: number; expr?: string }[], base: Record<string, number> = {}): Record<string, number> {
  const out: Record<string, number> = { ...base }
  for (let pass = 0; pass < 3; pass++)
    for (const v of list) {
      if (!v.expr) out[v.name] = v.value
      else
        try {
          out[v.name] = evaluate(v.expr, out)
        } catch {
          if (pass === 2) out[v.name] = v.value
        }
    }
  return out
}

export type CoordInput = { kind: 'abs'; x: number; y: number } | { kind: 'rel'; dx: number; dy: number } | { kind: 'polar'; rel: boolean; d: number; a: number } | { kind: 'value'; v: number } | { kind: 'unknown' }

/**
 * Prompt-line input: "x,y" absolute, "@dx,dy" relative, "@d<a" / "d<a" polar (degrees),
 * a single value, or "?" for "take it from the cursor".
 */
export function parseCoord(src: string, units: UnitSystem, vars: Record<string, number> = {}): CoordInput {
  const s = src.trim()
  if (s === '?') return { kind: 'unknown' }
  const rel = s.startsWith('@')
  const body = rel ? s.slice(1) : s
  const lenOf = (x: string) => evalLength(x, units, vars)
  if (body.includes('<')) {
    const [d, a] = body.split('<')
    return { kind: 'polar', rel, d: lenOf(d), a: evaluate(a, vars) }
  }
  const parts = splitTopLevel(body)
  if (parts.length === 2) {
    const [x, y] = parts.map(lenOf)
    return rel ? { kind: 'rel', dx: x, dy: y } : { kind: 'abs', x, y }
  }
  return { kind: 'value', v: lenOf(body) }
}

function splitTopLevel(s: string) {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}
