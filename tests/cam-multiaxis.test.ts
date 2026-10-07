/**
 * M3.5a simultaneous 5-axis core (5AX-02, 5AX-03, TOOL-07, NEW-26): the `MultiAxisEngine`
 * interface, the stub ("not licensed"), the preview / test engine, the toolpath IR with a tool
 * direction on every move, our checks on what an engine returns (unit axes, reversed and both-ways
 * cutting, the independent gouge check), barrel and form tools, part format 10.
 *
 * No licensed engine is installed or bought: the test engine is the preview engine's code declared
 * licensed, standing in for one.
 */
import { describe, expect, it } from 'vitest'
import { CAM_FILE_VERSION, makeEntity, migratePart, opInputHash, parsePart, serializePart } from '@/cam/doc'
import { angleDeg, axisAt, clampTilt, cross, dot, len, smoothAxes, sub, tiltDeg, unit, type V3 } from '@/cam/multiaxis/axis'
import { checkAxisGouge } from '@/cam/multiaxis/check'
import { NOT_LICENSED, STUB_ENGINE } from '@/cam/multiaxis/engine'
import { fakeEngine, PREVIEW_ENGINE } from '@/cam/multiaxis/fake'
import { cutterOutlineOf, engineTool } from '@/cam/multiaxis/request'
import { axisNodes, axisStats, engineMoveProblems, withDirection } from '@/cam/multiaxis/result'
import { DEFAULT_TOOL_AXIS, defaultOp } from '@/cam/ops'
import { cutterOf, cutterZ } from '@/cam/sim'
import { TriDexelStock } from '@/cam/stock/tridexel'
import { barrelForm, barrelWidest, cuttingOutline, formProblems, outlinePoints, outlineRadius, sweptOutline } from '@/cam/tools/form'
import { generateOp, GOUGE_TOL, MULTIAXIS_NO_MPR, type Move, type Toolpath } from '@/cam/toolpath'
import type { CamOp, MultiAxisOp, ToolAxisControl } from '@/cam/types'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import { cutterOutline } from '@/core/machineModel'
import { squareEnd } from '@/core/machining'
import { confirmOp, newOpDefaults, opUnconfirmed, toolUnconfirmed } from '@/core/confirm'
import { formText, parseFormText } from '@/core/toolData'
import { expectGolden3d, finishSetup, surfaceMesh } from './finish3d-setup'
import { BARREL, blockPart5, curve3, cutPoints, FORM, gen5, hemiPart, latitude, TEST_ENGINE, testMachine } from './multiaxis-fixtures'

const ax = (patch: Partial<ToolAxisControl>): ToolAxisControl => ({ ...DEFAULT_TOOL_AXIS, ...patch })
const isUnit = (a: readonly number[]) => Math.abs(len(a) - 1) < 1e-9

