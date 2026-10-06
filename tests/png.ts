/** Minimal PNG writer and reader for tests (8-bit RGBA / RGB / grey, all five row filters). */
import zlib from 'node:zlib'

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

export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1)
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, width)
  dv.setUint32(4, height)
  ihdr.set([8, 6, 0, 0, 0], 8)
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(zlib.deflateSync(raw, { level: 9 }))), chunk('IEND', new Uint8Array())]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) out.set(p, (o += p.length) - p.length)
  return out
}

export function decodePng(buf: Uint8Array): { width: number; height: number; data: Uint8Array } {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let o = 8
  let width = 0
  let height = 0
  let type = 6
  const idat: Uint8Array[] = []
  while (o < buf.length) {
    const len = dv.getUint32(o)
    const t = String.fromCharCode(...buf.subarray(o + 4, o + 8))
    const d = buf.subarray(o + 8, o + 8 + len)
    if (t === 'IHDR') {
      width = dv.getUint32(o + 8)
      height = dv.getUint32(o + 12)
      if (d[8] !== 8) throw new Error('8-bit PNG only')
      type = d[9]
    } else if (t === 'IDAT') idat.push(d)
    o += 12 + len
  }
  const ch = type === 6 ? 4 : type === 2 ? 3 : type === 0 ? 1 : 0
  if (!ch) throw new Error(`PNG colour type ${type} not read here`)
  const raw = new Uint8Array(zlib.inflateSync(Buffer.concat(idat.map((x) => Buffer.from(x)))))
  const stride = width * ch
  const px = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]
      const a = x >= ch ? px[y * stride + x - ch] : 0
      const b = y > 0 ? px[(y - 1) * stride + x] : 0
      const c = x >= ch && y > 0 ? px[(y - 1) * stride + x - ch] : 0
      const p = a + b - c
      const pr = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c
      px[y * stride + x] = (v + [0, a, b, (a + b) >> 1, pr][f]) & 0xff
    }
  }
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    if (ch === 4) data.set(px.subarray(i * 4, i * 4 + 4), i * 4)
    else if (ch === 3) data.set([px[i * 3], px[i * 3 + 1], px[i * 3 + 2], 255], i * 4)
    else data.set([px[i], px[i], px[i], 255], i * 4)
  }
  return { width, height, data }
}
