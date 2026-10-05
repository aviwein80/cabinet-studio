import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePart, serializePart } from '../src/cam/doc'
import { writePartMpr } from '../src/cam/mpr'
import { readMpr } from '../src/cam/mprRead'
import { generatePart, simpleMoves } from '../src/cam/toolpath'
import { digest } from './cam-digest'
export { digest }
import { PLACEHOLDER_MACHINE } from '../src/core/defaults'
import { referenceParts } from './cam-reference'

const DIR = path.join(import.meta.dirname, 'golden', 'cam')
const UPDATE = process.env.UPDATE_GOLDEN === '1'

function file(name: string, make: () => string) {
  const f = path.join(DIR, name)
  if (UPDATE || !fs.existsSync(f)) {
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, make(), 'latin1')
  }
  return fs.readFileSync(f, 'latin1')
}

const machine = PLACEHOLDER_MACHINE

describe('20 reference parts: geometry JSON in, toolpaths and MPR out', () => {
  const parts = referenceParts()
  it('has twenty distinct parts', () => {
    expect(parts).toHaveLength(20)
    expect(new Set(parts.map((p) => p.id)).size).toBe(20)
  })
  for (const built of parts) {
    it(`${built.id} ${built.name}`, () => {
      const input = parsePart(file(`${built.id}/part.json`, () => serializePart(built)))
      expect(serializePart(input), 'reference builder changed; run UPDATE_GOLDEN=1').toBe(serializePart(built))
      const paths = generatePart(input, machine)
      expect(paths.length).toBe(input.ops.filter((o) => o.enabled).length)
      const dig = JSON.stringify(paths.map(digest), null, 1) + '\n'
      expect(dig, `${built.id} toolpaths differ from golden (UPDATE_GOLDEN=1 to accept)`).toBe(file(`${built.id}/toolpaths.json`, () => dig))
      const mpr = writePartMpr(input, paths, machine, 'REF')
      expect(mpr, `${built.id} MPR differs from golden`).toBe(file(`${built.id}/part.mpr`, () => mpr))

      // invariants that hold for every part
      const doc = readMpr(mpr)
      expect(doc.errors).toEqual([])
      expect(doc.ended).toBe(true)
      const floor = -(input.thickness + machine.throughDepth) - 1e-6
      for (const tp of paths) for (const m of simpleMoves(tp.moves)) expect(m.z).toBeGreaterThanOrEqual(floor)
      for (const tp of paths)
        for (const m of simpleMoves(tp.moves)) {
          if (m.t === 'rapid') continue
          const slack = (tp.tool?.diameter ?? 12) * 3 + 15
          expect(m.x).toBeGreaterThanOrEqual(-slack)
          expect(m.y).toBeGreaterThanOrEqual(-slack)
          expect(m.x).toBeLessThanOrEqual(input.length + slack)
          expect(m.y).toBeLessThanOrEqual(input.width + slack)
        }
    })
  }
})

describe('reference part checks that do not depend on goldens', () => {
  const parts = referenceParts()
  const get = (id: string) => generatePart(parts.find((p) => p.id === id)!, machine)

  it('spiral pocket stays inside the circle less the tool radius', () => {
    const [tp] = get('ref10')
    let max = 0
    for (const m of simpleMoves(tp.moves)) {
      if (m.t === 'rapid') continue
      max = Math.max(max, Math.hypot(m.x - 150, m.y - 150))
      if (m.t === 'arc') max = Math.max(max, Math.hypot(m.cx - 150, m.cy - 150) + Math.hypot(m.x - m.cx, m.y - m.cy))
    }
    expect(max).toBeLessThanOrEqual(60 - 4 + 1e-6)
    expect(max).toBeGreaterThan(56 - 1e-6)
  })

  it('zig-zag pocket links passes without lifting', () => {
    const [tp] = get('ref09')
    expect(tp.moves.filter((m) => m.t === 'rapid').length).toBeLessThanOrEqual(6)
  })

  it('peck drilling retracts between pecks of decreasing size', () => {
    const [tp] = get('ref17')
    const zs = [...simpleMoves(tp.moves)].filter((m) => m.t === 'feed' && m.z < 0).map((m) => -m.z)
    const pecks = zs.slice(0, zs.length / 2).map((z, i, a) => z - (a[i - 1] ?? 0))
    expect(pecks[0]).toBeCloseTo(10)
    for (let i = 1; i < pecks.length - 1; i++) expect(pecks[i]).toBeLessThanOrEqual(pecks[i - 1] + 1e-9)
    expect(Math.max(...zs)).toBeCloseTo(30)
  })

  it('three-cut profile with roughing goes through the sheet', () => {
    const [tp] = get('ref18')
    const levels = new Set([...simpleMoves(tp.moves)].filter((m) => m.t !== 'rapid').map((m) => Math.round(m.z * 1000) / 1000))
    expect([...levels].filter((z) => z < 0).length).toBeGreaterThanOrEqual(3)
    expect(Math.min(...levels)).toBeCloseTo(-(38 + machine.throughDepth))
  })
})
