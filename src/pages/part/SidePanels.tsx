import { Eye, EyeOff, Lock, Plus, Trash2, Unlock } from 'lucide-react'
import { nanoid } from 'nanoid'
import { moveToLayer, setArcRadius, toggleArc, insertNode, deleteNode, nodesOf } from '@/cam/cad'
import { entityContours, fitWorkVolume, partOutline, resizePart } from '@/cam/doc'
import { evaluate, resolveVariables } from '@/cam/expr'
import { area, boxOf, contourLength, radius } from '@/cam/geom'
import type { CamPart, Entity, FaceId, Layer, LineType, StrokeFont } from '@/cam/types'
import { embedFont } from '@/cam/font'
import { LINE_TYPES } from '@/cam/annotate'
import { NONE, NumField, SelectField, TextField } from '@/components/fields'
import { Button } from '@/components/ui/button'
import { deletePoint3d, insertPoint3d, movePoint3d, poly3dLength } from '@/cam/mesh/poly3d'
import { Input } from '@/components/ui/input'
import type { Material, UnitSystem } from '@/core/types'
import { formatLength } from '@/core/units'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useStore } from '@/app/store'
import { doorStylesOf, rebuildDoor } from '@/cam/doors'
import { recipesOf } from '@/cam/rules'

const LAYER_COLORS = ['#e2e8f0', '#38bdf8', '#f59e0b', '#a78bfa', '#34d399', '#f472b6', '#fb7185', '#facc15']

