import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStore } from '@/app/store'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatLength, parseLength } from '@/core/units'
import { cn } from '@/lib/utils'

export type Column<T> = {
  key: keyof T & string
  label: string
  type: 'text' | 'num' | 'bool' | 'color' | 'select'
  options?: { value: string; label: string }[]
  width?: string
  mono?: boolean
  /** Numeric column stored in millimetres, shown in the shop unit. */
  length?: boolean
  /** Shown, but changed from the Edit form so a geometry change can ask about existing jobs. */
  readOnly?: boolean
}

function CellInput({ value, onCommit, numeric, mono }: { value: string; onCommit: (v: string) => void; numeric?: boolean; mono?: boolean }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const bad = numeric && (text.trim() === '' || !Number.isFinite(Number(text.replace(',', '.'))))
  return (
    <Input
      value={text}
      aria-invalid={bad}
      inputMode={numeric ? 'decimal' : undefined}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => (bad ? setText(value) : text !== value && onCommit(text))}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className={cn('h-7 border-transparent bg-transparent px-1.5 shadow-none hover:border-input focus-visible:bg-background', numeric && 'text-right tabular-nums', mono && 'font-mono text-xs')}
    />
  )
}

export function EditableTable<T extends { id: string }>({
  rows,
  columns,
  onChange,
  onDelete,
  onEdit,
  canDelete,
  empty,
}: {
  rows: T[]
  columns: Column<T>[]
  onChange: (id: string, key: keyof T, value: unknown) => void
  onDelete: (row: T) => void
  onEdit?: (row: T) => void
  canDelete?: (row: T) => string | null
  empty: string
}) {
  const units = useStore((s) => s.data?.settings.units ?? 'mm')
  return (
    <div className="overflow-x-auto rounded-xl border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c.key} className={cn('text-xs', c.type === 'num' && 'text-right')} style={{ width: c.width }}>
                {c.label}
              </TableHead>
            ))}
            <TableHead className="w-28" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const blocked = canDelete?.(r) ?? null
            return (
              <TableRow key={r.id}>
                {columns.map((c) => {
                  const v = r[c.key] as unknown
                  return (
                    <TableCell key={c.key} className="py-1">
                      {c.readOnly ? (
                        <span className="block px-1.5 text-xs text-muted-foreground tabular-nums">{c.type === 'bool' ? (v ? 'Yes' : 'No') : c.length && typeof v === 'number' ? formatLength(v, units) : v == null || v === '' ? '—' : String(v)}</span>
                      ) : c.type === 'bool' ? (
                        <Checkbox checked={!!v} onCheckedChange={(x) => onChange(r.id, c.key, x === true)} />
                      ) : c.type === 'color' ? (
                        <input type="color" value={String(v ?? '#cccccc')} onChange={(e) => onChange(r.id, c.key, e.target.value)} className="h-7 w-10 cursor-pointer rounded border bg-transparent" aria-label={c.label} />
                      ) : c.type === 'select' ? (
                        <Select value={String(v)} onValueChange={(x) => onChange(r.id, c.key, x)}>
                          <SelectTrigger size="sm" className="h-7 w-full border-transparent shadow-none hover:border-input">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {c.options?.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <CellInput
                          value={c.length && typeof v === 'number' ? formatLength(v, units) : String(v ?? '')}
                          numeric={c.type === 'num' && !c.length}
                          mono={c.mono || c.length}
                          onCommit={(x) => {
                            if (c.length) {
                              const mm = parseLength(x, units)
                              if (mm !== null) onChange(r.id, c.key, mm)
                            } else onChange(r.id, c.key, c.type === 'num' ? Number(x.replace(',', '.')) : x)
                          }}
                        />
                      )}
                    </TableCell>
                  )
                })}
                <TableCell className="py-1">
                  <div className="flex justify-end gap-1">
                    {onEdit && (
                      <Button size="xs" variant="outline" onClick={() => onEdit(r)}>
                        Edit
                      </Button>
                    )}
                    <Button size="icon-xs" variant="ghost" aria-label="Delete" title={blocked ?? 'Delete'} disabled={!!blocked} onClick={() => onDelete(r)}>
                      <Trash2 />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={columns.length + 1} className="py-8 text-center text-xs text-muted-foreground">
                {empty}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
