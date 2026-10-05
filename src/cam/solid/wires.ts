/**
 * Wires and surfaces from a solid (CAD-16, NEW-19): the edges where faces meet as 3D polylines,
 * a 2D contour from picked edges, faces as a surface of their own, a face untrimmed to its whole
 * underlying surface, a fillet between two flat faces, the solid as a plain mesh. All in the part
 * frame (see `placementFrame`).
 */
import { filletPlanes, gridMesh, segmentsFor } from '../mesh/surface'
import type { Mesh } from '../mesh/types'
import { type PanelFrame, toPart } from './align'
import { basisOf, cross3, dot3, topology, unit3 } from './classify'
import type { SolidBody, V3 } from './types'

export { contourFromEdges } from '../mesh/poly3d'

export interface SolidEdge {
  /** The two faces it divides (b = 0: an open edge). */
  a: number
  b: number
  pts: V3[]
  /** Angle between the faces' surfaces along it, degrees (0 = smooth). */
  angle: number
}

/**
 * Edges between faces as 3D polylines (one per pair of faces and connected run). With `faces`,
 * only edges of those faces. Smooth joins (under `minAngle` degrees) are left out.
 */
export function solidEdges(body: SolidBody, frame: Pick<PanelFrame, 'R' | 'origin'>, opt: { faces?: number[]; minAngle?: number } = {}): SolidEdge[] {
  const topo = topology(body)
  const pp = topo.points.map((p) => toPart(frame, p))
  const R = frame.R
  const nrm = (f: number, i: number): V3 => {
    // normal of face f at welded point i: exact from its surface; else the face's vertex normal
    const face = body.faces.find((x) => x.id === f)!
    const exact = surfaceNormal(face.surface, topo.points[i])
    if (exact) return [dot3(R[0], exact), dot3(R[1], exact), dot3(R[2], exact)]
    for (let t = face.first; t <= face.last; t++)
      for (let k = 0; k < 3; k++) {
        const v = body.indices[t * 3 + k]
        if (topo.weld[v] === i) {
          const n: V3 = [body.normals[v * 3], body.normals[v * 3 + 1], body.normals[v * 3 + 2]]
          return [dot3(R[0], n), dot3(R[1], n), dot3(R[2], n)]
        }
      }
    return [0, 0, 1]
  }
  const out: SolidEdge[] = []
  const done = new Set<string>()
  for (const [fid, fl] of topo.loops) {
    if (opt.faces && !opt.faces.includes(fid)) continue
    for (const loop of fl.loops) {
      // runs of edges along one neighbour
      let s0 = 0
      for (let i = 0; i < loop.length; i++)
        if (loop[i].other !== loop[(i + loop.length - 1) % loop.length].other) {
          s0 = i
          break
        }
      const ring = [...loop.slice(s0), ...loop.slice(0, s0)]
      let i = 0
      while (i < ring.length) {
        let j = i
        while (j + 1 < ring.length && ring[j + 1].other === ring[i].other) j++
        const other = ring[i].other
        const key = `${Math.min(fid, other)}_${Math.max(fid, other)}_${Math.min(ring[i].a, ring[j].b)}_${Math.max(ring[i].a, ring[j].b)}`
        if (!done.has(key)) {
          done.add(key)
          const ids = [ring[i].a, ...ring.slice(i, j + 1).map((e) => e.b)]
          const mid = ids[Math.floor(ids.length / 2)]
          const angle = other ? (Math.acos(Math.max(-1, Math.min(1, dot3(unit3(nrm(fid, mid)), unit3(nrm(other, mid)))))) * 180) / Math.PI : 180
          if (angle >= (opt.minAngle ?? 1)) out.push({ a: fid, b: other, pts: ids.map((k) => pp[k].map((v) => Math.round(v * 1e6) / 1e6) as V3), angle })
        }
        i = j + 1
      }
    }
  }
  return out
}

