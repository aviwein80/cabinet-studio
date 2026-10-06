/**
 * Stroke font editor (NEW-24): single-stroke engraving fonts. Each glyph is drawn as strokes
 * (click points on the grid; a new stroke lifts the pen), with its own advance. Text set in a font
 * keeps a copy of the glyphs it uses, so editing a font here never changes parts already drawn.
 */
import { Copy, FileDown, FileUp, Plus, Trash2, Undo2 } from 'lucide-react'
import { type MouseEvent, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { backend } from '@/app/backend'
import { useStore } from '@/app/store'
import { BUILTIN_FONT, fontFromJson, fontToJson, glyphAddPoint, glyphNewStroke, glyphRemoveStroke, glyphUndo, newFont, strokeText } from '@/cam/font'
import { toPoints } from '@/cam/geom'
import type { StrokeFont } from '@/cam/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const CHARSET = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', ...'-.,/:()+=_#\'"!?&@*'.split('')]

export function FontsTab() {
  const fonts = useStore((s) => s.data?.library.fonts) ?? []
  const updateLibrary = useStore((s) => s.updateLibrary)
  const [selId, setSelId] = useState<string | null>(null)
  const [ch, setCh] = useState('A')
  const [preview, setPreview] = useState('CABINET 123')
  const [snap, setSnap] = useState(0.5)
  const fileInput = useRef<HTMLInputElement>(null)
  const font = fonts.find((f) => f.id === selId) ?? fonts[0] ?? null

  const save = (f: StrokeFont) => updateLibrary((l) => void (l.fonts = (l.fonts ?? []).map((x) => (x.id === f.id ? f : x))))
  const add = (f: StrokeFont) => {
    updateLibrary((l) => void (l.fonts = [...(l.fonts ?? []), f]))
    setSelId(f.id)
  }
  const exportFont = async () => {
    if (!font) return
    const where = await backend.saveFile({ name: `${font.name.replace(/[^\w-]+/g, '-') || 'font'}.json`, data: fontToJson(font) }, [{ name: 'Stroke font', extensions: ['json'] }])
    if (where) toast.success(`Font saved to ${where}`)
  }
  const importFont = async (file: File) => {
    const r = fontFromJson(await file.text())
    if (fileInput.current) fileInput.current.value = ''
    if (!r.font) return toast.error('Not a stroke font', { description: r.errors.join(' ') })
    const f = fonts.some((x) => x.id === r.font!.id) ? { ...r.font, id: newFont('x').id } : r.font
    add(f)
    toast.success(`${f.name} added (${Object.keys(f.glyphs).length} glyphs)`)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]" data-testid="fonts-tab">
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">Single-stroke fonts for engraving text. Text set in a font keeps its own copy of the letters, so editing a font here never changes parts already drawn.</p>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" className="gap-1" onClick={() => add(newFont(`Font ${fonts.length + 1}`))}>
            <Plus className="size-4" /> New
          </Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => add(newFont('Built-in (copy)', { from: BUILTIN_FONT }))} title="Start from the built-in font's letters">
            <Copy className="size-4" /> Copy built-in
          </Button>
          <input ref={fileInput} type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && void importFont(e.target.files[0])} />
          <Button size="sm" variant="ghost" className="gap-1" onClick={() => fileInput.current?.click()}>
            <FileUp className="size-4" /> Import
          </Button>
        </div>
        <ul className="flex flex-col gap-1">
          {fonts.map((f) => (
            <li key={f.id}>
              <button className={`w-full rounded border px-2 py-1.5 text-left text-sm ${f.id === font?.id ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`} onClick={() => setSelId(f.id)}>
                {f.name}
                <span className="ml-2 text-xs text-muted-foreground">{Object.keys(f.glyphs).length} glyphs</span>
              </button>
            </li>
          ))}
          {!fonts.length && <li className="text-sm text-muted-foreground">No fonts yet: text uses the built-in font.</li>}
        </ul>
      </div>
      {font && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Name
              <Input className="h-8 w-52" value={font.name} onChange={(e) => save({ ...font, name: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Cap height (grid units)
              <Input className="h-8 w-24" type="number" min={1} value={font.capHeight} onChange={(e) => e.target.valueAsNumber > 0 && save({ ...font, capHeight: e.target.valueAsNumber })} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Gap after the last letter
              <Input className="h-8 w-24" type="number" min={0} value={font.gap} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && save({ ...font, gap: Math.max(0, e.target.valueAsNumber) })} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Snap
              <select className="h-8 rounded border bg-background px-1.5" value={snap} onChange={(e) => setSnap(Number(e.target.value))}>
                <option value={0}>Off</option>
                <option value={0.25}>0.25</option>
                <option value={0.5}>0.5</option>
                <option value={1}>1</option>
              </select>
            </label>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" className="gap-1" onClick={() => void exportFont()}>
              <FileDown className="size-4" /> Export
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1 text-destructive"
              onClick={() => {
                updateLibrary((l) => void (l.fonts = (l.fonts ?? []).filter((x) => x.id !== font.id)))
                setSelId(null)
              }}
            >
              <Trash2 className="size-4" /> Delete font
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {CHARSET.map((c) => (
              <button
                key={c}
                className={`size-7 rounded border font-mono text-sm ${c === ch ? 'border-primary bg-primary/15' : font.glyphs[c] ? 'border-border bg-muted' : 'border-dashed border-border text-muted-foreground'}`}
                onClick={() => setCh(c)}
                title={font.glyphs[c] ? 'Drawn in this font' : 'Not drawn yet (the built-in letter is used)'}
              >
                {c}
              </button>
            ))}
            <Input className="h-7 w-12 font-mono" maxLength={2} aria-label="Other character" placeholder="…" onChange={(e) => e.target.value && setCh([...e.target.value][0])} />
          </div>
          <GlyphEditor font={font} ch={ch} snap={snap} onChange={save} />
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Preview
            <Input className="h-8 w-80" value={preview} onChange={(e) => setPreview(e.target.value)} />
          </label>
          <TextPreview font={font} text={preview} />
        </div>
      )}
    </div>
  )
}

