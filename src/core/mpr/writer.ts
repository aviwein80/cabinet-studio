/**
 * woodWOP MPR 4.0 writer ("4.0 Alpha", the plain-text format woodWOP 9 still saves).
 *
 * Structure follows the 2006 MPR 4.x description (9-080-42-7190-D00) and real files saved by
 * woodWOP 6 / 9: [H header, [001 variables, ]n contours, <100 WerkStck, processing macros,
 * "!" end of file. CRLF line endings, ASCII/cp1252 only.
 *
 * Machine-specific numbers (tools, depths, feeds) never appear here as constants; they come in
 * through the SheetProgram, which resolved them from the editable machine profile.
 */
import { radius, type Seg, splitMajorArcs } from '@/cam/geom'
import { fmt } from '../geometry'
import type { CamProgramOp, Contour, HDrill, Pocket, ProgramOp, SawGroove, SheetProgram, VDrill } from '../machining'
import type { Job, MachineProfile } from '../types'

export const GENERATOR = 'Cabinet Studio 0.1.0'

export interface MprContext {
  job: Job
  machine: MachineProfile
  mprNumber: number
  mprCount: number
  /** Single custom-part program instead of a nested sheet. */
  single?: { partName: string }
}

/** Make a value safe for a quoted MPR string: ASCII, no double quotes, no line breaks. */
export function mprText(s: string, max = 80) {
  const map: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss', '°': 'deg', '×': 'x', '–': '-', '—': '-' }
  let out = ''
  for (const ch of s.normalize('NFC')) {
    if (map[ch]) out += map[ch]
    else if (ch === '"') out += "'"
    else if (ch === '\r' || ch === '\n' || ch === '\t') out += ' '
    else if (ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) < 127) out += ch
    else out += '?'
  }
  return out.slice(0, max)
}

const f6 = (n: number) => n.toFixed(6)
const f4 = (n: number) => n.toFixed(4)

export class Lines {
  out: string[] = []
  line(s = '') {
    this.out.push(s)
  }
  kv(key: string, value: string | number) {
    this.out.push(`${key}="${typeof value === 'number' ? fmt(value) : value}"`)
  }
}

export function writeVDrill(w: Lines, op: VDrill, machine: MachineProfile) {
  w.line('<102 \\BohrVert\\')
  w.kv('XA', op.x)
  w.kv('YA', op.y)
  w.kv('BM', op.through ? 'LSL' : 'LS')
  w.kv('TI', op.depth)
  if (machine.drillAddressing === 'tool-number' && op.tool) w.kv('TNO', op.tool.number)
  else w.kv('DU', op.diameter)
  w.kv('AN', 1)
  w.kv('MI', 0)
  w.kv('S_', 2)
  w.kv('AB', 0)
  w.kv('WI', 0)
  w.kv('F_', 'STANDARD')
  w.kv('KO', '00')
  w.kv('KAT', 'Bohren vertikal')
  w.kv('MNM', mprText(`P${op.partNo} ${op.purpose} D${fmt(op.diameter)}`))
}

export function writeHDrill(w: Lines, op: HDrill, machine: MachineProfile) {
  w.line('<103 \\BohrHoriz\\')
  w.kv('XA', op.x)
  w.kv('YA', op.y)
  w.kv('ZA', op.z)
  if (machine.drillAddressing === 'tool-number' && op.tool) w.kv('TNO', op.tool.number)
  else w.kv('DU', op.diameter)
  w.kv('TI', op.depth)
  w.kv('BM', op.dir)
  w.kv('BM2', 'STD')
  w.kv('AN', 1)
  w.kv('AB', 0)
  w.kv('MI', 0)
  w.kv('F_', 'STANDARD')
  w.kv('KO', '00')
  w.kv('KAT', 'Bohren horizontal')
  w.kv('MNM', mprText(`P${op.partNo} ${op.purpose} D${fmt(op.diameter)}`))
}

function writePocket(w: Lines, op: Pocket) {
  w.line('<112 \\Tasche\\')
  w.kv('XA', (op.x1 + op.x2) / 2)
  w.kv('YA', (op.y1 + op.y2) / 2)
  w.kv('LA', op.x2 - op.x1)
  w.kv('BR', op.y2 - op.y1)
  w.kv('RD', op.tool ? op.tool.diameter / 2 : 0)
  w.kv('WI', 0)
  w.kv('TI', op.depth)
  w.kv('ZT', 0)
  w.kv('XY', 80)
  w.kv('DS', 1)
  w.kv('T_', op.tool ? op.tool.number : 0)
  w.kv('F_', 'STANDARD')
  w.kv('KO', '00')
  w.kv('KAT', 'Tasche')
  w.kv('MNM', mprText(`P${op.partNo} ${op.purpose}`))
}

