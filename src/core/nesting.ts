/**
 * Sheet nesting. Two engines share one result format:
 *
 *   rect   MaxRects (Jylanki, "A Thousand Ways to Pack the Bin") on cut rectangles.
 *   shape  True outlines with no-fit polygons (nestShape.ts): parts turn 0/90/180/270,
 *          interlock, and small parts can sit in the cut-outs of larger ones.
 *   auto   Runs both and keeps the better nest.
 *
 * Parts are inflated by the part spacing (cut-out tool diameter + extra) so that the tool path
 * between two neighbours never overlaps. Several heuristics / orderings are tried and the
 * result with the fewest sheets (then the emptiest last sheet, which leaves the best remnant)
 * wins. Everything is deterministic: the same input always produces the same nest.
 */
import { checkCancel, type CancelCheck } from './cancel'
import { nestShapes } from './nestShape'
import type { NestEngine, Vec2 } from './types'
import type { FlipInfo } from './flipSide'

export interface NestPart {
  uid: string
  length: number
  width: number
  canRotate: boolean
  /** True outline in the cut frame (0..length × 0..width). Absent = the cut rectangle. */
  outline?: Vec2[]
  /** Openings right through the part that other parts may nest in. */
  holes?: Vec2[][]
  /** Parts with the same key have the same outline (no-fit polygons are shared). */
  shape?: string
  /** Higher numbers go on earlier sheets. */
  priority?: number
  kit?: string
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
  /** Turned half a turn (applied before `rotated`); grain still runs the same way. */
  flip?: boolean
  /** The part sits in a cut-out of this part, so it is cut out first. */
  inside?: string
}

/** Unused strip of a sheet, measured from the last part's cut (after the spacing). */
export interface Remnant {
  x: number
  y: number
  length: number
  width: number
  dir: 'vertical' | 'horizontal'
}

export interface NestedSheet {
  index: number
  materialId: string
  sheetLength: number
  sheetWidth: number
  thickness: number
  placements: Placement[]
  /** Percent of the full sheet area covered by parts (0-100). */
  utilization: number
  /** Stock offcut used instead of a full sheet. */
  offcutId?: string
  remnants?: Remnant[]
  /** Flip-side sheet (M2.8): parts with underside work; the sheet as it comes and how it is turned. */
  flip?: FlipInfo
}

export interface StockOffcut {
  id: string
  length: number
  width: number
}

export interface NestOptions {
  sheetLength: number
  sheetWidth: number
  edgeTrim: number
  spacing: number
  allowRotation: boolean
  engine?: NestEngine
  keepKits?: boolean
  /** Saved offcuts filled before full sheets. */
  offcuts?: StockOffcut[]
  offcutType?: 'vertical' | 'horizontal' | 'both'
  offcutMin?: { length: number; width: number }
  /** Wall-clock budget for trying more strategies. */
  timeLimitMs?: number
  /** Polled during nesting; true stops with `Cancelled`. */
  isCancelled?: CancelCheck
}

export type MaterialSheet = Omit<NestedSheet, 'index' | 'materialId' | 'thickness'>

export interface MaterialNest {
  sheets: MaterialSheet[]
  unplaced: { uid: string; reason: string }[]
  strategy: string
  engine: 'rect' | 'shape'
  /** Kits whose parts ended up on more than one sheet. */
  splitKits: string[]
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
  w: number
  h: number
  constructor(w: number, h: number) {
    this.w = w
    this.h = h
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
  return [...parts].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || key(b) - key(a) || a.uid.localeCompare(b.uid))
}

/** Area the part covers: its true outline less its openings, or the cut rectangle. */
export function partArea(p: NestPart) {
  if (!p.outline || p.outline.length < 3) return p.length * p.width
  return Math.abs(polyArea(p.outline)) - (p.holes ?? []).reduce((s, h) => s + Math.abs(polyArea(h)), 0)
}

export function polyArea(poly: Vec2[]) {
  let a = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y)
  return -a / 2
}

export interface Bin {
  length: number
  width: number
  offcutId?: string
}

