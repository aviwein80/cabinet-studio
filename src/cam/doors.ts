/**
 * Parametric doors. A style is a set of named variables; each door is the style plus its own
 * width and height. The door lies with its height along X (the grain direction on grained
 * stock) and its front face up; hinge cups are drilled from face 6 in the turned-over program.
 *
 * Panel field geometry:
 *   shaker    rectangle inset by stiles and rails
 *   arched    top edge is one arc rising `rise` at the centre
 *   cathedral flat shoulders, then two tangent arcs (an S curve) up to the centre peak
 */
import { nanoid } from 'nanoid'
import { hingeCount } from '@/core/construction/carcass'
import { SALICE } from '@/core/hardware/specs'
import { parseLength } from '@/core/units'
import type { UnitSystem } from '@/core/types'
import { makeEntity, newPart } from './doc'
import { arc, type Contour, line, pt, rect, type Seg } from './geom'
import { defaultOp, fromTemplate } from './ops'
import { solve } from './solver'
import type { CamOp, CamPart, DoorKind, DoorStyle, Entity, Recipe, Variable } from './types'

export type HingeSide = 'left' | 'right' | 'none'
export type PullKind = 'none' | 'knob' | '96' | '128' | '160'

export interface DoorSpec {
  name: string
  styleId: string
  width: number
  height: number
  qty: number
  materialId: string | null
  thickness: number
  hinge: HingeSide
  pull: PullKind
  /** Wall doors get the pull near the bottom, base doors near the top, tall doors at 1000 mm. */
  pullAt: 'top' | 'bottom' | 'middle'
  /** Overrides of the style's variables (stile, rail, rise, ...). */
  values: Record<string, number>
  grain: 'length' | 'none'
}

export const DOOR_VARS: Record<string, { label: string; kinds: DoorKind[] }> = {
  stile: { label: 'Stile width', kinds: ['shaker', 'arched', 'cathedral'] },
  rail: { label: 'Rail width', kinds: ['shaker', 'arched', 'cathedral'] },
  recess: { label: 'Panel recess depth', kinds: ['shaker', 'arched', 'cathedral'] },
  rise: { label: 'Arch rise', kinds: ['arched', 'cathedral'] },
  shoulder: { label: 'Shoulder length', kinds: ['cathedral'] },
  hingeFromEnd: { label: 'Hinge from door end', kinds: ['slab', 'shaker', 'arched', 'cathedral'] },
  pullInset: { label: 'Pull from hinge-free edge', kinds: ['slab', 'shaker', 'arched', 'cathedral'] },
  pullFromEnd: { label: 'Pull from door end', kinds: ['slab', 'shaker', 'arched', 'cathedral'] },
}

const COMMON = { hingeFromEnd: 100, pullInset: 38, pullFromEnd: 64 }

export const BUILTIN_DOOR_STYLES: DoorStyle[] = [
  { id: 'ds-slab', name: 'Slab', kind: 'slab', defaults: { ...COMMON }, builtIn: true },
  { id: 'ds-shaker', name: 'Shaker 70', kind: 'shaker', defaults: { ...COMMON, stile: 70, rail: 70, recess: 6 }, builtIn: true },
  { id: 'ds-arched', name: 'Arched top', kind: 'arched', defaults: { ...COMMON, stile: 70, rail: 70, recess: 6, rise: 60 }, builtIn: true },
  { id: 'ds-cathedral', name: 'Cathedral', kind: 'cathedral', defaults: { ...COMMON, stile: 70, rail: 70, recess: 6, rise: 70, shoulder: 40 }, builtIn: true },
]

export const doorStylesOf = (lib: { doorStyles?: DoorStyle[] }) => [...BUILTIN_DOOR_STYLES, ...(lib.doorStyles ?? []).filter((s) => !BUILTIN_DOOR_STYLES.some((b) => b.id === s.id))]

/**
 * Cathedral S curve in field coordinates (u across the door, v up), from the shoulder end
 * (s, 0) rising to the peak (w/2, rise): a concave arc tangent to the shoulder, then a convex
 * arc tangent at the peak, the two touching. Radii in the ratio r2 = ratio x r1.
 */
