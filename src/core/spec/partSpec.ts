/**
 * Custom pieces from a customer's spec or drawing (a sliding door, a shaped panel): the reader
 * drafts a PartSpec, every value citing the page it came from, and partFromSpec turns it into an
 * editable custom part with its operations. Blank values block approval; a draft part cannot be
 * saved, added to a job or nested until a named person ticks that they checked it.
 *
 * Frame: x runs along the part's length (the grain, or the longer side), y along its width,
 * origin at the bottom-left corner as drawn. Edges: bottom (y = 0), right (x = L), top (y = W),
 * left (x = 0). Depths are millimetres down from the face they are on.
 */
import { nanoid } from 'nanoid'
import { makeEntity, newPart } from '@/cam/doc'
import { arc3, circle, type Contour, line, polyline, pt, rect, roundedRect, type Seg } from '@/cam/geom'
import { defaultOp } from '@/cam/ops'
import type { CamOp, CamPart, Entity, FaceId, HardwarePattern } from '@/cam/types'
import type { Library, MachineProfile, Material } from '../types'
import { type AiProviderId, type AiTransport, type PageImage, providerInfo } from '../hardware/aiProviders'
import type { TextPage } from '../hardware/patternImport'
import { placePattern, type RefEdge, type Review, usablePatterns } from '../hardware/patterns'
export { draftBlock, isDraftPart } from './draft'
import { blank, CITE_RULES, type Cite, citeOf, cnum, type CNum, ctext, hasText, known, modelJson, strings } from './cite'

export type SpecEdge = RefEdge
export type SpecFace = 'top' | 'underside' | 'edge'

export interface SpecGroove {
  label: string
  face: SpecFace
  /** For edge grooves: which edge. */
  edge?: SpecEdge
  /** Centre line from (x0, y0) to (x1, y1). Edge grooves: along the edge from x0 to x1, y0 = centre below the top face. */
  x0: CNum
  y0: CNum
  x1: CNum
  y1: CNum
  width: CNum
  depth: CNum
  cite?: Cite
}

export interface SpecHole {
  face: 'top' | 'underside'
  x: CNum
  y: CNum
  diameter: CNum
  depth: CNum
  through: boolean
}

export interface SpecCutout {
  label: string
  shape: 'rect' | 'circle'
  /** Centre. */
  x: CNum
  y: CNum
  /** Rectangles: size and corner radius. Circles: diameter in `w`. */
  w: CNum
  h: CNum
  r: CNum
  depth: CNum
  through: boolean
}

export interface SpecHardware {
  name: string
  code: string
  edge: SpecEdge
  /** Insertion points along the edge (one per fitting). */
  at: CNum[]
  mirror: boolean
  cite?: Cite
}

export interface PartSpec {
  name: string
  material: { text: string; materialId: string | null; cite?: Cite }
  qty: CNum
  length: CNum
  width: CNum
  thickness: CNum
  outline: { shape: 'rect' | 'rounded' | 'arch' | 'polygon'; radius: CNum; rise: CNum; points: { x: CNum; y: CNum }[]; cite?: Cite }
  edges: { edge: SpecEdge; profile: string; cite?: Cite }[]
  grooves: SpecGroove[]
  holes: SpecHole[]
  cutouts: SpecCutout[]
  hardware: SpecHardware[]
  notes: string
  warnings: string[]
  /** Who drafted it and from what. */
  file: string
  drafter: string
}

export const EDGES: SpecEdge[] = ['bottom', 'right', 'top', 'left']

export function blankSpec(file: string, drafter: string): PartSpec {
  return {
    name: file.replace(/\.[^.]+$/, ''),
    material: { text: '', materialId: null },
    qty: blank(),
    length: blank(),
    width: blank(),
    thickness: blank(),
    outline: { shape: 'rect', radius: blank(), rise: blank(), points: [] },
    edges: [],
    grooves: [],
    holes: [],
    cutouts: [],
    hardware: [],
    notes: '',
    warnings: [],
    file,
    drafter,
  }
}

