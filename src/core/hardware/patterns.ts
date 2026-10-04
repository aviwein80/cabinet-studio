/**
 * Hardware drilling patterns: the verified built-ins (from the published sheets in specs.ts),
 * patterns imported from manufacturer DXF / CSV data, and patterns drafted from PDF spec
 * sheets. Only verified and approved patterns can be saved or placed; a draft becomes approved
 * when a named person confirms they checked every hole against the source.
 *
 * Pattern frame: x runs along the reference edge, y goes into the part away from that edge.
 * Hole faces: 1 = top face, 6 = underside, 2 = the reference edge itself (a horizontal bore;
 * its y is the depth below face 1, as for edge holes drawn on parts).
 */
import { makeEntity } from '@/cam/doc'
import { pt } from '@/cam/geom'
import type { CamPart, FaceId, HardwarePattern, PatternHole } from '@/cam/types'
import type { Library } from '../types'
import { HINGE_ID, PLATE_ID, SLIDE_IDS } from './ids'
import { BLUM, SALICE, TANDEM } from './specs'

const SALICE_SHEET = 'https://www.salice.com/downloads/2349/2759/Salice-SilentiaPlus-Series700-110-standard-USA.pdf'
const SALICE_PLATES = 'https://www.salice.com/ww/en/products/hinges/series-200-mounting-plates-with-traditional-assembly-series-800'
const BLUM_SHEET = 'https://d2.blum.com/services/BEC003/tdm563h_ma_dok_bus_$sen-us_$aof_$v4.pdf'

const VERIFIED_AT = '2026-09-01T00:00:00.000Z'

export function builtInPatterns(): HardwarePattern[] {
  const base = { status: 'verified' as const, source: 'library' as const, reviewedBy: 'Cabinet Studio library', reviewedAt: VERIFIED_AT }
  return [
    {
      ...base,
      id: 'pat-salice-700-cup',
      name: 'Salice Silentia+ 700 hinge cup (K = 3)',
      manufacturer: 'Salice',
      hardwareId: HINGE_ID,
      anchor: 'edge-start',
      holes: [{ x: 0, y: SALICE.cupCentreFromEdge, diameter: SALICE.cupDiameter, depth: SALICE.cupDepth, face: 1 }],
      provenance: [
        { file: SALICE_SHEET, quote: 'boring distance from the edge of the door', note: 'K = 3 to 6 mm listed; we use K = 3, so the cup centre is 3 + 17.5' },
        { file: SALICE_SHEET, note: 'Ø35 cup, 13.5 mm deep for Series 700' },
      ],
      notes: 'Place on the hinge edge of the door, x at each hinge centre line.',
    },
    {
      ...base,
      id: 'pat-salice-b2vgv-h3',
      name: 'Salice cruciform plate B2VGV, H = 3 (euro screw)',
      manufacturer: 'Salice',
      hardwareId: PLATE_ID,
      anchor: 'edge-start',
      holes: [-1, 1].map((s) => ({ x: (s * SALICE.plateSpacing) / 2, y: SALICE.plateSetback, diameter: SALICE.plateHoleDiameter, depth: SALICE.plateHoleDepth, face: 1 as FaceId })),
      provenance: [{ file: SALICE_PLATES, note: 'Cruciform plate drilling 37 × 32 mm; Ø5 × 11 mm euro screw' }],
      notes: 'Reference edge = front edge of the cabinet side; x at the hinge centre line. Euro vs wood-screw plate is not confirmed.',
    },
    ...TANDEM.map((t) => ({
      ...base,
      id: `pat-blum-563h-${t.inches}`,
      name: `Blum TANDEM 563H ${t.inches} in runner (${t.part})`,
      manufacturer: 'Blum',
      hardwareId: SLIDE_IDS[t.part],
      anchor: 'edge-start' as const,
      holes: t.holesFromFront.map((x) => ({ x, y: BLUM.line, diameter: BLUM.holeDiameter, depth: BLUM.holeDepth, face: 1 as FaceId })),
      provenance: [{ file: BLUM_SHEET, note: `Frameless screw locations from the cabinet front: ${t.holesFromFront.join(' and ')} mm, 37 mm above the bottom of the drawer opening` }],
      notes: 'Reference edge = bottom of the drawer opening on the cabinet side, x from the front edge.',
    })),
    {
      ...base,
      id: 'pat-blum-563h-hook',
      name: 'Blum TANDEM drawer-back hook bore',
      manufacturer: 'Blum',
      anchor: 'edge-start',
      holes: [{ x: BLUM.hookFromEnd, y: BLUM.hookFromBottom, diameter: BLUM.hookDiameter, depth: BLUM.hookDepth, face: 1 }],
      provenance: [{ file: BLUM_SHEET, note: 'Rear-view callouts: Ø6 × 10 bore, 7 mm from the end, 11 mm up from the bottom' }],
      notes: 'One per side on the drawer back; mirror for the other end.',
    },
  ]
}

const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9)

