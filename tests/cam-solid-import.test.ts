/**
 * M2.5a: solid models (CAD-14). STEP AP203 / AP214 / AP242, IGES and BREP read through the
 * OpenCascade reader with face ids, colours, names and properties kept; faces classified with
 * exact parameters; stored as a blob; bad files refused cleanly; the reader loaded lazily.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CAM_FILE_VERSION, newPart } from '@/cam/doc'
import { DEFAULT_PLACEMENT } from '@/cam/mesh/place'
import { meshVolume } from '@/cam/mesh/types'
import { decodeMesh, MemoryBlobStore, sha256Hex, gzip } from '@/cam/model/blobs'
import { parsePartFile, serializePartFile } from '@/cam/model/partFile'
import { topology } from '@/cam/solid/classify'
import { readSolid, SolidReadError, solidFormatOf } from '@/cam/solid/convert'
import { decodeSolid, encodeSolid, solidMesh } from '@/cam/solid/encode'
import { occt, setOcctLoader, type OcctModule } from '@/cam/solid/occt'
import { decodeStepString, readStepMeta } from '@/cam/solid/step21'
import { faceCount } from '@/cam/solid/types'
import type { CamPart, ModelRef } from '@/cam/types'
import { runTask } from '@/cam/worker/tasks'
import { fixtureBytes, readFixture, truthOf, registerNodeOcct } from './solid-fixtures'

const kinds = (s: Awaited<ReturnType<typeof readFixture>>) => {
  const k: Record<string, number> = {}
  for (const b of s.bodies) for (const f of b.faces) k[f.surface.kind] = (k[f.surface.kind] ?? 0) + 1
  return k
}

describe('M2.5a solid import (CAD-14)', () => {
  it('reads the cabinet side (STEP AP214): name, properties, unit, face ids in file order, the coloured face', async () => {
    const s = await readFixture('cabinet-side.step')
    expect(s.format).toBe('step')
    expect(s.schema).toBe('AP214')
    expect(s.units).toBe('mm')
    expect(s.bodies).toHaveLength(1)
    const b = s.bodies[0]
    expect(b.name).toBe('Cabinet side')
    expect(b.color).toBe('#d8c39a')
    expect(s.products).toEqual([{ name: 'Cabinet side', properties: { Material: 'Maple ply 19', Grain: 'Length' } }])
    // face ids: 1..N, in the file's order, triangle ranges back to back
    expect(b.faces.map((f) => f.id)).toEqual(Array.from({ length: b.faces.length }, (_, i) => i + 1))
    expect(b.faces.length).toBe(106)
    for (let i = 1; i < b.faces.length; i++) expect(b.faces[i].first).toBe(b.faces[i - 1].last + 1)
    expect(b.faces.at(-1)!.last).toBe(b.indices.length / 3 - 1)
    // exactly one face carries the file's face colour: the inside face (plane facing -X at X = 18)
    const red = b.faces.filter((f) => f.color === '#cc3333')
    expect(red).toHaveLength(1)
    expect(red[0].surface.kind).toBe('plane')
    expect(red[0].surface.n![0]).toBeCloseTo(-1, 12)
    expect(-red[0].surface.d!).toBeCloseTo(18, 9)
  })

  it('classifies every face of the cabinet side exactly (holes, drill points, pocket corners)', async () => {
    const s = await readFixture('cabinet-side.step')
    const t = truthOf('cabinet-side.step')
    expect(kinds(s)).toEqual({ plane: 56, cylinder: 48, cone: 2 })
    const b = s.bodies[0]
    let worst = 0
    for (const f of b.faces) worst = Math.max(worst, f.surface.fit)
    expect(worst).toBeLessThan(1e-9)
    // hole walls: concave, axis square to the panel (along X in the file), radius exact
    const holes = b.faces.filter((f) => f.surface.kind === 'cylinder' && f.surface.concave && Math.abs(f.surface.v![0]) > 0.999999)
    const radii = holes.map((f) => f.surface.r!)
    for (const h of t.holes) expect(radii.some((r) => Math.abs(r - h.d / 2) < 1e-9)).toBe(true)
    expect(holes.filter((f) => Math.abs(f.surface.r! - 2.5) < 1e-9)).toHaveLength(26)
    // the two drill points: 118° included angle, apex on the hole axis
    const cones = b.faces.filter((f) => f.surface.kind === 'cone')
    expect(cones).toHaveLength(2)
    for (const c of cones) {
      expect((c.surface.angle! * 360) / Math.PI).toBeCloseTo(118, 9)
      expect(c.surface.concave).toBe(true)
    }
  })

  it('reads the shaped door (STEP AP203) and the same door as BREP with the same faces', async () => {
    const s = await readFixture('shaped-door.step')
    const r = await readFixture('shaped-door.brep')
    expect(s.schema).toBe('AP203')
    expect(s.bodies[0].name).toBe('Arched door')
    expect(r.format).toBe('brep')
    expect(r.warnings.join(' ')).toMatch(/do not say their unit/)
    expect(kinds(s)).toEqual({ plane: 11, cylinder: 5 })
    expect(kinds(r)).toEqual(kinds(s))
    // the arch (R250, convex) and the field's arch (R180, concave), exact
    const cyl = s.bodies[0].faces.filter((f) => f.surface.kind === 'cylinder')
    expect(cyl.some((f) => Math.abs(f.surface.r! - 250) < 1e-9 && !f.surface.concave)).toBe(true)
    expect(cyl.some((f) => Math.abs(f.surface.r! - 180) < 1e-9 && f.surface.concave)).toBe(true)
    expect(cyl.filter((f) => Math.abs(f.surface.r! - 17.5) < 1e-9)).toHaveLength(2)
  })

  it('reads the 5-part assembly (STEP AP242): names, assembly path, products with properties, two instances of one part', async () => {
    const s = await readFixture('assembly-5.step')
    expect(s.schema).toBe('AP242')
    expect(s.bodies.map((b) => b.name)).toEqual(['Side', 'Side', 'Bottom', 'Top rail', 'Back'])
    for (const b of s.bodies) expect(b.path).toEqual(['Base cabinet 600'])
    expect(s.products.find((p) => p.name === 'Side')!.properties).toEqual({ Material: 'Maple ply 19', Edge: 'Front' })
    expect(s.products.find((p) => p.name === 'Back')!.properties).toEqual({ Material: 'MDF 6' })
    // face ids run on across bodies
    const ids = s.bodies.flatMap((b) => b.faces.map((f) => f.id))
    expect(ids).toEqual(Array.from({ length: ids.length }, (_, i) => i + 1))
    expect(faceCount(s)).toBe(72)
  })

  it('reads IGES in inches into millimetres; a unit can be forced', async () => {
    const s = await readFixture('shelf-inch.igs')
    expect(s.format).toBe('iges')
    expect(s.units).toBe('in')
    const b = s.bodies[0]
    let max = [-Infinity, -Infinity, -Infinity]
    let min = [Infinity, Infinity, Infinity]
    for (let i = 0; i < b.positions.length; i += 3)
      for (let k = 0; k < 3; k++) {
        max[k] = Math.max(max[k], b.positions[i + k])
        min[k] = Math.min(min[k], b.positions[i + k])
      }
    expect(max[0] - min[0]).toBeCloseTo(304.8, 6)
    expect(max[1] - min[1]).toBeCloseTo(254, 6)
    expect(max[2] - min[2]).toBeCloseTo(19.05, 6)
    // IGES writes the holes as surfaces of revolution; still found within 0.0001 mm
    const holes = b.faces.filter((f) => f.surface.kind === 'cylinder')
    expect(holes).toHaveLength(2)
    for (const h of holes) expect(Math.abs(h.surface.r! - 3.175)).toBeLessThan(1e-4)
    // forcing a unit: the side read as if drawn in inches is 25.4 times bigger
    const inch = await readFixture('cabinet-side.step', { units: 'in' })
    const mm = await readFixture('cabinet-side.step')
    expect(inch.bodies[0].positions[3] / mm.bodies[0].positions[3]).toBeCloseTo(25.4, 9)
    expect(inch.warnings.join(' ')).toMatch(/instead of mm/)
  })

  it('bad files give a clear error, never a crash', async () => {
    registerNodeOcct()
    const reader = await occt()
    const good = fixtureBytes('cabinet-side.step')
    const cases: [Uint8Array, string, RegExp][] = [
      [new Uint8Array(0), 'empty.step', /is empty/],
      [new TextEncoder().encode('solid x\nendsolid x\n'), 'mesh.step', /does not look like a STEP/],
      [good.slice(0, 2000), 'cut.step', /could not be read|no solids/],
      [new TextEncoder().encode('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n'), 'nothing.step', /no solids|could not be read/],
      [new Uint8Array(5000).map((_, i) => (i * 7919) % 251), 'noise.igs', /does not look like an? IGES/],
      [good, 'side.dxf', /not a STEP, IGES or BREP/],
    ]
    for (const [bytes, name, msg] of cases) {
      let err: unknown
      try {
        readSolid(reader, bytes, name)
      } catch (e) {
        err = e
      }
      expect(err, name).toBeInstanceOf(SolidReadError)
      expect((err as Error).message, name).toMatch(msg)
    }
    expect(solidFormatOf('A.STP')).toBe('step')
    expect(solidFormatOf('a.IGS')).toBe('iges')
    expect(solidFormatOf('a.stl')).toBeNull()
  })

  it('stored as a blob: lossless round trip; as a mesh, one facet group per face, facing outwards, volume exact', async () => {
    const s = await readFixture('cabinet-side.step')
    const t = truthOf('cabinet-side.step')
    const raw = encodeSolid(s)
    const back = decodeSolid(raw)
    expect(encodeSolid(back)).toEqual(raw)
    expect([...back.bodies[0].positions]).toEqual([...s.bodies[0].positions])
    expect(back.bodies[0].faces).toEqual(s.bodies[0].faces)
    // the generic mesh loader understands solids too
    const m = decodeMesh(raw)
    expect(m.groups!.length).toBe(m.indices.length / 3)
    expect(new Set(m.groups).size).toBe(106)
    expect(m.groupNames![1]).toMatch(/^Face 1 · /)
    expect(solidMesh(s).indices.length).toBe(s.bodies[0].indices.length)
    // volume from the design numbers (outline less holes, drill points, pockets and the cut-out)
    const T = t.thickness
    let v = t.outline.area * T
    for (const h of t.holes) {
      const r = h.d / 2
      v -= Math.PI * r * r * (h.through ? T : h.depth)
      if (h.floor === 'cone') v -= (Math.PI * r * r * (r / Math.tan((h.tipAngle! * Math.PI) / 360))) / 3
    }
    const [groove, recess, step1, step2] = t.pockets
    v -= groove.area * groove.depth + recess.area * recess.depth + step1.area * step1.depth + step2.area * (step2.depth - step1.depth)
    v -= t.cutouts[0].area * T
    const got = meshVolume(m)
    expect(got).toBeGreaterThan(0)
    // the triangles sit within 0.05 mm of the curved walls, so slightly more material shows
    expect(Math.abs(got - v) / v).toBeLessThan(2e-4)
  })

  it('topology: closed solids have no open edges; every face loop knows the face next to it', async () => {
    for (const f of ['cabinet-side.step', 'shaped-door.step']) {
      const s = await readFixture(f)
      const topo = topology(s.bodies[0])
      let edges = 0
      for (const fl of topo.loops.values())
        for (const loop of fl.loops)
          for (const e of loop) {
            edges++
            expect(e.other, `${f} face ${fl.face}`).toBeGreaterThan(0)
          }
      expect(edges).toBeGreaterThan(100)
      // every face touches another (a flat hole floor touches only its wall); the big faces touch many
      for (const n of topo.neighbours.values()) expect(n.size).toBeGreaterThanOrEqual(1)
      expect(Math.max(...[...topo.neighbours.values()].map((n) => n.size))).toBeGreaterThan(8)
    }
  })

  it('STEP text: escapes, properties and units read from the file itself', () => {
    expect(decodeStepString("Bob''s \\X\\E9t\\X2\\00E9\\X0\\")).toBe("Bob's été")
    expect(decodeStepString("O''Neil \\X2\\00C900E9\\X0\\")).toBe("O'Neil Éé")
    const meta = readStepMeta(fixtureBytes('assembly-5.step'))
    expect(meta.schema).toBe('AP242')
    expect(meta.units).toBe('mm')
    expect(meta.products.map((p) => p.name)).toEqual(['Base cabinet 600', 'Side', 'Bottom', 'Top rail', 'Back'])
    const inch = new TextEncoder().encode(
      "ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n#1=PRODUCT('P1','Shelf \\X2\\00E9\\X0\\','',(#2));\n#5=(CONVERSION_BASED_UNIT('INCH',#6)LENGTH_UNIT()NAMED_UNIT(#7));\nENDSEC;\nEND-ISO-10303-21;\n",
    )
    const m = readStepMeta(inch)
    expect(m.schema).toBe('AP214')
    expect(m.units).toBe('in')
    expect(m.products[0].name).toBe('Shelf é')
  })

  it('worker task: reads, packs and unpacks a solid (checksum checked)', async () => {
    registerNodeOcct()
    const s = await runTask('solid.import', { bytes: fixtureBytes('shaped-door.step'), name: 'shaped-door.step' })
    expect(s.bodies[0].faces).toHaveLength(16)
    const packed = await runTask('solid.pack', { solid: s })
    expect(packed.hash).toBe(await sha256Hex(encodeSolid(s)))
    const back = await runTask('blob.unpackSolid', packed)
    expect(back.bodies[0].faces).toEqual(s.bodies[0].faces)
    await expect(runTask('blob.unpackSolid', { gz: await gzip(new Uint8Array([1, 2, 3])), hash: packed.hash })).rejects.toThrow(/damaged/)
  })

  it('part files carry the solid and its original file; the part is version 3', async () => {
    const s = await readFixture('shaped-door.step')
    const store = new MemoryBlobStore()
    const raw = encodeSolid(s)
    const blob = await sha256Hex(raw)
    await store.put(blob, await gzip(raw))
    const fileBytes = fixtureBytes('shaped-door.step')
    const file = await sha256Hex(fileBytes)
    await store.put(file, await gzip(fileBytes))
    const model: ModelRef = { id: 's1', name: 'Arched door', kind: 'solid', blob, file, source: 'shaped-door.step', units: 'mm', place: { ...DEFAULT_PLACEMENT }, layer: 'models', visible: true, triangles: 1240, size: [400, 700, 19], faces: 16, format: 'STEP AP203', faceColors: { '3': '#ff0000' } }
    const part: CamPart = { ...newPart({ name: 'Door' }), models: [model] }
    expect(part.version).toBe(CAM_FILE_VERSION)
    const text = await serializePartFile(part, store)
    const other = new MemoryBlobStore()
    const { part: back, missing } = await parsePartFile(text, other)
    expect(missing).toEqual([])
    expect(back.models![0]).toEqual(model)
    expect(await other.has(blob)).toBe(true)
    expect(await other.has(file)).toBe(true)
  })

  it('the reader loads only when needed: nothing in the app imports it; it comes from vendor files at run time', () => {
    const files: string[] = []
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name)
        if (f.isDirectory()) walk(p)
        else if (/\.(ts|tsx)$/.test(f.name)) files.push(p)
      }
    }
    walk(path.join(import.meta.dirname, '..', 'src'))
    for (const f of files) expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/(from|import\()\s*['"]occt-import-js/)
    const loader = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'cam', 'solid', 'occt.ts'), 'utf8')
    expect(loader).toMatch(/import\(\/\* @vite-ignore \*\/ `\$\{base\}occt-import-js\.js`\)/)
    const vite = fs.readFileSync(path.join(import.meta.dirname, '..', 'vite.config.ts'), 'utf8')
    expect(vite).toMatch(/vendor\/occt-import-js/)
    expect(vite).toMatch(/'wasm-unsafe-eval'/)
    // the desktop app keeps the vendor files unpacked (replaceable) and serves them over app://
    const pkg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8'))
    expect(pkg.build.asarUnpack).toContain('dist/vendor/**')
    const main = fs.readFileSync(path.join(import.meta.dirname, '..', 'electron', 'main.ts'), 'utf8')
    expect(main).toMatch(/registerSchemesAsPrivileged/)
    expect(main).toMatch(/'\.wasm': 'application\/wasm'/)
    // licence notices
    const notices = fs.readFileSync(path.join(import.meta.dirname, '..', 'THIRD_PARTY_NOTICES.md'), 'utf8')
    expect(notices).toMatch(/occt-import-js 0\.0\.23/)
    expect(notices).toMatch(/GNU LESSER GENERAL PUBLIC LICENSE/)
  })

  it('speed: a 106-face cabinet side reads in under 3 s once the reader is warm; a cold start stays under 5 s', async () => {
    let calls = 0
    const factory = (await import('node:module')).createRequire(import.meta.url)('occt-import-js') as (m: object) => Promise<OcctModule>
    setOcctLoader(() => {
      calls++
      return factory({ print: () => {}, printErr: () => {} })
    })
    const t0 = performance.now()
    const reader = await occt()
    const cold = performance.now() - t0
    const bytes = fixtureBytes('cabinet-side.step')
    readSolid(reader, bytes, 'cabinet-side.step')
    const first = performance.now() - t0
    const t1 = performance.now()
    readSolid(await occt(), bytes, 'cabinet-side.step')
    const warm = performance.now() - t1
    expect(calls).toBe(1)
    console.log(`[solid] reader start ${cold.toFixed(0)} ms, first read ${first.toFixed(0)} ms, warm read ${warm.toFixed(0)} ms`)
    expect(first).toBeLessThan(5000)
    expect(warm).toBeLessThan(3000)
  })
})
