/**
 * Domain model. All lengths are millimetres.
 *
 * Cabinet coordinates (used by the construction generator and the 3D view):
 *   X = width (left -> right), Y = depth (front = 0 -> back), Z = height (floor = 0 -> up).
 *
 * Part coordinates (used by machining, nesting, labels): a part is a flat panel with
 *   local x along `length` (grain direction), local y along `width`, and the machined
 *   ("face-up") face on top. Operation depths are measured down from that face.
 */

import type { CamPart, DoorStyle, HardwarePattern, LayerRuleSet, Recipe } from '../cam/types'
import type { AiSettings } from './hardware/aiProviders'

export type Vec3 = [number, number, number]

export interface Vec2 {
  x: number
  y: number
}

export interface Material {
  id: string
  code: string
  name: string
  thickness: number
  sheetLength: number
  sheetWidth: number
  /** True when the sheet has a visible grain running along its length (X). */
  grain: boolean
  color: string
  notes?: string
  /** Material cost (M2.8, NEW-20). Absent until the shop enters a price. */
  cost?: MaterialCost
}

/** How a sheet material is costed: per square metre of sheet, or per kilogram (needs the density). */
export interface MaterialCost {
  by: 'area' | 'weight'
  /** Price per m² ('area') or per kg ('weight'), in the shop currency. Absent = not set. */
  price?: number
  /** kg/m³. Needed for costing by weight; also gives sheet and part weights. */
  density?: number
}

export interface EdgeBand {
  id: string
  code: string
  name: string
  thickness: number
  width: number
  color: string
}

export type HardwareCategory =
  | 'shelf-pin'
  | 'hinge'
  | 'mounting-plate'
  | 'connector'
  | 'dowel'
  | 'screw'
  | 'leg'
  | 'slide'
  | 'handle'
  | 'other'

export interface Hardware {
  id: string
  code: string
  name: string
  category: HardwareCategory
  /** Recorded cruciform plate height H. Does not move holes. */
  plateHeight?: number
  /** Plate screws, back from the front of the side. Drives boring. */
  plateSetback?: number
  /** Vertical distance between the two plate screws. Drives boring. */
  plateSpacing?: number
  /** Plate or slide screw diameter. Drives boring. */
  holeDiameter?: number
  /** Plate or slide screw depth. Drives boring. */
  holeDepth?: number
  /** Hinge cup diameter. Written onto a cabinet's doors when jobs are updated. */
  cupDiameter?: number
  cupDepth?: number
  /** Cup centre from the hinge-side door edge. */
  cupCentre?: number
  /** Drawer-box / runner length. Drives the box and the cabinet-side holes. */
  slideLength?: number
  /** Slide screw holes from the front of the cabinet side. */
  slideHoles?: number[]
  /** Smallest cabinet depth for this runner. */
  minCabinetDepth?: number
}

/** Geometry frozen on one cabinet so a library edit can leave that job alone. */
export interface HardwarePin {
  plateSetback?: number
  plateSpacing?: number
  holeDiameter?: number
  holeDepth?: number
  slideLength?: number
  slideHoles?: number[]
  minCabinetDepth?: number
}

/** L1: long edge at y = 0, L2: long edge at y = width, W1: short edge at x = 0, W2: short edge at x = length. */
export type EdgeKey = 'L1' | 'L2' | 'W1' | 'W2'
export const EDGE_KEYS: EdgeKey[] = ['L1', 'L2', 'W1', 'W2']
export type Edges = Partial<Record<EdgeKey, string | null>>

export type OpPurpose =
  | 'shelf-pin'
  | 'mounting-plate'
  | 'hinge-cup'
  | 'dowel'
  | 'confirmat'
  | 'screw-pilot'
  | 'back-groove'
  | 'dado'
  | 'slide'
  | 'custom'

export interface DrillOp {
  kind: 'drill'
  id: string
  x: number
  y: number
  diameter: number
  depth: number
  through: boolean
  purpose: OpPurpose
}

export type HDrillDir = 'XP' | 'XM' | 'YP' | 'YM'

