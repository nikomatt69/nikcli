import { useEffect, useMemo, useCallback, useRef } from "react"
import mitt from "mitt"
import { useConnectionStore, useEventsStore, useSessionsStore, useSettingsStore } from "../stores"
import type { SSEEvent, MessagePart } from "../types"

type EventBusEvents = {
  "server.connected": SSEEvent
  "server.heartbeat": SSEEvent
  "server.instance.disposed": SSEEvent
  "global.disposed": SSEEvent
  "installation.updated": SSEEvent
  "installation.update-available": SSEEvent
  "project.updated": SSEEvent
  "session.created": SSEEvent
  "session.updated": SSEEvent
  "session.deleted": SSEEvent
  "session.status": SSEEvent
  "session.idle": SSEEvent
  "session.compacted": SSEEvent
  "session.diff": SSEEvent
  "session.error": SSEEvent
  "message.updated": SSEEvent
  "message.removed": SSEEvent
  "message.part.updated": SSEEvent
  "message.part.removed": SSEEvent
  "permission.asked": SSEEvent
  "permission.replied": SSEEvent
  "question.asked": SSEEvent
  "question.replied": SSEEvent
  "question.rejected": SSEEvent
  "dbedit.asked": SSEEvent
  "dbedit.replied": SSEEvent
  "todo.updated": SSEEvent
  "file.edited": SSEEvent
  "file.watcher.updated": SSEEvent
  "lsp.client.diagnostics": SSEEvent
  "lsp.updated": SSEEvent
  "vcs.branch.updated": SSEEvent
  "pty.created": SSEEvent
  "pty.updated": SSEEvent
  "pty.exited": SSEEvent
  "pty.deleted": SSEEvent
  "mcp.tools.changed": SSEEvent
  "mcp.browser.open.failed": SSEEvent
  "command.executed": SSEEvent
  "tui.prompt.append": SSEEvent
  "tui.command.execute": SSEEvent
  "tui.toast.show": SSEEvent
  "tui.session.select": SSEEvent
}

