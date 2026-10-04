import { BadgeCheck, CircleSlash, Copy, Eye, FileText, FileUp, Plus, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/app/store'
import { loadPdfLib } from '@/cam/pdfVectors'
import type { FaceId, HardwarePattern, PatternHole } from '@/cam/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { DRAFTERS, type Finding, type PatternDraft, patternFromDxf, patternsFromCsv, pdfTextPages } from '@/core/hardware/patternImport'
import { approvePattern, patternIssues, patternsOf, savePattern, withdrawPattern } from '@/core/hardware/patterns'
import type { UnitSystem } from '@/core/types'
import { formatLength, parseLength } from '@/core/units'
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

  const draftPdf = async (files: FileList | null) => {
    const f = files?.[0]
    if (!f) return
    setBusy(true)
    try {
      const pages = await pdfTextPages((await loadPdfLib()) as never, new Uint8Array(await f.arrayBuffer()))
      const d = await DRAFTERS[0].draft(pages, f.name)
      setQueue((q) => [...q, d])
      setOpen({ draft: d, fromQueue: true })
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

  const approved = (p: HardwarePattern) => {
    let err: string | undefined
    updateLibrary((l) => {
      const r = savePattern(l, p)
      err = r.error
    })
    if (err) return toast.error(err)
    setQueue((q) => q.filter((d) => d.pattern.id !== p.id))
    setOpen(null)
    toast.success(`Saved “${p.name}”, approved by ${p.reviewedBy}`)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-xs text-muted-foreground">
          Boring patterns placed on custom parts from the part designer. Built-in patterns come from the published Salice and Blum sheets. Patterns from DXF, CSV or PDF spec sheets arrive as drafts and are saved only after someone checks every hole and approves them.
        </p>
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".dxf,.csv,.txt" multiple className="hidden" onChange={(e) => void importData(e.target.files).finally(() => (e.target.value = ''))} />
          <input ref={pdfRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={(e) => void draftPdf(e.target.files).finally(() => (e.target.value = ''))} />
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => fileRef.current?.click()}>
            <FileUp className="size-4" /> DXF or CSV
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => pdfRef.current?.click()}>
            <FileText className="size-4" /> {busy ? 'Reading…' : 'Draft from PDF'}
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
                  {[...new Set(p.holes.map((h) => `Ø${formatLength(h.diameter, units)} × ${formatLength(h.depth, units)}`))].join(', ')}
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
      {open && <ReviewDialog key={open.draft.pattern.id} draft={open.draft} editable={open.fromQueue} units={units} onClose={() => setOpen(null)} onApprove={approved} onChange={(p) => setQueue((q) => q.map((d) => (d.pattern.id === p.id ? { ...d, pattern: p } : d)))} />}
    </div>
  )
}

function LenInput({ value, units, onChange, label }: { value: number; units: UnitSystem; onChange: (v: number) => void; label: string }) {
  const shown = Number.isFinite(value) ? formatLength(value, units) : ''
  const [text, setText] = useState(shown)
  const [last, setLast] = useState(shown)
  if (shown !== last) {
    setLast(shown)
    setText(shown)
  }
  const parsed = text.trim() ? parseLength(text, units) : null
  return (
    <Input
      aria-label={label}
      inputMode="decimal"
      value={text}
      aria-invalid={!Number.isFinite(value) || (text.trim() !== '' && parsed === null)}
      placeholder="needed"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onChange(parsed ?? NaN)}
      className="h-7 w-[4.5rem] px-1.5 text-xs tabular-nums"
    />
  )
}

