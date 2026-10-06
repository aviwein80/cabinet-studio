/**
 * M2.11 relief import (ART-01): height-map pictures (PNG and TIFF, checked against files written by
 * other programs), height maps and relief-software STL blocks made to an exact size and depth,
 * placed on a door, and machined with the M2.2 roughing and finishing in the simulator: the
 * panel round the relief is never cut, no gouges, no collisions.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkGouge } from '@/cam/3d/check'
import { newPart, opInputHash } from '@/cam/doc'
import { buildMesh } from '@/cam/mesh/build'
import { DEFAULT_PLACEMENT, placeMesh } from '@/cam/mesh/place'
import { parseStl } from '@/cam/mesh/read'
import { facetNz } from '@/cam/mesh/tools'
import { type Mesh, meshBounds } from '@/cam/mesh/types'
import { defaultOp } from '@/cam/ops'
import { HeightImageError, lzw, packBits, readHeightImage, summarise } from '@/cam/relief/image'
import { checkReliefMesh, defaultSpacing, type HeightMapOptions, heightMapMesh, placedReliefOutline, reliefSurround, sizeRelief, stripBase } from '@/cam/relief/relief'
import { addRelief, reliefCorner, reliefPlacementNotes } from '@/cam/relief/part'
import { buildTimeline } from '@/cam/sim'
import { HeightfieldStock } from '@/cam/stock/heightfield'
import { partCollisions } from '@/cam/collision/collision'
import { generateOp, type Toolpath } from '@/cam/toolpath'
import type { CamPart, Finish3dOp, ModelRef, ReliefInfo, Rough3dOp } from '@/cam/types'
import { runTask } from '@/cam/worker/tasks'
import { opUnconfirmed } from '@/core/confirm'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import { digest3d } from './cam-digest'
import { stlBinary } from './mesh-fixtures'
import { pngOf, reliefBlock, reliefPng, reliefShape } from './relief-fixtures'

const machine = PLACEHOLDER_MACHINE
const BALL = 't105' // 6 mm ball-nose (placeholder)
const BULL = 't107' // 12 mm R2 bull-nose (placeholder)
const FIX = path.join(__dirname, 'fixtures', 'relief')
const fixture = (name: string) => new Uint8Array(fs.readFileSync(path.join(FIX, name)))

// patterns written by tests/fixtures/relief/make.py
const W = 40
const H = 30
const g8 = (x: number, y: number) => (7 * x + 13 * y) % 256
const g16 = (x: number, y: number) => (1031 * x + 2053 * y) % 65536
const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

function expectPattern(values: Float32Array, f: (x: number, y: number) => number, tol: number) {
  let worst = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) worst = Math.max(worst, Math.abs(values[y * W + x] - f(x, y)))
  expect(worst).toBeLessThanOrEqual(tol)
}

describe('M2.11 height-map pictures (files written by Pillow and ImageMagick)', () => {
  it('8-bit and 16-bit greyscale PNG, plain and interlaced: every pixel exact', async () => {
    const a = await readHeightImage(fixture('gray8.png'), 'gray8.png')
    expect([a.width, a.height, a.bits, a.levels, a.format]).toEqual([W, H, 8, 256, 'png'])
    expectPattern(a.values, (x, y) => g8(x, y) / 255, 1e-7)
    const b = await readHeightImage(fixture('gray16.png'), 'gray16.png')
    expect([b.bits, b.levels]).toEqual([16, 65536])
    expectPattern(b.values, (x, y) => g16(x, y) / 65535, 1e-7)
    const c = await readHeightImage(fixture('gray8-interlaced.png'), 'i.png')
    expectPattern(c.values, (x, y) => g8(x, y) / 255, 1e-7)
    expect(a.warnings).toEqual([])
  })

  it('colour, palette and transparent PNG: brightness used, a warning for colour, transparent pixels marked', async () => {
    const rgb = await readHeightImage(fixture('rgb.png'), 'rgb.png')
    expectPattern(rgb.values, (x, y) => luma(g8(x, y), (g8(x, y) * 3) % 256, (g8(x, y) * 5) % 256) / 255, 1e-6)
    expect(rgb.warnings.join(' ')).toMatch(/colour/)
    const pal = await readHeightImage(fixture('palette.png'), 'p.png')
    // the palette may round shades a little
    expectPattern(pal.values, (x, y) => g8(x, y) / 255, 4 / 255)
    const la = await readHeightImage(fixture('gray-alpha.png'), 'la.png')
    expect(la.transparent).toBeDefined()
    let clear = 0
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (la.transparent![y * W + x]) clear++
    expect(clear).toBe(25)
    expect(la.transparent![0]).toBe(1)
    expect(la.transparent![5]).toBe(0)
  })

  it('TIFF: uncompressed, LZW, Deflate, PackBits, tiles, big-endian with a predictor, RGB and floating point', async () => {
    for (const f of ['gray8.tif', 'gray8-lzw.tif', 'gray8-packbits.tif']) {
      const t = await readHeightImage(fixture(f), f)
      expect([t.bits, t.format], f).toEqual([8, 'tiff'])
      expectPattern(t.values, (x, y) => g8(x, y) / 255, 1e-7)
    }
    for (const f of ['gray16-lzw.tif', 'gray16-deflate.tif', 'gray16-tiled.tif', 'gray16-msb-pred.tif']) {
      const t = await readHeightImage(fixture(f), f)
      expect(t.bits, f).toBe(16)
      expectPattern(t.values, (x, y) => g16(x, y) / 65535, 1e-7)
    }
    const rgb = await readHeightImage(fixture('rgb-lzw.tif'), 'rgb-lzw.tif')
    expectPattern(rgb.values, (x, y) => luma(g8(x, y), (g8(x, y) * 3) % 256, (g8(x, y) * 5) % 256) / 255, 1e-6)
    // floating point: heights in any unit, stretched lowest -> 0, highest -> 1
    const fl = await readHeightImage(fixture('float32.tif'), 'f.tif')
    const f = (x: number, y: number) => 2.5 + 0.1 * x - 0.05 * y
    const lo = f(0, H - 1)
    const hi = f(W - 1, 0)
    expectPattern(fl.values, (x, y) => (f(x, y) - lo) / (hi - lo), 1e-5)
    expect(fl.levels).toBe(0)
    expect(fl.warnings.join(' ')).toMatch(/decimal numbers/)
  })

  it('every PNG bit depth and colour type our own writer makes (1, 2, 4, 8, 16 bits; all row filters)', async () => {
    for (const bits of [1, 2, 4, 8, 16]) {
      const max = 2 ** bits - 1
      const s = Array.from({ length: 13 * 7 }, (_, i) => (i * 37) % (max + 1))
      const img = await readHeightImage(pngOf({ width: 13, height: 7, type: 0, bits, samples: s }), 'g.png')
      expect(Array.from(img.values).map((v) => Math.round(v * max)), `${bits} bits`).toEqual(s)
    }
    // palette at 4 bits with a transparent entry
    const pal = [0, 0, 0, 255, 255, 255, 128, 128, 128]
    const img = await readHeightImage(pngOf({ width: 5, height: 2, type: 3, bits: 4, samples: [0, 1, 2, 1, 0, 2, 2, 1, 1, 0], palette: pal, trns: [255, 255, 0] }), 'p.png')
    expect(Array.from(img.values).map((v) => Math.round(v * 255))).toEqual([0, 255, 128, 255, 0, 128, 128, 255, 255, 0])
    expect(Array.from(img.transparent!)).toEqual([0, 0, 1, 0, 0, 1, 1, 0, 0, 0])
    // 16-bit RGBA
    const rgba = await readHeightImage(pngOf({ width: 2, height: 1, type: 6, bits: 16, samples: [65535, 65535, 65535, 65535, 0, 0, 0, 0] }), 'a.png')
    expect(Array.from(rgba.values)).toEqual([expect.closeTo(1, 6), 0])
    expect(Array.from(rgba.transparent!)).toEqual([0, 1])
  })

  it('damaged or wrong files give a plain error, never a crash', async () => {
    const good = fixture('gray8.png')
    const bad = good.slice()
    bad[40] ^= 0xff
    await expect(readHeightImage(bad, 'x.png')).rejects.toThrow(HeightImageError)
    await expect(readHeightImage(bad, 'x.png')).rejects.toThrow(/damaged/)
    await expect(readHeightImage(good.subarray(0, 60), 'x.png')).rejects.toThrow(/cut short|no picture data|damaged/)
    await expect(readHeightImage(new Uint8Array(0), 'x.png')).rejects.toThrow(/empty/)
    await expect(readHeightImage(new TextEncoder().encode('solid x\nendsolid'), 'x.png')).rejects.toThrow(/only PNG and TIFF/)
    const tif = fixture('gray8-lzw.tif')
    await expect(readHeightImage(tif.subarray(0, 100), 'x.tif')).rejects.toThrow(HeightImageError)
    expect(packBits(Uint8Array.from([2, 1, 2, 3, 0xfe, 9]), 6)).toEqual(Uint8Array.from([1, 2, 3, 9, 9, 9]))
    expect(() => lzw(Uint8Array.from([0xff, 0xff, 0xff]), 4)).toThrow(/damaged/)
  })

  it('the dialog summary: size, levels and a small preview', async () => {
    const s = summarise(await readHeightImage(fixture('gray16.png'), 'g.png'), 16)
    expect([s.width, s.height, s.bits, s.levels]).toEqual([W, H, 16, 65536])
    expect([s.preview.width, s.preview.height]).toEqual([13, 10])
    expect(s.preview.data.length).toBe(13 * 10 * 4)
  })
})

const OPT: HeightMapOptions = { length: 250, width: 375, depth: 8, whiteHigh: true, stretch: false, spacing: 2.5, smooth: 0, transparent: 'top' }

describe('M2.11 height maps made to size and depth', () => {
  // black left half, white right half, a grey band along the top rows
  function stepImage(bits: 8 | 16) {
    const w = 20
    const h = 10
    const max = 2 ** bits - 1
    const s = Array.from({ length: w * h }, (_, i) => (Math.floor(i / w) < 2 ? Math.round(max / 2) : i % w < 10 ? 0 : max))
    return pngOf({ width: w, height: h, type: 0, bits, samples: s })
  }

  it('the surface covers exactly the size asked, from Z 0 (white) down to the depth (black)', async () => {
    const img = await readHeightImage(stepImage(16), 's.png')
    const { mesh, info } = heightMapMesh(img, { ...OPT, length: 200, width: 100, depth: 6.35, spacing: 2 })
    const b = meshBounds(mesh)
    expect(b.min.map((v) => +v.toFixed(4))).toEqual([0, 0, -6.35])
    expect(b.max.map((v) => +v.toFixed(4))).toEqual([200, 100, 0])
    expect(info.size).toEqual([200, 100, 6.35])
    expect(info.outline).toEqual([[0, 0, 200, 0, 200, 100, 0, 100]])
    // every facet faces up
    for (let t = 0; t < mesh.indices.length / 3; t++) expect(facetNz(mesh, t)).toBeGreaterThan(0.01)
    // the picture's top rows (the grey band) are at the far edge, Y = width
    const at = (x: number, y: number) => {
      const p = mesh.positions
      let best = 0
      let bd = Infinity
      for (let i = 0; i < p.length; i += 3) {
        const d = Math.hypot(p[i] - x, p[i + 1] - y)
        if (d < bd) {
          bd = d
          best = p[i + 2]
        }
      }
      return best
    }
    expect(at(40, 50)).toBeCloseTo(-6.35, 6)
    expect(at(160, 50)).toBeCloseTo(0, 6)
    expect(at(100, 100)).toBeCloseTo(-6.35 * (1 - 32768 / 65535), 4)
    // black is high: turned over
    const inv = heightMapMesh(img, { ...OPT, length: 200, width: 100, depth: 6.35, spacing: 2, whiteHigh: false }).mesh
    const bi = meshBounds(inv)
    expect(bi.min[2]).toBeCloseTo(-6.35, 5)
    expect(bi.max[2]).toBeCloseTo(0, 6)
  })

  it('stretch uses the range the picture holds; transparent pixels count as the top or the bottom', async () => {
    // left half 100, right half 200
    const s = Array.from({ length: 20 * 10 }, (_, i) => (i % 20 < 10 ? 100 : 200))
    const img = await readHeightImage(pngOf({ width: 20, height: 10, type: 0, bits: 8, samples: s }), 'x.png')
    const plain = meshBounds(heightMapMesh(img, { ...OPT, length: 100, width: 50, depth: 10, spacing: 5 }).mesh)
    expect(plain.min[2]).toBeCloseTo(-10 * (1 - 100 / 255), 4)
    expect(plain.max[2]).toBeCloseTo(-10 * (1 - 200 / 255), 4)
    const st = meshBounds(heightMapMesh(img, { ...OPT, length: 100, width: 50, depth: 10, spacing: 5, stretch: true }).mesh)
    expect([st.min[2], st.max[2]]).toEqual([expect.closeTo(-10, 5), expect.closeTo(0, 5)])
    const la = await readHeightImage(pngOf({ width: 2, height: 1, type: 4, bits: 8, samples: [0, 255, 0, 0] }), 'la.png')
    const top = heightMapMesh(la, { ...OPT, length: 10, width: 10, depth: 4, spacing: 10, transparent: 'top' })
    expect(Array.from(top.mesh.positions.filter((_, i) => i % 3 === 2))).toEqual([-4, 0, -4, 0])
    expect(top.warnings.join(' ')).toMatch(/Transparent pixels count as the top/)
    const bottom = heightMapMesh(la, { ...OPT, length: 10, width: 10, depth: 4, spacing: 10, transparent: 'bottom' })
    expect(Array.from(bottom.mesh.positions.filter((_, i) => i % 3 === 2))).toEqual([-4, -4, -4, -4])
  })

  it('point spacing: one point per pixel by default, capped; coarser points average the pixels', async () => {
    // 0.5 mm pixels, but at most 250,000 points: 0.62 mm
    expect(defaultSpacing({ width: 500, height: 750 }, 250, 375)).toBe(0.62)
    expect(defaultSpacing({ width: 100, height: 150 }, 250, 375)).toBe(2.5)
    // 8-bit warning, smoothing
    const img = await readHeightImage(stepImage(8), 's.png')
    const r = heightMapMesh(img, { ...OPT, length: 200, width: 100, spacing: 50 })
    expect(r.warnings.join(' ')).toMatch(/8-bit picture: heights come in 256 steps of 0.031 mm/)
    // a point over the black/white border averages both halves
    const mid = Array.from(r.mesh.positions).findIndex((v, i) => i % 3 === 0 && Math.abs(v - 100) < 1e-6 && Math.abs(r.mesh.positions[i + 1] - 50) < 1e-6)
    expect(r.mesh.positions[mid + 2]).toBeCloseTo(-4, 1)
    const smooth = heightMapMesh(img, { ...OPT, length: 200, width: 100, spacing: 10, smooth: 2 })
    expect(smooth.warnings.join(' ')).not.toMatch(/8-bit/)
    expect(() => heightMapMesh(img, { ...OPT, spacing: 0.01 })).toThrow(/the most is/)
  })
})

/** The relief block as an STL in inches (8 x 12 in, carving 0.25 in deep, base 0.75 in below). */
const blockStl = () => stlBinary(reliefBlock(8, 12, 64, 96, 0.25, -0.75))

