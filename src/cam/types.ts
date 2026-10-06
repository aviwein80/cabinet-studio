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
  /**
   * Made from faces of a solid (feature recognition, or machining picked faces directly). The
   * shape follows the solid: when the model's data changes, it is made again from these faces.
   */
  solid?: { modelId: string; faces: number[]; blob: string; role: SolidRole }
}

/** What a shape made from solid faces stands for. */
export type SolidRole = 'outline' | 'cutout' | 'pocket' | 'island' | 'hole' | 'edge' | 'profile' | 'saw'

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
  /**
   * Turn applied before everything else: a 3 x 3 rotation (row by row) that lays a solid flat in
   * the part's frame (set by feature recognition). Absent = none.
   */
  frame?: number[]
  up: UpAxis
  rotZ: number
  scale: number
  mirror: boolean
  at: [number, number, number]
}

/**
 * A 3D model on the part. The mesh itself is not stored in the part (or the shop file): it is a
 * compressed file in the blob store, named by the SHA-256 hash in `blob`.
 *
 * Solids (STEP, IGES, BREP; `kind: 'solid'`): `blob` holds the faces with their ids, colours and
 * surface types (see `src/cam/solid/encode.ts`); `file` the file as read, kept so it can be read
 * again. Face colours and layers set in the app are kept here by face id.
 */
export interface ModelRef {
  id: string
  name: string
  kind: 'mesh' | 'solid'
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
  /** Size of the stored mesh in mm (before placement; after the `frame` turn when there is one). */
  size: [number, number, number]
  /** Blob of the mesh as first imported, kept when the model is simplified or trimmed. */
  original?: string
  report?: Omit<MeshReport, 'warnings'> & { warnings?: string[] }
  /** Solids: blob of the original file. */
  file?: string
  /** Solids: number of faces (ids as in the file). */
  faces?: number
  /** Solids: file format and schema, e.g. "STEP AP214". */
  format?: string
  /** Solids: face colours set in the app (face id -> #rrggbb); they win over the file's colours. */
  faceColors?: Record<string, string>
  /** Solids: faces sent to layers (face id -> layer id). */
  faceLayers?: Record<string, string>
}

export interface CamPart {
  id: string
  name: string
  version: 1 | 2 | 3 | 4
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
  /** Dimensions on face 1 (CAD-08): notes only, never machined or exported to a machine. */
  dims?: Dimension[]
  /** Origin of ordinate dimensions (absent = the part's corner 0,0). */
  dimOrigin?: P
  /** Turn-by-turn sketches (CAD-02) kept so their shapes can be opened and solved again, by entity id. */
  sketches?: Record<string, TurnSketch>
  /** Work volume was fitted to a model with this oversize (mm); kept so it can be refitted. */
  workVolume?: { modelId: string; oversize: { xy: number; top: number; bottom: number } }
  /** Keep ops on unchanged geometry ids when imports refresh. */
  updatedAt: string
}

/** What a dimension end refers to: a node of a shape, the centre of a circle or arc (segment `index`), or a fixed point. */
export type DimRef = { entity: string; at: 'node' | 'centre'; index: number } | { p: P }

/**
 * A dimension (CAD-08). Linear: two ends, the dimension line `offset` mm from the first end
 * (sideways to the measured direction). Angular: vertex and two arm points, arc radius `offset`,
 * `side` 'other' for the angle the other way round. Radius / diameter: one circle or arc, leader
 * at angle `offset` (radians). Ordinate: one point, leader `offset` mm long, along X (`axis` 'x',
 * the default) or Y, measured from `CamPart.dimOrigin`.
 */
export interface Dimension {
  id: string
  kind: 'aligned' | 'horizontal' | 'vertical' | 'angular' | 'radius' | 'diameter' | 'ordinate'
  refs: DimRef[]
  offset: number
  side?: 'other'
  axis?: 'x' | 'y'
  /** Also show the other unit (mm beside inches, or inches beside mm). */
  alt?: boolean
  /** Text instead of the measured value. */
  text?: string
}

/**
 * A turn-by-turn sketch (CAD-02): a closed outline described element by element from a start
 * point. Values left null are unknowns the solver works out.
 */
