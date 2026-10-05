/** Faces picked in the 3D view (solid models), shared by the view and the side panel. */
import { create } from 'zustand'

interface FacePick {
  modelId: string | null
  faces: number[]
  /** Pick one face; `add` (Shift) adds or removes it from the picked set. */
  pick(modelId: string, face: number, add: boolean): void
  set(modelId: string, faces: number[]): void
  clear(): void
}

export const useFacePick = create<FacePick>((set) => ({
  modelId: null,
  faces: [],
  pick: (modelId, face, add) =>
    set((s) => {
      if (!add || s.modelId !== modelId) return { modelId, faces: [face] }
      return { modelId, faces: s.faces.includes(face) ? s.faces.filter((f) => f !== face) : [...s.faces, face] }
    }),
  set: (modelId, faces) => set({ modelId, faces: [...faces] }),
  clear: () => set({ modelId: null, faces: [] }),
}))
