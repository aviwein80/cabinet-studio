/**
 * M3.6c part compare (SIM-04): the simulated stock against the design model as a colour map of
 * gouges and leftover. Acceptance: a known gouge is coloured correctly (where, how deep, red), and
 * nothing else is; a strip left uncut shows as leftover; parts compared several at once.
 */
import { describe, expect, it } from 'vitest'
import { compareColor, compareStock, DEFAULT_COMPARE, meshClosed } from '@/cam/compare/compare'
import { cellMesh, comparePart, finishedStock, stockSurface } from '@/cam/compare/parts'
import { makeEntity, newPart } from '@/cam/doc'
import { circle, rect } from '@/cam/geom'
import { buildMesh } from '@/cam/mesh/build'
import { parseStl } from '@/cam/mesh/read'
import type { Mesh } from '@/cam/mesh/types'
import { defaultOp } from '@/cam/ops'
import { HeightfieldStock } from '@/cam/stock/heightfield'
import { generatePart } from '@/cam/toolpath'
import type { CamOp, CamPart } from '@/cam/types'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import { box as boxSoup, relief, stlBinary } from './mesh-fixtures'

const say = (s: string) => process.stdout.write(`  [compare] ${s}\n`)
const meshOf = (soup: number[][]): Mesh => buildMesh(parseStl(stlBinary(soup)), { gapTol: 0 }).mesh
const lv = (depth: number, passDepth = 0, through = false) => ({ safeZ: 20, rapidZ: 3, depth, through, stockZ: 0, passDepth })

/** The design: a flat surface 5 mm below face 1 over the whole 120 x 100 part (an open model). */
const FLAT = () => meshOf(relief(120, 100, 12, 10, () => -5))

describe('M3.6 part compare: the colour map of a known gouge', () => {
  it('a 0.5 mm deep drill spot in a surface finished to the design is red there and only there; an uncut strip is leftover; the rest is within the tolerance', () => {
    const stock = new HeightfieldStock(120, 100, 20, 0.5)
    // finished to the design except a 10 mm strip on the left left uncut (5 mm proud)
    for (let j = 0; j < stock.hf.ny; j++) for (let i = 20; i < stock.hf.nx; i++) stock.hf.top[j * stock.hf.nx + i] = -5
    // the deliberate gouge: a Ø8 flat tool plunged 0.5 mm too deep at (60, 50)
    stock.carveAt({ x: 60, y: 50, z: -5.5 }, { r: 4, shape: 'flat', angle: 90 })
    const design = FLAT()
    expect(meshClosed(design)).toBe(false)
    const mesh = cellMesh(stock.hf)
    const r = compareStock(mesh, [design], { length: 120, width: 100, thickness: 20 })
    const s = r.summary
    // the gouge: 0.5 mm deep, at the spot
    expect(s.gouge).not.toBeNull()
    expect(s.gouge!.depth).toBeCloseTo(0.5, 5)
    expect(Math.hypot(s.gouge!.at[0] - 60, s.gouge!.at[1] - 50)).toBeLessThanOrEqual(4)
    // every gouged point is in the drill spot (centres within its radius), and red
    const P = mesh.positions
    let gouged = 0
    for (let v = 0; v < r.d.length; v++) {
      if (!(r.d[v] < -DEFAULT_COMPARE.tol)) continue
      gouged++
      expect(Math.hypot(P[v * 3] - 60, P[v * 3 + 1] - 50)).toBeLessThanOrEqual(4)
      expect(P[v * 3 + 2]).toBeCloseTo(-5.5, 5)
      const c = compareColor(r.d[v])!
      expect(c[0]).toBeGreaterThan(c[1])
      expect(c[0]).toBeGreaterThan(c[2])
    }
    // as many as the cells whose centre is within the radius (π r² / cell², about 201)
    expect(gouged).toBe(s.gouged)
    expect(gouged).toBeGreaterThan(180)
    expect(gouged).toBeLessThan(225)
    // the strip left uncut: leftover, 5 mm, blue
    expect(s.left!.depth).toBeCloseTo(5, 5)
    expect(s.left!.at[0]).toBeLessThan(10)
    const blue = compareColor(5)!
    expect(blue[2]).toBeGreaterThan(blue[0])
    // the rest (the finished surface, the block's underside and sides) within the tolerance
    for (let v = 0; v < r.d.length; v++) {
      const x = P[v * 3]
      const top = P[v * 3 + 2] > -19
      if (top && x > 10.5 && Math.hypot(x - 60, P[v * 3 + 1] - 50) > 4.5) expect(Math.abs(r.d[v])).toBeLessThanOrEqual(DEFAULT_COMPARE.tol)
    }
    expect(compareColor(0)).toEqual([74, 222, 128])
    expect(compareColor(NaN)).toBeNull()
    say(`flat design, Ø8 spot 0.5 too deep: ${s.gouged} red points, deepest ${s.gouge!.depth.toFixed(4)} mm at X${s.gouge!.at[0].toFixed(2)} Y${s.gouge!.at[1].toFixed(2)}; uncut strip ${s.left!.depth.toFixed(3)} mm; ${s.within} of ${s.compared} within ±${DEFAULT_COMPARE.tol} mm`)
  })

  it('a closed design (a solid smaller than the blank): a groove cut into it is a gouge, the strip left outside it is leftover, the part cut away round it compares clean', () => {
    // the design: the part is 80 long; the blank is 120 (x 80..120 is to be cut away)
    const design = meshOf(boxSoup(0, 0, -20, 80, 100, 0))
    expect(meshClosed(design)).toBe(true)
    const stock = new HeightfieldStock(120, 100, 20, 0.5)
    const hf = stock.hf
    // cut away round it, 1 mm short: x 81..120 right through (x 80..81 left standing)
    for (let j = 0; j < hf.ny; j++) for (let i = 162; i < hf.nx; i++) hf.top[j * hf.nx + i] = -20
    // and a groove 2 mm deep into the design at x 30..40
    for (let j = 0; j < hf.ny; j++) for (let i = 60; i < 80; i++) hf.top[j * hf.nx + i] = -2
    const r = compareStock(cellMesh(hf), [design], { length: 120, width: 100, thickness: 20 })
    const s = r.summary
    expect(s.gouge!.depth).toBeCloseTo(2, 6)
    expect(s.gouge!.at[0]).toBeGreaterThan(30)
    expect(s.gouge!.at[0]).toBeLessThan(40)
    // the strip outside the design: its cell centres 0.25 and 0.75 out
    expect(s.left!.depth).toBeCloseTo(0.75, 6)
    expect(s.left!.at[0]).toBeCloseTo(80.75, 6)
    // the columns cut right through are not compared; the rest of the part's top is on the design
    expect(s.leftover).toBe(2 * hf.ny)
    say(`closed design, groove 2 mm too deep and a strip left: ${s.gouged} red, deepest ${s.gouge!.depth.toFixed(3)} mm; leftover ${s.left!.depth.toFixed(3)} mm at X${s.left!.at[0].toFixed(2)}`)
  })
})

