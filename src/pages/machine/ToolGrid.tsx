/**
 * Tool table as a grid (NEW-15): every cell editable in place, arrow keys / Tab / Enter move
 * between cells, typing starts an edit, Escape cancels it. Changes are kept as a draft with undo
 * and redo (Ctrl+Z / Ctrl+Y) until Save writes them to the tool table (typed values are confirmed,
 * M2.6e) or Discard drops them.
 */
import { Plus, Redo2, Save, Undo2, X } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ConfigureBadge } from '@/components/Configure'
import { Button } from '@/components/ui/button'
import { commit, historyOf, redo, undo, type History } from '@/cam/doc'
import { toolUnconfirmed } from '@/core/confirm'
import { cellText, diffTools, GRID_FIELDS, moveCell, parseCell, withField, type Cell } from '@/core/toolData'
import type { MachineProfile, Tool, UnitSystem } from '@/core/types'
import { cn } from '@/lib/utils'

export function ToolGrid({ machine, units, onSave, onEdit }: { machine: MachineProfile; units: UnitSystem; onSave: (tools: Tool[]) => void; onEdit: (id: string) => void }) {
  const [hist, setHist] = useState<History<Tool[]>>(() => historyOf(machine.tools))
  // the table changed outside the grid (dialog, import, reset) while nothing is pending: follow it
  const [base, setBase] = useState(machine.tools)
  const dirty = hist.present !== base
  if (machine.tools !== base && !dirty) {
    setBase(machine.tools)
    setHist(historyOf(machine.tools))
  }
  const tools = hist.present
  // changed elsewhere (dialog, import) while the grid holds unsaved changes: saving would undo that
  const clash = dirty && machine.tools !== base
  const [at, setAt] = useState<Cell>({ row: 0, col: 0 })
  const [edit, setEdit] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  const changes = useMemo(() => diffTools(machine.tools, tools), [machine.tools, tools])
  const changed = (id: string, key: string) => changes.changes.some((c) => c.toolId === id && c.field === key) || changes.added.some((t) => t.id === id)

  useEffect(() => {
    if (edit === null) grid.current?.querySelector<HTMLElement>(`[data-cell="${at.row}:${at.col}"]`)?.focus()
  }, [at, edit])

  const put = (row: number, col: number, text: string) => {
    const f = GRID_FIELDS[col]
    const t = tools[row]
    if (!t) return true
    const r = parseCell(text, f, units, machine)
    if ('error' in r) {
      setErr(`T${t.number}: ${r.error}`)
      return false
    }
    setErr(null)
    if (JSON.stringify(t[f.key]) === JSON.stringify(r.value)) return true
    if (f.key === 'number' && tools.some((x, i) => i !== row && x.number === r.value)) {
      setErr(`Tool number ${String(r.value)} is already used.`)
      return false
    }
    setHist((h) => commit(h, h.present.map((x, i) => (i === row ? withField(x, f.key, r.value) : x))))
    return true
  }

  const save = () => {
    onSave(tools)
    setBase(tools)
    toast.success(`Tool table saved: ${changes.changes.length} change(s)${changes.added.length ? `, ${changes.added.length} new` : ''}`)
  }
  const discard = () => {
    setBase(machine.tools)
    setHist(historyOf(machine.tools))
    setErr(null)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (edit !== null) return
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      setHist((h) => (e.shiftKey ? redo(h) : undo(h)))
      return
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      setHist(redo)
      return
    }
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault()
      if (dirty && !clash) save()
      return
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End'].includes(e.key) || (e.key === 'Enter' && e.shiftKey)) {
      e.preventDefault()
      setAt(moveCell(at, e.key, e.shiftKey, tools.length, GRID_FIELDS.length))
      return
    }
    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault()
      setEdit(cellText(tools[at.row], GRID_FIELDS[at.col], units, machine))
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      put(at.row, at.col, '')
      return
    }
    if (e.key.length === 1 && !mod) {
      e.preventDefault()
      setEdit(e.key)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Button size="xs" variant="outline" disabled={!hist.past.length} onClick={() => setHist(undo)} title="Undo (Ctrl+Z)">
          <Undo2 /> Undo
        </Button>
        <Button size="xs" variant="outline" disabled={!hist.future.length} onClick={() => setHist(redo)} title="Redo (Ctrl+Y)">
          <Redo2 /> Redo
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={() =>
            setHist((h) => {
              const next = Math.max(100, ...h.present.map((t) => t.number)) + 1
              return commit(h, [...h.present, { id: `t-${nanoid(6)}`, number: next, type: 'router', name: 'New tool', diameter: 10, maxDepth: 30 }])
            })
          }
        >
          <Plus /> Add tool
        </Button>
        <Button size="xs" disabled={!dirty || clash} onClick={save} title="Save (Ctrl+S)">
          <Save /> Save
        </Button>
        <Button size="xs" variant="ghost" disabled={!dirty} onClick={discard}>
          <X /> Discard
        </Button>
        <span className="text-muted-foreground">{dirty ? `${changes.changes.length} change(s) not saved yet` : 'Arrows, Tab and Enter move; type to edit; Ctrl+Z undoes.'}</span>
        {clash && <span className="text-red-700">The tool table was changed elsewhere: discard these changes to see it.</span>}
        {err && <span className="text-red-700">{err}</span>}
      </div>
      <div ref={grid} className="overflow-x-auto rounded-xl border bg-background" onKeyDown={onKey} role="grid" aria-label="Tool table">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b bg-muted/40">
              {GRID_FIELDS.map((f) => (
                <th key={f.key} className={cn('px-1.5 py-1.5 text-left font-medium whitespace-nowrap text-muted-foreground', (f.kind === 'num' || f.kind === 'len') && 'text-right')} style={{ minWidth: f.width }}>
                  {f.label}
                </th>
              ))}
              <th className="w-40" />
            </tr>
          </thead>
          <tbody>
            {tools.map((t, row) => {
              const u = toolUnconfirmed(machine, t)
              return (
                <tr key={t.id} className="border-b last:border-b-0">
                  {GRID_FIELDS.map((f, col) => {
                    const here = at.row === row && at.col === col
                    const text = cellText(t, f, units, machine)
                    return (
                      <td
                        key={f.key}
                        role="gridcell"
                        tabIndex={here ? 0 : -1}
                        data-cell={`${row}:${col}`}
                        onClick={() => setAt({ row, col })}
                        onDoubleClick={() => {
                          setAt({ row, col })
                          setEdit(text)
                        }}
                        className={cn('h-7 px-1.5 whitespace-nowrap outline-none', (f.kind === 'num' || f.kind === 'len') && 'text-right tabular-nums', here && 'ring-2 ring-amber-400 ring-inset', changed(t.id, f.key) && 'bg-sky-50 dark:bg-sky-950/40')}
                      >
                        {here && edit !== null ? (
                          <input
                            autoFocus
                            aria-label={`${f.label} of T${t.number}`}
                            value={edit}
                            onChange={(e) => setEdit(e.target.value)}
                            onKeyDown={(e) => {
                              e.stopPropagation()
                              if (e.key === 'Escape') setEdit(null)
                              if (e.key === 'Enter' || e.key === 'Tab') {
                                e.preventDefault()
                                if (put(row, col, edit)) {
                                  setEdit(null)
                                  setAt(moveCell(at, e.key, e.shiftKey, tools.length, GRID_FIELDS.length))
                                }
                              }
                            }}
                            onBlur={() => {
                              if (edit !== null && put(row, col, edit)) setEdit(null)
                            }}
                            className="h-6 w-full rounded border bg-background px-1 text-xs"
                          />
                        ) : (
                          text || <span className="text-muted-foreground/50">–</span>
                        )}
                      </td>
                    )
                  })}
                  <td className="px-1.5">
                    <div className="flex items-center justify-end gap-1">
                      {u.length > 0 && <ConfigureBadge item={{ ...u[0], label: `${u.length} value(s) of T${t.number}: ${u.map((x) => x.label.replace(`T${t.number} `, '')).join(', ')}` }} />}
                      <Button size="xs" variant="outline" disabled={dirty} title={dirty ? 'Save or discard the grid first' : 'All fields'} onClick={() => onEdit(t.id)}>
                        Edit
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
