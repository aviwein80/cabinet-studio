import { Boxes, FileUp, TriangleAlert } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/app/store'
import { applyRules, recipesOf, ruleSetsOf } from '@/cam/rules'
import type { AssemblyPart } from '@/cam/solid/assembly'
import { matchMaterial } from '@/cam/solid/material'
import type { SolidData } from '@/cam/solid/types'
import type { MeshUnits } from '@/cam/mesh/types'
import type { CamPart } from '@/cam/types'
import { compute, occtVendorUrl, solidCompute } from '@/cam/worker/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Cancelled } from '@/core/cancel'
import { featuresOf } from '@/core/features'
import type { UnitSystem } from '@/core/types'
import { formatLength } from '@/core/units'
import { TaskProgress } from '@/pages/part/ModelImportDialog'
import { UNIT_OPTIONS } from '@/pages/part/modelData'
import { drillSizes, saveSolidData, saveSolidFile } from '@/pages/part/solidData'

interface Row extends AssemblyPart {
  use: boolean
  materialId: string | null
}

/**
 * New custom parts from a solid file (STEP, IGES, BREP): each distinct body becomes a part, laid
 * flat with its features on layers; an assembly's repeated bodies become one part with a quantity
 * (SOL-01, SOL-04). The parts go into this list (a job's parts are nested with the job).
 */
