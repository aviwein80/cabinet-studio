/**
 * True-shape nesting with no-fit polygons (NFP), our own implementation on Clipper2.
 *
 * For a placed part A and a candidate B, NFP(A, B) is every offset of B that makes B touch A:
 *   (boundary A ⊕ −boundary B) ∪ (A − b0) ∪ (a0 − B)
 * (b0, a0 any points of B and A). Openings in A stay open in its NFP, so B can sit inside them.
 * Parts are inflated by half the spacing first, so touching NFPs leave exactly one spacing.
 *
 * Each part, in order (priority, then size), goes on the first sheet where it fits, at the
 * feasible vertex that keeps the used length of the sheet shortest (then lowest, then leftmost).
 * That fills the sheet from one end and leaves a clean strip for an offcut.
 */
import { checkCancel } from './cancel'
import {
  difference,
  EndType,
  FillRule,
  inflatePaths,
  JoinType,
  minkowskiSum,
  pointInPolygon,
  PointInPolygonResult,
  simplifyPaths,
  union,
  type Path64,
  type Paths64,
} from "clipper2-ts";
import type {
  Bin,
  NestOptions,
  NestPart,
  Placement,
  RawSheet,
} from "./nesting";
import { binQueue, nestCost, partArea } from "./nesting";
import type { Vec2 } from "./types";

/** Clipper units per mm. */
const K = 100;
type Ori = 0 | 90 | 180 | 270;

interface OShape {
  /** Inflated rings, outer positive, openings negative, at orientation origin. */
  paths: Paths64;
  /** Raw (un-inflated) rings for containment tests. */
  rawOuter: Path64;
  rawHoles: Path64[];
  /** Cut-frame footprint bounds after orientation (mm). */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Prepared {
  part: NestPart;
  key: string;
  oris: Ori[];
  shapes: Map<Ori, OShape>;
  area: number;
}

/** Same frame as `placementTransform`: half turn first, then a quarter turn. */
export function orient(p: Vec2, L: number, W: number, o: Ori): Vec2 {
  const flip = o >= 180;
  const x = flip ? L - p.x : p.x;
  const y = flip ? W - p.y : p.y;
  return o % 180 === 90 ? { x: W - y, y: x } : { x, y };
}

const toPath = (pts: Vec2[]): Path64 =>
  pts.map((p) => ({ x: Math.round(p.x * K), y: Math.round(p.y * K) }));
const signedArea = (p: Path64) => {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++)
    a += (p[j].x + p[i].x) * (p[j].y - p[i].y);
  return -a / 2;
};
const withSign = (p: Path64, positive: boolean) =>
  signedArea(p) > 0 === positive ? p : [...p].reverse();
const shift = (paths: Paths64, dx: number, dy: number): Paths64 =>
  paths.map((r) => r.map((q) => ({ x: q.x + dx, y: q.y + dy })));
const negate = (paths: Paths64): Paths64 =>
  paths.map((r) => r.map((q) => ({ x: -q.x, y: -q.y })));

function rectOutline(p: NestPart): Vec2[] {
  return [
    { x: 0, y: 0 },
    { x: p.length, y: 0 },
    { x: p.length, y: p.width },
    { x: 0, y: p.width },
  ];
}

function isRectangular(p: NestPart, outline: Vec2[]) {
  if (p.holes?.length) return false;
  let a = 0;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++)
    a += (outline[j].x + outline[i].x) * (outline[j].y - outline[i].y);
  return (
    Math.abs(Math.abs(a / 2) - p.length * p.width) <= 0.002 * p.length * p.width
  );
}

function prepare(p: NestPart, opt: NestOptions): Prepared {
  const outline =
    p.outline && p.outline.length >= 3 ? p.outline : rectOutline(p);
  const rectangular = isRectangular(p, outline);
  const rotOk = opt.allowRotation && p.canRotate;
  const oris: Ori[] = rectangular
    ? rotOk
      ? [0, 90]
      : [0]
    : rotOk
      ? [0, 90, 180, 270]
      : [0, 180];
  const shapes = new Map<Ori, OShape>();
  // Curves are simplified for speed; the extra inflation covers the simplification.
  const inflate = opt.spacing / 2 + (rectangular ? 0 : 0.35);
  for (const o of oris) {
    const ring = (pts: Vec2[]) =>
      toPath(pts.map((q) => orient(q, p.length, p.width, o)));
    const rawOuter = withSign(
      ring(rectangular ? rectOutline(p) : outline),
      true,
    );
    const rawHoles = rectangular
      ? []
      : (p.holes ?? []).map((h) => withSign(ring(h), false));
    const grown = inflatePaths(
      [rawOuter, ...rawHoles],
      inflate * K,
      JoinType.Miter,
      EndType.Polygon,
      2,
    );
    const paths = rectangular ? grown : simplifyPaths(grown, 0.3 * K, true);
    const fx = o % 180 === 90 ? p.width : p.length;
    const fy = o % 180 === 90 ? p.length : p.width;
    let minX = 0;
    let minY = 0;
    let maxX = fx;
    let maxY = fy;
    for (const q of rawOuter) {
      minX = Math.min(minX, q.x / K);
      minY = Math.min(minY, q.y / K);
      maxX = Math.max(maxX, q.x / K);
      maxY = Math.max(maxY, q.y / K);
    }
    shapes.set(o, { paths, rawOuter, rawHoles, minX, minY, maxX, maxY });
  }
  const key =
    p.shape ??
    `${p.length}x${p.width}|${outline.map((q) => `${q.x},${q.y}`).join(";")}|${(p.holes ?? []).length}`;
  return {
    part: p,
    key: `${key}|${rotOk ? "r" : "n"}`,
    oris,
    shapes,
    area: partArea(p),
  };
}

