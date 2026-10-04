import { describe, expect, it } from 'vitest'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import { commit, historyOf, makeEntity, newPart, opInputHash, opState, parsePart, redo, serializePart, undo } from '@/cam/doc'
import { circle, pt, radius, rect, roundedRect } from '@/cam/geom'
import { writePartMpr } from '@/cam/mpr'
import { readMpr } from '@/cam/mprRead'
import { defaultOp, feedsFor, orderByTool, passDepths, resolveTool } from '@/cam/ops'
import { runPost, SAMPLE_TEMPLATE } from '@/cam/post'
import { generateOp, generatePart } from '@/cam/toolpath'
import type { CamPart } from '@/cam/types'

const machine = structuredClone(PLACEHOLDER_MACHINE)

function plateWithHoles(): CamPart {
  const part = newPart({ name: 'P0 plate', length: 400, width: 250, thickness: 19, entities: [] })
  const outline = makeEntity({ t: 'contour', c: rect(0, 0, 400, 250) }, 'outline')
  const holes = [pt(40, 40), pt(360, 40), pt(360, 210), pt(40, 210)].map((c) => makeEntity({ t: 'circle', c, r: 2.5 }, 'holes'))
  part.entities = [outline, ...holes]
  part.outlineId = outline.id
  part.ops = [defaultOp('drill', holes.map((h) => h.id)), defaultOp('profile', [outline.id])]
  return part
}

