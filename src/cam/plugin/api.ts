/**
 * The plugin API (M2.10, API-01), typed. This is the reference for plugin authors (the Plugins
 * screen offers it as `cabinet-studio-plugin.d.ts`); the code that implements it is
 * `prelude.ts` (inside the sandbox) and `host.ts` (the app's side). A test checks that every
 * name declared here exists in the sandbox.
 *
 * Lengths are millimetres. Plugins work on copies: change `ctx.part` in a menu command and the
 * designer takes the changed part back as one undo step, after checking it (`partEdit.ts`).
 * Nothing a plugin does writes machine programs or switches output on; programs only come from
 * the program writers, through the export checker.
 */
import type { Contour, P } from '../geom'
import type { CamOp, CamOpKind, CamPart, Entity, FaceId, Geom } from '../types'
import type { MenuArea } from './types'

export interface PluginMenuItem {
  id: string
  label: string
  /** 'part': the part designer's Plugins menu. 'job': the job page's Plugins menu. */
  area?: MenuArea
}

/** What a part menu command gets. Change `part`; return a message to show, if any. */
export interface PartMenuContext {
  part: CamPart
  /** Ids of the selected shapes. */
  selection: string[]
  units: 'mm' | 'in'
}

/** What a job menu command gets (read only). Return a message and/or a text file to save. */
export interface JobMenuContext {
  job: { number: string; name: string; customer: string }
  parts: { name: string; material: string; length: number; width: number; thickness: number; qty: number; custom: boolean }[]
  units: 'mm' | 'in'
}

export interface MenuResult {
  message?: string
  /** Offered to the owner to save (reports and lists; never a machine program). */
  file?: { name: string; data: string }
}

/** What a batch step sees for one order and one machine (a copy). */
export interface BatchView {
  order: { number: string; name: string; customer: string }
  machine: { id: string; name: string }
  parts: { no: number; partId: string; name: string; material: string; length: number; width: number; thickness: number; cabinet: string; custom: boolean; kit?: string; assembly?: string }[]
  sheets: { index: number; material: string; length: number; width: number; thickness: number; parts: number; utilization: number; offcut: boolean; flip: boolean }[]
  unplaced: number
  programs: { name: string; sheet: number; operations: number }[]
  /** Export-checker results. */
  issues: { severity: 'error' | 'warning' | 'info'; code: string; message: string }[]
  /** Before output only: the files about to be written. */
  files?: { name: string; bytes: number }[]
}

export interface BatchStepResult {
  /** An error holds the order back (report only). */
  messages?: { severity: 'error' | 'warning' | 'info'; text: string }[]
  /** Report files added to the order folder (not programs, no folders, new names). */
  files?: { name: string; data: string }[]
}

export interface PluginBatchStep {
  id: string
  name: string
  description?: string
  /** After nesting, before the export checker decides. */
  afterNest?(ctx: BatchView): BatchStepResult | void | Promise<BatchStepResult | void>
  /** Before the files are written. */
  beforeOutput?(ctx: BatchView & { files: { name: string; bytes: number }[] }): BatchStepResult | void | Promise<BatchStepResult | void>
}

/** What a script post receives (M2.10b): the same data as the built-in template post (`src/cam/post.ts`). */
export type { PostInput, PostMove, PostOp } from '../post'
import type { PostInput } from '../post'

export interface PluginPost {
  id: string
  name: string
  /** File extension, e.g. "nc". */
  ext?: string
  description?: string
  /** Turn the toolpaths into program text. */
  run(input: PostInput): string | Promise<string>
}

/** Tool data, read only (placeholder until the owner imports the real table). */
export type PluginTool = import('@/core/types').Tool & { placeholder: boolean }

export interface CabinetStudioApi {
  apiVersion: 1
  log(...args: unknown[]): void
  warn(...args: unknown[]): void
  menu: { add(item: PluginMenuItem, run: (ctx: PartMenuContext & JobMenuContext) => MenuResult | void | Promise<MenuResult | void>): void }
  batch: { step(def: PluginBatchStep): void }
  post: { add(def: PluginPost): void }
  part: {
    /** Shapes on a layer (by id or name), or all. */
    shapes(part: CamPart, layer?: string): Entity[]
    closed(e: Entity): boolean
    /** Add a shape made with `cs.geom`; returns its id. */
    addShape(part: CamPart, geom: Geom, layer?: string, face?: FaceId): string
    addEntity(part: CamPart, e: Entity): string
    setEntity(part: CamPart, id: string, patch: Partial<Entity>): void
    removeEntity(part: CamPart, id: string): void
    /** Add an operation of a kind with its default values (they keep their Configure badges); returns its id. */
    addOp(part: CamPart, kind: CamOpKind, geometry: string[], patch?: Partial<CamOp>): string
    addOpObject(part: CamPart, op: CamOp): string
    setOp(part: CamPart, id: string, patch: Partial<CamOp>): void
    removeOp(part: CamPart, id: string): void
    moveOp(part: CamPart, id: string, index: number): void
    set(part: CamPart, patch: Partial<CamPart>): void
    /** Make sure a layer exists; returns its id. */
    layer(part: CamPart, name: string, color?: string): string
  }
  geom: {
    rect(x: number, y: number, w: number, h: number): Geom
    roundedRect(x: number, y: number, w: number, h: number, r: number): Geom
    circle(x: number, y: number, r: number): Geom
    polyline(points: P[], closed?: boolean): Geom
    offset(contours: Contour | Contour[], d: number): Contour[]
    union(a: Contour | Contour[], b: Contour | Contour[]): Contour[]
    difference(a: Contour | Contour[], b: Contour | Contour[]): Contour[]
    intersection(a: Contour | Contour[], b: Contour | Contour[]): Contour[]
    area(c: Contour): number
    length(c: Contour): number
    box(contours: Contour | Contour[]): { minX: number; minY: number; maxX: number; maxY: number }
    /** The contours of a shape. */
    ofShape(e: Entity): Contour[]
  }
  ops: { kinds(): CamOpKind[]; defaults(kind: CamOpKind): CamOp }
  tools: { list(): PluginTool[] }
  units: { current(): 'mm' | 'in'; format(mm: number): string; parse(text: string): number | null }
  /** Needs a grant for the folder (@read / @write in the header, granted by the owner). */
  files: { read(path: string): Promise<string>; write(path: string, data: string): Promise<null>; list(folder: string): Promise<string[]> }
  /** https only; needs a grant for the host (@net in the header). */
  net: { fetch(url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }): Promise<string> }
}

/** Every name in the API, for the test that keeps this file and the sandbox in step. */
export const API_NAMES: Record<keyof CabinetStudioApi, string[] | null> = {
  apiVersion: null,
  log: null,
  warn: null,
  menu: ['add'],
  batch: ['step'],
  post: ['add'],
  part: ['shapes', 'closed', 'addShape', 'addEntity', 'setEntity', 'removeEntity', 'addOp', 'addOpObject', 'setOp', 'removeOp', 'moveOp', 'set', 'layer'],
  geom: ['rect', 'roundedRect', 'circle', 'polyline', 'offset', 'union', 'difference', 'intersection', 'area', 'length', 'box', 'ofShape'],
  ops: ['kinds', 'defaults'],
  tools: ['list'],
  units: ['current', 'format', 'parse'],
  files: ['read', 'write', 'list'],
  net: ['fetch'],
}
