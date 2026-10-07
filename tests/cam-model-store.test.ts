import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CAM_FILE_VERSION, migratePart, newPart, parsePart, serializePart } from '@/cam/doc'
import { buildMesh } from '@/cam/mesh/build'
import { DEFAULT_PLACEMENT } from '@/cam/mesh/place'
import { parseStl } from '@/cam/mesh/read'
import { decodeMesh, encodeMesh, getMesh, gzip, MemoryBlobStore, putMesh, sha256Hex } from '@/cam/model/blobs'
import { parsePartFile, serializePartFile } from '@/cam/model/partFile'
import { writePartMpr } from '@/cam/mpr'
import { generatePart } from '@/cam/toolpath'
import type { CamPart, ModelRef } from '@/cam/types'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import { normalizeData } from '@/core/normalize'
import type { AppData } from '@/core/types'
import { digest } from './cam-digest'
import { box, stlBinary, torus } from './mesh-fixtures'

const meshOf = (bytes: Uint8Array) => buildMesh(parseStl(bytes)).mesh

describe('M2.1 model storage (blobs outside the shop file)', () => {
  it('mesh encoding round-trips, including groups', () => {
    const m = { ...meshOf(stlBinary(box(0, 0, 0, 3, 4, 5))) }
    const grouped = { ...m, groups: new Uint32Array(m.indices.length / 3).map((_, i) => i % 2), groupNames: ['Even', 'Odd'] }
    for (const x of [m, grouped]) {
      const back = decodeMesh(encodeMesh(x))
      expect([...back.positions]).toEqual([...x.positions])
      expect([...back.indices]).toEqual([...x.indices])
      expect(back.groupNames).toEqual(x.groupNames)
    }
    expect(() => decodeMesh(new Uint8Array(40))).toThrow(/not a Cabinet Studio mesh/)
    expect(() => decodeMesh(encodeMesh(m).slice(0, 30))).toThrow(/cut short/)
  })

  it('stores each mesh once under its SHA-256, compressed, and checks it on load', async () => {
    const store = new MemoryBlobStore()
    const m = meshOf(stlBinary(torus(30, 8)))
    const h = await putMesh(store, m)
    expect(h).toBe(await sha256Hex(encodeMesh(m)))
    expect(await putMesh(store, m)).toBe(h)
    expect(store.blobs.size).toBe(1)
    expect(store.blobs.get(h)!.length).toBeLessThan(encodeMesh(m).length)
    const back = await getMesh(store, h)
    expect(back.indices.length).toBe(m.indices.length)
    // damaged data is refused, missing data is reported
    const other = new MemoryBlobStore()
    const fake = '0'.repeat(64)
    await other.put(fake, await gzip(encodeMesh(m)))
    await expect(getMesh(other, fake)).rejects.toThrow(/damaged/)
    await expect(getMesh(other, 'f'.repeat(64))).rejects.toThrow(/missing/)
  })

  it('part files carry their model data; a tampered blob is reported missing', async () => {
    const store = new MemoryBlobStore()
    const h = await putMesh(store, meshOf(stlBinary(box(0, 0, 0, 100, 50, 10))))
    const model: ModelRef = { id: 'm1', name: 'Block', kind: 'mesh', blob: h, source: 'block.stl', units: 'mm', place: { ...DEFAULT_PLACEMENT }, layer: 'outline', visible: true, triangles: 12, size: [100, 50, 10] }
    const part: CamPart = { ...newPart({ name: 'With model' }), models: [model] }
    const text = await serializePartFile(part, store)
    // nothing large in the part itself: only the hash
    expect(JSON.stringify(part).length).toBeLessThan(2000)
    const fresh = new MemoryBlobStore()
    const read = await parsePartFile(text, fresh)
    expect(read.missing).toEqual([])
    expect(read.part.models![0].blob).toBe(h)
    expect(await fresh.has(h)).toBe(true)
    const raw = JSON.parse(text)
    raw.blobs[h] = raw.blobs[h].slice(0, -8) + 'AAAAAAA='
    const bad = await parsePartFile(JSON.stringify(raw), new MemoryBlobStore())
    expect(bad.missing).toEqual([h])
  })
})

describe('M2.1 part format version 2', () => {
  const DIR = path.join(import.meta.dirname, 'golden', 'cam')
  const refs = fs.readdirSync(DIR).filter((d) => /^ref\d\d$/.test(d)).sort()

  it('every Stage 1 golden part (version 1) loads unchanged and regenerates byte-identical toolpaths and MPR', () => {
    expect(refs).toHaveLength(20)
    for (const id of refs) {
      const text = fs.readFileSync(path.join(DIR, id, 'part.json'), 'latin1')
      const raw = JSON.parse(text)
      expect(raw.version).toBe(1)
      const p = parsePart(text)
      expect(p.version).toBe(CAM_FILE_VERSION)
      // every stored field survives as it was; only the version moves on
      expect({ ...p, version: 1 }).toEqual(raw.part)
      const paths = generatePart(p, PLACEHOLDER_MACHINE)
      const dig = JSON.stringify(paths.map(digest), null, 1) + '\n'
      expect(dig).toBe(fs.readFileSync(path.join(DIR, id, 'toolpaths.json'), 'latin1'))
      expect(writePartMpr(p, paths, PLACEHOLDER_MACHINE, 'REF')).toBe(fs.readFileSync(path.join(DIR, id, 'part.mpr'), 'latin1'))
    }
  })

  it('new parts are the current version (10 since M3.5); newer files are refused; shop files migrate job and library parts', () => {
    expect(CAM_FILE_VERSION).toBe(10)
    expect(newPart().version).toBe(10)
    expect(JSON.parse(serializePart(newPart())).version).toBe(10)
    expect(() => parsePart(JSON.stringify({ format: 'cabinet-studio-part', version: 11, part: newPart() }))).toThrow(/newer/)
    expect(() => migratePart({ version: 12 })).toThrow(/newer/)
    const old = { ...newPart({ name: 'old' }), version: 1 as const }
    const data = normalizeData({ jobs: [{ id: 'j', number: 'J1', name: '', customer: '', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [old] }], library: { ...normalizeData(null).library, partLibrary: [old] } } as Partial<AppData>)
    expect(data.jobs[0].camParts![0].version).toBe(10)
    expect(data.library.partLibrary![0].version).toBe(10)
    // a version 2 part (with a mesh model) moves to 10 with every field kept
    const v2 = { ...newPart({ name: 'v2' }), version: 2 as const, models: [{ id: 'm', name: 'M', kind: 'mesh' as const, blob: 'b', source: 's.stl', units: 'mm' as const, place: { ...DEFAULT_PLACEMENT }, layer: 'models', visible: true, triangles: 2, size: [1, 1, 1] as [number, number, number] }] }
    expect(migratePart(v2)).toEqual({ ...v2, version: 10 })
    // a version 3 (M2.5), 4 (M2.6), 5 (M3.1), 6 (M3.1g), 7 (M3.2) or 8 (M3.3) part moves to 10 with every field kept
    for (const v of [3, 4, 5, 6, 7, 8, 9] as const) {
      const old = { ...v2, version: v }
      expect(migratePart(old)).toEqual({ ...old, version: 10 })
    }
  })
})
