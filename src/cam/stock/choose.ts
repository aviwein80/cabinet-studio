/**
 * The stock model a program needs: the heightfield for vertical tools (fast, exact for them), the
 * dexel stock when a lollipop works under an overhang (a heightfield cannot hold material over an
 * empty space and would show the lip cut away).
 */
import type { Toolpath } from '../toolpath'
import { DexelStock } from './dexel'
import { HeightfieldStock } from './heightfield'

export function needsDexel(toolpaths: readonly Pick<Toolpath, 'tool'>[]): boolean {
  return toolpaths.some((tp) => tp.tool?.shape === 'lollipop')
}

export function stockFor(panel: { length: number; width: number; thickness: number }, toolpaths: readonly Pick<Toolpath, 'tool'>[], cell?: number): HeightfieldStock | DexelStock {
  return needsDexel(toolpaths) ? new DexelStock(panel.length, panel.width, panel.thickness, cell) : new HeightfieldStock(panel.length, panel.width, panel.thickness, cell)
}
