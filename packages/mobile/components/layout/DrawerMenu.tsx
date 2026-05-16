import { useEffect, useRef, useState } from "react"
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { router } from "expo-router"
import { AdaptiveBlur } from "@/components/GlassView"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { RefreshCw, Square, X } from "lucide-react-native"
import { StatusPill } from "@/components/layout/StatusPill"
import { APP_TABS, getCurrentProjectLabel, getGitHubStatusLabel } from "@/components/layout/navigation.config"
import { useServer } from "@/lib/server-provider"
import { useUIStore } from "@/lib/store"
import { useAppTheme } from "@/lib/theme"

type DrawerMenuProps = {
  routeName: string
}

export function DrawerMenu({ routeName }: DrawerMenuProps) {
  const { top, bottom } = useSafeAreaInsets()
  const { bootstrap, config, client, refreshBootstrap } = useServer()
  const [abortingAll, setAbortingAll] = useState(false)
  const { palette, isDark } = useAppTheme()
  const open = useUIStore((state) => state.drawerOpen)
  const closeDrawer = useUIStore((state) => state.closeDrawer)
  const translateX = useRef(new Animated.Value(360)).current
  const overlay = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!open) return
    const animation = Animated.parallel([
      Animated.timing(translateX, {
        toValue: 0,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(overlay, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ])
    animation.start()
    return () => animation.stop()
  }, [open, overlay, translateX])

  function close() {
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: 360,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(overlay, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) closeDrawer()
    })
  }

  function navigate(path: (typeof APP_TABS)[number]["path"]) {
    close()
    router.replace(path as Parameters<typeof router.replace>[0])
  }

  return (
    <Modal transparent visible={open} animationType="none" onRequestClose={close}>
      <View style={{ flex: 1 }}>
        {/* Backdrop blur + scrim */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: overlay }]}>
          <AdaptiveBlur
            tint={isDark ? "dark" : "light"}
            intensity={isDark ? 18 : 12}
            style={StyleSheet.absoluteFill}
            fallbackColor={isDark ? "rgba(0,0,0,0.72)" : "rgba(15,23,42,0.20)"}
          />
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? "rgba(0,0,0,0.72)" : "rgba(15,23,42,0.24)" }]}
          />
        </Animated.View>

        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Close navigation drawer"
        />

        {/* Drawer panel */}
        <Animated.View
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            top: 0,
            width: "86%",
            paddingTop: top + 14,
            paddingBottom: bottom + 18,
            transform: [{ translateX }],
            shadowColor: palette.shadow,
            shadowOpacity: isDark ? 0.55 : 0.22,
            shadowRadius: 32,
            shadowOffset: { width: -8, height: 0 },
            elevation: 26,
          }}
        >
          {/* Glass background */}
          <AdaptiveBlur
            tint={isDark ? "dark" : "light"}
            intensity={isDark ? 88 : 78}
            style={StyleSheet.absoluteFill}
            fallbackColor={isDark ? "rgba(17,17,17,0.85)" : "rgba(255,255,255,0.82)"}
          />
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: isDark ? "rgba(0,0,0,0.52)" : "rgba(241,246,251,0.40)" },
            ]}
            pointerEvents="none"
          />
          {/* Left border */}
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                borderLeftWidth: 1,
                borderLeftColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.72)",
              },
            ]}
            pointerEvents="none"
          />

          <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 12, gap: 18 }}>
            <View
              style={{
                overflow: "hidden",
                borderRadius: 20,
                borderWidth: 1,
                borderColor: isDark ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.80)",
                padding: 18,
              }}
            >
              <AdaptiveBlur
                tint={isDark ? "dark" : "extraLight"}
                intensity={isDark ? 50 : 40}
                style={StyleSheet.absoluteFill}
                fallbackColor={isDark ? "rgba(17,17,17,0.85)" : "rgba(255,255,255,0.82)"}
              />
              <View
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: isDark ? "rgba(24,24,24,0.58)" : "rgba(255,255,255,0.52)" },
                ]}
                pointerEvents="none"
              />
              <View
                style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: "700",
                      letterSpacing: 2.2,
                      textTransform: "uppercase",
                      color: palette.accentLight,
                    }}
                  >
                    Navigation
                  </Text>
                  <Text
                    style={{
                      marginTop: 8,
                      fontSize: 28,
                      fontWeight: "600",
                      lineHeight: 32,
                      color: palette.ink,
                    }}
                  >
                    {getCurrentProjectLabel(bootstrap, "No active workspace")}
                  </Text>
                  <Text style={{ marginTop: 12, fontSize: 14, lineHeight: 24, color: palette.soft }}>
                    Switch views, check host status, and keep execution settings aligned with the connected server.
                  </Text>
                </View>
                <Pressable
                  onPress={close}
                  accessibilityRole="button"
                  accessibilityLabel="Close navigation drawer"
                  style={{
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.80)",
                    backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.55)",
                    padding: 12,
                  }}
                >
                  <X size={18} color={palette.ink} strokeWidth={2.2} />
                </Pressable>
              </View>
            </View>

            {/* Navigation card */}
            <View
              style={{
                overflow: "hidden",
                borderRadius: 20,
                borderWidth: 1,
                borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.75)",
                padding: 16,
              }}
            >
              <AdaptiveBlur
                tint={isDark ? "dark" : "extraLight"}
                intensity={isDark ? 45 : 35}
                style={StyleSheet.absoluteFill}
                fallbackColor={isDark ? "rgba(17,17,17,0.85)" : "rgba(255,255,255,0.82)"}
              />
              <View
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: isDark ? "rgba(24,24,24,0.55)" : "rgba(232,240,248,0.45)" },
                ]}
                pointerEvents="none"
              />
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: "700",
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  color: palette.accentLight,
                }}
              >
                Navigation
              </Text>
              <View style={{ marginTop: 16, gap: 12 }}>
                {APP_TABS.map((tab) => {
                  const active = routeName === tab.route
                  const Icon = tab.icon
                  return (
                    <Pressable
                      key={tab.route}
                      onPress={() => navigate(tab.path)}
                      accessibilityRole="button"
                      accessibilityState={active ? { selected: true } : {}}
                      accessibilityLabel={`Open ${tab.label}`}
                      accessibilityHint={tab.subtitle}
                      style={{
                        overflow: "hidden",
                          borderRadius: 16,
                        borderWidth: 1,
                        borderColor: active
                          ? isDark
                            ? "rgba(255,255,255,0.16)"
                            : "rgba(14,165,233,0.38)"
                          : isDark
                            ? "rgba(255,255,255,0.08)"
                            : "rgba(255,255,255,0.72)",
                        padding: 16,
                      }}
                    >
                      {active && (
                        <View
                          style={[
                            StyleSheet.absoluteFill,
                            {
                              backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(14,165,233,0.08)",
                            },
                          ]}
                          pointerEvents="none"
                        />
                      )}
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                        <View
                          style={{
                            borderRadius: 12,
                            padding: 12,
                            backgroundColor: active
                              ? isDark
                                ? "rgba(255,255,255,0.10)"
                                : "rgba(14,165,233,0.12)"
                              : isDark
                                ? "rgba(255,255,255,0.06)"
                                : "rgba(255,255,255,0.60)",
                            borderWidth: 1,
                            borderColor: active
                              ? isDark
                                ? "rgba(255,255,255,0.14)"
                                : "rgba(14,165,233,0.20)"
                              : isDark
                                ? "rgba(255,255,255,0.08)"
                                : "rgba(255,255,255,0.80)",
                          }}
                        >
                          <Icon
                            size={18}
                            color={active ? palette.accentLight : palette.muted}
                            strokeWidth={active ? 2.2 : 1.9}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 16, fontWeight: "600", color: palette.ink }}>{tab.label}</Text>
                          <Text style={{ marginTop: 4, fontSize: 14, lineHeight: 20, color: palette.soft }}>
                            {tab.subtitle}
                          </Text>
                        </View>
                      </View>
                    </Pressable>
                  )
                })}
              </View>
            </View>

            {/* Control plane card */}
            <View
              style={{
                overflow: "hidden",
                borderRadius: 20,
                borderWidth: 1,
                borderColor: isDark ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.78)",
                padding: 16,
              }}
            >
              <AdaptiveBlur
                tint={isDark ? "dark" : "extraLight"}
                intensity={isDark ? 50 : 40}
                style={StyleSheet.absoluteFill}
                fallbackColor={isDark ? "rgba(17,17,17,0.85)" : "rgba(255,255,255,0.82)"}
              />
              <View
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: isDark ? "rgba(17,17,17,0.55)" : "rgba(255,255,255,0.50)" },
                ]}
                pointerEvents="none"
              />
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: "700",
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  color: palette.accentLight,
                }}
              >
                Control plane
              </Text>
              <View style={{ marginTop: 16, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <StatusPill label="Host" value={config ? "Linked" : "Offline"} tone={config ? "good" : "warn"} />
                <StatusPill
                  label="GitHub"
                  value={getGitHubStatusLabel(bootstrap, "Not linked")}
                  tone={bootstrap?.github?.connected ? "good" : "warn"}
                />
                <StatusPill label="Workspace" value={getCurrentProjectLabel(bootstrap, "Unavailable")} />
              </View>
              <Pressable
                disabled={!config}
                onPress={() => void refreshBootstrap().catch(() => null)}
                accessibilityRole="button"
                accessibilityLabel="Refresh host state"
                accessibilityHint="Reloads connection, workspace, GitHub, and execution status from the host"
                accessibilityState={{ disabled: !config }}
                style={{
                  marginTop: 16,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.78)",
                  backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.55)",
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                }}
              >
                <RefreshCw size={16} color={palette.ink} strokeWidth={2.1} />
                <Text style={{ fontWeight: "600", color: palette.ink }}>Refresh host state</Text>
              </Pressable>

              <Pressable
                disabled={!client || abortingAll}
                onPress={async () => {
                  if (!client) return
                  setAbortingAll(true)
                  try {
                    const sessions = await client.listSessions()
                    const busy = sessions.filter((s) => s.status?.type === "busy")
                    await Promise.allSettled(busy.map((s) => client.abortSession(s.info.id)))
                  } finally {
                    setAbortingAll(false)
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel="Abort all active sessions"
                accessibilityHint="Stops every session that is currently running"
                accessibilityState={{ disabled: !client || abortingAll }}
                style={{
                  marginTop: 8,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: isDark ? "rgba(248,113,113,0.28)" : "rgba(239,68,68,0.22)",
                  backgroundColor: isDark ? "rgba(80,28,28,0.60)" : "rgba(239,68,68,0.07)",
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  opacity: abortingAll ? 0.6 : 1,
                }}
              >
                <Square size={16} color={isDark ? "#f87171" : "#dc2626"} strokeWidth={2.2} />
                <Text style={{ fontWeight: "600", color: isDark ? "#f87171" : "#dc2626" }}>
                  {abortingAll ? "Aborting…" : "Abort all active sessions"}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  )
}
