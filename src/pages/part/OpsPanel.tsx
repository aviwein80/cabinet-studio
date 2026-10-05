import { ArrowDown, ArrowUp, CheckCheck, Copy, Eye, EyeOff, Plus, Trash2, TriangleAlert, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { nanoid } from 'nanoid'
import { opInputHash, opState, partOutline, REST_SOURCE_KINDS, type OpState } from '@/cam/doc'
import { DEFAULT_ADAPTIVE, defaultOp, OP_LABEL, orderByTool } from '@/cam/ops'
import { applyRules, recipesOf, ruleSetsOf } from '@/cam/rules'
import { inBackground, OPS_3D, type Toolpath } from '@/cam/toolpath'
import type { CamOp, CamOpKind, CamPart, FaceId, Surface3D } from '@/cam/types'
import { NONE, NumField, SelectField, SwitchField, TextField } from '@/components/fields'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { featuresOf } from '@/core/features'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { MachineProfile } from '@/core/types'
import { formatLength } from '@/core/units'
import { cn } from '@/lib/utils'
import { useStore } from '@/app/store'

const STATE_STYLE: Record<OpState, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'bg-sky-500/15 text-sky-300' },
  current: { label: 'Up to date', cls: 'bg-emerald-500/15 text-emerald-300' },
  stale: { label: 'Geometry changed', cls: 'bg-amber-500/20 text-amber-300' },
  broken: { label: 'Missing geometry', cls: 'bg-red-500/20 text-red-300' },
}

const ADDABLE: CamOpKind[] = ['profile', 'pocket', 'drill', 'engrave', 'vcarve', 'saw', 'sweep', 'code']

