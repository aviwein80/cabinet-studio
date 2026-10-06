/**
 * M3.1e curve-driven finishing (3D-09): passes guided by one drive curve (and copies offset from
 * it), two drive curves (passes blended between them), an earlier toolpath, the intersection of two
 * surfaces, and the rows and columns of a surface made in the app; the tool kept on one side of a
 * surface. Each with the M2.2 tolerances (gouge <= 0.005 mm by the independent checker, stock to
 * leave ±0.01 mm), goldens and the export block.
 */
import { describe, expect, it } from 'vitest'
import { checkGouge, meshDistance } from '@/cam/3d/check'
import { blendPasses, type DrivePath, gridLines, offsetDrive } from '@/cam/3d/curve'
import { CAM_FILE_VERSION, makeEntity, newPart, opInputHash, parsePart, serializePart } from '@/cam/doc'
import { circle, type P, polyline } from '@/cam/geom'
import { DEFAULT_PLACEMENT } from '@/cam/mesh/place'
import { revolve } from '@/cam/mesh/surface'
import { type Mesh, meshBounds } from '@/cam/mesh/types'
import { defaultOp, resolveTool } from '@/cam/ops'
import { generateOp, isFlatLayer, type Toolpath } from '@/cam/toolpath'
import type { CamOp, CamPart, Entity, Finish3dOp, ModelRef } from '@/cam/types'
import { newOpDefaults, opUnconfirmed } from '@/core/confirm'
import { defaultAppData, PLACEHOLDER_MACHINE } from '@/core/defaults'
import { runJob } from '@/core/pipeline'
import type { Job } from '@/core/types'
import { floorAndSheet, groupedPrism, groupMesh, ROUND_R, VALLEY_GROUPS, VALLEY_PROFILE } from './curve-fixtures'
import { BALL, BULL, clPoints, expectGolden3d, surfaceMesh } from './finish3d-setup'

const R = 3 // T105, 6 mm ball-nose

function curveRun(mesh: Mesh, blob: string, patch: Partial<Finish3dOp>, entities: Entity[] = [], before: CamOp[] = [], model: Partial<ModelRef> = {}) {
  const b = meshBounds(mesh)
  const part: CamPart = {
    ...newPart({ name: blob, length: b.max[0] - Math.min(0, b.min[0]), width: b.max[1] - Math.min(0, b.min[1]), thickness: 45 }),
    models: [{ id: 'm', name: blob, kind: 'mesh', blob, source: `${blob}.stl`, units: 'mm', place: { ...DEFAULT_PLACEMENT, at: [b.min[0], b.min[1], b.max[2]] }, layer: 'models', visible: true, triangles: mesh.indices.length / 3, size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]], ...model }],
  }
  part.entities = [...part.entities, ...entities]
  const base = defaultOp('finish3d', [], { strategy: 'curve' } as Partial<Finish3dOp>) as Finish3dOp
  const op: Finish3dOp = { ...base, toolId: BALL, stepover: 3, ...patch, strategy: 'curve', surface: { ...base.surface, modelId: 'm', ...(patch.surface ?? {}) } }
  part.ops = [...before, op]
  const tp = generateOp(op, { part, machine: PLACEHOLDER_MACHINE, meshes: new Map([[blob, mesh]]) })
  return { part, op, tp }
}

/** Plan distance from p to a polyline, the distance along it of the nearest point, and the side (+1 left). */
function toPath(p: P, pts: P[]) {
  let best = { d: Infinity, t: 0, side: 0 }
  let L = 0
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]]
    const [dx, dy] = [b.x - a.x, b.y - a.y]
    const l = Math.hypot(dx, dy)
    const f = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (l * l)))
    const d = Math.hypot(a.x + dx * f - p.x, a.y + dy * f - p.y)
    if (d < best.d) best = { d, t: L + l * f, side: Math.sign(dx * (p.y - a.y) - dy * (p.x - a.x)) }
    L += l
  }
  return { ...best, length: L }
}

