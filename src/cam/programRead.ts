/**
 * Reading a program back (M2.10, NEW-22): G-code, or our own woodWOP MPR, into toolpaths (the one
 * toolpath IR) for the backplot and the simulator, one toolpath per tool change.
 *
 * G-code: G0/G1/G2/G3 (I/J relative or absolute, or R), G17 plane, G20/G21, G90/G91, canned
 * drilling G81/G82/G83 with G98/G99 and G80, T/M6 tool changes, S, F, comments in brackets or
 * after ";", line numbers, "%" and block-delete lines. Anything the reader does not follow is
 * listed (warnings) or, where the drawing would be wrong, refused (errors): arcs in other planes,
 * coordinate shifts (G92), incremental drilling cycles. Cutter compensation (G41/G42) is the
 * controller's job, so a program using it is drawn on the programmed line with a warning.
 *
 * MPR: our own macros (`readMpr`) become moves: contour milling with its radius correction applied
 * (the tool centre is offset by the tool radius), vertical and horizontal drilling, rectangular
 * pockets and saw grooves. woodWOP's own approach and leave moves are not known exactly; they are
 * drawn as a straight plunge and lift (warned).
 *
 * Z: G-code Z is read as measured from the top of the stock unless `zTop` says where the top is.
 * MPR depths are converted from woodWOP's (height above the table) to ours (below the top).
 */
import type { MachineProfile, Tool } from '@/core/types'
import type { Contour, P, Seg } from './geom'
import { offsetChain } from './kernel'
import { RAPID_RATE } from './moves'
import { readMpr, type MprDoc, type MprMacro } from './mprRead'
import type { Move, Toolpath } from './toolpath'

export interface ReadProgram {
  format: 'gcode' | 'mpr'
  toolpaths: Toolpath[]
  /** The stock: as the MPR workpiece states it, or as far as the G-code's cutting moves reach. */
  stock: { length: number; width: number; thickness: number; fromProgram: boolean }
  warnings: string[]
  errors: string[]
  lines: number
}

const SAFE_Z = 20
const r6 = (n: number) => Math.round(n * 1e6) / 1e6