function ReviewDialog({ draft, editable, units, onClose, onApprove, onChange }: { draft: PatternDraft; editable: boolean; units: UnitSystem; onClose: () => void; onApprove: (p: HardwarePattern) => void; onChange: (p: HardwarePattern) => void }) {
  const hardware = useStore((s) => s.data!.library.hardware)
  const [p, setP] = useState(draft.pattern)
  const [reviewer, setReviewer] = useState('')
  const [checked, setChecked] = useState(false)
  const issues = patternIssues(p)
  const set = (next: HardwarePattern) => {
    setP(next)
    setChecked(false)
    onChange(next)
  }
  const hole = (i: number, patch: Partial<PatternHole>) => set({ ...p, holes: p.holes.map((h, j) => (j === i ? { ...h, ...patch } : h)) })
  const findings: Finding[] = draft.findings
  const tryApprove = () => {
    const r = approvePattern(p, { reviewer, checked }, new Date())
    if (r.pattern) onApprove(r.pattern)
    else toast.error(r.errors[0])
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {editable ? 'Review drilling pattern' : p.name} <StatusBadge p={p} />
          </DialogTitle>
          <DialogDescription>{editable ? 'Check every number against the source before approving. Empty or red cells must be filled in.' : `${SOURCE[p.source]} pattern. Copy it to make a changed version.`}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[1fr_240px]">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Name</Label>
                <Input className="h-8" value={p.name} disabled={!editable} onChange={(e) => set({ ...p, name: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Manufacturer</Label>
                <Input className="h-8" value={p.manufacturer} disabled={!editable} onChange={(e) => set({ ...p, manufacturer: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <Label className="text-xs text-muted-foreground">Library hardware it drills for</Label>
                <Select value={p.hardwareId ?? 'none'} disabled={!editable} onValueChange={(v) => set({ ...p, hardwareId: v === 'none' ? undefined : v })}>
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
              </div>
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
                    <tr key={i}>
                      <td className="px-2 py-1 text-muted-foreground">{i + 1}</td>
                      {(['x', 'y', 'diameter', 'depth'] as const).map((k) => (
                        <td key={k} className="px-2 py-1">
                          {editable ? <LenInput label={`Hole ${i + 1} ${k}`} value={h[k]} units={units} onChange={(v) => hole(i, { [k]: v })} /> : <span className="tabular-nums">{formatLength(h[k], units)}</span>}
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
                      <td className="px-1">
                        {editable && (
                          <Button size="icon-sm" variant="ghost" aria-label={`Remove hole ${i + 1}`} onClick={() => set({ ...p, holes: p.holes.filter((_, j) => j !== i) })}>
                            <Trash2 />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {editable && (
                <Button size="sm" variant="ghost" className="m-1 gap-1 text-xs" onClick={() => set({ ...p, holes: [...p.holes, { ...(p.holes[p.holes.length - 1] ?? { x: 0, y: 37, diameter: 5, depth: 12, face: 1 }), x: (p.holes[p.holes.length - 1]?.x ?? -32) + 32 }] })}>
                  <Plus className="size-3.5" /> Hole
                </Button>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Notes</Label>
              <Textarea rows={2} value={p.notes ?? ''} disabled={!editable} onChange={(e) => set({ ...p, notes: e.target.value })} />
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <PatternPreview p={p} className="h-40 w-full text-foreground" />
            <p className="text-[11px] text-muted-foreground">Thick line = reference edge, red cross = insertion point. Purple = bores into the edge, dashed = underside.</p>
            <section>
              <h4 className="mb-1 text-xs font-medium">Where the numbers came from</h4>
              <ul className="max-h-48 space-y-1 overflow-y-auto text-[11px]">
                {(findings.length ? findings.map((f) => ({ page: f.page, quote: f.quote, note: `${f.label}: ${f.value}${f.used ? '' : ' (not used)'}`, file: undefined as string | undefined })) : p.provenance).map((q, i) => (
                  <li key={i} className="rounded border bg-muted/30 p-1.5">
                    {q.note && <div className="font-medium">{q.note}</div>}
                    {q.quote && <q className="text-muted-foreground italic">{q.quote}</q>}
                    {(q.page || q.file) && (
                      <div className="truncate text-muted-foreground">
                        {q.file ? `${q.file}` : ''}
                        {q.page ? ` page ${q.page}` : ''}
                      </div>
                    )}
                  </li>
                ))}
                {!findings.length && !p.provenance.length && <li className="text-muted-foreground">No source recorded.</li>}
              </ul>
            </section>
          </div>
        </div>
        {editable && (draft.warnings.length > 0 || issues.length > 0) && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
            <ul className="list-disc space-y-0.5 pl-4">
              {[...draft.warnings, ...issues].map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {editable && (
          <div className="flex flex-col gap-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-3">
              <Label htmlFor="pat-reviewer" className="text-xs">
                Checked by
              </Label>
              <Input id="pat-reviewer" className="h-8 w-48" value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Your name" />
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} /> I checked every hole against the source sheet
              </label>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {editable ? 'Close (stays in the review queue)' : 'Close'}
          </Button>
          {editable && (
            <Button disabled={issues.length > 0 || !reviewer.trim() || !checked} onClick={tryApprove} className="gap-1.5">
              <BadgeCheck className="size-4" /> Approve and save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
