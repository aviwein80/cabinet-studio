/**
 * Geometry queries (CAD-17): find shapes, faces of a solid model, or models by their facts
 * (field, operator, value), then select them, move them to a layer, or keep the query as an
 * auto-query in a rule table (it then runs on every import before the rules).
 */
import { Plus, Search, Trash2 } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/app/store'
import { ensureLayer, FIELDS_OF, moveShapesToLayer, queryFaces, queryModels, queryShapes } from '@/cam/query'
import { BUILTIN_RECIPES, BUILTIN_RULESETS, ruleSetsOf } from '@/cam/rules'
import { sendFacesToLayer } from '@/cam/solid/faces'
import type { SolidData } from '@/cam/solid/types'
import type { CamPart, GeoQuery, GeoTest, QueryOp } from '@/cam/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatLength, parseLength } from '@/core/units'
import type { UnitSystem } from '@/core/types'
import { loadModelSolid } from './solidData'
import { enterApplies } from '@/components/enterApplies'

const OPS: { value: QueryOp; label: string; kinds: string[] }[] = [
  { value: '=', label: 'is', kinds: ['text', 'number', 'length', 'bool'] },
  { value: '!=', label: 'is not', kinds: ['text', 'number', 'length', 'bool'] },
  { value: '<', label: 'less than', kinds: ['number', 'length'] },
  { value: '<=', label: 'at most', kinds: ['number', 'length'] },
  { value: '>', label: 'more than', kinds: ['number', 'length'] },
  { value: '>=', label: 'at least', kinds: ['number', 'length'] },
  { value: 'between', label: 'between', kinds: ['number', 'length'] },
  { value: 'in', label: 'one of (a, b, …)', kinds: ['text', 'number', 'length'] },
  { value: 'contains', label: 'contains', kinds: ['text'] },
  { value: '!contains', label: 'does not contain', kinds: ['text'] },
  { value: 'matches', label: 'matches pattern', kinds: ['text'] },
  { value: '!matches', label: 'does not match', kinds: ['text'] },
]
const sel = 'h-7 rounded border border-white/10 bg-black/30 px-1 text-xs'

