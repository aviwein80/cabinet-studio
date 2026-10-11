/**
 * Job-1: change the materials of a whole job (or a chosen set of cabinets) in one step.
 *
 * The owner picks, per role, a new board (carcass, fronts, backs, drawer boxes) and, per group, a new
 * edgeband (carcass front edges, shelf fronts, doors and drawer fronts); anything left at "keep as is"
 * is not touched. A cabinet stores these as its own settings (`CarcassParams`), so the change is
 * written there, cabinet by cabinet.
 *
 * Which part belongs to which role is not guessed from part names: each cabinet is generated once with
 * a stand-in material per role (same thickness as the real one) and a stand-in band per group, and the
 * stand-in each part comes out with is its role. A part's own material or band set by hand in the
 * cabinet editor (an override) is kept, unless the owner ticks "also replace part overrides": the
 * override on a part of a changed role (or an edge of a changed group) is then removed, so the part
 * follows the new choice.
 *
 * Every change is recorded (cabinet, setting, before, after) so one undo puts them all back; a setting
 * changed again since is left as it is.
 */
import { buildCabinet, generateCarcass } from './construction/carcass'
import { drawerBoard } from './defaults'
import { EPS } from './geometry'
import { expandJob } from './cutlist'
import { nestJob } from './machining'
import { segmentOf, arrangeCabinets, placementOf, DEFAULT_ROOM, type Segment } from './room'
import type { AnyEdgeKey, AppData, CabinetInstance, CarcassParams, Job, Library, Material, Part } from './types'

export type MaterialRole = 'carcass' | 'fronts' | 'backs' | 'boxes'
export const MATERIAL_ROLES: MaterialRole[] = ['carcass', 'fronts', 'backs', 'boxes']
export const MATERIAL_ROLE_LABEL: Record<MaterialRole, string> = {
  carcass: 'Carcass',
  fronts: 'Fronts (doors and drawer fronts)',
  backs: 'Backs',
  boxes: 'Drawer boxes',
}

export type BandGroup = 'carcassFront' | 'shelfFront' | 'door'
export const BAND_GROUPS: BandGroup[] = ['carcassFront', 'shelfFront', 'door']
export const BAND_GROUP_LABEL: Record<BandGroup, string> = {
  carcassFront: 'Carcass front edges',
  shelfFront: 'Shelf fronts',
  door: 'Doors and drawer fronts',
}

export interface MaterialSwap {
  /** New board per role; a role not listed is kept as is. */
  materials: Partial<Record<MaterialRole, string>>
  /** New band per group (null = no band); a group not listed is kept as is. */
  edgebands: Partial<Record<BandGroup, string | null>>
  /** The cabinets changed: every cabinet in the job, or these ids. */
  scope: 'all' | string[]
  /** Also remove the parts' own materials and bands (set by hand) on the roles and groups changed. */
  replaceOverrides: boolean
}

/** One setting changed on one cabinet: `path` below the cabinet (e.g. params.doorMaterialId). */
export interface SwapChange {
  cabinetId: string
  path: string[]
  before: unknown
  after: unknown
}

export interface SwapUndo {
  jobId: string
  changes: SwapChange[]
}

const ROLE_FIELD: Record<Exclude<MaterialRole, 'boxes'>, 'carcassMaterialId' | 'doorMaterialId' | 'backMaterialId'> = {
  carcass: 'carcassMaterialId',
  fronts: 'doorMaterialId',
  backs: 'backMaterialId',
}

const PROBE_MAT = (r: MaterialRole) => `__job1-material:${r}`
const PROBE_BAND = (g: BandGroup) => `__job1-band:${g}`

/** The drawer boxes' board as the generator picks it: the cabinet's own, else the drawer-box board, else the carcass board. */
function boxBoardOf(p: CarcassParams, lib: Library): string {
  const chosen = p.drawers.boxMaterialId ? lib.materials.find((m) => m.id === p.drawers.boxMaterialId) : undefined
  return chosen?.id ?? drawerBoard(lib)?.id ?? p.carcassMaterialId
}

