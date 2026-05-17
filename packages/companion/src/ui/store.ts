import { createStore } from "zustand/vanilla"
import { useState, useEffect } from "react"

export interface Message {
  id: string
  type: string
  role?: "user" | "assistant" | "system"
  content?: string
  toolName?: string
  toolInput?: Record<string, unknown>
  toolResult?: string
  timestamp: number
}

export interface PermissionRequest {
  request_id: string
  tool_name: string
  input: Record<string, unknown>
  tool_use_id: string
  description?: string
}

export interface Session {
  id: string
  status: string
  model?: string
  messages: Message[]
  createdAt?: number
  updatedAt?: number
  cliSessionId?: string
  cwd?: string
}

interface AppState {
  sessionId: string | null
  ws: WebSocket | null
  connected: boolean
  messages: Message[]
  pendingPermissions: PermissionRequest[]
  input: string
  sessions: Session[]

  setSessionId: (id: string | null) => void
  setWs: (ws: WebSocket | null) => void
  setConnected: (connected: boolean) => void
  addMessage: (message: Message) => void
  setMessages: (messages: Message[]) => void
  addPermission: (permission: PermissionRequest) => void
  removePermission: (requestId: string) => void
  setInput: (input: string) => void
  setSessions: (sessions: Session[]) => void
  connect: (sessionId: string) => void
  disconnect: () => void
  sendMessage: (content: string) => void
  respondToPermission: (requestId: string, allowed: boolean) => void
  createSession: () => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
}

export const store = createStore<AppState>((set, get) => ({
  sessionId: null,
  ws: null,
  connected: false,
  messages: [],
  pendingPermissions: [],
  input: "",
  sessions: [],

  setSessionId: (id: string | null) => set({ sessionId: id }),
  setWs: (ws: WebSocket | null) => set({ ws }),
  setConnected: (connected: boolean) => set({ connected }),

  addMessage: (message: Message) =>
    set((state: AppState) => ({
      messages: [...state.messages, message],
    })),

  setMessages: (messages: Message[]) => set({ messages }),

  addPermission: (permission: PermissionRequest) =>
    set((state: AppState) => ({
      pendingPermissions: [...state.pendingPermissions, permission],
    })),

  removePermission: (requestId: string) =>
    set((state: AppState) => ({
      pendingPermissions: state.pendingPermissions.filter((p: PermissionRequest) => p.request_id !== requestId),
    })),

  setInput: (input: string) => set({ input }),

  setSessions: (sessions: Session[]) => set({ sessions }),

  connect: (sessionId: string) => {
    const { ws: existingWs } = get()
    if (existingWs) {
      existingWs.close()
    }

    // Update URL with session parameter
    const url = new URL(window.location.href)
    url.searchParams.set("session", sessionId)
    window.history.pushState({}, "", url.toString())

    const params = new URLSearchParams(window.location.search)
    const customHost = params.get("host")

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    let wsUrl: string

    if (customHost) {
      const customProtocol = customHost.startsWith("https") ? "wss:" : "ws:"
      const host = customHost.replace(/^https?:\/\//, "")
      wsUrl = `${customProtocol}//${host}/ws/browser/${sessionId}`
    } else {
      wsUrl = `${protocol}//${window.location.host}/ws/browser/${sessionId}`
    }

    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      console.log("[ws] Connected")
      set({ connected: true, ws })
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        if (data.type === "session_history") {
          const messages = data.messages.map((m: any, i: number) => ({
            id: m.uuid || `msg-${i}`,
            type: m.type,
            content: m.message?.content?.[0]?.text || "",
            toolName: m.request?.tool_name,
            toolInput: m.request?.input,
            toolResult: m.message?.content,
            timestamp: Date.now(),
          }))
          set({ messages })
        } else if (data.type === "permission_request") {
          const permission: PermissionRequest = {
            request_id: data.request.request_id,
            tool_name: data.request.request.tool_name,
            input: data.request.request.input,
            tool_use_id: data.request.request.tool_use_id,
            description: data.request.request.description,
          }
          get().addPermission(permission)
        } else if (data.type === "assistant" || data.type === "result") {
          const msg: Message = {
            id: data.uuid || `msg-${Date.now()}`,
            type: data.type,
            content: data.message?.content?.[0]?.text || data.result,
            timestamp: Date.now(),
          }
          get().addMessage(msg)
        } else if (data.type === "control_request" && data.request?.subtype === "can_use_tool") {
          const msg: Message = {
            id: data.request_id || `msg-${Date.now()}`,
            type: "tool_use",
            toolName: data.request.tool_name,
            toolInput: data.request.input,
            timestamp: Date.now(),
          }
          get().addMessage(msg)
        }
      } catch (e) {
        console.error("[ws] Failed to parse message:", e)
      }
    }

    ws.onclose = () => {
      console.log("[ws] Disconnected")
      set({ connected: false, ws: null })
    }

    ws.onerror = (err) => {
      console.error("[ws] Error:", err)
    }

    set({ sessionId: sessionId, ws })
  },

  disconnect: () => {
    const { ws } = get()
    if (ws) {
      ws.close()
    }
    set({ sessionId: null, ws: null, connected: false, messages: [] })
  },

  sendMessage: (content: string) => {
    const { ws, sessionId } = get()
    if (!ws || !sessionId || !ws.readyState) return

    const msg = {
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      session_id: sessionId,
    }

    ws.send(JSON.stringify(msg))
  },

  respondToPermission: (requestId: string, allowed: boolean) => {
    const { ws } = get()
    if (!ws) return

    const msg = {
      type: "control_response",
      response: {
        subtype: "success",
        request_id: requestId,
        response: {
          behavior: allowed ? "allow" : "deny",
          updatedInput: {},
        },
      },
    }

    ws.send(JSON.stringify(msg))
    get().removePermission(requestId)
  },

  createSession: async () => {
    try {
      const response = await fetch("/companion/api/sessions", { method: "POST" })
      const data = await response.json()
      if (data.sessionId) {
        const { sessions } = get()
        set({ sessions: [...sessions, { id: data.sessionId, status: "waiting", messages: [] }] })
        get().connect(data.sessionId)
      }
    } catch (e) {
      console.error("Failed to create session:", e)
    }
  },

  deleteSession: async (sessionId: string) => {
    try {
      await fetch(`/companion/api/sessions/${sessionId}`, { method: "DELETE" })
      const { sessions, sessionId: currentSession } = get()
      set({ sessions: sessions.filter((s: Session) => s.id !== sessionId) })
      if (currentSession === sessionId) {
        get().disconnect()
      }
    } catch (e) {
      console.error("Failed to delete session:", e)
    }
  },
}))

export function useStore<T>(selector: (state: AppState) => T): T {
  const [state, setState] = useState<T>(() => selector(store.getState()))

  useEffect(() => {
    const unsubscribe = store.subscribe((state: AppState) => {
      const newValue = selector(state)
      setState(newValue)
    })
    return unsubscribe
  }, [])

  return state
}

export function useStoreSubscribe<T>(selector: (state: AppState) => T, callback: (value: T) => void) {
  callback(selector(store.getState()))
  return store.subscribe((state: AppState) => callback(selector(state)))
}
