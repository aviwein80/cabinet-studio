/**
 * Unconfirmed values (M2.6e): every value the app uses that is a placeholder (invented, assumed or
 * a built-in default) and has not been confirmed by the shop. Each has a key, recorded in
 * `MachineProfile.confirmed` (shop values) or `CamOp.confirmed` (an operation's own values) once
 * confirmed, and a target: where in the app the real value goes.
 *
 * Confirming a value never changes what is written to the machine by itself: output switches,
 * units fitted (saw, aggregate) and every export check stay as they are.
 */
import { feedsFor } from '@/cam/ops'
import type { CamOp, CamPart } from '@/cam/types'
import { aggregateOf, effectiveGauge, effectiveHolder, machineModelOf, PLACEHOLDER_N200_MODEL } from './machineModel'
import type { MachineProfile, Tool } from './types'

/** Machine-model facts tracked one by one. */
export const MODEL_FACTS = ['table', 'travel', 'toolChange', 'safeZ', 'spoilboard', 'saw', 'aggregate'] as const
export type ModelFact = (typeof MODEL_FACTS)[number]
export const MODEL_FACT_LABEL: Record<ModelFact, string> = {
  table: 'Table size',
  travel: 'Axis travel',
  toolChange: 'Tool change position',
  safeZ: 'Machine safe Z',
  spoilboard: 'Spoilboard thickness',
  saw: 'Saw unit fitted or not',
  aggregate: 'Rotating aggregate fitted or not',
}

/** Default cutting values for new operations: the shop's, or these PLACEHOLDER ones. */
export interface CutDefaults {
  /** Pocket step-over, share of the tool diameter. */
  pocketStepover: number
  /** Facing step-over, share of the tool diameter. */
  faceStepover: number
  /** Toolpath edits: corner slow-down. */
  corners: { angle: number; distance: number; steps: number; percent: number }
  /** Edge work with an aggregate: tool axis below face 1 and reach into the edge, mm. */
  edgeHeight: number
  edgeReach: number
  /** Z-wave: shallowest and deepest, wave length, mm. */
  zwave: { min: number; max: number; length: number }
  /** Cuts between curves: largest gap between passes, mm. */
  betweenStepover: number
  /** 3D finishing: step-over, mm; waterline step-down, mm. */
  finishStepover: number
  waterlineStepdown: number
  /** Z-level roughing: step-down, mm; step-over, share of the tool diameter. */
  roughStepdown: number
  roughStepover: number
  /** Adaptive clearing: width of cut, share of the tool diameter. */
  adaptiveWidth: number
  /** Undercut roughing with a lollipop (M3.1g): height between levels, mm; step-over, share of the ball's diameter. */
  undercutStepdown: number
  undercutStepover: number
}
export type CutDefaultKey = keyof CutDefaults

/** PLACEHOLDER values (the ones every operation has used so far). */
export const BUILTIN_CUT_DEFAULTS: CutDefaults = {
  pocketStepover: 0.45,
  faceStepover: 0.45,
  corners: { angle: 45, distance: 10, steps: 2, percent: 50 },
  edgeHeight: 9.5,
  edgeReach: 5,
  zwave: { min: 1, max: 4, length: 40 },
  betweenStepover: 1,
  finishStepover: 0.6,
  waterlineStepdown: 0.5,
  roughStepdown: 3,
  roughStepover: 0.4,
  adaptiveWidth: 0.15,
  // light cuts for a ball on a thin neck (PLACEHOLDER, like every value here)
  undercutStepdown: 1,
  undercutStepover: 0.1,
}

export const CUT_DEFAULT_LABEL: Record<CutDefaultKey, string> = {
  pocketStepover: 'Pocket step-over',
  faceStepover: 'Facing step-over',
  corners: 'Corner slow-down',
  edgeHeight: 'Edge work: tool axis height',
  edgeReach: 'Edge work: reach into the edge',
  zwave: 'Z-wave depths and length',
  betweenStepover: 'Cut between curves: step-over',
  finishStepover: '3D finishing step-over',
  waterlineStepdown: 'Waterline and helical step-down',
  roughStepdown: 'Z-level roughing step-down',
  roughStepover: 'Z-level roughing step-over',
  adaptiveWidth: 'Adaptive width of cut',
  undercutStepdown: 'Undercut roughing step-down',
  undercutStepover: 'Undercut roughing step-over',
}

