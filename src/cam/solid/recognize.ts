/**
 * Feature recognition on a solid panel (SOL-01): the outer outline, cut-outs through the panel,
 * pockets (depth and floor, islands), blind and through holes (diameter, depth, face, drill point),
 * holes in the edges, and pockets from the underside. Everything is read from the faces' exact
 * surfaces and the loops where they meet, so shapes come out as true lines and arcs and depths as
 * exact numbers, not as samples of the triangles.
 *
 * Works in the part frame from `panelFrame` (face 1 at z = 0, down negative, origin at the lowest
 * x and y). A wall is any face that is not flat and level; walls are followed from a floor up to
 * the face above to find a pocket's outline (so a rounded floor edge does not shrink it).
 */
import { arc, area, type Contour, fitPoints, line, type P, pt, radius, rp, type Seg, sweep } from '../geom'
import { boolean, offset } from '../kernel'
import { panelFrame, toPart, type AlignOptions, type PanelFrame } from './align'
import { dot3, type LoopEdge, topology } from './classify'
import type { SolidBody, V3 } from './types'

export type FeatureFace = 1 | 2 | 3 | 4 | 5 | 6

export interface RecognizedHole {
  /** Centre: part x, y for faces 1 and 6; for edge faces 2-5 the edge (u, v) as Stage 1 uses. */
  x: number
  y: number
  d: number
  /** From the face it is drilled from to the end of the round wall (the drill's shoulder). */
  depth: number
  /** To the drill point's tip, when the floor is a cone. */
  tipDepth?: number
  /** Included angle of the drill point (degrees). */
  tipAngle?: number
  through: boolean
  face: FeatureFace
  floor: 'flat' | 'cone' | 'none' | 'other'
  faces: number[]
  /** No drill of that size in the tool table: shown, not machined. */
  noTool?: boolean
}

export interface RecognizedPocket {
  /** From face 1 (or, for `face` 6, from the underside) to the floor. */
  depth: number
  face: 1 | 6
  contour: Contour
  islands: Contour[]
  /** Floor face id. */
  floor: number
  faces: number[]
  /** The pocket runs out to the panel's edge (a rebate). */
  open: boolean
  /** Smallest radius of its outline's arcs (inside corners), mm (Infinity when none). */
  minRadius: number
}

export interface RecognizedCutout {
  contour: Contour
  faces: number[]
}

export interface Recognition {
  frame: PanelFrame
  outline: Contour
  outlineFaces: number[]
  holes: RecognizedHole[]
  pockets: RecognizedPocket[]
  cutouts: RecognizedCutout[]
  /** Faces no feature explains (sloped, free-form, bosses...). */
  unrecognised: { face: number; why: string }[]
  warnings: string[]
}

export interface RecognizeOptions {
  frame?: PanelFrame
  align?: AlignOptions
  /**
   * Vertical drill diameters available (the tool table). A round hole of another size is made a
   * round pocket or cut-out instead. Absent: holes up to 35 mm are drill holes.
   */
  drills?: number[]
  /** Horizontal drill diameters for edge holes (absent: as `drills`). */
  edgeDrills?: number[]
}

type Kind = 'up' | 'down' | 'vwall' | 'vcyl' | 'hcyl' | 'cone' | 'other'

export interface FaceInfo {
  id: number
  kind: Kind
  zmin: number
  zmax: number
  /** Vertical or horizontal cylinders: axis point in the part frame, axis, radius, concave. */
  c?: V3
  v?: V3
  r?: number
  concave?: boolean
  /** Cones: apex in the part frame, half-angle. */
  apex?: V3
  angle?: number
  verts: number[]
}

const DIR = 1e-6
/**
 * How far a rebate's shape reaches past the panel's edge, mm. A 12 mm cutter then runs with its
 * centre on the edge (the floor is cleared right to it); cutters from 6 mm up keep their centre
 * within the export checker's limit (radius + 0.5 mm outside the part), so they cannot reach a
 * neighbouring part on the sheet; smaller cutters are refused by the checker (OP_OUTSIDE).
 */
