import { describe, expect, it } from 'vitest'
import { nestMaterial, type NestPart } from '../src/core/nesting'
import { runJob } from '../src/core/pipeline'
import { sampleJob } from '../src/core/sample'
import { data } from './helpers'

const opt = { sheetLength: 2800, sheetWidth: 2070, edgeTrim: 10, spacing: 14, allowRotation: true }

const parts = (n: number, l: number, w: number, canRotate = true): NestPart[] =>
  Array.from({ length: n }, (_, i) => ({ uid: `p${String(i).padStart(3, '0')}`, length: l, width: w, canRotate }))

function assertValid(res: ReturnType<typeof nestMaterial>, spacing: number, o = opt) {
  for (const sh of res.sheets) {
    for (const p of sh.placements) {
      expect(p.x).toBeGreaterThanOrEqual(o.edgeTrim - 1e-9)
      expect(p.y).toBeGreaterThanOrEqual(o.edgeTrim - 1e-9)
      expect(p.x + p.dx).toBeLessThanOrEqual(o.sheetLength - o.edgeTrim + 1e-9)
      expect(p.y + p.dy).toBeLessThanOrEqual(o.sheetWidth - o.edgeTrim + 1e-9)
    }
    for (let i = 0; i < sh.placements.length; i++)
      for (let j = i + 1; j < sh.placements.length; j++) {
        const a = sh.placements[i]
        const b = sh.placements[j]
        const gap = Math.max(b.x - (a.x + a.dx), a.x - (b.x + b.dx), b.y - (a.y + a.dy), a.y - (b.y + b.dy))
        expect(gap, `${a.uid} vs ${b.uid}`).toBeGreaterThanOrEqual(spacing - 1e-9)
      }
  }
}

describe('MaxRects nesting', () => {
  it('fits a known 3 x 3 grid on one sheet and spills the 10th part', () => {
    const nine = nestMaterial(parts(9, 900, 660), opt)
    expect(nine.sheets.length).toBe(1)
    assertValid(nine, opt.spacing)
    const ten = nestMaterial(parts(10, 900, 660), opt)
    expect(ten.sheets.length).toBe(2)
    assertValid(ten, opt.spacing)
  })

  it('respects spacing, trim and sheet bounds on a mixed list', () => {
    const mixed: NestPart[] = [
      ...parts(6, 870, 559),
      ...parts(4, 765, 295).map((p) => ({ ...p, uid: 'd' + p.uid })),
      ...parts(5, 564, 100).map((p) => ({ ...p, uid: 'r' + p.uid })),
      ...parts(3, 1200, 600).map((p) => ({ ...p, uid: 'b' + p.uid })),
    ]
    const res = nestMaterial(mixed, opt)
    assertValid(res, opt.spacing)
    expect(res.sheets.reduce((n, s) => n + s.placements.length, 0)).toBe(mixed.length)
    expect(res.unplaced).toEqual([])
  })

  it('never rotates grain-locked parts', () => {
    const res = nestMaterial(parts(12, 2000, 300, false), opt)
    for (const s of res.sheets) for (const p of s.placements) expect(p.rotated).toBe(false)
    assertValid(res, opt.spacing)
  })

  it('rotates a long part to fit when allowed and reports it when not', () => {
    const tall = [{ uid: 'tall', length: 600, width: 2500, canRotate: true }]
    const ok = nestMaterial(tall, opt)
    expect(ok.sheets[0].placements[0].rotated).toBe(true)
    const locked = nestMaterial([{ ...tall[0], canRotate: false }], opt)
    expect(locked.sheets.length).toBe(0)
    expect(locked.unplaced[0].reason).toMatch(/grain-locked/)
  })

  it('reports parts larger than the sheet', () => {
    const res = nestMaterial([{ uid: 'huge', length: 3000, width: 2500, canRotate: true }], opt)
    expect(res.unplaced.map((u) => u.uid)).toEqual(['huge'])
  })

  it('is deterministic', () => {
    const list = [...parts(7, 870, 559), ...parts(9, 412, 519).map((p) => ({ ...p, uid: 's' + p.uid }))]
    expect(JSON.stringify(nestMaterial(list, opt))).toBe(JSON.stringify(nestMaterial(list, opt)))
  })

  it('orders cuts small parts first', () => {
    const res = nestMaterial([...parts(2, 1500, 800), ...parts(3, 300, 200).map((p) => ({ ...p, uid: 'z' + p.uid }))], opt)
    const areas = res.sheets[0].placements.map((p) => p.dx * p.dy)
    expect(areas).toEqual([...areas].sort((a, b) => a - b))
  })

  it('nests the sample kitchen onto 1 back sheet and 2 carcass sheets', () => {
    const out = runJob(sampleJob(), data())
    expect(out.nest.unplaced).toEqual([])
    const byMat = out.nest.sheets.map((s) => s.materialId)
    expect(byMat.filter((m) => m === 'mat-hdf6-white').length).toBe(1)
    expect(byMat.filter((m) => m === 'mat-pb18-white').length).toBe(2)
    for (const s of out.nest.sheets) assertValid({ sheets: [s], unplaced: [], strategy: '', engine: 'rect', splitKits: [] }, out.nest.spacing, { sheetLength: s.sheetLength, sheetWidth: s.sheetWidth, edgeTrim: 10, spacing: out.nest.spacing, allowRotation: true })
  })
})
