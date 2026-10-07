import { TriangleAlert } from 'lucide-react'
import { NumField, Section, SelectField, SwitchField } from '@/components/fields'
import { machineModelOf, PLACEHOLDER_N200_MODEL, PLACEHOLDER_POSITIONAL, rotaryAxisOf, type RotaryLetter, withPositional, withRotaryAxis } from '@/core/machineModel'
import { kinematicsProblems } from '@/cam/positional/kinematics'
import type { MachineModel, MachineProfile, PositionalKinematics } from '@/core/types'
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
      {rotaryAllowed ? <PositionalAxes mm={mm} upd={upd} badge={<ValueBadges item={items.find((u) => u.key === 'model:positional')} />} /> : <p className="text-[11px] text-muted-foreground">3+2 axes: none (the N-200 cannot tilt its tool). Tilted-plane work is simulated only; it goes to another machine with two rotary axes through a script post.</p>}
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

const LETTER_OPTIONS = [
  { value: 'A', label: 'A (X)' },
  { value: 'B', label: 'B (Y)' },
  { value: 'C', label: 'C (Z)' },
] as const

/**
 * Two rotary axes for positional 3+2 (M3.4), for machines other than the N-200: where they are
 * (head or table), which axes, their travel, the head's pivot, the table's centre, where the part
 * sits and tip control. Invented values keep a Configure badge until confirmed.
 */
function PositionalAxes({ mm, upd, badge }: { mm: MachineModel; upd: (fn: (p: MachineModel) => void, fact?: ModelFact) => void; badge: React.ReactNode }) {
  const k = mm.capabilities.positional ? mm.positional : undefined
  const ax = (id: string) => mm.axes.find((a) => a.id === id) ?? { id, min: 0, max: 0 }
  const set = (patch: Partial<PositionalKinematics>, travel?: { first?: { min: number; max: number }; second?: { min: number; max: number } }) =>
    upd((p) => {
      const cur = p.positional!
      const next = { ...cur, ...patch, placeholder: cur.placeholder }
      const t = { first: travel?.first ?? { min: ax(cur.first).min, max: ax(cur.first).max }, second: travel?.second ?? { min: ax(cur.second).min, max: ax(cur.second).max } }
      Object.assign(p, withPositional(p, next, t))
    })
  const problems = k ? kinematicsProblems(mm) : []
  return (
    <div className="flex flex-col gap-2 rounded-md border p-2.5" data-cfg="model:positional">
      <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
        3+2 axes (positional) {k && badge}
      </div>
      <SelectField
        label="Two rotary axes for 3+2"
        value={k ? k.layout : 'none'}
        options={[
          { value: 'none', label: 'None' },
          { value: 'head-head', label: 'Both in the head (e.g. C then B)' },
          { value: 'table-table', label: 'Both under the part (a tilting rotary table, e.g. A then C)' },
          { value: 'table-head', label: 'First under the part, second in the head (e.g. table C, head B)' },
        ]}
        onChange={(v) =>
          upd((p) => {
            if (v === 'none') return void Object.assign(p, withPositional(p, null))
            const base = p.positional ?? PLACEHOLDER_POSITIONAL
            const pair = v === 'table-table' ? { first: 'A' as const, second: 'C' as const } : { first: 'C' as const, second: 'B' as const }
            Object.assign(p, withPositional(p, { ...base, ...(p.positional ? {} : pair), layout: v as PositionalKinematics['layout'], placeholder: true }))
          })
        }
      />
      {k && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <SelectField label="First axis (turns about)" value={k.first} options={[...LETTER_OPTIONS]} onChange={(v) => set({ first: v as PositionalKinematics['first'] })} />
            <NumField label="Turns from" suffix="°" value={ax(k.first).min} onChange={(v) => set({}, { first: { min: v, max: ax(k.first).max } })} />
            <NumField label="Turns to" suffix="°" value={ax(k.first).max} onChange={(v) => set({}, { first: { min: ax(k.first).min, max: v } })} />
            <SelectField label="Second axis (carried)" value={k.second} options={[...LETTER_OPTIONS]} onChange={(v) => set({ second: v as PositionalKinematics['second'] })} />
            <NumField label="Turns from" suffix="°" value={ax(k.second).min} onChange={(v) => set({}, { second: { min: v, max: ax(k.second).max } })} />
            <NumField label="Turns to" suffix="°" value={ax(k.second).max} onChange={(v) => set({}, { second: { min: ax(k.second).min, max: v } })} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {k.layout !== 'table-table' && <NumField label="Head pivot above the gauge face" value={k.pivot} min={0} onChange={(v) => set({ pivot: v })} />}
            {k.layout !== 'head-head' && (
              <>
                <NumField label="Table centre X" value={k.centre.x} onChange={(v) => set({ centre: { ...k.centre, x: v } })} />
                <NumField label="Table centre Y" value={k.centre.y} onChange={(v) => set({ centre: { ...k.centre, y: v } })} />
                <NumField label="Table centre Z" value={k.centre.z} onChange={(v) => set({ centre: { ...k.centre, z: v } })} />
              </>
            )}
            <NumField label="Part origin at X" value={k.partAt.x} onChange={(v) => set({ partAt: { ...k.partAt, x: v } })} />
            <NumField label="Part origin at Y" value={k.partAt.y} onChange={(v) => set({ partAt: { ...k.partAt, y: v } })} />
            <NumField label="Part origin at Z" value={k.partAt.z} onChange={(v) => set({ partAt: { ...k.partAt, z: v } })} />
          </div>
          {k.layout !== 'table-table' && <SwitchField label="The controller keeps the tool tip on the point (tip control)" checked={k.tcp} onChange={(v) => set({ tcp: v })} hint="Off: X, Y and Z are worked out for the head's pivot and the tool's stick-out." />}
          {problems.length > 0 && (
            <ul className="list-disc rounded-md border border-red-300 bg-red-50 py-1.5 pr-2 pl-5 text-[11px] text-red-900">
              {problems.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="text-[11px] text-muted-foreground">For a machine with two rotary axes: operations on tilted planes are written only through a script post written for it, with the 3+2 post switch on, every angle and position inside the travel. A rotary (turning) axis must be a different one. The N-200 has none.</p>
    </div>
  )
}
