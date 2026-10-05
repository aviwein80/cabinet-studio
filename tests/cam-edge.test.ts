/**
 * M2.6d: edge work with a rotating aggregate (5AX-04): simulated only; the export checker blocks
 * it on a machine model without an aggregate, and with one (no confirmed woodWOP macro).
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildTimeline, carve, createHeightfield } from '../src/cam/sim'
import { generatePart, simpleMoves } from '../src/cam/toolpath'
import type { CamPart } from '../src/cam/types'
import { defaultAppData, PLACEHOLDER_MACHINE } from '../src/core/defaults'
import { PLACEHOLDER_N200_MODEL } from '../src/core/machineModel'
import { partCollisions } from '../src/cam/collision/collision'
import { runJob } from '../src/core/pipeline'
import type { Job, MachineProfile } from '../src/core/types'
import { digest } from './cam-digest'
import { edgeParts } from './cam-reference-25d'

const machine = PLACEHOLDER_MACHINE
const withAggregate = (m: MachineProfile): MachineProfile => ({ ...m, physical: { ...structuredClone(PLACEHOLDER_N200_MODEL), capabilities: { ...PLACEHOLDER_N200_MODEL.capabilities, aggregate: true } } })

describe('edge work with a rotating aggregate', () => {
  it('the tip runs the reach inside the edge at the tool axis height, square to it; in and out from 2 mm outside', () => {
    const [p] = edgeParts()
    const [tp] = generatePart(p, machine)
    const cut = [...simpleMoves(tp.moves)].filter((m) => (m.t === 'feed' || m.t === 'arc') && m.f === 'cut')
    expect(cut.length).toBeGreaterThan(3)
    for (const m of cut) {
      expect(m.z).toBe(-9.5)
      // 4 mm inside the 500 x 300 outline: on the inset rectangle
      const d = Math.min(m.x, 500 - m.x, m.y, 300 - m.y)
      expect(d).toBeCloseTo(4, 6)
    }
    const leads = [...simpleMoves(tp.moves)].filter((m) => m.t === 'feed' && m.f === 'lead' && m.z === -9.5)
    for (const m of leads) expect(Math.min(m.x, 500 - m.x, m.y, 300 - m.y)).toBeCloseTo(-2, 6)
    expect(tp.edge).toEqual({ height: 9.5, r: 3, flute: 20, side: 'left' })
    expect(tp.intents).toEqual([])
    expect(tp.noOutput).toMatch(/aggregate/)
    expect(tp.warnings.join(' ')).toMatch(/no rotating aggregate/)
  })

  it('passes into the edge; open edges run on past both ends', () => {
    const [, arched, open] = edgeParts()
    const [ta] = generatePart(arched, machine)
    const zs = [...simpleMoves(ta.moves)].filter((m) => m.t === 'feed' && m.f === 'plunge')
    expect(zs).toHaveLength(2)
    const [to] = generatePart(open, machine)
    const cut = [...simpleMoves(to.moves)].filter((m) => (m.t === 'feed' || m.t === 'arc') && m.f === 'cut')
    expect(Math.max(...cut.map((m) => m.x))).toBeCloseTo(610, 6)
    for (const m of cut) expect(m.y).toBeCloseTo(8, 6)
  })

  it('is drawn but not carved, and never counted as a collision (the tool lies flat under the surface)', () => {
    const [p] = edgeParts()
    const paths = generatePart(p, machine)
    const tl = buildTimeline(paths)
    expect(tl.segs.filter((s) => s.kind !== 'rapid').every((s) => s.side)).toBe(true)
    const hf = createHeightfield(p.length, p.width, p.thickness, 1)
    carve(hf, tl, 0, tl.total)
    expect(hf.top.every((z) => z === 0)).toBe(true)
    expect(partCollisions(p, paths, machine).found).toEqual([])
  })

  it('refuses too much reach for the tool', () => {
    const [p] = edgeParts()
    const big = { ...p, ops: [{ ...p.ops[0], reach: 30 }] } as CamPart
    const [tp] = generatePart(big, machine)
    expect(tp.moves).toEqual([])
    expect(tp.warnings.join(' ')).toMatch(/would hit the edge/)
  })

  const errs = (m: MachineProfile) => {
    const [p] = edgeParts()
    const part = { ...p, materialId: 'mat-mdf18' }
    const data = defaultAppData()
    data.machine = m
    const j: Job = { id: 'j', number: 'J31', name: 'Edge', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [part] }
    data.jobs = [j]
    data.settings.features = { ...data.settings.features, camMprOutput: true, cam25dMprOutput: true }
    return runJob(j, data).issues.filter((i) => i.severity === 'error' && i.code !== 'THICKNESS')
  }

  it('export checker: no aggregate on the machine model (the N-200 placeholder): refused with a clear message', () => {
    const e = errs(defaultAppData().machine)
    expect([...new Set(e.map((i) => i.code))].sort()).toEqual(['CAM_NO_OUTPUT', 'MACHINE_CANNOT'])
    expect(e.find((i) => i.code === 'MACHINE_CANNOT')!.message).toMatch(/need a rotating aggregate, and the machine model has none/)
  })

  it('export checker: with an aggregate declared, still refused (no confirmed woodWOP aggregate macro)', () => {
    const e = errs(withAggregate(defaultAppData().machine))
    expect(e.map((i) => i.code)).toEqual(['CAM_NO_OUTPUT'])
    expect(e[0].message).toMatch(/no confirmed woodWOP macro/)
  })
})

describe('goldens: 3 reference parts', () => {
  const DIR = path.join(import.meta.dirname, 'golden', 'cam25d')
  const UPDATE = process.env.UPDATE_GOLDEN === '1'
  for (const p of edgeParts()) {
    it(`${p.id} ${p.name}`, () => {
      const dig = JSON.stringify(generatePart(p, machine).map((tp) => ({ ...digest(tp), edge: tp.edge, noOutput: tp.noOutput })), null, 1) + '\n'
      const f = path.join(DIR, p.id, 'toolpaths.json')
      if (UPDATE) {
        fs.mkdirSync(path.dirname(f), { recursive: true })
        fs.writeFileSync(f, dig, 'utf8')
      }
      expect(fs.existsSync(f), `${f} missing; run UPDATE_GOLDEN=1 once to create it`).toBe(true)
      expect(dig).toBe(fs.readFileSync(f, 'utf8'))
    })
  }
})
