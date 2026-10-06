import { nanoid } from 'nanoid'
import { type ConfigTarget, confirmKey, type CutDefaultKey, type CutDefaults, setCutDefault } from '@/core/confirm'
import { create } from 'zustand'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import { MAIN_MACHINE, newMachineSetup, profileOf } from '@/core/machines'
import { checkPassword } from '@/core/admin'
import { sampleJob } from '@/core/sample'
import { normalizeData } from '@/core/normalize'
import { DEFAULT_ROOM } from '@/core/room'
import type { CamPart } from '@/cam/types'
import type { AppData, CabinetInstance, CabinetTemplate, CarcassParams, Job, Library, MachineProfile, MachineSetup, ShopSettings } from '@/core/types'
import { draftBlock } from '@/core/spec/draft'
import { toast } from 'sonner'
import { backend } from './backend'

export type Route =
  | { page: 'jobs' }
  | { page: 'job'; jobId: string; tab?: JobTab }
  | { page: 'cabinet'; jobId: string; cabinetId: string; from?: JobTab }
  | { page: 'template'; templateId: string }
  | { page: 'library'; tab?: LibraryTab }
  | { page: 'machine' }
  | { page: 'batch' }
  | { page: 'settings' }
  | { page: 'parts' }
  | { page: 'part'; partId: string; jobId?: string }

export type JobTab = 'cabinets' | 'room' | 'parts' | 'cutlist' | 'nesting' | 'output'
export type LibraryTab = 'templates' | 'materials' | 'edgebands' | 'hardware' | 'rules' | 'offcuts' | 'patterns' | 'fonts'

interface State {
  data: AppData | null
  loadError: string | null
  saving: boolean
  lastSaved: number | null
  route: Route
  go(route: Route): void
  init(): Promise<void>
  mutate(fn: (d: AppData) => void): void
  /** The admin password was entered this session (M2.9): locked defaults can be edited. */
  adminUnlocked: boolean
  unlockAdmin(password: string): Promise<boolean>
  lockAdmin(): void
  /** Replace all shop data (import from a database file, M2.9). */
  replaceData(d: AppData): void
  createJob(fields: Pick<Job, 'number' | 'name' | 'customer'>): string
  loadSampleJob(): string
  deleteJob(id: string): void
  addCabinet(jobId: string, template: CabinetTemplate): string
  updateCabinet(jobId: string, cab: CabinetInstance): void
  duplicateCabinet(jobId: string, cabId: string): void
  removeCabinet(jobId: string, cabId: string): void
  saveTemplate(name: string, description: string, params: CarcassParams): string
  updateLibrary(fn: (lib: Library) => void): void
  /** Edits the machine shown on the Machine page: the main one, or another machine (M2.9). */
  updateMachine(fn: (m: MachineProfile) => void): void
  /** Machine shown on the Machine page (null = the main machine). */
  machineEdit: string | null
  editMachine(id: string | null): void
  /** Add another machine or process step (a placeholder copy); returns its id. */
  addMachine(name: string, kind: MachineSetup['kind'], from: 'main' | 'placeholder'): string
  removeMachine(id: string): void
  updateSettings(fn: (s: ShopSettings) => void): void
  resetMachine(): void
  /** Insert or replace a custom part in a job (jobId) or the shared part library. */
  savePart(part: CamPart, jobId?: string): void
  deletePart(partId: string, jobId?: string): void
  /** A "Configure" badge was clicked: the field to open (the page it is on reads and clears it). */
  configure: ConfigTarget | null
  openConfigure(t: ConfigTarget): void
  clearConfigure(): void
  /** "Mark as confirmed" on a shop value. */
  confirmValue(key: string): void
  /** Change a default cutting value; operations still using the old one follow it. */
  setCutDefault(key: CutDefaultKey, value: CutDefaults[CutDefaultKey]): void
}