describe('M3.5 the 5-axis engine interface: stub, preview and test engine', () => {
  it('the stub answers "5-axis engine not licensed" and nothing is calculated', () => {
    const { part, op } = hemiPart([], { toolId: 't105' })
    expect(op.engine).toBe('')
    const tp = gen5(part, op, { engine: null })
    expect(tp.moves).toHaveLength(0)
    expect(tp.warnings[0]).toBe(NOT_LICENSED)
    expect(tp.warnings[0]).toMatch(/^5-axis engine not licensed/)
    expect(tp.noOutput).toBe(MULTIAXIS_NO_MPR)
    expect(tp.multiAxis).toMatchObject({ engine: '', licensed: false, preview: false })
    expect(STUB_ENGINE.generate({} as never)).toEqual({ status: 'not-licensed', message: NOT_LICENSED })
  })

  it('an unknown engine name falls back to the shop engine (the stub) with a note', () => {
    const { part, op } = hemiPart([], { toolId: 't105', engine: 'someone-else' })
    const tp = gen5(part, op, { engine: null })
    expect(tp.moves).toHaveLength(0)
    expect(tp.warnings.join(' ')).toMatch(/not installed/)
    expect(tp.warnings.join(' ')).toMatch(/not licensed/)
  })

  it('the preview engine makes a toolpath for the simulator only, marked as such', () => {
    const { part, op } = hemiPart([], { toolId: 't105', engine: 'preview', stepover: 4, axis: ax({ maxTilt: 30 }) })
    const tp = gen5(part, op, { engine: null })
    expect(axisNodes(tp.moves).length).toBeGreaterThan(100)
    expect(tp.multiAxis).toMatchObject({ engine: 'preview', licensed: false, preview: true, strategy: 'surface' })
    expect(tp.warnings.join(' ')).toMatch(/preview engine: for the simulator only, never written/)
    expect(tp.noOutput).toBe(MULTIAXIS_NO_MPR)
    expect(PREVIEW_ENGINE.info).toMatchObject({ id: 'preview', licensed: false, preview: true })
  })

  it('a licensed engine plugs into the shop slot; every move it returns carries a unit tool direction', () => {
    const { part, op } = hemiPart([], { toolId: 't105', stepover: 4 })
    const tp = gen5(part, op)
    expect(tp.multiAxis).toMatchObject({ engine: 'test', licensed: true, preview: false })
    expect(engineMoveProblems(tp.moves)).toEqual([])
    let n = 0
    for (const m of tp.moves) {
      if (m.t === 'poly') {
        expect(m.axes!.length).toBe(m.pts.length)
        for (let i = 0; i < m.axes!.length; i += 3) expect(isUnit([m.axes![i], m.axes![i + 1], m.axes![i + 2]])).toBe(true)
        n += m.pts.length / 3
      } else if (m.t === 'rapid' || m.t === 'feed') {
        expect(isUnit(m.a!)).toBe(true)
        n++
      } else throw new Error('arcs or drill cycles in a 5-axis toolpath')
    }
    expect(n).toBeGreaterThan(100)
    // the request is plain data the engine can take anywhere (structured clone)
    expect(() => structuredClone(tp)).not.toThrow()
  })

  it('what an engine returns is checked: no direction, not unit, arcs, nothing', () => {
    expect(engineMoveProblems([])).toEqual(['it returned no moves'])
    expect(engineMoveProblems([{ t: 'feed', x: 0, y: 0, z: 0, f: 'cut' }])).toEqual(['a move has no tool direction'])
    expect(engineMoveProblems([{ t: 'rapid', x: 0, y: 0, z: 0, a: [0, 0, 2] }])).toEqual(['a tool direction is not a unit vector'])
    expect(engineMoveProblems([{ t: 'arc', x: 0, y: 0, z: 0, cx: 1, cy: 0, ccw: true, f: 'cut' }])[0]).toMatch(/arcs or drill cycles/)
    expect(engineMoveProblems([{ t: 'poly', pts: new Float64Array([0, 0, 0]), f: 'cut' }])).toEqual(['a move has no tool direction'])
    // a bad engine's toolpath is refused with the reason, no moves kept
    const bad = { info: { ...TEST_ENGINE.info, id: 'bad', name: 'Bad engine' }, generate: () => ({ status: 'ok' as const, moves: [{ t: 'feed', x: 1, y: 2, z: 3, f: 'cut' } as Move], warnings: [] }) }
    const { part, op } = hemiPart([], { toolId: 't105' })
    const tp = gen5(part, op, { engine: bad })
    expect(tp.moves).toHaveLength(0)
    expect(tp.warnings.join(' ')).toMatch(/Bad engine returned a toolpath that cannot be used: a move has no tool direction/)
  })

  it('refuses tools that cannot tilt or are not for 5-axis work, and other faces', () => {
    const { part, op } = hemiPart([], {})
    const m = testMachine()
    expect(gen5(part, { ...op, toolId: 't201' }, { machine: m }).warnings[0]).toMatch(/drill block, which cannot tilt/)
    expect(gen5(part, { ...op, toolId: 't140' }, { machine: m }).warnings[0]).toMatch(/saw unit, which cannot tilt/)
    expect(gen5(part, { ...op, toolId: 't108' }, { machine: m }).warnings[0]).toMatch(/lollipop\) is not used for 5-axis/)
    expect(gen5(part, { ...op, toolId: 't105', face: 2 }, { machine: m }).warnings[0]).toMatch(/set it to face 1/)
    expect(gen5(part, { ...op, toolId: 't105', modelId: '' }, { machine: m }).warnings[0]).toMatch(/Pick the 3D model/)
    // roughing is not offered by the preview / test engine
    expect(gen5(part, { ...op, toolId: 't105', strategy: 'rough' }, { machine: m }).warnings[0]).toMatch(/does not do multi-axis roughing/)
  })
})

