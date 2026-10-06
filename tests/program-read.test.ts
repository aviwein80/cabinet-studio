import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { writePartPrograms } from '@/cam/mpr'
import { postInput, runPost, SAMPLE_TEMPLATE } from '@/cam/post'
import { isMprText, readGcode, readProgram } from '@/cam/programRead'
import { buildTimeline, cutterOf } from '@/cam/sim'
import { HeightfieldStock } from '@/cam/stock/heightfield'
import { generatePart, simpleMoves, type Toolpath } from '@/cam/toolpath'
import type { CamPart } from '@/cam/types'
import { makeEntity, newPart } from '@/cam/doc'
import { pt, rect } from '@/cam/geom'
import { defaultOp } from '@/cam/ops'
import type { Seg } from '@/cam/geom'
import { offsetChain } from '@/cam/kernel'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import { referenceParts } from './cam-reference'
import { chamferParts, curveParts, edgeParts, faceParts, manualParts, sawParts } from './cam-reference-25d'

const machine = structuredClone(PLACEHOLDER_MACHINE)
const allParts = (): CamPart[] => [...referenceParts(), ...sawParts(), ...faceParts(), ...chamferParts(), ...curveParts(), ...manualParts(), ...edgeParts()]
const pathsOf = (p: CamPart) => generatePart(p, machine, undefined, undefined, true).filter((t) => t.moves.length)
const flat = (tps: Toolpath[]) => tps.flatMap((t) => [...simpleMoves(t.moves)])

type Geo = { k: 'L'; a: { x: number; y: number }; b: { x: number; y: number } } | { k: 'A'; c: { x: number; y: number }; r: number; a0: number; sw: number }

function arcGeo(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, ccw: boolean): Geo {
  const a0 = Math.atan2(a.y - c.y, a.x - c.x)
  let sw = Math.atan2(b.y - c.y, b.x - c.x) - a0
  if (ccw) while (sw <= 1e-12) sw += 2 * Math.PI
  else while (sw >= -1e-12) sw -= 2 * Math.PI
  return { k: 'A', c, r: Math.hypot(a.x - c.x, a.y - c.y), a0, sw }
}
const geoOfSegs = (segs: Seg[]): Geo[] => segs.map((g) => (g.k === 'L' ? { k: 'L', a: g.a, b: g.b } : arcGeo(g.a, g.b, g.c, g.ccw)))
function geoOfMoves(t: Toolpath): Geo[] {
  const out: Geo[] = []
  let at = { x: 0, y: 0 }
  for (const m of simpleMoves(t.moves)) {
    if (m.t === 'feed') out.push({ k: 'L', a: at, b: { x: m.x, y: m.y } })
    else if (m.t === 'arc') out.push(arcGeo(at, { x: m.x, y: m.y }, { x: m.cx, y: m.cy }, m.ccw))
    at = { x: m.x, y: m.y }
  }
  return out
}
/** Exact distance from a point to lines and arcs. */
function distTo(geo: Geo[], q: { x: number; y: number }) {
  let best = Infinity
  for (const g of geo) {
    if (g.k === 'L') {
      const vx = g.b.x - g.a.x
      const vy = g.b.y - g.a.y
      const L = vx * vx + vy * vy
      const t = L ? Math.max(0, Math.min(1, ((q.x - g.a.x) * vx + (q.y - g.a.y) * vy) / L)) : 0
      best = Math.min(best, Math.hypot(g.a.x + vx * t - q.x, g.a.y + vy * t - q.y))
      continue
    }
    let u = (Math.atan2(q.y - g.c.y, q.x - g.c.x) - g.a0) / (2 * Math.PI)
    u -= Math.floor(u)
    const along = g.sw > 0 ? u * 2 * Math.PI : (1 - u) * 2 * Math.PI
    if (along <= Math.abs(g.sw) + 1e-9 || u === 0) best = Math.min(best, Math.abs(Math.hypot(q.x - g.c.x, q.y - g.c.y) - g.r))
    const e = (ang: number) => Math.hypot(g.c.x + g.r * Math.cos(ang) - q.x, g.c.y + g.r * Math.sin(ang) - q.y)
    best = Math.min(best, e(g.a0), e(g.a0 + g.sw))
  }
  return best
}

/** Carve toolpaths into a fresh heightfield of the part, as the simulator does. */
function carved(part: Pick<CamPart, 'length' | 'width' | 'thickness'>, tps: Toolpath[], cell = 0.5) {
  const tl = buildTimeline(tps)
  const s = new HeightfieldStock(part.length, part.width, part.thickness, cell)
  for (const seg of tl.segs) if (seg.kind !== 'rapid' && !seg.side) s.carve(seg.a, seg.b, seg.cutter)
  return { tl, s }
}