export interface TurnSketch {
  start: P
  elements: TurnElement[]
  /** Close back to the start (the outline is closed). */
  closed: boolean
}

export interface TurnElement {
  kind: 'line' | 'arc'
  /** Line: length; arc: sweep in degrees (positive). null = unknown. */
  length: number | null
  /**
   * Direction at the element's start, degrees from +X (absolute), or the turn from the end of the
   * element before ('turn'); null = unknown. A turn of 0 is tangent.
   */
  angle: number | null
  angleMode: 'absolute' | 'turn'
  /** Arcs: radius (null = unknown) and which way they turn. */
  radius?: number | null
  ccw?: boolean
  /** Corner at the end of this element: a blend (round) or a chamfer of this size, mm. */
  corner?: { kind: 'blend' | 'chamfer'; size: number }
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
  /** Changes made to the calculated toolpath (NEW-11). */
  edits?: ToolpathEdits
  /**
   * Values of this operation the owner confirmed or set (M2.6e: default-cutting-value keys such as
   * `faceStepover`); they no longer show a "Configure" badge.
   */
  confirmed?: string[]
  /**
   * The tool data this operation was last calculated with (TOOL-05), kept so it can be compared with
   * the tool table later. Not an input: it never marks the operation stale by itself.
   */
  toolData?: ToolSnapshot
}

/** Tool data as an operation used it (TOOL-05). Lengths in mm, feeds in mm/min. */
export interface ToolSnapshot {
  toolId: string
  number: number
  diameter: number
  maxDepth: number
  shape?: string
  angle?: number
  cornerRadius?: number
  fluteLength?: number
  shankDiameter?: number
  /** Stick-out used (the tool's, or the assumed one). */
  gauge?: number
  /** Holder used (the tool's or the shop default). */
  holderId?: string
  rpm: number
  feed: number
  plunge: number
}

/**
 * A move of a calculated toolpath that an edit was made on: its number in the unedited toolpath
 * (3D chains counted point by point) and where it ended then. When the toolpath is calculated
 * again and differs, the edit is moved to the move that now ends at the same point; if there is
 * none, the edit is lost and the operation is flagged.
 */
export interface MoveAnchor {
  i: number
  x: number
  y: number
  z: number
}

/**
 * Edits on a calculated toolpath (NEW-11). Rule-based ones (corners, rapid height, reverse, start
 * points) always carry over to a new toolpath; point edits use anchors.
 */
export interface ToolpathEdits {
  /** Slow down near corners sharper than `angle` degrees: `distance` mm each side, in `steps`, down to `percent` % of the feed at the corner. */
  corners?: { angle: number; distance: number; steps: number; percent: number }
  /** Feed on stretches of moves (from and to included), percent of the operation's feed. */
  feeds?: { from: MoveAnchor; to: MoveAnchor; percent: number }[]
  /** Heights set point by point: the move ends at `z` (mm, 0 = face 1). */
  z?: { at: MoveAnchor; z: number }[]
  /** Moves between cuts at this height above face 1 instead of the safe height. */
  rapidHeight?: number
  /** Run the toolpath backwards: the last cut first, each the other way. */
  reverse?: boolean
  /** Pockets: each depth starts at the point of its first pass nearest one of these. */
  starts?: { x: number; y: number }[]
  /** Hash of the unedited toolpath the point edits were made on. */
  base?: string
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
  /** 'adaptive': clearing at a steady width of cut (NEW-01), settings in `adaptive`. */
  pattern: 'offset' | 'zigzag' | 'spiral' | 'adaptive'
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
  /**
   * Rest machining (2D-07): cut only the material that earlier operations left in the pocket,
   * worked out from their toolpaths. `from`: those operations (ids); empty = every enabled
   * milling operation before this one. Pieces that cut less than `minLength` mm are skipped.
   */
  rest?: { from: string[]; minLength: number }
  /** Adaptive clearing settings (used when `pattern` is 'adaptive'). */
  adaptive?: AdaptiveSettings
}

