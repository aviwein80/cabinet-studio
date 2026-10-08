import type { PointerEvent } from 'react'
import { blindSpans } from '@/core/construction/carcass'
import { pieFootprint } from '@/core/construction/pieCut'
import { footprint, toRoom } from '@/core/room'
import { formatLength } from '@/core/units'
import type { CabinetInstance, CabinetPlacement, Room, UnitSystem } from '@/core/types'
import { elevationLabels, fitSize, wallLength, type ElevationCabinet, type WallId } from '@/core/elevation'

function upright(y: number) {
  return `translate(0 ${2 * y}) scale(1 -1)`
}

/**
 * The front edge in plan, from the cabinet's own left end (local x = 0) to its right end, and the
 * direction into the cabinet. Worked out through `toRoom`, so the plan, the 3D view and the
 * elevations agree on which end is which (a blind corner's blind part, a door's hinge side).
 */
function frontOf(c: CabinetInstance, pl: CabinetPlacement) {
  const { width: W, depth: D } = c.params
  const a = toRoom(0, 0, 0, pl, W, D)
  const b = toRoom(W, 0, 0, pl, W, D)
  const back = toRoom(0, D, 0, pl, W, D)
  const ix = Math.sign(back[0] - a[0])
  const iy = Math.sign(back[1] - a[1])
  return { x1: a[0], y1: a[1], x2: b[0], y2: b[1], ix, iy, len: W }
}

const PLAN_FILL = { wall: '#dbeafe', tall: '#fde68a', base: '#e7e5e4', filler: '#d9f99d', 'end-panel': '#a8a29e' }

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
        {/* Kitchen-3: floor cabinets first, wall cabinets over them, see-through, so a corner base shows under its wall cabinet */}
        {[...cabinets.filter((c) => c.params.kind !== 'wall'), ...cabinets.filter((c) => c.params.kind === 'wall')].map((c) => {
          const pl = place(c)
          const fp = footprint(c.params.width, c.params.depth, pl)
          const on = c.id === selected
          const see = c.params.kind === 'wall' ? 0.6 : 1
          // Kitchen-3: a pie-cut is drawn as its L, a thick front along each leg (its doors)
          if (c.params.corner?.type === 'pie-cut' && !c.params.panel) {
            const { width: W, depth: D } = c.params
            const f = pieFootprint(c.params, c.params.corner)
            const R = (x: number, y: number) => toRoom(x, y, 0, pl, W, D)
            const pts = f.outline.map((v) => R(v.x, v.y))
            const end = c.params.corner.side === 'right' ? 0 : W
            const fronts = [
              [R(f.inner.x, f.inner.y), R(end, f.inner.y)],
              [R(f.inner.x, f.inner.y), R(f.inner.x, 0)],
            ]
            const mid = R((f.sideLeg.x0 + f.sideLeg.x1) / 2, (f.backLeg.y0 + f.backLeg.y1) / 2)
            const legs = `${formatLength(W, units)} × ${formatLength(D, units)}`
            return (
              <g key={c.id} className="cursor-grab" onPointerDown={(e) => onDown(e, c.id)}>
                <polygon points={pts.map((q) => `${q[0]},${q[1]}`).join(' ')} fill={PLAN_FILL[c.params.kind]} fillOpacity={see} stroke={on ? '#b45309' : '#44403c'} strokeWidth={on ? stroke * 3 : stroke} />
                {c.params.doors.count > 0 && fronts.map(([a, b], i) => <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={on ? '#b45309' : '#1c1917'} strokeWidth={stroke * 5} />)}
                <text x={mid[0]} y={mid[1]} textAnchor="middle" dominantBaseline="middle" fontSize={fitSize(c.number, font, c.params.corner.legDepth * 0.9)} fill="#1c1917" transform={upright(mid[1])}>
                  {c.number}
                </text>
                <text x={mid[0]} y={mid[1] - font} textAnchor="middle" fontSize={fitSize(legs, font * 0.6, c.params.corner.legDepth * 0.95)} fill="#57534e" transform={upright(mid[1] - font)}>
                  {legs}
                </text>
              </g>
            )
          }
          const front = frontOf(c, pl)
          const tick = Math.min(fp.w, fp.d) * 0.18
          const panel = c.params.panel?.type
          const doors = panel || c.params.corner ? 0 : c.params.doors.count
          const ticks = doors > 1 ? Array.from({ length: doors - 1 }, (_, i) => (i + 1) / doors) : []
          const labelX = (front.x1 + front.x2) / 2 - front.ix * tick * 1.3
          const labelY = (front.y1 + front.y2) / 2 - front.iy * tick * 1.3
          // Kitchen-2: a blind corner's blind part is drawn thin and dashed along its front
          const bc = c.params.corner?.type === 'blind' && !panel ? c.params.corner : null
          const blind = bc ? blindSpans(c.params, bc) : null
          const at = (u: number) => ({ x: front.x1 + (front.x2 - front.x1) * u, y: front.y1 + (front.y2 - front.y1) * u })
          const bu = blind && bc ? (bc.blindSide === 'left' ? [0, bc.blindWidth / c.params.width] : [1 - bc.blindWidth / c.params.width, 1]) : null
          const fill = panel ? PLAN_FILL[panel] : PLAN_FILL[c.params.kind]
          return (
            <g key={c.id} className="cursor-grab" onPointerDown={(e) => onDown(e, c.id)}>
              <rect x={fp.x} y={fp.y} width={fp.w} height={fp.d} fill={fill} fillOpacity={see} stroke={on ? '#b45309' : '#44403c'} strokeWidth={on ? stroke * 3 : stroke} />
              {bu ? (
                <>
                  <line x1={at(bu[0]).x} y1={at(bu[0]).y} x2={at(bu[1]).x} y2={at(bu[1]).y} stroke={on ? '#b45309' : '#78716c'} strokeWidth={stroke * 2} strokeDasharray={`${stroke * 4} ${stroke * 3}`} />
                  <line x1={at(bu[0] === 0 ? bu[1] : 0).x} y1={at(bu[0] === 0 ? bu[1] : 0).y} x2={at(bu[0] === 0 ? 1 : bu[0]).x} y2={at(bu[0] === 0 ? 1 : bu[0]).y} stroke={on ? '#b45309' : '#1c1917'} strokeWidth={stroke * 5} />
                </>
              ) : (
                <line x1={front.x1} y1={front.y1} x2={front.x2} y2={front.y2} stroke={on ? '#b45309' : '#1c1917'} strokeWidth={stroke * (panel === 'end-panel' ? 2 : 5)} />
              )}
              {ticks.map((t) => {
                const x = front.x1 + (front.x2 - front.x1) * t
                const y = front.y1 + (front.y2 - front.y1) * t
                return <line key={t} x1={x} y1={y} x2={x + front.ix * tick} y2={y + front.iy * tick} stroke="#1c1917" strokeWidth={stroke * 1.5} />
              })}
              <text x={fp.x + fp.w / 2} y={fp.y + fp.d / 2} textAnchor="middle" dominantBaseline="middle" fontSize={fitSize(c.number, font, Math.max(fp.w, fp.d) * 0.9)} fill="#1c1917" transform={upright(fp.y + fp.d / 2)}>
                {c.number}
              </text>
              {panel !== 'end-panel' && (
                <text x={labelX} y={labelY} textAnchor="middle" fontSize={fitSize(formatLength(front.len, units), font * 0.72, front.len * 0.95)} fill="#57534e" transform={upright(labelY)}>
                  {formatLength(front.len, units)}
                </text>
              )}
            </g>
          )
        })}
      </g>
    </svg>
  )
}

