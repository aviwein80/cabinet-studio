import { fmt } from './geometry'
import type { UnitSystem } from './types'

/** Exact. Every length in the model is millimetres; inches are only a display. */
export const MM_PER_IN = 25.4

const DENOM = 16

export function toMm(inches: number) {
  return inches * MM_PER_IN
}

export function toInches(mm: number) {
  return mm / MM_PER_IN
}

/** Nearest 1/16 in, written 23-1/4" (whole inches omitted for fractions under 1). */
export function formatInches(mm: number) {
  const inches = toInches(mm)
  const sign = inches < 0 ? '-' : ''
  const abs = Math.abs(inches)
  let sixteenths = Math.round(abs * DENOM)
  const whole = Math.floor(sixteenths / DENOM)
  sixteenths -= whole * DENOM
  if (sixteenths === 0) return `${sign}${whole}"`
  let n = sixteenths
  let d = DENOM
  while (n % 2 === 0) {
    n /= 2
    d /= 2
  }
  return whole > 0 ? `${sign}${whole}-${n}/${d}"` : `${sign}${n}/${d}"`
}

export function formatLength(mm: number, units: UnitSystem) {
  return units === 'in' ? formatInches(mm) : fmt(mm)
}

export function lengthSuffix(units: UnitSystem) {
  return units === 'in' ? 'in' : 'mm'
}

/**
 * Parse a length typed by the user back to millimetres.
 * Inches accept 23.25, 23-1/4, 23 1/4 and 1/2, with an optional trailing quote.
 * An explicit unit wins over the shop's units in either mode: "6 mm", "6mm", '1/2"', "1/2 in".
 */
