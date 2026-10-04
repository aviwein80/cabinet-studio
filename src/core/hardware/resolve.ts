import type { HardwarePin, Library } from '../types'
import { SALICE, type TandemSlide } from './specs'

export const PLATE_ID = 'hw-plate'
export const HINGE_ID = 'hw-hinge'

/** Catalog part number → stable library id. Boring looks up the id, never the name. */
export const SLIDE_IDS: Record<string, string> = {
  '563H3810B': 'hw-td-15',
  '563H4570B': 'hw-td-18',
  '563H5330B': 'hw-td-21',
}

export function hardwareRow(lib: Library, id: string) {
  return lib.hardware.find((h) => h.id === id)
}

/** Plate screws. `plateHeight` is intentionally not read here. */
export function plateBoring(lib: Library, pin?: HardwarePin) {
  const row = hardwareRow(lib, PLATE_ID)
  return {
    setback: pin?.plateSetback ?? row?.plateSetback ?? SALICE.plateSetback,
    spacing: pin?.plateSpacing ?? row?.plateSpacing ?? SALICE.plateSpacing,
    diameter: pin?.holeDiameter ?? row?.holeDiameter ?? SALICE.plateHoleDiameter,
    depth: pin?.holeDepth ?? row?.holeDepth ?? SALICE.plateHoleDepth,
    code: row?.code ?? SALICE.plateCode,
  }
}

/** Hinge BOM code. Cup size stays on each cabinet's door params. */
export function hingeCode(lib: Library) {
  return hardwareRow(lib, HINGE_ID)?.code ?? SALICE.hingeCode
}

export function slideBoring(lib: Library, slide: TandemSlide, pin?: HardwarePin) {
  const row = hardwareRow(lib, SLIDE_IDS[slide.part] ?? '')
  return {
    length: pin?.slideLength ?? row?.slideLength ?? slide.length,
    holes: pin?.slideHoles ?? row?.slideHoles ?? slide.holesFromFront,
    code: row?.code ?? slide.part,
    minCabinetDepth: pin?.minCabinetDepth ?? row?.minCabinetDepth ?? slide.minCabinetDepth,
  }
}