export interface AdaptiveSettings {
  /** Width of cut to hold, as a fraction of the tool diameter. */
  width: number
  /** Or the engagement angle, degrees; when set it wins over `width`. */
  angle?: number
  /** Smallest turning radius of the path, mm (0 = turn freely). */
  smoothing: number
  /** Lift for the moves back through cleared area, mm. */
  lift: number
  /** Adaptive feed: lighter cuts and the moves back run up to this many times the feed (1 = off). */
  feedBoost: number
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
  /**
   * Saw-cut settings (2D-11). Absent = the Stage 1 groove: the blade plunges at the start of each
   * straight line and runs to its end.
   */
  saw?: SawSettings
}

/**
 * How a saw cut runs. The blade's run-out (how far its cut reaches along the line at the surface
 * beyond the point where it is at full depth) follows from the blade diameter and the depth.
 */
export interface SawSettings {
  /** Blade tilt from vertical, degrees (0 = vertical, up to 45: angled cuts). */
  tilt: number
  /** Side the blade leans to, seen along the cut. */
  tiltSide: 'left' | 'right'
  /**
   * Extend to clear: full depth right to both ends of the line (the blade's cut at the surface
   * runs past each end by its run-out). Off: the cut at the surface stays on the drawn line and the
   * floor is short of each end by the run-out.
   */
  clear: boolean
  /** Extra length added at each end, mm. */
  extend: number
  /** Blade diameter for this operation, mm (absent = the tool's). */
  blade?: number
  /** Lines shorter than this (after joining) are not cut, mm. */
  minLength: number
  /** Join straight lines that lie on one line and touch or overlap into one cut. */
  join: boolean
  /**
   * Avoid cutting into neighbours: the blade's cut (at the surface, and at the floor of an angled
   * cut) never leaves the part's outline; ends are pulled back and the part left uncut is reported.
   */
  avoid: boolean
}

/**
 * Facing (2D-16): mill the top of the panel (or the picked closed shapes) down by `levels.depth`.
 * With `resetTop`, later operations on face 1 measure their depths from the faced surface.
 */
export interface FaceOp extends OpBase {
  kind: 'face'
  /** Back-and-forth lines, or rings from the outside in. */
  pattern: 'zigzag' | 'offset'
  /** Distance between passes as a fraction of the tool diameter. */
  stepover: number
  /** Line angle in degrees from +X (back and forth). */
  angle: number
  direction: Direction
  /** How far the tool centre runs past the boundary, mm (0 = centre on the edge). */
  overhang: number
  /** Later operations measure their depths from the faced top. */
  resetTop: boolean
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
 * footprint); for projection finishing it holds the shapes to project instead.
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

/**
 * 3D finishing on a model. Stage 2 strategies: parallel (M2.2a), waterline (M2.2b), projection
 * (M2.2c).
 *
 * Projection: `geometry` holds the shapes to project (not a boundary); `levels.depth` is the depth
 * below the surface (0 = on the surface), cut in passes like 2D engraving (`levels.passDepth`,
 * `levels.cuts`). Step-over, angle, pattern, slope limits and skip flats do not apply to it.
 */
export interface Finish3dOp extends OpBase {
  kind: 'finish3d'
  /**
   * Parallel: straight passes dropped onto the surface. Waterline: passes at constant heights
   * around the model. Projection: drawn shapes and text dropped onto the surface. Pencil: along
   * the valleys and inside corners, where the tool touches two surfaces at once.
   */
  strategy: 'parallel' | 'waterline' | 'projection' | 'pencil'
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
  /** Pencil: valleys sharper than this (degrees between the two surfaces) get a pass (default 5). */
  pencilAngle?: number
  /**
   * 3D rest machining: cut only where earlier operations (ids; empty = every earlier milling
   * operation) left more than `minThickness` mm on the model, as their toolpaths simulate.
   */
  rest?: { from: string[]; minThickness: number }
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
  /**
   * Offset rings from the inside out, or back-and-forth lines (plus a pass along the walls), or
   * adaptive clearing (a steady width of cut).
   */
  pattern: 'offset' | 'zigzag' | 'adaptive'
  /** Zig-zag line angle in degrees from +X. */
  angle: number
  direction: Direction
  /** Adaptive clearing settings (pattern 'adaptive'). */
  adaptive?: AdaptiveSettings
  /** How the tool goes down into each new area. */
  entry: 'helix' | 'ramp' | 'plunge'
  /** Ramp and helix angle, degrees. */
  rampAngle: number
  /** Helix radius as a fraction of the tool radius. */
  helixPct: number
  /** Add a level at the height of every flat area of the model. */
  flats: boolean
}

