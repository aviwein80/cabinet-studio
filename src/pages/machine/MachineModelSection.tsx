import { TriangleAlert } from 'lucide-react'
import { NumField, Section, SwitchField } from '@/components/fields'
import { machineModelOf, PLACEHOLDER_N200_MODEL } from '@/core/machineModel'
import type { MachineModel, MachineProfile } from '@/core/types'

/** Machine model: table, travel, tool change and which units are fitted. Shared by sim, checks and posts. */
export function MachineModelSection({ machine, updateMachine }: { machine: MachineProfile; updateMachine: (fn: (m: MachineProfile) => void) => void }) {
  const mm = machineModelOf(machine)
  const upd = (fn: (p: MachineModel) => void) =>
    updateMachine((x) => {
      x.physical = structuredClone(x.physical ?? PLACEHOLDER_N200_MODEL)
      fn(x.physical)
    })
  const axis = (id: 'X' | 'Y' | 'Z') => mm.axes.find((a) => a.id === id) ?? { id, min: 0, max: 0 }
  const setAxis = (id: 'X' | 'Y' | 'Z', k: 'min' | 'max', v: number) =>
    upd((p) => {
      const a = p.axes.find((x) => x.id === id)
      if (a) a[k] = v
      else p.axes.push({ id, min: k === 'min' ? v : 0, max: k === 'max' ? v : 0 })
    })
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
        onChange={(v) => upd((p) => (p.capabilities.saw = v))}
        hint="Off (until confirmed): saw grooves, on cabinets and custom parts, are blocked by the export checker. Use router pockets."
      />
      <SwitchField label="Aggregate head fitted" checked={mm.capabilities.aggregate} onChange={(v) => upd((p) => (p.capabilities.aggregate = v))} hint="Off: edge milling with an aggregate is not offered." />
      <div className="grid grid-cols-2 gap-2">
        <NumField label="Table length (X)" value={mm.table.length} min={1} onChange={(v) => upd((p) => (p.table.length = v))} />
        <NumField label="Table width (Y)" value={mm.table.width} min={1} onChange={(v) => upd((p) => (p.table.width = v))} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <NumField label="X travel max" value={axis('X').max} onChange={(v) => setAxis('X', 'max', v)} />
        <NumField label="Y travel max" value={axis('Y').max} onChange={(v) => setAxis('Y', 'max', v)} />
        <NumField label="Z travel max" value={axis('Z').max} onChange={(v) => setAxis('Z', 'max', v)} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <NumField label="Tool change X" value={mm.toolChange.x} onChange={(v) => upd((p) => (p.toolChange.x = v))} />
        <NumField label="Tool change Y" value={mm.toolChange.y} onChange={(v) => upd((p) => (p.toolChange.y = v))} />
        <NumField label="Tool change Z" value={mm.toolChange.z} onChange={(v) => upd((p) => (p.toolChange.z = v))} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumField label="Machine safe Z" value={mm.safeZ} min={0} onChange={(v) => upd((p) => (p.safeZ = v))} hint="Above the sheet top" />
        <NumField label="Spoilboard thickness" value={mm.spoilboard.thickness} min={0} onChange={(v) => upd((p) => (p.spoilboard.thickness = v))} />
      </div>
      <SwitchField label="These figures are placeholders" checked={mm.placeholder} onChange={(v) => upd((p) => (p.placeholder = v))} hint="Turn off only once every figure above matches the N-200." />
    </Section>
  )
}
