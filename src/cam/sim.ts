/**
 * Toolpath simulation: a timed backplot of every move (rapids included), the tool position at
 * any moment, and a 2.5D heightfield of the material left after cutting up to that moment.
 *
 * Part frame: X along length, Y along width, Z = 0 at face 1 and negative into the material.
 * The heightfield stores the top surface per cell, from 0 (uncut) down to -thickness (through).
 * Horizontal (edge) drilling runs below the surface, so it is backplotted but not carved.
 */
import type { ToolShape } from '@/core/types'
import { RAPID_RATE, simpleMoves, type Toolpath } from './toolpath'

export interface V3 {
  x: number
  y: number
  z: number
}

export type SimKind = 'rapid' | 'cut' | 'plunge' | 'lead' | 'drill'

export interface Cutter {
  r: number
  shape: ToolShape
  /** Included angle for V cutters (degrees). */
  angle: number
  /** Corner radius for bull-nose cutters. */
  cornerRadius?: number
}

export interface SimSeg {
  a: V3
  b: V3
  kind: SimKind
  /** Index into `SimTimeline.ops`. */
  op: number
  t0: number
  t1: number
  /** Cutter for this segment (drill groups inside one op can differ). */
  cutter: Cutter
  /** Edge drilling: below the face, so not carved into the heightfield. */
  side?: boolean
}

export interface SimOp {
  name: string
  tool: string
  start: number
  end: number
  cutter: Cutter
}

export interface SimTimeline {
  segs: SimSeg[]
  ops: SimOp[]
  /** Seconds. */
  total: number
  cutLength: number
  rapidLength: number
  start: V3
}

export interface SimWarning {
  kind: 'rapid-in-material'
  op: number
  at: V3
  /** Seconds into the program. */
  t: number
  message: string
}

const HOME: V3 = { x: 0, y: 0, z: 50 }
const DRILL_DWELL_S = 1.8

function cutterOf(tp: Toolpath, d?: number): Cutter {
  const t = tp.tool
  const shape: ToolShape = t?.shape ?? (tp.kind === 'drill' ? 'drill' : tp.kind === 'vcarve' ? 'v' : tp.kind === 'saw' ? 'saw' : 'flat')
  let dia = d ?? t?.diameter ?? 0
  if (tp.kind === 'saw') {
    const w = tp.intents.find((i) => i.k === 'saw')
    dia = w && w.k === 'saw' ? w.width : (t?.kerf ?? 4)
  }
  if (!dia) dia = tp.kind === 'vcarve' ? 20 : 6
  return { r: dia / 2, shape, angle: t?.angle ?? 90, ...(shape === 'bull' ? { cornerRadius: t?.cornerRadius ?? 0 } : {}) }
}

/** Cutter bottom height at horizontal distance `d` from the tool axis, tool tip at `z`. */
export function cutterZ(c: Cutter, z: number, d: number): number {
  if (d > c.r + 1e-9) return Infinity
  if (c.shape === 'ball') return z + c.r - Math.sqrt(Math.max(0, c.r * c.r - d * d))
  if (c.shape === 'v') return z + d / Math.tan(((c.angle || 90) * Math.PI) / 360)
  if (c.shape === 'bull') {
    const rc = Math.min(Math.max(0, c.cornerRadius ?? 0), c.r)
    const flat = c.r - rc
    if (d <= flat) return z
    const e = d - flat
    return z + rc - Math.sqrt(Math.max(0, rc * rc - e * e))
  }
  return z
}

function arcPoints(a: V3, m: { x: number; y: number; z: number; cx: number; cy: number; ccw: boolean }): V3[] {
  const r = Math.hypot(a.x - m.cx, a.y - m.cy)
  const a0 = Math.atan2(a.y - m.cy, a.x - m.cx)
  let sw = Math.atan2(m.y - m.cy, m.x - m.cx) - a0
  if (m.ccw) while (sw <= 1e-12) sw += Math.PI * 2
  else while (sw >= -1e-12) sw -= Math.PI * 2
  const n = Math.max(2, Math.ceil(Math.max((Math.abs(sw) * r) / 2, Math.abs(sw) / (Math.PI / 36))))
  const out: V3[] = []
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const ang = a0 + sw * t
    out.push(i === n ? { x: m.x, y: m.y, z: m.z } : { x: m.cx + r * Math.cos(ang), y: m.cy + r * Math.sin(ang), z: a.z + (m.z - a.z) * t })
  }
  return out
}

