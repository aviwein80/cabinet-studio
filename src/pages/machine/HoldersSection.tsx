/**
 * Holder library (TOOL-04): holders as revolved outlines (height above the holder face : radius),
 * typed in point by point or made from a model of the holder (STL, OBJ, 3MF, STEP, IGES, BREP);
 * the shop's default holder for routers that name none. Every outline is drawn with the tool in
 * it, as the simulator draws it and the collision checks use it.
 */
import { FileUp, Plus, Trash2 } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/app/store'
import { ValueBadges } from '@/components/Configure'
import { LenInput } from '@/components/LenInput'
import { NONE, Section, SelectField, TextField } from '@/components/fields'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { compute, occtVendorUrl, solidCompute } from '@/cam/worker/client'
import { isSolidFile } from '@/cam/solid/format'
import { machineUnconfirmed } from '@/core/confirm'
import { cutterOutline, holderProblems } from '@/core/machineModel'
import type { MachineProfile, Tool, ToolHolder, UnitSystem } from '@/core/types'
import type { UpAxis } from '@/cam/types'

/** Side view of a holder (and a tool in it, when given): tip at the bottom. */
export function HolderPreview({ holder, tool, gauge, size = 140 }: { holder: ToolHolder; tool?: Tool; gauge?: number; size?: number }) {
  const g = tool && gauge !== undefined && Number.isFinite(gauge) ? gauge : 0
  const o = tool ? cutterOutline({ ...tool, gaugeLength: g || undefined }, holder) : null
  const prof = holder.profile.map((p) => ({ z: p.z + g, r: p.r }))
  const top = Math.max(1, ...prof.map((p) => p.z), g)
  const maxR = Math.max(1, ...prof.map((p) => p.r), o?.r ?? 0)
  const s = (size - 12) / Math.max(top, 2 * maxR)
  const X = (r: number) => size / 2 + r * s
  const Y = (z: number) => size - 6 - z * s
  const half = prof.map((p) => `${X(p.r)},${Y(p.z)}`).join(' ')
  const mirror = [...prof].reverse().map((p) => `${X(-p.r)},${Y(p.z)}`).join(' ')
  return (
    <svg width={size} height={size} className="shrink-0 rounded border bg-stone-50 dark:bg-stone-900" role="img" aria-label={`${holder.name} outline`}>
      <polygon points={`${X(0)},${Y(prof[0]?.z ?? 0)} ${half} ${X(0)},${Y(prof[prof.length - 1]?.z ?? 0)} ${mirror}`} fill="#94a3b8" fillOpacity={0.55} stroke="#475569" strokeWidth={1} />
      {o && g > 0 && (
        <>
          <rect x={X(-o.shankR)} y={Y(g)} width={2 * o.shankR * s} height={(g - Math.min(o.flute, g)) * s} fill="#a8a29e" />
          <rect x={X(-o.r)} y={Y(Math.min(o.flute, g))} width={2 * o.r * s} height={Math.min(o.flute, g) * s} fill="#f59e0b" fillOpacity={0.8} />
        </>
      )}
      <line x1={4} x2={size - 4} y1={Y(g)} y2={Y(g)} stroke="#64748b" strokeDasharray="3 3" strokeWidth={0.75} />
    </svg>
  )
}

