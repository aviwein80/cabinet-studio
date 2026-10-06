/**
 * M2.7d image trace (NEW-06): a logo PNG (tests/fixtures/trace/logo.png, made by
 * scripts/fixtures/make_trace_fixture.ts) traced into closed contours by our own tracer.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { area, closestOnContour, type Contour, dist, near } from '@/cam/geom'
import { borderLoops, DEFAULT_TRACE, despeckle, inkMask, traceImage } from '@/cam/trace'
import { decodePng, encodePng } from './png'

const logo = decodePng(new Uint8Array(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'trace', 'logo.png'))))
const s = 0.5 // mm per pixel
const opt = { ...DEFAULT_TRACE, mmPerPixel: s, despeckle: 6 }

/** Image (x right, y down, px) to part mm (y up). */
const P = (x: number, y: number) => ({ x: x * s, y: (240 - y) * s })

function closedAndJoined(c: Contour) {
  expect(c.closed).toBe(true)
  for (let i = 0; i < c.segs.length; i++) expect(near(c.segs[i].b, c.segs[(i + 1) % c.segs.length].a, 1e-6)).toBe(true)
}

describe('M2.7d image trace (NEW-06)', () => {
  it('the logo PNG traces into four closed contours: ring (outer and hole), square, L; the speck is cleaned away', () => {
    expect(logo.width).toBe(400)
    const r = traceImage(logo, opt)
    expect(r.specks).toBe(1)
    expect(r.contours).toHaveLength(4)
    for (const c of r.contours) closedAndJoined(c)
    const areas = r.contours.map((c) => area(c)).sort((a, b) => a - b)
    // the hole runs clockwise (negative), outer loops counter-clockwise
    expect(areas.filter((a) => a < 0)).toHaveLength(1)
    const want = { ringOuter: Math.PI * 80 * 80 * s * s, hole: -Math.PI * 50 * 50 * s * s, square: 70 * 70 * s * s, L: (30 * 160 + 50 * 30) * s * s }
    const near1 = (got: number, w: number) => expect(Math.abs(got - w) / Math.abs(w)).toBeLessThan(0.01)
    near1(areas[0], want.hole)
    near1(areas[1], want.square)
    near1(areas[2], want.L)
    near1(areas[3], want.ringOuter)
    process.stdout.write(`  [trace] areas ${areas.map((a) => a.toFixed(1)).join(', ')} mm² vs ${[want.hole, want.square, want.L, want.ringOuter].map((a) => a.toFixed(1)).join(', ')}; ${r.corners} corners, ${r.contours.reduce((n, c) => n + c.segs.length, 0)} segments\n`)
  })

  it('the circle comes out as arcs on the true radius; square and L corners stay sharp (within a pixel)', () => {
    const r = traceImage(logo, opt)
    const byArea = [...r.contours].sort((a, b) => Math.abs(area(a)) - Math.abs(area(b)))
    const ring = byArea[3]
    const centre = P(100, 120)
    expect(ring.segs.filter((g) => g.k === 'A').length).toBeGreaterThan(0)
    for (const g of ring.segs) expect(Math.abs(dist(g.a, centre) - 80 * s)).toBeLessThan(0.6 * s)
    const square = byArea[0]
    for (const [x, y] of [
      [190, 85],
      [260, 85],
      [260, 155],
      [190, 155],
    ]) {
      const c = P(x, y)
      const corner = square.segs.map((g) => dist(g.a, c)).reduce((a, b) => Math.min(a, b))
      expect(corner, `corner ${x},${y}`).toBeLessThan(1 * s)
    }
    // the edges are straight: every point of the square within half a pixel of the true square
    for (const g of square.segs) {
      const p = g.a
      const d = Math.min(Math.abs(p.x - 190 * s), Math.abs(p.x - 260 * s), Math.abs(p.y - (240 - 85) * s), Math.abs(p.y - (240 - 155) * s))
      expect(d).toBeLessThan(0.6 * s)
    }
    // L: its inside corner at (330, 170) too
    const L = byArea[1]
    expect(closestOnContour(L, P(330, 170)).d).toBeLessThan(1 * s)
  })

  it('threshold, invert and despeckle', () => {
    const W = 20
    const H = 10
    const img = new Uint8Array(W * H * 4).fill(255)
    const dot = (x: number, y: number, v: number) => img.set([v, v, v, 255], (y * W + x) * 4)
    for (let y = 2; y < 8; y++) for (let x = 2; x < 9; x++) dot(x, y, 0)
    dot(5, 5, 255) // a pin-hole
    dot(15, 5, 0) // a speck
    const m = inkMask({ width: W, height: H, data: img }, { threshold: 128, invert: false })
    expect(despeckle(m, W, H, 2)).toEqual({ specks: 1, pinholes: 1 })
    expect(borderLoops(m, W, H)).toHaveLength(1)
    const inv = inkMask({ width: W, height: H, data: img }, { threshold: 128, invert: true })
    expect(inv.reduce((n, v) => n + v, 0)).toBe(W * H - (7 * 6 - 1) - 1)
    // transparent pixels are paper
    const clear = new Uint8Array(W * H * 4)
    expect(inkMask({ width: W, height: H, data: clear }, { threshold: 128, invert: false }).every((v) => v === 0)).toBe(true)
  })

  it('pixels touching at a corner stay joined; every loop of a random picture is closed; the same picture gives the same contours', () => {
    const W = 64
    const H = 48
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const img = new Uint8Array(W * H * 4)
    for (let i = 0; i < W * H; i++) {
      const v = rnd() < 0.45 ? 0 : 255
      img.set([v, v, v, 255], i * 4)
    }
    const r = traceImage({ width: W, height: H, data: img }, { ...DEFAULT_TRACE, despeckle: 0, smoothing: 0 })
    expect(r.contours.length).toBeGreaterThan(10)
    for (const c of r.contours) closedAndJoined(c)
    expect(JSON.stringify(traceImage({ width: W, height: H, data: img }, { ...DEFAULT_TRACE, despeckle: 0, smoothing: 0 }))).toBe(JSON.stringify(r))
    // two ink pixels touching only at a corner: one loop
    const two = new Uint8Array(4 * 4 * 4).fill(255)
    two.set([0, 0, 0, 255], (1 * 4 + 1) * 4)
    two.set([0, 0, 0, 255], (2 * 4 + 2) * 4)
    const mm = inkMask({ width: 4, height: 4, data: two }, { threshold: 128, invert: false })
    expect(borderLoops(mm, 4, 4)).toHaveLength(1)
  })

  it('the PNG reader used here reads back what the writer wrote', () => {
    const d = decodePng(encodePng(logo.width, logo.height, logo.data))
    expect(Buffer.from(d.data).equals(Buffer.from(logo.data))).toBe(true)
  })
})
