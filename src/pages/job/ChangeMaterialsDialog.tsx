/**
 * Job-1: "Change materials" on the job's Cabinets tab: new boards per role and bands per group for the
 * whole job or chosen cabinets, a preview of what changes (parts, sheets, warnings), then one step to
 * apply it and one to undo it.
 */
import { ArrowRight, Eye, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/app/store'
import { SelectField } from '@/components/fields'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { BLUM } from '@/core/hardware/specs'
import {
  BAND_GROUP_LABEL,
  BAND_GROUPS,
  boxBoardNote,
  cabinetWalls,
  MATERIAL_ROLE_LABEL,
  MATERIAL_ROLES,
  previewSwap,
  rolesOf,
  swapIsEmpty,
  WALL_LABEL,
  type BandGroup,
  type MaterialRole,
  type MaterialSwap,
  type SwapPreview,
  type WallChoice,
} from '@/core/jobMaterials'
import { countOf } from '@/components/kindLabel'
import type { AppData, Job, Part } from '@/core/types'
import { formatDims } from '@/core/units'
import { cn } from '@/lib/utils'

const KEEP = '__keep'
const NONE = '__none'

export function ChangeMaterialsDialog({ job, data, open, onOpenChange }: { job: Job; data: AppData; open: boolean; onOpenChange: (o: boolean) => void }) {
  const swapMaterials = useStore((s) => s.swapMaterials)
  const undoMaterials = useStore((s) => s.undoMaterials)
  const lib = data.library
  const [mats, setMats] = useState<Partial<Record<MaterialRole, string>>>({})
  const [bands, setBands] = useState<Partial<Record<BandGroup, string | null>>>({})
  const [all, setAll] = useState(true)
  const [chosen, setChosen] = useState<string[]>([])
  const [replace, setReplace] = useState(false)
  const [preview, setPreview] = useState<SwapPreview | null>(null)
  const walls = useMemo(() => cabinetWalls(job, lib), [job, lib])
  const swap: MaterialSwap = { materials: mats, edgebands: bands, scope: all ? 'all' : chosen, replaceOverrides: replace }
  const code = (id: string | null | undefined) => (id ? (lib.materials.find((m) => m.id === id)?.code ?? lib.edgebands.find((e) => e.id === id)?.code ?? id) : 'none')
  const reset = () => setPreview(null)

  // what the cabinets use now, per role ("PB18-WHT ×4, MDF18 ×1")
  const inUse = (r: MaterialRole) => {
    const n = new Map<string, number>()
    // drawer boxes: only the cabinets that have drawers
    for (const c of job.cabinets) {
      if (r === 'boxes' && (c.params.panel || !(c.params.drawers.count > 0))) continue
      n.set(rolesOf(c.params, lib)[r], (n.get(rolesOf(c.params, lib)[r]) ?? 0) + 1)
    }
    return [...n.entries()].map(([id, k]) => `${code(id)} ×${k}`).join(', ')
  }
  const bandInUse = (g: BandGroup) => {
    const n = new Map<string, number>()
    for (const c of job.cabinets) n.set(code(c.params.edgebands[g]), (n.get(code(c.params.edgebands[g])) ?? 0) + 1)
    return [...n.entries()].map(([id, k]) => `${id} ×${k}`).join(', ')
  }
  const matOptions = (r: MaterialRole) => [
    { value: KEEP, label: 'Keep as is' },
    ...lib.materials.map((m) => {
      const note = r === 'boxes' ? boxBoardNote(m, BLUM.maxSideThickness) : null
      return { value: m.id, label: `${m.code} · ${m.name}${note ? ` (${note})` : ''}` }
    }),
  ]
  const bandOptions = [{ value: KEEP, label: 'Keep as is' }, { value: NONE, label: 'No band' }, ...lib.edgebands.map((e) => ({ value: e.id, label: `${e.code} · ${e.name}` }))]
  const toggle = (id: string, on: boolean) => {
    setChosen((c) => (on ? [...new Set([...c, id])] : c.filter((x) => x !== id)))
    reset()
  }
  const wallChoices = (['back', 'left', 'right', 'none'] as WallChoice[]).filter((w) => job.cabinets.some((c) => walls[c.id] === w))
  const empty = swapIsEmpty(swap) || (!all && chosen.length === 0)

  const apply = () => {
    const n = swapMaterials(job.id, swap)
    onOpenChange(false)
    setPreview(null)
    if (!n) return toast.info('Nothing to change: the cabinets already use these materials.')
    toast.success(`Materials changed: ${countOf(preview?.cabinets ?? 0, 'cabinet')}, ${countOf(preview?.parts.length ?? 0, 'part')}`, {
      description: 'One undo puts every change back.',
      duration: 12000,
      action: {
        label: 'Undo',
        onClick: () => {
          const r = undoMaterials()
          if (r) toast.success(`Material change undone${r.skipped ? ` (${countOf(r.skipped, 'setting')} changed since left as is)` : ''}`)
        },
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setPreview(null) }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl" data-testid="change-materials">
        <DialogHeader>
          <DialogTitle>Change materials</DialogTitle>
          <DialogDescription>New boards and edgebands for the whole job or chosen cabinets. Anything left at “Keep as is” is not touched. Check the preview, then apply; one undo puts it all back.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <div className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Boards</div>
            {MATERIAL_ROLES.map((r) => (
              <SelectField
                key={r}
                label={MATERIAL_ROLE_LABEL[r]}
                value={mats[r] ?? KEEP}
                options={matOptions(r)}
                onChange={(v) => { setMats((m) => { const n = { ...m }; if (v === KEEP) delete n[r]; else n[r] = v; return n }); reset() }}
                hint={`Now: ${inUse(r) || '—'}${r === 'boxes' ? `. Blum TANDEM takes drawer sides up to ${BLUM.maxSideThickness} mm; only cabinets with drawers use it.` : ''}`}
              />
            ))}
            <div className="pt-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Edgebands</div>
            {BAND_GROUPS.map((g) => (
              <SelectField
                key={g}
                label={BAND_GROUP_LABEL[g]}
                value={g in bands ? (bands[g] ?? NONE) : KEEP}
                options={bandOptions}
                onChange={(v) => { setBands((b) => { const n = { ...b }; if (v === KEEP) delete n[g]; else n[g] = v === NONE ? null : v; return n }); reset() }}
                hint={`Now: ${bandInUse(g) || '—'}`}
              />
            ))}
          </div>

          <div className="flex flex-col gap-3">
            <div className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Cabinets</div>
            <div className="flex gap-2">
              <Button size="sm" variant={all ? 'default' : 'outline'} onClick={() => { setAll(true); reset() }}>All cabinets ({job.cabinets.length})</Button>
              <Button size="sm" variant={!all ? 'default' : 'outline'} onClick={() => { setAll(false); reset() }}>Chosen cabinets{!all ? ` (${chosen.length})` : ''}</Button>
            </div>
            {!all && (
              <>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">Select by wall:</span>
                  {wallChoices.map((w) => (
                    <Button key={w} size="xs" variant="outline" onClick={() => { setChosen((c) => [...new Set([...c, ...job.cabinets.filter((x) => walls[x.id] === w).map((x) => x.id)])]); reset() }}>
                      {WALL_LABEL[w]}
                    </Button>
                  ))}
                  <Button size="xs" variant="ghost" onClick={() => { setChosen([]); reset() }}>Clear</Button>
                </div>
                <div className="max-h-64 overflow-y-auto rounded-md border">
                  {job.cabinets.map((c) => (
                    <label key={c.id} className="flex cursor-pointer items-center gap-2 border-b px-2 py-1.5 text-xs last:border-b-0 hover:bg-muted/40">
                      <Checkbox checked={chosen.includes(c.id)} onCheckedChange={(v) => toggle(c.id, v === true)} />
                      <span className="rounded bg-stone-800 px-1 py-0.5 font-mono text-[10px] text-white">{c.number}</span>
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <span className="text-[10px] text-muted-foreground">{WALL_LABEL[walls[c.id]]}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
            <label className="mt-1 flex items-start gap-2 text-sm">
              <Checkbox className="mt-0.5" checked={replace} onCheckedChange={(v) => { setReplace(v === true); reset() }} />
              <span>
                Also replace part overrides
                <span className="block text-[11px] text-muted-foreground">A board or band set by hand on a single part (cabinet editor) is kept unless this is ticked; ticked, those parts follow the new choice.</span>
              </span>
            </label>
          </div>
        </div>

        {preview && <PreviewPanel preview={preview} data={data} code={code} />}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="outline" disabled={empty} onClick={() => setPreview(previewSwap(job, swap, data))}>
            <Eye /> Preview
          </Button>
          <Button disabled={empty || !preview || preview.changes.length === 0} onClick={apply} title={preview ? undefined : 'Preview first'}>
            Apply{preview ? ` to ${countOf(preview.cabinets, 'cabinet')}` : ''}
          </Button>
        </DialogFooter>
        {!preview && !empty && <p className="-mt-2 text-right text-[11px] text-muted-foreground">Preview first: it shows every part that changes before anything is applied.</p>}
      </DialogContent>
    </Dialog>
  )
}

function PreviewPanel({ preview: p, data, code }: { preview: SwapPreview; data: AppData; code: (id: string | null | undefined) => string }) {
  const units = data.settings.units
  // only the edges that change, grouped: "L1 L2 W1 W2 EB-WHT-1.0 → EB-OAK-1.0"
  const edgeDiff = (a: Part['edges'], b: Part['edges']) => {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])] as (keyof Part['edges'])[]
    const groups = new Map<string, string[]>()
    for (const k of keys) {
      if ((a[k] ?? null) === (b[k] ?? null)) continue
      const g = `${a[k] ? code(a[k]) : 'raw'} → ${b[k] ? code(b[k]) : 'raw'}`
      groups.set(g, [...(groups.get(g) ?? []), k])
    }
    return [...groups.entries()].map(([g, ks]) => `${ks.join(' ')} ${g}`).join('; ')
  }
  if (p.changes.length === 0) return <div className="rounded-md border bg-muted/30 p-3 text-sm">Nothing changes: the chosen cabinets already use these materials.</div>
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 text-sm" data-testid="materials-preview">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-semibold">Preview</span>
        <span>{countOf(p.cabinets, 'cabinet')} · {countOf(p.parts.length, 'part')} change</span>
        <span>
          Sheets (automatic nest, estimate): <span className="font-mono">{p.sheets.before}</span> <ArrowRight className="inline size-3" /> <span className="font-mono">{p.sheets.after}</span>
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        {p.boards.map((b) => (
          <Badge key={b.from + b.to} variant="outline" className="font-mono">{code(b.from)} → {code(b.to)} · {b.parts}</Badge>
        ))}
        {p.sheets.byMaterial.filter((m) => m.before !== m.after).map((m) => (
          <Badge key={m.materialId} variant="outline" className="bg-background font-mono">{code(m.materialId)} sheets {m.before} → {m.after}</Badge>
        ))}
      </div>
      {p.newWarnings.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950" data-testid="materials-warnings">
          <div className="mb-1 flex items-center gap-1.5 font-medium"><TriangleAlert className="size-3.5" /> This change brings {countOf(p.newWarnings.length, 'warning')} (the same checks as the cabinet editor and the export check):</div>
          <ul className="list-disc pl-5">{p.newWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      {p.clearedWarnings.length > 0 && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-950">
          Clears {countOf(p.clearedWarnings.length, 'warning')}: {p.clearedWarnings.join(' ')}
        </div>
      )}
      {p.keptOverrides.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Kept as set by hand (tick “Also replace part overrides” to change them too): {p.keptOverrides.map((k) => `${k.cabinetNumber} ${k.part} (${k.what})`).join(', ')}.
        </div>
      )}
      {p.savedLayoutParts > 0 && (
        <div className="rounded-md border border-sky-300 bg-sky-50 p-2 text-xs text-sky-950">
          The job has a layout saved by hand: {countOf(p.savedLayoutParts, 'part')} on it change board. As for any material change, they are flagged on the Nesting tab and nested again on the new board.
        </div>
      )}
      <div className="max-h-64 overflow-y-auto rounded-md border bg-background">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-background text-[10px] text-muted-foreground">
            <tr className="border-b">
              <th className="px-2 py-1 text-left font-medium">Cabinet</th>
              <th className="px-2 py-1 text-left font-medium">Part</th>
              <th className="px-2 py-1 text-left font-medium">Board</th>
              <th className="px-2 py-1 text-left font-medium">Edges</th>
              <th className="px-2 py-1 text-left font-medium">Size</th>
            </tr>
          </thead>
          <tbody>
            {p.parts.map((r) => (
              <tr key={r.cabinetId + r.key} className="border-b last:border-b-0">
                <td className="px-2 py-1 font-mono">{r.cabinetNumber}{r.qty > 1 ? ` ×${r.qty}` : ''}</td>
                <td className="px-2 py-1">{r.name}</td>
                <td className={cn('px-2 py-1 font-mono whitespace-nowrap', !r.materialChanged && 'text-muted-foreground')}>{r.materialChanged ? `${code(r.before.materialId)} → ${code(r.after.materialId)}` : code(r.after.materialId)}</td>
                <td className={cn('px-2 py-1 font-mono text-[11px]', !r.edgesChanged && 'text-muted-foreground')}>{r.edgesChanged ? edgeDiff(r.before.edges, r.after.edges) : '—'}</td>
                <td className={cn('px-2 py-1 font-mono text-[11px]', !r.sizeChanged && 'text-muted-foreground')}>{r.sizeChanged ? `${formatDims(r.before.size, units)} → ${formatDims(r.after.size, units)}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
