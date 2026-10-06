/**
 * Print to scale (CAD-08, NEW-21): the drawing, its dimensions and annotations as a PDF at 1:N on one or more sheets.
 * Print it at "actual size" and measure the check bar before using the print as a template.
 */
import { Printer } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { backend } from '@/app/backend'
import { DEFAULT_PRINT, PAPER, type PaperSize, printPdf, printPlan, type PrintOptions } from '@/cam/print'
import type { CamPart } from '@/cam/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import type { UnitSystem } from '@/core/types'

const SCALES = [1, 2, 4, 5, 10, 20, 25, 50]

export function PrintDialog({ part, units, onClose }: { part: CamPart; units: UnitSystem; onClose: () => void }) {
  const [opt, setOpt] = useState<PrintOptions>({ ...DEFAULT_PRINT, units, scale: 10 })
  const plan = useMemo(() => printPlan(part, opt), [part, opt])
  const pg = plan.pages[0]
  const save = async () => {
    const data = printPdf(part, plan, opt)
    const where = await backend.saveFile({ name: `${part.name.replace(/[^\w-]+/g, '-') || 'part'}-1to${opt.scale}.pdf`, data }, [{ name: 'PDF', extensions: ['pdf'] }])
    if (where) toast.success(`Saved ${where}`, { description: 'Print at actual size (100 %), then measure the check bar.' })
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="dark border-white/10 bg-[#15171c] text-stone-100 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="size-4" /> Print to scale
          </DialogTitle>
          <DialogDescription className="text-stone-400">Face 1, its dimensions, hatching and detail views at 1:N; layer line types print with dashes in paper mm. Big drawings are split over several sheets with crop marks and an overlap strip for taping. Each sheet has a check bar: measure it before trusting the print.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[1fr_240px]">
          <svg viewBox={`0 0 ${plan.paper.w} ${plan.paper.h}`} className="max-h-[55vh] w-full rounded-md bg-white" role="img" aria-label="First sheet">
            <rect x={plan.area.x} y={plan.area.y} width={plan.area.w} height={plan.area.h} fill="none" stroke="#cbd5e1" strokeDasharray="2 2" strokeWidth={0.3} />
            {pg.lines.map((l, i) => (
              <polyline key={i} points={l.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#111" strokeWidth={0.3} />
            ))}
            {pg.texts.map((t, i) => (
              <text key={i} x={t.at.x} y={t.at.y - 1} fontSize={3} textAnchor="middle" fill="#111">
                {t.text}
              </text>
            ))}
            <line x1={plan.area.x} x2={plan.area.x + plan.bar.length} y1={plan.area.y + plan.area.h + 7} y2={plan.area.y + plan.area.h + 7} stroke="#111" strokeWidth={0.5} />
          </svg>
          <div className="flex flex-col gap-3 text-xs">
            <label className="flex flex-col gap-1 text-stone-400">
              Scale
              <select aria-label="Scale" value={opt.scale} onChange={(e) => setOpt({ ...opt, scale: Number(e.target.value) })} className="h-8 rounded border border-white/10 bg-black/30 px-1.5 text-stone-100">
                {SCALES.map((s) => (
                  <option key={s} value={s}>
                    1:{s}
                    {s === 1 ? ' (full size)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-stone-400">
              Paper
              <select aria-label="Paper" value={opt.paper} onChange={(e) => setOpt({ ...opt, paper: e.target.value as PaperSize })} className="h-8 rounded border border-white/10 bg-black/30 px-1.5 text-stone-100">
                {(Object.keys(PAPER) as PaperSize[]).map((k) => (
                  <option key={k} value={k}>
                    {PAPER[k].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <Switch size="sm" checked={opt.landscape} onCheckedChange={(landscape) => setOpt({ ...opt, landscape })} /> Landscape
            </label>
            <label className="flex items-center gap-2">
              <Switch size="sm" checked={opt.dims} onCheckedChange={(dims) => setOpt({ ...opt, dims })} /> Dimensions
            </label>
            <label className="flex items-center gap-2">
              <Switch size="sm" checked={opt.notes !== false} onCheckedChange={(notes) => setOpt({ ...opt, notes })} /> Hatching and detail views
            </label>
            <p className="text-stone-400">
              {plan.pages.length} sheet{plan.pages.length === 1 ? '' : 's'} ({plan.cols} across × {plan.rows} up). {plan.bar.label}.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => void save()}>Save PDF</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
