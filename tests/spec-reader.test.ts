import { jsPDF } from 'jspdf'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'
import { newPart } from '@/cam/doc'
import { readMpr } from '@/cam/mprRead'
import { generatePart } from '@/cam/toolpath'
import type { CamPart } from '@/cam/types'
import { defaultAppData } from '@/core/defaults'
import type { AiCall } from '@/core/hardware/aiProviders'
import { DEFAULT_AI, providerInfo } from '@/core/hardware/aiProviders'
import { pdfTextPages, type TextPage } from '@/core/hardware/patternImport'
import { boringPattern, placePattern } from '@/core/hardware/patterns'
import { mprFiles, runJob } from '@/core/pipeline'
import { known } from '@/core/spec/cite'
import { draftBlock } from '@/core/spec/draft'
import { aiDrafter, approveHardwareDraft } from '@/core/spec/hardwareSpec'
import { aiPartDrafter, approvePartSpec, partFromSpec, specIssues, textPartDrafter } from '@/core/spec/partSpec'
import type { AppData, Job } from '@/core/types'

const now = new Date('2026-10-04T12:00:00Z')
const photo = { page: 1, mime: 'image/jpeg', base64: '/9j/4AAQSkZJRg==' }

function pdf(lines: string[]) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  lines.forEach((l, i) => doc.text(l, 20, 30 + i * 12))
  return new Uint8Array(doc.output('arraybuffer'))
}

const v = (value: unknown, quote?: string, region?: number[]) => ({ value, page: 1, ...(quote ? { quote } : {}), ...(region ? { region } : {}) })

const ROLLER_SHEET = ['Sliding door top roller TR-50', 'Two fixing screws Ø5 x 10 deep, 50 mm apart', 'Screws 12 mm from the top edge of the door']

const ROLLER_JSON = JSON.stringify({
  name: v('Sliding door top roller TR-50', 'Sliding door top roller TR-50'),
  manufacturer: v(null),
  code: v('TR-50', 'TR-50'),
  category: 'other',
  item: { holeDiameter: v(5, 'Ø5 x 10 deep'), holeDepth: v(10, 'Ø5 x 10 deep') },
  holes: [
    { x: v(-25, '50 mm apart', [0.1, 0.2, 0.5, 0.24]), y: v(12, '12 mm from the top edge'), diameter: v(5, 'Ø5 x 10 deep'), depth: v(10, 'Ø5 x 10 deep'), face: 'top' },
    { x: v(25, '50 mm apart'), y: v(12, '12 mm from the top edge'), diameter: v(5, 'Ø5 x 10 deep'), depth: v(null), face: 'top' },
  ],
  notes: '',
  warnings: [],
})

const DOOR_SHEET = ['Sliding wardrobe door - Cohen', '2100 x 900 x 18 MDF paint grade', 'Qty 2', 'Corner radius R3', 'Finger pull groove 20 wide, 400 long', 'Bottom edge groove 6 wide 12 deep for the floor guide', 'Top rollers TR-50 at 100 and 800']

const DOOR_JSON = JSON.stringify({
  name: 'Sliding wardrobe door - Cohen',
  material: v('MDF paint grade', 'MDF paint grade'),
  quantity: v(2, 'Qty 2'),
  length: v(2100, '2100 x 900 x 18', [0.08, 0.15, 0.55, 0.19]),
  width: v(900, '2100 x 900 x 18'),
  thickness: v(18, '2100 x 900 x 18'),
  outline: { shape: 'rounded', radius: v(3, 'Corner radius R3'), rise: v(null), points: [] },
  edges: [
    { edge: 'bottom', profile: v('2 mm ABS edge band') },
    { edge: 'right', profile: v('R3 round-over', 'Corner radius R3') },
  ],
  grooves: [
    { label: 'Finger pull groove', face: 'top', x0: v(900, 'Finger pull groove'), y0: v(40), x1: v(1300), y1: v(40), width: v(20, 'Finger pull groove 20 wide'), depth: v(null) },
    { label: 'Floor guide groove', face: 'edge', edge: 'left', x0: v(0), y0: v(9), x1: v(900), width: v(6, 'Bottom edge groove 6 wide'), depth: v(12, '12 deep') },
    { label: 'Decor dado', face: 'top', x0: v(700), y0: v(0), x1: v(700), y1: v(900), width: v(6), depth: v(4) },
  ],
  holes: [{ face: 'top', x: v(1050), y: v(450), diameter: v(16), depth: v(null), through: true }],
  cutouts: [{ label: 'Finger recess', shape: 'circle', x: v(1050), y: v(840), w: v(40), h: v(null), r: v(null), depth: v(6), through: false }],
  hardware: [{ name: 'Top roller', code: v('TR-50', 'Top rollers TR-50 at 100 and 800'), edge: 'right', at: [v(100), v(800)], mirror: false }],
  notes: 'Paint after machining.',
  warnings: ['Decor dado depth is from a sketch note.'],
})