export const CUT_DEFAULT_KEYS = Object.keys(BUILTIN_CUT_DEFAULTS) as CutDefaultKey[]

export function cutDefaultsOf(m: Pick<MachineProfile, 'cutDefaults'>): CutDefaults {
  return { ...BUILTIN_CUT_DEFAULTS, ...(m.cutDefaults ?? {}) }
}

export type ToolPart = 'data' | 'blade' | 'lengths' | 'feeds'

/** Where the real value goes. */
export type ConfigTarget =
  | { kind: 'tool'; toolId: string; part: ToolPart }
  | { kind: 'holder'; holderId: string }
  | { kind: 'aggregate'; aggregateId: string }
  | { kind: 'model'; fact: ModelFact }
  | { kind: 'default'; key: CutDefaultKey }
  | { kind: 'op'; partId: string; jobId?: string; opId: string; key: CutDefaultKey | 'blade' }
  | { kind: 'material'; materialId: string; part: 'price' | 'density' }
  | { kind: 'nest'; key: NestValueKey }

/** Nesting values (M2.8) that are placeholders until the shop confirms them. */
export type NestValueKey = 'sharedSmall' | 'bridgeWidth' | 'bridgeMaxLength' | 'bridgeMaxArea' | 'flipAxis' | 'flipReference'

export interface Unconfirmed {
  key: string
  label: string
  /** The value in use, as shown to the owner. */
  value: string
  group: 'Tools' | 'Holders' | 'Aggregates' | 'Machine model' | 'Cutting values' | 'Operations' | 'Materials' | 'Nesting'
  target: ConfigTarget
}

export const keyOf = (t: ConfigTarget): string => {
  switch (t.kind) {
    case 'tool':
      return `tool:${t.toolId}:${t.part}`
    case 'holder':
      return `holder:${t.holderId}`
    case 'aggregate':
      return `aggregate:${t.aggregateId}`
    case 'model':
      return `model:${t.fact}`
    case 'default':
      return `default:${t.key}`
    case 'op':
      return `op:${t.opId}:${t.key}`
    case 'material':
      return `material:${t.materialId}:${t.part}`
    case 'nest':
      return `nest:${t.key}`
  }
}

export const isConfirmed = (m: Pick<MachineProfile, 'confirmed'>, key: string) => !!m.confirmed?.includes(key)

/** Tools whose lengths matter to collision checks: 3D shapes, and every router in a holder (M2.7). */
const hasLengths = (m: MachineProfile, t: Tool) => t.type === 'router' && (t.shape === 'ball' || t.shape === 'bull' || t.shape === 'lollipop' || !!effectiveHolder(m, t))
const fmt = (n: number) => String(Math.round(n * 1000) / 1000)

function factValue(m: MachineProfile, f: ModelFact): string {
  const mm = machineModelOf(m)
  switch (f) {
    case 'table':
      return `${fmt(mm.table.length)} x ${fmt(mm.table.width)} mm`
    case 'travel':
      return mm.axes.map((a) => `${a.id} ${fmt(a.max)}`).join(', ')
    case 'toolChange':
      return `X${fmt(mm.toolChange.x)} Y${fmt(mm.toolChange.y)} Z${fmt(mm.toolChange.z)}`
    case 'safeZ':
      return `${fmt(mm.safeZ)} mm`
    case 'spoilboard':
      return `${fmt(mm.spoilboard.thickness)} mm`
    case 'saw':
      return mm.capabilities.saw ? 'fitted' : 'not fitted'
    case 'aggregate':
      return mm.capabilities.aggregate ? 'fitted' : 'not fitted'
  }
}

function defaultValue(d: CutDefaults, k: CutDefaultKey): string {
  const v = d[k]
  if (k === 'corners') {
    const c = v as CutDefaults['corners']
    return `${c.angle}°, ${c.distance} mm, ${c.steps} steps, ${c.percent} %`
  }
  if (k === 'zwave') {
    const w = v as CutDefaults['zwave']
    return `${w.min}-${w.max} mm every ${w.length} mm`
  }
  if (k === 'pocketStepover' || k === 'faceStepover' || k === 'roughStepover' || k === 'adaptiveWidth' || k === 'undercutStepover') return `${Math.round((v as number) * 100)} % of the tool`
  return `${fmt(v as number)} mm`
}

