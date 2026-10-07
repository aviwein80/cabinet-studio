import { Fragment } from 'react'
import { NOT_LICENSED, PREVIEW_NAME, STUB_ENGINE } from '@/cam/multiaxis/engine'
import { isN200 } from '@/core/validator'
import { FileDown, FileUp, GitCompareArrows, Plus, RotateCcw, TriangleAlert } from 'lucide-react'
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
import { nestSettingsOf, partSpacing } from '@/core/machining'
import { featuresOf } from '@/core/features'
import type { FeatureFlags, Tool, ToolType } from '@/core/types'
import { MachineModelSection } from './machine/MachineModelSection'
import { CutDefaultsSection } from './machine/CutDefaultsSection'
import { ConfigureBadge, UnconfirmedList, ValueBadges } from '@/components/Configure'
import { useConfigureTarget } from '@/components/configureFocus'
import { confirmKey, machineUnconfirmed, toolUnconfirmed } from '@/core/confirm'
import { nestUnconfirmed } from '@/core/nestConfirm'
import { ToolDialog } from './machine/ToolDialog'
import { ToolGrid } from './machine/ToolGrid'
import { ToolSheetDialog } from './machine/ToolSheetDialog'
import { ToolCompareDialog } from './machine/ToolCompareDialog'
import { HoldersSection } from './machine/HoldersSection'
import { AggregatesSection } from './machine/AggregatesSection'
import { FixtureLibrarySection, MachineBodiesSection } from './machine/MachineSimSections'
import { MachinesSection } from './machine/MachinesSection'
import { ToolOrderSection } from './machine/ToolOrderSection'
import { AdminLocked } from '@/components/AdminLock'
import { isLocked } from '@/core/admin'
import { applyToolTable, toolsCsv, toolsXlsx } from '@/core/toolData'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

const TOOL_TYPES: { value: ToolType; label: string }[] = [
  { value: 'router', label: 'Router' },
  { value: 'drill-vertical', label: 'Vertical drill' },
  { value: 'drill-horizontal', label: 'Horizontal drill' },
  { value: 'saw', label: 'Saw' },
]

