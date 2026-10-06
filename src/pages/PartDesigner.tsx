import { ArrowLeft, CirclePlay, Download, Drill, FileCode2, Maximize, Redo2, Undo2, CircleAlert, Box, Rotate3d, PenLine, Mountain } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { backend } from '@/app/backend'
import { partsOf, useStore } from '@/app/store'
import { deleteEntities, moveNode as nodeMove } from '@/cam/cad'
import { commit, historyOf, redo, undo, type History } from '@/cam/doc'
import { serializePartFile } from '@/cam/model/partFile'
import { evalLength, parseCoord, resolveVariables } from '@/cam/expr'
import { dist, type P } from '@/cam/geom'
import { ALL_SNAPS, SNAP_LABEL, type SnapMode, type SnapResult } from '@/cam/snap'
import { generateOp, inBackground, toolpathContours, type Toolpath } from '@/cam/toolpath'
import { exportDxf } from '@/cam/dxf'
import type { CamPart } from '@/cam/types'
import { EmptyState } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { featuresOf } from '@/core/features'
import { formatLength } from '@/core/units'
import { cn } from '@/lib/utils'
import { PartCanvas, type Display } from './part/Canvas'
import { hitEntity } from './part/hit'
import { OpsPanel } from './part/OpsPanel'
import { ProgramDialog } from './part/ProgramDialog'
import { SimulateDialog } from './part/SimulateDialog'
import { PatternDialog } from './part/PatternDialog'
import { PluginMenu } from './part/PluginMenu'
import { usablePatterns } from '@/core/hardware/patterns'
import { LayersPanel, PropertiesPanel } from './part/SidePanels'
import { AnnotationsPanel, DimsPanel } from './part/DimsPanel'
import { TurnSketchDialog } from './part/TurnSketchDialog'
import { PrintDialog } from './part/PrintDialog'
import { QueryDialog } from './part/QueryDialog'
import { FillHolesDialog } from './part/FillHolesDialog'
import { PanelDialog } from './part/PanelDialog'
import { ImageTraceDialog } from './part/ImageTraceDialog'
import { Model3DView } from './part/Model3DView'
import { ModelImportDialog } from './part/ModelImportDialog'
import { ReliefImportDialog } from './part/ReliefImportDialog'
import { ModelsPanel } from './part/ModelsPanel'
import { use3dToolpaths } from './part/use3dToolpaths'
import { appendStep } from '@/cam/more25d/edits'
import { useConfigureTarget } from '@/components/configureFocus'
import type { PathPick } from './part/OpsPanel'
import { type Click, DEFAULT_PARAMS, GROUP_LABEL, measureText, stepTool, TOOL_BY_ID, TOOLS, type ToolDef, type ToolGroup, type ToolId, type ToolParams } from './part/tools'

const PARAM_LABEL: Record<keyof ToolParams, string> = {
  radius: 'Radius',
  distance: 'Distance',
  sides: 'Sides',
  angle: 'Angle °',
  scale: 'Factor',
  width: 'Width',
  text: 'Text',
  height: 'Height',
  relief: 'Relief',
  removed: 'Material removed',
  allCorners: 'All corners',
  columns: 'Columns',
  rows: 'Rows',
  spacingX: 'Spacing X',
  spacingY: 'Spacing Y',
  gap: 'Gap',
  dimRadial: 'Show',
  dimAlt: 'Also the other unit',
  hatchAngle: 'Angle °',
  hatchSpacing: 'Spacing',
  hatchCross: 'Crossed',
  detailScale: 'Magnify ×',
  font: 'Font',
}
const fileBase = (s: string) => s.replace(/[^\w-]+/g, '-') || 'part'
const LENGTH_PARAMS = new Set<keyof ToolParams>(['radius', 'distance', 'width', 'height', 'spacingX', 'spacingY', 'gap', 'hatchSpacing'])

export function PartDesignerPage({ partId, jobId }: { partId: string; jobId?: string }) {
  const { data, go, savePart } = useStore()
  const stored = data ? partsOf(data, jobId).find((p) => p.id === partId) : undefined
  if (!data) return null
  if (!stored)
    return (
      <div className="p-6">
        <EmptyState icon={<CircleAlert className="size-5" />} title="Part not found" action={<Button onClick={() => go(jobId ? { page: 'job', jobId, tab: 'parts' } : { page: 'parts' })}>Back</Button>} />
      </div>
    )
  if (!featuresOf(data.settings).camCad)
    return (
      <div className="p-6">
        <EmptyState icon={<Box className="size-5" />} title="The custom-part designer is switched off">
          Turn it on under Machine & tools → Custom-part features.
        </EmptyState>
      </div>
    )
  return <Designer key={stored.id} initial={stored} jobId={jobId} onSave={(p) => savePart(p, jobId)} />
}

