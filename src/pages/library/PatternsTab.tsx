import { BadgeCheck, CircleSlash, Copy, Eye, FileText, FileUp, Plus, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/app/store'
import type { FaceId, HardwarePattern, PatternHole } from '@/cam/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { type Cite, type ItemDraft, type PatternDraft, patternFromDxf, patternsFromCsv, textDrafter } from '@/core/hardware/patternImport'
import { backend } from '@/app/backend'
import { loadSpecSource, readyProvider, SPEC_ACCEPT } from '@/app/specSource'
import { patternIssues, patternsOf, withdrawPattern } from '@/core/hardware/patterns'
import { aiDrafter, approveHardwareDraft, HW_CATEGORIES, type HoleCites, type HoleKey, ITEM_FIELDS, itemIssues } from '@/core/spec/hardwareSpec'
import type { Hardware, HardwareCategory, UnitSystem } from '@/core/types'
import { formatLength, toolSize } from '@/core/units'
import { LenInput } from '@/components/LenInput'
import { CiteChip, type MarkedCite, SourceViewer } from '@/components/SourceViewer'
import { cn } from '@/lib/utils'

const FACES: { value: FaceId; label: string }[] = [
  { value: 1, label: 'Top face' },
  { value: 6, label: 'Underside' },
  { value: 2, label: 'Into the edge' },
]

const SOURCE: Record<HardwarePattern['source'], string> = { library: 'Built-in', dxf: 'DXF', csv: 'CSV', 'pdf-draft': 'PDF draft', manual: 'Entered by hand' }

export function StatusBadge({ p }: { p: HardwarePattern }) {
  if (p.status === 'verified')
    return (
      <Badge className="gap-1 bg-emerald-600/15 text-emerald-700 dark:text-emerald-300">
        <ShieldCheck className="size-3" /> Verified
      </Badge>
    )
  if (p.status === 'approved')
    return (
      <Badge className="gap-1 bg-sky-600/15 text-sky-700 dark:text-sky-300">
        <BadgeCheck className="size-3" /> Approved
      </Badge>
    )
  if (p.status === 'rejected')
    return (
      <Badge variant="secondary" className="gap-1">
        <CircleSlash className="size-3" /> Withdrawn
      </Badge>
    )
  return <Badge className="gap-1 bg-amber-500/20 text-amber-800 dark:text-amber-200">Draft · not saved</Badge>
}

/** Holes drawn above the reference edge (thick line at y = 0), x to the right. */
export function PatternPreview({ p, className }: { p: HardwarePattern; className?: string }) {
  const ok = p.holes.filter((h) => [h.x, h.y, h.diameter].every(Number.isFinite))
  const xs = ok.flatMap((h) => [h.x - h.diameter / 2, h.x + h.diameter / 2]).concat([0])
  const ys = ok.flatMap((h) => [h.y + h.diameter / 2]).concat([10])
  const x0 = Math.min(...xs) - 8
  const x1 = Math.max(...xs) + 8
  const y1 = Math.max(...ys) + 8
  return (
    <svg viewBox={`${x0} ${-y1} ${x1 - x0} ${y1 + 10}`} className={cn('rounded-md bg-muted/50', className)} aria-label={`${p.name} hole layout`}>
      <rect x={x0} y={0} width={x1 - x0} height={10} fill="currentColor" opacity={0.08} />
      <line x1={x0} x2={x1} y1={0} y2={0} stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" opacity={0.6} />
      <path d={`M0 -4V4M-4 0H4`} stroke="#ef4444" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {ok.map((h, i) =>
        h.face === 2 ? (
          <rect key={i} x={h.x - h.diameter / 2} y={0} width={h.diameter} height={6} fill="#a855f7" opacity={0.6} />
        ) : (
          <circle key={i} cx={h.x} cy={-h.y} r={h.diameter / 2} fill={h.face === 6 ? 'none' : '#0ea5e933'} stroke="#0284c7" strokeDasharray={h.face === 6 ? '2 2' : undefined} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ),
      )}
    </svg>
  )
}

export function PatternsTab() {
  const data = useStore((s) => s.data)!
  const updateLibrary = useStore((s) => s.updateLibrary)
  const units = data.settings.units
  const lib = data.library
  const list = patternsOf(lib)
  const [queue, setQueue] = useState<PatternDraft[]>([])
  const [open, setOpen] = useState<{ draft: PatternDraft; fromQueue: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const pdfRef = useRef<HTMLInputElement>(null)

  const importData = async (files: FileList | null) => {
    const drafts: PatternDraft[] = []
    for (const f of Array.from(files ?? [])) {
      const text = await f.text()
      if (/\.dxf$/i.test(f.name)) drafts.push(patternFromDxf(text, f.name))
      else {
        const r = patternsFromCsv(text, f.name)
        drafts.push(...r.drafts)
        for (const e of r.errors.slice(0, 3)) toast.error(`${f.name}: ${e}`)
      }
    }
    if (drafts.length) toast.success(`${drafts.length} pattern${drafts.length === 1 ? '' : 's'} ready for review`)
    setQueue((q) => [...q, ...drafts])
  }

  const draftSheet = async (files: FileList | null) => {
    const f = files?.[0]
    if (!f) return
    setBusy(true)
    try {
      const src = await loadSpecSource(f)
      const ai = await readyProvider(data.settings)
      let d: PatternDraft | null = null
      if (ai) {
        const drafter = aiDrafter(ai.provider, ai.model, backend.ai.call)
        try {
          toast.info(`Sending ${f.name} to ${drafter.label}…`)
          d = await drafter.draft(src.pages, f.name, src.images)
        } catch (e) {
          toast.error(`${drafter.label}: ${e instanceof Error ? e.message : String(e)}. Using the built-in reader instead.`)
        }
      }
      if (!d) {
        d = await textDrafter.draft(src.pages, f.name)
        if (!src.pages.some((p) => p.lines.length)) d.warnings.unshift('This is a scan or a photo with no text. Reading it needs an AI provider and its key in Settings; otherwise enter the holes by hand from the page shown.')
      }
      const known = d.item?.hardware.code.trim() && lib.hardware.find((h) => h.code.trim().toLowerCase() === d.item!.hardware.code.trim().toLowerCase())
      const draft: PatternDraft = { ...d, source: { file: f.name, images: src.images }, ...(known && d.item ? { item: { ...d.item, add: false }, pattern: { ...d.pattern, hardwareId: known.id } } : {}) }
      setQueue((q) => [...q, draft])
      setOpen({ draft, fromQueue: true })
    } catch (e) {
      toast.error(`Could not read ${f.name}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const manual = () => {
    const d: PatternDraft = { pattern: { id: `pat-${nanoid(8)}`, name: 'New pattern', manufacturer: '', anchor: 'edge-start', holes: [{ x: 0, y: 37, diameter: 5, depth: 12, face: 1 }], status: 'draft', source: 'manual', provenance: [] }, findings: [], warnings: [] }
    setQueue((q) => [...q, d])
    setOpen({ draft: d, fromQueue: true })
  }

  const approved = (p: HardwarePattern, item: ItemDraft | undefined, review: { reviewer: string; checked: boolean }) => {
    const at = new Date()
    const trial = approveHardwareDraft(structuredClone(lib), p, item, review, at)
    if (trial.errors.length) return toast.error(trial.errors[0])
    let saved: ReturnType<typeof approveHardwareDraft> | undefined
    updateLibrary((l) => void (saved = approveHardwareDraft(l, p, item, review, at)))
    if (!saved?.pattern) return toast.error(saved?.errors[0] ?? 'Could not save the pattern.')
    setQueue((q) => q.filter((d) => d.pattern.id !== p.id))
    setOpen(null)
    toast.success(`Saved “${saved.pattern.name}”, approved by ${saved.pattern.reviewedBy}`, { description: saved.hardware ? `Added ${saved.hardware.code} to the hardware library.` : undefined })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-xs text-muted-foreground">
          Boring patterns placed on custom parts from the part designer. Built-in patterns come from the published Salice and Blum sheets. Patterns from DXF, CSV, PDF spec sheets or photos arrive as drafts and are saved only after someone checks every value against the source and approves them.
        </p>
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".dxf,.csv,.txt" multiple className="hidden" onChange={(e) => void importData(e.target.files).finally(() => (e.target.value = ''))} />
          <input ref={pdfRef} type="file" accept={SPEC_ACCEPT} className="hidden" onChange={(e) => void draftSheet(e.target.files).finally(() => (e.target.value = ''))} />
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => fileRef.current?.click()}>
            <FileUp className="size-4" /> DXF or CSV
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => pdfRef.current?.click()}>
            <FileText className="size-4" /> {busy ? 'Reading…' : 'Draft from spec sheet'}
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={manual}>
            <Plus className="size-4" /> By hand
          </Button>
        </div>
      </div>

      {queue.length > 0 && (
        <section className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <TriangleAlert className="size-4 text-amber-600" /> Waiting for review ({queue.length})
          </h3>
          <p className="mb-2 text-xs text-muted-foreground">Drafts are not saved. Approve them, or they are lost when you leave this page.</p>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {queue.map((d) => (
              <li key={d.pattern.id} className="flex items-center gap-3 rounded-md border bg-background p-2">
                <PatternPreview p={d.pattern} className="h-14 w-20 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{d.pattern.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {SOURCE[d.pattern.source]} · {d.pattern.holes.length} hole{d.pattern.holes.length === 1 ? '' : 's'} · {patternIssues(d.pattern).length} to fix
                  </div>
                </div>
                <Button size="sm" onClick={() => setOpen({ draft: d, fromQueue: true })}>
                  Review
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label="Discard draft" onClick={() => setQueue((q) => q.filter((x) => x.pattern.id !== d.pattern.id))}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Layout</th>
              <th className="px-3 py-2 font-medium">Pattern</th>
              <th className="px-3 py-2 font-medium">Holes</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Checked by</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {list.map((p) => (
              <tr key={p.id} className={cn(p.status === 'rejected' && 'opacity-60')}>
                <td className="px-3 py-1.5">
                  <PatternPreview p={p} className="h-12 w-20" />
                </td>
                <td className="px-3 py-1.5">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.manufacturer || 'No manufacturer'} · {SOURCE[p.source]}
                  </div>
                </td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground tabular-nums">
                  {[...new Set(p.holes.map((h) => `Ø${toolSize(h.diameter, units)} × ${toolSize(h.depth, units)}`))].join(', ')}
                </td>
                <td className="px-3 py-1.5">
                  <StatusBadge p={p} />
                </td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground">{p.reviewedBy ? `${p.reviewedBy}, ${p.reviewedAt?.slice(0, 10)}` : ''}</td>
                <td className="px-3 py-1.5">
                  <div className="flex justify-end gap-1">
                    <Button size="icon-sm" variant="ghost" aria-label={`View ${p.name}`} onClick={() => setOpen({ draft: { pattern: p, findings: [], warnings: [] }, fromQueue: false })}>
                      <Eye />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Copy ${p.name} as a new draft`}
                      onClick={() => {
                        const d: PatternDraft = { pattern: { ...structuredClone(p), id: `pat-${nanoid(8)}`, name: `${p.name} (copy)`, status: 'draft', source: 'manual', reviewedBy: undefined, reviewedAt: undefined, provenance: [...p.provenance, { note: `Copied from ${p.name}` }] }, findings: [], warnings: [] }
                        setQueue((q) => [...q, d])
                        setOpen({ draft: d, fromQueue: true })
                      }}
                    >
                      <Copy />
                    </Button>
                    {p.status === 'approved' && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => updateLibrary((l) => withdrawPattern(l, p.id, `Withdrawn ${new Date().toISOString().slice(0, 10)}`))}>
                        Withdraw
                      </Button>
                    )}
                    {p.status === 'rejected' && (
                      <Button size="icon-sm" variant="ghost" aria-label={`Delete ${p.name}`} onClick={() => updateLibrary((l) => void (l.patterns = (l.patterns ?? []).filter((q) => q.id !== p.id)))}>
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        <ReviewDialog
          key={open.draft.pattern.id}
          draft={open.draft}
          editable={open.fromQueue}
          units={units}
          onClose={() => setOpen(null)}
          onApprove={approved}
          onChange={(next) => setQueue((q) => q.map((d) => (d.pattern.id === next.pattern.id ? next : d)))}
        />
      )}
    </div>
  )
}

const HOLE_KEYS: HoleKey[] = ['x', 'y', 'diameter', 'depth']

function ReviewDialog({
  draft,
  editable,
  units,
  onClose,
  onApprove,
  onChange,
}: {
  draft: PatternDraft
  editable: boolean
  units: UnitSystem
  onClose: () => void
  onApprove: (p: HardwarePattern, item: ItemDraft | undefined, review: { reviewer: string; checked: boolean }) => void
  onChange: (d: PatternDraft) => void
}) {
  const lib = useStore((s) => s.data!.library)
  const hardware = lib.hardware
  const [p, setP] = useState(draft.pattern)
  const [cites, setCites] = useState<HoleCites[]>(draft.holeCites ?? [])
  const [item, setItem] = useState<ItemDraft | undefined>(draft.item)
  const [reviewer, setReviewer] = useState('')
  const [checked, setChecked] = useState(false)
  const [focus, setFocus] = useState<string | null>(null)
  const issues = [...patternIssues(p), ...(item ? itemIssues(item, lib) : [])]
  const source = draft.source
  const sync = (next: { p?: HardwarePattern; cites?: HoleCites[]; item?: ItemDraft | undefined }) => {
    const np = next.p ?? p
    const nc = next.cites ?? cites
    const ni = 'item' in next ? next.item : item
    setP(np)
    setCites(nc)
    setItem(ni)
    setChecked(false)
    onChange({ ...draft, pattern: np, holeCites: nc, item: ni })
  }
  const hole = (i: number, patch: Partial<PatternHole>) => sync({ p: { ...p, holes: p.holes.map((h, j) => (j === i ? { ...h, ...patch } : h)) } })
  const setHw = (patch: Partial<Hardware>) => item && sync({ item: { ...item, hardware: { ...item.hardware, ...patch } } })

  const marks: MarkedCite[] = [
    ...cites.flatMap((c, i) => HOLE_KEYS.flatMap((k) => (c[k] ? [{ key: `h${i}.${k}`, cite: c[k]! }] : []))),
    ...Object.entries(item?.cites ?? {}).map(([k, c]) => ({ key: `item.${k}`, cite: c as Cite })),
    ...p.provenance.flatMap((q, i) => (q.region && !cites.length ? [{ key: `prov${i}`, cite: { page: q.page, quote: q.quote, region: q.region } }] : [])),
  ]
  const chip = (key: string, cite?: Cite) => (source ? <CiteChip cite={cite} active={focus === key} onClick={() => setFocus(key)} /> : null)
  const fields = item ? ITEM_FIELDS.filter((f) => f.for.includes(item.hardware.category)) : []

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn('max-h-[94vh] overflow-y-auto', source ? 'sm:max-w-[min(96vw,1400px)]' : 'sm:max-w-5xl')}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {editable ? 'Review drilling pattern' : p.name} <StatusBadge p={p} />
          </DialogTitle>
          <DialogDescription>{editable ? 'Check every number against the source page before approving. Empty or red cells must be filled in; nothing is guessed.' : `${SOURCE[p.source]} pattern. Copy it to make a changed version.`}</DialogDescription>
        </DialogHeader>
        <div className={cn('grid gap-4', source && 'lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]')}>
          {source && <SourceViewer file={source.file} images={source.images} marks={marks} focus={focus} onFocus={setFocus} className="h-[40vh] lg:sticky lg:top-0 lg:h-[72vh]" />}
          <div className="flex min-w-0 flex-col gap-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Name</Label>
                <Input className="h-8" value={p.name} disabled={!editable} onChange={(e) => sync({ p: { ...p, name: e.target.value } })} />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Manufacturer</Label>
                <Input className="h-8" value={p.manufacturer} disabled={!editable} onChange={(e) => sync({ p: { ...p, manufacturer: e.target.value } })} />
              </div>
              {!item?.add && (
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <Label className="text-xs text-muted-foreground">Library hardware it drills for</Label>
                  <Select value={p.hardwareId ?? 'none'} disabled={!editable} onValueChange={(v) => sync({ p: { ...p, hardwareId: v === 'none' ? undefined : v } })}>
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not linked</SelectItem>
                      {hardware.map((h) => (
                        <SelectItem key={h.id} value={h.id}>
                          {h.code} · {h.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {p.hardwareId && ['hw-plate', 'hw-td-15', 'hw-td-18', 'hw-td-21'].includes(p.hardwareId) && <p className="text-[11px] text-muted-foreground">Once approved, this pattern bores that item on every cabinet side (newest approved pattern wins).</p>}
                </div>
              )}
            </div>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">#</th>
                    <th className="px-2 py-1.5 font-medium">Along edge (x)</th>
                    <th className="px-2 py-1.5 font-medium">From edge (y)</th>
                    <th className="px-2 py-1.5 font-medium">Diameter</th>
                    <th className="px-2 py-1.5 font-medium">Depth</th>
                    <th className="px-2 py-1.5 font-medium">Face</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {p.holes.map((h, i) => (
                    <tr key={i} className="align-top">
                      <td className="px-2 py-1.5 text-muted-foreground">{i + 1}</td>
                      {HOLE_KEYS.map((k) => (
                        <td key={k} className="px-2 py-1">
                          <div className="flex flex-col items-start gap-0.5">
                            {editable ? <LenInput label={`Hole ${i + 1} ${k}`} value={h[k]} units={units} onChange={(v) => hole(i, { [k]: v })} /> : <span className="tabular-nums">{k === 'diameter' || k === 'depth' ? toolSize(h[k], units) : formatLength(h[k], units)}</span>}
                            {chip(`h${i}.${k}`, cites[i]?.[k])}
                          </div>
                        </td>
                      ))}
                      <td className="px-2 py-1">
                        <Select value={String(h.face)} disabled={!editable} onValueChange={(v) => hole(i, { face: Number(v) as FaceId })}>
                          <SelectTrigger size="sm" className="h-7 w-28 text-xs" aria-label={`Hole ${i + 1} face`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FACES.map((f) => (
                              <SelectItem key={f.value} value={String(f.value)}>
                                {f.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-1 py-1">
                        {editable && (
                          <Button size="icon-sm" variant="ghost" aria-label={`Remove hole ${i + 1}`} onClick={() => sync({ p: { ...p, holes: p.holes.filter((_, j) => j !== i) }, cites: cites.filter((_, j) => j !== i) })}>
                            <Trash2 />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {editable && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="m-1 gap-1 text-xs"
                  onClick={() => sync({ p: { ...p, holes: [...p.holes, { x: NaN, y: NaN, diameter: NaN, depth: NaN, face: 1 }] }, cites: cites.length ? [...cites, {}] : cites })}
                >
                  <Plus className="size-3.5" /> Hole
                </Button>
              )}
            </div>

            {editable && (
              <section className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-xs font-medium">Library item</h4>
                  {item ? (
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox checked={item.add} onCheckedChange={(v) => sync({ item: { ...item, add: v === true }, p: v === true ? { ...p, hardwareId: undefined } : p })} /> Add to the hardware library as a new item
                    </label>
                  ) : (
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => sync({ item: { hardware: { id: `hw-${nanoid(8)}`, code: '', name: p.name, category: 'other' }, cites: {}, add: true }, p: { ...p, hardwareId: undefined } })}>
                      <Plus className="size-3.5" /> Add a library item too
                    </Button>
                  )}
                </div>
                {item?.add && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs text-muted-foreground">Part number</Label>
                      <Input className="h-8" aria-label="Item part number" value={item.hardware.code} placeholder="needed" aria-invalid={!item.hardware.code.trim()} onChange={(e) => setHw({ code: e.target.value })} />
                      {chip('item.code', item.cites.code)}
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs text-muted-foreground">Item name</Label>
                      <Input className="h-8" aria-label="Item name" value={item.hardware.name} onChange={(e) => setHw({ name: e.target.value })} />
                      {chip('item.name', item.cites.name)}
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs text-muted-foreground">Category</Label>
                      <Select value={item.hardware.category} onValueChange={(v) => setHw({ category: v as HardwareCategory })}>
                        <SelectTrigger size="sm" className="w-full" aria-label="Item category">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {HW_CATEGORIES.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c.replace('-', ' ')}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {fields.map((f) => (
                      <div key={f.key} className="flex flex-col gap-1">
                        <Label className="text-xs text-muted-foreground">{f.label}</Label>
                        <LenInput label={f.label} optional value={(item.hardware[f.key] as number | undefined) ?? NaN} units={units} onChange={(v) => setHw({ [f.key]: v })} className="w-full" />
                        {chip(`item.${f.key}`, item.cites[f.key])}
                      </div>
                    ))}
                    <p className="text-[11px] text-muted-foreground sm:col-span-3">Blank numbers are left unset on the item. The pattern above is linked to it on approval.</p>
                  </div>
                )}
              </section>
            )}

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="flex min-w-0 flex-col gap-1">
                <PatternPreview p={p} className="h-36 w-full text-foreground" />
                <p className="text-[11px] text-muted-foreground">Thick line = reference edge, red cross = insertion point. Purple = bores into the edge, dashed = underside.</p>
              </div>
              <section className="min-w-0">
                <h4 className="mb-1 text-xs font-medium">Where the numbers came from</h4>
                <ul className="max-h-44 space-y-1 overflow-y-auto text-[11px]">
                  {p.provenance.map((q, i) => (
                    <li key={i} className="rounded border bg-muted/30 p-1.5">
                      {q.note && <div className="font-medium">{q.note}</div>}
                      {q.quote && <q className="text-muted-foreground italic">{q.quote}</q>}
                      {(q.page || q.file) && (
                        <div className="truncate text-muted-foreground">
                          {q.file ?? ''}
                          {q.page ? ` page ${q.page}` : ''}
                        </div>
                      )}
                    </li>
                  ))}
                  {!p.provenance.length && <li className="text-muted-foreground">No source recorded.</li>}
                </ul>
              </section>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Notes</Label>
              <Textarea rows={2} value={p.notes ?? ''} disabled={!editable} onChange={(e) => sync({ p: { ...p, notes: e.target.value } })} />
            </div>
          </div>
        </div>
        {editable && (issues.length > 0 || draft.warnings.length > 0) && (
          <div className="grid gap-2 md:grid-cols-2">
            {issues.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
                <div className="mb-1 flex items-center gap-1.5 font-medium text-destructive">
                  <TriangleAlert className="size-3.5" /> {issues.length} to fix before approving
                </div>
                <ul className="list-disc space-y-0.5 pl-4">
                  {issues.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            {draft.warnings.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                <div className="mb-1 font-medium">Notes from the reader (as first read)</div>
                <ul className="list-disc space-y-0.5 pl-4">
                  {draft.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {editable && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
            <Label htmlFor="pat-reviewer" className="text-xs">
              Checked by
            </Label>
            <Input id="pat-reviewer" className="h-8 w-48" value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Your name" />
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} /> I checked every value against the source
            </label>
            <span className="text-[11px] text-muted-foreground">Any change clears the tick.</span>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {editable ? 'Close (stays in the review queue)' : 'Close'}
          </Button>
          {editable && (
            <Button disabled={issues.length > 0 || !reviewer.trim() || !checked} onClick={() => onApprove(p, item, { reviewer, checked })} className="gap-1.5">
              <BadgeCheck className="size-4" /> {item?.add ? 'Approve, save pattern and item' : 'Approve and save'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
