/**
 * Reference parts for the M2.6 operations (more 2.5D machining). Ids are fixed so the toolpath
 * digests and MPR files under tests/golden/cam25d stay byte-stable.
 */
import { makeEntity, newPart } from '../src/cam/doc'
import { arc, circle, line, polyline, pt, rect } from '../src/cam/geom'
import { DEFAULT_SAW, defaultOp } from '../src/cam/ops'
import type { CamOp, CamOpKind, CamPart, Entity, FaceId, Geom } from '../src/cam/types'

let n = 0
const E = (g: Geom, layer = 'outline', face: FaceId = 1, extra: Partial<Entity> = {}) => makeEntity(g, layer, face, { id: `e${++n}`, ...extra })
const C = (c: ReturnType<typeof rect>) => ({ t: 'contour' as const, c })
const OP = (kind: CamOpKind, geometry: string[], extra: Partial<CamOp> = {}) => defaultOp(kind, geometry, { id: `op${++n}`, ...extra } as Partial<CamOp>)
const lv = (o: Partial<CamOp['levels']>) => ({ levels: { safeZ: 20, rapidZ: 3, depth: 6, through: false, stockZ: 0, passDepth: 0, ...o } })
const ids = (es: Entity[], ...i: number[]) => i.map((k) => es[k].id)

function part(id: string, name: string, size: [number, number, number], entities: Entity[], ops: (es: Entity[]) => CamOp[]): CamPart {
  return newPart({ id, name, length: size[0], width: size[1], thickness: size[2], entities, outlineId: entities[0].id, ops: ops(entities), updatedAt: '2026-01-01T00:00:00.000Z' })
}

/** Saw cuts (2D-11): three reference parts. */
export function sawParts(): CamPart[] {
  n = 0
  return [
    part(
      'saw01',
      'Back panel grooves joined and extended to clear',
      [600, 400, 18],
      [E(C(rect(0, 0, 600, 400))), E(C(polyline([pt(0, 20), pt(300, 20)], false)), 'machining'), E(C(polyline([pt(300, 20), pt(600, 20)], false)), 'machining'), E(C(polyline([pt(600, 380), pt(0, 380)], false)), 'machining')],
      (es) => [OP('saw', ids(es, 1, 2, 3), { ...lv({ depth: 8 }), saw: { ...DEFAULT_SAW, avoid: false } } as Partial<CamOp>)],
    ),
    part(
      'saw02',
      'Cuts kept inside the part, short line and arc left out',
      [500, 300, 19],
      [E(C(rect(0, 0, 500, 300))), E(C(polyline([pt(0, 150), pt(500, 150)], false)), 'machining'), E(C(polyline([pt(100, 60), pt(130, 60)], false)), 'machining'), E(C({ closed: false, segs: [line(pt(250, 250), pt(400, 250)), arc(pt(400, 250), pt(450, 200), pt(400, 200), false)] }), 'machining')],
      (es) => [OP('saw', ids(es, 1, 2, 3), { ...lv({ depth: 6 }), saw: { ...DEFAULT_SAW, minLength: 50 } } as Partial<CamOp>)],
    ),
    part('saw03', 'Angled cut on the drawn line', [400, 300, 25], [E(C(rect(0, 0, 400, 300))), E(C(polyline([pt(50, 100), pt(350, 100)], false)), 'machining')], (es) => [
      OP('saw', ids(es, 1), { ...lv({ depth: 10 }), saw: { ...DEFAULT_SAW, tilt: 30, tiltSide: 'right', clear: false } } as Partial<CamOp>),
    ]),
  ]
}

/** Facing (2D-16): three reference parts. */
export function faceParts(): CamPart[] {
  n = 100
  return [
    part('face01', 'Faced panel, then a pocket from the new top', [600, 400, 19], [E(C(rect(0, 0, 600, 400))), E(C(rect(200, 120, 200, 160)), 'machining')], (es) => [
      OP('face', [], lv({ depth: 1 })),
      OP('pocket', ids(es, 1), { ...lv({ depth: 5 }), toolId: 't102' } as Partial<CamOp>),
      OP('profile', ids(es, 0), lv({ through: true })),
    ]),
    part('face02', 'Faced area in rings, two passes', [500, 400, 25], [E(C(rect(0, 0, 500, 400))), E(C(rect(100, 100, 300, 200)), 'machining')], (es) => [
      OP('face', ids(es, 1), { pattern: 'offset', ...lv({ depth: 2, passDepth: 1 }), toolId: 't102' } as Partial<CamOp>),
    ]),
    part('face03', 'Round top faced at 30 degrees, top kept', [500, 500, 22], [E(C(circle(pt(250, 250), 250))), E({ t: 'circle', c: pt(250, 250), r: 4 }, 'holes')], (es) => [
      OP('face', [], { angle: 30, resetTop: false, ...lv({ depth: 1.5 }) } as Partial<CamOp>),
      OP('drill', ids(es, 1), lv({ depth: 10 })),
    ]),
  ]
}

const P3 = (pts: [number, number, number][]) => ({ t: 'poly3d' as const, pts })

