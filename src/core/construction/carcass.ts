import {
  EPS,
  X,
  Y,
  Z,
  frameFromBox,
  neg,
  r3,
  rectPolygon,
  toLocal,
  vecEq,
  type Box3,
} from '../geometry'
import { PLATE_ID, hingeCode, plateBoring, slideBoring, SLIDE_IDS } from '../hardware/resolve'
import { BLUM, hingeHeights, selectTandem } from '../hardware/specs'
import type {
  CabinetInstance,
  CarcassParams,
  DrillOp,
  EdgeKey,
  GrooveOp,
  HDrillDir,
  HDrillOp,
  HardwareLine,
  HardwarePin,
  Library,
  Operation,
  OpPurpose,
  Part,
  PartRole,
  Vec2,
  Vec3,
} from '../types'

export interface GeneratedCabinet {
  parts: Part[]
  hardware: HardwareLine[]
  warnings: string[]
}

export const HW = {
  shelfPin: 'PIN-5',
  dowel: 'DOWEL-8x30',
  confirmat: 'CONFIRMAT-7x50',
  screw: 'SCREW-4x50',
} as const

class PartBuilder {
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
    const f = this.part.frame
    let k: EdgeKey | null = null
    if (vecEq(dir, neg(f.v))) k = 'L1'
    else if (vecEq(dir, f.v)) k = 'L2'
    else if (vecEq(dir, neg(f.u))) k = 'W1'
    else if (vecEq(dir, f.u)) k = 'W2'
    if (k) this.part.edges[k] = bandId
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

const box = (min: Vec3, max: Vec3): Box3 => ({ min, max })

export function hingeCount(doorHeight: number) {
  if (doorHeight <= 900) return 2
  if (doorHeight <= 1600) return 3
  if (doorHeight <= 2000) return 4
  return 5
}

function materialThickness(lib: Library, id: string, warnings: string[], fallback: number) {
  const m = lib.materials.find((mm) => mm.id === id)
  if (!m) {
    warnings.push(`Material "${id}" is not in the library; using ${fallback} mm.`)
    return fallback
  }
  return m.thickness
}

/** Joint positions along a panel's depth for dowels / connectors. */
function jointPositions(y0: number, y1: number) {
  const depth = y1 - y0
  if (depth <= 150) return [y0 + depth / 2 - depth / 4, y0 + depth / 2 + depth / 4].map(r3)
  const ys = [y0 + 50, y1 - 50]
  if (depth > 450) ys.splice(1, 0, y0 + depth / 2)
  return ys.map(r3)
}

export function generateCarcass(p: CarcassParams, lib: Library, pin?: { hardware?: Record<string, HardwarePin> }): GeneratedCabinet {
  const warnings: string[] = []
  const hardware = new Map<string, number>()
  const addHw = (code: string, n: number) => n > 0 && hardware.set(code, (hardware.get(code) ?? 0) + n)

  const W = p.width
  const H = p.height
  const D = p.depth
  const T = materialThickness(lib, p.carcassMaterialId, warnings, 18)
  const Tb = materialThickness(lib, p.backMaterialId, warnings, 6)
  const Td = materialThickness(lib, p.doorMaterialId, warnings, 18)
  const tk = p.kind === 'base' && p.toeKick.enabled ? p.toeKick.height : 0
  const tks = p.toeKick.setback
  const dd = p.bottomJoint === 'dado' ? p.dadoDepth : 0
  const topFull = p.top === 'full' || p.kind !== 'base'

  if (dd >= T) warnings.push(`Dado depth ${dd} mm is not less than side thickness ${T} mm.`)

  const backType = p.back.type
  const gw = Tb + p.back.clearance
  const gd = p.back.grooveDepth
  const s = backType === 'rabbet' ? 0 : p.back.setback
  const carcassDepth = backType === 'applied' ? D - Tb : D
  const backFrontY = backType === 'applied' ? D - Tb : D - s - gw
  if (backType !== 'applied' && gd >= T) warnings.push(`Back groove depth ${gd} mm is not less than panel thickness ${T} mm.`)

  const parts: PartBuilder[] = []
  const cm = p.carcassMaterialId

  // ---- sides -------------------------------------------------------------------------------
  const leftSide = new PartBuilder('side-left', 'Left side', 'side', cm, box([0, 0, 0], [T, carcassDepth, H]), Z, X, 'length')
  const rightSide = new PartBuilder('side-right', 'Right side', 'side', cm, box([W - T, 0, 0], [W, carcassDepth, H]), Z, neg(X), 'length')
  const sides = [
    { b: leftSide, faceX: T, inward: X },
    { b: rightSide, faceX: W - T, inward: neg(X) },
  ]
  for (const { b } of sides) {
    b.band(neg(Y), p.edgebands.carcassFront)
    if (tk > 0) b.notch(box([-1, -1, -1], [W + 1, tks, tk]))
  }
  parts.push(leftSide, rightSide)

  // ---- bottom & top -----------------------------------------------------------------------
  const panelX0 = T - dd
  const panelX1 = W - T + dd
  const bottom = new PartBuilder('bottom', 'Bottom', 'bottom', cm, box([panelX0, 0, tk], [panelX1, carcassDepth, tk + T]), X, Z, 'length')
  bottom.band(neg(Y), p.edgebands.carcassFront)
  parts.push(bottom)

  let top: PartBuilder | null = null
  const rails: PartBuilder[] = []
  if (topFull) {
    top = new PartBuilder('top', 'Top', 'top', cm, box([panelX0, 0, H - T], [panelX1, carcassDepth, H]), X, neg(Z), 'length')
    top.band(neg(Y), p.edgebands.carcassFront)
    parts.push(top)
  } else {
    const front = new PartBuilder('rail-front', 'Front rail', 'rail', cm, box([T, 0, H - T], [W - T, p.railDepth, H]), X, Z, 'length')
    front.band(neg(Y), p.edgebands.carcassFront)
    const backRail = new PartBuilder(
      'rail-back',
      'Back rail',
      'rail',
      cm,
      box([T, backFrontY - p.railDepth, H - T], [W - T, backFrontY, H]),
      X,
      Z,
      'length',
    )
    rails.push(front, backRail)
    parts.push(front, backRail)
  }

  // Dados for bottom (and full top) in the sides.
  if (dd > 0) {
    for (const { b, faceX, inward } of sides) {
      const x0 = Math.min(faceX, faceX - inward[0] * dd)
      const x1 = Math.max(faceX, faceX - inward[0] * dd)
      b.groove(box([x0, -1, tk], [x1, carcassDepth + 1, tk + T]), 'dado')
      if (top) b.groove(box([x0, -1, H - T], [x1, carcassDepth + 1, H + 1]), 'dado')
    }
  }

  // ---- back panel & grooves ---------------------------------------------------------------
  if (backType === 'applied') {
    const back = new PartBuilder('back', 'Back', 'back', p.backMaterialId, box([0, D - Tb, tk], [W, D, H]), X, neg(Y), 'none')
    parts.push(back)
  } else {
    const gy0 = D - s - gw
    const gy1 = D - s
    for (const { b, faceX, inward } of sides) {
      const x0 = Math.min(faceX, faceX - inward[0] * gd)
      const x1 = Math.max(faceX, faceX - inward[0] * gd)
      b.groove(box([x0, gy0, -1], [x1, gy1 + (s === 0 ? 1 : 0), H + 1]), 'back-groove')
    }
    bottom.groove(box([panelX0 - 1, gy0, tk + T - gd], [panelX1 + 1, gy1 + (s === 0 ? 1 : 0), tk + T]), 'back-groove')
    if (top) top.groove(box([panelX0 - 1, gy0, H - T], [panelX1 + 1, gy1 + (s === 0 ? 1 : 0), H - T + gd]), 'back-groove')
    const bz0 = tk + T - gd + 0.5
    const bz1 = top ? H - T + gd - 0.5 : H
    const bx0 = T - gd + 0.5
    const bx1 = W - T + gd - 0.5
    const by0 = gy0 + p.back.clearance / 2
    const back = new PartBuilder('back', 'Back', 'back', p.backMaterialId, box([bx0, by0, bz0], [bx1, by0 + Tb, bz1]), X, neg(Y), 'none')
    parts.push(back)
  }

  // ---- toe kick board ---------------------------------------------------------------------
  if (tk > 0 && p.toeKick.board) {
    parts.push(new PartBuilder('toekick', 'Toe kick', 'toekick', cm, box([T, tks, 0], [W - T, tks + T, tk]), X, neg(Y), 'length'))
  }

  // ---- 32 mm system grid on the sides -----------------------------------------------------
  const pitch = p.shelfPins.pitch
  const gridOrigin = tk + T / 2
  const zoneLo = tk + T + p.shelfPins.zoneMargin
  const zoneHi = H - T - p.shelfPins.zoneMargin
  const gridZ: number[] = []
  for (let k = 1; gridOrigin + k * pitch <= zoneHi + EPS; k++) {
    const z = gridOrigin + k * pitch
    if (z >= zoneLo - EPS) gridZ.push(r3(z))
  }

  const rowYs = [p.shelfPins.setbackFront, backFrontY - p.shelfPins.setbackBack]
  const drawerCountEarly = Math.max(0, Math.round(p.drawers?.count ?? 0))
  if (p.shelves.count > 0 && drawerCountEarly === 0 && p.shelfPins.enabled) {
    for (const { b, faceX } of sides) {
      for (const y of rowYs) for (const z of gridZ) b.drill([faceX, y, z], p.shelfPins.diameter, p.shelfPins.depth, 'shelf-pin')
    }
  }

  // ---- butt-joint connectors --------------------------------------------------------------
  const joinPanels: { b: PartBuilder; z: number; y0: number; y1: number }[] = []
  if (p.bottomJoint === 'butt') joinPanels.push({ b: bottom, z: tk + T / 2, y0: 0, y1: carcassDepth })
  if (top && p.bottomJoint === 'butt') joinPanels.push({ b: top, z: H - T / 2, y0: 0, y1: carcassDepth })
  for (const r of rails) {
    const lo = toLocalBox(r)
    joinPanels.push({ b: r, z: H - T / 2, y0: lo.y0, y1: lo.y1 })
  }
  let connectorCount = 0
  for (const jp of joinPanels) {
    const ys = jointPositions(jp.y0, jp.y1)
    for (const { b: side, faceX, inward } of sides) {
      for (const y of ys) {
        const endX = faceX
        switch (p.joinery) {
          case 'dowel':
            side.drill([faceX, y, jp.z], 8, 12, 'dowel')
            jp.b.hdrill([endX, y, jp.z], inward, 8, 30, 'dowel')
            connectorCount++
            break
          case 'confirmat':
            side.drill([faceX, y, jp.z], 7, 0, 'confirmat', true)
            jp.b.hdrill([endX, y, jp.z], inward, 5, 50, 'confirmat')
            connectorCount++
            break
          case 'screw':
            side.drill([faceX, y, jp.z], 5, 0, 'screw-pilot', true)
            connectorCount++
            break
          case 'none':
            break
        }
      }
    }
  }
  if (p.joinery === 'dowel') addHw(HW.dowel, connectorCount)
  if (p.joinery === 'confirmat') addHw(HW.confirmat, connectorCount)
  if (p.joinery === 'screw') addHw(HW.screw, connectorCount)

  // ---- shelves ----------------------------------------------------------------------------
  const drawerCount = Math.max(0, Math.round(p.drawers?.count ?? 0))
  if (drawerCount > 0 && p.shelves.count > 0) warnings.push('Shelves are left out while drawers are fitted.')
  const shelfCount = drawerCount > 0 ? 0 : p.shelves.count
  const shelfDepth = r3(backFrontY - p.shelves.frontSetback - 2)
  const interiorLo = tk + T
  const interiorHi = H - T
  for (let i = 0; i < shelfCount; i++) {
    const z = interiorLo + ((interiorHi - interiorLo) * (i + 1)) / (p.shelves.count + 1)
    const c = p.shelves.sideClearance
    const sh = new PartBuilder(
      `shelf-${i + 1}`,
      `Shelf ${i + 1}`,
      'shelf',
      cm,
      box([T + c, p.shelves.frontSetback, z - T / 2], [W - T - c, p.shelves.frontSetback + shelfDepth, z + T / 2]),
      X,
      Z,
      'length',
    )
    sh.band(neg(Y), p.edgebands.shelfFront)
    parts.push(sh)
  }
  if (p.shelfPins.enabled && shelfCount > 0) addHw(HW.shelfPin, shelfCount * 4)
  if (shelfCount > 0 && gridZ.length === 0) warnings.push('No room for shelf-pin holes between bottom and top.')

  // ---- fronts: drawers from the bottom, doors above them ----------------------------------
  const g = p.doors.gap
  const frontZ0 = p.kind === 'base' ? tk : g / 2
  const frontZ1 = p.kind === 'base' ? H - g : H - g / 2
  const frontSpan = frontZ1 - frontZ0
  let drawerTop = frontZ0
  if (drawerCount > 0) {
    const mixed = p.doors.count > 0
    let frontH = mixed ? p.drawers.frontHeight : (frontSpan - (drawerCount - 1) * g) / drawerCount
    if (mixed && drawerCount * frontH + drawerCount * g > frontSpan - 80) {
      frontH = (frontSpan - 80 - drawerCount * g) / drawerCount
      warnings.push('Drawer fronts were shortened so a door still fits above them.')
    }
    if (frontH < 60) warnings.push('Drawer fronts are under 60 mm tall.')
    const { slide } = selectTandem(D, p.drawers?.slide ?? 'auto')
    const slideId = SLIDE_IDS[slide.part]
    const runner = slideBoring(lib, slide, slideId ? pin?.hardware?.[slideId] : undefined)
    if (D + 0.01 < runner.minCabinetDepth) warnings.push(`Cabinet depth ${D} mm is under the ${runner.minCabinetDepth} mm minimum for a ${slide.inches} in TANDEM runner.`)
    // Polish-1: the box (sides, subfront, back) is its own material when one is chosen; absent =
    // the carcass board, as before. The TANDEM side limit is checked against what is really used.
    const boxMat = p.drawers.boxMaterialId ? lib.materials.find((m) => m.id === p.drawers.boxMaterialId) : undefined
    if (p.drawers.boxMaterialId && !boxMat) warnings.push(`Drawer-box material ${p.drawers.boxMaterialId} is not in the library; the boxes use the carcass board.`)
    const boxM = boxMat ? boxMat.id : cm
    const sideT = boxMat ? boxMat.thickness : T
    if (sideT > BLUM.maxSideThickness + 0.01)
      warnings.push(
        boxMat
          ? `Blum TANDEM allows drawer sides up to ${BLUM.maxSideThickness} mm (5/8 in). These sides are the ${sideT} mm drawer-box board (${boxMat.code}); choose a drawer-box material of ${BLUM.maxSideThickness} mm or less.`
          : `Blum TANDEM allows drawer sides up to ${BLUM.maxSideThickness} mm (5/8 in). These sides are the ${sideT} mm carcass board; choose a drawer-box material of ${BLUM.maxSideThickness} mm or less (Drawers > Box material).`,
      )
    const openingW = W - 2 * T
    const insideW = r3(openingW - BLUM.insideWidthDeduction)
    const sideGap = r3((openingW - (insideW + 2 * sideT)) / 2)
    const boxDepth = Math.min(runner.length, r3(backFrontY - BLUM.runnerSetback))
    if (boxDepth < runner.length - 0.1) warnings.push(`Drawer box shortened to ${boxDepth} mm to clear the back.`)
    const bottomT = Math.min(Tb, 16)

    for (let i = 0; i < drawerCount; i++) {
      const z0 = r3(frontZ0 + i * (frontH + g))
      const z1 = r3(z0 + frontH)
      drawerTop = z1
      const n = i + 1
      const front = new PartBuilder(`drawer-front-${n}`, `Drawer front ${n}`, 'drawer', p.doorMaterialId, box([g / 2, -Td, z0], [W - g / 2, 0, z1]), Z, Y, 'length')
      front.bandAll(p.edgebands.door)
      parts.push(front)

      const boxZ0 = r3(z0 + BLUM.bottomClearance)
      const sideH = r3(Math.max(50, frontH - BLUM.bottomClearance - BLUM.topClearance))
      const xL = r3(T + sideGap)
      const y1 = boxDepth
      const left = new PartBuilder(`drawer-${n}-side-l`, `Drawer ${n} left side`, 'drawer', boxM, box([xL, 0, boxZ0], [xL + sideT, y1, boxZ0 + sideH]), Y, X, 'length')
      const right = new PartBuilder(`drawer-${n}-side-r`, `Drawer ${n} right side`, 'drawer', boxM, box([xL + sideT + insideW, 0, boxZ0], [xL + 2 * sideT + insideW, y1, boxZ0 + sideH]), Y, neg(X), 'length')
      const sub = new PartBuilder(`drawer-${n}-subfront`, `Drawer ${n} subfront`, 'drawer', boxM, box([xL + sideT, 0, boxZ0], [xL + sideT + insideW, sideT, boxZ0 + sideH]), X, Y, 'length')
      const back = new PartBuilder(`drawer-${n}-back`, `Drawer ${n} back`, 'drawer', boxM, box([xL + sideT, y1 - sideT, boxZ0], [xL + sideT + insideW, y1, boxZ0 + sideH]), X, neg(Y), 'length')
      const botZ = boxZ0 + BLUM.bottomRecess
      const bottomPanel = new PartBuilder(
        `drawer-${n}-bottom`,
        `Drawer ${n} bottom`,
        'drawer',
        p.backMaterialId,
        box([xL + sideT, sideT, botZ], [xL + sideT + insideW, y1 - sideT, botZ + bottomT]),
        X,
        Z,
        'none',
      )
      // Rear hook bores, one at each end of the drawer back. Offsets are Blum's rear-view callouts.
      back.drill([xL + sideT + BLUM.hookFromEnd, y1, boxZ0 + BLUM.hookFromBottom], BLUM.hookDiameter, BLUM.hookDepth, 'slide')
      back.drill([xL + sideT + insideW - BLUM.hookFromEnd, y1, boxZ0 + BLUM.hookFromBottom], BLUM.hookDiameter, BLUM.hookDepth, 'slide')
      parts.push(left, right, sub, back, bottomPanel)

      const screwZ = r3(z0 + runner.line)
      for (const { b, faceX } of sides) {
        for (const y of runner.holes) b.drill([faceX, y, screwZ], runner.diameter, runner.depth, 'slide')
      }
    }
    addHw(runner.code, drawerCount)
  }

  // ---- doors with Salice cups and 3 mm plates ---------------------------------------------
  if (p.doors.count > 0) {
    const dz0 = drawerCount > 0 ? drawerTop + g : frontZ0
    const dz1 = frontZ1
    const doorH = dz1 - dz0
    if (doorH > 80) {
      const spans: { x0: number; x1: number; hinge: 'left' | 'right' }[] =
        p.doors.count === 1
          ? [{ x0: g / 2, x1: W - g / 2, hinge: p.doors.hingeSide }]
          : [
              { x0: g / 2, x1: W / 2 - g / 2, hinge: 'left' },
              { x0: W / 2 + g / 2, x1: W - g / 2, hinge: 'right' },
            ]
      const plate = plateBoring(lib, pin?.hardware?.[PLATE_ID])
      const plateCentres = hingeHeights(dz0, dz1, p.doors.hingeFromEnd, hingeCount(doorH), gridOrigin, pitch)
      spans.forEach((sp, i) => {
        const key = spans.length === 1 ? 'door' : i === 0 ? 'door-left' : 'door-right'
        const name = spans.length === 1 ? 'Door' : i === 0 ? 'Left door' : 'Right door'
        const d = new PartBuilder(key, name, 'door', p.doorMaterialId, box([sp.x0, -Td, dz0], [sp.x1, 0, dz1]), Z, Y, 'length')
        d.bandAll(p.edgebands.door)
        const cupX = sp.hinge === 'left' ? sp.x0 + p.doors.cupEdgeDistance : sp.x1 - p.doors.cupEdgeDistance
        for (const zc of plateCentres) d.drill([cupX, 0, zc], p.doors.cupDiameter, p.doors.cupDepth, 'hinge-cup')
        parts.push(d)

        const side = sp.hinge === 'left' ? sides[0] : sides[1]
        for (const zc of plateCentres) {
          for (const h of plate.holes) side.b.drill([side.faceX, h.from, zc + h.along], h.diameter, h.depth, 'mounting-plate')
        }
        addHw(hingeCode(lib), plateCentres.length)
        addHw(plate.code, plateCentres.length)
      })
    } else if (drawerCount > 0) warnings.push('No room left above the drawers for a door.')
  }

  return {
    parts: parts.map((b) => b.part),
    hardware: [...hardware.entries()].map(([hardwareCode, qty]) => ({ hardwareCode, qty })),
    warnings,
  }
}

function toLocalBox(b: PartBuilder) {
  const f = b.part.frame
  const y0 = f.origin[1]
  return { y0: r3(y0), y1: r3(y0 + b.part.width) }
}

/** Generate a cabinet instance and apply its per-part overrides. */
export function buildCabinet(cab: CabinetInstance, lib: Library): GeneratedCabinet {
  const g = generateCarcass(cab.params, lib, cab.pin)
  const parts: Part[] = []
  for (const part of g.parts) {
    const ov = cab.overrides[part.key]
    if (ov?.exclude) continue
    const next: Part = { ...part, edges: { ...part.edges }, ops: [...part.ops] }
    if (ov?.edges) next.edges = { ...next.edges, ...ov.edges }
    if (ov?.extraOps) next.ops.push(...ov.extraOps)
    if (ov?.materialId) next.materialId = ov.materialId
    parts.push(next)
  }
  for (const key of Object.keys(cab.overrides)) {
    if (!g.parts.some((pp) => pp.key === key)) g.warnings.push(`Override for unknown part "${key}" ignored.`)
  }
  return { ...g, parts }
}

export function partOutline(part: Part): Vec2[] {
  return part.outline ?? rectPolygon(part.length, part.width)
}

export function isOpInsidePart(part: Part, op: Operation) {
  const L = part.length
  const W = part.width
  const inRange = (x: number, y: number) => x >= -EPS && x <= L + EPS && y >= -EPS && y <= W + EPS
  if (op.kind === 'groove') return inRange(op.x1, op.y1) && inRange(op.x2, op.y2)
  return inRange(op.x, op.y)
}
