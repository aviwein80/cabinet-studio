/**
 * Tool against fixtures (M3.6, FIX-01): the cutter, the shank above its flutes and the holder,
 * moving along a straight move with the tool along a fixed direction (or turning, between tilted
 * operations), checked against every clamp, pod and rail of the part. Exact for straight moves:
 * each convex piece of the tool is swept along the move (its swept volume is convex too) and its
 * distance to each convex piece of each fixture found (GJK). Anything nearer than the margin is a
 * collision; the first place along the move where it starts is found by halving.
 *
 * A fixture is never material to be cut: the cutter comes no nearer to it than the margin either.
 *
 * Pure: no DOM, no React.
 */
import type { CutterOutline } from '@/core/machineModel'
import type { FixturePiece } from '../fixtures/fixture'
import type { Cutter } from '../sim'
import type { ToolPiece } from '../stock/tridexel'
import { toolPieces } from '../stock/tridexel'
import { type Aabb, boxesNear, type Convex, distance, frustum, grown, hull2, penetration, swept, type Vec } from './convex'

/** One convex piece of the tool, along its axis from the tip: a frustum rounded by a ball. */
export interface BodyPiece {
  part: 'cutter' | 'shank' | 'holder'
  h0: number
  h1: number
  r0: number
  r1: number
  round: number
}

const ofToolPiece = (p: ToolPiece): Omit<BodyPiece, 'part'> =>
  p.k === 'frustum' ? { h0: p.h0, h1: p.h1, r0: p.r0, r1: p.r1, round: 0 } : p.k === 'sphere' ? { h0: p.c, h1: p.c, r0: 0, r1: 0, round: p.R } : { h0: p.rc, h1: p.rc, r0: p.a, r1: p.a, round: p.rc }

/**
 * The tool as convex pieces: the cutting part up to its flutes, the shank above them to the
 * holder (or to `top` when the stick-out is unknown and there is no holder), the holder's outline
 * with its last radius carried up to `top`.
 */
export function toolBody(c: Cutter, o: CutterOutline | null, top: number): BodyPiece[] {
  const flute = Math.max(1e-6, Math.min(top, c.flute ?? o?.flute ?? top))
  const out: BodyPiece[] = toolPieces(c, flute).map((p) => ({ part: 'cutter' as const, ...ofToolPiece(p) }))
  if (!o) return out
  const gTop = Number.isFinite(o.gauge) ? o.gauge : top
  if (gTop > flute) out.push({ part: 'shank', h0: flute, h1: gTop, r0: o.shankR, r1: o.shankR, round: 0 })
  const h = o.holder
  for (let i = 0; i < h.length; i++) {
    const a = h[i]
    const b = h[i + 1] ?? { z: Math.max(top, a.z + 1), r: a.r }
    if (b.z > a.z) out.push({ part: 'holder', h0: a.z, h1: b.z, r0: a.r, r1: b.r, round: 0 })
  }
  return out
}

/** Longest reach of a body from the tip (for the inflation of a turn). */
export const bodyReach = (b: readonly BodyPiece[]) => Math.max(0, ...b.map((p) => Math.hypot(p.h1, Math.max(p.r0, p.r1)) + p.round))

const at = (p: BodyPiece, P: readonly number[], w: readonly number[]): Convex => frustum(P, w, p.h0, p.h1, p.r0, p.r1, p.round)

/** Box round a convex solid from six support points. */
function boxOf(c: Convex): Aabb {
  return { lo: [c.support([-1, 0, 0])[0], c.support([0, -1, 0])[1], c.support([0, 0, -1])[2]], hi: [c.support([1, 0, 0])[0], c.support([0, 1, 0])[1], c.support([0, 0, 1])[2]] }
}

export interface FixtureHit {
  part: BodyPiece['part']
  /** Index of the fixture (in the list the pieces were made from) and its name. */
  fixture: number
  name: string
  /** Margin less the distance (mm), or the margin plus how far they overlap. */
  depth: number
  /** Share of the move (0..1) where it first comes too near. */
  k: number
}

/** The fixtures' overall box, or null when there are none. */
export function fixturesBox(pieces: readonly FixturePiece[]): Aabb | null {
  if (!pieces.length) return null
  const lo: Vec = [Infinity, Infinity, Infinity]
  const hi: Vec = [-Infinity, -Infinity, -Infinity]
  for (const p of pieces)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p.box.lo[k])
      hi[k] = Math.max(hi[k], p.box.hi[k])
    }
  return { lo, hi }
}

/** How near the swept tool comes, as an intrusion into the margin (null = clear). */
function intrusion(t: Convex, f: Convex, M: number, tol: number): number | null {
  const d = distance(t, f, M)
  if (d >= M - tol) return null
  return d > 1e-9 ? M - d : M + penetration(t, f)
}

