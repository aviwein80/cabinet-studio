/**
 * Clamps, pods and rails on a part (M3.6, FIX-01): add them from the shop's library, from closed
 * shapes drawn on the part, or from a model file; place them by typing, by dragging on the drawing
 * or automatically clear of the toolpaths. The collision checks keep the tool, shank and holder (and
 * in the machine simulation the whole head) clear of them.
 */
import { Grip, Trash2, Wand2 } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { entityContours } from '@/cam/doc'
import { defaultBaseZ, fixtureFrom, fixtureTypesOf, KIND_NAME, outlineShape, shapeHeight, shapeProblems } from '@/cam/fixtures/fixture'
import { toPoints } from '@/cam/geom'
import type { Toolpath } from '@/cam/toolpath'
import type { CamPart, Fixture, FixtureKind, FixtureShape } from '@/cam/types'
import { compute } from '@/cam/worker/client'
import { ValueBadges } from '@/components/Configure'
import { LenInput } from '@/components/LenInput'
import { NumField, SwitchField, TextField } from '@/components/fields'
import { Button } from '@/components/ui/button'
import { Cancelled } from '@/core/cancel'
import { fixtureUnconfirmed } from '@/core/confirm'
import { formatLength } from '@/core/units'
import type { MachineProfile, UnitSystem } from '@/core/types'
import { TaskProgress } from './ModelImportDialog'

function Len({ label, value, units, onChange, min }: { label: string; value: number; units: UnitSystem; onChange: (v: number) => void; min?: number }) {
  return (
    <label className="flex flex-col gap-0.5 text-[11px] text-stone-400">
      {label}
      <LenInput label={label} value={value} units={units} onChange={(v) => Number.isFinite(v) && (min === undefined || v >= min) && onChange(v)} className="h-7 text-xs" />
    </label>
  )
}

