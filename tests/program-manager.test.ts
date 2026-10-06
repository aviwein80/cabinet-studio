import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runPost, SAMPLE_TEMPLATE } from '@/cam/post'
import { readProgram } from '@/cam/programRead'
import { generatePart } from '@/cam/toolpath'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import { checkEditedProgram, copyProblems, programHash, programMath, programState } from '@/core/programEdit'
import { referenceParts } from './cam-reference'

const machine = structuredClone(PLACEHOLDER_MACHINE)
const MPR_DIR = path.resolve(import.meta.dirname, '../examples/sample-job/mpr')
/** A sample-job sheet with drilling (S02). */
const sheet = () => fs.readFileSync(path.join(MPR_DIR, fs.readdirSync(MPR_DIR).filter((f) => f.endsWith('.mpr')).sort()[1]), 'latin1')
const gcode = () => {
  const p = referenceParts()[2]
  return runPost(SAMPLE_TEMPLATE, p.name, generatePart(p, machine, undefined, undefined, true)).text
}

describe('M2.10d simple maths on values', () => {
  it('G-code: one word, decimals kept, comments left alone, a range of lines', () => {
    const text = ['(Y100 is a note)', 'G0 X10 Y20.5 Z5', 'G1 Y.25 F1000 ; Y7 in a comment', 'G1 X1Y2', 'G2 X3 Y-4.000 I1 J0'].join('\r\n')
    const r = programMath(text, { key: 'y', op: '+', value: 5 })
    expect(r.text.split('\r\n')).toEqual(['(Y100 is a note)', 'G0 X10 Y25.5 Z5', 'G1 Y5.25 F1000 ; Y7 in a comment', 'G1 X1Y7', 'G2 X3 Y1.000 I1 J0'])
    expect(r).toMatchObject({ changed: 4, lines: [2, 3, 4, 5] })
    expect(programMath(text, { key: 'F', op: '*', value: 0.8 }).text).toContain('F800 ')
    expect(programMath(text, { key: 'F', op: '*', value: 0.3333 }).text).toContain('F333.300 ')
    const part = programMath(text, { key: 'X', op: '=', value: 0, from: 2, to: 3 })
    expect(part.text.split('\r\n')[1]).toBe('G0 X0 Y20.5 Z5')
    expect(part.lines).toEqual([2])
    expect(programMath('G0 X.5', { key: 'X', op: '-', value: 1 }).text).toBe('G0 X-.5')
  })

  it('MPR: one key exactly (XA is not X), quotes and decimals kept', () => {
    const text = sheet()
    const r = programMath(text, { key: 'TI', op: '+', value: 1 })
    expect(r.changed).toBe((text.match(/^TI="/gm) ?? []).length)
    expect(r.text).not.toBe(text)
    const before = text.split('\r\n').filter((l) => l.startsWith('TI='))
    const after = r.text.split('\r\n').filter((l) => l.startsWith('TI='))
    after.forEach((l, i) => expect(Number(l.slice(4, -1))).toBeCloseTo(Number(before[i].slice(4, -1)) + 1, 9))
    const x = programMath(text, { key: 'X', op: '+', value: 10 })
    expect(x.changed).toBe((text.match(/^X=/gm) ?? []).length)
    expect(x.text.split('\r\n').filter((l) => l.startsWith('XA=')).join()).toBe(text.split('\r\n').filter((l) => l.startsWith('XA=')).join())
    const first = text.split('\r\n').find((l) => l.startsWith('X='))!
    expect(x.text).toContain(`X=${(Number(first.slice(2)) + 10).toFixed(4)}`)
    // the line ends stay as they were
    expect(x.text.includes('\r\n')).toBe(true)
  })

  it('refuses what it cannot do', () => {
    expect(() => programMath('G0 X1', { key: 'XA', op: '+', value: 1 })).toThrow(/one letter/)
    expect(() => programMath('G0 X1', { key: '1', op: '+', value: 1 })).toThrow(/Pick a word/)
    expect(() => programMath('G0 X1', { key: 'X', op: '/', value: 0 })).toThrow(/divide by 0/)
    expect(() => programMath('G0 X1', { key: 'X', op: '+', value: Number.NaN })).toThrow(/number/)
  })
})

describe('M2.10d checks for a program edited by hand', () => {
  it('a generated program passes; an edit too deep, off the table or with an unknown tool does not', () => {
    const text = sheet()
    const T = readProgram(text).stock.thickness
    expect(checkEditedProgram(text, machine).errors).toEqual([])
    const deep = programMath(text, { key: 'ZA', op: '-', value: machine.spoilboardAllowance + 2 })
    expect(checkEditedProgram(deep.text, machine).errors.join(' ')).toMatch(new RegExp(`go deeper than ${(T + machine.spoilboardAllowance).toFixed(2)} mm below the top`))
    const off = programMath(text, { key: 'X', op: '+', value: 5000 })
    expect(checkEditedProgram(off.text, machine).errors.join(' ')).toMatch(/off the table \(3658 x 1524 mm\)/)
    const g = gcode().replace(/T101 M6/, 'T999 M6')
    expect(checkEditedProgram(g, machine, 19).errors).toContain('Profile: uses a tool that is not in the tool table.')
    expect(checkEditedProgram(gcode(), machine, 19).errors).toEqual([])
    expect(checkEditedProgram('hello', machine).errors.length).toBeGreaterThan(0)
  })

  it('an edit belongs to the program it was made on; copying follows the export rules, and edited programs their own switch and check', () => {
    const gen = sheet()
    const edits = { 'S1.mpr': { text: gen.replace('TI="', 'TI="1'), base: programHash(gen), editedAt: '' } }
    expect(programState(undefined, 'S1.mpr', gen)).toBe('generated')
    expect(programState(edits, 'S1.mpr', gen)).toBe('edited')
    expect(programState(edits, 'S1.mpr', gen + ' ')).toBe('stale')
    const ok = { jobErrors: 0, acknowledged: true, folder: 'C:/N200', state: 'generated' as const, editedSwitch: false }
    expect(copyProblems(ok)).toEqual([])
    expect(copyProblems({ ...ok, folder: '' })).toEqual(['Set the machine folder on the Machine page (Shop settings).'])
    expect(copyProblems({ ...ok, jobErrors: 2 })).toEqual(['The export checker found 2 errors in this job.'])
    expect(copyProblems({ ...ok, acknowledged: false })[0]).toMatch(/simulate every program/)
    expect(copyProblems({ ...ok, state: 'stale' })[0]).toMatch(/job changed after this program was edited/)
    expect(copyProblems({ ...ok, state: 'edited' })).toEqual(['Edited by hand: "Copy hand-edited programs to the machine folder" is off (Machine page).', 'Edited by hand: run the check on the edited program first.'])
    expect(copyProblems({ ...ok, state: 'edited', editedSwitch: true, check: { errors: ['x'] } })).toEqual(['Edited by hand: the check found 1 problem.'])
    expect(copyProblems({ ...ok, state: 'edited', editedSwitch: true, check: { errors: [] } })).toEqual([])
  })
})