function GlyphEditor({ font, ch, snap, onChange }: { font: StrokeFont; ch: string; snap: number; onChange: (f: StrokeFont) => void }) {
  const g = font.glyphs[ch]
  const H = font.capHeight
  const adv = g?.advance ?? H + font.gap - Math.round(H / 3)
  const pad = H * 0.25
  const desc = H / 3
  const vb = { x: -pad, y: -(H + pad), w: Math.max(adv, H) + 2 * pad, h: H + desc + 2 * pad }
  const svg = useRef<SVGSVGElement>(null)
  const click = (e: MouseEvent<SVGSVGElement>) => {
    const el = svg.current
    const m = el?.getScreenCTM()
    if (!el || !m) return
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    const sn = (v: number) => (snap > 0 ? Math.round(v / snap) * snap : Math.round(v * 1000) / 1000)
    // the drawing is flipped: y up from the baseline
    onChange(glyphAddPoint(font, ch, [sn(p.x), sn(-p.y)]))
  }
  const step = snap > 0 ? snap : H / 12
  const lines: string[] = []
  for (let x = 0; x <= vb.w; x += step) lines.push(`M${x - pad} ${vb.y}V${vb.y + vb.h}`)
  for (let y = -desc; y <= H + pad; y += step) lines.push(`M${vb.x} ${-y}H${vb.x + vb.w}`)
  const sw = H / 120
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,420px)_1fr]">
      <svg ref={svg} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="aspect-square w-full cursor-crosshair rounded border bg-white" onClick={click} role="img" aria-label={`Glyph ${ch}`}>
        <path d={lines.join('')} stroke="#e5e7eb" strokeWidth={sw} fill="none" />
        <path d={`M${vb.x} 0H${vb.x + vb.w}M${vb.x} ${-H}H${vb.x + vb.w}M0 ${vb.y}V${vb.y + vb.h}M${adv} ${vb.y}V${vb.y + vb.h}`} stroke="#93c5fd" strokeWidth={sw * 1.5} fill="none" />
        {g?.strokes.map((st, i) => (
          <g key={i}>
            <polyline points={st.map(([x, y]) => `${x},${-y}`).join(' ')} stroke={i === g.strokes.length - 1 ? '#dc2626' : '#111827'} strokeWidth={sw * 4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            {st.map(([x, y], k) => (
              <circle key={k} cx={x} cy={-y} r={sw * 4} fill={i === g.strokes.length - 1 ? '#dc2626' : '#374151'} />
            ))}
          </g>
        ))}
      </svg>
      <div className="flex flex-col gap-2 text-sm">
        <div className="text-xs text-muted-foreground">
          Click on the grid to add points to the red stroke. <b>New stroke</b> lifts the pen. Blue lines: the baseline, the cap height, the start and the advance (where the next letter starts).
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={() => onChange(glyphNewStroke(font, ch))}>
            New stroke
          </Button>
          <Button size="sm" variant="outline" className="gap-1" disabled={!g?.strokes.length} onClick={() => onChange(glyphUndo(font, ch))}>
            <Undo2 className="size-4" /> Undo point
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!g}
            onClick={() => {
              const glyphs = { ...font.glyphs }
              delete glyphs[ch]
              onChange({ ...font, glyphs })
            }}
          >
            Clear letter
          </Button>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Advance
          <Input className="h-8 w-24" type="number" min={0} step={0.5} value={adv} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onChange({ ...font, glyphs: { ...font.glyphs, [ch]: { strokes: g?.strokes ?? [], advance: Math.max(0, e.target.valueAsNumber) } } })} />
        </label>
        <ul className="flex flex-col gap-0.5 text-xs">
          {g?.strokes.map((st, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="font-mono">
                Stroke {i + 1}: {st.length} point{st.length === 1 ? '' : 's'}
              </span>
              <Button size="icon-xs" variant="ghost" aria-label={`Delete stroke ${i + 1}`} onClick={() => onChange(glyphRemoveStroke(font, ch, i))}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function TextPreview({ font, text }: { font: StrokeFont; text: string }) {
  const paths = useMemo(() => strokeText(text, { x: 0, y: 0 }, 10, 0, 1, undefined, font).map((c) => toPoints(c, 0.05)), [font, text])
  const xs = paths.flat().map((p) => p.x)
  const w = Math.max(20, ...xs) + 4
  return (
    <svg viewBox={`-2 -14 ${w} 18`} className="h-16 w-full max-w-3xl rounded border bg-white" role="img" aria-label="Preview">
      {paths.map((l, i) => (
        <polyline key={i} points={l.map((p) => `${p.x},${-p.y}`).join(' ')} stroke="#111827" strokeWidth={0.35} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      ))}
    </svg>
  )
}