describe('M2.11 STL reliefs from relief software', () => {
  it('a block with a base: found, the base taken off, then made to the exact size and depth', async () => {
    const imp = await runTask('mesh.import', { bytes: blockStl(), name: 'panel.stl', units: 'in', up: 'auto' })
    expect(imp.report.units).toBe('in')
    expect(imp.report.openEdges).toBe(0)
    const chk = await runTask('relief.checkMesh', { mesh: imp.mesh })
    expect(chk.base).toBe(true)
    expect(chk.size.map((v) => +v.toFixed(3))).toEqual([203.2, 304.8, 19.05])
    const deepest = 0.25 * 25.4 * Math.max(...Array.from({ length: 65 * 97 }, (_, k) => reliefShape((k % 65) / 64, Math.floor(k / 65) / 96)))
    expect(chk.topDepth).toBeCloseTo(deepest, 3)
    expect(chk.stripped.base).toBe(false)
    expect(chk.stripped.removed).toBe(2 * 64 * 96 + 2 * (2 * 64 + 2 * 96))
    expect(chk.stripped.size[2]).toBeCloseTo(deepest, 3)
    // 250 mm long keeping the proportions (375 mm), 8 mm deep
    const r = await runTask('relief.fromMesh', { mesh: imp.mesh, removeBase: true, size: { length: 250, width: 375, depth: 8 } })
    const b = meshBounds(r.mesh)
    expect(b.min.map((v) => +v.toFixed(3))).toEqual([0, 0, -8])
    expect(b.max.map((v) => +v.toFixed(3))).toEqual([250, 375, 0])
    expect(r.info.from).toBe('mesh')
    expect(r.info.size).toEqual([250, 375, 8])
    expect(r.info.mesh).toEqual({ size: [203.2, 304.8, +deepest.toFixed(3)], baseRemoved: 2 * 64 * 96 + 2 * (2 * 64 + 2 * 96) })
    // outline: the rectangle
    expect(r.info.outline).toHaveLength(1)
    const xs = r.info.outline[0].filter((_, i) => i % 2 === 0)
    const ys = r.info.outline[0].filter((_, i) => i % 2 === 1)
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([0, 250, 0, 375])
    expect(r.info.outline[0].length).toBeLessThanOrEqual(16)
  })

  it('without taking the base off, the depth is the whole block (base included)', () => {
    const mesh = buildMesh(parseStl(blockStl()), { units: 'in', gapTol: 0 }).mesh
    const sized = sizeRelief(mesh, { length: 101.6, width: 152.4, depth: 12.7 })
    const b = meshBounds(sized)
    expect(b.min[2]).toBeCloseTo(-12.7, 4)
    expect(b.max[0]).toBeCloseTo(101.6, 4)
    // the whole block (19.05 mm with its base) is made 12.7 mm deep
    const s = stripBase(mesh)
    expect(checkReliefMesh(s.mesh).base).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------
// On a door, machined in the simulator
// ---------------------------------------------------------------------------------------------

const DOOR = { length: 400, width: 600, thickness: 19 }
const AT: [number, number, number] = [75, 112.5, 0]

function doorWith(mesh: Mesh, info: ReliefInfo | undefined, at = AT): CamPart {
  const b = meshBounds(mesh)
  const model: ModelRef = { id: 'r', name: 'Relief', kind: 'mesh', blob: 'relief', source: 'relief', units: 'mm', place: { ...DEFAULT_PLACEMENT, at }, layer: 'models', visible: true, triangles: mesh.indices.length / 3, size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]], ...(info ? { relief: info } : {}) }
  return { ...newPart({ name: 'Relief door', ...DOOR, materialId: 'mat-mdf18' }), models: [model] }
}

function reliefOps(stepover = 1.5) {
  const r = defaultOp('rough3d') as Rough3dOp
  const f = defaultOp('finish3d') as Finish3dOp
  return [
    { ...r, toolId: BULL, stepdown: 3, surface: { ...r.surface, modelId: 'r' } } as Rough3dOp,
    { ...f, toolId: BALL, stepover, surface: { ...f.surface, modelId: 'r' } } as Finish3dOp,
  ]
}

function simulate(part: CamPart, tps: Toolpath[], cell = 0.5) {
  const tl = buildTimeline(tps)
  const stock = new HeightfieldStock(part.length, part.width, part.thickness, cell)
  for (const s of tl.segs) if (s.kind !== 'rapid') stock.carve(s.a, s.b, s.cutter)
  return stock
}

async function stlRelief() {
  const imp = await runTask('mesh.import', { bytes: blockStl(), name: 'panel.stl', units: 'in', up: 'auto' })
  return runTask('relief.fromMesh', { mesh: imp.mesh, removeBase: true, size: { length: 250, width: 375, depth: 8 } })
}

async function pngRelief() {
  const bytes = reliefPng(200, 300)
  const opt = { ...OPT, stretch: true, spacing: defaultSpacing({ width: 200, height: 300 }, 250, 375) }
  return runTask('relief.fromImage', { bytes, name: 'panel.png', opt })
}

describe('M2.11 reliefs on a door, machined with the M2.2 strategies in the simulator', () => {
  for (const [label, make] of [
    ['STL relief', stlRelief],
    ['16-bit PNG height map', pngRelief],
  ] as const)
    it(`${label}: roughing and parallel finishing stay inside the relief; the panel round it is untouched; no gouge; no collision`, async () => {
      const { mesh, info } = await make()
      const part = doorWith(mesh, info)
      part.ops = reliefOps()
      const tps = await runTask('cam.generate', { part, machine, opIds: part.ops.map((o) => o.id), meshes: { relief: mesh } })
      for (const tp of tps) expect(tp.warnings.filter((w) => /does not cover|not loaded|Pick the 3D model/.test(w)), tp.name).toEqual([])
      expect(tps[0].moves.length).toBeGreaterThan(10)
      expect(tps[1].moves.length).toBeGreaterThan(10)
      const placed = placeMesh(mesh, part.models![0].place)
      // independent gouge check: ball-nose exact, bull-nose sampled
      const gBall = checkGouge(placed, { shape: 'ball', r: 3 }, tps[1].moves, { step: 1 }).max
      const gBull = checkGouge(placed, { shape: 'bull', r: 6, cornerRadius: 2 }, tps[0].moves, { stock: 0.5, maxPoints: 1500, resolution: 0.1 }).max
      expect(gBall).toBeLessThanOrEqual(0.005)
      expect(gBull).toBeLessThanOrEqual(0.005)
      // simulated: nothing outside the relief is cut, the relief is finished to within the scallop
      const stock = simulate(part, tps)
      const outline = placedReliefOutline(part.models![0])
      const [x0, y0, x1, y1] = [AT[0], AT[1], AT[0] + 250, AT[1] + 375]
      expect(outline.flat().every((p) => p.x >= x0 - 1e-3 && p.x <= x1 + 1e-3 && p.y >= y0 - 1e-3 && p.y <= y1 + 1e-3)).toBe(true)
      let outsideLow = 0
      let worstGouge = -Infinity
      let worstLeft = -Infinity
      const ray = rayZ(placed)
      for (let y = 0.25; y < DOOR.width; y += 2)
        for (let x = 0.25; x < DOOR.length; x += 2) {
          const h = stock.heightAt(x, y)
          const inside = x > x0 + 0.5 && x < x1 - 0.5 && y > y0 + 0.5 && y < y1 - 0.5
          if (!inside) {
            if (x < x0 - 0.5 || x > x1 + 0.5 || y < y0 - 0.5 || y > y1 + 0.5) if (h < -1e-6) outsideLow++
            continue
          }
          const z = ray(x, y)
          if (z === null) continue
          worstGouge = Math.max(worstGouge, z - h)
          // well inside (away from the edge, where the ball's overhang is held up by the panel face)
          if (x > x0 + 4 && x < x1 - 4 && y > y0 + 4 && y < y1 - 4) worstLeft = Math.max(worstLeft, h - z)
        }
      console.log(`  [relief] ${label}: ${mesh.indices.length / 3} facets; gouge finishing ${gBall.toFixed(4)} mm, roughing ${gBull.toFixed(4)} mm (independent check); simulated: deepest below the surface ${worstGouge.toFixed(4)} mm, most left inside ${worstLeft.toFixed(3)} mm; cells cut outside the relief ${outsideLow}`)
      expect(outsideLow).toBe(0)
      expect(worstGouge).toBeLessThanOrEqual(0.01)
      // scallop of a 6 mm ball at 1.5 mm step-over is 0.095 mm on the flat; steeper spots and the
      // 0.5 mm cells add a little
      expect(worstLeft).toBeLessThanOrEqual(0.3)
      // collision check (stock, shank, holder, rapids): none
      expect(partCollisions(part, tps, machine).found).toEqual([])
    }, 240_000)

  it('the guard matters: the same relief without its relief information is roughed as a model that does not cover the panel', async () => {
    const { mesh } = await pngRelief()
    const part = doorWith(mesh, undefined)
    part.ops = [reliefOps()[0]]
    const tp = generateOp(part.ops[0], { part, machine, meshes: new Map([['relief', mesh]]) })
    expect(tp.warnings.join(' ')).toMatch(/does not cover the whole panel/)
    const stock = simulate(part, [tp], 1)
    expect(stock.heightAt(20, 20)).toBeLessThan(-5)
  }, 120_000)

  it('a sunk relief (top 2 mm below the face): the panel round it still is not cut', async () => {
    const { mesh, info } = await pngRelief()
    const part = doorWith(mesh, info, [AT[0], AT[1], -2])
    part.ops = reliefOps(3)
    const tps = part.ops.map((op) => generateOp(op, { part, machine, meshes: new Map([['relief', mesh]]) }))
    const stock = simulate(part, tps, 1)
    let low = 0
    for (let y = 0.5; y < DOOR.width; y += 1)
      for (let x = 0.5; x < DOOR.length; x += 1) if ((x < AT[0] - 0.5 || x > AT[0] + 250.5 || y < AT[1] - 0.5 || y > AT[1] + 375.5) && stock.heightAt(x, y) < -1e-6) low++
    expect(low).toBe(0)
    // the relief itself is cut down to its (sunk) surface in the middle
    expect(stock.heightAt(AT[0] + 125, AT[1] + 187.5)).toBeLessThan(-2 - 4)
  }, 120_000)

  it('the surround: a flat face round the outline (and inside any hole in it), reaching past the panel', () => {
    const sq = (x: number, y: number, s: number) => [
      { x, y },
      { x: x + s, y },
      { x: x + s, y: y + s },
      { x, y: y + s },
    ]
    // a frame-shaped relief: outer 100 square with a 40 square hole
    const m = reliefSurround([sq(50, 50, 100), sq(80, 80, 40).reverse()], { length: 200, width: 200 }, 10)
    let area = 0
    const p = m.positions
    for (let t = 0; t < m.indices.length; t += 3) {
      const a = m.indices[t] * 3, b = m.indices[t + 1] * 3, c = m.indices[t + 2] * 3
      const cr = (p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[b + 1] - p[a + 1]) * (p[c] - p[a])
      expect(cr).toBeGreaterThan(0)
      area += cr / 2
    }
    expect(area).toBeCloseTo(220 * 220 - 100 * 100 + 40 * 40, 6)
    expect(meshBounds(m).max[2]).toBe(0)
  })

  it('associativity: a relief model changes the hash only through its own data; plain models hash as before', async () => {
    const { mesh, info } = await pngRelief()
    const part = doorWith(mesh, info)
    part.ops = reliefOps()
    const plain = doorWith(mesh, undefined)
    plain.ops = part.ops
    // same blob and placement: the relief outline is derived from the blob, so the hash is the same
    expect(opInputHash(part.ops[0], part, null, machine)).toBe(opInputHash(plain.ops[0], plain, null, machine))
    const moved = { ...part, models: [{ ...part.models![0], place: { ...part.models![0].place, at: [80, 112.5, 0] as [number, number, number] } }] }
    expect(opInputHash(part.ops[0], moved, null, machine)).not.toBe(opInputHash(part.ops[0], part, null, machine))
  }, 60_000)

  it('a relief turned off face up is refused with a plain message', async () => {
    const { mesh, info } = await pngRelief()
    const part = doorWith(mesh, info)
    part.models![0].place = { ...part.models![0].place, up: '+y' }
    part.ops = [reliefOps()[1]]
    const tp = generateOp(part.ops[0], { part, machine, meshes: new Map([['relief', mesh]]) })
    expect(tp.warnings.join(' ')).toMatch(/must stay face up/)
    expect(tp.moves).toEqual([])
  }, 60_000)

  it('turned 90° on the door: the outline turns with the model', async () => {
    const { mesh, info } = await pngRelief()
    const part = doorWith(mesh, info, [12.5, 75, 0])
    part.models![0].place = { ...part.models![0].place, rotZ: 90 }
    const o = placedReliefOutline(part.models![0])
    const xs = o[0].map((p) => p.x)
    const ys = o[0].map((p) => p.y)
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].map((v) => +v.toFixed(3))).toEqual([12.5, 387.5, 75, 325])
    const placed = meshBounds(placeMesh(mesh, part.models![0].place))
    expect([placed.min[0], placed.max[0], placed.min[1], placed.max[1]].map((v) => +v.toFixed(3))).toEqual([12.5, 387.5, 75, 325])
  }, 60_000)
})

