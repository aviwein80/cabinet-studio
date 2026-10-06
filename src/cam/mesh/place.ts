/**
 * Placing a model in the part, choosing which way is up, and fitting the work volume to it.
 */
import type { CamPart, ModelPlacement, ModelRef, UpAxis } from '../types'
import { type Box3, type Mesh, meshBounds } from './types'

/** Rotation that turns the given axis to +Z (proper rotations: no mirroring). */
function upMap(up: UpAxis): (x: number, y: number, z: number) => [number, number, number] {
  switch (up) {
    case '+z':
      return (x, y, z) => [x, y, z]
    case '-z':
      return (x, y, z) => [x, -y, -z]
    case '+y':
      return (x, y, z) => [x, -z, y]
    case '-y':
      return (x, y, z) => [x, z, -y]
    case '+x':
      return (x, y, z) => [-z, y, x]
    case '-x':
      return (x, y, z) => [z, y, -x]
  }
}

export const DEFAULT_PLACEMENT: ModelPlacement = { up: '+z', rotZ: 0, scale: 1, mirror: false, at: [0, 0, 0] }

/** Up axis that lays the model flat: its thinnest direction becomes Z. */
export function autoUp(mesh: Mesh): UpAxis {
  const b = meshBounds(mesh)
  const d = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]
  if (d[2] <= d[0] && d[2] <= d[1]) return '+z'
  return d[1] <= d[0] ? '+y' : '+x'
}

/** Rotated, scaled and mirrored positions, before the final move. */
function oriented(mesh: Mesh, p: ModelPlacement): Float32Array {
  const m = upMap(p.up)
  const a = (p.rotZ * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  const k = p.scale > 0 ? p.scale : 1
  const src = mesh.positions
  const out = new Float32Array(src.length)
  const f = p.frame && p.frame.length === 9 ? p.frame : null
  for (let i = 0; i < src.length; i += 3) {
    const sx = src[i]
    const sy = src[i + 1]
    const sz = src[i + 2]
    const [x, y, z] = f ? m(f[0] * sx + f[1] * sy + f[2] * sz, f[3] * sx + f[4] * sy + f[5] * sz, f[6] * sx + f[7] * sy + f[8] * sz) : m(sx, sy, sz)
    const xr = (x * c - y * s) * k
    out[i] = p.mirror ? -xr : xr
    out[i + 1] = (x * s + y * c) * k
    out[i + 2] = z * k
  }
  return out
}

/** The model in part coordinates. */
export function placeMesh(mesh: Mesh, p: ModelPlacement): Mesh {
  const pos = oriented(mesh, p)
  const b = meshBounds({ positions: pos })
  const dx = p.at[0] - b.min[0]
  const dy = p.at[1] - b.min[1]
  const dz = p.at[2] - b.max[2]
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] += dx
    pos[i + 1] += dy
    pos[i + 2] += dz
  }
  let indices = mesh.indices
  if (p.mirror) {
    indices = mesh.indices.slice()
    for (let t = 0; t < indices.length; t += 3) {
      const v = indices[t + 1]
      indices[t + 1] = indices[t + 2]
      indices[t + 2] = v
    }
  }
  return { ...mesh, positions: pos, indices }
}

/**
 * Points given in a model's stored coordinates (x, y, z triples), moved the way `placeMesh` moves a
 * model whose stored mesh fills `box`.
 */
export function placePoints(pts: Float64Array | Float32Array, box: Box3, p: ModelPlacement): Float32Array {
  const corners: number[] = []
  for (let i = 0; i < 8; i++) corners.push(i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2])
  const cb = meshBounds({ positions: oriented({ positions: Float32Array.from(corners), indices: new Uint32Array(0) }, p) })
  const out = oriented({ positions: Float32Array.from(pts), indices: new Uint32Array(0) }, p)
  const dx = p.at[0] - cb.min[0]
  const dy = p.at[1] - cb.min[1]
  const dz = p.at[2] - cb.max[2]
  for (let i = 0; i < out.length; i += 3) {
    out[i] += dx
    out[i + 1] += dy
    out[i + 2] += dz
  }
  return out
}

