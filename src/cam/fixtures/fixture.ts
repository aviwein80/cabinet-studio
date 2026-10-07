/**
 * Clamps, pods and rails (M3.6, FIX-01): what they are made of for the collision checks, made
 * from typed sizes, from shapes drawn on the part or from an imported solid or mesh, and the
 * shop's invented examples until it measures its own.
 *
 * Every fixture becomes convex pieces in the part's frame (x along the length, y along the width,
 * z = 0 at face 1): a block is one prism, a round one a cylinder, a drawn outline the triangles of
 * its outline stood up, an imported model its slices (each slice the convex outline of all the
 * model has between two heights, so a slice holds the whole model there and a check against it
 * can only report more, never less).
 *
 * Pure: no DOM, no React.
 */
import { ShapeUtils, Vector2 } from 'three'
import type { FixtureType, MachineProfile } from '@/core/types'
import { type Aabb, aabbOf, type Convex, frustum, IDENTITY, type Mat3, prism, rotM3 } from '../collision/convex'
import { hull2 } from '../solid/align'
import type { Mesh } from '../mesh/types'
import type { CamPart, Fixture, FixtureKind, FixtureShape, FixtureSlab } from '../types'

/** One convex piece of a fixture, placed in the part. */
export interface FixturePiece {
  c: Convex
  box: Aabb
  /** Index into the fixtures given. */
  fixture: number
  name: string
}

/**
 * Invented examples (PLACEHOLDER sizes, Configure badge) until the shop enters its own: a toggle
 * clamp standing on the table beside the part, a square and a round vacuum pod under it, a rail
 * under the pods.
 */
export const PLACEHOLDER_FIXTURE_TYPES: FixtureType[] = [
  { id: 'fx-clamp', name: 'Toggle clamp (placeholder)', kind: 'clamp', shape: { k: 'block', length: 60, width: 40, height: 50 }, placeholder: true, notes: 'Invented size: stands on the table beside the part.' },
  { id: 'fx-pod', name: 'Vacuum pod 120 x 120 (placeholder)', kind: 'pod', shape: { k: 'block', length: 120, width: 120, height: 100 }, placeholder: true, notes: 'Invented size: stands under the part.' },
  { id: 'fx-pod-round', name: 'Round pod Ø120 (placeholder)', kind: 'pod', shape: { k: 'round', diameter: 120, height: 100 }, placeholder: true, notes: 'Invented size: stands under the part.' },
  { id: 'fx-rail', name: 'Rail (placeholder)', kind: 'rail', shape: { k: 'block', length: 1500, width: 100, height: 50 }, placeholder: true, notes: 'Invented size: runs under the part.' },
]

/** The shop's fixture library (its own, else the invented examples). */
export const fixtureTypesOf = (m: Pick<MachineProfile, 'fixtureTypes'>): FixtureType[] => m.fixtureTypes ?? PLACEHOLDER_FIXTURE_TYPES

export const KIND_NAME: Record<FixtureKind, string> = { clamp: 'Clamp', pod: 'Pod', rail: 'Rail' }

/** How tall a shape is (mm). */
export function shapeHeight(s: FixtureShape): number {
  if (s.k === 'model') return s.slabs.length ? Math.max(...s.slabs.map((q) => q.z1)) : 0
  return s.height
}

/**
 * Where a fixture's base goes by default: a clamp on the table beside the part (the part's
 * underside), a pod or rail straight under the part (its top against the underside).
 */
export function defaultBaseZ(kind: FixtureKind, shape: FixtureShape, thickness: number): number {
  return kind === 'clamp' ? -thickness : -thickness - shapeHeight(shape)
}

/** A new fixture from a library entry, its reference point at (x, y). */
export function fixtureFrom(t: FixtureType, part: Pick<CamPart, 'thickness'>, at: { x: number; y: number }, id: string, n: number): Fixture {
  return {
    id,
    name: `${KIND_NAME[t.kind]} ${n}`,
    kind: t.kind,
    shape: structuredClone(t.shape),
    at: { x: at.x, y: at.y, z: defaultBaseZ(t.kind, t.shape, part.thickness) },
    rot: 0,
    typeId: t.id,
    ...(t.placeholder ? { placeholder: true } : {}),
  }
}

