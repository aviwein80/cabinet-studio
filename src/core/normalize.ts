import { defaultAppData, fillHardwareSpecs } from './defaults'
import { DEFAULT_FEATURES } from './features'
import { DEFAULT_ROOM } from './room'
import type { AppData, CarcassParams } from './types'

/** Fill in fields added in later versions so old data files keep loading. */
const DRAWER_DEFAULT: CarcassParams['drawers'] = { count: 0, frontHeight: 152.4, slide: 'auto' }

function withParams(p: CarcassParams): CarcassParams {
  return { ...p, drawers: { ...DRAWER_DEFAULT, ...(p.drawers ?? {}) } }
}

export function normalizeData(raw: Partial<AppData> | null): AppData {
  const d = defaultAppData()
  if (!raw) return d
  const library = { ...d.library, ...(raw.library ?? {}) }
  library.hardware = fillHardwareSpecs(library.hardware ?? [])
  library.templates = (library.templates ?? []).map((t) => ({ ...t, params: withParams(t.params) }))
  const jobs = (raw.jobs ?? []).map((j) => ({
    ...j,
    room: { ...DEFAULT_ROOM, ...(j.room ?? {}) },
    cabinets: j.cabinets.map((c) => ({ ...c, params: withParams(c.params) })),
  }))
  return {
    version: 1,
    library,
    machine: { ...d.machine, ...(raw.machine ?? {}), contour: { ...d.machine.contour, ...(raw.machine?.contour ?? {}) }, header: { ...d.machine.header, ...(raw.machine?.header ?? {}) } },
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