/** Size (dx, dy, dz) of the model once turned and scaled. */
export function placedSize(mesh: Mesh, p: ModelPlacement): [number, number, number] {
  const b = meshBounds({ positions: oriented(mesh, p) })
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]
}

export function placedBounds(model: Pick<ModelRef, 'place'>, size: [number, number, number]): Box3 {
  const [x, y, z] = model.place.at
  return { min: [x, y, z - size[2]], max: [x + size[0], y + size[1], z] }
}

/**
 * Footprint of a placed model from its stored size alone (no mesh needed; `size` is measured
 * after the placement's `frame` turn): exact when the turn
 * about Z is a multiple of 90 degrees, otherwise the box around the turned bounding box.
 */
export function modelFootprint(model: Pick<ModelRef, 'place' | 'size'>): { x: number; y: number; dx: number; dy: number; top: number; bottom: number } {
  const [sx, sy, sz] = model.size
  const corners: number[] = []
  for (let i = 0; i < 8; i++) corners.push(i & 1 ? sx : 0, i & 2 ? sy : 0, i & 4 ? sz : 0)
  const b = meshBounds({ positions: oriented({ positions: Float32Array.from(corners), indices: new Uint32Array(0) }, { ...model.place, frame: undefined }) })
  const [x, y, z] = model.place.at
  return { x, y, dx: b.max[0] - b.min[0], dy: b.max[1] - b.min[1], top: z, bottom: z - (b.max[2] - b.min[2]) }
}

export interface Oversize {
  /** Added on every side in X and Y. */
  xy: number
  /** Material above the model's top. */
  top: number
  /** Material left under the model's lowest point. */
  bottom: number
}

/**
 * Fit the part's work volume (length, width, thickness) to a model plus oversize, and move the
 * model to the middle of it in X/Y with `top` mm of material above it. A plain rectangular
 * outline that matched the old size is resized with it.
 */
export function fitWorkVolumeToModel(part: CamPart, modelId: string, size: [number, number, number], over: Oversize): CamPart {
  const model = part.models?.find((m) => m.id === modelId)
  if (!model) return part
  const r3 = (n: number) => Math.round(n * 1000) / 1000
  const length = r3(size[0] + 2 * over.xy)
  const width = r3(size[1] + 2 * over.xy)
  const thickness = r3(size[2] + over.top + over.bottom)
  const models = part.models!.map((m) => (m.id === modelId ? { ...m, place: { ...m.place, at: [r3(over.xy), r3(over.xy), r3(-over.top)] as [number, number, number] } } : m))
  const outline = part.entities.find((e) => e.id === part.outlineId)
  let entities = part.entities
  if (outline?.g.t === 'contour' && isRect(outline.g.c.segs, part.length, part.width)) {
    entities = part.entities.map((e) =>
      e.id === outline.id
        ? {
            ...e,
            g: {
              t: 'contour' as const,
              c: {
                closed: true,
                segs: [
                  { k: 'L' as const, a: { x: 0, y: 0 }, b: { x: length, y: 0 } },
                  { k: 'L' as const, a: { x: length, y: 0 }, b: { x: length, y: width } },
                  { k: 'L' as const, a: { x: length, y: width }, b: { x: 0, y: width } },
                  { k: 'L' as const, a: { x: 0, y: width }, b: { x: 0, y: 0 } },
                ],
              },
            },
          }
        : e,
    )
  }
  return { ...part, length, width, thickness, models, entities, workVolume: { modelId, oversize: { ...over } } }
}

function isRect(segs: { k: string; a: { x: number; y: number }; b: { x: number; y: number } }[], L: number, W: number) {
  if (segs.length !== 4 || segs.some((s) => s.k !== 'L')) return false
  const pts = segs.map((s) => `${Math.round(s.a.x * 1000)},${Math.round(s.a.y * 1000)}`).sort()
  const want = [`0,0`, `0,${Math.round(W * 1000)}`, `${Math.round(L * 1000)},0`, `${Math.round(L * 1000)},${Math.round(W * 1000)}`].sort()
  return pts.join('|') === want.join('|')
}