/** Offcut bins first (smallest first, so they get used up), then full sheets as needed. */
export function binQueue(opt: NestOptions): Bin[] {
  return [...(opt.offcuts ?? [])].sort((a, b) => a.length * a.width - b.length * b.width || a.id.localeCompare(b.id)).map((o) => ({ length: o.length, width: o.width, offcutId: o.id }))
}

function runStrategy(parts: NestPart[], opt: NestOptions, heur: Heuristic, order: Order) {
  const s = opt.spacing
  let remaining = sortParts(parts, order)
  const sheets: { placements: Placement[]; area: number; bin: Bin }[] = []
  const queue = binQueue(opt)
  const full: Bin = { length: opt.sheetLength, width: opt.sheetWidth }
  while (remaining.length) {
    const bin = queue.shift() ?? full
    const usable = bin.length - 2 * opt.edgeTrim + s
    const usableW = bin.width - 2 * opt.edgeTrim + s
    const mr = new MaxRectsBin(usable, usableW)
    const placements: Placement[] = []
    let area = 0
    const rotOk = (p: NestPart) => opt.allowRotation && p.canRotate
    if (order === 'global') {
      for (;;) {
        let best: { idx: number; rect: Rect; rotated: boolean; s: [number, number]; prio: number } | null = null
        remaining.forEach((p, idx) => {
          const f = mr.find(p.length + s, p.width + s, rotOk(p), heur)
          if (!f) return
          const prio = p.priority ?? 0
          if (!best || prio > best.prio || (prio === best.prio && better(f.s, best.s))) best = { idx, prio, ...f }
        })
        if (!best) break
        const b = best as { idx: number; rect: Rect; rotated: boolean }
        const p = remaining[b.idx]
        mr.place(b.rect)
        placements.push(toPlacement(p, b.rect, b.rotated, opt))
        area += partArea(p)
        remaining = remaining.filter((_, i) => i !== b.idx)
      }
    } else {
      const left: NestPart[] = []
      for (const p of remaining) {
        const f = mr.find(p.length + s, p.width + s, rotOk(p), heur)
        if (!f) {
          left.push(p)
          continue
        }
        mr.place(f.rect)
        placements.push(toPlacement(p, f.rect, f.rotated, opt))
        area += partArea(p)
      }
      remaining = left
    }
    if (!placements.length) {
      if (bin.offcutId) continue
      break
    }
    sheets.push({ placements, area, bin })
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

export interface RawSheet {
  placements: Placement[]
  area: number
  bin: Bin
}

/** Lower is better: kit splits (when kits are kept), full sheets, then the area on the last full sheet. */
export function nestCost(sheets: RawSheet[], parts: NestPart[], keepKits: boolean): [number, number, number] {
  const fullSheets = sheets.filter((s) => !s.bin.offcutId)
  const last = fullSheets[fullSheets.length - 1]?.area ?? 0
  return [keepKits ? splitKitsOf(sheets, parts).length : 0, fullSheets.length, last]
}

const lessCost = (a: [number, number, number], b: [number, number, number]) => a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2] - 1e-6)))

export function splitKitsOf(sheets: RawSheet[], parts: NestPart[]) {
  const kitOf = new Map(parts.filter((p) => p.kit).map((p) => [p.uid, p.kit!]))
  const where = new Map<string, Set<number>>()
  sheets.forEach((sh, i) =>
    sh.placements.forEach((pl) => {
      const k = kitOf.get(pl.uid)
      if (k) where.set(k, (where.get(k) ?? new Set()).add(i))
    }),
  )
  return [...where.entries()].filter(([, s]) => s.size > 1).map(([k]) => k).sort()
}

const isRect = (p: NestPart) => {
  if (p.holes?.length) return false
  if (!p.outline || p.outline.length < 3) return true
  return Math.abs(Math.abs(polyArea(p.outline)) - p.length * p.width) <= 0.002 * p.length * p.width
}

