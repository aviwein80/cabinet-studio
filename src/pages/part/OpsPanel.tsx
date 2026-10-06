import { ArrowDown, ArrowUp, CheckCheck, Copy, Eye, EyeOff, Plus, Trash2, TriangleAlert, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { nanoid } from 'nanoid'
import { opInputHash, opState, partOutline, REST_SOURCE_KINDS, REST_SOURCE_KINDS_3D, type OpState } from '@/cam/doc'
import { toolOrderOf } from '@/core/admin'
import { DEFAULT_ADAPTIVE, DEFAULT_SAW, defaultOp, OP_LABEL, orderByTool, resolveTool } from '@/cam/ops'
import { ManualFields, EditsGroup } from './EditsPanel'
import { useOpCfg } from './opConfigure'
import { ConfigureBadge, UnconfirmedList } from '@/components/Configure'
import { confirmOp, type CutDefaultKey, newOpDefaults, opUnconfirmed } from '@/core/confirm'
import { PENCIL_MIN_ANGLE } from '@/cam/3d/pencil'
import { applyRules, recipesOf, ruleSetsOf } from '@/cam/rules'
import { compareOpTool, toolSnapshot, updateOpTool } from '@/core/toolData'
import { inBackground, OPS_3D, type Toolpath } from '@/cam/toolpath'
import type { AdaptiveSettings, CamOp, CamOpKind, CamPart, CurveDrive, FaceId, Rough3dOp, Surface3D } from '@/cam/types'
import { NONE, NumField, SelectField, SwitchField, TextField } from '@/components/fields'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { featuresOf } from '@/core/features'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { MachineProfile, Tool } from '@/core/types'
import { aggregateOf, machineModelOf } from '@/core/machineModel'
import { formatLength } from '@/core/units'
import { cn } from '@/lib/utils'
import { useStore } from '@/app/store'

const STATE_STYLE: Record<OpState, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'bg-sky-500/15 text-sky-300' },
  current: { label: 'Up to date', cls: 'bg-emerald-500/15 text-emerald-300' },
  stale: { label: 'Geometry changed', cls: 'bg-amber-500/20 text-amber-300' },
  broken: { label: 'Missing geometry', cls: 'bg-red-500/20 text-red-300' },
}