describe('M3.5 tool-axis rules (5AX-02)', () => {
  const p: V3 = [10, 20, -5]
  const t: V3 = [1, 0, 0]
  it('through a point and away from a point: the axis line passes through it', () => {
    const P = { x: 40, y: 40, z: 100 }
    const a = axisAt(ax({ mode: 'through-point', point: P }), { p, t, n: null, share: 0 }, null)
    // the point lies on the line from the tip along the axis
    expect(len(cross(sub([P.x, P.y, P.z], p), a))).toBeLessThan(1e-9)
    expect(dot(sub([P.x, P.y, P.z], p), a)).toBeGreaterThan(0)
    const b = axisAt(ax({ mode: 'away-from-point', point: { x: 40, y: 40, z: -100 } }), { p, t, n: null, share: 0 }, null)
    expect(len(cross(sub([40, 40, -100], p), b))).toBeLessThan(1e-9)
    expect(dot(sub([40, 40, -100], p), b)).toBeLessThan(0)
  })
  it('through a line: the axis meets the line square to it', () => {
    const c = ax({ mode: 'through-line', point: { x: 0, y: 0, z: 80 }, dir: { x: 1, y: 1, z: 0 } })
    const a = axisAt(c, { p, t, n: null, share: 0 }, null)
    // closest point of the line to the tip, then the axis points at it
    const d = unit([1, 1, 0])
    const Q = [0 + d[0] * dot(sub(p, [0, 0, 80]), d), d[1] * dot(sub(p, [0, 0, 80]), d), 80]
    expect(angleDeg(a, unit(sub(Q, p)))).toBeLessThan(1e-9)
    expect(Math.abs(dot(a, d))).toBeLessThan(1e-12)
    const b = axisAt({ ...c, mode: 'away-from-line' }, { p, t, n: null, share: 0 }, null)
    expect(angleDeg(a, b)).toBeCloseTo(180, 9)
  })
  it('fixed tilt, surface normal with lead and tilt, square to a curve', () => {
    const f = axisAt(ax({ mode: 'fixed', tilt: 30, toward: 90 }), { p, t, n: null, share: 0 }, null)
    expect(f[0]).toBeCloseTo(0, 12)
    expect(f[1]).toBeCloseTo(0.5, 12)
    expect(f[2]).toBeCloseTo(Math.cos(Math.PI / 6), 12)
    const n = unit([0, -0.3, 1])
    const s = axisAt(ax({ mode: 'surface-normal', lead: 0, tilt: 0 }), { p, t, n, share: 0 }, null)
    expect(angleDeg(s, n)).toBeLessThan(1e-9)
    // lead 10° (top forwards along travel), tilt 5° (top to the left of travel)
    const lt = axisAt(ax({ mode: 'surface-normal', lead: 10, tilt: 5 }), { p, t, n: [0, 0, 1], share: 0 }, null)
    expect(lt[0]).toBeCloseTo(Math.sin((10 * Math.PI) / 180) * Math.cos((5 * Math.PI) / 180), 12)
    expect(lt[1]).toBeCloseTo(Math.sin((5 * Math.PI) / 180), 12)
    // square to a climbing curve, as upright as it can be
    const tc = unit([1, 0, 1])
    const cn = axisAt(ax({ mode: 'curve-normal' }), { p, t: tc, n: null, share: 0 }, null)
    expect(Math.abs(dot(cn, tc))).toBeLessThan(1e-12)
    expect(cn[1]).toBeCloseTo(0, 12)
    expect(cn[2]).toBeGreaterThan(0)
  })
  it('towards a guide curve, by share of length', () => {
    const guide = { curve: [[0, 0, 50], [100, 0, 50]] as [number, number, number][], L: [0, 100] }
    const a = axisAt(ax({ mode: 'guide' }), { p: [25, 10, 0], t, n: null, share: 0.25 }, guide)
    expect(angleDeg(a, unit([0, -10, 50]))).toBeLessThan(1e-9)
  })
  it('tilt limit and axis smoothing', () => {
    const c = clampTilt(unit([1, 1, 0.2]), 40)
    expect(c.clamped).toBe(true)
    expect(tiltDeg(c.a)).toBeCloseTo(40, 9)
    expect(c.a[0]).toBeCloseTo(c.a[1], 12)
    expect(clampTilt([0, 0, 1], 0).clamped).toBe(false)
    // a sudden 60° turn spread to at most 2° per mm
    const pts: V3[] = Array.from({ length: 101 }, (_, i) => [i, 0, 0])
    const axes: V3[] = pts.map((_, i) => (i < 50 ? [0, 0, 1] : unit([Math.sin(Math.PI / 3), 0, Math.cos(Math.PI / 3)])))
    smoothAxes(pts, axes, 2)
    let worst = 0
    for (let i = 1; i < axes.length; i++) worst = Math.max(worst, angleDeg(axes[i - 1], axes[i]))
    expect(worst).toBeLessThanOrEqual(2 + 1e-9)
    expect(tiltDeg(axes[0])).toBeLessThan(1e-9)
    expect(tiltDeg(axes[100])).toBeCloseTo(60, 6)
  })
})

