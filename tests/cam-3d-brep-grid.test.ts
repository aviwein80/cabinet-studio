/**
 * M3.1g rows and columns of an imported solid's face (owner decision 4): the OpenCascade B-rep
 * kernel (replicad-opencascadejs, LGPL-2.1, loaded on first use) reads the solid file again,
 * finds the face and samples its true surface on its own parameters. Checked against a fixture
 * whose free-form top face is known in closed form (tests/fixtures/solid/dome-panel.*): every grid
 * point on the true surface, rows and columns on their exact lines, the hole left out; curve-driven
 * passes along them touch each line, never gouge, and stop at the hole; STEP and BREP; IGES and a
 * face that is not there are refused with the reason.
 */
import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { checkGouge, meshDistance } from '@/cam/3d/check'
import { gridLines } from '@/cam/3d/curve'
import { newPart } from '@/cam/doc'
import { DEFAULT_PLACEMENT, placeMesh } from '@/cam/mesh/place'
import { readSolid } from '@/cam/solid/convert'
import { brepKernel, setBrepLoader, type BrepKernel } from '@/cam/solid/brep'
import { solidMesh } from '@/cam/solid/encode'
import { placementFrame } from '@/cam/solid/faces'
import { faceGrid, FaceGridError } from '@/cam/solid/faceGrid'
import { occt } from '@/cam/solid/occt'
import type { SolidData } from '@/cam/solid/types'
import { defaultOp } from '@/cam/ops'
import { generateOp } from '@/cam/toolpath'
import type { CamPart, Finish3dOp, ModelPlacement, ModelRef } from '@/cam/types'
import { runTask } from '@/cam/worker/tasks'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import { FIXTURES, fixtureBytes, registerNodeOcct } from './solid-fixtures'

const T = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'dome-panel.truth.json'), 'utf8')) as { L: number; W: number; a: number; X0: number; Y0: number; Z0: number; bottom: number; hole: { x: number; y: number; r: number } }
/** The dome in the file's frame. */
const domeZ = (x: number, y: number) => {
  const u = (x - T.X0) / T.L
  const v = (y - T.Y0) / T.W
  return T.Z0 + 16 * T.a * u * (1 - u) * v * (1 - v)
}

export function registerNodeBrep() {
  setBrepLoader(async () => {
    const { default: Module } = (await import('replicad-opencascadejs')) as unknown as { default: (m: object) => Promise<BrepKernel> }
    return Module({ print() {}, printErr() {} })
  })
}

let oc: BrepKernel
let solid: SolidData
let coldMs = 0
const place: ModelPlacement = { ...DEFAULT_PLACEMENT, at: [0, 0, 0] }

/** The dome face: the free-form one in the stored solid. */
const domeFace = () => solid.bodies[0].faces.find((f) => f.surface.kind === 'other' && f.area > 5000)!

/** Grid point k back in the file's frame (undoing the placement). */
function fileFrame(): (p: [number, number, number]) => [number, number, number] {
  const pf = placementFrame(solid.bodies[0], place)
  if ('error' in pf) throw new Error(pf.error)
  const { R, origin } = pf.frame
  // R is a rotation: its inverse is its transpose
  return (p) => {
    const q = [p[0] + origin[0], p[1] + origin[1], p[2] + origin[2]]
    return [0, 1, 2].map((k) => R[0][k] * q[0] + R[1][k] * q[1] + R[2][k] * q[2]) as [number, number, number]
  }
}

beforeAll(async () => {
  registerNodeOcct()
  registerNodeBrep()
  solid = readSolid(await occt(), fixtureBytes('dome-panel.step'), 'dome-panel.step')
  const t0 = performance.now()
  oc = await brepKernel()
  coldMs = performance.now() - t0
}, 120_000)

