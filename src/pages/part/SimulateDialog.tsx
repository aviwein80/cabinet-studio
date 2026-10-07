import { UnconfirmedList } from '@/components/Configure'
import { usedUnconfirmed } from '@/core/confirm'
import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { ChevronLeft, ChevronRight, CirclePlay, Download, Pause, Play, SkipBack, SkipForward, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import * as THREE from 'three'
import { backend } from '@/app/backend'
import { writeStl } from '@/cam/mesh/tools'
import { buildTimeline, cellRect, cutSummary, positionAt, programOrder, shadeHeightfield, type SimTimeline } from '@/cam/sim'
import { type StockMeshRange, stockMesh, stockMeshTops } from '@/cam/stock/heightfield'
import type { HeightfieldStock } from '@/cam/stock/heightfield'
import { DexelStock } from '@/cam/stock/dexel'
import { needsDexel, piecesNeeded, stockFor } from '@/cam/stock/choose'
import { cutFreePieces, dropMask } from '@/cam/stock/pieces'
import { entityContours } from '@/cam/doc'
import { type P, toPoints } from '@/cam/geom'
import { advance, moveAt, moveEnd, simCell, StockSimulation, stepMove, type StopReason } from '@/cam/stock/simulation'
import type { Collision, CollisionKind } from '@/cam/collision/collision'
import type { Toolpath } from '@/cam/toolpath'
import { Cancelled } from '@/core/cancel'
import { compute } from '@/cam/worker/client'
import type { CamPart } from '@/cam/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { type CutterOutline, machineModelOf, toolOutline } from '@/core/machineModel'
import { formatLength } from '@/core/units'
import type { MachineProfile, UnitSystem } from '@/core/types'
import { cn } from '@/lib/utils'
import { RotaryStock } from '@/cam/rotary/stock'
import { rotaryCell, rotaryProgram } from '@/cam/rotary/sim'
import { ROTARY_LETTER } from '@/cam/rotary/frame'
import { RotaryView3D } from './RotaryView3D'

const SPEEDS = [1, 4, 16, 64, 256]
const RAPID_SPEEDS = [1, 4, 16, 64, 256, 1024]
/** Largest stock mesh written to STL (cells); bigger stock is written every few cells. */
const STL_MAX_CELLS = 2e6

const clock = (s: number) => {
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return [214, 186, 140]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const KIND_LABEL: Record<CollisionKind, string> = { shank: 'shank', holder: 'holder', rapid: 'rapid', spoilboard: 'spoilboard', table: 'table', axis: 'axis' }

const STOP_TEXT: Record<StopReason, string> = { end: 'End of program.', 'tool-change': 'Stopped at a tool change.', mark: 'Stopped at the chosen move.' }

export function SimulateDialog({ open, onOpenChange, part, toolpaths, machine, units, color }: { open: boolean; onOpenChange: (o: boolean) => void; part: CamPart; toolpaths: Toolpath[]; machine: MachineProfile; units: UnitSystem; color?: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dark max-h-[96vh] overflow-y-auto border-white/10 bg-[#15171c] text-stone-100 sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CirclePlay className="size-4" /> Simulate cutting
          </DialogTitle>
          <DialogDescription className="text-stone-400">Plays the toolpaths in program order: cutting moves, rapids, the tool and the material left behind. A check of our own toolpaths, not of the machine; simulate in woodWOP before cutting.</DialogDescription>
        </DialogHeader>
        {open && <Simulator part={part} toolpaths={toolpaths} machine={machine} units={units} color={color} />}
      </DialogContent>
    </Dialog>
  )
}

function Simulator({ part, toolpaths, machine, units, color }: { part: CamPart; toolpaths: Toolpath[]; machine: MachineProfile; units: UnitSystem; color?: string }) {
  // M3.3: a turned part's rotary toolpaths play on its rotary stock (in the blank's unrolled frame)
  const rot = part.rotary && toolpaths.some((tp) => !!tp.rotary) ? part.rotary : null
  const flatLeft = rot ? toolpaths.filter((tp) => !tp.rotary && tp.moves.length).length : 0
  const ordered = useMemo(() => (rot ? rotaryProgram(toolpaths, rot) : programOrder(toolpaths)), [toolpaths, rot])
  const tl = useMemo(() => buildTimeline(ordered), [ordered])
  // (a rotary stock is carved at positions along most moves: half-millimetre rays keep playback smooth)
  const cell = rot ? Math.max(0.5, rotaryCell(rot)) : simCell(part.length, part.width)
  // (a lollipop under an overhang, or a thread mill's groove, needs the dexel stock, which keeps
  // the material over them; a thread needs a piece per turn)
  const dexel = !rot && needsDexel(ordered)
  const layers = piecesNeeded(ordered)
  const sim = useMemo(
    () => new StockSimulation(tl, rot ? new RotaryStock(rot, cell) : dexel ? new DexelStock(part.length, part.width, part.thickness, cell, layers) : stockFor({ length: part.length, width: part.width, thickness: part.thickness }, [], cell)),
    [part.length, part.width, part.thickness, dexel, layers, cell, tl, rot],
  )
  const stock = sim.stock as HeightfieldStock | DexelStock | RotaryStock
  // the rotary stock's unrolled surface stands in for the panel in the top view
  const viewPart = rot ? { ...part, length: stock.hf.length, width: stock.hf.width, thickness: stock.hf.thickness } : part
  // a rotary program opens at its start (carving it all here would hold the screen up); the end is
  // shown once the background check hands back its stock
  const [t, setT] = useState(rot ? 0 : tl.total)
  const tRef = useRef(t)
  useLayoutEffect(() => {
    tRef.current = t
  }, [t])
  // collision check: the whole program replayed in the background
  const [checked, setCheck] = useState<{ for: unknown; found: Collision[] | null; fraction: number; error?: string } | null>(null)
  const checkKey = useMemo(() => ({ toolpaths, machine }), [toolpaths, machine])
  useEffect(() => {
    if (!toolpaths.some((tp) => tp.moves.length)) return
    const abort = new AbortController()
    const onProgress = (fraction: number) => setCheck({ for: checkKey, found: null, fraction })
    const job = rot
      ? compute()
          .run('sim.rotaryCollide', { setup: rot, toolpaths: toolpaths.filter((tp) => !!tp.rotary), machine, cell }, { signal: abort.signal, onProgress })
          .then((r) => {
            // the background replay's stock at the end of the program: shown at once
            sim.seed(tl.total, r.snapshot)
            // (still at the start, untouched: go to the end, as a flat part's simulation opens)
            setT((x) => (x === 0 ? tl.total : x))
            return r.found
          })
      : compute().run('sim.collide', { panel: { length: part.length, width: part.width, thickness: part.thickness }, toolpaths, machine }, { signal: abort.signal, onProgress })
    job
      .then((found) => setCheck({ for: checkKey, found, fraction: 1 }))
      .catch((e) => {
        if (!(e instanceof Cancelled) && !abort.signal.aborted) setCheck({ for: checkKey, found: null, fraction: 1, error: e instanceof Error ? e.message : String(e) })
      })
    return () => abort.abort()
  }, [checkKey, toolpaths, machine, part.length, part.width, part.thickness, rot, cell, sim, tl])
  const check = checked?.for === checkKey ? checked : { found: null, fraction: 0, error: undefined }
  const outlines = useMemo(() => tl.ops.map((o) => {
    const tool = ordered[o.path]?.tool
    return tool ? toolOutline(machine, tool) : null
  }), [tl, ordered, machine])
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(16)
  const [rapidSpeed, setRapidSpeed] = useState(64)
  const [stopTool, setStopTool] = useState(false)
  const [stopped, setStopped] = useState<StopReason | null>(null)
  const [mark, setMark] = useState<number | undefined>(undefined)
  const [view, setView] = useState<'top' | '3d'>('top')
  const [showPaths, setShowPaths] = useState(true)
  const [showRapids, setShowRapids] = useState(true)
  const [through, setThrough] = useState(false)
  const [opacity, setOpacity] = useState(1)
  const [section, setSection] = useState<{ on: boolean; axis: 'x' | 'y'; at: number }>({ on: false, axis: 'y', at: 0.5 })
  const [goOp, setGoOp] = useState(0)
  const [goMove, setGoMove] = useState('1')
  const base = useMemo(() => hexRgb(color ?? ''), [color])
  const fmt = (n: number) => formatLength(n, units)
  // the part's outline tells the part from scrap and offcuts
  const outline = useMemo<P[][] | undefined>(() => {
    if (rot) return undefined
    const e = part.entities.find((x) => x.id === part.outlineId)
    return e ? entityContours(e).filter((c) => c.closed).map((c) => toPoints(c, 0.05)) : undefined
  }, [part.entities, part.outlineId, rot])
  const [pieces, setPieces] = useState<{ scrap: number; offcut: number } | null>(null)
  const spoil = machineModelOf(machine).spoilboard.thickness
  // placeholder values behind this simulation (tools, blade, holders, machine model, the operations' own)
  const placeholders = useMemo(() => usedUnconfirmed(machine, toolpaths.flatMap((tp) => (tp.tool ? [tp.tool.id] : [])), [part], (op) => toolpaths.find((tp) => tp.opId === op.id)?.tool ?? null), [machine, toolpaths, part])

  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    let id = 0
    const tick = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000)
      last = now
      const r = advance(tl, tRef.current, dt, { speed, rapidSpeed, stopAtToolChange: stopTool, stopAt: mark })
      setT(r.t)
      if (r.stop) {
        setPlaying(false)
        setStopped(r.stop)
        if (r.stop === 'mark') setMark(undefined)
        return
      }
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [playing, speed, rapidSpeed, stopTool, mark, tl])

  // stats: cheap enough when paused; every quarter second while playing
  const [summary, setSummary] = useState(() => {
    sim.syncTo(t)
    return { ...cutSummary(stock.hf), removed: stock.removedVolume() }
  })
  const lastStats = useRef(0)
  const onCarved = useCallback(() => {
    const now = performance.now()
    if (playing && now - lastStats.current < 250) return
    lastStats.current = now
    setSummary({ ...cutSummary(stock.hf), removed: stock.removedVolume() })
  }, [playing, stock])

  if (!tl.segs.length)
    return <p className="rounded-md border border-white/10 bg-white/5 p-6 text-center text-sm text-stone-400">No toolpaths to simulate. Add operations on the Machining tab.</p>

  const pos = positionAt(tl, t)
  const cur = pos.seg >= 0 ? tl.segs[pos.seg] : null
  const op = pos.op >= 0 ? tl.ops[pos.op] : null
  const cutter = cur?.cutter ?? op?.cutter ?? { r: 3, shape: 'flat' as const, angle: 0 }
  const where = moveAt(tl, t)

  const play = () => {
    setStopped(null)
    if (t >= tl.total) setT(0)
    setPlaying((p) => !p)
  }
  const jump = (to: number) => {
    setPlaying(false)
    setStopped(null)
    setT(Math.max(0, Math.min(tl.total, to)))
  }
  const prevOp = () => {
    const i = tl.ops.findLastIndex((o) => o.start < t - 1e-6)
    jump(i >= 0 ? tl.ops[i].start : 0)
  }
  const nextOp = () => {
    const o = tl.ops.find((o) => o.end > t + 1e-6)
    jump(o ? o.end : tl.total)
  }
  const goTo = (play: boolean) => {
    const n = Math.round(Number(goMove))
    const end = Number.isFinite(n) ? moveEnd(tl, goOp, n - 1) : null
    if (end === null) {
      toast.error(`${tl.ops[goOp]?.name ?? 'That operation'} has no move ${goMove}.`)
      return
    }
    if (play && end > t) {
      setMark(end)
      setStopped(null)
      setPlaying(true)
    } else jump(end)
  }
  const saveStl = async () => {
    sim.syncTo(t)
    const { hf } = stock
    const step = stock.kind !== 'heightfield' ? 1 : Math.max(1, Math.ceil(Math.sqrt((hf.nx * hf.ny) / STL_MAX_CELLS)))
    // (a rotary stock is written where it sits in the part)
    const data = writeStl(stock.kind === 'heightfield' ? stockMesh(hf, { step, exact: true }) : stock.toMesh(), `${part.name} stock`)
    const where = await backend.saveFile({ name: `${part.name.replace(/[^\w-]+/g, '-') || 'part'}-stock.stl`, data }, [{ name: 'STL model', extensions: ['stl'] }])
    if (where) toast.success(`Stock saved${step > 1 ? ` (every ${step} cells, ${fmt(step * hf.cell)} grid; nothing shown that was cut)` : ''}.`)
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <div className="flex rounded-md border border-white/10 p-0.5">
            {(['top', '3d'] as const).map((v) => (
              <Button key={v} size="sm" variant={view === v ? 'secondary' : 'ghost'} className="h-6 px-2.5 text-xs" onClick={() => setView(v)}>
                {v === 'top' ? 'Top view' : '3D'}
              </Button>
            ))}
          </div>
          {view === 'top' ? (
            <>
              <label className="flex items-center gap-1.5">
                <Switch checked={showPaths} onCheckedChange={setShowPaths} size="sm" /> Backplot
              </label>
              <label className="flex items-center gap-1.5">
                <Switch checked={showRapids} onCheckedChange={setShowRapids} size="sm" /> Rapids
              </label>
              <label className="flex items-center gap-1.5">
                <Switch checked={through} onCheckedChange={setThrough} size="sm" /> Through cuts only
              </label>
            </>
          ) : (
            <>
              <label className="flex items-center gap-1.5">
                Stock
                <Slider className="w-20" min={0.15} max={1} step={0.05} value={[opacity]} onValueChange={([v]) => setOpacity(v)} aria-label="Stock opacity" />
              </label>
              <label className="flex items-center gap-1.5">
                <Switch checked={section.on} onCheckedChange={(on) => setSection((s) => ({ ...s, on }))} size="sm" /> Section
              </label>
              {section.on && rot && (
                <>
                  <Slider className="w-28" min={0.02} max={1} step={0.005} value={[section.at]} onValueChange={([at]) => setSection((s) => ({ ...s, at }))} aria-label="Section position" />
                  <span className="font-mono text-stone-400 tabular-nums">{rot.axis} {fmt(rot.blank.start + section.at * (rot.blank.end - rot.blank.start))}</span>
                </>
              )}
              {section.on && !rot && (
                <>
                  <Select value={section.axis} onValueChange={(axis) => setSection((s) => ({ ...s, axis: axis as 'x' | 'y' }))}>
                    <SelectTrigger size="sm" className="h-6 w-28 text-xs" aria-label="Section across">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="y">Across width</SelectItem>
                      <SelectItem value="x">Across length</SelectItem>
                    </SelectContent>
                  </Select>
                  <Slider className="w-28" min={0.02} max={1} step={0.005} value={[section.at]} onValueChange={([at]) => setSection((s) => ({ ...s, at }))} aria-label="Section position" />
                  <span className="font-mono text-stone-400 tabular-nums">{fmt(section.at * (section.axis === 'y' ? part.width : part.length))}</span>
                </>
              )}
            </>
          )}
        </div>
        {view === 'top' ? (
          <TopView sim={sim} t={t} part={viewPart} base={base} through={through} showPaths={showPaths} showRapids={showRapids} pos={pos.p} seg={pos.seg} r={cutter.r} rapid={pos.kind === 'rapid'} playing={playing} onCarved={onCarved} outline={outline} onPieces={setPieces} wrap={rot ? stock.hf.width : undefined} />
        ) : rot ? (
          <RotaryView3D
            sim={sim}
            t={t}
            base={base}
            pos={pos.p}
            rapid={pos.kind === 'rapid'}
            outline={pos.op >= 0 ? outlines[pos.op] : null}
            r={cutter.r}
            blade={(() => {
              const tp = op ? ordered[op.path] : undefined
              return tp?.rotary?.blade ? { ...tp.rotary.blade, kerf: tp.tool?.kerf ?? 4 } : null
            })()}
            opacity={opacity}
            sectionAt={section.on ? section.at : null}
            onCarved={onCarved}
          />
        ) : (
          <View3D sim={sim} t={t} part={part} base={base} pos={pos.p} rapid={pos.kind === 'rapid'} outline={pos.op >= 0 ? outlines[pos.op] : null} blade={op ? bladeOf(ordered[op.path], cur) : null} flat={op ? flatOf(ordered[op.path], cur) : null} r={cutter.r} opacity={opacity} section={section} spoilboard={spoil} onCarved={onCarved} />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="icon-sm" variant="ghost" aria-label="Previous operation" title="Previous operation" onClick={prevOp}>
            <SkipBack />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="One move back" title="One move back" onClick={() => jump(stepMove(tl, t, -1))}>
            <ChevronLeft />
          </Button>
          <Button size="icon-sm" variant="secondary" aria-label={playing ? 'Pause' : 'Play'} onClick={play}>
            {playing ? <Pause /> : <Play />}
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="One move forward" title="One move forward" onClick={() => jump(stepMove(tl, t, 1))}>
            <ChevronRight />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Next operation" title="Next operation" onClick={nextOp}>
            <SkipForward />
          </Button>
          <Slider className="min-w-40 flex-1" min={0} max={tl.total} step={tl.total / 2000} value={[t]} onValueChange={([v]) => jump(v)} aria-label="Program time" />
          <span className="w-24 text-right font-mono text-xs text-stone-300 tabular-nums">
            {clock(t)} / {clock(tl.total)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-stone-300">
          <SpeedSelect label="Cutting" value={speed} options={SPEEDS} onChange={setSpeed} />
          <SpeedSelect label="Rapids" value={rapidSpeed} options={RAPID_SPEEDS} onChange={setRapidSpeed} />
          <label className="flex items-center gap-1.5">
            <Switch checked={stopTool} onCheckedChange={setStopTool} size="sm" /> Stop at tool change
          </label>
          <span className="flex items-center gap-1.5">
            Move
            <Select value={String(goOp)} onValueChange={(v) => setGoOp(Number(v))}>
              <SelectTrigger size="sm" className="h-6 w-36 text-xs" aria-label="Operation">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tl.ops.map((o, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {i + 1}. {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input className="h-6 w-16 px-1.5 text-xs" value={goMove} onChange={(e) => setGoMove(e.target.value)} aria-label="Move number" inputMode="numeric" />
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => goTo(false)}>
              Go
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => goTo(true)} title="Play and stop at the end of that move">
              Run to
            </Button>
          </span>
          {stopped && <span className="text-amber-200">{STOP_TEXT[stopped]}</span>}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-md bg-black/30 px-3 py-1.5 font-mono text-xs text-stone-300 tabular-nums">
          {rot ? (
            <>
              <span>
                {rot.axis} {fmt(pos.p.x + rot.blank.start)}
              </span>
              <span>
                {ROTARY_LETTER[rot.axis]} {((pos.p.y / (stock as RotaryStock).Rs) * (180 / Math.PI)).toFixed(2)}°
              </span>
              <span>{fmt(pos.p.z + (stock as RotaryStock).Rs)} from the axis</span>
            </>
          ) : (
            <>
              <span>X {fmt(pos.p.x)}</span>
              <span>Y {fmt(pos.p.y)}</span>
              <span>Z {fmt(pos.p.z)}</span>
            </>
          )}
          <span className={cn(pos.kind === 'rapid' ? 'text-red-300' : 'text-amber-200')}>{pos.kind ? (pos.kind === 'rapid' ? 'rapid' : pos.kind === 'drill' ? 'drilling' : pos.kind === 'plunge' ? 'plunge / ramp' : pos.kind === 'lead' ? 'lead' : 'cutting') : 'home'}</span>
          {where && <span>move {(where.move + 1).toLocaleString('en')}</span>}
          <span className="truncate font-sans text-stone-400">{op ? `${op.name} · ${op.tool}` : ''}</span>
        </div>
      </div>
      <aside className="flex min-w-0 flex-col gap-3 text-xs">
        <section>
          <h3 className="mb-1.5 font-medium text-stone-300">Operations</h3>
          <ol className="divide-y divide-white/5 rounded-md border border-white/10">
            {tl.ops.map((o, i) => (
              <li key={i}>
                <button type="button" className={cn('flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-white/5', i === pos.op && 'bg-white/10')} onClick={() => jump(o.end)} title="Run to the end of this operation">
                  <span className={cn('size-1.5 shrink-0 rounded-full', t >= o.end ? 'bg-emerald-400' : t > o.start ? 'bg-amber-400' : 'bg-stone-600')} />
                  <span className="min-w-0 flex-1 truncate">{o.name}</span>
                  <span className="font-mono text-stone-500 tabular-nums">{clock(o.end - o.start)}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
        <section className="grid grid-cols-2 gap-1.5">
          <Stat label="Cutting" value={`${(tl.cutLength / 1000).toFixed(1)} m`} />
          <Stat label="Rapids" value={`${(tl.rapidLength / 1000).toFixed(1)} m`} />
          <Stat label="Removed" value={units === 'in' ? `${(summary.removed / 16387.064).toFixed(1)} in³` : `${(summary.removed / 1000).toFixed(1)} cm³`} />
          <Stat label="Deepest" value={fmt(summary.deepest)} />
          <Stat label={rot ? 'Surface cut' : 'Face cut'} value={`${summary.cutPct.toFixed(1)}%`} />
          <Stat label="Cells" value={fmt(cell)} />
          {pieces && (pieces.scrap > 0 || pieces.offcut > 0) && <Stat label="Cut free" value={[pieces.scrap ? `${pieces.scrap} scrap` : '', pieces.offcut ? `${pieces.offcut} offcut${pieces.offcut > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ')} />}
        </section>
        {placeholders.length > 0 && (
          <section className="rounded-md border border-amber-400/30 bg-amber-400/5 p-2" data-cfg="sim:unconfirmed">
            <h3 className="mb-1 font-medium text-amber-200">Placeholder values in this simulation</h3>
            <p className="mb-1.5 text-[11px] text-stone-400">The simulation and collision check use these; they are not confirmed yet.</p>
            <UnconfirmedList items={placeholders} tone="dark" limit={5} />
          </section>
        )}
        <section>
          <h3 className="mb-1.5 font-medium text-stone-300">Collision check</h3>
          {check.error ? (
            <p className="text-red-200">Could not check: {check.error}</p>
          ) : !check.found ? (
            <p className="text-stone-400">{rot ? 'Checking shank, holder, rapids and the rotary axis' : 'Checking shank, holder, rapids and spoilboard'}… {Math.round(check.fraction * 100)}%</p>
          ) : check.found.length ? (
            <ul className="space-y-1">
              {check.found.slice(0, 12).map((c, i) => (
                <li key={i}>
                  <button type="button" className="flex w-full items-start gap-1.5 rounded-md border border-red-400/30 bg-red-400/10 p-1.5 text-left text-red-100 hover:bg-red-400/20" onClick={() => jump(c.t)} title="Go to this move">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      <Badge className="mr-1 h-4 bg-red-500/30 px-1 text-[10px] text-red-100">{KIND_LABEL[c.kind]}</Badge>
                      {rot ? c.message : <>{tl.ops[c.op]?.name}, {c.moves > 1 ? `moves ${c.move + 1}-${c.move + c.moves}` : `move ${c.move + 1}`}: X {fmt(c.at.x)} Y {fmt(c.at.y)} Z {fmt(c.at.z)}, {fmt(c.depth)} {c.kind === 'spoilboard' || c.kind === 'table' ? 'too deep' : 'into the material'}</>}
                    </span>
                  </button>
                </li>
              ))}
              {check.found.length > 12 && <li className="text-stone-500">and {check.found.length - 12} more</li>}
            </ul>
          ) : (
            <p className="flex items-center gap-1.5 text-stone-400">
              <Badge className="h-4 bg-emerald-500/20 px-1 text-[10px] text-emerald-200">clear</Badge> {rot ? 'No collisions of shank, holder or rapids with the material; the tool tip never reaches the rotary axis.' : 'No collisions of shank, holder or rapids with the material; nothing below the spoilboard limit.'}
            </p>
          )}
          <p className="mt-1 text-stone-500">Margin round shank and holder: {fmt(machine.collisionMargin ?? 2)} (Machine &amp; tools).</p>
        </section>
        <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={saveStl}>
          <Download /> Save stock as STL
        </Button>
        {rot ? (
          <p className="text-stone-500">
            Rotary: the top view shows the blank's surface unrolled ({fmt(stock.hf.length)} along {rot.axis} by {fmt(stock.hf.width)} round, darker = deeper towards the axis); in 3D the blank turns under the tool as it does on the machine. The tool stands square to the axis. Rays {fmt(stock.hf.cell)} apart.
            {flatLeft > 0 ? ` ${flatLeft} flat operation(s) of this part are not in the rotary simulation.` : ''}
          </p>
        ) : (
          <p className="text-stone-500">Edge (horizontal) drilling is drawn in the backplot but runs under the face, so it is not carved. Scrap and offcuts cut free are shown faded and drop out in the through-cut view; the part stays. The collision check keeps them in place (safer).</p>
        )}
      </aside>
    </div>
  )
}

function SpeedSelect({ label, value, options, onChange }: { label: string; value: number; options: number[]; onChange: (v: number) => void }) {
  return (
    <span className="flex items-center gap-1.5">
      {label}
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger size="sm" className="h-6 w-20 text-xs" aria-label={`${label} playback speed`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((s) => (
            <SelectItem key={s} value={String(s)}>
              {s}×
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </span>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 px-2 py-1.5">
      <div className="text-[10px] text-stone-500 uppercase">{label}</div>
      <div className="font-mono text-stone-200 tabular-nums">{value}</div>
    </div>
  )
}

interface ViewProps {
  sim: StockSimulation
  t: number
  part: CamPart
  base: [number, number, number]
  pos: { x: number; y: number; z: number }
  r: number
  rapid: boolean
  onCarved: () => void
}

/** Backplot drawn on a canvas: the program faintly, what has run brightly (added to as it plays). */
function drawBackplot(ctx: CanvasRenderingContext2D, tl: SimTimeline, from: number, to: number, t: number, o: { paths: boolean; rapids: boolean; faint: boolean; px: number; wrap?: number }) {
  // a rotary stock's unrolled surface: y comes round every `wrap`; a line over the seam is drawn in two
  const W = o.wrap
  const line = (ax: number, ay: number, bx: number, by: number) => {
    if (!W) {
      ctx.moveTo(ax, ay)
      ctx.lineTo(bx, by)
      return
    }
    const s = Math.floor(ay / W) * W
    const ya = ay - s
    const yb = by - s
    if (yb >= 0 && yb <= W) {
      ctx.moveTo(ax, ya)
      ctx.lineTo(bx, yb)
      return
    }
    const edge = yb > W ? W : 0
    const k = (edge - ya) / (yb - ya)
    const xm = ax + (bx - ax) * k
    ctx.moveTo(ax, ya)
    ctx.lineTo(xm, edge)
    ctx.moveTo(xm, W - edge)
    ctx.lineTo(bx, yb - (edge === W ? W : -W))
  }
  const strokes: [string, string, number[]][] = o.faint
    ? [
        ['cut', '#fbbf2433', []],
        ['rapid', '#f8717140', [3 * o.px, 4 * o.px]],
      ]
    : [
        ['cut', '#fbbf24', []],
        ['rapid', '#f87171', [3 * o.px, 4 * o.px]],
      ]
  for (const [key, color, dash] of strokes) {
    if (key === 'cut' ? !o.paths : !o.rapids) continue
    ctx.beginPath()
    for (let i = from; i < to; i++) {
      const s = tl.segs[i]
      if (s.kind === 'drill' || (s.kind === 'rapid') !== (key === 'rapid')) continue
      let bx = s.b.x
      let by = s.b.y
      if (!o.faint && t < s.t1) {
        const k = s.t1 > s.t0 ? Math.min(1, Math.max(0, (t - s.t0) / (s.t1 - s.t0))) : 1
        bx = s.a.x + (s.b.x - s.a.x) * k
        by = s.a.y + (s.b.y - s.a.y) * k
      }
      line(s.a.x, s.a.y, bx, by)
    }
    ctx.strokeStyle = color
    ctx.lineWidth = (o.faint ? 1 : 1.2) * o.px
    ctx.setLineDash(dash)
    ctx.stroke()
  }
  if (o.paths) {
    ctx.setLineDash([])
    ctx.lineWidth = o.px
    for (let i = from; i < to; i++) {
      const s = tl.segs[i]
      if (s.kind !== 'drill' || (!o.faint && s.t1 > t)) continue
      ctx.beginPath()
      ctx.arc(s.a.x, s.a.y, s.cutter.r, 0, Math.PI * 2)
      ctx.strokeStyle = o.faint ? '#38bdf840' : '#38bdf8'
      ctx.stroke()
    }
  }
}

function TopView({ sim, t, part, base, through, showPaths, showRapids, pos, seg, r, rapid, playing, onCarved, outline, onPieces, wrap }: ViewProps & { through: boolean; showPaths: boolean; showRapids: boolean; seg: number; playing: boolean; outline?: P[][]; onPieces: (p: { scrap: number; offcut: number }) => void; wrap?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const plot = useRef<HTMLCanvasElement>(null)
  const stock = sim.stock as HeightfieldStock | DexelStock | RotaryStock
  const { hf } = stock
  const { tl } = sim
  const L = part.length
  const W = part.width
  const m = Math.max(15, Math.max(...tl.ops.map((o) => o.cutter.r)) + 12)
  const VW = L + 2 * m
  const VH = W + 2 * m
  // (a rotary stock's surface is unrolled: angles past a turn come round again)
  const Y = (y: number) => W - (wrap ? ((y % wrap) + wrap) % wrap : y)
  // stock picture: shaded once in full, then only where the stock changed
  const img = useRef<{ data: ImageData; hf: unknown } | null>(null)
  const [loose, setLoose] = useState<Uint8Array | undefined>(undefined)
  const shaded = useRef<{ through: boolean; loose: Uint8Array | undefined; base: [number, number, number] } | null>(null)

  useLayoutEffect(() => {
    const c = canvas.current
    if (!c) return
    sim.syncTo(t)
    const ctx = c.getContext('2d')!
    const d = stock.takeDirty()
    const full = !img.current || img.current.hf !== hf || shaded.current?.through !== through || shaded.current.loose !== loose || shaded.current.base !== base
    if (full) {
      if (c.width !== hf.nx || c.height !== hf.ny) {
        c.width = hf.nx
        c.height = hf.ny
      }
      img.current = { data: ctx.createImageData(hf.nx, hf.ny), hf }
      shadeHeightfield(hf, img.current.data.data, { base, through, loose })
      ctx.putImageData(img.current.data, 0, 0)
      shaded.current = { through, loose, base }
    } else if (d) {
      const rc = cellRect(hf, d, 1)
      shadeHeightfield(hf, img.current!.data.data, { base, through, loose, rect: rc })
      ctx.putImageData(img.current!.data, 0, 0, rc.i0, hf.ny - rc.j1, rc.i1 - rc.i0, rc.j1 - rc.j0)
    }
    onCarved()
  }, [sim, stock, hf, t, base, through, loose, onCarved])

  // pieces cut free: worked out when paused (a flood fill of the whole stock)
  useEffect(() => {
    // (a turned part has no scrap or offcuts falling away)
    if (playing || wrap) return
    const id = setTimeout(() => {
      sim.syncTo(t)
      const p = cutFreePieces(hf, outline)
      setLoose(dropMask(p))
      onPieces({ scrap: p.pieces.filter((x) => x.kind === 'scrap').length, offcut: p.pieces.filter((x) => x.kind === 'offcut').length })
    }, 120)
    return () => clearTimeout(id)
  }, [playing, sim, hf, t, outline, onPieces, wrap])

  // backplot: the whole program faintly, then what has run on top
  const drawn = useRef<{ upTo: number; key: string } | null>(null)
  useLayoutEffect(() => {
    const c = plot.current
    if (!c) return
    const px = Math.min(4, 2400 / Math.max(VW, VH))
    const key = `${showPaths}:${showRapids}:${VW}:${VH}:${tl.segs.length}`
    const ctx = c.getContext('2d')!
    const upTo = seg < 0 ? 0 : seg + 1
    const setup = () => ctx.setTransform(px, 0, 0, -px, m * px, (W + m) * px)
    if (!drawn.current || drawn.current.key !== key || upTo < drawn.current.upTo) {
      c.width = Math.ceil(VW * px)
      c.height = Math.ceil(VH * px)
      setup()
      drawBackplot(ctx, tl, 0, tl.segs.length, t, { paths: showPaths, rapids: showRapids, faint: true, px: 1 / px, wrap })
      drawBackplot(ctx, tl, 0, upTo, t, { paths: showPaths, rapids: showRapids, faint: false, px: 1 / px, wrap })
    } else {
      setup()
      // the segment in progress last time is drawn again in full or up to now
      drawBackplot(ctx, tl, Math.max(0, drawn.current.upTo - 1), upTo, t, { paths: showPaths, rapids: showRapids, faint: false, px: 1 / px, wrap })
    }
    drawn.current = { upTo, key }
  }, [tl, seg, t, showPaths, showRapids, VW, VH, W, m, wrap])

  return (
    <div className="flex justify-center rounded-md border border-white/10 bg-[#0e1013] p-2">
      <div className="relative" style={{ aspectRatio: `${VW} / ${VH}`, width: `min(100%, calc(56vh * ${VW / VH}))` }}>
        <div className="absolute bg-[#2a2d33]" style={{ left: `${(m / VW) * 100}%`, top: `${(m / VH) * 100}%`, width: `${(L / VW) * 100}%`, height: `${(W / VH) * 100}%` }} />
        <canvas ref={canvas} aria-label="Material after cutting" className="absolute" style={{ left: `${(m / VW) * 100}%`, top: `${(m / VH) * 100}%`, width: `${(L / VW) * 100}%`, height: `${(W / VH) * 100}%`, imageRendering: 'pixelated' }} />
        <canvas ref={plot} aria-label="Backplot" className="absolute inset-0 size-full" />
        <svg viewBox={`${-m} ${-m} ${VW} ${VH}`} className="absolute inset-0 size-full" aria-label="Tool">
          <rect x={0} y={0} width={L} height={W} fill="none" stroke="#ffffff30" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <circle cx={pos.x} cy={Y(pos.y)} r={r} fill={rapid ? '#f8717133' : '#fde68a40'} stroke={rapid ? '#f87171' : '#fde68a'} strokeWidth={1.5} vectorEffect="non-scaling-stroke" opacity={pos.z > 0 ? 0.6 : 1} />
          <path d={`M${pos.x - r * 1.6} ${Y(pos.y)}H${pos.x + r * 1.6}M${pos.x} ${Y(pos.y) - r * 1.6}V${Y(pos.y) + r * 1.6}`} stroke={rapid ? '#f87171' : '#fde68a'} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        </svg>
        <ZGauge z={pos.z} thickness={part.thickness} />
      </div>
    </div>
  )
}

function ZGauge({ z, thickness }: { z: number; thickness: number }) {
  const top = 20
  const span = top + thickness + 6
  const frac = (v: number) => ((top - Math.max(-thickness - 6, Math.min(top, v))) / span) * 100
  return (
    <div className="absolute top-2 right-2 bottom-2 w-3 rounded-sm bg-black/40" aria-label="Tool height">
      <div className="absolute inset-x-0 bg-[#c9a979]/60" style={{ top: `${frac(0)}%`, height: `${(thickness / span) * 100}%` }} />
      <div className="absolute inset-x-[-3px] h-0.5 bg-amber-300" style={{ top: `${frac(z)}%` }} />
    </div>
  )
}

type Outline = CutterOutline

/** Saw blade to draw: radius, kerf, tilt and the direction of the cut the tool is on. */
type Blade = { r: number; kerf: number; tilt: number; dir: number; lean: number }
function bladeOf(tp: Toolpath | undefined, seg: { a: { x: number; y: number }; b: { x: number; y: number } } | null): Blade | null {
  const sw = tp?.saw
  if (!sw || !sw.cuts.length) return null
  // the cut whose line is nearest the segment the tool is on
  const at = seg ? { x: (seg.a.x + seg.b.x) / 2, y: (seg.a.y + seg.b.y) / 2 } : sw.cuts[0].a
  let best = sw.cuts[0]
  let bd = Infinity
  for (const c of sw.cuts) {
    const d = Math.hypot((c.a.x + c.b.x) / 2 - at.x, (c.a.y + c.b.y) / 2 - at.y)
    if (d < bd) {
      bd = d
      best = c
    }
  }
  const dir = Math.atan2(best.surf[1].y - best.surf[0].y, best.surf[1].x - best.surf[0].x)
  // lean: +1 when the floor sits to the left of the cut
  const lean = Math.sign(-Math.sin(dir) * best.floorOffset.x + Math.cos(dir) * best.floorOffset.y) || 1
  return { r: sw.r, kerf: sw.kerf, tilt: sw.tilt, dir, lean }
}

/** Edge work with an aggregate: the tool lies flat, pointing into the material, square to the move it is on. */
type Flat = { r: number; length: number; dir: number; housing?: NonNullable<NonNullable<Toolpath['edge']>['housing']> }
function flatOf(tp: Toolpath | undefined, seg: { a: { x: number; y: number }; b: { x: number; y: number } } | null): Flat | null {
  if (!tp?.edge || !seg) return null
  const along = Math.atan2(seg.b.y - seg.a.y, seg.b.x - seg.a.x)
  const still = Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y) < 1e-9
  // into the material: to the left of travel (or right); on the moves in and out, along the move
  const h = tp.edge.housing
  return { r: tp.edge.r, length: h && Number.isFinite(h.gauge) ? h.gauge : tp.edge.flute, dir: still ? 0 : along + (tp.edge.side === 'left' ? Math.PI / 2 : -Math.PI / 2), housing: h }
}

function View3D({ sim, t, part, base, pos, rapid, outline, blade, flat, r, opacity, section, spoilboard, onCarved }: Omit<ViewProps, 'r'> & { outline: Outline | null; blade: Blade | null; flat: Flat | null; r: number; opacity: number; section: { on: boolean; axis: 'x' | 'y'; at: number }; spoilboard: number }) {
  const max = Math.max(part.length, part.width)
  return (
    <div className="h-[56vh] min-h-72 overflow-hidden rounded-md border border-white/10 bg-[#0e1013]">
      <Canvas camera={{ position: [0, max * 0.75, max * 0.85], fov: 40, near: 1, far: max * 20 }}>
        <ambientLight intensity={0.55} />
        <directionalLight position={[-max, max * 1.5, max]} intensity={1.6} />
        {/* part frame: X along the length, Y along the width, Z up from face 1 */}
        <group rotation={[-Math.PI / 2, 0, 0]} position={[-part.length / 2, 0, part.width / 2]}>
          <StockMesh sim={sim} t={t} base={base} opacity={opacity} section={section} onCarved={onCarved} />
          <mesh position={[part.length / 2, part.width / 2, -part.thickness - spoilboard / 2]}>
            <boxGeometry args={[part.length + 40, part.width + 40, Math.max(1, spoilboard)]} />
            <meshStandardMaterial color="#3a3f47" />
          </mesh>
          {blade ? <BladeModel pos={pos} blade={blade} rapid={rapid} /> : flat ? <FlatToolModel pos={pos} flat={flat} rapid={rapid} /> : <ToolModel pos={pos} outline={outline} r={r} rapid={rapid} />}
        </group>
        <OrbitControls makeDefault />
      </Canvas>
    </div>
  )
}

/** A tool lying flat (aggregate), its tip at `pos`, pointing along `dir` in plan. */
function FlatToolModel({ pos, flat, rapid }: { pos: { x: number; y: number; z: number }; flat: Flat; rapid: boolean }) {
  // a cylinder runs along its Y axis: turn it to point along dir, tip at pos, body behind it
  return (
    <group position={[pos.x, pos.y, pos.z]} rotation={[0, 0, flat.dir - Math.PI / 2]}>
      <mesh position={[0, -flat.length / 2, 0]}>
        <cylinderGeometry args={[flat.r, flat.r, flat.length, 32]} />
        <meshStandardMaterial color={rapid ? '#f87171' : '#e7e5e4'} transparent opacity={0.7} metalness={0.4} roughness={0.3} />
      </mesh>
      {flat.housing ? (
        <>
          {/* the aggregate's housing behind the tool's face (TOOL-04), and the spindle above it */}
          <mesh position={[0, -flat.length - flat.housing.length / 2, (flat.housing.above - flat.housing.below) / 2]}>
            <boxGeometry args={[flat.housing.width, flat.housing.length, flat.housing.above + flat.housing.below]} />
            <meshStandardMaterial color="#64748b" transparent opacity={0.6} />
          </mesh>
          <mesh position={[0, -flat.length - flat.housing.length / 2, flat.housing.above + Math.max(10, -flat.housing.offset.z - flat.housing.above) / 2]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[Math.min(40, flat.housing.width / 2), Math.min(40, flat.housing.width / 2), Math.max(10, -flat.housing.offset.z - flat.housing.above), 24]} />
            <meshStandardMaterial color="#475569" transparent opacity={0.45} />
          </mesh>
        </>
      ) : (
        <mesh position={[0, -flat.length - 15, 0]}>
          <boxGeometry args={[flat.r * 4, 30, flat.r * 4]} />
          <meshStandardMaterial color="#64748b" transparent opacity={0.6} />
        </mesh>
      )}
    </group>
  )
}

/** A saw blade standing in the cut, its lowest point at `pos`, tilted about the cut line. */
function BladeModel({ pos, blade, rapid }: { pos: { x: number; y: number; z: number }; blade: Blade; rapid: boolean }) {
  const tilt = (blade.tilt * Math.PI) / 180
  // the disc (a cylinder about its Y axis) turned to stand in the vertical plane along the cut, then leaned
  return (
    <group position={[pos.x, pos.y, pos.z]} rotation={[0, 0, blade.dir]}>
      <group rotation={[blade.lean * tilt, 0, 0]}>
        <mesh position={[0, 0, blade.r]}>
          <cylinderGeometry args={[blade.r, blade.r, blade.kerf, 64]} />
          <meshStandardMaterial color={rapid ? '#f87171' : '#e7e5e4'} transparent opacity={0.6} metalness={0.5} roughness={0.3} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  )
}

/** Tool, shank and holder as revolved shapes, tip at `pos`. */
function ToolModel({ pos, outline, r, rapid }: { pos: { x: number; y: number; z: number }; outline: Outline | null; r: number; rapid: boolean }) {
  const parts = useMemo(() => {
    const o = outline ?? { r, flute: 30, shankR: r, gauge: Infinity, holder: [] }
    const top = Number.isFinite(o.gauge) ? o.gauge : o.flute + 30
    const lathe = (pts: [number, number][]) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 32)
    const out = [
      { geo: lathe([[0, 0], [o.r, 0], [o.r, o.flute], [0, o.flute]]), color: rapid ? '#f87171' : '#e7e5e4' },
      { geo: lathe([[0, o.flute], [o.shankR, o.flute], [o.shankR, top], [0, top]]), color: '#a8a29e' },
    ]
    if (o.holder.length) out.push({ geo: lathe([[0, o.holder[0].z], ...o.holder.map((p) => [p.r, p.z] as [number, number]), [0, o.holder[o.holder.length - 1].z]]), color: '#64748b' })
    return out
  }, [outline, r, rapid])
  useEffect(() => () => parts.forEach((p) => p.geo.dispose()), [parts])
  // the lathe turns about its own Y axis: turn it up the part's Z
  return (
    <group position={[pos.x, pos.y, pos.z]} rotation={[Math.PI / 2, 0, 0]}>
      {parts.map((p, i) => (
        <mesh key={i} geometry={p.geo}>
          <meshStandardMaterial color={p.color} transparent opacity={0.7} metalness={0.4} roughness={0.3} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  )
}

function StockMesh(props: Pick<ViewProps, 'sim' | 't' | 'base' | 'onCarved'> & { opacity: number; section: { on: boolean; axis: 'x' | 'y'; at: number } }) {
  return props.sim.stock.kind === 'dexel' ? <DexelStockMesh {...props} /> : <HeightfieldStockMesh {...props} />
}

/**
 * The dexel stock in 3D: cell-sized blocks, built again whenever the stock changes (at most four
 * times a second while playing). Shows material under an overhang.
 */
function DexelStockMesh({ sim, t, base, opacity, section, onCarved }: Pick<ViewProps, 'sim' | 't' | 'base' | 'onCarved'> & { opacity: number; section: { on: boolean; axis: 'x' | 'y'; at: number } }) {
  const stock = sim.stock as DexelStock
  const [geo, setGeo] = useState<THREE.BufferGeometry | null>(null)
  const [tick, setTick] = useState(0)
  const last = useRef(0)
  const pending = useRef(false)
  const built = useRef<string | null>(null)
  const key = `${section.on}:${section.axis}:${section.at}`
  useLayoutEffect(() => {
    sim.syncTo(t)
    const changed = !!stock.takeDirty() || pending.current
    if (!changed && built.current === key) return
    const now = performance.now()
    if (built.current === key && now - last.current < 250) {
      // at most four times a second: build again shortly
      pending.current = true
      const id = setTimeout(() => setTick((k) => k + 1), 260 - (now - last.current))
      return () => clearTimeout(id)
    }
    pending.current = false
    last.current = now
    built.current = key
    const m = stock.toMesh(section.on ? (section.axis === 'y' ? { j1: Math.max(1, Math.round(section.at * stock.ny)) } : { i1: Math.max(1, Math.round(section.at * stock.nx)) }) : {})
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
    g.setIndex(new THREE.BufferAttribute(m.indices, 1))
    g.computeVertexNormals()
    setGeo(g)
    onCarved()
  }, [sim, stock, t, key, section, tick, onCarved])
  useEffect(() => () => geo?.dispose(), [geo])
  const color = useMemo(() => new THREE.Color(base[0] / 255, base[1] / 255, base[2] / 255), [base])
  if (!geo) return null
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial color={color} roughness={0.85} transparent={opacity < 1} opacity={opacity} depthWrite={opacity >= 1} side={opacity < 1 ? THREE.FrontSide : THREE.DoubleSide} />
    </mesh>
  )
}

function HeightfieldStockMesh({ sim, t, base, opacity, section, onCarved }: Pick<ViewProps, 'sim' | 't' | 'base' | 'onCarved'> & { opacity: number; section: { on: boolean; axis: 'x' | 'y'; at: number } }) {
  const stock = sim.stock as HeightfieldStock
  const { hf } = stock
  const step = Math.max(1, Math.ceil(Math.max(hf.nx, hf.ny) / 240))
  const range: StockMeshRange = useMemo(() => {
    const o: StockMeshRange = { step }
    if (section.on) {
      if (section.axis === 'y') o.j1 = Math.max(1, Math.round(section.at * hf.ny))
      else o.i1 = Math.max(1, Math.round(section.at * hf.nx))
    }
    return o
  }, [step, section.on, section.axis, section.at, hf.nx, hf.ny])
  // (the heights are filled in below, for the time shown)
  const geo = useMemo(() => {
    const m = stockMesh(hf, range)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
    g.setIndex(new THREE.BufferAttribute(m.indices, 1))
    return g
  }, [hf, range])
  useEffect(() => () => geo.dispose(), [geo])

  useLayoutEffect(() => {
    sim.syncTo(t)
    stock.takeDirty()
    const p = geo.getAttribute('position') as THREE.BufferAttribute
    stockMeshTops(hf, p.array as Float32Array, range)
    p.needsUpdate = true
    geo.computeVertexNormals()
    onCarved()
  }, [sim, stock, hf, t, geo, range, onCarved])

  const color = useMemo(() => new THREE.Color(base[0] / 255, base[1] / 255, base[2] / 255), [base])
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial color={color} roughness={0.85} transparent={opacity < 1} opacity={opacity} depthWrite={opacity >= 1} side={opacity < 1 ? THREE.FrontSide : THREE.DoubleSide} />
    </mesh>
  )
}
