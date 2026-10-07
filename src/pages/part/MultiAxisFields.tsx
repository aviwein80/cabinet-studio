/**
 * 5-axis operation settings (M3.5, 5AX-02, 5AX-03, NEW-26): the engine that makes the toolpath (the
 * shop's licensed engine, none: "not licensed"; or the built-in preview, simulation only), the
 * strategy, the model and curves, the tool axis, passes (placeholders with Configure badges), the
 * direction of cut, the head flip and the gouge check.
 */
import type { CamOp, CamPart, MultiAxisOp, ToolAxisControl } from '@/cam/types'
import { Button } from '@/components/ui/button'
import { NONE, NumField, SelectField, SwitchField } from '@/components/fields'
import { useOpCfg } from './opConfigure'

const STRATEGIES: { value: MultiAxisOp['strategy']; label: string }[] = [
  { value: 'curve', label: 'Along 3D curves or solid edges' },
  { value: 'swarf', label: 'Swarf: the side of the tool along a wall' },
  { value: 'surface', label: 'Surface finishing on a model' },
  { value: 'rough', label: 'Multi-axis roughing (licensed engine only)' },
]

const AXIS_MODES: { value: ToolAxisControl['mode']; label: string }[] = [
  { value: 'surface-normal', label: 'Along the surface normal (lead and tilt)' },
  { value: 'curve-normal', label: 'Square to the curve (lead and tilt)' },
  { value: 'fixed', label: 'Fixed tilt' },
  { value: 'through-point', label: 'Through a point' },
  { value: 'away-from-point', label: 'Away from a point' },
  { value: 'through-line', label: 'Through a line' },
  { value: 'away-from-line', label: 'Away from a line' },
  { value: 'guide', label: 'Towards a guide curve' },
  { value: 'vertical', label: 'Straight up (3-axis)' },
]

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-white/10 px-4 py-3">
      <h4 className="mb-2 text-[11px] font-semibold tracking-wider text-stone-400 uppercase">{title}</h4>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">{children}</div>
    </section>
  )
}

