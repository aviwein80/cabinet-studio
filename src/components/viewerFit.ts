type V3 = [number, number, number]

/**
 * Polish-1: where the camera goes when the framed cabinet (or room) changes size. The view keeps
 * its angle about the new centre, and its distance scales with the new size, so a cabinet that grew
 * from 450 to 1200 mm is re-centred and fully in view without reopening the editor.
 */
export function refitCamera(camera: V3, prev: { target: V3; size: number }, next: { target: V3; size: number }): V3 {
  const k = prev.size > 0 ? next.size / prev.size : 1
  return [next.target[0] + (camera[0] - prev.target[0]) * k, next.target[1] + (camera[1] - prev.target[1]) * k, next.target[2] + (camera[2] - prev.target[2]) * k]
}