export function LayersPanel({ part, current, setCurrent, sel, onChange }: { part: CamPart; current: string; setCurrent: (id: string) => void; sel: string[]; onChange: (p: CamPart) => void }) {
  const setLayer = (id: string, patch: Partial<Layer>) => onChange({ ...part, layers: part.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) })
  const count = (id: string) => part.entities.filter((e) => e.layer === id).length
  return (
    <div className="flex flex-col">
      {part.layers.map((l) => (
        <div key={l.id} className={cn('flex items-center gap-2 border-b border-white/5 px-3 py-1.5 text-xs', current === l.id && 'bg-white/10')}>
          <input type="color" aria-label={`${l.name} colour`} value={l.color} onChange={(e) => setLayer(l.id, { color: e.target.value })} className="size-4 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" />
          <input className="min-w-0 flex-1 bg-transparent text-stone-100 outline-none focus:bg-white/5" value={l.name} onChange={(e) => setLayer(l.id, { name: e.target.value })} onFocus={() => setCurrent(l.id)} />
          <span className="w-6 text-right text-[10px] text-stone-500 tabular-nums">{count(l.id)}</span>
          <select
            aria-label={`${l.name} line type`}
            title="Line type, on screen and in prints"
            className="w-14 rounded border border-white/10 bg-black/30 px-0.5 text-[10px] text-stone-300"
            value={l.lineType ?? 'solid'}
            onChange={(e) => setLayer(l.id, { lineType: e.target.value === 'solid' ? undefined : (e.target.value as LineType) })}
          >
            {(Object.keys(LINE_TYPES) as LineType[]).map((t) => (
              <option key={t} value={t}>
                {LINE_TYPES[t].label}
              </option>
            ))}
          </select>
          <button aria-label="Visible" className="text-stone-400 hover:text-white" onClick={() => setLayer(l.id, { visible: !l.visible })}>
            {l.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
          </button>
          <button aria-label="Locked" className="text-stone-400 hover:text-white" onClick={() => setLayer(l.id, { locked: !l.locked })}>
            {l.locked ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
          </button>
          <button
            aria-label="Delete layer"
            className="text-stone-500 hover:text-red-400 disabled:opacity-30"
            disabled={count(l.id) > 0 || part.layers.length <= 1}
            onClick={() => onChange({ ...part, layers: part.layers.filter((x) => x.id !== l.id) })}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-1.5 px-3 py-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 border-white/15 bg-transparent text-xs"
          onClick={() => {
            const id = nanoid(6)
            onChange({ ...part, layers: [...part.layers, { id, name: `Layer ${part.layers.length + 1}`, color: LAYER_COLORS[part.layers.length % LAYER_COLORS.length], visible: true, locked: false }] })
            setCurrent(id)
          }}
        >
          <Plus className="size-3.5" /> Layer
        </Button>
        <Button size="sm" variant="outline" className="h-7 border-white/15 bg-transparent text-xs" disabled={!sel.length} onClick={() => onChange(moveToLayer(part, sel, current))}>
          Move selection here
        </Button>
      </div>
      <p className="px-3 pb-3 text-[11px] leading-snug text-stone-500">New shapes go on the highlighted layer. Construction layers are drawn dashed and never machined. A layer's line type shows on screen and in prints (dashes in paper mm).</p>
    </div>
  )
}

export function PropertiesPanel({
  part,
  sel,
  units,
  materials,
  nodeSeg,
  onChange,
  onFit,
}: {
  part: CamPart
  sel: string[]
  units: UnitSystem
  materials: Material[]
  nodeSeg: { id: string; seg: number } | null
  onChange: (p: CamPart) => void
  onFit: () => void
}) {
  const one = sel.length === 1 ? part.entities.find((e) => e.id === sel[0]) : undefined
  const fmt = (n: number) => formatLength(n, units)
  const outline = partOutline(part)
  const vars = resolveVariables(part.variables, { L: part.length, W: part.width, T: part.thickness })
  return (
    <div className="flex flex-col">
      {one && <EntityProps e={one} part={part} fmt={fmt} nodeSeg={nodeSeg} onChange={onChange} />}
      {sel.length > 1 && (
        <div className="border-b border-white/10 px-4 py-3 text-xs text-stone-300">
          {sel.length} shapes selected · {(() => {
            const b = boxOf(part.entities.filter((e) => sel.includes(e.id)).flatMap(entityContours))
            return Number.isFinite(b.minX) ? `${fmt(b.maxX - b.minX)} × ${fmt(b.maxY - b.minY)}` : ''
          })()}
        </div>
      )}
      <section className="border-b border-white/10 px-4 py-3">
        <h4 className="mb-2 text-[11px] font-semibold tracking-wider text-stone-400 uppercase">Part</h4>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          <TextField className="col-span-2" label="Name" value={part.name} onChange={(v) => onChange({ ...part, name: v })} />
          <NumField label="Length (X)" value={part.length} min={1} onChange={(v) => onChange(resizePart(part, { length: v }))} />
          <NumField label="Width (Y)" value={part.width} min={1} onChange={(v) => onChange(resizePart(part, { width: v }))} />
          <NumField label="Thickness" value={part.thickness} min={1} onChange={(v) => onChange({ ...part, thickness: v })} />
          <NumField label="Quantity" suffix="pcs" value={part.qty} min={1} onChange={(v) => onChange({ ...part, qty: Math.max(1, Math.round(v)) })} />
          <SelectField
            className="col-span-2"
            label="Material"
            value={part.materialId ?? NONE}
            options={[{ value: NONE, label: 'Not set' }, ...materials.map((m) => ({ value: m.id, label: `${m.code} · ${m.name}` }))]}
            onChange={(v) => {
              const m = materials.find((x) => x.id === v)
              onChange({ ...part, materialId: v === NONE ? null : v, thickness: m?.thickness ?? part.thickness, grain: m ? (m.grain ? 'length' : 'none') : part.grain })
            }}
          />
          <NumField label="Nest priority" suffix="" value={part.priority ?? 0} min={0} max={99} onChange={(v) => onChange({ ...part, priority: Math.max(0, Math.round(v)) || undefined })} hint="Higher goes on earlier sheets" />
          <TextField label="Kit" value={part.kit ?? ''} placeholder="none" onChange={(v) => onChange({ ...part, kit: v.trim() ? v : undefined })} hint="Same kit, same sheet" />
          <SelectField label="Grain" value={part.grain} options={[{ value: 'length', label: 'Along X' }, { value: 'none', label: 'No grain' }]} onChange={(v) => onChange({ ...part, grain: v })} />
          <div className="flex items-end">
            <Button size="sm" variant="outline" className="h-8 w-full border-white/15 bg-transparent text-xs" onClick={() => (onChange(fitWorkVolume(part)), onFit())} disabled={!outline.entity}>
              Fit to outline
            </Button>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-stone-500">
          Outline: {outline.entity ? `${fmt(boxOf([outline.contour]).maxX - boxOf([outline.contour]).minX)} × ${fmt(boxOf([outline.contour]).maxY - boxOf([outline.contour]).minY)}` : 'none drawn (the work rectangle is used)'}
        </p>
      </section>
      {part.door && <DoorSection part={part} onChange={onChange} />}
      <section className="px-4 py-3">
        <h4 className="mb-1 text-[11px] font-semibold tracking-wider text-stone-400 uppercase">Variables</h4>
        <p className="mb-2 text-[11px] leading-snug text-stone-500">Use them in any typed value, e.g. “W/2 - rail”. L, W and T are the part size.</p>
        <div className="flex flex-col gap-1.5">
          {part.variables.map((v, i) => {
            let bad = false
            try {
              if (v.expr) evaluate(v.expr, vars)
            } catch {
              bad = true
            }
            return (
              <div key={i} className="flex items-center gap-1.5">
                <Input className="h-7 w-20 bg-transparent font-mono text-xs" value={v.name} onChange={(e) => onChange({ ...part, variables: part.variables.map((x, j) => (j === i ? { ...x, name: e.target.value.replace(/[^A-Za-z0-9_]/g, '') } : x)) })} />
                <Input
                  className={cn('h-7 min-w-0 flex-1 bg-transparent font-mono text-xs', bad && 'border-red-500')}
                  value={v.expr ?? String(v.value)}
                  onChange={(e) => {
                    const t = e.target.value
                    const n = Number(t)
                    onChange({ ...part, variables: part.variables.map((x, j) => (j === i ? (Number.isFinite(n) && t.trim() !== '' ? { name: x.name, value: n } : { ...x, expr: t }) : x)) })
                  }}
                />
                <span className="w-14 text-right text-[11px] text-stone-400 tabular-nums">{Number.isFinite(vars[v.name]) ? Math.round(vars[v.name] * 100) / 100 : '?'}</span>
                <button aria-label="Remove variable" className="text-stone-500 hover:text-red-400" onClick={() => onChange({ ...part, variables: part.variables.filter((_, j) => j !== i) })}>
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            )
          })}
          <Button size="sm" variant="outline" className="h-7 w-fit gap-1 border-white/15 bg-transparent text-xs" onClick={() => onChange({ ...part, variables: [...part.variables, { name: `v${part.variables.length + 1}`, value: 0 }] })}>
            <Plus className="size-3.5" /> Variable
          </Button>
        </div>
      </section>
    </div>
  )
}

function DoorSection({ part, onChange }: { part: CamPart; onChange: (p: CamPart) => void }) {
  const lib = useStore((s) => s.data?.library)
  const styles = lib ? doorStylesOf(lib) : []
  const style = styles.find((s) => s.id === part.door?.styleId)
  const rebuild = () => {
    if (!lib) return
    const r = rebuildDoor(part, styles, recipesOf(lib))
    if (!r) return void toast.error('This door style is no longer in the library.')
    onChange(r.part)
    if (r.warnings.length) toast.warning('Door rebuilt with warnings', { description: r.warnings.join(' ') })
    else toast.success('Door rebuilt from its variables')
  }
  return (
    <section className="border-b border-white/10 px-4 py-3">
      <h4 className="mb-1 text-[11px] font-semibold tracking-wider text-stone-400 uppercase">Door</h4>
      <p className="mb-2 text-[11px] leading-snug text-stone-500">
        {style ? `${style.name} style.` : 'Style not found.'} Change W, H or the style variables below, then rebuild. Hand edits to the outline, field and hardware are replaced.
      </p>
      <Button size="sm" variant="outline" className="h-7 border-white/15 bg-transparent text-xs" onClick={rebuild} disabled={!style}>
        Rebuild from variables
      </Button>
    </section>
  )
}

function EntityProps({ e, part, fmt, nodeSeg, onChange }: { e: Entity; part: CamPart; fmt: (n: number) => string; nodeSeg: { id: string; seg: number } | null; onChange: (p: CamPart) => void }) {
  const g = e.g
  const cs = entityContours(e)
  const b = boxOf(cs)
  const setE = (patch: Partial<Entity>) => onChange({ ...part, entities: part.entities.map((x) => (x.id === e.id ? { ...x, ...patch } : x)) })
  const fonts = useStore((s) => s.data?.library.fonts) ?? []
  // new letters in a text set in a font: taken from the library font while it is there, else the kept copy stays
  const refont = (kept: StrokeFont, text: string): StrokeFont => {
    const lib = fonts.find((f) => f.id === kept.id)
    return lib ? embedFont(lib, text) : kept
  }
  const seg = nodeSeg?.id === e.id && e.g.t === 'contour' ? e.g.c.segs[nodeSeg.seg] : undefined
  const kind = e.g.t === 'contour' ? (e.g.c.closed ? 'Closed shape' : 'Open path') : { circle: 'Circle', point: 'Point', text: 'Text', spline: 'Spline', poly3d: '3D polyline' }[e.g.t]
  return (
    <section className="border-b border-white/10 px-4 py-3">
      <h4 className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-wider text-stone-400 uppercase">
        {kind}
        {part.outlineId === e.id && <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] tracking-normal text-amber-300 normal-case">Part outline</span>}
      </h4>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        <SelectField label="Layer" value={e.layer} options={part.layers.map((l) => ({ value: l.id, label: l.name }))} onChange={(v) => setE({ layer: v })} />
        <SelectField label="Face" value={String(e.face)} options={[1, 2, 3, 4, 5, 6].map((f) => ({ value: String(f), label: `Face ${f}` }))} onChange={(v) => setE({ face: Number(v) as FaceId })} />
        {g.t === 'circle' && (
          <>
            <NumField label="Centre X" value={g.c.x} onChange={(v) => setE({ g: { ...g, c: { x: v, y: g.c.y } } })} />
            <NumField label="Centre Y" value={g.c.y} onChange={(v) => setE({ g: { ...g, c: { x: g.c.x, y: v } } })} />
            <NumField label="Diameter" value={g.r * 2} min={0.01} onChange={(v) => setE({ g: { ...g, r: v / 2 } })} />
            <NumField label="Hole depth" value={e.depth ?? 0} min={0} onChange={(v) => setE({ depth: v || undefined })} hint="Used by drilling when set" />
          </>
        )}
        {g.t === 'poly3d' && (
          <div className="col-span-2 grid gap-1">
            {g.pts.map((q, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto_auto] items-end gap-1">
                <NumField label={i ? '' : 'X'} value={q[0]} onChange={(v) => setE({ g: movePoint3d(e, i, [v, q[1], q[2]]).g })} />
                <NumField label={i ? '' : 'Y'} value={q[1]} onChange={(v) => setE({ g: movePoint3d(e, i, [q[0], v, q[2]]).g })} />
                <NumField label={i ? '' : 'Z'} value={q[2]} onChange={(v) => setE({ g: movePoint3d(e, i, [q[0], q[1], v]).g })} />
                <Button size="icon-xs" variant="ghost" aria-label={`Add a point after point ${i + 1}`} onClick={() => setE({ g: insertPoint3d(e, i).g })}>
                  +
                </Button>
                <Button size="icon-xs" variant="ghost" aria-label={`Remove point ${i + 1}`} disabled={g.pts.length <= 2} onClick={() => setE({ g: deletePoint3d(e, i).g })}>
                  −
                </Button>
              </div>
            ))}
            <div className="text-[11px] text-stone-400">Length {fmt(poly3dLength(g.pts))} in 3D</div>
          </div>
        )}
        {g.t === 'text' && (
          <>
            <TextField className="col-span-2" label="Text" value={g.text} onChange={(v) => setE({ g: { ...g, text: v, ...(g.font ? { font: refont(g.font, v) } : {}) } })} />
            <SelectField
              className="col-span-2"
              label="Font"
              value={g.font?.id ?? ''}
              options={[{ value: '', label: 'Built-in' }, ...fonts.map((f) => ({ value: f.id, label: f.name })), ...(g.font && !fonts.some((f) => f.id === g.font!.id) ? [{ value: g.font.id, label: `${g.font.name} (kept with the text)` }] : [])]}
              onChange={(id) => {
                const f = fonts.find((x) => x.id === id)
                const { font: _drop, ...rest } = g
                setE({ g: f ? { ...rest, font: embedFont(f, g.text) } : id && g.font?.id === id ? g : rest })
              }}
            />
            <NumField label="Height" value={g.height} min={1} onChange={(v) => setE({ g: { ...g, height: v } })} />
            <NumField label="Angle" suffix="°" value={Math.round(((g.angle * 180) / Math.PI) * 100) / 100} onChange={(v) => setE({ g: { ...g, angle: (v * Math.PI) / 180 } })} />
          </>
        )}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-stone-400">
        {Number.isFinite(b.minX) && (
          <>
            <dt>Size</dt>
            <dd className="text-right text-stone-200 tabular-nums">
              {fmt(b.maxX - b.minX)} × {fmt(b.maxY - b.minY)}
            </dd>
            <dt>From origin</dt>
            <dd className="text-right text-stone-200 tabular-nums">
              {fmt(b.minX)}, {fmt(b.minY)}
            </dd>
          </>
        )}
        {cs.length > 0 && (
          <>
            <dt>Length</dt>
            <dd className="text-right text-stone-200 tabular-nums">{fmt(cs.reduce((n, c) => n + contourLength(c), 0))}</dd>
          </>
        )}
        {e.g.t === 'contour' && (
          <>
            <dt>Elements</dt>
            <dd className="text-right text-stone-200 tabular-nums">
              {e.g.c.segs.filter((s) => s.k === 'L').length} lines, {e.g.c.segs.filter((s) => s.k === 'A').length} arcs
            </dd>
            {e.g.c.closed && (
              <>
                <dt>Area</dt>
                <dd className="text-right text-stone-200 tabular-nums">{(Math.abs(area(e.g.c)) / 1e6).toFixed(4)} m²</dd>
              </>
            )}
          </>
        )}
      </dl>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {e.g.t === 'contour' && e.g.c.closed && part.outlineId !== e.id && (
          <Button size="sm" variant="outline" className="h-7 border-white/15 bg-transparent text-xs" onClick={() => onChange({ ...part, outlineId: e.id })}>
            Use as part outline
          </Button>
        )}
      </div>
      {seg && nodeSeg && (
        <div className="mt-3 rounded-md border border-pink-400/30 bg-pink-500/5 p-2.5">
          <div className="mb-2 text-[11px] font-medium text-pink-200">
            Segment {nodeSeg.seg + 1}: {seg.k === 'L' ? 'line' : `arc R ${fmt(radius(seg))}`}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {seg.k === 'A' && <NumField className="col-span-2" label="Radius" value={radius(seg)} min={0.01} onChange={(v) => onChange(setArcRadius(part, e.id, nodeSeg.seg, v))} />}
            <Button size="sm" variant="outline" className="h-7 border-white/15 bg-transparent text-xs" onClick={() => onChange(toggleArc(part, e.id, nodeSeg.seg))}>
              {seg.k === 'L' ? 'Make arc' : 'Make line'}
            </Button>
            <Button size="sm" variant="outline" className="h-7 border-white/15 bg-transparent text-xs" onClick={() => onChange(insertNode(part, e.id, nodeSeg.seg))}>
              Add node
            </Button>
            <Button size="sm" variant="outline" className="col-span-2 h-7 border-white/15 bg-transparent text-xs" disabled={nodesOf(e).length <= 3} onClick={() => onChange(deleteNode(part, e.id, (nodeSeg.seg + 1) % nodesOf(e).length))}>
              Remove end node
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
