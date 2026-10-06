import { Shrink } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { type FoldLine, flattenMesh, foldPattern, outlineContours, wrapOntoCurve } from '@/cam/develop'
import { entityContours, makeEntity } from '@/cam/doc'
import { area, type Contour, endOf, type P, startOf, toPoints, transform, translateM } from '@/cam/geom'
import { placeMesh } from '@/cam/mesh/place'
import type { CamPart, Entity, Layer } from '@/cam/types'
import { LenInput } from '@/components/LenInput'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { UnitSystem } from '@/core/types'
import { addSurfaceModel, loadModelMesh } from './modelData'

const WRAPPED: Layer = { id: 'wrapped', name: 'Wrapped', color: '#fbbf24', visible: true, locked: false }
const FLAT: Layer = { id: 'flat-pattern', name: 'Flat pattern', color: '#38bdf8', visible: true, locked: false }
/** Largest surface flattened here (facets); bigger ones would hold the screen up. */
const MAX_FACETS = 200_000

const withLayer = (part: CamPart, l: Layer): Layer[] => (part.layers.some((x) => x.id === l.id) ? part.layers : [...part.layers, { ...l }])

/**
 * Fold, flatten, wrap (NEW-07): shapes wrapped along a curve, a surface model unrolled into a flat
 * pattern, a flat pattern folded along fold lines into a surface model.
 */
export function DevelopPanel({ part, sel, units, onChange }: { part: CamPart; sel: string[]; units: UnitSystem; onChange: (p: CamPart) => void }) {
  const picked = sel.map((id) => part.entities.find((e) => e.id === id)).filter((e): e is Entity => !!e)
  const models = part.models ?? []
  const [start, setStart] = useState(0)
  const [right, setRight] = useState(false)
  const [modelId, setModelId] = useState('')
  const [angle, setAngle] = useState(90)
  const [busy, setBusy] = useState(false)
  const model = models.find((m) => m.id === modelId) ?? models[0]

  const wrap = () => {
    if (picked.length < 2) return toast.warning('Pick the shapes to wrap, then the curve to wrap them along (last).')
    const curve = entityContours(picked[picked.length - 1])[0]
    if (!curve) return toast.warning('The last pick must be a curve.')
    const shapes = picked.slice(0, -1).flatMap(entityContours)
    const r = wrapOntoCurve(shapes, curve, { start, side: right ? 'right' : 'left' })
    for (const w of r.warnings) toast.warning(w)
    if (!r.contours.length) return
    onChange({ ...part, layers: withLayer(part, WRAPPED), entities: [...part.entities, ...r.contours.map((c) => makeEntity({ t: 'contour', c }, WRAPPED.id))] })
    toast.success(`${r.contours.length} shape(s) wrapped along the curve (${r.length.toFixed(1)} mm long), on the layer Wrapped`)
  }

  const flatten = async () => {
    if (!model) return toast.warning('Make or import a surface model first.')
    if (model.triangles > MAX_FACETS) return toast.warning(`This model has ${model.triangles.toLocaleString('en')} facets: simplify it below ${MAX_FACETS.toLocaleString('en')} to flatten it.`)
    setBusy(true)
    try {
      const mesh = placeMesh(await loadModelMesh(model.blob), model.place)
      const f = flattenMesh(mesh)
      for (const w of f.warnings) toast.warning(w)
      // laid beside the part, its lowest corner 20 mm to the right of the part
      const xs = f.outline.flat().map((p) => p.x)
      const ys = f.outline.flat().map((p) => p.y)
      const dx = part.length + 20 - Math.min(...xs)
      const dy = -Math.min(...ys)
      const cs = outlineContours(f.outline).map((c) => transform(c, translateM(dx, dy)))
      onChange({ ...part, layers: withLayer(part, FLAT), entities: [...part.entities, ...cs.map((c) => makeEntity({ t: 'contour', c }, FLAT.id))] })
      toast.success(`${model.name} flattened: ${f.area2d.toFixed(0)} mm² (surface ${f.area3d.toFixed(0)} mm²), on the layer Flat pattern`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const fold = async () => {
    const closed = picked.flatMap((e) => entityContours(e).filter((c) => c.closed))
    const lines = picked.flatMap((e) => entityContours(e).filter((c) => !c.closed))
    if (!closed.length || !lines.length) return toast.warning('Pick the flat pattern (a closed shape) and its fold lines (straight lines).')
    const outer = closed.reduce((b, c) => (Math.abs(area(c)) > Math.abs(area(b)) ? c : b))
    const holes = closed.filter((c) => c !== outer)
    const ring = (c: Contour): P[] => toPoints(c, 0.01)
    const folds: FoldLine[] = lines.map((c) => ({ a: startOf(c), b: endOf(c), angle }))
    // the piece that stays flat: the one at the middle of the pattern (else its first corner's)
    const pts = ring(outer)
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const mid = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
    setBusy(true)
    try {
      const r = foldPattern([pts, ...holes.map(ring)], folds, mid)
      for (const w of r.warnings) toast.warning(w)
      onChange(await addSurfaceModel(part, r.mesh, `Folded pattern (${folds.length} folds at ${angle}°)`, 'Fold'))
      toast.success(`Folded along ${folds.length} line(s) into ${r.pieces.length} pieces: added as a 3D model`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-2 rounded-md border border-white/10 bg-black/20 p-2.5 text-[11px]" data-testid="develop-panel">
      <div className="flex items-center gap-1.5">
        <Shrink className="size-3.5 text-amber-300" />
        <span className="flex-1 text-[10px] font-semibold tracking-wider text-stone-400 uppercase">Fold, flatten, wrap</span>
        <span className="text-stone-500">{picked.length} picked</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-stone-400">
        Start <LenInput label="Distance along the curve where the shapes start" value={start} units={units} onChange={(v) => Number.isFinite(v) && setStart(Math.max(0, v))} />
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={right} onChange={(e) => setRight(e.target.checked)} /> right side
        </label>
        <Button size="xs" variant="secondary" onClick={wrap} title="Pick the shapes, then the curve last: the shapes' lowest edge follows the curve, lengths along it kept">
          Wrap
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-stone-400">
        <select className="h-6 max-w-40 rounded border border-white/10 bg-black/30 px-1 text-stone-200" value={model?.id ?? ''} onChange={(e) => setModelId(e.target.value)} aria-label="Surface model to flatten">
          {!models.length && <option value="">No 3D models</option>}
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <Button size="xs" variant="secondary" disabled={busy || !model} onClick={() => void flatten()} title="Unroll the surface flat, every facet's edges kept; tells you if the surface is not developable">
          Flatten
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-stone-400">
        Angle
        <Input className="h-6 w-14 px-1 text-[11px]" type="number" value={angle} aria-label="Fold angle, degrees (positive folds up)" onChange={(e) => Number.isFinite(e.target.valueAsNumber) && setAngle(Math.max(-180, Math.min(180, e.target.valueAsNumber)))} />°
        <Button size="xs" variant="secondary" disabled={busy} onClick={() => void fold()} title="Pick the flat pattern and its fold lines: the middle piece stays flat, the rest fold up by the angle">
          Fold
        </Button>
      </div>
    </div>
  )
}
