/** Analytic test surfaces for the 3D strategies (z = 0 at the top of each). */
import { relief, type Soup } from './mesh-fixtures'

// radius 20 so the 6 mm ball's 25 mm flutes reach the base
export const hemisphere = (x: number, y: number) => {
  const r = Math.hypot(x - 40, y - 40)
  return r < 20 ? Math.sqrt(400 - r * r) - 20 : -20
}
export const sine = (x: number, y: number) => -3 + 2.5 * Math.sin(x / 15) * Math.cos(y / 20)
export const raisedPanel = (x: number, y: number) => {
  const e = Math.min(x - 20, y - 20, 180 - x, 130 - y) // distance in from the bevel's outer edge
  return e >= 40 ? 0 : e <= 0 ? -10 : -10 + (10 * e) / 40
}
export const cove = (_x: number, y: number) => (y < 20 ? -Math.sqrt(Math.max(0, 400 - (y - 20) ** 2)) : -20)

export const SURFACES: Record<string, { soup: () => Soup; f: (x: number, y: number) => number }> = {
  hemisphere: { soup: () => relief(80, 80, 160, 160, hemisphere), f: hemisphere },
  sine: { soup: () => relief(150, 100, 150, 100, sine), f: sine },
  'raised-panel': { soup: () => relief(200, 150, 200, 150, raisedPanel), f: raisedPanel },
  cove: { soup: () => relief(60, 40, 30, 160, cove), f: cove },
}


/**
 * M3.1 scallop test surface (not in SURFACES): a smooth hill and a smooth hollow on a flat, so the
 * surface curves both ways (and in between, saddle-like) with slopes up to about 22°.
 */
export const bumps = (x: number, y: number) => -10 + 8 * Math.exp(-((x - 45) ** 2 + (y - 45) ** 2) / 300) - 8 * Math.exp(-((x - 105) ** 2 + (y - 55) ** 2) / 300)
