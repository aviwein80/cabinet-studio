/**
 * Machine & tools sections for M3.6: the machine's own parts for the machine simulation (gantry,
 * head, spindle, tables, as boxes and cylinders carried by its axes; invented until measured) and
 * the shop's fixture library (clamps, pods, rails placed on parts from here).
 */
import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import { nanoid } from 'nanoid'
import { ValueBadges } from '@/components/Configure'
import { NumField, Section, SelectField, TextField } from '@/components/fields'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { bodiesOf, bodyProblems, defaultBodies, LINK_NAME } from '@/cam/machine/model'
import { fixtureTypesOf, KIND_NAME, PLACEHOLDER_FIXTURE_TYPES, shapeProblems } from '@/cam/fixtures/fixture'
import type { FixtureKind } from '@/cam/types'
import { bodiesItem, confirmKey, machineUnconfirmed } from '@/core/confirm'
import { machineModelOf, PLACEHOLDER_N200_MODEL } from '@/core/machineModel'
import type { FixtureType, MachineBody, MachineLink, MachineProfile } from '@/core/types'

const LINK_OPTIONS = (Object.keys(LINK_NAME) as MachineLink[]).map((l) => ({ value: l, label: LINK_NAME[l] }))

/** The machine's parts for the machine simulation. */
export function MachineBodiesSection({ machine, updateMachine }: { machine: MachineProfile; updateMachine: (fn: (m: MachineProfile) => void) => void }) {
  const mm = machineModelOf(machine)
  const list = bodiesOf(mm)
  const item = bodiesItem(machine)
  // editing a part makes the list the machine's own (each part entered keeps no placeholder flag)
  const upd = (fn: (b: MachineBody[]) => MachineBody[]) =>
    updateMachine((m) => {
      m.physical = structuredClone(m.physical ?? PLACEHOLDER_N200_MODEL)
      m.physical.bodies = fn(structuredClone(bodiesOf(m.physical)))
    })
  const set = (id: string, patch: Partial<MachineBody>) => upd((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch, placeholder: undefined } : b)))
  return (
    <Section title="Machine parts (machine simulation)" description="The machine's own parts as boxes and cylinders, each carried by an axis, for the machine simulation's collision check (against the table, the part and its clamps). Head parts are placed from the spindle's gauge point with every axis at 0, z up the spindle; X parts with X at 0; Y parts with X and Y at 0; frame and table parts in machine coordinates. The spoilboard and table come from the figures above.">
      <div className="flex flex-wrap items-center gap-2 text-xs" data-cfg="bodies:machine">
        {item ? (
          <>
            <span className="text-amber-700 dark:text-amber-300">Invented sizes and places: {item.value}. A hit by one of them is a warning on the export (it does not block it) until they are measured and confirmed.</span> <ValueBadges item={item} />
          </>
        ) : (
          <span className="text-muted-foreground">{list.length} parts, entered for this machine. A hit by one of them blocks the export.</span>
        )}
        <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={() => upd(() => defaultBodies(mm))} title="Start again from the invented parts for this machine's layout">
          <RotateCcw /> Invented parts for this layout
        </Button>
      </div>
      {list.map((b) => {
        const s = b.shape
        const problems = bodyProblems(b)
        const xyz = (label: string, v: [number, number, number], on: (v: [number, number, number]) => void) => (
          <div className="grid grid-cols-3 gap-2">
            {(['X', 'Y', 'Z'] as const).map((a, i) => (
              <NumField key={a} label={`${label} ${a}`} value={v[i]} onChange={(n) => on(v.map((q, k) => (k === i ? n : q)) as [number, number, number])} />
            ))}
          </div>
        )
        return (
          <div key={b.id} className="flex flex-col gap-2 rounded-md border p-2" data-testid="machine-body">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <TextField label="Name" value={b.name} onChange={(v) => set(b.id, { name: v })} />
              </div>
              {b.placeholder && <Badge variant="outline">placeholder</Badge>}
              <Button size="icon" variant="ghost" aria-label={`Remove ${b.name}`} onClick={() => upd((bs) => bs.filter((x) => x.id !== b.id))}>
                <Trash2 />
              </Button>
            </div>
            <SelectField label="Carried by" value={b.link} options={LINK_OPTIONS} onChange={(v) => set(b.id, { link: v as MachineLink })} />
            {s.k === 'box' ? (
              <>
                {xyz('From', s.min, (v) => set(b.id, { shape: { ...s, min: v } }))}
                {xyz('To', s.max, (v) => set(b.id, { shape: { ...s, max: v } }))}
              </>
            ) : (
              <>
                {xyz('Base', s.base, (v) => set(b.id, { shape: { ...s, base: v } }))}
                <div className="grid grid-cols-3 gap-2">
                  <SelectField label="Along" value={s.axis} options={[{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' }]} onChange={(v) => set(b.id, { shape: { ...s, axis: v as 'x' | 'y' | 'z' } })} />
                  <NumField label="Radius" value={s.r} min={0} onChange={(v) => set(b.id, { shape: { ...s, r: v } })} />
                  <NumField label="Length" value={s.h} min={0} onChange={(v) => set(b.id, { shape: { ...s, h: v } })} />
                </div>
              </>
            )}
            {problems.length > 0 && <p className="text-xs text-red-600 dark:text-red-300">{problems.join(' ')}</p>}
          </div>
        )
      })}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => upd((bs) => [...bs, { id: nanoid(8), name: 'New box', link: 'z', shape: { k: 'box', min: [-50, -50, 100], max: [50, 50, 300] } }])}>
          <Plus /> Box
        </Button>
        <Button size="sm" variant="outline" onClick={() => upd((bs) => [...bs, { id: nanoid(8), name: 'New cylinder', link: 'z', shape: { k: 'cylinder', base: [0, 0, 100], axis: 'z', r: 60, h: 200 } }])}>
          <Plus /> Cylinder
        </Button>
      </div>
    </Section>
  )
}

/** The shop's clamps, pods and rails. */
export function FixtureLibrarySection({ machine, updateMachine }: { machine: MachineProfile; updateMachine: (fn: (m: MachineProfile) => void) => void }) {
  const list = fixtureTypesOf(machine)
  const items = machineUnconfirmed(machine).filter((u) => u.group === 'Fixtures')
  const upd = (id: string, fn: (f: FixtureType) => void) =>
    updateMachine((m) => {
      m.fixtureTypes = structuredClone(m.fixtureTypes ?? PLACEHOLDER_FIXTURE_TYPES)
      const f = m.fixtureTypes.find((x) => x.id === id)
      if (!f) return
      fn(f)
      // sizes typed in are the shop's own
      f.placeholder = false
      confirmKey(m, `fixtureType:${id}`)
    })
  const setList = (fn: (l: FixtureType[]) => FixtureType[]) => updateMachine((m) => (m.fixtureTypes = fn(structuredClone(m.fixtureTypes ?? PLACEHOLDER_FIXTURE_TYPES))))
  return (
    <Section title="Fixtures (clamps, pods, rails)" description="The shop's clamps, pods and rails, placed on parts from the part's 3D tab (by hand, by dragging, or automatically clear of the toolpaths). Less used on a vacuum nesting table; the collision checks keep the tool and the head clear of them.">
      {list.map((f) => {
        const s = f.shape
        const item = items.find((u) => u.key === `fixtureType:${f.id}`)
        const problems = shapeProblems(s)
        return (
          <div key={f.id} className="flex flex-col gap-2 rounded-md border p-2" data-cfg={`fixtureType:${f.id}`} data-testid="fixture-type">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <TextField label="Name" value={f.name} onChange={(v) => upd(f.id, (x) => (x.name = v))} />
              </div>
              <div className="w-32">
                <SelectField label="Kind" value={f.kind} options={(Object.keys(KIND_NAME) as FixtureKind[]).map((k) => ({ value: k, label: KIND_NAME[k] }))} onChange={(v) => upd(f.id, (x) => (x.kind = v as FixtureKind))} />
              </div>
              <Button size="icon" variant="ghost" aria-label={`Remove ${f.name}`} onClick={() => setList((l) => l.filter((x) => x.id !== f.id))}>
                <Trash2 />
              </Button>
            </div>
            {item && <ValueBadges item={item} />}
            <div className="grid grid-cols-3 gap-2">
              {s.k === 'block' && (
                <>
                  <NumField label="Length" value={s.length} min={0} onChange={(v) => upd(f.id, (x) => (x.shape = { ...s, length: v }))} />
                  <NumField label="Width" value={s.width} min={0} onChange={(v) => upd(f.id, (x) => (x.shape = { ...s, width: v }))} />
                  <NumField label="Height" value={s.height} min={0} onChange={(v) => upd(f.id, (x) => (x.shape = { ...s, height: v }))} />
                </>
              )}
              {s.k === 'round' && (
                <>
                  <NumField label="Diameter" value={s.diameter} min={0} onChange={(v) => upd(f.id, (x) => (x.shape = { ...s, diameter: v }))} />
                  <NumField label="Height" value={s.height} min={0} onChange={(v) => upd(f.id, (x) => (x.shape = { ...s, height: v }))} />
                </>
              )}
              {(s.k === 'outline' || s.k === 'model') && <span className="col-span-3 text-xs text-muted-foreground">{s.k === 'model' ? `From the model ${s.file}` : 'A drawn outline'}</span>}
            </div>
            {problems.length > 0 && <p className="text-xs text-red-600 dark:text-red-300">{problems.join(' ')}</p>}
          </div>
        )
      })}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setList((l) => [...l, { id: nanoid(8), name: 'New clamp', kind: 'clamp', shape: { k: 'block', length: 60, width: 40, height: 50 } }])}>
          <Plus /> Block
        </Button>
        <Button size="sm" variant="outline" onClick={() => setList((l) => [...l, { id: nanoid(8), name: 'New round pod', kind: 'pod', shape: { k: 'round', diameter: 120, height: 100 } }])}>
          <Plus /> Round
        </Button>
      </div>
    </Section>
  )
}