/** Is this text an MPR program (otherwise it is read as G-code)? */
export const isMprText = (text: string) => /^\s*\[H\s*$/m.test(text.slice(0, 4000)) && /^<\d+ \\/m.test(text)

function toolByNumber(machine: Pick<MachineProfile, 'tools'> | undefined, n: number | undefined): Tool | null {
  if (n === undefined || !Number.isFinite(n)) return null
  return machine?.tools.find((t) => t.number === n) ?? null
}

function statsOf(tp: Pick<Toolpath, 'moves' | 'feeds'>): Toolpath['stats'] {
  let cut = 0
  let rapid = 0
  let minutes = 0
  let at = { x: 0, y: 0, z: SAFE_Z }
  for (const m of tp.moves) {
    if (m.t === 'poly') continue
    const l = Math.hypot(m.x - at.x, m.y - at.y, m.z - at.z)
    if (m.t === 'rapid') {
      rapid += l
      minutes += l / RAPID_RATE
    } else if (m.t === 'drill') {
      const d = Math.abs(m.r - m.z) * 2
      cut += d
      minutes += d / Math.max(1, tp.feeds.plunge)
    } else {
      cut += l
      minutes += l / Math.max(1, (m.t === 'feed' && m.f === 'plunge' ? tp.feeds.plunge : tp.feeds.feed) * (m.k ?? 1))
    }
    at = { x: m.x, y: m.y, z: m.t === 'drill' ? m.r : m.z }
  }
  return { cut: r6(cut), rapid: r6(rapid), minutes: r6(minutes) }
}

function newPath(n: number, name: string, tool: Tool | null, toolNumber: number | undefined, rpm: number): Toolpath {
  return {
    opId: `read-${n}`,
    kind: 'profile',
    name,
    tool,
    feeds: { rpm, feed: 0, plunge: 0 },
    moves: [],
    intents: [],
    warnings: tool || toolNumber === undefined ? [] : [`Tool ${toolNumber} is not in the tool table; drawn with a 6 mm cutter.`],
    stats: { cut: 0, rapid: 0, minutes: 0 },
  }
}

/** Settle feeds (the first cutting and plunging rates; the rest as factors), kind and stats. */
function finish(tp: Toolpath, rates: number[]): Toolpath {
  const cutRates = tp.moves.map((m, i) => (m.t === 'feed' && m.f !== 'plunge') || m.t === 'arc' ? rates[i] : NaN).filter((f) => f > 0)
  const plungeRates = tp.moves.map((m, i) => (m.t === 'feed' && m.f === 'plunge') || m.t === 'drill' ? rates[i] : NaN).filter((f) => f > 0)
  const feed = cutRates[0] ?? plungeRates[0] ?? 1000
  const plunge = plungeRates[0] ?? feed
  tp.feeds = { ...tp.feeds, feed, plunge }
  tp.moves = tp.moves.map((m, i) => {
    if (m.t !== 'feed' && m.t !== 'arc') return m
    const base = m.t === 'feed' && m.f === 'plunge' ? plunge : feed
    const f = rates[i] > 0 ? rates[i] : base
    return Math.abs(f / base - 1) > 1e-12 ? { ...m, k: f / base } : m
  })
  if (tp.moves.length && tp.moves.every((m) => m.t === 'drill' || m.t === 'rapid')) tp.kind = 'drill'
  tp.stats = statsOf(tp)
  return tp
}

// ---------------------------------------------------------------------------------------------
// G-code
// ---------------------------------------------------------------------------------------------

export interface GcodeOptions {
  machine?: Pick<MachineProfile, 'tools'>
  /** Program Z of the stock's top (default 0: Z0 is the top). */
  zTop?: number
}

const WORD = /([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g

/**
 * One line of G-code as words: comments ("( ... )", brackets inside a comment kept with it, and
 * "; ..."), the letter-number words, and anything left that is not a word (`rest`). `skip`: an
 * empty line, "%" or a block-delete line.
 */
export function gcodeLine(raw: string): { words: [string, number][]; comments: string[]; rest: string; skip: boolean } {
  const comments: string[] = []
  let s = ''
  let depth = 0
  let com = ''
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (depth === 0 && ch === ';') {
      comments.push(raw.slice(i + 1).trim())
      break
    }
    if (ch === '(') {
      if (depth++ > 0) com += ch
    } else if (ch === ')' && depth > 0) {
      if (--depth > 0) com += ch
      else {
        comments.push(com.trim())
        com = ''
        s += ' '
      }
    } else if (depth > 0) com += ch
    else s += ch
  }
  if (depth > 0) comments.push(com.trim())
  s = s.trim().toUpperCase()
  if (!s || s === '%' || s.startsWith('/')) return { words: [], comments, rest: '', skip: true }
  const words: [string, number][] = []
  const rest = s.replace(WORD, (_m, l: string, v: string) => (words.push([l, Number(v)]), '')).replace(/\s+/g, '')
  return { words, comments, rest, skip: false }
}

export function readGcode(text: string, opts: GcodeOptions = {}): ReadProgram {
  const zTop = opts.zTop ?? 0
  const warnings: string[] = []
  const errors: string[] = []
  const once = new Set<string>()
  const warnOnce = (key: string, msg: string) => {
    if (once.has(key)) return
    once.add(key)
    warnings.push(msg)
  }
  const lines = text.split(/\r?\n/)
  const hasM6 = /(^|[^0-9.])M0*6(?![0-9])/i.test(text.replace(/\([^)]*\)|;.*$/gm, ''))
  let scale = 1
  let abs = true
  let arcAbs = false
  let plane = 17
  let motion: 'G0' | 'G1' | 'G2' | 'G3' | null = null
  let cycle: 'G81' | 'G82' | 'G83' | null = null
  let retract: 'G98' | 'G99' = 'G98'
  let cyc = { r: 0, z: 0, q: 0, p: 0 }
  let feed = 0
  let rpm = 0
  let selected: number | undefined
  const at = { x: 0, y: 0, z: SAFE_Z + zTop }
  const paths: Toolpath[] = []
  const rates: number[][] = []
  let cur: Toolpath | null = null
  let curRates: number[] = []
  let lastComment = ''
  let toolNumber: number | undefined
  let tool: Tool | null = null
  let ended = false

  const startPath = () => {
    if (cur && cur.moves.length) {
      paths.push(cur)
      rates.push(curRates)
    }
    cur = newPath(paths.length + 1, lastComment || (toolNumber !== undefined ? `T${toolNumber}${tool ? ` ${tool.name}` : ''}` : 'Program'), tool, toolNumber, rpm)
    curRates = []
    lastComment = ''
  }
  const push = (m: Move, rate = 0) => {
    if (!cur) startPath()
    const c = cur!
    if (!c.moves.length && lastComment && /^(T\d+|Program)/.test(c.name)) {
      c.name = lastComment
      lastComment = ''
    }
    c.moves.push(m)
    curRates.push(rate)
  }

  lines.forEach((raw, idx) => {
    if (ended) {
      if (raw.trim() && raw.trim() !== '%') warnOnce('after-end', `Lines after the program end (M30 / M2) were not read (from line ${idx + 1}).`)
      return
    }
    const ln = idx + 1
    const line = gcodeLine(raw)
    if (line.comments.length && line.comments.some(Boolean)) lastComment = line.comments.filter(Boolean).join(' ')
    if (line.skip) return
    if (line.rest) {
      errors.push(`Line ${ln}: cannot read "${line.rest}".`)
      return
    }
    const words = line.words
    const val = (l: string) => {
      const w = words.filter(([k]) => k === l)
      return w.length ? w[w.length - 1][1] : undefined
    }
    const gs = words.filter(([k]) => k === 'G').map(([, v]) => v)
    const ms = words.filter(([k]) => k === 'M').map(([, v]) => v)
    let motionThisLine = false
    for (const g of gs) {
      const k = Math.round(g * 10) / 10
      if (k === 0 || k === 1 || k === 2 || k === 3) {
        motion = `G${k}` as typeof motion
        cycle = null
        motionThisLine = true
      } else if (k === 17 || k === 18 || k === 19) plane = k
      else if (k === 20) scale = 25.4
      else if (k === 21) scale = 1
      else if (k === 90) abs = true
      else if (k === 91) abs = false
      else if (k === 90.1) arcAbs = true
      else if (k === 91.1) arcAbs = false
      else if (k === 80) cycle = null
      else if (k === 81 || k === 82 || k === 83) {
        cycle = `G${k}` as typeof cycle
        motion = null
        motionThisLine = true
      } else if (k === 98 || k === 99) retract = `G${k}` as typeof retract
      else if (k === 40 || k === 43 || k === 49 || k === 94 || k === 64 || k === 61) {
        // cancel compensation, tool length, feed per minute, path modes: nothing to draw
      } else if (k === 41 || k === 42) warnOnce('comp', `Line ${ln}: cutter radius compensation (G${k}) is done by the controller; the backplot follows the programmed line, which is off by the tool radius.`)
      else if (k === 4) {
        // dwell
      } else if (k >= 54 && k <= 59.3) warnOnce(`g${k}`, `Line ${ln}: work offset G${k} is ignored; all coordinates are drawn from one origin.`)
      else if (k === 92 || k === 52) {
        errors.push(`Line ${ln}: G${k} shifts the coordinate system; not supported.`)
        return
      }
      else if (k === 28 || k === 53) warnOnce(`g${k}`, `Line ${ln}: G${k} (machine position) moves are not drawn.`)
      else warnOnce(`g${k}`, `Line ${ln}: G${k} is not known to this reader; ignored.`)
    }
    const F = val('F')
    if (F !== undefined) feed = F * scale
    const S = val('S')
    if (S !== undefined) rpm = S
    const T = val('T')
    if (T !== undefined) selected = Math.round(T)
    const change = ms.some((m) => m === 6) || (!hasM6 && T !== undefined)
    if (change) {
      if (selected === undefined) warnings.push(`Line ${ln}: tool change without a tool number.`)
      toolNumber = selected
      tool = toolByNumber(opts.machine, toolNumber)
      startPath()
    } else if (S !== undefined && cur && !(cur as Toolpath).moves.length) (cur as Toolpath).feeds.rpm = rpm
    if (ms.some((m) => m === 30 || m === 2)) ended = true
    if (ms.some((m) => m === 0 || m === 1)) warnings.push(`Line ${ln}: program stop (M${ms.find((m) => m === 0 || m === 1)}).`)
    if (gs.some((g) => g === 28 || g === 53)) return

    const X = val('X')
    const Y = val('Y')
    const Z = val('Z')
    const hasXYZ = X !== undefined || Y !== undefined || Z !== undefined
    const target = (v: number | undefined, cur0: number) => (v === undefined ? cur0 : abs ? v * scale : cur0 + v * scale)

    if (cycle && (hasXYZ || motionThisLine)) {
      if (!abs) {
        errors.push(`Line ${ln}: incremental drilling cycles (G91 with ${cycle}) are not supported.`)
        return
      }
      const R = val('R')
      const Q = val('Q')
      const Pv = val('P')
      if (R !== undefined) cyc.r = R * scale
      if (Z !== undefined) cyc.z = Z * scale
      if (Q !== undefined) cyc.q = Q * scale
      if (Pv !== undefined) cyc.p = Pv
      if (motionThisLine && (R === undefined || Z === undefined)) errors.push(`Line ${ln}: ${cycle} needs R and Z.`)
      const x = X === undefined ? at.x : X * scale
      const y = Y === undefined ? at.y : Y * scale
      const initial = at.z
      push({ t: 'drill', x: r6(x), y: r6(y), z: r6(cyc.z - zTop), r: r6(cyc.r - zTop), peck: cycle === 'G83' ? r6(cyc.q) : 0, dwell: cycle === 'G82' ? cyc.p : 0 }, feed)
      cur!.intents.push({ k: 'vdrill', x: r6(x), y: r6(y), d: tool?.diameter ?? 5, depth: r6(zTop - cyc.z), through: false, tool, label: cur!.name })
      at.x = x
      at.y = y
      at.z = retract === 'G98' ? Math.max(initial, cyc.r) : cyc.r
      return
    }
    if (!hasXYZ || !motion) {
      if (hasXYZ && !motion) errors.push(`Line ${ln}: coordinates without a motion (G0/G1/G2/G3).`)
      return
    }
    const x = target(X, at.x)
    const y = target(Y, at.y)
    const z = target(Z, at.z)
    if (motion === 'G0') push({ t: 'rapid', x: r6(x), y: r6(y), z: r6(z - zTop) })
    else if (motion === 'G1') {
      if (!(feed > 0)) warnOnce('nofeed', `Line ${ln}: a cutting move without a feed rate (F).`)
      const plunge = Math.abs(x - at.x) < 1e-9 && Math.abs(y - at.y) < 1e-9 && z < at.z
      push({ t: 'feed', x: r6(x), y: r6(y), z: r6(z - zTop), f: plunge ? 'plunge' : 'cut' }, feed)
    } else {
      if (plane !== 17) {
        errors.push(`Line ${ln}: arcs in the ${plane === 18 ? 'XZ' : 'YZ'} plane (G${plane}) are not supported.`)
        return
      }
      const ccw = motion === 'G3'
      let c: P
      const R = val('R')
      const I = val('I')
      const J = val('J')
      if (R !== undefined && I === undefined && J === undefined) {
        const r = Math.abs(R * scale)
        const dx = x - at.x
        const dy = y - at.y
        const d = Math.hypot(dx, dy)
        if (d < 1e-9) {
          errors.push(`Line ${ln}: a full circle cannot be given with R.`)
          return
        }
        if (d / 2 > r + 1e-6) {
          errors.push(`Line ${ln}: arc radius ${R} is smaller than half the distance between its ends.`)
          return
        }
        const h = Math.sqrt(Math.max(0, r * r - (d * d) / 4))
        // R > 0: the shorter arc; R < 0: the longer one
        const side = (ccw ? 1 : -1) * (R > 0 ? 1 : -1)
        c = { x: (at.x + x) / 2 - (dy / d) * h * side, y: (at.y + y) / 2 + (dx / d) * h * side }
      } else {
        if (I === undefined && J === undefined) {
          errors.push(`Line ${ln}: an arc needs I/J or R.`)
          return
        }
        c = arcAbs ? { x: (I ?? 0) * scale, y: (J ?? 0) * scale } : { x: at.x + (I ?? 0) * scale, y: at.y + (J ?? 0) * scale }
      }
      const r0 = Math.hypot(at.x - c.x, at.y - c.y)
      const r1 = Math.hypot(x - c.x, y - c.y)
      if (Math.abs(r0 - r1) > 0.01) warnings.push(`Line ${ln}: the arc's end is ${Math.abs(r0 - r1).toFixed(3)} mm off its circle.`)
      push({ t: 'arc', x: r6(x), y: r6(y), z: r6(z - zTop), cx: c.x, cy: c.y, ccw, f: 'cut' }, feed)
    }
    at.x = x
    at.y = y
    at.z = z
  })
  if (cur && (cur as Toolpath).moves.length) {
    paths.push(cur)
    rates.push(curRates)
  }
  const toolpaths = paths.map((tp, i) => finish(tp, rates[i]))
  // stock: as far as the cutting moves reach (from the origin), thickness from the deepest cut
  let maxX = 0
  let maxY = 0
  let minZ = 0
  for (const tp of toolpaths)
    for (const m of tp.moves) {
      if (m.t === 'poly' || m.t === 'rapid') continue
      maxX = Math.max(maxX, m.x)
      maxY = Math.max(maxY, m.y)
      minZ = Math.min(minZ, m.z)
    }
  if (!toolpaths.length && !errors.length) errors.push('No moves found: is this a G-code program?')
  return { format: 'gcode', toolpaths, stock: { length: r6(Math.max(1, maxX)), width: r6(Math.max(1, maxY)), thickness: r6(Math.max(1, -minZ)), fromProgram: false }, warnings, errors, lines: lines.length }
}

// ---------------------------------------------------------------------------------------------
// woodWOP MPR (our own programs)
// ---------------------------------------------------------------------------------------------

let vars: Record<string, string> = {}
/** A macro value: a number, or the name of one of the program's variables ([001). */
const num = (m: MprMacro, k: string, d = NaN) => {
  const raw = m.values[k]
  const v = Number(raw !== undefined && raw in vars ? vars[raw] : raw)
  return raw !== undefined && raw !== '' && Number.isFinite(v) ? v : d
}

function segMoves(segs: Seg[], z: number): Move[] {
  return segs.map((s) => (s.k === 'L' ? { t: 'feed' as const, x: r6(s.b.x), y: r6(s.b.y), z, f: 'cut' as const } : { t: 'arc' as const, x: r6(s.b.x), y: r6(s.b.y), z, cx: s.c.x, cy: s.c.y, ccw: s.ccw, f: 'cut' as const }))
}

/**
 * MPR arcs are given by their ends and radius only (4 decimals). For a half circle (how our writer
 * writes every full circle, and every arc over 180 degrees split in two) that leaves the centre
 * ill-defined: rounding alone can move it by about 0.1 mm on an 80 mm radius. An arc whose radius is
 * half its chord within that rounding is read as the exact half circle (centre on the chord's middle).
 */
function halfCircle(s: Seg): Seg {
  if (s.k !== 'A') return s
  const r = Math.hypot(s.a.x - s.c.x, s.a.y - s.c.y)
  const d = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y)
  if (r - d / 2 > 2e-4) return s
  return { ...s, c: { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 } }
}

