/**
 * Angle heads and aggregates (TOOL-04): offsets from the spindle, the tool's tilt, the angles the
 * head can be set to and the housing round the tool (drawn in the simulator, checked in edge
 * work). A library entry never fits an aggregate on the machine: that is the machine model's
 * "aggregate fitted" fact.
 */
import { Plus, Trash2 } from 'lucide-react'
import { nanoid } from 'nanoid'
import { ValueBadges } from '@/components/Configure'
import { NumField, Section, SelectField, TextField } from '@/components/fields'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { machineUnconfirmed } from '@/core/confirm'
import { machineModelOf } from '@/core/machineModel'
import type { Aggregate, MachineProfile } from '@/core/types'
import { enterApplies } from '@/components/enterApplies'

export function AggregatesSection({ machine, updateMachine }: { machine: MachineProfile; updateMachine: (fn: (m: MachineProfile) => void) => void }) {
  const list = machine.aggregates ?? []
  const items = machineUnconfirmed(machine)
  const fitted = machineModelOf(machine).capabilities.aggregate
  const upd = (id: string, fn: (a: Aggregate) => void) =>
    updateMachine((m) => {
      const a = m.aggregates?.find((x) => x.id === id)
      if (!a) return
      fn(a)
      // values typed in are the shop's own (M2.6e)
      a.placeholder = false
      m.confirmed = [...new Set([...(m.confirmed ?? []), `aggregate:${id}`])]
    })
  return (
    <Section title="Angle heads and aggregates" description={`Offsets, allowed angles and housing, assigned per tool in the tool dialog. ${fitted ? 'The machine model says an aggregate is fitted.' : 'The machine model has no aggregate fitted: edge work stays simulated only.'}`}>
      {list.map((a) => {
        const used = machine.tools.filter((t) => t.aggregateId === a.id).length
        return (
          <div key={a.id} className="flex flex-col gap-2 rounded-md border p-2" data-cfg={`aggregate:${a.id}`}>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1 text-sm font-medium">
                  {a.name} {a.placeholder && <Badge variant="outline">placeholder</Badge>}
                  <span className="text-[11px] font-normal text-muted-foreground">{used} tool(s)</span>
                </div>
                <ValueBadges item={items.find((u) => u.key === `aggregate:${a.id}`)} />
              </div>
              <Button size="icon-xs" variant="ghost" aria-label="Delete aggregate" disabled={used > 0} title={used ? 'Tools use it' : 'Delete'} onClick={() => updateMachine((m) => void (m.aggregates = (m.aggregates ?? []).filter((x) => x.id !== a.id)))}>
                <Trash2 />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Name" value={a.name} onChange={(v) => upd(a.id, (x) => (x.name = v))} />
              <SelectField
                label="Kind"
                value={a.kind}
                options={[
                  { value: 'rotating', label: 'Rotating aggregate' },
                  { value: 'angle-head', label: 'Angle head' },
                ]}
                onChange={(v) => upd(a.id, (x) => (x.kind = v))}
              />
            </div>
            <div className="grid grid-cols-4 gap-2">
              <NumField label="Offset X" value={a.offset.x} onChange={(v) => upd(a.id, (x) => (x.offset.x = v))} />
              <NumField label="Offset Y" value={a.offset.y} onChange={(v) => upd(a.id, (x) => (x.offset.y = v))} />
              <NumField label="Offset Z" value={a.offset.z} onChange={(v) => upd(a.id, (x) => (x.offset.z = v))} hint="Spindle to tool face" />
              <NumField label="Tool tilt" suffix="°" value={a.tilt} min={0} max={90} onChange={(v) => upd(a.id, (x) => (x.tilt = v))} hint="90 = flat" />
            </div>
            <div className="grid grid-cols-4 gap-2">
              <NumField label="Housing width" value={a.housing.width} min={0} onChange={(v) => upd(a.id, (x) => (x.housing.width = v))} />
              <NumField label="Above axis" value={a.housing.above} min={0} onChange={(v) => upd(a.id, (x) => (x.housing.above = v))} />
              <NumField label="Below axis" value={a.housing.below} min={0} onChange={(v) => upd(a.id, (x) => (x.housing.below = v))} />
              <NumField label="Length" value={a.housing.length} min={0} onChange={(v) => upd(a.id, (x) => (x.housing.length = v))} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Head angles (degrees from +X)</span>
              <div className="flex items-center gap-2">
                <SelectField
                  label=""
                  value={a.angles.mode}
                  options={[
                    { value: 'any', label: 'Any angle' },
                    { value: 'list', label: 'Only these' },
                  ]}
                  onChange={(v) => upd(a.id, (x) => (x.angles = v === 'any' ? { mode: 'any' } : { mode: 'list', list: [0, 90, 180, 270] }))}
                  className="w-36"
                />
                {a.angles.mode === 'list' && (
                  <Input
                    aria-label="Allowed angles"
                    className="h-8"
                    defaultValue={a.angles.list.join(', ')}
                    onKeyDown={enterApplies}
                    onBlur={(e) => {
                      const list = e.target.value.split(/[,;\s]+/).map(Number).filter((n) => Number.isFinite(n))
                      if (list.length) upd(a.id, (x) => (x.angles = { mode: 'list', list }))
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        )
      })}
      <Button
        size="sm"
        variant="outline"
        className="self-start"
        onClick={() => updateMachine((m) => void (m.aggregates = [...(m.aggregates ?? []), { id: `ag-${nanoid(6)}`, name: 'New aggregate', kind: 'angle-head', offset: { x: 0, y: 0, z: -100 }, tilt: 90, angles: { mode: 'list', list: [0, 90, 180, 270] }, housing: { width: 60, above: 40, below: 30, length: 80 }, placeholder: true }]))}
      >
        <Plus /> Add aggregate
      </Button>
    </Section>
  )
}
