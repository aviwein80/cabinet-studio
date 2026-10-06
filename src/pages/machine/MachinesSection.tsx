import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '@/app/store'
import { Section, SelectField, TextField } from '@/components/fields'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { machineUnconfirmed } from '@/core/confirm'
import { featuresOf } from '@/core/features'
import { machineSetups, MAIN_MACHINE } from '@/core/machines'
import { SAMPLE_TEMPLATE } from '@/cam/post'
import { isN200 } from '@/core/validator'
import { toast } from 'sonner'
import type { MachineSetup } from '@/core/types'
import { cn } from '@/lib/utils'

/**
 * Other machines and process steps (M2.9, AM-08). Each has its own complete profile, edited on this
 * page with "Edit"; batch setups pick which of them get a program set.
 */
export function MachinesSection() {
  const { data, machineEdit, editMachine, addMachine, removeMachine, mutate } = useStore()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<MachineSetup['kind']>('machine')
  const [from, setFrom] = useState<'main' | 'placeholder'>('main')
  if (!data) return null
  const list = machineSetups(data)
  const out = featuresOf(data.settings).batchMachinesOutput
  const current = machineEdit ?? MAIN_MACHINE
  // M2.10b: text posts (the sample template, plugins' script posts) for machines other than the N-200
  const posts: { value: string; label: string; post: MachineSetup['post'] }[] = [
    { value: 'woodwop', label: 'woodWOP MPR (built in)', post: { kind: 'woodwop-mpr' } },
    { value: 'template', label: `Template: ${SAMPLE_TEMPLATE.name}`, post: { kind: 'template', ...SAMPLE_TEMPLATE } },
    ...(data.plugins ?? []).filter((p) => p.enabled).flatMap((p) => (p.contributes?.posts ?? []).map((x) => ({ value: `script:${p.id}/${x.id}`, label: `Script: ${x.name} (${p.manifest.name})`, post: { kind: 'script' as const, plugin: p.id, post: x.id } }))),
  ]
  const postValue = (m: MachineSetup) => (m.post.kind === 'woodwop-mpr' ? 'woodwop' : m.post.kind === 'template' ? 'template' : `script:${m.post.plugin}/${m.post.post}`)
  const postLabel = (m: MachineSetup) => posts.find((p) => p.value === postValue(m))?.label ?? (m.post.kind === 'script' ? `Script: ${m.post.post} (plugin ${m.post.plugin}, not available)` : 'woodWOP MPR')
  const setPost = (m: MachineSetup, value: string) => {
    const choice = posts.find((p) => p.value === value)
    if (!choice) return
    if (choice.post.kind !== 'woodwop-mpr' && isN200(m)) return void toast.error(`${m.name} is still described as an N-200`, { description: 'The N-200 takes woodWOP programs only. Give this machine its own model name (Edit → machine model field) before choosing a text post.' })
    mutate((d) => {
      const x = d.machines?.find((y) => y.id === m.id)
      if (x) x.post = choice.post
    })
  }
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
                  {m.id === MAIN_MACHINE ? 'Main machine' : m.kind === 'step' ? 'Process step' : 'Other machine'} · {m.id === MAIN_MACHINE ? `woodWOP MPR · ${m.profile.mat}` : postLabel(m)}
                </div>
                {m.id !== MAIN_MACHINE && (
                  <select aria-label={`Post for ${m.name}`} className="mt-1 h-7 w-full max-w-sm rounded-md border bg-background px-1.5 text-[11px]" value={postValue(m)} onChange={(e) => setPost(m, e.target.value)}>
                    {posts.map((p) => (
                      <option key={p.value} value={p.value} disabled={p.post.kind !== 'woodwop-mpr' && isN200(m)}>
                        {p.label}
                        {p.post.kind !== 'woodwop-mpr' && isN200(m) ? ' (not for an N-200)' : ''}
                      </option>
                    ))}
                  </select>
                )}
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
