/**
 * Height-map pictures for relief import (ART-01): our own readers for PNG (every colour type, 1 to
 * 16 bits, interlaced or not) and TIFF (strips or tiles; uncompressed, LZW, Deflate or PackBits;
 * 8, 16 or 32-bit whole numbers or 32/64-bit floating point). Each pixel becomes one height
 * value from 0 (black, lowest) to 1 (white, highest), rows from the top of the picture.
 *
 * 16-bit pictures keep their 65,536 levels: a browser canvas would cut them to 256, which shows
 * as steps on a deep relief. Bad files give a `HeightImageError` with a plain message.
 */
import { checkCancel, type Work } from '@/core/cancel'

export class HeightImageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HeightImageError'
  }
}

export interface HeightImage {
  width: number
  height: number
  /** One value per pixel, 0 = black (lowest) to 1 = white (highest); rows from the top. */
  values: Float32Array
  /** Pixels that are more than half transparent (1), if the picture has transparency. */
  transparent?: Uint8Array
  /** Bits per value in the file (8, 16, 32 or 64). */
  bits: number
  /** Distinct heights the file can hold (256 for 8-bit, 65,536 for 16-bit; 0 = floating point). */
  levels: number
  format: 'png' | 'tiff'
  /** Lowest and highest value found (0..1). */
  min: number
  max: number
  warnings: string[]
}

/** Largest picture accepted (pixels). */
export const MAX_PIXELS = 64_000_000

export type HeightImageFormat = 'png' | 'tiff'

export function heightImageFormat(name: string): HeightImageFormat | null {
  const ext = name.toLowerCase().split('.').pop()
  return ext === 'png' ? 'png' : ext === 'tif' || ext === 'tiff' ? 'tiff' : null
}

export async function readHeightImage(bytes: Uint8Array, name: string, work?: Work): Promise<HeightImage> {
  if (!bytes.length) throw new HeightImageError(`${name} is empty.`)
  if (isPng(bytes)) return readPng(bytes, work)
  if (isTiff(bytes)) return readTiff(bytes, work)
  throw new HeightImageError(`${name}: only PNG and TIFF height maps can be imported (16-bit greyscale keeps the most detail).`)
}

const isPng = (b: Uint8Array) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
const isTiff = (b: Uint8Array) => b.length >= 8 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 42 && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 42))

/** zlib (`raw` = bare deflate) through the platform's own decompressor (browser, worker and Node). */
async function inflate(data: Uint8Array, raw = false): Promise<Uint8Array> {
  try {
    const ds = new DecompressionStream(raw ? 'deflate-raw' : 'deflate')
    const out = new Response(new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(ds))
    return new Uint8Array(await out.arrayBuffer())
  } catch {
    throw new HeightImageError('The compressed picture data is damaged.')
  }
}

function finish(img: Omit<HeightImage, 'min' | 'max'>): HeightImage {
  let min = Infinity
  let max = -Infinity
  const v = img.values
  for (let i = 0; i < v.length; i++) {
    if (img.transparent?.[i]) continue
    if (v[i] < min) min = v[i]
    if (v[i] > max) max = v[i]
  }
  if (!Number.isFinite(min)) {
    min = 0
    max = 0
  }
  return { ...img, min, max }
}

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

function checkSize(w: number, h: number) {
  if (!(w > 0 && h > 0)) throw new HeightImageError('The picture has no pixels.')
  if (w * h > MAX_PIXELS) throw new HeightImageError(`The picture is ${w} x ${h} pixels; the largest accepted is ${MAX_PIXELS / 1e6} million pixels. Make it smaller first.`)
}

// ---------------------------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(b: Uint8Array) {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
const ADAM7: [number, number, number, number][] = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
]

