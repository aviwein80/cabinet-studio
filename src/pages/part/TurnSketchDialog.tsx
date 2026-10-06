/**
 * Turn-by-turn sketch (CAD-02): describe an outline element by element, leave the values you do
 * not know as "?", and the solver works them out so the outline closes. The drawing and the
 * worked-out values update as you type; inches show as fractions.
 */
import { ArrowDown, ArrowUp, PenLine, Plus, Trash2 } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useMemo, useState } from 'react'
import { makeEntity } from '@/cam/doc'
import { newElement, SAMPLE_SKETCH, solveTurnSketch } from '@/cam/turnSketch'
import type { CamPart, TurnElement, TurnSketch } from '@/cam/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { formatLength, parseLength } from '@/core/units'
import type { UnitSystem } from '@/core/types'
import { cn } from '@/lib/utils'
import { ShapePreview } from './ShapePreview'

/** A value box with a "?" switch: unknown values are left to the solver. */
function ValueCell({ value, onChange, units, kind, label, solved }: { value: number | null; onChange: (v: number | null) => void; units: UnitSystem; kind: 'len' | 'deg'; label: string; solved?: number }) {
  const shown = value === null ? '' : kind === 'len' ? formatLength(value, units) : String(Math.round(value * 1e6) / 1e6)
  const [text, setText] = useState(shown)
  const [last, setLast] = useState(shown)
  if (shown !== last) {
    setLast(shown)
    setText(shown)
  }
  const commit = () => {
    const n = kind === 'len' ? parseLength(text, units) : Number(text.replace(',', '.'))
    if (n !== null && Number.isFinite(n)) onChange(n)
    else setText(shown)
  }
  const unknown = value === null
  return (
    <div className="flex items-center gap-1">
      <input
        aria-label={label}
        value={unknown ? (solved !== undefined ? (kind === 'len' ? formatLength(solved, units) : `${Math.round(solved * 100) / 100}`) : '') : text}
        disabled={unknown}
        placeholder="?"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className={cn('h-7 w-[4.5rem] rounded border border-white/10 bg-black/30 px-1.5 text-xs tabular-nums', unknown && 'border-sky-400/40 bg-sky-400/10 text-sky-200 italic')}
      />
      <button
        type="button"
        aria-pressed={unknown}
        title={unknown ? 'Unknown: worked out by the solver. Click to give a value.' : 'Make this value unknown (the solver works it out)'}
        onClick={() => onChange(unknown ? (solved ?? 0) : null)}
        className={cn('h-6 w-6 rounded text-xs font-semibold', unknown ? 'bg-sky-500 text-stone-900' : 'text-stone-400 hover:bg-white/10')}
      >
        ?
      </button>
    </div>
  )
}

