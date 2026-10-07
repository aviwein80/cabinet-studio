/**
 * The machine simulation's screen (M3.6, SIM-06): the whole machine replayed in 3D (its gantry,
 * head, spindle, tables, the part on the table with its clamps and the material left), from the
 * toolpaths converted for the machine or from a program read back (the part's own woodWOP program,
 * or a program file such as a post's output), with its own player and the machine collision list.
 */
import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { ChevronLeft, ChevronRight, FileUp, Pause, Play, TriangleAlert } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { MachineHit } from '@/cam/machine/check'
import { type AxisState, bodiesOf, kinOf, LINKS, machinePose, type Pose, tableBodies } from '@/cam/machine/model'
import { type MachineReplay, partPlacement, replayAt } from '@/cam/machine/replay'
import { writePartMpr } from '@/cam/mpr'
import { fixtureFrame, shapePieces } from '@/cam/fixtures/fixture'
import type { Toolpath } from '@/cam/toolpath'
import type { CamPart, Fixture } from '@/cam/types'
import { compute } from '@/cam/worker/client'
import { ValueBadges } from '@/components/Configure'
import { LenInput } from '@/components/LenInput'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Cancelled } from '@/core/cancel'
import { bodiesItem } from '@/core/confirm'
import { machineModelOf } from '@/core/machineModel'
import { formatLength } from '@/core/units'
import type { MachineBody, MachineLink, MachineProfile, UnitSystem } from '@/core/types'
import { cn } from '@/lib/utils'

export interface MachineChoice {
  id: string
  name: string
  profile: MachineProfile
}

type Source = 'toolpaths' | 'mpr' | 'file'

const SPEEDS = [1, 4, 16, 64]
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

const HIT_LABEL: Record<MachineHit['kind'], string> = { fixture: 'fixture', table: 'table', part: 'part', machine: 'machine', travel: 'travel' }

function poseMatrix(p: Pose): THREE.Matrix4 {
  const R = p.R
  return new THREE.Matrix4().set(R[0][0], R[0][1], R[0][2], p.t[0], R[1][0], R[1][1], R[1][2], p.t[1], R[2][0], R[2][1], R[2][2], p.t[2], 0, 0, 0, 1)
}

/** A group placed by a pose (machine frame). */
function Placed({ pose, children }: { pose: Pose; children: ReactNode }) {
  const m = useMemo(() => poseMatrix(pose), [pose])
  return (
    <group matrix={m} matrixAutoUpdate={false}>
      {children}
    </group>
  )
}

/** A machine part: a box between two corners, or a cylinder along x, y or z from its base. */
function BodyMesh({ body, hit }: { body: MachineBody; hit: boolean }) {
  const s = body.shape
  const color = hit ? '#ef4444' : body.link === 'frame' || body.link === 'table1' || body.link === 'table2' ? '#475569' : '#94a3b8'
  const mat = <meshStandardMaterial color={color} transparent opacity={hit ? 0.75 : 0.42} roughness={0.6} metalness={0.2} depthWrite={false} />
  if (s.k === 'box')
    return (
      <mesh position={[(s.min[0] + s.max[0]) / 2, (s.min[1] + s.max[1]) / 2, (s.min[2] + s.max[2]) / 2]}>
        <boxGeometry args={[s.max[0] - s.min[0], s.max[1] - s.min[1], s.max[2] - s.min[2]]} />
        {mat}
      </mesh>
    )
  // three's cylinder runs along its Y axis: turn it onto the body's axis
  const rot: [number, number, number] = s.axis === 'z' ? [Math.PI / 2, 0, 0] : s.axis === 'x' ? [0, 0, -Math.PI / 2] : [0, 0, 0]
  const mid: [number, number, number] = [s.base[0] + (s.axis === 'x' ? s.h / 2 : 0), s.base[1] + (s.axis === 'y' ? s.h / 2 : 0), s.base[2] + (s.axis === 'z' ? s.h / 2 : 0)]
  return (
    <mesh position={mid} rotation={rot}>
      <cylinderGeometry args={[s.r, s.r, s.h, 40]} />
      {mat}
    </mesh>
  )
}