export function MultiAxisFields({ op, part, sel, onChange }: { op: MultiAxisOp; part: CamPart; sel: string[]; onChange: (o: CamOp) => void }) {
  const c = useOpCfg(op, part, onChange)
  const ax = (patch: Partial<ToolAxisControl>) => onChange({ ...op, axis: { ...op.axis, ...patch } })
  const lv = (patch: Partial<MultiAxisOp['levels']>) => onChange({ ...op, levels: { ...op.levels, ...patch } })
  const curves = op.strategy === 'curve' || op.strategy === 'swarf'
  const m = op.axis.mode
  const lean = m === 'surface-normal' || m === 'curve-normal'
  const pointed = m === 'through-point' || m === 'away-from-point' || m === 'through-line' || m === 'away-from-line'
  const lined = m === 'through-line' || m === 'away-from-line'
  const tiltCfg = m !== 'vertical' ? c('multiAxisMaxTilt') : null
  const turnCfg = op.strategy !== 'swarf' ? c('multiAxisMaxTurn') : null
  return (
    <>
      <Group title="5-axis engine">
        <SelectField
          className="col-span-2"
          label="Engine"
          value={op.engine === 'preview' ? 'preview' : NONE}
          options={[
            { value: NONE, label: 'The shop\'s licensed engine (none installed: not licensed)' },
            { value: 'preview', label: 'Built-in preview (for the simulator only)' },
          ]}
          onChange={(v) => onChange({ ...op, engine: v === NONE ? '' : v })}
        />
        <p className="col-span-2 text-[11px] text-stone-400">
          {op.engine === 'preview'
            ? 'The preview engine makes simple toolpaths so the set-up can be simulated: no collision avoidance for the shaft and holder, no real axis optimisation, no roughing. Its toolpaths are never written to any machine.'
            : 'Simultaneous 5-axis toolpaths come from a licensed 5-axis engine. None is installed (an owner decision: nothing is bought or downloaded without a written OK), so this operation answers "not licensed".'}
        </p>
      </Group>
      <Group title="5-axis machining">
        <SelectField className="col-span-2" label="Strategy" value={op.strategy} options={STRATEGIES} onChange={(v) => onChange({ ...op, strategy: v })} />
        <SelectField
          className="col-span-2"
          label={curves ? 'Model (gouge check)' : 'Model'}
          value={op.modelId || NONE}
          options={[{ value: NONE, label: curves ? 'None' : 'Choose a model' }, ...(part.models ?? []).map((x) => ({ value: x.id, label: x.name }))]}
          onChange={(v) => onChange({ ...op, modelId: v === NONE ? '' : v })}
        />
        <p className="col-span-2 text-[11px] text-stone-400">
          {op.strategy === 'curve' ? 'The shapes picked are the curves (3D curves, solid edges, or shapes on face 1).' : op.strategy === 'swarf' ? 'The shapes picked are the bottom curves of the walls; pick a top curve for each.' : 'The closed shapes picked bound the cut (none: the model\'s footprint).'}
        </p>
        {op.strategy === 'swarf' && (
          <>
            <div className="col-span-2 flex flex-wrap items-center gap-2 text-[11px] text-stone-300">
              <span>{op.top?.length ?? 0} top curve(s)</span>
              <Button size="sm" variant="outline" className="h-6 border-white/15 bg-transparent px-2 text-[11px]" disabled={!sel.length} onClick={() => onChange({ ...op, top: [...sel] })}>
                Use selection as top curves
              </Button>
            </div>
            <SelectField label="Tool on the wall's" value={op.side ?? 'left'} options={[{ value: 'left', label: 'Left (seen along the cut)' }, { value: 'right', label: 'Right (seen along the cut)' }]} onChange={(v) => onChange({ ...op, side: v })} />
          </>
        )}
        {curves && <NumField label={op.strategy === 'swarf' ? 'Below the bottom curve' : 'Depth below the curve'} value={op.levels.depth} min={0} step={0.1} onChange={(v) => lv({ depth: v })} hint="Along the tool" />}
        {!curves && <NumField label="Step-over" value={op.stepover} min={0.01} step={0.1} cfg={c('multiAxisStepover').cfg} badge={c('multiAxisStepover').badge} onChange={(v) => c('multiAxisStepover').set({ ...op, stepover: v })} />}
        {op.strategy === 'rough' && <NumField label="Step-down" value={op.stepdown} min={0.1} step={0.5} cfg={c('multiAxisStepdown').cfg} badge={c('multiAxisStepdown').badge} onChange={(v) => c('multiAxisStepdown').set({ ...op, stepdown: v })} />}
        <NumField label="Stock to leave" value={op.stockToLeave} min={0} step={0.1} onChange={(v) => onChange({ ...op, stockToLeave: v })} />
        <NumField label="Tolerance" value={op.tolerance} min={0.001} step={0.005} onChange={(v) => onChange({ ...op, tolerance: v })} />
      </Group>
      <Group title="Tool axis">
        <SelectField className="col-span-2" label="Tool axis" value={m} options={AXIS_MODES} onChange={(v) => ax({ mode: v })} />
        {lean && (
          <>
            <NumField label="Lead (along the cut)" suffix="°" value={op.axis.lead} min={-89} max={89} onChange={(v) => ax({ lead: v })} />
            <NumField label="Tilt (to the left)" suffix="°" value={op.axis.tilt} min={-89} max={89} onChange={(v) => ax({ tilt: v })} />
          </>
        )}
        {m === 'fixed' && (
          <>
            <NumField label="Tilt from vertical" suffix="°" value={op.axis.tilt} min={0} max={180} onChange={(v) => ax({ tilt: v })} />
            <NumField label="Leaning towards" suffix="°" value={op.axis.toward} onChange={(v) => ax({ toward: v })} hint="Degrees from +X" />
          </>
        )}
        {pointed && (
          <div className="col-span-2 grid grid-cols-3 gap-2">
            <NumField label={lined ? 'Line through X' : 'Point X'} value={op.axis.point.x} onChange={(v) => ax({ point: { ...op.axis.point, x: v } })} />
            <NumField label="Y" value={op.axis.point.y} onChange={(v) => ax({ point: { ...op.axis.point, y: v } })} />
            <NumField label="Z" value={op.axis.point.z} onChange={(v) => ax({ point: { ...op.axis.point, z: v } })} />
            {lined && (
              <>
                <NumField label="Along X" suffix="" step={0.1} value={op.axis.dir.x} onChange={(v) => ax({ dir: { ...op.axis.dir, x: v } })} />
                <NumField label="Along Y" suffix="" step={0.1} value={op.axis.dir.y} onChange={(v) => ax({ dir: { ...op.axis.dir, y: v } })} />
                <NumField label="Along Z" suffix="" step={0.1} value={op.axis.dir.z} onChange={(v) => ax({ dir: { ...op.axis.dir, z: v } })} />
              </>
            )}
          </div>
        )}
        {m === 'guide' && op.strategy !== 'swarf' && (
          <div className="col-span-2 flex flex-wrap items-center gap-2 text-[11px] text-stone-300">
            <span>{op.axis.guide ? 'Guide curve picked' : 'No guide curve'}</span>
            <Button size="sm" variant="outline" className="h-6 border-white/15 bg-transparent px-2 text-[11px]" disabled={sel.length !== 1} onClick={() => ax({ guide: sel[0] })}>
              Use the selected shape
            </Button>
          </div>
        )}
        {m === 'guide' && op.strategy === 'swarf' && <p className="col-span-2 text-[11px] text-stone-400">Swarf: the tool runs along the line from each bottom curve to its top curve.</p>}
        {tiltCfg && <NumField label="Largest tilt" suffix="°" value={op.axis.maxTilt} min={0} max={180} cfg={tiltCfg.cfg} badge={tiltCfg.badge} onChange={(v) => tiltCfg.set({ ...op, axis: { ...op.axis, maxTilt: v } })} hint="From vertical" />}
        {turnCfg && <NumField label="Axis smoothing" suffix="°/mm" step={0.5} value={op.maxTurn} min={0} cfg={turnCfg.cfg} badge={turnCfg.badge} onChange={(v) => turnCfg.set({ ...op, maxTurn: v })} hint="Largest turn of the axis per mm; 0 = off" />}
      </Group>
      <Group title="Direction, head flip, checks">
        <SelectField label="Cut" value={op.direction} options={[{ value: 'forward', label: 'As made' }, { value: 'reversed', label: 'Reversed' }, { value: 'both', label: 'There and back' }]} onChange={(v) => onChange({ ...op, direction: v })} />
        <SelectField label="Head flip" value={op.headFlip} options={[{ value: 'auto', label: 'Whichever fits the travel' }, { value: 'usual', label: 'Usual solution' }, { value: 'other', label: 'Other solution (turned 180°)' }]} onChange={(v) => onChange({ ...op, headFlip: v })} />
        <div className="col-span-2">
          <SwitchField label="Gouge check against the model" checked={op.gougeCheck} onChange={(v) => onChange({ ...op, gougeCheck: v })} hint="Our own check, whatever the engine says: exact for ball-nose tools." />
        </div>
        <NumField label="Safe height" value={op.levels.safeZ} min={0} onChange={(v) => lv({ safeZ: v })} />
        <NumField label="Clearance along the tool" value={op.levels.rapidZ} min={0.5} onChange={(v) => lv({ rapidZ: v })} />
        <p className="col-span-2 text-[11px] text-stone-400">Simulated with the tool tilted on every move. Never written to woodWOP (the N-200 has three axes); only a script post for a machine model with simultaneous 5-axis can write a licensed engine's toolpath.</p>
      </Group>
    </>
  )
}
