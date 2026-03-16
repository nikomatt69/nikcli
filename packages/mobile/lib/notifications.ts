import * as Notifications from "expo-notifications"
import { Platform } from "react-native"
import { useUIStore } from "@/lib/store"

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
})

const recentNotifications = new Map<string, number>()

function canNotify(kind: "sessionReady" | "permissions" | "failures") {
  const prefs = useUIStore.getState().notifications
  if (!prefs.enabled || Platform.OS === "web") return false
  if (kind === "sessionReady") return prefs.sessionReady
  if (kind === "permissions") return prefs.permissions
  return prefs.failures
}

export async function ensureNotificationPermissions(requestIfNeeded = false) {
  if (Platform.OS === "web") return false
  const current = await Notifications.getPermissionsAsync()
  if (current.granted) return true
  if (!requestIfNeeded) return false
  const asked = await Notifications.requestPermissionsAsync()
  return asked.granted
}

export async function sendLocalNotification(input: {
  kind: "sessionReady" | "permissions" | "failures"
  title: string
  body: string
  dedupeKey?: string
}) {
  if (!canNotify(input.kind)) return false

  const granted = await ensureNotificationPermissions(false)
  if (!granted) return false

  const dedupeKey = input.dedupeKey ?? `${input.kind}:${input.title}:${input.body}`
  const now = Date.now()
  const last = recentNotifications.get(dedupeKey)
  if (last && now - last < 8_000) return false
  recentNotifications.set(dedupeKey, now)

  await Notifications.scheduleNotificationAsync({
    content: {
      title: input.title,
      body: input.body,
      sound: false,
      data: { kind: input.kind },
    },
    trigger: null,
  })

  return true
}
