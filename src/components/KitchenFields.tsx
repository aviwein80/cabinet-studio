/**
 * Kitchen-2: the settings of a blind corner, a filler or an end panel, shared by the cabinet editor
 * and the room's side panel. Values still at a built-in placeholder carry a Configure badge.
 * Kitchen-3: and of a pie-cut corner.
 */
import { useStore } from '@/app/store'
import { ValueBadges } from '@/components/Configure'
import { NumField, SelectField, SwitchField } from '@/components/fields'
import { kitchenUnconfirmed, type KitchenValueKey } from '@/core/confirm'
import { blindSpans } from '@/core/construction/carcass'
import { pieLegForDoor, pieSpans } from '@/core/construction/pieCut'
import { KITCHEN_DEFAULTS } from '@/core/defaults'
import { formatLength } from '@/core/units'
import type { CarcassParams, Library } from '@/core/types'

/** Board choices for a panel: the sheet materials thicker than 10 mm. */
const boards = (lib: Library) => lib.materials.filter((m) => m.thickness > 10).map((m) => ({ value: m.id, label: `${m.code} · ${m.name}` }))

export function KitchenFields({ p, set, lib }: { p: CarcassParams; set: (fn: (p: CarcassParams) => void) => void; lib: Library }) {
  const data = useStore((s) => s.data)
  const units = data?.settings.units ?? 'mm'
  const items = data ? kitchenUnconfirmed(p, data.machine, (mm) => formatLength(mm, units)) : []
  const badge = (key: KitchenValueKey) => <ValueBadges item={items.find((u) => u.key === `kitchen:${key}`)} />
  const cfg = (key: KitchenValueKey) => `kitchen:${key}`

  if (p.corner?.type === 'blind' && !p.panel) {
    const c = p.corner
    const spans = blindSpans(p, c)
    const blind = (fn: (b: typeof c) => void) => set((x) => x.corner?.type === 'blind' && fn(x.corner))
    const onSide = c.wall === 'side'
    // which corner it fills: on the back wall, its blind side; on a side wall, the blind side is in the back corner
    const corner = onSide ? (c.blindSide === 'right' ? 'left' : 'right') : c.blindSide
    return (
      <>
        <div className="grid grid-cols-2 gap-2">
          <SelectField
            label="Blind side"
            value={c.blindSide}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'right', label: 'Right' },
            ]}
            onChange={(v) =>
              set((x) => {
                if (x.corner?.type !== 'blind') return
                x.corner.blindSide = v
                // the door hangs on the open side
                x.doors.hingeSide = v === 'left' ? 'right' : 'left'
              })
            }
          />
          <SelectField
            label="Stands on"
            value={onSide ? 'side' : 'back'}
            options={[
              { value: 'back', label: 'The back wall' },
              { value: 'side', label: 'The side wall' },
            ]}
            onChange={(v) => blind((b) => (v === 'side' ? (b.wall = 'side') : delete b.wall))}
          />
          <NumField label="Blind width" value={c.blindWidth} min={50} max={Math.max(60, p.width - 60)} onChange={(v) => blind((b) => (b.blindWidth = v))} />
          <NumField
            label="Door width"
            value={spans.doorWidth}
            min={100}
            max={1200}
            onChange={(v) => set((x) => x.corner?.type === 'blind' && (x.width = Math.round((x.corner.blindWidth + v + x.doors.gap) * 1000) / 1000))}
            hint="Changes the cabinet width; the blind part stays."
          />
          <NumField label="Pull-out clearance" value={c.pullOut} min={0} max={300} onChange={(v) => blind((b) => (b.pullOut = v))} cfg={cfg('pullOut')} badge={badge('pullOut')} hint={onSide ? 'Off the back wall, when the room is arranged.' : 'Off the side wall, when the room is arranged.'} />
        </div>
        <SwitchField label="Blind panel" checked={c.blindPanel} onChange={(v) => blind((b) => (b.blindPanel = v))} hint={`A finished panel in the door board over the blind part. The run on the ${onSide ? 'back' : 'side'} wall butts against it.`} />
        <p className="text-[11px] text-muted-foreground">
          One door, hinged on the open side (Salice cups and 3 mm plates). {onSide ? `On the ${corner} wall, its blind end in the back-${corner} corner; the back-wall run butts against its face.` : `On the back wall, in the back-${corner} corner; the ${corner}-wall run butts against its face.`} In the job, list the left wall's cabinets, then the corner cabinets, then the back wall's (a right corner after them): Arrange turns the corner there.
        </p>
      </>
    )
  }

  if (p.corner?.type === 'pie-cut' && !p.panel) {
    const c = p.corner
    const Td = lib.materials.find((m) => m.id === p.doorMaterialId)?.thickness ?? 18
    const spans = pieSpans(p, c, Td)
    const pie = (fn: (q: typeof c) => void) => set((x) => x.corner?.type === 'pie-cut' && fn(x.corner))
    return (
      <>
        <div className="grid grid-cols-2 gap-2">
          <SelectField
            label="Which corner"
            value={c.side}
            options={[
              { value: 'left', label: 'Back-left' },
              { value: 'right', label: 'Back-right' },
            ]}
            onChange={(v) => pie((q) => (q.side = v))}
          />
          <NumField label="Leg depth" value={c.legDepth} min={150} max={900} onChange={(v) => pie((q) => (q.legDepth = v))} hint="Both legs, front to wall." />
          <NumField label="Back-wall leg" value={p.width} min={300} max={2400} onChange={(v) => set((x) => (x.width = v))} />
          <NumField label="Side-wall leg" value={p.depth} min={300} max={2400} onChange={(v) => set((x) => (x.depth = v))} />
          <NumField
            label="Back-wall door"
            value={spans.backWidth}
            min={100}
            max={1200}
            onChange={(v) => set((x) => x.corner?.type === 'pie-cut' && (x.width = pieLegForDoor(x, x.corner, Td, 'back', v)))}
            hint="Changes the back-wall leg."
          />
          <NumField
            label="Side-wall door"
            value={spans.sideWidth}
            min={100}
            max={1200}
            onChange={(v) => set((x) => x.corner?.type === 'pie-cut' && (x.depth = pieLegForDoor(x, x.corner, Td, 'side', v)))}
            hint="Changes the side-wall leg."
          />
        </div>
        <SwitchField
          label="Corner cleats under the shelves"
          checked={c.cleats !== false}
          onChange={(v) => pie((q) => (q.cleats = v))}
          hint="A block in the carcass board under each L shelf's back corner, cut with the job and fixed on site."
        />
        {c.cleats !== false && p.shelves.count > 0 && (
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Cleat length" value={c.cleatLength ?? KITCHEN_DEFAULTS.cleatLength} min={20} max={600} onChange={(v) => pie((q) => (q.cleatLength = v))} cfg={cfg('cleatLength')} badge={badge('cleatLength')} hint="Along the back wall, from the corner." />
            <NumField label="Cleat height" value={c.cleatHeight ?? KITCHEN_DEFAULTS.cleatHeight} min={10} max={200} onChange={(v) => pie((q) => (q.cleatHeight = v))} cfg={cfg('cleatHeight')} badge={badge('cleatHeight')} hint="Under the shelf." />
          </div>
        )}
        <SelectField
          label="At the inside corner"
          value={c.cornerDoor}
          options={[
            { value: 'back', label: 'The back-wall door runs through' },
            { value: 'side', label: 'The side-wall door runs through' },
          ]}
          onChange={(v) => pie((q) => (q.cornerDoor = v))}
          hint={`It covers the other door's end and opens first; the other stops ${formatLength(p.doors.gap, units)} short of it.`}
        />
        <p className="text-[11px] text-muted-foreground">
          Two doors, each hinged at the end of its leg (Salice cups and 3 mm plates in that end side). The bottom, top and shelves are L-shaped, banded on their two inside edges. In the job, list the left wall&apos;s cabinets, then the corner, then the back wall&apos;s (a back-right corner after them): Arrange fills the corner and turns there.
        </p>
      </>
    )
  }

  if (p.panel?.type === 'filler') {
    const f = p.panel
    return (
      <>
        <SelectField label="Board (face)" value={p.doorMaterialId} options={boards(lib)} onChange={(v) => set((x) => (x.doorMaterialId = v))} />
        <div className="grid grid-cols-2 gap-2">
          <NumField label="Return depth" value={f.returnDepth} min={0} max={300} onChange={(v) => set((x) => x.panel?.type === 'filler' && (x.panel.returnDepth = v))} cfg={cfg('fillerReturn')} badge={f.returnDepth > 0 ? badge('fillerReturn') : undefined} hint="0 = a flat strip." />
          <SelectField
            label="Return on"
            value={f.returnSide}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'right', label: 'Right' },
              { value: 'both', label: 'Both sides' },
            ]}
            onChange={(v) => set((x) => x.panel?.type === 'filler' && (x.panel.returnSide = v))}
          />
          <SelectField
            label="Scribe to a wall"
            value={f.scribeSide}
            options={[
              { value: 'none', label: 'No' },
              { value: 'left', label: 'Left edge' },
              { value: 'right', label: 'Right edge' },
            ]}
            onChange={(v) => set((x) => x.panel?.type === 'filler' && (x.panel.scribeSide = v))}
          />
          {f.scribeSide !== 'none' && <NumField label="Scribe allowance" value={f.scribe} min={0} max={100} onChange={(v) => set((x) => x.panel?.type === 'filler' && (x.panel.scribe = v))} cfg={cfg('scribe')} badge={badge('scribe')} />}
        </div>
        {f.returnDepth > 0 && <SelectField label="Return board" value={p.carcassMaterialId} options={boards(lib)} onChange={(v) => set((x) => (x.carcassMaterialId = v))} />}
        <p className="text-[11px] text-muted-foreground">The strip stands in the door plane, flush with the doors beside it{p.kind === 'base' && p.toeKick.enabled ? ', from the toe kick up' : ''}. The scribe allowance is cut on and trimmed to the wall on site.</p>
      </>
    )
  }

  if (p.panel?.type === 'end-panel') {
    const e = p.panel
    const thick = (id: string) => lib.materials.find((m) => m.id === id)?.thickness ?? p.width
    return (
      <>
        <SelectField
          label="Board"
          value={p.doorMaterialId}
          options={boards(lib)}
          onChange={(v) =>
            set((x) => {
              x.doorMaterialId = v
              // the room places the panel as wide as its board is thick
              x.width = thick(v)
            })
          }
          hint={`${formatLength(p.width, units)} thick: its width in the room.`}
        />
        <div className="grid grid-cols-2 gap-2">
          <SelectField
            label="Finishes the run's"
            value={e.side}
            options={[
              { value: 'left', label: 'Left end' },
              { value: 'right', label: 'Right end' },
            ]}
            onChange={(v) => set((x) => x.panel?.type === 'end-panel' && (x.panel.side = v))}
          />
          <SelectField
            label="Front"
            value={e.front}
            options={[
              { value: 'flush', label: 'Flush with the doors' },
              { value: 'proud', label: 'Proud of the doors' },
            ]}
            onChange={(v) => set((x) => x.panel?.type === 'end-panel' && (x.panel.front = v))}
          />
          {e.front === 'proud' && <NumField label="Proud by" value={e.proud} min={0} max={50} onChange={(v) => set((x) => x.panel?.type === 'end-panel' && (x.panel.proud = v))} cfg={cfg('proud')} badge={badge('proud')} />}
          <NumField label="Scribe allowance" value={e.scribe} min={0} max={100} onChange={(v) => set((x) => x.panel?.type === 'end-panel' && (x.panel.scribe = v))} cfg={cfg('scribe')} badge={e.scribe > 0 ? badge('scribe') : undefined} hint="At the back edge, against the wall." />
        </div>
        {p.kind !== 'wall' && <SwitchField label="Toe-kick notch" checked={e.toeKickNotch} onChange={(v) => set((x) => x.panel?.type === 'end-panel' && (x.panel.toeKickNotch = v))} hint={p.toeKick.enabled ? `${formatLength(p.toeKick.height, units)} high, back ${formatLength(p.toeKick.setback, units)} from the cabinet front.` : 'Turn the toe kick on below to set its size.'} />}
      </>
    )
  }
  return null
}
