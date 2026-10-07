import { FileUp, MousePointerClick, Palette, RefreshCw, Spline } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { backend } from '@/app/backend'
import { useStore } from '@/app/store'
import { recipesOf } from '@/cam/rules'
import { faceLabel } from '@/cam/solid/encode'
import type { FaceAction } from '@/cam/solid/faces'
import { type FaceType, faceColors, facesByColor, facesByType, faceType, setFaceColor, staleSolidShapes } from '@/cam/solid/faceSelect'
import { faceCount, type SolidData } from '@/cam/solid/types'
import type { CamPart, ModelRef } from '@/cam/types'
import { brepVendorUrl, compute, occtVendorUrl, solidCompute } from '@/cam/worker/client'
import type { SolidFacesJob } from '@/cam/worker/tasks'
import { makeEntity } from '@/cam/doc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Cancelled } from '@/core/cancel'
import { useFacePick } from './facePick'
import { TaskProgress } from './ModelImportDialog'
import { addSurfaceModel, loadModelMesh, MODEL_LAYER, saveModelMesh } from './modelData'
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
  const [fillet, setFillet] = useState(3)
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

  /** Run a face job in the background worker (recognition can take a moment on big parts). */
  const inWorker = async <T,>(note: string, job: (signal: AbortSignal) => Promise<T>): Promise<T | null> => {
    const abort = new AbortController()
    setBusy({ fraction: 0.3, note, abort })
    try {
      return await job(abort.signal)
    } catch (e) {
      if (!(e instanceof Cancelled)) toast.error(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setBusy(null)
    }
  }
  const machine = async (action: FaceAction) => {
    if (!solid || !picked.length) return
    const r = await inWorker('Machining the faces', (signal) => compute().run('solid.machineFaces', { part, model, solid, faces: picked, action }, { signal }))
    if (!r) return
    if (r.opName) {
      onChange(r.part)
      toast.success(`${r.opName}: ${r.made} shape(s) from the picked faces`, r.warnings.length ? { description: r.warnings.join(' ') } : undefined)
    } else toast.warning(r.warnings.join(' ') || 'Nothing to machine on those faces.')
  }
  const send = async () => {
    if (!solid || !picked.length || !layer.trim()) return
    const rc = recipe === '__none__' ? undefined : recipesOf(lib ?? {}).find((x) => x.id === recipe)
    const r = await inWorker('Sending the faces', (signal) => compute().run('solid.sendFaces', { part, model, solid, faces: picked, layer, ...(rc ? { recipe: rc } : {}) }, { signal }))
    if (!r) return
    if (r.made) {
      onChange(r.part)
      toast.success(`${r.made} shape(s) on layer “${layer.trim()}”${rc ? ` with “${rc.name}”` : ''}`)
    } else toast.warning(r.warnings.join(' '))
  }
  const update = async () => {
    if (!solid) return
    const r = await inWorker('Updating the shapes', (signal) => compute().run('solid.refresh', { part, model, solid }, { signal }))
    if (!r) return
    onChange(r.part)
    if (r.missing) toast.warning(`${r.updated} shape(s) updated; ${r.missing} could not be found on the new solid (their faces are gone) and were left as they were.`)
    else toast.success(`${r.updated} shape(s) updated from the solid. Their operations are marked to calculate again.`)
  }
  /** Surfaces and edges from the picked faces (in part coordinates as the model sits). */
  const fromFaces = async (job: SolidFacesJob, name: string) => {
    if (!solid) return
    const abort = new AbortController()
    setBusy({ fraction: 0.3, note: name, abort })
    try {
      const r = await compute().run('solid.faces', { solid, place: model.place, job }, { signal: abort.signal })
      if (r.mesh) {
        onChange(await addSurfaceModel(part, r.mesh, `${model.name}: ${name.toLowerCase()}`, name))
        toast.success(`${name} added as a 3D model`)
      } else if (r.edges) {
        const layer = { id: 'model-edges', name: 'Model edges', color: '#f472b6', visible: true, locked: false }
        const layers = part.layers.some((l) => l.id === layer.id) ? part.layers : [...part.layers, layer]
        onChange({ ...part, layers, entities: [...part.entities, ...r.edges.map((pts) => makeEntity({ t: 'poly3d', pts }, layer.id))] })
        toast.success(`${r.edges.length} edge(s) as 3D polylines on “Model edges”`)
      }
    } catch (e) {
      if (!(e instanceof Cancelled)) toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }
  /**
   * The picked face's own rows and columns (its parameter lines, from the B-rep kernel, loaded in
   * the solid worker on first use), added as a surface model that curve-driven passes can follow.
   */
  const rowsAndColumns = async () => {
    if (!solid || picked.length !== 1) return
    if (!model.file) return void toast.warning('The file this solid came from is not stored with it. Import the file again.')
    const r = await inWorker('Rows and columns (first time: loading the B-rep kernel, about 23 MB)', async (signal) => {
      const gz = await backend.blobs.get(model.file!)
      if (!gz) throw new Error('The file this solid came from is missing from this computer (data/blobs). Import the file again.')
      return solidCompute().run('solid.faceGrid', { gz, name: model.source, solid, place: model.place, face: picked[0], brepVendor: brepVendorUrl() }, { signal })
    })
    if (!r) return
    onChange(await addSurfaceModel(part, r.mesh, `${model.name}: face ${r.faceId} rows and columns`, `Face ${r.faceId} rows and columns`))
    toast.success(`Face ${r.faceId} (${r.surface}): ${r.rows} rows × ${r.cols} columns added as a surface model`, { description: `Within ${r.chord < 0.001 ? '0.001' : r.chord.toFixed(3)} mm of the true surface. In curve-driven finishing choose "A surface's rows or columns" and this surface.${r.warnings.length ? ' ' + r.warnings.join(' ') : ''}` })
  }
  /** The solid as a plain mesh model (for mesh tools such as simplify); the solid is hidden. */
  const toMesh = async () => {
    try {
      const mesh = await loadModelMesh(model.blob)
      const hash = await saveModelMesh(mesh)
      const copy: ModelRef = { id: `${model.id}m`, name: `${model.name} (mesh)`, kind: 'mesh', blob: hash, source: model.source, units: model.units, place: { ...model.place }, layer: MODEL_LAYER.id, visible: true, triangles: mesh.indices.length / 3, size: model.size }
      onChange({ ...part, models: [...(part.models ?? []).map((m) => (m.id === model.id ? { ...m, visible: false } : m)), copy] })
      toast.success('Mesh copy added; the solid is hidden (its faces stay available).')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
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
        <Button size="xs" variant="ghost" disabled={!!busy} onClick={() => void toMesh()} title="A plain mesh copy of the solid">
          To mesh
        </Button>
        <Button size="xs" variant="ghost" disabled={!!busy} onClick={() => input.current?.click()} title="Read a new version of the file into this model">
          <FileUp /> New version
        </Button>
      </div>
      {busy && <TaskProgress fraction={busy.fraction} note={busy.note} onCancel={() => busy.abort.abort()} />}
      {stale.length > 0 && (
        <div className="flex items-center gap-2 rounded border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-amber-100">
          <span className="flex-1">The solid changed: {stale.length} shape(s) made from its faces are out of date, and so are their operations.</span>
          <Button size="xs" variant="secondary" onClick={() => void update()}>
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
              <Button key={a} size="xs" variant="secondary" onClick={() => void machine(a)}>
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
            <Button size="xs" variant="secondary" disabled={!layer.trim()} onClick={() => void send()}>
              Send to layer
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-stone-400">Surfaces:</span>
            <Button size="xs" variant="secondary" onClick={() => void fromFaces({ k: 'mesh', faces: picked }, 'Surface from faces')}>
              From faces
            </Button>
            <Button size="xs" variant="secondary" disabled={picked.length !== 1} onClick={() => void fromFaces({ k: 'untrim', face: picked[0], tol: 0.01 }, 'Untrimmed face')} title="The face's whole surface, without its holes and cut edges">
              Untrim
            </Button>
            <Button size="xs" variant="secondary" disabled={picked.length !== 1} onClick={() => void rowsAndColumns()} title="The face's own rows and columns (its parameter lines, true to its surface), for curve-driven passes. STEP and BREP files; loads the B-rep kernel (about 23 MB) the first time.">
              Rows and columns
            </Button>
            <Button size="xs" variant="secondary" onClick={() => void fromFaces({ k: 'edges', faces: picked, minAngle: 1 }, 'Edges')}>
              Edges
            </Button>
            <Button size="xs" variant="secondary" disabled={picked.length !== 2} onClick={() => void fromFaces({ k: 'fillet', a: picked[0], b: picked[1], r: fillet, tol: 0.01 }, `Fillet R${fillet}`)} title="Round the edge between two flat faces">
              Fillet
            </Button>
            <Input aria-label="Fillet radius" className="h-6 w-12 px-1 text-[11px]" defaultValue={fillet} onBlur={(e) => Number(e.target.value) > 0 && setFillet(Number(e.target.value))} />
          </div>
        </>
      )}
    </div>
  )
}
