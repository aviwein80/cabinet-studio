import { Circle, Puzzle, Square } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { loadPlugin, pluginMenus, runPluginMenu } from '@/app/plugins'
import { useStore } from '@/app/store'
import { pluginRecord } from '@/cam/plugin/manifest'
import { acceptPluginPart } from '@/cam/plugin/partEdit'
import { recordMacro } from '@/cam/plugin/recorder'
import type { CamPart } from '@/cam/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { isLocked } from '@/core/admin'
import { cn } from '@/lib/utils'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * The part designer's Plugins menu (M2.10): commands from switched-on plugins, run in their
 * sandboxes on a copy of the part (the result is checked, then applied as one undo step), and the
 * macro recorder.
 */
export function PluginMenu({ part, selection, change }: { part: CamPart; selection: string[]; change: (p: CamPart) => void }) {
  const data = useStore((s) => s.data)!
  const mutate = useStore((s) => s.mutate)
  const locked = isLocked(data.settings, useStore((s) => s.adminUnlocked))
  const [recording, setRecording] = useState<CamPart | null>(null)
  const [naming, setNaming] = useState<{ name: string; steps: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const items = pluginMenus(data, 'part')

  const run = async (rec: (typeof items)[number]) => {
    setBusy(true)
    try {
      const out = await runPluginMenu(rec.plugin, data, rec.item.id, { part: structuredClone(part), selection, units: data.settings.units })
      const { part: next, changes } = acceptPluginPart(part, out.part, rec.plugin.manifest.name)
      if (changes.length) change(next)
      const msg = out.result?.message
      toast.success(rec.item.label, { description: [msg, changes.length ? `Changes: ${changes.join(', ')}. Undo takes them back.` : 'No changes to the part.'].filter(Boolean).join(' ') })
    } catch (e) {
      toast.error(`${rec.plugin.manifest.name}: ${rec.item.label}`, { description: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  const stop = () => {
    if (!recording) return
    const { steps } = recordMacro(recording, part, { name: 'Macro' })
    if (!steps.length) {
      setRecording(null)
      return void toast('Recording stopped: nothing changed, so no macro was made.')
    }
    setNaming({ name: `Macro ${new Date().toLocaleDateString()}`, steps })
  }

  const save = async () => {
    if (!recording || !naming) return
    const { code } = recordMacro(recording, part, { name: naming.name.trim() || 'Macro', when: new Date().toLocaleString() })
    try {
      const rec = { ...pluginRecord(code, 'recorded', new Date().toISOString(), (data.plugins ?? []).find((p) => code.includes(`@plugin ${p.id}\n`))), enabled: true }
      const contributes = await loadPlugin(rec, data)
      mutate((d) => void (d.plugins = [...(d.plugins ?? []).filter((p) => p.id !== rec.id), { ...rec, contributes }]))
      toast.success(`Saved as the plugin "${naming.name}"`, { description: 'It is in this Plugins menu now, and on the Settings page (code, save as a file, switch off).' })
      setRecording(null)
      setNaming(null)
    } catch (e) {
      toast.error('The macro could not be saved', { description: errText(e) })
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={busy} className={cn('h-8 gap-1.5 border-white/15 bg-transparent', recording && 'border-red-400 text-red-300')}>
            {recording ? <Circle className="size-3 fill-red-500 text-red-500" /> : <Puzzle className="size-3.5" />} Plugins{recording ? ' (recording)' : ''}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {items.length > 0 && <DropdownMenuLabel className="text-xs text-muted-foreground">Plugin commands (each runs in its sandbox)</DropdownMenuLabel>}
          {items.map((r) => (
            <DropdownMenuItem key={`${r.plugin.id}/${r.item.id}`} onSelect={() => void run(r)}>
              {r.item.label}
              <span className="ml-3 text-[10px] text-muted-foreground">{r.plugin.manifest.name}</span>
            </DropdownMenuItem>
          ))}
          {!items.length && <DropdownMenuLabel className="max-w-72 text-xs font-normal text-muted-foreground">No plugin commands. Plugins are installed and switched on in Settings → Plugins.</DropdownMenuLabel>}
          <DropdownMenuSeparator />
          {recording ? (
            <DropdownMenuItem onSelect={stop}>
              <Square className="size-3.5" /> Stop recording and save as a plugin…
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled={locked} onSelect={() => setRecording(structuredClone(part))}>
              <Circle className="size-3.5" /> Record a macro
            </DropdownMenuItem>
          )}
          {recording && <DropdownMenuItem onSelect={() => setRecording(null)}>Stop recording without saving</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={!!naming} onOpenChange={(o) => !o && setNaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save the macro</DialogTitle>
            <DialogDescription>It becomes a plugin with one command that makes these changes again, on this part or another one. It runs in the sandbox like any plugin and needs no access.</DialogDescription>
          </DialogHeader>
          <Input value={naming?.name ?? ''} onChange={(e) => setNaming((n) => (n ? { ...n, name: e.target.value } : n))} aria-label="Macro name" />
          <ul className="max-h-48 list-disc overflow-auto pl-5 text-xs text-muted-foreground">
            {naming?.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNaming(null)}>
              Keep recording
            </Button>
            <Button onClick={() => void save()}>Save as a plugin</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
