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
 */
export function sizedName(name: string, widthMm: number, units: UnitSystem) {
  const base = name.trim().replace(/\s+-?\d+(?:[.,]\d+)?(?:[\s-]+\d+\/\d+)?\s*(?:mm|in|["″])?$/i, '').trim()
  const size = units === 'in' ? formatInches(widthMm) : fmt(Math.round(widthMm))
  return base ? `${base} ${size}` : size
}

/** Offcut size as written on the sheet map: whole millimetres, or inches to 1/16. */
export function offcutSize(length: number, width: number, units: UnitSystem) {
  return units === 'in' ? formatDims([length, width], 'in') : `${Math.round(length)} × ${Math.round(width)}`
}
