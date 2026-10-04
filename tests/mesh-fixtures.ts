/**
 * Meshes made in code for the 3D tests (no large files in the repo): triangle soups for a sphere,
 * a torus, a box and an open relief surface, plus writers for binary/ASCII STL, OBJ and 3MF.
 */
import JSZip from 'jszip'

export type Soup = number[][] // each facet: [ax, ay, az, bx, by, bz, cx, cy, cz]

export function sphere(r: number, seg = 48, rings = 24, c: [number, number, number] = [0, 0, 0]): Soup {
  const P = (i: number, j: number): number[] => {
    const th = (Math.PI * j) / rings
    const ph = (2 * Math.PI * (i % seg)) / seg
    if (j === 0) return [c[0], c[1], c[2] + r]
    if (j === rings) return [c[0], c[1], c[2] - r]
    return [c[0] + r * Math.sin(th) * Math.cos(ph), c[1] + r * Math.sin(th) * Math.sin(ph), c[2] + r * Math.cos(th)]
  }
  const out: Soup = []
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < seg; i++) {
      const a = P(i, j), b = P(i, j + 1), cc = P(i + 1, j + 1), d = P(i + 1, j)
      if (j > 0) out.push([...a, ...b, ...d])
      if (j < rings - 1) out.push([...b, ...cc, ...d])
    }
  return out
}

export function torus(R: number, r: number, seg = 48, sides = 24): Soup {
  const P = (i: number, j: number) => {
    const u = (2 * Math.PI * (i % seg)) / seg
    const v = (2 * Math.PI * (j % sides)) / sides
    return [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)]
  }
  const out: Soup = []
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < sides; j++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1)
      out.push([...a, ...b, ...c], [...a, ...c, ...d])
    }
  return out
}

export function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Soup {
  const v = (i: number) => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0]
  const quads = [
    [0, 2, 3, 1], // bottom (z0), facing down
    [4, 5, 7, 6], // top
    [0, 1, 5, 4], // y0
    [2, 6, 7, 3], // y1
    [0, 4, 6, 2], // x0
    [1, 3, 7, 5], // x1
  ]
  return quads.flatMap(([a, b, c, d]) => [
    [...v(a), ...v(b), ...v(c)],
    [...v(a), ...v(c), ...v(d)],
  ])
}

/** Open height-field surface z = f(x, y) on [0, L] x [0, W], n x m cells. */
export function relief(L: number, W: number, n: number, m: number, f: (x: number, y: number) => number): Soup {
  const P = (i: number, j: number) => {
    const x = (L * i) / n
    const y = (W * j) / m
    return [x, y, f(x, y)]
  }
  const out: Soup = []
  for (let j = 0; j < m; j++)
    for (let i = 0; i < n; i++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1)
      out.push([...a, ...b, ...c], [...a, ...c, ...d])
    }
  return out
}

export function stlBinary(soup: Soup, header = 'binary test'): Uint8Array {
  const buf = new Uint8Array(84 + soup.length * 50)
  buf.set(new TextEncoder().encode(header.slice(0, 80)))
  const dv = new DataView(buf.buffer)
  dv.setUint32(80, soup.length, true)
  soup.forEach((t, i) => {
    for (let k = 0; k < 9; k++) dv.setFloat32(84 + i * 50 + 12 + k * 4, t[k], true)
  })
  return buf
}

export function stlAscii(soup: Soup, name = 'test'): string {
  const f = (n: number) => n.toExponential(7)
  const lines = [`solid ${name}`]
  for (const t of soup) {
    lines.push('  facet normal 0 0 0', '    outer loop')
    for (let k = 0; k < 3; k++) lines.push(`      vertex ${f(t[k * 3])} ${f(t[k * 3 + 1])} ${f(t[k * 3 + 2])}`)
    lines.push('    endloop', '  endfacet')
  }
  lines.push(`endsolid ${name}`)
  return lines.join('\n') + '\n'
}

export async function threeMf(objects: { soup: Soup; name: string }[], unit = 'millimeter', itemTransform?: string): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')
  const objs = objects.map((o, i) => {
    const verts: string[] = []
    const tris: string[] = []
    o.soup.forEach((t) => {
      const base = verts.length
      for (let k = 0; k < 3; k++) verts.push(`<vertex x="${t[k * 3]}" y="${t[k * 3 + 1]}" z="${t[k * 3 + 2]}"/>`)
      tris.push(`<triangle v1="${base}" v2="${base + 1}" v3="${base + 2}"/>`)
    })
    return `<object id="${i + 1}" name="${o.name}" type="model"><mesh><vertices>${verts.join('')}</vertices><triangles>${tris.join('')}</triangles></mesh></object>`
  })
  const items = objects.map((_, i) => `<item objectid="${i + 1}"${itemTransform ? ` transform="${itemTransform}"` : ''}/>`).join('')
  zip.file('3D/3dmodel.model', `<?xml version="1.0" encoding="UTF-8"?><model unit="${unit}" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${objs.join('')}</resources><build>${items}</build></model>`)
  return zip.generateAsync({ type: 'uint8array' })
}

/** Deterministic pseudo-random numbers (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Every edge is used exactly twice, once in each direction: the mesh is closed and consistently oriented. */
export function isWatertight(ix: Uint32Array) {
  const seen = new Map<string, number>()
  for (let t = 0; t < ix.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = ix[t + k]
      const b = ix[t + ((k + 1) % 3)]
      const key = `${a},${b}`
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
  for (const [key, n] of seen) {
    const [a, b] = key.split(',')
    if (n !== 1 || seen.get(`${b},${a}`) !== 1) return false
  }
  return true
}
