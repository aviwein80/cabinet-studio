import { Copy, FileDown, FileUp, Package, Pencil, Plus, Trash2 } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { backend } from '@/app/backend'
import { useStore, type LibraryTab } from '@/app/store'
import { CabinetThumb } from '@/components/CabinetThumb'
import { EditableTable, type Column } from '@/components/EditableTable'
import { ImportDialog } from '@/components/ImportDialog'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { importLibraryBundle } from '@/core/library/import'
import type { AppData, EdgeBand, Hardware, HardwareCategory, Material } from '@/core/types'

const HW_CATEGORIES: HardwareCategory[] = ['hinge', 'mounting-plate', 'shelf-pin', 'connector', 'dowel', 'screw', 'leg', 'other']

const MATERIAL_COLS: Column<Material>[] = [
  { key: 'code', label: 'Code', type: 'text', mono: true, width: '130px' },
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'thickness', label: 'T', type: 'num', width: '70px' },
  { key: 'sheetLength', label: 'Sheet L', type: 'num', width: '90px' },
  { key: 'sheetWidth', label: 'Sheet W', type: 'num', width: '90px' },
  { key: 'grain', label: 'Grain', type: 'bool', width: '60px' },
  { key: 'color', label: 'Colour', type: 'color', width: '60px' },
]
const BAND_COLS: Column<EdgeBand>[] = [
  { key: 'code', label: 'Code', type: 'text', mono: true, width: '140px' },
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'thickness', label: 'T', type: 'num', width: '70px' },
  { key: 'width', label: 'Width', type: 'num', width: '80px' },
  { key: 'color', label: 'Colour', type: 'color', width: '60px' },
]
const HW_COLS: Column<Hardware>[] = [
  { key: 'code', label: 'Code', type: 'text', mono: true, width: '140px' },
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'category', label: 'Category', type: 'select', width: '170px', options: HW_CATEGORIES.map((c) => ({ value: c, label: c })) },
]

function materialInUse(d: AppData, id: string) {
  const params = [...d.library.templates.map((t) => t.params), ...d.jobs.flatMap((j) => j.cabinets.map((c) => c.params))]
  return params.some((p) => p.carcassMaterialId === id || p.backMaterialId === id || p.doorMaterialId === id)
}
function bandInUse(d: AppData, id: string) {
  const params = [...d.library.templates.map((t) => t.params), ...d.jobs.flatMap((j) => j.cabinets.map((c) => c.params))]
  return params.some((p) => Object.values(p.edgebands).includes(id)) || d.jobs.some((j) => j.cabinets.some((c) => Object.values(c.overrides).some((o) => o.edges && Object.values(o.edges).includes(id))))
}

