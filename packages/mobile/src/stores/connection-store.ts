import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import type { ConnectionStatus } from "../types"

interface ConnectionState {
  status: ConnectionStatus
  serverUrl: string | null
  sessionSecret: string | null
  lastEventAt: number | null
  error: string | null
  reconnectAttempt: number

  connect: (url: string, secret: string) => void
  disconnect: () => void
  setConnected: () => void
  setReconnecting: (attempt: number) => void
  setError: (error: string | null) => void
  updateLastEvent: () => void
  clearError: () => void
}

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set, get) => ({
      status: "idle",
      serverUrl: null,
      sessionSecret: null,
      lastEventAt: null,
      error: null,
      reconnectAttempt: 0,

      connect: (url: string, secret: string) => {
        set({
          serverUrl: url,
          sessionSecret: secret,
          status: "connecting",
          error: null,
          reconnectAttempt: 0,
        })
      },

      disconnect: () => {
        set({
          status: "closed",
          serverUrl: null,
          sessionSecret: null,
          lastEventAt: null,
          reconnectAttempt: 0,
        })
      },

      setConnected: () => {
        set({
          status: "connected",
          error: null,
          reconnectAttempt: 0,
        })
      },

      setReconnecting: (attempt: number) => {
        set({
          status: "reconnecting",
          reconnectAttempt: attempt,
        })
      },

      setError: (error: string | null) => {
        set({ error, status: "error" })
      },

      clearError: () => {
        set({ error: null })
      },

      updateLastEvent: () => {
        set({ lastEventAt: Date.now() })
      },
    }),
    {
      name: "connection-store",
      storage: createJSONStorage(() => ({
        getItem: () => {
          const fn = require("../services/storage").getItem
          return fn("connection-store", null)
        },
        setItem: (_name: string, value: string) => {
          const fn = require("../services/storage").setItem
          fn("connection-store", JSON.parse(value))
        },
        removeItem: () => {
          const fn = require("../services/storage").removeItem
          fn("connection-store")
        },
      })),
      partialize: (state) => ({
        serverUrl: state.serverUrl,
        sessionSecret: state.sessionSecret,
      }),
    },
  ),
)
