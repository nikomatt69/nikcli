import * as Linking from "expo-linking"
import * as LiveActivity from "expo-live-activity"
import * as Notifications from "expo-notifications"
import { AppState, Platform } from "react-native"
import { getLiveActivityRegistry, setLiveActivityRegistry } from "@/lib/storage"
import { useUIStore } from "@/lib/store"
import { compactActivityText } from "@/lib/text-utils"
import type { SessionDetail } from "@/lib/types"

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
})

const recentNotifications = new Map<string, number>()
const MAX_DEDUPE_ENTRIES = 200
const MOBILE_CHANNEL_ID = "nikcli-mobile"
const liveActivityIDs = new Map<string, string>()
const liveActivitySignatures = new Map<string, string>()
const liveActivitySessionsByID = new Map<string, string>()

let liveActivityListenerBound = false
let lastHandledNotificationResponseKey: string | null = null
let liveActivityRegistryPromise: Promise<void> | null = null
let liveActivityUnavailable = false
const hydratedLiveActivitySessions = new Set<string>()

function canNotify(kind: "sessionReady" | "permissions" | "failures") {
  const prefs = useUIStore.getState().notifications
  if (!prefs.enabled || Platform.OS === "web") return false
  if (kind === "sessionReady") return prefs.sessionReady
  if (kind === "permissions") return prefs.permissions
  return prefs.failures
}

function canManageLiveActivities() {
  if (liveActivityUnavailable || Platform.OS !== "ios") return false

  const version = typeof Platform.Version === "string" ? Number.parseFloat(Platform.Version) : Number(Platform.Version)
  return Number.isFinite(version) && version >= 16.2
}

async function ensureLiveActivityRegistryLoaded() {
  if (!canManageLiveActivities()) return
  if (liveActivityRegistryPromise) return liveActivityRegistryPromise

  liveActivityRegistryPromise = getLiveActivityRegistry()
    .then((registry) => {
      for (const [sessionID, activityID] of Object.entries(registry)) {
        liveActivityIDs.set(sessionID, activityID)
        liveActivitySessionsByID.set(activityID, sessionID)
        hydratedLiveActivitySessions.add(sessionID)
      }
    })
    .catch(() => undefined)

  return liveActivityRegistryPromise
}

async function persistLiveActivityRegistry() {
  await setLiveActivityRegistry(Object.fromEntries(liveActivityIDs.entries())).catch(() => undefined)
}

async function purgeSessionLiveActivity(sessionID: string, title = "Nikcli session", subtitle = "Session unavailable") {
  const activityID = liveActivityIDs.get(sessionID)

  if (activityID && canManageLiveActivities()) {
    try {
      await LiveActivity.stopActivity(activityID, buildLiveActivityState({ title, subtitle }))
    } catch {
      // ignore stop failures during forced cleanup
    }
  }

  liveActivityIDs.delete(sessionID)
  liveActivitySignatures.delete(sessionID)
  hydratedLiveActivitySessions.delete(sessionID)
  if (activityID) liveActivitySessionsByID.delete(activityID)
  await persistLiveActivityRegistry()
}

function notificationHrefFromData(data: unknown) {
  if (!data || typeof data !== "object") return null

  const href = Reflect.get(data, "href")
  if (typeof href === "string" && href.trim()) return href

  const sessionID = Reflect.get(data, "sessionID")
  if (typeof sessionID === "string" && sessionID.trim()) return sessionRoute(sessionID)

  return null
}

function sessionRoute(sessionID: string) {
  return `/sessions/${sessionID}`
}

function sessionDeepLink(sessionID: string) {
  try {
    return Linking.createURL(sessionRoute(sessionID))
  } catch {
    return `nikcli://sessions/${sessionID}`
  }
}