describe('M2.11 adding a relief to a part', () => {
  it('centred (or at a corner) with its top where asked; roughing and finishing added with their Configure badges', async () => {
    const { mesh, info } = await pngRelief()
    const base: CamPart = { ...newPart({ name: 'Door', ...DOOR, materialId: 'mat-mdf18' }) }
    const r = addRelief(base, { blob: 'relief', name: 'Rose', source: 'rose.png', units: 'mm', triangles: mesh.indices.length / 3, info, place: { centre: true, x: 0, y: 0, top: -1 }, withOps: true })
    expect(r.model.place).toEqual({ up: '+z', rotZ: 0, scale: 1, mirror: false, at: [75, 112.5, -1] })
    expect(r.model.relief).toBe(info)
    expect(r.ops.map((o) => [o.kind, o.name])).toEqual([
      ['rough3d', 'Relief roughing: Rose'],
      ['finish3d', 'Relief finishing: Rose'],
    ])
    expect(r.ops.every((o) => (o as Rough3dOp).surface.modelId === r.model.id)).toBe(true)
    // the placeholder cutting values show their badges until the shop sets them
    const keys = r.ops.flatMap((o) => opUnconfirmed(o, r.part, machine, null).map((u) => u.label))
    expect(keys.join(' | ')).toMatch(/step-down/i)
    expect(keys.join(' | ')).toMatch(/step-over/i)
    // the operations machine it (tools picked automatically: bull-nose to rough, ball-nose to finish)
    const tps = r.part.ops.map((op) => generateOp(op, { part: r.part, machine, meshes: new Map([['relief', mesh]]) }))
    expect(tps.map((t) => t.tool?.number)).toEqual([107, 105])
    expect(tps.every((t) => t.moves.length > 0)).toBe(true)
    // at a corner, sticking out: a note, not a block
    const at = reliefCorner(base, info.size, { centre: false, x: 200, y: 0, top: 0 })
    expect(at).toEqual([200, 0, 0])
    expect(reliefPlacementNotes(base, info.size, at)).toEqual(['The relief runs past the edge of the part.'])
    expect(reliefPlacementNotes(base, info.size, [75, 112.5, -12])).toEqual(['The relief goes deeper than the part is thick.'])
    const plain = addRelief(base, { blob: 'relief', name: 'Rose', source: 'rose.png', units: 'mm', triangles: 1, info, place: { centre: true, x: 0, y: 0, top: 0 }, withOps: false })
    expect(plain.part.ops).toEqual(base.ops)
  }, 120_000)
})

