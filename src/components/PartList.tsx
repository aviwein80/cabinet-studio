import { Copy, DoorOpen, FileInput, FileUp, MoreHorizontal, PenTool, Plus, ScanText, Trash2 } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { backend } from '@/app/backend'
import { entityContours, layerOf, newPart } from '@/cam/doc'
import { parsePartFile } from '@/cam/model/partFile'
import { boxOf, rect } from '@/cam/geom'
import type { CamPart } from '@/cam/types'
import { EmptyState } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { formatLength } from '@/core/units'
import type { Material, UnitSystem } from '@/core/types'
import { DoorDialog } from '@/components/DoorDialog'
import { DrawingImportDialog } from '@/components/DrawingImportDialog'
import { PartDraftDialog } from '@/components/PartDraftDialog'
import { useStore } from '@/app/store'
import { featuresOf } from '@/core/features'
import { contourPath } from '@/pages/part/hit'

export function PartThumb({ part, className }: { part: CamPart; className?: string }) {
  const cs = part.entities.filter((e) => e.face === 1 && !layerOf(part, e.layer)?.construction).map((e) => ({ e, cs: entityContours(e) }))
  const b = boxOf([...cs.flatMap((x) => x.cs), rect(0, 0, part.length, part.width)])
  const w = Math.max(1, b.maxX - b.minX)
  const h = Math.max(1, b.maxY - b.minY)
  const pad = Math.max(w, h) * 0.06
  return (
    <svg viewBox={`${b.minX - pad} ${-(b.maxY + pad)} ${w + 2 * pad} ${h + 2 * pad}`} className={className} preserveAspectRatio="xMidYMid meet">
      <g transform="scale(1,-1)">
        {cs.map(({ e, cs }) => (
          <path
            key={e.id}
            d={cs.map(contourPath).join('')}
            fill={e.id === part.outlineId ? '#e7d3ad' : 'none'}
            fillRule="evenodd"
            stroke={e.id === part.outlineId ? '#7c5f35' : (layerOf(part, e.layer)?.color === '#e2e8f0' ? '#57534e' : layerOf(part, e.layer)?.color) ?? '#57534e'}
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
    </svg>
  )
}

export function PartList({
  parts,
  units,
  materials,
  onOpen,
  onSave,
  onDelete,
  emptyText,
  extraActions,
}: {
  parts: CamPart[]
  units: UnitSystem
  materials: Material[]
  onOpen: (id: string) => void
  onSave: (p: CamPart) => void
  onDelete: (id: string) => void
  emptyText: string
  extraActions?: (p: CamPart) => React.ReactNode
}) {
  const file = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [doors, setDoors] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const doorsOn = useStore((s) => featuresOf(s.data?.settings).camParametric)
  const create = () => {
    const p = newPart({ name: `Part ${parts.length + 1}` })
    onSave(p)
    onOpen(p.id)
  }
  const openFile = async (f: File) => {
    try {
      const { part: p, missing } = await parsePartFile(await f.text(), backend.blobs)
      const copy = { ...p, id: nanoid(10), updatedAt: new Date().toISOString() }
      onSave(copy)
      if (missing.length) toast.warning(`Loaded ${copy.name}, but ${missing.length} 3D model(s) have no data in the file.`)
      else toast.success(`Loaded ${copy.name}`)
    } catch (e) {
      toast.error(`Could not read ${f.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={create}>
          <Plus /> New part
        </Button>
        <Button variant="outline" onClick={() => setImporting(true)}>
          <FileInput /> Import drawing
        </Button>
        <Button variant="outline" onClick={() => setDrafting(true)}>
          <ScanText /> Draft from customer drawing
        </Button>
        <PartDraftDialog
          open={drafting}
          onOpenChange={setDrafting}
          onApproved={(p) => {
            onSave(p)
            onOpen(p.id)
          }}
        />
        {doorsOn && (
          <Button variant="outline" onClick={() => setDoors(true)}>
            <DoorOpen /> Doors
          </Button>
        )}
        <Button variant="outline" onClick={() => file.current?.click()}>
          <FileUp /> Open part file
        </Button>
        {doorsOn && (
          <DoorDialog
            open={doors}
            onOpenChange={setDoors}
            onCreate={(ps) => {
              for (const p of ps) onSave(p)
              toast.success(`${ps.length} door design${ps.length === 1 ? '' : 's'} added`, { description: `${ps.reduce((n, p) => n + p.qty, 0)} doors in total` })
            }}
          />
        )}
        <DrawingImportDialog
          open={importing}
          onOpenChange={setImporting}
          units={units}
          materials={materials}
          onImport={(p) => {
            onSave(p)
            onOpen(p.id)
          }}
        />
        <input ref={file} type="file" accept=".json,.csp.json" className="hidden" onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void openFile(f)
            e.target.value = ''
          }} />
      </div>
      {parts.length === 0 ? (
        <EmptyState icon={<PenTool className="size-5" />} title="No custom parts yet" action={<Button onClick={create}>Draw the first part</Button>}>
          {emptyText}
        </EmptyState>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {parts.map((p) => (
            <div key={p.id} className="group flex flex-col overflow-hidden rounded-xl border bg-background shadow-xs transition-shadow hover:shadow-md">
              <button className="flex h-36 items-center justify-center bg-stone-50 p-3" onClick={() => onOpen(p.id)} aria-label={`Open ${p.name}`}>
                <PartThumb part={p} className="h-full w-full" />
              </button>
              <div className="flex items-start gap-2 border-t px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatLength(p.length, units)} × {formatLength(p.width, units)} × {formatLength(p.thickness, units)} · {p.qty} pcs
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {p.ops.length} operation{p.ops.length === 1 ? '' : 's'}
                    {p.source ? ` · ${p.source}` : ''}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="Part actions">
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onOpen(p.id)}>
                      <PenTool /> Open
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onSave({ ...structuredClone(p), id: nanoid(10), name: `${p.name} copy`, updatedAt: new Date().toISOString() })}>
                      <Copy /> Duplicate
                    </DropdownMenuItem>
                    {extraActions?.(p)}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => onDelete(p.id)}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