export const OPEN_REACH = 6
const EPS = 1e-4
const r6 = (n: number) => Math.round(n * 1e6) / 1e6

/**
 * A body in a part frame: each face's kind and height range, its boundary loops, and helpers to
 * follow walls and turn loops into exact contours. Shared by recognition and face machining.
 */
export function panelContext(body: SolidBody, frame: Pick<PanelFrame, 'R' | 'origin' | 'thickness' | 'length' | 'width'>) {
  const T = frame.thickness
  const topo = topology(body)
  const pp = topo.points.map((p) => toPart(frame, p))
  const R = frame.R
  const rot = (v: V3): V3 => [dot3(R[0], v), dot3(R[1], v), dot3(R[2], v)]

  // ---- faces in the part frame -------------------------------------------------------------
  const info = new Map<number, FaceInfo>()
  for (const f of body.faces) {
    const vs = new Set<number>()
    for (let t = f.first; t <= f.last; t++) for (let k = 0; k < 3; k++) vs.add(topo.weld[body.indices[t * 3 + k]])
    const verts = [...vs]
    let zmin = Infinity
    let zmax = -Infinity
    for (const v of verts) {
      zmin = Math.min(zmin, pp[v][2])
      zmax = Math.max(zmax, pp[v][2])
    }
    const s = f.surface
    let kind: Kind = 'other'
    const fi: FaceInfo = { id: f.id, kind, zmin, zmax, verts }
    if (s.kind === 'plane') {
      const n = rot(s.n!)
      kind = n[2] > 1 - DIR ? 'up' : n[2] < -1 + DIR ? 'down' : Math.abs(n[2]) < DIR ? 'vwall' : 'other'
    } else if (s.kind === 'cylinder') {
      const v = rot(s.v!)
      const c = toPart(frame, s.p!)
      if (Math.abs(Math.abs(v[2]) - 1) < DIR) kind = 'vcyl'
      else if (Math.abs(v[2]) < DIR) kind = 'hcyl'
      Object.assign(fi, { c, v, r: s.r, concave: s.concave })
    } else if (s.kind === 'cone') {
      kind = 'cone'
      Object.assign(fi, { apex: toPart(frame, s.p!), v: rot(s.v!), angle: s.angle, concave: s.concave })
    }
    fi.kind = kind
    info.set(f.id, fi)
  }
  const isLevel = (id: number) => {
    const k = info.get(id)?.kind
    return k === 'up' || k === 'down'
  }
  const level = (id: number) => (info.get(id)!.zmin + info.get(id)!.zmax) / 2

  /** Walls reached from `start` without crossing level faces; and the level faces met. */
  const flood = (start: Iterable<number>) => {
    const walls = new Set<number>()
    const levels = new Set<number>()
    const todo = [...start]
    while (todo.length) {
      const f = todo.pop()!
      if (isLevel(f)) {
        levels.add(f)
        continue
      }
      if (walls.has(f)) continue
      walls.add(f)
      for (const g of topo.neighbours.get(f) ?? []) todo.push(g)
    }
    return { walls, levels }
  }

  const loopsOf = (id: number) => topo.loops.get(id)?.loops ?? []
  const loopArea = (loop: LoopEdge[]) => {
    let a = 0
    for (const e of loop) {
      const p = pp[e.a]
      const q = pp[e.b]
      a += p[0] * q[1] - q[0] * p[1]
    }
    return a / 2
  }
  const outerLoop = (id: number) => {
    const ls = loopsOf(id)
    return ls.length ? ls.reduce((b, l) => (Math.abs(loopArea(l)) > Math.abs(loopArea(b)) ? l : b)) : null
  }
  const contourOf = (loop: LoopEdge[]) => loopContour(loop, pp, info)
  return { T, topo, pp, info, isLevel, level, flood, loopsOf, loopArea, outerLoop, contourOf }
}

export type PanelContext = ReturnType<typeof panelContext>

