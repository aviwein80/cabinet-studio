import { useEffect, useId, useState, type ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
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
}) {
  const [text, setText] = useState(String(value))
  const id = useId()
  useEffect(() => setText(String(value)), [value])
  const parsed = Number(text.replace(',', '.'))
  const invalid = text.trim() === '' || !Number.isFinite(parsed) || (min !== undefined && parsed < min) || (max !== undefined && parsed > max)
  const commit = () => {
    if (!invalid && parsed !== value) onChange(parsed)
    else if (invalid) setText(String(value))
  }
  return (
    <Field label={label} hint={hint} className={className}>
      <div className="relative">
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
              const n = (Number.isFinite(parsed) ? parsed : value) + (e.key === 'ArrowUp' ? step : -step)
              const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))
              setText(String(c))
              onChange(c)
            }
          }}
          className={cn('h-8 pr-9 tabular-nums', suffix ? 'pr-9' : 'pr-2')}
        />
        {suffix && <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
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
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  hint?: string
  className?: string
}) {
  return (
    <Field label={label} hint={hint} className={className}>
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

export function SwitchField({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id} className="text-sm">
          {label}
        </Label>
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
