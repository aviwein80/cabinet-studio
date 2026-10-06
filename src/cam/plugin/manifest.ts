/**
 * Plugin header and grants (M2.10, API-01). The header is read from the comment lines at the top
 * of the file, without running any of the plugin's code, so the owner sees what a plugin is and
 * what it asks for before anything of it runs.
 *
 *   // @plugin       sample-shop-tools        (id: letters, digits, - and _)
 *   // @name         Sample shop tools
 *   // @version      1.0
 *   // @description  What it does.
 *   // @author       Who wrote it
 *   // @read         C:/Shop/Lists             (asks to read files in this folder; one per line)
 *   // @write        C:/Shop/Reports           (asks to write files in this folder)
 *   // @net          prices.example.com        (asks to fetch from this host, https)
 *   // @machine-output                         (its script posts ask to produce machine programs)
 */
import { sha256Hex } from '@/core/sha256'
import { normPath } from './access'
import type { PluginGrants, PluginManifest, PluginRecord } from './types'

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

export function parseManifest(code: string): { manifest: PluginManifest | null; errors: string[] } {
  const errors: string[] = []
  const tags: [string, string][] = []
  for (const raw of code.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const ln = raw.trim()
    if (!ln) continue
    if (!ln.startsWith('//')) break
    const m = /^\/\/\s*@([a-z-]+)\s*(.*)$/.exec(ln)
    if (m) tags.push([m[1], m[2].trim()])
  }
  const one = (k: string) => tags.find(([t]) => t === k)?.[1] ?? ''
  const many = (k: string) => tags.filter(([t]) => t === k).map(([, v]) => v).filter(Boolean)
  const id = one('plugin')
  if (!id) errors.push('The file does not start with a plugin header ("// @plugin your-plugin-id").')
  else if (!ID.test(id)) errors.push(`Plugin id "${id}" may only use letters, digits, "-" and "_" (up to 64).`)
  const requests: PluginGrants = {}
  const read = many('read').map((p) => normPath(p))
  const write = many('write').map((p) => normPath(p))
  if (read.some((p) => !p) || write.some((p) => !p)) errors.push('Folders asked for (@read, @write) must be full paths, such as C:/Shop/Lists.')
  if (read.length) requests.read = read.filter((p): p is string => !!p)
  if (write.length) requests.write = write.filter((p): p is string => !!p)
  const net = many('net').map((h) => h.toLowerCase())
  if (net.some((h) => !/^[a-z0-9.-]+(:\d+)?$/.test(h))) errors.push('Hosts asked for (@net) must be plain host names, such as prices.example.com.')
  if (net.length) requests.net = net
  if (tags.some(([t]) => t === 'machine-output')) requests.machineOutput = true
  if (errors.length) return { manifest: null, errors }
  return {
    manifest: { id, name: one('name') || id, version: one('version') || '0', description: one('description'), ...(one('author') ? { author: one('author') } : {}), requests },
    errors,
  }
}

export const codeHash = (code: string) => sha256Hex(code)

/**
 * A new record for `code`, or an update of `prev`. Grants are kept only while the code is the
 * same; new code starts with nothing granted and switched off, so changed code never inherits
 * access it was not given.
 */
export function pluginRecord(code: string, source: string, now: string, prev?: PluginRecord): PluginRecord {
  const { manifest, errors } = parseManifest(code)
  if (!manifest) throw new Error(errors.join(' '))
  const hash = codeHash(code)
  const same = prev && prev.codeHash === hash
  return {
    id: manifest.id,
    manifest,
    code,
    codeHash: hash,
    enabled: same ? prev.enabled : false,
    grants: same ? prev.grants : {},
    ...(same && prev.contributes ? { contributes: prev.contributes } : {}),
    installedAt: same ? prev.installedAt : now,
    source,
  }
}

/** Requests the owner has not granted (shown on the Plugins screen). */
export function ungranted(r: Pick<PluginRecord, 'manifest' | 'grants'>): string[] {
  const out: string[] = []
  const q = r.manifest.requests
  const g = r.grants
  for (const p of q.read ?? []) if (!(g.read ?? []).includes(p)) out.push(`read files in ${p}`)
  for (const p of q.write ?? []) if (!(g.write ?? []).includes(p)) out.push(`write files in ${p}`)
  for (const h of q.net ?? []) if (!(g.net ?? []).includes(h)) out.push(`fetch from ${h}`)
  if (q.machineOutput && !g.machineOutput) out.push('produce machine programs')
  return out
}

/** Grants limited to what the plugin asked for (the screen only offers those). */
export function limitGrants(r: Pick<PluginRecord, 'manifest'>, g: PluginGrants): PluginGrants {
  const q = r.manifest.requests
  const keep = (list: string[] | undefined, asked: string[] | undefined) => (list ?? []).filter((x) => (asked ?? []).includes(x))
  const out: PluginGrants = {}
  const read = keep(g.read, q.read)
  const write = keep(g.write, q.write)
  const net = keep(g.net, q.net)
  if (read.length) out.read = read
  if (write.length) out.write = write
  if (net.length) out.net = net
  if (g.machineOutput && q.machineOutput) out.machineOutput = true
  return out
}