const FEATURE_ROWS: [keyof FeatureFlags, string, string][] = [
  ['camCad', 'Part designer', 'Draw and edit shaped parts.'],
  ['camImport', 'Drawing import and export', 'DXF in and out, PDF/AI vectors in.'],
  ['camMachining', 'Machining operations', 'Profile, pocket, drill, engrave, V-carve, sweep, saw.'],
  ['camParametric', 'Parametric doors', 'Shaker, arched and cathedral doors from variables or a door list.'],
  ['camRules', 'Machining rules', 'Layer names in imported drawings choose the operations.'],
  ['camNesting', 'True-shape nesting', 'Shaped parts nest by their outline. Off: every part nests as its rectangle.'],
  ['camBackplot', 'Simulation', 'Play the toolpaths and see the material that is left.'],
  ['camBatch', 'Batch runs', 'Part lists from CSV or an inbox folder, without opening the screens.'],
  ['hardwarePatterns', 'Drilling patterns', 'Hardware drilling patterns in the library and the Hardware button on parts.'],
  ['cam3d', '3D models', 'Import STL, OBJ and 3MF models onto parts: sections, outlines, simplify, work volume from the model.'],
  ['camRelief', 'Relief import', 'Bring in reliefs made in relief software (STL) or as height-map pictures (PNG, TIFF) at an exact size and depth, with roughing and finishing added. The panel round a relief is never cut. Screens only: relief toolpaths follow the 3D output switches below.'],
  ['cam3dFinishMore', 'More 3D finishing', 'Radial and spiral passes round a centre; scallop passes that keep the same cusp height on slopes and curves; offset passes on flat areas only (on level flats these can go out as flat layers, see below); one continuous helical descent round steep walls; lollipop tools under overhangs, roughing the material there level by level and then finishing (the simulator then keeps the material over them); curve-driven passes guided by drive curves, an earlier toolpath, the line where two surfaces meet or the rows and columns of a surface (also of a face of an imported solid, from the B-rep kernel loaded on first use), optionally kept to one side of a surface. Screens only: these passes need true 3D output, which is never written to woodWOP until its format is confirmed; simulate them.'],
  ['camRotary', 'Rotary (4-axis)', 'A part turned on a rotary axis: the axis, the blank (round or square) and wrapped planes round it (from a radius, extents or a model\'s cylindrical face); passes along the axis, rings round it or a spiral on a model, roughing in levels, and shapes drawn on a wrapped plane cut into the cylinder (also with a saw blade, along or round the axis). Simulated on a rotary stock with the gouge and collision checks. Screens only: the N-200 has no rotary axis, so a turned part is never nested or written to woodWOP; see the rotary output switch below.'],
  ['camPositional', 'Positional 3+2', 'Tilted work planes at any angle (typed in, a side of the part\'s block, or a flat face of a solid) with drilling, pockets, profiles and engraving on them, the tool along the plane\'s normal. Our own kinematics turn them into a machine\'s two locked rotary angles and its X, Y, Z (or into the plane\'s own frame), and the simulator replays them with the tool tilted, with the collision checks. Screens only: the N-200 cannot tilt its tool, so a part with tilted operations is never nested or written to woodWOP; see the 3+2 output switch below.'],
  ['camMultiAxis', 'Simultaneous 5-axis', 'Operations whose tool tilts while it cuts: along 3D curves or solid edges, swarf with the side of the tool along a wall, surface finishing and multi-axis roughing, with tool-axis control (surface or curve normal with lead and tilt, fixed tilt, through or away from a point or line, towards a guide curve), axis smoothing, cutting reversed or both ways and the head flip; barrel and form tools. The toolpaths come from a licensed 5-axis engine: none is installed (not licensed), and the built-in preview engine makes simple ones for the simulator only. Simulated with the tool tilted on every move and replayed through a machine\'s kinematics. Screens only: the N-200 has three axes, so a part with 5-axis operations is never nested or written to woodWOP; see the 5-axis output switch below.'],
  ['camMachineSim', 'Machine simulation, part compare and fixtures', 'Clamps, pods and rails on parts, from sizes, from a shape drawn on the part or from a model file, placed by hand, by dragging on the drawing or automatically clear of the toolpaths; the collision checks keep the tool, shank and holder clear of them (a hit blocks the export like any collision). The whole machine replayed in the simulator from the toolpaths or from a program read back (a post\'s output, or the part\'s own woodWOP program), its parts (gantry, head, spindle, rotary table: invented until measured) checked against the table, the part and its fixtures, and every axis against its travel. Part compare colours the simulated stock against the 3D model: gouges red, material left blue, within the tolerance green; for one part or several. Screens and checks only: nothing new is written to any machine.'],
  ['camExtras', 'Small extras', 'Thread milling (simulation only: no woodWOP form is confirmed for its helical moves); fold, flatten and wrap; hatching, detail views and line types on the drawing and in prints to scale; the stroke-font editor for engraving; rapid moves over a cylinder or sphere instead of a flat safe height (simulation and text posts; woodWOP makes its own moves between macros).'],
  ['camAdaptive', 'Rest machining and adaptive clearing', 'Pocket options: cut only what earlier operations left; clear at a steady width of cut.'],
  ['camSolids', 'Solid models', 'Import STEP, IGES and BREP solids: faces and colours, holes, pockets and outlines found and put on layers, assemblies split into parts, machining picked faces.'],
  ['camMore25d', 'More 2.5D machining', 'Saw cuts with run-out, angle and joining; facing; chamfers; cuts between curves and along 3D curves; hand-drawn toolpaths; toolpath edits; edge work with a rotating aggregate.'],
  ['camCadTools', 'CAD and tool additions', 'Turn-by-turn sketch, dimensions and print to scale, geometry queries, fill with holes, panelling, image trace; holder and aggregate library, tool grid, tool data compare and spreadsheet import/export.'],
  ['nestAdditions', 'Nesting additions', 'Areas and costs per sheet and part; shared-line and bridged cutting plans; flip-side sheets with the sheet backplot; moving parts by hand on a sheet. Screens only: each new kind of program output has its own switch, off.'],
  ['nestSharedOutput', 'Write shared-line cuts to MPR', 'Shared-line cutting writes one tool-centre pass between neighbouring parts instead of a cut-out round each. Off until proven on the machine: while off, the plan is shown and measured, and every part keeps its own cut-out.'],
  ['nestBridgeOutput', 'Write bridged groups to MPR', 'Bridged nesting cuts each group of linked small parts as one path round the parts and their bridges. Off until proven on the machine: while off, the groups are shown and every part keeps its own cut-out.'],
  ['nestFlipOutput', 'Write flip-side sheet programs', 'Sheets with underside work get a side-1 program (reference edge, underside holes, run first with the sheet face down) besides their normal program. Also needs the custom-part switch. Off until proven on the machine: while off, the side-1 program is shown in the sheet backplot and underside holes stay in each part\'s own turned-over program.'],
  ['batchAdditions', 'Batch additions', 'Other machines and process steps, batch setups and their wizards, assemblies and fittings in part lists, extra batch steps, admin tools. Screens only: programs for the other machines have their own switch, off.'],
  ['plugins', 'Plugins and program tools', 'Plugins (each in its own sandbox; nothing granted until you grant it on the Settings page), the macro recorder, script posts shown as previews, reading programs back for the simulator, and the program manager. Screens only: a plugin can never switch output on or get past the export checker.'],
  ['scriptPostOutput', 'Write programs through script posts', 'Template and script posts write G-code style programs for machines other than the N-200 (Machines and process steps). Off: their programs are shown in the Program preview, never written. Even on, a script post also needs its plugin\'s machine-output grant, and the export checker must pass for that machine; the N-200 always gets woodWOP programs.'],
  ['rotaryPostOutput', 'Write rotary programs through script posts', 'Rotary programs (with an A, B or C word) for a machine other than the N-200 whose machine model declares that rotary axis, through a script post written for it (never the built-in template post). Off: they are shown in the Program preview, never written. Even on, it needs the script-post switch above, the plugin\'s machine-output grant and a clean export check.'],
  ['positionalPostOutput', 'Write 3+2 programs through script posts', 'Programs with two locked rotary angles per operation (positional 3+2) for a machine other than the N-200 whose machine model declares two rotary axes for 3+2, through a script post written for it (never the built-in template post). Off: they are shown in the Program preview, never written. Even on, it needs the script-post switch above, the plugin\'s machine-output grant, every angle and position inside the axes\' travel and a clean export check.'],
  ['multiAxisPostOutput', 'Write 5-axis programs through script posts', 'Programs whose rotary axes move while cutting (both angles on every move) for a machine other than the N-200 whose machine model declares simultaneous 5-axis, through a script post written for it (never the built-in template post), from toolpaths made by a licensed 5-axis engine (never the preview engine). Off: they are shown in the Program preview, never written. Even on, it needs the script-post switch above, the plugin\'s machine-output grant, every angle and position inside the travel, our own gouge check passing and a clean export check.'],
  ['editedProgramOutput', 'Copy hand-edited programs to the machine folder', 'The program manager can edit a program by hand (line numbers, simple maths on values). Off: edited programs can be checked, simulated and saved with the job, but only the programs as generated (and checked by the export checker) are copied to the machine folder. Even on, an edited program must read back with no errors, stay on the table and above the spoilboard allowance, and use tools from the table.'],
  ['batchMachinesOutput', 'Write programs for other machines', 'Batch runs nest and check the part list for every machine of the setup. Off until proven on those machines: while off, only the main machine\'s programs are written and the others are listed in the report.'],
  ['camMprOutput', 'Write custom-part machining to MPR', 'Off: custom parts are nested and labelled, and the export checker blocks MPR export until this is on.'],
  ['cam3dMprOutput', 'Write 3D roughing, waterline and flat areas to MPR', 'Z-level roughing, waterline finishing and flat-area finishing on level flats as contour-milling passes, each at its own depth (also needs the switch above). Off until a program is proven on the machine. Every other 3D finishing strategy (parallel, projection, pencil, radial, spiral and the rest), flat areas that are not quite level, and adaptive roughing, is never written.'],
  ['cam25dMprOutput', 'Write facing, chamfers and saw cuts to MPR', 'The newer 2.5D operations that have a woodWOP form, as contour-milling passes and saw grooves (also needs the custom-part switch). Off until proven on the machine. Saw grooves also need a saw unit in the machine model. Angled saw cuts, curve cuts, edge work with an aggregate and edited toolpaths are never written.'],
]

