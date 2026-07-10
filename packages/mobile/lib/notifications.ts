import * as Linking from "expo-linking"
import * as Notifications from "expo-notifications"
import { AppState, Platform } from "react-native"
import { getLiveActivityRegistry, setLiveActivityRegistry } from "@/lib/storage"
import { useUIStore } from "@/lib/store"
import type { SessionDetail, ToolPart } from "@/lib/types"
import {
  getSessionLiveActivityInstances,
  startSessionLiveActivity,
  type SessionLiveActivityHandle,
  type SessionLiveActivityProps,
} from "@/widgets/session-live-activity"

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
})

const recentNotifications = new Map<string, number>()
const MAX_DEDUPE_ENTRIES = 200
const MOBILE_CHANNEL_ID = "nikcli-mobile"
const liveActivitySessions = new Set<string>()
const liveActivityInstances = new Map<string, SessionLiveActivityHandle>()
const liveActivitySignatures = new Map<string, string>()

let lastHandledNotificationResponseKey: string | null = null
let liveActivityRegistryPromise: Promise<void> | null = null

function canNotify(kind: "sessionReady" | "permissions" | "failures") {
  const prefs = useUIStore.getState().notifications
  if (!prefs.enabled || Platform.OS === "web") return false
  if (kind === "sessionReady") return prefs.sessionReady
  if (kind === "permissions") return prefs.permissions
  return prefs.failures
}

function canManageLiveActivities() {
  if (Platform.OS !== "ios") return false

  const version = typeof Platform.Version === "string" ? Number.parseFloat(Platform.Version) : Number(Platform.Version)
  return Number.isFinite(version) && version >= 16.2
}

async function ensureLiveActivityRegistryLoaded() {
  if (!canManageLiveActivities()) return
  if (liveActivityRegistryPromise) return liveActivityRegistryPromise

  liveActivityRegistryPromise = (async () => {
    const registry = await getLiveActivityRegistry().catch(() => ({}))
    for (const sessionID of Object.keys(registry)) {
      liveActivitySessions.add(sessionID)
    }

    // expo-widgets deliberately hides native ActivityKit identifiers. End orphaned
    // instances after a process restart, then rebuild them from the persisted session
    // registry so every JavaScript handle remains mapped to the correct session.
    const recovered = getSessionLiveActivityInstances()
    await Promise.all(
      recovered.map(async (instance) => {
        try {
          await instance.end("immediate")
        } catch {
          // The activity may already have been dismissed by the user.
        }
      }),
    )
  })()
    .catch(() => undefined)
    .then(() => undefined)

  return liveActivityRegistryPromise
}

async function persistLiveActivityRegistry() {
  await setLiveActivityRegistry(
    Object.fromEntries(Array.from(liveActivitySessions, (sessionID) => [sessionID, "expo-widgets"])),
  ).catch(() => undefined)
}

async function purgeSessionLiveActivity(sessionID: string) {
  const instance = liveActivityInstances.get(sessionID)

  if (instance && canManageLiveActivities()) {
    try {
      await instance.end("immediate")
    } catch {
      // Ignore cleanup failures for activities already dismissed by the user.
    }
  }

  liveActivityInstances.delete(sessionID)
  liveActivitySessions.delete(sessionID)
  liveActivitySignatures.delete(sessionID)
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

type SessionDeepLinkAction = "review" | "approveOnce" | "stop"

function sessionDeepLink(sessionID: string, action?: SessionDeepLinkAction, requestID?: string) {
  const queryParams = action
    ? {
        liveAction: action,
        ...(requestID ? { requestID } : {}),
      }
    : undefined

  try {
    return Linking.createURL(sessionRoute(sessionID), queryParams ? { queryParams } : undefined)
  } catch {
    const query = queryParams ? `?${new URLSearchParams(queryParams).toString()}` : ""
    return `nikcli://sessions/${encodeURIComponent(sessionID)}${query}`
  }
}

/** Truncate for Lock Screen / Dynamic Island copy; safe to reuse for notifications. */
export function compactActivityText(value: string | null | undefined, limit = 72) {
  if (!value) return ""
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

export type SessionLiveActivitySnapshot =
  | { mode: "upsert"; activity: SessionLiveActivityProps }
  | { mode: "stop"; title: string; subtitle?: string }

function readableActivityLabel(value: string | null | undefined, fallback: string) {
  const normalized = compactActivityText(value, 56)
  if (!normalized) return fallback
  return normalized
    .replace(/^mcp[_:-]+/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (character) => character.toUpperCase())
}

function latestRunningTool(detail: SessionDetail) {
  for (let messageIndex = detail.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const parts = detail.messages[messageIndex]?.parts ?? []
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex]
      if (part?.type !== "tool") continue
      const tool = part as ToolPart
      if (tool.state.status === "running") return tool
    }
  }
  return null
}

