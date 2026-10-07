/**
 * Operation defaults, tool selection and feeds. Tools come from the shared machine profile so
 * custom parts and cabinets use one tool table.
 */
import { nanoid } from 'nanoid'
import { cutoutTool, findDrill, squareEnd } from '@/core/machining'
import type { MachineProfile, Tool } from '@/core/types'
import type { AdaptiveSettings, CamOp, CamOpKind, Leads, Levels, OpTemplate, SawSettings, Tags, ToolAxisControl } from './types'

export const DEFAULT_LEVELS: Levels = { safeZ: 20, rapidZ: 3, depth: 6, through: false, stockZ: 0, passDepth: 0 }
export const DEFAULT_LEADS: Leads = { in: 'arc', out: 'arc', length: 2, radius: 1.5, rampAngle: 5, overlap: 2, feedPct: 50 }
/** PLACEHOLDER adaptive-clearing values until the shop supplies its own: 15 % width of cut, feed not boosted. */
export const DEFAULT_ADAPTIVE: AdaptiveSettings = { width: 0.15, smoothing: 1, lift: 0.5, feedBoost: 1 }
/** Saw-cut settings for a new saw cut: vertical, extended to clear, joined, kept off neighbours. */
export const DEFAULT_SAW: SawSettings = { tilt: 0, tiltSide: 'left', clear: true, extend: 0, minLength: 0, join: true, avoid: true }
/**
 * PLACEHOLDER blade diameter (mm) for saw tools without one, used only to work out the run-out.
 * A larger blade gives a longer run-out, so the neighbour check errs on the safe side.
 */
export const PLACEHOLDER_BLADE = 200
export const DEFAULT_TAGS: Tags = { mode: 'none', count: 4, length: 12, height: 2, shape: 'flat', rampAngle: 30, at: [] }

export const OP_LABEL: Record<CamOpKind, string> = {
  profile: 'Profile',
  pocket: 'Pocket',
  drill: 'Drill',
  engrave: 'Engrave',
  vcarve: 'V-carve',
  saw: 'Saw groove',
  sweep: 'Profiled sweep',
  code: 'Program note',
  finish3d: '3D finishing',
  rough3d: '3D roughing (Z-level)',
  face: 'Facing',
  chamfer: 'Chamfer',
  curve: 'Curve cut',
  manual: 'Hand-drawn toolpath',
  edge: 'Edge work (aggregate)',
  thread: 'Thread milling',
  rotary: 'Rotary machining',
  multiaxis: '5-axis machining',
}

/**
 * PLACEHOLDER tool-axis settings for a new 5-axis operation (5AX-02): along the surface normal, no
 * lead or tilt, at most 60° from vertical; a point and a line 100 mm above the part's corner.
 */
export const DEFAULT_TOOL_AXIS: ToolAxisControl = { mode: 'surface-normal', lead: 0, tilt: 0, toward: 0, point: { x: 0, y: 0, z: 100 }, dir: { x: 1, y: 0, z: 0 }, maxTilt: 60 }

/** A new 5-axis operation's tool axis: square to the curve along curves, towards the top curve for swarf, on the surface normal otherwise. */
export function defaultToolAxis(strategy: 'curve' | 'swarf' | 'surface' | 'rough', maxTilt = DEFAULT_TOOL_AXIS.maxTilt): ToolAxisControl {
  return { ...DEFAULT_TOOL_AXIS, point: { ...DEFAULT_TOOL_AXIS.point }, dir: { ...DEFAULT_TOOL_AXIS.dir }, maxTilt, mode: strategy === 'curve' ? 'curve-normal' : strategy === 'swarf' ? 'guide' : 'surface-normal' }
}