describe('M3.6 part compare from the toolpaths, several parts', () => {
  /** A 120 x 100 x 20 part finished to the flat design by a pocket, with optional extras. */
  function flatPart(name: string, extra: 'none' | 'gouge' | 'short'): CamPart {
    const p = newPart({ name, length: 120, width: 100, thickness: 20, materialId: 'mat-mdf18', entities: [] })
    const all = makeEntity({ t: 'contour', c: rect(extra === 'short' ? 20 : -2, -2, extra === 'short' ? 102 : 124, 104) }, 'machining')
    p.entities = [all]
    p.ops = [{ ...defaultOp('pocket', [all.id]), toolId: 't102', levels: lv(5), stepover: 0.4, finishPass: false } as CamOp]
    if (extra === 'gouge') {
      const spot = makeEntity({ t: 'contour', c: circle({ x: 60, y: 50 }, 6) }, 'machining')
      p.entities.push(spot)
      p.ops.push({ ...defaultOp('pocket', [spot.id]), toolId: 't102', levels: lv(5.8) } as CamOp)
    }
    return p
  }

  it('three parts, each simulated to its end: the clean one is within the tolerance, the gouged one shows its 0.8 mm spot, the short one its strip', () => {
    const design = FLAT()
    const rows = (['none', 'gouge', 'short'] as const).map((k) => {
      const part = flatPart(`Panel ${k}`, k)
      const paths = generatePart(part, PLACEHOLDER_MACHINE)
      return { k, r: comparePart(part, paths, PLACEHOLDER_MACHINE, [design]) }
    })
    for (const { k, r } of rows) say(`${k}: ${r.summary.compared} points, gouge ${r.summary.gouge?.depth.toFixed(3) ?? '-'} mm, leftover ${r.summary.left?.depth.toFixed(3) ?? '-'} mm, within ${((r.summary.within / r.summary.compared) * 100).toFixed(1)} %`)
    const [clean, gouged, short] = rows.map((x) => x.r)
    expect(clean.summary.gouge).toBeNull()
    expect(clean.notes).toEqual([])
    expect(gouged.summary.gouge!.depth).toBeCloseTo(0.8, 5)
    expect(Math.hypot(gouged.summary.gouge!.at[0] - 60, gouged.summary.gouge!.at[1] - 50)).toBeLessThanOrEqual(6)
    expect(short.summary.gouge).toBeNull()
    expect(short.summary.left!.depth).toBeCloseTo(5, 5)
    expect(short.summary.left!.at[0]).toBeLessThan(20)
    // the thumbnails: red pixels only on the gouged part
    const red = (t: { rgba: Uint8ClampedArray }) => {
      let n = 0
      for (let i = 0; i < t.rgba.length; i += 4) if (t.rgba[i] > 200 && t.rgba[i + 1] < 160) n++
      return n
    }
    expect(red(clean.thumb)).toBe(0)
    expect(red(gouged.thumb)).toBeGreaterThan(0)
    expect(gouged.thumb.w).toBe(160)
  }, 60_000)

  it('the stock for the compare is the one the simulator uses, and its surface keeps one point per cell', () => {
    const part = flatPart('Panel', 'none')
    const stock = finishedStock(part, generatePart(part, PLACEHOLDER_MACHINE), PLACEHOLDER_MACHINE)
    expect(stock.kind).toBe('heightfield')
    const m = stockSurface(stock)
    const hf = (stock as HeightfieldStock).hf
    expect(m.positions.length / 3).toBe(hf.nx * hf.ny * 2)
  })
})
