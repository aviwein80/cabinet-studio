/**
 * Laying a solid panel into the part frame (SOL-01 "minimum bounding-box alignment"):
 *
 * 1. Thickness direction: the direction shared by the largest area of opposite flat faces (the
 *    two big faces of a panel).
 * 2. Face 1 (up): the side the milled features (pockets, cut-out steps) open on, since only
 *    drilling can be done from the underside (face 6) in a turned-over program; else the side
 *    with more holes; else as the file has it. A face can also be named.
 * 3. Turn in the plane: the smallest rectangle round the panel's outline (rotating calipers on the
 *    convex hull), its longer side along X. Or along a given direction (grain).
 *
 * Part frame: x along the length, y along the width, z up out of face 1, z = 0 at face 1, the
 * lowest x and y at 0 (as `ModelPlacement` puts a model at `at = [0, 0, 0]`).
 */
import { cross3, dot3, unit3 } from './classify'
import type { SolidBody, V3 } from './types'

export interface PanelFrame {
  /** Rows: the part's x, y and z axes in file coordinates (a proper rotation). */
  R: [V3, V3, V3]
  /** Part point = R · file point - origin. */
  origin: V3
  length: number
  width: number
  thickness: number
  warnings: string[]
}

export interface AlignOptions {
  /** This face's outward normal becomes up (face 1). */
  topFace?: number
  /** Lay the length along this direction (file coordinates), e.g. from a face that shows the grain. */
  along?: V3
}

const ANG = 1e-6

/** Apply the frame to a file point. */
export function toPart(f: Pick<PanelFrame, 'R' | 'origin'>, p: V3): V3 {
  return [dot3(f.R[0], p) - f.origin[0], dot3(f.R[1], p) - f.origin[1], dot3(f.R[2], p) - f.origin[2]]
}

/** Convex hull of 2D points (monotone chain), counter-clockwise. */
export function hull2(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cr = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: [number, number][] = []
  for (const q of p) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 1e-12) lo.pop()
    lo.push(q)
  }
  const up: [number, number][] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 1e-12) up.pop()
    up.push(q)
  }
  return [...lo.slice(0, -1), ...up.slice(0, -1)]
}

/** Smallest-area rectangle round a convex polygon: direction (unit) of one side, and its sizes. */
export function minAreaRect(h: [number, number][]): { dir: [number, number]; a: number; b: number } {
  let best = { dir: [1, 0] as [number, number], a: 0, b: 0, area: Infinity }
  const n = h.length
  for (let i = 0; i < n; i++) {
    const p = h[i]
    const q = h[(i + 1) % n]
    const l = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (l < 1e-9) continue
    const d: [number, number] = [(q[0] - p[0]) / l, (q[1] - p[1]) / l]
    let a0 = Infinity
    let a1 = -Infinity
    let b0 = Infinity
    let b1 = -Infinity
    for (const r of h) {
      const u = r[0] * d[0] + r[1] * d[1]
      const v = -r[0] * d[1] + r[1] * d[0]
      a0 = Math.min(a0, u)
      a1 = Math.max(a1, u)
      b0 = Math.min(b0, v)
      b1 = Math.max(b1, v)
    }
    const area = (a1 - a0) * (b1 - b0)
    if (area < best.area * (1 - 1e-9)) best = { dir: d, a: a1 - a0, b: b1 - b0, area }
  }
  return best
}

export function panelFrame(body: SolidBody, opt: AlignOptions = {}): PanelFrame {
  const warnings: string[] = []
  const planes = body.faces.filter((f) => f.surface.kind === 'plane')
  if (!planes.length) throw new Error('This solid has no flat faces, so it cannot be laid flat as a panel. Machine it as a 3D model instead.')
  // 1. thickness direction: pairs of opposite flat faces, by area
  const dirs: { n: V3; area: number; plus: number; minus: number }[] = []
  for (const f of planes) {
    const n = f.surface.n!
    let d = dirs.find((x) => Math.abs(Math.abs(dot3(x.n, n)) - 1) < ANG)
    if (!d) dirs.push((d = { n, area: 0, plus: 0, minus: 0 }))
    const s = dot3(d.n, n) > 0
    if (s) d.plus += f.area
    else d.minus += f.area
    d.area += f.area
  }
  const paired = dirs.filter((d) => d.plus > 0 && d.minus > 0)
  const pick = (paired.length ? paired : dirs).sort((a, b) => Math.min(b.plus, b.minus) - Math.min(a.plus, a.minus) || b.area - a.area)[0]
  if (!paired.length) warnings.push('No two opposite flat faces: the largest flat face is taken as face 1.')
  let up = pick.n

  // 2. which side is face 1
  if (opt.topFace) {
    const f = body.faces.find((x) => x.id === opt.topFace)
    if (f?.surface.kind === 'plane' && Math.abs(Math.abs(dot3(f.surface.n!, up)) - 1) < ANG) up = f.surface.n!
    else if (f?.surface.kind === 'plane') {
      up = f.surface.n!
      warnings.push(`Face ${opt.topFace} is not one of the panel's big faces; it is put up as asked.`)
    } else warnings.push(`Face ${opt.topFace} is not flat, so it cannot be face 1.`)
  } else up = sideWithFeatures(body, up)

  // positions along the up direction
  const P = body.positions
  let zmax = -Infinity
  let zmin = Infinity
  for (let i = 0; i < P.length; i += 3) {
    const z = up[0] * P[i] + up[1] * P[i + 1] + up[2] * P[i + 2]
    if (z > zmax) zmax = z
    if (z < zmin) zmin = z
  }

  // 3. turn in the plane
  const [b1, b2] = planeBasis(up)
  let ex: V3
  if (opt.along) {
    const a = unit3(sub3(opt.along, mul3(up, dot3(opt.along, up))))
    if (Math.hypot(...a) < 0.5) {
      warnings.push('The grain direction is square to the panel; the smallest rectangle is used.')
      ex = calipers(P, b1, b2)
    } else ex = a
  } else ex = calipers(P, b1, b2)
  let ey = cross3(up, ex)
  // longer side along X
  const ext = (d: V3) => {
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < P.length; i += 3) {
      const v = d[0] * P[i] + d[1] * P[i + 1] + d[2] * P[i + 2]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    return { lo, hi, size: hi - lo }
  }
  if (!opt.along && ext(ey).size > ext(ex).size + 1e-9) {
    ex = ey
    ey = cross3(up, ex)
  }
  // of the two ways round, the one whose length runs along the file axis it is closest to
  const k = [0, 1, 2].sort((i, j) => Math.abs(ex[j]) - Math.abs(ex[i]))[0]
  if (!opt.along && ex[k] < 0) {
    ex = mul3(ex, -1)
    ey = mul3(ey, -1)
  }
  const R: [V3, V3, V3] = [ex, ey, up]
  const X = ext(ex)
  const Y = ext(ey)
  return { R, origin: [X.lo, Y.lo, zmax], length: X.size, width: Y.size, thickness: zmax - zmin, warnings }
}