export function HoldersSection({ machine, updateMachine }: { machine: MachineProfile; updateMachine: (fn: (m: MachineProfile) => void) => void }) {
  const units = useStore((s) => s.data?.settings.units ?? 'mm')
  const holders = machine.holders ?? []
  const [open, setOpen] = useState<string | null>(null)
  const items = machineUnconfirmed(machine)
  const used = (id: string) => machine.tools.filter((t) => t.holderId === id).length + (machine.defaultHolderId === id ? 1 : 0)
  const upd = (id: string, fn: (h: ToolHolder) => void) =>
    updateMachine((m) => {
      const h = m.holders?.find((x) => x.id === id)
      if (!h) return
      fn(h)
      // a measured outline typed in is the shop's own: no longer a placeholder (M2.6e)
      h.placeholder = false
      m.confirmed = [...new Set([...(m.confirmed ?? []), `holder:${id}`])]
    })
  return (
    <Section title="Holders" description="Revolved outlines of the tool holders: height above the holder face and radius, from the face up. The simulator draws them and the collision checks use them for every router.">
      <SelectField
        label="Default holder"
        value={machine.defaultHolderId ?? NONE}
        options={[{ value: NONE, label: 'None' }, ...holders.map((h) => ({ value: h.id, label: h.name }))]}
        onChange={(v) => updateMachine((m) => (v !== NONE ? (m.defaultHolderId = v) : delete m.defaultHolderId))}
        hint="Used by every router in the main spindle that names no holder of its own. None: such tools are checked without a holder (shank only)."
      />
      <div className="flex flex-col gap-2">
        {holders.map((h) => {
          const problems = holderProblems(h)
          const isOpen = open === h.id
          return (
            <div key={h.id} className="rounded-md border p-2" data-cfg={`holder:${h.id}`}>
              <div className="flex items-center gap-2">
                <HolderPreview holder={h} size={56} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1 text-sm font-medium">
                    {h.name}
                    {h.placeholder && <Badge variant="outline">placeholder</Badge>}
                    {machine.defaultHolderId === h.id && <Badge variant="secondary">default</Badge>}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {h.profile.length} points, {Math.max(0, ...h.profile.map((p) => p.z))} mm high, Ø{2 * Math.max(0, ...h.profile.map((p) => p.r))} mm{h.source ? ` · from ${h.source.file}` : ''}
                  </div>
                  <ValueBadges item={items.find((u) => u.key === `holder:${h.id}`)} />
                </div>
                <Button size="xs" variant="outline" onClick={() => setOpen(isOpen ? null : h.id)}>
                  {isOpen ? 'Close' : 'Edit'}
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Delete holder"
                  disabled={used(h.id) > 0}
                  title={used(h.id) ? 'In use by tools or as the default' : 'Delete'}
                  onClick={() => updateMachine((m) => void (m.holders = (m.holders ?? []).filter((x) => x.id !== h.id)))}
                >
                  <Trash2 />
                </Button>
              </div>
              {problems.length > 0 && <p className="mt-1 text-[11px] text-red-700">{problems.join(' ')}</p>}
              {isOpen && <HolderEditor holder={h} units={units} onName={(v) => upd(h.id, (x) => (x.name = v))} onProfile={(p) => upd(h.id, (x) => ((x.profile = p), delete x.source))} />}
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const id = `h-${nanoid(6)}`
            updateMachine((m) => void (m.holders = [...(m.holders ?? []), { id, name: 'New holder', placeholder: true, profile: [{ z: 0, r: 15 }, { z: 40, r: 15 }] }]))
            setOpen(id)
          }}
        >
          <Plus /> Add holder
        </Button>
        <HolderImport
          onHolder={(h) => {
            updateMachine((m) => void (m.holders = [...(m.holders ?? []), h]))
            setOpen(h.id)
          }}
        />
      </div>
    </Section>
  )
}

function HolderEditor({ holder, units, onName, onProfile }: { holder: ToolHolder; units: UnitSystem; onName: (v: string) => void; onProfile: (p: ToolHolder['profile']) => void }) {
  const p = holder.profile
  const set = (i: number, k: 'z' | 'r', v: number) => Number.isFinite(v) && onProfile(p.map((q, j) => (j === i ? { ...q, [k]: v } : q)))
  return (
    <div className="mt-2 flex flex-col gap-2">
      <TextField label="Name" value={holder.name} onChange={onName} />
      <div className="flex gap-3">
        <HolderPreview holder={holder} size={150} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-1 text-[11px] text-muted-foreground">
            <span>Height above face</span>
            <span>Radius</span>
            <span />
          </div>
          <div className="flex max-h-48 flex-col gap-1 overflow-auto">
            {p.map((q, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-1">
                <LenInput label={`Height ${i + 1}`} value={q.z} units={units} onChange={(v) => set(i, 'z', v)} className="w-full" />
                <LenInput label={`Radius ${i + 1}`} value={q.r} units={units} onChange={(v) => set(i, 'r', v)} className="w-full" />
                <Button size="icon-xs" variant="ghost" aria-label="Remove point" disabled={p.length <= 2} onClick={() => onProfile(p.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
          <Button size="xs" variant="outline" className="self-start" onClick={() => onProfile([...p, { z: (p[p.length - 1]?.z ?? 0) + 10, r: p[p.length - 1]?.r ?? 15 }])}>
            <Plus /> Point
          </Button>
          <p className="text-[11px] text-muted-foreground">Same height twice makes a step (a shoulder). Above the last point the holder is taken as going on up at that radius.</p>
        </div>
      </div>
    </div>
  )
}

/** Make a holder from a model file: its envelope round the file's vertical axis. */
function HolderImport({ onHolder }: { onHolder: (h: ToolHolder) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [up, setUp] = useState<UpAxis>('+z')
  const run = async (f: File) => {
    setBusy('Reading…')
    try {
      const bytes = new Uint8Array(await f.arrayBuffer())
      const client = isSolidFile(f.name) ? solidCompute() : compute()
      const r = await client.run('holder.fromModel', { bytes, name: f.name, up, step: 1, vendor: occtVendorUrl() }, { onProgress: (_f, n) => setBusy(n ?? 'Working…') })
      onHolder({ id: `h-${nanoid(6)}`, name: f.name.replace(/\.[^.]+$/, ''), profile: r.profile, source: { file: f.name, triangles: r.triangles, step: 1 } })
      toast.success(`Holder from ${f.name}: ${Math.round(r.height)} mm high, Ø${Math.round(r.maxR * 2)} mm`, { description: 'Outline = the widest point of the model in every 1 mm band (never smaller than the model). Check the holder face is at the bottom.' })
    } catch (e) {
      toast.error(`Could not make a holder from ${f.name}`, { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
      if (input.current) input.current.value = ''
    }
  }
  return (
    <div className="flex items-center gap-2">
      <input ref={input} type="file" accept=".stl,.obj,.3mf,.step,.stp,.iges,.igs,.brep,.brp" className="hidden" onChange={(e) => e.target.files?.[0] && void run(e.target.files[0])} />
      <Button size="sm" variant="outline" disabled={!!busy} onClick={() => input.current?.click()}>
        <FileUp /> {busy ?? 'Holder from a model…'}
      </Button>
      <select aria-label="Holder axis in the file" value={up} onChange={(e) => setUp(e.target.value as UpAxis)} className="h-8 rounded border bg-background px-1 text-xs">
        {(['+z', '-z', '+y', '-y', '+x', '-x'] as UpAxis[]).map((a) => (
          <option key={a} value={a}>
            axis {a}
          </option>
        ))}
      </select>
    </div>
  )
}
