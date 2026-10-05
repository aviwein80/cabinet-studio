/** Finding and focusing the field a "Configure" badge opens (M2.6e). */
import { useEffect } from 'react'
import { useStore } from '@/app/store'
import { type ConfigTarget, keyOf } from '@/core/confirm'

/** Scroll to the field marked `data-cfg={key}`, focus it and flash it. */
export function focusField(key: string, tries = 20) {
  const el = document.querySelector<HTMLElement>(`[data-cfg="${CSS.escape(key)}"]`)
  if (!el) {
    if (tries > 0) setTimeout(() => focusField(key, tries - 1), 60)
    return
  }
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  el.querySelector<HTMLElement>('input, button[role="switch"], button[role="combobox"], select, textarea')?.focus({ preventScroll: true })
  el.classList.add('ring-2', 'ring-amber-400', 'ring-offset-2')
  setTimeout(() => el.classList.remove('ring-2', 'ring-amber-400', 'ring-offset-2'), 2500)
}

/**
 * On a page that holds configurable fields: when a "Configure" badge asked for one of `kinds`,
 * run `prepare` (open a dialog, pick an operation...) and then focus the field.
 */
export function useConfigureTarget(kinds: ConfigTarget['kind'][], prepare?: (t: ConfigTarget) => void) {
  const target = useStore((s) => s.configure)
  const clear = useStore((s) => s.clearConfigure)
  useEffect(() => {
    if (!target || !kinds.includes(target.kind)) return
    prepare?.(target)
    focusField(cfgKeyOf(target))
    clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])
}

/** The `data-cfg` key of the field a target opens. */
export function cfgKeyOf(t: ConfigTarget): string {
  return keyOf(t)
}