/** A fixture's pieces as solids (part frame), standing on its base. */
function FixtureMesh({ f, hit }: { f: Fixture; hit: boolean }) {
  const geos = useMemo(
    () =>
      shapePieces(f.shape).map((p) => {
        if (p.round !== undefined) {
          const g = new THREE.CylinderGeometry(p.round, p.round, p.z1 - p.z0, 40)
          g.rotateX(Math.PI / 2)
          g.translate(0, 0, (p.z0 + p.z1) / 2)
          return g
        }
        const pts = p.poly!
        const shape = new THREE.Shape(Array.from({ length: pts.length >> 1 }, (_, k) => new THREE.Vector2(pts[2 * k], pts[2 * k + 1])))
        const g = new THREE.ExtrudeGeometry(shape, { depth: p.z1 - p.z0, bevelEnabled: false })
        g.translate(0, 0, p.z0)
        return g
      }),
    [f.shape],
  )
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos])
  const { R, o } = fixtureFrame(f)
  const m = useMemo(() => poseMatrix({ R, t: o }), [R, o])
  return (
    <group matrix={m} matrixAutoUpdate={false}>
      {geos.map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshStandardMaterial color={hit ? '#ef4444' : f.off ? '#78716c' : '#f59e0b'} transparent opacity={0.8} roughness={0.7} />
        </mesh>
      ))}
    </group>
  )
}

