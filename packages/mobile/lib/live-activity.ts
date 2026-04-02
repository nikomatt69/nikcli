import { isRunningInExpoGo, requireOptionalNativeModule } from "expo"
import { AppState, Platform } from "react-native"
import { getMobileClient } from "@/lib/client"
import { triggerHaptic } from "@/lib/haptics"

export type AgentType =
  | "reasoning"
  | "coding"
  | "searching"
  | "building"
  | "testing"
  | "memory"
  | "planning"
  | "debugging"

export type SubAgentStatus = "launching" | "thinking" | "working" | "reviewing" | "completed" | "failed"

export type LiveActivityId = string

export interface ToolExecution {
  name: string
  status: "pending" | "running" | "completed" | "error"
  progress?: number
  duration?: number
}

export interface AgentActivity {
  sessionId: string
  agentId: string
  id: LiveActivityId
  agentType: AgentType
  agentName: string
  status: SubAgentStatus
  progressMessage?: string
  progress?: number
  tool?: ToolExecution
  tools: ToolExecution[]
  startTime: number
  lastUpdate: number
  notificationId?: string
  pendingPermissions: Array<{ id: string; text: string }>
  totalInputTokens: number
  totalOutputTokens: number
  totalCost: number
}

type LiveActivityStatePayload = {
  title: string
  subtitle?: string
  progressBar?: {
    progress?: number
  }
  imageName?: string
  dynamicIslandImageName?: string
}

const activeActivities = new Map<string, AgentActivity>()
let isAvailable: boolean | null = null
let appState = AppState.currentState

type LiveActivityNativeModule = {
  startActivity(state: unknown, config?: unknown): string | undefined
  stopActivity(id: string, state: unknown): void
  updateActivity(id: string, state: unknown): void
}

function getLiveActivityNativeModule(): LiveActivityNativeModule | null {
  if (Platform.OS !== "ios" || isRunningInExpoGo()) return null

  try {
    const module = requireOptionalNativeModule("ExpoLiveActivity") as LiveActivityNativeModule | null
    if (!module) return null
    if (typeof module.startActivity !== "function") return null
    if (typeof module.updateActivity !== "function") return null
    if (typeof module.stopActivity !== "function") return null
    return module
  } catch {
    return null
  }
}

export function isLiveActivitySupported(): boolean {
  if (isAvailable !== null) return isAvailable
  if (Platform.OS !== "ios" || isRunningInExpoGo()) {
    isAvailable = false
    return false
  }

  if (!getLiveActivityNativeModule()) {
    isAvailable = false
    return false
  }

  isAvailable = true
  return true
}

export async function ensureNotificationSupport(): Promise<boolean> {
  if (Platform.OS === "web" || isRunningInExpoGo()) return false

  try {
    const Notifications = require("expo-notifications")

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("nikcli-agents", {
        name: "Agent Activities",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 120],
        lightColor: "#38bdf8",
      })
    }

    const { granted } = await Notifications.getPermissionsAsync()
    if (!granted) {
      const { granted: requested } = await Notifications.requestPermissionsAsync()
      return requested
    }
    return true
  } catch {
    return false
  }
}

const AGENT_ICONS: Record<AgentType, string> = {
  reasoning: "🧠",
  coding: "💻",
  searching: "🔍",
  building: "🔨",
  testing: "🧪",
  memory: "🗄️",
  planning: "📋",
  debugging: "🔧",
}

const AGENT_LABELS: Record<AgentType, string> = {
  reasoning: "Reasoning",
  coding: "Coding",
  searching: "Searching",
  building: "Building",
  testing: "Testing",
  memory: "Memory",
  planning: "Planning",
  debugging: "Debugging",
}

const STATUS_CONFIG: Record<SubAgentStatus, { color: string; icon: string; haptic?: "success" | "error" }> = {
  launching: { color: "#7C8A9A", icon: "🚀" },
  thinking: { color: "#4EA1FF", icon: "🤔" },
  working: { color: "#23B5FF", icon: "⚡" },
  reviewing: { color: "#F3A645", icon: "👀" },
  completed: { color: "#38C98F", icon: "✅", haptic: "success" },
  failed: { color: "#F87070", icon: "❌", haptic: "error" },
}

const recentNotifications = new Map<string, number>()
const NOTIFICATION_DEDUPE_MS = 5000

function isAppInBackground(): boolean {
  return appState !== "active"
}

function shouldSendNotification(activity: AgentActivity): boolean {
  if (activity.status === "launching" || activity.status === "thinking") return false

  const key = `agent:${activity.sessionId}:${activity.status}`
  const now = Date.now()
  const last = recentNotifications.get(key)

  if (last && now - last < NOTIFICATION_DEDUPE_MS) return false

  recentNotifications.set(key, now)

  if (recentNotifications.size > 100) {
    const entries = [...recentNotifications.entries()].sort((a, b) => a[1] - b[1])
    entries.slice(0, 50).forEach(([k]) => recentNotifications.delete(k))
  }

  return true
}