export function recognizePanel(body: SolidBody, opt: RecognizeOptions = {}): Recognition {
  const frame = opt.frame ?? panelFrame(body, opt.align)
  const warnings = [...frame.warnings]
  const L = frame.length
  const W = frame.width
  const { T, topo, pp, info, level, flood, loopsOf, loopArea, outerLoop, contourOf } = panelContext(body, frame)
  const used = new Set<number>()

  // ---- holes (round, 360° walls), faces 1 and 6 ------------------------------------------------
  const holes: RecognizedHole[] = []
  const cutoutsRound: RecognizedCutout[] = []
  const roundPockets: RecognizedPocket[] = []
  const vDrills = opt.drills
  const hDrills = opt.edgeDrills ?? opt.drills
  const isDrill = (d: number, list?: number[]) => (list ? list.some((x) => Math.abs(x - d) < 0.01) : d <= 35 + 1e-6)
  for (const group of roundGroups([...info.values()].filter((f) => f.kind === 'vcyl' && f.concave), pp)) {
    const f0 = group[0]
    const c = f0.c!
    const r = f0.r!
    const ztop = Math.max(...group.map((f) => f.zmax))
    const zbot = Math.min(...group.map((f) => f.zmin))
    const ids = group.map((f) => f.id)
    const around = new Set<number>()
    for (const id of ids) for (const g of topo.neighbours.get(id) ?? []) if (!ids.includes(g)) around.add(g)
    const atTop = [...around].filter((g) => Math.abs(info.get(g)!.zmax - ztop) < EPS || Math.abs(info.get(g)!.zmin - ztop) < EPS)
    const atBot = [...around].filter((g) => Math.abs(info.get(g)!.zmin - zbot) < EPS || Math.abs(info.get(g)!.zmax - zbot) < EPS)
    const opensUp = atTop.some((g) => info.get(g)!.kind === 'up')
    const opensDown = atBot.some((g) => info.get(g)!.kind === 'down')
    const through = ztop > -EPS && zbot < -T + EPS
    const face: 1 | 6 = through || opensUp ? 1 : opensDown ? 6 : 1
    // the floor: a small flat face or a drill point closing the hole
    let floor: RecognizedHole['floor'] = through ? 'none' : 'other'
    let tipDepth: number | undefined
    let tipAngle: number | undefined
    const closing = face === 1 ? atBot : atTop
    const floorFaces: number[] = []
    for (const g of closing) {
      const fi = info.get(g)!
      const onlyHole = [...(topo.neighbours.get(g) ?? [])].every((x) => ids.includes(x))
      if (!onlyHole) continue
      if ((face === 1 && fi.kind === 'up') || (face === 6 && fi.kind === 'down')) {
        floor = 'flat'
        floorFaces.push(g)
      } else if (fi.kind === 'cone' && fi.concave) {
        floor = 'cone'
        floorFaces.push(g)
        tipAngle = r6((fi.angle! * 360) / Math.PI)
        tipDepth = r6(face === 1 ? -fi.apex![2] : fi.apex![2] + T)
      }
    }
    const d = r6(2 * r)
    const depth = r6(through ? T : face === 1 ? -zbot : ztop + T)
    const all = [...ids, ...floorFaces]
    if (isDrill(d, vDrills)) {
      holes.push({ x: r6(c[0]), y: r6(c[1]), d, depth, ...(tipDepth !== undefined ? { tipDepth, tipAngle } : {}), through, face, floor, faces: all })
      all.forEach((x) => used.add(x))
    } else if (through) {
      cutoutsRound.push({ contour: circleContour(c, r), faces: all })
      all.forEach((x) => used.add(x))
    } else if (floor === 'flat') {
      roundPockets.push({ depth, face, contour: circleContour(c, r), islands: [], floor: floorFaces[0], faces: all, open: false, minRadius: r })
      all.forEach((x) => used.add(x))
    }
  }

  // ---- holes in the edges (horizontal round walls reaching the outline) ---------------------
  for (const group of roundGroups([...info.values()].filter((f) => f.kind === 'hcyl' && f.concave), pp)) {
    const f0 = group[0]
    const v = f0.v!
    const c = f0.c!
    const r = f0.r!
    const ids = group.map((f) => f.id)
    const verts = group.flatMap((f) => f.verts)
    const along = Math.abs(v[0]) > Math.abs(v[1]) ? 0 : 1
    let lo = Infinity
    let hi = -Infinity
    for (const i of verts) {
      lo = Math.min(lo, pp[i][along])
      hi = Math.max(hi, pp[i][along])
    }
    const size = along === 0 ? L : W
    const zc = c[2]
    const d = r6(2 * r)
    let hole: RecognizedHole | null = null
    // edge (u, v): u along the edge from its left end seen from outside, v = depth below face 1
    if (along === 0 && lo < EPS) hole = { x: r6(W - c[1]), y: r6(-zc), d, depth: r6(hi), through: false, face: 5, floor: 'other', faces: ids }
    else if (along === 0 && hi > size - EPS) hole = { x: r6(c[1]), y: r6(-zc), d, depth: r6(L - lo), through: false, face: 3, floor: 'other', faces: ids }
    else if (along === 1 && lo < EPS) hole = { x: r6(c[0]), y: r6(-zc), d, depth: r6(hi), through: false, face: 2, floor: 'other', faces: ids }
    else if (along === 1 && hi > size - EPS) hole = { x: r6(L - c[0]), y: r6(-zc), d, depth: r6(W - lo), through: false, face: 4, floor: 'other', faces: ids }
    if (!hole) continue
    if (hole.depth >= size - EPS) hole.through = true
    // its floor (flat or a drill point) closes the far end
    const around = new Set<number>()
    for (const id of ids) for (const g of topo.neighbours.get(id) ?? []) if (!ids.includes(g)) around.add(g)
    for (const g of around) {
      const fi = info.get(g)!
      const onlyHole = [...(topo.neighbours.get(g) ?? [])].every((x) => ids.includes(x))
      if (!onlyHole) continue
      if (fi.kind === 'cone') {
        hole.floor = 'cone'
        hole.tipAngle = r6((fi.angle! * 360) / Math.PI)
        const apexAlong = fi.apex![along]
        hole.tipDepth = r6(hole.face === 5 || hole.face === 2 ? apexAlong : size - apexAlong)
        hole.faces.push(g)
      } else if (body.faces.find((x) => x.id === g)?.surface.kind === 'plane') {
        hole.floor = 'flat'
        hole.faces.push(g)
      }
    }
    if (!isDrill(d, hDrills)) {
      hole.noTool = true
      warnings.push(`Edge hole Ø${d} on face ${hole.face}: no horizontal drill that size in the tool table; shown on its own layer, not machined.`)
    }
    holes.push(hole)
    hole.faces.forEach((x) => used.add(x))
  }

  // ---- outline: the largest outer loop of the big faces ---------------------------------------
  let outlineLoop: LoopEdge[] | null = null
  let outlineArea = 0
  for (const f of info.values()) {
    const big = (f.kind === 'up' && f.zmax > -EPS) || (f.kind === 'down' && f.zmin < -T + EPS)
    if (!big) continue
    const ol = outerLoop(f.id)
    if (!ol) continue
    const a = Math.abs(loopArea(ol))
    if (a > outlineArea) {
      outlineArea = a
      outlineLoop = ol
    }
    used.add(f.id)
  }
  if (!outlineLoop) throw new Error('No outline found: the solid has no flat top or bottom face.')
  const outline = normalise(contourOf(outlineLoop))
  const outlineWalls = flood(new Set(outlineLoop.map((e) => e.other).filter(Boolean))).walls
  outlineWalls.forEach((x) => used.add(x))
  const outlineFaces = [...outlineWalls]
  const shaped = outlineFaces.filter((x) => info.get(x)!.kind !== 'vwall' && info.get(x)!.kind !== 'vcyl')
  if (shaped.length) warnings.push(`${shaped.length} face(s) along the outline are not straight up and down (a chamfer, round-over or slope, faces ${shaped.slice(0, 6).join(', ')}${shaped.length > 6 ? '…' : ''}). The outline is cut straight; shape those edges with a profile tool or as a 3D model.`)

  // ---- pockets from face 1 (and from face 6) --------------------------------------------------
  const pockets: RecognizedPocket[] = [...roundPockets]
  for (const f of info.values()) {
    if (used.has(f.id)) continue
    const z = level(f.id)
    const fromTop = f.kind === 'up' && z < -EPS && z > -T + EPS
    const fromBottom = f.kind === 'down' && z < -EPS && z > -T + EPS
    if (!fromTop && !fromBottom) continue
    const ol = outerLoop(f.id)
    if (!ol) continue
    // follow the walls up (down, from face 6) to the face they open from
    const fl = flood(new Set(ol.map((e) => e.other).filter(Boolean)))
    let rim: LoopEdge[] | null = null
    let open = false
    for (const g of fl.levels) {
      if (g === f.id) continue
      const gz = level(g)
      if (fromTop ? gz <= z + EPS : gz >= z - EPS) continue
      for (const loop of loopsOf(g)) {
        if (!loop.every((e) => fl.walls.has(e.other))) continue
        rim = loop
        if (loop === outerLoop(g)) open = true
      }
    }
    if (open || [...fl.walls].some((w) => outlineWalls.has(w))) {
      open = true
      rim = null
    }
    let contour = normalise(contourOf(rim ?? ol))
    // a rebate: the cutter must be able to run past the panel's edge, so the shape reaches
    // OPEN_REACH mm beyond it wherever the floor meets the edge (the walls into the material stay)
    if (open) {
      const keep = boolean('subtract', [outline], [contour])
      const grown = boolean('subtract', offset([contour], OPEN_REACH, 'miter'), keep)
      if (grown.length) contour = normalise(grown.reduce((b, c) => (Math.abs(area(c)) > Math.abs(area(b)) ? c : b)))
    }
    const islands: Contour[] = []
    const islandWalls: number[] = []
    for (const loop of loopsOf(f.id)) {
      if (loop === ol) continue
      // walls that rise from the floor make an island; walls that go down lead to a deeper feature
      const ws = loop.map((e) => info.get(e.other)).filter((x): x is FaceInfo => !!x)
      const rises = fromTop ? ws.some((w) => w.zmax > z + EPS) : ws.some((w) => w.zmin < z - EPS)
      if (!rises) continue
      islands.push(normalise(contourOf(loop)))
      islandWalls.push(...flood(new Set(loop.map((e) => e.other).filter(Boolean))).walls)
    }
    const depth = r6(fromTop ? -z : z + T)
    const radii = contour.segs.filter((s) => s.k === 'A').map((s) => radius(s as Extract<Seg, { k: 'A' }>))
    const faces = [f.id, ...fl.walls, ...islandWalls]
    pockets.push({ depth, face: fromTop ? 1 : 6, contour, islands, floor: f.id, faces, open, minRadius: radii.length ? Math.min(...radii) : Infinity })
    faces.forEach((x) => used.add(x))
    if (open) warnings.push(`Pocket ${depth} mm deep (floor face ${f.id}) runs out to the edge of the panel (a rebate); its shape reaches ${OPEN_REACH} mm past the edge so the cutter can run off it.`)
  }

  // ---- cut-outs: openings whose walls reach the underside with no floor ----------------------
  const cutouts: RecognizedCutout[] = [...cutoutsRound]
  for (const f of info.values()) {
    if (f.kind !== 'up') continue
    const z = level(f.id)
    const ol = outerLoop(f.id)
    for (const loop of loopsOf(f.id)) {
      if (loop === ol) continue
      const start = new Set(loop.map((e) => e.other).filter(Boolean))
      // a hole or a pocket already found (its walls are taken)
      if ([...start].every((g) => used.has(g))) continue
      const fl = flood(start)
      const ws = loop.map((e) => info.get(e.other)).filter((x): x is FaceInfo => !!x)
      if (!ws.some((w) => w.zmin < z - EPS)) continue
      const floors = [...fl.levels].filter((g) => info.get(g)!.kind === 'up' && level(g) < z - EPS)
      const bottom = [...fl.levels].some((g) => info.get(g)!.kind === 'down' && level(g) < -T + EPS)
      if (!bottom || floors.length) continue
      if ([...fl.walls].every((w) => used.has(w))) continue
      cutouts.push({ contour: normalise(contourOf(loop)), faces: [...fl.walls] })
      fl.walls.forEach((x) => used.add(x))
    }
  }

  // ---- what is left -------------------------------------------------------------------------
  const unrecognised: Recognition['unrecognised'] = []
  for (const f of info.values()) {
    if (used.has(f.id)) continue
    const why =
      f.kind === 'other'
        ? body.faces.find((x) => x.id === f.id)!.surface.kind === 'plane'
          ? 'sloped flat face'
          : 'free-form or sloped face'
        : f.kind === 'vcyl' || f.kind === 'hcyl'
          ? f.concave
            ? 'round wall that is not a whole hole'
            : 'round boss'
          : f.kind === 'cone'
            ? 'conical face'
            : f.kind === 'vwall'
              ? 'wall of no feature found'
              : 'flat face of no feature found'
    unrecognised.push({ face: f.id, why })
  }
  if (unrecognised.length) warnings.push(`${unrecognised.length} face(s) not explained by an outline, cut-out, pocket or hole (${[...new Set(unrecognised.map((u) => u.why))].join(', ')}). Machine them as a 3D model, or check the part.`)
  const back = pockets.filter((p) => p.face === 6)
  if (back.length) warnings.push(`${back.length} pocket(s) open on the underside (face 6). Only drilling is done from the underside here; turn the part over or machine them separately.`)
  holes.sort((a, b) => a.face - b.face || a.d - b.d || a.x - b.x || a.y - b.y)
  pockets.sort((a, b) => a.face - b.face || a.depth - b.depth || area(b.contour) - area(a.contour))
  return { frame, outline, outlineFaces, holes, pockets, cutouts, unrecognised, warnings }
}

