/**
 * Stock model: the simulated material left after each move. One interface, several
 * implementations: the heightfield (exact for a vertical 3-axis tool), the dexel stock (intervals
 * per cell: material under an overhang, for lollipop tools, M3.1); tilted tools for 3+2 and 5-axis
 * later (Stage 3) behind the same calls.
 *
 * Part frame: X along the length, Y along the width, Z = 0 at face 1 and negative into the material.
 */
import type { Box3, Mesh } from '../mesh/types'
import type { Cutter, V3 } from '../sim'

export interface StockSnapshot {
  kind: string
  data: Float32Array
}

export interface StockModel {
  /** Heightfield: one height per cell (vertical tools). Dexel: intervals per cell (material under overhangs too). */
  readonly kind: 'heightfield' | 'dexel'
  /** Material extents before any cutting. */
  bounds(): Box3
  /** Remove what the cutter sweeps moving in a straight line from `a` to `b` (tip positions). */
  carve(a: V3, b: V3, cutter: Cutter): void
  /** Tip positions `carve` stamps along a straight move from `a` to `b`, in order. */
  carvePoints(a: V3, b: V3): V3[]
  /** Remove what the cutter covers standing with its tip at `p`. */
  carveAt(p: V3, cutter: Cutter): void
  /**
   * How far the remaining material reaches into an envelope round the tool axis at (x, y): the
   * largest (material top - lowest(d)) over material within `rMax` of the axis, d being the
   * distance from the axis; -Infinity when there is none. Positive = material inside it.
   */
  intrusion(x: number, y: number, rMax: number, lowest: (d: number) => number): { depth: number; d: number }
  /** Top of the material at (x, y); NaN outside the stock. */
  heightAt(x: number, y: number): number
  /** Is (x, y, z) inside the remaining material? */
  occupied(x: number, y: number, z: number): boolean
  /** Highest remaining material within radius `r` of (x, y); -Infinity when there is none. */
  maxInDisc(x: number, y: number, r: number): number
  /** Volume removed so far (mm³). */
  removedVolume(): number
  /** Remaining material as a closed (watertight) triangle mesh. */
  toMesh(): Mesh
  snapshot(): StockSnapshot
  restore(s: StockSnapshot): void
  /** Back to the uncut block. */
  reset(): void
  /**
   * Area changed since the last call (plan view, mm), or null when nothing changed; `through`:
   * some cut reached the underside (cut-free pieces may have changed). Clears the record.
   */
  takeDirty(): { minX: number; minY: number; maxX: number; maxY: number; through: boolean } | null
}