/** Chamfers (2D-13): three reference parts. */
export function chamferParts(): CamPart[] {
  n = 200
  return [
    part('cham01', 'Panel outline, 3 mm chamfer by width', [500, 300, 19], [E(C(rect(0, 0, 500, 300)))], (es) => [OP('chamfer', ids(es, 0), { size: 3 } as Partial<CamOp>), OP('profile', ids(es, 0), lv({ through: true }))]),
    part('cham02', 'Round opening, 2 mm deep in two cuts, tip lowered', [400, 400, 19], [E(C(rect(0, 0, 400, 400))), E({ t: 'circle', c: pt(200, 200), r: 60 }, 'machining')], (es) => [
      OP('chamfer', ids(es, 1), { side: 'inside', drive: 'depth', size: 2, tipOffset: 0.5, ...lv({ depth: 0, cuts: 2 }) } as Partial<CamOp>),
    ]),
    part(
      'cham03',
      'Level 3D edge of a step and an open edge',
      [400, 300, 25],
      [E(C(rect(0, 0, 400, 300))), E(P3([[100, 100, -6], [300, 100, -6], [300, 200, -6], [100, 200, -6], [100, 100, -6]]), 'edges'), E(C(polyline([pt(20, 280), pt(380, 280)], false)), 'machining')],
      (es) => [OP('chamfer', ids(es, 1), { side: 'inside', size: 2 } as Partial<CamOp>), OP('chamfer', ids(es, 2), { side: 'right', direction: 'conventional', size: 1.5 } as Partial<CamOp>)],
    ),
  ]
}

/** Curve cuts (2D-15): three reference parts per mode. */
export function curveParts(): CamPart[] {
  n = 300
  const between = (extra: Partial<CamOp> = {}) => ({ mode: 'between', toolId: 't105', ...extra }) as Partial<CamOp>
  const follow = (extra: Partial<CamOp> = {}) => ({ mode: 'follow3d', toolId: 't105', ...extra }) as Partial<CamOp>
  const wave = (extra: Partial<CamOp> = {}) => ({ mode: 'zwave', toolId: 't105', ...extra }) as Partial<CamOp>
  return [
    part('btw01', 'Bevel between a line on the face and a line 10 mm down', [300, 200, 25], [E(C(rect(0, 0, 300, 200))), E(C(polyline([pt(50, 50), pt(250, 50)], false)), 'machining'), E(C(polyline([pt(50, 90), pt(250, 90)], false)), 'machining')], (es) => [
      OP('curve', ids(es, 1, 2), between({ depthA: 0, depthB: 10, stepover: 2 })),
    ]),
    part('btw02', 'Cone between two circles', [300, 300, 25], [E(C(rect(0, 0, 300, 300))), E({ t: 'circle', c: pt(150, 150), r: 80 }, 'machining'), E({ t: 'circle', c: pt(150, 150), r: 40 }, 'machining')], (es) => [
      OP('curve', ids(es, 1, 2), between({ depthA: 0, depthB: 8, stepover: 3 })),
    ]),
    part(
      'btw03',
      'Twisted surface between two 3D polylines',
      [300, 200, 30],
      [E(C(rect(0, 0, 300, 200))), E(P3([[40, 40, -2], [140, 60, -6], [260, 40, -3]]), 'edges'), E(P3([[260, 160, -10], [150, 140, -4], [40, 160, -8]]), 'edges')],
      (es) => [OP('curve', ids(es, 1, 2), between({ stepover: 4, zigzag: false }))],
    ),
    part('f3d01', 'Ramp along a 3D polyline', [300, 200, 25], [E(C(rect(0, 0, 300, 200))), E(P3([[30, 30, 0], [150, 30, -4], [150, 170, -8], [270, 170, -2]]), 'edges')], (es) => [OP('curve', ids(es, 1), follow())]),
    part('f3d02', 'Smooth curve through five points, 1 mm below in two cuts', [300, 200, 25], [E(C(rect(0, 0, 300, 200))), E(P3([[20, 100, -1], [80, 160, -3], [150, 100, -5], [220, 40, -3], [280, 100, -1]]), 'edges')], (es) => [
      OP('curve', ids(es, 1), follow({ smooth: true, ...lv({ depth: 1, cuts: 2 }) })),
    ]),
    part('f3d03', 'Closed 3D loop', [300, 300, 25], [E(C(rect(0, 0, 300, 300))), E(P3([[60, 60, -2], [240, 60, -6], [240, 240, -2], [60, 240, -6], [60, 60, -2]]), 'edges')], (es) => [OP('curve', ids(es, 1), follow({ smooth: true }))]),
    part('zw01', 'Sine wave along a straight groove', [400, 200, 25], [E(C(rect(0, 0, 400, 200))), E(C(polyline([pt(20, 100), pt(380, 100)], false)), 'machining')], (es) => [OP('curve', ids(es, 1), wave())]),
    part('zw02', 'Triangle wave round a circle', [300, 300, 25], [E(C(rect(0, 0, 300, 300))), E({ t: 'circle', c: pt(150, 150), r: 100 }, 'machining')], (es) => [
      OP('curve', ids(es, 1), wave({ wave: { min: 0.5, max: 3, length: 50, shape: 'triangle' } })),
    ]),
    part('zw03', 'Deep wave in 2 mm layers round a rectangle', [400, 300, 25], [E(C(rect(0, 0, 400, 300))), E(C(rect(50, 50, 300, 200)), 'machining')], (es) => [
      OP('curve', ids(es, 1), wave({ wave: { min: 1, max: 6, length: 60, shape: 'sine' }, ...lv({ depth: 0, passDepth: 2 }) })),
    ]),
  ]
}
