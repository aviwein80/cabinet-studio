import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react'
import { Section } from '@/components/fields'
import { Button } from '@/components/ui/button'
import { moveTool, toolOrderOf } from '@/core/admin'
import type { MachineProfile } from '@/core/types'

/**
 * Tool-change order (M2.9 admin, AM-13): the order "Order by tool" puts a part's operations in.
 * It only applies when someone presses that button in the Parts designer; nothing is reordered on
 * its own.
 */
export function ToolOrderSection({ machine, updateMachine }: { machine: MachineProfile; updateMachine: (fn: (m: MachineProfile) => void) => void }) {
  const order = toolOrderOf(machine)
  const byNo = new Map(machine.tools.map((t) => [t.number, t]))
  const set = (next: number[]) => updateMachine((m) => void (m.toolOrder = next))
  return (
    <Section title="Tool-change order" description={'The order "Order by tool" in the Parts designer puts operations in. Nothing is reordered unless that button is pressed.'}>
      <ol className="flex max-h-56 flex-col gap-0.5 overflow-auto text-xs" data-cfg="tool-order">
        {order.map((n, i) => (
          <li key={n} className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-muted/40">
            <span className="w-5 text-right tabular-nums text-muted-foreground">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">
              T{n} · {byNo.get(n)?.name}
            </span>
            <Button size="icon-xs" variant="ghost" aria-label={`Move T${n} earlier`} disabled={i === 0} onClick={() => set(moveTool(order, n, -1))}>
              <ArrowUp />
            </Button>
            <Button size="icon-xs" variant="ghost" aria-label={`Move T${n} later`} disabled={i === order.length - 1} onClick={() => set(moveTool(order, n, 1))}>
              <ArrowDown />
            </Button>
          </li>
        ))}
      </ol>
      {machine.toolOrder?.length ? (
        <Button size="sm" variant="ghost" className="w-fit" onClick={() => updateMachine((m) => void delete m.toolOrder)}>
          <RotateCcw /> Tool table order
        </Button>
      ) : null}
    </Section>
  )
}
