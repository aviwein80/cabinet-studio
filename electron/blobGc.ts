/**
 * Clean-up of stored 3D model data (gzip files named by SHA-256 in `data/blobs`). A file is
 * removed only when neither the shop file nor any backup mentions its hash and it is older than
 * `keepMs`. If any of those files cannot be read, nothing is removed.
 */
import fs from 'node:fs'
import path from 'node:path'

const BLOB_RE = /^[0-9a-f]{64}$/

export function collectBlobs(dir: { blobs: string; dataFile: string; backups: string }, keepMs: number, now = Date.now()): string[] {
  if (!fs.existsSync(dir.blobs)) return []
  const used = new Set<string>()
  const files = [dir.dataFile, ...(fs.existsSync(dir.backups) ? fs.readdirSync(dir.backups).filter((f) => f.endsWith('.json')).map((f) => path.join(dir.backups, f)) : [])]
  for (const f of files) {
    if (!fs.existsSync(f)) continue
    try {
      for (const m of fs.readFileSync(f, 'utf8').matchAll(/"([0-9a-f]{64})"/g)) used.add(m[1])
    } catch {
      return []
    }
  }
  const removed: string[] = []
  for (const f of fs.readdirSync(dir.blobs)) {
    const hash = f.replace(/\.bin\.gz$/, '')
    if (!BLOB_RE.test(hash) || used.has(hash)) continue
    const full = path.join(dir.blobs, f)
    if (now - fs.statSync(full).mtimeMs > keepMs) {
      fs.unlinkSync(full)
      removed.push(hash)
    }
  }
  return removed
}