/**
 * Collisions of the tool `body` moving from tip `a` to tip `b` along unit direction `w` (or turning
 * from `w` to `w1` on the way: checked in steps of at most `turnStep` degrees, each step the hull
 * of its two ends grown by how far the tool's arc bulges from it) with the fixture pieces.
 * `region`: the fixtures' overall box (skip work far from all of them). One hit per tool part
 * and fixture, with the worst depth and the first place.
 */
export function fixtureHits(pieces: readonly FixturePiece[], region: Aabb | null, body: readonly BodyPiece[], a: readonly number[], b: readonly number[], w: readonly number[], M: number, opts: { w1?: readonly number[]; tol?: number; turnStep?: number } = {}): FixtureHit[] {
  if (!region || !pieces.length || !body.length) return []
  const tol = opts.tol ?? 0.01
  const reach = bodyReach(body)
  // quick reject: the whole tool's reach round both ends
  const lo = [Math.min(a[0], b[0]) - reach, Math.min(a[1], b[1]) - reach, Math.min(a[2], b[2]) - reach] as Vec
  const hi = [Math.max(a[0], b[0]) + reach, Math.max(a[1], b[1]) + reach, Math.max(a[2], b[2]) + reach] as Vec
  if (!boxesNear({ lo, hi }, region, M)) return []
  const delta: Vec = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const w1 = opts.w1
  const turning = !!w1 && Math.abs(w1[0] - w[0]) + Math.abs(w1[1] - w[1]) + Math.abs(w1[2] - w[2]) > 1e-12
  const hits = new Map<string, FixtureHit>()
  const note = (part: BodyPiece['part'], fp: FixturePiece, depth: number, k: number) => {
    const key = `${part}:${fp.fixture}`
    const h = hits.get(key)
    if (!h) hits.set(key, { part, fixture: fp.fixture, name: fp.name, depth, k })
    else {
      h.depth = Math.max(h.depth, depth)
      h.k = Math.min(h.k, k)
    }
  }
  if (!turning) {
    for (const bp of body) {
      const t = swept(at(bp, a, w), delta)
      const tb = boxOf(t)
      for (const fp of pieces) {
        if (!boxesNear(tb, fp.box, M)) continue
        const dep = intrusion(t, fp.c, M, tol)
        if (dep === null) continue
        // the first place: halve the part of the move swept
        let k0 = 0
        let k1 = 1
        if (intrusion(at(bp, a, w), fp.c, M, tol) !== null) k1 = 0
        else
          for (let it = 0; it < 30 && k1 - k0 > 1e-6; it++) {
            const km = (k0 + k1) / 2
            if (intrusion(swept(at(bp, a, w), [delta[0] * km, delta[1] * km, delta[2] * km]), fp.c, M, tol) !== null) k1 = km
            else k0 = km
          }
        note(bp.part, fp, dep, k1)
      }
    }
    return [...hits.values()]
  }
  // turning: steps of at most `turnStep` degrees, each the hull of its two ends, grown by the bulge
  const ang = Math.acos(Math.max(-1, Math.min(1, w[0] * w1![0] + w[1] * w1![1] + w[2] * w1![2])))
  const n = Math.max(1, Math.ceil((ang * 180) / Math.PI / (opts.turnStep ?? 1)))
  const th = ang / n
  const dir = (k: number): Vec => {
    // great-circle turn from w to w1
    if (ang < 1e-12) return [w[0], w[1], w[2]]
    const s = Math.sin(ang)
    const p = Math.sin((1 - k) * ang) / s
    const q = Math.sin(k * ang) / s
    const v: Vec = [w[0] * p + w1![0] * q, w[1] * p + w1![1] * q, w[2] * p + w1![2] * q]
    const l = Math.hypot(v[0], v[1], v[2])
    return [v[0] / l, v[1] / l, v[2] / l]
  }
  const pos = (k: number): Vec => [a[0] + delta[0] * k, a[1] + delta[1] * k, a[2] + delta[2] * k]
  const bulge = (reach * th * th) / 8 + 1e-9
  for (let i = 0; i < n; i++) {
    const k0 = i / n
    const k1 = (i + 1) / n
    const p0 = pos(k0)
    const p1 = pos(k1)
    const d0 = dir(k0)
    const d1 = dir(k1)
    for (const bp of body) {
      const t = grown(hull2(at(bp, p0, d0), at(bp, p1, d1)), bulge)
      const tb = boxOf(t)
      for (const fp of pieces) {
        if (!boxesNear(tb, fp.box, M)) continue
        const dep = intrusion(t, fp.c, M, tol)
        if (dep !== null) note(bp.part, fp, dep, k0)
      }
    }
  }
  return [...hits.values()]
}

/** How a hit reads in a collision message. */
export const fixtureText = (h: Pick<FixtureHit, 'part' | 'name'>) => `${h.part === 'cutter' ? 'cutter' : h.part} hits fixture "${h.name}"`
