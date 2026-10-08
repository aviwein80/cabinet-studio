/**
 * Unconfirmed values (M2.6e): every value the app uses that is a placeholder (invented, assumed or
 * a built-in default) and has not been confirmed by the shop. Each has a key, recorded in
 * `MachineProfile.confirmed` (shop values) or `CamOp.confirmed` (an operation's own values) once
 * confirmed, and a target: where in the app the real value goes.
 *
 * Confirming a value never changes what is written to the machine by itself: output switches,
 * units fitted (saw, aggregate) and every export check stay as they are.
 */
import { defaultToolAxis, feedsFor } from '@/cam/ops'
import type { CamOp, CamPart } from '@/cam/types'
import { aggregateOf, effectiveGauge, effectiveHolder, machineModelOf, PLACEHOLDER_N200_MODEL } from './machineModel'
import { fixtureTypesOf, PLACEHOLDER_FIXTURE_TYPES } from '@/cam/fixtures/fixture'
import { bodiesInvented, bodiesOf } from '@/cam/machine/model'
import type { Fixture, FixtureShape } from '@/cam/types'
import { KITCHEN_DEFAULTS } from './defaults'
import type { CarcassParams, Job, MachineProfile, Tool } from './types'

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
  /** Thread milling (M3.2): radial passes out to the full thread depth. */
  threadPasses: number
  /** Rotary machining (M3.3): gap between passes, mm; radial step-down when roughing, mm. */
  rotaryStepover: number
  rotaryStepdown: number
  /**
   * 5-axis machining (M3.5): gap between passes, mm; height between roughing levels, mm; largest tilt
   * of the tool from vertical, degrees; axis smoothing, largest turn of the tool axis per mm (0 = off).
   */
  multiAxisStepover: number
  multiAxisStepdown: number
  multiAxisMaxTilt: number
  multiAxisMaxTurn: number
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
  threadPasses: 2,
  rotaryStepover: 1,
  rotaryStepdown: 3,
  multiAxisStepover: 0.6,
  multiAxisStepdown: 2,
  multiAxisMaxTilt: 60,
  multiAxisMaxTurn: 0,
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
  threadPasses: 'Thread milling: radial passes',
  rotaryStepover: 'Rotary step-over',
  rotaryStepdown: 'Rotary roughing step-down',
  multiAxisStepover: '5-axis step-over',
  multiAxisStepdown: '5-axis roughing step-down',
  multiAxisMaxTilt: '5-axis largest tool tilt',
  multiAxisMaxTurn: '5-axis axis smoothing',
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
  | { kind: 'model'; fact: ModelFact | 'positional' }
  | { kind: 'bodies' }
  | { kind: 'default'; key: CutDefaultKey }
  | { kind: 'op'; partId: string; jobId?: string; opId: string; key: CutDefaultKey | 'blade' }
  | { kind: 'material'; materialId: string; part: 'price' | 'density' }
  | { kind: 'nest'; key: NestValueKey }
  | { kind: 'fixtureType'; typeId: string }
  | { kind: 'fixture'; partId: string; jobId?: string; fixtureId: string }
  | { kind: 'kitchen'; key: KitchenValueKey }

/**
 * Kitchen-2: corner, filler and end-panel values that are placeholders until the shop confirms them.
 * Kitchen-3c: the corner cleat's sizes, and the inside corner radius of L parts (`lCornerRadius`: its
 * placeholder is the cut-out tool's radius, so it is not in `KITCHEN_DEFAULTS`).
 */
export type KitchenValueKey = keyof typeof KITCHEN_DEFAULTS | 'lCornerRadius'
export const KITCHEN_VALUE_LABEL: Record<KitchenValueKey, string> = {
  pullOut: 'Blind corner pull-out from the side wall',
  fillerReturn: 'Filler return depth',
  scribe: 'Scribe allowance',
  proud: 'End panel standing proud of the doors',
  cleatLength: 'Corner cleat under an L shelf: length',
  cleatHeight: 'Corner cleat under an L shelf: height',
  lCornerRadius: 'Inside corner radius of L-shaped parts (as cut)',
}

/** Nesting values (M2.8) that are placeholders until the shop confirms them. */
export type NestValueKey = 'sharedSmall' | 'bridgeWidth' | 'bridgeMaxLength' | 'bridgeMaxArea' | 'flipAxis' | 'flipReference'