export function solveCathedral(halfWidth: number, shoulder: number, rise: number, ratio = 1) {
  const run = halfWidth - shoulder
  const g = (run * run + rise * rise) / (4 * rise)
  const res = solve({
    points: [
      { id: 'S', x: shoulder, y: 0, fixed: true },
      { id: 'K', x: halfWidth, y: rise, fixed: true },
      { id: 'c1', x: shoulder, y: g },
      { id: 'c2', x: halfWidth, y: rise - g },
    ],
    scalars: { r1: g, r2: g * ratio },
    constraints: [
      { k: 'vertical', a: 'S', b: 'c1' },
      { k: 'vertical', a: 'K', b: 'c2' },
      { k: 'onCircle', p: 'S', c: 'c1', r: 'r1' },
      { k: 'onCircle', p: 'K', c: 'c2', r: 'r2' },
      { k: 'ratio', a: 'r2', b: 'r1', factor: ratio },
      { k: 'tangentCircles', c1: 'c1', r1: 'r1', c2: 'c2', r2: 'r2' },
    ],
  })
  const C1 = res.points.c1
  const C2 = res.points.c2
  const r1 = res.scalars.r1
  const r2 = res.scalars.r2
  const d = Math.hypot(C2.x - C1.x, C2.y - C1.y)
  const T = { x: C1.x + ((C2.x - C1.x) * r1) / d, y: C1.y + ((C2.y - C1.y) * r1) / d }
  return { r1, r2, C1, C2, T, ok: res.ok && C1.y > 0 && C2.y < rise, solver: res }
}

/** Field outline in door coordinates (x along the height, y across the width). */
export function fieldContour(kind: DoorKind, W: number, H: number, v: Record<string, number>): { contour: Contour | null; warnings: string[] } {
  const warnings: string[] = []
  if (kind === 'slab') return { contour: null, warnings }
  const stile = v.stile ?? 70
  const rail = v.rail ?? 70
  const y0 = stile
  const y1 = W - stile
  const x0 = rail
  const top = H - rail
  if (y1 - y0 < 20 || top - x0 < 20) {
    warnings.push('Stiles and rails leave no room for a panel field.')
    return { contour: null, warnings }
  }
  if (kind === 'shaker') return { contour: rect(x0, y0, top - x0, y1 - y0), warnings }
  const rise = Math.min(v.rise ?? 60, (top - x0) / 2)
  if (rise <= 0.5) return { contour: rect(x0, y0, top - x0, y1 - y0), warnings }
  const xs = top - rise
  // u across the door from the stile at y0, field-v up along +x
  const P = (u: number, vv: number) => pt(xs + vv, y0 + u)
  const half = (y1 - y0) / 2
  const segs: Seg[] = [line(pt(x0, y0), pt(xs, y0))]
  if (kind === 'arched') {
    // arc through (xs, y0), (top, centre), (xs, y1)
    const R = (half * half + rise * rise) / (2 * rise)
    const c = pt(top - R, y0 + half)
    segs.push(arc(pt(xs, y0), pt(top, y0 + half), c, true), arc(pt(top, y0 + half), pt(xs, y1), c, true))
  } else {
    const s = Math.min(Math.max(0, v.shoulder ?? 40), half - 1)
    const cat = solveCathedral(half, s, rise)
    if (!cat.ok) {
      warnings.push('Cathedral arch could not be solved for these sizes; using a plain arch.')
      return fieldContour('arched', W, H, v)
    }
    const { C1, C2, T } = cat
    const mirror = (p: { x: number; y: number }) => ({ x: 2 * half - p.x, y: p.y })
    if (s > 0.01) segs.push(line(P(0, 0), P(s, 0)))
    // (u, v) -> (x, y) swaps axes, so turning directions flip: concave arcs run clockwise here
    segs.push(arc(P(s, 0), P(T.x, T.y), P(C1.x, C1.y), false), arc(P(T.x, T.y), P(half, rise), P(C2.x, C2.y), true))
    const Tm = mirror(T)
    segs.push(arc(P(half, rise), P(Tm.x, Tm.y), P(2 * half - C2.x, C2.y), true), arc(P(Tm.x, Tm.y), P(2 * half - s, 0), P(2 * half - C1.x, C1.y), false))
    if (s > 0.01) segs.push(line(P(2 * half - s, 0), P(2 * half, 0)))
  }
  segs.push(line(pt(xs, y1), pt(x0, y1)), line(pt(x0, y1), pt(x0, y0)))
  return { contour: { segs, closed: true }, warnings }
}

