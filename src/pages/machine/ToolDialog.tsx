import { NumField, SelectField, TextField } from '@/components/fields'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { MachineProfile, Tool, ToolShape } from '@/core/types'

const SHAPES: { value: ToolShape; label: string }[] = [
  { value: 'flat', label: 'Flat end' },
  { value: 'ball', label: 'Ball-nose' },
  { value: 'bull', label: 'Bull-nose (corner radius)' },
  { value: 'v', label: 'V / engraving' },
  { value: 'drill', label: 'Drill' },
  { value: 'saw', label: 'Saw blade' },
  { value: 'profile', label: 'Profile cutter' },
]

/** Cutting shape and the lengths collision checks need: shank, flutes, stick-out and holder. */
export function ToolDialog({ tool, machine, onClose, update }: { tool: Tool; machine: MachineProfile; onClose: () => void; update: (fn: (t: Tool) => void) => void }) {
  const holders = machine.holders ?? []
  const opt = (v: number | undefined) => (Number.isFinite(v) ? (v as number) : 0)
  const set = (k: 'shankDiameter' | 'fluteLength' | 'gaugeLength' | 'cornerRadius' | 'angle' | 'kerf' | 'bladeDiameter') => (v: number) =>
    update((t) => {
      if (v > 0) t[k] = v
      else delete t[k]
    })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            T{tool.number} {tool.name}
          </DialogTitle>
          <DialogDescription>Shape and lengths for 3D toolpaths and collision checks. 0 = not given. These numbers come from the tool and holder in the machine, not from this program.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <TextField label="Description" value={tool.name} onChange={(v) => update((t) => (t.name = v))} />
          <div className="grid grid-cols-2 gap-2">
            <SelectField label="Cutting shape" value={tool.shape ?? 'flat'} options={SHAPES} onChange={(v) => update((t) => (t.shape = v))} />
            {tool.shape === 'bull' && <NumField label="Corner radius" value={opt(tool.cornerRadius)} min={0} max={tool.diameter / 2} step={0.5} onChange={set('cornerRadius')} />}
            {tool.shape === 'v' && <NumField label="Included angle" suffix="°" value={opt(tool.angle)} min={0} max={180} onChange={set('angle')} />}
          </div>
          {tool.type === 'saw' && (
            <div className="grid grid-cols-2 gap-2">
              <NumField label="Kerf" value={opt(tool.kerf)} min={0} step={0.1} onChange={set('kerf')} hint="Width of the cut; 0 = 4 mm" />
              <NumField label="Blade Ø" value={opt(tool.bladeDiameter)} min={0} onChange={set('bladeDiameter')} hint="For the run-out of saw cuts; 0 = a placeholder blade" />
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <NumField label="Shank Ø" value={opt(tool.shankDiameter)} min={0} onChange={set('shankDiameter')} hint="Above the flutes" />
            <NumField label="Flute length" value={opt(tool.fluteLength)} min={0} onChange={set('fluteLength')} hint="Cutting length" />
            <NumField label="Stick-out" value={opt(tool.gaugeLength)} min={0} onChange={set('gaugeLength')} hint="Tip to holder face" />
          </div>
          <SelectField
            label="Holder"
            value={tool.holderId ?? ''}
            options={[{ value: '', label: 'Not given' }, ...holders.map((h) => ({ value: h.id, label: `${h.name}${h.placeholder && !/placeholder/i.test(h.name) ? ' (placeholder)' : ''}` }))]}
            onChange={(v) => update((t) => (v ? (t.holderId = v) : delete t.holderId))}
          />
          {(() => {
            const h = holders.find((x) => x.id === tool.holderId)
            return h ? (
              <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                {h.placeholder && <Badge variant="outline">placeholder</Badge>}
                Outline (height above holder face : radius) {h.profile.map((p) => `${p.z}:${p.r}`).join('  ')}
              </div>
            ) : null
          })()}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
