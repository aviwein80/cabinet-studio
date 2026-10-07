import { FileCode2, Save, ShieldAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { backend } from '@/app/backend'
import { runPluginPost } from '@/app/plugins'
import { useStore } from '@/app/store'
import { checkPostText, planPartPost } from '@/cam/plugin/posts'
import { dataFor, machineSetups, MAIN_MACHINE } from '@/core/machines'
import { modelsFor } from '@/cam/doc'
import { inBackground, pathKey } from '@/cam/toolpath'
import { compute } from '@/cam/worker/client'
import type { Mesh } from '@/cam/mesh/types'
import { loadModelMesh } from './modelData'
import { writePartPrograms } from '@/cam/mpr'
import { readMpr, type MprMacro } from '@/cam/mprRead'
import type { Toolpath } from '@/cam/toolpath'
import type { CamPart } from '@/cam/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { MachineProfile } from '@/core/types'
import { cn } from '@/lib/utils'

const MACRO: Record<number, { name: string; keys: string[] }> = {
  100: { name: 'Workpiece', keys: ['LA', 'BR', 'DI'] },
  101: { name: 'Comment', keys: ['KM'] },
  102: { name: 'Vertical drilling', keys: ['XA', 'YA', 'DU', 'TNO', 'TI', 'BM'] },
  103: { name: 'Horizontal drilling', keys: ['XA', 'YA', 'ZA', 'DU', 'TNO', 'TI', 'BM'] },
  105: { name: 'Contour milling', keys: ['EA', 'EE', 'RK', 'TNO', 'ZA', 'MDA'] },
  109: { name: 'Saw groove', keys: ['XA', 'YA', 'XE', 'YE', 'TI', 'T_'] },
  112: { name: 'Pocket', keys: ['XA', 'YA', 'LA', 'BR', 'RD', 'TI', 'T_'] },
}

export function ProgramDialog({ open, onOpenChange, part, toolpaths, machine, materialCode, outputOn }: { open: boolean; onOpenChange: (o: boolean) => void; part: CamPart; toolpaths: Toolpath[]; machine: MachineProfile; materialCode: string; outputOn: boolean }) {
  const data = useStore((st) => st.data)!
  // M2.10b: other machines with a template or script post can be previewed here too
  const textMachines = machineSetups(data).filter((m) => m.id !== MAIN_MACHINE && m.post.kind !== 'woodwop-mpr')
  const [target, setTarget] = useState<string>(MAIN_MACHINE)
  const files = useMemo(() => (open ? writePartPrograms(part, toolpaths, machine, materialCode, { withCutout: false }) : []), [open, part, toolpaths, machine, materialCode])
  const [sel, setSel] = useState(0)
  const [raw, setRaw] = useState(false)
  const file = files[Math.min(sel, files.length - 1)]
  const doc = useMemo(() => (file ? readMpr(file.text) : null), [file])
  const rows = (doc?.macros ?? []).filter((m) => m.id !== 100 && !(m.id === 101 && m.values.KM?.startsWith('HOMAG_')))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dark border-white/10 bg-[#15171c] text-stone-100 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCode2 className="size-4" /> {target === MAIN_MACHINE ? 'woodWOP program preview' : 'Program preview (text post)'}
          </DialogTitle>
          <DialogDescription className="text-stone-400">{target === MAIN_MACHINE ? 'Native macros this part produces. Each one opens in woodWOP as an editable macro, not a point list.' : 'The part through another machine\'s template or script post, with that machine\'s tools and checks.'}</DialogDescription>
        </DialogHeader>
        <div className={cn('flex items-start gap-2 rounded-md border p-2.5 text-xs', target !== MAIN_MACHINE && 'hidden', outputOn ? 'border-amber-400/30 bg-amber-400/10 text-amber-100' : 'border-white/10 bg-white/5 text-stone-300')}>
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            {outputOn
              ? 'Custom-part output is on. Programs are exported from the job’s Output tab, after the export checker. Not machine-proven: simulate in woodWOP first.'
              : 'Custom-part output is off (Machine & tools → Custom-part features), so the job’s MPR export is blocked for parts with machining. This preview is for checking only.'}
            {machine.placeholder && ' Tool numbers are placeholders.'}
          </span>
        </div>
        {textMachines.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-stone-300">
            Program for
            <select aria-label="Program for" className="h-7 rounded-md border border-white/15 bg-transparent px-1.5 text-xs" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value={MAIN_MACHINE} className="bg-[#15171c]">
                {machine.name}: woodWOP MPR (built in)
              </option>
              {textMachines.map((m) => (
                <option key={m.id} value={m.id} className="bg-[#15171c]">
                  {m.name}: {m.post.kind === 'template' ? `template post (${m.post.name})` : `script post (${m.post.kind === 'script' ? m.post.post : ''})`}
                </option>
              ))}
            </select>
          </label>
        )}
        {target !== MAIN_MACHINE ? (
          <TextPostPreview part={part} machineId={target} />
        ) : (
          <>
        <div className="flex flex-wrap items-center gap-2">
          {files.map((f, i) => (
            <Button key={f.name} size="sm" variant={i === sel ? 'secondary' : 'ghost'} className="h-7 font-mono text-xs" onClick={() => setSel(i)}>
              {f.name}
              {f.side === 'back' && <Badge className="ml-1 h-4 bg-sky-500/20 px-1 text-[10px] text-sky-200">turned over</Badge>}
            </Button>
          ))}
          <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={() => setRaw((r) => !r)}>
            {raw ? 'Macro list' : 'Plain text'}
          </Button>
        </div>
        {raw ? (
          <pre className="max-h-[55vh] overflow-auto rounded-md bg-black/50 p-3 font-mono text-[11px] leading-relaxed text-stone-200">{file?.text}</pre>
        ) : (
          <div className="max-h-[55vh] overflow-auto rounded-md border border-white/10">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#1b1e24] text-left text-stone-400">
                <tr>
                  <th className="px-2 py-1.5 font-medium">#</th>
                  <th className="px-2 py-1.5 font-medium">Macro</th>
                  <th className="px-2 py-1.5 font-medium">Parameters</th>
                  <th className="px-2 py-1.5 font-medium">Label</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rows.map((m, i) => (
                  <MacroRow key={i} n={i + 1} m={m} />
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={4} className="px-2 py-6 text-center text-stone-500">
                      No machining yet. Add operations on the Machining tab.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {doc && doc.errors.length > 0 && <p className="text-xs text-red-300">Structure check: {doc.errors.join(' ')}</p>}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function MacroRow({ n, m }: { n: number; m: MprMacro }) {
  const def = MACRO[m.id]
  return (
    <tr className="align-top">
      <td className="px-2 py-1.5 text-stone-500 tabular-nums">{n}</td>
      <td className="px-2 py-1.5 whitespace-nowrap">
        {def?.name ?? m.name}
        <span className="ml-1.5 font-mono text-[10px] text-stone-500">{m.name}</span>
      </td>
      <td className="px-2 py-1.5 font-mono text-[11px] text-stone-300">
        {(def?.keys ?? Object.keys(m.values).slice(0, 6))
          .filter((k) => m.values[k] !== undefined)
          .map((k) => `${k}=${m.values[k]}`)
          .join('  ')}
      </td>
      <td className="px-2 py-1.5 text-stone-400">{m.values.MNM ?? ''}</td>
    </tr>
  )
}

/**
 * A part's program through another machine's template or script post (M2.10b): toolpaths with that
 * machine's tools, the post's text, and the export checks. Saved only when every check passes
 * (switch on, plugin granted, not the N-200, supported work, the job's own checks clean).
 */
function TextPostPreview({ part, machineId }: { part: CamPart; machineId: string }) {
  const data = useStore((st) => st.data)!
  // M3.3: rotary operations on a model (M3.5: and 5-axis operations), calculated in the background with this machine's tools
  const [bg, setBg] = useState<{ key: unknown; paths: Map<string, Toolpath>; note?: string } | null>(null)
  const bgKey = useMemo(() => ({ part, machineId, data }), [part, machineId, data])
  useEffect(() => {
    const machine = dataFor(data, machineId).machine
    const ops = part.ops.filter((o) => o.enabled && (o.kind === 'rotary' || o.kind === 'multiaxis') && inBackground(o, part))
    if (!ops.length) return
    const abort = new AbortController()
    void (async () => {
      try {
        const meshes: Record<string, Mesh> = {}
        const ids = new Set(ops.flatMap((o) => modelsFor(o, part)))
        for (const m of part.models ?? []) if (ids.has(m.id)) meshes[m.blob] = await loadModelMesh(m.blob)
        const tps = await compute().run('cam.generate', { part, machine, opIds: ops.map((o) => o.id), meshes }, { signal: abort.signal })
        setBg({ key: bgKey, paths: new Map(ops.map((o, i) => [pathKey(o, part, machine), tps[i]])) })
      } catch (e) {
        if (!abort.signal.aborted) setBg({ key: bgKey, paths: new Map(), note: e instanceof Error ? e.message : String(e) })
      }
    })()
    return () => abort.abort()
  }, [bgKey, data, machineId, part])
  const needsBg = part.ops.some((o) => o.enabled && (o.kind === 'rotary' || o.kind === 'multiaxis') && inBackground(o, part))
  const paths3d = bg?.key === bgKey ? bg.paths : undefined
  const plan = useMemo(() => {
    try {
      return { ok: true as const, plan: planPartPost(data, machineId, part, { paths3d }) }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  }, [data, machineId, part, paths3d])
  const [out, setOut] = useState<{ key: unknown; ext?: string; text?: string; error?: string } | null>(null)
  useEffect(() => {
    if (!plan.ok) return
    const p = plan.plan
    if (p.templateText) return
    if (p.post.kind !== 'script') return
    const post = p.post
    const rec = (data.plugins ?? []).find((x) => x.id === post.plugin)
    if (!rec || !rec.enabled) return
    let live = true
    const ext = rec.contributes?.posts.find((x) => x.id === post.post)?.ext ?? 'nc'
    runPluginPost(rec, data, post.post, p.input).then(
      (t) => live && setOut({ key: plan, ext, text: checkPostText(t, rec.manifest.name) }),
      (e: unknown) => live && setOut({ key: plan, error: e instanceof Error ? e.message : String(e) }),
    )
    return () => {
      live = false
    }
  }, [plan, data])
  if (!plan.ok) return <p className="text-xs text-red-300">{plan.error}</p>
  if (needsBg && !paths3d) return <p className="text-xs text-stone-400">Calculating the rotary and 5-axis toolpaths with this machine's tools…</p>
  const p = plan.plan
  const shown: { ext?: string; text?: string; error?: string } | null = p.templateText ?? (out?.key === plan ? out : null)
  const missing = p.post.kind === 'script' && !(data.plugins ?? []).some((x) => x.id === (p.post as { plugin: string }).plugin && x.enabled)
  const errors = p.issues.filter((i) => i.severity === 'error')
  const save = async () => {
    if (!shown?.text || !p.writable) return
    const ext = shown.ext ?? 'nc'
    const at = await backend.saveFile({ name: `${part.name.replace(/[^\w-]+/g, '-') || 'part'}.${ext}`, data: shown.text }, [{ name: 'Program', extensions: [ext] }])
    if (at) toast.success('Program saved', { description: `${at}. Not machine-proven: simulate it on the machine's own software before cutting.` })
  }
  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className={cn('flex items-start gap-2 rounded-md border p-2.5', p.writable ? 'border-amber-400/30 bg-amber-400/10 text-amber-100' : 'border-white/10 bg-white/5 text-stone-300')}>
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        <div>
          {p.writable ? 'Every check passed: this program can be saved. Not machine-proven: simulate it on that machine first.' : 'Preview only. Not written because:'}
          {errors.length > 0 && (
            <ul className="mt-1 list-disc pl-4">
              {errors.map((i, k) => (
                <li key={k}>{i.message}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {missing ? (
        <p className="text-red-300">The plugin for this post is not installed or is switched off (Settings → Plugins).</p>
      ) : shown?.error ? (
        <p className="text-red-300">The post failed: {shown.error}</p>
      ) : !shown?.text ? (
        <p className="text-stone-400">Running the script post in its sandbox…</p>
      ) : (
        <>
          <div className="flex items-center gap-2 text-stone-400">
            <span>
              {p.toolpaths.length} operation{p.toolpaths.length === 1 ? '' : 's'} with {p.machineName}'s tools · {shown.text.split('\r\n').length - 1} lines · .{shown.ext}
            </span>
            <Button size="sm" variant="secondary" className="ml-auto h-7 gap-1 text-xs" disabled={!p.writable} onClick={() => void save()}>
              <Save className="size-3" /> Save program
            </Button>
          </div>
          <pre className="max-h-[50vh] overflow-auto rounded-md bg-black/50 p-3 font-mono text-[11px] leading-relaxed text-stone-200">{shown.text}</pre>
        </>
      )}
    </div>
  )
}
