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
 */
export function parseLength(text: string, units: UnitSystem): number | null {
  const s = text.trim().replace(/["″]/g, '').replace(',', '.')
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
