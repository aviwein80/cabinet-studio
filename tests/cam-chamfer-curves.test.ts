/**
 * M2.6b: chamfers (2D-13) and curve cuts (2D-15): between two curves, along 3D curves, Z-waves.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeEntity, newPart } from '../src/cam/doc'
import { circle, polyline, pt, rect } from '../src/cam/geom'
import { writePartMpr } from '../src/cam/mpr'
import { readMpr } from '../src/cam/mprRead'
import { defaultOp, resolveTool } from '../src/cam/ops'
import { checkGouge } from '../src/cam/3d/check'
import { alignCurves, resample3, smooth3, waveDepth, zWave } from '../src/cam/more25d/curves'
import { ruled } from '../src/cam/mesh/surface'
import { buildTimeline, carve, createHeightfield, heightAt } from '../src/cam/sim'
import { generatePart, simpleMoves, type Toolpath } from '../src/cam/toolpath'
import type { CamOp, CamPart, ChamferOp, CurveOp } from '../src/cam/types'
import { defaultAppData, PLACEHOLDER_MACHINE } from '../src/core/defaults'
import { runJob } from '../src/core/pipeline'
import type { AppData, Job } from '../src/core/types'
import { digest, digest3d } from './cam-digest'
import { chamferParts, curveParts } from './cam-reference-25d'

const machine = PLACEHOLDER_MACHINE

function simulate(part: CamPart, paths: Toolpath[], cell = 0.1) {
  const hf = createHeightfield(part.length, part.width, part.thickness, cell)
  const tl = buildTimeline(paths)
  carve(hf, tl, 0, tl.total)
  return hf
}

function panel(size: [number, number, number] = [200, 120, 19]) {
  const part = newPart({ name: 'P', length: size[0], width: size[1], thickness: size[2], entities: [] })
  const outline = makeEntity({ t: 'contour', c: rect(0, 0, size[0], size[1]) }, 'outline')
  part.entities = [outline]
  part.outlineId = outline.id
  return part
}

describe('chamfer', () => {
  const vTool = (angle: number) => ({ ...machine, tools: [...machine.tools, { id: 'tv60', number: 160, type: 'router' as const, name: 'V 60° 20 mm (placeholder)', diameter: 20, maxDepth: 15, shape: 'v' as const, angle, centreCutting: true }] })

  it('picks the V cutter; the simulated bevel is the 45° chamfer of the width asked for', () => {
    const part = panel([60, 40, 19])
    const op = defaultOp('chamfer', [part.outlineId!], { size: 3 } as Partial<CamOp>) as ChamferOp
    part.ops = [op]
    expect(resolveTool(op, machine)?.shape).toBe('v')
    const paths = generatePart(part, machine)
    expect(paths[0].warnings.join(' ')).toMatch(/3\.00 mm wide and 3\.00 mm deep/)
    const hf = simulate(part, paths)
    // across the middle of the bottom edge: at u from the edge, z = -(3 - u)
    for (let j = 0; j < 40; j++) {
      const y = (j + 0.5) * hf.cell
      const want = Math.min(0, -(3 - y))
      expect(Math.abs(heightAt(hf, 30, y) - want), `y ${y}`).toBeLessThan(0.002)
    }
    // and the short edge, from the other side
    for (let i = 0; i < 40; i++) {
      const x = 60 - (i + 0.5) * hf.cell
      expect(Math.abs(heightAt(hf, x, 20) - Math.min(0, -(3 - (60 - x))))).toBeLessThan(0.002)
    }
    expect(heightAt(hf, 30, 20)).toBe(0)
  })

  it('depth-driven with a 60° cutter and the tip lowered: the bevel is d deep and d tan 30° wide; the tip is offset to the waste side', () => {
    const part = panel([60, 40, 19])
    const op = defaultOp('chamfer', [part.outlineId!], { drive: 'depth', size: 4, tipOffset: 1, toolId: 'tv60' } as Partial<CamOp>) as ChamferOp
    part.ops = [op]
    const m = vTool(60)
    const [tp] = generatePart(part, m)
    const tan = Math.tan(Math.PI / 6)
    const cut = [...simpleMoves(tp.moves)].filter((q) => q.t === 'feed' && q.f === 'cut')
    // tip 5 mm down, 1 x tan30 outside the panel
    for (const q of cut) expect(q.z).toBeCloseTo(-5, 9)
    expect(Math.min(...cut.map((q) => q.y))).toBeCloseTo(-tan, 6)
    const hf = simulate(part, [tp])
    for (let j = 0; j < 40; j++) {
      const y = (j + 0.5) * hf.cell
      const want = Math.min(0, -(4 - y / tan))
      expect(Math.abs(heightAt(hf, 30, y) - want), `y ${y}`).toBeLessThan(0.003)
    }
    expect(tp.intents[0].k === 'contour' && tp.intents[0].passes[0].depth).toBe(5)
  }, 60_000)

  it('a level 3D edge is chamfered at its own height; tilted edges are left out; too big for the cutter is refused', () => {
    const part = panel([300, 200, 25])
    const rim = makeEntity({ t: 'poly3d', pts: [[100, 50, -6], [200, 50, -6], [200, 150, -6], [100, 150, -6], [100, 50, -6]] }, 'edges')
    const tilted = makeEntity({ t: 'poly3d', pts: [[10, 10, 0], [50, 10, -3]] }, 'edges')
    part.entities.push(rim, tilted)
    const op = defaultOp('chamfer', [rim.id, tilted.id], { side: 'inside', size: 2 } as Partial<CamOp>)
    part.ops = [op]
    const [tp] = generatePart(part, machine)
    const zs = new Set([...simpleMoves(tp.moves)].filter((q) => q.t === 'feed' && q.f === 'cut').map((q) => q.z))
    expect([...zs]).toEqual([-8])
    expect(tp.warnings.join(' ')).toMatch(/not level/)
    const big = { ...op, size: 7 } as ChamferOp
    const [tb] = generatePart({ ...part, ops: [big] }, machine)
    expect(tb.moves).toEqual([])
    expect(tb.warnings.join(' ')).toMatch(/needs 7\.00 mm of cutter radius/)
  })

  it('export: written as contour passes behind the newer-operations switch', () => {
    const part = panel()
    part.materialId = 'mat-mdf18'
    part.ops = [defaultOp('chamfer', [part.outlineId!], { size: 2 } as Partial<CamOp>)]
    const data = defaultAppData()
    const j: Job = { id: 'j', number: 'J28', name: 'Chamfer', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [part] }
    data.jobs = [j]
    const errs = (f: Partial<AppData['settings']['features']>) => {
      data.settings.features = { ...defaultAppData().settings.features, ...f } as AppData['settings']['features']
      return [...new Set(runJob(j, data).issues.filter((i) => i.severity === 'error' && i.code !== 'THICKNESS').map((i) => i.code))]
    }
    expect(errs({ camMprOutput: true })).toEqual(['CAM_25D_OUTPUT_OFF'])
    expect(errs({ camMprOutput: true, cam25dMprOutput: true })).toEqual([])
  })
})

describe('curve cuts', () => {
  it('alignment: open curves run the same way; closed ones counter-clockwise from the nearest start', () => {
    const [, b] = alignCurves(
      [
        [0, 0, 0],
        [10, 0, 0],
      ],
      [
        [10, 5, 0],
        [0, 5, 0],
      ],
      false,
    )
    expect(b[0]).toEqual([0, 5, 0])
    const sq = (r: number, z: number): [number, number, number][] => [
      [r, -r, z],
      [r, r, z],
      [-r, r, z],
      [-r, -r, z],
      [r, -r, z],
    ]
    const [a2, b2] = alignCurves(sq(10, 0), [...sq(5, -3)].reverse(), true)
    expect(a2[0]).toEqual([10, -10, 0])
    expect(b2[0]).toEqual([5, -5, -3])
    expect(b2[1]).toEqual([5, 5, -3])
  })

  it('between two curves: a plane bevel, ball-nose: no gouge (independent exact check), touches the surface, passes within the step-over', () => {
    const [p] = curveParts().filter((x) => x.id === 'btw01')
    const [tp] = generatePart(p, machine)
    expect(tp.tool?.shape).toBe('ball')
    const surf = ruled(
      [
        [50, 50, 0],
        [250, 50, 0],
      ],
      [
        [50, 90, -10],
        [250, 90, -10],
      ],
      { n: 3 },
    )
    const g = checkGouge(surf, { shape: 'ball', r: 3 }, tp.moves, { step: 0.25 })
    expect(g.exact).toBe(true)
    expect(g.max).toBeLessThanOrEqual(0.005)
    // inside the bevel the ball centre is exactly R from the plane: the tool touches it
    const n = [0, 10, 40].map((v) => v / Math.hypot(10, 40))
    let worst = 0
    let passes = 0
    for (const m of tp.moves) {
      if (m.t !== 'poly') continue
      passes++
      for (let i = 0; i < m.pts.length; i += 3) {
        const [x, y, z] = [m.pts[i], m.pts[i + 1], m.pts[i + 2]]
        if (x < 60 || x > 240 || y < 55 || y > 85) continue
        const dPlane = (y - 50) * n[1] + (z + 3 - 0) * n[2]
        worst = Math.max(worst, Math.abs(dPlane - 3))
      }
    }
    expect(worst).toBeLessThan(0.002)
    // slant 41.23 mm at 2 mm step-over: 21 passes
    expect(passes).toBe(22)
    expect(tp.noOutput).toMatch(/true 3D/)
  })

  it('between two circles at different depths: a cone, no gouge', () => {
    const [p] = curveParts().filter((x) => x.id === 'btw02')
    const [tp] = generatePart(p, machine)
    const ring = (r: number, z: number): [number, number, number][] => Array.from({ length: 361 }, (_, i) => [150 + r * Math.cos((i * Math.PI) / 180), 150 + r * Math.sin((i * Math.PI) / 180), z])
    const surf = ruled(ring(80, 0), ring(40, -8), { n: 361 })
    const g = checkGouge(surf, { shape: 'ball', r: 3 }, tp.moves, { step: 0.25 })
    expect(g.max).toBeLessThanOrEqual(0.005)
    let lo = Infinity
    for (const m of tp.moves) if (m.t === 'poly') for (let i = 2; i < m.pts.length; i += 3) lo = Math.min(lo, m.pts[i])
    expect(lo).toBeLessThan(-7)
  })

  it('along a 3D curve: the tip is on the polyline (depth below it in passes); smoothed, it passes through every point', () => {
    const pts: [number, number, number][] = [
      [20, 100, -1],
      [80, 160, -3],
      [150, 100, -5],
      [220, 40, -3],
      [280, 100, -1],
    ]
    const s = smooth3(pts, false, 0.01)
    for (const q of pts) expect(Math.min(...s.map((p) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])))).toBeLessThan(1e-9)
    const [p] = curveParts().filter((x) => x.id === 'f3d01')
    const [tp] = generatePart(p, machine)
    const poly = tp.moves.filter((m) => m.t === 'poly')
    expect(poly).toHaveLength(1)
    expect([...(poly[0] as { pts: Float64Array }).pts]).toEqual([150, 30, -4, 150, 170, -8, 270, 170, -2])
    const [p2] = curveParts().filter((x) => x.id === 'f3d02')
    const [t2] = generatePart(p2, machine)
    const zs = t2.moves.filter((m) => m.t === 'poly').map((m) => Math.min(...[...(m as { pts: Float64Array }).pts].filter((_, i) => i % 3 === 2)))
    expect(zs[0]).toBeCloseTo(-5.5, 6)
    expect(zs[1]).toBeCloseTo(-6, 6)
  })

  it('Z-wave: depth min at the start, max at half a wave; a closed shape gets a whole number of waves; chords within tolerance', () => {
    const w = { min: 1, max: 4, length: 40, shape: 'sine' as const }
    expect(waveDepth(0, w)).toBe(1)
    expect(waveDepth(20, w)).toBeCloseTo(4, 12)
    expect(waveDepth(10, { ...w, shape: 'triangle' })).toBeCloseTo(2.5, 12)
    const open = zWave([pt(0, 0), pt(200, 0)], false, w, 0.01)
    expect(open.length).toBe(40)
    // between samples the straight move stays within 0.01 mm of the true wave
    let err = 0
    for (let i = 1; i < open.chain.length; i++) {
      const [x0, , z0] = open.chain[i - 1]
      const [x1, , z1] = open.chain[i]
      for (const f of [0.25, 0.5, 0.75]) err = Math.max(err, Math.abs(z0 + (z1 - z0) * f + waveDepth(x0 + (x1 - x0) * f, w)))
    }
    expect(err).toBeLessThan(0.01)
    const ring = zWave(circle(pt(0, 0), 100).segs.flatMap((sg, i) => (i === 0 ? [sg.a] : [])).concat(Array.from({ length: 719 }, (_, k) => pt(100 * Math.cos(((k + 1) * Math.PI) / 360), 100 * Math.sin(((k + 1) * Math.PI) / 360)))), true, { ...w, length: 50 }, 0.01)
    const perim = 2 * Math.PI * 100
    expect(perim / ring.length).toBeCloseTo(Math.round(perim / 50), 3)
    // joins up: the first and last points are the same depth
    expect(ring.chain[0][2]).toBeCloseTo(ring.chain[ring.chain.length - 1][2], 6)
  })

  it('Z-wave in layers: each layer stops at its floor; simulated groove follows the wave', () => {
    const [p] = curveParts().filter((x) => x.id === 'zw03')
    const [tp] = generatePart(p, machine)
    const floors = tp.moves.filter((m) => m.t === 'poly').map((m) => Math.min(...[...(m as { pts: Float64Array }).pts].filter((_, i) => i % 3 === 2)))
    expect(floors.map((f) => Math.round(f * 1000) / 1000)).toEqual([-2, -4, -6])
    const [z1] = curveParts().filter((x) => x.id === 'zw01')
    const t1 = generatePart(z1, { ...machine, tools: machine.tools.map((t) => (t.id === 't105' ? { ...t, shape: undefined } : t)) })
    const hf = simulate(z1, t1, 0.25)
    for (const x of [20, 30, 40, 55, 75, 100, 200]) {
      const want = -waveDepth(x - 20, { min: 1, max: 4, length: 40, shape: 'sine' })
      // a flat 6 mm cutter: the floor at x is the deepest point of the wave within 3 mm
      let deepest = 0
      for (let d = -3; d <= 3; d += 0.05) if (x + d >= 20 && x + d <= 380) deepest = Math.min(deepest, -waveDepth(x + d - 20, { min: 1, max: 4, length: 40, shape: 'sine' }))
      const z = heightAt(hf, Math.floor(x / hf.cell) * hf.cell + hf.cell / 2, 100.1)
      expect(z).toBeLessThanOrEqual(want + 0.05)
      expect(z).toBeGreaterThanOrEqual(deepest - 0.05)
    }
  })

  it('export: every curve cut is refused (true 3D)', () => {
    const part = panel()
    part.materialId = 'mat-mdf18'
    const l = makeEntity({ t: 'contour', c: polyline([pt(20, 60), pt(180, 60)], false) }, 'machining')
    part.entities.push(l)
    const l2 = makeEntity({ t: 'contour', c: polyline([pt(20, 90), pt(180, 90)], false) }, 'machining')
    part.entities.push(l2)
    // (the cut between curves is calculated in the background, so export skips it: still refused)
    part.ops = [defaultOp('curve', [l.id], { mode: 'zwave' } as Partial<CamOp>) as CurveOp, defaultOp('curve', [l.id, l2.id], { mode: 'between' } as Partial<CamOp>) as CurveOp]
    const data = defaultAppData()
    const j: Job = { id: 'j', number: 'J29', name: 'Wave', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [part] }
    data.jobs = [j]
    data.settings.features = { ...data.settings.features, camMprOutput: true, cam25dMprOutput: true }
    const out = runJob(j, data)
    expect([...new Set(out.issues.filter((i) => i.severity === 'error' && i.code !== 'THICKNESS').map((i) => i.code))]).toEqual(['CAM_NO_OUTPUT'])
    expect(out.issues.filter((i) => i.code === 'CAM_NO_OUTPUT')).toHaveLength(2)
  })

  it('resampling by length keeps the ends', () => {
    const r = resample3(
      [
        [0, 0, 0],
        [10, 0, 0],
        [10, 10, -5],
      ],
      5,
    )
    expect(r[0]).toEqual([0, 0, 0])
    expect(r[4]).toEqual([10, 10, -5])
  })
})

describe('goldens: 3 reference parts per operation', () => {
  const DIR = path.join(import.meta.dirname, 'golden', 'cam25d')
  const UPDATE = process.env.UPDATE_GOLDEN === '1'
  const check = (f: string, text: string) => {
    if (UPDATE) {
      fs.mkdirSync(path.dirname(f), { recursive: true })
      fs.writeFileSync(f, text, f.endsWith('.json') ? 'utf8' : 'latin1')
    }
    expect(fs.existsSync(f), `${f} missing; run UPDATE_GOLDEN=1 once to create it`).toBe(true)
    expect(text).toBe(fs.readFileSync(f, f.endsWith('.json') ? 'utf8' : 'latin1'))
  }
  for (const p of chamferParts()) {
    it(`${p.id} ${p.name}`, () => {
      const paths = generatePart(p, machine)
      check(path.join(DIR, p.id, 'toolpaths.json'), JSON.stringify(paths.map(digest), null, 1) + '\n')
      const mpr = writePartMpr(p, paths, machine, 'REF')
      expect(readMpr(mpr).errors).toEqual([])
      check(path.join(DIR, p.id, 'part.mpr'), mpr)
    })
  }
  for (const p of curveParts()) {
    it(`${p.id} ${p.name}`, () => {
      const t0 = performance.now()
      const paths = generatePart(p, machine)
      const ms = performance.now() - t0
      console.log(`[curve] ${p.id}: ${ms.toFixed(0)} ms, ${paths[0].stats.cut} mm`)
      check(path.join(DIR, p.id, 'toolpaths.json'), JSON.stringify(paths.map(digest3d), null, 1) + '\n')
    })
  }
})