describe('P0 foundations', () => {
  it('acceptance: rectangle with 4 holes and a profile round-trips through MPR', () => {
    const part = plateWithHoles()
    const paths = generatePart(part, machine)
    expect(paths.map((p) => p.warnings).flat()).toEqual([])
    const text = writePartMpr(part, paths, machine, 'MEL19')
    expect(text.includes('\r\n')).toBe(true)
    expect(/[^\x00-\x7f]/.test(text)).toBe(false)
    const doc = readMpr(text)
    expect(doc.errors).toEqual([])
    expect(doc.header.PARTTYPE).toBe('PART')
    expect(doc.variables.L).toBe('400')
    expect(doc.variables.B).toBe('250')
    expect(doc.variables.D).toBe('19')
    const drills = doc.macros.filter((m) => m.id === 102)
    expect(drills.map((m) => [Number(m.values.XA), Number(m.values.YA), Number(m.values.DU)]).sort()).toEqual(
      [
        [40, 40, 5],
        [360, 40, 5],
        [360, 210, 5],
        [40, 210, 5],
      ].sort(),
    )
    expect(drills.every((m) => m.values.BM === 'LS' && m.values.TI === '13')).toBe(true)
    const mill = doc.macros.filter((m) => m.id === 105)
    expect(mill).toHaveLength(1)
    // climb on an outside contour with a CW spindle: tool left of a clockwise path
    expect(mill[0].values.RK).toBe('WRKL')
    expect(Number(mill[0].values.ZA)).toBeCloseTo(-machine.throughDepth, 6)
    const contour = doc.contours.get(1)!
    const pts = [contour.start, ...contour.segs.map((s) => s.b)]
    expect(pts[0]).toEqual(pts[pts.length - 1])
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([0, 400, 0, 250])
    expect(mill[0].values.EE).toBe(`1:${contour.segs.length}`)
  })

  it('arcs are written as native KA elements and read back with the same centre', () => {
    const part = newPart({ name: 'Arc plate', length: 300, width: 200, entities: [] })
    const o = makeEntity({ t: 'contour', c: roundedRect(0, 0, 300, 200, 30) }, 'outline')
    part.entities = [o]
    part.ops = [defaultOp('profile', [o.id])]
    const text = writePartMpr(part, generatePart(part, machine), machine)
    expect(text).toContain('KA \r\nX=')
    const doc = readMpr(text)
    expect(doc.errors).toEqual([])
    const arcs = doc.contours.get(1)!.segs.filter((s) => s.k === 'A')
    expect(arcs).toHaveLength(4)
    const centres = arcs.map((a) => (a.k === 'A' ? [Math.round(a.c.x), Math.round(a.c.y), Math.round(radius(a))] : [])).sort()
    expect(centres).toEqual(
      [
        [30, 30, 30],
        [270, 30, 30],
        [270, 170, 30],
        [30, 170, 30],
      ].sort(),
    )
  })

  it('document model: undo/redo, file format, associativity flags', () => {
    const part = plateWithHoles()
    let h = historyOf(part)
    const moved = { ...part, entities: part.entities.map((e, i) => (i === 1 && e.g.t === 'circle' ? { ...e, g: { ...e.g, c: pt(50, 50) } } : e)) }
    h = commit(h, moved)
    expect(undo(h).present).toBe(part)
    expect(redo(undo(h)).present).toBe(moved)
    expect(parsePart(serializePart(part)).entities).toHaveLength(5)
    const drill = part.ops[0]
    expect(opState(drill, part, null)).toBe('new')
    drill.builtHash = opInputHash(drill, part, null)
    expect(opState(drill, part, null)).toBe('current')
    expect(opState(drill, moved, null)).toBe('stale')
    expect(opState(drill, { ...part, entities: part.entities.slice(0, 2) }, null)).toBe('broken')
  })

  it('tool library v1: feeds, plunge rules, ordering by tool', () => {
    const tools = structuredClone(machine.tools)
    const r = tools.find((t) => t.type === 'router')!
    Object.assign(r, { feedMode: 'calculated', rpm: 18000, flutes: 2, feedPerTooth: 0.15, centreCutting: false })
    const m = { ...machine, tools, feeds: [] }
    const op = defaultOp('pocket', [], { toolId: r.id })
    expect(feedsFor(op, r, null, m)).toMatchObject({ feed: 5400, source: 'calculated' })
    m.feeds = [{ toolId: r.id, materialId: 'mat-x', rpm: 16000, feed: 4200, plungeFeed: 1500 }]
    expect(feedsFor(op, r, 'mat-x', m)).toMatchObject({ feed: 4200, source: 'material' })
    expect(passDepths(19, 8)).toEqual([6.333333, 12.666667, 19])
    const part = newPart({ entities: [] })
    const sq = makeEntity({ t: 'contour', c: rect(100, 100, 80, 80) }, 'machining')
    part.entities = [sq]
    const pocket = defaultOp('pocket', [sq.id], { toolId: r.id, entry: 'plunge' } as never)
    const tp = generateOp(pocket, { part, machine: m })
    expect(tp.warnings.join(' ')).toMatch(/not centre-cutting/)
    const a = defaultOp('drill')
    const b = defaultOp('profile')
    const ordered = orderByTool([a, b], (o) => resolveTool(o, m) ?? (o.kind === 'drill' ? tools.find((t) => t.type === 'drill-vertical')! : null), [r.number])
    expect(ordered[0]).toBe(b)
  })

  it('generic template post writes arcs and drill cycles', () => {
    const part = newPart({ length: 300, width: 200, entities: [] })
    const o = makeEntity({ t: 'contour', c: roundedRect(0, 0, 300, 200, 30) })
    const h = makeEntity({ t: 'circle', c: pt(150, 100), r: 4 }, 'holes')
    part.entities = [o, h]
    part.ops = [defaultOp('drill', [h.id], { toolId: machine.tools.find((t) => t.type === 'drill-vertical' && t.diameter === 8)?.id ?? null }), defaultOp('profile', [o.id])]
    const out = runPost(SAMPLE_TEMPLATE, 'TEST', generatePart(part, machine))
    expect(out.ext).toBe('nc')
    expect(out.text).toMatch(/G81 X150\.000 Y100\.000/)
    expect(out.text).toMatch(/\nG2 X/)
    expect(out.text.trim().endsWith('%')).toBe(true)
  })

  it('circles become two native half arcs (no tessellation before machining)', () => {
    const c = circle(pt(0, 0), 10)
    expect(c.segs.map((s) => s.k)).toEqual(['A', 'A'])
  })
})
