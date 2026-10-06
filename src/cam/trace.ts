/**
 * Image trace (NEW-06): a picture (a logo, a scanned drawing) turned into closed contours. Our own
 * method, written for this app:
 *
 * 1. Each pixel is ink or paper by a brightness threshold (transparent pixels are paper; "invert"
 *    traces light ink on a dark ground).
 * 2. Specks of ink and pin-holes smaller than `despeckle` pixels are cleaned away.
 * 3. The borders between ink and paper pixels are followed round, so every loop is closed by
 *    construction (where two ink pixels touch only at a corner they count as joined).
 * 4. Each loop is turned into a polygon through the middle of its pixel edges, sharp corners are
 *    found (where the direction turns more than `cornerAngle` within a few pixels) and kept, the
 *    rest is smoothed, and the pieces between corners are fitted with lines and arcs.
 * 5. Pixels become millimetres (`mmPerPixel`), image Y (down) becomes part Y (up); outer loops run
 *    counter-clockwise and holes clockwise.
 */
import { fitPoints, type Contour, type P } from './geom'
import { normaliseWinding } from './kernel'

export interface ImagePixels {
  width: number
  height: number
  /** RGBA, 4 bytes per pixel, rows from the top. */
  data: Uint8Array | Uint8ClampedArray
}

export interface TraceOptions {
  /** 0-255: pixels darker than this are ink (lighter when inverted). */
  threshold: number
  invert: boolean
  /** Specks and pin-holes smaller than this many pixels are removed. */
  despeckle: number
  /** Smoothing passes (0 = follow the pixels). */
  smoothing: number
  /** Turns sharper than this (degrees) within a few pixels are kept as sharp corners. */
  cornerAngle: number
  /** Largest gap between the fitted lines/arcs and the smoothed outline, in pixels. */
  fitTolerance: number
  /** Size of a pixel in the part, mm. */
  mmPerPixel: number
  /** Where the image's lower-left corner goes on the part, mm. */
  origin: P
}

export const DEFAULT_TRACE: TraceOptions = { threshold: 128, invert: false, despeckle: 10, smoothing: 2, cornerAngle: 60, fitTolerance: 0.4, mmPerPixel: 0.25, origin: { x: 0, y: 0 } }

export interface TraceResult {
  contours: Contour[]
  /** Ink pixels after cleaning, and how many specks / pin-holes were removed. */
  ink: number
  specks: number
  pinholes: number
  /** Corners kept sharp. */
  corners: number
}

/** Ink mask: 1 = ink. */
export function inkMask(img: ImagePixels, o: Pick<TraceOptions, 'threshold' | 'invert'>): Uint8Array {
  const { width: W, height: H, data } = img
  const m = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) {
    const a = data[i * 4 + 3] / 255
    // on white paper: transparent shows white
    const lum = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) * a + 255 * (1 - a)
    m[i] = (o.invert ? lum > o.threshold : lum < o.threshold) ? 1 : 0
  }
  return m
}

/** Remove ink islands and fill paper holes smaller than `min` pixels (4-connected; the paper round the image is kept). */
export function despeckle(m: Uint8Array, W: number, H: number, min: number): { specks: number; pinholes: number } {
  if (min <= 0) return { specks: 0, pinholes: 0 }
  const seen = new Uint8Array(W * H)
  const stack: number[] = []
  let specks = 0
  let pinholes = 0
  for (let s = 0; s < W * H; s++) {
    if (seen[s]) continue
    const v = m[s]
    const comp: number[] = []
    let border = false
    stack.push(s)
    seen[s] = 1
    while (stack.length) {
      const i = stack.pop()!
      comp.push(i)
      const x = i % W
      const y = (i - x) / W
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]
      for (const j of nb)
        if (j >= 0 && !seen[j] && m[j] === v) {
          seen[j] = 1
          stack.push(j)
        }
    }
    if (comp.length >= min) continue
    if (v === 1) {
      specks++
      for (const i of comp) m[i] = 0
    } else if (!border) {
      pinholes++
      for (const i of comp) m[i] = 1
    }
  }
  return { specks, pinholes }
}

/**
 * Follow the borders between ink and paper: closed loops of pixel-corner points (image
 * coordinates, Y down), ink on the right of travel. Diagonal ink pixels count as joined.
 */
export function borderLoops(m: Uint8Array, W: number, H: number): P[][] {
  const ink = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && m[y * W + x] === 1
  // outgoing border edges by start corner: key = y * (W + 1) + x
  const out = new Map<number, number[]>()
  const key = (x: number, y: number) => y * (W + 1) + x
  const edges: [number, number, number, number][] = []
  const addEdge = (x0: number, y0: number, x1: number, y1: number) => {
    const id = edges.length
    edges.push([x0, y0, x1, y1])
    const k = key(x0, y0)
    const l = out.get(k)
    if (l) l.push(id)
    else out.set(k, [id])
  }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!ink(x, y)) continue
      // round the pixel clockwise on screen (Y down): ink on the right of each edge
      if (!ink(x, y - 1)) addEdge(x, y, x + 1, y)
      if (!ink(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1)
      if (!ink(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1)
      if (!ink(x - 1, y)) addEdge(x, y + 1, x, y)
    }
  const used = new Uint8Array(edges.length)
  const loops: P[][] = []
  for (let e0 = 0; e0 < edges.length; e0++) {
    if (used[e0]) continue
    const loop: P[] = []
    let e = e0
    for (;;) {
      used[e] = 1
      const [x0, y0, x1, y1] = edges[e]
      loop.push({ x: x0, y: y0 })
      const dx = x1 - x0
      const dy = y1 - y0
      const cand = (out.get(key(x1, y1)) ?? []).filter((c) => !used[c])
      if (!cand.length) break
      // where two ink pixels touch only at a corner there are two ways on: turn left, onto the
      // other pixel, so the ink stays joined (turning right would go round this pixel alone)
      const turn = (c: number) => {
        const [a, b, cc, d] = edges[c]
        const ex = cc - a
        const ey = d - b
        return ex === dy && ey === -dx ? 0 : ex === dx && ey === dy ? 1 : 2
      }
      cand.sort((a, b) => turn(a) - turn(b))
      e = cand[0]
    }
    if (loop.length >= 4) loops.push(loop)
  }
  return loops
}

