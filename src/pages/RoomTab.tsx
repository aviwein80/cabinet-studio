import { type PointerEvent, useEffect, useMemo, useState } from 'react'
import { RotateCw } from 'lucide-react'
import { useStore } from '@/app/store'
import { Viewer3D } from '@/components/Viewer3D'
import { NumField, SelectField } from '@/components/fields'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { buildCabinet } from '@/core/construction/carcass'
import { WALLS, elevationOf, placementFromElevation, type WallId } from '@/core/elevation'
import { arrangeCabinets, footprint, nextRotation, placementOf, snapPlacement, toRoom } from '@/core/room'
import { formatLength } from '@/core/units'
import type { CabinetInstance, CabinetPlacement, CarcassParams, Job, Part, Room } from '@/core/types'
import { cn } from '@/lib/utils'
import { ElevationView, PlanView } from './RoomDrawings'

function placedPart(part: Part, pl: CabinetPlacement, width: number, depth: number, id: string): Part {
  const zero: CabinetPlacement = { ...pl, x: 0, y: 0, z: 0 }
  const dir = (v: [number, number, number]): [number, number, number] => {
    const a = toRoom(0, 0, 0, zero, width, depth)
    const b = toRoom(v[0], v[1], v[2], zero, width, depth)
    return [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  }
  const o = part.frame.origin
  return {
    ...part,
    key: `${id}:${part.key}`,
    frame: { origin: toRoom(o[0], o[1], o[2], pl, width, depth), u: dir(part.frame.u), v: dir(part.frame.v), n: dir(part.frame.n) },
  }
}

type Drag = { id: string; dx: number; dy: number; mode: 'plan' | 'elevation' }

export function RoomTab({ job, setJob }: { job: Job; setJob: (fn: (j: Job) => void) => void }) {
  const data = useStore((s) => s.data)!
  const go = useStore((s) => s.go)
  const units = data.settings.units
  const room: Room = job.room ?? { width: 3657.6, depth: 3048, height: 2438.4 }
  const [selected, setSelected] = useState<string | null>(job.cabinets[0]?.id ?? null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [view, setView] = useState<'3d' | 'plan' | 'elevation'>('3d')
  const [wall, setWall] = useState<WallId>('back')
  const [snapOn, setSnapOn] = useState(true)
  const [alt, setAlt] = useState(false)

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        e.preventDefault()
        setAlt(true)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAlt(false)
    }
    const clear = () => setAlt(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
    }
  }, [])

  const arranged = useMemo(() => arrangeCabinets(job.cabinets, room), [job.cabinets, room])
  const place = (c: CabinetInstance) => placementOf(c, arranged)

  const setRoom = (fn: (r: Room) => void) =>
    setJob((j) => {
      j.room = { ...room }
      fn(j.room)
    })
  const setPlacement = (id: string, pl: CabinetPlacement) =>
    setJob((j) => {
      const c = j.cabinets.find((x) => x.id === id)
      if (c) c.placement = pl
    })
  const setParams = (id: string, fn: (p: CarcassParams) => void) =>
    setJob((j) => {
      const c = j.cabinets.find((x) => x.id === id)
      if (c) fn(c.params)
    })

  const parts = useMemo(() => {
    const all: Part[] = []
    for (const c of job.cabinets) {
      try {
        const built = buildCabinet(c, data.library)
        const pl = place(c)
        for (const p of built.parts) all.push(placedPart(p, pl, c.params.width, c.params.depth, c.id))
      } catch {
        /* a cabinet that cannot build is skipped in the room */
      }
    }
    return all
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, data.library, arranged])

  const sel = job.cabinets.find((c) => c.id === selected) ?? null
  const elev = elevationOf(job.cabinets, room, wall, place)

  const targets = (id: string) =>
    job.cabinets.filter((o) => o.id !== id).map((o) => ({ ...footprint(o.params.width, o.params.depth, place(o)), z: place(o).z, h: o.params.height }))

  const snapTo = (c: CabinetInstance, pl: CabinetPlacement, enabled: boolean) =>
    snapPlacement(pl, c.params.width, c.params.depth, targets(c.id), room, 12.7, { enabled, height: c.params.height })

  const svgPoint = (e: PointerEvent<SVGElement>) => {
    const svg = e.currentTarget.ownerSVGElement ?? (e.currentTarget as SVGSVGElement)
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const m = svg.getScreenCTM()
    if (!m) return null
    return { svg, p: pt.matrixTransform(m.inverse()) }
  }

  const onPlan = (e: PointerEvent<SVGElement>, phase: 'down' | 'move' | 'up', id?: string) => {
    const hit = svgPoint(e)
    if (!hit) return
    const rx = hit.p.x
    const ry = room.depth - hit.p.y
    if (phase === 'down' && id) {
      const c = job.cabinets.find((x) => x.id === id)
      if (!c) return
      const pl = place(c)
      setSelected(id)
      setDrag({ id, dx: rx - pl.x, dy: ry - pl.y, mode: 'plan' })
      hit.svg.setPointerCapture(e.pointerId)
    } else if (phase === 'move' && drag?.mode === 'plan') {
      const c = job.cabinets.find((x) => x.id === drag.id)
      if (!c) return
      setPlacement(c.id, snapTo(c, { ...place(c), x: rx - drag.dx, y: ry - drag.dy }, snapOn && !e.altKey && !alt))
    } else if (phase === 'up') setDrag(null)
  }

  const onElev = (e: PointerEvent<SVGElement>, phase: 'down' | 'move' | 'up', id?: string) => {
    const hit = svgPoint(e)
    if (!hit) return
    const along = hit.p.x
    const z = room.height - hit.p.y
    if (phase === 'down' && id) {
      const c = job.cabinets.find((x) => x.id === id)
      if (!c) return
      const item = elev.find((x) => x.id === id)
      if (!item) return
      setSelected(id)
      setDrag({ id, dx: along - item.x, dy: z - place(c).z, mode: 'elevation' })
      hit.svg.setPointerCapture(e.pointerId)
    } else if (phase === 'move' && drag?.mode === 'elevation') {
      const c = job.cabinets.find((x) => x.id === drag.id)
      if (!c) return
      const raw = placementFromElevation(place(c), c.params.width, c.params.depth, wall, along - drag.dx, z - drag.dy, room)
      setPlacement(c.id, snapTo(c, raw, snapOn && !e.altKey && !alt))
    } else if (phase === 'up') setDrag(null)
  }

  const rotate = (c: CabinetInstance) => {
    const pl = place(c)
    const fp = footprint(c.params.width, c.params.depth, pl)
    const turned = nextRotation(pl.rotation)
    const nowTurned = turned === 90 || turned === 270
    const w = nowTurned ? c.params.depth : c.params.width
    const d = nowTurned ? c.params.width : c.params.depth
    setPlacement(c.id, { ...pl, rotation: turned, x: fp.x + fp.w / 2 - w / 2, y: fp.y + fp.d / 2 - d / 2 })
  }

  return (
    <div className="flex h-full min-h-0 flex-col xl:flex-row">
      <div className="flex min-h-[420px] min-w-0 flex-1 flex-col border-b xl:border-r xl:border-b-0">
        <div className="flex flex-wrap items-center gap-3 border-b bg-background px-4 py-3">
          <div className="flex rounded-md border bg-stone-100 p-0.5">
            {(['3d', 'plan', 'elevation'] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn('rounded px-2.5 py-1 text-xs', view === v ? 'bg-stone-800 font-medium text-white' : 'text-stone-600')}>
                {v === '3d' ? '3D' : v === 'plan' ? 'Plan' : 'Elevation'}
              </button>
            ))}
          </div>
          {view === 'elevation' && (
            <div className="flex rounded-md border bg-stone-100 p-0.5">
              {WALLS.map((w) => (
                <button key={w.id} type="button" aria-pressed={wall === w.id} onClick={() => setWall(w.id)} className={cn('rounded px-2 py-1 text-xs', wall === w.id ? 'bg-white font-medium text-stone-900 shadow-sm' : 'text-stone-600')}>
                  {w.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Switch id="snap" checked={snapOn} onCheckedChange={(v) => setSnapOn(v === true)} />
            <Label htmlFor="snap" className="text-xs">Snap</Label>
            <span className="text-[11px] text-muted-foreground">{!snapOn ? 'Off — cabinets can overlap' : alt ? 'Paused — Alt is held' : 'On — hold Alt to place freely'}</span>
          </div>
          <NumField label="Room width" value={room.width} min={600} max={12000} onChange={(v) => setRoom((r) => (r.width = v))} />
          <NumField label="Room depth" value={room.depth} min={600} max={12000} onChange={(v) => setRoom((r) => (r.depth = v))} />
          <NumField label="Wall height" value={room.height} min={1800} max={4000} onChange={(v) => setRoom((r) => (r.height = v))} />
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setJob((j) => {
                const laid = arrangeCabinets(j.cabinets, j.room ?? room)
                for (const c of j.cabinets) if (laid[c.id]) c.placement = laid[c.id]
              })
            }
          >
            Arrange along the back wall
          </Button>
        </div>
        <div className="relative min-h-0 flex-1 bg-[#f3f1ec]">
          {job.cabinets.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Add cabinets, then arrange them in the room.</div>
          ) : view === '3d' ? (
            <Viewer3D parts={parts} library={data.library} width={room.width} height={room.height} depth={room.depth} frame={{ width: room.width, depth: room.depth, height: room.height }} selected={selected ? parts.find((p) => p.key.startsWith(selected + ':'))?.key : null} onSelect={(key) => setSelected(key ? key.split(':')[0]! : null)} showOps />
          ) : view === 'plan' ? (
            <PlanView room={room} cabinets={job.cabinets} place={place} selected={selected} units={units} onDown={(e, id) => onPlan(e, 'down', id)} onMove={(e) => drag && onPlan(e, 'move')} onUp={(e) => onPlan(e, 'up')} />
          ) : (
            <ElevationView room={room} wall={wall} items={elev} selected={selected} units={units} onDown={(e, id) => onElev(e, 'down', id)} onMove={(e) => drag && onElev(e, 'move')} onUp={(e) => onElev(e, 'up')} />
          )}
        </div>
      </div>
      <aside className="flex w-full shrink-0 flex-col gap-3 bg-background p-4 xl:w-[380px]">
        <p className="text-xs text-muted-foreground">
          {view === 'plan' && 'Plan, looking down. The back wall is at the top. The thick edge is the front, with a tick between doors.'}
          {view === 'elevation' && `Elevation of the ${WALLS.find((w) => w.id === wall)?.label.toLowerCase()}, looking straight at it. Doors and drawer fronts show when the cabinet faces you.`}
          {view === '3d' && 'Click a cabinet to edit it here. The room rebuilds as you change it.'}
        </p>
        {sel ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="mr-2 rounded bg-stone-800 px-1.5 py-0.5 font-mono text-[11px] text-white">{sel.number}</span>
                <span className="text-sm">{sel.name}</span>
              </div>
              <div className="flex gap-1">
                <Button size="xs" variant="outline" onClick={() => rotate(sel)}>
                  <RotateCw /> Rotate
                </Button>
                <Button size="xs" onClick={() => go({ page: 'cabinet', jobId: job.id, cabinetId: sel.id, from: 'room' })}>
                  Edit
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {formatLength(sel.params.width, units)} × {formatLength(sel.params.height, units)} × {formatLength(sel.params.depth, units)}
            </p>
            <NumField label="Width" value={sel.params.width} min={100} max={2400} onChange={(v) => setParams(sel.id, (p) => (p.width = v))} />
            <NumField label="Height" value={sel.params.height} min={200} max={2800} onChange={(v) => setParams(sel.id, (p) => (p.height = v))} />
            <NumField label="Depth" value={sel.params.depth} min={100} max={900} onChange={(v) => setParams(sel.id, (p) => (p.depth = v))} />
            <SelectField
              label="Doors"
              value={String(sel.params.doors.count) as '0' | '1' | '2'}
              options={[
                { value: '0', label: 'None' },
                { value: '1', label: '1 door' },
                { value: '2', label: '2 doors' },
              ]}
              onChange={(v) => setParams(sel.id, (p) => (p.doors.count = Number(v) as 0 | 1 | 2))}
            />
            <NumField label="Drawers" suffix="" value={sel.params.drawers?.count ?? 0} min={0} max={6} onChange={(v) => setParams(sel.id, (p) => (p.drawers.count = Math.round(v)))} />
            <NumField
              label="Height off the floor"
              value={place(sel).z}
              min={0}
              max={room.height}
              onChange={(v) => setPlacement(sel.id, snapTo(sel, { ...place(sel), z: v }, snapOn && !alt))}
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Click a cabinet in the 3D view, the plan, or an elevation to edit it.</p>
        )}
      </aside>
    </div>
  )
}
