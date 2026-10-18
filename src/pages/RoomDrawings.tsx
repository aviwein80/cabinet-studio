import type { PointerEvent } from 'react'
import { blindSpans } from '@/core/construction/carcass'
import { pieFootprint } from '@/core/construction/pieCut'
import { openingRoomSpan } from '@/core/openings'
import { footprint, toRoom } from '@/core/room'
import type { PartShape } from '@/core/roomParts'
import { formatLength } from '@/core/units'
import type { CabinetInstance, CabinetPlacement, Room, RoomOpening, UnitSystem } from '@/core/types'
import { elevationLabels, fitSize, narrowLabelRows, planNumberLabels, wallLength, type ElevationCabinet, type WallId } from '@/core/elevation'

/** Library-1: what the drawings also show besides the cabinets: the room's openings, custom parts placed in it, and the cabinets a change just moved. */
export interface RoomExtras {
  openings: RoomOpening[]
  shapes: PartShape[]
  /** Cabinets a change of width just moved along the run (outlined until the next change). */
  moved: string[]
  selectedOpening: string | null
  selectedPart: string | null
  onDownOpening: (e: PointerEvent<SVGElement>, id: string) => void
  onDownPart: (e: PointerEvent<SVGElement>, id: string) => void
}

const OPENING_STROKE = { door: '#8a6a46', window: '#0369a1', opening: '#57534e' }

