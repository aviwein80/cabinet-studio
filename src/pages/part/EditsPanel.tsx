/**
 * Screens for hand-drawn toolpaths (NEW-09) and toolpath edits (NEW-11). The work is done by
 * `src/cam/more25d/edits.ts`; these only call it.
 */
import { useMemo, useState } from 'react'
import { MousePointerClick, Trash2, Undo2 } from 'lucide-react'
import { anchorOf, movesHash, reanchor, undoStep } from '@/cam/more25d/edits'
import { generateOp, inBackground, type SimpleMove, simpleMoves, type Toolpath } from '@/cam/toolpath'
import type { CamOp, CamPart, ManualOp, ToolpathEdits } from '@/cam/types'
import { NumField, SwitchField } from '@/components/fields'
import { Button } from '@/components/ui/button'
import type { MachineProfile } from '@/core/types'
import { cn } from '@/lib/utils'
import type { PathPick } from './OpsPanel'
import { useOpCfg } from './opConfigure'
import { cutDefaultsOf } from '@/core/confirm'
import { useStore } from '@/app/store'

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-white/10 px-4 py-3">
      <h4 className="mb-2 text-[11px] font-semibold tracking-wider text-stone-400 uppercase">{title}</h4>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">{children}</div>
    </section>
  )
}

const num = (v: number) => (Math.round(v * 1000) / 1000).toString()