/** Horizontal hole drilled into an edge. (x, y) is the entry point on the edge, z is depth below the face. */
export interface HDrillOp {
  kind: 'hdrill'
  id: string
  x: number
  y: number
  z: number
  diameter: number
  depth: number
  dir: HDrillDir
  purpose: OpPurpose
}

/**
 * Axis-aligned rectangular recess (groove, dado, rabbet). Sides flagged `open` touch the part edge,
 * so the machining strategy may run the tool out past them.
 */
export interface GrooveOp {
  kind: 'groove'
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  depth: number
  open: { x1: boolean; x2: boolean; y1: boolean; y2: boolean }
  purpose: OpPurpose
}

export type Operation = DrillOp | HDrillOp | GrooveOp

export interface PartFrame {
  origin: Vec3
  u: Vec3
  v: Vec3
  n: Vec3
}

export type PartRole = 'side' | 'bottom' | 'top' | 'rail' | 'back' | 'shelf' | 'door' | 'drawer' | 'toekick' | 'custom'

export interface Part {
  key: string
  name: string
  role: PartRole
  materialId: string
  length: number
  width: number
  thickness: number
  /** 'length' = part must keep its length along the sheet grain (only matters on grained materials). */
  grain: 'length' | 'none'
  edges: Edges
  ops: Operation[]
  /** Closed polygon in part coordinates (any winding). Undefined = full rectangle. */
  outline?: Vec2[]
  frame: PartFrame
}

export interface HardwareLine {
  hardwareCode: string
  qty: number
  note?: string
}

// ---------------------------------------------------------------------------------------------
// Parametric cabinet
// ---------------------------------------------------------------------------------------------

export type CabinetKind = 'base' | 'wall' | 'tall'
export type BottomJoint = 'dado' | 'butt'
export type Joinery = 'dowel' | 'confirmat' | 'screw' | 'none'
export type BackType = 'groove' | 'rabbet' | 'applied'

export interface CarcassParams {
  kind: CabinetKind
  width: number
  height: number
  depth: number
  carcassMaterialId: string
  backMaterialId: string
  doorMaterialId: string
  toeKick: { enabled: boolean; height: number; setback: number; board: boolean }
  top: 'rails' | 'full'
  railDepth: number
  bottomJoint: BottomJoint
  dadoDepth: number
  joinery: Joinery
  back: { type: BackType; grooveDepth: number; setback: number; clearance: number }
  shelves: { count: number; frontSetback: number; sideClearance: number }
  shelfPins: {
    enabled: boolean
    diameter: number
    depth: number
    setbackFront: number
    setbackBack: number
    pitch: number
    /** Keep shelf-pin holes at least this far from the bottom top face and the top underside. */
    zoneMargin: number
  }
  doors: {
    count: 0 | 1 | 2
    gap: number
    hingeSide: 'left' | 'right'
    cupDiameter: number
    cupDepth: number
    /** Cup centre distance from the hinge-side door edge (boring distance + cup radius). */
    cupEdgeDistance: number
    hingeFromEnd: number
  }
  edgebands: {
    carcassFront: string | null
    shelfFront: string | null
    door: string | null
  }
  /** Drawer fronts stacked from the bottom of the opening. count 0 = no drawers. */
  drawers: {
    count: number
    /** Front height used when doors share the opening. All-drawer cabinets split the opening equally. */
    frontHeight: number
    /** 'auto' picks 15 / 18 / 21 in from the cabinet depth using Blum's table. */
    slide: 'auto' | 15 | 18 | 21
  }
}

/** Where a cabinet sits in the job's room. (x, y) is the minimum corner of its footprint, in mm. */
export interface CabinetPlacement {
  x: number
  y: number
  /** Which way the front faces: 0 = toward -Y, 90 = toward -X, 180 = toward +Y, 270 = toward +X. */
  rotation: 0 | 90 | 180 | 270
  /** Floor of the cabinet. Base and tall sit at 0; wall cabinets default to 54 in. */
  z: number
}

export interface Room {
  width: number
  depth: number
  height: number
}

export interface PartOverride {
  exclude?: boolean
  edges?: Edges
  extraOps?: Operation[]
  materialId?: string
}