/** Library-1: an opening in the plan: the wall broken at it, a door's leaf and swing, a window's glass, a plain opening dashed. */
function PlanOpening({ o, room, stroke, font, on, onDown }: { o: RoomOpening; room: Room; stroke: number; font: number; on: boolean; onDown: (e: PointerEvent<SVGElement>, id: string) => void }) {
  const [lo, hi] = openingRoomSpan(o, room)
  const w = hi - lo
  // the wall line at the opening, from its low end to its high end, and the way into the room
  const line =
    o.wall === 'back'
      ? { a: [lo, room.depth], b: [hi, room.depth], n: [0, -1] }
      : o.wall === 'front'
        ? { a: [lo, 0], b: [hi, 0], n: [0, 1] }
        : o.wall === 'left'
          ? { a: [0, lo], b: [0, hi], n: [1, 0] }
          : { a: [room.width, lo], b: [room.width, hi], n: [-1, 0] }
  const [ax, ay] = line.a
  const [bx, by] = line.b
  const [nx, ny] = line.n
  const col = on ? '#b45309' : OPENING_STROKE[o.kind]
  const t = stroke * 4
  // the gap in the wall: a band across the wall line in the floor's colour
  const gap = o.wall === 'back' || o.wall === 'front' ? { x: lo, y: ay - t, width: w, height: 2 * t } : { x: ax - t, y: lo, width: 2 * t, height: w }
  const quarter = Array.from({ length: 13 }, (_, i) => {
    const t2 = (i / 12) * (Math.PI / 2)
    // from the leaf (straight into the room from the low end) round to the high end of the wall line
    const ux = (bx - ax) / w
    const uy = (by - ay) / w
    return `${ax + w * (nx * Math.cos(t2) + ux * Math.sin(t2))},${ay + w * (ny * Math.cos(t2) + uy * Math.sin(t2))}`
  }).join(' ')
  const mid = [(ax + bx) / 2 + nx * font * 0.9, (ay + by) / 2 + ny * font * 0.9]
  return (
    <g className="cursor-pointer" onPointerDown={(e) => onDown(e, o.id)} data-testid={`plan-opening-${o.id}`}>
      <rect {...gap} fill="#f7f4ee" stroke="none" />
      <line x1={ax} y1={ay} x2={ax + nx * t * 1.6} y2={ay + ny * t * 1.6} stroke={col} strokeWidth={stroke * 2} />
      <line x1={bx} y1={by} x2={bx + nx * t * 1.6} y2={by + ny * t * 1.6} stroke={col} strokeWidth={stroke * 2} />
      {o.kind === 'door' && (
        <>
          <line x1={ax} y1={ay} x2={ax + nx * w} y2={ay + ny * w} stroke={col} strokeWidth={stroke * 1.5} />
          <polyline points={quarter} fill="none" stroke={col} strokeWidth={stroke} strokeDasharray={`${stroke * 3} ${stroke * 2}`} />
        </>
      )}
      {o.kind === 'window' && (
        <>
          <line x1={ax} y1={ay} x2={bx} y2={by} stroke={col} strokeWidth={stroke * 1.2} />
          <line x1={ax + nx * t} y1={ay + ny * t} x2={bx + nx * t} y2={by + ny * t} stroke={col} strokeWidth={stroke * 1.2} />
        </>
      )}
      {o.kind === 'opening' && <line x1={ax} y1={ay} x2={bx} y2={by} stroke={col} strokeWidth={stroke * 1.2} strokeDasharray={`${stroke * 4} ${stroke * 3}`} />}
      <text x={mid[0]} y={mid[1]} textAnchor="middle" dominantBaseline="middle" fontSize={fitSize(o.name ?? '', font * 0.6, Math.max(w, font))} fill={col} transform={upright(mid[1])}>
        {o.name}
      </text>
    </g>
  )
}

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
  extras,
}: {
  room: Room
  cabinets: CabinetInstance[]
  place: (c: CabinetInstance) => CabinetPlacement
  selected: string | null
  units: UnitSystem
  onDown: (e: PointerEvent<SVGElement>, id: string) => void
  onMove: (e: PointerEvent<SVGElement>) => void
  onUp: (e: PointerEvent<SVGElement>) => void
  extras?: RoomExtras
}) {
  const pad = Math.max(room.width, room.depth) * 0.1
  const stroke = room.width / 500
  const font = Math.max(room.width, room.depth) / 42
  // Polish-3: narrow neighbours' numbers moved apart along their footprints, not run together ("EF1")
  const numbers = planNumberLabels(cabinets, place, font)
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
        {/* Library-1: doors, windows and openings in the walls */}
        {extras?.openings.map((o) => <PlanOpening key={o.id} o={o} room={room} stroke={stroke} font={font} on={extras.selectedOpening === o.id} onDown={extras.onDownOpening} />)}
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
              {panel !== 'end-panel' && (
                <text x={labelX} y={labelY} textAnchor="middle" fontSize={fitSize(formatLength(front.len, units), font * 0.72, front.len * 0.95)} fill="#57534e" transform={upright(labelY)}>
                  {formatLength(front.len, units)}
                </text>
              )}
            </g>
          )
        })}
        {/* Library-1: custom parts placed in the room, plain solids seen from above */}
        {extras?.shapes.map((sh) => {
          const on = extras.selectedPart === sh.id
          return (
            <polygon key={sh.id} points={sh.points.map((q) => `${q[0]},${q[1]}`).join(' ')} fill="#d6c3a5" fillOpacity={0.75} stroke={on ? '#b45309' : '#7c5a2c'} strokeWidth={on ? stroke * 3 : stroke} className="cursor-grab" onPointerDown={(e) => extras.onDownPart(e, sh.id)} data-testid="plan-part" />
          )
        })}
        {/* Library-1: the cabinets a change of width just moved along the run */}
        <g pointerEvents="none">
          {cabinets
            .filter((c) => extras?.moved.includes(c.id))
            .map((c) => {
              const fp = footprint(c.params.width, c.params.depth, place(c))
              return <rect key={c.id} x={fp.x} y={fp.y} width={fp.w} height={fp.d} fill="#0284c7" fillOpacity={0.12} stroke="#0284c7" strokeWidth={stroke * 2.5} strokeDasharray={`${stroke * 5} ${stroke * 3}`} data-testid="plan-moved" />
            })}
        </g>
        {/* Polish-3: the numbers over every cabinet (a later cabinet's fill hid a narrow neighbour's), clicks go through */}
        <g pointerEvents="none">
          {cabinets.map((c) => {
            const num = numbers.get(c.id)
            return (
              num && (
                <text key={c.id} x={num.x} y={num.y} textAnchor="middle" dominantBaseline="middle" fontSize={num.size} fill="#1c1917" transform={upright(num.y)}>
                  {c.number}
                </text>
              )
            )
          })}
        </g>
      </g>
    </svg>
  )
}

