import { create } from "zustand"
import type { Session, Message, MessagePart } from "../types"

interface SessionsState {
  sessions: Record<string, Session>
  sessionIds: string[]
  activeSessionId: string | null
  messages: Record<string, Message[]>
  selectedMessageId: string | null

  upsertSession: (session: Session) => void
  removeSession: (id: string) => void
  setActive: (id: string | null) => void
  updateSessionStatus: (id: string, status: Session["status"]) => void
  appendMessage: (sessionId: string, message: Message) => void
  updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => void
  setMessages: (sessionId: string, messages: Message[]) => void
  selectMessage: (id: string | null) => void
  getSession: (id: string) => Session | null
  getActiveSession: () => Session | null
  getSessionMessages: (sessionId: string) => Message[]
}

export const useSessionsStore = create<SessionsState>()((set, get) => ({
  sessions: {},
  sessionIds: [],
  activeSessionId: null,
  messages: {},
  selectedMessageId: null,

  upsertSession: (session: Session) => {
    set((state) => {
      const exists = !!state.sessions[session.id]
      const newSessions = { ...state.sessions, [session.id]: session }
      const newIds = exists ? state.sessionIds : [session.id, ...state.sessionIds]

      return {
        sessions: newSessions,
        sessionIds: newIds,
      }
    })
  },

  removeSession: (id: string) => {
    set((state) => {
      const { [id]: removed, ...remainingSessions } = state.sessions
      const newIds = state.sessionIds.filter((sid) => sid !== id)
      const { [id]: removedMessages, ...remainingMessages } = state.messages

      return {
        sessions: remainingSessions,
        sessionIds: newIds,
        messages: remainingMessages,
        activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
      }
    })
  },

  setActive: (id: string | null) => {
    set({ activeSessionId: id })
  },

  updateSessionStatus: (id: string, status: Session["status"]) => {
    set((state) => {
      const session = state.sessions[id]
      if (!session) return state

      return {
        sessions: {
          ...state.sessions,
          [id]: { ...session, status, lastActivity: new Date() },
        },
      }
    })
  },

  appendMessage: (sessionId: string, message: Message) => {
    set((state) => {
      const session = state.sessions[sessionId]
      if (!session) return state

      const sessionMessages = state.messages[sessionId] ?? []
      const messageExists = sessionMessages.some((m) => m.id === message.id)
      if (messageExists) return state

      const newMessages = {
        ...state.messages,
        [sessionId]: [...sessionMessages, message],
      }

      return {
        messages: newMessages,
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            messageCount: sessionMessages.length + 1,
            lastActivity: new Date(),
          },
        },
      }
    })
  },

  updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => {
    set((state) => {
      const sessionMessages = state.messages[sessionId]
      if (!sessionMessages) return state

      return {
        messages: {
          ...state.messages,
          [sessionId]: sessionMessages.map((m) => (m.id === messageId ? { ...m, ...updates } : m)),
        },
      }
    })
  },

  setMessages: (sessionId: string, messages: Message[]) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [sessionId]: messages,
      },
    }))
  },

  selectMessage: (id: string | null) => {
    set({ selectedMessageId: id })
  },

  getSession: (id: string) => {
    return get().sessions[id] ?? null
  },

  getActiveSession: () => {
    const { activeSessionId, sessions } = get()
    if (!activeSessionId) return null
    return sessions[activeSessionId] ?? null
  },

  getSessionMessages: (sessionId: string) => {
    return get().messages[sessionId] ?? []
  },
}))