function buildPersistedActivitySnapshot(detail: SessionDetail) {
  const title = compactActivityText(detail.info.title || "Nikcli session", 64)

  if (detail.permissions.length > 0) {
    const firstPermission = compactActivityText(detail.permissions[0]?.permission || "Approval needed", 54)
    const subtitle =
      detail.permissions.length === 1
        ? `Approval needed: ${firstPermission}`
        : `${detail.permissions.length} approvals pending`

    return { mode: "upsert" as const, title, subtitle }
  }

  if (detail.status?.type === "retry") {
    return {
      mode: "upsert" as const,
      title,
      subtitle: compactActivityText(`Retry ${detail.status.attempt}: ${detail.status.message}`, 72),
      countdownTo: detail.status.next,
    }
  }

  if (detail.status?.type === "busy") {
    const workspace = compactActivityText(
      detail.info.github?.fullName || detail.info.directory || "Running session",
      72,
    )
    return { mode: "upsert" as const, title, subtitle: workspace }
  }

  if (detail.status?.type === "idle") {
    const subtitle = detail.info.github?.pullRequest ? "GitHub work ready" : "Ready for next command"
    return { mode: "stop" as const, title, subtitle }
  }

  return null
}

function buildLiveActivityState(input: {
  title: string
  subtitle?: string
  countdownTo?: number
  progress?: number
}): LiveActivity.LiveActivityState {
  return {
    title: input.title,
    ...(input.subtitle ? { subtitle: input.subtitle } : {}),
    ...(typeof input.countdownTo === "number"
      ? { progressBar: { date: input.countdownTo } }
      : typeof input.progress === "number"
        ? { progressBar: { progress: input.progress } }
        : {}),
  }
}

function bindLiveActivityListener() {
  if (liveActivityListenerBound || !canManageLiveActivities()) return

  try {
    LiveActivity.addActivityUpdatesListener((event) => {
      if (event.activityState !== "dismissed" && event.activityState !== "ended") return

      const sessionID = liveActivitySessionsByID.get(event.activityID)
      if (!sessionID) return

      liveActivityIDs.delete(sessionID)
      liveActivitySignatures.delete(sessionID)
      liveActivitySessionsByID.delete(event.activityID)
      void persistLiveActivityRegistry()
    })
    liveActivityListenerBound = true
  } catch {
    liveActivityUnavailable = true
  }
}

function consumeNotificationHref(response?: Notifications.NotificationResponse | null) {
  if (!response) return null

  const href = notificationHrefFromData(response.notification.request.content.data)
  if (!href) return null

  const key = `${response.notification.request.identifier}:${href}`
  if (lastHandledNotificationResponseKey === key) return null

  lastHandledNotificationResponseKey = key
  return href
}

export async function ensureNotificationPermissions(requestIfNeeded = false) {
  if (Platform.OS === "web") return false
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(MOBILE_CHANNEL_ID, {
      name: "Nikcli Mobile",
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 120],
      lightColor: "#38bdf8",
    }).catch(() => undefined)
  }
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
  href?: string
  sessionID?: string
}) {
  if (!canNotify(input.kind)) return false
  if (AppState.currentState === "active") return false

  const granted = await ensureNotificationPermissions(false)
  if (!granted) return false

  const dedupeKey = input.dedupeKey ?? `${input.kind}:${input.title}:${input.body}`
  const now = Date.now()
  const last = recentNotifications.get(dedupeKey)
  if (last && now - last < 8_000) return false

  if (recentNotifications.size >= MAX_DEDUPE_ENTRIES) {
    const oldest = [...recentNotifications.entries()].sort((a, b) => a[1] - b[1]).slice(0, 50)
    for (const [key] of oldest) recentNotifications.delete(key)
  }
  recentNotifications.set(dedupeKey, now)

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: input.title,
        body: input.body,
        sound: false,
        data: {
          kind: input.kind,
          ...(input.href ? { href: input.href } : {}),
          ...(input.sessionID ? { sessionID: input.sessionID } : {}),
        },
        ...(Platform.OS === "android" ? { channelId: MOBILE_CHANNEL_ID } : {}),
      },
      trigger: null,
    })
  } catch {
    return false
  }

  return true
}

