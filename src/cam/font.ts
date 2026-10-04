/**
 * Built-in single-stroke engraving font, drawn for Cabinet Studio on a 4 x 6 grid
 * (cap height 6, advance 6). Lower case uses the capitals.
 */
import { type Contour, fitPoints, polyline, type P, pt } from './geom'

const G: Record<string, string> = {
  A: '0,0 2,6 4,0|1,3 3,3',
  B: '0,0 0,6 3,6 4,5 4,4 3,3 0,3|3,3 4,2 4,1 3,0 0,0',
  C: '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1',
  D: '0,0 0,6 2,6 4,4 4,2 2,0 0,0',
  E: '4,0 0,0 0,6 4,6|0,3 3,3',
  F: '0,0 0,6 4,6|0,3 3,3',
  G: '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,3 2,3',
  H: '0,0 0,6|4,0 4,6|0,3 4,3',
  I: '1,0 3,0|2,0 2,6|1,6 3,6',
  J: '0,1 1,0 2,0 3,1 3,6|2,6 4,6',
  K: '0,0 0,6|4,6 0,2|1,3 4,0',
  L: '0,6 0,0 4,0',
  M: '0,0 0,6 2,3 4,6 4,0',
  N: '0,0 0,6 4,0 4,6',
  O: '1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0',
  P: '0,0 0,6 3,6 4,5 4,4 3,3 0,3',
  Q: '1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0|2,2 4,0',
  R: '0,0 0,6 3,6 4,5 4,4 3,3 0,3|2,3 4,0',
  S: '4,5 3,6 1,6 0,5 0,4 1,3 3,3 4,2 4,1 3,0 1,0 0,1',
  T: '0,6 4,6|2,6 2,0',
  U: '0,6 0,1 1,0 3,0 4,1 4,6',
  V: '0,6 2,0 4,6',
  W: '0,6 1,0 2,4 3,0 4,6',
  X: '0,0 4,6|0,6 4,0',
  Y: '0,6 2,3 4,6|2,3 2,0',
  Z: '0,6 4,6 0,0 4,0',
  '0': '1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0|0,1 4,5',
  '1': '1,5 2,6 2,0|1,0 3,0',
  '2': '0,5 1,6 3,6 4,5 4,4 0,0 4,0',
  '3': '0,5 1,6 3,6 4,5 4,4 3,3 4,2 4,1 3,0 1,0 0,1|1,3 3,3',
  '4': '3,0 3,6 0,2 4,2',
  '5': '4,6 0,6 0,3 3,3 4,2 4,1 3,0 0,0',
  '6': '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,2 3,3 0,3',
  '7': '0,6 4,6 1,0',
  '8': '1,3 0,4 0,5 1,6 3,6 4,5 4,4 3,3 1,3 0,2 0,1 1,0 3,0 4,1 4,2 3,3',
  '9': '0,1 1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,4 1,3 4,3',
  '-': '1,3 3,3',
  '.': '2,0 2,0.4',
  ',': '2,0.5 1.5,-1',
  '/': '0,0 4,6',
  ':': '2,1 2,1.4|2,4 2,4.4',
  '(': '3,6 1.5,4 1.5,2 3,0',
  ')': '1,6 2.5,4 2.5,2 1,0',
  '+': '2,1 2,5|0,3 4,3',
  '=': '0,2 4,2|0,4 4,4',
  _: '0,0 4,0',
  '#': '1,0 1,6|3,0 3,6|0,2 4,2|0,4 4,4',
  "'": '2,6 2,4.5',
  '"': '1.5,6 1.5,4.5|2.5,6 2.5,4.5',
  '!': '2,6 2,2|2,0 2,0.4',
  '?': '0,5 1,6 3,6 4,5 4,4 2,3 2,2|2,0 2,0.4',
}

const strokes = (ch: string): P[][] => {
  const def = G[ch] ?? G[ch.toUpperCase()]
  if (!def) return []
  return def.split('|').map((s) => s.split(' ').map((q) => pt(Number(q.split(',')[0]), Number(q.split(',')[1]))))
}

export const ADVANCE = 6

export function hasGlyph(ch: string) {
  return ch === ' ' || !!(G[ch] ?? G[ch.toUpperCase()])
}

/** Width of a text string at a given cap height. */
export function textWidth(text: string, height: number, spacing = 1) {
  return text.length ? ((text.length * ADVANCE - (ADVANCE - 4)) * height * spacing) / 6 : 0
}

/**
 * Text as open stroke contours. Straight text runs from `at` along `angle` (radians); arc text
 * centres the string on the top of the arc and reads clockwise around it.
 */
export function strokeText(text: string, at: P, height: number, angle = 0, spacing = 1, onArc?: { c: P; r: number }): Contour[] {
  const s = height / 6
  const out: Contour[] = []
  const total = textWidth(text, height, spacing)
  ;[...text].forEach((ch, i) => {
    const x0 = i * ADVANCE * s * spacing
    for (const stroke of strokes(ch)) {
      const mapped = stroke.map((p) => {
        const lx = x0 + p.x * s
        const ly = p.y * s
        if (onArc) {
          const a = Math.PI / 2 - (lx - total / 2) / onArc.r
          const r = onArc.r + ly
          return pt(onArc.c.x + r * Math.cos(a), onArc.c.y + r * Math.sin(a))
        }
        return pt(at.x + lx * Math.cos(angle) - ly * Math.sin(angle), at.y + lx * Math.sin(angle) + ly * Math.cos(angle))
      })
      if (mapped.length < 2) continue
      if (onArc) {
        const dense: P[] = []
        for (let k = 0; k + 1 < mapped.length; k++) for (let t = 0; t < 8; t++) dense.push(pt(mapped[k].x + ((mapped[k + 1].x - mapped[k].x) * t) / 8, mapped[k].y + ((mapped[k + 1].y - mapped[k].y) * t) / 8))
        dense.push(mapped[mapped.length - 1])
        out.push({ segs: fitPoints(dense, false, 0.02), closed: false })
      } else out.push(polyline(mapped, false))
    }
  })
  return out
}
