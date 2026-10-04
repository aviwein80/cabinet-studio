import { ArrowDown, ArrowUp, Copy, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useState } from 'react'
import { useStore } from '@/app/store'
import { defaultOp, OP_LABEL, toTemplate } from '@/cam/ops'
import { BUILTIN_RECIPES, BUILTIN_RULESETS, depthFromLayerName, layerMatches, recipesOf, ruleSetsOf } from '@/cam/rules'
import type { CamOpKind, LayerRule, LayerRuleSet, OpTemplate, ProfileSide, QueryTest, Recipe } from '@/cam/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { Library } from '@/core/types'
import { formatLength, parseLength } from '@/core/units'

type Shapes = 'any' | 'closed' | 'open' | 'circles'
const SHAPES: { value: Shapes; label: string; where: QueryTest[] }[] = [
  { value: 'any', label: 'Any shape', where: [] },
  { value: 'closed', label: 'Closed shapes', where: [{ field: 'closed', op: '=', value: true }] },
  { value: 'open', label: 'Open shapes', where: [{ field: 'closed', op: '=', value: false }] },
  { value: 'circles', label: 'Circles', where: [{ field: 'type', op: '=', value: 'circle' }] },
]
const shapesOf = (w: QueryTest[] | undefined): Shapes | 'custom' => {
  const key = JSON.stringify(w ?? [])
  return SHAPES.find((s) => JSON.stringify(s.where) === key)?.value ?? 'custom'
}
const SIDES: { value: ProfileSide | 'recipe'; label: string }[] = [
  { value: 'recipe', label: 'As recipe' },
  { value: 'outside', label: 'Outside' },
  { value: 'inside', label: 'Inside' },
  { value: 'auto', label: 'Holes inside' },
  { value: 'centre', label: 'On the line' },
]
const KINDS: CamOpKind[] = ['profile', 'pocket', 'drill', 'engrave', 'vcarve', 'saw']

