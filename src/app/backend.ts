/**
 * Storage and file-system access. Inside Electron everything goes through the preload bridge
 * (local JSON file in the user's AppData folder, native folder pickers). In a plain browser
 * (used for development previews) it falls back to localStorage and downloads.
 */
import JSZip from 'jszip'
import type { AppData } from '@/core/types'

import type { OutFile } from '@/core/output'
import { AI_PROVIDERS, type AiCall, type AiProviderId, callProvider } from '@/core/hardware/aiProviders'
import type { BlobStore } from '@/cam/model/blobs'
import type { PluginGrants } from '@/cam/plugin/types'
export type { OutFile }

interface Bridge {
  blobHas(hash: string): Promise<boolean>
  blobGet(hash: string): Promise<Uint8Array | null>
  blobPut(hash: string, gz: Uint8Array): Promise<boolean>
  load(): Promise<string | null>
  save(json: string): Promise<boolean>
  info(): Promise<{ dataFile: string; version: string; platform: string }>
  storageStatus(): Promise<StorageStatus>
  storageSet(kind: StorageKind): Promise<{ kind: StorageKind; message: string }>
  storageExportDb(json: string): Promise<string | null>
  storageImportDb(): Promise<{ file: string; json: string } | null>
  exportFiles(files: OutFile[], opts: { folder?: string; subfolder?: string }): Promise<string | null>
  saveFile(file: OutFile, filters: { name: string; extensions: string[] }[]): Promise<string | null>
  openPath(p: string): Promise<string>
  pickFolder(title: string): Promise<string | null>
  batchStart(cfg: { inbox: string; outbox: string }): Promise<BatchStatus>
  batchStop(): Promise<BatchStatus>
  batchCancel(): Promise<BatchStatus>
  batchStatus(): Promise<BatchStatus>
  onBatchEvent(cb: (ev: BatchEvent) => void): () => void
  aiKeyStatus(): Promise<AiKeyStatus>
  aiSetKey(provider: AiProviderId, key: string | null): Promise<AiKeyStatus>
  aiCall(call: AiCall): Promise<string>
  pluginRead(p: string, grants: PluginGrants): Promise<string>
  pluginWrite(p: string, text: string, grants: PluginGrants): Promise<void>
  pluginList(p: string, grants: PluginGrants): Promise<string[]>
  pluginFetch(url: string, init: unknown, grants: PluginGrants): Promise<string>
}

/** File and network access for plugins (desktop app; the main process checks the grants again). */
export interface PluginBridge {
  read(p: string, grants: PluginGrants): Promise<string>
  write(p: string, text: string, grants: PluginGrants): Promise<void>
  list(p: string, grants: PluginGrants): Promise<string[]>
  fetch(url: string, init: unknown, grants: PluginGrants): Promise<string>
}

/** Which providers have a key saved on this computer. Keys themselves never come back. */
export type AiKeyStatus = Record<AiProviderId, { saved: boolean; where: string }>

/** API keys and calls to vision providers. Keys stay on this computer, outside the shop file. */
export interface AiBridge {
  status(): Promise<AiKeyStatus>
  setKey(provider: AiProviderId, key: string | null): Promise<AiKeyStatus>
  call(call: AiCall): Promise<string>
}

export type StorageKind = 'json' | 'sqlite'
export interface StorageStatus {
  kind: StorageKind
  jsonFile: string
  dbFile: string
}

/** Shop data in a JSON file (default) or the SQLite option (M2.9, desktop app). */
export interface StorageBridge {
  status(): Promise<StorageStatus>
  set(kind: StorageKind): Promise<{ kind: StorageKind; message: string }>
  /** Write the shop data to a database file the user picks. Returns its path, or null if cancelled. */
  exportDb(data: AppData): Promise<string | null>
  /** Read shop data from a database file the user picks (not applied yet). */
  importDb(): Promise<{ file: string; data: AppData } | null>
}

export interface BatchStatus {
  running: boolean
  inbox: string | null
  outbox: string | null
  busy: string | null
  log: { at: string; msg: string }[]
}

export type BatchEvent = { type: 'log'; at: string; msg: string } | { type: 'busy'; csv: string } | { type: 'idle' } | { type: 'state' }

/** Folder watcher in the desktop app (worker thread in the main process). */
export interface BatchBridge {
  pickFolder(title: string): Promise<string | null>
  start(cfg: { inbox: string; outbox: string }): Promise<BatchStatus>
  stop(): Promise<BatchStatus>
  cancel(): Promise<BatchStatus>
  status(): Promise<BatchStatus>
  onEvent(cb: (ev: BatchEvent) => void): () => void
}

declare global {
  interface Window {
    cabinetStudio?: Bridge
  }
}