/** Hand-drawn toolpath: start, the steps, and picking new ones on the drawing. */
export function ManualFields({ op, part, sel, onChange, pathPick, setPathPick }: { op: ManualOp; part: CamPart; sel: string[]; onChange: (o: CamOp) => void; pathPick: PathPick | null; setPathPick?: (p: PathPick | null) => void }) {
  const last = op.steps[op.steps.length - 1]
  const [z, setZ] = useState(last ? last.z : op.start.z || -2)
  const picking = pathPick?.opId === op.id ? pathPick : null
  const pick = (kind: PathPick['kind']) => setPathPick?.({ opId: op.id, kind, z })
  const setStep = (i: number, patch: Partial<{ x: number; y: number; z: number }>) => onChange({ ...op, steps: op.steps.map((s, k) => (k === i ? { ...s, ...patch } : s)) })
  const point = sel.map((id) => part.entities.find((e) => e.id === id)).find((e) => e?.g.t === 'point')
  return (
    <Group title="Hand-drawn toolpath">
      <div className="col-span-2 flex flex-wrap items-center gap-1.5">
        {(['feed', 'arc', 'rapid'] as const).map((k) => (
          <Button key={k} size="sm" variant="outline" className={cn('h-7 gap-1 border-white/15 bg-transparent px-2 text-[11px]', picking?.kind === k && 'border-amber-400 text-amber-300')} onClick={() => (picking?.kind === k ? setPathPick?.(null) : pick(k))}>
            <MousePointerClick className="size-3.5" /> {k === 'feed' ? 'Feed line' : k === 'arc' ? 'Arc through a point' : 'Rapid'}
          </Button>
        ))}
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" disabled={!op.steps.length && !op.start.x && !op.start.y && !op.start.z} onClick={() => onChange(undoStep(op))}>
          <Undo2 className="size-3.5" /> Undo last
        </Button>
        {picking && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-amber-300" onClick={() => setPathPick?.(null)}>
            Done
          </Button>
        )}
      </div>
      <NumField
        label="Height of new points"
        value={z}
        step={0.5}
        onChange={(v) => {
          setZ(v)
          if (picking) setPathPick?.({ ...picking, z: v })
        }}
        hint="0 = face 1; negative is into the panel"
      />
      <div className="self-end pb-1.5 text-[11px] text-stone-400">{picking ? (picking.kind === 'arc' && picking.through ? 'Pick the end of the arc' : 'Pick on the drawing (snaps apply). Esc stops.') : op.steps.length ? `${op.steps.length} step(s)` : 'The first pick is the start'}</div>
      <NumField label="Start X" value={op.start.x} onChange={(v) => onChange({ ...op, start: { ...op.start, x: v } })} />
      <NumField label="Start Y" value={op.start.y} onChange={(v) => onChange({ ...op, start: { ...op.start, y: v } })} />
      <NumField label="Start height" value={op.start.z} step={0.5} onChange={(v) => onChange({ ...op, start: { ...op.start, z: v } })} />
      <div className="self-end pb-1">
        {point?.g.t === 'point' && (
          <Button size="sm" variant="outline" className="h-6 border-white/15 bg-transparent px-2 text-[11px]" onClick={() => point.g.t === 'point' && onChange({ ...op, start: { ...op.start, x: point.g.p.x, y: point.g.p.y } })}>
            Start at the selected point
          </Button>
        )}
      </div>
      {op.steps.length > 0 && (
        <div className="col-span-2 max-h-56 overflow-auto rounded border border-white/10">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-[#1b1e24] text-left text-stone-400">
              <tr>
                <th className="px-1.5 py-1">#</th>
                <th className="px-1.5 py-1">Step</th>
                <th className="px-1.5 py-1">X</th>
                <th className="px-1.5 py-1">Y</th>
                <th className="px-1.5 py-1">Z</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {op.steps.map((s, i) => (
                <tr key={i} className="border-t border-white/5">
                  <td className="px-1.5 text-stone-500 tabular-nums">{i + 1}</td>
                  <td className="px-1.5">{s.k === 'arc' ? (s.ccw ? 'Arc ↺' : 'Arc ↻') : s.k === 'feed' ? 'Feed' : 'Rapid'}</td>
                  {(['x', 'y', 'z'] as const).map((k) => (
                    <td key={k} className="px-1">
                      <input className="w-16 rounded bg-white/5 px-1 py-0.5 tabular-nums outline-none focus:bg-white/10" defaultValue={num(s[k])} onBlur={(e) => Number.isFinite(Number(e.target.value)) && Number(e.target.value) !== s[k] && setStep(i, { [k]: Number(e.target.value) })} />
                    </td>
                  ))}
                  <td>
                    <button aria-label="Remove step" className="px-1 text-stone-500 hover:text-red-300" onClick={() => onChange({ ...op, steps: op.steps.filter((_, k) => k !== i) })}>
                      <Trash2 className="size-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Group>
  )
}

const PAGE = 50

/** Toolpath edits: corner slow-down, rapid height, reverse, pocket start points, and point by point. */
export function EditsGroup({ op, part, machine, tp, sel, onChange }: { op: CamOp; part: CamPart; machine: MachineProfile; tp?: Toolpath; sel: string[]; onChange: (o: CamOp) => void }) {
  const e: ToolpathEdits = op.edits ?? {}
  const c = useOpCfg(op, part, onChange)
  const shopCorners = useStore((st) => cutDefaultsOf(st.data!.machine).corners)
  // corner values typed in are this operation's own (confirmed for it)
  const setCorners = (corners: NonNullable<ToolpathEdits['corners']>) => c('corners').set({ ...op, edits: { ...e, corners } } as CamOp)
  const set = (patch: Partial<ToolpathEdits>) => {
    const next = { ...e, ...patch }
    for (const k of Object.keys(next) as (keyof ToolpathEdits)[]) if (next[k] === undefined) delete next[k]
    onChange({ ...op, edits: Object.keys(next).length ? next : undefined } as CamOp)
  }
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState(false)
  const background = inBackground(op, part)
  // the unedited toolpath: point edits are anchored on it (2D operations only; 3D ones are calculated in the background)
  const unedited = useMemo<SimpleMove[] | null>(() => {
    if (!open || background) return null
    try {
      return [...simpleMoves(generateOp({ ...op, edits: e.starts ? { starts: e.starts } : undefined } as CamOp, { part, machine }).moves)]
    } catch {
      return null
    }
  }, [open, background, op, e.starts, part, machine])
  const base = useMemo(() => (unedited ? movesHash(unedited) : null), [unedited])
  const pointEdits = (e.z?.length ?? 0) + (e.feeds?.length ?? 0)
  const stale = !!tp?.edited && (tp.edited.lost > 0 || tp.edited.moved > 0)
  const pickPoint = sel.map((id) => part.entities.find((x) => x.id === id)).find((x) => x?.g.t === 'point')
  const zAt = (i: number) => (base && e.base === base ? e.z?.find((x) => x.at.i === i) : undefined)
  const feedAt = (i: number) => (base && e.base === base ? e.feeds?.find((f) => f.from.i === i && f.to.i === i) : undefined)
  const editZ = (i: number, v: number | null) => {
    if (!unedited || !base) return
    const rest = (e.base === base ? (e.z ?? []) : []).filter((x) => x.at.i !== i)
    set({ base, z: v === null ? rest : [...rest, { at: anchorOf(unedited, i), z: v }], feeds: e.base === base ? e.feeds : undefined })
  }
  const editFeed = (i: number, pct: number | null) => {
    if (!unedited || !base) return
    const rest = (e.base === base ? (e.feeds ?? []) : []).filter((f) => !(f.from.i === i && f.to.i === i))
    set({ base, feeds: pct === null || pct === 100 ? rest : [...rest, { from: anchorOf(unedited, i), to: anchorOf(unedited, i), percent: pct }], z: e.base === base ? e.z : undefined })
  }
  return (
    <Group title="Edit toolpath">
      {stale && (
        <div className="col-span-2 rounded border border-red-400/30 bg-red-500/10 p-2 text-[11px] text-red-200">
          {tp!.edited!.lost ? `${tp!.edited!.lost} point edit(s) no longer match the recalculated toolpath (output is refused until you keep or clear them).` : `${tp!.edited!.moved} point edit(s) moved to the matching moves of the recalculated toolpath.`}
          <div className="mt-1.5 flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-6 border-white/15 bg-transparent px-2 text-[11px]"
              onClick={() => {
                const fresh = [...simpleMoves(generateOp({ ...op, edits: e.starts ? { starts: e.starts } : undefined } as CamOp, { part, machine }).moves)]
                const r = reanchor(e, fresh)
                onChange({ ...op, edits: Object.keys(r.edits).length ? r.edits : undefined } as CamOp)
              }}
            >
              Keep on the new toolpath
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => set({ z: undefined, feeds: undefined, base: undefined })}>
              Clear point edits
            </Button>
          </div>
        </div>
      )}
      <div className="col-span-2">
        <SwitchField label="Slow down in corners" checked={!!e.corners} onChange={(v) => set({ corners: v ? { ...shopCorners } : undefined })} hint="Sharp turns and tight arcs; starts from the shop's default values" cfg={c('corners').cfg} badge={e.corners ? c('corners').badge : undefined} />
      </div>
      {e.corners && (
        <>
          <NumField label="Corners sharper than" suffix="°" value={e.corners.angle} min={1} max={180} onChange={(v) => setCorners({ ...e.corners!, angle: v })} />
          <NumField label="Distance each side" value={e.corners.distance} min={0.1} onChange={(v) => setCorners({ ...e.corners!, distance: v })} />
          <NumField label="Steps" suffix="" value={e.corners.steps} min={1} max={20} onChange={(v) => setCorners({ ...e.corners!, steps: Math.round(v) })} />
          <NumField label="Feed at the corner" suffix="%" value={e.corners.percent} min={1} max={100} onChange={(v) => setCorners({ ...e.corners!, percent: v })} />
        </>
      )}
      <div className="col-span-2">
        <SwitchField label="Moves between cuts at another height" checked={e.rapidHeight !== undefined} onChange={(v) => set({ rapidHeight: v ? op.levels.safeZ : undefined })} hint="Instead of the safe height; rapids through material show as collisions" />
      </div>
      {e.rapidHeight !== undefined && <NumField label="Height" value={e.rapidHeight} min={0} onChange={(v) => set({ rapidHeight: v })} />}
      <div className="col-span-2">
        <SwitchField label="Reverse" checked={!!e.reverse} onChange={(v) => set({ reverse: v || undefined })} hint="Last cut first, each the other way. Refused when the new starts would plunge deeper than the tool may." />
      </div>
      {op.kind === 'pocket' && (
        <>
          <NumField label="Start point X" value={e.starts?.[0]?.x ?? 0} onChange={(v) => set({ starts: [{ x: v, y: e.starts?.[0]?.y ?? 0 }] })} />
          <NumField label="Start point Y" value={e.starts?.[0]?.y ?? 0} onChange={(v) => set({ starts: [{ x: e.starts?.[0]?.x ?? 0, y: v }] })} />
          <div className="col-span-2 flex gap-1.5">
            {pickPoint?.g.t === 'point' && (
              <Button size="sm" variant="outline" className="h-6 border-white/15 bg-transparent px-2 text-[11px]" onClick={() => pickPoint.g.t === 'point' && set({ starts: [{ x: pickPoint.g.p.x, y: pickPoint.g.p.y }] })}>
                Start at the selected point
              </Button>
            )}
            {e.starts && (
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => set({ starts: undefined })}>
                Clear start point
              </Button>
            )}
          </div>
        </>
      )}
      <div className="col-span-2">
        <Button size="sm" variant="outline" className="h-6 border-white/15 bg-transparent px-2 text-[11px]" disabled={background} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide moves' : `Edit point by point${pointEdits ? ` (${pointEdits})` : ''}`}
        </Button>
        {background && <span className="ml-2 text-[11px] text-stone-500">Point edits are for operations calculated here (not 3D)</span>}
      </div>
      {open && unedited && (
        <div className="col-span-2">
          {e.base && base && e.base !== base && <p className="mb-1 text-[11px] text-amber-200">The toolpath changed since the point edits were made: keep or clear them first.</p>}
          <div className="max-h-72 overflow-auto rounded border border-white/10">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-[#1b1e24] text-left text-stone-400">
                <tr>
                  <th className="px-1.5 py-1">#</th>
                  <th className="px-1.5 py-1">Move</th>
                  <th className="px-1.5 py-1">X</th>
                  <th className="px-1.5 py-1">Y</th>
                  <th className="px-1.5 py-1">Z</th>
                  <th className="px-1.5 py-1">Feed %</th>
                </tr>
              </thead>
              <tbody>
                {unedited.slice(page * PAGE, page * PAGE + PAGE).map((m, k) => {
                  const i = page * PAGE + k
                  const ze = zAt(i)
                  const fe = feedAt(i)
                  const locked = !!e.base && !!base && e.base !== base
                  return (
                    <tr key={i} className={cn('border-t border-white/5', (ze || fe) && 'bg-amber-400/10')}>
                      <td className="px-1.5 text-stone-500 tabular-nums">{i + 1}</td>
                      <td className="px-1.5">{m.t === 'feed' ? (m.f === 'cut' ? 'Feed' : m.f === 'plunge' ? 'Plunge' : 'Lead') : m.t === 'arc' ? 'Arc' : m.t === 'drill' ? 'Drill' : 'Rapid'}</td>
                      <td className="px-1.5 tabular-nums">{num(m.x)}</td>
                      <td className="px-1.5 tabular-nums">{num(m.y)}</td>
                      <td className="px-1">
                        <input
                          key={`${i}:${ze?.z ?? m.z}`}
                          disabled={locked}
                          className="w-16 rounded bg-white/5 px-1 py-0.5 tabular-nums outline-none focus:bg-white/10 disabled:opacity-50"
                          defaultValue={num(ze?.z ?? m.z)}
                          onBlur={(ev) => {
                            const v = Number(ev.target.value)
                            if (!Number.isFinite(v)) return
                            if (Math.abs(v - m.z) < 1e-9) {
                              if (ze) editZ(i, null)
                            } else if (v !== ze?.z) editZ(i, v)
                          }}
                        />
                      </td>
                      <td className="px-1">
                        {(m.t === 'feed' || m.t === 'arc') && (
                          <input
                            key={`${i}:${fe?.percent ?? 100}`}
                            disabled={locked}
                            className="w-12 rounded bg-white/5 px-1 py-0.5 tabular-nums outline-none focus:bg-white/10 disabled:opacity-50"
                            defaultValue={String(fe?.percent ?? 100)}
                            onBlur={(ev) => {
                              const v = Number(ev.target.value)
                              if (Number.isFinite(v) && v > 0 && v !== (fe?.percent ?? 100)) editFeed(i, v)
                            }}
                          />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-stone-400">
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Back
            </Button>
            {page * PAGE + 1}-{Math.min(unedited.length, (page + 1) * PAGE)} of {unedited.length}
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={(page + 1) * PAGE >= unedited.length} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
          <p className="mt-1 text-[11px] text-stone-500">Heights edited here stop the operation being written to woodWOP; feed changes show in the simulation and times only.</p>
        </div>
      )}
    </Group>
  )
}