describe('M2.10c G-code reads back', () => {
  it('every reference part: our G-code read back gives the same moves, tools, feeds and names; posted again, the same text', () => {
    let named = 0
    let lines = 0
    let moves = 0
    for (const p of allParts()) {
      const tps = pathsOf(p)
      const text = runPost(SAMPLE_TEMPLATE, p.name, tps).text
      const r = readGcode(text, { machine })
      expect(r.errors, p.id).toEqual([])
      // the post's end block lifts to Z50 after the spindle stops: one more (real) move at the end
      const lastPath = r.toolpaths[r.toolpaths.length - 1]
      const lift = lastPath.moves.pop()
      expect(lift, p.id).toMatchObject({ t: 'rapid', z: 50 })
      if (!lastPath.moves.length) r.toolpaths.pop() // a part with no machining: the lift is all there is
      // one toolpath per tool change: every operation with a tool starts with one (an operation without a
      // tool, such as holes drilled by diameter, joins the one before; text posts refuse to write those)
      if (tps.every((t) => t.tool)) {
        expect(r.toolpaths.map((t) => [t.name, t.tool?.number]), p.id).toEqual(tps.map((t) => [t.name, t.tool?.number]))
        named++
      }
      const a = flat(tps)
      const b = flat(r.toolpaths)
      expect(b.length, p.id).toBe(a.length)
      a.forEach((m, i) => {
        const n = b[i]
        expect(n.t, `${p.id} move ${i}`).toBe(m.t)
        for (const k of ['x', 'y', 'z'] as const) expect(Math.abs(n[k] - m[k]), `${p.id} move ${i} ${k}`).toBeLessThanOrEqual(0.0005 + 1e-9)
        if (m.t === 'arc' && n.t === 'arc') {
          expect(n.ccw).toBe(m.ccw)
          expect(Math.hypot(n.cx - m.cx, n.cy - m.cy)).toBeLessThanOrEqual(0.0015)
        }
        if (m.t === 'drill' && n.t === 'drill') expect([n.r, n.peck]).toEqual([Math.round(m.r * 1000) / 1000, Math.round(m.peck * 1000) / 1000])
      })
      // the feed of every move is the same
      const fa = postInput('x', tps).ops.flatMap((o) => o.moves.map((m) => ('f' in m ? m.f : null)))
      const fb = postInput('x', r.toolpaths).ops.flatMap((o) => o.moves.map((m) => ('f' in m ? m.f : null)))
      expect(fb, p.id).toEqual(fa)
      // and the program written from what was read is the program that was read
      // (-0.000 and 0.000 are the same number: tiny negatives read back as plain zero)
      const z0 = (t: string) => t.replace(/-0\.000(?![0-9])/g, '0.000')
      if (tps.every((t) => t.tool)) expect(z0(runPost(SAMPLE_TEMPLATE, p.name, r.toolpaths).text), p.id).toBe(z0(text))
      lines += r.lines
      moves += b.length
    }
    expect(named).toBeGreaterThan(30)
    process.stdout.write(`  [read back] 44 reference programs, ${lines} lines, ${moves} moves: same moves and feeds (${named} with every operation's tool and name); written again byte-identical\n`)
  }, 120_000)

  it('it simulates: the same cutting time, lengths and material left as the toolpaths it came from', () => {
    const report: string[] = []
    // parts whose every operation has one tool (holes drilled by diameter carry no tool in G-code)
    const parts = allParts().filter((p) => pathsOf(p).every((t) => t.tool) && pathsOf(p).length)
    expect(parts.length).toBeGreaterThan(15)
    for (const p of parts.slice(0, 8)) {
      const tps = pathsOf(p)
      const back = readGcode(runPost(SAMPLE_TEMPLATE, p.name, tps).text, { machine }).toolpaths
      const A = carved(p, tps)
      const B = carved(p, back)
      expect(B.tl.ops.length).toBe(A.tl.ops.length)
      // coordinates are written to 0.001 mm: lengths agree to 10 ppm
      expect(Math.abs(B.tl.cutLength - A.tl.cutLength) / A.tl.cutLength).toBeLessThan(1e-5)
      // the time differs only by drilling dwells, which the template post does not write
      expect(Math.abs(B.tl.total - A.tl.total) / A.tl.total).toBeLessThan(0.01)
      const va = A.s.removedVolume()
      const vb = B.s.removedVolume()
      expect(va).toBeGreaterThan(0)
      expect(Math.abs(vb - va) / va, p.id).toBeLessThan(0.001)
      report.push(`${p.id} ${(va / 1000).toFixed(1)} cm³`)
    }
    process.stdout.write(`  [read back] simulated removed volume equal within 0.1 %: ${report.join(', ')}\n`)
  }, 120_000)

  it('reads hand-written G-code: inches, incremental moves, R arcs both ways, absolute centres, canned cycles with repeats, comments', () => {
    const r = readGcode(
      [
        '%',
        'O1000 (TEST)'.replace('O1000 ', ''),
        'N10 G20 G90 G17 ; inch',
        'N20 T2 M6 (T2 small router)',
        'N30 S12000 M3',
        '(Square)',
        'G0 X1 Y1 Z0.5',
        'G1 Z-0.25 F20',
        'G91 G1 X2 F100',
        'Y2',
        'X-2',
        'Y-2',
        'G90',
        '(Arcs)',
        'G0 Z0.5',
        'X4 Y1',
        'G1 Z-0.1 F20',
        'G2 X6 Y1 R1 F100',
        'G3 X4 Y1 R-1',
        'G90.1 G2 X5 Y2 I5 J1',
        'G0 Z1',
        '(Holes)',
        'G99 G83 X1 Y4 Z-0.5 R0.1 Q0.2 F10',
        'X2',
        'X3 Y4.5',
        'G80',
        'M5',
        'M30',
        'G0 X99',
        '%',
      ].join('\n'),
    )
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual(['Lines after the program end (M30 / M2) were not read (from line 29).'])
    expect(r.toolpaths).toHaveLength(1)
    const tp = r.toolpaths[0]
    expect(tp.name).toBe('Square')
    expect(tp.tool?.number).toBe(PLACEHOLDER_MACHINE.tools.find((t) => t.number === 2)?.number)
    expect(tp.feeds.rpm).toBe(12000)
    const m = [...simpleMoves(tp.moves)]
    const xy = (i: number) => [Math.round(m[i].x * 1000) / 1000, Math.round(m[i].y * 1000) / 1000, Math.round(m[i].z * 1000) / 1000]
    expect(xy(0)).toEqual([25.4, 25.4, 12.7])
    expect(m[1]).toMatchObject({ t: 'feed', f: 'plunge' })
    expect(xy(2)).toEqual([76.2, 25.4, -6.35])
    expect(xy(3)).toEqual([76.2, 76.2, -6.35])
    expect(xy(5)).toEqual([25.4, 25.4, -6.35])
    // feeds: 100 in/min cutting = 2540 mm/min, 20 in/min plunging = 508 mm/min
    expect(tp.feeds).toMatchObject({ feed: 2540, plunge: 508 })
    // R1 clockwise from (4,1) to (6,1): centre (5,1) ... G3 R-1 back: the long way round (centre (5,1) again)
    const arcs = m.filter((x) => x.t === 'arc')
    expect(arcs).toHaveLength(3)
    expect(arcs.map((a) => (a.t === 'arc' ? [Math.round(a.cx / 0.0254) / 1000, Math.round(a.cy / 0.0254) / 1000, a.ccw] : null))).toEqual([
      [5, 1, false],
      [5, 1, true],
      [5, 1, false],
    ])
    // the canned cycle repeats at each new X/Y; G99 lifts to R
    const drills = m.filter((x) => x.t === 'drill')
    expect(drills.map((d) => (d.t === 'drill' ? [Math.round(d.x * 10) / 10, Math.round(d.y * 10) / 10, Math.round(d.z * 100) / 100, Math.round(d.r * 100) / 100, Math.round(d.peck * 100) / 100] : null))).toEqual([
      [25.4, 101.6, -12.7, 2.54, 5.08],
      [50.8, 101.6, -12.7, 2.54, 5.08],
      [76.2, 114.3, -12.7, 2.54, 5.08],
    ])
    expect(tp.intents.filter((i) => i.k === 'vdrill')).toHaveLength(3)
    // it simulates
    const { tl, s } = carved({ length: 200, width: 150, thickness: 19 }, r.toolpaths, 1)
    expect(tl.total).toBeGreaterThan(0)
    expect(s.heightAt(50.8, 101.6)).toBeLessThan(-12)
  })

  it('splits at every tool change and names each part from its comment', () => {
    const [t1, t2, t3] = machine.tools
    const r = readGcode([`T${t1.number} M6`, '(First)', 'S10000 M3', 'G0 X0 Y0 Z5', 'G1 Z-1 F500', 'G1 X10 F1000', `T${t2.number} M6`, 'G0 Z5', 'G1 X20 Y0 Z-2 F800', `T${t3.number}`, 'M6', 'G0 Z10', 'T999 M6', 'G0 Z11'].join('\n'), { machine })
    expect(r.toolpaths.map((t) => [t.name, t.tool?.number ?? null, t.moves.length])).toEqual([
      ['First', t1.number, 3],
      [`T${t2.number} ${t2.name}`, t2.number, 2],
      [`T${t3.number} ${t3.name}`, t3.number, 1],
      ['T999', null, 1],
    ])
    expect(r.toolpaths[3].warnings).toEqual(['Tool 999 is not in the tool table; drawn with a 6 mm cutter.'])
    // without M6 anywhere, a T word changes the tool
    expect(readGcode(['T1', 'G0 X0 Y0 Z5', 'T2', 'G0 X5'].join('\n')).toolpaths).toHaveLength(2)
  })

  it('refuses what it would draw wrongly, and says what it ignores', () => {
    const bad = readGcode(['G18 G2 X10 Z-5 I5 K0 F100', 'G17 G92 X0 Y0', 'G91 G81 X5 Y5 Z-3 R1 F100', 'G90 G80 G2 X10 Y0 F100', 'G0 X5 Y5 Q'].join('\n'))
    expect(bad.errors).toEqual([
      'Line 1: arcs in the XZ plane (G18) are not supported.',
      'Line 2: G92 shifts the coordinate system; not supported.',
      'Line 3: incremental drilling cycles (G91 with G81) are not supported.',
      'Line 4: an arc needs I/J or R.',
      'Line 5: cannot read "Q".',
    ])
    expect(readGcode('X10 Y5').errors).toEqual(['Line 1: coordinates without a motion (G0/G1/G2/G3).'])
    const warn = readGcode(['G54 G41 D1', 'G0 X0 Y0 Z5', 'G1 X10', 'G2 X20 Y0 I5 J0 F100', 'G28', 'G123'].join('\n'))
    expect(readGcode(['G0 X0 Y0', 'G2 X20 Y0 I5 J0 F100'].join('\n')).warnings).toEqual(["Line 2: the arc's end is 10.000 mm off its circle."])
    expect(warn.errors).toEqual([])
    expect(warn.warnings).toEqual([
      'Line 1: work offset G54 is ignored; all coordinates are drawn from one origin.',
      'Line 1: cutter radius compensation (G41) is done by the controller; the backplot follows the programmed line, which is off by the tool radius.',
      'Line 3: a cutting move without a feed rate (F).',
      'Line 5: G28 (machine position) moves are not drawn.',
      'Line 6: G123 is not known to this reader; ignored.',
    ])
    expect(readGcode('hello world').errors[0]).toMatch(/cannot read/)
    expect(readGcode('').errors).toEqual(['No moves found: is this a G-code program?'])
  })
})

