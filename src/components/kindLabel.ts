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

/**
 * Polish-2: what a cabinet's front and inside hold, for its card: "2 doors · 1 shelf",
 * "3 drawers", "1 drawer · 1 door · 1 shelf". Counts of none are left out (a drawer base read
 * "0 doors · 0 shelf" and never said it had drawers).
 */
export function contentsLabel(p: Pick<CarcassParams, 'doors' | 'drawers' | 'shelves'>) {
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
  const drawers = Math.max(0, Math.round(p.drawers?.count ?? 0))
  const parts = [drawers > 0 ? n(drawers, 'drawer', 'drawers') : '', p.doors.count > 0 ? n(p.doors.count, 'door', 'doors') : '', p.shelves.count > 0 ? n(p.shelves.count, 'shelf', 'shelves') : ''].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'no doors, drawers or shelves'
}
