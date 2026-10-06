/**
 * Setup wizards (M2.9, AM-03): step-by-step answers turned into a batch setup or a layer-rule set.
 * The screens only collect the answers; everything here is pure and tested, and the result is the
 * same data the Batch page and the Machining rules tab edit by hand.
 */
import { layerMatches, recipesOf, ruleSetsOf } from '@/cam/rules'
import type { CamPart, LayerRule, LayerRuleSet } from '@/cam/types'
import { batchStepChoices } from './batchSteps'
import { machineSetup } from './machines'
import type { ExportKind } from './output'
import type { AppData, BatchSetup, Library } from './types'

// ---------------------------------------------------------------------------------------------
// Batch setup
// ---------------------------------------------------------------------------------------------

export interface BatchWizardAnswers {
  name: string
  machines: string[]
  kinds: ExportKind[]
  steps: string[]
}

export const BATCH_WIZARD_STEPS = ['Name', 'Machines', 'Outputs', 'Extra steps', 'Check'] as const

/** What stops the wizard moving on from step `step` (0-based). */
export function batchWizardProblems(step: number, a: BatchWizardAnswers, data: Pick<AppData, 'machine' | 'machines' | 'settings' | 'plugins'>): string[] {
  const out: string[] = []
  if (step >= 0) {
    if (!a.name.trim()) out.push('Give the setup a name.')
    else if ((data.settings.batchSetups ?? []).some((b) => b.name.trim().toLowerCase() === a.name.trim().toLowerCase())) out.push(`A setup called "${a.name.trim()}" already exists.`)
  }
  if (step >= 1) {
    if (!a.machines.length) out.push('Pick at least one machine.')
    for (const id of a.machines) if (!machineSetup(data, id)) out.push(`Machine "${id}" is not in the machine list.`)
  }
  if (step >= 2 && !a.kinds.length) out.push('Pick at least one output.')
  if (step >= 3) for (const id of a.steps) if (!batchStepChoices(data).some((s) => s.id === id)) out.push(`Batch step "${id}" is not available.`)
  return out
}

/** The setup the answers describe, with an id no other setup has. */
export function batchSetupFromWizard(a: BatchWizardAnswers, data: Pick<AppData, 'settings'>): BatchSetup {
  const taken = new Set((data.settings.batchSetups ?? []).map((b) => b.id))
  let id = `bs-${(a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'setup').slice(0, 24)}`
  for (let n = 2; taken.has(id); n++) id = `${id.replace(/-\d+$/, '')}-${n}`
  return { id, name: a.name.trim(), machines: [...a.machines], kinds: [...a.kinds], steps: [...a.steps] }
}

// ---------------------------------------------------------------------------------------------
// Layer-rule set
// ---------------------------------------------------------------------------------------------

export interface RuleWizardLayer {
  layer: string
  /** Recipe for the shapes on this layer; null = leave them alone. */
  recipeId: string | null
  /** Depth from the layer name ("POCKET_D6" -> 6 mm). */
  depthFromName: boolean
  /** Copied from the suggestion: which shapes on the layer the rule takes (e.g. circles only). */
  where?: LayerRule['where']
  side?: LayerRule['side']
}

export interface RuleWizardAnswers {
  name: string
  layers: RuleWizardLayer[]
  /** Layer whose largest closed shape is the part outline ('' = the largest anywhere). */
  outlineLayer: string
  alignLongestEdge: boolean
}

export const RULE_WIZARD_STEPS = ['Name', 'Layers', 'Machining', 'Check'] as const

/** Layer names in a drawing, in the order they are first used (then unused layers from the table). */
export function layerNames(names: Iterable<string>): string[] {
  const seen = new Map<string, string>()
  for (const n of names) {
    const t = n.trim()
    if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t)
  }
  return [...seen.values()]
}

/** Layer names a drawn or imported part uses (entities name layers by id). */
export function partLayerNames(p: Pick<CamPart, 'entities' | 'layers'>): string[] {
  return layerNames(p.entities.map((e) => p.layers.find((l) => l.id === e.layer)?.name ?? e.layer))
}

/** What the shop's current first rule set does with a layer name, as a starting answer. */
export function suggestLayer(layer: string, lib: Library): RuleWizardLayer {
  const set = ruleSetsOf(lib)[0]
  const rule = set ? [...set.rules].sort((a, b) => a.order - b.order).find((r) => layerMatches(r.layer, layer)) : undefined
  if (!rule || !recipesOf(lib).some((r) => r.id === rule.recipeId)) return { layer, recipeId: null, depthFromName: false }
  return { layer, recipeId: rule.recipeId, depthFromName: !!rule.depthFromName, ...(rule.where ? { where: structuredClone(rule.where) } : {}), ...(rule.side ? { side: rule.side } : {}) }
}

/** A layer name as an exact pattern (names with * or ? would otherwise read as wildcards). */
export const exactLayer = (name: string) => (/[*?]/.test(name) || (name.startsWith('/') && name.length > 2) ? `/^${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$/` : name)

export function ruleWizardProblems(step: number, a: RuleWizardAnswers, lib: Library): string[] {
  const out: string[] = []
  if (step >= 0) {
    if (!a.name.trim()) out.push('Give the rule set a name.')
    else if (ruleSetsOf(lib).some((s) => s.name.trim().toLowerCase() === a.name.trim().toLowerCase())) out.push(`A rule set called "${a.name.trim()}" already exists.`)
  }
  if (step >= 1 && !a.layers.length) out.push('Add the layer names your drawings use.')
  if (step >= 2) {
    if (!a.layers.some((l) => l.recipeId)) out.push('Choose machining for at least one layer.')
    for (const l of a.layers) if (l.recipeId && !recipesOf(lib).some((r) => r.id === l.recipeId)) out.push(`Layer ${l.layer}: the recipe no longer exists.`)
  }
  return out
}

/** The rule set: one exact-name rule per machined layer, in the order listed. */
export function ruleSetFromWizard(a: RuleWizardAnswers, lib: Library): LayerRuleSet {
  const taken = new Set(ruleSetsOf(lib).map((s) => s.id))
  let id = `rs-${(a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'rules').slice(0, 24)}`
  for (let n = 2; taken.has(id); n++) id = `${id.replace(/-\d+$/, '')}-${n}`
  const rules: LayerRule[] = a.layers
    .filter((l) => l.recipeId)
    .map((l, i) => ({
      id: `${id}-r${i + 1}`,
      layer: exactLayer(l.layer),
      recipeId: l.recipeId!,
      order: i,
      ...(l.depthFromName ? { depthFromName: true } : {}),
      ...(l.where?.length ? { where: structuredClone(l.where) } : {}),
      ...(l.side ? { side: l.side } : {}),
    }))
  return { id, name: a.name.trim(), outlineLayer: a.outlineLayer, alignLongestEdge: a.alignLongestEdge, rules }
}
