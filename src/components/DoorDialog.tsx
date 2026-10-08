import { DoorOpen, FileUp, TriangleAlert } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useStore } from '@/app/store'
import { buildDoor, DOOR_VARS, type DoorSpec, doorStylesOf, type HingeSide, parseDoorCsv, type PullKind } from '@/cam/doors'
import { recipesOf } from '@/cam/rules'
import type { CamPart } from '@/cam/types'
import { NumField, SelectField, TextField } from '@/components/fields'
import { PartThumb } from '@/components/PartList'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { formatLength } from '@/core/units'
import { cn } from '@/lib/utils'

const HINGES: { value: HingeSide; label: string }[] = [
  { value: 'left', label: 'Left (seen from the front)' },
  { value: 'right', label: 'Right' },
  { value: 'none', label: 'No hinges (drawer front)' },
]
const PULLS: { value: PullKind; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'knob', label: 'Knob (one hole)' },
  { value: '96', label: 'Pull 96 mm centres' },
  { value: '128', label: 'Pull 128 mm centres' },
  { value: '160', label: 'Pull 160 mm centres' },
]

const EXAMPLE_IN = `Name,Qty,Width,Height,Style,Material,Hinge,Pull,Pull at
Sink base L,1,14 7/8,30,Shaker 70,MDF18,left,128,top
Sink base R,1,14 7/8,30,Shaker 70,MDF18,right,128,top
Wall 30,2,14 7/8,30,Arched top,MDF18,left,knob,bottom
Pantry,2,17 7/8,84,Cathedral,MDF18,left,160,middle`
const EXAMPLE_MM = `Name,Qty,Width,Height,Style,Material,Hinge,Pull,Pull at
Sink base L,1,378,762,Shaker 70,MDF18,left,128,top
Sink base R,1,378,762,Shaker 70,MDF18,right,128,top
Wall 30,2,378,762,Arched top,MDF18,left,knob,bottom
Pantry,2,454,2134,Cathedral,MDF18,left,160,middle`