function writeSaw(w: Lines, op: SawGroove) {
  w.line('<109 \\Nuten\\')
  w.kv('XA', op.xa)
  w.kv('YA', op.ya)
  w.kv('XE', op.xe)
  w.kv('YE', op.ye)
  w.kv('NB', op.width)
  w.kv('RK', 'NOWRK')
  w.kv('EM', op.throughEnds ? 'MOD2' : 'MOD0')
  w.kv('TI', op.depth)
  w.kv('MN', 'GL')
  w.kv('XY', 80)
  w.kv('OP', 1)
  w.kv('T_', op.tool ? op.tool.number : 0)
  w.kv('F_', 'STANDARD')
  w.kv('KO', '00')
  w.kv('KAT', 'Nuten')
  w.kv('MNM', mprText(`P${op.partNo} ${op.purpose}`))
}

/**
 * Contour block with native arcs. KA carries the end point, radius and DS (0 = CW, 1 = CCW,
 * both at most 180 degrees; larger arcs are split so DS 2/3 are never needed).
 * [UNCERTAIN until one arc is checked in woodWOP: DS direction is taken from the MPR 4.x spec.]
 */
export function writeSegsGeometry(w: Lines, n: number, segs: Seg[], z = 0) {
  const list = splitMajorArcs(segs)
  w.line(`]${n}`)
  w.line('$E0')
  w.line('KP ')
  w.line(`X=${f4(list[0].a.x)}`)
  w.line(`Y=${f4(list[0].a.y)}`)
  w.line(`Z=${f4(z)}`)
  w.line('KO=00')
  w.line()
  list.forEach((sg, i) => {
    w.line(`$E${i + 1}`)
    w.line(sg.k === 'L' ? 'KL ' : 'KA ')
    w.line(`X=${f4(sg.b.x)}`)
    w.line(`Y=${f4(sg.b.y)}`)
    if (sg.k === 'A') {
      w.line(`R=${f4(radius(sg))}`)
      w.line(`DS=${sg.ccw ? 1 : 0}`)
    }
    w.line()
  })
  return list.length
}

function writeContourGeometry(w: Lines, n: number, c: Contour) {
  if (c.segs) {
    writeSegsGeometry(w, n, c.segs)
    return
  }
  w.line(`]${n}`)
  c.points.forEach((p, i) => {
    w.line(`$E${i}`)
    w.line(i === 0 ? 'KP ' : 'KL ')
    w.line(`X=${f4(p.x)}`)
    w.line(`Y=${f4(p.y)}`)
    if (i === 0) {
      w.line('Z=0.0000')
      w.line('KO=00')
    }
    w.line()
  })
}

function writeContourMacro(w: Lines, n: number, c: Contour, machine: MachineProfile) {
  const cw = machine.contour.direction === 'climb-cw'
  const approach = machine.contour.approach
  w.line('<105 \\Konturfraesen\\')
  w.kv('EA', `${n}:0`)
  w.kv('MDA', approach)
  w.kv('RK', cw ? 'WRKL' : 'WRKR')
  w.kv('EE', `${n}:${c.segs ? splitMajorArcs(c.segs).length : c.points.length - 1}`)
  w.kv('MDE', `${approach}_AB`)
  w.kv('EM', machine.contour.ramp ? 1 : 0)
  w.kv('RI', 1)
  w.kv('TNO', c.tool ? c.tool.number : 0)
  w.kv('SM', 0)
  w.kv('S_', 'STANDARD')
  w.kv('F_', 'STANDARD')
  w.kv('AB', 0)
  w.kv('AF', 0)
  w.kv('ZA', c.za)
  w.kv('STUFEN', 0)
  w.kv('ZSTART', 0)
  w.kv('ANZZST', 0)
  w.kv('KAT', 'Fraesen')
  w.kv('MNM', mprText(`P${c.partNo} cut-out`))
}

