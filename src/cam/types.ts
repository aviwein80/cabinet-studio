/**
 * Custom-part document model. One CamPart is one flat panel (work volume L x W x T) with
 * layered 2D geometry on its six faces and an ordered list of associative operations.
 *
 * Part coordinates match the cabinet side: x along length (grain), y along width, face 1 up.
 * Depths are positive millimetres measured down from face 1.
 *
 * Faces follow woodWOP numbering as used here: 1 top, 2 front edge (y = 0), 3 right edge
 * (x = L), 4 back edge (y = W), 5 left edge (x = 0), 6 underside. Edge-face geometry uses
 * (u, v) = (position along the edge from its left end seen from outside, depth below face 1).
 */
import type { Contour, P } from './geom'
import type { MeshReport, MeshUnits } from './mesh/types'

export type FaceId = 1 | 2 | 3 | 4 | 5 | 6

export interface Layer {
  id: string
  name: string
  color: string
  visible: boolean
  locked: boolean
  /** Construction layers are never machined or exported. */
  construction?: boolean
}

export type Geom =
  | { t: 'contour'; c: Contour }
  | { t: 'circle'; c: P; r: number }
  | { t: 'point'; p: P }
  | { t: 'text'; at: P; text: string; height: number; angle: number; spacing?: number; arc?: { c: P; r: number } }
  | { t: 'spline'; ctrl: P[]; closed: boolean; through?: boolean }
  | { t: 'poly3d'; pts: [number, number, number][] }

export interface Entity {
  id: string
  layer: string
  g: Geom
  face: FaceId
  /** Optional depth for holes drawn as plain circles (used by layer rules and imports). */
  depth?: number
  /** Free tag used by hardware insertion and parametric rebuilds. */
  tag?: string
}

export interface Variable {
  name: string
  value: number
  /** Optional expression in other variables, e.g. "W - 2*rail". */
  expr?: string
  note?: string
}

/** Which axis of the model file points up (becomes +Z, out of face 1). */
export type UpAxis = '+z' | '-z' | '+y' | '-y' | '+x' | '-x'

/**
 * Where a 3D model sits in the part. Applied in order: turn `up` to +Z, rotate `rotZ` degrees
 * about Z, scale, mirror (X), then move so the model's lowest X and Y land on `at[0]`, `at[1]`
 * and its top on `at[2]` (0 = flush with face 1; negative = below it).
 */
export interface ModelPlacement {
  up: UpAxis
  rotZ: number
  scale: number
  mirror: boolean
  at: [number, number, number]
}

/**
 * A 3D model on the part. The mesh itself is not stored in the part (or the shop file): it is a
 * compressed file in the blob store, named by the SHA-256 hash in `blob`.
 */
export interface ModelRef {
  id: string
  name: string
  kind: 'mesh'
  /** SHA-256 of the stored mesh: also the cache key and the associativity input. */
  blob: string
  /** File the model came from. */
  source: string
  /** Unit the file was read in (the stored mesh is in mm). */
  units: MeshUnits
  place: ModelPlacement
  layer: string
  visible: boolean
  triangles: number
  /** Size of the stored mesh in mm (before placement). */
  size: [number, number, number]
  /** Blob of the mesh as first imported, kept when the model is simplified or trimmed. */
  original?: string
  report?: Omit<MeshReport, 'warnings'> & { warnings?: string[] }
}

