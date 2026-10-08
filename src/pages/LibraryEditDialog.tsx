import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/app/store'
import { Field, NumField, SelectField, TextField } from '@/components/fields'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { applyKeep, applyTemplateToJobs, applyUpdate, drivingKeys, geometryChanged, jobsUsingTemplate, listConsumers, replaceLibraryItem, type ItemKind, type JobUse } from '@/core/library/propagate'
import { formatLength, parseLength } from '@/core/units'
import type { EdgeBand, Hardware, HardwareCategory, Material } from '@/core/types'
import { featuresOf } from '@/core/features'
import { MaterialCostFields } from './library/MaterialCostFields'
import { enterApplies } from '@/components/enterApplies'

type Row = Hardware | Material | EdgeBand

const CATS: HardwareCategory[] = ['hinge', 'mounting-plate', 'shelf-pin', 'slide', 'connector', 'dowel', 'screw', 'leg', 'handle', 'other']

function JobList({ uses }: { uses: JobUse[] }) {
  return (
    <ul className="max-h-48 space-y-1 overflow-auto text-sm">
      {uses.map((j) => (
        <li key={j.jobId}>
          <span className="font-medium">{j.jobNumber}</span> {j.jobName}
          <span className="text-muted-foreground"> — {j.cabinets.map((c) => c.number).join(', ')}</span>
        </li>
      ))}
    </ul>
  )
}

function askText(kind: ItemKind, item: Row) {
  if (kind === 'material') return 'Thickness, sheet size and grain are used live. Update these jobs, or keep a copy of the old material on the cabinets listed here. New cabinets use the new value. Templates stay on the library item.'
  if (kind === 'edgeband') return 'Band thickness changes the cut size. Update these jobs, or keep the old band on the cabinets listed here. New cabinets use the new value.'
  const hw = item as Hardware
  if (hw.category === 'hinge') return 'Cup size is stored on each cabinet. Update writes the new cup onto these doors. Keep leaves those cabinets alone. Templates that still match the old cup follow the library either way, so the next cabinet uses the new value.'
  if (hw.category === 'mounting-plate') return 'Setback, spacing and hole size move the plate screws. Update uses the new holes. Keep leaves the old holes on these cabinets. Plate height and the name do not move holes. New cabinets use the new value.'
  return 'Runner length and hole positions change the drawer box and the side boring. Update uses the new holes. Keep leaves the old holes on these cabinets. New cabinets use the new value.'
}