/** Outward normal of a classified surface at a point on it (file coordinates); null for free-form. */
export function surfaceNormal(s: SolidBody['faces'][number]['surface'], p: V3): V3 | null {
  const out = (v: V3, concave?: boolean): V3 => (concave ? [-v[0], -v[1], -v[2]] : v)
  switch (s.kind) {
    case 'plane':
      return s.n!
    case 'cylinder': {
      const d = sub3(p, s.p!)
      return out(unit3(sub3(d, mul3(s.v!, dot3(d, s.v!)))), s.concave)
    }
    case 'cone': {
      const d = sub3(p, s.p!)
      const radial = unit3(sub3(d, mul3(s.v!, dot3(d, s.v!))))
      // square to the cone's side: radial tipped back along the axis by the half-angle
      return out(unit3(sub3(mul3(radial, Math.cos(s.angle!)), mul3(s.v!, Math.sin(s.angle!)))), s.concave)
    }
    case 'sphere':
      return out(unit3(sub3(p, s.p!)), s.concave)
    default:
      return null
  }
}

/** The picked faces as a surface of their own (part frame). */
export function facesMesh(body: SolidBody, frame: Pick<PanelFrame, 'R' | 'origin'>, faces: number[]): Mesh {
  const use = body.faces.filter((f) => faces.includes(f.id))
  const map = new Map<number, number>()
  const pos: number[] = []
  const idx: number[] = []
  const groups: number[] = []
  for (const f of use)
    for (let t = f.first; t <= f.last; t++) {
      for (let k = 0; k < 3; k++) {
        const v = body.indices[t * 3 + k]
        let m = map.get(v)
        if (m === undefined) {
          m = pos.length / 3
          map.set(v, m)
          pos.push(...toPart(frame, [body.positions[v * 3], body.positions[v * 3 + 1], body.positions[v * 3 + 2]]))
        }
        idx.push(m)
      }
      groups.push(f.id)
    }
  const groupNames: string[] = []
  for (const f of use) groupNames[f.id] = `Face ${f.id}`
  for (let i = 0; i < groupNames.length; i++) groupNames[i] ??= ''
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx), groups: Uint32Array.from(groups), groupNames }
}

/**
 * A face untrimmed: its whole underlying surface without the holes and cut edges. Flat face: the
 * rectangle round it in its plane; round face: the whole cylinder (or cone) over its height;
 * sphere: the whole sphere.
 */
export function untrimFace(body: SolidBody, frame: Pick<PanelFrame, 'R' | 'origin'>, face: number, tol = 0.01): Mesh {
  const f = body.faces.find((x) => x.id === face)
  if (!f) throw new Error(`Face ${face} is not in this body.`)
  const s = f.surface
  const pts: V3[] = []
  for (let t = f.first; t <= f.last; t++)
    for (let k = 0; k < 3; k++) {
      const v = body.indices[t * 3 + k]
      pts.push([body.positions[v * 3], body.positions[v * 3 + 1], body.positions[v * 3 + 2]])
    }
  const P = (p: V3) => toPart(frame, p)
  if (s.kind === 'plane') {
    const [e1, e2] = basisOf(s.n!)
    const us = pts.map((p) => dot3(p, e1))
    const vs = pts.map((p) => dot3(p, e2))
    const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)]
    const at = (u: number, v: number): V3 => P([s.n![0] * s.d! + e1[0] * u + e2[0] * v, s.n![1] * s.d! + e1[1] * u + e2[1] * v, s.n![2] * s.d! + e1[2] * u + e2[2] * v])
    // a rectangle facing the same way as the face
    const m = gridMesh([
      [at(u0, v0), at(u1, v0)],
      [at(u0, v1), at(u1, v1)],
    ])
    return orientLike(m, P(add3(mul3(s.n!, s.d!), s.n!)), P(mul3(s.n!, s.d!)))
  }
  if (s.kind === 'cylinder' || s.kind === 'cone') {
    const v = s.v!
    const [e1, e2] = basisOf(v)
    const hs = pts.map((p) => dot3(sub3(p, s.p!), v))
    const [h0, h1] = [Math.min(...hs), Math.max(...hs)]
    const radiusAt = (h: number) => (s.kind === 'cylinder' ? s.r! : Math.abs(h) * Math.tan(s.angle!))
    const n = Math.max(8, segmentsFor(Math.max(radiusAt(h0), radiusAt(h1)), 2 * Math.PI, tol))
    const rows: V3[][] = []
    for (const h of [h0, h1]) {
      const r = radiusAt(h)
      const row: V3[] = []
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n
        row.push(P(add3(add3(s.p!, mul3(v, h)), add3(mul3(e1, r * Math.cos(a)), mul3(e2, r * Math.sin(a))))))
      }
      rows.push(row)
    }
    return gridMesh(rows, false, true)
  }
  if (s.kind === 'sphere') {
    const r = s.r!
    const n = Math.max(8, segmentsFor(r, 2 * Math.PI, tol))
    const m = Math.max(4, Math.ceil(n / 2))
    const rows: V3[][] = []
    for (let i = 0; i <= m; i++) {
      const phi = (Math.PI * i) / m
      const row: V3[] = []
      for (let j = 0; j < n; j++) {
        const th = (2 * Math.PI * j) / n
        row.push(P([s.p![0] + r * Math.sin(phi) * Math.cos(th), s.p![1] + r * Math.sin(phi) * Math.sin(th), s.p![2] + r * Math.cos(phi)]))
      }
      rows.push(row)
    }
    return gridMesh(rows, false, true)
  }
  throw new Error(`Face ${face} is free-form: untrimming it needs its surface definition, which the reader does not give. Use "Surface from faces" instead.`)
}