export async function consumeInitialNotificationHref() {
  if (Platform.OS === "web") return null
  const response = await Notifications.getLastNotificationResponseAsync()
  const href = consumeNotificationHref(response)
  if (href) {
    await Notifications.clearLastNotificationResponseAsync().catch(() => undefined)
  }
  return href
}

export function addNotificationNavigationListener(onNavigate: (href: string) => void) {
  if (Platform.OS === "web") return () => undefined

  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const href = consumeNotificationHref(response)
    if (href) onNavigate(href)
  })

  return () => {
    subscription.remove()
  }
}

export async function upsertSessionLiveActivity(input: {
  sessionID: string
  title: string
  subtitle?: string
  countdownTo?: number
  progress?: number
}) {
  if (!canManageLiveActivities()) return false

  await ensureLiveActivityRegistryLoaded()
  bindLiveActivityListener()
  if (!canManageLiveActivities()) return false

  const state = buildLiveActivityState(input)
  const signature = JSON.stringify(state)
  if (liveActivitySignatures.get(input.sessionID) === signature) return true

  const activityID = liveActivityIDs.get(input.sessionID)
  const config: LiveActivity.LiveActivityConfig = {
    deepLinkUrl: sessionDeepLink(input.sessionID),
    timerType: "digital",
  }

  if (activityID) {
    try {
      await LiveActivity.updateActivity(activityID, state)
      hydratedLiveActivitySessions.delete(input.sessionID)
      liveActivitySignatures.set(input.sessionID, signature)
      return true
    } catch {
      if (hydratedLiveActivitySessions.has(input.sessionID)) {
        liveActivityIDs.delete(input.sessionID)
        liveActivitySessionsByID.delete(activityID)
        liveActivitySignatures.delete(input.sessionID)
        hydratedLiveActivitySessions.delete(input.sessionID)
        await persistLiveActivityRegistry()
        return upsertSessionLiveActivity(input)
      }

      liveActivitySignatures.delete(input.sessionID)
      return false
    }
  }

  try {
    const createdActivityID = LiveActivity.startActivity(state, config)
    if (!createdActivityID) return false

    liveActivityIDs.set(input.sessionID, createdActivityID)
    liveActivitySignatures.set(input.sessionID, signature)
    liveActivitySessionsByID.set(createdActivityID, input.sessionID)
    hydratedLiveActivitySessions.delete(input.sessionID)
    await persistLiveActivityRegistry()
    return true
  } catch {
    return false
  }
}

export async function stopSessionLiveActivity(input: { sessionID: string; title: string; subtitle?: string }) {
  if (!canManageLiveActivities()) return false

  await ensureLiveActivityRegistryLoaded()
  const activityID = liveActivityIDs.get(input.sessionID)
  if (!activityID) return false

  try {
    await LiveActivity.stopActivity(activityID, buildLiveActivityState(input))
    liveActivityIDs.delete(input.sessionID)
    liveActivitySignatures.delete(input.sessionID)
    liveActivitySessionsByID.delete(activityID)
    hydratedLiveActivitySessions.delete(input.sessionID)
    await persistLiveActivityRegistry()
    return true
  } catch {
    return false
  }
}

export async function reconcilePersistedLiveActivities(
  loadSession: (sessionID: string) => Promise<SessionDetail | null>,
) {
  if (!canManageLiveActivities()) return

  await ensureLiveActivityRegistryLoaded()

  for (const [sessionID] of liveActivityIDs.entries()) {
    const detail = await loadSession(sessionID).catch(() => null)
    if (!detail) {
      await purgeSessionLiveActivity(sessionID)
      continue
    }

    const snapshot = buildPersistedActivitySnapshot(detail)
    if (!snapshot) continue

    if (snapshot.mode === "upsert") {
      await upsertSessionLiveActivity({
        sessionID,
        title: snapshot.title,
        subtitle: snapshot.subtitle,
        countdownTo: snapshot.countdownTo,
      })
      continue
    }

    await stopSessionLiveActivity({
      sessionID,
      title: snapshot.title,
      subtitle: snapshot.subtitle,
    })
  }
}
