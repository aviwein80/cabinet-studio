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
  /** How the layer's shapes are drawn on screen and in prints (NEW-21; absent = solid). */
  lineType?: LineType
}

/** Line types (NEW-21): dash lengths are paper mm in a print, so they look the same at any scale. */
export type LineType = 'solid' | 'dashed' | 'hidden' | 'centre' | 'dotted'

/** A hatch (NEW-21): parallel lines over closed shapes (by id: it follows them as they change). */
export interface HatchNote {
  id: string
  k: 'hatch'
  shapes: string[]
  /** Degrees from the X axis. */
  angle: number
  /** Distance between the lines, part mm. */
  spacing: number
  /** Crossed: the same lines again at 90° more. */
  cross?: boolean
}

/** A detail view (NEW-21): the circle `c`, `r` magnified `scale` times and shown centred on `at`. */
export interface DetailNote {
  id: string
  k: 'detail'
  c: P
  r: number
  scale: number
  at: P
  label: string
}

/** Annotations on face 1 (NEW-21): notes only, never machined or exported to a machine. */
export type Annotation = HatchNote | DetailNote

export type Geom =
  | { t: 'contour'; c: Contour }
  | { t: 'circle'; c: P; r: number }
  | { t: 'point'; p: P }
  | { t: 'text'; at: P; text: string; height: number; angle: number; spacing?: number; arc?: { c: P; r: number }; font?: StrokeFont }
  | { t: 'spline'; ctrl: P[]; closed: boolean; through?: boolean }
  | { t: 'poly3d'; pts: [number, number, number][] }

/**
 * A single-stroke engraving font (NEW-24): glyphs are strokes (polylines) on the font's grid, x
 * from 0 and y from the baseline up, `capHeight` units tall. Text keeps a copy of the glyphs it
 * uses (same id and name as the library font), so it never changes when the library font does.
 */
export interface StrokeFont {
  id: string
  name: string
  capHeight: number
  /** Space after the last letter's ink that the text width leaves out, grid units. */
  gap: number
  glyphs: Record<string, StrokeGlyph>
}
export interface StrokeGlyph {
  strokes: [number, number][][]
  /** How far the next letter starts, grid units. */
  advance: number
}

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
  /**
   * Surfaces made in the app (NEW-19) whose facets are rows and columns of points: the layout of
   * the stored mesh `blob` (row after row, `cols` points each), so passes can follow its rows or
   * columns (curve-driven finishing). Ignored once the blob changes. `trimmed`: a solid face's rows
   * and columns (M3.1g), whose points beyond the face's edges are left out of its facets.
   */
  grid?: { blob: string; rows: number; cols: number; closedRows: boolean; closedCols: boolean; trimmed?: boolean }
  /**
   * Set when the model is a relief (ART-01): the stored mesh is already made to its size (X and Y
   * from 0, highest point at Z 0). Operations on it stay inside its outline, and the panel face
   * round it is never cut.
   */
  relief?: ReliefInfo
}

/** A relief brought in from relief software (STL) or a height map (ART-01). */
export interface ReliefInfo {
  from: 'mesh' | 'image'
  /** Size made, mm: X, Y and depth (highest to lowest point). */
  size: [number, number, number]
  /** Outline seen from above, in the stored mesh's coordinates: closed loops of x, y pairs. */
  outline: number[][]
  /** Height maps: the picture and how it was read. */
  image?: { width: number; height: number; bits: number; whiteHigh: boolean; stretched: boolean; spacing: number; smooth: number; depth: number }
  /** Meshes: size as read (mm) and the facets of a base that were taken off. */
  mesh?: { size: [number, number, number]; baseRemoved: number }
}

/** Part axis a rotary set-up turns about (M3.3). */
export type RotaryAxis = 'X' | 'Y' | 'Z'

/**
 * A wrapped (developed) work plane (NEW-14, M3.3): the cylinder of `radius` round the part's
 * rotary axis, from `start` to `end` along the axis (part coordinates) and from `a0` to `a1`
 * degrees round it, unrolled flat. Along the axis lengths stay as they are; round it, 1 mm of the
 * plane is 1 mm of arc at `radius`. The unrolled rectangle lies in the drawing with its corner
 * (`start`, `a0`) at `at`: shapes drawn inside it are wrapped onto the cylinder.
 */
