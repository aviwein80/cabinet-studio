import { X, Y, Z, neg, r3 } from '../geometry'
import type { CarcassParams, EndPanelParams, FillerParams, Library } from '../types'
import { box, materialThickness, PartBuilder } from './builder'
import type { GeneratedCabinet } from './carcass'

/**
 * Kitchen-2: a filler strip or an end panel, in the same cabinet coordinates as a carcass (X along
 * the run, Y from the cabinet front into the room's wall, Z up). The strip and the panel stand in the
 * door plane, Y from minus the door thickness to 0, so they line up with the doors beside them.
 */
export function generatePanel(p: CarcassParams, lib: Library): GeneratedCabinet {
  const warnings: string[] = []
  const panel = p.panel!
  const parts = panel.type === 'filler' ? fillerParts(p, panel, lib, warnings) : endPanelParts(p, panel, lib, warnings)
  return { parts: parts.map((b) => b.part), hardware: [], warnings }
}

function fillerParts(p: CarcassParams, f: FillerParams, lib: Library, warnings: string[]) {
  const W = p.width
  const H = p.height
  const Tf = materialThickness(lib, p.doorMaterialId, warnings, 18)
  const T = materialThickness(lib, p.carcassMaterialId, warnings, 18)
  const tk = p.kind === 'base' && p.toeKick.enabled ? p.toeKick.height : 0
  const out: PartBuilder[] = []
  if (W <= 0) {
    warnings.push('A filler needs a width.')
    return out
  }
  const scribe = f.scribeSide === 'none' ? 0 : Math.max(0, f.scribe)
  const x0 = f.scribeSide === 'left' ? -scribe : 0
  const x1 = f.scribeSide === 'right' ? W + scribe : W
  // the strip, in the door material, show face to the room (machined face to the back, as doors)
  const strip = new PartBuilder('filler', 'Filler', 'filler', p.doorMaterialId, box([x0, -Tf, tk], [x1, 0, H]), Z, Y, 'length')
  for (const [dir, side] of [
    [neg(X), 'left'],
    [X, 'right'],
  ] as const)
    if (f.scribeSide !== side) strip.band(dir, p.edgebands.door)
  // a wall filler's underside is seen from below
  if (p.kind === 'wall') strip.band(neg(Z), p.edgebands.door)
  if (scribe > 0) {
    const edge = strip.edgeOf(f.scribeSide === 'left' ? neg(X) : X)
    if (edge) strip.part.scribe = { edge, amount: r3(scribe) }
  }
  out.push(strip)

  // the return behind it, fixed to the cabinet beside it (carcass material, out of sight)
  const rd = Math.max(0, f.returnDepth)
  if (rd > 0) {
    const sides = f.returnSide === 'both' ? (['left', 'right'] as const) : ([f.returnSide] as const)
    if (f.returnSide === 'both' && W < 2 * T + 1) warnings.push(`The filler is too narrow (${r3(W)} mm) for a return on both sides; one return is fitted.`)
    const fitted = f.returnSide === 'both' && W < 2 * T + 1 ? (['left'] as const) : sides
    if (W < T) warnings.push(`The filler is narrower (${r3(W)} mm) than its return board (${T} mm).`)
    for (const side of fitted) {
      const rx0 = side === 'left' ? 0 : Math.max(0, W - T)
      const key = fitted.length === 1 ? 'filler-return' : `filler-return-${side === 'left' ? 'l' : 'r'}`
      const name = fitted.length === 1 ? 'Filler return' : `Filler return ${side}`
      out.push(new PartBuilder(key, name, 'filler', p.carcassMaterialId, box([rx0, 0, tk], [rx0 + Math.min(T, W), rd, H]), Z, side === 'left' ? X : neg(X), 'length'))
    }
  }
  // the toe kick below a base filler, when the cabinets have a toe-kick board
  if (tk > 0 && p.toeKick.board) out.push(new PartBuilder('filler-toekick', 'Filler toe kick', 'toekick', p.carcassMaterialId, box([0, p.toeKick.setback, 0], [W, p.toeKick.setback + T, tk]), X, neg(Y), 'length'))
  return out
}

function endPanelParts(p: CarcassParams, e: EndPanelParams, lib: Library, warnings: string[]) {
  const H = p.height
  const D = p.depth
  const Te = materialThickness(lib, p.doorMaterialId, warnings, 18)
  if (Math.abs(p.width - Te) > 0.5) warnings.push(`The end panel board is ${r3(Te)} mm thick but the room places it ${r3(p.width)} mm wide.`)
  // flush with the faces of doors in the same board; proud stands that much further out
  const front = -Te - (e.front === 'proud' ? Math.max(0, e.proud) : 0)
  const scribe = Math.max(0, e.scribe)
  const left = e.side === 'left'
  // machined face toward the cabinet, show face down on the table and out to the room
  const b = new PartBuilder('end-panel', 'End panel', 'end-panel', p.doorMaterialId, box([0, front, 0], [Te, D + scribe, H]), Z, left ? X : neg(X), 'length')
  b.band(neg(Y), p.edgebands.door)
  if (p.kind === 'wall') {
    b.band(neg(Z), p.edgebands.door)
    b.band(Z, p.edgebands.door)
  }
  if (p.kind === 'tall') b.band(Z, p.edgebands.door)
  const tk = p.toeKick.enabled ? p.toeKick.height : 0
  if (e.toeKickNotch && p.kind !== 'wall' && tk > 0) b.notch(box([-1, front - 1, -1], [Te + 1, p.toeKick.setback, tk]))
  if (e.toeKickNotch && p.kind === 'wall') warnings.push('A wall end panel has no toe-kick notch.')
  if (scribe > 0) {
    const edge = b.edgeOf(Y)
    if (edge) b.part.scribe = { edge, amount: r3(scribe) }
  }
  return [b]
}