export const PART_PROMPT = `You read a customer's specification or drawing for one custom cabinet piece (for example a sliding door, a shaped panel or a shelf) and draft it for a CNC router.

Return ONLY a JSON object, no prose:
{"name": string, "material": V, "quantity": V, "length": V, "width": V, "thickness": V,
 "outline": {"shape": "rect"|"rounded"|"arch"|"polygon", "radius": V, "rise": V, "points": [{"x": V, "y": V}]},
 "edges": [{"edge": "bottom"|"right"|"top"|"left", "profile": V}],
 "grooves": [{"label": string, "face": "top"|"underside"|"edge", "edge": "bottom"|"right"|"top"|"left"|null,
              "x0": V, "y0": V, "x1": V, "y1": V, "width": V, "depth": V}],
 "holes": [{"face": "top"|"underside", "x": V, "y": V, "diameter": V, "depth": V, "through": boolean}],
 "cutouts": [{"label": string, "shape": "rect"|"circle", "x": V, "y": V, "w": V, "h": V, "r": V, "depth": V, "through": boolean}],
 "hardware": [{"name": string, "code": V, "edge": "bottom"|"right"|"top"|"left", "at": [V], "mirror": boolean}],
 "notes": string, "warnings": [string]}

Frame: x runs along the length (the grain direction if shown, otherwise the longer side), y along the width; origin at the bottom-left corner as drawn. Edges: bottom is y = 0, right is x = length, top is y = width, left is x = 0.
- outline: "rounded" uses radius for all four corners; "arch" raises the top edge by "rise" in the middle; "polygon" lists the corner points.
- edges: the edge treatment printed for each edge (edge band, round-over R3, chamfer, square). Only edges the drawing mentions.
- grooves and dados: centre line from (x0, y0) to (x1, y1) on that face. For grooves in an edge, set face "edge", say which edge, give x0 and x1 along that edge and y0 as the groove centre below the top face.
- holes and cutouts: centre point. Circles use w for the diameter. Recesses that do not go through have a depth.
- hardware: fittings that are bored into this piece (hangers, rollers, handles, hinges, locks), with the part number printed and where along which edge each one sits.

${CITE_RULES}
- Do not invent features that are not drawn or written. Put anything unclear in warnings.`

const EDGE_SET = new Set<string>(EDGES)
const asEdge = (v: unknown, d: SpecEdge = 'bottom'): SpecEdge => (EDGE_SET.has(String(v)) ? (v as SpecEdge) : d)
const list = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]).filter((x) => x && typeof x === 'object') : [])

export function matchMaterial(materials: Material[], text: string, thickness: number): Material | undefined {
  const t = text.toLowerCase()
  if (!t.trim()) return undefined
  const byCode = materials.find((m) => t.includes(m.code.toLowerCase()))
  if (byCode) return byCode
  const words = t.split(/[^a-z0-9]+/).filter((w) => w.length >= 3)
  const scored = materials
    .map((m) => ({ m, s: words.filter((w) => m.name.toLowerCase().includes(w) || m.code.toLowerCase().includes(w)).length + (Number.isFinite(thickness) && Math.abs(m.thickness - thickness) < 0.01 ? 1 : 0) }))
    .filter((x) => x.s >= 2)
    .sort((a, b) => b.s - a.s)
  return scored[0]?.m
}

