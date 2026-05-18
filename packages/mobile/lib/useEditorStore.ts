import { create } from "zustand"

export type OpenFile = {
  path: string
  absolute: string
  content: string
  dirty: boolean
  savedAt?: number
}

type EditorStore = {
  openFiles: Record<string, OpenFile>
  recentPaths: string[]
  openFile(file: Omit<OpenFile, "dirty">): void
  updateContent(absolute: string, content: string): void
  markSaved(absolute: string): void
  closeFile(absolute: string): void
}

export const useEditorStore = create<EditorStore>((set) => ({
  openFiles: {},
  recentPaths: [],

  openFile(file) {
    set((state) => {
      const existing = state.openFiles[file.absolute]
      return {
        openFiles: {
          ...state.openFiles,
          [file.absolute]: existing ?? { ...file, dirty: false },
        },
        recentPaths: [file.absolute, ...state.recentPaths.filter((p) => p !== file.absolute)].slice(0, 10),
      }
    })
  },

  updateContent(absolute, content) {
    set((state) => {
      const file = state.openFiles[absolute]
      if (!file) return state
      return {
        openFiles: {
          ...state.openFiles,
          [absolute]: { ...file, content, dirty: true },
        },
      }
    })
  },

  markSaved(absolute) {
    set((state) => {
      const file = state.openFiles[absolute]
      if (!file) return state
      return {
        openFiles: {
          ...state.openFiles,
          [absolute]: { ...file, dirty: false, savedAt: Date.now() },
        },
      }
    })
  },

  closeFile(absolute) {
    set((state) => {
      const next = { ...state.openFiles }
      delete next[absolute]
      return { openFiles: next }
    })
  },
}))