export async function readPng(bytes: Uint8Array, work?: Work): Promise<HeightImage> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let o = 8
  let w = 0
  let h = 0
  let depth = 0
  let type = -1
  let interlace = 0
  let palette: Uint8Array | null = null
  let trns: Uint8Array | null = null
  const idat: Uint8Array[] = []
  let ended = false
  while (o + 12 <= bytes.length) {
    const len = dv.getUint32(o)
    if (o + 12 + len > bytes.length) throw new HeightImageError('PNG file is cut short.')
    const t = String.fromCharCode(bytes[o + 4], bytes[o + 5], bytes[o + 6], bytes[o + 7])
    const d = bytes.subarray(o + 8, o + 8 + len)
    if (crc32(bytes.subarray(o + 4, o + 8 + len)) !== dv.getUint32(o + 8 + len)) throw new HeightImageError(`PNG file is damaged (bad check sum in its ${t} block).`)
    if (t === 'IHDR') {
      w = dv.getUint32(o + 8)
      h = dv.getUint32(o + 12)
      depth = d[8]
      type = d[9]
      interlace = d[12]
    } else if (t === 'PLTE') palette = d.slice()
    else if (t === 'tRNS') trns = d.slice()
    else if (t === 'IDAT') idat.push(d)
    else if (t === 'IEND') {
      ended = true
      break
    }
    o += 12 + len
  }
  if (type < 0) throw new HeightImageError('PNG file has no header.')
  if (!(type in CHANNELS) || ![1, 2, 4, 8, 16].includes(depth) || (type === 3 && depth > 8) || ((type === 2 || type === 4 || type === 6) && depth < 8)) throw new HeightImageError(`PNG colour type ${type} with ${depth}-bit samples is not valid.`)
  checkSize(w, h)
  if (type === 3 && !palette) throw new HeightImageError('PNG file uses a palette but has none.')
  if (!idat.length) throw new HeightImageError('PNG file has no picture data.')
  const warnings: string[] = []
  if (!ended) warnings.push('The PNG file has no end marker; it may be cut short.')
  const total = idat.reduce((n, d) => n + d.length, 0)
  const z = new Uint8Array(total)
  let p = 0
  for (const d of idat) {
    z.set(d, p)
    p += d.length
  }
  const raw = await inflate(z)
  checkCancel(work?.isCancelled)
  const ch = CHANNELS[type]
  const bpp = Math.max(1, (ch * depth) >> 3)
  const values = new Float32Array(w * h)
  const hasAlpha = type === 4 || type === 6 || !!trns
  const transparent = hasAlpha ? new Uint8Array(w * h) : undefined
  const maxv = (1 << depth) - 1
  // palette entries as heights and transparency
  const palV: number[] = []
  const palT: boolean[] = []
  if (palette)
    for (let i = 0; i * 3 + 2 < palette.length; i++) {
      palV.push(luma(palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2]) / 255)
      palT.push(!!trns && i < trns.length && trns[i] < 128)
    }
  const keyGrey = type === 0 && trns && trns.length >= 2 ? (trns[0] << 8) | trns[1] : -1
  const keyRgb = type === 2 && trns && trns.length >= 6 ? [(trns[0] << 8) | trns[1], (trns[2] << 8) | trns[3], (trns[4] << 8) | trns[5]] : null

  let pos = 0
  const pass = (x0: number, y0: number, dx: number, dy: number) => {
    const pw = Math.ceil((w - x0) / dx)
    const ph = Math.ceil((h - y0) / dy)
    if (pw <= 0 || ph <= 0) return
    const stride = Math.ceil((pw * ch * depth) / 8)
    let prev = new Uint8Array(stride)
    for (let r = 0; r < ph; r++) {
      if (pos + 1 + stride > raw.length) throw new HeightImageError('PNG picture data is cut short.')
      const filter = raw[pos]
      const line = raw.slice(pos + 1, pos + 1 + stride)
      pos += 1 + stride
      unfilter(filter, line, prev, bpp)
      prev = line
      const y = y0 + r * dy
      for (let c = 0; c < pw; c++) {
        const x = x0 + c * dx
        const i = y * w + x
        const s = (k: number) => sample(line, c * ch + k, depth)
        let v: number
        let clear = false
        if (type === 3) {
          const ix = s(0)
          if (ix >= palV.length) throw new HeightImageError('PNG pixel points past the end of its palette.')
          v = palV[ix]
          clear = palT[ix]
        } else if (type === 0 || type === 4) {
          const g = s(0)
          v = g / maxv
          clear = type === 4 ? s(1) < (maxv + 1) / 2 : g === keyGrey
        } else {
          const r0 = s(0)
          const g0 = s(1)
          const b0 = s(2)
          v = luma(r0, g0, b0) / maxv
          clear = type === 6 ? s(3) < (maxv + 1) / 2 : !!keyRgb && r0 === keyRgb[0] && g0 === keyRgb[1] && b0 === keyRgb[2]
        }
        values[i] = v
        if (transparent && clear) transparent[i] = 1
      }
    }
  }
  if (interlace === 1) for (const [x0, y0, dx, dy] of ADAM7) pass(x0, y0, dx, dy)
  else if (interlace === 0) pass(0, 0, 1, 1)
  else throw new HeightImageError(`PNG interlace method ${interlace} is not valid.`)
  if (type === 2 || type === 6 || (type === 3 && palette && !greyPalette(palette))) warnings.push('The picture is in colour: its brightness is used as the height. A greyscale height map is more exact.')
  const levels = type === 3 ? 256 : depth === 16 ? 65536 : 1 << depth
  return finish({ width: w, height: h, values, ...(transparent && transparent.some((t) => t) ? { transparent } : {}), bits: depth, levels, format: 'png', warnings })
}