describe('M3.5 strategies through the test engine (5AX-02, 5AX-03)', () => {
  it('5-axis cut along a 3D curve: tip `depth` below the curve along the tool, tool on the surface normal', () => {
    const lat = latitude(15)
    // (no axis smoothing: the sphere's normal turns 2.9° per mm round this latitude)
    const { part, op } = hemiPart([curve3('lat', lat)], { geometry: ['lat'], toolId: 't106', maxTurn: 0, axis: ax({ mode: 'surface-normal', maxTilt: 90 }), levels: { safeZ: 20, rapidZ: 3, depth: 0.5, through: false, stockZ: 0, passDepth: 0 } }, 'curve')
    const tp = gen5(part, op)
    expect(tp.warnings.filter((w) => !/Gouge check/.test(w))).toEqual([])
    const pts = cutPoints(tp)
    expect(pts.length).toBeGreaterThan(90)
    let worstNormal = 0
    let worstDepth = 0
    for (const { p, a } of pts) {
      // the sphere's normal at the curve point (tip + depth along the axis)
      const q = [p[0] + a[0] * 0.5, p[1] + a[1] * 0.5, p[2] + a[2] * 0.5]
      const n = unit(sub(q, [40, 40, -20]))
      worstNormal = Math.max(worstNormal, angleDeg(a, n))
      // the curve point is on the drive curve (the polyline round the latitude)
      let d = Infinity
      for (let i = 1; i < lat.length; i++) {
        const ab = sub(lat[i], lat[i - 1])
        const k = Math.max(0, Math.min(1, dot(sub(q, lat[i - 1]), ab) / dot(ab, ab)))
        d = Math.min(d, len(sub(q, [lat[i - 1][0] + ab[0] * k, lat[i - 1][1] + ab[1] * k, lat[i - 1][2] + ab[2] * k])))
      }
      worstDepth = Math.max(worstDepth, d)
    }
    // the normal from the faceted model (a 0.5 mm grid on slopes up to 49°: its facets themselves lean up
    // to about 2° off the sphere) within 2.5°; the tip exactly 0.5 below the curve
    expect(worstNormal).toBeLessThan(2.5)
    expect(worstDepth).toBeLessThan(1e-9)
    console.log(`  [5-axis curve] latitude R15 on the hemisphere, T106 Ø3 ball: ${pts.length} points, tool within ${worstNormal.toFixed(3)}° of the sphere's normal, tip 0.5 mm below the curve within ${worstDepth.toExponential(1)} mm`)
    expectGolden3d('multiaxis-curve-latitude', tp)
  })

  it('on a flat leaning face the tool stands exactly on its normal (no facets to blur it)', () => {
    // a face leaning 25° (rising along +x), as a mesh model, and a straight curve across it
    const tl = (25 * Math.PI) / 180
    const zAt = (x: number) => -40 + Math.tan(tl) * x
    const mesh = { positions: Float32Array.from([0, 0, zAt(0), 80, 0, zAt(80), 80, 80, zAt(80), 0, 80, zAt(0)]), indices: Uint32Array.from([0, 1, 2, 0, 2, 3]) }
    const { part } = hemiPart([], {})
    const plane = { ...part, models: [{ ...part.models![0], blob: 'plane', place: { ...part.models![0].place, at: [0, 0, zAt(80)] as [number, number, number] } }], entities: [curve3('c', [[10, 10, zAt(10)], [70, 70, zAt(70)]])] }
    const op = { ...hemiPart([], {}).op, strategy: 'curve' as const, geometry: ['c'], toolId: 't106', maxTurn: 0, axis: ax({ mode: 'surface-normal', maxTilt: 90 }) }
    const tp = generateOp(op, { part: plane, machine: testMachine(), meshes: new Map([['plane', mesh]]), engine: TEST_ENGINE })
    const n = unit([-Math.sin(tl), 0, Math.cos(tl)])
    const pts = cutPoints(tp)
    expect(pts.length).toBeGreaterThan(80)
    for (const { a } of pts) expect(angleDeg(a, n)).toBeLessThan(1e-4)
  })

  it('swarf: the side of a flat end mill lies on a leaning wall, the tool along it', () => {
    const lean = (20 * Math.PI) / 180
    const dy = 30 * Math.tan(lean)
    const bottom = curve3('b', [[10, 20, -30], [60, 20, -30], [110, 20, -30]])
    const top = curve3('t', [[10, 20 + dy, 0], [110, 20 + dy, 0]])
    const { part, op } = blockPart5([bottom, top], { geometry: ['b'], top: ['t'], toolId: 't102', side: 'right', levels: { safeZ: 20, rapidZ: 3, depth: 0, through: false, stockZ: 0, passDepth: 0 } }, 'swarf')
    const tp = gen5(part, op)
    expect(tp.warnings).toEqual([])
    const pts = cutPoints(tp)
    expect(pts.length).toBeGreaterThanOrEqual(100)
    // the wall: through y = 20 at z = -30, leaning 20° towards +y; normal square to it, away from the tool's side
    const n = unit([0, Math.cos(lean), -Math.sin(lean)])
    let worstAlong = 0
    let worstOff = 0
    for (const { p, a } of pts) {
      worstAlong = Math.max(worstAlong, Math.abs(dot(a, n)))
      // distance from the tool's axis line to the wall plane = 4 (the radius), on the -n side
      worstOff = Math.max(worstOff, Math.abs(dot(sub(p, [0, 20, -30]), n) + 4))
    }
    expect(worstAlong).toBeLessThan(1e-12)
    expect(worstOff).toBeLessThan(1e-9)
    expect(tiltDeg(pts[0].a)).toBeCloseTo(20, 9)
    console.log(`  [5-axis swarf] wall leaning 20°, T102 Ø8: ${pts.length} points, axis in the wall within ${worstAlong.toExponential(1)}, side on the wall within ${worstOff.toExponential(1)} mm`)
    expectGolden3d('multiaxis-swarf-wall', tp)
    // a top curve missing is refused with the reason
    expect(gen5(part, { ...op, top: [] }).warnings[0]).toMatch(/one top curve for every bottom curve/)
  })

  it('surface finishing (ball-nose): the ball sits where 3-axis finishing puts it, tilted on the normal; independent gouge check clean', () => {
    const { part, op } = hemiPart([], { toolId: 't105', stepover: 2, axis: ax({ mode: 'surface-normal', maxTilt: 35 }), maxTurn: 0 })
    const tp = gen5(part, op)
    const pts = cutPoints(tp)
    // the 3-axis parallel finishing with the same settings: the same ball centres, point for point
    const ref = finishSetup('hemisphere', 'parallel', { stepover: 2 }).tp
    const centres3: number[] = []
    for (const m of ref.moves) if (m.t === 'poly') for (let i = 0; i < m.pts.length; i += 3) centres3.push(m.pts[i], m.pts[i + 1], m.pts[i + 2] + 3)
    expect(centres3.length).toBe(pts.length * 3)
    let worstCentre = 0
    let tilted = 0
    let maxTilt = 0
    pts.forEach(({ p, a }, i) => {
      worstCentre = Math.max(worstCentre, Math.hypot(p[0] + 3 * a[0] - centres3[i * 3], p[1] + 3 * a[1] - centres3[i * 3 + 1], p[2] + 3 * a[2] - centres3[i * 3 + 2]))
      const tl = tiltDeg(a)
      if (tl > 1) tilted++
      maxTilt = Math.max(maxTilt, tl)
    })
    expect(worstCentre).toBeLessThan(1e-9)
    expect(tilted).toBeGreaterThan(pts.length / 10)
    expect(maxTilt).toBeLessThanOrEqual(35 + 1e-6)
    expect(tp.multiAxis!.gouge!.method).toBe('exact')
    expect(tp.multiAxis!.gouge!.depth).toBeLessThanOrEqual(GOUGE_TOL)
    console.log(`  [5-axis surface] hemisphere, T105 Ø6 ball on the normal (≤ 35°): ${pts.length} points, ${tilted} tilted over 1°, largest ${maxTilt.toFixed(2)}°, ball centres = the 3-axis passes' within ${worstCentre.toExponential(1)} mm; independent gouge check ${tp.multiAxis!.gouge!.depth.toFixed(4)} mm over ${tp.multiAxis!.gouge!.points} positions`)
    expectGolden3d('multiaxis-surface-hemisphere', tp)
  })

  it('the independent gouge check finds a planted gouge', () => {
    const mesh = surfaceMesh('hemisphere')
    // the top of the dome is at (40, 40, 0): the ball's centre 2.7 mm above it (0.3 mm into it), tilted 30°
    const a: [number, number, number] = [Math.sin(Math.PI / 6), 0, Math.cos(Math.PI / 6)]
    const c = [40, 40, 3 - 0.3]
    const tip = [c[0] - 3 * a[0], c[1] - 3 * a[1], c[2] - 3 * a[2]]
    const moves: Move[] = [{ t: 'rapid', x: tip[0], y: tip[1], z: 20, a }, { t: 'feed', x: tip[0], y: tip[1], z: tip[2], f: 'plunge', a }]
    const g = checkAxisGouge(mesh, { shape: 'ball', diameter: 6 }, moves, { step: 0.05 })
    expect(g.depth).toBeGreaterThan(0.29)
    expect(g.depth).toBeLessThan(0.31)
    expect(checkAxisGouge(mesh, { shape: 'flat', diameter: 6 }, moves).method).toBe('none')
    // a cut meant to go 0.3 mm into the model (a groove along a curve) is not a gouge; 0.2 of it is
    expect(checkAxisGouge(mesh, { shape: 'ball', diameter: 6 }, moves, { step: 0.05, depth: 0.3 }).depth).toBeLessThan(0.01)
    expect(checkAxisGouge(mesh, { shape: 'ball', diameter: 6 }, moves, { step: 0.05, depth: 0.1 }).depth).toBeCloseTo(0.2, 2)
  })

  it('a groove cut along a curve on the model, as deep as asked, passes the gouge check', () => {
    const { part, op } = hemiPart([curve3('lat', latitude(15))], { geometry: ['lat'], toolId: 't106', maxTurn: 0, axis: ax({ mode: 'surface-normal', maxTilt: 90 }), levels: { safeZ: 20, rapidZ: 3, depth: 1.5, through: false, stockZ: 0, passDepth: 0 } }, 'curve')
    const tp = gen5(part, op)
    expect(tp.multiAxis!.gouge!.method).toBe('exact')
    // (the normal comes from the model's facets: within a few hundredths)
    expect(tp.multiAxis!.gouge!.depth).toBeLessThan(0.05)
    expect(tp.warnings.join(' ')).not.toMatch(/Gouge check: the tool cuts/)
  })
})

