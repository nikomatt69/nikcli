import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native"
import { AdaptiveBlur } from "@/components/GlassView"
import { Menu, Settings, UserCircle2 } from "lucide-react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { DrawerMenu } from "@/components/layout/DrawerMenu"
import { StatusPill } from "@/components/layout/StatusPill"
import { getCurrentProjectLabel, getCurrentTab, getGitHubStatusLabel } from "@/components/layout/navigation.config"
import { useUIStore } from "@/lib/store"
import { useAppTheme } from "@/lib/theme"
import { router } from "expo-router"
import { useServer } from "@/lib/server-context"

type AppHeaderProps = {
  routeName: string
}

export function AppHeader({ routeName }: AppHeaderProps) {
  const { top } = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const { bootstrap, config } = useServer()
  const { palette, isDark } = useAppTheme()
  const current = getCurrentTab(routeName)
  const openDrawer = useUIStore((state) => state.openDrawer)
  const compact = width < 390
  const workspaceLabel = getCurrentProjectLabel(bootstrap, "None")
  const executionValue =
    config?.executionTarget === "container"
      ? bootstrap?.execution?.container?.available
        ? "Container"
        : "Container off"
      : "Local"
  const controlStatus = !config
    ? "Host offline"
    : !bootstrap?.github?.connected
      ? "GitHub attention"
      : "Control plane live"
  const controlTone = !config ? palette.danger : !bootstrap?.github?.connected ? palette.warn : palette.success

  return (
    <>
      {/* Outer header container with glass background */}
      <View
        style={{
          paddingTop: top + 4,
          paddingHorizontal: 16,
          paddingBottom: 8,
          overflow: "hidden",
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(193,208,223,0.8)",
        }}
      >
        {/* Full header glass background */}
        <AdaptiveBlur
          tint={isDark ? "dark" : "light"}
          intensity={isDark ? 90 : 80}
          style={StyleSheet.absoluteFill}
          fallbackColor={isDark ? "rgba(17,17,17,0.85)" : "rgba(241,246,251,0.80)"}
        />
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? "rgba(0,0,0,0.32)" : "rgba(241,246,251,0.22)" }]}
          pointerEvents="none"
        />

        <View style={[styles.innerCard, { borderColor: isDark ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.80)" }]}>
          <AdaptiveBlur
            tint={isDark ? "dark" : "extraLight"}
            intensity={isDark ? 55 : 45}
            style={StyleSheet.absoluteFill}
            fallbackColor={isDark ? "rgba(17,17,17,0.85)" : "rgba(255,255,255,0.82)"}
          />
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: isDark ? "rgba(24,24,24,0.52)" : "rgba(255,255,255,0.48)" },
            ]}
            pointerEvents="none"
          />

          <View
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: 24,
              backgroundColor: isDark ? "rgba(255,255,255,0.015)" : "rgba(232,240,248,0.14)",
            }}
          />

          {/* Top row */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
              <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: controlTone }} />
              <Text
                style={{
                  fontSize: 9,
                  fontWeight: "700",
                  letterSpacing: 1.4,
                  color: palette.soft,
                  textTransform: "uppercase",
                }}
              >
                {controlStatus}
              </Text>
              <Text
                style={{
                  fontSize: 9,
                  fontWeight: "700",
                  letterSpacing: 1.4,
                  color: palette.accentLight,
                  textTransform: "uppercase",
                }}
              >
                {current.label}
              </Text>
            </View>
            <Pressable
              onPress={() => router.push("/settings")}
              accessibilityRole="button"
              accessibilityLabel="Open settings"
              accessibilityHint="Opens connection, model, automation, and app preferences"
              hitSlop={6}
              style={({ pressed }) => ({
                borderRadius: 13,
                borderWidth: 1,
                borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.82)",
                backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.58)",
                paddingHorizontal: 10,
                paddingVertical: 8,
                opacity: pressed ? 0.7 : 1,
                transform: [{ scale: pressed ? 0.93 : 1 }],
              })}
            >
              <Settings size={15} color={palette.ink} strokeWidth={2.2} />
            </Pressable>
            <Pressable
              onPress={() => router.push("/user")}
              accessibilityRole="button"
              accessibilityLabel="Open profile"
              accessibilityHint="Opens account and user management"
              hitSlop={6}
              style={({ pressed }) => ({
                borderRadius: 13,
                borderWidth: 1,
                borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.82)",
                backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.58)",
                paddingHorizontal: 10,
                paddingVertical: 8,
                opacity: pressed ? 0.7 : 1,
                transform: [{ scale: pressed ? 0.93 : 1 }],
              })}
            >
              <UserCircle2 size={15} color={palette.ink} strokeWidth={2.2} />
            </Pressable>
            <Pressable
              onPress={openDrawer}
              accessibilityRole="button"
              accessibilityLabel="Open navigation drawer"
              accessibilityHint="Shows workspace status and navigation shortcuts"
              hitSlop={6}
              style={({ pressed }) => ({
                borderRadius: 13,
                borderWidth: 1,
                borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.82)",
                backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.58)",
                paddingHorizontal: 10,
                paddingVertical: 8,
                opacity: pressed ? 0.7 : 1,
                transform: [{ scale: pressed ? 0.93 : 1 }],
              })}
            >
              <Menu size={15} color={palette.ink} strokeWidth={2.2} />
            </Pressable>
          </View>

          {/* Title + Workspace */}
          <View
            style={[
              { marginTop: 8, gap: 8 },
              !compact && { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
            ]}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={{
                  fontWeight: "600",
                  color: palette.ink,
                  fontSize: compact ? 16 : 17,
                  lineHeight: compact ? 19 : 20,
                }}
              >
                {current.label}
              </Text>
              <Text style={{ marginTop: 2, fontSize: 11, lineHeight: 16, color: palette.soft }} numberOfLines={1}>
                {current.subtitle}
              </Text>
            </View>

            <View
              style={{
                borderRadius: 13,
                borderWidth: 1,
                borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.78)",
                backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.52)",
                paddingHorizontal: 10,
                paddingVertical: 6,
                minWidth: 0,
              }}
            >
              <Text
                style={{
                  fontSize: 8,
                  fontWeight: "700",
                  letterSpacing: 1.2,
                  color: palette.accentLight,
                  textTransform: "uppercase",
                }}
              >
                Workspace
              </Text>
              <Text
                selectable
                style={{ marginTop: 2, fontSize: 10, fontWeight: "600", color: palette.ink }}
                numberOfLines={1}
              >
                {workspaceLabel}
              </Text>
              <Text style={{ marginTop: 2, fontSize: 8, color: palette.soft }}>{executionValue}</Text>
            </View>
          </View>

          {/* Status pills */}
          <View style={{ marginTop: 8, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <StatusPill label="Host" value={config ? "Connected" : "Offline"} tone={config ? "good" : "warn"} compact />
            <StatusPill
              label="GitHub"
              value={getGitHubStatusLabel(bootstrap, "Awaiting auth")}
              tone={bootstrap?.github?.connected ? "good" : "warn"}
              compact
            />
            <StatusPill
              label="Run"
              value={executionValue}
              tone={config?.executionTarget === "container" ? "good" : "neutral"}
              compact
            />
          </View>
        </View>
      </View>
      <DrawerMenu routeName={routeName} />
    </>
  )
}

const styles = StyleSheet.create({
  innerCard: {
    overflow: "hidden",
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
  },
})
