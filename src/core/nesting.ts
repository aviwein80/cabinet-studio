/**
 * Rectangular nesting with the MaxRects algorithm (Jylanki, "A Thousand Ways to Pack the Bin").
 *
 * Parts are inflated by the part spacing (cut-out tool diameter + extra) so that the tool path
 * between two neighbours never overlaps. Several heuristics / orderings are tried and the
 * result with the fewest sheets (then the emptiest last sheet, which leaves the best remnant)
 * wins. Everything is deterministic: the same input always produces the same nest.
 */

export interface NestPart {
  uid: string
  length: number
  width: number
  canRotate: boolean
}

export interface Placement {
  uid: string
  /** Lower-left corner of the part's cut rectangle on the sheet. */
  x: number
  y: number
  /** True when the part's local x axis runs along sheet Y. */
  rotated: boolean
  /** Footprint on the sheet (after rotation). */
  dx: number
  dy: number
}

export interface NestedSheet {
  index: number
  materialId: string
  sheetLength: number
  sheetWidth: number
  thickness: number
  placements: Placement[]
  utilization: number
}

export interface NestOptions {
  sheetLength: number
  sheetWidth: number
  edgeTrim: number
  spacing: number
  allowRotation: boolean
}

export interface MaterialNest {
  sheets: Omit<NestedSheet, 'index' | 'materialId' | 'thickness'>[]
  unplaced: { uid: string; reason: string }[]
  strategy: string
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

type Heuristic = 'BSSF' | 'BLSF' | 'BAF' | 'BL'
type Order = 'global' | 'area' | 'long-side' | 'perimeter'

const HEURISTICS: Heuristic[] = ['BSSF', 'BLSF', 'BAF', 'BL']
const ORDERS: Order[] = ['global', 'area', 'long-side', 'perimeter']

function score(h: Heuristic, fr: Rect, w: number, hh: number): [number, number] {
  const dw = fr.w - w
  const dh = fr.h - hh
  switch (h) {
    case 'BSSF':
      return [Math.min(dw, dh), Math.max(dw, dh)]
    case 'BLSF':
      return [Math.max(dw, dh), Math.min(dw, dh)]
    case 'BAF':
      return [fr.w * fr.h - w * hh, Math.min(dw, dh)]
    case 'BL':
      return [fr.y + hh, fr.x]
  }
}

const better = (a: [number, number], b: [number, number] | null) =>
  !b || a[0] < b[0] - 1e-9 || (Math.abs(a[0] - b[0]) <= 1e-9 && a[1] < b[1] - 1e-9)

class MaxRectsBin {
  free: Rect[]
  used: Rect[] = []
  constructor(
    public w: number,
    public h: number,
  ) {
    this.free = [{ x: 0, y: 0, w, h }]
  }

  find(w: number, h: number, canRotate: boolean, heur: Heuristic) {
    let best: { rect: Rect; rotated: boolean; s: [number, number] } | null = null
    for (const fr of this.free) {
      if (w <= fr.w + 1e-9 && h <= fr.h + 1e-9) {
        const s = score(heur, fr, w, h)
        if (better(s, best?.s ?? null)) best = { rect: { x: fr.x, y: fr.y, w, h }, rotated: false, s }
      }
      if (canRotate && Math.abs(w - h) > 1e-9 && h <= fr.w + 1e-9 && w <= fr.h + 1e-9) {
        const s = score(heur, fr, h, w)
        if (better(s, best?.s ?? null)) best = { rect: { x: fr.x, y: fr.y, w: h, h: w }, rotated: true, s }
      }
    }
    return best
  }