function sessionStartedAt(detail: SessionDetail, runningTool: ToolPart | null) {
  if (runningTool?.state.status === "running") return runningTool.state.time.start

  for (let index = detail.messages.length - 1; index >= 0; index -= 1) {
    const message = detail.messages[index]?.info
    if (message?.role === "assistant" && !message.time.completed) return message.time.created
  }

  return detail.info.time.updated || detail.info.time.created
}

function sessionActivityContext(detail: SessionDetail) {
  const github = detail.info.github
  const normalizedDirectory = detail.info.directory.replace(/\/+$/, "")
  const directoryName = normalizedDirectory.split("/").pop() || "workspace"

  return {
    repository: compactActivityText(github?.repo || directoryName, 28),
    branch: compactActivityText(github?.worktree.branch || github?.headBranch || "local workspace", 52),
  }
}

function activityProps(
  detail: SessionDetail,
  input: {
    status: string
    action: string
    startedAt: number
    timerEndsAt?: number
    attention?: boolean
    permissionID?: string
    canStop?: boolean
  },
): SessionLiveActivityProps {
  const context = sessionActivityContext(detail)
  const reviewURL = sessionDeepLink(detail.info.id, "review", input.permissionID)

  return {
    sessionID: detail.info.id,
    status: input.status,
    action: compactActivityText(input.action, 72),
    repository: context.repository,
    branch: context.branch,
    startedAt: input.startedAt,
    ...(input.timerEndsAt ? { timerEndsAt: input.timerEndsAt } : {}),
    attention: input.attention === true,
    reviewURL,
    ...(input.permissionID ? { approveURL: sessionDeepLink(detail.info.id, "approveOnce", input.permissionID) } : {}),
    ...(input.canStop ? { stopURL: sessionDeepLink(detail.info.id, "stop") } : {}),
  }
}

/**
 * Single source of truth for every Lock Screen and Dynamic Island presentation.
 * Optional `publishing` / `cleaning` mirror transient UI state on the session screen.
 */