/** The model's JSON as a PartSpec. Nulls stay blank; every value keeps its citation. */
export function partSpecFromModel(text: string, file: string, pages: TextPage[], label: string, lib: Library): PartSpec {
  const j = modelJson(text, label)
  const s = blankSpec(file, label)
  if (typeof j.name === 'string' && j.name.trim()) s.name = j.name.trim()
  for (const k of ['length', 'width', 'thickness'] as const) s[k] = cnum(j[k], pages)
  s.qty = cnum(j.quantity ?? j.qty, pages)
  const mat = ctext(j.material, pages)
  s.material = { text: mat.v, materialId: matchMaterial(lib.materials, mat.v, s.thickness.v)?.id ?? null, ...(mat.cite ? { cite: mat.cite } : {}) }
  const o = j.outline && typeof j.outline === 'object' ? (j.outline as Record<string, unknown>) : {}
  const shape = ['rect', 'rounded', 'arch', 'polygon'].includes(String(o.shape)) ? (o.shape as PartSpec['outline']['shape']) : 'rect'
  s.outline = { shape, radius: cnum(o.radius, pages), rise: cnum(o.rise, pages), points: list(o.points).map((p) => ({ x: cnum(p.x, pages), y: cnum(p.y, pages) })), ...(citeOf(o, pages) ? { cite: citeOf(o, pages) } : {}) }
  s.edges = list(j.edges).map((e) => {
    const p = ctext(e.profile, pages)
    return { edge: asEdge(e.edge), profile: p.v, ...(p.cite ? { cite: p.cite } : {}) }
  })
  s.grooves = list(j.grooves).map((g, i) => {
    const face: SpecFace = g.face === 'underside' ? 'underside' : g.face === 'edge' ? 'edge' : 'top'
    const cite = citeOf(g, pages)
    return {
      label: typeof g.label === 'string' && g.label.trim() ? g.label.trim() : `Groove ${i + 1}`,
      face,
      ...(face === 'edge' ? { edge: asEdge(g.edge) } : {}),
      x0: cnum(g.x0, pages, cite),
      y0: cnum(g.y0, pages, cite),
      x1: cnum(g.x1, pages, cite),
      y1: face === 'edge' ? blank() : cnum(g.y1, pages, cite),
      width: cnum(g.width, pages, cite),
      depth: cnum(g.depth, pages, cite),
      ...(cite ? { cite } : {}),
    }
  })
  s.holes = list(j.holes).map((h) => {
    const cite = citeOf(h, pages)
    return { face: h.face === 'underside' ? 'underside' : 'top', x: cnum(h.x, pages, cite), y: cnum(h.y, pages, cite), diameter: cnum(h.diameter, pages, cite), depth: h.through === true ? blank() : cnum(h.depth, pages, cite), through: h.through === true }
  })
  s.cutouts = list(j.cutouts).map((c, i) => {
    const cite = citeOf(c, pages)
    return {
      label: typeof c.label === 'string' && c.label.trim() ? c.label.trim() : `Cut-out ${i + 1}`,
      shape: c.shape === 'circle' ? 'circle' : 'rect',
      x: cnum(c.x, pages, cite),
      y: cnum(c.y, pages, cite),
      w: cnum(c.w ?? c.diameter, pages, cite),
      h: cnum(c.h, pages, cite),
      r: cnum(c.r, pages, cite),
      depth: c.through === true ? blank() : cnum(c.depth, pages, cite),
      through: c.through === true,
    }
  })
  s.hardware = list(j.hardware).map((h) => {
    const code = ctext(h.code, pages)
    const cite = code.cite ?? citeOf(h, pages)
    return { name: typeof h.name === 'string' ? h.name.trim() : '', code: code.v, edge: asEdge(h.edge), at: (Array.isArray(h.at) ? h.at : [h.at]).map((a) => cnum(a, pages, cite)), mirror: h.mirror === true, ...(cite ? { cite } : {}) }
  })
  s.notes = typeof j.notes === 'string' ? j.notes : ''
  s.warnings = strings(j.warnings)
  const all = specValues(s)
  const unverified = all.filter((x) => x.c.cite?.unverified).length
  if (unverified) s.warnings.push(`${unverified} value(s) quote text that is not in the PDF's text layer (they may come from the drawing). Check those against the page.`)
  if (!hasText(pages)) s.warnings.push('This source has no text layer (a scan or a photo), so no quote could be checked automatically. Compare every value with the page.')
  if (all.some((x) => !Number.isFinite(x.c.v))) s.warnings.push('Some values were not given in the source; fill them in before approving.')
  return s
}

