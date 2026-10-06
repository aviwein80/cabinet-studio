import { partFileName, writePartPrograms } from '@/cam/mpr'
import type { CancelCheck } from './cancel'
import { generatePart, type Toolpath } from '@/cam/toolpath'
import { cutList, edgeCode, edgeDiagram, edgebandUsage, expandJob, type PartInstance } from './cutlist'
import { placeLabels, type LabelSpot } from './labels/placement'
import { bridgesOn, buildAllPrograms, nestJob, nestSettingsOf, sharedLinesOn, type JobNest, type SheetProgram } from './machining'
import { featuresOf } from './features'
import { writeSheetMpr } from './mpr/writer'
import type { AppData, EdgeKey, Job } from './types'
import { validateJob, type Issue } from './validator'

export interface LabelRecord {
  partId: string
  no: number
  uid: string
  jobNumber: string
  jobName: string
  customer: string
  cabinet: string
  partName: string
  finished: { l: number; w: number; t: number }
  cut: { l: number; w: number }
  materialCode: string
  materialName: string
  edges: Record<EdgeKey, string>
  edgeDiagram: string
  grainLocked: boolean
  sheetIndex: number
  sheetCount: number
  /** Position of the part in the sheet's cut order (1 = cut first). */
  cutOrder: number
  /** Copy counter for parts made more than once from one design ("2 of 5"). */
  copy?: { n: number; of: number }
  program: string
  rotated: boolean
  spot: LabelSpot
  notes: string[]
}

export interface JobOutput {
  instances: PartInstance[]
  nest: JobNest
  programs: SheetProgram[]
  issues: Issue[]
  labels: LabelRecord[]
  spots: Map<number, LabelSpot[]>
  cutList: ReturnType<typeof cutList>
  hardware: { code: string; name: string; qty: number }[]
  edgebands: ReturnType<typeof edgebandUsage>
  warnings: string[]
}

/**
 * `paths3d`: 3D toolpaths calculated beforehand in the compute worker (by `pathKey`). Without
 * them, 3D operations write nothing and the export checker says so.
 */
export function runJob(job: Job, data: AppData, opts: { isCancelled?: CancelCheck; paths3d?: ReadonlyMap<string, Toolpath> } = {}): JobOutput {
  const { library: lib, machine, settings } = data
  const expanded = expandJob(job, lib, settings)
  const nest = nestJob(expanded.instances, lib, machine, settings, opts.isCancelled)
  const ns = nestSettingsOf(settings)
  const programs = buildAllPrograms(job, nest, expanded.instances, lib, machine, {
    camOutput: featuresOf(settings).camMprOutput,
    cam3dOutput: featuresOf(settings).cam3dMprOutput,
    cam25dOutput: featuresOf(settings).cam25dMprOutput,
    ...(opts.paths3d ? { paths3d: opts.paths3d } : {}),
    ...(ns.onionSkin > 0 ? { onionSkin: { thickness: ns.onionSkin, maxArea: ns.onionSkinMaxArea } } : {}),
    ...(bridgesOn(settings) ? { bridges: { width: ns.bridgeWidth, maxLength: ns.bridgeMaxLength, maxArea: ns.bridgeMaxArea, write: featuresOf(settings).nestBridgeOutput } } : {}),
    ...(sharedLinesOn(settings) ? { sharedLines: { minArea: ns.sharedMinArea, minSide: ns.sharedMinSide, write: featuresOf(settings).nestSharedOutput } } : {}),
  })
  const issues = validateJob(programs, nest, expanded.instances, lib, machine, settings)
  for (const w of expanded.warnings) issues.unshift({ severity: 'warning', code: 'CONSTRUCTION', message: w })

  const byUid = new Map(expanded.instances.map((i) => [i.uid, i]))
  const copies = new Map<string, string[]>()
  for (const i of expanded.instances) copies.set(i.part.key, [...(copies.get(i.part.key) ?? []), i.uid])
  const labels: LabelRecord[] = []
  const spots = new Map<number, LabelSpot[]>()
  for (const prog of programs) {
    const sh = prog.sheet
    const sheetSpots = placeLabels(sh, prog, byUid, settings.labels.size, settings.labels.edgeClearance)
    spots.set(sh.index, sheetSpots)
    sh.placements.forEach((pl, idx) => {
      const inst = byUid.get(pl.uid)!
      const mat = lib.materials.find((m) => m.id === inst.materialId)
      const skipped = prog.skipped.filter((s) => s.partUid === pl.uid)
      const notes: string[] = []
      if (skipped.length) {
        const byDia = new Map<number, number>()
        for (const s of skipped) byDia.set(s.diameter, (byDia.get(s.diameter) ?? 0) + 1)
        notes.push(`Edge drill: ${[...byDia.entries()].map(([d, n]) => `${n}x D${d}`).join(', ')}`)
      }
      const spot = sheetSpots.find((s) => s.uid === pl.uid)!
      if (!spot.fits) notes.push('Label does not fit: apply to back face')
      labels.push({
        partId: inst.partId,
        no: inst.no,
        uid: inst.uid,
        jobNumber: job.number,
        jobName: job.name,
        customer: job.customer,
        cabinet: `${inst.cabinetNumber} ${inst.cabinetName}`,
        partName: inst.part.name,
        finished: { l: inst.part.length, w: inst.part.width, t: inst.thickness },
        cut: { l: inst.cutLength, w: inst.cutWidth },
        materialCode: mat?.code ?? inst.materialId,
        materialName: mat?.name ?? inst.materialId,
        edges: edgeCode(inst.part, lib),
        edgeDiagram: edgeDiagram(inst.part),
        grainLocked: !inst.canRotate,
        sheetIndex: sh.index,
        sheetCount: programs.length,
        cutOrder: idx + 1,
        ...((copies.get(inst.part.key)?.length ?? 0) > 1 ? { copy: { n: copies.get(inst.part.key)!.indexOf(inst.uid) + 1, of: copies.get(inst.part.key)!.length } } : {}),
        program: prog.name,
        rotated: pl.rotated,
        spot,
        notes,
      })
    })
  }

  return {
    instances: expanded.instances,
    nest,
    programs,
    issues,
    labels,
    spots,
    cutList: cutList(expanded.instances, lib),
    hardware: expanded.hardware,
    edgebands: edgebandUsage(expanded.instances, lib),
    warnings: expanded.warnings,
  }
}

export function mprFiles(job: Job, data: AppData, out: JobOutput) {
  const files = out.programs.map((p, i) => ({
    name: `${p.name}.mpr`,
    text: writeSheetMpr(p, { job, machine: data.machine, mprNumber: i + 1, mprCount: out.programs.length }),
  }))
  // Underside drilling on custom parts: one turned-over program per part design.
  const done = new Set<string>()
  for (const p of out.programs)
    for (const c of p.custom ?? []) {
      const inst = out.instances.find((i) => i.uid === c.partUid)
      if (!c.written || !c.backHoles || !inst?.cam || done.has(inst.cam.id)) continue
      done.add(inst.cam.id)
      const mat = data.library.materials.find((m) => m.id === inst.materialId)
      const name = `${job.number.replace(/[^A-Za-z0-9_-]+/g, '-')}_${partFileName(inst.cam)}`
      const back = writePartPrograms(inst.cam, generatePart(inst.cam, data.machine), data.machine, mat?.code ?? inst.materialId, { name }).find((f) => f.side === 'back')
      if (back) files.push({ name: back.name, text: back.text })
    }
  return files
}
