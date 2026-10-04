import { describe, expect, it } from 'vitest'
import { makeEntity, newPart } from '@/cam/doc'
import { polyline, pt, rect, roundedRect } from '@/cam/geom'
import { writePartPrograms } from '@/cam/mpr'
import { readMpr } from '@/cam/mprRead'
import { defaultOp } from '@/cam/ops'
import { generatePart } from '@/cam/toolpath'
import type { CamOp, CamPart, FaceId } from '@/cam/types'
import { defaultAppData } from '@/core/defaults'
import { mprFiles, runJob } from '@/core/pipeline'
import type { AppData, Job, MachineProfile } from '@/core/types'

function machineWithHorizontal(base: MachineProfile): MachineProfile {
  const m = structuredClone(base)
  m.hasHorizontalDrillUnit = true
  m.tools.push({ id: 't301', number: 301, type: 'drill-horizontal', name: 'Horizontal drill 8 mm (placeholder)', diameter: 8, maxDepth: 40 })
  return m
}

/** Six-face test panel: holes on every face, a pocket, a saw groove and an inner profile. */
function sixFacePanel(): CamPart {
  const part = newPart({ name: 'Six face panel', length: 600, width: 400, thickness: 18, materialId: 'mat-mdf18', entities: [] })
  const outline = makeEntity({ t: 'contour', c: rect(0, 0, 600, 400) }, 'outline')
  const top = [pt(50, 50), pt(550, 50)].map((c) => makeEntity({ t: 'circle', c, r: 2.5 }, 'holes', 1))
  const edges = ([2, 3, 4, 5] as FaceId[]).map((f) => makeEntity({ t: 'circle', c: pt(100, 9), r: 4 }, 'holes', f))
  const under = makeEntity({ t: 'circle', c: pt(100, 300), r: 17.5 }, 'holes', 6, { depth: 12 })
  const pocket = makeEntity({ t: 'contour', c: roundedRect(250, 170, 100, 60, 8) }, 'machining')
  const groove = makeEntity({ t: 'contour', c: polyline([pt(20, 360), pt(580, 360)], false) }, 'machining')
  const slot = makeEntity({ t: 'contour', c: roundedRect(420, 120, 120, 40, 20) }, 'machining')
  part.entities = [outline, ...top, ...edges, under, pocket, groove, slot]
  part.outlineId = outline.id
  const op = <K extends CamOp['kind']>(k: K, ids: string[], extra: Partial<CamOp> = {}) => ({ ...defaultOp(k, ids), ...extra }) as CamOp
  part.ops = [
    op('drill', [...top, ...edges, under].map((e) => e.id), { levels: { safeZ: 20, rapidZ: 3, depth: 12, through: false, stockZ: 0, passDepth: 0 } }),
    op('pocket', [pocket.id], { levels: { safeZ: 20, rapidZ: 3, depth: 6, through: false, stockZ: 0, passDepth: 0 } }),
    op('saw', [groove.id], { levels: { safeZ: 20, rapidZ: 3, depth: 8, through: false, stockZ: 0, passDepth: 0 } }),
    op('profile', [slot.id], { side: 'inside', levels: { safeZ: 20, rapidZ: 3, depth: 18, through: true, stockZ: 0, passDepth: 0 } }),
    op('profile', [outline.id], { side: 'outside', levels: { safeZ: 20, rapidZ: 3, depth: 18, through: true, stockZ: 0, passDepth: 0 } }),
  ]
  return part
}

const macros = (text: string, id: number) => readMpr(text).macros.filter((m) => m.id === id)