export function buildSessionLiveActivitySnapshot(
  detail: SessionDetail,
  overlays?: { publishing?: boolean; cleaning?: boolean },
): SessionLiveActivitySnapshot | null {
  const title = compactActivityText(detail.info.title || "Nikcli session", 64)
  const runningTool = latestRunningTool(detail)
  const startedAt = sessionStartedAt(detail, runningTool)

  if (overlays?.publishing) {
    return {
      mode: "upsert",
      activity: activityProps(detail, {
        status: "Publishing",
        action: "Publishing GitHub workflow",
        startedAt,
      }),
    }
  }

  if (overlays?.cleaning) {
    return {
      mode: "upsert",
      activity: activityProps(detail, {
        status: "Cleaning",
        action: "Cleaning GitHub worktree",
        startedAt,
      }),
    }
  }

  if (detail.permissions.length > 0) {
    const firstPermission = detail.permissions[0]
    const action =
      detail.permissions.length === 1
        ? readableActivityLabel(firstPermission?.permission, "Review approval")
        : `${detail.permissions.length} approvals pending`

    return {
      mode: "upsert",
      activity: activityProps(detail, {
        status: "Approval needed",
        action,
        startedAt,
        attention: true,
        permissionID: firstPermission?.id,
      }),
    }
  }

  if (detail.questions.length > 0) {
    const firstQuestion = detail.questions[0]
    const action =
      detail.questions.length === 1
        ? firstQuestion?.questions[0]?.question || "Review question"
        : `${detail.questions.length} questions pending`

    return {
      mode: "upsert",
      activity: activityProps(detail, {
        status: "Response needed",
        action,
        startedAt,
        attention: true,
      }),
    }
  }

  if (detail.status?.type === "retry") {
    return {
      mode: "upsert",
      activity: activityProps(detail, {
        status: `Retry ${detail.status.attempt}`,
        action: detail.status.message,
        startedAt,
        timerEndsAt: detail.status.next,
        attention: true,
        canStop: true,
      }),
    }
  }

  if (detail.status?.type === "busy") {
    const action =
      runningTool?.state.status === "running"
        ? runningTool.state.title || readableActivityLabel(runningTool.tool, "Working")
        : "Working on your request"

    return {
      mode: "upsert",
      activity: activityProps(detail, {
        status: "Working",
        action,
        startedAt,
        canStop: true,
      }),
    }
  }

  if (detail.status?.type === "idle") {
    const subtitle = detail.info.github?.pullRequest ? "GitHub work ready" : "Ready for next command"
    return { mode: "stop", title, subtitle }
  }

  return null
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

export async function upsertSessionLiveActivity(input: { sessionID: string; activity: SessionLiveActivityProps }) {
  if (!canManageLiveActivities()) return false

  await ensureLiveActivityRegistryLoaded()
  if (!canManageLiveActivities()) return false

  const signature = JSON.stringify(input.activity)
  if (liveActivitySignatures.get(input.sessionID) === signature) return true

  const instance = liveActivityInstances.get(input.sessionID)
  if (instance) {
    try {
      await instance.update(input.activity)
      liveActivitySignatures.set(input.sessionID, signature)
      return true
    } catch {
      liveActivityInstances.delete(input.sessionID)
      liveActivitySignatures.delete(input.sessionID)
    }
  }

  try {
    const createdActivity = startSessionLiveActivity(input.activity, sessionDeepLink(input.sessionID, "review"))
    if (!createdActivity) return false

    liveActivityInstances.set(input.sessionID, createdActivity)
    liveActivitySessions.add(input.sessionID)
    liveActivitySignatures.set(input.sessionID, signature)
    await persistLiveActivityRegistry()
    return true
  } catch {
    return false
  }
}

export async function stopSessionLiveActivity(input: { sessionID: string; title: string; subtitle?: string }) {
  if (!canManageLiveActivities()) return false

  await ensureLiveActivityRegistryLoaded()
  if (!liveActivitySessions.has(input.sessionID) && !liveActivityInstances.has(input.sessionID)) return false
  await purgeSessionLiveActivity(input.sessionID)
  return true
}

export async function reconcilePersistedLiveActivities(
  loadSession: (sessionID: string) => Promise<SessionDetail | null>,
) {
  if (!canManageLiveActivities()) return

  await ensureLiveActivityRegistryLoaded()

  await Promise.all(
    Array.from(liveActivitySessions).map(async (sessionID) => {
      const detail = await loadSession(sessionID).catch(() => null)
      if (!detail) {
        await purgeSessionLiveActivity(sessionID)
        return
      }

      const snapshot = buildSessionLiveActivitySnapshot(detail)
      if (!snapshot) return

      if (snapshot.mode === "upsert") {
        await upsertSessionLiveActivity({
          sessionID,
          activity: snapshot.activity,
        })
        return
      }

      await stopSessionLiveActivity({
        sessionID,
        title: snapshot.title,
        subtitle: snapshot.subtitle,
      })
    }),
  )
}