export function RulesTab() {
  const { data, updateLibrary } = useStore()
  const [setId, setSetId] = useState<string | null>(null)
  const [probe, setProbe] = useState('POCKET_D8')
  if (!data) return null
  const lib = data.library
  const units = data.settings.units
  const sets = ruleSetsOf(lib)
  const recipes = recipesOf(lib)
  const set = sets.find((s) => s.id === setId) ?? sets[0]

  /** Copy built-ins into the library on first edit so the defaults stay untouched in code. */
  const edit = (fn: (l: Library & { recipes: Recipe[]; layerRules: LayerRuleSet[] }) => void) =>
    updateLibrary((l) => {
      l.recipes = l.recipes ?? structuredClone(BUILTIN_RECIPES)
      l.layerRules = l.layerRules ?? structuredClone(BUILTIN_RULESETS)
      fn(l as Library & { recipes: Recipe[]; layerRules: LayerRuleSet[] })
    })
  const editSet = (fn: (s: LayerRuleSet) => void) => edit((l) => fn(l.layerRules.find((s) => s.id === set.id)!))
  const editRule = (id: string, fn: (r: LayerRule) => void) => editSet((s) => fn(s.rules.find((r) => r.id === id)!))
  const rules = [...(set?.rules ?? [])].sort((a, b) => a.order - b.order)
  const move = (id: string, d: -1 | 1) =>
    editSet((s) => {
      const list = [...s.rules].sort((a, b) => a.order - b.order)
      const i = list.findIndex((r) => r.id === id)
      const j = i + d
      if (j < 0 || j >= list.length) return
      ;[list[i], list[j]] = [list[j], list[i]]
      list.forEach((r, k) => (r.order = k))
      s.rules = list
    })

  const hit = rules.find((r) => layerMatches(r.layer, probe))
  const hitDepth = hit?.depthFromName ? depthFromLayerName(probe) : null

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Rule table</span>
            <Select value={set?.id} onValueChange={setSetId}>
              <SelectTrigger className="h-8 w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sets.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input className="h-8 w-56" aria-label="Rule table name" value={set?.name ?? ''} onChange={(e) => editSet((s) => void (s.name = e.target.value))} />
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const id = `rs-${nanoid(6)}`
              edit((l) => void l.layerRules.push({ ...structuredClone(set), id, name: `${set.name} (copy)` }))
              setSetId(id)
            }}
          >
            <Copy /> Duplicate
          </Button>
          {sets.length > 1 && (
            <Button size="sm" variant="ghost" onClick={() => edit((l) => void (l.layerRules = l.layerRules.filter((s) => s.id !== set.id)))}>
              <Trash2 /> Delete table
            </Button>
          )}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => updateLibrary((l) => void ((l.layerRules = undefined), (l.recipes = undefined)))}>
            <RotateCcw /> Built-in rules
          </Button>
        </div>

        <div className="overflow-x-auto rounded-xl border bg-background">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-16 px-2 py-2 font-medium">Order</th>
                <th className="px-2 py-2 font-medium">Layer name</th>
                <th className="px-2 py-2 font-medium">Shapes</th>
                <th className="px-2 py-2 font-medium">Recipe</th>
                <th className="px-2 py-2 font-medium">Depth from name</th>
                <th className="px-2 py-2 font-medium">Side</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rules.map((r, i) => {
                const shapes = shapesOf(r.where)
                return (
                  <tr key={r.id} className={hit?.id === r.id ? 'bg-amber-50' : ''}>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-0.5">
                        <span className="w-4 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                        <Button size="icon-xs" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(r.id, -1)}>
                          <ArrowUp />
                        </Button>
                        <Button size="icon-xs" variant="ghost" aria-label="Move down" disabled={i === rules.length - 1} onClick={() => move(r.id, 1)}>
                          <ArrowDown />
                        </Button>
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <Input className="h-7 font-mono text-xs" value={r.layer} aria-label="Layer name pattern" onChange={(e) => editRule(r.id, (x) => void (x.layer = e.target.value))} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Select value={shapes} onValueChange={(v) => editRule(r.id, (x) => void (x.where = structuredClone(SHAPES.find((s) => s.value === v)!.where)))}>
                        <SelectTrigger className="h-7 w-36 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SHAPES.map((s) => (
                            <SelectItem key={s.value} value={s.value}>
                              {s.label}
                            </SelectItem>
                          ))}
                          {shapes === 'custom' && <SelectItem value="custom">Custom tests</SelectItem>}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-1.5">
                      <Select value={r.recipeId} onValueChange={(v) => editRule(r.id, (x) => void (x.recipeId = v))}>
                        <SelectTrigger className="h-7 w-52 text-xs">
                          <SelectValue placeholder="Missing recipe" />
                        </SelectTrigger>
                        <SelectContent>
                          {recipes.map((rc) => (
                            <SelectItem key={rc.id} value={rc.id}>
                              {rc.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-1.5">
                      <Switch checked={!!r.depthFromName} aria-label="Depth from layer name" onCheckedChange={(v) => editRule(r.id, (x) => void (x.depthFromName = v))} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Select value={r.side ?? 'recipe'} onValueChange={(v) => editRule(r.id, (x) => void (x.side = v === 'recipe' ? undefined : (v as ProfileSide)))}>
                        <SelectTrigger className="h-7 w-32 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SIDES.map((s) => (
                            <SelectItem key={s.value} value={s.value}>
                              {s.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-1 py-1.5">
                      <Button size="icon-xs" variant="ghost" aria-label="Delete rule" onClick={() => editSet((s) => void (s.rules = s.rules.filter((x) => x.id !== r.id)))}>
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                )
              })}
              {!rules.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    No rules yet. Add one per layer name your drafter uses.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
            <Button size="sm" variant="outline" onClick={() => editSet((s) => void s.rules.push({ id: nanoid(6), layer: 'NEW_LAYER*', recipeId: recipes[0]?.id ?? '', order: s.rules.length, where: [] }))}>
              <Plus /> Add rule
            </Button>
            <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              Outline layer
              <Input className="h-7 w-40 font-mono text-xs" placeholder="largest closed shape" value={set?.outlineLayer ?? ''} onChange={(e) => editSet((s) => void (s.outlineLayer = e.target.value))} />
            </label>
          </div>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Each shape goes to the first rule, top to bottom, whose layer name and shape test match. Patterns are exact names, wildcards (<span className="font-mono">POCKET*</span>,{' '}
          <span className="font-mono">DR?LL</span>) or <span className="font-mono">/regular expressions/</span>, never case-sensitive. With depth from name on, the last number in the layer name is the depth in mm
          (<span className="font-mono">POCKET_D8</span> → 8, <span className="font-mono">DRILL_5_12</span> → 12, <span className="font-mono">_0.25in</span> → 6.35). Cut-outs always run last.
        </p>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
          <span className="font-medium">Try a layer name</span>
          <Input className="h-7 w-48 font-mono text-xs" value={probe} onChange={(e) => setProbe(e.target.value)} aria-label="Layer name to test" />
          {hit ? (
            <span>
              Rule {rules.indexOf(hit) + 1} → <span className="font-medium">{recipes.find((r) => r.id === hit.recipeId)?.name ?? 'missing recipe'}</span>
              {hitDepth !== null && <> at {formatLength(hitDepth, units)}</>}
            </span>
          ) : (
            <span className="text-muted-foreground">No rule matches; shapes on this layer stay unmachined.</span>
          )}
        </div>
      </div>

      <RecipeList recipes={recipes} usedBy={(id) => sets.some((s) => s.rules.some((r) => r.recipeId === id))} units={units} edit={edit} />
    </div>
  )
}

