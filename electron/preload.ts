import { contextBridge, ipcRenderer } from 'electron'

type OutFile = { name: string; data: string | Uint8Array }

contextBridge.exposeInMainWorld('cabinetStudio', {
  load: (): Promise<string | null> => ipcRenderer.invoke('data:load'),
  save: (json: string): Promise<boolean> => ipcRenderer.invoke('data:save', json),
  blobHas: (hash: string): Promise<boolean> => ipcRenderer.invoke('blob:has', hash),
  blobGet: (hash: string): Promise<Uint8Array | null> => ipcRenderer.invoke('blob:get', hash),
  blobPut: (hash: string, gz: Uint8Array): Promise<boolean> => ipcRenderer.invoke('blob:put', hash, gz),
  storageStatus: () => ipcRenderer.invoke('storage:status'),
  storageSet: (kind: string) => ipcRenderer.invoke('storage:set', kind),
  storageExportDb: (json: string): Promise<string | null> => ipcRenderer.invoke('storage:exportDb', json),
  storageImportDb: () => ipcRenderer.invoke('storage:importDb'),
  info: (): Promise<{ dataFile: string; version: string; platform: string }> => ipcRenderer.invoke('app:info'),
  exportFiles: (files: OutFile[], opts: { folder?: string; subfolder?: string }): Promise<string | null> =>
    ipcRenderer.invoke('files:export', files, opts),
  existingFiles: (folder: string, names: string[]): Promise<string[]> => ipcRenderer.invoke('files:existing', folder, names),
  saveFile: (file: OutFile, filters: { name: string; extensions: string[] }[]): Promise<string | null> =>
    ipcRenderer.invoke('files:save', file, filters),
  openPath: (p: string): Promise<string> => ipcRenderer.invoke('shell:open', p),
  pickFolder: (title: string): Promise<string | null> => ipcRenderer.invoke('dialog:pickFolder', title),
  batchStart: (cfg: { inbox: string; outbox: string }) => ipcRenderer.invoke('batch:start', cfg),
  batchStop: () => ipcRenderer.invoke('batch:stop'),
  batchCancel: () => ipcRenderer.invoke('batch:cancel'),
  batchStatus: () => ipcRenderer.invoke('batch:status'),
  aiKeyStatus: () => ipcRenderer.invoke('ai:status'),
  aiSetKey: (provider: string, key: string | null) => ipcRenderer.invoke('ai:setKey', provider, key),
  aiCall: (call: unknown): Promise<string> => ipcRenderer.invoke('ai:call', call),
  pluginRead: (p: string, grants: unknown): Promise<string> => ipcRenderer.invoke('plugin:read', p, grants),
  pluginWrite: (p: string, text: string, grants: unknown): Promise<void> => ipcRenderer.invoke('plugin:write', p, text, grants),
  pluginList: (p: string, grants: unknown): Promise<string[]> => ipcRenderer.invoke('plugin:list', p, grants),
  pluginFetch: (url: string, init: unknown, grants: unknown): Promise<string> => ipcRenderer.invoke('plugin:fetch', url, init, grants),
  onBatchEvent: (cb: (ev: unknown) => void) => {
    const h = (_e: unknown, ev: unknown) => cb(ev)
    ipcRenderer.on('batch:event', h)
    return () => void ipcRenderer.removeListener('batch:event', h)
  },
})