/** Every number in the spec with a label, for review lists and checks. */
export function specValues(s: PartSpec): { label: string; c: CNum; optional?: boolean }[] {
  const out: { label: string; c: CNum; optional?: boolean }[] = [
    { label: 'Length', c: s.length },
    { label: 'Width', c: s.width },
    { label: 'Thickness', c: s.thickness },
    { label: 'Quantity', c: s.qty },
  ]
  if (s.outline.shape === 'rounded') out.push({ label: 'Corner radius', c: s.outline.radius })
  if (s.outline.shape === 'arch') out.push({ label: 'Arch rise', c: s.outline.rise })
  if (s.outline.shape === 'polygon') s.outline.points.forEach((p, i) => out.push({ label: `Corner ${i + 1} x`, c: p.x }, { label: `Corner ${i + 1} y`, c: p.y }))
  for (const g of s.grooves) {
    out.push({ label: `${g.label} start`, c: g.x0 }, { label: `${g.label} ${g.face === 'edge' ? 'centre below top' : 'start y'}`, c: g.y0 }, { label: `${g.label} end`, c: g.x1 })
    if (g.face !== 'edge') out.push({ label: `${g.label} end y`, c: g.y1 })
    out.push({ label: `${g.label} width`, c: g.width }, { label: `${g.label} depth`, c: g.depth })
  }
  s.holes.forEach((h, i) => {
    out.push({ label: `Hole ${i + 1} x`, c: h.x }, { label: `Hole ${i + 1} y`, c: h.y }, { label: `Hole ${i + 1} diameter`, c: h.diameter })
    if (!h.through) out.push({ label: `Hole ${i + 1} depth`, c: h.depth })
  })
  for (const c of s.cutouts) {
    out.push({ label: `${c.label} x`, c: c.x }, { label: `${c.label} y`, c: c.y }, { label: `${c.label} ${c.shape === 'circle' ? 'diameter' : 'width'}`, c: c.w })
    if (c.shape === 'rect') out.push({ label: `${c.label} height`, c: c.h }, { label: `${c.label} corner radius`, c: c.r, optional: true })
    if (!c.through) out.push({ label: `${c.label} depth`, c: c.depth })
  }
  for (const h of s.hardware) h.at.forEach((a, i) => out.push({ label: `${h.name || h.code} position ${i + 1}`, c: a }))
  return out
}

const fin = (c: CNum) => Number.isFinite(c.v)

/** Usable library pattern for a fitting: by part number, then by name. */
export function matchPattern(lib: Library, h: { name: string; code: string }): HardwarePattern | undefined {
  const pats = usablePatterns(lib)
  const code = h.code.trim().toLowerCase()
  if (code) {
    const row = lib.hardware.find((x) => x.code.trim().toLowerCase() === code)
    const byRow = row && [...pats].reverse().find((p) => p.hardwareId === row.id)
    if (byRow) return byRow
    const byNote = pats.find((p) => (p.notes ?? '').toLowerCase().includes(`part ${code}`) || p.name.toLowerCase().includes(code))
    if (byNote) return byNote
  }
  const name = h.name.trim().toLowerCase()
  return name.length >= 4 ? pats.find((p) => p.name.toLowerCase() === name) : undefined
}

/** Missing values and impossible geometry. Any of these blocks approval. */
export function specIssues(s: PartSpec, lib: Library): string[] {
  const out: string[] = []
  for (const x of specValues(s)) if (!x.optional && !fin(x.c)) out.push(`${x.label} is blank.`)
  const L = s.length.v
  const W = s.width.v
  const T = s.thickness.v
  if (!s.name.trim()) out.push('Give the part a name.')
  for (const [k, v] of [['Length', L], ['Width', W], ['Thickness', T]] as const) if (Number.isFinite(v) && v <= 0) out.push(`${k} must be more than 0.`)
  if (fin(s.qty) && (s.qty.v < 1 || !Number.isInteger(s.qty.v))) out.push('Quantity must be a whole number, 1 or more.')
  if (s.outline.shape === 'polygon' && s.outline.points.length < 3) out.push('A polygon outline needs at least three corners.')
  if (s.outline.shape === 'arch' && fin(s.outline.rise) && Number.isFinite(W) && (s.outline.rise.v <= 0 || s.outline.rise.v >= W)) out.push('The arch rise must be between 0 and the width.')
  const inside = (x: number, y: number, r = 0) => !(Number.isFinite(L) && Number.isFinite(W)) || (x - r >= -1e-6 && y - r >= -1e-6 && x + r <= L + 1e-6 && y + r <= W + 1e-6)
  s.holes.forEach((h, i) => {
    if ([h.x, h.y, h.diameter].every(fin) && !inside(h.x.v, h.y.v, h.diameter.v / 2)) out.push(`Hole ${i + 1} runs off the part.`)
    if (fin(h.depth) && Number.isFinite(T) && h.depth.v > T + 1e-6) out.push(`Hole ${i + 1} is deeper than the part; tick “through” instead.`)
  })
  for (const g of s.grooves) {
    if (fin(g.depth) && Number.isFinite(T) && g.depth.v >= T) out.push(`${g.label} is as deep as the part.`)
    if (fin(g.width) && g.width.v <= 0) out.push(`${g.label} needs a width.`)
  }
  for (const c of s.cutouts) {
    if (fin(c.depth) && Number.isFinite(T) && c.depth.v >= T) out.push(`${c.label}: tick “through” instead of a depth as deep as the part.`)
    if ([c.x, c.y, c.w].every(fin) && !inside(c.x.v, c.y.v, c.shape === 'circle' ? c.w.v / 2 : 0)) out.push(`${c.label} runs off the part.`)
  }
  for (const h of s.hardware) if (!matchPattern(lib, h)) out.push(`${h.name || h.code || 'Fitting'}: no approved drilling pattern in the library. Draft it from the hardware sheet first, or remove it here.`)
  return out
}

