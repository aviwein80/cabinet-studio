import { BadgeCheck, FileSearch, Loader2, Plus, Trash2, TriangleAlert, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { backend } from '@/app/backend'
import { loadSpecSource, readyProvider, SPEC_ACCEPT } from '@/app/specSource'
import { useStore } from '@/app/store'
import type { CamPart } from '@/cam/types'
import { LenInput } from '@/components/LenInput'
import { PartThumb } from '@/components/PartList'
import { CiteChip, type MarkedCite, SourceViewer } from '@/components/SourceViewer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { blank, type Cite, type CNum } from '@/core/spec/cite'
import { aiPartDrafter, approvePartSpec, EDGES, matchPattern, partFromSpec, type PartSpec, type SpecEdge, type SpecSource, specIssues, textPartDrafter } from '@/core/spec/partSpec'
import { usablePatterns } from '@/core/hardware/patterns'
import type { UnitSystem } from '@/core/types'
import { cn } from '@/lib/utils'

type Phase = { k: 'pick' } | { k: 'reading'; file: string; by: string } | { k: 'review'; src: SpecSource; spec: PartSpec }

/**
 * Draft a custom part from a customer's spec or drawing (PDF, scan or photo). The draft is held
 * here only: it is saved, as an approved part, when a named person ticks that they checked it.
 */
export function PartDraftDialog({ open, onOpenChange, onApproved }: { open: boolean; onOpenChange: (o: boolean) => void; onApproved: (p: CamPart) => void }) {
  const data = useStore((s) => s.data)!
  const [phase, setPhase] = useState<Phase>({ k: 'pick' })
  const file = useRef<HTMLInputElement>(null)
  const close = (o: boolean) => {
    if (!o) setPhase({ k: 'pick' })
    onOpenChange(o)
  }

  const read = async (f: File) => {
    try {
      const ai = await readyProvider(data.settings)
      setPhase({ k: 'reading', file: f.name, by: ai?.label ?? textPartDrafter.label })
      const src = await loadSpecSource(f)
      let spec: PartSpec | null = null
      if (ai) {
        try {
          spec = await aiPartDrafter(ai.provider, ai.model, backend.ai.call).draft(src, data.library)
        } catch (e) {
          toast.error(`${ai.label}: ${e instanceof Error ? e.message : String(e)}. Using the offline reader instead.`)
        }
      }
      spec ??= await textPartDrafter.draft(src, data.library)
      setPhase({ k: 'review', src, spec })
    } catch (e) {
      toast.error(`Could not read ${f.name}: ${e instanceof Error ? e.message : String(e)}`)
      setPhase({ k: 'pick' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className={cn('max-h-[94vh] overflow-y-auto', phase.k === 'review' ? 'sm:max-w-[min(96vw,1440px)]' : 'sm:max-w-lg')}>
        {phase.k !== 'review' ? (
          <>
            <DialogHeader>
              <DialogTitle>Draft a part from a customer drawing</DialogTitle>
              <DialogDescription>A spec sheet, drawing, scan or photo of one piece, such as a sliding door or a shaped panel. The reader drafts the outline, sizes, edges, grooves, holes and hardware; you check every value before it is saved.</DialogDescription>
            </DialogHeader>
            <input ref={file} type="file" accept={SPEC_ACCEPT} className="hidden" onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void read(f)
                e.target.value = ''
              }} />
            {phase.k === 'reading' ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center text-sm" role="status">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
                Reading {phase.file}
                <span className="text-xs text-muted-foreground">with {phase.by}</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => file.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const f = e.dataTransfer.files?.[0]
                  if (f) void read(f)
                }}
                className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center text-sm transition-colors hover:bg-muted/50"
              >
                <Upload className="size-5 text-muted-foreground" />
                <span className="font-medium">Choose or drop a file</span>
                <span className="text-xs text-muted-foreground">PDF, PNG, JPG or WebP</span>
              </button>
            )}
            <ReaderNote />
          </>
        ) : (
          <Review src={phase.src} initial={phase.spec} units={data.settings.units} onCancel={() => close(false)} onApproved={(p) => {
              onApproved(p)
              close(false)
            }} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ReaderNote() {
  const settings = useStore((s) => s.data!.settings)
  const [ready, setReady] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    void readyProvider(settings).then((r) => live && setReady(r?.label ?? null))
    return () => {
      live = false
    }
  }, [settings])
  return (
    <p className="text-xs text-muted-foreground">
      {ready === undefined ? 'Checking the reader…' : ready ? `Reader: ${ready} (set in Settings). Page images are sent to that provider.` : 'Reader: offline. It fills in sizes printed as text; scans and photos need an AI provider and key in Settings.'}
    </p>
  )
}

const FACE_LABEL = { top: 'Top face', underside: 'Underside', edge: 'In an edge' } as const

function Review({ src, initial, units, onCancel, onApproved }: { src: SpecSource; initial: PartSpec; units: UnitSystem; onCancel: () => void; onApproved: (p: CamPart) => void }) {
  const data = useStore((s) => s.data)!
  const lib = data.library
  const [spec, setSpec] = useState(initial)
  const [focus, setFocus] = useState<string | null>(null)
  const [reviewer, setReviewer] = useState('')
  const [checked, setChecked] = useState(false)
  const upd = (fn: (s: PartSpec) => void) => {
    const next = structuredClone(spec)
    fn(next)
    setSpec(next)
    setChecked(false)
  }
  const preview = useMemo(() => partFromSpec(spec, lib, data.machine), [spec, lib, data.machine])
  const issues = specIssues(spec, lib)
  const patterns = usablePatterns(lib)

  const marks: MarkedCite[] = []
  const mark = (key: string, c?: Cite) => c && marks.push({ key, cite: c })
  mark('length', spec.length.cite)
  mark('width', spec.width.cite)
  mark('thickness', spec.thickness.cite)
  mark('qty', spec.qty.cite)
  mark('mat', spec.material.cite)
  mark('radius', spec.outline.radius.cite)
  mark('rise', spec.outline.rise.cite)
  spec.edges.forEach((e, i) => mark(`e${i}`, e.cite))
  spec.grooves.forEach((g, i) => (['x0', 'y0', 'x1', 'y1', 'width', 'depth'] as const).forEach((k) => mark(`g${i}.${k}`, g[k].cite)))
  spec.holes.forEach((h, i) => (['x', 'y', 'diameter', 'depth'] as const).forEach((k) => mark(`h${i}.${k}`, h[k].cite)))
  spec.cutouts.forEach((c, i) => (['x', 'y', 'w', 'h', 'r', 'depth'] as const).forEach((k) => mark(`c${i}.${k}`, c[k].cite)))
  spec.hardware.forEach((h, i) => {
    mark(`hw${i}`, h.cite)
    h.at.forEach((a, j) => mark(`hw${i}.at${j}`, a.cite))
  })

  const approve = () => {
    const r = approvePartSpec(spec, lib, { reviewer, checked }, new Date(), data.machine)
    if (!r.part) return toast.error(r.errors[0])
    onApproved(r.part)
    toast.success(`Saved “${r.part.name}”, checked by ${reviewer.trim()}`, { description: r.warnings.length ? `${r.warnings.length} note(s) to follow up in the designer.` : 'Opening it in the part designer.' })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          Review drafted part <Badge className="bg-amber-500/20 text-amber-800 dark:text-amber-200">Draft · not saved</Badge>
        </DialogTitle>
        <DialogDescription>
          Drafted by {spec.drafter} from {spec.file}. Check every value against the page on the left; blank cells were not in the source and must be filled in. Nothing is saved, added to a job or nested until you approve it.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <SourceViewer file={src.file} images={src.images} marks={marks} focus={focus} onFocus={setFocus} className="h-[42vh] lg:sticky lg:top-0 lg:h-[74vh]" />
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="flex aspect-[4/3] items-center justify-center rounded-md border bg-stone-50 p-2">
              <PartThumb part={preview.part} className="h-full w-full" />
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="col-span-2 flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Part name</Label>
                <Input className="h-8" value={spec.name} onChange={(e) => upd((s) => void (s.name = e.target.value))} aria-label="Part name" />
              </div>
              <div className="col-span-2 flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Material{spec.material.text ? ` (drawing says “${spec.material.text}”)` : ''}</Label>
                <div className="flex items-center gap-2">
                  <Select value={spec.material.materialId ?? 'none'} onValueChange={(v) => upd((s) => void (s.material.materialId = v === 'none' ? null : v))}>
                    <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="Material">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not chosen</SelectItem>
                      {lib.materials.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.code} · {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <CiteChip cite={spec.material.cite} active={focus === 'mat'} onClick={() => setFocus('mat')} />
                </div>
              </div>
              <Field label="Length (x)">
                <Val units={units} focus={focus} onFocus={setFocus} k="length" label="Length" c={spec.length} set={(v) => upd((s) => void (s.length = { ...s.length, v }))} />
              </Field>
              <Field label="Width (y)">
                <Val units={units} focus={focus} onFocus={setFocus} k="width" label="Width" c={spec.width} set={(v) => upd((s) => void (s.width = { ...s.width, v }))} />
              </Field>
              <Field label="Thickness">
                <Val units={units} focus={focus} onFocus={setFocus} k="thickness" label="Thickness" c={spec.thickness} set={(v) => upd((s) => void (s.thickness = { ...s.thickness, v }))} />
              </Field>
              <Field label="Quantity">
                <Val units={units} focus={focus} onFocus={setFocus} k="qty" label="Quantity" plain c={spec.qty} set={(v) => upd((s) => void (s.qty = { ...s.qty, v }))} />
              </Field>
            </div>
          </div>

          <Section title="Outline">
            <div className="flex flex-wrap items-start gap-3 text-xs">
              <Select value={spec.outline.shape} onValueChange={(v) => upd((s) => void (s.outline.shape = v as PartSpec['outline']['shape']))}>
                <SelectTrigger size="sm" className="w-40" aria-label="Outline shape">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rect">Square corners</SelectItem>
                  <SelectItem value="rounded">Rounded corners</SelectItem>
                  <SelectItem value="arch">Arched top</SelectItem>
                  <SelectItem value="polygon">Polygon</SelectItem>
                </SelectContent>
              </Select>
              {spec.outline.shape === 'rounded' && (
                <Field label="Corner radius">
                  <Val units={units} focus={focus} onFocus={setFocus} k="radius" label="Corner radius" c={spec.outline.radius} set={(v) => upd((s) => void (s.outline.radius = { ...s.outline.radius, v }))} />
                </Field>
              )}
              {spec.outline.shape === 'arch' && (
                <Field label="Arch rise">
                  <Val units={units} focus={focus} onFocus={setFocus} k="rise" label="Arch rise" c={spec.outline.rise} set={(v) => upd((s) => void (s.outline.rise = { ...s.outline.rise, v }))} />
                </Field>
              )}
              {spec.outline.shape === 'polygon' && <span className="text-muted-foreground">{spec.outline.points.length} corners from the drawing; edit them in the designer after approval.</span>}
            </div>
          </Section>

          <Section title="Edges" onAdd={() => upd((s) => void s.edges.push({ edge: EDGES.find((e) => !s.edges.some((x) => x.edge === e)) ?? 'bottom', profile: '' }))} addLabel="Edge">
            {spec.edges.length === 0 && <Empty>No edge treatment on the drawing.</Empty>}
            {spec.edges.map((e, i) => (
              <Row key={i} onRemove={() => upd((s) => void s.edges.splice(i, 1))} label={`edge ${i + 1}`}>
                <EdgeSelect value={e.edge} onChange={(v) => upd((s) => void (s.edges[i].edge = v))} />
                <Input className="h-7 min-w-0 flex-1 text-xs" value={e.profile} aria-label={`Edge ${i + 1} profile`} placeholder="e.g. 2 mm ABS band, R3 round-over" onChange={(ev) => upd((s) => void (s.edges[i].profile = ev.target.value))} />
                <CiteChip cite={e.cite} active={focus === `e${i}`} onClick={() => setFocus(`e${i}`)} />
              </Row>
            ))}
          </Section>

          <Section
            title="Grooves and dados"
            onAdd={() => upd((s) => void s.grooves.push({ label: `Groove ${s.grooves.length + 1}`, face: 'top', x0: blank(), y0: blank(), x1: blank(), y1: blank(), width: blank(), depth: blank() }))}
            addLabel="Groove"
          >
            {spec.grooves.length === 0 && <Empty>None drafted.</Empty>}
            {spec.grooves.map((g, i) => (
              <Row key={i} onRemove={() => upd((s) => void s.grooves.splice(i, 1))} label={g.label}>
                <Input className="h-7 w-44 text-xs" value={g.label} aria-label={`Groove ${i + 1} name`} onChange={(ev) => upd((s) => void (s.grooves[i].label = ev.target.value))} />
                <Select value={g.face} onValueChange={(v) => upd((s) => void Object.assign(s.grooves[i], { face: v, edge: v === 'edge' ? (s.grooves[i].edge ?? 'bottom') : undefined }))}>
                  <SelectTrigger size="sm" className="h-7 w-28 text-xs" aria-label={`${g.label} face`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(FACE_LABEL) as (keyof typeof FACE_LABEL)[]).map((f) => (
                      <SelectItem key={f} value={f}>
                        {FACE_LABEL[f]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {g.face === 'edge' && <EdgeSelect value={g.edge ?? 'bottom'} onChange={(v) => upd((s) => void (s.grooves[i].edge = v))} />}
                {(g.face === 'edge' ? (['x0', 'x1', 'y0', 'width', 'depth'] as const) : (['x0', 'y0', 'x1', 'y1', 'width', 'depth'] as const)).map((k) => (
                  <Field key={k} label={g.face === 'edge' ? { x0: 'From', x1: 'To', y0: 'Below top', width: 'Width', depth: 'Depth', y1: '' }[k] : { x0: 'Start x', y0: 'Start y', x1: 'End x', y1: 'End y', width: 'Width', depth: 'Depth' }[k]}>
                    <Val units={units} focus={focus} onFocus={setFocus} k={`g${i}.${k}`} label={`${g.label} ${k}`} c={g[k]} set={(v) => upd((s) => void (s.grooves[i][k] = { ...s.grooves[i][k], v }))} />
                  </Field>
                ))}
              </Row>
            ))}
          </Section>

          <Section title="Holes" onAdd={() => upd((s) => void s.holes.push({ face: 'top', x: blank(), y: blank(), diameter: blank(), depth: blank(), through: false }))} addLabel="Hole">
            {spec.holes.length === 0 && <Empty>None drafted.</Empty>}
            {spec.holes.map((h, i) => (
              <Row key={i} onRemove={() => upd((s) => void s.holes.splice(i, 1))} label={`hole ${i + 1}`}>
                <span className="w-6 pt-1.5 text-xs text-muted-foreground">{i + 1}</span>
                <Select value={h.face} onValueChange={(v) => upd((s) => void (s.holes[i].face = v as 'top' | 'underside'))}>
                  <SelectTrigger size="sm" className="h-7 w-28 text-xs" aria-label={`Hole ${i + 1} face`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="top">Top face</SelectItem>
                    <SelectItem value="underside">Underside</SelectItem>
                  </SelectContent>
                </Select>
                {(['x', 'y', 'diameter'] as const).map((k) => (
                  <Field key={k} label={{ x: 'x', y: 'y', diameter: 'Diameter' }[k]}>
                    <Val units={units} focus={focus} onFocus={setFocus} k={`h${i}.${k}`} label={`Hole ${i + 1} ${k}`} c={h[k]} set={(v) => upd((s) => void (s.holes[i][k] = { ...s.holes[i][k], v }))} />
                  </Field>
                ))}
                {!h.through && (
                  <Field label="Depth">
                    <Val units={units} focus={focus} onFocus={setFocus} k={`h${i}.depth`} label={`Hole ${i + 1} depth`} c={h.depth} set={(v) => upd((s) => void (s.holes[i].depth = { ...s.holes[i].depth, v }))} />
                  </Field>
                )}
                <label className="flex items-center gap-1.5 pt-1.5 text-xs">
                  <Checkbox checked={h.through} onCheckedChange={(v) => upd((s) => void (s.holes[i].through = v === true))} /> Through
                </label>
              </Row>
            ))}
          </Section>

          <Section title="Cut-outs and recesses" onAdd={() => upd((s) => void s.cutouts.push({ label: `Cut-out ${s.cutouts.length + 1}`, shape: 'rect', x: blank(), y: blank(), w: blank(), h: blank(), r: blank(), depth: blank(), through: true }))} addLabel="Cut-out">
            {spec.cutouts.length === 0 && <Empty>None drafted.</Empty>}
            {spec.cutouts.map((c, i) => (
              <Row key={i} onRemove={() => upd((s) => void s.cutouts.splice(i, 1))} label={c.label}>
                <Input className="h-7 w-36 text-xs" value={c.label} aria-label={`Cut-out ${i + 1} name`} onChange={(ev) => upd((s) => void (s.cutouts[i].label = ev.target.value))} />
                <Select value={c.shape} onValueChange={(v) => upd((s) => void (s.cutouts[i].shape = v as 'rect' | 'circle'))}>
                  <SelectTrigger size="sm" className="h-7 w-24 text-xs" aria-label={`${c.label} shape`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rect">Rectangle</SelectItem>
                    <SelectItem value="circle">Circle</SelectItem>
                  </SelectContent>
                </Select>
                {(c.shape === 'circle' ? (['x', 'y', 'w'] as const) : (['x', 'y', 'w', 'h', 'r'] as const)).map((k) => (
                  <Field key={k} label={{ x: 'Centre x', y: 'Centre y', w: c.shape === 'circle' ? 'Diameter' : 'Width', h: 'Height', r: 'Corner R' }[k]}>
                    <Val units={units} focus={focus} onFocus={setFocus} k={`c${i}.${k}`} label={`${c.label} ${k}`} c={c[k]} optional={k === 'r'} set={(v) => upd((s) => void (s.cutouts[i][k] = { ...s.cutouts[i][k], v }))} />
                  </Field>
                ))}
                {!c.through && (
                  <Field label="Depth">
                    <Val units={units} focus={focus} onFocus={setFocus} k={`c${i}.depth`} label={`${c.label} depth`} c={c.depth} set={(v) => upd((s) => void (s.cutouts[i].depth = { ...s.cutouts[i].depth, v }))} />
                  </Field>
                )}
                <label className="flex items-center gap-1.5 pt-1.5 text-xs">
                  <Checkbox checked={c.through} onCheckedChange={(v) => upd((s) => void (s.cutouts[i].through = v === true))} /> Through
                </label>
              </Row>
            ))}
          </Section>

          <Section title="Hardware bored into this piece" onAdd={patterns.length ? () => upd((s) => void s.hardware.push({ name: patterns[0].name, code: '', edge: 'bottom', at: [blank()], mirror: false })) : undefined} addLabel="Fitting">
            {spec.hardware.length === 0 && <Empty>None drafted.</Empty>}
            {spec.hardware.map((h, i) => {
              const pat = matchPattern(lib, h)
              return (
                <Row key={i} onRemove={() => upd((s) => void s.hardware.splice(i, 1))} label={h.name || h.code}>
                  <div className="flex min-w-40 flex-col gap-0.5">
                    <Select value={pat?.id ?? 'none'} onValueChange={(v) => upd((s) => void Object.assign(s.hardware[i], { name: patterns.find((p) => p.id === v)?.name ?? s.hardware[i].name, code: '' }))}>
                      <SelectTrigger size="sm" className={cn('h-7 w-56 text-xs', !pat && 'border-destructive')} aria-label={`${h.name || h.code} pattern`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none" disabled>
                          {h.code || h.name || 'Fitting'}: no approved pattern
                        </SelectItem>
                        {patterns.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <CiteChip cite={h.cite} active={focus === `hw${i}`} onClick={() => setFocus(`hw${i}`)} />
                  </div>
                  <EdgeSelect value={h.edge} onChange={(v) => upd((s) => void (s.hardware[i].edge = v))} />
                  {h.at.map((a, j) => (
                    <Field key={j} label={`At ${j + 1}`}>
                      <Val units={units} focus={focus} onFocus={setFocus} k={`hw${i}.at${j}`} label={`${h.name || h.code} position ${j + 1}`} c={a} set={(v) => upd((s) => void (s.hardware[i].at[j] = { ...s.hardware[i].at[j], v }))} />
                    </Field>
                  ))}
                  <Button size="sm" variant="ghost" className="mt-0.5 h-7 px-2 text-xs" onClick={() => upd((s) => void s.hardware[i].at.push(blank()))}>
                    <Plus className="size-3" /> Position
                  </Button>
                </Row>
              )
            })}
          </Section>

          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Notes</Label>
            <Textarea rows={2} value={spec.notes} onChange={(e) => upd((s) => void (s.notes = e.target.value))} />
          </div>
        </div>
      </div>

      {(spec.warnings.length > 0 || preview.warnings.length > 0 || issues.length > 0) && (
        <div className="grid gap-2 md:grid-cols-2">
          {issues.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
              <div className="mb-1 flex items-center gap-1.5 font-medium text-destructive">
                <TriangleAlert className="size-3.5" /> {issues.length} to fix before approving
              </div>
              <ul className="max-h-32 list-disc space-y-0.5 overflow-y-auto pl-4">
                {issues.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {(spec.warnings.length > 0 || preview.warnings.length > 0) && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
              <div className="mb-1 flex items-center gap-1.5 font-medium">
                <FileSearch className="size-3.5" /> Notes from the reader (as first read)
              </div>
              <ul className="max-h-32 list-disc space-y-0.5 overflow-y-auto pl-4">
                {[...spec.warnings, ...preview.warnings].map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
        <Label htmlFor="part-reviewer" className="text-xs">
          Checked by
        </Label>
        <Input id="part-reviewer" className="h-8 w-48" value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Your name" />
        <label className="flex items-center gap-2 text-xs">
          <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} /> I checked every value against the customer’s drawing
        </label>
        <span className="text-[11px] text-muted-foreground">Any change clears the tick.</span>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          Discard draft
        </Button>
        <Button disabled={issues.length > 0 || !reviewer.trim() || !checked} onClick={approve} className="gap-1.5">
          <BadgeCheck className="size-4" /> Approve, save and open
        </Button>
      </DialogFooter>
    </>
  )
}

function Val({ k, c, set, label, plain, optional, units, focus, onFocus }: { k: string; c: CNum; set: (v: number) => void; label: string; plain?: boolean; optional?: boolean; units: UnitSystem; focus: string | null; onFocus: (k: string) => void }) {
  return (
    <div className="flex flex-col items-start gap-0.5">
      <LenInput label={label} value={c.v} units={units} plain={plain} optional={optional} onChange={set} />
      <CiteChip cite={c.cite} active={focus === k} onClick={() => onFocus(k)} />
    </div>
  )
}

function Section({ title, children, onAdd, addLabel }: { title: string; children: React.ReactNode; onAdd?: () => void; addLabel?: string }) {
  return (
    <section className="rounded-md border">
      <div className="flex items-center justify-between border-b bg-muted/40 px-2.5 py-1.5">
        <h4 className="text-xs font-medium">{title}</h4>
        {onAdd && (
          <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-xs" onClick={onAdd}>
            <Plus className="size-3" /> {addLabel}
          </Button>
        )}
      </div>
      <div className="flex flex-col divide-y">{children}</div>
    </section>
  )
}

function Row({ children, onRemove, label }: { children: React.ReactNode; onRemove: () => void; label: string }) {
  return (
    <div className="flex flex-wrap items-start gap-2 px-2.5 py-2">
      {children}
      <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label={`Remove ${label}`} onClick={onRemove}>
        <Trash2 />
      </Button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-2.5 py-2 text-xs text-muted-foreground">{children}</p>
}

function EdgeSelect({ value, onChange }: { value: SpecEdge; onChange: (v: SpecEdge) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SpecEdge)}>
      <SelectTrigger size="sm" className="h-7 w-24 text-xs capitalize" aria-label="Edge">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {EDGES.map((e) => (
          <SelectItem key={e} value={e} className="capitalize">
            {e} edge
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
