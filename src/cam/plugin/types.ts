/**
 * Plugins (M2.10, API-01): code from outside the app that runs against our API in a sandbox.
 *
 * A plugin is one JavaScript file. It runs inside its own QuickJS interpreter (WebAssembly) with
 * no access to the app, the computer, files or the network. Everything it can do goes through
 * the `cs` object (see `api.ts` for the typed reference). Reading or writing files, using the
 * network and producing machine programs each need an explicit grant from the owner on the
 * Plugins screen; the plugin's header only *asks* for them.
 */

/** What the owner allowed one plugin to do. Absent = nothing. */
export interface PluginGrants {
  /** Folders the plugin may read files from (and everything below them). */
  read?: string[]
  /** Folders the plugin may write files to (and everything below them). */
  write?: string[]
  /** Hosts (e.g. "prices.example.com") the plugin may fetch from, https only. */
  net?: string[]
  /**
   * The plugin's script posts may produce machine programs (M2.10b). Even then the programs are
   * only written when the output switches are on and the export checker passes.
   */
  machineOutput?: boolean
}

export type GrantKind = keyof PluginGrants

/** The header a plugin file starts with (comment lines `// @key value`). Read without running the code. */
export interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  author?: string
  /** What the plugin says it needs. The owner decides what is granted. */
  requests: PluginGrants
}

export type MenuArea = 'part' | 'job'

/** What a plugin adds, as found when it was last loaded (shown on screens without running it). */
export interface PluginContributions {
  menu: { id: string; label: string; area: MenuArea }[]
  steps: { id: string; name: string; description: string; hooks: ('afterNest' | 'beforeOutput')[] }[]
  posts: { id: string; name: string; ext: string; description: string }[]
}

/** A plugin as kept in the shop data. */
export interface PluginRecord {
  id: string
  manifest: PluginManifest
  /** The plugin's source code, exactly as installed. */
  code: string
  /** Hash of `code`: grants are kept only while the code they were given to is unchanged. */
  codeHash: string
  enabled: boolean
  grants: PluginGrants
  /** From the last successful load. */
  contributes?: PluginContributions
  /** Last load problem, if any. */
  error?: string
  installedAt: string
  /** Where it came from: a file name, "sample" or "recorded". */
  source: string
}

/** One line of a plugin's log (its own messages and every refused request). */
export interface PluginLogLine {
  plugin: string
  level: 'info' | 'warning' | 'denied' | 'error'
  text: string
}

/**
 * File and network access for plugins, provided by where the plugin runs (desktop app, batch
 * worker, tests). The sandbox checks the grants before it calls any of these; the desktop app
 * checks them again on its side. Each call may answer straight away or with a promise.
 */
export interface PluginIO {
  readText?(path: string): string | Promise<string>
  writeText?(path: string, text: string): void | Promise<void>
  list?(folder: string): string[] | Promise<string[]>
  fetchText?(url: string, init: { method: string; body?: string; headers?: Record<string, string> }): string | Promise<string>
}
