/**
 * Tilted work planes of a part (M3.4, 5AX-01, positional 3+2): planes through the part at any
 * angle, from angles typed in, a side of the part's block, or a flat face of a solid model. Each
 * has a rectangle on the drawing; shapes drawn inside it lie on the plane, and drilling, pockets,
 * profiles and engraving on that plane cut them into the part with the tool along its normal.
 */
import { Rotate3d, Trash2 } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { blockDepthBelow, nextTiltedSpot, type PartSide, planeFrame, planeFromFace, SIDE_NAMES, sidePlane, tiltedProblems } from '@/cam/positional/frame'
import { type PlacedFlat, solidFlats } from '@/cam/positional/face'
import type { CamPart, TiltedPlane } from '@/cam/types'
import { NumField, SwitchField, TextField } from '@/components/fields'
import { Button } from '@/components/ui/button'
import { formatLength } from '@/core/units'
import type { UnitSystem } from '@/core/types'
import { loadModelSolid } from './solidData'

const r3 = (n: number) => (Math.abs(n) < 5e-4 ? '0' : n.toFixed(3))

export function TiltedPlanesPanel({ part, units, onChange }: { part: CamPart; units: UnitSystem; onChange: (p: CamPart) => void }) {
  const planes = part.tilted ?? []
  const fmt = (n: number) => formatLength(n, units)
  const [faces, setFaces] = useState<{ model: string; name: string; f: PlacedFlat }[] | null>(null)
  const [face, setFace] = useState('')
  const [side, setSide] = useState<PartSide>('front')
  const solids = (part.models ?? []).filter((m) => m.kind === 'solid')
  const solidKey = solids.map((m) => `${m.id}:${m.blob}:${JSON.stringify(m.place)}`).join('|')
  useEffect(() => {
    if (!solids.length) return
    let live = true
    Promise.all(solids.map(async (m) => solidFlats(await loadModelSolid(m.blob), m).map((f) => ({ model: m.id, name: m.name, f })))).then(
      (r) => live && setFaces(r.flat().filter((x) => Math.abs(x.f.n[2]) < 0.9999)),
      () => live && setFaces([]),
    )
    return () => {
      live = false
    }
    // (the solids' data and placement)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solidKey])

  const setPlane = (id: string, patch: Partial<TiltedPlane>) => onChange({ ...part, tilted: planes.map((p) => (p.id === id ? { ...p, ...patch } : p)) })
  const add = (fields: Omit<TiltedPlane, 'id' | 'name' | 'at'>, name?: string) => {
    const p: TiltedPlane = { ...fields, id: nanoid(8), name: name ?? `Tilted plane ${planes.length + 1}`, at: nextTiltedSpot(part) }
    onChange({ ...part, tilted: [...planes, p] })
  }
  const picked = faces?.find((f) => `${f.model}:${f.f.faceId}` === face) ?? faces?.[0]

  return (
    <section className="flex flex-col gap-2 rounded-md border border-white/10 p-2.5" data-testid="tilted-panel">
      <h3 className="flex items-center gap-1.5 font-medium text-stone-200">
        <Rotate3d className="size-3.5" /> Tilted planes (3+2)
        <span className="ml-auto text-[11px] font-normal text-stone-400">{planes.length ? `${planes.length} plane${planes.length === 1 ? '' : 's'}` : ''}</span>
      </h3>
      <p className="text-[11px] text-stone-400">
        A plane at any angle: holes, pockets, profiles and engraving on it are cut with the tool along its normal, the rotary axes locked (positional, 3+2). Simulation, and script posts for a machine with two rotary axes only: the N-200 cannot tilt its tool, so a part with tilted operations is never nested or written to woodWOP.
      </p>
      {planes.map((p) => {
        const problems = tiltedProblems(p)
        const f = planeFrame(p)
        const level = p.tilt < 1e-6 || p.tilt > 180 - 1e-6
        return (
          <div key={p.id} className="flex flex-col gap-1.5 rounded-md border border-white/10 p-2" data-cfg={`tilted:${p.id}`}>
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <TextField label="Name" value={p.name} onChange={(v) => setPlane(p.id, { name: v })} />
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label={`Remove ${p.name}`}
                onClick={() => {
                  const using = part.ops.filter((o) => o.tiltedPlane === p.id).length
                  if (using && !window.confirm(`${using} operation(s) work on ${p.name}. Remove the plane anyway? They stay, without a plane.`)) return
                  onChange({ ...part, tilted: planes.filter((q) => q.id !== p.id) })
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <NumField label="Tilt" suffix="°" value={p.tilt} min={0} max={180} onChange={(v) => setPlane(p.id, { tilt: v, from: 'angles' })} />
              <NumField label="Towards" suffix="°" value={p.toward} onChange={(v) => setPlane(p.id, { toward: v, from: 'angles' })} />
              <NumField label="Turn on it" suffix="°" value={p.spin} onChange={(v) => setPlane(p.id, { spin: v, from: 'angles' })} />
              <NumField label="Origin X" value={p.origin.x} onChange={(v) => setPlane(p.id, { origin: { ...p.origin, x: v } })} />
              <NumField label="Origin Y" value={p.origin.y} onChange={(v) => setPlane(p.id, { origin: { ...p.origin, y: v } })} />
              <NumField label="Origin Z" value={p.origin.z} onChange={(v) => setPlane(p.id, { origin: { ...p.origin, z: v } })} />
              <NumField label="Size along x" value={p.size.x} min={0} onChange={(v) => setPlane(p.id, { size: { ...p.size, x: v } })} />
              <NumField label="Size along y" value={p.size.y} min={0} onChange={(v) => setPlane(p.id, { size: { ...p.size, y: v } })} />
              <div />
              <NumField label="Drawn at X" value={p.at.x} onChange={(v) => setPlane(p.id, { at: { ...p.at, x: v } })} />
              <NumField label="Drawn at Y" value={p.at.y} onChange={(v) => setPlane(p.id, { at: { ...p.at, y: v } })} />
            </div>
            <SwitchField label="Use the machine's other solution" checked={!!p.flip} onChange={(v) => setPlane(p.id, { flip: v || undefined })} hint="The head (or table) turned the other way round: the same tool direction with the other pair of angles." />
            <p className="text-[11px] text-stone-400">
              Tool along ({r3(f.z[0])}, {r3(f.z[1])}, {r3(f.z[2])}){level ? '' : `: tilted ${Math.round(p.tilt * 100) / 100}° towards ${Math.round(p.toward * 100) / 100}°`}. Its x runs along ({r3(f.x[0])}, {r3(f.x[1])}, {r3(f.x[2])}). The block reaches {fmt(blockDepthBelow(part, f))} below it.
              {p.from === 'face' && p.face ? ` Fitted to face ${p.face.faceId ?? ''} (strays ${p.face.fit.toFixed(4)} mm).` : p.from === 'side' ? ' A side of the part\'s block.' : ''}
            </p>
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
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" onClick={() => add({ origin: { x: 0, y: 0, z: 0 }, tilt: 30, toward: -90, spin: 0, size: { x: part.length, y: part.width }, from: 'angles' })}>
          Add plane (angles)
        </Button>
        <div className="flex gap-1">
          <select aria-label="Side of the block" className="h-8 min-w-0 flex-1 rounded-md border border-white/15 bg-transparent px-1.5 text-[11px]" value={side} onChange={(e) => setSide(e.target.value as PartSide)}>
            {(Object.keys(SIDE_NAMES) as PartSide[]).map((s) => (
              <option key={s} value={s} className="bg-[#15171c]">
                {SIDE_NAMES[s]}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={() => add({ ...sidePlane(part, side), from: 'side' }, SIDE_NAMES[side])}>
            Add side
          </Button>
        </div>
      </div>
      {solids.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-white/15 p-2">
          <span className="text-[11px] text-stone-300">From a flat face of a solid</span>
          {faces === null ? (
            <span className="text-[11px] text-stone-400">Reading the solids' faces…</span>
          ) : !faces.length ? (
            <span className="text-[11px] text-stone-400">No flat face of a solid that is not level.</span>
          ) : (
            <>
              <select aria-label="Flat face" className="h-7 rounded-md border border-white/15 bg-transparent px-1.5 text-[11px]" value={picked ? `${picked.model}:${picked.f.faceId}` : ''} onChange={(e) => setFace(e.target.value)}>
                {faces.map((x) => (
                  <option key={`${x.model}:${x.f.faceId}`} value={`${x.model}:${x.f.faceId}`} className="bg-[#15171c]">
                    {x.name} · face {x.f.faceId} · tilted {Math.round((Math.acos(Math.max(-1, Math.min(1, x.f.n[2]))) * 18000) / Math.PI) / 100}°
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="outline"
                disabled={!picked}
                onClick={() => {
                  if (!picked) return
                  const r = planeFromFace(picked.f.n, picked.f.points)
                  if ('error' in r) return void toast.error(r.error)
                  add({ ...r.fields, from: 'face', face: { modelId: picked.model, faceId: picked.f.faceId, fit: Math.max(r.fit, picked.f.fit) } }, `Face ${picked.f.faceId}`)
                }}
              >
                Plane on this face
              </Button>
            </>
          )}
        </div>
      )}
      <p className="text-[11px] text-stone-400">Draw the shapes inside a plane's rectangle (dashed orange on the drawing; x and y from its thick corner), then pick that plane as the work plane of a drilling, pocket, profile or engraving operation on the Machining tab.</p>
    </section>
  )
}
