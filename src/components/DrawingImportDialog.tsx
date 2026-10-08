import { FileUp, Loader2, TriangleAlert, Wand2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useStore } from '@/app/store'
import { DEFAULT_DXF_OPTIONS, type DxfImportOptions, importDxf, importedPart } from '@/cam/dxf'
import { loadPdfLib, pdfVectors } from '@/cam/pdfVectors'
import { applyRules, recipesOf, ruleSetsOf } from '@/cam/rules'
import type { CamPart } from '@/cam/types'
import { NumField, SelectField, SwitchField } from '@/components/fields'
import { PartThumb } from '@/components/PartList'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { featuresOf } from '@/core/features'
import type { Material, UnitSystem } from '@/core/types'
import { formatLength } from '@/core/units'
import { fmt } from '@/core/geometry'

interface Loaded {
  name: string
  kind: 'dxf' | 'pdf'
  text?: string
  bytes?: Uint8Array
}

interface Preview {
  part: CamPart
  warnings: string[]
  summary: string
  layers: string[]
}

export function DrawingImportDialog({ open, onOpenChange, units, materials, onImport }: { open: boolean; onOpenChange: (v: boolean) => void; units: UnitSystem; materials: Material[]; onImport: (p: CamPart) => void }) {
  const file = useRef<HTMLInputElement>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [opts, setOpts] = useState<DxfImportOptions>(DEFAULT_DXF_OPTIONS)
  const [outlineLayer, setOutlineLayer] = useState('')
  const [thickness, setThickness] = useState(19)
  const [materialId, setMaterialId] = useState<string>('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lib = useStore((st) => st.data?.library)
  const rulesOn = useStore((st) => featuresOf(st.data?.settings).camRules && featuresOf(st.data?.settings).camMachining)
  const sets = lib ? ruleSetsOf(lib) : []
  const [ruleSetId, setRuleSetId] = useState<string>('__default__')
  const chosenSet = rulesOn ? (ruleSetId === '__default__' ? sets[0] : sets.find((x) => x.id === ruleSetId)) : undefined
  const applied = useMemo(() => (preview && chosenSet && lib ? applyRules(preview.part, chosenSet, recipesOf(lib)) : null), [preview, chosenSet, lib])

  const build = async (l: Loaded, o: DxfImportOptions, outline: string, t: number) => {
    setBusy(true)
    setError('')
    try {
      const name = l.name.replace(/\.(dxf|pdf|ai)$/i, '')
      if (l.kind === 'dxf') {
        const r = importDxf(l.text!, o)
        const { part, warnings } = importedPart(name, r.entities, r.layers, `DXF: ${l.name}`, { outlineLayer: outline || undefined, thickness: t })
        setPreview({
          part,
          warnings: [...r.warnings, ...warnings],
          summary: `${r.counts.read} pieces read in ${r.unitName} → ${r.counts.closed} closed shapes, ${r.counts.open} open paths, ${r.counts.circles} circles`,
          layers: r.layers.map((x) => x.name),
        })
      } else {
        const v = await pdfVectors(await loadPdfLib(), l.bytes!.slice())
        const { part, warnings } = importedPart(name, v.entities, v.layers, `PDF: ${l.name}`, { outlineLayer: outline || undefined, thickness: t })
        setPreview({ part, warnings: [...v.warnings, ...warnings], summary: `${v.entities.length} paths from ${v.pages} page${v.pages === 1 ? '' : 's'} (curves re-fitted to lines and arcs)`, layers: v.layers.map((x) => x.name) })
      }
    } catch (e) {
      setPreview(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const pick = async (f: File) => {
    const ext = f.name.split('.').pop()?.toLowerCase()
    setPreview(null)
    if (ext === 'dwg') {
      setLoaded(null)
      setError('DWG files need a licensed DWG reader that is not included yet. Save the drawing as DXF from your CAD program and import that.')
      return
    }
    const l: Loaded = ext === 'pdf' || ext === 'ai' ? { name: f.name, kind: 'pdf', bytes: new Uint8Array(await f.arrayBuffer()) } : { name: f.name, kind: 'dxf', text: await f.text() }
    setLoaded(l)
    void build(l, opts, outlineLayer, thickness)
  }

  const update = (o: DxfImportOptions, outline = outlineLayer, t = thickness) => {
    setOpts(o)
    if (loaded) void build(loaded, o, outline, t)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Polish-1: never taller than the window; the body scrolls and the footer stays in view */}
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>Import a drawing</DialogTitle>
          <DialogDescription>DXF from any CAD program, or vector PDF / Illustrator files. The largest closed shape becomes the part outline; each drawing layer is kept.</DialogDescription>
        </DialogHeader>
        <div className="-mx-1 grid min-h-0 flex-1 gap-4 overflow-y-auto px-1 md:grid-cols-[1fr_260px]" data-testid="drawing-import-body">
          <div className="flex min-h-64 flex-col gap-2">
            <button onClick={() => file.current?.click()} className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-stone-50 p-3 text-sm text-muted-foreground hover:bg-stone-100" aria-label="Choose a drawing file">
              {busy ? (
                <Loader2 className="size-5 animate-spin" />
              ) : preview ? (
                <PartThumb part={preview.part} className="h-56 w-full" />
              ) : (
                <>
                  <FileUp className="size-6" />
                  Choose a .dxf, .pdf or .ai file
                </>
              )}
            </button>
            <input
              ref={file}
              type="file"
              accept=".dxf,.pdf,.ai,.dwg"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void pick(f)
                e.target.value = ''
              }}
            />
            {loaded && <div className="truncate text-xs font-medium">{loaded.name}</div>}
            {preview && (
              <div className="text-xs text-muted-foreground">
                {preview.summary}. Part {formatLength(preview.part.length, units)} × {formatLength(preview.part.width, units)}.
              </div>
            )}
            {preview && preview.layers.length > 0 && <div className="text-[11px] text-muted-foreground">Layers: {preview.layers.join(', ')}</div>}
            {error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">{error}</div>}
            {applied && (
              <div className="rounded-md border bg-stone-50 p-2 text-xs">
                <div className="mb-1 flex items-center gap-1.5 font-medium">
                  <Wand2 className="size-3.5" /> {applied.part.ops.length} operation{applied.part.ops.length === 1 ? '' : 's'} from “{chosenSet?.name}”
                </div>
                <ul className="flex flex-col gap-0.5 text-muted-foreground">
                  {applied.report.map((r) => (
                    <li key={r.ruleId + r.layer}>
                      <span className="font-mono text-foreground">{r.layer}</span> → {r.label}
                      {r.depth !== undefined && `, ${formatLength(r.depth, units)}${units === 'in' ? ` (${fmt(r.depth)} mm)` : ''} deep from the layer name`} ({r.shapes} shape{r.shapes === 1 ? '' : 's'})
                    </li>
                  ))}
                  {applied.unmatched.map((u) => (
                    <li key={u.layer} className="text-amber-800">
                      <span className="font-mono">{u.layer}</span>: no rule, {u.shapes} shape{u.shapes === 1 ? '' : 's'} left unmachined
                    </li>
                  ))}
                  {applied.missingRecipes.map((m) => (
                    <li key={m} className="text-red-700">
                      A rule points at a deleted recipe ({m}).
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {preview?.warnings.map((w, i) => (
              <div key={i} className="flex gap-1.5 text-xs text-amber-800">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {w}
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-3">
            <SelectField
              label="Drawing units"
              value={opts.units}
              options={[
                { value: 'auto', label: 'From the file' },
                { value: 'mm', label: 'Millimetres' },
                { value: 'in', label: 'Inches' },
                { value: 'cm', label: 'Centimetres' },
                { value: 'm', label: 'Metres' },
              ]}
              onChange={(v) => update({ ...opts, units: v })}
              hint={loaded?.kind === 'pdf' ? 'PDF pages are always read at true size.' : undefined}
            />
            <NumField label="Join ends closer than" value={opts.joinTol} min={0} step={0.01} onChange={(v) => update({ ...opts, joinTol: v })} />
            <SwitchField label="Join only where tangent" checked={opts.tangentOnly} onChange={(v) => update({ ...opts, tangentOnly: v })} hint="Keeps pieces that meet at a sharp corner apart" />
            <SwitchField label="Combine straight runs and arcs" checked={opts.combine} onChange={(v) => update({ ...opts, combine: v })} hint="Collinear lines and pieces of one circle become single elements" />
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Outline layer (optional)</Label>
              <Input
                className="h-8"
                value={outlineLayer}
                placeholder={preview?.layers[0] ?? 'Largest closed shape'}
                onChange={(e) => setOutlineLayer(e.target.value)}
                onBlur={() => update(opts, outlineLayer, thickness)}
                list="import-layers"
              />
              <datalist id="import-layers">
                {preview?.layers.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </div>
            <SelectField
              label="Material"
              value={materialId || '__none__'}
              options={[{ value: '__none__', label: 'Choose later' }, ...materials.map((m) => ({ value: m.id, label: `${m.code} · ${m.name}` }))]}
              onChange={(v) => {
                const m = materials.find((x) => x.id === v)
                setMaterialId(v === '__none__' ? '' : v)
                if (m) {
                  setThickness(m.thickness)
                  update(opts, outlineLayer, m.thickness)
                }
              }}
            />
            <NumField label="Thickness" value={thickness} min={1} onChange={(v) => (setThickness(v), update(opts, outlineLayer, v))} />
            {rulesOn && (
              <SelectField
                label="Machining rules"
                value={ruleSetId}
                options={[{ value: '__default__', label: sets[0] ? `${sets[0].name}` : 'Default' }, ...sets.slice(1).map((x) => ({ value: x.id, label: x.name })), { value: '__none__', label: 'None: machine by hand' }]}
                onChange={setRuleSetId}
                hint="Layer names pick the operations. Edit the table under Library → Machining rules."
              />
            )}
          </div>
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!preview || busy}
            onClick={() => {
              if (!preview) return
              const m = materials.find((x) => x.id === materialId)
              const base = applied ? applied.part : preview.part
              onImport({ ...base, materialId: materialId || null, grain: m ? (m.grain ? 'length' : 'none') : base.grain })
              onOpenChange(false)
              setPreview(null)
              setLoaded(null)
            }}
          >
            Create part
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