function archOutline(L: number, W: number, rise: number): Contour {
  const segs: Seg[] = [line(pt(0, 0), pt(L, 0)), line(pt(L, 0), pt(L, W - rise)), arc3(pt(L, W - rise), pt(L / 2, W), pt(0, W - rise)), line(pt(0, W - rise), pt(0, 0))]
  return { segs, closed: true }
}

/** Rectangle around a groove's centre line; ends at the part edge run 10 mm past it so the cutter clears out. */
function grooveContour(x0: number, y0: number, x1: number, y1: number, w: number, L: number, W: number): Contour {
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const atEdge = (x: number, y: number) => x <= 0.5 || y <= 0.5 || x >= L - 0.5 || y >= W - 0.5
  const e0 = atEdge(x0, y0) ? 10 : 0
  const e1 = atEdge(x1, y1) ? 10 : 0
  const a = pt(x0 - ux * e0, y0 - uy * e0)
  const b = pt(x1 + ux * e1, y1 + uy * e1)
  const nx = -uy * (w / 2)
  const ny = ux * (w / 2)
  return polyline([pt(a.x + nx, a.y + ny), pt(b.x + nx, b.y + ny), pt(b.x - nx, b.y - ny), pt(a.x - nx, a.y - ny)], true)
}

const r3 = (n: number) => Math.round(n * 1000) / 1000
const levels = (depth: number, through: boolean) => ({ safeZ: 20, rapidZ: 3, depth: r3(depth), through, stockZ: 0, passDepth: 0 })

/**
 * Build the custom part from a spec. Blank values are skipped (the draft preview shows what is
 * known); approval needs them all. Returns warnings for things the part cannot carry yet.
 */
