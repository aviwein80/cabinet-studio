import { Lock, LockOpen } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useStore } from '@/app/store'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { isLocked } from '@/core/admin'

/** Ask for the admin password (M2.9, AM-13). */
export function UnlockDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const unlock = useStore((s) => s.unlockAdmin)
  const [pw, setPw] = useState('')
  const [wrong, setWrong] = useState(false)
  const close = (o: boolean) => {
    setPw('')
    setWrong(false)
    onOpenChange(o)
  }
  const submit = async () => {
    if (await unlock(pw)) close(false)
    else setWrong(true)
  }
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Unlock the shop defaults</DialogTitle>
          <DialogDescription>Enter the admin password set under Settings, Admin tools.</DialogDescription>
        </DialogHeader>
        <Input type="password" autoFocus aria-label="Admin password" value={pw} onChange={(e) => (setPw(e.target.value), setWrong(false))} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
        {wrong && <p className="text-xs text-red-700">That is not the password.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()}>Unlock</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Wraps a page of shop defaults: while the admin password is set and not entered, everything shows
 * but nothing can be changed (a disabled fieldset), with a strip to unlock.
 */
export function AdminLocked({ what, children }: { what: string; children: ReactNode }) {
  const settings = useStore((s) => s.data?.settings)
  const unlocked = useStore((s) => s.adminUnlocked)
  const lockAdmin = useStore((s) => s.lockAdmin)
  const [ask, setAsk] = useState(false)
  const locked = !!settings && isLocked(settings, unlocked)
  return (
    <>
      {settings?.admin?.lock && (
        <div className="flex flex-wrap items-center gap-3 border-b bg-stone-100 px-5 py-2 text-xs text-stone-700" data-cfg="admin-lock">
          {locked ? <Lock className="size-4" /> : <LockOpen className="size-4" />}
          <span className="min-w-0 flex-1">{locked ? `${what} are locked by the admin password. Everything is shown; unlock to change a value (also one that still needs configuring).` : `${what} are unlocked for this session.`}</span>
          {locked ? (
            <Button size="sm" variant="outline" className="h-7" onClick={() => setAsk(true)}>
              Unlock
            </Button>
          ) : (
            <Button size="sm" variant="ghost" className="h-7" onClick={lockAdmin}>
              Lock again
            </Button>
          )}
        </div>
      )}
      <fieldset disabled={locked} className="contents">
        {children}
      </fieldset>
      <UnlockDialog open={ask} onOpenChange={setAsk} />
    </>
  )
}