function nfp(a: OShape, b: OShape): Paths64 {
  const negB = negate(b.paths);
  const parts: Paths64 = [];
  for (const ra of a.paths)
    for (const rb of negB) parts.push(...minkowskiSum(rb, ra, true));
  const b0 = b.paths[0][0];
  const a0 = a.paths[0][0];
  parts.push(...shift(a.paths, -b0.x, -b0.y));
  parts.push(...shift(negB, a0.x, a0.y));
  return union(parts, FillRule.NonZero);
}

/**
 * Where the next part goes: `length` keeps the used length of the sheet shortest (clean end
 * strip), `width` fills low rows first, `box` keeps the used rectangle smallest.
 */
type Gravity = "length" | "width" | "box";

interface Placed {
  prep: Prepared;
  ori: Ori;
  tx: number;
  ty: number;
}

interface SheetState {
  bin: Bin;
  placed: Placed[];
  /** Obstacle union per candidate shape+orientation, and how many placed parts it covers. */
  obs: Map<string, { paths: Paths64; n: number }>;
}

class Engine {
  nfpCache = new Map<string, Paths64>();
  opt: NestOptions;
  constructor(opt: NestOptions) {
    this.opt = opt;
  }

  nfpOf(a: Placed, b: Prepared, ob: Ori) {
    const key = `${a.prep.key}@${a.ori}/${b.key}@${ob}`;
    let v = this.nfpCache.get(key);
    if (!v) {
      v = nfp(a.prep.shapes.get(a.ori)!, b.shapes.get(ob)!);
      this.nfpCache.set(key, v);
    }
    return v;
  }

  obstacles(sh: SheetState, b: Prepared, ob: Ori): Paths64 {
    const key = `${b.key}@${ob}`;
    let cur = sh.obs.get(key);
    if (!cur || cur.n > sh.placed.length) cur = { paths: [], n: 0 };
    if (cur.n < sh.placed.length) {
      const add: Paths64 = [...cur.paths];
      for (let i = cur.n; i < sh.placed.length; i++) {
        const pl = sh.placed[i];
        add.push(...shift(this.nfpOf(pl, b, ob), pl.tx, pl.ty));
      }
      cur = { paths: union(add, FillRule.NonZero), n: sh.placed.length };
      sh.obs.set(key, cur);
    }
    return cur.paths;
  }

