/**
 * The 5-axis engine interface (5AX-02, 5AX-03, TOOL-07, NEW-26, M3.5).
 *
 * Simultaneous 5-axis toolpaths (the tool tilting while it cuts) come from an engine behind this
 * interface. The intended real engine is a licensed commercial SDK; none is bought or installed
 * (owner decision), so the shop's engine is the stub below, which answers "not licensed". The
 * built-in preview engine (`fake.ts`) makes simple toolpaths for the simulator only (never written);
 * the tests use the same code as a stand-in for a licensed engine.
 *
 * An engine gets plain data (structured-clone friendly, so it can run in the compute worker or
 * another process): the surfaces (a mesh in part coordinates) or curves, the tool with its holder,
 * the strategy's settings and the machine's kinematics; it returns our toolpath IR with a tool
 * direction on every move (`Move.a` / `axes`), plus warnings. What happens next is ours: checking
 * what came back, the independent gouge check, conversion to machine axes (head flip), simulation,
 * collision checks and the export rules.
 *
 * Pure: no DOM, no React.
 */
import type { Work } from '@/core/cancel'
import type { PositionalKinematics, ToolShape } from '@/core/types'
import type { Mesh } from '../mesh/types'
import type { Move } from '../toolpath'
import type { MultiAxisOp, ToolAxisControl } from '../types'
import type { OutlinePt } from '../tools/form'

/** A 3D curve: points in part coordinates (mm), in order. */
export type Curve3 = [number, number, number][]

export interface MultiAxisEngineInfo {
  /** '' for the shop's licensed engine slot, 'preview' for the built-in preview engine. */
  id: string
  name: string
  /** Who makes it (shown on the Machine page). */
  vendor: string
  /** A licensed engine: its toolpaths may be written through a script post (all other rules permitting). */
  licensed: boolean
  /** The built-in preview: simulation only, never written. */
  preview?: boolean
  strategies: MultiAxisOp['strategy'][]
  axisModes: ToolAxisControl['mode'][]
  toolShapes: ToolShape[]
}

/** The tool as an engine sees it: cutting outline, shaft and holder (TOOL-07). */
export interface MultiAxisTool {
  number: number
  name: string
  shape: ToolShape
  diameter: number
  cornerRadius: number
  /** V cutters: included angle, degrees. */
  angle: number
  /** Cutting outline from the tip up (barrel and form tools; others as their shape gives it). */
  outline: OutlinePt[]
  fluteLength: number
  /** Shaft radius above the flutes. */
  shaftR: number
  /** Tip to holder face (Infinity = not known). */
  gauge: number
  /** Holder outline above the gauge line, heights from the tip. */
  holder: { z: number; r: number }[]
}

export interface MultiAxisRequest {
  part: { length: number; width: number; thickness: number }
  strategy: MultiAxisOp['strategy']
  axis: ToolAxisControl
  /** The model, placed in part coordinates; `groups` to cut, `check` to keep clear of (absent = all). */
  surface: { mesh: Mesh; groups?: number[]; check?: number[] } | null
  /** Drive curves ('curve'; bottom curves for 'swarf'), top curves ('swarf'), the guide curve. */
  curves: { drive: Curve3[]; top: Curve3[]; guide: Curve3 | null }
  /** Boundary on face 1 (closed loops of x, y), 'surface' and 'rough'; empty = the model's footprint. */
  boundary: [number, number][][]
  tool: MultiAxisTool
  /** Swarf: side of the wall the tool runs on, seen along the direction of travel. */
  side: 'left' | 'right'
  stepover: number
  stepdown: number
  stockToLeave: number
  tolerance: number
  /** Below the drive curve along the tool ('curve'), mm. */
  depth: number
  /** Heights above face 1: safe height for moves between cuts, and the clearance above the start of each cut. */
  safeZ: number
  rapidZ: number
  /**
   * Which axis solution the machine should use (NEW-26), a hint for engines that plan the axes;
   * the conversion to machine axes applies it (ours, `kinematics5.ts`). Cutting a path reversed or
   * both ways is ours too (`result.ts`), on whatever the engine returns.
   */
  headFlip: MultiAxisOp['headFlip']
  /** Largest turn of the tool axis per mm of travel, degrees (0 = no limit). */
  maxTurn: number
  gougeCheck: boolean
  /** The machine's two rotary axes, their travel and layout, when the job's machine has them. */
  machine: { kinematics: PositionalKinematics; travel: { first: { min: number; max: number }; second: { min: number; max: number } } } | null
}

export type MultiAxisResult =
  | { status: 'ok'; moves: Move[]; warnings: string[] }
  /** No licensed engine: nothing is calculated. */
  | { status: 'not-licensed'; message: string }
  /** The engine cannot do this (strategy, tool shape, axis mode). */
  | { status: 'unsupported'; message: string }
  | { status: 'failed'; message: string }

export interface MultiAxisEngine {
  info: MultiAxisEngineInfo
  /** Calculate a toolpath. Synchronous: it runs in the compute worker with the other 3D operations. */
  generate(req: MultiAxisRequest, work?: Work): MultiAxisResult
}

/** What the stub says. */
export const NOT_LICENSED = '5-axis engine not licensed: simultaneous 5-axis toolpaths need a licensed 5-axis engine, and none is installed (an owner decision; nothing is bought or downloaded without the owner\'s written OK). The built-in preview engine can make a toolpath for the simulator only.'

/** The shop's 5-axis engine until a licensed one is installed: every request is "not licensed". */
export const STUB_ENGINE: MultiAxisEngine = {
  info: { id: '', name: 'No 5-axis engine (not licensed)', vendor: '-', licensed: false, strategies: [], axisModes: [], toolShapes: [] },
  generate: () => ({ status: 'not-licensed', message: NOT_LICENSED }),
}
