/**
 * Several machines and process steps (M2.9, AM-08). The shop's own machine stays `AppData.machine`
 * (id "main"); others are `AppData.machines`, each with its own complete profile (tool table,
 * machine model, spoilboard, holders, confirmations) and its own post. A batch run can send the
 * same part list to several of them: each gets its own nest, programs and export check.
 *
 * Posts: the native woodWOP writer (the one MPR path) for every machine today. Script posts for
 * other controllers come with M2.10 (PST-02) and plug in here as another `post.kind`.
 */
import { PLACEHOLDER_MACHINE } from './defaults'
import { PLACEHOLDER_N200_MODEL } from './machineModel'
import type { AppData, MachineProfile, MachineSetup } from './types'

export const MAIN_MACHINE = 'main'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** The main machine first, then the others, as setups. */
export function machineSetups(d: Pick<AppData, 'machine' | 'machines'>): MachineSetup[] {
  return [{ id: MAIN_MACHINE, name: d.machine.name, kind: 'machine', profile: d.machine, post: { kind: 'woodwop-mpr' } }, ...(d.machines ?? [])]
}

export function machineSetup(d: Pick<AppData, 'machine' | 'machines'>, id: string): MachineSetup | undefined {
  return machineSetups(d).find((m) => m.id === id)
}

/** The profile being edited / used: the main machine for "main" or an unknown id. */
export function profileOf(d: Pick<AppData, 'machine' | 'machines'>, id: string | null | undefined): MachineProfile {
  if (!id || id === MAIN_MACHINE) return d.machine
  return d.machines?.find((m) => m.id === id)?.profile ?? d.machine
}

/** The shop data as one machine sees it: the same library, settings and jobs, its own profile. */
export function dataFor(d: AppData, id: string): AppData {
  return id === MAIN_MACHINE ? d : { ...d, machine: profileOf(d, id) }
}

/**
 * A new machine or process step. Its profile starts as a copy of `from` (default: the placeholder
 * N-200), but nothing about the new machine is known yet, so every value is a placeholder again:
 * the tool table and machine model are marked placeholder and no value carries a confirmation.
 */
export function newMachineSetup(d: Pick<AppData, 'machine' | 'machines'>, opts: { name: string; kind?: MachineSetup['kind']; from?: 'main' | 'placeholder'; id?: string }): MachineSetup {
  const base = clone(opts.from === 'main' ? d.machine : PLACEHOLDER_MACHINE)
  const taken = new Set(machineSetups(d).map((m) => m.id))
  let id = opts.id ?? `m-${(opts.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'machine').slice(0, 24)}`
  for (let n = 2; taken.has(id); n++) id = `${id.replace(/-\d+$/, '')}-${n}`
  const profile: MachineProfile = { ...base, name: opts.name, placeholder: true, confirmed: [], physical: { ...clone(base.physical ?? PLACEHOLDER_N200_MODEL), placeholder: true } }
  return { id, name: opts.name, kind: opts.kind ?? 'machine', profile, post: { kind: 'woodwop-mpr' } }
}

/** Folder name for a machine's programs inside an order folder. */
export const machineFolder = (s: Pick<MachineSetup, 'id' | 'name'>) => s.name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || s.id
