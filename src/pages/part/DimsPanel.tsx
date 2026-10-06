/** Dimensions on the part (CAD-08): what each measures now, the other unit on or off, delete. */
import { Trash2 } from 'lucide-react'
import { dimText, measureDim } from '@/cam/dims'
import { brokenAnnotations } from '@/cam/annotate'
import type { Annotation, CamPart } from '@/cam/types'
import { Button } from '@/components/ui/button'
import { LenInput } from '@/components/LenInput'
import type { UnitSystem } from '@/core/types'
import { formatLength } from '@/core/units'

const KIND: Record<string, string> = { aligned: 'Aligned', horizontal: 'Horizontal', vertical: 'Vertical', angular: 'Angle', radius: 'Radius', diameter: 'Diameter', ordinate: 'Ordinate' }

export function DimsPanel({ part, units, onChange }: { part: CamPart; units: UnitSystem; onChange: (p: CamPart) => void }) {
  const dims = part.dims ?? []
  if (!dims.length) return null
  const set = (id: string, patch: object) => onChange({ ...part, dims: dims.map((d) => (d.id === id ? { ...d, ...patch } : d)) })
  const broken = dims.filter((d) => !measureDim(part, d))
  const origin = part.dimOrigin ?? { x: 0, y: 0 }
  return (
    <div className="border-t border-white/10 px-3 py-2 text-xs">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-semibold text-stone-300">Dimensions</span>
        {broken.length > 0 && (
          <Button size="xs" variant="ghost" className="h-5 text-[10px] text-red-300" onClick={() => onChange({ ...part, dims: dims.filter((d) => !broken.includes(d)) })}>
            Remove {broken.length} without their shapes
          </Button>
        )}
      </div>
      <ul className="max-h-40 space-y-0.5 overflow-auto">
        {dims.map((d) => {
          const g = measureDim(part, d)
          return (
            <li key={d.id} className="flex items-center gap-1.5">
              <span className="w-16 shrink-0 text-stone-500">{KIND[d.kind]}</span>
              <span className={g ? 'min-w-0 flex-1 truncate font-mono text-amber-200' : 'min-w-0 flex-1 text-red-300'}>{g ? dimText(d, g, units) : 'shape gone'}</span>
              <label className="flex items-center gap-1 text-[10px] text-stone-400" title="Also show the other unit">
                <input type="checkbox" checked={!!d.alt} onChange={(e) => set(d.id, { alt: e.target.checked || undefined })} /> both
              </label>
              <Button size="icon-xs" variant="ghost" aria-label="Delete dimension" onClick={() => onChange({ ...part, dims: dims.filter((x) => x.id !== d.id) })}>
                <Trash2 />
              </Button>
            </li>
          )
        })}
      </ul>
      {dims.some((d) => d.kind === 'ordinate') && (
        <div className="mt-1 flex items-center gap-1.5 text-stone-400">
          Ordinate origin
          <LenInput label="Origin X" value={origin.x} units={units} onChange={(x) => Number.isFinite(x) && onChange({ ...part, dimOrigin: { ...origin, x } })} />
          <LenInput label="Origin Y" value={origin.y} units={units} onChange={(y) => Number.isFinite(y) && onChange({ ...part, dimOrigin: { ...origin, y } })} />
        </div>
      )}
    </div>
  )
}

/** Annotations on the part (NEW-21): hatching and detail views; change their settings, delete. */
export function AnnotationsPanel({ part, units, onChange }: { part: CamPart; units: UnitSystem; onChange: (p: CamPart) => void }) {
  const notes = part.annotations ?? []
  if (!notes.length) return null
  const set = (id: string, patch: Partial<Annotation>) => onChange({ ...part, annotations: notes.map((a) => (a.id === id ? ({ ...a, ...patch } as Annotation) : a)) })
  const broken = brokenAnnotations(part)
  const num = 'w-12 rounded border border-white/10 bg-black/30 px-1 text-[11px] text-stone-100 tabular-nums'
  return (
    <div className="border-t border-white/10 px-3 py-2 text-xs" data-testid="annotations-panel">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-semibold text-stone-300">Annotations</span>
        {broken.length > 0 && (
          <Button size="xs" variant="ghost" className="h-5 text-[10px] text-red-300" onClick={() => onChange({ ...part, annotations: notes.filter((a) => !broken.includes(a)) })}>
            Remove {broken.length} without their shapes
          </Button>
        )}
      </div>
      <ul className="max-h-40 space-y-0.5 overflow-auto">
        {notes.map((a) => (
          <li key={a.id} className="flex items-center gap-1.5 text-stone-400">
            {a.k === 'hatch' ? (
              <>
                <span className="w-16 shrink-0 text-stone-500">Hatch</span>
                <input aria-label="Hatch angle" className={num} type="number" value={a.angle} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && set(a.id, { angle: e.target.valueAsNumber })} />°
                <LenInput label="Hatch spacing" value={a.spacing} units={units} onChange={(v) => Number.isFinite(v) && v > 0 && set(a.id, { spacing: v })} />
                <label className="flex items-center gap-1 text-[10px]">
                  <input type="checkbox" checked={!!a.cross} onChange={(e) => set(a.id, { cross: e.target.checked || undefined })} /> crossed
                </label>
                {broken.includes(a) && <span className="text-red-300">shapes gone</span>}
              </>
            ) : (
              <>
                <span className="w-16 shrink-0 text-stone-500">Detail {a.label}</span>
                <input aria-label="Detail magnification" className={num} type="number" step={0.5} min={0.01} value={a.scale} onChange={(e) => e.target.valueAsNumber > 0 && set(a.id, { scale: e.target.valueAsNumber })} />×
                <span className="min-w-0 flex-1 truncate">r {formatLength(a.r, units)}</span>
              </>
            )}
            <span className="flex-1" />
            <Button size="icon-xs" variant="ghost" aria-label="Delete annotation" onClick={() => onChange({ ...part, annotations: notes.filter((x) => x.id !== a.id) })}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
