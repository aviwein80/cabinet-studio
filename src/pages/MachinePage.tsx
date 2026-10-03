import { FileDown, FileUp, Plus, RotateCcw, TriangleAlert } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useState } from 'react'
import { toast } from 'sonner'
import { backend } from '@/app/backend'
import { useStore } from '@/app/store'
import { EditableTable, type Column } from '@/components/EditableTable'
import { ImportDialog } from '@/components/ImportDialog'
import { PageHeader } from '@/components/PageHeader'
import { NumField, Section, SelectField, SwitchField, TextField } from '@/components/fields'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { partSpacing } from '@/core/machining'
import type { Tool, ToolType } from '@/core/types'

const TOOL_TYPES: { value: ToolType; label: string }[] = [
  { value: 'router', label: 'Router' },
  { value: 'drill-vertical', label: 'Vertical drill' },
  { value: 'drill-horizontal', label: 'Horizontal drill' },
  { value: 'saw', label: 'Saw' },
]

const TOOL_COLS: Column<Tool>[] = [
  { key: 'number', label: 'Tool no.', type: 'num', width: '90px' },
  { key: 'type', label: 'Type', type: 'select', width: '170px', options: TOOL_TYPES },
  { key: 'name', label: 'Description', type: 'text' },
  { key: 'diameter', label: 'Ø / kerf', type: 'num', width: '90px' },
  { key: 'maxDepth', label: 'Max depth', type: 'num', width: '100px' },
]

