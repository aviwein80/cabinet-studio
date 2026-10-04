import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { CirclePlay, Pause, Play, SkipBack, SkipForward, TriangleAlert } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { buildTimeline, carve, checkRapids, createHeightfield, cutSummary, type Heightfield, looseMask, positionAt, programOrder, resetHeightfield, shadeHeightfield, type SimTimeline } from '@/cam/sim'
import type { Toolpath } from '@/cam/toolpath'
import type { CamPart } from '@/cam/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { formatLength } from '@/core/units'
import type { UnitSystem } from '@/core/types'
import { cn } from '@/lib/utils'

const SPEEDS = [1, 4, 16, 64, 256]

/** Heightfield carved lazily to whatever time is asked for (replays from 0 to go back). */
class SimState {
  hf: Heightfield
  tl: SimTimeline
  at = 0
  constructor(hf: Heightfield, tl: SimTimeline) {
    this.hf = hf
    this.tl = tl
  }
  syncTo(t: number) {
    if (t === this.at) return
    if (t < this.at) {
      resetHeightfield(this.hf)
      this.at = 0
    }
    carve(this.hf, this.tl, this.at, t)
    this.at = t
  }
}

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

export function SimulateDialog({ open, onOpenChange, part, toolpaths, units, color }: { open: boolean; onOpenChange: (o: boolean) => void; part: CamPart; toolpaths: Toolpath[]; units: UnitSystem; color?: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dark max-h-[96vh] overflow-y-auto border-white/10 bg-[#15171c] text-stone-100 sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CirclePlay className="size-4" /> Simulate cutting
          </DialogTitle>
          <DialogDescription className="text-stone-400">Plays the toolpaths in program order: cutting moves, rapids, the tool and the material left behind. A check of our own toolpaths, not of the machine; simulate in woodWOP before cutting.</DialogDescription>
        </DialogHeader>
        {open && <Simulator part={part} toolpaths={toolpaths} units={units} color={color} />}
      </DialogContent>
    </Dialog>
  )
}

function Simulator({ part, toolpaths, units, color }: { part: CamPart; toolpaths: Toolpath[]; units: UnitSystem; color?: string }) {
  const tl = useMemo(() => buildTimeline(programOrder(toolpaths)), [toolpaths])
  const sim = useMemo(() => new SimState(createHeightfield(part.length, part.width, part.thickness), tl), [part.length, part.width, part.thickness, tl])
  const rapids = useMemo(() => checkRapids(tl, part.length, part.width, part.thickness, Math.max(1, Math.max(part.length, part.width) / 400)), [tl, part.length, part.width, part.thickness])
  const [t, setT] = useState(tl.total)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(16)
  const [view, setView] = useState<'top' | '3d'>('top')
  const [showPaths, setShowPaths] = useState(true)
  const [showRapids, setShowRapids] = useState(true)
  const [through, setThrough] = useState(false)
  const base = useMemo(() => hexRgb(color ?? ''), [color])
  const fmt = (n: number) => formatLength(n, units)

  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    let id = 0
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      setT((p) => {
        const n = Math.min(tl.total, p + dt * speed)
        if (n >= tl.total) setPlaying(false)
        return n
      })
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [playing, speed, tl.total])

  const pos = positionAt(tl, t)
  const cur = pos.seg >= 0 ? tl.segs[pos.seg] : null
  const op = pos.op >= 0 ? tl.ops[pos.op] : null
  const cutter = cur?.cutter ?? op?.cutter ?? { r: 3, shape: 'flat' as const, angle: 0 }
  const [summary, setSummary] = useState(() => {
    sim.syncTo(t)
    return cutSummary(sim.hf)
  })

  if (!tl.segs.length)
    return <p className="rounded-md border border-white/10 bg-white/5 p-6 text-center text-sm text-stone-400">No toolpaths to simulate. Add operations on the Machining tab.</p>

  const play = () => {
    if (t >= tl.total) setT(0)
    setPlaying((p) => !p)
  }
  const jump = (to: number) => {
    setPlaying(false)
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
          <label className="flex items-center gap-1.5">
            <Switch checked={showPaths} onCheckedChange={setShowPaths} size="sm" /> Backplot
          </label>
          <label className="flex items-center gap-1.5">
            <Switch checked={showRapids} onCheckedChange={setShowRapids} size="sm" /> Rapids
          </label>
          <label className="flex items-center gap-1.5">
            <Switch checked={through} onCheckedChange={setThrough} size="sm" /> Through cuts only
          </label>
        </div>
        {view === 'top' ? (
          <TopView sim={sim} t={t} part={part} base={base} through={through} showPaths={showPaths} showRapids={showRapids} pos={pos.p} seg={pos.seg} r={cutter.r} rapid={pos.kind === 'rapid'} onCarved={setSummary} />
        ) : (
          <View3D sim={sim} t={t} part={part} base={base} pos={pos.p} r={cutter.r} rapid={pos.kind === 'rapid'} onCarved={setSummary} />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="icon-sm" variant="ghost" aria-label="Previous operation" onClick={prevOp}>
            <SkipBack />
          </Button>
          <Button size="icon-sm" variant="secondary" aria-label={playing ? 'Pause' : 'Play'} onClick={play}>
            {playing ? <Pause /> : <Play />}
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Next operation" onClick={nextOp}>
            <SkipForward />
          </Button>
          <Slider className="min-w-40 flex-1" min={0} max={tl.total} step={tl.total / 2000} value={[t]} onValueChange={([v]) => jump(v)} aria-label="Program time" />
          <span className="w-24 text-right font-mono text-xs text-stone-300 tabular-nums">
            {clock(t)} / {clock(tl.total)}
          </span>
          <Select value={String(speed)} onValueChange={(v) => setSpeed(Number(v))}>
            <SelectTrigger size="sm" className="h-7 w-20 text-xs" aria-label="Playback speed">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SPEEDS.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s}×
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-md bg-black/30 px-3 py-1.5 font-mono text-xs text-stone-300 tabular-nums">
          <span>X {fmt(pos.p.x)}</span>
          <span>Y {fmt(pos.p.y)}</span>
          <span>Z {fmt(pos.p.z)}</span>
          <span className={cn(pos.kind === 'rapid' ? 'text-red-300' : 'text-amber-200')}>{pos.kind ? (pos.kind === 'rapid' ? 'rapid' : pos.kind === 'drill' ? 'drilling' : pos.kind === 'plunge' ? 'plunge / ramp' : pos.kind === 'lead' ? 'lead' : 'cutting') : 'home'}</span>
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
          <Stat label="Face cut" value={`${summary.cutPct.toFixed(1)}%`} />
          <Stat label="Deepest" value={fmt(summary.deepest)} />
        </section>
        <section>
          <h3 className="mb-1.5 font-medium text-stone-300">Rapid check</h3>
          {rapids.length ? (
            <ul className="space-y-1">
              {rapids.slice(0, 8).map((w, i) => (
                <li key={i}>
                  <button type="button" className="flex w-full items-start gap-1.5 rounded-md border border-red-400/30 bg-red-400/10 p-1.5 text-left text-red-100 hover:bg-red-400/20" onClick={() => jump(w.t)}>
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      {tl.ops[w.op]?.name}: rapid into material at X {fmt(w.at.x)} Y {fmt(w.at.y)} Z {fmt(w.at.z)}
                    </span>
                  </button>
                </li>
              ))}
              {rapids.length > 8 && <li className="text-stone-500">and {rapids.length - 8} more</li>}
            </ul>
          ) : (
            <p className="flex items-center gap-1.5 text-stone-400">
              <Badge className="h-4 bg-emerald-500/20 px-1 text-[10px] text-emerald-200">clear</Badge> No rapid passes through uncut material.
            </p>
          )}
        </section>
        <p className="text-stone-500">Edge (horizontal) drilling is drawn in the backplot but runs under the face, so it is not carved. Pieces cut free are shown faded and drop out in the through-cut view.</p>
      </aside>
    </div>
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
  sim: SimState
  t: number
  part: CamPart
  base: [number, number, number]
  pos: { x: number; y: number; z: number }
  r: number
  rapid: boolean
  onCarved: (s: ReturnType<typeof cutSummary>) => void
}

function TopView({ sim, t, part, base, through, showPaths, showRapids, pos, seg, r, rapid, onCarved }: ViewProps & { through: boolean; showPaths: boolean; showRapids: boolean; seg: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const { hf, tl } = sim
  const L = part.length
  const W = part.width
  const m = Math.max(15, Math.max(...tl.ops.map((o) => o.cutter.r)) + 12)
  const VW = L + 2 * m
  const VH = W + 2 * m
  const Y = (y: number) => W - y
  const pieces = useMemo(() => tl.segs.map((s) => (s.kind === 'drill' ? '' : `M${s.a.x.toFixed(2)} ${(W - s.a.y).toFixed(2)}L${s.b.x.toFixed(2)} ${(W - s.b.y).toFixed(2)}`)), [tl, W])
  const drills = useMemo(() => tl.segs.filter((s) => s.kind === 'drill'), [tl])

  useLayoutEffect(() => {
    const c = canvas.current
    if (!c) return
    sim.syncTo(t)
    if (c.width !== hf.nx || c.height !== hf.ny) {
      c.width = hf.nx
      c.height = hf.ny
    }
    const ctx = c.getContext('2d')!
    const img = ctx.createImageData(hf.nx, hf.ny)
    shadeHeightfield(hf, img.data, { base, through, loose: looseMask(hf) })
    ctx.putImageData(img, 0, 0)
    onCarved(cutSummary(hf))
  }, [sim, hf, t, base, through, onCarved])

  const done = { cut: '', rapid: '' }
  const todo = { cut: '', rapid: '' }
  if (showPaths || showRapids)
    for (let i = 0; i < tl.segs.length; i++) {
      const s = tl.segs[i]
      if (!pieces[i]) continue
      const key = s.kind === 'rapid' ? 'rapid' : 'cut'
      if (key === 'rapid' ? !showRapids : !showPaths) continue
      if (i < seg) done[key] += pieces[i]
      else if (i > seg) todo[key] += pieces[i]
      else {
        const k = s.t1 > s.t0 ? Math.min(1, Math.max(0, (t - s.t0) / (s.t1 - s.t0))) : 1
        const mx = s.a.x + (s.b.x - s.a.x) * k
        const my = s.a.y + (s.b.y - s.a.y) * k
        done[key] += `M${s.a.x} ${Y(s.a.y)}L${mx} ${Y(my)}`
        todo[key] += `M${mx} ${Y(my)}L${s.b.x} ${Y(s.b.y)}`
      }
    }

  return (
    <div className="flex justify-center rounded-md border border-white/10 bg-[#0e1013] p-2">
      <div className="relative" style={{ aspectRatio: `${VW} / ${VH}`, width: `min(100%, calc(56vh * ${VW / VH}))` }}>
        <div className="absolute bg-[#2a2d33]" style={{ left: `${(m / VW) * 100}%`, top: `${(m / VH) * 100}%`, width: `${(L / VW) * 100}%`, height: `${(W / VH) * 100}%` }} />
        <canvas ref={canvas} aria-label="Material after cutting" className="absolute" style={{ left: `${(m / VW) * 100}%`, top: `${(m / VH) * 100}%`, width: `${(L / VW) * 100}%`, height: `${(W / VH) * 100}%` }} />
        <svg viewBox={`${-m} ${-m} ${VW} ${VH}`} className="absolute inset-0 size-full" aria-label="Backplot">
          <rect x={0} y={0} width={L} height={W} fill="none" stroke="#ffffff30" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {showPaths && <path d={todo.cut} stroke="#fbbf2433" strokeWidth={1} fill="none" vectorEffect="non-scaling-stroke" />}
          {showRapids && <path d={todo.rapid} stroke="#f8717140" strokeWidth={1} strokeDasharray="3 4" fill="none" vectorEffect="non-scaling-stroke" />}
          {showPaths && <path d={done.cut} stroke="#fbbf24" strokeWidth={1.2} fill="none" vectorEffect="non-scaling-stroke" />}
          {showRapids && <path d={done.rapid} stroke="#f87171" strokeWidth={1} strokeDasharray="3 4" fill="none" vectorEffect="non-scaling-stroke" />}
          {showPaths && drills.map((s, i) => <circle key={i} cx={s.a.x} cy={Y(s.a.y)} r={s.cutter.r} fill="none" stroke={s.t1 <= t ? '#38bdf8' : '#38bdf840'} strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
          <g aria-label="Tool">
            <circle cx={pos.x} cy={Y(pos.y)} r={r} fill={rapid ? '#f8717133' : '#fde68a40'} stroke={rapid ? '#f87171' : '#fde68a'} strokeWidth={1.5} vectorEffect="non-scaling-stroke" opacity={pos.z > 0 ? 0.6 : 1} />
            <path d={`M${pos.x - r * 1.6} ${Y(pos.y)}H${pos.x + r * 1.6}M${pos.x} ${Y(pos.y) - r * 1.6}V${Y(pos.y) + r * 1.6}`} stroke={rapid ? '#f87171' : '#fde68a'} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          </g>
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

function View3D({ sim, t, part, base, pos, r, rapid, onCarved }: ViewProps) {
  const max = Math.max(part.length, part.width)
  return (
    <div className="h-[56vh] min-h-72 overflow-hidden rounded-md border border-white/10 bg-[#0e1013]">
      <Canvas camera={{ position: [0, max * 0.75, max * 0.85], fov: 40, near: 1, far: max * 20 }}>
        <ambientLight intensity={0.55} />
        <directionalLight position={[-max, max * 1.5, max]} intensity={1.6} />
        <HeightMesh sim={sim} t={t} part={part} base={base} onCarved={onCarved} />
        <mesh position={[0, -part.thickness - 1, 0]}>
          <boxGeometry args={[part.length + 40, 2, part.width + 40]} />
          <meshStandardMaterial color="#3a3f47" />
        </mesh>
        <group position={[pos.x - part.length / 2, pos.z, -(pos.y - part.width / 2)]}>
          <mesh position={[0, 20, 0]}>
            <cylinderGeometry args={[r, r, 40, 32]} />
            <meshStandardMaterial color={rapid ? '#f87171' : '#e7e5e4'} transparent opacity={0.55} metalness={0.4} roughness={0.3} />
          </mesh>
        </group>
        <OrbitControls makeDefault />
      </Canvas>
    </div>
  )
}

function HeightMesh({ sim, t, part, base, onCarved }: Pick<ViewProps, 'sim' | 't' | 'part' | 'base' | 'onCarved'>) {
  const { hf } = sim
  const step = Math.max(1, Math.ceil(Math.max(hf.nx, hf.ny) / 240))
  const gx = Math.floor((hf.nx - 1) / step) + 1
  const gy = Math.floor((hf.ny - 1) / step) + 1
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(gx * gy * 3)
    const idx: number[] = []
    for (let j = 0; j < gy; j++)
      for (let i = 0; i < gx; i++) {
        const k = (j * gx + i) * 3
        pos[k] = Math.min(part.length, (i * step + 0.5) * hf.cell) - part.length / 2
        pos[k + 2] = -(Math.min(part.width, (j * step + 0.5) * hf.cell) - part.width / 2)
        if (i < gx - 1 && j < gy - 1) {
          const a = j * gx + i
          idx.push(a, a + 1, a + gx, a + 1, a + gx + 1, a + gx)
        }
      }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(gx * gy * 3), 3))
    g.setIndex(idx)
    return g
  }, [gx, gy, step, hf.cell, part.length, part.width])
  useEffect(() => () => geo.dispose(), [geo])

  useLayoutEffect(() => {
    sim.syncTo(t)
    const p = geo.getAttribute('position') as THREE.BufferAttribute
    const c = geo.getAttribute('color') as THREE.BufferAttribute
    const [r, g, b] = base.map((v) => v / 255)
    for (let j = 0; j < gy; j++)
      for (let i = 0; i < gx; i++) {
        const v = hf.top[j * step * hf.nx + i * step]
        const k = j * gx + i
        p.setY(k, v)
        const d = Math.min(1, -v / hf.thickness)
        const dim = d >= 0.999 ? 0.25 : 1 - d * 0.45
        c.setXYZ(k, r * dim, g * dim, b * dim + d * 0.08)
      }
    p.needsUpdate = true
    c.needsUpdate = true
    geo.computeVertexNormals()
    onCarved(cutSummary(hf))
  }, [sim, hf, t, geo, gx, gy, step, base, onCarved])

  return (
    <mesh geometry={geo}>
      <meshStandardMaterial vertexColors roughness={0.85} side={THREE.DoubleSide} />
    </mesh>
  )
}
