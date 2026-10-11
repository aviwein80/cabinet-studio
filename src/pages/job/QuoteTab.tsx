/**
 * Job-1: the job's quote: board, edgeband, hardware, labour, markup, sales tax and the total. A line
 * or item without a price says "price not set" with a Configure badge and is left out of the sums.
 */
import { Download, FileText } from 'lucide-react'
import { useMemo } from 'react'
import { toast } from 'sonner'
import { backend } from '@/app/backend'
import { bomCsv } from '@/app/jobOutput'
import { ConfigureBadge } from '@/components/Configure'
import { NumField } from '@/components/fields'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { JobOutput } from '@/core/pipeline'
import { anyPriced, jobQuote, lineNote, money, totalNote, unitPrice } from '@/core/quote'
import { quotePdf } from '@/core/quotePdf'
import type { AppData, Job } from '@/core/types'
import { cn } from '@/lib/utils'

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
    <div className="grid gap-5 xl:grid-cols-[1fr_380px]" data-testid="quote">
      <div className="flex flex-col gap-5">
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
                    <TableCell className="text-xs text-muted-foreground">
                      {l.key === 'labour'
                        ? `${q.labour.hours} h${q.labour.rate !== null ? ` at ${$(q.labour.rate)}/h` : ''}`
                        : l.items.length
                          ? l.items.map((i) => `${i.qty} ${i.unit} ${i.code}`).join(' · ')
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
              <TableRow>
                <TableCell className="font-medium">Sales tax</TableCell>
                <TableCell className="text-xs text-muted-foreground">{q.taxPct} % of subtotal + markup</TableCell>
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
              {q.lines.flatMap((l) =>
                l.items.map((i) => (
                  <TableRow key={l.key + i.code}>
                    <TableCell className="text-xs text-muted-foreground">{l.label}</TableCell>
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

      <div className="flex flex-col gap-3">
        <div className="grid gap-3 rounded-xl border bg-background p-4">
          <div className="text-sm font-semibold">This job</div>
          <NumField label="Markup" suffix="%" min={0} max={1000} step={1} value={job.quote?.markupPct ?? 0} onChange={(v) => setJob((j) => (j.quote = { ...(j.quote ?? {}), markupPct: v }))} />
          <NumField label="Sales tax" suffix="%" min={0} max={100} step={0.25} value={job.quote?.taxPct ?? 0} onChange={(v) => setJob((j) => (j.quote = { ...(j.quote ?? {}), taxPct: v }))} hint="On the subtotal plus markup. Both start at 0." />
        </div>
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