export interface CabinetTemplate {
  id: string
  name: string
  description: string
  generator: 'carcass'
  params: CarcassParams
  builtIn?: boolean
}

export interface CabinetInstance {
  id: string
  /** Position label in the job, e.g. "B1". */
  number: string
  name: string
  templateId: string | null
  qty: number
  params: CarcassParams
  overrides: Record<string, PartOverride>
  placement?: CabinetPlacement
  /** Old hardware geometry kept after a library edit. Absent means follow the library. */
  pin?: { hardware?: Record<string, HardwarePin> }
}

export interface Job {
  id: string
  number: string
  name: string
  customer: string
  notes: string
  createdAt: string
  updatedAt: string
  cabinets: CabinetInstance[]
  room?: Room
  /** Custom (CAD/CAM) parts cut with this job. They share materials, tools, nesting and labels. */
  camParts?: CamPart[]
  /** Sheet layout edited by hand (M2.8, NST-09). Absent = the automatic nest. */
  nestEdit?: SavedNest
}

/** A nest edited by hand, or loaded from a nest list: sheets and where each part sits. */
export interface SavedNest {
  savedAt: string
  sheets: SavedSheet[]
}

export interface SavedSheet {
  materialId: string
  sheetLength: number
  sheetWidth: number
  offcutId?: string
  flip?: { axis: 'end' | 'side'; reference: number; length: number; width: number }
  placements: { uid: string; x: number; y: number; rotated: boolean; flip?: boolean; inside?: string }[]
}

// ---------------------------------------------------------------------------------------------
// Machine / tools
// ---------------------------------------------------------------------------------------------

export type ToolType = 'router' | 'drill-vertical' | 'drill-horizontal' | 'saw'
/** Cutting-edge shape, used by custom-part machining. Cabinet machining only reads `type`. */
export type ToolShape = 'flat' | 'ball' | 'bull' | 'v' | 'drill' | 'saw' | 'profile'

export interface Tool {
  id: string
  /** woodWOP tool number (TNO / T_). */
  number: number
  type: ToolType
  name: string
  diameter: number
  /** Maximum usable cutting depth. */
  maxDepth: number
  shape?: ToolShape
  /** Library folder shown in the tool browser, e.g. "Routers/Compression". */
  folder?: string
  flutes?: number
  rpm?: number
  /** 'calculated' = rpm x flutes x feed per tooth; 'fixed' = `feed` as entered. */
  feedMode?: 'calculated' | 'fixed'
  feedPerTooth?: number
  /** mm/min. */
  feed?: number
  plungeFeed?: number
  /** Depth per pass. 0 or absent = one pass up to maxDepth. */
  stepdown?: number
  centreCutting?: boolean
  /** Deepest straight plunge allowed; deeper entries must ramp or helix. */
  maxPlunge?: number
  /** Included angle for V tools (degrees). */
  angle?: number
  cornerRadius?: number
  /** Saw blade kerf. */
  kerf?: number
  /** Saw blade diameter (run-out of saw cuts). Absent = a placeholder blade is assumed, with a warning. */
  bladeDiameter?: number
  spindle?: 'cw' | 'ccw'
  length?: number
  notes?: string
  /** Shank diameter above the flutes (collision checks). Absent = the cutting diameter. */
  shankDiameter?: number
  /** Length of the cutting edge from the tip. Absent = `maxDepth`. */
  fluteLength?: number
  /** Stick-out: tip to the face of the holder. Anything deeper than this hits the holder. */
  gaugeLength?: number
  /** Holder from `MachineProfile.holders`. Absent = the shop's default holder (`defaultHolderId`). */
  holderId?: string
  /** Aggregate (angle head or rotating aggregate) this tool sits in, from `MachineProfile.aggregates` (TOOL-04). */
  aggregateId?: string
}

/**
 * Tool holder as a revolved outline: radius `r` at height `z` above the holder face (the gauge
 * line), listed bottom to top. Used to draw the holder and to check it against the material.
 */
export interface ToolHolder {
  id: string
  name: string
  profile: { z: number; r: number }[]
  /** Invented numbers until the shop measures its real holders. */
  placeholder?: boolean
  notes?: string
  /**
   * Made from an imported model (STL, OBJ, 3MF, STEP, IGES or BREP): the outline is the model's
   * revolved envelope (the widest point at every height, so it never under-states the holder).
   */
  source?: { file: string; triangles: number; step: number }
}

