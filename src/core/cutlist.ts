import { partApertures, partOutline as camOutline } from '@/cam/doc'
import { toPoints } from '@/cam/geom'
import { hasTiltedWork } from '@/cam/positional/frame'
import { hasMultiAxisWork } from '@/cam/multiaxis/engine'
import type { CamPart } from '@/cam/types'
import { buildCabinet, partOutline } from './construction/carcass'
import { EPS, r3 } from './geometry'
import { lCorner, lEdgeLengths } from './lpart'
import type { AnyEdgeKey, EdgeCodes, Job, Library, Operation, Part, ShopSettings, Vec2 } from './types'
import { EDGE_KEYS, INSIDE_EDGE_KEYS } from './types'
import { draftBlock } from './spec/draft'

/** One physical panel to be cut, in cut-size coordinates (after edgeband / pre-mill compensation). */
export interface PartInstance {
  uid: string
  /** Job-wide part number printed on the label and the sheet map. */
  no: number
  /** Barcode / part ID, e.g. "J1042-007". */
  partId: string
  cabinetId: string
  cabinetNumber: string
  cabinetName: string
  part: Part
  materialId: string
  thickness: number
  cutLength: number
  cutWidth: number
  /** Operations and outline translated into the cut-size frame. */
  ops: Operation[]
  outline: Vec2[]
  canRotate: boolean
  /** Custom part drawn in the part designer; its machining comes from its own operations. */
  cam?: CamPart
  /** Through openings in the cut-size frame (custom parts). */
  holes?: Vec2[][]
  /** Nesting priority (higher first) and kit name. */
  priority?: number
  kit?: string
}

export interface CutListRow {
  materialId: string
  materialCode: string
  name: string
  cabinets: string
  finishedLength: number
  finishedWidth: number
  cutLength: number
  cutWidth: number
  thickness: number
  qty: number
  /** Kitchen-3: an L-shaped part also lists its inside edges L3 and W3. */
  edges: EdgeCodes
  grain: string
}

export interface ExpandedJob {
  instances: PartInstance[]
  hardware: { code: string; name: string; qty: number }[]
  warnings: string[]
}

function edgeDelta(part: Part, k: AnyEdgeKey, lib: Library, premill: number) {
  const id = part.edges[k]
  if (!id) return 0
  const band = lib.edgebands.find((e) => e.id === id)
  const t = band?.thickness ?? 0
  return premill - t
}

function shiftOps(ops: Operation[], dx: number, dy: number, L: number, W: number, Lc: number, Wc: number): Operation[] {
  const sx = (x: number) => (Math.abs(x) < EPS ? 0 : Math.abs(x - L) < EPS ? Lc : r3(x + dx))
  const sy = (y: number) => (Math.abs(y) < EPS ? 0 : Math.abs(y - W) < EPS ? Wc : r3(y + dy))
  return ops.map((op) => {
    switch (op.kind) {
      case 'drill':
        return { ...op, x: r3(op.x + dx), y: r3(op.y + dy) }
      case 'hdrill':
        return { ...op, x: sx(op.x), y: sy(op.y) }
      case 'groove':
        return {
          ...op,
          x1: op.open.x1 ? 0 : r3(op.x1 + dx),
          x2: op.open.x2 ? Lc : r3(op.x2 + dx),
          y1: op.open.y1 ? 0 : r3(op.y1 + dy),
          y2: op.open.y2 ? Wc : r3(op.y2 + dy),
        }
    }
  })
}

