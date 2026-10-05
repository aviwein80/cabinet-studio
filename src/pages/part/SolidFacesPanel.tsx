import { FileUp, MousePointerClick, Palette, RefreshCw, Spline } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/app/store'
import { recipesOf } from '@/cam/rules'
import { faceLabel } from '@/cam/solid/encode'
import { type FaceAction, type FaceType, faceColors, facesByColor, facesByType, faceType, machineFaces, refreshSolidShapes, sendFacesToLayer, setFaceColor, staleSolidShapes } from '@/cam/solid/faces'
import { faceCount, type SolidData } from '@/cam/solid/types'
import type { CamPart, ModelRef } from '@/cam/types'
import { occtVendorUrl, solidCompute } from '@/cam/worker/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Cancelled } from '@/core/cancel'
import { useFacePick } from './facePick'
import { TaskProgress } from './ModelImportDialog'
import { loadModelSolid, saveSolid } from './solidData'

const TYPES: { value: FaceType; label: string }[] = [
  { value: 'flat', label: 'Flat faces' },
  { value: 'hole', label: 'Hole walls' },
  { value: 'round', label: 'Round faces (convex)' },
  { value: 'cone', label: 'Conical faces' },
  { value: 'sphere', label: 'Spherical faces' },
  { value: 'free-form', label: 'Free-form faces' },
]

/**
 * Faces of a solid (SOL-02, SOL-03): pick them in the 3D view (Shift adds), or select them by
 * colour or type; then machine them, colour them, or send them to a layer (with a recipe).
 * Also: the solid's shapes are kept in step when a new version of the file is read.
 */