export interface WrappedPlane {
  id: string
  name: string
  radius: number
  start: number
  end: number
  a0: number
  a1: number
  at: P
  /** How it was set: a radius (the whole blank, all the way round), extents, or fitted to a model's cylindrical face. */
  from: 'radius' | 'extents' | 'face'
  /** The face it was fitted to: model, face id (solids) and how far the face's points stray from the cylinder (mm). */
  face?: { modelId: string; faceId?: number; fit: number }
}

/**
 * A part turned on a rotary axis (M3.3): the axis (along part X, Y or Z, through `centre`), the
 * blank held on it and the wrapped planes round it. Angles round the axis are measured from
 * straight up (+Z; +X for an axis along Z), turning right-handed about the axis.
 */
export interface RotarySetup {
  axis: RotaryAxis
  /** A point on the axis (part coordinates; its coordinate along the axis is not used). */
  centre: { x: number; y: number; z: number }
  /** The blank: round (diameter `size`) or square (side `size`), from `start` to `end` along the axis. */
  blank: { shape: 'round' | 'square'; size: number; start: number; end: number }
  planes: WrappedPlane[]
}

/**
 * A tilted work plane (5AX-01, M3.4): a plane through the part at any angle, with its own x and y
 * along it and z (its normal) out of the material, the way the tool points from its tip to the
 * spindle. Its frame (`src/cam/positional/frame.ts`): turned `toward + 90 + spin` degrees about Z,
 * then tilted `tilt` degrees so its normal leans from +Z towards the plan direction `toward`
 * (degrees from +X). Shapes drawn inside its rectangle on the drawing (corner `at`, `size` along
 * its x and y) lie on the plane; an operation on it (`OpBase.tiltedPlane`) cuts them into the part
 * along -z, depths measured from the plane, the tool along z. A machine with two rotary axes locks
 * them at the angles that turn the tool onto z (positional "3+2" machining). The N-200 has none and
 * refuses such operations.
 */
export interface TiltedPlane {
  id: string
  name: string
  /** The plane's x = y = 0 point, part coordinates. */
  origin: { x: number; y: number; z: number }
  /** Degrees from level (0 = like face 1, 90 = upright, 180 = facing down). */
  tilt: number
  /** Plan direction the normal leans towards, degrees from +X counter-clockwise seen from above. */
  toward: number
  /** Turn of the plane's x about its normal, degrees (0 = x level, y up the slope). */
  spin: number
  /** Its rectangle on the drawing: corner `at` (the origin) and size along its x and y. */
  at: P
  size: { x: number; y: number }
  /** How it was set: angles typed in, a side of the part's block, or fitted to a model's flat face. */
  from: 'angles' | 'side' | 'face'
  /** The face it was fitted to: model, face id (solids) and how far the face's points stray from the plane (mm). */
  face?: { modelId: string; faceId?: number; fit: number }
  /** Use the machine's other angle solution (head or table turned the other way round). */
  flip?: boolean
}

/** What a fixture is for (M3.6, FIX-01): only the name and where it goes by default differ. */
export type FixtureKind = 'clamp' | 'pod' | 'rail'

/**
 * A slice of an imported model (M3.6): the convex outline of everything the model has between two
 * heights (x, y pairs, its own frame), so the slice holds the whole model there.
 */
export interface FixtureSlab {
  z0: number
  z1: number
  hull: number[]
}

/**
 * A fixture's shape in its own frame (M3.6): x, y from its reference point, z up from its base.
 * Block and round: the reference point is the middle of the base. Outline: closed loops drawn on
 * the part (x, y pairs, from the reference point), stood up `height`. Model: an imported solid or
 * mesh as slices (its base at 0, centred on its reference point).
 */
export type FixtureShape =
  | { k: 'block'; length: number; width: number; height: number }
  | { k: 'round'; diameter: number; height: number }
  | { k: 'outline'; loops: number[][]; height: number }
  | { k: 'model'; slabs: FixtureSlab[]; file: string; triangles: number; size: [number, number, number] }

/**
 * A clamp, pod or rail on a part (M3.6, FIX-01). Its shape stands on its base at `at.z` (part z:
 * 0 = face 1, -thickness = the underside, where a clamp stands on the table), its reference point
 * at `at.x`, `at.y` on the drawing, turned `rot` degrees about the vertical.
 */
