import { Box, FileUp, Loader2, TriangleAlert } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { DEFAULT_PLACEMENT, fitWorkVolumeToModel } from '@/cam/mesh/place'
import { type MeshUnits, meshBounds } from '@/cam/mesh/types'
import type { CamPart, ModelRef, UpAxis } from '@/cam/types'
import { compute } from '@/cam/worker/client'
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
  const [fit, setFit] = useState(true)
  const [over, setOver] = useState({ xy: 10, top: 0, bottom: 6 })
  const fmt = (n: number) => formatLength(n, units)

  const read = async (f: File) => {
    setFile(f)
    setRes(null)
    setError(null)
    const abort = new AbortController()
    setBusy({ fraction: 0, note: 'Reading file', abort })
    try {
      const bytes = new Uint8Array(await f.arrayBuffer())
      const r = await compute().run('mesh.import', { bytes, name: f.name, units: fileUnits === 'file' ? undefined : fileUnits, up, gapTol: closeGaps ? 0.01 : 0 }, { signal: abort.signal, onProgress: (fraction, note) => setBusy({ fraction, note, abort }) })
      setRes(r)
    } catch (e) {
      if (!(e instanceof Cancelled)) setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const add = async () => {
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
          <DialogDescription>STL (binary or text), OBJ or 3MF. The model is stored next to the shop file, not inside it. Reading runs in the background; you can cancel it.</DialogDescription>
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
            <label className="col-span-2 flex items-center gap-2 text-[11px] text-stone-300">
              <Switch checked={closeGaps} onCheckedChange={setCloseGaps} aria-label="Close small gaps" /> Close gaps up to 0.01 mm
            </label>
          </div>
          <div className="flex items-center gap-2">
            <input ref={input} type="file" accept=".stl,.obj,.3mf" className="hidden" onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
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
          <Button disabled={!res || !!busy} onClick={() => void add()}>
            Add to part
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
