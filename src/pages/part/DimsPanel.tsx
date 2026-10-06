/** Dimensions on the part (CAD-08): what each measures now, the other unit on or off, delete. */
import { Trash2 } from 'lucide-react'
import { dimText, measureDim } from '@/cam/dims'
import type { CamPart } from '@/cam/types'
import { Button } from '@/components/ui/button'
import { LenInput } from '@/components/LenInput'
import type { UnitSystem } from '@/core/types'

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
