import type { HardwarePin, Library } from '../types'
import { HINGE_ID, PLATE_ID, SLIDE_IDS } from './ids'
import { boringPattern } from './patterns'
import { BLUM, SALICE, type TandemSlide } from './specs'

export { HINGE_ID, PLATE_ID, SLIDE_IDS }

export function hardwareRow(lib: Library, id: string) {
  return lib.hardware.find((h) => h.id === id)
}

export interface PlateHole {
  /** Along the hinge centre line (cabinet height), from the hinge centre. */
  along: number
  /** Back from the front edge of the side. */
  from: number
  diameter: number
  depth: number
}

/**
 * Plate screws, from the plate's boring pattern (an approved library pattern linked to the plate
 * wins over the built-in one). A job's pinned values still override. `plateHeight` is not read.
 */
export function plateBoring(lib: Library, pin?: HardwarePin) {
  const row = hardwareRow(lib, PLATE_ID)
  const pat = boringPattern(lib, PLATE_ID)
  let holes: PlateHole[] = (pat?.holes ?? [-16, 16].map((x) => ({ x, y: SALICE.plateSetback, diameter: SALICE.plateHoleDiameter, depth: SALICE.plateHoleDepth, face: 1 as const })))
    .filter((h) => h.face === 1)
    .map((h) => ({ along: h.x, from: h.y, diameter: h.diameter, depth: h.depth }))
    .sort((a, b) => a.along - b.along)
  if (pin && (pin.plateSetback ?? pin.plateSpacing ?? pin.holeDiameter ?? pin.holeDepth) !== undefined) {
    const s = pin.plateSpacing ?? (holes.length > 1 ? holes[holes.length - 1].along - holes[0].along : SALICE.plateSpacing)
    const h0 = holes[0]
    holes = [-1, 1].map((k) => ({ along: (k * s) / 2, from: pin.plateSetback ?? h0?.from ?? SALICE.plateSetback, diameter: pin.holeDiameter ?? h0?.diameter ?? SALICE.plateHoleDiameter, depth: pin.holeDepth ?? h0?.depth ?? SALICE.plateHoleDepth }))
  }
  return { holes, code: row?.code ?? SALICE.plateCode, patternId: pat?.id }
}

/** Hinge BOM code. Cup size stays on each cabinet's door params. */
export function hingeCode(lib: Library) {
  return hardwareRow(lib, HINGE_ID)?.code ?? SALICE.hingeCode
}

/** Runner screws on the cabinet side, from the runner's boring pattern; pins override. */
export function slideBoring(lib: Library, slide: TandemSlide, pin?: HardwarePin) {
  const id = SLIDE_IDS[slide.part] ?? ''
  const row = hardwareRow(lib, id)
  const pat = boringPattern(lib, id)
  const top = (pat?.holes ?? []).filter((h) => h.face === 1)
  const first = top[0]
  return {
    length: pin?.slideLength ?? row?.slideLength ?? slide.length,
    holes: pin?.slideHoles ?? (top.length ? top.map((h) => h.x) : slide.holesFromFront),
    /** Height of the screw line above the bottom of the drawer opening. */
    line: first?.y ?? BLUM.line,
    diameter: pin?.holeDiameter ?? first?.diameter ?? BLUM.holeDiameter,
    depth: pin?.holeDepth ?? first?.depth ?? BLUM.holeDepth,
    code: row?.code ?? slide.part,
    minCabinetDepth: pin?.minCabinetDepth ?? row?.minCabinetDepth ?? slide.minCabinetDepth,
    patternId: pat?.id,
  }
}
