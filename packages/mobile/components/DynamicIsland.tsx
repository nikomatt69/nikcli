import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react"
import { View, Text, Pressable, Dimensions, Animated, Easing, PanResponder } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Image } from "expo-image"
import * as Haptics from "expo-haptics"
import type { AgentActivity, AgentType, ToolExecution } from "@/lib/live-activity"
import { STATUS_CONFIG } from "@/lib/live-activity"

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

const SCREEN_WIDTH = Dimensions.get("window").width
const ISLAND_H_MARGIN = 32
const EXPANDED_WIDTH = SCREEN_WIDTH - ISLAND_H_MARGIN

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}

function fmtCost(n: number): string | null {
  if (n <= 0) return null
  if (n < 0.001) return "<$0.001"
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(3)}`
}

function clampProgress(progress: number): number {
  return Math.min(1, Math.max(0, progress))
}

function formatLiveDuration(startTime: number): string {
  const elapsed = Math.floor((Date.now() - startTime) / 1000)
  if (elapsed < 60) return `${elapsed}s`
  const minutes = Math.floor(elapsed / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

// ─────────────────────────────────────────────────────────────
// LIVE TIMER HOOK
// ─────────────────────────────────────────────────────────────

function useLiveTimer(startTime: number | undefined, isActive: boolean): string {
  const [duration, setDuration] = useState(() => formatLiveDuration(startTime ?? Date.now()))

  useEffect(() => {
    if (!isActive || startTime === undefined) return
    setDuration(formatLiveDuration(startTime))
    const interval = setInterval(() => {
      setDuration(formatLiveDuration(startTime))
    }, 1000)
    return () => clearInterval(interval)
  }, [startTime, isActive])

  return duration
}

// ─────────────────────────────────────────────────────────────
// ANIMATED COUNTER HOOK
// ─────────────────────────────────────────────────────────────

function useAnimatedCounter(target: number, duration: number = 600): Animated.Value {
  const animated = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.timing(animated, {
      toValue: target,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start()
  }, [target, duration])

  return animated
}

// ─────────────────────────────────────────────────────────────
// ANIMATED PROGRESS RING
// ─────────────────────────────────────────────────────────────

function AnimatedProgressRing({
  progress,
  color,
  size = 48,
  strokeWidth = 4,
}: {
  progress: number
  color: string
  size?: number
  strokeWidth?: number
}) {
  const animatedProgress = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.spring(animatedProgress, {
      toValue: clampProgress(progress),
      friction: 8,
      tension: 40,
      useNativeDriver: false,
    }).start()
  }, [progress])

  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  const strokeDashoffset = animatedProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  })

  return (
    <View style={{ width: size, height: size, position: "relative" }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: strokeWidth,
          borderColor: `${color}20`,
          position: "absolute",
        }}
      />
      <Animated.View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: strokeWidth,
          borderColor: color,
          borderRightColor: "transparent",
          borderBottomColor: "transparent",
          transform: [{ rotate: `${-90 + progress * 360}deg` }],
          position: "absolute",
          opacity: 0.9,
        }}
      />
    </View>
  )
}

function getActivityProgress(activity: AgentActivity): number | null {
  if (activity.status === "completed") return 1
  if (activity.status === "failed") return null

  if (typeof activity.progress === "number" && activity.progress > 0) {
    return clampProgress(activity.progress)
  }

  if (activity.tools.length === 0) return null

  const completedTools = activity.tools.filter((tool) => tool.status === "completed").length
  const hasRunningTool = activity.tools.some((tool) => tool.status === "running")
  return clampProgress(completedTools / activity.tools.length + (hasRunningTool ? 0.18 / activity.tools.length : 0))
}

function getActivityAccent(activity: AgentActivity): string {
  return activity.pendingPermissions.length > 0 ? "#F3A645" : STATUS_CONFIG[activity.status].color
}

function getActivityStatusLabel(activity: AgentActivity): string {
  if (activity.pendingPermissions.length > 0) return "APPROVAL"
  return activity.status.toUpperCase()
}

function getActivityHeadline(activity: AgentActivity): string {
  if (activity.pendingPermissions.length > 0) return "Approval required"
  return activity.agentName
}

function getActivitySubline(activity: AgentActivity): string {
  if (activity.pendingPermissions.length > 0) {
    return activity.pendingPermissions[0]?.text ?? "A privileged action needs confirmation"
  }

  const completedTools = activity.tools.filter((tool) => tool.status === "completed").length
  const detail =
    activity.tool?.status === "running"
      ? `Running ${activity.tool.name}`
      : activity.tool?.status === "completed"
        ? `${activity.tool.name} finished`
        : activity.tool?.status === "error"
          ? `${activity.tool.name} failed`
          : (activity.progressMessage ?? STATUS_CONFIG[activity.status].icon + " " + activity.status)

  const summary =
    activity.tools.length > 1 ? `${completedTools}/${activity.tools.length} tools` : fmtCost(activity.totalCost ?? 0)

  return [detail, summary].filter(Boolean).join(" • ")
}

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export type IslandState = "collapsed" | "compact" | "expanded" | "approval"

export interface ApprovalRequest {
  id: string
  type: "tool" | "permission" | "edit"
  title: string
  description?: string
  options: {
    approve: { label: string; action: () => void }
    deny?: { label: string; action: () => void }
    alt?: { label: string; action: () => void }
  }
  agentId?: string
  agentName?: string
  agentType?: AgentType
}

export interface DynamicIslandContextValue {
  activities: AgentActivity[]
  currentApproval: ApprovalRequest | null
  approvalQueueLength: number
  islandState: IslandState
  setIslandState: (state: IslandState) => void
  showActivity: (activity: AgentActivity) => void
  updateActivity: (sessionId: string, updates: Partial<AgentActivity>) => void
  transformActivity: (sessionId: string, fn: (prev: AgentActivity) => AgentActivity) => void
  removeActivity: (sessionId: string) => void
  showApproval: (request: ApprovalRequest) => void
  resolveApproval: (approved: boolean, altAction?: boolean) => void
  hideIsland: () => void
  pauseActivity: (sessionId: string) => void
  resumeActivity: (sessionId: string) => void
}

// ─────────────────────────────────────────────────────────────
// CONTEXT
// ─────────────────────────────────────────────────────────────

const DynamicIslandContext = createContext<DynamicIslandContextValue | null>(null)

export function useDynamicIsland() {
  const ctx = useContext(DynamicIslandContext)
  if (!ctx) throw new Error("useDynamicIsland must be used within DynamicIslandProvider")
  return ctx
}

// ─────────────────────────────────────────────────────────────
// PROVIDER
// ─────────────────────────────────────────────────────────────

export function DynamicIslandProvider({ children }: { children: React.ReactNode }) {
  const [activities, setActivities] = useState<AgentActivity[]>([])
  const [currentApproval, setCurrentApproval] = useState<ApprovalRequest | null>(null)
  const [islandState, setIslandState] = useState<IslandState>("collapsed")
  const [approvalQueueLength, setApprovalQueueLength] = useState(0)
  const approvalQueue = useRef<ApprovalRequest[]>([])
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showActivity = useCallback((activity: AgentActivity) => {
    setActivities((prev) => {
      const filtered = prev.filter((a) => a.sessionId !== activity.sessionId)
      return [...filtered, activity].slice(0, 3)
    })
    setIslandState((s) => (s === "collapsed" ? "compact" : s))
  }, [])

  const updateActivity = useCallback((sessionId: string, updates: Partial<AgentActivity>) => {
    setActivities((prev) =>
      prev.map((a) => (a.sessionId === sessionId ? { ...a, ...updates, lastUpdate: Date.now() } : a)),
    )
  }, [])

  const transformActivity = useCallback((sessionId: string, fn: (prev: AgentActivity) => AgentActivity) => {
    setActivities((prev) => prev.map((a) => (a.sessionId === sessionId ? { ...fn(a), lastUpdate: Date.now() } : a)))
  }, [])

  const removeActivity = useCallback(
    (sessionId: string) => {
      setActivities((prev) => {
        const filtered = prev.filter((a) => a.sessionId !== sessionId)
        if (filtered.length === 0 && !currentApproval) setIslandState("collapsed")
        return filtered
      })
    },
    [currentApproval],
  )

  const showApproval = useCallback((request: ApprovalRequest) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
    setCurrentApproval((prev) => {
      if (prev) {
        approvalQueue.current.push(request)
        setApprovalQueueLength(approvalQueue.current.length)
        return prev
      }
      setIslandState("approval")
      return request
    })
  }, [])

  const resolveApproval = useCallback(
    (approved: boolean, altAction?: boolean) => {
      if (!currentApproval) return
      if (altAction && currentApproval.options.alt) currentApproval.options.alt.action()
      else if (approved) currentApproval.options.approve.action()
      else currentApproval.options.deny?.action()

      const next = approvalQueue.current.shift()
      setApprovalQueueLength(approvalQueue.current.length)
      setCurrentApproval(null)

      if (next) {
        setTimeout(() => {
          setCurrentApproval(next)
          setIslandState("approval")
        }, 280)
      } else if (activities.length > 0) {
        setIslandState("compact")
      } else {
        setIslandState("collapsed")
      }
    },
    [currentApproval, activities.length],
  )

  const hideIsland = useCallback(() => {
    setIslandState("collapsed")
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current)
    hideTimeoutRef.current = setTimeout(() => {
      setActivities([])
      setCurrentApproval(null)
      approvalQueue.current = []
      setApprovalQueueLength(0)
    }, 350)
  }, [])

  const pauseActivity = useCallback(
    (sessionId: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      updateActivity(sessionId, { status: "reviewing", progressMessage: "Paused by user" })
    },
    [updateActivity],
  )

  const resumeActivity = useCallback(
    (sessionId: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      updateActivity(sessionId, { status: "working", progressMessage: "Resuming..." })
    },
    [updateActivity],
  )

  return (
    <DynamicIslandContext.Provider
      value={{
        activities,
        currentApproval,
        approvalQueueLength,
        islandState,
        setIslandState,
        showActivity,
        updateActivity,
        transformActivity,
        removeActivity,
        showApproval,
        resolveApproval,
        hideIsland,
        pauseActivity,
        resumeActivity,
      }}
    >
      {children}
      <DynamicIslandOverlay />
    </DynamicIslandContext.Provider>
  )
}

// ─────────────────────────────────────────────────────────────
// AGENT IMAGES
// ─────────────────────────────────────────────────────────────

const AGENT_IMAGES: Record<AgentType, any> = {
  reasoning: require("@/assets/liveActivity/agent_reasoning.png"),
  coding: require("@/assets/liveActivity/agent_coding.png"),
  searching: require("@/assets/liveActivity/agent_searching.png"),
  building: require("@/assets/liveActivity/agent_building.png"),
  testing: require("@/assets/liveActivity/agent_testing.png"),
  memory: require("@/assets/liveActivity/agent_memory.png"),
  planning: require("@/assets/liveActivity/agent_planning.png"),
  debugging: require("@/assets/liveActivity/agent_debugging.png"),
}

const CODEBRO_IMAGE = require("@/assets/liveActivity/codebro.png")

function AgentAvatar({
  agentType,
  accent,
  size,
  showPulse = false,
}: {
  agentType: AgentType
  accent: string
  size: number
  showPulse?: boolean
}) {
  return (
    <View style={{ position: "relative" }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.3),
          overflow: "hidden",
          backgroundColor: "#111318",
          borderWidth: 1,
          borderColor: `${accent}33`,
        }}
      >
        <Image source={AGENT_IMAGES[agentType]} contentFit="cover" style={{ width: size, height: size }} />
      </View>

      <View
        style={{
          position: "absolute",
          bottom: -1,
          right: -1,
          width: Math.max(10, Math.round(size * 0.24)),
          height: Math.max(10, Math.round(size * 0.24)),
          borderRadius: 999,
          backgroundColor: accent,
          borderWidth: 2,
          borderColor: "#050505",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {showPulse && <PulseRing color={accent} />}
      </View>
    </View>
  )
}

function StatusPill({ label, color, compact = false }: { label: string; color: string; compact?: boolean }) {
  return (
    <View
      style={{
        paddingHorizontal: compact ? 7 : 9,
        paddingVertical: compact ? 4 : 5,
        borderRadius: 999,
        backgroundColor: `${color}18`,
        borderWidth: 0.8,
        borderColor: `${color}40`,
      }}
    >
      <Text
        style={{
          color,
          fontSize: compact ? 9 : 10,
          fontWeight: "800",
          letterSpacing: 0.6,
        }}
      >
        {label}
      </Text>
    </View>
  )
}

function MetricPill({ label, emphasis = false }: { label: string; emphasis?: boolean }) {
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 5,
        borderRadius: 999,
        backgroundColor: emphasis ? "#12161d" : "#0d1015",
        borderWidth: 0.8,
        borderColor: emphasis ? "#273241" : "#1c232d",
      }}
    >
      <Text style={{ color: emphasis ? "#d7dee8" : "#8993a1", fontSize: 10, fontWeight: "700" }}>{label}</Text>
    </View>
  )
}

function PulseRing({ color }: { color: string }) {
  const anim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.loop(
      Animated.timing(anim, { toValue: 1, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    ).start()
  }, [])

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] })
  const opacity = anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.6, 0.3, 0] })

  return (
    <Animated.View
      style={{
        position: "absolute",
        width: "100%",
        height: "100%",
        borderRadius: 999,
        backgroundColor: color,
        transform: [{ scale }],
        opacity,
      }}
    />
  )
}

// ─────────────────────────────────────────────────────────────
// OVERLAY (Enterprise AI Style)
// ─────────────────────────────────────────────────────────────

function DynamicIslandOverlay() {
  const { activities, currentApproval, islandState, setIslandState, hideIsland, resolveApproval } = useDynamicIsland()
  const insets = useSafeAreaInsets()

  const widthAnim = useRef(new Animated.Value(120)).current
  const heightAnim = useRef(new Animated.Value(36)).current
  const opacityAnim = useRef(new Animated.Value(0)).current
  const scaleAnim = useRef(new Animated.Value(0.92)).current
  const borderRadiusAnim = useRef(new Animated.Value(24)).current

  const isIdle = activities.length === 0 && !currentApproval && islandState !== "collapsed"
  const isAI = activities.length > 0 || currentApproval !== null

  const targetWidth = isIdle ? 120 : isAI && islandState === "expanded" ? EXPANDED_WIDTH : 160
  const targetHeight = isIdle ? 36 : isAI && islandState === "expanded" ? 200 : 44
  const targetRadius = isAI && islandState === "expanded" ? 44 : 24

  useEffect(() => {
    Animated.parallel([
      Animated.spring(widthAnim, { toValue: targetWidth, useNativeDriver: false, friction: 12, tension: 50 }),
      Animated.spring(heightAnim, { toValue: targetHeight, useNativeDriver: false, friction: 12, tension: 50 }),
      Animated.spring(borderRadiusAnim, { toValue: targetRadius, useNativeDriver: false, friction: 12 }),
      Animated.timing(opacityAnim, { toValue: isIdle || isAI ? 1 : 0, duration: 200, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, friction: 10 }),
    ]).start()
  }, [isIdle, isAI, islandState])

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    if (isAI) {
      if (islandState === "compact") setIslandState("expanded")
      else if (islandState === "expanded") setIslandState("compact")
    }
  }

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 10,
      onPanResponderRelease: (_, g) => {
        if (g.dy < -60) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
          hideIsland()
        }
      },
    }),
  ).current

  if (!isIdle && !isAI && islandState === "collapsed") return null

  return (
    <View
      className="absolute left-0 right-0 items-center z-50"
      style={{ top: insets.top + 8 }}
      pointerEvents="box-none"
    >
      <Pressable onPress={handlePress} disabled={isIdle}>
        <Animated.View
          {...panResponder.panHandlers}
          style={{
            width: widthAnim,
            height: heightAnim,
            opacity: opacityAnim,
            transform: [{ scale: scaleAnim }],
            backgroundColor: "#000000",
            borderRadius: borderRadiusAnim,
            shadowColor: "#23B5FF",
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: isAI ? 0.5 : 0.15,
            shadowRadius: 20,
            elevation: 20,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.05)",
          }}
        >
          {isIdle ? (
            <IdleView />
          ) : islandState === "expanded" ? (
            <ExpandedAIPanel onClose={hideIsland} activities={activities} />
          ) : (
            <CompactAIPanel activities={activities} />
          )}
        </Animated.View>
      </Pressable>
    </View>
  )
}

// ─────────────────────────────────────────────────────────────
// IDLE VIEW (dark dot indicator)
// ─────────────────────────────────────────────────────────────

function IdleView() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: 12,
          height: 12,
          borderRadius: 6,
          backgroundColor: "#18181b",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.1)",
        }}
      />
    </View>
  )
}

// ─────────────────────────────────────────────────────────────
// COMPACT AI PANEL
// ─────────────────────────────────────────────────────────────

function CompactAIPanel({ activities }: { activities: AgentActivity[] }) {
  const main = activities[activities.length - 1]
  const accent = main ? STATUS_CONFIG[main.status].color : "#23B5FF"

  return (
    <View
      style={{
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 8,
      }}
    >
      {/* Blue Glow Icon */}
      <View style={{ position: "relative", width: 28, height: 28, alignItems: "center", justifyContent: "center" }}>
        <View
          style={{
            position: "absolute",
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: "#2563eb",
            opacity: 0.8,
          }}
        />
        <View
          style={{
            position: "absolute",
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: "#000",
          }}
        />
        <Text style={{ fontSize: 8, color: "#60a5fa", position: "absolute" }}>⚡</Text>
      </View>

      {/* Codebro Image */}
      <View style={{ alignItems: "center", justifyContent: "center", marginHorizontal: 4 }}>
        <Image
          source={CODEBRO_IMAGE}
          style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.1)" }}
        />
      </View>
    </View>
  )
}

// ─────────────────────────────────────────────────────────────
// EXPANDED AI PANEL
// ─────────────────────────────────────────────────────────────

function ExpandedAIPanel({ onClose, activities }: { onClose: () => void; activities: AgentActivity[] }) {
  const main = activities[activities.length - 1]
  const accent = main ? STATUS_CONFIG[main.status].color : "#23B5FF"
  const glowAnim = useRef(new Animated.Value(1)).current

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1.05, duration: 2000, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
      ]),
    ).start()
  }, [])

  return (
    <View style={{ flex: 1 }}>
      {/* Data Grid Background */}
      <View
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.2,
        }}
      />

      {/* Corporate Blue Glow at bottom */}
      <View
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 80,
          overflow: "hidden",
          borderBottomLeftRadius: 44,
          borderBottomRightRadius: 44,
        }}
      >
        <Animated.View
          style={{
            position: "absolute",
            bottom: -30,
            left: "25%",
            width: "50%",
            height: 60,
            backgroundColor: "#2563eb",
            borderRadius: 30,
            opacity: glowAnim.interpolate({ inputRange: [1, 1.05], outputRange: [0.5, 0.8] }),
            transform: [{ scale: glowAnim }],
          }}
        />
        <Animated.View
          style={{
            position: "absolute",
            bottom: -20,
            left: "35%",
            width: "50%",
            height: 50,
            backgroundColor: "#4f46e5",
            borderRadius: 25,
            opacity: glowAnim.interpolate({ inputRange: [1, 1.05], outputRange: [0.4, 0.7] }),
            transform: [{ scale: glowAnim }],
          }}
        />
      </View>

      {/* Content */}
      <View style={{ flex: 1, padding: 16, justifyContent: "space-between" }}>
        {/* Header */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          {/* Enterprise Icon */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View
              style={{ position: "relative", width: 32, height: 32, alignItems: "center", justifyContent: "center" }}
            >
              <View
                style={{
                  position: "absolute",
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: "#2563eb",
                  opacity: 0.8,
                }}
              />
              <View
                style={{ position: "absolute", width: 22, height: 22, borderRadius: 11, backgroundColor: "#000" }}
              />
              <Text style={{ fontSize: 12, color: "#60a5fa", position: "absolute" }}>✓</Text>
            </View>
            <Text style={{ color: "#dbeafe", fontSize: 16, fontWeight: "500", letterSpacing: 0.5 }}>nikcli Agent</Text>
          </View>

          {/* Close Button + Codebro */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Pressable
              onPress={onClose}
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: "rgba(255,255,255,0.1)",
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.05)",
              }}
            >
              <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 16 }}>×</Text>
            </Pressable>
            <Image
              source={CODEBRO_IMAGE}
              style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: "rgba(59,130,246,0.3)" }}
            />
          </View>
        </View>

        {/* Status */}
        <View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Text style={{ fontSize: 12, color: "#60a5fa" }}>⚡</Text>
            <Text style={{ color: "#ffffff", fontSize: 18, fontWeight: "300" }}>
              {main?.progressMessage || "Processing..."}
            </Text>
          </View>

          {/* Progress Bar */}
          <View
            style={{
              height: 6,
              backgroundColor: "rgba(255,255,255,0.1)",
              borderRadius: 3,
              overflow: "hidden",
              marginBottom: 6,
            }}
          >
            <Animated.View
              style={{
                height: "100%",
                width: "75%",
                backgroundColor: "#3b82f6",
                borderRadius: 3,
              }}
            />
          </View>
          <Text style={{ fontSize: 10, color: "rgba(147,197,253,0.7)", fontFamily: "monospace", letterSpacing: 1 }}>
            {main?.status?.toUpperCase() || "RUNNING"}
          </Text>
        </View>
      </View>
    </View>
  )
}

// ─────────────────────────────────────────────────────────────
// EXPANDED VIEW (with horizontal swipe navigation)
// ─────────────────────────────────────────────────────────────

function ExpandedView({
  activities,
  onClose,
  onQuickAction,
}: {
  activities: AgentActivity[]
  onClose: () => void
  onQuickAction?: (action: "expand" | "stop" | "pause", activity: AgentActivity) => void
}) {
  return null
}

// ─────────────────────────────────────────────────────────────
// HOOK FOR SESSION
// ─────────────────────────────────────────────────────────────

export function useDynamicIslandForSession(sessionId: string | undefined) {
  const {
    showActivity,
    updateActivity,
    transformActivity,
    removeActivity,
    showApproval,
    setIslandState,
    pauseActivity,
    resumeActivity,
  } = useDynamicIsland()

  const startActivity = useCallback(
    (agentId: string, agentName: string, agentType: AgentType) => {
      if (!sessionId) return
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      const activity: AgentActivity = {
        sessionId,
        agentId,
        id: `island-${sessionId}`,
        agentType,
        agentName,
        status: "launching",
        progressMessage: "Initializing...",
        progress: 0,
        tools: [],
        startTime: Date.now(),
        lastUpdate: Date.now(),
        pendingPermissions: [],
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCost: 0,
      }
      showActivity(activity)
    },
    [sessionId, showActivity],
  )

  const updateActivityStatus = useCallback(
    (updates: Partial<AgentActivity>) => {
      if (!sessionId) return
      updateActivity(sessionId, updates)
    },
    [sessionId, updateActivity],
  )

  const endActivity = useCallback(
    (status: "completed" | "failed" = "completed") => {
      if (!sessionId) return
      Haptics.notificationAsync(
        status === "completed" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error,
      )
      updateActivity(sessionId, { status })
      setTimeout(() => removeActivity(sessionId), 2200)
    },
    [sessionId, updateActivity, removeActivity],
  )

  const pauseAgent = useCallback(() => {
    if (!sessionId) return
    pauseActivity(sessionId)
  }, [sessionId, pauseActivity])

  const resumeAgent = useCallback(() => {
    if (!sessionId) return
    resumeActivity(sessionId)
  }, [sessionId, resumeActivity])

  const addPermission = useCallback(
    (permissionId: string, text: string) => {
      if (!sessionId) return
      transformActivity(sessionId, (prev) => {
        if (prev.pendingPermissions.find((p) => p.id === permissionId)) return prev
        return { ...prev, pendingPermissions: [...prev.pendingPermissions, { id: permissionId, text }] }
      })
    },
    [sessionId, transformActivity],
  )

  const removePermission = useCallback(
    (permissionId: string) => {
      if (!sessionId) return
      transformActivity(sessionId, (prev) => ({
        ...prev,
        pendingPermissions: prev.pendingPermissions.filter((p) => p.id !== permissionId),
      }))
    },
    [sessionId, transformActivity],
  )

  const accumulateTokens = useCallback(
    (inputTokens: number, outputTokens: number, cost: number) => {
      if (!sessionId) return
      transformActivity(sessionId, (prev) => ({
        ...prev,
        totalInputTokens: (prev.totalInputTokens ?? 0) + inputTokens,
        totalOutputTokens: (prev.totalOutputTokens ?? 0) + outputTokens,
        totalCost: (prev.totalCost ?? 0) + cost,
      }))
    },
    [sessionId, transformActivity],
  )

  const requestApproval = useCallback(
    (request: Omit<ApprovalRequest, "id">) => {
      if (!sessionId) return
      showApproval({ ...request, id: `approval-${sessionId}-${Date.now()}` })
    },
    [sessionId, showApproval],
  )

  return {
    startActivity,
    updateActivity: updateActivityStatus,
    endActivity,
    pauseAgent,
    resumeAgent,
    addPermission,
    removePermission,
    accumulateTokens,
    requestApproval,
    expand: () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      setIslandState("expanded")
    },
    collapse: () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      setIslandState("compact")
    },
  }
}
