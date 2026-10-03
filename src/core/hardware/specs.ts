/**
 * Published boring patterns. Lengths are millimetres.
 *
 * Salice soft-close hinge (Silentia+ Series 700, 110°, full overlay) and a 3 mm cruciform plate.
 * - Cup Ø35. K is the distance from the door edge to the near edge of the cup; Salice lists K = 3 to 6 mm
 *   for this 110° hinge, so the centre is K + 17.5. We use K = 3.
 *   Source: Salice Silentia+ Series 700, 110°, USA
 *   https://www.salice.com/downloads/2349/2759/Salice-SilentiaPlus-Series700-110-standard-USA.pdf
 *   and the boring-pattern sheet (K called "boring distance from the edge of the door")
 *   https://static.richelieu.com/documents/docsGr/120/329/8/1203298/3506045.pdf
 * - Full-overlay crank: overlay D = 15 + K − H. K = 3 and a 3 mm plate give D = 15 mm. Same Series 700 catalog.
 * - Cup depth 13.5 mm is the Series 700 cup. Series 200 Silentia+ is 15.5 mm deep; we do not use that.
 * - Cruciform plate drilling is 37 × 32 mm. Euro-screw plate B2VGV, H = 3, fixes with an Ø5 × 11 mm euro screw.
 *   https://www.salice.com/ww/en/products/hinges/series-200-mounting-plates-with-traditional-assembly-series-800
 *   The wood-screw plate B2V3V (H = 3) uses a B 3.5 DIN 7983 screw instead. Which fixing is stocked is not confirmed;
 *   the holes below are the euro-screw pattern.
 *
 * Blum TANDEM plus BLUMOTION 563H, frameless, the three US lengths the shop stocks.
 * - 563H3810B = 15 in (381), 563H4570B = 18 in (457), 563H5330B = 21 in (533).
 * - Blum's cabinet-depth table: a 24 in (610) cabinet takes 21 in, 21 in (533) takes 18 in, 18 in (457) takes 15 in.
 * - Frameless screw locations, from the cabinet front face, are on the 37 mm System 32 line:
 *   15 in → 165 and 357, 18 in → 261 and 453, 21 in → 261 and 517 (each is 37 + n×32).
 * - The screw line is 37 mm above the bottom of that drawer's opening. Runner setback from the face is 3 mm.
 * - Inside drawer width = opening width − 42. Maximum side thickness 16 mm (5/8 in).
 *   Bottom clearance 14, minimum top clearance 6, so the box is at most opening − 20 tall.
 *   Bottom recess 13 mm.
 *   Sources: https://d2.blum.com/services/BEC003/tdm563h_ma_dok_bus_$sen-us_$aof_$v4.pdf
 *   and https://downloads.cabinetparts.com/auto/blumtandemblumotion563hgeneral.pdf
 * - Cabinet holes are Ø5 for Blum system screw 662.1150.HG. Wood screw 606N / 606P wants a 2.5 mm pilot.
 *   Which screw is stocked is not confirmed; the holes below are Ø5.
 */

export const SALICE = {
  hingeCode: 'SALICE-110-SC',
  plateCode: 'SALICE-B2VGV-H3',
  cupDiameter: 35,
  cupDepth: 13.5,
  /** Door edge to the near edge of the Ø35 cup. */
  k: 3,
  cupCentreFromEdge: 3 + 35 / 2,
  /** Two plate screws, 32 mm apart, this far back from the front edge of the side. */
  plateSetback: 37,
  plateSpacing: 32,
  plateHoleDiameter: 5,
  plateHoleDepth: 11,
} as const

export interface TandemSlide {
  inches: 15 | 18 | 21
  /** Nominal runner / drawer-box length. */
  length: number
  part: string
  /** Smallest overall cabinet depth Blum lists for this runner. */
  minCabinetDepth: number
  /** Minimum inside cabinet depth. */
  minInside: number
  /** Screw holes from the front edge of the cabinet side. */
  holesFromFront: number[]
}

export const TANDEM: TandemSlide[] = [
  { inches: 15, length: 381, part: '563H3810B', minCabinetDepth: 457, minInside: 404, holesFromFront: [165, 357] },
  { inches: 18, length: 457, part: '563H4570B', minCabinetDepth: 533, minInside: 480, holesFromFront: [261, 453] },
  { inches: 21, length: 533, part: '563H5330B', minCabinetDepth: 610, minInside: 557, holesFromFront: [261, 517] },
]

export const BLUM = {
  /** Height of the runner screws above the bottom of the drawer opening, and the System 32 front setback. */
  line: 37,
  pitch: 32,
  runnerSetback: 3,
  insideWidthDeduction: 42,
  maxSideThickness: 16,
  bottomClearance: 14,
  topClearance: 6,
  bottomRecess: 13,
  holeDiameter: 5,
  holeDepth: 12,
  /** Drawer-back hook bore, from the rear-view callouts. */
  hookDiameter: 6,
  hookDepth: 10,
  hookFromEnd: 7,
  hookFromBottom: 11,
} as const

export function selectTandem(cabinetDepth: number, choice: 'auto' | 15 | 18 | 21): { slide: TandemSlide; shallow: boolean } {
  if (choice !== 'auto') {
    const slide = TANDEM.find((t) => t.inches === choice) ?? TANDEM[0]
    return { slide, shallow: cabinetDepth + 0.01 < slide.minCabinetDepth }
  }
  const fitting = TANDEM.filter((t) => cabinetDepth + 0.01 >= t.minCabinetDepth)
  const slide = fitting.length > 0 ? fitting[fitting.length - 1] : TANDEM[0]
  return { slide, shallow: fitting.length === 0 }
}

/** Hinge heights snapped so the two plate screws land on the 32 mm grid. */
export function hingeHeights(z0: number, z1: number, fromEnd: number, count: number, gridOrigin: number, pitch: number) {
  const wanted: number[] = []
  for (let i = 0; i < count; i++) {
    const a = z0 + fromEnd
    const b = z1 - fromEnd
    wanted.push(a + ((b - a) * i) / (count - 1))
  }
  return wanted.map((z) => Math.round((Math.round((z - pitch / 2 - gridOrigin) / pitch) * pitch + pitch / 2 + gridOrigin) * 1000) / 1000)
}