/** Native macros for one custom-part intent (already in program coordinates). */
function writeCamIntent(w: Lines, n: number, op: CamProgramOp, T: number, machine: MachineProfile) {
  const it = op.intent
  const tag = `P${op.partNo}`
  switch (it.k) {
    case 'contour': {
      const count = splitMajorArcs(it.segs).length
      const map = elementMap(it.segs)
      it.passes.forEach((ps, i) => {
        if (i) w.line()
        w.line('<105 \\Konturfraesen\\')
        w.kv('EA', `${n}:${map[ps.from]}`)
        w.kv('MDA', it.approach)
        w.kv('RK', it.rk)
        w.kv('EE', `${n}:${Math.min(count, map[ps.to + 1])}`)
        w.kv('MDE', `${it.approach}_AB`)
        w.kv('EM', it.ramp ? 1 : 0)
        w.kv('RI', 1)
        w.kv('TNO', it.tool ? it.tool.number : 0)
        w.kv('SM', 0)
        w.kv('S_', 'STANDARD')
        w.kv('F_', 'STANDARD')
        w.kv('AB', 0)
        w.kv('AF', 0)
        w.kv('ZA', Math.round((T - ps.depth) * 1000) / 1000)
        w.kv('STUFEN', 0)
        w.kv('ZSTART', 0)
        w.kv('ANZZST', 0)
        w.kv('KAT', 'Fraesen')
        w.kv('MNM', mprText(`${tag} ${it.label} D${fmt(ps.depth)}`))
      })
      break
    }
    case 'vdrill':
      writeVDrill(w, { kind: 'vdrill', partUid: op.partUid, partNo: op.partNo, opId: op.opId, purpose: 'custom', x: it.x, y: it.y, diameter: it.d, depth: it.depth, through: it.through, tool: it.tool }, machine)
      break
    case 'hdrill':
      writeHDrill(w, { kind: 'hdrill', partUid: op.partUid, partNo: op.partNo, opId: op.opId, purpose: 'custom', x: it.x, y: it.y, z: Math.round((T - it.z) * 1000) / 1000, diameter: it.d, depth: it.depth, dir: it.dir, tool: it.tool }, machine)
      break
    case 'pocket-rect':
      w.line('<112 \\Tasche\\')
      w.kv('XA', Math.round(it.cx * 1000) / 1000)
      w.kv('YA', Math.round(it.cy * 1000) / 1000)
      w.kv('LA', Math.round(it.len * 1000) / 1000)
      w.kv('BR', Math.round(it.wid * 1000) / 1000)
      w.kv('RD', it.r)
      w.kv('WI', Math.round(it.angle * 1000) / 1000)
      w.kv('TI', it.depth)
      w.kv('ZT', 0)
      w.kv('XY', it.stepoverPct)
      w.kv('DS', it.ccw ? 1 : 0)
      w.kv('T_', it.tool ? it.tool.number : 0)
      w.kv('F_', 'STANDARD')
      w.kv('KO', '00')
      w.kv('KAT', 'Tasche')
      w.kv('MNM', mprText(`${tag} ${it.label}`))
      break
    case 'saw':
      writeSaw(w, { kind: 'saw', partUid: op.partUid, partNo: op.partNo, opId: op.opId, purpose: 'custom', xa: it.xa, ya: it.ya, xe: it.xe, ye: it.ye, width: it.width, depth: it.depth, throughEnds: false, tool: it.tool })
      break
    case 'comment':
      w.line('<101 \\Kommentar\\')
      w.kv('KM', mprText(`${tag} ${it.stop ? 'PROGRAM STOP: ' : ''}${it.text}`))
      w.kv('KAT', 'Kommentar')
      w.kv('MNM', 'Kommentar')
      break
  }
}

/** Index of each original segment's start element once major arcs are split. */
function elementMap(segs: Seg[]) {
  const map: number[] = []
  let k = 0
  for (const sg of segs) {
    map.push(k)
    k += splitMajorArcs([sg]).length
  }
  map.push(k)
  return map
}

const intentHasContour = (o: ProgramOp): o is CamProgramOp => o.kind === 'cam' && o.intent.k === 'contour'