const TOOL_COLS: Column<Tool>[] = [
  { key: 'number', label: 'Tool no.', type: 'num', width: '90px' },
  { key: 'type', label: 'Type', type: 'select', width: '170px', options: TOOL_TYPES },
  { key: 'name', label: 'Description', type: 'text' },
  { key: 'diameter', label: 'Ø / kerf', type: 'num', width: '90px' },
  { key: 'maxDepth', label: 'Max depth', type: 'num', width: '100px' },
]

export function MachinePage() {
  const { data, updateMachine, updateSettings, resetMachine, mutate, machineEdit, editMachine, adminUnlocked } = useStore()
  const [importOpen, setImportOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [editTool, setEditTool] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  // a "Configure" badge elsewhere asked for a field on this page: open its tool, then focus it
  const cadTools = featuresOf(data?.settings).camCadTools
  useConfigureTarget(['tool', 'holder', 'aggregate', 'model', 'default', 'nest', 'bodies', 'fixtureType'], (t) => {
    if (t.kind === 'tool') setEditTool(t.toolId)
    // with the holder library on this page, the holder's own card takes the focus
    if (t.kind === 'holder' && !cadTools) {
      const tool = data?.machine.tools.find((x) => x.holderId === t.holderId)
      if (tool) setEditTool(tool.id)
    }
  })
  if (!data) return null
  // M2.9: this page edits the main machine or, after "Edit" in Machines and process steps, another one
  const other = machineEdit ? data.machines?.find((x) => x.id === machineEdit) : undefined
  const m = other?.profile ?? data.machine
  const s = data.settings
  const routers = m.tools.filter((t) => t.type === 'router')
  const nestItems = other ? [] : nestUnconfirmed(s, m)
  const unconfirmed = [...machineUnconfirmed(m), ...nestItems]
  const nestBadge = (k: string) => {
    const u = nestItems.find((x) => x.key === `nest:${k}`)
    return u ? <ValueBadges item={u} /> : null
  }
  const feat = featuresOf(s)
  const ns = nestSettingsOf(s)
  const locked = isLocked(s, adminUnlocked)

  const exportTools = async (kind: 'csv' | 'xlsx' = 'csv') => {
    // every field (M2.7) when the CAD and tool additions are on; the short Stage 1 table otherwise
    const csv = cadTools ? toolsCsv(m) : ['number,type,name,diameter,maxDepth', ...m.tools.map((t) => [t.number, t.type, `"${t.name.replace(/"/g, '""')}"`, t.diameter, t.maxDepth].join(','))].join('\r\n') + '\r\n'
    const where =
      kind === 'xlsx'
        ? await backend.saveFile({ name: 'n200-tools.xlsx', data: toolsXlsx(m) }, [{ name: 'Excel', extensions: ['xlsx'] }])
        : await backend.saveFile({ name: 'n200-tools.csv', data: csv }, [{ name: 'CSV', extensions: ['csv'] }])
    if (where) toast.success(`Tool table saved to ${where}`)
  }

  return (
    <div className="flex h-full flex-col">
      <AdminLocked what="The machine settings, tools and defaults">
      <PageHeader
        title="Machine & tools"
        subtitle={other ? `${m.name} (${other.kind === 'step' ? 'process step' : 'other machine'})` : m.name}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => setResetOpen(true)}>
              <RotateCcw /> Reset to placeholder
            </Button>
            {cadTools ? (
              <>
                {!other && (
                  <Button size="sm" variant="ghost" onClick={() => setCompareOpen(true)}>
                    <GitCompareArrows /> Tool data in operations
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="ghost">
                      <FileDown /> Export tools
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => void exportTools('xlsx')}>Spreadsheet (.xlsx)</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void exportTools('csv')}>CSV</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button size="sm" variant="outline" onClick={() => setSheetOpen(true)}>
                  <FileUp /> Import tools
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={() => void exportTools()}>
                  <FileDown /> Export tools CSV
                </Button>
                <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                  <FileUp /> Import tools
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {other && (
          <div className="flex flex-wrap items-center gap-3 border-b border-sky-300 bg-sky-50 px-5 py-2.5 text-sm text-sky-950" data-cfg="editing-machine">
            <span className="min-w-0 flex-1">
              Editing <b>{other.name}</b>, not the main machine. Its tool table, machine model and holders are its own; nesting, labels and the feature switches are shared and stay on the main machine&apos;s page. Its programs are written only by batch runs, with
              &quot;Write programs for other machines&quot; on.
            </span>
            <Button size="sm" variant="outline" onClick={() => editMachine(null)}>
              Back to the main machine
            </Button>
          </div>
        )}
        {(m.placeholder || unconfirmed.length > 0) && (
          <div className="flex items-start gap-3 border-b border-amber-300 bg-amber-50 px-5 py-3 text-sm text-amber-950" data-cfg="unconfirmed-list">
            <TriangleAlert className="mt-0.5 size-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{m.placeholder ? 'Placeholder tool table' : 'Placeholder values'}{unconfirmed.length ? ` · ${unconfirmed.length} value${unconfirmed.length === 1 ? '' : 's'} still to configure` : ''}</p>
              {m.placeholder && (
                <p className="text-xs leading-relaxed">
                  Every tool number, diameter and depth below is invented. Copy the real values from the N-200 tool database (woodWOP / Tool Manager), or import them as CSV, before exporting programs. Each MPR header carries a
                  PLACEHOLDER note while this is on.
                </p>
              )}
              {unconfirmed.length > 0 && (
                <div className="mt-2 max-w-3xl">
                  <p className="mb-1 text-xs">Not confirmed yet. Configure opens the field for the real value; Mark as confirmed keeps the value shown. Neither switches on any machine output.</p>
                  <UnconfirmedList items={unconfirmed} limit={10} />
                </div>
              )}
            </div>
          </div>
        )}
        <div className="grid gap-0 xl:grid-cols-[380px_1fr]">
          <div className="border-b bg-background xl:border-r xl:border-b-0">
            {feat.batchAdditions && <MachinesSection />}
            <Section title="Machine profile">
              <TextField
                label="Profile name"
                value={m.name}
                onChange={(v) =>
                  other
                    ? mutate((d) => {
                        const x = d.machines?.find((y) => y.id === other.id)
                        if (x) x.name = x.profile.name = v
                      })
                    : updateMachine((x) => (x.name = v))
                }
              />
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
                <NumField label="Collision margin" value={m.collisionMargin ?? 2} min={0} max={20} step={0.5} onChange={(v) => updateMachine((x) => (x.collisionMargin = v))} hint="Clearance kept round shank and holder" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <NumField label="Header OP" suffix="" value={m.header.OP} min={0} max={99} onChange={(v) => updateMachine((x) => (x.header.OP = v))} />
                <NumField label="Header FM" suffix="" value={m.header.FM} min={0} max={99} onChange={(v) => updateMachine((x) => (x.header.FM = v))} />
              </div>
            </Section>
            <MachineModelSection machine={m} updateMachine={updateMachine} rotaryAllowed={!!other && !isN200(other)} />
            {!other && <CutDefaultsSection machine={m} />}
            {cadTools && <HoldersSection machine={m} updateMachine={updateMachine} />}
            {cadTools && <AggregatesSection machine={m} updateMachine={updateMachine} />}
            {feat.camMachineSim && <MachineBodiesSection machine={m} updateMachine={updateMachine} />}
            {feat.camMachineSim && <FixtureLibrarySection machine={m} updateMachine={updateMachine} />}
            {feat.batchAdditions && <ToolOrderSection machine={m} updateMachine={updateMachine} />}
            {!other && (
            <>
            <Section title="Nesting" description={`Part spacing = cut-out tool Ø + extra = ${partSpacing(m, s)} mm`}>
              <div className="grid grid-cols-2 gap-2">
                <NumField label="Edge trim" value={s.nesting.edgeTrim} min={0} max={50} onChange={(v) => updateSettings((x) => (x.nesting.edgeTrim = v))} />
                <NumField label="Extra spacing" value={s.nesting.extraSpacing} min={0} max={20} step={0.5} onChange={(v) => updateSettings((x) => (x.nesting.extraSpacing = v))} />
                <NumField label="Pre-mill / edge" value={s.nesting.premill} min={0} max={3} step={0.5} onChange={(v) => updateSettings((x) => (x.nesting.premill = v))} hint="Edgebander pre-mill" />
              </div>
              <SwitchField label="Allow 90° rotation" checked={s.nesting.allowRotation} onChange={(v) => updateSettings((x) => (x.nesting.allowRotation = v))} hint="Grain-locked parts on grained sheets are never rotated." />
              <SelectField
                label="Nesting engine"
                value={ns.engine}
                options={[
                  { value: 'auto', label: 'Best of both' },
                  { value: 'shape', label: 'True shape' },
                  { value: 'rect', label: 'Rectangles' },
                ]}
                onChange={(v) => updateSettings((x) => (x.nesting.engine = v))}
                hint="True shape nests real outlines, turns shaped parts end for end, and fills cut-outs. Best of both runs each and keeps the nest with fewer sheets."
              />
              <SwitchField label="Nest parts in cut-outs" checked={ns.nestInApertures} onChange={(v) => updateSettings((x) => (x.nesting.nestInApertures = v))} hint="Small parts go in the openings of larger custom parts and are cut before the opening." />
              <SwitchField label="Keep kits on one sheet" checked={ns.keepKitsTogether} onChange={(v) => updateSettings((x) => (x.nesting.keepKitsTogether = v))} hint="A kit is the kit name on a custom part, or a whole cabinet when the next switch is on." />
              <SwitchField label="Each cabinet is a kit" checked={ns.kitByCabinet} onChange={(v) => updateSettings((x) => (x.nesting.kitByCabinet = v))} />
              <div className="grid grid-cols-2 gap-2">
                <NumField label="Onion skin" value={ns.onionSkin} min={0} max={2} step={0.1} onChange={(v) => updateSettings((x) => (x.nesting.onionSkin = v))} hint="0 = off. Left by the first cut-out pass, cut last." />
                <NumField label="On parts under" suffix="m²" value={Math.round(ns.onionSkinMaxArea / 1e4) / 100} min={0} max={3} step={0.01} onChange={(v) => updateSettings((x) => (x.nesting.onionSkinMaxArea = v * 1e6))} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <SelectField
                  label="Offcuts"
                  value={ns.offcutType}
                  options={[
                    { value: 'vertical', label: 'End strip' },
                    { value: 'horizontal', label: 'Side strip' },
                    { value: 'both', label: 'Both' },
                  ]}
                  onChange={(v) => updateSettings((x) => (x.nesting.offcutType = v))}
                />
                <NumField label="Min length" value={ns.offcutMinLength} min={0} max={3000} onChange={(v) => updateSettings((x) => (x.nesting.offcutMinLength = v))} />
                <NumField label="Min width" value={ns.offcutMinWidth} min={0} max={1500} onChange={(v) => updateSettings((x) => (x.nesting.offcutMinWidth = v))} />
              </div>
              {feat.nestAdditions && (
                <>
                  <SwitchField
                    label="Shared-line cutting"
                    checked={ns.sharedLines}
                    onChange={(v) => updateSettings((x) => (x.nesting.sharedLines = v))}
                    hint={`Rectangular parts nest exactly one cut-out tool diameter apart (extra spacing is not used) and the line between two neighbours is cut once. Program output has its own switch below (${feat.nestSharedOutput ? 'on' : 'off'}).`}
                  />
                  {ns.sharedLines && (
                    <div className="grid grid-cols-2 gap-2">
                      <NumField
                        label="Own cut-out under"
                        suffix="m²"
                        value={Math.round(ns.sharedMinArea / 1e4) / 100}
                        min={0}
                        max={3}
                        step={0.01}
                        cfg="nest:sharedSmall"
                        badge={nestBadge('sharedSmall')}
                        onChange={(v) => mutate((d) => ((d.settings.nesting.sharedMinArea = v * 1e6), confirmKey(d.machine, 'nest:sharedSmall')))}
                        hint="Hold-down: smaller parts keep their own cut-out."
                      />
                      <NumField
                        label="Or narrower than"
                        value={ns.sharedMinSide}
                        min={0}
                        max={1000}
                        onChange={(v) => mutate((d) => ((d.settings.nesting.sharedMinSide = v), confirmKey(d.machine, 'nest:sharedSmall')))}
                      />
                    </div>
                  )}
                </>
              )}
              {feat.nestAdditions && (
                <>
                  <SwitchField
                    label="Bridged nesting"
                    checked={ns.bridges}
                    onChange={(v) => updateSettings((x) => (x.nesting.bridges = v))}
                    hint={`Small rectangular parts are linked by short bridges and cut as one path round each group, so they stay one piece on the vacuum; break the bridges off afterwards. Uses the onion skin above when it is set. Program output has its own switch below (${feat.nestBridgeOutput ? 'on' : 'off'}).`}
                  />
                  {ns.bridges && (
                    <div className="grid grid-cols-3 gap-2">
                      <NumField label="Bridge width" value={ns.bridgeWidth} min={1} max={50} step={0.5} cfg="nest:bridgeWidth" badge={nestBadge('bridgeWidth')} onChange={(v) => mutate((d) => ((d.settings.nesting.bridgeWidth = v), confirmKey(d.machine, 'nest:bridgeWidth')))} />
                      <NumField label="Longest bridge" value={ns.bridgeMaxLength} min={1} max={200} cfg="nest:bridgeMaxLength" badge={nestBadge('bridgeMaxLength')} onChange={(v) => mutate((d) => ((d.settings.nesting.bridgeMaxLength = v), confirmKey(d.machine, 'nest:bridgeMaxLength')))} hint="Widest gap bridged" />
                      <NumField label="Parts under" suffix="m²" value={Math.round(ns.bridgeMaxArea / 1e4) / 100} min={0} max={3} step={0.01} cfg="nest:bridgeMaxArea" badge={nestBadge('bridgeMaxArea')} onChange={(v) => mutate((d) => ((d.settings.nesting.bridgeMaxArea = v * 1e6), confirmKey(d.machine, 'nest:bridgeMaxArea')))} />
                    </div>
                  )}
                </>
              )}
              {feat.nestAdditions && (
                <>
                  <SwitchField
                    label="Flip-side sheets"
                    checked={ns.flipSheets}
                    onChange={(v) => updateSettings((x) => (x.nesting.flipSheets = v))}
                    hint={`Parts with underside (face 6) work nest on their own sheets. Side 1 mills a reference edge and drills the underside; the sheet is turned over and side 2 is its normal program. Program output has its own switch below (${feat.nestFlipOutput ? 'on' : 'off'}).`}
                  />
                  {ns.flipSheets && (
                    <div className="grid grid-cols-2 gap-2">
                      <SelectField
                        label="Turned over"
                        value={ns.flipAxis}
                        cfg="nest:flipAxis"
                        badge={nestBadge('flipAxis')}
                        options={[
                          { value: 'end', label: 'End for end' },
                          { value: 'side', label: 'Over the long edge' },
                        ]}
                        onChange={(v) => mutate((d) => ((d.settings.nesting.flipAxis = v), confirmKey(d.machine, 'nest:flipAxis')))}
                      />
                      <NumField label="Reference strip" value={ns.flipReference} min={0.5} max={50} step={0.5} cfg="nest:flipReference" badge={nestBadge('flipReference')} onChange={(v) => mutate((d) => ((d.settings.nesting.flipReference = v), confirmKey(d.machine, 'nest:flipReference')))} hint="Milled off on side 1; that edge goes against the stop" />
                    </div>
                  )}
                </>
              )}
              {feat.nestAdditions && <TextField label="Currency symbol" value={s.currency ?? '$'} onChange={(v) => updateSettings((x) => (x.currency = v.slice(0, 4)))} hint="For material costs. Prices are entered per material (Library, Materials, Edit)." />}
              <SwitchField label="Use stock offcuts first" checked={ns.useOffcuts} onChange={(v) => updateSettings((x) => (x.nesting.useOffcuts = v))} hint="Saved offcuts of the job's materials are filled before full sheets. Manage them under Library, Offcuts." />
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
              <TextField
                label="Machine folder (program manager)"
                value={s.machineFolder ?? ''}
                placeholder="e.g. \\\\N200-PC\\programs  (empty = not set)"
                onChange={(v) => updateSettings((x) => (x.machineFolder = v))}
                hint="Where the machine reads its programs. The job's program manager copies checked programs straight into it (no subfolder), asking before it replaces a file."
              />
            </Section>
            <Section title="Custom-part features" description="Screens for drawn and imported parts. Writing their machining into N-200 programs stays off until the tool table is real.">
              {FEATURE_ROWS.map(([key, label, hint]) => (
                <Fragment key={key}>
                  <SwitchField label={label} hint={hint} checked={feat[key]} onChange={(v) => updateSettings((x) => void (x.features = { ...featuresOf(x), [key]: v }))} />
                  {key === 'camMultiAxis' && feat.camMultiAxis && <EngineStatus />}
                </Fragment>
              ))}
            </Section>
            </>
            )}
          </div>
          <div className="flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Tool table</h2>
              {!cadTools && (
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
              )}
            </div>
            {cadTools ? (
              <ToolGrid machine={m} units={s.units} onSave={(tools) => updateMachine((x) => void applyToolTable(x, tools))} onEdit={setEditTool} />
            ) : (
            <EditableTable
              rows={m.tools}
              columns={TOOL_COLS}
              onChange={(id, key, value) =>
                updateMachine((x) => {
                  const t = x.tools.find((tt) => tt.id === id) as Record<string, unknown> | undefined
                  if (t) t[key as string] = value
                  // a real number, diameter or depth typed in: the tool's data is confirmed
                  if (t && (key === 'number' || key === 'diameter' || key === 'maxDepth')) confirmKey(x, `tool:${id}:data`)
                })
              }
              rowExtra={(t) => {
                const u = toolUnconfirmed(m, t)
                return u.length ? <ConfigureBadge item={{ ...u[0], label: `${u.length} value(s) of T${t.number}: ${u.map((x) => x.label.replace(`T${t.number} `, '')).join(', ')}` }} /> : null
              }}
              onDelete={(t) => updateMachine((x) => void (x.tools = x.tools.filter((tt) => tt.id !== t.id)))}
              onEdit={(t) => setEditTool(t.id)}
              canDelete={(t) => (t.number === m.cutoutToolNumber ? 'This is the cut-out tool' : null)}
              empty="No tools. Import the machine's tool list as CSV."
            />
            )}
            <p className="text-[11px] text-muted-foreground">
              Drills are matched by exact diameter and depth ≤ max depth. Pockets use the largest router that fits the groove width. Missing tools are reported as errors before export.
            </p>
          </div>
        </div>
      </div>
      </AdminLocked>
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} kinds={['tools']} />
      {cadTools && <ToolSheetDialog open={sheetOpen} onOpenChange={setSheetOpen} machine={m} onApply={(tools) => updateMachine((x) => void applyToolTable(x, tools))} />}
      {cadTools && <ToolCompareDialog open={compareOpen} onOpenChange={setCompareOpen} />}
      {editTool && !locked && m.tools.some((t) => t.id === editTool) && (
        <ToolDialog
          tool={m.tools.find((t) => t.id === editTool)!}
          machine={m}
          onClose={() => setEditTool(null)}
          update={(fn, confirm) =>
            updateMachine((x) => {
              const t = x.tools.find((tt) => tt.id === editTool)
              if (t) fn(t)
              if (confirm) confirmKey(x, confirm)
            })
          }
        />
      )}
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

/**
 * The 5-axis engine (M3.5): none is licensed, so the shop's engine is the stub ("not licensed");
 * the built-in preview makes toolpaths for the simulator only. Buying a licensed engine is the
 * owner's decision (nothing is bought, downloaded or signed up for without a written OK).
 */
function EngineStatus() {
  return (
    <div className="ml-1 flex flex-col gap-1 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-[11px] text-amber-950" data-cfg="engine:5axis">
      <div className="font-medium">5-axis engine: {STUB_ENGINE.info.name}</div>
      <div>{NOT_LICENSED}</div>
      <div className="text-amber-900/80">
        {PREVIEW_NAME}: along curves, swarf and ball-nose surface finishing with simple methods of our own, so 5-axis set-ups can be simulated. Its toolpaths are never written to any machine.
      </div>
    </div>
  )
}