describe('M2.11 golden digests', () => {
  const cases: [string, () => Promise<Toolpath>][] = [
    [
      'relief-png-parallel',
      async () => {
        const { mesh, info } = await pngRelief()
        const part = doorWith(mesh, info)
        part.ops = [reliefOps(3)[1]]
        return generateOp(part.ops[0], { part, machine, meshes: new Map([['relief', mesh]]) })
      },
    ],
    [
      'relief-stl-rough',
      async () => {
        const { mesh, info } = await stlRelief()
        const part = doorWith(mesh, info)
        part.ops = [reliefOps()[0]]
        return generateOp(part.ops[0], { part, machine, meshes: new Map([['relief', mesh]]) })
      },
    ],
  ]
  for (const [name, make] of cases)
    it(name, async () => {
      const file = path.join(__dirname, 'golden', 'cam3d', name, 'toolpath.json')
      const got = digest3d(await make())
      if (process.env.UPDATE_GOLDEN === '1') {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, JSON.stringify(got, null, 2) + '\n')
      }
      expect(fs.existsSync(file), `missing golden ${file}: run with UPDATE_GOLDEN=1 once and check the diff`).toBe(true)
      expect(got).toEqual(JSON.parse(fs.readFileSync(file, 'utf8')))
    }, 120_000)
})

