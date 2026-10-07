import { modelFootprint } from '@/cam/mesh/place'
import { planeRect } from '@/cam/rotary/frame'
import { tiltedRect } from '@/cam/positional/frame'
import { fixtureFootprint, shapeHeight } from '@/cam/fixtures/fixture'
import { formatLength } from '@/core/units'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { moveNode, nodesOf } from '@/cam/cad'
import { entityContours, layerOf } from '@/cam/doc'
import { boxOf, closestOnContour, type Contour, dist, pointAt, type P, polyline, rect, tangentAt } from '@/cam/geom'
import { snap, type SnapMode, type SnapResult } from '@/cam/snap'
import type { Toolpath } from '@/cam/toolpath'
import type { CamPart, Entity } from '@/cam/types'
import { cn } from '@/lib/utils'
import { useStore } from '@/app/store'
import { dimText, measureDim } from '@/cam/dims'
import { annotationLines, screenDash } from '@/cam/annotate'
import { contourPath, entitiesInBox, hitEntity } from './hit'
import { useDisplayPaths } from './displayPaths'
import type { DisplayPaths } from '@/cam/display'
import type { Click, ToolDef } from './tools'

export interface Display {
  paths: boolean
  arrows: boolean
  grid: boolean
  snapOn: boolean
  ortho: boolean
  modes: Set<SnapMode>
  gridSize: number
}

interface View {
  cx: number
  cy: number
  s: number
}

/**
 * Saw cuts seen from above: the cut's footprint at the surface (run-outs included, kerf wide) and
 * the blade (as long as its diameter, kerf thick) where it stands at each end of the full-depth run.
 */
function SawBlades({ saw }: { saw: NonNullable<Toolpath['saw']> }) {
  const band = (a: P, b: P, w: number) => {
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const n = { x: (-(b.y - a.y) / L) * (w / 2), y: ((b.x - a.x) / L) * (w / 2) }
    return `M${a.x + n.x} ${a.y + n.y}L${b.x + n.x} ${b.y + n.y}L${b.x - n.x} ${b.y - n.y}L${a.x - n.x} ${a.y - n.y}Z`
  }
  return (
    <g pointerEvents="none">
      {saw.cuts.map((c, i) => {
        const L = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y) || Math.hypot(c.surf[1].x - c.surf[0].x, c.surf[1].y - c.surf[0].y) || 1
        const u = { x: (c.surf[1].x - c.surf[0].x) / (Math.hypot(c.surf[1].x - c.surf[0].x, c.surf[1].y - c.surf[0].y) || 1), y: (c.surf[1].y - c.surf[0].y) / (Math.hypot(c.surf[1].x - c.surf[0].x, c.surf[1].y - c.surf[0].y) || 1) }
        const blade = (p: P) => band({ x: p.x - u.x * saw.r, y: p.y - u.y * saw.r }, { x: p.x + u.x * saw.r, y: p.y + u.y * saw.r }, saw.kerf)
        return (
          <g key={i}>
            <path d={band(c.surf[0], c.surf[1], saw.kerf)} fill="#f59e0b" fillOpacity={0.35} stroke="#f59e0b" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <path d={blade(c.a)} fill="none" stroke="#fde68a" strokeDasharray="4 3" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            {L > 1e-6 && <path d={blade(c.b)} fill="none" stroke="#fde68a" strokeDasharray="4 3" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
          </g>
        )
      })}
    </g>
  )
}

function arrowsFor(c: Contour): { p: P; a: number }[] {
  const out: { p: P; a: number }[] = []
  const n = Math.min(c.segs.length, 12)
  for (let i = 0; i < n; i++) {
    const s = c.segs[Math.floor((i * c.segs.length) / n)]
    const t = tangentAt(s, 0.5)
    out.push({ p: pointAt(s, 0.5), a: (Math.atan2(t.y, t.x) * 180) / Math.PI })
  }
  return out
}

export interface CanvasProps {
  part: CamPart
  sel: string[]
  toolpaths: Toolpath[]
  hiddenOps: Set<string>
  display: Display
  tool: ToolDef
  clicks: Click[]
  preview: Contour[]
  nodeSeg: { id: string; seg: number } | null
  fitKey: number
  onCursor: (s: SnapResult) => void
  onClick: (c: Click, shift: boolean) => void
  onFinish: () => void
  onSelect: (ids: string[], additive: boolean) => void
  onNodeMove: (id: string, idx: number, p: P) => void
  onSegPick: (id: string, seg: number) => void
  /** M3.6: a fixture dragged on the drawing to a new place (its reference point). */
  onFixtureMove?: (id: string, at: P) => void
}