  /** Best position for b on this sheet, or null. */
  fit(
    sh: SheetState,
    b: Prepared,
    mode: Gravity,
    along = false,
  ): Placed | null {
    if (along && b.oris.some((o) => o % 180 === 90)) {
      const f = this.fit(
        sh,
        { ...b, oris: b.oris.filter((o) => o % 180 === 0) },
        mode,
      );
      if (f) return { ...f, prep: b };
    }
    const { edgeTrim: trim } = this.opt;
    const extentX = sh.placed.reduce(
      (m, p) => Math.max(m, p.tx / K + p.prep.shapes.get(p.ori)!.maxX),
      0,
    );
    const extentY = sh.placed.reduce(
      (m, p) => Math.max(m, p.ty / K + p.prep.shapes.get(p.ori)!.maxY),
      0,
    );
    let best: { pl: Placed; s: [number, number, number] } | null = null;
    for (const o of b.oris) {
      const s = b.shapes.get(o)!;
      const xlo = Math.round((trim - s.minX) * K);
      const xhi = Math.round((sh.bin.length - trim - s.maxX) * K);
      const ylo = Math.round((trim - s.minY) * K);
      const yhi = Math.round((sh.bin.width - trim - s.maxY) * K);
      if (xhi < xlo || yhi < ylo) continue;
      const ifp: Path64 = [
        { x: xlo - 1, y: ylo - 1 },
        { x: xhi + 1, y: ylo - 1 },
        { x: xhi + 1, y: yhi + 1 },
        { x: xlo - 1, y: yhi + 1 },
      ];
      const free = sh.placed.length
        ? difference([ifp], this.obstacles(sh, b, o), FillRule.NonZero)
        : [ifp];
      for (const ring of free)
        for (const q of ring) {
          const tx = Math.min(xhi, Math.max(xlo, q.x));
          const ty = Math.min(yhi, Math.max(ylo, q.y));
          if (
            (tx !== q.x || ty !== q.y) &&
            sh.placed.length &&
            !this.clear(sh, b, o, tx, ty)
          )
            continue;
          const right = tx / K + s.maxX;
          const top = ty / K + s.maxY;
          const ex = Math.max(extentX, right);
          const sc: [number, number, number] =
            mode === "length"
              ? [
                  Math.round(ex * 100),
                  Math.round(top * 100),
                  Math.round(right * 100),
                ]
              : mode === "width"
                ? [Math.round(top * 100), Math.round(right * 100), 0]
                : [
                    Math.round((ex * Math.max(extentY, top)) / 100),
                    Math.round(right * 100),
                    Math.round(top * 100),
                  ];
          if (
            !best ||
            sc[0] < best.s[0] ||
            (sc[0] === best.s[0] &&
              (sc[1] < best.s[1] || (sc[1] === best.s[1] && sc[2] < best.s[2])))
          )
            best = { pl: { prep: b, ori: o, tx, ty }, s: sc };
        }
    }
    return best?.pl ?? null;
  }

  /** A clamped point must still be outside every obstacle. */
  clear(sh: SheetState, b: Prepared, o: Ori, tx: number, ty: number) {
    const pt = { x: tx, y: ty };
    let inside = false;
    for (const ring of this.obstacles(sh, b, o)) {
      const r = pointInPolygon(pt, ring);
      if (r === PointInPolygonResult.IsOn) return true;
      if (r === PointInPolygonResult.IsInside) inside = !inside;
    }
    return !inside;
  }
}

function toPlacement(p: Placed): Placement {
  const { part } = p.prep;
  const rotated = p.ori % 180 === 90;
  return {
    uid: part.uid,
    x: Math.round((p.tx / K) * 1000) / 1000,
    y: Math.round((p.ty / K) * 1000) / 1000,
    rotated,
    dx: rotated ? part.width : part.length,
    dy: rotated ? part.length : part.width,
    ...(p.ori >= 180 ? { flip: true } : {}),
  };
}

/** Which placed part (if any) has an opening that contains `inner`. */
function hostOf(inner: Placed, others: Placed[]) {
  const s = inner.prep.shapes.get(inner.ori)!;
  const q = s.rawOuter[0];
  for (const h of others) {
    if (h === inner) continue;
    const hs = h.prep.shapes.get(h.ori)!;
    const pt = { x: q.x + inner.tx - h.tx, y: q.y + inner.ty - h.ty };
    if (
      hs.rawHoles.some(
        (ring) => pointInPolygon(pt, ring) === PointInPolygonResult.IsInside,
      )
    )
      return h.prep.part.uid;
  }
  return undefined;
}

type Unit = { kit: string | null; members: Prepared[] };

function units(
  preps: Prepared[],
  keepKits: boolean,
  sizeKey: (p: Prepared) => number,
): Unit[] {
  const out: Unit[] = [];
  const byKit = new Map<string, Unit>();
  for (const p of preps) {
    const k = keepKits ? p.part.kit : undefined;
    if (!k) {
      out.push({ kit: null, members: [p] });
      continue;
    }
    let u = byKit.get(k);
    if (!u) {
      u = { kit: k, members: [] };
      byKit.set(k, u);
      out.push(u);
    }
    u.members.push(p);
  }
  const prio = (u: Unit) =>
    Math.max(...u.members.map((m) => m.part.priority ?? 0));
  const size = (u: Unit) => Math.max(...u.members.map(sizeKey));
  for (const u of out)
    u.members.sort(
      (a, b) => sizeKey(b) - sizeKey(a) || a.part.uid.localeCompare(b.part.uid),
    );
  return out.sort(
    (a, b) =>
      prio(b) - prio(a) ||
      size(b) - size(a) ||
      a.members[0].part.uid.localeCompare(b.members[0].part.uid),
  );
}

