import { Drill } from 'lucide-react'
import { useState } from 'react'
import { defaultOp } from '@/cam/ops'
import type { CamPart, HardwarePattern } from '@/cam/types'
import { NumField } from '@/components/fields'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { edgeFrame, patternPoints, placePattern, type RefEdge } from '@/core/hardware/patterns'
import { StatusBadge } from '../library/PatternsTab'

const EDGES: { value: RefEdge; label: string }[] = [
  { value: 'bottom', label: 'Bottom edge (Y = 0), left to right' },
  { value: 'right', label: 'Right edge, bottom to top' },
  { value: 'top', label: 'Top edge, right to left' },
  { value: 'left', label: 'Left edge, top to bottom' },
]

const defaultAt = (p: HardwarePattern | undefined, edgeLength: number) => (p && p.holes.every((h) => h.x > 0) ? 0 : Math.min(100, edgeLength / 2))

export function PatternDialog({ open, onOpenChange, part, patterns, withOp, onPlace }: { open: boolean; onOpenChange: (o: boolean) => void; part: CamPart; patterns: HardwarePattern[]; withOp: boolean; onPlace: (p: CamPart, message: string) => void }) {
  const [id, setId] = useState(patterns[0]?.id ?? '')
  const [edge, setEdge] = useState<RefEdge>('bottom')
  const pattern = patterns.find((p) => p.id === id)
  const frame = edgeFrame(edge, part)
  const [at, setAt] = useState(() => defaultAt(pattern, frame.length))
  const [mirror, setMirror] = useState(false)
  const [addOp, setAddOp] = useState(withOp)
  const placed = pattern ? placePattern(part, pattern, { edge, at, mirror }) : null
  const pts = pattern ? patternPoints(pattern, part, { edge, at, mirror }) : []
  const pad = Math.max(part.length, part.width) * 0.04

  const place = () => {
    if (!pattern || !placed) return
    let next = placed.part
    if (addOp && withOp) {
      const op = { ...defaultOp('drill', placed.ids), name: `Drill ${pattern.name}`, levels: { safeZ: 20, rapidZ: 3, depth: Math.max(...pattern.holes.map((h) => h.depth)), through: false, stockZ: 0, passDepth: 0 } }
      next = { ...next, ops: [...next.ops, op] }
    }
    onPlace(next, `Added ${placed.ids.length} hole${placed.ids.length === 1 ? '' : 's'} for ${pattern.name}${addOp && withOp ? ' and a drilling operation' : ''}`)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dark border-white/10 bg-[#15171c] text-stone-100 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Drill className="size-4" /> Place hardware holes
          </DialogTitle>
          <DialogDescription className="text-stone-400">Verified and approved drilling patterns only. The pattern’s x runs along the chosen edge; y goes into the part.</DialogDescription>
        </DialogHeader>
        {!patterns.length ? (
          <p className="rounded-md border border-white/10 p-6 text-center text-sm text-stone-400">No approved patterns yet. Add them under Library → Drilling patterns.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-[1fr_260px]">
            <svg viewBox={`${-pad} ${-pad} ${part.length + 2 * pad} ${part.width + 2 * pad}`} className="max-h-[50vh] w-full rounded-md bg-black/40" aria-label="Where the holes go">
              <g transform={`translate(0 ${part.width}) scale(1 -1)`}>
                <rect x={0} y={0} width={part.length} height={part.width} fill="#c9a97926" stroke="#ffffff55" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                <line x1={frame.o.x} y1={frame.o.y} x2={frame.o.x + frame.along.x * frame.length} y2={frame.o.y + frame.along.y * frame.length} stroke="#fbbf24" strokeWidth={3} vectorEffect="non-scaling-stroke" />
                <circle cx={frame.o.x + frame.along.x * at} cy={frame.o.y + frame.along.y * at} r={pad * 0.25} fill="#ef4444" />
                {pts.map((q, i) =>
                  q.face === 1 || q.face === 6 ? (
                    <circle key={i} cx={q.x} cy={q.y} r={q.hole.diameter / 2} fill="#38bdf855" stroke="#38bdf8" strokeDasharray={q.face === 6 ? '3 3' : undefined} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                  ) : (
                    <circle key={i} cx={q.x} cy={q.y} r={q.hole.diameter / 2} fill="#a855f7aa" />
                  ),
                )}
              </g>
            </svg>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-stone-400">Pattern</Label>
                <Select
                  value={id}
                  onValueChange={(v) => {
                    setId(v)
                    setAt(defaultAt(patterns.find((p) => p.id === v), frame.length))
                  }}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {patterns.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {pattern && (
                  <div className="flex items-center gap-2 text-[11px] text-stone-400">
                    <StatusBadge p={pattern} /> {pattern.notes}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-stone-400">Reference edge</Label>
                <Select value={edge} onValueChange={(v) => setEdge(v as RefEdge)}>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EDGES.map((e) => (
                      <SelectItem key={e.value} value={e.value}>
                        {e.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <NumField label="Insertion point along the edge" value={at} onChange={setAt} min={-frame.length} max={2 * frame.length} />
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={mirror} onCheckedChange={setMirror} size="sm" /> Mirror (other hand)
              </label>
              {withOp && (
                <label className="flex items-center gap-2 text-xs">
                  <Switch checked={addOp} onCheckedChange={setAddOp} size="sm" /> Add a drilling operation for these holes
                </label>
              )}
              {placed && placed.warnings.length > 0 && (
                <ul className="list-disc rounded-md border border-amber-400/30 bg-amber-400/10 p-2 pl-5 text-xs text-amber-100">
                  {placed.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!pattern} onClick={place}>
            Add holes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
