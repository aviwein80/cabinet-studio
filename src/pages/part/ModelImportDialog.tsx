import { Box, FileUp, Loader2, TriangleAlert } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { DEFAULT_PLACEMENT, fitWorkVolumeToModel } from '@/cam/mesh/place'
import { type MeshUnits, meshBounds } from '@/cam/mesh/types'
import type { CamPart, ModelRef, UpAxis } from '@/cam/types'
import { isSolidFile } from '@/cam/solid/convert'
import { faceCount, type SolidData } from '@/cam/solid/types'
import { solidBounds } from '@/cam/solid/encode'
import type { UpAxis as Up } from '@/cam/types'
import { compute, occtVendorUrl, solidCompute } from '@/cam/worker/client'
import type { ImportedModel } from '@/cam/worker/tasks'
import { LenInput } from '@/components/LenInput'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Cancelled } from '@/core/cancel'
import { formatLength } from '@/core/units'
import type { UnitSystem } from '@/core/types'
import { MODEL_LAYER, saveModelMesh, UNIT_OPTIONS, UP_OPTIONS } from './modelData'
import { saveSolid } from './solidData'

/** Up axis that lays a box flat (thinnest side up). */
function flatUp(size: [number, number, number]): Up {
  if (size[2] <= size[0] && size[2] <= size[1]) return '+z'
  return size[1] <= size[0] ? '+y' : '+x'
}
const turnedSize = (s: [number, number, number], up: Up): [number, number, number] => (up === '+x' || up === '-x' ? [s[2], s[1], s[0]] : up === '+y' || up === '-y' ? [s[0], s[2], s[1]] : s)

/** Progress bar with a cancel button for a running background task. */
export function TaskProgress({ fraction, note, onCancel }: { fraction: number; note?: string; onCancel: () => void }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <Loader2 className="size-3.5 animate-spin" />
      <div className="h-1.5 flex-1 overflow-hidden rounded bg-white/10">
        <div className="h-full bg-amber-400 transition-[width]" style={{ width: `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%` }} />
      </div>
      <span className="w-40 truncate text-stone-400">{note ?? 'Working'}</span>
      <Button size="xs" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}

