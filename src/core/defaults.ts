import type {
  AppData,
  CabinetTemplate,
  CarcassParams,
  EdgeBand,
  Hardware,
  Library,
  MachineProfile,
  Material,
  ShopSettings,
} from './types'

export const DEFAULT_MATERIALS: Material[] = [
  { id: 'mat-pb18-white', code: 'PB18-WHT', name: 'Melamine PB 18 white', thickness: 18, sheetLength: 2800, sheetWidth: 2070, grain: false, color: '#f1f0ec' },
  { id: 'mat-pb18-oak', code: 'PB18-OAK', name: 'Melamine PB 18 natural oak (grain)', thickness: 18, sheetLength: 2800, sheetWidth: 2070, grain: true, color: '#c9a77c' },
  { id: 'mat-mdf18', code: 'MDF18', name: 'MDF 18 raw (paint grade)', thickness: 18, sheetLength: 2440, sheetWidth: 1220, grain: false, color: '#b9a48a' },
  { id: 'mat-hdf6-white', code: 'HDF6-WHT', name: 'HDF 6 white back', thickness: 6, sheetLength: 2800, sheetWidth: 2070, grain: false, color: '#e9e7e2' },
]

export const DEFAULT_EDGEBANDS: EdgeBand[] = [
  { id: 'eb-white-1', code: 'EB-WHT-1.0', name: 'ABS white 1.0 x 22', thickness: 1, width: 22, color: '#f5f5f2' },
  { id: 'eb-white-04', code: 'EB-WHT-0.4', name: 'PVC white 0.4 x 22', thickness: 0.4, width: 22, color: '#f5f5f2' },
  { id: 'eb-oak-1', code: 'EB-OAK-1.0', name: 'ABS natural oak 1.0 x 22', thickness: 1, width: 22, color: '#c9a77c' },
]

export const DEFAULT_HARDWARE: Hardware[] = [
  { id: 'hw-pin', code: 'PIN-5', name: 'Shelf pin 5 mm', category: 'shelf-pin' },
  { id: 'hw-hinge', code: 'HINGE-110', name: 'Concealed hinge 110°, full overlay', category: 'hinge' },
  { id: 'hw-plate', code: 'PLATE-CLIP-0', name: 'Clip mounting plate 0 mm', category: 'mounting-plate' },
  { id: 'hw-dowel', code: 'DOWEL-8x30', name: 'Wood dowel 8 x 30', category: 'dowel' },
  { id: 'hw-confirmat', code: 'CONFIRMAT-7x50', name: 'Confirmat screw 7 x 50', category: 'connector' },
  { id: 'hw-screw', code: 'SCREW-4x50', name: 'Chipboard screw 4 x 50', category: 'screw' },
]

