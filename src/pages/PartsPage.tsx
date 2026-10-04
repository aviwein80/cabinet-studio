import { useStore } from '@/app/store'
import { PageHeader } from '@/components/PageHeader'
import { PartList } from '@/components/PartList'

export function PartsPage() {
  const { data, go, savePart, deletePart } = useStore()
  if (!data) return null
  const parts = data.library.partLibrary ?? []
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Custom parts" subtitle="Shaped panels, signs, templates and fixtures drawn here. Library parts can be copied into any job." />
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <PartList
          parts={parts}
          units={data.settings.units}
          onOpen={(id) => go({ page: 'part', partId: id })}
          onSave={(p) => savePart(p)}
          onDelete={(id) => deletePart(id)}
          emptyText="Draw a part with lines, arcs and shapes, then add profile, pocket and drilling operations. Parts saved here are shared by every job."
        />
      </div>
    </div>
  )
}