/**
 * An angle head or a rotating aggregate (TOOL-04): a unit in the spindle that holds a tool at an
 * angle to the spindle. `offset` is from the spindle's gauge point to the tool's gauge point (the
 * face the tool's stick-out is measured from). Fitting one on the machine is a machine-model fact
 * (`capabilities.aggregate`); a library entry never fits it.
 */
export interface Aggregate {
  id: string
  name: string
  kind: 'angle-head' | 'rotating'
  /** Spindle gauge point to the tool's gauge point, mm, with the head at angle 0 (tool pointing along +X). */
  offset: { x: number; y: number; z: number }
  /** Tool axis from vertical, degrees (90 = lying flat). */
  tilt: number
  /** Angles about the vertical axis the head can be set to: any, or a list (degrees from +X). */
  angles: { mode: 'any' } | { mode: 'list'; list: number[] }
  /** Housing round the tool's gauge point: width across the tool, height above the tool axis (to its top), depth below it (to its underside). */
  housing: { width: number; above: number; below: number; length: number }
  placeholder?: boolean
  notes?: string
}

export type MachineAxisId = 'X' | 'Y' | 'Z' | 'A' | 'B' | 'C'
export type MachineHeadKind = 'spindle' | 'drill-block' | 'saw' | 'aggregate'

/**
 * What the machine physically has and can do: axes and travel, table, spoilboard, tool change,
 * heads and capabilities. One model used by the simulator, collision checks, the export checker
 * and posts. Lengths in mm, in machine coordinates (origin at the sheet origin).
 */
export interface MachineModel {
  /** True while any value here is invented. Shown as a warning on every export. */
  placeholder: boolean
  axes: { id: MachineAxisId; min: number; max: number }[]
  /** Usable table (vacuum) area. */
  table: { length: number; width: number }
  spoilboard: { thickness: number }
  toolChange: { x: number; y: number; z: number }
  /** Machine clearance height above the sheet top for long rapids. */
  safeZ: number
  heads: { id: string; kind: MachineHeadKind; name: string }[]
  capabilities: {
    /** 3-axis simultaneous milling (3D surfaces). */
    mill3d: boolean
    /** A saw unit is fitted (saw-groove output allowed). */
    saw: boolean
    /** An aggregate head is fitted (edge milling, angled work). */
    aggregate: boolean
    rotary: boolean
    positional: boolean
    simultaneous5: boolean
  }
}

/** Feeds and speeds for one tool in one material; overrides the tool's own values. */
export interface MaterialFeed {
  toolId: string
  materialId: string
  rpm: number
  feed: number
  plungeFeed: number
}

export interface MachineProfile {
  name: string
  model: string
  /** True while the tool table is invented placeholder data. Shown as a banner everywhere. */
  placeholder: boolean
  mat: 'HOMAG' | 'WEEKE'
  /** How vertical drills are addressed in BohrVert: by diameter (DU, machine picks spindle) or tool number (TNO). */
  drillAddressing: 'diameter' | 'tool-number'
  hasHorizontalDrillUnit: boolean
  /** Grooves as router pockets (<112 Tasche>) or saw grooves (<109 Nuten>). */
  grooveMethod: 'router-pocket' | 'saw'
  /** Maximum depth a through-cut may go below the sheet underside into the spoilboard. */
  spoilboardAllowance: number
  /** Clearance kept round the shank and holder in collision checks (mm). Absent = 2. */
  collisionMargin?: number
  /** How far through-cuts and through-holes go below the underside. */
  throughDepth: number
  cutoutToolNumber: number
  contour: { approach: 'SEN' | 'TAN' | 'SEI'; ramp: boolean; direction: 'climb-cw' | 'ccw' }
  header: { OP: number; FM: number }
  tools: Tool[]
  feeds?: MaterialFeed[]
  holders?: ToolHolder[]
  /**
   * Holder used by router tools that name none (M2.7: collision checks for every router, 2D ones
   * included). Absent = such tools have no holder.
   */
  defaultHolderId?: string
  /** Angle heads and aggregates (TOOL-04). */
  aggregates?: Aggregate[]
  /** Machine model (axes, table, heads, capabilities); absent = the placeholder N-200 model (`machineModelOf`). */
  physical?: MachineModel
  /**
   * Values the shop has confirmed (M2.6e): keys from `src/core/confirm.ts` such as
   * `tool:t140:blade`, `model:spoilboard`, `default:faceStepover`. Anything placeholder and not
   * listed here shows a "Configure" badge. Confirming never switches on any output.
   */
  confirmed?: string[]
  /** The shop's default cutting values for new operations; absent ones are the PLACEHOLDER built-ins. */
  cutDefaults?: Partial<import('./confirm').CutDefaults>
}