describe('M3.1g a face\'s rows and columns from the B-rep kernel', () => {
  it('the kernel loads on first use (separate file, not in the app bundle)', () => {
    process.stdout.write(`  [brep] kernel cold start ${coldMs.toFixed(0)} ms (replicad-opencascadejs 1.1.0, ${(fs.statSync(path.join('node_modules', 'replicad-opencascadejs', 'dist', 'replicad_single.wasm')).size / 1e6).toFixed(1)} MB of WebAssembly)\n`)
    expect(typeof oc.STEPControl_Reader).toBe('function')
    // the app serves the published files unmodified, as their own files next to it (vite.config.ts
    // copies them from the package into vendor/opencascade-brep/; nothing imports them)
    const src = fs.readFileSync(path.join('node_modules', 'replicad-opencascadejs', 'dist', 'replicad_single.wasm'))
    expect(src.length).toBeGreaterThan(20e6)
    const vite = fs.readFileSync('vite.config.ts', 'utf8')
    expect(vite).toMatch(/vendor\/opencascade-brep', from: 'node_modules\/replicad-opencascadejs\/dist', files: \['replicad_single\.js', 'replicad_single\.wasm'\]/)
    expect(vite).toMatch(/vendor\/opencascade-brep', from: 'node_modules\/replicad-opencascadejs', files: \['LICENSE'\]/)
    const notices = fs.readFileSync('THIRD_PARTY_NOTICES.md', 'utf8')
    expect(notices).toMatch(/replicad-opencascadejs 1\.1\.0/)
    expect(notices).toMatch(/LGPL-2\.1/)
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    expect(pkg.devDependencies['replicad-opencascadejs']).toBe('1.1.0')
    expect(pkg.build.asarUnpack).toContain('dist/vendor/**')
  })

  it('dome face: every grid point on the true surface; rows at one y, columns at one x; the hole left out', () => {
    const face = domeFace()
    expect(face).toBeTruthy()
    const t0 = performance.now()
    const r = faceGrid(oc, fixtureBytes('dome-panel.step'), 'step', solid, place, face.id)
    const ms = performance.now() - t0
    expect(r.faceId).toBe(face.id)
    expect(r.surface).toMatch(/BSpline/)
    expect(r.warnings).toEqual([])
    expect(r.chord).toBeLessThanOrEqual(0.01)
    const g = r.mesh.grid!
    expect(g.rows * g.cols * 3).toBe(r.mesh.positions.length)
    expect(g.closedRows || g.closedCols).toBe(false)
    const back = fileFrame()
    const used = new Uint8Array(g.rows * g.cols)
    for (const i of r.mesh.indices) used[i] = 1
    let worstZ = 0
    let worstRow = 0
    let worstCol = 0
    let inHole = 0
    const at = (j: number, i: number) => back([...r.mesh.positions.subarray((j * g.cols + i) * 3, (j * g.cols + i) * 3 + 3)] as [number, number, number])
    for (let j = 0; j < g.rows; j++)
      for (let i = 0; i < g.cols; i++) {
        const p = at(j, i)
        // (float32 storage: a few micrometres)
        worstZ = Math.max(worstZ, Math.abs(p[2] - domeZ(p[0], p[1])))
        worstRow = Math.max(worstRow, Math.abs(p[1] - at(j, 0)[1]))
        worstCol = Math.max(worstCol, Math.abs(p[0] - at(0, i)[0]))
        const dh = Math.hypot(p[0] - T.hole.x, p[1] - T.hole.y)
        if (used[j * g.cols + i] && dh < T.hole.r - 1e-6) inHole++
      }
    expect(worstZ).toBeLessThan(0.0002)
    expect(worstRow).toBeLessThan(0.0002)
    expect(worstCol).toBeLessThan(0.0002)
    expect(inHole).toBe(0)
    // and every point well away from the hole is in the face
    let missed = 0
    const spacing = T.L / (g.cols - 1)
    for (let j = 0; j < g.rows; j++)
      for (let i = 0; i < g.cols; i++) {
        const p = at(j, i)
        if (Math.hypot(p[0] - T.hole.x, p[1] - T.hole.y) > T.hole.r + 2 * spacing + 0.1 && !used[j * g.cols + i]) missed++
      }
    expect(missed).toBe(0)
    process.stdout.write(`  [brep] dome face ${face.id} (B-rep face ${r.brepIndex}, ${r.surface}): ${g.rows} rows x ${g.cols} columns in ${ms.toFixed(0)} ms, ${r.inside} points in the face, spacing ${spacing.toFixed(3)} mm, chord ${r.chord.toFixed(4)} mm; worst off the true surface ${worstZ.toFixed(6)} mm, rows ${worstRow.toFixed(6)}, columns ${worstCol.toFixed(6)}\n`)
  }, 120_000)

  it('the same from the BREP file; IGES and a face not in the file are refused with the reason', async () => {
    const brepSolid = readSolid(await occt(), fixtureBytes('dome-panel.brep'), 'dome-panel.brep')
    const face = brepSolid.bodies[0].faces.find((f) => f.surface.kind === 'other' && f.area > 5000)!
    const r = faceGrid(oc, fixtureBytes('dome-panel.brep'), 'brep', brepSolid, place, face.id)
    expect(r.surface).toMatch(/BSpline/)
    expect(r.chord).toBeLessThanOrEqual(0.01)
    expect(() => faceGrid(oc, fixtureBytes('dome-panel.step'), 'iges', solid, place, domeFace().id)).toThrow(/no IGES reader/)
    expect(() => faceGrid(oc, fixtureBytes('dome-panel.step'), 'step', solid, place, 999)).toThrow(/not in this solid/)
    // the stored solid and the file no longer match (another file given): not found, with the reason
    expect(() => faceGrid(oc, fixtureBytes('shaped-door.step'), 'step', solid, place, domeFace().id)).toThrow(FaceGridError)
  }, 120_000)
})

describe('M3.1g curve-driven passes along an imported solid\'s rows and columns', () => {
  function domePart() {
    const face = domeFace()
    const r = faceGrid(oc, fixtureBytes('dome-panel.step'), 'step', solid, place, face.id)
    const sm = solidMesh(solid)
    const size: [number, number, number] = [T.L, T.W, 35]
    const model: ModelRef = { id: 'sol', name: 'Dome panel', kind: 'solid', blob: 'dome', file: 'file', source: 'dome-panel.step', units: 'mm', place, layer: 'models', visible: true, triangles: sm.indices.length / 3, size, faces: 7, format: 'STEP AP214' }
    // the face's rows and columns as a surface model (part coordinates, placed where they were made)
    const gm: ModelRef = { id: 'rows', name: `Face ${face.id} rows and columns`, kind: 'mesh', blob: 'grid', source: 'Face rows', units: 'mm', place: { ...DEFAULT_PLACEMENT, at: [0, 0, 0] }, layer: 'models', visible: true, triangles: r.mesh.indices.length / 3, size, grid: { blob: 'grid', ...r.mesh.grid! } }
    const part: CamPart = { ...newPart({ name: 'Dome', length: T.L, width: T.W, thickness: 35 }), models: [model, gm] }
    return { part, face, grid: r, meshes: new Map([['dome', sm], ['grid', r.mesh]]) }
  }

  for (const along of ['rows', 'columns'] as const) {
    it(`along the ${along}: the ball touches each line, never gouges, lines a step-over apart on the surface, nothing over the hole`, () => {
      const { part, face, meshes, grid } = domePart()
      // placed exactly where it was made, as the app adds a surface model: its corner and top
      const lo = [Infinity, Infinity, -Infinity]
      for (let i = 0; i < grid.mesh.positions.length; i += 3) {
        lo[0] = Math.min(lo[0], grid.mesh.positions[i])
        lo[1] = Math.min(lo[1], grid.mesh.positions[i + 1])
        lo[2] = Math.max(lo[2], grid.mesh.positions[i + 2])
      }
      part.models![1].place = { ...part.models![1].place, at: [lo[0], lo[1], lo[2]] }
      const base = defaultOp('finish3d', [], { strategy: 'curve' } as Partial<Finish3dOp>) as Finish3dOp
      const op: Finish3dOp = { ...base, toolId: 't105', stepover: 3, drive: { mode: 'parameter', modelId: 'rows', along }, surface: { ...base.surface, modelId: 'sol', groups: [face.id] } }
      part.ops = [op]
      const tp = generateOp(op, { part, machine: PLACEHOLDER_MACHINE, meshes })
      expect(tp.warnings.filter((w) => !/rows and columns/.test(w))).toEqual([])
      const pts: [number, number, number][] = []
      for (const m of tp.moves) if (m.t === 'poly') for (let i = 0; i < m.pts.length; i += 3) pts.push([m.pts[i], m.pts[i + 1], m.pts[i + 2]])
      expect(pts.length).toBeGreaterThan(200)
      // the lines themselves (a needle's plan path is the line): rows at one y, columns at one x
      const inside = new Uint8Array(grid.mesh.positions.length / 3)
      for (const i of grid.mesh.indices) inside[i] = 1
      const back = fileFrame()
      const needle = gridLines(grid.mesh.positions, grid.mesh.grid!, along, 3, { kind: 'torus', R: 0, rc: 0 }, 0, inside)
      const lineAt = [...new Set(needle.map((l) => Math.round((along === 'rows' ? back([l.pts[0].x, l.pts[0].y, 0])[1] : back([l.pts[0].x, l.pts[0].y, 0])[0]) * 1e6) / 1e6))].sort((p, q) => p - q)
      for (let k = 1; k < lineAt.length; k++) expect(lineAt[k] - lineAt[k - 1]).toBeLessThanOrEqual(3 + 1e-6)
      // the solid as machined: its facets placed on the part
      const placed = placeMesh(meshes.get('dome')!, place)
      const meshDist = meshDistance(placed)
      const R = 3
      let off = 0
      let offMesh = 0
      let onLine = 0
      let overHole = 0
      /** Where the ball touches the true dome (from its centre back along the normal), and whether that is on a line. */
      const on = (x: number, y: number, z: number) => {
        const c = back([x, y, z + R])
        let qx = c[0]
        let qy = c[1]
        for (let it = 0; it < 30; it++) {
          const e = 1e-5
          const fx = (domeZ(qx + e, qy) - domeZ(qx - e, qy)) / (2 * e)
          const fy = (domeZ(qx, qy + e) - domeZ(qx, qy - e)) / (2 * e)
          const l = Math.hypot(fx, fy, 1)
          qx = c[0] + (R * fx) / l
          qy = c[1] + (R * fy) / l
        }
        off = Math.max(off, Math.abs(Math.hypot(c[0] - qx, c[1] - qy, c[2] - domeZ(qx, qy)) - R))
        offMesh = Math.max(offMesh, Math.abs(meshDist(x, y, z + R) - R))
        if (Math.hypot(qx - T.hole.x, qy - T.hole.y) < T.hole.r - 0.01) overHole++
        const v = along === 'rows' ? qy : qx
        let e = Infinity
        for (const L of lineAt) e = Math.min(e, Math.abs(v - L))
        // (the facets are within 0.05 mm of the true surface: the contact moves with them)
        if (e < 0.08) onLine = Math.max(onLine, e)
        return e < 0.08
      }
      // off the lines only on the stay-down links between passes (pass to pass, at most two step-overs)
      let longest = 0
      for (const m of tp.moves) {
        if (m.t !== 'poly') continue
        let from = -1
        for (let i = 0; i < m.pts.length; i += 3) {
          const ok = on(m.pts[i], m.pts[i + 1], m.pts[i + 2])
          if (!ok && from < 0) from = Math.max(0, i - 3)
          if (ok && from >= 0) {
            longest = Math.max(longest, Math.hypot(m.pts[i] - m.pts[from], m.pts[i + 1] - m.pts[from + 1]))
            from = -1
          }
        }
        expect(from, 'a cutting run ends off the lines').toBeLessThan(0)
      }
      expect(longest).toBeLessThanOrEqual(2 * 3 + 0.01)
      expect(overHole).toBe(0)
      // touching the model as machined; on the true surface and its lines within the import's 0.05 mm facets
      expect(offMesh).toBeLessThan(0.01)
      expect(off).toBeLessThan(0.05 + 0.01)
      expect(onLine).toBeLessThan(0.08)
      const g = checkGouge(placed, { shape: 'ball', r: R }, tp.moves, { step: 0.1 })
      // (it really is next to the model: the closest approach is a touch)
      expect(g.minClearance).toBeLessThan(0.01)
      process.stdout.write(`  [brep] curve-driven along the dome face's ${along}: ${pts.length} points, ${lineAt.length} lines a step-over or less apart; the ball within ${offMesh.toFixed(4)} mm of touching the solid's facets (${off.toFixed(4)} mm of the true surface); contacts within ${onLine.toFixed(4)} mm of a line (links up to ${longest.toFixed(2)} mm); gouge ${g.max.toFixed(4)} mm; none over the hole\n`)
      expect(g.max).toBeLessThanOrEqual(0.005)
    }, 180_000)
  }

  it('lines stop at the face\'s edges: the grid\'s points outside the trimmed face are not followed', () => {
    const { grid } = domePart()
    const inside = new Uint8Array(grid.mesh.positions.length / 3)
    for (const i of grid.mesh.indices) inside[i] = 1
    const all = gridLines(grid.mesh.positions, grid.mesh.grid!, 'rows', 3, { kind: 'torus', R: 3, rc: 3 }, 0)
    const cut = gridLines(grid.mesh.positions, grid.mesh.grid!, 'rows', 3, { kind: 'torus', R: 3, rc: 3 }, 0, inside)
    // the lines through the hole come in two pieces
    expect(cut.length).toBeGreaterThan(all.length)
  }, 120_000)

  it('through the worker task: the same grid', async () => {
    const face = domeFace()
    const r = await runTask('solid.faceGrid', { file: fixtureBytes('dome-panel.step'), name: 'dome-panel.step', solid, place, face: face.id })
    expect(r.mesh.grid).toEqual(faceGrid(oc, fixtureBytes('dome-panel.step'), 'step', solid, place, face.id).mesh.grid)
  }, 120_000)
})