export function partFromSpec(s: PartSpec, lib: Library, machine?: MachineProfile): { part: CamPart; warnings: string[] } {
  const warnings: string[] = []
  const L = fin(s.length) ? s.length.v : 600
  const W = fin(s.width) ? s.width.v : 400
  const T = fin(s.thickness) ? s.thickness.v : 19
  const material = s.material.materialId ? lib.materials.find((m) => m.id === s.material.materialId) : undefined
  const part = newPart({ name: s.name.trim() || 'Drafted part', length: L, width: W, thickness: T, qty: fin(s.qty) ? Math.max(1, Math.round(s.qty.v)) : 1, materialId: material?.id ?? null, grain: material?.grain ? 'length' : 'none', entities: [] })
  if (!material) warnings.push(s.material.text ? `No library material matches “${s.material.text}”; pick one before nesting.` : 'No material given; pick one before nesting.')
  else if (Number.isFinite(T) && Math.abs(material.thickness - T) > 0.01) warnings.push(`${material.code} is ${material.thickness} mm but the part is ${T} mm.`)

  const shape = s.outline.shape
  let outline: Contour = rect(0, 0, L, W)
  if (shape === 'rounded' && fin(s.outline.radius)) outline = roundedRect(0, 0, L, W, s.outline.radius.v)
  else if (shape === 'arch' && fin(s.outline.rise) && s.outline.rise.v > 0 && s.outline.rise.v < W) outline = archOutline(L, W, s.outline.rise.v)
  else if (shape === 'polygon') {
    const pts = s.outline.points.filter((p) => fin(p.x) && fin(p.y)).map((p) => pt(p.x.v, p.y.v))
    if (pts.length >= 3) outline = polyline(pts, true)
  }
  const out = makeEntity({ t: 'contour', c: outline }, 'outline', 1, { tag: 'spec:outline' })
  const entities: Entity[] = [out]
  const ops: CamOp[] = []

  const under: Entity[] = []
  for (const g of s.grooves) {
    if (![g.x0, g.y0, g.x1, g.width, g.depth].every(fin) || (g.face !== 'edge' && !fin(g.y1))) continue
    if (g.face === 'edge') {
      warnings.push(`${g.label} is in the ${g.edge} edge. Edge grooves need a saw or an aggregate head; it is in the notes, not machined here.`)
      continue
    }
    const face: FaceId = g.face === 'underside' ? 6 : 1
    const bit = g.face === 'top' ? machine?.tools.find((t) => t.type === 'router' && (t.shape ?? 'flat') === 'flat' && Math.abs(t.diameter - g.width.v) < 0.01) : undefined
    if (bit) {
      const ends = grooveContour(g.x0.v, g.y0.v, g.x1.v, g.y1.v, 0, L, W).segs
      const e = makeEntity({ t: 'contour', c: polyline([ends[0].a, ends[0].b], false) }, 'machining', 1, { depth: g.depth.v, tag: `spec:groove:${g.label}` })
      entities.push(e)
      ops.push({ ...defaultOp('profile', [e.id]), name: g.label, side: 'centre', toolId: bit.id, note: `${g.width.v} mm groove cut in one pass with T${bit.number}`, levels: levels(g.depth.v, false) } as CamOp)
      continue
    }
    const e = makeEntity({ t: 'contour', c: grooveContour(g.x0.v, g.y0.v, g.x1.v, g.y1.v, g.width.v, L, W) }, 'machining', face, { depth: g.depth.v, tag: `spec:groove:${g.label}` })
    entities.push(e)
    if (face === 6) under.push(e)
    else ops.push({ ...defaultOp('pocket', [e.id]), name: g.label, levels: levels(g.depth.v, false) } as CamOp)
  }
  for (const c of s.cutouts) {
    if (![c.x, c.y, c.w].every(fin) || (c.shape === 'rect' && !fin(c.h)) || (!c.through && !fin(c.depth))) continue
    const contour = c.shape === 'circle' ? circle(pt(c.x.v, c.y.v), c.w.v / 2) : roundedRect(c.x.v - c.w.v / 2, c.y.v - c.h.v / 2, c.w.v, c.h.v, fin(c.r) ? c.r.v : 0)
    const e = makeEntity({ t: 'contour', c: contour }, 'machining', 1, { tag: `spec:cutout:${c.label}` })
    entities.push(e)
    ops.push(c.through ? ({ ...defaultOp('profile', [e.id]), name: c.label, side: 'inside', levels: levels(T, true) } as CamOp) : ({ ...defaultOp('pocket', [e.id]), name: c.label, levels: levels(c.depth.v, false) } as CamOp))
  }
  const holes: Entity[] = []
  for (const h of s.holes) {
    if (![h.x, h.y, h.diameter].every(fin) || (!h.through && !fin(h.depth))) continue
    const depth = h.through ? T : Math.min(h.depth.v, T)
    holes.push(makeEntity({ t: 'circle', c: pt(h.x.v, h.y.v), r: h.diameter.v / 2 }, 'holes', h.face === 'underside' ? 6 : 1, { depth, tag: 'spec:hole' }))
  }
  entities.push(...holes)
  let p: CamPart = { ...part, entities, outlineId: out.id }
  const fitted: string[] = []
  for (const h of s.hardware) {
    const pat = matchPattern(lib, h)
    if (!pat) continue
    for (const a of h.at) {
      if (!fin(a)) continue
      const r = placePattern(p, pat, { edge: h.edge, at: a.v, mirror: h.mirror })
      p = r.part
      fitted.push(...r.ids)
      for (const w of r.warnings) warnings.push(`${h.name || h.code} at ${a.v}: ${w}`)
    }
  }
  const drill = [...holes.map((e) => e.id), ...fitted]
  if (drill.length) ops.unshift({ ...defaultOp('drill', drill), name: 'Holes and hardware', levels: levels(13, false) } as CamOp)
  if (under.length) {
    ops.push(...under.map((e) => ({ ...defaultOp('pocket', [e.id]), name: `${e.tag?.slice(12) ?? 'Groove'} (underside)`, face: 6 as FaceId, levels: levels(e.depth ?? 0, false) }) as CamOp))
    warnings.push(`${under.length} groove(s) are on the underside. Underside milling is not generated; machine them in a turned-over setup.`)
  }
  ops.push({ ...defaultOp('profile', [out.id]), name: 'Cut out', side: 'outside', levels: levels(T, true) } as CamOp)

  const edgeNotes = s.edges.filter((e) => e.profile).map((e) => `${e.edge}: ${e.profile}`)
  const shaped = s.edges.filter((e) => e.profile && !/^(square|none|plain|edge ?band|banded|pvc|abs|veneer)/i.test(e.profile) && !/\bband/i.test(e.profile))
  if (shaped.length) warnings.push(`Edge profiles (${shaped.map((e) => `${e.edge} ${e.profile}`).join(', ')}) are noted, not machined. Add the router op in the designer.`)
  const edgeGrooves = s.grooves.filter((g) => g.face === 'edge').map((g) => `${g.label} in the ${g.edge} edge: ${[g.width, g.depth].map((c) => (fin(c) ? c.v : '?')).join(' wide × ')} deep, from ${fin(g.x0) ? g.x0.v : '?'} to ${fin(g.x1) ? g.x1.v : '?'}`)
  p = {
    ...p,
    ops,
    source: `Drafted from ${s.file}`,
    notes: [s.notes, edgeNotes.length ? `Edges: ${edgeNotes.join('; ')}` : '', ...edgeGrooves, s.material.text ? `Material on the drawing: ${s.material.text}` : ''].filter(Boolean).join('\n'),
    review: { status: 'draft', file: s.file, drafter: s.drafter },
  }
  return { part: p, warnings }
}