export function SolidFacesPanel({ part, model, onChange }: { part: CamPart; model: ModelRef; onChange: (p: CamPart) => void }) {
  const lib = useStore((s) => s.data?.library)
  const { modelId, faces: pickedAll, set: setPick, clear } = useFacePick()
  const picked = modelId === model.id ? pickedAll : []
  const [solid, setSolid] = useState<SolidData | null>(null)
  const [color, setColor] = useState('#3b82f6')
  const [layer, setLayer] = useState('')
  const [recipe, setRecipe] = useState('__none__')
  const [hole, setHole] = useState<number | null>(null)
  const [busy, setBusy] = useState<{ fraction: number; note?: string; abort: AbortController } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let live = true
    loadModelSolid(model.blob).then(
      (s) => live && setSolid(s),
      () => live && setSolid(null),
    )
    return () => {
      live = false
    }
  }, [model.blob])
  const stale = staleSolidShapes(part).filter((e) => e.solid?.modelId === model.id)
  const setModel = (m: ModelRef, p: CamPart = part) => ({ ...p, models: (p.models ?? []).map((x) => (x.id === model.id ? m : x)) })
  const faceOf = (id: number) => solid?.bodies.flatMap((b) => b.faces).find((f) => f.id === id)
  const holeSizes = solid ? [...new Set(solid.bodies.flatMap((b) => b.faces).filter((f) => faceType(f) === 'hole').map((f) => Math.round((f.surface.r ?? 0) * 2000) / 1000))].sort((a, b) => a - b) : []

  const machine = (action: FaceAction) => {
    if (!solid || !picked.length) return
    const r = machineFaces(part, model, solid, picked, action)
    if (r.op) {
      onChange(r.part)
      toast.success(`${r.op.name}: ${r.entities.length} shape(s) from the picked faces`, r.warnings.length ? { description: r.warnings.join(' ') } : undefined)
    } else toast.warning(r.warnings.join(' ') || 'Nothing to machine on those faces.')
  }
  const send = () => {
    if (!solid || !picked.length || !layer.trim()) return
    const rc = recipe === '__none__' ? undefined : recipesOf(lib ?? {}).find((x) => x.id === recipe)
    const r = sendFacesToLayer(part, model, solid, picked, layer, rc)
    if (r.entities.length) {
      onChange(r.part)
      toast.success(`${r.entities.length} shape(s) on layer “${layer.trim()}”${rc ? ` with “${rc.name}”` : ''}`)
    } else toast.warning(r.warnings.join(' '))
  }
  const update = () => {
    if (!solid) return
    const r = refreshSolidShapes(part, model, solid)
    onChange(r.part)
    if (r.missing.length) toast.warning(`${r.updated} shape(s) updated; ${r.missing.length} could not be found on the new solid (their faces are gone) and were left as they were.`)
    else toast.success(`${r.updated} shape(s) updated from the solid. Their operations are marked to calculate again.`)
  }
  /** Read a new version of the file: same model, new data; the shapes are then updated by face id. */
  const newVersion = async (f: File) => {
    const abort = new AbortController()
    setBusy({ fraction: 0, note: 'Reading the new version', abort })
    try {
      const bytes = new Uint8Array(await f.arrayBuffer())
      const s = await solidCompute().run('solid.import', { bytes: bytes.slice(), name: f.name, vendor: occtVendorUrl() }, { signal: abort.signal, onProgress: (fraction, note) => setBusy({ fraction, note, abort }) })
      // keep the same body (by name), as before
      const was = solid?.bodies.map((b) => b.name) ?? []
      const keep = s.bodies.filter((b) => was.includes(b.name))
      const one: SolidData = { ...s, bodies: keep.length ? keep : s.bodies.slice(0, 1) }
      const { blob, file } = await saveSolid(one, bytes)
      onChange(setModel({ ...model, blob, file, source: f.name, faces: faceCount(one), triangles: one.bodies.reduce((n, b) => n + b.indices.length / 3, 0) }))
      clear()
      toast.success(`New version read (${faceCount(one)} faces). Update the shapes to follow it.`)
    } catch (e) {
      if (!(e instanceof Cancelled)) toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-1.5 rounded border border-white/10 bg-white/[0.02] p-2 text-[11px]">
      <div className="flex items-center gap-1.5">
        <MousePointerClick className="size-3.5 text-sky-300" />
        <span className="flex-1 text-[10px] font-semibold tracking-wider text-stone-400 uppercase">Faces</span>
        <input ref={input} type="file" accept=".step,.stp,.iges,.igs,.brep" className="hidden" onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void newVersion(f)
          }} />
        <Button size="xs" variant="ghost" disabled={!!busy} onClick={() => input.current?.click()} title="Read a new version of the file into this model">
          <FileUp /> New version
        </Button>
      </div>
      {busy && <TaskProgress fraction={busy.fraction} note={busy.note} onCancel={() => busy.abort.abort()} />}
      {stale.length > 0 && (
        <div className="flex items-center gap-2 rounded border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-amber-100">
          <span className="flex-1">The solid changed: {stale.length} shape(s) made from its faces are out of date, and so are their operations.</span>
          <Button size="xs" variant="secondary" onClick={update}>
            <RefreshCw /> Update shapes
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5 text-stone-400">
        Select
        <Select value="" onValueChange={(c) => solid && setPick(model.id, facesByColor(solid, model, c))}>
          <SelectTrigger size="sm" className="h-6 w-28 text-[11px]" aria-label="Select faces by colour">
            <SelectValue placeholder="by colour" />
          </SelectTrigger>
          <SelectContent>
            {solid &&
              faceColors(solid, model).map((c) => (
                <SelectItem key={c.color} value={c.color}>
                  <span className="mr-1 inline-block size-2.5 rounded-sm border" style={{ background: c.color }} /> {c.color} ({c.faces})
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Select value="" onValueChange={(t) => solid && setPick(model.id, facesByType(solid, t as FaceType, t === 'hole' && hole !== null ? hole : undefined))}>
          <SelectTrigger size="sm" className="h-6 w-28 text-[11px]" aria-label="Select faces by type">
            <SelectValue placeholder="by type" />
          </SelectTrigger>
          <SelectContent>
            {TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {holeSizes.length > 0 && (
          <Select value={hole === null ? 'any' : String(hole)} onValueChange={(v) => setHole(v === 'any' ? null : Number(v))}>
            <SelectTrigger size="sm" className="h-6 w-20 text-[11px]" aria-label="Hole size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">any Ø</SelectItem>
              {holeSizes.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  Ø{d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {picked.length > 0 && (
          <Button size="xs" variant="ghost" onClick={clear}>
            Clear
          </Button>
        )}
      </div>
      {!picked.length ? (
        <p className="text-stone-500">Click faces in the 3D view to pick them (Shift adds), or select them by colour or type.</p>
      ) : (
        <>
          <div className="max-h-20 overflow-auto text-stone-300">
            {picked.length} picked: {picked.slice(0, 8).map((id) => (faceOf(id) ? faceLabel(faceOf(id)!) : `Face ${id}`)).join(', ')}
            {picked.length > 8 ? '…' : ''}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-stone-400">Machine:</span>
            {(['profile', 'pocket', 'drill', 'saw'] as FaceAction[]).map((a) => (
              <Button key={a} size="xs" variant="secondary" onClick={() => machine(a)}>
                {a === 'profile' ? 'Profile' : a === 'pocket' ? 'Pocket' : a === 'drill' ? 'Drill' : 'Saw'}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Palette className="size-3.5 text-stone-400" />
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Face colour" className="h-6 w-8 cursor-pointer rounded border border-white/10 bg-transparent" />
            <Button size="xs" variant="secondary" onClick={() => onChange(setModel(setFaceColor(model, picked, color)))}>
              Colour faces
            </Button>
            <Button size="xs" variant="ghost" onClick={() => onChange(setModel(setFaceColor(model, picked, null)))}>
              File colour
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Spline className="size-3.5 text-stone-400" />
            <Input list={`layers-${model.id}`} className="h-6 w-28 px-1.5 text-[11px]" placeholder="Layer name" aria-label="Layer to send the faces to" value={layer} onChange={(e) => setLayer(e.target.value)} />
            <datalist id={`layers-${model.id}`}>
              {part.layers.map((l) => (
                <option key={l.id} value={l.name} />
              ))}
            </datalist>
            <Select value={recipe} onValueChange={setRecipe}>
              <SelectTrigger size="sm" className="h-6 w-32 text-[11px]" aria-label="Recipe for the faces">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No recipe (layer rules)</SelectItem>
                {recipesOf(lib ?? {}).map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="xs" variant="secondary" disabled={!layer.trim()} onClick={send}>
              Send to layer
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