export function TurnSketchDialog({ part, layer, units, editing, onClose, onInsert }: { part: CamPart; layer: string; units: UnitSystem; editing?: { entityId: string; sketch: TurnSketch }; onClose: () => void; onInsert: (p: CamPart, message: string) => void }) {
  const [sk, setSk] = useState<TurnSketch>(() => structuredClone(editing?.sketch ?? SAMPLE_SKETCH))
  const [pick, setPick] = useState(0)
  const res = useMemo(() => solveTurnSketch(sk, pick), [sk, pick])
  const fmt = (n: number) => formatLength(n, units)
  const setEl = (i: number, patch: Partial<TurnElement>) => setSk((s) => ({ ...s, elements: s.elements.map((e, k) => (k === i ? { ...e, ...patch } : e)) }))
  const solvedOf = (i: number, field: 'length' | 'angle' | 'radius') => (res.ok ? res.solution.unknowns.find((u) => u.element === i && u.field === field)?.value : undefined)
  const move = (i: number, d: number) =>
    setSk((s) => {
      const els = [...s.elements]
      const [e] = els.splice(i, 1)
      els.splice(Math.max(0, Math.min(els.length, i + d)), 0, e)
      return { ...s, elements: els }
    })

  const insert = () => {
    if (!res.ok) return
    const c = res.solution.contour
    if (editing) {
      const next = { ...part, entities: part.entities.map((e) => (e.id === editing.entityId ? { ...e, g: { t: 'contour' as const, c } } : e)), sketches: { ...(part.sketches ?? {}), [editing.entityId]: sk } }
      onInsert(next, 'Sketch solved again; the shape keeps its operations.')
    } else {
      const e = makeEntity({ t: 'contour', c }, layer)
      e.id = nanoid(10)
      onInsert({ ...part, entities: [...part.entities, e], sketches: { ...(part.sketches ?? {}), [e.id]: sk } }, `Outline from the sketch added${res.solution.unknowns.length ? `: ${res.solution.unknowns.length} value(s) worked out` : ''}.`)
    }
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="dark max-h-[92vh] overflow-y-auto border-white/10 bg-[#15171c] text-stone-100 sm:max-w-[1180px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PenLine className="size-4" /> Turn-by-turn sketch
          </DialogTitle>
          <DialogDescription className="text-stone-400">
            Describe the outline one element at a time from the start point. Directions are in degrees: from +X (absolute) or the turn from the element before (0 = tangent, + = left). Press ? on a value you do not know; a closed outline can work out two.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3 text-xs text-stone-400">
              Start X <ValueCell value={sk.start.x} units={units} kind="len" label="Start X" onChange={(v) => v !== null && setSk({ ...sk, start: { ...sk.start, x: v } })} />
              Y <ValueCell value={sk.start.y} units={units} kind="len" label="Start Y" onChange={(v) => v !== null && setSk({ ...sk, start: { ...sk.start, y: v } })} />
              <label className="flex items-center gap-1.5">
                <Switch size="sm" checked={sk.closed} onCheckedChange={(closed) => setSk({ ...sk, closed })} /> Close back to the start
              </label>
            </div>
            <div className="overflow-x-auto rounded-md border border-white/10">
              <table className="w-full text-xs">
                <thead className="bg-white/5 text-left text-stone-400">
                  <tr>
                    <th className="px-1.5 py-1">#</th>
                    <th className="px-1.5 py-1">Element</th>
                    <th className="px-1.5 py-1">Length / sweep °</th>
                    <th className="px-1.5 py-1">Direction °</th>
                    <th className="px-1.5 py-1">Radius</th>
                    <th className="px-1.5 py-1">Corner after</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sk.elements.map((e, i) => (
                    <tr key={i} className="border-t border-white/5">
                      <td className="px-1.5 text-stone-500">{i + 1}</td>
                      <td className="px-1.5">
                        <select aria-label={`Element ${i + 1} kind`} value={e.kind === 'arc' ? (e.ccw ? 'arc-l' : 'arc-r') : 'line'} onChange={(ev) => setEl(i, ev.target.value === 'line' ? { kind: 'line', radius: undefined, ccw: undefined, length: e.kind === 'arc' ? 100 : e.length } : { kind: 'arc', ccw: ev.target.value === 'arc-l', radius: e.radius ?? 50, length: e.kind === 'line' ? 90 : e.length })} className="h-7 rounded border border-white/10 bg-black/30 px-1">
                          <option value="line">Line</option>
                          <option value="arc-l">Arc, turning left</option>
                          <option value="arc-r">Arc, turning right</option>
                        </select>
                      </td>
                      <td className="px-1.5 py-1">
                        <ValueCell value={e.length} units={units} kind={e.kind === 'arc' ? 'deg' : 'len'} label={`Element ${i + 1} ${e.kind === 'arc' ? 'sweep' : 'length'}`} solved={solvedOf(i, 'length')} onChange={(v) => setEl(i, { length: v })} />
                      </td>
                      <td className="px-1.5 py-1">
                        <div className="flex items-center gap-1">
                          <ValueCell value={e.angle} units={units} kind="deg" label={`Element ${i + 1} direction`} solved={solvedOf(i, 'angle')} onChange={(v) => setEl(i, { angle: v })} />
                          {i > 0 && (
                            <select aria-label={`Element ${i + 1} direction is`} value={e.angleMode} onChange={(ev) => setEl(i, { angleMode: ev.target.value as TurnElement['angleMode'] })} className="h-7 rounded border border-white/10 bg-black/30 px-1">
                              <option value="turn">turn</option>
                              <option value="absolute">from +X</option>
                            </select>
                          )}
                        </div>
                      </td>
                      <td className="px-1.5 py-1">{e.kind === 'arc' && <ValueCell value={e.radius ?? null} units={units} kind="len" label={`Element ${i + 1} radius`} solved={solvedOf(i, 'radius')} onChange={(v) => setEl(i, { radius: v })} />}</td>
                      <td className="px-1.5 py-1">
                        <div className="flex items-center gap-1">
                          <select aria-label={`Corner after element ${i + 1}`} value={e.corner?.kind ?? 'none'} onChange={(ev) => setEl(i, { corner: ev.target.value === 'none' ? undefined : { kind: ev.target.value as 'blend' | 'chamfer', size: e.corner?.size ?? 10 } })} className="h-7 rounded border border-white/10 bg-black/30 px-1">
                            <option value="none">sharp</option>
                            <option value="blend">blend</option>
                            <option value="chamfer">chamfer</option>
                          </select>
                          {e.corner && <ValueCell value={e.corner.size} units={units} kind="len" label={`Corner ${i + 1} size`} onChange={(v) => v !== null && setEl(i, { corner: { ...e.corner!, size: v } })} />}
                        </div>
                      </td>
                      <td className="px-1 whitespace-nowrap">
                        <Button size="icon-xs" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                          <ArrowUp />
                        </Button>
                        <Button size="icon-xs" variant="ghost" aria-label="Move down" disabled={i === sk.elements.length - 1} onClick={() => move(i, 1)}>
                          <ArrowDown />
                        </Button>
                        <Button size="icon-xs" variant="ghost" aria-label="Remove element" onClick={() => setSk({ ...sk, elements: sk.elements.filter((_, k) => k !== i) })}>
                          <Trash2 />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="border-white/15 bg-transparent" onClick={() => setSk({ ...sk, elements: [...sk.elements, newElement('line')] })}>
                <Plus /> Line
              </Button>
              <Button size="sm" variant="outline" className="border-white/15 bg-transparent" onClick={() => setSk({ ...sk, elements: [...sk.elements, newElement('arc')] })}>
                <Plus /> Arc
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <ShapePreview label="Sketch preview" layers={res.ok ? [{ contours: [res.solution.contour], stroke: '#fbbf24', fill: '#fbbf2422' }] : []} points={res.ok ? [{ p: sk.start, color: '#ef4444' }] : []} />
            {res.ok ? (
              <div className="rounded-md border border-emerald-400/30 bg-emerald-400/10 p-2 text-xs text-emerald-100" data-testid="sketch-status">
                <div className="font-medium">Solved{res.solution.unknowns.length ? `: ${res.solution.unknowns.length} value(s) worked out` : ' (every value given)'}</div>
                <ul className="mt-1 space-y-0.5">
                  {res.solution.unknowns.map((u) => (
                    <li key={`${u.element}${u.field}`}>
                      Element {u.element + 1} {u.field === 'length' ? (sk.elements[u.element].kind === 'arc' ? 'sweep' : 'length') : u.field === 'angle' ? 'direction' : 'radius'}: <b>{u.field === 'angle' || (u.field === 'length' && sk.elements[u.element].kind === 'arc') ? `${Math.round(u.value * 100) / 100}°` : fmt(u.value)}</b>
                    </li>
                  ))}
                </ul>
                {res.warnings.map((w) => (
                  <div key={w} className="mt-1 text-amber-200">
                    {w}{' '}
                    <Button size="xs" variant="outline" className="h-5 border-white/20 bg-transparent px-1.5 text-[10px]" onClick={() => setPick((p) => (p + 1) % res.solutions.length)}>
                      Next answer
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-red-400/30 bg-red-400/10 p-2 text-xs text-red-100" data-testid="sketch-status">
                {res.error}
                <div className="mt-1 text-stone-400">
                  {res.unknowns} unknown value(s); closing the outline works out {res.equations}.
                </div>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!res.ok} onClick={insert}>
            {editing ? 'Update the shape' : 'Add the outline'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
