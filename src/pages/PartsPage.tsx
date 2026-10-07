import { GitCompare } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '@/app/store'
import { PageHeader } from '@/components/PageHeader'
import { PartList } from '@/components/PartList'
import { Button } from '@/components/ui/button'
import { featuresOf } from '@/core/features'
import { CompareDialog } from './part/CompareDialog'

export function PartsPage() {
  const { data, go, savePart, deletePart } = useStore()
  const [compare, setCompare] = useState(false)
  if (!data) return null
  const parts = data.library.partLibrary ?? []
  const simOn = featuresOf(data.settings).camMachineSim
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Custom parts"
        subtitle="Shaped panels, signs, templates and fixtures drawn here. Library parts can be copied into any job."
        actions={
          simOn && parts.some((p) => p.models?.length) ? (
            <Button size="sm" variant="outline" onClick={() => setCompare(true)}>
              <GitCompare /> Compare with models…
            </Button>
          ) : undefined
        }
      />
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <PartList
          parts={parts}
          units={data.settings.units}
          materials={data.library.materials}
          onOpen={(id) => go({ page: 'part', partId: id })}
          onSave={(p) => savePart(p)}
          onDelete={(id) => deletePart(id)}
          emptyText="Draw a part with lines, arcs and shapes, then add profile, pocket and drilling operations. Parts saved here are shared by every job."
        />
      </div>
      {compare && <CompareDialog open={compare} onOpenChange={setCompare} parts={parts} machine={data.machine} units={data.settings.units} onOpen={(id) => go({ page: 'part', partId: id })} />}
    </div>
  )
}