export function parseLength(text: string, units: UnitSystem): number | null {
  let s = text.trim().replace(',', '.')
  const suffix = s.match(/^(.*?)\s*(mm|in|inch|inches|["″])$/i)
  if (suffix) {
    s = suffix[1].trim()
    units = suffix[2].toLowerCase() === 'mm' ? 'mm' : 'in'
  }
  s = s.replace(/["″]/g, '')
  if (!s) return null
  if (units === 'mm') {
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }
  const mixed = s.match(/^(-?)(\d+)[\s-]+(\d+)\s*\/\s*(\d+)$/)
  if (mixed) {
    const whole = Number(mixed[2])
    const num = Number(mixed[3])
    const den = Number(mixed[4])
    if (den === 0) return null
    const mag = whole + num / den
    return toMm(mixed[1] === '-' ? -mag : mag)
  }
  const frac = s.match(/^(-?)(\d+)\s*\/\s*(\d+)$/)
  if (frac) {
    const den = Number(frac[3])
    if (den === 0) return null
    const mag = Number(frac[2]) / den
    return toMm(frac[1] === '-' ? -mag : mag)
  }
  const n = Number(s)
  return Number.isFinite(n) ? toMm(n) : null
}

/**
 * Sizes for cards and panels in the shop's units, rounded for reading: millimetres to 0.1, inches
 * to the nearest 1/16. Joined with " × " (600 × 876.3 × 590.6, or 23-5/8" × 34-1/2" × 23-1/4").
 */
export function formatDims(values: number[], units: UnitSystem) {
  return values.map((v) => (units === 'in' ? formatInches(v) : fmt(Math.round(v * 10) / 10))).join(' × ')
}

/**
 * A name with the width in the shop's units on the end ("Sink base 36"", "Sink base 900"). A size
 * the name already ends with (36", 36 in, 800, 800 mm, 23-1/4") is replaced, not repeated.
 * Polish-3: so is a size with its unit inside the name (Base 24" 2-door), and a millimetre name that
 * already has the width as a bare number inside it is left as it is.
 */
export function sizedName(name: string, widthMm: number, units: UnitSystem) {
  const trimmed = name.trim()
  const base = trimmed.replace(/\s+-?\d+(?:[.,]\d+)?(?:[\s-]+\d+\/\d+)?\s*(?:mm|in|["″])?$/i, '').trim()
  const size = units === 'in' ? formatInches(widthMm) : fmt(Math.round(widthMm))
  // Polish-3: a size with its unit inside the name ('Base 24" 2-door') is the width: replaced there, not added again at the end
  const inner = base === trimmed ? /(^|\s)(?:\d+(?:[.,]\d+)?(?:[\s-]+\d+\/\d+)?|\d+\/\d+)\s*(mm\b|in\b|["″])/i.exec(trimmed) : null
  // (a millimetre name with the width as a bare number inside it, 'Base 600 2-door', already says it)
  if (!inner && base === trimmed && units === 'mm' && new RegExp(`(^|\\s)${size}(\\s|$)`).test(trimmed)) return trimmed
  if (inner) {
    const unit = inner[2].toLowerCase() === 'mm' && units === 'mm' ? ' mm' : ''
    return `${trimmed.slice(0, inner.index)}${inner[1]}${size}${unit}${trimmed.slice(inner.index + inner[0].length)}`
  }
  return base ? `${base} ${size}` : size
}

/** Offcut size as written on the sheet map: whole millimetres, or inches to 1/16. */
export function offcutSize(length: number, width: number, units: UnitSystem) {
  return units === 'in' ? formatDims([length, width], 'in') : `${Math.round(length)} × ${Math.round(width)}`
}

/** Kitchen-2: the length as an exact inch fraction (to 1/64 in), or null when it is not one (6 mm). */
export function exactInches(mm: number): string | null {
  const k = Math.round(toInches(Math.abs(mm)) * 64)
  if (k === 0 || Math.abs((k / 64) * MM_PER_IN - Math.abs(mm)) > 0.0005) return null
  const whole = Math.floor(k / 64)
  let n = k - whole * 64
  let d = 64
  while (n > 0 && n % 2 === 0) {
    n /= 2
    d /= 2
  }
  const sign = mm < 0 ? '-' : ''
  if (n === 0) return `${sign}${whole}"`
  return whole > 0 ? `${sign}${whole}-${n}/${d}"` : `${sign}${n}/${d}"`
}

/**
 * Kitchen-2: a tool or drill size (diameter, depth, stick-out). Metric tools stay exact in an inch
 * shop: a 6 mm drill reads "6 mm", not 1/4"; a size that is an exact inch fraction reads as one
 * (12.7 reads 1/2"). Either text carries its unit, so it reads back to the same millimetres.
 */
export function toolSize(mm: number, units: UnitSystem) {
  if (units === 'mm') return fmt(mm)
  return exactInches(mm) ?? `${fmt(mm)} mm`
}

/**
 * Kitchen-2: a size or position in a message (part and sheet sizes, positions, spacing, trim): inches
 * to 1/16 in an inch shop, "<n> mm" otherwise. Machining values (depths, thicknesses, tool sizes,
 * tolerances, clearances) stay exact in millimetres in both.
 */
export function sizeText(mm: number, units: UnitSystem) {
  return units === 'in' ? formatInches(mm) : `${fmt(mm)} mm`
}

/**
 * Polish-2: a thin length (an edgeband's thickness, an inside corner radius) in the shop unit without
 * rounding it to 1/16 in: an exact inch fraction when it is one (1/2"), else decimal inches to 0.001
 * (a 1 mm band reads 0.039", not 1/16"; a 6 mm radius 0.236"). Millimetres as `fmt` gives them.
 */
export function fineLength(mm: number, units: UnitSystem) {
  if (units === 'mm') return fmt(mm)
  if (Math.abs(mm) < 0.0005) return '0"'
  return exactInches(mm) ?? `${toInches(mm).toFixed(3)}"`
}

/** Polish-2: `fineLength` in a message: "0.236"" in an inch shop, "6 mm" otherwise. */
export function fineText(mm: number, units: UnitSystem) {
  return units === 'in' ? fineLength(mm, 'in') : `${fmt(mm)} mm`
}

/** Polish-2: a running length of edgeband: metres to 0.01 in a millimetre shop, feet to 0.1 in an inch shop. */
export function runLength(mm: number, units: UnitSystem) {
  return units === 'in' ? `${(Math.round((mm / (MM_PER_IN * 12)) * 10) / 10).toFixed(1)} ft` : `${Math.round(mm / 10) / 100} m`
}

/** Kitchen-2: the nesting header's trim and part spacing, in the shop unit (it always said mm). */
export function trimSpacingText(trim: number, spacing: number, units: UnitSystem) {
  return units === 'in' ? `Trim ${formatInches(trim)} · spacing ${formatInches(spacing)}` : `Trim ${trim} · spacing ${spacing} mm`
}

/** Polish-3: a closed shape's area in the part designer: m² to 0.0001, or ft² to 0.0001 in an inch shop. */
export function shapeArea(mm2: number, units: UnitSystem) {
  return units === 'in' ? `${(mm2 / (MM_PER_IN * 12) ** 2).toFixed(4)} ft²` : `${(mm2 / 1e6).toFixed(4)} m²`
}

/**
 * Polish-3: a toolpath's length of cutting or rapids: metres (to `mDigits` places, as each screen
 * showed them) in a millimetre shop, feet to 0.1 in an inch shop.
 */
export function pathLength(mm: number, units: UnitSystem, mDigits = 1) {
  return units === 'in' ? `${(mm / (MM_PER_IN * 12)).toFixed(1)} ft` : `${(mm / 1000).toFixed(mDigits)} m`
}

/**
 * Polish-3: tool sizes stay metric on purpose in an inch shop (Kitchen-2: the bits are made in mm). The
 * Machine page's tool table says so, so "Ball-nose 6 mm (placeholder)" beside inch sizes is not a slip.
 */
export const TOOL_UNITS_NOTE = 'Tool sizes stay in millimetres, as the bits are made: a size reads in inches only when it is an exact inch size (12.7 mm reads 1/2"). Tool names are your own text; the placeholder names give the metric size.'
