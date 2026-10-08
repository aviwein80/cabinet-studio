import { useEffect, useId, useState, type ReactNode } from 'react'
import { useStore } from '@/app/store'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { fineLength, formatLength, parseLength, toolSize } from '@/core/units'
import type { UnitSystem } from '@/core/types'
import { cn } from '@/lib/utils'

/** `cfg`: the key a "Configure" badge opens (the field is found by it); `badge`: shown beside the label. */
export function Field({ label, hint, children, className, cfg, badge }: { label: string; hint?: string; children: ReactNode; className?: string; cfg?: string; badge?: ReactNode }) {
  return (
    <div className={cn('flex flex-col gap-1.5 rounded-md', className)} data-cfg={cfg}>
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {badge && <div className="-mt-0.5 flex min-w-0 flex-wrap items-center gap-1 empty:hidden">{badge}</div>}
      {children}
      {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix = 'mm',
  hint,
  className,
  cfg,
  badge,
  metric,
  tool,
  fine,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  hint?: string
  className?: string
  cfg?: string
  badge?: ReactNode
  /** Polish-1: a small length always shown in millimetres (a tolerance), even in an inch shop; "in" still typed in works. */
  metric?: boolean
  /** Kitchen-2: a tool size: in an inch shop an exact inch fraction, else exact millimetres ("6 mm", not 1/4"); steps in mm. */
  tool?: boolean
  /** Polish-2: a thin length (edgeband thickness, corner radius): in an inch shop an exact fraction or decimal inches (0.039"), never rounded to 1/16; steps in mm. */
  fine?: boolean
}) {
  const units: UnitSystem = useStore((s) => (suffix === 'mm' && !metric ? (s.data?.settings.units ?? 'mm') : 'mm'))
  const length = suffix === 'mm'
  const show = (v: number) => (tool ? toolSize(v, units) : fine ? fineLength(v, units) : formatLength(v, units))
  const shown = length ? show(value) : String(value)
  const inchSteps = units === 'in' && !tool && !fine
  const [text, setText] = useState(shown)
  const id = useId()
  useEffect(() => setText(shown), [shown])
  const parsed = length ? parseLength(text, units) : Number(text.replace(',', '.'))
  const inUnit = parsed !== null && Number.isFinite(parsed) ? parsed : NaN
  const invalid = text.trim() === '' || !Number.isFinite(inUnit) || (min !== undefined && inUnit < min) || (max !== undefined && inUnit > max)
  const commit = () => {
    if (text.trim() === shown) return
    if (!invalid && inUnit !== value) onChange(inUnit)
    else if (invalid) setText(shown)
  }
  const unitLabel = length && units === 'in' ? 'in' : suffix
  return (
    <Field label={label} hint={hint} className={className} cfg={cfg} badge={badge}>
      <div className="flex items-center gap-1.5">
        <Input
          id={id}
          inputMode="decimal"
          value={text}
          aria-invalid={invalid}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              const n = (Number.isFinite(inUnit) ? inUnit : value) + (e.key === 'ArrowUp' ? (inchSteps ? 25.4 / 16 : step) : inchSteps ? -25.4 / 16 : -step)
              const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))
              setText(length ? show(c) : String(c))
              onChange(c)
            }
          }}
          className="h-8 min-w-0 tabular-nums"
        />
        {unitLabel && <span className="w-6 shrink-0 text-xs text-muted-foreground">{unitLabel}</span>}
      </div>
    </Field>
  )
}

export function TextField({ label, value, onChange, placeholder, hint, className }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string; className?: string }) {
  return (
    <Field label={label} hint={hint} className={className}>
      <Input className="h-8" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Field>
  )
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
  className,
  cfg,
  badge,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  hint?: string
  className?: string
  cfg?: string
  badge?: ReactNode
}) {
  return (
    <Field label={label} hint={hint} className={className} cfg={cfg} badge={badge}>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger className="h-8 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

export function SwitchField({ label, checked, onChange, hint, cfg, badge }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; cfg?: string; badge?: ReactNode }) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-3 rounded-md py-1" data-cfg={cfg}>
      <div className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Label htmlFor={id} className="text-sm">
            {label}
          </Label>
          {badge}
        </div>
        {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

export function Section({ title, children, description }: { title: string; children: ReactNode; description?: string }) {
  return (
    <section className="flex flex-col gap-3 border-b px-4 py-4 last:border-b-0">
      <div>
        <h3 className="text-[13px] font-semibold tracking-tight">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}

export const NONE = '__none__'
