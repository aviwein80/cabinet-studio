/**
 * The machine model: what the machine has and can do. Until the shop confirms the real figures
 * every value for the N-200 is a PLACEHOLDER, and the export checker says so on every export.
 */
import type { MachineModel, MachineProfile, Tool, ToolHolder } from './types'

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
