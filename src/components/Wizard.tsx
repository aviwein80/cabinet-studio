import { ChevronLeft, ChevronRight, Wand2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/**
 * Step-by-step dialog (M2.9 setup wizards): numbered steps across the top, one step's content, the
 * problems that stop it moving on, Back / Next, and Create on the last step.
 */
export function Wizard({
  open,
  onOpenChange,
  title,
  description,
  steps,
  step,
  onStep,
  problems,
  onFinish,
  finishLabel,
  children,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description: string
  steps: readonly string[]
  step: number
  onStep: (n: number) => void
  /** Problems with the answers so far; any problem stops Next and Create. */
  problems: string[]
  onFinish: () => void
  finishLabel: string
  children: ReactNode
}) {
  const last = step === steps.length - 1
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="size-4" /> {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ol className="flex flex-wrap gap-1.5 text-[11px]" aria-label="Steps">
          {steps.map((s, i) => (
            <li key={s} className={cn('flex items-center gap-1 rounded-full border px-2 py-0.5', i === step ? 'border-primary bg-primary text-primary-foreground' : i < step ? 'bg-muted' : 'text-muted-foreground')} aria-current={i === step ? 'step' : undefined}>
              <span className="tabular-nums">{i + 1}</span> {s}
            </li>
          ))}
        </ol>
        <div className="min-h-48 text-sm">{children}</div>
        {problems.length > 0 && (
          <ul className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => (step ? onStep(step - 1) : onOpenChange(false))}>
            <ChevronLeft /> {step ? 'Back' : 'Cancel'}
          </Button>
          {last ? (
            <Button disabled={problems.length > 0} onClick={onFinish}>
              {finishLabel}
            </Button>
          ) : (
            <Button disabled={problems.length > 0} onClick={() => onStep(step + 1)}>
              Next <ChevronRight />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
