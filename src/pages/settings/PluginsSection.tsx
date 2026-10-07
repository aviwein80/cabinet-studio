import { Code2, FileDown, FileUp, Plug, Puzzle, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { backend } from '@/app/backend'
import { loadPlugin, onPluginLog, pluginLog } from '@/app/plugins'
import { useStore } from '@/app/store'
import API_REFERENCE from '@/cam/plugin/api.ts?raw'
import { limitGrants, pluginRecord, ungranted } from '@/cam/plugin/manifest'
import type { PluginGrants, PluginRecord } from '@/cam/plugin/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { isLocked } from '@/core/admin'
import { cn } from '@/lib/utils'
import SAMPLE_PLUGIN from '../../../examples/plugins/sample-shop-tools.js?raw'
import SAMPLE_POST from '../../../examples/plugins/iso-router-post.js?raw'
import SAMPLE_ROTARY_POST from '../../../examples/plugins/rotary-4axis-post.js?raw'
import SAMPLE_32_POST from '../../../examples/plugins/positional-3plus2-post.js?raw'

const now = () => new Date().toISOString()
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Plugins (M2.10, API-01): install, switch on, grant access, see what they add and what they were refused. */
export function PluginsSection() {
  const data = useStore((s) => s.data)!
  const mutate = useStore((s) => s.mutate)
  const unlocked = useStore((s) => s.adminUnlocked)
  const locked = isLocked(data.settings, unlocked)
  const plugins = data.plugins ?? []
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [code, setCode] = useState<PluginRecord | null>(null)
  const log = useSyncExternalStore(onPluginLog, pluginLog)

  const put = (rec: PluginRecord) =>
    mutate((d) => {
      const list = d.plugins ?? []
      const i = list.findIndex((p) => p.id === rec.id)
      d.plugins = i >= 0 ? list.map((p, k) => (k === i ? rec : p)) : [...list, rec]
    })

  /** Start it in the sandbox: records what it adds, or why it cannot start. */
  const check = async (rec: PluginRecord): Promise<PluginRecord> => {
    setBusy(rec.id)
    try {
      const contributes = await loadPlugin(rec, data)
      const { error: _e, ...rest } = rec
      return { ...rest, contributes }
    } catch (e) {
      return { ...rec, enabled: false, error: errText(e) }
    } finally {
      setBusy(null)
    }
  }

  const install = async (text: string, source: string) => {
    let rec: PluginRecord
    try {
      rec = pluginRecord(text, source, now(), plugins.find((p) => p.manifest.id === (/^\s*\/\/\s*@plugin\s+(\S+)/m.exec(text)?.[1] ?? '')))
    } catch (e) {
      return void toast.error('Not a plugin', { description: errText(e) })
    }
    const prev = plugins.find((p) => p.id === rec.id)
    const checked = await check(rec)
    put(checked)
    if (checked.error) toast.error(`${rec.manifest.name} could not start`, { description: checked.error })
    else toast.success(prev && prev.codeHash !== rec.codeHash ? `${rec.manifest.name} updated: switched off, nothing granted until you look at it again` : `${rec.manifest.name} installed (switched off)`)
  }

  const onFile = async (f: File | undefined) => {
    if (f) await install(await f.text(), f.name)
    if (fileRef.current) fileRef.current.value = ''
  }

  const setEnabled = async (rec: PluginRecord, on: boolean) => {
    if (!on) return put({ ...rec, enabled: false })
    const checked = await check({ ...rec, enabled: true })
    put(checked)
    if (checked.error) toast.error(`${rec.manifest.name} could not start`, { description: checked.error })
  }

  const setGrant = (rec: PluginRecord, change: (g: PluginGrants) => PluginGrants) => put({ ...rec, grants: limitGrants(rec, change({ ...rec.grants })) })
  const toggle = (list: string[] | undefined, v: string, on: boolean) => (on ? [...new Set([...(list ?? []), v])] : (list ?? []).filter((x) => x !== v))

  const remove = (rec: PluginRecord) => {
    if (!window.confirm(`Remove the plugin ${rec.manifest.name}? Batch setups that use its steps will report them as not available.`)) return
    mutate((d) => void (d.plugins = (d.plugins ?? []).filter((p) => p.id !== rec.id)))
  }

  const saveReference = async () => {
    const at = await backend.saveFile({ name: 'cabinet-studio-plugin.d.ts', data: API_REFERENCE }, [{ name: 'TypeScript', extensions: ['ts'] }])
    if (at) toast.success('API reference saved', { description: at })
  }

  // keep "what it adds" current for plugins switched on before this session
  useEffect(() => {
    for (const p of plugins) if (p.enabled && !p.contributes && !p.error) void check(p).then(put)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <section className="mx-auto mt-8 flex max-w-4xl flex-col gap-3" data-cfg="plugins">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <Puzzle className="size-4" /> Plugins
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Plugins add menu commands, batch steps and script posts. Each one runs in its own sandbox: it cannot see the app, your files or the network, and it is stopped if it runs longer than 5 seconds or uses more than 64 MB. Reading or writing a folder, using the
          network and producing machine programs each need your grant below; the plugin only asks. A plugin never switches output on and never gets past the export checker. A new or changed plugin starts switched off with nothing granted.
        </p>
      </div>
      <fieldset disabled={locked} className="flex flex-col gap-3">
        {locked && <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs">The admin password is set: plugins cannot be installed, switched on or granted access until it is entered (Settings → Admin tools).</p>}
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".js,.mjs,.txt" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => fileRef.current?.click()}>
            <FileUp className="size-3.5" /> Install a plugin file…
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void install(SAMPLE_PLUGIN, 'sample')} disabled={plugins.some((p) => p.id === 'sample-shop-tools')}>
            <Plug className="size-3.5" /> Add the sample plugin
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void install(SAMPLE_POST, 'sample')} disabled={plugins.some((p) => p.id === 'iso-router-post')}>
            <Plug className="size-3.5" /> Add the sample script post
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void install(SAMPLE_ROTARY_POST, 'sample')} disabled={plugins.some((p) => p.id === 'rotary-4axis-post')}>
            <Plug className="size-3.5" /> Add the sample rotary post
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void install(SAMPLE_32_POST, 'sample')} disabled={plugins.some((p) => p.id === 'positional-3plus2-post')}>
            <Plug className="size-3.5" /> Add the sample 3+2 post
          </Button>
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => void saveReference()}>
            <FileDown className="size-3.5" /> Plugin API reference (.d.ts)
          </Button>
        </div>
        {!plugins.length && <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">No plugins installed. Recorded macros (Parts designer → Plugins → Record a macro) appear here too.</p>}
        {plugins.map((p) => {
          const asks = p.manifest.requests
          const missing = ungranted(p)
          const adds = p.contributes
          return (
            <div key={p.id} className={cn('flex flex-col gap-2 rounded-lg border p-3 text-xs', p.enabled ? 'bg-background' : 'bg-muted/30')} data-plugin={p.id}>
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
                    {p.manifest.name}
                    <span className="font-mono text-[11px] font-normal text-muted-foreground">
                      {p.id} {p.manifest.version}
                    </span>
                    {p.source === 'recorded' && <Badge variant="secondary">recorded macro</Badge>}
                  </div>
                  {p.manifest.description && <p className="mt-0.5 text-muted-foreground">{p.manifest.description}</p>}
                </div>
                <label className="flex items-center gap-2">
                  <span>{p.enabled ? 'On' : 'Off'}</span>
                  <Switch checked={p.enabled} disabled={busy === p.id} onCheckedChange={(v) => void setEnabled(p, v)} aria-label={`Switch ${p.manifest.name} on`} />
                </label>
              </div>
              {p.error && <p className="rounded border border-red-500/30 bg-red-500/10 p-2 text-red-700 dark:text-red-300">Could not start: {p.error}</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <div className="mb-1 font-medium">Asks for</div>
                  {!asks.read?.length && !asks.write?.length && !asks.net?.length && !asks.machineOutput && <p className="text-muted-foreground">Nothing beyond the sandbox.</p>}
                  {(asks.read ?? []).map((f) => (
                    <label key={`r${f}`} className="flex items-center gap-2 py-0.5">
                      <Checkbox checked={!!p.grants.read?.includes(f)} onCheckedChange={(v) => setGrant(p, (g) => ({ ...g, read: toggle(g.read, f, !!v) }))} /> Read files in <span className="font-mono">{f}</span>
                    </label>
                  ))}
                  {(asks.write ?? []).map((f) => (
                    <label key={`w${f}`} className="flex items-center gap-2 py-0.5">
                      <Checkbox checked={!!p.grants.write?.includes(f)} onCheckedChange={(v) => setGrant(p, (g) => ({ ...g, write: toggle(g.write, f, !!v) }))} /> Write files in <span className="font-mono">{f}</span>
                    </label>
                  ))}
                  {(asks.net ?? []).map((h) => (
                    <label key={`n${h}`} className="flex items-center gap-2 py-0.5">
                      <Checkbox checked={!!p.grants.net?.includes(h)} onCheckedChange={(v) => setGrant(p, (g) => ({ ...g, net: toggle(g.net, h, !!v) }))} /> Fetch from <span className="font-mono">{h}</span> (https)
                    </label>
                  ))}
                  {asks.machineOutput && (
                    <label className="flex items-center gap-2 py-0.5">
                      <Checkbox checked={!!p.grants.machineOutput} onCheckedChange={(v) => setGrant(p, (g) => ({ ...g, machineOutput: !!v }))} /> Produce machine programs with its script posts (still only when the output switches are on and the export checker passes)
                    </label>
                  )}
                  {missing.length > 0 && <p className="mt-1 text-muted-foreground">Not granted: {missing.join('; ')}.</p>}
                </div>
                <div>
                  <div className="mb-1 font-medium">Adds</div>
                  {!adds ? (
                    <p className="text-muted-foreground">Not started yet: switch it on, or press Check.</p>
                  ) : (
                    <ul className="flex flex-col gap-0.5">
                      {adds.menu.map((m) => (
                        <li key={`m${m.id}`}>
                          {m.area === 'part' ? 'Designer' : 'Job page'} menu: {m.label}
                        </li>
                      ))}
                      {adds.steps.map((s) => (
                        <li key={`s${s.id}`}>Batch step: {s.name}</li>
                      ))}
                      {adds.posts.map((s) => (
                        <li key={`p${s.id}`}>
                          Script post: {s.name} (.{s.ext})
                        </li>
                      ))}
                      {!adds.menu.length && !adds.steps.length && !adds.posts.length && <li className="text-muted-foreground">Nothing.</li>}
                    </ul>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" disabled={busy === p.id} onClick={() => void check(p).then(put)}>
                  <RefreshCw className="size-3" /> Check
                </Button>
                <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => setCode(p)}>
                  <Code2 className="size-3" /> Show code
                </Button>
                <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => void backend.saveFile({ name: `${p.id}.js`, data: p.code }, [{ name: 'JavaScript', extensions: ['js'] }])}>
                  <FileDown className="size-3" /> Save as file
                </Button>
                <Button size="sm" variant="ghost" className="ml-auto h-7 gap-1 text-xs text-red-600" onClick={() => remove(p)}>
                  <Trash2 className="size-3" /> Remove
                </Button>
              </div>
            </div>
          )
        })}
      </fieldset>
      {log.length > 0 && (
        <div className="rounded-lg border p-3 text-xs">
          <div className="mb-1 flex items-center gap-1.5 font-medium">
            <ShieldAlert className="size-3.5" /> Plugin log (this session)
          </div>
          <ul className="max-h-48 overflow-auto font-mono text-[11px]">
            {log.slice(-40).map((l, i) => (
              <li key={i} className={cn(l.level === 'denied' && 'text-amber-700 dark:text-amber-300', l.level === 'error' && 'text-red-600')}>
                {l.at} {l.plugin} {l.level === 'denied' ? 'REFUSED' : l.level}: {l.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Dialog open={!!code} onOpenChange={(o) => !o && setCode(null)}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{code?.manifest.name}</DialogTitle>
            <DialogDescription>The plugin's code exactly as installed. It runs only inside the sandbox.</DialogDescription>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 font-mono text-[11px] leading-relaxed">{code?.code}</pre>
        </DialogContent>
      </Dialog>
    </section>
  )
}
