import { NumField, Section } from '@/components/fields'
import { ValueBadges } from '@/components/Configure'
import { useStore } from '@/app/store'
import { CUT_DEFAULT_LABEL, type CutDefaultKey, cutDefaultsOf, machineUnconfirmed } from '@/core/confirm'
import type { MachineProfile } from '@/core/types'

/**
 * The shop's default cutting values for new operations (M2.6e). Changing one confirms it, and every
 * operation still using the old value follows it (and is marked out of date).
 */
export function CutDefaultsSection({ machine }: { machine: MachineProfile }) {
  const setDefault = useStore((s) => s.setCutDefault)
  const d = cutDefaultsOf(machine)
  const items = machineUnconfirmed(machine)
  const badge = (k: CutDefaultKey) => <ValueBadges item={items.find((u) => u.key === `default:${k}`)} />
  const pct = (k: 'pocketStepover' | 'faceStepover' | 'roughStepover' | 'adaptiveWidth', min = 2, max = 95) => (
    <NumField label={CUT_DEFAULT_LABEL[k]} suffix="%" value={Math.round(d[k] * 1000) / 10} min={min} max={max} onChange={(v) => setDefault(k, v / 100)} cfg={`default:${k}`} badge={badge(k)} />
  )
  const mm = (k: 'edgeHeight' | 'edgeReach' | 'betweenStepover' | 'finishStepover' | 'waterlineStepdown' | 'roughStepdown', min = 0.01) => (
    <NumField label={CUT_DEFAULT_LABEL[k]} value={d[k]} min={min} step={0.1} onChange={(v) => setDefault(k, v)} cfg={`default:${k}`} badge={badge(k)} />
  )
  return (
    <Section title="Default cutting values" description="Used by new operations, and by every operation that still has the old value (changing one marks those out of date). PLACEHOLDER until you set or confirm them.">
      <div className="grid grid-cols-2 gap-2">
        {pct('pocketStepover', 5)}
        {pct('faceStepover', 5)}
        {mm('finishStepover')}
        {mm('waterlineStepdown')}
        {mm('roughStepdown', 0.1)}
        {pct('roughStepover', 5)}
        {pct('adaptiveWidth', 2, 60)}
        {mm('betweenStepover')}
        {mm('edgeHeight', 0)}
        {mm('edgeReach')}
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-md" data-cfg="default:corners">
        <div className="col-span-2 flex flex-wrap items-center justify-between gap-1">
          <span className="text-xs font-medium text-muted-foreground">{CUT_DEFAULT_LABEL.corners}</span>
          {badge('corners')}
        </div>
        <NumField label="Corners sharper than" suffix="°" value={d.corners.angle} min={1} max={180} onChange={(v) => setDefault('corners', { ...d.corners, angle: v })} />
        <NumField label="Distance each side" value={d.corners.distance} min={0.1} onChange={(v) => setDefault('corners', { ...d.corners, distance: v })} />
        <NumField label="Steps" suffix="" value={d.corners.steps} min={1} max={20} onChange={(v) => setDefault('corners', { ...d.corners, steps: Math.round(v) })} />
        <NumField label="Feed at the corner" suffix="%" value={d.corners.percent} min={1} max={100} onChange={(v) => setDefault('corners', { ...d.corners, percent: v })} />
      </div>
      <div className="grid grid-cols-3 gap-2 rounded-md" data-cfg="default:zwave">
        <div className="col-span-3 flex flex-wrap items-center justify-between gap-1">
          <span className="text-xs font-medium text-muted-foreground">{CUT_DEFAULT_LABEL.zwave}</span>
          {badge('zwave')}
        </div>
        <NumField label="Shallowest" value={d.zwave.min} min={0} step={0.25} onChange={(v) => setDefault('zwave', { ...d.zwave, min: v })} />
        <NumField label="Deepest" value={d.zwave.max} min={0} step={0.25} onChange={(v) => setDefault('zwave', { ...d.zwave, max: v })} />
        <NumField label="Wave length" value={d.zwave.length} min={0.5} onChange={(v) => setDefault('zwave', { ...d.zwave, length: v })} />
      </div>
    </Section>
  )
}
