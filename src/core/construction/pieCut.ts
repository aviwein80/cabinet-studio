import { X, Y, Z, neg, r3, type Box3 } from '../geometry'
import { PLATE_ID, hingeCode, plateBoring } from '../hardware/resolve'
import { hingeHeights } from '../hardware/specs'
import { KITCHEN_DEFAULTS } from '../defaults'
import type { CarcassParams, HardwarePin, Library, PieCutParams, UnitSystem, Vec2, Vec3 } from '../types'
import { formatInches } from '../units'
import { box, materialThickness, PartBuilder } from './builder'
import { HW, hingeCount, jointPositions, type GeneratedCabinet } from './carcass'

/**
 * Kitchen-3: a pie-cut (L-shaped) corner cabinet, in the usual cabinet coordinates (X along the back
 * wall, Y from the front of its box to the back wall, Z up). Seen from above it stands in the box
 * `width` x `depth`: a leg along the back wall (`width` long) and a leg along the side wall (`depth`
 * long), each `legDepth` deep. Corner 'left' fills the back-left corner (the side leg at X = 0);
 * 'right' is its mirror image (the side leg at X = width). The front of the box, inside the L, is
 * open floor: the doors stand there and swing into it.
 */

/** The L the carcass covers, and the open square in front of it, in cabinet coordinates. */
export function pieFootprint(p: Pick<CarcassParams, 'width' | 'depth'>, c: Pick<PieCutParams, 'side' | 'legDepth'>) {
  const W = p.width
  const B = p.depth
  const d = c.legDepth
  const right = c.side === 'right'
  const mx = (x: number) => (right ? W - x : x)
  const span = (a: number, b: number) => [Math.min(mx(a), mx(b)), Math.max(mx(a), mx(b))] as const
  const [bx0, bx1] = span(0, W)
  const [sx0, sx1] = span(0, d)
  const [ox0, ox1] = span(d, W)
  const outline: Vec2[] = [
    { x: 0, y: 0 },
    { x: d, y: 0 },
    { x: d, y: B - d },
    { x: W, y: B - d },
    { x: W, y: B },
    { x: 0, y: B },
  ].map((v) => ({ x: mx(v.x), y: v.y }))
  return {
    /** The leg along the back wall (its whole length) and the leg along the side wall. */
    backLeg: { x0: bx0, x1: bx1, y0: B - d, y1: B },
    sideLeg: { x0: sx0, x1: sx1, y0: 0, y1: B },
    /** The open square in front of both legs, where the doors swing. */
    opening: { x0: ox0, x1: ox1, y0: 0, y1: B - d },
    /** The L, corner by corner. */
    outline: right ? outline.reverse() : outline,
    /** The inside corner, where the two fronts meet. */
    inner: { x: mx(d), y: B - d },
  }
}

/**
 * The two doors of a pie-cut, in cabinet coordinates. The back-wall door stands in front of the back
 * leg (Y from B - d - Td to B - d), hinged at the back leg's end; the side-wall door in front of the
 * side leg (X from d to d + Td, mirrored for 'right'), hinged at the side leg's end (Y = 0). At the
 * inside corner the `cornerDoor` runs through, in front of the other door's end; the other stops the
 * door gap short of its face, so the through door opens first. `Td` is the door board's thickness.
 */
export function pieSpans(p: Pick<CarcassParams, 'width' | 'depth' | 'doors'>, c: PieCutParams, Td = 18, warnings: string[] = [], units: UnitSystem = 'mm') {
  const S = (mm: number) => (units === 'in' ? formatInches(mm) : `${r3(mm)} mm`)
  const W = p.width
  const B = p.depth
  const d = c.legDepth
  const g = p.doors.gap
  const right = c.side === 'right'
  // the back-wall door, along X from the inside corner to the end of the back leg
  const backFrom = c.cornerDoor === 'back' ? d : d + Td + g
  const backWidth = r3(W - g / 2 - backFrom)
  // the side-wall door, along Y from the end of the side leg to the inside corner
  const sideTo = c.cornerDoor === 'side' ? B - d : B - d - Td - g
  const sideWidth = r3(sideTo - g / 2)
  const on = p.doors.count > 0
  if (on && backWidth < 150) warnings.push(`The back-wall door is only ${S(backWidth)} wide; lengthen the back-wall leg.`)
  if (on && sideWidth < 150) warnings.push(`The side-wall door is only ${S(sideWidth)} wide; lengthen the side-wall leg.`)
  const back = on && backWidth > 20 ? (right ? { x0: g / 2, x1: W - backFrom, hinge: 'left' as const } : { x0: backFrom, x1: W - g / 2, hinge: 'right' as const }) : null
  const side = on && sideWidth > 20 ? { y0: g / 2, y1: sideTo, x0: right ? W - d - Td : d, x1: right ? W - d : d + Td } : null
  return { back, side, backWidth, sideWidth, backFrom, sideTo }
}

