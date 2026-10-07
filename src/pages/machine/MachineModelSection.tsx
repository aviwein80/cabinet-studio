import { TriangleAlert } from 'lucide-react'
import { NumField, Section, SelectField, SwitchField } from '@/components/fields'
import { machineModelOf, PLACEHOLDER_N200_MODEL, rotaryAxisOf, type RotaryLetter, withRotaryAxis } from '@/core/machineModel'
import type { MachineModel, MachineProfile } from '@/core/types'
import { ValueBadges } from '@/components/Configure'
import { confirmKey, machineUnconfirmed, type ModelFact } from '@/core/confirm'

/** Machine model: table, travel, tool change and which units are fitted. Shared by sim, checks and posts. */
export function MachineModelSection({ machine, updateMachine, rotaryAllowed = false }: { machine: MachineProfile; updateMachine: (fn: (m: MachineProfile) => void) => void; rotaryAllowed?: boolean }) {
  const mm = machineModelOf(machine)
  // editing a figure records it as confirmed (a real value was entered)
  const upd = (fn: (p: MachineModel) => void, fact?: ModelFact) =>
    updateMachine((x) => {
      x.physical = structuredClone(x.physical ?? PLACEHOLDER_N200_MODEL)
      fn(x.physical)
      if (fact) confirmKey(x, `model:${fact}`)
    })
  const items = machineUnconfirmed(machine)
  const badge = (fact: ModelFact) => <ValueBadges item={items.find((u) => u.key === `model:${fact}`)} />
  const cfg = (fact: ModelFact) => `model:${fact}`
  const axis = (id: 'X' | 'Y' | 'Z') => mm.axes.find((a) => a.id === id) ?? { id, min: 0, max: 0 }
  const setAxis = (id: 'X' | 'Y' | 'Z', k: 'min' | 'max', v: number) =>
    upd((p) => {
      const a = p.axes.find((x) => x.id === id)
      if (a) a[k] = v
      else p.axes.push({ id, min: k === 'min' ? v : 0, max: k === 'max' ? v : 0 })
    }, 'travel')
  return (
    <Section title="Machine model" description="What the machine has and how far it travels. Used by the export checker now, and by simulation and collision checks.">
      {mm.placeholder && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-950">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            <b>Placeholder figures.</b> The table is one 5 × 12 ft sheet; travel, tool change and spoilboard thickness are invented. Every export shows a warning until these are confirmed.
          </span>
        </div>
      )}
      <SwitchField
        label="Saw unit fitted"
        checked={mm.capabilities.saw}
        onChange={(v) => upd((p) => (p.capabilities.saw = v), 'saw')}
        cfg={cfg('saw')}
        badge={badge('saw')}
        hint="Off (until confirmed): saw grooves, on cabinets and custom parts, are blocked by the export checker. Use router pockets."
      />
      <SwitchField label="Aggregate head fitted" checked={mm.capabilities.aggregate} onChange={(v) => upd((p) => (p.capabilities.aggregate = v), 'aggregate')} cfg={cfg('aggregate')} badge={badge('aggregate')} hint="Off: edge work with an aggregate is simulated only and the export checker refuses it." />
      {rotaryAllowed ? (
        <div className="grid grid-cols-3 gap-2" data-cfg="model:rotary">
          <SelectField
            label="Rotary axis"
            value={rotaryAxisOf(mm)?.id ?? 'none'}
            options={[
              { value: 'none', label: 'None' },
              { value: 'A', label: 'A (about X)' },
              { value: 'B', label: 'B (about Y)' },
              { value: 'C', label: 'C (about Z)' },
            ]}
            onChange={(v) => upd((p) => Object.assign(p, withRotaryAxis(p, v === 'none' ? null : (v as RotaryLetter))))}
          />
          {rotaryAxisOf(mm) && (
            <>
              <NumField label="Turns from" suffix="°" value={rotaryAxisOf(mm)!.min} onChange={(v) => upd((p) => Object.assign(p, withRotaryAxis(p, rotaryAxisOf(p)!.id as RotaryLetter, { min: v, max: rotaryAxisOf(p)!.max })))} />
              <NumField label="Turns to" suffix="°" value={rotaryAxisOf(mm)!.max} onChange={(v) => upd((p) => Object.assign(p, withRotaryAxis(p, rotaryAxisOf(p)!.id as RotaryLetter, { min: rotaryAxisOf(p)!.min, max: v })))} />
            </>
          )}
          <p className="col-span-3 text-[11px] text-muted-foreground">For a machine with a rotary axis: rotary programs for it are written only through a script post written for it, with the rotary-post switch on. The N-200 has none.</p>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">Rotary axis: none (the N-200 is a 3-axis router). Rotary work is simulated only; it goes to another machine with a rotary axis through a script post.</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <NumField label="Table length (X)" value={mm.table.length} min={1} onChange={(v) => upd((p) => (p.table.length = v), 'table')} cfg={cfg('table')} badge={badge('table')} />
        <NumField label="Table width (Y)" value={mm.table.width} min={1} onChange={(v) => upd((p) => (p.table.width = v), 'table')} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <NumField label="X travel max" value={axis('X').max} onChange={(v) => setAxis('X', 'max', v)} cfg={cfg('travel')} badge={badge('travel')} />
        <NumField label="Y travel max" value={axis('Y').max} onChange={(v) => setAxis('Y', 'max', v)} />
        <NumField label="Z travel max" value={axis('Z').max} onChange={(v) => setAxis('Z', 'max', v)} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <NumField label="Tool change X" value={mm.toolChange.x} onChange={(v) => upd((p) => (p.toolChange.x = v), 'toolChange')} cfg={cfg('toolChange')} badge={badge('toolChange')} />
        <NumField label="Tool change Y" value={mm.toolChange.y} onChange={(v) => upd((p) => (p.toolChange.y = v), 'toolChange')} />
        <NumField label="Tool change Z" value={mm.toolChange.z} onChange={(v) => upd((p) => (p.toolChange.z = v), 'toolChange')} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumField label="Machine safe Z" value={mm.safeZ} min={0} onChange={(v) => upd((p) => (p.safeZ = v), 'safeZ')} hint="Above the sheet top" cfg={cfg('safeZ')} badge={badge('safeZ')} />
        <NumField label="Spoilboard thickness" value={mm.spoilboard.thickness} min={0} onChange={(v) => upd((p) => (p.spoilboard.thickness = v), 'spoilboard')} cfg={cfg('spoilboard')} badge={badge('spoilboard')} />
      </div>
      <SwitchField label="These figures are placeholders" checked={mm.placeholder} onChange={(v) => upd((p) => (p.placeholder = v))} hint="Turn off only once every figure above matches the N-200." />
    </Section>
  )
}
