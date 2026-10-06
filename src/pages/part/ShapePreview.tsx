/** Small drawing of contours (part coordinates, Y up) used by the CAD dialogs' previews. */
import type { Contour, P } from '@/cam/geom'
import { boxOf } from '@/cam/geom'
import { contourPath } from './hit'

export interface PreviewLayer {
  contours: Contour[]
  stroke: string
  fill?: string
  dash?: string
  width?: number
}

export function ShapePreview({ layers, points, extra, className, label }: { layers: PreviewLayer[]; points?: { p: P; color: string; r?: number }[]; extra?: Contour[]; className?: string; label: string }) {
  const all = [...layers.flatMap((l) => l.contours), ...(extra ?? [])].filter((c) => c.segs.length)
  const b = all.length ? boxOf(all) : { minX: 0, minY: 0, maxX: 100, maxY: 100 }
  const w = Math.max(1, b.maxX - b.minX)
  const h = Math.max(1, b.maxY - b.minY)
  const pad = Math.max(w, h) * 0.06
  return (
    <svg viewBox={`${b.minX - pad} ${-b.maxY - pad} ${w + 2 * pad} ${h + 2 * pad}`} className={className ?? 'h-64 w-full rounded-md bg-black/40'} role="img" aria-label={label}>
      <g transform="scale(1 -1)">
        {layers.map((l, i) => (
          <path key={i} d={l.contours.map(contourPath).join('')} fill={l.fill ?? 'none'} fillRule="evenodd" stroke={l.stroke} strokeDasharray={l.dash} strokeWidth={l.width ?? 1.5} vectorEffect="non-scaling-stroke" />
        ))}
        {points?.map((q, i) => <circle key={i} cx={q.p.x} cy={q.p.y} r={q.r ?? Math.max(w, h) * 0.008} fill={q.color} />)}
      </g>
    </svg>
  )
}
