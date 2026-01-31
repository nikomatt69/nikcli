import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import type { Notification } from "../types"

interface SettingsState {
  theme: "light" | "dark" | "system"
  notifications: boolean
  sound: boolean
  haptic: boolean
  autoConnect: boolean
  heartbeatInterval: number
  recentNotifications: Notification[]

  setTheme: (theme: "light" | "dark" | "system") => void
  toggleNotifications: () => void
  toggleSound: () => void
  toggleHaptic: () => void
  setAutoConnect: (value: boolean) => void
  setHeartbeatInterval: (ms: number) => void
  addNotification: (notification: Notification) => void
  markNotificationRead: (id: string) => void
  clearNotifications: () => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "system",
      notifications: true,
      sound: true,
      haptic: true,
      autoConnect: false,
      heartbeatInterval: 35000,
      recentNotifications: [],

      setTheme: (theme: "light" | "dark" | "system") => {
        set({ theme })
      },

      toggleNotifications: () => {
        set((state) => ({ notifications: !state.notifications }))
      },

      toggleSound: () => {
        set((state) => ({ sound: !state.sound }))
      },

      toggleHaptic: () => {
        set((state) => ({ haptic: !state.haptic }))
      },

      setAutoConnect: (value: boolean) => {
        set({ autoConnect: value })
      },

      setHeartbeatInterval: (ms: number) => {
        set({ heartbeatInterval: ms })
      },

      addNotification: (notification: Notification) => {
        set((state) => ({
          recentNotifications: [
            { ...notification, read: false },
            ...state.recentNotifications.filter((n) => n.id !== notification.id),
          ].slice(0, 50),
        }))
      },

      markNotificationRead: (id: string) => {
        set((state) => ({
          recentNotifications: state.recentNotifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
        }))
      },

      clearNotifications: () => {
        set({ recentNotifications: [] })
      },
    }),
    {
      name: "settings-store",
      storage: createJSONStorage(() => ({
        getItem: () => {
          const fn = require("../services/storage").getItem
          return fn("settings-store", null)
        },
        setItem: (_name: string, value: string) => {
          const fn = require("../services/storage").setItem
          fn("settings-store", JSON.parse(value))
        },
        removeItem: () => {
          const fn = require("../services/storage").removeItem
          fn("settings-store")
        },
      })),
    },
  ),
)