export function MachineView(props: {
  part: CamPart
  toolpaths: Toolpath[]
  machines: MachineChoice[]
  units: UnitSystem
  /** Each operation's stretch of the cutting simulation (for the stock shown). */
  spans: Record<string, { start: number; end: number }>
  /** The stock at a time of the cutting simulation (part frame). */
  renderStock: (t: number) => ReactNode
  /** The tool with its tip at `pos` along `axis` (machine frame), for the replay's operation. */
  renderTool: (pos: { x: number; y: number; z: number }, axis: { x: number; y: number; z: number }, op: MachineReplay['ops'][number] | null) => ReactNode
}) {
  const { part, toolpaths, machines, units, spans } = props
  const fmt = (n: number) => formatLength(n, units)
  const [machineId, setMachineId] = useState(machines[0]?.id ?? '')
  const choice = machines.find((m) => m.id === machineId) ?? machines[0]
  const machine = choice.profile
  const model = machineModelOf(machine)
  const kin = kinOf(model)
  const [source, setSource] = useState<Source>('toolpaths')
  const [file, setFile] = useState<{ name: string; text: string } | null>(null)
  const [at, setAt] = useState({ x: 0, y: 0 })
  const fileInput = useRef<HTMLInputElement>(null)
  const [run, setRun] = useState<{ key: string; replay: MachineReplay | null; hits: MachineHit[] | null; fraction: number; error?: string } | null>(null)
  const mpr = useMemo(() => {
    if (source !== 'mpr') return undefined
    try {
      return writePartMpr(part, toolpaths.filter((tp) => !tp.rotary && !tp.tilt && !tp.multiAxis), machine, 'MATERIAL')
    } catch {
      return undefined
    }
  }, [source, part, toolpaths, machine])
  const text = source === 'mpr' ? mpr : source === 'file' ? file?.text : undefined
  const key = useMemo(() => JSON.stringify([machineId, source, file?.name, at, part.length, part.width, part.thickness, part.fixtures, toolpaths.map((tp) => `${tp.opId}:${tp.moves.length}:${tp.stats.cut}`)]), [machineId, source, file?.name, at, part.length, part.width, part.thickness, part.fixtures, toolpaths])
  useEffect(() => {
    if (source === 'file' && !file) return
    const abort = new AbortController()
    const onProgress = (fraction: number) => setRun((r) => ({ key, replay: r?.key === key ? r.replay : null, hits: null, fraction }))
    compute()
      .run('sim.machine', { panel: { length: part.length, width: part.width, thickness: part.thickness, ...(part.fixtures?.length ? { fixtures: part.fixtures } : {}) }, toolpaths, machine, at, ...(text !== undefined ? { text } : {}), spans }, { signal: abort.signal, onProgress })
      .then((r) => setRun({ key, replay: r.replay, hits: r.hits, fraction: 1 }))
      .catch((e) => {
        if (!(e instanceof Cancelled) && !abort.signal.aborted) setRun({ key, replay: null, hits: null, fraction: 1, error: e instanceof Error ? e.message : String(e) })
      })
    return () => abort.abort()
    // (the key holds everything the replay depends on)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const cur = run?.key === key ? run : null
  const replay = cur?.replay ?? null
  const hits = cur?.hits ?? null
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(4)
  const tRef = useRef(0)
  useEffect(() => {
    tRef.current = t
  }, [t])
  const total = replay?.total ?? 0
  useEffect(() => {
    if (!playing || !replay) return
    let last = performance.now()
    let id = 0
    const tick = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000)
      last = now
      const next = Math.min(total, tRef.current + dt * speed)
      setT(next)
      if (next >= total) return setPlaying(false)
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [playing, speed, replay, total])
  const time = Math.min(t, total)
  const where = replay && replay.steps.length ? replayAt(replay, time) : null
  const step = where && where.step >= 0 ? replay!.steps[where.step] : null
  const op = step ? replay!.ops[step.op] : null
  const s: AxisState = where?.s ?? { x: model.toolChange.x, y: model.toolChange.y, z: model.toolChange.z, a1: 0, a2: 0 }
  const pose = machinePose(kin, s, op?.stickOut ?? 50)
  const partAt = replay?.partAt ?? partPlacement(machine, part, at)
  const bodies = useMemo(() => [...tableBodies(model, partAt[2] - part.thickness), ...bodiesOf(model)], [model, partAt, part.thickness])
  // what is hitting now: the hits whose run of steps holds the current step
  const now = useMemo(() => {
    const out = new Set<string>()
    if (!hits || !where) return out
    for (const h of hits) if (where.step >= h.step && where.step < h.step + h.steps) out.add(h.mover).add(h.other)
    return out
  }, [hits, where])
  const stockT = step?.stockT ?? 0
  const tp2 = pose.links.table2
  const partPose: Pose = { R: tp2.R, t: [0, 1, 2].map((i) => tp2.t[i] + tp2.R[i][0] * partAt[0] + tp2.R[i][1] * partAt[1] + tp2.R[i][2] * partAt[2]) as [number, number, number] }
  const size = Math.max(part.length, part.width, 600)
  const centre = [partAt[0] + part.length / 2, partAt[1] + part.width / 2, partAt[2] - part.thickness / 2]
  const placeholder = bodiesItem(machine)
  const letters = replay?.letters ?? (kin ? [kin.first, kin.second] : null)
  const jump = (to: number) => {
    setPlaying(false)
    setT(Math.max(0, Math.min(total, to)))
  }

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="machine-view">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <label className="flex items-center gap-1.5">
          Machine
          <select aria-label="Machine" className="h-6 rounded-md border border-white/15 bg-transparent px-1.5 text-xs" value={machineId} onChange={(e) => setMachineId(e.target.value)}>
            {machines.map((m) => (
              <option key={m.id} value={m.id} className="bg-[#15171c]">
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          Replay
          <select aria-label="What is replayed" className="h-6 rounded-md border border-white/15 bg-transparent px-1.5 text-xs" value={source} onChange={(e) => setSource(e.target.value as Source)}>
            <option value="toolpaths" className="bg-[#15171c]">
              The toolpaths, converted for this machine
            </option>
            {!kin && (
              <option value="mpr" className="bg-[#15171c]">
                This part's woodWOP program, read back
              </option>
            )}
            <option value="file" className="bg-[#15171c]">
              A program file (a post's output)…
            </option>
          </select>
        </label>
        {source === 'file' && (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => fileInput.current?.click()}>
            <FileUp /> {file ? file.name : 'Choose a program'}
          </Button>
        )}
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          accept=".nc,.tap,.gcode,.ngc,.cnc,.txt,.mpr"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) setFile({ name: f.name, text: await f.text() })
          }}
        />
        {!kin && (
          <span className="flex items-center gap-1.5">
            Part at X <LenInput label="Part's corner on the table, X" value={at.x} units={units} onChange={(v) => Number.isFinite(v) && setAt((a) => ({ ...a, x: v }))} className="h-6 w-20 text-xs" /> Y <LenInput label="Part's corner on the table, Y" value={at.y} units={units} onChange={(v) => Number.isFinite(v) && setAt((a) => ({ ...a, y: v }))} className="h-6 w-20 text-xs" />
          </span>
        )}
      </div>
      <div className="h-[56vh] min-h-72 overflow-hidden rounded-md border border-white/10 bg-[#0e1013]">
        <Canvas camera={{ position: [centre[0] + size * 0.9, centre[2] + size * 1.1, -centre[1] + size * 1.4], fov: 40, near: 5, far: size * 40 }}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[centre[0] - size, size * 2, -centre[1] + size]} intensity={1.5} />
          {/* machine frame: X along the table, Y across, Z up */}
          <group rotation={[-Math.PI / 2, 0, 0]}>
            {LINKS.map((l: MachineLink) => (
              <Placed key={l} pose={pose.links[l]}>
                {bodies
                  .filter((b) => b.link === l)
                  .map((b) => (
                    <BodyMesh key={b.id} body={b} hit={now.has(b.name)} />
                  ))}
              </Placed>
            ))}
            <Placed pose={partPose}>
              {props.renderStock(stockT)}
              {(part.fixtures ?? []).map((f) => (
                <FixtureMesh key={f.id} f={f} hit={now.has(`fixture "${f.name}"`)} />
              ))}
            </Placed>
            {props.renderTool({ x: pose.tip[0], y: pose.tip[1], z: pose.tip[2] }, { x: pose.tool[0], y: pose.tool[1], z: pose.tool[2] }, op)}
          </group>
          <OrbitControls makeDefault target={[centre[0], centre[2], -centre[1]]} />
        </Canvas>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon-sm" variant="ghost" aria-label="Previous machine collision" title="Previous machine collision" onClick={() => jump([...(hits ?? [])].reverse().find((h) => h.t < time - 1e-6)?.t ?? 0)}>
          <ChevronLeft />
        </Button>
        <Button size="icon-sm" variant="secondary" aria-label={playing ? 'Pause' : 'Play'} onClick={() => (time >= total ? (setT(0), setPlaying(true)) : setPlaying((p) => !p))} disabled={!replay}>
          {playing ? <Pause /> : <Play />}
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Next machine collision" title="Next machine collision" onClick={() => jump((hits ?? []).find((h) => h.t > time + 1e-6)?.t ?? total)}>
          <ChevronRight />
        </Button>
        <Slider className="min-w-40 flex-1" min={0} max={Math.max(total, 1e-6)} step={Math.max(total, 1e-6) / 2000} value={[time]} onValueChange={([v]) => jump(v)} aria-label="Machine time" />
        <span className="w-24 text-right font-mono text-xs text-stone-300 tabular-nums">
          {clock(time)} / {clock(total)}
        </span>
        <select aria-label="Replay speed" className="h-6 rounded-md border border-white/15 bg-transparent px-1 text-xs" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          {SPEEDS.map((v) => (
            <option key={v} value={v} className="bg-[#15171c]">
              ×{v}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-md bg-black/30 px-3 py-1.5 font-mono text-xs text-stone-300 tabular-nums">
        <span>X {fmt(s.x)}</span>
        <span>Y {fmt(s.y)}</span>
        <span>Z {fmt(s.z)}</span>
        {letters && (
          <>
            <span className="text-orange-300">
              {letters[0]} {s.a1.toFixed(2)}°
            </span>
            <span className="text-orange-300">
              {letters[1]} {s.a2.toFixed(2)}°
            </span>
          </>
        )}
        <span className={cn(step?.kind === 'rapid' ? 'text-red-300' : 'text-amber-200')}>{step ? (step.kind === 'change' ? 'tool change' : step.link ? 'between operations' : step.kind === 'rapid' ? 'rapid' : 'cutting') : 'start'}</span>
        {step && !step.link && <span>move {(step.move + 1).toLocaleString('en')}</span>}
        {step?.line && <span>line {step.line}</span>}
        <span className="truncate font-sans text-stone-400">{op ? `${op.name}${op.tool ? ` · T${op.tool.number}` : ''}` : ''}</span>
      </div>
      <section className="flex flex-col gap-1.5 text-xs">
        <h3 className="flex flex-wrap items-center gap-2 font-medium text-stone-300">
          Machine collision check {placeholder && <span className="flex items-center gap-1 text-[11px] font-normal text-amber-200">machine parts invented <ValueBadges item={placeholder} /></span>}
        </h3>
        {cur?.error ? (
          <p className="text-red-200">Could not replay: {cur.error}</p>
        ) : source === 'file' && !file ? (
          <p className="text-stone-400">Choose a program file to replay it on {choice.name}.</p>
        ) : !hits ? (
          <p className="text-stone-400">Replaying on {choice.name} and checking the gantry, head, spindle, tool and holder against the table, the part and its fixtures… {Math.round((cur?.fraction ?? 0) * 100)}%</p>
        ) : hits.length ? (
          <ul className="space-y-1">
            {hits.slice(0, 12).map((h, i) => (
              <li key={i}>
                <button type="button" className="flex w-full items-start gap-1.5 rounded-md border border-red-400/30 bg-red-400/10 p-1.5 text-left text-red-100 hover:bg-red-400/20" onClick={() => jump(h.t)} title="Go there">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    <Badge className="mr-1 h-4 bg-red-500/30 px-1 text-[10px] text-red-100">{HIT_LABEL[h.kind]}</Badge>
                    {h.message}
                  </span>
                </button>
              </li>
            ))}
            {hits.length > 12 && <li className="text-stone-500">and {hits.length - 12} more</li>}
          </ul>
        ) : (
          <p className="flex items-center gap-1.5 text-stone-400">
            <Badge className="h-4 bg-emerald-500/20 px-1 text-[10px] text-emerald-200">clear</Badge> No part of the machine comes within the margin ({fmt(machine.collisionMargin ?? 2)}) of the table, the part or its fixtures; every axis stays inside its travel.
          </p>
        )}
        {replay && [...replay.problems, ...replay.notes].length > 0 && (
          <ul className="list-disc pl-4 text-[11px] text-amber-200/90">
            {[...replay.problems, ...replay.notes].slice(0, 6).map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-stone-500">
          Our own replay of the machine model ({model.placeholder ? 'placeholder figures' : 'confirmed figures'}): a check of our programs against the machine's parts as entered, not of the real machine. The part counts as its whole block against the head; the cutter, shank and holder in the material are the cutting check's. Simulate in woodWOP before cutting.
        </p>
      </section>
    </div>
  )
}
