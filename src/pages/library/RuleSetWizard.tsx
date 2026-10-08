import { FileUp } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/app/store'
import { dxfToPart } from '@/cam/dxf'
import { applyRules, BUILTIN_RECIPES, BUILTIN_RULESETS, recipesOf } from '@/cam/rules'
import type { CamPart } from '@/cam/types'
import { Wizard } from '@/components/Wizard'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { layerNames, partLayerNames, RULE_WIZARD_STEPS, ruleSetFromWizard, ruleWizardProblems, suggestLayer, type RuleWizardAnswers } from '@/core/wizards'

const NONE = '__none__'

/** New layer-rule set, step by step (M2.9, AM-03): name, layer names (typed or read from a drawing), machining per layer, check. */
export function RuleSetWizard({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const data = useStore((s) => s.data)!
  const updateLibrary = useStore((s) => s.updateLibrary)
  const lib = data.library
  const recipes = recipesOf(lib)
  const [step, setStep] = useState(0)
  const [a, setA] = useState<RuleWizardAnswers>({ name: '', layers: [], outlineLayer: '', alignLongestEdge: false })
  const [typed, setTyped] = useState('')
  const [drawing, setDrawing] = useState<{ name: string; part: CamPart } | null>(null)
  const problems = ruleWizardProblems(step, a, lib)

  // keep answers already given for a layer; new layers start from what the shop rules do with them
  const setLayers = (names: string[]) => setA((cur) => ({ ...cur, layers: layerNames(names).map((n) => cur.layers.find((l) => l.layer.toLowerCase() === n.toLowerCase()) ?? suggestLayer(n, lib)) }))
  const readDxf = async (f: File | undefined) => {
    if (!f) return
    try {
      const { part } = dxfToPart(await f.text(), f.name.replace(/\.dxf$/i, ''))
      setDrawing({ name: f.name, part })
      const names = layerNames([...typed.split(/\r?\n/), ...partLayerNames(part)])
      setTyped(names.join('\n'))
      setLayers(names)
    } catch (e) {
      toast.error(`Could not read ${f.name}`, { description: e instanceof Error ? e.message : String(e) })
    }
  }
  const close = (o: boolean) => {
    if (!o) {
      setStep(0)
      setA({ name: '', layers: [], outlineLayer: '', alignLongestEdge: false })
      setTyped('')
      setDrawing(null)
    }
    onOpenChange(o)
  }
  const finish = () => {
    const set = ruleSetFromWizard(a, lib)
    updateLibrary((l) => {
      l.recipes = l.recipes ?? structuredClone(BUILTIN_RECIPES)
      l.layerRules = [...(l.layerRules ?? structuredClone(BUILTIN_RULESETS)), set]
    })
    toast.success(`Rule table "${set.name}" created`)
    onCreated(set.id)
    close(false)
  }
  const preview = step === 3 && drawing ? applyRules(drawing.part, ruleSetFromWizard(a, lib), recipes) : null

  return (
    <Wizard open={open} onOpenChange={close} title="New rule table" description="Which machining each layer of your drawings gets. You can change every rule later in this tab." steps={RULE_WIZARD_STEPS} step={step} onStep={setStep} problems={problems} onFinish={finish} finishLabel="Create rule table">
      {step === 0 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rw-name">Name</Label>
          <Input id="rw-name" autoFocus value={a.name} placeholder="e.g. Sign drawings from the office" onChange={(e) => setA({ ...a, name: e.target.value })} />
          <p className="text-xs text-muted-foreground">Batch part lists pick a rule table by this name in the rules column.</p>
        </div>
      )}
      {step === 1 && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="rw-layers">Layer names, one per line</Label>
          <Textarea
            id="rw-layers"
            rows={7}
            className="font-mono text-xs"
            value={typed}
            placeholder={'CUTOUT\nPOCKET_D8\nDRILL_5_12'}
            onChange={(e) => {
              setTyped(e.target.value)
              setLayers(e.target.value.split(/\r?\n/))
            }}
          />
          <label className="flex w-fit cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted/40">
            <FileUp className="size-3.5" /> {drawing ? `Read from ${drawing.name}` : 'Read the layers of a drawing (DXF)'}
            <input type="file" accept=".dxf" className="sr-only" onChange={(e) => void readDxf(e.target.files?.[0])} />
          </label>
        </div>
      )}
      {step === 2 && (
        <div className="flex flex-col gap-2 text-xs">
          <p className="text-muted-foreground">Each layer starts with what the shop’s first rule table does with that name. Depth from the name reads the last number (POCKET_D6.5 → 6.5 mm).</p>
          <div className="max-h-64 overflow-auto rounded-md border">
            <table className="w-full">
              <thead className="bg-muted/40 text-left text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Layer</th>
                  <th className="px-2 py-1.5 font-medium">Machining</th>
                  <th className="px-2 py-1.5 font-medium">Depth from name</th>
                </tr>
              </thead>
              <tbody>
                {a.layers.map((l, i) => {
                  const set = (patch: Partial<typeof l>) => setA({ ...a, layers: a.layers.map((x, k) => (k === i ? { ...x, ...patch } : x)) })
                  return (
                    <tr key={l.layer} className="border-t">
                      <td className="px-2 py-1 font-mono">{l.layer}</td>
                      <td className="px-2 py-1">
                        <Select value={l.recipeId ?? NONE} onValueChange={(v) => set(v === NONE ? { recipeId: null, where: undefined, side: undefined } : { recipeId: v, ...(v === suggestLayer(l.layer, lib).recipeId ? {} : { where: undefined, side: undefined }) })}>
                          <SelectTrigger className="h-7 w-60 text-xs" aria-label={`Machining for ${l.layer}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>Leave alone</SelectItem>
                            {recipes.map((r) => (
                              <SelectItem key={r.id} value={r.id}>
                                {r.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1">
                        <Switch checked={l.depthFromName} disabled={!l.recipeId} onCheckedChange={(v) => set({ depthFromName: v })} aria-label={`Depth from the name ${l.layer}`} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span>Outline (cut-out) layer</span>
            <Select value={a.outlineLayer || NONE} onValueChange={(v) => setA({ ...a, outlineLayer: v === NONE ? '' : v })}>
              <SelectTrigger className="h-7 w-48 text-xs" aria-label="Outline layer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Largest closed shape</SelectItem>
                {a.layers.map((l) => (
                  <SelectItem key={l.layer} value={l.layer}>
                    {l.layer}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2">
              <Switch checked={a.alignLongestEdge} onCheckedChange={(v) => setA({ ...a, alignLongestEdge: v })} /> Turn the drawing so its longest edge runs along X
            </label>
          </div>
        </div>
      )}
      {step === 3 && (
        <div className="flex flex-col gap-2 text-xs">
          <ul className="rounded-md border p-2.5">
            {ruleSetFromWizard(a, lib).rules.map((r) => (
              <li key={r.id}>
                <span className="font-mono">{r.layer}</span> → {recipes.find((x) => x.id === r.recipeId)?.name}
                {r.depthFromName ? ', depth from the name' : ''}
              </li>
            ))}
            {a.layers.filter((l) => !l.recipeId).map((l) => (
              <li key={l.layer} className="text-muted-foreground">
                <span className="font-mono">{l.layer}</span> → left alone
              </li>
            ))}
          </ul>
          {preview ? (
            <div className="rounded-md border p-2.5">
              <p className="font-medium">
                {drawing!.name}: {preview.part.ops.length} operation{preview.part.ops.length === 1 ? '' : 's'}
              </p>
              {preview.report.map((r, i) => (
                <p key={i} className="text-muted-foreground">
                  {r.layer}: {r.shapes} shape{r.shapes === 1 ? '' : 's'} → {r.label}
                  {r.depth !== undefined ? `, ${r.depth} mm deep from the layer name` : ''}
                </p>
              ))}
              {preview.unmatched.length > 0 && <p className="text-amber-800">No rule (not machined): {preview.unmatched.map((u) => `${u.layer} (${u.shapes})`).join(', ')}</p>}
            </div>
          ) : (
            <p className="text-muted-foreground">Read a drawing in step 2 to see what these rules make of it.</p>
          )}
        </div>
      )}
    </Wizard>
  )
}