export function expandJob(job: Job, lib: Library, settings: ShopSettings): ExpandedJob {
  const instances: PartInstance[] = []
  const warnings: string[] = []
  const hw = new Map<string, number>()
  let no = 0
  for (const cab of job.cabinets) {
    const g = buildCabinet(cab, lib, settings.units)
    for (const w of g.warnings) warnings.push(`${cab.number} ${cab.name}: ${w}`)
    for (let copy = 0; copy < Math.max(1, cab.qty); copy++) {
      for (const h of g.hardware) hw.set(h.hardwareCode, (hw.get(h.hardwareCode) ?? 0) + h.qty)
      for (const part of g.parts) {
        no += 1
        const pm = settings.nesting.premill
        const dW1 = edgeDelta(part, 'W1', lib, pm)
        const dW2 = edgeDelta(part, 'W2', lib, pm)
        const dL1 = edgeDelta(part, 'L1', lib, pm)
        const dL2 = edgeDelta(part, 'L2', lib, pm)
        const Lc = r3(part.length + dW1 + dW2)
        const Wc = r3(part.width + dL1 + dL2)
        // Kitchen-3: an L part's inside edges move by their own band (and pre-mill) along their normals
        const lc = part.shape === 'L' ? lCorner(part) : null
        const dW3 = lc ? lc.nW3 * edgeDelta(part, 'W3', lib, pm) : 0
        const dL3 = lc ? lc.nL3 * edgeDelta(part, 'L3', lib, pm) : 0
        const outline = lc
          ? partOutline(part).map((p) => ({
              x: Math.abs(p.x) < EPS ? 0 : Math.abs(p.x - part.length) < EPS ? Lc : r3(p.x + dW1 + dW3),
              y: Math.abs(p.y) < EPS ? 0 : Math.abs(p.y - part.width) < EPS ? Wc : r3(p.y + dL1 + dL3),
            }))
          : partOutline(part).map((p) => ({
              x: Math.abs(p.x) < EPS ? 0 : Math.abs(p.x - part.length) < EPS ? Lc : r3(p.x + dW1),
              y: Math.abs(p.y) < EPS ? 0 : Math.abs(p.y - part.width) < EPS ? Wc : r3(p.y + dL1),
            }))
        const material = lib.materials.find((m) => m.id === part.materialId)
        if (!material) warnings.push(`${cab.number} ${part.name}: material ${part.materialId} missing from library.`)
        else if (Math.abs(material.thickness - part.thickness) > EPS)
          warnings.push(`${cab.number} ${part.name}: part is ${part.thickness} mm but material ${material.code} is ${material.thickness} mm.`)
        instances.push({
          uid: `${cab.id}#${copy + 1}:${part.key}`,
          no,
          partId: `${job.number}-${String(no).padStart(3, '0')}`,
          cabinetId: cab.id,
          cabinetNumber: cab.qty > 1 ? `${cab.number}.${copy + 1}` : cab.number,
          cabinetName: cab.name,
          part,
          materialId: part.materialId,
          thickness: part.thickness,
          cutLength: Lc,
          cutWidth: Wc,
          ops: shiftOps(part.ops, dW1, dL1, part.length, part.width, Lc, Wc),
          outline,
          canRotate: !(material?.grain && part.grain === 'length'),
        })
      }
    }
  }
  for (const cp of job.camParts ?? []) {
    const blocked = draftBlock(cp)
    if (blocked) {
      warnings.push(`${blocked} It is left out of the cut list and nesting.`)
      continue
    }
    // M3.3: a part turned on a rotary axis is not a sheet part (the export checker refuses the job)
    if (cp.rotary) {
      warnings.push(`Custom part ${cp.name} is turned on a rotary axis. It is left out of the cut list and nesting.`)
      continue
    }
    // M3.4: nor is a part with operations on tilted work planes (3+2): the N-200 cannot tilt its tool
    if (hasTiltedWork(cp)) {
      warnings.push(`Custom part ${cp.name} has operations on tilted work planes (3+2). It is left out of the cut list and nesting.`)
      continue
    }
    // M3.5: nor is a part with simultaneous 5-axis operations: the N-200 has three axes
    if (hasMultiAxisWork(cp)) {
      warnings.push(`Custom part ${cp.name} has simultaneous 5-axis operations. It is left out of the cut list and nesting.`)
      continue
    }
    const material = cp.materialId ? lib.materials.find((m) => m.id === cp.materialId) : undefined
    if (!cp.materialId) warnings.push(`Custom part ${cp.name}: no material chosen, so it cannot be nested.`)
    else if (!material) warnings.push(`Custom part ${cp.name}: material ${cp.materialId} missing from library.`)
    else if (Math.abs(material.thickness - cp.thickness) > EPS)
      warnings.push(`Custom part ${cp.name}: part is ${cp.thickness} mm but material ${material.code} is ${material.thickness} mm.`)
    const outline = toPoints(camOutline(cp).contour, 0.05).map((p) => ({ x: r3(p.x), y: r3(p.y) }))
    const holes = partApertures(cp).map((c) => toPoints(c, 0.05).map((p) => ({ x: r3(p.x), y: r3(p.y) })))
    const part: Part = {
      key: `cam-${cp.id}`,
      name: cp.name,
      role: 'custom',
      materialId: cp.materialId ?? '',
      length: cp.length,
      width: cp.width,
      thickness: cp.thickness,
      grain: cp.grain,
      edges: {},
      ops: [],
      outline,
      frame: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
    }
    for (let copy = 0; copy < Math.max(1, cp.qty); copy++) {
      no += 1
      instances.push({
        uid: `cam:${cp.id}#${copy + 1}`,
        no,
        partId: `${job.number}-${String(no).padStart(3, '0')}`,
        cabinetId: '',
        cabinetNumber: cp.assembly ?? 'Custom',
        cabinetName: cp.name,
        part,
        materialId: part.materialId,
        thickness: cp.thickness,
        cutLength: cp.length,
        cutWidth: cp.width,
        ops: [],
        outline,
        canRotate: !(material?.grain && cp.grain === 'length'),
        cam: cp,
        ...(holes.length ? { holes } : {}),
        ...(cp.priority ? { priority: cp.priority } : {}),
        ...(cp.kit ? { kit: cp.kit } : {}),
      })
    }
  }
  const hardware = [...hw.entries()].map(([code, qty]) => ({
    code,
    name: lib.hardware.find((h) => h.code === code)?.name ?? code,
    qty,
  }))
  return { instances, hardware, warnings }
}

