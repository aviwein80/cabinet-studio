import { useState } from 'react'
import { Input } from '@/components/ui/input'
import type { UnitSystem } from '@/core/types'
import { fineLength, formatLength, parseLength } from '@/core/units'
import { cn } from '@/lib/utils'

/**
 * Length cell in the shop's units. Empty means “not given” (NaN) and is shown as required. `fine`
 * (Polish-2): a thin length shown without rounding to 1/16 in (0.236", see `fineLength`).
 */
export function LenInput({ value, units, onChange, label, plain, optional, className, placeholder, fine }: { value: number; units: UnitSystem; onChange: (v: number) => void; label: string; plain?: boolean; optional?: boolean; className?: string; placeholder?: string; fine?: boolean }) {
  const shown = Number.isFinite(value) ? (plain ? String(value) : fine ? fineLength(value, units) : formatLength(value, units)) : ''
  const [text, setText] = useState(shown)
  const [last, setLast] = useState(shown)
  if (shown !== last) {
    setLast(shown)
    setText(shown)
  }
  const parse = (t: string) => (plain ? (Number.isFinite(Number(t)) ? Number(t) : null) : parseLength(t, units))
  const parsed = text.trim() ? parse(text) : null
  return (
    <Input
      aria-label={label}
      inputMode="decimal"
      value={text}
      aria-invalid={(!optional && !Number.isFinite(value)) || (text.trim() !== '' && parsed === null)}
      placeholder={placeholder ?? (optional ? 'none' : 'needed')}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onChange(parsed ?? NaN)}
      // Polish-1: Enter applies the value too (not only Tab or leaving the field)
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onChange(parsed ?? NaN)
        }
      }}
      className={cn('h-7 w-[4.5rem] px-1.5 text-xs tabular-nums', className)}
    />
  )
}
