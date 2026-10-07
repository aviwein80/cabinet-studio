import { NONE, NumField, SelectField, TextField } from '@/components/fields'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { MachineProfile, Tool, ToolShape } from '@/core/types'
import { ValueBadges } from '@/components/Configure'
import { aggregateItem, holderItem as holderUnconfirmed, toolUnconfirmed, type ToolPart } from '@/core/confirm'
import { effectiveGauge, effectiveHolder, usesHolder } from '@/core/machineModel'
import { HolderPreview } from './HoldersSection'
import { formText, parseFormText } from '@/core/toolData'
import { cuttingOutline, outlinePoints, toolForm, toolFormProblems } from '@/cam/tools/form'
import { useState } from 'react'
import type { FormPoint } from '@/core/types'

/** A form tool's outline typed as "height radius [arc]; ..." (mm, from the tip up). */
function FormOutlineField({ tool, onChange }: { tool: Tool; onChange: (form: FormPoint[]) => void }) {
  const [text, setText] = useState(formText(tool.form ?? []))
  const [error, setError] = useState<string | null>(null)
  return (
    <TextField
      label="Outline (height radius [arc radius]; ... from the tip up, mm)"
      value={text}
      onChange={(v) => {
        setText(v)
        const r = parseFormText(v)
        if ('error' in r) setError(r.error)
        else {
          setError(null)
          onChange(r.value)
        }
      }}
      hint={error ?? 'Up to the flute length it cuts; above it is the neck or shank the collision checks use. An arc radius bulges outwards (negative: inwards).'}
    />
  )
}

/** The barrel or form tool's outline drawn to scale, the flute length marked. */
function OutlinePreview({ tool }: { tool: Tool }) {
  const problems = toolFormProblems(tool)
  const f = toolForm(tool)
  if (problems.length || !f) return <p className="text-[11px] text-red-600">{problems[0] ?? 'The outline is not complete.'}</p>
  const pts = outlinePoints(f)
  const cut = cuttingOutline(tool)
  const H = Math.max(...pts.map((p) => p.h), tool.fluteLength ?? tool.maxDepth, 1)
  const R = Math.max(...pts.map((p) => p.r), (tool.shankDiameter ?? 0) / 2, 1)
  const s = 120 / Math.max(H, 2 * R)
  const W = 2 * R * s + 20
  const path = [...pts.map((p) => [R * s + 10 + p.r * s, 130 - p.h * s]), ...[...pts].reverse().map((p) => [R * s + 10 - p.r * s, 130 - p.h * s])].map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const fy = 130 - (tool.fluteLength ?? tool.maxDepth) * s
  return (
    <div className="flex items-center gap-3 rounded-md border p-2 text-[11px] text-muted-foreground">
      <svg width={W} height={140} className="shrink-0 rounded bg-stone-900">
        <path d={path + ' Z'} fill="#e7e5e4" fillOpacity={0.85} stroke="#a8a29e" strokeWidth={0.8} />
        <line x1={4} x2={W - 4} y1={fy} y2={fy} stroke="#f59e0b" strokeDasharray="3 3" strokeWidth={0.8} />
      </svg>
      <div className="min-w-0">
        <div className="font-medium text-foreground">{tool.shape === 'barrel' ? 'Barrel cutter' : 'Form tool'} outline</div>
        <div>Widest Ø{(2 * Math.max(...(cut?.outline ?? pts).map((p) => p.r))).toFixed(2)} mm in its flutes; dashed: flute length. The simulator, the stocks and the collision checks use this outline.</div>
      </div>
    </div>
  )
}

const SHAPES: { value: ToolShape; label: string }[] = [
  { value: 'flat', label: 'Flat end' },
  { value: 'ball', label: 'Ball-nose' },
  { value: 'bull', label: 'Bull-nose (corner radius)' },
  { value: 'v', label: 'V / engraving' },
  { value: 'drill', label: 'Drill' },
  { value: 'saw', label: 'Saw blade' },
  { value: 'profile', label: 'Profile cutter' },
  { value: 'lollipop', label: 'Lollipop (ball on a narrower neck)' },
  { value: 'thread', label: 'Thread mill (single 60° tooth on a neck)' },
  { value: 'barrel', label: 'Barrel (side arc and rounded tip, 5-axis)' },
  { value: 'form', label: 'Form tool (outline typed in, 5-axis)' },
]