/** Board ids per role a cabinet uses now (boxes: the board the boxes are really made of). */
export function rolesOf(p: CarcassParams, lib: Library): Record<MaterialRole, string> {
  return { carcass: p.carcassMaterialId, fronts: p.doorMaterialId, backs: p.backMaterialId, boxes: boxBoardOf(p, lib) }
}

export interface PartRoles {
  /** Part key -> the role its board comes from (absent: a fixed board, e.g. none today). */
  material: Map<string, MaterialRole>
  /** Part key -> edge -> the band group it comes from. */
  edges: Map<string, Partial<Record<AnyEdgeKey, BandGroup>>>
}

/**
 * Generate the cabinet with stand-in boards (same thicknesses) and bands, and read back which role
 * and group each part and edge comes from. Overrides are not applied (they are what is being sorted).
 */
export function partRoles(cab: Pick<CabinetInstance, 'params' | 'pin'>, lib: Library): PartRoles {
  const p = cab.params
  const real = rolesOf(p, lib)
  const thick = (id: string, fallback: number) => lib.materials.find((m) => m.id === id)?.thickness ?? fallback
  const fallback: Record<MaterialRole, number> = { carcass: 18, fronts: 18, backs: 6, boxes: thick(p.carcassMaterialId, 18) }
  const probeMats: Material[] = MATERIAL_ROLES.map((r) => ({ id: PROBE_MAT(r), code: r, name: r, thickness: thick(real[r], fallback[r]), sheetLength: 3658, sheetWidth: 1524, grain: false, color: '#000' }))
  const probeLib: Library = { ...lib, materials: [...lib.materials, ...probeMats] }
  const probe: CarcassParams = {
    ...p,
    carcassMaterialId: PROBE_MAT('carcass'),
    doorMaterialId: PROBE_MAT('fronts'),
    backMaterialId: PROBE_MAT('backs'),
    drawers: { ...p.drawers, boxMaterialId: PROBE_MAT('boxes') },
    edgebands: { carcassFront: PROBE_BAND('carcassFront'), shelfFront: PROBE_BAND('shelfFront'), door: PROBE_BAND('door') },
  }
  const g = generateCarcass(probe, probeLib, cab.pin)
  const material = new Map<string, MaterialRole>()
  const edges = new Map<string, Partial<Record<AnyEdgeKey, BandGroup>>>()
  for (const part of g.parts) {
    const r = MATERIAL_ROLES.find((x) => PROBE_MAT(x) === part.materialId)
    if (r) material.set(part.key, r)
    const e: Partial<Record<AnyEdgeKey, BandGroup>> = {}
    for (const [k, id] of Object.entries(part.edges) as [AnyEdgeKey, string | null | undefined][]) {
      const grp = BAND_GROUPS.find((x) => PROBE_BAND(x) === id)
      if (grp) e[k] = grp
    }
    edges.set(part.key, e)
  }
  return { material, edges }
}

// ---------------------------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------------------------

function getPath(o: unknown, path: string[]): unknown {
  let cur = o as Record<string, unknown> | undefined
  for (const k of path) {
    if (cur === undefined || cur === null || typeof cur !== 'object') return undefined
    cur = cur[k] as Record<string, unknown> | undefined
  }
  return cur
}

