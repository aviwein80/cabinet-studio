/**
 * Drawing and editing tools for the part designer. Each tool collects clicks (snapped points
 * plus the entity under the cursor) and turns them into a new part. Kept free of React so the
 * same steps can be driven from tests.
 */
import {
  ArrowRightLeft,
  Circle,
  CircleDot,
  Copy,
  CornerDownRight,
  Diff,
  FlipHorizontal2,
  Grid2x2,
  Hexagon,
  Link2,
  MousePointer2,
  Move,
  MoveHorizontal,
  Route,
  Ruler,
  Scaling,
  Scissors,
  Slash,
  Spline,
  Split,
  Square,
  SquareDashed,
  SquaresIntersect,
  SquaresUnite,
  Type,
  Unlink,
  RotateCw,
  Waypoints,
  Wand2,
  Pill,
  Egg,
  Dot,
  Spool,
  CornerUpRight,
  type LucideIcon,
} from 'lucide-react'
import {
  arrayEntities,
  booleanEntities,
  breakEntity,
  chamferAt,
  cleanupEntities,
  explodeEntity,
  extendAt,
  filletAll,
  filletAt,
  joinEntities,
  mirrorM,
  moveM,
  offsetEntity,
  reliefAt,
  reverseEntity,
  rotateM,
  scaleM,
  transformEntities,
  trimAt,
  addEntities,
} from '@/cam/cad'
import { makeEntity } from '@/cam/doc'
import { angleOf, arc3, circle, type Contour, dist, ellipse, near, type P, polyline, rect, regularPolygon, roundedRect, slot, type ReliefStyle } from '@/cam/geom'
import { splineToContour } from '@/cam/doc'
import { strokeText } from '@/cam/font'
import type { CamPart, Entity } from '@/cam/types'

export interface Click {
  p: P
  hit: string | null
}

export interface ToolParams {
  radius: number
  distance: number
  sides: number
  angle: number
  scale: number
  width: number
  text: string
  height: number
  relief: ReliefStyle
  removed: 'interior' | 'exterior'
  allCorners: boolean
  columns: number
  rows: number
  spacingX: number
  spacingY: number
  gap: number
}

export const DEFAULT_PARAMS: ToolParams = {
  radius: 6,
  distance: 10,
  sides: 6,
  angle: 90,
  scale: 2,
  width: 20,
  text: 'TEXT',
  height: 20,
  relief: 'tbone-in',
  removed: 'interior',
  allCorners: false,
  columns: 3,
  rows: 1,
  spacingX: 100,
  spacingY: 100,
  gap: 0.1,
}

export interface ToolCtx {
  part: CamPart
  sel: string[]
  layer: string
  params: ToolParams
}

export interface ToolResult {
  part?: CamPart
  sel?: string[]
  /** Status line text (measure results, errors). */
  message?: string
  /** Keep the tool active for another round (most drawing tools repeat). */
  repeat?: boolean
}

/** 'pick': picking points for something other than drawing (hand-drawn toolpaths); not on the toolbar. */
export type ToolGroup = 'select' | 'draw' | 'change' | 'area' | 'pick'
export type ToolId =
  | 'pathpick'
  | 'select'
  | 'nodes'
  | 'line'
  | 'rect'
  | 'rrect'
  | 'circle'
  | 'arc'
  | 'polygon'
  | 'slot'
  | 'ellipse'
  | 'spline'
  | 'text'
  | 'point'
  | 'move'
  | 'copy'
  | 'rotate'
  | 'mirror'
  | 'scale'
  | 'array'
  | 'offset'
  | 'fillet'
  | 'chamfer'
  | 'relief'
  | 'trim'
  | 'extend'
  | 'break'
  | 'join'
  | 'explode'
  | 'reverse'
  | 'cleanup'
  | 'unite'
  | 'subtract'
  | 'intersect'
  | 'measure'

export interface ToolDef {
  id: ToolId
  label: string
  group: ToolGroup
  icon: LucideIcon
  key?: string
  /** Prompt for each click; the last one repeats for open tools. */
  prompts: string[]
  /** Finishes on Enter / double-click instead of after `prompts.length` clicks. */
  open?: boolean
  /** Clicks that must land on an entity (indices into clicks). */
  pick?: number[]
  /** Runs once on the current selection when chosen. */
  immediate?: boolean
  needsSelection?: boolean
  params?: (keyof ToolParams)[]
  /** Typed single value during step `i` turns into a point (e.g. radius after the centre). */
  valueToPoint?: (clicks: Click[], v: number, cursor: P) => P | null
  preview?: (clicks: Click[], cursor: P, ctx: ToolCtx) => Contour[]
  apply: (clicks: Click[], ctx: ToolCtx) => ToolResult | null
}