/** Problems with a shape (empty = fine). */
export function shapeProblems(s: FixtureShape): string[] {
  const out: string[] = []
  const pos = (v: number, what: string) => {
    if (!(v > 0) || !Number.isFinite(v)) out.push(`The ${what} must be more than 0.`)
  }
  if (s.k === 'block') {
    pos(s.length, 'length')
    pos(s.width, 'width')
    pos(s.height, 'height')
  } else if (s.k === 'round') {
    pos(s.diameter, 'diameter')
    pos(s.height, 'height')
  } else if (s.k === 'outline') {
    pos(s.height, 'height')
    if (!s.loops.some((l) => l.length >= 6)) out.push('The outline needs a closed shape of at least three points.')
  } else if (!s.slabs.length) out.push('The model gave no slices.')
  return out
}

// ---------------------------------------------------------------------------------------------
// Convex pieces
// ---------------------------------------------------------------------------------------------

/** Signed area of a loop of x, y pairs. */
function loopArea(l: readonly number[]): number {
  let a = 0
  const n = l.length >> 1
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    a += l[2 * i] * l[2 * j + 1] - l[2 * j] * l[2 * i + 1]
  }
  return a / 2
}

function insideLoop(l: readonly number[], x: number, y: number): boolean {
  let inside = false
  const n = l.length >> 1
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = l[2 * i]
    const yi = l[2 * i + 1]
    const xj = l[2 * j]
    const yj = l[2 * j + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Triangles (x, y pairs, 6 numbers each) covering closed loops: loops inside an odd number of others are holes. */
export function loopTriangles(loops: readonly number[][]): number[][] {
  const ok = loops.filter((l) => l.length >= 6 && Math.abs(loopArea(l)) > 1e-9)
  const depth = ok.map((l, i) => ok.filter((o, j) => j !== i && Math.abs(loopArea(o)) > Math.abs(loopArea(l)) && insideLoop(o, l[0], l[1])).length)
  const out: number[][] = []
  ok.forEach((outer, i) => {
    if (depth[i] % 2) return
    const holes = ok.filter((h, j) => depth[j] === depth[i] + 1 && insideLoop(outer, h[0], h[1]))
    const v2 = (l: readonly number[]) => Array.from({ length: l.length >> 1 }, (_, k) => new Vector2(l[2 * k], l[2 * k + 1]))
    const o = v2(outer)
    const hs = holes.map(v2)
    const all = [...o, ...hs.flat()]
    for (const t of ShapeUtils.triangulateShape(o, hs)) out.push(t.flatMap((k) => [all[k].x, all[k].y]))
  })
  return out
}

/** A fixture's convex pieces in its own frame (x, y from the reference point, z up from the base). */
export function shapePieces(s: FixtureShape): { poly?: number[]; z0: number; z1: number; round?: number }[] {
  switch (s.k) {
    case 'block': {
      const a = s.length / 2
      const b = s.width / 2
      return [{ poly: [-a, -b, a, -b, a, b, -a, b], z0: 0, z1: s.height }]
    }
    case 'round':
      return [{ round: s.diameter / 2, z0: 0, z1: s.height }]
    case 'outline':
      return loopTriangles(s.loops).map((t) => ({ poly: t, z0: 0, z1: s.height }))
    case 'model':
      return s.slabs.filter((q) => q.hull.length >= 6 && q.z1 > q.z0).map((q) => ({ poly: q.hull, z0: q.z0, z1: q.z1 }))
  }
}

/** A fixture's placement: rotation about the vertical and its reference point at its base. */
export function fixtureFrame(f: Pick<Fixture, 'at' | 'rot'>): { R: Mat3; o: [number, number, number] } {
  return { R: Math.abs(f.rot) > 1e-12 ? rotM3([0, 0, 1], f.rot) : IDENTITY, o: [f.at.x, f.at.y, f.at.z] }
}

/** Every fixture (not switched off) as convex pieces in the part's frame. */
export function fixturePieces(fixtures: readonly Fixture[] | undefined): FixturePiece[] {
  const out: FixturePiece[] = []
  ;(fixtures ?? []).forEach((f, i) => {
    if (f.off) return
    const { R, o } = fixtureFrame(f)
    for (const p of shapePieces(f.shape)) {
      const c = p.round !== undefined ? frustum([o[0], o[1], o[2]], [0, 0, 1], p.z0, p.z1, p.round, p.round) : prism(p.poly!, o[2] + p.z0, o[2] + p.z1, [o[0], o[1], 0], R)
      out.push({ c, box: aabbOf(c), fixture: i, name: f.name })
    }
  })
  return out
}

/** Outline of a fixture seen from above (closed loops in the part's frame), for the drawing. */
export function fixtureFootprint(f: Pick<Fixture, 'at' | 'rot' | 'shape'>): [number, number][][] {
  const { R } = fixtureFrame(f)
  const place = (x: number, y: number): [number, number] => [f.at.x + R[0][0] * x + R[0][1] * y, f.at.y + R[1][0] * x + R[1][1] * y]
  const s = f.shape
  switch (s.k) {
    case 'block': {
      const a = s.length / 2
      const b = s.width / 2
      return [[place(-a, -b), place(a, -b), place(a, b), place(-a, b)]]
    }
    case 'round':
      return [Array.from({ length: 48 }, (_, k) => place((s.diameter / 2) * Math.cos((k * Math.PI) / 24), (s.diameter / 2) * Math.sin((k * Math.PI) / 24)))]
    case 'outline':
      return s.loops.map((l) => Array.from({ length: l.length >> 1 }, (_, k) => place(l[2 * k], l[2 * k + 1])))
    case 'model': {
      const pts: [number, number][] = []
      for (const q of s.slabs) for (let k = 0; k + 1 < q.hull.length; k += 2) pts.push([q.hull[k], q.hull[k + 1]])
      return pts.length >= 3 ? [hull2(pts).map(([x, y]) => place(x, y))] : []
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Made from drawn shapes or a model
// ---------------------------------------------------------------------------------------------

/**
 * An outline fixture from closed loops drawn on the part (part x, y pairs): the reference point
 * goes to the middle of their extent and the loops are kept relative to it.
 */
export function outlineShape(loops: readonly number[][], height: number): { shape: FixtureShape; at: { x: number; y: number } } {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const l of loops)
    for (let k = 0; k + 1 < l.length; k += 2) {
      x0 = Math.min(x0, l[k])
      x1 = Math.max(x1, l[k])
      y0 = Math.min(y0, l[k + 1])
      y1 = Math.max(y1, l[k + 1])
    }
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const r = (n: number) => Math.round(n * 1e4) / 1e4
  return { shape: { k: 'outline', loops: loops.map((l) => l.map((v, k) => r(k % 2 ? v - cy : v - cx))), height }, at: { x: r(cx), y: r(cy) } }
}

/**
 * A model fixture from a mesh (in mm, z up): cut into `slices` slices between its lowest and
 * highest point, each the convex outline of every point the model has between the slice's two
 * heights (its corners there and where its edges cross the two heights). Its base goes to 0 and it
 * is centred on its reference point.
 */
export function modelShape(mesh: Mesh, file: string, slices = 12): FixtureShape {
  const P = mesh.positions
  const I = mesh.indices
  let lo = [Infinity, Infinity, Infinity]
  let hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < P.length; i += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], P[i + k])
      hi[k] = Math.max(hi[k], P[i + k])
    }
  if (!Number.isFinite(lo[0])) {
    lo = [0, 0, 0]
    hi = [0, 0, 0]
  }
  const cx = (lo[0] + hi[0]) / 2
  const cy = (lo[1] + hi[1]) / 2
  const H = hi[2] - lo[2]
  const n = Math.max(1, Math.min(64, Math.round(slices)))
  const slabs: FixtureSlab[] = []
  const r = (v: number) => Math.round(v * 1e4) / 1e4
  for (let s = 0; s < n; s++) {
    const z0 = lo[2] + (H * s) / n
    const z1 = lo[2] + (H * (s + 1)) / n
    const pts: [number, number][] = []
    for (let i = 0; i < P.length; i += 3) if (P[i + 2] >= z0 - 1e-9 && P[i + 2] <= z1 + 1e-9) pts.push([P[i] - cx, P[i + 1] - cy])
    // where the edges cross the slice's two heights
    for (let t = 0; t + 2 < I.length; t += 3)
      for (let e = 0; e < 3; e++) {
        const a = I[t + e] * 3
        const b = I[t + ((e + 1) % 3)] * 3
        for (const z of [z0, z1]) {
          const za = P[a + 2]
          const zb = P[b + 2]
          if ((za - z) * (zb - z) >= 0 || za === zb) continue
          const k = (z - za) / (zb - za)
          pts.push([P[a] + (P[b] - P[a]) * k - cx, P[a + 1] + (P[b + 1] - P[a + 1]) * k - cy])
        }
      }
    if (pts.length < 3) continue
    const h = hull2(pts)
    if (h.length < 3) continue
    slabs.push({ z0: r(z0 - lo[2]), z1: r(z1 - lo[2]), hull: h.flatMap(([x, y]) => [r(x), r(y)]) })
  }
  return { k: 'model', slabs, file, triangles: I.length / 3, size: [r(hi[0] - lo[0]), r(hi[1] - lo[1]), r(H)] }
}
