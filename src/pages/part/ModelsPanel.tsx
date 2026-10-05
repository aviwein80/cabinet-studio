import { Box, Eye, EyeOff, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { makeEntity } from '@/cam/doc'
import { area } from '@/cam/geom'
import { fitWorkVolumeToModel } from '@/cam/mesh/place'
import type { CamPart, Entity, Layer, ModelRef, UpAxis } from '@/cam/types'
import type { TaskIn, TaskName, TaskOut } from '@/cam/worker/tasks'
import { compute } from '@/cam/worker/client'
import { LenInput } from '@/components/LenInput'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Cancelled } from '@/core/cancel'
import { formatLength } from '@/core/units'
import type { UnitSystem } from '@/core/types'
import { addSurfaceModel, loadModelMesh, saveModelMesh, UP_OPTIONS } from './modelData'
import { placeMesh } from '@/cam/mesh/place'
import { TaskProgress } from './ModelImportDialog'
import { SolidFacesPanel } from './SolidFacesPanel'
import { SolidFeatures } from './SolidFeatures'
import { SurfacesPanel } from './SurfacesPanel'

const LAYERS: Record<'sections' | 'outline' | 'edges', Layer> = {
  sections: { id: 'model-sections', name: 'Model sections', color: '#34d399', visible: true, locked: false },
  outline: { id: 'model-outline', name: 'Model outline', color: '#fbbf24', visible: true, locked: false },
  edges: { id: 'model-edges', name: 'Model edges', color: '#f472b6', visible: true, locked: false },
}

const withLayer = (part: CamPart, l: Layer): Layer[] => (part.layers.some((x) => x.id === l.id) ? part.layers : [...part.layers, { ...l }])

/** 3D models on the part: placement, work volume, sections, outline, edges, simplify, clean-up. */
export function ModelsPanel({ part, units, sel = [], onChange, onImport }: { part: CamPart; units: UnitSystem; sel?: string[]; onChange: (p: CamPart) => void; onImport: () => void }) {
  const models = part.models ?? []
  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      <Button size="sm" variant="outline" onClick={onImport}>
        <Box /> Import 3D model…
      </Button>
      <SurfacesPanel part={part} sel={sel} units={units} onChange={onChange} />
      {!models.length && <p className="text-stone-400">No 3D models yet. Import an STL, OBJ or 3MF file: a relief, a carved panel or a shaped part.</p>}
      {models.map((m) => (
        <ModelCard key={m.id} part={part} model={m} units={units} onChange={onChange} />
      ))}
    </div>
  )
}