export function ModelImportDialog({ part, units, onClose, onAdd }: { part: CamPart; units: UnitSystem; onClose: () => void; onAdd: (p: CamPart, msg: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [fileUnits, setFileUnits] = useState<MeshUnits | 'file'>('file')
  const [up, setUp] = useState<UpAxis | 'auto'>('auto')
  const [closeGaps, setCloseGaps] = useState(true)
  const [busy, setBusy] = useState<{ fraction: number; note?: string; abort: AbortController } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [res, setRes] = useState<ImportedModel | null>(null)
  const [solid, setSolid] = useState<{ data: SolidData; bytes: Uint8Array; bodies: number[] } | null>(null)
  const [fit, setFit] = useState(true)
  const [over, setOver] = useState({ xy: 10, top: 0, bottom: 6 })
  const fmt = (n: number) => formatLength(n, units)

  const read = async (f: File) => {
    setFile(f)
    setRes(null)
    setSolid(null)
    setError(null)
    const abort = new AbortController()
    setBusy({ fraction: 0, note: 'Reading file', abort })
    try {
      const bytes = new Uint8Array(await f.arrayBuffer())
      if (isSolidFile(f.name)) {
        const data = await solidCompute().run('solid.import', { bytes: bytes.slice(), name: f.name, units: fileUnits === 'file' ? undefined : fileUnits, vendor: occtVendorUrl() }, { signal: abort.signal, onProgress: (fraction, note) => setBusy({ fraction, note, abort }) })
        setSolid({ data, bytes, bodies: data.bodies.map((b) => b.index) })
        return
      }
      const r = await compute().run('mesh.import', { bytes, name: f.name, units: fileUnits === 'file' ? undefined : fileUnits, up, gapTol: closeGaps ? 0.01 : 0 }, { signal: abort.signal, onProgress: (fraction, note) => setBusy({ fraction, note, abort }) })
      setRes(r)
    } catch (e) {
      if (!(e instanceof Cancelled)) setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const solidSize = (): [number, number, number] | null => {
    if (!solid || !solid.bodies.length) return null
    const b = solidBounds(solid.data, solid.bodies)
    return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]
  }

  const addSolid = async () => {
    if (!solid || !file) return
    const size = solidSize()
    if (!size) return
    const abort = new AbortController()
    setBusy({ fraction: 0.5, note: 'Storing model', abort })
    try {
      // only the chosen bodies are stored (face ids stay as in the file)
      const chosen: SolidData = { ...solid.data, bodies: solid.data.bodies.filter((b) => solid.bodies.includes(b.index)) }
      const { blob, file: fileHash } = await saveSolid(chosen, solid.bytes)
      const axis: Up = up === 'auto' ? flatUp(size) : up
      const model: ModelRef = {
        id: nanoid(8),
        name: chosen.bodies.length === 1 && chosen.bodies[0].name ? chosen.bodies[0].name : file.name.replace(/\.[^.]+$/, ''),
        kind: 'solid',
        blob,
        file: fileHash,
        source: file.name,
        units: (['mm', 'cm', 'm', 'in', 'ft'].includes(solid.data.units) ? solid.data.units : 'mm') as MeshUnits,
        place: { ...DEFAULT_PLACEMENT, up: axis },
        layer: MODEL_LAYER.id,
        visible: true,
        triangles: chosen.bodies.reduce((n, b) => n + b.indices.length / 3, 0),
        size,
        faces: faceCount(chosen),
        format: `${solid.data.format.toUpperCase()}${solid.data.schema && solid.data.format === 'step' ? ` ${solid.data.schema}` : ''}`,
      }
      let next: CamPart = { ...part, layers: part.layers.some((l) => l.id === MODEL_LAYER.id) ? part.layers : [...part.layers, { ...MODEL_LAYER }], models: [...(part.models ?? []), model] }
      if (fit) next = fitWorkVolumeToModel(next, model.id, turnedSize(size, axis), over)
      onAdd(next, `${model.name}: ${model.faces} faces${fit ? `, part fitted to ${fmt(next.length)} × ${fmt(next.width)} × ${fmt(next.thickness)}` : ''}`)
      onClose()
    } catch (e) {
      toast.error(`Could not store the model: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  const add = async () => {
    if (solid) return addSolid()
    if (!res || !file) return
    const abort = new AbortController()
    setBusy({ fraction: 0.5, note: 'Storing model', abort })
    try {
      const hash = await saveModelMesh(res.mesh)
      const b = meshBounds(res.mesh)
      const model: ModelRef = {
        id: nanoid(8),
        name: file.name.replace(/\.[^.]+$/, ''),
        kind: 'mesh',
        blob: hash,
        source: file.name,
        units: res.report.units,
        place: { ...DEFAULT_PLACEMENT, up: res.up },
        layer: MODEL_LAYER.id,
        visible: true,
        triangles: res.report.kept,
        size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]],
        report: { ...res.report },
      }
      let next: CamPart = { ...part, layers: part.layers.some((l) => l.id === MODEL_LAYER.id) ? part.layers : [...part.layers, { ...MODEL_LAYER }], models: [...(part.models ?? []), model] }
      if (fit) next = fitWorkVolumeToModel(next, model.id, res.size, over)
      onAdd(next, `${model.name}: ${res.report.kept.toLocaleString('en')} facets${fit ? `, part fitted to ${fmt(next.length)} × ${fmt(next.width)} × ${fmt(next.thickness)}` : ''}`)
      onClose()
    } catch (e) {
      toast.error(`Could not store the model: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  const r = res?.report
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="dark border-white/10 bg-[#15171c] text-stone-100 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Box className="size-4" /> Import 3D model
          </DialogTitle>
          <DialogDescription>STL (binary or text), OBJ or 3MF meshes; STEP, IGES or BREP solids (faces, colours and names kept). The model is stored next to the shop file, not inside it. Reading runs in the background; you can cancel it.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-[11px] text-stone-400">Drawn in</Label>
              <Select value={fileUnits} onValueChange={(v) => setFileUnits(v as MeshUnits | 'file')}>
                <SelectTrigger size="sm" className="w-full" aria-label="Units of the file">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="file">As the file says (else mm)</SelectItem>
                  {UNIT_OPTIONS.map((u) => (
                    <SelectItem key={u.value} value={u.value}>
                      {u.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label className="text-[11px] text-stone-400">Up</Label>
              <Select value={up} onValueChange={(v) => setUp(v as UpAxis | 'auto')}>
                <SelectTrigger size="sm" className="w-full" aria-label="Which way is up">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Lay flat (thinnest side up)</SelectItem>
                  {UP_OPTIONS.map((u) => (
                    <SelectItem key={u.value} value={u.value}>
                      {u.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!(file && isSolidFile(file.name)) && (
              <label className="col-span-2 flex items-center gap-2 text-[11px] text-stone-300">
              <Switch checked={closeGaps} onCheckedChange={setCloseGaps} aria-label="Close small gaps" /> Close gaps up to 0.01 mm
            </label>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input ref={input} type="file" accept=".stl,.obj,.3mf,.step,.stp,.iges,.igs,.brep" className="hidden" onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => input.current?.click()}>
              <FileUp /> Choose file
            </Button>
            {file && (
              <span className="truncate text-stone-300">
                {file.name} · {(file.size / 1e6).toFixed(1)} MB
              </span>
            )}
            {file && !busy && (
              <Button size="sm" variant="ghost" onClick={() => void read(file)}>
                Read again
              </Button>
            )}
          </div>
          {busy && <TaskProgress fraction={busy.fraction} note={busy.note} onCancel={() => busy.abort.abort()} />}
          {error && (
            <div className="flex items-start gap-2 rounded border border-red-400/40 bg-red-500/10 px-3 py-2 text-red-200">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {error}
            </div>
          )}
          {solid && <SolidSummary solid={solid} units={units} onBodies={(bodies) => setSolid({ ...solid, bodies })} />}
          {solid && solidSize() && (
            <div className="grid gap-2 rounded border border-white/10 bg-black/20 p-3">
              <label className="flex items-center gap-2 text-stone-200">
                <Switch checked={fit} onCheckedChange={setFit} aria-label="Fit the part to the model" /> Fit the part to the model
              </label>
              {fit && (
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-400">
                  Around <LenInput label="Oversize around" value={over.xy} units={units} onChange={(v) => setOver({ ...over, xy: Number.isFinite(v) ? Math.max(0, v) : 0 })} />
                  Above <LenInput label="Material above the model" value={over.top} units={units} onChange={(v) => setOver({ ...over, top: Number.isFinite(v) ? Math.max(0, v) : 0 })} />
                  Below <LenInput label="Material below the model" value={over.bottom} units={units} onChange={(v) => setOver({ ...over, bottom: Number.isFinite(v) ? Math.max(0, v) : 0 })} />
                </div>
              )}
            </div>
          )}
          {r && res && (
            <div className="grid gap-2 rounded border border-white/10 bg-black/20 p-3">
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline">{r.format.toUpperCase().replace('-', ' ')}</Badge>
                <Badge variant="outline">{r.kept.toLocaleString('en')} facets</Badge>
                <Badge variant="outline">{r.shells} piece{r.shells === 1 ? '' : 's'}</Badge>
                <Badge variant={r.openEdges ? 'secondary' : 'outline'}>{r.openEdges ? `${r.openEdges} open edges (surface)` : 'closed solid'}</Badge>
                {r.units !== 'mm' && <Badge variant="outline">read in {r.units}</Badge>}
              </div>
              <div className="text-stone-300">
                Size {fmt(res.size[0])} × {fmt(res.size[1])} × {fmt(res.size[2])} ({UP_OPTIONS.find((u) => u.value === res.up)?.label})
              </div>
              <div className="text-[11px] text-stone-400">
                Fixed: {r.flipped} facets turned, {r.gapsClosed} gaps closed, {r.degenerate} collapsed facets removed, {r.badFacets} bad facets skipped{r.nonManifoldEdges ? `, ${r.nonManifoldEdges} edges shared by 3+ facets` : ''}.
              </div>
              {r.warnings.map((w) => (
                <div key={w} className="text-[11px] text-amber-200">
                  {w}
                </div>
              ))}
              <label className="mt-1 flex items-center gap-2 text-stone-200">
                <Switch checked={fit} onCheckedChange={setFit} aria-label="Fit the part to the model" /> Fit the part to the model
              </label>
              {fit && (
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-400">
                  Around <LenInput label="Oversize around" value={over.xy} units={units} onChange={(v) => setOver({ ...over, xy: Number.isFinite(v) ? Math.max(0, v) : 0 })} />
                  Above <LenInput label="Material above the model" value={over.top} units={units} onChange={(v) => setOver({ ...over, top: Number.isFinite(v) ? Math.max(0, v) : 0 })} />
                  Below <LenInput label="Material below the model" value={over.bottom} units={units} onChange={(v) => setOver({ ...over, bottom: Number.isFinite(v) ? Math.max(0, v) : 0 })} />
                  <span>
                    → {fmt(res.size[0] + 2 * over.xy)} × {fmt(res.size[1] + 2 * over.xy)} × {fmt(res.size[2] + over.top + over.bottom)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={!!busy} onClick={onClose}>
            Close
          </Button>
          <Button disabled={(!res && !(solid && solid.bodies.length)) || !!busy} onClick={() => void add()}>
            Add to part
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** What a solid file holds: format, unit, bodies (pick which to add), face types, properties. */
function SolidSummary({ solid, units, onBodies }: { solid: { data: SolidData; bodies: number[] }; units: UnitSystem; onBodies: (b: number[]) => void }) {
  const d = solid.data
  const fmt = (n: number) => formatLength(n, units)
  const kinds = new Map<string, number>()
  for (const b of d.bodies) for (const f of b.faces) kinds.set(f.surface.kind, (kinds.get(f.surface.kind) ?? 0) + 1)
  const label: Record<string, string> = { plane: 'flat', cylinder: 'round', cone: 'conical', sphere: 'spherical', other: 'free-form' }
  return (
    <div className="grid gap-2 rounded border border-white/10 bg-black/20 p-3">
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline">{d.format.toUpperCase()}{d.schema ? ` · ${d.schema}` : ''}</Badge>
        <Badge variant="outline">{faceCount(d).toLocaleString('en')} faces</Badge>
        <Badge variant="outline">{d.bodies.length} bod{d.bodies.length === 1 ? 'y' : 'ies'}</Badge>
        <Badge variant="outline">drawn in {d.units}</Badge>
        {[...kinds].map(([k, n]) => (
          <Badge key={k} variant="secondary">
            {n} {label[k] ?? k}
          </Badge>
        ))}
      </div>
      <div className="grid max-h-40 gap-1 overflow-auto">
        {d.bodies.map((b) => {
          const xs = b.positions
          let lo = [Infinity, Infinity, Infinity]
          let hi = [-Infinity, -Infinity, -Infinity]
          for (let i = 0; i < xs.length; i += 3) {
            lo = lo.map((v, k) => Math.min(v, xs[i + k]))
            hi = hi.map((v, k) => Math.max(v, xs[i + k]))
          }
          const props = d.products.find((p) => p.name === b.name)?.properties ?? {}
          return (
            <label key={b.index} className="flex items-center gap-2 text-[11px] text-stone-300">
              <Switch checked={solid.bodies.includes(b.index)} onCheckedChange={(on) => onBodies(on ? [...solid.bodies, b.index].sort((x, y) => x - y) : solid.bodies.filter((x) => x !== b.index))} aria-label={`Use ${b.name || `body ${b.index + 1}`}`} />
              <span className="size-3 rounded-sm border border-white/20" style={{ background: b.color ?? '#d6c3f5' }} />
              <span className="font-medium text-stone-100">{b.name || `Body ${b.index + 1}`}</span>
              <span className="text-stone-400">
                {b.faces.length} faces · {fmt(hi[0] - lo[0])} × {fmt(hi[1] - lo[1])} × {fmt(hi[2] - lo[2])}
                {Object.keys(props).length ? ` · ${Object.entries(props).map(([k, v]) => `${k}: ${v}`).join(', ')}` : ''}
              </span>
            </label>
          )
        })}
      </div>
      {d.warnings.map((w) => (
        <div key={w} className="text-[11px] text-amber-200">
          {w}
        </div>
      ))}
    </div>
  )
}
