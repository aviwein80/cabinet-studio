import { CirclePlay, FileSearch, FileUp, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/app/store'
import { newPart } from '@/cam/doc'
import type { ReadProgram } from '@/cam/programRead'
import { compute } from '@/cam/worker/client'
import { LenInput } from '@/components/LenInput'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatLength } from '@/core/units'
import { cn } from '@/lib/utils'
import { SimulateDialog } from './SimulateDialog'

/**
 * Read a program back (M2.10, NEW-22): a G-code program or one of our MPR files becomes toolpaths,
 * one per tool change, shown with what was read, then backplotted and simulated on a stock of the
 * size the program states (MPR) or reaches (G-code), which can be changed.
 */
export function ProgramReadDialog({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (o: boolean) => void; initial?: { name: string; text: string } | null }) {
  const data = useStore((s) => s.data)!
  const units = data.settings.units
  const fileRef = useRef<HTMLInputElement>(null)
  const [src, setSrc] = useState<{ name: string; text: string } | null>(initial ?? null)
  const [zAt, setZAt] = useState<'top' | 'bottom'>('top')
  const [read, setRead] = useState<ReadProgram | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState('')
  const [stock, setStock] = useState({ length: 0, width: 0, thickness: 0 })
  const [sim, setSim] = useState(false)

  useEffect(() => {
    if (open && initial) setSrc(initial)
  }, [open, initial])

  useEffect(() => {
    if (!src) return
    let live = true
    setBusy(true)
    setFailed('')
    // G-code with Z0 on the table: its top is the stock thickness (taken from a first reading)
    const run = async () => {
      const machine = { tools: data.machine.tools }
      let r = await compute().run('program.read', { text: src.text, machine })
      if (zAt === 'bottom' && r.format === 'gcode') r = await compute().run('program.read', { text: src.text, machine, zTop: stock.thickness || r.stock.thickness })
      return r
    }
    run().then(
      (r) => {
        if (!live) return
        setRead(r)
        setStock((s) => (r.stock.fromProgram || !s.length ? { length: r.stock.length, width: r.stock.width, thickness: r.stock.thickness } : s))
        setBusy(false)
      },
      (e: unknown) => {
        if (!live) return
        setFailed(e instanceof Error ? e.message : String(e))
        setBusy(false)
      },
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, zAt, data.machine.tools])

  const pick = async (f: File | undefined) => {
    if (!f) return
    // our MPR files are written in Latin-1; G-code is plain text
    const buf = new Uint8Array(await f.arrayBuffer())
    setRead(null)
    setStock({ length: 0, width: 0, thickness: 0 })
    setSrc({ name: f.name, text: new TextDecoder(/\.mprx?$/i.test(f.name) ? 'latin1' : 'utf-8').decode(buf) })
    if (fileRef.current) fileRef.current.value = ''
  }

  const part = newPart({ name: src?.name ?? 'Program', length: Math.max(1, stock.length), width: Math.max(1, stock.width), thickness: Math.max(1, stock.thickness), entities: [] })
  const tps = read?.toolpaths ?? []
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dark max-h-[94vh] overflow-y-auto border-white/10 bg-[#15171c] text-stone-100 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSearch className="size-4" /> Read a program
          </DialogTitle>
          <DialogDescription className="text-stone-400">A G-code program or one of our woodWOP MPR files, read back into toolpaths (one per tool change) for the backplot and the simulator. It checks our reading of the program, not the machine.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input ref={fileRef} type="file" accept=".nc,.tap,.gcode,.ngc,.cnc,.iso,.txt,.mpr" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
          <Button size="sm" variant="secondary" className="h-7 gap-1 text-xs" onClick={() => fileRef.current?.click()}>
            <FileUp className="size-3.5" /> {src ? 'Another program…' : 'Choose a program…'}
          </Button>
          {src && <span className="font-mono text-stone-300">{src.name}</span>}
          {busy && <Loader2 className="size-3.5 animate-spin text-stone-400" />}
        </div>
        {failed && <p className="text-xs text-red-300">{failed}</p>}
        {read && (
          <div className="flex flex-col gap-2 text-xs">
            <p className="text-stone-300">
              {read.format === 'mpr' ? 'woodWOP MPR' : 'G-code'} · {read.lines} lines · {tps.length} toolpath{tps.length === 1 ? '' : 's'} · {tps.reduce((n, t) => n + t.moves.length, 0)} moves
            </p>
            {read.errors.length > 0 && (
              <div className="rounded-md border border-red-400/30 bg-red-500/10 p-2 text-red-200">
                Not read (the backplot is wrong where these are):
                <ul className="list-disc pl-4">
                  {read.errors.slice(0, 12).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                  {read.errors.length > 12 && <li>… {read.errors.length - 12} more</li>}
                </ul>
              </div>
            )}
            {read.warnings.length > 0 && (
              <div className="rounded-md border border-amber-400/30 bg-amber-400/10 p-2 text-amber-100">
                <ul className="list-disc pl-4">
                  {read.warnings.slice(0, 12).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                  {read.warnings.length > 12 && <li>… {read.warnings.length - 12} more</li>}
                </ul>
              </div>
            )}
            <table className="w-full">
              <thead className="text-left text-stone-400">
                <tr>
                  <th className="py-1 font-medium">#</th>
                  <th className="py-1 font-medium">Toolpath</th>
                  <th className="py-1 font-medium">Tool</th>
                  <th className="py-1 text-right font-medium">Moves</th>
                  <th className="py-1 text-right font-medium">Cutting</th>
                  <th className="py-1 text-right font-medium">Minutes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {tps.map((t, i) => (
                  <tr key={t.opId}>
                    <td className="py-1 text-stone-500 tabular-nums">{i + 1}</td>
                    <td className="py-1">{t.name}</td>
                    <td className={cn('py-1', !t.tool && 'text-amber-300')}>{t.tool ? `T${t.tool.number} ${t.tool.name}` : 'not in the tool table'}</td>
                    <td className="py-1 text-right tabular-nums">{t.moves.length}</td>
                    <td className="py-1 text-right tabular-nums">{formatLength(t.stats.cut, units)}</td>
                    <td className="py-1 text-right tabular-nums">{t.stats.minutes.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ['length', 'Stock length (X)'],
                  ['width', 'Stock width (Y)'],
                  ['thickness', 'Thickness'],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="flex flex-col gap-1 text-stone-400">
                  {label}
                  <LenInput label={label} value={stock[k]} units={units} onChange={(v) => setStock((s) => ({ ...s, [k]: v }))} />
                </label>
              ))}
            </div>
            {read.format === 'gcode' ? (
              <label className="flex items-center gap-2 text-stone-300">
                Z0 of the program is
                <select aria-label="Z0 of the program" className="h-7 rounded-md border border-white/15 bg-transparent px-1.5" value={zAt} onChange={(e) => setZAt(e.target.value as 'top' | 'bottom')}>
                  <option value="top" className="bg-[#15171c]">
                    the top of the stock
                  </option>
                  <option value="bottom" className="bg-[#15171c]">
                    the table (bottom of the stock)
                  </option>
                </select>
                <span className="text-stone-500">{read.stock.fromProgram ? '' : 'Stock size: as far as the cutting moves reach; change it if the part is bigger.'}</span>
              </label>
            ) : (
              <p className="text-stone-500">Stock size from the program's workpiece.</p>
            )}
            <div className="flex justify-end">
              <Button size="sm" className="gap-1.5" disabled={!tps.length} onClick={() => setSim(true)}>
                <CirclePlay className="size-3.5" /> Simulate
              </Button>
            </div>
          </div>
        )}
        <SimulateDialog open={sim} onOpenChange={setSim} part={part} toolpaths={tps} machine={data.machine} units={units} />
      </DialogContent>
    </Dialog>
  )
}