const FILL = { toe: '#d6d3d1', drawer: '#fde68a', door: '#f5f5f4', blind: '#e7e5e4', filler: '#ecfccb', leg: 'url(#corner-hatch)', shelf: '#a8a29e' }
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
  extras,
}: {
  room: Room
  wall: WallId
  items: ElevationCabinet[]
  selected: string | null
  units: UnitSystem
  onDown: (e: PointerEvent<SVGElement>, id: string) => void
  onMove: (e: PointerEvent<SVGElement>) => void
  onUp: (e: PointerEvent<SVGElement>) => void
  /** Library-1: the openings on this wall, the placed custom parts (as seen facing it), the cabinets just moved. */
  extras?: RoomExtras
}) {
  const length = wallLength(wall, room)
  const pad = Math.max(length, room.height) * 0.08
  const font = Math.max(length, room.height) / 36
  const stroke = length / 500
  const isNarrow = (item: Pick<ElevationCabinet, 'w'>) => item.w < font * 2.2
  // Polish-2: narrow neighbours' numbers stacked, not on top of each other
  const rows = narrowLabelRows(items, font * 0.6, isNarrow)
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
        {/* Library-1: the wall's doors, windows and openings, behind the cabinets standing in front of it */}
        {extras?.openings
          .filter((o) => o.wall === wall)
          .map((o) => {
            const on = extras.selectedOpening === o.id
            const col = on ? '#b45309' : OPENING_STROKE[o.kind]
            const ly = o.sill + o.height - font * 0.75
            return (
              <g key={o.id} className="cursor-pointer" onPointerDown={(e) => extras.onDownOpening(e, o.id)} data-testid={`elevation-opening-${o.id}`}>
                <rect x={o.at} y={o.sill} width={o.width} height={o.height} fill={o.kind === 'window' ? '#e0f2fe' : o.kind === 'door' ? '#efe7da' : 'none'} stroke={col} strokeWidth={on ? stroke * 3 : stroke * 1.5} strokeDasharray={o.kind === 'opening' ? `${stroke * 5} ${stroke * 3}` : undefined} />
                {o.kind === 'window' && (
                  <>
                    <line x1={o.at + o.width / 2} y1={o.sill} x2={o.at + o.width / 2} y2={o.sill + o.height} stroke={col} strokeWidth={stroke * 0.8} />
                    <line x1={o.at} y1={o.sill + o.height / 2} x2={o.at + o.width} y2={o.sill + o.height / 2} stroke={col} strokeWidth={stroke * 0.8} />
                  </>
                )}
                {o.kind === 'door' && <circle cx={o.at + o.width * 0.88} cy={o.sill + Math.min(o.height, 1000)} r={stroke * 3} fill={col} />}
                <text x={o.at + o.width / 2} y={ly} textAnchor="middle" fontSize={fitSize(o.name ?? '', font * 0.6, o.width * 0.9)} fill={col} transform={upright(ly)}>
                  {o.name}
                </text>
              </g>
            )
          })}
        {items.map((item) => {
          const on = item.id === selected
          const inset = Math.min(item.w, item.h) * 0.02
          const labels = elevationLabels(item, font, (mm) => formatLength(mm, units))
          // Kitchen-2: a corner cabinet seen end on from the side wall; fillers and end panels are narrow
          const nameText = `${item.number}${item.endView ? ' corner' : item.faces || item.kind === 'end-panel' ? '' : ' back'}`
          const nameSize = fitSize(nameText, font, item.w * 0.92)
          const narrow = isNarrow(item)
          const labelY = item.z + item.h + font * 0.35 + (rows.get(item.id) ?? 0) * font * 0.62
          return (
            <g key={item.id} className={item.endView ? 'cursor-pointer' : 'cursor-grab'} onPointerDown={(e) => onDown(e, item.id)}>
              <rect x={item.x} y={item.z} width={item.w} height={item.h} fill={item.endView ? 'url(#corner-hatch)' : item.faces ? BOX_FILL[item.kind] : '#d6d3d1'} stroke={on ? '#b45309' : '#44403c'} strokeWidth={on ? stroke * 3 : stroke} />
              {item.divisions.map((div, i) =>
                // Polish-3: an open cabinet's shelf, its own thickness (no inset)
                div.kind === 'shelf' ? (
                  <rect key={i} x={item.x + div.u0 * item.w} y={div.z0} width={Math.max(1, (div.u1 - div.u0) * item.w)} height={Math.max(stroke, div.z1 - div.z0)} fill={FILL.shelf} stroke="#44403c" strokeWidth={stroke * 0.6} data-testid="elevation-shelf" />
                ) : (
                  <rect key={i} x={item.x + div.u0 * item.w + inset} y={div.z0 + inset} width={Math.max(1, (div.u1 - div.u0) * item.w - 2 * inset)} height={Math.max(1, div.z1 - div.z0 - 2 * inset)} fill={FILL[div.kind]} stroke="#44403c" strokeWidth={stroke} />
                ),
              )}
              {narrow ? (
                // too narrow for a label across it (a filler, an end panel): the number above it
                <text x={item.x + item.w / 2} y={labelY} textAnchor="middle" fontSize={font * 0.6} fill="#1c1917" transform={upright(labelY)}>
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
        {/* Library-1: each opening's outline again over the cabinets, dashed, so one covered by a cabinet (a sliding bookcase door over the entry) still shows */}
        <g pointerEvents="none">
          {extras?.openings
            .filter((o) => o.wall === wall && items.some((it) => Math.min(it.x + it.w, o.at + o.width) - Math.max(it.x, o.at) > 0.5 && Math.min(it.z + it.h, o.sill + o.height) - Math.max(it.z, o.sill) > 0.5))
            .map((o) => (
              <g key={o.id} data-testid={`elevation-opening-over-${o.id}`}>
                <rect x={o.at} y={o.sill} width={o.width} height={o.height} fill="none" stroke={extras.selectedOpening === o.id ? '#b45309' : OPENING_STROKE[o.kind]} strokeWidth={stroke * 2} strokeDasharray={`${stroke * 6} ${stroke * 4}`} />
                <text x={o.at + o.width / 2} y={o.sill + o.height - font * 0.75} textAnchor="middle" fontSize={fitSize(o.name ?? '', font * 0.55, o.width * 0.9)} fill={OPENING_STROKE[o.kind]} transform={upright(o.sill + o.height - font * 0.75)}>
                  {o.name}
                </text>
              </g>
            ))}
        </g>
        {/* Library-1: the cabinets a change of width just moved */}
        <g pointerEvents="none">
          {items
            .filter((it) => extras?.moved.includes(it.id))
            .map((it) => (
              <rect key={it.id} x={it.x} y={it.z} width={it.w} height={it.h} fill="#0284c7" fillOpacity={0.1} stroke="#0284c7" strokeWidth={stroke * 2.5} strokeDasharray={`${stroke * 5} ${stroke * 3}`} data-testid="elevation-moved" />
            ))}
        </g>
        {/* Library-1: custom parts placed in the room, as seen facing this wall (see-through: they may stand in front of the cabinets) */}
        {extras?.shapes.map((sh) => {
          const on = extras.selectedPart === sh.id
          return <polygon key={sh.id} points={sh.points.map((q) => `${q[0]},${q[1]}`).join(' ')} fill="#d6c3a5" fillOpacity={0.45} stroke={on ? '#b45309' : '#7c5a2c'} strokeWidth={on ? stroke * 3 : stroke} strokeDasharray={`${stroke * 4} ${stroke * 2}`} className="cursor-pointer" onPointerDown={(e) => extras.onDownPart(e, sh.id)} data-testid="elevation-part" />
        })}
      </g>
    </svg>
  )
}
