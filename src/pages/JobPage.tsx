import {
  ArrowLeft,
  CircleAlert,
  Copy,
  Download,
  FileCode2,
  FileText,
  Info,
  LayoutGrid,
  Pencil,
  PenTool,
  Plus,
  Printer,
  ShieldAlert,
  Table2,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { backend, type OutFile } from '@/app/backend'
import { buildFiles, bomCsv, useJobOutput, type ExportKind } from '@/app/jobOutput'
import { useStore, type JobTab } from '@/app/store'
import { CabinetThumb } from '@/components/CabinetThumb'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { SheetView } from '@/components/SheetView'
import { NumField, TextField } from '@/components/fields'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cutListCsv } from '@/core/cutlist'
import { formatLength } from '@/core/units'
import { mprFiles, type JobOutput } from '@/core/pipeline'
import { countBySeverity, type Issue } from '@/core/validator'
import type { AppData, Job } from '@/core/types'
import { RoomTab } from './RoomTab'
import { PartList } from '@/components/PartList'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { nanoid } from 'nanoid'
import { cn } from '@/lib/utils'

export function JobPage({ jobId, tab }: { jobId: string; tab: JobTab }) {
  const { data, go, mutate } = useStore()
  const job = data?.jobs.find((j) => j.id === jobId)
  const { out, error } = useJobOutput(job, data)
  if (!data) return null
  if (!job)
    return (
      <div className="p-6">
        <EmptyState icon={<CircleAlert className="size-5" />} title="Job not found" action={<Button onClick={() => go({ page: 'jobs' })}>Back to jobs</Button>} />
      </div>
    )

  const counts = out ? countBySeverity(out.issues) : { error: 0, warning: 0, info: 0 }
  const setJob = (fn: (j: Job) => void) =>
    mutate((d) => {
      const j = d.jobs.find((x) => x.id === jobId)
      if (j) {
        fn(j)
        j.updatedAt = new Date().toISOString()
      }
    })

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        back={
          <Button variant="ghost" size="icon-sm" aria-label="Back to jobs" onClick={() => go({ page: 'jobs' })}>
            <ArrowLeft />
          </Button>
        }
        title={
          <span>
            <span className="mr-2 font-mono text-sm text-muted-foreground">{job.number}</span>
            {job.name}
          </span>
        }
        subtitle={job.customer || 'No customer'}
        actions={
          out && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{out.instances.length} parts</span>
              <span>·</span>
              <span>{out.programs.length} sheets</span>
              {counts.error > 0 && <Badge variant="destructive">{counts.error} errors</Badge>}
              {counts.warning > 0 && <Badge className="bg-amber-100 text-amber-900">{counts.warning} warnings</Badge>}
            </div>
          )
        }
      />
      <Tabs value={tab} onValueChange={(t) => go({ page: 'job', jobId, tab: t as JobTab })} className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="border-b bg-background px-5 py-2">
          <TabsList>
            <TabsTrigger value="cabinets">
              <LayoutGrid /> Cabinets
            </TabsTrigger>
            <TabsTrigger value="room">Room</TabsTrigger>
            <TabsTrigger value="parts">
              <PenTool /> Custom parts{job.camParts?.length ? ` (${job.camParts.length})` : ''}
            </TabsTrigger>
            <TabsTrigger value="cutlist">
              <Table2 /> Cut list
            </TabsTrigger>
            <TabsTrigger value="nesting">
              <LayoutGrid /> Nesting
            </TabsTrigger>
            <TabsTrigger value="output">
              <FileCode2 /> Output
            </TabsTrigger>
          </TabsList>
        </div>
        {error && (
          <div className="mx-5 mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            Could not process this job: {error}
          </div>
        )}
        <TabsContent value="cabinets" className="min-h-0 flex-1 overflow-auto p-5">
          <CabinetsTab job={job} data={data} setJob={setJob} />
        </TabsContent>
        <TabsContent value="room" className="min-h-0 flex-1 overflow-hidden">
          <RoomTab job={job} setJob={setJob} />
        </TabsContent>
        <TabsContent value="parts" className="min-h-0 flex-1 overflow-auto p-5">
          <CustomPartsTab job={job} data={data} />
        </TabsContent>
        <TabsContent value="cutlist" className="min-h-0 flex-1 overflow-auto p-5">
          {out && <CutListTab job={job} data={data} out={out} />}
        </TabsContent>
        <TabsContent value="nesting" className="min-h-0 flex-1 overflow-hidden">
          {out && <NestingTab data={data} out={out} />}
        </TabsContent>
        <TabsContent value="output" className="min-h-0 flex-1 overflow-auto p-5">
          {out && <OutputTab job={job} data={data} out={out} />}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function CabinetsTab({ job, data, setJob }: { job: Job; data: AppData; setJob: (fn: (j: Job) => void) => void }) {
  const { go, addCabinet, duplicateCabinet, removeCabinet } = useStore()
  const [adding, setAdding] = useState(false)
  const matName = (id: string) => data.library.materials.find((m) => m.id === id)?.code ?? '—'

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 rounded-xl border bg-background p-4 sm:grid-cols-3">
        <TextField label="Job number" value={job.number} onChange={(v) => setJob((j) => (j.number = v))} />
        <TextField label="Job name" value={job.name} onChange={(v) => setJob((j) => (j.name = v))} />
        <TextField label="Customer" value={job.customer} onChange={(v) => setJob((j) => (j.customer = v))} />
        <div className="sm:col-span-3">
          <Label className="mb-1.5 block text-xs text-muted-foreground">Notes</Label>
          <Textarea rows={2} value={job.notes} placeholder="Site notes, delivery, colour confirmations..." onChange={(e) => setJob((j) => (j.notes = e.target.value))} />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Cabinets</h2>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus /> Add cabinet
        </Button>
      </div>

      {job.cabinets.length === 0 ? (
        <EmptyState icon={<LayoutGrid className="size-5" />} title="No cabinets in this job" action={<Button size="sm" onClick={() => setAdding(true)}><Plus /> Add from library</Button>}>
          Pick a template, then adjust width, height, depth and construction for this job.
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {job.cabinets.map((c) => (
            <div key={c.id} className="flex flex-col rounded-xl border bg-background shadow-xs">
              <button className="flex gap-3 p-3 text-left" onClick={() => go({ page: 'cabinet', jobId: job.id, cabinetId: c.id })}>
                <CabinetThumb p={c.params} className="h-24 w-20 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-stone-800 px-1.5 py-0.5 font-mono text-[11px] text-white">{c.number}</span>
                    <span className="truncate text-sm font-medium">{c.name}</span>
                  </div>
                  <div className="mt-1.5 font-mono text-xs tabular-nums">
                    {formatLength(c.params.width, data.settings.units)} × {formatLength(c.params.height, data.settings.units)} × {formatLength(c.params.depth, data.settings.units)}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {matName(c.params.carcassMaterialId)} · {c.params.doors.count} door{c.params.doors.count === 1 ? '' : 's'} · {c.params.shelves.count} shelf
                  </div>
                  {Object.values(c.overrides).some((o) => o.exclude || o.edges || o.extraOps?.length || o.materialId) && (
                    <Badge variant="outline" className="mt-1.5 text-[10px]">
                      Customised parts
                    </Badge>
                  )}
                </div>
              </button>
              <div className="mt-auto flex items-center justify-between border-t px-3 py-1.5">
                <div className="w-24">
                  <NumField
                    label=""
                    suffix="qty"
                    min={1}
                    max={99}
                    value={c.qty}
                    onChange={(v) => setJob((j) => {
                      const cab = j.cabinets.find((x) => x.id === c.id)
                      if (cab) cab.qty = Math.round(v)
                    })}
                  />
                </div>
                <div className="flex gap-0.5">
                  <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => go({ page: 'cabinet', jobId: job.id, cabinetId: c.id })}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Duplicate" onClick={() => duplicateCabinet(job.id, c.id)}>
                    <Copy />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => removeCabinet(job.id, c.id)}>
                    <Trash2 />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add cabinet</DialogTitle>
            <DialogDescription>The template is copied into the job, so later edits here do not change the library.</DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[60vh] gap-2 overflow-auto sm:grid-cols-2">
            {data.library.templates.map((t) => (
              <button
                key={t.id}
                className="flex gap-3 rounded-lg border p-3 text-left transition hover:border-stone-500 hover:bg-muted/50"
                onClick={() => {
                  const id = addCabinet(job.id, t)
                  setAdding(false)
                  toast.success(`${t.name} added`, { action: { label: 'Edit', onClick: () => go({ page: 'cabinet', jobId: job.id, cabinetId: id }) } })
                }}
              >
                <CabinetThumb p={t.params} className="h-20 w-16 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{t.name}</div>
                  <div className="font-mono text-xs">
                    {t.params.width} × {t.params.height} × {t.params.depth}
                  </div>
                  <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{t.description}</div>
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

async function saveOne(file: OutFile, ext: string, label: string) {
  const where = await backend.saveFile(file, [{ name: label, extensions: [ext] }])
  if (where) toast.success(`Saved ${where}`)
}

function CutListTab({ job, data, out }: { job: Job; data: AppData; out: JobOutput }) {
  const u = data.settings.units
  const L = (n: number) => formatLength(n, u)
  if (out.cutList.length === 0)
    return <EmptyState icon={<Table2 className="size-5" />} title="Nothing to cut">Add cabinets to this job to build the cut list.</EmptyState>
  const base = job.number.replace(/[^A-Za-z0-9_-]+/g, '-')
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Cut sizes include edgeband compensation (finished − band thickness + pre-mill {data.settings.nesting.premill} mm per banded edge). L = grain locked along length.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => saveOne({ name: `${base}_cutlist.csv`, data: cutListCsv(out.cutList) }, 'csv', 'CSV')}>
            <Download /> Cut list CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => saveOne({ name: `${base}_bom.csv`, data: bomCsv(out, data) }, 'csv', 'CSV')}>
            <Download /> BOM CSV
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Material</TableHead>
              <TableHead>Part</TableHead>
              <TableHead>Cabinets</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Cut L × W ({u})</TableHead>
              <TableHead className="text-right">Finished L × W × T</TableHead>
              <TableHead>Edges L1 / L2 / W1 / W2</TableHead>
              <TableHead>Grain</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {out.cutList.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs">{r.materialCode}</TableCell>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.cabinets}</TableCell>
                <TableCell className="text-right tabular-nums">{r.qty}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">
                  {L(r.cutLength)} × {L(r.cutWidth)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                  {L(r.finishedLength)} × {L(r.finishedWidth)} × {L(r.thickness)}
                </TableCell>
                <TableCell className="font-mono text-[11px]">{(['L1', 'L2', 'W1', 'W2'] as const).map((k) => r.edges[k] || '–').join(' / ')}</TableCell>
                <TableCell>{r.grain}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <SummaryTable
          title="Sheets"
          rows={[...new Set(out.programs.map((p) => p.materialCode))].map((code) => {
            const progs = out.programs.filter((p) => p.materialCode === code)
            const m = data.library.materials.find((mm) => mm.code === code)
            return [code, m ? `${formatLength(m.sheetLength, data.settings.units)} × ${formatLength(m.sheetWidth, data.settings.units)}` : '', `${progs.length}`]
          })}
        />
        <SummaryTable title="Edgeband (incl. 50 mm overhang per edge)" rows={out.edgebands.map((e) => [e.code, e.name, `${e.metres} m`])} />
        <SummaryTable title="Hardware" rows={out.hardware.map((h) => [h.code, h.name, `${h.qty}`])} />
      </div>
    </div>
  )
}

function SummaryTable({ title, rows }: { title: string; rows: string[][] }) {
  return (
    <div className="rounded-xl border bg-background">
      <div className="border-b px-4 py-2.5 text-sm font-semibold">{title}</div>
      {rows.length === 0 ? (
        <div className="px-4 py-3 text-xs text-muted-foreground">None</div>
      ) : (
        <Table>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs">{r[0]}</TableCell>
                <TableCell className="text-xs">{r[1]}</TableCell>
                <TableCell className="text-right tabular-nums">{r[2]}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

function NestingTab({ data, out }: { data: AppData; out: JobOutput }) {
  const [sheetIdx, setSheetIdx] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [showLabels, setShowLabels] = useState(true)
  const [showOps, setShowOps] = useState(true)
  const instances = useMemo(() => new Map(out.instances.map((i) => [i.uid, i])), [out])

  if (out.programs.length === 0)
    return (
      <div className="p-5">
        <EmptyState icon={<LayoutGrid className="size-5" />} title="No sheets">Add cabinets to the job to nest parts.</EmptyState>
      </div>
    )

  const prog = out.programs[Math.min(sheetIdx, out.programs.length - 1)]
  const sh = prog.sheet
  const mat = data.library.materials.find((m) => m.id === sh.materialId)
  const sel = selected ? instances.get(selected) : null
  const selLabel = selected ? out.labels.find((l) => l.uid === selected) : null
  const sheetIssues = out.issues.filter((i) => i.sheet === sh.index)

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <div className="flex shrink-0 gap-2 overflow-x-auto border-b bg-background p-3 lg:w-56 lg:flex-col lg:overflow-y-auto lg:border-r lg:border-b-0">
        {out.programs.map((p, i) => (
          <button
            key={p.name}
            onClick={() => (setSheetIdx(i), setSelected(null))}
            className={cn('min-w-40 rounded-lg border p-2.5 text-left text-xs transition', i === sheetIdx ? 'border-stone-800 bg-stone-50' : 'hover:bg-muted/50')}
          >
            <div className="font-semibold">Sheet {p.sheet.index}</div>
            <div className="font-mono text-[11px] text-muted-foreground">{p.materialCode}</div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-muted">
              <div className="h-full bg-amber-500" style={{ width: `${Math.round(p.sheet.utilization)}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
              <span>{p.sheet.placements.length} parts</span>
              <span>{Math.round(p.sheet.utilization)}%</span>
            </div>
          </button>
        ))}
        {out.nest.unplaced.length > 0 && (
          <div className="min-w-40 rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs text-red-800">{out.nest.unplaced.length} part(s) could not be nested</div>
        )}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-background px-4 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-mono font-medium">{prog.name}.mpr</span>
            <span className="text-muted-foreground">
              {mat?.name} · {formatLength(sh.sheetLength, data.settings.units)} × {formatLength(sh.sheetWidth, data.settings.units)} × {formatLength(sh.thickness, data.settings.units)}
            </span>
            <span className="text-muted-foreground">
              Trim {data.settings.nesting.edgeTrim} · spacing {out.nest.spacing} mm
            </span>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5">
              <Switch checked={showLabels} onCheckedChange={setShowLabels} /> Labels
            </label>
            <label className="flex items-center gap-1.5">
              <Switch checked={showOps} onCheckedChange={setShowOps} /> Machining
            </label>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
          <div className="min-h-[320px] min-w-0 flex-1 p-4">
            <SheetView program={prog} instances={instances} spots={out.spots.get(sh.index) ?? []} showLabels={showLabels} showOps={showOps} selectedUid={selected} onSelect={setSelected} />
          </div>
          <div className="w-full shrink-0 overflow-auto border-t bg-background xl:w-80 xl:border-t-0 xl:border-l">
            {sel && selLabel ? (
              <div className="flex flex-col gap-2 p-4 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-semibold">#{sel.no}</span>
                  <span className="font-mono text-muted-foreground">{sel.partId}</span>
                </div>
                <div className="text-sm font-medium">
                  {sel.cabinetNumber} · {sel.part.name}
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">Cut size</dt>
                  <dd className="font-mono">
                    {sel.cutLength} × {sel.cutWidth}
                  </dd>
                  <dt className="text-muted-foreground">Finished</dt>
                  <dd className="font-mono">
                    {sel.part.length} × {sel.part.width}
                  </dd>
                  <dt className="text-muted-foreground">Edges</dt>
                  <dd className="font-mono">{selLabel.edgeDiagram}</dd>
                  <dt className="text-muted-foreground">Cut order</dt>
                  <dd>{selLabel.cutOrder}</dd>
                  <dt className="text-muted-foreground">Rotated</dt>
                  <dd>{selLabel.rotated ? 'Yes (90°)' : 'No'}</dd>
                  <dt className="text-muted-foreground">Label</dt>
                  <dd>{selLabel.spot.fits ? `on part, ${selLabel.spot.rotation}°` : 'back face'}</dd>
                </dl>
                {selLabel.notes.map((n) => (
                  <div key={n} className="rounded bg-amber-50 px-2 py-1 text-amber-900">
                    {n}
                  </div>
                ))}
                <Button size="xs" variant="ghost" className="self-start" onClick={() => setSelected(null)}>
                  Clear selection
                </Button>
              </div>
            ) : (
              <div className="p-4 text-xs text-muted-foreground">Click a part to see its details. Numbers match the labels and sheet map.</div>
            )}
            <div className="border-t p-4">
              <div className="mb-2 text-xs font-semibold">Sheet checks</div>
              <IssueList issues={sheetIssues} onPick={(uid) => setSelected(uid)} empty="No issues on this sheet." />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const SEV = {
  error: { icon: ShieldAlert, cls: 'border-red-200 bg-red-50 text-red-900' },
  warning: { icon: TriangleAlert, cls: 'border-amber-200 bg-amber-50 text-amber-900' },
  info: { icon: Info, cls: 'border-sky-200 bg-sky-50 text-sky-900' },
} as const

function IssueList({ issues, onPick, empty }: { issues: Issue[]; onPick?: (uid: string) => void; empty: string }) {
  if (issues.length === 0) return <div className="text-xs text-muted-foreground">{empty}</div>
  const order = { error: 0, warning: 1, info: 2 }
  return (
    <ul className="flex flex-col gap-1.5">
      {[...issues]
        .sort((a, b) => order[a.severity] - order[b.severity])
        .map((i, k) => {
          const S = SEV[i.severity]
          return (
            <li key={k}>
              <button
                disabled={!i.partUid || !onPick}
                onClick={() => i.partUid && onPick?.(i.partUid)}
                className={cn('flex w-full items-start gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs', S.cls, i.partUid && onPick && 'hover:brightness-95')}
              >
                <S.icon className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  <span className="mr-1.5 font-mono text-[10px] opacity-70">{i.code}</span>
                  {i.sheet !== undefined && <span className="mr-1 font-medium">S{i.sheet}</span>}
                  {i.partNo !== undefined && <span className="mr-1 font-medium">#{i.partNo}</span>}
                  {i.message}
                </span>
              </button>
            </li>
          )
        })}
    </ul>
  )
}

const EXPORTS: { kind: ExportKind; label: string; desc: string; icon: typeof FileText; ext: string }[] = [
  { kind: 'mpr', label: 'MPR programs', desc: 'One woodWOP 4.0 file per sheet', icon: FileCode2, ext: 'mpr' },
  { kind: 'labels-pdf', label: 'Labels PDF', desc: 'One page per label, sheet header first', icon: Printer, ext: 'pdf' },
  { kind: 'sheetmap-pdf', label: 'Sheet maps PDF', desc: 'A4 layout with label spots and edge codes', icon: FileText, ext: 'pdf' },
  { kind: 'labels-zpl', label: 'Labels ZPL', desc: 'Raw Zebra 203 dpi, send direct to printer', icon: Printer, ext: 'zpl' },
  { kind: 'cutlist-csv', label: 'Cut list CSV', desc: 'Grouped parts with edges', icon: Table2, ext: 'csv' },
  { kind: 'bom-csv', label: 'BOM CSV', desc: 'Sheets, edgeband metres, hardware', icon: Table2, ext: 'csv' },
]

function OutputTab({ job, data, out }: { job: Job; data: AppData; out: JobOutput }) {
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{ name: string; text: string } | null>(null)
  const counts = countBySeverity(out.issues)
  const blocked = counts.error > 0
  const files = useMemo(() => mprFiles(job, data, out), [job, data, out])
  const subfolder = `${job.number.replace(/[^A-Za-z0-9_-]+/g, '-')}_${new Date().toISOString().slice(0, 10)}`

  const exportKinds = async (kinds: ExportKind[]) => {
    setBusy(true)
    try {
      const built = buildFiles(kinds, job, data, out)
      const where = await backend.exportFiles(built, { folder: data.settings.outputFolder || undefined, subfolder })
      if (where) toast.success(`${built.length} file(s) written`, { description: where })
    } catch (e) {
      toast.error('Export failed', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  if (out.programs.length === 0)
    return <EmptyState icon={<FileCode2 className="size-5" />} title="No programs yet">Add cabinets to the job, then come back to export MPR files and labels.</EmptyState>

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
      <div className="flex flex-col gap-5">
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 size-5 shrink-0" />
            <div className="flex flex-col gap-2">
              <p className="font-medium">These files are generated, not machine-proven.</p>
              <p className="text-xs leading-relaxed">
                Open every MPR in woodWOP, check the tool assignments against the real CENTATEQ N-200 tool table, and run the simulation before cutting.
                {data.machine.placeholder && ' The tool table is still placeholder data.'}
              </p>
              <label className="flex items-center gap-2 text-xs font-medium">
                <Checkbox className="size-4 border-amber-700 bg-white" checked={ack} onCheckedChange={(v) => setAck(v === true)} />I will simulate every program in woodWOP before running it
              </label>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-background p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Export</h3>
            <Button disabled={!ack || blocked || busy} onClick={() => exportKinds(EXPORTS.map((e) => e.kind))}>
              <Download /> Export all to folder
            </Button>
          </div>
          {blocked && <p className="mb-3 text-xs text-red-700">Fix the {counts.error} error(s) below before exporting MPR files.</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            {EXPORTS.map((e) => {
              const needsAck = e.kind === 'mpr'
              const disabled = busy || (needsAck && (!ack || blocked))
              return (
                <button
                  key={e.kind}
                  disabled={disabled}
                  onClick={() => exportKinds([e.kind])}
                  className="flex items-start gap-3 rounded-lg border p-3 text-left transition hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <e.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium">{e.label}</div>
                    <div className="text-[11px] text-muted-foreground">{e.desc}</div>
                  </div>
                </button>
              )
            })}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Files go into <span className="font-mono">{data.settings.outputFolder || '(choose folder)'}/{subfolder}</span>.
            {backend.kind === 'browser' && ' In the browser preview they download as a zip.'}
          </p>
        </div>

        <div className="rounded-xl border bg-background p-4">
          <div className="mb-3 flex items-center gap-3 text-sm">
            <h3 className="font-semibold">Validation</h3>
            <Badge variant={counts.error ? 'destructive' : 'outline'}>{counts.error} errors</Badge>
            <Badge variant="outline" className={counts.warning ? 'border-amber-300 bg-amber-50 text-amber-900' : ''}>
              {counts.warning} warnings
            </Badge>
            <Badge variant="outline">{counts.info} info</Badge>
          </div>
          <IssueList issues={out.issues} empty="No issues found." />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="rounded-xl border bg-background">
          <div className="border-b px-4 py-2.5 text-sm font-semibold">Programs</div>
          <ul className="divide-y">
            {files.map((f, i) => (
              <li key={f.name} className="flex items-center justify-between gap-2 px-4 py-2 text-xs">
                <div className="min-w-0">
                  <div className="truncate font-mono">{f.name}</div>
                  <div className="text-muted-foreground">
                    {out.programs[i] ? `${out.programs[i].sheet.placements.length} parts · ${out.programs[i].ops.length} operations` : 'Custom part turned over: underside drilling'}
                  </div>
                </div>
                <Button size="xs" variant="outline" onClick={() => setPreview(f)}>
                  View
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{preview?.name}</DialogTitle>
            <DialogDescription>Plain-text woodWOP MPR 4.0 (CRLF line endings, cp1252).</DialogDescription>
          </DialogHeader>
          <pre className="max-h-[65vh] overflow-auto rounded-md bg-stone-950 p-3 font-mono text-[11px] leading-relaxed text-stone-200">{preview?.text}</pre>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CustomPartsTab({ job, data }: { job: Job; data: AppData }) {
  const { go, savePart, deletePart } = useStore()
  const lib = data.library.partLibrary ?? []
  return (
    <div className="flex flex-col gap-5">
      <PartList
        parts={job.camParts ?? []}
        units={data.settings.units}
        materials={data.library.materials}
        onOpen={(id) => go({ page: 'part', partId: id, jobId: job.id })}
        onSave={(p) => savePart(p, job.id)}
        onDelete={(id) => deletePart(id, job.id)}
        emptyText="Shaped parts for this job (curved tops, brackets, signs). They use the job's materials and machine tools."
        extraActions={(p) => <DropdownMenuItem onSelect={() => savePart({ ...structuredClone(p), id: nanoid(10), updatedAt: new Date().toISOString() })}>Copy to part library</DropdownMenuItem>}
      />
      {lib.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Add from the part library</h3>
          <div className="flex flex-wrap gap-2">
            {lib.map((p) => (
              <Button key={p.id} variant="outline" size="sm" onClick={() => savePart({ ...structuredClone(p), id: nanoid(10), updatedAt: new Date().toISOString() }, job.id)}>
                <Plus /> {p.name}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