const pts = (cs: Click[]) => cs.map((c) => c.p)
const add1 = (ctx: ToolCtx, e: Entity): ToolResult => ({ part: addEntities(ctx.part, [e]), sel: [e.id], repeat: true })
const contourEntity = (ctx: ToolCtx, c: Contour) => add1(ctx, makeEntity({ t: 'contour', c }, ctx.layer))
const box = (a: P, b: P) => rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
const towards = (from: P, cursor: P, d: number): P => {
  const l = dist(from, cursor) || 1
  return { x: from.x + ((cursor.x - from.x) / l) * d, y: from.y + ((cursor.y - from.y) / l) * d }
}
const deg = Math.PI / 180

function polyFromClicks(clicks: Click[], extra?: P): Contour | null {
  const ps = pts(clicks)
  if (extra) ps.push(extra)
  if (ps.length < 2) return null
  const closed = ps.length > 3 && near(ps[0], ps[ps.length - 1], 1e-6)
  return polyline(closed ? ps.slice(0, -1) : ps, closed)
}

export const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', group: 'select', icon: MousePointer2, key: 'Escape', prompts: ['Click or drag to select'], apply: () => null },
  { id: 'nodes', label: 'Edit nodes', group: 'select', icon: Waypoints, key: 'n', prompts: ['Drag a node; click a segment to edit it'], apply: () => null },

  {
    id: 'line',
    label: 'Lines',
    group: 'draw',
    icon: Slash,
    key: 'l',
    open: true,
    prompts: ['First point', 'Next point (Enter to finish, click the first point to close)'],
    valueToPoint: (cs, v, cursor) => (cs.length ? towards(cs[cs.length - 1].p, cursor, v) : null),
    preview: (cs, cur) => {
      const c = polyFromClicks(cs, cur)
      return c ? [c] : []
    },
    apply: (cs, ctx) => {
      const c = polyFromClicks(cs)
      return c ? contourEntity(ctx, c) : null
    },
  },
  {
    id: 'rect',
    label: 'Rectangle',
    group: 'draw',
    icon: Square,
    key: 'r',
    prompts: ['First corner', 'Opposite corner (or @width,height)'],
    preview: (cs, cur) => (cs.length ? [box(cs[0].p, cur)] : []),
    apply: (cs, ctx) => contourEntity(ctx, box(cs[0].p, cs[1].p)),
  },
  {
    id: 'rrect',
    label: 'Rounded rectangle',
    group: 'draw',
    icon: SquareDashed,
    params: ['radius'],
    prompts: ['First corner', 'Opposite corner'],
    preview: (cs, cur, ctx) => (cs.length ? [rounded(cs[0].p, cur, ctx.params.radius)] : []),
    apply: (cs, ctx) => contourEntity(ctx, rounded(cs[0].p, cs[1].p, ctx.params.radius)),
  },
  {
    id: 'circle',
    label: 'Circle',
    group: 'draw',
    icon: Circle,
    key: 'c',
    prompts: ['Centre', 'Point on circle (or type the radius)'],
    valueToPoint: (cs, v) => (cs.length ? { x: cs[0].p.x + v, y: cs[0].p.y } : null),
    preview: (cs, cur) => (cs.length && dist(cs[0].p, cur) > 1e-6 ? [circle(cs[0].p, dist(cs[0].p, cur))] : []),
    apply: (cs, ctx) => {
      const r = dist(cs[0].p, cs[1].p)
      return r > 1e-6 ? add1(ctx, makeEntity({ t: 'circle', c: cs[0].p, r }, ctx.layer)) : null
    },
  },
  {
    id: 'arc',
    label: 'Arc (3 points)',
    group: 'draw',
    icon: Spool,
    key: 'a',
    prompts: ['Start point', 'Point on the arc', 'End point'],
    preview: (cs, cur) => {
      if (cs.length === 1) return [polyline([cs[0].p, cur], false)]
      if (cs.length === 2) return [{ closed: false, segs: [arc3(cs[0].p, cs[1].p, cur)] }]
      return []
    },
    apply: (cs, ctx) => contourEntity(ctx, { closed: false, segs: [arc3(cs[0].p, cs[1].p, cs[2].p)] }),
  },
  {
    id: 'polygon',
    label: 'Polygon',
    group: 'draw',
    icon: Hexagon,
    params: ['sides'],
    prompts: ['Centre', 'Corner'],
    preview: (cs, cur, ctx) => (cs.length && dist(cs[0].p, cur) > 1e-6 ? [regularPolygon(cs[0].p, dist(cs[0].p, cur), Math.max(3, Math.round(ctx.params.sides)), angleOf(cs[0].p, cur))] : []),
    apply: (cs, ctx) => contourEntity(ctx, regularPolygon(cs[0].p, dist(cs[0].p, cs[1].p), Math.max(3, Math.round(ctx.params.sides)), angleOf(cs[0].p, cs[1].p))),
  },
  {
    id: 'slot',
    label: 'Slot',
    group: 'draw',
    icon: Pill,
    params: ['width'],
    prompts: ['First end centre', 'Second end centre'],
    preview: (cs, cur, ctx) => (cs.length && dist(cs[0].p, cur) > 1e-6 ? [slot(cs[0].p, cur, ctx.params.width)] : []),
    apply: (cs, ctx) => (dist(cs[0].p, cs[1].p) > 1e-6 ? contourEntity(ctx, slot(cs[0].p, cs[1].p, ctx.params.width)) : null),
  },
  {
    id: 'ellipse',
    label: 'Ellipse',
    group: 'draw',
    icon: Egg,
    prompts: ['Centre', 'Corner of the bounding box'],
    preview: (cs, cur) => (cs.length && Math.abs(cur.x - cs[0].p.x) > 1e-3 && Math.abs(cur.y - cs[0].p.y) > 1e-3 ? [ellipse(cs[0].p, Math.abs(cur.x - cs[0].p.x), Math.abs(cur.y - cs[0].p.y))] : []),
    apply: (cs, ctx) => {
      const rx = Math.abs(cs[1].p.x - cs[0].p.x)
      const ry = Math.abs(cs[1].p.y - cs[0].p.y)
      return rx > 1e-3 && ry > 1e-3 ? contourEntity(ctx, ellipse(cs[0].p, rx, ry)) : null
    },
  },
  {
    id: 'spline',
    label: 'Spline',
    group: 'draw',
    icon: Spline,
    key: 's',
    open: true,
    prompts: ['First point', 'Next point (Enter to finish)'],
    preview: (cs, cur) => (cs.length ? [splineToContour([...pts(cs), cur], false, true)] : []),
    apply: (cs, ctx) => {
      const ps = pts(cs)
      if (ps.length < 2) return null
      const closed = ps.length > 3 && near(ps[0], ps[ps.length - 1], 1e-6)
      return add1(ctx, makeEntity({ t: 'spline', ctrl: closed ? ps.slice(0, -1) : ps, closed, through: true }, ctx.layer))
    },
  },
  {
    id: 'text',
    label: 'Text',
    group: 'draw',
    icon: Type,
    key: 't',
    params: ['text', 'height'],
    prompts: ['Start of the text baseline'],
    preview: (_cs, cur, ctx) => strokeText(ctx.params.text, cur, ctx.params.height),
    apply: (cs, ctx) => add1(ctx, makeEntity({ t: 'text', at: cs[0].p, text: ctx.params.text, height: ctx.params.height, angle: 0 }, 'text')),
  },
  {
    id: 'point',
    label: 'Point',
    group: 'draw',
    icon: Dot,
    prompts: ['Point'],
    apply: (cs, ctx) => add1(ctx, makeEntity({ t: 'point', p: cs[0].p }, ctx.layer)),
  },

  {
    id: 'move',
    label: 'Move',
    group: 'change',
    icon: Move,
    key: 'm',
    needsSelection: true,
    prompts: ['Base point', 'Target point (or @dx,dy)'],
    apply: (cs, ctx) => {
      const r = transformEntities(ctx.part, ctx.sel, moveM(cs[0].p, cs[1].p))
      return { part: r.part, sel: r.ids }
    },
  },
  {
    id: 'copy',
    label: 'Copy',
    group: 'change',
    icon: Copy,
    needsSelection: true,
    prompts: ['Base point', 'Target point for the copy'],
    apply: (cs, ctx) => {
      const r = transformEntities(ctx.part, ctx.sel, moveM(cs[0].p, cs[1].p), true)
      return { part: r.part, sel: r.ids }
    },
  },
  {
    id: 'rotate',
    label: 'Rotate',
    group: 'change',
    icon: RotateCw,
    needsSelection: true,
    params: ['angle'],
    prompts: ['Centre of rotation'],
    apply: (cs, ctx) => {
      const r = transformEntities(ctx.part, ctx.sel, rotateM(ctx.params.angle * deg, cs[0].p))
      return { part: r.part, sel: r.ids }
    },
  },
  {
    id: 'mirror',
    label: 'Mirror',
    group: 'change',
    icon: FlipHorizontal2,
    needsSelection: true,
    prompts: ['First point of the mirror line', 'Second point'],
    preview: (cs, cur) => (cs.length ? [polyline([cs[0].p, cur], false)] : []),
    apply: (cs, ctx) => {
      if (dist(cs[0].p, cs[1].p) < 1e-6) return null
      const r = transformEntities(ctx.part, ctx.sel, mirrorM(cs[0].p, cs[1].p), true)
      return { part: r.part, sel: r.ids }
    },
  },
  {
    id: 'scale',
    label: 'Scale',
    group: 'change',
    icon: Scaling,
    needsSelection: true,
    params: ['scale'],
    prompts: ['Base point'],
    apply: (cs, ctx) => {
      const r = transformEntities(ctx.part, ctx.sel, scaleM(ctx.params.scale, ctx.params.scale, cs[0].p))
      return { part: r.part, sel: r.ids }
    },
  },
  {
    id: 'array',
    label: 'Array',
    group: 'change',
    icon: Grid2x2,
    needsSelection: true,
    immediate: true,
    params: ['columns', 'rows', 'spacingX', 'spacingY'],
    prompts: [],
    apply: (_cs, ctx) => ({ part: arrayEntities(ctx.part, ctx.sel, ctx.params.columns, ctx.params.rows, ctx.params.spacingX, ctx.params.spacingY) }),
  },
  {
    id: 'offset',
    label: 'Offset',
    group: 'change',
    icon: CornerUpRight,
    key: 'o',
    params: ['distance'],
    pick: [0],
    prompts: ['Pick the shape to offset', 'Click the side to offset to'],
    apply: (cs, ctx) => ({ part: offsetEntity(ctx.part, cs[0].hit!, ctx.params.distance, cs[1].p), repeat: true }),
  },
  {
    id: 'fillet',
    label: 'Fillet',
    group: 'change',
    icon: CornerDownRight,
    key: 'f',
    params: ['radius', 'allCorners'],
    pick: [0],
    prompts: ['Pick near a corner'],
    apply: (cs, ctx) => ({ part: ctx.params.allCorners ? filletAll(ctx.part, cs[0].hit!, ctx.params.radius) : filletAt(ctx.part, cs[0].hit!, cs[0].p, ctx.params.radius), repeat: true }),
  },
  {
    id: 'chamfer',
    label: 'Chamfer',
    group: 'change',
    icon: Slash,
    params: ['distance'],
    pick: [0],
    prompts: ['Pick near a corner'],
    apply: (cs, ctx) => ({ part: chamferAt(ctx.part, cs[0].hit!, cs[0].p, ctx.params.distance), repeat: true }),
  },
  {
    id: 'relief',
    label: 'Corner relief',
    group: 'change',
    icon: CircleDot,
    params: ['radius', 'relief', 'removed', 'allCorners'],
    pick: [0],
    prompts: ['Pick near a corner (or set "all corners")'],
    apply: (cs, ctx) => ({ part: reliefAt(ctx.part, cs[0].hit!, ctx.params.allCorners ? null : cs[0].p, ctx.params.radius, ctx.params.relief, ctx.params.removed), repeat: true }),
  },
  { id: 'trim', label: 'Trim', group: 'change', icon: Scissors, key: 'x', pick: [0], prompts: ['Pick the piece to remove'], apply: (cs, ctx) => ({ part: trimAt(ctx.part, cs[0].hit!, cs[0].p), repeat: true }) },
  { id: 'extend', label: 'Extend', group: 'change', icon: MoveHorizontal, pick: [0], prompts: ['Pick near the end to extend'], apply: (cs, ctx) => ({ part: extendAt(ctx.part, cs[0].hit!, cs[0].p), repeat: true }) },
  { id: 'break', label: 'Break', group: 'change', icon: Split, pick: [0], prompts: ['Pick the break point'], apply: (cs, ctx) => ({ part: breakEntity(ctx.part, cs[0].hit!, cs[0].p), repeat: true }) },
  { id: 'join', label: 'Join', group: 'change', icon: Link2, key: 'j', needsSelection: true, immediate: true, params: ['gap'], prompts: [], apply: (_c, ctx) => ({ part: joinEntities(ctx.part, ctx.sel, ctx.params.gap), sel: [] }) },
  { id: 'explode', label: 'Explode', group: 'change', icon: Unlink, needsSelection: true, immediate: true, prompts: [], apply: (_c, ctx) => ({ part: ctx.sel.reduce((p, id) => explodeEntity(p, id), ctx.part), sel: [] }) },
  { id: 'reverse', label: 'Reverse direction', group: 'change', icon: ArrowRightLeft, needsSelection: true, immediate: true, prompts: [], apply: (_c, ctx) => ({ part: ctx.sel.reduce((p, id) => reverseEntity(p, id), ctx.part) }) },
  { id: 'cleanup', label: 'Clean up', group: 'change', icon: Wand2, needsSelection: true, immediate: true, params: ['gap'], prompts: [], apply: (_c, ctx) => ({ part: cleanupEntities(ctx.part, ctx.sel, ctx.params.gap, 0.01), sel: [] }) },

  {
    id: 'unite',
    label: 'Unite',
    group: 'area',
    icon: SquaresUnite,
    needsSelection: true,
    immediate: true,
    prompts: [],
    apply: (_c, ctx) => (ctx.sel.length < 2 ? { message: 'Select two or more closed shapes.' } : { part: booleanEntities(ctx.part, 'unite', [ctx.sel[0]], ctx.sel.slice(1)), sel: [ctx.sel[0]] }),
  },
  {
    id: 'subtract',
    label: 'Subtract',
    group: 'area',
    icon: Diff,
    needsSelection: true,
    immediate: true,
    prompts: [],
    apply: (_c, ctx) => (ctx.sel.length < 2 ? { message: 'Select the shape to keep first, then the shapes to cut away.' } : { part: booleanEntities(ctx.part, 'subtract', [ctx.sel[0]], ctx.sel.slice(1)), sel: [ctx.sel[0]] }),
  },
  {
    id: 'intersect',
    label: 'Intersect',
    group: 'area',
    icon: SquaresIntersect,
    needsSelection: true,
    immediate: true,
    prompts: [],
    apply: (_c, ctx) => (ctx.sel.length < 2 ? { message: 'Select two or more closed shapes.' } : { part: booleanEntities(ctx.part, 'intersect', [ctx.sel[0]], ctx.sel.slice(1)), sel: [ctx.sel[0]] }),
  },
  { id: 'pathpick', label: 'Pick toolpath points', group: 'pick', icon: Route, prompts: ['Pick the next point of the toolpath'], apply: () => null },
  { id: 'measure', label: 'Measure', group: 'area', icon: Ruler, key: 'd', prompts: ['First point', 'Second point'], preview: (cs, cur) => (cs.length ? [polyline([cs[0].p, cur], false)] : []), apply: () => null },
]

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<ToolId, ToolDef>