export function defaultOp(kind: CamOpKind, geometry: string[] = [], extra: Partial<CamOp> = {}): CamOp {
  const base = {
    id: nanoid(8),
    name: OP_LABEL[kind],
    enabled: true,
    geometry,
    toolId: null,
    levels: { ...DEFAULT_LEVELS },
    feeds: {},
    face: 1 as const,
  }
  let op: CamOp
  switch (kind) {
    case 'profile':
      op = {
        ...base,
        kind,
        side: 'outside',
        direction: 'climb',
        compensation: 'cam',
        corners: 'round',
        stockXY: 0,
        leads: { ...DEFAULT_LEADS },
        tags: { ...DEFAULT_TAGS, at: [] },
        bidirectional: false,
        slope: 0,
        levels: { ...DEFAULT_LEVELS, through: true },
      }
      break
    case 'pocket':
      op = { ...base, kind, pattern: 'offset', stepover: 0.45, angle: 0, direction: 'climb', islands: true, entry: 'helix', rampAngle: 5, helixPct: 0.8, finishPass: true, stockXY: 0 }
      break
    case 'drill':
      op = { ...base, kind, cycle: 'drill', peck: 5, dwell: 0, select: { mode: 'all' }, depthRef: 'tip', levels: { ...DEFAULT_LEVELS, depth: 13 } }
      break
    case 'engrave':
      op = { ...base, kind, levels: { ...DEFAULT_LEVELS, depth: 1 } }
      break
    case 'vcarve':
      op = { ...base, kind, step: 0.25, levels: { ...DEFAULT_LEVELS, depth: 8 } }
      break
    case 'saw':
      op = { ...base, kind, levels: { ...DEFAULT_LEVELS, depth: 8 } }
      break
    case 'sweep':
      op = {
        ...base,
        kind,
        side: 'inside',
        step: 1,
        section: [
          { inset: 0, depth: 10 },
          { inset: 40, depth: 3 },
          { inset: 42, depth: 0 },
        ],
      }
      break
    case 'code':
      op = { ...base, kind, text: '', stop: false }
      break
    case 'chamfer':
      op = { ...base, kind, side: 'outside', drive: 'width', size: 3, tipOffset: 0, direction: 'climb', levels: { ...DEFAULT_LEVELS, depth: 0 } }
      break
    case 'curve': {
      // PLACEHOLDER step-over and wave until the shop supplies its own
      const mode = ((extra as { mode?: string }).mode ?? 'zwave') as 'between' | 'follow3d' | 'zwave'
      op = { ...base, kind, name: { between: 'Cut between curves', follow3d: 'Cut along 3D curve', zwave: 'Z-wave' }[mode], mode, stepover: 1, depthA: 0, depthB: 5, zigzag: true, smooth: false, wave: { min: 1, max: 4, length: 40, shape: 'sine' }, tolerance: 0.01, levels: { ...DEFAULT_LEVELS, depth: 0 } }
      break
    }
    case 'edge':
      // PLACEHOLDER height and reach until the shop has an aggregate and supplies its own
      op = { ...base, kind, height: 9.5, reach: 5, reachPass: 0, direction: 'climb', overrun: 5 }
      break
    case 'manual':
      op = { ...base, kind, start: { x: 0, y: 0, z: 0 }, steps: [] }
      break
    case 'thread':
      // an M10 x 1.5 internal thread, 12 mm long, climb cut (bottom-up); PLACEHOLDER radial passes
      op = { ...base, kind, side: 'internal', diameter: 0, pitch: 1.5, hand: 'right', travel: 'up', threadDepth: 0, passes: 2, spring: false, levels: { ...DEFAULT_LEVELS, depth: 12 } }
      break
    case 'rotary': {
      // PLACEHOLDER step-over and step-down until the shop supplies its own; the first wrapped plane
      const strategy = ((extra as { strategy?: string }).strategy ?? 'along') as 'along' | 'around' | 'spiral' | 'wrap'
      const names = { along: 'Rotary passes along the axis', around: 'Rotary rings round the axis', spiral: 'Rotary spiral', wrap: 'Rotary wrapped shapes' }
      op = { ...base, kind, name: names[strategy], planeId: '', strategy, modelId: '', stepover: 1, stepdown: 0, stockToLeave: 0, tolerance: 0.01, zigzag: true, levels: { ...DEFAULT_LEVELS, safeZ: 20, rapidZ: 5, depth: strategy === 'wrap' ? 3 : 0 } }
      break
    }
    case 'multiaxis': {
      // the shop's licensed engine (none: "not licensed") until another is picked; PLACEHOLDER
      // step-over, step-down, axis smoothing and tilt limit until the shop supplies its own
      const strategy = ((extra as { strategy?: string }).strategy ?? 'surface') as 'curve' | 'swarf' | 'surface' | 'rough'
      const names = { curve: '5-axis along curves', swarf: '5-axis swarf (side of the tool)', surface: '5-axis surface finishing', rough: '5-axis roughing' }
      op = { ...base, kind, name: names[strategy], engine: '', strategy, modelId: '', axis: defaultToolAxis(strategy), side: 'left', stepover: 0.6, stepdown: 2, stockToLeave: 0, tolerance: 0.01, direction: 'forward', headFlip: 'auto', maxTurn: 0, gougeCheck: true, levels: { ...DEFAULT_LEVELS, depth: strategy === 'curve' ? 1 : 0 } }
      break
    }
    case 'face':
      // PLACEHOLDER step-over (the pocket's 45 %) until the shop supplies its own
      op = { ...base, kind, pattern: 'zigzag', stepover: 0.45, angle: 0, direction: 'climb', overhang: 0, resetTop: true, levels: { ...DEFAULT_LEVELS, depth: 1 } }
      break
    case 'finish3d':
      // PLACEHOLDER cutting values (10 % of a 6 mm ball) until the shop supplies its own.
      op = {
        ...base,
        kind,
        strategy: 'parallel',
        surface: { modelId: '', boundaryMode: 'centre', stockToLeave: 0, tolerance: 0.01 },
        stepover: 0.6,
        angle: 0,
        pattern: 'zigzag',
        direction: 'climb',
        slope: { min: 0, max: 90 },
        skipFlats: false,
        levels: { ...DEFAULT_LEVELS, depth: 0 },
      }
      if ((extra as { strategy?: string }).strategy === 'waterline') {
        // PLACEHOLDER: waterline on slopes of 30° and steeper, parallel passes on the rest
        Object.assign(op, { name: '3D finishing (waterline)', stepdown: 0.5, fillShallow: true, slope: { min: 30, max: 90 } })
      }
      // projection: on the surface until a depth is set
      if ((extra as { strategy?: string }).strategy === 'projection') Object.assign(op, { name: '3D finishing (projection)' })
      if ((extra as { strategy?: string }).strategy === 'pencil') Object.assign(op, { name: '3D finishing (pencil)' })
      // radial and spiral: round the middle of the boundary until a centre is set
      if ((extra as { strategy?: string }).strategy === 'radial') Object.assign(op, { name: '3D finishing (radial)', travel: 'outward' })
      if ((extra as { strategy?: string }).strategy === 'spiral') Object.assign(op, { name: '3D finishing (spiral)', travel: 'outward' })
      // scallop: in from the boundary until start shapes are picked
      if ((extra as { strategy?: string }).strategy === 'scallop') Object.assign(op, { name: '3D finishing (scallop)', travel: 'inward' })
      if ((extra as { strategy?: string }).strategy === 'flat') Object.assign(op, { name: '3D finishing (flat areas)', travel: 'inward' })
      if ((extra as { strategy?: string }).strategy === 'undercut') Object.assign(op, { name: '3D finishing (undercut)', undercut: 'both' })
      // PLACEHOLDER: helical on slopes of 30° and steeper, like waterline
      if ((extra as { strategy?: string }).strategy === 'helical') Object.assign(op, { name: '3D finishing (helical)', stepdown: 0.5, slope: { min: 30, max: 90 } })
      // curve-driven: along the picked drive shape only, until copies are asked for
      if ((extra as { strategy?: string }).strategy === 'curve') Object.assign(op, { name: '3D finishing (curve-driven)', drive: { mode: 'curves', shapes: [], side: 'both', copies: 0 } })
      break
    case 'rough3d':
      // PLACEHOLDER cutting values until the shop supplies its own
      op = {
        ...base,
        kind,
        surface: { modelId: '', boundaryMode: 'touching', stockToLeave: 0.5, tolerance: 0.05 },
        stockZ: 0.5,
        stepdown: 3,
        stepover: 0.4,
        pattern: 'offset',
        angle: 0,
        direction: 'climb',
        entry: 'helix',
        rampAngle: 5,
        helixPct: 0.8,
        flats: true,
        levels: { ...DEFAULT_LEVELS, depth: 0 },
      }
      // undercut roughing: a lollipop under the overhangs (light PLACEHOLDER cuts)
      if ((extra as { pattern?: string }).pattern === 'undercut') Object.assign(op, { name: '3D roughing (undercuts)', stepdown: 1, stepover: 0.1, surface: { ...op.surface, stockToLeave: 0.3, tolerance: 0.01 } })
      break
  }
  return { ...op, ...extra } as CamOp
}

