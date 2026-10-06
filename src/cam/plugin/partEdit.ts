/**
 * Taking back a part a plugin changed (M2.10). The plugin worked on a copy; before the copy
 * replaces the part (one undo step) it is checked here:
 *
 * - shapes and operations must be well formed (known kinds, numbers that are numbers, operations
 *   only on shapes that exist);
 * - a plugin cannot confirm a value (Configure badges stay until the owner confirms), approve a
 *   draft, mark a toolpath as up to date, or change 3D models, the door it came from or its
 *   tool-data snapshot: those come from the part as it was;
 * - every operation the plugin added or changed is calculated again (it shows as new/stale).
 */
import { DEFAULT_LAYERS } from '../doc'
import { defaultOp, OP_LABEL } from '../ops'
import type { CamOp, CamOpKind, CamPart, Entity } from '../types'
import { PluginError } from './host'

const KINDS = new Set(Object.keys(OP_LABEL))
const GEOM = new Set(['contour', 'circle', 'point', 'text', 'spline', 'poly3d'])
const MAX_ITEMS = 100_000

function finiteDeep(v: unknown, path: string, out: string[]) {
  if (out.length > 20) return
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) out.push(`${path} is not a number`)
  } else if (Array.isArray(v)) v.forEach((x, i) => finiteDeep(x, `${path}[${i}]`, out))
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) finiteDeep(x, `${path}.${k}`, out)
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const strip = (o: CamOp) => {
  const { builtHash: _b, toolData: _t, confirmed: _c, ...rest } = o
  return rest
}

export interface PartEditResult {
  part: CamPart
  /** Plain-English list of what changed. */
  changes: string[]
}