export interface CamPart {
  id: string
  name: string
  version: 1 | 2
  materialId: string | null
  length: number
  width: number
  thickness: number
  grain: 'length' | 'none'
  qty: number
  layers: Layer[]
  entities: Entity[]
  ops: CamOp[]
  variables: Variable[]
  /** Entity whose contour is the part's cut-out outline. Defaults to the largest closed contour on face 1. */
  outlineId?: string
  /** Parametric door the geometry was generated from. */
  door?: { styleId: string; values: Record<string, number> }
  /** Nesting priority: higher numbers go on earlier sheets. */
  priority?: number
  /** Parts sharing a kit name are kept on one sheet when they fit. */
  kit?: string
  notes?: string
  source?: string
  /**
   * Set on parts drafted from a customer's spec or drawing. A draft cannot be saved, added to a
   * job or nested; it becomes 'approved' when a named person confirms they checked it.
   */
  review?: { status: 'draft' | 'approved'; file: string; drafter: string; reviewedBy?: string; reviewedAt?: string }
  /** 3D models (meshes) placed on the part. */
  models?: ModelRef[]
  /** Work volume was fitted to a model with this oversize (mm); kept so it can be refitted. */
  workVolume?: { modelId: string; oversize: { xy: number; top: number; bottom: number } }
  /** Keep ops on unchanged geometry ids when imports refresh. */
  updatedAt: string
}

// ---------------------------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------------------------

export interface Levels {
  /** Clearance height above face 1 for rapids between features. */
  safeZ: number
  /** Rapid down to this height above face 1, then feed. */
  rapidZ: number
  /** Final depth below face 1. Ignored when `through`. */
  depth: number
  /** Cut through the panel plus the machine's through depth. */
  through: boolean
  /** Material left on the floor. */
  stockZ: number
  /** Depth per pass; 0 = the tool's stepdown (or one pass). */
  passDepth: number
  /** Number of equal cuts; when set it wins over `passDepth`. */
  cuts?: number
}

export type LeadType = 'none' | 'line' | 'arc' | 'line-arc' | 'ramp' | 'centre'
export interface Leads {
  in: LeadType
  out: LeadType
  /** Line length as a multiple of tool radius. */
  length: number
  /** Arc radius as a multiple of tool radius. */
  radius: number
  rampAngle: number
  /** Distance the tool runs past the start point before leaving. Negative leaves a small web. */
  overlap: number
  feedPct: number
}

export interface Tags {
  mode: 'none' | 'auto' | 'manual'
  count: number
  length: number
  height: number
  shape: 'flat' | 'ramp' | 'trapezoid'
  rampAngle: number
  /** Manual positions as fractions (0..1) of contour length. */
  at: number[]
}

/** 'auto' = shapes inside other picked shapes are cut on the inside, the rest on the outside. */
export type ProfileSide = 'outside' | 'inside' | 'left' | 'right' | 'centre' | 'auto'
export type Direction = 'climb' | 'conventional'

interface OpBase {
  id: string
  name: string
  enabled: boolean
  /** Entity ids this op machines (associative input). */
  geometry: string[]
  /** Shared machine-tool id; null = pick automatically. */
  toolId: string | null
  levels: Levels
  feeds: { feed?: number; plunge?: number; rpm?: number }
  face: FaceId
  note?: string
  /** Hash of the inputs when the toolpath was last regenerated; differs = stale. */
  builtHash?: string
  recipeId?: string
  /** Layer rule that made this op; applying the rules again replaces it. Absent = made by hand. */
  auto?: string
}

export interface ProfileOp extends OpBase {
  kind: 'profile'
  side: ProfileSide
  direction: Direction
  /** 'cam' = tool-centre path computed here; 'machine' = controller compensation (woodWOP WRKL/WRKR). */
  compensation: 'cam' | 'machine'
  corners: 'round' | 'straight' | 'loop'
  stockXY: number
  leads: Leads
  tags: Tags
  /** Alternate direction on each pass (open contours only). */
  bidirectional: boolean
  /** Start point as a fraction of contour length; absent = middle of the longest edge. */
  start?: number
  /** Wall angle in degrees from vertical (0 = vertical). */
  slope: number
  /** Machine the picked shapes in drawing order, holes and inner shapes first, or nearest next. */
  order?: 'drawn' | 'inside-first' | 'nearest'
  /** Extra roughing passes outside the final wall, `xyStep` apart. */
  xyPasses?: number
  xyStep?: number
  /** Run open shapes the other way. */
  reverse?: boolean
}

