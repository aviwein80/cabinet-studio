/**
 * Relief import (ART-01): a relief made in relief software (STL, OBJ, 3MF) or a height-map picture
 * (PNG, TIFF), made to the size and depth given and placed on the part, with roughing and
 * finishing added if asked. We import reliefs; we do not design them.
 */
import { FileUp, Mountain, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { formatOf } from '@/cam/mesh/read'
import type { MeshUnits } from '@/cam/mesh/types'
import { heightImageFormat, type HeightImageSummary } from '@/cam/relief/image'
import { addRelief, reliefCorner, reliefPlacementNotes, type ReliefPlacement } from '@/cam/relief/part'
import { defaultSpacing, gridCounts, MAX_POINTS } from '@/cam/relief/relief'
import type { CamPart } from '@/cam/types'
import { compute } from '@/cam/worker/client'
import type { ImportedModel, TaskOut } from '@/cam/worker/tasks'
import { LenInput } from '@/components/LenInput'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Cancelled } from '@/core/cancel'
import type { UnitSystem } from '@/core/types'
import { formatLength } from '@/core/units'
import { saveModelMesh, UNIT_OPTIONS } from './modelData'
import { TaskProgress } from './ModelImportDialog'

type Source = { k: 'image'; summary: HeightImageSummary; bytes: Uint8Array } | { k: 'mesh'; imported: ImportedModel; check: TaskOut<'relief.checkMesh'> }

const r1 = (n: number) => Math.round(n * 10) / 10