/** Toolpaths in the order the woodWOP program runs them: drilling first, then milling and sawing. */
export function programOrder(toolpaths: Toolpath[]): Toolpath[] {
  return toolpaths
    .map((tp, i) => ({ tp, i }))
    .sort((a, b) => Number(a.tp.kind !== 'drill') - Number(b.tp.kind !== 'drill') || a.i - b.i)
    .map((x) => x.tp)
}

const len3 = (a: V3, b: V3) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)

/** Flatten toolpaths (in run order) into timed straight segments. */
export function buildTimeline(toolpaths: Toolpath[]): SimTimeline {
  const segs: SimSeg[] = []
  const ops: SimOp[] = []
  let at: V3 = { ...HOME }
  let t = 0
  let cutLength = 0
  let rapidLength = 0
  for (const tp of toolpaths) {
    if (!tp.moves.length) continue
    const index = ops.length
    const base = cutterOf(tp)
    const op: SimOp = { name: tp.name, tool: tp.tool ? `T${tp.tool.number} ${tp.tool.name}` : 'No tool', start: t, end: t, cutter: base }
    ops.push(op)
    const feed = Math.max(1, tp.feeds.feed) / 60
    const plunge = Math.max(1, tp.feeds.plunge || tp.feeds.feed) / 60
    const drillD = (x: number, y: number) => {
      const h = tp.intents.find((i) => i.k === 'vdrill' && !i.back && Math.abs(i.x - x) < 1e-6 && Math.abs(i.y - y) < 1e-6)
      return h && h.k === 'vdrill' ? h.d : undefined
    }
    let cutter = base
    const push = (b: V3, kind: SimKind, extra = 0, k = 1) => {
      const l = len3(at, b)
      if (l < 1e-9 && !extra) return
      const rate = (kind === 'rapid' ? RAPID_RATE / 60 : kind === 'plunge' || kind === 'drill' ? plunge : feed) * k
      const side = tp.kind === 'drill' && kind !== 'rapid' && kind !== 'drill' && Math.hypot(b.x - at.x, b.y - at.y) > 1e-9
      const seg: SimSeg = { a: at, b, kind, op: index, t0: t, t1: t + l / rate + extra, cutter }
      if (side) seg.side = true
      segs.push(seg)
      t = seg.t1
      if (kind === 'rapid') rapidLength += l
      else cutLength += l
      at = b
    }
    for (const m of simpleMoves(tp.moves)) {
      if (m.t === 'drill') {
        const d = drillD(m.x, m.y)
        cutter = d ? { ...base, r: d / 2 } : base
        push({ x: m.x, y: m.y, z: m.r }, 'rapid')
        push({ x: m.x, y: m.y, z: m.z }, 'drill', m.dwell ? m.dwell : 0)
        push({ x: m.x, y: m.y, z: m.r }, 'rapid', DRILL_DWELL_S / 2)
        cutter = base
      } else if (m.t === 'arc') {
        const kind: SimKind = m.f === 'cut' ? 'cut' : m.f
        for (const p of arcPoints(at, m)) push(p, kind)
      } else if (m.t === 'rapid') push({ x: m.x, y: m.y, z: m.z }, 'rapid')
      else {
        if (tp.kind === 'drill' && m.f === 'plunge' && Math.hypot(m.x - at.x, m.y - at.y) < 1e-9) {
          const d = drillD(m.x, m.y)
          cutter = d ? { ...base, r: d / 2 } : base
        }
        push({ x: m.x, y: m.y, z: m.z }, m.f === 'cut' ? 'cut' : m.f, 0, m.k ?? 1)
      }
    }
    op.end = t
  }
  return { segs, ops, total: t, cutLength, rapidLength, start: { ...HOME } }
}

/** First segment whose end time is at or after `t` (binary search). */
export function segIndexAt(tl: SimTimeline, t: number): number {
  let lo = 0
  let hi = tl.segs.length - 1
  if (hi < 0) return -1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (tl.segs[mid].t1 < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

const lerp = (a: V3, b: V3, k: number): V3 => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k })

/** Where the tool tip is at time `t`, and which segment and operation it is on. */
export function positionAt(tl: SimTimeline, t: number): { p: V3; seg: number; op: number; kind: SimKind | null } {
  if (!tl.segs.length || t <= 0) return { p: tl.start, seg: -1, op: tl.segs.length ? 0 : -1, kind: null }
  if (t >= tl.total) {
    const s = tl.segs[tl.segs.length - 1]
    return { p: s.b, seg: tl.segs.length - 1, op: s.op, kind: s.kind }
  }
  const i = segIndexAt(tl, t)
  const s = tl.segs[i]
  const k = s.t1 > s.t0 ? Math.min(1, Math.max(0, (t - s.t0) / (s.t1 - s.t0))) : 1
  return { p: lerp(s.a, s.b, k), seg: i, op: s.op, kind: s.kind }
}