export interface Fixture {
  id: string
  name: string
  kind: FixtureKind
  shape: FixtureShape
  at: { x: number; y: number; z: number }
  rot: number
  /** Placed by "Place automatically" (that moves it again when it runs again). */
  auto?: boolean
  /** Sizes from an invented example until entered or confirmed: shown with a Configure badge. */
  placeholder?: boolean
  /** Left out of the checks (kept on the part). */
  off?: boolean
  /** Library entry it came from (`MachineProfile.fixtureTypes`). */
  typeId?: string
}

export interface CamPart {
  id: string
  name: string
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11
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
  /** Assembly the part belongs to (batch part lists, M2.9); printed on its label instead of "Custom". */
  assembly?: string
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
  /** Hatching and detail views on face 1 (NEW-21): notes only, never machined or exported to a machine. */
  annotations?: Annotation[]
  /** Turn-by-turn sketches (CAD-02) kept so their shapes can be opened and solved again, by entity id. */
  sketches?: Record<string, TurnSketch>
  /** Work volume was fitted to a model with this oversize (mm); kept so it can be refitted. */
  workVolume?: { modelId: string; oversize: { xy: number; top: number; bottom: number } }
  /** Turned on a rotary axis (M3.3): the axis, the blank and the wrapped planes. Such a part is never nested on a sheet. */
  rotary?: RotarySetup
  /** Tilted work planes (M3.4, positional 3+2 machining). A part with operations on one is never nested on a sheet. */
  tilted?: TiltedPlane[]
  /**
   * Clamps, pods and rails holding the part (M3.6, FIX-01). Never machined or written to a
   * machine; the collision checks keep the tool, shank, holder and machine clear of them.
   */
  fixtures?: Fixture[]
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
  /** Moves between cuts follow this surface instead of the flat safe height (2D-18). */
  rapidSurface?: RapidSurface
  /**
   * Tilted work plane this operation works on (M3.4, positional 3+2): its shapes are drawn inside
   * the plane's rectangle and cut into the part along the plane's -z, the tool tilted onto the
   * plane's normal. Drilling, pockets, profiles and engraving only. Absent = face 1 as usual.
   */
  tiltedPlane?: string
}

/**
 * A surface the moves between cuts follow (2D-18): the top of a cylinder lying along X or Y (its
 * axis at `centre` across and `z` above face 1), or of a sphere centred over `c`. Never below the
 * operation's clearance height. `confirmed`: the owner checked it (a suggested surface is not).
 */
export type RapidSurface = ({ kind: 'cylinder'; axis: 'x' | 'y'; centre: number } | { kind: 'sphere'; c: P }) & { z: number; r: number; confirmed?: boolean }

