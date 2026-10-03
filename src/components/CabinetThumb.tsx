import type { CarcassParams } from '@/core/types'

/** Front elevation sketch used on cabinet and template cards. */
export function CabinetThumb({ p, className }: { p: CarcassParams; className?: string }) {
  const W = p.width
  const H = p.height
  const tk = p.kind === 'base' && p.toeKick.enabled ? p.toeKick.height : 0
  const g = p.doors.gap
  const doors =
    p.doors.count === 0 ? [] : p.doors.count === 1 ? [{ x0: g / 2, x1: W - g / 2, hinge: p.doors.hingeSide }] : [{ x0: g / 2, x1: W / 2 - g / 2, hinge: 'left' }, { x0: W / 2 + g / 2, x1: W - g / 2, hinge: 'right' }]
  const dz0 = p.kind === 'base' ? tk : g / 2
  const dz1 = p.kind === 'base' ? H - g : H - g / 2
  const pad = Math.max(W, H) * 0.06
  return (
    <svg viewBox={`${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}`} className={className} aria-hidden>
      <g transform={`translate(0 ${H}) scale(1 -1)`} strokeWidth={Math.max(W, H) / 120} stroke="#57534e" fill="none">
        <rect x={0} y={tk} width={W} height={H - tk} fill="#f5f2ec" />
        {tk > 0 && <rect x={p.toeKick.setback / 4} y={0} width={W - p.toeKick.setback / 2} height={tk} fill="#d6d3d1" />}
        {doors.map((d, i) => (
          <g key={i}>
            <rect x={d.x0} y={dz0} width={d.x1 - d.x0} height={dz1 - dz0} fill="#ffffff" />
            <polyline
              points={
                d.hinge === 'left'
                  ? `${d.x1 - 20},${dz0 + 20} ${d.x0 + 20},${(dz0 + dz1) / 2} ${d.x1 - 20},${dz1 - 20}`
                  : `${d.x0 + 20},${dz0 + 20} ${d.x1 - 20},${(dz0 + dz1) / 2} ${d.x0 + 20},${dz1 - 20}`
              }
              strokeDasharray="14 10"
              stroke="#a8a29e"
            />
          </g>
        ))}
      </g>
    </svg>
  )
}
