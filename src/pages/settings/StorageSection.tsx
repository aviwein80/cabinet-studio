import { Database, FileDown, FileUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { backend, type StorageStatus } from '@/app/backend'
import { useStore } from '@/app/store'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { shopSummary } from '@/core/shopDb'
import type { AppData } from '@/core/types'
import { cn } from '@/lib/utils'

/** Where the shop data is kept (M2.9, AM-06): the JSON file (default) or a SQLite database beside it. */
export function StorageSection() {
  const data = useStore((s) => s.data)!
  const replaceData = useStore((s) => s.replaceData)
  const bridge = backend.storage
  const [status, setStatus] = useState<StorageStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [incoming, setIncoming] = useState<{ file: string; data: AppData } | null>(null)
  useEffect(() => {
    void bridge?.status().then(setStatus)
  }, [bridge])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast.error(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    } finally {
      setBusy(false)
    }
  }
  const choose = (kind: 'json' | 'sqlite') =>
    run(async () => {
      const r = await bridge!.set(kind)
      toast.success(r.message)
      setStatus(await bridge!.status())
    })
  const sum = (d: AppData) => {
    const s = shopSummary(d)
    return `${s.jobs} job${s.jobs === 1 ? '' : 's'}, ${s.materials} materials, ${s.tools} tools, ${s.machines} machine${s.machines === 1 ? '' : 's'}`
  }

  return (
    <section className="mx-auto mt-8 flex max-w-4xl flex-col gap-3" data-cfg="storage">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <Database className="size-4" /> Shop data storage
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Jobs, materials, tools, machines and settings are kept in one JSON file. As an option they can be kept in a SQLite database beside it, where other programs (reports, spreadsheets, an office database) can read and query them: materials, tools and jobs are tables of
          their own. The JSON file is still written on every save either way, and backups work as before.
        </p>
      </div>
      {!bridge ? (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">The database option is in the desktop app. This browser preview keeps its data in browser storage.</p>
      ) : (
        <>
          <div role="radiogroup" aria-label="Shop data storage" className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ['json', 'JSON file (default)', status?.jsonFile],
                ['sqlite', 'SQLite database', status?.dbFile],
              ] as const
            ).map(([k, title, file]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={status?.kind === k}
                disabled={busy || !status}
                onClick={() => status?.kind !== k && void choose(k)}
                className={cn('flex flex-col gap-1 rounded-lg border p-3 text-left text-xs transition hover:bg-muted/40', status?.kind === k && 'border-primary bg-primary/5')}
              >
                <span className="text-[13px] font-medium">{title}</span>
                <span className="break-all font-mono text-[11px] text-muted-foreground">{file ?? '…'}</span>
                {k === 'sqlite' && <span className="text-muted-foreground">Loaded from the database; the JSON copy is written beside it.</span>}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const at = await bridge.exportDb(data)
                  if (at) toast.success('Shop data written to a database file', { description: at })
                })
              }
            >
              <FileDown /> Export to a database file
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await bridge.importDb()
                  if (r) setIncoming(r)
                })
              }
            >
              <FileUp /> Import from a database file
            </Button>
          </div>
        </>
      )}
      <Dialog open={!!incoming} onOpenChange={(o) => !o && setIncoming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace the shop data?</DialogTitle>
            <DialogDescription>
              {incoming?.file} holds {incoming ? sum(incoming.data) : ''}. It replaces everything in this app ({sum(data)}). Export the current data to a database file first if you want to keep a copy.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIncoming(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                replaceData(incoming!.data)
                setIncoming(null)
                toast.success('Shop data replaced')
              }}
            >
              Replace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
