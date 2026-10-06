import { CirclePlay, Copy, FileCode2, ListChecks, RotateCcw, Save, Sigma } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { backend } from '@/app/backend'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { featuresOf } from '@/core/features'
import { checkEditedProgram, copyProblems, programHash, programMath, programState, type MathOp, type ProgramCheck, type ProgramState } from '@/core/programEdit'
import type { AppData, Job } from '@/core/types'
import { cn } from '@/lib/utils'
import { ProgramReadDialog } from '../part/ProgramReadDialog'

interface Program {
  name: string
  /** As the job makes it (checked by the export checker). */
  text: string
  note: string
}

const STATE_LABEL: Record<ProgramState, string> = { generated: 'as generated', edited: 'edited by hand', stale: 'edit out of date' }

/**
 * The program manager (M2.10, PST-04): the job's programs, each opened in an editor with line numbers
 * and simple maths on values, checked, simulated, and copied to the machine folder. Programs as
 * generated follow the export rules; programs edited by hand need their own switch and a clean check.
 */
export function ProgramManager({ job, data, programs, jobErrors, acknowledged, setJob }: { job: Job; data: AppData; programs: Program[]; jobErrors: number; acknowledged: boolean; setJob: (fn: (j: Job) => void) => void }) {
  const [open, setOpen] = useState<Program | null>(null)
  const edits = job.programEdits
  const editedSwitch = featuresOf(data.settings).editedProgramOutput
  const folder = data.settings.machineFolder ?? ''
  const current = (p: Program) => {
    const st = programState(edits, p.name, p.text)
    return { state: st, text: st === 'edited' ? edits![p.name].text : p.text }
  }
  const checks = useMemo(() => {
    const m = new Map<string, ProgramCheck>()
    for (const p of programs) if (programState(edits, p.name, p.text) === 'edited') m.set(p.name, checkEditedProgram(edits![p.name].text, data.machine))
    return m
  }, [programs, edits, data.machine])
  const problemsOf = (p: Program) => copyProblems({ jobErrors, acknowledged, folder, state: current(p).state, editedSwitch, check: checks.get(p.name) ?? null })

  const copy = async (list: Program[]) => {
    const blocked = list.filter((p) => problemsOf(p).length)
    if (blocked.length) return void toast.error(`${blocked.length === 1 ? blocked[0].name : `${blocked.length} programs`} cannot be copied`, { description: problemsOf(blocked[0]).join(' ') })
    const files = list.map((p) => ({ name: p.name, data: current(p).text }))
    try {
      if (backend.kind === 'desktop') {
        const existing = (await backend.existingFiles?.(folder, files.map((f) => f.name))) ?? []
        if (existing.length && !window.confirm(`Replace ${existing.length === 1 ? existing[0] : `${existing.length} programs`} in ${folder}?`)) return
      }
      const where = await backend.exportFiles(files, { folder, subfolder: '' })
      if (where) toast.success(`${files.length} program${files.length === 1 ? '' : 's'} copied`, { description: `${where}. Not machine-proven: simulate in woodWOP before cutting.` })
    } catch (e) {
      toast.error('Copy failed', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const allProblems = programs.length ? [...new Set(programs.flatMap(problemsOf))] : []
  return (
    <div className="rounded-xl border bg-background" data-cfg="programs">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <span className="text-sm font-semibold">Programs</span>
        <Button size="xs" variant="outline" disabled={!programs.length || allProblems.length > 0} onClick={() => void copy(programs)} title={allProblems.join(' ')}>
          <Copy /> Copy all to the machine folder
        </Button>
      </div>
      <p className="border-b px-4 py-2 text-[11px] text-muted-foreground">
        Machine folder: <span className="font-mono">{folder || '(not set: Machine page → Shop settings)'}</span>
        {backend.kind === 'browser' && ' · In the browser preview programs download as a zip.'}
      </p>
      <ul className="divide-y">
        {programs.map((p) => {
          const st = current(p).state
          const probs = problemsOf(p)
          return (
            <li key={p.name} className="flex items-center justify-between gap-2 px-4 py-2 text-xs">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-mono">{p.name}</span>
                  {st !== 'generated' && <Badge className={cn('h-4 px-1 text-[10px]', st === 'edited' ? 'bg-amber-100 text-amber-900' : 'bg-red-100 text-red-800')}>{STATE_LABEL[st]}</Badge>}
                </div>
                <div className="text-muted-foreground">{p.note}</div>
                {probs.length > 0 && <div className="text-[11px] text-muted-foreground" title={probs.join(' ')}>Not copied: {probs[0]}</div>}
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="xs" variant="outline" onClick={() => setOpen(p)}>
                  <FileCode2 /> Open
                </Button>
                <Button size="xs" variant="outline" disabled={probs.length > 0} onClick={() => void copy([p])} aria-label={`Copy ${p.name} to the machine folder`}>
                  <Copy />
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
      {open && (
        <ProgramEditor
          program={open}
          data={data}
          edit={edits?.[open.name]}
          onClose={() => setOpen(null)}
          onKeep={(text) =>
            setJob((j) => {
              const next = { ...(j.programEdits ?? {}) }
              if (text === null || text === open.text) delete next[open.name]
              else next[open.name] = { text, base: programHash(open.text), editedAt: new Date().toISOString() }
              j.programEdits = Object.keys(next).length ? next : undefined
            })
          }
        />
      )}
    </div>
  )
}

const OPS: { op: MathOp; label: string }[] = [
  { op: '+', label: '+ add' },
  { op: '-', label: '− subtract' },
  { op: '*', label: '× multiply' },
  { op: '/', label: '÷ divide' },
  { op: '=', label: '= set to' },
]

/** One program in a text editor with line numbers, simple maths on values, a check and the simulator. */
function ProgramEditor({ program, data, edit, onClose, onKeep }: { program: Program; data: AppData; edit?: { text: string; base: string }; onClose: () => void; onKeep: (text: string | null) => void }) {
  const state = programState(edit ? { [program.name]: edit } : undefined, program.name, program.text)
  const [text, setText] = useState(state === 'edited' ? edit!.text : program.text)
  const [math, setMath] = useState({ key: 'X', op: '+' as MathOp, value: '0', from: '', to: '' })
  const [check, setCheck] = useState<ProgramCheck | null>(null)
  const [sim, setSim] = useState(false)
  const gutter = useRef<HTMLPreElement>(null)
  const lines = text.split(/\r?\n/).length
  const dirty = text !== (state === 'edited' ? edit!.text : program.text)

  const apply = () => {
    try {
      const r = programMath(text, { key: math.key, op: math.op, value: Number(math.value), ...(math.from ? { from: Number(math.from) } : {}), ...(math.to ? { to: Number(math.to) } : {}) })
      setText(r.text)
      setCheck(null)
      toast.success(r.changed ? `${r.changed} value${r.changed === 1 ? '' : 's'} changed` : 'Nothing changed', { description: r.changed ? `Lines ${r.lines.slice(0, 12).join(', ')}${r.lines.length > 12 ? ' …' : ''}` : `No ${math.key.toUpperCase()} values in those lines.` })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[96vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono text-sm">
            {program.name}
            <Badge variant="outline" className={cn('font-sans', text !== program.text && 'border-amber-400 bg-amber-50 text-amber-900')}>
              {text !== program.text ? 'edited by hand' : 'as generated'}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {text !== program.text ? 'Edited by hand: the export checker checked the program as generated, not these edits. Run the check and simulate before keeping or copying it.' : 'The program as the job makes it, checked by the export checker.'}
            {state === 'stale' && ' An earlier edit no longer matches what the job makes now; this shows the program as generated.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-2 rounded-md border p-2 text-xs">
          <Sigma className="mb-1.5 size-4 text-muted-foreground" />
          <label className="flex flex-col gap-0.5">
            Word / key
            <Input className="h-7 w-20 font-mono" value={math.key} onChange={(e) => setMath({ ...math, key: e.target.value })} aria-label="Word or key" />
          </label>
          <label className="flex flex-col gap-0.5">
            Maths
            <select className="h-7 rounded-md border bg-background px-1.5" value={math.op} onChange={(e) => setMath({ ...math, op: e.target.value as MathOp })} aria-label="Maths">
              {OPS.map((o) => (
                <option key={o.op} value={o.op}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            Value (as in the program)
            <Input className="h-7 w-24 font-mono" value={math.value} onChange={(e) => setMath({ ...math, value: e.target.value })} aria-label="Value" />
          </label>
          <label className="flex flex-col gap-0.5">
            Lines from
            <Input className="h-7 w-16" value={math.from} placeholder="1" onChange={(e) => setMath({ ...math, from: e.target.value.replace(/\D/g, '') })} aria-label="From line" />
          </label>
          <label className="flex flex-col gap-0.5">
            to
            <Input className="h-7 w-16" value={math.to} placeholder={String(lines)} onChange={(e) => setMath({ ...math, to: e.target.value.replace(/\D/g, '') })} aria-label="To line" />
          </label>
          <Button size="sm" variant="secondary" className="h-7" onClick={apply}>
            Apply
          </Button>
          <span className="mb-1.5 text-[11px] text-muted-foreground">G-code: a letter (X, Y, Z, F …). MPR: a key (XA, YA, TI, ZA, or X / Y in contours).</span>
        </div>
        <div className="flex max-h-[52vh] overflow-hidden rounded-md border bg-stone-950 font-mono text-[11px] leading-[1.45rem] text-stone-200">
          <pre ref={gutter} aria-hidden className="select-none overflow-hidden border-r border-white/10 px-2 py-2 text-right text-stone-500">
            {Array.from({ length: lines }, (_, i) => i + 1).join('\n')}
          </pre>
          <textarea
            aria-label="Program text"
            spellCheck={false}
            wrap="off"
            className="min-h-[40vh] flex-1 resize-none overflow-auto bg-transparent px-2 py-2 leading-[1.45rem] outline-none"
            value={text}
            onScroll={(e) => {
              if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop
            }}
            onChange={(e) => {
              setText(e.target.value)
              setCheck(null)
            }}
          />
        </div>
        {check && (
          <div className={cn('rounded-md border p-2 text-xs', check.errors.length ? 'border-red-300 bg-red-50 text-red-900' : 'border-emerald-300 bg-emerald-50 text-emerald-900')}>
            {check.errors.length ? `${check.errors.length} problem${check.errors.length === 1 ? '' : 's'}:` : `Read back: ${check.read.toolpaths.length} toolpaths, ${check.read.toolpaths.reduce((n, t) => n + t.moves.length, 0)} moves; on the table, above the spoilboard allowance, tools from the table.`}
            <ul className="list-disc pl-4">
              {[...check.errors, ...check.warnings].slice(0, 10).map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setCheck(checkEditedProgram(text, data.machine))}>
            <ListChecks /> Check
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSim(true)}>
            <CirclePlay /> Simulate
          </Button>
          <Button size="sm" variant="ghost" disabled={text === program.text} onClick={() => setText(program.text)}>
            <RotateCcw /> Back to the generated program
          </Button>
          <span className="ml-auto text-[11px] text-muted-foreground">{lines} lines</span>
          <Button
            size="sm"
            disabled={!dirty && !(state === 'stale')}
            onClick={() => {
              onKeep(text === program.text ? null : text)
              toast.success(text === program.text ? 'Back to the generated program' : 'Edit kept with the job', { description: text === program.text ? undefined : 'It is used while the job makes the same program; if the job changes, the edit is marked out of date.' })
              onClose()
            }}
          >
            <Save /> {text === program.text ? 'Use the generated program' : 'Keep this edit'}
          </Button>
        </div>
        {sim && <ProgramReadDialog open={sim} onOpenChange={setSim} initial={{ name: program.name, text }} />}
      </DialogContent>
    </Dialog>
  )
}