/** Our own MPR read back into toolpaths (consecutive macros on the same tool share one toolpath). */
export function mprToToolpaths(doc: MprDoc, machine?: Pick<MachineProfile, 'tools'>): ReadProgram {
  const warnings: string[] = []
  const errors = [...doc.errors]
  vars = doc.variables
  const wp = doc.macros.find((m) => m.id === 100)
  const T = wp ? num(wp, 'DI', 0) : 0
  const stock = { length: wp ? num(wp, 'LA', 0) : 0, width: wp ? num(wp, 'BR', 0) : 0, thickness: T, fromProgram: !!wp }
  const toolpaths: Toolpath[] = []
  let approach = false
  const drillTool = (m: MprMacro): Tool | null => {
    const tno = num(m, 'TNO')
    if (Number.isFinite(tno)) return toolByNumber(machine, tno)
    const du = num(m, 'DU')
    return machine?.tools.filter((t) => t.type === 'drill-vertical' || t.type === 'drill-horizontal').sort((a, b) => Math.abs(a.diameter - du) - Math.abs(b.diameter - du))[0] ?? null
  }
  const pathFor = (kind: Toolpath['kind'], tool: Tool | null, toolNo: number | undefined, label: string): Toolpath => {
    const last = toolpaths[toolpaths.length - 1]
    if (last && last.kind === kind && (last.tool?.number ?? -1) === (tool?.number ?? toolNo ?? -1)) return last
    const tp = newPath(toolpaths.length + 1, label, tool, tool ? tool.number : toolNo, tool?.rpm ?? 0)
    tp.kind = kind
    tp.feeds = { rpm: tool?.rpm ?? 0, feed: tool?.feed ?? 3000, plunge: tool?.plungeFeed ?? tool?.feed ?? 1500 }
    toolpaths.push(tp)
    return tp
  }
  for (const m of doc.macros) {
    const label = m.values.MNM ?? m.name
    switch (m.id) {
      case 100:
      case 101:
        break
      case 102: {
        const tool = drillTool(m)
        const tp = pathFor('drill', tool, num(m, 'TNO', undefined as unknown as number), tool ? `T${tool.number} ${tool.name}` : `Drilling D${m.values.DU ?? '?'}`)
        const x = num(m, 'XA')
        const y = num(m, 'YA')
        const depth = num(m, 'TI')
        const d = Number.isFinite(num(m, 'DU')) ? num(m, 'DU') : (tool?.diameter ?? 5)
        tp.moves.push({ t: 'drill', x, y, z: r6(-depth), r: 2, peck: 0, dwell: 0 })
        tp.intents.push({ k: 'vdrill', x, y, d, depth, through: m.values.BM === 'LSL', tool, label })
        break
      }
      case 103: {
        const tool = drillTool(m)
        const tp = pathFor('drill', tool, num(m, 'TNO', undefined as unknown as number), tool ? `T${tool.number} ${tool.name}` : `Edge drilling D${m.values.DU ?? '?'}`)
        const x = num(m, 'XA')
        const y = num(m, 'YA')
        const z = r6(num(m, 'ZA') - T)
        const depth = num(m, 'TI')
        const dir = (m.values.BM ?? 'XP') as 'XP' | 'XM' | 'YP' | 'YM'
        const v = { XP: { x: 1, y: 0 }, XM: { x: -1, y: 0 }, YP: { x: 0, y: 1 }, YM: { x: 0, y: -1 } }[dir] ?? { x: 1, y: 0 }
        const out = { x: x - v.x * 10, y: y - v.y * 10 }
        tp.moves.push({ t: 'rapid', x: out.x, y: out.y, z: SAFE_Z }, { t: 'rapid', x: out.x, y: out.y, z }, { t: 'feed', x: x + v.x * depth, y: y + v.y * depth, z, f: 'plunge' }, { t: 'feed', x: out.x, y: out.y, z, f: 'lead' }, { t: 'rapid', x: out.x, y: out.y, z: SAFE_Z })
        tp.intents.push({ k: 'hdrill', x, y, z: -z, d: Number.isFinite(num(m, 'DU')) ? num(m, 'DU') : (tool?.diameter ?? 8), depth, dir, face: 1, tool, label })
        break
      }
      case 105: {
        const [cn, ea] = (m.values.EA ?? '').split(':').map(Number)
        const [, ee] = (m.values.EE ?? '').split(':').map(Number)
        const c = doc.contours.get(cn)
        if (!c) break
        const tool = toolByNumber(machine, num(m, 'TNO'))
        if (!tool) warnings.push(`${label}: tool ${m.values.TNO} is not in the tool table; drawn without radius correction.`)
        const segs = c.segs.slice(ea, ee).map(halfCircle)
        if (!segs.length) break
        const closed = Math.hypot(segs[0].a.x - segs[segs.length - 1].b.x, segs[0].a.y - segs[segs.length - 1].b.y) < 0.01
        let path: Contour = { segs, closed }
        const r = (tool?.diameter ?? 0) / 2
        if (r > 0 && m.values.RK === 'WRKL') path = offsetChain(path, r)
        else if (r > 0 && m.values.RK === 'WRKR') path = offsetChain(path, -r)
        if (!path.segs.length) {
          warnings.push(`${label}: the contour is too small for the tool; not drawn.`)
          break
        }
        const z = r6(num(m, 'ZA', 0) - T)
        const tp = pathFor('profile', tool, num(m, 'TNO'), tool ? `T${tool.number} ${tool.name}` : `Contour milling T${m.values.TNO}`)
        const s0 = path.segs[0].a
        tp.moves.push({ t: 'rapid', x: r6(s0.x), y: r6(s0.y), z: SAFE_Z }, { t: 'rapid', x: r6(s0.x), y: r6(s0.y), z: 2 }, { t: 'feed', x: r6(s0.x), y: r6(s0.y), z, f: 'plunge' }, ...segMoves(path.segs, z))
        const e = path.segs[path.segs.length - 1].b
        tp.moves.push({ t: 'rapid', x: r6(e.x), y: r6(e.y), z: SAFE_Z })
        approach = true
        break
      }
      case 112: {
        const tool = toolByNumber(machine, num(m, 'T_'))
        const tp = pathFor('pocket', tool, num(m, 'T_'), tool ? `T${tool.number} ${tool.name}` : `Pocket T${m.values.T_}`)
        const cx = num(m, 'XA')
        const cy = num(m, 'YA')
        const L = num(m, 'LA')
        const W = num(m, 'BR')
        const depth = num(m, 'TI')
        const ang = (num(m, 'WI', 0) * Math.PI) / 180
        const r = (tool?.diameter ?? Math.max(2, num(m, 'RD', 3) * 2)) / 2
        const step = Math.max(0.1, (2 * r * num(m, 'XY', 50)) / 100)
        const z = r6(-depth)
        const rot = (p: P): P => ({ x: r6(cx + p.x * Math.cos(ang) - p.y * Math.sin(ang)), y: r6(cy + p.x * Math.sin(ang) + p.y * Math.cos(ang)) })
        // rectangles from the middle out to the wall (tool centre r inside the pocket's edge)
        const offs: number[] = []
        for (let off = r; off <= Math.min(L, W) / 2 + 1e-9; off += step) offs.push(off)
        if (!offs.length) offs.push(Math.min(L, W) / 2)
        const c0 = rot({ x: 0, y: 0 })
        tp.moves.push({ t: 'rapid', x: c0.x, y: c0.y, z: SAFE_Z }, { t: 'rapid', x: c0.x, y: c0.y, z: 2 }, { t: 'feed', x: c0.x, y: c0.y, z, f: 'plunge' })
        let last = c0
        for (const off of offs.reverse()) {
          const hx = Math.max(0, L / 2 - off)
          const hy = Math.max(0, W / 2 - off)
          for (const q of [rot({ x: -hx, y: -hy }), rot({ x: hx, y: -hy }), rot({ x: hx, y: hy }), rot({ x: -hx, y: hy }), rot({ x: -hx, y: -hy })]) {
            tp.moves.push({ t: 'feed', x: q.x, y: q.y, z, f: 'cut' })
            last = q
          }
        }
        tp.moves.push({ t: 'rapid', x: last.x, y: last.y, z: SAFE_Z })
        tp.intents.push({ k: 'pocket-rect', cx, cy, len: L, wid: W, r: num(m, 'RD', 0), angle: num(m, 'WI', 0), depth, stepoverPct: num(m, 'XY', 50), ccw: m.values.DS === '1', tool, label })
        break
      }
      case 109: {
        const tool = toolByNumber(machine, num(m, 'T_'))
        const tp = pathFor('saw', tool, num(m, 'T_'), tool ? `T${tool.number} ${tool.name}` : `Saw groove T${m.values.T_}`)
        const xa = num(m, 'XA')
        const ya = num(m, 'YA')
        const xe = num(m, 'XE')
        const ye = num(m, 'YE')
        const depth = num(m, 'TI')
        tp.moves.push({ t: 'rapid', x: xa, y: ya, z: SAFE_Z }, { t: 'feed', x: xa, y: ya, z: r6(-depth), f: 'plunge' }, { t: 'feed', x: xe, y: ye, z: r6(-depth), f: 'cut' }, { t: 'rapid', x: xe, y: ye, z: SAFE_Z })
        tp.intents.push({ k: 'saw', xa, ya, xe, ye, width: num(m, 'NB', tool?.kerf ?? 4), depth, tool, label })
        break
      }
      default:
        warnings.push(`Macro <${m.id} ${m.name}> is not drawn by this reader.`)
    }
  }
  if (approach) warnings.push("Contour milling: woodWOP's own approach and leave moves are drawn as a straight plunge and lift.")
  for (const tp of toolpaths) tp.stats = statsOf(tp)
  return { format: 'mpr', toolpaths, stock, warnings, errors, lines: 0 }
}

