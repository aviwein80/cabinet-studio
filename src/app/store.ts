import { nanoid } from 'nanoid'
import { type ConfigTarget, confirmKey, type CutDefaultKey, type CutDefaults, setCutDefault } from '@/core/confirm'
import { create } from 'zustand'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import { MAIN_MACHINE, newMachineSetup, profileOf } from '@/core/machines'
import { checkPassword } from '@/core/admin'
import { sampleJob } from '@/core/sample'
import { normalizeData } from '@/core/normalize'
import { copyCabinet, DEFAULT_ROOM, describeResize, jobFronts, nextCabinetNumber, placementOf, arrangeCabinets, pushNeighbours, withJobFronts } from '@/core/room'
import { redoOf, ROOM_UNDO_LIMIT, roomSnapshot, sameSnapshot, undoRoomStep, type RoomSnapshot, type RoomStep } from '@/core/roomUndo'
import type { CamPart } from '@/cam/types'
import type { AppData, CabinetInstance, CabinetTemplate, CarcassParams, Job, Library, MachineProfile, MachineSetup, ShopSettings } from '@/core/types'
import { draftBlock } from '@/core/spec/draft'
import { applySwap, undoSwap, type MaterialSwap, type SwapUndo } from '@/core/jobMaterials'
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

export type JobTab = 'cabinets' | 'room' | 'parts' | 'cutlist' | 'nesting' | 'quote' | 'output'
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
  /** Library-1: returns, in words, the cabinets a change of width moved along the run ('' when none). */
  updateCabinet(jobId: string, cab: CabinetInstance): string
  /** Library-1: returns the copy's id and where it went (beside the original, or set in front of it to be moved). */
  duplicateCabinet(jobId: string, cabId: string): { id: string; how: 'beside' | 'offset' | 'arranged' } | null
  removeCabinet(jobId: string, cabId: string): void
  /** Job-1: change materials on the job's cabinets in one step; returns the number of settings changed. */
  swapMaterials(jobId: string, swap: MaterialSwap): number
  /** The last material change (kept while the app runs), for its one-step undo. */
  materialUndo: SwapUndo | null
  /** Undo the last material change: settings changed again since are left as they are. */
  undoMaterials(): { reverted: number; skipped: number } | null
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
  /** Library-1: a cabinet to select when the job's Room tab opens (a copy made on the Cabinets tab). */
  roomFocus: { jobId: string; cabinetId: string } | null
  focusRoom(jobId: string, cabinetId: string | null): void
  /** Library-1: the Room tab's undo and redo steps (kept while the app runs). */
  roomUndo: RoomStep[]
  roomRedo: RoomStep[]
  /** Change the job on the Room tab as one undo step labelled `label`. */
  editRoom(jobId: string, label: string, fn: (j: Job) => void): void
  /** Library-1: record a change already made (a drag, one step however many moves) from the room as it was before; false when nothing changed. */
  recordRoom(jobId: string, label: string, before: RoomSnapshot): boolean
  /** Undo (or redo) the job's last Room tab step; null when there is none. */
  undoRoom(jobId: string, redo?: boolean): { label: string; reverted: number; skipped: number } | null
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
      // Kitchen-2: a cabinet's own value; its badge sits beside the field on the page already open
      if (t.kind === 'kitchen') return set({ configure: t })
      // Library-1: a room value (an opening's sizes): on the job's Room tab, where the badge is
      if (t.kind === 'room') return set({ configure: t })
      // Library-1: a hand-typed quote line's price: on the job's Quote tab, where the badge is
      if (t.kind === 'quote') return set({ configure: t })
      if (t.kind === 'op' || t.kind === 'fixture') {
        if (!(r.page === 'part' && r.partId === t.partId)) set({ route: { page: 'part', partId: t.partId, ...(t.jobId ? { jobId: t.jobId } : {}) } })
      } else if (t.kind === 'material') {
        if (!(r.page === 'library' && r.tab === 'materials')) set({ route: { page: 'library', tab: 'materials' } })
      } else if (t.kind === 'price') {
        // Job-1: a library price: the edgeband or hardware table
        const tab = t.what === 'edgeband' ? 'edgebands' : 'hardware'
        if (!(r.page === 'library' && r.tab === tab)) set({ route: { page: 'library', tab } })
      } else if (t.kind === 'labour') {
        // Job-1: the shop rate and labour times are on the Settings page
        if (r.page !== 'settings') set({ route: { page: 'settings' } })
      } else if (r.page !== 'machine') set({ route: { page: 'machine' } })
      // badges on other pages are about the main machine
      if (t.kind !== 'op' && t.kind !== 'fixture' && t.kind !== 'material' && t.kind !== 'price' && t.kind !== 'labour' && r.page !== 'machine') set({ machineEdit: null })
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
            number: nextCabinetNumber(j, template.params),
            name: template.name,
            templateId: template.id,
            qty: 1,
            // Polish-4: a filler takes the job's front board, as Fill gap and Split give it
            params: withJobFronts(clone(template.params), jobFronts(j.cabinets)),
            overrides: {},
          })
        }),
      )
      return id
    },

    updateCabinet(jobId, cab) {
      let text = ''
      mutate((d) =>
        touchJob(d, jobId, (j) => {
          const prev = j.cabinets.find((c) => c.id === cab.id)?.params
          const room = { ...DEFAULT_ROOM, ...(j.room ?? {}) }
          const laid = arrangeCabinets(j.cabinets, room, d.library)
          const before = Object.fromEntries(j.cabinets.map((c) => [c.id, placementOf(c, laid)]))
          j.cabinets = j.cabinets.map((c) => (c.id === cab.id ? clone(cab) : c))
          // Polish-1: a wider (or narrower) placed cabinet moves its neighbours along the run;
          // Kitchen-2: so does a corner cabinet's depth or pull-out, round the corner
          if (prev) {
            pushNeighbours(j.cabinets, cab.id, { width: prev.width, depth: prev.depth, pullOut: prev.corner?.type === 'blind' ? prev.corner.pullOut : undefined }, room, d.library)
            // Library-1: say what moved
            text = describeResize(before, j.cabinets, cab.id, prev.width, room, d.settings.units)
          }
        }),
      )
      return text
    },

    duplicateCabinet(jobId, cabId) {
      let res: ReturnType<State['duplicateCabinet']> = null
      mutate((d) =>
        touchJob(d, jobId, (j) => {
          // Library-1: beside the original on its wall, in the first free space (it landed on the original)
          res = copyCabinet(j, cabId, { ...DEFAULT_ROOM, ...(j.room ?? {}) }, d.library, () => `cab-${nanoid(8)}`)
        }),
      )
      return res
    },

    roomFocus: null,
    focusRoom: (jobId, cabinetId) => set({ roomFocus: cabinetId ? { jobId, cabinetId } : null }),
    roomUndo: [],
    roomRedo: [],
    editRoom(jobId, label, fn) {
      mutate((d) =>
        touchJob(d, jobId, (j) => {
          const before = roomSnapshot(j, DEFAULT_ROOM)
          fn(j)
          const after = roomSnapshot(j, DEFAULT_ROOM)
          if (sameSnapshot(before, after)) return
          set({ roomUndo: [...get().roomUndo, { jobId, label, before, after }].slice(-ROOM_UNDO_LIMIT * 4), roomRedo: get().roomRedo.filter((s) => s.jobId !== jobId) })
        }),
      )
    },
    recordRoom(jobId, label, before) {
      const j = get().data?.jobs.find((x) => x.id === jobId)
      if (!j) return false
      const after = roomSnapshot(j, DEFAULT_ROOM)
      if (sameSnapshot(before, after)) return false
      set({ roomUndo: [...get().roomUndo, { jobId, label, before, after }].slice(-ROOM_UNDO_LIMIT * 4), roomRedo: get().roomRedo.filter((s) => s.jobId !== jobId) })
      return true
    },
    undoRoom(jobId, redo = false) {
      const from = redo ? get().roomRedo : get().roomUndo
      const step = [...from].reverse().find((s) => s.jobId === jobId)
      if (!step) return null
      let res = { reverted: 0, skipped: 0 }
      mutate((d) => touchJob(d, jobId, (j) => (res = undoRoomStep(j, step, DEFAULT_ROOM))))
      const rest = from.filter((s) => s !== step)
      // the undone step can be redone (and a redone one undone again)
      if (redo) set({ roomRedo: rest, roomUndo: [...get().roomUndo, redoOf(step)] })
      else set({ roomUndo: rest, roomRedo: [...get().roomRedo, redoOf(step)] })
      return { label: step.label, ...res }
    },

    removeCabinet(jobId, cabId) {
      mutate((d) =>
        touchJob(d, jobId, (j) => {
          j.cabinets = j.cabinets.filter((c) => c.id !== cabId)
        }),
      )
    },

    materialUndo: null,
    swapMaterials(jobId, swap) {
      let n = 0
      mutate((d) =>
        touchJob(d, jobId, (j) => {
          const { cabinets, undo } = applySwap(j, swap, d.library)
          j.cabinets = cabinets
          n = undo.changes.length
          set({ materialUndo: n ? undo : get().materialUndo })
        }),
      )
      return n
    },
    undoMaterials() {
      const u = get().materialUndo
      if (!u) return null
      let res: { reverted: number; skipped: number } = { reverted: 0, skipped: 0 }
      mutate((d) =>
        touchJob(d, u.jobId, (j) => {
          const r = undoSwap(j, u)
          j.cabinets = r.cabinets
          res = { reverted: r.reverted, skipped: r.skipped }
        }),
      )
      set({ materialUndo: null })
      return res
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
