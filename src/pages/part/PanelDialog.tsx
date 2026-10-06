/**
 * Panelling (NEW-05): split a drawing bigger than a sheet into sheet-sized panels with an overlap;
 * each panel becomes a part of its own (shapes cut at a join are closed again along it) with the
 * operations that machine its shapes.
 */
import { LayoutPanelLeft } from 'lucide-react'
import { useMemo, useState } from 'react'
import { entityContours } from '@/cam/doc'
import { rect } from '@/cam/geom'
import { panelize } from '@/cam/panelling'
import type { CamPart } from '@/cam/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatLength, parseLength } from '@/core/units'
import type { UnitSystem } from '@/core/types'
import { ShapePreview } from './ShapePreview'

export function PanelDialog({ part, sel, units, sheet, onClose, onMake }: { part: CamPart; sel: string[]; units: UnitSystem; sheet: { length: number; width: number }; onClose: () => void; onMake: (parts: CamPart[]) => void }) {
  const [opt, setOpt] = useState({ length: sheet.length, width: sheet.width, overlap: 50 })
  const ids = sel.length ? sel : undefined
  const res = useMemo(() => panelize(part, opt, ids), [part, opt, ids])
  const field = (k: keyof typeof opt, label: string) => (
    <label className="flex flex-col gap-1 text-stone-400">
      {label}
      <input
        aria-label={label}
        defaultValue={formatLength(opt[k], units)}
        key={`${k}${opt[k]}${units}`}
        onBlur={(e) => {
          const v = parseLength(e.target.value, units)
          if (v !== null && v > 0) setOpt({ ...opt, [k]: v })
        }}
        className="h-7 rounded border border-white/10 bg-black/30 px-1.5 text-stone-100"
      />
    </label>
  )
  const shapes = part.entities.filter((e) => e.face === 1 && (!ids || ids.includes(e.id))).flatMap(entityContours)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="dark border-white/10 bg-[#15171c] text-stone-100 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayoutPanelLeft className="size-4" /> Split into panels
          </DialogTitle>
          <DialogDescription className="text-stone-400">{ids ? 'The selected shapes' : 'Every shape on the top face'} split into panels no bigger than the size below, overlapping by the overlap. Each panel becomes a new part; this part is kept as it is.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[1fr_220px]">
          <ShapePreview label="Panels preview" layers={[{ contours: shapes, stroke: '#fbbf24' }, { contours: res.panels.map((p) => rect(p.box.x, p.box.y, p.box.w, p.box.h)), stroke: '#38bdf8', dash: '6 4', width: 1.2 }]} />
          <div className="flex flex-col gap-2 text-xs">
            {field('length', 'Panel length (X)')}
            {field('width', 'Panel width (Y)')}
            {field('overlap', 'Overlap')}
            <p className={res.error ? 'text-red-300' : 'text-stone-300'} data-testid="panel-status">
              {res.error ?? `${res.panels.length} panel(s), each ${formatLength(res.panels[0]?.box.w ?? 0, units)} × ${formatLength(res.panels[0]?.box.h ?? 0, units)}.`}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!res.panels.length}
            onClick={() => {
              onMake(res.panels.map((p) => p.part))
              onClose()
            }}
          >
            Make {res.panels.length} part(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
