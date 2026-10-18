/**
 * Library-1: the job's custom parts placed in the room (display only): place a copy, then set where
 * it stands, how high, which way it is turned and how the panel stands (flat, on its edge, on its
 * end); parts given the same group move and turn together (a table: its top, legs and aprons).
 * Nothing here changes a part's machining, nesting or programs. Every change is one undo step.
 */
import { Plus, RotateCw, Trash2 } from 'lucide-react'
import { nanoid } from 'nanoid'
import { Field, NumField, SelectField } from '@/components/fields'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { groupBox, groupOf, moveGroup, newRoomPart, placedCount, STAND_LABEL, STANDS, turnGroup } from '@/core/roomParts'
import type { Job, Room, RoomPart } from '@/core/types'
import { formatDims } from '@/core/units'
import { cn } from '@/lib/utils'

const ROTATIONS: { value: '0' | '90' | '180' | '270'; label: string }[] = [
  { value: '0', label: '0°' },
  { value: '90', label: '90°' },
  { value: '180', label: '180°' },
  { value: '270', label: '270°' },
]

export function RoomPartsPanel({ job, room, units, selected, onSelect, edit }: { job: Job; room: Room; units: 'mm' | 'in'; selected: string | null; onSelect: (id: string | null) => void; edit: (label: string, fn: (j: Job) => void) => void }) {
  const parts = job.camParts ?? []
  const placed = job.roomParts ?? []
  const sel = placed.find((r) => r.id === selected) ?? null
  const part = sel ? parts.find((p) => p.id === sel.partId) : undefined
  const groups = [...new Set(placed.map((r) => r.group).filter((g): g is string => !!g))]
  const place = (partId: string) => {
    const p = parts.find((x) => x.id === partId)
    if (!p) return
    const id = `rp-${nanoid(6)}`
    edit(`Place ${p.name} in the room`, (j) => {
      // a part of an assembly joins that assembly's group (a table's parts move together)
      j.roomParts = [...(j.roomParts ?? []), newRoomPart(p, room, id, p.assembly)]
    })
    onSelect(id)
  }
  const setOne = (label: string, fn: (r: RoomPart) => void) =>
    edit(`${label} of ${part?.name ?? 'a part'}`, (j) => {
      j.roomParts = (j.roomParts ?? []).map((r) => {
        if (r.id !== sel?.id) return r
        const next = { ...r }
        fn(next)
        return next
      })
    })
  const setGroup = (label: string, fn: (list: RoomPart[], j: Job) => void) =>
    edit(label, (j) => {
      j.roomParts = (j.roomParts ?? []).map((r) => ({ ...r }))
      fn(groupOf(j, sel!.id), j)
    })
  const gbox = sel ? groupBox(job, groupOf(job, sel.id)) : null
  return (
    <div className="flex flex-col gap-2" data-testid="room-parts-panel">
      <p className="text-[11px] leading-snug text-muted-foreground">Custom parts shown in the room as plain solids (their outline through their thickness), to see a table or a shaped piece with the cabinets. Display only: nothing here changes how a part is cut.</p>
      {parts.length === 0 && <p className="text-xs text-muted-foreground">This job has no custom parts.</p>}
      {parts.map((p) => {
        const n = placedCount(job, p.id)
        const qty = Math.max(1, p.qty)
        return (
          <div key={p.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate">
              {p.name} <span className="text-muted-foreground">· {formatDims([p.length, p.width, p.thickness], units)} · placed {n} of {qty}</span>
            </span>
            <Button size="xs" variant="outline" disabled={n >= qty} onClick={() => place(p.id)} title={n >= qty ? 'Every copy made is placed' : undefined}>
              <Plus /> Place
            </Button>
          </div>
        )
      })}
      {placed.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {placed.map((r) => (
            <button key={r.id} type="button" onClick={() => onSelect(r.id)} className={cn('rounded border px-1.5 py-0.5 text-[11px]', r.id === selected ? 'border-amber-500 bg-amber-50' : 'bg-background')}>
              {parts.find((p) => p.id === r.partId)?.name ?? 'missing part'}
              {r.group ? ` · ${r.group}` : ''}
            </button>
          ))}
        </div>
      )}
      {sel && part && (
        <div key={sel.id} className="flex flex-col gap-2 rounded-md border border-amber-300 p-2" data-testid="room-part-fields">
          <div className="flex items-center justify-between gap-2 text-xs font-medium">
            <span>{part.name}</span>
            <Button size="icon-xs" variant="ghost" aria-label={`Remove ${part.name} from the room`} onClick={() => { edit(`Remove ${part.name} from the room`, (j) => (j.roomParts = (j.roomParts ?? []).filter((r) => r.id !== sel.id))); onSelect(null) }}>
              <Trash2 />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumField label="X from the left wall" value={sel.x} min={-room.width} max={2 * room.width} onChange={(v) => setOne('Move', (r) => (r.x = v))} />
            <NumField label="Y from the front wall" value={sel.y} min={-room.depth} max={2 * room.depth} onChange={(v) => setOne('Move', (r) => (r.y = v))} />
            <NumField label="Height off the floor" value={sel.z} min={0} max={room.height} onChange={(v) => setOne('Height', (r) => (r.z = v))} />
            <SelectField label="Turn" value={String(sel.rotation) as '0'} options={ROTATIONS} onChange={(v) => setOne('Turn', (r) => (r.rotation = Number(v) as RoomPart['rotation']))} />
          </div>
          <SelectField label="Stands" value={sel.stand} options={STANDS.map((s) => ({ value: s, label: STAND_LABEL[s] }))} onChange={(v) => setOne('Stand', (r) => (r.stand = v))} />
          <Field label="Group (parts with the same group move together)">
            <Input className="h-8" list="room-part-groups" defaultValue={sel.group ?? ''} key={sel.id + (sel.group ?? '')} placeholder="e.g. Table" onBlur={(e) => { const g = e.target.value.trim(); if (g !== (sel.group ?? '')) setOne('Group', (r) => { if (g) r.group = g; else delete r.group }) }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
            <datalist id="room-part-groups">
              {groups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </Field>
          {sel.group && gbox && (
            <div className="flex flex-col gap-2 rounded-md bg-muted/40 p-2">
              <div className="flex items-center justify-between gap-2 text-xs font-medium">
                <span>Group {sel.group} ({groupOf(job, sel.id).length} parts)</span>
                <Button size="xs" variant="outline" onClick={() => setGroup(`Turn ${sel.group}`, (list, j) => turnGroup(j, list))}>
                  <RotateCw /> Turn 90°
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <NumField label="Group X" value={gbox.x} min={-room.width} max={2 * room.width} onChange={(v) => setGroup(`Move ${sel.group}`, (list) => moveGroup(list, v - gbox.x, 0, 0))} />
                <NumField label="Group Y" value={gbox.y} min={-room.depth} max={2 * room.depth} onChange={(v) => setGroup(`Move ${sel.group}`, (list) => moveGroup(list, 0, v - gbox.y, 0))} />
                <NumField label="Group height" value={gbox.z0} min={0} max={room.height} onChange={(v) => setGroup(`Raise ${sel.group}`, (list) => moveGroup(list, 0, 0, v - gbox.z0))} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
