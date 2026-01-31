import { createContext, useContext, createSignal, type JSX } from "solid-js"

interface Session {
  id: string
  name: string
  status: "active" | "paused" | "error"
  lastActivity: Date
}

interface SessionContextValue {
  sessions: () => Session[]
  activeSession: () => Session | null
  createSession: (name: string) => void
  closeSession: (id: string) => void
  activateSession: (id: string) => void
}

const SessionContext = createContext<SessionContextValue>()

export function SessionProvider(props: { children: JSX.Element }) {
  const [sessions, setSessions] = createSignal<Session[]>([])
  const [activeSessionId, setActiveSessionId] = createSignal<string | null>(null)

  const activeSession = () => {
    const id = activeSessionId()
    return sessions().find((s) => s.id === id) || null
  }

  const createSession = (name: string) => {
    const session: Session = {
      id: crypto.randomUUID(),
      name,
      status: "active",
      lastActivity: new Date(),
    }
    setSessions((prev) => [...prev, session])
    setActiveSessionId(session.id)
  }

  const closeSession = (id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id))
    if (activeSessionId() === id) {
      setActiveSessionId(null)
    }
  }

  const activateSession = (id: string) => {
    setActiveSessionId(id)
  }

  return (
    <SessionContext.Provider
      value={{
        sessions,
        activeSession,
        createSession,
        closeSession,
        activateSession,
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