// ---------------------------------------------------------------------------------------------
// Heightfield
// ---------------------------------------------------------------------------------------------

export interface Heightfield {
  nx: number
  ny: number
  cell: number
  length: number
  width: number
  thickness: number
  /** Surface Z per cell, row-major from y = 0; cell (i, j) centre = ((i + .5) cell, (j + .5) cell). */
  top: Float32Array
}

export function createHeightfield(length: number, width: number, thickness: number, cell?: number): Heightfield {
  const c = cell ?? Math.max(0.5, Math.max(length, width) / 500)
  const nx = Math.max(1, Math.ceil(length / c))
  const ny = Math.max(1, Math.ceil(width / c))
  return { nx, ny, cell: c, length, width, thickness, top: new Float32Array(nx * ny) }
}

export function resetHeightfield(hf: Heightfield) {
  hf.top.fill(0)
}

export function heightAt(hf: Heightfield, x: number, y: number): number {
  const i = Math.floor(x / hf.cell)
  const j = Math.floor(y / hf.cell)
  if (i < 0 || j < 0 || i >= hf.nx || j >= hf.ny) return NaN
  return hf.top[j * hf.nx + i]
}

/** Lower the heightfield to the cutter's bottom surface with the tip at `p`. */
export function stamp(hf: Heightfield, p: V3, c: Cutter) {
  const floor = -hf.thickness
  if (p.z >= 0) return
  const r = c.r
  const i0 = Math.max(0, Math.floor((p.x - r) / hf.cell))
  const i1 = Math.min(hf.nx - 1, Math.floor((p.x + r) / hf.cell))
  const j0 = Math.max(0, Math.floor((p.y - r) / hf.cell))
  const j1 = Math.min(hf.ny - 1, Math.floor((p.y + r) / hf.cell))
  for (let j = j0; j <= j1; j++) {
    const cy = (j + 0.5) * hf.cell - p.y
    for (let i = i0; i <= i1; i++) {
      const cx = (i + 0.5) * hf.cell - p.x
      const z = cutterZ(c, p.z, Math.hypot(cx, cy))
      if (z === Infinity) continue
      const k = j * hf.nx + i
      const v = Math.max(floor, z)
      if (v < hf.top[k]) hf.top[k] = v
    }
  }
}

/** Highest material above the tool tip anywhere under the cutter footprint (positive = collision). */
function interference(hf: Heightfield, p: V3, c: Cutter): number {
  if (p.z >= 0) return -Infinity
  const r = c.r
  let worst = -Infinity
  const i0 = Math.max(0, Math.floor((p.x - r) / hf.cell))
  const i1 = Math.min(hf.nx - 1, Math.floor((p.x + r) / hf.cell))
  const j0 = Math.max(0, Math.floor((p.y - r) / hf.cell))
  const j1 = Math.min(hf.ny - 1, Math.floor((p.y + r) / hf.cell))
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const d = Math.hypot((i + 0.5) * hf.cell - p.x, (j + 0.5) * hf.cell - p.y)
      if (d > r) continue
      const top = hf.top[j * hf.nx + i]
      if (top > -hf.thickness + 1e-6) worst = Math.max(worst, top - cutterZ(c, p.z, d))
    }
  return worst
}

/**
 * Carve segments between times t0 and t1 into the heightfield (call with increasing times, or
 * reset and replay from 0 to go back). Rapids are checked against the material instead of
 * carving it.
 */
export function carve(hf: Heightfield, tl: SimTimeline, t0: number, t1: number, warnings?: SimWarning[]) {
  if (t1 <= t0 || !tl.segs.length) return
  const step = hf.cell / 2
  for (let i = Math.max(0, segIndexAt(tl, t0)); i < tl.segs.length; i++) {
    const s = tl.segs[i]
    if (s.t0 >= t1) break
    if (s.side) continue
    const k0 = s.t1 > s.t0 ? Math.max(0, (t0 - s.t0) / (s.t1 - s.t0)) : 0
    const k1 = s.t1 > s.t0 ? Math.min(1, (t1 - s.t0) / (s.t1 - s.t0)) : 1
    if (k1 < k0) continue
    const a = lerp(s.a, s.b, k0)
    const b = lerp(s.a, s.b, k1)
    if (Math.min(a.z, b.z) >= 0) continue
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step))
    for (let q = 0; q <= n; q++) {
      const p = lerp(a, b, q / n)
      if (s.kind === 'rapid') {
        if (warnings && interference(hf, p, s.cutter) > 0.05) {
          warnings.push({ kind: 'rapid-in-material', op: s.op, at: p, t: s.t0 + (s.t1 - s.t0) * (k0 + ((k1 - k0) * q) / n), message: `Rapid move into material at X${p.x.toFixed(1)} Y${p.y.toFixed(1)} Z${p.z.toFixed(1)}` })
          break
        }
        continue
      }
      stamp(hf, p, s.cutter)
    }
  }
}

