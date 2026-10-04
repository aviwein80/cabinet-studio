import { Plus } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useStore } from '@/app/store'
import { EditableTable, type Column } from '@/components/EditableTable'
import { Button } from '@/components/ui/button'
import type { Offcut } from '@/core/types'
import { nestSettingsOf } from '@/core/machining'

export function OffcutsTab() {
  const data = useStore((s) => s.data)!
  const updateLibrary = useStore((s) => s.updateLibrary)
  const lib = data.library
  const rows = lib.offcuts ?? []
  const ns = nestSettingsOf(data.settings)
  const cols: Column<Offcut>[] = [
    { key: 'materialId', label: 'Material', type: 'select', width: '260px', options: lib.materials.map((m) => ({ value: m.id, label: `${m.code} · ${m.name}` })) },
    { key: 'length', label: 'Length', type: 'num', width: '120px', length: true },
    { key: 'width', label: 'Width', type: 'num', width: '120px', length: true },
    { key: 'from', label: 'From job', type: 'text', mono: true },
  ]
  const add = () =>
    updateLibrary((l) => {
      const m = lib.materials[0]
      l.offcuts = [...(l.offcuts ?? []), { id: nanoid(8), materialId: m?.id ?? '', length: 1200, width: m?.sheetWidth ?? 1524, from: '', createdAt: new Date().toISOString() }]
    })
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-xs text-muted-foreground">
          Sheet remnants in the rack. {ns.useOffcuts ? 'Jobs fill matching offcuts before full sheets.' : 'Turn on “Use stock offcuts first” on the Machine page to nest onto them.'} A job’s Nesting tab adds its remnants here and takes out the offcuts it used.
        </p>
        <Button size="sm" variant="outline" className="gap-1" onClick={add} disabled={!lib.materials.length}>
          <Plus className="size-4" /> Offcut
        </Button>
      </div>
      <EditableTable
        rows={rows}
        columns={cols}
        onChange={(id, key, value) => updateLibrary((l) => void (l.offcuts = (l.offcuts ?? []).map((o) => (o.id === id ? { ...o, [key]: value } : o))))}
        onDelete={(row) => updateLibrary((l) => void (l.offcuts = (l.offcuts ?? []).filter((o) => o.id !== row.id)))}
        empty="No offcuts in stock."
      />
    </div>
  )
}