export function SolidImportDialog({ open, onOpenChange, units, onImport }: { open: boolean; onOpenChange: (v: boolean) => void; units: UnitSystem; onImport: (parts: CamPart[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const lib = useStore((s) => s.data?.library)
  const machine = useStore((s) => s.data?.machine)
  const rulesOn = useStore((s) => featuresOf(s.data?.settings).camRules && featuresOf(s.data?.settings).camMachining)
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null)
  const [fileUnits, setFileUnits] = useState<MeshUnits | 'file'>('file')
  const [solid, setSolid] = useState<SolidData | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [rules, setRules] = useState(true)
  const [busy, setBusy] = useState<{ fraction: number; note?: string; abort: AbortController } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fmt = (n: number) => formatLength(n, units)
  const materials = lib?.materials ?? []

  const read = async (f: { name: string; bytes: Uint8Array }, u = fileUnits) => {
    setFile(f)
    setSolid(null)
    setRows([])
    setError(null)
    const abort = new AbortController()
    const onProgress = (fraction: number, note?: string) => setBusy({ fraction, note, abort })
    setBusy({ fraction: 0, note: 'Reading the solid', abort })
    try {
      const s = await solidCompute().run('solid.import', { bytes: f.bytes.slice(), name: f.name, units: u === 'file' ? undefined : u, vendor: occtVendorUrl() }, { signal: abort.signal, onProgress })
      setSolid(s)
      const parts = await compute().run('solid.assembly', { solid: s, opt: drillSizes(machine) }, { signal: abort.signal, onProgress })
      setRows(parts.map((p) => ({ ...p, use: !p.error, materialId: matchMaterial(p.properties, materials) })))
    } catch (e) {
      if (!(e instanceof Cancelled)) setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const add = async () => {
    if (!solid || !file) return
    const chosen = rows.filter((r) => r.use && !r.error)
    const abort = new AbortController()
    const made: CamPart[] = []
    try {
      setBusy({ fraction: 0, note: 'Storing the file', abort })
      const fileHash = await saveSolidFile(file.bytes)
      for (const [i, r] of chosen.entries()) {
        if (abort.signal.aborted) throw new Cancelled()
        setBusy({ fraction: (i + 0.2) / chosen.length, note: `${r.name}: storing`, abort })
        const one: SolidData = { ...solid, bodies: solid.bodies.filter((b) => b.index === r.bodies[0]) }
        const blob = await saveSolidData(one)
        setBusy({ fraction: (i + 0.6) / chosen.length, note: `${r.name}: features`, abort })
        const res = await compute().run('solid.part', { solid: one, opt: { body: r.bodies[0], blob, file: fileHash, source: file.name, name: r.name, qty: r.qty, materialId: r.materialId, ...drillSizes(machine) } }, { signal: abort.signal })
        let part = res.part
        if (rules && rulesOn && lib) {
          const set = ruleSetsOf(lib)[0]
          if (set) part = applyRules(part, set, recipesOf(lib)).part
        }
        made.push(part)
      }
      onImport(made)
      toast.success(`${made.length} part${made.length === 1 ? '' : 's'} added`, { description: `${made.reduce((n, p) => n + p.qty, 0)} pieces in total from ${file.name}` })
      onOpenChange(false)
    } catch (e) {
      if (!(e instanceof Cancelled)) toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const chosen = rows.filter((r) => r.use && !r.error)
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Boxes className="size-4" /> Import a solid model
          </DialogTitle>
          <DialogDescription>STEP (AP203, AP214, AP242), IGES or BREP. Each panel is laid flat (face 1 up, length along X); its outline, cut-outs, pockets and holes are found and put on layers the layer rules machine. Repeated bodies in an assembly become one part with a quantity.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <div className="flex flex-wrap items-end gap-2">
            <input ref={input} type="file" accept=".step,.stp,.iges,.igs,.brep" className="hidden" onChange={async (e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) await read({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })
              }} />
            <Button variant="outline" disabled={!!busy} onClick={() => input.current?.click()}>
              <FileUp /> Choose file
            </Button>
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">Drawn in</Label>
              <Select value={fileUnits} onValueChange={(v) => {
                  setFileUnits(v as MeshUnits | 'file')
                  if (file) void read(file, v as MeshUnits | 'file')
                }}>
                <SelectTrigger size="sm" className="w-48" aria-label="Units of the file">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="file">As the file says</SelectItem>
                  {UNIT_OPTIONS.map((u) => (
                    <SelectItem key={u.value} value={u.value}>
                      {u.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {file && <span className="truncate text-xs text-muted-foreground">{file.name}</span>}
            {solid && (
              <span className="flex flex-wrap gap-1">
                <Badge variant="outline">{solid.format.toUpperCase()}{solid.schema ? ` · ${solid.schema}` : ''}</Badge>
                <Badge variant="outline">{solid.bodies.length} bod{solid.bodies.length === 1 ? 'y' : 'ies'}</Badge>
                <Badge variant="outline">drawn in {solid.units}</Badge>
              </span>
            )}
          </div>
          {busy && <TaskProgress fraction={busy.fraction} note={busy.note} onCancel={() => busy.abort.abort()} />}
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {error}
            </div>
          )}
          {rows.length > 0 && (
            <div className="max-h-[50vh] overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Part</th>
                    <th className="px-2 py-1.5 text-left font-medium">Qty</th>
                    <th className="px-2 py-1.5 text-left font-medium">Size</th>
                    <th className="px-2 py-1.5 text-left font-medium">Found</th>
                    <th className="px-2 py-1.5 text-left font-medium">Material</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.name}-${r.bodies[0]}`} className="border-t align-top">
                      <td className="px-2 py-1.5">
                        <label className="flex items-center gap-2">
                          <Switch checked={r.use} disabled={!!r.error} onCheckedChange={(v) => set(i, { use: v })} aria-label={`Import ${r.name}`} />
                          <Input className="h-7 w-40 text-xs" value={r.name} aria-label="Part name" onChange={(e) => set(i, { name: e.target.value })} />
                        </label>
                        {Object.keys(r.properties).length > 0 && <div className="mt-1 text-[11px] text-muted-foreground">{Object.entries(r.properties).map(([k, v]) => `${k}: ${v}`).join(' · ')}</div>}
                        {r.error && <div className="mt-1 text-[11px] text-red-700">{r.error}</div>}
                        {r.warnings.map((w) => (
                          <div key={w} className="mt-1 text-[11px] text-amber-700">
                            {w}
                          </div>
                        ))}
                      </td>
                      <td className="px-2 py-1.5">
                        <Input className="h-7 w-14 text-xs" type="number" min={1} value={r.qty} aria-label="Quantity" onChange={(e) => set(i, { qty: Math.max(1, Math.round(Number(e.target.value) || 1)) })} />
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{r.error ? '—' : `${fmt(r.size[0])} × ${fmt(r.size[1])} × ${fmt(r.size[2])}`}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {r.holes} hole{r.holes === 1 ? '' : 's'}, {r.pockets} pocket{r.pockets === 1 ? '' : 's'}, {r.cutouts} cut-out{r.cutouts === 1 ? '' : 's'}
                      </td>
                      <td className="px-2 py-1.5">
                        <Select value={r.materialId ?? '__none__'} onValueChange={(v) => set(i, { materialId: v === '__none__' ? null : v })}>
                          <SelectTrigger size="sm" className="h-7 w-48 text-xs" aria-label="Material">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Not set</SelectItem>
                            {materials.map((m) => (
                              <SelectItem key={m.id} value={m.id}>
                                {m.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > 0 && rulesOn && (
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={rules} onCheckedChange={setRules} aria-label="Apply the layer rules" /> Apply the layer rules (operations for the found features)
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={!!busy} onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button disabled={!chosen.length || !!busy} onClick={() => void add()}>
            Add {chosen.length || ''} part{chosen.length === 1 ? '' : 's'} ({chosen.reduce((n, r) => n + r.qty, 0)} pieces)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
