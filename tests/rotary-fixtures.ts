/**
 * Rotary test fixtures (M3.3): a turned leg (square pommel, bead, cove, taper, foot) as a closed
 * mesh round an axis along X, and the parts and operations for it and for a fluted column.
 */
import { makeEntity, newPart } from '@/cam/doc'
import { line } from '@/cam/geom'
import { DEFAULT_PLACEMENT } from '@/cam/mesh/place'
import { type Mesh, meshBounds } from '@/cam/mesh/types'
import { defaultOp } from '@/cam/ops'
import { axisFrame, defaultSetup, fromCyl, planeFromRadius, planeRect } from '@/cam/rotary/frame'
import { mergeMeshes } from '@/cam/relief/relief'
import type { CamPart, RotaryOp, RotarySetup } from '@/cam/types'

/** Leg: 300 mm long on a 40 x 40 blank; square pommel to x 50, then turned. */
export const LEG = { length: 300, side: 40, pommel: 50 }

/** Radius of the turned part of the leg at x (50..300). */
export function legRadius(x: number): number {
  if (x < 70) return 14 + 4 * Math.sin((Math.PI * (x - 50)) / 20) // bead
  if (x < 90) return 14 - 3 * Math.sin((Math.PI * (x - 70)) / 20) // cove
  if (x < 280) return 14 - (5 * (x - 90)) / 190 // taper 14 -> 9
  return 9 // foot
}

/** A closed surface of revolution round the set-up's axis, from x0 to x1 (ends capped). */
export function revolved(setup: RotarySetup, r: (x: number) => number, x0: number, x1: number, dx: number, seg: number): Mesh {
  const nx = Math.max(1, Math.round((x1 - x0) / dx))
  const pos: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= nx; i++) {
    const x = x0 + ((x1 - x0) * i) / nx
    for (let j = 0; j < seg; j++) pos.push(...fromCyl(setup, x, (2 * Math.PI * j) / seg, r(x)))
  }
  const ring = (i: number, j: number) => i * seg + (j % seg)
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < seg; j++) {
      // outward: θ turns from e0 towards e1, x along the axis
      idx.push(ring(i, j), ring(i + 1, j), ring(i + 1, j + 1), ring(i, j), ring(i + 1, j + 1), ring(i, j + 1))
    }
  // end caps (fans about the axis)
  const c0 = pos.length / 3
  pos.push(...fromCyl(setup, x0, 0, 0))
  const c1 = pos.length / 3
  pos.push(...fromCyl(setup, x1, 0, 0))
  for (let j = 0; j < seg; j++) {
    idx.push(c0, ring(0, j + 1), ring(0, j))
    idx.push(c1, ring(nx, j), ring(nx, j + 1))
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) }
}

/** An axis-aligned box. */
export function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Mesh {
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ]
  const f = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
  ]
  return { positions: Float32Array.from(v.flat()), indices: Uint32Array.from(f.flat()) }
}

/** The leg as one mesh in the part (part frame: X along, Y across, Z = 0 at the top). */
export function legMesh(setup: RotarySetup, opt: { dx?: number; seg?: number } = {}): Mesh {
  const s = LEG.side
  const turned = revolved(setup, legRadius, LEG.pommel, LEG.length, opt.dx ?? 1, opt.seg ?? 64)
  return mergeMeshes([box(0, LEG.pommel, 0, s, -s, 0), turned])
}

/** A part with the leg's blank on a rotary axis along X, the leg model and one plane all the way round. */
export function legPart(opt: { dx?: number; seg?: number } = {}): { part: CamPart; mesh: Mesh; setup: RotarySetup } {
  const base = newPart({ name: 'Turned leg', length: LEG.length, width: LEG.side, thickness: LEG.side })
  const setup0 = defaultSetup(base)
  const plane = planeFromRadius(setup0, LEG.side / 2, { id: 'p1', name: 'Plane 1', at: { x: 0, y: LEG.side + 20 } })
  const setup: RotarySetup = { ...setup0, planes: [plane] }
  const mesh = legMesh(setup, opt)
  const b = meshBounds(mesh)
  const part: CamPart = {
    ...base,
    rotary: setup,
    models: [{ id: 'leg', name: 'Leg', kind: 'mesh', blob: 'leg', source: 'leg.stl', units: 'mm', place: { ...DEFAULT_PLACEMENT, at: [b.min[0], b.min[1], b.max[2]] }, layer: 'models', visible: true, triangles: mesh.indices.length / 3, size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]] }],
  }
  return { part, mesh, setup }
}

export function rotaryOp(strategy: RotaryOp['strategy'], patch: Partial<RotaryOp> = {}): RotaryOp {
  return { ...(defaultOp('rotary', [], { strategy } as Partial<RotaryOp>) as RotaryOp), planeId: 'p1', ...patch }
}

/** Fluted column: Ø50 round blank 200 long, 8 stopped flutes drawn on a plane at the blank's radius. */
export const COLUMN = { length: 200, diameter: 50, flutes: 8, from: 30, to: 170 }

