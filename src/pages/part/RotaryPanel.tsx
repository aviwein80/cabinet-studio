/**
 * Rotary set-up of a part (M3.3, NEW-14): the rotary axis (along X, Y or Z through a point), the
 * blank held on it, and the wrapped planes round it: from a radius, from extents, or fitted to a
 * cylindrical face of a solid model. Each plane is unrolled into the drawing; shapes drawn inside
 * its rectangle are wrapped onto the cylinder by rotary operations.
 */
import { RotateCw, Trash2 } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { axisFromCylinder, blankRadius, defaultSetup, nextPlaneSpot, planeFromCylinder, planeFromRadius, planeRect, ROTARY_LETTER, setupProblems } from '@/cam/rotary/frame'
import { type PlacedCylinder, solidCylinders } from '@/cam/rotary/face'
import type { CamPart, RotaryAxis, RotarySetup, WrappedPlane } from '@/cam/types'
import { NumField, SelectField, TextField } from '@/components/fields'
import { Button } from '@/components/ui/button'
import { formatLength } from '@/core/units'
import type { UnitSystem } from '@/core/types'
import { loadModelSolid } from './solidData'

const ACROSS: Record<RotaryAxis, ['x' | 'y' | 'z', 'x' | 'y' | 'z']> = { X: ['y', 'z'], Y: ['x', 'z'], Z: ['x', 'y'] }

