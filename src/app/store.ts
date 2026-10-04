import { nanoid } from 'nanoid'
import { create } from 'zustand'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import { sampleJob } from '@/core/sample'
import { normalizeData } from '@/core/normalize'
import { DEFAULT_ROOM } from '@/core/room'
import type { CamPart } from '@/cam/types'
import type { AppData, CabinetInstance, CabinetTemplate, CarcassParams, Job, Library, MachineProfile, ShopSettings } from '@/core/types'
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
export type LibraryTab = 'templates' | 'materials' | 'edgebands' | 'hardware' | 'rules' | 'offcuts' | 'patterns'

interface State {
  data: AppData | null
  loadError: string | null
  saving: boolean
  lastSaved: number | null
  route: Route
  go(route: Route): void
  init(): Promise<void>
  mutate(fn: (d: AppData) => void): void
  createJob(fields: Pick<Job, 'number' | 'name' | 'customer'>): string
  loadSampleJob(): string
  deleteJob(id: string): void
  addCabinet(jobId: string, template: CabinetTemplate): string
  updateCabinet(jobId: string, cab: CabinetInstance): void
  duplicateCabinet(jobId: string, cabId: string): void
  removeCabinet(jobId: string, cabId: string): void
  saveTemplate(name: string, description: string, params: CarcassParams): string
  updateLibrary(fn: (lib: Library) => void): void
  updateMachine(fn: (m: MachineProfile) => void): void
  updateSettings(fn: (s: ShopSettings) => void): void
  resetMachine(): void
  /** Insert or replace a custom part in a job (jobId) or the shared part library. */
  savePart(part: CamPart, jobId?: string): void
  deletePart(partId: string, jobId?: string): void
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
    updateMachine: (fn) => mutate((d) => fn(d.machine)),
    updateSettings: (fn) => mutate((d) => fn(d.settings)),
    resetMachine: () =>
      mutate((d) => {
        d.machine = clone(PLACEHOLDER_MACHINE)
      }),
    savePart(part, jobId) {
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