export function columnPart(): { part: CamPart; setup: RotarySetup; flutes: string[] } {
  const base = newPart({ name: 'Fluted column', length: COLUMN.length, width: COLUMN.diameter, thickness: COLUMN.diameter })
  const setup0: RotarySetup = { ...defaultSetup(base), blank: { shape: 'round', size: COLUMN.diameter, start: 0, end: COLUMN.length } }
  const plane = planeFromRadius(setup0, COLUMN.diameter / 2, { id: 'p1', name: 'Plane 1', at: { x: 0, y: COLUMN.diameter + 20 } })
  const setup: RotarySetup = { ...setup0, planes: [plane] }
  const r = planeRect(plane)
  const pitch = (r.y1 - r.y0) / COLUMN.flutes
  const lines = Array.from({ length: COLUMN.flutes }, (_, k) => makeEntity({ t: 'contour', c: { closed: false, segs: [line({ x: r.x0 + COLUMN.from, y: r.y0 + pitch * (k + 0.5) }, { x: r.x0 + COLUMN.to, y: r.y0 + pitch * (k + 0.5) })] } }, 'machining'))
  const part: CamPart = { ...base, rotary: setup, entities: [...base.entities, ...lines] }
  return { part, setup, flutes: lines.map((e) => e.id) }
}

/**
 * Independent measure of a closed mesh round the set-up's axis: for rays out from the axis at
 * (u, θ), the distance to the outermost crossing of the mesh (NaN where the ray misses it).
 * Plain ray-triangle tests (Möller-Trumbore), facets bucketed along the axis; no drop-cutter.
 */
export function meshRadii(mesh: Mesh, setup: RotarySetup): (u: number, theta: number) => number {
  const f = axisFrame(setup.axis)
  const p = mesh.positions
  const ix = mesh.indices
  const nt = ix.length / 3
  // facets as A, B - A, C - A (float64)
  const T = new Float64Array(nt * 9)
  const tu0 = new Float64Array(nt)
  const tu1 = new Float64Array(nt)
  let lo = Infinity
  let hi = -Infinity
  for (let t = 0; t < nt; t++) {
    const a = ix[t * 3] * 3
    const b = ix[t * 3 + 1] * 3
    const c = ix[t * 3 + 2] * 3
    for (let k = 0; k < 3; k++) {
      T[t * 9 + k] = p[a + k]
      T[t * 9 + 3 + k] = p[b + k] - p[a + k]
      T[t * 9 + 6 + k] = p[c + k] - p[a + k]
    }
    const ua = p[a] * f.a[0] + p[a + 1] * f.a[1] + p[a + 2] * f.a[2]
    const ub = p[b] * f.a[0] + p[b + 1] * f.a[1] + p[b + 2] * f.a[2]
    const uc = p[c] * f.a[0] + p[c + 1] * f.a[1] + p[c + 2] * f.a[2]
    tu0[t] = Math.min(ua, ub, uc)
    tu1[t] = Math.max(ua, ub, uc)
    lo = Math.min(lo, tu0[t])
    hi = Math.max(hi, tu1[t])
  }
  const cell = 1
  const nb = Math.max(1, Math.ceil((hi - lo) / cell) + 1)
  const lists: number[][] = Array.from({ length: nb }, () => [])
  for (let t = 0; t < nt; t++) for (let q = Math.floor((tu0[t] - lo) / cell); q <= Math.floor((tu1[t] - lo) / cell); q++) lists[q].push(t)
  const buckets = lists.map((l) => Int32Array.from(l))
  return (u, theta) => {
    const o = fromCyl(setup, u, 0, 0)
    const ct = Math.cos(theta)
    const st = Math.sin(theta)
    const dx = ct * f.e0[0] + st * f.e1[0]
    const dy = ct * f.e0[1] + st * f.e1[1]
    const dz = ct * f.e0[2] + st * f.e1[2]
    let best = NaN
    const q = Math.floor((u - lo) / cell)
    if (q < 0 || q >= nb) return NaN
    const list = buckets[q]
    for (let n = 0; n < list.length; n++) {
      const t = list[n]
      if (tu0[t] > u + 1e-9 || tu1[t] < u - 1e-9) continue
      const o9 = t * 9
      const e1x = T[o9 + 3], e1y = T[o9 + 4], e1z = T[o9 + 5]
      const e2x = T[o9 + 6], e2y = T[o9 + 7], e2z = T[o9 + 8]
      const hx = dy * e2z - dz * e2y
      const hy = dz * e2x - dx * e2z
      const hz = dx * e2y - dy * e2x
      const det = e1x * hx + e1y * hy + e1z * hz
      if (Math.abs(det) < 1e-14) continue
      const sx = o[0] - T[o9], sy = o[1] - T[o9 + 1], sz = o[2] - T[o9 + 2]
      const uu = (sx * hx + sy * hy + sz * hz) / det
      if (uu < -1e-12 || uu > 1 + 1e-12) continue
      const qx = sy * e1z - sz * e1y
      const qy = sz * e1x - sx * e1z
      const qz = sx * e1y - sy * e1x
      const vv = (dx * qx + dy * qy + dz * qz) / det
      if (vv < -1e-12 || uu + vv > 1 + 1e-12) continue
      const t2 = (e2x * qx + e2y * qy + e2z * qz) / det
      if (t2 >= 0 && !(t2 <= best)) best = t2
    }
    return best
  }
}