/** One border loop as smooth lines and arcs (pixel units, image Y down). */
export function smoothLoop(loop: P[], o: Pick<TraceOptions, 'smoothing' | 'cornerAngle' | 'fitTolerance'>): { segs: Contour['segs']; corners: number } {
  const n = loop.length
  // through the middle of each pixel edge: takes the steps out of slanted edges
  let p: P[] = loop.map((a, i) => {
    const b = loop[(i + 1) % n]
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  })
  // corners: the direction over a few pixels before and after turns more than the corner angle
  const k = Math.max(2, Math.min(4, Math.floor(n / 8)))
  const turnAt = (i: number) => {
    const a = p[(i - k + n) % n]
    const b = p[i]
    const c = p[(i + k) % n]
    const u = Math.atan2(b.y - a.y, b.x - a.x)
    const v = Math.atan2(c.y - b.y, c.x - b.x)
    let d = Math.abs(v - u)
    if (d > Math.PI) d = 2 * Math.PI - d
    return (d * 180) / Math.PI
  }
  const turns = p.map((_, i) => turnAt(i))
  const corner = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (turns[i] <= o.cornerAngle) continue
    // keep the sharpest point of each bend
    let best = true
    for (let j = 1; j <= k; j++) if (turns[(i + j) % n] > turns[i] || turns[(i - j + n) % n] >= turns[i]) best = false
    if (best) corner[i] = 1
  }
  // a corner sits where the two straight runs into it meet: put it on the pixel corner where the
  // border turns (the start or the end of this pixel edge)
  const turnsAtVertex = (v: number) => {
    const a = loop[(v - 1 + n) % n]
    const b = loop[v]
    const c = loop[(v + 1) % n]
    return Math.sign(b.x - a.x) !== Math.sign(c.x - b.x) || Math.sign(b.y - a.y) !== Math.sign(c.y - b.y)
  }
  for (let i = 0; i < n; i++) {
    if (!corner[i]) continue
    const end = (i + 1) % n
    if (turnsAtVertex(end) && !turnsAtVertex(i)) p[i] = { ...loop[end] }
    else if (turnsAtVertex(i) && !turnsAtVertex(end)) p[i] = { ...loop[i] }
  }
  for (let it = 0; it < o.smoothing; it++)
    p = p.map((q, i) => {
      if (corner[i]) return q
      const a = p[(i - 1 + n) % n]
      const c = p[(i + 1) % n]
      return { x: (a.x + 2 * q.x + c.x) / 4, y: (a.y + 2 * q.y + c.y) / 4 }
    })
  const idx = [...corner.keys()].filter((i) => corner[i])
  if (!idx.length) return { segs: fitPoints(p, true, o.fitTolerance), corners: 0 }
  // fit each run from corner to corner, so corners stay sharp
  const segs: Contour['segs'] = []
  for (let c = 0; c < idx.length; c++) {
    const from = idx[c]
    const to = idx[(c + 1) % idx.length]
    const run: P[] = []
    for (let i = from; ; i = (i + 1) % n) {
      run.push(p[i])
      if (i === to && run.length > 1) break
      if (run.length > n + 1) break
    }
    segs.push(...fitPoints(run, false, o.fitTolerance))
  }
  return { segs, corners: idx.length }
}

/** Trace an image to closed contours in part millimetres. */
export function traceImage(img: ImagePixels, opt: TraceOptions): TraceResult {
  const { width: W, height: H } = img
  const m = inkMask(img, opt)
  const clean = despeckle(m, W, H, opt.despeckle)
  let ink = 0
  for (let i = 0; i < m.length; i++) ink += m[i]
  const s = opt.mmPerPixel
  const toPart = (q: P): P => ({ x: Math.round((opt.origin.x + q.x * s) * 1e6) / 1e6, y: Math.round((opt.origin.y + (H - q.y) * s) * 1e6) / 1e6 })
  const out: Contour[] = []
  let corners = 0
  for (const loop of borderLoops(m, W, H)) {
    const r = smoothLoop(loop, opt)
    corners += r.corners
    if (r.segs.length < 2) continue
    const segs = r.segs.map((g) => (g.k === 'L' ? { k: 'L' as const, a: toPart(g.a), b: toPart(g.b) } : { k: 'A' as const, a: toPart(g.a), b: toPart(g.b), c: toPart(g.c), ccw: !g.ccw }))
    out.push({ closed: true, segs })
  }
  return { contours: normaliseWinding(out), ink, specks: clean.specks, pinholes: clean.pinholes, corners }
}
