/**
 * Image trace (NEW-06): bring in a picture (PNG, JPEG, GIF, BMP, WebP) and trace it into closed
 * contours, shown over the picture as you change the threshold, smoothing and corners. Our own
 * tracer, run in the background worker.
 */
import { ImageUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { makeEntity } from '@/cam/doc'
import { ensureLayer } from '@/cam/query'
import { DEFAULT_TRACE, type ImagePixels, type TraceOptions, type TraceResult } from '@/cam/trace'
import type { CamPart } from '@/cam/types'
import { compute } from '@/cam/worker/client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { formatLength, parseLength } from '@/core/units'
import type { UnitSystem } from '@/core/types'
import { contourPath } from './hit'
import { enterApplies } from '@/components/enterApplies'

const MAX_PIXELS = 12_000_000

async function readImage(f: File): Promise<{ img: ImagePixels; url: string }> {
  const bmp = await createImageBitmap(f)
  if (bmp.width * bmp.height > MAX_PIXELS) throw new Error(`The picture is ${bmp.width} x ${bmp.height} pixels; make it smaller than ${MAX_PIXELS / 1e6} million pixels first.`)
  const c = document.createElement('canvas')
  c.width = bmp.width
  c.height = bmp.height
  const g = c.getContext('2d')!
  g.drawImage(bmp, 0, 0)
  const d = g.getImageData(0, 0, bmp.width, bmp.height)
  return { img: { width: d.width, height: d.height, data: new Uint8Array(d.data.buffer.slice(0)) }, url: c.toDataURL('image/png') }
}

export function ImageTraceDialog({ part, units, onClose, onInsert }: { part: CamPart; units: UnitSystem; onClose: () => void; onInsert: (p: CamPart, msg: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [pic, setPic] = useState<{ img: ImagePixels; url: string; name: string } | null>(null)
  const [opt, setOpt] = useState<TraceOptions>(DEFAULT_TRACE)
  const [width, setWidth] = useState(200)
  const [res, setRes] = useState<TraceResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [layer, setLayer] = useState('TRACE')
  const mmPerPixel = pic ? width / pic.img.width : opt.mmPerPixel

  useEffect(() => {
    if (!pic) return
    const abort = new AbortController()
    const t = setTimeout(() => {
      setBusy(true)
      compute()
        .run('image.trace', { img: pic.img, opt: { ...opt, mmPerPixel, origin: { x: 0, y: 0 } } }, { signal: abort.signal })
        .then(setRes, (e) => !abort.signal.aborted && toast.error(e instanceof Error ? e.message : String(e)))
        .finally(() => !abort.signal.aborted && setBusy(false))
    }, 150)
    return () => {
      clearTimeout(t)
      abort.abort()
    }
  }, [pic, opt, mmPerPixel])

  const open = async (f: File) => {
    try {
      const r = await readImage(f)
      setPic({ ...r, name: f.name })
      setWidth(Math.round(Math.min(part.length * 0.8, r.img.width * 0.25)))
      setLayer(`TRACE_${f.name.replace(/\.[^.]+$/, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`)
    } catch (e) {
      toast.error(`Could not read ${f.name}`, { description: e instanceof Error ? e.message : String(e) })
    } finally {
      if (input.current) input.current.value = ''
    }
  }
  const insert = () => {
    if (!res || !pic) return
    // in the middle of the part
    const h = pic.img.height * mmPerPixel
    const dx = (part.length - width) / 2
    const dy = (part.width - h) / 2
    const { part: p, id } = ensureLayer(part, layer)
    const move = (q: { x: number; y: number }) => ({ x: q.x + dx, y: q.y + dy })
    const es = res.contours.map((c) => makeEntity({ t: 'contour', c: { closed: true, segs: c.segs.map((s) => (s.k === 'L' ? { ...s, a: move(s.a), b: move(s.b) } : { ...s, a: move(s.a), b: move(s.b), c: move(s.c) })) } }, id))
    onInsert({ ...p, entities: [...p.entities, ...es] }, `${es.length} closed contours traced from ${pic.name} on ${layer}`)
    onClose()
  }
  const h = pic ? pic.img.height * mmPerPixel : 0
  const num = (label: string, value: number, set: (v: number) => void, step = 1, min = 0, max = 255) => (
    <label className="flex flex-col gap-1 text-stone-400">
      {label}
      <input aria-label={label} type="number" min={min} max={max} step={step} value={value} onChange={(e) => Number.isFinite(Number(e.target.value)) && set(Number(e.target.value))} className="h-7 rounded border border-white/10 bg-black/30 px-1.5 text-stone-100" />
    </label>
  )
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="dark max-h-[92vh] overflow-y-auto border-white/10 bg-[#15171c] text-stone-100 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImageUp className="size-4" /> Trace a picture
          </DialogTitle>
          <DialogDescription className="text-stone-400">Dark areas become closed shapes (light ones with Invert). Corners sharper than the corner angle stay sharp; the rest is smoothed into lines and arcs.</DialogDescription>
        </DialogHeader>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/bmp,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && void open(e.target.files[0])} />
        <div className="grid gap-4 md:grid-cols-[1fr_230px]">
          <div className="flex min-h-64 items-center justify-center rounded-md bg-black/40">
            {pic ? (
              <svg viewBox={`0 0 ${width} ${h}`} className="max-h-[55vh] w-full" role="img" aria-label="Trace preview">
                <image href={pic.url} x={0} y={0} width={width} height={h} opacity={0.35} />
                <g transform={`translate(0 ${h}) scale(1 -1)`}>
                  <path d={(res?.contours ?? []).map(contourPath).join('')} fill="#fbbf2433" fillRule="evenodd" stroke="#fbbf24" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
                </g>
              </svg>
            ) : (
              <Button variant="outline" className="border-white/15 bg-transparent" onClick={() => input.current?.click()}>
                <ImageUp /> Choose a picture
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 content-start gap-2 text-xs">
            {pic && (
              <Button size="sm" variant="outline" className="col-span-2 border-white/15 bg-transparent" onClick={() => input.current?.click()}>
                Another picture
              </Button>
            )}
            {num('Threshold', opt.threshold, (threshold) => setOpt({ ...opt, threshold }))}
            <label className="flex items-center gap-2 self-end pb-1.5">
              <Switch size="sm" checked={opt.invert} onCheckedChange={(invert) => setOpt({ ...opt, invert })} /> Invert
            </label>
            {num('Smoothing', opt.smoothing, (smoothing) => setOpt({ ...opt, smoothing }), 1, 0, 8)}
            {num('Corner angle °', opt.cornerAngle, (cornerAngle) => setOpt({ ...opt, cornerAngle }), 5, 10, 170)}
            {num('Clean specks under (px)', opt.despeckle, (despeckle) => setOpt({ ...opt, despeckle }), 1, 0, 10000)}
            {num('Fit tolerance (px)', opt.fitTolerance, (fitTolerance) => setOpt({ ...opt, fitTolerance }), 0.1, 0.05, 5)}
            <label className="col-span-2 flex flex-col gap-1 text-stone-400">
              Width on the part
              <input aria-label="Width on the part" defaultValue={formatLength(width, units)} key={`${width}${units}`} onKeyDown={enterApplies} onBlur={(e) => { const v = parseLength(e.target.value, units); if (v && v > 0) setWidth(v) }} className="h-7 rounded border border-white/10 bg-black/30 px-1.5 text-stone-100" />
            </label>
            <label className="col-span-2 flex flex-col gap-1 text-stone-400">
              Layer
              <input aria-label="Layer" value={layer} onChange={(e) => setLayer(e.target.value)} className="h-7 rounded border border-white/10 bg-black/30 px-1.5 font-mono text-stone-100" />
            </label>
            <p className="col-span-2 text-stone-300" data-testid="trace-status">
              {!pic ? 'No picture yet.' : busy && !res ? 'Tracing…' : res ? `${res.contours.length} closed contours, ${res.corners} sharp corners${res.specks ? `, ${res.specks} specks cleaned` : ''}. ${formatLength(width, units)} × ${formatLength(h, units)}.` : ''}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!res?.contours.length} onClick={insert}>
            Add {res?.contours.length ?? 0} contours
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
