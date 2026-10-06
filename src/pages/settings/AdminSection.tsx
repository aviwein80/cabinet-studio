import { FileDown, KeyRound, Lock, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { backend } from '@/app/backend'
import { useStore } from '@/app/store'
import { UnlockDialog } from '@/components/AdminLock'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { checkPassword, HIDEABLE_SCREENS, hiddenScreens, isLocked, missingRecipeReport, newLock, recipeReportCsv } from '@/core/admin'

/**
 * Admin tools (M2.9, AM-13): a password on the shop defaults, screens hidden from the side bar and
 * the missing-recipe report. (The tool-change order is on the Machine page.)
 */
export function AdminSection() {
  const data = useStore((s) => s.data)!
  const updateSettings = useStore((s) => s.updateSettings)
  const unlocked = useStore((s) => s.adminUnlocked)
  const lockAdmin = useStore((s) => s.lockAdmin)
  const lock = data.settings.admin?.lock
  const locked = isLocked(data.settings, unlocked)
  const [pw, setPw] = useState({ a: '', b: '', old: '' })
  const [ask, setAsk] = useState(false)
  const hidden = hiddenScreens(data.settings)
  const report = missingRecipeReport(data)

  const setPassword = async () => {
    if (pw.a !== pw.b) return void toast.error('The two passwords are not the same.')
    if (lock && !(await checkPassword(lock, pw.old))) return void toast.error('The current password is not right.')
    try {
      const next = await newLock(pw.a)
      updateSettings((s) => void (s.admin = { ...s.admin, lock: next }))
      setPw({ a: '', b: '', old: '' })
      toast.success(lock ? 'Password changed' : 'Password set: the Machine page and machining rules are locked until it is entered')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }
  const removePassword = async () => {
    if (!(await checkPassword(lock, pw.old))) return void toast.error('Enter the current password to remove it.')
    updateSettings((s) => void (s.admin = { ...s.admin, lock: undefined }))
    setPw({ a: '', b: '', old: '' })
    toast.success('Password removed')
  }
  const saveReport = async () => {
    const at = await backend.saveFile({ name: 'missing-recipes.csv', data: recipeReportCsv(report) }, [{ name: 'CSV', extensions: ['csv'] }])
    if (at) toast.success('Report saved', { description: at })
  }

  return (
    <section className="mx-auto mt-8 flex max-w-4xl flex-col gap-4" data-cfg="admin">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <ShieldCheck className="size-4" /> Admin tools
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          A password keeps the machine settings, tools, default cutting values and machining rules from being changed by accident on a shared shop PC. It is not security: the shop data file can still be edited. Locked values are still shown with their Configure badges; entering the
          password makes them editable.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-lg border bg-background p-3 text-xs">
          <h3 className="flex items-center gap-1.5 text-[13px] font-medium">
            <KeyRound className="size-3.5" /> Password on the shop defaults
          </h3>
          <p className="text-muted-foreground">{lock ? (locked ? 'Set, and locked now.' : 'Set, unlocked for this session.') : 'Not set: everyone can change everything.'}</p>
          {lock && locked ? (
            <Button size="sm" variant="outline" className="w-fit" onClick={() => setAsk(true)}>
              Unlock
            </Button>
          ) : (
            <>
              {lock && <Input type="password" aria-label="Current password" placeholder="Current password" value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} />}
              <Input type="password" aria-label="New password" placeholder={lock ? 'New password' : 'Password (at least 4 characters)'} value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} />
              <Input type="password" aria-label="New password again" placeholder="Again" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={!pw.a} onClick={() => void setPassword()}>
                  {lock ? 'Change password' : 'Set password'}
                </Button>
                {lock && (
                  <>
                    <Button size="sm" variant="ghost" disabled={!pw.old} onClick={() => void removePassword()}>
                      Remove password
                    </Button>
                    <Button size="sm" variant="ghost" onClick={lockAdmin}>
                      <Lock /> Lock now
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
        <fieldset disabled={locked} className="flex flex-col gap-2 rounded-lg border bg-background p-3 text-xs">
          <h3 className="text-[13px] font-medium">Hide screens from the side bar</h3>
          <p className="text-muted-foreground">For a machine-room PC that only runs jobs. Hidden screens come back while the password is entered, and Configure badges still open the Machine page.</p>
          {HIDEABLE_SCREENS.map((h) => (
            <label key={h.id} className="flex items-center gap-2">
              <Checkbox checked={hidden.includes(h.id)} onCheckedChange={(v) => updateSettings((s) => void (s.admin = { ...s.admin, hidden: HIDEABLE_SCREENS.map((x) => x.id).filter((x) => (x === h.id ? v === true : hidden.includes(x))) }))} />
              {h.label}
            </label>
          ))}
        </fieldset>
      </div>
      <div className="flex flex-col gap-2 rounded-lg border bg-background p-3 text-xs" data-cfg="missing-recipes">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[13px] font-medium">Missing-recipe report</h3>
          <Button size="sm" variant="outline" disabled={!report.length} onClick={() => void saveReport()}>
            <FileDown /> Save as CSV
          </Button>
        </div>
        <p className="text-muted-foreground">Rules and door styles that point at a deleted recipe, empty recipes and rule tables, and drawn shapes (in jobs and the part library) that no operation machines.</p>
        {report.length ? (
          <table className="w-full">
            <tbody>
              {report.slice(0, 50).map((r, i) => (
                <tr key={i} className="border-t align-top">
                  <td className="py-1 pr-3 font-medium">{r.where}</td>
                  <td className="py-1 text-muted-foreground">{r.problem}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-emerald-700">Nothing missing.</p>
        )}
        {report.length > 50 && <p className="text-muted-foreground">and {report.length - 50} more in the CSV.</p>}
      </div>
      <UnlockDialog open={ask} onOpenChange={setAsk} />
    </section>
  )
}