function greyPalette(p: Uint8Array) {
  for (let i = 0; i + 2 < p.length; i += 3) if (p[i] !== p[i + 1] || p[i] !== p[i + 2]) return false
  return true
}

/** The k-th sample of a row (1, 2, 4, 8 or 16 bits, big-endian). */
function sample(line: Uint8Array, k: number, depth: number) {
  if (depth === 8) return line[k]
  if (depth === 16) return (line[2 * k] << 8) | line[2 * k + 1]
  const bit = k * depth
  const byte = line[bit >> 3]
  return (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1)
}

function unfilter(f: number, line: Uint8Array, prev: Uint8Array, bpp: number) {
  const n = line.length
  switch (f) {
    case 0:
      return
    case 1:
      for (let i = bpp; i < n; i++) line[i] = (line[i] + line[i - bpp]) & 255
      return
    case 2:
      for (let i = 0; i < n; i++) line[i] = (line[i] + prev[i]) & 255
      return
    case 3:
      for (let i = 0; i < n; i++) line[i] = (line[i] + (((i >= bpp ? line[i - bpp] : 0) + prev[i]) >> 1)) & 255
      return
    case 4:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? line[i - bpp] : 0
        const b = prev[i]
        const c = i >= bpp ? prev[i - bpp] : 0
        const pa = Math.abs(b - c)
        const pb = Math.abs(a - c)
        const pc = Math.abs(a + b - 2 * c)
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
      }
      return
    default:
      throw new HeightImageError(`PNG row filter ${f} is not valid; the file is damaged.`)
  }
}

// ---------------------------------------------------------------------------------------------
// TIFF
// ---------------------------------------------------------------------------------------------

interface Ifd {
  get(tag: number): number[] | undefined
  one(tag: number, def?: number): number
}

function readIfd(bytes: Uint8Array, le: boolean): Ifd {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (o: number) => dv.getUint16(o, le)
  const u32 = (o: number) => dv.getUint32(o, le)
  const at = u32(4)
  if (at + 2 > bytes.length) throw new HeightImageError('TIFF file is cut short.')
  const n = u16(at)
  const tags = new Map<number, number[]>()
  const SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 }
  for (let i = 0; i < n; i++) {
    const e = at + 2 + i * 12
    if (e + 12 > bytes.length) throw new HeightImageError('TIFF file is cut short.')
    const tag = u16(e)
    const type = u16(e + 2)
    const count = u32(e + 4)
    const size = SIZE[type]
    if (!size) continue
    const total = size * count
    const base = total <= 4 ? e + 8 : u32(e + 8)
    if (base + total > bytes.length) throw new HeightImageError('TIFF file is cut short.')
    const vals: number[] = []
    for (let k = 0; k < Math.min(count, 1 << 20); k++) {
      const q = base + k * size
      vals.push(type === 3 || type === 8 ? u16(q) : type === 4 || type === 9 ? u32(q) : type === 5 ? u32(q) / Math.max(1, u32(q + 4)) : type === 11 ? dv.getFloat32(q, le) : type === 12 ? dv.getFloat64(q, le) : bytes[q])
    }
    tags.set(tag, vals)
  }
  return {
    get: (t) => tags.get(t),
    one: (t, def) => {
      const v = tags.get(t)
      if (v?.length) return v[0]
      if (def === undefined) throw new HeightImageError(`TIFF file is missing a required field (tag ${t}).`)
      return def
    },
  }
}

