/**
 * Twenty reference parts for the machining golden tests. Ids are fixed so the stored
 * geometry JSON, toolpath digests and MPR files stay byte-stable.
 */
import { reliefAll, roundedRect } from '../src/cam/geom'
import { makeEntity, newPart } from '../src/cam/doc'
import { arc, circle, line, polyline, pt, rect, regularPolygon, slot } from '../src/cam/geom'
import { defaultOp } from '../src/cam/ops'
import type { CamOp, CamOpKind, CamPart, Entity, FaceId, Geom } from '../src/cam/types'

let n = 0
const E = (g: Geom, layer = 'outline', face: FaceId = 1, extra: Partial<Entity> = {}) => makeEntity(g, layer, face, { id: `e${++n}`, ...extra })
const C = (c: ReturnType<typeof rect>) => ({ t: 'contour' as const, c })
const OP = (kind: CamOpKind, geometry: string[], extra: Partial<CamOp> = {}) => defaultOp(kind, geometry, { id: `op${++n}`, ...extra } as Partial<CamOp>)

function part(id: string, name: string, size: [number, number, number], entities: Entity[], ops: (es: Entity[]) => CamOp[], extra: Partial<CamPart> = {}): CamPart {
  return newPart({ id, name, length: size[0], width: size[1], thickness: size[2], entities, outlineId: entities[0].id, ops: ops(entities), updatedAt: '2026-01-01T00:00:00.000Z', ...extra })
}
const ids = (es: Entity[], ...i: number[]) => i.map((k) => es[k].id)
const lv = (o: Partial<CamOp['levels']>) => ({ levels: { safeZ: 20, rapidZ: 3, depth: 6, through: false, stockZ: 0, passDepth: 0, ...o } })

