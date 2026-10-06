/**
 * Macro recorder (M2.10, API-01). Recording in the part designer keeps the part as it was when
 * recording started; stopping compares it with the part now and writes a plugin whose menu item
 * makes the same changes through the plugin API: shapes added, changed and removed, operations
 * added, changed, removed and reordered, layers and part fields. The macro is ordinary plugin
 * code: it can be read, edited, saved and installed like any other, and runs in the sandbox.
 *
 * Shapes and operations the macro adds keep their recorded ids when those are free, so the macro
 * replayed on the starting part gives exactly the recorded part; on another part they get new ids
 * and the operations follow them.
 */
import type { CamOp, CamPart } from '../types'

const js = (v: unknown) => JSON.stringify(v)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const clean = (o: CamOp) => {
  const { builtHash: _b, toolData: _t, confirmed: _c, ...rest } = o
  return rest
}
const PART_FIELDS = ['name', 'materialId', 'length', 'width', 'thickness', 'grain', 'qty', 'notes', 'kit', 'priority', 'assembly', 'outlineId'] as const

export interface RecordedMacro {
  code: string
  /** One line per change, for the screen. */
  steps: string[]
}

export function recordMacro(before: CamPart, after: CamPart, opts: { name: string; id?: string; when?: string }): RecordedMacro {
  const slug = (opts.id ?? opts.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'macro'
  const lines: string[] = []
  const steps: string[] = []
  const prevEnt = new Map(before.entities.map((e) => [e.id, e]))
  const nextEnt = new Set(after.entities.map((e) => e.id))
  const prevOps = new Map(before.ops.map((o) => [o.id, o]))
  const nextOps = new Set(after.ops.map((o) => o.id))

  const newLayers = after.layers.filter((l) => !before.layers.some((x) => x.id === l.id))
  const kept = after.layers.filter((l) => before.layers.some((x) => x.id === l.id))
  if (!same(kept, before.layers.filter((l) => after.layers.some((x) => x.id === l.id))) || kept.length !== before.layers.length) {
    // existing layers renamed, recoloured, hidden or removed: the layer list as recorded
    lines.push(`  cs.part.set(p, { layers: ${js(after.layers)} })`)
    steps.push('change the layers')
  } else
    for (const l of newLayers) {
      lines.push(`  p.layers.push(${js(l)})`)
      steps.push(`add layer ${l.name}`)
    }
  for (const e of after.entities) {
    const prev = prevEnt.get(e.id)
    if (!prev) {
      lines.push(`  ids[${js(e.id)}] = cs.part.addEntity(p, ${js(e)})`)
      steps.push(`add a ${e.g.t} on ${e.layer}`)
    } else if (!same(prev, e)) {
      const { id: _id, ...rest } = e
      lines.push(`  cs.part.setEntity(p, ${js(e.id)}, ${js(rest)})`)
      steps.push(`change shape ${e.id}`)
    }
  }
  for (const e of before.entities)
    if (!nextEnt.has(e.id)) {
      lines.push(`  cs.part.removeEntity(p, ${js(e.id)})`)
      steps.push(`remove shape ${e.id}`)
    }
  for (const o of after.ops) {
    const prev = prevOps.get(o.id)
    const c = clean(o)
    if (!prev) {
      lines.push(`  ids[${js(o.id)}] = cs.part.addOpObject(p, mapped(${js(c)}))`)
      steps.push(`add operation ${o.name}`)
    } else if (!same(clean(prev), c)) {
      const patch: Record<string, unknown> = {}
      const was = clean(prev) as Record<string, unknown>
      for (const [k, v] of Object.entries(c)) if (!same(was[k], v)) patch[k] = v
      lines.push(`  cs.part.setOp(p, ${js(o.id)}, mapped(${js(patch)}))`)
      steps.push(`change operation ${o.name} (${Object.keys(patch).join(', ')})`)
    }
  }
  for (const o of before.ops)
    if (!nextOps.has(o.id)) {
      lines.push(`  cs.part.removeOp(p, ${js(o.id)})`)
      steps.push(`remove operation ${o.name}`)
    }
  const order = after.ops.map((o) => o.id)
  const keptOps = before.ops.filter((o) => nextOps.has(o.id)).map((o) => o.id)
  if (!same(order.filter((id) => prevOps.has(id)), keptOps) || order.some((id) => !prevOps.has(id))) {
    lines.push(`  order(${js(order)})`)
    if (!same(order.filter((id) => prevOps.has(id)), keptOps)) steps.push('reorder operations')
  }
  const fields: Record<string, unknown> = {}
  for (const k of PART_FIELDS) if (!same(before[k], after[k]) && after[k] !== undefined) fields[k] = after[k]
  if (!same(before.variables, after.variables)) fields.variables = after.variables
  if (Object.keys(fields).length) {
    if ('outlineId' in fields) fields.outlineId = `@@${String(fields.outlineId)}`
    lines.push(`  cs.part.set(p, ${js(fields).replace(/"@@([^"]*)"/, (_m, id: string) => `ids[${js(id)}] || ${js(id)}`)})`)
    steps.push(`set ${Object.keys(fields).join(', ')}`)
  }

  const summary = steps.length ? `${steps.length} change${steps.length === 1 ? '' : 's'}` : 'no changes'
  const code = [
    `// @plugin recorded-${slug}`,
    `// @name ${opts.name.replace(/[\r\n]+/g, ' ')}`,
    '// @version 1',
    `// @description Recorded in the part designer${opts.when ? ` on ${opts.when}` : ''}: ${summary}.`,
    '',
    `cs.menu.add({ id: 'replay', label: ${js(opts.name)}, area: 'part' }, function (ctx) {`,
    '  var p = ctx.part',
    '  var ids = {}',
    '  // operations follow the shapes they machine, under their new ids when those changed',
    '  var mapped = function (o) {',
    '    if (o.geometry) o.geometry = o.geometry.map(function (id) { return ids[id] || id })',
    '    return o',
    '  }',
    '  var order = function (list) {',
    '    var at = function (o) { var i = list.indexOf(o.id); if (i < 0) for (var k in ids) if (ids[k] === o.id) i = list.indexOf(k); return i < 0 ? list.length : i }',
    '    p.ops.sort(function (a, b) { return at(a) - at(b) })',
    '  }',
    ...lines,
    '})',
    '',
  ].join('\n')
  return { code, steps }
}
