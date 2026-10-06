import { Loader2 } from 'lucide-react'
import { quickjsPageBase } from '@/cam/plugin/quickjs'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/app/store'
import { Wizard } from '@/components/Wizard'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DEFAULT_BATCH_KINDS, type BatchResult } from '@/core/batch'
import { BATCH_CHECK_LIST } from '@/core/batchExample'
import { batchStepChoices } from '@/core/batchSteps'
import { featuresOf } from '@/core/features'
import { machineSetups, MAIN_MACHINE } from '@/core/machines'
import type { ExportKind } from '@/core/output'
import { BATCH_WIZARD_STEPS, batchSetupFromWizard, batchWizardProblems, type BatchWizardAnswers } from '@/core/wizards'

const KINDS: { kind: ExportKind; label: string }[] = [
  { kind: 'mpr', label: 'Programs (MPR), when the export checks pass' },
  { kind: 'labels-pdf', label: 'Labels (PDF)' },
  { kind: 'labels-zpl', label: 'Labels for a label printer (ZPL)' },
  { kind: 'sheetmap-pdf', label: 'Sheet maps (PDF)' },
  { kind: 'cutlist-csv', label: 'Cut list (CSV)' },
  { kind: 'bom-csv', label: 'Bill of materials (CSV)' },
  { kind: 'areas-csv', label: 'Areas and costs (CSV)' },
]

