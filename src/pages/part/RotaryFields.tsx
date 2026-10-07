/**
 * Rotary operation settings (M3.3, 3D-10): the wrapped plane it works on, the strategy, the model,
 * step-over (placeholder, Configure badge), roughing step-down, stock, depth for drawn shapes, and
 * the clearance above the blank the tool lifts to.
 */
import { blankRadius, planeRect } from '@/cam/rotary/frame'
import type { CamOp, CamPart, RotaryOp } from '@/cam/types'
import { NONE, NumField, SelectField, SwitchField } from '@/components/fields'
import { formatLength } from '@/core/units'
import { useStore } from '@/app/store'
import { useOpCfg } from './opConfigure'

const STRATEGIES: { value: RotaryOp['strategy']; label: string }[] = [
  { value: 'along', label: 'Passes along the axis' },
  { value: 'around', label: 'Rings round the axis' },
  { value: 'spiral', label: 'One spiral' },
  { value: 'wrap', label: 'Wrapped shapes (drawn on the plane)' },
]

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-white/10 px-4 py-3">
      <h4 className="mb-2 text-[11px] font-semibold tracking-wider text-stone-400 uppercase">{title}</h4>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">{children}</div>
    </section>
  )
}

export function RotaryFields({ op, part, onChange }: { op: RotaryOp; part: CamPart; onChange: (o: CamOp) => void }) {
  const c = useOpCfg(op, part, onChange)
  const units = useStore((s) => s.data?.settings.units ?? 'mm')
  const setup = part.rotary
  const planes = setup?.planes ?? []
  const plane = planes.find((p) => p.id === op.planeId)
  const lv = (patch: Partial<RotaryOp['levels']>) => onChange({ ...op, levels: { ...op.levels, ...patch } })
  const wrap = op.strategy === 'wrap'
  if (!setup)
    return (
      <Group title="Rotary">
        <p className="col-span-2 text-[11px] text-amber-200">This part has no rotary set-up. Set the axis and the blank on the 3D tab (Rotary), then pick a wrapped plane here.</p>
      </Group>
    )
  const r = plane ? planeRect(plane) : null
  return (
    <>
      <Group title="Rotary">
        <SelectField className="col-span-2" label="Strategy" value={op.strategy} options={STRATEGIES} onChange={(v) => onChange({ ...op, strategy: v })} />
        <SelectField
          className="col-span-2"
          label="Wrapped plane"
          value={op.planeId || NONE}
          options={[{ value: NONE, label: 'Choose a wrapped plane' }, ...planes.map((p) => ({ value: p.id, label: `${p.name} · R ${formatLength(p.radius, units)} · ${p.a0}° to ${p.a1}°` }))]}
          onChange={(v) => onChange({ ...op, planeId: v === NONE ? '' : v })}
        />
        {(!wrap || op.onModel) && (
          <SelectField
            className="col-span-2"
            label="Model"
            value={op.modelId || NONE}
            options={[{ value: NONE, label: 'Every model shown' }, ...(part.models ?? []).map((m) => ({ value: m.id, label: m.name }))]}
            onChange={(v) => onChange({ ...op, modelId: v === NONE ? '' : v })}
          />
        )}
        {!wrap && (
          <>
            <NumField label="Step-over" value={op.stepover} min={0.01} step={0.1} cfg={c('rotaryStepover').cfg} badge={c('rotaryStepover').badge} onChange={(v) => c('rotaryStepover').set({ ...op, stepover: v })} hint={op.strategy === 'along' ? 'Round the axis, on the plane' : op.strategy === 'spiral' ? 'Along the axis per turn' : 'Along the axis'} />
            <NumField label="Roughing step-down" value={op.stepdown} min={0} step={0.5} cfg={op.stepdown > 0 ? c('rotaryStepdown').cfg : undefined} badge={op.stepdown > 0 ? c('rotaryStepdown').badge : undefined} onChange={(v) => (op.stepdown > 0 ? c('rotaryStepdown').set({ ...op, stepdown: v }) : onChange({ ...op, stepdown: v }))} hint="0 = one pass on the model (finishing)" />
            <NumField label="Stock to leave" value={op.stockToLeave} min={0} step={0.1} onChange={(v) => onChange({ ...op, stockToLeave: v })} />
            <NumField label="Tolerance" value={op.tolerance} min={0.001} step={0.005} onChange={(v) => onChange({ ...op, tolerance: v })} />
            {op.strategy !== 'spiral' && (
              <div className="col-span-2">
                <SwitchField label="Both ways (zig-zag)" checked={op.zigzag} onChange={(v) => onChange({ ...op, zigzag: v })} hint={op.strategy === 'around' ? 'Off, all the way round: every ring turns the same way and the next starts a turn on' : 'Off: every pass the same way'} />
              </div>
            )}
          </>
        )}
        {wrap && (
          <>
            <NumField label="Depth" value={op.levels.depth} min={0} step={0.5} onChange={(v) => lv({ depth: v })} hint={op.onModel ? 'Below the model' : 'Below the plane'} />
            <NumField label="Depth per pass" value={op.levels.passDepth} min={0} onChange={(v) => lv({ passDepth: v })} hint="0 = one pass" />
            <div className="col-span-2">
              <SwitchField label="Below the model's surface" checked={!!op.onModel} onChange={(v) => onChange({ ...op, onModel: v })} hint="Off: below the plane's cylinder" />
            </div>
            {!!op.onModel && <NumField label="Stock to leave" value={op.stockToLeave} min={0} step={0.1} onChange={(v) => onChange({ ...op, stockToLeave: v })} />}
          </>
        )}
        <NumField label="Clearance" value={op.levels.rapidZ} min={1} onChange={(v) => lv({ rapidZ: v })} hint="Above the blank, to turn and move along" />
        <NumField label="Safe distance" value={op.levels.safeZ} min={0} onChange={(v) => lv({ safeZ: v })} hint="Above the blank, at start and end" />
        <div className="col-span-2 text-[11px] text-stone-400">
          {plane && r
            ? `${plane.name}: ${formatLength(plane.end - plane.start, units)} along the axis by ${plane.a1 - plane.a0}° (${formatLength(r.y1 - r.y0, units)} unrolled at R ${formatLength(plane.radius, units)}). `
            : 'Pick the wrapped plane: it sets where along and round the axis to work. '}
          The tool stands square to the axis and points at it; between passes it lifts {formatLength(op.levels.rapidZ, units)} clear of the blank ({formatLength(blankRadius(setup.blank), units)} from the axis) before it turns.
          {wrap ? ' Pick shapes drawn inside the plane\'s rectangle; with a saw blade, straight along or round the axis only.' : ''} Simulated on a rotary stock; never written to woodWOP (the N-200 has no rotary axis).
        </div>
      </Group>
    </>
  )
}
