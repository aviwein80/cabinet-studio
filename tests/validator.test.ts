import { describe, expect, it } from 'vitest'
import { expandJob } from '../src/core/cutlist'
import { buildAllPrograms, nestJob } from '../src/core/machining'
import { runJob } from '../src/core/pipeline'
import type { AppData, Job } from '../src/core/types'
import { validateJob, type Issue } from '../src/core/validator'
import { cabinet, data, job } from './helpers'

const codes = (issues: Issue[], severity: Issue['severity'] = 'error') => [...new Set(issues.filter((i) => i.severity === severity).map((i) => i.code))].sort()

function run(j: Job, d: AppData, mutate?: (ctx: { nest: ReturnType<typeof nestJob> }) => void) {
  const e = expandJob(j, d.library, d.settings)
  const nest = nestJob(e.instances, d.library, d.machine, d.settings)
  mutate?.({ nest })
  const programs = buildAllPrograms(j, nest, e.instances, d.library, d.machine)
  return validateJob(programs, nest, e.instances, d.library, d.machine, d.settings)
}

const base = () => job([cabinet('tpl-base-2door')])

describe('validator', () => {
  it('passes a clean job with only the placeholder warning and the simulation reminder', () => {
    const issues = run(base(), data())
    expect(codes(issues)).toEqual([])
    expect(issues.some((i) => i.code === 'PLACEHOLDER_TOOLS')).toBe(true)
    expect(issues.some((i) => i.code === 'SIMULATE' && i.severity === 'info')).toBe(true)
  })

  it('flags drills missing from the tool table', () => {
    const d = data((x) => (x.machine.tools = x.machine.tools.filter((t) => t.diameter !== 35)))
    const issues = run(base(), d)
    expect(codes(issues)).toContain('TOOL_MISSING')
    expect(issues.find((i) => i.code === 'TOOL_MISSING')!.message).toMatch(/D35/)
  })

  it('flags a missing cut-out router', () => {
    const d = data((x) => (x.machine.cutoutToolNumber = 999))
    expect(codes(run(base(), d))).toContain('TOOL_MISSING')
  })

  it('flags blind holes that would break through', () => {
    const c = cabinet('tpl-base-2door')
    c.overrides['side-left'] = { extraOps: [{ kind: 'drill', id: 'deep', x: 400, y: 280, diameter: 8, depth: 18, through: false, purpose: 'custom' }] }
    const issues = run(job([c]), data())
    expect(issues.some((i) => i.code === 'DEPTH' && /break through/.test(i.message))).toBe(true)
  })

  it('flags grooves deeper than the material', () => {
    const c = cabinet('tpl-base-2door', (p) => (p.back.grooveDepth = 18))
    expect(codes(run(job([c]), data()))).toContain('DEPTH')
  })

  it('flags through cuts deeper than the spoilboard allowance', () => {
    const d = data((x) => (x.machine.throughDepth = 2))
    expect(codes(run(base(), d))).toContain('DEPTH_SPOILBOARD')
  })

  it('flags overlapping and too-close parts', () => {
    const issues = run(base(), data(), ({ nest }) => {
      const s = nest.sheets.find((sh) => sh.placements.length > 2)!
      s.placements[1] = { ...s.placements[1], x: s.placements[0].x + 5, y: s.placements[0].y + 5 }
    })
    expect(codes(issues)).toContain('OVERLAP')
    const close = run(base(), data(), ({ nest }) => {
      const s = nest.sheets.find((sh) => sh.placements.length > 2)!
      const a = s.placements[0]
      s.placements[1] = { ...s.placements[1], x: a.x + a.dx + 4, y: a.y }
    })
    expect(codes(close)).toContain('SPACING')
  })

  it('flags parts outside the sheet', () => {
    const issues = run(base(), data(), ({ nest }) => {
      const s = nest.sheets[1]
      s.placements[0] = { ...s.placements[0], x: s.sheetLength - 50 }
    })
    expect(codes(issues)).toContain('OUT_OF_SHEET')
  })

  it('reports parts that cannot be nested', () => {
    const c = cabinet('tpl-base-2door', (p) => (p.height = 4000))
    expect(codes(run(job([c]), data()))).toContain('NOT_NESTED')
  })

  it('warns about skipped horizontal holes and saw run-out', () => {
    const sink = job([cabinet('tpl-sink-base')])
    expect(codes(run(sink, data()), 'warning')).toContain('HORIZONTAL_SKIPPED')
    const saw = data((x) => (x.machine.grooveMethod = 'saw'))
    expect(codes(run(base(), saw), 'warning')).toContain('SAW_RUNOUT')
  })

  it('flags horizontal holes with no matching horizontal drill when the unit is enabled', () => {
    const d = data((x) => (x.machine.hasHorizontalDrillUnit = true))
    expect(codes(run(job([cabinet('tpl-sink-base')]), d))).toContain('TOOL_MISSING')
  })

  it('flags grooves no router is narrow enough for', () => {
    const d = data((x) => (x.machine.tools = x.machine.tools.filter((t) => !(t.type === 'router' && t.diameter < 12))))
    const issues = run(base(), d)
    expect(issues.some((i) => i.code === 'TOOL_MISSING' && /groove/.test(i.message))).toBe(true)
  })

  it('surfaces construction warnings through runJob', () => {
    const c = cabinet('tpl-base-2door', (p) => (p.dadoDepth = 20))
    const out = runJob(job([c]), data())
    expect(out.issues.some((i) => i.code === 'CONSTRUCTION')).toBe(true)
  })
})
