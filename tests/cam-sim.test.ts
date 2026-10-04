import { describe, expect, it } from 'vitest'
import { makeEntity, newPart } from '@/cam/doc'
import { polyline, pt, rect, roundedRect } from '@/cam/geom'
import { defaultOp } from '@/cam/ops'
import { buildTimeline, carve, checkRapids, createHeightfield, cutSummary, cutterZ, heightAt, looseMask, positionAt, programOrder, resetHeightfield, shadeHeightfield } from '@/cam/sim'
import { generatePart, type Toolpath } from '@/cam/toolpath'
import type { CamOp, CamPart } from '@/cam/types'
import { defaultAppData } from '@/core/defaults'

const lv = (depth: number, through = false) => ({ safeZ: 20, rapidZ: 3, depth, through, stockZ: 0, passDepth: 0 })

function panel(): CamPart {
  const part = newPart({ name: 'Sim panel', length: 600, width: 400, thickness: 18, materialId: 'mat-mdf18', entities: [] })
  const outline = makeEntity({ t: 'contour', c: rect(0, 0, 600, 400) }, 'outline')
  const holes = [pt(50, 50), pt(550, 50)].map((c) => makeEntity({ t: 'circle', c, r: 2.5 }, 'holes', 1))
  const edge = makeEntity({ t: 'circle', c: pt(100, 9), r: 4 }, 'holes', 2)
  const pocket = makeEntity({ t: 'contour', c: roundedRect(250, 170, 100, 60, 8) }, 'machining')
  const groove = makeEntity({ t: 'contour', c: polyline([pt(20, 360), pt(580, 360)], false) }, 'machining')
  const slot = makeEntity({ t: 'contour', c: roundedRect(420, 120, 120, 40, 20) }, 'machining')
  part.entities = [outline, ...holes, edge, pocket, groove, slot]
  part.outlineId = outline.id
  const op = <K extends CamOp['kind']>(k: K, ids: string[], extra: Partial<CamOp> = {}) => ({ ...defaultOp(k, ids), ...extra }) as CamOp
  part.ops = [
    op('drill', [...holes, edge].map((e) => e.id), { levels: lv(12) }),
    op('pocket', [pocket.id], { levels: lv(6) }),
    op('saw', [groove.id], { levels: lv(8) }),
    op('profile', [slot.id], { side: 'inside', levels: lv(18, true) }),
    op('profile', [outline.id], { side: 'outside', levels: lv(18, true) }),
  ]
  return part
}

