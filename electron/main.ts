import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const DEV_URL = process.env.VITE_DEV_SERVER_URL
const MAX_BACKUPS = 30
const BACKUP_INTERVAL_MS = 10 * 60 * 1000

const dataDir = () => path.join(app.getPath('userData'), 'data')
const dataFile = () => path.join(dataDir(), 'cabinet-studio.json')
const backupDir = () => path.join(dataDir(), 'backups')

let lastBackup = 0

function writeAtomic(file: string, contents: string | Uint8Array) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, contents)
  fs.renameSync(tmp, file)
}

function rotateBackups() {
  if (!fs.existsSync(dataFile()) || Date.now() - lastBackup < BACKUP_INTERVAL_MS) return
  lastBackup = Date.now()
  fs.mkdirSync(backupDir(), { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  fs.copyFileSync(dataFile(), path.join(backupDir(), `cabinet-studio-${stamp}.json`))
  const files = fs.readdirSync(backupDir()).filter((f) => f.endsWith('.json')).sort()
  for (const f of files.slice(0, Math.max(0, files.length - MAX_BACKUPS))) fs.unlinkSync(path.join(backupDir(), f))
}

type OutFile = { name: string; data: string | Uint8Array }

const safeFileName = (n: string) => path.basename(n).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')

function registerIpc() {
  ipcMain.handle('data:load', () => {
    if (!fs.existsSync(dataFile())) return null
    return fs.readFileSync(dataFile(), 'utf8')
  })

  ipcMain.handle('data:save', (_e, json: string) => {
    rotateBackups()
    writeAtomic(dataFile(), json)
    return true
  })

  ipcMain.handle('app:info', () => ({ dataFile: dataFile(), version: app.getVersion(), platform: process.platform }))

  ipcMain.handle('files:export', async (e, files: OutFile[], opts: { folder?: string; subfolder?: string }) => {
    let folder = opts.folder && fs.existsSync(opts.folder) ? opts.folder : undefined
    if (!folder) {
      const win = BrowserWindow.fromWebContents(e.sender)
      const res = await dialog.showOpenDialog(win!, { title: 'Choose output folder', properties: ['openDirectory', 'createDirectory'] })
      if (res.canceled || !res.filePaths[0]) return null
      folder = res.filePaths[0]
    }
    const target = opts.subfolder ? path.join(folder, safeFileName(opts.subfolder)) : folder
    fs.mkdirSync(target, { recursive: true })
    for (const f of files) writeAtomic(path.join(target, safeFileName(f.name)), typeof f.data === 'string' ? f.data : Buffer.from(f.data))
    return target
  })

  ipcMain.handle('files:save', async (e, file: OutFile, filters: { name: string; extensions: string[] }[]) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const res = await dialog.showSaveDialog(win!, { defaultPath: safeFileName(file.name), filters })
    if (res.canceled || !res.filePath) return null
    writeAtomic(res.filePath, typeof file.data === 'string' ? file.data : Buffer.from(file.data))
    return res.filePath
  })

  ipcMain.handle('shell:open', (_e, p: string) => shell.openPath(p))
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    title: 'Cabinet Studio',
    backgroundColor: '#f6f5f2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  if (DEV_URL) win.loadURL(DEV_URL)
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
      { role: 'windowMenu' },
    ]),
  )
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