/** Highest point of a mesh under (x, y), by a vertical ray (null when nothing is under it). */
function rayZ(mesh: Mesh) {
  const p = mesh.positions
  const ix = mesh.indices
  // bucket facets on a coarse grid
  const b = meshBounds(mesh)
  const cs = 5
  const nx = Math.ceil((b.max[0] - b.min[0]) / cs) + 1
  const ny = Math.ceil((b.max[1] - b.min[1]) / cs) + 1
  const cells: number[][] = Array.from({ length: nx * ny }, () => [])
  for (let t = 0; t < ix.length / 3; t++) {
    let lx = Infinity, ly = Infinity, hx = -Infinity, hy = -Infinity
    for (let k = 0; k < 3; k++) {
      const v = ix[t * 3 + k] * 3
      lx = Math.min(lx, p[v]); hx = Math.max(hx, p[v]); ly = Math.min(ly, p[v + 1]); hy = Math.max(hy, p[v + 1])
    }
    for (let j = Math.floor((ly - b.min[1]) / cs); j <= Math.floor((hy - b.min[1]) / cs); j++) for (let i = Math.floor((lx - b.min[0]) / cs); i <= Math.floor((hx - b.min[0]) / cs); i++) cells[j * nx + i].push(t)
  }
  return (x: number, y: number): number | null => {
    const i = Math.floor((x - b.min[0]) / cs)
    const j = Math.floor((y - b.min[1]) / cs)
    if (i < 0 || j < 0 || i >= nx || j >= ny) return null
    let best: number | null = null
    for (const t of cells[j * nx + i]) {
      const a = ix[t * 3] * 3, bb = ix[t * 3 + 1] * 3, c = ix[t * 3 + 2] * 3
      const d = (p[bb + 1] - p[c + 1]) * (p[a] - p[c]) + (p[c] - p[bb]) * (p[a + 1] - p[c + 1])
      if (Math.abs(d) < 1e-12) continue
      const l1 = ((p[bb + 1] - p[c + 1]) * (x - p[c]) + (p[c] - p[bb]) * (y - p[c + 1])) / d
      const l2 = ((p[c + 1] - p[a + 1]) * (x - p[c]) + (p[a] - p[c]) * (y - p[c + 1])) / d
      const l3 = 1 - l1 - l2
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue
      const z = l1 * p[a + 2] + l2 * p[bb + 2] + l3 * p[c + 2]
      if (best === null || z > best) best = z
    }
    return best
  }
}