export function ReliefImportDialog({ part, units, onClose, onAdd }: { part: CamPart; units: UnitSystem; onClose: () => void; onAdd: (p: CamPart, msg: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [fileUnits, setFileUnits] = useState<MeshUnits | 'file'>('file')
  const [src, setSrc] = useState<Source | null>(null)
  const [busy, setBusy] = useState<{ fraction: number; note?: string; abort: AbortController } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [size, setSize] = useState({ length: NaN, width: NaN, depth: NaN })
  const [keep, setKeep] = useState(true)
  const [img, setImg] = useState({ whiteHigh: true, stretch: false, spacing: NaN, smooth: 0, transparent: 'top' as 'top' | 'bottom' })
  const [removeBase, setRemoveBase] = useState(true)
  const [place, setPlace] = useState<ReliefPlacement>({ centre: true, x: 0, y: 0, top: 0 })
  const [withOps, setWithOps] = useState(true)
  const fmt = (n: number) => formatLength(n, units)

  // proportions of the source (X : Y)
  const ratio = src?.k === 'image' ? src.summary.height / src.summary.width : src?.k === 'mesh' ? src.check.size[1] / src.check.size[0] : 1
  const meshDepth = src?.k === 'mesh' ? (removeBase && src.check.base ? src.check.stripped.size[2] : src.check.size[2]) : NaN

  const read = async (f: File) => {
    setFile(f)
    setSrc(null)
    setError(null)
    const abort = new AbortController()
    setBusy({ fraction: 0, note: 'Reading file', abort })
    const opts = { signal: abort.signal, onProgress: (fraction: number, note?: string) => setBusy({ fraction, note, abort }) }
    try {
      const bytes = new Uint8Array(await f.arrayBuffer())
      if (heightImageFormat(f.name)) {
        const summary = await compute().run('relief.imageInfo', { bytes: bytes.slice(), name: f.name }, opts)
        // fit within 80 % of the part, keeping the picture's proportions
        const k = Math.min((0.8 * part.length) / summary.width, (0.8 * part.width) / summary.height)
        const length = Math.max(1, Math.round(summary.width * k))
        const width = r1(length * (summary.height / summary.width))
        setSize({ length, width, depth: NaN })
        setImg((o) => ({ ...o, spacing: defaultSpacing(summary, length, width), smooth: summary.levels && summary.levels <= 256 ? 1 : 0 }))
        setSrc({ k: 'image', summary, bytes })
        return
      }
      if (!formatOf(f.name)) throw new Error(`${f.name}: choose an STL, OBJ or 3MF relief, or a PNG or TIFF height map.`)
      const imported = await compute().run('mesh.import', { bytes, name: f.name, units: fileUnits === 'file' ? undefined : fileUnits, up: '+z', gapTol: 0.01 }, opts)
      const check = await compute().run('relief.checkMesh', { mesh: imported.mesh }, opts)
      setRemoveBase(check.base)
      const depth = check.base ? check.stripped.size[2] : check.size[2]
      setSize({ length: r1(check.size[0]), width: r1(check.size[1]), depth: Math.round(depth * 1000) / 1000 })
      setSrc({ k: 'mesh', imported, check })
    } catch (e) {
      if (!(e instanceof Cancelled)) setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const setLength = (v: number) => setSize((s) => ({ ...s, length: v, ...(keep && v > 0 ? { width: r1(v * ratio) } : {}) }))
  const setWidth = (v: number) => setSize((s) => ({ ...s, width: v, ...(keep && v > 0 ? { length: r1(v / ratio) } : {}) }))
  const sizeOk = size.length > 0 && size.width > 0 && size.depth > 0
  const points = src?.k === 'image' && sizeOk && img.spacing > 0 ? gridCounts(size.length, size.width, img.spacing) : null
  const tooMany = !!points && points.nx * points.ny > MAX_POINTS
  const at = sizeOk ? reliefCorner(part, [size.length, size.width, size.depth], place) : null
  const notes = at ? reliefPlacementNotes(part, [size.length, size.width, size.depth], at) : []

  const add = async () => {
    if (!src || !file || !sizeOk || tooMany) return
    const abort = new AbortController()
    setBusy({ fraction: 0, note: 'Making the relief', abort })
    const opts = { signal: abort.signal, onProgress: (fraction: number, note?: string) => setBusy({ fraction: fraction * 0.9, note, abort }) }
    try {
      const made =
        src.k === 'image'
          ? await compute().run('relief.fromImage', { bytes: src.bytes.slice(), name: file.name, opt: { length: size.length, width: size.width, depth: size.depth, whiteHigh: img.whiteHigh, stretch: img.stretch, spacing: img.spacing, smooth: img.smooth, transparent: img.transparent } }, opts)
          : { ...(await compute().run('relief.fromMesh', { mesh: src.imported.mesh, removeBase: removeBase && src.check.base, size }, opts)), warnings: [] as string[] }
      setBusy({ fraction: 0.95, note: 'Storing the relief', abort })
      const blob = await saveModelMesh(made.mesh)
      const r = addRelief(part, { blob, name: file.name.replace(/\.[^.]+$/, ''), source: file.name, units: src.k === 'mesh' ? src.imported.report.units : 'mm', triangles: made.mesh.indices.length / 3, info: made.info, place, withOps })
      for (const w of made.warnings) toast.warning(w)
      onAdd(r.part, `Relief ${fmt(made.info.size[0])} × ${fmt(made.info.size[1])}, ${fmt(made.info.size[2])} deep${r.ops.length ? '; roughing and finishing added' : ''}`)
      onClose()
    } catch (e) {
      if (!(e instanceof Cancelled)) toast.error(`Could not make the relief: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="dark max-h-[92vh] overflow-y-auto border-white/10 bg-[#15171c] text-stone-100 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mountain className="size-4" /> Import relief
          </DialogTitle>
          <DialogDescription>
            A relief made in relief software (STL, OBJ or 3MF) or a height-map picture (PNG or TIFF; 16-bit greyscale keeps the most detail). It is made to the size and depth you give and placed on the part; the panel round it is never cut. This brings reliefs in; it does not design them.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <input ref={input} type="file" accept=".stl,.obj,.3mf,.png,.tif,.tiff" className="hidden" onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => input.current?.click()}>
              <FileUp /> Choose file
            </Button>
            {file && (
              <span className="truncate text-stone-300">
                {file.name} · {(file.size / 1e6).toFixed(1)} MB
              </span>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <Label className="text-[11px] text-stone-400">STL drawn in</Label>
              <Select value={fileUnits} onValueChange={(v) => setFileUnits(v as MeshUnits | 'file')}>
                <SelectTrigger size="sm" className="w-40" aria-label="Units of the relief file">
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
          </div>
          {busy && <TaskProgress fraction={busy.fraction} note={busy.note} onCancel={() => busy.abort.abort()} />}
          {error && (
            <div className="flex items-start gap-2 rounded border border-red-400/40 bg-red-500/10 px-3 py-2 text-red-200">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {error}
            </div>
          )}

          {src?.k === 'image' && <ImageSummary s={src.summary} />}
          {src?.k === 'mesh' && (
            <div className="grid gap-2 rounded border border-white/10 bg-black/20 p-3">
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline">{src.imported.report.format.toUpperCase().replace('-', ' ')}</Badge>
                <Badge variant="outline">{src.imported.report.kept.toLocaleString('en')} facets</Badge>
                {src.imported.report.units !== 'mm' && <Badge variant="outline">read in {src.imported.report.units}</Badge>}
                <Badge variant={src.check.base ? 'secondary' : 'outline'}>{src.check.base ? 'block with a base' : 'carved surface'}</Badge>
              </div>
              <div className="text-stone-300">
                As read: {fmt(src.check.size[0])} × {fmt(src.check.size[1])} × {fmt(src.check.size[2])}; the carving alone is {fmt(src.check.topDepth)} deep.
              </div>
              {src.check.base && (
                <label className="flex items-center gap-2 text-stone-200">
                  <Switch checked={removeBase} onCheckedChange={(v) => {
                    setRemoveBase(v)
                    setSize((s) => ({ ...s, depth: Math.round((v ? src.check.stripped.size[2] : src.check.size[2]) * 1000) / 1000 }))
                  }} aria-label="Take the base off" /> Take the base off (its flat bottom and sides, {src.check.stripped.removed.toLocaleString('en')} facets): the depth is then the carving alone
                </label>
              )}
            </div>
          )}

          {src && (
            <div className="grid gap-2 rounded border border-white/10 bg-black/20 p-3">
              <div className="font-medium text-stone-200">Size</div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-400">
                Length (X) <LenInput label="Relief length" value={size.length} units={units} onChange={(v) => setLength(Number.isFinite(v) ? v : NaN)} />
                Width (Y) <LenInput label="Relief width" value={size.width} units={units} onChange={(v) => setWidth(Number.isFinite(v) ? v : NaN)} />
                Depth <LenInput label="Relief depth" value={size.depth} units={units} onChange={(v) => setSize((s) => ({ ...s, depth: Number.isFinite(v) ? v : NaN }))} />
                <label className="flex items-center gap-1.5">
                  <Switch checked={keep} onCheckedChange={setKeep} aria-label="Keep proportions" /> Keep proportions
                </label>
              </div>
              {src.k === 'image' && !(size.depth > 0) && <div className="text-[11px] text-amber-200">Enter the depth: from the highest point (white) to the lowest (black). A picture has no depth of its own.</div>}
              {src.k === 'mesh' && Number.isFinite(meshDepth) && size.depth > 0 && Math.abs(size.depth - meshDepth) > 1e-3 && <div className="text-[11px] text-stone-400">Depth changed from the file&apos;s {fmt(meshDepth)}: the relief is stretched in Z by {(size.depth / meshDepth).toFixed(3)}.</div>}
              {src.k === 'image' && (
                <div className="grid gap-1.5 text-[11px] text-stone-300">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-1.5">
                      <Switch checked={img.whiteHigh} onCheckedChange={(v) => setImg({ ...img, whiteHigh: v })} aria-label="White is high" /> White is high
                    </label>
                    <label className="flex items-center gap-1.5">
                      <Switch checked={img.stretch} onCheckedChange={(v) => setImg({ ...img, stretch: v })} aria-label="Stretch to the full depth" /> Stretch the picture&apos;s lightest to darkest over the full depth
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-stone-400">
                    Points every <LenInput label="Point spacing" value={img.spacing} units={units} onChange={(v) => setImg({ ...img, spacing: Number.isFinite(v) && v > 0 ? v : img.spacing })} />
                    {points && (
                      <span className={tooMany ? 'text-red-300' : ''}>
                        {points.nx.toLocaleString('en')} × {points.ny.toLocaleString('en')} points, {(2 * (points.nx - 1) * (points.ny - 1)).toLocaleString('en')} facets{tooMany ? ` (over the ${MAX_POINTS.toLocaleString('en')}-point limit: use a larger spacing)` : ''}
                      </span>
                    )}
                    <span className="ml-2">Smoothing</span>
                    <Select value={String(img.smooth)} onValueChange={(v) => setImg({ ...img, smooth: Number(v) })}>
                      <SelectTrigger size="sm" className="w-24" aria-label="Smoothing passes">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[0, 1, 2, 3].map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n === 0 ? 'None' : `${n} pass${n > 1 ? 'es' : ''}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {src.summary.transparent && (
                      <>
                        <span className="ml-2">Transparent pixels</span>
                        <Select value={img.transparent} onValueChange={(v) => setImg({ ...img, transparent: v as 'top' | 'bottom' })}>
                          <SelectTrigger size="sm" className="w-44" aria-label="Transparent pixels">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="top">Top (not cut)</SelectItem>
                            <SelectItem value="bottom">Bottom (full depth)</SelectItem>
                          </SelectContent>
                        </Select>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {src && (
            <div className="grid gap-2 rounded border border-white/10 bg-black/20 p-3">
              <div className="font-medium text-stone-200">On the part ({fmt(part.length)} × {fmt(part.width)} × {fmt(part.thickness)})</div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-400">
                <label className="flex items-center gap-1.5 text-stone-300">
                  <Switch checked={place.centre} onCheckedChange={(v) => setPlace({ ...place, centre: v })} aria-label="Centre on the part" /> Centre on the part
                </label>
                {!place.centre && (
                  <>
                    Corner X <LenInput label="Relief corner X" value={place.x} units={units} onChange={(v) => Number.isFinite(v) && setPlace({ ...place, x: v })} />
                    Y <LenInput label="Relief corner Y" value={place.y} units={units} onChange={(v) => Number.isFinite(v) && setPlace({ ...place, y: v })} />
                  </>
                )}
                Top at <LenInput label="Relief top Z" value={place.top} units={units} onChange={(v) => Number.isFinite(v) && setPlace({ ...place, top: v })} />
                <span>(0 = flush with face 1; below it is negative)</span>
              </div>
              {at && <div className="text-[11px] text-stone-400">Corner at {fmt(at[0])}, {fmt(at[1])}; lowest point {fmt(-(at[2] - size.depth))} below face 1.</div>}
              {notes.map((n) => (
                <div key={n} className="text-[11px] text-amber-200">
                  {n}
                </div>
              ))}
              <label className="flex items-center gap-2 text-stone-200">
                <Switch checked={withOps} onCheckedChange={setWithOps} aria-label="Add roughing and finishing" /> Add Z-level roughing and parallel finishing (placeholder cutting values; check the Configure badges)
              </label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={!!busy} onClick={onClose}>
            Close
          </Button>
          <Button disabled={!src || !sizeOk || tooMany || !!busy} onClick={() => void add()}>
            Add to part
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ImageSummary({ s }: { s: HeightImageSummary }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = canvas.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    c.width = s.preview.width
    c.height = s.preview.height
    ctx.putImageData(new ImageData(new Uint8ClampedArray(s.preview.data), s.preview.width, s.preview.height), 0, 0)
  }, [s])
  return (
    <div className="flex gap-3 rounded border border-white/10 bg-black/20 p-3">
      <canvas ref={canvas} aria-label="Height map preview" className="max-h-40 max-w-56 rounded border border-white/10 bg-[repeating-conic-gradient(#333_0_25%,#222_0_50%)] [background-size:12px_12px] [image-rendering:pixelated]" />
      <div className="grid content-start gap-1.5">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{s.format.toUpperCase()}</Badge>
          <Badge variant="outline">
            {s.width.toLocaleString('en')} × {s.height.toLocaleString('en')} pixels
          </Badge>
          <Badge variant={s.levels && s.levels <= 256 ? 'secondary' : 'outline'}>{s.levels ? `${s.bits}-bit, ${s.levels.toLocaleString('en')} heights` : `${s.bits}-bit decimal heights`}</Badge>
          {s.transparent && <Badge variant="outline">transparent pixels</Badge>}
        </div>
        <div className="text-stone-400">
          Lightest {(s.max * 100).toFixed(1)} %, darkest {(s.min * 100).toFixed(1)} % of white.
        </div>
        {s.warnings.map((w) => (
          <div key={w} className="text-[11px] text-amber-200">
            {w}
          </div>
        ))}
      </div>
    </div>
  )
}
