/**
 * Fill with holes (CAD-18): fill the selected closed shapes (shapes inside them stay clear) with a
 * grid, staggered grid or rings of holes, every hole `margin` from the edges. Adds the holes as
 * circles on a layer, optionally with a drilling operation.
 */
import { Grid3x3 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { entityContours, makeEntity } from '@/cam/doc'
import { circle, pt } from '@/cam/geom'
import { DEFAULT_FILL, fillHoles, type HoleFill } from '@/cam/holeFill'
import { defaultOp } from '@/cam/ops'
import { ensureLayer } from '@/cam/query'
import type { CamPart } from '@/cam/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { formatLength, parseLength } from '@/core/units'
import type { UnitSystem } from '@/core/types'
import { ShapePreview } from './ShapePreview'

function Len({ label, value, units, onChange, deg }: { label: string; value: number; units: UnitSystem; onChange: (v: number) => void; deg?: boolean }) {
  return (
    <label className="flex flex-col gap-1 text-stone-400">
      {label}
      <input
        aria-label={label}
        defaultValue={deg ? String(value) : formatLength(value, units)}
        key={`${value}${units}`}
        onBlur={(e) => {
          const v = deg ? Number(e.target.value) : parseLength(e.target.value, units)
          if (v !== null && Number.isFinite(v)) onChange(v)
        }}
        className="h-7 rounded border border-white/10 bg-black/30 px-1.5 text-stone-100"
      />
    </label>
  )
}

export function FillHolesDialog({ part, sel, units, drilling, onClose, onChange }: { part: CamPart; sel: string[]; units: UnitSystem; drilling: boolean; onClose: () => void; onChange: (p: CamPart, msg: string) => void }) {
  const [f, setF] = useState<HoleFill>(DEFAULT_FILL)
  const [layer, setLayer] = useState(`DRILL_${DEFAULT_FILL.diameter}`)
  const [withOp, setWithOp] = useState(drilling)
  const boundary = useMemo(() => part.entities.filter((e) => sel.includes(e.id) && e.face === 1).flatMap(entityContours).filter((c) => c.closed), [part, sel])
  const res = useMemo(() => fillHoles(boundary, f), [boundary, f])
  const set = (patch: Partial<HoleFill>) => setF({ ...f, ...patch })
  const add = () => {
    const { part: p, id } = ensureLayer(part, layer)
    const es = res.centres.map((c) => makeEntity({ t: 'circle', c, r: f.diameter / 2 }, id))
    let next: CamPart = { ...p, entities: [...p.entities, ...es] }
    if (withOp) next = { ...next, ops: [...next.ops, { ...defaultOp('drill', es.map((e) => e.id)), name: `Drill ${es.length} × Ø${f.diameter}` }] }
    onChange(next, `${es.length} holes added on ${layer}${withOp ? ' with a drilling operation' : ''}`)
    onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="dark border-white/10 bg-[#15171c] text-stone-100 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Grid3x3 className="size-4" /> Fill with holes
          </DialogTitle>
          <DialogDescription className="text-stone-400">Fills the selected closed shapes; shapes inside them stay clear. The pattern is centred; every hole keeps the margin from the edges.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[1fr_250px]">
          <ShapePreview label="Holes preview" layers={[{ contours: boundary, stroke: '#fbbf24' }, { contours: res.centres.map((c) => circle(pt(c.x, c.y), f.diameter / 2)), stroke: '#38bdf8', width: 1 }]} />
          <div className="grid grid-cols-2 content-start gap-2 text-xs">
            <label className="col-span-2 flex flex-col gap-1 text-stone-400">
              Pattern
              <select aria-label="Pattern" value={f.pattern} onChange={(e) => set({ pattern: e.target.value as HoleFill['pattern'] })} className="h-7 rounded border border-white/10 bg-black/30 px-1 text-stone-100">
                <option value="grid">Grid</option>
                <option value="staggered">Staggered</option>
                <option value="radial">Rings round the middle</option>
              </select>
            </label>
            <Len label="Hole Ø" value={f.diameter} units={units} onChange={(diameter) => (set({ diameter }), setLayer(`DRILL_${Math.round(diameter * 100) / 100}`))} />
            <Len label="Margin" value={f.margin} units={units} onChange={(margin) => set({ margin })} />
            {f.pattern === 'radial' ? (
              <>
                <Len label="Ring spacing" value={f.ringStep} units={units} onChange={(ringStep) => set({ ringStep })} />
                <Len label="Along a ring" value={f.holeStep} units={units} onChange={(holeStep) => set({ holeStep })} />
              </>
            ) : (
              <>
                <Len label="Spacing X" value={f.spacingX} units={units} onChange={(spacingX) => set({ spacingX })} />
                <Len label={f.pattern === 'staggered' ? 'Row pitch' : 'Spacing Y'} value={f.spacingY} units={units} onChange={(spacingY) => set({ spacingY })} />
                <Len label="Angle °" deg value={f.angle} units={units} onChange={(angle) => set({ angle })} />
              </>
            )}
            <label className="col-span-2 flex flex-col gap-1 text-stone-400">
              Layer
              <input aria-label="Layer" value={layer} onChange={(e) => setLayer(e.target.value)} className="h-7 rounded border border-white/10 bg-black/30 px-1.5 font-mono text-stone-100" />
            </label>
            {drilling && (
              <label className="col-span-2 flex items-center gap-2">
                <Switch size="sm" checked={withOp} onCheckedChange={setWithOp} /> Add a drilling operation
              </label>
            )}
            <p className={res.error ? 'col-span-2 text-red-300' : 'col-span-2 text-stone-300'} data-testid="fill-status">
              {!boundary.length ? 'Select one or more closed shapes first.' : (res.error ?? `${res.centres.length} holes.`)}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!res.centres.length} onClick={add}>
            Add {res.centres.length} holes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