/** Picking points on the drawing for a hand-drawn toolpath. */
export interface PathPick {
  opId: string
  kind: 'feed' | 'rapid' | 'arc'
  /** Height of the picked points, mm (0 = face 1). */
  z: number
  /** Arcs: the point picked first, the arc passes through it. */
  through?: { x: number; y: number }
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
  pathPick,
  setPathPick,
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
  pathPick?: PathPick | null
  setPathPick?: (p: PathPick | null) => void
}) {
  const units = useStore((s) => s.data?.settings.units ?? 'mm')
  const lib = useStore((s) => s.data?.library)
  const rulesOn = useStore((s) => featuresOf(s.data?.settings).camRules)
  const on3d = useStore((s) => featuresOf(s.data?.settings).cam3d) && !!part.models?.length
  const more25d = useStore((s) => featuresOf(s.data?.settings).camMore25d)
  const finishMore = useStore((s) => featuresOf(s.data?.settings).cam3dFinishMore)
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
  // accepted toolpaths keep the tool data they were made with (TOOL-05: compared with the table later)
  const accept = (ids: string[]) =>
    setOps(part.ops.map((o) => {
      if (!ids.includes(o.id)) return o
      const tool = tpOf(o.id)?.tool ?? null
      return { ...o, builtHash: opInputHash(o, part, tool, machine), ...(tool ? { toolData: toolSnapshot(tool, machine, part.materialId) } : {}) }
    }))

  const add = (kind: CamOpKind, extra: Partial<CamOp> = {}) => {
    let geometry = sel
    if (!geometry.length && (kind === 'profile' || kind === 'drill')) {
      const outline = partOutline(part).entity
      geometry = kind === 'profile' ? (outline ? [outline.id] : []) : part.entities.filter((e) => e.g.t === 'circle' || e.g.t === 'point').map((e) => e.id)
    }
    // a new saw cut gets the M2.6 settings when they are switched on; facing takes the whole panel
    if (kind === 'saw' && more25d && !('saw' in extra)) extra = { ...extra, saw: { ...DEFAULT_SAW } } as Partial<CamOp>
    if (kind === 'face') geometry = sel.filter((id) => part.entities.some((e) => e.id === id && (e.g.t === 'circle' || (e.g.t === 'contour' && e.g.c.closed))))
    // the shop's default cutting values (placeholders until confirmed)
    let op = defaultOp(kind, kind === 'code' ? [] : geometry, { ...newOpDefaults(kind, machine, extra), ...extra } as Partial<CamOp>)
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
            {more25d && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[11px] text-muted-foreground">More 2.5D</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => add('face')}>{OP_LABEL.face}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => add('chamfer')}>{OP_LABEL.chamfer}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => add('curve', { mode: 'between' } as Partial<CamOp>)}>Cut between two curves</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => add('curve', { mode: 'follow3d' } as Partial<CamOp>)}>Cut along a 3D curve</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => add('curve', { mode: 'zwave' } as Partial<CamOp>)}>Z-wave along a shape</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => add('manual')}>{OP_LABEL.manual}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => add('edge')}>{OP_LABEL.edge}</DropdownMenuItem>
              </>
            )}
            {on3d && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => add('rough3d')}>{OP_LABEL.rough3d}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => add('finish3d')}>{OP_LABEL.finish3d} (parallel)</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => add('finish3d', { strategy: 'waterline' } as Partial<CamOp>)}>{OP_LABEL.finish3d} (waterline)</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => add('finish3d', { strategy: 'projection' } as Partial<CamOp>)}>{OP_LABEL.finish3d} (projection)</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => add('finish3d', { strategy: 'pencil' } as Partial<CamOp>)}>{OP_LABEL.finish3d} (pencil)</DropdownMenuItem>
                {finishMore && (
                  <>
                    <DropdownMenuItem onSelect={() => add('finish3d', { strategy: 'radial' } as Partial<CamOp>)}>{OP_LABEL.finish3d} (radial)</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => add('finish3d', { strategy: 'spiral' } as Partial<CamOp>)}>{OP_LABEL.finish3d} (spiral)</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => add('finish3d', { strategy: 'scallop' } as Partial<CamOp>)}>{OP_LABEL.finish3d} (scallop)</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => add('finish3d', { strategy: 'flat' } as Partial<CamOp>)}>{OP_LABEL.finish3d} (flat areas)</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => add('finish3d', { strategy: 'helical' } as Partial<CamOp>)}>{OP_LABEL.finish3d} (helical)</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => add('rough3d', { pattern: 'undercut' } as Partial<CamOp>)}>3D roughing (undercuts, lollipop)</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => add('finish3d', { strategy: 'undercut' } as Partial<CamOp>)}>{OP_LABEL.finish3d} (undercut)</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => add('finish3d', { strategy: 'curve' } as Partial<CamOp>)}>{OP_LABEL.finish3d} (curve-driven)</DropdownMenuItem>
                  </>
                )}
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
            onClick={() => setOps(orderByTool(part.ops, (o) => tpOf(o.id)?.tool ?? null, toolOrderOf(machine)))}
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
                          : op.strategy === 'pencil'
                            ? `3D pencil, valleys over ${op.pencilAngle ?? PENCIL_MIN_ANGLE}°`
                            : op.strategy === 'radial' || op.strategy === 'spiral' || op.strategy === 'scallop'
                              ? `3D ${op.strategy}, every ${formatLength(op.stepover, units)}`
                              : op.strategy === 'flat'
                                ? `3D flat areas, every ${formatLength(op.stepover, units)}`
                                : op.strategy === 'helical'
                                  ? `3D helical, ${formatLength(op.stepdown ?? 1, units)} a round`
                                  : op.strategy === 'undercut'
                                    ? `3D undercut, every ${formatLength(op.stepover, units)}`
                                  : op.strategy === 'curve'
                                    ? `3D ${DRIVE_LABEL[op.drive?.mode ?? 'curves']}`
                              : `3D, every ${formatLength(op.stepover, units)}`
                      : op.kind === 'rough3d'
                        ? `${op.pattern === 'undercut' ? '3D undercuts, levels' : '3D levels'} every ${formatLength(op.stepdown, units)}`
                        : op.kind === 'chamfer'
                          ? `chamfer ${formatLength(op.size, units)} ${op.drive === 'width' ? 'wide' : 'deep'}`
                          : op.kind === 'edge'
                            ? `edge ${formatLength(op.reach, units)} in, ${formatLength(op.height, units)} down`
                          : op.kind === 'curve'
                            ? { between: 'between two curves', follow3d: 'along 3D curves', zwave: `wave ${formatLength(op.wave.min, units)} to ${formatLength(op.wave.max, units)}` }[op.mode]
                        : op.levels.through
                          ? 'through'
                          : formatLength(op.levels.depth, units)}
                  {(op.kind === 'pocket' || op.kind === 'finish3d') && op.rest && !(op.kind === 'finish3d' && op.strategy === 'projection') ? ' · rest' : (op.kind === 'pocket' || op.kind === 'rough3d') && op.pattern === 'adaptive' ? ' · adaptive' : ''}
                  {tp?.warnings.length ? <TriangleAlert className="ml-1 inline size-3 text-amber-400" /> : null}
                </div>
              </div>
              {tp?.edited?.lost ? <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-300">Edits lost</span> : null}
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
            pathPick={pathPick ?? null}
            setPathPick={setPathPick}
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
  pathPick,
  setPathPick,
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
  pathPick?: PathPick | null
  setPathPick?: (p: PathPick | null) => void
}) {
  const set = <K extends keyof CamOp>(k: K, v: CamOp[K]) => onChange({ ...op, [k]: v } as CamOp)
  const lv = (patch: Partial<CamOp['levels']>) => onChange({ ...op, levels: { ...op.levels, ...patch } })
  const allowed = machine.tools.filter((t) => (op.kind === 'saw' ? t.type === 'saw' : op.kind === 'drill' ? t.type.startsWith('drill') : t.type === 'router'))
  // values this operation uses that are not confirmed (its own, its tool's, the machine's)
  const unconf = opUnconfirmed(op, part, machine, tp?.tool ?? null)
  const toolItem = unconf.find((u) => u.target.kind === 'tool' && u.target.part !== 'feeds')
  const feedItem = unconf.find((u) => u.target.kind === 'tool' && u.target.part === 'feeds')
  const missing = op.geometry.filter((g) => !part.entities.some((e) => e.id === g)).length
  // TOOL-05: the tool data stored when the toolpath was accepted, against the tool table now
  const toolDiff = op.toolData && tp?.tool ? compareOpTool(op, part, machine, tp.tool).diffs : []

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
      {toolDiff.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-sky-500/10 px-4 py-2 text-[11px] text-sky-100">
          <span className="min-w-0 flex-1">
            The tool table changed since this toolpath was accepted: {toolDiff.map((d) => `${d.label.toLowerCase()} ${String(d.stored ?? '–')} → ${String(d.library ?? '–')}`).join(', ')}.
          </span>
          <Button size="sm" variant="outline" className="h-6 border-sky-300/40 bg-transparent px-2 text-[11px]" onClick={() => onChange(updateOpTool(op, part, machine, tp?.tool ?? null))}>
            Update to the table
          </Button>
        </div>
      )}
      {unconf.length > 0 && (
        <div className="border-b border-white/10 bg-amber-500/5 px-4 py-2 text-stone-200" data-cfg={`op:${op.id}:list`}>
          <div className="mb-1 text-[11px] text-amber-200">Uses {unconf.length} value{unconf.length === 1 ? '' : 's'} not confirmed yet (placeholders). Configure opens the field; nothing here turns on machine output.</div>
          <UnconfirmedList items={unconf} tone="dark" limit={4} onConfirm={(u) => {
              const t = u.target
              return t.kind === 'op' && t.key !== 'blade' ? () => onChange(confirmOp(op, t.key as CutDefaultKey)) : undefined
            }} />
        </div>
      )}
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
            options={[{ value: NONE, label: op.kind === 'rough3d' ? (op.pattern === 'undercut' ? 'Pick automatically (lollipop reaching furthest)' : 'Pick automatically (bull-nose first)') : op.kind === 'finish3d' && (op.strategy === 'projection' || op.strategy === 'pencil') ? 'Pick automatically (smallest ball-nose first)' : op.kind === 'finish3d' && op.strategy === 'flat' ? 'Pick automatically (widest flat-bottomed tool)' : op.kind === 'finish3d' && op.strategy === 'undercut' ? 'Pick automatically (lollipop reaching furthest)' : 'Pick automatically (ball-nose first)' }, ...allowed.map((t) => ({ value: t.id, label: `T${t.number} · ${t.name} · Ø${t.diameter}` }))]}
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
            badge={toolItem && <ConfigureBadge item={toolItem} />}
          />
          <SelectField
            label="Face"
            value={String(op.face)}
            options={[1, 2, 3, 4, 5, 6].map((f) => ({ value: String(f), label: ['Top (1)', 'Front edge (2)', 'Right edge (3)', 'Back edge (4)', 'Left edge (5)', 'Underside (6)'][f - 1] }))}
            onChange={(v) => set('face', Number(v) as FaceId)}
          />
        </Group>
      )}

      {(op.kind === 'chamfer' || op.kind === 'curve') && (
        <Group title="Passes">
          {op.kind === 'curve' && op.mode === 'follow3d' && <NumField label="Depth below the curve" value={op.levels.depth} min={0} step={0.1} onChange={(v) => lv({ depth: v })} />}
          {!(op.kind === 'curve' && op.mode === 'between') && (
            <>
              <NumField label="Depth per pass" value={op.levels.passDepth} min={0} onChange={(v) => lv({ passDepth: v })} hint={op.kind === 'curve' && op.mode === 'zwave' ? '0 = one pass to the full wave' : '0 = tool stepdown'} />
              <NumField label="Number of cuts" suffix="" value={op.levels.cuts ?? 0} min={0} onChange={(v) => lv({ cuts: Math.round(v) || undefined })} hint="0 = from depth per pass" />
            </>
          )}
          <NumField label="Safe height" value={op.levels.safeZ} min={0} onChange={(v) => lv({ safeZ: v })} />
          <NumField label="Rapid down to" value={op.levels.rapidZ} min={0} onChange={(v) => lv({ rapidZ: v })} />
        </Group>
      )}

      {(op.kind === 'manual' || op.kind === 'edge') && (
        <Group title="Heights">
          <NumField label="Safe height" value={op.levels.safeZ} min={0} onChange={(v) => lv({ safeZ: v })} />
          <NumField label="Rapid down to" value={op.levels.rapidZ} min={0} onChange={(v) => lv({ rapidZ: v })} />
        </Group>
      )}

      {op.kind !== 'code' && op.kind !== 'chamfer' && op.kind !== 'curve' && op.kind !== 'manual' && op.kind !== 'edge' && !OPS_3D.has(op.kind) && (
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

      <StrategyFields op={op} part={part} onChange={onChange} sel={sel} tool={tp?.tool ?? resolveTool(op, machine)} />
      {op.kind === 'manual' && <ManualFields op={op} onChange={onChange} pathPick={pathPick ?? null} setPathPick={setPathPick} sel={sel} part={part} />}
      {op.kind !== 'code' && op.kind !== 'drill' && <EditsGroup op={op} part={part} machine={machine} tp={tp} sel={sel} onChange={onChange} />}

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
          <NumField label="Feed" suffix="mm/min" value={op.feeds.feed ?? tp?.feeds.feed ?? 0} min={0} step={100} onChange={(v) => set('feeds', { ...op.feeds, feed: v || undefined })} badge={feedItem && <ConfigureBadge item={feedItem} />} />
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

/** Adaptive clearing settings (pockets and Z-level roughing). */
function AdaptiveFields({ ad, onAd, rampAngle, onRamp, width }: { ad: AdaptiveSettings; onAd: (patch: Partial<AdaptiveSettings>, confirmWidth?: boolean) => void; rampAngle: number; onRamp: (v: number) => void; width?: { cfg: string; badge: React.ReactNode } }) {
  return (
    <>
      <NumField label="Width of cut" suffix="%" value={Math.round(ad.width * 1000) / 10} min={2} max={60} step={1} cfg={width?.cfg} badge={width?.badge} onChange={(v) => onAd({ width: v / 100, angle: undefined }, true)} hint={`Of the tool diameter · ${(Math.acos(Math.max(-1, 1 - 2 * ad.width)) * 180 / Math.PI).toFixed(0)}° engagement · placeholder default`} />
      <NumField label="Or engagement angle" suffix="°" value={ad.angle ?? 0} min={0} max={180} onChange={(v) => onAd({ angle: v > 0 ? v : undefined, ...(v > 0 ? { width: (1 - Math.cos((v * Math.PI) / 180)) / 2 } : {}) })} hint="0 = use the width" />
      <NumField label="Smoothing radius" value={ad.smoothing} min={0} step={0.5} onChange={(v) => onAd({ smoothing: v })} hint="Smallest turn of the path; 0 = turn freely" />
      <NumField label="Lift for moves back" value={ad.lift} min={0} step={0.1} onChange={(v) => onAd({ lift: v })} hint="Through cleared area only" />
      <NumField label="Adaptive feed up to" suffix="×" value={ad.feedBoost} min={1} max={3} step={0.1} onChange={(v) => onAd({ feedBoost: Math.max(1, v) })} hint="Lighter cuts and moves back run faster; 1 = off" />
      <NumField label="Helix angle" suffix="°" value={rampAngle} min={1} max={45} onChange={onRamp} hint="Entries are always helixes" />
    </>
  )
}

/** Edge work with a rotating aggregate (5AX-04). */
function EdgeFields({ op, part, onChange }: { op: Extract<CamOp, { kind: 'edge' }>; part: CamPart; onChange: (o: CamOp) => void }) {
  const aggregate = useStore((s) => machineModelOf(s.data!.machine).capabilities.aggregate)
  const machine = useStore((s) => s.data!.machine)
  const tool = resolveTool(op, machine)
  const agg = aggregateOf(machine, tool)
  const c = useOpCfg(op, part, onChange)
  return (
    <Group title="Edge work (aggregate)">
      {!aggregate && (
        <div className="col-span-2 flex flex-wrap items-center gap-2 rounded border border-amber-400/30 bg-amber-400/10 p-2 text-[11px] text-amber-100">
          <span className="min-w-0 flex-1">The machine model has no rotating aggregate (Machine &amp; tools → Aggregate head fitted). This is simulated only; the export checker refuses it.</span>
          <ConfigureBadge item={{ key: 'model:aggregate', label: 'Rotating aggregate fitted or not', value: 'not fitted', group: 'Machine model', target: { kind: 'model', fact: 'aggregate' } }} />
        </div>
      )}
      <NumField label="Tool axis below face 1" value={op.height} min={0} step={0.5} cfg={c('edgeHeight').cfg} badge={c('edgeHeight').badge} onChange={(v) => c('edgeHeight').set({ ...op, height: v })} />
      <NumField label="Reach into the edge" value={op.reach} min={0} step={0.5} cfg={c('edgeReach').cfg} badge={c('edgeReach').badge} onChange={(v) => c('edgeReach').set({ ...op, reach: v })} />
      <NumField label="Reach per pass" value={op.reachPass} min={0} step={0.5} onChange={(v) => onChange({ ...op, reachPass: v })} hint="0 = one pass" />
      <SelectField label="Travel" value={op.direction} options={[{ value: 'climb', label: 'Material on the left' }, { value: 'conventional', label: 'Material on the right' }]} onChange={(v) => onChange({ ...op, direction: v })} />
      <NumField label="Run on past open ends" value={op.overrun} min={0} onChange={(v) => onChange({ ...op, overrun: v })} />
      <div className="self-end pb-1.5 text-[11px] text-stone-400">{op.geometry.length ? `${op.geometry.length} edge shape(s)` : 'No shapes picked: the part outline'}</div>
      <div className="col-span-2 text-[11px] text-stone-400">
        {agg ? `Aggregate: ${agg.name} (${agg.angles.mode === 'any' ? 'any angle' : `angles ${agg.angles.list.join(', ')}°`}); its housing and angles are checked.` : `T${tool?.number ?? '?'} has no aggregate in the tool table (Machine & tools → tool → Aggregate): the housing and head angles are not checked.`}
      </div>
      <div className="col-span-2 text-[11px] text-stone-400">A flat tool on an aggregate turning about the vertical axis, kept square to the edge. Never written to woodWOP until the aggregate's macro is confirmed.</div>
    </Group>
  )
}

/** Saw-cut settings (2D-11). Off: the Stage 1 groove (plunge at the start of each line). */
function SawFields({ op, onChange }: { op: Extract<CamOp, { kind: 'saw' }>; onChange: (o: CamOp) => void }) {
  const more25d = useStore((s) => featuresOf(s.data?.settings).camMore25d)
  const st = op.saw
  const patch = (p: Partial<NonNullable<typeof st>>) => onChange({ ...op, saw: { ...DEFAULT_SAW, ...st, ...p } })
  if (!st && !more25d) return null
  return (
    <Group title="Saw cut">
      <div className="col-span-2">
        <SwitchField label="Blade settings" checked={!!st} onChange={(v) => onChange({ ...op, saw: v ? { ...DEFAULT_SAW } : undefined })} hint="Run-out from the blade, extend to clear, joining, minimum length, keep off neighbours, angled cuts. Off: the blade plunges at the start of each line." />
      </div>
      {st && (
        <>
          <NumField label="Blade tilt" suffix="°" value={st.tilt} min={0} max={45} onChange={(v) => patch({ tilt: v })} hint="0 = vertical. Angled cuts are simulated only" />
          {st.tilt > 0 && <SelectField label="Leans to" value={st.tiltSide} options={[{ value: 'left', label: 'Left of the line' }, { value: 'right', label: 'Right of the line' }]} onChange={(v) => patch({ tiltSide: v })} />}
          <NumField label="Blade Ø for this cut" value={st.blade ?? 0} min={0} cfg={`op:${op.id}:blade`} onChange={(v) => patch({ blade: v > 0 ? v : undefined })} hint="0 = the tool's (Machine & tools)" />
          <NumField label="Extra length each end" value={st.extend} min={0} onChange={(v) => patch({ extend: v })} />
          <NumField label="Skip lines shorter than" value={st.minLength} min={0} onChange={(v) => patch({ minLength: v })} />
          <div className="col-span-2">
            <SwitchField label="Extend to clear" checked={st.clear} onChange={(v) => patch({ clear: v })} hint="Full depth right to the line ends (the blade runs past them at the surface). Off: the surface cut stays on the line and the floor stops short." />
            <SwitchField label="Join lines on one line" checked={st.join} onChange={(v) => patch({ join: v })} />
            <SwitchField label="Keep off neighbouring parts" checked={st.avoid} onChange={(v) => patch({ avoid: v })} hint="The blade never cuts outside the part outline; ends are pulled back and the uncut length is reported." />
          </div>
        </>
      )}
    </Group>
  )
}

/** Finishing strategies added in M3.1 (shown while their switch is on, or when an operation uses one). */
const MORE_FINISH: ReadonlySet<string> = new Set(['radial', 'spiral', 'scallop', 'flat', 'helical', 'undercut', 'curve'])

/** What guides curve-driven passes, for the operation list. */
const DRIVE_LABEL: Record<CurveDrive['mode'], string> = { curves: 'along drive curves', toolpath: 'along an earlier toolpath', intersection: 'along where two surfaces meet', parameter: "along a surface's rows or columns" }

const groupList = (g?: number[]) => (g ?? []).join(', ')
const parseGroups = (v: string) => v.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 0)

/** Rest machining settings of a 3D finishing operation. */
function restGroup(op: Extract<CamOp, { kind: 'finish3d' }>, part: CamPart, adaptiveOn: boolean, onChange: (o: CamOp) => void) {
  return (
    (adaptiveOn || op.rest) && (
        <Group title="Rest machining">
          <div className="col-span-2">
            <SwitchField
              label="Rest machining"
              checked={!!op.rest}
              onChange={(v) => onChange({ ...op, rest: v ? { from: [], minThickness: 0.1 } : undefined })}
              hint="Cut only where earlier operations left material this tool can reach, worked out by simulating their toolpaths."
            />
          </div>
          {op.rest && (
            <>
              <SelectField
                label="Left by"
                value={op.rest.from[0] ?? NONE}
                options={[{ value: NONE, label: 'Every earlier operation' }, ...part.ops.slice(0, Math.max(0, part.ops.findIndex((o) => o.id === op.id))).filter((o) => REST_SOURCE_KINDS_3D.has(o.kind)).map((o) => ({ value: o.id, label: o.name }))]}
                onChange={(v) => onChange({ ...op, rest: { ...op.rest!, from: v === NONE ? [] : [v] } })}
              />
              <NumField label="Leave out rest thinner than" value={op.rest.minThickness} min={0.01} step={0.05} onChange={(v) => onChange({ ...op, rest: { ...op.rest!, minThickness: v } })} hint="Measured square to the surface, over the stock to leave" />
            </>
          )}
        </Group>
      )
  )
}

function StrategyFields({ op, part, onChange, sel = [], tool = null }: { op: CamOp; part: CamPart; onChange: (o: CamOp) => void; sel?: string[]; tool?: Tool | null }) {
  const adaptiveOn = useStore((s) => featuresOf(s.data?.settings).camAdaptive)
  const finishMore = useStore((s) => featuresOf(s.data?.settings).cam3dFinishMore)
  const machine = useStore((s) => s.data!.machine)
  const c = useOpCfg(op, part, onChange)
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
            { value: 'pencil', label: 'Pencil: along valleys and inside corners' },
            ...(finishMore || MORE_FINISH.has(op.strategy)
              ? [
                  { value: 'radial' as const, label: 'Radial: straight passes out from a centre' },
                  { value: 'spiral' as const, label: 'Spiral: one spiral round a centre' },
                  { value: 'scallop' as const, label: 'Scallop: the same cusp height everywhere' },
                  { value: 'flat' as const, label: 'Flat areas: offset passes on flats only' },
                  { value: 'helical' as const, label: 'Helical: one continuous descent round walls' },
                  { value: 'undercut' as const, label: 'Undercut: a lollipop under overhangs' },
                  { value: 'curve' as const, label: 'Curve-driven: guided by curves, a toolpath or a surface' },
                ]
              : []),
          ]}
          onChange={(v) => onChange({ ...op, strategy: v })}
        />
      )
      if (op.strategy === 'flat')
        return (
          <>
            <SurfaceGroup op={op} part={part} onSurface={(surface) => onChange({ ...op, surface })} />
            <Group title="Flat-area passes">
              {strategy}
              <NumField label="Step-over" value={op.stepover} min={0.01} step={0.1} cfg={c('finishStepover').cfg} badge={c('finishStepover').badge} onChange={(v) => c('finishStepover').set({ ...op, stepover: v })} hint="Between the rings, mm" />
              <SelectField label="Order" value={op.travel ?? 'inward'} options={[{ value: 'inward', label: 'From the edge in' }, { value: 'outward', label: 'From the middle out' }]} onChange={(v) => onChange({ ...op, travel: v })} />
              <SelectField label="Rings run" value={op.direction} options={[{ value: 'climb', label: 'Counter-clockwise' }, { value: 'conventional', label: 'Clockwise' }]} onChange={(v) => onChange({ ...op, direction: v })} />
              <div className="col-span-2 self-end pb-1.5 text-[11px] text-stone-400">Only where the tool rests on a face flatter than 0.5°: the first ring follows the edge of each flat area (traced to 0.01 mm), the next ones step in. A flat-bottomed tool is picked first. On level flats each ring can go to woodWOP as a contour at its depth (switch "Write 3D roughing, waterline and flat areas", off); a face not quite level makes it simulation only.</div>
            </Group>
            {restGroup(op, part, adaptiveOn, onChange)}
          </>
        )
      if (op.strategy === 'curve') {
        const d: CurveDrive = op.drive ?? { mode: 'curves' }
        const setDrive = (patch: Partial<CurveDrive>) => onChange({ ...op, drive: { ...d, ...patch } })
        const lines = sel.filter((id) => part.entities.some((e) => e.id === id && e.face === 1))
        const shapes = d.shapes ?? []
        const earlier = part.ops.slice(0, Math.max(0, part.ops.findIndex((o) => o.id === op.id))).filter((o) => o.enabled && o.face === 1 && o.kind !== 'code')
        const gridModels = (part.models ?? []).filter((m) => m.grid && m.grid.blob === m.blob)
        const copies = d.mode === 'toolpath' || (d.mode === 'curves' && shapes.length !== 2)
        return (
          <>
            <SurfaceGroup op={op} part={part} onSurface={(surface) => onChange({ ...op, surface })} />
            <Group title="Curve-driven passes">
              {strategy}
              <SelectField
                label="Guided by"
                value={d.mode}
                options={[
                  { value: 'curves', label: 'Drive curves (one or two shapes)' },
                  { value: 'toolpath', label: 'An earlier toolpath' },
                  { value: 'intersection', label: 'Where two surfaces meet' },
                  { value: 'parameter', label: "A surface's rows or columns" },
                ]}
                onChange={(v) => setDrive({ mode: v })}
              />
              {d.mode !== 'intersection' && <NumField label="Step-over" value={op.stepover} min={0.01} step={0.1} cfg={c('finishStepover').cfg} badge={c('finishStepover').badge} onChange={(v) => c('finishStepover').set({ ...op, stepover: v })} hint={d.mode === 'parameter' ? 'Between lines, measured on the surface' : 'Between passes, in plan'} />}
              {d.mode === 'curves' && (
                <div className="col-span-2 flex items-center gap-2 text-[11px] text-stone-400">
                  <span className="min-w-0 flex-1">{shapes.length === 2 ? '2 drive shapes: passes blended from one to the other' : shapes.length === 1 ? '1 drive shape: the shape and copies offset from it' : shapes.length ? `${shapes.length} shapes picked: pick one or two` : 'No drive shapes yet: select one or two shapes on face 1'}</span>
                  <Button size="sm" variant="outline" className="h-6 border-white/15 bg-transparent px-2 text-[11px]" disabled={!lines.length} onClick={() => setDrive({ shapes: lines })}>
                    Use selection as drive
                  </Button>
                </div>
              )}
              {d.mode === 'toolpath' && (
                <SelectField className="col-span-2" label="Follow the toolpath of" value={d.opId ?? NONE} options={[{ value: NONE, label: 'Choose an earlier operation' }, ...earlier.map((o) => ({ value: o.id, label: o.name }))]} onChange={(v) => setDrive({ opId: v === NONE ? undefined : v })} />
              )}
              {copies && (
                <>
                  <SelectField label="Copies" value={d.side ?? 'both'} options={[{ value: 'both', label: 'Both sides' }, { value: 'left', label: 'Left side only' }, { value: 'right', label: 'Right side only' }]} onChange={(v) => setDrive({ side: v })} />
                  {d.copies !== undefined && <NumField label="Copies each side" suffix="" value={d.copies} min={0} step={1} onChange={(v) => setDrive({ copies: Math.max(0, Math.round(v)) })} hint="0 = the drive only" />}
                  <div className="col-span-2">
                    <SwitchField label="As many copies as the boundary holds" checked={d.copies === undefined} onChange={(v) => setDrive({ copies: v ? undefined : 0 })} hint="Copies a step-over apart (in plan) until they leave the boundary; open drives' copies stop square to their ends." />
                  </div>
                </>
              )}
              {d.mode === 'intersection' && (
                <>
                  <TextField label="First surface: groups" value={groupList(d.groupsA)} onChange={(v) => setDrive({ groupsA: parseGroups(v) })} />
                  <TextField label="Second surface: groups" value={groupList(d.groupsB)} onChange={(v) => setDrive({ groupsB: parseGroups(v) })} />
                  <div className="col-span-2 text-[11px] text-stone-400">One pass along each line where facets of the two meet. A ball-nose touches both where they make a valley and rides over the edge where they make a ridge. Lines running nearly upright are left out.</div>
                </>
              )}
              {d.mode === 'parameter' && (
                <>
                  <SelectField label="Surface" value={d.modelId ?? NONE} options={[{ value: NONE, label: 'The model machined' }, ...gridModels.filter((m) => m.id !== op.surface.modelId).map((m) => ({ value: m.id, label: m.name }))]} onChange={(v) => setDrive({ modelId: v === NONE ? undefined : v })} />
                  <SelectField label="Along its" value={d.along ?? 'rows'} options={[{ value: 'rows', label: 'Rows' }, { value: 'columns', label: 'Columns' }]} onChange={(v) => setDrive({ along: v })} />
                  <div className="col-span-2 text-[11px] text-stone-400">Surfaces made in the app (Surfaces: revolve, ruled, loft, sweep, extrude; or a solid's face untrimmed) keep their rows and columns. The tool is placed to touch each line.</div>
                </>
              )}
              <SelectField label="Pattern" value={op.pattern} options={[{ value: 'zigzag', label: 'Back and forth' }, { value: 'oneway', label: 'One way' }]} onChange={(v) => onChange({ ...op, pattern: v })} />
              {op.pattern === 'oneway' && <SelectField label="Direction" value={op.direction} options={[{ value: 'climb', label: 'Along the drive' }, { value: 'conventional', label: 'Against the drive' }]} onChange={(v) => onChange({ ...op, direction: v })} />}
              <NumField label="Slope from" suffix="°" value={op.slope.min} min={0} max={90} onChange={(v) => onChange({ ...op, slope: { ...op.slope, min: v } })} />
              <NumField label="Slope to" suffix="°" value={op.slope.max} min={0} max={90} onChange={(v) => onChange({ ...op, slope: { ...op.slope, max: v } })} />
            </Group>
            <Group title="Keep to one side">
              <TextField label="Of groups (empty = off)" value={groupList(op.keepSide?.groups)} onChange={(v) => {
                const g = parseGroups(v)
                onChange({ ...op, keepSide: g.length ? { groups: g, side: op.keepSide?.side ?? 'front' } : undefined })
              }} />
              {op.keepSide && <SelectField label="Side" value={op.keepSide.side} options={[{ value: 'front', label: 'In front (the side they face)' }, { value: 'back', label: 'Behind them' }]} onChange={(v) => onChange({ ...op, keepSide: { ...op.keepSide!, side: v } })} />}
              <div className="col-span-2 text-[11px] text-stone-400">These groups are never cut, and the passes stop where the tool would touch them or reach their other side.</div>
            </Group>
            {restGroup(op, part, adaptiveOn, onChange)}
          </>
        )
      }
      if (op.strategy === 'undercut')
        return (
          <>
            <SurfaceGroup op={op} part={part} onSurface={(surface) => onChange({ ...op, surface })} />
            <Group title="Undercut passes">
              {strategy}
              <NumField label="Step-over" value={op.stepover} min={0.01} step={0.1} cfg={c('finishStepover').cfg} badge={c('finishStepover').badge} onChange={(v) => c('finishStepover').set({ ...op, stepover: v })} />
              <NumField label="Angle" suffix="°" value={op.angle} onChange={(v) => onChange({ ...op, angle: v })} hint="Best square to the overhang's edge" />
              <SelectField label="Pattern" value={op.pattern} options={[{ value: 'zigzag', label: 'Back and forth' }, { value: 'oneway', label: 'One way' }]} onChange={(v) => onChange({ ...op, pattern: v })} />
              <SelectField label="Cut" value={op.undercut ?? 'both'} options={[{ value: 'both', label: 'Undersides and floors beneath' }, { value: 'underside', label: 'Undersides of overhangs' }, { value: 'floor', label: 'Floors beneath overhangs' }]} onChange={(v) => onChange({ ...op, undercut: v })} />
              <div className="col-span-2 self-end pb-1.5 text-[11px] text-stone-400">Needs a lollipop tool (a ball on a narrower neck). Its neck keeps the collision margin (Machine page) clear of the model, so the ball reaches under by its radius less the neck's radius and the margin. The tool goes in and out sideways at the pass's height, where the way up is clear. It only finishes: the material under the overhang must be cleared first (Z-level roughing cannot reach it). The simulator keeps the material under the overhang, and its collision check shows where the neck would meet uncut material.</div>
            </Group>
            {restGroup(op, part, adaptiveOn, onChange)}
          </>
        )
      if (op.strategy === 'helical')
        return (
          <>
            <SurfaceGroup op={op} part={part} onSurface={(surface) => onChange({ ...op, surface })} />
            <Group title="Helical passes">
              {strategy}
              <NumField label="Step-down per round" value={op.stepdown ?? 1} min={0.05} step={0.1} cfg={c('waterlineStepdown').cfg} badge={c('waterlineStepdown').badge} onChange={(v) => c('waterlineStepdown').set({ ...op, stepdown: v })} />
              <SelectField label="Direction" value={op.direction} options={[{ value: 'climb', label: 'Climb' }, { value: 'conventional', label: 'Conventional' }]} onChange={(v) => onChange({ ...op, direction: v })} />
              <NumField label="Slope from" suffix="°" value={op.slope.min} min={0} max={90} onChange={(v) => onChange({ ...op, slope: { ...op.slope, min: v } })} />
              <NumField label="Slope to" suffix="°" value={op.slope.max} min={0} max={90} onChange={(v) => onChange({ ...op, slope: { ...op.slope, max: v } })} />
              <div className="col-span-2 self-end pb-1.5 text-[11px] text-stone-400">Round each hill or hollow the tool sinks one step-down per round without stepping down in one place; where the walls split, join or stop, it cuts waterline passes.</div>
            </Group>
            {restGroup(op, part, adaptiveOn, onChange)}
          </>
        )
      if (op.strategy === 'scallop') {
        // cusp from the rounded end of the tool picked (ball radius, or corner radius of a bull-nose)
        const r = tool?.shape === 'ball' || tool?.shape === 'lollipop' ? tool.diameter / 2 : tool?.shape === 'bull' ? (tool.cornerRadius ?? 0) : 0
        const cusp = r > 0 && op.stepover < 2 * r ? r - Math.sqrt(r * r - (op.stepover / 2) ** 2) : NaN
        const starts = op.startFrom ?? []
        const lines = sel.filter((id) => part.entities.some((e) => e.id === id && e.face === 1))
        return (
          <>
            <SurfaceGroup op={op} part={part} onSurface={(surface) => onChange({ ...op, surface })} />
            <Group title="Scallop passes">
              {strategy}
              <NumField
                label="Step-over on flat ground"
                value={op.stepover}
                min={0.01}
                step={0.1}
                cfg={c('finishStepover').cfg}
                badge={c('finishStepover').badge}
                onChange={(v) => c('finishStepover').set({ ...op, stepover: v })}
                hint={Number.isFinite(cusp) ? `Cusp ${cusp.toFixed(3)} mm (${(cusp / 25.4).toFixed(4)} in) everywhere: passes come closer on slopes and curves` : 'Needs a ball-nose or bull-nose tool, wider than the step-over'}
              />
              <SelectField
                label="Start from"
                value={starts.length ? 'shapes' : 'boundary'}
                options={[
                  { value: 'boundary', label: 'The boundary (passes work in)' },
                  { value: 'shapes', label: 'Picked shapes (passes work out)' },
                ]}
                onChange={(v) => onChange({ ...op, startFrom: v === 'shapes' ? (lines.length ? lines : starts.length ? starts : []) : undefined })}
              />
              {(starts.length > 0 || lines.length > 0) && (
                <div className="col-span-2 flex items-center gap-2 text-[11px] text-stone-400">
                  <span>{starts.length ? `${starts.length} start shape(s)` : 'No start shapes: passes work in from the boundary'}</span>
                  <Button size="sm" variant="outline" className="h-6 border-white/15 bg-transparent px-2 text-[11px]" disabled={!lines.length} onClick={() => onChange({ ...op, startFrom: lines })}>
                    Use selection as start
                  </Button>
                </div>
              )}
              <SelectField label="Order" value={op.travel ?? 'inward'} options={[{ value: 'inward', label: 'Away from the start' }, { value: 'outward', label: 'Back towards the start' }]} onChange={(v) => onChange({ ...op, travel: v })} />
              <SelectField label="Loops run" value={op.direction} options={[{ value: 'climb', label: 'Counter-clockwise' }, { value: 'conventional', label: 'Clockwise' }]} onChange={(v) => onChange({ ...op, direction: v })} />
              <NumField label="Slope from" suffix="°" value={op.slope.min} min={0} max={90} onChange={(v) => onChange({ ...op, slope: { ...op.slope, min: v } })} />
              <NumField label="Slope to" suffix="°" value={op.slope.max} min={0} max={90} onChange={(v) => onChange({ ...op, slope: { ...op.slope, max: v } })} />
              <div className="col-span-2">
                <SwitchField label="Skip flat areas" checked={op.skipFlats} onChange={(v) => onChange({ ...op, skipFlats: v })} hint="Leaves surfaces under 0.5° for a flat-area pass" />
              </div>
              <div className="col-span-2 text-[11px] text-stone-400">Passes are offset over the surface, not in plan, and also run along the lines where they meet, so no ridge is left higher than the cusp. Steep walls: use waterline.</div>
            </Group>
            {restGroup(op, part, adaptiveOn, onChange)}
          </>
        )
      }
      if (op.strategy === 'radial' || op.strategy === 'spiral') {
        const radial = op.strategy === 'radial'
        return (
          <>
            <SurfaceGroup op={op} part={part} onSurface={(surface) => onChange({ ...op, surface })} />
            <Group title={radial ? 'Radial passes' : 'Spiral'}>
              {strategy}
              <NumField
                label={radial ? 'Largest gap' : 'Gap between turns'}
                value={op.stepover}
                min={0.01}
                step={0.1}
                cfg={c('finishStepover').cfg}
                badge={c('finishStepover').badge}
                onChange={(v) => c('finishStepover').set({ ...op, stepover: v })}
                hint={radial ? 'Between neighbouring passes, at the outer edge; passes stop in turn towards the centre' : 'Measured in plan'}
              />
              <NumField label={radial ? 'First pass at' : 'Start at'} suffix="°" value={op.angle} onChange={(v) => onChange({ ...op, angle: v })} hint="From +X" />
              <div className="col-span-2">
                <SwitchField
                  label="Centre in the middle of the boundary"
                  checked={!op.centre}
                  onChange={(v) => onChange({ ...op, centre: v ? undefined : { x: part.length / 2, y: part.width / 2 } })}
                  hint="The middle of the drawn boundary, or of the model when none is drawn"
                />
              </div>
              {op.centre && (
                <>
                  <NumField label="Centre X" value={op.centre.x} onChange={(v) => onChange({ ...op, centre: { ...op.centre!, x: v } })} />
                  <NumField label="Centre Y" value={op.centre.y} onChange={(v) => onChange({ ...op, centre: { ...op.centre!, y: v } })} />
                </>
              )}
              <NumField label="Inner radius" value={op.innerRadius ?? 0} min={0} onChange={(v) => onChange({ ...op, innerRadius: v || undefined })} hint="Leave this much round the centre uncut" />
              {radial && <SelectField label="Pattern" value={op.pattern} options={[{ value: 'zigzag', label: 'Out and back' }, { value: 'oneway', label: 'One way' }]} onChange={(v) => onChange({ ...op, pattern: v })} />}
              {(!radial || op.pattern === 'oneway') && (
                <SelectField label="Travel" value={op.travel ?? 'outward'} options={[{ value: 'outward', label: 'Out from the centre' }, { value: 'inward', label: 'In to the centre' }]} onChange={(v) => onChange({ ...op, travel: v })} />
              )}
              {!radial && <SelectField label="Turn" value={op.direction} options={[{ value: 'climb', label: 'Counter-clockwise' }, { value: 'conventional', label: 'Clockwise' }]} onChange={(v) => onChange({ ...op, direction: v })} />}
              <NumField label="Slope from" suffix="°" value={op.slope.min} min={0} max={90} onChange={(v) => onChange({ ...op, slope: { ...op.slope, min: v } })} />
              <NumField label="Slope to" suffix="°" value={op.slope.max} min={0} max={90} onChange={(v) => onChange({ ...op, slope: { ...op.slope, max: v } })} />
              <div className="col-span-2">
                <SwitchField label="Skip flat areas" checked={op.skipFlats} onChange={(v) => onChange({ ...op, skipFlats: v })} hint="Leaves surfaces under 0.5° for a flat-area pass" />
              </div>
            </Group>
            {restGroup(op, part, adaptiveOn, onChange)}
          </>
        )
      }
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
      const rest = restGroup(op, part, adaptiveOn, onChange)
      if (op.strategy === 'pencil')
        return (
          <>
            <SurfaceGroup op={op} part={part} onSurface={(surface) => onChange({ ...op, surface })} />
            <Group title="Pencil passes">
              {strategy}
              <NumField label="Valleys sharper than" suffix="°" value={op.pencilAngle ?? PENCIL_MIN_ANGLE} min={1} max={90} onChange={(v) => onChange({ ...op, pencilAngle: v })} hint="Angle between the two surfaces; placeholder default" />
              <div className="self-end pb-1.5 text-[11px] text-stone-400">One pass along each valley, where the tool touches both sides.</div>
            </Group>
            {rest}
          </>
        )
      return (
        <>
          <SurfaceGroup op={op} part={part} onSurface={(surface) => onChange({ ...op, surface })} />
          <Group title={waterline ? 'Waterline passes' : 'Parallel passes'}>
            {strategy}
            {waterline && <NumField label="Step-down" value={op.stepdown ?? 1} min={0.05} step={0.1} cfg={c('waterlineStepdown').cfg} badge={c('waterlineStepdown').badge} onChange={(v) => c('waterlineStepdown').set({ ...op, stepdown: v })} />}
            {waterline && <SelectField label="Direction" value={op.direction} options={[{ value: 'climb', label: 'Climb' }, { value: 'conventional', label: 'Conventional' }]} onChange={(v) => onChange({ ...op, direction: v })} />}
            <NumField label={waterline ? 'Fill step-over' : 'Step-over'} value={op.stepover} min={0.01} step={0.1} cfg={c('finishStepover').cfg} badge={c('finishStepover').badge} onChange={(v) => c('finishStepover').set({ ...op, stepover: v })} hint={waterline ? 'For the shallow-area fill' : undefined} />
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
          {rest}
        </>
      )
    }
    case 'rough3d': {
      const adaptive = op.pattern === 'adaptive'
      const ad = op.adaptive ?? DEFAULT_ADAPTIVE
      const patterns = [{ value: 'offset' as const, label: 'Follow shape' }, { value: 'zigzag' as const, label: 'Back and forth' }]
      const undercutPattern = finishMore || op.pattern === 'undercut' ? [{ value: 'undercut' as const, label: 'Undercuts (lollipop, under overhangs)' }] : []
      // moving to or from undercut roughing takes that pattern's own placeholder cutting values
      const setPattern = (v: Rough3dOp['pattern']) => {
        const was = op.pattern === 'undercut'
        const now = v === 'undercut'
        const d = was !== now ? (newOpDefaults('rough3d', machine, { pattern: v } as Partial<CamOp>) as Partial<Rough3dOp>) : {}
        onChange({ ...op, ...d, pattern: v, confirmed: was !== now ? op.confirmed?.filter((k) => !['roughStepdown', 'roughStepover', 'undercutStepdown', 'undercutStepover'].includes(k)) : op.confirmed, ...(v === 'adaptive' && !op.adaptive ? { adaptive: { ...DEFAULT_ADAPTIVE } } : {}) })
      }
      if (op.pattern === 'undercut')
        return (
          <>
            <SurfaceGroup op={op} part={part} onSurface={(surface) => onChange({ ...op, surface })} />
            <Group title="Undercut levels">
              <SelectField label="Pattern" value={op.pattern} options={[...patterns, ...undercutPattern]} onChange={setPattern} />
              <NumField label="Step-down" value={op.stepdown} min={0.1} step={0.25} cfg={c('undercutStepdown').cfg} badge={c('undercutStepdown').badge} onChange={(v) => c('undercutStepdown').set({ ...op, stepdown: v })} hint="Between levels (ball centre heights)" />
              <NumField label="Step-over" suffix="%" value={Math.round(op.stepover * 100)} min={2} max={95} cfg={c('undercutStepover').cfg} badge={c('undercutStepover').badge} onChange={(v) => c('undercutStepover').set({ ...op, stepover: v / 100 })} hint="Of the ball's diameter, between passes" />
              <NumField label="Safe height" value={op.levels.safeZ} min={0} onChange={(v) => onChange({ ...op, levels: { ...op.levels, safeZ: v } })} />
              <NumField label="Rapid down to" value={op.levels.rapidZ} min={0} onChange={(v) => onChange({ ...op, levels: { ...op.levels, rapidZ: v } })} hint="Above the model, beside the overhang" />
              <div className="col-span-2 text-[11px] text-stone-400">
                Clears the material under overhangs that roughing from above leaves, before undercut finishing: level by level, working in from the open side; the tool goes down and up only beside the overhang. The ball reaches in as far as its radius less its neck and the collision margin. The stock to leave is left on every face. Simulation only: never written to a machine.
              </div>
            </Group>
          </>
        )
      return (
        <>
          <SurfaceGroup op={op} part={part} onSurface={(surface) => onChange({ ...op, surface })} walls />
          <Group title="Levels">
            <NumField label="Leave on floors" value={op.stockZ} min={0} step={0.1} onChange={(v) => onChange({ ...op, stockZ: v })} />
            <NumField label="Step-down" value={op.stepdown} min={0.1} step={0.5} cfg={c('roughStepdown').cfg} badge={c('roughStepdown').badge} onChange={(v) => c('roughStepdown').set({ ...op, stepdown: v })} />
            <SelectField
              label="Pattern"
              value={op.pattern}
              options={[...(adaptiveOn || adaptive ? [...patterns, { value: 'adaptive' as const, label: 'Adaptive (steady width of cut)' }] : patterns), ...undercutPattern]}
              onChange={setPattern}
            />
            {!adaptive && <NumField label="Step-over" suffix="%" value={Math.round(op.stepover * 100)} min={5} max={95} cfg={c('roughStepover').cfg} badge={c('roughStepover').badge} onChange={(v) => c('roughStepover').set({ ...op, stepover: v / 100 })} />}
            {op.pattern === 'zigzag' && <NumField label="Angle" suffix="°" value={op.angle} onChange={(v) => onChange({ ...op, angle: v })} />}
            <SelectField label="Direction" value={op.direction} options={[{ value: 'climb', label: 'Climb' }, { value: 'conventional', label: 'Conventional' }]} onChange={(v) => onChange({ ...op, direction: v })} />
            {adaptive ? (
              <AdaptiveFields ad={ad} onAd={(patch, cw) => (cw ? c('adaptiveWidth').set : onChange)({ ...op, adaptive: { ...ad, ...patch } })} rampAngle={op.rampAngle} onRamp={(v) => onChange({ ...op, rampAngle: v })} width={{ cfg: c('adaptiveWidth').cfg, badge: c('adaptiveWidth').badge }} />
            ) : (
              <>
                <SelectField label="Entry" value={op.entry} options={[{ value: 'helix', label: 'Helix' }, { value: 'ramp', label: 'Ramp' }, { value: 'plunge', label: 'Straight down' }]} onChange={(v) => onChange({ ...op, entry: v })} />
                <NumField label="Ramp angle" suffix="°" value={op.rampAngle} min={1} max={45} onChange={(v) => onChange({ ...op, rampAngle: v })} />
              </>
            )}
            <NumField label="Safe height" value={op.levels.safeZ} min={0} onChange={(v) => onChange({ ...op, levels: { ...op.levels, safeZ: v } })} />
            <NumField label="Rapid down to" value={op.levels.rapidZ} min={0} onChange={(v) => onChange({ ...op, levels: { ...op.levels, rapidZ: v } })} hint="Above the level just cut" />
            <div className="col-span-2">
              <SwitchField label="Extra levels on flat areas" checked={op.flats} onChange={(v) => onChange({ ...op, flats: v })} hint="A level at the height of every flat area of the model, so flats are left with only the floor stock" />
            </div>
          </Group>
        </>
      )
    }
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
            <AdaptiveFields ad={ad} onAd={(patch, cw) => (cw ? c('adaptiveWidth').set : onChange)({ ...op, adaptive: { ...ad, ...patch } })} rampAngle={op.rampAngle} onRamp={(v) => onChange({ ...op, rampAngle: v })} width={{ cfg: c('adaptiveWidth').cfg, badge: c('adaptiveWidth').badge }} />
          ) : (
            <>
              <NumField label="Stepover" suffix="%" value={Math.round(op.stepover * 100)} min={5} max={95} cfg={c('pocketStepover').cfg} badge={c('pocketStepover').badge} onChange={(v) => c('pocketStepover').set({ ...op, stepover: v / 100 })} />
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
    case 'saw':
      return <SawFields op={op} onChange={onChange} />
    case 'edge':
      return <EdgeFields op={op} part={part} onChange={onChange} />
    case 'chamfer':
      return (
        <Group title="Chamfer">
          <SelectField label="Size is the" value={op.drive} options={[{ value: 'width', label: 'Width on the face' }, { value: 'depth', label: 'Depth down the edge' }]} onChange={(v) => onChange({ ...op, drive: v })} />
          <NumField label={op.drive === 'width' ? 'Width' : 'Depth'} value={op.size} min={0} step={0.5} onChange={(v) => onChange({ ...op, size: v })} />
          <SelectField label="Cutter side" value={op.side} options={[{ value: 'outside', label: 'Outside' }, { value: 'inside', label: 'Inside' }, { value: 'left', label: 'Left of path' }, { value: 'right', label: 'Right of path' }]} onChange={(v) => onChange({ ...op, side: v })} />
          <SelectField label="Direction" value={op.direction} options={[{ value: 'climb', label: 'Climb' }, { value: 'conventional', label: 'Conventional' }]} onChange={(v) => onChange({ ...op, direction: v })} />
          <NumField label="Tip below the chamfer" value={op.tipOffset} min={0} step={0.25} onChange={(v) => onChange({ ...op, tipOffset: v })} hint="So the flank, not the point, cuts it" />
          <div className="self-end pb-1.5 text-[11px] text-stone-400">V cutter. Shapes on the face, or level 3D edges of a solid at their height.</div>
        </Group>
      )
    case 'curve':
      return (
        <Group title={{ between: 'Between two curves', follow3d: 'Along 3D curves', zwave: 'Z-wave' }[op.mode]}>
          <SelectField
            className="col-span-2"
            label="Cut"
            value={op.mode}
            options={[
              { value: 'between', label: 'Between two curves: the surface joining them' },
              { value: 'follow3d', label: 'Along 3D curves: the tip follows them' },
              { value: 'zwave', label: 'Z-wave: depth rising and falling along shapes' },
            ]}
            onChange={(v) => onChange({ ...op, mode: v })}
          />
          {op.mode === 'between' && (
            <>
              <NumField label="First curve depth" value={op.depthA} min={0} step={0.5} onChange={(v) => onChange({ ...op, depthA: v })} hint="When it is drawn in 2D" />
              <NumField label="Second curve depth" value={op.depthB} min={0} step={0.5} onChange={(v) => onChange({ ...op, depthB: v })} hint="3D polylines keep their heights" />
              <NumField label="Step-over" value={op.stepover} min={0.05} step={0.1} cfg={c('betweenStepover').cfg} badge={c('betweenStepover').badge} onChange={(v) => c('betweenStepover').set({ ...op, stepover: v })} hint="Largest gap between passes" />
              <div className="self-end pb-1.5">
                <SwitchField label="Back and forth" checked={op.zigzag} onChange={(v) => onChange({ ...op, zigzag: v })} />
              </div>
            </>
          )}
          {op.mode === 'follow3d' && (
            <div className="col-span-2">
              <SwitchField label="Smooth curve through the points" checked={op.smooth} onChange={(v) => onChange({ ...op, smooth: v })} hint="Off: straight pieces between the polyline's points" />
            </div>
          )}
          {op.mode === 'zwave' && (
            <>
              <NumField label="Shallowest" value={op.wave.min} min={0} step={0.25} cfg={c('zwave').cfg} badge={c('zwave').badge} onChange={(v) => c('zwave').set({ ...op, wave: { ...op.wave, min: v } })} />
              <NumField label="Deepest" value={op.wave.max} min={0} step={0.25} onChange={(v) => c('zwave').set({ ...op, wave: { ...op.wave, max: v } })} />
              <NumField label="Wave length" value={op.wave.length} min={0.5} step={1} onChange={(v) => c('zwave').set({ ...op, wave: { ...op.wave, length: v } })} hint="Closed shapes get a whole number of waves" />
              <SelectField label="Shape" value={op.wave.shape} options={[{ value: 'sine', label: 'Smooth' }, { value: 'triangle', label: 'Straight up and down' }]} onChange={(v) => onChange({ ...op, wave: { ...op.wave, shape: v } })} />
            </>
          )}
          <NumField label="Tolerance" value={op.tolerance} min={0.001} max={0.5} step={0.005} onChange={(v) => onChange({ ...op, tolerance: v })} />
          <div className="self-end pb-1.5 text-[11px] text-stone-400">Simulated only: the tool moves up and down along the path (true 3D output stays off).</div>
        </Group>
      )
    case 'face':
      return (
        <Group title="Facing">
          <SelectField label="Pattern" value={op.pattern} options={[{ value: 'zigzag', label: 'Back and forth' }, { value: 'offset', label: 'Rings from the outside in' }]} onChange={(v) => onChange({ ...op, pattern: v })} />
          <SelectField label="Direction" value={op.direction} options={[{ value: 'climb', label: 'Climb' }, { value: 'conventional', label: 'Conventional' }]} onChange={(v) => onChange({ ...op, direction: v })} />
          <NumField label="Step-over" suffix="%" value={Math.round(op.stepover * 100)} min={5} max={95} cfg={c('faceStepover').cfg} badge={c('faceStepover').badge} onChange={(v) => c('faceStepover').set({ ...op, stepover: v / 100 })} hint="Of the tool diameter" />
          {op.pattern === 'zigzag' && <NumField label="Angle" suffix="°" value={op.angle} onChange={(v) => onChange({ ...op, angle: v })} />}
          <NumField label="Tool centre past the edge" value={op.overhang} min={0} step={0.5} onChange={(v) => onChange({ ...op, overhang: v })} hint="0 = centre on the edge (the cutter still reaches its radius past it)" />
          <div className="self-end pb-1.5 text-[11px] text-stone-400">{op.geometry.length ? `${op.geometry.length} boundary shape(s)` : 'No boundary: the whole panel'}</div>
          <div className="col-span-2">
            <SwitchField label="Re-set the stock top" checked={op.resetTop} onChange={(v) => onChange({ ...op, resetTop: v })} hint="Later operations on the top measure their depths from the faced surface (3D operations keep following their model)." />
          </div>
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
