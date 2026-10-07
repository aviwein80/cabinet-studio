/**
 * The built-in preview engine (M3.5): a deliberately simple stand-in behind the `MultiAxisEngine`
 * interface. In the app it makes toolpaths for the simulator only (its toolpaths are never written:
 * it plans no collision avoidance for the shaft and holder, no real axis optimisation and no
 * roughing). The tests use the same code, declared licensed, to stand in for a licensed engine.
 *
 * What it does (our own simple methods):
 * - 'curve': the tip runs along each drive curve, `depth` below it along the tool; the tool axis by
 *   the rule at every point (pieces of at most 1 mm), limited in tilt, smoothed.
 * - 'swarf': the bottom and top curves walked together by share of length; the tool along the line
 *   from bottom to top, moved one tool radius off it to the chosen side, so the side of a flat end
 *   mill lies on the wall (exact where the wall is flat across each line; a twisted wall is
 *   approximated, as a real engine would correct).
 * - 'surface' (ball-nose only): our 3-axis parallel finishing finds where the ball sits on the
 *   surface; the tool is then turned about the ball's centre to the rule's direction. The ball does
 *   not move, so it cuts exactly what the 3-axis passes cut (no deeper than their tolerance); only
 *   the shaft and holder move, and the simulator's collision check covers those.
 * - 'rough': not offered (multi-axis roughing needs a licensed engine).
 *
 * Every chain: approach along its first tool direction from the clearance, cut, leave along its last
 * direction, then up to the safe height; the axis turns on the moves between chains.
 *
 * Pure: no DOM, no React.
 */
import { checkCancel, type Work } from '@/core/cancel'
import { parallelFinish } from '../3d/parallel'
import type { Region } from '../3d/region'
import { distanceTo } from './check'
import { meshBounds } from '../mesh/types'
import type { Move } from '../toolpath'
import type { Finish3dOp } from '../types'
import { add, axisAt, clampTilt, curveLengths, curveAt, len, mul, resample, smoothAxes, sub, tangents, unit, type V3, Z, cross, dot } from './axis'
import { type MultiAxisEngine, type MultiAxisEngineInfo, type MultiAxisRequest, type MultiAxisResult, PREVIEW_NAME } from './engine'
import { simpleMoves } from '../moves'

/** One cutting chain: tip points and tool directions. */
interface Chain {
  pts: V3[]
  axes: V3[]
}

const ALL_MODES: MultiAxisEngineInfo['axisModes'] = ['vertical', 'fixed', 'surface-normal', 'curve-normal', 'through-point', 'away-from-point', 'through-line', 'away-from-line', 'guide']

/** A preview / test engine. `licensed`: let the tests stand it in for a licensed engine. */
export function fakeEngine(opts: { id?: string; name?: string; licensed?: boolean; preview?: boolean } = {}): MultiAxisEngine {
  const info: MultiAxisEngineInfo = {
    id: opts.id ?? 'preview',
    name: opts.name ?? PREVIEW_NAME,
    vendor: 'Cabinet Studio',
    licensed: !!opts.licensed,
    ...(opts.preview === false ? {} : { preview: !opts.licensed }),
    strategies: ['curve', 'swarf', 'surface'],
    axisModes: ALL_MODES,
    toolShapes: ['ball', 'flat', 'bull', 'barrel', 'form', 'v'],
  }
  return { info, generate: (req, work) => generate(req, work) }
}

/** The preview engine the app offers (simulation only). */
export const PREVIEW_ENGINE: MultiAxisEngine = fakeEngine()

function generate(req: MultiAxisRequest, work?: Work): MultiAxisResult {
  const warnings: string[] = []
  const notes: Notes = { clamped: 0 }
  if (req.axis.mode === 'guide' && !req.curves.guide?.length && req.strategy !== 'swarf') warnings.push('Tool axis "towards a guide curve" has no guide curve: the tool stands upright.')
  let chains: Chain[]
  switch (req.strategy) {
    case 'curve':
      chains = curveChains(req, warnings, notes)
      break
    case 'swarf': {
      const r = swarfChains(req, warnings)
      if ('error' in r) return { status: 'unsupported', message: r.error }
      chains = r.chains
      break
    }
    case 'surface': {
      const r = surfaceChains(req, warnings, notes, work)
      if ('error' in r) return { status: 'unsupported', message: r.error }
      chains = r.chains
      break
    }
    default:
      return { status: 'unsupported', message: 'The preview engine does not do multi-axis roughing: that needs a licensed 5-axis engine.' }
  }
  if (notes.clamped) warnings.push(`The tool axis was held to ${req.axis.maxTilt}° from vertical at ${notes.clamped} point(s).`)
  if (!chains.length) return { status: 'failed', message: warnings[0] ?? 'Nothing to cut.' }
  return { status: 'ok', moves: link(chains, req), warnings }
}