export function RotaryPanel({ part, units, onChange }: { part: CamPart; units: UnitSystem; onChange: (p: CamPart) => void }) {
  const s = part.rotary
  const fmt = (n: number) => formatLength(n, units)
  const set = (fn: (r: RotarySetup) => RotarySetup) => s && onChange({ ...part, rotary: fn(s) })
  const [faces, setFaces] = useState<{ model: string; name: string; c: PlacedCylinder }[] | null>(null)
  const [face, setFace] = useState('')
  const solids = (part.models ?? []).filter((m) => m.kind === 'solid')
  const solidKey = solids.map((m) => `${m.id}:${m.blob}:${JSON.stringify(m.place)}`).join('|')
  useEffect(() => {
    if (!s || !solids.length) return
    let live = true
    Promise.all(solids.map(async (m) => solidCylinders(await loadModelSolid(m.blob), m).map((c) => ({ model: m.id, name: m.name, c })))).then(
      (r) => live && setFaces(r.flat()),
      () => live && setFaces([]),
    )
    return () => {
      live = false
    }
    // (the solids' data and placement)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solidKey, !!s])

  if (!s)
    return (
      <section className="rounded-md border border-white/10 p-2.5">
        <h3 className="mb-1 flex items-center gap-1.5 font-medium text-stone-200">
          <RotateCw className="size-3.5" /> Rotary (4-axis)
        </h3>
        <p className="mb-2 text-[11px] text-stone-400">Turn the part on a rotary axis: a leg, a column, a spindle. The blank is held on the axis; wrapped planes round it carry drawn shapes onto the cylinder. Simulation and script posts for a rotary machine only: the N-200 has no rotary axis.</p>
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() => {
            const r = defaultSetup(part)
            const plane = planeFromRadius(r, r.blank.size / 2, { id: nanoid(8), name: 'Plane 1', at: nextPlaneSpot(r, part) })
            onChange({ ...part, rotary: { ...r, planes: [plane] } })
          }}
        >
          <RotateCw /> Turn this part on a rotary axis
        </Button>
      </section>
    )

  const problems = setupProblems(s)
  const [a, b] = ACROSS[s.axis]
  const setPlane = (id: string, patch: Partial<WrappedPlane>) => set((r) => ({ ...r, planes: r.planes.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
  const addPlane = (p: Omit<WrappedPlane, 'id' | 'name' | 'at'>) => set((r) => ({ ...r, planes: [...r.planes, { ...p, id: nanoid(8), name: `Plane ${r.planes.length + 1}`, at: nextPlaneSpot(r, part) }] }))
  const along = faces?.filter((f) => Math.abs(f.c.cyl.v[{ X: 0, Y: 1, Z: 2 }[s.axis]]) > 0.9999) ?? []
  const picked = along.find((f) => `${f.model}:${f.c.faceId}` === face) ?? along[0]
  return (
    <section className="flex flex-col gap-2 rounded-md border border-white/10 p-2.5" data-testid="rotary-panel">
      <h3 className="flex items-center gap-1.5 font-medium text-stone-200">
        <RotateCw className="size-3.5" /> Rotary (4-axis)
        <span className="ml-auto text-[11px] font-normal text-stone-400">
          {ROTARY_LETTER[s.axis]} turns about {s.axis}
        </span>
      </h3>
      <div className="grid grid-cols-3 gap-2">
        <SelectField label="Axis along" value={s.axis} options={(['X', 'Y', 'Z'] as const).map((v) => ({ value: v, label: `${v} (${ROTARY_LETTER[v]})` }))} onChange={(v) => set((r) => ({ ...r, axis: v }))} />
        <NumField label={`Through ${a.toUpperCase()}`} value={s.centre[a]} onChange={(v) => set((r) => ({ ...r, centre: { ...r.centre, [a]: v } }))} />
        <NumField label={`Through ${b.toUpperCase()}`} value={s.centre[b]} onChange={(v) => set((r) => ({ ...r, centre: { ...r.centre, [b]: v } }))} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <SelectField
          label="Blank"
          value={s.blank.shape}
          options={[
            { value: 'square', label: 'Square' },
            { value: 'round', label: 'Round' },
          ]}
          onChange={(v) => set((r) => ({ ...r, blank: { ...r.blank, shape: v } }))}
        />
        <NumField label={s.blank.shape === 'round' ? 'Diameter' : 'Side'} value={s.blank.size} min={0} onChange={(v) => set((r) => ({ ...r, blank: { ...r.blank, size: v } }))} />
        <NumField label={`Starts at ${s.axis}`} value={s.blank.start} onChange={(v) => set((r) => ({ ...r, blank: { ...r.blank, start: v } }))} />
        <NumField label={`Ends at ${s.axis}`} value={s.blank.end} onChange={(v) => set((r) => ({ ...r, blank: { ...r.blank, end: v } }))} />
      </div>
      <p className="text-[11px] text-stone-400">
        The blank reaches {fmt(blankRadius(s.blank))} from the axis. The part's drawing keeps its own frame: the axis passes through ({a.toUpperCase()} {fmt(s.centre[a])}, {b.toUpperCase()} {fmt(s.centre[b])}), angles turn from straight up.
      </p>
      {problems.length > 0 && (
        <ul className="list-disc rounded-md border border-red-400/30 bg-red-400/10 py-1.5 pr-2 pl-5 text-[11px] text-red-100">
          {problems.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
      <h4 className="mt-1 text-[11px] font-semibold tracking-wider text-stone-400 uppercase">Wrapped planes</h4>
      {s.planes.map((p) => {
        const r = planeRect(p)
        return (
          <div key={p.id} className="flex flex-col gap-1.5 rounded-md border border-white/10 p-2" data-cfg={`plane:${p.id}`}>
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <TextField label="Name" value={p.name} onChange={(v) => setPlane(p.id, { name: v })} />
              </div>
              <Button size="icon" variant="ghost" className="size-7" aria-label={`Remove ${p.name}`} onClick={() => set((x) => ({ ...x, planes: x.planes.filter((q) => q.id !== p.id) }))}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <NumField label="Radius" value={p.radius} min={0} onChange={(v) => setPlane(p.id, { radius: v, from: p.from === 'face' ? 'extents' : p.from })} />
              <NumField label="From" value={p.start} onChange={(v) => setPlane(p.id, { start: v, from: 'extents' })} />
              <NumField label="To" value={p.end} onChange={(v) => setPlane(p.id, { end: v, from: 'extents' })} />
              <NumField label="From angle" suffix="°" value={p.a0} onChange={(v) => setPlane(p.id, { a0: v, from: 'extents' })} />
              <NumField label="To angle" suffix="°" value={p.a1} onChange={(v) => setPlane(p.id, { a1: v, from: 'extents' })} />
              <div />
              <NumField label="Drawn at X" value={p.at.x} onChange={(v) => setPlane(p.id, { at: { ...p.at, x: v } })} />
              <NumField label="Drawn at Y" value={p.at.y} onChange={(v) => setPlane(p.id, { at: { ...p.at, y: v } })} />
            </div>
            <p className="text-[11px] text-stone-400">
              Unrolled: {fmt(r.x1 - r.x0)} along by {fmt(r.y1 - r.y0)} round (arc at R {fmt(p.radius)}), drawn from ({fmt(r.x0)}, {fmt(r.y0)}).
              {p.from === 'face' && p.face ? ` Fitted to face ${p.face.faceId ?? ''} (strays ${p.face.fit.toFixed(4)} mm).` : p.from === 'radius' ? ' The whole blank, all the way round.' : ''}
            </p>
          </div>
        )
      })}
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" onClick={() => addPlane(planeFromRadius(s, s.blank.size / 2, { id: '', name: '', at: { x: 0, y: 0 } }))}>
          Add plane (blank radius)
        </Button>
        <Button size="sm" variant="outline" onClick={() => addPlane({ ...planeFromRadius(s, s.blank.size / 2, { id: '', name: '', at: { x: 0, y: 0 } }), a0: 0, a1: 90, from: 'extents' })}>
          Add plane (extents)
        </Button>
      </div>
      {solids.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-white/15 p-2">
          <span className="text-[11px] text-stone-300">From a cylindrical face of a solid</span>
          {faces === null ? (
            <span className="text-[11px] text-stone-400">Reading the solids' faces…</span>
          ) : !along.length ? (
            <span className="text-[11px] text-stone-400">No cylindrical face runs along {s.axis}. Turn the model, or set the axis to match it.</span>
          ) : (
            <>
              <select aria-label="Cylindrical face" className="h-7 rounded-md border border-white/15 bg-transparent px-1.5 text-[11px]" value={picked ? `${picked.model}:${picked.c.faceId}` : ''} onChange={(e) => setFace(e.target.value)}>
                {along.map((f) => (
                  <option key={`${f.model}:${f.c.faceId}`} value={`${f.model}:${f.c.faceId}`} className="bg-[#15171c]">
                    {f.name} · face {f.c.faceId} · Ø{fmt(2 * f.c.cyl.r)}
                    {f.c.concave ? ' (hole)' : ''}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!picked}
                  onClick={() => {
                    const m = picked && axisFromCylinder(s, picked.c.cyl)
                    if (!m) return
                    if ('error' in m) return void toast.error(m.error)
                    set(() => m.setup)
                    toast.success(`The rotary axis now runs along ${m.setup.axis} through the face's axis.`)
                  }}
                >
                  Axis onto this face
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!picked}
                  onClick={() => {
                    if (!picked) return
                    const r = planeFromCylinder(s, picked.c.cyl, picked.c.points, { id: '', name: '', at: { x: 0, y: 0 }, modelId: picked.model, faceId: picked.c.faceId })
                    if ('error' in r) return void toast.error(r.error)
                    const { id: _i, name: _n, at: _a, ...rest } = r.plane
                    addPlane(rest)
                  }}
                >
                  Plane on this face
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      <p className="text-[11px] text-stone-400">Shapes drawn inside a plane's rectangle (dashed on the drawing) wrap onto it. Add rotary operations on the Machining tab. A turned part is never nested on a sheet.</p>
      <Button
        size="sm"
        variant="ghost"
        className="text-stone-400"
        onClick={() => {
          if (!window.confirm('Take this part off the rotary axis? Its wrapped planes go too; rotary operations stay, without a set-up.')) return
          onChange({ ...part, rotary: undefined })
        }}
      >
        Take the part off the rotary axis
      </Button>
    </section>
  )
}
