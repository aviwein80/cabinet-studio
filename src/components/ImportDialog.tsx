import { FileUp } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { profileOf } from '@/core/machines'
import { useStore } from '@/app/store'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  guessKind,
  importEdgebands,
  importHardware,
  importMaterials,
  importTemplates,
  importTools,
  rowsFromFile,
  type ImportKind,
  type ImportResult,
  type Row,
} from '@/core/library/import'
import type { AppData, UnitSystem } from '@/core/types'

const KIND_LABEL: Record<ImportKind, string> = {
  materials: 'Sheet materials',
  edgebands: 'Edgebands',
  hardware: 'Hardware',
  templates: 'Cabinet templates',
  tools: 'Machine tools',
}

const COLUMNS: Record<ImportKind, string> = {
  materials: 'code, name, thickness, sheetLength, sheetWidth, grain (yes/no), color',
  edgebands: 'code, name, thickness, width, color',
  hardware: 'code, name, category (hinge, mounting-plate, slide, shelf-pin, connector, dowel, screw, leg, other)',
  templates: 'name, kind (base/wall/tall), width, height, depth, shelves, doors, material, backMaterial, joinery, bottomJoint, backType',
  tools: 'number, type (router, drill-vertical, drill-horizontal, saw), name, diameter, maxDepth',
}

function run(kind: ImportKind, rows: Row[], d: AppData, units: UnitSystem): ImportResult<unknown> {
  switch (kind) {
    case 'materials':
      return importMaterials(rows, d.library.materials, units)
    case 'edgebands':
      return importEdgebands(rows, d.library.edgebands, units)
    case 'hardware':
      return importHardware(rows, d.library.hardware)
    case 'templates':
      return importTemplates(rows, d.library.templates, d.library, units)
    case 'tools':
      return importTools(rows, profileOf(d, useStore.getState().machineEdit).tools, units)
  }
}

/** The import preview's line on how sizes were read (Polish-1). */
function unitsNote(u: NonNullable<ImportResult<unknown>['units']>) {
  const name = (x: UnitSystem) => (x === 'in' ? 'inches' : 'millimetres')
  if (!u.column) return `Sizes read in ${name(u.default)} (no "units" column in the file). Choose inches above, add a "units" column (mm or in), or write the unit in a cell (6 mm, 23-1/4").`
  const parts = [u.rows.mm && `${u.rows.mm} row${u.rows.mm === 1 ? '' : 's'} in millimetres`, u.rows.in && `${u.rows.in} row${u.rows.in === 1 ? '' : 's'} in inches`].filter(Boolean)
  return `Sizes read from the file's "units" column: ${parts.join(', ')}. Rows with an empty units cell use ${name(u.default)}.`
}

export function ImportDialog({ open, onOpenChange, kinds, onApplied }: { open: boolean; onOpenChange: (o: boolean) => void; kinds: ImportKind[]; onApplied?: (k: ImportKind) => void }) {
  const { data, mutate } = useStore()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<{ name: string; rows: Row[] } | null>(null)
  const [kind, setKind] = useState<ImportKind>(kinds[0])
  // mm by default, as before Polish-1; a "units" column in the file wins row by row
  const [units, setUnits] = useState<UnitSystem>('mm')
  const [err, setErr] = useState<string | null>(null)
  if (!data) return null

  const result = file ? run(kind, file.rows, data, units) : null
  const reset = () => {
    setFile(null)
    setErr(null)
    if (input.current) input.current.value = ''
  }

  const onFile = async (f: File) => {
    setErr(null)
    try {
      const isXlsx = /\.xlsx?$/i.test(f.name)
      const rows = rowsFromFile(f.name, isXlsx ? new Uint8Array(await f.arrayBuffer()) : await f.text())
      if (rows.length === 0) throw new Error('No rows found. The first row must contain column headers.')
      setFile({ name: f.name, rows })
      const g = guessKind(rows)
      setKind(kinds.includes(g) ? g : kinds[0])
    } catch (e) {
      setFile(null)
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const apply = () => {
    if (!result) return
    mutate((d) => {
      const items = result.items as never[]
      // tools go to the machine shown on the Machine page (M2.9: possibly another machine)
      if (kind === 'tools') profileOf(d, useStore.getState().machineEdit).tools = items
      else d.library[kind] = items
    })
    toast.success(`${KIND_LABEL[kind]}: ${result.added} added, ${result.updated} updated`)
    onApplied?.(kind)
    reset()
    onOpenChange(false)
  }

  const headers = file ? Object.keys(file.rows[0] ?? {}).slice(0, 8) : []

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import from CSV, XLSX or JSON</DialogTitle>
          <DialogDescription>Rows are matched by code (or tool number / template name). Matching rows are updated, new rows are added. Nothing is deleted.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={input}
              type="file"
              accept=".csv,.txt,.tsv,.xlsx,.xls,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onFile(f)
              }}
            />
            <Button variant="outline" onClick={() => input.current?.click()}>
              <FileUp /> {file ? 'Choose another file' : 'Choose file'}
            </Button>
            {file && (
              <span className="text-xs text-muted-foreground">
                {file.name} · {file.rows.length} rows
              </span>
            )}
            <div className="ml-auto flex items-center gap-2 text-xs">
              Sizes in
              <Select value={units} onValueChange={(v) => setUnits(v as UnitSystem)}>
                <SelectTrigger size="sm" className="w-32" aria-label="Sizes in">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mm">Millimetres</SelectItem>
                  <SelectItem value="in">Inches</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {kinds.length > 1 && (
              <div className="flex items-center gap-2 text-xs">
                Import as
                <Select value={kind} onValueChange={(v) => setKind(v as ImportKind)}>
                  <SelectTrigger size="sm" className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {kinds.map((k) => (
                      <SelectItem key={k} value={k}>
                        {KIND_LABEL[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <p className="rounded-md bg-muted px-3 py-2 font-mono text-[11px] text-muted-foreground">
            {KIND_LABEL[kind]} columns: {COLUMNS[kind]}
            {kind !== 'hardware' && ', units (mm or in, optional)'}
          </p>
          {err && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{err}</p>}
          {file && result && (
            <>
              <div className="flex gap-4 text-xs">
                <span className="font-medium text-emerald-700">{result.added} new</span>
                <span className="font-medium text-sky-700">{result.updated} updated</span>
                {result.errors.length > 0 && <span className="font-medium text-red-700">{result.errors.length} rows skipped</span>}
              </div>
              {result.units && (
                <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-sky-900" data-testid="import-units">
                  {unitsNote(result.units)}
                </p>
              )}
              {result.errors.length > 0 && (
                <ul className="max-h-24 overflow-auto rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-800">
                  {result.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
              <div className="max-h-56 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {headers.map((h) => (
                        <TableHead key={h} className="text-xs">
                          {h}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {file.rows.slice(0, 20).map((r, i) => (
                      <TableRow key={i}>
                        {headers.map((h) => (
                          <TableCell key={h} className="font-mono text-[11px]">
                            {String(r[h] ?? '')}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!result || result.added + result.updated === 0} onClick={apply}>
            Import {result ? result.added + result.updated : ''} rows
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