async function sendFallbackNotification(activity: AgentActivity, status: SubAgentStatus, body?: string): Promise<void> {
  try {
    const Notifications = require("expo-notifications")

    if (!shouldSendNotification(activity)) return

    const statusConfig = STATUS_CONFIG[status]
    const agentIcon = AGENT_ICONS[activity.agentType]

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: `${agentIcon} ${activity.agentName}`,
        body: body || getDefaultSubtitle(status),
        sound: status === "completed" ? "default" : undefined,
        data: {
          sessionId: activity.sessionId,
          agentId: activity.agentId,
          status,
          deepLink: `/sessions/${activity.sessionId}`,
        },
        ...(Platform.OS === "android" ? { channelId: "nikcli-agents" } : {}),
      },
      trigger: null,
    })

    if (id) {
      activity.notificationId = id
    }
  } catch (error) {
    console.warn("Failed to send fallback notification:", error)
  }
}

async function cancelNotification(activity: AgentActivity): Promise<void> {
  if (!activity.notificationId) return

  try {
    const Notifications = require("expo-notifications")
    await Notifications.cancelScheduledNotificationAsync(activity.notificationId)
    activity.notificationId = undefined
  } catch {
    // Ignore
  }
}

function playHapticFeedback(status: SubAgentStatus): void {
  const config = STATUS_CONFIG[status]
  if (config.haptic) {
    triggerHaptic(config.haptic)
  }
}