/** Set (or, for undefined, delete) a value, making the objects on the way. */
function setPath(o: Record<string, unknown>, path: string[], v: unknown) {
  let cur = o
  for (const k of path.slice(0, -1)) {
    if (cur[k] === undefined || cur[k] === null || typeof cur[k] !== 'object') cur[k] = {}
    cur = cur[k] as Record<string, unknown>
  }
  const last = path[path.length - 1]
  if (v === undefined) delete cur[last]
  else cur[last] = v
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Remove override entries emptied by the change (an override with nothing left in it). */
function tidyOverrides(cab: CabinetInstance) {
  for (const [key, ov] of Object.entries(cab.overrides)) {
    if (ov.edges && Object.keys(ov.edges).length === 0) delete ov.edges
    if (Object.keys(ov).length === 0) delete cab.overrides[key]
  }
}

function inScope(swap: Pick<MaterialSwap, 'scope'>, id: string) {
  return swap.scope === 'all' || swap.scope.includes(id)
}

/** Nothing to change: every role and group kept. */
export function swapIsEmpty(swap: Pick<MaterialSwap, 'materials' | 'edgebands'>) {
  return Object.keys(swap.materials).length === 0 && Object.keys(swap.edgebands).length === 0
}

/**
 * The settings the swap changes, cabinet by cabinet (nothing is changed). A role or group set to the
 * value a cabinet already has is no change on that cabinet.
 */
export function planSwap(job: Pick<Job, 'cabinets'>, swap: MaterialSwap, lib: Library): SwapChange[] {
  const changes: SwapChange[] = []
  for (const cab of job.cabinets) {
    if (!inScope(swap, cab.id)) continue
    const add = (path: string[], after: unknown) => {
      const before = getPath(cab, path)
      if (!same(before, after)) changes.push({ cabinetId: cab.id, path, before, after })
    }
    for (const r of ['carcass', 'fronts', 'backs'] as const) {
      const id = swap.materials[r]
      if (id !== undefined) add(['params', ROLE_FIELD[r]], id)
    }
    const box = swap.materials.boxes
    const needRoles = box !== undefined || swap.replaceOverrides
    const roles = needRoles ? partRoles(cab, lib) : null
    // only a cabinet with drawer boxes takes the drawer-box board; the box board is what the boxes
    // really use, so no change when that is already the board picked
    if (box !== undefined && [...roles!.material.values()].includes('boxes') && boxBoardOf(cab.params, lib) !== box) add(['params', 'drawers', 'boxMaterialId'], box)
    for (const g of BAND_GROUPS) if (g in swap.edgebands) add(['params', 'edgebands', g], swap.edgebands[g] ?? null)
    if (!swap.replaceOverrides || !roles) continue
    for (const [key, ov] of Object.entries(cab.overrides)) {
      const r = roles.material.get(key)
      if (ov.materialId !== undefined && r && swap.materials[r] !== undefined) changes.push({ cabinetId: cab.id, path: ['overrides', key, 'materialId'], before: ov.materialId, after: undefined })
      const groups = roles.edges.get(key) ?? {}
      for (const [k, v] of Object.entries(ov.edges ?? {}) as [AnyEdgeKey, string | null | undefined][]) {
        const grp = groups[k]
        if (grp && grp in swap.edgebands) changes.push({ cabinetId: cab.id, path: ['overrides', key, 'edges', k], before: v, after: undefined })
      }
    }
  }
  return changes
}

/** Apply a list of changes to a copy of the cabinets. */
function applyChanges(cabinets: CabinetInstance[], changes: SwapChange[], pick: 'after' | 'before'): CabinetInstance[] {
  const out = JSON.parse(JSON.stringify(cabinets)) as CabinetInstance[]
  for (const c of changes) {
    const cab = out.find((x) => x.id === c.cabinetId)
    if (cab) setPath(cab as unknown as Record<string, unknown>, c.path, c[pick])
  }
  for (const cab of out) tidyOverrides(cab)
  return out
}

/** Apply the swap: the job's new cabinets and the undo record. */
export function applySwap(job: Job, swap: MaterialSwap, lib: Library): { cabinets: CabinetInstance[]; undo: SwapUndo } {
  const changes = planSwap(job, swap, lib)
  return { cabinets: applyChanges(job.cabinets, changes, 'after'), undo: { jobId: job.id, changes } }
}

/**
 * Undo a swap in one step: every setting still at the value the swap gave it goes back. A setting
 * changed again since (or a cabinet removed) is left as it is and counted in `skipped`.
 */
export function undoSwap(job: Pick<Job, 'cabinets'>, undo: SwapUndo): { cabinets: CabinetInstance[]; reverted: number; skipped: number } {
  const live: SwapChange[] = []
  let skipped = 0
  for (const c of undo.changes) {
    const cab = job.cabinets.find((x) => x.id === c.cabinetId)
    if (cab && same(getPath(cab, c.path), c.after)) live.push(c)
    else skipped++
  }
  return { cabinets: applyChanges(job.cabinets, live, 'before'), reverted: live.length, skipped }
}

// ---------------------------------------------------------------------------------------------
// Scope helpers
// ---------------------------------------------------------------------------------------------

export type WallChoice = Segment | 'none'
export const WALL_LABEL: Record<WallChoice, string> = { back: 'Back wall', left: 'Left wall', right: 'Right wall', none: 'Not on a wall' }

/** The wall each cabinet stands on in the room (its own placement, else where Arrange puts it). */
export function cabinetWalls(job: Pick<Job, 'cabinets' | 'room'>, lib?: Library): Record<string, WallChoice> {
  const room = { ...DEFAULT_ROOM, ...(job.room ?? {}) }
  const laid = arrangeCabinets(job.cabinets, room, lib)
  const out: Record<string, WallChoice> = {}
  for (const c of job.cabinets) out[c.id] = segmentOf(c, placementOf(c, laid), room) ?? 'none'
  return out
}

// ---------------------------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------------------------

export interface PartChange {
  cabinetId: string
  cabinetNumber: string
  cabinetName: string
  qty: number
  key: string
  name: string
  before: { materialId: string; edges: Part['edges']; size: [number, number, number] }
  after: { materialId: string; edges: Part['edges']; size: [number, number, number] }
  materialChanged: boolean
  edgesChanged: boolean
  sizeChanged: boolean
}

export interface SwapPreview {
  changes: SwapChange[]
  cabinets: number
  parts: PartChange[]
  /** Board changes summed: from -> to, how many parts (copies counted). */
  boards: { from: string; to: string; parts: number }[]
  /** Sheets the automatic nest needs, before and after (an estimate: a hand layout is not used). */
  sheets: { before: number; after: number; byMaterial: { materialId: string; before: number; after: number }[] }
  /** Warnings the change brings (construction checks, thickness, TANDEM sides, parts that fit no sheet). */
  newWarnings: string[]
  /** Warnings the change clears. */
  clearedWarnings: string[]
  /** Parts keeping a material or band set by hand on a role or group being changed. */
  keptOverrides: { cabinetNumber: string; part: string; what: 'material' | 'band' }[]
  /** Parts on the hand-saved layout whose board changes: flagged and nested again on the new board. */
  savedLayoutParts: number
}

const sizeOf = (p: Part): [number, number, number] => [p.length, p.width, p.thickness]

function constructionWarnings(job: Job, data: Pick<AppData, 'library' | 'settings'>) {
  return expandJob(job, data.library, data.settings).warnings
}

export function previewSwap(job: Job, swap: MaterialSwap, data: Pick<AppData, 'library' | 'machine' | 'settings'>): SwapPreview {
  const lib = data.library
  const { cabinets, undo } = applySwap(job, swap, lib)
  const after: Job = { ...job, cabinets }
  const parts: PartChange[] = []
  const boards = new Map<string, number>()
  const keptOverrides: SwapPreview['keptOverrides'] = []
  const units = data.settings.units
  for (const cab of job.cabinets) {
    if (!inScope(swap, cab.id)) continue
    const next = cabinets.find((c) => c.id === cab.id)!
    const a = buildCabinet(cab, lib, units).parts
    const b = new Map(buildCabinet(next, lib, units).parts.map((p) => [p.key, p]))
    for (const p of a) {
      const q = b.get(p.key)
      if (!q) continue
      const materialChanged = p.materialId !== q.materialId
      const edgesChanged = !same(p.edges, q.edges)
      const sizeChanged = sizeOf(p).some((v, i) => Math.abs(v - sizeOf(q)[i]) > EPS)
      if (!materialChanged && !edgesChanged && !sizeChanged) continue
      const qty = Math.max(1, cab.qty)
      parts.push({ cabinetId: cab.id, cabinetNumber: cab.number, cabinetName: cab.name, qty, key: p.key, name: p.name, before: { materialId: p.materialId, edges: p.edges, size: sizeOf(p) }, after: { materialId: q.materialId, edges: q.edges, size: sizeOf(q) }, materialChanged, edgesChanged, sizeChanged })
      if (materialChanged) boards.set(`${p.materialId}\n${q.materialId}`, (boards.get(`${p.materialId}\n${q.materialId}`) ?? 0) + qty)
    }
    if (!swap.replaceOverrides) {
      const roles = partRoles(cab, lib)
      const name = (key: string) => a.find((p) => p.key === key)?.name ?? key
      for (const [key, ov] of Object.entries(cab.overrides)) {
        if (ov.exclude) continue
        const r = roles.material.get(key)
        if (ov.materialId !== undefined && r && swap.materials[r] !== undefined) keptOverrides.push({ cabinetNumber: cab.number, part: name(key), what: 'material' })
        const groups = roles.edges.get(key) ?? {}
        if (Object.keys(ov.edges ?? {}).some((k) => { const grp = groups[k as AnyEdgeKey]; return !!grp && grp in swap.edgebands })) keptOverrides.push({ cabinetNumber: cab.number, part: name(key), what: 'band' })
      }
    }
  }
  // sheets: the automatic nest of the whole job, before and after
  const instA = expandJob(job, lib, data.settings).instances
  const instB = expandJob(after, lib, data.settings).instances
  const nestA = nestJob(instA, lib, data.machine, data.settings)
  const nestB = nestJob(instB, lib, data.machine, data.settings)
  const count = (n: typeof nestA) => {
    const m = new Map<string, number>()
    for (const s of n.sheets) m.set(s.materialId, (m.get(s.materialId) ?? 0) + 1)
    return m
  }
  const ca = count(nestA)
  const cb = count(nestB)
  const mats = [...new Set([...ca.keys(), ...cb.keys()])].sort()
  const unplacedText = (n: typeof nestA, inst: typeof instA) => n.unplaced.map((u) => {
    const i = inst.find((x) => x.uid === u.uid)
    return `${i?.cabinetNumber ?? ''} ${i?.part.name ?? u.uid}: not nested (${u.reason}).`
  })
  const wa = [...constructionWarnings(job, data), ...unplacedText(nestA, instA)]
  const wb = [...constructionWarnings(after, data), ...unplacedText(nestB, instB)]
  const changedUids = new Set(instB.filter((i) => instA.find((x) => x.uid === i.uid)?.materialId !== i.materialId).map((i) => i.uid))
  const savedLayoutParts = job.nestEdit ? job.nestEdit.sheets.reduce((n, s) => n + s.placements.filter((p) => changedUids.has(p.uid)).length, 0) : 0
  return {
    changes: undo.changes,
    cabinets: new Set(undo.changes.map((c) => c.cabinetId)).size,
    parts,
    boards: [...boards.entries()].map(([k, n]) => ({ from: k.split('\n')[0], to: k.split('\n')[1], parts: n })),
    sheets: { before: nestA.sheets.length, after: nestB.sheets.length, byMaterial: mats.map((m) => ({ materialId: m, before: ca.get(m) ?? 0, after: cb.get(m) ?? 0 })) },
    newWarnings: [...new Set(wb.filter((w) => !wa.includes(w)))],
    clearedWarnings: [...new Set(wa.filter((w) => !wb.includes(w)))],
    keptOverrides,
    savedLayoutParts,
  }
}

/** Polish of the picker: a board's note for the drawer-box role (Blum TANDEM takes sides up to 16 mm). */
export function boxBoardNote(m: Pick<Material, 'thickness'>, maxSide: number): string | null {
  return m.thickness > maxSide + 0.01 ? `over the ${maxSide} mm TANDEM side limit` : null
}