/** A toolpath drawn with more points than this shows its centre line only (not the tool's width). */
const BAND_POINTS = 20_000

export function PartCanvas(props: CanvasProps) {
  const { part, sel, toolpaths, display, tool, clicks, preview } = props
  // (built once per toolpath, simplified for the screen; large ones in the background)
  const drawings = useDisplayPaths(toolpaths)
  const host = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [view, setView] = useState<View>({ cx: part.length / 2, cy: part.width / 2, s: 1 })
  const [cursor, setCursor] = useState<SnapResult | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [boxSel, setBoxSel] = useState<{ a: P; b: P } | null>(null)
  const [drag, setDrag] = useState<{ id: string; idx: number; p: P } | null>(null)
  // M3.6: a fixture being dragged: where the pointer went down and where it is now
  const [fxDrag, setFxDrag] = useState<{ id: string; from: P; to: P } | null>(null)
  const pan = useRef<{ x: number; y: number; view: View; moved: boolean; button: number } | null>(null)
  const space = useRef(false)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const fit = useCallback(() => {
    const cs = part.entities.filter((e) => e.face === 1).flatMap(entityContours)
    // (clamps and pods round the part too, M3.6)
    const fx = (part.fixtures ?? []).flatMap(fixtureFootprint).filter((l) => l.length > 2).map((l) => polyline(l.map(([x, y]) => ({ x, y })), true))
    const b = boxOf([...cs, ...fx, rect(0, 0, part.length, part.width)])
    const w = Math.max(1, b.maxX - b.minX)
    const h = Math.max(1, b.maxY - b.minY)
    const s = Math.min((size.w - 80) / w, (size.h - 80) / h)
    setView({ cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, s: Math.max(0.01, s) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h, part.id, part.length, part.width, (part.fixtures ?? []).length])

  useEffect(() => fit(), [fit, props.fitKey])

  useEffect(() => {
    const down = (e: KeyboardEvent) => e.code === 'Space' && (space.current = true)
    const up = (e: KeyboardEvent) => e.code === 'Space' && (space.current = false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const toWorld = (sx: number, sy: number): P => ({ x: (sx - size.w / 2) / view.s + view.cx, y: -(sy - size.h / 2) / view.s + view.cy })
  const local = (e: { clientX: number; clientY: number }) => {
    const r = host.current!.getBoundingClientRect()
    return { sx: e.clientX - r.left, sy: e.clientY - r.top }
  }
  const tol = 9 / view.s

  const snapContours = useMemo(
    () =>
      part.entities
        .filter((e) => e.face === 1 && layerOf(part, e.layer)?.visible !== false)
        .flatMap(entityContours),
    [part],
  )
  const snapPoints = useMemo(() => part.entities.flatMap((e) => (e.g.t === 'point' ? [e.g.p] : [])), [part])

  const snapAt = (w: P): SnapResult => {
    const drawing = tool.group === 'draw' || tool.id === 'measure' || ((tool.group === 'change' || tool.group === 'area' || tool.group === 'dims') && !tool.pick?.includes(clicks.length))
    if (!drawing) return { p: w, kind: 'free', guides: [] }
    return snap(
      {
        contours: snapContours,
        points: [...snapPoints, ...clicks.map((c) => c.p), { x: 0, y: 0 }, { x: part.length, y: 0 }, { x: part.length, y: part.width }, { x: 0, y: part.width }],
        modes: display.modes,
        tol,
        grid: display.gridSize,
        ortho: display.ortho,
        last: clicks[clicks.length - 1]?.p,
        enabled: display.snapOn,
      },
      w,
    )
  }

  const nodeHit = (w: P) => {
    if (tool.id !== 'nodes') return null
    for (const id of sel) {
      const e = part.entities.find((x) => x.id === id)
      if (!e) continue
      const ns = nodesOf(e)
      for (let i = 0; i < ns.length; i++) if (dist(ns[i], w) <= tol) return { id, idx: i }
    }
    return null
  }

  const onWheel = (e: React.WheelEvent) => {
    const { sx, sy } = local(e)
    const before = toWorld(sx, sy)
    const k = Math.exp(-e.deltaY * 0.0015)
    const s = Math.min(200, Math.max(0.01, view.s * k))
    setView({ s, cx: before.x - (sx - size.w / 2) / s, cy: before.y + (sy - size.h / 2) / s })
  }

  const onDown = (e: RPointerEvent) => {
    host.current?.focus()
    const { sx, sy } = local(e)
    const w = toWorld(sx, sy)
    if (e.button === 1 || e.button === 2 || space.current) {
      pan.current = { x: sx, y: sy, view, moved: false, button: e.button }
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      return
    }
    if (e.button !== 0) return
    if (tool.id === 'select' || tool.id === 'nodes') {
      const n = nodeHit(w)
      if (n) {
        setDrag({ ...n, p: w })
        ;(e.target as Element).setPointerCapture?.(e.pointerId)
        return
      }
      const h = hitEntity(part, w, tol)
      // a fixture under the pointer (no shape there): drag it
      const fx = !h && tool.id === 'select' && props.onFixtureMove ? fixtureAt(part, w) : null
      if (fx) {
        setFxDrag({ id: fx, from: w, to: w })
        ;(e.target as Element).setPointerCapture?.(e.pointerId)
        return
      }
      if (h) {
        if (tool.id === 'nodes' && sel.includes(h)) {
          const ent = part.entities.find((x) => x.id === h)!
          if (ent.g.t === 'contour') props.onSegPick(h, closestOnContour(ent.g.c, w).seg)
          return
        }
        props.onSelect([h], e.shiftKey || e.ctrlKey || e.metaKey)
        return
      }
      setBoxSel({ a: w, b: w })
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      return
    }
    const s = snapAt(w)
    props.onClick({ p: s.p, hit: hitEntity(part, w, tol) }, e.shiftKey)
  }

  const onMove = (e: RPointerEvent) => {
    const { sx, sy } = local(e)
    if (pan.current) {
      const dx = sx - pan.current.x
      const dy = sy - pan.current.y
      if (Math.abs(dx) + Math.abs(dy) > 3) pan.current.moved = true
      setView({ ...pan.current.view, cx: pan.current.view.cx - dx / view.s, cy: pan.current.view.cy + dy / view.s })
      return
    }
    const w = toWorld(sx, sy)
    if (drag) {
      const s = snap({ contours: snapContours, points: snapPoints, modes: display.modes, tol, grid: display.gridSize, ortho: false, enabled: display.snapOn }, w)
      setDrag({ ...drag, p: s.p })
      return
    }
    if (fxDrag) {
      setFxDrag({ ...fxDrag, to: w })
      return
    }
    if (boxSel) {
      setBoxSel({ ...boxSel, b: w })
      return
    }
    const s = snapAt(w)
    setCursor(s)
    props.onCursor(s)
    setHover(tool.id === 'select' || tool.id === 'nodes' || tool.pick?.includes(clicks.length) ? hitEntity(part, w, tol) : null)
  }

  const onUp = (e: RPointerEvent) => {
    if (pan.current) {
      const p = pan.current
      pan.current = null
      if (p.button === 2 && !p.moved) props.onFinish()
      return
    }
    if (drag) {
      props.onNodeMove(drag.id, drag.idx, drag.p)
      setDrag(null)
      return
    }
    if (fxDrag) {
      const f = part.fixtures?.find((x) => x.id === fxDrag.id)
      // (moved to the nearest 0.1 mm; a click without moving leaves it)
      if (f && dist(fxDrag.from, fxDrag.to) * view.s >= 2) props.onFixtureMove?.(f.id, { x: Math.round((f.at.x + fxDrag.to.x - fxDrag.from.x) * 10) / 10, y: Math.round((f.at.y + fxDrag.to.y - fxDrag.from.y) * 10) / 10 })
      setFxDrag(null)
      return
    }
    if (boxSel) {
      const tiny = dist(boxSel.a, boxSel.b) * view.s < 4
      if (tiny) props.onSelect([], e.shiftKey)
      else props.onSelect(entitiesInBox(part, boxSel.a, boxSel.b, boxSel.b.x < boxSel.a.x), e.shiftKey || e.ctrlKey || e.metaKey)
      setBoxSel(null)
    }
  }

  const moved = drag ? moveNode(part, drag.id, drag.idx, drag.p) : part
  const shown = fxDrag ? { ...moved, fixtures: moved.fixtures?.map((f) => (f.id === fxDrag.id ? { ...f, at: { ...f.at, x: f.at.x + fxDrag.to.x - fxDrag.from.x, y: f.at.y + fxDrag.to.y - fxDrag.from.y } } : f)) } : moved
  const tx = size.w / 2 - view.cx * view.s
  const ty = size.h / 2 + view.cy * view.s
  const worldTf = `matrix(${view.s},0,0,${-view.s},${tx},${ty})`
  const px = (p: P) => ({ x: p.x * view.s + tx, y: -p.y * view.s + ty })

  const grid = useMemo(() => {
    if (!display.grid) return null
    let g = display.gridSize > 0 ? display.gridSize : 10
    while (g * view.s < 8) g *= 5
    const x0 = Math.floor(toWorld(0, 0).x / g) * g
    const x1 = toWorld(size.w, 0).x
    const y0 = Math.floor(toWorld(0, size.h).y / g) * g
    const y1 = toWorld(0, 0).y
    const minor: string[] = []
    const major: string[] = []
    for (let x = x0, i = Math.round(x0 / g); x <= x1; x += g, i++) (i % 5 === 0 ? major : minor).push(`M${x} ${y0}L${x} ${y1}`)
    for (let y = y0, i = Math.round(y0 / g); y <= y1; y += g, i++) (i % 5 === 0 ? major : minor).push(`M${x0} ${y}L${x1} ${y}`)
    return { minor: minor.join(''), major: major.join('') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display.grid, display.gridSize, view, size])

  const visible = (e: Entity) => e.face === 1 && layerOf(shown, e.layer)?.visible !== false
  const colorOf = (e: Entity) => layerOf(shown, e.layer)?.color ?? '#e2e8f0'

  return (
    <div
      ref={host}
      tabIndex={0}
      className={cn('relative h-full w-full touch-none overflow-hidden bg-[#16181d] outline-none select-none', tool.id === 'select' ? 'cursor-default' : 'cursor-crosshair')}
      onWheel={onWheel}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={() => setCursor(null)}
      onDoubleClick={() => tool.open && props.onFinish()}
      onContextMenu={(e) => e.preventDefault()}
      data-testid="part-canvas"
    >
      {display.paths && <LargePathNote toolpaths={toolpaths.filter((tp) => !props.hiddenOps.has(tp.opId))} drawings={drawings} />}
      <svg width={size.w} height={size.h} className="absolute inset-0">
        <g transform={worldTf}>
          {grid && (
            <>
              <path d={grid.minor} stroke="#262a33" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <path d={grid.major} stroke="#323845" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            </>
          )}
          <rect x={0} y={0} width={shown.length} height={shown.width} fill="#3a3226" fillOpacity={0.55} stroke="#8a7350" strokeDasharray="6 4" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {(shown.models ?? [])
            .filter((m) => m.visible)
            .map((m) => {
              const f = modelFootprint(m)
              return <rect key={m.id} x={f.x} y={f.y} width={f.dx} height={f.dy} fill="#c084fc" fillOpacity={0.08} stroke="#c084fc" strokeDasharray="2 3" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            })}
          {(shown.rotary?.planes ?? []).map((p) => {
            // a wrapped plane unrolled (M3.3): shapes drawn inside it wrap onto the cylinder
            const r = planeRect(p)
            const ticks: number[] = []
            for (let a = Math.ceil(p.a0 / 90) * 90; a <= p.a1 + 1e-9; a += 90) ticks.push(r.y0 + (((a - p.a0) * Math.PI) / 180) * p.radius)
            return (
              <g key={p.id} pointerEvents="none" data-testid="wrapped-plane">
                <rect x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0} fill="#2dd4bf" fillOpacity={0.05} stroke="#2dd4bf" strokeDasharray="5 4" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                {ticks.map((y, i) => (
                  <path key={i} d={`M${r.x0} ${y}L${r.x1} ${y}`} stroke="#2dd4bf" strokeOpacity={0.35} strokeDasharray="1 4" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                ))}
              </g>
            )
          })}
          {(shown.tilted ?? []).map((p) => {
            // a tilted work plane (M3.4): shapes drawn inside it lie on the plane; x and y from its corner
            const r = tiltedRect(p)
            return (
              <g key={p.id} pointerEvents="none" data-testid="tilted-plane">
                <rect x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0} fill="#fb923c" fillOpacity={0.05} stroke="#fb923c" strokeDasharray="5 4" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                <path d={`M${r.x0} ${r.y0}L${r.x0 + Math.min(20, (r.x1 - r.x0) / 4)} ${r.y0}M${r.x0} ${r.y0}L${r.x0} ${r.y0 + Math.min(20, (r.y1 - r.y0) / 4)}`} stroke="#fb923c" strokeWidth={2} vectorEffect="non-scaling-stroke" />
              </g>
            )
          })}
          <path d={`M0 0L${40 / view.s} 0`} stroke="#ef4444" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          <path d={`M0 0L0 ${40 / view.s}`} stroke="#22c55e" strokeWidth={2} vectorEffect="non-scaling-stroke" />

          {display.paths &&
            toolpaths
              .filter((tp) => !props.hiddenOps.has(tp.opId))
              .map((tp) => {
                const dp = drawings.get(tp.opId)
                if (!dp) return null
                const { cut, rapid, drills } = dp
                // (edge work: the tool lies flat, so its width is not drawn round the path)
                const d = tp.kind === 'edge' ? 1 : (tp.tool?.diameter ?? 6)
                return (
                  <g key={tp.opId}>
                    {dp.drawn <= BAND_POINTS && <path d={cut} stroke="#0ea5e9" strokeOpacity={0.18} strokeWidth={d} strokeLinecap="round" strokeLinejoin="round" fill="none" />}
                    <path d={cut} stroke="#38bdf8" strokeWidth={1.2} fill="none" vectorEffect="non-scaling-stroke" />
                    <path d={rapid} stroke="#f87171" strokeWidth={1} strokeDasharray="4 4" fill="none" vectorEffect="non-scaling-stroke" />
                    {drills.map((p, i) => (
                      <circle key={i} cx={p.x} cy={p.y} r={d / 2} fill="#f59e0b" fillOpacity={0.25} stroke="#f59e0b" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                    ))}
                    {tp.saw && <SawBlades saw={tp.saw} />}
                  </g>
                )
              })}

          {shown.entities.filter(visible).map((e) => {
            const selected = sel.includes(e.id)
            const hot = hover === e.id
            const layer = layerOf(shown, e.layer)
            const construction = layer?.construction
            if (e.g.t === 'point') {
              const p = e.g.p
              return <path key={e.id} d={`M${p.x - 4 / view.s} ${p.y}L${p.x + 4 / view.s} ${p.y}M${p.x} ${p.y - 4 / view.s}L${p.x} ${p.y + 4 / view.s}`} stroke={selected ? '#fbbf24' : colorOf(e)} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            }
            const d = entityContours(e).map(contourPath).join('')
            return (
              <g key={e.id}>
                {(selected || hot) && <path d={d} stroke={selected ? '#fbbf24' : '#fde68a'} strokeOpacity={selected ? 0.35 : 0.25} strokeWidth={7} fill="none" vectorEffect="non-scaling-stroke" />}
                <path
                  d={d}
                  stroke={selected ? '#fbbf24' : colorOf(e)}
                  strokeWidth={e.id === shown.outlineId ? 2 : 1.4}
                  strokeDasharray={screenDash(layer?.lineType) ?? (construction ? '6 4' : undefined)}
                  fill={e.id === shown.outlineId ? '#d6b98a' : 'none'}
                  fillOpacity={0.08}
                  fillRule="evenodd"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )
          })}

          {(boxSel || preview.length > 0) && (
            <>
              {preview.map((c, i) => (
                <path key={i} d={contourPath(c)} stroke="#fbbf24" strokeWidth={1.2} strokeDasharray="5 4" fill="none" vectorEffect="non-scaling-stroke" />
              ))}
              {boxSel && (
                <rect
                  x={Math.min(boxSel.a.x, boxSel.b.x)}
                  y={Math.min(boxSel.a.y, boxSel.b.y)}
                  width={Math.abs(boxSel.b.x - boxSel.a.x)}
                  height={Math.abs(boxSel.b.y - boxSel.a.y)}
                  fill={boxSel.b.x < boxSel.a.x ? '#22c55e' : '#3b82f6'}
                  fillOpacity={0.08}
                  stroke={boxSel.b.x < boxSel.a.x ? '#22c55e' : '#3b82f6'}
                  strokeDasharray={boxSel.b.x < boxSel.a.x ? '5 3' : undefined}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </>
          )}
        </g>

        {display.arrows &&
          shown.entities
            .filter((e) => visible(e) && e.g.t === 'contour')
            .flatMap((e) => entityContours(e).flatMap((c) => arrowsFor(c).map((a, i) => ({ ...a, k: `${e.id}-${i}`, first: i === 0, c }))))
            .map((a) => {
              const q = px(a.p)
              return <path key={a.k} d="M-5 -4L4 0L-5 4" transform={`translate(${q.x} ${q.y}) rotate(${-a.a})`} fill="none" stroke="#a3e635" strokeWidth={1.5} />
            })}
        {display.arrows &&
          shown.entities
            .filter((e) => visible(e) && e.g.t === 'contour')
            .map((e) => {
              const c = (e.g as { c: Contour }).c
              if (!c.segs.length) return null
              const q = px(c.segs[0].a)
              return <circle key={`s-${e.id}`} cx={q.x} cy={q.y} r={3.5} fill="#a3e635" />
            })}

        {display.paths &&
          toolpaths
            .filter((tp) => !props.hiddenOps.has(tp.opId))
            .map((tp) => {
              const st = drawings.get(tp.opId)?.start
              if (!st) return null
              const q = px(st)
              return <rect key={`st-${tp.opId}`} x={q.x - 4} y={q.y - 4} width={8} height={8} fill="#22c55e" stroke="#0f172a" strokeWidth={1} />
            })}

        {tool.id === 'nodes' &&
          sel.flatMap((id) => {
            const e = shown.entities.find((x) => x.id === id)
            if (!e) return []
            return nodesOf(e).map((n, i) => {
              const q = px(n)
              return <rect key={`${id}-${i}`} x={q.x - 4} y={q.y - 4} width={8} height={8} fill="#0f172a" stroke="#fbbf24" strokeWidth={1.5} />
            })
          })}
        {props.nodeSeg &&
          (() => {
            const e = shown.entities.find((x) => x.id === props.nodeSeg!.id)
            const s = e?.g.t === 'contour' ? e.g.c.segs[props.nodeSeg!.seg] : undefined
            if (!s) return null
            return <path d={contourPath({ closed: false, segs: [s] })} transform={worldTf} stroke="#f472b6" strokeWidth={4} fill="none" vectorEffect="non-scaling-stroke" />
          })()}

        {clicks.map((c, i) => {
          const q = px(c.p)
          return <circle key={i} cx={q.x} cy={q.y} r={3} fill="#fbbf24" />
        })}
        <NotesLayer part={shown} px={px} />
        <PlanesLayer part={shown} px={px} />
        <TiltedLayer part={shown} px={px} />
        <FixturesLayer part={shown} px={px} dragging={fxDrag?.id ?? null} />
        <DimsLayer part={shown} px={px} />
        {cursor &&
          cursor.guides.map((g, i) => {
            const a = px(g.from)
            const b = px(g.to)
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#a78bfa" strokeDasharray="3 3" />
          })}
        {cursor && cursor.kind !== 'free' && (
          <g transform={`translate(${px(cursor.p).x} ${px(cursor.p).y})`}>
            <rect x={-6} y={-6} width={12} height={12} fill="none" stroke="#a78bfa" strokeWidth={1.5} />
            <text x={10} y={-8} fill="#c4b5fd" fontSize={11}>
              {cursor.kind}
            </text>
          </g>
        )}
      </svg>
    </div>
  )
}

/** The fixture whose outline (seen from above) holds point w, the top one first. */
function fixtureAt(part: CamPart, w: P): string | null {
  const fs = part.fixtures ?? []
  for (let i = fs.length - 1; i >= 0; i--) {
    for (const loop of fixtureFootprint(fs[i])) {
      let inside = false
      for (let a = 0, b = loop.length - 1; a < loop.length; b = a++) {
        const [xi, yi] = loop[a]
        const [xj, yj] = loop[b]
        if (yi > w.y !== yj > w.y && w.x < ((xj - xi) * (w.y - yi)) / (yj - yi) + xi) inside = !inside
      }
      if (inside) return fs[i].id
    }
  }
  return null
}

/** Clamps, pods and rails (M3.6): their outlines seen from above, those under the part dashed, with names. */
function FixturesLayer({ part, px, dragging }: { part: CamPart; px: (p: P) => P; dragging: string | null }) {
  const fs = part.fixtures ?? []
  if (!fs.length) return null
  return (
    <g data-testid="fixtures">
      {fs.map((f) => {
        const under = f.at.z + shapeHeight(f.shape) <= -part.thickness + 1e-6
        const color = f.off ? '#78716c' : under ? '#60a5fa' : '#f59e0b'
        const loops = fixtureFootprint(f)
        const pts = loops.flat()
        const top = pts.reduce((a, q) => (q[1] > a[1] ? q : a), pts[0] ?? [f.at.x, f.at.y])
        const at = px({ x: top[0], y: top[1] })
        return (
          <g key={f.id} className="cursor-move" data-testid="fixture-outline">
            {loops.map((l, i) => (
              <polygon key={i} points={l.map(([x, y]) => px({ x, y })).map((q) => `${q.x},${q.y}`).join(' ')} fill={color} fillOpacity={dragging === f.id ? 0.35 : 0.18} stroke={color} strokeWidth={dragging === f.id ? 2 : 1.25} strokeDasharray={under ? '4 3' : undefined} />
            ))}
            <text x={at.x} y={at.y - 4} fontSize={10.5} fill={color} stroke="#16181d" strokeWidth={3} paintOrder="stroke" pointerEvents="none">
              {f.name}
              {under ? ' (under)' : ''}
            </text>
          </g>
        )
      })}
    </g>
  )
}

/** Labels of the tilted work planes (M3.4): name, tilt and the direction it faces. */
function TiltedLayer({ part, px }: { part: CamPart; px: (p: P) => P }) {
  const planes = part.tilted ?? []
  if (!planes.length) return null
  return (
    <g pointerEvents="none" data-testid="tilted-labels">
      {planes.map((p) => {
        const r = tiltedRect(p)
        const at = px({ x: r.x0, y: r.y1 })
        const tilt = Math.round(p.tilt * 100) / 100
        return (
          <text key={p.id} x={at.x + 6} y={at.y + 15} fontSize={11} fill="#fdba74" stroke="#16181d" strokeWidth={3} paintOrder="stroke">
            {p.name} · tilted {tilt}°{tilt > 0.01 && tilt < 179.99 ? ` towards ${Math.round(p.toward * 100) / 100}°` : ''} (3+2)
          </text>
        )
      })}
    </g>
  )
}

/** Labels of the wrapped planes (M3.3): name, radius and the angle every 90° round. */
function PlanesLayer({ part, px }: { part: CamPart; px: (p: P) => P }) {
  const units = useStore((s) => s.data?.settings.units ?? 'mm')
  const planes = part.rotary?.planes ?? []
  if (!planes.length) return null
  return (
    <g pointerEvents="none" data-testid="plane-labels">
      {planes.map((p) => {
        const r = planeRect(p)
        const at = px({ x: r.x0, y: r.y1 })
        const ticks: { y: number; a: number }[] = []
        for (let a = Math.ceil(p.a0 / 90) * 90; a <= p.a1 + 1e-9; a += 90) ticks.push({ y: r.y0 + (((a - p.a0) * Math.PI) / 180) * p.radius, a })
        return (
          <g key={p.id}>
            <text x={at.x + 6} y={at.y + 15} fontSize={11} fill="#5eead4" stroke="#16181d" strokeWidth={3} paintOrder="stroke">
              {p.name} · unrolled at R {formatLength(p.radius, units)} · {part.rotary!.axis} {formatLength(p.start, units)} to {formatLength(p.end, units)}
            </text>
            {ticks.map((t) => {
              const q = px({ x: r.x0, y: t.y })
              return (
                <text key={t.a} x={q.x - 4} y={q.y + 4} textAnchor="end" fontSize={10} fill="#5eead4" stroke="#16181d" strokeWidth={3} paintOrder="stroke">
                  {t.a}°
                </text>
              )
            })}
          </g>
        )
      })}
    </g>
  )
}

/**
 * Annotations drawn on screen (NEW-21): hatching and detail views, worked out from the shapes as
 * they are now (so a hatch follows its shapes), labels the same size at any zoom.
 */
function NotesLayer({ part, px }: { part: CamPart; px: (p: P) => P }) {
  const notes = useMemo(() => (part.annotations?.length ? annotationLines(part, 0.05) : null), [part])
  if (!notes) return null
  const f = (n: number) => Math.round(n * 10) / 10
  const d = notes.lines
    .map((l) =>
      l
        .map((q, i) => {
          const s = px(q)
          return `${i ? 'L' : 'M'}${f(s.x)} ${f(s.y)}`
        })
        .join(''),
    )
    .join('')
  return (
    <g pointerEvents="none" data-testid="notes">
      <path d={d} stroke="#94a3b8" strokeWidth={0.8} fill="none" />
      {notes.texts.map((t, i) => {
        const s = px(t.at)
        return (
          <text key={i} x={s.x} y={s.y} textAnchor="middle" fontSize={12} fill="#cbd5e1" stroke="#16181d" strokeWidth={3} paintOrder="stroke">
            {t.text}
          </text>
        )
      })}
    </g>
  )
}

/**
 * Dimensions drawn on screen (CAD-08): measured from the shapes as they are now, so they follow
 * every change; text kept readable and the same size at any zoom.
 */
function DimsLayer({ part, px }: { part: CamPart; px: (p: P) => P }) {
  const units = useStore((s) => s.data?.settings.units ?? 'mm')
  if (!part.dims?.length) return null
  return (
    <g pointerEvents="none" data-testid="dims">
      {part.dims.map((d) => {
        const g = measureDim(part, d)
        if (!g) return null
        const seg = (a: P, b: P, k: string) => {
          const A = px(a)
          const B = px(b)
          return <line key={k} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="#facc15" strokeWidth={1} />
        }
        const t = px(g.text)
        let ang = (-g.textDir * 180) / Math.PI
        ang = ((ang % 360) + 360) % 360
        if (ang > 90 && ang <= 270) ang -= 180
        return (
          <g key={d.id}>
            {g.lines.map(([a, b], i) => seg(a, b, `l${i}`))}
            {g.arcs.map((a, i) => {
              const n = 32
              const pts = Array.from({ length: n + 1 }, (_, k) => px({ x: a.c.x + a.r * Math.cos(a.a0 + ((a.a1 - a.a0) * k) / n), y: a.c.y + a.r * Math.sin(a.a0 + ((a.a1 - a.a0) * k) / n) }))
              return <polyline key={`a${i}`} points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#facc15" strokeWidth={1} />
            })}
            {g.arrows.map((a, i) => {
              const tip = px(a.at)
              // world direction to screen (y is flipped)
              const r = (-a.dir * 180) / Math.PI
              return <path key={`r${i}`} d="M0 0L-8 -3L-8 3Z" transform={`translate(${tip.x} ${tip.y}) rotate(${r})`} fill="#facc15" />
            })}
            <text x={t.x} y={t.y} transform={`rotate(${ang} ${t.x} ${t.y})`} dy={-4} textAnchor="middle" fontSize={12} fill="#fde68a" stroke="#16181d" strokeWidth={3} paintOrder="stroke">
              {dimText(d, g, units)}
            </text>
          </g>
        )
      })}
    </g>
  )
}

/** What the plan view says about very large toolpaths: still being drawn, or drawn simplified. */
function LargePathNote({ toolpaths, drawings }: { toolpaths: Toolpath[]; drawings: Map<string, DisplayPaths | null> }) {
  const waiting = toolpaths.filter((tp) => drawings.get(tp.opId) === null)
  const simplified = toolpaths.map((tp) => drawings.get(tp.opId)).filter((d): d is DisplayPaths => !!d && d.tol > 0)
  if (!waiting.length && !simplified.length) return null
  const tol = Math.max(0, ...simplified.map((d) => d.tol))
  const noBand = simplified.some((d) => d.drawn > BAND_POINTS)
  return (
    <div className="pointer-events-none absolute right-2 bottom-2 z-10 max-w-sm rounded border border-white/10 bg-black/60 px-2 py-1 text-[11px] text-stone-300" data-testid="large-path-note">
      {waiting.length > 0 && <div>Drawing {waiting.length} large toolpath(s)…</div>}
      {simplified.length > 0 && (
        <div>
          Large toolpath(s) drawn simplified for the screen (within {tol < 0.1 ? tol.toFixed(2) : tol.toFixed(1)} mm{noBand ? '; centre line only' : ''}). The simulation, checks and programs use every point.
        </div>
      )}
    </div>
  )
}