export function acceptPluginPart(before: CamPart, raw: unknown, pluginName: string): PartEditResult {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object') throw new PluginError(`${pluginName} did not return a part.`)
  const p = raw as Partial<CamPart>
  finiteDeep({ length: p.length, width: p.width, thickness: p.thickness, qty: p.qty, entities: p.entities, ops: p.ops }, 'part', errors)
  for (const k of ['length', 'width', 'thickness'] as const) if (!(typeof p[k] === 'number' && p[k] > 0)) errors.push(`${k} must be above 0`)
  if (!(Number.isInteger(p.qty) && (p.qty ?? 0) >= 1)) errors.push('qty must be a whole number from 1')
  const entities = Array.isArray(p.entities) ? (p.entities as Entity[]) : (errors.push('entities must be a list'), [])
  const ops = Array.isArray(p.ops) ? (p.ops as CamOp[]) : (errors.push('ops must be a list'), [])
  const layers = Array.isArray(p.layers) && p.layers.length ? p.layers : DEFAULT_LAYERS.map((l) => ({ ...l }))
  if (entities.length > MAX_ITEMS || ops.length > MAX_ITEMS) errors.push('too many shapes or operations')
  const ids = new Set<string>()
  for (const e of entities) {
    if (!e || typeof e.id !== 'string' || !e.id) errors.push('a shape has no id')
    else if (ids.has(e.id)) errors.push(`shape id ${e.id} is used twice`)
    else ids.add(e.id)
    if (!e?.g || !GEOM.has(e.g.t)) errors.push(`shape ${e?.id}: unknown geometry`)
    if (![1, 2, 3, 4, 5, 6].includes(e?.face)) errors.push(`shape ${e?.id}: face must be 1 to 6`)
    if (typeof e?.layer !== 'string') errors.push(`shape ${e?.id}: no layer`)
    if (e?.depth !== undefined && !(typeof e.depth === 'number' && e.depth >= 0)) errors.push(`shape ${e?.id}: depth must be 0 or more`)
  }
  for (const l of layers) if (!l || typeof l.id !== 'string' || typeof l.name !== 'string') errors.push('a layer needs an id and a name')
  const opIds = new Set<string>()
  for (const o of ops) {
    if (!o || typeof o.id !== 'string' || !o.id) {
      errors.push('an operation has no id')
      continue
    }
    if (opIds.has(o.id)) errors.push(`operation id ${o.id} is used twice`)
    opIds.add(o.id)
    if (!KINDS.has(o.kind)) {
      errors.push(`operation ${o.id}: unknown kind "${String(o.kind)}"`)
      continue
    }
    if (!Array.isArray(o.geometry)) errors.push(`operation ${o.id}: geometry must be a list of shape ids`)
    else for (const g of o.geometry) if (!ids.has(g)) errors.push(`operation ${o.name ?? o.id}: shape ${g} does not exist`)
    // fields the operation kind has by default keep their type; a new operation has them all
    const prev = before.ops.find((x) => x.id === o.id)
    if (!prev || !same(strip(prev), strip(o))) {
      const d = defaultOp(o.kind as CamOpKind) as unknown as Record<string, unknown>
      for (const [k, v] of Object.entries(d)) {
        if (k === 'id' || v === undefined) continue
        const got = (o as unknown as Record<string, unknown>)[k]
        if (got === undefined) {
          if (!prev || (prev as unknown as Record<string, unknown>)[k] !== undefined) errors.push(`operation ${o.name ?? o.id}: ${k} is missing`)
        } else if (v !== null && got !== null && (Array.isArray(v) !== Array.isArray(got) || typeof v !== typeof got)) errors.push(`operation ${o.name ?? o.id}: ${k} has the wrong type`)
      }
    }
    if (![1, 2, 3, 4, 5, 6].includes(o.face)) errors.push(`operation ${o.name ?? o.id}: face must be 1 to 6`)
  }
  if (p.outlineId !== undefined && p.outlineId !== null && !ids.has(p.outlineId)) errors.push(`outline ${p.outlineId} does not exist`)
  if (errors.length) throw new PluginError(`${pluginName} returned a part that cannot be used: ${[...new Set(errors)].slice(0, 8).join('; ')}.`)

  const prevOps = new Map(before.ops.map((o) => [o.id, o]))
  const outOps: CamOp[] = ops.map((o) => {
    const prev = prevOps.get(o.id)
    const { builtHash: _b, toolData: _t, confirmed: _c, ...rest } = o
    const op = rest as CamOp
    if (prev && prev.kind === o.kind && same(strip(prev), strip(o))) {
      // unchanged: keep its state as it was
      return { ...op, ...(prev.builtHash ? { builtHash: prev.builtHash } : {}), ...(prev.toolData ? { toolData: prev.toolData } : {}), ...(prev.confirmed ? { confirmed: prev.confirmed } : {}) }
    }
    // changed or new: no confirmations it did not have, calculated again
    const kept = prev ? (o.confirmed ?? []).filter((c) => prev.confirmed?.includes(c)) : []
    return { ...op, ...(kept.length ? { confirmed: kept } : {}) }
  })

  const part: CamPart = {
    ...before,
    name: typeof p.name === 'string' && p.name.trim() ? p.name : before.name,
    materialId: typeof p.materialId === 'string' || p.materialId === null ? p.materialId : before.materialId,
    length: p.length!,
    width: p.width!,
    thickness: p.thickness!,
    grain: p.grain === 'none' ? 'none' : 'length',
    qty: p.qty!,
    layers,
    entities,
    ops: outOps,
    variables: Array.isArray(p.variables) ? p.variables : before.variables,
    ...(typeof p.notes === 'string' ? { notes: p.notes } : {}),
    ...(typeof p.kit === 'string' ? { kit: p.kit } : {}),
    ...(typeof p.priority === 'number' ? { priority: p.priority } : {}),
    ...(typeof p.assembly === 'string' ? { assembly: p.assembly } : {}),
  }
  if (p.outlineId) part.outlineId = p.outlineId
  else delete part.outlineId

  const changes: string[] = []
  const prevEnt = new Map(before.entities.map((e) => [e.id, e]))
  const added = entities.filter((e) => !prevEnt.has(e.id)).length
  const removed = before.entities.filter((e) => !ids.has(e.id)).length
  const changedEnt = entities.filter((e) => prevEnt.has(e.id) && !same(prevEnt.get(e.id), e)).length
  if (added) changes.push(`${added} shape${added === 1 ? '' : 's'} added`)
  if (changedEnt) changes.push(`${changedEnt} shape${changedEnt === 1 ? '' : 's'} changed`)
  if (removed) changes.push(`${removed} shape${removed === 1 ? '' : 's'} removed`)
  const opAdded = outOps.filter((o) => !prevOps.has(o.id)).length
  const opChanged = outOps.filter((o) => prevOps.has(o.id) && !same(strip(prevOps.get(o.id)!), strip(o))).length
  const opRemoved = before.ops.filter((o) => !opIds.has(o.id)).length
  if (opAdded) changes.push(`${opAdded} operation${opAdded === 1 ? '' : 's'} added`)
  if (opChanged) changes.push(`${opChanged} operation${opChanged === 1 ? '' : 's'} changed`)
  if (opRemoved) changes.push(`${opRemoved} operation${opRemoved === 1 ? '' : 's'} removed`)
  for (const k of ['name', 'materialId', 'length', 'width', 'thickness', 'grain', 'qty', 'notes', 'kit', 'priority', 'assembly', 'outlineId'] as const) if (!same(before[k], part[k])) changes.push(`${k} changed`)
  if (!same(before.layers, part.layers)) changes.push('layers changed')
  if (!same(before.variables, part.variables)) changes.push('variables changed')
  return { part, changes }
}
