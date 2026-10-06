/**
 * Rapid surfaces (2D-18, M3.2): moves between cuts follow a cylinder or sphere instead of the flat
 * safe height, never below the clearance height. Cutting moves are untouched; woodWOP programs are
 * unchanged (the machine makes its own moves between cuts).
 */
import { describe, expect, it } from 'vitest'
import { makeEntity, newPart, parsePart, serializePart } from '@/cam/doc'
import { circle } from '@/cam/geom'
import { onRapidSurface, suggestSurface, surfaceZ } from '@/cam/more25d/rapidSurface'
import { defaultOp } from '@/cam/ops'
import { generateOp, type Move } from '@/cam/toolpath'
import type { CamOp, CamPart, RapidSurface } from '@/cam/types'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'

const machine = PLACEHOLDER_MACHINE

/** A 600 x 300 panel with four drilled-style pockets far apart. */
function panel(surface?: RapidSurface): { part: CamPart; op: CamOp } {
  const part = newPart({ name: 'Arched', length: 600, width: 300, thickness: 18, materialId: 'mat-mdf18' })
  const holes = [
    [50, 50],
    [550, 50],
    [550, 250],
    [50, 250],
    [300, 150],
  ].map(([x, y]) => makeEntity({ t: 'contour', c: circle({ x, y }, 12) }, 'pockets'))
  part.entities = [...part.entities, ...holes]
  const op = { ...defaultOp('pocket', holes.map((h) => h.id)), toolId: 't101', ...(surface ? { rapidSurface: surface } : {}) } as CamOp
  part.ops = [op]
  return { part, op }
}

const isCut = (m: Move) => m.t !== 'rapid'

describe('rapid surfaces', () => {
  const safe = 20
  const minZ = 5
  const cyl = suggestSurface('cylinder', 600, 300, safe, minZ) as Extract<RapidSurface, { kind: 'cylinder' }>

  it('the suggested cylinder runs along the panel, at the safe height over its middle and the clearance height at its edges', () => {
    expect(cyl.axis).toBe('x')
    expect(surfaceZ(cyl, { x: 300, y: 150 })).toBeCloseTo(20, 9)
    expect(surfaceZ(cyl, { x: 0, y: 0 })).toBeCloseTo(5, 9)
    expect(surfaceZ(cyl, { x: 600, y: 300 })).toBeCloseTo(5, 9)
    const dome = suggestSurface('sphere', 600, 300, safe, minZ)
    expect(surfaceZ(dome, { x: 300, y: 150 })).toBeCloseTo(20, 9)
    expect(surfaceZ(dome, { x: 0, y: 0 })).toBeCloseTo(5, 9)
  })

  it('rapids across follow the surface; every rapid point is on it (or held at the clearance height); cuts are unchanged', () => {
    const plain = panel()
    const flat = generateOp(plain.op, { part: plain.part, machine })
    expect(flat.moves.length).toBeGreaterThan(20)
    // the same panel (same shape ids) with the surface
    const op = { ...plain.op, rapidSurface: { ...cyl, confirmed: true } } as CamOp
    const part = { ...plain.part, ops: [op] }
    const tp = generateOp(op, { part, machine })
    // cutting moves exactly the same, in the same order; what woodWOP gets (the intents) unchanged
    expect(tp.moves.filter(isCut)).toEqual(flat.moves.filter(isCut))
    expect(tp.intents).toEqual(flat.intents)
    const rapids = tp.moves.filter((m): m is Extract<Move, { t: 'rapid' }> => m.t === 'rapid')
    const raised = rapids.filter((m) => m.z > op.levels.rapidZ + 1e-9)
    expect(raised.length).toBeGreaterThan(flat.moves.filter((m) => m.t === 'rapid').length)
    for (const m of raised) expect(m.z).toBeCloseTo(Math.max(minZ, surfaceZ(cyl, m)!), 9)
    // nothing ever below the clearance height between cuts, and lower than the flat safe height near the edges
    for (const m of rapids) expect(m.z).toBeGreaterThanOrEqual(op.levels.rapidZ - 1e-9)
    expect(Math.min(...raised.map((m) => m.z))).toBeLessThan(safe - 5)
    // steps across are short enough that the straight rapid between two points stays within 0.1 mm of the surface
    for (let i = 1; i < tp.moves.length; i++) {
      const a = tp.moves[i - 1]
      const b = tp.moves[i]
      if (a.t !== 'rapid' || b.t !== 'rapid' || a.z <= op.levels.rapidZ + 1e-9 || b.z <= op.levels.rapidZ + 1e-9) continue
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const want = Math.max(minZ, surfaceZ(cyl, mid)!)
      expect(Math.abs((a.z + b.z) / 2 - want)).toBeLessThan(0.1 + 1e-9)
    }
    expect(tp.warnings.join(' ')).toMatch(/woodWOP/)
    expect(tp.stats.rapid).toBeLessThan(flat.stats.rapid * 1.2)
  })

  it('never below the clearance height: a low surface is held there, with a warning; beside it, the flat safe height', () => {
    const low: RapidSurface = { kind: 'cylinder', axis: 'x', centre: 150, z: -40, r: 50, confirmed: true }
    const moves: Move[] = [
      { t: 'rapid', x: 0, y: 150, z: 20 },
      { t: 'rapid', x: 100, y: 150, z: 20 },
      { t: 'feed', x: 100, y: 150, z: -3, f: 'plunge' },
      { t: 'rapid', x: 100, y: 150, z: 20 },
      { t: 'rapid', x: 100, y: 290, z: 20 },
    ]
    const r = onRapidSurface(moves, low, 20, 5)
    expect(r.held).toBeGreaterThan(0)
    expect(r.outside).toBeGreaterThan(0)
    expect(r.warnings.join(' ')).toMatch(/held at the clearance height/)
    expect(r.warnings.join(' ')).toMatch(/flat safe height/)
    for (const m of r.moves) if (m.t === 'rapid') expect(m.z).toBeGreaterThanOrEqual(5)
    // the feed is kept as it was
    expect(r.moves.filter((m) => m.t === 'feed')).toEqual([moves[2]])
  })

  it('saved and read back with the part', () => {
    const { part } = panel({ ...cyl, confirmed: true })
    const back = parsePart(serializePart(part))
    expect(back.ops[0].rapidSurface).toEqual({ ...cyl, confirmed: true })
  })

  it('a suggested surface not yet checked says so', () => {
    const { part, op } = panel(cyl)
    expect(generateOp(op, { part, machine }).warnings.join(' ')).toMatch(/suggestion.*check it/i)
  })
})