export function partsOf(d: AppData, jobId?: string): CamPart[] {
  if (!jobId) return d.library.partLibrary ?? []
  return d.jobs.find((j) => j.id === jobId)?.camParts ?? []
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const now = () => new Date().toISOString()

let saveTimer: ReturnType<typeof setTimeout> | null = null

export const useStore = create<State>((set, get) => {
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      const data = get().data
      if (!data) return
      set({ saving: true })
      try {
        await backend.save(data)
        set({ saving: false, lastSaved: Date.now() })
      } catch (e) {
        set({ saving: false })
        console.error('save failed', e)
      }
    }, 400)
  }

  const mutate = (fn: (d: AppData) => void) => {
    const cur = get().data
    if (!cur) return
    const next = clone(cur)
    fn(next)
    set({ data: next })
    scheduleSave()
  }

  const touchJob = (d: AppData, jobId: string, fn: (j: Job) => void) => {
    const j = d.jobs.find((x) => x.id === jobId)
    if (!j) return
    fn(j)
    j.updatedAt = now()
  }

  const nextCabinetNumber = (j: Job, kind: CarcassParams['kind']) => {
    const prefix = kind === 'wall' ? 'W' : kind === 'tall' ? 'T' : 'B'
    let n = 1
    while (j.cabinets.some((c) => c.number === `${prefix}${n}`)) n++
    return `${prefix}${n}`
  }

  return {
    data: null,
    loadError: null,
    saving: false,
    lastSaved: null,
    route: { page: 'jobs' },
    go: (route) => set({ route }),
    configure: null,
    openConfigure(t) {
      const r = get().route
      if (t.kind === 'op') {
        if (!(r.page === 'part' && r.partId === t.partId)) set({ route: { page: 'part', partId: t.partId, ...(t.jobId ? { jobId: t.jobId } : {}) } })
      } else if (t.kind === 'material') {
        if (!(r.page === 'library' && r.tab === 'materials')) set({ route: { page: 'library', tab: 'materials' } })
      } else if (r.page !== 'machine') set({ route: { page: 'machine' } })
      // badges on other pages are about the main machine
      if (t.kind !== 'op' && t.kind !== 'material' && r.page !== 'machine') set({ machineEdit: null })
      set({ configure: t })
    },
    clearConfigure: () => set({ configure: null }),
    confirmValue: (key) => mutate((d) => confirmKey(profileOf(d, get().machineEdit), key)),
    setCutDefault: (key, value) =>
      mutate((d) => {
        const id = get().machineEdit
        // another machine keeps its own values; operations follow the main machine's only
        if (id && id !== MAIN_MACHINE) {
          const p = profileOf(d, id)
          p.cutDefaults = { ...(p.cutDefaults ?? {}), [key]: value }
          confirmKey(p, `default:${key}`)
        } else setCutDefault(d, key, value)
      }),
    adminUnlocked: false,
    async unlockAdmin(password) {
      const ok = await checkPassword(get().data?.settings.admin?.lock, password)
      if (ok) set({ adminUnlocked: true })
      return ok
    },
    lockAdmin: () => set({ adminUnlocked: false }),
    replaceData(d) {
      set({ data: normalizeData(d), machineEdit: null })
      scheduleSave()
    },
    machineEdit: null,
    editMachine: (id) => set({ machineEdit: id && id !== MAIN_MACHINE ? id : null }),
    addMachine(name, kind, from) {
      let id = ''
      mutate((d) => {
        const m = newMachineSetup(d, { name, kind, from })
        id = m.id
        d.machines = [...(d.machines ?? []), m]
      })
      return id
    },
    removeMachine(id) {
      if (get().machineEdit === id) set({ machineEdit: null })
      mutate((d) => {
        d.machines = (d.machines ?? []).filter((m) => m.id !== id)
        for (const b of d.settings.batchSetups ?? []) b.machines = b.machines.filter((x) => x !== id)
      })
    },

    async init() {
      try {
        const raw = await backend.load()
        set({ data: normalizeData(raw) })
        if (!raw) scheduleSave()
      } catch (e) {
        set({ loadError: e instanceof Error ? e.message : String(e), data: normalizeData(null) })
      }
    },

    mutate,

    createJob(fields) {
      const id = `job-${nanoid(8)}`
      mutate((d) => {
        d.jobs.unshift({ id, ...fields, notes: '', createdAt: now(), updatedAt: now(), cabinets: [], room: { ...DEFAULT_ROOM } })
      })
      return id
    },

    loadSampleJob() {
      const j = sampleJob()
      const id = `job-${nanoid(8)}`
      mutate((d) => {
        d.jobs.unshift({ ...j, id, room: j.room ?? { ...DEFAULT_ROOM }, createdAt: now(), updatedAt: now() })
      })
      return id
    },

    deleteJob(id) {
      mutate((d) => {
        d.jobs = d.jobs.filter((j) => j.id !== id)
      })
    },

    addCabinet(jobId, template) {
      const id = `cab-${nanoid(8)}`
      mutate((d) =>
        touchJob(d, jobId, (j) => {
          j.cabinets.push({
            id,
            number: nextCabinetNumber(j, template.params.kind),
            name: template.name,
            templateId: template.id,
            qty: 1,
            params: clone(template.params),
            overrides: {},
          })
        }),
      )
      return id
    },

    updateCabinet(jobId, cab) {
      mutate((d) =>
        touchJob(d, jobId, (j) => {
          j.cabinets = j.cabinets.map((c) => (c.id === cab.id ? clone(cab) : c))
        }),
      )
    },

    duplicateCabinet(jobId, cabId) {
      mutate((d) =>
        touchJob(d, jobId, (j) => {
          const src = j.cabinets.find((c) => c.id === cabId)
          if (!src) return
          const copy = clone(src)
          copy.id = `cab-${nanoid(8)}`
          copy.number = nextCabinetNumber(j, src.params.kind)
          j.cabinets.splice(j.cabinets.indexOf(src) + 1, 0, copy)
        }),
      )
    },

    removeCabinet(jobId, cabId) {
      mutate((d) =>
        touchJob(d, jobId, (j) => {
          j.cabinets = j.cabinets.filter((c) => c.id !== cabId)
        }),
      )
    },

    saveTemplate(name, description, params) {
      const id = `tpl-${nanoid(8)}`
      mutate((d) => {
        d.library.templates.push({ id, name, description, generator: 'carcass', params: clone(params) })
      })
      return id
    },

    updateLibrary: (fn) => mutate((d) => fn(d.library)),
    updateMachine: (fn) => mutate((d) => fn(profileOf(d, get().machineEdit))),
    updateSettings: (fn) => mutate((d) => fn(d.settings)),
    resetMachine: () =>
      mutate((d) => {
        const id = get().machineEdit
        const other = id ? d.machines?.find((m) => m.id === id) : undefined
        if (other) other.profile = { ...newMachineSetup(d, { name: other.name, from: 'placeholder' }).profile }
        else d.machine = clone(PLACEHOLDER_MACHINE)
      }),
    savePart(part, jobId) {
      const blocked = draftBlock(part)
      if (blocked) {
        toast.error(blocked)
        return
      }
      mutate((d) => {
        const write = (list: CamPart[] | undefined) => {
          const out = [...(list ?? [])]
          const i = out.findIndex((p) => p.id === part.id)
          if (i < 0) out.push(clone(part))
          else out[i] = clone(part)
          return out
        }
        if (!jobId) d.library.partLibrary = write(d.library.partLibrary)
        else touchJob(d, jobId, (j) => (j.camParts = write(j.camParts)))
      })
    },
    deletePart(partId, jobId) {
      mutate((d) => {
        if (!jobId) d.library.partLibrary = (d.library.partLibrary ?? []).filter((p) => p.id !== partId)
        else touchJob(d, jobId, (j) => (j.camParts = (j.camParts ?? []).filter((p) => p.id !== partId)))
      })
    },
  }
})
