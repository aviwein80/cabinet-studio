import { Layers3, Spline } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { entityContours, makeEntity } from '@/cam/doc'
import { area, type P, toPoints } from '@/cam/geom'
import { parsePoints3d } from '@/cam/mesh/poly3d'
import type { V3 } from '@/cam/mesh/surface'
import { contourFromEdges } from '@/cam/solid/wires'
import type { CamPart, Entity, Layer } from '@/cam/types'
import { compute } from '@/cam/worker/client'
import type { SurfaceJob } from '@/cam/worker/tasks'
import { LenInput } from '@/components/LenInput'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Cancelled } from '@/core/cancel'
import type { UnitSystem } from '@/core/types'
import { TaskProgress } from './ModelImportDialog'
import { addSurfaceModel } from './modelData'
import { enterApplies } from '@/components/enterApplies'

const EDGES: Layer = { id: 'model-edges', name: 'Model edges', color: '#f472b6', visible: true, locked: false }
const TOL = 0.01

/** Points of a shape (chord 0.01 mm); closed shapes end where they start. */
function shapePoints(e: Entity): { pts: P[]; closed: boolean }[] {
  return entityContours(e).map((c) => {
    const pts = toPoints(c, TOL)
    if (c.closed && pts.length) pts.push(pts[0])
    return { pts, closed: c.closed }
  })
}
/** A shape as 3D curves: 3D polylines keep their heights; flat shapes sit at z. */
function curves3d(e: Entity, z: number): V3[][] {
  if (e.g.t === 'poly3d') return [e.g.pts.map((p) => [p[0], p[1], p[2]] as V3)]
  return shapePoints(e).map((s) => s.pts.map((p) => [p.x, p.y, z] as V3))
}

/**
 * Surfaces from the drawing (NEW-19) and wires (CAD-16): revolve, extrude, flat, ruled, loft,
 * sweep; join picked edges into a contour; type in a 3D polyline. New surfaces are 3D models the
 * 3D strategies can machine.
 */
