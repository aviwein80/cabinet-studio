import { ImageOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { imageUrl } from '@/app/specSource'
import type { Region } from '@/cam/types'
import type { PageImage } from '@/core/hardware/aiProviders'
import type { Cite } from '@/core/spec/cite'
import { cn } from '@/lib/utils'

export interface MarkedCite {
  key: string
  cite: Cite
}

/**
 * The source pages beside a draft. Every cited value with a box is outlined; the focused one is
 * filled and scrolled into view (switching page if needed).
 */
export function SourceViewer({ file, images, marks, focus, onFocus, className }: { file: string; images: PageImage[]; marks: MarkedCite[]; focus?: string | null; onFocus?: (key: string) => void; className?: string }) {
  const [page, setPage] = useState(images[0]?.page ?? 1)
  const focused = marks.find((m) => m.key === focus)
  const box = useRef<HTMLDivElement>(null)
  const [lastFocus, setLastFocus] = useState<string | null | undefined>(undefined)
  if (focus !== lastFocus) {
    setLastFocus(focus)
    if (focused?.cite.page !== undefined && focused.cite.page !== page && images.some((i) => i.page === focused.cite.page)) setPage(focused.cite.page)
  }
  useEffect(() => {
    box.current?.querySelector('[data-focus="true"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focus, page])
  const img = images.find((i) => i.page === page) ?? images[0]
  const onPage = marks.filter((m) => m.cite.region && (m.cite.page ?? 1) === img?.page)
  return (
    <div className={cn('flex min-h-0 flex-col gap-2', className)}>
      <div className="flex items-center gap-2 text-xs">
        <span className="min-w-0 flex-1 truncate font-medium" title={file}>
          {file}
        </span>
        {images.length > 1 &&
          images.map((i) => (
            <button key={i.page} type="button" onClick={() => setPage(i.page)} className={cn('rounded border px-1.5 py-0.5 tabular-nums', i.page === img?.page ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')} aria-label={`Show page ${i.page}`}>
              {i.page}
            </button>
          ))}
      </div>
      {img ? (
        <div ref={box} className="relative min-h-0 flex-1 overflow-auto rounded-md border bg-stone-100">
          <div className="relative">
            <img src={imageUrl(img)} alt={`${file}, page ${img.page}`} className="block w-full select-none" draggable={false} />
            {onPage.map((m) => (
              <RegionBox key={m.key} r={m.cite.region!} active={m.key === focus} onClick={() => onFocus?.(m.key)} label={m.cite.quote} />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
          <ImageOff className="size-5" /> No page image for this source.
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">Outlined boxes mark where a value was read. Click a value’s page link to find it here.</p>
    </div>
  )
}

function RegionBox({ r, active, onClick, label }: { r: Region; active: boolean; onClick: () => void; label?: string }) {
  const [x0, y0, x1, y1] = r
  return (
    <button
      type="button"
      data-focus={active}
      title={label}
      aria-label={label ? `Source: ${label}` : 'Source region'}
      onClick={onClick}
      className={cn('absolute rounded-sm border-2 transition-colors', active ? 'z-10 border-orange-500 bg-orange-400/30 ring-2 ring-orange-500/40' : 'border-sky-500/70 bg-sky-400/10 hover:bg-sky-400/25')}
      style={{ left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${Math.max(0.5, (x1 - x0) * 100)}%`, height: `${Math.max(0.5, (y1 - y0) * 100)}%` }}
    />
  )
}

/** Small link to a value's source: page number, and a warning tint when the quote was not found. */
export function CiteChip({ cite, active, onClick }: { cite?: Cite; active?: boolean; onClick?: () => void }) {
  if (!cite) return <span className="text-[10px] text-muted-foreground">no source</span>
  return (
    <button
      type="button"
      onClick={onClick}
      title={[cite.quote ? `“${cite.quote}”` : '', cite.unverified ? 'Quote not found in the PDF text layer; check the drawing.' : ''].filter(Boolean).join('\n') || undefined}
      className={cn('max-w-[9rem] truncate rounded px-1 py-0.5 text-left text-[10px] tabular-nums', active ? 'bg-orange-500 text-white' : cite.unverified ? 'bg-amber-500/20 text-amber-800 hover:bg-amber-500/30 dark:text-amber-200' : 'bg-sky-500/10 text-sky-800 hover:bg-sky-500/20 dark:text-sky-200')}
    >
      {cite.page !== undefined ? `p${cite.page}` : 'src'}
      {cite.quote ? ` · ${cite.quote}` : ''}
    </button>
  )
}
