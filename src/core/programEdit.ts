/**
 * Program manager and editor (M2.10, PST-04): simple maths on a program's values, and the checks a
 * program edited by hand must pass before it may be copied to the machine folder.
 *
 * Maths works on one key at a time: a G-code word (X, Y, Z, F, S, ...; comments are left alone) or
 * an MPR key (XA, TI, X in contours, ...; quoted or not). Each changed number keeps its own number
 * of decimals (at least three if the result is not whole), so the rest of the program is untouched.
 */
import { isMprText, readProgram, type ReadProgram } from '@/cam/programRead'
import { sha256Hex } from './sha256'
import { machineModelOf } from './machineModel'
import type { MachineProfile } from './types'

export type MathOp = '+' | '-' | '*' | '/' | '='

export interface MathRequest {
  /** G-code letter (X) or MPR key (XA). */
  key: string
  op: MathOp
  value: number
  /** 1-based, inclusive; absent = the whole program. */
  from?: number
  to?: number
}

export interface MathResult {
  text: string
  changed: number
  /** 1-based line numbers changed. */
  lines: number[]
}

function formatLike(original: string, v: number): string {
  const dec = /\.(\d*)/.exec(original)?.[1].length ?? 0
  // the original's decimals when they hold the result, otherwise at least three
  const need = Math.abs(Number(v.toFixed(dec)) - v) < 1e-9 ? dec : Math.max(dec, 3)
  let s = v.toFixed(need)
  if (/^-0(\.0*)?$/.test(s)) s = s.slice(1)
  // keep a leading "+" or a missing leading zero as they were written ("X.5")
  if (/^\+/.test(original) && !s.startsWith('-')) s = `+${s}`
  if (/^[-+]?\.\d/.test(original)) s = s.replace(/^(-?)0\./, '$1.')
  return s
}

const apply = (v: number, op: MathOp, k: number) => (op === '+' ? v + k : op === '-' ? v - k : op === '*' ? v * k : op === '/' ? v / k : k)

export function programMath(text: string, req: MathRequest): MathResult {
  const key = req.key.trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error('Pick a word such as X, Y, Z or F (G-code) or a key such as XA or TI (MPR).')
  if (!Number.isFinite(req.value)) throw new Error('Enter a number.')
  if (req.op === '/' && req.value === 0) throw new Error('Cannot divide by 0.')
  const mpr = isMprText(text)
  if (!mpr && key.length !== 1) throw new Error('G-code words are one letter (X, Y, Z, F, ...).')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const changedLines: number[] = []
  let changed = 0
  const NUM = '([-+]?(?:\\d+\\.?\\d*|\\.\\d+))'
  const out = lines.map((line, i) => {
    const n = i + 1
    if ((req.from !== undefined && n < req.from) || (req.to !== undefined && n > req.to)) return line
    let hit = false
    let next: string
    if (mpr) {
      const m = new RegExp(`^(${key})=("?)${NUM}("?)\\s*$`).exec(line)
      if (!m || m[2] !== m[4]) return line
      hit = true
      changed++
      next = `${m[1]}=${m[2]}${formatLike(m[3], apply(Number(m[3]), req.op, req.value))}${m[4]}`
    } else {
      // leave comments alone: "( ... )" and everything after ";"
      const parts = line.split(/(\([^)]*\)|;.*$)/)
      next = parts
        .map((p) =>
          p.startsWith('(') || p.startsWith(';')
            ? p
            : p.replace(new RegExp(`(^|[^A-Za-z])(${key})\\s*${NUM}`, 'gi'), (_all, pre: string, k: string, v: string) => {
                hit = true
                changed++
                return `${pre}${k}${formatLike(v, apply(Number(v), req.op, req.value))}`
              }),
        )
        .join('')
    }
    if (hit) changedLines.push(n)
    return next
  })
  return { text: out.join(eol), changed, lines: changedLines }
}

/** Hash of a program's text: an edit belongs to the program it was made on. */
export const programHash = (text: string) => sha256Hex(text)

