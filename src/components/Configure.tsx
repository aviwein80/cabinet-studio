/**
 * "Configure" badges (M2.6e): shown wherever a placeholder or unconfirmed value is in use. Clicking
 * one opens the exact field where the real value goes; "Mark as confirmed" says the shown value is
 * already right. Both only record the value; they never switch on any output.
 */
import { CircleCheck, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '@/app/store'
import type { Unconfirmed } from '@/core/confirm'
import { cn } from '@/lib/utils'

export function ConfigureBadge({ item, onOpen, className }: { item: Unconfirmed; onOpen?: () => void; className?: string }) {
  const open = useStore((s) => s.openConfigure)
  return (
    <button
      type="button"
      data-configure={item.key}
      title={`${item.label}: ${item.value} is a placeholder. Click to set the real value.`}
      onClick={(e) => {
        e.stopPropagation()
        if (onOpen) onOpen()
        else open(item.target)
      }}
      className={cn('inline-flex shrink-0 items-center gap-1 rounded border border-amber-400/50 bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 hover:bg-amber-400/25 dark:text-amber-300', className)}
    >
      <TriangleAlert className="size-3" /> Configure
    </button>
  )
}

/** "Mark as confirmed": the value shown is right. Shop values by default; pass `onConfirm` for an operation's own. */
export function ConfirmButton({ item, onConfirm, className }: { item: Unconfirmed; onConfirm?: () => void; className?: string }) {
  const confirm = useStore((s) => s.confirmValue)
  return (
    <button
      type="button"
      title={`${item.label}: keep ${item.value} and mark it confirmed`}
      onClick={(e) => {
        e.stopPropagation()
        if (onConfirm) onConfirm()
        else confirm(item.key)
      }}
      className={cn('inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[10px] text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300', className)}
    >
      <CircleCheck className="size-3" /> Mark as confirmed
    </button>
  )
}

/** Badge + confirm for one value, or nothing when it is confirmed. */
export function ValueBadges({ item, onOpen, onConfirm }: { item?: Unconfirmed; onOpen?: () => void; onConfirm?: () => void }) {
  if (!item) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-0.5">
      <ConfigureBadge item={item} onOpen={onOpen} />
      <ConfirmButton item={item} onConfirm={onConfirm} />
    </span>
  )
}

/** A list of unconfirmed values, grouped, each with Configure and Mark as confirmed. */
export function UnconfirmedList({ items, limit = 8, onConfirm, tone = 'light' }: { items: Unconfirmed[]; limit?: number; onConfirm?: (u: Unconfirmed) => (() => void) | undefined; tone?: 'light' | 'dark' }) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, limit)
  const groups = [...new Set(shown.map((u) => u.group))]
  return (
    <div className="flex flex-col gap-1.5">
      {groups.map((g) => (
        <div key={g}>
          <div className={cn('mb-0.5 text-[10px] font-semibold tracking-wider uppercase', tone === 'dark' ? 'text-stone-400' : 'text-amber-900/70')}>{g}</div>
          {shown
            .filter((u) => u.group === g)
            .map((u) => (
              <div key={u.key} className="flex flex-wrap items-center gap-1.5 py-0.5 text-[11px]">
                <span className="min-w-[12rem] flex-1">
                  {u.label} <span className="opacity-70">({u.value})</span>
                </span>
                <ConfigureBadge item={u} />
                <ConfirmButton item={u} onConfirm={onConfirm?.(u)} />
              </div>
            ))}
        </div>
      ))}
      {items.length > limit && (
        <button type="button" className="self-start text-[11px] underline opacity-80" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </div>
  )
}