export interface Unconfirmed {
  key: string
  label: string
  /** The value in use, as shown to the owner. */
  value: string
  group: 'Tools' | 'Holders' | 'Aggregates' | 'Machine model' | 'Machine parts' | 'Cutting values' | 'Operations' | 'Materials' | 'Nesting' | 'Fixtures' | 'Kitchen defaults'
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
    case 'bodies':
      return 'bodies:machine'
    case 'fixtureType':
      return `fixtureType:${t.typeId}`
    case 'fixture':
      return `fixture:${t.partId}:${t.fixtureId}`
    case 'kitchen':
      return `kitchen:${t.key}`
  }
}

/**
 * Kitchen-2: a cabinet's corner, filler or end-panel values still at the built-in placeholder
 * (`KITCHEN_DEFAULTS`) while the shop has not confirmed it. A value changed to anything else is the
 * owner's own. Shown as Configure badges on the cabinet; never part of the export check.
 */
export function kitchenUnconfirmed(p: CarcassParams, m: Pick<MachineProfile, 'confirmed'>, fmtLen: (mm: number) => string = (mm) => `${fmt(mm)} mm`): Unconfirmed[] {
  const out: Unconfirmed[] = []
  const check = (key: keyof typeof KITCHEN_DEFAULTS, value: number | undefined) => {
    if (value === undefined || Math.abs(value - KITCHEN_DEFAULTS[key]) > 0.001) return
    const target: ConfigTarget = { kind: 'kitchen', key }
    if (!isConfirmed(m, keyOf(target))) out.push({ key: keyOf(target), label: KITCHEN_VALUE_LABEL[key], value: fmtLen(value), group: 'Kitchen defaults', target })
  }
  if (p.corner?.type === 'blind' && !p.panel) check('pullOut', p.corner.pullOut)
  // Kitchen-3c: the corner cleats' sizes, while the pie-cut has cleats and shelves to put them under
  if (p.corner?.type === 'pie-cut' && !p.panel && p.corner.cleats !== false && p.shelves.count > 0) {
    check('cleatLength', p.corner.cleatLength ?? KITCHEN_DEFAULTS.cleatLength)
    check('cleatHeight', p.corner.cleatHeight ?? KITCHEN_DEFAULTS.cleatHeight)
  }
  if (p.panel?.type === 'filler') {
    if (p.panel.returnDepth > 0) check('fillerReturn', p.panel.returnDepth)
    if (p.panel.scribeSide !== 'none') check('scribe', p.panel.scribe)
  }
  if (p.panel?.type === 'end-panel') {
    if (p.panel.scribe > 0) check('scribe', p.panel.scribe)
    if (p.panel.front === 'proud') check('proud', p.panel.proud)
  }
  return out
}

/**
 * Kitchen-3c: a job's inside corner radius of L parts, while it is the default (the cut-out tool's
 * radius, `cutterRadius`) and the shop has not confirmed it; only for a job with L parts (a pie-cut).
 */
export function lCornerUnconfirmed(job: Pick<Job, 'cabinets' | 'lCornerRadius'>, m: Pick<MachineProfile, 'confirmed'>, cutterRadius: number): Unconfirmed[] {
  if (job.lCornerRadius !== undefined || !job.cabinets.some((c) => c.params.corner?.type === 'pie-cut' && !c.params.panel)) return []
  const target: ConfigTarget = { kind: 'kitchen', key: 'lCornerRadius' }
  if (isConfirmed(m, keyOf(target))) return []
  return [{ key: keyOf(target), label: KITCHEN_VALUE_LABEL.lCornerRadius, value: `${fmt(cutterRadius)} mm (the cut-out tool's radius)`, group: 'Kitchen defaults', target }]
}

export const isConfirmed = (m: Pick<MachineProfile, 'confirmed'>, key: string) => !!m.confirmed?.includes(key)

/** Tools whose lengths matter to collision checks: 3D shapes, and every router in a holder (M2.7). */
const hasLengths = (m: MachineProfile, t: Tool) => t.type === 'router' && (t.shape === 'ball' || t.shape === 'bull' || t.shape === 'lollipop' || t.shape === 'barrel' || t.shape === 'form' || !!effectiveHolder(m, t))
const fmt = (n: number) => String(Math.round(n * 1000) / 1000)

/** M3.4: the 3+2 kinematics of a machine model (another machine's, never the N-200's) while invented. */
export const POSITIONAL_FACT_LABEL = '3+2 axes: pivot, table centre and where the part sits'
/** M3.6: the machine's own parts for the machine simulation while invented. */
export const BODIES_FACT_LABEL = 'Machine parts for the machine simulation (gantry, head, spindle, tables)'