export interface PocketOp extends OpBase {
  kind: 'pocket'
  pattern: 'offset' | 'zigzag' | 'spiral'
  /** Stepover as a fraction of tool diameter. */
  stepover: number
  angle: number
  direction: Direction
  islands: boolean
  entry: 'plunge' | 'ramp' | 'helix'
  rampAngle: number
  /** Helix radius as a fraction of tool radius. */
  helixPct: number
  finishPass: boolean
  stockXY: number
}

export interface DrillOp extends OpBase {
  kind: 'drill'
  cycle: 'drill' | 'peck'
  peck: number
  /** Each peck is this fraction of the one before (1 = equal pecks), never below `minPeck`. */
  peckFactor?: number
  minPeck?: number
  /** Full = back to the rapid height after every peck; partial = lift 1 mm to break the chip. */
  retract?: 'full' | 'partial'
  dwell: number
  select: { mode: 'all' | 'diameter' | 'range'; diameter?: number; min?: number; max?: number }
  depthRef: 'tip' | 'shoulder'
}

export interface EngraveOp extends OpBase {
  kind: 'engrave'
}

export interface VCarveOp extends OpBase {
  kind: 'vcarve'
  /** Lateral step between rings. */
  step: number
}

export interface SawOp extends OpBase {
  kind: 'saw'
}

export interface SweepOp extends OpBase {
  kind: 'sweep'
  /** Section: inset from the guide contour (mm) -> depth below face 1 (mm). */
  section: { inset: number; depth: number }[]
  side: 'inside' | 'outside'
  step: number
}

export interface CodeOp extends OpBase {
  kind: 'code'
  text: string
  stop: boolean
}

/**
 * Where a 3D operation cuts on a model. The tool always keeps clear of every facet of the model
 * (protected and unmachined ones included); `groups` and `protect` only decide where it cuts.
 * The op's `geometry` holds the boundary shapes (closed contours on face 1; none = the model's
 * footprint).
 */
export interface Surface3D {
  modelId: string
  /** Facet groups to machine; empty or absent = all. */
  groups?: number[]
  /** Facet groups the tool must not cut (it lifts over them). */
  protect?: number[]
  /** Tool centre inside the boundary, whole tool inside it, or tool allowed to overhang it. */
  boundaryMode: 'centre' | 'contained' | 'touching'
  /** Material left on the surface, mm (measured along the surface normal). */
  stockToLeave: number
  /** Largest gap between the straight moves and the true tool-centre surface, mm. */
  tolerance: number
}

/** 3D finishing on a model. Stage 2 strategies: parallel (M2.2a), waterline (M2.2b), projection, pencil. */
export interface Finish3dOp extends OpBase {
  kind: 'finish3d'
  /** Parallel: straight passes dropped onto the surface. Waterline: passes at constant heights around the model. */
  strategy: 'parallel' | 'waterline'
  surface: Surface3D
  /** Distance between passes, mm (parallel passes, and the shallow-area fill of waterline). */
  stepover: number
  /** Waterline: height between passes, mm (default 1). */
  stepdown?: number
  /** Waterline: also finish the areas flatter than the minimum slope with parallel passes. */
  fillShallow?: boolean
  /** Pass direction in degrees from +X. */
  angle: number
  /** Back and forth, or every pass the same way (with a lift between). */
  pattern: 'zigzag' | 'oneway'
  /** One-way passes: climb runs along +angle, conventional against it. */
  direction: Direction
  /** Cut only where the surface slope (degrees from flat) is within these limits. */
  slope: { min: number; max: number }
  /** Leave flat areas (slope under 0.5°) for a flat-area pass. */
  skipFlats: boolean
}

/**
 * Z-level roughing (3D-01): the model is sliced into flat levels from the top of the stock down;
 * each level is cleared like a pocket wherever the tool fits without touching the model.
 */
