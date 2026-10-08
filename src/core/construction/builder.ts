import { EPS, frameFromBox, neg, r3, toLocal, vecEq, type Box3 } from '../geometry'
import type { DrillOp, EdgeKey, GrooveOp, HDrillDir, HDrillOp, Library, OpPurpose, Part, PartRole, Vec2, Vec3 } from '../types'

/** Builds one flat part from a world-space box: holes, grooves, edgebands and corner notches given in world coordinates. */
export class PartBuilder {
  part: Part
  private seq = 0
  constructor(key: string, name: string, role: PartRole, materialId: string, box: Box3, u: Vec3, n: Vec3, grain: 'length' | 'none') {
    const f = frameFromBox(box, u, n)
    this.part = {
      key,
      name,
      role,
      materialId,
      length: f.length,
      width: f.width,
      thickness: f.thickness,
      grain,
      edges: {},
      ops: [],
      frame: f.frame,
    }
  }

  private nextId() {
    this.seq += 1
    return `${this.part.key}-${this.seq}`
  }

  private inside(x: number, y: number) {
    return x >= -EPS && y >= -EPS && x <= this.part.length + EPS && y <= this.part.width + EPS
  }

  /** Vertical hole whose entry point `p` lies on the face-up face. */
  drill(p: Vec3, diameter: number, depth: number, purpose: OpPurpose, through = false) {
    const l = toLocal(this.part.frame, p)
    if (!this.inside(l.x, l.y)) return
    const dup = this.part.ops.some(
      (o) => o.kind === 'drill' && Math.abs(o.x - l.x) < 0.01 && Math.abs(o.y - l.y) < 0.01 && o.diameter === diameter,
    )
    if (dup) return
    const op: DrillOp = {
      kind: 'drill',
      id: this.nextId(),
      x: l.x,
      y: l.y,
      diameter,
      depth: through ? this.part.thickness : depth,
      through,
      purpose,
    }
    this.part.ops.push(op)
  }

  /** Horizontal hole into an edge. `p` is the entry point on the edge, `dir` the world drilling direction. */
  hdrill(p: Vec3, dir: Vec3, diameter: number, depth: number, purpose: OpPurpose) {
    const l = toLocal(this.part.frame, p)
    const f = this.part.frame
    let d: HDrillDir
    if (vecEq(dir, f.u)) d = 'XP'
    else if (vecEq(dir, neg(f.u))) d = 'XM'
    else if (vecEq(dir, f.v)) d = 'YP'
    else if (vecEq(dir, neg(f.v))) d = 'YM'
    else throw new Error(`hdrill direction not in part plane for ${this.part.key}`)
    const op: HDrillOp = { kind: 'hdrill', id: this.nextId(), x: l.x, y: l.y, z: l.depth, diameter, depth, dir: d, purpose }
    this.part.ops.push(op)
  }

  /** Recess defined as a world-space box intersecting the face-up face. */
  groove(box: Box3, purpose: OpPurpose) {
    const corners: Vec3[] = []
    for (const x of [box.min[0], box.max[0]])
      for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]]) corners.push([x, y, z])
    const loc = corners.map((c) => toLocal(this.part.frame, c))
    const L = this.part.length
    const W = this.part.width
    const x1 = Math.max(0, Math.min(...loc.map((c) => c.x)))
    const x2 = Math.min(L, Math.max(...loc.map((c) => c.x)))
    const y1 = Math.max(0, Math.min(...loc.map((c) => c.y)))
    const y2 = Math.min(W, Math.max(...loc.map((c) => c.y)))
    const depth = Math.max(...loc.map((c) => c.depth))
    if (x2 - x1 < EPS || y2 - y1 < EPS || depth < EPS) return
    const op: GrooveOp = {
      kind: 'groove',
      id: this.nextId(),
      x1: r3(x1),
      y1: r3(y1),
      x2: r3(x2),
      y2: r3(y2),
      depth: r3(depth),
      open: { x1: x1 < EPS, x2: x2 > L - EPS, y1: y1 < EPS, y2: y2 > W - EPS },
      purpose,
    }
    this.part.ops.push(op)
  }

  /** Band the edge whose outward normal points along world direction `dir`. */
  band(dir: Vec3, bandId: string | null) {
    if (!bandId) return
    const k = this.edgeOf(dir)
    if (k) this.part.edges[k] = bandId
  }

  /** The edge whose outward normal points along world direction `dir`. */
  edgeOf(dir: Vec3): EdgeKey | null {
    const f = this.part.frame
    if (vecEq(dir, neg(f.v))) return 'L1'
    if (vecEq(dir, f.v)) return 'L2'
    if (vecEq(dir, neg(f.u))) return 'W1'
    if (vecEq(dir, f.u)) return 'W2'
    return null
  }

  bandAll(bandId: string | null) {
    if (!bandId) return
    for (const k of ['L1', 'L2', 'W1', 'W2'] as EdgeKey[]) this.part.edges[k] = bandId
  }

  /** Remove a corner notch (world box) from the outline. Only corner notches are supported. */
  notch(box: Box3) {
    const loc = [box.min, box.max].map((c) => toLocal(this.part.frame, c))
    const L = this.part.length
    const W = this.part.width
    const nx1 = Math.max(0, Math.min(loc[0].x, loc[1].x))
    const nx2 = Math.min(L, Math.max(loc[0].x, loc[1].x))
    const ny1 = Math.max(0, Math.min(loc[0].y, loc[1].y))
    const ny2 = Math.min(W, Math.max(loc[0].y, loc[1].y))
    if (nx2 - nx1 < EPS || ny2 - ny1 < EPS) return
    const atX0 = nx1 < EPS
    const atY0 = ny1 < EPS
    const atXL = nx2 > L - EPS
    const atYW = ny2 > W - EPS
    let poly: Vec2[]
    if (atX0 && atY0) poly = [{ x: nx2, y: 0 }, { x: L, y: 0 }, { x: L, y: W }, { x: 0, y: W }, { x: 0, y: ny2 }, { x: nx2, y: ny2 }]
    else if (atX0 && atYW) poly = [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: W }, { x: nx2, y: W }, { x: nx2, y: ny1 }, { x: 0, y: ny1 }]
    else if (atXL && atY0) poly = [{ x: 0, y: 0 }, { x: nx1, y: 0 }, { x: nx1, y: ny2 }, { x: L, y: ny2 }, { x: L, y: W }, { x: 0, y: W }]
    else if (atXL && atYW) poly = [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: ny1 }, { x: nx1, y: ny1 }, { x: nx1, y: W }, { x: 0, y: W }]
    else throw new Error(`notch on ${this.part.key} is not at a corner`)
    this.part.outline = poly.map((p) => ({ x: r3(p.x), y: r3(p.y) }))
  }
}

export const box = (min: Vec3, max: Vec3): Box3 => ({ min, max })

export function materialThickness(lib: Library, id: string, warnings: string[], fallback: number) {
  const m = lib.materials.find((mm) => mm.id === id)
  if (!m) {
    warnings.push(`Material "${id}" is not in the library; using ${fallback} mm.`)
    return fallback
  }
  return m.thickness
}