/** The edge keys a part has: the outer four, and L3 and W3 on an L-shaped part (Kitchen-3). */
export function edgeKeysOf(part: Pick<Part, 'shape'>): AnyEdgeKey[] {
  return part.shape === 'L' ? [...EDGE_KEYS, ...INSIDE_EDGE_KEYS] : EDGE_KEYS
}

export function edgeCode(part: Part, lib: Library) {
  const out = {} as EdgeCodes
  for (const k of edgeKeysOf(part)) {
    const id = part.edges[k]
    out[k] = id ? (lib.edgebands.find((e) => e.id === id)?.code ?? id) : ''
  }
  return out
}

/** Compact edge diagram like HOMAG's EdgeDiagram: 1 = banded, 0 = raw, order L1:L2:W1:W2 (then L3:W3 on an L part). */
export function edgeDiagram(part: Part) {
  return edgeKeysOf(part).map((k) => (part.edges[k] ? '1' : '0')).join(':')
}

export function cutList(instances: PartInstance[], lib: Library): CutListRow[] {
  const rows = new Map<string, CutListRow & { cabSet: Set<string> }>()
  for (const inst of instances) {
    const p = inst.part
    const edges = edgeCode(p, lib)
    const key = [inst.materialId, p.name, inst.cutLength, inst.cutWidth, p.length, p.width, edgeKeysOf(p).map((k) => edges[k]).join('|')].join('/')
    const existing = rows.get(key)
    if (existing) {
      existing.qty += 1
      existing.cabSet.add(inst.cabinetNumber)
      continue
    }
    const m = lib.materials.find((mm) => mm.id === inst.materialId)
    rows.set(key, {
      materialId: inst.materialId,
      materialCode: m?.code ?? inst.materialId,
      name: p.name,
      cabinets: '',
      cabSet: new Set([inst.cabinetNumber]),
      finishedLength: p.length,
      finishedWidth: p.width,
      cutLength: inst.cutLength,
      cutWidth: inst.cutWidth,
      thickness: inst.thickness,
      qty: 1,
      edges,
      grain: inst.canRotate ? '' : 'L',
    })
  }
  return [...rows.values()]
    .map(({ cabSet, ...r }) => ({ ...r, cabinets: [...cabSet].join(', ') }))
    .sort((a, b) => a.materialCode.localeCompare(b.materialCode) || b.cutLength * b.cutWidth - a.cutLength * a.cutWidth)
}

/** Edgeband running metres per band, with a per-edge overhang allowance for trimming. */
export function edgebandUsage(instances: PartInstance[], lib: Library, overhangPerEdge = 50) {
  const totals = new Map<string, number>()
  for (const inst of instances) {
    const p = inst.part
    // Kitchen-3: an L part's edges are measured along its outline (two outer edges are stopped by the cut)
    const lens = p.shape === 'L' ? lEdgeLengths(p) : null
    for (const k of edgeKeysOf(p)) {
      const id = p.edges[k]
      if (!id) continue
      const len = (lens ? (lens[k] ?? 0) : k === 'L1' || k === 'L2' ? p.length : p.width) + overhangPerEdge
      totals.set(id, (totals.get(id) ?? 0) + len)
    }
  }
  return [...totals.entries()].map(([id, mm]) => {
    const b = lib.edgebands.find((e) => e.id === id)
    return { id, code: b?.code ?? id, name: b?.name ?? id, metres: Math.round(mm / 10) / 100 }
  })
}

/**
 * Kitchen-3: when the job has L-shaped parts, two more columns follow Edge W2: Edge L3 and Edge W3 (the
 * inside edges; blank on rectangular parts). Without L parts the file is as before.
 */
export function cutListCsv(rows: CutListRow[]) {
  const inside = rows.some((r) => r.edges.L3 !== undefined || r.edges.W3 !== undefined)
  const head = ['Material', 'Part', 'Cabinets', 'Qty', 'Cut L', 'Cut W', 'T', 'Finished L', 'Finished W', 'Edge L1', 'Edge L2', 'Edge W1', 'Edge W2', ...(inside ? ['Edge L3', 'Edge W3'] : []), 'Grain']
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [head.join(',')]
  for (const r of rows)
    lines.push(
      [r.materialCode, r.name, r.cabinets, r.qty, r.cutLength, r.cutWidth, r.thickness, r.finishedLength, r.finishedWidth, r.edges.L1, r.edges.L2, r.edges.W1, r.edges.W2, ...(inside ? [r.edges.L3 ?? '', r.edges.W3 ?? ''] : []), r.grain]
        .map(esc)
        .join(','),
    )
  return lines.join('\r\n') + '\r\n'
}
