/**
 * Writes tests/fixtures/trace/logo.png: a small logo with anti-aliased edges (4 x 4 samples per
 * pixel) for the image-trace tests. 400 x 240 px: a ring (centre 100,120; radii 80 and 50), a
 * 70 px square (190..260, 85..155), an L (300,40 - 330,170 - 380,200), and a 2 x 2 px speck.
 * Run: npx tsx scripts/fixtures/make_trace_fixture.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { encodePng } from '../../tests/png'

const W = 400
const H = 240
const inside = (x: number, y: number) => {
  const r = Math.hypot(x - 100, y - 120)
  if (r <= 80 && r >= 50) return true
  if (x >= 190 && x <= 260 && y >= 85 && y <= 155) return true
  if ((x >= 300 && x <= 330 && y >= 40 && y <= 200) || (x >= 300 && x <= 380 && y >= 170 && y <= 200)) return true
  if (x >= 385 && x <= 387 && y >= 5 && y <= 7) return true
  return false
}
const rgba = new Uint8Array(W * H * 4)
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    let n = 0
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) n += Number(inside(x + (i + 0.5) / 4, y + (j + 0.5) / 4))
    const v = Math.round(255 * (1 - n / 16))
    rgba.set([v, Math.round(v * 0.9 + 25), v, 255], (y * W + x) * 4)
  }
const out = path.join(import.meta.dirname, '../../tests/fixtures/trace/logo.png')
fs.writeFileSync(out, encodePng(W, H, rgba))
console.log(`wrote ${out}`)