/** Run the whole program once and report rapids that pass through uncut material. */
export function checkRapids(tl: SimTimeline, length: number, width: number, thickness: number, cell = 1): SimWarning[] {
  const hf = createHeightfield(length, width, thickness, cell)
  const out: SimWarning[] = []
  carve(hf, tl, 0, tl.total + 1, out)
  const seen = new Set<string>()
  return out.filter((w) => {
    const key = `${w.op}:${Math.round(w.at.x)}:${Math.round(w.at.y)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export interface CutSummary {
  /** Share of the face area touched by the cutter. */
  cutPct: number
  /** Share of the face area cut through. */
  throughPct: number
  deepest: number
}

export function cutSummary(hf: Heightfield): CutSummary {
  let cut = 0
  let through = 0
  let deepest = 0
  for (const v of hf.top) {
    if (v < -1e-6) cut++
    if (v <= -hf.thickness + 1e-6) through++
    if (v < deepest) deepest = v
  }
  const n = hf.top.length || 1
  return { cutPct: (cut / n) * 100, throughPct: (through / n) * 100, deepest: -deepest }
}

/**
 * Pieces cut free by through cuts: every 4-connected island of material other than the largest
 * one (the part itself). 1 = loose (a slug or an offcut that drops away), 0 = kept or cut away.
 */
export function looseMask(hf: Heightfield): Uint8Array {
  const { nx, ny, top, thickness } = hf
  const n = nx * ny
  const label = new Int32Array(n).fill(-1)
  const sizes: number[] = []
  const stack: number[] = []
  const solid = (k: number) => top[k] > -thickness + 1e-6
  for (let s = 0; s < n; s++) {
    if (label[s] >= 0 || !solid(s)) continue
    const id = sizes.length
    let size = 0
    label[s] = id
    stack.push(s)
    while (stack.length) {
      const k = stack.pop()!
      size++
      const i = k % nx
      const nb = [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, k - nx, k + nx]
      for (const q of nb) {
        if (q < 0 || q >= n || label[q] >= 0 || !solid(q)) continue
        label[q] = id
        stack.push(q)
      }
    }
    sizes.push(size)
  }
  const keep = sizes.indexOf(Math.max(...sizes))
  const out = new Uint8Array(n)
  for (let k = 0; k < n; k++) if (label[k] >= 0 && label[k] !== keep) out[k] = 1
  return out
}

/**
 * Shaded top view as RGBA pixels (one per cell, row 0 = y max so it draws upright).
 * `through: true` shows only what is cut through (material-cut view). `loose` (from
 * `looseMask`) hides pieces that fall away in the through view and fades them otherwise.
 */
export function shadeHeightfield(hf: Heightfield, out: Uint8ClampedArray, opt: { base: [number, number, number]; through?: boolean; loose?: Uint8Array } = { base: [214, 186, 140] }) {
  const { nx, ny, top, cell, thickness } = hf
  const [br, bg, bb] = opt.base
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      const o = ((ny - 1 - j) * nx + i) * 4
      const v = top[k]
      const loose = opt.loose?.[k] === 1
      if (v <= -thickness + 1e-6 || (loose && opt.through)) {
        out[o] = 24
        out[o + 1] = 26
        out[o + 2] = 31
        out[o + 3] = 0
        continue
      }
      if (opt.through) {
        out[o] = br
        out[o + 1] = bg
        out[o + 2] = bb
        out[o + 3] = 255
        continue
      }
      const l = top[j * nx + Math.max(0, i - 1)]
      const r = top[j * nx + Math.min(nx - 1, i + 1)]
      const d = top[Math.max(0, j - 1) * nx + i]
      const u = top[Math.min(ny - 1, j + 1) * nx + i]
      const gx = (r - l) / (2 * cell)
      const gy = (u - d) / (2 * cell)
      // light from the upper left
      const shade = Math.max(0.35, Math.min(1.25, 1 + (gx * -0.7 + gy * 0.7) * 0.9))
      const depth = Math.min(1, -v / Math.max(1e-6, thickness))
      const dim = 1 - depth * 0.55
      out[o] = Math.min(255, br * dim * shade)
      out[o + 1] = Math.min(255, bg * dim * shade)
      out[o + 2] = Math.min(255, bb * dim * shade + depth * 30)
      out[o + 3] = loose ? 110 : 255
    }
  }
}
