/**
 * Stock model: the simulated material left after each move. One interface, several
 * implementations: the heightfield (exact for a vertical 3-axis tool), the dexel stock (intervals
 * per cell: material under an overhang, for lollipop tools, M3.1), the rotary stock (M3.3) and the
 * tri-dexel stock for tilted tools (M3.4, positional 3+2) behind the same calls.
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
  /**
   * Heightfield: one height per cell (vertical tools). Dexel: intervals per cell (material under
   * overhangs too). Rotary (M3.3): intervals along rays out from a rotary axis, in the blank's
   * unrolled frame (x along the axis, y round it, z = distance from the axis less the blank's
   * radius), so "vertical" means square to the axis. Tri-dexel (M3.4): intervals along rays in
   * X, Y and Z, carved by tools along any direction (`axis`); the others ignore `axis`.
   */
  readonly kind: 'heightfield' | 'dexel' | 'rotary' | 'tridexel'
  /** Material extents before any cutting. */
  bounds(): Box3
  /** Remove what the cutter sweeps moving in a straight line from `a` to `b` (tip positions); `axis`: tool direction (tip to spindle), absent = straight up. */
  carve(a: V3, b: V3, cutter: Cutter, axis?: V3): void
  /** Tip positions `carve` stamps along a straight move from `a` to `b`, in order. */
  carvePoints(a: V3, b: V3): V3[]
  /** Remove what the cutter covers standing with its tip at `p`. */
  carveAt(p: V3, cutter: Cutter, axis?: V3): void
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