describe('M2.10c our own MPR reads back', () => {
  it('reference parts: holes where the toolpaths drill them; contour milling on the tool-centre path once the radius correction is applied', () => {
    let drills = 0
    let checked = 0
    let worst = 0
    let worstAt = ''
    for (const p of referenceParts()) {
      const tps = pathsOf(p)
      const [front] = writePartPrograms(p, tps, machine, 'MEL19', { withCutout: false })
      expect(isMprText(front.text)).toBe(true)
      const r = readProgram(front.text, { machine })
      expect(r.format).toBe('mpr')
      expect(r.errors, p.id).toEqual([])
      expect(r.stock).toEqual({ length: p.length, width: p.width, thickness: p.thickness, fromProgram: true })
      // every vertical hole of the toolpaths (front side) is a drill move at the same place and depth
      const want = tps.flatMap((t) => t.intents.filter((i) => i.k === 'vdrill' && !i.back)).map((i) => (i.k === 'vdrill' ? `${i.x.toFixed(3)},${i.y.toFixed(3)},${i.depth.toFixed(3)}` : '')).sort()
      const got = r.toolpaths.flatMap((t) => t.moves.filter((m) => m.t === 'drill')).map((m) => (m.t === 'drill' ? `${m.x.toFixed(3)},${m.y.toFixed(3)},${(-m.z).toFixed(3)}` : '')).sort()
      expect(got, p.id).toEqual(want)
      drills += got.length
      // contour milling: the tool centre woodWOP follows. For a profile that is the toolpath itself; for
      // pockets and grooves the MPR holds the native contour passes (the toolpath's intents), which is
      // what woodWOP cuts, so the read-back is compared with those
      const ref: Geo[] = []
      for (const t of tps) {
        if (t.kind === 'profile') ref.push(...geoOfMoves(t))
        else for (const i of t.intents) if (i.k === 'contour') ref.push(...geoOfSegs(i.rk === 'NOWRK' ? i.segs : offsetChain({ segs: i.segs, closed: i.closed }, ((i.tool?.diameter ?? 0) / 2) * (i.rk === 'WRKL' ? 1 : -1)).segs))
      }
      for (const rt of r.toolpaths.filter((t) => t.kind === 'profile'))
        for (const s of buildTimeline([rt]).segs)
          if (s.kind === 'cut') {
            const d = distTo(ref, s.b)
            if (d > worst) worstAt = `${p.id} (${s.b.x.toFixed(2)}, ${s.b.y.toFixed(2)})`
            worst = Math.max(worst, d)
            // MPR arcs are given by their ends and radius only, to 4 decimals. Exact half circles are read
            // exactly; arcs just under a half circle (the writer splits longer arcs in two) keep their centre
            // only to about 0.05 mm on small radii (measured 0.054 mm on ref10's 9 mm rings; see the report)
            expect(d, `${p.id} ${rt.name} at ${s.b.x.toFixed(3)},${s.b.y.toFixed(3)}`).toBeLessThan(0.06)
            checked++
          }
      // and its depths are the passes' depths
      const depths = new Set(tps.flatMap((t) => t.intents.flatMap((i) => (i.k === 'contour' ? i.passes.map((ps) => Math.round(ps.depth * 1000) / 1000) : []))))
      for (const rt of r.toolpaths.filter((t) => t.kind === 'profile')) for (const m of rt.moves) if (m.t === 'feed' && m.f === 'cut') expect(depths.has(Math.round(-m.z * 1000) / 1000), `${p.id} depth ${-m.z}`).toBe(true)
    }
    expect(drills).toBeGreaterThan(25)
    expect(checked).toBeGreaterThan(500)
    process.stdout.write(`  [read back] MPR: ${drills} holes in place; ${checked} contour points, worst ${worst.toFixed(4)} mm from the tool-centre path, at ${worstAt}\n`)
  })

  it('full circles (two exact half circles in the MPR) read back exactly round', () => {
    const p = newPart({ name: 'Round window', length: 300, width: 300, thickness: 19, entities: [] })
    const o = makeEntity({ t: 'contour', c: rect(0, 0, 300, 300) }, 'outline')
    const hole = makeEntity({ t: 'circle', c: pt(150.0003, 149.9997), r: 80.00007 }, 'machining')
    p.entities = [o, hole]
    p.outlineId = o.id
    p.ops = [defaultOp('profile', [hole.id], { side: 'inside', toolId: 't101' } as never)]
    const tps = pathsOf(p)
    const r = readProgram(writePartPrograms(p, tps, machine, 'MEL19', { withCutout: false })[0].text, { machine })
    const rt = r.toolpaths.find((t) => t.kind === 'profile')!
    const arcs = rt.moves.filter((m) => m.t === 'arc')
    expect(arcs.length).toBeGreaterThanOrEqual(2)
    for (const a of arcs) if (a.t === 'arc') expect(Math.hypot(a.cx - 150.0003, a.cy - 149.9997)).toBeLessThan(2e-4)
  })

  it('the sample job\'s sheet programs read back and simulate', () => {
    const dir = path.resolve(import.meta.dirname, '../examples/sample-job/mpr')
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mpr'))
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) {
      const text = fs.readFileSync(path.join(dir, f), 'latin1')
      const r = readProgram(text, { machine })
      expect(r.errors, f).toEqual([])
      expect(r.stock.fromProgram).toBe(true)
      const vdrills = (text.match(/^<102 /gm) ?? []).length
      expect(r.toolpaths.flatMap((t) => t.moves.filter((m) => m.t === 'drill')).length, f).toBe(vdrills)
      const contours = (text.match(/^<105 /gm) ?? []).length
      expect(contours).toBeGreaterThan(0)
      const { tl, s } = carved(r.stock, r.toolpaths, 2)
      expect(tl.cutLength).toBeGreaterThan(0)
      expect(s.removedVolume()).toBeGreaterThan(0)
      for (const tp of r.toolpaths) expect(cutterOf(tp).r).toBeGreaterThan(0)
    }
  }, 60_000)
})
