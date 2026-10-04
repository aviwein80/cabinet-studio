/**
 * Part files (`.csp.json`) with their 3D model data embedded, so a single file moves a part with
 * its models between computers. Inside the shop file, parts only hold the model hashes.
 */
import { CAM_FILE_VERSION, parsePart } from '../doc'
import type { CamPart } from '../types'
import { type BlobStore, blobRefs, exportBlobs, importBlobs } from './blobs'

export async function serializePartFile(part: CamPart, store: BlobStore): Promise<string> {
  const blobs = await exportBlobs(part, store)
  return JSON.stringify({ format: 'cabinet-studio-part', version: CAM_FILE_VERSION, part, ...(Object.keys(blobs).length ? { blobs } : {}) }, null, 1)
}

/** Read a part file, storing any embedded model data. `missing` lists models whose data is absent or damaged. */
export async function parsePartFile(text: string, store: BlobStore): Promise<{ part: CamPart; missing: string[] }> {
  const part = parsePart(text)
  const raw = JSON.parse(text) as { blobs?: Record<string, string> }
  const bad = new Set(await importBlobs(raw.blobs, store))
  const missing: string[] = []
  for (const h of blobRefs(part)) if (bad.has(h) || !(await store.has(h))) missing.push(h)
  return { part, missing }
}