export function DoorDialog({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (o: boolean) => void; onCreate: (parts: CamPart[]) => void }) {
  const data = useStore((s) => s.data)
  const units = data?.settings.units ?? 'mm'
  const lib = data?.library
  const styles = lib ? doorStylesOf(lib) : []
  const recipes = lib ? recipesOf(lib) : []
  const materials = lib?.materials ?? []
  const firstMat = materials.find((m) => m.code.startsWith('MDF')) ?? materials[0]
  const [spec, setSpec] = useState<DoorSpec>(() => ({
    name: 'Door',
    styleId: 'ds-shaker',
    width: 381,
    height: 762,
    qty: 1,
    materialId: firstMat?.id ?? null,
    thickness: firstMat?.thickness ?? 19,
    hinge: 'left',
    pull: 'none',
    pullAt: 'top',
    values: {},
    grain: firstMat?.grain ? 'length' : 'none',
  }))
  const [csv, setCsv] = useState('')
  const [tab, setTab] = useState('one')
  const file = useRef<HTMLInputElement>(null)
  const style = styles.find((s) => s.id === spec.styleId) ?? styles[0]
  const built = useMemo(() => (style ? buildDoor(spec, style, recipes) : null), [spec, style, recipes])
  const list = useMemo(() => (csv.trim() ? parseDoorCsv(csv, { units, styles, materials, defaultStyleId: spec.styleId, defaultMaterialId: spec.materialId }) : null), [csv, units, styles, materials, spec.styleId, spec.materialId])
  const vals = { ...(style?.defaults ?? {}), ...spec.values }
  const set = (patch: Partial<DoorSpec>) => setSpec((s) => ({ ...s, ...patch }))
  const fmt = (n: number) => formatLength(n, units)

  const createOne = () => {
    if (!built) return
    onCreate([built.part])
    onOpenChange(false)
  }
  const createList = () => {
    if (!list) return
    onCreate(list.specs.map((s) => buildDoor(s, styles.find((x) => x.id === s.styleId)!, recipes).part))
    onOpenChange(false)
    setCsv('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DoorOpen className="size-4" /> Doors from a style
          </DialogTitle>
          <DialogDescription>Each door is a custom part rebuilt from its style variables. Hinge cups follow the Salice 110° pattern and are drilled after turning the door over.</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="one">One door</TabsTrigger>
            <TabsTrigger value="list">Door list (CSV)</TabsTrigger>
          </TabsList>
          <TabsContent value="one" className="mt-3">
            <div className="grid gap-4 md:grid-cols-[1fr_300px]">
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {styles.map((s) => {
                    const thumb = buildDoor({ ...spec, styleId: s.id, width: 300, height: 500, hinge: 'none', pull: 'none', values: {} }, s).part
                    return (
                      <button
                        key={s.id}
                        onClick={() => set({ styleId: s.id })}
                        aria-pressed={s.id === spec.styleId}
                        className={cn('flex flex-col items-center gap-1 rounded-lg border p-2 text-xs transition', s.id === spec.styleId ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-500' : 'hover:bg-muted/50')}
                      >
                        <PartThumb part={thumb} upright className="h-16 w-full" />
                        {s.name}
                      </button>
                    )
                  })}
                </div>
                <div className="flex min-h-56 items-center justify-center rounded-lg border bg-stone-50 p-3">{built && <PartThumb part={built.part} upright className="h-64 w-full" />}</div>
                {built && (
                  <p className="text-xs text-muted-foreground">
                    {fmt(spec.width)} wide × {fmt(spec.height)} high, seen from the front (cut lying with its height along X). {built.part.ops.length} operations:{' '}
                    {built.part.ops.map((o) => o.name).join(', ')}.
                  </p>
                )}
                {built?.warnings.map((w) => (
                  <div key={w} className="flex gap-1.5 text-xs text-amber-800">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {w}
                  </div>
                ))}
              </div>
              <div className="flex max-h-[60vh] flex-col gap-3 overflow-auto pr-1">
                <TextField label="Name" value={spec.name} onChange={(v) => set({ name: v })} />
                <div className="grid grid-cols-2 gap-2">
                  <NumField label="Width" value={spec.width} min={100} onChange={(v) => set({ width: v })} />
                  <NumField label="Height" value={spec.height} min={100} onChange={(v) => set({ height: v })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <NumField label="Quantity" suffix="" value={spec.qty} min={1} onChange={(v) => set({ qty: Math.max(1, Math.round(v)) })} />
                  <NumField label="Thickness" value={spec.thickness} min={6} onChange={(v) => set({ thickness: v })} />
                </div>
                <SelectField
                  label="Material"
                  value={spec.materialId ?? '__none__'}
                  options={[{ value: '__none__', label: 'Choose later' }, ...materials.map((m) => ({ value: m.id, label: `${m.code} · ${m.name}` }))]}
                  onChange={(v) => {
                    const m = materials.find((x) => x.id === v)
                    set({ materialId: m?.id ?? null, thickness: m?.thickness ?? spec.thickness, grain: m?.grain ? 'length' : 'none' })
                  }}
                />
                <SelectField label="Hinges" value={spec.hinge} options={HINGES} onChange={(v) => set({ hinge: v })} />
                <div className="grid grid-cols-2 gap-2">
                  <SelectField label="Pull" value={spec.pull} options={PULLS} onChange={(v) => set({ pull: v })} />
                  <SelectField
                    label="Pull at"
                    value={spec.pullAt}
                    options={[
                      { value: 'top', label: 'Top (base)' },
                      { value: 'bottom', label: 'Bottom (wall)' },
                      { value: 'middle', label: 'Middle (tall)' },
                    ]}
                    onChange={(v) => set({ pullAt: v })}
                  />
                </div>
                {style &&
                  Object.entries(DOOR_VARS)
                    .filter(([, d]) => d.kinds.includes(style.kind))
                    .map(([k, d]) => <NumField key={k} label={d.label} value={vals[k] ?? 0} min={0} onChange={(v) => set({ values: { ...spec.values, [k]: v } })} />)}
              </div>
            </div>
          </TabsContent>
          <TabsContent value="list" className="mt-3">
            <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => file.current?.click()}>
                    <FileUp /> Open CSV
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setCsv(units === 'in' ? EXAMPLE_IN : EXAMPLE_MM)}>
                    Fill in an example
                  </Button>
                  <input
                    ref={file}
                    type="file"
                    accept=".csv,.txt"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0]
                      if (f) setCsv(await f.text())
                      e.target.value = ''
                    }}
                  />
                </div>
                <Textarea className="min-h-64 font-mono text-xs" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="Name,Qty,Width,Height,Style,Material,Hinge,Pull,Pull at" aria-label="Door list CSV" />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Columns in any order. Width and height are in {units === 'in' ? 'inches (fractions like 14 7/8 work)' : 'millimetres'}. Style and material match by name or code; blank uses the style and material chosen on the One door tab. Extra
                  columns named stile, rail, rise, shoulder or recess override the style.
                </p>
              </div>
              <div className="flex min-h-0 flex-col gap-2">
                {!list ? (
                  <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Paste or open a door list to see it here.</div>
                ) : (
                  <>
                    <div className="max-h-72 overflow-auto rounded-lg border">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
                          <tr>
                            <th className="px-2 py-1.5 font-medium">Door</th>
                            <th className="px-2 py-1.5 font-medium">Qty</th>
                            <th className="px-2 py-1.5 font-medium">W × H</th>
                            <th className="px-2 py-1.5 font-medium">Style</th>
                            <th className="px-2 py-1.5 font-medium">Hinge</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {list.specs.map((s, i) => (
                            <tr key={i}>
                              <td className="px-2 py-1">{s.name}</td>
                              <td className="px-2 py-1 tabular-nums">{s.qty}</td>
                              <td className="px-2 py-1 tabular-nums">
                                {fmt(s.width)} × {fmt(s.height)}
                              </td>
                              <td className="px-2 py-1">{styles.find((x) => x.id === s.styleId)?.name}</td>
                              <td className="px-2 py-1">{s.hinge}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {list.errors.map((e, i) => (
                      <div key={i} className="flex gap-1.5 text-xs text-amber-800">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> Row {e.row}: {e.message}
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {tab === 'one' ? (
            <Button onClick={createOne} disabled={!built}>
              Add door{spec.qty > 1 ? ` × ${spec.qty}` : ''}
            </Button>
          ) : (
            <Button onClick={createList} disabled={!list?.specs.length}>
              Add {list?.specs.length ?? 0} door design{list?.specs.length === 1 ? '' : 's'} ({list?.specs.reduce((n, s) => n + s.qty, 0) ?? 0} doors)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
