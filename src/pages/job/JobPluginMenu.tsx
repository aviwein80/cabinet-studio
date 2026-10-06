import { Puzzle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { backend } from '@/app/backend'
import { pluginMenus, runPluginMenu } from '@/app/plugins'
import { useStore } from '@/app/store'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { stepFileRefused } from '@/core/batchSteps'
import type { PartInstance } from '@/core/cutlist'
import type { Job } from '@/core/types'

/** The job page's Plugins menu (M2.10): read-only commands that report on the job or offer a text file to save. */
export function JobPluginMenu({ job, instances }: { job: Job; instances: PartInstance[] }) {
  const data = useStore((s) => s.data)!
  const [busy, setBusy] = useState(false)
  const items = pluginMenus(data, 'job')
  if (!items.length) return null

  const ctx = () => {
    const code = (id: string) => data.library.materials.find((m) => m.id === id)?.code ?? id
    const parts = new Map<string, { name: string; material: string; length: number; width: number; thickness: number; qty: number; custom: boolean }>()
    for (const i of instances) {
      const p = { name: i.part.name, material: code(i.materialId), length: i.cutLength, width: i.cutWidth, thickness: i.thickness, custom: !!i.cam }
      const k = JSON.stringify(p)
      const cur = parts.get(k)
      if (cur) cur.qty++
      else parts.set(k, { ...p, qty: 1 })
    }
    return { job: { number: job.number, name: job.name, customer: job.customer }, parts: [...parts.values()], units: data.settings.units }
  }

  const run = async (r: (typeof items)[number]) => {
    setBusy(true)
    try {
      const out = await runPluginMenu(r.plugin, data, r.item.id, ctx())
      const res = out.result
      if (res?.message) toast.success(r.item.label, { description: res.message })
      if (res?.file) {
        const name = String(res.file.name ?? '')
        if (stepFileRefused(name)) throw new Error(`may not offer ${name} (machine programs come only from the program writers; names without folders)`)
        const at = await backend.saveFile({ name, data: String(res.file.data ?? '') }, [{ name: 'Text', extensions: [name.split('.').pop() || 'txt'] }])
        if (at) toast.success('Saved', { description: at })
      }
    } catch (e) {
      toast.error(`${r.plugin.manifest.name}: ${r.item.label}`, { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5" disabled={busy}>
          <Puzzle className="size-3.5" /> Plugins
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((r) => (
          <DropdownMenuItem key={`${r.plugin.id}/${r.item.id}`} onSelect={() => void run(r)}>
            {r.item.label}
            <span className="ml-3 text-[10px] text-muted-foreground">{r.plugin.manifest.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
