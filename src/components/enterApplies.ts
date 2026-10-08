import type { KeyboardEvent } from 'react'

/**
 * Kitchen-2: Enter applies a plain field exactly as leaving it (Tab, or a click elsewhere) does, by
 * running the field's own apply-on-leave; it no longer submits a surrounding form from the field.
 */
export function enterApplies(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key !== 'Enter') return
  e.preventDefault()
  e.currentTarget.blur()
}