export interface NestSettings {
  /** Trim removed from every sheet edge. */
  edgeTrim: number
  /** Extra spacing between parts beyond the cut-out tool diameter. */
  extraSpacing: number
  allowRotation: boolean
  /** Pre-mill allowance per banded edge (edgebander pre-mill station). */
  premill: number
  /** rect = rectangles only; shape = true outlines; auto = try both, keep the better nest. */
  engine?: NestEngine
  /** Let small parts nest inside the cut-outs of larger custom parts. */
  nestInApertures?: boolean
  /** Put all parts of a kit (cabinet, or the kit name on custom parts) on one sheet when they fit. */
  keepKitsTogether?: boolean
  /** Treat each cabinet as a kit. */
  kitByCabinet?: boolean
  /** Onion skin left by the first cut-out pass on small parts (mm, 0 = off); a final pass cuts it. */
  onionSkin?: number
  /** Parts with less area than this (mm²) get the onion skin. */
  onionSkinMaxArea?: number
  /** Which remnant strips to report and save. */
  offcutType?: 'vertical' | 'horizontal' | 'both'
  /** Smallest remnant worth keeping. */
  offcutMinLength?: number
  offcutMinWidth?: number
  /** Fill saved offcuts of the same material before starting full sheets. */
  useOffcuts?: boolean
  /**
   * Shared-line cutting (M2.8, NST-04): rectangular parts nest exactly one cut-out tool diameter
   * apart and the line between neighbours is cut once. Written to MPR only with its own switch.
   */
  sharedLines?: boolean
  /** Parts under this area (mm²) or narrower than `sharedMinSide` keep their own cut-out (hold-down). */
  sharedMinArea?: number
  sharedMinSide?: number
  /**
   * Bridged nesting (M2.8, NST-05): small rectangular parts are linked by short bridges and cut as
   * one continuous path round the group. Written to MPR only with its own switch.
   */
  bridges?: boolean
  /** Bridge width (mm), longest bridge (mm) and largest part linked (mm²). */
  bridgeWidth?: number
  bridgeMaxLength?: number
  bridgeMaxArea?: number
  /**
   * Flip-side sheets (M2.8, NST-07): parts with underside work nest on their own sheets, each with
   * a side-1 program (reference edge, underside holes) run before the sheet's normal program.
   * Written to MPR only with its own switch.
   */
  flipSheets?: boolean
  /** How the sheet is turned over: end for end, or over its long edge. */
  flipAxis?: 'end' | 'side'
  /** Strip milled off on side 1 to make the reference edge, mm. */
  flipReference?: number
}

export type NestEngine = 'rect' | 'shape' | 'auto'

/** A saved sheet remnant kept for later jobs. */
export interface Offcut {
  id: string
  materialId: string
  length: number
  width: number
  /** Job the remnant came from. */
  from?: string
  createdAt: string
}

export interface LabelSettings {
  size: '100x70' | '100x80'
  edgeClearance: number
}

export type UnitSystem = 'mm' | 'in'

export interface ShopSettings {
  shopName: string
  /** Display unit. Every stored length stays in millimetres. */
  units: UnitSystem
  nesting: NestSettings
  labels: LabelSettings
  outputFolder: string
  /** Currency symbol for material costs (M2.8). Default "$". */
  currency?: string
  /** Custom-part module switches. Absent keys take the defaults in `DEFAULT_FEATURES`. */
  features?: Partial<FeatureFlags>
  /** Folder watcher for part-list CSVs (desktop app). */
  batch?: { inbox: string; outbox: string }
  /** Spec-sheet reader provider and models. API keys are never stored here. */
  ai?: AiSettings
}

