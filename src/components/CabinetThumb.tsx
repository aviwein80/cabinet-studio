import { useId } from 'react'
import { blindSpans } from '@/core/construction/carcass'
import type { CarcassParams } from '@/core/types'

/**
 * Front elevation sketch used on cabinet and template cards. Kitchen-2: a blind corner shows its
 * blind panel hatched beside the door; an end panel is drawn from the side (depth by height, with
 * its toe-kick notch), since from the front it is only a board's thickness wide.
 */
export function CabinetThumb({ p, className }: { p: CarcassParams; className?: string }) {
  const hatch = `thumb-blind-${useId().replace(/:/g, '')}`
  const end = p.panel?.type === 'end-panel' ? p.panel : null
  const W = end ? p.depth : p.width
  const H = p.height
  const tk = (p.kind === 'base' || (end && p.kind === 'tall')) && p.toeKick.enabled ? p.toeKick.height : 0
  const g = p.doors.gap
  const blind = p.corner?.type === 'blind' && !p.panel ? blindSpans(p, p.corner) : null
  const doors = p.panel
    ? []
    : blind
      ? blind.door
        ? [blind.door]
        : []
      : p.doors.count === 0
        ? []
        : p.doors.count === 1
          ? [{ x0: g / 2, x1: W - g / 2, hinge: p.doors.hingeSide }]
          : [
              { x0: g / 2, x1: W / 2 - g / 2, hinge: 'left' },
              { x0: W / 2 + g / 2, x1: W - g / 2, hinge: 'right' },
            ]
  const dz0 = p.kind === 'base' ? tk : g / 2
  const dz1 = p.kind === 'base' ? H - g : H - g / 2
  const pad = Math.max(W, H) * 0.06
  const sw = Math.max(W, H) / 120
  if (end) {
    const notch = end.toeKickNotch && p.kind !== 'wall' ? tk : 0
    const sb = p.toeKick.setback
    // seen from the side: the front at the left
    const pts = notch > 0 ? `0,${notch} ${sb},${notch} ${sb},0 ${W},0 ${W},${H} 0,${H}` : `0,0 ${W},0 ${W},${H} 0,${H}`
    return (
      <svg viewBox={`${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}`} className={className} aria-hidden>
        <g transform={`translate(0 ${H}) scale(1 -1)`} strokeWidth={sw} stroke="#57534e" fill="none">
          <polygon points={pts} fill="#d6d3d1" />
          <line x1={0} y1={notch} x2={0} y2={H} stroke="#1c1917" strokeWidth={sw * 2.5} />
        </g>
      </svg>
    )
  }
  return (
    <svg viewBox={`${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}`} className={className} aria-hidden>
      <defs>
        <pattern id={hatch} patternUnits="userSpaceOnUse" width={sw * 8} height={sw * 8} patternTransform="rotate(45)">
          <rect width={sw * 8} height={sw * 8} fill="#e7e5e4" />
          <line x1={0} y1={0} x2={0} y2={sw * 8} stroke="#a8a29e" strokeWidth={sw} />
        </pattern>
      </defs>
      <g transform={`translate(0 ${H}) scale(1 -1)`} strokeWidth={sw} stroke="#57534e" fill="none">
        <rect x={0} y={tk} width={W} height={H - tk} fill={p.panel ? '#ecfccb' : '#f5f2ec'} />
        {tk > 0 && <rect x={p.panel ? 0 : p.toeKick.setback / 4} y={0} width={p.panel ? W : W - p.toeKick.setback / 2} height={tk} fill="#d6d3d1" />}
        {blind?.panel && <rect x={blind.panel.x0} y={dz0} width={blind.panel.x1 - blind.panel.x0} height={dz1 - dz0} fill={`url(#${hatch})`} />}
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