export function LibraryPage({ tab }: { tab: LibraryTab }) {
  const { data, go, updateLibrary } = useStore()
  const [importOpen, setImportOpen] = useState(false)
  const bundleInput = useRef<HTMLInputElement>(null)
  if (!data) return null
  const lib = data.library

  const setField =
    <K extends 'materials' | 'edgebands' | 'hardware'>(kind: K) =>
    (id: string, key: PropertyKey, value: unknown) =>
      updateLibrary((l) => {
        const row = (l[kind] as { id: string }[]).find((r) => r.id === id) as Record<PropertyKey, unknown> | undefined
        if (row) row[key] = value
      })
  const remove = (kind: 'materials' | 'edgebands' | 'hardware') => (row: { id: string }) =>
    updateLibrary((l) => {
      ;(l[kind] as { id: string }[]) = (l[kind] as { id: string }[]).filter((r) => r.id !== row.id)
    })

  const add = () => {
    const n = nanoid(5)
    updateLibrary((l) => {
      if (tab === 'materials') l.materials.push({ id: `mat-${n}`, code: `NEW-${n.toUpperCase()}`, name: 'New sheet material', thickness: 18, sheetLength: 2800, sheetWidth: 2070, grain: false, color: '#e7e2d8' })
      if (tab === 'edgebands') l.edgebands.push({ id: `eb-${n}`, code: `EB-${n.toUpperCase()}`, name: 'New edgeband', thickness: 1, width: 22, color: '#e7e2d8' })
      if (tab === 'hardware') l.hardware.push({ id: `hw-${n}`, code: `HW-${n.toUpperCase()}`, name: 'New hardware item', category: 'other' })
    })
  }

  const exportBundle = async () => {
    const where = await backend.saveFile({ name: 'cabinet-studio-library.json', data: JSON.stringify(lib, null, 2) }, [{ name: 'Library bundle', extensions: ['json'] }])
    if (where) toast.success(`Library exported to ${where}`)
  }
  const importBundle = async (f: File) => {
    try {
      const merged = importLibraryBundle(await f.text(), lib)
      updateLibrary((l) => Object.assign(l, merged))
      toast.success('Library bundle merged')
    } catch (e) {
      toast.error('Not a valid library bundle', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      if (bundleInput.current) bundleInput.current.value = ''
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Library"
        subtitle="Templates, sheet materials, edgebands and hardware shared by all jobs"
        actions={
          <>
            <input ref={bundleInput} type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && void importBundle(e.target.files[0])} />
            <Button size="sm" variant="ghost" onClick={() => bundleInput.current?.click()}>
              <FileUp /> Import bundle
            </Button>
            <Button size="sm" variant="ghost" onClick={exportBundle}>
              <FileDown /> Export bundle
            </Button>
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
              <FileUp /> Import CSV / XLSX
            </Button>
          </>
        }
      />
      <Tabs value={tab} onValueChange={(t) => go({ page: 'library', tab: t as LibraryTab })} className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="flex items-center justify-between gap-2 border-b bg-background px-5 py-2">
          <TabsList>
            <TabsTrigger value="templates">Templates ({lib.templates.length})</TabsTrigger>
            <TabsTrigger value="materials">Materials ({lib.materials.length})</TabsTrigger>
            <TabsTrigger value="edgebands">Edgebands ({lib.edgebands.length})</TabsTrigger>
            <TabsTrigger value="hardware">Hardware ({lib.hardware.length})</TabsTrigger>
          </TabsList>
          {tab !== 'templates' && (
            <Button size="sm" onClick={add}>
              <Plus /> Add row
            </Button>
          )}
        </div>
        <TabsContent value="templates" className="min-h-0 flex-1 overflow-auto p-5">
          {lib.templates.length === 0 ? (
            <EmptyState icon={<Package className="size-5" />} title="No templates">
              Import templates from CSV/XLSX, or save a cabinet from a job as a template.
            </EmptyState>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {lib.templates.map((t) => (
                <div key={t.id} className="flex flex-col rounded-xl border bg-background shadow-xs">
                  <button className="flex gap-3 p-3 text-left" onClick={() => go({ page: 'template', templateId: t.id })}>
                    <CabinetThumb p={t.params} className="h-24 w-20 shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{t.name}</span>
                        {t.builtIn && (
                          <Badge variant="outline" className="text-[10px]">
                            Built-in
                          </Badge>
                        )}
                      </div>
                      <div className="font-mono text-xs">
                        {t.params.width} × {t.params.height} × {t.params.depth}
                      </div>
                      <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{t.description || `${t.params.kind} cabinet`}</div>
                    </div>
                  </button>
                  <div className="mt-auto flex justify-end gap-0.5 border-t px-2 py-1">
                    <Button size="icon-sm" variant="ghost" aria-label="Edit template" onClick={() => go({ page: 'template', templateId: t.id })}>
                      <Pencil />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Duplicate template"
                      onClick={() => updateLibrary((l) => void l.templates.push({ ...JSON.parse(JSON.stringify(t)), id: `tpl-${nanoid(8)}`, name: `${t.name} (copy)`, builtIn: false }))}
                    >
                      <Copy />
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Delete template" onClick={() => updateLibrary((l) => void (l.templates = l.templates.filter((x) => x.id !== t.id)))}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="materials" className="min-h-0 flex-1 overflow-auto p-5">
          <EditableTable
            rows={lib.materials}
            columns={MATERIAL_COLS}
            onChange={setField('materials')}
            onDelete={remove('materials')}
            canDelete={(m) => (materialInUse(data, m.id) ? 'Used by a template or job cabinet' : null)}
            empty="No sheet materials. Add one or import a CSV."
          />
          <p className="mt-2 text-[11px] text-muted-foreground">Grain = the sheet has a visible grain along its length. Parts marked grain-locked will not be rotated on these sheets.</p>
        </TabsContent>
        <TabsContent value="edgebands" className="min-h-0 flex-1 overflow-auto p-5">
          <EditableTable
            rows={lib.edgebands}
            columns={BAND_COLS}
            onChange={setField('edgebands')}
            onDelete={remove('edgebands')}
            canDelete={(b) => (bandInUse(data, b.id) ? 'Used by a template or job cabinet' : null)}
            empty="No edgebands."
          />
          <p className="mt-2 text-[11px] text-muted-foreground">Band thickness is subtracted from the cut size of every banded edge (plus the pre-mill allowance set on the Machine page).</p>
        </TabsContent>
        <TabsContent value="hardware" className="min-h-0 flex-1 overflow-auto p-5">
          <EditableTable rows={lib.hardware} columns={HW_COLS} onChange={setField('hardware')} onDelete={remove('hardware')} empty="No hardware." />
          <p className="mt-2 text-[11px] text-muted-foreground">Generated cabinets count hinges, plates, shelf pins and connectors by code. Keep the built-in codes (HINGE-110, PIN-5, ...) or the BOM will show the code only.</p>
        </TabsContent>
      </Tabs>
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        kinds={tab === 'templates' ? ['templates', 'materials', 'edgebands', 'hardware'] : [tab, ...(['materials', 'edgebands', 'hardware', 'templates'] as const).filter((k) => k !== tab)]}
        onApplied={(k) => k !== 'tools' && go({ page: 'library', tab: k })}
      />
    </div>
  )
}
