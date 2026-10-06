/**
 * Grant checks for plugins (M2.10). Pure functions used by the sandbox before any file or network
 * call, and again by the desktop app's main process on its side.
 */
import type { PluginGrants } from './types'

/**
 * A full path in one form: forward slashes, no "." or ".." parts, no trailing slash; Windows
 * drive letters upper case. Null for relative paths, paths that climb above their root, or
 * anything else that is not a plain full path.
 */
export function normPath(p: string): string | null {
  if (typeof p !== 'string' || !p || p.includes('\0')) return null
  let s = p.trim().replace(/\\/g, '/')
  let root: string
  const drive = /^([A-Za-z]):\//.exec(s)
  if (drive) {
    root = `${drive[1].toUpperCase()}:/`
    s = s.slice(3)
  } else if (s.startsWith('//')) {
    // \\server\share\...
    const m = /^\/\/([^/]+)\/([^/]+)(\/|$)/.exec(s)
    if (!m) return null
    root = `//${m[1]}/${m[2]}/`
    s = s.slice(m[0].length)
  } else if (s.startsWith('/')) {
    root = '/'
    s = s.slice(1)
  } else return null
  const parts: string[] = []
  for (const part of s.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) return null
      parts.pop()
    } else parts.push(part)
  }
  return (root + parts.join('/')).replace(/\/$/, '') || '/'
}

/** Windows paths compare without case (as the file system does). */
const key = (p: string) => (/^[A-Z]:\//.test(p) || p.startsWith('//') ? p.toLowerCase() : p)

/** Is `path` inside (or equal to) one of the folders? Both are normalised first. */
export function inFolders(path: string, folders: readonly string[] | undefined): boolean {
  const p = normPath(path)
  if (!p) return false
  const kp = key(p)
  for (const f of folders ?? []) {
    const n = normPath(f)
    if (!n) continue
    const kf = key(n)
    if (kp === kf || kp.startsWith(kf.endsWith('/') ? kf : `${kf}/`)) return true
  }
  return false
}

export function pathAllowed(g: PluginGrants, path: string, mode: 'read' | 'write'): boolean {
  return inFolders(path, mode === 'read' ? [...(g.read ?? []), ...(g.write ?? [])] : g.write)
}

/** https only, and the URL's host (with its port when not 443) must be granted exactly. */
export function hostAllowed(g: PluginGrants, url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false
  return (g.net ?? []).map((h) => h.toLowerCase()).includes(u.host.toLowerCase())
}