const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul3 = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]

/** Two unit vectors in the plane square to `n`, the first along the file axis most in that plane. */
function planeBasis(n: V3): [V3, V3] {
  const axes: V3[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  const a = axes.sort((p, q) => Math.abs(dot3(p, n)) - Math.abs(dot3(q, n)))[0]
  const e1 = unit3(sub3(a, mul3(n, dot3(a, n))))
  return [e1, cross3(n, e1)]
}

/** Direction (file coordinates) of one side of the smallest rectangle round the projected points. */
function calipers(P: Float64Array, b1: V3, b2: V3): V3 {
  const pts: [number, number][] = []
  for (let i = 0; i < P.length; i += 3) pts.push([b1[0] * P[i] + b1[1] * P[i + 1] + b1[2] * P[i + 2], b2[0] * P[i] + b2[1] * P[i + 1] + b2[2] * P[i + 2]])
  const r = minAreaRect(hull2(pts))
  // snap tiny turns away (a side within 1e-9 rad of a file axis stays exactly on it)
  let [dx, dy] = r.dir
  if (Math.abs(dy) < 1e-9) [dx, dy] = [Math.sign(dx) || 1, 0]
  else if (Math.abs(dx) < 1e-9) [dx, dy] = [0, Math.sign(dy) || 1]
  return unit3(add3(mul3(b1, dx), mul3(b2, dy)))
}

const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]

/**
 * Up direction (+n or -n): the side pockets open on (flat floors facing that way, not at either
 * big face), else the side more blind holes open on, else +n.
 */
function sideWithFeatures(body: SolidBody, n: V3): V3 {
  const P = body.positions
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < P.length; i += 3) {
    const z = n[0] * P[i] + n[1] * P[i + 1] + n[2] * P[i + 2]
    lo = Math.min(lo, z)
    hi = Math.max(hi, z)
  }
  const eps = 1e-6
  let floorsPlus = 0
  let floorsMinus = 0
  let holesPlus = 0
  let holesMinus = 0
  for (const f of body.faces) {
    const s = f.surface
    if (s.kind === 'plane') {
      const c = dot3(s.n!, n)
      const level = s.d! * Math.sign(c)
      if (Math.abs(Math.abs(c) - 1) > ANG || level <= lo + eps || level >= hi - eps) continue
      // a floor facing +n is a pocket opening on the +n side (unless it is a hole's floor, counted below)
      if (c > 0) floorsPlus += f.area
      else floorsMinus += f.area
    } else if (s.kind === 'cylinder' && s.concave && Math.abs(Math.abs(dot3(s.v!, n)) - 1) < ANG) {
      // which big face the hole reaches
      let top = -Infinity
      let bot = Infinity
      for (let t = f.first; t <= f.last; t++)
        for (let k = 0; k < 3; k++) {
          const v = body.indices[t * 3 + k]
          const z = n[0] * P[v * 3] + n[1] * P[v * 3 + 1] + n[2] * P[v * 3 + 2]
          top = Math.max(top, z)
          bot = Math.min(bot, z)
        }
      const toTop = top >= hi - eps
      const toBot = bot <= lo + eps
      if (toTop && !toBot) holesPlus++
      if (toBot && !toTop) holesMinus++
    }
  }
  // hole floors are small; pockets weigh more than holes
  const score = (floors: number, holes: number) => floors * 1e3 + holes
  return score(floorsMinus, holesMinus) > score(floorsPlus, holesPlus) ? mul3(n, -1) : n
}