export function toTemplate(op: CamOp): OpTemplate {
  const { id: _id, geometry: _g, builtHash: _h, toolData: _t, ...rest } = op
  // operation ids mean nothing in another part: rest machining then follows every earlier operation
  if (rest.kind === 'pocket' && rest.rest) return { ...rest, rest: { ...rest.rest, from: [] } } as OpTemplate
  if (rest.kind === 'finish3d' && rest.rest) return { ...rest, rest: { ...rest.rest, from: [] } } as OpTemplate
  return rest as OpTemplate
}
export function fromTemplate(t: OpTemplate, geometry: string[]): CamOp {
  return { ...structuredClone(t), id: nanoid(8), geometry } as CamOp
}

const routers = (m: MachineProfile) => m.tools.filter((t) => t.type === 'router')

/** The lollipop whose ball reaches furthest past its neck (undercut finishing and roughing). */
function furthestLollipop(machine: MachineProfile): Tool | null {
  const reach = (t: Tool) => t.diameter - (t.shankDiameter ?? t.diameter)
  return routers(machine).filter((t) => t.shape === 'lollipop').sort((a, b) => reach(b) - reach(a) || a.number - b.number)[0] ?? null
}

/** Tool for an op. Drill ops pick per hole, so this returns the explicit tool or null. */
export function resolveTool(op: CamOp, machine: MachineProfile, hint?: { width?: number; diameter?: number }): Tool | null {
  if (op.toolId) return machine.tools.find((t) => t.id === op.toolId) ?? null
  switch (op.kind) {
    case 'profile':
      return cutoutTool(machine) ?? routers(machine).find(squareEnd) ?? null
    case 'pocket':
    case 'sweep': {
      const fits = routers(machine)
        .filter((t) => squareEnd(t) && (!hint?.width || t.diameter <= hint.width + 1e-9))
        .sort((a, b) => b.diameter - a.diameter || a.number - b.number)
      return fits[0] ?? null
    }
    case 'chamfer':
      return routers(machine).filter((t) => t.shape === 'v').sort((a, b) => b.diameter - a.diameter || a.number - b.number)[0] ?? null
    case 'curve': {
      if (op.mode === 'between') {
        const shaped = routers(machine).filter((t) => t.shape === 'ball' || t.shape === 'bull')
        return shaped.sort((a, b) => Number(a.shape !== 'ball') - Number(b.shape !== 'ball') || b.diameter - a.diameter || a.number - b.number)[0] ?? routers(machine).filter(squareEnd).sort((a, b) => b.diameter - a.diameter)[0] ?? null
      }
      return routers(machine).filter(squareEnd).sort((a, b) => a.diameter - b.diameter || a.number - b.number)[0] ?? null
    }
    case 'manual':
    case 'edge':
      return routers(machine).filter(squareEnd).sort((a, b) => a.diameter - b.diameter || a.number - b.number)[0] ?? null
    case 'thread':
      // the smallest thread mill (it fits the most holes); a bigger one only when picked
      return routers(machine).filter((t) => t.shape === 'thread').sort((a, b) => a.diameter - b.diameter || a.number - b.number)[0] ?? null
    case 'face':
      // the widest flat cutter
      return routers(machine).filter(squareEnd).sort((a, b) => b.diameter - a.diameter || a.number - b.number)[0] ?? null
    case 'rotary': {
      // roughing: the widest flat end mill (not the cut-out tool); finishing and drawn shapes: the
      // largest ball-nose, then the smallest flat end mill
      const cut = cutoutTool(machine)
      if (op.stepdown > 0) return routers(machine).filter((t) => squareEnd(t) && t.id !== cut?.id).sort((a, b) => b.diameter - a.diameter || a.number - b.number)[0] ?? null
      const balls = routers(machine).filter((t) => t.shape === 'ball').sort((a, b) => b.diameter - a.diameter || a.number - b.number)
      return balls[0] ?? routers(machine).filter(squareEnd).sort((a, b) => a.diameter - b.diameter || a.number - b.number)[0] ?? null
    }
    case 'engrave':
      return routers(machine).filter(squareEnd).sort((a, b) => a.diameter - b.diameter)[0] ?? null
    case 'multiaxis': {
      // swarf: the flat end mill with the longest flutes (not the cut-out tool); along curves: the
      // smallest ball-nose, then the smallest flat end mill; surfaces: the largest ball-nose
      const cut = cutoutTool(machine)
      const balls = routers(machine).filter((t) => t.shape === 'ball')
      if (op.strategy === 'swarf') return routers(machine).filter((t) => squareEnd(t) && t.id !== cut?.id).sort((a, b) => (b.fluteLength ?? b.maxDepth) - (a.fluteLength ?? a.maxDepth) || a.number - b.number)[0] ?? null
      if (op.strategy === 'curve') return balls.sort((a, b) => a.diameter - b.diameter || a.number - b.number)[0] ?? routers(machine).filter(squareEnd).sort((a, b) => a.diameter - b.diameter || a.number - b.number)[0] ?? null
      return balls.sort((a, b) => b.diameter - a.diameter || a.number - b.number)[0] ?? null
    }
    case 'vcarve':
      return routers(machine).find((t) => t.shape === 'v') ?? null
    case 'saw':
      return machine.tools.find((t) => t.type === 'saw') ?? null
    case 'drill':
      return hint?.diameter ? findDrill(machine, hint.diameter, 0, op.face === 1 ? 'drill-vertical' : 'drill-horizontal') : null
    case 'code':
      return null
    case 'finish3d': {
      // undercuts: the lollipop whose ball reaches furthest past its neck
      if (op.strategy === 'undercut') return furthestLollipop(machine)
      // flat areas: the widest flat-bottomed tool (bull-nose first, then flat end mills other
      // than the cut-out tool)
      if (op.strategy === 'flat') {
        const cut = cutoutTool(machine)
        const flatBottom = routers(machine).filter((t) => t.id !== cut?.id && (t.shape === 'bull' || squareEnd(t)))
        return flatBottom.sort((a, b) => Number(a.shape !== 'bull') - Number(b.shape !== 'bull') || b.diameter - a.diameter || a.number - b.number)[0] ?? null
      }
      // along an intersection the ball touches both surfaces: the smallest ball-nose
      if (op.strategy === 'curve' && op.drive?.mode === 'intersection') return routers(machine).filter((t) => t.shape === 'ball').sort((a, b) => a.diameter - b.diameter || a.number - b.number)[0] ?? null
      // projection follows drawn shapes like engraving, pencil gets into the valleys: smallest
      // ball-nose first, then smallest V
      if (op.strategy === 'projection' || op.strategy === 'pencil') {
        const fine = routers(machine).filter((t) => t.shape === 'ball' || t.shape === 'v')
        return fine.sort((a, b) => Number(a.shape !== 'ball') - Number(b.shape !== 'ball') || a.diameter - b.diameter || a.number - b.number)[0] ?? null
      }
      // ball-nose first (largest), then bull-nose
      const shaped = routers(machine).filter((t) => t.shape === 'ball' || t.shape === 'bull')
      return shaped.sort((a, b) => Number(a.shape !== 'ball') - Number(b.shape !== 'ball') || b.diameter - a.diameter || a.number - b.number)[0] ?? null
    }
    case 'rough3d': {
      if (op.pattern === 'undercut') return furthestLollipop(machine)
      // bull-nose first, then flat end mills other than the cut-out tool, then ball-nose; largest first
      const cut = cutoutTool(machine)
      const rank = (t: Tool) => (t.shape === 'bull' ? 0 : squareEnd(t) ? 1 : t.shape === 'ball' ? 2 : 3)
      return routers(machine)
        .filter((t) => rank(t) < 3 && t.id !== cut?.id)
        .sort((a, b) => rank(a) - rank(b) || b.diameter - a.diameter || a.number - b.number)[0] ?? null
    }
  }
}

