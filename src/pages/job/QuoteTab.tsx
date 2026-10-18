/**
 * Job-1: the job's quote: board, edgeband, hardware, labour, markup, sales tax and the total. A line
 * or item without a price says "price not set" with a Configure badge and is left out of the sums.
 */
import { Download, FileText, Plus, Trash2 } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { backend } from '@/app/backend'
import { bomCsv } from '@/app/jobOutput'
import { ConfigureBadge } from '@/components/Configure'
import { useConfigureTarget } from '@/components/configureFocus'
import { NumField } from '@/components/fields'
import { PriceInput } from '@/components/PriceField'
import { enterApplies } from '@/components/enterApplies'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { JobOutput } from '@/core/pipeline'
import { anyPriced, jobQuote, lineNote, MANUAL_LABEL, money, totalNote, unitPrice } from '@/core/quote'
import { quotePdf } from '@/core/quotePdf'
import type { AppData, Job, QuoteManualLine } from '@/core/types'
import { cn } from '@/lib/utils'

/** "1 sheet", "3 sheets" ("pcs", "ft" and "m" as they are). */
const one = (qty: number, unit: string) => (qty === 1 && /[a-z]s$/.test(unit) && unit !== 'pcs' ? unit.slice(0, -1) : unit)

export function QuoteTab({ job, data, out, setJob }: { job: Job; data: AppData; out: JobOutput; setJob: (fn: (j: Job) => void) => void }) {
  const q = useMemo(() => jobQuote(job, out, data), [job, out, data])
  const $ = (v: number) => money(v, q.currency)
  const base = job.number.replace(/[^A-Za-z0-9_-]+/g, '-')
  const save = async (name: string, d: string | Uint8Array, ext: string, label: string) => {
    const where = await backend.saveFile({ name, data: d }, [{ name: label, extensions: [ext] }])
    if (where) toast.success(`Saved ${where}`)
  }
  const tn = totalNote(q)
  const some = anyPriced(q)
  // nothing priced yet: no amounts at all, "price not set" (never $0.00)
  const amt = (v: number) => (some ? $(v) : <NotSet text="price not set" />)
  const NotSet = ({ text, item }: { text: string; item?: (typeof q.unpriced)[number] }) => (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5 text-amber-800 dark:text-amber-300">
      {text}
      {item && <ConfigureBadge item={item} />}
    </span>
  )
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]" data-testid="quote">
      <div className="flex min-w-0 flex-col gap-5">
        <div className="rounded-xl border bg-background">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
            <h3 className="text-sm font-semibold">Quote</h3>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => save(`${base}_quote.pdf`, quotePdf(job, q, data.settings.shopName), 'pdf', 'PDF')}>
                <FileText /> Quote PDF
              </Button>
              <Button size="sm" variant="outline" onClick={() => save(`${base}_bom.csv`, bomCsv(out, data, job), 'csv', 'CSV')}>
                <Download /> BOM CSV with quote
              </Button>
            </div>
          </div>
          <Table>
            <TableBody>
              {q.lines.map((l) => {
                const note = lineNote(l)
                const first = l.items.find((i) => i.missing)?.missing
                return (
                  <TableRow key={l.key} data-line={l.key}>
                    <TableCell className="w-28 font-medium">{l.label}</TableCell>
                    <TableCell className="text-xs whitespace-normal text-muted-foreground">
                      {l.key === 'labour'
                        ? `${q.labour.hours} h${q.labour.rate !== null ? ` at ${$(q.labour.rate)}/h` : ''}`
                        : l.items.length
                          ? l.items.map((i) => `${i.qty} ${one(i.qty, i.unit)} ${i.code}`).join(' · ')
                          : 'none'}
                      {l.unconfirmed.length > 0 && (
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          {l.unconfirmed.map((u) => (
                            <span key={u.key} className="inline-flex items-center gap-1 text-[11px]">
                              {u.label.replace('Labour per ', '')} {u.value} <ConfigureBadge item={u} />
                            </span>
                          ))}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="w-64 text-right font-mono tabular-nums">
                      {note && l.unpriced === l.items.length ? (
                        <NotSet text="price not set" item={first} />
                      ) : (
                        <span className="flex flex-col items-end gap-0.5">
                          {$(l.amount)}
                          {note && <NotSet text={note} item={first} />}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
              <TableRow className="border-t-2">
                <TableCell className="font-medium">Subtotal</TableCell>
                <TableCell />
                <TableCell className="text-right font-mono tabular-nums">{amt(q.subtotal)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Markup</TableCell>
                <TableCell className="text-xs text-muted-foreground">{q.markupPct} % of the subtotal</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{amt(q.markup)}</TableCell>
              </TableRow>
              {q.manual.items.length > 0 && (
                // Library-1: the lines typed in by hand, as quoted (not marked up)
                <TableRow data-line="manual">
                  <TableCell className="font-medium">{MANUAL_LABEL}</TableCell>
                  <TableCell className="text-xs whitespace-normal text-muted-foreground">{q.manual.items.map((i) => `${i.qty} × ${i.name}${i.taxable ? '' : ' (no tax)'}`).join(' · ')}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {q.manual.unpriced === q.manual.items.length ? (
                      <NotSet text="price not set" item={q.manual.items.find((i) => i.missing)?.missing} />
                    ) : (
                      <span className="flex flex-col items-end gap-0.5">
                        {$(q.manual.amount)}
                        {q.manual.unpriced > 0 && <NotSet text={lineNote({ items: q.manual.items, unpriced: q.manual.unpriced })} item={q.manual.items.find((i) => i.missing)?.missing} />}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              )}
              <TableRow>
                <TableCell className="font-medium">Sales tax</TableCell>
                <TableCell className="text-xs text-muted-foreground">{q.taxPct} % of subtotal + markup{q.manual.items.length > 0 ? ` + taxable ${MANUAL_LABEL.toLowerCase()} lines` : ''}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{amt(q.tax)}</TableCell>
              </TableRow>
              <TableRow className="border-t-2 text-base">
                <TableCell className="font-semibold">Total</TableCell>
                <TableCell className="text-xs">{tn && <span className="text-amber-800 dark:text-amber-300">{tn}: those items are left out</span>}</TableCell>
                <TableCell className="text-right font-mono font-semibold tabular-nums" data-testid="quote-total">{amt(q.total)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <div className="overflow-x-auto rounded-xl border bg-background">
          <div className="border-b px-4 py-2.5 text-sm font-semibold">Items</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Line</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Each</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...q.lines, { key: 'manual', label: MANUAL_LABEL, items: q.manual.items }].flatMap((l) =>
                l.items.map((i) => (
                  <TableRow key={l.key + ('id' in i ? i.id : i.code)}>
                    <TableCell className="text-xs whitespace-normal text-muted-foreground">{l.label}</TableCell>
                    <TableCell className="text-xs">
                      <span className="font-mono">{i.code}</span> {i.name !== i.code && <span className="text-muted-foreground">{i.name}</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{i.qty}</TableCell>
                    <TableCell className="text-xs">{i.unit}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{i.price === null ? '' : unitPrice(i.price)}</TableCell>
                    <TableCell className={cn('text-right font-mono text-xs tabular-nums')}>{i.amount === null ? <NotSet text="price not set" item={i.missing} /> : i.amount.toFixed(2)}</TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <div className="grid gap-3 rounded-xl border bg-background p-4">
          <div className="text-sm font-semibold">This job</div>
          <NumField label="Markup" suffix="%" min={0} max={1000} step={1} value={job.quote?.markupPct ?? 0} onChange={(v) => setJob((j) => (j.quote = { ...(j.quote ?? {}), markupPct: v }))} />
          <NumField label="Sales tax" suffix="%" min={0} max={100} step={0.25} value={job.quote?.taxPct ?? 0} onChange={(v) => setJob((j) => (j.quote = { ...(j.quote ?? {}), taxPct: v }))} hint="On the subtotal plus markup. Both start at 0." />
        </div>
        <ManualLines job={job} setJob={setJob} currency={q.currency} />
        <JobHardwarePanel job={job} data={data} setJob={setJob} />
        <div className="rounded-xl border bg-background p-4 text-xs text-muted-foreground">
          <p>
            Board is the whole sheets the nest uses, at each material’s price. Edgeband is the BOM’s running length (with the trimming allowance) per {q.units === 'in' ? 'foot' : 'metre'}. Hardware is every BOM line per piece. Labour is the time per cabinet, drawer, door and sheet cut at the shop rate (Settings → Pricing).
          </p>
          <p className="mt-2">Every price is your own. One not entered is “price not set”, never $0, and is left out of the total until it is entered.</p>
        </div>
        {q.unpriced.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950" data-testid="quote-unpriced">
            <div className="font-semibold">Prices not set ({q.unpriced.length})</div>
            {q.unpriced.map((u) => (
              <span key={u.key} className="flex items-center justify-between gap-2">
                {u.label} <ConfigureBadge item={u} />
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Library-1: lines typed into the quote by hand (installation, delivery, a part bought in): a
 * description, a quantity, a unit price and whether it is taxed. Saved with the job; in the quote, the
 * BOM and areas CSVs and the Quote PDF. A line's price left empty is "price not set" (never $0).
 */
function ManualLines({ job, setJob, currency }: { job: Job; setJob: (fn: (j: Job) => void) => void; currency: string }) {
  useConfigureTarget(['quote'])
  const lines = job.quote?.lines ?? []
  const set = (id: string, fn: (l: QuoteManualLine) => void) =>
    setJob((j) => {
      j.quote = { ...(j.quote ?? {}), lines: (j.quote?.lines ?? []).map((l) => (l.id === id ? (() => { const n = { ...l }; fn(n); return n })() : l)) }
    })
  const add = () => setJob((j) => (j.quote = { ...(j.quote ?? {}), lines: [...(j.quote?.lines ?? []), { id: `ql-${nanoid(6)}`, description: '', qty: 1, taxable: true }] }))
  const remove = (id: string) =>
    setJob((j) => {
      const rest = (j.quote?.lines ?? []).filter((l) => l.id !== id)
      j.quote = { ...(j.quote ?? {}), lines: rest }
      if (!rest.length) delete j.quote.lines
    })
  return (
    <div className="grid min-w-0 grid-cols-1 gap-2 rounded-xl border bg-background p-4" data-testid="quote-manual">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">{MANUAL_LABEL} lines</div>
        <Button size="xs" variant="outline" onClick={add}>
          <Plus /> Add line
        </Button>
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">Installation, delivery, a part bought in. Priced as you type them (after the markup); taxed when ticked.</p>
      {lines.map((l, i) => (
        <div key={l.id} className="grid grid-cols-[1fr_auto] gap-1.5 rounded-md border p-2" data-cfg={`quote:line:${l.id}`}>
          <Input className="h-8" aria-label={`Line ${i + 1} description`} placeholder={`Line ${i + 1}: description`} defaultValue={l.description} onKeyDown={enterApplies} onBlur={(e) => e.target.value !== l.description && set(l.id, (x) => (x.description = e.target.value))} />
          <Button size="icon-sm" variant="ghost" aria-label={`Remove line ${i + 1}`} onClick={() => remove(l.id)}>
            <Trash2 />
          </Button>
          <div className="col-span-2 flex flex-wrap items-center gap-2 text-xs">
            <label className="flex items-center gap-1">
              Qty <QtyInput value={l.qty} onChange={(v) => set(l.id, (x) => (x.qty = v))} label={`Line ${i + 1} quantity`} />
            </label>
            <label className="flex items-center gap-1">
              {currency} each <PriceInput className="h-7 w-24 text-right text-xs" label={`Line ${i + 1} unit price`} value={l.unitPrice} onChange={(v) => set(l.id, (x) => (v === undefined ? delete x.unitPrice : (x.unitPrice = v)))} />
            </label>
            <label className="flex items-center gap-1.5">
              <Checkbox checked={l.taxable} onCheckedChange={(v) => set(l.id, (x) => (x.taxable = v === true))} aria-label={`Line ${i + 1} taxable`} /> Taxable
            </label>
            {l.unitPrice === undefined && <ConfigureBadge item={{ key: `quote:line:${l.id}`, label: `${l.description || `Line ${i + 1}`}: unit price`, value: 'price not set', group: 'Pricing', target: { kind: 'quote', key: `line:${l.id}` } }} />}
          </div>
        </div>
      ))}
    </div>
  )
}

function QtyInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const [text, setText] = useState(String(value))
  const [last, setLast] = useState(value)
  if (last !== value) {
    setLast(value)
    setText(String(value))
  }
  return (
    <Input
      className="h-7 w-16 text-right text-xs tabular-nums"
      inputMode="decimal"
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      onBlur={() => {
        const n = Number(text.trim().replace(',', '.'))
        if (Number.isFinite(n) && n >= 0 && n !== value) onChange(n)
        else setText(String(value))
      }}
    />
  )
}

/**
 * Library-1: a library hardware row added to the job by hand (a sliding-door track kit), so many per
 * job. It goes into the BOM and the quote's hardware line (at the library's price per piece).
 */
function JobHardwarePanel({ job, data, setJob }: { job: Job; data: AppData; setJob: (fn: (j: Job) => void) => void }) {
  const lib = data.library.hardware
  const rows = job.hardware ?? []
  const [pick, setPick] = useState<string>('')
  const add = () => {
    if (!pick) return
    setJob((j) => {
      const list = j.hardware ?? []
      const same = list.find((h) => h.hardwareId === pick)
      j.hardware = same ? list.map((h) => (h.id === same.id ? { ...h, qty: h.qty + 1 } : h)) : [...list, { id: `jh-${nanoid(6)}`, hardwareId: pick, qty: 1 }]
    })
    setPick('')
  }
  const set = (id: string, qty: number) => setJob((j) => (j.hardware = (j.hardware ?? []).map((h) => (h.id === id ? { ...h, qty } : h))))
  const remove = (id: string) =>
    setJob((j) => {
      j.hardware = (j.hardware ?? []).filter((h) => h.id !== id)
      if (!j.hardware.length) delete j.hardware
    })
  return (
    <div className="grid min-w-0 grid-cols-1 gap-2 rounded-xl border bg-background p-4" data-testid="job-hardware">
      <div className="text-sm font-semibold">Hardware added to this job</div>
      <p className="text-[11px] leading-snug text-muted-foreground">A library hardware row the cabinets do not bring by themselves (a sliding-door track kit). Goes into the BOM and the quote at its library price.</p>
      <div className="flex min-w-0 gap-1.5">
        <Select value={pick} onValueChange={setPick}>
          <SelectTrigger className="h-8 w-full min-w-0 flex-1 [&>span]:truncate" aria-label="Library hardware to add">
            <SelectValue placeholder="Choose library hardware" />
          </SelectTrigger>
          <SelectContent>
            {lib.map((h) => (
              <SelectItem key={h.id} value={h.id}>
                {h.code} · {h.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" disabled={!pick} onClick={add}>
          <Plus /> Add
        </Button>
      </div>
      {rows.map((r) => {
        const h = lib.find((x) => x.id === r.hardwareId)
        return (
          <div key={r.id} className="flex min-w-0 items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate">
              {h ? (
                <>
                  <span className="font-mono">{h.code}</span> {h.name}
                </>
              ) : (
                <span className="text-amber-800">No longer in the library ({r.hardwareId}): left out</span>
              )}
            </span>
            <QtyInput value={r.qty} onChange={(v) => set(r.id, v)} label={`${h?.code ?? r.hardwareId} quantity`} />
            <span className="text-muted-foreground">pcs</span>
            <Button size="icon-xs" variant="ghost" aria-label={`Remove ${h?.code ?? r.hardwareId}`} onClick={() => remove(r.id)}>
              <Trash2 />
            </Button>
          </div>
        )
      })}
    </div>
  )
}