const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mul3 = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]

/** Turn the triangles to face from `inside` towards `outside`. */
function orientLike(m: Mesh, outside: V3, inside: V3): Mesh {
  const want = sub3(outside, inside)
  const p = m.positions
  const [a, b, c] = [m.indices[0], m.indices[1], m.indices[2]]
  const A: V3 = [p[a * 3], p[a * 3 + 1], p[a * 3 + 2]]
  const n = cross3(sub3([p[b * 3], p[b * 3 + 1], p[b * 3 + 2]], A), sub3([p[c * 3], p[c * 3 + 1], p[c * 3 + 2]], A))
  if (dot3(n, want) >= 0) return m
  const idx = m.indices.slice()
  for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]]
  return { ...m, indices: idx }
}

/**
 * Round the edge between two flat faces of a solid with radius r: the fillet surface, along their
 * shared edge. Outside edges and inside corners are both handled.
 */
export function filletFaces(body: SolidBody, frame: Pick<PanelFrame, 'R' | 'origin'>, faceA: number, faceB: number, r: number, tol = 0.01): Mesh {
  const A = body.faces.find((f) => f.id === faceA)
  const B = body.faces.find((f) => f.id === faceB)
  if (!A || !B || A.surface.kind !== 'plane' || B.surface.kind !== 'plane') throw new Error('Pick two flat faces that meet at an edge.')
  const edges = solidEdges(body, frame, { faces: [faceA], minAngle: 0 }).filter((e) => e.b === faceB)
  if (!edges.length) throw new Error(`Faces ${faceA} and ${faceB} do not share an edge.`)
  const e = edges.reduce((x, y) => (y.pts.length > x.pts.length ? y : x))
  const ends: [V3, V3] = [e.pts[0], e.pts[e.pts.length - 1]]
  const R = frame.R
  const rot = (v: V3): V3 => [dot3(R[0], v), dot3(R[1], v), dot3(R[2], v)]
  const nA = rot(A.surface.n!)
  const nB = rot(B.surface.n!)
  // inside corner when face B's material lies on the far side of face A's plane... tested with a point of B
  const pB = (() => {
    let best: V3 = ends[0]
    let far = -1
    for (let t = B.first; t <= B.last; t++) {
      const v = body.indices[t * 3]
      const q = toPart(frame, [body.positions[v * 3], body.positions[v * 3 + 1], body.positions[v * 3 + 2]])
      const d = Math.hypot(...sub3(q, ends[0]))
      if (d > far) {
        far = d
        best = q
      }
    }
    return best
  })()
  const concave = dot3(nA, sub3(pB, ends[0])) > 1e-9
  return filletPlanes({ p: ends[0], n: nA }, { p: ends[0], n: nB }, ends, r, { concave, tol })
}
