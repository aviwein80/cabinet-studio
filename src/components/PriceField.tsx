/** Job-1: a price that may be not set (empty). Typed and shown in the shop currency; never taken as 0 when empty. */
import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { enterApplies } from '@/components/enterApplies'
import { cn } from '@/lib/utils'

const shownOf = (v: number | undefined) => (v === undefined ? '' : String(Math.round(v * 1e6) / 1e6))

function PriceInputInner({ value, onChange, placeholder = 'not set', className, label }: { value: number | undefined; onChange: (v: number | undefined) => void; placeholder?: string; className?: string; label?: string }) {
  const shown = shownOf(value)
  const [text, setText] = useState(shown)
  return (
    <Input
      className={cn('h-8 tabular-nums', className)}
      inputMode="decimal"
      aria-label={label}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={enterApplies}
      onBlur={() => {
        const t = text.trim().replace(',', '.').replace(/^\$/, '')
        if (!t) return value !== undefined && onChange(undefined)
        const n = Number(t)
        if (Number.isFinite(n) && n >= 0) {
          if (n !== value) onChange(n)
        } else setText(shown)
      }}
    />
  )
}

/** Rendered with `key` = the value shown, so a new value from outside starts it afresh. */
export function PriceInput(p: { value: number | undefined; onChange: (v: number | undefined) => void; placeholder?: string; className?: string; label?: string }) {
  return <PriceInputInner key={shownOf(p.value)} {...p} />
}
