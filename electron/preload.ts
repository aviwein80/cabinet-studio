import { contextBridge, ipcRenderer } from 'electron'

type OutFile = { name: string; data: string | Uint8Array }

contextBridge.exposeInMainWorld('cabinetStudio', {
  load: (): Promise<string | null> => ipcRenderer.invoke('data:load'),
  save: (json: string): Promise<boolean> => ipcRenderer.invoke('data:save', json),
  info: (): Promise<{ dataFile: string; version: string; platform: string }> => ipcRenderer.invoke('app:info'),
  exportFiles: (files: OutFile[], opts: { folder?: string; subfolder?: string }): Promise<string | null> =>
    ipcRenderer.invoke('files:export', files, opts),
  saveFile: (file: OutFile, filters: { name: string; extensions: string[] }[]): Promise<string | null> =>
    ipcRenderer.invoke('files:save', file, filters),
  openPath: (p: string): Promise<string> => ipcRenderer.invoke('shell:open', p),
})
