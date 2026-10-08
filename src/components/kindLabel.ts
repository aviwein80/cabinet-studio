import type { CarcassParams } from '@/core/types'

/** Kitchen-2: what a cabinet is, in words, for cards and lists (null for an ordinary cabinet). */
export function kindLabel(p: CarcassParams) {
  if (p.panel?.type === 'filler') return 'Filler'
  if (p.panel?.type === 'end-panel') return 'End panel'
  if (p.corner?.type === 'blind') return `Blind corner ${p.kind}, blind ${p.corner.blindSide}`
  return null
}