/**
 * A built-in pattern with the library item's own numbers applied (the Library edit form changes
 * plate, slide and cup values). If they differ from the published sheet it is no longer
 * "verified" but approved by that edit.
 */
export function itemPattern(lib: Library, base: HardwarePattern): HardwarePattern {
  const row = base.hardwareId ? lib.hardware.find((h) => h.id === base.hardwareId) : undefined
  if (!row) return base
  let holes = base.holes
  if (row.category === 'mounting-plate') {
    const s = row.plateSpacing ?? Math.abs(base.holes[1].x - base.holes[0].x)
    holes = [-1, 1].map((k) => ({ x: (k * s) / 2, y: row.plateSetback ?? base.holes[0].y, diameter: row.holeDiameter ?? base.holes[0].diameter, depth: row.holeDepth ?? base.holes[0].depth, face: 1 as FaceId }))
  } else if (row.category === 'slide') {
    const xs = row.slideHoles ?? base.holes.map((h) => h.x)
    holes = xs.map((x) => ({ x, y: base.holes[0].y, diameter: row.holeDiameter ?? base.holes[0].diameter, depth: row.holeDepth ?? base.holes[0].depth, face: 1 as FaceId }))
  } else if (row.category === 'hinge') {
    holes = [{ ...base.holes[0], y: row.cupCentre ?? base.holes[0].y, diameter: row.cupDiameter ?? base.holes[0].diameter, depth: row.cupDepth ?? base.holes[0].depth }]
  }
  const flat = (hs: PatternHole[]) => hs.flatMap((h) => [h.x, h.y, h.diameter, h.depth])
  if (same(flat(holes), flat(base.holes))) return base
  return { ...base, holes, status: 'approved', reviewedBy: `Library item ${row.code}`, notes: [base.notes, 'Numbers changed in the library item; no longer the published values.'].filter(Boolean).join(' ') }
}

/** Built-ins first (with library item edits applied), then the library's own patterns. */
export function patternsOf(lib: Library): HardwarePattern[] {
  const own = lib.patterns ?? []
  return [...builtInPatterns().filter((b) => !own.some((p) => p.id === b.id)).map((b) => itemPattern(lib, b)), ...own]
}

/**
 * The pattern that bores a library hardware item: the newest approved library pattern linked to
 * it, otherwise the built-in pattern with the item's numbers.
 */
export function boringPattern(lib: Library, hardwareId: string): HardwarePattern | undefined {
  const own = (lib.patterns ?? []).filter((p) => p.hardwareId === hardwareId && isUsable(p) && p.holes.length).sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? ''))
  if (own[0]) return own[0]
  const base = builtInPatterns().find((p) => p.hardwareId === hardwareId)
  return base ? itemPattern(lib, base) : undefined
}

export const isUsable = (p: HardwarePattern) => p.status === 'verified' || p.status === 'approved'

export function usablePatterns(lib: Library): HardwarePattern[] {
  return patternsOf(lib).filter(isUsable)
}

/** Problems that block approval. */
export function patternIssues(p: HardwarePattern): string[] {
  const out: string[] = []
  if (!p.name.trim()) out.push('Give the pattern a name.')
  if (!p.holes.length) out.push('The pattern has no holes.')
  p.holes.forEach((h, i) => {
    const n = `Hole ${i + 1}`
    if (![h.x, h.y].every(Number.isFinite)) out.push(`${n}: position is missing.`)
    if (!(Number.isFinite(h.diameter) && h.diameter > 0)) out.push(`${n}: diameter is missing.`)
    if (!(Number.isFinite(h.depth) && h.depth > 0)) out.push(`${n}: depth is missing.`)
    if (![1, 2, 6].includes(h.face)) out.push(`${n}: face must be top (1), underside (6) or the reference edge (2).`)
  })
  for (let i = 0; i < p.holes.length; i++)
    for (let j = i + 1; j < p.holes.length; j++) {
      const a = p.holes[i]
      const b = p.holes[j]
      if (a.face === b.face && Math.hypot(a.x - b.x, a.y - b.y) < (a.diameter + b.diameter) / 2 - 1e-6) out.push(`Holes ${i + 1} and ${j + 1} overlap.`)
    }
  if (p.source === 'pdf-draft' && !p.provenance.some((q) => q.quote)) out.push('A PDF draft needs at least one quoted source line.')
  return out
}

export interface Review {
  reviewer: string
  /** The reviewer ticked “I checked every hole against the source”. */
  checked: boolean
}

export function approvePattern(p: HardwarePattern, review: Review, now: Date): { pattern?: HardwarePattern; errors: string[] } {
  const errors = [...patternIssues(p)]
  if (!review.reviewer.trim()) errors.push('Enter the name of the person who checked it.')
  if (!review.checked) errors.push('Confirm every hole was checked against the source.')
  if (errors.length) return { errors }
  return { pattern: { ...structuredClone(p), status: 'approved', reviewedBy: review.reviewer.trim(), reviewedAt: now.toISOString() }, errors: [] }
}