/** Read any program text: our MPR, otherwise G-code. */
export function readProgram(text: string, opts: GcodeOptions = {}): ReadProgram {
  if (isMprText(text)) return { ...mprToToolpaths(readMpr(text), opts.machine), lines: text.split(/\r?\n/).length }
  return readGcode(text, opts)
}

// ---------------------------------------------------------------------------------------------
// G-code as machine axes (M3.6, machine simulation)
// ---------------------------------------------------------------------------------------------

/** One position of the machine's axes a program asks for. */
export interface AxisBlock {
  /** Line number. */
  ln: number
  t: 'rapid' | 'feed'
  /** X, Y, Z in mm as written (work coordinates), or machine coordinates (`machine`, G53). */
  x: number
  y: number
  z: number
  /** The rotary axes' angles (degrees) by letter, as written (never wrapped). */
  rot: Partial<Record<'A' | 'B' | 'C', number>>
  /** G53: X, Y, Z of this block in machine coordinates; `set` says which of them the line gave. */
  machine?: { set: ('X' | 'Y' | 'Z')[] }
  /** Feed (mm/min), or moves per minute with inverse-time feeds (G93). */
  f: number
  inverse: boolean
  /** Tool number in the spindle. */
  tool?: number
  /** The operation's name (the comment before it). */
  label: string
}

