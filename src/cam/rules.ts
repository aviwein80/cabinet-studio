/**
 * Layer rules: a table that maps drawing layer names (and simple geometry tests) to saved
 * machining recipes, so an imported drawing gets its operations without hand picking.
 */
import { entityContours, layerOf, partOutline } from './doc'
import { area, boxOf } from './geom'
import { defaultOp, fromTemplate, toTemplate } from './ops'
import type { CamOp, CamOpKind, CamPart, Entity, LayerRule, LayerRuleSet, OpTemplate, QueryTest, Recipe } from './types'

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

/** Exact (case-insensitive), glob with * and ?, or /regex/ (case-insensitive). */
export function layerMatches(pattern: string, name: string): boolean {
  const p = pattern.trim()
  if (!p) return false
  if (p.length > 2 && p.startsWith('/') && p.lastIndexOf('/') > 0) {
    const end = p.lastIndexOf('/')
    try {
      return new RegExp(p.slice(1, end), p.slice(end + 1).replace(/[^gimsuy]/g, '') + (p.slice(end + 1).includes('i') ? '' : 'i')).test(name)
    } catch {
      return false
    }
  }
  if (/[*?]/.test(p)) {
    const re = new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i')
    return re.test(name)
  }
  return p.toLowerCase() === name.toLowerCase()
}

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

export interface EntityFacts {
  layer: string
  type: string
  closed: boolean
  diameter: number
  width: number
  height: number
  area: number
  face: number
}

export function entityFacts(part: CamPart, e: Entity): EntityFacts {
  const cs = entityContours(e)
  const b = cs.length && cs.some((c) => c.segs.length) ? boxOf(cs) : { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return {
    layer: layerOf(part, e.layer)?.name ?? e.layer,
    type: e.g.t,
    closed: e.g.t === 'circle' || cs.some((c) => c.closed),
    diameter: e.g.t === 'circle' ? e.g.r * 2 : 0,
    width: Math.round((b.maxX - b.minX) * 1000) / 1000,
    height: Math.round((b.maxY - b.minY) * 1000) / 1000,
    area: Math.round(cs.filter((c) => c.closed).reduce((n, c) => n + Math.abs(area(c)), 0) * 1000) / 1000,
    face: e.face,
  }
}

export function testPasses(t: QueryTest, f: EntityFacts): boolean {
  const v = f[t.field]
  const want = t.value
  switch (t.op) {
    case '=':
      return typeof v === 'string' ? v.toLowerCase() === String(want).toLowerCase() : v === (typeof v === 'number' ? Number(want) : want === true || want === 'true')
    case '!=':
      return !testPasses({ ...t, op: '=' }, f)
    case '<':
      return Number(v) < Number(want)
    case '<=':
      return Number(v) <= Number(want) + 1e-9
    case '>':
      return Number(v) > Number(want)
    case '>=':
      return Number(v) >= Number(want) - 1e-9
    case 'contains':
      return String(v).toLowerCase().includes(String(want).toLowerCase())
    case 'matches':
      return layerMatches(String(want), String(v))
  }
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

const KIND_ORDER: Record<CamOpKind, number> = { face: -1, code: 0, drill: 1, pocket: 2, engrave: 3, vcarve: 4, sweep: 5, saw: 6, profile: 7, rough3d: 8, finish3d: 9 }

/**
 * Apply a rule set: each shape is claimed by the first rule (lowest `order`) that matches its
 * layer and tests. Ops made by an earlier run of the rules are replaced; hand-made ops stay.
 * Through profiles that machine the outline run last.
 */
export function applyRules(part: CamPart, set: LayerRuleSet, recipes: Recipe[]): ApplyResult {
  const rules = [...set.rules].sort((a, b) => a.order - b.order)
  const claimed = new Map<string, LayerRule>()
  const facts = new Map(part.entities.map((e) => [e.id, entityFacts(part, e)]))
  for (const e of part.entities) {
    if (layerOf(part, e.layer)?.construction || e.g.t === 'point') continue
    const f = facts.get(e.id)!
    const r = rules.find((rr) => layerMatches(rr.layer, f.layer) && (rr.where ?? []).every((t) => testPasses(t, f)))
    if (r) claimed.set(e.id, r)
  }

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
