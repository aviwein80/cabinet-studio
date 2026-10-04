/**
 * Where to stick each label on a nested sheet.
 *
 * Practice followed (CIM/RouterCIM, Thermwood Control Nesting, Cabinet Vision S2M "show label
 * position on nested sheet", Cabmaster auto-label): one label per part, placed in a fixed,
 * predictable spot shown on the sheet map, clear of part edges and machining, with an
 * orientation mark so the operator can tell how the part sat on the table when it is flipped
 * or re-identified later. Labels that do not fit are flagged instead of overlapping a cut.
 */
import type { PartInstance } from '../cutlist'
import { pointInPolygon } from '../geometry'
import type { SheetProgram } from '../machining'
import type { NestedSheet } from '../nesting'
import type { Vec2 } from '../types'
import { placementTransform } from '../machining'

export interface LabelSpot {
  uid: string
  /** Label centre on the sheet. */
  cx: number
  cy: number
  /** Label footprint along sheet X / Y. */
  w: number
  h: number
  /** 0 = label text reads along sheet X, 90 = along sheet Y. */
  rotation: 0 | 90
  fits: boolean
}

export function labelDims(size: '100x70' | '100x80') {
  return size === '100x80' ? { w: 100, h: 80 } : { w: 100, h: 70 }
}

interface Box {
  x1: number
  y1: number
  x2: number
  y2: number
}

const overlaps = (a: Box, b: Box) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1

export function placeLabels(
  sheet: NestedSheet,
  program: SheetProgram,
  instances: Map<string, PartInstance>,
  size: '100x70' | '100x80',
  clearance: number,
): LabelSpot[] {
  const { w: LW, h: LH } = labelDims(size)
  const spots: LabelSpot[] = []
  for (const pl of sheet.placements) {
    const inst = instances.get(pl.uid)
    if (!inst) continue
    const { pt } = placementTransform(inst, pl)
    const poly: Vec2[] = inst.outline.map((p) => pt(p.x, p.y))
    const holes: Vec2[][] = (inst.holes ?? []).map((h) => h.map((p) => pt(p.x, p.y)))
    const keepOut: Box[] = []
    const pad = 5
    for (const h of holes) {
      const xs = h.map((p) => p.x)
      const ys = h.map((p) => p.y)
      keepOut.push({ x1: Math.min(...xs) - pad, y1: Math.min(...ys) - pad, x2: Math.max(...xs) + pad, y2: Math.max(...ys) + pad })
    }
    for (const op of program.ops) {
      if (op.partUid !== pl.uid) continue
      if (op.kind === 'cam' && op.intent.k === 'vdrill') {
        const r = op.intent.d / 2 + pad
        keepOut.push({ x1: op.intent.x - r, y1: op.intent.y - r, x2: op.intent.x + r, y2: op.intent.y + r })
      } else if (op.kind === 'vdrill') {
        const r = op.diameter / 2 + pad
        keepOut.push({ x1: op.x - r, y1: op.y - r, x2: op.x + r, y2: op.y + r })
      } else if (op.kind === 'pocket') keepOut.push({ x1: op.x1 - pad, y1: op.y1 - pad, x2: op.x2 + pad, y2: op.y2 + pad })
      else if (op.kind === 'saw') {
        const hw = op.width / 2 + pad
        keepOut.push({ x1: Math.min(op.xa, op.xe) - hw, y1: Math.min(op.ya, op.ye) - hw, x2: Math.max(op.xa, op.xe) + hw, y2: Math.max(op.ya, op.ye) + hw })
      }
    }
    const fx1 = pl.x + clearance
    const fy1 = pl.y + clearance
    const fx2 = pl.x + pl.dx - clearance
    const fy2 = pl.y + pl.dy - clearance
    const centre = { x: pl.x + pl.dx / 2, y: pl.y + pl.dy / 2 }
    const orientations: { w: number; h: number; rotation: 0 | 90 }[] =
      pl.dx >= pl.dy
        ? [{ w: LW, h: LH, rotation: 0 }, { w: LH, h: LW, rotation: 90 }]
        : [{ w: LH, h: LW, rotation: 90 }, { w: LW, h: LH, rotation: 0 }]

    let found: LabelSpot | null = null
    for (const o of orientations) {
      if (fx2 - fx1 < o.w || fy2 - fy1 < o.h) continue
      let best: { cx: number; cy: number; d: number } | null = null
      const step = 5
      for (let x = fx1; x + o.w <= fx2 + 1e-9; x += step) {
        for (let y = fy1; y + o.h <= fy2 + 1e-9; y += step) {
          const b = { x1: x, y1: y, x2: x + o.w, y2: y + o.h }
          if (keepOut.some((k) => overlaps(k, b))) continue
          const corners = [
            { x: b.x1, y: b.y1 },
            { x: b.x2, y: b.y1 },
            { x: b.x2, y: b.y2 },
            { x: b.x1, y: b.y2 },
          ]
          if (!corners.every((c) => pointInPolygon(c, poly))) continue
          if (poly.some((v) => v.x > b.x1 + 1e-9 && v.x < b.x2 - 1e-9 && v.y > b.y1 + 1e-9 && v.y < b.y2 - 1e-9)) continue
          const cx = x + o.w / 2
          const cy = y + o.h / 2
          const d = Math.hypot(cx - centre.x, cy - centre.y)
          if (!best || d < best.d - 1e-9) best = { cx, cy, d }
        }
      }
      if (best) {
        found = { uid: pl.uid, cx: round1(best.cx), cy: round1(best.cy), w: o.w, h: o.h, rotation: o.rotation, fits: true }
        break
      }
    }
    spots.push(
      found ?? {
        uid: pl.uid,
        cx: round1(centre.x),
        cy: round1(centre.y),
        w: orientations[0].w,
        h: orientations[0].h,
        rotation: orientations[0].rotation,
        fits: false,
      },
    )
  }
  return spots
}

const round1 = (n: number) => Math.round(n * 10) / 10