export function OpsPanel({
  part,
  machine,
  toolpaths,
  sel,
  selectedOp,
  setSelectedOp,
  hiddenOps,
  toggleHidden,
  onChange,
  busy,
}: {
  part: CamPart
  machine: MachineProfile
  toolpaths: Toolpath[]
  sel: string[]
  selectedOp: string | null
  setSelectedOp: (id: string | null) => void
  hiddenOps: Set<string>
  toggleHidden: (id: string) => void
  onChange: (p: CamPart) => void
  /** Progress of 3D toolpaths being calculated in the background. */
  busy?: Map<string, { fraction: number; note?: string }>
}) {
  const units = useStore((s) => s.data?.settings.units ?? 'mm')
  const lib = useStore((s) => s.data?.library)
  const rulesOn = useStore((s) => featuresOf(s.data?.settings).camRules)
  const on3d = useStore((s) => featuresOf(s.data?.settings).cam3d) && !!part.models?.length
  const runRules = (setId: string) => {
    if (!lib) return
    const set = ruleSetsOf(lib).find((x) => x.id === setId)
    if (!set) return
    const r = applyRules(part, set, recipesOf(lib))
    onChange(r.part)
    const made = r.part.ops.filter((o) => o.auto).length
    const left = r.unmatched.map((u) => u.layer)
    toast.success(`${made} operation${made === 1 ? '' : 's'} from “${set.name}”`, { description: left.length ? `No rule for: ${left.join(', ')}` : 'Every machinable layer matched a rule.' })
  }
  const tpOf = (id: string) => toolpaths.find((t) => t.opId === id)
  const stateOf = (op: CamOp) => opState(op, part, tpOf(op.id)?.tool ?? null, machine)
  const setOps = (ops: CamOp[]) => onChange({ ...part, ops, updatedAt: new Date().toISOString() })
  const accept = (ids: string[]) => setOps(part.ops.map((o) => (ids.includes(o.id) ? { ...o, builtHash: opInputHash(o, part, tpOf(o.id)?.tool ?? null, machine) } : o)))

  const add = (kind: CamOpKind, extra: Partial<CamOp> = {}) => {
    let geometry = sel
    if (!geometry.length && (kind === 'profile' || kind === 'drill')) {
      const outline = partOutline(part).entity
      geometry = kind === 'profile' ? (outline ? [outline.id] : []) : part.entities.filter((e) => e.g.t === 'circle' || e.g.t === 'point').map((e) => e.id)
    }
    let op = defaultOp(kind, kind === 'code' ? [] : geometry, extra)
    if (op.kind === 'finish3d' || op.kind === 'rough3d') {
      // boundary: the selected closed shapes (none = the whole model); projection: every selected
      // shape is projected. First model on the part.
      const closed = sel.filter((id) => part.entities.some((e) => e.id === id && (e.g.t === 'circle' || (e.g.t === 'contour' && e.g.c.closed))))
      op = { ...op, geometry: op.kind === 'finish3d' && op.strategy === 'projection' ? sel : closed, surface: { ...op.surface, modelId: part.models?.[0]?.id ?? '' } }
    }
    setOps([...part.ops, op])
    setSelectedOp(op.id)
  }
  const move = (i: number, d: number) => {
    const ops = [...part.ops]
    const [o] = ops.splice(i, 1)
    ops.splice(Math.max(0, Math.min(ops.length, i + d)), 0, o)
    setOps(ops)
  }
  const stale = part.ops.filter((o) => stateOf(o) === 'stale' || stateOf(o) === 'new')
  const current = part.ops.find((o) => o.id === selectedOp)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="h-7 gap-1 bg-amber-500 text-stone-900 hover:bg-amber-400">
              <Plus className="size-3.5" /> Add operation
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {ADDABLE.map((k) => (
              <DropdownMenuItem key={k} onSelect={() => add(k)}>
                {OP_LABEL[k]}
              </DropdownMenuItem>
            ))}
            {on3d && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => add('rough3d')}>{OP_LABEL.rough3d}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => add('finish3d')}>{OP_LABEL.finish3d} (parallel)</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => add('finish3d', { strategy: 'waterline' } as Partial<CamOp>)}>{OP_LABEL.finish3d} (waterline)</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => add('finish3d', { strategy: 'projection' } as Partial<CamOp>)}>{OP_LABEL.finish3d} (projection)</DropdownMenuItem>
              </>
            )}
            {rulesOn && lib && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[11px] text-muted-foreground">From layer names</DropdownMenuLabel>
                {ruleSetsOf(lib).map((rs) => (
                  <DropdownMenuItem key={rs.id} onSelect={() => runRules(rs.id)}>
                    <Wand2 /> Apply “{rs.name}”
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="text-[11px] text-stone-400">{sel.length ? `${sel.length} selected` : 'Uses the outline / all holes when nothing is selected'}</span>
        {part.ops.length > 1 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[11px] text-stone-300 hover:bg-white/5"
            onClick={() => setOps(orderByTool(part.ops, (o) => tpOf(o.id)?.tool ?? null, machine.tools.map((t) => t.number)))}
            title="Group operations by tool, in tool-table order, to save tool changes"
          >
            Sort by tool
          </Button>
        )}
        {stale.length > 0 && (
          <Button size="sm" variant="ghost" className="ml-auto h-7 gap-1 text-[11px] text-amber-300 hover:bg-white/5 hover:text-amber-200" onClick={() => accept(stale.map((o) => o.id))}>
            <CheckCheck className="size-3.5" /> Accept all
          </Button>
        )}
      </div>
      <div className="max-h-[40%] shrink-0 overflow-auto border-b border-white/10">
        {part.ops.length === 0 && <div className="px-3 py-6 text-center text-xs text-stone-400">No operations yet. Select geometry and add a profile, pocket or drilling operation.</div>}
        {part.ops.map((op, i) => {
          const st = stateOf(op)
          const tp = tpOf(op.id)
          return (
            <div
              key={op.id}
              onClick={() => setSelectedOp(op.id)}
              className={cn('group flex cursor-pointer items-center gap-2 border-b border-white/5 px-3 py-1.5 text-xs', selectedOp === op.id ? 'bg-white/10' : 'hover:bg-white/5', !op.enabled && 'opacity-50')}
            >
              <span className="w-4 text-right font-mono text-[10px] text-stone-500">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-stone-100">{op.name}</div>
                <div className="truncate text-[10px] text-stone-400">
                  {tp?.tool ? `T${tp.tool.number} ${tp.tool.name}` : op.kind === 'drill' ? 'Drill per hole' : op.kind === 'code' ? 'Note' : 'No tool'} ·{' '}
                  {inBackground(op, part) && busy?.get(op.id)
                    ? `calculating ${Math.round(busy.get(op.id)!.fraction * 100)} %`
                    : op.kind === 'finish3d'
                      ? op.strategy === 'waterline'
                        ? `3D waterline, every ${formatLength(op.stepdown ?? 1, units)} down`
                        : op.strategy === 'projection'
                          ? `3D projection, ${op.levels.depth > 0 ? `${formatLength(op.levels.depth, units)} below the surface` : 'on the surface'}`
                          : `3D, every ${formatLength(op.stepover, units)}`
                      : op.kind === 'rough3d'
                        ? `3D levels every ${formatLength(op.stepdown, units)}`
                        : op.levels.through
                          ? 'through'
                          : formatLength(op.levels.depth, units)}
                  {op.kind === 'pocket' && op.rest ? ' · rest' : op.kind === 'pocket' && op.pattern === 'adaptive' ? ' · adaptive' : ''}
                  {tp?.warnings.length ? <TriangleAlert className="ml-1 inline size-3 text-amber-400" /> : null}
                </div>
              </div>
              <span className={cn('rounded px-1.5 py-0.5 text-[10px]', STATE_STYLE[st].cls)}>{STATE_STYLE[st].label}</span>
              <button aria-label="Show or hide toolpath" className="text-stone-400 hover:text-white" onClick={(e) => (e.stopPropagation(), toggleHidden(op.id))}>
                {hiddenOps.has(op.id) ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
              <div className="hidden items-center gap-0.5 group-hover:flex">
                <button aria-label="Move up" className="text-stone-400 hover:text-white" onClick={(e) => (e.stopPropagation(), move(i, -1))}>
                  <ArrowUp className="size-3.5" />
                </button>
                <button aria-label="Move down" className="text-stone-400 hover:text-white" onClick={(e) => (e.stopPropagation(), move(i, 1))}>
                  <ArrowDown className="size-3.5" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {current ? (
          <OpEditor
            key={current.id}
            op={current}
            part={part}
            machine={machine}
            tp={tpOf(current.id)}
            state={stateOf(current)}
            sel={sel}
            onChange={(o) => setOps(part.ops.map((x) => (x.id === o.id ? o : x)))}
            onDelete={() => {
              setOps(part.ops.filter((x) => x.id !== current.id))
              setSelectedOp(null)
            }}
            onDuplicate={() => {
              const copy = { ...structuredClone(current), id: nanoid(8), name: `${current.name} copy`, builtHash: undefined }
              setOps([...part.ops, copy])
              setSelectedOp(copy.id)
            }}
            onAccept={() => accept([current.id])}
          />
        ) : (
          <div className="px-4 py-8 text-center text-xs text-stone-400">Pick an operation to edit its settings.</div>
        )}
      </div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-white/10 px-4 py-3">
      <h4 className="mb-2 text-[11px] font-semibold tracking-wider text-stone-400 uppercase">{title}</h4>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">{children}</div>
    </section>
  )
}

function OpEditor({
  op,
  part,
  machine,
  tp,
  state,
  sel,
  onChange,
  onDelete,
  onDuplicate,
  onAccept,
}: {
  op: CamOp
  part: CamPart
  machine: MachineProfile
  tp?: Toolpath
  state: OpState
  sel: string[]
  onChange: (o: CamOp) => void
  onDelete: () => void
  onDuplicate: () => void
  onAccept: () => void
}) {
  const set = <K extends keyof CamOp>(k: K, v: CamOp[K]) => onChange({ ...op, [k]: v } as CamOp)
  const lv = (patch: Partial<CamOp['levels']>) => onChange({ ...op, levels: { ...op.levels, ...patch } })
  const allowed = machine.tools.filter((t) => (op.kind === 'saw' ? t.type === 'saw' : op.kind === 'drill' ? t.type.startsWith('drill') : t.type === 'router'))
  const missing = op.geometry.filter((g) => !part.entities.some((e) => e.id === g)).length

  return (
    <div className="dark text-stone-100">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
        <input className="min-w-0 flex-1 rounded bg-transparent text-sm font-semibold outline-none focus:bg-white/5" value={op.name} onChange={(e) => set('name', e.target.value)} />
        <Switch checked={op.enabled} onCheckedChange={(v) => set('enabled', v)} aria-label="Enabled" />
        <Button size="icon-sm" variant="ghost" aria-label="Duplicate operation" onClick={onDuplicate}>
          <Copy />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Delete operation" onClick={onDelete}>
          <Trash2 />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-2 text-[11px] text-stone-300">
        <span>
          {op.geometry.length} shape{op.geometry.length === 1 ? '' : 's'}
          {missing ? `, ${missing} missing` : ''}
        </span>
        {op.kind !== 'code' && (
          <Button size="sm" variant="outline" className="h-6 border-white/15 bg-transparent px-2 text-[11px]" disabled={!sel.length} onClick={() => set('geometry', [...sel])}>
            Use selection
          </Button>
        )}
        {(state === 'stale' || state === 'new') && (
          <Button size="sm" variant="outline" className="h-6 border-amber-400/40 bg-transparent px-2 text-[11px] text-amber-300" onClick={onAccept}>
            Accept toolpath
          </Button>
        )}
        {tp && (
          <span className="ml-auto text-stone-400">
            {(tp.stats.cut / 1000).toFixed(2)} m cut · {tp.stats.minutes.toFixed(1)} min
          </span>
        )}
      </div>
      {tp && tp.warnings.length > 0 && (
        <div className="space-y-1 border-b border-white/10 bg-amber-500/10 px-4 py-2 text-[11px] text-amber-200">
          {tp.warnings.map((w, i) => (
            <div key={i} className="flex gap-1.5">
              <TriangleAlert className="mt-0.5 size-3 shrink-0" /> {w}
            </div>
          ))}
        </div>
      )}

      {(op.kind === 'finish3d' || op.kind === 'rough3d') && (
        <Group title="Tool">
          <SelectField
            className="col-span-2"
            label="Tool"
            value={op.toolId ?? NONE}
            options={[{ value: NONE, label: op.kind === 'rough3d' ? 'Pick automatically (bull-nose first)' : op.kind === 'finish3d' && op.strategy === 'projection' ? 'Pick automatically (smallest ball-nose first)' : 'Pick automatically (ball-nose first)' }, ...allowed.map((t) => ({ value: t.id, label: `T${t.number} · ${t.name} · Ø${t.diameter}` }))]}
            onChange={(v) => set('toolId', v === NONE ? null : v)}
          />
          <NumField label="Safe height" value={op.levels.safeZ} min={0} onChange={(v) => lv({ safeZ: v })} hint="At least the model top plus rapid-down" />
          <NumField label="Rapid down to" value={op.levels.rapidZ} min={0} onChange={(v) => lv({ rapidZ: v })} hint="Above the surface" />
        </Group>
      )}

      {op.kind !== 'code' && !OPS_3D.has(op.kind) && (
        <Group title="Tool">
          <SelectField
            className="col-span-2"
            label="Tool"
            value={op.toolId ?? NONE}
            options={[{ value: NONE, label: op.kind === 'drill' ? 'Match each hole diameter' : 'Pick automatically' }, ...allowed.map((t) => ({ value: t.id, label: `T${t.number} · ${t.name} · Ø${t.diameter}` }))]}
            onChange={(v) => set('toolId', v === NONE ? null : v)}
          />
          <SelectField
            label="Face"
            value={String(op.face)}
            options={[1, 2, 3, 4, 5, 6].map((f) => ({ value: String(f), label: ['Top (1)', 'Front edge (2)', 'Right edge (3)', 'Back edge (4)', 'Left edge (5)', 'Underside (6)'][f - 1] }))}
            onChange={(v) => set('face', Number(v) as FaceId)}
          />
        </Group>
      )}

      {op.kind !== 'code' && !OPS_3D.has(op.kind) && (
        <Group title="Depths">
          <div className="col-span-2">
            <SwitchField label="Cut through" checked={op.levels.through} onChange={(v) => lv({ through: v })} hint={op.levels.through ? `Panel thickness plus ${machine.throughDepth} mm into the spoilboard` : undefined} />
          </div>
          {!op.levels.through && <NumField label="Depth" value={op.levels.depth} min={0} onChange={(v) => lv({ depth: v })} />}
          <NumField label="Depth per pass" value={op.levels.passDepth} min={0} onChange={(v) => lv({ passDepth: v })} hint="0 = tool stepdown" />
          <NumField label="Number of cuts" suffix="" value={op.levels.cuts ?? 0} min={0} onChange={(v) => lv({ cuts: Math.round(v) || undefined })} hint="0 = from depth per pass" />
          <NumField label="Safe height" value={op.levels.safeZ} min={0} onChange={(v) => lv({ safeZ: v })} />
          <NumField label="Rapid down to" value={op.levels.rapidZ} min={0} onChange={(v) => lv({ rapidZ: v })} />
          <NumField label="Leave on floor" value={op.levels.stockZ} min={0} onChange={(v) => lv({ stockZ: v })} />
        </Group>
      )}

      <StrategyFields op={op} part={part} onChange={onChange} />

      {op.kind === 'profile' && (
        <>
          <Group title="Entry & exit">
            <SelectField label="Lead in" value={op.leads.in} options={LEADS} onChange={(v) => onChange({ ...op, leads: { ...op.leads, in: v } })} />
            <SelectField label="Lead out" value={op.leads.out} options={LEADS} onChange={(v) => onChange({ ...op, leads: { ...op.leads, out: v } })} />
            <NumField label="Line length (× tool radius)" suffix="" step={0.25} value={op.leads.length} min={0} onChange={(v) => onChange({ ...op, leads: { ...op.leads, length: v } })} />
            <NumField label="Arc radius (× tool radius)" suffix="" step={0.25} value={op.leads.radius} min={0} onChange={(v) => onChange({ ...op, leads: { ...op.leads, radius: v } })} />
            <NumField label="Ramp angle" suffix="°" value={op.leads.rampAngle} min={1} max={45} onChange={(v) => onChange({ ...op, leads: { ...op.leads, rampAngle: v } })} />
            <NumField label="Overlap" value={op.leads.overlap} onChange={(v) => onChange({ ...op, leads: { ...op.leads, overlap: v } })} hint="Negative leaves a small web" />
            <NumField label="Start point" suffix="%" value={Math.round((op.start ?? -1) * 1000) / 10} min={-1} max={100} onChange={(v) => onChange({ ...op, start: v < 0 ? undefined : v / 100 })} hint="Along the contour; -1 = middle of longest edge" />
          </Group>
          <Group title="Holding tabs">
            <SelectField label="Tabs" value={op.tags.mode} options={[{ value: 'none', label: 'None' }, { value: 'auto', label: 'Evenly spaced' }, { value: 'manual', label: 'At positions' }]} onChange={(v) => onChange({ ...op, tags: { ...op.tags, mode: v } })} />
            {op.tags.mode !== 'none' && (
              <>
                <SelectField label="Shape" value={op.tags.shape} options={[{ value: 'flat', label: 'Square' }, { value: 'ramp', label: 'Ramped' }, { value: 'trapezoid', label: 'Trapezoid' }]} onChange={(v) => onChange({ ...op, tags: { ...op.tags, shape: v } })} />
                {op.tags.mode === 'auto' && <NumField label="Count" suffix="" value={op.tags.count} min={1} onChange={(v) => onChange({ ...op, tags: { ...op.tags, count: Math.round(v) } })} />}
                {op.tags.mode === 'manual' && (
                  <TextField label="Positions (% of length)" value={op.tags.at.map((a) => Math.round(a * 1000) / 10).join(', ')} onChange={(v) => onChange({ ...op, tags: { ...op.tags, at: v.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n <= 100).map((n) => n / 100) } })} />
                )}
                <NumField label="Length" value={op.tags.length} min={0} onChange={(v) => onChange({ ...op, tags: { ...op.tags, length: v } })} />
                <NumField label="Height" value={op.tags.height} min={0} onChange={(v) => onChange({ ...op, tags: { ...op.tags, height: v } })} />
              </>
            )}
          </Group>
        </>
      )}

      {op.kind !== 'code' && (
        <Group title="Feeds">
          <NumField label="Spindle" suffix="rpm" value={op.feeds.rpm ?? tp?.feeds.rpm ?? 0} min={0} step={500} onChange={(v) => set('feeds', { ...op.feeds, rpm: v || undefined })} />
          <NumField label="Feed" suffix="mm/min" value={op.feeds.feed ?? tp?.feeds.feed ?? 0} min={0} step={100} onChange={(v) => set('feeds', { ...op.feeds, feed: v || undefined })} />
          <NumField label="Plunge" suffix="mm/min" value={op.feeds.plunge ?? tp?.feeds.plunge ?? 0} min={0} step={100} onChange={(v) => set('feeds', { ...op.feeds, plunge: v || undefined })} />
          <div className="self-end pb-1.5 text-[11px] text-stone-400">{op.feeds.feed || op.feeds.rpm || op.feeds.plunge ? 'Set on this operation' : 'From tool / material table'}</div>
        </Group>
      )}
    </div>
  )
}

const LEADS = [
  { value: 'none' as const, label: 'None' },
  { value: 'line' as const, label: 'Straight' },
  { value: 'arc' as const, label: 'Arc' },
  { value: 'line-arc' as const, label: 'Straight + arc' },
  { value: 'ramp' as const, label: 'Ramp along path' },
  { value: 'centre' as const, label: 'From hole centre' },
]

/** Model, boundary, stock and groups: shared by the 3D operations. */
function SurfaceGroup({ op, part, onSurface, walls, pattern }: { op: CamOp & { surface: Surface3D }; part: CamPart; onSurface: (s: Surface3D) => void; walls?: boolean; pattern?: boolean }) {
  const sf = (patch: Partial<Surface3D>) => onSurface({ ...op.surface, ...patch })
  return (
    <Group title="Surface">
      <SelectField className="col-span-2" label="Model" value={op.surface.modelId || NONE} options={[{ value: NONE, label: 'Choose a model' }, ...(part.models ?? []).map((m) => ({ value: m.id, label: m.name }))]} onChange={(v) => sf({ modelId: v === NONE ? '' : v })} />
      {pattern ? (
        <div className="col-span-2 self-end pb-1.5 text-[11px] text-stone-400">{op.geometry.length ? `${op.geometry.length} shape(s) to project: the tool centre follows them in plan` : 'Select the shapes or text to project, then Use selection'}</div>
      ) : (
        <>
          <SelectField
            label="Boundary"
            value={op.surface.boundaryMode}
            options={[
              { value: 'centre', label: 'Tool centre inside' },
              { value: 'contained', label: 'Whole tool inside' },
              { value: 'touching', label: 'Tool may overhang' },
            ]}
            onChange={(v) => sf({ boundaryMode: v })}
          />
          <div className="self-end pb-1.5 text-[11px] text-stone-400">{op.geometry.length ? `${op.geometry.length} boundary shape(s)` : 'No boundary: the whole model'}</div>
        </>
      )}
      <NumField label={walls ? 'Leave on walls' : 'Leave on surface'} value={op.surface.stockToLeave} min={0} step={0.1} onChange={(v) => sf({ stockToLeave: v })} />
      <NumField label="Tolerance" value={op.surface.tolerance} min={0.001} max={0.5} step={0.005} onChange={(v) => sf({ tolerance: v })} hint="Largest gap to the true surface" />
      <TextField label="Protect groups (numbers)" value={(op.surface.protect ?? []).join(', ')} onChange={(v) => sf({ protect: v.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 0) })} />
      <TextField label="Only groups (empty = all)" value={(op.surface.groups ?? []).join(', ')} onChange={(v) => sf({ groups: v.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 0) })} />
    </Group>
  )
}

function StrategyFields({ op, part, onChange }: { op: CamOp; part: CamPart; onChange: (o: CamOp) => void }) {
  const adaptiveOn = useStore((s) => featuresOf(s.data?.settings).camAdaptive)
  switch (op.kind) {
    case 'finish3d': {
      const waterline = op.strategy === 'waterline'
      const strategy = (
        <SelectField
          className="col-span-2"
          label="Strategy"
          value={op.strategy}
          options={[
            { value: 'parallel', label: 'Parallel: straight passes over the surface' },
            { value: 'waterline', label: 'Waterline: passes at constant heights' },
            { value: 'projection', label: 'Projection: drawn shapes and text onto the surface' },
          ]}
          onChange={(v) => onChange({ ...op, strategy: v })}
        />
      )
      if (op.strategy === 'projection') {
        const lv = (patch: Partial<typeof op.levels>) => onChange({ ...op, levels: { ...op.levels, ...patch } })
        return (
          <>
            <SurfaceGroup op={op} part={part} onSurface={(surface) => onChange({ ...op, surface })} pattern />
            <Group title="Projected shapes">
              {strategy}
              <NumField label="Depth below the surface" value={op.levels.depth} min={0} step={0.1} onChange={(v) => lv({ depth: v })} hint="0 = on the surface; measured straight down" />
              <NumField label="Depth per pass" value={op.levels.passDepth} min={0} onChange={(v) => lv({ passDepth: v })} hint="0 = tool stepdown" />
              <NumField label="Number of cuts" suffix="" value={op.levels.cuts ?? 0} min={0} onChange={(v) => lv({ cuts: Math.round(v) || undefined })} hint="0 = from depth per pass" />
              <div className="self-end pb-1.5 text-[11px] text-stone-400">Below the surface, protected groups and groups not chosen are kept clear.</div>
            </Group>
          </>
        )
      }
      return (
        <>
          <SurfaceGroup op={op} part={part} onSurface={(surface) => onChange({ ...op, surface })} />
          <Group title={waterline ? 'Waterline passes' : 'Parallel passes'}>
            {strategy}
            {waterline && <NumField label="Step-down" value={op.stepdown ?? 1} min={0.05} step={0.1} onChange={(v) => onChange({ ...op, stepdown: v })} hint="Placeholder default; set your own" />}
            {waterline && <SelectField label="Direction" value={op.direction} options={[{ value: 'climb', label: 'Climb' }, { value: 'conventional', label: 'Conventional' }]} onChange={(v) => onChange({ ...op, direction: v })} />}
            <NumField label={waterline ? 'Fill step-over' : 'Step-over'} value={op.stepover} min={0.01} step={0.1} onChange={(v) => onChange({ ...op, stepover: v })} hint={waterline ? 'For the shallow-area fill' : 'Placeholder default; set your own'} />
            <NumField label="Angle" suffix="°" value={op.angle} onChange={(v) => onChange({ ...op, angle: v })} />
            {!waterline && <SelectField label="Pattern" value={op.pattern} options={[{ value: 'zigzag', label: 'Back and forth' }, { value: 'oneway', label: 'One way' }]} onChange={(v) => onChange({ ...op, pattern: v })} />}
            {!waterline && op.pattern === 'oneway' && <SelectField label="Direction" value={op.direction} options={[{ value: 'climb', label: 'Along the angle' }, { value: 'conventional', label: 'Against the angle' }]} onChange={(v) => onChange({ ...op, direction: v })} />}
            <NumField label="Slope from" suffix="°" value={op.slope.min} min={0} max={90} onChange={(v) => onChange({ ...op, slope: { ...op.slope, min: v } })} />
            <NumField label="Slope to" suffix="°" value={op.slope.max} min={0} max={90} onChange={(v) => onChange({ ...op, slope: { ...op.slope, max: v } })} />
            <div className="col-span-2">
              <SwitchField label="Skip flat areas" checked={op.skipFlats} onChange={(v) => onChange({ ...op, skipFlats: v })} hint="Leaves surfaces under 0.5° for a flat-area pass" />
              {waterline && (
                <SwitchField
                  label="Fill shallow areas"
                  checked={!!op.fillShallow}
                  onChange={(v) => onChange({ ...op, fillShallow: v })}
                  hint="Parallel passes where the surface is flatter than the slope limit. These need true 3D output, so the operation then cannot be written to woodWOP."
                />
              )}
            </div>
          </Group>
        </>
      )
    }
    case 'rough3d':
      return (
        <>
          <SurfaceGroup op={op} part={part} onSurface={(surface) => onChange({ ...op, surface })} walls />
          <Group title="Levels">
            <NumField label="Leave on floors" value={op.stockZ} min={0} step={0.1} onChange={(v) => onChange({ ...op, stockZ: v })} />
            <NumField label="Step-down" value={op.stepdown} min={0.1} step={0.5} onChange={(v) => onChange({ ...op, stepdown: v })} hint="Placeholder default; set your own" />
            <NumField label="Step-over" suffix="%" value={Math.round(op.stepover * 100)} min={5} max={95} onChange={(v) => onChange({ ...op, stepover: v / 100 })} />
            <SelectField label="Pattern" value={op.pattern} options={[{ value: 'offset', label: 'Follow shape' }, { value: 'zigzag', label: 'Back and forth' }]} onChange={(v) => onChange({ ...op, pattern: v })} />
            {op.pattern === 'zigzag' && <NumField label="Angle" suffix="°" value={op.angle} onChange={(v) => onChange({ ...op, angle: v })} />}
            <SelectField label="Direction" value={op.direction} options={[{ value: 'climb', label: 'Climb' }, { value: 'conventional', label: 'Conventional' }]} onChange={(v) => onChange({ ...op, direction: v })} />
            <SelectField label="Entry" value={op.entry} options={[{ value: 'helix', label: 'Helix' }, { value: 'ramp', label: 'Ramp' }, { value: 'plunge', label: 'Straight down' }]} onChange={(v) => onChange({ ...op, entry: v })} />
            <NumField label="Ramp angle" suffix="°" value={op.rampAngle} min={1} max={45} onChange={(v) => onChange({ ...op, rampAngle: v })} />
            <NumField label="Safe height" value={op.levels.safeZ} min={0} onChange={(v) => onChange({ ...op, levels: { ...op.levels, safeZ: v } })} />
            <NumField label="Rapid down to" value={op.levels.rapidZ} min={0} onChange={(v) => onChange({ ...op, levels: { ...op.levels, rapidZ: v } })} hint="Above the level just cut" />
            <div className="col-span-2">
              <SwitchField label="Extra levels on flat areas" checked={op.flats} onChange={(v) => onChange({ ...op, flats: v })} hint="A level at the height of every flat area of the model, so flats are left with only the floor stock" />
            </div>
          </Group>
        </>
      )
    case 'profile':
      return (
        <Group title="Strategy">
          <SelectField label="Cutter side" value={op.side} options={[{ value: 'auto', label: 'Automatic (holes inside)' }, { value: 'outside', label: 'Outside' }, { value: 'inside', label: 'Inside' }, { value: 'left', label: 'Left of path' }, { value: 'right', label: 'Right of path' }, { value: 'centre', label: 'On the line' }]} onChange={(v) => onChange({ ...op, side: v })} />
          <SelectField label="Direction" value={op.direction} options={[{ value: 'climb', label: 'Climb' }, { value: 'conventional', label: 'Conventional' }]} onChange={(v) => onChange({ ...op, direction: v })} />
          <SelectField label="Compensation" value={op.compensation} options={[{ value: 'cam', label: 'Computed here' }, { value: 'machine', label: 'By the machine' }]} onChange={(v) => onChange({ ...op, compensation: v })} />
          <SelectField label="Outside corners" value={op.corners} options={[{ value: 'round', label: 'Roll round' }, { value: 'straight', label: 'Sharp' }, { value: 'loop', label: 'Loop' }]} onChange={(v) => onChange({ ...op, corners: v })} />
          <NumField label="Leave on wall" value={op.stockXY} onChange={(v) => onChange({ ...op, stockXY: v })} />
          <NumField label="Wall angle" suffix="°" value={op.slope} min={0} max={45} onChange={(v) => onChange({ ...op, slope: v })} />
          <SelectField label="Cut order" value={op.order ?? 'drawn'} options={[{ value: 'drawn', label: 'As picked' }, { value: 'inside-first', label: 'Inner shapes first' }, { value: 'nearest', label: 'Nearest next' }]} onChange={(v) => onChange({ ...op, order: v })} />
          <NumField label="Roughing passes" suffix="" value={op.xyPasses ?? 0} min={0} max={20} onChange={(v) => onChange({ ...op, xyPasses: Math.round(v) })} />
          {(op.xyPasses ?? 0) > 0 && <NumField label="Roughing step" value={op.xyStep ?? 3} min={0.1} onChange={(v) => onChange({ ...op, xyStep: v })} />}
          <div className="col-span-2">
            <SwitchField label="Zig-zag open shapes" checked={op.bidirectional} onChange={(v) => onChange({ ...op, bidirectional: v })} />
            <SwitchField label="Reverse open shapes" checked={!!op.reverse} onChange={(v) => onChange({ ...op, reverse: v })} />
          </div>
        </Group>
      )
    case 'pocket': {
      const adaptive = op.pattern === 'adaptive' && !op.rest
      const ad = op.adaptive ?? DEFAULT_ADAPTIVE
      const setAd = (patch: Partial<typeof ad>) => onChange({ ...op, adaptive: { ...ad, ...patch } })
      const patterns = [{ value: 'offset' as const, label: 'Follow shape' }, { value: 'zigzag' as const, label: 'Back and forth' }, { value: 'spiral' as const, label: 'Spiral (circles)' }]
      return (
        <Group title="Strategy">
          <SelectField
            label="Pattern"
            value={op.pattern}
            options={adaptiveOn || op.pattern === 'adaptive' ? [...patterns, { value: 'adaptive' as const, label: 'Adaptive (steady width of cut)' }] : patterns}
            onChange={(v) => onChange({ ...op, pattern: v, ...(v === 'adaptive' && !op.adaptive ? { adaptive: { ...DEFAULT_ADAPTIVE } } : {}) })}
          />
          <SelectField label="Direction" value={op.direction} options={[{ value: 'climb', label: 'Climb' }, { value: 'conventional', label: 'Conventional' }]} onChange={(v) => onChange({ ...op, direction: v })} />
          {adaptive ? (
            <>
              <NumField label="Width of cut" suffix="%" value={Math.round(ad.width * 1000) / 10} min={2} max={60} step={1} onChange={(v) => setAd({ width: v / 100, angle: undefined })} hint={`Of the tool diameter · ${(Math.acos(Math.max(-1, 1 - 2 * ad.width)) * 180 / Math.PI).toFixed(0)}° engagement · placeholder default`} />
              <NumField label="Or engagement angle" suffix="°" value={ad.angle ?? 0} min={0} max={180} onChange={(v) => setAd({ angle: v > 0 ? v : undefined, ...(v > 0 ? { width: (1 - Math.cos((v * Math.PI) / 180)) / 2 } : {}) })} hint="0 = use the width" />
              <NumField label="Smoothing radius" value={ad.smoothing} min={0} step={0.5} onChange={(v) => setAd({ smoothing: v })} hint="Smallest turn of the path; 0 = turn freely" />
              <NumField label="Lift for moves back" value={ad.lift} min={0} step={0.1} onChange={(v) => setAd({ lift: v })} hint="Through cleared area only" />
              <NumField label="Adaptive feed up to" suffix="×" value={ad.feedBoost} min={1} max={3} step={0.1} onChange={(v) => setAd({ feedBoost: Math.max(1, v) })} hint="Lighter cuts and moves back run faster; 1 = off" />
              <NumField label="Helix angle" suffix="°" value={op.rampAngle} min={1} max={45} onChange={(v) => onChange({ ...op, rampAngle: v })} hint="Entries are always helixes" />
            </>
          ) : (
            <>
              <NumField label="Stepover" suffix="%" value={Math.round(op.stepover * 100)} min={5} max={95} onChange={(v) => onChange({ ...op, stepover: v / 100 })} />
              {op.pattern === 'zigzag' && <NumField label="Angle" suffix="°" value={op.angle} onChange={(v) => onChange({ ...op, angle: v })} />}
              <SelectField label="Entry" value={op.entry} options={[{ value: 'helix', label: 'Helix' }, { value: 'ramp', label: 'Ramp' }, { value: 'plunge', label: 'Straight down' }]} onChange={(v) => onChange({ ...op, entry: v })} />
              <NumField label="Ramp angle" suffix="°" value={op.rampAngle} min={1} max={45} onChange={(v) => onChange({ ...op, rampAngle: v })} />
            </>
          )}
          <NumField label="Leave on wall" value={op.stockXY} onChange={(v) => onChange({ ...op, stockXY: v })} />
          <div className="col-span-2">
            <SwitchField label="Keep islands" checked={op.islands} onChange={(v) => onChange({ ...op, islands: v })} hint="Closed shapes inside the pocket stay standing" />
            {!adaptive && <SwitchField label="Finish pass on the wall" checked={op.finishPass} onChange={(v) => onChange({ ...op, finishPass: v })} />}
            {(adaptiveOn || op.rest) && (
              <SwitchField
                label="Rest machining"
                checked={!!op.rest}
                onChange={(v) => onChange({ ...op, rest: v ? { from: [], minLength: 0 } : undefined })}
                hint="Cut only what earlier operations left (corners, narrow parts, walls), worked out from their toolpaths. Uses follow-shape passes."
              />
            )}
          </div>
          {op.rest && (
            <>
              <SelectField
                label="Left by"
                value={op.rest.from[0] ?? NONE}
                options={[{ value: NONE, label: 'Every earlier operation' }, ...part.ops.slice(0, Math.max(0, part.ops.findIndex((o) => o.id === op.id))).filter((o) => REST_SOURCE_KINDS.has(o.kind)).map((o) => ({ value: o.id, label: o.name }))]}
                onChange={(v) => onChange({ ...op, rest: { ...op.rest!, from: v === NONE ? [] : [v] } })}
              />
              <NumField label="Skip pieces shorter than" value={op.rest.minLength} min={0} onChange={(v) => onChange({ ...op, rest: { ...op.rest!, minLength: v } })} hint="Measured where the tool cuts" />
            </>
          )}
        </Group>
      )
    }
    case 'drill':
      return (
        <Group title="Strategy">
          <SelectField label="Cycle" value={op.cycle} options={[{ value: 'drill', label: 'Single plunge' }, { value: 'peck', label: 'Peck' }]} onChange={(v) => onChange({ ...op, cycle: v })} />
          {op.cycle === 'peck' && (
            <>
              <NumField label="First peck" value={op.peck} min={0.5} onChange={(v) => onChange({ ...op, peck: v })} />
              <NumField label="Each next peck" suffix="%" value={Math.round((op.peckFactor ?? 1) * 100)} min={10} max={100} onChange={(v) => onChange({ ...op, peckFactor: v / 100 })} />
              <NumField label="Smallest peck" value={op.minPeck ?? 1} min={0.1} onChange={(v) => onChange({ ...op, minPeck: v })} />
              <SelectField label="Retract" value={op.retract ?? 'full'} options={[{ value: 'full', label: 'Clear the hole' }, { value: 'partial', label: 'Lift 1 mm' }]} onChange={(v) => onChange({ ...op, retract: v })} />
            </>
          )}
          <NumField label="Dwell" suffix="s" value={op.dwell} min={0} step={0.1} onChange={(v) => onChange({ ...op, dwell: v })} />
          <SelectField label="Depth to" value={op.depthRef} options={[{ value: 'tip', label: 'Drill tip' }, { value: 'shoulder', label: 'Full diameter' }]} onChange={(v) => onChange({ ...op, depthRef: v })} />
          <SelectField label="Holes" value={op.select.mode} options={[{ value: 'all', label: 'All picked' }, { value: 'diameter', label: 'One diameter' }, { value: 'range', label: 'Diameter range' }]} onChange={(v) => onChange({ ...op, select: { ...op.select, mode: v } })} />
          {op.select.mode === 'diameter' && <NumField label="Diameter" value={op.select.diameter ?? 5} onChange={(v) => onChange({ ...op, select: { ...op.select, diameter: v } })} />}
          {op.select.mode === 'range' && (
            <>
              <NumField label="From" value={op.select.min ?? 0} onChange={(v) => onChange({ ...op, select: { ...op.select, min: v } })} />
              <NumField label="To" value={op.select.max ?? 10} onChange={(v) => onChange({ ...op, select: { ...op.select, max: v } })} />
            </>
          )}
        </Group>
      )
    case 'vcarve':
      return (
        <Group title="Strategy">
          <NumField label="Step between rings" value={op.step} min={0.05} step={0.05} onChange={(v) => onChange({ ...op, step: v })} />
        </Group>
      )
    case 'sweep':
      return (
        <Group title="Section">
          <SelectField label="Side" value={op.side} options={[{ value: 'inside', label: 'Inside' }, { value: 'outside', label: 'Outside' }]} onChange={(v) => onChange({ ...op, side: v })} />
          <NumField label="Step" value={op.step} min={0.1} step={0.1} onChange={(v) => onChange({ ...op, step: v })} />
          <TextField
            className="col-span-2"
            label="Inset : depth pairs (mm)"
            value={op.section.map((s) => `${s.inset}:${s.depth}`).join('  ')}
            onChange={(v) => {
              const section = v
                .split(/\s+/)
                .map((p) => p.split(':').map(Number))
                .filter((p) => p.length === 2 && p.every(Number.isFinite))
                .map(([inset, depth]) => ({ inset, depth }))
              if (section.length >= 2) onChange({ ...op, section })
            }}
          />
        </Group>
      )
    case 'code':
      return (
        <Group title="Note">
          <div className="col-span-2 flex flex-col gap-2">
            <Textarea value={op.text} onChange={(e) => onChange({ ...op, text: e.target.value })} placeholder="Shown to the operator in the program" className="min-h-20 bg-transparent" />
            <SwitchField label="Ask the operator to stop here" checked={op.stop} onChange={(v) => onChange({ ...op, stop: v })} />
          </div>
        </Group>
      )
    default:
      return null
  }
}
