/**
 * Layer rules: a table that maps drawing layer names (and simple geometry tests) to saved
 * machining recipes, so an imported drawing gets its operations without hand picking.
 */
import { layerOf, partOutline } from './doc'
import { claimShapes, entityFacts, runAutoQueries } from './query'
import { defaultOp, fromTemplate, toTemplate } from './ops'
import type { CamOp, CamOpKind, CamPart, LayerRule, LayerRuleSet, OpTemplate, Recipe } from './types'

export { entityFacts, layerMatches, testPasses, type EntityFacts } from './query'
import { layerMatches } from './query'

const tpl = (kind: CamOpKind, name: string, extra: Partial<CamOp> = {}): OpTemplate => ({ ...toTemplate(defaultOp(kind, [], extra)), name })
const lv = (depth: number, through = false) => ({ safeZ: 20, rapidZ: 3, depth, through, stockZ: 0, passDepth: 0 })

export const BUILTIN_RECIPES: Recipe[] = [
  { id: 'rc-cutout', name: 'Cut out (outside, through)', description: 'Outer shape, climb, arc lead-in.', ops: [tpl('profile', 'Cut out', { side: 'outside', levels: lv(0, true) } as Partial<CamOp>)] },
  { id: 'rc-inside', name: 'Inside cut (through)', description: 'Openings cut through, inner shapes first.', ops: [tpl('profile', 'Inside cut', { side: 'inside', order: 'inside-first', levels: lv(0, true) } as Partial<CamOp>)] },
  { id: 'rc-auto', name: 'Profile, holes inside (through)', description: 'Outer shapes outside, shapes inside them on the inside.', ops: [tpl('profile', 'Profile', { side: 'auto', order: 'inside-first', levels: lv(0, true) } as Partial<CamOp>)] },
  { id: 'rc-pocket', name: 'Pocket 6 mm', description: 'Offset pocket with islands and helix entry.', ops: [tpl('pocket', 'Pocket', { levels: lv(6) } as Partial<CamOp>)] },
  { id: 'rc-drill', name: 'Drill 13 mm', description: 'Every circle drilled to depth with the matching drill.', ops: [tpl('drill', 'Drill', { levels: lv(13) } as Partial<CamOp>)] },
  { id: 'rc-drill-thru', name: 'Drill through', ops: [tpl('drill', 'Drill through', { levels: lv(0, true) } as Partial<CamOp>)] },
  { id: 'rc-engrave', name: 'Engrave 1 mm', description: 'Tool centre on the line.', ops: [tpl('engrave', 'Engrave', { levels: lv(1) } as Partial<CamOp>)] },
  { id: 'rc-vcarve', name: 'V-carve 6 mm', ops: [tpl('vcarve', 'V-carve', { levels: lv(6) } as Partial<CamOp>)] },
  { id: 'rc-saw', name: 'Saw groove 8 mm', ops: [tpl('saw', 'Saw groove', { levels: lv(8) } as Partial<CamOp>)] },
  {
    id: 'rc-rough-finish',
    name: 'Pocket rough + finish wall',
    description: 'Roughing pocket leaving 0.3 mm, then a finishing profile on the wall.',
    ops: [tpl('pocket', 'Pocket rough', { stockXY: 0.3, levels: lv(6) } as Partial<CamOp>), tpl('profile', 'Pocket finish', { side: 'inside', levels: lv(6) } as Partial<CamOp>)],
  },
]

const rule = (id: string, layer: string, recipeId: string, order: number, extra: Partial<LayerRule> = {}): LayerRule => ({ id, layer, recipeId, order, ...extra })

export const BUILTIN_RULESETS: LayerRuleSet[] = [
  {
    id: 'rs-shop',
    name: 'Shop layer names',
    outlineLayer: '',
    alignLongestEdge: false,
    rules: [
      rule('r1', '/^(drill|hole|bore)/', 'rc-drill', 1, { depthFromName: true, where: [{ field: 'type', op: '=', value: 'circle' }] }),
      rule('r2', '/^(thru|through)[-_ ]?(drill|hole)/', 'rc-drill-thru', 0, { where: [{ field: 'type', op: '=', value: 'circle' }] }),
      rule('r3', '/^pocket/', 'rc-pocket', 2, { depthFromName: true, where: [{ field: 'closed', op: '=', value: true }] }),
      rule('r4', '/^(engrave|text|score)/', 'rc-engrave', 3, { depthFromName: true }),
      rule('r5', '/^(vcarve|v-carve|v_)/', 'rc-vcarve', 4, { depthFromName: true }),
      rule('r6', '/^(saw|kerf)/', 'rc-saw', 5, { depthFromName: true, where: [{ field: 'closed', op: '=', value: false }] }),
      rule('r7', '/^(inside|cutin|opening)/', 'rc-inside', 6, { where: [{ field: 'closed', op: '=', value: true }] }),
      rule('r8', '/^(outline|cut|cutout|cut-out|profile|0)$/', 'rc-auto', 7, { where: [{ field: 'closed', op: '=', value: true }] }),
    ],
  },
]

export const recipesOf = (lib: { recipes?: Recipe[] }) => lib.recipes ?? BUILTIN_RECIPES
export const ruleSetsOf = (lib: { layerRules?: LayerRuleSet[] }) => lib.layerRules ?? BUILTIN_RULESETS

