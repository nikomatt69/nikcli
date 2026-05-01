import { Animated, Easing, Pressable, Text, View, useWindowDimensions } from "react-native"
import { useEffect, useRef, useState } from "react"
import { GitBranch, RefreshCw } from "lucide-react-native"
import type { GitState } from "@/lib/types"
import { useAppTheme } from "@/lib/theme"

interface GitStatusBarProps {
  gitState: GitState | null
  loading?: boolean
  onPress?: () => void
  onRefresh?: () => void
}

const ENTRANCE_CONFIG = {
  damping: 20,
  stiffness: 260,
  mass: 0.8,
}

export function GitStatusBar({ gitState, loading = false, onPress, onRefresh }: GitStatusBarProps) {
  const { palette, isDark } = useAppTheme()
  const entranceAnim = useRef(new Animated.Value(0)).current
  const scaleAnim = useRef(new Animated.Value(1)).current
  const pulseRefs = useRef<
    Map<string, { opacity: Animated.Value; scale: Animated.Value; loop: Animated.CompositeAnimation }>
  >(new Map())
  const statusTransitionAnim = useRef(new Animated.Value(1)).current
  const refreshScaleAnim = useRef(new Animated.Value(1)).current
  const [pulseKeys, setPulseKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    Animated.spring(entranceAnim, {
      toValue: 1,
      ...ENTRANCE_CONFIG,
      useNativeDriver: true,
    }).start()
  }, [entranceAnim])

  useEffect(() => {
    if (!gitState) return
    const newPulseKeys = new Set<string>()
    if (gitState.staged.length > 0) newPulseKeys.add("staged")
    if (gitState.unstaged.length > 0) newPulseKeys.add("unstaged")
    if (gitState.commitsAhead > 0) newPulseKeys.add("ahead")

    const hasChanged =
      ![...newPulseKeys].every((key) => pulseKeys.has(key)) || ![...pulseKeys].every((key) => newPulseKeys.has(key))

    if (hasChanged) {
      Animated.sequence([
        Animated.timing(statusTransitionAnim, {
          toValue: 0.8,
          duration: 100,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(statusTransitionAnim, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start()
      setPulseKeys(newPulseKeys)
    }
  }, [gitState, pulseKeys, statusTransitionAnim])

  useEffect(() => {
    pulseKeys.forEach((key) => {
      if (!pulseRefs.current.has(key)) {
        const opacityAnim = new Animated.Value(1)
        const scaleAnim = new Animated.Value(1)

        const loop = Animated.loop(
          Animated.parallel([
            Animated.sequence([
              Animated.timing(opacityAnim, {
                toValue: 0.5,
                duration: 1000,
                easing: Easing.inOut(Easing.ease),
                useNativeDriver: true,
              }),
              Animated.timing(opacityAnim, {
                toValue: 1,
                duration: 1000,
                easing: Easing.inOut(Easing.ease),
                useNativeDriver: true,
              }),
            ]),
            Animated.sequence([
              Animated.spring(scaleAnim, {
                toValue: 0.85,
                friction: 15,
                tension: 100,
                useNativeDriver: true,
              }),
              Animated.spring(scaleAnim, {
                toValue: 1,
                friction: 15,
                tension: 100,
                useNativeDriver: true,
              }),
            ]),
          ]),
        )
        pulseRefs.current.set(key, { opacity: opacityAnim, scale: scaleAnim, loop })
        loop.start()
      }
    })
    pulseRefs.current.forEach((value, key) => {
      if (pulseKeys.has(key)) return
      value.loop.stop()
      pulseRefs.current.delete(key)
    })
  }, [pulseKeys])

  useEffect(() => {
    return () => {
      pulseRefs.current.forEach((value) => value.loop.stop())
      pulseRefs.current.clear()
    }
  }, [])

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      friction: 20,
      tension: 170,
      useNativeDriver: true,
    }).start()
  }

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 16,
      tension: 150,
      useNativeDriver: true,
    }).start()
  }

  const handleRefreshPressIn = () => {
    Animated.spring(refreshScaleAnim, {
      toValue: 0.88,
      friction: 20,
      tension: 170,
      useNativeDriver: true,
    }).start()
  }

  const handleRefreshPressOut = () => {
    Animated.spring(refreshScaleAnim, {
      toValue: 1,
      friction: 16,
      tension: 150,
      useNativeDriver: true,
    }).start()
  }

  const getPulseAnim = (key: string) => pulseRefs.current.get(key)

  if (!gitState) {
    if (loading) {
      return (
        <Animated.View
          style={{
            opacity: entranceAnim,
            transform: [
              { translateY: entranceAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
              { scale: scaleAnim },
            ],
          }}
        >
          <Pressable
            onPress={onPress}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 12,
              backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
              borderWidth: 1,
              borderColor: palette.border,
            }}
          >
            <GitBranch size={13} color={palette.accentLight} strokeWidth={2} />
            <Text style={{ fontSize: 11, fontWeight: "600", color: palette.ink }}>...</Text>
          </Pressable>
        </Animated.View>
      )
    }
    return null
  }

  const stagedCount = gitState.staged.length
  const unstagedCount = gitState.unstaged.length
  const untrackedCount = gitState.untracked.length
  const totalChanges = stagedCount + unstagedCount + untrackedCount
  const ahead = gitState.commitsAhead
  const behind = gitState.commitsBehind

  return (
    <Animated.View
      style={{
        opacity: entranceAnim,
        transform: [
          { translateY: entranceAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
          { scale: scaleAnim },
        ],
      }}
    >
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 12,
          backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
          borderWidth: 1,
          borderColor: palette.border,
        }}
      >
        <GitBranch size={13} color={palette.accentLight} strokeWidth={2} />
        <Text style={{ fontSize: 11, fontWeight: "600", color: palette.ink }}>{gitState.branch}</Text>

        {totalChanges > 0 && (
          <Animated.View style={{ flexDirection: "row", alignItems: "center", gap: 6, opacity: statusTransitionAnim }}>
            <View style={{ width: 1, height: 12, backgroundColor: palette.border }} />
            {stagedCount > 0 &&
              (() => {
                const anims = getPulseAnim("staged")
                return (
                  <Animated.View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 3,
                      opacity: anims?.opacity ?? 1,
                      transform: [{ scale: anims?.scale ?? 1 }],
                    }}
                  >
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#22c55e" }} />
                    <Text style={{ fontSize: 10, fontWeight: "600", color: "#22c55e" }}>{stagedCount}</Text>
                  </Animated.View>
                )
              })()}
            {unstagedCount > 0 &&
              (() => {
                const anims = getPulseAnim("unstaged")
                return (
                  <Animated.View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 3,
                      opacity: anims?.opacity ?? 1,
                      transform: [{ scale: anims?.scale ?? 1 }],
                    }}
                  >
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#f59e0b" }} />
                    <Text style={{ fontSize: 10, fontWeight: "600", color: "#f59e0b" }}>{unstagedCount}</Text>
                  </Animated.View>
                )
              })()}
            {untrackedCount > 0 && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#6b7280" }} />
                <Text style={{ fontSize: 10, fontWeight: "600", color: "#6b7280" }}>{untrackedCount}</Text>
              </View>
            )}
          </Animated.View>
        )}

        {ahead > 0 &&
          (() => {
            const anims = getPulseAnim("ahead")
            return (
              <>
                <View style={{ width: 1, height: 12, backgroundColor: palette.border }} />
                <Animated.Text
                  style={{
                    fontSize: 10,
                    fontWeight: "600",
                    color: "#3b82f6",
                    opacity: anims?.opacity ?? 1,
                    transform: [{ scale: anims?.scale ?? 1 }],
                  }}
                >
                  ↑{ahead}
                </Animated.Text>
              </>
            )
          })()}

        {behind > 0 && (
          <>
            <View style={{ width: 1, height: 12, backgroundColor: palette.border }} />
            <Text style={{ fontSize: 10, fontWeight: "600", color: "#f59e0b" }}>↓{behind}</Text>
          </>
        )}

        <Animated.View style={{ marginLeft: "auto", transform: [{ scale: refreshScaleAnim }] }}>
          <Pressable
            onPress={(e) => {
              e.stopPropagation()
              onRefresh?.()
            }}
            onPressIn={handleRefreshPressIn}
            onPressOut={handleRefreshPressOut}
            hitSlop={6}
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <RefreshCw
              size={12}
              color={palette.muted}
              style={{
                opacity: loading ? 0.5 : 1,
              }}
            />
          </Pressable>
        </Animated.View>
      </Pressable>
    </Animated.View>
  )
}