async function pages(lines: string[]): Promise<TextPage[]> {
  return pdfTextPages(pdfjs as never, pdf(lines))
}

function job(part: CamPart, on: boolean): { job: Job; data: AppData } {
  const data = defaultAppData()
  data.settings.features = { ...(data.settings.features ?? {}), camMprOutput: on } as AppData['settings']['features']
  const j: Job = { id: 'j-door', number: 'J777', name: 'Door test', customer: 'Cohen', notes: '', createdAt: '', updatedAt: '', cabinets: [], camParts: [part] }
  data.jobs = [j]
  return { job: j, data }
}

describe('AI spec-sheet reader: default provider', () => {
  it('defaults to Anthropic Claude Sonnet 4.5; without a key the offline reader is used', () => {
    expect(DEFAULT_AI.provider).toBe('anthropic')
    expect(providerInfo('anthropic').defaultModel).toBe('claude-sonnet-4-5')
  })
})

describe('Hardware sheet, end to end with a mocked model', () => {
  it('drafts pattern and item, cites each value, blocks blanks, then saves both on approval', async () => {
    const text = await pages(ROLLER_SHEET)
    expect(text[0].boxes?.length).toBe(text[0].lines.length)
    const calls: AiCall[] = []
    const drafter = aiDrafter('anthropic', 'claude-sonnet-4-5', async (c) => {
      calls.push(c)
      return ROLLER_JSON
    })
    const d = await drafter.draft(text, 'tr50.pdf', [{ page: 1, mime: 'image/png', base64: 'iVBORw0KGgo=' }])
    expect(calls[0].prompt).toContain('"region"')
    expect(d.pattern.status).toBe('draft')
    expect(d.pattern.holes.map((h) => h.x)).toEqual([-25, 25])
    expect(Number.isNaN(d.pattern.holes[1].depth)).toBe(true)
    // the model's own box wins; a quote found in the text layer gets that line's box
    expect(d.holeCites?.[0].x?.region).toEqual([0.1, 0.2, 0.5, 0.24])
    const yBox = d.holeCites?.[0].y?.region
    expect(yBox).toBeDefined()
    expect(yBox![1]).toBeGreaterThan(0.1)
    expect(d.holeCites?.[0].y?.unverified).toBeUndefined()
    expect(d.pattern.provenance.every((p) => p.page === 1)).toBe(true)
    expect(d.item?.hardware).toMatchObject({ code: 'TR-50', name: 'Sliding door top roller TR-50', category: 'other', holeDiameter: 5, holeDepth: 10 })
    expect(d.item?.cites.code?.quote).toBe('TR-50')

    const lib = structuredClone(defaultAppData().library)
    const before = lib.hardware.length
    let r = approveHardwareDraft(lib, d.pattern, d.item, { reviewer: 'Avi', checked: true }, now)
    expect(r.errors).toContain('Hole 2: depth is missing.')
    expect(lib.patterns ?? []).toHaveLength(0)

    const filled = { ...d.pattern, holes: d.pattern.holes.map((h) => ({ ...h, depth: 10 })) }
    r = approveHardwareDraft(lib, filled, d.item, { reviewer: 'Avi', checked: false }, now)
    expect(r.errors).toContain('Confirm every hole was checked against the source.')
    expect(lib.hardware).toHaveLength(before)

    r = approveHardwareDraft(lib, filled, d.item, { reviewer: 'Avi', checked: true }, now)
    expect(r.errors).toEqual([])
    expect(lib.hardware).toHaveLength(before + 1)
    const hw = lib.hardware.find((h) => h.code === 'TR-50')!
    expect(Object.values(hw).some((x) => typeof x === 'number' && Number.isNaN(x))).toBe(false)
    expect(boringPattern(lib, hw.id)).toMatchObject({ status: 'approved', reviewedBy: 'Avi', hardwareId: hw.id })
    const placed = placePattern(newPart({ length: 600, width: 400, thickness: 18 }), r.pattern!, { edge: 'top', at: 300 })
    expect(placed.ids).toHaveLength(2)
    expect(placed.warnings).toEqual([])

    expect(approveHardwareDraft(lib, { ...filled, id: 'pat-again' }, d.item, { reviewer: 'Avi', checked: true }, now).errors[0]).toContain('already in the library')
  })

  it('reads a photo with no text layer and says no quote could be checked', async () => {
    const d = await aiDrafter('openai', 'gpt-4.1', async () => ROLLER_JSON).draft([], 'roller-photo.jpg', [photo])
    expect(d.pattern.holes).toHaveLength(2)
    expect(d.warnings.some((w) => w.includes('no text layer'))).toBe(true)
    expect(d.holeCites?.[0].x?.unverified).toBeUndefined()
  })
})