describe('C4 native woodWOP macros', () => {
  const machine = machineWithHorizontal(defaultAppData().machine)
  const part = sixFacePanel()
  const paths = generatePart(part, machine)
  const files = writePartPrograms(part, paths, machine, 'MDF18')
  const front = files[0].text
  const back = files.find((f) => f.side === 'back')?.text ?? ''

  it('writes a front program and a turned-over program for face 6', () => {
    expect(files.map((f) => f.name)).toEqual(['Six-face-panel.mpr', 'Six-face-panel_B.mpr'])
    for (const f of files) {
      const doc = readMpr(f.text)
      expect(doc.errors).toEqual([])
      expect(doc.ended).toBe(true)
    }
  })

  it('vertical drilling on face 1 is BohrVert at the hole centres', () => {
    const v = macros(front, 102).map((m) => [Number(m.values.XA), Number(m.values.YA), Number(m.values.DU), Number(m.values.TI)])
    expect(v.sort()).toEqual([
      [50, 50, 5, 12],
      [550, 50, 5, 12],
    ])
  })

  it('horizontal drilling on faces 2 to 5 is BohrHoriz with the right direction and height', () => {
    const h = macros(front, 103).map((m) => ({ x: Number(m.values.XA), y: Number(m.values.YA), z: Number(m.values.ZA), bm: m.values.BM }))
    expect(h).toHaveLength(4)
    expect(h.find((q) => q.bm === 'YP')).toMatchObject({ x: 100, y: 0, z: 9 })
    expect(h.find((q) => q.bm === 'XM')).toMatchObject({ x: 600, y: 100, z: 9 })
    expect(h.find((q) => q.bm === 'YM')).toMatchObject({ x: 500, y: 400, z: 9 })
    expect(h.find((q) => q.bm === 'XP')).toMatchObject({ x: 0, y: 300, z: 9 })
  })

  it('face 6 holes are only in the turned-over program, mirrored end for end', () => {
    expect(macros(front, 102).some((m) => Number(m.values.DU) === 35)).toBe(false)
    const b = macros(back, 102)
    expect(b).toHaveLength(1)
    expect([Number(b[0].values.XA), Number(b[0].values.YA), Number(b[0].values.DU), Number(b[0].values.TI)]).toEqual([500, 300, 35, 12])
    expect(macros(back, 105)).toHaveLength(0)
    expect(readMpr(back).header.ARTICLE).toContain('turned over')
  })

  it('rectangular pocket is a native Tasche, saw groove is Nuten, profiles are Konturfraesen on native arcs', () => {
    const t = macros(front, 112)
    expect(t).toHaveLength(1)
    expect([Number(t[0].values.XA), Number(t[0].values.YA), Number(t[0].values.LA), Number(t[0].values.BR), Number(t[0].values.TI)]).toEqual([300, 200, 100, 60, 6])
    const n = macros(front, 109)
    expect(n).toHaveLength(1)
    expect([Number(n[0].values.XA), Number(n[0].values.YA), Number(n[0].values.XE), Number(n[0].values.YE), Number(n[0].values.TI)]).toEqual([20, 360, 580, 360, 8])
    const doc = readMpr(front)
    const k = doc.macros.filter((m) => m.id === 105)
    expect(k.length).toBeGreaterThanOrEqual(2)
    const arcs = [...doc.contours.values()].flatMap((c) => c.segs).filter((s) => s.k === 'A')
    expect(arcs.length).toBeGreaterThanOrEqual(2)
    expect(k.map((m) => m.values.RK)).toContain('WRKL')
  })

  it('macros are operator-editable: changing a parameter in the text reads back as the new value', () => {
    const edited = front.replace(/(<112 \\Tasche\\\r\n(?:.*\r\n)*?TI=)"6"/, '$1"9"')
    expect(edited).not.toBe(front)
    expect(Number(macros(edited, 112)[0].values.TI)).toBe(9)
    expect(readMpr(edited).errors).toEqual([])
    for (const m of readMpr(front).macros.filter((x) => [102, 103, 105, 109, 112].includes(x.id))) expect(m.values.MNM ?? m.values.KM).toBeTruthy()
  })
})

describe('C4 job integration behind the export checker', () => {
  function jobData(on: boolean, partFn = sixFacePanel): { job: Job; data: AppData } {
    const data = defaultAppData()
    data.machine = machineWithHorizontal(data.machine)
    data.settings.features = { ...(data.settings.features ?? {}), camMprOutput: on } as AppData['settings']['features']
    const p = partFn()
    p.qty = 2
    const job: Job = { id: 'j1', number: 'J900', name: 'Custom test', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [p] }
    data.jobs = [job]
    return { job, data }
  }

  it('custom parts share the cut list, nesting and labels with cabinets', () => {
    const { job, data } = jobData(false)
    const out = runJob(job, data)
    expect(out.instances).toHaveLength(2)
    expect(out.cutList.find((r) => r.name === 'Six face panel')?.qty).toBe(2)
    expect(out.nest.sheets.flatMap((s) => s.placements)).toHaveLength(2)
    expect(out.labels.filter((l) => l.partName === 'Six face panel')).toHaveLength(2)
  })

  it('off by default: only the cut-out is written and CAM_OUTPUT_OFF blocks MPR export', () => {
    const { job, data } = jobData(false)
    const out = runJob(job, data)
    const off = out.issues.filter((i) => i.code === 'CAM_OUTPUT_OFF')
    expect(off).toHaveLength(2)
    expect(off.every((i) => i.severity === 'error')).toBe(true)
    expect(out.programs[0].ops.every((o) => o.kind === 'contour')).toBe(true)
    expect(mprFiles(job, data, out)).toHaveLength(1)
  })

  it('switched on: native macros land in sheet coordinates and the underside program is added', () => {
    const { job, data } = jobData(true)
    const out = runJob(job, data)
    expect(out.issues.filter((i) => i.code === 'CAM_OUTPUT_OFF')).toEqual([])
    expect(out.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(out.issues.some((i) => i.code === 'CAM_BACKSIDE')).toBe(true)
    const files = mprFiles(job, data, out)
    expect(files.map((f) => f.name)).toEqual(['J900_S01_MDF18.mpr', 'J900_Six-face-panel_B.mpr'])
    const sheet = files[0].text
    expect(readMpr(sheet).errors).toEqual([])
    const pls = out.programs[0].sheet.placements
    const holes = macros(sheet, 102).filter((m) => Number(m.values.DU) === 5)
    expect(holes).toHaveLength(4)
    for (const pl of pls) {
      const expected = pl.rotated ? { x: pl.x + 400 - 50, y: pl.y + 50 } : { x: pl.x + 50, y: pl.y + 50 }
      expect(holes.some((m) => Math.abs(Number(m.values.XA) - expected.x) < 1e-6 && Math.abs(Number(m.values.YA) - expected.y) < 1e-6)).toBe(true)
    }
    expect(macros(sheet, 112)).toHaveLength(2)
    expect(macros(sheet, 103)).toHaveLength(8)
  })

  it('the checker catches a custom operation deeper than the spoilboard allows', () => {
    const deep = () => {
      const p = sixFacePanel()
      const pk = p.ops.find((o) => o.kind === 'pocket')!
      pk.levels.depth = 25
      return p
    }
    const { job, data } = jobData(true, deep)
    const out = runJob(job, data)
    expect(out.issues.some((i) => i.code === 'DEPTH_SPOILBOARD' || i.code === 'DEPTH')).toBe(true)
  })
})