/** Concave round faces grouped by axis and radius; only groups going all the way round. */
export function roundGroups(faces: FaceInfo[], pp: V3[]): FaceInfo[][] {
  const groups: FaceInfo[][] = []
  for (const f of faces) {
    const g = groups.find((x) => {
      const h = x[0]
      if (Math.abs(h.r! - f.r!) > 1e-6) return false
      if (Math.abs(Math.abs(dot3(h.v!, f.v!)) - 1) > 1e-6) return false
      // same axis line: the offset between the axis points is along the axis
      const d: V3 = [f.c![0] - h.c![0], f.c![1] - h.c![1], f.c![2] - h.c![2]]
      const a = dot3(d, h.v!)
      return Math.hypot(d[0] - a * h.v![0], d[1] - a * h.v![1], d[2] - a * h.v![2]) < 1e-6
    })
    if (g) g.push(f)
    else groups.push([f])
  }
  return groups.filter((g) => {
    // angular cover: the biggest gap between the points' angles round the axis
    const h = g[0]
    const v = h.v!
    const t: V3 = Math.abs(v[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    const e1 = norm(cross(v, t))
    const e2 = cross(v, e1)
    const angs = g
      .flatMap((f) => f.verts)
      .map((i) => {
        const d: V3 = [pp[i][0] - h.c![0], pp[i][1] - h.c![1], pp[i][2] - h.c![2]]
        return Math.atan2(dot3(d, e2), dot3(d, e1))
      })
      .sort((a, b) => a - b)
    if (angs.length < 3) return false
    let gap = angs[0] + 2 * Math.PI - angs[angs.length - 1]
    for (let i = 1; i < angs.length; i++) gap = Math.max(gap, angs[i] - angs[i - 1])
    return gap < Math.PI / 2
  })
}

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2])
  return [a[0] / l, a[1] / l, a[2] / l]
}

