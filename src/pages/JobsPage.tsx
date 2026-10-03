import { FolderKanban, FolderOpen, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '@/app/store'
import { CabinetThumb } from '@/components/CabinetThumb'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { TextField } from '@/components/fields'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function JobsPage() {
  const { data, go, createJob, loadSampleJob, deleteJob } = useStore()
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [form, setForm] = useState({ number: '', name: '', customer: '' })
  if (!data) return null
  const jobs = data.jobs

  const nextNumber = () => {
    const nums = jobs.map((j) => Number(j.number.replace(/\D/g, ''))).filter(Number.isFinite)
    return `J${(nums.length ? Math.max(...nums) : 1000) + 1}`
  }

  const submit = () => {
    if (!form.number.trim() || !form.name.trim()) return
    const id = createJob({ number: form.number.trim(), name: form.name.trim(), customer: form.customer.trim() })
    setOpen(false)
    go({ page: 'job', jobId: id })
  }

  const doomed = jobs.find((j) => j.id === confirmDelete)

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Jobs"
        subtitle={`${jobs.length} job${jobs.length === 1 ? '' : 's'} on this machine`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => go({ page: 'job', jobId: loadSampleJob() })}>
              <Sparkles /> Load sample kitchen
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setForm({ number: nextNumber(), name: '', customer: '' })
                setOpen(true)
              }}
            >
              <Plus /> New job
            </Button>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {jobs.length === 0 ? (
          <EmptyState
            icon={<FolderKanban className="size-5" />}
            title="No jobs yet"
            action={
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => go({ page: 'job', jobId: loadSampleJob() })}>
                  <Sparkles /> Load sample kitchen
                </Button>
                <Button size="sm" onClick={() => (setForm({ number: nextNumber(), name: '', customer: '' }), setOpen(true))}>
                  <Plus /> New job
                </Button>
              </div>
            }
          >
            A job holds the cabinets for one order. Add cabinets from the library, then nest and export one woodWOP MPR per sheet with labels and sheet maps.
          </EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {jobs.map((j) => {
              const count = j.cabinets.reduce((s, c) => s + c.qty, 0)
              return (
                <div key={j.id} className="group flex flex-col rounded-xl border bg-background p-4 shadow-xs transition hover:border-stone-400">
                  <button className="flex flex-1 flex-col gap-3 text-left" onClick={() => go({ page: 'job', jobId: j.id })}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-muted-foreground">{j.number}</div>
                        <div className="truncate font-semibold">{j.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{j.customer || 'No customer'}</div>
                      </div>
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">
                        {count} cabinet{count === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="flex h-16 items-end gap-1.5 overflow-hidden">
                      {j.cabinets.slice(0, 8).map((c) => (
                        <CabinetThumb key={c.id} p={c.params} className="h-full w-auto" />
                      ))}
                      {j.cabinets.length === 0 && <span className="text-xs text-muted-foreground">Empty job</span>}
                    </div>
                  </button>
                  <div className="mt-3 flex items-center justify-between border-t pt-2 text-[11px] text-muted-foreground">
                    <span>Updated {new Date(j.updatedAt).toLocaleString()}</span>
                    <div className="flex gap-1 opacity-70 group-hover:opacity-100">
                      <Button variant="ghost" size="icon-sm" aria-label="Open job" onClick={() => go({ page: 'job', jobId: j.id })}>
                        <FolderOpen />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label="Delete job" onClick={() => setConfirmDelete(j.id)}>
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New job</DialogTitle>
            <DialogDescription>The job number becomes the prefix of every part ID, barcode and MPR file name.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <TextField label="Job number" value={form.number} onChange={(v) => setForm({ ...form, number: v })} />
            <TextField label="Job name" value={form.name} placeholder="Levi kitchen" onChange={(v) => setForm({ ...form, name: v })} />
            <TextField label="Customer" value={form.customer} placeholder="Optional" onChange={(v) => setForm({ ...form, customer: v })} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!form.number.trim() || !form.name.trim()}>
                Create job
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!doomed} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {doomed?.number}?</DialogTitle>
            <DialogDescription>
              "{doomed?.name}" and its {doomed?.cabinets.length} cabinets will be removed. Exported MPR files on disk are not touched. A rolling backup of the data file is kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (doomed) deleteJob(doomed.id)
                setConfirmDelete(null)
              }}
            >
              Delete job
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
