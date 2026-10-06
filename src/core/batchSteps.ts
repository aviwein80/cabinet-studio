/**
 * Batch steps (M2.9, AM-10): extra work a batch setup runs on each order, at two points of the
 * one batch engine: after nesting (before the export check decides) and before the files are
 * written. Steps see a frozen copy of the job, its nest and programs, so they can report, hold an
 * order back (an error) and add report files, but never change what is cut. Built-in steps are
 * below; plugins (M2.10) bring theirs for each run (`pluginBatchSteps`, passed as `extra`), and
 * code can add steps with `registerBatchStep`.
 */
import { jobCosts } from './areas'
import type { OutFile } from './output'
import type { JobOutput } from './pipeline'
import type { AppData, Job } from './types'

export interface BatchStepMessage {
  severity: 'error' | 'warning' | 'info'
  text: string
}

export interface BatchStepContext {
  order: { number: string; name: string; customer: string }
  machine: { id: string; name: string }
  job: Readonly<Job>
  output: Readonly<JobOutput>
  data: Readonly<AppData>
}

export interface BatchStepResult {
  messages?: BatchStepMessage[]
  /** Extra files for the order (reports, lists). Machine programs are refused. */
  files?: OutFile[]
}

export interface BatchStep {
  id: string
  name: string
  description: string
  /** Who provides it: built in, or the plugin's name. */
  source: string
  afterNest?(ctx: BatchStepContext): BatchStepResult | void
  beforeOutput?(ctx: BatchStepContext & { files: readonly OutFile[] }): BatchStepResult | void
}

/** File types a step may not add: machine programs only come from the program writers. */
const PROGRAM_FILE = /\.(mpr|mprx|nc|cnc|tap|gcode|ngc|iso|xcs|bpp|pgmx)$/i

/**
 * A plain new file name for the order folder: no folders, no characters Windows treats specially
 * (a name ending in a dot or space, or with ":", is saved under another name), and not a program.
 */
export function stepFileRefused(name: string): boolean {
  return !name || PROGRAM_FILE.test(name) || /[\\/:*?"<>|]/.test(name) || [...name].some((c) => c.charCodeAt(0) < 32) || /[. ]$/.test(name) || /^\.+$/.test(name) || PROGRAM_FILE.test(name.replace(/[. ]+$/, ''))
}

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !ArrayBuffer.isView(v) && !Object.isFrozen(v)) {
    Object.freeze(v)
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k])
  }
  return v
}

const csvCell = (s: string | number) => (typeof s === 'number' ? String(s) : /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
const m2 = (mm2: number) => Math.round(mm2 / 1e3) / 1e3

/** Waste areas: each sheet's parts, remnants kept and scrap, with the remnant pieces, as a CSV. */
export const WASTE_AREAS_STEP: BatchStep = {
  id: 'waste-areas',
  name: 'Waste areas',
  description: 'Lists each sheet\'s scrap and the remnant pieces kept (sizes and areas) in a waste-areas CSV, and warns when a sheet is mostly waste.',
  source: 'built in',
  beforeOutput(ctx) {
    const { output, data, order } = ctx
    const costs = jobCosts(output.nest, output.instances, data.library)
    const lines = ['Sheet,Material,Sheet m2,Parts m2,Remnants m2,Scrap m2,Scrap %,Remnant pieces']
    const messages: BatchStepMessage[] = []
    for (const s of costs.sheets) {
      const sh = output.nest.sheets.find((x) => x.index === s.index)
      const mat = data.library.materials.find((m) => m.id === s.materialId)
      const pct = s.sheetArea > 0 ? Math.round((s.scrapArea / s.sheetArea) * 1000) / 10 : 0
      const pieces = (sh?.remnants ?? []).map((r) => `${Math.round(r.length * 10) / 10} x ${Math.round(r.width * 10) / 10}`).join('; ')
      lines.push([s.index, mat?.code ?? s.materialId, m2(s.sheetArea), m2(s.partsArea), m2(s.remnantArea), m2(s.scrapArea), pct, pieces].map(csvCell).join(','))
      if (pct > 50) messages.push({ severity: 'warning', text: `Sheet ${s.index} (${mat?.code ?? s.materialId}) is ${pct} % scrap.` })
    }
    const base = order.number.replace(/[^A-Za-z0-9_-]+/g, '-')
    return { files: [{ name: `${base}_waste-areas.csv`, data: lines.join('\r\n') + '\r\n' }], messages }
  },
}

const registry: BatchStep[] = [WASTE_AREAS_STEP]

/** Add a step (plugins, M2.10). A step with the same id replaces the earlier one. */
export function registerBatchStep(step: BatchStep) {
  const i = registry.findIndex((s) => s.id === step.id)
  if (i >= 0) registry[i] = step
  else registry.push(step)
  return () => {
    const j = registry.indexOf(step)
    if (j >= 0) registry.splice(j, 1)
  }
}

export const batchSteps = (): readonly BatchStep[] => registry

/** Id of a plugin's batch step (M2.10). */
export const pluginStepId = (plugin: string, step: string) => `plugin:${plugin}/${step}`

/**
 * The steps a batch setup can choose: the built-in ones, then those of switched-on plugins (as
 * found when each plugin was last started; the plugin itself runs only in the batch run).
 */
export function batchStepChoices(data: Pick<AppData, 'plugins'>): Pick<BatchStep, 'id' | 'name' | 'description' | 'source'>[] {
  const out: Pick<BatchStep, 'id' | 'name' | 'description' | 'source'>[] = registry.map(({ id, name, description, source }) => ({ id, name, description, source }))
  for (const p of data.plugins ?? []) if (p.enabled) for (const s of p.contributes?.steps ?? []) out.push({ id: pluginStepId(p.id, s.id), name: s.name, description: s.description, source: p.manifest.name })
  return out
}

export interface StepRun {
  messages: BatchStepMessage[]
  files: OutFile[]
}

/** Run one hook of the chosen steps. A step that fails, or tries to add a program, is an error. */
export function runSteps(ids: readonly string[], hook: 'afterNest' | 'beforeOutput', ctx: BatchStepContext, files: readonly OutFile[] = [], extra: readonly BatchStep[] = []): StepRun {
  const out: StepRun = { messages: [], files: [] }
  if (!ids.length) return out
  const frozen = deepFreeze(structuredClone({ ...ctx, files: [...files] }))
  for (const id of ids) {
    const step = extra.find((s) => s.id === id) ?? registry.find((s) => s.id === id)
    if (!step) {
      if (hook === 'afterNest') out.messages.push({ severity: 'warning', text: `Batch step "${id}" is not available; skipped.` })
      continue
    }
    const fn = step[hook]
    if (!fn) continue
    try {
      const r = fn.call(step, frozen) ?? {}
      for (const m of r.messages ?? []) out.messages.push({ severity: m.severity, text: `${step.name}: ${m.text}` })
      for (const f of r.files ?? []) {
        if (stepFileRefused(f.name) || [...files, ...out.files].some((x) => x.name.toLowerCase() === f.name.toLowerCase())) out.messages.push({ severity: 'error', text: `${step.name}: may not write ${f.name} (programs come only from the program writers; names must be new and without folders).` })
        else out.files.push(f)
      }
    } catch (e) {
      out.messages.push({ severity: 'error', text: `${step.name} failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  return out
}