describe('M3.5 our side of an engine result: reversed, both ways, axis measures (NEW-26)', () => {
  const base = (): Move[] => [
    { t: 'rapid', x: 0, y: 0, z: 20, a: [0, 0, 1] },
    { t: 'rapid', x: 0, y: 0, z: 3, a: [0, 0, 1] },
    { t: 'feed', x: 0, y: 0, z: 0, f: 'plunge', a: [0, 0, 1] },
    { t: 'poly', pts: new Float64Array([5, 0, 0, 10, 0, 0]), f: 'cut', axes: new Float64Array([0, 0, 1, Math.sin(0.1), 0, Math.cos(0.1)]) },
    { t: 'feed', x: 10, y: 0, z: 3, f: 'lead', a: [Math.sin(0.1), 0, Math.cos(0.1)] },
    { t: 'rapid', x: 10, y: 0, z: 20, a: [Math.sin(0.1), 0, Math.cos(0.1)] },
  ]
  it('reversed runs the same points backwards: way in and way out swap, cutting stays cutting', () => {
    const r = axisNodes(withDirection(base(), 'reversed'))
    const f = axisNodes(base())
    expect(r.map((n) => [n.x, n.z])).toEqual([...f].reverse().map((n) => [n.x, n.z]))
    expect(r.map((n) => n.kind)).toEqual(['rapid', 'rapid', 'plunge', 'cut', 'cut', 'lead', 'rapid'].slice(0, r.length))
    expect(r[0].a).toEqual(f[f.length - 1].a)
    expect(engineMoveProblems(withDirection(base(), 'reversed'))).toEqual([])
  })
  it('both ways cuts there and back: twice the cutting', () => {
    const b = withDirection(base(), 'both')
    const cut = (ms: Move[]) => {
      const nodes = axisNodes(ms)
      let s = 0
      for (let i = 1; i < nodes.length; i++) if (nodes[i].kind === 'cut') s += Math.hypot(nodes[i].x - nodes[i - 1].x, nodes[i].z - nodes[i - 1].z)
      return s
    }
    expect(cut(b)).toBeCloseTo(2 * cut(base()), 12)
    expect(axisStats(b).maxTilt).toBeCloseTo((0.1 * 180) / Math.PI, 9)
  })
  it('an operation set to "both ways" doubles its toolpath on the real engine output', () => {
    const lat = latitude(12, 36)
    const one = hemiPart([curve3('lat', lat)], { geometry: ['lat'], toolId: 't106', axis: ax({ mode: 'curve-normal' }) }, 'curve')
    const fwd = gen5(one.part, one.op)
    const both = gen5(one.part, { ...one.op, direction: 'both' })
    expect(both.stats.cut).toBeGreaterThan(fwd.stats.cut * 1.9)
    expect(opInputHash({ ...one.op, direction: 'both' }, one.part, null)).not.toBe(opInputHash(one.op, one.part, null))
  })
})