export interface Rough3dOp extends OpBase {
  kind: 'rough3d'
  /** `stockToLeave` is the material left on walls (all round); `stockZ` the material left on floors. */
  surface: Surface3D
  stockZ: number
  /** Height between levels, mm. */
  stepdown: number
  /** Distance between passes as a fraction of the tool diameter. */
  stepover: number
  /** Offset rings from the inside out, or back-and-forth lines (plus a pass along the walls). */
  pattern: 'offset' | 'zigzag'
  /** Zig-zag line angle in degrees from +X. */
  angle: number
  direction: Direction
  /** How the tool goes down into each new area. */
  entry: 'helix' | 'ramp' | 'plunge'
  /** Ramp and helix angle, degrees. */
  rampAngle: number
  /** Helix radius as a fraction of the tool radius. */
  helixPct: number
  /** Add a level at the height of every flat area of the model. */
  flats: boolean
}

export type CamOp = ProfileOp | PocketOp | DrillOp | EngraveOp | VCarveOp | SawOp | SweepOp | CodeOp | Finish3dOp | Rough3dOp
export type CamOpKind = CamOp['kind']

// ---------------------------------------------------------------------------------------------
// Recipes and layer rules
// ---------------------------------------------------------------------------------------------

/** An op template without geometry, saved for reuse. */
export type OpTemplate = Omit<CamOp, 'id' | 'geometry' | 'builtHash'>

export interface Recipe {
  id: string
  name: string
  description?: string
  ops: OpTemplate[]
}

export type QueryField = 'layer' | 'type' | 'closed' | 'diameter' | 'width' | 'height' | 'area' | 'face'
export type QueryOp = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'contains' | 'matches'
export interface QueryTest {
  field: QueryField
  op: QueryOp
  value: string | number | boolean
}

export interface LayerRule {
  id: string
  /** Layer name pattern: exact, glob with * and ?, or /regex/. Case-insensitive. */
  layer: string
  recipeId: string
  /** Extra filter on matched geometry (all tests must pass). */
  where?: QueryTest[]
  /** Depth from layer name, e.g. "POCKET_D6" -> 6 mm, when the recipe has no fixed depth. */
  depthFromName?: boolean
  side?: ProfileSide
  direction?: Direction
  order: number
}

export interface LayerRuleSet {
  id: string
  name: string
  rules: LayerRule[]
  /** Layer whose largest closed contour becomes the outline; empty = largest closed contour anywhere. */
  outlineLayer?: string
  /** Rotate the drawing so its longest edge runs along X. */
  alignLongestEdge: boolean
}

// ---------------------------------------------------------------------------------------------
// Hardware patterns (spec-sheet pipeline)
// ---------------------------------------------------------------------------------------------

/** Box on a source page, normalised 0..1 from the top-left corner: [x0, y0, x1, y1]. */
export type Region = [number, number, number, number]

export interface PatternHole {
  x: number
  y: number
  diameter: number
  depth: number
  face: FaceId
}

export type PatternStatus = 'verified' | 'approved' | 'draft' | 'rejected'
export type PatternSource = 'library' | 'dxf' | 'csv' | 'pdf-draft' | 'manual'

export interface HardwarePattern {
  id: string
  name: string
  manufacturer: string
  /** Library hardware item this pattern drills for. */
  hardwareId?: string
  /** Holes relative to the insertion point: x along the reference edge, y away from it. */
  holes: PatternHole[]
  /** Where the insertion point sits by default when placed on an edge. */
  anchor: 'edge-start' | 'edge-mid' | 'edge-end' | 'corner' | 'centre'
  status: PatternStatus
  source: PatternSource
  /** Where each number came from (file, page, quoted text, box on the page). Required for drafts. */
  provenance: { file?: string; page?: number; quote?: string; note?: string; region?: Region }[]
  reviewedBy?: string
  reviewedAt?: string
  notes?: string
}

// ---------------------------------------------------------------------------------------------
// Parametric doors
// ---------------------------------------------------------------------------------------------

export type DoorKind = 'shaker' | 'arched' | 'cathedral' | 'slab'
export interface DoorStyle {
  id: string
  name: string
  kind: DoorKind
  /** Default variable values (mm); W and H come from each door. */
  defaults: Record<string, number>
  /** Recipe applied to the generated panel-field geometry. */
  fieldRecipeId?: string
  /** Recipe applied to the outline. */
  outlineRecipeId?: string
  materialId?: string
  builtIn?: boolean
}