/** M3.6: the machine's parts (machine simulation) while invented and not confirmed. */
export function bodiesItem(m: MachineProfile): Unconfirmed | null {
  const target: ConfigTarget = { kind: 'bodies' }
  if (!bodiesInvented(machineModelOf(m)) || isConfirmed(m, keyOf(target))) return null
  return { key: keyOf(target), label: BODIES_FACT_LABEL, value: factValue(m, 'bodies'), group: 'Machine parts', target }
}

function factValue(m: MachineProfile, f: ModelFact | 'positional' | 'bodies'): string {
  const mm = machineModelOf(m)
  switch (f) {
    case 'bodies': {
      const b = bodiesOf(mm)
      return `${b.length} part${b.length === 1 ? '' : 's'}${mm.bodies ? '' : ', invented for this layout'}`
    }
    case 'positional': {
      const k = mm.positional
      return k ? `${k.layout} ${k.first}/${k.second}, pivot ${fmt(k.pivot)} mm, ${k.tcp ? 'tip control' : 'no tip control'}` : 'none'
    }
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
  if (k === 'threadPasses') return `${v as number}`
  if (k === 'multiAxisMaxTilt') return `${fmt(v as number)}° from vertical`
  if (k === 'multiAxisMaxTurn') return (v as number) > 0 ? `${fmt(v as number)}° per mm` : 'off'
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
  // M3.5 (TOOL-07): a barrel's side arc and tip, a form tool's outline, are part of its data
  const shapeData = t.shape === 'barrel' ? `, side R${fmt(t.barrelRadius ?? 0)}, tip R${fmt(t.cornerRadius ?? 0)}` : t.shape === 'form' ? `, outline of ${t.form?.length ?? 0} points` : ''
  add('data', lolly ? 'number, ball Ø and depth' : t.shape === 'barrel' ? 'number, Ø, side and tip radii, depth' : t.shape === 'form' ? 'number, Ø, outline and depth' : 'number, diameter and depth', `${lolly ? 'ball ' : ''}Ø${fmt(t.diameter)}${shapeData}, ${fmt(t.maxDepth)} deep`, m.placeholder || lolly || !!t.placeholder)
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
  // M3.4: invented 3+2 kinematics (a machine model with two rotary axes for 3+2)
  const pm = machineModelOf(m)
  if (pm.capabilities.positional && pm.positional?.placeholder) {
    const target: ConfigTarget = { kind: 'model', fact: 'positional' }
    if (!isConfirmed(m, keyOf(target))) out.push({ key: keyOf(target), label: POSITIONAL_FACT_LABEL, value: factValue(m, 'positional'), group: 'Machine model', target })
  }
  // M3.6: the machine's own parts for the machine simulation while invented (never part of what is
  // written, so not part of the machine-model warning on exports; while they are invented the
  // export checker's machine-part hits are warnings, confirmed they block it, M3.6e)
  const bodies = bodiesItem(m)
  if (bodies) out.push(bodies)
  // M3.6: the shop's clamps, pods and rails while their sizes are invented
  for (const f of fixtureTypesOf(m)) {
    const target: ConfigTarget = { kind: 'fixtureType', typeId: f.id }
    if (f.placeholder && !isConfirmed(m, keyOf(target))) out.push({ key: keyOf(target), label: `Fixture ${f.name}`, value: shapeText(f.shape), group: 'Fixtures', target })
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
  if (key.startsWith('fixtureType:')) {
    m.fixtureTypes = structuredClone(m.fixtureTypes ?? PLACEHOLDER_FIXTURE_TYPES)
    const f = m.fixtureTypes.find((x) => `fixtureType:${x.id}` === key)
    if (f) f.placeholder = false
  }
  if (key === 'bodies:machine') {
    // the parts shown are right: keep them as the machine's own
    m.physical = structuredClone(m.physical ?? PLACEHOLDER_N200_MODEL)
    m.physical.bodies = bodiesOf(m.physical).map((b) => ({ ...b, placeholder: undefined }))
  }
  if (key === 'model:positional' && m.physical?.positional) {
    m.physical = structuredClone(m.physical)
    m.physical.positional!.placeholder = false
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
  { key: 'threadPasses', applies: (o) => o.kind === 'thread', get: (o) => (o as { passes: number }).passes, set: (o, v) => ({ ...o, passes: v }) as CamOp },
  { key: 'rotaryStepover', applies: (o) => o.kind === 'rotary' && o.strategy !== 'wrap', get: (o) => (o as { stepover: number }).stepover, set: (o, v) => ({ ...o, stepover: v }) as CamOp },
  { key: 'rotaryStepdown', applies: (o) => o.kind === 'rotary' && o.strategy !== 'wrap' && o.stepdown > 0, get: (o) => (o as { stepdown: number }).stepdown, set: (o, v) => ({ ...o, stepdown: v }) as CamOp },
  { key: 'multiAxisStepover', applies: (o) => o.kind === 'multiaxis' && (o.strategy === 'surface' || o.strategy === 'rough'), get: (o) => (o as { stepover: number }).stepover, set: (o, v) => ({ ...o, stepover: v }) as CamOp },
  { key: 'multiAxisStepdown', applies: (o) => o.kind === 'multiaxis' && o.strategy === 'rough', get: (o) => (o as { stepdown: number }).stepdown, set: (o, v) => ({ ...o, stepdown: v }) as CamOp },
  { key: 'multiAxisMaxTilt', applies: (o) => o.kind === 'multiaxis' && o.axis.mode !== 'vertical', get: (o) => (o as { axis: { maxTilt: number } }).axis.maxTilt, set: (o, v) => ({ ...o, axis: { ...(o as { axis: object }).axis, maxTilt: v } }) as CamOp },
  { key: 'multiAxisMaxTurn', applies: (o) => o.kind === 'multiaxis' && o.strategy !== 'swarf', get: (o) => (o as { maxTurn: number }).maxTurn, set: (o, v) => ({ ...o, maxTurn: v }) as CamOp },
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
      // Polish-1: a new pocket leaves unpicked closed shapes inside it standing (islands)
      return { stepover: d.pocketStepover, enclosedIslands: true } as Partial<CamOp>
    case 'face':
      return { stepover: d.faceStepover } as Partial<CamOp>
    case 'edge':
      return { height: d.edgeHeight, reach: d.edgeReach } as Partial<CamOp>
    case 'curve':
      return mode === 'between' ? ({ stepover: d.betweenStepover } as Partial<CamOp>) : mode === 'zwave' || !mode ? ({ wave: { ...d.zwave, shape: 'sine' } } as Partial<CamOp>) : {}
    case 'finish3d':
      return strategy === 'waterline' || strategy === 'helical' ? ({ stepover: d.finishStepover, stepdown: d.waterlineStepdown } as Partial<CamOp>) : strategy === 'projection' || strategy === 'pencil' ? {} : ({ stepover: d.finishStepover } as Partial<CamOp>)
    case 'thread':
      return { passes: d.threadPasses } as Partial<CamOp>
    case 'rotary':
      // roughing (asked for with a step-down) takes the shop's step-down too
      return strategy === 'wrap' ? {} : ({ stepover: d.rotaryStepover, ...((extra as { stepdown?: number }).stepdown ? { stepdown: d.rotaryStepdown } : {}) } as Partial<CamOp>)
    case 'multiaxis':
      return { stepover: d.multiAxisStepover, stepdown: d.multiAxisStepdown, maxTurn: d.multiAxisMaxTurn, axis: defaultToolAxis((strategy ?? 'surface') as 'curve' | 'swarf' | 'surface' | 'rough', d.multiAxisMaxTilt) } as Partial<CamOp>
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
  for (const p of parts) fixtureUnconfirmed(p).forEach(put)
  for (const u of machineUnconfirmed(m)) if (u.group === 'Machine model') put(u)
  return [...out.values()]
}

// ---------------------------------------------------------------------------------------------
// Fixtures (M3.6)
// ---------------------------------------------------------------------------------------------

/** A fixture's shape in words (sizes in mm). */
export function shapeText(s: FixtureShape): string {
  switch (s.k) {
    case 'block':
      return `block ${fmt(s.length)} x ${fmt(s.width)} x ${fmt(s.height)} mm`
    case 'round':
      return `round Ø${fmt(s.diameter)} x ${fmt(s.height)} mm`
    case 'outline':
      return `drawn outline, ${fmt(s.height)} mm high`
    case 'model':
      return `model ${s.file}, ${fmt(s.size[0])} x ${fmt(s.size[1])} x ${fmt(s.size[2])} mm`
  }
}

/** A part's fixtures whose sizes are still an invented example (not switched off). */
export function fixtureUnconfirmed(part: Pick<CamPart, 'id' | 'fixtures'>, jobId?: string): Unconfirmed[] {
  return (part.fixtures ?? [])
    .filter((f: Fixture) => f.placeholder && !f.off)
    .map((f) => {
      const target: ConfigTarget = { kind: 'fixture', partId: part.id, jobId, fixtureId: f.id }
      return { key: keyOf(target), label: `${f.name}: size`, value: shapeText(f.shape), group: 'Fixtures' as const, target }
    })
}