export function useEventBus() {
  const emitter = useMemo(() => mitt<EventBusEvents>(), [])
  const connectionStore = useConnectionStore()
  const eventsStore = useEventsStore()
  const sessionsStore = useSessionsStore()
  const settingsStore = useSettingsStore()
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    const handlers: Record<string, (event: SSEEvent) => void> = {
      "server.connected": () => {
        connectionStore.setConnected()
      },

      "server.heartbeat": () => {
        connectionStore.updateLastEvent()
      },

      "session.created": (event) => {
        const data = event.data as Record<string, unknown> | undefined
        if (data?.properties) {
          const props = data.properties as Record<string, unknown>
          sessionsStore.upsertSession({
            id: props.id as string,
            name: props.name as string,
            status: (props.status as Session["status"]) || "idle",
            createdAt: new Date((props.createdAt as number) || Date.now()),
            lastActivity: new Date(),
            messageCount: 0,
            metadata: props as Record<string, unknown>,
          })
        }
      },

      "session.updated": (event) => {
        const data = event.data as Record<string, unknown> | undefined
        if (data?.properties) {
          const props = data.properties as Record<string, unknown>
          sessionsStore.upsertSession({
            id: props.id as string,
            name: props.name as string,
            status: (props.status as Session["status"]) || "idle",
            createdAt: new Date((props.createdAt as number) || Date.now()),
            lastActivity: new Date(),
            messageCount: (props.messageCount as number) || 0,
            metadata: props as Record<string, unknown>,
          })
        }
      },

      "session.status": (event) => {
        const data = event.data as Record<string, unknown> | undefined
        if (data?.properties) {
          const props = data.properties as Record<string, unknown>
          sessionsStore.updateSessionStatus(props.id as string, props.status as Session["status"])
        }
      },

      "session.error": (event) => {
        const data = event.data as Record<string, unknown> | undefined
        if (data?.properties) {
          const props = data.properties as Record<string, unknown>
          sessionsStore.updateSessionStatus(props.id as string, "error")
        }
      },

      "message.updated": (event) => {
        const data = event.data as Record<string, unknown> | undefined
        if (data?.properties) {
          const props = data.properties as Record<string, unknown>
          const parts = props.parts as Array<{ id: string; type: string; content: string }> | undefined
          sessionsStore.appendMessage(props.sessionId as string, {
            id: props.id as string,
            sessionId: props.sessionId as string,
            role: (props.role as "user" | "assistant" | "system") || "assistant",
            content: props.content as string,
            createdAt: new Date((props.createdAt as number) || Date.now()),
            parts: parts?.map((p) => ({
              id: p.id,
              type: p.type as MessagePart["type"],
              content: p.content,
            })),
          })
        }
      },

      "message.part.updated": (event) => {
        const data = event.data as Record<string, unknown> | undefined
        if (data?.properties) {
          const props = data.properties as Record<string, unknown>
          const messages = sessionsStore.getSessionMessages(props.sessionId as string)
          const message = messages.find((m) => m.id === props.messageId)
          if (message) {
            const part = props.part as { id: string; type: string; content: string }
            sessionsStore.updateMessage(props.sessionId as string, props.messageId as string, {
              parts: [
                ...(message.parts || []),
                { id: part.id, type: part.type as MessagePart["type"], content: part.content },
              ],
            })
          }
        }
      },

      "permission.asked": (event) => {
        if (settingsStore.notifications) {
          const data = event.data as Record<string, unknown> | undefined
          settingsStore.addNotification({
            id: event.id || `perm_${Date.now()}`,
            title: "Permission Request",
            body: ((data?.properties as Record<string, unknown>)?.description as string) || "A permission is required",
            type: "info",
            timestamp: new Date(event.timestamp),
            read: false,
          })
        }
      },

      "tui.toast.show": (event) => {
        const data = event.data as Record<string, unknown> | undefined
        if (data?.properties) {
          const props = data.properties as Record<string, unknown>
          settingsStore.addNotification({
            id: event.id || `toast_${Date.now()}`,
            title: (props.title as string) || "Notification",
            body: (props.message as string) || "",
            type: (props.variant as "info" | "success" | "warning" | "error") || "info",
            timestamp: new Date(event.timestamp),
            read: false,
          })
        }
      },

      "file.edited": () => {},

      "lsp.client.diagnostics": () => {},

      "command.executed": (event) => {
        const data = event.data as Record<string, unknown> | undefined
        if (data?.properties) {
          const props = data.properties as Record<string, unknown>
          settingsStore.addNotification({
            id: event.id || `cmd_${Date.now()}`,
            title: "Command Executed",
            body: `Command: ${(props.command as string) || "unknown"}`,
            type: "info",
            timestamp: new Date(event.timestamp),
            read: false,
          })
        }
      },

      "tui.prompt.append": () => {},

      "tui.command.execute": () => {},

      "session.deleted": (event) => {
        const data = event.data as Record<string, unknown> | undefined
        if (data?.properties) {
          sessionsStore.removeSession((data.properties as Record<string, unknown>).id as string)
        }
      },
    }

    for (const [eventType, handler] of Object.entries(handlers)) {
      emitter.on(eventType as keyof EventBusEvents, handler as (event: SSEEvent) => void)
    }

    return () => {
      mountedRef.current = false
      emitter.all.clear()
    }
  }, [emitter, connectionStore, sessionsStore, settingsStore, eventsStore])

  const emit = useCallback(
    <E extends keyof EventBusEvents>(event: E, data: EventBusEvents[E]) => {
      if (mountedRef.current) {
        emitter.emit(event, data)
      }
    },
    [emitter],
  )

  const on = useCallback(
    <E extends keyof EventBusEvents>(event: E, handler: (event: EventBusEvents[E]) => void) => {
      emitter.on(event, handler)
      return () => emitter.off(event, handler)
    },
    [emitter],
  )

  const off = useCallback(
    <E extends keyof EventBusEvents>(event: E, handler?: (event: EventBusEvents[E]) => void) => {
      if (handler) {
        emitter.off(event, handler)
      } else {
        emitter.off(event)
      }
    },
    [emitter],
  )

  return {
    emit,
    on,
    off,
    emitter,
  }
}

type Session = ReturnType<typeof useSessionsStore> extends { sessions: infer T } ? T : never