/** The surface normal near a point: from the change of distance to the model (unit), or null. */
function normalAt(dist: ((x: number, y: number, z: number) => number) | null, q: readonly number[]): V3 | null {
  if (!dist) return null
  const h = 0.01
  const g: V3 = [0, 0, 0]
  for (let k = 0; k < 3; k++) {
    const a = [q[0], q[1], q[2]]
    const b = [q[0], q[1], q[2]]
    a[k] += h
    b[k] -= h
    g[k] = (dist(a[0], a[1], a[2]) - dist(b[0], b[1], b[2])) / (2 * h)
  }
  if (len(g) <= 0.5) return null
  // (within 0.2° of upright counts as upright: what is left is the facets' rounding, and a machine
  // would otherwise turn its first axis round for nothing near the pole)
  const n = unit(g)
  return n[2] > Math.cos((0.2 * Math.PI) / 180) ? [0, 0, 1] : n
}

/** Counts kept while the paths are made, turned into one warning each at the end. */
interface Notes {
  clamped: number
}

/** Rule, tilt limit and smoothing along one path. `normals`: the surface normal at each point (or null). */
function axesAlong(req: MultiAxisRequest, pts: V3[], normals: (V3 | null)[] | null, notes: Notes): V3[] {
  const c = req.axis
  const ts = tangents(pts)
  const L = curveLengths(pts)
  const total = L[L.length - 1] || 1
  const guide = c.mode === 'guide' && req.curves.guide?.length ? { curve: req.curves.guide, L: curveLengths(req.curves.guide) } : null
  const axes = pts.map((p, i) => {
    const a = axisAt(c, { p, t: ts[i], n: normals?.[i] ?? null, share: L[i] / total }, guide)
    const r = clampTilt(a, c.maxTilt)
    if (r.clamped) notes.clamped++
    return r.a
  })
  smoothAxes(pts, axes, req.maxTurn)
  return axes
}

function curveChains(req: MultiAxisRequest, warnings: string[], notes: Notes): Chain[] {
  if (!req.curves.drive.length) {
    warnings.push('Pick the 3D curves (or solid edges) to cut along.')
    return []
  }
  const dist = req.surface && req.axis.mode === 'surface-normal' ? distanceTo(req.surface.mesh) : null
  return req.curves.drive
    .filter((c) => c.length >= 2)
    .map((c) => {
      const pts = resample(c, 1)
      // the surface normal at each point: probed a little way off the surface (square to the curve, upwards)
      const normals = dist
        ? tangents(pts).map((t, i) => {
            // start square to the curve, upwards; then probe along the normal found, so the nearest
            // point of the surface is the curve's own point
            let n: V3 | null = unit(sub(Z, mul(t, dot(Z, t))))
            for (let k = 0; k < 3 && n; k++) n = normalAt(dist, add(pts[i], mul(n, 0.5))) ?? n
            return n
          })
        : null
      const axes = axesAlong(req, pts, normals, notes)
      return { pts: pts.map((p, i) => sub(p, mul(axes[i], req.depth))), axes }
    })
}

function swarfChains(req: MultiAxisRequest, warnings: string[]): { chains: Chain[] } | { error: string } {
  const { drive, top } = req.curves
  if (!drive.length) return { error: 'Pick the bottom curve of each wall (and its top curve).' }
  if (top.length !== drive.length) return { error: `Swarf needs one top curve for every bottom curve (${drive.length} bottom, ${top.length} top).` }
  const R = req.tool.shape === 'ball' ? 0 : req.tool.diameter / 2
  const chains: Chain[] = []
  drive.forEach((B, w) => {
    const T = top[w]
    if (B.length < 2 || T.length < 2) return
    const LB = curveLengths(B)
    const LT = curveLengths(T)
    // walk both by share of length, at the points of either curve and at most 1 mm apart
    const shares = new Set<number>()
    LB.forEach((l) => shares.add(l / LB[LB.length - 1]))
    LT.forEach((l) => shares.add(l / LT[LT.length - 1]))
    const n = Math.max(1, Math.ceil(Math.max(LB[LB.length - 1], LT[LT.length - 1])))
    for (let k = 0; k <= n; k++) shares.add(k / n)
    const ss = [...shares].sort((a, b) => a - b).filter((s, i, a) => i === 0 || s - a[i - 1] > 1e-9)
    const bottom = ss.map((s) => curveAt(B, s, LB))
    const ts = tangents(bottom)
    let clamped = 0
    const axes = ss.map((s, i) => {
      const r = clampTilt(unit(sub(curveAt(T, s, LT), bottom[i])), req.axis.maxTilt)
      if (r.clamped) clamped++
      return r.a
    })
    if (clamped) warnings.push(`Wall ${w + 1}: it leans more than ${req.axis.maxTilt}° at ${clamped} point(s); the tool was held to that, so its side leaves the wall there.`)
    const pts = bottom.map((p, i) => {
      const left = unit(cross(axes[i], ts[i]))
      const side = req.side === 'right' ? mul(left, -1) : left
      return sub(add(p, mul(side, R)), mul(axes[i], req.depth))
    })
    chains.push({ pts, axes })
  })
  return { chains }
}

