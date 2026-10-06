import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { aiCall, aiKeyStatus, aiSetKey } from './aiKeys'
import { collectBlobs } from './blobGc'
import { pluginIpc } from './pluginIo'
import { readDbFile, ShopStore, type StoreKind, writeDbFile } from './shopStore'

const DEV_URL = process.env.VITE_DEV_SERVER_URL
const MAX_BACKUPS = 30
const BACKUP_INTERVAL_MS = 10 * 60 * 1000

const dataDir = () => path.join(app.getPath('userData'), 'data')
const dataFile = () => path.join(dataDir(), 'cabinet-studio.json')
/** JSON (default) or the SQLite option (M2.9); the JSON file is written either way. */
const shopStore = () => new ShopStore(dataDir())
const backupDir = () => path.join(dataDir(), 'backups')
/** 3D model data (gzip files named by the SHA-256 of their content), kept out of the shop file. */
const blobDir = () => path.join(dataDir(), 'blobs')
const BLOB_RE = /^[0-9a-f]{64}$/
const blobFile = (hash: string) => {
  if (!BLOB_RE.test(hash)) throw new Error('Bad model data id.')
  return path.join(blobDir(), `${hash}.bin.gz`)
}
/** Unused model data is kept 30 days before it is removed. */
const BLOB_KEEP_MS = 30 * 24 * 60 * 60 * 1000

let lastBackup = 0

// ---------------------------------------------------------------------------------------------
// The built app is served as app://bundle/... (not file://), so the page, its workers and the
// WebAssembly libraries all load like a normal web origin: fetch works and .wasm files get the
// right type. Files come from dist/ inside the app (the vendor libraries are unpacked next to the
// archive so they can be replaced; reading through the archive path finds them there).
// ---------------------------------------------------------------------------------------------

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])

const APP_URL = 'app://bundle/index.html'
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
}

