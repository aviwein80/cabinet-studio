/**
 * Cut-free pieces (SIM-05). After through cuts the stock falls apart into islands of material
 * (4-connected cells that are not cut through). Each island is classified:
 *
 * - part: the largest island inside the part's outline (what is kept);
 * - scrap: any other island inside the outline (a slug from an opening);
 * - offcut: an island outside the outline (material round a shaped part).
 *
 * An island is inside the outline when most of its cells' centres are. Without an outline the
 * largest island is the part and every other one is scrap. Pure; extends `looseMask`.
 */
import type { P } from '../geom'
import type { Heightfield } from '../sim'

export type PieceKind = 'part' | 'scrap' | 'offcut'

export interface Piece {
  id: number
  kind: PieceKind
  /** Cells and area (mm²). */
  cells: number
  area: number
  box: { minX: number; minY: number; maxX: number; maxY: number }
  /** Not joined to the rest of the stock: cut free on all sides. */
  free: boolean
}

export interface Pieces {
  pieces: Piece[]
  /** Island id per cell (-1 = cut through). */
  label: Int32Array
}

/** Even-odd point in polygons. */
function inside(polys: P[][], x: number, y: number) {
  let c = false
  for (const poly of polys)
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]
      const b = poly[j]
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c
    }
  return c
}

/** Islands of the stock and what each one is. `outline`: the part's outline (polygons, even-odd). */
export function cutFreePieces(hf: Heightfield, outline?: P[][]): Pieces {
  const { nx, ny, top, thickness, cell } = hf
  const n = nx * ny
  const label = new Int32Array(n).fill(-1)
  const solid = (k: number) => top[k] > -thickness + 1e-6
  const raw: { cells: number; inCells: number; i0: number; j0: number; i1: number; j1: number }[] = []
  const stack: number[] = []
  const isIn = outline?.length ? new Uint8Array(n) : null
  if (isIn && outline)
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) isIn[j * nx + i] = inside(outline, (i + 0.5) * cell, (j + 0.5) * cell) ? 1 : 0
  for (let s = 0; s < n; s++) {
    if (label[s] >= 0 || !solid(s)) continue
    const id = raw.length
    const r = { cells: 0, inCells: 0, i0: nx, j0: ny, i1: -1, j1: -1 }
    label[s] = id
    stack.push(s)
    while (stack.length) {
      const k = stack.pop()!
      const i = k % nx
      const j = (k - i) / nx
      r.cells++
      if (isIn?.[k]) r.inCells++
      if (i < r.i0) r.i0 = i
      if (i > r.i1) r.i1 = i
      if (j < r.j0) r.j0 = j
      if (j > r.j1) r.j1 = j
      const nb = [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, j > 0 ? k - nx : -1, j < ny - 1 ? k + nx : -1]
      for (const q of nb) {
        if (q < 0 || label[q] >= 0 || !solid(q)) continue
        label[q] = id
        stack.push(q)
      }
    }
    raw.push(r)
  }
  const inPart = raw.map((r) => (isIn ? r.inCells * 2 > r.cells : true))
  let keep = -1
  raw.forEach((r, i) => {
    if (inPart[i] && (keep < 0 || r.cells > raw[keep].cells)) keep = i
  })
  const pieces = raw.map((r, i): Piece => ({
    id: i,
    kind: i === keep ? 'part' : inPart[i] ? 'scrap' : 'offcut',
    cells: r.cells,
    area: r.cells * cell * cell,
    box: { minX: r.i0 * cell, minY: r.j0 * cell, maxX: (r.i1 + 1) * cell, maxY: (r.j1 + 1) * cell },
    free: raw.length > 1,
  }))
  return { pieces, label }
}

/** 1 for cells of pieces that fall away (scrap and offcuts), 0 otherwise (as `looseMask`). */
export function dropMask(p: Pieces): Uint8Array {
  const drop = p.pieces.map((x) => (x.kind === 'part' ? 0 : 1))
  const out = new Uint8Array(p.label.length)
  for (let k = 0; k < out.length; k++) if (p.label[k] >= 0) out[k] = drop[p.label[k]]
  return out
}
