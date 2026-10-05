/**
 * M2.4d cut-free pieces (SIM-05) on the twenty Stage 1 reference parts. Each part is simulated at
 * 0.5 mm cells and its islands classified (part, scrap, offcut). Checked against an independent
 * expectation from the drawing alone (Clipper2 on the shapes, no toolpaths): the part is the
 * outline less the openings cut through; a slug is an opening shrunk by the tool's diameter (the
 * kerf); an offcut is the panel less the outline grown by the tool's diameter.
 */
import { describe, expect, it } from 'vitest'
import { entityContours } from '@/cam/doc'
import { type P, toPoints } from '@/cam/geom'
import { clipPolys, inflatePolys, polyArea } from '@/cam/kernel'
import { resolveTool } from '@/cam/ops'
import { buildTimeline, looseMask, programOrder } from '@/cam/sim'
import { HeightfieldStock } from '@/cam/stock/heightfield'
import { cutFreePieces, dropMask, type PieceKind } from '@/cam/stock/pieces'
import { carveStock } from '@/cam/stock/simulation'
import { generatePart } from '@/cam/toolpath'
import type { CamPart } from '@/cam/types'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import { referenceParts } from './cam-reference'

const machine = PLACEHOLDER_MACHINE
const CELL = 0.5
const area = (ps: P[][]) => ps.reduce((a, p) => a + polyArea(p), 0)
/** Separate filled pieces (outer ring plus the holes inside it) and their areas. */
function pieceAreas(ps: P[][]): number[] {
  const outers = ps.filter((p) => polyArea(p) > 0)
  const holes = ps.filter((p) => polyArea(p) < 0)
  return outers.map((o) => polyArea(o) + holes.filter((h) => area(clipPolys('intersect', [o], [[...h].reverse()])) > 0).reduce((a, h) => a + polyArea(h), 0))
}

function expected(part: CamPart) {
  const polys = (id: string) => {
    const e = part.entities.find((x) => x.id === id)!
    return entityContours(e)
      .filter((c) => c.closed)
      .map((c) => {
        const p = toPoints(c, 0.01)
        return polyArea(p) < 0 ? [...p].reverse() : p
      })
  }
  const outline = polys(part.outlineId!)
  const panel: P[] = [{ x: 0, y: 0 }, { x: part.length, y: 0 }, { x: part.length, y: part.width }, { x: 0, y: part.width }]
  const scrap: number[] = []
  const offcut: number[] = []
  /** Lead arcs run inside a slug: at most this much of it may be cut away by them (mm²). */
  let leadBite = 0
  let partArea = area(clipPolys('intersect', outline, [panel]))
  for (const op of part.ops) {
    if (!op.enabled || op.kind !== 'profile' || !op.levels.through) continue
    const D = resolveTool(op, machine)!.diameter
    for (const id of op.geometry) {
      const shape = polys(id)
      if (id === part.outlineId) offcut.push(...pieceAreas(clipPolys('subtract', [panel], inflatePolys(shape, D, 'round', 0.01))).filter((a) => a > 1))
      else {
        const r = D / 2
        if (op.leads.in !== 'none' || op.leads.out !== 'none') leadBite = Math.max(leadBite, Math.PI * (op.leads.radius * r + r) ** 2)
        partArea -= area(shape)
        scrap.push(...pieceAreas(inflatePolys(shape, -D, 'round', 0.01)).filter((a) => a > 1))
      }
    }
  }
  return { partArea, scrap: scrap.sort((a, b) => b - a), offcut: offcut.sort((a, b) => b - a), outline, leadBite }
}

describe('M2.4d cut-free pieces on the Stage 1 reference parts', () => {
  for (const part of referenceParts())
    it(`${part.id} ${part.name}`, () => {
      const tl = buildTimeline(programOrder(generatePart(part, machine)))
      const s = new HeightfieldStock(part.length, part.width, part.thickness, CELL)
      carveStock(s, tl, 0, tl.total)
      const ex = expected(part)
      const got = cutFreePieces(s.hf, ex.outline)
      const of = (k: PieceKind) => got.pieces.filter((p) => p.kind === k).map((p) => p.area).sort((a, b) => b - a)
      const fmt = (xs: number[]) => xs.map((x) => x.toFixed(0)).join(', ') || '-'
      process.stdout.write(`  [pieces] ${part.id}: part ${of('part')[0]?.toFixed(0)} (expected ${ex.partArea.toFixed(0)}); scrap ${fmt(of('scrap'))} (${fmt(ex.scrap)}); offcuts ${fmt(of('offcut'))} (${fmt(ex.offcut)})\n`)
      expect(of('part')).toHaveLength(1)
      expect(Math.abs(of('part')[0] - ex.partArea) / ex.partArea).toBeLessThan(0.01)
      expect(of('scrap').length).toBe(ex.scrap.length)
      expect(of('offcut').length).toBe(ex.offcut.length)
      // small pieces: within a band of half a cell round their edge (and 2 % for the big ones)
      const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.02 * b, 2 * Math.sqrt(Math.PI * b) * CELL)
      // (a slug is never bigger than the opening less the kerf; lead arcs may bite into it)
      of('scrap').forEach((a, i) => expect(close(a, ex.scrap[i]) || (a < ex.scrap[i] && a > ex.scrap[i] - ex.leadBite), `scrap ${a} vs ${ex.scrap[i]}`).toBe(true))
      of('offcut').forEach((a, i) => expect(close(a, ex.offcut[i]), `offcut ${a} vs ${ex.offcut[i]}`).toBe(true))
      // what falls away is exactly the scrap and offcuts; the old loose mask agrees when there is no offcut
      const drop = dropMask(got)
      const dropped = drop.reduce((n, v) => n + v, 0) * CELL * CELL
      expect(dropped).toBeCloseTo([...of('scrap'), ...of('offcut')].reduce((a, b) => a + b, 0), 6)
      if (!ex.offcut.length) expect(Buffer.from(drop).equals(Buffer.from(looseMask(s.hf)))).toBe(true)
    }, 60_000)
})