describe('M3.5 barrel and form tools (TOOL-07)', () => {
  it('barrel outline: tip ball, side arc through the widest point, all within the chord tolerance', () => {
    const f = barrelForm(BARREL)
    const hw = barrelWidest(BARREL)
    expect(hw).toBeCloseTo(2 + Math.sqrt(38 * 38 - 34 * 34), 12)
    const pts = outlinePoints(f)
    // every point on the tip ball (centre on the axis 2 up) or on the side arc (centre across the axis at hw)
    let worst = 0
    for (const p of pts) {
      const dBall = Math.abs(Math.hypot(p.r, p.h - 2) - 2)
      const dSide = Math.abs(Math.hypot(p.r - (6 - 40), p.h - hw) - 40)
      worst = Math.max(worst, Math.min(dBall, dSide))
    }
    expect(worst).toBeLessThan(1e-9)
    expect(outlineRadius(pts, hw)).toBeCloseTo(6, 6)
    expect(Math.max(...pts.map((p) => p.r))).toBeCloseTo(6, 6)
    expect(pts[pts.length - 1].h).toBe(30)
    // the simulator's underside: at distance d from the axis the tool is as low as the outline reaches out to d
    const c = cutterOf({ tool: BARREL, kind: 'multiaxis', intents: [] } as unknown as Toolpath)
    expect(c.shape).toBe('barrel')
    // underside: on the tip ball out to where it meets the side arc, then on the side arc's lower part
    const k = 40 / 38
    const Tr = -34 + 34 * k
    const under = (d: number) => (d <= Tr ? 2 - Math.sqrt(4 - d * d) : hw - Math.sqrt(1600 - (d + 34) ** 2))
    expect(cutterZ(c, 0, 0)).toBe(0)
    const Th = hw + (2 - hw) * k
    const rAt = (h: number) => (h <= Th ? Math.sqrt(Math.max(0, 4 - (h - 2) ** 2)) : -34 + Math.sqrt(1600 - (h - hw) ** 2))
    for (const d of [0.5, 1, Tr, 2, 3, 4, 5, 5.9, 6]) {
      const h = cutterZ(c, 0, d)
      // where it is shallow, the height; where steep, the radius there (chords within 0.002 mm across the outline)
      expect(Math.min(Math.abs(h - under(d)), Math.abs(rAt(h) - d)), `d ${d}`).toBeLessThan(0.003)
    }
    // collision outline: the shank (Ø10) is wider than the barrel's top
    expect(cutterOutline(BARREL, null).shankR).toBe(5)
    expect(squareEnd(BARREL)).toBe(false)
  })

  it('form outline: arcs within 0.002 mm, problems in plain words, typed as text', () => {
    expect(formProblems(FORM.form)).toEqual([])
    const pts = outlinePoints(FORM.form!)
    // the tip arc: radius 1 about (0, 1)
    for (const p of pts.filter((q) => q.h <= 1)) expect(Math.abs(Math.hypot(p.r, p.h - 1) - 1)).toBeLessThan(1e-9)
    // chord sag on the arc within the tolerance
    const arc = pts.filter((q) => q.h <= 1)
    for (let i = 1; i < arc.length; i++) {
      const m = { r: (arc[i].r + arc[i - 1].r) / 2, h: (arc[i].h + arc[i - 1].h) / 2 }
      expect(1 - Math.hypot(m.r, m.h - 1)).toBeLessThanOrEqual(0.002 + 1e-12)
    }
    const o = cuttingOutline(FORM)!
    expect(o.outline[o.outline.length - 1]).toEqual({ h: 20, r: 4 })
    // the shaft above the flutes: the neck (Ø6), not wider
    expect(o.shaftR).toBe(3)
    expect(formProblems([{ h: 1, r: 0 }, { h: 0, r: 2 }])).toEqual(['The first point is the tip: its height must be 0.', 'Heights must not go down (list the points from the tip up).'])
    expect(formProblems([{ h: 0, r: 0 }, { h: 4, r: 0, arc: 1 }])[1]).toMatch(/cannot reach/)
    expect(parseFormText(formText(FORM.form!))).toEqual({ value: FORM.form })
    expect(parseFormText('0 0; 1')).toEqual({ error: 'Form outline: “1” is not "height radius" or "height radius arc".' })
    // the engine gets the outline of any shape (ball: quarter circle then straight)
    const ball = cutterOutlineOf(PLACEHOLDER_MACHINE.tools.find((t) => t.id === 't105')!)
    expect(ball).toEqual([{ h: 0, r: 0 }, { h: 3, r: 3, arc: 3 }, { h: 25, r: 3 }])
    expect(engineTool(BARREL, PLACEHOLDER_MACHINE).outline.length).toBeGreaterThan(20)
  })

  it('a barrel plunged along its axis into the three-way stock leaves its own shape (widest radius carried up)', () => {
    const st = new TriDexelStock(30, 30, 40, 0.25)
    const c = { ...cutterOf({ tool: BARREL, kind: 'multiaxis', intents: [] } as unknown as Toolpath), flute: 30 }
    st.carve({ x: 15, y: 15, z: 5 }, { x: 15, y: 15, z: -35 }, c, { x: 0, y: 0, z: 1 })
    expect(sweptOutline([{ h: 0, r: 0 }, { h: 5, r: 3 }, { h: 9, r: 1 }], 10)).toEqual([{ h: 0, r: 0 }, { h: 5, r: 3 }, { h: 15, r: 3 }, { h: 19, r: 1 }])
    // the rays along X through y = 15.125 (a ray centre): the hole's half-width at each height
    // above the tip is the outline's radius there (the widest radius above the widest point)
    const hw = barrelWidest(BARREL)
    const o = cuttingOutline(BARREL)!.outline
    const G = st.grids[0]
    const iu = Math.floor(15 / 0.25)
    const dy = (iu + 0.5) * 0.25 - 15
    let worst = 0
    for (const h of [0.5, 1.5, 4, 10, hw, 25, 34]) {
      const jv = Math.floor((-35 + h + 40) / 0.25)
      const zc = -40 + (jv + 0.5) * 0.25
      const hh = zc + 35
      const want = Math.sqrt(Math.max(0, (hh <= hw ? outlineRadius(o, hh) : 6) ** 2 - dy * dy))
      const k = jv * G.nu + iu
      // material ends at 15 - w and starts again at 15 + w
      const iv = Array.from({ length: G.cnt[k] * 2 }, (_, q) => G.iv[k * G.max * 2 + q])
      expect(iv.length, `two pieces at h ${h}`).toBe(4)
      worst = Math.max(worst, Math.abs(15 - iv[1] - want), Math.abs(iv[2] - 15 - want))
    }
    // (the outline's chords and float storage)
    expect(worst).toBeLessThan(0.01)
  })

  it('the placeholder barrel T110 is a marked placeholder with Configure badges', () => {
    const t = PLACEHOLDER_MACHINE.tools.find((x) => x.id === 't110')!
    expect(t.name).toMatch(/placeholder/)
    const items = toolUnconfirmed(PLACEHOLDER_MACHINE, t).map((u) => u.label)
    expect(items).toEqual(['T110 number, Ø, side and tip radii, depth', 'T110 shank, flute and stick-out', 'T110 feeds, speed and step-down'])
  })
})