/** Hinge cup centres (face 6 coordinates, x along the height) for a door. */
export function hingeCups(W: number, H: number, side: HingeSide, fromEnd: number) {
  if (side === 'none') return []
  const n = hingeCount(H)
  const y = side === 'left' ? W - SALICE.cupCentreFromEdge : SALICE.cupCentreFromEdge
  return Array.from({ length: n }, (_, i) => pt(Math.round((fromEnd + ((H - 2 * fromEnd) * i) / (n - 1)) * 1000) / 1000, y))
}

export function pullHoles(W: number, H: number, side: HingeSide, pull: PullKind, at: DoorSpec['pullAt'], inset: number, fromEnd: number) {
  if (pull === 'none') return []
  const y = side === 'right' ? W - inset : inset
  const centre = at === 'top' ? H - fromEnd : at === 'bottom' ? fromEnd : H / 2
  if (pull === 'knob') return [pt(centre, y)]
  const cc = Number(pull)
  const mid = at === 'top' ? centre - cc / 2 : at === 'bottom' ? centre + cc / 2 : centre
  return [pt(mid - cc / 2, y), pt(mid + cc / 2, y)]
}

export function buildDoor(spec: DoorSpec, style: DoorStyle, recipes: Recipe[] = []): { part: CamPart; warnings: string[] } {
  const v = { ...style.defaults, ...spec.values }
  const W = spec.width
  const H = spec.height
  const warnings: string[] = []
  const outline = makeEntity({ t: 'contour', c: rect(0, 0, H, W) }, 'outline', 1, { tag: 'door-outline' })
  const entities: Entity[] = [outline]
  const ops: CamOp[] = []
  const field = fieldContour(style.kind, W, H, v)
  warnings.push(...field.warnings)
  const mk = (kind: CamOp['kind'], ids: string[], extra: Partial<CamOp>, recipeId?: string) => {
    const rc = recipeId ? recipes.find((r) => r.id === recipeId) : undefined
    if (rc) for (const t of rc.ops) ops.push({ ...fromTemplate(t, ids), recipeId: rc.id })
    else ops.push(defaultOp(kind, ids, extra))
  }
  if (field.contour) {
    const f = makeEntity({ t: 'contour', c: field.contour }, 'machining', 1, { tag: 'door-field' })
    entities.push(f)
    mk('pocket', [f.id], { name: 'Panel field', levels: { safeZ: 20, rapidZ: 3, depth: v.recess ?? 6, through: false, stockZ: 0, passDepth: 0 } } as Partial<CamOp>, style.fieldRecipeId)
  }
  const cups = hingeCups(W, H, spec.hinge, v.hingeFromEnd ?? 100).map((c) => makeEntity({ t: 'circle', c, r: SALICE.cupDiameter / 2 }, 'holes', 6, { depth: SALICE.cupDepth, tag: 'hinge-cup' }))
  const pulls = pullHoles(W, H, spec.hinge, spec.pull, spec.pullAt, v.pullInset ?? 38, v.pullFromEnd ?? 64).map((c) => makeEntity({ t: 'circle', c, r: 2.5 }, 'holes', 1, { tag: 'pull' }))
  entities.push(...cups, ...pulls)
  if (cups.length) mk('drill', cups.map((e) => e.id), { name: `Hinge cups (Salice, ${cups.length})`, levels: { safeZ: 20, rapidZ: 3, depth: SALICE.cupDepth, through: false, stockZ: 0, passDepth: 0 } } as Partial<CamOp>)
  if (pulls.length) mk('drill', pulls.map((e) => e.id), { name: 'Pull holes', levels: { safeZ: 20, rapidZ: 3, depth: 0, through: true, stockZ: 0, passDepth: 0 } } as Partial<CamOp>)
  mk('profile', [outline.id], { name: 'Cut out door', side: 'outside', levels: { safeZ: 20, rapidZ: 3, depth: 0, through: true, stockZ: 0, passDepth: 0 } } as Partial<CamOp>, style.outlineRecipeId)
  if (spec.thickness - (v.recess ?? 0) < 6 && field.contour) warnings.push('Less than 6 mm left under the panel field.')
  if (cups.length && SALICE.cupDepth > spec.thickness - 3) warnings.push(`Hinge cups (${SALICE.cupDepth} mm) are too deep for ${spec.thickness} mm doors.`)

  const variables: Variable[] = [
    { name: 'W', value: W },
    { name: 'H', value: H },
    ...Object.entries(v)
      .filter(([k]) => DOOR_VARS[k]?.kinds.includes(style.kind))
      .map(([name, value]) => ({ name, value })),
  ]
  const part = newPart({
    id: nanoid(10),
    name: spec.name,
    length: H,
    width: W,
    thickness: spec.thickness,
    materialId: spec.materialId,
    grain: spec.grain,
    qty: Math.max(1, Math.round(spec.qty)),
    entities,
    ops,
    variables,
    outlineId: outline.id,
    door: { styleId: style.id, values: { ...spec.values, W, H } },
    notes: `${style.name} door ${W} x ${H}${spec.hinge !== 'none' ? `, hinged ${spec.hinge}` : ''}. Height runs along X; hinge cups are drilled after turning the door over.`,
    source: 'Door generator',
  })
  return { part, warnings }
}

