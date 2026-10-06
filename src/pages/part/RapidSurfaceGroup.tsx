/** Rapid surface (2D-18): moves between cuts follow a cylinder or a dome instead of the flat safe height. */
import { suggestSurface } from '@/cam/more25d/rapidSurface'
import type { CamOp, CamPart, RapidSurface } from '@/cam/types'
import { NumField, SelectField, SwitchField } from '@/components/fields'
import { Button } from '@/components/ui/button'
import { useStore } from '@/app/store'
import { featuresOf } from '@/core/features'

type Kind = 'flat' | RapidSurface['kind']
const KINDS: { value: Kind; label: string }[] = [
  { value: 'flat', label: 'Flat (safe height)' },
  { value: 'cylinder', label: 'Cylinder' },
  { value: 'sphere', label: 'Dome (sphere)' },
]

export function RapidSurfaceGroup({ op, part, onChange }: { op: CamOp; part: CamPart; onChange: (o: CamOp) => void }) {
  const extras = useStore((st) => featuresOf(st.data?.settings).camExtras)
  const s = op.rapidSurface
  const suggest = (kind: RapidSurface['kind']) => suggestSurface(kind, part.length, part.width, op.levels.safeZ, op.levels.rapidZ)
  const setKind = (k: Kind) => {
    if (k === 'flat') {
      const { rapidSurface: _drop, ...rest } = op
      onChange(rest as CamOp)
    } else onChange({ ...op, rapidSurface: suggest(k) })
  }
  // any value typed counts as checked
  const set = (patch: Partial<RapidSurface>) => s && onChange({ ...op, rapidSurface: { ...s, ...patch, confirmed: true } as RapidSurface })
  // behind the extras switch, but always shown on an operation that already has one
  if (!extras && !s) return null
  return (
    <section className="border-b border-white/10 px-4 py-3" data-testid="rapid-surface">
      <h4 className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-wider text-stone-400 uppercase">
        Moves between cuts
        {s && !s.confirmed && <span className="rounded bg-amber-500/20 px-1.5 py-px text-[10px] font-medium tracking-normal text-amber-200 normal-case">Suggested: check it</span>}
      </h4>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        <SelectField className="col-span-2" label="Rapid surface" value={s?.kind ?? 'flat'} options={KINDS} onChange={(v) => setKind(v as Kind)} />
        {s?.kind === 'cylinder' && (
          <>
            <SelectField
              label="Axis"
              value={s.axis}
              options={[
                { value: 'x', label: 'Along X' },
                { value: 'y', label: 'Along Y' },
              ]}
              onChange={(v) => set({ axis: v as 'x' | 'y' })}
            />
            <NumField label={s.axis === 'x' ? 'Axis at Y' : 'Axis at X'} value={s.centre} onChange={(v) => set({ centre: v })} />
          </>
        )}
        {s?.kind === 'sphere' && (
          <>
            <NumField label="Centre X" value={s.c.x} onChange={(v) => set({ c: { ...s.c, x: v } })} />
            <NumField label="Centre Y" value={s.c.y} onChange={(v) => set({ c: { ...s.c, y: v } })} />
          </>
        )}
        {s && (
          <>
            <NumField label="Centre height" value={Math.round(s.z * 1000) / 1000} onChange={(v) => set({ z: v })} hint="Above face 1 (below it for a big, flat arch)" />
            <NumField label="Radius" value={Math.round(s.r * 1000) / 1000} min={1} onChange={(v) => v > 0 && set({ r: v })} />
            <div className="col-span-2 flex items-center gap-2">
              <SwitchField label="Checked" checked={!!s.confirmed} onChange={(v) => onChange({ ...op, rapidSurface: { ...s, confirmed: v || undefined } as RapidSurface })} />
              <Button size="xs" variant="ghost" onClick={() => onChange({ ...op, rapidSurface: suggest(s.kind) })} title="Arch over the panel from the clearance height at its edges to the safe height over its middle">
                Suggest again
              </Button>
            </div>
            <p className="col-span-2 text-[11px] leading-snug text-stone-500">Never below the clearance height (rapid down to {op.levels.rapidZ} mm). The simulation, the checks and text programs use it; woodWOP programs move between cuts at the machine&apos;s own safety height.</p>
          </>
        )}
      </div>
    </section>
  )
}