export interface Backend {
  kind: 'desktop' | 'browser'
  load(): Promise<AppData | null>
  save(data: AppData): Promise<void>
  location(): Promise<string>
  /** Write several files into a folder. Returns the folder written to, or null if cancelled. */
  exportFiles(files: OutFile[], opts: { folder?: string; subfolder: string }): Promise<string | null>
  saveFile(file: OutFile, filters: { name: string; extensions: string[] }[]): Promise<string | null>
  openPath?(p: string): Promise<void>
  batch?: BatchBridge
  storage?: StorageBridge
  /** Plugin file and network access (desktop app only). */
  plugins?: PluginBridge
  ai: AiBridge
  /** 3D model data, kept outside the shop file. */
  blobs: BlobStore
}

const AI_LS_KEY = 'cabinet-studio-ai-keys'

function browserAi(): AiBridge {
  const read = (): Partial<Record<AiProviderId, string>> => {
    try {
      return JSON.parse(localStorage.getItem(AI_LS_KEY) ?? '{}')
    } catch {
      return {}
    }
  }
  const status = (): AiKeyStatus => Object.fromEntries(AI_PROVIDERS.map((p) => [p.id, { saved: !!read()[p.id], where: 'this browser (not encrypted)' }])) as AiKeyStatus
  return {
    status: async () => status(),
    async setKey(provider, key) {
      const keys = read()
      if (key?.trim()) keys[provider] = key.trim()
      else delete keys[provider]
      localStorage.setItem(AI_LS_KEY, JSON.stringify(keys))
      return status()
    },
    call: (c) => callProvider(c, read()[c.provider] ?? ''),
  }
}

const LS_KEY = 'cabinet-studio-data-v1'

function download(name: string, data: string | Uint8Array | Blob, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Browser preview: model data in IndexedDB (this browser only). */
function indexedDbBlobs(): BlobStore {
  let db: Promise<IDBDatabase> | null = null
  const open = () =>
    (db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open('cabinet-studio-blobs', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('blobs')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    }))
  const run = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
    const s = (await open()).transaction('blobs', mode).objectStore('blobs')
    return new Promise<T>((resolve, reject) => {
      const r = fn(s)
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
  }
  return {
    has: async (h) => (await run('readonly', (s) => s.count(h))) > 0,
    get: async (h) => ((await run('readonly', (s) => s.get(h))) as Uint8Array | undefined) ?? null,
    put: async (h, gz) => void (await run('readwrite', (s) => s.put(gz, h))),
  }
}

function browserBackend(): Backend {
  return {
    kind: 'browser',
    blobs: indexedDbBlobs(),
    ai: browserAi(),
    async load() {
      const raw = localStorage.getItem(LS_KEY)
      return raw ? (JSON.parse(raw) as AppData) : null
    },
    async save(data) {
      localStorage.setItem(LS_KEY, JSON.stringify(data))
    },
    async location() {
      return 'Browser local storage (development preview)'
    },
    async exportFiles(files, opts) {
      const zip = new JSZip()
      const folder = zip.folder(opts.subfolder)!
      for (const f of files) folder.file(f.name, f.data)
      download(`${opts.subfolder}.zip`, await zip.generateAsync({ type: 'blob' }))
      return `${opts.subfolder}.zip (downloaded)`
    },
    async saveFile(file) {
      download(file.name, file.data)
      return `${file.name} (downloaded)`
    },
  }
}

function desktopBackend(b: Bridge): Backend {
  return {
    kind: 'desktop',
    blobs: { has: (h) => b.blobHas(h), get: (h) => b.blobGet(h), put: async (h, gz) => void (await b.blobPut(h, gz)) },
    async load() {
      const raw = await b.load()
      return raw ? (JSON.parse(raw) as AppData) : null
    },
    async save(data) {
      await b.save(JSON.stringify(data, null, 1))
    },
    async location() {
      return (await b.info()).dataFile
    },
    exportFiles: (files, opts) => b.exportFiles(files, opts),
    saveFile: (file, filters) => b.saveFile(file, filters),
    async openPath(p) {
      await b.openPath(p)
    },
    batch: {
      pickFolder: (t) => b.pickFolder(t),
      start: (cfg) => b.batchStart(cfg),
      stop: () => b.batchStop(),
      cancel: () => b.batchCancel(),
      status: () => b.batchStatus(),
      onEvent: (cb) => b.onBatchEvent(cb),
    },
    storage: {
      status: () => b.storageStatus(),
      set: (k) => b.storageSet(k),
      exportDb: (d) => b.storageExportDb(JSON.stringify(d)),
      importDb: async () => {
        const r = await b.storageImportDb()
        return r ? { file: r.file, data: JSON.parse(r.json) as AppData } : null
      },
    },
    ai: { status: () => b.aiKeyStatus(), setKey: (p, k) => b.aiSetKey(p, k), call: (c) => b.aiCall(c) },
    plugins: { read: (p, g) => b.pluginRead(p, g), write: (p, t, g) => b.pluginWrite(p, t, g), list: (p, g) => b.pluginList(p, g), fetch: (u, i, g) => b.pluginFetch(u, i, g) },
  }
}

export const backend: Backend = typeof window !== 'undefined' && window.cabinetStudio ? desktopBackend(window.cabinetStudio) : browserBackend()