function formatCost(cost: number): string | undefined {
  if (cost <= 0) return undefined
  if (cost < 0.001) return "<$0.001"
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(3)}`
}

function clampProgress(progress: number): number {
  return Math.min(1, Math.max(0, progress))
}

function getActivityProgress(activity: AgentActivity): number | undefined {
  if (activity.status === "completed") return 1
  if (activity.status === "failed") return undefined

  if (activity.progress !== undefined && activity.progress > 0) {
    return clampProgress(activity.progress)
  }

  const totalTools = activity.tools.length
  if (totalTools === 0) return undefined

  const completedTools = activity.tools.filter((tool) => tool.status === "completed").length
  const hasRunningTool = activity.tools.some((tool) => tool.status === "running")
  const baseProgress = completedTools / totalTools
  const runningBump = hasRunningTool ? 0.18 / totalTools : 0

  return clampProgress(baseProgress + runningBump)
}

function getActivityTitle(activity: AgentActivity): string {
  if (activity.pendingPermissions.length > 0) return "Approval required"
  return activity.agentName
}

function getActivitySubtitle(activity: AgentActivity): string {
  if (activity.pendingPermissions.length > 0) {
    return activity.pendingPermissions[0]?.text || "A privileged action needs confirmation"
  }

  const completedTools = activity.tools.filter((tool) => tool.status === "completed").length
  const detail =
    activity.tool?.status === "running"
      ? `Running ${activity.tool.name}`
      : activity.tool?.status === "completed"
        ? `${activity.tool.name} finished`
        : activity.tool?.status === "error"
          ? `${activity.tool.name} failed`
          : activity.progressMessage || getDefaultSubtitle(activity.status)

  const summary =
    activity.tools.length > 1
      ? `${completedTools}/${activity.tools.length} tools`
      : formatCost(activity.totalCost)

  return [detail, summary].filter(Boolean).join(" • ")
}

function getActivityState(activity: AgentActivity): LiveActivityStatePayload {
  const progress = getActivityProgress(activity)

  return {
    title: getActivityTitle(activity),
    subtitle: getActivitySubtitle(activity),
    progressBar: progress !== undefined ? { progress } : undefined,
    imageName: getAgentImageName(activity.agentType),
    dynamicIslandImageName: getAgentImageName(activity.agentType),
  }
}

function getAgentImageName(agentType: AgentType): string {
  const imageMap: Record<AgentType, string> = {
    reasoning: "agent_reasoning",
    coding: "agent_coding",
    searching: "agent_searching",
    building: "agent_building",
    testing: "agent_testing",
    memory: "agent_memory",
    planning: "agent_planning",
    debugging: "agent_debugging",
  }
  return imageMap[agentType] || "agent_icon"
}

function getDefaultSubtitle(status: SubAgentStatus): string {
  const subtitles: Record<SubAgentStatus, string> = {
    launching: "Preparing workspace",
    thinking: "Analyzing request",
    working: "Executing task",
    reviewing: "Reviewing output",
    completed: "Completed successfully",
    failed: "Needs attention",
  }
  return subtitles[status]
}

function getBackgroundColor(status: SubAgentStatus): string {
  if (status === "completed") return "#07110D"
  if (status === "failed") return "#16090A"
  return "#050608"
}

function getLiveActivityConfig(activity: AgentActivity) {
  return {
    backgroundColor: getBackgroundColor(activity.status),
    titleColor: "#ffffff",
    subtitleColor: "#94a3b8",
    progressViewTint: STATUS_CONFIG[activity.status].color,
    progressViewLabelColor: "#ffffff",
    deepLinkUrl: `/sessions/${activity.sessionId}`,
    timerType: "digital" as const,
    imagePosition: "left" as const,
    imageAlign: "center" as const,
    imageSize: { width: 42, height: 42 },
    contentFit: "contain" as const,
    padding: { top: 16, bottom: 16, left: 16, right: 16 },
  }
}

export function inferAgentType(event: {
  type: string
  properties?: { part?: { type: string; tool?: string } }
}): AgentType {
  const eventType = event.type

  if (eventType.includes("reasoning")) return "reasoning"
  if (eventType.includes("search") || eventType.includes("grep") || eventType.includes("glob")) return "searching"
  if (eventType.includes("test") || eventType.includes("spec")) return "testing"
  if (eventType.includes("build") || eventType.includes("compile") || eventType.includes("install")) return "building"
  if (eventType.includes("debug") || eventType.includes("error")) return "debugging"
  if (eventType.includes("memory") || eventType.includes("stash")) return "memory"
  if (eventType.includes("plan")) return "planning"

  if (event.properties?.part?.type === "tool") {
    const tool = event.properties.part.tool?.toLowerCase() || ""
    if (
      tool.includes("read") ||
      tool.includes("write") ||
      tool.includes("edit") ||
      tool.includes("glob") ||
      tool.includes("grep")
    ) {
      return "coding"
    }
    if (tool.includes("test") || tool.includes("spec")) return "testing"
    if (tool.includes("build") || tool.includes("install")) return "building"
    if (tool.includes("debug") || tool.includes("error")) return "debugging"
    if (tool.includes("search") || tool.includes("find")) return "searching"
  }

  return "coding"
}

async function updateLiveActivityInternal(activity: AgentActivity): Promise<void> {
  if (!isLiveActivitySupported()) return

  const module = require("expo-live-activity")
  try {
    const state = getActivityState(activity)
    module.updateActivity(activity.id, state)
  } catch (error) {
    console.warn("Failed to update Live Activity:", error)
  }
}

async function startLiveActivity(activity: AgentActivity): Promise<boolean> {
  if (!isLiveActivitySupported()) return false

  const module = require("expo-live-activity")
  try {
    const existing = activeActivities.get(activity.sessionId)
    if (existing) {
      await stopAgentActivityInternal(existing, "completed")
    }

    const state = getActivityState(activity)
    const config = getLiveActivityConfig(activity)
    const activityId = module.startActivity(state, config)

    if (activityId) {
      activity.id = activityId
      return true
    }
    return false
  } catch (error) {
    console.warn("Failed to start Live Activity:", error)
    return false
  }
}

async function stopLiveActivityInternal(activity: AgentActivity, _status: "completed" | "failed"): Promise<void> {
  if (!isLiveActivitySupported()) return

  const module = require("expo-live-activity")
  try {
    const state = getActivityState(activity)
    module.stopActivity(activity.id, state)
  } catch (error) {
    console.warn("Failed to stop Live Activity:", error)
  }
}

export async function startAgentActivity(input: {
  sessionId: string
  agentId: string
  agentType?: AgentType
  agentName: string
  initialMessage?: string
}): Promise<AgentActivity | null> {
  const agentType = input.agentType || "coding"
  const activity: AgentActivity = {
    sessionId: input.sessionId,
    agentId: input.agentId,
    id: "",
    agentType,
    agentName: input.agentName,
    status: "launching",
    progressMessage: input.initialMessage || "Starting...",
    progress: 0,
    tools: [],
    startTime: Date.now(),
    lastUpdate: Date.now(),
    pendingPermissions: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0,
  }

  await startLiveActivity(activity)

  if (isAppInBackground()) {
    await sendFallbackNotification(activity, "launching")
  }

  playHapticFeedback("launching")
  activeActivities.set(input.sessionId, activity)
  return activity
}

export async function updateAgentActivity(input: {
  sessionId: string
  status?: SubAgentStatus
  progressMessage?: string
  progress?: number
  tool?: ToolExecution
  agentType?: AgentType
}): Promise<void> {
  const activity = activeActivities.get(input.sessionId)
  if (!activity) return

  if (input.status) activity.status = input.status
  if (input.progressMessage) activity.progressMessage = input.progressMessage
  if (input.progress !== undefined) activity.progress = input.progress
  if (input.agentType) activity.agentType = input.agentType
  activity.lastUpdate = Date.now()

  if (input.tool) {
    const existingToolIndex = activity.tools.findIndex((t) => t.name === input.tool!.name)
    if (existingToolIndex >= 0) {
      activity.tools[existingToolIndex] = input.tool
    } else {
      activity.tools.push(input.tool)
    }
    activity.tool = input.tool
  }

  await updateLiveActivityInternal(activity)

  if (isAppInBackground() && (input.status === "completed" || input.status === "failed")) {
    await sendFallbackNotification(activity, input.status, input.progressMessage)
  }

  playHapticFeedback(input.status || activity.status)
}

async function stopAgentActivityInternal(activity: AgentActivity, status: "completed" | "failed"): Promise<void> {
  await cancelNotification(activity)

  activity.status = status
  activity.lastUpdate = Date.now()

  await stopLiveActivityInternal(activity, status)

  if (isAppInBackground()) {
    await sendFallbackNotification(activity, status)
  }

  playHapticFeedback(status)
}

export async function stopAgentActivity(
  sessionId: string,
  status: "completed" | "failed" = "completed",
): Promise<void> {
  const activity = activeActivities.get(sessionId)
  if (!activity) return

  await stopAgentActivityInternal(activity, status)
  activeActivities.delete(sessionId)
}

export function getAgentActivity(sessionId: string): AgentActivity | undefined {
  return activeActivities.get(sessionId)
}

export function getAllActiveActivities(): AgentActivity[] {
  return Array.from(activeActivities.values())
}

export function getActiveSessionCount(): number {
  return activeActivities.size
}

export function formatDuration(startTime: number): string {
  const elapsed = Math.floor((Date.now() - startTime) / 1000)
  if (elapsed < 60) return `${elapsed}s`
  const minutes = Math.floor(elapsed / 60)
  if (minutes < 60) return `${minutes}m ${elapsed % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export function setupAppStateListener(): () => void {
  const subscription = AppState.addEventListener("change", (nextAppState) => {
    const wasInBackground = appState !== "active"
    appState = nextAppState

    if (appState === "active" && wasInBackground) {
      activeActivities.forEach((act) => {
        if (act.notificationId) {
          cancelNotification(act)
        }
      })
    }
  })

  return () => subscription.remove()
}

async function sendPushTokenToServer(pushToken: string): Promise<void> {
  const client = await getMobileClient()
  if (!client) return

  try {
    await fetch(`${client.serverUrl}/mobile/live-activity/push-token`, {
      method: "POST",
      headers: client.headers(),
      body: JSON.stringify({
        pushToken,
        platform: "ios",
        timestamp: Date.now(),
        activeSessions: getActiveSessionCount(),
      }),
    })
  } catch {
    // Silent fail
  }
}

export function setupLiveActivityListeners(): () => void {
  if (!isLiveActivitySupported()) return () => {}

  const module = require("expo-live-activity")

  try {
    const tokenSub = module.addActivityTokenListener((event: { activityPushToken?: string }) => {
      if (event.activityPushToken) sendPushTokenToServer(event.activityPushToken)
    })

    const startTokenSub = module.addActivityPushToStartTokenListener((event: { activityPushToStartToken?: string }) => {
      if (event.activityPushToStartToken) sendPushTokenToServer(event.activityPushToStartToken)
    })

    const updatesSub = module.addActivityUpdatesListener((event: unknown) => {
      console.log("Live Activity update:", event)
    })

    return () => {
      tokenSub?.remove?.()
      startTokenSub?.remove?.()
      updatesSub?.remove?.()
    }
  } catch {
    return () => {}
  }
}

export function addPermissionToActivity(sessionId: string, permissionId: string, text: string): void {
  const activity = activeActivities.get(sessionId)
  if (!activity) return
  if (!activity.pendingPermissions.find((p) => p.id === permissionId)) {
    activity.pendingPermissions.push({ id: permissionId, text })
  }
  activity.lastUpdate = Date.now()
  void updateLiveActivityInternal(activity)
}

export function removePermissionFromActivity(sessionId: string, permissionId: string): void {
  const activity = activeActivities.get(sessionId)
  if (!activity) return
  activity.pendingPermissions = activity.pendingPermissions.filter((p) => p.id !== permissionId)
  activity.lastUpdate = Date.now()
  void updateLiveActivityInternal(activity)
}

export function accumulateTokensToActivity(
  sessionId: string,
  inputTokens: number,
  outputTokens: number,
  cost: number,
): void {
  const activity = activeActivities.get(sessionId)
  if (!activity) return
  activity.totalInputTokens += inputTokens
  activity.totalOutputTokens += outputTokens
  activity.totalCost += cost
  activity.lastUpdate = Date.now()
  void updateLiveActivityInternal(activity)
}

export { AGENT_ICONS, AGENT_LABELS, STATUS_CONFIG }