export function LibraryEditDialog({ item, kind, onClose }: { item: Row | null; kind: ItemKind; onClose: () => void }) {
  const data = useStore((s) => s.data)
  const mutate = useStore((s) => s.mutate)
  const [draft, setDraft] = useState<Row | null>(null)
  const [ask, setAsk] = useState<JobUse[] | null>(null)

  useEffect(() => {
    setDraft(item ? (JSON.parse(JSON.stringify(item)) as Row) : null)
    setAsk(null)
  }, [item])

  if (!data || !item || !draft) return null
  const set = (fn: (row: Row) => void) =>
    setDraft((d) => {
      if (!d) return d
      const next = JSON.parse(JSON.stringify(d)) as Row
      fn(next)
      return next
    })

  const save = (choice: 'ask' | 'keep' | 'update') => {
    const keys = drivingKeys(draft, kind)
    const changed = geometryChanged(item, draft, keys)
    const consumers = changed ? listConsumers(data.jobs, kind, draft) : []
    if (choice === 'ask' && changed && consumers.length > 0) {
      setAsk(consumers)
      return
    }
    mutate((d) => {
      if (!changed) replaceLibraryItem(d, kind, draft)
      else if (choice === 'keep') applyKeep(d, kind, item, draft)
      else applyUpdate(d, kind, item, draft)
    })
    if (!changed) toast.success('Saved. Name and code are labels, so no job geometry changed.')
    else if (choice === 'keep') toast.success('Saved. These jobs keep their old values. New cabinets use the new one.')
    else toast.success(consumers.length ? 'Saved. These jobs now use the new values.' : 'Saved. New cabinets use this. No existing job needed a change.')
    onClose()
  }

  const hw = draft as Hardware
  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit {kind === 'hardware' ? 'hardware' : kind}</DialogTitle>
            <DialogDescription>
              Amber notes mark fields that move holes, cut sizes or sheets. Everything else is a label. This item is stored as <span className="font-mono">{item.id}</span>, so renaming it does not break jobs.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <TextField label="Code" hint="Label only. The BOM shows this text. Jobs still point at the id." value={draft.code} onChange={(v) => set((r) => (r.code = v))} />
            <TextField label="Name" hint="Label only. Changing the name does not move holes or resize parts." value={draft.name} onChange={(v) => set((r) => (r.name = v))} />
            {kind === 'hardware' && (
              <SelectField label="Category" hint="Label only. Boring follows the id (hinge, plate, or a TANDEM runner), not this word." value={hw.category} options={CATS.map((c) => ({ value: c, label: c }))} onChange={(v) => set((r) => ((r as Hardware).category = v))} />
            )}
            {kind === 'hardware' && hw.category === 'mounting-plate' && (
              <>
                <NumField label="Plate height H" hint="Label only. A 3 mm plate is H = 3. This number is not used to place holes." value={hw.plateHeight ?? 0} min={0} max={20} onChange={(v) => set((r) => ((r as Hardware).plateHeight = v))} />
                <NumField label="Setback from the front" hint="Drives boring. The plate screws move back from the front of the side." value={hw.plateSetback ?? 37} min={0} max={80} onChange={(v) => set((r) => ((r as Hardware).plateSetback = v))} />
                <NumField label="Screw spacing" hint="Drives boring. Distance between the two plate screws." value={hw.plateSpacing ?? 32} min={1} max={64} onChange={(v) => set((r) => ((r as Hardware).plateSpacing = v))} />
                <NumField label="Hole diameter" hint="Drives boring." value={hw.holeDiameter ?? 5} min={1} max={20} onChange={(v) => set((r) => ((r as Hardware).holeDiameter = v))} />
                <NumField label="Hole depth" hint="Drives boring." value={hw.holeDepth ?? 11} min={1} max={30} onChange={(v) => set((r) => ((r as Hardware).holeDepth = v))} />
              </>
            )}
            {kind === 'hardware' && hw.category === 'hinge' && (
              <>
                <NumField label="Cup diameter" hint="Drives boring once you update jobs. Each cabinet stores its own cup size." value={hw.cupDiameter ?? 35} min={20} max={40} onChange={(v) => set((r) => ((r as Hardware).cupDiameter = v))} />
                <NumField label="Cup depth" hint="Drives boring once you update jobs." value={hw.cupDepth ?? 13.5} min={1} max={20} onChange={(v) => set((r) => ((r as Hardware).cupDepth = v))} />
                <NumField label="Cup centre from the edge" hint="Drives boring once you update jobs. K = 3 mm puts the Ø35 centre at 20.5 mm." value={hw.cupCentre ?? 20.5} min={1} max={40} onChange={(v) => set((r) => ((r as Hardware).cupCentre = v))} />
              </>
            )}
            {kind === 'hardware' && hw.category === 'slide' && (
              <>
                <NumField label="Runner length" hint="Drives the drawer box length." value={hw.slideLength ?? 0} min={100} max={800} onChange={(v) => set((r) => ((r as Hardware).slideLength = v))} />
                <HolesField value={hw.slideHoles ?? []} onChange={(v) => set((r) => ((r as Hardware).slideHoles = v))} />
                <NumField label="Minimum cabinet depth" hint="Drives the shallow-cabinet warning." value={hw.minCabinetDepth ?? 0} min={0} max={1200} onChange={(v) => set((r) => ((r as Hardware).minCabinetDepth = v))} />
              </>
            )}
            {kind === 'hardware' && hw.category !== 'hinge' && hw.category !== 'mounting-plate' && hw.category !== 'slide' && (
              <p className="text-xs text-muted-foreground">This item is a label. The generator does not read it when it bores holes.</p>
            )}
            {kind === 'material' && (
              <>
                <NumField label="Thickness" hint="Drives geometry. Part thickness and the nesting sheet both follow this." value={(draft as Material).thickness} min={1} max={50} onChange={(v) => set((r) => ((r as Material).thickness = v))} />
                <NumField label="Sheet length" hint="Drives nesting." value={(draft as Material).sheetLength} min={100} max={6000} onChange={(v) => set((r) => ((r as Material).sheetLength = v))} />
                <NumField label="Sheet width" hint="Drives nesting." value={(draft as Material).sheetWidth} min={100} max={4000} onChange={(v) => set((r) => ((r as Material).sheetWidth = v))} />
                <SelectField label="Grain" hint="Drives nesting. Grain-locked parts will not rotate on a sheet with grain." value={(draft as Material).grain ? 'yes' : 'no'} options={[{ value: 'yes', label: 'Grain along the sheet length' }, { value: 'no', label: 'No grain' }]} onChange={(v) => set((r) => ((r as Material).grain = v === 'yes'))} />
                <TextField label="Colour" hint="Appearance only. The 3D view uses it. Cut size does not." value={(draft as Material).color} onChange={(v) => set((r) => ((r as Material).color = v))} />
                {featuresOf(data.settings).nestAdditions && (
                  <MaterialCostFields
                    material={draft as Material}
                    currency={data.settings.currency ?? '$'}
                    onChange={(c) =>
                      set((r) => {
                        if (c) (r as Material).cost = c
                        else delete (r as Material).cost
                      })
                    }
                  />
                )}
              </>
            )}
            {kind === 'edgeband' && (
              <>
                <NumField label="Thickness" hint="Drives the cut size. Each banded edge is shortened by this, plus pre-mill." value={(draft as EdgeBand).thickness} min={0} max={5} onChange={(v) => set((r) => ((r as EdgeBand).thickness = v))} />
                <NumField label="Width" hint="Drives the band strip width on the BOM." value={(draft as EdgeBand).width} min={1} max={60} onChange={(v) => set((r) => ((r as EdgeBand).width = v))} />
                <TextField label="Colour" hint="Appearance only." value={(draft as EdgeBand).color} onChange={(v) => set((r) => ((r as EdgeBand).color = v))} />
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => save('ask')}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!ask} onOpenChange={(o) => !o && setAsk(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Jobs already use this</DialogTitle>
            <DialogDescription>{askText(kind, draft)}</DialogDescription>
          </DialogHeader>
          {ask && <JobList uses={ask} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => save('keep')}>Keep old values on these jobs</Button>
            <Button onClick={() => save('update')}>Update these jobs</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function HolesField({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const units = useStore((s) => s.data?.settings.units ?? 'mm')
  const shown = value.map((v) => formatLength(v, units)).join(', ')
  const [text, setText] = useState(shown)
  useEffect(() => setText(shown), [shown])
  return (
    <Field label="Slide holes from the front" hint="Drives boring. Comma-separated distances from the front of the side.">
      <Input
        className="h-8"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={enterApplies}
        onBlur={() => {
          const nums = text.split(',').map((s) => s.trim()).filter(Boolean).map((s) => parseLength(s, units))
          if (nums.length > 0 && nums.every((n) => n !== null)) onChange(nums as number[])
          else setText(shown)
        }}
      />
    </Field>
  )
}

export function TemplateJobsButton({ templateId }: { templateId: string }) {
  const data = useStore((s) => s.data)
  const mutate = useStore((s) => s.mutate)
  const [open, setOpen] = useState(false)
  if (!data) return null
  const uses = jobsUsingTemplate(data.jobs, templateId)
  const count = uses.reduce((n, j) => n + j.cabinets.length, 0)
  return (
    <>
      <Button size="sm" variant="outline" disabled={count === 0} onClick={() => setOpen(true)}>
        Update existing jobs…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update existing jobs</DialogTitle>
            <DialogDescription>These cabinets were copied from this template. Updating replaces their construction with the template as it is now. Their place in the room stays. New cabinets already use the template.</DialogDescription>
          </DialogHeader>
          <JobList uses={uses} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Leave jobs as they are</Button>
            <Button
              onClick={() => {
                mutate((d) => applyTemplateToJobs(d, templateId))
                setOpen(false)
                toast.success(`Updated ${count} cabinet${count === 1 ? '' : 's'}`)
              }}
            >
              Update these cabinets
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
