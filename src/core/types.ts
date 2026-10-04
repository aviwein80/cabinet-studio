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
}

// ---------------------------------------------------------------------------------------------
// Machine / tools
// ---------------------------------------------------------------------------------------------

export type ToolType = 'router' | 'drill-vertical' | 'drill-horizontal' | 'saw'

export interface Tool {
  id: string
  /** woodWOP tool number (TNO / T_). */
  number: number
  type: ToolType
  name: string
  diameter: number
  /** Maximum usable cutting depth. */
  maxDepth: number
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
  /** How far through-cuts and through-holes go below the underside. */
  throughDepth: number
  cutoutToolNumber: number
  contour: { approach: 'SEN' | 'TAN' | 'SEI'; ramp: boolean; direction: 'climb-cw' | 'ccw' }
  header: { OP: number; FM: number }
  tools: Tool[]
}

export interface NestSettings {
  /** Trim removed from every sheet edge. */
  edgeTrim: number
  /** Extra spacing between parts beyond the cut-out tool diameter. */
  extraSpacing: number
  allowRotation: boolean
  /** Pre-mill allowance per banded edge (edgebander pre-mill station). */
  premill: number
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
}

export interface Library {
  materials: Material[]
  edgebands: EdgeBand[]
  hardware: Hardware[]
  templates: CabinetTemplate[]
}

export interface AppData {
  version: 1
  library: Library
  machine: MachineProfile
  settings: ShopSettings
  jobs: Job[]
}