describe('Sliding-door spec, end to end with a mocked model', () => {
  const lib0 = () => {
    const lib = structuredClone(defaultAppData().library)
    lib.hardware.push({ id: 'hw-tr50', code: 'TR-50', name: 'Top roller', category: 'other' })
    lib.patterns = [
      { id: 'pat-tr50', name: 'Top roller TR-50', manufacturer: '', hardwareId: 'hw-tr50', anchor: 'edge-start', holes: [-25, 25].map((x) => ({ x, y: 12, diameter: 5, depth: 10, face: 1 as const })), status: 'approved', source: 'pdf-draft', provenance: [{ quote: 'Ø5 x 10' }], reviewedBy: 'Avi', reviewedAt: now.toISOString() },
    ]
    return lib
  }

  it('drafts the complete door, blocks it until checked, then it machines, nests and writes MPR', async () => {
    const lib = lib0()
    const text = await pages(DOOR_SHEET)
    const spec = await aiPartDrafter('anthropic', 'claude-sonnet-4-5', async () => DOOR_JSON).draft({ file: 'cohen-door.pdf', pages: text, images: [{ page: 1, mime: 'image/png', base64: 'iVBORw0KGgo=' }] }, lib)
    expect([spec.length.v, spec.width.v, spec.thickness.v, spec.qty.v]).toEqual([2100, 900, 18, 2])
    expect(spec.length.cite?.region).toEqual([0.08, 0.15, 0.55, 0.19])
    expect(spec.width.cite?.region).toBeDefined()
    expect(spec.material.materialId).toBe('mat-mdf18')
    expect(Number.isNaN(spec.grooves[0].depth.v)).toBe(true)
    expect(spec.warnings).toContain('Decor dado depth is from a sketch note.')

    // the draft preview is a part, but a draft: it cannot be saved or nested
    const draft = partFromSpec(spec, lib)
    expect(draft.part.review?.status).toBe('draft')
    expect(draftBlock(draft.part)).toContain('unchecked draft')
    const drafted = job(draft.part, false)
    const dOut = runJob(drafted.job, drafted.data)
    expect(dOut.instances).toHaveLength(0)
    expect(dOut.warnings.some((w) => w.includes('unchecked draft'))).toBe(true)

    expect(specIssues(spec, lib)).toContain('Finger pull groove depth is blank.')
    let r = approvePartSpec(spec, lib, { reviewer: 'Avi', checked: true }, now)
    expect(r.part).toBeUndefined()
    spec.grooves[0].depth = known(8)
    r = approvePartSpec(spec, lib, { reviewer: '', checked: true }, now)
    expect(r.errors).toEqual(['Enter the name of the person who checked it.'])
    r = approvePartSpec(spec, lib, { reviewer: 'Avi', checked: true }, now, defaultAppData().machine)
    expect(r.errors).toEqual([])
    const part = r.part!
    expect(part.review).toMatchObject({ status: 'approved', reviewedBy: 'Avi' })
    expect(draftBlock(part)).toBeUndefined()
    expect([part.length, part.width, part.thickness, part.qty, part.materialId]).toEqual([2100, 900, 18, 2, 'mat-mdf18'])
    expect(r.warnings.some((w) => w.includes('Floor guide groove') && w.includes('left edge'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('right R3 round-over'))).toBe(true)
    expect(part.notes).toContain('Floor guide groove in the left edge: 6 wide × 12 deep')
    expect(part.notes).toContain('bottom: 2 mm ABS edge band')

    // roller holes from the library pattern: on the right (top-of-door) edge, 12 mm in
    const rollers = part.entities.filter((e) => e.tag === 'pattern:pat-tr50')
    expect(rollers).toHaveLength(4)
    const at = rollers.map((e) => (e.g.t === 'circle' ? [e.g.c.x, e.g.c.y] : [])).sort((a, b) => a[1] - b[1])
    expect(at).toEqual([
      [2088, 75],
      [2088, 125],
      [2088, 775],
      [2088, 825],
    ])
    expect(part.ops.map((o) => [o.kind, o.name])).toEqual([
      ['drill', 'Holes and hardware'],
      ['pocket', 'Finger pull groove'],
      ['profile', 'Decor dado'],
      ['pocket', 'Finger recess'],
      ['profile', 'Cut out'],
    ])

    const data = defaultAppData()
    const paths = generatePart(part, data.machine)
    expect(paths.every((t) => t.moves.length > 0)).toBe(true)
    expect(paths.find((t) => t.name === 'Decor dado')?.tool?.diameter).toBe(6)
    // the placeholder tool table has no 16 mm drill; the checker says so instead of guessing
    expect(paths[0].warnings).toContain('No vertical drill D16 in the tool table.')

    const ok = job(part, true)
    const out = runJob(ok.job, ok.data)
    expect(out.instances).toHaveLength(2)
    expect(out.nest.sheets.flatMap((s) => s.placements)).toHaveLength(2)
    const files = mprFiles(ok.job, ok.data, out)
    expect(files).toHaveLength(2)
    for (const f of files) {
      const mpr = readMpr(f.text)
      expect(mpr.errors).toEqual([])
      expect(mpr.macros.filter((m) => m.id === 102 && Number(m.values.DU) === 5)).toHaveLength(4)
    }
    expect(out.issues.some((i) => i.message.includes('D16'))).toBe(true)
  })

  it('an unknown fitting blocks approval until a pattern exists for it', async () => {
    const lib = structuredClone(defaultAppData().library)
    const spec = await aiPartDrafter('google', 'gemini-2.5-flash', async () => DOOR_JSON).draft({ file: 'door.jpg', pages: [], images: [photo] }, lib)
    expect(specIssues(spec, lib).some((i) => i.includes('Top roller: no approved drilling pattern'))).toBe(true)
    expect(spec.warnings.some((w) => w.includes('no text layer'))).toBe(true)
  })

  it('arched outline: the top edge rises in the middle', async () => {
    const lib = lib0()
    const json = JSON.parse(DOOR_JSON)
    json.outline = { shape: 'arch', rise: v(120), radius: v(null) }
    json.grooves = []
    json.hardware = []
    const spec = await aiPartDrafter('xai', 'grok-4', async () => JSON.stringify(json)).draft({ file: 'arch.pdf', pages: [], images: [photo] }, lib)
    const { part } = partFromSpec(spec, lib)
    const out = part.entities.find((e) => e.id === part.outlineId)!
    expect(out.g.t === 'contour' && out.g.c.segs.some((s) => s.k === 'A')).toBe(true)
  })

  it('offline: reads size, thickness, radius, quantity and groove sizes; blanks the rest', async () => {
    const lib = lib0()
    const text = await pages(DOOR_SHEET)
    const s = await textPartDrafter.draft({ file: 'cohen-door.pdf', pages: text, images: [] }, lib)
    expect([s.length.v, s.width.v, s.thickness.v, s.qty.v]).toEqual([2100, 900, 18, 2])
    expect(s.outline).toMatchObject({ shape: 'rounded', radius: { v: 3 } })
    expect(s.length.cite?.page).toBe(1)
    expect(s.length.cite?.region).toBeDefined()
    expect(s.material.materialId).toBe('mat-mdf18')
    const edge = s.grooves.find((g) => g.face === 'edge')!
    expect(edge).toMatchObject({ edge: 'bottom', width: { v: 6 }, depth: { v: 12 } })
    expect(Number.isNaN(edge.x0.v)).toBe(true)
    expect(specIssues(s, lib).length).toBeGreaterThan(0)

    const photoOnly = await textPartDrafter.draft({ file: 'sketch.jpg', pages: [], images: [photo] }, lib)
    expect(photoOnly.warnings[0]).toContain('needs an AI provider')
    expect(Number.isNaN(photoOnly.length.v)).toBe(true)
  })
})
