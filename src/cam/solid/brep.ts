/**
 * Loading the OpenCascade B-rep kernel (M3.1g) on first use: the full modelling build of
 * OpenCascade Technology compiled to WebAssembly (`replicad-opencascadejs` 1.1.0, LGPL-2.1, about
 * 23 MB). The solid reader (`occt.ts`, occt-import-js) gives faces as triangles only; this kernel
 * keeps each face's true surface, so a face's own rows and columns (its parameter lines) can be
 * followed on an imported solid.
 *
 * The two files are shipped unmodified next to the app (`vendor/opencascade-brep/`): the emscripten
 * script and its WebAssembly. They are never part of the start-up bundle, are fetched only the
 * first time a face's rows and columns are asked for, work offline, and anyone can replace them
 * with another build of the same library.
 *
 * Only ever load it in a worker: its script makes small functions at run time (`new Function`),
 * which the page's security policy forbids and the worker allows.
 *
 * Tests and other Node programs register their own loader with `setBrepLoader`.
 */

/** The parts of the kernel's API this app uses (names as the build exports them). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BrepKernel = any

export type BrepLoader = () => Promise<BrepKernel>

/** Folder (URL ending in '/') holding the kernel's files, relative to the app's page. */
export const BREP_VENDOR_DIR = 'vendor/opencascade-brep/'
/** The kernel's files, as published (unmodified). */
export const BREP_FILES = { script: 'replicad_single.js', wasm: 'replicad_single.wasm' }

let loader: BrepLoader | null = null
let loaded: Promise<BrepKernel> | null = null
let loadedFrom: string | null = null

/** Use this loader from now on (tests, Node scripts). */
export function setBrepLoader(l: BrepLoader | null) {
  loader = l
  loaded = null
  loadedFrom = null
}

const quiet = () => {}

/** Loader for the browser and the desktop app (inside a worker): the files under `base` (an absolute URL). */
export function vendorBrepLoader(base: string): BrepLoader {
  return async () => {
    const mod = (await import(/* @vite-ignore */ `${base}${BREP_FILES.script}`)) as { default?: (m: object) => Promise<BrepKernel> }
    if (typeof mod.default !== 'function') throw new Error(`The B-rep kernel did not load (${BREP_VENDOR_DIR}${BREP_FILES.script}).`)
    return mod.default({ print: quiet, printErr: quiet, locateFile: (p: string) => `${base}${p}` })
  }
}

/**
 * The kernel, loaded once per worker. `base`: where its files are (sent by the page); ignored when
 * a loader was registered with `setBrepLoader`.
 */
export function brepKernel(base?: string): Promise<BrepKernel> {
  if (loaded && (loader || loadedFrom === (base ?? null))) return loaded
  const l = loader ?? (base ? vendorBrepLoader(base) : null)
  if (!l) throw new Error('The B-rep kernel is not available here.')
  if (!loader && typeof document !== 'undefined') throw new Error('The B-rep kernel only runs in the background worker.')
  loadedFrom = base ?? null
  loaded = l()
  loaded.catch(() => {
    loaded = null
  })
  return loaded
}