function rounded(a: P, b: P, r: number) {
  const w = Math.abs(b.x - a.x)
  const h = Math.abs(b.y - a.y)
  const rr = Math.max(0, Math.min(r, w / 2 - 1e-6, h / 2 - 1e-6))
  return rr > 1e-6 ? roundedRect(Math.min(a.x, b.x), Math.min(a.y, b.y), w, h, rr) : box(a, b)
}

export const GROUP_LABEL: Record<ToolGroup, string> = { select: 'Pick', draw: 'Draw', change: 'Change', area: 'Area', pick: 'Toolpath' }

/** Run a tool step. Returns the result when the tool has all its clicks, else null. */
export function stepTool(tool: ToolDef, clicks: Click[], ctx: ToolCtx, finish = false): ToolResult | null {
  if (tool.immediate) return tool.apply([], ctx)
  if (tool.open) {
    const closedNow = clicks.length > 3 && near(clicks[0].p, clicks[clicks.length - 1].p, 1e-6)
    if (finish || closedNow) return tool.apply(clicks, ctx) ?? { message: 'Need at least two points.' }
    return null
  }
  if (clicks.length < tool.prompts.length) return null
  return tool.apply(clicks, ctx)
}

export const measureText = (a: P, b: P, fmt: (mm: number) => string) => {
  const d = dist(a, b)
  const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
  return `Distance ${fmt(d)} · dX ${fmt(b.x - a.x)} · dY ${fmt(b.y - a.y)} · angle ${ang.toFixed(2)}°`
}

export const isEditTool = (t: ToolDef) => t.group === 'change' || t.group === 'area'
