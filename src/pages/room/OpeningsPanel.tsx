/**
 * Library-1: the room's doors, windows and openings on the Room tab: add one to a wall, set where it
 * is and its sizes (a new one starts at placeholder sizes, with a Configure badge until one is typed),
 * remove it. Every change is one undo step.
 */
import { DoorOpen, Plus, Trash2 } from 'lucide-react'
import { nanoid } from 'nanoid'
import { ConfigureBadge } from '@/components/Configure'
import { NumField, SelectField } from '@/components/fields'
import { Button } from '@/components/ui/button'
import { newOpening, OPENING_DEFAULTS, OPENING_KINDS, OPENING_LABEL, openingsOf, openingUnconfirmed, wallLengthOf, type OpeningWall } from '@/core/openings'
import type { Job, OpeningKind, Room, RoomOpening } from '@/core/types'
import { cn } from '@/lib/utils'

const WALL_OPTIONS: { value: OpeningWall; label: string }[] = [
  { value: 'back', label: 'Back wall' },
  { value: 'front', label: 'Front wall' },
  { value: 'left', label: 'Left wall' },
  { value: 'right', label: 'Right wall' },
]

export function OpeningsPanel({ room, units, selected, onSelect, edit }: { room: Room; units: 'mm' | 'in'; selected: string | null; onSelect: (id: string | null) => void; edit: (label: string, fn: (j: Job) => void) => void }) {
  const openings = openingsOf(room)
  const roomOf = (j: Job): Room => (j.room = { ...room, ...(j.room ?? {}) })
  const add = (kind: OpeningKind, wall: OpeningWall) => {
    const id = `op-${nanoid(6)}`
    edit(`Add ${OPENING_LABEL[kind].toLowerCase()}`, (j) => {
      const r = roomOf(j)
      r.openings = [...(r.openings ?? []), newOpening(kind, wall, r, id)]
    })
    onSelect(id)
  }
  const set = (o: RoomOpening, label: string, fn: (x: RoomOpening) => void, sized = false) =>
    edit(`${label} of ${o.name ?? OPENING_LABEL[o.kind]}`, (j) => {
      const r = roomOf(j)
      r.openings = (r.openings ?? []).map((x) => {
        if (x.id !== o.id) return x
        const next = { ...x }
        fn(next)
        // a size typed is the real one: the placeholder badge goes
        if (sized) delete next.placeholder
        return next
      })
    })
  return (
    <div className="flex flex-col gap-2" data-testid="openings-panel">
      <p className="text-[11px] leading-snug text-muted-foreground">Doors, windows and plain openings in the walls. Measured along the wall from its left end as you face it (as its elevation shows it). Cabinets standing in one are flagged; Arrange, Fill gap and copies keep out of them.</p>
      <div className="flex flex-wrap gap-1">
        {OPENING_KINDS.map((k) => (
          <Button key={k} size="xs" variant="outline" onClick={() => add(k, 'back')}>
            <Plus /> {OPENING_LABEL[k]}
          </Button>
        ))}
      </div>
      {openings.map((o) => {
        const on = selected === o.id
        const len = wallLengthOf(o.wall, room)
        const item = openingUnconfirmed(o, units)
        return (
          <div key={o.id} className={cn('flex flex-col gap-2 rounded-md border p-2', on && 'border-amber-500 ring-1 ring-amber-400')} data-cfg={`room:opening:${o.id}`} onClick={() => onSelect(o.id)}>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium">
                <DoorOpen className="size-3.5" /> {o.name} · {OPENING_LABEL[o.kind]}
                {item && <ConfigureBadge item={item} onOpen={() => onSelect(o.id)} />}
              </span>
              <Button size="icon-xs" variant="ghost" aria-label={`Remove ${o.name}`} onClick={(e) => { e.stopPropagation(); edit(`Remove ${o.name ?? 'opening'}`, (j) => { const r = roomOf(j); r.openings = (r.openings ?? []).filter((x) => x.id !== o.id) }); onSelect(null) }}>
                <Trash2 />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <SelectField label="Kind" value={o.kind} options={OPENING_KINDS.map((k) => ({ value: k, label: OPENING_LABEL[k] }))} onChange={(v) => set(o, 'Kind', (x) => { x.kind = v; if (v !== 'window') x.sill = 0; else if (x.sill === 0) x.sill = OPENING_DEFAULTS.window.sill })} />
              <SelectField label="Wall" value={o.wall} options={WALL_OPTIONS} onChange={(v) => set(o, 'Wall', (x) => { x.wall = v; x.at = Math.min(x.at, Math.max(0, wallLengthOf(v, room) - x.width)) })} />
              <NumField label="From the wall's left end" value={o.at} min={0} max={len} onChange={(v) => set(o, 'Position', (x) => (x.at = v))} />
              <NumField label="Width" value={o.width} min={1} max={len} onChange={(v) => set(o, 'Width', (x) => (x.width = v), true)} />
              <NumField label="Height" value={o.height} min={1} max={room.height} onChange={(v) => set(o, 'Height', (x) => (x.height = v), true)} />
              <NumField label="Sill height" hint={o.kind === 'window' ? 'Floor to the bottom of the window.' : '0 for a door or an opening to the floor.'} value={o.sill} min={0} max={room.height} onChange={(v) => set(o, 'Sill height', (x) => (x.sill = v), true)} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