describe('C9 toolpath simulation', () => {
  const machine = defaultAppData().machine
  machine.hasHorizontalDrillUnit = true
  machine.tools.push({ id: 't301', number: 301, type: 'drill-horizontal', name: 'Horizontal drill 8 mm (placeholder)', diameter: 8, maxDepth: 40 })
  const part = panel()
  const paths = generatePart(part, machine)
  const tl = buildTimeline(paths)

  it('backplots every op in order with rapids, and matches the op time estimate', () => {
    expect(tl.ops.map((o) => o.name)).toEqual(paths.filter((p) => p.moves.length).map((p) => p.name))
    expect(tl.segs.some((s) => s.kind === 'rapid')).toBe(true)
    expect(tl.segs.some((s) => s.kind === 'drill')).toBe(true)
    for (let i = 1; i < tl.segs.length; i++) {
      expect(tl.segs[i].t0).toBeCloseTo(tl.segs[i - 1].t1, 9)
      expect(tl.segs[i].op).toBeGreaterThanOrEqual(tl.segs[i - 1].op)
    }
    const estimate = paths.reduce((n, p) => n + p.stats.minutes, 0) * 60
    expect(Math.abs(tl.total - estimate) / estimate).toBeLessThan(0.03)
    const cut = paths.reduce((n, p) => n + p.stats.cut, 0)
    const rapid = paths.reduce((n, p) => n + p.stats.rapid, 0)
    expect(Math.abs(tl.cutLength - cut) / cut).toBeLessThan(0.02)
    // op estimates start each op from home; the timeline chains ops and adds drill-cycle Z travel
    expect(Math.abs(tl.rapidLength - rapid) / rapid).toBeLessThan(0.15)
  })

  it('puts the ghost tool where the program is at any moment', () => {
    expect(positionAt(tl, 0).p).toEqual({ x: 0, y: 0, z: 50 })
    const last = tl.segs[tl.segs.length - 1]
    expect(positionAt(tl, tl.total + 5).p).toEqual(last.b)
    const s = tl.segs.find((g) => g.kind === 'cut' && g.t1 - g.t0 > 0.5)!
    const mid = positionAt(tl, (s.t0 + s.t1) / 2)
    expect(mid.kind).toBe('cut')
    expect(mid.p.x).toBeCloseTo((s.a.x + s.b.x) / 2, 6)
    expect(mid.p.y).toBeCloseTo((s.a.y + s.b.y) / 2, 6)
    expect(mid.p.z).toBeCloseTo((s.a.z + s.b.z) / 2, 6)
    const o = tl.ops[1]
    expect(positionAt(tl, (o.start + o.end) / 2).op).toBe(1)
  })

  it('carves a 2.5D heightfield with the right depths', () => {
    const hf = createHeightfield(part.length, part.width, part.thickness, 1)
    carve(hf, tl, 0, tl.total + 1)
    expect(heightAt(hf, 300, 200)).toBeCloseTo(-6, 3)
    expect(heightAt(hf, 50.5, 50.5)).toBeCloseTo(-12, 3)
    expect(heightAt(hf, 300.5, 360.5)).toBeCloseTo(-8, 3)
    expect(heightAt(hf, 480, 121)).toBeCloseTo(-18, 3)
    expect(heightAt(hf, 480, 140)).toBe(0)
    const loose = looseMask(hf)
    expect(loose[140 * hf.nx + 480]).toBe(1)
    expect(loose[250 * hf.nx + 150]).toBe(0)
    expect(heightAt(hf, 150, 250)).toBe(0)
    expect(heightAt(hf, 100.5, 3.5)).toBe(0)
    const sum = cutSummary(hf)
    expect(sum.deepest).toBeCloseTo(18, 3)
    expect(sum.throughPct).toBeGreaterThan(0)
    expect(sum.throughPct).toBeLessThan(sum.cutPct)
  })

  it('cuts progressively, and step-by-step matches one pass', () => {
    const half = createHeightfield(600, 400, 18, 2)
    carve(half, tl, 0, tl.ops[2].start)
    expect(heightAt(half, 300, 200)).toBeCloseTo(-6, 3)
    expect(heightAt(half, 300.5, 360.5)).toBe(0)
    const stepped = createHeightfield(600, 400, 18, 2)
    const N = 37
    for (let i = 0; i < N; i++) carve(stepped, tl, (tl.total * i) / N, (tl.total * (i + 1)) / N)
    const once = createHeightfield(600, 400, 18, 2)
    carve(once, tl, 0, tl.total)
    let diff = 0
    for (let k = 0; k < once.top.length; k++) diff = Math.max(diff, Math.abs(once.top[k] - stepped.top[k]))
    expect(diff).toBeLessThan(0.05)
    resetHeightfield(once)
    expect(cutSummary(once).cutPct).toBe(0)
  })

  it('finds no rapid collisions in a generated program, and flags a rapid through material', () => {
    expect(checkRapids(tl, 600, 400, 18, 2)).toEqual([])
    const bad: Toolpath = {
      ...paths[1],
      name: 'Bad rapid',
      moves: [
        { t: 'rapid', x: 100, y: 100, z: 20 },
        { t: 'rapid', x: 100, y: 100, z: -4 },
        { t: 'feed', x: 120, y: 100, z: -4, f: 'cut' },
      ],
    }
    const w = checkRapids(buildTimeline([bad]), 600, 400, 18, 2)
    expect(w).toHaveLength(1)
    expect(w[0].kind).toBe('rapid-in-material')
    expect(w[0].at.x).toBeCloseTo(100, 6)
  })

  it('models flat, ball and V cutters', () => {
    expect(cutterZ({ r: 5, shape: 'flat', angle: 0 }, -3, 4)).toBe(-3)
    expect(cutterZ({ r: 5, shape: 'flat', angle: 0 }, -3, 6)).toBe(Infinity)
    expect(cutterZ({ r: 5, shape: 'ball', angle: 0 }, -5, 0)).toBeCloseTo(-5, 9)
    expect(cutterZ({ r: 5, shape: 'ball', angle: 0 }, -5, 5)).toBeCloseTo(0, 9)
    expect(cutterZ({ r: 10, shape: 'v', angle: 90 }, -4, 3)).toBeCloseTo(-1, 9)
    const hf = createHeightfield(50, 50, 18, 0.5)
    const vtl = buildTimeline([
      {
        ...paths[1],
        tool: { id: 'v', number: 9, type: 'router', name: 'V 90', diameter: 20, maxDepth: 10, shape: 'v', angle: 90 },
        moves: [
          { t: 'rapid', x: 10, y: 25, z: 3 },
          { t: 'feed', x: 10, y: 25, z: -4, f: 'plunge' },
          { t: 'feed', x: 40, y: 25, z: -4, f: 'cut' },
        ],
      },
    ])
    carve(hf, vtl, 0, vtl.total)
    expect(heightAt(hf, 25.25, 25.25)).toBeCloseTo(-3.75, 6)
    expect(heightAt(hf, 25.25, 27.25)).toBeCloseTo(-1.75, 6)
    expect(heightAt(hf, 25.25, 30.25)).toBe(0)
  })

  it('plays toolpaths in woodWOP program order (drilling first)', () => {
    const shuffled = [paths[1], paths[4], paths[0], paths[2]]
    expect(programOrder(shuffled).map((p) => p.kind)).toEqual(['drill', 'pocket', 'profile', 'saw'])
  })

  it('shades the heightfield and the through-cut view', () => {
    const hf = createHeightfield(600, 400, 18, 4)
    carve(hf, tl, 0, tl.total)
    const px = new Uint8ClampedArray(hf.nx * hf.ny * 4)
    const loose = looseMask(hf)
    shadeHeightfield(hf, px, { base: [200, 170, 120], loose })
    const at = (x: number, y: number) => ((hf.ny - 1 - Math.floor(y / 4)) * hf.nx + Math.floor(x / 4)) * 4
    expect(px[at(150, 250) + 3]).toBe(255)
    expect(px[at(480, 121) + 3]).toBe(0)
    expect(px[at(480, 140) + 3]).toBe(110)
    expect(px[at(300, 200)]).toBeLessThan(px[at(150, 250)])
    shadeHeightfield(hf, px, { base: [200, 170, 120], through: true, loose })
    expect(px[at(300, 200)]).toBe(px[at(150, 250)])
    expect(px[at(480, 140) + 3]).toBe(0)
  })
})