export function SurfacesPanel({ part, sel, units, onChange }: { part: CamPart; sel: string[]; units: UnitSystem; onChange: (p: CamPart) => void }) {
  const picked = sel.map((id) => part.entities.find((e) => e.id === id)).filter((e): e is Entity => !!e)
  const [z, setZ] = useState({ a: 0, b: -10 })
  const [centre, setCentre] = useState({ x: part.length / 2, y: part.width / 2 })
  const [angle, setAngle] = useState(360)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState<{ fraction: number; note?: string; abort: AbortController } | null>(null)

  const make = async (name: string, job: SurfaceJob) => {
    const abort = new AbortController()
    setBusy({ fraction: 0.2, note: `Making the ${name.toLowerCase()}`, abort })
    try {
      const mesh = await compute().run('surface.make', job, { signal: abort.signal })
      const next = await addSurfaceModel(part, mesh, `${name} surface`, name)
      onChange(next)
      toast.success(`${name} surface added as a 3D model (${(mesh.indices.length / 3).toLocaleString('en')} facets)`)
    } catch (e) {
      if (!(e instanceof Cancelled)) toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }
  const need = (n: number, what: string) => {
    if (picked.length >= n) return true
    toast.warning(`Pick ${what} in the drawing first.`)
    return false
  }

  const revolveIt = () => {
    if (!need(1, 'the profile to revolve (its left end is the axis, its top is face 1)')) return
    const pts = shapePoints(picked[0])[0]?.pts ?? []
    const x0 = Math.min(...pts.map((p) => p.x))
    const y1 = Math.max(...pts.map((p) => p.y))
    void make('Revolved', { k: 'revolve', profile: pts.map((p) => [p.x - x0, p.y - y1] as [number, number]), angle, centre: [centre.x, centre.y], tol: TOL })
  }
  const extrudeIt = () => need(1, 'one or more shapes to extrude') && void make('Extruded', { k: 'extrude', curves: picked.flatMap((e) => curves3d(e, z.a)), v: [0, 0, z.b - z.a] })
  const flatIt = () => {
    if (!need(1, 'a closed shape (holes inside it are kept out)')) return
    const rings = picked.flatMap((e) => shapePoints(e).filter((s) => s.closed))
    if (!rings.length) return toast.warning('Pick a closed shape.')
    const ar = (pts: P[]) => Math.abs(area({ closed: true, segs: pts.slice(0, -1).map((p, i) => ({ k: 'L' as const, a: p, b: pts[i + 1] })) }))
    const outer = rings.reduce((b, r) => (ar(r.pts) > ar(b.pts) ? r : b))
    void make('Flat', { k: 'flat', outer: outer.pts.map((p) => [p.x, p.y]), holes: rings.filter((r) => r !== outer).map((r) => r.pts.map((p) => [p.x, p.y] as [number, number])), z: z.a })
  }
  const ruledIt = () => need(2, 'two shapes (the first at Z1, the second at Z2; 3D polylines keep their heights)') && void make('Ruled', { k: 'ruled', a: curves3d(picked[0], z.a)[0], b: curves3d(picked[1], z.b)[0] })
  const loftIt = () => {
    if (!need(2, 'two or more sections, in order (flat ones are spread from Z1 to Z2)')) return
    const n = picked.length
    void make('Loft', { k: 'loft', sections: picked.map((e, i) => curves3d(e, z.a + ((z.b - z.a) * i) / (n - 1))[0]) })
  }
  const sweepIt = () => {
    if (!need(2, 'the section first (drawn round its own centre), then the path')) return
    const s = shapePoints(picked[0])[0]
    if (!s) return
    const xs = s.pts.map((p) => p.x)
    const ys = s.pts.map((p) => p.y)
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2
    const pts = s.closed ? s.pts.slice(0, -1) : s.pts
    void make('Swept', { k: 'sweep', section: pts.map((p) => [p.x - cx, p.y - cy] as [number, number]), closed: s.closed, path: curves3d(picked[1], z.a)[0] })
  }
  const withEdges = (p: CamPart): Layer[] => (p.layers.some((l) => l.id === EDGES.id) ? p.layers : [...p.layers, { ...EDGES }])
  const join = () => {
    if (!need(1, 'edges (3D polylines) or paths to join')) return
    const cs = contourFromEdges(picked)
    if (!cs.length) return toast.warning('Nothing to join.')
    onChange({ ...part, layers: withEdges(part), entities: [...part.entities, ...cs.map((c) => makeEntity({ t: 'contour', c }, EDGES.id))] })
    toast.success(`${cs.length} contour(s) from ${picked.length} edge(s): ${cs.filter((c) => c.closed).length} closed`)
  }
  const addTyped = () => {
    try {
      const pts = parsePoints3d(typed)
      if (pts.length < 2) throw new Error('A 3D polyline needs at least two points.')
      onChange({ ...part, layers: withEdges(part), entities: [...part.entities, makeEntity({ t: 'poly3d', pts }, EDGES.id)] })
      setTyped('')
      toast.success(`3D polyline with ${pts.length} points added (edit its points under Properties)`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="grid gap-2 rounded-md border border-white/10 bg-black/20 p-2.5 text-[11px]">
      <div className="flex items-center gap-1.5">
        <Layers3 className="size-3.5 text-emerald-300" />
        <span className="flex-1 text-[10px] font-semibold tracking-wider text-stone-400 uppercase">Surfaces from the drawing</span>
        <span className="text-stone-500">{picked.length} picked</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-stone-400">
        Z1 <LenInput label="First height" value={z.a} units={units} onChange={(v) => Number.isFinite(v) && setZ({ ...z, a: v })} />
        Z2 <LenInput label="Second height" value={z.b} units={units} onChange={(v) => Number.isFinite(v) && setZ({ ...z, b: v })} />
      </div>
      <div className="flex flex-wrap gap-1">
        <Button size="xs" variant="secondary" onClick={extrudeIt} title="Picked shapes from Z1 to Z2">
          Extrude
        </Button>
        <Button size="xs" variant="secondary" onClick={flatIt} title="A closed shape filled flat at Z1">
          Flat
        </Button>
        <Button size="xs" variant="secondary" onClick={ruledIt} title="Straight lines between two shapes">
          Ruled
        </Button>
        <Button size="xs" variant="secondary" onClick={loftIt} title="Through the picked sections in order">
          Loft
        </Button>
        <Button size="xs" variant="secondary" onClick={sweepIt} title="First pick: the section; second: the path">
          Sweep
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-stone-400">
        <Button size="xs" variant="secondary" onClick={revolveIt} title="The picked profile: its left end is the axis, its top is face 1">
          Revolve
        </Button>
        about X <LenInput label="Axis X" value={centre.x} units={units} onChange={(v) => Number.isFinite(v) && setCentre({ ...centre, x: v })} />
        Y <LenInput label="Axis Y" value={centre.y} units={units} onChange={(v) => Number.isFinite(v) && setCentre({ ...centre, y: v })} />
        <Input aria-label="Revolve angle" className="h-6 w-12 px-1 text-[11px]" defaultValue={angle} onKeyDown={enterApplies} onBlur={(e) => Number(e.target.value) > 0 && setAngle(Math.min(360, Number(e.target.value)))} />°
      </div>
      {busy && <TaskProgress fraction={busy.fraction} note={busy.note} onCancel={() => busy.abort.abort()} />}
      <div className="flex items-center gap-1.5 border-t border-white/10 pt-2">
        <Spline className="size-3.5 text-pink-300" />
        <span className="flex-1 text-[10px] font-semibold tracking-wider text-stone-400 uppercase">3D wires</span>
        <Button size="xs" variant="secondary" onClick={join} title="Picked edges or paths joined into contours on face 1">
          Join to contour
        </Button>
      </div>
      <div className="flex items-center gap-1.5">
        <textarea aria-label="Points of a new 3D polyline" className="h-12 flex-1 resize-none rounded border border-white/10 bg-transparent px-1.5 py-1 font-mono text-[10.5px] text-stone-200" placeholder={'x, y, z per line\n0, 0, 0\n100, 0, -5'} value={typed} onChange={(e) => setTyped(e.target.value)} />
        <Button size="xs" variant="secondary" disabled={!typed.trim()} onClick={addTyped}>
          New 3D polyline
        </Button>
      </div>
    </div>
  )
}
