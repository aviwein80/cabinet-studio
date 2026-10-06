/**
 * Plan-view drawings of toolpaths (M3.1g): built once per toolpath and kept, simplified for the
 * screen (`displayPaths`). Toolpaths with many points are prepared in the background worker so the
 * screen never stops while one is drawn; until then the canvas shows that it is still drawing.
 * The toolpaths themselves are never changed.
 */
import { useEffect, useState } from 'react'
import { type DisplayPaths, displayPaths, movePoints } from '@/cam/display'
import type { Toolpath } from '@/cam/toolpath'
import { compute } from '@/cam/worker/client'

/** Above this many points a toolpath's drawing is prepared in the background. */
export const BACKGROUND_POINTS = 40_000

const ready = new WeakMap<Toolpath, DisplayPaths>()
const pending = new WeakSet<Toolpath>()

/** The drawing of each toolpath by op id: ready, or null while it is still being prepared. */
export function useDisplayPaths(toolpaths: readonly Toolpath[]): Map<string, DisplayPaths | null> {
  const [, setVersion] = useState(0)
  const out = new Map<string, DisplayPaths | null>()
  for (const tp of toolpaths) {
    let d = ready.get(tp)
    if (!d && movePoints(tp.moves) <= BACKGROUND_POINTS) {
      d = displayPaths(tp)
      ready.set(tp, d)
    }
    out.set(tp.opId, d ?? null)
  }
  useEffect(() => {
    let live = true
    for (const tp of toolpaths) {
      if (ready.has(tp) || pending.has(tp)) continue
      pending.add(tp)
      // (the moves are copied to the worker, never moved: the toolpath keeps them)
      compute()
        .run('toolpath.display', { moves: tp.moves })
        .then(
          (d) => {
            ready.set(tp, d)
            if (live) setVersion((v) => v + 1)
          },
          (e: unknown) => {
            // drawn on the page instead (slow, but never missing)
            console.error(e)
            ready.set(tp, displayPaths(tp))
            if (live) setVersion((v) => v + 1)
          },
        )
        .finally(() => pending.delete(tp))
    }
    return () => {
      live = false
    }
  }, [toolpaths])
  return out
}
