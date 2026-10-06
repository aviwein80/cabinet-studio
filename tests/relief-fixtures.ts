/**
 * Relief test data made in code (ART-01): a relief block like one exported from relief software
 * (carved top, upright sides and a flat base), the same relief as a 16-bit height-map PNG, and a
 * small PNG writer for any colour type and bit depth (rows filtered with every filter type).
 */
import zlib from 'node:zlib'
import type { Soup } from './mesh-fixtures'

/** Depth fraction of the test relief: 0 on its edge, about 1 in the middle, with a ripple. */
export function reliefShape(s: number, t: number): number {
  const g = 0.25 * (1 - Math.cos(2 * Math.PI * s)) * (1 - Math.cos(2 * Math.PI * t))
  return g * (1 + 0.16 * Math.sin(5 * Math.PI * s) * Math.sin(5 * Math.PI * t))
}

/**
 * A closed relief block on [0, L] x [0, W]: top z = -depth * reliefShape(x / L, y / W) (0 on the
 * edge), upright sides and a flat base at `base` (below the carving). Facets face outwards.
 */
export function reliefBlock(L: number, W: number, n: number, m: number, depth: number, base: number): Soup {
  const top = (i: number, j: number) => {
    const x = (L * i) / n
    const y = (W * j) / m
    return [x, y, -depth * reliefShape(i / n, j / m)]
  }
  const out: Soup = []
  for (let j = 0; j < m; j++)
    for (let i = 0; i < n; i++) {
      const a = top(i, j), b = top(i + 1, j), c = top(i + 1, j + 1), d = top(i, j + 1)
      out.push([...a, ...b, ...c], [...a, ...c, ...d])
    }
  // sides: one quad per edge step, from the top edge down to the base, facing out
  const side = (p: number[], q: number[]) => {
    const pb = [p[0], p[1], base]
    const qb = [q[0], q[1], base]
    out.push([...p, ...pb, ...qb], [...p, ...qb, ...q])
  }
  for (let i = 0; i < n; i++) side(top(i + 1, 0), top(i, 0)) // y = 0, facing -y
  for (let j = 0; j < m; j++) side(top(n, j + 1), top(n, j)) // x = L, facing +x
  for (let i = 0; i < n; i++) side(top(i, m), top(i + 1, m)) // y = W, facing +y
  for (let j = 0; j < m; j++) side(top(0, j), top(0, j + 1)) // x = 0, facing -x
  // base, facing down (a grid matching the sides' steps, so the block is closed)
  for (let j = 0; j < m; j++)
    for (let i = 0; i < n; i++) {
      const v = (a: number, b: number) => [(L * a) / n, (W * b) / m, base]
      const a = v(i, j), b = v(i + 1, j), c = v(i + 1, j + 1), d = v(i, j + 1)
      out.push([...a, ...c, ...b], [...a, ...d, ...c])
    }
  return out
}

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc(buf: Uint8Array) {
  let c = 0xffffffff
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  out.set(Buffer.from(type, 'ascii'), 4)
  out.set(data, 8)
  dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)))
  return out
}

const CH: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

/**
 * PNG with `samples` (per pixel, per channel, rows from the top) at any colour type and bit depth.
 * Row filters cycle through all five types so the reader's unfiltering is tested.
 */
export function pngOf(o: { width: number; height: number; type: number; bits: number; samples: ArrayLike<number>; palette?: number[]; trns?: number[] }): Uint8Array {
  const ch = CH[o.type]
  const stride = Math.ceil((o.width * ch * o.bits) / 8)
  const bpp = Math.max(1, (ch * o.bits) >> 3)
  const raw = new Uint8Array((stride + 1) * o.height)
  let prev = new Uint8Array(stride)
  for (let y = 0; y < o.height; y++) {
    const line = new Uint8Array(stride)
    for (let k = 0; k < o.width * ch; k++) {
      const v = o.samples[y * o.width * ch + k]
      if (o.bits === 16) {
        line[2 * k] = v >> 8
        line[2 * k + 1] = v & 255
      } else if (o.bits === 8) line[k] = v
      else {
        const bit = k * o.bits
        line[bit >> 3] |= v << (8 - o.bits - (bit & 7))
      }
    }
    const f = y % 5
    const out = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    raw[y * (stride + 1)] = f
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      const p = a + b - c
      const pr = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pr
      out[i] = (line[i] - pred) & 255
    }
    prev = line
  }
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, o.width)
  dv.setUint32(4, o.height)
  ihdr.set([o.bits, o.type, 0, 0, 0], 8)
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr)]
  if (o.palette) parts.push(chunk('PLTE', Uint8Array.from(o.palette)))
  if (o.trns) parts.push(chunk('tRNS', Uint8Array.from(o.trns)))
  parts.push(chunk('IDAT', new Uint8Array(zlib.deflateSync(raw, { level: 6 }))), chunk('IEND', new Uint8Array()))
  const buf = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    buf.set(p, at)
    at += p.length
  }
  return buf
}

/** The test relief as a 16-bit greyscale height map (white = top), `w` x `h` pixels. */
export function reliefPng(w: number, h: number): Uint8Array {
  const s = new Uint16Array(w * h)
  // pixel centres; rows from the top (row 0 is the far edge, t = 1)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) s[y * w + x] = Math.round((1 - reliefShape((x + 0.5) / w, 1 - (y + 0.5) / h) / 1.2) * 65535)
  return pngOf({ width: w, height: h, type: 0, bits: 16, samples: s })
}