/**
 * Points of the cutting moves that are not on a pass (`on`) must be the stay-down links between
 * passes: runs starting and ending on passes, no longer (in plan) than two step-overs.
 */
function expectOnlyLinksOff(tp: Toolpath, on: (x: number, y: number, z: number) => boolean, step: number) {
  let longest = 0
  for (const m of tp.moves) {
    if (m.t !== 'poly') continue
    let from = -1
    for (let i = 0; i < m.pts.length; i += 3) {
      const ok = on(m.pts[i], m.pts[i + 1], m.pts[i + 2])
      if (!ok && from < 0) from = Math.max(0, i - 3)
      if (ok && from >= 0) {
        longest = Math.max(longest, Math.hypot(m.pts[i] - m.pts[from], m.pts[i + 1] - m.pts[from + 1]))
        from = -1
      }
    }
    // (a pass never ends off its drive)
    expect(from, 'a cutting run ends off the passes').toBeLessThan(0)
  }
  expect(longest).toBeLessThanOrEqual(2 * step + 0.01)
  return longest
}

const DRIVE: P[] = [
  { x: 12, y: 30 },
  { x: 40, y: 40 },
  { x: 68, y: 30 },
]

describe('M3.1e curve-driven finishing: drive curves', () => {
  it('one drive curve: copies a step-over apart (in plan) to both sides, square to its ends; closed drives give closed copies', () => {
    const open: DrivePath = { pts: DRIVE, closed: false }
    for (const d of [1.5, 4, 9]) {
      const cs = offsetDrive(open, d, 0)
      expect(cs.filter((c) => c.side === 1)).toHaveLength(1)
      expect(cs.filter((c) => c.side === -1)).toHaveLength(1)
      for (const c of cs) {
        const ts: number[] = []
        for (const q of c.pts) {
          const r = toPath(q, DRIVE)
          expect(Math.abs(r.d - d)).toBeLessThan(0.002)
          expect(r.side).toBe(c.side)
          ts.push(r.t)
        }
        // following the drive, from square off its start to square off its end
        expect(ts[0]).toBeLessThan(1e-3)
        expect(ts[ts.length - 1]).toBeGreaterThan(toPath(DRIVE[0], DRIVE).length - 1e-3)
        for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThanOrEqual(ts[i - 1] - 1e-6)
      }
    }
    // a circle: the copy outside and the one inside are closed, round the same way
    const ring: P[] = Array.from({ length: 200 }, (_, i) => ({ x: 40 + 10 * Math.cos((i * Math.PI) / 100), y: 40 + 10 * Math.sin((i * Math.PI) / 100) }))
    const rc = offsetDrive({ pts: ring, closed: true }, 3, 0)
    expect(rc.map((c) => c.closed)).toEqual([true, true])
    for (const c of rc) for (const q of c.pts) expect(Math.abs(Math.abs(Math.hypot(q.x - 40, q.y - 40) - 10) - 3)).toBeLessThan(0.01)
    expect(offsetDrive({ pts: ring, closed: true }, 12, 1)).toEqual([])
  })

  it('on the hemisphere: every point on the drive or a copy, each side, at the exact drop; no gouge; stock to leave ±0.01 mm', () => {
    const e = makeEntity({ t: 'contour', c: polyline(DRIVE, false) }, 'drive')
    const { tp } = curveRun(surfaceMesh('hemisphere'), 'hemisphere', { drive: { mode: 'curves', shapes: [e.id], side: 'both', copies: 3 }, stepover: 3 }, [e])
    expect(tp.warnings).toEqual([])
    const seen = new Set<number>()
    const pts = clPoints(tp)
    for (const [x, y] of pts) {
      const r = toPath({ x, y }, DRIVE)
      const k = Math.round(r.d / 3)
      expect(Math.abs(r.d - 3 * k)).toBeLessThan(0.01)
      expect(k).toBeLessThanOrEqual(3)
      seen.add(k * (r.side || 1))
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([-3, -2, -1, 0, 1, 2, 3])
    const g = checkGouge(surfaceMesh('hemisphere'), { shape: 'ball', r: R }, tp.moves, { step: 0.1 })
    expect(g.max).toBeLessThanOrEqual(0.005)
    // stock to leave
    const s = curveRun(surfaceMesh('hemisphere'), 'hemisphere', { drive: { mode: 'curves', shapes: [e.id], side: 'left', copies: 2 }, stepover: 3, surface: { stockToLeave: 0.3 } as Finish3dOp['surface'] }, [e]).tp
    const dist = meshDistance(surfaceMesh('hemisphere'))
    let lo = Infinity
    let hi = -Infinity
    for (const [x, y, z] of clPoints(s)) {
      const off = dist(x, y, z + R) - R
      lo = Math.min(lo, off)
      hi = Math.max(hi, off)
    }
    process.stdout.write(`  [curve] one drive: ${pts.length} points on the drive and 3 copies each side (within 0.01 mm in plan); gouge ${g.max.toFixed(4)} mm; stock 0.3 → ${lo.toFixed(4)}..${hi.toFixed(4)} mm\n`)
    expect(lo).toBeGreaterThan(0.29)
    expect(hi).toBeLessThan(0.31)
  }, 120_000)

  it('copies not counted fill the boundary (a ring round the dome out to the corners); one side only', () => {
    const e = makeEntity({ t: 'circle', c: { x: 40, y: 40 }, r: 24 }, 'drive')
    const { tp } = curveRun(surfaceMesh('hemisphere'), 'hemisphere', { drive: { mode: 'curves', shapes: [e.id], side: 'right' }, stepover: 4 }, [e])
    expect(tp.warnings).toEqual([])
    let far = 0
    // on the circle or outside it, a whole number of step-overs out
    const ring = (x: number, y: number) => {
      const r = Math.hypot(x - 40, y - 40)
      return r > 24 - 0.01 && Math.abs((r - 24) / 4 - Math.round((r - 24) / 4)) * 4 < 0.01
    }
    for (const [x, y] of clPoints(tp)) {
      expect(Math.hypot(x - 40, y - 40)).toBeGreaterThan(24 - 0.01)
      if (ring(x, y)) far = Math.max(far, Math.hypot(x - 40, y - 40))
    }
    expectOnlyLinksOff(tp, ring, 4)
    // the corners of the 80 x 80 boundary are 56.6 mm out: copies reach them
    expect(far).toBeGreaterThan(Math.hypot(40, 40) - 4)
  }, 120_000)

  it('two drive curves: passes blended from one to the other, never more than a step-over apart; every point on one of them', () => {
    const A: P[] = [
      { x: 8, y: 10 },
      { x: 72, y: 10 },
    ]
    const B: P[] = [
      { x: 72, y: 72 },
      { x: 40, y: 56 },
      { x: 8, y: 70 },
    ]
    const passes = blendPasses({ pts: A, closed: false }, { pts: B, closed: false }, 4)
    if (typeof passes === 'string') throw new Error(passes)
    // the first is A, the last B (turned to run the same way), each next one within a step-over
    expect(passes[0].pts).toEqual(A)
    expect(passes[passes.length - 1].pts).toEqual([...B].reverse())
    for (let k = 1; k < passes.length; k++) for (const q of passes[k].pts) expect(toPath(q, passes[k - 1].pts).d).toBeLessThanOrEqual(4 + 1e-6)
    expect(passes.length).toBe(Math.ceil(62 / 4) + 1)
    expect(typeof blendPasses({ pts: A, closed: false }, { pts: B, closed: true }, 4)).toBe('string')
    const ea = makeEntity({ t: 'contour', c: polyline(A, false) }, 'drive')
    const eb = makeEntity({ t: 'contour', c: polyline(B, false) }, 'drive')
    const { tp } = curveRun(surfaceMesh('hemisphere'), 'hemisphere', { drive: { mode: 'curves', shapes: [ea.id, eb.id] }, stepover: 4 }, [ea, eb])
    expect(tp.warnings).toEqual([])
    for (const [x, y] of clPoints(tp)) expect(Math.min(...passes.map((p) => toPath({ x, y }, p.pts).d))).toBeLessThan(0.01)
    expect(checkGouge(surfaceMesh('hemisphere'), { shape: 'ball', r: R }, tp.moves, { step: 0.1 }).max).toBeLessThanOrEqual(0.005)
    // three shapes: refused
    const ec = makeEntity({ t: 'circle', c: { x: 40, y: 40 }, r: 5 }, 'drive')
    expect(curveRun(surfaceMesh('hemisphere'), 'hemisphere', { drive: { mode: 'curves', shapes: [ea.id, eb.id, ec.id] } }, [ea, eb, ec]).tp.warnings[0]).toMatch(/one or two/)
  }, 120_000)
})

describe('M3.1e curve-driven finishing: an earlier toolpath', () => {
  it('follows the earlier operation\'s cutting moves (and copies); a change to that operation marks this one stale', () => {
    const e = makeEntity({ t: 'circle', c: { x: 40, y: 40 }, r: 26 }, 'engrave')
    const engrave = { ...(defaultOp('engrave', [e.id]) as CamOp), id: 'eng', name: 'Engrave' }
    const { part, op, tp } = curveRun(surfaceMesh('hemisphere'), 'hemisphere', { drive: { mode: 'toolpath', opId: 'eng', side: 'both', copies: 2 }, stepover: 3 }, [e], [engrave])
    expect(tp.warnings).toEqual([])
    const radii = new Set<number>()
    const ring = (x: number, y: number) => {
      const r = Math.hypot(x - 40, y - 40)
      const k = Math.round((r - 26) / 3)
      return Math.abs(r - 26 - 3 * k) < 0.01 && Math.abs(k) <= 2
    }
    for (const [x, y] of clPoints(tp)) if (ring(x, y)) radii.add(Math.round((Math.hypot(x - 40, y - 40) - 26) / 3))
    expect([...radii].sort()).toEqual([-1, -2, 0, 1, 2].sort())
    expectOnlyLinksOff(tp, ring, 3)
    expect(checkGouge(surfaceMesh('hemisphere'), { shape: 'ball', r: R }, tp.moves, { step: 0.1 }).max).toBeLessThanOrEqual(0.005)
    // stale when the toolpath followed changes
    const h0 = opInputHash(op, part, resolveTool(op, PLACEHOLDER_MACHINE), PLACEHOLDER_MACHINE)
    const moved = { ...part, entities: part.entities.map((x) => (x.id === e.id ? { ...x, g: { t: 'circle' as const, c: { x: 40, y: 40 }, r: 25 } } : x)) }
    expect(opInputHash(op, moved, resolveTool(op, PLACEHOLDER_MACHINE), PLACEHOLDER_MACHINE)).not.toBe(h0)
    // only an earlier, enabled operation can be followed
    const later = { ...part, ops: [op, engrave] }
    expect(generateOp(op, { part: later, machine: PLACEHOLDER_MACHINE, meshes: new Map([['hemisphere', surfaceMesh('hemisphere')]]) }).warnings[0]).toMatch(/earlier operation/)
  }, 120_000)
})

describe('M3.1e curve-driven finishing: the intersection of two surfaces', () => {
  const MESH = groupedPrism(VALLEY_PROFILE, VALLEY_GROUPS, 60)
  const along = (a: number[], b: number[], patch: Partial<Finish3dOp> = {}) => curveRun(MESH, 'valley', { drive: { mode: 'intersection', groupsA: a, groupsB: b }, ...patch }, [])

  it('in a valley the ball touches both surfaces at once (flat to flat, and flat to a curved face), exactly; no gouge', () => {
    for (const [label, a, b, x] of [
      ['floor and 45° wall', [5], [4], 55 - R * (Math.SQRT2 - 1)],
      ['floor and round wall', [5], [6], Math.sqrt((ROUND_R + R) ** 2 - R * R)],
    ] as const) {
      const { tp } = along([...a], [...b])
      expect(tp.warnings, label).toEqual([])
      const da = meshDistance(groupMesh(MESH, [...a]))
      const db = meshDistance(groupMesh(MESH, [...b]))
      // every cutting position: the feed down to each pass and the pass
      const pts = [...tp.moves.flatMap((m) => (m.t === 'feed' ? [[m.x, m.y, m.z] as [number, number, number]] : [])), ...clPoints(tp)]
      expect(pts.length).toBeGreaterThan(1)
      let worst = 0
      let xs = [Infinity, -Infinity]
      let ys = [Infinity, -Infinity]
      for (const [px, py, pz] of pts) {
        worst = Math.max(worst, Math.abs(da(px, py, pz + R) - R), Math.abs(db(px, py, pz + R) - R))
        xs = [Math.min(xs[0], px), Math.max(xs[1], px)]
        ys = [Math.min(ys[0], py), Math.max(ys[1], py)]
      }
      process.stdout.write(`  [curve] intersection, ${label}: ball ${worst.toFixed(4)} mm off touching both; centre at x ${xs[0].toFixed(3)}..${xs[1].toFixed(3)} (exact surface ${x.toFixed(3)}), along y ${ys[0].toFixed(1)}..${ys[1].toFixed(1)}\n`)
      expect(worst).toBeLessThan(0.01)
      // the faceted round lies within 0.01 mm of the true circle
      expect(Math.abs(xs[0] - x)).toBeLessThan(0.05)
      expect(ys[1] - ys[0]).toBeGreaterThan(59.9)
      expect(pts.every(([, , z]) => Math.abs(z + 25) < 0.01)).toBe(true)
      expect(checkGouge(MESH, { shape: 'ball', r: R }, tp.moves, { step: 0.1 }).max).toBeLessThanOrEqual(0.005)
    }
  }, 120_000)

  it('over a ridge the ball rides the edge; a tool other than a ball-nose, groups that do not meet or that overlap are refused', () => {
    const { tp } = along([3], [4])
    expect(tp.warnings).toEqual([])
    for (const [x, , z] of clPoints(tp)) expect(Math.abs(Math.hypot(x - 70, z + R + 10) - R)).toBeLessThan(0.01)
    expect(checkGouge(MESH, { shape: 'ball', r: R }, tp.moves, { step: 0.1 }).max).toBeLessThanOrEqual(0.005)
    expect(along([5], [4], { toolId: BULL }).tp.warnings[0]).toMatch(/ball-nose/)
    expect(along([3], [5]).tp.warnings[0]).toMatch(/do not meet/)
    expect(along([3, 4], [4]).tp.warnings[0]).toMatch(/must not share/)
    // picked automatically: the smallest ball-nose
    const op = { ...(defaultOp('finish3d', [], { strategy: 'curve' } as Partial<Finish3dOp>) as Finish3dOp), drive: { mode: 'intersection' as const, groupsA: [5], groupsB: [4] } }
    expect(resolveTool({ ...op, toolId: null }, PLACEHOLDER_MACHINE)?.shape).toBe('ball')
  }, 120_000)
})

describe('M3.1e curve-driven finishing: rows and columns of a surface made in the app', () => {
  // a dome made in the app: 60° of a circle (radius 30, top at z 0, rim at -15) revolved about (50, 40)
  const DOME = revolve(
    Array.from({ length: 41 }, (_, i): [number, number] => {
      const a = (i * Math.PI) / 120
      return [30 * Math.sin(a), 30 * Math.cos(a) - 30]
    }),
    { centre: [50, 40], tol: 0.01 },
  )
  const grid = { blob: 'dome', ...DOME.grid! }
  const O = [50, 40, -30]

  it('a surface made in the app keeps its rows and columns', () => {
    expect(DOME.grid).toBeDefined()
    expect(DOME.grid!.rows * DOME.grid!.cols * 3).toBe(DOME.positions.length)
    expect(DOME.grid!.closedRows).toBe(true)
  })

  it('neighbouring lines are never more than a step-over apart on the surface, from the first row to the last', () => {
    for (const along of ['rows', 'columns'] as const) {
      // (a needle: the plan path is the line itself)
      const lines = gridLines(DOME.positions, DOME.grid!, along, 2, { kind: 'torus', R: 0, rc: 0 }, 0)
      expect(lines.length).toBeGreaterThan(10)
      for (let k = 1; k < lines.length; k++) {
        let gap = 0
        lines[k].pts.forEach((q, i) => (gap = Math.max(gap, Math.hypot(q.x - lines[k - 1].pts[i].x, q.y - lines[k - 1].pts[i].y))))
        expect(gap).toBeLessThanOrEqual(2 + 1e-6)
      }
    }
  })

  for (const along of ['rows', 'columns'] as const) {
    it(`along the ${along}: the ball touches the dome on the lines (meridians / circles), a step-over apart; no gouge; stock ±0.01 mm`, () => {
      const { tp } = curveRun(DOME, 'dome', { drive: { mode: 'parameter', along }, stepover: 3 }, [], [], { grid })
      expect(tp.warnings).toEqual([])
      const dist = meshDistance(DOME)
      let off = 0
      for (const [x, y, z] of clPoints(tp)) off = Math.max(off, Math.abs(dist(x, y, z + R) - R))
      // where the ball touches the dome (straight out from its centre), on the lines but for the
      // stay-down links between them
      const n = DOME.grid!.rows
      // meridians: as many as keep them a step-over apart at the rim (chords between rows)
      const rim = 30 * Math.sin(Math.PI / 3)
      const lines = Math.ceil((n * 2 * rim * Math.sin(Math.PI / n)) / 3 - 1e-9)
      let onLine = 0
      const on = (x: number, y: number, z: number) => {
        const v = [x - O[0], y - O[1], z + R - O[2]]
        const l = Math.hypot(v[0], v[1], v[2])
        const q = v.map((w) => (w / l) * 30)
        let e: number
        if (along === 'rows') {
          const rxy = Math.hypot(q[0], q[1])
          if (rxy < 2) return true
          const a = Math.atan2(q[1], q[0])
          e = Math.abs(a - (Math.round((a / (2 * Math.PI)) * lines) * 2 * Math.PI) / lines) * rxy
        } else {
          // circles: the contact's height a whole number of lines down the profile
          const phi = Math.acos(Math.max(-1, Math.min(1, q[2] / 30)))
          e = Math.abs(phi * 30 - Math.round((phi * 30) / tpStep(tp)) * tpStep(tp))
        }
        if (e < 0.05) onLine = Math.max(onLine, e)
        return e < 0.05
      }
      const link = expectOnlyLinksOff(tp, on, 3)
      process.stdout.write(`  [curve] parameter lines along the ${along}: ball ${off.toFixed(4)} mm off the surface; contact within ${onLine.toFixed(4)} mm of a line (links up to ${link.toFixed(2)} mm)\n`)
      expect(off).toBeLessThan(0.01)
      expect(onLine).toBeLessThan(0.01)
      expect(checkGouge(DOME, { shape: 'ball', r: R }, tp.moves, { step: 0.1 }).max).toBeLessThanOrEqual(0.005)
      // a bull-nose (12 mm, R2) placed by its corner and flat bottom: no gouge either (sampled check)
      const bull = curveRun(DOME, 'dome', { drive: { mode: 'parameter', along }, stepover: 4, toolId: BULL }, [], [], { grid }).tp
      expect(bull.warnings).toEqual([])
      expect(checkGouge(DOME, { shape: 'bull', r: 6, cornerRadius: 2 }, bull.moves, { step: 0.2, resolution: 0.05, maxPoints: 300 }).max).toBeLessThanOrEqual(0.005)
    }, 120_000)
  }

  it('a model without rows and columns, or whose data changed since, is refused with the reason', () => {
    expect(curveRun(DOME, 'dome', { drive: { mode: 'parameter' } }).tp.warnings[0]).toMatch(/surface made in the app/)
    expect(curveRun(DOME, 'dome', { drive: { mode: 'parameter' } }, [], [], { grid: { ...grid, blob: 'older' } }).tp.warnings[0]).toMatch(/surface made in the app/)
  })
})

/** The spacing of the circles a parameter-line toolpath used (its step-over on the profile). */
function tpStep(_tp: Toolpath) {
  // 30 mm radius, 60° of profile: 31.42 mm in ceil(31.42 / 3) = 11 steps
  return (30 * Math.PI) / 3 / Math.ceil((30 * Math.PI) / 3 / 3)
}

describe('M3.1e curve-driven finishing: the tool kept on one side of a surface', () => {
  const MESH = floorAndSheet()
  const line = makeEntity({ t: 'contour', c: polyline([{ x: 4, y: 30 }, { x: 96, y: 30 }], false) }, 'drive')
  const run = (keepSide?: Finish3dOp['keepSide']) => curveRun(MESH, 'sheet', { drive: { mode: 'curves', shapes: [line.id], side: 'both', copies: 3 }, stepover: 5, keepSide }, [line])

  it('without it the passes ride over the sheet; in front of it (or behind) they stop where the tool would touch it', () => {
    const free = run().tp
    expect(Math.max(...clPoints(free).map(([, , z]) => z))).toBeGreaterThan(-1)
    for (const [side, ok] of [
      ['front', (x: number) => x <= 50 - R + 0.005],
      ['back', (x: number) => x >= 50 + R - 0.005],
    ] as const) {
      const { tp } = run({ groups: [2], side })
      expect(tp.warnings).toEqual([])
      const pts = clPoints(tp)
      expect(pts.length).toBeGreaterThan(10)
      expect(pts.every(([x]) => ok(x)), side).toBe(true)
      // right up to it, on the floor, never on the sheet
      expect(pts.every(([, , z]) => Math.abs(z + 20) < 1e-6)).toBe(true)
      expect(checkGouge(MESH, { shape: 'ball', r: R }, tp.moves, { step: 0.1 }).max).toBeLessThanOrEqual(0.005)
      const reach = side === 'front' ? Math.max(...pts.map(([x]) => x)) : Math.min(...pts.map(([x]) => x))
      process.stdout.write(`  [curve] kept ${side}: passes reach x ${reach.toFixed(4)} (the ball touches the sheet at ${side === 'front' ? 50 - R : 50 + R})\n`)
      expect(Math.abs(reach - (side === 'front' ? 47 : 53))).toBeLessThan(0.01)
      // nothing moves across: every move, rapids aside, stays on its side
      for (const m of tp.moves) if (m.t === 'feed') expect(ok(m.x)).toBe(true)
    }
    expect(run({ groups: [9], side: 'front' }).tp.warnings[0]).toMatch(/None of the facet groups/)
  }, 120_000)
})

describe('M3.1e output, file and goldens', () => {
  it('not a flat layer; the export checker refuses it, even with both output switches on', () => {
    const e = makeEntity({ t: 'contour', c: polyline(DRIVE, false) }, 'drive')
    const { part: p, op } = curveRun(surfaceMesh('hemisphere'), 'hemisphere', { drive: { mode: 'curves', shapes: [e.id] } }, [e])
    expect(isFlatLayer(op)).toBe(false)
    const part = { ...p, materialId: 'mat-mdf18', thickness: 45 }
    const data = defaultAppData()
    const job: Job = { id: 'j', number: 'JC', name: 'Curve', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [part] }
    data.jobs = [job]
    data.settings.features = { ...data.settings.features, camMprOutput: true, cam3dMprOutput: true }
    expect(runJob(job, data).issues.filter((i) => i.code === 'CAM_3D_NO_OUTPUT')).toHaveLength(1)
  }, 60_000)

  it('a new curve-driven operation uses the shop step-over, with a Configure badge until confirmed; along an intersection it uses none', () => {
    const machine = PLACEHOLDER_MACHINE
    const op = { ...defaultOp('finish3d', [], { strategy: 'curve' } as Partial<Finish3dOp>), ...newOpDefaults('finish3d', machine, { strategy: 'curve' } as Partial<Finish3dOp>) } as Finish3dOp
    const keys = (o: Finish3dOp) => opUnconfirmed(o, { id: 'p' }, machine, null).map((u) => u.target.kind === 'op' && u.target.key)
    expect(keys(op)).toContain('finishStepover')
    expect(keys({ ...op, confirmed: ['finishStepover'] })).not.toContain('finishStepover')
    expect(keys({ ...op, drive: { mode: 'intersection', groupsA: [1], groupsB: [2] } })).not.toContain('finishStepover')
  })

  it('the drive, the side kept and a surface\'s rows and columns are saved and read back (format 5 and later)', () => {
    const e = makeEntity({ t: 'contour', c: circle({ x: 40, y: 40 }, 10) }, 'drive')
    const { part } = curveRun(surfaceMesh('hemisphere'), 'hemisphere', { drive: { mode: 'curves', shapes: [e.id], side: 'left', copies: 2 }, keepSide: { groups: [3], side: 'back' } }, [e], [], { grid: { blob: 'hemisphere', rows: 2, cols: 3, closedRows: false, closedCols: true } })
    const back = parsePart(serializePart(part))
    expect(back.version).toBe(CAM_FILE_VERSION)
    expect(back.ops).toEqual(part.ops)
    expect(back.models).toEqual(part.models)
  })

  const e = makeEntity({ t: 'contour', c: polyline(DRIVE, false) }, 'drive')
  const eng = makeEntity({ t: 'circle', c: { x: 40, y: 40 }, r: 26 }, 'engrave')
  const engrave = { ...(defaultOp('engrave', [eng.id]) as CamOp), id: 'eng', name: 'Engrave' }
  const VALLEY = groupedPrism(VALLEY_PROFILE, VALLEY_GROUPS, 60)
  for (const [label, run] of [
    ['curve-copies-hemisphere', () => curveRun(surfaceMesh('hemisphere'), 'hemisphere', { drive: { mode: 'curves', shapes: [e.id], side: 'both', copies: 3 } }, [e])],
    ['curve-toolpath-hemisphere-oneway', () => curveRun(surfaceMesh('hemisphere'), 'hemisphere', { drive: { mode: 'toolpath', opId: 'eng', copies: 1 }, pattern: 'oneway', direction: 'conventional' }, [eng], [engrave])],
    ['curve-intersection-valley', () => curveRun(VALLEY, 'valley', { drive: { mode: 'intersection', groupsA: [5, 3], groupsB: [4, 6] } })],
    ['curve-keepside-front', () => curveRun(floorAndSheet(), 'sheet', { drive: { mode: 'curves', shapes: [e.id], side: 'both', copies: 4 }, stepover: 5, keepSide: { groups: [2], side: 'front' } }, [e])],
  ] as [string, () => { tp: Toolpath }][]) {
    it(`golden: ${label}`, () => expectGolden3d(label, run().tp), 120_000)
  }
})
