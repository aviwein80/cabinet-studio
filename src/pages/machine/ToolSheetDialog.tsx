/**
 * Tool table from a spreadsheet (TOOL-05): rows matched by tool number, every field, lengths in mm.
 * Shows each change before it is applied; typed (imported) values are the shop's own and are
 * confirmed. Nothing here clears the placeholder-table switch or turns on any output.
 */
import { FileUp } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { rowsFromFile } from '@/core/library/import'
import { TOOL_FIELDS, toolsFromRows, type SheetImport } from '@/core/toolData'
import type { MachineProfile, Tool } from '@/core/types'

const show = (v: unknown) => (v === undefined || v === null || v === '' ? '–' : String(v))

export function ToolSheetDialog({ open, onOpenChange, machine, onApply }: { open: boolean; onOpenChange: (o: boolean) => void; machine: MachineProfile; onApply: (tools: Tool[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [res, setRes] = useState<(SheetImport & { file: string }) | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const read = async (f: File) => {
    setErr(null)
    try {
      const rows = rowsFromFile(f.name, /\.xlsx?$/i.test(f.name) ? new Uint8Array(await f.arrayBuffer()) : await f.text())
      if (!rows.length) throw new Error('No rows found. The first row must hold the column names.')
      setRes({ ...toolsFromRows(rows, machine), file: f.name })
    } catch (e) {
      setRes(null)
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      if (input.current) input.current.value = ''
    }
  }
  const label = (k: string) => TOOL_FIELDS.find((f) => f.key === k)?.label ?? k
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setRes(null)
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import the tool table from a spreadsheet</DialogTitle>
          <DialogDescription>XLSX, CSV or JSON with the columns of “Export tools” (number, type, name, diameter, maxDepth, … lengths in mm). Rows are matched by tool number; an empty cell keeps the value; nothing is deleted.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <input ref={input} type="file" accept=".xlsx,.xls,.csv,.txt,.tsv,.json" className="hidden" onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
          <Button variant="outline" className="self-start" onClick={() => input.current?.click()}>
            <FileUp /> {res ? 'Choose another file' : 'Choose file'}
          </Button>
          {err && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{err}</p>}
          {res && (
            <>
              <p className="text-xs">
                {res.file}: <b className="text-sky-700">{res.changes.length} change(s)</b> to existing tools, <b className="text-emerald-700">{res.added.length} new tool(s)</b>
                {res.errors.length > 0 && <b className="text-red-700">, {res.errors.length} row(s) skipped</b>}
                {res.ignored.length > 0 && <span className="text-muted-foreground"> · columns not used: {res.ignored.join(', ')}</span>}
              </p>
              {res.errors.length > 0 && (
                <ul className="max-h-24 overflow-auto rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-800">
                  {res.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
              <div className="max-h-72 overflow-auto rounded-md border text-xs">
                <table className="w-full">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="px-2 py-1">Tool</th>
                      <th className="px-2 py-1">Field</th>
                      <th className="px-2 py-1">Now</th>
                      <th className="px-2 py-1">From the file</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.added.map((t) => (
                      <tr key={t.id} className="border-t bg-emerald-50/60 dark:bg-emerald-950/30">
                        <td className="px-2 py-1">T{t.number}</td>
                        <td className="px-2 py-1" colSpan={3}>
                          New: {t.type}, {t.name}, Ø{t.diameter}, {t.maxDepth} deep
                        </td>
                      </tr>
                    ))}
                    {res.changes.map((c, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-2 py-1">T{c.number}</td>
                        <td className="px-2 py-1">{label(c.field)}</td>
                        <td className="px-2 py-1 font-mono">{show(c.from)}</td>
                        <td className="px-2 py-1 font-mono">{show(c.to)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-muted-foreground">Imported values count as the shop's own and lose their Configure badge. The “Tool data is placeholder” switch is not changed; turn it off yourself once every tool matches the machine.</p>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!res || res.changes.length + res.added.length === 0}
            onClick={() => {
              if (!res) return
              onApply(res.tools)
              toast.success(`Tool table: ${res.changes.length} change(s), ${res.added.length} new tool(s)`)
              setRes(null)
              onOpenChange(false)
            }}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
