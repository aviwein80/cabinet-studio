import { ScanSearch, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/app/store'
import { applyRules, recipesOf, ruleSetsOf } from '@/cam/rules'
import type { Recognition } from '@/cam/solid/recognize'
import type { FeatureRow } from '@/cam/solid/toPart'
import type { SolidData } from '@/cam/solid/types'
import type { CamPart, Entity, Layer, ModelRef } from '@/cam/types'
import { compute } from '@/cam/worker/client'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Cancelled } from '@/core/cancel'
import { featuresOf } from '@/core/features'
import type { UnitSystem } from '@/core/types'
import { formatLength } from '@/core/units'
import { TaskProgress } from './ModelImportDialog'
import { drillSizes, loadModelSolid } from './solidData'

interface Found {
  body: number
  recognition: Recognition
  layers: Layer[]
  entities: Entity[]
  outlineId: string
  rows: FeatureRow[]
}

/**
 * Feature recognition on a solid model (SOL-01): find outlines, cut-outs, pockets and holes, then
 * lay the part to the panel and put the features on layers (the layer rules then machine them).
 */
export function SolidFeatures({ part, model, units, onChange }: { part: CamPart; model: ModelRef; units: UnitSystem; onChange: (p: CamPart) => void }) {
  const machine = useStore((s) => s.data?.machine)
  const lib = useStore((s) => s.data?.library)
  const rulesOn = useStore((s) => featuresOf(s.data?.settings).camRules && featuresOf(s.data?.settings).camMachining)
  const [solid, setSolid] = useState<SolidData | null>(null)
  const [body, setBody] = useState<number | null>(null)
  const [found, setFound] = useState<Found | null>(null)
  const [busy, setBusy] = useState<{ fraction: number; note?: string; abort: AbortController } | null>(null)
  const [rules, setRules] = useState(true)
  const fmt = (n: number) => formatLength(n, units)

  const find = async (which?: number) => {
    const abort = new AbortController()
    setBusy({ fraction: 0, note: 'Loading the solid', abort })
    try {
      const s = solid ?? (await loadModelSolid(model.blob))
      setSolid(s)
      const b = which ?? body ?? s.bodies[0]?.index ?? 0
      setBody(b)
      const r = await compute().run('solid.recognize', { solid: { ...s, bodies: s.bodies.filter((x) => x.index === b) }, body: b, opt: drillSizes(machine), model: { id: model.id, blob: model.blob }, layers: part.layers }, { signal: abort.signal, onProgress: (fraction, note) => setBusy({ fraction, note, abort }) })
      setFound({ body: b, recognition: r.recognition, layers: r.layers!, entities: r.entities!, outlineId: r.outlineId!, rows: r.rows! })
    } catch (e) {
      if (!(e instanceof Cancelled)) toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  /** Lay the part to the panel: size, the model turned flat, the features on layers (earlier ones from this model replaced). */
  const use = () => {
    if (!found) return
    const f = found.recognition.frame
    const r6 = (n: number) => Math.round(n * 1e6) / 1e6
    const others = part.entities.filter((e) => e.solid?.modelId !== model.id && e.id !== part.outlineId)
    let next: CamPart = {
      ...part,
      length: r6(f.length),
      width: r6(f.width),
      thickness: r6(f.thickness),
      layers: found.layers,
      entities: [...others, ...found.entities],
      outlineId: found.outlineId,
      models: (part.models ?? []).map((m) => (m.id === model.id ? { ...m, place: { frame: [...f.R[0], ...f.R[1], ...f.R[2]], up: '+z' as const, rotZ: 0, scale: 1, mirror: false, at: [0, 0, 0] as [number, number, number] }, size: [r6(f.length), r6(f.width), r6(f.thickness)] as [number, number, number] } : m)),
      workVolume: undefined,
      updatedAt: new Date().toISOString(),
    }
    let msg = `${found.rows.length} features on layers; part ${fmt(next.length)} × ${fmt(next.width)} × ${fmt(next.thickness)}`
    if (rules && rulesOn && lib) {
      const set = ruleSetsOf(lib)[0]
      if (set) {
        const res = applyRules(next, set, recipesOf(lib))
        next = res.part
        msg += `; ${res.report.reduce((n, x) => n + x.ops, 0)} operation(s) from “${set.name}”`
        if (res.unmatched.length) msg += ` (not machined: ${res.unmatched.map((u) => u.layer).join(', ')})`
      }
    }
    if (others.length) msg += `. ${others.length} earlier shape(s) kept as drawn; check where they sit.`
    onChange(next)
    toast.success(msg)
  }

  const counts = found ? { holes: found.recognition.holes.length, pockets: found.recognition.pockets.length, cutouts: found.recognition.cutouts.length } : null
  return (
    <div className="grid gap-1.5 rounded border border-white/10 bg-white/[0.02] p-2">
      <div className="flex items-center gap-1.5">
        <ScanSearch className="size-3.5 text-amber-300" />
        <span className="flex-1 text-[10px] font-semibold tracking-wider text-stone-400 uppercase">Features</span>
        {solid && solid.bodies.length > 1 && (
          <Select value={String(body ?? solid.bodies[0].index)} onValueChange={(v) => void find(Number(v))}>
            <SelectTrigger size="sm" className="h-6 max-w-36 text-[11px]" aria-label="Body to recognise">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {solid.bodies.map((b) => (
                <SelectItem key={b.index} value={String(b.index)}>
                  {b.name || `Body ${b.index + 1}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button size="xs" variant="secondary" disabled={!!busy} onClick={() => void find()}>
          Find features
        </Button>
      </div>
      {busy && <TaskProgress fraction={busy.fraction} note={busy.note} onCancel={() => busy.abort.abort()} />}
      {found && counts && (
        <>
          <div className="text-[11px] text-stone-300">
            Panel {fmt(found.recognition.frame.length)} × {fmt(found.recognition.frame.width)} × {fmt(found.recognition.frame.thickness)}: {counts.holes} hole{counts.holes === 1 ? '' : 's'}, {counts.pockets} pocket{counts.pockets === 1 ? '' : 's'}, {counts.cutouts} cut-out{counts.cutouts === 1 ? '' : 's'}
          </div>
          <div className="max-h-48 overflow-auto rounded border border-white/5">
            <table className="w-full text-[10.5px]">
              <thead className="sticky top-0 bg-[#1b1d22] text-stone-500">
                <tr>
                  <th className="px-1.5 py-1 text-left font-medium">Feature</th>
                  <th className="px-1.5 py-1 text-left font-medium">Layer</th>
                  <th className="px-1 py-1 text-right font-medium">Face</th>
                  <th className="px-1.5 py-1 text-left font-medium">Size</th>
                  <th className="px-1.5 py-1 text-right font-medium">Depth</th>
                </tr>
              </thead>
              <tbody>
                {groupRows(found.rows).map((r) => (
                  <tr key={`${r.layer}|${r.size}|${r.face}`} className="border-t border-white/5 text-stone-300">
                    <td className="px-1.5 py-0.5">
                      {r.kind}
                      {r.n > 1 ? ` × ${r.n}` : ''}
                    </td>
                    <td className="px-1.5 py-0.5 font-mono text-[10px] text-stone-400">{r.layer}</td>
                    <td className="px-1 py-0.5 text-right">{r.face}</td>
                    <td className="px-1.5 py-0.5">{r.size}</td>
                    <td className="px-1.5 py-0.5 text-right">{r.depth !== undefined ? fmt(r.depth) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {found.recognition.warnings.map((w) => (
            <div key={w} className="text-[10.5px] text-amber-200">
              {w}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            {rulesOn && (
              <label className="flex items-center gap-1.5 text-[11px] text-stone-300">
                <Switch checked={rules} onCheckedChange={setRules} aria-label="Apply the layer rules" /> Apply layer rules
              </label>
            )}
            <Button size="xs" onClick={use}>
              <Wand2 /> Lay flat and use as the part
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

/** Same layer, face and size counted once (26 system holes are one line). */
function groupRows(rows: FeatureRow[]) {
  const out: (FeatureRow & { n: number })[] = []
  for (const r of rows) {
    const same = out.find((x) => x.layer === r.layer && x.size === r.size && x.face === r.face && x.kind === r.kind)
    if (same) same.n++
    else out.push({ ...r, n: 1 })
  }
  return out
}
