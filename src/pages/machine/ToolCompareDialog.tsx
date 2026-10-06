/**
 * Tool data in operations (TOOL-05): every operation in the jobs and the part library whose stored
 * tool data (kept when its toolpath was accepted) differs from the tool table, or that has none
 * yet, or that sets its own feeds. "Update" stores the table's data (and can drop the operation's
 * own feeds); the operation's toolpath is then calculated again.
 */
import { useStore } from '@/app/store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { resolveTool } from '@/cam/ops'
import type { CamPart } from '@/cam/types'
import { toolDataReport, updateOpTool, type OpToolReport } from '@/core/toolData'

const show = (v: unknown) => (v === undefined || v === null ? '–' : typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v))

export function ToolCompareDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data, mutate } = useStore()
  if (!data) return null
  const m = data.machine
  const parts: { part: CamPart; jobId?: string; jobName?: string }[] = [
    ...data.jobs.flatMap((j) => (j.camParts ?? []).map((part) => ({ part, jobId: j.id, jobName: j.name }))),
    ...(data.library.partLibrary ?? []).map((part) => ({ part })),
  ]
  const report = toolDataReport(parts, m, (op) => resolveTool(op, m))
  const changed = report.filter((r) => r.diffs.length)
  const update = (rows: OpToolReport[], clearOverrides: boolean) =>
    mutate((d) => {
      const lists = [...d.jobs.map((j) => j.camParts ?? []), d.library.partLibrary ?? []]
      for (const r of rows)
        for (const list of lists) {
          const p = list.find((x) => x.id === r.partId)
          if (!p) continue
          p.ops = p.ops.map((o) => (o.id === r.opId ? updateOpTool(o, p, d.machine, resolveTool(o, d.machine), { clearOverrides }) : o))
        }
    })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Tool data in operations</DialogTitle>
          <DialogDescription>Each operation keeps the tool data its toolpath was accepted with. Where the tool table has changed since, the differences are listed. Update stores the table's data; the toolpath is then calculated again and checked again.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto rounded-md border text-xs">
          <table className="w-full">
            <thead className="sticky top-0 bg-muted text-left">
              <tr>
                <th className="px-2 py-1">Part / operation</th>
                <th className="px-2 py-1">Tool</th>
                <th className="px-2 py-1">Differences (stored → table)</th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {report.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">
                    Every operation matches the tool table.
                  </td>
                </tr>
              )}
              {report.map((r) => (
                <tr key={`${r.partId}:${r.opId}`} className="border-t align-top">
                  <td className="px-2 py-1">
                    <div className="font-medium">{r.partName}</div>
                    <div className="text-muted-foreground">
                      {r.opName}
                      {r.jobName ? ` · ${r.jobName}` : ' · part library'}
                    </div>
                  </td>
                  <td className="px-2 py-1">{r.tool ? `T${r.tool.number}` : '–'}</td>
                  <td className="px-2 py-1">
                    {r.noData && <Badge variant="outline">no stored data yet (accept its toolpath)</Badge>}
                    {r.diffs.map((d) => (
                      <div key={d.field}>
                        {d.label}: <span className="font-mono">{show(d.stored)}</span> → <span className="font-mono font-medium">{show(d.library)}</span>
                      </div>
                    ))}
                    {Object.keys(r.overrides).length > 0 && (
                      <div className="text-amber-700">
                        Own feeds: {Object.entries(r.overrides).map(([k, v]) => `${k} ${v}`).join(', ')} (win over the table)
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    {(r.diffs.length > 0 || r.noData) && r.tool && (
                      <Button size="xs" variant="outline" onClick={() => update([r], false)}>
                        Update
                      </Button>
                    )}
                    {Object.keys(r.overrides).length > 0 && (
                      <Button size="xs" variant="ghost" onClick={() => update([r], true)} title="Store the table's data and use the table's feeds">
                        Use table feeds
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={!changed.length} onClick={() => update(changed, false)}>
            Update all {changed.length} changed
          </Button>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