/** One tool's unconfirmed parts. */
export function toolUnconfirmed(m: MachineProfile, t: Tool): Unconfirmed[] {
  const out: Unconfirmed[] = []
  const add = (part: ToolPart, label: string, value: string, open: boolean) => {
    const target: ConfigTarget = { kind: 'tool', toolId: t.id, part }
    if (open && !isConfirmed(m, keyOf(target))) out.push({ key: keyOf(target), label: `T${t.number} ${label}`, value, group: 'Tools', target })
  }
  // M3.1g (owner): lollipop sizes are not known. Its ball, neck, flute and stick-out stay badged until
  // each is confirmed, even once the rest of the tool table is real.
  const lolly = t.shape === 'lollipop'
  add('data', lolly ? 'number, ball Ø and depth' : 'number, diameter and depth', `${lolly ? 'ball ' : ''}Ø${fmt(t.diameter)}, ${fmt(t.maxDepth)} deep`, m.placeholder || lolly)
  if (t.type === 'saw') add('blade', 'blade diameter', t.bladeDiameter ? `Ø${fmt(t.bladeDiameter)} mm` : 'Ø200 mm (assumed)', m.placeholder || !t.bladeDiameter)
  if (hasLengths(m, t)) {
    // no stick-out given: the shortest possible (the flute length) is assumed, so checks err safe
    const g = effectiveGauge(m, t)
    const stick = g.assumed ? `${fmt(g.gauge)} (assumed = flute length)` : t.gaugeLength ? fmt(t.gaugeLength) : '?'
    const neck = lolly ? `neck Ø${t.shankDiameter ? fmt(t.shankDiameter) : '? (not given)'}, ` : ''
    add('lengths', lolly ? 'neck Ø, flute and stick-out' : 'shank, flute and stick-out', `${neck}flute ${fmt(t.fluteLength ?? t.maxDepth)}, stick-out ${stick} mm`, m.placeholder || g.assumed || lolly)
  }
  if (t.type === 'router' || t.type === 'saw') {
    const f = feedsFor({ feeds: {} } as CamOp, t, null, m)
    add('feeds', 'feeds, speed and step-down', `${f.rpm} rpm, ${Math.round(f.feed)} mm/min${f.source === 'default' ? ' (built-in)' : ''}`, m.placeholder || f.source === 'default')
  }
  return out
}

/** The holder a tool uses (its own or the shop default), while it is a placeholder. */
export function holderItem(m: MachineProfile, t: Tool): Unconfirmed | null {
  const h = effectiveHolder(m, t)
  const target: ConfigTarget = { kind: 'holder', holderId: h?.id ?? '' }
  if (!h?.placeholder || isConfirmed(m, keyOf(target))) return null
  return { key: keyOf(target), label: `Holder ${h.name}${t.holderId ? '' : ' (shop default)'}`, value: 'invented outline', group: 'Holders', target }
}

/** An aggregate while it is a placeholder. */
export function aggregateItem(m: MachineProfile, id: string): Unconfirmed | null {
  const a = aggregateOf(m, { aggregateId: id })
  const target: ConfigTarget = { kind: 'aggregate', aggregateId: id }
  if (!a?.placeholder || isConfirmed(m, keyOf(target))) return null
  return { key: keyOf(target), label: `Aggregate ${a.name}`, value: `offset ${fmt(a.offset.x)} / ${fmt(a.offset.y)} / ${fmt(a.offset.z)} mm, housing ${fmt(a.housing.width)} wide`, group: 'Aggregates', target }
}

/** Every unconfirmed shop value: tools, holders, machine-model facts, default cutting values. */
export function machineUnconfirmed(m: MachineProfile): Unconfirmed[] {
  const out: Unconfirmed[] = []
  for (const t of m.tools) out.push(...toolUnconfirmed(m, t))
  for (const h of m.holders ?? []) {
    const target: ConfigTarget = { kind: 'holder', holderId: h.id }
    if (h.placeholder && !isConfirmed(m, keyOf(target))) out.push({ key: keyOf(target), label: `Holder ${h.name}`, value: 'invented outline', group: 'Holders', target })
  }
  for (const a of m.aggregates ?? []) {
    const u = aggregateItem(m, a.id)
    if (u) out.push(u)
  }
  if (machineModelOf(m).placeholder)
    for (const fact of MODEL_FACTS) {
      const target: ConfigTarget = { kind: 'model', fact }
      if (!isConfirmed(m, keyOf(target))) out.push({ key: keyOf(target), label: MODEL_FACT_LABEL[fact], value: factValue(m, fact), group: 'Machine model', target })
    }
  const d = cutDefaultsOf(m)
  for (const k of CUT_DEFAULT_KEYS) {
    const target: ConfigTarget = { kind: 'default', key: k }
    if (!isConfirmed(m, keyOf(target))) out.push({ key: keyOf(target), label: CUT_DEFAULT_LABEL[k], value: defaultValue(d, k), group: 'Cutting values', target })
  }
  return out
}