function run(
  preps: Prepared[],
  opt: NestOptions,
  sizeKey: (p: Prepared) => number,
  eng: Engine,
  mode: Gravity,
  along: boolean,
) {
  const sheets: SheetState[] = [];
  const queue = binQueue(opt);
  const full: Bin = { length: opt.sheetLength, width: opt.sheetWidth };
  const newSheet = () => {
    const s: SheetState = {
      bin: queue.shift() ?? full,
      placed: [],
      obs: new Map(),
    };
    sheets.push(s);
    return s;
  };
  const placeOne = (p: Prepared) => {
    for (const sh of sheets) {
      const f = eng.fit(sh, p, mode, along);
      if (f) return void sh.placed.push(f);
    }
    for (;;) {
      const sh = newSheet();
      const f = eng.fit(sh, p, mode, along);
      if (f) return void sh.placed.push(f);
      if (!sh.bin.offcutId) {
        sheets.pop();
        return false;
      }
    }
  };
  const placeAll = (sh: SheetState, ms: Prepared[]) => {
    const n = sh.placed.length;
    for (const m of ms) {
      const f = eng.fit(sh, m, mode, along);
      if (!f) {
        sh.placed.length = n;
        sh.obs.clear();
        return false;
      }
      sh.placed.push(f);
    }
    return true;
  };
  let placed = 0;
  for (const u of units(preps, !!opt.keepKits, sizeKey)) {
    checkCancel(opt.isCancelled)
    if (u.kit && u.members.length > 1) {
      let ok = sheets.some((sh) => placeAll(sh, u.members));
      while (!ok && queue.length) ok = placeAll(newSheet(), u.members);
      if (!ok) {
        const sh = newSheet();
        ok = placeAll(sh, u.members);
        if (!ok) sheets.pop();
      }
      if (ok) {
        placed += u.members.length;
        continue;
      }
    }
    for (const m of u.members) if (placeOne(m) !== false) placed++;
  }
  const raw: RawSheet[] = sheets
    .filter((s) => s.placed.length)
    .map((s) => ({
      bin: s.bin,
      area: s.placed.reduce((a, p) => a + p.prep.area, 0),
      placements: s.placed.map((p) => {
        const pl = toPlacement(p);
        const host = hostOf(p, s.placed);
        return host ? { ...pl, inside: host } : pl;
      }),
    }));
  return { sheets: raw, placed };
}

const ORDERS: [string, (p: Prepared) => number][] = [
  ["area", (p) => p.part.length * p.part.width],
  [
    "long-side",
    (p) =>
      Math.max(p.part.length, p.part.width) * 1e6 +
      Math.min(p.part.length, p.part.width),
  ],
  ["true-area", (p) => p.area],
];

export function nestShapes(
  parts: NestPart[],
  opt: NestOptions,
): { sheets: RawSheet[]; placed: number; name: string } {
  const t0 = Date.now();
  const limit = opt.timeLimitMs ?? 8000;
  const eng = new Engine(opt);
  const preps = parts.map((p) => prepare(p, opt));
  let best: {
    sheets: RawSheet[];
    placed: number;
    name: string;
    cost: [number, number, number];
    mode: Gravity;
    key: (p: Prepared) => number;
    along: boolean;
  } | null = null;
  for (const along of [false, true])
    for (const mode of ["length", "width", "box"] as Gravity[])
      for (const [name, key] of ORDERS) {
        if (best && Date.now() - t0 > limit) break;
        const r = run(preps, opt, key, eng, mode, along);
        const cost = nestCost(r.sheets, parts, !!opt.keepKits);
        const better =
          !best ||
          r.placed > best.placed ||
          (r.placed === best.placed &&
            (cost[0] < best.cost[0] ||
              (cost[0] === best.cost[0] &&
                (cost[1] < best.cost[1] ||
                  (cost[1] === best.cost[1] &&
                    cost[2] < best.cost[2] - 1e-6)))));
        if (better)
          best = {
            ...r,
            name: `shape/${mode}/${name}${along ? "/along" : ""}`,
            cost,
            mode,
            key,
            along,
          };
      }
  // Parts left for the last sheet go first next time; this often pulls them back in.
  const boosted = new Set<string>();
  for (
    let round = 0;
    round < 4 && best && best.sheets.length > 1 && Date.now() - t0 <= limit;
    round++
  ) {
    for (const p of best.sheets[best.sheets.length - 1].placements)
      boosted.add(p.uid);
    const base = best.key;
    const key = (p: Prepared) => (boosted.has(p.part.uid) ? 1e15 : 0) + base(p);
    const r = run(preps, opt, key, eng, best.mode, best.along);
    const cost = nestCost(r.sheets, parts, !!opt.keepKits);
    if (
      r.placed === best.placed &&
      (cost[0] < best.cost[0] ||
        (cost[0] === best.cost[0] &&
          (cost[1] < best.cost[1] ||
            (cost[1] === best.cost[1] && cost[2] < best.cost[2] - 1e-6))))
    )
      best = {
        ...r,
        name: `${best.name}+last-first`,
        cost,
        mode: best.mode,
        key,
        along: best.along,
      };
  }
  return best
    ? { sheets: best.sheets, placed: best.placed, name: best.name }
    : { sheets: [], placed: 0, name: "shape/none" };
}
