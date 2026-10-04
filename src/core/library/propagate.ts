import { nanoid } from 'nanoid'
import { HINGE_ID, PLATE_ID, SLIDE_IDS } from '../hardware/resolve'
import type { AppData, CabinetInstance, EdgeBand, Hardware, HardwarePin, Job, Material } from '../types'

export type ItemKind = 'material' | 'edgeband' | 'hardware'

const SLIDE_ID_SET = new Set(Object.values(SLIDE_IDS))

export function drivingKeys(item: Hardware | Material | EdgeBand, kind: ItemKind): string[] {
  if (kind === 'material') return ['thickness', 'sheetLength', 'sheetWidth', 'grain']
  if (kind === 'edgeband') return ['thickness', 'width']
  const hw = item as Hardware
  if (hw.category === 'mounting-plate') return ['plateSetback', 'plateSpacing', 'holeDiameter', 'holeDepth']
  if (hw.category === 'hinge') return ['cupDiameter', 'cupDepth', 'cupCentre']
  if (hw.category === 'slide') return ['slideLength', 'slideHoles', 'minCabinetDepth']
  return []
}

export function geometryChanged(before: object, after: object, keys: string[]) {
  const a = before as Record<string, unknown>
  const b = after as Record<string, unknown>
  return keys.some((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null))
}

export interface JobUse {
  jobId: string
  jobNumber: string
  jobName: string
  cabinets: { id: string; number: string; name: string }[]
}

function usesMaterial(c: CabinetInstance, id: string) {
  const p = c.params
  if (p.carcassMaterialId === id || p.backMaterialId === id || p.doorMaterialId === id) return true
  return Object.values(c.overrides).some((o) => o.materialId === id)
}

function usesBand(c: CabinetInstance, id: string) {
  if (Object.values(c.params.edgebands).includes(id)) return true
  return Object.values(c.overrides).some((o) => o.edges && Object.values(o.edges).includes(id))
}

function usesHardware(c: CabinetInstance, hw: Hardware) {
  if (hw.id === HINGE_ID || hw.id === PLATE_ID) return c.params.doors.count > 0
  if (SLIDE_ID_SET.has(hw.id)) return (c.params.drawers?.count ?? 0) > 0
  return false
}

export function listConsumers(jobs: Job[], kind: ItemKind, item: Hardware | Material | EdgeBand): JobUse[] {
  const out: JobUse[] = []
  for (const j of jobs) {
    const cabinets = j.cabinets.filter((c) => (kind === 'material' ? usesMaterial(c, item.id) : kind === 'edgeband' ? usesBand(c, item.id) : usesHardware(c, item as Hardware)))
    if (cabinets.length === 0) continue
    out.push({
      jobId: j.id,
      jobNumber: j.number,
      jobName: j.name,
      cabinets: cabinets.map((c) => ({ id: c.id, number: c.number, name: c.name })),
    })
  }
  return out
}

export function jobsUsingTemplate(jobs: Job[], templateId: string): JobUse[] {
  return listBy(jobs, (c) => c.templateId === templateId)
}

function listBy(jobs: Job[], pred: (c: CabinetInstance) => boolean): JobUse[] {
  const out: JobUse[] = []
  for (const j of jobs) {
    const cabinets = j.cabinets.filter(pred)
    if (cabinets.length === 0) continue
    out.push({ jobId: j.id, jobNumber: j.number, jobName: j.name, cabinets: cabinets.map((c) => ({ id: c.id, number: c.number, name: c.name })) })
  }
  return out
}

function retargetMaterial(c: CabinetInstance, from: string, to: string) {
  const p = c.params
  if (p.carcassMaterialId === from) p.carcassMaterialId = to
  if (p.backMaterialId === from) p.backMaterialId = to
  if (p.doorMaterialId === from) p.doorMaterialId = to
  for (const o of Object.values(c.overrides)) if (o.materialId === from) o.materialId = to
}

function retargetBand(c: CabinetInstance, from: string, to: string) {
  const bands = c.params.edgebands
  for (const k of Object.keys(bands) as (keyof typeof bands)[]) if (bands[k] === from) bands[k] = to
  for (const o of Object.values(c.overrides)) {
    if (!o.edges) continue
    for (const k of Object.keys(o.edges)) if (o.edges[k as keyof typeof o.edges] === from) o.edges[k as keyof typeof o.edges] = to
  }
}

function pinFrom(hw: Hardware): HardwarePin {
  const pin: HardwarePin = {}
  if (hw.plateSetback != null) pin.plateSetback = hw.plateSetback
  if (hw.plateSpacing != null) pin.plateSpacing = hw.plateSpacing
  if (hw.holeDiameter != null) pin.holeDiameter = hw.holeDiameter
  if (hw.holeDepth != null) pin.holeDepth = hw.holeDepth
  if (hw.slideLength != null) pin.slideLength = hw.slideLength
  if (hw.slideHoles) pin.slideHoles = [...hw.slideHoles]
  if (hw.minCabinetDepth != null) pin.minCabinetDepth = hw.minCabinetDepth
  return pin
}

