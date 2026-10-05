/**
 * Assemblies and multi-body files (SOL-04): the bodies are grouped into parts. Bodies are the same
 * part when they have the same name and the same shape: the same panel size, the same faces (count,
 * types, areas) and the same holes, pockets and cut-outs in the panel's own frame (so a mirrored
 * copy, which has the same areas but mirrored holes, is a separate part). The part's quantity is
 * the number of its bodies; its properties come from the file's product of that name.
 */
import { boxOf } from '../geom'
import { recognizePanel, type Recognition, type RecognizeOptions } from './recognize'
import type { SolidData } from './types'

export interface AssemblyPart {
  /** Name for the part: the product name, made unique ("Side (2)") when two shapes share it. */
  name: string
  /** Product name as in the file. */
  product: string
  /** Body indices in the file. */
  bodies: number[]
  qty: number
  properties: Record<string, string | number>
  /** Panel size (length, width, thickness), mm. */
  size: [number, number, number]
  /** Assembly path of the first body. */
  path: string[]
  holes: number
  pockets: number
  cutouts: number
  warnings: string[]
  /** Not a panel (recognition failed): the reason. */
  error?: string
}

const q = (n: number, step = 0.01) => Math.round(n / step) * step

/** Features as a canonical string, the same for either way round in the plane. */
function featureKey(r: Recognition): string {
  const L = r.frame.length
  const W = r.frame.width
  const items = (flip: boolean) => {
    const at = (x: number, y: number) => (flip ? [L - x, W - y] : [x, y])
    const out: string[] = []
    for (const h of r.holes) {
      const [x, y] = h.face === 1 || h.face === 6 ? at(h.x, h.y) : [h.x, h.y]
      out.push(`h${h.face}:${q(x)},${q(y)},${q(h.d)},${q(h.depth)}`)
    }
    for (const p of r.pockets) {
      const b = boxOf([p.contour])
      const [x0, y0] = at(b.minX, b.minY)
      const [x1, y1] = at(b.maxX, b.maxY)
      out.push(`p${p.face}:${q(Math.min(x0, x1))},${q(Math.min(y0, y1))},${q(Math.max(x0, x1))},${q(Math.max(y0, y1))},${q(p.depth)}`)
    }
    for (const c of r.cutouts) {
      const b = boxOf([c.contour])
      const [x0, y0] = at(b.minX, b.minY)
      const [x1, y1] = at(b.maxX, b.maxY)
      out.push(`c:${q(Math.min(x0, x1))},${q(Math.min(y0, y1))},${q(Math.max(x0, x1))},${q(Math.max(y0, y1))}`)
    }
    return out.sort().join('|')
  }
  const a = items(false)
  const b = items(true)
  return a < b ? a : b
}

export function assemblyParts(solid: SolidData, opt: Omit<RecognizeOptions, 'frame'> = {}): AssemblyPart[] {
  const groups: (AssemblyPart & { key: string })[] = []
  for (const b of solid.bodies) {
    const product = b.name
    const props = solid.products.find((p) => p.name === product)?.properties ?? {}
    let rec: Recognition | null = null
    let error: string | undefined
    try {
      rec = recognizePanel(b, opt)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
    const kinds = new Map<string, number>()
    for (const f of b.faces) kinds.set(f.surface.kind, (kinds.get(f.surface.kind) ?? 0) + 1)
    const areas = b.faces
      .map((f) => q(f.area, 0.01))
      .sort((x, y) => x - y)
      .join(',')
    const size: [number, number, number] = rec ? [q(rec.frame.length, 1e-6), q(rec.frame.width, 1e-6), q(rec.frame.thickness, 1e-6)] : [0, 0, 0]
    const key = [product, b.faces.length, [...kinds].sort().join(','), areas, size.map((x) => q(x, 1e-3)).join('x'), rec ? featureKey(rec) : `body${b.index}`].join('#')
    const same = groups.find((g) => g.key === key)
    if (same) {
      same.bodies.push(b.index)
      same.qty++
      continue
    }
    groups.push({
      key,
      name: product,
      product,
      bodies: [b.index],
      qty: 1,
      properties: props,
      size,
      path: b.path,
      holes: rec?.holes.length ?? 0,
      pockets: rec?.pockets.length ?? 0,
      cutouts: rec?.cutouts.length ?? 0,
      warnings: rec?.warnings ?? [],
      ...(error ? { error } : {}),
    })
  }
  // unique names: unnamed bodies get "Body n"; two shapes sharing a name get (2), (3)...
  const used = new Map<string, number>()
  for (const g of groups) {
    const base = g.product || `Body ${g.bodies[0] + 1}`
    const n = (used.get(base) ?? 0) + 1
    used.set(base, n)
    g.name = n === 1 ? base : `${base} (${n})`
  }
  return groups.map(({ key: _k, ...g }) => g)
}
