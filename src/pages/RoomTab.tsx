import { type PointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Copy, Redo2, RotateCw, Undo2, X } from 'lucide-react'
import { nanoid } from 'nanoid'
import { toast } from 'sonner'
import { useStore } from '@/app/store'
import { Viewer3D } from '@/components/Viewer3D'
import { useConfigureTarget } from '@/components/configureFocus'
import { KitchenFields } from '@/components/KitchenFields'
import { kindLabel } from '@/components/kindLabel'
import { NumField, SelectField } from '@/components/fields'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { buildCabinet } from '@/core/construction/carcass'
import { WALLS, alongPoint, elevationOf, placementFromElevation, type WallId } from '@/core/elevation'
import { KITCHEN_PRESETS } from '@/core/defaults'
import { intendedText, openingBox, openingConflictText, openingConflicts, openingName, openingRoomSpan, openingsOf, openingsOutside } from '@/core/openings'
import {
  arrangeCabinets,
  copyCabinet,
  cornerClearance,
  cornerHints,
  cornerHintText,
  describeResize,
  fillGap,
  fillersPastWall,
  footprint,
  nextRotation,
  pieClearance,
  placementOf,
  planBoxes,
  pushNeighbours,
  roomProblems,
  runGaps,
  snapBackToWall,
  snapPlacement,
  toRoom,
  turnedTo,
  wallBehind,
  type FillerShrink,
  type RoomBlock,
  type RunGap,
  type SnapTarget,
} from '@/core/room'
import { elevationShapes, groupOf, moveGroup, planShapes, roomPartSolids } from '@/core/roomParts'
import { roomSnapshot, type RoomSnapshot } from '@/core/roomUndo'
import { formatLength } from '@/core/units'
import type { CabinetInstance, CabinetPlacement, CarcassParams, Job, Part, Room } from '@/core/types'
import { cn } from '@/lib/utils'
import { ElevationView, PlanView, type RoomExtras } from './RoomDrawings'
import { OpeningsPanel } from './room/OpeningsPanel'
import { RoomPartsPanel } from './room/RoomPartsPanel'

