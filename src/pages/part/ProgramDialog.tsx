import { FileCode2, ShieldAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { writePartPrograms } from '@/cam/mpr'
import { readMpr, type MprMacro } from '@/cam/mprRead'
import type { Toolpath } from '@/cam/toolpath'
import type { CamPart } from '@/cam/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { MachineProfile } from '@/core/types'
import { cn } from '@/lib/utils'

const MACRO: Record<number, { name: string; keys: string[] }> = {
  100: { name: 'Workpiece', keys: ['LA', 'BR', 'DI'] },
  101: { name: 'Comment', keys: ['KM'] },
  102: { name: 'Vertical drilling', keys: ['XA', 'YA', 'DU', 'TNO', 'TI', 'BM'] },
  103: { name: 'Horizontal drilling', keys: ['XA', 'YA', 'ZA', 'DU', 'TNO', 'TI', 'BM'] },
  105: { name: 'Contour milling', keys: ['EA', 'EE', 'RK', 'TNO', 'ZA', 'MDA'] },
  109: { name: 'Saw groove', keys: ['XA', 'YA', 'XE', 'YE', 'TI', 'T_'] },
  112: { name: 'Pocket', keys: ['XA', 'YA', 'LA', 'BR', 'RD', 'TI', 'T_'] },
}

export function ProgramDialog({ open, onOpenChange, part, toolpaths, machine, materialCode, outputOn }: { open: boolean; onOpenChange: (o: boolean) => void; part: CamPart; toolpaths: Toolpath[]; machine: MachineProfile; materialCode: string; outputOn: boolean }) {
  const files = useMemo(() => (open ? writePartPrograms(part, toolpaths, machine, materialCode, { withCutout: false }) : []), [open, part, toolpaths, machine, materialCode])
  const [sel, setSel] = useState(0)
  const [raw, setRaw] = useState(false)
  const file = files[Math.min(sel, files.length - 1)]
  const doc = useMemo(() => (file ? readMpr(file.text) : null), [file])
  const rows = (doc?.macros ?? []).filter((m) => m.id !== 100 && !(m.id === 101 && m.values.KM?.startsWith('HOMAG_')))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dark border-white/10 bg-[#15171c] text-stone-100 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCode2 className="size-4" /> woodWOP program preview
          </DialogTitle>
          <DialogDescription className="text-stone-400">Native macros this part produces. Each one opens in woodWOP as an editable macro, not a point list.</DialogDescription>
        </DialogHeader>
        <div className={cn('flex items-start gap-2 rounded-md border p-2.5 text-xs', outputOn ? 'border-amber-400/30 bg-amber-400/10 text-amber-100' : 'border-white/10 bg-white/5 text-stone-300')}>
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            {outputOn
              ? 'Custom-part output is on. Programs are exported from the job’s Output tab, after the export checker. Not machine-proven: simulate in woodWOP first.'
              : 'Custom-part output is off (Machine & tools → Custom-part features), so the job’s MPR export is blocked for parts with machining. This preview is for checking only.'}
            {machine.placeholder && ' Tool numbers are placeholders.'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {files.map((f, i) => (
            <Button key={f.name} size="sm" variant={i === sel ? 'secondary' : 'ghost'} className="h-7 font-mono text-xs" onClick={() => setSel(i)}>
              {f.name}
              {f.side === 'back' && <Badge className="ml-1 h-4 bg-sky-500/20 px-1 text-[10px] text-sky-200">turned over</Badge>}
            </Button>
          ))}
          <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={() => setRaw((r) => !r)}>
            {raw ? 'Macro list' : 'Plain text'}
          </Button>
        </div>
        {raw ? (
          <pre className="max-h-[55vh] overflow-auto rounded-md bg-black/50 p-3 font-mono text-[11px] leading-relaxed text-stone-200">{file?.text}</pre>
        ) : (
          <div className="max-h-[55vh] overflow-auto rounded-md border border-white/10">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#1b1e24] text-left text-stone-400">
                <tr>
                  <th className="px-2 py-1.5 font-medium">#</th>
                  <th className="px-2 py-1.5 font-medium">Macro</th>
                  <th className="px-2 py-1.5 font-medium">Parameters</th>
                  <th className="px-2 py-1.5 font-medium">Label</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rows.map((m, i) => (
                  <MacroRow key={i} n={i + 1} m={m} />
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={4} className="px-2 py-6 text-center text-stone-500">
                      No machining yet. Add operations on the Machining tab.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {doc && doc.errors.length > 0 && <p className="text-xs text-red-300">Structure check: {doc.errors.join(' ')}</p>}
      </DialogContent>
    </Dialog>
  )
}

function MacroRow({ n, m }: { n: number; m: MprMacro }) {
  const def = MACRO[m.id]
  return (
    <tr className="align-top">
      <td className="px-2 py-1.5 text-stone-500 tabular-nums">{n}</td>
      <td className="px-2 py-1.5 whitespace-nowrap">
        {def?.name ?? m.name}
        <span className="ml-1.5 font-mono text-[10px] text-stone-500">{m.name}</span>
      </td>
      <td className="px-2 py-1.5 font-mono text-[11px] text-stone-300">
        {(def?.keys ?? Object.keys(m.values).slice(0, 6))
          .filter((k) => m.values[k] !== undefined)
          .map((k) => `${k}=${m.values[k]}`)
          .join('  ')}
      </td>
      <td className="px-2 py-1.5 text-stone-400">{m.values.MNM ?? ''}</td>
    </tr>
  )
}