  place(r: Rect) {
    const next: Rect[] = []
    for (const fr of this.free) {
      if (r.x >= fr.x + fr.w || r.x + r.w <= fr.x || r.y >= fr.y + fr.h || r.y + r.h <= fr.y) {
        next.push(fr)
        continue
      }
      if (r.x > fr.x) next.push({ x: fr.x, y: fr.y, w: r.x - fr.x, h: fr.h })
      if (r.x + r.w < fr.x + fr.w) next.push({ x: r.x + r.w, y: fr.y, w: fr.x + fr.w - (r.x + r.w), h: fr.h })
      if (r.y > fr.y) next.push({ x: fr.x, y: fr.y, w: fr.w, h: r.y - fr.y })
      if (r.y + r.h < fr.y + fr.h) next.push({ x: fr.x, y: r.y + r.h, w: fr.w, h: fr.y + fr.h - (r.y + r.h) })
    }
    this.free = next.filter(
      (a, i) =>
        a.w > 1e-9 &&
        a.h > 1e-9 &&
        !next.some(
          (b, j) =>
            i !== j &&
            a.x >= b.x - 1e-9 &&
            a.y >= b.y - 1e-9 &&
            a.x + a.w <= b.x + b.w + 1e-9 &&
            a.y + a.h <= b.y + b.h + 1e-9 &&
            // keep the first of two identical rects
            !(j > i && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h),
        ),
    )
    this.used.push(r)
  }
}

function sortParts(parts: NestPart[], order: Order) {
  const key = (p: NestPart) => {
    switch (order) {
      case 'area':
      case 'global':
        return p.length * p.width
      case 'long-side':
        return Math.max(p.length, p.width) * 1e6 + Math.min(p.length, p.width)
      case 'perimeter':
        return p.length + p.width
    }
  }
  return [...parts].sort((a, b) => key(b) - key(a) || a.uid.localeCompare(b.uid))
}

function runStrategy(parts: NestPart[], opt: NestOptions, heur: Heuristic, order: Order) {
  const s = opt.spacing
  const binW = opt.sheetLength - 2 * opt.edgeTrim + s
  const binH = opt.sheetWidth - 2 * opt.edgeTrim + s
  let remaining = sortParts(parts, order)
  const sheets: { placements: Placement[]; area: number }[] = []
  while (remaining.length) {
    const bin = new MaxRectsBin(binW, binH)
    const placements: Placement[] = []
    let area = 0
    const rotOk = (p: NestPart) => opt.allowRotation && p.canRotate
    if (order === 'global') {
      for (;;) {
        let best: { idx: number; rect: Rect; rotated: boolean; s: [number, number] } | null = null
        remaining.forEach((p, idx) => {
          const f = bin.find(p.length + s, p.width + s, rotOk(p), heur)
          if (f && better(f.s, best?.s ?? null)) best = { idx, ...f }
        })
        if (!best) break
        const b = best as { idx: number; rect: Rect; rotated: boolean }
        const p = remaining[b.idx]
        bin.place(b.rect)
        placements.push(toPlacement(p, b.rect, b.rotated, opt))
        area += p.length * p.width
        remaining = remaining.filter((_, i) => i !== b.idx)
      }
    } else {
      const left: NestPart[] = []
      for (const p of remaining) {
        const f = bin.find(p.length + s, p.width + s, rotOk(p), heur)
        if (!f) {
          left.push(p)
          continue
        }
        bin.place(f.rect)
        placements.push(toPlacement(p, f.rect, f.rotated, opt))
        area += p.length * p.width
      }
      remaining = left
    }
    if (!placements.length) break
    sheets.push({ placements, area })
  }
  return sheets
}

function toPlacement(p: NestPart, r: Rect, rotated: boolean, opt: NestOptions): Placement {
  return {
    uid: p.uid,
    x: Math.round((opt.edgeTrim + r.x) * 1000) / 1000,
    y: Math.round((opt.edgeTrim + r.y) * 1000) / 1000,
    rotated,
    dx: rotated ? p.width : p.length,
    dy: rotated ? p.length : p.width,
  }
}

/** Nest all parts of one material onto as few sheets as possible. */
export function nestMaterial(parts: NestPart[], opt: NestOptions): MaterialNest {
  const usableL = opt.sheetLength - 2 * opt.edgeTrim
  const usableW = opt.sheetWidth - 2 * opt.edgeTrim
  const unplaced: { uid: string; reason: string }[] = []
  const fitting: NestPart[] = []
  for (const p of parts) {
    const fitsStraight = p.length <= usableL + 1e-9 && p.width <= usableW + 1e-9
    const fitsRotated = opt.allowRotation && p.canRotate && p.width <= usableL + 1e-9 && p.length <= usableW + 1e-9
    if (fitsStraight || fitsRotated) fitting.push(p)
    else
      unplaced.push({
        uid: p.uid,
        reason: `${p.length} x ${p.width} does not fit the usable sheet area ${usableL} x ${usableW}${p.canRotate ? '' : ' (grain-locked, rotation not allowed)'}`,
      })
  }

  let best: { sheets: ReturnType<typeof runStrategy>; name: string } | null = null
  const sheetArea = opt.sheetLength * opt.sheetWidth
  for (const order of ORDERS) {
    for (const heur of HEURISTICS) {
      const sheets = runStrategy(fitting, opt, heur, order)
      const placedCount = sheets.reduce((n, sh) => n + sh.placements.length, 0)
      if (placedCount < fitting.length) continue
      const lastArea = (s: typeof sheets) => s[s.length - 1]?.area ?? 0
      if (
        !best ||
        sheets.length < best.sheets.length ||
        (sheets.length === best.sheets.length && lastArea(sheets) < lastArea(best.sheets) - 1e-6)
      )
        best = { sheets, name: `${heur}/${order}` }
    }
  }
  const chosen = best?.sheets ?? []
  return {
    sheets: chosen.map((sh) => ({
      sheetLength: opt.sheetLength,
      sheetWidth: opt.sheetWidth,
      placements: orderForCutting(sh.placements),
      utilization: Math.round((sh.area / sheetArea) * 1000) / 10,
    })),
    unplaced,
    strategy: best?.name ?? 'none',
  }
}

/** Small parts first (they lose vacuum hold-down fastest once neighbours are cut free), then by position. */
export function orderForCutting(placements: Placement[]) {
  return [...placements].sort((a, b) => a.dx * a.dy - b.dx * b.dy || a.y - b.y || a.x - b.x)
}
