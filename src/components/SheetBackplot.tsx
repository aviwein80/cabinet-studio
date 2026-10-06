/**
 * Sheet backplot for flip-side sheets (M2.8, NST-07): what each of the two programs does, drawn
 * on the sheet as it lies for that side, or both sides on top of each other with the side-1 work
 * turned back over, so the underside holes can be seen landing on their parts.
 */
import type { PartInstance } from '@/core/cutlist'
import { flipMap, registrationError } from '@/core/flipSide'
import { placementTransform, type SheetProgram } from '@/core/machining'
import type { MachineProfile, Vec2 } from '@/core/types'

export type BackplotMode = 'side1' | 'side2' | 'both'

export function SheetBackplot({ front, instances, machine, mode }: { front: SheetProgram; instances: Map<string, PartInstance>; machine: MachineProfile; mode: BackplotMode }) {
  const sh = front.sheet
  const f = sh.flip
  const side1 = front.back?.program
  if (!f || !side1) return null
  const { toSide1, toSide2 } = flipMap(sh, f.axis)
  const onSide1 = mode === 'side1'
  const L = onSide1 ? f.length : sh.sheetLength
  const W = onSide1 ? f.width : sh.sheetWidth
  const pad = 40
  const fs = Math.max(L, W) / 60
  const place = (p: Vec2) => (onSide1 ? toSide1(p) : p)
  const err = registrationError(front, side1, instances, machine)
  const poly = (pts: Vec2[]) => pts.map((p) => `${p.x},${p.y}`).join(' ')
  const holes1 = side1.ops.filter((o) => o.kind === 'vdrill')
  const ref = side1.ops.find((o) => o.kind === 'contour' && o.reference)
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" data-testid="backplot-info">
        <span className="font-medium">{onSide1 ? `Side 1 (${side1.name}): sheet face 6 up, ${f.length} × ${f.width}` : mode === 'side2' ? `Side 2 (${front.name}): turned over ${f.axis === 'end' ? 'end for end' : 'over its long edge'}` : 'Both sides: side-1 work turned back over onto side 2'}</span>
        <span className={err <= 0.1 ? 'text-emerald-700' : 'text-red-700'}>
          Registration: {holes1.length ? `underside holes within ${err.toFixed(3)} mm of their parts' design` : 'no underside holes'}
        </span>
      </div>
      <svg viewBox={`${-pad} ${-pad} ${L + 2 * pad} ${W + 2 * pad}`} className="min-h-0 w-full flex-1 select-none" role="img" aria-label={`Sheet ${sh.index} backplot`}>
        <g transform={`translate(0 ${W}) scale(1 -1)`}>
          <rect x={0} y={0} width={L} height={W} fill="#f7f3ea" stroke="#8a7f6c" strokeWidth={3} />
          {onSide1 && ref && ref.kind === 'contour' && (
            <>
              {f.axis === 'end' ? <rect x={sh.sheetLength} y={0} width={f.reference} height={W} fill="#c2410c" opacity={0.35} /> : <rect x={0} y={sh.sheetWidth} width={L} height={f.reference} fill="#c2410c" opacity={0.35} />}
              <polyline points={poly(ref.points)} fill="none" stroke="#c2410c" strokeWidth={6} />
            </>
          )}
          {!onSide1 && (f.axis === 'end' ? <line x1={0} y1={0} x2={0} y2={W} stroke="#c2410c" strokeWidth={8} /> : <line x1={0} y1={0} x2={L} y2={0} stroke="#c2410c" strokeWidth={8} />)}
          {sh.placements.map((pl) => {
            const inst = instances.get(pl.uid)
            if (!inst) return null
            const { pt } = placementTransform(inst, pl)
            return <polygon key={pl.uid} points={poly(inst.outline.map((q) => place(pt(q.x, q.y))))} fill={onSide1 ? '#e7e5e4' : '#dbeafe'} stroke="#475569" strokeWidth={2} />
          })}
          {!onSide1 &&
            front.ops.map((o, i) => {
              if (o.kind === 'contour') return <polyline key={i} points={poly(o.points)} fill="none" stroke="#1e3a8a" strokeWidth={2} strokeDasharray="10 6" />
              if (o.kind === 'vdrill') return <circle key={i} cx={o.x} cy={o.y} r={Math.max(o.diameter / 2, 3)} fill="#1e293b" />
              if (o.kind === 'cam' && o.intent.k === 'vdrill') return <circle key={i} cx={o.intent.x} cy={o.intent.y} r={Math.max(o.intent.d / 2, 3)} fill="#1e293b" />
              return null
            })}
          {(onSide1 || mode === 'both') &&
            holes1.map((o, i) => {
              if (o.kind !== 'vdrill') return null
              const p = onSide1 ? o : toSide2(o)
              return <circle key={`b${i}`} cx={p.x} cy={p.y} r={Math.max(o.diameter / 2, 3) + 9} fill={onSide1 ? '#c2410c' : 'none'} stroke="#c2410c" strokeWidth={onSide1 ? 0 : 5} data-testid="underside-hole" />
            })}
        </g>
        {sh.placements.map((pl) => {
          const inst = instances.get(pl.uid)
          if (!inst) return null
          const c = place({ x: pl.x + pl.dx / 2, y: pl.y + pl.dy / 2 })
          return (
            <text key={pl.uid} x={c.x} y={W - c.y} textAnchor="middle" fontSize={fs} fontWeight={700} fill="#0f172a" fontFamily="Geist Variable, sans-serif">
              {inst.no}
            </text>
          )
        })}
        <text x={0} y={W + 30} fontSize={fs * 0.8} fill="#c2410c" fontFamily="Geist Variable, sans-serif">
          {onSide1 ? 'stops at the origin; strip milled at the far ' + (f.axis === 'end' ? 'end' : 'side') : 'milled reference edge against the stop'}
        </text>
      </svg>
    </div>
  )
}