function surfaceChains(req: MultiAxisRequest, warnings: string[], notes: Notes, work?: Work): { chains: Chain[] } | { error: string } {
  if (!req.surface) return { error: 'Pick the model to finish.' }
  if (req.tool.shape !== 'ball') return { error: `The preview engine finishes surfaces with a ball-nose only (T${req.tool.number} is ${req.tool.shape}).` }
  const R = req.tool.diameter / 2
  const mesh = req.surface.mesh
  const b = meshBounds(mesh)
  const region: Region = req.boundary.length
    ? { polys: req.boundary.map((l) => l.map(([x, y]) => ({ x, y }))), fromModel: false }
    : { polys: [[{ x: b.min[0], y: b.min[1] }, { x: b.max[0], y: b.min[1] }, { x: b.max[0], y: b.max[1] }, { x: b.min[0], y: b.max[1] }]], fromModel: true }
  const op = {
    id: 'preview',
    name: 'preview',
    enabled: true,
    geometry: [],
    toolId: null,
    feeds: {},
    face: 1,
    kind: 'finish3d',
    strategy: 'parallel',
    surface: { modelId: '', groups: req.surface.groups, boundaryMode: 'centre', stockToLeave: Math.max(0, req.stockToLeave), tolerance: Math.max(0.001, req.tolerance) },
    stepover: Math.max(0.01, req.stepover),
    angle: 0,
    pattern: 'zigzag',
    direction: 'climb',
    slope: { min: 0, max: 90 },
    skipFlats: false,
    levels: { safeZ: req.safeZ, rapidZ: req.rapidZ, depth: 0, through: false, stockZ: 0, passDepth: 0 },
  } as Finish3dOp
  const r = parallelFinish(op, mesh, { kind: 'torus', R, rc: R }, region, op.levels, work)
  warnings.push(...r.warnings)
  // the cutting chains of the 3-axis passes (tip points; the ball's centre R above each)
  const chains3: V3[][] = []
  let cur: V3[] | null = null
  for (const m of simpleMoves(r.moves)) {
    if (m.t !== 'feed' && m.t !== 'rapid') continue
    const p: V3 = [m.x, m.y, m.z]
    if (m.t === 'feed' && m.f === 'cut') {
      if (!cur) {
        cur = []
        chains3.push(cur)
      }
      cur.push(p)
    } else {
      // a plunge starts the next chain at its end point
      cur = m.t === 'feed' && m.f === 'plunge' ? [p] : null
      if (cur) chains3.push(cur)
    }
  }
  const dist = distanceTo(mesh)
  const s = Math.max(0, req.stockToLeave)
  const chains: Chain[] = []
  chains3.forEach((pts, i) => {
    if ((i & 15) === 0) checkCancel(work?.isCancelled)
    if (pts.length < 2) return
    const centres = pts.map((p) => add(p, mul(Z, R)))
    // the normal where the ball (grown by the stock) touches the surface
    const normals = centres.map((c) => {
      const n = normalAt(dist, c)
      return n && Math.abs(dist(c[0], c[1], c[2]) - (R + s)) < Math.max(0.05, req.tolerance * 5) ? n : null
    })
    const axes = axesAlong(req, centres, normals, notes)
    chains.push({ pts: centres.map((c, k) => sub(c, mul(axes[k], R))), axes })
  })
  return { chains }
}

/** Chains linked into moves: down along each chain's first axis, cut, out along its last, up to the safe height. */
function link(chains: Chain[], req: MultiAxisRequest): Move[] {
  const moves: Move[] = []
  const clear = Math.max(0.5, req.rapidZ)
  const safe = req.safeZ
  for (const c of chains) {
    const p0 = c.pts[0]
    const a0 = c.axes[0]
    const in0 = add(p0, mul(a0, clear))
    moves.push({ t: 'rapid', x: in0[0], y: in0[1], z: Math.max(safe, in0[2]), a: a0 })
    moves.push({ t: 'rapid', x: in0[0], y: in0[1], z: in0[2], a: a0 })
    moves.push({ t: 'feed', x: p0[0], y: p0[1], z: p0[2], f: 'plunge', a: a0 })
    const n = c.pts.length - 1
    if (n > 0) {
      const pts = new Float64Array(n * 3)
      const axes = new Float64Array(n * 3)
      for (let i = 1; i <= n; i++) {
        pts.set(c.pts[i], (i - 1) * 3)
        axes.set(c.axes[i], (i - 1) * 3)
      }
      moves.push({ t: 'poly', pts, f: 'cut', axes })
    }
    const pe = c.pts[n]
    const ae = c.axes[n]
    const out = add(pe, mul(ae, clear))
    moves.push({ t: 'feed', x: out[0], y: out[1], z: out[2], f: 'lead', a: ae })
    moves.push({ t: 'rapid', x: out[0], y: out[1], z: Math.max(safe, out[2]), a: ae })
  }
  return moves
}