export function MachinePage() {
  const { data, updateMachine, updateSettings, resetMachine } = useStore()
  const [importOpen, setImportOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  if (!data) return null
  const m = data.machine
  const s = data.settings
  const routers = m.tools.filter((t) => t.type === 'router')

  const exportTools = async () => {
    const csv = ['number,type,name,diameter,maxDepth', ...m.tools.map((t) => [t.number, t.type, `"${t.name.replace(/"/g, '""')}"`, t.diameter, t.maxDepth].join(','))].join('\r\n') + '\r\n'
    const where = await backend.saveFile({ name: 'n200-tools.csv', data: csv }, [{ name: 'CSV', extensions: ['csv'] }])
    if (where) toast.success(`Tool table saved to ${where}`)
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Machine & tools"
        subtitle={m.name}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => setResetOpen(true)}>
              <RotateCcw /> Reset to placeholder
            </Button>
            <Button size="sm" variant="ghost" onClick={exportTools}>
              <FileDown /> Export tools CSV
            </Button>
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
              <FileUp /> Import tools
            </Button>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {m.placeholder && (
          <div className="flex items-start gap-3 border-b border-amber-300 bg-amber-50 px-5 py-3 text-sm text-amber-950">
            <TriangleAlert className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-medium">Placeholder tool table</p>
              <p className="text-xs leading-relaxed">
                Every tool number, diameter and depth below is invented. Copy the real values from the N-200 tool database (woodWOP / Tool Manager), or import them as CSV, before exporting programs. Each MPR header carries a
                PLACEHOLDER note while this is on.
              </p>
            </div>
          </div>
        )}
        <div className="grid gap-0 xl:grid-cols-[380px_1fr]">
          <div className="border-b bg-background xl:border-r xl:border-b-0">
            <Section title="Machine profile">
              <TextField label="Profile name" value={m.name} onChange={(v) => updateMachine((x) => (x.name = v))} />
              <div className="grid grid-cols-2 gap-2">
                <TextField label="Model" value={m.model} onChange={(v) => updateMachine((x) => (x.model = v))} />
                <SelectField
                  label="MAT (header)"
                  value={m.mat}
                  options={[
                    { value: 'HOMAG', label: 'HOMAG' },
                    { value: 'WEEKE', label: 'WEEKE' },
                  ]}
                  onChange={(v) => updateMachine((x) => (x.mat = v))}
                />
              </div>
              <SwitchField
                label="Tool data is placeholder"
                checked={m.placeholder}
                onChange={(v) => updateMachine((x) => (x.placeholder = v))}
                hint="Turn off only after every tool matches the machine. Programs still need woodWOP simulation."
              />
            </Section>
            <Section title="Drilling">
              <SelectField
                label="Vertical drill addressing (BohrVert)"
                value={m.drillAddressing}
                options={[
                  { value: 'diameter', label: 'By diameter (DU) – machine picks spindle' },
                  { value: 'tool-number', label: 'By tool number (TNO)' },
                ]}
                onChange={(v) => updateMachine((x) => (x.drillAddressing = v))}
              />
              <SwitchField
                label="Horizontal drill unit fitted"
                checked={m.hasHorizontalDrillUnit}
                onChange={(v) => updateMachine((x) => (x.hasHorizontalDrillUnit = v))}
                hint="Off: edge holes (103 BohrHoriz) are left out of the MPR and listed on the label for manual drilling. On: they are written, but on a nested sheet the neighbouring part must be cut away first – check in simulation."
              />
            </Section>
            <Section title="Routing">
              <SelectField
                label="Cut-out tool"
                value={String(m.cutoutToolNumber)}
                options={routers.map((t) => ({ value: String(t.number), label: `T${t.number} · Ø${t.diameter} · ${t.name}` }))}
                onChange={(v) => updateMachine((x) => (x.cutoutToolNumber = Number(v)))}
              />
              <SelectField
                label="Grooves and dados"
                value={m.grooveMethod}
                options={[
                  { value: 'router-pocket', label: 'Router pocket (112 Tasche)' },
                  { value: 'saw', label: 'Saw groove (109 Nuten)' },
                ]}
                onChange={(v) => updateMachine((x) => (x.grooveMethod = v))}
                hint={m.grooveMethod === 'saw' ? 'Saw grooves run out past the part and can cut into neighbours on a nested sheet.' : undefined}
              />
              <div className="grid grid-cols-2 gap-2">
                <SelectField
                  label="Approach"
                  value={m.contour.approach}
                  options={[
                    { value: 'SEN', label: 'Vertical (SEN)' },
                    { value: 'TAN', label: 'Tangential (TAN)' },
                    { value: 'SEI', label: 'Side (SEI)' },
                  ]}
                  onChange={(v) => updateMachine((x) => (x.contour.approach = v))}
                />
                <SelectField
                  label="Direction"
                  value={m.contour.direction}
                  options={[
                    { value: 'climb-cw', label: 'Clockwise' },
                    { value: 'ccw', label: 'Counter-clockwise' },
                  ]}
                  onChange={(v) => updateMachine((x) => (x.contour.direction = v))}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <NumField label="Through depth" value={m.throughDepth} min={0} max={3} step={0.1} onChange={(v) => updateMachine((x) => (x.throughDepth = v))} hint="Below sheet underside" />
                <NumField label="Spoilboard limit" value={m.spoilboardAllowance} min={0} max={3} step={0.1} onChange={(v) => updateMachine((x) => (x.spoilboardAllowance = v))} hint="Max into spoilboard" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <NumField label="Header OP" suffix="" value={m.header.OP} min={0} max={99} onChange={(v) => updateMachine((x) => (x.header.OP = v))} />
                <NumField label="Header FM" suffix="" value={m.header.FM} min={0} max={99} onChange={(v) => updateMachine((x) => (x.header.FM = v))} />
              </div>
            </Section>
            <Section title="Nesting" description={`Part spacing = cut-out tool Ø + extra = ${partSpacing(m, s)} mm`}>
              <div className="grid grid-cols-2 gap-2">
                <NumField label="Edge trim" value={s.nesting.edgeTrim} min={0} max={50} onChange={(v) => updateSettings((x) => (x.nesting.edgeTrim = v))} />
                <NumField label="Extra spacing" value={s.nesting.extraSpacing} min={0} max={20} step={0.5} onChange={(v) => updateSettings((x) => (x.nesting.extraSpacing = v))} />
                <NumField label="Pre-mill / edge" value={s.nesting.premill} min={0} max={3} step={0.5} onChange={(v) => updateSettings((x) => (x.nesting.premill = v))} hint="Edgebander pre-mill" />
              </div>
              <SwitchField label="Allow 90° rotation" checked={s.nesting.allowRotation} onChange={(v) => updateSettings((x) => (x.nesting.allowRotation = v))} hint="Grain-locked parts on grained sheets are never rotated." />
            </Section>
            <Section title="Labels and output">
              <div className="grid grid-cols-2 gap-2">
                <SelectField
                  label="Label size"
                  value={s.labels.size}
                  options={[
                    { value: '100x70', label: '100 × 70 mm' },
                    { value: '100x80', label: '100 × 80 mm' },
                  ]}
                  onChange={(v) => updateSettings((x) => (x.labels.size = v))}
                />
                <NumField label="Edge clearance" value={s.labels.edgeClearance} min={0} max={50} onChange={(v) => updateSettings((x) => (x.labels.edgeClearance = v))} />
              </div>
              <TextField label="Shop name" value={s.shopName} onChange={(v) => updateSettings((x) => (x.shopName = v))} />
              <TextField
                label="Default output folder"
                value={s.outputFolder}
                placeholder="e.g. \\\\N200-PC\\mpr  (empty = ask every time)"
                onChange={(v) => updateSettings((x) => (x.outputFolder = v))}
                hint="Each export creates a JOB_date subfolder here. A network share to the machine PC works."
              />
            </Section>
          </div>
          <div className="flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Tool table</h2>
              <Button
                size="sm"
                onClick={() =>
                  updateMachine((x) => {
                    const next = Math.max(100, ...x.tools.map((t) => t.number)) + 1
                    x.tools.push({ id: `t-${nanoid(6)}`, number: next, type: 'router', name: 'New tool', diameter: 10, maxDepth: 30 })
                  })
                }
              >
                <Plus /> Add tool
              </Button>
            </div>
            <EditableTable
              rows={m.tools}
              columns={TOOL_COLS}
              onChange={(id, key, value) =>
                updateMachine((x) => {
                  const t = x.tools.find((tt) => tt.id === id) as Record<string, unknown> | undefined
                  if (t) t[key as string] = value
                })
              }
              onDelete={(t) => updateMachine((x) => void (x.tools = x.tools.filter((tt) => tt.id !== t.id)))}
              canDelete={(t) => (t.number === m.cutoutToolNumber ? 'This is the cut-out tool' : null)}
              empty="No tools. Import the machine's tool list as CSV."
            />
            <p className="text-[11px] text-muted-foreground">
              Drills are matched by exact diameter and depth ≤ max depth. Pockets use the largest router that fits the groove width. Missing tools are reported as errors before export.
            </p>
          </div>
        </div>
      </div>
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} kinds={['tools']} />
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset machine profile?</DialogTitle>
            <DialogDescription>Replaces the tool table and machine settings with the built-in placeholder data. Export the tools CSV first if you want to keep them.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                resetMachine()
                setResetOpen(false)
              }}
            >
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