export function referenceParts(): CamPart[] {
  n = 0
  return [
    part('ref01', 'Rectangle with four holes', [500, 300, 19], [E(C(rect(0, 0, 500, 300))), ...[pt(40, 40), pt(460, 40), pt(460, 260), pt(40, 260)].map((p) => E({ t: 'circle', c: p, r: 4 }, 'holes'))], (es) => [
      OP('drill', ids(es, 1, 2, 3, 4), lv({ depth: 13 })),
      OP('profile', ids(es, 0)),
    ]),
    part('ref02', 'Rounded panel with holding tabs', [600, 400, 18], [E(C(roundedRect(0, 0, 600, 400, 50)))], (es) => [
      OP('profile', ids(es, 0), { tags: { mode: 'auto', count: 4, length: 15, height: 3, shape: 'flat', rampAngle: 30, at: [] } } as Partial<CamOp>),
    ]),
    part('ref03', 'Arched top door', [400, 700, 19], [E(C({ closed: true, segs: [line(pt(0, 0), pt(400, 0)), line(pt(400, 0), pt(400, 600)), arc(pt(400, 600), pt(0, 600), pt(200, 450), true), line(pt(0, 600), pt(0, 0))] }))], (es) => [
      OP('profile', ids(es, 0), { leads: { in: 'line-arc', out: 'line-arc', length: 2, radius: 1.5, rampAngle: 5, overlap: 3, feedPct: 50 } } as Partial<CamOp>),
    ]),
    part('ref04', 'Adjustable shelf side with 32 mm rows', [720, 560, 19], [E(C(rect(0, 0, 720, 560))), ...Array.from({ length: 10 }, (_, i) => E({ t: 'circle', c: pt(100 + i * 32, 37), r: 2.5 }, 'holes')), ...Array.from({ length: 10 }, (_, i) => E({ t: 'circle', c: pt(100 + i * 32, 523), r: 2.5 }, 'holes'))], (es) => [
      OP('drill', es.slice(1).map((e) => e.id), lv({ depth: 12 })),
      OP('profile', ids(es, 0)),
    ]),
    part('ref05', 'Door with hinge cups', [450, 720, 19], [E(C(rect(0, 0, 450, 720))), E({ t: 'circle', c: pt(22.5, 100), r: 17.5 }, 'holes'), E({ t: 'circle', c: pt(22.5, 620), r: 17.5 }, 'holes')], (es) => [
      OP('drill', ids(es, 1, 2), lv({ depth: 13 })),
      OP('profile', ids(es, 0)),
    ]),
    part('ref06', 'Round table top', [800, 800, 25], [E(C(circle(pt(400, 400), 400)))], (es) => [
      OP('profile', ids(es, 0), { leads: { in: 'ramp', out: 'arc', length: 2, radius: 1.5, rampAngle: 4, overlap: 5, feedPct: 50 }, ...lv({ through: true, passDepth: 12 }) } as Partial<CamOp>),
    ]),
    part('ref07', 'Rounded rectangular recess', [400, 300, 19], [E(C(rect(0, 0, 400, 300))), E(C(roundedRect(100, 75, 200, 150, 10)), 'machining')], (es) => [
      OP('pocket', ids(es, 1), lv({ depth: 8 })),
      OP('profile', ids(es, 0)),
    ]),
    part('ref08', 'Free-form pocket with an island', [500, 400, 19], [E(C(rect(0, 0, 500, 400))), E(C(polyline([pt(80, 80), pt(420, 60), pt(440, 300), pt(250, 340), pt(60, 280)], true)), 'machining'), E({ t: 'circle', c: pt(250, 200), r: 40 }, 'machining')], (es) => [
      OP('pocket', ids(es, 1, 2), { ...lv({ depth: 6 }), toolId: 't102' } as Partial<CamOp>),
    ]),
    part('ref09', 'Zig-zag pocket at 45 degrees', [400, 400, 19], [E(C(rect(0, 0, 400, 400))), E(C(rect(50, 50, 300, 200)), 'machining')], (es) => [OP('pocket', ids(es, 1), { pattern: 'zigzag', angle: 45, ...lv({ depth: 4 }), toolId: 't101' } as Partial<CamOp>)]),
    part('ref10', 'Spiral circular pocket', [300, 300, 19], [E(C(rect(0, 0, 300, 300))), E({ t: 'circle', c: pt(150, 150), r: 60 }, 'machining')], (es) => [OP('pocket', ids(es, 1), { pattern: 'spiral', ...lv({ depth: 10, passDepth: 5 }), toolId: 't102' } as Partial<CamOp>)]),
    part('ref11', 'Open line engraving', [400, 200, 19], [E(C(rect(0, 0, 400, 200))), E(C(polyline([pt(20, 20), pt(380, 20), pt(380, 180)], false)), 'machining'), E(C({ closed: false, segs: [arc(pt(50, 100), pt(150, 100), pt(100, 100), false)] }), 'machining')], (es) => [OP('engrave', ids(es, 1, 2), lv({ depth: 1.5 }))]),
    part('ref12', 'Text engraving', [400, 150, 19], [E(C(rect(0, 0, 400, 150))), E({ t: 'text', at: pt(30, 50), text: 'CABINET 12', height: 40, angle: 0 }, 'text')], (es) => [OP('engrave', ids(es, 1), { ...lv({ depth: 1 }), toolId: 't103' } as Partial<CamOp>)]),
    part('ref13', 'V-carved star', [300, 300, 19], [E(C(rect(0, 0, 300, 300))), E(C(star(pt(150, 150), 100, 45)), 'machining')], (es) => [OP('vcarve', ids(es, 1), { step: 2, ...lv({ depth: 8 }) } as Partial<CamOp>)]),
    part('ref14', 'Back panel saw grooves', [600, 400, 18], [E(C(rect(0, 0, 600, 400))), E(C(polyline([pt(0, 20), pt(600, 20)], false)), 'machining'), E(C(polyline([pt(0, 380), pt(600, 380)], false)), 'machining')], (es) => [OP('saw', ids(es, 1, 2), lv({ depth: 8 }))]),
    part('ref15', 'Raised panel sweep', [400, 600, 19], [E(C(rect(0, 0, 400, 600))), E(C(rect(60, 60, 280, 480)), 'machining')], (es) => [
      OP('sweep', ids(es, 1), { step: 3, side: 'inside', section: [{ inset: 0, depth: 10 }, { inset: 30, depth: 3 }, { inset: 32, depth: 0 }], toolId: 't102' } as Partial<CamOp>),
    ]),
    part('ref16', 'Edge drilling on four faces', [600, 300, 19], [E(C(rect(0, 0, 600, 300))), ...([2, 3, 4, 5] as FaceId[]).flatMap((f) => [E({ t: 'circle', c: pt(50, 9.5), r: 4 }, 'holes', f), E({ t: 'circle', c: pt(f === 3 || f === 5 ? 250 : 550, 9.5), r: 4 }, 'holes', f)])], (es) => [
      OP('drill', es.slice(1).map((e) => e.id), lv({ depth: 30 })),
      OP('profile', ids(es, 0)),
    ]),
    part('ref17', 'Deep peck drilling', [300, 200, 38], [E(C(rect(0, 0, 300, 200))), E({ t: 'circle', c: pt(100, 100), r: 4 }, 'holes'), E({ t: 'circle', c: pt(200, 100), r: 4 }, 'holes')], (es) => [
      OP('drill', ids(es, 1, 2), { cycle: 'peck', peck: 10, peckFactor: 0.7, minPeck: 3, retract: 'full', ...lv({ depth: 30 }) } as Partial<CamOp>),
    ]),
    part('ref18', 'Thick top in three cuts with roughing', [700, 500, 38], [E(C(roundedRect(0, 0, 700, 500, 20)))], (es) => [OP('profile', ids(es, 0), { xyPasses: 2, xyStep: 2, stockXY: 0, ...lv({ through: true, cuts: 3 }) } as Partial<CamOp>)]),
    part('ref19', 'Open shapes left, right and on the line', [500, 300, 19], [E(C(rect(0, 0, 500, 300))), E(C(polyline([pt(50, 50), pt(450, 50), pt(450, 250)], false)), 'machining'), E(C(polyline([pt(50, 250), pt(300, 250)], false)), 'machining')], (es) => [
      OP('profile', ids(es, 1), { side: 'left', bidirectional: true, toolId: 't103', leads: { in: 'none', out: 'none', length: 2, radius: 1.5, rampAngle: 5, overlap: 0, feedPct: 50 }, ...lv({ depth: 9, passDepth: 3 }) } as Partial<CamOp>),
      OP('profile', ids(es, 2), { side: 'centre', reverse: true, toolId: 't103', ...lv({ depth: 4 }) } as Partial<CamOp>),
    ]),
    part(
      'ref20',
      'Bracket with relieved slot, holes and operator note',
      [400, 250, 19],
      [E(C(rect(0, 0, 400, 250))), E(C(reliefAll(rect(150, 75, 100, 100), 6, 'tbone-in', 'interior')), 'machining'), E({ t: 'circle', c: pt(60, 125), r: 15 }, 'machining'), E(C(slot(pt(300, 80), pt(300, 170), 20)), 'machining')],
      (es) => [
        OP('code', [], { text: 'Check hold-down before cutting the bracket', stop: true } as Partial<CamOp>),
        OP('profile', ids(es, 2), { side: 'inside', toolId: 't102', leads: { in: 'centre', out: 'none', length: 2, radius: 1.5, rampAngle: 5, overlap: 1, feedPct: 50 }, ...lv({ depth: 5 }) } as Partial<CamOp>),
        OP('profile', ids(es, 0, 1, 2, 3), { order: 'inside-first', side: 'auto', toolId: 't101', ...lv({ through: true }) } as Partial<CamOp>),
      ],
    ),
  ]
}

function star(c: ReturnType<typeof pt>, R: number, r: number) {
  const outer = regularPolygon(c, R, 5, Math.PI / 2)
  const inner = regularPolygon(c, r, 5, Math.PI / 2 + Math.PI / 5)
  const pts = outer.segs.flatMap((s, i) => [s.a, inner.segs[i].a])
  return polyline(pts, true)
}