describe('M3.5 placeholder 5-axis values carry Configure badges', () => {
  it('step-over, tilt limit and axis smoothing of a new operation are badged until confirmed', () => {
    const m = structuredClone(PLACEHOLDER_MACHINE)
    const op = { ...defaultOp('multiaxis', [], { ...newOpDefaults('multiaxis', m, { strategy: 'surface' } as Partial<CamOp>), strategy: 'surface' } as Partial<CamOp>), id: 'o' } as MultiAxisOp
    expect(op.axis.mode).toBe('surface-normal')
    expect(op.axis.maxTilt).toBe(60)
    const labels = (o: CamOp) => opUnconfirmed(o, { id: 'p' }, m, null).map((u) => u.label)
    expect(labels(op)).toEqual(['5-axis surface finishing: 5-axis step-over', '5-axis surface finishing: 5-axis largest tool tilt', '5-axis surface finishing: 5-axis axis smoothing'])
    expect(opUnconfirmed(op, { id: 'p' }, m, null).map((u) => u.value)).toEqual(['0.6 mm', '60° from vertical', 'off'])
    // confirming (or typing another value) clears each badge; nothing else changes
    expect(labels(confirmOp(confirmOp(op, 'multiAxisStepover'), 'multiAxisMaxTurn'))).toEqual(['5-axis surface finishing: 5-axis largest tool tilt'])
    expect(labels({ ...op, axis: { ...op.axis, maxTilt: 45 } })).not.toContain('5-axis surface finishing: 5-axis largest tool tilt')
    // swarf does not smooth; along curves there is no step-over
    const sw = { ...defaultOp('multiaxis', [], { strategy: 'swarf' } as Partial<CamOp>), id: 's' } as MultiAxisOp
    expect(sw.axis.mode).toBe('guide')
    expect(labels(sw)).toEqual([`${sw.name}: 5-axis largest tool tilt`])
  })
})

