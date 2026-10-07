/**
 * Positional (3+2) test fixtures (M3.4): a 120 x 100 x 60 mm test block whose blank has a 45°
 * chamfer along the right top edge, a 30° chamfer along the front top edge and a corner cut at
 * the back left (a compound angle: 54.7° tilted towards 135°), with holes and pockets on four
 * tilted planes (the two chamfers, the corner facet and the upright back side; its features sit
 * high enough for the placeholder holder, 64 mm across, to clear the table). Three test
 * machines with two rotary axes (not machines in the shop): a fork head C/B without tip control,
 * a trunnion table A/C, and a rotary table C with a tilting head B with tip control.
 */
import { makeEntity, newPart } from '@/cam/doc'
import { circle, roundedRect } from '@/cam/geom'
import { defaultOp } from '@/cam/ops'
import { nextTiltedSpot, planeFromFace, sidePlane } from '@/cam/positional/frame'
import type { HalfSpace } from '@/cam/stock/tridexel'
import type { CamOp, CamPart, DrillOp, Entity, PocketOp, TiltedPlane } from '@/cam/types'
import { PLACEHOLDER_N200_MODEL } from '@/core/machineModel'
import { PLACEHOLDER_MACHINE } from '@/core/defaults'
import type { MachineProfile, PositionalKinematics } from '@/core/types'

export const BLOCK = { length: 120, width: 100, thickness: 60 }
const S2 = Math.SQRT1_2
const S3 = 1 / Math.sqrt(3)

/** The blank: the block less its chamfers and corner (n·p <= d). */
export const BLANK: HalfSpace[] = [
  // 45° along the right top edge: x + z <= 100
  { n: [S2, 0, S2], d: 100 * S2 },
  // 30° along the front top edge, from (y 0, z -15) up to the top
  { n: [0, -0.5, Math.cos(Math.PI / 6)], d: Math.cos(Math.PI / 6) * -15 },
  // the back-left corner: -x + y + z <= 55
  { n: [-S3, S3, S3], d: 55 * S3 },
]

/** A designed hole: centre on the plane (plane x, y), diameter, depth below the plane. */
export interface HoleDesign {
  plane: string
  x: number
  y: number
  d: number
  depth: number
}
/** A designed pocket: a rounded rectangle (or circle when w = h = 2r) on the plane, depth below it. */
export interface PocketDesign {
  plane: string
  cx: number
  cy: number
  w: number
  h: number
  r: number
  depth: number
}

export const HOLES: HoleDesign[] = [
  { plane: 'right', x: 30, y: 14, d: 8, depth: 12 },
  { plane: 'right', x: 80, y: 14, d: 8, depth: 12 },
  { plane: 'front', x: 75, y: 15, d: 6, depth: 10 },
  { plane: 'corner', x: 0, y: 0, d: 8, depth: 15 },
  { plane: 'back', x: 60, y: 40, d: 8, depth: 20 },
]
export const POCKETS: PocketDesign[] = [
  { plane: 'right', cx: 55, cy: 14, w: 16, h: 16, r: 8, depth: 5 },
  { plane: 'front', cx: 35, cy: 15, w: 40, h: 14, r: 4, depth: 6 },
  { plane: 'back', cx: 30, cy: 42, w: 30, h: 16, r: 5, depth: 4 },
]

