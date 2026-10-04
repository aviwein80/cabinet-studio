/**
 * Storage and file-system access. Inside Electron everything goes through the preload bridge
 * (local JSON file in the user's AppData folder, native folder pickers). In a plain browser
 * (used for development previews) it falls back to localStorage and downloads.
 */
import JSZip from 'jszip'
import type { AppData } from '@/core/types'

import type { OutFile } from '@/core/output'
export type { OutFile }

interface Bridge {
  load(): Promise<string | null>
  save(json: string): Promise<boolean>
  info(): Promise<{ dataFile: string; version: string; platform: string }>
  exportFiles(files: OutFile[], opts: { folder?: string; subfolder?: string }): Promise<string | null>
  saveFile(file: OutFile, filters: { name: string; extensions: string[] }[]): Promise<string | null>
  openPath(p: string): Promise<string>
  pickFolder(title: string): Promise<string | null>
  batchStart(cfg: { inbox: string; outbox: string }): Promise<BatchStatus>
  batchStop(): Promise<BatchStatus>
  batchCancel(): Promise<BatchStatus>
  batchStatus(): Promise<BatchStatus>
  onBatchEvent(cb: (ev: BatchEvent) => void): () => void
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

function browserBackend(): Backend {
  return {
    kind: 'browser',
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
  }
}

export const backend: Backend = typeof window !== 'undefined' && window.cabinetStudio ? desktopBackend(window.cabinetStudio) : browserBackend()