export interface AxisProgram {
  blocks: AxisBlock[]
  /** Tool changes: before which block, which tool. */
  changes: { at: number; tool: number | undefined; label: string }[]
  warnings: string[]
  errors: string[]
}

/**
 * Read a G-code program as positions of the machine's axes: G0/G1 (G2/G3 arcs in the XY plane as
 * straight moves within 0.01 mm), X Y Z and the rotary axes `letters` (degrees, as written), G90 /
 * G91, G20 / G21, G53 (machine coordinates for that line), G93 / G94 feeds, T / M6 tool changes,
 * comments. For the machine simulation's replay of a post's output. Drill cycles are refused (a
 * post for a machine with rotary axes writes them as moves).
 */
export function readGcodeAxes(text: string, letters: readonly ('A' | 'B' | 'C')[] = []): AxisProgram {
  const warnings: string[] = []
  const errors: string[] = []
  const once = new Set<string>()
  const warnOnce = (key: string, msg: string) => {
    if (once.has(key)) return
    once.add(key)
    warnings.push(msg)
  }
  const blocks: AxisBlock[] = []
  const changes: AxisProgram['changes'] = []
  const hasM6 = /(^|[^0-9.])M0*6(?![0-9])/i.test(text.replace(/\([^)]*\)|;.*$/gm, ''))
  let scale = 1
  let abs = true
  let inverse = false
  let motion: 'G0' | 'G1' | 'G2' | 'G3' | null = null
  let feed = 0
  let selected: number | undefined
  let tool: number | undefined
  let label = ''
  const at = { x: 0, y: 0, z: 0, rot: {} as Partial<Record<'A' | 'B' | 'C', number>> }
  let ended = false
  text.split(/\r?\n/).forEach((raw, idx) => {
    if (ended) return
    const ln = idx + 1
    const line = gcodeLine(raw)
    if (line.comments.some(Boolean)) label = line.comments.filter(Boolean).join(' ')
    if (line.skip) return
    if (line.rest) {
      errors.push(`Line ${ln}: cannot read "${line.rest}".`)
      return
    }
    const words = line.words
    const val = (l: string) => {
      const w = words.filter(([k]) => k === l)
      return w.length ? w[w.length - 1][1] : undefined
    }
    let machine = false
    for (const g of words.filter(([k]) => k === 'G').map(([, v]) => Math.round(v * 10) / 10)) {
      if (g === 0 || g === 1 || g === 2 || g === 3) {
        motion = `G${g}` as typeof motion
      } else if (g === 20) scale = 25.4
      else if (g === 21) scale = 1
      else if (g === 90) abs = true
      else if (g === 91) abs = false
      else if (g === 93) inverse = true
      else if (g === 94) inverse = false
      else if (g === 53) machine = true
      else if (g === 81 || g === 82 || g === 83) {
        errors.push(`Line ${ln}: drilling cycle G${g} is not replayed on the machine (a post for rotary axes writes holes as moves).`)
        return
      } else if (g === 17 || g === 40 || g === 49 || g === 80 || g === 64 || g === 61 || g === 4 || (g >= 54 && g <= 59.3)) {
        // plane XY, cancels, path modes, dwell, work offset (the replay puts the work offset at the part's origin)
      } else if (g === 18 || g === 19) {
        errors.push(`Line ${ln}: arcs in the G${g} plane are not replayed.`)
        return
      } else warnOnce(`g${g}`, `Line ${ln}: G${g} is not known to the replay; ignored.`)
    }
    const F = val('F')
    if (F !== undefined) feed = inverse ? F : F * scale
    const T = val('T')
    if (T !== undefined) selected = Math.round(T)
    const ms = words.filter(([k]) => k === 'M').map(([, v]) => v)
    if (ms.some((m) => m === 30 || m === 2)) ended = true
    if (ms.some((m) => m === 6) || (!hasM6 && T !== undefined)) {
      tool = selected
      changes.push({ at: blocks.length, tool, label })
    }
    for (const l of ['A', 'B', 'C'] as const) if (val(l) !== undefined && !letters.includes(l)) warnOnce(`axis-${l}`, `Line ${ln}: the ${l} axis is not one of this machine's; ignored.`)
    const X = val('X')
    const Y = val('Y')
    const Z = val('Z')
    const rotWords = letters.filter((l) => val(l) !== undefined)
    if (X === undefined && Y === undefined && Z === undefined && !rotWords.length) return
    if (!motion) {
      warnOnce('no-motion', `Line ${ln}: a position without G0 or G1 is read as a rapid.`)
      motion = 'G0'
    }
    const next = { x: at.x, y: at.y, z: at.z, rot: { ...at.rot } }
    const set: ('X' | 'Y' | 'Z')[] = []
    for (const [k, v] of [
      ['X', X],
      ['Y', Y],
      ['Z', Z],
    ] as const) {
      if (v === undefined) continue
      set.push(k)
      const key = k.toLowerCase() as 'x' | 'y' | 'z'
      next[key] = machine || abs ? v * scale : next[key] + v * scale
    }
    for (const l of rotWords) next.rot[l] = abs ? val(l)! : (next.rot[l] ?? 0) + val(l)!
    const t: AxisBlock['t'] = motion === 'G0' ? 'rapid' : 'feed'
    const base = { ln, t, f: feed, inverse, ...(tool !== undefined ? { tool } : {}), label }
    if ((motion === 'G2' || motion === 'G3') && !machine) {
      // arcs in XY: I, J from the start (or R), as straight moves within 0.01 mm; Z and the rotary axes run evenly
      const I = val('I')
      const J = val('J')
      const R = val('R')
      let cx: number
      let cy: number
      const ccw = motion === 'G3'
      if (I !== undefined || J !== undefined) {
        cx = at.x + (I ?? 0) * scale
        cy = at.y + (J ?? 0) * scale
      } else if (R !== undefined) {
        const r = Math.abs(R * scale)
        const dx = next.x - at.x
        const dy = next.y - at.y
        const d = Math.hypot(dx, dy)
        if (d < 1e-9 || d > 2 * r + 1e-6) {
          errors.push(`Line ${ln}: arc with R${R} cannot reach its end.`)
          return
        }
        const h = Math.sqrt(Math.max(0, r * r - (d / 2) ** 2))
        const s = (ccw ? 1 : -1) * (R < 0 ? -1 : 1)
        cx = (at.x + next.x) / 2 - (s * h * dy) / d
        cy = (at.y + next.y) / 2 + (s * h * dx) / d
      } else {
        errors.push(`Line ${ln}: arc without I, J or R.`)
        return
      }
      const r = Math.hypot(at.x - cx, at.y - cy)
      const a0 = Math.atan2(at.y - cy, at.x - cx)
      let sw = Math.atan2(next.y - cy, next.x - cx) - a0
      if (ccw) while (sw <= 1e-12) sw += Math.PI * 2
      else while (sw >= -1e-12) sw -= Math.PI * 2
      const step = r > 0.01 ? 2 * Math.acos(Math.max(-1, 1 - 0.01 / r)) : Math.PI / 2
      const n = Math.max(1, Math.ceil(Math.abs(sw) / step))
      const from = { ...at, rot: { ...at.rot } }
      for (let i = 1; i <= n; i++) {
        const k = i / n
        const a = a0 + sw * k
        const rot: AxisBlock['rot'] = {}
        for (const l of letters) if (next.rot[l] !== undefined) rot[l] = (from.rot[l] ?? next.rot[l]!) + (next.rot[l]! - (from.rot[l] ?? next.rot[l]!)) * k
        blocks.push({ ...base, t: 'feed', x: i === n ? next.x : cx + r * Math.cos(a), y: i === n ? next.y : cy + r * Math.sin(a), z: from.z + (next.z - from.z) * k, rot })
      }
    } else blocks.push({ ...base, x: next.x, y: next.y, z: next.z, rot: { ...next.rot }, ...(machine ? { machine: { set } } : {}) })
    if (!machine) {
      at.x = next.x
      at.y = next.y
      at.z = next.z
    } else {
      // (a G53 line moves the machine; later work coordinates are from the work offset again)
      if (set.includes('X')) at.x = NaN
      if (set.includes('Y')) at.y = NaN
      if (set.includes('Z')) at.z = NaN
    }
    at.rot = next.rot
  })
  return { blocks, changes, warnings, errors }
}