export function QueryDialog({ part, units, onClose, onChange, onSelect }: { part: CamPart; units: UnitSystem; onClose: () => void; onChange: (p: CamPart) => void; onSelect: (ids: string[]) => void }) {
  const { data, updateLibrary } = useStore()
  const [q, setQ] = useState<GeoQuery>({ id: nanoid(8), name: 'New query', target: 'shapes', match: 'all', tests: [{ field: 'type', op: '=', value: 'circle' }], resultLayer: 'DRILL' })
  const solids = (part.models ?? []).filter((m) => m.kind === 'solid')
  const [modelId, setModelId] = useState(solids[0]?.id ?? '')
  const [solid, setSolid] = useState<{ id: string; data: SolidData } | null>(null)
  const [setId, setSetId] = useState('')
  const fields = FIELDS_OF[q.target]
  const model = solids.find((m) => m.id === modelId)

  const blob = model?.blob
  useEffect(() => {
    if (q.target !== 'faces' || !blob || solid?.id === blob) return
    let live = true
    loadModelSolid(blob).then(
      (d) => live && setSolid({ id: blob, data: d }),
      (e) => toast.error(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      live = false
    }
  }, [q.target, blob, solid?.id])

  const found = (() => {
    if (q.target === 'shapes') return queryShapes(part, q)
    if (q.target === 'models') return queryModels(part, q)
    if (!model || !solid || solid.id !== model.blob) return null
    return queryFaces(part, model, solid.data, q).map(String)
  })()

  const setTest = (i: number, patch: Partial<GeoTest>) => setQ({ ...q, tests: q.tests.map((t, k) => (k === i ? { ...t, ...patch } : t)) })
  const kindOf = (field: string) => fields.find((f) => f.key === field)?.kind ?? 'text'
  const show = (t: GeoTest, v: GeoTest['value'] | undefined) => (v === undefined ? '' : kindOf(t.field) === 'length' && typeof v === 'number' ? formatLength(v, units) : String(v))
  const read = (t: GeoTest, text: string): GeoTest['value'] => {
    const k = kindOf(t.field)
    if (k === 'bool') return text === 'true'
    if (t.op === 'in' || t.op === 'contains' || t.op === '!contains' || t.op === 'matches' || t.op === '!matches') return text
    if (k === 'length') return parseLength(text, units) ?? text
    if (k === 'number') return Number.isFinite(Number(text)) ? Number(text) : text
    return text
  }

  const apply = () => {
    if (!found || !q.resultLayer) return
    if (q.target === 'shapes') {
      onChange(moveShapesToLayer(part, found, q.resultLayer))
      toast.success(`${found.length} shape(s) moved to ${q.resultLayer}`)
    } else if (q.target === 'models') {
      const { part: withLayer, id } = ensureLayer(part, q.resultLayer)
      onChange({ ...withLayer, models: (withLayer.models ?? []).map((m) => (found.includes(m.id) ? { ...m, layer: id } : m)) })
      toast.success(`${found.length} model(s) put on ${q.resultLayer}`)
    } else if (model && solid) {
      const r = sendFacesToLayer(part, model, solid.data, found.map(Number), q.resultLayer)
      onChange(r.part)
      toast.success(`${found.length} face(s) sent to ${q.resultLayer}: ${r.entities.length} shape(s)`, { description: r.warnings.join(' ') || undefined })
    }
  }

  const sets = data ? ruleSetsOf(data.library) : []
  const saveAuto = () => {
    const sid = setId || sets[0]?.id
    if (!sid || q.target !== 'shapes' || !q.resultLayer) return
    updateLibrary((l) => {
      l.recipes = l.recipes ?? structuredClone(BUILTIN_RECIPES)
      l.layerRules = l.layerRules ?? structuredClone(BUILTIN_RULESETS)
      const s = l.layerRules.find((x) => x.id === sid)
      if (s) s.queries = [...(s.queries ?? []).filter((x) => x.id !== q.id), structuredClone(q)]
    })
    toast.success(`Saved as an auto-query in “${sets.find((x) => x.id === sid)?.name}”`, { description: 'It runs before the rules whenever that rule table is applied.' })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="dark border-white/10 bg-[#15171c] text-stone-100 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="size-4" /> Geometry query
          </DialogTitle>
          <DialogDescription className="text-stone-400">Find shapes, faces of a solid, or models by their facts. Patterns: exact, wildcards (POCKET*) or /regular expressions/.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <input aria-label="Query name" value={q.name} onChange={(e) => setQ({ ...q, name: e.target.value })} className="h-7 w-44 rounded border border-white/10 bg-black/30 px-1.5" />
            Find
            <select aria-label="Find what" className={sel} value={q.target} onChange={(e) => setQ({ ...q, target: e.target.value as GeoQuery['target'], tests: [{ field: FIELDS_OF[e.target.value as GeoQuery['target']][0].key, op: '=', value: '' }] })}>
              <option value="shapes">shapes</option>
              <option value="faces" disabled={!solids.length}>
                faces of a solid
              </option>
              <option value="models" disabled={!part.models?.length}>
                models
              </option>
            </select>
            {q.target === 'faces' && (
              <select aria-label="Solid model" className={sel} value={modelId} onChange={(e) => setModelId(e.target.value)}>
                {solids.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
            where
            <select aria-label="All or any" className={sel} value={q.match} onChange={(e) => setQ({ ...q, match: e.target.value as GeoQuery['match'] })}>
              <option value="all">all tests pass</option>
              <option value="any">any test passes</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            {q.tests.map((t, i) => {
              const k = kindOf(t.field)
              const opts = fields.find((f) => f.key === t.field)?.options
              return (
                <div key={i} className="flex flex-wrap items-center gap-1.5">
                  <select aria-label={`Field ${i + 1}`} className={sel} value={t.field} onChange={(e) => setTest(i, { field: e.target.value, value: kindOf(e.target.value) === 'bool' ? true : '' })}>
                    {fields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <select aria-label={`Operator ${i + 1}`} className={sel} value={t.op} onChange={(e) => setTest(i, { op: e.target.value as QueryOp })}>
                    {OPS.filter((o) => o.kinds.includes(k)).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {k === 'bool' ? (
                    <select aria-label={`Value ${i + 1}`} className={sel} value={String(t.value)} onChange={(e) => setTest(i, { value: e.target.value === 'true' })}>
                      <option value="true">yes</option>
                      <option value="false">no</option>
                    </select>
                  ) : (
                    <>
                      <input aria-label={`Value ${i + 1}`} list={opts ? `opts-${i}` : undefined} defaultValue={show(t, t.value)} key={`${t.field}${t.op}`} onKeyDown={enterApplies} onBlur={(e) => setTest(i, { value: read(t, e.target.value) })} className="h-7 w-32 rounded border border-white/10 bg-black/30 px-1.5" />
                      {opts && (
                        <datalist id={`opts-${i}`}>
                          {opts.map((o) => (
                            <option key={o} value={o} />
                          ))}
                        </datalist>
                      )}
                      {t.op === 'between' && (
                        <>
                          and
                          <input aria-label={`Upper value ${i + 1}`} defaultValue={show(t, t.value2)} onKeyDown={enterApplies} onBlur={(e) => setTest(i, { value2: Number(read(t, e.target.value)) })} className="h-7 w-24 rounded border border-white/10 bg-black/30 px-1.5" />
                        </>
                      )}
                    </>
                  )}
                  <Button size="icon-xs" variant="ghost" aria-label="Remove test" onClick={() => setQ({ ...q, tests: q.tests.filter((_, j) => j !== i) })}>
                    <Trash2 />
                  </Button>
                </div>
              )
            })}
            <Button size="xs" variant="outline" className="self-start border-white/15 bg-transparent" onClick={() => setQ({ ...q, tests: [...q.tests, { field: fields[0].key, op: '=', value: '' }] })}>
              <Plus /> Test
            </Button>
          </div>
          <div className="rounded-md border border-white/10 bg-black/20 p-2" data-testid="query-result">
            {found === null ? 'Loading the solid model…' : `${found.length} ${q.target === 'shapes' ? 'shape' : q.target === 'faces' ? 'face' : 'model'}(s) found.`}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            Result layer
            <input aria-label="Result layer" value={q.resultLayer ?? ''} onChange={(e) => setQ({ ...q, resultLayer: e.target.value })} className="h-7 w-40 rounded border border-white/10 bg-black/30 px-1.5 font-mono" />
            <Button size="sm" variant="outline" className="border-white/15 bg-transparent" disabled={!found?.length || !q.resultLayer} onClick={apply}>
              {q.target === 'faces' ? 'Send faces to the layer' : q.target === 'models' ? 'Put models on the layer' : 'Move shapes to the layer'}
            </Button>
            {q.target === 'shapes' && (
              <Button size="sm" variant="outline" className="border-white/15 bg-transparent" disabled={!found?.length} onClick={() => onSelect(found ?? [])}>
                Select them
              </Button>
            )}
          </div>
          {q.target === 'shapes' && (
            <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-2 text-stone-400">
              Keep as an auto-query in
              <select aria-label="Rule table" className={sel} value={setId || sets[0]?.id} onChange={(e) => setSetId(e.target.value)}>
                {sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="outline" className="border-white/15 bg-transparent" disabled={!q.resultLayer} onClick={saveAuto}>
                Save
              </Button>
              <span>(runs before the rules on every import; edit under Library → Rules)</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