/** Rebuild a generated door from its variables, keeping id, name, qty and material. */
export function rebuildDoor(part: CamPart, styles: DoorStyle[], recipes: Recipe[] = []): { part: CamPart; warnings: string[] } | null {
  if (!part.door) return null
  const style = styles.find((s) => s.id === part.door!.styleId)
  if (!style) return null
  const vars = Object.fromEntries(part.variables.map((x) => [x.name, x.value]))
  const W = vars.W ?? part.width
  const H = vars.H ?? part.length
  const values: Record<string, number> = {}
  for (const [k, val] of Object.entries(vars)) if (k !== 'W' && k !== 'H') values[k] = val
  const hingeCup = part.entities.find((e) => e.tag === 'hinge-cup')
  const hinge: HingeSide = !hingeCup ? 'none' : hingeCup.g.t === 'circle' && hingeCup.g.c.y > part.width / 2 ? 'left' : 'right'
  const pullsE = part.entities.filter((e) => e.tag === 'pull')
  const pull: PullKind = pullsE.length === 0 ? 'none' : pullsE.length === 1 ? 'knob' : (String(Math.round(Math.abs((pullsE[1].g as { c: { x: number } }).c.x - (pullsE[0].g as { c: { x: number } }).c.x))) as PullKind)
  const px = pullsE.length ? pullsE.reduce((n, e) => n + (e.g as { c: { x: number } }).c.x, 0) / pullsE.length : 0
  const pullAt: DoorSpec['pullAt'] = px > part.length * 0.6 ? 'top' : px < part.length * 0.4 ? 'bottom' : 'middle'
  const built = buildDoor({ name: part.name, styleId: style.id, width: W, height: H, qty: part.qty, materialId: part.materialId, thickness: part.thickness, hinge, pull: ['none', 'knob', '96', '128', '160'].includes(pull) ? pull : '128', pullAt, values, grain: part.grain }, style, recipes)
  return { part: { ...built.part, id: part.id, updatedAt: new Date().toISOString() }, warnings: built.warnings }
}

// ---------------------------------------------------------------------------------------------
// Door lists from CSV
// ---------------------------------------------------------------------------------------------

export interface DoorCsvResult {
  specs: DoorSpec[]
  errors: { row: number; message: string }[]
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6

function splitCsv(line: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') q = false
      else cur += ch
    } else if (ch === '"') q = true
    else if (ch === sep) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}

const HEAD: Record<string, string> = {
  name: 'name', part: 'name', door: 'name', label: 'name',
  qty: 'qty', quantity: 'qty', count: 'qty',
  w: 'width', width: 'width',
  h: 'height', height: 'height',
  style: 'style', type: 'style',
  material: 'material', mat: 'material',
  hinge: 'hinge', hinges: 'hinge', hand: 'hinge',
  pull: 'pull', handle: 'pull',
  pullat: 'pullAt', 'pull at': 'pullAt', position: 'pullAt',
  thickness: 'thickness', t: 'thickness',
}

/**
 * Door list CSV. Headers (any order, case-insensitive): name, qty, width, height, style,
 * material, hinge (left/right/none), pull (none/knob/96/128/160), pull at (top/bottom/middle),
 * plus any style variable (stile, rail, rise, shoulder, recess). Lengths are in the shop's
 * units and accept fractions in inch mode (15 1/2).
 */