export async function readTiff(bytes: Uint8Array, work?: Work): Promise<HeightImage> {
  const le = bytes[0] === 0x49
  const ifd = readIfd(bytes, le)
  const w = ifd.one(256)
  const h = ifd.one(257)
  checkSize(w, h)
  const spp = ifd.one(277, 1)
  const bitsAll = ifd.get(258) ?? [1]
  const bits = bitsAll[0]
  if (bitsAll.some((b) => b !== bits)) throw new HeightImageError('TIFF channels with different bit sizes are not supported.')
  const comp = ifd.one(259, 1)
  const photo = ifd.one(262, 1)
  const planar = ifd.one(284, 1)
  const predictor = ifd.one(317, 1)
  const fmt = ifd.one(339, 1)
  const extra = ifd.get(338) ?? []
  if (planar !== 1 && spp > 1) throw new HeightImageError('TIFF with channels stored separately (planar) is not supported. Save it as greyscale.')
  if (![1, 5, 8, 32946, 32773].includes(comp)) throw new HeightImageError(`TIFF compression ${comp} is not supported (only none, LZW, Deflate and PackBits). Save it uncompressed or as PNG.`)
  if (![0, 1, 2, 3].includes(photo)) throw new HeightImageError(`TIFF colour mode ${photo} is not supported. Save it as greyscale.`)
  if (fmt === 3 ? bits !== 32 && bits !== 64 : ![8, 16, 32].includes(bits)) throw new HeightImageError(`TIFF with ${bits}-bit ${fmt === 3 ? 'floating-point' : 'whole-number'} samples is not supported.`)
  if (fmt !== 1 && fmt !== 3) throw new HeightImageError(`TIFF sample format ${fmt} (signed or undefined numbers) is not supported.`)
  if (predictor !== 1 && predictor !== 2) throw new HeightImageError(`TIFF predictor ${predictor} is not supported. Save it without a predictor or as PNG.`)
  if (predictor === 2 && fmt === 3) throw new HeightImageError('TIFF horizontal predictor on floating-point samples is not supported.')
  const colourMap = ifd.get(320)
  if (photo === 3 && !colourMap) throw new HeightImageError('TIFF palette picture has no colour map.')
  const colour = photo === 2 || photo === 3
  if (photo === 2 && spp < 3) throw new HeightImageError('TIFF RGB picture has fewer than three channels.')
  const bytesPer = bits >> 3
  const pixBytes = spp * bytesPer
  const alphaCh = extra.length && spp > (colour && photo === 2 ? 3 : 1) ? (photo === 2 ? 3 : 1) : -1

  // pieces: strips (full width) or tiles
  const tiled = !!ifd.get(322)
  const tw = tiled ? ifd.one(322) : w
  const th = tiled ? ifd.one(323) : Math.min(h, ifd.one(278, h))
  const offsets = ifd.get(tiled ? 324 : 273)
  const counts = ifd.get(tiled ? 325 : 279)
  if (!offsets || !counts || offsets.length !== counts.length) throw new HeightImageError('TIFF file does not say where its picture data is.')
  const across = Math.ceil(w / tw)
  const raw = new Float64Array(w * h)
  const alpha = alphaCh >= 0 ? new Uint8Array(w * h) : undefined
  let alphaSeen = false
  const maxv = fmt === 3 ? 1 : 2 ** bits - 1
  for (let k = 0; k < offsets.length; k++) {
    checkCancel(work?.isCancelled)
    work?.progress?.(k / offsets.length, 'Reading TIFF')
    const start = offsets[k]
    const len = counts[k]
    if (start + len > bytes.length) throw new HeightImageError('TIFF file is cut short.')
    const src = bytes.subarray(start, start + len)
    const rowBytes = tw * pixBytes
    const want = rowBytes * th
    let data = comp === 1 ? src : comp === 5 ? lzw(src, want) : comp === 32773 ? packBits(src, want) : await inflate(src)
    if (data.length < want) {
      // the last strip may be shorter
      const pad = new Uint8Array(want)
      pad.set(data)
      data = pad
    }
    const pdv = new DataView(data.buffer, data.byteOffset, data.byteLength)
    if (predictor === 2) undoPredictor(data, pdv, tw, th, spp, bytesPer, le)
    const ox = tiled ? (k % across) * tw : 0
    const oy = tiled ? Math.floor(k / across) * th : k * th
    for (let r = 0; r < th; r++) {
      const y = oy + r
      if (y >= h) break
      for (let c = 0; c < tw; c++) {
        const x = ox + c
        if (x >= w) break
        const q = r * rowBytes + c * pixBytes
        const s = (ch: number) => {
          const at = q + ch * bytesPer
          return fmt === 3 ? (bits === 32 ? pdv.getFloat32(at, le) : pdv.getFloat64(at, le)) : bits === 8 ? data[at] : bits === 16 ? pdv.getUint16(at, le) : pdv.getUint32(at, le)
        }
        let v: number
        if (photo === 2) v = luma(s(0), s(1), s(2)) / maxv
        else if (photo === 3) {
          const ix = s(0)
          const n = colourMap!.length / 3
          if (ix >= n) throw new HeightImageError('TIFF pixel points past the end of its colour map.')
          v = luma(colourMap![ix], colourMap![ix + n], colourMap![ix + 2 * n]) / 65535
        } else v = s(0) / maxv
        if (photo === 0 && fmt !== 3) v = 1 - v
        raw[y * w + x] = v
        if (alpha && s(alphaCh) < (fmt === 3 ? 0.5 : (maxv + 1) / 2)) {
          alpha[y * w + x] = 1
          alphaSeen = true
        }
      }
    }
  }
  const warnings: string[] = []
  const values = new Float32Array(w * h)
  if (fmt === 3) {
    // floating point: heights in any unit; stretched to 0..1 (lowest to highest)
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < raw.length; i++) {
      if (!Number.isFinite(raw[i]) || alpha?.[i]) continue
      lo = Math.min(lo, raw[i])
      hi = Math.max(hi, raw[i])
    }
    const span = hi > lo ? hi - lo : 1
    for (let i = 0; i < raw.length; i++) values[i] = Number.isFinite(raw[i]) ? Math.max(0, Math.min(1, (raw[i] - lo) / span)) : 0
    if (photo === 0) for (let i = 0; i < values.length; i++) values[i] = 1 - values[i]
    warnings.push(`The picture holds heights as decimal numbers (${fmtNum(lo)} to ${fmtNum(hi)}): the lowest becomes the full depth and the highest the top.`)
  } else values.set(raw)
  if (colour) warnings.push('The picture is in colour: its brightness is used as the height. A greyscale height map is more exact.')
  return finish({ width: w, height: h, values, ...(alpha && alphaSeen ? { transparent: alpha } : {}), bits, levels: fmt === 3 ? 0 : bits >= 32 ? 2 ** 32 : 2 ** bits, format: 'tiff', warnings })
}

