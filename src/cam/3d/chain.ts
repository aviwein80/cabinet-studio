/**
 * Drop-cutter chains along a 2D path: the tool dropped onto the surface at points along a straight
 * line, refined until the straight moves between the points stay within tolerance of the true
 * tool-centre surface. Shared by parallel finishing (straight passes) and projection finishing
 * (drawn shapes).
 */

export interface Pt {
  x: number
  y: number
  z: number
  ok: boolean
  cut: boolean
  /** On a protected facet group: links must not ride over it. */
  prot: boolean
}

/** Points this close to the straight line through their neighbours are dropped (mm). */
const COLLINEAR = 0.0005

/**
 * Points along `at(t)` for t from t0 to t1, at most `step0` apart, refined where the straight
 * moves between them would leave the tool-centre surface by more than `tol` (or sink below it by
 * more than `gougeTol`), and where cutting starts or stops.
 */
export function refineAlong(at: (t: number) => Pt, t0: number, t1: number, step0: number, tol: number, gougeTol: number): Pt[] {
  const pts: Pt[] = []
  const n = Math.max(1, Math.ceil((t1 - t0) / step0))
  let prev = at(t0)
  let prevT = t0
  pts.push(prev)
  const refine = (pa: Pt, ta: number, pb: Pt, tb: number, depth: number) => {
    const tm = (ta + tb) / 2
    const m = at(tm)
    const mixed = pa.cut !== pb.cut || m.cut !== pa.cut
    let deeper = false
    if (mixed) deeper = depth < 7
    else if (pa.cut && depth < 9) {
      const lin = (pa.z + pb.z) / 2
      deeper = m.z - lin > gougeTol || Math.abs(m.z - lin) > tol
      // A kink in the tool-centre surface can hide from the midpoint. Where the midpoint is
      // not clearly straight, or the pass is steep, test the quarter points too.
      const len = Math.abs(tb - ta)
      if (!deeper && (Math.abs(m.z - lin) > gougeTol / 8 || Math.abs(pb.z - pa.z) > 0.5 * len)) {
        for (const f of [0.25, 0.75]) {
          const q = at(ta + (tb - ta) * f)
          if (q.cut && q.z - (pa.z + (pb.z - pa.z) * f) > gougeTol) deeper = true
        }
      }
    }
    if (!deeper) {
      if (mixed || pa.cut) pts.push(m)
      return
    }
    refine(pa, ta, m, tm, depth + 1)
    pts.push(m)
    refine(m, tm, pb, tb, depth + 1)
  }
  for (let i = 1; i <= n; i++) {
    const t = i === n ? t1 : t0 + ((t1 - t0) * i) / n
    const p = at(t)
    if (prev.cut || p.cut) refine(prev, prevT, p, t, 0)
    pts.push(p)
    prev = p
    prevT = t
  }
  return pts
}

/** The runs of cutting points (at least two each), with nearly collinear points dropped. */
export function cutChains(pts: Pt[]): Pt[][] {
  const chains: Pt[][] = []
  let cur: Pt[] = []
  for (const p of pts) {
    if (p.cut) cur.push(p)
    else if (cur.length) {
      chains.push(cur)
      cur = []
    }
  }
  if (cur.length) chains.push(cur)
  return chains.filter((c) => c.length >= 2).map(simplify)
}

/** Drop points that lie within `COLLINEAR` of the straight line through the kept neighbours. */
export function simplify(c: Pt[]): Pt[] {
  if (c.length <= 2) return c
  const out: Pt[] = [c[0]]
  let anchor = 0
  for (let i = 2; i < c.length; i++) {
    const a = c[anchor]
    const b = c[i]
    let ok = i - anchor <= 64
    for (let k = anchor + 1; ok && k < i; k++) if (dist3ToSeg(c[k], a, b) > COLLINEAR) ok = false
    if (!ok) {
      out.push(c[i - 1])
      anchor = i - 1
    }
  }
  out.push(c[c.length - 1])
  return out
}

function dist3ToSeg(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z
  const l2 = dx * dx + dy * dy + dz * dz
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / l2)) : 0
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y, a.z + dz * t - p.z)
}
