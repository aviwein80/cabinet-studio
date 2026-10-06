/**
 * The machine model: what the machine has and can do. Until the shop confirms the real figures
 * every value for the N-200 is a PLACEHOLDER, and the export checker says so on every export.
 */
import type { Aggregate, MachineModel, MachineProfile, Tool, ToolHolder } from './types'

/**
 * PLACEHOLDER model of the HOMAG CENTATEQ N-200. Table = one 5 x 12 ft sheet; travel, tool change
 * and spoilboard thickness are invented. No saw unit and no aggregate until the owner confirms
 * them; the horizontal drill unit follows `hasHorizontalDrillUnit`.
 */
const TABLE = { length: 3658, width: 1524 }

export const PLACEHOLDER_N200_MODEL: MachineModel = {
  placeholder: true,
  axes: [
    { id: 'X', min: 0, max: TABLE.length },
    { id: 'Y', min: 0, max: TABLE.width },
    { id: 'Z', min: -5, max: 200 },
  ],
  table: { length: TABLE.length, width: TABLE.width },
  spoilboard: { thickness: 19 },
  toolChange: { x: 0, y: 0, z: 150 },
  safeZ: 50,
  heads: [
    { id: 'spindle', kind: 'spindle', name: 'Main spindle' },
    { id: 'drill', kind: 'drill-block', name: 'Vertical drill block' },
  ],
  capabilities: { mill3d: true, saw: false, aggregate: false, rotary: false, positional: false, simultaneous5: false },
}

export function machineModelOf(machine: Pick<MachineProfile, 'physical'>): MachineModel {
  return machine.physical ?? PLACEHOLDER_N200_MODEL
}

export const holderOf = (machine: Pick<MachineProfile, 'holders'>, tool: Pick<Tool, 'holderId'> | null | undefined): ToolHolder | null =>
  (tool?.holderId && machine.holders?.find((h) => h.id === tool.holderId)) || null

/**
 * Tools that sit in a holder in the main spindle (drills sit in the drill block, saws on the saw
 * unit, aggregate tools in their aggregate).
 */
export const usesHolder = (tool: Pick<Tool, 'type' | 'aggregateId'>) => tool.type === 'router' && !tool.aggregateId

/**
 * The holder a tool really uses (M2.7): its own, else the shop's default holder for router tools.
 * Drills and saws have none here.
 */
export function effectiveHolder(machine: Pick<MachineProfile, 'holders' | 'defaultHolderId'>, tool: Tool | null | undefined): ToolHolder | null {
  if (!tool || !usesHolder(tool)) return null
  return holderOf(machine, tool) ?? (machine.defaultHolderId ? (machine.holders?.find((h) => h.id === machine.defaultHolderId) ?? null) : null)
}

/**
 * The stick-out used for a tool: its own, else (a router in a holder with none given) the shortest
 * possible, the flute length: the holder face right at the top of the flutes. That is the worst
 * case, so a check made with it can only report more, never less. Shown with a Configure badge.
 */
export function effectiveGauge(machine: Pick<MachineProfile, 'holders' | 'defaultHolderId'>, tool: Tool): { gauge: number; assumed: boolean } {
  if (tool.gaugeLength) return { gauge: tool.gaugeLength, assumed: false }
  if (effectiveHolder(machine, tool) || (tool.type === 'router' && tool.aggregateId)) return { gauge: tool.fluteLength ?? tool.maxDepth, assumed: true }
  return { gauge: Infinity, assumed: false }
}

/**
 * Tool + holder outline as the simulator draws it and the collision checks use it: the tool's own
 * holder or the shop default, with the stick-out from `effectiveGauge`.
 */
export function toolOutline(machine: Pick<MachineProfile, 'holders' | 'defaultHolderId'>, tool: Tool): CutterOutline {
  const holder = effectiveHolder(machine, tool)
  const { gauge } = effectiveGauge(machine, tool)
  return cutterOutline(Number.isFinite(gauge) ? { ...tool, gaugeLength: gauge } : tool, holder)
}

export const aggregateOf = (machine: Pick<MachineProfile, 'aggregates'>, tool: Pick<Tool, 'aggregateId'> | null | undefined): Aggregate | null =>
  (tool?.aggregateId && machine.aggregates?.find((a) => a.id === tool.aggregateId)) || null

/** Problems with a holder outline (empty = fine). */
export function holderProblems(h: Pick<ToolHolder, 'profile'>): string[] {
  const out: string[] = []
  const p = h.profile
  if (p.length < 2) out.push('The outline needs at least two points.')
  if (p.some((q) => !Number.isFinite(q.z) || !Number.isFinite(q.r))) out.push('Every point needs a height and a radius.')
  if (p.some((q) => q.r < 0)) out.push('A radius is below zero.')
  if (p.some((q, i) => i > 0 && q.z < p[i - 1].z - 1e-9)) out.push('Heights must not go down (list the points from the holder face up).')
  if (p.length && Math.abs(p[0].z) > 1e-9) out.push('The first point should be at height 0 (the holder face).')
  return out
}

/** Head angles (degrees, 0..360) an aggregate cannot be set to among `needed`; empty when it can make them all. */
export function anglesOutOfReach(a: Aggregate, needed: number[], tol = 0.5): number[] {
  if (a.angles.mode === 'any') return []
  const list = a.angles.list
  const norm = (d: number) => ((d % 360) + 360) % 360
  return needed.filter((d) => !list.some((x) => {
    const diff = Math.abs(norm(d) - norm(x))
    return Math.min(diff, 360 - diff) <= tol
  }))
}

/** Revolved outline of tool + holder from the tip up: radius at height above the tip. */
export interface CutterOutline {
  /** Cutting part: radius `r` up to `flute`. */
  r: number
  flute: number
  /** Non-cutting shank radius from `flute` to `gauge`. */
  shankR: number
  /** Tip to holder face; Infinity when unknown. */
  gauge: number
  /** Holder outline above the gauge line, heights measured from the tip. */
  holder: { z: number; r: number }[]
}

export function cutterOutline(tool: Tool, holder: ToolHolder | null): CutterOutline {
  const r = tool.diameter / 2
  const flute = tool.fluteLength ?? tool.maxDepth
  const gauge = tool.gaugeLength ?? Infinity
  return {
    r,
    flute,
    shankR: (tool.shankDiameter ?? tool.diameter) / 2,
    gauge,
    holder: holder && Number.isFinite(gauge) ? holder.profile.map((p) => ({ z: p.z + gauge, r: p.r })) : [],
  }
}
