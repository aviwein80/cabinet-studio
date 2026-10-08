import { ArrowLeft, Box, CircleAlert, Eye, EyeOff, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/app/store'
import { EmptyState, PageHeader } from '@/components/PageHeader'
import { Viewer3D } from '@/components/Viewer3D'
import { useConfigureTarget } from '@/components/configureFocus'
import { KitchenFields } from '@/components/KitchenFields'
import { NONE, NumField, Section, SelectField, SwitchField, TextField } from '@/components/fields'
import { LenInput } from '@/components/LenInput'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { buildCabinet, generateCarcass, isOpInsidePart } from '@/core/construction/carcass'
import { drawerBoard, KITCHEN_DEFAULTS } from '@/core/defaults'
import { ValueBadges } from '@/components/Configure'
import { placeholderBoard } from '@/core/confirm'
import { TemplateJobsButton } from '@/pages/LibraryEditDialog'
import { formatLength, sizedName } from '@/core/units'
import type { AnyEdgeKey, CabinetInstance, CarcassParams, DrillOp, Library, Part, PartOverride, UnitSystem } from '@/core/types'
import { EDGE_KEYS, INSIDE_EDGE_KEYS } from '@/core/types'
import { cn } from '@/lib/utils'

type Target = { kind: 'cabinet'; jobId: string; cabinetId: string } | { kind: 'template'; templateId: string }

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export function CabinetEditorPage({ target }: { target: Target }) {
  const { data, go, route, updateCabinet, updateLibrary, saveTemplate } = useStore()
  const [selected, setSelected] = useState<string | null>(null)
  const [explode, setExplode] = useState(0)
  const [hideDoors, setHideDoors] = useState(false)
  const [showOps, setShowOps] = useState(true)
  const [saveOpen, setSaveOpen] = useState(false)
  const [holeFor, setHoleFor] = useState<Part | null>(null)
  useConfigureTarget(['kitchen'])

  const job = target.kind === 'cabinet' ? data?.jobs.find((j) => j.id === target.jobId) : undefined
  const cab: CabinetInstance | undefined = useMemo(() => {
    if (!data) return undefined
    if (target.kind === 'cabinet') return job?.cabinets.find((c) => c.id === target.cabinetId)
    const t = data.library.templates.find((tt) => tt.id === target.templateId)
    return t && { id: t.id, number: 'TPL', name: t.name, templateId: t.id, qty: 1, params: t.params, overrides: {} }
  }, [data, job, target])

  const built = useMemo(() => {
    if (!cab || !data) return null
    try {
      return { all: generateCarcass(cab.params, data.library, cab.pin).parts, final: buildCabinet(cab, data.library, data.settings.units), error: null }
    } catch (e) {
      return { all: [], final: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [cab, data])

  if (!data) return null
  if (!cab || !built)
    return (
      <div className="p-6">
        <EmptyState icon={<CircleAlert className="size-5" />} title="Cabinet not found" action={<Button onClick={() => go({ page: 'jobs' })}>Back to jobs</Button>} />
      </div>
    )

  const lib = data.library

  const commit = (next: CabinetInstance) => {
    if (target.kind === 'cabinet') updateCabinet(target.jobId, next)
    else
      updateLibrary((l) => {
        const t = l.templates.find((tt) => tt.id === target.templateId)
        if (t) {
          t.params = clone(next.params)
          t.name = next.name
        }
      })
  }
  const setP = (fn: (p: CarcassParams) => void) => {
    const next = clone(cab)
    fn(next.params)
    commit(next)
  }
  const setOverride = (key: string, fn: (o: PartOverride) => void) => {
    const next = clone(cab)
    const o = next.overrides[key] ?? {}
    fn(o)
    if (!o.exclude && !o.edges && !o.extraOps?.length && !o.materialId && o.cornerRadius === undefined) delete next.overrides[key]
    else next.overrides[key] = o
    commit(next)
  }

  const p = cab.params
  const from = route.page === 'cabinet' ? route.from : undefined
  const back = () => (target.kind === 'cabinet' ? go({ page: 'job', jobId: target.jobId, tab: from }) : go({ page: 'library', tab: 'templates' }))
  const matOptions = (thin?: boolean) =>
    lib.materials
      .filter((m) => (thin === undefined ? true : thin ? m.thickness <= 10 : m.thickness > 10))
      .map((m) => ({ value: m.id, label: `${m.code} · ${m.name}` }))
  const bandOptions = [{ value: NONE, label: 'None' }, ...lib.edgebands.map((e) => ({ value: e.id, label: `${e.code} · ${e.name}` }))]
  const drawerDefault = drawerBoard(lib)
  const finalParts = built.final?.parts ?? []
  const warnings = built.final?.warnings ?? []
  // Kitchen-2: fillers and end panels use few of the carcass settings; a blind corner has one door, no drawers
  // Kitchen-3: a pie-cut has two doors (one on each leg), no drawers, always a full top
  const panel = p.panel?.type
  const corner = !!p.corner && !panel
  const pie = p.corner?.type === 'pie-cut' && !panel

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        back={
          <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={back}>
            <ArrowLeft />
          </Button>
        }
        title={
          <span className="flex items-center gap-2">
            {target.kind === 'cabinet' ? (
              <span className="rounded bg-stone-800 px-1.5 py-0.5 font-mono text-xs text-white">{cab.number}</span>
            ) : (
              <Badge variant="outline">Template</Badge>
            )}
            {cab.name}
          </span>
        }
        subtitle={target.kind === 'cabinet' ? `${job?.number} · ${job?.name}` : 'Existing jobs keep their copy of this template. New cabinets use what you edit here.'}
        actions={
          <>
            {target.kind === 'cabinet' && cab.templateId && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const t = lib.templates.find((tt) => tt.id === cab.templateId)
                  if (!t) return toast.error('Original template no longer exists')
                  commit({ ...clone(cab), params: clone(t.params), overrides: {} })
                  toast.success('Reset to template')
                }}
              >
                <RotateCcw /> Reset to template
              </Button>
            )}
            {target.kind === 'template' && <TemplateJobsButton templateId={target.templateId} />}
            <Button size="sm" variant="outline" onClick={() => setSaveOpen(true)}>
              <Save /> Save as template
            </Button>
            <Button size="sm" onClick={back}>
              Done
            </Button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="order-2 w-full shrink-0 overflow-y-auto border-t bg-background lg:order-1 lg:w-[340px] lg:border-t-0 lg:border-r">
          <Section title="Cabinet">
            <TextField label="Name" value={cab.name} onChange={(v) => commit({ ...clone(cab), name: v })} />
            <SelectField
              label="Type"
              value={p.kind}
              options={[
                { value: 'base', label: 'Base' },
                { value: 'wall', label: 'Wall' },
                { value: 'tall', label: 'Tall' },
              ]}
              onChange={(v) => setP((x) => (x.kind = v))}
            />
            <div className="grid grid-cols-1 gap-2">
              {panel !== 'end-panel' && !pie && <NumField label="Width" value={p.width} min={panel ? 3 : 150} max={1500} onChange={(v) => setP((x) => (x.width = v))} />}
              <NumField label="Height" value={p.height} min={200} max={2700} onChange={(v) => setP((x) => (x.height = v))} />
              {!pie && <NumField label="Depth" value={p.depth} min={panel ? 50 : 150} max={900} onChange={(v) => setP((x) => (x.depth = v))} />}
            </div>
            {!panel && (
              <SelectField
                label="Corner"
                value={p.corner?.type === 'blind' ? `blind-${p.corner.blindSide}` : p.corner?.type === 'pie-cut' ? `pie-${p.corner.side}` : 'none'}
                options={[
                  { value: 'none', label: 'Not a corner cabinet' },
                  { value: 'blind-left', label: 'Blind corner, blind left' },
                  { value: 'blind-right', label: 'Blind corner, blind right' },
                  { value: 'pie-left', label: 'Pie-cut corner, back-left' },
                  { value: 'pie-right', label: 'Pie-cut corner, back-right' },
                ]}
                onChange={(v) =>
                  setP((x) => {
                    // Kitchen-3: a pie-cut keeps its leg depth as the cabinet depth when it stops being one
                    const wasPie = x.corner?.type === 'pie-cut' ? x.corner : null
                    if (v === 'none') {
                      if (wasPie) x.depth = wasPie.legDepth
                      return void delete x.corner
                    }
                    if (v.startsWith('pie-')) {
                      const side = v === 'pie-left' ? 'left' : 'right'
                      // the box it stands in: the leg along the back wall stays the width; the side leg as long; legs as deep as the cabinet was
                      if (!wasPie) {
                        const legDepth = x.depth
                        x.depth = Math.max(x.width, legDepth + 300)
                        x.corner = { type: 'pie-cut', side, legDepth, cornerDoor: 'back' }
                      } else x.corner = { ...wasPie, side }
                      x.top = 'full'
                      x.doors.count = x.doors.count === 0 ? 0 : 2
                      x.drawers.count = 0
                      return
                    }
                    const side = v === 'blind-left' ? 'left' : 'right'
                    if (wasPie) x.depth = wasPie.legDepth
                    const was = x.corner?.type === 'blind' ? x.corner : null
                    // the blind part as deep as a return run of the same depth; one door on the open side
                    x.corner = { type: 'blind', blindSide: side, blindWidth: was?.blindWidth ?? Math.min(x.depth, x.width - 150), pullOut: was?.pullOut ?? KITCHEN_DEFAULTS.pullOut, blindPanel: was?.blindPanel ?? true, ...(was?.wall ? { wall: was.wall } : {}) }
                    x.doors.count = x.doors.count === 0 ? 0 : 1
                    x.doors.hingeSide = side === 'left' ? 'right' : 'left'
                    x.drawers.count = 0
                  })
                }
              />
            )}
          </Section>
          {(corner || panel) && (
            <Section title={pie ? 'Pie-cut corner' : corner ? 'Blind corner' : panel === 'filler' ? 'Filler' : 'End panel'}>
              <KitchenFields p={p} set={setP} lib={lib} />
            </Section>
          )}
          {panel && (p.kind === 'base' || p.kind === 'tall') && (
            <Section title="Toe kick" description={panel === 'filler' ? 'The strip starts above it.' : 'Sets the notch.'}>
              <SwitchField label="Toe kick" checked={p.toeKick.enabled} onChange={(v) => setP((x) => (x.toeKick.enabled = v))} />
              {p.toeKick.enabled && (
                <div className="grid grid-cols-2 gap-2">
                  <NumField label="Toe kick height" value={p.toeKick.height} min={0} max={250} onChange={(v) => setP((x) => (x.toeKick.height = v))} />
                  <NumField label="Setback" value={p.toeKick.setback} min={0} max={150} onChange={(v) => setP((x) => (x.toeKick.setback = v))} />
                </div>
              )}
            </Section>
          )}
          {panel && (
            <Section title="Edgebanding">
              <SelectField label="Visible edges" value={p.edgebands.door ?? NONE} options={bandOptions} onChange={(v) => setP((x) => (x.edgebands.door = v === NONE ? null : v))} hint="Never on a scribed edge." />
            </Section>
          )}
          {!panel && (
            <>
          <Section title="Materials">
            <SelectField label="Carcass" value={p.carcassMaterialId} options={matOptions(false)} onChange={(v) => setP((x) => (x.carcassMaterialId = v))} />
            <SelectField label="Back" value={p.backMaterialId} options={matOptions()} onChange={(v) => setP((x) => (x.backMaterialId = v))} />
            <SelectField label="Doors" value={p.doorMaterialId} options={matOptions(false)} onChange={(v) => setP((x) => (x.doorMaterialId = v))} />
          </Section>
          <Section title="Construction">
            {p.kind === 'base' && (
              <>
                <SwitchField label="Toe kick" checked={p.toeKick.enabled} onChange={(v) => setP((x) => (x.toeKick.enabled = v))} hint="Notched sides, bottom raised above the floor." />
                {p.toeKick.enabled && (
                  <div className="grid grid-cols-2 gap-2">
                    <NumField label="Toe kick height" value={p.toeKick.height} min={0} max={250} onChange={(v) => setP((x) => (x.toeKick.height = v))} />
                    <NumField label="Setback" value={p.toeKick.setback} min={0} max={150} onChange={(v) => setP((x) => (x.toeKick.setback = v))} />
                  </div>
                )}
              </>
            )}
            {pie ? (
              <p className="text-[11px] text-muted-foreground">A full L-shaped top, banded on its inside edges.</p>
            ) : (
            <div className="grid grid-cols-2 gap-2">
              <SelectField
                label="Top"
                value={p.top}
                options={[
                  { value: 'rails', label: 'Two rails' },
                  { value: 'full', label: 'Full top' },
                ]}
                onChange={(v) => setP((x) => (x.top = v))}
              />
              {p.top === 'rails' && <NumField label="Rail depth" value={p.railDepth} min={50} max={200} onChange={(v) => setP((x) => (x.railDepth = v))} />}
            </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <SelectField
                label="Bottom joint"
                value={p.bottomJoint}
                options={[
                  { value: 'dado', label: 'Dado in sides' },
                  { value: 'butt', label: 'Butt' },
                ]}
                onChange={(v) => setP((x) => (x.bottomJoint = v))}
              />
              {p.bottomJoint === 'dado' && <NumField label="Dado depth" value={p.dadoDepth} min={2} max={12} step={0.5} onChange={(v) => setP((x) => (x.dadoDepth = v))} />}
            </div>
            <SelectField
              label="Joinery"
              value={p.joinery}
              options={[
                { value: 'screw', label: 'Screw pilots (face drilled)' },
                { value: 'confirmat', label: 'Confirmat (face + edge)' },
                { value: 'dowel', label: 'Dowels (face + edge)' },
                { value: 'none', label: 'None' },
              ]}
              onChange={(v) => setP((x) => (x.joinery = v))}
              hint={p.joinery === 'dowel' || p.joinery === 'confirmat' ? 'Edge holes need a horizontal drill unit; otherwise they are listed on labels for manual drilling.' : undefined}
            />
          </Section>
          <Section title="Back panel">
            <SelectField
              label="Back fixing"
              value={p.back.type}
              options={[
                { value: 'groove', label: 'Groove (captured)' },
                { value: 'rabbet', label: 'Rabbet' },
                { value: 'applied', label: 'Applied (screwed on)' },
              ]}
              onChange={(v) => setP((x) => (x.back.type = v))}
            />
            {p.back.type !== 'applied' && (
              <div className="grid grid-cols-2 gap-2">
                <NumField label="Depth" value={p.back.grooveDepth} min={3} max={12} step={0.5} onChange={(v) => setP((x) => (x.back.grooveDepth = v))} />
                <NumField label="Setback" value={p.back.setback} min={0} max={40} onChange={(v) => setP((x) => (x.back.setback = v))} />
                <NumField label="Clearance" value={p.back.clearance} min={0} max={3} step={0.1} onChange={(v) => setP((x) => (x.back.clearance = v))} />
              </div>
            )}
          </Section>
          <Section title="Shelves and 32 mm system">
            <div className="grid grid-cols-2 gap-2">
              <NumField label="Shelves" suffix="" value={p.shelves.count} min={0} max={8} onChange={(v) => setP((x) => (x.shelves.count = Math.round(v)))} />
              <NumField label="Front setback" value={p.shelves.frontSetback} min={0} max={50} onChange={(v) => setP((x) => (x.shelves.frontSetback = v))} />
            </div>
            <SwitchField label="Shelf-pin rows" checked={p.shelfPins.enabled} onChange={(v) => setP((x) => (x.shelfPins.enabled = v))} hint="Holes on a 32 mm pitch from the bottom panel." />
            {p.shelfPins.enabled && (
              <div className="grid grid-cols-2 gap-2">
                <NumField label="Ø" value={p.shelfPins.diameter} min={3} max={10} step={0.5} onChange={(v) => setP((x) => (x.shelfPins.diameter = v))} />
                <NumField label="Depth" value={p.shelfPins.depth} min={5} max={16} onChange={(v) => setP((x) => (x.shelfPins.depth = v))} />
                <NumField label="Pitch" value={p.shelfPins.pitch} min={16} max={64} onChange={(v) => setP((x) => (x.shelfPins.pitch = v))} />
                <NumField label="Front row" value={p.shelfPins.setbackFront} min={20} max={100} onChange={(v) => setP((x) => (x.shelfPins.setbackFront = v))} />
                <NumField label="Back row" value={p.shelfPins.setbackBack} min={20} max={100} onChange={(v) => setP((x) => (x.shelfPins.setbackBack = v))} />
                <NumField label="Zone margin" value={p.shelfPins.zoneMargin} min={0} max={200} onChange={(v) => setP((x) => (x.shelfPins.zoneMargin = v))} />
              </div>
            )}
          </Section>
          <Section title="Doors and hinges">
            <div className="grid grid-cols-2 gap-2">
              <SelectField
                label="Doors"
                value={(pie ? (p.doors.count > 0 ? '2' : '0') : String(p.doors.count)) as '0' | '1' | '2'}
                options={
                  pie
                    ? [
                        { value: '0', label: 'None' },
                        { value: '2', label: 'Two, one on each leg' },
                      ]
                    : corner
                    ? [
                        { value: '0', label: 'None' },
                        { value: '1', label: 'One' },
                      ]
                    : [
                        { value: '0', label: 'None' },
                        { value: '1', label: 'One' },
                        { value: '2', label: 'Pair' },
                      ]
                }
                onChange={(v) => setP((x) => (x.doors.count = Number(v) as 0 | 1 | 2))}
              />
              {p.doors.count === 1 && !corner && (
                <SelectField
                  label="Hinge side"
                  value={p.doors.hingeSide}
                  options={[
                    { value: 'left', label: 'Left' },
                    { value: 'right', label: 'Right' },
                  ]}
                  onChange={(v) => setP((x) => (x.doors.hingeSide = v))}
                />
              )}
            </div>
            {p.doors.count > 0 && (
              <div className="grid grid-cols-2 gap-2">
                <NumField label="Gap" value={p.doors.gap} min={0} max={10} step={0.5} onChange={(v) => setP((x) => (x.doors.gap = v))} />
                <NumField label="Cup Ø" value={p.doors.cupDiameter} min={20} max={40} onChange={(v) => setP((x) => (x.doors.cupDiameter = v))} />
                <NumField label="Cup depth" value={p.doors.cupDepth} min={8} max={16} step={0.5} onChange={(v) => setP((x) => (x.doors.cupDepth = v))} />
                <NumField label="Cup centre" value={p.doors.cupEdgeDistance} min={18} max={30} step={0.5} onChange={(v) => setP((x) => (x.doors.cupEdgeDistance = v))} hint="Salice K3 = 20.5" />
                <NumField label="From end" value={p.doors.hingeFromEnd} min={50} max={200} onChange={(v) => setP((x) => (x.doors.hingeFromEnd = v))} />
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">Salice Silentia+ 110° soft-close. The 35 mm cup is bored K = 3 mm from the door edge, and the 3 mm plate screws go 37 mm back from the side's front edge, 32 mm apart.</p>
          </Section>
          {!corner && (
          <Section title="Drawers" description="Blum TANDEM plus BLUMOTION. Stacked from the bottom; doors, if any, sit above them.">
            <div className="grid grid-cols-2 gap-2">
              <NumField label="Drawers" suffix="" value={p.drawers.count} min={0} max={6} onChange={(v) => setP((x) => (x.drawers.count = Math.round(v)))} />
              <SelectField
                label="Slide"
                value={String(p.drawers.slide)}
                options={[
                  { value: 'auto', label: 'Auto from depth' },
                  { value: '15', label: '15 in (381 mm)' },
                  { value: '18', label: '18 in (457 mm)' },
                  { value: '21', label: '21 in (533 mm)' },
                ]}
                onChange={(v) => setP((x) => (x.drawers.slide = v === 'auto' ? 'auto' : (Number(v) as 15 | 18 | 21)))}
              />
            </div>
            {p.drawers.count > 0 && (
              <SelectField
                label="Box material"
                value={p.drawers.boxMaterialId ?? NONE}
                // Polish-2: not chosen = the library's 16 mm drawer-box board (owner decision); the carcass board only when there is none
                options={[{ value: NONE, label: drawerDefault ? `Drawer-box board: ${drawerDefault.code} · ${drawerDefault.name}` : 'Same as carcass (no 16 mm board in the library)' }, ...lib.materials.filter((m) => m.thickness > 10).map((m) => ({ value: m.id, label: `${m.code} · ${m.name}${m.thickness > 16.01 ? ' (too thick for TANDEM)' : ''}` }))]}
                onChange={(v) => setP((x) => (x.drawers.boxMaterialId = v === NONE ? undefined : v))}
                hint="Sides, subfront and back. Blum TANDEM takes sides up to 16 mm (5/8 in)."
                badge={<ValueBadges item={placeholderBoard(p.drawers.boxMaterialId ? lib.materials.find((m) => m.id === p.drawers.boxMaterialId) : drawerDefault, data.machine) ?? undefined} />}
              />
            )}
            {p.doors.count > 0 && p.drawers.count > 0 && (
              <NumField label="Drawer front height" value={p.drawers.frontHeight} min={80} max={400} onChange={(v) => setP((x) => (x.drawers.frontHeight = v))} hint="All-drawer cabinets split the opening equally instead." />
            )}
          </Section>
)}
          <Section title="Edgebanding">
            <SelectField label="Carcass front edges" value={p.edgebands.carcassFront ?? NONE} options={bandOptions} onChange={(v) => setP((x) => (x.edgebands.carcassFront = v === NONE ? null : v))} />
            <SelectField label="Shelf front" value={p.edgebands.shelfFront ?? NONE} options={bandOptions} onChange={(v) => setP((x) => (x.edgebands.shelfFront = v === NONE ? null : v))} />
            <SelectField label="Doors (all edges)" value={p.edgebands.door ?? NONE} options={bandOptions} onChange={(v) => setP((x) => (x.edgebands.door = v === NONE ? null : v))} />
          </Section>
            </>
          )}
        </aside>

        <div className="order-1 flex min-h-0 min-w-0 flex-1 flex-col lg:order-2">
          <div className="relative h-[46vh] min-h-[300px] shrink-0 border-b bg-gradient-to-b from-stone-100 to-stone-200 lg:h-auto lg:min-h-0 lg:flex-[1.2]">
            {built.error ? (
              <div className="flex h-full items-center justify-center p-6 text-sm text-red-700">Cannot build this cabinet: {built.error}</div>
            ) : (
              <Viewer3D parts={finalParts} library={lib} width={p.width} height={p.height} depth={p.depth} selected={selected} onSelect={setSelected} explode={explode} showOps={showOps} hideDoors={hideDoors} />
            )}
            <div className="absolute top-3 left-3 flex flex-wrap items-center gap-3 rounded-lg border bg-background/90 px-3 py-2 text-xs shadow-sm backdrop-blur">
              <span className="flex items-center gap-2">
                Explode
                <Slider className="w-24" min={0} max={250} step={10} value={[explode]} onValueChange={([v]) => setExplode(v)} />
              </span>
              <Button size="xs" variant={hideDoors ? 'secondary' : 'ghost'} onClick={() => setHideDoors(!hideDoors)}>
                {hideDoors ? <EyeOff /> : <Eye />} Fronts
              </Button>
              <Button size="xs" variant={showOps ? 'secondary' : 'ghost'} onClick={() => setShowOps(!showOps)}>
                Holes
              </Button>
            </div>
            <div className="absolute right-3 bottom-3 rounded bg-background/80 px-2 py-1 font-mono text-[11px] text-muted-foreground">
              {formatLength(p.width, data.settings.units)} × {formatLength(p.height, data.settings.units)} × {formatLength(p.depth, data.settings.units)} · drag to orbit
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-background">
            {warnings.length > 0 && (
              <div className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-900">
                {warnings.map((w) => (
                  <div key={w}>{w}</div>
                ))}
              </div>
            )}
            <PartsTable
              all={built.all}
              finalParts={finalParts}
              cab={cab}
              lib={lib}
              units={data.settings.units}
              selected={selected}
              onSelect={setSelected}
              setOverride={setOverride}
              onAddHole={setHoleFor}
              editable={target.kind === 'cabinet'}
            />
          </div>
        </div>
      </div>

      <SaveTemplateDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        defaultName={sizedName(cab.name, p.width, data.settings.units)}
        onSave={(name, desc) => {
          const id = saveTemplate(name, desc, p)
          toast.success(`Template "${name}" saved to library`, { action: { label: 'Open', onClick: () => go({ page: 'template', templateId: id }) } })
        }}
      />
      <AddHoleDialog
        part={holeFor}
        onClose={() => setHoleFor(null)}
        onAdd={(op) => {
          if (!holeFor) return
          setOverride(holeFor.key, (o) => (o.extraOps = [...(o.extraOps ?? []), op]))
          toast.success(`Hole added to ${holeFor.name}`)
        }}
      />
    </div>
  )
}

function PartsTable({
  all,
  finalParts,
  cab,
  lib,
  units,
  selected,
  onSelect,
  setOverride,
  onAddHole,
  editable,
}: {
  all: Part[]
  finalParts: Part[]
  cab: CabinetInstance
  lib: Library
  units: UnitSystem
  selected: string | null
  onSelect: (k: string | null) => void
  setOverride: (key: string, fn: (o: PartOverride) => void) => void
  onAddHole: (p: Part) => void
  editable: boolean
}) {
  const byKey = new Map(finalParts.map((pp) => [pp.key, pp]))
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {editable && <TableHead className="w-10">Use</TableHead>}
          <TableHead>Part</TableHead>
          <TableHead className="text-right">L × W × T</TableHead>
          <TableHead>Material</TableHead>
          <TableHead>Edges (L1 L2 W1 W2; L3 W3 inside an L)</TableHead>
          <TableHead className="text-right">Ops</TableHead>
          {editable && <TableHead className="w-10" />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {all.map((raw) => {
          const ov = cab.overrides[raw.key]
          const part = byKey.get(raw.key) ?? raw
          const excluded = !!ov?.exclude
          const mat = lib.materials.find((m) => m.id === part.materialId)
          return (
            <TableRow key={raw.key} data-state={selected === raw.key ? 'selected' : undefined} className={cn('cursor-pointer', excluded && 'opacity-45')} onClick={() => onSelect(selected === raw.key ? null : raw.key)}>
              {editable && (
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={!excluded} onCheckedChange={(v) => setOverride(raw.key, (o) => (o.exclude = v === true ? undefined : true))} aria-label={`Include ${raw.name}`} />
                </TableCell>
              )}
              <TableCell>
                <div className="font-medium">{part.name}</div>
                <div className="font-mono text-[10px] text-muted-foreground">{raw.key}</div>
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">
                {formatLength(part.length, units)} × {formatLength(part.width, units)} × {formatLength(part.thickness, units)}
              </TableCell>
              <TableCell className="font-mono text-xs">{mat?.code ?? part.materialId}</TableCell>
              <TableCell onClick={(e) => e.stopPropagation()}>
                <div className="flex gap-1">
                  {(part.shape === 'L' ? [...EDGE_KEYS, ...INSIDE_EDGE_KEYS] : EDGE_KEYS).map((k) => (
                    <EdgeToggle
                      key={k}
                      edge={k}
                      value={part.edges[k] ?? null}
                      lib={lib}
                      disabled={!editable || excluded}
                      onChange={(v) => setOverride(raw.key, (o) => (o.edges = { ...(o.edges ?? {}), [k]: v }))}
                    />
                  ))}
                  {/* Kitchen-3c: this L part's own inside corner radius (as cut); blank = the job's. Polish-2: in the shop unit */}
                  {part.shape === 'L' && editable && (
                    <span className="ml-1 flex items-center gap-0.5 text-[10px] text-muted-foreground" title={`Inside corner radius as cut, in ${units === 'in' ? 'inches' : 'mm'}. Blank: the job's.`}>
                      R
                      <LenInput label={`${part.name} inside corner radius`} units={units} fine value={ov?.cornerRadius ?? NaN} optional placeholder="job" className="h-6 w-14" onChange={(v) => setOverride(raw.key, (o) => (o.cornerRadius = Number.isFinite(v) && v >= 0 ? v : undefined))} />
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums">
                {part.ops.length}
                {(ov?.extraOps?.length ?? 0) > 0 && <span className="ml-1 text-amber-700">(+{ov!.extraOps!.length})</span>}
              </TableCell>
              {editable && (
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <div className="flex">
                    <Button size="icon-xs" variant="ghost" aria-label="Add hole" disabled={excluded} onClick={() => onAddHole(part)}>
                      <Plus />
                    </Button>
                    {(ov?.extraOps?.length ?? 0) > 0 && (
                      <Button size="icon-xs" variant="ghost" aria-label="Remove custom holes" onClick={() => setOverride(raw.key, (o) => (o.extraOps = undefined))}>
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </TableCell>
              )}
            </TableRow>
          )
        })}
        {all.length === 0 && (
          <TableRow>
            <TableCell colSpan={7}>
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Box className="size-4" /> No parts generated
              </div>
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
}

function EdgeToggle({ edge, value, lib, disabled, onChange }: { edge: AnyEdgeKey; value: string | null; lib: Library; disabled: boolean; onChange: (v: string | null) => void }) {
  const band = lib.edgebands.find((e) => e.id === value)
  return (
    <Select value={value ?? NONE} disabled={disabled} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger size="sm" className={cn('h-6 w-11 justify-center px-1 font-mono text-[10px] [&>svg]:hidden', band ? 'border-amber-400 bg-amber-50' : '')} title={`${edge}: ${band?.name ?? 'raw'}`}>
        <SelectValue>{band ? edge : '–'}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{edge}: no band</SelectItem>
        {lib.edgebands.map((e) => (
          <SelectItem key={e.id} value={e.id}>
            {edge}: {e.code}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function SaveTemplateDialog({ open, onOpenChange, defaultName, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; defaultName: string; onSave: (name: string, desc: string) => void }) {
  const [name, setName] = useState(defaultName)
  const [desc, setDesc] = useState('')
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setName(defaultName)
        onOpenChange(o)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save as library template</DialogTitle>
          <DialogDescription>Saves the parameters only. Per-part overrides stay with this job's cabinet.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <TextField label="Template name" value={name} onChange={setName} />
          <TextField label="Description" value={desc} onChange={setDesc} placeholder="When to use this cabinet" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim()}
            onClick={() => {
              onSave(name.trim(), desc.trim())
              onOpenChange(false)
            }}
          >
            Save template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddHoleDialog({ part, onClose, onAdd }: { part: Part | null; onClose: () => void; onAdd: (op: DrillOp) => void }) {
  const units = useStore((s) => s.data?.settings.units ?? 'mm')
  const L = (n: number | undefined) => (n === undefined ? '' : formatLength(n, units))
  const [h, setH] = useState({ x: 100, y: 50, diameter: 8, depth: 12, through: false })
  const op: DrillOp | null = part ? { kind: 'drill', id: `custom-${nanoid(6)}`, x: h.x, y: h.y, diameter: h.diameter, depth: h.through ? part.thickness : h.depth, through: h.through, purpose: 'custom' } : null
  const inside = part && op ? isOpInsidePart(part, op) : true
  const tooDeep = part ? !h.through && h.depth >= part.thickness : false
  return (
    <Dialog open={!!part} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add hole to {part?.name}</DialogTitle>
          <DialogDescription>
            Finished-size coordinates on the face-up side: x along the length (0–{L(part?.length)}), y across the width (0–{L(part?.width)}).
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <NumField label="x" value={h.x} onChange={(v) => setH({ ...h, x: v })} />
          <NumField label="y" value={h.y} onChange={(v) => setH({ ...h, y: v })} />
          {/* Polish-2: drill sizes exact in an inch shop ("8 mm", or an exact fraction), never rounded to 1/16 */}
          <NumField tool label="Diameter" value={h.diameter} min={2} max={40} step={0.5} onChange={(v) => setH({ ...h, diameter: v })} />
          {!h.through && <NumField tool label="Depth" value={h.depth} min={1} max={60} step={0.5} onChange={(v) => setH({ ...h, depth: v })} />}
          <div className="col-span-2">
            <SwitchField label="Through hole" checked={h.through} onChange={(v) => setH({ ...h, through: v })} hint="Goes through the panel plus the machine's through depth into the spoilboard." />
          </div>
        </div>
        {!inside && <p className="text-xs text-red-700">The hole centre is outside the part.</p>}
        {tooDeep && <p className="text-xs text-red-700">Depth must be less than the {L(part?.thickness)} thickness, or mark it as a through hole.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!inside || tooDeep}
            onClick={() => {
              if (op) onAdd(op)
              onClose()
            }}
          >
            Add hole
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
