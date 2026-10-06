/**
 * File and network access for plugins on the desktop (M2.10). The plugin sandbox has already
 * checked the grants; this side checks them again on the real file system: the path and, once
 * links are followed, the real path must both be inside a granted folder, so a link inside a
 * granted folder cannot lead out of it. Network: https to a granted host only, 20 s, 5 MB.
 */
import fs from 'node:fs'
import path from 'node:path'
import { hostAllowed, normPath, pathAllowed } from '../src/cam/plugin/access'
import type { PluginGrants, PluginIO } from '../src/cam/plugin/types'

const MAX_FILE = 20 * 1024 * 1024
const MAX_FETCH = 5 * 1024 * 1024

function denied(what: string): never {
  throw new Error(`${what} was not granted to this plugin.`)
}

/** The real path of `p`, or of its nearest existing folder plus the rest (for files to be written). */
function realOf(p: string): string {
  let cur = p
  const rest: string[] = []
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(cur), ...rest)
    } catch {
      const up = path.dirname(cur)
      if (up === cur) return p
      rest.unshift(path.basename(cur))
      cur = up
    }
  }
}

/** Check `p` against the grants, before and after following links. Returns the native path. */
export function grantedPath(grants: PluginGrants, p: string, mode: 'read' | 'write'): string {
  const n = normPath(p)
  if (!n || !pathAllowed(grants, n, mode)) denied(`${mode === 'read' ? 'Reading' : 'Writing'} ${p}`)
  const native = path.resolve(n)
  const real = realOf(native)
  if (!pathAllowed(grants, real.replace(/\\/g, '/'), mode)) denied(`${mode === 'read' ? 'Reading' : 'Writing'} ${p} (it leads to ${real})`)
  return native
}

/** Synchronous access, for the batch thread (batch steps run straight through). */
export function nodePluginIO(grants: PluginGrants): PluginIO {
  return {
    readText(p) {
      const f = grantedPath(grants, p, 'read')
      if (fs.statSync(f).size > MAX_FILE) throw new Error(`${p} is larger than 20 MB.`)
      return fs.readFileSync(f, 'utf8')
    },
    writeText(p, text) {
      const f = grantedPath(grants, p, 'write')
      fs.mkdirSync(path.dirname(f), { recursive: true })
      fs.writeFileSync(f, text, 'utf8')
    },
    list(folder) {
      return fs.readdirSync(grantedPath(grants, folder, 'read')).sort()
    },
  }
}

/** Main-process handlers (the page's plugin worker asks through the preload bridge). */
export const pluginIpc = {
  async read(p: string, grants: PluginGrants) {
    const f = grantedPath(grants, p, 'read')
    if ((await fs.promises.stat(f)).size > MAX_FILE) throw new Error(`${p} is larger than 20 MB.`)
    return fs.promises.readFile(f, 'utf8')
  },
  async write(p: string, text: string, grants: PluginGrants) {
    const f = grantedPath(grants, p, 'write')
    await fs.promises.mkdir(path.dirname(f), { recursive: true })
    await fs.promises.writeFile(f, text, 'utf8')
  },
  async list(folder: string, grants: PluginGrants) {
    return (await fs.promises.readdir(grantedPath(grants, folder, 'read'))).sort()
  },
  async fetch(url: string, init: { method?: string; body?: string; headers?: Record<string, string> }, grants: PluginGrants) {
    if (!hostAllowed(grants, url)) denied(`Fetching ${url}`)
    const r = await fetch(url, { method: init.method ?? 'GET', body: init.body, headers: init.headers, redirect: 'error', signal: AbortSignal.timeout(20_000) })
    const buf = await r.arrayBuffer()
    if (buf.byteLength > MAX_FETCH) throw new Error(`${url} answered with more than 5 MB.`)
    if (!r.ok) throw new Error(`${url} answered ${r.status}.`)
    return new TextDecoder().decode(buf)
  },
}