export function circleContour(c: V3, r: number): Contour {
  const cx = r6(c[0])
  const cy = r6(c[1])
  const rr = r6(r)
  const a = pt(cx + rr, cy)
  const b = pt(cx - rr, cy)
  const C = pt(cx, cy)
  return { closed: true, segs: [arc(a, b, C, true), arc(b, a, C, true)] }
}

/** Counter-clockwise. */
export function normalise(c: Contour): Contour {
  if (area(c) >= 0) return c
  return { closed: c.closed, segs: [...c.segs].reverse().map((s) => (s.k === 'L' ? line(s.b, s.a) : arc(s.b, s.a, s.c, !s.ccw))) }
}

/**
 * A boundary loop (on a level face) as exact lines and arcs: each run of edges along one wall
 * face becomes a line (flat wall) or an arc on that wall's circle (round wall); runs along other
 * faces are fitted with lines and arcs to 0.001 mm.
 */
export function loopContour(loop: LoopEdge[], pp: V3[], info: Map<number, { kind: string; c?: V3; r?: number }>): Contour {
  // start where the wall changes, so runs are not split
  let s0 = 0
  for (let i = 0; i < loop.length; i++)
    if (loop[i].other !== loop[(i + loop.length - 1) % loop.length].other) {
      s0 = i
      break
    }
  const ring = [...loop.slice(s0), ...loop.slice(0, s0)]
  const runs: LoopEdge[][] = []
  for (const e of ring) {
    const last = runs[runs.length - 1]
    if (last && last[last.length - 1].other === e.other) last.push(e)
    else runs.push([e])
  }
  const P2 = (i: number): P => pt(pp[i][0], pp[i][1])
  const segs: Seg[] = []
  for (const run of runs) {
    const w = info.get(run[0].other)
    const ids = [run[0].a, ...run.map((e) => e.b)]
    const A = P2(ids[0])
    const B = P2(ids[ids.length - 1])
    if (w?.kind === 'vwall' && ids[0] !== ids[ids.length - 1]) {
      segs.push(line(A, B))
      continue
    }
    if (w?.kind === 'vcyl' && w.c && w.r) {
      const C = pt(w.c[0], w.c[1])
      const onCircle = (p: P) => {
        const l = Math.hypot(p.x - C.x, p.y - C.y) || 1
        return pt(C.x + ((p.x - C.x) * w.r!) / l, C.y + ((p.y - C.y) * w.r!) / l)
      }
      let turn = 0
      for (let i = 1; i < ids.length; i++) {
        const p = P2(ids[i - 1])
        const q = P2(ids[i])
        turn += Math.atan2((p.x - C.x) * (q.y - C.y) - (p.y - C.y) * (q.x - C.x), (p.x - C.x) * (q.x - C.x) + (p.y - C.y) * (q.y - C.y))
      }
      const ccw = turn > 0
      const a = onCircle(A)
      const b = onCircle(B)
      if (Math.abs(turn) > Math.PI * 1.999) {
        // all the way round: two halves
        const m = pt(2 * C.x - a.x, 2 * C.y - a.y)
        segs.push(arc(a, m, C, ccw), arc(m, a, C, ccw))
      } else if (Math.abs(turn) > Math.PI) {
        // more than half: split so each arc's sweep is unambiguous
        const mid = onCircle(P2(ids[Math.floor(ids.length / 2)]))
        segs.push(arc(a, mid, C, ccw), arc(mid, b, C, ccw))
      } else segs.push(arc(a, b, C, ccw))
      continue
    }
    segs.push(...fitPoints(ids.map(P2), false, 0.001))
  }
  // runs share their end points exactly; numbers to 1e-6 mm; drop zero-length pieces
  const out = segs
    .map((s): Seg => (s.k === 'L' ? line(rp(s.a), rp(s.b)) : arc(rp(s.a), rp(s.b), rp(s.c), s.ccw)))
    .filter((s) => (s.k === 'L' ? Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) > 1e-9 : Math.abs(sweep(s)) > 1e-9))
  return { closed: true, segs: out }
}
