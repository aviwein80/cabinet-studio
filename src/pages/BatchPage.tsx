import JSZip from 'jszip'
import { CircleStop, FileDown, FolderOpen, Inbox, Loader2, Play, Square, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { backend, type BatchStatus } from '@/app/backend'
import { useStore } from '@/app/store'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { BatchResult, BatchStatus as OrderStatus } from '@/core/batch'
import { featuresOf } from '@/core/features'
import { cn } from '@/lib/utils'

const COLUMNS: [string, string][] = [
  ['order', 'Job number. Rows with the same order become one job; empty = the file name.'],
  ['customer, job name', 'Printed on labels and reports.'],
  ['item, name', 'Item number and part name.'],
  ['type', 'part (rectangle), drawing (DXF in file) or door (style). Left empty, it is worked out from file or style.'],
  ['file', 'DXF next to the CSV. Its layers pick the machining through the rules table.'],
  ['rules', 'Machining rules set by name (default: the first set).'],
  ['style, hinge, pull, pull at', 'Door style (Slab, Shaker, Arched, Cathedral), left/right/none, none/knob/96/128/160.'],
  ['material', 'Material code from the library, e.g. MDF18.'],
  ['length, width, thickness', 'Shop units; inch fractions work (15 1/2). Doors: length = height.'],
  ['qty, grain, priority, kit, nest', 'grain yes keeps it along the sheet; higher priority nests first; nest N skips the row.'],
]

const EXAMPLE = [
  'order,customer,item,name,type,file,style,material,length,width,qty,grain,priority,kit,hinge,pull',
  'K2041,Weinreb,1,Pantry shelf,part,,,MDF18,762,304.8,4,no,,,,',
  'K2041,Weinreb,2,Sign blank,drawing,sign.dxf,,MDF18,,,1,,5,,,',
  'K2041,Weinreb,3,Pantry door,door,,Shaker,MDF18,1219.2,457.2,2,yes,,Pantry,left,128',
].join('\r\n')

const STATUS: Record<OrderStatus, { label: string; cls: string }> = {
  done: { label: 'Programs written', cls: 'bg-emerald-100 text-emerald-800' },
  blocked: { label: 'Blocked by checks', cls: 'bg-amber-100 text-amber-900' },
  failed: { label: 'Failed', cls: 'bg-red-100 text-red-800' },
  cancelled: { label: 'Cancelled', cls: 'bg-stone-200 text-stone-700' },
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function BatchPage() {
  const data = useStore((s) => s.data)!
  const camOut = featuresOf(data.settings).camMprOutput
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Batch runs"
        subtitle="Part lists in, nested programs and labels out, with nobody at the screen."
        actions={
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => download('batch-example.csv', new Blob([EXAMPLE], { type: 'text/csv' }))}>
            <FileDown className="size-4" /> Example list
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto grid max-w-6xl gap-5 p-5 lg:grid-cols-[1fr_360px]">
          <div className="flex flex-col gap-5">
            {backend.batch ? <WatcherCard /> : null}
            <RunNowCard />
          </div>
          <aside className="flex flex-col gap-3 rounded-xl border bg-background p-4 text-xs">
            <h3 className="text-[13px] font-semibold">The part list</h3>
            <p className="text-muted-foreground">One row per part. Headers in any order, upper or lower case.</p>
            <dl className="flex flex-col gap-2">
              {COLUMNS.map(([k, v]) => (
                <div key={k}>
                  <dt className="font-mono text-[11px] font-medium">{k}</dt>
                  <dd className="text-muted-foreground">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-amber-900">
              Each job goes through the same export checks as the Output tab. A job with errors gets its report only, no programs.
              {!camOut && ' Custom-part machining output is off on the Machine page, so drawings with pockets or holes are held back.'}
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

function WatcherCard() {
  const bridge = backend.batch!
  const settings = useStore((s) => s.data!.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const cfg = settings.batch ?? { inbox: '', outbox: '' }
  const [status, setStatus] = useState<BatchStatus | null>(null)
  const [ack, setAck] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    void bridge.status().then((s) => alive && setStatus(s))
    const off = bridge.onEvent(() => void bridge.status().then((s) => alive && setStatus(s)))
    return () => {
      alive = false
      off()
    }
  }, [bridge])
  useEffect(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight }), [status?.log.length])

  const set = (patch: Partial<typeof cfg>) => updateSettings((s) => void (s.batch = { ...cfg, ...patch }))
  const pick = async (key: 'inbox' | 'outbox') => {
    const p = await bridge.pickFolder(key === 'inbox' ? 'Folder to watch for part lists' : 'Folder for programs and labels')
    if (p) set({ [key]: p })
  }
  const running = !!status?.running
  return (
    <section className="rounded-xl border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h3 className="text-[13px] font-semibold">Folder watcher</h3>
          <p className="text-xs text-muted-foreground">Drop a CSV (and its DXFs) into the inbox. Finished lists move to done, problems or cancelled.</p>
        </div>
        <Badge variant={running ? 'default' : 'secondary'}>{running ? (status?.busy ? `Working on ${status.busy}` : 'Watching') : 'Stopped'}</Badge>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        {(['inbox', 'outbox'] as const).map((k) => (
          <div key={k} className="flex flex-col gap-1.5">
            <Label className="text-xs">{k === 'inbox' ? 'Inbox (watched)' : 'Output folder'}</Label>
            <div className="flex gap-1.5">
              <Input className="h-8 font-mono text-xs" value={cfg[k]} placeholder={k === 'inbox' ? 'e.g. \\\\OFFICE\\cut-lists' : 'e.g. \\\\N200-PC\\mpr'} onChange={(e) => set({ [k]: e.target.value })} disabled={running} />
              <Button size="sm" variant="outline" className="h-8" onClick={() => void pick(k)} disabled={running} aria-label={`Choose ${k}`}>
                <FolderOpen className="size-4" />
              </Button>
            </div>
          </div>
        ))}
        <label className="flex items-start gap-2 text-xs sm:col-span-2">
          <Checkbox checked={ack || running} onCheckedChange={(v) => setAck(v === true)} disabled={running} className="mt-0.5" />
          <span>I understand these programs are generated, not machine-proven, and each one is simulated in woodWOP before it runs on the N-200.</span>
        </label>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          {running ? (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void bridge.stop().then(setStatus)}>
              <Square className="size-3.5" /> Stop watching
            </Button>
          ) : (
            <Button size="sm" className="gap-1.5" disabled={!ack || !cfg.inbox || !cfg.outbox} onClick={() => void bridge.start({ inbox: cfg.inbox, outbox: cfg.outbox }).then(setStatus)}>
              <Play className="size-3.5" /> Start watching
            </Button>
          )}
          <Button size="sm" variant="destructive" className="gap-1.5" disabled={!status?.busy} onClick={() => void bridge.cancel().then((s) => (setStatus(s), toast('Cancelling the current list')))}>
            <CircleStop className="size-3.5" /> Cancel current list
          </Button>
        </div>
      </div>
      <div ref={logRef} className="max-h-56 overflow-auto border-t bg-stone-950 px-4 py-2 font-mono text-[11px] leading-5 text-stone-200">
        {status?.log.length ? status.log.map((l, i) => <div key={i}>{`${l.at.slice(11, 19)}  ${l.msg}`}</div>) : <div className="text-stone-500">Nothing yet.</div>}
      </div>
    </section>
  )
}

function RunNowCard() {
  const data = useStore((s) => s.data)!
  const [csv, setCsv] = useState<File | null>(null)
  const [drawings, setDrawings] = useState<File[]>([])
  const [log, setLog] = useState<string[]>([])
  const [result, setResult] = useState<BatchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const worker = useRef<Worker | null>(null)

  useEffect(() => () => worker.current?.terminate(), [])

  const pickFiles = (list: FileList | null) => {
    const fs = [...(list ?? [])]
    const c = fs.find((f) => /\.csv$/i.test(f.name))
    if (c) setCsv(c)
    const d = fs.filter((f) => /\.dxf$/i.test(f.name))
    if (d.length) setDrawings((prev) => [...prev.filter((p) => !d.some((x) => x.name === p.name)), ...d])
  }

  const run = async () => {
    if (!csv) return
    setBusy(true)
    setResult(null)
    setLog([])
    const files = Object.fromEntries(await Promise.all(drawings.map(async (f) => [f.name, await f.text()] as const)))
    const w = new Worker(new URL('../app/batch.worker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    w.onmessage = (e: MessageEvent<{ type: 'log'; msg: string } | { type: 'done'; result: BatchResult } | { type: 'error'; message: string }>) => {
      const m = e.data
      if (m.type === 'log') setLog((l) => [...l, m.msg])
      else {
        if (m.type === 'done') setResult(m.result)
        else toast.error('Batch run failed', { description: m.message })
        setBusy(false)
        w.terminate()
        worker.current = null
      }
    }
    w.postMessage({ csvName: csv.name, csvText: await csv.text(), drawings: files, data })
  }

  const cancel = () => {
    worker.current?.terminate()
    worker.current = null
    setBusy(false)
    setLog((l) => [...l, 'Cancelled. Nothing was written.'])
  }

  const save = async () => {
    if (!result) return
    const zip = new JSZip()
    for (const o of result.orders) for (const f of o.files) zip.folder(o.folder)!.file(f.name, f.data)
    const name = `${result.csv.replace(/\.csv$/i, '')}_batch.zip`
    const blob = await zip.generateAsync({ type: 'blob' })
    if (backend.kind === 'desktop') {
      const at = await backend.saveFile({ name, data: new Uint8Array(await blob.arrayBuffer()) }, [{ name: 'Zip', extensions: ['zip'] }])
      if (at) toast.success('Saved', { description: at })
    } else download(name, blob)
  }

  return (
    <section className="rounded-xl border bg-background">
      <div className="border-b px-4 py-3">
        <h3 className="text-[13px] font-semibold">Run a list now</h3>
        <p className="text-xs text-muted-foreground">Pick a CSV and the DXF drawings it names. Every order is nested and written to one zip.</p>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <label
          className={cn('flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-6 text-center text-xs text-muted-foreground transition hover:bg-muted/40', busy && 'pointer-events-none opacity-60')}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => (e.preventDefault(), pickFiles(e.dataTransfer.files))}
        >
          <Upload className="size-5" />
          <span className="font-medium text-foreground">{csv ? csv.name : 'Choose or drop the part list (CSV)'}</span>
          <span>{drawings.length ? `${drawings.length} drawing${drawings.length === 1 ? '' : 's'}: ${drawings.map((d) => d.name).join(', ')}` : 'Add the DXF files in the same pick'}</span>
          <input type="file" multiple accept=".csv,.dxf,text/csv" className="sr-only" onChange={(e) => pickFiles(e.target.files)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="gap-1.5" disabled={!csv || busy} onClick={() => void run()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} Run
          </Button>
          <Button size="sm" variant="destructive" className="gap-1.5" disabled={!busy} onClick={cancel}>
            <CircleStop className="size-3.5" /> Cancel
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" disabled={!result || busy || !result.orders.some((o) => o.files.length)} onClick={() => void save()}>
            <FileDown className="size-3.5" /> Save outputs (.zip)
          </Button>
          {(csv || drawings.length > 0) && !busy && (
            <Button size="sm" variant="ghost" onClick={() => (setCsv(null), setDrawings([]), setResult(null), setLog([]))}>
              Clear
            </Button>
          )}
        </div>
        {log.length > 0 && (
          <div className="max-h-40 overflow-auto rounded-md bg-stone-950 px-3 py-2 font-mono text-[11px] leading-5 text-stone-200">
            {log.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        )}
        {result && <ResultTable result={result} />}
        {!csv && !result && (
          <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <Inbox className="size-4 shrink-0" /> No list chosen yet. “Example list” at the top gives a file to start from.
          </div>
        )}
      </div>
    </section>
  )
}

function ResultTable({ result }: { result: BatchResult }) {
  return (
    <div className="flex flex-col gap-2">
      {result.rowErrors.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
          {result.rowErrors.map((e) => (
            <div key={`${e.row}-${e.message}`}>
              Row {e.row}: {e.message}
            </div>
          ))}
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Result</TableHead>
              <TableHead className="text-right">Sheets</TableHead>
              <TableHead className="text-right">Parts</TableHead>
              <TableHead>Files</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.orders.map((o) => (
              <TableRow key={o.number} className="align-top">
                <TableCell className="font-mono text-xs">{o.number}</TableCell>
                <TableCell>
                  <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', STATUS[o.status].cls)}>{STATUS[o.status].label}</span>
                  {o.errors.slice(0, 3).map((e) => (
                    <div key={e} className="mt-1 max-w-xs text-[11px] text-red-700">
                      {e}
                    </div>
                  ))}
                </TableCell>
                <TableCell className="text-right tabular-nums">{o.sheets}</TableCell>
                <TableCell className="text-right tabular-nums">{o.parts}</TableCell>
                <TableCell className="text-[11px] text-muted-foreground">{o.files.map((f) => f.name).join(', ')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
