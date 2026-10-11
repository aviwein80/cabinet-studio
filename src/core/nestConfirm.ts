/**
 * Nesting values added in M2.8 that are placeholders until the shop confirms them. Only the
 * values of a nesting addition that is switched on are listed. Confirmation is kept with the other
 * shop values (`MachineProfile.confirmed`, keys `nest:<name>`); typing a value confirms it. Sheet
 * programs are rebuilt from these settings every time, so a change reaches every program and every
 * check at once.
 */
import { type ConfigTarget, isConfirmed, keyOf, type NestValueKey, type Unconfirmed } from './confirm'
import { bridgesOn, flipSheetsOn, nestSettingsOf, sharedLinesOn } from './machining'
import type { MachineProfile, ShopSettings } from './types'
import { formatLength, MM_PER_IN } from './units'

const MM2_PER_FT2 = (MM_PER_IN * 12) ** 2

export const NEST_VALUE_LABEL: Record<NestValueKey, string> = {
  sharedSmall: 'Shared lines: smallest part that shares lines',
  bridgeWidth: 'Bridges: width',
  bridgeMaxLength: 'Bridges: longest bridge',
  bridgeMaxArea: 'Bridges: largest part bridged',
  flipAxis: 'Flip-side sheets: how the sheet is turned over',
  flipReference: 'Flip-side sheets: reference edge strip',
}

export function nestValue(settings: ShopSettings, k: NestValueKey): string {
  const ns = nestSettingsOf(settings)
  // Polish-3: in an inch shop the badge reads in the units of the field beside it (ft², inches)
  const inch = settings.units === 'in'
  const area = (mm2: number) => (inch ? `${(mm2 / MM2_PER_FT2).toFixed(2)} ft²` : `${(mm2 / 1e6).toFixed(2)} m²`)
  const len = (mm: number) => (inch ? formatLength(mm, 'in') : `${mm} mm`)
  switch (k) {
    case 'sharedSmall':
      return `${area(ns.sharedMinArea)}, ${len(ns.sharedMinSide)} side`
    case 'bridgeWidth':
      return len(ns.bridgeWidth)
    case 'bridgeMaxLength':
      return len(ns.bridgeMaxLength)
    case 'bridgeMaxArea':
      return area(ns.bridgeMaxArea)
    case 'flipAxis':
      return ns.flipAxis === 'end' ? 'end for end' : 'over the long edge'
    case 'flipReference':
      return len(ns.flipReference)
  }
}

/** Which nesting values are in use with the switches as they are. */
export function nestValuesInUse(settings: ShopSettings): NestValueKey[] {
  const out: NestValueKey[] = []
  if (sharedLinesOn(settings)) out.push('sharedSmall')
  if (bridgesOn(settings)) out.push('bridgeWidth', 'bridgeMaxLength', 'bridgeMaxArea')
  if (flipSheetsOn(settings)) out.push('flipAxis', 'flipReference')
  return out
}

export function nestUnconfirmed(settings: ShopSettings, m: Pick<MachineProfile, 'confirmed'>): Unconfirmed[] {
  return nestValuesInUse(settings)
    .map((k) => ({ k, target: { kind: 'nest', key: k } as ConfigTarget }))
    .filter(({ target }) => !isConfirmed(m, keyOf(target)))
    .map(({ k, target }) => ({ key: keyOf(target), label: NEST_VALUE_LABEL[k], value: nestValue(settings, k), group: 'Nesting', target }))
}