/** Tool data as an operation used it (TOOL-05). Lengths in mm, feeds in mm/min. */
export interface ToolSnapshot {
  toolId: string
  number: number
  diameter: number
  maxDepth: number
  shape?: string
  angle?: number
  cornerRadius?: number
  /** Barrel cutters (TOOL-07): the side's arc radius. */
  barrelRadius?: number
  /** Form tools (TOOL-07): the outline. */
  form?: import('@/core/types').FormPoint[]
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
 * (M2.2c), pencil (M2.3c). Stage 3 (M3.1): radial and spiral.
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
   * the valleys and inside corners, where the tool touches two surfaces at once. Radial: straight
   * passes out from a centre. Spiral: one continuous spiral round a centre. Scallop: passes offset
   * across the surface for the same cusp height everywhere. Flat areas: offset passes only where
   * the tool rests on a flat face. Helical: one continuous descent round steep walls. Undercut:
   * a lollipop tool under overhangs, entering and leaving sideways. Curve-driven: passes guided by
   * drive curves, an earlier toolpath, the line where two surfaces meet or a surface's own rows
   * and columns (`drive`).
   */
  strategy: 'parallel' | 'waterline' | 'projection' | 'pencil' | 'radial' | 'spiral' | 'scallop' | 'flat' | 'helical' | 'undercut' | 'curve'
  surface: Surface3D
  /**
   * Distance between passes, mm (parallel passes, the shallow-area fill of waterline; radial: the
   * largest gap between neighbouring passes, at the outer edge; spiral: between turns).
   */
  stepover: number
  /** Waterline and helical: height between passes (helical: per round), mm (default 1). */
  stepdown?: number
  /** Waterline: also finish the areas flatter than the minimum slope with parallel passes. */
  fillShallow?: boolean
  /** Pass direction in degrees from +X (radial: the first pass; spiral: where it starts). */
  angle: number
  /** Radial and spiral: the centre, part coordinates (absent = the middle of the boundary). */
  centre?: { x: number; y: number }
  /** Radial and spiral: passes start this far from the centre, mm (default 0). */
  innerRadius?: number
  /**
   * Radial one-way passes and the spiral: run out from the centre (default) or in towards it.
   * Scallop: inward (default) works away from the start (in from the boundary), outward works back
   * towards it. Flat areas: inward (default) from the edge of each flat area in, outward from its
   * middle out.
   */
  travel?: 'outward' | 'inward'
  /**
   * Scallop: shapes on face 1 (open or closed) the passes start from and are offset away from, on
   * both sides; none = the boundary (passes work in from it).
   */
  startFrom?: string[]
  /** Back and forth, or every pass the same way (with a lift between). */
  pattern: 'zigzag' | 'oneway'
  /**
   * One-way parallel passes: climb runs along +angle, conventional against it. Spiral: climb turns
   * counter-clockwise seen from above, conventional clockwise.
   */
  direction: Direction
  /** Cut only where the surface slope (degrees from flat) is within these limits. */
  slope: { min: number; max: number }
  /** Leave flat areas (slope under 0.5°) for a flat-area pass. */
  skipFlats: boolean
  /** Undercut: the undersides of overhangs, the floors beneath them, or both (default). */
  undercut?: 'underside' | 'floor' | 'both'
  /** Pencil: valleys sharper than this (degrees between the two surfaces) get a pass (default 5). */
  pencilAngle?: number
  /** Curve-driven: what guides the passes. */
  drive?: CurveDrive
  /**
   * Curve-driven: keep the tool on one side of these facet groups: in front of them (the side
   * their facets face, the outside of a solid) or behind. They are never cut; passes stop where
   * the tool would touch them or reach the other side.
   */
  keepSide?: { groups: number[]; side: 'front' | 'back' }
  /**
   * 3D rest machining: cut only where earlier operations (ids; empty = every earlier milling
   * operation) left more than `minThickness` mm on the model, as their toolpaths simulate.
   */
  rest?: { from: string[]; minThickness: number }
}

/**
 * What guides curve-driven finishing (3D-09). Every pass is dropped onto the model like any other
 * 3D finishing pass; the drive only says where in plan it runs.
 */