function serveApp() {
  const root = path.join(__dirname, '..', 'dist')
  protocol.handle('app', (req) => {
    const url = new URL(req.url)
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
    const file = path.normalize(path.join(root, rel))
    if (url.host !== 'bundle' || !file.startsWith(root + path.sep)) return new Response('Not found', { status: 404 })
    try {
      const data = fs.readFileSync(file)
      return new Response(data, { headers: { 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' } })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

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
  ipcMain.handle('data:load', () => shopStore().load())

  ipcMain.handle('data:save', (_e, json: string) => {
    rotateBackups()
    shopStore().save(json)
    return true
  })

  ipcMain.handle('storage:status', () => {
    const st = shopStore()
    return { kind: st.kind(), jsonFile: st.jsonFile, dbFile: st.dbFile }
  })
  ipcMain.handle('storage:set', (_e, kind: StoreKind) => {
    rotateBackups()
    return shopStore().switchTo(kind === 'sqlite' ? 'sqlite' : 'json')
  })
  ipcMain.handle('storage:exportDb', async (e, json: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const res = await dialog.showSaveDialog(win!, { defaultPath: 'cabinet-studio.sqlite', filters: [{ name: 'SQLite database', extensions: ['sqlite', 'db'] }] })
    if (res.canceled || !res.filePath) return null
    writeDbFile(res.filePath, JSON.parse(json))
    return res.filePath
  })
  ipcMain.handle('storage:importDb', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const res = await dialog.showOpenDialog(win!, { title: 'Shop data from a database file', properties: ['openFile'], filters: [{ name: 'SQLite database', extensions: ['sqlite', 'db'] }] })
    if (res.canceled || !res.filePaths[0]) return null
    return { file: res.filePaths[0], json: JSON.stringify(readDbFile(res.filePaths[0])) }
  })

  ipcMain.handle('blob:has', (_e, hash: string) => fs.existsSync(blobFile(hash)))
  ipcMain.handle('blob:get', (_e, hash: string) => {
    const f = blobFile(hash)
    return fs.existsSync(f) ? new Uint8Array(fs.readFileSync(f)) : null
  })
  ipcMain.handle('blob:put', (_e, hash: string, gz: Uint8Array) => {
    const f = blobFile(hash)
    if (!fs.existsSync(f)) writeAtomic(f, Buffer.from(gz))
    return true
  })

  ipcMain.handle('app:info', () => ({ dataFile: shopStore().kind() === 'sqlite' ? shopStore().dbFile : dataFile(), version: app.getVersion(), platform: process.platform }))

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

  ipcMain.handle('dialog:pickFolder', async (e, title: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const res = await dialog.showOpenDialog(win!, { title, properties: ['openDirectory', 'createDirectory'] })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })

  ipcMain.handle('ai:status', () => aiKeyStatus())
  ipcMain.handle('ai:setKey', (_e, id, key: string | null) => aiSetKey(id, key))
  ipcMain.handle('ai:call', (_e, call) => aiCall(call))

  // plugins (M2.10): file and network access, checked again here against the grants
  ipcMain.handle('plugin:read', (_e, p: string, grants) => pluginIpc.read(p, grants))
  ipcMain.handle('plugin:write', (_e, p: string, text: string, grants) => pluginIpc.write(p, text, grants))
  ipcMain.handle('plugin:list', (_e, p: string, grants) => pluginIpc.list(p, grants))
  ipcMain.handle('plugin:fetch', (_e, url: string, init, grants) => pluginIpc.fetch(url, init ?? {}, grants))

  ipcMain.handle('batch:start', (_e, cfg: { inbox: string; outbox: string }) => startBatch(cfg))
  ipcMain.handle('batch:stop', () => stopBatch())
  ipcMain.handle('batch:cancel', () => cancelBatch())
  ipcMain.handle('batch:status', () => batchStatus())
}

// ---------------------------------------------------------------------------------------------
// Batch watcher (worker thread)
// ---------------------------------------------------------------------------------------------

type BatchEvent = { type: 'log'; at: string; msg: string } | { type: 'busy'; csv: string } | { type: 'idle' } | { type: 'state' }

let batch: { worker: Worker; cancel: SharedArrayBuffer; inbox: string; outbox: string; busy: string | null } | null = null
const batchLog: { at: string; msg: string }[] = []

const batchStatus = () => ({ running: !!batch, inbox: batch?.inbox ?? null, outbox: batch?.outbox ?? null, busy: batch?.busy ?? null, log: batchLog.slice(-200) })

function emit(ev: BatchEvent) {
  if (ev.type === 'log') {
    batchLog.push({ at: ev.at, msg: ev.msg })
    if (batchLog.length > 500) batchLog.splice(0, batchLog.length - 500)
  }
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('batch:event', ev)
}

/** The plugin sandbox's WebAssembly (M2.10) for the batch thread: shipped next to the app, or from node_modules in development. */
function quickjsWasm(): Uint8Array | null {
  for (const f of [path.join(__dirname, '..', 'dist', 'vendor', 'quickjs', 'emscripten-module.wasm'), path.join(__dirname, '..', 'node_modules', '@jitl', 'quickjs-wasmfile-release-sync', 'dist', 'emscripten-module.wasm')]) {
    try {
      return new Uint8Array(fs.readFileSync(f))
    } catch {
      // try the next place
    }
  }
  return null
}

function startBatch(cfg: { inbox: string; outbox: string }) {
  if (batch) stopBatch()
  if (!cfg.inbox || !cfg.outbox) return batchStatus()
  const cancel = new SharedArrayBuffer(4)
  const worker = new Worker(path.join(__dirname, 'batchWorker.cjs'), { workerData: { inbox: cfg.inbox, outbox: cfg.outbox, dataFile: dataFile(), cancel, quickjsWasm: quickjsWasm() } })
  const me = { worker, cancel, inbox: cfg.inbox, outbox: cfg.outbox, busy: null as string | null }
  batch = me
  worker.on('message', (ev: BatchEvent) => {
    if (ev.type === 'busy') me.busy = ev.csv
    if (ev.type === 'idle') me.busy = null
    emit(ev)
  })
  worker.on('error', (err) => emit({ type: 'log', at: new Date().toISOString(), msg: `Batch worker error: ${err.message}` }))
  worker.on('exit', () => {
    if (batch === me) batch = null
    emit({ type: 'state' })
  })
  emit({ type: 'state' })
  return batchStatus()
}

function stopBatch() {
  const b = batch
  if (!b) return batchStatus()
  batch = null
  Atomics.store(new Int32Array(b.cancel), 0, 1)
  b.worker.postMessage({ type: 'stop' })
  setTimeout(() => void b.worker.terminate(), 3000)
  emit({ type: 'state' })
  return batchStatus()
}

/** Stop the CSV being processed. If the worker does not stop by itself, it is ended and restarted. */
function cancelBatch() {
  const b = batch
  if (!b?.busy) return batchStatus()
  Atomics.store(new Int32Array(b.cancel), 0, 1)
  const csv = b.busy
  setTimeout(() => {
    if (batch !== b || b.busy !== csv) return
    void b.worker.terminate().then(() => {
      const from = path.join(b.inbox, csv)
      const dir = path.join(b.inbox, 'cancelled')
      fs.mkdirSync(dir, { recursive: true })
      if (fs.existsSync(from)) fs.renameSync(from, path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}_${csv}`))
      emit({ type: 'log', at: new Date().toISOString(), msg: `${csv}: cancelled (worker restarted)` })
      startBatch({ inbox: b.inbox, outbox: b.outbox })
    })
  }, 10_000)
  return batchStatus()
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
  else win.loadURL(APP_URL)
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
  serveApp()
  try {
    collectBlobs({ blobs: blobDir(), dataFile: dataFile(), backups: backupDir() }, BLOB_KEEP_MS)
  } catch {
    // clean-up is best effort; never block start-up
  }
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
