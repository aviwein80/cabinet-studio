/**
 * Loading the OpenCascade reader (occt-import-js, LGPL-2.1) on first use.
 *
 * The library is two files shipped unmodified next to the app (`vendor/occt-import-js/`): the
 * emscripten script and its WebAssembly. They are never part of the start-up bundle and are only
 * fetched by the background worker the first time a solid file is read, so anyone can replace
 * them with another build of the same library. The script is loaded without `eval` (the page's
 * security policy forbids it): it registers itself through the AMD `define` hook, which is set up
 * just for that moment.
 *
 * Tests and other Node programs register their own loader with `setOcctLoader`.
 */

/** One mesh of the reader's result (three.js-like buffers, plain number arrays). */
export interface OcctMesh {
  name?: string
  color?: [number, number, number]
  brep_faces: { first: number; last: number; color: [number, number, number] | null }[]
  attributes: { position: { array: ArrayLike<number> }; normal?: { array: ArrayLike<number> } }
  index: { array: ArrayLike<number> }
}

export interface OcctNode {
  name: string
  meshes: number[]
  children: OcctNode[]
}

export interface OcctResult {
  success: boolean
  root: OcctNode
  meshes: OcctMesh[]
}

export interface OcctParams {
  linearUnit: 'millimeter'
  linearDeflectionType: 'absolute_value' | 'bounding_box_ratio'
  linearDeflection: number
  angularDeflection: number
}

export interface OcctModule {
  ReadStepFile(content: Uint8Array, params: OcctParams | null): OcctResult
  ReadIgesFile(content: Uint8Array, params: OcctParams | null): OcctResult
  ReadBrepFile(content: Uint8Array, params: OcctParams | null): OcctResult
}

export type OcctLoader = () => Promise<OcctModule>

/** Folder (URL ending in '/') holding the two library files, relative to the app's page. */
export const OCCT_VENDOR_DIR = 'vendor/occt-import-js/'

let loader: OcctLoader | null = null
let loaded: Promise<OcctModule> | null = null
let loadedFrom: string | null = null

/** Use this loader from now on (tests, Node scripts). */
export function setOcctLoader(l: OcctLoader | null) {
  loader = l
  loaded = null
  loadedFrom = null
}

const quiet = () => {}

async function fetchBytes(url: string): Promise<Uint8Array> {
  try {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return new Uint8Array(await r.arrayBuffer())
  } catch (e) {
    // file:// pages cannot use fetch; XMLHttpRequest still reads files there
    if (typeof XMLHttpRequest === 'undefined') throw e
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest()
      x.open('GET', url)
      x.responseType = 'arraybuffer'
      x.onload = () => (x.status === 0 || (x.status >= 200 && x.status < 300) ? resolve(new Uint8Array(x.response as ArrayBuffer)) : reject(new Error(`HTTP ${x.status}`)))
      x.onerror = () => reject(e instanceof Error ? e : new Error(String(e)))
      x.send()
    })
  }
}

/** Loader for the browser and the desktop app: the library files under `base` (an absolute URL). */
export function vendorOcctLoader(base: string): OcctLoader {
  return async () => {
    const g = globalThis as unknown as { define?: unknown }
    const before = g.define
    let factory: ((m: object) => Promise<OcctModule>) | null = null
    const define = (_deps: unknown, make: () => (m: object) => Promise<OcctModule>) => {
      factory = make()
    }
    define.amd = true
    g.define = define
    try {
      await import(/* @vite-ignore */ `${base}occt-import-js.js`)
    } finally {
      g.define = before
    }
    if (!factory) throw new Error('The solid-model reader did not load (vendor/occt-import-js/occt-import-js.js).')
    const wasmBinary = await fetchBytes(`${base}occt-import-js.wasm`)
    return (factory as (m: object) => Promise<OcctModule>)({ wasmBinary, print: quiet, printErr: quiet, locateFile: (p: string) => `${base}${p}` })
  }
}

/**
 * The reader, loaded once per worker. `base`: where the library files are (sent by the page);
 * ignored when a loader was registered with `setOcctLoader`.
 */
export function occt(base?: string): Promise<OcctModule> {
  if (loaded && (loader || loadedFrom === (base ?? null))) return loaded
  const l = loader ?? (base ? vendorOcctLoader(base) : null)
  if (!l) throw new Error('The solid-model reader is not available here.')
  loadedFrom = base ?? null
  loaded = l()
  loaded.catch(() => {
    loaded = null
  })
  return loaded
}