function writeRow(data: AppData, kind: ItemKind, item: Hardware | Material | EdgeBand) {
  if (kind === 'material') {
    const i = data.library.materials.findIndex((m) => m.id === item.id)
    if (i >= 0) data.library.materials[i] = item as Material
  } else if (kind === 'edgeband') {
    const i = data.library.edgebands.findIndex((m) => m.id === item.id)
    if (i >= 0) data.library.edgebands[i] = item as EdgeBand
  } else {
    const i = data.library.hardware.findIndex((m) => m.id === item.id)
    if (i >= 0) data.library.hardware[i] = item as Hardware
  }
}

function cupsMatch(doors: CabinetInstance['params']['doors'], hw: Hardware) {
  return doors.cupDiameter === hw.cupDiameter && doors.cupDepth === hw.cupDepth && doors.cupEdgeDistance === hw.cupCentre
}

function writeCups(doors: CabinetInstance['params']['doors'], hw: Hardware) {
  if (hw.cupDiameter != null) doors.cupDiameter = hw.cupDiameter
  if (hw.cupDepth != null) doors.cupDepth = hw.cupDepth
  if (hw.cupCentre != null) doors.cupEdgeDistance = hw.cupCentre
}

/** Templates that still have the old catalog cups follow the library, so the next cabinet is new. */
function syncHingeTemplates(data: AppData, before: Hardware, after: Hardware) {
  if (before.id !== HINGE_ID) return
  for (const t of data.library.templates) {
    if (t.params.doors.count === 0) continue
    if (cupsMatch(t.params.doors, before)) writeCups(t.params.doors, after)
  }
}

export function replaceLibraryItem(data: AppData, kind: ItemKind, item: Hardware | Material | EdgeBand) {
  writeRow(data, kind, item)
}

/**
 * Existing job cabinets keep the old geometry. The library id keeps the new values, so anything
 * added afterwards follows the edit. Materials and edgebands are cloned (they are live by id).
 * Plate and slide numbers are pinned on the cabinet. Hinge cups stay on the cabinet's doors.
 */
export function applyKeep(data: AppData, kind: ItemKind, before: Hardware | Material | EdgeBand, after: Hardware | Material | EdgeBand) {
  if (kind === 'material' || kind === 'edgeband') {
    const keptId = `${before.id}-kept-${nanoid(6)}`
    if (kind === 'material') {
      const old = before as Material
      data.library.materials.push({ ...old, id: keptId, name: `${old.name} (kept)`, code: `${old.code}-K` })
      writeRow(data, kind, after)
      for (const j of data.jobs) for (const c of j.cabinets) if (usesMaterial(c, old.id)) retargetMaterial(c, old.id, keptId)
    } else {
      const old = before as EdgeBand
      data.library.edgebands.push({ ...old, id: keptId, name: `${old.name} (kept)`, code: `${old.code}-K` })
      writeRow(data, kind, after)
      for (const j of data.jobs) for (const c of j.cabinets) if (usesBand(c, old.id)) retargetBand(c, old.id, keptId)
    }
    return
  }
  const old = before as Hardware
  writeRow(data, 'hardware', after)
  if (old.id === HINGE_ID) {
    syncHingeTemplates(data, old, after as Hardware)
    return
  }
  const pin = pinFrom(old)
  for (const j of data.jobs) {
    for (const c of j.cabinets) {
      if (!usesHardware(c, old)) continue
      c.pin ??= {}
      c.pin.hardware ??= {}
      c.pin.hardware[old.id] = pin
    }
  }
}

/** Jobs follow the library. Hinge cups are written onto consuming cabinets and catalog templates. */
export function applyUpdate(data: AppData, kind: ItemKind, before: Hardware | Material | EdgeBand, after: Hardware | Material | EdgeBand) {
  writeRow(data, kind, after)
  if (kind !== 'hardware') return
  const old = before as Hardware
  const next = after as Hardware
  if (old.id === HINGE_ID) {
    for (const j of data.jobs) for (const c of j.cabinets) if (c.params.doors.count > 0) writeCups(c.params.doors, next)
    syncHingeTemplates(data, old, next)
    return
  }
  for (const j of data.jobs) {
    for (const c of j.cabinets) {
      if (c.pin?.hardware?.[old.id]) delete c.pin.hardware[old.id]
    }
  }
}

export function applyTemplateToJobs(data: AppData, templateId: string) {
  const t = data.library.templates.find((x) => x.id === templateId)
  if (!t) return
  for (const j of data.jobs) {
    for (const c of j.cabinets) {
      if (c.templateId !== templateId) continue
      c.params = JSON.parse(JSON.stringify(t.params)) as CabinetInstance['params']
    }
  }
}