const fmtNum = (n: number) => (Math.abs(n) >= 1000 || Number.isInteger(n) ? n.toFixed(0) : n.toPrecision(4))

function undoPredictor(data: Uint8Array, dv: DataView, w: number, h: number, spp: number, bytesPer: number, le: boolean) {
  const rowBytes = w * spp * bytesPer
  for (let r = 0; r < h; r++) {
    const o = r * rowBytes
    for (let i = spp; i < w * spp; i++) {
      if (bytesPer === 1) data[o + i] = (data[o + i] + data[o + i - spp]) & 255
      else if (bytesPer === 2) dv.setUint16(o + i * 2, (dv.getUint16(o + i * 2, le) + dv.getUint16(o + (i - spp) * 2, le)) & 0xffff, le)
      else dv.setUint32(o + i * 4, (dv.getUint32(o + i * 4, le) + dv.getUint32(o + (i - spp) * 4, le)) >>> 0, le)
    }
  }
}

/** TIFF LZW (most significant bit first, early change). */
export function lzw(src: Uint8Array, want: number): Uint8Array {
  const out = new Uint8Array(Math.max(want, 1))
  let n = 0
  const dict: Uint8Array[] = []
  const reset = () => {
    dict.length = 0
    for (let i = 0; i < 256; i++) dict.push(Uint8Array.of(i))
    dict.push(new Uint8Array(0), new Uint8Array(0)) // 256 clear, 257 end
  }
  reset()
  let bitPos = 0
  let width = 9
  let prev: Uint8Array | null = null
  const total = src.length * 8
  const put = (s: Uint8Array) => {
    for (let i = 0; i < s.length && n < out.length; i++) out[n++] = s[i]
  }
  while (bitPos + width <= total) {
    let code = 0
    for (let i = 0; i < width; i++) {
      const b = bitPos + i
      code = (code << 1) | ((src[b >> 3] >> (7 - (b & 7))) & 1)
    }
    bitPos += width
    if (code === 257) break
    if (code === 256) {
      reset()
      width = 9
      prev = null
      continue
    }
    let entry: Uint8Array
    if (code < dict.length) entry = dict[code]
    else if (code === dict.length && prev) {
      entry = new Uint8Array(prev.length + 1)
      entry.set(prev)
      entry[prev.length] = prev[0]
    } else throw new HeightImageError('TIFF LZW data is damaged.')
    put(entry)
    if (prev) {
      const add = new Uint8Array(prev.length + 1)
      add.set(prev)
      add[prev.length] = entry[0]
      dict.push(add)
    }
    prev = entry
    if (dict.length + 1 >= 1 << width && width < 12) width++
    if (n >= out.length) break
  }
  return out.subarray(0, n)
}

