import type { PointerEvent } from 'react'
import { footprint } from '@/core/room'
import { formatLength } from '@/core/units'
import type { CabinetInstance, CabinetPlacement, Room, UnitSystem } from '@/core/types'
import { elevationLabels, fitSize, wallLength, type ElevationCabinet, type WallId } from '@/core/elevation'

function upright(y: number) {
  return `translate(0 ${2 * y}) scale(1 -1)`
}

function frontOf(fp: { x: number; y: number; w: number; d: number }, rotation: CabinetPlacement['rotation']) {
  if (rotation === 0) return { x1: fp.x, y1: fp.y, x2: fp.x + fp.w, y2: fp.y, ix: 0, iy: 1, len: fp.w }
  if (rotation === 90) return { x1: fp.x, y1: fp.y, x2: fp.x, y2: fp.y + fp.d, ix: 1, iy: 0, len: fp.d }
  if (rotation === 180) return { x1: fp.x, y1: fp.y + fp.d, x2: fp.x + fp.w, y2: fp.y + fp.d, ix: 0, iy: -1, len: fp.w }
  return { x1: fp.x + fp.w, y1: fp.y, x2: fp.x + fp.w, y2: fp.y + fp.d, ix: -1, iy: 0, len: fp.d }
}

export function PlanView({
  room,
  cabinets,
  place,
  selected,
  units,
  onDown,
  onMove,
  onUp,
}: {
  room: Room
  cabinets: CabinetInstance[]
  place: (c: CabinetInstance) => CabinetPlacement
  selected: string | null
  units: UnitSystem
  onDown: (e: PointerEvent<SVGElement>, id: string) => void
  onMove: (e: PointerEvent<SVGElement>) => void
  onUp: (e: PointerEvent<SVGElement>) => void
}) {
  const pad = Math.max(room.width, room.depth) * 0.1
  const stroke = room.width / 500
  const font = Math.max(room.width, room.depth) / 42
  return (
    <svg viewBox={`${-pad} ${-pad} ${room.width + 2 * pad} ${room.depth + 2 * pad}`} className="h-full w-full touch-none" onPointerMove={onMove} onPointerUp={onUp}>
      <text x={room.width / 2} y={room.depth + pad * 0.62} textAnchor="middle" fontSize={font} fill="#57534e">
        {formatLength(room.width, units)} wide
      </text>
      <text x={-pad * 0.08} y={room.depth / 2} textAnchor="middle" fontSize={font} fill="#57534e" transform={`rotate(-90 ${-pad * 0.08} ${room.depth / 2})`}>
        {formatLength(room.depth, units)} deep
      </text>
      <g transform={`translate(0 ${room.depth}) scale(1 -1)`}>
        <rect x={0} y={0} width={room.width} height={room.depth} fill="#f7f4ee" stroke="#78716c" strokeWidth={stroke * 2} />
        <text x={room.width / 2} y={room.depth - font * 0.3} textAnchor="middle" fontSize={font * 0.75} fill="#a8a29e" transform={upright(room.depth - font * 0.3)}>
          back wall
        </text>
        {cabinets.map((c) => {
          const pl = place(c)
          const fp = footprint(c.params.width, c.params.depth, pl)
          const on = c.id === selected
          const front = frontOf(fp, pl.rotation)
          const tick = Math.min(fp.w, fp.d) * 0.18
          const doors = c.params.doors.count
          const ticks = doors > 1 ? Array.from({ length: doors - 1 }, (_, i) => (i + 1) / doors) : []
          const labelX = (front.x1 + front.x2) / 2 - front.ix * tick * 1.3
          const labelY = (front.y1 + front.y2) / 2 - front.iy * tick * 1.3
          return (
            <g key={c.id} className="cursor-grab" onPointerDown={(e) => onDown(e, c.id)}>
              <rect x={fp.x} y={fp.y} width={fp.w} height={fp.d} fill={c.params.kind === 'wall' ? '#dbeafe' : c.params.kind === 'tall' ? '#fde68a' : '#e7e5e4'} stroke={on ? '#b45309' : '#44403c'} strokeWidth={on ? stroke * 3 : stroke} />
              <line x1={front.x1} y1={front.y1} x2={front.x2} y2={front.y2} stroke={on ? '#b45309' : '#1c1917'} strokeWidth={stroke * 5} />
              {ticks.map((t) => {
                const x = front.x1 + (front.x2 - front.x1) * t
                const y = front.y1 + (front.y2 - front.y1) * t
                return <line key={t} x1={x} y1={y} x2={x + front.ix * tick} y2={y + front.iy * tick} stroke="#1c1917" strokeWidth={stroke * 1.5} />
              })}
              <text x={fp.x + fp.w / 2} y={fp.y + fp.d / 2} textAnchor="middle" dominantBaseline="middle" fontSize={font} fill="#1c1917" transform={upright(fp.y + fp.d / 2)}>
                {c.number}
              </text>
              <text x={labelX} y={labelY} textAnchor="middle" fontSize={font * 0.72} fill="#57534e" transform={upright(labelY)}>
                {formatLength(front.len, units)}
              </text>
            </g>
          )
        })}
      </g>
    </svg>
  )
}