function placedPart(part: Part, pl: CabinetPlacement, width: number, depth: number, id: string): Part {
  const zero: CabinetPlacement = { ...pl, x: 0, y: 0, z: 0 }
  const dir = (v: [number, number, number]): [number, number, number] => {
    const a = toRoom(0, 0, 0, zero, width, depth)
    const b = toRoom(v[0], v[1], v[2], zero, width, depth)
    return [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  }
  const o = part.frame.origin
  return {
    ...part,
    key: `${id}:${part.key}`,
    frame: { origin: toRoom(o[0], o[1], o[2], pl, width, depth), u: dir(part.frame.u), v: dir(part.frame.v), n: dir(part.frame.n) },
  }
}

type Drag = { id: string; dx: number; dy: number; mode: 'plan' | 'elevation' | 'part' }

const DEFAULT_ROOM: Room = { width: 3657.6, depth: 3048, height: 2438.4 }

const ROTATIONS: { value: '0' | '90' | '180' | '270'; label: string }[] = [
  { value: '0', label: '0° · back to the back wall' },
  { value: '90', label: '90° · back to the right wall' },
  { value: '180', label: '180° · back to the front wall' },
  { value: '270', label: '270° · back to the left wall' },
]

/** Library-1: a short notice after a change: what a width change moved along the run, or where a copy went. */
type Notice = { text: string; ids: string[]; tone: 'info' | 'warn' }

export function RoomTab({ job, setJob }: { job: Job; setJob: (fn: (j: Job) => void) => void }) {
  const data = useStore((s) => s.data)!
  const go = useStore((s) => s.go)
  const editRoom = useStore((s) => s.editRoom)
  const recordRoom = useStore((s) => s.recordRoom)
  const undoRoom = useStore((s) => s.undoRoom)
  const undoStep = useStore((s) => [...s.roomUndo].reverse().find((x) => x.jobId === job.id))
  const redoStep = useStore((s) => [...s.roomRedo].reverse().find((x) => x.jobId === job.id))
  const units = data.settings.units
  const room: Room = job.room ?? DEFAULT_ROOM
  // Library-1: a copy made on the Cabinets tab opens here selected
  const roomFocus = useStore((s) => s.roomFocus)
  const focusRoom = useStore((s) => s.focusRoom)
  const [selected, setSelected] = useState<string | null>(roomFocus?.jobId === job.id && job.cabinets.some((c) => c.id === roomFocus.cabinetId) ? roomFocus.cabinetId : (job.cabinets[0]?.id ?? null))
  useEffect(() => {
    if (roomFocus?.jobId !== job.id) return
    setSelected(roomFocus.cabinetId)
    focusRoom(job.id, null)
  }, [roomFocus, job.id, focusRoom])
  const [selPart, setSelPart] = useState<string | null>(null)
  const [selOpening, setSelOpening] = useState<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragBefore = useRef<{ snap: RoomSnapshot; label: string } | null>(null)
  const [view, setView] = useState<'3d' | 'plan' | 'elevation'>('3d')
  const [wall, setWall] = useState<WallId>('back')
  const [snapOn, setSnapOn] = useState(true)
  const [alt, setAlt] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [showOpenings, setShowOpenings] = useState(openingsOf(room).length > 0)
  const [showParts, setShowParts] = useState((job.roomParts?.length ?? 0) > 0)

  const lib = data.library
  // Library-1: every change made here is one undo step
  const edit = (label: string, fn: (j: Job) => void) => {
    setNotice(null)
    editRoom(job.id, label, fn)
  }
  const undo = (redo = false) => {
    const r = undoRoom(job.id, redo)
    if (!r) return
    setNotice(null)
    toast.success(`${redo ? 'Redone' : 'Undone'}: ${r.label}${r.skipped ? ` (${r.skipped} setting${r.skipped === 1 ? '' : 's'} changed since left as is)` : ''}`)
  }

  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        e.preventDefault()
        setAlt(true)
      }
      // Library-1: Ctrl+Z undoes the last room change, Ctrl+Shift+Z (or Ctrl+Y) redoes it
      if ((e.ctrlKey || e.metaKey) && !typing(e.target) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
        e.preventDefault()
        undo(e.key.toLowerCase() === 'y' || e.shiftKey)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAlt(false)
    }
    const clear = () => setAlt(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id])

  useConfigureTarget(['kitchen'])
  // Library-1: an opening's Configure badge opens its row
  useConfigureTarget(['room'], (t) => {
    if (t.kind !== 'room') return
    setShowOpenings(true)
    if (t.key.startsWith('opening:')) pick({ opening: t.key.slice('opening:'.length) })
  })
  const arranged = useMemo(() => arrangeCabinets(job.cabinets, room, lib), [job.cabinets, room, lib])
  const place = (c: CabinetInstance) => placementOf(c, arranged)

  /**
   * Library-1: a field still being edited in the side panel is applied to what it was typed for before
   * anything else is picked (it used to lose focus after the pick and apply its text to the cabinet
   * picked next). True when there was one: that press then only picks, it starts no drag.
   */
  const applyField = () => {
    const a = document.activeElement
    if (!(a instanceof HTMLElement) || !a.closest('[data-room-panel]') || !(a instanceof HTMLInputElement)) return false
    a.blur()
    return true
  }
  const pick = (p: { cabinet?: string | null; part?: string | null; opening?: string | null }) => {
    applyField()
    setSelected(p.cabinet ?? null)
    setSelPart(p.part ?? null)
    setSelOpening(p.opening ?? null)
    if (p.part) setShowParts(true)
    if (p.opening) setShowOpenings(true)
  }

  const setRoom = (label: string, fn: (r: Room) => void) =>
    edit(label, (j) => {
      j.room = { ...room, ...(j.room ?? {}) }
      fn(j.room)
    })
  const setPlacementNow = (id: string, pl: CabinetPlacement) =>
    setJob((j) => {
      const c = j.cabinets.find((x) => x.id === id)
      if (c) c.placement = pl
    })
  const setPlacement = (label: string, id: string, pl: CabinetPlacement) =>
    edit(label, (j) => {
      const c = j.cabinets.find((x) => x.id === id)
      if (c) c.placement = pl
    })
  const setParams = (label: string, id: string, fn: (p: CarcassParams) => void) =>
    edit(label, (j) => {
      const c = j.cabinets.find((x) => x.id === id)
      if (c) fn(c.params)
    })
  // Polish-1, Kitchen-2: a change of size (or a corner's pull-out) moves the run beside it, round the corner too.
  // Library-1: the back stays on its wall, and the notice says what moved (outlined in the plan and elevations)
  const resize = (label: string, id: string, fn: (p: CarcassParams) => void) => {
    let text = ''
    let ids: string[] = []
    edit(label, (j) => {
      const c = j.cabinets.find((x) => x.id === id)
      if (!c) return
      const r = j.room ?? room
      const laid = arrangeCabinets(j.cabinets, r, lib)
      const before = Object.fromEntries(j.cabinets.map((x) => [x.id, placementOf(x, laid)]))
      const old = { width: c.params.width, depth: c.params.depth, pullOut: c.params.corner?.type === 'blind' ? c.params.corner.pullOut : undefined }
      fn(c.params)
      const moved = pushNeighbours(j.cabinets, c.id, old, r, lib)
      text = describeResize(before, j.cabinets, c.id, old.width, r, units)
      ids = moved
    })
    if (text) setNotice({ text, ids, tone: 'info' })
  }

  const parts = useMemo(() => {
    const all: Part[] = []
    for (const c of job.cabinets) {
      try {
        const built = buildCabinet(c, data.library)
        const pl = place(c)
        for (const p of built.parts) all.push(placedPart(p, pl, c.params.width, c.params.depth, c.id))
      } catch {
        /* a cabinet that cannot build is skipped in the room */
      }
    }
    // Library-1: custom parts placed in the room, plain solids
    all.push(...roomPartSolids(job))
    return all
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, data.library, arranged])

  const sel = job.cabinets.find((c) => c.id === selected) ?? null
  const elev = elevationOf(job.cabinets, room, wall, place, lib)
  // Polish-1: overlaps and cabinets past a wall are always shown, with a way to fix them
  // (Kitchen-2: and blind corner doors the return stands in front of, and runs short of their wall)
  const problems = roomProblems(job.cabinets, room, place, lib, units)
  // Polish-2: a filler past a wall can be shrunk to fit
  const shrinks = fillersPastWall(job.cabinets, room, place, units)
  const gaps = runGaps(job.cabinets, room, place, lib)
  // Polish-4: a second corner cabinet set to a corner already filled (a U-shaped kitchen)
  const hints = cornerHints(job.cabinets)
  // Library-1: cabinets standing in a door, window or opening (a sliding-door unit may, on purpose)
  const inOpenings = openingConflicts(job.cabinets, (c) => planBoxes(c as CabinetInstance, place(c as CabinetInstance)), room)
  const openingsPast = openingsOutside(room)
  const numberOf = (id: string) => job.cabinets.find((c) => c.id === id)?.number ?? '?'
  const rearrange = () =>
    edit('Arrange', (j) => {
      const laid = arrangeCabinets(j.cabinets, j.room ?? room, lib)
      for (const c of j.cabinets) if (laid[c.id]) c.placement = laid[c.id]
    })
  const shrinkFiller = (f: FillerShrink) =>
    edit(`Shrink ${numberOf(f.id)}`, (j) => {
      const c = j.cabinets.find((x) => x.id === f.id)
      if (!c) return
      c.params.width = f.width
      c.placement = f.placement
    })
  const L = (mm: number) => formatLength(mm, units)
  // Kitchen-2, Kitchen-3: what stands in the way of a corner cabinet's doors
  const blockText = (b: RoomBlock) =>
    b.kind === 'opening'
      ? `${numberOf(b.by)} stands ${L(-b.clearance)} into the open corner in front of ${numberOf(b.corner)}: its doors swing there. `
      : b.kind === 'door'
        ? `${numberOf(b.by)} stands ${L(-b.clearance)} proud of ${numberOf(b.corner)}'s door beside it, which cannot open: make their depths match. `
        : `${numberOf(b.by)} stands ${L(-b.clearance)} in front of ${numberOf(b.corner)}'s door: pull the corner cabinet further out or widen its blind part. `
  const fillerFor = (level: RunGap['level']) =>
    lib.templates.find((t) => t.params.panel?.type === 'filler' && (level === 'wall') === (t.params.kind === 'wall'))?.params ??
    lib.templates.find((t) => t.params.panel?.type === 'filler')?.params ??
    KITCHEN_PRESETS.find((t) => t.params.panel?.type === 'filler' && (level === 'wall') === (t.params.kind === 'wall'))!.params
  const fill = (g: RunGap, mode: 'one' | 'split') =>
    edit(mode === 'one' ? 'Fill gap' : 'Split gap', (j) => {
      const r = j.room ?? room
      const laid = arrangeCabinets(j.cabinets, r, lib)
      fillGap(j, g, mode, fillerFor(g.level), r, (c) => placementOf(c, laid), () => `cab-${nanoid(8)}`)
    })
  const wallName = { back: 'back wall', left: 'left wall', right: 'right wall' }
  const openingById = (id?: string) => openingsOf(room).find((o) => o.id === id)
  // Library-1: what a run is short of: its wall, its corner, or a door, window or opening
  const shortOf = (g: RunGap) => {
    const o = openingById(g.endOpening) ?? openingById(g.startOpening)
    if (o) return openingName(o)
    return g.endIsWall && g.startIsWall ? 'the wall' : 'its corner and wall'
  }

  const targets = (id: string): SnapTarget[] => [
    ...job.cabinets.filter((o) => o.id !== id).map((o) => ({ ...footprint(o.params.width, o.params.depth, place(o)), z: place(o).z, h: o.params.height })),
    // Library-1: a cabinet snaps to the edges of the walls' openings too
    ...openingsOf(room).flatMap((o) => {
      const [lo, hi] = openingRoomSpan(o, room)
      return o.wall === 'back' || o.wall === 'front'
        ? [lo, hi].map((x) => ({ x, y: o.wall === 'back' ? room.depth : 0, w: 0, d: 0 }))
        : [lo, hi].map((y) => ({ x: o.wall === 'left' ? 0 : room.width, y, w: 0, d: 0 }))
    }),
  ]

  const snapTo = (c: CabinetInstance, pl: CabinetPlacement, enabled: boolean) =>
    snapPlacement(pl, c.params.width, c.params.depth, targets(c.id), room, 12.7, { enabled, height: c.params.height })

  const svgPoint = (e: PointerEvent<SVGElement>) => {
    const svg = e.currentTarget.ownerSVGElement ?? (e.currentTarget as SVGSVGElement)
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const m = svg.getScreenCTM()
    if (!m) return null
    return { svg, p: pt.matrixTransform(m.inverse()) }
  }

  // the notice stays up while a drag starts (taking it away would move the drawing under the pointer,
  // which the drag would read as a move); it goes once the drag has moved something
  const startDrag = (label: string) => {
    dragBefore.current = { snap: roomSnapshot(job, DEFAULT_ROOM), label }
  }
  const endDrag = () => {
    setDrag(null)
    const b = dragBefore.current
    dragBefore.current = null
    // Library-1: a drag is one undo step, however many moves it made
    if (b && recordRoom(job.id, b.label, b.snap)) setNotice(null)
  }

  const onPlan = (e: PointerEvent<SVGElement>, phase: 'down' | 'move' | 'up', id?: string) => {
    const hit = svgPoint(e)
    if (!hit) return
    const rx = hit.p.x
    const ry = room.depth - hit.p.y
    if (phase === 'down' && id) {
      const c = job.cabinets.find((x) => x.id === id)
      if (!c) return
      const pl = place(c)
      if (applyField()) return pick({ cabinet: id })
      pick({ cabinet: id })
      startDrag(`Move ${c.number}`)
      setDrag({ id, dx: rx - pl.x, dy: ry - pl.y, mode: 'plan' })
      hit.svg.setPointerCapture(e.pointerId)
    } else if (phase === 'move' && drag?.mode === 'plan') {
      const c = job.cabinets.find((x) => x.id === drag.id)
      if (!c) return
      setPlacementNow(c.id, snapTo(c, { ...place(c), x: rx - drag.dx, y: ry - drag.dy }, snapOn && !e.altKey && !alt))
    } else if (phase === 'move' && drag?.mode === 'part') {
      // Library-1: a placed custom part (with its group) dragged in the plan
      const rp = job.roomParts?.find((r) => r.id === drag.id)
      if (!rp) return
      const dx = rx - drag.dx - rp.x
      const dy = ry - drag.dy - rp.y
      setJob((j) => moveGroup(groupOf(j, drag.id), dx, dy, 0))
    } else if (phase === 'up') endDrag()
  }

  const onPlanPart = (e: PointerEvent<SVGElement>, id: string) => {
    const hit = svgPoint(e)
    const rp = job.roomParts?.find((r) => r.id === id)
    if (!hit || !rp) return
    if (applyField()) return pick({ part: id })
    pick({ part: id })
    startDrag('Move a custom part')
    setDrag({ id, dx: hit.p.x - rp.x, dy: room.depth - hit.p.y - rp.y, mode: 'part' })
    hit.svg.setPointerCapture(e.pointerId)
  }

  const onElev = (e: PointerEvent<SVGElement>, phase: 'down' | 'move' | 'up', id?: string) => {
    const hit = svgPoint(e)
    if (!hit) return
    const along = hit.p.x
    const z = room.height - hit.p.y
    if (phase === 'down' && id) {
      const c = job.cabinets.find((x) => x.id === id)
      if (!c) return
      const item = elev.find((x) => x.id === id)
      if (!item) return
      if (applyField()) return pick({ cabinet: id })
      pick({ cabinet: id })
      startDrag(`Move ${c.number}`)
      setDrag({ id, dx: along - item.x, dy: z - place(c).z, mode: 'elevation' })
      hit.svg.setPointerCapture(e.pointerId)
    } else if (phase === 'move' && drag?.mode === 'elevation') {
      const c = job.cabinets.find((x) => x.id === drag.id)
      // a corner cabinet seen end on from a side wall (or a pie-cut seen from its side wall) is moved from the back wall or the plan
      const item = elev.find((x) => x.id === drag.id)
      if (!c || item?.endView || item?.secondWall) return
      const raw = placementFromElevation(place(c), c.params.width, c.params.depth, wall, along - drag.dx, z - drag.dy, room)
      setPlacementNow(c.id, snapTo(c, raw, snapOn && !e.altKey && !alt))
    } else if (phase === 'up') endDrag()
  }

  const rotate = (c: CabinetInstance) => {
    const pl = place(c)
    setPlacement(`Rotate ${c.number}`, c.id, turnedTo(c, pl, nextRotation(pl.rotation)))
  }

  // Library-1: a copy goes beside the original on its wall, in the first free space, and is selected
  const copy = (c: CabinetInstance) => {
    let res: ReturnType<typeof copyCabinet> = null
    edit(`Copy ${c.number}`, (j) => (res = copyCabinet(j, c.id, j.room ?? room, lib, () => `cab-${nanoid(8)}`)))
    const r = res as ReturnType<typeof copyCabinet>
    if (!r) return
    pick({ cabinet: r.id })
    if (r.how === 'offset') setNotice({ text: `No free space beside ${c.number} on its wall: the copy is set in front of it, overlapping it. Move it where it goes (drag it, or type its X and Y).`, ids: [r.id], tone: 'warn' })
  }

  // Library-1: the room's openings in the 3D view, see-through boxes just outside their walls
  const openingBoxes = openingsOf(room).map((o) => {
    const b = openingBox(o, room)
    return { key: `op:${o.id}`, min: [b.x, b.y, b.z0] as [number, number, number], max: [b.x + b.w, b.y + b.d, b.z1] as [number, number, number], color: o.kind === 'window' ? '#38bdf8' : o.kind === 'door' ? '#a16207' : '#78716c', opacity: 0.35 }
  })
  const along = (p: [number, number, number]) => alongPoint(wall, p, room)
  const extras: RoomExtras = {
    openings: openingsOf(room),
    shapes: view === 'plan' ? planShapes(job) : elevationShapes(job, along, wall === 'back' || wall === 'front' ? 'y' : 'x'),
    moved: notice?.ids ?? [],
    selectedOpening: selOpening,
    selectedPart: selPart,
    onDownOpening: (e, id) => {
      e.stopPropagation()
      pick({ opening: id })
    },
    onDownPart: (e, id) => {
      e.stopPropagation()
      if (view === 'plan') onPlanPart(e, id)
      else pick({ part: id })
    },
  }
  const selected3d = selected ? parts.find((p) => p.key.startsWith(selected + ':'))?.key : selPart ? `rp:${selPart}` : selOpening ? `op:${selOpening}` : null
  const hasProblems = problems.overlaps.length > 0 || problems.outside.length > 0 || problems.blocked.length > 0 || inOpenings.some((x) => !x.intended) || openingsPast.length > 0

  return (
    <div className="flex h-full min-h-0 flex-col xl:flex-row">
      <div className="flex min-h-[420px] min-w-0 flex-1 flex-col border-b xl:border-r xl:border-b-0">
        <div className="flex flex-wrap items-center gap-3 border-b bg-background px-4 py-3">
          <div className="flex rounded-md border bg-stone-100 p-0.5">
            {(['3d', 'plan', 'elevation'] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn('rounded px-2.5 py-1 text-xs', view === v ? 'bg-stone-800 font-medium text-white' : 'text-stone-600')}>
                {v === '3d' ? '3D' : v === 'plan' ? 'Plan' : 'Elevation'}
              </button>
            ))}
          </div>
          {view === 'elevation' && (
            <div className="flex rounded-md border bg-stone-100 p-0.5">
              {WALLS.map((w) => (
                <button key={w.id} type="button" aria-pressed={wall === w.id} onClick={() => setWall(w.id)} className={cn('rounded px-2 py-1 text-xs', wall === w.id ? 'bg-white font-medium text-stone-900 shadow-sm' : 'text-stone-600')}>
                  {w.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Switch id="snap" checked={snapOn} onCheckedChange={(v) => setSnapOn(v === true)} />
            <Label htmlFor="snap" className="text-xs">Snap</Label>
            <span className="text-[11px] text-muted-foreground">{!snapOn ? 'Off — cabinets can overlap' : alt ? 'Paused — Alt is held' : 'On — hold Alt to place freely'}</span>
          </div>
          {/* Library-1: undo and redo of the room's changes */}
          <div className="flex items-center gap-1">
            <Button size="xs" variant="outline" disabled={!undoStep} onClick={() => undo()} title={undoStep ? `Undo: ${undoStep.label} (Ctrl+Z)` : 'Nothing to undo'} data-testid="room-undo">
              <Undo2 /> Undo
            </Button>
            <Button size="xs" variant="outline" disabled={!redoStep} onClick={() => undo(true)} title={redoStep ? `Redo: ${redoStep.label} (Ctrl+Shift+Z)` : 'Nothing to redo'} data-testid="room-redo">
              <Redo2 /> Redo
            </Button>
          </div>
          <NumField label="Room width" value={room.width} min={600} max={12000} onChange={(v) => setRoom('Room width', (r) => (r.width = v))} />
          <NumField label="Room depth" value={room.depth} min={600} max={12000} onChange={(v) => setRoom('Room depth', (r) => (r.depth = v))} />
          <NumField label="Wall height" value={room.height} min={1800} max={4000} onChange={(v) => setRoom('Wall height', (r) => (r.height = v))} />
          <Button size="sm" variant="outline" onClick={rearrange}>
            Arrange along the back wall
          </Button>
        </div>
        {hasProblems && (
          <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
            <span>
              {problems.overlaps.length > 0 && `${problems.overlaps.map(([a, b]) => `${numberOf(a)} and ${numberOf(b)}`).join(', ')} overlap. `}
              {problems.outside.length > 0 && `${problems.outside.map(numberOf).join(', ')} ${problems.outside.length === 1 ? 'runs' : 'run'} past a wall. `}
              {problems.blocked.map(blockText).join('')}
              {/* Library-1: a cabinet in a door, window or opening; an opening past its wall */}
              {inOpenings.some((x) => !x.intended) && `${openingConflictText(inOpenings, room, numberOf, units)} `}
              {openingsPast.length > 0 && `${openingsPast.map((id) => openingName(openingById(id)!)).join(', ')} ${openingsPast.length === 1 ? 'runs' : 'run'} past its wall's end or the ceiling. `}
              Move them, or re-arrange the room.
            </span>
            <Button size="xs" variant="outline" onClick={rearrange}>
              Re-arrange along the back wall
            </Button>
            {/* Polish-2: a filler cut for a wider wall (or typed too wide) can be shrunk to fit */}
            {shrinks.map((f) => (
              <Button key={f.id} size="xs" variant="outline" onClick={() => shrinkFiller(f)}>
                Shrink {numberOf(f.id)} to {L(f.width)} to fit
              </Button>
            ))}
          </div>
        )}
        {inOpenings.some((x) => x.intended) && (
          <div role="status" className="border-b border-sky-200 bg-sky-50 px-4 py-1.5 text-xs text-sky-900" data-testid="room-sliding-note">
            {intendedText(inOpenings, room, numberOf)}
          </div>
        )}
        {notice && (
          <div role="status" className={cn('flex items-start gap-2 border-b px-4 py-2 text-xs', notice.tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-sky-200 bg-sky-50 text-sky-900')} data-testid="room-notice">
            <span className="flex-1">
              {notice.text} {notice.tone === 'info' && notice.ids.length > 0 && <span className="text-sky-700">Outlined in the plan and elevations.</span>}
            </span>
            {undoStep && (
              <Button size="xs" variant="outline" onClick={() => undo()}>
                <Undo2 /> Undo
              </Button>
            )}
            <Button size="icon-xs" variant="ghost" aria-label="Close" onClick={() => setNotice(null)}>
              <X />
            </Button>
          </div>
        )}
        {gaps.length > 0 && (
          <div role="status" className="flex flex-col gap-1 border-b border-sky-200 bg-sky-50 px-4 py-2 text-xs text-sky-900">
            {gaps.map((g) => (
              <div key={`${g.wall}-${g.level}-${Math.round(g.startBound)}`} className="flex flex-wrap items-center gap-2">
                <span>
                  The {g.level === 'wall' ? 'wall-cabinet' : 'base'} run on the {wallName[g.wall]} ({g.ids.map(numberOf).join(', ')}) is {L(g.total)} short of {shortOf(g)}.
                </span>
                <Button size="xs" variant="outline" onClick={() => fill(g, 'one')}>
                  Fill gap: one filler {L(g.total)}
                </Button>
                <Button size="xs" variant="outline" onClick={() => fill(g, 'split')}>
                  Split: {L(g.total / 2)} at each end
                </Button>
              </div>
            ))}
          </div>
        )}
        {hints.length > 0 && (
          <div role="status" className="flex flex-col gap-1 border-b border-sky-200 bg-sky-50 px-4 py-2 text-xs text-sky-900">
            {hints.map((h) => (
              <div key={h.id} className="flex flex-wrap items-center gap-2">
                <span>{cornerHintText(h, numberOf)}</span>
                <Button size="xs" variant="outline" onClick={() => go({ page: 'cabinet', jobId: job.id, cabinetId: h.id, from: 'room' })}>
                  Edit {numberOf(h.id)}
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="relative min-h-0 flex-1 bg-[#f3f1ec]">
          {job.cabinets.length === 0 && !(job.roomParts?.length) ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Add cabinets, then arrange them in the room.</div>
          ) : view === '3d' ? (
            <Viewer3D
              parts={parts}
              library={data.library}
              width={room.width}
              height={room.height}
              depth={room.depth}
              frame={{ width: room.width, depth: room.depth, height: room.height }}
              selected={selected3d}
              boxes={openingBoxes}
              onSelect={(key) => {
                if (!key) return pick({})
                if (key.startsWith('rp:')) return pick({ part: key.slice(3) })
                if (key.startsWith('op:')) return pick({ opening: key.slice(3) })
                pick({ cabinet: key.split(':')[0]! })
              }}
              showOps
            />
          ) : view === 'plan' ? (
            <PlanView room={room} cabinets={job.cabinets} place={place} selected={selected} units={units} onDown={(e, id) => onPlan(e, 'down', id)} onMove={(e) => drag && onPlan(e, 'move')} onUp={(e) => onPlan(e, 'up')} extras={extras} />
          ) : (
            <ElevationView room={room} wall={wall} items={elev} selected={selected} units={units} onDown={(e, id) => onElev(e, 'down', id)} onMove={(e) => drag && onElev(e, 'move')} onUp={(e) => onElev(e, 'up')} extras={extras} />
          )}
        </div>
      </div>
      <aside className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto bg-background p-4 xl:w-[380px]" data-room-panel>
        <p className="text-xs text-muted-foreground">
          {view === 'plan' && 'Plan, looking down. The back wall is at the top. The thick edge is the front, with a tick between doors.'}
          {view === 'elevation' && `Elevation of the ${WALLS.find((w) => w.id === wall)?.label.toLowerCase()}, looking straight at it. Doors and drawer fronts show when the cabinet faces you.`}
          {view === '3d' && 'Click a cabinet to edit it here. The room rebuilds as you change it.'}
        </p>
        {sel ? (
          // keyed by the cabinet: its fields start afresh for each one picked
          <div key={sel.id} className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="mr-2 rounded bg-stone-800 px-1.5 py-0.5 font-mono text-[11px] text-white">{sel.number}</span>
                <span className="text-sm">{sel.name}</span>
              </div>
              <div className="flex gap-1">
                <Button size="xs" variant="outline" onClick={() => rotate(sel)}>
                  <RotateCw /> Rotate
                </Button>
                <Button size="xs" variant="outline" onClick={() => copy(sel)} title="A copy beside it on its wall, in the first free space">
                  <Copy /> Copy
                </Button>
                <Button size="xs" onClick={() => go({ page: 'cabinet', jobId: job.id, cabinetId: sel.id, from: 'room' })}>
                  Edit
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {kindLabel(sel.params) && <span className="mr-1 font-medium text-stone-700">{kindLabel(sel.params)} ·</span>}
              {formatLength(sel.params.width, units)} × {formatLength(sel.params.height, units)} × {formatLength(sel.params.depth, units)}
            </p>
            {sel.params.panel?.type !== 'end-panel' && sel.params.corner?.type !== 'pie-cut' && (
              // Polish-1: neighbours along the run move with it, so nothing overlaps (Library-1: and the notice says which)
              <NumField label="Width" value={sel.params.width} min={sel.params.panel ? 3 : 100} max={2400} onChange={(v) => resize(`Width of ${sel.number}`, sel.id, (p) => (p.width = v))} />
            )}
            <NumField label="Height" value={sel.params.height} min={200} max={2800} onChange={(v) => setParams(`Height of ${sel.number}`, sel.id, (p) => (p.height = v))} />
            {/* Kitchen-3: a pie-cut's two legs are set with its corner fields below (they move the runs beside it) */}
            {sel.params.corner?.type !== 'pie-cut' && <NumField label="Depth" value={sel.params.depth} min={100} max={900} onChange={(v) => resize(`Depth of ${sel.number}`, sel.id, (p) => (p.depth = v))} />}
            {(sel.params.panel || sel.params.corner) && <KitchenFields p={sel.params} set={(fn) => resize(`${sel.number} corner and panel settings`, sel.id, fn)} lib={lib} />}
            {sel.params.corner?.type === 'pie-cut' &&
              (() => {
                const pc = pieClearance(job.cabinets, sel.id, place, lib)
                const line = (name: string, v: { id: string; clearance: number } | null | undefined) =>
                  v ? (
                    <p key={name} className={cn('text-xs', v.clearance < -0.5 ? 'text-red-700' : 'text-muted-foreground')}>
                      {v.clearance < -0.5 ? `${numberOf(v.id)} stands ${L(-v.clearance)} proud of the ${name} door.` : `The ${name} door: ${numberOf(v.id)}'s front is ${L(v.clearance)} behind its face.`}
                    </p>
                  ) : null
                return pc ? [line('back-wall', pc.back), line('side-wall', pc.side)] : null
              })()}
            {sel.params.corner?.type === 'blind' &&
              (() => {
                const cl = cornerClearance(job.cabinets, sel.id, room, place, lib)
                return cl ? (
                  <p className={cn('text-xs', cl.clearance < 0 ? 'text-red-700' : 'text-muted-foreground')}>
                    {cl.clearance < 0 ? `${numberOf(cl.id)} stands ${L(-cl.clearance)} in front of this door.` : `${L(cl.clearance)} between this door and ${numberOf(cl.id)}'s front.`}
                  </p>
                ) : null
              })()}
            {!sel.params.panel && !sel.params.corner && (
              <>
                <SelectField
                  label="Doors"
                  value={String(sel.params.doors.count) as '0' | '1' | '2'}
                  options={[
                    { value: '0', label: 'None' },
                    { value: '1', label: '1 door' },
                    { value: '2', label: '2 doors' },
                  ]}
                  onChange={(v) => setParams(`Doors of ${sel.number}`, sel.id, (p) => (p.doors.count = Number(v) as 0 | 1 | 2))}
                />
                <NumField label="Drawers" suffix="" value={sel.params.drawers?.count ?? 0} min={0} max={6} onChange={(v) => setParams(`Drawers of ${sel.number}`, sel.id, (p) => (p.drawers.count = Math.round(v)))} />
              </>
            )}
            {/* Library-1: the typed value as it is (snapping a typed 1/2" to the floor is what saved z = 0) */}
            <NumField label="Height off the floor" value={place(sel).z} min={0} max={room.height} onChange={(v) => setPlacement(`Height off the floor of ${sel.number}`, sel.id, { ...place(sel), z: v })} />
            {/* Library-1: typed position, the turn, and back to the wall */}
            <div className="flex flex-col gap-2 rounded-md border p-2" data-testid="room-position">
              <div className="text-xs font-medium">Position in the room</div>
              <div className="grid grid-cols-2 gap-2">
                <NumField label="X from the left wall" hint="To its left-most edge in the plan." value={place(sel).x} min={-room.width} max={2 * room.width} onChange={(v) => setPlacement(`Move ${sel.number}`, sel.id, { ...place(sel), x: v })} />
                <NumField label="Y from the front wall" hint="To its edge nearest the front wall." value={place(sel).y} min={-room.depth} max={2 * room.depth} onChange={(v) => setPlacement(`Move ${sel.number}`, sel.id, { ...place(sel), y: v })} />
              </div>
              <SelectField label="Turn" value={String(place(sel).rotation) as '0'} options={ROTATIONS} onChange={(v) => setPlacement(`Turn ${sel.number}`, sel.id, turnedTo(sel, place(sel), Number(v) as CabinetPlacement['rotation']))} />
              {(() => {
                const pl = place(sel)
                const back = snapBackToWall(sel, pl, room)
                const there = Math.abs(back.x - pl.x) < 0.01 && Math.abs(back.y - pl.y) < 0.01
                return (
                  <Button size="xs" variant="outline" disabled={there} onClick={() => setPlacement(`Snap ${sel.number} back to the wall`, sel.id, back)} data-testid="snap-back">
                    {there ? `Its back is on the ${wallBehind(pl.rotation)} wall` : `Snap back to the ${wallBehind(pl.rotation)} wall`}
                  </Button>
                )
              })()}
            </div>
            <div className="flex items-start justify-between gap-3 rounded-md py-1">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="sliding" className="text-sm">Sliding-door unit</Label>
                <p className="text-[11px] leading-snug text-muted-foreground">A unit on a track that slides across a door or opening on purpose (a bookcase door): the room notes it instead of warning. Room only; it changes no part.</p>
              </div>
              <Switch id="sliding" checked={sel.slidingDoor === true} onCheckedChange={(v) => edit(`${v ? 'Mark' : 'Unmark'} ${sel.number} as a sliding-door unit`, (j) => { const c = j.cabinets.find((x) => x.id === sel.id); if (!c) return; if (v) c.slidingDoor = true; else delete c.slidingDoor })} />
            </div>
          </div>
        ) : !selPart && !selOpening ? (
          <p className="text-sm text-muted-foreground">Click a cabinet in the 3D view, the plan, or an elevation to edit it.</p>
        ) : null}
        {/* Library-1: the room's doors, windows and openings, and custom parts placed in it */}
        <section className="border-t pt-2">
          <button type="button" className="flex w-full items-center gap-1 text-left text-xs font-semibold" onClick={() => setShowOpenings((v) => !v)} aria-expanded={showOpenings}>
            {showOpenings ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />} Doors, windows and openings ({openingsOf(room).length})
          </button>
          {showOpenings && (
            <div className="mt-2">
              <OpeningsPanel room={room} units={units} selected={selOpening} onSelect={(id) => pick({ opening: id })} edit={edit} />
            </div>
          )}
        </section>
        <section className="border-t pt-2">
          <button type="button" className="flex w-full items-center gap-1 text-left text-xs font-semibold" onClick={() => setShowParts((v) => !v)} aria-expanded={showParts}>
            {showParts ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />} Custom parts in the room ({job.roomParts?.length ?? 0})
          </button>
          {showParts && (
            <div className="mt-2">
              <RoomPartsPanel job={job} room={room} units={units} selected={selPart} onSelect={(id) => pick({ part: id })} edit={edit} />
            </div>
          )}
        </section>
      </aside>
    </div>
  )
}