/** TIFF PackBits. */
export function packBits(src: Uint8Array, want: number): Uint8Array {
  const out = new Uint8Array(want)
  let n = 0
  let i = 0
  while (i < src.length && n < want) {
    const c = (src[i++] << 24) >> 24
    if (c >= 0) {
      for (let k = 0; k <= c && i < src.length && n < want; k++) out[n++] = src[i++]
    } else if (c !== -128) {
      const b = src[i++]
      for (let k = 0; k <= -c && n < want; k++) out[n++] = b
    }
  }
  return out.subarray(0, n)
}

/** What the dialog shows before the relief is made: size, depth of detail and a small picture. */
export interface HeightImageSummary {
  width: number
  height: number
  bits: number
  levels: number
  format: 'png' | 'tiff'
  min: number
  max: number
  transparent: boolean
  warnings: string[]
  /** Small greyscale preview, RGBA rows from the top (transparent pixels shown clear). */
  preview: { width: number; height: number; data: Uint8Array }
}

export function summarise(img: HeightImage, maxSide = 320): HeightImageSummary {
  const k = Math.max(1, Math.ceil(Math.max(img.width, img.height) / maxSide))
  const pw = Math.max(1, Math.floor(img.width / k))
  const ph = Math.max(1, Math.floor(img.height / k))
  const data = new Uint8Array(pw * ph * 4)
  for (let y = 0; y < ph; y++)
    for (let x = 0; x < pw; x++) {
      let s = 0
      let n = 0
      let clear = 0
      for (let b = 0; b < k; b++)
        for (let a = 0; a < k; a++) {
          const i = (y * k + b) * img.width + x * k + a
          s += img.values[i]
          n++
          if (img.transparent?.[i]) clear++
        }
      const g = Math.round((s / n) * 255)
      const o = (y * pw + x) * 4
      data[o] = data[o + 1] = data[o + 2] = g
      data[o + 3] = clear * 2 > n ? 0 : 255
    }
  return { width: img.width, height: img.height, bits: img.bits, levels: img.levels, format: img.format, min: img.min, max: img.max, transparent: !!img.transparent, warnings: img.warnings, preview: { width: pw, height: ph, data } }
}