/** Add or replace a pattern. Drafts are refused: they must be approved first. */
export function savePattern(lib: Library, p: HardwarePattern): { ok: boolean; error?: string } {
  if (p.status === 'draft') return { ok: false, error: 'Drafts cannot be saved. Approve the pattern first.' }
  if (p.status === 'verified' && p.source !== 'library') return { ok: false, error: 'Only built-in patterns are marked verified.' }
  if (p.status === 'approved' && (!p.reviewedBy || !p.reviewedAt)) return { ok: false, error: 'An approved pattern needs a reviewer and a date.' }
  const list = lib.patterns ?? []
  lib.patterns = list.some((q) => q.id === p.id) ? list.map((q) => (q.id === p.id ? p : q)) : [...list, p]
  return { ok: true }
}

/** Withdraw an approved pattern (kept for the record, no longer placeable). */
export function withdrawPattern(lib: Library, id: string, note: string) {
  lib.patterns = (lib.patterns ?? []).map((p) => (p.id === id ? { ...p, status: 'rejected', notes: [p.notes, note].filter(Boolean).join(' · ') } : p))
}

// ---------------------------------------------------------------------------------------------
// Placing a pattern on a custom part
// ---------------------------------------------------------------------------------------------

export type RefEdge = 'bottom' | 'right' | 'top' | 'left'

export interface PlaceOptions {
  edge: RefEdge
  /** Distance along the edge (in the edge's running direction) to the pattern's x = 0. */
  at: number
  /** Mirror the pattern across its own y axis (other hand). */
  mirror?: boolean
}

/** Edge frames run counter-clockwise, matching edge faces 2 to 5 (u measured the same way). */
export function edgeFrame(edge: RefEdge, part: { length: number; width: number }) {
  const L = part.length
  const W = part.width
  switch (edge) {
    case 'bottom':
      return { o: pt(0, 0), along: pt(1, 0), inward: pt(0, 1), face: 2 as FaceId, length: L }
    case 'right':
      return { o: pt(L, 0), along: pt(0, 1), inward: pt(-1, 0), face: 3 as FaceId, length: W }
    case 'top':
      return { o: pt(L, W), along: pt(-1, 0), inward: pt(0, -1), face: 4 as FaceId, length: L }
    case 'left':
      return { o: pt(0, W), along: pt(0, -1), inward: pt(1, 0), face: 5 as FaceId, length: W }
  }
}

export function patternPoints(p: HardwarePattern, part: { length: number; width: number; thickness: number }, opt: PlaceOptions) {
  const f = edgeFrame(opt.edge, part)
  return p.holes.map((h: PatternHole) => {
    const x = opt.at + (opt.mirror ? -h.x : h.x)
    if (h.face === 2) return { hole: h, face: f.face, u: x, v: h.y, x: f.o.x + f.along.x * x, y: f.o.y + f.along.y * x }
    return { hole: h, face: h.face, u: x, v: h.y, x: f.o.x + f.along.x * x + f.inward.x * h.y, y: f.o.y + f.along.y * x + f.inward.y * h.y }
  })
}

/**
 * Add the pattern's holes to the part as tagged circles on the holes layer. Face-1 and face-6
 * holes sit in the part plane; reference-edge holes become edge-face circles (u along the edge,
 * v = depth below face 1). Returns the new entity ids and anything that does not fit.
 */
export function placePattern(part: CamPart, p: HardwarePattern, opt: PlaceOptions): { part: CamPart; ids: string[]; warnings: string[] } {
  const warnings: string[] = []
  if (!isUsable(p)) return { part, ids: [], warnings: ['Only verified or approved patterns can be placed.'] }
  const tag = `pattern:${p.id}`
  const f = edgeFrame(opt.edge, part)
  const entities = patternPoints(p, part, opt).map(({ hole, face, u, v, x, y }, i) => {
    const r = hole.diameter / 2
    if (face === 1 || face === 6) {
      if (x - r < -1e-6 || y - r < -1e-6 || x + r > part.length + 1e-6 || y + r > part.width + 1e-6) warnings.push(`Hole ${i + 1} runs off the part.`)
      if (hole.depth > part.thickness + 1e-6) warnings.push(`Hole ${i + 1} is deeper than the part; it will be drilled through.`)
      return makeEntity({ t: 'circle', c: pt(x, y), r }, 'holes', face, { depth: hole.depth, tag })
    }
    if (u - r < -1e-6 || u + r > f.length + 1e-6) warnings.push(`Edge hole ${i + 1} runs off the edge.`)
    if (v - r < -1e-6 || v + r > part.thickness + 1e-6) warnings.push(`Edge hole ${i + 1} breaks out of the faces (part is ${part.thickness} mm thick).`)
    return makeEntity({ t: 'circle', c: pt(u, v), r }, 'holes', face, { depth: hole.depth, tag })
  })
  const layers = part.layers.some((l) => l.id === 'holes') ? part.layers : [...part.layers, { id: 'holes', name: 'Holes', color: '#38bdf8', visible: true, locked: false }]
  return { part: { ...part, layers, entities: [...part.entities, ...entities] }, ids: entities.map((e) => e.id), warnings }
}