/** The test block part: its tilted planes, shapes and operations (T102 Ø8 holes, T103 Ø6 pockets and Ø6 hole). */
export function blockPart(opts: { ops?: 'all' | 'holes' | 'pockets' } = {}): { part: CamPart; planes: Record<string, TiltedPlane> } {
  let part = newPart({ id: 'block32', name: 'Test block (3+2)', ...BLOCK, entities: [], ops: [] })
  const planes: Record<string, TiltedPlane> = {}
  const add = (id: string, name: string, fields: Pick<TiltedPlane, 'origin' | 'tilt' | 'toward' | 'spin' | 'size'>, from: TiltedPlane['from']) => {
    const p: TiltedPlane = { id, name, ...fields, at: nextTiltedSpot(part), from }
    part = { ...part, tilted: [...(part.tilted ?? []), p] }
    planes[id] = p
  }
  add('right', '45° chamfer', { origin: { x: 120, y: 0, z: -20 }, tilt: 45, toward: 0, spin: 0, size: { x: 100, y: 20 / S2 } }, 'angles')
  add('front', '30° chamfer', { origin: { x: 0, y: 0, z: -15 }, tilt: 30, toward: -90, spin: 0, size: { x: 120, y: 30 } }, 'angles')
  const corner = planeFromFace([-1, 1, 1], [
    [45, 100, 0],
    [0, 55, 0],
    [0, 100, -45],
  ])
  if ('error' in corner) throw new Error(corner.error)
  add('corner', 'Corner facet', corner.fields, 'face')
  add('back', 'Back side', sidePlane(BLOCK, 'back'), 'side')
  // the corner hole at the facet's centroid (part 15, 85, -15) in the plane's own x, y
  const c = planes.corner
  const cen = [15 - c.origin.x, 85 - c.origin.y, -15 - c.origin.z]
  const tilt = (c.tilt * Math.PI) / 180
  const tw = (c.toward * Math.PI) / 180
  // x level along k, y up the slope (see frame.ts)
  const kx = [-Math.sin(tw), Math.cos(tw), 0]
  const ky = [-Math.cos(tilt) * Math.cos(tw), -Math.cos(tilt) * Math.sin(tw), Math.sin(tilt)]
  HOLES[3].x = cen[0] * kx[0] + cen[1] * kx[1] + cen[2] * kx[2]
  HOLES[3].y = cen[0] * ky[0] + cen[1] * ky[1] + cen[2] * ky[2]
  const ents: Entity[] = []
  const ops: CamOp[] = []
  const holeIds: Record<string, Record<number, string[]>> = {}
  HOLES.forEach((h, i) => {
    const p = planes[h.plane]
    const e = makeEntity({ t: 'circle', c: { x: p.at.x + h.x, y: p.at.y + h.y }, r: h.d / 2 }, 'holes', 1, { id: `h${i}` })
    ents.push(e)
    ;((holeIds[h.plane] ??= {})[h.d] ??= []).push(e.id)
  })
  POCKETS.forEach((k, i) => {
    const p = planes[k.plane]
    const x = p.at.x + k.cx
    const y = p.at.y + k.cy
    const g = k.w === k.h && k.r * 2 === k.w ? circle({ x, y }, k.r) : roundedRect(x - k.w / 2, y - k.h / 2, k.w, k.h, k.r)
    ents.push(makeEntity({ t: 'contour', c: g }, 'machining', 1, { id: `k${i}` }))
  })
  if (opts.ops !== 'pockets')
    for (const [plane, byD] of Object.entries(holeIds))
      for (const [d, ids] of Object.entries(byD)) {
        const h = HOLES.find((x) => x.plane === plane && x.d === Number(d))!
        ops.push({ ...(defaultOp('drill', ids) as DrillOp), id: `drill-${plane}-${d}`, name: `Holes Ø${d} (${planes[plane].name})`, toolId: Number(d) === 8 ? 't102' : 't103', tiltedPlane: plane, levels: { safeZ: 20, rapidZ: 3, depth: h.depth, through: false, stockZ: 0, passDepth: 0 } })
      }
  if (opts.ops !== 'holes')
    POCKETS.forEach((k, i) => {
      ops.push({ ...(defaultOp('pocket', [`k${i}`]) as PocketOp), id: `pocket-${k.plane}-${i}`, name: `Pocket ${i + 1} (${planes[k.plane].name})`, toolId: 't103', tiltedPlane: k.plane, entry: 'helix', levels: { safeZ: 20, rapidZ: 3, depth: k.depth, through: false, stockZ: 0, passDepth: 3 } })
    })
  // the corner hole needs its own depth (15) on its own plane
  part = { ...part, entities: ents, ops }
  return { part, planes }
}

/** A test machine with two rotary axes for 3+2 (not a machine in the shop). */
export function machine32(layout: PositionalKinematics['layout'], first: 'A' | 'B' | 'C', second: 'A' | 'B' | 'C', extra: Partial<PositionalKinematics> = {}, travel: Record<string, [number, number]> = {}): MachineProfile {
  const t = { X: [-2000, 4000], Y: [-2000, 3000], Z: [-1500, 1500], A: [-120, 120], B: [-120, 120], C: [-360, 360], ...travel } as Record<string, [number, number]>
  const kin: PositionalKinematics = { layout, first, second, pivot: 150, centre: { x: 500, y: 400, z: -150 }, partAt: { x: 440, y: 350, z: -60 }, tcp: false, ...extra }
  return {
    ...structuredClone(PLACEHOLDER_MACHINE),
    name: `Test 5-axis router (${layout} ${first}/${second})`,
    model: `Test ${layout} ${first}${second}`,
    physical: {
      ...structuredClone(PLACEHOLDER_N200_MODEL),
      placeholder: false,
      axes: [...(['X', 'Y', 'Z'] as const).map((id) => ({ id, min: t[id][0], max: t[id][1] })), { id: first, min: t[first][0], max: t[first][1] }, { id: second, min: t[second][0], max: t[second][1] }],
      capabilities: { ...PLACEHOLDER_N200_MODEL.capabilities, positional: true },
      positional: kin,
    },
  }
}

export const MACHINES_32 = (): MachineProfile[] => [machine32('head-head', 'C', 'B'), machine32('table-table', 'A', 'C'), machine32('table-head', 'C', 'B', { tcp: true })]

/** Ops by id. */
export const opById = (part: CamPart, id: string) => part.ops.find((o) => o.id === id)!