function Designer({ initial, jobId, onSave }: { initial: CamPart; jobId?: string; onSave: (p: CamPart) => void }) {
  const { data, go, savePart } = useStore()
  const units = data!.settings.units
  const machine = data!.machine
  const job = jobId ? data!.jobs.find((j) => j.id === jobId) : undefined
  const [hist, setHist] = useState<History<CamPart>>(() => historyOf(initial))
  const part = hist.present
  const [sel, setSel] = useState<string[]>([])
  const [toolId, setToolId] = useState<ToolId>('select')
  const [clicks, setClicks] = useState<Click[]>([])
  const [cadDialog, setCadDialog] = useState<{ k: 'sketch' | 'print' | 'query' | 'fill' | 'panels' | 'trace'; edit?: string } | null>(null)
  const [params, setParams] = useState<ToolParams>(DEFAULT_PARAMS)
  const [cursor, setCursor] = useState<SnapResult | null>(null)
  const [message, setMessage] = useState('')
  const [layer, setLayer] = useState('outline')
  const [prompt, setPrompt] = useState('')
  const [tab, setTab] = useState('ops')
  const [selectedOp, setSelectedOp] = useState<string | null>(null)
  const [hiddenOps, setHiddenOps] = useState<Set<string>>(new Set())
  const [nodeSeg, setNodeSeg] = useState<{ id: string; seg: number } | null>(null)
  /** Picking points for a hand-drawn toolpath (NEW-09): which operation, the kind of step and its height. */
  const [pathPick, setPathPickState] = useState<PathPick | null>(null)
  const [fitKey, setFitKey] = useState(0)
  const [programOpen, setProgramOpen] = useState(false)
  const [simOpen, setSimOpen] = useState(false)
  const [patternOpen, setPatternOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [reliefOpen, setReliefOpen] = useState(false)
  const [view3d, setView3d] = useState(false)
  const [display, setDisplay] = useState<Display>({ paths: true, arrows: false, grid: true, snapOn: true, ortho: false, modes: new Set<SnapMode>(ALL_SNAPS.filter((m) => m !== 'nearest')), gridSize: units === 'in' ? 25.4 / 4 : 5 })
  const promptRef = useRef<HTMLInputElement>(null)
  const first = useRef(true)
  const tool = TOOL_BY_ID[toolId]
  const fmt = useCallback((n: number) => formatLength(n, units), [units])

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    onSave(part)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [part])

  const change = useCallback((next: CamPart) => setHist((h) => commit(h, { ...next, updatedAt: new Date().toISOString() })), [])

  // 3D operations are calculated in the background; everything else right here
  const { pathOf: path3dOf, busy: busy3d } = use3dToolpaths(part, machine)
  const toolpaths = useMemo<Toolpath[]>(
    () =>
      part.ops
        .filter((o) => o.enabled)
        .map((op) => {
          if (inBackground(op, part)) return path3dOf(op)
          try {
            return generateOp(op, { part, machine })
          } catch (e) {
            return { opId: op.id, kind: op.kind, name: op.name, tool: null, feeds: { rpm: 0, feed: 0, plunge: 0 }, moves: [], intents: [], warnings: [`Could not compute this toolpath: ${e instanceof Error ? e.message : String(e)}`], stats: { cut: 0, rapid: 0, minutes: 0 } }
          }
        }),
    [part, machine, path3dOf],
  )

  const ctx = { part, sel: sel.filter((id) => part.entities.some((e) => e.id === id)), layer, params, fonts: data?.library.fonts }

  const cancel = () => {
    setClicks([])
    setMessage('')
  }

  const apply = (r: ReturnType<typeof stepTool>, t: ToolDef = tool) => {
    if (!r) return
    if (r.part) change(r.part)
    if (r.sel) setSel(r.sel)
    setMessage(r.message ?? '')
    setClicks([])
    if (!r.repeat && (t.group === 'change' || t.group === 'area') && !t.immediate && !r.message) setToolId('select')
  }

  const chooseTool = (id: ToolId) => {
    const t = TOOL_BY_ID[id]
    setPathPickState(null)
    setClicks([])
    setMessage('')
    setNodeSeg(null)
    if (t.needsSelection && !ctx.sel.length) {
      setMessage(`${t.label}: select shapes first, then pick the command.`)
      return
    }
    if (t.immediate) {
      apply(stepTool(t, [], ctx), t)
      return
    }
    setToolId(id)
    if (t.params?.includes('text')) setTimeout(() => document.getElementById('param-text')?.focus(), 0)
  }

  // a "Configure" badge asked for one of this part's operation values: pick the operation, then the field
  useConfigureTarget(['op'], (t) => {
    if (t.kind !== 'op') return
    setTab('ops')
    setSelectedOp(t.opId)
  })

  const setPathPick = (pp: PathPick | null) => {
    setPathPickState(pp)
    setClicks([])
    setToolId(pp ? 'pathpick' : 'select')
    setMessage(pp ? (pp.kind === 'arc' ? (pp.through ? 'Pick the end of the arc' : 'Pick a point the arc passes through') : `Pick where the ${pp.kind === 'feed' ? 'feed line' : 'rapid'} goes`) : '')
  }

  const pickPathPoint = (p: P) => {
    const op = pathPick && part.ops.find((o) => o.id === pathPick.opId)
    if (!pathPick || !op || op.kind !== 'manual') return setPathPick(null)
    const started = op.steps.length > 0 || op.start.x !== 0 || op.start.y !== 0 || op.start.z !== 0
    if (pathPick.kind === 'arc' && started && !pathPick.through) return setPathPick({ ...pathPick, through: p })
    const r = appendStep(op, pathPick.kind, p, pathPick.z, pathPick.through)
    if ('error' in r) {
      setPathPick({ ...pathPick, through: undefined })
      return setMessage(r.error)
    }
    change({ ...part, ops: part.ops.map((o) => (o.id === op.id ? r : o)) })
    setPathPick({ ...pathPick, through: undefined })
  }

  const addClick = (c: Click) => {
    if (toolId === 'pathpick') return pickPathPoint(c.p)
    if (tool.group === 'select') return
    if (tool.pick?.includes(clicks.length) && !c.hit) {
      setMessage('Click on a shape.')
      return
    }
    if (tool.needsSelection && !ctx.sel.length) {
      setMessage('Select shapes first.')
      return
    }
    const next = [...clicks, c]
    if (tool.id === 'measure') {
      if (next.length === 2) {
        setMessage(measureText(next[0].p, next[1].p, fmt))
        setClicks([])
      } else setClicks(next)
      return
    }
    const r = stepTool(tool, next, ctx)
    if (r) apply(r)
    else setClicks(next)
  }

  const finish = () => {
    if (tool.open && clicks.length) apply(stepTool(tool, clicks, ctx, true))
    else cancel()
  }

  const submitPrompt = () => {
    const t = prompt.trim()
    setPrompt('')
    if (!t) return finish()
    if (tool.group === 'select') return setMessage('Choose a drawing or editing command first, then type a point.')
    try {
      const vars = resolveVariables(part.variables, { L: part.length, W: part.width, T: part.thickness })
      const ci = parseCoord(t, units, vars)
      const last = clicks[clicks.length - 1]?.p ?? { x: 0, y: 0 }
      const cur = cursor?.p ?? last
      let p: P | null = null
      if (ci.kind === 'abs') p = { x: ci.x, y: ci.y }
      else if (ci.kind === 'rel') p = { x: last.x + ci.dx, y: last.y + ci.dy }
      else if (ci.kind === 'polar') {
        const base = ci.rel || clicks.length ? last : { x: 0, y: 0 }
        p = { x: base.x + ci.d * Math.cos((ci.a * Math.PI) / 180), y: base.y + ci.d * Math.sin((ci.a * Math.PI) / 180) }
      } else if (ci.kind === 'unknown') p = cur
      else {
        p = tool.valueToPoint?.(clicks, ci.v, cur) ?? null
        if (!p && clicks.length && dist(last, cur) > 1e-9) p = { x: last.x + ((cur.x - last.x) / dist(last, cur)) * ci.v, y: last.y + ((cur.y - last.y) / dist(last, cur)) * ci.v }
        if (!p) {
          const main = tool.params?.find((k) => typeof params[k] === 'number')
          if (main) {
            setParams({ ...params, [main]: ci.v })
            return setMessage(`${PARAM_LABEL[main]} set to ${LENGTH_PARAMS.has(main) ? fmt(ci.v) : ci.v}`)
          }
          return setMessage('Type a point: x,y  or  @dx,dy  or  @distance<angle')
        }
      }
      addClick({ p, hit: hitEntity(part, p, 0.5) })
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement)?.isContentEditable
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        if (typing) return
        e.preventDefault()
        setHist((h) => (e.shiftKey ? redo(h) : undo(h)))
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        if (typing) return
        e.preventDefault()
        setHist(redo)
        return
      }
      if (typing) return
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSel(part.entities.filter((x) => x.face === 1).map((x) => x.id))
        return
      }
      if (e.key === 'Escape') {
        if (pathPick) setPathPick(null)
        else if (clicks.length) cancel()
        else {
          setToolId('select')
          setSel([])
          setNodeSeg(null)
        }
        return
      }
      if (e.key === 'Enter') {
        finish()
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && ctx.sel.length) {
        change(deleteEntities(part, ctx.sel))
        setSel([])
        return
      }
      if (mod || e.altKey) return
      if (e.key === 'z') return setFitKey((k) => k + 1)
      const t = TOOLS.find((x) => x.key === e.key.toLowerCase())
      if (t) return chooseTool(t.id)
      if (/^[0-9@.\-(]$/.test(e.key) && tool.group !== 'select') {
        promptRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const sketchSel = ctx.sel.length === 1 && part.sketches?.[ctx.sel[0]] ? ctx.sel[0] : null
  const preview = cursor && tool.preview && (clicks.length || tool.id === 'text') ? tool.preview(clicks, cursor.p, ctx) : []
  const stepPrompt = tool.prompts.length ? tool.prompts[Math.min(clicks.length, tool.prompts.length - 1)] : ''
  const feat = featuresOf(data!.settings)
  const groups: ToolGroup[] = feat.camCadTools ? ['select', 'draw', 'change', 'area', 'dims'] : ['select', 'draw', 'change', 'area']
  const back = () => go(jobId ? { page: 'job', jobId, tab: 'parts' } : { page: 'parts' })

  return (
    <div className="dark flex h-full flex-col bg-[#101216] text-stone-100">
      <header className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-[#15171c] px-3 py-2">
        <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={back}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{part.name}</div>
          <div className="truncate text-[11px] text-stone-400">
            {job ? `${job.number} · ${job.name}` : 'Part library'} · {fmt(part.length)} × {fmt(part.width)} × {fmt(part.thickness)} · {part.entities.length} shapes · {part.ops.length} operations
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Undo" disabled={!hist.past.length} onClick={() => setHist(undo)}>
                <Undo2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Redo" disabled={!hist.future.length} onClick={() => setHist(redo)}>
                <Redo2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Redo (Ctrl+Y)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Zoom to fit" onClick={() => setFitKey((k) => k + 1)}>
                <Maximize />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom to fit (Z)</TooltipContent>
          </Tooltip>
          {feat.camCadTools && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 border-white/15 bg-transparent">
                  <PenLine className="size-3.5" /> CAD
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => setCadDialog({ k: 'sketch' })}>Turn-by-turn sketch…</DropdownMenuItem>
                {sketchSel && <DropdownMenuItem onSelect={() => setCadDialog({ k: 'sketch', edit: sketchSel })}>Edit the selected shape's sketch…</DropdownMenuItem>}
                <DropdownMenuItem onSelect={() => setCadDialog({ k: 'print' })}>Print to scale…</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setCadDialog({ k: 'query' })}>Geometry query…</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setCadDialog({ k: 'fill' })}>Fill with holes…</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setCadDialog({ k: 'panels' })}>Split into panels…</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setCadDialog({ k: 'trace' })}>Trace a picture…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {feat.plugins && <PluginMenu part={part} selection={ctx.sel} change={change} />}
          {feat.cam3d && (
            <Button variant="outline" size="sm" className="h-8 gap-1.5 border-white/15 bg-transparent" onClick={() => setModelOpen(true)}>
              <Box className="size-3.5" /> 3D model
            </Button>
          )}
          {feat.cam3d && feat.camRelief && (
            <Button variant="outline" size="sm" className="h-8 gap-1.5 border-white/15 bg-transparent" onClick={() => setReliefOpen(true)}>
              <Mountain className="size-3.5" /> Relief
            </Button>
          )}
          <Button variant="outline" size="sm" aria-pressed={view3d} className={cn('h-8 gap-1.5 border-white/15 bg-transparent', view3d && 'border-amber-400 text-amber-300')} onClick={() => setView3d((v) => !v)}>
            <Rotate3d className="size-3.5" /> {view3d ? '2D view' : '3D view'}
          </Button>
          {feat.hardwarePatterns && (
            <Button variant="outline" size="sm" className="h-8 gap-1.5 border-white/15 bg-transparent" onClick={() => setPatternOpen(true)}>
              <Drill className="size-3.5" /> Hardware
            </Button>
          )}
          {feat.camMachining && feat.camBackplot && (
            <Button variant="outline" size="sm" className="h-8 gap-1.5 border-white/15 bg-transparent" onClick={() => setSimOpen(true)}>
              <CirclePlay className="size-3.5" /> Simulate
            </Button>
          )}
          {feat.camMachining && (
            <Button variant="outline" size="sm" className="h-8 gap-1.5 border-white/15 bg-transparent" onClick={() => setProgramOpen(true)}>
              <FileCode2 className="size-3.5" /> Program
            </Button>
          )}
          {feat.camImport && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 border-white/15 bg-transparent"
              onClick={async () => {
                const tps = feat.camMachining ? toolpaths.filter((t) => !hiddenOps.has(t.opId)).map((t) => ({ name: t.name, contours: toolpathContours(t) })) : []
                const where = await backend.saveFile({ name: `${fileBase(part.name)}.dxf`, data: exportDxf(part, { toolpaths: tps }) }, [{ name: 'DXF drawing', extensions: ['dxf'] }])
                if (where) toast.success(`Saved ${where}`)
              }}
            >
              <Download className="size-3.5" /> DXF
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 border-white/15 bg-transparent"
            onClick={async () => {
              const where = await backend.saveFile({ name: `${part.name.replace(/[^\w-]+/g, '-') || 'part'}.csp.json`, data: await serializePartFile(part, backend.blobs) }, [{ name: 'Cabinet Studio part', extensions: ['json'] }])
              if (where) toast.success(`Saved ${where}`)
            }}
          >
            <Download className="size-3.5" /> Part file
          </Button>
        </div>
      </header>
      <ProgramDialog
        open={programOpen}
        onOpenChange={setProgramOpen}
        part={part}
        toolpaths={toolpaths}
        machine={machine}
        materialCode={data!.library.materials.find((m) => m.id === part.materialId)?.code ?? 'MATERIAL'}
        outputOn={feat.camMprOutput}
      />
      {patternOpen && (
        <PatternDialog
          open
          onOpenChange={setPatternOpen}
          part={part}
          patterns={usablePatterns(data!.library)}
          withOp={feat.camMachining}
          onPlace={(p, msg) => {
            change(p)
            toast.success(msg)
          }}
        />
      )}
      {reliefOpen && (
        <ReliefImportDialog
          part={part}
          units={units}
          onClose={() => setReliefOpen(false)}
          onAdd={(p, msg) => {
            change(p)
            setTab('models')
            toast.success(msg)
          }}
        />
      )}
      {modelOpen && (
        <ModelImportDialog
          part={part}
          units={units}
          onClose={() => setModelOpen(false)}
          onAdd={(p, msg) => {
            change(p)
            setTab('models')
            setFitKey((k) => k + 1)
            toast.success(msg)
          }}
        />
      )}
      {cadDialog?.k === 'sketch' && (
        <TurnSketchDialog
          part={part}
          layer={layer}
          units={units}
          editing={cadDialog.edit && part.sketches?.[cadDialog.edit] ? { entityId: cadDialog.edit, sketch: part.sketches[cadDialog.edit] } : undefined}
          onClose={() => setCadDialog(null)}
          onInsert={(p, msg) => {
            change(p)
            toast.success(msg)
          }}
        />
      )}
      {cadDialog?.k === 'print' && <PrintDialog part={part} units={units} onClose={() => setCadDialog(null)} />}
      {cadDialog?.k === 'trace' && (
        <ImageTraceDialog
          part={part}
          units={units}
          onClose={() => setCadDialog(null)}
          onInsert={(p, msg) => {
            change(p)
            toast.success(msg)
          }}
        />
      )}
      {cadDialog?.k === 'query' && <QueryDialog part={part} units={units} onClose={() => setCadDialog(null)} onChange={change} onSelect={(ids) => setSel(ids)} />}
      {cadDialog?.k === 'fill' && (
        <FillHolesDialog
          part={part}
          sel={ctx.sel}
          units={units}
          drilling={feat.camMachining}
          onClose={() => setCadDialog(null)}
          onChange={(p, msg) => {
            change(p)
            toast.success(msg)
          }}
        />
      )}
      {cadDialog?.k === 'panels' && (
        <PanelDialog
          part={part}
          sel={ctx.sel}
          units={units}
          sheet={(() => {
            const m = data!.library.materials.find((x) => x.id === part.materialId)
            const trim = data!.settings.nesting.edgeTrim
            return { length: (m?.sheetLength ?? 3658) - 2 * trim, width: (m?.sheetWidth ?? 1524) - 2 * trim }
          })()}
          onClose={() => setCadDialog(null)}
          onMake={(parts) => {
            for (const p of parts) savePart(p, jobId)
            toast.success(`${parts.length} panel part(s) made`, { description: parts.map((p) => p.name).join(', ') })
          }}
        />
      )}
      <SimulateDialog open={simOpen} onOpenChange={setSimOpen} part={part} toolpaths={toolpaths} machine={machine} units={units} color={data!.library.materials.find((m) => m.id === part.materialId)?.color} />

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav aria-label="Commands" className="flex shrink-0 gap-3 overflow-x-auto border-b border-white/10 bg-[#15171c] p-2 md:w-[124px] md:flex-col md:gap-2 md:overflow-y-auto md:border-r md:border-b-0">
          {groups.map((g) => (
            <div key={g} className="flex shrink-0 gap-1 md:flex-col">
              <div className="hidden px-1 text-[10px] font-semibold tracking-wider text-stone-500 uppercase md:block">{GROUP_LABEL[g]}</div>
              <div className="flex gap-1 md:grid md:grid-cols-3">
                {TOOLS.filter((t) => t.group === g).map((t) => (
                  <Tooltip key={t.id}>
                    <TooltipTrigger asChild>
                      <button
                        aria-label={t.label}
                        aria-pressed={toolId === t.id}
                        onClick={() => chooseTool(t.id)}
                        className={cn('flex size-8 items-center justify-center rounded-md text-stone-300 transition-colors hover:bg-white/10 hover:text-white', toolId === t.id && 'bg-amber-500 text-stone-900 hover:bg-amber-400 hover:text-stone-900')}
                      >
                        <t.icon className="size-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {t.label}
                      {t.key && t.key.length === 1 ? ` (${t.key.toUpperCase()})` : ''}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="flex min-h-[55vh] min-w-0 flex-1 flex-col md:min-h-0">
          {tool.params && tool.params.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-b border-white/10 bg-[#15171c] px-3 py-1.5 text-xs">
              <span className="font-medium text-amber-300">{tool.label}</span>
              {tool.params.map((k) => (
                <ParamInput key={k} k={k} params={params} setParams={setParams} units={units} />
              ))}
            </div>
          )}
          <div className="relative min-h-0 flex-1">
            <PartCanvas
              part={part}
              sel={ctx.sel}
              toolpaths={feat.camMachining ? toolpaths : []}
              hiddenOps={hiddenOps}
              display={display}
              tool={tool}
              clicks={clicks}
              preview={preview}
              nodeSeg={nodeSeg}
              fitKey={fitKey}
              onCursor={setCursor}
              onClick={(c) => addClick(c)}
              onFinish={finish}
              onSelect={(ids, additive) => {
                setNodeSeg(null)
                setSel((s) => (additive ? [...s.filter((x) => !ids.includes(x)), ...ids.filter((x) => !s.includes(x))] : ids))
              }}
              onNodeMove={(id, idx, p) => change(nodeMove(part, id, idx, p))}
              onSegPick={(id, seg) => {
                setNodeSeg({ id, seg })
                setTab('props')
              }}
            />
            {view3d && <Model3DView part={part} />}
            {!view3d && part.entities.length <= 1 && part.ops.length === 0 && toolId === 'select' && (
              <div className="pointer-events-none absolute top-3 left-1/2 w-[min(92%,520px)] -translate-x-1/2 rounded-lg border border-white/10 bg-black/60 px-4 py-3 text-center text-xs leading-relaxed text-stone-300 backdrop-blur">
                Draw with the commands on the left or type points below (<span className="font-mono">x,y</span>, <span className="font-mono">@dx,dy</span>, <span className="font-mono">@length&lt;angle</span>). The dashed rectangle is the panel; its solid shape is the cut-out outline. Middle-drag or Space-drag to pan, wheel to zoom.
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-white/10 bg-[#15171c] px-3 py-1.5 text-xs">
            <span className="max-w-[40%] truncate text-amber-200" title={stepPrompt}>
              {stepPrompt || 'Select shapes, or choose a command'}
            </span>
            <form
              className="min-w-[140px] flex-1"
              onSubmit={(e) => {
                e.preventDefault()
                submitPrompt()
              }}
            >
              <Input
                ref={promptRef}
                aria-label="Typed input"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && (setPrompt(''), cancel(), promptRef.current?.blur())}
                placeholder={tool.group === 'select' ? '' : units === 'in' ? 'e.g. 23-1/4,12  or  @10<45' : 'e.g. 600,400  or  @100,0  or  @50<30'}
                className="h-7 border-white/10 bg-black/30 font-mono text-xs"
              />
            </form>
            <span className="w-44 text-right font-mono text-[11px] text-stone-400 tabular-nums">{cursor ? `${fmt(cursor.p.x)}, ${fmt(cursor.p.y)}` : ''}</span>
            <Toggle on={display.snapOn} onClick={() => setDisplay({ ...display, snapOn: !display.snapOn })}>
              Snap
            </Toggle>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="rounded px-1.5 py-0.5 text-[11px] text-stone-400 hover:bg-white/10">▾</button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Snap to</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {ALL_SNAPS.map((m) => (
                  <DropdownMenuCheckboxItem
                    key={m}
                    checked={display.modes.has(m)}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(v) => {
                      const modes = new Set(display.modes)
                      if (v) modes.add(m)
                      else modes.delete(m)
                      setDisplay({ ...display, modes })
                    }}
                  >
                    {m === 'nearest' ? 'On shape' : SNAP_LABEL[m]}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Toggle on={display.grid} onClick={() => setDisplay({ ...display, grid: !display.grid })}>
              Grid
            </Toggle>
            <Toggle on={display.ortho} onClick={() => setDisplay({ ...display, ortho: !display.ortho })}>
              Ortho
            </Toggle>
            <Toggle on={display.arrows} onClick={() => setDisplay({ ...display, arrows: !display.arrows })}>
              Directions
            </Toggle>
            {feat.camMachining && (
              <Toggle on={display.paths} onClick={() => setDisplay({ ...display, paths: !display.paths })}>
                Toolpaths
              </Toggle>
            )}
          </div>
          {message && <div className="border-t border-white/10 bg-[#1b1d23] px-3 py-1 text-[11px] text-sky-200">{message}</div>}
        </div>

        <aside className="flex min-h-[320px] w-full shrink-0 flex-col border-t border-white/10 bg-[#15171c] md:min-h-0 md:w-[340px] md:border-t-0 md:border-l">
          <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
            <TabsList className={cn('m-2 grid w-auto', feat.cam3d ? 'grid-cols-4' : 'grid-cols-3')}>
              {feat.camMachining && <TabsTrigger value="ops">Machining</TabsTrigger>}
              <TabsTrigger value="layers">Layers</TabsTrigger>
              <TabsTrigger value="props">Properties</TabsTrigger>
              {feat.cam3d && <TabsTrigger value="models">3D</TabsTrigger>}
            </TabsList>
            {feat.cam3d && (
              <TabsContent value="models" className="min-h-0 flex-1 overflow-auto">
                <ModelsPanel part={part} units={units} sel={sel} onChange={change} onImport={() => setModelOpen(true)} onRelief={feat.camRelief ? () => setReliefOpen(true) : undefined} />
              </TabsContent>
            )}
            {feat.camMachining && (
              <TabsContent value="ops" className="flex min-h-0 flex-1 flex-col">
                <OpsPanel
                  part={part}
                  machine={machine}
                  toolpaths={toolpaths}
                  busy={busy3d}
                  sel={ctx.sel}
                  selectedOp={selectedOp}
                  setSelectedOp={(id) => {
                    setSelectedOp(id)
                    const op = part.ops.find((o) => o.id === id)
                    if (op) setSel(op.geometry.filter((g) => part.entities.some((e) => e.id === g)))
                  }}
                  hiddenOps={hiddenOps}
                  toggleHidden={(id) =>
                    setHiddenOps((s) => {
                      const n = new Set(s)
                      if (n.has(id)) n.delete(id)
                      else n.add(id)
                      return n
                    })
                  }
                  onChange={change}
                  pathPick={pathPick}
                  setPathPick={setPathPick}
                />
              </TabsContent>
            )}
            <TabsContent value="layers" className="min-h-0 flex-1 overflow-auto">
              <LayersPanel part={part} current={layer} setCurrent={setLayer} sel={ctx.sel} onChange={change} />
              {feat.camCadTools && <DimsPanel part={part} units={units} onChange={change} />}
              {feat.camCadTools && <AnnotationsPanel part={part} units={units} onChange={change} />}
            </TabsContent>
            <TabsContent value="props" className="min-h-0 flex-1 overflow-auto">
              <PropertiesPanel part={part} sel={ctx.sel} units={units} materials={data!.library.materials} nodeSeg={nodeSeg} onChange={change} onFit={() => setFitKey((k) => k + 1)} />
            </TabsContent>
          </Tabs>
        </aside>
      </div>
    </div>
  )
}


function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={on} className={cn('rounded px-2 py-0.5 text-[11px] transition-colors', on ? 'bg-sky-500/20 text-sky-200' : 'text-stone-500 hover:bg-white/5 hover:text-stone-300')}>
      {children}
    </button>
  )
}

function ParamInput({ k, params, setParams, units }: { k: keyof ToolParams; params: ToolParams; setParams: (p: ToolParams) => void; units: 'mm' | 'in' }) {
  const v = params[k]
  if (k === 'relief')
    return (
      <label className="flex items-center gap-1.5 text-stone-400">
        {PARAM_LABEL[k]}
        <select className="rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-stone-100" value={params.relief} onChange={(e) => setParams({ ...params, relief: e.target.value as ToolParams['relief'] })}>
          <option value="tbone-in">T-bone along first edge</option>
          <option value="tbone-out">T-bone along second edge</option>
          <option value="dogbone">Dog-bone (on the diagonal)</option>
        </select>
      </label>
    )
  if (k === 'font') return <FontParam params={params} setParams={setParams} />
  if (k === 'dimRadial')
    return (
      <label className="flex items-center gap-1.5 text-stone-400">
        {PARAM_LABEL[k]}
        <select className="rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-stone-100" value={params.dimRadial} onChange={(e) => setParams({ ...params, dimRadial: e.target.value as ToolParams['dimRadial'] })}>
          <option value="diameter">Diameter</option>
          <option value="radius">Radius</option>
        </select>
      </label>
    )
  if (k === 'removed')
    return (
      <label className="flex items-center gap-1.5 text-stone-400">
        Cut from
        <select className="rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-stone-100" value={params.removed} onChange={(e) => setParams({ ...params, removed: e.target.value as ToolParams['removed'] })}>
          <option value="interior">Inside the shape (pocket, slot)</option>
          <option value="exterior">Outside the shape (tenon, tab)</option>
        </select>
      </label>
    )
  if (typeof v === 'boolean')
    return (
      <label className="flex items-center gap-1.5 text-stone-400">
        <input type="checkbox" checked={v} onChange={(e) => setParams({ ...params, [k]: e.target.checked })} />
        {PARAM_LABEL[k]}
      </label>
    )
  if (typeof v === 'string')
    return (
      <label className="flex items-center gap-1.5 text-stone-400">
        {PARAM_LABEL[k]}
        <input id={`param-${k}`} className="w-40 rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-stone-100" value={v} onChange={(e) => setParams({ ...params, [k]: e.target.value })} />
      </label>
    )
  return <NumParam label={PARAM_LABEL[k]} value={v} length={LENGTH_PARAMS.has(k)} units={units} onChange={(n) => setParams({ ...params, [k]: n })} />
}

function FontParam({ params, setParams }: { params: ToolParams; setParams: (p: ToolParams) => void }) {
  const fonts = useStore((s) => s.data?.library.fonts) ?? []
  return (
    <label className="flex items-center gap-1.5 text-stone-400">
      {PARAM_LABEL.font}
      <select className="rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-stone-100" value={params.font} onChange={(e) => setParams({ ...params, font: e.target.value })}>
        <option value="">Built-in</option>
        {fonts.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function NumParam({ label, value, length, units, onChange }: { label: string; value: number; length: boolean; units: 'mm' | 'in'; onChange: (n: number) => void }) {
  const shown = length ? formatLength(value, units) : String(value)
  const [text, setText] = useState(shown)
  useEffect(() => setText(shown), [shown])
  const commitText = () => {
    try {
      const n = length ? evalLength(text, units) : Number(text)
      if (Number.isFinite(n)) onChange(n)
      else setText(shown)
    } catch {
      setText(shown)
    }
  }
  return (
    <label className="flex items-center gap-1.5 text-stone-400">
      {label}
      <input className="w-20 rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-stone-100 tabular-nums" value={text} onChange={(e) => setText(e.target.value)} onBlur={commitText} onKeyDown={(e) => e.key === 'Enter' && commitText()} />
    </label>
  )
}

