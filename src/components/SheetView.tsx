import type { PartInstance } from '@/core/cutlist'
import { placementTransform, type SheetProgram } from '@/core/machining'
import type { LabelSpot } from '@/core/labels/placement'

const PALETTE = ['#dbeafe', '#dcfce7', '#fef3c7', '#fce7f3', '#e0e7ff', '#ccfbf1', '#fee2e2', '#ede9fe', '#ecfccb', '#ffedd5']

export function SheetView({
  program,
  instances,
  spots,
  showLabels,
  showOps,
  selectedUid,
  onSelect,
  highlightUids,
  cutPaths,
  groups,
}: {
  program: SheetProgram
  instances: Map<string, PartInstance>
  spots: LabelSpot[]
  showLabels: boolean
  showOps: boolean
  selectedUid?: string | null
  onSelect?: (uid: string | null) => void
  highlightUids?: Set<string>
  /** Tool-centre cutting paths to draw over the sheet (shared-line plan, M2.8). */
  cutPaths?: { pts: { x: number; y: number }[]; closed: boolean }[]
  /** Bridged groups (M2.8): the path round each group and its bridges. */
  groups?: { outer: { x: number; y: number }[]; holes: { x: number; y: number }[][]; bridges: { x0: number; y0: number; x1: number; y1: number }[] }[]
}) {
  const s = program.sheet
  const cabinets = [...new Set(s.placements.map((p) => instances.get(p.uid)?.cabinetId ?? ''))]
  const pad = 40
  const fontBase = Math.max(s.sheetLength, s.sheetWidth) / 60
  return (
    <svg
      viewBox={`${-pad} ${-pad} ${s.sheetLength + 2 * pad} ${s.sheetWidth + 2 * pad}`}
      className="h-full w-full select-none"
      onClick={() => onSelect?.(null)}
      role="img"
      aria-label={`Sheet ${s.index} layout`}
    >
      <g transform={`translate(0 ${s.sheetWidth}) scale(1 -1)`}>
        <rect x={0} y={0} width={s.sheetLength} height={s.sheetWidth} fill="#f7f3ea" stroke="#8a7f6c" strokeWidth={3} />
        {s.placements.map((pl) => {
          const inst = instances.get(pl.uid)
          if (!inst) return null
          const { pt } = placementTransform(inst, pl)
          const poly = inst.outline.map((p) => pt(p.x, p.y))
          const colorIdx = cabinets.indexOf(inst.cabinetId) % PALETTE.length
          const sel = selectedUid === pl.uid
          const hi = highlightUids?.has(pl.uid)
          return (
            <polygon
              key={pl.uid}
              points={poly.map((p) => `${p.x},${p.y}`).join(' ')}
              fill={sel ? '#fde68a' : PALETTE[colorIdx]}
              stroke={hi ? '#dc2626' : sel ? '#b45309' : '#475569'}
              strokeWidth={hi || sel ? 6 : 2}
              className="cursor-pointer"
              onClick={(e) => {
                e.stopPropagation()
                onSelect?.(pl.uid)
              }}
            />
          )
        })}
        {s.placements.map((pl) => {
          const inst = instances.get(pl.uid)
          if (!inst?.holes?.length) return null
          const { pt } = placementTransform(inst, pl)
          return inst.holes.map((h, k) => <polygon key={`${pl.uid}-h${k}`} points={h.map((p) => pt(p.x, p.y)).map((p) => `${p.x},${p.y}`).join(' ')} fill="#f7f3ea" stroke="#475569" strokeWidth={2} pointerEvents="none" />)
        })}
        {(s.remnants ?? []).map((r, i) => (
          <rect key={`rem${i}`} x={r.x} y={r.y} width={r.length} height={r.width} fill="#dcfce7" fillOpacity={0.45} stroke="#15803d" strokeWidth={3} strokeDasharray="18 10" pointerEvents="none" />
        ))}
        {showOps &&
          program.ops.map((op, i) => {
            if (op.kind === 'vdrill')
              return <circle key={i} cx={op.x} cy={op.y} r={Math.max(op.diameter / 2, 2.5)} fill={op.diameter >= 20 ? '#64748b' : '#1e293b'} pointerEvents="none" />
            if (op.kind === 'pocket')
              return <rect key={i} x={op.x1} y={op.y1} width={op.x2 - op.x1} height={op.y2 - op.y1} fill="#94a3b8" opacity={0.8} pointerEvents="none" />
            if (op.kind === 'saw') return <line key={i} x1={op.xa} y1={op.ya} x2={op.xe} y2={op.ye} stroke="#94a3b8" strokeWidth={op.width} pointerEvents="none" />
            return null
          })}
        {showLabels &&
          spots.map((sp) => (
            <g key={sp.uid} pointerEvents="none">
              <rect
                x={sp.cx - sp.w / 2}
                y={sp.cy - sp.h / 2}
                width={sp.w}
                height={sp.h}
                fill="#ffffff"
                stroke={sp.fits ? '#111827' : '#dc2626'}
                strokeWidth={2.5}
                strokeDasharray={sp.fits ? undefined : '8 5'}
              />
              {sp.rotation === 0 ? (
                <polygon points={`${sp.cx - sp.w / 2},${sp.cy + sp.h / 2} ${sp.cx - sp.w / 2 + 18},${sp.cy + sp.h / 2} ${sp.cx - sp.w / 2},${sp.cy + sp.h / 2 - 18}`} fill="#111827" />
              ) : (
                <polygon points={`${sp.cx - sp.w / 2},${sp.cy - sp.h / 2} ${sp.cx - sp.w / 2},${sp.cy - sp.h / 2 + 18} ${sp.cx - sp.w / 2 + 18},${sp.cy - sp.h / 2}`} fill="#111827" />
              )}
            </g>
          ))}
        {groups && (
          <g pointerEvents="none" data-testid="bridge-groups">
            {groups.map((g, i) => (
              <g key={i}>
                {g.bridges.map((b, k) => (
                  <rect key={k} x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} fill="#7c3aed" />
                ))}
                {[g.outer, ...g.holes].map((ring, k) => (
                  <polygon key={`o${k}`} points={ring.map((q) => `${q.x},${q.y}`).join(' ')} fill="none" stroke="#7c3aed" strokeWidth={4} strokeDasharray="14 6" />
                ))}
              </g>
            ))}
          </g>
        )}
        {cutPaths && (
          <g fill="none" stroke="#c2410c" strokeWidth={5} strokeLinejoin="round" pointerEvents="none" data-testid="cut-plan">
            {cutPaths.map((p, i) => (
              <polyline key={i} points={p.pts.map((q) => `${q.x},${q.y}`).join(' ')} strokeDasharray={p.closed ? undefined : '22 8'} />
            ))}
            {cutPaths.map((p, i) => (
              <circle key={`s${i}`} cx={p.pts[0].x} cy={p.pts[0].y} r={9} fill="#c2410c" />
            ))}
          </g>
        )}
        <g stroke="#dc2626" strokeWidth={4}>
          <line x1={0} y1={0} x2={120} y2={0} />
          <line x1={0} y1={0} x2={0} y2={120} />
        </g>
      </g>
      {s.placements.map((pl) => {
        const inst = instances.get(pl.uid)
        if (!inst) return null
        const spot = spots.find((sp) => sp.uid === pl.uid)
        const cx = showLabels && spot ? spot.cx : pl.x + pl.dx / 2
        const cy = showLabels && spot ? spot.cy : pl.y + pl.dy / 2
        const fs = Math.min(fontBase * 1.4, Math.max(fontBase * 0.7, Math.min(pl.dx, pl.dy) / 3.2))
        return (
          <text key={pl.uid} x={cx} y={s.sheetWidth - cy + fs * 0.35} textAnchor="middle" fontSize={fs} fontWeight={700} fill="#0f172a" pointerEvents="none" fontFamily="Geist Variable, sans-serif">
            {inst.no}
          </text>
        )
      })}
      {(s.remnants ?? []).map((r, i) => (
        <text key={`remt${i}`} x={r.x + r.length / 2} y={s.sheetWidth - (r.y + r.width / 2)} textAnchor="middle" fontSize={fontBase * 0.9} fill="#15803d" fontWeight={600} pointerEvents="none" fontFamily="Geist Variable, sans-serif">
          Offcut {Math.round(r.length)} × {Math.round(r.width)}
        </text>
      ))}
      <text x={130} y={s.sheetWidth + 30} fontSize={fontBase * 0.8} fill="#dc2626" fontFamily="Geist Variable, sans-serif">
        X
      </text>
      <text x={-30} y={s.sheetWidth - 130} fontSize={fontBase * 0.8} fill="#dc2626" fontFamily="Geist Variable, sans-serif">
        Y
      </text>
    </svg>
  )
}
