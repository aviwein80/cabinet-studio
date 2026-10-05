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