function ModelCard({ part, model, units, onChange }: { part: CamPart; model: ModelRef; units: UnitSystem; onChange: (p: CamPart) => void }) {
  const fmt = (n: number) => formatLength(n, units)
  const [busy, setBusy] = useState<{ fraction: number; note?: string; abort: AbortController } | null>(null)
  const [over, setOver] = useState(part.workVolume?.modelId === model.id ? part.workVolume.oversize : { xy: 10, top: 0, bottom: 6 })
  const [z, setZ] = useState({ from: -1, to: -Math.max(1, Math.round(model.size[2])), step: 2 })
  const [simp, setSimp] = useState<{ mode: 'percent' | 'tolerance'; value: number }>({ mode: 'tolerance', value: 0.02 })
  const setModel = (fn: (m: ModelRef) => ModelRef, p: CamPart = part) => onChange({ ...p, models: (p.models ?? []).map((x) => (x.id === model.id ? fn(x) : x)) })
  const place = model.place

  /** Run a worker task on this model's mesh with progress and cancel. */
  const run = async <K extends TaskName>(note: string, task: K, input: (mesh: TaskIn<'mesh.size'>['mesh']) => TaskIn<K>): Promise<TaskOut<K> | null> => {
    const abort = new AbortController()
    setBusy({ fraction: 0, note, abort })
    try {
      const mesh = await loadModelMesh(model.blob)
      return await compute().run(task, input(mesh), { signal: abort.signal, onProgress: (fraction, n) => setBusy({ fraction, note: n ?? note, abort }) })
    } catch (e) {
      if (!(e instanceof Cancelled)) toast.error(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setBusy(null)
    }
  }

  const addEntities = (es: Entity[], l: Layer, msg: string) => {
    if (!es.length) return toast.warning('Nothing found at that level.')
    onChange({ ...part, layers: withLayer(part, l), entities: [...part.entities, ...es] })
    toast.success(msg)
  }

  const fitVolume = async () => {
    const size = await run('Measuring', 'mesh.size', (mesh) => ({ mesh, place }))
    if (!size) return
    const next = fitWorkVolumeToModel(part, model.id, size, over)
    onChange(next)
    toast.success(`Part is now ${fmt(next.length)} × ${fmt(next.width)} × ${fmt(next.thickness)}`)
  }

  const sections = async () => {
    const levels: number[] = []
    const step = Math.max(0.1, Math.abs(z.step))
    for (let v = z.from; v >= z.to - 1e-9 && levels.length < 500; v -= step) levels.push(Math.round(v * 1000) / 1000)
    const out = await run('Cutting sections', 'mesh.section', (mesh) => ({ mesh, place, levels, fitTol: 0.01 }))
    if (!out) return
    const es = out.flatMap((s) => s.contours.map((c) => makeEntity({ t: 'contour', c }, LAYERS.sections.id, 1, { depth: Math.round(-s.z * 1000) / 1000, tag: `section:${model.id}:${s.z}` })))
    addEntities(es, LAYERS.sections, `${es.length} section contour${es.length === 1 ? '' : 's'} at ${levels.length} level${levels.length === 1 ? '' : 's'} (depth stored on each)`)
  }

  const outline = async (asOutline: boolean) => {
    const out = await run('Projecting outline', 'mesh.outline', (mesh) => ({ mesh, place }))
    if (!out) return
    const es = out.map((c) => makeEntity({ t: 'contour', c }, LAYERS.outline.id, 1, { tag: `outline:${model.id}` }))
    if (asOutline && es.length) {
      const biggest = es.reduce((a, b) => (a.g.t === 'contour' && b.g.t === 'contour' && Math.abs(area(b.g.c)) > Math.abs(area(a.g.c)) ? b : a))
      onChange({ ...part, layers: withLayer(part, LAYERS.outline), entities: [...part.entities, ...es], outlineId: biggest.id })
      toast.success('Model outline added and used as the part outline')
    } else addEntities(es, LAYERS.outline, `${es.length} outline contour${es.length === 1 ? '' : 's'} added`)
  }

  const edges = async () => {
    const out = await run('Finding edges', 'mesh.edges', (mesh) => ({ mesh, place, angle: 30 }))
    if (!out) return
    addEntities(
      out.map((pts) => makeEntity({ t: 'poly3d', pts }, LAYERS.edges.id, 1)),
      LAYERS.edges,
      `${out.length} edge polyline${out.length === 1 ? '' : 's'} (folds over 30° and open edges)`,
    )
  }

  const replaceMesh = async (makeNew: () => Promise<{ mesh: TaskIn<'blob.pack'>['mesh']; msg: string } | null>) => {
    const r = await makeNew()
    if (!r) return
    setBusy({ fraction: 0.9, note: 'Storing', abort: new AbortController() })
    try {
      const hash = await saveModelMesh(r.mesh)
      setModel((m) => ({ ...m, blob: hash, original: m.original ?? m.blob, triangles: r.mesh.indices.length / 3 }))
      toast.success(r.msg)
    } finally {
      setBusy(null)
    }
  }

  const simplify = () =>
    replaceMesh(async () => {
      const r = await run('Simplifying', 'mesh.simplify', (mesh) => ({ mesh, target: simp.mode === 'percent' ? { k: 'percent', percent: simp.value } : { k: 'tolerance', mm: simp.value } }))
      if (!r) return null
      if (r.after === r.before) {
        toast.warning('Could not simplify within that tolerance; the model is unchanged.')
        return null
      }
      return { mesh: r.mesh, msg: `${r.before.toLocaleString('en')} → ${r.after.toLocaleString('en')} facets; measured deviation ${fmt(r.deviation)} (largest)` }
    })

  const dropUnderside = () =>
    replaceMesh(async () => {
      const r = await run('Removing facets', 'mesh.deleteFacets', (mesh) => ({ mesh, filter: { k: 'facing-down', maxDeg: 10 } }))
      if (!r) return null
      return { mesh: r.mesh, msg: `${(model.triangles - r.report.kept).toLocaleString('en')} downward facets removed` }
    })

  const [ext, setExt] = useState(2)
  const [cutZ, setCutZ] = useState(-5)
  /** Extend or split this surface (in part coordinates); the result is a new model, this one is hidden. */
  const surfaceEdit = async (what: 'extend' | 'above' | 'below') => {
    const abort = new AbortController()
    setBusy({ fraction: 0.3, note: what === 'extend' ? 'Extending' : 'Splitting', abort })
    try {
      const placed = placeMesh(await loadModelMesh(model.blob), model.place)
      const mesh = await compute().run('surface.make', what === 'extend' ? { k: 'extend', mesh: placed, d: ext } : { k: 'split', mesh: placed, z: cutZ, keep: what }, { signal: abort.signal })
      const next = await addSurfaceModel(part, mesh, `${model.name} (${what === 'extend' ? `extended ${ext}` : `${what} Z${cutZ}`})`, what === 'extend' ? 'Extend' : 'Split')
      onChange({ ...next, models: (next.models ?? []).map((m) => (m.id === model.id ? { ...m, visible: false } : m)) })
      toast.success(what === 'extend' ? 'Extended surface added; the original is hidden.' : `The part ${what} Z ${cutZ} added; the original is hidden.`)
    } catch (e) {
      if (!(e instanceof Cancelled)) toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const rep = model.report
  return (
    <div className="flex flex-col gap-2 rounded-md border border-white/10 bg-black/20 p-2.5">
      <div className="flex items-center gap-1.5">
        <Box className="size-3.5 text-violet-300" />
        <span className="min-w-0 flex-1 truncate font-medium" title={model.source}>
          {model.name}
        </span>
        <Button size="icon-xs" variant="ghost" aria-label={model.visible ? 'Hide model' : 'Show model'} onClick={() => setModel((m) => ({ ...m, visible: !m.visible }))}>
          {model.visible ? <Eye /> : <EyeOff />}
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Remove model"
          onClick={() => onChange({ ...part, models: (part.models ?? []).filter((m) => m.id !== model.id), ...(part.workVolume?.modelId === model.id ? { workVolume: undefined } : {}) })}
        >
          <Trash2 />
        </Button>
      </div>
      <div className="flex flex-wrap gap-1">
        {model.kind === 'solid' ? (
          <>
            <Badge variant="outline">{model.format ?? 'Solid'}</Badge>
            <Badge variant="outline">{(model.faces ?? 0).toLocaleString('en')} faces</Badge>
          </>
        ) : (
          <Badge variant="outline">{model.triangles.toLocaleString('en')} facets</Badge>
        )}
        {rep && <Badge variant="outline">{rep.openEdges ? `${rep.openEdges} open edges` : 'closed'}</Badge>}
        {model.original && <Badge variant="outline">simplified</Badge>}
      </div>
      {model.kind === 'solid' && <SolidFeatures part={part} model={model} units={units} onChange={onChange} />}
      {model.kind === 'solid' && <SolidFacesPanel part={part} model={model} onChange={onChange} />}
      {busy && <TaskProgress fraction={busy.fraction} note={busy.note} onCancel={() => busy.abort.abort()} />}

      <fieldset disabled={!!busy} className="grid gap-2">
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 text-stone-400">
          <span>Up</span>
          <Select value={place.up} onValueChange={(v) => setModel((m) => ({ ...m, place: { ...m.place, up: v as UpAxis } }))}>
            <SelectTrigger size="sm" aria-label="Which way is up">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UP_OPTIONS.map((u) => (
                <SelectItem key={u.value} value={u.value}>
                  {u.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span>Turn / scale</span>
          <div className="flex items-center gap-1.5">
            <Input aria-label="Turn about Z in degrees" className="h-7 w-14 px-1.5 text-xs" defaultValue={place.rotZ} key={`r${place.rotZ}`} onBlur={(e) => Number.isFinite(Number(e.target.value)) && setModel((m) => ({ ...m, place: { ...m.place, rotZ: Number(e.target.value) } }))} />°
            <Input aria-label="Scale factor" className="h-7 w-14 px-1.5 text-xs" defaultValue={place.scale} key={`s${place.scale}`} onBlur={(e) => Number(e.target.value) > 0 && setModel((m) => ({ ...m, place: { ...m.place, scale: Number(e.target.value) } }))} />×
            <label className="ml-1 flex items-center gap-1">
              <Switch checked={place.mirror} onCheckedChange={(v) => setModel((m) => ({ ...m, place: { ...m.place, mirror: v } }))} aria-label="Mirror" /> Mirror
            </label>
          </div>
          <span>At X, Y, top</span>
          <div className="flex gap-1">
            {[0, 1, 2].map((k) => (
              <LenInput
                key={k}
                label={['Model X', 'Model Y', 'Model top Z'][k]}
                value={place.at[k]}
                units={units}
                onChange={(v) => Number.isFinite(v) && setModel((m) => ({ ...m, place: { ...m.place, at: m.place.at.map((a, i) => (i === k ? v : a)) as [number, number, number] } }))}
              />
            ))}
          </div>
        </div>

        <Group title="Work volume">
          <span>Around</span>
          <LenInput label="Oversize around" value={over.xy} units={units} onChange={(v) => setOver({ ...over, xy: Number.isFinite(v) ? Math.max(0, v) : 0 })} />
          <span>Above</span>
          <LenInput label="Material above" value={over.top} units={units} onChange={(v) => setOver({ ...over, top: Number.isFinite(v) ? Math.max(0, v) : 0 })} />
          <span>Below</span>
          <LenInput label="Material below" value={over.bottom} units={units} onChange={(v) => setOver({ ...over, bottom: Number.isFinite(v) ? Math.max(0, v) : 0 })} />
          <Button size="xs" variant="secondary" onClick={() => void fitVolume()}>
            Fit part
          </Button>
        </Group>

        <Group title="Sections (Z below face 1)">
          <span>From</span>
          <LenInput label="First section Z" value={z.from} units={units} onChange={(v) => Number.isFinite(v) && setZ({ ...z, from: v })} />
          <span>to</span>
          <LenInput label="Last section Z" value={z.to} units={units} onChange={(v) => Number.isFinite(v) && setZ({ ...z, to: v })} />
          <span>every</span>
          <LenInput label="Section step" value={z.step} units={units} onChange={(v) => Number.isFinite(v) && setZ({ ...z, step: v })} />
          <Button size="xs" variant="secondary" onClick={() => void sections()}>
            Cut
          </Button>
        </Group>

        {model.kind !== 'solid' && (
          <Group title="Surface">
            <Button size="xs" variant="secondary" onClick={() => void surfaceEdit('extend')} title="Extend the open edges straight on">
              Extend by
            </Button>
            <LenInput label="Extend by" value={ext} units={units} onChange={(v) => Number.isFinite(v) && v > 0 && setExt(v)} />
            <Button size="xs" variant="secondary" onClick={() => void surfaceEdit('above')}>
              Keep above
            </Button>
            <Button size="xs" variant="secondary" onClick={() => void surfaceEdit('below')}>
              Keep below
            </Button>
            Z <LenInput label="Split at Z" value={cutZ} units={units} onChange={(v) => Number.isFinite(v) && setCutZ(v)} />
          </Group>
        )}
        {model.kind !== 'solid' && (
        <Group title="Simplify">
          <Select value={simp.mode} onValueChange={(v) => setSimp({ mode: v as 'percent' | 'tolerance', value: v === 'percent' ? 10 : 0.02 })}>
            <SelectTrigger size="sm" aria-label="Simplify by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tolerance">Keep within</SelectItem>
              <SelectItem value="percent">Keep % of facets</SelectItem>
            </SelectContent>
          </Select>
          {simp.mode === 'tolerance' ? (
            <LenInput label="Simplify tolerance" value={simp.value} units={units} onChange={(v) => Number.isFinite(v) && v > 0 && setSimp({ ...simp, value: v })} />
          ) : (
            <Input aria-label="Percent of facets to keep" className="h-7 w-14 px-1.5 text-xs" defaultValue={simp.value} onBlur={(e) => Number(e.target.value) > 0 && setSimp({ ...simp, value: Math.min(100, Number(e.target.value)) })} />
          )}
          <Button size="xs" variant="secondary" onClick={() => void simplify()}>
            Simplify
          </Button>
        </Group>
        )}

        <div className="flex flex-wrap gap-1.5">
          <Button size="xs" variant="secondary" onClick={() => void outline(false)}>
            Outline to drawing
          </Button>
          <Button size="xs" variant="secondary" onClick={() => void outline(true)}>
            Use as part outline
          </Button>
          <Button size="xs" variant="secondary" onClick={() => void edges()}>
            Edges to polylines
          </Button>
          {model.kind !== 'solid' && (
            <Button size="xs" variant="secondary" onClick={() => void dropUnderside()}>
              Remove underside facets
            </Button>
          )}
          {model.original && (
            <Button size="xs" variant="ghost" onClick={() => setModel((m) => ({ ...m, blob: m.original!, original: undefined, triangles: m.report?.kept ?? m.triangles }))}>
              Back to the original
            </Button>
          )}
        </div>
      </fieldset>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <div className="text-[10px] font-semibold tracking-wider text-stone-500 uppercase">{title}</div>
      <div className="flex flex-wrap items-center gap-1.5 text-stone-400">{children}</div>
    </div>
  )
}
