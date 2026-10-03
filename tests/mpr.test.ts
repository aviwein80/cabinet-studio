import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { field, parseMpr } from '../src/core/mpr/parser'
import { encodeCp1252, mprText } from '../src/core/mpr/writer'
import { mprFiles, runJob } from '../src/core/pipeline'
import { sampleJob } from '../src/core/sample'
import type { AppData, Job } from '../src/core/types'
import { cabinet, data, job } from './helpers'

const GOLDEN = path.join(import.meta.dirname, 'golden')
const UPDATE = process.env.UPDATE_GOLDEN === '1'

function golden(name: string, text: string) {
  const file = path.join(GOLDEN, name)
  if (UPDATE || !fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, encodeCp1252(text))
  }
  const expected = fs.readFileSync(file, 'latin1')
  expect(text, `${name} differs from golden file (run UPDATE_GOLDEN=1 npm test to accept)`).toBe(expected)
}

function generate(j: Job, d: AppData) {
  const out = runJob(j, d)
  return { out, files: mprFiles(j, d, out) }
}

const singleBase = () => job([cabinet('tpl-base-2door')], 'G001')

describe('MPR golden files', () => {
  it('single base cabinet, router-pocket grooves, drills by diameter', () => {
    const { files } = generate(singleBase(), data())
    expect(files.map((f) => f.name)).toEqual(['G001_S01_HDF6-WHT.mpr', 'G001_S02_PB18-WHT.mpr'])
    for (const f of files) golden(`single-base/${f.name}`, f.text)
  })

  it('single base cabinet, saw grooves and tool-number drilling', () => {
    const d = data((x) => {
      x.machine.grooveMethod = 'saw'
      x.machine.drillAddressing = 'tool-number'
    })
    const { files } = generate(singleBase(), d)
    golden('single-base-saw/' + files[1].name, files[1].text)
  })

  it('sink base with a horizontal drilling unit enabled', () => {
    const d = data((x) => {
      x.machine.hasHorizontalDrillUnit = true
      x.machine.tools.push({ id: 'th8', number: 301, type: 'drill-horizontal', name: 'Horizontal 8', diameter: 8, maxDepth: 35 })
    })
    const { files } = generate(job([cabinet('tpl-sink-base')], 'G002'), d)
    const carcass = files.find((f) => f.name.includes('PB18'))!
    expect(carcass.text).toContain('<103 \\BohrHoriz\\')
    golden('sink-hdrill/' + carcass.name, carcass.text)
  })

  it('full sample kitchen', () => {
    const { files } = generate(sampleJob(), data())
    expect(files.length).toBe(3)
    for (const f of files) golden(`sample-kitchen/${f.name}`, f.text)
  })
})

describe('MPR structure', () => {
  const { out, files } = generate(sampleJob(), data())

  it('uses CRLF everywhere, ASCII only, and ends with "!"', () => {
    for (const f of files) {
      const p = parseMpr(f.text)
      expect(p.crlf).toBe(true)
      expect(p.lfOnlyLines).toBe(0)
      expect(p.endMarker).toBe(true)
      expect(f.text.trimEnd().endsWith('!')).toBe(true)
      expect(/^[\x20-\x7e\r\n]*$/.test(f.text)).toBe(true)
    }
  })

  it('writes header, variables, contours, workpiece, macros in that order', () => {
    for (const f of files) {
      const p = parseMpr(f.text)
      const types = p.blocks.map((b) => b.type)
      expect(types[0]).toBe('H')
      expect(types[1]).toBe('001')
      const firstMacro = types.indexOf('100')
      expect(types.slice(2, firstMacro).every((t) => t === 'contour')).toBe(true)
      const h = p.blocks[0]
      expect(field(h, 'VERSION')).toBe('4.0 Alpha')
      expect(field(h, 'INCH')).toBe('0')
      expect(field(h, 'MAT')).toBe('HOMAG')
    }
  })

  it('uses "Nuten" (never "grooveen") for saw grooves', () => {
    const d = data((x) => (x.machine.grooveMethod = 'saw'))
    const { files: sawFiles } = generate(singleBase(), d)
    const text = sawFiles.map((f) => f.text).join('')
    expect(text).toContain('<109 \\Nuten\\')
    expect(text).not.toContain('grooveen')
  })

  it('every contour macro references a closed contour with matching element count', () => {
    for (const f of files) {
      const p = parseMpr(f.text)
      const contours = new Map(p.blocks.filter((b) => b.type === 'contour').map((b) => [b.contour!, b]))
      const routes = p.blocks.filter((b) => b.type === '105')
      expect(routes.length).toBe(contours.size)
      for (const r of routes) {
        const [n, start] = field(r, 'EA')!.split(':').map(Number)
        const [n2, end] = field(r, 'EE')!.split(':').map(Number)
        expect(n).toBe(n2)
        expect(start).toBe(0)
        const c = contours.get(n)!
        expect(c.elements!.length - 1).toBe(end)
        const first = c.elements![0]
        const last = c.elements![c.elements!.length - 1]
        expect(first.kind).toBe('KP')
        expect(field({ ...first, type: '', line: 0 }, 'X')).toBe(field({ ...last, type: '', line: 0 }, 'X'))
        expect(field({ ...first, type: '', line: 0 }, 'Y')).toBe(field({ ...last, type: '', line: 0 }, 'Y'))
        expect(Number(field(r, 'ZA'))).toBeLessThan(0)
        expect(field(r, 'RK')).toBe('WRKL')
      }
    }
  })

  it('writes a notched (toe-kick) side as a 7-element contour', () => {
    const p = parseMpr(files.find((f) => f.name.includes('PB18'))!.text)
    expect(p.blocks.some((b) => b.type === 'contour' && b.elements!.length === 8)).toBe(true)
  })

  it('carries the productionManager feedback comment and MPR numbering', () => {
    files.forEach((f, i) => {
      expect(f.text).toContain(`HOMAG_PRODUCTIONMANAGER_FEEDBACK={Version:1.00,PARTID:${f.name.replace('.mpr', '')},MPRNUMBER:${i + 1},MPRCOUNT:${files.length}}`)
    })
  })

  it('drills every hole with DU from the tool table and never more than one hole per macro', () => {
    const p = parseMpr(files[1].text)
    const drills = p.blocks.filter((b) => b.type === '102')
    expect(drills.length).toBe(out.programs[1].ops.filter((o) => o.kind === 'vdrill').length)
    for (const b of drills) {
      expect(field(b, 'AN')).toBe('1')
      expect(['5', '7', '8', '35']).toContain(field(b, 'DU'))
    }
  })

  it('leaves horizontal holes out when there is no horizontal unit', () => {
    expect(files.some((f) => f.text.includes('<103'))).toBe(false)
    expect(out.programs.some((p) => p.skipped.length > 0)).toBe(true)
  })

  it('sanitises text for MPR strings', () => {
    expect(mprText('Küche "Cohen"\r\nא')).toBe("Kueche 'Cohen'  ?")
  })
})

describe('parser accepts real woodWOP files', () => {
  const dir = path.join(import.meta.dirname, '..', 'reference', 'samples')
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.mpr$/i.test(f)) : []
  it.skipIf(files.length === 0)('parses reference samples (if present locally)', () => {
    for (const f of files) {
      const p = parseMpr(fs.readFileSync(path.join(dir, f), 'latin1'))
      expect(p.blocks[0].type, f).toBe('H')
      expect(p.blocks.some((b) => b.type === '100'), f).toBe(true)
    }
  })
})