export interface ProgramCheck {
  read: ReadProgram
  errors: string[]
  warnings: string[]
}

/**
 * The checks for a program edited by hand: it must read back with no refusals, its cutting moves
 * must stay on the machine's table (MPR; a tool radius beyond its edge is the centre of an outside
 * cut), above the spoilboard allowance under the stock, and use tools from the table. (The export checker's own checks ran on the program before it was edited; the
 * edit itself is checked here as far as the program text allows.)
 */
export function checkEditedProgram(text: string, machine: MachineProfile, stockThickness?: number): ProgramCheck {
  const read = readProgram(text, { machine })
  const errors = [...read.errors]
  const warnings = [...read.warnings]
  const T = stockThickness ?? read.stock.thickness
  const floor = -(T + machine.spoilboardAllowance)
  const table = machineModelOf(machine).table
  let deep = 0
  let off = 0
  for (const tp of read.toolpaths) {
    if (tp.warnings.some((w) => /not in the tool table/.test(w)) || (!tp.tool && tp.moves.length)) errors.push(`${tp.name}: uses a tool that is not in the tool table.`)
    // the tool centre of an outside cut runs one tool radius beyond the edge
    const r = (tp.tool?.diameter ?? 0) / 2 + 1e-6
    for (const m of tp.moves) {
      if (m.t === 'poly' || m.t === 'rapid') continue
      if (m.z < floor - 1e-6) deep++
      if (read.format === 'mpr' && (m.x < -r || m.y < -r || m.x > table.length + r || m.y > table.width + r)) off++
    }
  }
  if (deep) errors.push(`${deep} cutting move${deep === 1 ? '' : 's'} go deeper than ${(-floor).toFixed(2)} mm below the top (stock ${T} mm + spoilboard allowance ${machine.spoilboardAllowance} mm).`)
  if (off) errors.push(`${off} cutting move${off === 1 ? '' : 's'} are off the table (${table.length} x ${table.width} mm).`)
  if (read.format === 'gcode') warnings.push('Table limits are not checked for G-code: its origin is set on the machine.')
  if (!read.toolpaths.length) errors.push('The program has no moves.')
  return { read, errors, warnings }
}

export type ProgramState = 'generated' | 'edited' | 'stale'

/** Is this program as generated, edited by hand, or edited on a version the job no longer makes? */
export function programState(edits: Record<string, { base: string }> | undefined, name: string, generated: string): ProgramState {
  const e = edits?.[name]
  if (!e) return 'generated'
  return e.base === programHash(generated) ? 'edited' : 'stale'
}

/**
 * Why a program may not be copied to the machine folder (empty = it may). Programs as generated
 * follow the export rules (no export-checker errors, the "simulate in woodWOP" acknowledgement);
 * edited programs also need their own switch and a clean check of the edited text.
 */
export function copyProblems(o: { jobErrors: number; acknowledged: boolean; folder?: string; state: ProgramState; editedSwitch: boolean; check?: Pick<ProgramCheck, 'errors'> | null }): string[] {
  const out: string[] = []
  if (!o.folder?.trim()) out.push('Set the machine folder on the Machine page (Shop settings).')
  if (o.jobErrors) out.push(`The export checker found ${o.jobErrors} error${o.jobErrors === 1 ? '' : 's'} in this job.`)
  if (!o.acknowledged) out.push('Tick "I will simulate every program in woodWOP before running it" first.')
  if (o.state === 'stale') out.push('The job changed after this program was edited: the edit no longer matches the program the job makes. Edit it again or go back to the generated program.')
  if (o.state === 'edited') {
    if (!o.editedSwitch) out.push('Edited by hand: "Copy hand-edited programs to the machine folder" is off (Machine page).')
    if (!o.check) out.push('Edited by hand: run the check on the edited program first.')
    else if (o.check.errors.length) out.push(`Edited by hand: the check found ${o.check.errors.length} problem${o.check.errors.length === 1 ? '' : 's'}.`)
  }
  return out
}
