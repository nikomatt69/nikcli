import { create } from "zustand"
import type { SSEEvent, EventFilter } from "../types"

interface EventsState {
  events: Record<string, SSEEvent>
  eventIds: string[]
  unreadCount: number
  filter: EventFilter

  addEvent: (event: SSEEvent) => void
  markRead: (id: string) => void
  markAllRead: () => void
  clearEvents: () => void
  setFilter: (filter: EventFilter) => void
  getFilteredEvents: () => SSEEvent[]
}

export const useEventsStore = create<EventsState>()((set, get) => ({
  events: {},
  eventIds: [],
  unreadCount: 0,
  filter: {},

  addEvent: (event: SSEEvent) => {
    const existing = get().events[event.id ?? ""]

    if (existing && JSON.stringify(existing.data) === JSON.stringify(event.data)) {
      return
    }

    set((state) => {
      const id = event.id ?? `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
      const newEvents = { ...state.events, [id]: { ...event, id } }
      const newIds = [id, ...state.eventIds.filter((eid) => eid !== id)].slice(0, 1000)

      return {
        events: newEvents,
        eventIds: newIds,
        unreadCount: state.unreadCount + 1,
      }
    })
  },

  markRead: (id: string) => {
    set((state) => ({
      unreadCount: Math.max(0, state.unreadCount - 1),
    }))
  },

  markAllRead: () => {
    set({ unreadCount: 0 })
  },

  clearEvents: () => {
    set({
      events: {},
      eventIds: [],
      unreadCount: 0,
    })
  },

  setFilter: (filter: EventFilter) => {
    set({ filter })
  },

  getFilteredEvents: () => {
    const { events, eventIds, filter } = get()

    let filtered = eventIds.map((id) => events[id]).filter((e): e is SSEEvent => e !== undefined)

    if (filter.types && filter.types.length > 0) {
      filtered = filtered.filter((e) => {
        const eventType =
          typeof e.data === "object" && e.data !== null ? (e.data as Record<string, unknown>).type : undefined
        return eventType && filter.types!.includes(eventType as string)
      })
    }

    if (filter.search) {
      const search = filter.search.toLowerCase()
      filtered = filtered.filter((e) => {
        const dataStr = JSON.stringify(e.data).toLowerCase()
        return dataStr.includes(search)
      })
    }

    if (filter.dateRange) {
      filtered = filtered.filter(
        (e) => e.timestamp >= filter.dateRange!.start.getTime() && e.timestamp <= filter.dateRange!.end.getTime(),
      )
    }

    return filtered
  },
}))