/** Approve a reviewed spec: the finished part, marked approved by the reviewer. */
export function approvePartSpec(s: PartSpec, lib: Library, review: Review, now: Date, machine?: MachineProfile): { errors: string[]; part?: CamPart; warnings: string[] } {
  const errors = specIssues(s, lib)
  if (!review.reviewer.trim()) errors.push('Enter the name of the person who checked it.')
  if (!review.checked) errors.push('Confirm every value was checked against the source.')
  if (errors.length) return { errors, warnings: [] }
  const { part, warnings } = partFromSpec(s, lib, machine)
  return { errors: [], warnings, part: { ...part, id: nanoid(10), review: { status: 'approved', file: s.file, drafter: s.drafter, reviewedBy: review.reviewer.trim(), reviewedAt: now.toISOString() } } }
}

// ---------------------------------------------------------------------------------------------
// Drafters
// ---------------------------------------------------------------------------------------------

export interface SpecSource {
  file: string
  /** Text layer per page (empty for photos and scans). */
  pages: TextPage[]
  /** Page images: rendered PDF pages, or the photo itself. */
  images: PageImage[]
}

export interface PartDrafter {
  id: string
  label: string
  draft(src: SpecSource, lib: Library): Promise<PartSpec>
}

export function aiPartDrafter(provider: AiProviderId, model: string, transport: AiTransport): PartDrafter {
  const label = `${providerInfo(provider).label} ${model}`
  return {
    id: `ai-${provider}`,
    label,
    async draft(src, lib) {
      if (!src.images.length) throw new Error('No page images to send.')
      const text = await transport({ provider, model, prompt: PART_PROMPT, images: src.images })
      return partSpecFromModel(text, src.file, src.pages, label, lib)
    },
  }
}

const NUM = String.raw`(\d+(?:[.,]\d+)?)`
const num = (v: string) => Number(v.replace(',', '.'))

/**
 * Offline reader: overall size, thickness, corner radius, quantity, material and groove sizes
 * from the text layer. Positions it cannot tie to a feature stay blank for the reviewer.
 */