export function FixturesPanel({ part, units, sel = [], machine, toolpaths, jobId, onChange }: { part: CamPart; units: UnitSystem; sel?: string[]; machine: MachineProfile; toolpaths: Toolpath[]; jobId?: string; onChange: (p: CamPart) => void }) {
  const fixtures = part.fixtures ?? []
  const fmt = (n: number) => formatLength(n, units)
  const types = fixtureTypesOf(machine)
  const [typeId, setTypeId] = useState(types[0]?.id ?? '')
  const [count, setCount] = useState(4)
  const [height, setHeight] = useState(40)
  const [busy, setBusy] = useState<{ fraction: number; note?: string; abort: AbortController } | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const type = types.find((t) => t.id === typeId) ?? types[0]
  const items = fixtureUnconfirmed(part, jobId)
  const set = (id: string, patch: Partial<Fixture>) => onChange({ ...part, fixtures: fixtures.map((f) => (f.id === id ? { ...f, ...patch } : f)) })
  // entering a size records it as the real one (no longer the invented example)
  const setShape = (f: Fixture, shape: FixtureShape) => set(f.id, { shape, placeholder: undefined })
  const add = (f: Fixture) => onChange({ ...part, fixtures: [...fixtures, f] })
  const nOf = (k: FixtureKind) => fixtures.filter((f) => f.kind === k).length + 1

  const run = async <T,>(note: string, job: (abort: AbortController, onProgress: (f: number, n?: string) => void) => Promise<T>): Promise<T | null> => {
    const abort = new AbortController()
    setBusy({ fraction: 0, note, abort })
    try {
      return await job(abort, (fraction, n) => setBusy({ fraction, note: n ?? note, abort }))
    } catch (e) {
      if (!(e instanceof Cancelled) && !abort.signal.aborted) toast.error(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setBusy(null)
    }
  }

  const fromLibrary = () => {
    if (!type) return
    // beside the part for a clamp (its front, at the middle), under its middle for a pod or rail
    const at = type.kind === 'clamp' ? { x: part.length / 2, y: -40 } : { x: part.length / 2, y: part.width / 2 }
    add(fixtureFrom(type, part, at, nanoid(8), nOf(type.kind)))
  }

  const fromShapes = () => {
    const loops = part.entities
      .filter((e) => sel.includes(e.id) && e.face === 1)
      .flatMap(entityContours)
      .filter((c) => c.closed)
      .map((c) => toPoints(c, 0.005).flatMap((p) => [p.x, p.y]))
    if (!loops.length) return void toast.error('Select one or more closed shapes on the drawing first.')
    const { shape, at } = outlineShape(loops, height)
    add({ id: nanoid(8), name: `Clamp ${nOf('clamp')}`, kind: 'clamp', shape, at: { ...at, z: -part.thickness }, rot: 0 })
    toast.success(`Fixture made from ${loops.length} shape${loops.length > 1 ? 's' : ''}, ${fmt(height)} tall, standing on the table.`)
  }

  const fromModel = async (f: File) => {
    const bytes = new Uint8Array(await f.arrayBuffer())
    const shape = await run('Reading the model', (abort, onProgress) => compute().run('fixtures.fromModel', { bytes, name: f.name }, { signal: abort.signal, onProgress }))
    if (!shape) return
    add({ id: nanoid(8), name: f.name.replace(/\.[^.]+$/, ''), kind: 'clamp', shape, at: { x: part.length / 2, y: -40, z: -part.thickness }, rot: 0 })
    toast.success(`Fixture from ${f.name}: ${shape.k === 'model' ? `${shape.slabs.length} slices of ${fmt(shape.size[2] / Math.max(1, shape.slabs.length))}` : ''}.`)
  }

  const placeAuto = async () => {
    if (!type) return
    if (!toolpaths.some((tp) => tp.moves.length)) return void toast.error('Calculate the operations first: the fixtures are placed clear of their toolpaths.')
    const ids = Array.from({ length: Math.max(1, count) }, () => nanoid(8))
    const r = await run('Placing fixtures', (abort, onProgress) => compute().run('fixtures.autoPlace', { part, toolpaths, machine, type, count, ids }, { signal: abort.signal, onProgress }))
    if (!r) return
    onChange({ ...part, fixtures: r.fixtures })
    const placed = r.fixtures.filter((f) => ids.includes(f.id)).length
    if (r.notes.length) toast.warning(r.notes.join(' '))
    else toast.success(`${placed} ${type.kind === 'clamp' ? 'clamp' : type.kind}${placed === 1 ? '' : 's'} placed clear of every toolpath (tool, shank, holder and the ${fmt(machine.collisionMargin ?? 2)} margin).`)
  }

  return (
    <section className="flex flex-col gap-2 rounded-md border border-white/10 p-2.5" data-testid="fixtures-panel">
      <h3 className="flex items-center gap-1.5 font-medium text-stone-200">
        <Grip className="size-3.5" /> Clamps, pods and rails
        <span className="ml-auto text-[11px] font-normal text-stone-400">{fixtures.length ? `${fixtures.length} on the part` : ''}</span>
      </h3>
      <p className="text-[11px] text-stone-400">They hold the part; nothing cuts them. The collision checks keep the cutter, shank and holder at least the margin ({fmt(machine.collisionMargin ?? 2)}) away, and a hit blocks the export. Drag them on the drawing to move them.</p>
      {fixtures.map((f) => {
        const s = f.shape
        const problems = shapeProblems(s)
        const item = items.find((u) => u.target.kind === 'fixture' && u.target.fixtureId === f.id)
        return (
          <div key={f.id} className="flex flex-col gap-1.5 rounded-md border border-white/10 p-2" data-cfg={`fixture:${part.id}:${f.id}`} data-testid="fixture-card">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <TextField label="Name" value={f.name} onChange={(v) => set(f.id, { name: v })} />
              </div>
              <select aria-label="Kind" className="h-8 rounded-md border border-white/15 bg-transparent px-1.5 text-[11px]" value={f.kind} onChange={(e) => set(f.id, { kind: e.target.value as FixtureKind })}>
                {(Object.keys(KIND_NAME) as FixtureKind[]).map((k) => (
                  <option key={k} value={k} className="bg-[#15171c]">
                    {KIND_NAME[k]}
                  </option>
                ))}
              </select>
              <Button size="icon" variant="ghost" className="size-7" aria-label={`Remove ${f.name}`} onClick={() => onChange({ ...part, fixtures: fixtures.filter((x) => x.id !== f.id) })}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            {item && (
              <div className="flex flex-wrap items-center gap-1 text-[11px] text-amber-200">
                Invented size ({item.value}) <ValueBadges item={item} onOpen={() => undefined} onConfirm={() => set(f.id, { placeholder: undefined })} />
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              {s.k === 'block' && (
                <>
                  <Len label="Length" value={s.length} units={units} min={0.01} onChange={(v) => setShape(f, { ...s, length: v })} />
                  <Len label="Width" value={s.width} units={units} min={0.01} onChange={(v) => setShape(f, { ...s, width: v })} />
                  <Len label="Height" value={s.height} units={units} min={0.01} onChange={(v) => setShape(f, { ...s, height: v })} />
                </>
              )}
              {s.k === 'round' && (
                <>
                  <Len label="Diameter" value={s.diameter} units={units} min={0.01} onChange={(v) => setShape(f, { ...s, diameter: v })} />
                  <Len label="Height" value={s.height} units={units} min={0.01} onChange={(v) => setShape(f, { ...s, height: v })} />
                  <div />
                </>
              )}
              {s.k === 'outline' && (
                <>
                  <span className="col-span-2 self-end text-[11px] text-stone-400">Drawn outline ({s.loops.length} loop{s.loops.length === 1 ? '' : 's'})</span>
                  <Len label="Height" value={s.height} units={units} min={0.01} onChange={(v) => setShape(f, { ...s, height: v })} />
                </>
              )}
              {s.k === 'model' && <span className="col-span-3 text-[11px] text-stone-400">Model {s.file}: {fmt(s.size[0])} × {fmt(s.size[1])} × {fmt(s.size[2])}, {s.triangles.toLocaleString('en')} facets, {s.slabs.length} slices (each holds all the model has between its heights)</span>}
              <Len label="X" value={f.at.x} units={units} onChange={(v) => set(f.id, { at: { ...f.at, x: v }, auto: undefined })} />
              <Len label="Y" value={f.at.y} units={units} onChange={(v) => set(f.id, { at: { ...f.at, y: v }, auto: undefined })} />
              <Len label="Base at Z" value={f.at.z} units={units} onChange={(v) => set(f.id, { at: { ...f.at, z: v } })} />
              <NumField label="Turned" suffix="°" value={f.rot} onChange={(v) => set(f.id, { rot: v, auto: undefined })} />
            </div>
            <p className="text-[11px] text-stone-400">
              From Z {fmt(f.at.z)} to {fmt(f.at.z + shapeHeight(s))} (face 1 is 0, the underside {fmt(-part.thickness)}). {f.at.z + 1e-6 < -part.thickness ? 'Under the part.' : f.at.z <= -part.thickness + 1e-6 ? 'Standing on the table.' : ''}
              {f.auto ? ' Placed automatically.' : ''}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => set(f.id, { at: { ...f.at, z: defaultBaseZ(f.kind, s, part.thickness) } })}>
                {f.kind === 'clamp' ? 'Stand it on the table' : 'Put it under the part'}
              </Button>
            </div>
            <SwitchField label="Leave out of the checks" checked={!!f.off} onChange={(v) => set(f.id, { off: v || undefined })} />
            {problems.length > 0 && (
              <ul className="list-disc rounded-md border border-red-400/30 bg-red-400/10 py-1.5 pr-2 pl-5 text-[11px] text-red-100">
                {problems.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
      <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-white/15 p-2">
        <span className="text-[11px] text-stone-300">From the shop's library (Machine &amp; tools → Fixtures)</span>
        <select aria-label="Fixture from the library" className="h-7 rounded-md border border-white/15 bg-transparent px-1.5 text-[11px]" value={type?.id ?? ''} onChange={(e) => setTypeId(e.target.value)}>
          {types.map((t) => (
            <option key={t.id} value={t.id} className="bg-[#15171c]">
              {t.name}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant="outline" onClick={fromLibrary} disabled={!type}>
            Add one
          </Button>
          <div className="flex items-center gap-1">
            <input aria-label="How many" type="number" min={1} max={32} className="h-8 w-12 rounded-md border border-white/15 bg-transparent px-1.5 text-xs" value={count} onChange={(e) => setCount(Math.max(1, Math.min(32, Math.round(Number(e.target.value) || 1))))} />
            <Button size="sm" variant="outline" className="flex-1" onClick={placeAuto} disabled={!type || !!busy} title="Placed where the tool, shank and holder never come within the margin">
              <Wand2 /> Place
            </Button>
          </div>
        </div>
        <span className="text-[11px] text-stone-400">"Place" puts that many {type?.kind === 'clamp' ? 'clamps round the part, as close as the toolpaths let them' : 'under the part, spread out, where no tool reaches below it'}; it replaces the ones it placed before.</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-end gap-1">
          <Len label="Height" value={height} units={units} min={0.01} onChange={setHeight} />
          <Button size="sm" variant="outline" className="flex-1" onClick={fromShapes} title="The selected closed shapes, stood up from the table">
            From shapes
          </Button>
        </div>
        <Button size="sm" variant="outline" className="self-end" onClick={() => file.current?.click()} disabled={!!busy}>
          From a model…
        </Button>
        <input ref={file} type="file" className="hidden" accept=".stl,.obj,.3mf,.step,.stp,.iges,.igs,.brep" onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void fromModel(f)
        }} />
      </div>
      {busy && <TaskProgress fraction={busy.fraction} note={busy.note} onCancel={() => busy.abort.abort()} />}
      <p className="text-[11px] text-stone-400">
        Library: {types.length} fixture{types.length === 1 ? '' : 's'}
        {types.some((t) => t.placeholder) ? ' (invented sizes: Configure on the Machine page)' : ''}.
      </p>
    </section>
  )
}