describe('M3.5 part format 10 and the stale flag', () => {
  it('format 10 holds 5-axis operations; a format 9 part reads unchanged; a newer one is refused', () => {
    expect(CAM_FILE_VERSION).toBe(10)
    const { part, op } = hemiPart([curve3('lat', latitude(10, 12))], { geometry: ['lat'], top: [], axis: ax({ mode: 'through-point', point: { x: 40, y: 40, z: 120 } }) }, 'curve')
    const back = parsePart(serializePart(part))
    expect(back.ops[0]).toEqual(op)
    expect(back.version).toBe(10)
    const v9 = { ...part, version: 9, ops: [] }
    expect(migratePart(v9)).toEqual({ ...v9, version: 10 })
    expect(() => parsePart(JSON.stringify({ format: 'cabinet-studio-part', version: 11, part }))).toThrow(/newer than this app/)
  })

  it('the model, the top and guide curves and the settings reach the input hash', () => {
    const top = curve3('t', [[0, 10, 0], [100, 10, 0]])
    const g = curve3('g', [[0, 0, 60], [100, 0, 60]])
    const { part, op } = blockPart5([curve3('b', [[0, 0, -20], [100, 0, -20]]), top, g], { geometry: ['b'], top: ['t'], axis: ax({ mode: 'guide', guide: 'g' }) }, 'swarf')
    const h = opInputHash(op, part, null)
    const moved = { ...part, entities: part.entities.map((e) => (e.id === 't' ? makeEntity({ t: 'poly3d', pts: [[0, 12, 0], [100, 12, 0]] }, 'machining', 1, { id: 't' }) : e)) }
    expect(opInputHash(op, moved, null)).not.toBe(h)
    const guideMoved = { ...part, entities: part.entities.map((e) => (e.id === 'g' ? makeEntity({ t: 'poly3d', pts: [[0, 0, 70], [100, 0, 70]] }, 'machining', 1, { id: 'g' }) : e)) }
    expect(opInputHash(op, guideMoved, null)).not.toBe(h)
    expect(opInputHash({ ...op, headFlip: 'other' }, part, null)).not.toBe(h)
    const hemi = hemiPart([], {})
    const hh = opInputHash(hemi.op, hemi.part, null)
    const shifted = { ...hemi.part, models: hemi.part.models!.map((m) => ({ ...m, place: { ...m.place, at: [1, 0, 0] as [number, number, number] } })) }
    expect(opInputHash(hemi.op, shifted, null)).not.toBe(hh)
  })

  it('shapes on face 1 can be drive curves too (at face 1)', () => {
    const e = makeEntity({ t: 'circle', c: { x: 60, y: 40 }, r: 20 }, 'machining', 1, { id: 'c' })
    const { part, op } = blockPart5([e], { geometry: ['c'], toolId: 't106', axis: ax({ mode: 'through-point', point: { x: 60, y: 40, z: 50 } }), levels: { safeZ: 20, rapidZ: 3, depth: 1, through: false, stockZ: 0, passDepth: 0 } }, 'curve')
    const tp = generateOp(op, { part, machine: testMachine(), engine: fakeEngine({ licensed: true, id: 't', name: 't' }) })
    const pts = cutPoints(tp)
    expect(pts.length).toBeGreaterThan(100)
    for (const { p, a } of pts) {
      const q = [p[0] + a[0], p[1] + a[1], p[2] + a[2]]
      expect(Math.abs(Math.hypot(q[0] - 60, q[1] - 40) - 20)).toBeLessThan(0.006)
      expect(Math.abs(q[2])).toBeLessThan(1e-9)
      expect(angleDeg(a, unit([60 - q[0], 40 - q[1], 50 - q[2]]))).toBeLessThan(1e-6)
    }
  })
})