export const textPartDrafter: PartDrafter = {
  id: 'text',
  label: 'Built-in reader (offline)',
  async draft(src, lib) {
    const s = blankSpec(src.file, textPartDrafter.label)
    if (!hasText(src.pages)) {
      s.warnings.push('No text to read: this is a scan or a photo. Reading drawings needs an AI provider and its key in Settings; otherwise enter the values by hand from the page shown.')
      return s
    }
    const cite = (page: number, i: number, quote: string): Cite => {
      const region = src.pages.find((p) => p.page === page)?.boxes?.[i]
      return { page, quote: quote.trim().slice(0, 160), ...(region ? { region } : {}) }
    }
    for (const { page, lines } of src.pages)
      for (const [i, raw] of lines.entries()) {
        const l = raw.replace(/[×]/g, 'x')
        const c = () => cite(page, i, raw)
        const size = new RegExp(String.raw`${NUM}\s*(?:mm)?\s*x\s*${NUM}\s*(?:mm)?(?:\s*x\s*${NUM})?`, 'i').exec(l)
        if (size && !fin(s.length) && !/groove|dado|rebate|hole|cut-?out|recess|pull/i.test(l)) {
          const [a, b] = [num(size[1]), num(size[2])]
          s.length = known(Math.max(a, b), c())
          s.width = known(Math.min(a, b), c())
          if (size[3]) s.thickness = known(num(size[3]), c())
        }
        const t = new RegExp(String.raw`(?:thickness|thick)\s*[:=]?\s*${NUM}|${NUM}\s*mm\s*thick`, 'i').exec(l)
        if (t && !fin(s.thickness)) s.thickness = known(num(t[1] ?? t[2]), c())
        const r = new RegExp(String.raw`(?:corner radius|radius|\bR)\s*[:=]?\s*${NUM}`, 'i').exec(l)
        if (r && s.outline.shape === 'rect' && /corner|radius/i.test(l)) s.outline = { ...s.outline, shape: 'rounded', radius: known(num(r[1]), c()) }
        const q = new RegExp(String.raw`(?:qty|quantity)\s*[:=]?\s*${NUM}|${NUM}\s*(?:pcs|pieces|off)\b`, 'i').exec(l)
        if (q && !fin(s.qty)) s.qty = known(num(q[1] ?? q[2]), c())
        if (!s.material.text && /\b(mdf|plywood|ply|birch|oak|walnut|maple|melamine|particle ?board|chipboard|hdf)\b/i.test(l)) s.material = { text: raw.trim(), materialId: null, cite: c() }
        if (/groove|dado|rebate|rabbet/i.test(l)) {
          const w = new RegExp(String.raw`${NUM}\s*(?:mm)?\s*wide|width\s*[:=]?\s*${NUM}`, 'i').exec(l)
          const d = new RegExp(String.raw`${NUM}\s*(?:mm)?\s*deep|depth\s*[:=]?\s*${NUM}`, 'i').exec(l)
          const edge = /\b(bottom|top|left|right)\s+edge\b/i.exec(l)
          s.grooves.push({
            label: raw.replace(/[:,(]?\s*\d.*$/, '').trim().slice(0, 40) || `Groove ${s.grooves.length + 1}`,
            face: edge ? 'edge' : /underside|back face|rear face/i.test(l) ? 'underside' : 'top',
            ...(edge ? { edge: edge[1].toLowerCase() as SpecEdge } : {}),
            x0: blank(),
            y0: blank(),
            x1: blank(),
            y1: blank(),
            width: w ? known(num(w[1] ?? w[2]), c()) : blank(),
            depth: d ? known(num(d[1] ?? d[2]), c()) : blank(),
            cite: c(),
          })
        }
      }
    s.material.materialId = matchMaterial(lib.materials, s.material.text, s.thickness.v)?.id ?? null
    const title = src.pages[0]?.lines.find((l) => /[a-z]{3}/i.test(l) && l.length < 80)
    if (title) s.name = title.trim()
    s.warnings.push('Read by the offline reader: only sizes printed as text are filled in. Add holes, cut-outs and hardware from the drawing.')
    if (s.grooves.length) s.warnings.push('Groove positions are not read offline; enter where each one runs.')
    return s
  },
}
