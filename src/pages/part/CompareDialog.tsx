/**
 * Part compare for several parts at once (M3.6, SIM-04): each chosen part's operations calculated,
 * its program simulated to the end and the stock compared with its 3D models, in the background,
 * one part after another; a row per part with the deepest gouge, the most material left, the share
 * within the tolerance and a small top view of the colour map.
 */
import { GitCompare } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { compareColor, DEFAULT_COMPARE } from '@/cam/compare/compare'
import type { PartCompare } from '@/cam/compare/parts'
import type { Mesh } from '@/cam/mesh/types'
import type { CamPart } from '@/cam/types'
import { compute } from '@/cam/worker/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Cancelled } from '@/core/cancel'
import { formatLength } from '@/core/units'
import type { MachineProfile, UnitSystem } from '@/core/types'
import { cn } from '@/lib/utils'
import { loadModelMesh } from './modelData'

type Row = { id: string; name: string; state: 'waiting' | 'running' | 'done' | 'error'; fraction: number; r?: PartCompare; error?: string }

function Thumb({ r }: { r: PartCompare }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    c.width = r.thumb.w
    c.height = r.thumb.h
    const ctx = c.getContext('2d')
    if (!ctx) return
    const img = ctx.createImageData(r.thumb.w, r.thumb.h)
    img.data.set(r.thumb.rgba)
    ctx.putImageData(img, 0, 0)
  }, [r])
  return <canvas ref={ref} className="h-auto w-32 rounded border border-white/10 [image-rendering:pixelated]" aria-label="Colour map seen from above" />
}

export function CompareDialog({ open, onOpenChange, parts, machine, units, onOpen }: { open: boolean; onOpenChange: (o: boolean) => void; parts: CamPart[]; machine: MachineProfile; units: UnitSystem; onOpen: (id: string) => void }) {
  const fmt = (n: number) => formatLength(n, units)
  const withModels = parts.filter((p) => p.models?.some((m) => m.visible !== false))
  const [chosen, setChosen] = useState<string[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const abort = useRef<AbortController | null>(null)
  const running = rows.some((r) => r.state === 'running' || r.state === 'waiting')
  useEffect(() => () => abort.current?.abort(), [])

  const start = async () => {
    abort.current?.abort()
    const a = new AbortController()
    abort.current = a
    const list = withModels.filter((p) => chosen.includes(p.id))
    setRows(list.map((p) => ({ id: p.id, name: p.name, state: 'waiting', fraction: 0 })))
    const set = (id: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    for (const p of list) {
      if (a.signal.aborted) return
      set(p.id, { state: 'running' })
      try {
        const meshes: Record<string, Mesh> = {}
        for (const m of p.models ?? []) if (!meshes[m.blob]) meshes[m.blob] = await loadModelMesh(m.blob)
        const ops = p.ops.filter((o) => o.enabled).map((o) => o.id)
        const toolpaths = await compute().run('cam.generate', { part: p, machine, opIds: ops, meshes }, { signal: a.signal, onProgress: (f) => set(p.id, { fraction: f * 0.5 }) })
        const r = await compute().run('sim.compare', { part: p, toolpaths, machine, meshes, opt: DEFAULT_COMPARE }, { signal: a.signal, onProgress: (f) => set(p.id, { fraction: 0.5 + f * 0.5 }) })
        set(p.id, { state: 'done', fraction: 1, r })
      } catch (e) {
        if (e instanceof Cancelled || a.signal.aborted) return
        set(p.id, { state: 'error', error: e instanceof Error ? e.message : String(e) })
      }
    }
  }

  const red = compareColor(-DEFAULT_COMPARE.range)!
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : (abort.current?.abort(), onOpenChange(false)))}>
      <DialogContent className="dark max-h-[92vh] overflow-y-auto border-white/10 bg-[#15171c] text-stone-100 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompare className="size-4" /> Compare parts with their models
          </DialogTitle>
          <DialogDescription className="text-stone-400">Each part's operations are calculated, its program simulated to the end, and the finished stock compared with the part's 3D models: gouges (cut into the model) red, material left blue, within ±{fmt(DEFAULT_COMPARE.tol)} green. A check of our own toolpaths, not of the machine.</DialogDescription>
        </DialogHeader>
        {!withModels.length ? (
          <p className="rounded-md border border-white/10 bg-white/5 p-4 text-center text-sm text-stone-400">No part here has a 3D model to compare with. Import a model or a solid on a part's 3D tab.</p>
        ) : (
          <div className="flex flex-col gap-3 text-xs">
            <div className="flex flex-wrap gap-2">
              {withModels.map((p) => (
                <label key={p.id} className={cn('flex items-center gap-1.5 rounded-md border px-2 py-1', chosen.includes(p.id) ? 'border-sky-400/50 bg-sky-400/10' : 'border-white/10')}>
                  <input type="checkbox" checked={chosen.includes(p.id)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, p.id] : c.filter((x) => x !== p.id)))} />
                  {p.name}
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setChosen(withModels.map((p) => p.id))}>
                All
              </Button>
              <Button size="sm" onClick={start} disabled={!chosen.length || running}>
                Compare {chosen.length || ''} part{chosen.length === 1 ? '' : 's'}
              </Button>
              {running && (
                <Button size="sm" variant="ghost" onClick={() => abort.current?.abort()}>
                  Stop
                </Button>
              )}
            </div>
            {rows.length > 0 && (
              <table className="w-full border-collapse text-left" data-testid="compare-table">
                <thead className="text-stone-400">
                  <tr className="border-b border-white/10">
                    <th className="py-1 pr-2 font-medium">Part</th>
                    <th className="py-1 pr-2 font-medium">Top view</th>
                    <th className="py-1 pr-2 font-medium">Deepest gouge</th>
                    <th className="py-1 pr-2 font-medium">Most left</th>
                    <th className="py-1 pr-2 font-medium">Within</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const s = r.r?.summary
                    return (
                      <tr key={r.id} className="border-b border-white/5 align-top">
                        <td className="py-1.5 pr-2">{r.name}</td>
                        <td className="py-1.5 pr-2">{r.r ? <Thumb r={r.r} /> : r.state === 'error' ? <span className="text-red-200">{r.error}</span> : <span className="text-stone-400">{r.state === 'running' ? `${Math.round(r.fraction * 100)}%` : 'waiting'}</span>}</td>
                        <td className="py-1.5 pr-2">{s ? s.gouge ? <Badge className="h-4 px-1 text-[10px]" style={{ background: `rgb(${red.join(',')})` }}>{fmt(s.gouge.depth)}</Badge> : <span className="text-emerald-300">none</span> : ''}</td>
                        <td className="py-1.5 pr-2">{s ? (s.left ? fmt(s.left.depth) : 'none') : ''}</td>
                        <td className="py-1.5 pr-2">{s ? `${((s.within / Math.max(1, s.compared)) * 100).toFixed(1)}%` : ''}{r.r?.notes.length ? <div className="text-amber-200">{r.r.notes.join(' ')}</div> : null}</td>
                        <td className="py-1.5">
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => onOpen(r.id)}>
                            Open
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