function rectNest(fitting: NestPart[], opt: NestOptions) {
  let best: { sheets: RawSheet[]; name: string; cost: [number, number, number] } | null = null
  for (const order of ORDERS) {
    for (const heur of HEURISTICS) {
      checkCancel(opt.isCancelled)
      const sheets = runStrategy(fitting, opt, heur, order)
      const placedCount = sheets.reduce((n, sh) => n + sh.placements.length, 0)
      if (placedCount < fitting.length) continue
      const cost = nestCost(sheets, fitting, !!opt.keepKits)
      if (!best || lessCost(cost, best.cost)) best = { sheets, name: `${heur}/${order}`, cost }
    }
  }
  return best
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

  const engine = opt.engine ?? 'rect'
  const hasKits = !!opt.keepKits && fitting.some((p) => p.kit)
  const wantShape = engine === 'shape' || (engine === 'auto' && (fitting.some((p) => !isRect(p)) || hasKits))
  let chosen: { sheets: RawSheet[]; name: string; engine: 'rect' | 'shape' } | null = null
  if (engine !== 'shape') {
    const r = rectNest(fitting, opt)
    if (r) chosen = { sheets: r.sheets, name: r.name, engine: 'rect' }
  }
  if (wantShape && fitting.length) {
    const s = nestShapes(fitting, opt)
    if (s.placed === fitting.length) {
      const keep = !!opt.keepKits
      if (!chosen || lessCost(nestCost(s.sheets, fitting, keep), nestCost(chosen.sheets, fitting, keep))) chosen = { sheets: s.sheets, name: s.name, engine: 'shape' }
    }
  }
  const sheetArea = (b: Bin) => b.length * b.width
  const sheets = (chosen?.sheets ?? []).map((sh) => ({
    sheetLength: sh.bin.length,
    sheetWidth: sh.bin.width,
    placements: orderForCutting(sh.placements),
    utilization: Math.round((sh.area / sheetArea(sh.bin)) * 1000) / 10,
    ...(sh.bin.offcutId ? { offcutId: sh.bin.offcutId } : {}),
    remnants: remnantsOf(sh.bin, sh.placements, opt),
  }))
  return {
    sheets,
    unplaced,
    strategy: chosen?.name ?? 'none',
    engine: chosen?.engine ?? 'rect',
    splitKits: chosen ? splitKitsOf(chosen.sheets, fitting) : [],
  }
}

/** Full-width strip past the last part (vertical) and/or full-length strip above the highest (horizontal). */
export function remnantsOf(bin: Bin, placements: Placement[], opt: Pick<NestOptions, 'spacing' | 'offcutType' | 'offcutMin'>): Remnant[] {
  if (!placements.length) return []
  const r1 = (n: number) => Math.round(n * 10) / 10
  const maxX = Math.max(...placements.map((p) => p.x + p.dx)) + opt.spacing
  const maxY = Math.max(...placements.map((p) => p.y + p.dy)) + opt.spacing
  const min = opt.offcutMin ?? { length: 300, width: 300 }
  const ok = (l: number, w: number) => Math.max(l, w) >= Math.max(min.length, min.width) - 1e-9 && Math.min(l, w) >= Math.min(min.length, min.width) - 1e-9
  const type = opt.offcutType ?? 'vertical'
  const out: Remnant[] = []
  const vL = bin.length - maxX
  if (type !== 'horizontal' && ok(vL, bin.width)) out.push({ x: r1(maxX), y: 0, length: r1(vL), width: bin.width, dir: 'vertical' })
  const hLen = type === 'both' && out.length ? maxX : bin.length
  const hW = bin.width - maxY
  if (type !== 'vertical' && ok(hLen, hW)) out.push({ x: 0, y: r1(maxY), length: r1(hLen), width: r1(hW), dir: 'horizontal' })
  return out
}

/**
 * Cut order: parts in cut-outs before the part around them, then small parts first (they lose
 * vacuum hold-down fastest once neighbours are cut free), then by position.
 */
export function orderForCutting(placements: Placement[]) {
  const sorted = [...placements].sort((a, b) => a.dx * a.dy - b.dx * b.dy || a.y - b.y || a.x - b.x)
  const out: Placement[] = []
  const done = new Set<string>()
  const visit = (p: Placement, depth = 0) => {
    if (done.has(p.uid) || depth > placements.length) return
    for (const c of sorted) if (c.inside === p.uid) visit(c, depth + 1)
    done.add(p.uid)
    out.push(p)
  }
  for (const p of sorted) visit(p)
  return out
}