/** Keep a leg's door width and change the leg: the back-wall leg (`width`) or the side-wall leg (`depth`). */
export function pieLegForDoor(p: Pick<CarcassParams, 'doors'>, c: PieCutParams, Td: number, which: 'back' | 'side', doorWidth: number) {
  const g = p.doors.gap
  const d = c.legDepth
  return which === 'back' ? r3(doorWidth + g / 2 + (c.cornerDoor === 'back' ? d : d + Td + g)) : r3(doorWidth + g / 2 + (c.cornerDoor === 'side' ? d : d + Td + g))
}

/**
 * Kitchen-3: the parts of a pie-cut corner. Two end sides (one at the end of each leg, notched for the
 * toe kick, front edge banded, grooved for the backs and dadoed for the bottom and top); an L bottom
 * and an L top (always a full top), banded on their two inside edges; a back on each wall (the side
 * wall's butts against the back wall's face); L shelves on 32 mm pins in the end sides, banded on their
 * inside edges; toe-kick boards along both fronts when the cabinets have them; two doors, each hinged
 * at its own end on Salice cups and 3 mm plates in that end side. Kitchen-3c: a corner cleat under each
 * L shelf's back corner, cut with the job and fixed on site (on unless switched off).
 */
export function generatePieCut(p: CarcassParams, lib: Library, pin?: { hardware?: Record<string, HardwarePin> }, units: UnitSystem = 'mm'): GeneratedCabinet {
  const c = p.corner as PieCutParams
  const warnings: string[] = []
  const S = (mm: number) => (units === 'in' ? formatInches(mm) : `${r3(mm)} mm`)
  const hardware = new Map<string, number>()
  const addHw = (code: string, n: number) => n > 0 && hardware.set(code, (hardware.get(code) ?? 0) + n)

  const W = p.width
  const B = p.depth
  const H = p.height
  const d = c.legDepth
  const T = materialThickness(lib, p.carcassMaterialId, warnings, 18)
  const Tb = materialThickness(lib, p.backMaterialId, warnings, 6)
  const Td = materialThickness(lib, p.doorMaterialId, warnings, 18)
  const tk = p.kind === 'base' && p.toeKick.enabled ? p.toeKick.height : 0
  const tks = p.toeKick.setback
  const dd = p.bottomJoint === 'dado' ? p.dadoDepth : 0
  const cm = p.carcassMaterialId

  if (!(d > 0) || d + T + 50 > W || d + T + 50 > B) {
    warnings.push(`The legs (${S(W)} along the back wall, ${S(B)} along the side wall) must be longer than the ${S(d)} leg depth plus the end board; nothing is built.`)
    return { parts: [], hardware: [], warnings }
  }
  if (dd >= T) warnings.push(`Dado depth ${dd} mm is not less than side thickness ${T} mm.`)
  if ((p.drawers?.count ?? 0) > 0) warnings.push('Drawers are left out of a pie-cut corner cabinet.')
  if (p.top === 'rails' && p.kind === 'base') warnings.push('A pie-cut corner has a full L-shaped top; the two rails are not used.')

  // mirror image for the back-right corner
  const right = c.side === 'right'
  const mx = (x: number) => (right ? W - x : x)
  const MP = (v: Vec3): Vec3 => [mx(v[0]), v[1], v[2]]
  const MV = (v: Vec3): Vec3 => (right ? [v[0] === 0 ? 0 : -v[0], v[1], v[2]] : v)
  const MB = (min: Vec3, max: Vec3): Box3 => box([Math.min(mx(min[0]), mx(max[0])), min[1], min[2]], [Math.max(mx(min[0]), mx(max[0])), max[1], max[2]])

  // ---- backs: grooved (or rabbeted) into the carcass, or applied on the outside ---------------
  const backType = p.back.type
  const applied = backType === 'applied'
  const gw = Tb + p.back.clearance
  const gd = p.back.grooveDepth
  const s = backType === 'rabbet' ? 0 : p.back.setback
  if (!applied && gd >= T) warnings.push(`Back groove depth ${gd} mm is not less than panel thickness ${T} mm.`)
  const open = s === 0 ? 1 : 0
  // the carcass stops short of the walls by an applied back
  const xw = applied ? Tb : 0
  const yw = applied ? B - Tb : B
  // back grooves: along the back wall (Y) and along the side wall (X)
  const gy0 = B - s - gw
  const gy1 = B - s
  const gx0 = s
  const gx1 = s + gw
  const backFrontY = applied ? yw : gy0
  const backFrontX = applied ? xw : gx1

  const parts: PartBuilder[] = []

  // ---- end sides --------------------------------------------------------------------------------
  const backEnd = new PartBuilder('side-back', 'End side (back wall)', 'side', cm, MB([W - T, B - d, 0], [W, yw, H]), Z, MV(neg(X)), 'length')
  backEnd.band(neg(Y), p.edgebands.carcassFront)
  if (tk > 0) backEnd.notch(MB([W - T - 1, B - d - 1, -1], [W + 1, B - d + tks, tk]))
  const sideEnd = new PartBuilder('side-return', 'End side (side wall)', 'side', cm, MB([xw, 0, 0], [d, T, H]), Z, Y, 'length')
  sideEnd.band(MV(X), p.edgebands.carcassFront)
  if (tk > 0) sideEnd.notch(MB([d - tks, -1, -1], [d + 1, T + 1, tk]))
  parts.push(backEnd, sideEnd)

  // ---- L bottom and L top, banded on the inside edges ------------------------------------------
  const px1 = W - T + dd
  const py0 = T - dd
  const lPanel = (key: 'bottom' | 'top', z0: number, z1: number) => {
    const b = new PartBuilder(key, key === 'bottom' ? 'Bottom' : 'Top', key, cm, MB([xw, py0, z0], [px1, yw, z1]), X, key === 'bottom' ? Z : neg(Z), 'length')
    b.lShape(MB([d, py0 - 1, z0 - 1], [W + 1, B - d, z1 + 1]))
    b.bandInside(neg(Y), p.edgebands.carcassFront)
    b.bandInside(MV(X), p.edgebands.carcassFront)
    return b
  }
  const bottom = lPanel('bottom', tk, tk + T)
  const top = lPanel('top', H - T, H)
  parts.push(bottom, top)

  if (dd > 0) {
    for (const [z0, z1] of [
      [tk, tk + T],
      [H - T, H + 1],
    ]) {
      backEnd.groove(MB([W - T, B - d - 1, z0], [W - T + dd, yw + 1, z1]), 'dado')
      sideEnd.groove(MB([xw - 1, T - dd, z0], [d + 1, T, z1]), 'dado')
    }
  }

  if (applied) {
    // the back-wall back runs the whole width; the side-wall back stops at it
    parts.push(new PartBuilder('back', 'Back (back wall)', 'back', p.backMaterialId, MB([0, B - Tb, tk], [W, B, H]), X, neg(Y), 'none'))
    parts.push(new PartBuilder('back-side', 'Back (side wall)', 'back', p.backMaterialId, MB([0, 0, tk], [Tb, B - Tb, H]), Y, MV(X), 'none'))
  } else {
    backEnd.groove(MB([W - T, gy0, -1], [W - T + gd, gy1 + open, H + 1]), 'back-groove')
    sideEnd.groove(MB([gx0 - open, T - gd, -1], [gx1, T, H + 1]), 'back-groove')
    for (const [panel, z0, z1] of [
      [bottom, tk + T - gd, tk + T],
      [top, H - T, H - T + gd],
    ] as const) {
      panel.groove(MB([gx0, gy0, z0], [px1 + 1, gy1 + open, z1]), 'back-groove')
      panel.groove(MB([gx0 - open, py0 - 1, z0], [gx1, gy1, z1]), 'back-groove')
    }
    const c2 = p.back.clearance / 2
    const bz0 = tk + T - gd + 0.5
    const bz1 = H - T + gd - 0.5
    const by0 = gy0 + c2
    const bx0 = gx0 + c2
    // the side-wall back butts against the back-wall back's face; the back-wall back's end sits in the side groove
    parts.push(new PartBuilder('back', 'Back (back wall)', 'back', p.backMaterialId, MB([bx0, by0, bz0], [W - T + gd - 0.5, by0 + Tb, bz1]), X, neg(Y), 'none'))
    parts.push(new PartBuilder('back-side', 'Back (side wall)', 'back', p.backMaterialId, MB([bx0, T - gd + 0.5, bz0], [bx0 + Tb, by0, bz1]), Y, MV(X), 'none'))
  }

  // ---- toe-kick boards along both fronts, meeting at the inside corner --------------------------
  if (tk > 0 && p.toeKick.board) {
    parts.push(new PartBuilder('toekick', 'Toe kick (back wall)', 'toekick', cm, MB([d - tks - T, B - d + tks, 0], [W - T, B - d + tks + T, tk]), X, neg(Y), 'length'))
    parts.push(new PartBuilder('toekick-side', 'Toe kick (side wall)', 'toekick', cm, MB([d - tks - T, T, 0], [d - tks, B - d + tks, tk]), Y, MV(X), 'length'))
  }

  // ---- 32 mm system in both end sides ----------------------------------------------------------
  const pitch = p.shelfPins.pitch
  const gridOrigin = tk + T / 2
  const zoneLo = tk + T + p.shelfPins.zoneMargin
  const zoneHi = H - T - p.shelfPins.zoneMargin
  const gridZ: number[] = []
  for (let k = 1; gridOrigin + k * pitch <= zoneHi + 1e-6; k++) {
    const z = gridOrigin + k * pitch
    if (z >= zoneLo - 1e-6) gridZ.push(r3(z))
  }
  const shelfCount = Math.max(0, Math.round(p.shelves.count))
  if (shelfCount > 0 && p.shelfPins.enabled) {
    for (const y of [B - d + p.shelfPins.setbackFront, backFrontY - p.shelfPins.setbackBack]) for (const z of gridZ) backEnd.drill(MP([W - T, y, z]), p.shelfPins.diameter, p.shelfPins.depth, 'shelf-pin')
    for (const x of [d - p.shelfPins.setbackFront, backFrontX + p.shelfPins.setbackBack]) for (const z of gridZ) sideEnd.drill(MP([x, T, z]), p.shelfPins.diameter, p.shelfPins.depth, 'shelf-pin')
  }

  // ---- butt joints: connectors at both end sides -----------------------------------------------
  let connectorCount = 0
  if (p.bottomJoint === 'butt') {
    for (const [panel, z] of [
      [bottom, tk + T / 2],
      [top, H - T / 2],
    ] as const) {
      const joints = [
        ...jointPositions(B - d, yw).map((y) => ({ side: backEnd, at: MP([W - T, y, z]), inward: MV(neg(X)) })),
        ...jointPositions(xw, d).map((x) => ({ side: sideEnd, at: MP([x, T, z]), inward: Y })),
      ]
      for (const j of joints) {
        switch (p.joinery) {
          case 'dowel':
            j.side.drill(j.at, 8, 12, 'dowel')
            panel.hdrill(j.at, j.inward, 8, 30, 'dowel')
            connectorCount++
            break
          case 'confirmat':
            j.side.drill(j.at, 7, 0, 'confirmat', true)
            panel.hdrill(j.at, j.inward, 5, 50, 'confirmat')
            connectorCount++
            break
          case 'screw':
            j.side.drill(j.at, 5, 0, 'screw-pilot', true)
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

  // ---- L shelves on the pins, banded on the inside edges ---------------------------------------
  const fs = p.shelves.frontSetback
  const sc = p.shelves.sideClearance
  const interiorLo = tk + T
  const interiorHi = H - T
  for (let i = 0; i < shelfCount; i++) {
    const z = interiorLo + ((interiorHi - interiorLo) * (i + 1)) / (shelfCount + 1)
    const sh = new PartBuilder(`shelf-${i + 1}`, `Shelf ${i + 1}`, 'shelf', cm, MB([r3(backFrontX + 2), T + sc, z - T / 2], [W - T - sc, r3(backFrontY - 2), z + T / 2]), X, Z, 'length')
    sh.lShape(MB([d - fs, T + sc - 1, z - T], [W, B - d + fs, z + T]))
    sh.bandInside(neg(Y), p.edgebands.shelfFront)
    sh.bandInside(MV(X), p.edgebands.shelfFront)
    parts.push(sh)
    // Kitchen-3c: a cleat in the carcass board under the shelf's back corner, on edge against the
    // back-wall back from the side-wall back's face, its top at the shelf's underside; fixed on site
    if (c.cleats !== false) {
      const len = Math.max(1, c.cleatLength ?? KITCHEN_DEFAULTS.cleatLength)
      const h = Math.max(1, c.cleatHeight ?? KITCHEN_DEFAULTS.cleatHeight)
      const zTop = z - T / 2
      const floor = i === 0 ? interiorLo : interiorLo + ((interiorHi - interiorLo) * i) / (shelfCount + 1) + T / 2
      const reach = W - T - sc - backFrontX
      if (zTop - h < floor - 0.01) warnings.push(`The corner cleat under shelf ${i + 1} (${S(h)} high) does not fit above the ${i === 0 ? 'bottom' : `shelf below`}; it is left out.`)
      else {
        if (len > reach) warnings.push(`The corner cleat (${S(len)}) is longer than shelf ${i + 1}'s back edge; it is cut to ${S(reach)}.`)
        const cl = new PartBuilder(`cleat-${i + 1}`, `Shelf ${i + 1} corner cleat`, 'cleat', cm, MB([backFrontX, backFrontY - T, zTop - h], [backFrontX + Math.min(len, reach), backFrontY, zTop]), X, neg(Y), 'length')
        cl.part.onSite = `Fix on site under shelf ${i + 1}'s back corner`
        parts.push(cl)
      }
    }
  }
  if (p.shelfPins.enabled && shelfCount > 0) addHw(HW.shelfPin, shelfCount * 4)
  if (shelfCount > 0 && gridZ.length === 0) warnings.push('No room for shelf-pin holes between bottom and top.')

  // ---- two doors, each hinged at its own end ---------------------------------------------------
  const g = p.doors.gap
  const dz0 = p.kind === 'base' ? tk : g / 2
  const dz1 = p.kind === 'base' ? H - g : H - g / 2
  const doorH = dz1 - dz0
  if (p.doors.count > 0 && doorH > 80) {
    const sp = pieSpans(p, c, Td, warnings, units)
    const plate = plateBoring(lib, pin?.hardware?.[PLATE_ID])
    const zs = hingeHeights(dz0, dz1, p.doors.hingeFromEnd, hingeCount(doorH), gridOrigin, pitch)
    const ce = p.doors.cupEdgeDistance
    if (sp.back) {
      // in front of the back leg; cups at its hinge edge, plates in the back-wall end side
      const door = new PartBuilder('door-back', 'Door (back wall)', 'door', p.doorMaterialId, box([sp.back.x0, B - d - Td, dz0], [sp.back.x1, B - d, dz1]), Z, Y, 'length')
      door.bandAll(p.edgebands.door)
      const cupX = sp.back.hinge === 'right' ? sp.back.x1 - ce : sp.back.x0 + ce
      for (const zc of zs) door.drill([cupX, B - d, zc], p.doors.cupDiameter, p.doors.cupDepth, 'hinge-cup')
      for (const zc of zs) for (const h of plate.holes) backEnd.drill(MP([W - T, B - d + h.from, zc + h.along]), h.diameter, h.depth, 'mounting-plate')
      parts.push(door)
      addHw(hingeCode(lib), zs.length)
      addHw(plate.code, zs.length)
    }
    if (sp.side) {
      // in front of the side leg; cups at the end of the leg, plates in the side-wall end side
      const door = new PartBuilder('door-side', 'Door (side wall)', 'door', p.doorMaterialId, MB([d, sp.side.y0, dz0], [d + Td, sp.side.y1, dz1]), Z, MV(neg(X)), 'length')
      door.bandAll(p.edgebands.door)
      for (const zc of zs) door.drill(MP([d, sp.side.y0 + ce, zc]), p.doors.cupDiameter, p.doors.cupDepth, 'hinge-cup')
      for (const zc of zs) for (const h of plate.holes) sideEnd.drill(MP([d - h.from, T, zc + h.along]), h.diameter, h.depth, 'mounting-plate')
      parts.push(door)
      addHw(hingeCode(lib), zs.length)
      addHw(plate.code, zs.length)
    }
  }

  return {
    parts: parts.map((b) => b.part),
    hardware: [...hardware.entries()].map(([hardwareCode, qty]) => ({ hardwareCode, qty })),
    warnings,
  }
}