export interface CurveDrive {
  /**
   * Curves: one or two shapes on face 1 (one: the shape and copies offset from it; two: passes
   * blended from the first to the second). Toolpath: the cutting moves of an earlier operation
   * (and copies offset from them). Intersection: along the line where two sets of the model's
   * facet groups meet, the tool touching both (ball-nose). Parameter: along the rows or columns
   * of a surface made in the app.
   */
  mode: 'curves' | 'toolpath' | 'intersection' | 'parameter'
  /** Curves: the shape(s) on face 1. */
  shapes?: string[]
  /** Toolpath: the earlier operation whose toolpath guides the passes. */
  opId?: string
  /** Intersection: the facet groups of the two surfaces. */
  groupsA?: number[]
  groupsB?: number[]
  /** Parameter: the surface whose rows or columns guide the passes (absent = the machined model). */
  modelId?: string
  /** Parameter: along its rows or along its columns. */
  along?: 'rows' | 'columns'
  /** One curve and toolpath: copies offset to both sides of the drive, or to one side only. */
  side?: 'both' | 'left' | 'right'
  /** One curve and toolpath: copies each side (0 = the drive only; absent = as many as the boundary holds). */
  copies?: number
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
   * adaptive clearing (a steady width of cut). Undercut (M3.1g): a lollipop clears the material
   * under overhangs that the other patterns (from above) leave, level by level, working in from
   * the open side; `stepover` is then a share of the ball's diameter and `stockToLeave` is left on
   * every face (`stockZ` is not used).
   */
  pattern: 'offset' | 'zigzag' | 'adaptive' | 'undercut'
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

/**
 * Thread milling (NEW-08, M3.2): a single-profile thread mill runs a helix round each picked circle
 * (`geometry`), inside it (internal thread) or round it (external), one pitch per turn, in radial
 * passes out to the full thread depth. `levels.depth` is the thread's length below face 1.
 */
export interface ThreadOp extends OpBase {
  kind: 'thread'
  side: 'internal' | 'external'
  /** Major (nominal) diameter, mm; 0 = each picked circle's own diameter. */
  diameter: number
  pitch: number
  hand: 'right' | 'left'
  /** Cut from face 1 down, or from the bottom up. */
  travel: 'down' | 'up'
  /** Thread depth (radial, major to minor), mm; 0 = the ISO basic depth for the pitch. */
  threadDepth: number
  /** Radial passes out to the full depth. */
  passes: number
  /** One more pass at full depth. */
  spring: boolean
}

/**
 * Rotary machining (3D-10, M3.3). The part turns on its rotary axis (`CamPart.rotary`) and the
 * tool stands square to the axis, pointing at it. On a model (`modelId`): passes along the axis
 * stepping round it ('along'), rings round the axis stepping along it ('around'), or one
 * continuous spiral ('spiral'), roughing in levels when `stepdown` is set. 'wrap' (drive geometry
 * through the axis): the picked shapes, drawn inside a wrapped plane's unrolled rectangle, cut
 * `levels.depth` below the plane's surface, or below the model's surface found straight in
 * towards the axis (`onModel`). Every toolpath is expressed on the wrapped plane `planeId`: drawing
 * x and y on its unrolled rectangle, and z = distance from the axis minus the plane's radius.
 */
export interface RotaryOp extends OpBase {
  kind: 'rotary'
  planeId: string
  strategy: 'along' | 'around' | 'spiral' | 'wrap'
  /** The model machined (model strategies, and 'wrap' with `onModel`); empty = every model on the part. */
  modelId: string
  /** Gap between passes, mm: round the axis (measured on the blank's surface) for 'along'; along the axis for 'around' and 'spiral'. */
  stepover: number
  /** Roughing: radial step-down from the blank's surface, mm; 0 = one pass on the model (finishing). */
  stepdown: number
  /** Material left on the model, mm. */
  stockToLeave: number
  /** Chord tolerance, mm. */
  tolerance: number
  /** Passes in both directions (zig-zag), or all one way. */
  zigzag: boolean
  /** 'wrap': depth below the model's surface instead of the plane's. */
  onModel?: boolean
}

/**
 * How the tool axis is set along a simultaneous 5-axis toolpath (5AX-02, M3.5). Directions are from
 * the tool tip towards the spindle, part coordinates. Our own names:
 * - 'vertical': straight up (3-axis on a 5-axis machine);
 * - 'fixed': one direction throughout, `tilt` degrees from vertical leaning towards plan direction
 *   `toward` (degrees from +X);
 * - 'surface-normal': along the surface's normal where the tool touches it; 'curve-normal': square to
 *   the drive curve, as near upright as it can be; both then leaned `lead` degrees forwards (the top
 *   of the tool along the direction of travel) and `tilt` degrees to the left of travel;
 * - 'through-point' / 'away-from-point': the axis passes through `point` (the tool leans towards it),
 *   or points away from it; 'through-line' / 'away-from-line': the same with the line through `point`
 *   along `dir`;
 * - 'guide': the axis passes through the matching point of a guide curve (`guide`, by share of length).
 * `maxTilt` limits every direction to that many degrees from vertical.
 */
export interface ToolAxisControl {
  mode: 'vertical' | 'fixed' | 'surface-normal' | 'curve-normal' | 'through-point' | 'away-from-point' | 'through-line' | 'away-from-line' | 'guide'
  lead: number
  tilt: number
  /** 'fixed': plan direction the tool leans towards, degrees from +X. */
  toward: number
  point: { x: number; y: number; z: number }
  dir: { x: number; y: number; z: number }
  /** 'guide': the guide curve (an entity id). */
  guide?: string
  /** Largest angle from vertical, degrees. */
  maxTilt: number
}

/**
 * A simultaneous 5-axis operation (5AX-02, 5AX-03, M3.5): the tool tilts while it cuts, the tool axis
 * set by `axis`. The toolpath comes from a 5-axis engine behind our `MultiAxisEngine` interface
 * (`src/cam/multiaxis/engine.ts`); none is licensed, so in the shop it returns "not licensed". The
 * built-in preview engine (`engine` 'preview') makes simple toolpaths for the simulator only; they are
 * never written. Never written to woodWOP (the N-200 has 3 axes); only a script post for a machine
 * model with simultaneous 5-axis may write a licensed engine's toolpath.
 *
 * Strategies (our names): 'curve' cuts along 3D curves or solid edges (`geometry`), the tip
 * `levels.depth` below them along the tool; 'swarf' cuts with the side of the tool along walls given
 * by a bottom curve (`geometry`) and a top curve (`top`), the tool along the line between them;
 * 'surface' finishes a model's surface within a boundary (`geometry`, closed shapes on face 1; none =
 * the model's footprint); 'rough' clears material from a model in multi-axis levels.
 */
export interface MultiAxisOp extends OpBase {
  kind: 'multiaxis'
  /** '' = the shop's licensed 5-axis engine (none: "not licensed"); 'preview' = the built-in preview engine (simulation only). */
  engine: string
  strategy: 'curve' | 'swarf' | 'surface' | 'rough'
  /** The model cut ('surface', 'rough') and checked for gouges (every strategy; '' = none). */
  modelId: string
  /** Facet groups to cut ('surface'); empty or absent = all. */
  groups?: number[]
  /** Facet groups the tool must not cut into (gouge checks); empty or absent = every facet of the model. */
  check?: number[]
  /** 'swarf': the top curve(s), one per bottom curve in `geometry`, in the same order. */
  top?: string[]
  /** 'swarf': the side of the wall the tool runs on, seen along the direction of travel. */
  side?: 'left' | 'right'
  axis: ToolAxisControl
  /** Distance between passes, mm ('surface', 'rough'). */
  stepover: number
  /** Height between levels, mm ('rough'). */
  stepdown: number
  /** Material left on the model, mm. */
  stockToLeave: number
  /** Largest gap between the moves and the true path, mm. */
  tolerance: number
  /** Cut each path as drawn, reversed, or there and back (NEW-26). */
  direction: 'forward' | 'reversed' | 'both'
  /**
   * Which of the machine's two axis solutions to use (NEW-26): the usual one (least turn of the first
   * axis), the other one (the head turned 180° round), or whichever stays inside the travel (auto).
   */
  headFlip: 'auto' | 'usual' | 'other'
  /** Axis smoothing: the tool axis turns at most `maxTurn` degrees per mm of travel (0 = no limit). */
  maxTurn: number
  /** Gouge check against the model (and `check` groups) while the toolpath is made. */
  gougeCheck: boolean
}

export type CamOp = ProfileOp | PocketOp | DrillOp | EngraveOp | VCarveOp | SawOp | SweepOp | CodeOp | Finish3dOp | Rough3dOp | FaceOp | ChamferOp | CurveOp | ManualOp | EdgeOp | ThreadOp | RotaryOp | MultiAxisOp
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

/**
 * Facts a query can test. Shapes (Stage 1): layer, type, closed, diameter, width, height, area,
 * face; added in M2.7 (CAD-17): length, radius, depth, segments, arcs, holes (closed shapes inside
 * it), inside (lies inside another closed shape), outline (is the part outline), tag, role (made
 * from a solid as ...), x, y (middle of its box). Faces of solids and whole models have their own
 * fields (`src/cam/query.ts`).
 */
export type QueryField = 'layer' | 'type' | 'closed' | 'diameter' | 'width' | 'height' | 'area' | 'face' | 'length' | 'radius' | 'depth' | 'segments' | 'arcs' | 'holes' | 'inside' | 'outline' | 'tag' | 'role' | 'x' | 'y'
export type QueryOp = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'contains' | 'matches' | 'between' | 'in' | '!contains' | '!matches'
export interface QueryTest {
  field: QueryField
  op: QueryOp
  value: string | number | boolean
  /** Upper end for 'between' (inclusive). */
  value2?: number
}

/** A test on any target's facts (faces and models have fields of their own). */
export interface GeoTest {
  field: string
  op: QueryOp
  value: string | number | boolean
  value2?: number
}

/**
 * A geometry query (CAD-17): tests on shapes, on the faces of solid models, or on whole models;
 * all of them must pass ('all') or any one ('any'). With a result layer, what it finds goes there
 * (shapes are moved; faces are sent to the layer as shapes; models are put on it).
 */
export interface GeoQuery {
  id: string
  name: string
  target: 'shapes' | 'faces' | 'models'
  match: 'all' | 'any'
  tests: GeoTest[]
  resultLayer?: string
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
  /**
   * Auto-queries (CAD-17), run before the rules: the shapes each finds are moved to its result
   * layer, so the rules then machine them by that layer name.
   */
  queries?: GeoQuery[]
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
