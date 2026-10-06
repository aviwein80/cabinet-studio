/**
 * Loading the plugin sandbox (QuickJS compiled to WebAssembly, MIT) on first use.
 *
 * The WebAssembly file is shipped unmodified next to the app (`vendor/quickjs/`), never in the
 * start-up bundle; the small script that drives it is loaded with it. In the browser and the
 * desktop app the page tells where the file is (`setQuickJsBase`); Node programs (tests, the
 * command-line batch runner) use the installed package directly, and the desktop app's batch
 * thread hands over the file's bytes (`setQuickJsWasm`).
 */
import type { QuickJSWASMModule } from 'quickjs-emscripten-core'

export const QUICKJS_VENDOR_DIR = 'vendor/quickjs/'
export const QUICKJS_WASM = 'emscripten-module.wasm'

let loaded: Promise<QuickJSWASMModule> | null = null
let ready: QuickJSWASMModule | null = null
let wasm: ArrayBuffer | null = null
let base: string | null = null

/** The WebAssembly file's bytes (desktop batch thread). */
export function setQuickJsWasm(bytes: ArrayBuffer | Uint8Array | null) {
  wasm = bytes ? (bytes instanceof Uint8Array ? (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer) : bytes) : null
  loaded = null
  ready = null
}

/** Folder URL (ending in "/") holding `emscripten-module.wasm` (browser and desktop pages, workers). */
export function setQuickJsBase(url: string | null) {
  if (url === base) return
  base = url
  loaded = null
  ready = null
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.arrayBuffer()
}

async function load(): Promise<QuickJSWASMModule> {
  const core = await import('quickjs-emscripten-core')
  const variant = (await import('@jitl/quickjs-wasmfile-release-sync')).default
  const bytes = wasm ?? (base ? await fetchBytes(`${base}${QUICKJS_WASM}`) : null)
  return core.newQuickJSWASMModuleFromVariant(bytes ? core.newVariant(variant, { wasmBinary: bytes }) : variant)
}

/** The sandbox engine, loaded once. */
export function quickjs(): Promise<QuickJSWASMModule> {
  if (loaded) return loaded
  const p = load()
  loaded = p
  p.then(
    (m) => {
      if (loaded === p) ready = m
    },
    () => {
      if (loaded === p) loaded = null
    },
  )
  return p
}

/** The engine if it is loaded already (null before the first `quickjs()` has finished). */
export const quickjsReady = (): QuickJSWASMModule | null => ready

/** Where the page finds the WebAssembly file (sent to workers, which cannot see the page's address). */
export const quickjsPageBase = (): string | undefined => (typeof document !== 'undefined' ? new URL(QUICKJS_VENDOR_DIR, document.baseURI).href : undefined)