/**
 * Mark a shop value confirmed (on a copy of the machine being edited). Confirming every
 * machine-model fact clears the model's placeholder flag; confirming a holder clears its own. It
 * never turns on a unit or an output.
 */
export function confirmKey(m: MachineProfile, key: string) {
  m.confirmed = [...new Set([...(m.confirmed ?? []), key])]
  if (key.startsWith('holder:')) {
    const h = m.holders?.find((x) => `holder:${x.id}` === key)
    if (h) h.placeholder = false
  }
  if (key.startsWith('aggregate:')) {
    const a = m.aggregates?.find((x) => `aggregate:${x.id}` === key)
    if (a) a.placeholder = false
  }
  if (key.startsWith('model:') && MODEL_FACTS.every((f) => m.confirmed!.includes(`model:${f}`))) {
    m.physical = structuredClone(m.physical ?? PLACEHOLDER_N200_MODEL)
    m.physical.placeholder = false
  }
}

// ---------------------------------------------------------------------------------------------
// Operation values
// ---------------------------------------------------------------------------------------------

/** An operation's value that comes from a default cutting value, and how to read and write it. */
interface OpField {
  key: CutDefaultKey
  applies: (op: CamOp) => boolean
  get: (op: CamOp) => unknown
  set: (op: CamOp, v: unknown) => CamOp
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const pick = <T extends object>(o: T, keys: (keyof T)[]) => Object.fromEntries(keys.map((k) => [k, o[k]]))

export const OP_FIELDS: OpField[] = [
  { key: 'pocketStepover', applies: (o) => o.kind === 'pocket' && o.pattern !== 'adaptive', get: (o) => (o as { stepover: number }).stepover, set: (o, v) => ({ ...o, stepover: v }) as CamOp },
  { key: 'adaptiveWidth', applies: (o) => (o.kind === 'pocket' || o.kind === 'rough3d') && o.pattern === 'adaptive', get: (o) => ((o as { adaptive?: { width: number } }).adaptive?.width ?? BUILTIN_CUT_DEFAULTS.adaptiveWidth), set: (o, v) => ({ ...o, adaptive: { ...(o as { adaptive?: object }).adaptive, width: v } }) as CamOp },
  { key: 'faceStepover', applies: (o) => o.kind === 'face', get: (o) => (o as { stepover: number }).stepover, set: (o, v) => ({ ...o, stepover: v }) as CamOp },
  { key: 'corners', applies: (o) => !!o.edits?.corners, get: (o) => o.edits!.corners, set: (o, v) => ({ ...o, edits: { ...o.edits, corners: v } }) as CamOp },
  { key: 'edgeHeight', applies: (o) => o.kind === 'edge', get: (o) => (o as { height: number }).height, set: (o, v) => ({ ...o, height: v }) as CamOp },
  { key: 'edgeReach', applies: (o) => o.kind === 'edge', get: (o) => (o as { reach: number }).reach, set: (o, v) => ({ ...o, reach: v }) as CamOp },
  {
    key: 'zwave',
    applies: (o) => o.kind === 'curve' && o.mode === 'zwave',
    get: (o) => pick((o as { wave: { min: number; max: number; length: number } }).wave, ['min', 'max', 'length']),
    set: (o, v) => ({ ...o, wave: { ...(o as { wave: object }).wave, ...(v as object) } }) as CamOp,
  },
  { key: 'betweenStepover', applies: (o) => o.kind === 'curve' && o.mode === 'between', get: (o) => (o as { stepover: number }).stepover, set: (o, v) => ({ ...o, stepover: v }) as CamOp },
  { key: 'finishStepover', applies: (o) => o.kind === 'finish3d' && o.strategy !== 'projection' && o.strategy !== 'pencil' && !(o.strategy === 'curve' && o.drive?.mode === 'intersection'), get: (o) => (o as { stepover: number }).stepover, set: (o, v) => ({ ...o, stepover: v }) as CamOp },
  { key: 'waterlineStepdown', applies: (o) => o.kind === 'finish3d' && (o.strategy === 'waterline' || o.strategy === 'helical'), get: (o) => (o as { stepdown?: number }).stepdown ?? 1, set: (o, v) => ({ ...o, stepdown: v }) as CamOp },
  { key: 'roughStepdown', applies: (o) => o.kind === 'rough3d' && o.pattern !== 'undercut', get: (o) => (o as { stepdown: number }).stepdown, set: (o, v) => ({ ...o, stepdown: v }) as CamOp },
  { key: 'roughStepover', applies: (o) => o.kind === 'rough3d' && o.pattern !== 'adaptive' && o.pattern !== 'undercut', get: (o) => (o as { stepover: number }).stepover, set: (o, v) => ({ ...o, stepover: v }) as CamOp },
  { key: 'undercutStepdown', applies: (o) => o.kind === 'rough3d' && o.pattern === 'undercut', get: (o) => (o as { stepdown: number }).stepdown, set: (o, v) => ({ ...o, stepdown: v }) as CamOp },
  { key: 'undercutStepover', applies: (o) => o.kind === 'rough3d' && o.pattern === 'undercut', get: (o) => (o as { stepover: number }).stepover, set: (o, v) => ({ ...o, stepover: v }) as CamOp },
]

/**
 * Is an operation's value still a placeholder? Yes when the operation has not confirmed it, it
 * equals the shop's default for it, and that default is not confirmed. A value set to something
 * else is the owner's own.
 */
export function opFieldPlaceholder(op: CamOp, f: OpField, m: MachineProfile): boolean {
  if (!f.applies(op) || op.confirmed?.includes(f.key)) return false
  if (isConfirmed(m, `default:${f.key}`)) return false
  const d = cutDefaultsOf(m)[f.key]
  return same(f.get(op), f.key === 'zwave' ? pick(d as CutDefaults['zwave'], ['min', 'max', 'length']) : d)
}

/** An operation's unconfirmed values: its own (default cutting values), its blade, and those of its tool. */
export function opUnconfirmed(op: CamOp, part: Pick<CamPart, 'id'>, m: MachineProfile, tool: Tool | null, jobId?: string): Unconfirmed[] {
  const out: Unconfirmed[] = []
  for (const f of OP_FIELDS)
    if (opFieldPlaceholder(op, f, m)) {
      const target: ConfigTarget = { kind: 'op', partId: part.id, jobId, opId: op.id, key: f.key }
      out.push({ key: keyOf(target), label: `${op.name}: ${CUT_DEFAULT_LABEL[f.key].toLowerCase()}`, value: defaultValue(cutDefaultsOf(m), f.key), group: 'Operations', target })
    }
  if (tool) {
    // a saw cut with its own blade does not use the tool's
    const ownBlade = op.kind === 'saw' && !!op.saw?.blade
    out.push(...toolUnconfirmed(m, tool).filter((u) => !(ownBlade && u.target.kind === 'tool' && u.target.part === 'blade')).filter((u) => !(u.target.kind === 'tool' && u.target.part === 'feeds' && (op.feeds.feed || op.feeds.rpm))))
    const h = holderItem(m, tool)
    if (h) out.push(h)
    const a = tool.aggregateId ? aggregateItem(m, tool.aggregateId) : null
    if (a && op.kind === 'edge') out.push(a)
  }
  if (op.kind === 'edge') {
    const target: ConfigTarget = { kind: 'model', fact: 'aggregate' }
    if (machineModelOf(m).placeholder && !isConfirmed(m, keyOf(target))) out.push({ key: keyOf(target), label: MODEL_FACT_LABEL.aggregate, value: factValue(m, 'aggregate'), group: 'Machine model', target })
  }
  if (op.kind === 'saw') {
    const target: ConfigTarget = { kind: 'model', fact: 'saw' }
    if (machineModelOf(m).placeholder && !isConfirmed(m, keyOf(target))) out.push({ key: keyOf(target), label: MODEL_FACT_LABEL.saw, value: factValue(m, 'saw'), group: 'Machine model', target })
  }
  return out
}

/** The operation's value confirmed by the owner (they typed it, or said the shown one is right). */
export function confirmOp<T extends CamOp>(op: T, key: CutDefaultKey): T {
  return op.confirmed?.includes(key) ? op : ({ ...op, confirmed: [...(op.confirmed ?? []), key] } as T)
}

/** Shop default values for a new operation of this kind (applied over `defaultOp`). */
export function newOpDefaults(kind: CamOp['kind'], m: MachineProfile, extra: Partial<CamOp> = {}): Partial<CamOp> {
  const d = cutDefaultsOf(m)
  const mode = (extra as { mode?: string }).mode
  const strategy = (extra as { strategy?: string }).strategy
  switch (kind) {
    case 'pocket':
      return { stepover: d.pocketStepover } as Partial<CamOp>
    case 'face':
      return { stepover: d.faceStepover } as Partial<CamOp>
    case 'edge':
      return { height: d.edgeHeight, reach: d.edgeReach } as Partial<CamOp>
    case 'curve':
      return mode === 'between' ? ({ stepover: d.betweenStepover } as Partial<CamOp>) : mode === 'zwave' || !mode ? ({ wave: { ...d.zwave, shape: 'sine' } } as Partial<CamOp>) : {}
    case 'finish3d':
      return strategy === 'waterline' || strategy === 'helical' ? ({ stepover: d.finishStepover, stepdown: d.waterlineStepdown } as Partial<CamOp>) : strategy === 'projection' || strategy === 'pencil' ? {} : ({ stepover: d.finishStepover } as Partial<CamOp>)
    case 'rough3d':
      return (extra as { pattern?: string }).pattern === 'undercut' ? ({ stepdown: d.undercutStepdown, stepover: d.undercutStepover } as Partial<CamOp>) : ({ stepdown: d.roughStepdown, stepover: d.roughStepover } as Partial<CamOp>)
    default:
      return {}
  }
}

/**
 * A shop default changed from `old` to `next`: every operation that still uses the old value (not
 * confirmed or changed on the operation) takes the new one. Returns the parts that changed (their
 * toolpaths become stale, so the collision and export checks run again).
 */
export function retargetDefault(parts: CamPart[], key: CutDefaultKey, old: unknown, next: unknown): CamPart[] {
  const f = OP_FIELDS.find((x) => x.key === key)
  if (!f) return parts
  const oldV = key === 'zwave' ? pick(old as CutDefaults['zwave'], ['min', 'max', 'length']) : old
  return parts.map((p) => {
    let changed = false
    const ops = p.ops.map((op) => {
      if (!f.applies(op) || op.confirmed?.includes(key) || !same(f.get(op), oldV)) return op
      changed = true
      return f.set(op, next)
    })
    return changed ? { ...p, ops } : p
  })
}

/**
 * Change a shop default cutting value (on a copy of the shop data): it becomes confirmed, and every
 * operation in the jobs and the part library still using the old value takes the new one.
 */
export function setCutDefault(d: { machine: MachineProfile; jobs: { camParts?: CamPart[] }[]; library: { partLibrary?: CamPart[] } }, key: CutDefaultKey, value: CutDefaults[CutDefaultKey]) {
  const old = cutDefaultsOf(d.machine)[key]
  d.machine.cutDefaults = { ...(d.machine.cutDefaults ?? {}), [key]: value }
  confirmKey(d.machine, `default:${key}`)
  for (const j of d.jobs) if (j.camParts) j.camParts = retargetDefault(j.camParts, key, old, value)
  if (d.library.partLibrary) d.library.partLibrary = retargetDefault(d.library.partLibrary, key, old, value)
}

/** Unconfirmed values a set of custom-part operations and machine tools use (deduplicated). */
export function usedUnconfirmed(m: MachineProfile, toolIds: Iterable<string>, parts: CamPart[], toolOf: (op: CamOp, part: CamPart) => Tool | null = () => null): Unconfirmed[] {
  const out = new Map<string, Unconfirmed>()
  const put = (u: Unconfirmed) => out.set(u.key, u)
  for (const id of toolIds) {
    const t = m.tools.find((x) => x.id === id)
    if (!t) continue
    toolUnconfirmed(m, t).forEach(put)
    const h = holderItem(m, t)
    if (h) put(h)
  }
  for (const p of parts) for (const op of p.ops) if (op.enabled) opUnconfirmed(op, p, m, toolOf(op, p)).forEach(put)
  for (const u of machineUnconfirmed(m)) if (u.group === 'Machine model') put(u)
  return [...out.values()]
}