export function parseDoorCsv(text: string, ctx: { units: UnitSystem; styles: DoorStyle[]; materials: { id: string; code: string; name: string; thickness: number; grain: boolean }[]; defaultStyleId?: string; defaultMaterialId?: string | null }): DoorCsvResult {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim())
  const errors: DoorCsvResult['errors'] = []
  if (!lines.length) return { specs: [], errors: [{ row: 0, message: 'The file is empty.' }] }
  const sep = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ';' : lines[0].includes('\t') ? '\t' : ','
  const head = splitCsv(lines[0], sep).map((h) => h.toLowerCase().trim())
  const cols = head.map((h) => HEAD[h] ?? (DOOR_VARS[h] ? `var:${h}` : `ignore:${h}`))
  if (!cols.includes('width') || !cols.includes('height')) return { specs: [], errors: [{ row: 1, message: 'Need width and height columns.' }] }
  const specs: DoorSpec[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsv(lines[i], sep)
    const row: Record<string, string> = {}
    cols.forEach((c, k) => (row[c] = cells[k] ?? ''))
    const rowNo = i + 1
    const len = (s: string, what: string) => {
      const n = parseLength(s, ctx.units)
      if (n === null || !(n > 0)) {
        errors.push({ row: rowNo, message: `${what} "${s}" is not a length.` })
        return null
      }
      return r6(n)
    }
    const W = len(row.width, 'Width')
    const H = len(row.height, 'Height')
    if (W === null || H === null) continue
    const styleKey = (row.style || '').toLowerCase()
    const style = styleKey ? ctx.styles.find((s) => s.id.toLowerCase() === styleKey || s.name.toLowerCase() === styleKey || s.kind === styleKey) : ctx.styles.find((s) => s.id === ctx.defaultStyleId) ?? ctx.styles[0]
    if (!style) {
      errors.push({ row: rowNo, message: `Unknown door style "${row.style}".` })
      continue
    }
    const matKey = (row.material || '').toLowerCase()
    const mat = matKey ? ctx.materials.find((m) => m.code.toLowerCase() === matKey || m.id.toLowerCase() === matKey || m.name.toLowerCase() === matKey) : ctx.materials.find((m) => m.id === ctx.defaultMaterialId)
    if (matKey && !mat) errors.push({ row: rowNo, message: `Material "${row.material}" is not in the library; choose it later.` })
    const hinge = ((row.hinge || 'left').toLowerCase().startsWith('r') ? 'right' : (row.hinge || 'left').toLowerCase().startsWith('n') || row.hinge === '0' ? 'none' : 'left') as HingeSide
    const pullRaw = (row.pull || 'none').toLowerCase().replace(/\s*mm$/, '')
    const pull = (['none', 'knob', '96', '128', '160'].includes(pullRaw) ? pullRaw : 'none') as PullKind
    if (row.pull && pull === 'none' && pullRaw !== 'none') errors.push({ row: rowNo, message: `Pull "${row.pull}" is not one of none, knob, 96, 128, 160; left off.` })
    const pullAt = ((row.pullAt || 'top').toLowerCase().startsWith('b') ? 'bottom' : (row.pullAt || '').toLowerCase().startsWith('m') ? 'middle' : 'top') as DoorSpec['pullAt']
    const values: Record<string, number> = {}
    for (const c of cols)
      if (c.startsWith('var:') && row[c]) {
        const n = parseLength(row[c], ctx.units)
        if (n === null) errors.push({ row: rowNo, message: `${c.slice(4)} "${row[c]}" is not a length.` })
        else values[c.slice(4)] = r6(n)
      }
    const qty = row.qty ? Math.round(Number(row.qty)) : 1
    if (!(qty >= 1)) errors.push({ row: rowNo, message: `Quantity "${row.qty}" is not a whole number; using 1.` })
    const thickness = row.thickness ? (parseLength(row.thickness, ctx.units) ?? mat?.thickness ?? 19) : (mat?.thickness ?? 19)
    specs.push({
      name: row.name || `Door ${specs.length + 1}`,
      styleId: style.id,
      width: W,
      height: H,
      qty: qty >= 1 ? qty : 1,
      materialId: mat?.id ?? null,
      thickness,
      hinge,
      pull,
      pullAt,
      values,
      grain: mat?.grain ? 'length' : 'none',
    })
  }
  return { specs, errors }
}
