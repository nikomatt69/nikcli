import { createContext, useContext, createSignal, createEffect, type JSX } from "solid-js"
import type { Session } from "@nikcli-ai/sdk/v2"
import { useApi } from "./api"
import { useApp } from "./app"

interface SessionContextValue {
  sessions: () => Session[]
  activeSession: () => Session | null
  createSession: (title?: string) => Promise<Session | null>
  closeSession: (id: string) => Promise<boolean>
  activateSession: (id: string) => void
  refresh: () => Promise<void>
}

const SessionContext = createContext<SessionContextValue>()

export function SessionProvider(props: { children: JSX.Element }) {
  const { sdk, directory } = useApi()
  const { setError } = useApp()
  const [sessions, setSessions] = createSignal<Session[]>([])
  const [active, setActive] = createSignal<string | null>(null)

  const activeSession = () => {
    const id = active()
    return sessions().find((s) => s.id === id) || null
  }

  const refresh = async () => {
    const dir = directory() || undefined
    const result = await sdk().session.list({ directory: dir, limit: 50 })
    if (result.error) {
      const code = result.response?.status
      const message = code === 401 ? "Authentication required to load sessions." : "Failed to load sessions."
      setError(message)
      return
    }
    setError(null)
    const items = result.data || []
    setSessions(items)
    const current = active()
    if (current && items.some((item) => item.id === current)) return
    setActive(items[0]?.id ?? null)
  }

  const createSession = async (title?: string) => {
    const name = title?.trim()
    const dir = directory() || undefined
    const params = name ? { directory: dir, title: name } : { directory: dir }
    const result = await sdk().session.create(params)
    if (result.error || !result.data) {
      setError("Failed to create session.")
      return null
    }
    setError(null)
    const session = result.data
    setSessions((prev) => [session, ...prev])
    setActive(session.id)
    return session
  }

  const closeSession = async (id: string) => {
    const dir = directory() || undefined
    const result = await sdk().session.delete({ sessionID: id, directory: dir })
    if (result.error) {
      setError("Failed to delete session.")
      return false
    }
    setError(null)
    const next = sessions().filter((item) => item.id !== id)
    setSessions(next)
    if (active() === id) {
      setActive(next[0]?.id ?? null)
    }
    return true
  }

  const activateSession = (id: string) => {
    setActive(id)
  }

  createEffect(() => {
    sdk()
    void refresh()
  })

  return (
    <SessionContext.Provider
      value={{
        sessions,
        activeSession,
        createSession,
        closeSession,
        activateSession,
        refresh,
      }}
    >
      {props.children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  const context = useContext(SessionContext)
  if (!context) {
    throw new Error("useSession must be used within SessionProvider")
  }
  return context
}