/** Depth from a layer name: the last number, e.g. POCKET_D6.5 -> 6.5, DRILL_5_12 -> 12, ENGRAVE_0.04IN -> 1.016. */
export function depthFromLayerName(name: string): number | null {
  const all = [...name.matchAll(/(\d+(?:[.,]\d+)?)\s*(mm|in|")?/gi)]
  if (!all.length) return null
  const last = all[all.length - 1]
  const n = Number(last[1].replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = (last[2] ?? '').toLowerCase()
  return unit === 'in' || unit === '"' ? Math.round(n * 25.4 * 1000) / 1000 : n
}

export interface RuleReport {
  ruleId: string
  layer: string
  recipe: string
  shapes: number
  ops: number
  depth?: number
}

export interface ApplyResult {
  part: CamPart
  report: RuleReport[]
  /** Layers with machinable shapes that no rule picked up. */
  unmatched: { layer: string; shapes: number }[]
  missingRecipes: string[]
}

const KIND_ORDER: Record<CamOpKind, number> = { face: -1, code: 0, curve: 4.5, manual: 4.6, chamfer: 6.5, edge: 7.5, drill: 1, pocket: 2, thread: 2.5, engrave: 3, vcarve: 4, sweep: 5, saw: 6, profile: 7, rough3d: 8, finish3d: 9, rotary: 10 }

/**
 * Apply a rule set: each shape is claimed by the first rule (lowest `order`) that matches its
 * layer and tests. Ops made by an earlier run of the rules are replaced; hand-made ops stay.
 * Through profiles that machine the outline run last.
 */
export function applyRules(input: CamPart, set: LayerRuleSet, recipes: Recipe[]): ApplyResult {
  // auto-queries first (CAD-17): shapes they find move to their result layers
  const part = set.queries?.length ? runAutoQueries(input, set.queries).part : input
  const rules = [...set.rules].sort((a, b) => a.order - b.order)
  // each shape is claimed by the first rule whose query (layer pattern and tests) it passes
  const claimed: Map<string, LayerRule> = claimShapes(part, rules)
  const facts = new Map(part.entities.map((e) => [e.id, entityFacts(part, e)]))

  const report: RuleReport[] = []
  const missing = new Set<string>()
  const made: { op: CamOp; rank: number; ruleOrder: number }[] = []
  for (const r of rules) {
    const ids = part.entities.filter((e) => claimed.get(e.id) === r).map((e) => e.id)
    if (!ids.length) continue
    const recipe = recipes.find((x) => x.id === r.recipeId)
    if (!recipe) {
      missing.add(r.recipeId)
      continue
    }
    const byLayer = new Map<string, string[]>()
    for (const id of ids) {
      const l = facts.get(id)!.layer
      byLayer.set(l, [...(byLayer.get(l) ?? []), id])
    }
    for (const [layer, group] of byLayer) {
      const depth = r.depthFromName ? depthFromLayerName(layer) : null
      let count = 0
      for (const t of recipe.ops) {
        const op = fromTemplate(t, group)
        op.recipeId = recipe.id
        op.auto = r.id
        op.name = `${t.name} (${layer})`
        if (depth !== null && !op.levels.through) op.levels = { ...op.levels, depth }
        if (op.kind === 'profile') {
          if (r.side) op.side = r.side
          if (r.direction) op.direction = r.direction
        }
        if (op.kind === 'pocket' && r.direction) op.direction = r.direction
        made.push({ op, rank: KIND_ORDER[op.kind], ruleOrder: r.order })
        count++
      }
      report.push({ ruleId: r.id, layer, recipe: recipe.name, shapes: group.length, ops: count, ...(depth !== null ? { depth } : {}) })
    }
  }

  let next: CamPart = { ...part, ops: part.ops.filter((o) => !o.auto) }
  if (set.outlineLayer) {
    const onLayer = part.entities.filter((e) => layerMatches(set.outlineLayer!, facts.get(e.id)!.layer) && facts.get(e.id)!.closed)
    const biggest = onLayer.sort((a, b) => facts.get(b.id)!.area - facts.get(a.id)!.area)[0]
    if (biggest) next = { ...next, outlineId: biggest.id }
  }
  const outlineId = partOutline(next).entity?.id
  const isOutline = (op: CamOp) => op.kind === 'profile' && !!outlineId && op.geometry.includes(outlineId)
  made.sort((a, b) => Number(isOutline(a.op)) - Number(isOutline(b.op)) || a.rank - b.rank || a.ruleOrder - b.ruleOrder)
  next = { ...next, ops: [...next.ops, ...made.map((m) => m.op)], updatedAt: new Date().toISOString() }

  const unmatchedMap = new Map<string, number>()
  for (const e of part.entities) {
    if (claimed.has(e.id) || layerOf(part, e.layer)?.construction || e.g.t === 'point') continue
    const l = facts.get(e.id)!.layer
    unmatchedMap.set(l, (unmatchedMap.get(l) ?? 0) + 1)
  }
  return { part: next, report, unmatched: [...unmatchedMap].map(([layer, shapes]) => ({ layer, shapes })), missingRecipes: [...missing] }
}