const FILL = { toe: '#d6d3d1', drawer: '#fde68a', door: '#f5f5f4' }

export function ElevationView({
  room,
  wall,
  items,
  selected,
  units,
  onDown,
  onMove,
  onUp,
}: {
  room: Room
  wall: WallId
  items: ElevationCabinet[]
  selected: string | null
  units: UnitSystem
  onDown: (e: PointerEvent<SVGElement>, id: string) => void
  onMove: (e: PointerEvent<SVGElement>) => void
  onUp: (e: PointerEvent<SVGElement>) => void
}) {
  const length = wallLength(wall, room)
  const pad = Math.max(length, room.height) * 0.08
  const font = Math.max(length, room.height) / 36
  const stroke = length / 500
  return (
    <svg viewBox={`${-pad} ${-pad} ${length + 2 * pad} ${room.height + 2 * pad}`} className="h-full w-full touch-none" onPointerMove={onMove} onPointerUp={onUp}>
      <text x={-pad * 0.12} y={room.height / 2} textAnchor="middle" fontSize={font * 0.8} fill="#57534e" transform={`rotate(-90 ${-pad * 0.12} ${room.height / 2})`}>
        {formatLength(room.height, units)}
      </text>
      <g transform={`translate(0 ${room.height}) scale(1 -1)`}>
        <line x1={0} y1={0} x2={length} y2={0} stroke="#78716c" strokeWidth={stroke * 2} />
        <line x1={0} y1={room.height} x2={length} y2={room.height} stroke="#d6d3d1" strokeWidth={stroke} strokeDasharray={`${stroke * 4} ${stroke * 3}`} />
        {items.map((item) => {
          const on = item.id === selected
          const inset = Math.min(item.w, item.h) * 0.02
          const labels = elevationLabels(item, font, (mm) => formatLength(mm, units))
          const nameText = `${item.number}${item.faces ? '' : ' back'}`
          const nameSize = fitSize(nameText, font, item.w * 0.92)
          return (
            <g key={item.id} className="cursor-grab" onPointerDown={(e) => onDown(e, item.id)}>
              <rect x={item.x} y={item.z} width={item.w} height={item.h} fill={item.faces ? '#fafaf9' : '#d6d3d1'} stroke={on ? '#b45309' : '#44403c'} strokeWidth={on ? stroke * 3 : stroke} />
              {item.divisions.map((div, i) => (
                <rect key={i} x={item.x + div.u0 * item.w + inset} y={div.z0 + inset} width={Math.max(1, (div.u1 - div.u0) * item.w - 2 * inset)} height={Math.max(1, div.z1 - div.z0 - 2 * inset)} fill={FILL[div.kind]} stroke="#44403c" strokeWidth={stroke} />
              ))}
              <text x={item.x + item.w / 2} y={item.z + item.h * 0.55} textAnchor="middle" fontSize={nameSize} fill="#1c1917" transform={upright(item.z + item.h * 0.55)}>
                {nameText}
              </text>
              <text x={item.x + item.w / 2} y={item.z + item.h - labels.width.size * 1.1} textAnchor="middle" fontSize={labels.width.size} fill="#57534e" transform={upright(item.z + item.h - labels.width.size * 1.1)}>
                {labels.width.text}
              </text>
              {labels.lines.map((l) => (
                <text key={l.text} x={item.x + item.w - font * 0.15} y={item.z + l.y} textAnchor="end" fontSize={labels.size} fill="#57534e" transform={upright(item.z + l.y)}>
                  {l.text}
                </text>
              ))}
            </g>
          )
        })}
      </g>
    </svg>
  )
}
