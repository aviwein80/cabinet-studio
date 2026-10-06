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
  switch (k) {
    case 'sharedSmall':
      return `${(ns.sharedMinArea / 1e6).toFixed(2)} m², ${ns.sharedMinSide} mm side`
    case 'bridgeWidth':
      return `${ns.bridgeWidth} mm`
    case 'bridgeMaxLength':
      return `${ns.bridgeMaxLength} mm`
    case 'bridgeMaxArea':
      return `${(ns.bridgeMaxArea / 1e6).toFixed(2)} m²`
    case 'flipAxis':
      return ns.flipAxis === 'end' ? 'end for end' : 'over the long edge'
    case 'flipReference':
      return `${ns.flipReference} mm`
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
