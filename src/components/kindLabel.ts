import type { CarcassParams } from '@/core/types'

/** Kitchen-2: what a cabinet is, in words, for cards and lists (null for an ordinary cabinet). */
export function kindLabel(p: CarcassParams) {
  if (p.panel?.type === 'filler') return 'Filler'
  if (p.panel?.type === 'end-panel') return 'End panel'
  if (p.corner?.type === 'blind') return `Blind corner ${p.kind}, blind ${p.corner.blindSide}${p.corner.wall === 'side' ? ', on the side wall' : ''}`
  // Kitchen-3
  if (p.corner?.type === 'pie-cut') return `Pie-cut corner ${p.kind}, back-${p.corner.side} corner`
  return null
}
