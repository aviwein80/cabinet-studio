/**
 * Manual nesting (M2.8, NST-09): drag parts on a sheet, turn them, snap them to their neighbours
 * and the trim, move them to another sheet or a new one, then save the layout with the job. The
 * live check marks parts that overlap, are too close, leave the sheet or turn against the grain;
 * the export checker runs in full on the saved layout.
 */
import { FileDown, FileUp, RotateCw, Save, SplitSquareHorizontal, Undo2, X } from 'lucide-react'
import { useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { toast } from 'sonner'
import { backend } from '@/app/backend'
import { useStore } from '@/app/store'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type { PartInstance } from '@/core/cutlist'
import { checkSheet, type Clash, footprint, layoutOf, markUntouched, nestListJson, openingsOf, readNestList, regionOnSheet, snapPlacement, turnHalf, turnQuarter } from '@/core/manualNest'
import { cutoutTool } from '@/core/machining'
import type { JobOutput } from '@/core/pipeline'
import type { AppData, Job, SavedSheet } from '@/core/types'
import { cn } from '@/lib/utils'

const KIND: Record<Clash['kind'], string> = {
  overlap: 'overlaps',
  close: 'too close for the cut-out tool to',
  spacing: 'closer than the nest spacing to',
  'off-sheet': 'is outside the trim',
  grain: 'is turned against the grain',
}

export function NestEditor({ job, data, out, sheetIdx: startIdx, onClose }: { job: Job; data: AppData; out: JobOutput; sheetIdx: number; onClose: () => void }) {
  const mutate = useStore((s) => s.mutate)
  const instances = useMemo(() => new Map(out.instances.map((i) => [i.uid, i])), [out])
  const [draft, setDraft] = useState<SavedSheet[]>(() => layoutOf(out.nest))
  const [history, setHistory] = useState<SavedSheet[][]>([])
  const [idx, setIdx] = useState(Math.min(startIdx, Math.max(0, draft.length - 1)))
  const [sel, setSel] = useState<string[]>([])
  const [snap, setSnap] = useState(true)
  const drag = useRef<{ uid: string; dx: number; dy: number; moved: boolean } | null>(null)
  const layer = useRef<SVGGElement>(null)
  const fileIn = useRef<HTMLInputElement>(null)
  const sheet = draft[Math.min(idx, draft.length - 1)]
  const trim = data.settings.nesting.edgeTrim
  const minGap = cutoutTool(data.machine)?.diameter ?? 0
  const grain = !!data.library.materials.find((m) => m.id === sheet?.materialId)?.grain
  const clashes = useMemo(() => (sheet ? checkSheet(sheet, instances, { minGap, spacing: out.nest.spacing, trim, grain }) : []), [sheet, instances, minGap, out.nest.spacing, trim, grain])
  const bad = new Set(clashes.filter((c) => c.kind !== 'spacing').map((c) => c.uid))
  const warn = new Set(clashes.filter((c) => c.kind === 'spacing').map((c) => c.uid))
  const no = (uid?: string) => (uid ? instances.get(uid)?.no : undefined)

  if (!sheet) return null
  const edit = (fn: (d: SavedSheet[]) => SavedSheet[], keep = false) =>
    setDraft((d) => {
      if (!keep) setHistory((h) => [...h.slice(-49), d])
      return fn(d)
    })
  const setPl = (uid: string, fn: (p: SavedSheet['placements'][number], inst: PartInstance) => SavedSheet['placements'][number], keep = false) =>
    edit((d) => d.map((s, i) => (i !== idx ? s : { ...s, placements: s.placements.map((p) => (p.uid === uid ? fn(p, instances.get(uid)!) : p)) })), keep)

  const local = (e: RPointerEvent) => {
    const m = layer.current?.getScreenCTM()
    if (!m) return { x: 0, y: 0 }
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    return { x: p.x, y: p.y }
  }
  const others = (uid: string) =>
    sheet.placements
      .filter((p) => p.uid !== uid && instances.has(p.uid))
      .map((p) => ({ ...p, ...footprint(instances.get(p.uid)!, p.rotated) }))

  const down = (e: RPointerEvent, uid: string) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const p = sheet.placements.find((q) => q.uid === uid)!
    const at = local(e)
    drag.current = { uid, dx: at.x - p.x, dy: at.y - p.y, moved: false }
    setSel((s) => (e.shiftKey ? (s.includes(uid) ? s.filter((x) => x !== uid) : [...s, uid]) : [uid]))
  }
  const move = (e: RPointerEvent) => {
    const g = drag.current
    if (!g) return
    const at = local(e)
    const inst = instances.get(g.uid)!
    setPl(
      g.uid,
      (p) => {
        const f = footprint(inst, p.rotated)
        let next = { x: Math.round((at.x - g.dx) * 10) / 10, y: Math.round((at.y - g.dy) * 10) / 10 }
        if (snap) next = snapPlacement({ ...next, ...f }, others(g.uid), sheet, { spacing: out.nest.spacing, trim, reach: 20 })
        return { ...p, ...next }
      },
      g.moved,
    )
    g.moved = true
  }
  const up = () => {
    drag.current = null
  }
  const key = (e: React.KeyboardEvent) => {
    if (!sel.length) return
    const step = e.shiftKey ? 10 : 1
    const by: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
    if (by[e.key]) {
      e.preventDefault()
      const [dx, dy] = by[e.key]
      edit((d) => d.map((s, i) => (i !== idx ? s : { ...s, placements: s.placements.map((p) => (sel.includes(p.uid) ? { ...p, x: Math.round((p.x + dx) * 1000) / 1000, y: Math.round((p.y + dy) * 1000) / 1000 } : p)) })))
    } else if (e.key === 'r' || e.key === 'R') turn()
  }
  const turn = () => {
    for (const uid of sel) {
      const inst = instances.get(uid)!
      // a grain-locked part on a grained sheet only turns end for end
      if (!inst.canRotate && grain) setPl(uid, (p) => turnHalf(p))
      else setPl(uid, (p) => turnQuarter(p, inst))
    }
  }
  const moveTo = (target: number | 'new') => {
    if (!sel.length) return
    edit((d) => {
      const taken = d[idx].placements.filter((p) => sel.includes(p.uid))
      const next = d.map((s, i) => (i === idx ? { ...s, placements: s.placements.filter((p) => !sel.includes(p.uid)) } : s))
      if (target === 'new') {
        const { offcutId: _o, ...rest } = d[idx]
        next.push({ ...rest, placements: taken })
      } else next[target] = { ...next[target], placements: [...next[target].placements, ...taken] }
      return next
    })
    setIdx(target === 'new' ? draft.length : target)
  }
  const save = () => {
    // Polish-2: sheets left as the nester laid them out stay "nested automatically"
    const sheets = markUntouched(draft, out.nest)
      .filter((s) => s.placements.length)
      .map((s) => {
        const inside = openingsOf(s, instances)
        return { ...s, placements: s.placements.map(({ inside: _i, ...p }) => ({ ...p, ...(inside.get(p.uid) ? { inside: inside.get(p.uid)! } : {}) })) }
      })
    mutate((d) => {
      const j = d.jobs.find((x) => x.id === job.id)
      if (!j) return
      j.nestEdit = { savedAt: new Date().toISOString(), sheets }
      j.updatedAt = new Date().toISOString()
    })
    toast.success('Layout saved', { description: 'Programs, labels and checks now use it.' })
    onClose()
  }
  const exportList = async () => {
    const where = await backend.saveFile({ name: `${job.number}_nest-list.json`, data: nestListJson(job.number, { savedAt: new Date().toISOString(), sheets: draft }, out.instances, data.library) }, [{ name: 'Nest list', extensions: ['json'] }])
    if (where) toast.success(`Nest list saved to ${where}`)
  }
  const loadList = async (f: File) => {
    try {
      const r = readNestList(await f.text(), out.instances, data.library)
      setHistory((h) => [...h, draft])
      setDraft(r.saved.sheets)
      setIdx(0)
      if (r.missing.length) toast.warning(`${r.missing.length} part(s) in the list are not in this job`, { description: r.missing.slice(0, 8).map((m) => m.partId ?? m.uid).join(', ') })
      else toast.success('Nest list loaded. Save to use it.')
    } catch (e) {
      toast.error('Could not load the nest list', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      if (fileIn.current) fileIn.current.value = ''
    }
  }

  const L = sheet.sheetLength
  const W = sheet.sheetWidth
  const pad = 40
  const fs = Math.max(L, W) / 60
  const selInst = sel.length === 1 ? instances.get(sel[0]) : undefined
  const selPl = sel.length === 1 ? sheet.placements.find((p) => p.uid === sel[0]) : undefined

  return (
    <div className="flex h-full flex-col" data-testid="nest-editor">
      <div className="flex flex-wrap items-center gap-2 border-b bg-background px-4 py-2 text-xs">
        <span className="font-semibold">Editing the layout</span>
        <div className="flex flex-wrap gap-1">
          {draft.map((s, i) => (
            <Button key={i} size="xs" variant={i === idx ? 'default' : 'outline'} onClick={() => (setIdx(i), setSel([]))}>
              Sheet {i + 1}
              <span className="opacity-70">({s.placements.length})</span>
            </Button>
          ))}
        </div>
        <span className="mx-1 h-4 w-px bg-border" />
        <Button size="xs" variant="outline" disabled={!sel.length} onClick={turn} title="Turn a quarter (R); a grain-locked part on a grained sheet turns end for end">
          <RotateCw /> Turn
        </Button>
        <Button size="xs" variant="outline" disabled={!sel.length} onClick={() => sel.forEach((u) => setPl(u, (p) => turnHalf(p)))}>
          End for end
        </Button>
        <select className="h-6 rounded border bg-background px-1" disabled={!sel.length} value="" onChange={(e) => e.target.value && moveTo(Number(e.target.value))} aria-label="Move to sheet">
          <option value="">Move to sheet…</option>
          {draft.map((s, i) => (i === idx || s.materialId !== sheet.materialId ? null : <option key={i} value={i}>Sheet {i + 1}</option>))}
        </select>
        <Button size="xs" variant="outline" disabled={!sel.length} onClick={() => moveTo('new')}>
          <SplitSquareHorizontal /> New sheet
        </Button>
        <label className="flex items-center gap-1.5">
          <Switch checked={snap} onCheckedChange={setSnap} /> Snap
        </label>
        <Button size="xs" variant="ghost" disabled={!history.length} onClick={() => (setDraft(history[history.length - 1]), setHistory((h) => h.slice(0, -1)))}>
          <Undo2 /> Undo
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <input ref={fileIn} type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && void loadList(e.target.files[0])} />
          <Button size="xs" variant="ghost" onClick={() => fileIn.current?.click()}>
            <FileUp /> Load nest list
          </Button>
          <Button size="xs" variant="ghost" onClick={() => void exportList()}>
            <FileDown /> Save nest list
          </Button>
          <Button size="xs" variant="outline" onClick={onClose}>
            <X /> Cancel
          </Button>
          <Button size="xs" onClick={save}>
            <Save /> Save layout
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        <div className="min-h-[320px] min-w-0 flex-1 p-4" tabIndex={0} onKeyDown={key} aria-label="Sheet layout editor">
          <svg viewBox={`${-pad} ${-pad} ${L + 2 * pad} ${W + 2 * pad}`} className="h-full w-full touch-none select-none" onPointerMove={move} onPointerUp={up} onClick={() => !drag.current && setSel([])}>
            <g ref={layer} transform={`translate(0 ${W}) scale(1 -1)`}>
              <rect x={0} y={0} width={L} height={W} fill="#f7f3ea" stroke="#8a7f6c" strokeWidth={3} />
              <rect x={trim} y={trim} width={L - 2 * trim} height={W - 2 * trim} fill="none" stroke="#a8a29e" strokeWidth={2} strokeDasharray="12 8" />
              {sheet.placements.map((p) => {
                const inst = instances.get(p.uid)
                if (!inst) return null
                const r = regionOnSheet(inst, p)
                const on = sel.includes(p.uid)
                return (
                  <g key={p.uid} onPointerDown={(e) => down(e, p.uid)} onClick={(e) => e.stopPropagation()} className="cursor-move" data-uid={p.uid}>
                    <polygon points={r.outline.map((q) => `${q.x},${q.y}`).join(' ')} fill={bad.has(p.uid) ? '#fecaca' : on ? '#fde68a' : warn.has(p.uid) ? '#fef3c7' : '#dbeafe'} stroke={bad.has(p.uid) ? '#dc2626' : on ? '#b45309' : '#475569'} strokeWidth={bad.has(p.uid) || on ? 6 : 2} />
                    {r.holes.map((h, k) => (
                      <polygon key={k} points={h.map((q) => `${q.x},${q.y}`).join(' ')} fill="#f7f3ea" stroke="#475569" strokeWidth={2} />
                    ))}
                  </g>
                )
              })}
            </g>
            {sheet.placements.map((p) => {
              const inst = instances.get(p.uid)
              if (!inst) return null
              const f = footprint(inst, p.rotated)
              return (
                <text key={p.uid} x={p.x + f.dx / 2} y={W - (p.y + f.dy / 2) + fs * 0.35} textAnchor="middle" fontSize={fs} fontWeight={700} fill="#0f172a" pointerEvents="none" fontFamily="Geist Variable, sans-serif">
                  {inst.no}
                </text>
              )
            })}
          </svg>
        </div>
        <div className="w-full shrink-0 overflow-auto border-t bg-background p-4 text-xs xl:w-80 xl:border-t-0 xl:border-l">
          {selInst && selPl ? (
            <div className="mb-3 flex flex-col gap-1">
              <div className="font-semibold">
                #{selInst.no} {selInst.part.name}
              </div>
              <div className="font-mono text-muted-foreground">
                X {selPl.x} · Y {selPl.y} · {selPl.rotated ? 'turned 90°' : 'not turned'}
                {selPl.flip ? ', end for end' : ''}
              </div>
              <div className="text-muted-foreground">{!selInst.canRotate && grain ? 'Grain-locked: turns end for end only.' : 'Drag to move, R to turn, arrow keys nudge 1 mm (Shift 10 mm).'}</div>
            </div>
          ) : (
            <p className="mb-3 text-muted-foreground">Drag parts to move them; they snap to the nest spacing beside their neighbours, in line with their edges, and to the trim. Shift-click to pick several, then move them to another sheet or a new one.</p>
          )}
          <div className="mb-1 font-semibold">Live check</div>
          {clashes.length ? (
            <ul className="flex flex-col gap-1">
              {clashes
                .filter((c, i, a) => !c.other || a.findIndex((x) => x.uid === c.other && x.other === c.uid) > i || !a.some((x) => x.uid === c.other && x.other === c.uid))
                .map((c, i) => (
                  <li key={i} className={cn('rounded border px-2 py-1', c.kind === 'spacing' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-red-200 bg-red-50 text-red-900')}>
                    #{no(c.uid)} {KIND[c.kind]}
                    {c.other ? ` #${no(c.other)}` : ''}
                  </li>
                ))}
            </ul>
          ) : (
            <p className="text-emerald-700">No overlaps, spacing, trim or grain problems on this sheet.</p>
          )}
          <p className="mt-3 text-muted-foreground">Saving uses this layout for the programs, labels and the export checker. Parts added to the job later are nested after these sheets; parts removed are listed as missing.</p>
        </div>
      </div>
    </div>
  )
}