/** Cutting shape and the lengths collision checks need: shank, flutes, stick-out and holder. */
/** `update(fn, confirm)`: change the tool, and mark that value confirmed (a real value was typed). */
export function ToolDialog({ tool, machine, onClose, update }: { tool: Tool; machine: MachineProfile; onClose: () => void; update: (fn: (t: Tool) => void, confirm?: string) => void }) {
  const holders = machine.holders ?? []
  const opt = (v: number | undefined) => (Number.isFinite(v) ? (v as number) : 0)
  const partOf = { shankDiameter: 'lengths', fluteLength: 'lengths', gaugeLength: 'lengths', kerf: 'blade', bladeDiameter: 'blade', rpm: 'feeds', feed: 'feeds', plungeFeed: 'feeds', stepdown: 'feeds' } as Record<string, ToolPart>
  const set = (k: 'shankDiameter' | 'fluteLength' | 'gaugeLength' | 'cornerRadius' | 'angle' | 'kerf' | 'bladeDiameter' | 'rpm' | 'feed' | 'plungeFeed' | 'stepdown') => (v: number) =>
    update(
      (t) => {
        if (v > 0) t[k] = v
        else delete t[k]
        if (k === 'feed' || k === 'rpm') t.feedMode = t.feedMode ?? 'fixed'
      },
      partOf[k] && v > 0 ? `tool:${tool.id}:${partOf[k]}` : undefined,
    )
  const items = toolUnconfirmed(machine, tool)
  const u = (part: ToolPart) => items.find((x) => x.target.kind === 'tool' && x.target.part === part)
  const holderItem = holderUnconfirmed(machine, tool) ?? undefined
  const aggItem = tool.aggregateId ? (aggregateItem(machine, tool.aggregateId) ?? undefined) : undefined
  const eff = effectiveHolder(machine, tool)
  const gauge = effectiveGauge(machine, tool)
  const defaultHolder = holders.find((h) => h.id === machine.defaultHolderId)
  const confirmBtn = (key: string) => () => update(() => {}, key)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            T{tool.number} {tool.name}
          </DialogTitle>
          <DialogDescription>Shape and lengths for 3D toolpaths and collision checks. 0 = not given. These numbers come from the tool and holder in the machine, not from this program.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <TextField label="Description" value={tool.name} onChange={(v) => update((t) => (t.name = v))} />
          {u('data') && (
            <div className="flex items-center justify-end">
              <ValueBadges item={u('data')} onConfirm={confirmBtn(`tool:${tool.id}:data`)} />
            </div>
          )}
          <div className="grid grid-cols-3 gap-2 rounded-md" data-cfg={`tool:${tool.id}:data`}>
            <NumField label="Tool no." suffix="" value={tool.number} min={1} onChange={(v) => update((t) => (t.number = Math.round(v)), `tool:${tool.id}:data`)} />
            <NumField label="Diameter" value={tool.diameter} min={0.1} onChange={(v) => update((t) => (t.diameter = v), `tool:${tool.id}:data`)} />
            <NumField label="Max depth" value={tool.maxDepth} min={0} onChange={(v) => update((t) => (t.maxDepth = v), `tool:${tool.id}:data`)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <SelectField label="Cutting shape" value={tool.shape ?? 'flat'} options={SHAPES} onChange={(v) => update((t) => (t.shape = v))} />
            {tool.shape === 'bull' && <NumField label="Corner radius" value={opt(tool.cornerRadius)} min={0} max={tool.diameter / 2} step={0.5} onChange={set('cornerRadius')} />}
            {tool.shape === 'v' && <NumField label="Included angle" suffix="°" value={opt(tool.angle)} min={0} max={180} onChange={set('angle')} />}
            {tool.shape === 'barrel' && <NumField label="Tip radius" value={opt(tool.cornerRadius)} min={0} max={tool.diameter / 2} step={0.5} onChange={set('cornerRadius')} />}
            {tool.shape === 'barrel' && <NumField label="Side arc radius" value={opt(tool.barrelRadius)} min={0} step={5} onChange={(v) => update((t) => (v > 0 ? (t.barrelRadius = v) : delete t.barrelRadius), v > 0 ? `tool:${tool.id}:data` : undefined)} hint="Larger than half the diameter" />}
          </div>
          {tool.shape === 'form' && <FormOutlineField tool={tool} onChange={(form) => update((t) => (t.form = form), `tool:${tool.id}:data`)} />}
          {(tool.shape === 'barrel' || tool.shape === 'form') && <OutlinePreview tool={tool} />}
          {tool.type === 'saw' && (
            <div className="grid grid-cols-2 gap-2">
              <NumField label="Kerf" value={opt(tool.kerf)} min={0} step={0.1} onChange={set('kerf')} hint="Width of the cut; 0 = 4 mm" />
              <NumField
                label="Blade Ø"
                value={opt(tool.bladeDiameter)}
                min={0}
                onChange={set('bladeDiameter')}
                cfg={`tool:${tool.id}:blade`}
                badge={<ValueBadges item={u('blade')} onConfirm={confirmBtn(`tool:${tool.id}:blade`)} />}
                hint={tool.bladeDiameter ? 'For the run-out of saw cuts' : 'For the run-out of saw cuts; 0 = a PLACEHOLDER 200 mm blade'}
              />
            </div>
          )}
          {u('lengths') && (
            <div className="flex items-center justify-end">
              <ValueBadges item={u('lengths')} onConfirm={confirmBtn(`tool:${tool.id}:lengths`)} />
            </div>
          )}
          <div className="grid grid-cols-3 gap-2 rounded-md" data-cfg={`tool:${tool.id}:lengths`}>
            <NumField
              label={tool.shape === 'lollipop' || tool.shape === 'thread' ? 'Neck Ø' : 'Shank Ø'}
              value={opt(tool.shankDiameter)}
              min={0}
              onChange={set('shankDiameter')}
              hint={tool.shape === 'lollipop' ? 'Narrower than the ball: how far the ball reaches under an overhang' : tool.shape === 'thread' ? 'Behind the tooth: it must pass the thread without touching it' : 'Above the flutes'}
            />
            <NumField label="Flute length" value={opt(tool.fluteLength)} min={0} onChange={set('fluteLength')} hint="Cutting length" />
            <NumField label="Stick-out" value={opt(tool.gaugeLength)} min={0} onChange={set('gaugeLength')} hint="Tip to holder face" />
          </div>
          {(tool.type === 'router' || tool.type === 'saw') && (
            <div className="rounded-md" data-cfg={`tool:${tool.id}:feeds`}>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
                <span className="text-xs font-medium text-muted-foreground">Feeds, speed and step-down (when the material has no row)</span>
                <ValueBadges item={u('feeds')} onConfirm={confirmBtn(`tool:${tool.id}:feeds`)} />
              </div>
              <div className="grid grid-cols-4 gap-2">
                <NumField label="Spindle" suffix="rpm" value={opt(tool.rpm)} min={0} step={500} onChange={set('rpm')} />
                <NumField label="Feed" suffix="mm/min" value={opt(tool.feed)} min={0} step={100} onChange={set('feed')} />
                <NumField label="Plunge" suffix="mm/min" value={opt(tool.plungeFeed)} min={0} step={100} onChange={set('plungeFeed')} />
                <NumField label="Step-down" value={opt(tool.stepdown)} min={0} onChange={set('stepdown')} />
              </div>
            </div>
          )}
          {usesHolder(tool) && (
            <SelectField
              label="Holder"
              value={tool.holderId ?? NONE}
              options={[{ value: NONE, label: defaultHolder ? `Shop default (${defaultHolder.name})` : 'None (no default holder set)' }, ...holders.map((h) => ({ value: h.id, label: `${h.name}${h.placeholder && !/placeholder/i.test(h.name) ? ' (placeholder)' : ''}` }))]}
              onChange={(v) => update((t) => (v !== NONE ? (t.holderId = v) : delete t.holderId))}
              cfg={eff ? `holder:${eff.id}` : undefined}
              badge={<ValueBadges item={holderItem} onConfirm={holderItem ? confirmBtn(holderItem.key) : undefined} />}
              hint={gauge.assumed ? `No stick-out given: the flute length (${gauge.gauge} mm) is assumed, the shortest possible, so the collision check errs safe.` : undefined}
            />
          )}
          {tool.type === 'router' && (machine.aggregates?.length ?? 0) > 0 && (
            <SelectField
              label="Aggregate"
              value={tool.aggregateId ?? NONE}
              options={[{ value: NONE, label: 'None (in the main spindle)' }, ...(machine.aggregates ?? []).map((a) => ({ value: a.id, label: a.name }))]}
              onChange={(v) => update((t) => (v !== NONE ? (t.aggregateId = v) : delete t.aggregateId))}
              cfg={tool.aggregateId ? `aggregate:${tool.aggregateId}` : undefined}
              badge={<ValueBadges item={aggItem} onConfirm={aggItem ? confirmBtn(aggItem.key) : undefined} />}
              hint="For edge work: the stick-out is measured from the aggregate's face. Assigning one does not fit an aggregate on the machine."
            />
          )}
          {eff && (
            <div className="flex items-center gap-3 rounded-md border p-2 text-[11px] text-muted-foreground">
              <HolderPreview holder={eff} tool={tool} gauge={gauge.gauge} size={110} />
              <div className="min-w-0">
                <div className="font-medium text-foreground">
                  {eff.name} {eff.placeholder && <Badge variant="outline">placeholder</Badge>}
                </div>
                <div>Stick-out {Number.isFinite(gauge.gauge) ? `${gauge.gauge} mm${gauge.assumed ? ' (assumed)' : ''}` : 'not given'}. Edit outlines under Holders on this page.</div>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
