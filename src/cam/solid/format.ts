/** Solid file types by extension (kept apart so screens can check a file name without loading the reader code). */
import type { SolidFormat } from './types'

export function solidFormatOf(name: string): SolidFormat | null {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'step' || ext === 'stp' || ext === 'p21') return 'step'
  if (ext === 'iges' || ext === 'igs') return 'iges'
  if (ext === 'brep' || ext === 'brp') return 'brep'
  return null
}

export const isSolidFile = (name: string) => solidFormatOf(name) !== null
