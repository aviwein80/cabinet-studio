/**
 * Light helpers for a solid's faces (selection by colour or type, colours set in the app, shapes
 * out of date), kept apart from recognition so screens can use them without loading it.
 */
import type { CamPart, Entity, ModelRef } from '../types'
import type { SolidBody, SolidData } from './types'

/** The body that holds a face. */
export function bodyOfFace(solid: SolidData, face: number): SolidBody | undefined {
  return solid.bodies.find((b) => b.faces.some((f) => f.id === face))
}

/** Set (or clear, with null) the colour of faces in the app. */
export function setFaceColor(model: ModelRef, faces: number[], color: string | null): ModelRef {
  const faceColors = { ...(model.faceColors ?? {}) }
  for (const f of faces) {
    if (color) faceColors[String(f)] = color
    else delete faceColors[String(f)]
  }
  return { ...model, faceColors }
}

/** Faces of a colour (set in the app, else from the file; #rrggbb, any case). */
export function facesByColor(solid: SolidData, model: Pick<ModelRef, 'faceColors'>, color: string): number[] {
  const want = color.toLowerCase()
  const out: number[] = []
  for (const b of solid.bodies) for (const f of b.faces) if ((model.faceColors?.[String(f.id)] ?? f.color ?? b.color)?.toLowerCase() === want) out.push(f.id)
  return out
}

/** Every colour on the solid's faces, with how many faces have it. */
export function faceColors(solid: SolidData, model: Pick<ModelRef, 'faceColors'>): { color: string; faces: number }[] {
  const n = new Map<string, number>()
  for (const b of solid.bodies)
    for (const f of b.faces) {
      const c = (model.faceColors?.[String(f.id)] ?? f.color ?? b.color)?.toLowerCase()
      if (c) n.set(c, (n.get(c) ?? 0) + 1)
    }
  return [...n].map(([color, faces]) => ({ color, faces })).sort((a, b) => b.faces - a.faces || a.color.localeCompare(b.color))
}

export type FaceType = 'flat' | 'hole' | 'round' | 'cone' | 'sphere' | 'free-form'

export function faceType(f: SolidBody['faces'][number]): FaceType {
  const s = f.surface
  if (s.kind === 'plane') return 'flat'
  if (s.kind === 'cylinder') return s.concave ? 'hole' : 'round'
  if (s.kind === 'cone') return 'cone'
  if (s.kind === 'sphere') return 'sphere'
  return 'free-form'
}

/** Faces of a type; for round faces optionally of one diameter (within 0.01 mm). */
export function facesByType(solid: SolidData, type: FaceType, diameter?: number): number[] {
  const out: number[] = []
  for (const b of solid.bodies)
    for (const f of b.faces) {
      if (faceType(f) !== type) continue
      if (diameter !== undefined && (f.surface.r === undefined || Math.abs(f.surface.r * 2 - diameter) > 0.01)) continue
      out.push(f.id)
    }
  return out
}

/** Shapes made from this model's faces whose solid data has changed since they were made. */
export function staleSolidShapes(part: CamPart): Entity[] {
  return part.entities.filter((e) => {
    if (!e.solid) return false
    const m = part.models?.find((x) => x.id === e.solid!.modelId)
    return !m || m.blob !== e.solid.blob
  })
}
