import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '@/app/store'
import { Section, SelectField, TextField } from '@/components/fields'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { machineUnconfirmed } from '@/core/confirm'
import { featuresOf } from '@/core/features'
import { machineSetups, MAIN_MACHINE } from '@/core/machines'
import type { MachineSetup } from '@/core/types'
import { cn } from '@/lib/utils'

/**
 * Other machines and process steps (M2.9, AM-08). Each has its own complete profile, edited on this
 * page with "Edit"; batch setups pick which of them get a program set.
 */
export function MachinesSection() {
  const { data, machineEdit, editMachine, addMachine, removeMachine } = useStore()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<MachineSetup['kind']>('machine')
  const [from, setFrom] = useState<'main' | 'placeholder'>('main')
  if (!data) return null
  const list = machineSetups(data)
  const out = featuresOf(data.settings).batchMachinesOutput
  const current = machineEdit ?? MAIN_MACHINE
  return (
    <Section title="Machines and process steps" description={`Batch runs can send the same part list to several machines; each gets its own nest, programs and export check. Programs for the other machines are ${out ? 'written' : 'checked but not written ("Write programs for other machines" is off)'}.`}>
      <ul className="flex flex-col gap-1.5" data-cfg="machines">
        {list.map((m) => {
          const open = machineUnconfirmed(m.profile).length
          return (
            <li key={m.id} className={cn('flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs', m.id === current && 'border-primary bg-primary/5')}>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{m.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {m.id === MAIN_MACHINE ? 'Main machine' : m.kind === 'step' ? 'Process step' : 'Other machine'} · woodWOP MPR · {m.profile.mat}
                </div>
              </div>
              {open > 0 && (
                <Badge variant="outline" className="border-amber-400 bg-amber-50 text-[10px] text-amber-900" title="Values still to configure on this machine">
                  {open} to configure
                </Badge>
              )}
              {m.id !== current && (
                <Button size="icon" variant="ghost" className="size-7" aria-label={`Edit ${m.name}`} onClick={() => editMachine(m.id)}>
                  <Pencil className="size-3.5" />
                </Button>
              )}
              {m.id !== MAIN_MACHINE && (
                <Button size="icon" variant="ghost" className="size-7" aria-label={`Remove ${m.name}`} onClick={() => removeMachine(m.id)}>
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      <div className="grid grid-cols-2 gap-2 rounded-md border border-dashed p-2">
        <div className="col-span-2">
          <TextField label="New machine or step" value={name} placeholder="e.g. WEEKE BHX drilling" onChange={setName} />
        </div>
        <SelectField
          label="Kind"
          value={kind}
          options={[
            { value: 'machine', label: 'Other machine' },
            { value: 'step', label: 'Process step' },
          ]}
          onChange={setKind}
        />
        <SelectField
          label="Start from"
          value={from}
          options={[
            { value: 'main', label: 'Copy of the main machine' },
            { value: 'placeholder', label: 'Placeholder N-200' },
          ]}
          onChange={setFrom}
        />
        <p className="col-span-2 text-[11px] text-muted-foreground">Every value of a new machine starts as a placeholder with a Configure badge, even if the main machine's is confirmed.</p>
        <Button
          size="sm"
          className="col-span-2"
          disabled={!name.trim()}
          onClick={() => {
            editMachine(addMachine(name.trim(), kind, from))
            setName('')
          }}
        >
          <Plus /> Add and edit
        </Button>
      </div>
    </Section>
  )
}