export interface Feeds {
  rpm: number
  feed: number
  plunge: number
  source: 'op' | 'material' | 'calculated' | 'fixed' | 'default'
}

/** Feeds: op override > material table > tool (calculated or fixed) > safe defaults. */
export function feedsFor(op: CamOp, tool: Tool | null, materialId: string | null, machine: MachineProfile): Feeds {
  const fromMat = tool && materialId ? machine.feeds?.find((f) => f.toolId === tool.id && f.materialId === materialId) : undefined
  let f: Feeds = { rpm: 18000, feed: 5000, plunge: 2000, source: 'default' }
  if (tool) {
    if (tool.feedMode === 'calculated' && tool.rpm && tool.flutes && tool.feedPerTooth)
      f = { rpm: tool.rpm, feed: tool.rpm * tool.flutes * tool.feedPerTooth, plunge: tool.plungeFeed ?? (tool.rpm * tool.flutes * tool.feedPerTooth) / 3, source: 'calculated' }
    else if (tool.feed) f = { rpm: tool.rpm ?? f.rpm, feed: tool.feed, plunge: tool.plungeFeed ?? tool.feed / 3, source: 'fixed' }
  }
  if (fromMat) f = { rpm: fromMat.rpm, feed: fromMat.feed, plunge: fromMat.plungeFeed, source: 'material' }
  if (op.feeds.feed || op.feeds.rpm || op.feeds.plunge) f = { rpm: op.feeds.rpm ?? f.rpm, feed: op.feeds.feed ?? f.feed, plunge: op.feeds.plunge ?? f.plunge, source: 'op' }
  return f
}

/** Depth of each pass: equal passes no deeper than `max`. */
export function passDepths(total: number, max: number): number[] {
  if (total <= 0) return []
  const n = max > 0 ? Math.max(1, Math.ceil(total / max - 1e-9)) : 1
  return Array.from({ length: n }, (_, i) => Math.round(((total * (i + 1)) / n) * 1e6) / 1e6)
}

/** Reorder ops by a saved tool-number order; ops on tools not in the list keep their relative order at the end. */
export function orderByTool(ops: CamOp[], toolOf: (op: CamOp) => Tool | null, order: number[]): CamOp[] {
  const rank = (op: CamOp) => {
    const t = toolOf(op)
    const i = t ? order.indexOf(t.number) : -1
    return i < 0 ? order.length : i
  }
  return ops
    .map((op, i) => ({ op, i, r: rank(op) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.op)
}
