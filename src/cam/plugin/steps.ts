/**
 * Plugin batch steps (M2.10, API-01 with AM-10). A plugin's `cs.batch.step(...)` becomes a step of
 * the one batch engine (`src/core/batchSteps.ts`), with the same rules as the built-in steps: it
 * sees a copy of the order (parts, sheets, programs by name, export-checker results), it can
 * report, hold the order back and add report files, and it never changes what is cut or adds a
 * program file.
 */
import type { QuickJSWASMModule } from 'quickjs-emscripten-core'
import { pluginStepId, type BatchStep, type BatchStepContext, type BatchStepMessage, type BatchStepResult } from '@/core/batchSteps'
import type { OutFile } from '@/core/output'
import type { AppData } from '@/core/types'
import { PluginError, PluginHost, type PluginEnv } from './host'
import type { PluginRecord } from './types'

export { pluginStepId }

/** What a plugin's batch step sees: plain data, a copy of the order. */
export function batchView(ctx: BatchStepContext & { files?: readonly OutFile[] }) {
  const { output, data } = ctx
  const code = (id: string) => data.library.materials.find((m) => m.id === id)?.code ?? id
  return {
    order: { ...ctx.order },
    machine: { ...ctx.machine },
    parts: output.instances.map((i) => ({ no: i.no, partId: i.partId, name: i.part.name, material: code(i.materialId), length: i.cutLength, width: i.cutWidth, thickness: i.thickness, cabinet: i.cabinetNumber, custom: !!i.cam, ...(i.kit ? { kit: i.kit } : {}), ...(i.cam?.assembly ? { assembly: i.cam.assembly } : {}) })),
    sheets: output.nest.sheets.map((s) => ({ index: s.index, material: code(s.materialId), length: s.sheetLength, width: s.sheetWidth, thickness: s.thickness, parts: s.placements.length, utilization: s.utilization, offcut: !!s.offcutId, flip: !!s.flip })),
    unplaced: output.nest.unplaced.length,
    programs: output.programs.map((p) => ({ name: p.name, sheet: p.sheet.index, operations: p.ops.length })),
    issues: output.issues.map((i) => ({ severity: i.severity, code: i.code, message: i.message })),
    ...(ctx.files ? { files: ctx.files.map((f) => ({ name: f.name, bytes: typeof f.data === 'string' ? new TextEncoder().encode(f.data).length : f.data.length })) } : {}),
  }
}

function resultOf(raw: unknown, name: string): BatchStepResult {
  if (raw === null || raw === undefined) return {}
  if (typeof raw !== 'object') throw new PluginError(`${name} returned ${typeof raw}; expected { messages, files }.`)
  const r = raw as { messages?: unknown; files?: unknown }
  const messages: BatchStepMessage[] = []
  for (const m of Array.isArray(r.messages) ? r.messages : []) {
    const sev = (m as BatchStepMessage)?.severity
    messages.push({ severity: sev === 'error' || sev === 'warning' ? sev : 'info', text: String((m as BatchStepMessage)?.text ?? '').slice(0, 2000) })
  }
  const files: OutFile[] = []
  for (const f of Array.isArray(r.files) ? r.files : []) {
    const { name: fname, data } = (f ?? {}) as { name?: unknown; data?: unknown }
    if (typeof fname !== 'string' || typeof data !== 'string') throw new PluginError(`${name}: each file needs a name and text data.`)
    files.push({ name: fname, data })
  }
  return { messages, files }
}

export interface PluginSteps {
  steps: BatchStep[]
  hosts: PluginHost[]
  /** Plugins that could not start (their steps hold the order back if the setup uses them). */
  problems: string[]
  dispose(): void
}

/**
 * Start every switched-on plugin that has batch steps and turn its steps into batch steps. A
 * plugin that cannot start still lists its steps (from when it last loaded), as steps that hold
 * the order back with the reason, so a setup that counts on a plugin's check never runs without it.
 */
export function pluginBatchSteps(data: Pick<AppData, 'plugins' | 'machine' | 'settings'>, mod: QuickJSWASMModule | null, env: PluginEnv | ((r: PluginRecord) => PluginEnv) = {}): PluginSteps {
  const steps: BatchStep[] = []
  const hosts: PluginHost[] = []
  const problems: string[] = []
  for (const rec of (data.plugins ?? []) as PluginRecord[]) {
    if (!rec.enabled) continue
    const cached = rec.contributes?.steps ?? []
    let host: PluginHost | null = null
    try {
      if (!mod) throw new PluginError('the plugin sandbox is not available here')
      host = PluginHost.startWith(mod, rec, { machine: data.machine, units: data.settings.units, ...(typeof env === 'function' ? env(rec) : env) })
      hosts.push(host)
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e)
      problems.push(`${rec.manifest.name}: ${why}`)
      for (const s of cached)
        steps.push({
          id: pluginStepId(rec.id, s.id),
          name: s.name,
          description: s.description,
          source: rec.manifest.name,
          afterNest: () => ({ messages: [{ severity: 'error', text: `the plugin ${rec.manifest.name} could not start (${why}).` }] }),
        })
      continue
    }
    const h = host
    for (const s of h.contributes.steps) {
      const run = (hook: 'afterNest' | 'beforeOutput') => (ctx: BatchStepContext & { files?: readonly OutFile[] }) => resultOf(h.callNow('step', s.id, hook, batchView(ctx)), s.name)
      steps.push({
        id: pluginStepId(rec.id, s.id),
        name: s.name,
        description: s.description,
        source: rec.manifest.name,
        ...(s.hooks.includes('afterNest') ? { afterNest: run('afterNest') } : {}),
        ...(s.hooks.includes('beforeOutput') ? { beforeOutput: run('beforeOutput') } : {}),
      })
    }
  }
  return {
    steps,
    hosts,
    problems,
    dispose: () => {
      for (const h of hosts) h.dispose()
    },
  }
}