/**
 * Chamfer (2D-13): a V cutter's flank cuts a bevel along the edge of the picked shapes (2D shapes
 * on face 1, or level 3D edges of a solid at their height). The tip runs `tipOffset` below the
 * chamfer's bottom so the flank, not the point, makes it.
 */
export interface ChamferOp extends OpBase {
  kind: 'chamfer'
  /** Side the cutter runs on (the waste side): outside or inside a closed shape, left or right of an open one. */
  side: 'outside' | 'inside' | 'left' | 'right'
  /** The size is the chamfer's width on the face, or its depth down the edge. */
  drive: 'width' | 'depth'
  /** Width or depth, mm. */
  size: number
  /** Tip below the chamfer's bottom, mm (0 = the tip runs on the edge's bottom line). */
  tipOffset: number
  direction: Direction
}

/**
 * Curve cuts (2D-15). Between: the surface ruled between two curves (`geometry[0]` and `[1]`;
 * 3D polylines at their heights, 2D shapes at `depthA` / `depthB`), finished with passes from one
 * curve to the other, the tool dropped onto that surface. Along a 3D curve: the tool tip follows 3D
 * polylines (optionally smoothed into a curve through their points), `levels.depth` below them in
 * passes. Z-wave: 2D shapes cut with the depth rising and falling along them.
 */
export interface CurveOp extends OpBase {
  kind: 'curve'
  mode: 'between' | 'follow3d' | 'zwave'
  /** Between: largest distance between passes, mm. */
  stepover: number
  /** Between: depth of a 2D first / second curve below face 1, mm. */
  depthA: number
  depthB: number
  /** Between: every other pass runs back. */
  zigzag: boolean
  /** Along a 3D curve: a smooth curve through the polyline's points instead of straight pieces. */
  smooth: boolean
  /** Z-wave: depth from `min` to `max` and back every `length` mm along the shape (closed shapes get a whole number of waves). */
  wave: { min: number; max: number; length: number; shape: 'sine' | 'triangle' }
  /** Largest gap between the straight moves and the true path or surface, mm. */
  tolerance: number
}

/** One step of a hand-drawn toolpath: a straight feed, a rapid, or an arc (centre given) to a point. */
export type ManualStep =
  | { k: 'feed'; x: number; y: number; z: number }
  | { k: 'rapid'; x: number; y: number; z: number }
  | { k: 'arc'; x: number; y: number; z: number; cx: number; cy: number; ccw: boolean }

/**
 * Hand-drawn toolpath (NEW-09): the tool goes to `start` (from the safe height) and then runs the
 * steps in order, as picked on the drawing.
 */
export interface ManualOp extends OpBase {
  kind: 'manual'
  start: { x: number; y: number; z: number }
  steps: ManualStep[]
}

/**
 * Edge work with a rotating aggregate (5AX-04): a horizontal tool on an aggregate that turns about
 * the vertical axis, kept square to the edge of the picked shapes (the part outline by default) and
 * pushed `reach` mm into it with its axis `height` mm below face 1, e.g. a groove round the edge.
 * Only for a machine model with an aggregate; never written to woodWOP until its macro is confirmed.
 */
export interface EdgeOp extends OpBase {
  kind: 'edge'
  /** Tool axis below face 1, mm. */
  height: number
  /** How far the tool tip goes into the edge, square to it, mm. */
  reach: number
  /** Reach per pass, mm (0 = one pass). */
  reachPass: number
  direction: Direction
  /** Open shapes: how far the tool runs on past each end, mm. */
  overrun: number
}

export type CamOp = ProfileOp | PocketOp | DrillOp | EngraveOp | VCarveOp | SawOp | SweepOp | CodeOp | Finish3dOp | Rough3dOp | FaceOp | ChamferOp | CurveOp | ManualOp | EdgeOp
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
