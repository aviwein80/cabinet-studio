import type { CamPart } from '@/cam/types'

export const isDraftPart = (p: CamPart) => p.review?.status === 'draft'

/** Why a part cannot be saved, added to a job or nested; undefined when it can. */
export function draftBlock(p: CamPart): string | undefined {
  return isDraftPart(p) ? `“${p.name}” is an unchecked draft from ${p.review?.file}. Review and approve it first.` : undefined
}
