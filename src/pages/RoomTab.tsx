import { type PointerEvent } from 'react'
import { RotateCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useStore } from '@/app/store'
import { Viewer3D } from '@/components/Viewer3D'
import { NumField } from '@/components/fields'
import { Button } from '@/components/ui/button'
import { buildCabinet } from '@/core/construction/carcass'
import { arrangeCabinets, footprint, nextRotation, placementOf, snapPlacement, toRoom } from '@/core/room'
import { formatLength } from '@/core/units'
import type { CabinetInstance, CabinetPlacement, Job, Part, Room } from '@/core/types'
import { cn } from '@/lib/utils'

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

export function RoomTab({ job, setJob }: { job: Job; setJob: (fn: (j: Job) => void) => void }) {
  const data = useStore((s) => s.data)!
  const go = useStore((s) => s.go)
  const units = data.settings.units
  const room: Room = job.room ?? { width: 3657.6, depth: 3048, height: 2438.4 }
  const [selected, setSelected] = useState<string | null>(job.cabinets[0]?.id ?? null)
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null)

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
    // place() depends on arranged, which is in the deps via job.cabinets
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, data.library, arranged])

  const pad = Math.max(room.width, room.depth) * 0.08
  const sel = job.cabinets.find((c) => c.id === selected)

  const onPointer = (e: PointerEvent<SVGElement>, phase: 'down' | 'move' | 'up', id?: string) => {
    const svg = e.currentTarget.ownerSVGElement ?? (e.currentTarget as SVGSVGElement)
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const m = svg.getScreenCTM()
    if (!m) return
    const p = pt.matrixTransform(m.inverse())
    const rx = p.x
    const ry = room.depth - p.y
    if (phase === 'down' && id) {
      const c = job.cabinets.find((x) => x.id === id)
      if (!c) return
      const pl = place(c)
      setSelected(id)
      setDrag({ id, dx: rx - pl.x, dy: ry - pl.y })
      svg.setPointerCapture(e.pointerId)
    } else if (phase === 'move' && drag) {
      const c = job.cabinets.find((x) => x.id === drag.id)
      if (!c) return
      const others = job.cabinets.filter((o) => o.id !== c.id).map((o) => footprint(o.params.width, o.params.depth, place(o)))
      const snapped = snapPlacement({ ...place(c), x: rx - drag.dx, y: ry - drag.dy }, c.params.width, c.params.depth, others, room)
      setPlacement(c.id, snapped)
    } else if (phase === 'up') setDrag(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col xl:flex-row">
      <div className="flex min-h-[420px] min-w-0 flex-1 flex-col border-b xl:border-r xl:border-b-0">
        <div className="flex flex-wrap items-end gap-3 border-b bg-background px-4 py-3">
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
          ) : (
            <Viewer3D parts={parts} library={data.library} width={room.width} height={room.height} depth={room.depth} frame={{ width: room.width, depth: room.depth, height: room.height }} selected={selected ? parts.find((p) => p.key.startsWith(selected + ':'))?.key : null} onSelect={(key) => setSelected(key ? key.split(':')[0] : null)} showOps />
          )}
        </div>
      </div>
      <div className="flex w-full shrink-0 flex-col xl:w-[420px]">
        <div className="border-b px-4 py-2 text-xs text-muted-foreground">Plan. Drag a cabinet; it snaps to walls and to its neighbours. The back wall is at the top.</div>
        <svg
          viewBox={`${-pad} ${-pad} ${room.width + 2 * pad} ${room.depth + 2 * pad}`}
          className="aspect-[4/3] w-full touch-none bg-stone-100 xl:aspect-auto xl:flex-1"
          onPointerMove={(e) => drag && onPointer(e, 'move')}
          onPointerUp={(e) => onPointer(e, 'up')}
        >
          <g transform={`translate(0 ${room.depth}) scale(1 -1)`}>
            <rect x={0} y={0} width={room.width} height={room.depth} fill="#f7f4ee" stroke="#78716c" strokeWidth={room.width / 200} />
            {job.cabinets.map((c) => {
              const pl = place(c)
              const fp = footprint(c.params.width, c.params.depth, pl)
              const on = c.id === selected
              return (
                <g key={c.id} className="cursor-grab" onPointerDown={(e) => onPointer(e, 'down', c.id)}>
                  <rect x={fp.x} y={fp.y} width={fp.w} height={fp.d} fill={c.params.kind === 'wall' ? '#bfdbfe' : c.params.kind === 'tall' ? '#fde68a' : '#e7e5e4'} stroke={on ? '#b45309' : '#44403c'} strokeWidth={on ? room.width / 180 : room.width / 400} />
                  <text x={fp.x + fp.w / 2} y={fp.y + fp.d / 2} textAnchor="middle" dominantBaseline="middle" fontSize={Math.max(fp.w, fp.d) / 8} fill="#1c1917" transform={`translate(0 ${2 * (fp.y + fp.d / 2)}) scale(1 -1)`}>
                    {c.number}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>
        {sel && (
          <div className={cn('flex flex-col gap-2 border-t bg-background p-3 text-xs')}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="mr-2 rounded bg-stone-800 px-1.5 py-0.5 font-mono text-[11px] text-white">{sel.number}</span>
                {sel.name}
              </div>
              <div className="flex gap-1">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    const pl = place(sel)
                    const fp = footprint(sel.params.width, sel.params.depth, pl)
                    const turned = nextRotation(pl.rotation)
                    const nowTurned = turned === 90 || turned === 270
                    const w = nowTurned ? sel.params.depth : sel.params.width
                    const d = nowTurned ? sel.params.width : sel.params.depth
                    setPlacement(sel.id, { ...pl, rotation: turned, x: fp.x + fp.w / 2 - w / 2, y: fp.y + fp.d / 2 - d / 2 })
                  }}
                >
                  <RotateCw /> Rotate
                </Button>
                <Button size="xs" onClick={() => go({ page: 'cabinet', jobId: job.id, cabinetId: sel.id })}>
                  Edit
                </Button>
              </div>
            </div>
            <div className="text-muted-foreground">
              {formatLength(sel.params.width, units)} × {formatLength(sel.params.height, units)} × {formatLength(sel.params.depth, units)} · floor {formatLength(place(sel).z, units)}
            </div>
            <NumField label="Height off the floor" value={place(sel).z} min={0} max={room.height} onChange={(v) => setPlacement(sel.id, { ...place(sel), z: v })} />
          </div>
        )}
      </div>
    </div>
  )
}