function RecipeList({
  recipes,
  usedBy,
  units,
  edit,
}: {
  recipes: Recipe[]
  usedBy: (id: string) => boolean
  units: 'mm' | 'in'
  edit: (fn: (l: Library & { recipes: Recipe[]; layerRules: LayerRuleSet[] }) => void) => void
}) {
  const { data } = useStore()
  const tools = data?.machine.tools ?? []
  const editRecipe = (id: string, fn: (r: Recipe) => void) => edit((l) => fn(l.recipes.find((r) => r.id === id)!))
  const editOp = (id: string, i: number, fn: (o: OpTemplate) => void) => editRecipe(id, (r) => fn(r.ops[i]))
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Recipes</h3>
        <Select
          value=""
          onValueChange={(k) => edit((l) => void l.recipes.push({ id: `rc-${nanoid(6)}`, name: `New ${OP_LABEL[k as CamOpKind].toLowerCase()}`, ops: [toTemplate(defaultOp(k as CamOpKind))] }))}
        >
          <SelectTrigger className="h-8 w-36 text-xs">
            <Plus className="size-3.5" />
            <SelectValue placeholder="New recipe" />
          </SelectTrigger>
          <SelectContent>
            {KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {OP_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {recipes.map((rc) => (
        <div key={rc.id} className="rounded-xl border bg-background p-3">
          <div className="flex items-center gap-2">
            <Input className="h-7 text-sm font-medium" value={rc.name} aria-label="Recipe name" onChange={(e) => editRecipe(rc.id, (r) => void (r.name = e.target.value))} />
            {usedBy(rc.id) && (
              <Badge variant="outline" className="shrink-0 text-[10px]">
                In use
              </Badge>
            )}
            <Button size="icon-xs" variant="ghost" aria-label="Delete recipe" disabled={usedBy(rc.id)} onClick={() => edit((l) => void (l.recipes = l.recipes.filter((r) => r.id !== rc.id)))}>
              <Trash2 />
            </Button>
          </div>
          {rc.description && <p className="mt-1 text-[11px] text-muted-foreground">{rc.description}</p>}
          <ul className="mt-2 flex flex-col gap-1.5">
            {rc.ops.map((op, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-xs">
                <span className="w-20 font-medium">{OP_LABEL[op.kind]}</span>
                <label className="flex items-center gap-1">
                  <Switch checked={op.levels.through} aria-label="Through" onCheckedChange={(v) => editOp(rc.id, i, (o) => void (o.levels.through = v))} />
                  Through
                </label>
                {!op.levels.through && (
                  <label className="flex items-center gap-1">
                    Depth
                    <LengthInput value={op.levels.depth} units={units} onChange={(n) => editOp(rc.id, i, (o) => void (o.levels.depth = n))} />
                  </label>
                )}
                <Select value={op.toolId ?? 'auto'} onValueChange={(v) => editOp(rc.id, i, (o) => void (o.toolId = v === 'auto' ? null : v))}>
                  <SelectTrigger className="h-6 w-40 text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Tool: automatic</SelectItem>
                    {tools
                      .filter((t) => (op.kind === 'drill' ? t.type.startsWith('drill') : op.kind === 'saw' ? t.type === 'saw' : t.type === 'router'))
                      .map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          T{t.number} {t.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function LengthInput({ value, units, onChange }: { value: number; units: 'mm' | 'in'; onChange: (n: number) => void }) {
  const shown = formatLength(value, units)
  const [text, setText] = useState<string | null>(null)
  const commit = () => {
    if (text === null) return
    const n = parseLength(text, units)
    if (n !== null && n > 0) onChange(n)
    setText(null)
  }
  return <Input className="h-6 w-20 text-xs tabular-nums" value={text ?? shown} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} aria-label="Depth" />
}
