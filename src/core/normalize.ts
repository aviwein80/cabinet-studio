import { migratePart } from '@/cam/doc'
import { defaultAppData, fillHardwareSpecs, PLACEHOLDER_DRILL_6, PLACEHOLDER_MACHINE } from './defaults'
import { DEFAULT_FEATURES } from './features'
import { DEFAULT_ROOM } from './room'
import type { AppData, CarcassParams, MachineProfile } from './types'

/** Fill in fields added in later versions so old data files keep loading. */
const DRAWER_DEFAULT: CarcassParams['drawers'] = { count: 0, frontHeight: 152.4, slide: 'auto' }

function withParams(p: CarcassParams): CarcassParams {
  return { ...p, drawers: { ...DRAWER_DEFAULT, ...(p.drawers ?? {}) } }
}

/**
 * A placeholder tool table saved before M2.7 gets the invented stick-outs of the 2D routers, but
 * only on tools still exactly as invented (same number, diameter and depth); real values are
 * never touched.
 */
function refreshPlaceholderTools(m: MachineProfile): MachineProfile {
  if (!m.placeholder) return m
  // Polish-1: a placeholder table saved before the 6 mm drill gets it, unless it has a 6 mm
  // vertical drill or a tool numbered 205 already
  const add6 = !m.tools.some((t) => t.number === PLACEHOLDER_DRILL_6.number || (t.type === 'drill-vertical' && Math.abs(t.diameter - 6) < 0.01))
  const tools = add6 ? [...m.tools, { ...PLACEHOLDER_DRILL_6 }] : m.tools
  return {
    ...m,
    tools: tools.map((t) => {
      const p = PLACEHOLDER_MACHINE.tools.find((x) => x.id === t.id)
      if (!p || t.gaugeLength !== undefined || p.gaugeLength === undefined || p.number !== t.number || p.diameter !== t.diameter || p.maxDepth !== t.maxDepth) return t
      return { ...t, gaugeLength: p.gaugeLength }
    }),
  }
}

export function normalizeData(raw: Partial<AppData> | null): AppData {
  const d = defaultAppData()
  if (!raw) return d
  const library = { ...d.library, ...(raw.library ?? {}) }
  library.hardware = fillHardwareSpecs(library.hardware ?? [])
  library.templates = (library.templates ?? []).map((t) => ({ ...t, params: withParams(t.params) }))
  if (library.partLibrary) library.partLibrary = library.partLibrary.map(migratePart)
  const jobs = (raw.jobs ?? []).map((j) => ({
    ...j,
    room: { ...DEFAULT_ROOM, ...(j.room ?? {}) },
    cabinets: j.cabinets.map((c) => ({ ...c, params: withParams(c.params) })),
    ...(j.camParts ? { camParts: j.camParts.map(migratePart) } : {}),
  }))
  const profile = (m: Partial<MachineProfile> | undefined): MachineProfile => ({ ...refreshPlaceholderTools({ ...d.machine, ...(m ?? {}) }), contour: { ...d.machine.contour, ...(m?.contour ?? {}) }, header: { ...d.machine.header, ...(m?.header ?? {}) } })
  return {
    version: 1,
    library,
    machine: profile(raw.machine),
    // M2.9: other machines and process steps, each profile filled in like the main one
    ...(raw.machines ? { machines: raw.machines.map((m) => ({ ...m, post: m.post ?? { kind: 'woodwop-mpr' as const }, profile: profile(m.profile) })) } : {}),
    // M2.10: installed plugins, as stored (their grants belong to their exact code)
    ...(raw.plugins ? { plugins: raw.plugins } : {}),
    settings: {
      ...d.settings,
      ...(raw.settings ?? {}),
      nesting: { ...d.settings.nesting, ...(raw.settings?.nesting ?? {}) },
      labels: { ...d.settings.labels, ...(raw.settings?.labels ?? {}) },
      features: { ...DEFAULT_FEATURES, ...(raw.settings?.features ?? {}) },
    },
    jobs,
  }
}