export function writeSheetMpr(prog: SheetProgram, ctx: MprContext): string {
  const { job, machine } = ctx
  const s = prog.sheet
  const w = new Lines()

  w.line('[H')
  w.kv('VERSION', '4.0 Alpha')
  w.kv('OP', machine.header.OP)
  w.kv('FM', machine.header.FM)
  w.kv('MAT', machine.mat)
  w.kv('INCH', 0)
  w.kv('VIEW', 'NOMIRROR')
  w.kv('ANZ', 1)
  w.kv('MATERIAL', mprText(prog.materialCode))
  w.kv('CUSTOMER', mprText(job.customer))
  w.kv('ORDER', mprText(job.number))
  w.kv('ARTICLE', mprText(ctx.single ? ctx.single.partName : `Sheet ${ctx.mprNumber} of ${ctx.mprCount}`))
  w.kv('PARTID', mprText(prog.name))
  w.kv('PARTTYPE', ctx.single ? 'PART' : 'NEST')
  w.kv('MPRCOUNT', ctx.mprCount)
  w.kv('MPRNUMBER', ctx.mprNumber)
  w.kv('INFO1', mprText(GENERATOR))
  w.kv('INFO2', 'NOT MACHINE-VALIDATED - simulate in woodWOP before cutting')
  w.kv('INFO3', machine.placeholder ? 'PLACEHOLDER TOOL TABLE - DO NOT RUN' : mprText(`Tools: ${machine.name}`))
  w.kv('INFO4', mprText(job.name))
  w.kv('INFO5', '')
  w.line(`_BSX=${f6(s.sheetLength)}`)
  w.line(`_BSY=${f6(s.sheetWidth)}`)
  w.line(`_BSZ=${f6(s.thickness)}`)
  w.line('_FNX=0.000000')
  w.line('_FNY=0.000000')
  w.line('_RNX=0.000000')
  w.line('_RNY=0.000000')
  w.line('_RNZ=0.000000')
  w.line(`_RX=${f6(s.sheetLength)}`)
  w.line(`_RY=${f6(s.sheetWidth)}`)
  w.line()

  w.line('[001')
  w.kv('L', s.sheetLength)
  w.kv('KM', 'Sheet length X')
  w.kv('B', s.sheetWidth)
  w.kv('KM', 'Sheet width Y')
  w.kv('D', s.thickness)
  w.kv('KM', 'Sheet thickness Z')
  w.line()

  const contours = prog.ops.filter((o): o is Contour => o.kind === 'contour')
  const blockNo = new Map<ProgramOp, number>()
  let blocks = 0
  for (const o of prog.ops) {
    if (o.kind === 'contour') {
      blocks += 1
      blockNo.set(o, blocks)
      writeContourGeometry(w, blocks, o)
    } else if (intentHasContour(o) && o.intent.k === 'contour') {
      blocks += 1
      blockNo.set(o, blocks)
      writeSegsGeometry(w, blocks, o.intent.segs)
    }
  }

  w.line('<100 \\WerkStck\\')
  w.kv('LA', 'L')
  w.kv('BR', 'B')
  w.kv('DI', 'D')
  w.kv('FNX', 0)
  w.kv('FNY', 0)
  w.kv('AX', 0)
  w.kv('AY', 0)
  w.line()

  w.line('<101 \\Kommentar\\')
  w.kv('KM', mprText(ctx.single ? `${GENERATOR} - custom part ${ctx.single.partName} ${prog.materialCode}` : `${GENERATOR} - job ${job.number} sheet ${ctx.mprNumber}/${ctx.mprCount} ${prog.materialCode}`))
  w.kv('KM', 'Generated program. Verify in woodWOP simulation before cutting.')
  for (const pl of s.placements) {
    const c = contours.find((cc) => cc.partUid === pl.uid)
    if (c) w.kv('KM', mprText(`P${c.partNo} at X${fmt(pl.x)} Y${fmt(pl.y)} ${fmt(pl.dx)}x${fmt(pl.dy)}${pl.rotated ? ' rotated' : ''}`))
  }
  if (prog.skipped.length) w.kv('KM', mprText(`${prog.skipped.length} horizontal holes NOT in this program - drill off-machine`))
  w.kv('KAT', 'Kommentar')
  w.kv('MNM', 'Kommentar')
  w.line()

  for (const op of prog.ops as ProgramOp[]) {
    switch (op.kind) {
      case 'vdrill':
        writeVDrill(w, op, machine)
        break
      case 'hdrill':
        writeHDrill(w, op, machine)
        break
      case 'pocket':
        writePocket(w, op)
        break
      case 'saw':
        writeSaw(w, op)
        break
      case 'contour':
        writeContourMacro(w, blockNo.get(op)!, op, machine)
        break
      case 'cam':
        writeCamIntent(w, blockNo.get(op) ?? 0, op, s.thickness, machine)
        break
    }
    w.line()
  }

  w.line('<101 \\Kommentar\\')
  w.kv('KM', `HOMAG_PRODUCTIONMANAGER_FEEDBACK={Version:1.00,PARTID:${mprText(prog.name)},MPRNUMBER:${ctx.mprNumber},MPRCOUNT:${ctx.mprCount}}`)
  w.kv('KAT', 'Kommentar')
  w.kv('MNM', 'Kommentar')
  w.line('!')
  return w.out.join('\r\n') + '\r\n'
}

/** Encode as Windows-1252 bytes. The writer only emits ASCII, so this is a 1:1 byte copy with '?' as a safety net. */
export function encodeCp1252(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    out[i] = c < 256 ? c : 63
  }
  return out
}