/** New batch setup, step by step (M2.9, AM-03). The last step runs a check list with it. */
export function BatchSetupWizard({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const data = useStore((s) => s.data)!
  const updateSettings = useStore((s) => s.updateSettings)
  const [step, setStep] = useState(0)
  const [a, setA] = useState<BatchWizardAnswers>({ name: '', machines: [MAIN_MACHINE], kinds: [...DEFAULT_BATCH_KINDS], steps: [] })
  const [check, setCheck] = useState<{ busy: boolean; result?: BatchResult; error?: string }>({ busy: false })
  const worker = useRef<Worker | null>(null)
  const problems = batchWizardProblems(step, a, data)
  const machines = machineSetups(data)
  const toggle = <T,>(list: T[], v: T, on: boolean, all: T[]) => all.filter((x) => (x === v ? on : list.includes(x)))

  useEffect(() => () => worker.current?.terminate(), [])
  // last step: run the check list through the one batch engine with this setup, in the worker
  const goStep = (n: number) => {
    setStep(n)
    if (n !== BATCH_WIZARD_STEPS.length - 1) return
    worker.current?.terminate()
    const w = new Worker(new URL('../../app/batch.worker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    setCheck({ busy: true })
    w.onmessage = (e: MessageEvent<{ type: 'log' } | { type: 'done'; result: BatchResult } | { type: 'error'; message: string }>) => {
      if (e.data.type === 'log') return
      setCheck(e.data.type === 'done' ? { busy: false, result: e.data.result } : { busy: false, error: e.data.message })
      w.terminate()
    }
    w.postMessage({ csvName: 'setup-check.csv', csvText: BATCH_CHECK_LIST, drawings: {}, data, setup: batchSetupFromWizard(a, data), pluginBase: quickjsPageBase() })
  }

  const close = (o: boolean) => {
    if (!o) {
      worker.current?.terminate()
      setStep(0)
      setA({ name: '', machines: [MAIN_MACHINE], kinds: [...DEFAULT_BATCH_KINDS], steps: [] })
      setCheck({ busy: false })
    }
    onOpenChange(o)
  }
  const finish = () => {
    const setup = batchSetupFromWizard(a, data)
    updateSettings((s) => {
      s.batchSetups = [...(s.batchSetups ?? []), setup]
      s.batch = { inbox: s.batch?.inbox ?? '', outbox: s.batch?.outbox ?? '', ...s.batch, setupId: setup.id }
    })
    toast.success(`Batch setup "${setup.name}" created and in use`)
    close(false)
  }
  const o = check.result?.orders[0]
  const otherOut = featuresOf(data.settings).batchMachinesOutput

  return (
    <Wizard open={open} onOpenChange={close} title="New batch setup" description="What a batch run does with each part list. You can change it later on the Batch page." steps={BATCH_WIZARD_STEPS} step={step} onStep={goStep} problems={problems} onFinish={finish} finishLabel="Create and use">
      {step === 0 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bw-name">Name</Label>
          <Input id="bw-name" autoFocus value={a.name} placeholder="e.g. Kitchens, both machines" onChange={(e) => setA({ ...a, name: e.target.value })} />
          <p className="text-xs text-muted-foreground">Setups are picked on the Batch page; the folder watcher and “Run a list now” use the one in use.</p>
        </div>
      )}
      {step === 1 && (
        <div className="flex flex-col gap-2 text-xs">
          <p className="text-muted-foreground">Each machine ticked gets its own nest, programs and export check from the same list.</p>
          {machines.map((m, i) => (
            <label key={m.id} className="flex items-start gap-2">
              <Checkbox checked={a.machines.includes(m.id)} onCheckedChange={(v) => setA({ ...a, machines: toggle(a.machines, m.id, v === true, machines.map((x) => x.id)) })} className="mt-0.5" />
              <span>
                <span className="font-medium">{m.name}</span>
                <span className="text-muted-foreground">{i === 0 ? ' · main machine' : ` · ${m.kind === 'step' ? 'process step' : 'other machine'}${otherOut ? '' : ' (checked, not written while output for other machines is off)'}`}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      {step === 2 && (
        <div className="flex flex-col gap-2 text-xs">
          {KINDS.map((k) => (
            <label key={k.kind} className="flex items-center gap-2">
              <Checkbox checked={a.kinds.includes(k.kind)} onCheckedChange={(v) => setA({ ...a, kinds: toggle(a.kinds, k.kind, v === true, KINDS.map((x) => x.kind)) })} />
              {k.label}
            </label>
          ))}
          <p className="text-muted-foreground">A report is always written. Programs are only written when the export checks find no errors and the machine-output switches allow it.</p>
        </div>
      )}
      {step === 3 && (
        <div className="flex flex-col gap-2 text-xs">
          {batchStepChoices(data).map((st) => (
            <label key={st.id} className="flex items-start gap-2">
              <Checkbox checked={a.steps.includes(st.id)} onCheckedChange={(v) => setA({ ...a, steps: toggle(a.steps, st.id, v === true, batchStepChoices(data).map((x) => x.id)) })} className="mt-0.5" />
              <span>
                <span className="font-medium">{st.name}</span> <span className="text-muted-foreground">· {st.description}{st.source !== 'built in' ? ` (plugin: ${st.source})` : ''}</span>
              </span>
            </label>
          ))}
          <p className="text-muted-foreground">Steps report, can hold an order back and add report files. They never change the programs.</p>
        </div>
      )}
      {step === 4 && (
        <div className="flex flex-col gap-2 text-xs">
          <p className="text-muted-foreground">A check list (shelves, a door, a cabinet side with a hinge plate) was run with this setup. Nothing was saved or written.</p>
          {check.busy && (
            <p className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" /> Running the check list…
            </p>
          )}
          {check.error && <p className="text-red-700">The check failed: {check.error}</p>}
          {o && (
            <div className="rounded-md border p-2.5">
              <p className="font-medium">
                {{ done: 'Programs would be written', blocked: 'Held back by the export checks (report only)', failed: 'Failed', cancelled: 'Cancelled' }[o.status]} · {o.parts} parts
              </p>
              <ul className="mt-1 text-muted-foreground">
                {o.machines.map((m) => (
                  <li key={m.id}>
                    {m.name}: {m.sheets} sheet{m.sheets === 1 ? '' : 's'}, {{ written: `${m.files.length} files`, blocked: 'blocked', held: 'checked, not written' }[m.status]}
                  </li>
                ))}
              </ul>
              {o.errors.slice(0, 4).map((e) => (
                <p key={e} className="mt-1 text-amber-800">
                  {e}
                </p>
              ))}
              {o.status === 'blocked' && <p className="mt-1 text-muted-foreground">That is the checker doing its job (for example, custom-part output is off); the setup itself is fine.</p>}
            </div>
          )}
        </div>
      )}
    </Wizard>
  )
}