export const BASE_PARAMS: CarcassParams = {
  kind: 'base',
  width: 600,
  height: 870,
  depth: 560,
  carcassMaterialId: 'mat-pb18-white',
  backMaterialId: 'mat-hdf6-white',
  doorMaterialId: 'mat-pb18-white',
  toeKick: { enabled: true, height: 100, setback: 60, board: false },
  top: 'rails',
  railDepth: 100,
  bottomJoint: 'dado',
  dadoDepth: 8,
  joinery: 'screw',
  back: { type: 'groove', grooveDepth: 8, setback: 12, clearance: 0.5 },
  shelves: { count: 1, frontSetback: 20, sideClearance: 1 },
  shelfPins: { enabled: true, diameter: 5, depth: 12, setbackFront: 37, setbackBack: 37, pitch: 32, zoneMargin: 60 },
  doors: { count: 2, gap: 3, hingeSide: 'left', cupDiameter: 35, cupDepth: 13, cupEdgeDistance: 22.5, hingeFromEnd: 100 },
  edgebands: { carcassFront: 'eb-white-1', shelfFront: 'eb-white-04', door: 'eb-white-1' },
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export const BUILTIN_TEMPLATES: CabinetTemplate[] = [
  {
    id: 'tpl-base-2door',
    name: 'Base cabinet, 2 doors',
    description: 'Toe-kick sides, dadoed bottom, grooved back, two rails, 1 adjustable shelf.',
    generator: 'carcass',
    params: clone(BASE_PARAMS),
    builtIn: true,
  },
  {
    id: 'tpl-base-1door',
    name: 'Base cabinet, 1 door',
    description: 'Narrow base (up to ~500 mm) with one door hinged left.',
    generator: 'carcass',
    params: { ...clone(BASE_PARAMS), width: 450, doors: { ...BASE_PARAMS.doors, count: 1 } },
    builtIn: true,
  },
  {
    id: 'tpl-sink-base',
    name: 'Sink base',
    description: 'No shelf, butt-jointed bottom with dowels (needs edge drilling).',
    generator: 'carcass',
    params: { ...clone(BASE_PARAMS), width: 800, bottomJoint: 'butt', joinery: 'dowel', shelves: { ...BASE_PARAMS.shelves, count: 0 } },
    builtIn: true,
  },
  {
    id: 'tpl-wall-2door',
    name: 'Wall cabinet, 2 doors',
    description: 'Full top and bottom in dados, grooved back, 2 adjustable shelves.',
    generator: 'carcass',
    params: {
      ...clone(BASE_PARAMS),
      kind: 'wall',
      height: 720,
      depth: 320,
      top: 'full',
      toeKick: { ...BASE_PARAMS.toeKick, enabled: false },
      shelves: { ...BASE_PARAMS.shelves, count: 2 },
    },
    builtIn: true,
  },
]

/**
 * PLACEHOLDER tool table. These numbers are invented. They must be replaced with the shop's real
 * HOMAG CENTATEQ N-200 tool table before any program is run, even in simulation.
 */
export const PLACEHOLDER_MACHINE: MachineProfile = {
  name: 'HOMAG CENTATEQ N-200 (placeholder tools)',
  model: 'CENTATEQ N-200',
  placeholder: true,
  mat: 'HOMAG',
  drillAddressing: 'diameter',
  hasHorizontalDrillUnit: false,
  grooveMethod: 'router-pocket',
  spoilboardAllowance: 0.5,
  throughDepth: 0.3,
  cutoutToolNumber: 101,
  contour: { approach: 'SEN', ramp: true, direction: 'climb-cw' },
  header: { OP: 1, FM: 1 },
  tools: [
    { id: 't101', number: 101, type: 'router', name: 'Compression cutter Z2 12 mm (cut-out)', diameter: 12, maxDepth: 42 },
    { id: 't102', number: 102, type: 'router', name: 'Spiral cutter 8 mm', diameter: 8, maxDepth: 30 },
    { id: 't103', number: 103, type: 'router', name: 'Spiral cutter 6 mm (grooves)', diameter: 6, maxDepth: 20 },
    { id: 't201', number: 201, type: 'drill-vertical', name: 'Dowel drill 5 mm', diameter: 5, maxDepth: 35 },
    { id: 't202', number: 202, type: 'drill-vertical', name: 'Dowel drill 7 mm', diameter: 7, maxDepth: 35 },
    { id: 't203', number: 203, type: 'drill-vertical', name: 'Dowel drill 8 mm', diameter: 8, maxDepth: 35 },
    { id: 't204', number: 204, type: 'drill-vertical', name: 'Hinge boring bit 35 mm', diameter: 35, maxDepth: 15 },
    { id: 't140', number: 140, type: 'saw', name: 'Grooving saw 4 mm kerf', diameter: 4, maxDepth: 15 },
  ],
}

export const DEFAULT_SETTINGS: ShopSettings = {
  shopName: 'Avi Weinreb Cabinets',
  nesting: { edgeTrim: 10, extraSpacing: 2, allowRotation: true, premill: 0 },
  labels: { size: '100x70', edgeClearance: 15 },
  outputFolder: '',
}

export function defaultLibrary(): Library {
  return {
    materials: clone(DEFAULT_MATERIALS),
    edgebands: clone(DEFAULT_EDGEBANDS),
    hardware: clone(DEFAULT_HARDWARE),
    templates: clone(BUILTIN_TEMPLATES),
  }
}

export function defaultAppData(): AppData {
  return {
    version: 1,
    library: defaultLibrary(),
    machine: clone(PLACEHOLDER_MACHINE),
    settings: clone(DEFAULT_SETTINGS),
    jobs: [],
  }
}
