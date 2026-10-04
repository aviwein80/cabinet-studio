import { Boxes, Cpu, FolderKanban, Inbox, Library as LibraryIcon, Loader2, PenTool, Settings, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { backend } from './app/backend'
import { useStore, type Route } from './app/store'
import { CabinetEditorPage } from './pages/CabinetEditor'
import { BatchPage } from './pages/BatchPage'
import { JobPage } from './pages/JobPage'
import { JobsPage } from './pages/JobsPage'
import { LibraryPage } from './pages/LibraryPage'
import { MachinePage } from './pages/MachinePage'
import { PartDesignerPage } from './pages/PartDesigner'
import { PartsPage } from './pages/PartsPage'
import { SettingsPage } from './pages/SettingsPage'

const NAV: { label: string; icon: typeof Boxes; route: Route; match: Route['page'][] }[] = [
  { label: 'Jobs', icon: FolderKanban, route: { page: 'jobs' }, match: ['jobs', 'job', 'cabinet'] },
  { label: 'Custom parts', icon: PenTool, route: { page: 'parts' }, match: ['parts', 'part'] },
  { label: 'Library', icon: LibraryIcon, route: { page: 'library' }, match: ['library', 'template'] },
  { label: 'Batch runs', icon: Inbox, route: { page: 'batch' }, match: ['batch'] },
  { label: 'Machine & tools', icon: Cpu, route: { page: 'machine' }, match: ['machine'] },
  { label: 'Settings', icon: Settings, route: { page: 'settings' }, match: ['settings'] },
]

export default function App() {
  const { data, route, go, init, saving, lastSaved, loadError, updateSettings } = useStore()
  const [location, setLocation] = useState('')

  useEffect(() => {
    void init()
    void backend.location().then(setLocation)
  }, [init])

  if (!data)
    return (
      <div className="flex h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading shop data...
      </div>
    )

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen flex-col bg-[#f6f5f2] text-foreground md:flex-row">
        <aside className="flex shrink-0 flex-row items-center gap-1 border-b bg-[#1f1d1a] px-2 py-1.5 text-stone-300 md:w-56 md:flex-col md:items-stretch md:gap-0 md:border-r md:border-b-0 md:px-3 md:py-4">
          <div className="flex items-center gap-2 px-2 md:mb-6 md:px-1">
            <div className="flex size-8 items-center justify-center rounded-md bg-amber-500 text-[#1f1d1a]">
              <Boxes className="size-5" />
            </div>
            <div className="hidden leading-tight sm:block">
              <div className="text-sm font-semibold text-white">Cabinet Studio</div>
              <div className="text-[11px] text-stone-400">{data.settings.shopName}</div>
            </div>
            <div className="ml-auto flex rounded bg-white/10 p-0.5 text-[11px] md:hidden">
              {(['mm', 'in'] as const).map((u) => (
                <button key={u} onClick={() => updateSettings((s) => (s.units = u))} className={cn('rounded px-2 py-1', data.settings.units === u ? 'bg-white font-medium text-stone-900' : 'text-stone-300')}>
                  {u}
                </button>
              ))}
            </div>
          </div>
          <nav className="flex flex-1 flex-row gap-1 md:flex-col">
            {NAV.map((n) => {
              const active = n.match.includes(route.page)
              return (
                <button
                  key={n.label}
                  onClick={() => go(n.route)}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                    active ? 'bg-white/10 font-medium text-white' : 'hover:bg-white/5 hover:text-white',
                  )}
                >
                  <n.icon className="size-4" />
                  <span className="hidden sm:inline">{n.label}</span>
                </button>
              )
            })}
          </nav>
          <div className="hidden flex-col gap-3 md:flex">
            <div className="flex rounded-md bg-white/10 p-0.5 text-xs">
              {(['mm', 'in'] as const).map((u) => (
                <button
                  key={u}
                  onClick={() => updateSettings((s) => (s.units = u))}
                  className={cn('flex-1 rounded px-2 py-1', data.settings.units === u ? 'bg-white font-medium text-stone-900' : 'text-stone-300')}
                >
                  {u === 'mm' ? 'Millimetres' : 'Inches'}
                </button>
              ))}
            </div>
            {data.machine.placeholder && (
              <button onClick={() => go({ page: 'machine' })} className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-left text-[11px] leading-snug text-amber-200">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                Placeholder tool table. Load the real N-200 tools before cutting.
              </button>
            )}
            <div className="px-1 text-[10px] leading-snug text-stone-500">
              <div>{saving ? 'Saving...' : lastSaved ? `Saved ${new Date(lastSaved).toLocaleTimeString()}` : 'All changes saved locally'}</div>
              <div className="mt-1 break-all" title={location}>
                {location}
              </div>
              {loadError && <div className="mt-1 text-red-400">Load error: {loadError}</div>}
            </div>
          </div>
        </aside>
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {route.page === 'jobs' && <JobsPage />}
          {route.page === 'job' && <JobPage jobId={route.jobId} tab={route.tab ?? 'cabinets'} />}
          {route.page === 'cabinet' && <CabinetEditorPage target={{ kind: 'cabinet', jobId: route.jobId, cabinetId: route.cabinetId }} />}
          {route.page === 'template' && <CabinetEditorPage target={{ kind: 'template', templateId: route.templateId }} />}
          {route.page === 'library' && <LibraryPage tab={route.tab ?? 'templates'} />}
          {route.page === 'machine' && <MachinePage />}
          {route.page === 'settings' && <SettingsPage />}
          {route.page === 'batch' && <BatchPage />}
          {route.page === 'parts' && <PartsPage />}
          {route.page === 'part' && <PartDesignerPage partId={route.partId} jobId={route.jobId} />}
        </main>
      </div>
      <Toaster position="bottom-right" richColors />
    </TooltipProvider>
  )
}