const FILL = { toe: '#d6d3d1', drawer: '#fde68a', door: '#f5f5f4', blind: '#e7e5e4', filler: '#ecfccb', leg: 'url(#corner-hatch)' }
const BOX_FILL = { cabinet: '#fafaf9', filler: '#fafaf9', 'end-panel': '#d6d3d1' }

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
      <defs>
        <pattern id="corner-hatch" patternUnits="userSpaceOnUse" width={stroke * 12} height={stroke * 12} patternTransform="rotate(45)">
          <rect width={stroke * 12} height={stroke * 12} fill="#e7e5e4" />
          <line x1={0} y1={0} x2={0} y2={stroke * 12} stroke="#a8a29e" strokeWidth={stroke * 1.5} />
        </pattern>
      </defs>
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
          // Kitchen-2: a corner cabinet seen end on from the side wall; fillers and end panels are narrow
          const nameText = `${item.number}${item.endView ? ' corner' : item.faces || item.kind === 'end-panel' ? '' : ' back'}`
          const nameSize = fitSize(nameText, font, item.w * 0.92)
          const narrow = item.w < font * 2.2
          return (
            <g key={item.id} className={item.endView ? 'cursor-pointer' : 'cursor-grab'} onPointerDown={(e) => onDown(e, item.id)}>
              <rect x={item.x} y={item.z} width={item.w} height={item.h} fill={item.endView ? 'url(#corner-hatch)' : item.faces ? BOX_FILL[item.kind] : '#d6d3d1'} stroke={on ? '#b45309' : '#44403c'} strokeWidth={on ? stroke * 3 : stroke} />
              {item.divisions.map((div, i) => (
                <rect key={i} x={item.x + div.u0 * item.w + inset} y={div.z0 + inset} width={Math.max(1, (div.u1 - div.u0) * item.w - 2 * inset)} height={Math.max(1, div.z1 - div.z0 - 2 * inset)} fill={FILL[div.kind]} stroke="#44403c" strokeWidth={stroke} />
              ))}
              {narrow ? (
                // too narrow for a label across it (a filler, an end panel): the number above it
                <text x={item.x + item.w / 2} y={item.z + item.h + font * 0.35} textAnchor="middle" fontSize={font * 0.6} fill="#1c1917" transform={upright(item.z + item.h + font * 0.35)}>
                  {item.number}
                </text>
              ) : (
                <>
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
                </>
              )}
            </g>
          )
        })}
      </g>
    </svg>
  )
}
