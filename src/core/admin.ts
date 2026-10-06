/**
 * Admin tools (M2.9, AM-13): tool-change order, the missing-recipe report, a password on the shop
 * defaults and hidden screens. The password keeps hands off the defaults on a shared shop PC; it is
 * not security (the data file itself can still be edited), and it never hides a value that needs
 * configuring: locked values stay visible, and unlocking makes them editable again.
 */
import { layerOf, partOutline } from '@/cam/doc'
import { recipesOf, ruleSetsOf } from '@/cam/rules'
import type { CamPart } from '@/cam/types'
import type { AppData, MachineProfile, ShopSettings } from './types'

// ---------------------------------------------------------------------------------------------
// Tool-change order
// ---------------------------------------------------------------------------------------------

/** Tool numbers in the shop's tool-change order: the saved order first, then the rest in table order. */
export function toolOrderOf(m: Pick<MachineProfile, 'tools' | 'toolOrder'>): number[] {
  const all = m.tools.map((t) => t.number)
  const saved = (m.toolOrder ?? []).filter((n, i, a) => all.includes(n) && a.indexOf(n) === i)
  return [...saved, ...all.filter((n) => !saved.includes(n))]
}

/** Move one tool up (-1) or down (+1) in the order. */
export function moveTool(order: number[], n: number, by: -1 | 1): number[] {
  const i = order.indexOf(n)
  const j = i + by
  if (i < 0 || j < 0 || j >= order.length) return order
  const out = [...order]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

// ---------------------------------------------------------------------------------------------
// Missing-recipe report
// ---------------------------------------------------------------------------------------------

export interface RecipeProblem {
  where: string
  problem: string
}

/**
 * Shapes no enabled operation machines, by layer name. The part outline (cut out by the sheet
 * program anyway) and construction layers do not count.
 */
export function unmachinedLayers(p: CamPart): { layer: string; shapes: number }[] {
  const used = new Set(p.ops.filter((o) => o.enabled !== false).flatMap((o) => o.geometry))
  const outline = partOutline(p).entity?.id
  const by = new Map<string, number>()
  for (const e of p.entities) {
    const layer = layerOf(p, e.layer)
    if (used.has(e.id) || e.id === outline || layer?.construction) continue
    const name = layer?.name ?? e.layer
    by.set(name, (by.get(name) ?? 0) + 1)
  }
  return [...by.entries()].map(([layer, shapes]) => ({ layer, shapes }))
}

/**
 * Everything that points at a recipe that is not there, and drawn shapes nothing machines: rules
 * and door styles whose recipe was deleted, empty recipes and rule sets, and custom parts (in jobs
 * and the part library) with shapes on layers no operation uses.
 */
export function missingRecipeReport(d: Pick<AppData, 'library' | 'jobs'>): RecipeProblem[] {
  const lib = d.library
  const recipes = recipesOf(lib)
  const has = (id?: string) => !id || recipes.some((r) => r.id === id)
  const out: RecipeProblem[] = []
  for (const r of recipes) if (!r.ops.length) out.push({ where: `Recipe ${r.name}`, problem: 'has no operations.' })
  for (const s of ruleSetsOf(lib)) {
    if (!s.rules.length) out.push({ where: `Rule set ${s.name}`, problem: 'has no rules.' })
    for (const r of s.rules) if (!has(r.recipeId)) out.push({ where: `Rule set ${s.name}, layer ${r.layer}`, problem: `uses recipe ${r.recipeId}, which no longer exists.` })
  }
  for (const st of lib.doorStyles ?? []) {
    if (!has(st.fieldRecipeId)) out.push({ where: `Door style ${st.name}`, problem: `panel-field recipe ${st.fieldRecipeId} no longer exists.` })
    if (!has(st.outlineRecipeId)) out.push({ where: `Door style ${st.name}`, problem: `outline recipe ${st.outlineRecipeId} no longer exists.` })
  }
  const parts: [string, CamPart][] = [...d.jobs.flatMap((j) => (j.camParts ?? []).map((p) => [`Job ${j.number}, part ${p.name}`, p] as [string, CamPart])), ...(lib.partLibrary ?? []).map((p) => [`Part library, ${p.name}`, p] as [string, CamPart])]
  for (const [where, p] of parts) for (const u of unmachinedLayers(p)) out.push({ where, problem: `${u.shapes} shape${u.shapes === 1 ? '' : 's'} on layer ${u.layer} with no operation.` })
  return out
}

export function recipeReportCsv(rows: RecipeProblem[]) {
  const q = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  return ['Where,Problem', ...rows.map((r) => `${q(r.where)},${q(r.problem)}`)].join('\r\n') + '\r\n'
}

// ---------------------------------------------------------------------------------------------
// Password on the defaults, hidden screens
// ---------------------------------------------------------------------------------------------

export interface AdminLock {
  salt: string
  /** SHA-256 of salt + password, hex. */
  hash: string
}

/** Screens an admin may hide from the side bar (never Jobs or Settings). */
export const HIDEABLE_SCREENS = [
  { id: 'parts', label: 'Custom parts' },
  { id: 'library', label: 'Library' },
  { id: 'batch', label: 'Batch runs' },
  { id: 'machine', label: 'Machine & tools' },
] as const
export type HideableScreen = (typeof HIDEABLE_SCREENS)[number]['id']

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

export async function hashPassword(password: string, salt: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${password}`)))
}

export async function newLock(password: string, salt = hex(crypto.getRandomValues(new Uint8Array(16)).buffer)): Promise<AdminLock> {
  if (password.length < 4) throw new Error('Use at least 4 characters.')
  return { salt, hash: await hashPassword(password, salt) }
}

export async function checkPassword(lock: AdminLock | undefined, password: string): Promise<boolean> {
  return !lock || (await hashPassword(password, lock.salt)) === lock.hash
}

/** True when the defaults are behind a password and this session has not unlocked them. */
export const isLocked = (s: Pick<ShopSettings, 'admin'>, unlocked: boolean) => !!s.admin?.lock && !unlocked

export const hiddenScreens = (s: Pick<ShopSettings, 'admin'>): HideableScreen[] => (s.admin?.hidden ?? []).filter((h): h is HideableScreen => HIDEABLE_SCREENS.some((x) => x.id === h))