export interface FeatureFlags {
  /** Custom-part drawing screen. */
  camCad: boolean
  /** DXF import/export on custom parts. */
  camImport: boolean
  /** Profile, pocket, drill, V-carve, sweep operations. */
  camMachining: boolean
  /** Recipes and layer rules. */
  camRules: boolean
  /** Parametric door styles and CSV door lists. */
  camParametric: boolean
  /** True-shape nesting of custom parts. */
  camNesting: boolean
  /** Unattended batch runs from CSV. */
  camBatch: boolean
  /** Toolpath backplot and material-cut view. */
  camBackplot: boolean
  /** Spec-sheet to hardware-pattern pipeline. */
  hardwarePatterns: boolean
  /** Write custom-part operations into N-200 MPR files. Off until the owner has proven output on the machine. */
  camMprOutput: boolean
  /**
   * Write the flat-layer 3D operations (Z-level roughing, waterline) as contour-milling macros.
   * Needs `camMprOutput` too. Off until the owner has proven the output on the machine.
   */
  cam3dMprOutput: boolean
  /** 3D models on custom parts: STL/OBJ/3MF import, mesh tools, sections, work volume from a model. */
  cam3d: boolean
  /** Adaptive clearing and rest machining options on pockets (screens only). */
  camAdaptive: boolean
  /**
   * Solid models (STEP, IGES, BREP): import, face picking and colours, feature recognition to
   * layers, assemblies split into parts, machining picked faces (screens only; output goes through
   * the custom-part MPR switch).
   */
  camSolids: boolean
  /**
   * More 2.5D machining (M2.6): saw-cut settings, facing, chamfers, cuts between curves and along
   * 3D curves, hand-drawn toolpaths, toolpath edits, edge work with a rotating aggregate (screens).
   */
  camMore25d: boolean
  /**
   * Write the M2.6 operations that have a woodWOP form (facing, chamfers, saw cuts with the new
   * settings) to MPR. Needs `camMprOutput` too. Off until proven on the machine.
   */
  cam25dMprOutput: boolean
  /**
   * CAD and tool additions (M2.7): turn-by-turn sketch, dimensions, geometry queries, fill with
   * holes, panelling, image trace, holder and aggregate library, tool data compare, tool grid
   * (screens only; nothing here writes machine output).
   */
  camCadTools: boolean
  /**
   * Nesting additions (M2.8): areas and costs, shared-line and bridged cutting plans, flip-side
   * sheets with the sheet backplot, manual nesting (screens only; each new kind of machine output
   * has its own switch below, off).
   */
  nestAdditions: boolean
  /** Write the shared-line cutting plan instead of separate cut-outs. Off until proven on the machine. */
  nestSharedOutput: boolean
  /** Write bridged groups as one cut-out round each group. Off until proven on the machine. */
  nestBridgeOutput: boolean
  /** Write flip-side sheet programs (side 1 underside, side 2 as usual). Off until proven on the machine. */
  nestFlipOutput: boolean
}

export interface Library {
  materials: Material[]
  edgebands: EdgeBand[]
  hardware: Hardware[]
  templates: CabinetTemplate[]
  /** Drilling patterns for hardware: verified, imported, or drafted and approved. */
  patterns?: HardwarePattern[]
  /** Saved machining recipes (one or more operations applied to geometry). */
  recipes?: Recipe[]
  /** Layer name -> recipe tables used when importing drawings. */
  layerRules?: LayerRuleSet[]
  /** Parametric door styles. */
  doorStyles?: DoorStyle[]
  /** Saved custom parts that can be inserted into other parts or jobs. */
  partLibrary?: CamPart[]
  /** Sheet remnants in stock. */
  offcuts?: Offcut[]
}

export interface AppData {
  version: 1
  library: Library
  machine: MachineProfile
  settings: ShopSettings
  jobs: Job[]
}
