/**
 * Fill with holes (CAD-18): fill the area inside closed boundary shapes (shapes inside them are
 * islands and stay clear) with an array of holes: a grid, a staggered grid, or rings round a
 * centre. Every hole keeps `margin` mm of material from the boundary and the islands (measured from
 * the hole's edge). The pattern is centred on the area so it comes out even on both sides.
 */
import { offset } from './kernel'
import { boxOf, type Contour, type P, pointInContour } from './geom'

export interface HoleFill {
  pattern: 'grid' | 'staggered' | 'radial'
  /** Hole diameter, mm. */
  diameter: number
  /** Edge of the boundary (and islands) to the edge of a hole, mm. */
  margin: number
  /** Grid: centre to centre along X and Y, mm (staggered: Y is the row pitch). */
  spacingX: number
  spacingY: number
  /** Grid angle, degrees. */
  angle: number
  /** Rings: distance between rings and between holes on a ring, mm; centre (default: the middle of the area). */
  ringStep: number
  holeStep: number
  centre?: P
}

export const DEFAULT_FILL: HoleFill = { pattern: 'grid', diameter: 5, margin: 10, spacingX: 32, spacingY: 32, angle: 0, ringStep: 32, holeStep: 32 }

/** Problems with the settings (empty = fine). */
export function fillProblems(f: HoleFill): string[] {
  const out: string[] = []
  if (!(f.diameter > 0)) out.push('The hole diameter must be above zero.')
  if (f.margin < 0) out.push('The margin cannot be below zero.')
  if (f.pattern === 'radial') {
    if (!(f.ringStep >= f.diameter)) out.push('Rings must be at least one hole diameter apart.')
    if (!(f.holeStep >= f.diameter)) out.push('Holes on a ring must be at least one hole diameter apart.')
  } else {
    if (!(f.spacingX >= f.diameter) || !(f.spacingY >= (f.pattern === 'staggered' ? f.diameter / 2 : f.diameter))) out.push('The spacing must be at least one hole diameter (holes would run into each other).')
  }
  return out
}

/** Hole centres inside the boundaries. `limit` stops runaway fills (too small a spacing). */
export function fillHoles(boundary: Contour[], f: HoleFill, limit = 20000): { centres: P[]; error?: string } {
  const problems = fillProblems(f)
  if (problems.length) return { centres: [], error: problems.join(' ') }
  const closed = boundary.filter((c) => c.closed && c.segs.length)
  if (!closed.length) return { centres: [], error: 'Pick at least one closed shape to fill.' }
  const r = f.diameter / 2
  // where a hole centre may go: the area shrunk by the margin plus the radius
  const allowed = offset(closed, -(f.margin + r), 'round')
  if (!allowed.length) return { centres: [], error: 'The area is too small for one hole with this margin.' }
  const inside = (p: P) => allowed.reduce((n, c) => n + Number(pointInContour(c, p)), 0) % 2 === 1
  const b = boxOf(allowed)
  const out: P[] = []
  const push = (p: P) => {
    if (inside(p)) out.push({ x: Math.round(p.x * 1e6) / 1e6, y: Math.round(p.y * 1e6) / 1e6 })
  }
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  if (f.pattern === 'radial') {
    const c = f.centre ?? { x: cx, y: cy }
    const R = Math.max(...[
      [b.minX, b.minY],
      [b.maxX, b.minY],
      [b.minX, b.maxY],
      [b.maxX, b.maxY],
    ].map(([x, y]) => Math.hypot(x - c.x, y - c.y)))
    push(c)
    for (let k = 1; k * f.ringStep <= R + 1e-9; k++) {
      const rr = k * f.ringStep
      const n = Math.max(1, Math.floor((2 * Math.PI * rr) / f.holeStep + 1e-9))
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n
        push({ x: c.x + rr * Math.cos(a), y: c.y + rr * Math.sin(a) })
        if (out.length > limit) return { centres: [], error: `More than ${limit} holes: use a bigger spacing.` }
      }
    }
    return { centres: out }
  }
  // grid in its own (turned) frame, centred on the area
  const t = (f.angle * Math.PI) / 180
  const cos = Math.cos(t)
  const sin = Math.sin(t)
  const toWorld = (u: number, v: number): P => ({ x: cx + u * cos - v * sin, y: cy + u * sin + v * cos })
  const half = Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2
  const sx = f.spacingX
  const sy = f.spacingY
  // columns and rows symmetric about the middle (an even count straddles it)
  const span = (w: number, s: number) => {
    const n = Math.floor((2 * w) / s) + 1
    return { n, start: -((n - 1) * s) / 2 }
  }
  const cols = f.angle % 90 === 0 ? span((f.angle % 180 === 0 ? b.maxX - b.minX : b.maxY - b.minY) / 2, sx) : span(half, sx)
  const rows = f.angle % 90 === 0 ? span((f.angle % 180 === 0 ? b.maxY - b.minY : b.maxX - b.minX) / 2, sy) : span(half, sy)
  if (cols.n * rows.n > limit * 4) return { centres: [], error: `More than ${limit} holes: use a bigger spacing.` }
  for (let j = 0; j < rows.n; j++) {
    const v = rows.start + j * sy
    const shift = f.pattern === 'staggered' && j % 2 === 1 ? sx / 2 : 0
    for (let i = -1; i <= cols.n; i++) {
      const u = cols.start + i * sx + shift
      // the staggered rows reach half a step further on one side
      if (i === -1 && shift === 0) continue
      if (i === cols.n && shift === 0) continue
      push(toWorld(u, v))
    }
    if (out.length > limit) return { centres: [], error: `More than ${limit} holes: use a bigger spacing.` }
  }
  out.sort((a, b2) => a.y - b2.y || a.x - b2.x)
  return { centres: out }
}
